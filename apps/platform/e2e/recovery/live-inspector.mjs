import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, 'X-Tenant-Subdomain': 'demo' }
async function call(path, body, anonymous = false) {
  const response = await fetch(base + path, { method: 'POST', headers: anonymous ? { 'Content-Type': 'application/json' } : headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, data: await response.json() }
}
const login = await call('/v1/canonical-auth/login', { tenantId, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' })
assert.equal(login.status, 200); headers.Authorization = `Bearer ${login.data.accessToken}`
const created = await call('/v1/compliance/inspector-sessions', { companyId, inspectorName: 'Local inspection QA', purpose: 'Read-only access verification', expiresAt: new Date(Date.now() + 3600000).toISOString() })
assert.equal(created.status, 201, JSON.stringify(created.data))
const link = await call(`/v1/compliance/inspector-sessions/${created.data.id}/link`)
assert.equal(link.status, 200, JSON.stringify(link.data))
const token = link.data.token
const read = await call('/v1/public/inspector-view', { token }, true)
assert.equal(read.status, 200, JSON.stringify(read.data))
assert.equal(read.data.purpose, 'Read-only access verification')
const tampered = await call('/v1/public/inspector-view', { token: token.replace(tenantId, 'ffffffff-ffff-ffff-ffff-ffffffffffff') }, true)
assert.ok(tampered.status >= 400 && tampered.status < 500)
const revoked = await call(`/v1/compliance/inspector-sessions/${created.data.id}/revoke`)
assert.equal(revoked.status, 200)
const denied = await call('/v1/public/inspector-view', { token }, true)
assert.ok(denied.status >= 400 && denied.status < 500)
console.log('PASS anonymous scoped inspection, tampered tenant rejection and revocation enforcement')
