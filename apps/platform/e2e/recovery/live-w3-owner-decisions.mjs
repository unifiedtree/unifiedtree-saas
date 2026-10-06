// Live check for fix/owner-decisions-6oct: the owner's 6 Oct decisions and three regressions.
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3046 node e2e/recovery/live-w3-owner-decisions.mjs
//
// What it proves, against the local backend and database:
//  - HR Configuration: no "Extend automatically" switch; the probation section is there.
//  - Payroll: the runs list and the dashboard's figures ask for the chosen company (companyId=…), and
//    GET /v1/payroll/dashboard/kpis?companyId= answers.
//  - /me/salary: Salary history rows carry structureId, and the page logs no React "key" warning.
//  - Dashboard on a past day (22 Sep 2026): Total employees counts leavers on their last working day,
//    the same people the database says were employed that day.
//  - 402 MODULE_PAUSED (stubbed in the browser): "Payment needed" in place of the page, Pay now for the
//    owner; the plan page stays open. Screenshots at 1440 and 390 wide.
// It creates nothing.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3046'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (path) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

// The check-in prompt after sign-in: mark it as already shown for the visit (the app's own session mark).
const markPromptShown = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t) => p.find((x) => x.type === t)?.value ?? ''
  const today = `${get('year')}-${get('month')}-${get('day')}`
  const original = Storage.prototype.getItem
  Storage.prototype.getItem = function (key) {
    if (typeof key === 'string' && key.startsWith('ut.punch-prompt.opened:')) return today
    return original.call(this, key)
  }
}

