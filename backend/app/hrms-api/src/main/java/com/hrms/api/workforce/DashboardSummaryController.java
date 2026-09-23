package com.hrms.api.workforce;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/v1/admin/dashboard")
public class DashboardSummaryController {
 private final JdbcTemplate jdbc;
 private final NamedParameterJdbcTemplate named;
 private final TeamEmployeeScope scope;
 public DashboardSummaryController(JdbcTemplate jdbc,NamedParameterJdbcTemplate named,TeamEmployeeScope scope){this.jdbc=jdbc;this.named=named;this.scope=scope;}
 private boolean allowed(Authentication auth,String permission){return auth.getAuthorities().stream().anyMatch(a->a.getAuthority().equals(permission));}
 @GetMapping("/stats")
 @PreAuthorize("hasAuthority('org.company.read')")
 @Transactional(readOnly=true)
 public Map<String,Object> stats(@RequestParam UUID companyId,Authentication auth){
  UUID tenant=TenantContext.requireTenantId();LocalDate today=LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
  Map<String,Object> result=new LinkedHashMap<>();
  if(allowed(auth,"hrms.employee.read"))result.put("activeEmployees",jdbc.queryForObject("SELECT count(*) FROM hrms.employees WHERE tenant_id=? AND company_id=? AND employment_status='ACTIVE'",Long.class,tenant,companyId));
  if(allowed(auth,"hrms.hiring.read"))result.put("openRoles",jdbc.queryForObject("SELECT count(*) FROM hiring_mgmt.job_requisitions WHERE tenant_id=? AND company_id=? AND status='OPEN'",Long.class,tenant,companyId));
  if(allowed(auth,"hrms.compliance.read")){
   var compliance=jdbc.queryForMap("""
    SELECT count(*) AS total,count(*) FILTER(WHERE done) AS completed FROM (
      SELECT status='DONE' AS done FROM compliance_mgmt.compliance_items WHERE tenant_id=? AND company_id=? AND due_date BETWEEN ? AND ?
      UNION ALL
      SELECT status IN ('FILED','LATE') AS done FROM compliance_mgmt.statutory_filings WHERE tenant_id=? AND company_id=? AND due_date BETWEEN ? AND ?
    ) obligations
    """,tenant,companyId,today.withDayOfMonth(1),today,tenant,companyId,today.withDayOfMonth(1),today);
   long total=((Number)compliance.get("total")).longValue(),done=((Number)compliance.get("completed")).longValue();
   result.put("complianceScore",total==0?null:Math.round(done*100.0/total));result.put("complianceDue",total);result.put("complianceCompleted",done);
  }
  if(allowed(auth,"payroll.runs.read")){
   var runs=jdbc.queryForList("SELECT total_gross AS amount,status FROM payroll.runs WHERE tenant_id=? AND company_id=? AND period_year=? AND period_month=? AND status IN ('LOCKED','PAID')",tenant,companyId,today.getYear(),today.getMonthValue());
   result.put("monthlyPayroll",runs.isEmpty()?null:runs.getFirst().get("amount"));
  }
  result.put("month",today.toString().substring(0,7));return result;
 }
 @GetMapping("/alerts")
 @PreAuthorize("hasAuthority('org.company.read')")
 @Transactional(readOnly=true)
 public List<Map<String,Object>> alerts(@AuthenticationPrincipal Jwt jwt,Authentication auth){
  List<Map<String,Object>> alerts=new ArrayList<>();
  if(!allowed(auth,"attendance.regularization.approve")&&!allowed(auth,"hrms.leave.approve.l1"))return alerts;
  var employees=scope.resolve(jwt,null).stream().map(e->e.getId()).toList();if(employees.isEmpty())return alerts;
  var params=Map.of("tenant",TenantContext.requireTenantId(),"employees",employees);
  if(allowed(auth,"attendance.regularization.approve")){
   Long count=named.queryForObject("SELECT count(*) FROM attendance.regularization_requests WHERE tenant_id=:tenant AND employee_id IN (:employees) AND status='PENDING'",params,Long.class);
   alerts.add(Map.of("type","CORRECTIONS","count",count,"label","Attendance correction requests","path","/hrms/attendance?tab=corrections"));
  }
  if(allowed(auth,"hrms.leave.approve.l1")){
   Long count=named.queryForObject("SELECT count(*) FROM leave_mgmt.leave_requests WHERE tenant_id=:tenant AND employee_id IN (:employees) AND status='PENDING'",params,Long.class);
   alerts.add(Map.of("type","LEAVE","count",count,"label","Leave requests awaiting first approval","path","/hrms/leave"));
  }
  return alerts;
 }
}
