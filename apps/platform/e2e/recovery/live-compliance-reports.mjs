import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const stamp = Date.now()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const results = []
async function login(email) {
  const res = await fetch(base + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(res.status, 200)
  return (await res.json()).accessToken
}
async function response(token, path, method = 'GET', body) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function json(token, path, method = 'GET', body, status = 200) {
  const res = await response(token, path, method, body)
  const text = await res.text()
  assert.equal(res.status, status, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : null
}
async function check(name, run) {
  try { const evidence = await run(); results.push({ name, passed: true, evidence }); console.log('PASS: ' + name) }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + ': ' + error.message) }
}
function csvRows(text) {
  const rows = []
  let row = [], field = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && ch === ',') { row.push(field); field = '' }
    else if (!quoted && (ch === '\r' || ch === '\n')) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  assert.equal(quoted, false, 'CSV quotes must balance')
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

await check('Compliance list with an optional, unassigned owner', async () => {
  let listing = await json(owner, `/v1/compliance/items?companyId=${company}&size=1000`)
  if (!listing.content.length) {
    // The API contract makes ownerId optional. A fresh register must read back such a record.
    await json(owner, '/v1/compliance/items', 'POST', { companyId: company, title: `Local QA compliance ${stamp}`, category: 'LOCAL_TEST', dueDate: today, frequency: 'ONCE', notes: 'Local read verification only; no legal filing submitted' }, 201)
    listing = await json(owner, `/v1/compliance/items?companyId=${company}&size=1000`)
  }
  assert.ok(listing.content.length > 0)
  for (const row of listing.content) { assert.ok(row.id && row.title && row.dueDate); if (row.ownerId) assert.ok(row.ownerName) }
  await json(reader, `/v1/compliance/items?companyId=${company}`, 'GET', undefined, 403)
  return { count: listing.totalElements, statuses: [...new Set(listing.content.map(row => row.status))] }
})

await check('Statutory filing register readback', async () => {
  let listing = await json(owner, `/v1/compliance/filings?companyId=${company}&size=1000`)
  if (!listing.content.length) {
    await json(owner, '/v1/compliance/filings', 'POST', { companyId: company, filingType: 'OTHER', period: `QA ${stamp}`, amount: 0, dueDate: today }, 201)
    listing = await json(owner, `/v1/compliance/filings?companyId=${company}&size=1000`)
  }
  assert.ok(listing.content.length > 0)
  assert.ok(listing.content.every(row => row.id && row.filingType && row.dueDate))
  await json(owner, '/v1/compliance/filings', 'POST', { companyId: company, filingType: 'OTHER', period: 'x'.repeat(21), amount: 0, dueDate: today }, 400)
  await json(reader, `/v1/compliance/filings?companyId=${company}`, 'GET', undefined, 403)
  return { count: listing.totalElements, statuses: [...new Set(listing.content.map(row => row.status))] }
})

const params = new URLSearchParams({ companyId: company, from: today.slice(0, 4) + '-01-01', to: today, asOf: today, year: today.slice(0, 4) })
for (const name of ['headcount', 'attrition', 'attendance-summary', 'leave-balance', 'late-marks', 'diversity']) {
  await check(`CSV export: ${name}`, async () => {
    const rows = await json(owner, `/v1/reports/${name}?${params}`)
    const res = await response(owner, `/v1/reports/${name}/export.csv?${params}`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /^text\/csv/)
    assert.match(res.headers.get('content-disposition') || '', /filename=.*\.csv/)
    const csv = await res.text()
    const parsed = csvRows(csv)
    if (!rows.length) assert.equal(parsed.length, 0)
    else {
      const columns = Object.keys(rows[0])
      assert.deepEqual(parsed[0], columns)
      assert.equal(parsed.length - 1, rows.length)
      for (let i = 0; i < rows.length; i++) {
        assert.equal(parsed[i + 1].length, columns.length)
        columns.forEach((key, index) => {
          const value = rows[i][key]
          if (typeof value === 'number') assert.equal(Number(parsed[i + 1][index]), value)
          // JDBC CSV timestamps use the local recovery JVM/OS timezone; JSON uses ISO UTC.
          else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) assert.equal(Date.parse(parsed[i + 1][index]), Date.parse(value))
          else assert.equal(parsed[i + 1][index], value == null ? '' : String(value))
        })
      }
    }
    assert.equal((await response(reader, `/v1/reports/${name}/export.csv?${params}`)).status, 403)
    return { rowCount: rows.length, csvBytes: Buffer.byteLength(csv), matchesJson: true, employeeDenied: true }
  })
}
mkdirSync('test-results/recovery', { recursive: true })
writeFileSync('test-results/recovery/live-compliance-reports.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))
if (results.some(row => !row.passed)) process.exitCode = 1
