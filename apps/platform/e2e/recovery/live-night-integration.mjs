import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const base='http://127.0.0.1:8080/api',tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',company='cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers={'Content-Type':'application/json','X-Tenant-ID':tenant}
async function call(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null}}
const login=await call('/v1/canonical-auth/login',{tenantId:tenant,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});assert.equal(login.status,200);headers.Authorization=`Bearer ${login.data.accessToken}`
const integration=await call('/v1/integration/connections',{companyId:company,name:'Local registry verification',provider:'QA registry provider'});assert.equal(integration.status,201,JSON.stringify(integration.data))
const toggled=await call(`/v1/integration/connections/${integration.data.id}/toggle`,{},'POST');assert.equal(toggled.status,200);assert.equal(toggled.data.status,'CONNECTED');assert.equal(toggled.data.lastSyncedAt,null)
assert.equal((await call(`/v1/integration/connections/${integration.data.id}`,undefined,'DELETE')).status,204)
console.log('PASS integration registry persists status without fabricating a provider sync')
const employee=randomUUID(),shift=randomUUID(),assignment=randomUUID(),record=randomUUID()
const sql=q=>execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d','unifiedtree_recovery','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'})
sql(`BEGIN;INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status) VALUES('${employee}','${tenant}','${company}','NIGHT-${employee.slice(0,8)}','Night','Regression','night-${employee}@example.invalid','FULL_TIME','ACTIVE');INSERT INTO attendance.shift_policies(id,tenant_id,company_id,name,start_time,end_time,is_active) VALUES('${shift}','${tenant}','${company}','Isolated night regression','22:00','06:00',true);INSERT INTO attendance.employee_shift_assignments(id,tenant_id,employee_id,shift_policy_id,effective_from,effective_to) VALUES('${assignment}','${tenant}','${employee}','${shift}','2026-09-13','2026-09-13');INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,attendance_status) VALUES('${record}','${tenant}','${employee}','${company}','2026-09-13','2026-09-13T16:30:00Z','2026-09-13T18:00:00Z','PRESENT');COMMIT;`)
try {
 const before=await call('/v1/attendance/dashboard?date=2026-09-13');assert.equal(before.status,200,JSON.stringify(before.data));assert.equal(before.data.staffStatuses.find(s=>s.employeeId===employee).earlyCheckout,true)
 sql(`UPDATE attendance.records SET check_out_at='2026-09-14T00:31:00Z' WHERE id='${record}' AND attendance_date='2026-09-13'`)
 const after=await call('/v1/attendance/dashboard?date=2026-09-13');assert.equal(after.data.staffStatuses.find(s=>s.employeeId===employee).earlyCheckout,false)
 console.log('PASS live night shift early checkout before midnight and on-time checkout next morning')
}finally{sql(`BEGIN;DELETE FROM attendance.records WHERE id='${record}' AND attendance_date='2026-09-13';DELETE FROM attendance.employee_shift_assignments WHERE id='${assignment}';DELETE FROM attendance.shift_policies WHERE id='${shift}';DELETE FROM hrms.employees WHERE id='${employee}';COMMIT;`)}
