// Shifts & Overtime (/hrms/shifts) — client complaint #3, browser acceptance
// against the local recovery runtime. The employee files a real shift-change
// request through the API (as /me/shift-change does), then the owner opens the
// new "Shift requests" tab, sees who raised it (name · code · department),
// current → requested shift and reason, and REJECTS it with a note so the
// reader's real shift is left untouched. Also checks the restructured tabs
// (Shift schedules · Roster · Overtime · Shift requests) and the overtime
// "Recorded, not paid" line. The request row is left decided (rejected) — no
// rows are deleted.
//
// Run from apps/platform:  node e2e/recovery/live-shift-requests.mjs
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const readerId = '22222222-2222-2222-2222-222222222222' // reader@unifiedtree.demo
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
async function call(h, method, path, body) {
  const r = await fetch(api + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await r.json() } catch { /* empty body */ }
  return { status: r.status, json }
}

const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

// The reader's real shift before anything happens — it must be identical after.
const before = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
const policies = (await call(reader, 'GET', `/v1/shifts?companyId=${company}`)).json
const target = policies.find((p) => p.id !== before.shiftPolicyId)
if (!target) throw new Error('no alternative shift policy to request')
const emp = (await call(owner, 'GET', `/v1/hrms/employees/${readerId}`)).json
const hhmm = (t) => { const [h, m] = t.split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
const readerName = [emp.firstName, emp.lastName].filter(Boolean).join(' ')
const dept = emp.departmentId
  ? ((await call(owner, 'GET', `/v1/hrms/departments?companyId=${emp.companyId || company}`)).json || []).find((d) => d.id === emp.departmentId)?.name
  : null
console.log('reader', readerName, emp.employeeCode, dept ?? '(no department)', '| current', before.shiftName, '→ requesting', target.name)

// File the request exactly as the ESS page does. If an earlier aborted run left
// one pending, reuse it rather than trip SHIFT_CHANGE_PENDING_EXISTS.
let reason = `QA automation — shift requests tab ${new Date().toISOString()}`
const created = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason })
let request = created.json
if (created.status !== 201) {
  const mine = (await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []
  request = mine.find((r) => r.status === 'PENDING')
  if (!request) throw new Error(`create request: ${created.status} ${JSON.stringify(created.json)}`)
  reason = request.reason
  console.log('reusing pending request', request.id)
}
const requestedName = request.requestedShiftName || target.name
check('employee can file a shift-change request', request?.status === 'PENDING', `${created.status} ${request.id}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], failedApi = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
let decided = false
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Every sign-in currently produces two 401→refresh(422) round trips (see
  // HRMS_MODULE_ACTION_LEDGER.md, auth section). Measure the page, not login.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0

  await page.goto(base + '/hrms/shifts')
  await page.getByRole('heading', { name: 'Shifts & Overtime' }).waitFor({ timeout: 30_000 })
  const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+\d+\s*$/, '').trim())
  check('tabs are Shift schedules · Roster · Overtime · Shift requests',
    JSON.stringify(tabNames) === JSON.stringify(['Shift schedules', 'Roster', 'Overtime', 'Shift requests']), tabNames.join(' · '))

  // Shift schedules (default tab) keeps the CRUD table.
  await page.getByRole('row').filter({ hasText: target.name }).first().waitFor({ timeout: 15_000 })
  check('Shift schedules tab lists shift policies with edit controls', (await page.getByRole('button', { name: `Edit shift ${target.name}` }).count()) === 1)

  // Overtime tab: approvals + monthly table, honest payroll copy, no schedule CRUD.
  await page.getByRole('tab', { name: 'Overtime' }).click()
  await page.getByRole('heading', { name: 'Overtime approvals' }).waitFor({ timeout: 15_000 })
  check('Overtime tab says approved overtime is "Recorded, not paid"', await page.getByText('Recorded, not paid').isVisible())
  check('Overtime tab no longer carries the shift-schedule CRUD table', (await page.getByRole('button', { name: /^Edit shift / }).count()) === 0)
  check('Overtime tab keeps the monthly overtime table', await page.getByRole('heading', { name: /^Overtime — / }).isVisible())

  // Roster tab still mounts.
  await page.getByRole('tab', { name: 'Roster' }).click()
  await page.getByRole('tab', { name: 'Roster' }).and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 15_000 })
  check('Roster tab renders its panel', (await page.getByRole('tabpanel').count()) === 1)

  // Shift requests tab — the badge mirrors the server's pending count.
  const pendingNow = ((await call(owner, 'GET', '/v1/shifts/change-requests/pending')).json || []).length
  await page.waitForFunction((n) => (document.querySelector('#tab-requests')?.textContent ?? '').includes(String(n)), pendingNow, { timeout: 15_000 }).catch(() => {})
  const badge = (await page.locator('#tab-requests').innerText()).replace('Shift requests', '').trim()
  check('Shift requests tab shows the pending-count badge', badge === String(pendingNow), `badge "${badge}" vs API ${pendingNow}`)
  await page.getByRole('tab', { name: /^Shift requests/ }).click()
  const card = page.getByRole('article').filter({ hasText: reason })
  await card.waitFor({ timeout: 20_000 })
  await card.getByText(readerName).first().waitFor({ timeout: 15_000 })
  if (dept) await card.getByText(dept).first().waitFor({ timeout: 15_000 }).catch(() => {})
  const cardText = await card.innerText()
  check('request names who raised it', cardText.includes(readerName), readerName)
  check('request shows the employee code', !!emp.employeeCode && cardText.includes(emp.employeeCode), emp.employeeCode)
  if (dept) check('request shows the department', cardText.includes(dept), dept)
  check('request shows current → requested shift', cardText.includes(before.shiftName) && cardText.includes(requestedName), `${before.shiftName} → ${requestedName}`)
  check('request shows the reason and submitted date', cardText.includes(reason) && /Submitted \d{1,2} \w{3} \d{4}/.test(cardText))
  check('request shows the requested shift timing (12-hour)', cardText.includes(`${hhmm(target.startTime)} – ${hhmm(target.endTime)}`), `${hhmm(target.startTime)} – ${hhmm(target.endTime)}`)
  check('request offers both Approve and Reject', (await card.getByRole('button', { name: 'Approve change' }).isEnabled()) && (await card.getByRole('button', { name: 'Reject' }).isEnabled()))

  // Reject with a note so the reader's real shift is NOT changed.
  const note = 'QA automation — rejected, shift unchanged'
  await card.getByLabel('Decision note (optional)').fill(note)
  const decisionCall = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/v1/shifts/change-requests/${request.id}/decision`), { timeout: 15_000 })
  await card.getByRole('button', { name: 'Reject' }).click()
  const sent = JSON.parse((await decisionCall).postData() || '{}')
  check('Reject posts approved=false with the typed note', sent.approved === false && sent.comment === note, JSON.stringify(sent))
  decided = true
  const toastSeen = await page.getByText(`Shift request rejected — ${readerName} stays on ${before.shiftName}`).waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check('reject shows a success toast naming the employee and shift', toastSeen)
  const cardGone = await card.waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)
  check('rejected request leaves the list (list refreshed)', cardGone)
  if (pendingNow === 1) {
    check('empty queue shows "All caught up"', await page.getByText('All caught up').waitFor({ timeout: 15_000 }).then(() => true, () => false))
    await page.waitForFunction(() => !/\d/.test(document.querySelector('#tab-requests')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {})
    check('badge clears once the queue is empty', !/\d/.test(await page.locator('#tab-requests').innerText()))
  }

  const pendingAfter = (await call(owner, 'GET', '/v1/shifts/change-requests/pending')).json || []
  check('API: request is no longer pending', !pendingAfter.some((r) => r.id === request.id))
  const mine = (await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []
  const row = mine.find((r) => r.id === request.id)
  check('API: request is REJECTED with the note', row?.status === 'REJECTED' && row?.decisionNote === note, `${row?.status} "${row?.decisionNote}"`)
  const after = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
  check('API: reader shift is unchanged', after.shiftPolicyId === before.shiftPolicyId && after.effectiveFrom === before.effectiveFrom
    && after.upcomingShiftPolicyId === before.upcomingShiftPolicyId, `${before.shiftName} → ${after.shiftName}`)

  // Employee scope cannot read the queue the tab depends on.
  const denied = await call(reader, 'GET', '/v1/shifts/change-requests/pending')
  check('employee login cannot read the pending queue', denied.status === 403, `${denied.status}`)

  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/shift-requests-live.png', fullPage: true })
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))

  // Employee view: the tab is gated on attendance.regularization.approve, so a
  // reader must neither see it nor fire the 403-bound pending-queue GET.
  const readerPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const readerQueueCalls = []
  readerPage.on('request', (r) => { if (r.url().includes('/v1/shifts/change-requests/pending')) readerQueueCalls.push(r.url()) })
  await readerPage.goto(base + '/login')
  await readerPage.locator('input[type=email]').fill('reader@unifiedtree.demo')
  await readerPage.locator('input[type=password]').fill(password)
  await readerPage.locator('button[type=submit]').click()
  await readerPage.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await readerPage.goto(base + '/hrms/shifts')
  await readerPage.waitForLoadState('networkidle').catch(() => {})
  await readerPage.waitForTimeout(1500)
  check('employee view has no Shift requests tab', (await readerPage.getByRole('tab', { name: /^Shift requests/ }).count()) === 0)
  check('employee view never requests the pending queue', readerQueueCalls.length === 0, readerQueueCalls.join(' | '))
} catch (error) {
  // An aborted flow must not print "N/N checks passed".
  check('flow completed without an exception', false, String(error).split('\n')[0])
} finally {
  await browser.close()
  // Never leave the fixture PENDING: decide it (rejected) through the API if the
  // browser flow did not get that far. Rows are kept, not deleted.
  if (!decided) {
    const r = await call(owner, 'POST', `/v1/shifts/change-requests/${request.id}/decision`, { approved: false, comment: 'QA automation cleanup — rejected' })
    console.log('cleanup reject', r.status)
  }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-shift-requests.json', JSON.stringify({ ranAt: new Date().toISOString(), request: request.id, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
