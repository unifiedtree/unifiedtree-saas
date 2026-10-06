package com.unifiedtree.security.tenant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Company grants in approver and alert lookups (docs/redesign/COMPANY_ACCESS.md,
 * "Who is told"): a person granted a role in a company (rbac.user_company_access)
 * counts as a holder of that role — and of its permissions — for that company's
 * people, next to the people who hold it through their normal roles.
 *
 * <p>Plain JDBC helpers, shared by the modules that look people up by role or
 * permission (the leave fallback approver, the notification lookups, the
 * permission-holder lists), none of which depends on the RBAC module. Every
 * helper only ever ADDS grantees: when the grants table is not there yet
 * (migration V143.93 not applied), when the company is unknown, or when the
 * grant read fails, the lookups are exactly what they were before.
 */
public final class CompanyGrants {

    private static final Logger log = LoggerFactory.getLogger(CompanyGrants.class);

    /** Remembered once true: the table does not go away again. */
    private static volatile boolean present;

    /**
     * The company-access kill switch ({@code unifiedtree.company-access.enforce}),
     * set by CompanyAccessService at start-up: off = grants count nowhere, so the
     * lookups are exactly what they were before company access.
     */
    private static volatile boolean enabled = true;

    private CompanyGrants() {}

    /** Turns the grant lookups on or off with the company-access kill switch. */
    public static void enabled(boolean on) {
        enabled = on;
    }

