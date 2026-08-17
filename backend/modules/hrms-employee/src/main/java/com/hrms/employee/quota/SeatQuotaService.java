package com.hrms.employee.quota;

import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * {@code hrms.employees.is_active = true}. Workspace-owner / super-admin
 * accounts (identified by their user_credentials role grants for OWNER or
 * SUPER_ADMIN — the only two admin codes seeded in rbac.roles) are excluded
 * so the workspace's paid seat count reflects employees, not the person who
 * runs the workspace. The exclusion is by ROLE, not by employee status, so a
 * self-onboarded owner who also has an employee row is counted zero times.
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

    public SeatQuotaService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Snapshot of a workspace's seat position.
     */
    public record Usage(int purchased, int currentExcludingAdmin, int remaining) {}

    @Transactional(readOnly = true)
    public Usage getUsage(UUID tenantId) {
        int purchased = seatCap(tenantId);
        int used      = activeEmployeesExcludingAdmin(tenantId);
        int remaining = Math.max(0, purchased - used);
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
     * Count of active employees that occupy a paid seat. Excludes rows whose
     * linked user_credentials row carries a workspace-admin role
     * (SUPER_ADMIN / OWNER — the actual codes seeded in {@code rbac.roles};
     * the legacy 'COMPANY_ADMIN' literal used to be here but no such row
     * exists in canonical prod, so the filter was a dead branch that let two
     * genuine admin accounts count against the paid cap).
     * These are the people running the workspace, not employees against its
     * plan. Fail-closed semantics live in {@link SeatQuotaEnforcer}: this
     * method may throw, and the enforcer turns any such failure into a
     * {@code QUOTA_LOOKUP_FAILED} reject rather than a silent zero.
     */
    int activeEmployeesExcludingAdmin(UUID tenantId) {
        if (tenantId == null) return 0;
        Integer n = jdbc.queryForObject("""
                SELECT count(*)::int FROM hrms.employees e
                 WHERE e.tenant_id = ?
                   AND e.is_active = true
                   AND NOT EXISTS (
                       SELECT 1
                         FROM auth.user_credentials uc
                         JOIN rbac.user_roles ur ON ur.user_id = uc.id
                         JOIN rbac.roles r       ON r.id = ur.role_id
                        WHERE uc.employee_id = e.id
                          AND uc.tenant_id = e.tenant_id
                          AND r.code IN ('SUPER_ADMIN','OWNER')
                   )
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
