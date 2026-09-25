package com.hrms.api.workforce;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/v1/admin/dashboard/notices")
public class CompanyNoticeController {
 private final JdbcTemplate jdbc;
 public CompanyNoticeController(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public record Input(@NotNull UUID companyId,@NotBlank @Size(max=200) String title,@NotBlank @Size(max=5000) String body,LocalDate expiresOn){}
 // Notices are company-wide announcements: everyone signed in to the workspace
 // reads them (the tenant filter below scopes them); only org.company.write posts.
 @GetMapping
 @PreAuthorize("isAuthenticated()")
 @Transactional(readOnly=true)
 public Map<String,Object> list(@RequestParam UUID companyId,@RequestParam(defaultValue="0") int page,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate date) {
  if(page<0||page>100000)throw new BusinessRuleException("Invalid page","NOTICE_PAGE_INVALID");
  LocalDate past=DashboardSummaryController.pastDate(date);
  if(past!=null)return listOn(companyId,page,past);
  String where=" WHERE tenant_id=? AND company_id=? AND NOT archived AND (expires_on IS NULL OR expires_on>=CURRENT_DATE)";
  return Map.of("content",jdbc.queryForList("SELECT id,title,body,expires_on AS \"expiresOn\",created_at AS \"createdAt\" FROM hrms.company_notices"+where+" ORDER BY created_at DESC,id LIMIT 5 OFFSET ?",TenantContext.requireTenantId(),companyId,page*5),"totalElements",jdbc.queryForObject("SELECT count(*) FROM hrms.company_notices"+where,Long.class,TenantContext.requireTenantId(),companyId));
 }
 /**
  * The notices that were up at the end of a past day (the dashboard's history
  * view): published by then, not yet expired on that day, and not archived, or
  * archived after it (archiving is a notice's last change, so its updated_at).
  */
 private Map<String,Object> listOn(UUID companyId,int page,LocalDate date){
  java.sql.Timestamp end=java.sql.Timestamp.from(DashboardAsOf.endOf(date));
  String where=" WHERE tenant_id=? AND company_id=? AND created_at<? AND (expires_on IS NULL OR expires_on>=?) AND (NOT archived OR updated_at>=?)";
  UUID tenant=TenantContext.requireTenantId();
  return Map.of("content",jdbc.queryForList("SELECT id,title,body,expires_on AS \"expiresOn\",created_at AS \"createdAt\" FROM hrms.company_notices"+where+" ORDER BY created_at DESC,id LIMIT 5 OFFSET ?",tenant,companyId,end,date,end,page*5),"totalElements",jdbc.queryForObject("SELECT count(*) FROM hrms.company_notices"+where,Long.class,tenant,companyId,end,date,end));
 }
 private void validate(Input input) {
  if(jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id=? AND tenant_id=?",Integer.class,input.companyId(),TenantContext.requireTenantId())==0)throw new BusinessRuleException("Company not found","NOTICE_COMPANY_INVALID");
  if(input.expiresOn()!=null&&input.expiresOn().isBefore(LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"))))throw new BusinessRuleException("Expiry cannot be in the past","NOTICE_EXPIRY_INVALID");
 }
 @PostMapping
 @PreAuthorize("hasAuthority('org.company.write')")
 @Transactional
 public Map<String,Object> create(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody Input input){
  validate(input);
  return jdbc.queryForMap("INSERT INTO hrms.company_notices(tenant_id,company_id,title,body,expires_on,created_by) VALUES(?,?,?,?,?,?) RETURNING id",TenantContext.requireTenantId(),input.companyId(),input.title().trim(),input.body().trim(),input.expiresOn(),UUID.fromString(jwt.getSubject()));
 }
 @PutMapping("/{id}")
 @PreAuthorize("hasAuthority('org.company.write')")
 @Transactional
 public Map<String,Boolean> update(@PathVariable UUID id,@Valid @RequestBody Input input){
  validate(input);
  int changed=jdbc.update("UPDATE hrms.company_notices SET title=?,body=?,expires_on=?,updated_at=now() WHERE id=? AND tenant_id=? AND company_id=? AND NOT archived",input.title().trim(),input.body().trim(),input.expiresOn(),id,TenantContext.requireTenantId(),input.companyId());
  if(changed!=1)throw new BusinessRuleException("Notice not found","NOTICE_NOT_FOUND");
  return Map.of("saved",true);
 }
 @DeleteMapping("/{id}")
 @PreAuthorize("hasAuthority('org.company.write')")
 @Transactional
 public Map<String,Boolean> archive(@PathVariable UUID id){
  if(jdbc.update("UPDATE hrms.company_notices SET archived=true,updated_at=now() WHERE id=? AND tenant_id=? AND NOT archived",id,TenantContext.requireTenantId())!=1)throw new BusinessRuleException("Notice not found","NOTICE_NOT_FOUND");
  return Map.of("archived",true);
 }
}
