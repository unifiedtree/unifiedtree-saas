package com.hrms.employee.quota;

import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Single source of truth for "how many seats has this workspace paid for,
 * how many are currently used, and how many are left?".
 *
 * <p>Used by:
 * <ul>
 *   <li>{@link SeatQuotaEnforcer} — enforces on employee create.</li>
 *   <li>A frontend GET endpoint (wired by the caller) — renders the seat
 *       usage widget on the workspace overview.</li>
 * </ul>
 *
 * <p><b>Seat counting.</b> An employee occupies a seat when
 * {@code hrms.employees.is_active = true} — <em>including</em> admins.
 * Until 2026-08-22 accounts holding OWNER / SUPER_ADMIN were subtracted from
 * the used-seat count, on the theory that the person running the workspace
 * is not an employee of it. The client rejected that: an admin with an
 * employee record consumes a licence like anyone else, so billing must
 * charge for them (Anil punchlist #1, 2026-08-22). The exclusion is gone and
 * every active employee row counts exactly once.
 *
 * <p><b>Fallback cap.</b> When no subscription row exists we return
 * {@code TRIAL_FALLBACK_CAP} for trial-status workspaces (safe floor so
 * demos work) and {@code 0} for everything else — which effectively blocks
 * creation until a plan is chosen. This matches the current
 * PlanChangeService semantics where "no active subscription" means the
 * workspace has never bought anything.
 */
@Service
public class SeatQuotaService {

    private static final Logger log = LoggerFactory.getLogger(SeatQuotaService.class);

    /** Free trial workspaces get this many seats to work with before purchasing. */
    public static final int TRIAL_FALLBACK_CAP = 5;

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;

    public SeatQuotaService(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    /**
     * Snapshot of a workspace's seat position.
     *
     * <p>{@code currentExcludingAdmin} is a deprecated alias that carries the
     * same value as {@code current}. It stays on the wire so an older cached
     * frontend bundle keeps rendering while the new one rolls out; delete it
     * once no client reads it. The name is a lie as of 2026-08-22 — admins are
     * counted now — which is exactly why callers should move to {@code current}.
     */
    public record Usage(int purchased, int current, int currentExcludingAdmin, int remaining) {
        public Usage(int purchased, int current, int remaining) {
            this(purchased, current, current, remaining);
        }
    }

    @Transactional(readOnly = true)
    public Usage getUsage(UUID tenantId) {
        int purchased = seatCap(tenantId);
        int used      = activeEmployees(tenantId);
        int remaining = Math.max(0, purchased - used);

        // Grandfathered over-cap alert (Anil punchlist 2026-08-22): tenants
        // that were already past their paid cap on the day SeatQuotaEnforcer's
        // hard 402 shipped get a one-time-per-month warning nudging them to
        // set up autopay for the extras. New tenants never satisfy this
        // condition — the enforcer blocks the create that would push them
        // over — so publishing here is self-selecting. Publish is best-effort;
        // any listener failure is logged there, not here, so the read cannot
        // be broken by a broken notifier.
        //
        // TODO(billing-ceiling): remove this event + its listener + the
        // BILLING_OVER_CAP enum + the seat_overage_notifications dedup table
        // when the Razorpay ceiling flow ships (see roadmap). At that point
        // every tenant hits the 402 the moment they'd exceed cap and the
        // warning surface is redundant.
        if (purchased > 0 && used > purchased) {
            try {
                events.publishEvent(new SeatOverageDetectedEvent(tenantId, purchased, used));
            } catch (RuntimeException ex) {
                log.warn("seat overage event publish failed for tenant {}: {}",
                        tenantId, ex.getMessage());
            }
        }

        return new Usage(purchased, used, remaining);
    }

    /**
     * Convenience for the current-request tenant.
     */
    @Transactional(readOnly = true)
    public Usage getUsageForCurrentTenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) return new Usage(0, 0, 0);
        return getUsage(t);
    }

    /**
     * Purchased seat count for a workspace.
     *
     * <p>Order of precedence:
     * <ol>
     *   <li>a live billing row in {@code platform.subscriptions}
     *       (TRIALING/ACTIVE/PAST_DUE/HALTED/GRACE) — what the customer is
     *       actually paying for;</li>
     *   <li>{@code platform.tenant_modules.seats} — the older per-module
     *       ledger that predates the subscriptions table;</li>
     *   <li>{@code TRIAL_FALLBACK_CAP} if the tenant is on trial status;</li>
     *   <li>0 otherwise (blocks creation until a plan is chosen).</li>
     * </ol>
     */
    int seatCap(UUID tenantId) {
        if (tenantId == null) return 0;
        Integer billed = firstInt("""
                SELECT max(seats) FROM platform.subscriptions
                 WHERE tenant_id = ?
                   AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')
                """, tenantId);
        if (billed != null && billed > 0) return billed;

        Integer module = firstInt("""
                SELECT max(seats) FROM platform.tenant_modules
                 WHERE tenant_id = ? AND status = 'ACTIVE'
                """, tenantId);
        if (module != null && module > 0) return module;

        // Nothing on file — is this a trial workspace? If so, hand back a
        // safe demo floor. Otherwise 0 — the workspace has not bought yet.
        try {
            String planType = jdbc.queryForObject(
                    "SELECT plan_type FROM platform.tenants WHERE id = ?",
                    String.class, tenantId);
            if ("TRIAL".equalsIgnoreCase(planType)) return TRIAL_FALLBACK_CAP;
        } catch (Exception ignored) {
            // plan_type column may not exist on older schemas — fall through
        }
        return 0;
    }

    /**
     * Count of active employees that occupy a paid seat — every one of them,
     * admins included (client decision, Anil punchlist #1, 2026-08-22).
     *
     * <p>The previous implementation subtracted employees whose linked
     * {@code auth.user_credentials} row carried OWNER or SUPER_ADMIN. That
     * made the autopay subscription under-count: a five-person company whose
     * founder is also the admin was billed for four. Admins use the product,
     * so they consume a licence.
     *
     * <p>Fail-closed semantics live in {@link SeatQuotaEnforcer}: this method
     * may throw, and the enforcer turns any such failure into a
     * {@code QUOTA_LOOKUP_FAILED} reject rather than a silent zero.
     */
    int activeEmployees(UUID tenantId) {
        if (tenantId == null) return 0;
        Integer n = jdbc.queryForObject("""
                SELECT count(*)::int FROM hrms.employees e
                 WHERE e.tenant_id = ?
                   AND e.is_active = true
                """, Integer.class, tenantId);
        return n == null ? 0 : n;
    }

    /**
     * Nullable-int helper used only by {@link #seatCap(UUID)} where a missing
     * subscriptions/tenant_modules row genuinely means "not configured yet"
     * and we do want to fall through to the trial/zero rule. NEVER use this
     * for the used-seat count — the enforcer relies on that query throwing
     * so it can fail closed.
     */
    private Integer firstInt(String sql, UUID tenantId) {
        try {
            return jdbc.queryForObject(sql, Integer.class, tenantId);
        } catch (RuntimeException e) {
            log.warn("seat-cap lookup failed for tenant {}: {}", tenantId, e.getMessage());
            return null;
        }
    }
}
