// Candidate → employee conversion (plan item 11 / AT-3) against the local
// recovery runtime. Creates a requisition + candidate through the real API,
// walks the candidate to HIRED, records an accepted offer, then converts in the
// browser and checks: employee created with the carried-over facts, candidate
// linked, second conversion rejected (409), a non-HIRED candidate rejected,
// employee-scope login denied, and the UI shows "View employee" after reload.
// Cleans up everything it created.
//
// Run from apps/platform:  node e2e/recovery/live-candidate-conversion.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
async function call(h, method, path, body) {
  const r = await fetch(api + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await r.json() } catch { /* empty */ }
  return { status: r.status, json }
}

const owner = await login('owner@unifiedtree.demo')
const tag = randomUUID().slice(0, 6)
const created = { requisition: null, candidates: [], employee: null, offer: null }
const joining = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
const browser = await chromium.launch({ headless: true })
try {
  const req = await call(owner, 'POST', '/v1/hiring/requisitions', { companyId: company, title: `QA Conversion Engineer ${tag}`, openings: 1, employmentType: 'FULL_TIME', location: 'Hyderabad' })
  check('requisition created', req.status === 200 || req.status === 201, `${req.status}`)
  created.requisition = req.json.id
  const cand = await call(owner, 'POST', `/v1/hiring/requisitions/${req.json.id}/candidates`, { fullName: `Kavya QA${tag}`, email: `kavya.qa.${tag}@unifiedtree.demo`, phone: '9876500000', source: 'Referral', expectedCtc: 900000 })
  created.candidates.push(cand.json.id)
  const other = await call(owner, 'POST', `/v1/hiring/requisitions/${req.json.id}/candidates`, { fullName: `Not Hired QA${tag}` })
  created.candidates.push(other.json.id)
  for (const stage of ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED']) {
    const r = await call(owner, 'PUT', `/v1/hiring/candidates/${cand.json.id}/stage`, { stage })
    if (r.status !== 200) throw new Error(`stage ${stage}: ${r.status} ${JSON.stringify(r.json)}`)
  }
  check('candidate walked to HIRED', true)
  const offer = await call(owner, 'POST', '/v1/hiring/offers', { companyId: company, requisitionId: req.json.id, candidateId: cand.json.id, candidateName: `Kavya QA${tag}`, roleTitle: 'Senior QA Engineer', offeredCtc: 1200000, joiningDate: joining, offerTerms: 'Standard terms.' })
  created.offer = offer.json?.id
  for (const status of ['SENT', 'ACCEPTED']) {
    const r = await call(owner, 'POST', `/v1/hiring/offers/${offer.json.id}/status`, { status })
    if (r.status !== 200) throw new Error(`offer ${status}: ${r.status} ${JSON.stringify(r.json)}`)
  }
  check('accepted offer recorded', true, `CTC 12,00,000 joining ${joining}`)

  const notHired = await call(owner, 'POST', `/v1/hiring/candidates/${other.json.id}/convert`)
  check('a non-HIRED candidate cannot be converted', notHired.status === 422 || notHired.status === 400, `${notHired.status} ${notHired.json?.errorCode ?? ''}`)
  const reader = await login('reader@unifiedtree.demo')
  const denied = await call(reader, 'POST', `/v1/hiring/candidates/${cand.json.id}/convert`)
  check('employee login cannot convert', denied.status === 403, `${denied.status}`)

  // Convert through the UI.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
  await page.goto(base + '/login'); await page.locator('input[type=email]').fill('owner@unifiedtree.demo'); await page.locator('input[type=password]').fill(password); await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }); await page.waitForTimeout(1500); errs.length = 0
  await page.goto(base + '/hrms/hiring')
  await page.getByRole('tab', { name: /Pipeline/i }).or(page.getByRole('button', { name: /Pipeline/i })).first().click()
  await page.locator('select').filter({ has: page.locator(`option:text("QA Conversion Engineer ${tag} (Open)")`) }).first().selectOption({ label: `QA Conversion Engineer ${tag} (Open)` })
  const row = page.getByRole('row').filter({ hasText: `Kavya QA${tag}` })
  await row.getByRole('button', { name: 'Convert to employee' }).click({ timeout: 20_000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Create employee' }).click()
  await page.waitForURL(/\/hrms\/employees\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const employeeId = page.url().match(/employees\/([0-9a-f-]{36})/)[1]
  created.employee = employeeId
  check('conversion lands on the new employee profile', true, employeeId)

  const emp = await call(owner, 'GET', `/v1/hrms/employees/${employeeId}`)
  check('employee carries name/email/phone from the candidate', emp.json.firstName === 'Kavya' && emp.json.lastName === `QA${tag}` && emp.json.email === `kavya.qa.${tag}@unifiedtree.demo` && emp.json.phone === '9876500000', `${emp.json.firstName} ${emp.json.lastName} ${emp.json.email}`)
  check('employee carries joining date and CTC from the accepted offer', emp.json.dateOfJoining === joining && Number(emp.json.ctcAnnual) === 1200000, `${emp.json.dateOfJoining} ${emp.json.ctcAnnual}`)
  check('employee carries employment type from the requisition', emp.json.employmentType === 'FULL_TIME', emp.json.employmentType)
  const linked = sql(`SELECT converted_employee_id FROM hiring_mgmt.candidates WHERE id='${cand.json.id}'`)
  check('candidate row is linked to the employee', linked === employeeId, linked)
  const again = await call(owner, 'POST', `/v1/hiring/candidates/${cand.json.id}/convert`)
  check('second conversion is rejected (idempotent)', again.status === 409, `${again.status} ${again.json?.errorCode ?? ''}`)

  await page.goto(base + '/hrms/hiring')
  await page.getByRole('tab', { name: /Pipeline/i }).or(page.getByRole('button', { name: /Pipeline/i })).first().click()
  await page.locator('select').filter({ has: page.locator(`option:text("QA Conversion Engineer ${tag} (Open)")`) }).first().selectOption({ label: `QA Conversion Engineer ${tag} (Open)` })
  await page.getByRole('row').filter({ hasText: `Kavya QA${tag}` }).getByRole('link', { name: 'View employee' }).waitFor({ timeout: 20_000 })
  check('pipeline shows "View employee" after reload', true)
  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/candidate-conversion-live.png', fullPage: true })
  check('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  try {
    if (created.employee) sql(`UPDATE hiring_mgmt.candidates SET converted_employee_id=NULL WHERE converted_employee_id='${created.employee}'; DELETE FROM hrms.employees WHERE id='${created.employee}' AND tenant_id='${tenant}'`)
    if (created.offer) sql(`DELETE FROM hiring_mgmt.offers WHERE id='${created.offer}'`)
    if (created.requisition) sql(`DELETE FROM hiring_mgmt.job_requisitions WHERE id='${created.requisition}'`)
    console.log('fixtures removed')
  } catch (e) { console.log('cleanup failed (QA records left):', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-candidate-conversion.json', JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
