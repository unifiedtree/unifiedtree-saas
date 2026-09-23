import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, 'X-Tenant-Subdomain': 'demo' }
async function call(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
const login = await call('/v1/canonical-auth/login', { tenantId, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' })
assert.equal(login.status, 200); headers.Authorization = `Bearer ${login.data.accessToken}`
const skill = { employeeId: '11111111-1111-1111-1111-111111111111', skillName: `QA skill ${Date.now()}`, proficiency: 4, certified: true, certificationName: 'Local verification', certifiedOn: '2026-01-01', expiresOn: '2026-12-31' }
const created = await call('/v1/learning/skills', skill)
assert.equal(created.status, 200, JSON.stringify(created.data)); assert.equal(created.data.expiresOn, '2026-12-31')
const invalid = await call('/v1/learning/skills', { ...skill, expiresOn: '2025-12-31' })
assert.ok(invalid.status >= 400 && invalid.status < 500)
const list = await call(`/v1/learning/skills/${skill.employeeId}`)
assert.equal(list.data.find(s => s.id === created.data.id)?.expiresOn, '2026-12-31')
for (const path of ['performers', 'onboarding', 'hiring']) {
  const result = await call(`/v1/admin/dashboard/${path}?companyId=${companyId}`)
  assert.equal(result.status, 200, JSON.stringify(result.data))
  console.log('PASS dashboard', path)
}
console.log('PASS certification expiry persistence and invalid-date rejection')
