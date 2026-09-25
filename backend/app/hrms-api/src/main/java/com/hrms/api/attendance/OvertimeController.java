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
 private final OvertimeReasons reasons;
 @org.springframework.beans.factory.annotation.Autowired(required=false)
 private org.springframework.context.ApplicationEventPublisher eventPublisher;
 public OvertimeController(TeamEmployeeScope scope,JdbcTemplate jdbc,NamedParameterJdbcTemplate named,OvertimeReasons reasons) {this.scope=scope;this.jdbc=jdbc;this.named=named;this.reasons=reasons;}
 public record Decision(@Size(max=1000) String note) {}
 /** The employee's own explanation for an overtime entry. */
 public record ReasonInput(@Size(max=2000) String reason) {}
 /**
  * Details on each overtime row (V143.25): the shift in force that day and when it ended, when the person checked in and
  * out, and the reason. The reason is the employee's own (given at check-out or later), else, for a manual entry HR
  * made, the reason HR gave, else the reason on an approved fix request that set the times. The nightly auto-close marker
  * ("AUTO_CLOSED: ...") is not a reason. reasonSource says which one it is.
  */
 static final String DETAILS_SQL = """
    r.check_in_at AS "checkInAt",r.check_out_at AS "checkOutAt",
    s.name AS "shiftName",to_char(s.start_time,'HH24:MI') AS "shiftStart",to_char(s.end_time,'HH24:MI') AS "shiftEnd",
    CASE WHEN NULLIF(btrim(r.overtime_reason),'') IS NOT NULL THEN btrim(r.overtime_reason)
         WHEN r.manual_entry THEN COALESCE(NULLIF(btrim(r.manual_entry_reason),''),NULLIF(btrim(r.regularization_reason),''))
         WHEN NULLIF(btrim(r.regularization_reason),'') IS NOT NULL AND r.regularization_reason NOT LIKE 'AUTO_CLOSED%' THEN btrim(r.regularization_reason)
    END AS reason,
    CASE WHEN NULLIF(btrim(r.overtime_reason),'') IS NOT NULL THEN 'EMPLOYEE'
         WHEN r.manual_entry AND COALESCE(NULLIF(btrim(r.manual_entry_reason),''),NULLIF(btrim(r.regularization_reason),'')) IS NOT NULL THEN 'MANUAL_ENTRY'
         WHEN NULLIF(btrim(r.regularization_reason),'') IS NOT NULL AND r.regularization_reason NOT LIKE 'AUTO_CLOSED%' THEN 'FIX_REQUEST' END AS "reasonSource"
   """;
 /** The shift assignment in force on the record's date (the same rule as the team schedule). */
 static final String SHIFT_JOIN = """
   LEFT JOIN LATERAL (
     SELECT a.shift_policy_id FROM attendance.employee_shift_assignments a
     WHERE a.tenant_id=r.tenant_id AND a.employee_id=r.employee_id AND a.effective_from<=r.attendance_date
       AND (a.effective_to IS NULL OR a.effective_to>=r.attendance_date)
     ORDER BY a.effective_from DESC,a.created_at DESC LIMIT 1
   ) sa ON true
   LEFT JOIN attendance.shift_policies s ON s.id=sa.shift_policy_id AND s.tenant_id=r.tenant_id
   """;
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
    d.note,d.decided_at AS "decidedAt",NULLIF(concat_ws(' ',reviewer.first_name,reviewer.last_name),'') AS "decidedBy",
   """+DETAILS_SQL+"""
   FROM attendance.records r JOIN hrms.employees e ON e.id=r.employee_id AND e.tenant_id=r.tenant_id
   LEFT JOIN attendance.overtime_decisions d ON d.record_id=r.id AND d.tenant_id=r.tenant_id
   LEFT JOIN hrms.employees reviewer ON reviewer.id=d.decided_by AND reviewer.tenant_id=r.tenant_id
   """+SHIFT_JOIN+where+" ORDER BY r.attendance_date DESC,e.first_name,r.id LIMIT 20 OFFSET :offset",params);
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
 /**
  * The employee explains their own overtime ("Month-end closing"), while it is still waiting for a decision. The same
  * reason can also arrive with the check-out (CheckOutRequest.overtimeReason). Only the record's own employee may set it.
  */
 @PutMapping("/{id}/reason")
 @PreAuthorize("hasAuthority('attendance.checkin.self')")
 public Map<String,Object> setReason(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id,@Valid @RequestBody ReasonInput input) {
  UUID self=UUID.fromString(jwt.getClaimAsString("employee_id")!=null?jwt.getClaimAsString("employee_id"):jwt.getSubject());
  return reasons.setByEmployee(id,self,input==null?null:input.reason());
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
  if (eventPublisher != null) {
   try {
    java.sql.Date d = (java.sql.Date) rows.getFirst().get("attendance_date");
    eventPublisher.publishEvent(new com.unifiedtree.notifications.events.OvertimeDecidedEvent(
        id, employee, tenant, "APPROVED".equals(status),
        d != null ? d.toLocalDate() : null, minutes, input.note()));
   } catch (Exception ex) { /* best-effort */ }
  }
  return Map.of("status",status);
 }
}
