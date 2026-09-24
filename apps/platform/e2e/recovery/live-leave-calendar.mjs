// Leave Management › Leave Calendar ("Who's away") — browser acceptance against
// the local recovery runtime. Applies a 2-day leave for reader@ through the
// real API, approves it as the owner, then checks the calendar places
// "Reader User" on both days, month navigation (Prev / Next / Today), the
// empty and error states, and the employee's own view. The fixture request is
// cancelled through the API and deleted in the finally block.
//
// Run from apps/platform:  node e2e/recovery/live-leave-calendar.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const now = new Date()
const monthTitle = (offset) => { const d = new Date(now.getFullYear(), now.getMonth() + offset, 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

// Candidate Mon–Fri pairs inside the current month, future first.
const pairs = []
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
for (let day = 1; day < daysInMonth; day++) {
  const a = new Date(now.getFullYear(), now.getMonth(), day)
  const b = new Date(now.getFullYear(), now.getMonth(), day + 1)
  if (a.getDay() >= 1 && b.getDay() <= 5 && b.getDay() >= 1) pairs.push([ymd(a), ymd(b)])
}
pairs.sort((x, y) => (x[0] >= ymd(now) ? 0 : 1) - (y[0] >= ymd(now) ? 0 : 1))

const balances = await (await fetch(`${api}/v1/leave/my/balances`, { headers: reader })).json()
const type = balances.find((b) => b.available >= 2)
if (!type) throw new Error('reader has no leave type with 2 days available')

let fixture = null
for (const [startDate, endDate] of pairs) {
  const r = await fetch(`${api}/v1/leave/apply?companyId=${company}`, { method: 'POST', headers: reader,
    body: JSON.stringify({ leaveTypeId: type.leaveTypeId, startDate, endDate, duration: 'FULL_DAY', reason: 'QA automation — leave calendar acceptance' }) })
  if (r.ok) { fixture = await r.json(); break }
  console.log(`apply ${startDate}→${endDate} refused: ${r.status} ${(await r.text()).slice(0, 120)}`)
}
if (!fixture) throw new Error('could not apply a 2-day fixture leave this month')
console.log('fixture leave', fixture.id, fixture.startDate, '→', fixture.endDate, type.leaveTypeName)

const browser = await chromium.launch({ headless: true })
const pageErrors = [], failedApi = [], historyCalls = []
async function openAs(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.on('request', (r) => { if (r.url().includes('/v1/leave/approvals/history')) historyCalls.push(r.url()) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // The login flow itself currently produces two 401→refresh(422) round trips
  // on every sign-in. Measure the page, not the login: reset once we are in.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0
  return { context, page }
}
const heading = (page, offset) => page.getByRole('heading', { name: `${monthTitle(offset)} — Who's away?` })
const cell = (page, date) => page.locator(`[data-date="${date}"]`)

try {
  // ── Approve the fixture as the owner ─────────────────────────────────────
  const decided = await fetch(`${api}/v1/leave/${fixture.id}/decision`, { method: 'POST', headers: owner, body: JSON.stringify({ status: 'APPROVED', comment: 'QA leave calendar acceptance' }) })
  const decidedBody = decided.ok ? await decided.json() : { status: `HTTP ${decided.status}` }
  check('fixture leave approved through the API', decidedBody.status === 'APPROVED', decidedBody.status)

  // ── Owner (tenant-wide approvals history) ────────────────────────────────
  const { context: ownerCtx, page } = await openAs('owner@unifiedtree.demo')
  await page.goto(base + '/hrms/leave?tab=calendar')
  await heading(page, 0).waitFor({ timeout: 30_000 })
  check('calendar opens on the current month', true, monthTitle(0))
  check('fake stub content is gone', (await page.getByText('A. Stone').count()) === 0 && (await page.getByText('P. Mehta').count()) === 0 && (await page.getByText('May 2026 - Who').count()) === 0)
  await cell(page, fixture.startDate).getByText('Reader User').waitFor({ timeout: 15_000 })
  check('"Reader User" shown on the first leave day', true, fixture.startDate)
  check('"Reader User" shown on the second leave day', (await cell(page, fixture.endDate).getByText('Reader User').count()) > 0, fixture.endDate)
  const chip = await cell(page, fixture.startDate).innerText()
  check('day chip carries the leave type', chip.includes(type.leaveTypeName), chip.replace(/\s+/g, ' ').slice(0, 120))
  // The span proves the chip is the fixture, not some other Reader leave.
  const MON3 = MONTHS.map((m) => m.slice(0, 3))
  const [sy, sm, sd] = fixture.startDate.split('-').map(Number), [ey, em, ed] = fixture.endDate.split('-').map(Number)
  const span = `${sd} ${MON3[sm - 1]} – ${ed} ${MON3[em - 1]} ${ey}`
  check('day chip carries the fixture date span', chip.includes(span) && (await cell(page, fixture.endDate).innerText()).includes(span), span)
  const dayBefore = ymd(new Date(new Date(fixture.startDate + 'T00:00:00').getTime() - 86_400_000))
  check('day outside the span has no Reader chip', dayBefore.slice(0, 7) !== fixture.startDate.slice(0, 7) || (await cell(page, dayBefore).getByText('Reader User').count()) === 0, dayBefore)
  const list = page.getByRole('list', { name: 'Approved leave this month' })
  check('month list names Reader User with 2 days', (await list.locator('li').filter({ hasText: 'Reader User' }).filter({ hasText: '2 days' }).count()) > 0)
  check('today is marked', (await cell(page, ymd(now)).getByText('Today').count()) > 0, ymd(now))
  const firstSat = [...Array(7)].map((_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1)).find((d) => d.getDay() === 6)
  check('weekend day is labelled', (await cell(page, ymd(firstSat)).getByText('Weekend').count()) > 0, ymd(firstSat))

  const callsBefore = historyCalls.length
  await page.getByRole('button', { name: 'Next' }).click()
  await heading(page, 1).waitFor({ timeout: 10_000 })
  check('Next moves to the following month', true, monthTitle(1))
  check('fixture not placed in the following month', (await page.locator('[data-date]').getByText('Reader User').count()) === 0)
  check('empty state shown for a month without approved leave', await page.getByText('No one is on approved leave this month').waitFor({ timeout: 10_000 }).then(() => true, () => false))
  await page.getByRole('button', { name: 'Prev' }).click()
  await page.getByRole('button', { name: 'Prev' }).click()
  await heading(page, -1).waitFor({ timeout: 10_000 })
  check('Prev moves back two months', true, monthTitle(-1))
  await page.getByRole('button', { name: 'Today' }).click()
  await heading(page, 0).waitFor({ timeout: 10_000 })
  check('Today returns to the current month with the fixture', (await cell(page, fixture.startDate).getByText('Reader User').count()) > 0)
  check('Today button disabled on the current month', await page.getByRole('button', { name: 'Today' }).isDisabled())
  check('month navigation does not refetch the unfiltered list', historyCalls.length === callsBefore, `${historyCalls.length - callsBefore} extra history calls`)

  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/leave-calendar-live.png', fullPage: true })
  check('owner view: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('owner view: no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))

  // ── Error state + retry (history endpoint forced to fail) ────────────────
  let fail = true
  await page.route('**/v1/leave/approvals/history**', (route) => fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected"}' }) : route.continue())
  await page.goto(base + '/hrms/leave?tab=calendar')
  await page.getByText("Couldn't load the leave calendar").waitFor({ timeout: 30_000 })
  check('error state shown when the leave list fails', true)
  fail = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await cell(page, fixture.startDate).getByText('Reader User').waitFor({ timeout: 15_000 })
  check('Retry recovers and re-renders the calendar', true)
  await page.unroute('**/v1/leave/approvals/history**')

  // ── Honest truncation note (history reports more pages than the cap) ─────
  let seenPages = 0
  await page.route('**/v1/leave/approvals/history**', async (route) => {
    seenPages++
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, last: false, totalPages: 999, totalElements: 99_999 } })
  })
  await page.goto(base + '/hrms/leave?tab=calendar')
  const note = page.getByText(/most recently decided requests of 99999\. Older approvals are not placed on this calendar\./)
  check('page cap shows an honest "showing N of M" note', await note.waitFor({ timeout: 30_000 }).then(() => true, () => false), await note.textContent().catch(() => ''))
  check('page walk stops at the 10-page cap', seenPages === 10, `${seenPages} history pages requested`)
  await page.unroute('**/v1/leave/approvals/history**')
  await ownerCtx.close()

  // ── Employee (own approved leave only) ───────────────────────────────────
  const { context: readerCtx, page: rp } = await openAs('reader@unifiedtree.demo')
  await rp.goto(base + '/hrms/leave?tab=calendar')
  await heading(rp, 0).waitFor({ timeout: 30_000 })
  check('employee view explains its scope', (await rp.getByText('Your approved leave. The team view needs leave-approval access.').count()) > 0)
  await cell(rp, fixture.startDate).getByText('Reader User').waitFor({ timeout: 15_000 })
  check('employee sees their own approved leave on the calendar', true)
  await rp.screenshot({ path: 'test-results/recovery/leave-calendar-employee.png', fullPage: true })
  check('employee view: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('employee view: no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  await readerCtx.close()
} finally {
  await browser.close()
  try {
    await fetch(`${api}/v1/leave/${fixture.id}/cancel?reason=${encodeURIComponent('QA fixture cleanup')}`, { method: 'POST', headers: reader })
    sql(`DELETE FROM leave_mgmt.leave_requests WHERE id='${fixture.id}' AND tenant_id='${tenant}'`)
    console.log('fixture removed')
    const after = (await (await fetch(`${api}/v1/leave/my/balances`, { headers: reader })).json()).find((b) => b.leaveTypeId === type.leaveTypeId)
    console.log(`reader balance for ${type.leaveTypeName}: before ${type.available}, after ${after?.available}`)
  } catch (e) { console.log('fixture cleanup failed (left as QA record):', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-leave-calendar.json', JSON.stringify({ ranAt: new Date().toISOString(), fixture: fixture.id, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
