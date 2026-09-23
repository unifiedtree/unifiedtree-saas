import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, 'X-Tenant-Subdomain': 'demo' }
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, data: await response.json() }
}
const login = await call('/v1/canonical-auth/login', 'POST', { tenantId, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' })
assert.equal(login.status, 200)
headers.Authorization = `Bearer ${login.data.accessToken}`
const created = await call('/v1/onboarding/assets', 'POST', { companyId, assetTag: `QA-${Date.now()}`, assetName: 'Local asset workflow check', assetType: 'Laptop', status: 'ASSIGNED', employeeId: '11111111-1111-1111-1111-111111111111' })
assert.equal(created.status, 201, JSON.stringify(created.data))
assert.equal(created.data.status, 'AVAILABLE', 'Create must ignore client lifecycle state')
assert.equal(created.data.employeeId, null, 'Create cannot bypass assignment validation')
const id = created.data.id
const invalid = await call(`/v1/onboarding/assets/${id}/assign`, 'POST', { employeeId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
assert.ok(invalid.status >= 400 && invalid.status < 500)
const assigned = await call(`/v1/onboarding/assets/${id}/assign`, 'POST', { employeeId: '11111111-1111-1111-1111-111111111111' })
assert.equal(assigned.status, 200, JSON.stringify(assigned.data))
assert.equal(assigned.data.status, 'ASSIGNED')
const duplicate = await call(`/v1/onboarding/assets/${id}/assign`, 'POST', { employeeId: '11111111-1111-1111-1111-111111111111' })
assert.ok(duplicate.status >= 400 && duplicate.status < 500)
const returned = await call(`/v1/onboarding/assets/${id}/return`, 'POST', { notes: 'Verified intact' })
assert.equal(returned.status, 200)
assert.equal(returned.data.status, 'RETURNED')
const list = await call('/v1/onboarding/assets')
assert.equal(list.data.find(a => a.id === id)?.conditionNotes, 'Verified intact')
const calendar = await call(`/v1/compliance/calendar-events?companyId=${companyId}&from=2026-09-01&to=2026-09-30`)
assert.equal(calendar.status, 200, JSON.stringify(calendar.data))
assert.ok(calendar.data.every(e => e.date >= '2026-09-01' && e.date <= '2026-09-30'))
const invalidRange = await call('/v1/compliance/calendar-events?from=2026-09-30&to=2026-09-01')
assert.ok(invalidRange.status >= 400 && invalidRange.status < 500)
console.log('PASS asset create/assign/return persistence, invalid employee/duplicate assignment rejection, calendar date range')

assert.equal((await call(`/v1/onboarding/assets/${id}/assign`, 'POST', { employeeId: '22222222-2222-2222-2222-222222222222' })).status, 200)
assert.equal((await call(`/v1/onboarding/assets/${id}/return`, 'POST', { notes: 'Second allocation returned' })).status, 200)
const history = await call(`/v1/onboarding/assets/${id}/history`)
assert.equal(history.status, 200, JSON.stringify(history.data))
assert.equal(history.data.length, 2)
assert.ok(history.data.some(a => a.employeeId === '11111111-1111-1111-1111-111111111111' && a.notes === 'Verified intact'))
assert.ok(history.data.some(a => a.employeeId === '22222222-2222-2222-2222-222222222222' && a.returnedAt))
console.log('PASS asset allocation history retains both employees and return notes after reassignment')
