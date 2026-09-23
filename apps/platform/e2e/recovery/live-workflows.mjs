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
const shifts = await request(owner, `/v1/shifts?companyId=${company}`)
assert.ok(shifts.length >= 2, 'Default shifts exist')
await request(owner, `/v1/shifts/employee/${employee}`, 'POST', { shiftPolicyId: shifts[0].id })
assert.equal((await request(owner, `/v1/shifts/employee/${employee}`)).shiftPolicyId, shifts[0].id)
console.log('PASS: direct employee shift assignment persists')
const change = await request(reader, '/v1/shifts/change-requests', 'POST', { requestedShiftPolicyId: shifts[1].id, reason: 'Local acceptance: change shift for employee' })
assert.ok((await request(owner, '/v1/shifts/change-requests/pending')).some(r => r.id === change.id && r.employeeId === employee))
await request(owner, `/v1/shifts/change-requests/${change.id}/decision`, 'POST', { approved: true, comment: 'Approved in local acceptance' })
assert.equal((await request(owner, `/v1/shifts/employee/${employee}`)).shiftPolicyId, shifts[1].id)
assert.ok(!(await request(owner, '/v1/shifts/change-requests/pending')).some(r => r.id === change.id))
console.log('PASS: employee request, admin approval, queue removal and resulting shift persist')
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const existing = await request(reader, '/v1/attendance/corrections/my?page=0&size=100')
const correction = existing.content.find(r => r.requestedDate === date && r.status === 'PENDING') || await request(reader, '/v1/attendance/corrections', 'POST', { requestedDate: date, requestedCheckInAt: `${date}T05:00:00Z`, requestedCheckOutAt: `${date}T12:30:00Z`, reason: 'Local acceptance: missing attendance punch' })
const approvals = await request(owner, '/v1/attendance/corrections/approvals?status=PENDING&page=0&size=100')
const approval = approvals.content.find(r => r.id === correction.id)
assert.ok(approval?.employeeName, 'Requester identity is returned')
assert.equal(approval.employeeId, employee)
await request(owner, `/v1/attendance/corrections/${correction.id}/decision`, 'POST', { status: 'APPROVED', comment: 'Verified local acceptance' })
const dashboard = await request(owner, `/v1/attendance/dashboard?date=${date}`)
assert.ok(dashboard.staffStatuses.some(r => r.employeeId === employee && r.checkInAt), 'Approval writes a visible attendance record')
console.log('PASS: correction identifies requester and approval updates the dated attendance roster')
const denied = await fetch(base + `/v1/shifts/employee/${employee}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${reader}` }, body: JSON.stringify({ shiftPolicyId: shifts[0].id }) })
assert.equal(denied.status, 403, 'Employee cannot assign shifts')
console.log('PASS: employee role cannot perform admin shift assignment')
