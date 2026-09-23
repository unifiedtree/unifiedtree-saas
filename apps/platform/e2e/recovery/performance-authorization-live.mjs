import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
async function login(email) {
  const response = await fetch(base + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(response.status, 200)
  return (await response.json()).accessToken
}
async function response(token, path, method = 'GET', body) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
}
async function request(token, path, method = 'GET', body) {
  const result = await response(token, path, method, body)
  const text = await result.text()
  assert.ok(result.ok, `${method} ${path}: ${result.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const owner = await login('owner@unifiedtree.demo')
const manager = await login('mgr@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')
const directory = await request(owner, '/v1/hrms/employees?pageSize=100')
const employeeId = directory.content.find(employee => employee.email === 'reader@unifiedtree.demo').id
const managerId = directory.content.find(employee => employee.email === 'mgr@unifiedtree.demo').id
const unrelatedId = directory.content.find(employee => employee.email === 'fin@unifiedtree.demo').id
await request(owner, `/v1/hrms/employees/${employeeId}`, 'PUT', { reportingManagerId: managerId })
const stamp = Date.now()
const createKpi = ownerId => request(owner, '/v1/performance/kpis', 'POST', { ownerId, title: `Scope check ${stamp}`, targetValue: 100, currentValue: 20, direction: 'HIGHER_IS_BETTER', weight: 1 })
const directKpi = await createKpi(employeeId)
const outsideKpi = await createKpi(unrelatedId)
const visible = await request(manager, `/v1/performance/kpis?search=Scope%20check%20${stamp}`)
assert.equal(visible.total, 1)
assert.equal(visible.items[0].id, directKpi.id)
assert.equal((await request(manager, `/v1/performance/kpis?ownerId=${unrelatedId}`)).total, 0)
assert.equal((await request(manager, `/v1/performance/kpis?managerId=${unrelatedId}&search=Scope%20check%20${stamp}`)).total, 0)
for (const path of [`/v1/performance/kpis/${outsideKpi.id}`, `/v1/performance/kpis/${outsideKpi.id}/history`]) {
  assert.ok([400, 403, 404, 422].includes((await response(manager, path)).status), path)
}
assert.ok([400, 403, 404, 422].includes((await response(manager, `/v1/performance/kpis/${outsideKpi.id}/progress`, 'PUT', { newValue: 90 })).status))
assert.equal(Number((await request(owner, `/v1/performance/kpis/${outsideKpi.id}`)).currentValue), 20)
const managerContext = await request(manager, '/v1/canonical-auth/me')
if (managerContext.permissions.includes('hrms.performance.write')) {
  await request(manager, `/v1/performance/kpis/${directKpi.id}/progress`, 'PUT', { newValue: 35, notes: 'Assigned manager update' })
} else {
  assert.equal((await response(manager, `/v1/performance/kpis/${directKpi.id}/progress`, 'PUT', { newValue: 35 })).status, 403)
  await request(owner, `/v1/performance/kpis/${directKpi.id}/progress`, 'PUT', { newValue: 35, notes: 'Administrator update' })
  console.log('PASS: seeded manager read-only role cannot update even a direct-report KPI; administrator can record progress')
}
assert.equal(Number((await request(owner, `/v1/performance/kpis/${directKpi.id}`)).currentValue), 35)
console.log('PASS: manager lists only direct-report KPIs; forged owner/manager filters, history and progress cannot reach another employee')

await request(owner, `/v1/performance/kpis/${directKpi.id}`, 'PUT', { status: 'AT_RISK' })
const goals = await request(reader, '/v1/performance/goals/my')
const goal = goals.find(item => item.id === directKpi.id)
assert.equal(goal.status, 'AT_RISK')
assert.equal(Number(goal.targetValue), 100)
assert.ok([400,403,422].includes((await response(reader, `/v1/performance/goals/${directKpi.id}/progress`, 'PUT', { progress: 99 })).status))
assert.equal(Number((await request(owner, `/v1/performance/kpis/${directKpi.id}`)).currentValue), 35)
assert.equal(Number((await request(owner, `/v1/performance/kpis/${directKpi.id}`)).progressPct), 35)
console.log('PASS: at-risk measured KPI loads in employee goals; scalar self-progress cannot corrupt its value or percentage')

const cycle = await request(owner, '/v1/performance/cycles', 'POST', { companyId: company, name: `Reviewer authorization ${stamp}`, periodStart: '2026-09-01', periodEnd: '2026-09-30' })
const initiated = await request(owner, `/v1/performance/cycles/${cycle.id}/initiate`, 'POST', { reviewerTypes: ['SELF', 'MANAGER'], revieweeIds: [employeeId] })
assert.equal(initiated.assignmentsCreated, 2)
const assigned = (await request(manager, '/v1/performance/reviews/my')).find(item => item.cycleId === cycle.id && item.reviewerId === managerId)
assert.ok(assigned)
assert.equal(assigned.employeeId, employeeId)
const body = { overallRating: 4, strengths: 'Verified assigned reviewer', improvements: 'Continue learning' }
assert.ok([400, 403, 422].includes((await response(reader, `/v1/performance/reviews/${assigned.id}/submit`, 'POST', body)).status))
await request(manager, `/v1/performance/reviews/${assigned.id}/submit`, 'POST', body)
const self = (await request(reader, '/v1/performance/reviews/my')).find(item => item.cycleId === cycle.id && item.reviewerId === employeeId)
assert.ok(self)
await request(reader, `/v1/performance/reviews/${self.id}/submit`, 'POST', body)
const progress = await request(owner, `/v1/performance/cycles/${cycle.id}/progress`)
assert.equal(progress.completedAssignments, 2)
assert.equal(progress.overallPct, 100)
console.log('PASS: assigned manager receives review, reviewee cannot author manager feedback, each reviewer submits their own assignment and cycle reaches 100%')
