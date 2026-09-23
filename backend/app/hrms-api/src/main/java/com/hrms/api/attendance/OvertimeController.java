package com.hrms.api.attendance;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/v1/attendance/overtime")
public class OvertimeController {
 private final TeamEmployeeScope scope;
 private final JdbcTemplate jdbc;
 private final NamedParameterJdbcTemplate named;
 public OvertimeController(TeamEmployeeScope scope,JdbcTemplate jdbc,NamedParameterJdbcTemplate named) {this.scope=scope;this.jdbc=jdbc;this.named=named;}
 public record Decision(@Size(max=1000) String note) {}
 @GetMapping
 @PreAuthorize("hasAuthority('attendance.team.read')")
 @Transactional(readOnly=true)
 public Map<String,Object> list(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to,@RequestParam(defaultValue="0") int page) {
  if(to.isBefore(from)||to.isAfter(from.plusDays(366))||page<0||page>100000) throw new BusinessRuleException("Invalid overtime range or page","OVERTIME_RANGE_INVALID");
  var employees=scope.resolve(jwt,null).stream().map(e->e.getId()).toList();
  if(employees.isEmpty())return Map.of("content",List.of(),"totalElements",0);
  var params=Map.of("tenant",TenantContext.requireTenantId(),"employees",employees,"from",from,"to",to,"offset",page*20);
  String where=" WHERE r.tenant_id=:tenant AND r.employee_id IN (:employees) AND r.attendance_date BETWEEN :from AND :to AND r.overtime_minutes>0 AND r.check_out_at IS NOT NULL";
  var content=named.queryForList("""
   SELECT r.id,r.employee_id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
    r.attendance_date AS date,r.overtime_minutes AS minutes,
    CASE WHEN d.reviewed_minutes=r.overtime_minutes THEN d.status ELSE 'PENDING' END AS status,
    d.note,d.decided_at AS "decidedAt",concat_ws(' ',reviewer.first_name,reviewer.last_name) AS "decidedBy"
   FROM attendance.records r JOIN hrms.employees e ON e.id=r.employee_id AND e.tenant_id=r.tenant_id
   LEFT JOIN attendance.overtime_decisions d ON d.record_id=r.id AND d.tenant_id=r.tenant_id
   LEFT JOIN hrms.employees reviewer ON reviewer.id=d.decided_by AND reviewer.tenant_id=r.tenant_id
   """+where+" ORDER BY r.attendance_date DESC,e.first_name,r.id LIMIT 20 OFFSET :offset",params);
  Long count=named.queryForObject("SELECT count(*) FROM attendance.records r"+where,params,Long.class);
  return Map.of("content",content,"totalElements",count);
 }
 @PostMapping("/{id}/approve")
 @PreAuthorize("hasAuthority('attendance.overtime.approve')")
 @Transactional
 public Map<String,String> approve(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id,@Valid @RequestBody Decision input) {return decide(jwt,id,input,"APPROVED");}
 @PostMapping("/{id}/reject")
 @PreAuthorize("hasAuthority('attendance.overtime.approve')")
 @Transactional
 public Map<String,String> reject(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id,@Valid @RequestBody Decision input) {
  if(input.note()==null||input.note().isBlank())throw new BusinessRuleException("Explain why overtime is rejected","OVERTIME_REASON_REQUIRED");
  return decide(jwt,id,input,"REJECTED");
 }
 private Map<String,String> decide(Jwt jwt,UUID id,Decision input,String status) {
  UUID tenant=TenantContext.requireTenantId();
  var rows=jdbc.queryForList("SELECT employee_id,overtime_minutes,attendance_date FROM attendance.records WHERE id=? AND tenant_id=? AND overtime_minutes>0 AND check_out_at IS NOT NULL FOR UPDATE",id,tenant);
  if(rows.isEmpty())throw new BusinessRuleException("Completed overtime record not found","OVERTIME_NOT_FOUND");
  UUID employee=(UUID)rows.getFirst().get("employee_id");
  if(scope.resolve(jwt,null).stream().noneMatch(e->e.getId().equals(employee)))throw new BusinessRuleException("Employee is outside your approval scope","OVERTIME_SCOPE_DENIED");
  int minutes=((Number)rows.getFirst().get("overtime_minutes")).intValue();
  if(jdbc.queryForObject("SELECT count(*) FROM attendance.overtime_decisions WHERE tenant_id=? AND record_id=? AND reviewed_minutes=?",Integer.class,tenant,id,minutes)>0)throw new BusinessRuleException("This overtime has already been reviewed","OVERTIME_ALREADY_REVIEWED");
  UUID actor=UUID.fromString(jwt.getClaimAsString("employee_id")!=null?jwt.getClaimAsString("employee_id"):jwt.getSubject());
  jdbc.update("""
   INSERT INTO attendance.overtime_decisions(tenant_id,record_id,status,reviewed_minutes,decided_by,note,record_date)
   VALUES(?,?,?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET status=excluded.status,reviewed_minutes=excluded.reviewed_minutes,
    decided_by=excluded.decided_by,note=excluded.note,decided_at=now()
   """,tenant,id,status,minutes,actor,input.note(),rows.getFirst().get("attendance_date"));
  return Map.of("status",status);
 }
}
