package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

@RestController
@RequestMapping("/v1/ess/timesheets")
@PreAuthorize("hasAuthority('attendance.checkin.self')")
public class TimeEntryController {
    private final JdbcTemplate jdbc;
    public TimeEntryController(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public record Input(@NotNull LocalDate workDate, @NotBlank @Size(max=1000) String description, @Min(1) @Max(1440) int minutes) {}
    private UUID employee(Jwt jwt, boolean lock) {
        String claim=jwt.getClaimAsString("employee_id");
        UUID id=UUID.fromString(claim==null?jwt.getSubject():claim);
        var found=jdbc.queryForList("SELECT id FROM hrms.employees WHERE id=? AND tenant_id=?"+(lock?" FOR UPDATE":""),UUID.class,id,TenantContext.requireTenantId());
        if(found.isEmpty()) throw new BusinessRuleException("Employee profile required","EMPLOYEE_NOT_FOUND");
        return id;
    }
    @GetMapping
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to) {
        if(to.isBefore(from)||to.isAfter(from.plusDays(366))) throw new BusinessRuleException("Choose a date range of at most one year","TIME_RANGE_INVALID");
        return jdbc.queryForList("SELECT id,work_date AS \"workDate\",description,minutes FROM hrms.time_entries WHERE tenant_id=? AND employee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC,created_at DESC",TenantContext.requireTenantId(),employee(jwt,false),from,to);
    }
    private void validate(UUID employee,Input input,UUID excluded) {
        if(input.workDate().isAfter(LocalDate.now(ZoneId.of("Asia/Kolkata")))) throw new BusinessRuleException("Time cannot be logged for a future date","TIME_DATE_INVALID");
        Integer total=jdbc.queryForObject("SELECT COALESCE(sum(minutes),0)::integer FROM hrms.time_entries WHERE tenant_id=? AND employee_id=? AND work_date=? AND id<>?",Integer.class,TenantContext.requireTenantId(),employee,input.workDate(),excluded);
        if(total+input.minutes()>1440) throw new BusinessRuleException("Daily entries cannot exceed 24 hours","TIME_LIMIT_EXCEEDED");
    }
    @PostMapping
    @Transactional
    public Map<String,Object> create(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody Input input) {
        UUID employee=employee(jwt,true); validate(employee,input,new UUID(0,0));
        return jdbc.queryForMap("INSERT INTO hrms.time_entries(tenant_id,employee_id,work_date,description,minutes) VALUES(?,?,?,?,?) RETURNING id",TenantContext.requireTenantId(),employee,input.workDate(),input.description().trim(),input.minutes());
    }
    @PutMapping("/{id}")
    @Transactional
    public Map<String,Boolean> update(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id,@Valid @RequestBody Input input) {
        UUID employee=employee(jwt,true); validate(employee,input,id);
        int changed=jdbc.update("UPDATE hrms.time_entries SET work_date=?,description=?,minutes=?,updated_at=now() WHERE id=? AND tenant_id=? AND employee_id=?",input.workDate(),input.description().trim(),input.minutes(),id,TenantContext.requireTenantId(),employee);
        if(changed!=1) throw new BusinessRuleException("Time entry not found","TIME_ENTRY_NOT_FOUND");
        return Map.of("saved",true);
    }
    @DeleteMapping("/{id}")
    @Transactional
    public Map<String,Boolean> delete(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id) {
        UUID employee=employee(jwt,true);
        int changed=jdbc.update("DELETE FROM hrms.time_entries WHERE id=? AND tenant_id=? AND employee_id=?",id,TenantContext.requireTenantId(),employee);
        if(changed!=1) throw new BusinessRuleException("Time entry not found","TIME_ENTRY_NOT_FOUND");
        return Map.of("deleted",true);
    }
}
