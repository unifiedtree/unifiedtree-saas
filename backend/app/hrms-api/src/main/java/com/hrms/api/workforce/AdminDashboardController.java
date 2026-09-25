package com.hrms.api.workforce;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/admin/dashboard")
public class AdminDashboardController {
    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope teamScope;
    public AdminDashboardController(JdbcTemplate jdbc, TeamEmployeeScope teamScope) { this.jdbc = jdbc; this.teamScope = teamScope; }

    /**
     * Top-rated people. Company-wide ratings are HR's view (performance.write);
     * a manager holding only performance.read sees their own team — the same
     * team rule attendance approvals use — never the whole company's ratings.
     */
    @GetMapping("/performers")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> performers(@RequestParam UUID companyId,
                                                @AuthenticationPrincipal Jwt jwt,
                                                Authentication auth) {
        List<Object> args = new ArrayList<>(List.of(TenantContext.requireTenantId(), companyId));
        String teamFilter = "";
        if (!hasAuthority(auth, "hrms.performance.write")) {
            List<UUID> team = team(jwt);
            if (team.isEmpty()) return List.of();
            teamFilter = " AND e.id IN (" + String.join(",", Collections.nCopies(team.size(), "?")) + ")";
            args.addAll(team);
        }
        // department: the person's current department name (null when they have none).
        return jdbc.queryForList("""
            SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, d.name AS department,
                   round(avg(r.overall_rating)::numeric, 2) AS rating, count(*) AS reviews
            FROM performance_mgmt.performance_reviews r
            JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
            LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
            WHERE r.tenant_id = ? AND e.company_id = ? AND r.status IN ('SUBMITTED','ACKNOWLEDGED') AND r.overall_rating IS NOT NULL
            """ + teamFilter + """
             GROUP BY e.id, e.first_name, e.last_name, d.name ORDER BY rating DESC, name LIMIT 5
            """, args.toArray());
    }

    /**
     * New joiners' onboarding progress — an HR/admin view. instance.read is held
     * by every employee (to see their OWN onboarding), so it can't guard a
     * company-wide list; instance.write is the HR/admin marker OnboardingController
     * uses for the same distinction.
     */
    @GetMapping("/onboarding")
    @PreAuthorize("hasAuthority('hrms.onboarding.instance.write')")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> onboarding(@RequestParam UUID companyId) {
        return jdbc.queryForList("""
            SELECT i.id, concat_ws(' ', e.first_name, e.last_name) AS name, i.status,
                   count(t.id) AS total, count(t.id) FILTER (WHERE t.status IN ('COMPLETED','SKIPPED')) AS completed
            FROM hrms.onboarding_instances i
            JOIN hrms.employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
            LEFT JOIN hrms.onboarding_instance_tasks t ON t.instance_id = i.id AND t.tenant_id = i.tenant_id
            WHERE i.tenant_id = ? AND e.company_id = ? AND i.status <> 'COMPLETED'
            GROUP BY i.id, e.first_name, e.last_name ORDER BY i.started_at DESC LIMIT 5
            """, TenantContext.requireTenantId(), companyId);
    }
    @GetMapping("/hiring")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    @Transactional(readOnly = true)
    public Map<String, Object> hiring(@RequestParam UUID companyId) {
        UUID tenant = TenantContext.requireTenantId();
        Long jobs = jdbc.queryForObject("SELECT count(*) FROM hiring_mgmt.job_requisitions WHERE tenant_id = ? AND company_id = ? AND status = 'OPEN'", Long.class, tenant, companyId);
        var stages = jdbc.queryForList("""
            SELECT c.stage, count(*) AS count FROM hiring_mgmt.candidates c
            JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
            WHERE c.tenant_id = ? AND r.company_id = ? GROUP BY c.stage ORDER BY c.stage
            """, tenant, companyId);
        return Map.of("openJobs", jobs == null ? 0 : jobs, "stages", stages);
    }

    private List<UUID> team(Jwt jwt) {
        try {
            return teamScope.resolve(jwt, null).stream().map(Employee::getId).toList();
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    private static boolean hasAuthority(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }
}
