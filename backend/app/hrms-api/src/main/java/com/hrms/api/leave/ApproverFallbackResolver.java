package com.hrms.api.leave;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Terminal approver fallback (audit P0-1, Layer 3/4). When a leave applicant has
 * neither a reporting manager nor a department head, route the request to a real
 * person instead of persisting a null approver (which made the request invisible
 * to every approval queue on a fresh tenant).
 *
 * <p>Resolution order, returning an EMPLOYEE id (leave_requests.approver_id stores
 * the approver's employee id, matched against the JWT employee_id claim by the
 * approval queue): first any active HR_MANAGER, then any active SUPER_ADMIN.
 * The lookup joins rbac.user_roles → auth.user_credentials.employee_id and runs
 * under the request's RLS tenant scope.
 */
@Component
public class ApproverFallbackResolver {

    // System role ids (seeded in V004, tenant_id NULL).
    private static final UUID HR_MANAGER  = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID SUPER_ADMIN = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final JdbcTemplate jdbc;

    public ApproverFallbackResolver(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Employee id of a terminal approver for {@code tenantId}, or empty if the tenant has neither an HR manager nor an admin with a linked employee record. */
    public Optional<UUID> resolveTerminalApprover(UUID tenantId) {
        UUID hr = firstEmployeeWithRole(tenantId, HR_MANAGER);
        if (hr != null) return Optional.of(hr);
        return Optional.ofNullable(firstEmployeeWithRole(tenantId, SUPER_ADMIN));
    }

    /**
     * Redirect through any active delegation. A submit for approver X on the
     * given date returns X's active delegate if one exists — the "I'm on
     * leave, my approvals go to Alice" flow. Chains are followed but capped at
     * three hops (an operator can accidentally build a cycle; three is enough
     * for realistic cover-for-the-cover cases and stops runaway lookups).
     * Falls back to the original id on any error.
     */
    public UUID redirectIfDelegated(UUID approverEmployeeId, java.time.LocalDate onDate) {
        if (approverEmployeeId == null || onDate == null) return approverEmployeeId;
        UUID current = approverEmployeeId;
        java.util.Set<UUID> visited = new java.util.HashSet<>();
        for (int hop = 0; hop < 3; hop++) {
            if (!visited.add(current)) return current;
            UUID next;
            try {
                next = jdbc.query("""
                        SELECT delegate_id
                          FROM platform.approver_delegations
                         WHERE delegator_id = ?
                           AND from_date <= ? AND to_date >= ?
                         ORDER BY created_at DESC
                         LIMIT 1
                        """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                        current, java.sql.Date.valueOf(onDate), java.sql.Date.valueOf(onDate));
            } catch (Exception ex) {
                return current;
            }
            if (next == null) return current;
            current = next;
        }
        return current;
    }

    private UUID firstEmployeeWithRole(UUID tenantId, UUID roleId) {
        return jdbc.query("""
            SELECT uc.employee_id
              FROM rbac.user_roles ur
              JOIN auth.user_credentials uc ON uc.id = ur.user_id
             WHERE ur.tenant_id = ?
               AND ur.role_id = ?
               AND uc.employee_id IS NOT NULL
               AND uc.is_active = TRUE
             ORDER BY uc.created_at
             LIMIT 1
            """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null, tenantId, roleId);
    }
}
