package com.hrms.api.workforce;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/admin/dashboard")
public class AdminDashboardController {
    private final JdbcTemplate jdbc;
    public AdminDashboardController(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @GetMapping("/performers")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> performers(@RequestParam UUID companyId) {
        return jdbc.queryForList("""
            SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name,
                   round(avg(r.overall_rating)::numeric, 2) AS rating, count(*) AS reviews
            FROM performance_mgmt.performance_reviews r
            JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
            WHERE r.tenant_id = ? AND e.company_id = ? AND r.status IN ('SUBMITTED','ACKNOWLEDGED') AND r.overall_rating IS NOT NULL
            GROUP BY e.id, e.first_name, e.last_name ORDER BY rating DESC, name LIMIT 5
            """, TenantContext.requireTenantId(), companyId);
    }
    @GetMapping("/onboarding")
    @PreAuthorize("hasAuthority('hrms.onboarding.instance.read')")
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
}
