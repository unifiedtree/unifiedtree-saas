package com.hrms.api.access;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.auth.session.SessionService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ownership transfer (owner decisions, 6 Oct 2026 — docs/redesign/OWNERSHIP_TRANSFER_DESIGN.md):
 * <ol>
 *   <li><b>Start</b> — the owner names someone who already has an active login in the business and
 *       confirms with their password; the offer waits 7 days; the new owner is told.</li>
 *   <li><b>Cancel</b> (the owner, while pending) / <b>Decline</b> (the named person).</li>
 *   <li><b>Accept</b> (the named person) — {@link WorkspaceAccessService#transferOwnership} moves the
 *       roles; the business's contact and account links move to the new owner; both are signed out
 *       everywhere so the new access applies at once; the old owner keeps full Admin for 15 days.</li>
 *   <li><b>End</b> — the new owner can end the transition early; otherwise a daily job ends it after
 *       15 days ({@link WorkspaceAccessService#endOwnerTransition}). Unanswered offers expire.</li>
 * </ol>
 * Exactly one owner: the Owner role can't be given or taken on the Access screen (AccessPolicy).
 * Does nothing until V144_5 is applied.
 */
@Service
public class OwnershipTransferService {

    private static final Logger log = LoggerFactory.getLogger(OwnershipTransferService.class);
    static final Duration OFFER = Duration.ofDays(7);
    static final Duration TRANSITION = Duration.ofDays(15);

    private final JdbcTemplate jdbc;
    private final WorkspaceAccessService access;
    private final AccessGuard guard;
    private final UserCredentialsRepository credRepo;
    private final PasswordService passwords;
    private final SessionService sessions;
    private final AppNotificationService notifications;

    public OwnershipTransferService(JdbcTemplate jdbc, WorkspaceAccessService access, AccessGuard guard,
                                    UserCredentialsRepository credRepo, PasswordService passwords,
                                    SessionService sessions, AppNotificationService notifications) {
        this.jdbc = jdbc;
        this.access = access;
        this.guard = guard;
        this.credRepo = credRepo;
        this.passwords = passwords;
        this.sessions = sessions;
        this.notifications = notifications;
    }

    public record Transfer(UUID id, String status, UUID fromUserId, String fromEmail, UUID toUserId, String toEmail,
                           String note, Instant requestedAt, Instant expiresAt, Instant acceptedAt,
                           Instant transitionEndsAt, boolean youAreOwner, boolean youAreNewOwner, boolean youAreOldOwner) {}

    public record Candidate(UUID userId, String email, String name) {}

    /** The open transfer (pending or in transition) as the caller sees it; null when there is none. */
    public Transfer current(UUID tenantId, UUID callerId) {
        requireReady();
        List<Transfer> open = jdbc.query("""
                SELECT * FROM platform.ownership_transfers
                 WHERE tenant_id = ? AND status IN ('PENDING', 'TRANSITION')
                """, (rs, n) -> map(rs, callerId), tenantId);
        if (open.isEmpty()) return null;
        Transfer t = open.get(0);
        // Only the people in it (and the owner) see it.
        return t.youAreOldOwner() || t.youAreNewOwner() || t.youAreOwner() ? t : null;
    }

    /** People the owner can hand the business to: other active logins in it. */
    public List<Candidate> candidates(UUID tenantId, UUID ownerId) {
        requireOwner(ownerId);
        return jdbc.query("""
                SELECT uc.id, uc.email, trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS name
                  FROM auth.user_credentials uc
                  LEFT JOIN hrms.employees e ON e.id = uc.employee_id
                 WHERE uc.tenant_id = ? AND uc.is_active = TRUE AND uc.id <> ?
                 ORDER BY lower(uc.email)
                """, (rs, n) -> new Candidate(rs.getObject("id", UUID.class), rs.getString("email"),
                        blankToNull(rs.getString("name"))), tenantId, ownerId);
    }

    @Transactional
    public Transfer start(UUID tenantId, UUID ownerId, UUID toUserId, String password, String note) {
        requireReady();
        requireOwner(ownerId);
        UserCredentials owner = credRepo.findById(ownerId)
                .orElseThrow(() -> new BusinessRuleException("Account not found", "USER_NOT_FOUND"));
        if (password == null || owner.getPasswordHash() == null || !passwords.matches(password, owner.getPasswordHash())) {
            throw new BusinessRuleException("That password isn't right.", "PASSWORD_WRONG");
        }
        if (ownerId.equals(toUserId)) throw new BusinessRuleException("Choose someone other than yourself.", "SAME_PERSON");
        UserCredentials to = credRepo.findById(toUserId)
                .orElseThrow(() -> new BusinessRuleException("That person has no login in this business.", "USER_NOT_FOUND"));
        if (!to.isActive()) {
            throw new BusinessRuleException("That person hasn't activated their login yet.", "USER_NOT_ACTIVE");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO platform.ownership_transfers (id, tenant_id, from_user_id, to_user_id, status, note, expires_at)
                    VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
                    """, id, tenantId, ownerId, toUserId, blankToNull(note), Timestamp.from(Instant.now().plus(OFFER)));
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw new BusinessRuleException("A transfer is already open. Cancel it first.", "TRANSFER_OPEN");
        }
        tell(tenantId, to, "You've been offered ownership",
                owner.getEmail() + " wants to make you the owner of this business. Accept or decline in Business settings → Ownership within 7 days.");
        log.info("ownership transfer {} started tenant={} from={} to={}", id, tenantId, ownerId, toUserId);
        return current(tenantId, ownerId);
    }

    @Transactional
    public void cancel(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.fromUserId().equals(callerId)) throw new BusinessRuleException("Only the owner can cancel this.", "NOT_ALLOWED");
        setStatus(id, "CANCELLED", callerId);
    }

    @Transactional
    public void decline(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.toUserId().equals(callerId)) throw new BusinessRuleException("Only the person offered can decline.", "NOT_ALLOWED");
        setStatus(id, "DECLINED", callerId);
        credRepo.findById(t.fromUserId()).ifPresent(u -> tell(tenantId, u, "Ownership offer declined",
                t.toEmail() + " declined to become the owner. You're still the owner."));
    }

    @Transactional
    public Transfer accept(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.toUserId().equals(callerId)) throw new BusinessRuleException("Only the person offered can accept.", "NOT_ALLOWED");
        if (t.expiresAt().isBefore(Instant.now())) {
            setStatus(id, "EXPIRED", null);
            throw new BusinessRuleException("This offer has expired. Ask the owner to start it again.", "TRANSFER_EXPIRED");
        }
        access.transferOwnership(tenantId, t.fromUserId(), t.toUserId());
        moveBusinessContact(tenantId, t.fromUserId(), t.toUserId());
        Instant ends = Instant.now().plus(TRANSITION);
        jdbc.update("""
                UPDATE platform.ownership_transfers
                   SET status = 'TRANSITION', accepted_at = now(), transition_ends_at = ?, updated_at = now()
                 WHERE id = ?
                """, Timestamp.from(ends), id);
        // New access applies at once: both are signed out everywhere and sign in again.
        sessions.revokeAll(tenantId, t.fromUserId());
        sessions.revokeAll(tenantId, t.toUserId());
        credRepo.findById(t.fromUserId()).ifPresent(u -> tell(tenantId, u, "Ownership handed over",
                t.toEmail() + " is now the owner. You keep full Admin access for 15 days to help with the handover."));
        log.info("ownership transfer {} accepted tenant={} new owner={}", id, tenantId, callerId);
        return current(tenantId, callerId);
    }

    @Transactional
    public void endTransition(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "TRANSITION");
        if (!t.toUserId().equals(callerId)) throw new BusinessRuleException("Only the new owner can end the handover.", "NOT_ALLOWED");
        finishTransition(tenantId, t, callerId);
    }

    /** Daily: unanswered offers expire; transitions past 15 days end. */
    @Scheduled(cron = "${unifiedtree.ownership.sweep-cron:0 15 2 * * *}", zone = "Asia/Kolkata")
    public void sweep() {
        if (!ready()) return;
        jdbc.update("UPDATE platform.ownership_transfers SET status = 'EXPIRED', updated_at = now() WHERE status = 'PENDING' AND expires_at < now()");
        List<Map<String, Object>> due = jdbc.queryForList(
                "SELECT id, tenant_id FROM platform.ownership_transfers WHERE status = 'TRANSITION' AND transition_ends_at <= now()");
        for (Map<String, Object> r : due) {
            UUID tenant = (UUID) r.get("tenant_id");
            try {
                TenantContext.setTenantId(tenant);
                com.hrms.core.tenant.TenantContext.setTenantId(tenant);
                Transfer t = open(tenant, (UUID) r.get("id"), "TRANSITION");
                finishTransition(tenant, t, null);
            } catch (RuntimeException e) {
                log.warn("ownership transition end failed for {}: {}", r.get("id"), e.getMessage());
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
    }

    // -- helpers --------------------------------------------------------------

    private void finishTransition(UUID tenantId, Transfer t, UUID endedBy) {
        access.endOwnerTransition(tenantId, t.fromUserId());
        jdbc.update("""
                UPDATE platform.ownership_transfers
                   SET status = 'COMPLETED', completed_at = now(), ended_by = ?, updated_at = now()
                 WHERE id = ?
                """, endedBy, t.id());
        jdbc.update("""
                UPDATE platform.account_workspaces aw SET status = 'REMOVED'
                  FROM platform.accounts a
                 WHERE aw.account_id = a.id AND aw.tenant_id = ? AND lower(a.email) = lower(?) AND aw.role::text = 'ADMIN'
                """, tenantId, t.fromEmail());
        sessions.revokeAll(tenantId, t.fromUserId());
        credRepo.findById(t.fromUserId()).ifPresent(u -> tell(tenantId, u, "Handover finished",
                "Your Admin access for the handover has ended."));
    }

    /** The business's owner contact, owner account and the owner's account membership move to the new owner. */
    private void moveBusinessContact(UUID tenantId, UUID fromUserId, UUID toUserId) {
        UserCredentials to = credRepo.findById(toUserId).orElseThrow();
        String fromEmail = credRepo.findById(fromUserId).map(UserCredentials::getEmail).orElse("");
        Map<String, Object> person = jdbc.queryForList("""
                SELECT trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS name, e.phone
                  FROM hrms.employees e WHERE e.id = ?
                """, to.getEmployeeId()).stream().findFirst().orElse(Map.of());
        List<UUID> toAccount = jdbc.queryForList("SELECT id FROM platform.accounts WHERE lower(email) = lower(?)", UUID.class, to.getEmail());
        jdbc.update("""
                UPDATE platform.tenants SET contact_email = ?, admin_name = COALESCE(NULLIF(?, ''), admin_name),
                       contact_phone = COALESCE(?, contact_phone), owner_account_id = COALESCE(?, owner_account_id)
                 WHERE id = ?
                """, to.getEmail(), person.get("name"), person.get("phone"), toAccount.isEmpty() ? null : toAccount.get(0), tenantId);
        jdbc.update("UPDATE platform.subscriptions SET contact_email = ? WHERE tenant_id = ?", to.getEmail(), tenantId);
        jdbc.update("""
                UPDATE platform.account_workspaces aw SET role = 'ADMIN'
                  FROM platform.accounts a
                 WHERE aw.account_id = a.id AND aw.tenant_id = ? AND lower(a.email) = lower(?) AND aw.role::text = 'OWNER'
                """, tenantId, fromEmail);
        if (!toAccount.isEmpty()) {
            jdbc.update("""
                    INSERT INTO platform.account_workspaces (id, account_id, tenant_id, auth_user_id, role, status)
                    VALUES (gen_random_uuid(), ?, ?, ?, 'OWNER', 'ACTIVE')
                    ON CONFLICT (account_id, tenant_id) DO UPDATE SET role = 'OWNER', status = 'ACTIVE'
                    """, toAccount.get(0), tenantId, toUserId);
        }
    }

    private Transfer open(UUID tenantId, UUID id, String status) {
        requireReady();
        List<Transfer> rows = jdbc.query("SELECT * FROM platform.ownership_transfers WHERE id = ? AND tenant_id = ?",
                (rs, n) -> map(rs, null), id, tenantId);
        if (rows.isEmpty() || !status.equals(rows.get(0).status())) {
            throw new BusinessRuleException("This transfer isn't open any more.", "TRANSFER_NOT_OPEN");
        }
        return rows.get(0);
    }

    private void setStatus(UUID id, String status, UUID by) {
        jdbc.update("UPDATE platform.ownership_transfers SET status = ?, ended_by = ?, updated_at = now() WHERE id = ?", status, by, id);
    }

    private Transfer map(java.sql.ResultSet rs, UUID callerId) throws java.sql.SQLException {
        UUID from = rs.getObject("from_user_id", UUID.class), to = rs.getObject("to_user_id", UUID.class);
        return new Transfer(rs.getObject("id", UUID.class), rs.getString("status"), from, email(from), to, email(to),
                rs.getString("note"), instant(rs.getTimestamp("requested_at")), instant(rs.getTimestamp("expires_at")),
                instant(rs.getTimestamp("accepted_at")), instant(rs.getTimestamp("transition_ends_at")),
                callerId != null && guard.isOwner(callerId), to.equals(callerId), from.equals(callerId));
    }

    private String email(UUID userId) {
        return credRepo.findById(userId).map(UserCredentials::getEmail).orElse(null);
    }

    private void tell(UUID tenantId, UserCredentials u, String title, String body) {
        if (u.getEmployeeId() == null) return;   // notifications reach employees; the Ownership page shows the rest
        try {
            notifications.create(tenantId, u.getEmployeeId(), AppNotificationType.GENERAL, title, body,
                    Map.of("route", "/business/ownership"));
        } catch (RuntimeException e) {
            log.warn("ownership notification failed: {}", e.getMessage());
        }
    }

    private void requireOwner(UUID userId) {
        if (!guard.isOwner(userId)) throw new BusinessRuleException("Only the owner can do this.", "OWNER_ONLY");
    }

    private void requireReady() {
        if (!ready()) throw new BusinessRuleException("Ownership transfer isn't available yet.", "FEATURE_NOT_READY");
    }

    boolean ready() {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass('platform.ownership_transfers') IS NOT NULL", Boolean.class));
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
