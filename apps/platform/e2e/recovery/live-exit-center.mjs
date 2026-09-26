// Resignation & Exit page (/hrms/exit) — browser acceptance against the local
// recovery runtime. Creates a throw-away active employee through the real API,
// starts a notice period from the page, checks the row, the reload, the API
// state and the withdraw flow, then deletes the fixture. Also asserts the
// sidebar leaf now reaches its own route (it used to collide with /hrms/fnf).
//
// Run from apps/platform:  node e2e/recovery/live-exit-center.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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
const iso = (d) => d.toISOString().slice(0, 10)
const today = iso(new Date(Date.now() + 5.5 * 3600_000))
const lastDay = iso(new Date(Date.now() + 5.5 * 3600_000 + 30 * 86_400_000))
// Date fields use the shared calendar: the label points at a trigger button, so
// a date is picked year → month → day in the "Choose date" popover.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
async function pickDate(page, trigger, isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number)
  await trigger.click()
  const calendar = page.getByRole('dialog', { name: 'Choose date' })
  await calendar.getByRole('button', { name: 'Choose year' }).click()
  await calendar.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await calendar.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await calendar.getByRole('gridcell', { name: new RegExp(`, ${d} ${MONTHS[m - 1]} ${y}`) }).click()
  await calendar.waitFor({ state: 'hidden' })
}

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const owner = await login('owner@unifiedtree.demo')
const suffix = randomUUID().slice(0, 6)
const fixtureName = `Qa Exit${suffix}`
const created = await fetch(`${api}/v1/hrms/employees`, { method: 'POST', headers: owner, body: JSON.stringify({ companyId: company, firstName: 'Qa', lastName: `Exit${suffix}`, email: `qa.exit.${suffix}@unifiedtree.demo` }) })
if (!created.ok) throw new Error(`fixture employee: ${created.status} ${await created.text()}`)
const fixture = await created.json()
console.log('fixture employee', fixture.id, fixture.employeeCode)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], failedApi = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
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
  pageErrors.length = 0; failedApi.length = 0

  await page.goto(base + '/hrms/exit')
  await page.getByRole('heading', { name: 'Resignation & exit' }).waitFor({ timeout: 30_000 })
  check('page renders at /hrms/exit', true)
  check('sidebar leaf "Resignation & Exit" points at /hrms/exit', (await page.locator('a[href="/hrms/exit"]').count()) > 0)
  check('sidebar leaf "Full & Final Settlement" still points at /hrms/fnf', (await page.locator('a[href="/hrms/fnf"]').count()) > 0)
  await page.getByRole('button', { name: 'On notice' }).or(page.getByRole('tab', { name: 'On notice' })).first().waitFor({ timeout: 10_000 })

  // Start a notice period from the page.
  await page.getByRole('button', { name: 'Start notice' }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Employee').fill(fixtureName)
  await drawer.getByRole('option').filter({ hasText: fixtureName }).first().click({ timeout: 15_000 })
  await pickDate(page, drawer.getByLabel('Last working day'), lastDay)
  await drawer.locator('#notice-reason').fill('QA automation — exit page acceptance')
  await drawer.getByRole('button', { name: 'Start notice' }).click()
  await page.getByText('is now serving notice').waitFor({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: fixtureName })
  await row.waitFor({ timeout: 15_000 })
  check('new notice appears in the On notice table', true)
  check('row shows the last working day', (await row.innerText()).includes(String(new Date(`${lastDay}T00:00:00`).getDate())))

  await page.reload()
  await page.getByRole('row').filter({ hasText: fixtureName }).waitFor({ timeout: 30_000 })
  check('notice persists across reload', true)
  const viaApi = await (await fetch(`${api}/v1/hrms/employees/${fixture.id}`, { headers: owner })).json()
  check('API shows NOTICE_PERIOD with the recorded dates', viaApi.employmentStatus === 'NOTICE_PERIOD' && viaApi.lastWorkingDay === lastDay && viaApi.noticeStartDate === today, `${viaApi.employmentStatus} ${viaApi.noticeStartDate}→${viaApi.lastWorkingDay}`)

  // Withdraw it again through the confirm dialog.
  await page.getByRole('row').filter({ hasText: fixtureName }).getByRole('button', { name: 'Withdraw notice' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw notice' }).click()
  await page.getByText('is active again').waitFor({ timeout: 15_000 })
  await page.getByRole('row').filter({ hasText: fixtureName }).waitFor({ state: 'detached', timeout: 15_000 })
  check('withdrawn notice leaves the On notice list', true)
  const afterApi = await (await fetch(`${api}/v1/hrms/employees/${fixture.id}`, { headers: owner })).json()
  check('API shows ACTIVE after withdrawal', afterApi.employmentStatus === 'ACTIVE', afterApi.employmentStatus)

  // Employee-scope login is denied the list the page depends on.
  const reader = await login('reader@unifiedtree.demo')
  const denied = await fetch(`${api}/v1/hrms/employees?status=NOTICE_PERIOD&page=0&size=20`, { headers: reader })
  check('employee login cannot list who is on notice', denied.status === 403, `${denied.status}`)

  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/exit-center-live.png', fullPage: true })
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  try { sql(`DELETE FROM hrms.employees WHERE id='${fixture.id}' AND tenant_id='${tenant}'`); console.log('fixture removed') }
  catch (e) { console.log('fixture cleanup failed (left as QA record):', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-exit-center.json', JSON.stringify({ ranAt: new Date().toISOString(), fixture: fixture.id, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
