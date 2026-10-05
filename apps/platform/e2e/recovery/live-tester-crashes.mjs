// The two crashes our testers hit on 5 Oct 2026, and Finance's Home, against a running app and API:
//   A. Finance (EMPLOYEE + FINANCE_LEAD, as the tester "varsha" held): signing in lands on All apps with no
//      error screen; /dashboard stays the dashboard with Payroll & activity and no Add employee; More → All
//      apps opens; a profile opens without Edit profile; activating an invitation lands on the dashboard
//      (an employee's activation still lands on /me); the phone layout at 390.
//   B. All apps (/modules) for owner, HR manager, department manager and employee: no error screen.
//   C. Employee profiles as HR manager and owner: people with and without a manager, on probation, on
//      notice, exited, terminated, Finance, and two new joiners shaped like the records on demo-hrms (on
//      probation with no end or confirmation date, no shift, no department, branch, designation or
//      manager, no login, joined today; the second also punched in on the web today and has an
//      attendance day dated 2099-12-31); every tab on some of them; the directory's row → Full record;
//      the phone layout at 390.
//   D. A tab opened before a deploy: the first download of a page's code fails (the host answers with
//      index.html, as it does for a file the new build no longer has). The page loads the new build once
//      and opens, instead of the error screen. Covered for All apps (Finance) and a profile (HR manager).
// Fails on any error screen or page error; API answers of 400 and above are listed as notes.
// Everything it changes is put back: Finance's extra EMPLOYEE role, the two new people and their attendance rows.
//
//   live-slot.sh /c/REACT/ut-wt/w14-crash 3141 node e2e/recovery/live-tester-crashes.mjs
//   env: RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), SHOTS_DIR
/* global process, console, fetch, document, URL */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3141'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const FIN_EMPLOYEE = '55555555-5555-5555-5555-555555555555'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
const note = (m) => console.log(`NOTE  ${m}`)
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const stamp = Date.now() % 1000000
const apiErrors = new Set()

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { ...d, call }
}

const browser = await chromium.launch()
// The dev server compiles on first use: open the sign-in page once before timing anything.
{ const c = await browser.newContext(); const w = await c.newPage()
  for (let i = 0; i < 3; i++) { try { await w.goto(base + '/login', { timeout: 180_000 }); await w.locator('input[type=email]').waitFor({ timeout: 120_000 }); break } catch { /* still compiling */ } }
  await c.close() }

