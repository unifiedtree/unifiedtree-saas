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
 /** Company overtime rules (BW-29). No rule, or no table, leaves the list and decisions exactly as they were. */
 private final OvertimeRules rules;
 @org.springframework.beans.factory.annotation.Autowired(required=false)
 private org.springframework.context.ApplicationEventPublisher eventPublisher;
 public OvertimeController(TeamEmployeeScope scope,JdbcTemplate jdbc,NamedParameterJdbcTemplate named,OvertimeReasons reasons,OvertimeRules rules) {this.scope=scope;this.jdbc=jdbc;this.named=named;this.reasons=reasons;this.rules=rules;}
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
  // A company "counts after" rule (BW-29) changes which rows are overtime; without one, this is today's list exactly.
  if(rules!=null&&rules.countsAfterInUse(TenantContext.requireTenantId()))return listCounted(params,where);
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
 /** The person's company's rules: {@code orr.counts_after_minutes} is null for a company without them. */
 static final String RULES_JOIN=" LEFT JOIN attendance.overtime_rules orr ON orr.tenant_id=r.tenant_id AND orr.company_id=e.company_id\n";
 /** Only the minutes past "counts after" are overtime; a day with none left is not listed. */
 static final String COUNTED_WHERE=" AND r.overtime_minutes>COALESCE(orr.counts_after_minutes,0)";
 /**
  * The list when some company has a "counts after" rule: the same rows and fields, less the days whose extra time is
  * all inside the uncounted minutes, and each row gains {@code countedMinutes}, the part that counts. {@code minutes}
  * stays the stored overtime, which the rules never change.
  */
 Map<String,Object> listCounted(Map<String,Object> params,String where) {
  var content=named.queryForList("""
   SELECT r.id,r.employee_id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
    r.attendance_date AS date,r.overtime_minutes AS minutes,
    CASE WHEN d.reviewed_minutes=r.overtime_minutes THEN d.status ELSE 'PENDING' END AS status,
    d.note,d.decided_at AS "decidedAt",NULLIF(concat_ws(' ',reviewer.first_name,reviewer.last_name),'') AS "decidedBy",
   """+DETAILS_SQL+"""
   ,GREATEST(0,r.overtime_minutes-COALESCE(orr.counts_after_minutes,0)) AS "countedMinutes"
   FROM attendance.records r JOIN hrms.employees e ON e.id=r.employee_id AND e.tenant_id=r.tenant_id
   LEFT JOIN attendance.overtime_decisions d ON d.record_id=r.id AND d.tenant_id=r.tenant_id
   LEFT JOIN hrms.employees reviewer ON reviewer.id=d.decided_by AND reviewer.tenant_id=r.tenant_id
   """+RULES_JOIN+SHIFT_JOIN+where+COUNTED_WHERE+" ORDER BY r.attendance_date DESC,e.first_name,r.id LIMIT 20 OFFSET :offset",params);
  Long count=named.queryForObject("SELECT count(*) FROM attendance.records r JOIN hrms.employees e ON e.id=r.employee_id AND e.tenant_id=r.tenant_id"
    +RULES_JOIN+where+COUNTED_WHERE,params,Long.class);
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
  // Company rules (BW-29): only the counted part is overtime, and approvals stop at the monthly cap. Without rules
  // the counted part is all of it and nothing here changes. The stored minutes are what gets reviewed either way.
  OvertimeRules.Rules companyRules=rulesFor(tenant,employee);
  int counted=companyRules.counted(minutes);
  if(counted<=0)throw new BusinessRuleException("This extra time is within the first "+companyRules.countsAfterMinutes()+" minutes after the shift, which don't count as overtime","OVERTIME_NOT_COUNTED");
  if("APPROVED".equals(status)&&companyRules.monthlyCapMinutes()!=null){
   java.sql.Date day=(java.sql.Date)rows.getFirst().get("attendance_date");
   requireWithinMonthlyCap(tenant,employee,id,day.toLocalDate(),counted,companyRules);
  }
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
        d != null ? d.toLocalDate() : null, counted, input.note()));
   } catch (Exception ex) { /* best-effort */ }
  }
  return Map.of("status",status);
 }
 /** The rules of the person's company; none when there are none or the table isn't there (never fails). */
 OvertimeRules.Rules rulesFor(UUID tenant,UUID employee) {
  if(rules==null||!rules.tableReady())return OvertimeRules.Rules.none(null);
  List<UUID> company=jdbc.queryForList("SELECT company_id FROM hrms.employees WHERE id=? AND tenant_id=?",UUID.class,employee,tenant);
  return company.isEmpty()||company.getFirst()==null?OvertimeRules.Rules.none(null):rules.forCompany(tenant,company.getFirst());
 }
 /**
  * Refuses an approval that would take the person past the monthly cap: the counted minutes already approved in the
  * record's calendar month (decisions still in force, i.e. for the minutes stored now), plus this one. Locked per
  * person, so two approvers acting at once can't both slip under the cap.
  */
 void requireWithinMonthlyCap(UUID tenant,UUID employee,UUID record,LocalDate day,int counted,OvertimeRules.Rules r) {
  jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",(org.springframework.jdbc.core.ResultSetExtractor<Void>)rs->null,
    "overtime-cap:"+tenant+":"+employee);
  int after=r.countsAfterMinutes()==null?0:Math.max(0,r.countsAfterMinutes());
  Integer approved=jdbc.queryForObject("""
   SELECT COALESCE(SUM(GREATEST(0,d.reviewed_minutes-?)),0)::int FROM attendance.overtime_decisions d
   JOIN attendance.records rec ON rec.id=d.record_id AND rec.attendance_date=d.record_date AND rec.tenant_id=d.tenant_id
   WHERE d.tenant_id=? AND rec.employee_id=? AND d.status='APPROVED' AND d.reviewed_minutes=rec.overtime_minutes
     AND d.record_date BETWEEN ? AND ? AND d.record_id<>?
   """,Integer.class,after,tenant,employee,day.withDayOfMonth(1),day.withDayOfMonth(day.lengthOfMonth()),record);
  int already=approved==null?0:approved;
  if(already+counted>r.monthlyCapMinutes())throw new BusinessRuleException(
    "This would take them past the monthly overtime cap of %s (%s already approved in %s)".formatted(
      hm(r.monthlyCapMinutes()),hm(already),day.getMonth().getDisplayName(java.time.format.TextStyle.FULL,java.util.Locale.ENGLISH)),
    "OVERTIME_MONTHLY_CAP_REACHED");
 }
 /** 150 → "2h 30m", 120 → "2h", 45 → "45m". */
 static String hm(int minutes) {
  int h=minutes/60,m=minutes%60;
  return h>0&&m>0?h+"h "+m+"m":h>0?h+"h":m+"m";
 }
}
