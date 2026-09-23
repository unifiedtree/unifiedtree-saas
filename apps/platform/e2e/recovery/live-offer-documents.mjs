import assert from 'node:assert/strict'
const base = 'http://127.0.0.1:8080/api'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, 'X-Tenant-Subdomain': 'demo' }
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, data: await response.json() }
}
const auth = await call('/v1/canonical-auth/login', 'POST', { tenantId, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' })
assert.equal(auth.status, 200); headers.Authorization = `Bearer ${auth.data.accessToken}`
const payload = { companyId, candidateName: `Offer document QA ${Date.now()}`, roleTitle: 'Engineer', offeredCtc: 600000, notes: 'Internal note', offerTerms: 'Approved terms <plain text>' }
const bypass = await call('/v1/hiring/offers', 'POST', { ...payload, status: 'ACCEPTED' })
assert.equal(bypass.status, 422)
const foreignCompany = await call('/v1/hiring/offers', 'POST', { ...payload, companyId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
assert.equal(foreignCompany.status, 404)
const created = await call('/v1/hiring/offers', 'POST', payload)
assert.equal(created.status, 201, JSON.stringify(created.data)); const id = created.data.id
const updated = await call(`/v1/hiring/offers/${id}`, 'PUT', { ...payload, roleTitle: 'Senior Engineer', offerTerms: 'Updated approved terms' })
assert.equal(updated.status, 200, JSON.stringify(updated.data)); assert.equal(updated.data.offerTerms, 'Updated approved terms')
const listed = await call('/v1/hiring/offers?size=20')
assert.equal(listed.data.content.find(x => x.id === id).roleTitle, 'Senior Engineer')
const pdf = await fetch(base + `/v1/hiring/offers/${id}/pdf`, { headers })
assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/); assert.equal(pdf.headers.get('cache-control'), 'no-store')
const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 1000)
const sent = await call(`/v1/hiring/offers/${id}/status`, 'POST', { status: 'SENT' }); assert.equal(sent.status, 200)
const frozen = await call(`/v1/hiring/offers/${id}`, 'PUT', payload); assert.equal(frozen.status, 422)
const missing = await fetch(base + '/v1/hiring/offers/ffffffff-ffff-ffff-ffff-ffffffffffff/pdf', { headers }); assert.equal(missing.status, 404)
await call(`/v1/hiring/offers/${id}/status`, 'POST', { status: 'WITHDRAWN' })
const reader = await call('/v1/canonical-auth/login', 'POST', { tenantId, email: 'reader@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }); assert.equal(reader.status, 200)
headers.Authorization = `Bearer ${reader.data.accessToken}`
const denied = await fetch(base + `/v1/hiring/offers/${id}/pdf`, { headers }); assert.equal(denied.status, 403)
console.log('PASS offer draft edit/persistence, protected PDF, frozen issued terms, company validation, creation lifecycle and read permission')
