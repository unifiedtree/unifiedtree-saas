package com.hrms.api.attendance;
import com.hrms.attendance.service.AttendanceCalendar;
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
 /**
  * One row per person per day: the shift in force (shiftPolicyId, shiftName, times), since = the day that assignment
  * started (null with no shift), and joinedOn = the joining date (for people with no shift yet).
  *
  * <p>Day facts (BW-22), additive, by the rules attendance counts days with:
  * <ul>
  *   <li>{@code onLeave}: null, or {@code {leaveTypeName, duration, halfDay}} for APPROVED leave covering the day
  *       (duration is the leave's FULL_DAY / HALF_DAY_MORNING / HALF_DAY_AFTERNOON; pending leave is not shown).</li>
  *   <li>{@code weeklyOff}: the day is the person's weekly off: their own days, else the days of the shift in force
  *       that day, else their company's (HR configuration), else Saturday and Sunday.</li>
  *   <li>{@code holidayName}: the company's active holiday that day (names joined when there are several), else null.</li>
  * </ul>
  */
 @GetMapping
 @PreAuthorize("hasAuthority('attendance.team.read')")
 @Transactional(readOnly=true)
 public List<Map<String,Object>> schedule(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to) {
   if(to.isBefore(from)||to.isAfter(from.plusDays(30))) throw new BusinessRuleException("Choose up to 31 days","SCHEDULE_RANGE_INVALID");
   var employees=scope.resolve(jwt,null);
   if(employees.isEmpty())return List.of();
   List<Map<String,Object>> rows=jdbc.queryForList(SQL,Map.of("from",from,"to",to,"tenant",TenantContext.requireTenantId(),"employees",employees.stream().map(e->e.getId()).toList()));
   rows.forEach(TeamScheduleController::dayFacts);
   return rows;
 }
 static final String SQL = """
    SELECT e.id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
      d.day::date AS date,s.name AS "shiftName",s.start_time AS "startTime",s.end_time AS "endTime",
      s.id AS "shiftPolicyId",CASE WHEN s.id IS NOT NULL THEN to_char(assignment.effective_from,'YYYY-MM-DD') END AS since,
      to_char(e.date_of_joining,'YYYY-MM-DD') AS "joinedOn",
      lv.leave_type_name AS "_leaveTypeName",lv.duration AS "_leaveDuration",lv.half_day AS "_leaveHalfDay",
      (lv.leave_id IS NOT NULL) AS "_onLeave",hol.names AS "holidayName",
      e.weekly_off_days AS "_ownOffs",CASE WHEN s.is_active THEN s.weekly_off_days END AS "_shiftOffs",
      array_to_string(hc.weekend_days,',') AS "_companyOffs",EXTRACT(ISODOW FROM d.day)::int AS "_isoDow"
    FROM hrms.employees e
    CROSS JOIN generate_series(CAST(:from AS date),CAST(:to AS date),interval '1 day') d(day)
    LEFT JOIN LATERAL (
      SELECT a.shift_policy_id,a.effective_from FROM attendance.employee_shift_assignments a
      WHERE a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.effective_from<=d.day::date
        AND (a.effective_to IS NULL OR a.effective_to>=d.day::date)
      ORDER BY a.effective_from DESC,a.created_at DESC LIMIT 1
    ) assignment ON true
    LEFT JOIN attendance.shift_policies s ON s.id=assignment.shift_policy_id AND s.tenant_id=e.tenant_id
    LEFT JOIN LATERAL (
      SELECT lr.id AS leave_id,lt.name AS leave_type_name,lr.duration,lr.half_day
      FROM leave_mgmt.leave_requests lr LEFT JOIN leave_mgmt.leave_types lt ON lt.id=lr.leave_type_id
      WHERE lr.tenant_id=e.tenant_id AND lr.employee_id=e.id AND lr.status='APPROVED'
        AND lr.start_date<=d.day::date AND lr.end_date>=d.day::date
      ORDER BY lr.start_date DESC,lr.created_at DESC LIMIT 1
    ) lv ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(h.holiday_name,', ' ORDER BY h.holiday_name) AS names FROM settings.holiday_calendar h
      WHERE h.tenant_id=e.tenant_id AND h.company_id=e.company_id AND h.is_active AND h.holiday_date=d.day::date
    ) hol ON true
    LEFT JOIN settings.hr_configuration hc ON hc.company_id=e.company_id AND hc.tenant_id=e.tenant_id
    WHERE e.tenant_id=:tenant AND e.id IN (:employees)
    ORDER BY e.first_name,e.last_name,e.id,d.day
    """;
 /** Turns one row's helper columns ("_…") into {@code onLeave} and {@code weeklyOff}, and drops them. */
 static void dayFacts(Map<String,Object> row) {
   boolean onLeave=Boolean.TRUE.equals(row.remove("_onLeave"));
   Object type=row.remove("_leaveTypeName"),duration=row.remove("_leaveDuration"),halfDay=row.remove("_leaveHalfDay");
   Map<String,Object> leave=null;
   if(onLeave){
     leave=new LinkedHashMap<>();
     leave.put("leaveTypeName",type);
     leave.put("duration",duration);
     leave.put("halfDay",Boolean.TRUE.equals(halfDay)||(duration!=null&&String.valueOf(duration).startsWith("HALF_DAY")));
   }
   row.put("onLeave",leave);
   Object own=row.remove("_ownOffs"),shift=row.remove("_shiftOffs"),company=row.remove("_companyOffs"),dow=row.remove("_isoDow");
   row.put("weeklyOff",dow instanceof Number n&&weeklyOffDays(str(own),str(shift),str(company)).contains(n.intValue()));
   if(!row.containsKey("holidayName"))row.put("holidayName",null);
 }
 /** Own days, else the shift's, else the company's, else Saturday and Sunday (AttendanceCalendar's order). */
 static Set<Integer> weeklyOffDays(String own,String shift,String company) {
   Set<Integer> o=AttendanceCalendar.parseOffDays(own);
   if(!o.isEmpty())return o;
   Set<Integer> s=AttendanceCalendar.parseOffDays(shift);
   if(!s.isEmpty())return s;
   return AttendanceCalendar.pickOffDays(null,company);
 }
 private static String str(Object o){return o==null?null:o.toString();}
}
