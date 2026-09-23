import assert from 'node:assert/strict'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
async function login(email) {
  const response = await fetch(base + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(response.status, 200)
  return (await response.json()).accessToken
}
const owner = await login('owner@unifiedtree.demo')
const headers = token => ({ Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenant })
const template = await fetch(base + '/v1/bulk-import/employees/template', { headers: headers(owner) })
assert.equal(template.status, 200)
assert.match(template.headers.get('content-type'), /spreadsheetml/)
assert.equal(Buffer.from(await template.arrayBuffer()).subarray(0, 2).toString(), 'PK')
console.log('PASS: employee import template is an actual XLSX download')
const reader = await login('reader@unifiedtree.demo')
assert.equal((await fetch(base + '/v1/bulk-import/employees/template', { headers: headers(reader) })).status, 403)
async function upload(action, csv) {
  const data = new FormData()
  data.set('file', new Blob([csv], { type: 'text/csv' }), 'local-qa.csv')
  const response = await fetch(`${base}/v1/bulk-import/employees/${action}?companyId=${company}`, { method: 'POST', headers: headers(owner), body: data })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body
}
const stamp = Date.now()
const email = `local-import-${stamp}@example.test`
const columns = 'first_name,last_name,email,employment_type,date_of_joining\n'
const invalid = await upload('commit', columns + `Local Import,QA,invalid-email,FULL_TIME,2026-09-01\n`)
assert.equal(invalid.committed, false)
assert.ok(invalid.errors.length > 0)
const csv = columns + `Local Import,QA,${email},FULL_TIME,2026-09-01\n`
const validation = await upload('validate', csv)
assert.equal(validation.committed, false)
assert.equal(validation.errors.length, 0, JSON.stringify(validation))
const committed = await upload('commit', csv)
assert.equal(committed.committed, true)
assert.equal(committed.successCount, 1)
const duplicate = await upload('commit', csv)
assert.equal(duplicate.committed, false)
assert.ok(duplicate.errors.length > 0)
console.log('PASS: invalid import denied; valid row validates, commits once and duplicate is rejected')
