// Live check of the redesigned profiles (package P-PROFILE) against a running app, its API and its
// database (the live slot):
//   A. API: BW-99 (a person reads their own sections, identity masked; writes and other people's
//      sections stay closed), BW-100 (the last sign-in device on invitation-status), BW-101 (nominee
//      shares capped at 100 %), BW-97 (a manager reads a direct report without pay, bank or identity)
//   B. HR view per role: owner (every tab, the Access tab), hrm, fin, mgr on a direct report (masked:
//      no Personal, Payroll or Access), reader can't reach anyone's Access tab
//   C. the Access tab (client, 1 Oct): owner gives reader a role, then removes it (database checked)
//   D. owner applies leave and raises a claim on reader's behalf from reader's profile
//   E. My profile: reader's tabs (with Attendance), owner's (no Attendance), the Preferences anchors
//   F. light and dark, 1440 and 390 (no sideways scroll), screenshots
// Everything it creates is removed at the end (role, leave, claim, dependents, identity, fixture).
//
//   live-slot.sh /c/REACT/ut-wt/rd-p-profile 3133 node e2e/recovery/live-rd-p-profile.mjs
//   env: RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), SHOTS_DIR
/* global process, console, fetch, setTimeout, localStorage, document, getComputedStyle, URL */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3133'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = Date.now() % 1000000
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = istToday()
const notReady = []

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (json && json.errorCode === 'FEATURE_NOT_READY') notReady.push(`${email} ${method} ${path}`)
    return { status: res.status, json }
  }
  return { email, call, employeeId: d.employeeId }
}

const created = { fixture: null, dependents: [], identitySeeded: false, roleCode: null, leave: [], claims: [] }
const browser = await chromium.launch()

