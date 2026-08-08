package com.hrms.api.employee;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Refuses to create an employee once a workspace has used every seat it pays
 * for.
 *
 * <p>Until now nothing checked this anywhere: a workspace paying for 3 seats
 * could add 300 employees, all fully functional, and still be billed for 3.
 * Per-seat pricing that is never enforced is just a discount nobody asked for.
 *
 * <p><b>What counts as a seat.</b> One ACTIVE employee. Offboarding somebody
 * (is_active = false) frees their seat immediately, so a workspace that
 * replaces a leaver never has to buy extra.
 *
 * <p><b>Where the limit comes from,</b> in order:
 * <ol>
 *   <li>the seat count on a live billing row in {@code platform.subscriptions}
 *       — the number the customer is actually paying for;</li>
 *   <li>failing that, {@code platform.tenant_modules.seats}, which covers
 *       workspaces whose modules were activated before the ledger existed.</li>
 * </ol>
 *
 * <p><b>Why a zero limit does not block.</b> {@code tenant_modules.seats} was
 * only introduced with the in-workspace autopay flow, so every workspace
 * predating it has {@code 0} recorded — not because it bought nothing, but
 * because nobody ever wrote a number. Treating that 0 as a real limit would
 * have blocked 7 of 9 live workspaces from adding a single person, including
 * the Play Store reviewer tenant, which would fail Google's review. Those rows
 * were backfilled to each workspace's actual headcount (see
 * scripts/backfill_seat_limits.py), and this guard additionally treats a
 * missing/zero limit as "not configured, allow" so that a future workspace
 * created down some path that forgets to record seats fails OPEN rather than
 * bricking a paying customer. Enforcement should never be the thing that
 * breaks a workspace.
 *
 * <p>The error carries the numbers and whether the caller may fix it
 * themselves, because an admin gets sent to the plan page while an HR manager
 * — who has no access to billing — must be told to ask their admin.
 */
@Component
public class SeatLimitGuard {

    private static final Logger log = LoggerFactory.getLogger(SeatLimitGuard.class);

    /** Roles allowed to change the plan; mirrors WorkspacePlanController.requireAdmin. */
    private static final java.util.Set<String> BILLING_ROLES =
            java.util.Set.of("SUPER_ADMIN", "OWNER", "COMPANY_ADMIN");

    private final JdbcTemplate jdbc;

    public SeatLimitGuard(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @throws BusinessRuleException {@code SEAT_LIMIT_REACHED} when the
     *         workspace is already at its paid seat count
     */
    public void requireSeatAvailable(java.util.Collection<String> callerRoles) {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) return;   // no tenant bound: not our call to police

        Integer limit = seatLimit(tenantId);
        if (limit == null || limit <= 0) return;   // not configured — fail open, see class javadoc

        Integer used = jdbc.queryForObject(
                "SELECT count(*) FROM hrms.employees WHERE tenant_id = ? AND is_active",
                Integer.class, tenantId);
        int inUse = used == null ? 0 : used;
        if (inUse < limit) return;

        boolean canManageBilling = callerRoles != null && callerRoles.stream()
                .map(r -> r.startsWith("ROLE_") ? r.substring(5) : r)
                .anyMatch(BILLING_ROLES::contains);

        log.info("SEAT_LIMIT_REACHED tenant={} used={} limit={} callerCanBill={}",
                tenantId, inUse, limit, canManageBilling);

        throw new BusinessRuleException(
                canManageBilling
                    ? "You've used all " + limit + " seats on your plan. Add more seats to bring "
                      + "someone new on board."
                    : "This workspace has used all " + limit + " of its seats. Ask your workspace "
                      + "admin to add more seats before adding another employee.",
                "SEAT_LIMIT_REACHED");
    }

    /** Seats the workspace pays for, or null when nothing is recorded. */
    private Integer seatLimit(UUID tenantId) {
        Integer billed = firstInt("""
                SELECT max(seats) FROM platform.subscriptions
                 WHERE tenant_id = ?
                   AND razorpay_subscription_id IS NOT NULL
                   AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')
                """, tenantId);
        if (billed != null && billed > 0) return billed;
        return firstInt("""
                SELECT max(seats) FROM platform.tenant_modules
                 WHERE tenant_id = ? AND status = 'ACTIVE'
                """, tenantId);
    }

    private Integer firstInt(String sql, UUID tenantId) {
        try {
            return jdbc.queryForObject(sql, Integer.class, tenantId);
        } catch (RuntimeException e) {
            // Never let a billing lookup failure stop somebody doing their job.
            log.warn("seat-limit lookup failed for tenant {}: {}", tenantId, e.getMessage());
            return null;
        }
    }
}
