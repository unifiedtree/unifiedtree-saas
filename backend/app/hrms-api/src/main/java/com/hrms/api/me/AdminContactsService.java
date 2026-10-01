package com.hrms.api.me;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Help &amp; support (redesign BW-01, DECISIONS 11): the people in this workspace who can help with
 * access and set-up. "Admins" are decided by permission, never by a role name: the active people whose
 * access includes {@code workspace.users.manage} or {@code rbac.role.write} through a role or a
 * per-person grant, and not taken away by a per-person denial (the same sources PermissionChecker reads).
 *
 * <p>Read with JDBC over existing tables only (no schema change). Owners first, at most
 * {@value #MAX_CONTACTS}. Never a vendor name or link (white-label rule): only this workspace's people.
 */
@Service
public class AdminContactsService {

    public static final int MAX_CONTACTS = 10;
    /** The permissions that make someone a person to ask about access and set-up. */
    public static final List<String> ADMIN_PERMISSIONS = List.of("workspace.users.manage", "rbac.role.write");
    /** Shown first, in this order; every other role after them, by name. */
    static final List<String> ROLE_ORDER = List.of("OWNER", "SUPER_ADMIN", "COMPANY_ADMIN", "ADMIN", "HR_MANAGER");

    /** One contact: name, sign-in (work) email, a plain role name. */
    public record AdminContact(String name, String email, String roleLabel) {}

    /** A raw row: the login and, when it has one, its employee record and its first role by ROLE_ORDER. */
    record Row(String email, String displayName, String firstName, String lastName, String roleCode, String roleName) {}

    // The codes are constants (never request input); they're bound as parameters all the same.
    static final String SQL = """
            WITH codes(code) AS (VALUES (?), (?)),
            holders AS (
              SELECT uc.id, uc.email, uc.display_name, e.first_name, e.last_name
                FROM auth.user_credentials uc
                LEFT JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
               WHERE uc.tenant_id = ? AND uc.is_active = TRUE
                 AND (e.id IS NULL OR (e.is_active = TRUE AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')))
                 AND EXISTS (
                   SELECT 1 FROM codes c
                    WHERE (EXISTS (SELECT 1 FROM rbac.user_roles ur
                                     JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                                    WHERE ur.tenant_id = uc.tenant_id AND ur.user_id = uc.id
                                      AND (rp.permission_code = c.code OR rp.permission_code = '*'))
                           OR EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                       WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = c.code
                                         AND o.effect = 'GRANT' AND (o.expires_at IS NULL OR o.expires_at > now())))
                      AND NOT EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                       WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = c.code
                                         AND o.effect = 'DENY' AND (o.expires_at IS NULL OR o.expires_at > now())))
            )
            SELECT h.email, h.display_name, h.first_name, h.last_name, r.code AS role_code, r.display_name AS role_name
              FROM holders h
              LEFT JOIN LATERAL (
                SELECT ro.code, ro.display_name
                  FROM rbac.user_roles ur JOIN rbac.roles ro ON ro.id = ur.role_id
                 WHERE ur.tenant_id = ? AND ur.user_id = h.id
                 ORDER BY CASE ro.code WHEN 'OWNER' THEN 0 WHEN 'SUPER_ADMIN' THEN 1 WHEN 'COMPANY_ADMIN' THEN 2
                                       WHEN 'ADMIN' THEN 3 WHEN 'HR_MANAGER' THEN 4 ELSE 5 END, ro.display_name
                 LIMIT 1) r ON TRUE
            """;

    private final JdbcTemplate jdbc;

    public AdminContactsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<AdminContact> contacts(UUID tenantId) {
        if (tenantId == null) return List.of();
        List<Row> rows = jdbc.query(SQL, (rs, i) -> new Row(rs.getString("email"), rs.getString("display_name"),
                        rs.getString("first_name"), rs.getString("last_name"), rs.getString("role_code"), rs.getString("role_name")),
                ADMIN_PERMISSIONS.get(0), ADMIN_PERMISSIONS.get(1), tenantId, tenantId);
        return toContacts(rows);
    }

    /** Names and role labels, owners first, then by name; at most MAX_CONTACTS; rows without an email are left out. */
    static List<AdminContact> toContacts(List<Row> rows) {
        return rows.stream()
                .filter(r -> r.email() != null && !r.email().isBlank())
                .sorted(Comparator.comparingInt((Row r) -> rank(r.roleCode())).thenComparing(r -> name(r).toLowerCase(Locale.ROOT)))
                .limit(MAX_CONTACTS)
                .map(r -> new AdminContact(name(r), r.email().trim(), label(r)))
                .toList();
    }

    static int rank(String roleCode) {
        int i = roleCode == null ? -1 : ROLE_ORDER.indexOf(roleCode);
        return i < 0 ? ROLE_ORDER.size() : i;
    }

    /** Their chosen display name, else their employee name, else the part of the email before "@". */
    static String name(Row r) {
        if (r.displayName() != null && !r.displayName().isBlank()) return r.displayName().trim();
        String full = String.join(" ", nonBlank(r.firstName()), nonBlank(r.lastName())).trim();
        if (!full.isEmpty()) return full;
        String email = r.email() == null ? "" : r.email().trim();
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }

    static String label(Row r) {
        if (r.roleName() != null && !r.roleName().isBlank()) return r.roleName().trim();
        return null;
    }

    private static String nonBlank(String s) {
        return s == null ? "" : s.trim();
    }
}
