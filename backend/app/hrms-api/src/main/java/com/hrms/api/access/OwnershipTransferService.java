package com.hrms.api.access;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.util.HtmlUtils;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Ownership transfer (owner decisions, 6 Oct 2026 — docs/redesign/OWNERSHIP_TRANSFER_DESIGN.md):
 * <ol>
 *   <li><b>Start</b> — the owner names someone who already has an active login in the business and
 *       confirms with their password (5 wrong tries per 15 minutes); the offer waits 7 days; the new owner
 *       is told in the app and by email.</li>
 *   <li><b>Cancel</b> (the owner, while pending) / <b>Decline</b> (the named person).</li>
 *   <li><b>Accept</b> (the named person) — {@link WorkspaceAccessService#transferOwnership} moves the
 *       roles; the business's contact, owner account (created if they have none) and account links move
 *       to the new owner; both are signed out everywhere so the new access applies at once; the old
 *       owner keeps full Admin for 15 days.</li>
 *   <li><b>End</b> — the new owner can end the transition early; otherwise it ends after 15 days
 *       ({@link WorkspaceAccessService#endOwnerTransition}). Unanswered offers expire.</li>
 * </ol>
 * Every step is a conditional update on the transfer's status, so two people acting at once can't both
 * win (cancel racing accept, review 7 Oct). Overdue offers and handovers are settled by a daily job AND
 * whenever the Ownership endpoints are used, each in its own transaction, so a job that doesn't run
 * never leaves the old owner with Admin access. Every step is written to the audit log.
 * Exactly one owner: the Owner role can't be given or taken on the Access screen (AccessPolicy).
 * Does nothing until V144_5 is applied.
 */
@Service
public class OwnershipTransferService {

    private static final Logger log = LoggerFactory.getLogger(OwnershipTransferService.class);
    static final Duration OFFER = Duration.ofDays(7);
    static final Duration TRANSITION = Duration.ofDays(15);
    static final int NOTE_MAX = 500;

    private final JdbcTemplate jdbc;
    private final WorkspaceAccessService access;
    private final AccessGuard guard;
    private final UserCredentialsRepository credRepo;
    private final PasswordService passwords;
    private final SessionService sessions;
    private final AppNotificationService notifications;
    private final AccessAudit audit;
    private final MailService mail;
    /** Wrong passwords per owner (epoch ms), the last 15 minutes: at most {@link #PASSWORD_TRIES}. */
    private final java.util.concurrent.ConcurrentHashMap<UUID, java.util.Deque<Long>> wrongPasswords = new java.util.concurrent.ConcurrentHashMap<>();
    static final int PASSWORD_TRIES = 5;
    static final Duration PASSWORD_WINDOW = Duration.ofMinutes(15);
    private final TransactionTemplate tx;

    @Value("${unifiedtree.mail.invite-url-base:${unifiedtree.invitation.platform-base-url:http://localhost:3001}}")
    String platformBaseUrl = "http://localhost:3001";

    public OwnershipTransferService(JdbcTemplate jdbc, WorkspaceAccessService access, AccessGuard guard,
                                    UserCredentialsRepository credRepo, PasswordService passwords,
                                    SessionService sessions, AppNotificationService notifications,
                                    AccessAudit audit, MailService mail,
                                    PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.access = access;
        this.guard = guard;
        this.credRepo = credRepo;
        this.passwords = passwords;
        this.sessions = sessions;
        this.notifications = notifications;
        this.audit = audit;
        this.mail = mail;
        this.tx = new TransactionTemplate(txManager);
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
        if (note != null && note.length() > NOTE_MAX) {
            throw new BusinessRuleException("Keep the note under " + NOTE_MAX + " characters.", "NOTE_TOO_LONG");
        }
        UserCredentials owner = credRepo.findById(ownerId)
                .orElseThrow(() -> new BusinessRuleException("Account not found", "USER_NOT_FOUND"));
        checkPassword(ownerId, owner, password);
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
        record(ownerId, toUserId, "Ownership transfer offered to " + to.getEmail(), "PENDING", id);
        tell(tenantId, to, "You've been offered ownership",
                owner.getEmail() + " wants to make you the owner of this business. Accept or decline in Business settings → Ownership within 7 days.");
        log.info("ownership transfer {} started tenant={} from={} to={}", id, tenantId, ownerId, toUserId);
        return current(tenantId, ownerId);
    }

    @Transactional
    public void cancel(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.fromUserId().equals(callerId)) throw new BusinessRuleException("Only the owner can cancel this.", "NOT_ALLOWED");
        move(id, "PENDING", "CANCELLED", callerId);
        record(callerId, t.toUserId(), "Ownership transfer to " + t.toEmail() + " cancelled", "CANCELLED", id);
        credRepo.findById(t.toUserId()).ifPresent(u -> tell(tenantId, u, "Ownership offer withdrawn",
                t.fromEmail() + " withdrew the offer to make you the owner."));
    }

    @Transactional
    public void decline(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.toUserId().equals(callerId)) throw new BusinessRuleException("Only the person offered can decline.", "NOT_ALLOWED");
        move(id, "PENDING", "DECLINED", callerId);
        record(callerId, t.toUserId(), t.toEmail() + " declined ownership", "DECLINED", id);
        credRepo.findById(t.fromUserId()).ifPresent(u -> tell(tenantId, u, "Ownership offer declined",
                t.toEmail() + " declined to become the owner. You're still the owner."));
    }

    @Transactional
    public Transfer accept(UUID tenantId, UUID callerId, UUID id) {
        Transfer t = open(tenantId, id, "PENDING");
        if (!t.toUserId().equals(callerId)) throw new BusinessRuleException("Only the person offered can accept.", "NOT_ALLOWED");
        if (t.expiresAt().isBefore(Instant.now())) {
            // Nothing written here (a throw rolls it back): settleOverdue marks it EXPIRED.
            throw new BusinessRuleException("This offer has expired. Ask the owner to start it again.", "TRANSFER_EXPIRED");
        }
        // Claim it first: a cancel or decline at the same moment then finds it no longer PENDING.
        int claimed = jdbc.update("""
                UPDATE platform.ownership_transfers
                   SET status = 'TRANSITION', accepted_at = now(), transition_ends_at = ?, updated_at = now()
                 WHERE id = ? AND status = 'PENDING' AND expires_at > now()
                """, Timestamp.from(Instant.now().plus(TRANSITION)), id);
        if (claimed != 1) throw notOpen();
        access.transferOwnership(tenantId, t.fromUserId(), t.toUserId());
        moveBusinessContact(tenantId, t.fromUserId(), t.toUserId());
        record(callerId, t.toUserId(), t.toEmail() + " accepted ownership from " + t.fromEmail(), "TRANSITION", id);
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
        if (!finishTransition(tenantId, t, callerId)) throw notOpen();
    }

    /** Daily: for each business with an overdue offer or handover, {@link #settleOverdue}. */
    @Scheduled(cron = "${unifiedtree.ownership.sweep-cron:0 15 2 * * *}", zone = "Asia/Kolkata")
    public void sweep() {
        if (!ready()) return;
        // platform.ownership_transfers has no row-level security: read unbound.
        List<UUID> tenants = jdbc.queryForList("""
                SELECT DISTINCT tenant_id FROM platform.ownership_transfers
                 WHERE (status = 'PENDING' AND expires_at < now()) OR (status = 'TRANSITION' AND transition_ends_at <= now())
                """, UUID.class);
        for (UUID tenant : tenants) {
            try {
                TenantContext.setTenantId(tenant);
                com.hrms.core.tenant.TenantContext.setTenantId(tenant);
                settleOverdue(tenant);
            } catch (RuntimeException e) {
                log.warn("ownership sweep failed for tenant {}: {}", tenant, e.getMessage());
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
    }

    /**
     * Expires this business's unanswered offers and ends its handovers past 15 days, each in its own
     * transaction (a tenant-bound connection saves nothing outside one: review 7 Oct, B1). Run by the
     * daily job and before every Ownership request, so a job that doesn't run changes nothing. The caller
     * has the business bound.
     */
    public void settleOverdue(UUID tenantId) {
        if (!ready()) return;
        tx.executeWithoutResult(s -> {
            List<Map<String, Object>> expired = jdbc.queryForList("""
                    UPDATE platform.ownership_transfers SET status = 'EXPIRED', updated_at = now()
                     WHERE tenant_id = ? AND status = 'PENDING' AND expires_at < now()
                    RETURNING id, from_user_id, to_user_id
                    """, tenantId);
            for (Map<String, Object> r : expired) {
                UUID from = (UUID) r.get("from_user_id"), to = (UUID) r.get("to_user_id");
                record(null, to, "Ownership offer to " + email(to) + " expired", "EXPIRED", (UUID) r.get("id"));
                credRepo.findById(from).ifPresent(u -> tell(tenantId, u, "Ownership offer expired",
                        email(to) + " didn't answer within 7 days. You're still the owner."));
            }
        });
        List<UUID> due = jdbc.queryForList("""
                SELECT id FROM platform.ownership_transfers
                 WHERE tenant_id = ? AND status = 'TRANSITION' AND transition_ends_at <= now()
                """, UUID.class, tenantId);
        for (UUID id : due) {
            try {
                tx.executeWithoutResult(s -> finishTransition(tenantId, open(tenantId, id, "TRANSITION"), null));
            } catch (RuntimeException e) {
                log.warn("ownership transition end failed for {}: {}", id, e.getMessage());
            }
        }
    }

    // -- helpers --------------------------------------------------------------

    /**
     * Ends a handover once: COMPLETED only from TRANSITION (a second run or a click at the same moment
     * does nothing and returns false). {@code endedBy} is the new owner, or null for the 15-day end.
     */
    private boolean finishTransition(UUID tenantId, Transfer t, UUID endedBy) {
        int done = jdbc.update("""
                UPDATE platform.ownership_transfers
                   SET status = 'COMPLETED', completed_at = now(), ended_by = ?, updated_at = now()
                 WHERE id = ? AND status = 'TRANSITION'
                """, endedBy, t.id());
        if (done != 1) return false;
        boolean employee = access.endOwnerTransition(tenantId, t.fromUserId(), endedBy);
        // Their account keeps the business only while they still work there (employee self-service).
        jdbc.update("""
                UPDATE platform.account_workspaces aw
                   SET role = CASE WHEN ? THEN 'EMPLOYEE'::platform.workspace_role ELSE aw.role END,
                       status = CASE WHEN ? THEN aw.status ELSE 'REMOVED' END, updated_at = now()
                  FROM platform.accounts a
                 WHERE aw.account_id = a.id AND aw.tenant_id = ? AND lower(a.email) = lower(?) AND aw.role::text = 'ADMIN'
                """, employee, employee, tenantId, t.fromEmail());
        sessions.revokeAll(tenantId, t.fromUserId());
        record(endedBy, t.fromUserId(), "Ownership handover ended for " + t.fromEmail()
                + (endedBy == null ? " (15 days passed)" : " by the new owner"), "COMPLETED", t.id());
        credRepo.findById(t.fromUserId()).ifPresent(u -> tell(tenantId, u, "Handover finished",
                "Your Admin access for the handover has ended."
                        + (employee ? " You keep your own employee self-service." : "")));
        return true;
    }

    /** The business's owner contact, owner account and the owner's account membership move to the new owner. */
    private void moveBusinessContact(UUID tenantId, UUID fromUserId, UUID toUserId) {
        UserCredentials to = credRepo.findById(toUserId).orElseThrow();
        String fromEmail = credRepo.findById(fromUserId).map(UserCredentials::getEmail).orElse("");
        Map<String, Object> person = to.getEmployeeId() == null ? Map.of() : jdbc.queryForList("""
                SELECT trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS name, e.phone
                  FROM hrms.employees e WHERE e.id = ?
                """, to.getEmployeeId()).stream().findFirst().orElse(Map.of());
        UUID toAccount = accountFor(to, (String) person.get("name"));
        jdbc.update("""
                UPDATE platform.tenants SET contact_email = ?, admin_name = COALESCE(NULLIF(?, ''), admin_name),
                       contact_phone = COALESCE(?, contact_phone), owner_account_id = ?
                 WHERE id = ?
                """, to.getEmail(), person.get("name"), person.get("phone"), toAccount, tenantId);
        jdbc.update("UPDATE platform.subscriptions SET contact_email = ? WHERE tenant_id = ?", to.getEmail(), tenantId);
        jdbc.update("""
                UPDATE platform.account_workspaces aw SET role = 'ADMIN'
                  FROM platform.accounts a
                 WHERE aw.account_id = a.id AND aw.tenant_id = ? AND lower(a.email) = lower(?) AND aw.role::text = 'OWNER'
                """, tenantId, fromEmail);
        jdbc.update("""
                INSERT INTO platform.account_workspaces (id, account_id, tenant_id, auth_user_id, role, status)
                VALUES (gen_random_uuid(), ?, ?, ?, 'OWNER', 'ACTIVE')
                ON CONFLICT (account_id, tenant_id) DO UPDATE SET role = 'OWNER', status = 'ACTIVE'
                """, toAccount, tenantId, toUserId);
    }

    /**
     * The new owner's platform account (plan, autopay and the business list live there), created when
     * they have none, as the design says: same email, and the same password as their business login, so
     * they sign in to it the way they already do (or with Google, or "Forgot password").
     */
    private UUID accountFor(UserCredentials to, String name) {
        List<UUID> found = jdbc.queryForList("SELECT id FROM platform.accounts WHERE lower(email) = lower(?)", UUID.class, to.getEmail());
        if (!found.isEmpty()) return found.get(0);
        jdbc.update("""
                INSERT INTO platform.accounts (id, email, display_name, password_hash, status, failed_login_count,
                                               password_updated_at, created_at, updated_at)
                VALUES (?, lower(?), ?, ?, 'ACTIVE', 0, now(), now(), now())
                ON CONFLICT DO NOTHING
                """, UUID.randomUUID(), to.getEmail(), name == null || name.isBlank() ? to.getEmail() : name, to.getPasswordHash());
        return jdbc.queryForObject("SELECT id FROM platform.accounts WHERE lower(email) = lower(?)", UUID.class, to.getEmail());
    }

    private Transfer open(UUID tenantId, UUID id, String status) {
        requireReady();
        List<Transfer> rows = jdbc.query("SELECT * FROM platform.ownership_transfers WHERE id = ? AND tenant_id = ?",
                (rs, n) -> map(rs, null), id, tenantId);
        if (!rows.isEmpty() && "PENDING".equals(status) && "EXPIRED".equals(rows.get(0).status())) {
            throw new BusinessRuleException("This offer has expired. Ask the owner to start it again.", "TRANSFER_EXPIRED");
        }
        if (rows.isEmpty() || !status.equals(rows.get(0).status())) throw notOpen();
        return rows.get(0);
    }

    /** {@code from} → {@code to} only if it is still {@code from}: two people acting at once can't both win. */
    private void move(UUID id, String from, String to, UUID by) {
        int n = jdbc.update("UPDATE platform.ownership_transfers SET status = ?, ended_by = ?, updated_at = now() WHERE id = ? AND status = ?",
                to, by, id, from);
        if (n != 1) throw notOpen();
    }

    /** The owner's password; after 5 wrong ones in 15 minutes, no more tries until the oldest is 15 minutes old. */
    private void checkPassword(UUID ownerId, UserCredentials owner, String password) {
        long now = System.currentTimeMillis(), since = now - PASSWORD_WINDOW.toMillis();
        java.util.Deque<Long> wrong = wrongPasswords.computeIfAbsent(ownerId, k -> new java.util.concurrent.ConcurrentLinkedDeque<>());
        while (!wrong.isEmpty() && wrong.peekFirst() < since) wrong.pollFirst();
        if (wrong.size() >= PASSWORD_TRIES) {
            throw new BusinessRuleException("Too many wrong passwords. Try again in 15 minutes.", "RATE_LIMITED");
        }
        if (password == null || owner.getPasswordHash() == null || !passwords.matches(password, owner.getPasswordHash())) {
            wrong.addLast(now);
            throw new BusinessRuleException("That password isn't right.", "PASSWORD_WRONG");
        }
    }

    private static BusinessRuleException notOpen() {
        return new BusinessRuleException("This transfer isn't open any more.", "TRANSFER_NOT_OPEN");
    }

    private void record(UUID actorId, UUID subjectId, String summary, String status, UUID transferId) {
        try {
            audit.record(actorId, AccessAudit.PERMISSION_CHANGE, "USER", subjectId, summary,
                    Map.of("ownershipTransfer", transferId.toString(), "status", status, "by", actorId == null ? "system" : actorId.toString()));
        } catch (RuntimeException e) {
            log.warn("ownership audit failed: {}", e.getMessage());
        }
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

    /** In the app (employees) and by email (everyone, so someone with no employee record hears too). */
    private void tell(UUID tenantId, UserCredentials u, String title, String body) {
        if (u.getEmployeeId() != null) {
            try {
                notifications.create(tenantId, u.getEmployeeId(), AppNotificationType.GENERAL, title, body,
                        Map.of("route", "/business/ownership"));
            } catch (RuntimeException e) {
                log.warn("ownership notification failed: {}", e.getMessage());
            }
        }
        if (u.getEmail() != null) email(tenantId, u.getEmail(), title, body);
    }

    /** Sent after the transaction commits (never for a step that rolled back), off the request thread. */
    private void email(UUID tenantId, String to, String subject, String body) {
        Map<String, String> business = jdbc.query("SELECT display_name, subdomain FROM platform.tenants WHERE id = ?",
                rs -> rs.next() ? Map.of("name", String.valueOf(rs.getString(1)), "sub", String.valueOf(rs.getString(2))) : Map.of(), tenantId);
        if (business == null) business = Map.of();
        String name = business.getOrDefault("name", "Your business");
        String link = businessUrl(business.getOrDefault("sub", "")) + "/business/ownership";
        String html = "<p>" + HtmlUtils.htmlEscape(body) + "</p><p><a href=\"" + HtmlUtils.htmlEscape(link)
                + "\">Open Ownership in Business settings</a></p>";
        Runnable send = () -> {
            try {
                // White label: sent under the business's name, never the vendor's.
                mail.send(EmailMessage.simple(to, subject, html).withFromName(name));
            } catch (Exception e) {
                log.warn("ownership email to {} failed: {}", to, e.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { CompletableFuture.runAsync(send); }
            });
        } else {
            CompletableFuture.runAsync(send);
        }
    }

    private String businessUrl(String sub) {
        if (platformBaseUrl.contains("localhost") || sub.isBlank()) return platformBaseUrl;
        return "https://" + sub + "." + platformBaseUrl.replaceFirst("https?://", "").replaceFirst("/$", "");
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
