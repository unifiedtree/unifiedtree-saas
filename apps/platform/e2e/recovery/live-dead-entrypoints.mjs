// Wired-but-unreachable screens — browser acceptance against the local recovery
// runtime. Checks the new entry points added for pages that had no link:
//   - My Salary (/me/salary) from My Workspace (/me) and My Payslips (/me/payslips)
//   - HR Configuration (/hrms/settings/hr-configuration, in HRMS settings) and its old Work time link (/hrms/settings/work-time)
//   - the employee workspace Overview "Expenses" link (was /hrms/expense, a dead route)
//   - "Apply leave" on /me opening the Apply tab an employee can actually use
// Read-only: no fixtures are written.
//
// Run from apps/platform:  node e2e/recovery/live-dead-entrypoints.mjs
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const readerEmployeeId = '22222222-2222-2222-2222-222222222222'

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}

// Real data the pages should show — read straight from the API.
const readerApi = await apiLogin('reader@unifiedtree.demo')
const salaryRes = await fetch(`${api}/v1/payroll/structures/me`, { headers: readerApi })
const salary = salaryRes.ok ? await salaryRes.json() : null
console.log('reader salary structure', salaryRes.status, salary?.id, salary?.ctcMonthly)

const browser = await chromium.launch({ headless: true })
const pageErrors = [], failedApi = []
const allPageErrors = [], allFailedApi = []

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Every sign-in currently produces two 401→refresh(422) round trips
  // (HRMS_MODULE_ACTION_LEDGER.md, auth section). Measure the pages, not the login.
  await page.waitForTimeout(1500)
  resetCounters()
  return { ctx, page }
}
function resetCounters() { pageErrors.length = 0; failedApi.length = 0 }
function assertClean(label) {
  check(`${label}: no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check(`${label}: no failed API calls`, failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  allPageErrors.push(...pageErrors); allFailedApi.push(...failedApi)
  resetCounters()
}
const path = (page) => new URL(page.url()).pathname
const noAccess = async (page) => (await page.getByText(/don.t have (access|permission)|no access|not activated/i).count()) > 0

try {
  // ── Employee (reader@) ─────────────────────────────────────────────────
  {
    const { ctx, page } = await session('reader@unifiedtree.demo')

    await page.goto(base + '/me')
    await page.getByText('Your balance this year').waitFor({ timeout: 30_000 })
    const salaryCard = page.getByRole('button', { name: /^Salary.*View/ })
    check('/me shows a My Salary shortcut to the employee', (await salaryCard.count()) === 1)

    const applyLeave = page.getByRole('button', { name: /Apply for leave/ })
    check('/me shows "Apply leave" to the employee', (await applyLeave.count()) === 1)
    check('/me shows the Onboarding Tasks shortcut (employee holds onboarding.instance.read / task.complete)',
      (await page.getByText('Onboarding tasks', { exact: true }).count()) === 1)
    assertClean('/me')

    await applyLeave.click()
    await page.waitForURL((u) => u.pathname === '/hrms/leave', { timeout: 15_000 })
    await page.waitForTimeout(1500)
    const tab = new URL(page.url()).searchParams.get('tab')
    check('"Apply leave" lands on /hrms/leave with the Apply tab selected', tab === 'apply', page.url().replace(base, ''))
    check('leave page is not a NoAccess screen for the employee', !(await noAccess(page)))
    assertClean('/hrms/leave?tab=apply')

    await page.goto(base + '/me')
    await page.getByRole('button', { name: /^Salary.*View/ }).click()
    await page.waitForURL((u) => u.pathname === '/me/salary', { timeout: 15_000 })
    await page.getByRole('heading', { name: 'Salary', level: 1 }).waitFor({ timeout: 30_000 })
    check('My Salary shortcut on /me opens /me/salary', path(page) === '/me/salary')
    if (salary) {
      const body = await page.locator('main').innerText().catch(() => page.locator('body').innerText())
      const eff = new Date(`${salary.effectiveFrom}T00:00:00`)
      const effText = `${eff.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][eff.getMonth()]} ${eff.getFullYear()}`
      check('/me/salary shows the real structure (effective date from GET /v1/payroll/structures/me)', body.includes(effText), effText)
      const firstEarning = salary.earnings?.[0]?.componentName
      check('/me/salary lists a real earnings component', !firstEarning || body.includes(firstEarning), firstEarning)
    } else {
      check('/me/salary renders its empty state when the API returns none', (await page.getByText('No salary structure yet').count()) === 1)
    }
    assertClean('/me/salary')

    await page.goto(base + '/me/payslips')
    await page.getByRole('heading', { name: 'Payslips', level: 1 }).waitFor({ timeout: 30_000 })
    const payslipLink = page.getByRole('button', { name: /Salary structure/ })
    check('/me/payslips shows a "My salary structure" action', (await payslipLink.count()) === 1)
    await payslipLink.click()
    await page.waitForURL((u) => u.pathname === '/me/salary', { timeout: 15_000 })
    await page.getByRole('heading', { name: 'Salary', level: 1 }).waitFor({ timeout: 30_000 })
    check('"My salary structure" on /me/payslips opens /me/salary', path(page) === '/me/salary')
    assertClean('/me/payslips → /me/salary')

    resetCounters()
    await ctx.close()
  }

  // ── Owner ──────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await session('owner@unifiedtree.demo')

    await page.goto(base + '/hrms/settings/hr-configuration')
    await page.getByRole('heading', { name: 'Work week', exact: true }).waitFor({ timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    const weekHeadings = await page.getByRole('heading', { name: 'Work week', exact: true }).count()
    check('/hrms/settings/hr-configuration shows the Work week section to the owner', weekHeadings === 1, `${weekHeadings} found`)
    assertClean('/hrms/settings/hr-configuration')
    await page.goto(base + '/hrms/settings/work-time')
    await page.getByRole('heading', { name: 'HR Configuration' }).waitFor({ timeout: 30_000 })
    check('/hrms/settings/work-time still opens (HR Configuration, at its new address)', path(page) === '/hrms/settings/hr-configuration')
    await page.waitForTimeout(1500)
    check('HR Configuration loaded real settings (no load error)', !(await page.getByText(/Failed to load|Couldn.t load/i).count()))
    assertClean('/hrms/settings/work-time')

    await page.goto(base + `/hrms/employees/${readerEmployeeId}`)
    await page.getByRole('tab', { name: /^Expenses/ }).waitFor({ timeout: 30_000 })
    await page.getByRole('tab', { name: /^Expenses/ }).click()
    await page.getByRole('button', { name: 'Open Expenses' }).or(page.getByRole('link', { name: 'Open Expenses' })).first().click()
    await page.waitForURL((u) => u.pathname.startsWith('/hrms/expense'), { timeout: 15_000 })
    check('workspace Expenses tab "Open Expenses" lands on /hrms/expenses', path(page) === '/hrms/expenses', path(page))
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 })
    const h1 = await page.getByRole('heading', { level: 1 }).first().innerText()
    check('expenses page renders (not a 404 / NoAccess)', /expense/i.test(h1) && !(await noAccess(page)), h1)
    assertClean('employee workspace → /hrms/expenses')

    mkdirSync('test-results/recovery', { recursive: true })
    await page.screenshot({ path: 'test-results/recovery/dead-entrypoints-live.png', fullPage: true })
    await ctx.close()
  }
} catch (e) {
  check('script completed without an exception', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-dead-entrypoints.json', JSON.stringify({ ranAt: new Date().toISOString(), checks, pageErrors: allPageErrors, failedApi: allFailedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