    /** Whether grants count: the kill switch is on, and rbac.user_company_access exists and may be read here. */
    public static boolean ready(JdbcTemplate jdbc) {
        if (!enabled) return false;
        if (present) return true;
        if (jdbc == null) return false;
        try {
            present = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT CASE WHEN to_regclass('rbac.user_company_access') IS NULL THEN false
                                ELSE has_table_privilege('rbac.user_company_access', 'SELECT') END
                    """, Boolean.class));
        } catch (RuntimeException e) {
            return false;
        }
        return present;
    }

    /** For tests: forget what was remembered about the tables. */
    public static void reset() {
        present = false;
        overrides = false;
        enabled = true;
    }

    /** The company of an employee record, or null (unknown id, or the read failed). */
    public static UUID companyOf(JdbcTemplate jdbc, UUID employeeId) {
        if (jdbc == null || employeeId == null) return null;
        try {
            List<UUID> rows = jdbc.queryForList("SELECT company_id FROM hrms.employees WHERE id = ?", UUID.class, employeeId);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (RuntimeException e) {
            log.warn("Could not read the company of employee {}: {}", employeeId, e.toString());
            return null;
        }
    }

    /** A {@code uuid[]} literal for {@code CAST(? AS uuid[])}. */
    static String uuidArray(List<UUID> ids) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(ids.get(i));
        }
        return sb.append('}').toString();
    }

    /**
     * Employees granted, in {@code companyId}, a role that carries
     * {@code permission} — active logins of people still working here, without
     * those with a per-person DENY of it — longest-serving first. Empty with no
     * company, before the grants table exists, or when the read fails.
     */
    public static List<UUID> employeesGrantedPermission(JdbcTemplate jdbc, UUID tenantId, String permission,
                                                        UUID companyId) {
        if (tenantId == null || permission == null || companyId == null || !ready(jdbc)) return List.of();
        boolean overrides = overridesReady(jdbc);
        List<Object> args = new ArrayList<>(List.of(tenantId, companyId, permission));
        if (overrides) args.add(permission);
        try {
            return jdbc.queryForList("""
                    SELECT uc.employee_id
                      FROM rbac.user_company_access a
                      JOIN rbac.role_permissions rp ON rp.role_id = a.role_id
                      JOIN auth.user_credentials uc ON uc.id = a.user_id AND uc.tenant_id = a.tenant_id
                      JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
                     WHERE a.tenant_id = ? AND a.company_id = ? AND rp.permission_code = ?
                       AND uc.is_active = TRUE AND uc.employee_id IS NOT NULL
                       AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')"""
                    + (overrides ? """

                       AND NOT EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                        WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                          AND o.effect = 'DENY' AND (o.expires_at IS NULL OR o.expires_at > now()))""" : "")
                    + """

                     GROUP BY uc.employee_id
                     ORDER BY min(uc.created_at)""", UUID.class, args.toArray());
        } catch (RuntimeException e) {
            log.warn("Company grants left out of the holders of {} (company={}): {}", permission, companyId, e.toString());
            return List.of();
        }
    }

    /**
     * Employees granted one of {@code roleIds} in {@code companyId} (active
     * logins), longest-serving first. Empty with no company or roles, before
     * the grants table exists, or when the read fails.
     */
    public static List<UUID> employeesGrantedRole(JdbcTemplate jdbc, UUID tenantId, List<UUID> roleIds, UUID companyId) {
        if (tenantId == null || roleIds == null || roleIds.isEmpty() || companyId == null || !ready(jdbc)) return List.of();
        try {
            return jdbc.queryForList("""
                    SELECT uc.employee_id
                      FROM rbac.user_company_access a
                      JOIN auth.user_credentials uc ON uc.id = a.user_id AND uc.tenant_id = a.tenant_id
                     WHERE a.tenant_id = ? AND a.company_id = ? AND a.role_id = ANY(CAST(? AS uuid[]))
                       AND uc.is_active = TRUE AND uc.employee_id IS NOT NULL
                     GROUP BY uc.employee_id
                     ORDER BY min(uc.created_at)""", UUID.class, tenantId, companyId, uuidArray(roleIds));
        } catch (RuntimeException e) {
            log.warn("Company grants left out of the holders of roles {} (company={}): {}", roleIds, companyId, e.toString());
            return List.of();
        }
    }

    /** Whether rbac.user_permission_overrides exists and may be read (it predates company access; checked anyway). */
    private static boolean overridesReady(JdbcTemplate jdbc) {
        if (overrides) return true;
        try {
            overrides = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT CASE WHEN to_regclass('rbac.user_permission_overrides') IS NULL THEN false
                                ELSE has_table_privilege('rbac.user_permission_overrides', 'SELECT') END
                    """, Boolean.class));
        } catch (RuntimeException e) {
            return false;
        }
        return overrides;
    }

    private static volatile boolean overrides;

    /**
     * The longest-serving active person with an employee record who holds
     * {@code roleId} — through {@code rbac.user_roles}, or through a grant in
     * {@code companyId} — other than {@code notEmployeeId} (null: anyone). With
     * no company, or before the grants table exists, this is exactly the
     * role-holder query the approver chain has always run.
     */
    public static UUID firstRoleHolder(JdbcTemplate jdbc, UUID tenantId, UUID roleId, UUID companyId, UUID notEmployeeId) {
        String not = notEmployeeId == null ? "" : " AND uc.employee_id <> ?";
        String roles = """
                SELECT uc.employee_id, uc.created_at
                  FROM rbac.user_roles ur
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id
                 WHERE ur.tenant_id = ?
                   AND ur.role_id = ?
                   AND uc.employee_id IS NOT NULL
                   AND uc.is_active = TRUE""" + not;
        List<Object> args = new ArrayList<>(List.of(tenantId, roleId));
        if (notEmployeeId != null) args.add(notEmployeeId);
        if (companyId != null && ready(jdbc)) {
            List<Object> withGrants = new ArrayList<>(args);
            withGrants.addAll(List.of(tenantId, companyId, roleId));
            if (notEmployeeId != null) withGrants.add(notEmployeeId);
            try {
                return jdbc.query("SELECT employee_id FROM (" + roles + """

                         UNION ALL
                        SELECT uc.employee_id, uc.created_at
                          FROM rbac.user_company_access a
                          JOIN auth.user_credentials uc ON uc.id = a.user_id
                         WHERE a.tenant_id = ?
                           AND a.company_id = ?
                           AND a.role_id = ?
                           AND uc.employee_id IS NOT NULL
                           AND uc.is_active = TRUE""" + not + """
                        ) holders ORDER BY created_at LIMIT 1""",
                        rs -> rs.next() ? rs.getObject(1, UUID.class) : null, withGrants.toArray());
            } catch (RuntimeException e) {
                log.warn("Company grants left out of the role-holder lookup (role={}, company={}): {}",
                        roleId, companyId, e.toString());
            }
        }
        return jdbc.query(roles + " ORDER BY uc.created_at LIMIT 1",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, args.toArray());
    }
}
