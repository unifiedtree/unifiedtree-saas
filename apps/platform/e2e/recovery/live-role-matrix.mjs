import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const base=process.env.RECOVERY_API_URL||'http://127.0.0.1:8080/api',tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',company='cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql=q=>execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d',process.env.RECOVERY_DB||'unifiedtree_recovery','-v','ON_ERROR_STOP=1','-At','-c',q],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'}})
const roleRows=JSON.parse(sql("SELECT json_agg(row_to_json(r)) FROM (SELECT id,code FROM rbac.roles WHERE code <> 'PLATFORM_SUPER_ADMIN' ORDER BY code) r"))
let checked=0
for(const role of roleRows){
 const employee=randomUUID(),user=randomUUID(),email=`qa-role-${user}@example.invalid`
 try {
  sql(`BEGIN;INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status) VALUES('${employee}','${tenant}','${company}','ROLE-${employee.slice(0,8)}','Role','Acceptance','${email}','FULL_TIME','ACTIVE');INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active) SELECT '${user}','${tenant}','${email}',password_hash,'${employee}',true FROM auth.user_credentials WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) VALUES('${tenant}','${user}','${role.id}');COMMIT;`)
  const login=await fetch(base+'/v1/canonical-auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant-ID':tenant},body:JSON.stringify({tenantId:tenant,email,password:process.env.RECOVERY_PASSWORD||'Hrms@12345'})});assert.equal(login.status,200,role.code);const session=await login.json(),p=new Set(session.permissions)
  const checks=[
   ['/v1/onboarding/assets',['hrms.onboarding.asset.read','hrms.onboarding.instance.write']],
   [`/v1/hrms/projects?companyId=${company}`,['hrms.project.read']],
   [`/v1/admin/dashboard/notices?companyId=${company}`,['org.company.read']],
   [`/v1/admin/dashboard/stats?companyId=${company}`,['org.company.read']],
   ['/v1/team/schedule?from=2026-09-21&to=2026-09-27',['attendance.team.read']],
   ['/v1/ess/timesheets?from=2026-01-01&to=2026-01-02',['attendance.checkin.self']],
   ['/v1/compliance/inspector-sessions',['hrms.compliance.inspector.read','hrms.compliance.read']],
   // offers carry salary: offer.read only, not general hiring.read (HiringController.listOffers, since V143_1)
   ['/v1/hiring/offers',['hrms.hiring.offer.read']],
   // My team (redesign P-TEAM). '*' = anyone signed in (the caller's own rows).
   ['/v1/team/summary',['attendance.team.read','hrms.leave.approve.l1']],
   ['/v1/team/time-off?from=2026-09-21&to=2026-09-27',['attendance.team.read','hrms.leave.approve.l1','wfh.approve']],
   // the inbox lists submitted timesheet weeks too (BW-36), so a timesheet approver may open it
   ['/v1/team/approvals',['hrms.leave.approve.l1','wfh.approve','attendance.regularization.approve','hrms.expense.claim.approve','hrms.timesheet.approve']],
   ['/v1/team/probation?days=30',['attendance.team.read']],
   ['/v1/attendance/reminders?date=2026-09-27',['attendance.team.read']],
   ['/v1/approvals/recent-decisions',['*']],
   ['/v1/team/messages/mine',['*']],
   ['/v1/team/messages/sent',['*']],
  ]
  for(const [path,permissions] of checks){const response=await fetch(base+path,{headers:{Authorization:`Bearer ${session.accessToken}`,'X-Tenant-ID':tenant}});const expected=permissions.some(code=>code==='*'||p.has(code))?200:403;assert.equal(response.status,expected,`${role.code} ${path}`);checked++}
  console.log(`PASS ${role.code}: ${checks.length} endpoint grants/denials match real JWT permissions`)
 }finally{sql(`BEGIN;DELETE FROM auth.user_credentials WHERE id='${user}' AND tenant_id='${tenant}';DELETE FROM hrms.employees WHERE id='${employee}' AND tenant_id='${tenant}';COMMIT;`)}
}
console.log(`PASS ${checked} checks across ${roleRows.length} existing company role codes; platform administration uses a separate authentication surface`)
