import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, 'X-Tenant-Subdomain': 'demo' }
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  return { status: response.status, data }
}
const login = await call('/v1/canonical-auth/login', 'POST', { tenantId, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' })
assert.equal(login.status, 200, 'Login succeeds')
headers.Authorization = `Bearer ${login.data.accessToken}`
const payload = { companyId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', candidateName: `Offer verification ${Date.now()}`, roleTitle: 'Integration test role', offeredCtc: 600000 }
const invalid = await call('/v1/hiring/offers', 'POST', { ...payload, offeredCtc: -1 })
assert.ok(invalid.status >= 400 && invalid.status < 500, 'Negative CTC rejected')
const created = await call('/v1/hiring/offers', 'POST', payload)
assert.equal(created.status, 201, JSON.stringify(created.data))
const id = created.data.id
assert.equal(created.data.status, 'DRAFT')
const skipped = await call(`/v1/hiring/offers/${id}/status`, 'POST', { status: 'ACCEPTED' })
assert.ok(skipped.status >= 400 && skipped.status < 500, 'Cannot accept unsent draft')
for (const status of ['SENT', 'WITHDRAWN']) {
  const changed = await call(`/v1/hiring/offers/${id}/status`, 'POST', { status })
  assert.equal(changed.status, 200, JSON.stringify(changed.data))
  assert.equal(changed.data.status, status)
}
const listed = await call('/v1/hiring/offers?page=0&size=20')
assert.equal(listed.status, 200)
assert.equal(listed.data.content.find(row => row.id === id)?.status, 'WITHDRAWN', 'Persisted state appears on reload')
const reopened = await call(`/v1/hiring/offers/${id}/status`, 'POST', { status: 'SENT' })
assert.ok(reopened.status >= 400 && reopened.status < 500, 'Final decision cannot be reopened')
for (const path of ['/v1/expense/dashboard-stats', '/v1/pli/targets', '/v1/onboarding/assets', '/v1/compliance/inspector-sessions', '/v1/compliance/calendar-events']) {
  const result = await call(path)
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.data)}`)
  console.log('PASS', path)
}
console.log('PASS offer persistence, validation and status transitions', id)
