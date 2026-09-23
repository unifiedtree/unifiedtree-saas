package com.hrms.api.attendance;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/v1/team/schedule")
public class TeamScheduleController {
 private final TeamEmployeeScope scope;
 private final NamedParameterJdbcTemplate jdbc;
 public TeamScheduleController(TeamEmployeeScope scope, NamedParameterJdbcTemplate jdbc) { this.scope=scope;this.jdbc=jdbc; }
 @GetMapping
 @PreAuthorize("hasAuthority('attendance.team.read')")
 @Transactional(readOnly=true)
 public List<Map<String,Object>> schedule(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to) {
   if(to.isBefore(from)||to.isAfter(from.plusDays(30))) throw new BusinessRuleException("Choose up to 31 days","SCHEDULE_RANGE_INVALID");
   var employees=scope.resolve(jwt,null);
   if(employees.isEmpty())return List.of();
   return jdbc.queryForList("""
    SELECT e.id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
      d.day::date AS date,s.name AS "shiftName",s.start_time AS "startTime",s.end_time AS "endTime"
    FROM hrms.employees e
    CROSS JOIN generate_series(CAST(:from AS date),CAST(:to AS date),interval '1 day') d(day)
    LEFT JOIN LATERAL (
      SELECT a.shift_policy_id FROM attendance.employee_shift_assignments a
      WHERE a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.effective_from<=d.day::date
        AND (a.effective_to IS NULL OR a.effective_to>=d.day::date)
      ORDER BY a.effective_from DESC,a.created_at DESC LIMIT 1
    ) assignment ON true
    LEFT JOIN attendance.shift_policies s ON s.id=assignment.shift_policy_id AND s.tenant_id=e.tenant_id
    WHERE e.tenant_id=:tenant AND e.id IN (:employees)
    ORDER BY e.first_name,e.last_name,e.id,d.day
    """,Map.of("from",from,"to",to,"tenant",TenantContext.requireTenantId(),"employees",employees.stream().map(e->e.getId()).toList()));
 }
}