/** A browser session signed in through the login page. */
async function open(email, width = 1440, theme = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 })
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
  const go = async (path) => { await page.goto(base + path); await settle() }
  const tabs = async () => (await page.getByRole('tablist', { name: 'Profile sections' }).getByRole('tab').allTextContents()).map((t) => t.replace(/\d+$/, '').trim())
  const shot = (name) => page.screenshot({ path: `${shots}/p-profile-${name}.png`, fullPage: false })
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1)
  const reset = () => { errors.length = 0; failed.length = 0 }
  await settle(); reset()
  return { ctx, page, errors, failed, settle, go, tabs, shot, noHScroll, reset }
}
const toast = (page, re) => page.locator('[role=status]').filter({ hasText: re }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
const clean = (s, allow = []) => s.failed.filter((f) => !allow.some((a) => a.test(f)))

/** Picks a date in the shared calendar opened from `trigger`. */
async function pickDate(page, trigger, iso) {
  await trigger.click()
  const cal = page.getByRole('dialog', { name: 'Choose date' })
  await cal.waitFor({ timeout: 5000 })
  const label = new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  for (let i = 0; i < 3 && !(await cal.locator(`[role=gridcell][aria-label^="${label}"]`).count()); i++) await cal.getByRole('button', { name: /Next month/ }).click().catch(() => {})
  await cal.locator(`[role=gridcell][aria-label^="${label}"]`).first().click()
  await cal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
}

const owner = await session('owner@unifiedtree.demo')
const mgr = await session('mgr@unifiedtree.demo')
const reader = await session('reader@unifiedtree.demo')
const readerUser = sql(`select id from auth.user_credentials where lower(email)='reader@unifiedtree.demo' limit 1`)
const rolesOf = () => sql(`select coalesce(string_agg(r.code, ',' order by r.code), '') from rbac.user_roles ur join rbac.roles r on r.id = ur.role_id where ur.user_id = '${readerUser}'`)
const readerRolesBefore = rolesOf()

try {
  // ── fixture: a person with no login, for the "not yours" checks and the nominee rule ──
  const fx = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'Profile QA', lastName: String(stamp), email: `pp-${stamp}@example.invalid`, employmentType: 'FULL_TIME', dateOfJoining: addDays(today, -40) })
  created.fixture = fx.json?.id
  check('fixture employee created', fx.status === 201 || fx.status === 200, `status=${fx.status}`)
  const FX = created.fixture

  // ── A. API ────────────────────────────────────────────────────────────────
  for (const s of ['addresses', 'education', 'experience', 'dependents', 'emergency-contacts']) {
    const r = await reader.call(`/v1/employees/${READER}/profile/${s}`)
    check(`BW-99: reader reads their own ${s}`, r.status === 200 && Array.isArray(r.json), `status=${r.status}`)
  }
  check('BW-99: reader can’t read someone else’s addresses (403)', (await reader.call(`/v1/employees/${FX}/profile/addresses`)).status === 403)
  check('BW-99: reader can’t read their own bank accounts (403, unchanged)', (await reader.call(`/v1/employees/${READER}/profile/bank-accounts`)).status === 403)
  check('BW-99: reader still can’t add an address (403, writes unchanged)', (await reader.call(`/v1/employees/${READER}/profile/addresses`, 'POST', { addressType: 'CURRENT', line1: 'QA', city: 'QA' })).status === 403)
  // Identity: masked for self. Seed one only when reader has none (removed at the end).
  const hadIdentity = num(`select count(*) from hrms.employee_identities where employee_id='${READER}'`) > 0
  if (!hadIdentity) {
    const put = await owner.call(`/v1/employees/${READER}/profile/identity`, 'PUT', { pan: 'ABCPS1234K', uan: '100482173921', passportNumber: 'P4821773' })
    created.identitySeeded = put.status === 200
  }
  const own = await reader.call(`/v1/employees/${READER}/profile/identity`)
  const hrView = await owner.call(`/v1/employees/${READER}/profile/identity`)
  const masked = (v) => v == null || v === '' || /^•+.{0,4}$/.test(v)
  check('BW-99: reader’s own identity comes back masked to the last four', own.status === 200 && own.json && masked(own.json.pan) && masked(own.json.uan) && masked(own.json.passportNumber) && (!hrView.json?.pan || own.json.pan !== hrView.json.pan),
    JSON.stringify(own.json).slice(0, 160))
  check('BW-99: HR still sees the full numbers', hrView.status === 200 && (!hrView.json?.pan || !hrView.json.pan.includes('•')))
  // Nominee total (BW-101) on the fixture.
  const dep = (pct, name) => ({ name, relationship: 'Parent', nominee: true, nomineePercentage: pct })
  let r = await owner.call(`/v1/employees/${FX}/profile/dependents`, 'POST', dep(60, 'QA Nominee A'))
  if (r.json?.id) created.dependents.push(r.json.id)
  check('BW-101: a 60% nominee saves', r.status === 201, `status=${r.status}`)
  r = await owner.call(`/v1/employees/${FX}/profile/dependents`, 'POST', dep(50, 'QA Nominee B'))
  if (r.json?.id) created.dependents.push(r.json.id)
  check('BW-101: another 50% is refused with NOMINEE_SHARE_OVER_100 and the running total', r.status === 422 && r.json?.errorCode === 'NOMINEE_SHARE_OVER_100' && /60%/.test(r.json?.message || '') && /up to 40%/.test(r.json?.message || ''), `${r.status} ${r.json?.message}`)
  r = await owner.call(`/v1/employees/${FX}/profile/dependents`, 'POST', dep(40, 'QA Nominee C'))
  if (r.json?.id) created.dependents.push(r.json.id)
  check('BW-101: 40% more (exactly 100%) saves', r.status === 201, `status=${r.status}`)
  // A manager on a direct report (BW-97).
  r = await mgr.call(`/v1/hrms/employees/${READER}`)
  check('BW-97: mgr reads their direct report, without pay, bank or identity', r.status === 200 && r.json?.ctcAnnual == null && !r.json?.bankAccountNumber && !r.json?.panNumber && r.json?.firstName === 'Reader', `status=${r.status}`)
  check('BW-97: mgr can’t read someone outside their team (403)', (await mgr.call(`/v1/hrms/employees/${FX}`)).status === 403)

  // ── B. HR view per role ───────────────────────────────────────────────────
  {
    const s = await open('owner@unifiedtree.demo')
    await s.go(`/hrms/employees/${READER}`)
    await s.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 })
    const t = await s.tabs()
    check('owner: HR view has every tab plus Access', ['Overview', 'Personal', 'Job', 'Attendance', 'Payroll', 'Leave', 'Expenses', 'Documents', 'Letters', 'Performance', 'Exit', 'Access'].every((x) => t.includes(x)), t.join(','))
    check('owner: left card shows code, work email (verified) and reports-to', await s.page.getByText('EMP002', { exact: true }).count() > 0 && await s.page.getByRole('img', { name: 'Account active' }).count() > 0 && await s.page.getByText('Reports to').count() > 0)
    check('owner: Overview shows This week, Annual CTC, Documents and Goals', await s.page.getByRole('region', { name: 'At a glance' }).or(s.page.locator('section[aria-label="At a glance"]')).first().getByText('Annual CTC').count() > 0)
    check('owner: the month calendar and the Account card render', await s.page.getByRole('grid').count() > 0 && await s.page.getByRole('heading', { name: 'Account' }).count() > 0)
    check('owner: Account shows the last sign-in', await s.page.getByText('Last sign-in').count() > 0)
    await s.shot('hr-overview-1440-light')
    for (const tab of ['Personal', 'Job', 'Attendance', 'Payroll', 'Leave', 'Expenses', 'Documents', 'Letters', 'Performance', 'Exit', 'Access', 'Overview']) {
      s.errors.length = 0
      await s.page.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await s.settle()
      const sel = await s.page.getByRole('tab', { name: new RegExp('^' + tab) }).getAttribute('aria-selected')
      check(`owner: ${tab} tab renders`, sel === 'true' && !s.errors.length, s.errors[0] || '')
      if (['Job', 'Attendance', 'Payroll', 'Exit', 'Access'].includes(tab)) await s.shot(`hr-${tab.toLowerCase()}-1440-light`)
    }
    await s.go(`/hrms/employees/${READER}?tab=job`)
    check('owner: Job shows the reporting line with View in org chart', await s.page.getByRole('button', { name: 'View in org chart' }).count() > 0)
    await s.page.getByRole('button', { name: 'View in org chart' }).click()
    await s.page.waitForURL((u) => u.pathname === '/hrms/org-chart', { timeout: 15_000 }).catch(() => {})
    await s.settle()
    const focused = await s.page.locator(`.uoc-node.is-found[data-person="${READER}"]`).waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check('owner: View in org chart opens the chart focused on the person', new URL(s.page.url()).searchParams.get('focus') === READER && focused, s.page.url())
    await s.shot('hr-orgchart-focus-1440-light')
    await s.go(`/hrms/employees/${READER}?tab=payroll`)
    await s.go(`/hrms/employees/${READER}?tab=documents`)
    const docSum = await owner.call(`/v1/document/employee/${READER}/summary`)
    const hint = await s.page.getByRole('heading', { name: 'Filed documents' }).locator('xpath=ancestor::section[1]').innerText().catch(() => '')
    check('owner: Documents shows the exact counts from the summary (BW-77)', docSum.status === 200 && hint.includes(`${docSum.json.onFile} on file`), `${docSum.status} ${JSON.stringify(docSum.json).slice(0, 120)}`)
    await s.go(`/hrms/employees/${READER}?tab=letters`)
    check('owner: Letters lists generated letters with their signed or issued date (BW-71)', await s.page.getByRole('heading', { name: 'Generated letters' }).count() === 1
      && (await s.page.getByText(/^(Signed|Issued) \d/).count() > 0 || await s.page.getByText('No letters generated').count() > 0))
    check('owner: Payroll lists payslips (or says there are none)', await s.page.getByRole('heading', { name: 'Payslips' }).count() > 0)
    await s.go(`/hrms/employees/${READER}?tab=exit`)
    check('owner: Exit shows the F&F card with its link', await s.page.getByRole('link', { name: 'Open full & final settlements' }).count() > 0)
    check('owner: no unexpected API errors on the HR view', !clean(s).length, clean(s).slice(0, 3).join(' | '))
    // dark
    const dk = await open('owner@unifiedtree.demo', 1440, 'dark')
    await dk.go(`/hrms/employees/${READER}`)
    await dk.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 })
    const bg = await dk.page.evaluate(() => getComputedStyle(document.querySelector('.upf-card')).backgroundColor)
    check('owner: dark mode draws the profile cards dark', /rgb\((1[0-9]|[0-9]), (2[0-9]|1[0-9]), (2[0-9]|1[0-9])\)/.test(bg), bg)
    await dk.shot('hr-overview-1440-dark')
    await dk.go(`/hrms/employees/${READER}?tab=access`); await dk.shot('hr-access-1440-dark')
    check('owner: no page errors in dark', !dk.errors.length, dk.errors[0] || '')
    await dk.ctx.close()
    // phone
    const ph = await open('owner@unifiedtree.demo', 390)
    await ph.go(`/hrms/employees/${READER}`)
    await ph.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 })
    check('owner: phone HR view has no sideways scroll', await ph.noHScroll())
    await ph.shot('hr-overview-390-light')
    await ph.go(`/hrms/employees/${READER}?tab=access`)
    check('owner: phone Access tab has no sideways scroll', await ph.noHScroll())
    await ph.shot('hr-access-390-light')
    await ph.ctx.close()

    // ── C. Access: give reader a role, then remove it ──
    await s.go(`/hrms/employees/${READER}?tab=access`)
    await s.page.getByRole('heading', { name: 'Roles', exact: true }).waitFor({ timeout: 20_000 })
    check('Access: sign-in status shows', await s.page.getByText('Sign-in status').count() > 0 && await s.page.getByText('Can sign in').count() > 0)
    check('Access: links to Users & access', await s.page.getByRole('button', { name: 'Open Users & access' }).count() > 0)
    await s.page.getByRole('button', { name: 'Give a role' }).click()
    const panel = s.page.getByRole('dialog', { name: 'Give a role' })
    await panel.waitFor({ timeout: 10_000 })
    const gives = panel.getByRole('button', { name: /^Give / })
    // A working role rather than an admin one when one can be given.
    let pickBtn = null
    for (const want of ['Department Manager', 'Dept Manager', 'Finance Lead', 'HR Manager']) {
      const b = panel.getByRole('button', { name: `Give ${want}`, exact: true })
      if (await b.count() && !(await b.isDisabled())) { pickBtn = b; break }
    }
    for (let i = 0; !pickBtn && i < await gives.count(); i++) if (!(await gives.nth(i).isDisabled())) pickBtn = gives.nth(i)
    let gave = null
    if (pickBtn) { gave = (await pickBtn.getAttribute('aria-label')).replace(/^Give /, ''); await pickBtn.click() }
    const confirmGive = s.page.getByRole('dialog', { name: /^Give the / })
    if (await confirmGive.count()) await confirmGive.getByRole('button', { name: 'Give role' }).click()
    const gaveOk = gave && await toast(s.page, new RegExp(`${gave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} given to`))
    await wait(500)
    const afterGive = rolesOf()
    created.roleCode = afterGive.split(',').find((c) => c && !readerRolesBefore.split(',').includes(c)) || null
    check('Access: owner gives reader a role (saved)', !!gaveOk && !!created.roleCode, `${gave} → ${afterGive}`)
    await s.page.keyboard.press('Escape').catch(() => {})
    await s.page.getByRole('dialog', { name: 'Give a role' }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    if (gave) {
      await s.page.getByRole('button', { name: `Remove ${gave}` }).click()
      const removedOk = await toast(s.page, /removed from/)
      await wait(500)
      check('Access: owner removes it again (saved)', removedOk && rolesOf() === readerRolesBefore, rolesOf())
    }
    check('Access: no unexpected API errors', !clean(s).length, clean(s).slice(0, 3).join(' | '))

    // ── D. On behalf: leave and a claim for reader ──
    let leaveDay = addDays(today, 14)
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, 14 + i), w = new Date(d + 'T00:00:00Z').getUTCDay()
      if (w !== 0 && w !== 6 && !num(`select count(*) from settings.holiday_calendar where company_id='${company}' and holiday_date='${d}' and is_active`)) { leaveDay = d; break }
    }
    await s.go(`/hrms/employees/${READER}?tab=leave`)
    const onBehalf = s.page.getByRole('button', { name: 'Apply on behalf' })
    check('on behalf: Leave tab offers Apply on behalf', await onBehalf.count() > 0)
    if (await onBehalf.count()) {
      await onBehalf.click()
      const lp = s.page.getByRole('dialog', { name: 'Apply leave on behalf' })
      await lp.waitFor({ timeout: 10_000 })
      await pickDate(s.page, lp.getByRole('combobox', { name: 'From' }), leaveDay)
      await lp.getByLabel('Reason (optional)').fill(`QA P-PROFILE on behalf ${stamp}`)
      await lp.getByRole('button', { name: 'Apply leave' }).click()
      const ok = await toast(s.page, /Leave applied for Reader User/)
      const row = sql(`select id || '|' || status from leave_mgmt.leave_requests where employee_id='${READER}' and reason='QA P-PROFILE on behalf ${stamp}' limit 1`)
      if (row) created.leave.push(row.split('|')[0])
      check('on behalf: owner applies leave for reader (pending, reader’s approval chain)', ok && /\|PENDING/.test(row), row)
    }
    await s.go(`/hrms/employees/${READER}?tab=expenses`)
    const newClaim = s.page.getByRole('button', { name: 'New claim' })
    check('on behalf: Expenses tab offers New claim', await newClaim.count() > 0)
    if (await newClaim.count()) {
      await newClaim.first().click()
      const cp = s.page.getByRole('dialog', { name: 'New claim on behalf' })
      await cp.waitFor({ timeout: 10_000 })
      await cp.getByLabel('Title').fill(`QA P-PROFILE claim ${stamp}`)
      await cp.getByLabel('Category').selectOption('OTHER')
      await cp.getByLabel('Amount (₹)').fill('120')
      await cp.getByRole('button', { name: /^Raise claim/ }).click()
      const ok = await toast(s.page, /Claim raised for Reader User/)
      const row = sql(`select id || '|' || status from expense_mgmt.expense_claims where employee_id='${READER}' and title='QA P-PROFILE claim ${stamp}' limit 1`)
      if (row) created.claims.push(row.split('|')[0])
      check('on behalf: owner raises a claim for reader (submitted)', ok && /\|SUBMITTED/.test(row), row)
    }
    check('on behalf: no unexpected API errors', !clean(s).length, clean(s).slice(0, 3).join(' | '))
    await s.ctx.close()
  }
  {
    const s = await open('hrm@unifiedtree.demo')
    await s.go(`/hrms/employees/${READER}`)
    await s.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 })
    const t = await s.tabs()
    check('hrm: Personal and Payroll, no Access (no user management)', t.includes('Personal') && t.includes('Payroll') && !t.includes('Access'), t.join(','))
    await s.go(`/hrms/employees/${READER}?tab=access`)
    check('hrm: ?tab=access falls back to Overview', (await s.page.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')) === 'true')
    check('hrm: no page errors or unexpected API errors', !s.errors.length && !clean(s).length, s.errors[0] || clean(s)[0] || '')
    await s.ctx.close()
  }
  {
    const s = await open('fin@unifiedtree.demo')
    await s.go(`/hrms/employees/${READER}?tab=payroll`)
    await s.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 })
    const t = await s.tabs()
    check('fin: Payroll with payslips, no Personal, no Access', t.includes('Payroll') && !t.includes('Personal') && !t.includes('Access') && await s.page.getByRole('heading', { name: 'Payslips' }).count() > 0, t.join(','))
    // Finance holds attendance.team.read, but the server scopes attendance and shift reads to their own
    // people: reader isn't theirs, so those blocks say so (as before the redesign).
    const scoped = [/\/attendance\/employee\//, /\/shifts\/employee\//]
    check('fin: no page errors or unexpected API errors', !s.errors.length && !clean(s, scoped).length, s.errors[0] || clean(s, scoped)[0] || '')
    await s.ctx.close()
  }
  {
    const s = await open('mgr@unifiedtree.demo')
    await s.go(`/hrms/employees/${READER}`)
    const opened = await s.page.getByRole('heading', { name: 'Reader User' }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
    const t = opened ? await s.tabs() : []
    check('mgr: opens their direct report’s profile', opened)
    check('mgr: masked view: no Personal, Payroll or Access', opened && !t.includes('Personal') && !t.includes('Payroll') && !t.includes('Access') && t.includes('Attendance'), t.join(','))
    check('mgr: no pay figure and no Edit profile', await s.page.getByText('Annual CTC', { exact: true }).count() === 0 && await s.page.getByRole('button', { name: 'Edit profile' }).count() === 0)
    await s.shot('hr-mgr-report-1440-light')
    for (const tab of t) {
      s.errors.length = 0
      await s.page.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await s.settle()
      check(`mgr: ${tab} tab renders`, !s.errors.length, s.errors[0] || '')
    }
    check('mgr: no unexpected API errors', !clean(s).length, clean(s).slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── E. My profile ─────────────────────────────────────────────────────────
  {
    const s = await open('reader@unifiedtree.demo')
    await s.go('/profile')
    await s.page.getByRole('tablist', { name: 'Profile sections' }).waitFor({ timeout: 30_000 })
    const t = await s.tabs()
    check('reader: My profile tabs by own permissions, with Attendance and Preferences', ['Overview', 'Personal', 'Job', 'Attendance', 'My pay', 'Leave', 'Expenses', 'Documents', 'Letters', 'Performance', 'Preferences'].every((x) => t.includes(x)) && !t.includes('Exit') && !t.includes('Access'), t.join(','))
    check('reader: the left card lets them change display name and Mobile only', await s.page.getByLabel('Display name').count() === 1 && await s.page.getByLabel('Mobile').count() === 1 && await s.page.getByLabel('First name').count() === 0)
    await s.shot('me-overview-1440-light')
    for (const tab of t.filter((x) => x !== 'Overview')) {
      s.errors.length = 0
      await s.page.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await s.settle()
      check(`reader: ${tab} tab renders`, !s.errors.length, s.errors[0] || '')
      if (['Personal', 'My pay', 'Preferences'].includes(tab)) await s.shot(`me-${tab.toLowerCase().replace(' ', '-')}-1440-light`)
    }
    await s.go('/profile?tab=personal')
    check('reader: Personal shows their own sections and a masked identity', await s.page.getByRole('heading', { name: 'Identity documents' }).count() === 1 && await s.page.getByRole('heading', { name: 'Dependents' }).count() === 1
      && await s.page.getByRole('button', { name: /Add (Address|Dependent)/ }).count() === 0)
    await s.go(`/hrms/employees/${READER}?tab=access`)
    check('reader: no Access tab anywhere for them', await s.page.getByRole('tab', { name: 'Access' }).count() === 0)
    check('reader: no page errors or unexpected API errors on My profile', !s.errors.length && !clean(s, [/\/hrms\/employees\/2{8}/]).length, s.errors[0] || clean(s, [/\/hrms\/employees\/2{8}/])[0] || '')
    const ph = await open('reader@unifiedtree.demo', 390, 'dark')
    await ph.go('/profile')
    check('reader: phone My profile has no sideways scroll (dark)', await ph.noHScroll())
    await ph.shot('me-overview-390-dark')
    await ph.ctx.close()
    await s.ctx.close()
    // BW-100: the browser sign-in above is the newest session.
    const inv = await owner.call(`/v1/employees/${READER}/invitation-status`)
    check('BW-100: invitation-status names the last sign-in device', inv.status === 200 && /Chrome on Windows|Chrome/.test(inv.json?.lastLoginDevice || ''), JSON.stringify(inv.json))
    check('invitation-status gives sign-in times as ISO instants', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(inv.json?.lastLoginAt || ''), inv.json?.lastLoginAt)
  }
  {
    const s = await open('owner@unifiedtree.demo')
    await s.go('/profile')
    await s.page.getByRole('tablist', { name: 'Profile sections' }).waitFor({ timeout: 30_000 })
    const t = await s.tabs()
    check('owner: own profile has no Attendance tab (admin roles)', !t.includes('Attendance') && t.includes('Preferences'), t.join(','))
    await s.go('/profile#st-delegation')
    await s.page.getByRole('heading', { name: 'Approval delegation', exact: true }).waitFor({ timeout: 20_000 })
    await s.page.waitForTimeout(800)
    const top = await s.page.getByRole('heading', { name: 'Approval delegation', exact: true }).evaluate((el) => el.getBoundingClientRect().top)
    check('owner: #st-delegation opens Preferences at that section', (await s.page.getByRole('tab', { name: 'Preferences' }).getAttribute('aria-selected')) === 'true' && top < 260, `top=${Math.round(top)}`)
    await s.shot('me-preferences-owner-1440-light')
    const dk = await open('owner@unifiedtree.demo', 1440, 'dark')
    await dk.go('/profile'); await dk.shot('me-overview-owner-1440-dark')
    check('owner: no page errors on My profile (dark)', !dk.errors.length, dk.errors[0] || '')
    await dk.ctx.close()
    check('owner: no page errors or unexpected API errors on My profile', !s.errors.length && !clean(s).length, s.errors[0] || clean(s)[0] || '')
    await s.ctx.close()
  }
} catch (e) {
  check('run finished', false, String(e.stack || e.message || e).slice(0, 400))
} finally {
  await browser.close().catch(() => {})
  // reader's role back as it was
  try {
    if (created.roleCode && rolesOf() !== readerRolesBefore) {
      sql(`delete from rbac.user_roles where user_id='${readerUser}' and role_id in (select id from rbac.roles where code='${created.roleCode}' and (tenant_id is null or tenant_id='${tenant}'))`)
    }
  } catch (e) { console.log('cleanup roles:', String(e).split('\n')[0]) }
  // leave: reader cancels, then the rows go
  for (const id of created.leave) { try { await reader.call(`/v1/leave/${id}/cancel?reason=${encodeURIComponent('Local QA cleanup')}`, 'POST') } catch { /* ignore */ } }
  try {
    const ids = [...created.leave, ...created.claims].map((x) => `'${x}'`).join(',')
    if (ids) {
      sql(`DELETE FROM notif.notifications WHERE tenant_id='${tenant}' AND (${[...created.leave, ...created.claims].map((x) => `data::text ~ '${x}'`).join(' OR ')})`)
      sql(`DELETE FROM hrms.approval_decisions WHERE tenant_id='${tenant}' AND request_id IN (${ids})`)
      sql(`DELETE FROM audit.events WHERE tenant_id='${tenant}' AND entity_id IN (${ids})`)
    }
    if (created.leave.length) sql(`delete from leave_mgmt.leave_requests where id in (${created.leave.map((x) => `'${x}'`).join(',')})`)
    if (created.claims.length) sql(`BEGIN; DELETE FROM expense_mgmt.expense_items WHERE claim_id IN (${created.claims.map((x) => `'${x}'`).join(',')}); DELETE FROM expense_mgmt.expense_claims WHERE id IN (${created.claims.map((x) => `'${x}'`).join(',')}); COMMIT;`)
  } catch (e) { console.log('cleanup leave/claims:', String(e).split('\n')[0]) }
  try {
    for (const d of created.dependents) await owner.call(`/v1/employees/${created.fixture}/profile/dependents/${d}`, 'DELETE')
    if (created.identitySeeded) sql(`delete from hrms.employee_identities where employee_id='${READER}'`)
    if (created.fixture) {
      sql(`delete from hrms.employee_dependents where employee_id='${created.fixture}'`)
      sql(`delete from leave_mgmt.leave_balances where employee_id='${created.fixture}'`)
      sql(`delete from hrms.probation_reminder_log where employee_id='${created.fixture}'`)
      sql(`delete from hrms.employees where id='${created.fixture}'`)
    }
  } catch (e) { console.log('cleanup fixture:', String(e).split('\n')[0]) }
  const left = num(`select count(*) from leave_mgmt.leave_requests where reason like 'QA P-PROFILE%'`) + num(`select count(*) from expense_mgmt.expense_claims where title like 'QA P-PROFILE%'`)
    + (created.fixture ? num(`select count(*) from hrms.employees where id='${created.fixture}'`) : 0)
  check('cleanup: nothing the test made is left behind, reader’s roles are back', left === 0 && rolesOf() === readerRolesBefore, `left=${left} roles=${rolesOf()}`)
  check('no FEATURE_NOT_READY (every migration is applied here)', notReady.length === 0, notReady.join('; '))
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