/** A browser tab. `errors` collects page errors (and the error boundary's own report); API failures are noted. */
async function tab(who, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } })
  const page = await ctx.newPage()
  page.setDefaultNavigationTimeout(120_000); page.setDefaultTimeout(60_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('[RouteErrorBoundary]')) errors.push(m.text().slice(0, 300)) })
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    apiErrors.add(`${who}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  return { ctx, page, errors }
}
async function signIn(email, width = 1440, before) {
  const t = await tab(email.split('@')[0] + (width < 500 ? ' (phone)' : ''), width)
  if (before) await before(t.page)
  await t.page.goto(base + '/login')
  await t.page.locator('input[type=email]').fill(email)
  await t.page.locator('input[type=password]').fill(password)
  await t.page.locator('button[type=submit]').click()
  await t.page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90_000 })
  await settle(t.page)
  await closePunchPrompt(t.page, 4000)
  return t
}
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"], [aria-label="Loading employee"], [aria-label="Loading apps"]'), null, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(600)
}
async function settleProfile(page) {
  await page.waitForFunction(() => document.querySelector('.upf-name') || /This page hit an error|Employee not found/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(900)
}
const at = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const errorScreen = async (page) => (await page.getByText('This page hit an error').count()) > 0
const tiles = (page) => page.locator('.ut-app').count()
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1)
/** The check-in prompt after sign-in (people who punch from the web; no camera here) is put aside. */
async function closePunchPrompt(page, wait = 1500) {
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  // It opens a moment after the page settles (once the welcome has gone).
  await later.waitFor({ timeout: wait }).catch(() => {})
  if (await later.isVisible().catch(() => false)) { await later.click(); await later.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {}) }
}
/** A screenshot of the page itself. */
async function shot(page, name) {
  await closePunchPrompt(page)
  await page.screenshot({ path: `${shots}/w14-crash-${name}.png` })
}
async function openAllAppsFromMore(page) {
  await closePunchPrompt(page)
  await page.locator('.ut-rail__more').first().click()
  await page.getByRole('dialog', { name: 'More' }).getByText('All apps', { exact: true }).click()
  await page.waitForURL((u) => u.pathname === '/modules', { timeout: 30_000 })
  await settle(page)
}

/** The directory's first row opens its quick profile; Full record opens the profile page (client-side). */
async function fromDirectory(page, wait = true) {
  await closePunchPrompt(page)
  const row = page.locator('table tbody tr').first()
  if (!(await row.count())) { note('the directory shows no rows'); return false }
  await row.click()
  const full = page.getByRole('button', { name: 'Full record' })
  if (!(await full.waitFor({ timeout: 15_000 }).then(() => true, () => false))) { note('no Full record button on the quick profile'); return false }
  await full.click()
  await page.waitForURL((u) => /^\/hrms\/employees\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30_000 }).catch(() => {})
  if (wait) await settleProfile(page)
  return /^\/hrms\/employees\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname)
}

const owner = await session('owner@unifiedtree.demo')
const finBefore = await session('fin@unifiedtree.demo')
const created = { finEmployeeRole: false, fixture: null, fixture2: null }

try {
  // ── Setup: Finance also holds EMPLOYEE (as the tester did) ─────────────────
  if (!finBefore.roles.includes('EMPLOYEE')) {
    const r = await owner.call(`/v1/workspace/users/${finBefore.userId}/roles`, 'POST', { roleCode: 'EMPLOYEE' })
    created.finEmployeeRole = r.status < 300
    if (!created.finEmployeeRole) note(`giving fin EMPLOYEE answered ${r.status}`)
  }
  const fin = await session('fin@unifiedtree.demo')
  check('setup: Finance holds EMPLOYEE and FINANCE_LEAD', fin.roles.includes('EMPLOYEE') && fin.roles.includes('FINANCE_LEAD'), JSON.stringify(fin.roles))

  // Two new joiners shaped like demo-hrms' records: only the required fields, then on probation with no
  // dates, and no shift, department, branch, designation or manager (and no login: nobody is invited).
  for (const k of ['fixture', 'fixture2']) {
    const fx = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: k === 'fixture' ? 'Crash QA' : 'Crash QA Punch', email: `w14-${k}-${stamp}@example.invalid`, employmentType: 'FULL_TIME', dateOfJoining: istToday() })
    created[k] = fx.json?.id ?? null
  }
  check('setup: two new people with only the required fields', !!created.fixture && !!created.fixture2)
  const fixtures = [created.fixture, created.fixture2].filter(Boolean).map((x) => `'${x}'`).join(',')
  if (fixtures) {
    sql(`update hrms.employees set employment_status='PROBATION', probation_end_date=null, confirmation_date=null, department_id=null, branch_id=null, designation_id=null, reporting_manager_id=null where id in (${fixtures})`)
    sql(`delete from attendance.employee_shift_assignments where employee_id in (${fixtures})`)
  }
  // The second one punched in on the web today, and has a day dated 2099-12-31.
  if (created.fixture2) sql(`insert into attendance.records(id,tenant_id,employee_id,attendance_date,check_in_at,attendance_type,attendance_status,check_in_method,company_id) values
    (gen_random_uuid(),'${tenant}','${created.fixture2}','2099-12-31','2099-12-31T04:00:00Z','OFFICE','PRESENT','WEB','${company}'),
    (gen_random_uuid(),'${tenant}','${created.fixture2}','${istToday()}',now() - interval '1 hour','OFFICE','PRESENT','WEB','${company}')`)

  // ── A. Finance ─────────────────────────────────────────────────────────────
  {
    const t = await signIn('fin@unifiedtree.demo')
    check('A1 finance: signing in lands on All apps with no error screen', at(t.page) === '/modules' && !(await errorScreen(t.page)) && (await tiles(t.page)) > 0, at(t.page))
    await t.page.goto(base + '/dashboard'); await settle(t.page)
    check('A2 finance: /dashboard is their dashboard (not sent to /me)', at(t.page) === '/dashboard' && !(await errorScreen(t.page)), at(t.page))
    check('A3 finance: the dashboard shows Payroll & activity', (await t.page.locator('section[aria-label="Payroll and activity"]').count()) > 0)
    check('A4 finance: no Add employee on the dashboard', (await t.page.getByRole('button', { name: 'Add employee' }).count()) === 0)
    await shot(t.page, 'fin-dashboard-1440')
    await openAllAppsFromMore(t.page)
    check('A5 finance: More → All apps opens with no error screen', at(t.page) === '/modules' && !(await errorScreen(t.page)) && (await tiles(t.page)) > 0, at(t.page))
    await shot(t.page, 'fin-modules-1440')
    await t.page.goto(`${base}/hrms/employees/${created.fixture ?? FIN_EMPLOYEE}`); await settleProfile(t.page)
    check('A6 finance: a profile opens, without Edit profile', (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)) && (await t.page.getByRole('button', { name: 'Edit profile' }).count()) === 0)
    check('A7 finance: no page errors', t.errors.length === 0, t.errors.join(' | '))
    await t.ctx.close()
  }
  // Activating an invitation: the answer is the person's real session (its token, roles and permissions).
  async function activation(email) {
    const s = await session(email)
    const t = await tab(`${email.split('@')[0]} (activation)`)
    await t.page.route('**/api/v1/auth/accept-invite', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...s, call: undefined, tenantSlug: 'demo', tenantName: 'UnifiedTree Demo', activeModules: ['hrms', 'attendance', 'payroll', 'leave'] }) }))
    await t.page.goto(base + '/accept-invite?token=w14-live-check')
    await t.page.locator('input[type=password]').nth(0).fill('Crash@12345')
    await t.page.locator('input[type=password]').nth(1).fill('Crash@12345')
    await t.page.locator('button[type=submit]').click()
    await t.page.waitForURL((u) => !u.pathname.startsWith('/accept-invite'), { timeout: 30_000 }).catch(() => {})
    await settle(t.page)
    return t
  }
  {
    const t = await activation('fin@unifiedtree.demo')
    check('A8 finance: activating the invitation lands on the dashboard', at(t.page) === '/dashboard' && !(await errorScreen(t.page)), at(t.page))
    check('A8 finance: no page errors after activation', t.errors.length === 0, t.errors.join(' | '))
    await t.ctx.close()
    const e = await activation('reader@unifiedtree.demo')
    check('A9 employee: activating the invitation still lands on Home at /me', at(e.page) === '/me' && !(await errorScreen(e.page)), at(e.page))
    await e.ctx.close()
  }
  {
    const t = await signIn('fin@unifiedtree.demo', 390)
    await t.page.goto(base + '/dashboard'); await settle(t.page)
    check('A10 finance (phone 390): the dashboard, no error screen, no sideways scroll', at(t.page) === '/dashboard' && !(await errorScreen(t.page)) && (await noHScroll(t.page)), at(t.page))
    await shot(t.page, 'fin-dashboard-390')
    await t.page.goto(base + '/modules'); await settle(t.page)
    check('A11 finance (phone 390): All apps, no error screen, no sideways scroll', !(await errorScreen(t.page)) && (await tiles(t.page)) > 0 && (await noHScroll(t.page)))
    await shot(t.page, 'fin-modules-390')
    check('A12 finance (phone 390): no page errors', t.errors.length === 0, t.errors.join(' | '))
    await t.ctx.close()
  }

  // ── B. All apps for every other role ───────────────────────────────────────
  for (const who of ['owner', 'hrm', 'mgr', 'reader']) {
    const t = await signIn(`${who}@unifiedtree.demo`)
    await t.page.goto(base + '/profile'); await settle(t.page)
    await openAllAppsFromMore(t.page)
    check(`B ${who}: All apps opens with no error screen`, at(t.page) === '/modules' && !(await errorScreen(t.page)) && (await tiles(t.page)) > 0, at(t.page))
    if (who === 'owner') await shot(t.page, 'owner-modules-1440')
    check(`B ${who}: no page errors`, t.errors.length === 0, t.errors.join(' | '))
    await t.ctx.close()
  }

  // ── C. Employee profiles as HR manager and owner ───────────────────────────
  const list = await owner.call('/v1/hrms/employees?page=0&pageSize=200')
  const all = list.json?.content ?? []
  const pick = (f) => all.find(f)
  const people = [
    ['with a manager', pick((e) => e.reportingManagerId && e.employmentStatus === 'ACTIVE') ?? pick((e) => e.reportingManagerId)],
    ['without a manager', pick((e) => !e.reportingManagerId && e.employmentStatus === 'ACTIVE')],
    ['on probation', pick((e) => e.employmentStatus === 'PROBATION')],
    ['on notice', pick((e) => e.employmentStatus === 'NOTICE_PERIOD')],
    ['exited', pick((e) => e.employmentStatus === 'EXITED')],
    ['terminated', pick((e) => e.employmentStatus === 'TERMINATED')],
    ['Finance', pick((e) => e.id === FIN_EMPLOYEE)],
    ['new, nothing filled in, no login', created.fixture ? { id: created.fixture } : null],
    ['new, with a web punch today and a 2099 day', created.fixture2 ? { id: created.fixture2 } : null],
  ].filter(([, e]) => e)
  check('C setup: profiles to open', people.length >= 6, people.map(([l]) => l).join(', '))
  const TABS = ['personal', 'job', 'attendance', 'payroll', 'leave', 'expenses', 'documents', 'letters', 'performance', 'exit', 'access']
  for (const who of ['hrm', 'owner']) {
    const t = await signIn(`${who}@unifiedtree.demo`)
    // The tester's path: the directory, a row, then Full record.
    await t.page.goto(base + '/hrms/employees'); await settle(t.page)
    const opened = await fromDirectory(t.page)
    check(`C ${who}: the directory's row → Full record opens a profile`, opened && (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)) && t.errors.length === 0, `${at(t.page)} ${t.errors.join(' | ')}`)
    for (const [label, e] of people) {
      t.errors.length = 0
      await t.page.goto(`${base}/hrms/employees/${e.id}`); await settleProfile(t.page)
      const ok = (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)) && t.errors.length === 0
      check(`C ${who}: profile of someone ${label} opens with no error`, ok, t.errors.join(' | '))
      if (label === 'new, nothing filled in, no login' && who === 'hrm') await shot(t.page, 'profile-new-1440')
      // Every tab on four of them.
      if (['on probation', 'Finance', 'new, nothing filled in, no login', 'new, with a web punch today and a 2099 day'].includes(label)) {
        const bad = []
        for (const k of TABS) {
          t.errors.length = 0
          await t.page.goto(`${base}/hrms/employees/${e.id}?tab=${k}`); await settleProfile(t.page)
          if ((await errorScreen(t.page)) || t.errors.length) bad.push(`${k}: ${t.errors.join(' | ') || 'error screen'}`)
        }
        check(`C ${who}: every tab of someone ${label} opens with no error`, bad.length === 0, bad.join(' ;; '))
      }
    }
    await t.ctx.close()
  }
  {
    const t = await signIn('hrm@unifiedtree.demo', 390)
    await t.page.goto(`${base}/hrms/employees/${created.fixture ?? FIN_EMPLOYEE}`); await settleProfile(t.page)
    check('C hrm (phone 390): a profile opens, no sideways scroll, no page errors', (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)) && (await noHScroll(t.page)) && t.errors.length === 0, t.errors.join(' | '))
    await shot(t.page, 'profile-new-390')
    await t.ctx.close()
  }

  // ── D. A tab opened before a deploy ─────────────────────────────────────────
  // The first `n` downloads of the page's code get index.html (the dev server's and the build's file names).
  const MODULES_CODE = /\/(src\/pages\/Modules\.tsx|assets\/Modules-[\w-]+\.js)(\?.*)?$/
  const PROFILE_CODE = /\/(src\/modules\/hrms\/employees\/EmployeeDetail\.tsx|assets\/EmployeeDetail-[\w-]+\.js)(\?.*)?$/
  const failFirst = (re, n = 1) => async (page) => {
    const html = await (await fetch(base + '/')).text()
    let hits = 0
    await page.route(re, (r) => (hits++ < n ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.continue()))
    page.hits = () => hits
    // What the browser and the error screen say about it.
    page.failures = []
    page.on('pageerror', (e) => page.failures.push(String(e.message || e)))
    page.on('console', (m) => { if (m.type() === 'error' && /dynamically imported module|module script|MIME/i.test(m.text())) page.failures.push(m.text()) })
  }
  const failFirstOnce = (re) => failFirst(re, 1)
  {
    const t = await signIn('fin@unifiedtree.demo', 1440, failFirstOnce(MODULES_CODE))
    await t.page.waitForFunction(() => document.querySelector('.ut-app') || /This page hit an error/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {})
    await settle(t.page)
    check('D1 finance: All apps whose code was replaced by a deploy loads the new build and opens', t.page.hits() >= 2 && at(t.page) === '/modules' && !(await errorScreen(t.page)) && (await tiles(t.page)) > 0,
      `downloads=${t.page.hits()} at=${at(t.page)}`)
    if (t.page.failures.length) note(`D1 first download failed with: ${t.page.failures[0].slice(0, 200)}`)
    await t.ctx.close()
  }
  {
    const t = await signIn('hrm@unifiedtree.demo', 1440, failFirstOnce(PROFILE_CODE))
    await t.page.goto(base + '/hrms/employees'); await settle(t.page)
    if (!(await fromDirectory(t.page, false))) await t.page.goto(`${base}/hrms/employees/${FIN_EMPLOYEE}`)
    await t.page.waitForFunction(() => document.querySelector('.upf-name') || /This page hit an error/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {})
    await settle(t.page)
    check('D2 hrm: a profile whose code was replaced by a deploy loads the new build and opens', t.page.hits() >= 2 && (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)),
      `downloads=${t.page.hits()} at=${at(t.page)}`)
    await t.ctx.close()
  }
  {
    // The code stays unavailable (the reload gets the same answer): one reload only, then the error screen
    // the testers saw; its Try again loads the app again, which opens the profile once the code is there.
    const t = await signIn('hrm@unifiedtree.demo', 1440, failFirst(PROFILE_CODE, 2))
    await t.page.goto(`${base}/hrms/employees/${FIN_EMPLOYEE}`)
    await t.page.waitForFunction(() => document.querySelector('.upf-name') || /This page hit an error/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {})
    await settle(t.page)
    const shown = await errorScreen(t.page)
    const why = t.page.failures.find((f) => /dynamically imported module|module script/i.test(f)) ?? ''
    check('D3 hrm: code that stays unavailable reloads once, then shows the error screen (no reload loop)', shown && t.page.hits() === 2, `downloads=${t.page.hits()} screen=${shown}`)
    note(`D3 the error the screen reports: ${why.slice(0, 220) || '(none captured)'}`)
    await shot(t.page, 'stale-code-error-1440')
    await t.page.getByRole('button', { name: 'Try again' }).click()
    await t.page.waitForFunction(() => document.querySelector('.upf-name'), null, { timeout: 60_000 }).catch(() => {})
    await settle(t.page)
    check('D3 hrm: Try again loads the app again and the profile opens', t.page.hits() >= 3 && (await t.page.locator('.upf-name').count()) > 0 && !(await errorScreen(t.page)), `downloads=${t.page.hits()}`)
    await t.ctx.close()
  }
} finally {
  // ── Put everything back ─────────────────────────────────────────────────────
  if (created.finEmployeeRole) {
    const r = await owner.call(`/v1/workspace/users/${finBefore.userId}/roles/EMPLOYEE`, 'DELETE')
    if (r.status >= 300) sql(`delete from rbac.user_roles where user_id='${finBefore.userId}' and role_id in (select id from rbac.roles where code='EMPLOYEE' and (tenant_id is null or tenant_id='${tenant}'))`)
  }
  for (const id of [created.fixture, created.fixture2].filter(Boolean)) {
    for (const q of [
      `delete from attendance.records where employee_id='${id}'`,
      `delete from hrms.employee_onboarding_records where employee_id='${id}'`,
      `delete from hrms.employee_dependents where employee_id='${id}'`,
      `delete from leave_mgmt.leave_balances where employee_id='${id}'`,
      `delete from hrms.probation_reminder_log where employee_id='${id}'`,
      `delete from hrms.employees where id='${id}'`,
    ]) { try { sql(q) } catch (e) { note(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  }
  const finAfter = await session('fin@unifiedtree.demo')
  check('cleanup: Finance has its roles from before', JSON.stringify([...finAfter.roles].sort()) === JSON.stringify([...finBefore.roles].sort()), JSON.stringify(finAfter.roles))
  const gone = [created.fixture, created.fixture2].filter(Boolean).map((x) => `'${x}'`).join(',')
  if (gone) check('cleanup: the new people and their attendance rows are removed',
    Number(sql(`select count(*) from hrms.employees where id in (${gone})`)) === 0 && Number(sql(`select count(*) from attendance.records where employee_id in (${gone})`)) === 0)
  await browser.close()
}

for (const e of [...apiErrors].sort()) note(`API ${e}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
