import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const base='http://127.0.0.1:8080/api',tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',employee='22222222-2222-2222-2222-222222222222',company='cccccccc-cccc-cccc-cccc-cccccccccccc'
async function request(token,path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Tenant-ID':tenant,...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
async function login(email){const r=await request(null,'/v1/canonical-auth/login','POST',{tenantId:tenant,email,password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});assert.equal(r.status,200);return r.data.accessToken}
const owner=await login('owner@unifiedtree.demo'),reader=await login('reader@unifiedtree.demo')
const input={workDate:'2026-01-11',description:`Time acceptance ${Date.now()}`,minutes:30}
const created=await request(reader,'/v1/ess/timesheets','POST',input);assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.id
try {
 const list=await request(reader,'/v1/ess/timesheets?from=2026-01-11&to=2026-01-11');assert.ok(list.data.some(e=>e.id===id))
 const own=await request(owner,'/v1/ess/timesheets?from=2026-01-11&to=2026-01-11');assert.ok(!own.data.some(e=>e.id===id))
 const stolen=await request(owner,`/v1/ess/timesheets/${id}`,'PUT',{...input,minutes:90});assert.ok(stolen.status>=400&&stolen.status<500)
 assert.equal((await request(reader,`/v1/ess/timesheets/${id}`,'PUT',{...input,minutes:1440})).status,200)
 const overflow=await request(reader,'/v1/ess/timesheets','POST',input);assert.ok(overflow.status>=400&&overflow.status<500)
 const future=await request(reader,'/v1/ess/timesheets','POST',{...input,workDate:'2099-01-01'});assert.ok(future.status>=400&&future.status<500)
} finally {assert.equal((await request(reader,`/v1/ess/timesheets/${id}`,'DELETE')).status,200)}
console.log('PASS time entries CRUD, owner isolation, daily limit, future date rejection')
const schedule=await request(owner,'/v1/team/schedule?from=2026-09-21&to=2026-09-27');assert.equal(schedule.status,200,JSON.stringify(schedule.data));assert.ok(schedule.data.some(r=>r.employeeId===employee));assert.equal((await request(reader,'/v1/team/schedule?from=2026-09-21&to=2026-09-27')).status,403)
console.log('PASS team schedule and employee-role denial')
const record=randomUUID();
const sql=q=>execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d','unifiedtree_recovery','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'})
sql(`INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) VALUES('${record}','${tenant}','${employee}','${company}','2026-09-16','2026-09-16T04:00:00Z','2026-09-16T14:00:00Z',60,'Isolated overtime acceptance fixture')`)
try {
 const list=await request(owner,'/v1/attendance/overtime?from=2026-09-16&to=2026-09-16');assert.equal(list.status,200,JSON.stringify(list.data));assert.ok(list.data.content.some(r=>r.id===record&&r.status==='PENDING'))
 assert.equal((await request(reader,`/v1/attendance/overtime/${record}/approve`,'POST',{})).status,403)
 const noReason=await request(owner,`/v1/attendance/overtime/${record}/reject`,'POST',{});assert.ok(noReason.status>=400&&noReason.status<500)
 const approved=await request(owner,`/v1/attendance/overtime/${record}/approve`,'POST',{note:'Verified worked time'});assert.equal(approved.status,200,JSON.stringify(approved.data))
 const repeat=await request(owner,`/v1/attendance/overtime/${record}/reject`,'POST',{note:'Should fail'});assert.ok(repeat.status>=400&&repeat.status<500)
 sql(`UPDATE attendance.records SET overtime_minutes=90 WHERE id='${record}' AND attendance_date='2026-09-16'`)
 const updated=await request(owner,'/v1/attendance/overtime?from=2026-09-16&to=2026-09-16');assert.equal(updated.data.content.find(r=>r.id===record).status,'PENDING')
 assert.equal((await request(owner,`/v1/attendance/overtime/${record}/reject`,'POST',{note:'Revised overtime not authorized'})).status,200)
 console.log('PASS overtime review persistence, role denial, required rejection reason, duplicate rejection, changed-duration re-review')
} finally {sql(`DELETE FROM attendance.overtime_decisions WHERE record_id='${record}'; DELETE FROM attendance.records WHERE id='${record}' AND attendance_date='2026-09-16'`)}
