// Attendance → Face Punch Logs tab (/hrms/attendance?tab=face) — browser
// acceptance against the local recovery runtime. The tab used to render two
// hard-coded rows; it now reads GET /v1/attendance/face/admin/events.
// The recovery DB has no face events, so this inserts three throw-away events
// (+ one enrollment row so the email resolves), checks the table against the
// API and the server-side employee filter, then removes the fixtures and checks
// the empty state. Also checks an employee login gets the permission state and
// never calls the admin endpoints.
//
// Run from apps/platform:  node e2e/recovery/live-face-punch-logs.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const getEvents = async (auth, q = '') => {
  const r = await fetch(`${api}/v1/attendance/face/admin/events?limit=500${q}`, { headers: auth })
  if (!r.ok) throw new Error(`events: ${r.status}`)
  return r.json()
}

const OWNER_USER = '66666666-6666-6666-6666-666666666666'
const READER_USER = '22222222-2222-2222-2222-222222222222'
const owner = await login('owner@unifiedtree.demo')
const hadEnrollment = sql(`SELECT count(*) FROM attendance.face_enrollments WHERE tenant_id='${tenant}' AND employee_id='${OWNER_USER}'`) !== '0'
const enrollmentId = randomUUID()
const events = [
  { id: randomUUID(), user: OWNER_USER, purpose: 'PUNCH_IN', result: 'PASS', reason: null, bucket: 'HIGH', ago: '1 hour', label: 'Verified' },
  { id: randomUUID(), user: OWNER_USER, purpose: 'PUNCH_IN', result: 'FAIL_MATCH', reason: 'QA fixture - face did not match', bucket: 'REJECTED', ago: '2 hours', label: 'No match' },
  { id: randomUUID(), user: READER_USER, purpose: 'MANUAL_TEST', result: 'FAIL_NOT_ENROLLED', reason: 'QA fixture - not enrolled', bucket: null, ago: '3 hours', label: 'Not enrolled' },
]
const cleanup = () => {
  sql(`DELETE FROM attendance.face_verification_events WHERE id IN (${events.map((e) => `'${e.id}'`).join(',')})`)
  if (!hadEnrollment) sql(`DELETE FROM attendance.face_enrollments WHERE id='${enrollmentId}'`)
}

