package com.unifiedtree.saas.signup;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.service.SaasService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Workspace-creation orchestrator invoked from the Razorpay webhook once a
 * mandate has been authenticated (TRIAL) or the first charge has succeeded
 * (PAID). Reads a {@link PendingSignupService.PendingSignup} row, calls
 * {@link SaasService#provisionFromPending} to atomically create the tenant +
 * seed data + account + credentials + roles + account_workspaces, then
 * writes the durable {@code platform.subscriptions} row that links the
 * workspace back to the Razorpay subscription.
 *
 * <p><b>Idempotency</b>: keyed by {@code pending_signups.id}. If the same
 * pending row is provisioned twice (e.g. subscription.activated arrives
 * after subscription.charged for the PAID path), the second call finds
 * {@code status='PROVISIONED'} and returns the existing {@code tenant_id}
 * without creating a second tenant.
 */
@Service
public class MandateProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(MandateProvisioningService.class);

    private final JdbcTemplate jdbc;
    private final PendingSignupService pending;
    private final SaasService saas;

    public MandateProvisioningService(JdbcTemplate jdbc,
                                      PendingSignupService pending,
                                      SaasService saas) {
        this.jdbc = jdbc;
        this.pending = pending;
        this.saas = saas;
    }

    /**
     * Provision the workspace referenced by {@code pendingSignupId} if not
     * already done. Returns the resulting tenant id (existing on replay,
     * newly-created on first call). {@code subscriptionEntity} is the
     * {@code payload.subscription.entity} block from the webhook — used to
     * populate {@code current_period_end} / {@code next_charge_at} on the
     * platform.subscriptions row without a separate Razorpay fetch.
     *
     * <p><b>Deliberately NOT @Transactional.</b> SaasWriter.signup is the
     * RLS-sensitive step and MUST run in its own fresh transaction so the
     * {@code SET LOCAL app.tenant_id} hook (fired at connection lease by
     * TenantAwareDataSource) matches the rows it inserts. Wrapping this
     * method in @Transactional leashes the writer into a parent connection
     * that was leased BEFORE {@link com.unifiedtree.security.tenant.TenantContext#setTenantId}
     * had a value, causing every RLS-protected insert (org.companies,
     * hrms.*, auth.user_credentials, ...) to violate its row policy — the
     * exact PSQLException the synthetic E2E test caught after the
     * webhook-parsing bug had already been fixed. The javadoc on
     * SaasWriter.signup warns about this contract; the initial version of
     * this class ignored it.
     *
     * <p>Downstream inserts (subscriptions ledger row, tenants
     * pan/gstin update, markProvisioned) each auto-commit — a partial
     * failure between them and the writer leaves the tenant present but
     * the subscription ledger unfilled. Rare and manually reconcilable;
     * better than every signup rolling back on RLS.
     */
    public UUID provisionFromPending(UUID pendingSignupId, JsonNode subscriptionEntity, String triggerEvent) {
        Optional<PendingSignupService.PendingSignup> maybe = pending.findById(pendingSignupId);
        if (maybe.isEmpty()) {
            log.warn("provisionFromPending({}) — pending row missing; ignoring (webhook may be for a cancelled/expired signup)",
                    pendingSignupId);
            return null;
        }
        PendingSignupService.PendingSignup p = maybe.get();

        // Idempotency: another delivery already provisioned this signup.
        if ("PROVISIONED".equals(p.status())) {
            log.info("provisionFromPending({}) — already PROVISIONED tenant={} (from {}); no-op",
                    pendingSignupId, p.tenantId(), triggerEvent);
            return p.tenantId();
        }
        // Anything else terminal (FAILED / EXPIRED / CANCELLED) — refuse.
        if (!"AWAITING_MANDATE".equals(p.status())) {
            log.warn("provisionFromPending({}) — refuse: status={} (event={})",
                    pendingSignupId, p.status(), triggerEvent);
            return null;
        }

        // Orphan-tenant recovery. Downstream INSERTs into
        // platform.subscriptions are NOT in the same transaction as
        // writer.signup (writer.signup runs in its own tx to satisfy RLS —
        // see class-level javadoc). If the subscription INSERT failed on a
        // prior delivery, writer.signup already committed a tenant row for
        // this subdomain, but pending is still AWAITING_MANDATE. A naive
        // retry would call writer.signup again and 409 on the unique index
        // on platform.tenants(lower(subdomain)) — the classic "orphan
        // tenant, cannot heal itself" trap.
        //
        // Detect that here: if a tenant already exists for this subdomain,
        // skip the writer and reuse the existing tenant_id. The downstream
        // subscription INSERT below is already idempotent (ON CONFLICT on
        // razorpay_subscription_id), so on the next webhook retry the whole
        // path completes.
        UUID tenantId = findExistingTenantId(p.subdomain());
        boolean isRecovery = tenantId != null;

        if (isRecovery) {
            log.warn("provisionFromPending({}) — RECOVERY: tenant={} already exists for subdomain '{}' " +
                     "(prior attempt died between writer.signup and subscription INSERT); " +
                     "skipping writer and completing downstream inserts",
                    pendingSignupId, tenantId, p.subdomain());
        } else {
            try {
                SignupResponse resp = saas.provisionFromPending(
                        p.accountId(),
                        p.passwordHash(),
                        p.companyName(),
                        p.subdomain(),
                        p.adminName(),
                        p.email(),
                        p.phone(),
                        p.country(),
                        p.timezone(),
                        p.currency(),
                        p.planKeys());
                tenantId = resp.tenantId();
            } catch (Exception e) {
                pending.markFailed(pendingSignupId,
                        "provisioning failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
                log.error("provisionFromPending({}) — createWorkspace threw: {}", pendingSignupId, e.getMessage(), e);
                throw e;   // let the webhook handler log + let the ledger show FAILED so ops can inspect
            }
        }

        // Mirror optional company/tax details onto platform.tenants (columns
        // added in this migration). Do it here rather than in SaasWriter to
        // avoid changing the writer's signature — small nullable UPDATE.
        if (anyTaxField(p)) {
            jdbc.update("""
                    UPDATE platform.tenants SET
                        pan            = COALESCE(?, pan),
                        gstin          = COALESCE(?, gstin),
                        address_line1  = COALESCE(?, address_line1),
                        address_line2  = COALESCE(?, address_line2),
                        city           = COALESCE(?, city),
                        state          = COALESCE(?, state),
                        postal_code    = COALESCE(?, postal_code)
                     WHERE id = ?
                    """,
                    p.pan(), p.gstin(), p.addressLine1(), p.addressLine2(),
                    p.city(), p.state(), p.postalCode(), tenantId);
        }

        // Insert the durable subscription row keyed by razorpay_subscription_id.
        // Idempotent by that key — if a duplicate event beats us here, the
        // ON CONFLICT-driven no-op keeps the first insert's amounts intact.
        Long currentEnd = optLong(subscriptionEntity, "current_end");
        Long chargeAt   = optLong(subscriptionEntity, "charge_at");
        String method  = optStr(subscriptionEntity,  "payment_method");

        String initialStatus;
        String planType;
        if ("TRIAL".equalsIgnoreCase(p.mode())) {
            initialStatus = "TRIALING";
            planType      = "TRIAL";
        } else {
            initialStatus = "ACTIVE";
            planType      = "PAID";
        }

        BigDecimal unitInr = BigDecimal.ZERO;   // filled in later when subscription.charged carries the amount
        jdbc.update("""
                INSERT INTO platform.subscriptions
                    (id, tenant_id, subdomain, contact_email, plan_keys, modules, seats,
                     billing_cycle, unit_price_inr, amount_inr, currency, status,
                     current_period_start, current_period_end, next_charge_at,
                     razorpay_subscription_id, auto_renew, payment_method,
                     pending_signup_id, plan_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'INR', ?,
                        now(), COALESCE(to_timestamp(?), now()), to_timestamp(?),
                        ?, TRUE, ?, ?, ?, now(), now())
                ON CONFLICT (razorpay_subscription_id)
                    WHERE razorpay_subscription_id IS NOT NULL DO NOTHING
                """,
                UUID.randomUUID(), tenantId, p.subdomain(), p.email(),
                p.planKeys().toArray(new String[0]),
                p.planKeys().toArray(new String[0]),   // modules snapshot; catalog expansion lives on tenant_modules
                p.seats(),
                // platform.subscriptions.billing_cycle CHECK requires uppercase
                // ('MONTHLY' | 'ANNUAL'); pending_signups.billing_cycle stores the
                // lowercase Razorpay period ('monthly' | 'yearly'). Map here rather
                // than at stash time so pending_signups keeps its own CHECK intact.
                mapCycleToSubscriptions(p.billingCycle()), unitInr,
                initialStatus,
                currentEnd, chargeAt,
                p.razorpaySubscriptionId(), method,
                pendingSignupId, planType);

        pending.markProvisioned(pendingSignupId, tenantId);

        // Publish the welcome-email event only after markProvisioned
        // succeeds. If any of the intervening steps (writer.signup,
        // tenants pan/gstin UPDATE, subscriptions INSERT) failed, we
        // never reach here and the user does NOT get a "workspace ready"
        // email for a broken workspace. On the orphan-recovery branch
        // the workspace already exists — the customer never got the
        // email on the first attempt, so firing it here (once) is right.
        //
        // Wrapped: mail-side failure must NEVER fail the webhook
        // handler; ops can resend from the audit trail.
        try {
            saas.publishWorkspaceCreated(saas.buildWorkspaceCreatedEvent(
                    tenantId, p.accountId(), p.subdomain(),
                    p.adminName(), p.email(), p.companyName(),
                    p.planKeys()));
        } catch (Exception mailErr) {
            log.warn("provisionFromPending({}) — welcome-event publish failed (workspace is fine, email skipped): {}",
                    pendingSignupId, mailErr.getMessage());
        }

        log.info("provisionFromPending({}) OK  tenant={} status={} sub={} trigger={} recovery={}",
                pendingSignupId, tenantId, initialStatus, p.razorpaySubscriptionId(), triggerEvent, isRecovery);
        return tenantId;
    }

    /**
     * Look for an existing tenant claim on {@code subdomain}, returning its
     * id or {@code null} if the row is absent. Used by the orphan-tenant
     * recovery path — see {@link #provisionFromPending}. Case-insensitive
     * match on {@code lower(subdomain)}, mirroring the writer's uniqueness
     * contract.
     */
    private UUID findExistingTenantId(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) return null;
        try {
            return jdbc.queryForObject(
                    "SELECT id FROM platform.tenants WHERE lower(subdomain) = lower(?)",
                    UUID.class, subdomain);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    /**
     * Apply the 7-day grace window to a HALTED subscription. Called from
     * the webhook's {@code subscription.halted} handler.
     */
    public void applyGrace(String razorpaySubscriptionId, Instant now) {
        Timestamp graceUntil = Timestamp.from(now.plusSeconds(7L * 24 * 3600));
        int rows = jdbc.update("""
                UPDATE platform.subscriptions
                   SET grace_until = COALESCE(grace_until, ?),
                       updated_at  = now()
                 WHERE razorpay_subscription_id = ?
                """, graceUntil, razorpaySubscriptionId);
        if (rows > 0) log.info("grace window set for subscription {} until {}", razorpaySubscriptionId, graceUntil);
    }

    // -- helpers --------------------------------------------------------------

    private static boolean anyTaxField(PendingSignupService.PendingSignup p) {
        return notBlank(p.pan()) || notBlank(p.gstin()) ||
               notBlank(p.addressLine1()) || notBlank(p.addressLine2()) ||
               notBlank(p.city()) || notBlank(p.state()) || notBlank(p.postalCode());
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    /**
     * Two tables, two casing conventions:
     *   platform.pending_signups.billing_cycle  CHECK IN ('monthly','yearly')  (Razorpay period)
     *   platform.subscriptions.billing_cycle    CHECK IN ('MONTHLY','ANNUAL')  (our enum)
     * Historical accident; mapping here keeps both CHECKs valid.
     */
    private static String mapCycleToSubscriptions(String pendingCycle) {
        if (pendingCycle == null) return "MONTHLY";
        return switch (pendingCycle.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "yearly", "annual" -> "ANNUAL";
            case "monthly", "month" -> "MONTHLY";
            default -> "MONTHLY";   // safe default; CHECK will still accept it
        };
    }

    private static String optStr(JsonNode n, String field) {
        if (n == null) return null;
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Long optLong(JsonNode n, String field) {
        if (n == null) return null;
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asLong();
    }
}
