import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const employee = '22222222-2222-2222-2222-222222222222'
async function login(email) {
  const res = await fetch(base + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(res.status, 200, 'Login: ' + email)
  return (await res.json()).accessToken
}
async function request(token, path, method = 'GET', body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

const stamp = Date.now()
for (const path of ['/v1/payroll/dashboard/kpis','/v1/payroll/bank-profiles','/v1/payroll/disbursement/batches','/v1/expense/reimbursement-batches']) {
 await request(owner,path); console.log('PASS: '+path)
}
const kpi = await request(owner,'/v1/performance/kpis','POST',{ownerId:employee,title:`Local QA target ${stamp}`,targetValue:100,currentValue:0,unit:'tasks',direction:'HIGHER_IS_BETTER',weight:10})
await request(owner,`/v1/performance/kpis/${kpi.id}/progress`,'PUT',{newValue:25,notes:'Local persistence check'})
const history = await request(owner,`/v1/performance/kpis/${kpi.id}/history`)
assert.ok(history.some(h=>Number(h.newValue)===25))
console.log('PASS: KPI creation, progress and history persist')
const training = await request(owner,'/v1/learning/programs','POST',{companyId:company,title:`Local QA training ${stamp}`,capacity:10})
const enrolled = await request(owner,`/v1/learning/programs/${training.id}/enrollments`,'POST',{employeeId:employee})
await request(owner,`/v1/learning/enrollments/${enrolled.id}/complete`,'POST',{score:90})
assert.ok((await request(reader,'/v1/learning/enrollments/me')).some(e=>e.id===enrolled.id && e.status==='COMPLETED'))
console.log('PASS: training creation, employee enrollment and completion persist')
const doc = await request(owner,'/v1/document/documents','POST',{employeeId:employee,title:`Local QA document ${stamp}`,category:'OTHER',fileUrl:'https://example.com/local-qa-document.pdf'})
assert.ok((await request(reader,'/v1/document/my')).content.some(d=>d.id===doc.id))
await request(owner,`/v1/document/documents/${doc.id}`,'DELETE')
console.log('PASS: document URL metadata, employee visibility and deletion')

const cycle = await request(owner,'/v1/performance/cycles','POST',{companyId:company,name:`Local QA cycle ${stamp}`,periodStart:'2026-09-01',periodEnd:'2026-09-30'})
const initiated = await request(owner,`/v1/performance/cycles/${cycle.id}/initiate`,'POST',{reviewerTypes:['SELF'],revieweeIds:[employee]})
assert.equal(initiated.assignmentsCreated,1)
const progress = await request(owner,`/v1/performance/cycles/${cycle.id}/progress`)
assert.equal(progress.totalAssignments,1)
console.log('PASS: appraisal initiation and assignment roster persist')
const review = (await request(reader,'/v1/performance/reviews/my')).find(r=>r.cycleId===cycle.id)
assert.ok(review)
await request(reader,`/v1/performance/reviews/${review.id}/submit`,'POST',{overallRating:4,strengths:'Local verification',improvements:'Follow-up learning'})
assert.equal((await request(owner,`/v1/performance/cycles/${cycle.id}/progress`)).completedAssignments,1)
console.log('PASS: submitted self-review updates appraisal completion')
const advance = await request(reader,'/v1/advance/requests','POST',{amount:3000,repaymentMonths:3,reason:`Local QA advance ${stamp}`})
await request(owner,`/v1/advance/requests/${advance.id}/decision`,'POST',{approved:true,comment:'Local acceptance'})
await request(owner,`/v1/advance/requests/${advance.id}/disburse`,'POST')
const schedule = await request(owner,`/v1/advance/${advance.id}/schedule`)
assert.equal(schedule.length,3)
assert.equal(schedule.reduce((sum,s)=>sum+Number(s.scheduledAmount),0),3000)
console.log('PASS: advance approval and disbursement produce a reconciled recovery schedule')