const browser = await chromium.launch({ headless: true })
const pageErrors = [], failedApi = [], faceCalls = []
let fixturesIn = false
const watch = (page) => {
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.on('request', (r) => { if (r.url().includes('/attendance/face/admin/')) { const u = new URL(r.url()); faceCalls.push(u.pathname + u.search) } })
}
async function uiLogin(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Every sign-in currently produces two 401→refresh(422) round trips (known,
  // auth section of the ledger). Measure the page, not the login.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0; faceCalls.length = 0
}

try {
  if (!hadEnrollment) {
    sql(`INSERT INTO attendance.face_enrollments (id, tenant_id, employee_id, status, samples_captured, enrolled_at) VALUES ('${enrollmentId}','${tenant}','${OWNER_USER}','ACTIVE',5, now() - interval '1 day')`)
  }
  for (const e of events) {
    sql(`INSERT INTO attendance.face_verification_events (id, tenant_id, employee_id, purpose, result, reason, score_bucket, created_at) VALUES ('${e.id}','${tenant}','${e.user}','${e.purpose}','${e.result}',${e.reason ? `'${e.reason}'` : 'NULL'},${e.bucket ? `'${e.bucket}'` : 'NULL'}, now() - interval '${e.ago}')`)
  }
  fixturesIn = true
  const apiAll = await getEvents(owner)
  check('API returns the fixture events', events.every((e) => apiAll.some((a) => a.id === e.id)), `${apiAll.length} events`)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  watch(page)
  await uiLogin(page, 'owner@unifiedtree.demo')

  await page.goto(base + '/hrms/attendance?tab=face')
  await page.getByRole('heading', { name: 'Face Punch Logs' }).waitFor({ timeout: 30_000 })
  check('Face Punch Logs tab renders', true)
  const table = page.locator('table')
  await table.getByText('Verified').first().waitFor({ timeout: 20_000 })
  const bodyRows = table.locator('tbody tr')
  const shown = await bodyRows.count()
  check('row count matches the API (first page of 20)', shown === Math.min(20, apiAll.length), `${shown} rows vs ${apiAll.length} from API`)
  const rowsText = await bodyRows.allInnerTexts()
  const firstPageIds = apiAll.slice(0, 20).map((a) => a.id)
  for (const e of events) {
    const idx = firstPageIds.indexOf(e.id)
    check(`row ${idx + 1} shows ${e.result} as "${e.label}"`, idx >= 0 && rowsText[idx]?.includes(e.label), rowsText[idx]?.replace(/\s+/g, ' ').slice(0, 140))
  }
  const ownerRowIdx = firstPageIds.indexOf(events[0].id)
  check('employee resolves to the enrolled email', rowsText[ownerRowIdx]?.includes('owner@unifiedtree.demo'))
  check('match confidence bucket shown (High / Below threshold)', rowsText[ownerRowIdx]?.includes('High') && rowsText[firstPageIds.indexOf(events[1].id)]?.includes('Below threshold'))
  check('the old hard-coded rows are gone', (await page.getByText('Rajesh Kumar').count()) === 0 && (await page.getByText('Kiosk-Pune-01').count()) === 0)
  check('header count matches the API', (await page.getByText(`${apiAll.length} face verification ${apiAll.length === 1 ? 'event' : 'events'}, newest first.`).count()) === 1)

  // Employee filter → server-side employeeId parameter.
  faceCalls.length = 0
  const filtered = page.waitForResponse((r) => r.url().includes('/attendance/face/admin/events') && r.url().includes(`employeeId=${OWNER_USER}`), { timeout: 15_000 })
  await page.getByLabel('Employee').selectOption(OWNER_USER)
  await filtered
  const apiOwner = await getEvents(owner, `&employeeId=${OWNER_USER}`)
  await page.waitForTimeout(500)
  const filteredRows = await table.locator('tbody tr').count()
  check('employee filter is sent to the server', faceCalls.some((c) => c.includes(`employeeId=${OWNER_USER}`)), faceCalls.join(' | '))
  check('filtered rows match the API', filteredRows === Math.min(20, apiOwner.length) && !(await table.innerText()).includes('Not enrolled'), `${filteredRows} vs ${apiOwner.length}`)
  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/face-punch-logs-live.png', fullPage: true })

  // Remove the fixtures and confirm the honest empty state.
  cleanup(); fixturesIn = false
  const apiAfter = await getEvents(owner)
  await page.reload()
  await page.getByRole('heading', { name: 'Face Punch Logs' }).waitFor({ timeout: 30_000 })
  if (apiAfter.length === 0) {
    await page.getByText('No face punches recorded yet').waitFor({ timeout: 20_000 })
    check('empty state shown when the API has no events', true)
    await page.screenshot({ path: 'test-results/recovery/face-punch-logs-empty.png', fullPage: true })
  } else {
    await page.locator('table tbody tr').first().waitFor({ timeout: 20_000 })
    check('table shows remaining real events after cleanup', (await page.locator('table tbody tr').count()) === Math.min(20, apiAfter.length))
  }
  check('owner: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('owner: no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  await ctx.close()

  // Employee login: permission state, and the admin endpoints are never called.
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page2 = await ctx2.newPage()
  watch(page2)
  await uiLogin(page2, 'reader@unifiedtree.demo')
  await page2.goto(base + '/hrms/attendance?tab=face')
  await page2.getByText('Face punch logs are restricted').waitFor({ timeout: 30_000 })
  check('employee sees the restricted state', true)
  check('employee page never calls the admin face endpoints', faceCalls.length === 0, faceCalls.join(' | '))
  check('employee: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('employee: no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  await ctx2.close()
} catch (e) {
  check('script completed', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  if (fixturesIn) {
    try { cleanup(); console.log('fixtures removed') } catch (e) { console.log('fixture cleanup failed:', String(e).split('\n')[0]) }
  }
  const left = sql(`SELECT count(*) FROM attendance.face_verification_events WHERE id IN (${events.map((e) => `'${e.id}'`).join(',')})`)
  console.log('fixture events left in DB:', left)
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-face-punch-logs.json', JSON.stringify({ ranAt: new Date().toISOString(), checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
