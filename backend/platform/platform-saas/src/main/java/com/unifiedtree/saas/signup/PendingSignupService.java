package com.unifiedtree.saas.signup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * CRUD over {@code platform.pending_signups}.
 *
 * <p>Owns the write side of the hard-gate flow: the signup form endpoint
 * stashes an intent here (with the pre-hashed password), the webhook
 * looks it up when Razorpay confirms the mandate, and lifecycle
 * transitions ({@code PROVISIONED} / {@code FAILED} / {@code CANCELLED})
 * are recorded so the poll endpoint can tell the browser what to do next.
 *
 * <p>Deliberately dumb: no orchestration lives here. Provisioning
 * (creating the workspace) belongs to {@link MandateProvisioningService}.
 */
@Service
public class PendingSignupService {

    private static final Logger log = LoggerFactory.getLogger(PendingSignupService.class);

    private final JdbcTemplate jdbc;

    public PendingSignupService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Persist a signup intent AFTER Razorpay's create-subscription has returned
     * an id + short_url. The unique partial index on {@code lower(subdomain)}
     * where {@code status='AWAITING_MANDATE'} enforces "one active reservation
     * per subdomain" — a race hits {@link DuplicateKeyException} which we
     * translate to a 409 for the caller.
     */
    public UUID stash(StashArgs a) {
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO platform.pending_signups (
                        id, mode, account_id, email, password_hash, phone,
                        admin_name, company_name, subdomain,
                        country, timezone, currency, language, primary_interest,
                        plan_keys, seats, billing_cycle,
                        pan, gstin, address_line1, address_line2, city, state, postal_code,
                        razorpay_subscription_id, razorpay_customer_id, razorpay_short_url,
                        status, expires_at, created_at, updated_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?,
                        'AWAITING_MANDATE', now() + interval '24 hours', now(), now()
                    )
                    """,
                    id, a.mode(), a.accountId(), lower(a.email()), a.passwordHash(), a.phone(),
                    a.adminName(), a.companyName(), lower(a.subdomain()),
                    a.country(), a.timezone(), a.currency(), a.language(), a.primaryInterest(),
                    a.planKeys().toArray(new String[0]), a.seats(), a.billingCycle(),
                    a.pan(), a.gstin(), a.addressLine1(), a.addressLine2(), a.city(), a.state(), a.postalCode(),
                    a.razorpaySubscriptionId(), a.razorpayCustomerId(), a.razorpayShortUrl());
        } catch (DuplicateKeyException e) {
            // The partial unique index on (lower(subdomain) WHERE status='AWAITING_MANDATE')
            // means another intent is currently holding this subdomain. Distinct from
            // the tenants-side unique index (which fires only at provisioning time).
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That workspace URL is already being claimed. Please pick another.");
        }
        log.info("pending_signup {} stashed  mode={} sub={} rzp={}",
                id, a.mode(), a.subdomain(), a.razorpaySubscriptionId());
        return id;
    }

    public Optional<PendingSignup> findById(UUID id) {
        try {
            return Optional.of(jdbc.queryForObject(
                    "SELECT " + COLUMNS + " FROM platform.pending_signups WHERE id = ?",
                    ROW_MAPPER, id));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public Optional<PendingSignup> findByRazorpaySubscriptionId(String razorpaySubscriptionId) {
        if (razorpaySubscriptionId == null || razorpaySubscriptionId.isBlank()) return Optional.empty();
        try {
            return Optional.of(jdbc.queryForObject(
                    "SELECT " + COLUMNS + " FROM platform.pending_signups WHERE razorpay_subscription_id = ?",
                    ROW_MAPPER, razorpaySubscriptionId));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    /**
     * Flip the intent to PROVISIONED and store the created tenant id. Idempotent —
     * re-invoking with the same {@code (id, tenantId)} is a no-op because the
     * UPDATE's WHERE clause excludes rows already PROVISIONED.
     */
    public void markProvisioned(UUID id, UUID tenantId) {
        int rows = jdbc.update("""
                UPDATE platform.pending_signups
                   SET status = 'PROVISIONED', tenant_id = ?, provisioned_at = now(), updated_at = now()
                 WHERE id = ? AND status <> 'PROVISIONED'
                """, tenantId, id);
        if (rows > 0) log.info("pending_signup {} -> PROVISIONED tenant={}", id, tenantId);
    }

    public void markFailed(UUID id, String reason) {
        jdbc.update("""
                UPDATE platform.pending_signups
                   SET status = 'FAILED', failed_at = now(),
                       failure_reason = COALESCE(?, failure_reason), updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, reason, id);
        log.warn("pending_signup {} -> FAILED  reason={}", id, reason);
    }

    public void markCancelled(UUID id) {
        jdbc.update("""
                UPDATE platform.pending_signups
                   SET status = 'CANCELLED', updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, id);
        log.info("pending_signup {} -> CANCELLED", id);
    }

    /** Rows whose 24-hour expires_at has passed while still AWAITING_MANDATE. */
    public List<PendingSignup> findExpiredAwaiting(Instant now, int limit) {
        return jdbc.query(
                "SELECT " + COLUMNS + " FROM platform.pending_signups " +
                " WHERE status = 'AWAITING_MANDATE' AND expires_at < ? " +
                " ORDER BY expires_at ASC LIMIT ?",
                ROW_MAPPER, java.sql.Timestamp.from(now), limit);
    }

    // -- helpers --------------------------------------------------------------

    private static String lower(String s) { return s == null ? null : s.trim().toLowerCase(Locale.ROOT); }

    private static final String COLUMNS = String.join(", ",
            "id", "mode", "account_id", "email", "password_hash", "phone",
            "admin_name", "company_name", "subdomain",
            "country", "timezone", "currency", "language", "primary_interest",
            "plan_keys", "seats", "billing_cycle",
            "pan", "gstin", "address_line1", "address_line2", "city", "state", "postal_code",
            "razorpay_subscription_id", "razorpay_customer_id", "razorpay_short_url",
            "status", "tenant_id", "provisioned_at", "failed_at", "failure_reason",
            "expires_at", "created_at", "updated_at");

    private static final org.springframework.jdbc.core.RowMapper<PendingSignup> ROW_MAPPER = (rs, n) -> {
        java.sql.Array arr = rs.getArray("plan_keys");
        List<String> planKeys = arr != null ? List.of((String[]) arr.getArray()) : List.of();
        return new PendingSignup(
                (UUID) rs.getObject("id"),
                rs.getString("mode"),
                (UUID) rs.getObject("account_id"),
                rs.getString("email"),
                rs.getString("password_hash"),
                rs.getString("phone"),
                rs.getString("admin_name"),
                rs.getString("company_name"),
                rs.getString("subdomain"),
                rs.getString("country"),
                rs.getString("timezone"),
                rs.getString("currency"),
                rs.getString("language"),
                rs.getString("primary_interest"),
                planKeys,
                rs.getInt("seats"),
                rs.getString("billing_cycle"),
                rs.getString("pan"),
                rs.getString("gstin"),
                rs.getString("address_line1"),
                rs.getString("address_line2"),
                rs.getString("city"),
                rs.getString("state"),
                rs.getString("postal_code"),
                rs.getString("razorpay_subscription_id"),
                rs.getString("razorpay_customer_id"),
                rs.getString("razorpay_short_url"),
                rs.getString("status"),
                (UUID) rs.getObject("tenant_id"),
                toInstant(rs.getTimestamp("provisioned_at")),
                toInstant(rs.getTimestamp("failed_at")),
                rs.getString("failure_reason"),
                toInstant(rs.getTimestamp("expires_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at")));
    };

    private static Instant toInstant(java.sql.Timestamp t) { return t == null ? null : t.toInstant(); }

    /**
     * Arguments to {@link #stash}. Kept as a record instead of a positional
     * argument list because it has 20+ fields and mis-ordered args would be
     * silent, catastrophic bugs (wrong password on the wrong row, wrong
     * subdomain on the wrong signup).
     */
    public record StashArgs(
            String mode,
            UUID accountId,
            String email,
            String passwordHash,
            String phone,
            String adminName,
            String companyName,
            String subdomain,
            String country,
            String timezone,
            String currency,
            String language,
            String primaryInterest,
            List<String> planKeys,
            int seats,
            String billingCycle,
            String pan,
            String gstin,
            String addressLine1,
            String addressLine2,
            String city,
            String state,
            String postalCode,
            String razorpaySubscriptionId,
            String razorpayCustomerId,
            String razorpayShortUrl
    ) {}

    /** Immutable snapshot of a platform.pending_signups row. */
    public record PendingSignup(
            UUID id,
            String mode,
            UUID accountId,
            String email,
            String passwordHash,
            String phone,
            String adminName,
            String companyName,
            String subdomain,
            String country,
            String timezone,
            String currency,
            String language,
            String primaryInterest,
            List<String> planKeys,
            int seats,
            String billingCycle,
            String pan,
            String gstin,
            String addressLine1,
            String addressLine2,
            String city,
            String state,
            String postalCode,
            String razorpaySubscriptionId,
            String razorpayCustomerId,
            String razorpayShortUrl,
            String status,
            UUID tenantId,
            Instant provisionedAt,
            Instant failedAt,
            String failureReason,
            Instant expiresAt,
            Instant createdAt,
            Instant updatedAt
    ) {}
}
