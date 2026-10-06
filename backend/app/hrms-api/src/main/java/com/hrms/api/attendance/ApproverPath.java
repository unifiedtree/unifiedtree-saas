package com.hrms.api.attendance;

import com.unifiedtree.security.tenant.CompanyGrants;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Who a request "goes to" (V143.53 redesign: BW-23, and the timesheet week of
 * BW-36): the path the submission's notification already takes in
 * {@code DomainEventListener.resolveCorrectionApprover}, so the name shown is
 * the person who was told. The reporting manager, else the department head;
 * else the longest-serving active HR manager; else the longest-serving active
 * super admin; never the person themself.
 *
 * <p>Read in bulk (one query for the direct approvers, one per fallback role,
 * one for the names), for lists of requests.
 */
@Component
public class ApproverPath {

    private static final Logger log = LoggerFactory.getLogger(ApproverPath.class);

    /** Seeded system role ids (V004, tenant_id NULL), as DomainEventListener uses them. */
    static final UUID HR_MANAGER_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000002");
    static final UUID SUPER_ADMIN_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final JdbcTemplate jdbc;

    public ApproverPath(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The notification path's choice for one requester: the direct approver when
     * it isn't them, else the first HR manager when that isn't them, else the
     * first super admin when that isn't them, else nobody. (The first holder of a
     * role only; the next one is not tried, exactly as the notification does.)
     */
    static UUID pick(UUID requester, UUID direct, UUID firstHr, UUID firstAdmin) {
        if (direct != null && !direct.equals(requester)) return direct;
        if (firstHr != null && !firstHr.equals(requester)) return firstHr;
        return firstAdmin != null && !firstAdmin.equals(requester) ? firstAdmin : null;
    }

    /** For each requester, the employee id their request goes to (absent when nobody). */
    public Map<UUID, UUID> approversOf(Collection<UUID> requesters) {
        Map<UUID, UUID> out = new HashMap<>();
        List<UUID> ids = requesters == null ? List.of() : requesters.stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return out;
        try {
            UUID tenant = TenantContext.requireTenantId();
            Map<UUID, UUID> direct = new HashMap<>();
            Map<UUID, UUID> companyOf = new HashMap<>();
            List<Object> args = new ArrayList<>();
            args.add(tenant);
            args.addAll(ids);
            jdbc.query("""
                    SELECT e.id, e.company_id, COALESCE(e.reporting_manager_id, d.department_head_employee_id) AS approver
                      FROM hrms.employees e
                      LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                     WHERE e.tenant_id = ? AND e.id IN (%s)
                    """.formatted(in(ids.size())),
                    (RowCallbackHandler) rs -> {
                        UUID id = (UUID) rs.getObject("id");
                        direct.put(id, (UUID) rs.getObject("approver"));
                        companyOf.put(id, (UUID) rs.getObject("company_id"));
                    },
                    args.toArray());
            UUID hr = null, admin = null;
            boolean fallbackNeeded = ids.stream().anyMatch(id -> direct.get(id) == null || direct.get(id).equals(id));
            // People granted HR manager / super admin in a requester's company count for that
            // company's requests (COMPANY_ACCESS.md): the fallback is then read per company.
            boolean perCompany = fallbackNeeded && CompanyGrants.ready(jdbc);
            if (fallbackNeeded && !perCompany) {
                hr = firstWithRole(tenant, HR_MANAGER_ROLE);
                admin = firstWithRole(tenant, SUPER_ADMIN_ROLE);
            }
            Map<UUID, UUID[]> fallbackByCompany = new HashMap<>();
            for (UUID id : ids) {
                UUID d = direct.get(id);
                UUID chosen;
                if (perCompany && (d == null || d.equals(id))) {
                    UUID[] f = fallbackByCompany.computeIfAbsent(companyOf.get(id), company -> new UUID[] {
                            CompanyGrants.firstRoleHolder(jdbc, tenant, HR_MANAGER_ROLE, company, null),
                            CompanyGrants.firstRoleHolder(jdbc, tenant, SUPER_ADMIN_ROLE, company, null)});
                    chosen = pick(id, d, f[0], f[1]);
                } else {
                    chosen = pick(id, d, hr, admin);
                }
                if (chosen != null) out.put(id, chosen);
            }
        } catch (DataAccessException | IllegalStateException e) {
            log.warn("Could not work out who {} requests go to: {}", ids.size(), e.getMessage());
        }
        return out;
    }

    /** Full names of these employees ("First Last"), absent when unknown. */
    public Map<UUID, String> namesOf(Collection<UUID> employeeIds) {
        Map<UUID, String> out = new HashMap<>();
        List<UUID> ids = employeeIds == null ? List.of() : employeeIds.stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return out;
        try {
            List<Object> args = new ArrayList<>();
            args.add(TenantContext.requireTenantId());
            args.addAll(ids);
            jdbc.query("SELECT id, first_name, last_name FROM hrms.employees WHERE tenant_id = ? AND id IN (" + in(ids.size()) + ")",
                    (RowCallbackHandler) rs -> {
                        String name = AttendanceController.joinName(rs.getString("first_name"), rs.getString("last_name"));
                        if (!name.isBlank()) out.put((UUID) rs.getObject("id"), name);
                    }, args.toArray());
        } catch (DataAccessException | IllegalStateException e) {
            log.warn("Could not read {} employee names: {}", ids.size(), e.getMessage());
        }
        return out;
    }

    /** The longest-serving active holder of a role with an employee record (NotificationLookupService's query). */
    private UUID firstWithRole(UUID tenant, UUID roleId) {
        List<UUID> found = jdbc.queryForList("""
                SELECT uc.employee_id
                  FROM rbac.user_roles ur
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id
                 WHERE ur.tenant_id = ? AND ur.role_id = ?
                   AND uc.employee_id IS NOT NULL AND uc.is_active = TRUE
                 ORDER BY uc.created_at
                 LIMIT 1
                """, UUID.class, tenant, roleId);
        return found.isEmpty() ? null : found.get(0);
    }

    private static String in(int n) {
        return String.join(",", Collections.nCopies(n, "?"));
    }
}
