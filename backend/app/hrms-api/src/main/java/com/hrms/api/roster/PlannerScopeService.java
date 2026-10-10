package com.hrms.api.roster;

import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Who may plan which roster (D-S1, design §1.5 "Planner scope").
 * <ul>
 *   <li><b>Company-wide planner</b>: {@code attendance.roster.plan} (or publish) and
 *       {@code attendance.workforce.admin} (HR/Admin): any roster of the company, any scope.</li>
 *   <li><b>Department planner</b>: the same without {@code attendance.workforce.admin} (a department
 *       head): only rosters of the active departments of the company they head
 *       ({@code hrms.departments.department_head_employee_id}, not the departments under them, the
 *       My team rule), with only people of those departments (check E5). Heading none: 403
 *       {@code ROSTER_SCOPE}, "HR plans rosters for the company".</li>
 *   <li>Publishing needs {@code attendance.roster.publish} ({@link Actor#canPublish}).</li>
 * </ul>
 * The company is the {@code companyId} the request names (the company-access filter has checked it),
 * else the company the request runs in ({@code X-Company-Id}), else the caller's own.
 */
@Service
public class PlannerScopeService implements PlannerScope {

    private final JdbcTemplate jdbc;

    public PlannerScopeService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Actor actor(Jwt jwt, UUID companyIdIn) {
        boolean plan = RosterAuth.has(jwt, RosterAuth.PLAN);
        boolean publish = RosterAuth.has(jwt, RosterAuth.PUBLISH);
        if (!plan && !publish) throw RosterErrors.scope("You can't plan shift rosters.");
        UUID tenant = TenantContext.requireTenantId();
        UUID employeeId = RosterAuth.employeeId(jwt);
        Me me = employeeId == null ? null : me(tenant, employeeId);
        UUID companyId = companyIdIn != null ? companyIdIn
                : CompanyContext.getCompanyId() != null ? CompanyContext.getCompanyId()
                : me != null ? me.companyId() : null;
        if (companyId == null) throw RosterErrors.companyRequired();
        if (!companyKnown(tenant, companyId)) throw new ResourceNotFoundException("Company", companyId);

        boolean companyWide = RosterAuth.has(jwt, RosterAuth.WORKFORCE_ADMIN);
        Set<UUID> headed = Set.of();
        if (!companyWide) {
            headed = employeeId == null ? Set.of() : headedDepartments(tenant, companyId, employeeId);
            if (headed.isEmpty()) throw RosterErrors.scope("You don't head a department. HR plans rosters for the company.");
        }
        String name = me != null && me.name() != null && !me.name().isBlank() ? me.name() : jwt.getClaimAsString("email");
        return new Actor(RosterAuth.userId(jwt), employeeId, name, companyId, companyWide, headed, publish);
    }

    @Override
    public void check(Actor a, UUID departmentId, Collection<UUID> employeeIds) {
        if (a == null) throw RosterErrors.scope("You can't plan shift rosters.");
        if (a.companyWide()) return;
        if (departmentId == null || !a.headedDepartmentIds().contains(departmentId)) {
            throw RosterErrors.scope("Only HR can plan rosters outside the departments you head. Choose one of your departments.");
        }
        if (employeeIds == null || employeeIds.isEmpty()) return;
        List<UUID> ids = new ArrayList<>(new LinkedHashSet<>(employeeIds));
        Map<UUID, Person> people = people(TenantContext.requireTenantId(), ids);
        List<String> outside = new ArrayList<>();
        for (UUID id : ids) {
            Person p = people.get(id);
            if (p == null || p.departmentId() == null || !a.headedDepartmentIds().contains(p.departmentId())) {
                outside.add(p == null || p.name() == null || p.name().isBlank() ? "Someone" : p.name());
            }
        }
        if (!outside.isEmpty()) {
            String who = outside.size() == 1 ? outside.get(0) + " is" : outside.get(0) + " and " + (outside.size() - 1)
                    + (outside.size() == 2 ? " other are" : " others are");
            throw RosterErrors.scope(who + " outside the departments you head. Only HR can plan them.");
        }
    }

    /** Whether the planner may see and change a roster or pattern of {@code departmentId} (null = company-wide). */
    static boolean covers(Actor a, UUID departmentId) {
        return a != null && (a.companyWide() || (departmentId != null && a.headedDepartmentIds().contains(departmentId)));
    }

    // ── reads (package-visible so unit tests can stand in for the database) ───

    record Me(UUID companyId, String name) {}

    record Person(UUID departmentId, String name) {}

    boolean companyKnown(UUID tenant, UUID companyId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM org.companies WHERE id = ? AND tenant_id = ?)",
                Boolean.class, companyId, tenant));
    }

    Map<UUID, Person> people(UUID tenant, List<UUID> ids) {
        Map<UUID, Person> out = new HashMap<>();
        jdbc.query("SELECT id, department_id, concat_ws(' ', first_name, last_name) AS name FROM hrms.employees "
                        + "WHERE tenant_id = ? AND id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class),
                        new Person(rs.getObject("department_id", UUID.class), rs.getString("name"))),
                tenant, uuidArray(ids));
        return out;
    }

    Me me(UUID tenant, UUID employeeId) {
        List<Me> rows = jdbc.query("SELECT company_id, concat_ws(' ', first_name, last_name) AS name FROM hrms.employees "
                        + "WHERE id = ? AND tenant_id = ?",
                (rs, n) -> new Me(rs.getObject("company_id", UUID.class), rs.getString("name")), employeeId, tenant);
        return rows.isEmpty() ? null : rows.get(0);
    }

    Set<UUID> headedDepartments(UUID tenant, UUID companyId, UUID employeeId) {
        return new LinkedHashSet<>(jdbc.queryForList("SELECT id FROM hrms.departments WHERE tenant_id = ? AND company_id = ? "
                + "AND is_active = TRUE AND department_head_employee_id = ? ORDER BY name", UUID.class, tenant, companyId, employeeId));
    }

    /** {a,b,c} for {@code CAST(? AS uuid[])}. */
    static String uuidArray(Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }
}