const browser = await chromium.launch()
async function session(email, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript(markPromptShown)
  const page = await ctx.newPage()
  const errors = [], keyWarnings = [], requests = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && /unique "key"|key" prop/.test(m.text())) keyWarnings.push(m.text().slice(0, 160)) })
  page.on('request', (r) => { if (r.url().includes('/v1/')) requests.push(r.url()) })
  page.on('response', (r) => { if (r.url().includes('/v1/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { ctx, page, errors, keyWarnings, requests }
}
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

try {
  // ── API ──
  const owner = await apiLogin('owner@unifiedtree.demo')
  const kAll = await owner('/v1/payroll/dashboard/kpis')
  const kCo = await owner(`/v1/payroll/dashboard/kpis?companyId=${company}`)
  check('KPIs answer with and without a company', kAll.status === 200 && kCo.status === 200, `${kAll.status}/${kCo.status}`)
  // One-company workspace: the company's figures are the workspace's.
  check('one company: the company KPIs equal the workspace KPIs', JSON.stringify(kAll.json) === JSON.stringify(kCo.json))

  const day = '2026-09-22'
  const stats = await owner(`/v1/admin/dashboard/stats?companyId=${company}&date=${day}`)
  // Employed that day: joined (no joining date: the record existed) by then, and not gone before it.
  const expected = Number(sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}'
    and coalesce(date_of_joining, (created_at at time zone 'Asia/Kolkata')::date) <= '${day}'
    and (employment_status not in ('EXITED','TERMINATED','RESIGNED') or coalesce(last_working_day, date_of_termination) >= '${day}')`))
  const lastDay = Number(sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(last_working_day, date_of_termination) = '${day}'`))
  check(`past day: Total employees counts leavers on their last working day (${lastDay} of them)`, stats.status === 200 && Number(stats.json?.headcount) === expected, `headcount ${stats.json?.headcount}, employed that day ${expected}`)
  const att = await owner(`/v1/attendance/dashboard?date=${day}&includeLeavers=true&includeSelf=true`)
  const roster = new Set((att.json?.staffStatuses ?? []).map((s) => s.employeeCode))
  const lastDayCodes = sql(`select employee_code from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(last_working_day, date_of_termination) = '${day}'`).split(/\r?\n/).filter(Boolean)
  check('past day: those leavers are on that day’s roster too', att.status === 200 && lastDayCodes.every((c) => roster.has(c)), `${lastDayCodes.filter((c) => roster.has(c)).length}/${lastDayCodes.length} on the roster`)
  // 22 Sep is a Tuesday: nobody on the roster has it as a weekly off, so Total employees = scheduled.
  const offs = Number(sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and weekly_off_days like '%2%'`))
  if (offs === 0) check('past day: Total employees equals the people on that day’s roster', Number(stats.json?.headcount) === roster.size, `${stats.json?.headcount} vs ${roster.size}`)
  const statsToday = await owner(`/v1/admin/dashboard/stats?companyId=${company}`)
  check('today’s summary still answers', statsToday.status === 200 && statsToday.json?.headcount != null)

  const reader = await apiLogin('reader@unifiedtree.demo')
  const hist = await reader('/v1/payroll/structures/me/history')
  check('salary history rows carry structureId', hist.status === 200 && (hist.json ?? []).every((r) => typeof r.structureId === 'string'), `${hist.status}, ${(hist.json ?? []).length} rows`)

  // ── HR Configuration ──
  {
    const s = await session('owner@unifiedtree.demo')
    await s.page.goto(base + '/hrms/settings'); await settle(s.page)
    await s.page.getByText('Remind managers and HR').first().waitFor({ timeout: 30_000 }).catch(() => {})
    const body = await s.page.locator('body').innerText()
    check('HR Configuration: probation section shows', body.includes('Remind managers and HR'))
    check('HR Configuration: no "Extend automatically" switch', !body.includes('Extend automatically') && !body.includes('auto-extends'))

    // ── Payroll follows the chosen company ──
    s.requests.length = 0
    await s.page.goto(base + '/hrms/payroll/runs'); await settle(s.page)
    check('Payroll runs ask for the chosen company', s.requests.some((u) => u.includes('/v1/payroll/runs?') && u.includes(`companyId=${company}`)), s.requests.filter((u) => u.includes('/payroll/runs')).slice(0, 2).join(' '))
    s.requests.length = 0
    await s.page.goto(base + '/hrms/payroll-dashboard'); await settle(s.page)
    check('Payroll dashboard KPIs ask for the chosen company', s.requests.some((u) => u.includes('/v1/payroll/dashboard/kpis') && u.includes(`companyId=${company}`)))

    // ── Directory ──
    await s.page.goto(base + '/hrms/employees'); await settle(s.page)
    await s.page.getByRole('heading', { name: 'Employee Master' }).waitFor({ timeout: 30_000 }).catch(() => {})
    check('Workforce directory still loads (one company: as before)', (await s.page.locator('body').innerText()).includes('Employee Master'))

    // ── Dashboard: seats line and a past day ──
    await s.page.goto(base + '/dashboard'); await settle(s.page)
    check('dashboard loads', (await s.page.locator('body').innerText()).length > 200)

    // ── Payment needed (402 MODULE_PAUSED, stubbed) ──
    const paused = { code: 'MODULE_PAUSED', error: 'subscription_lapsed', moduleKey: 'hrms', companyId: company, dueAmountInr: 12000, dueSince: '2026-11-06', graceEndedOn: '2026-11-13', canPay: true, message: 'HRMS is paused because the payment due on 6 Nov was not received. Pay to continue.' }
    await s.page.route('**/v1/hrms/employees**', (r) => r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify(paused) }))
    await s.page.goto(base + '/hrms/employees')
    const shown = await s.page.getByTestId('module-paused').waitFor({ timeout: 30_000 }).then(() => true, () => false)
    const text = shown ? await s.page.getByTestId('module-paused').innerText() : ''
    check('MODULE_PAUSED: "Payment needed" in place of the page', shown && text.includes('Payment needed') && text.includes('₹12,000'))
    check('MODULE_PAUSED: the owner gets Pay now', text.includes('Pay now'))
    await s.page.screenshot({ path: `${shots}/w46-payment-needed-1440.png` })
    await s.page.getByRole('button', { name: 'Pay now' }).click().catch(() => {})
    await s.page.waitForURL((u) => u.pathname === '/plan', { timeout: 15_000 }).catch(() => {})
    await settle(s.page)
    check('Pay now opens the plan page, which stays open', new URL(s.page.url()).pathname === '/plan' && !(await s.page.getByTestId('module-paused').isVisible().catch(() => false)))
    await s.page.unroute('**/v1/hrms/employees**')
    check('no page errors or 5xx (owner)', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }
  {
    // Phone width, someone who can't pay.
    const s = await session('reader@unifiedtree.demo', 390)
    await s.page.goto(base + '/me/salary'); await settle(s.page)
    await s.page.waitForTimeout(1500)
    check('/me/salary: no React key warning', s.keyWarnings.length === 0, s.keyWarnings[0] || '')
    const paused = { code: 'MODULE_PAUSED', moduleKey: 'hrms', dueAmountInr: null, dueSince: '2026-11-06', graceEndedOn: '2026-11-13', canPay: false, message: null }
    await s.page.route('**/v1/payroll/structures/me**', (r) => r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify(paused) }))
    await s.page.goto(base + '/me/salary')
    const shown = await s.page.getByTestId('module-paused').waitFor({ timeout: 30_000 }).then(() => true, () => false)
    const text = shown ? await s.page.getByTestId('module-paused').innerText() : ''
    check('MODULE_PAUSED, no billing permission: "ask your owner", no Pay button', shown && text.includes('Ask your workspace owner to pay') && !text.includes('Pay now'))
    await s.page.screenshot({ path: `${shots}/w46-payment-needed-390.png` })
    check('no page errors or 5xx (employee)', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }
} catch (e) {
  check('test ran to the end', false, String(e).slice(0, 300))
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
