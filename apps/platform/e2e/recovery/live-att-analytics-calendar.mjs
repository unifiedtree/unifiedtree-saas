// Attendance Analytics (/hrms/att-analytics) — browser acceptance for the real
// month calendar, the period control and the punch-source panel against the
// local recovery runtime. Read-only: every number is compared with what
// GET /v1/attendance/dashboard/trend returns for the same range, so no fixture
// is inserted.
//
// Run from apps/platform:  node e2e/recovery/live-att-analytics-calendar.mjs
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// The page works in the browser's local calendar; this script runs on the same machine.
const now = new Date()
const today = ymd(now)
const monthFrom = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const prevFrom = ymd(prev)
const prevTo = ymd(new Date(prev.getFullYear(), prev.getMonth() + 1, 0))
const monthTitle = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
const prevTitle = `${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const owner = await login('owner@unifiedtree.demo')
const trendOf = async (from, to) => {
  const r = await fetch(`${api}/v1/attendance/dashboard/trend?from=${from}&to=${to}`, { headers: owner })
  if (!r.ok) throw new Error(`trend ${from}..${to}: ${r.status}`)
  return r.json()
}
const current = await trendOf(monthFrom, today)
const previous = await trendOf(prevFrom, prevTo)
// Prefer a day with a late mark or a present count so the comparison is not all zeros.
const probe = [...current].reverse().find((d) => d.late + d.present > 0) ?? current[current.length - 1]
const prevProbe = [...previous].reverse().find((d) => d.late + d.present > 0) ?? previous[Math.floor(previous.length / 2)]
console.log('probe day', probe.date, JSON.stringify(probe))
console.log('previous-month probe day', prevProbe.date, JSON.stringify(prevProbe))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], failedApi = [], apiCalls = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()) })
const cellLabel = async (date) => (await page.locator(`[data-testid="attendance-calendar"] [data-date="${date}"]`).getAttribute('aria-label', { timeout: 15_000 })) ?? ''
const expectedLabel = (d) => `${d.present} present, ${d.late} late, ${d.absent} absent`
let analyticsErrors = [], analyticsFailed = []
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // The login flow itself currently produces two 401→refresh(422) round trips
  // on every sign-in (recorded in HRMS_MODULE_ACTION_LEDGER.md, auth section).
  // Measure the page, not the login: reset the counters once we are in.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0; apiCalls.length = 0

  await page.goto(base + '/hrms/att-analytics')
  await page.getByRole('heading', { name: 'Attendance Analytics' }).waitFor({ timeout: 30_000 })
  check('page renders at /hrms/att-analytics', true)

  // ── Period control + dashboard blocks ──────────────────────────────────────
  const monthInput = page.getByLabel('Period month')
  check('period control defaults to the current month', (await monthInput.inputValue()) === monthFrom.slice(0, 7), await monthInput.inputValue())
  check('"Next period" is disabled on the current month', await page.getByRole('button', { name: 'Next period' }).isDisabled())
  await page.getByText('Attendance Trend').waitFor({ timeout: 15_000 })
  await page.locator('.recharts-line').first().waitFor({ timeout: 15_000 })
  check('Attendance Trend chart renders from the trend endpoint', apiCalls.some((u) => u.includes(`/v1/attendance/dashboard/trend?from=${monthFrom}&to=${today}`)))
  const sourcesCard = page.locator('.ut-card').filter({ hasText: 'Punch Sources Today' })
  await sourcesCard.getByText(/No check-ins recorded today|Biometric device|Face recognition|GPS|Manual entry|PIN|Manager override/).first().waitFor({ timeout: 15_000 })
  const srcApi = await (await fetch(`${api}/v1/attendance/dashboard/sources?date=${today}`, { headers: owner })).json()
  const srcTotal = srcApi.sources.reduce((a, s) => a + s.count, 0) + srcApi.unknown
  const srcText = await sourcesCard.innerText()
  check('Punch Sources panel matches GET /dashboard/sources', srcTotal === 0 ? srcText.includes('No check-ins recorded today') : srcApi.sources.filter((s) => s.count > 0).every((s) => srcText.includes(String(s.count))), `API total ${srcTotal}`)

  // Move the period back one month: reports + trend must re-query with that range.
  apiCalls.length = 0
  await page.getByRole('button', { name: 'Previous period' }).click()
  await page.getByText(`Late Marks · ${prevTitle.slice(0, 3)} ${prev.getFullYear()}`).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1200)
  check('period change re-queries late marks for the chosen month', apiCalls.some((u) => u.includes('/v1/reports/late-marks') && u.includes(`from=${prevFrom}`) && u.includes(`to=${prevTo}`)))
  check('period change re-queries the attendance summary for the chosen month', apiCalls.some((u) => u.includes('/v1/reports/attendance-summary') && u.includes(`from=${prevFrom}`) && u.includes(`to=${prevTo}`)))
  check('period change re-queries the trend for the chosen month', apiCalls.some((u) => u.includes(`/v1/attendance/dashboard/trend?from=${prevFrom}&to=${prevTo}`)))
  await page.getByRole('button', { name: 'Next period' }).click()
  await page.getByText(`Late Marks · ${monthTitle.slice(0, 3)} ${now.getFullYear()}`).waitFor({ timeout: 15_000 })

  // ── Calendar tab ───────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Attendance Calendar' }).or(page.getByRole('button', { name: 'Attendance Calendar' })).first().click()
  await page.getByRole('heading', { name: monthTitle }).waitFor({ timeout: 15_000 })
  check('calendar opens on the current month', true, monthTitle)
  check('static "May 2026" mock is gone', (await page.getByText('May 2026').count()) === 0 || monthTitle === 'May 2026')
  const label = await cellLabel(probe.date)
  check(`calendar cell ${probe.date} matches GET /dashboard/trend`, label.includes(expectedLabel(probe)), label)
  const futureDays = await page.locator('[data-testid="attendance-calendar"] button[data-date]').evaluateAll((els, t) => els.filter((e) => e.getAttribute('data-date') > t).length, today)
  check('no clickable cells after today', futureDays === 0, String(futureDays))
  check('calendar "Next month" is disabled on the current month', await page.getByRole('button', { name: 'Next month' }).isDisabled())

  await page.getByRole('button', { name: 'Previous month' }).click()
  await page.getByRole('heading', { name: prevTitle }).waitFor({ timeout: 15_000 })
  const prevLabel = await cellLabel(prevProbe.date)
  check(`Prev → ${prevTitle}; cell ${prevProbe.date} matches the API`, prevLabel.includes(expectedLabel(prevProbe)), prevLabel)
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('heading', { name: monthTitle }).waitFor({ timeout: 15_000 })
  check(`Next → back to ${monthTitle}`, true)

  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/att-analytics-calendar-live.png', fullPage: true })
  analyticsErrors = [...pageErrors]; analyticsFailed = [...failedApi]
  check('no uncaught page errors on /hrms/att-analytics', analyticsErrors.length === 0, analyticsErrors.slice(0, 3).join(' | '))
  check('no failed API calls from /hrms/att-analytics', analyticsFailed.length === 0, analyticsFailed.slice(0, 3).join(' | '))

  // ── Drill-down: click a day → Daily Logs filtered to that date ─────────────
  await page.locator(`[data-testid="attendance-calendar"] [data-date="${probe.date}"]`).click()
  await page.waitForURL((u) => u.pathname === '/hrms/attendance', { timeout: 15_000 })
  const url = new URL(page.url())
  check('day click lands on /hrms/attendance?tab=team&date=…', url.searchParams.get('tab') === 'team' && url.searchParams.get('date') === probe.date, url.search)
  const dateInput = page.getByLabel('Attendance date')
  await dateInput.waitFor({ timeout: 20_000 })
  check('Daily Logs date filter shows the clicked day', (await dateInput.inputValue()) === probe.date, await dateInput.inputValue())
  await page.screenshot({ path: 'test-results/recovery/att-analytics-calendar-drilldown.png', fullPage: true })
} catch (e) {
  check('scenario completed without an exception', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-att-analytics-calendar.json', JSON.stringify({ ranAt: new Date().toISOString(), probe, prevProbe, checks, pageErrors: analyticsErrors, failedApi: analyticsFailed }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
