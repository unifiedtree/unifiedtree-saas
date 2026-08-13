package com.hrms.api.rbac;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Boot-time invariant check: the OWNER role
 * ({@code 00000000-0000-0000-0000-000000000010}) MUST have every non-platform
 * permission in the {@code rbac.permissions} catalog. If any are missing, the
 * backend refuses to serve traffic.
 *
 * <p><b>Why this exists (added 2026-08-13):</b> in the 6 months prior, this
 * exact bug class recurred four times — a developer adds a new permission in
 * a migration, grants it to SUPER_ADMIN and HR_MANAGER, forgets OWNER. The
 * SPA hides features gated on missing OWNER perms (invitation email checkbox,
 * payroll admin, letters distribute, etc.), so the workspace owner silently
 * loses functionality and only finds out via a support ticket. Latest
 * incident: {@code hrms.employee.invite} was ungranted — a customer's
 * teammate reported "when I create an employee, no email arrives", fixed
 * via V094 backfill of 20 missing perms.
 *
 * <p><b>How this ends the bug class:</b> if a future migration adds a
 * permission but forgets to grant it to OWNER, this check fires on the next
 * Cloud Run boot, throws {@link IllegalStateException} with the exact list
 * of missing codes, and Cloud Run's startup probe fails. The new revision
 * never receives traffic; the old revision continues to serve. The developer
 * sees the error in Cloud Logs, writes a one-line backfill migration
 * ({@code V<next>__owner_backfill_<slug>.sql}), and redeploys. Zero customer
 * impact.
 *
 * <p><b>What is NOT enforced (intentional):</b>
 * <ul>
 *   <li>SUPER_ADMIN / HR_MANAGER / DEPT_MANAGER / FINANCE_LEAD / EMPLOYEE
 *       role grants — these are legitimately narrower than OWNER by design.
 *       Adding them here would over-constrain reasonable per-role scoping.</li>
 *   <li>{@code platform.*} permissions — those are platform-admin only
 *       (tenant management, subscription reconciliation, etc.) and are
 *       deliberately NOT granted to OWNER. The V064/V094 backfill excluded
 *       them explicitly and so does this check.</li>
 * </ul>
 *
 * <p><b>Fails-open on DB blips:</b> a {@link DataAccessException} at boot
 * (network hiccup, replica lag, cold connection) does NOT fail the boot —
 * it logs a WARN. Only a definitive "missing permissions" verdict crashes
 * boot. This trades a slightly weaker guarantee for not turning transient
 * DB issues into full outages.
 *
 * <p><b>RLS safety:</b> the query filters on
 * {@code role_id = OWNER_ROLE_ID} which is a system role with
 * {@code tenant_id IS NULL}. The {@code role_permissions_visibility} policy
 * on {@code rbac.role_permissions} permits reads for
 * {@code r.tenant_id IS NULL OR r.tenant_id = current_tenant_id()}, so no
 * {@code SET LOCAL app.tenant_id} ceremony is needed. Verified live on
 * 2026-08-13 (139 grants visible as {@code ut_app} at boot).
 */
@Component
public class OwnerPermissionInvariantCheck {

    private static final Logger log = LoggerFactory.getLogger(OwnerPermissionInvariantCheck.class);

    /** System OWNER role UUID (seeded by V035; unchanged since). */
    static final String OWNER_ROLE_ID = "00000000-0000-0000-0000-000000000010";

    private final JdbcTemplate jdbc;

    public OwnerPermissionInvariantCheck(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Runs once the Spring context is fully wired (all beans initialised,
     * DataSource proven). Deliberately ordered LOWEST_PRECEDENCE so that if
     * some other {@code ApplicationReadyEvent} listener needs to run before
     * we make a hard boot decision, it can.
     */
    @EventListener(ApplicationReadyEvent.class)
    @Order(Integer.MAX_VALUE)
    public void assertOwnerHasAllNonPlatformPerms() {
        final List<String> missing;
        try {
            missing = jdbc.queryForList(
                    // Any non-platform permission that has no matching row in
                    // role_permissions for OWNER. Ordered so the error message
                    // is deterministic and easy to grep in logs.
                    "SELECT p.code FROM rbac.permissions p " +
                    "WHERE p.module <> 'platform' " +
                    "  AND NOT EXISTS ( " +
                    "        SELECT 1 FROM rbac.role_permissions rp " +
                    "         WHERE rp.role_id = ?::uuid " +
                    "           AND rp.permission_code = p.code) " +
                    "ORDER BY p.code",
                    String.class,
                    OWNER_ROLE_ID);
        } catch (DataAccessException e) {
            // Fail-open on DB blips — see class Javadoc rationale. This is
            // deliberately different from a "missing perms" verdict below.
            log.warn("OwnerPermissionInvariantCheck: could not query rbac.permissions " +
                    "at boot (DataAccessException). Skipping the check for this replica. " +
                    "Underlying: {}", e.getMessage());
            return;
        }

        if (missing.isEmpty()) {
            log.info("OwnerPermissionInvariantCheck: PASS — OWNER role has every " +
                    "non-platform permission in the rbac.permissions catalog.");
            return;
        }

        // Hard failure — throw so Spring's ApplicationRunner reports the boot
        // failure. Cloud Run's startup probe will then fail, keeping the old
        // revision live and alerting the operator with the exact fix.
        String msg = String.format(
                "OwnerPermissionInvariantCheck: FAIL — OWNER role (%s) is missing %d " +
                "non-platform permissions: %s. Add them via a new migration " +
                "V<next>__owner_perm_backfill.sql BEFORE this backend can serve traffic. " +
                "See com.hrms.api.rbac.OwnerPermissionInvariantCheck javadoc for context.",
                OWNER_ROLE_ID, missing.size(), missing);
        log.error(msg);
        throw new IllegalStateException(msg);
    }
}
