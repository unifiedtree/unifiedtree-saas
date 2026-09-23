package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/hrms/projects")
public class ProjectController {
    private final JdbcTemplate jdbc;
    public ProjectController(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record ProjectInput(@NotNull UUID companyId, @NotBlank @Size(max=200) String name) {}
    public record TaskInput(@NotBlank @Size(max=300) String title, LocalDate dueDate) {}
    public record StatusInput(@NotBlank String status) {}
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.project.read')")
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(@RequestParam UUID companyId) {
        return jdbc.queryForList("""
            SELECT p.id,p.name,p.status,count(t.id) AS total,
              count(t.id) FILTER(WHERE t.status='DONE') AS completed
            FROM hrms.projects p LEFT JOIN hrms.project_tasks t ON t.project_id=p.id AND t.tenant_id=p.tenant_id
            WHERE p.tenant_id=? AND p.company_id=? GROUP BY p.id ORDER BY p.created_at DESC
            """, TenantContext.requireTenantId(),companyId);
    }
    @PostMapping
    @PreAuthorize("hasAuthority('hrms.project.write')")
    @Transactional
    public Map<String,Object> create(@Valid @RequestBody ProjectInput input) {
        UUID tenant=TenantContext.requireTenantId();
        if (jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id=? AND tenant_id=?",Integer.class,input.companyId(),tenant)==0) throw new BusinessRuleException("Company not found","PROJECT_COMPANY_INVALID");
        return jdbc.queryForMap("INSERT INTO hrms.projects(tenant_id,company_id,name) VALUES(?,?,?) RETURNING id,name,status",tenant,input.companyId(),input.name().trim());
    }
    private void requireProject(UUID id) {
        if (jdbc.queryForObject("SELECT count(*) FROM hrms.projects WHERE id=? AND tenant_id=?",Integer.class,id,TenantContext.requireTenantId())==0) throw new BusinessRuleException("Project not found","PROJECT_NOT_FOUND");
    }
    private String lockProject(UUID id) {
        var rows=jdbc.queryForList("SELECT status FROM hrms.projects WHERE id=? AND tenant_id=? FOR UPDATE",String.class,id,TenantContext.requireTenantId());
        if(rows.isEmpty()) throw new BusinessRuleException("Project not found","PROJECT_NOT_FOUND");
        return rows.getFirst();
    }
    @PutMapping("/{id}/status")
    @PreAuthorize("hasAuthority('hrms.project.write')")
    @Transactional
    public Map<String,String> projectStatus(@PathVariable UUID id,@Valid @RequestBody StatusInput input) {
        lockProject(id);
        if (!List.of("ACTIVE","COMPLETED","CANCELLED").contains(input.status())) throw new BusinessRuleException("Invalid project status","PROJECT_STATUS_INVALID");
        if (input.status().equals("COMPLETED") && jdbc.queryForObject("SELECT count(*) FROM hrms.project_tasks WHERE project_id=? AND tenant_id=? AND status<>'DONE'",Integer.class,id,TenantContext.requireTenantId())>0) throw new BusinessRuleException("Complete the remaining tasks first","PROJECT_TASKS_OPEN");
        jdbc.update("UPDATE hrms.projects SET status=? WHERE id=? AND tenant_id=?",input.status(),id,TenantContext.requireTenantId());
        return Map.of("status",input.status());
    }
    @GetMapping("/{id}/tasks")
    @PreAuthorize("hasAuthority('hrms.project.read')")
    @Transactional(readOnly=true)
    public List<Map<String,Object>> tasks(@PathVariable UUID id) {
        requireProject(id);
        return jdbc.queryForList("SELECT id,title,status,due_date AS \"dueDate\",completed_at AS \"completedAt\" FROM hrms.project_tasks WHERE tenant_id=? AND project_id=? ORDER BY created_at",TenantContext.requireTenantId(),id);
    }
    @PostMapping("/{id}/tasks")
    @PreAuthorize("hasAuthority('hrms.project.write')")
    @Transactional
    public Map<String,Object> addTask(@PathVariable UUID id,@Valid @RequestBody TaskInput input) {
        if(!lockProject(id).equals("ACTIVE")) throw new BusinessRuleException("Reopen the project before adding tasks","PROJECT_CLOSED");
        return jdbc.queryForMap("INSERT INTO hrms.project_tasks(tenant_id,project_id,title,due_date) VALUES(?,?,?,?) RETURNING id",TenantContext.requireTenantId(),id,input.title().trim(),input.dueDate());
    }
    @PutMapping("/tasks/{id}/status")
    @PreAuthorize("hasAuthority('hrms.project.write')")
    @Transactional
    public Map<String,String> taskStatus(@PathVariable UUID id,@Valid @RequestBody StatusInput input) {
        if (!List.of("PENDING","IN_PROGRESS","DONE").contains(input.status())) throw new BusinessRuleException("Invalid task status","TASK_STATUS_INVALID");
        var parents=jdbc.queryForList("SELECT project_id FROM hrms.project_tasks WHERE id=? AND tenant_id=?",UUID.class,id,TenantContext.requireTenantId());
        if(parents.isEmpty()) throw new BusinessRuleException("Task not found","TASK_NOT_FOUND");
        if(!lockProject(parents.getFirst()).equals("ACTIVE")) throw new BusinessRuleException("Reopen the project before changing tasks","PROJECT_CLOSED");
        int updated=jdbc.update("UPDATE hrms.project_tasks SET status=?,completed_at=CASE WHEN ?='DONE' THEN now() ELSE NULL END WHERE id=? AND tenant_id=?",input.status(),input.status(),id,TenantContext.requireTenantId());
        if(updated!=1) throw new BusinessRuleException("Task not found","TASK_NOT_FOUND");
        return Map.of("status",input.status());
    }
}
