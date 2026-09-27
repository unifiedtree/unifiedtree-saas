package com.hrms.api.team;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Who holds a permission, by permission rather than by role name: the active
 * people (with an employee record) whose roles grant it, plus per-person
 * grants, minus per-person denials (the same sources PermissionChecker reads).
 */
@Component
public class PermissionHolders {

    private final JdbcTemplate jdbc;

    public PermissionHolders(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Employee ids of the active people in this tenant who hold {@code permission}. Call inside a transaction. */
    public List<UUID> employeesHolding(UUID tenantId, String permission) {
        return jdbc.queryForList("""
                SELECT DISTINCT uc.employee_id
                  FROM auth.user_credentials uc
                  JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
                 WHERE uc.tenant_id = ? AND uc.is_active = TRUE AND uc.employee_id IS NOT NULL
                   AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')
                   AND (EXISTS (SELECT 1 FROM rbac.user_roles ur
                                  JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                                 WHERE ur.tenant_id = uc.tenant_id AND ur.user_id = uc.id AND rp.permission_code = ?)
                        OR EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                    WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                      AND o.effect = 'GRANT' AND (o.expires_at IS NULL OR o.expires_at > now())))
                   AND NOT EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                    WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                      AND o.effect = 'DENY' AND (o.expires_at IS NULL OR o.expires_at > now()))
                """, UUID.class, tenantId, permission, permission, permission);
    }
}
