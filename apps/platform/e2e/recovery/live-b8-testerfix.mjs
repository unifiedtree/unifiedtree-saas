/* global URL, console, fetch, process, window, document, setInterval, setTimeout, Buffer */
// Tester fixes, web (9 Oct 2026), browser + API, against a running backend and web app:
//  1. web-leave-06  "Select dates": a tap after opening from the To box sets the end (it used to start a
//     new one-day range); from From it moves the start and keeps the end. Apply for leave (reader) and
//     Apply on behalf (owner). Nothing is sent. Screenshots 1440 and 390 wide.
//  2. web-leave-10  Apply on behalf and Claim on behalf list people on probation / notice period (they
//     listed ACTIVE only) and not leavers; the typed search goes to the server.
//  3. web-hire-16 / web-learn-01  Company-scoped lists: the first load goes out before the company is
//     known (no X-Company-Id: every company for the owner). With the company list held back 1.5 s
//     (a slow network), the Programs list must end on the current company's programs only, and the
//     current company's program must never vanish while that happens. The enrol search on a program
//     says why no one is listed when the directory fails (it said "No employees in this company").
//  4. web-pay-11  A manager typing a payroll, bank, employee-directory or billing address sees
//     "Access Restricted" and the address stays (some sent them Home). The owner still opens them.
//  5. web-perf-03  Review cycles shows the team-only note to a manager (who holds appraisal.initiate).
// Created: a temporary company, one program in it and one in the demo company. All removed at the end.
//
// Run from apps/platform:  node e2e/recovery/live-b8-testerfix.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3002), RECOVERY_API_URL (default http://127.0.0.1:8080/api),
//        RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD, SHOTS (screenshot folder; "0" for none)
// The check-in prompt after sign-in would cover every click: mark it as already shown (as live-w3-w62 does).
import './_skip-punch-prompt.mjs'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.SHOTS === '0' ? null : (process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots')
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const info = (s) => console.log(`..  ${s}`)
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()
/** The next Monday to Friday on or after `iso`. */
const workday = (iso) => { let d = iso; while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d }
const tag = String(Date.now() % 1000000)
if (shots) mkdirSync(shots, { recursive: true })

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  let perms = Array.isArray(d.permissions) ? d.permissions : []
  if (!perms.length) try { perms = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] } catch { /* opaque */ }
  return { call, perms: new Set(perms) }
}

const browser = await chromium.launch({ headless: true })
let lastPage = null

/** A signed-in page. Page errors and failed API calls are collected after sign-in. */
async function signIn(email, { width = 1440, height = 1000, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  lastPage = page
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1500)
  if (init) await init(ctx, page)
  errors.length = 0; failedApi.length = 0
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
  return { ctx, page, errors, failedApi, settle }
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/b8-testerfix-${name}.png` }) }

// ── "Select dates" helpers ──
const picker = (page) => page.getByRole('dialog', { name: 'Select dates' })
/** The two date boxes' values, as yyyy-MM-dd ('' when not picked). */
async function boxes(scope) {
  const read = async (re) => {
    const label = await scope.locator('button.udr-field').filter({ has: scope.page().locator('.udr-field-k', { hasText: re }) }).first().getAttribute('aria-label')
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(label || '')
    return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
  }
  return { from: await read(/^From/), to: await read(/^To/) }
}
async function openBox(scope, which) {
  await scope.locator('button.udr-field').filter({ has: scope.page().locator('.udr-field-k', { hasText: which === 'from' ? /^From/ : /^To/ }) }).first().click()
  await picker(scope.page()).waitFor({ timeout: 10_000 })
}
/** Taps `iso` in the open picker (moving to its month first). */
async function tap(page, iso) {
  const dlg = picker(page)
  for (let i = 0; i < 4 && !(await dlg.locator(`button[data-day="${iso}"]`).count()); i++) {
    const now = await dlg.locator('button[data-day]').first().getAttribute('data-day')
    await dlg.getByRole('button', { name: now && now.slice(0, 7) > iso.slice(0, 7) ? 'Previous month' : 'Next month' }).click()
  }
  await dlg.locator(`button[data-day="${iso}"]`).click()
}
const done = async (page) => { await picker(page).getByRole('button', { name: 'Done' }).click(); await picker(page).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {}) }

/** The From / To flow on one form: To moves the end, From moves the start and keeps the end. */
async function rangeFlow(scope, label, { a, b, c }, shotName) {
  const page = scope.page()
  await openBox(scope, 'from'); await tap(page, a); await done(page)
  let v = await boxes(scope)
  check(`${label}: From, tap ${a}, Done → ${a} to ${a}`, v.from === a && v.to === a, JSON.stringify(v))
  await openBox(scope, 'to')
  if (shotName) { await page.waitForTimeout(500); await shot(page, `${shotName}-to-open`) }
  await tap(page, b)
  if (shotName) { await page.waitForTimeout(500); await shot(page, `${shotName}-to-tapped`) }
  await done(page)
  v = await boxes(scope)
  check(`${label}: To, tap ${b}, Done → ${a} to ${b} (the end moves; the start stays)`, v.from === a && v.to === b, JSON.stringify(v))
  await openBox(scope, 'from'); await tap(page, c); await done(page)
  v = await boxes(scope)
  check(`${label}: From, tap ${c}, Done → ${c} to ${b} (the start moves; the end stays)`, v.from === c && v.to === b, JSON.stringify(v))
}

/** One part of the test: a failure is reported and the next part still runs. */
async function section(name, fn) {
  try { await fn() } catch (e) {
    check(`${name}: ran to the end`, false, String(e && e.message || e).split(/\r?\n/).slice(0, 4).join(' | '))
    try { if (lastPage && shots) await lastPage.screenshot({ path: `${shots}/b8-testerfix-fail-${name.replace(/\W+/g, '-')}.png` }) } catch { /* page gone */ }
  }
}

let tempCo = null
let override = null // the manager's temporary hrms.appraisal.initiate grant (production's DEPT_MANAGER holds it)
const programs = []
const tempCoName = `zz QA B8 Co ${tag}`
const otherProgram = `zz QA B8 other company ${tag}`
const ownProgram = `zz QA B8 own company ${tag}`

try {
  const mgrId = sql(`select id from auth.user_credentials where email='mgr@unifiedtree.demo' and tenant_id='${tenant}'`)
  const mgrHas = sql(`select count(*) from rbac.role_permissions rp join rbac.user_roles ur on ur.role_id=rp.role_id where ur.user_id='${mgrId}' and rp.permission_code='hrms.appraisal.initiate'`) !== '0'
  if (!mgrHas && mgrId) {
    override = sql(`insert into rbac.user_permission_overrides(tenant_id, user_id, permission_code, effect, reason) values ('${tenant}', '${mgrId}', 'hrms.appraisal.initiate', 'GRANT', 'QA B8 testerfix ${tag}') on conflict do nothing returning id`).split(/\r?\n/)[0] || null
  }
  const owner = await session('owner@unifiedtree.demo')
  const mgr = await session('mgr@unifiedtree.demo')
  // Dates: a working day three days on, the next working day three after it, and tomorrow (the form's earliest day is today).
  const a = workday(istDay(3)), b = workday(addDays(a, 3)), c = istDay(1)

  // ── 1. web-leave-06: Apply for leave (reader), desktop and phone ──
  await section('leave dates (reader)', async () => {
    const r = await signIn('reader@unifiedtree.demo')
    await r.page.goto(base + '/hrms/leave?tab=apply'); await r.settle()
    const form = r.page.locator('.udr-fields').first()
    await form.waitFor({ timeout: 20_000 })
    await rangeFlow(r.page.locator('body'), 'Apply for leave 1440', { a, b, c }, 'leave-1440')
    check('Apply for leave 1440: no page errors', !r.errors.length, r.errors.join(' | '))
    await r.ctx.close()
    const m = await signIn('reader@unifiedtree.demo', { width: 390, height: 844 })
    await m.page.goto(base + '/hrms/leave?tab=apply'); await m.settle()
    await m.page.locator('.udr-fields').first().waitFor({ timeout: 20_000 })
    await rangeFlow(m.page.locator('body'), 'Apply for leave 390', { a, b, c }, 'leave-390')
    const wide = await m.page.evaluate(() => document.documentElement.scrollWidth)
    check('Apply for leave 390: no sideways scroll', wide <= 392, `scrollWidth ${wide}`)
    await m.ctx.close()
  })

  // ── 1 + 2. Apply on behalf (owner): the date flow, people on probation / notice period, no leavers ──
  const probation = sql(`select employee_code || '|' || first_name || '|' || coalesce(last_name,'') from hrms.employees where company_id='${company}' and employment_status='PROBATION' and employee_code is not null order by employee_code limit 1`).split('|')
  const notice = sql(`select employee_code || '|' || first_name from hrms.employees where company_id='${company}' and employment_status='NOTICE_PERIOD' and employee_code is not null order by employee_code limit 1`).split('|')
  const leaver = sql(`select employee_code || '|' || first_name from hrms.employees where company_id='${company}' and employment_status in ('EXITED','TERMINATED') and employee_code is not null order by employee_code limit 1`).split('|')
  info(`probation ${probation.join(' ')} · notice ${notice.join(' ')} · leaver ${leaver.join(' ')}`)
  await section('on behalf (owner)', async () => {
    for (const code of ['hrms.leave.apply.others', 'hrms.expense.claim.others']) check(`precondition: the owner holds ${code}`, owner.perms.has(code))
    const o = await signIn('owner@unifiedtree.demo')
    const { page } = o
    await page.goto(base + '/hrms/leave'); await o.settle()
    await page.getByRole('button', { name: 'Apply on behalf' }).first().click()
    const panel = page.getByRole('dialog', { name: 'Apply leave on behalf' })
    await panel.waitFor({ timeout: 15_000 })
    const listed = async (code) => {
      const trigger = panel.locator('.uko-dd-trigger').first()
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
      const box = page.getByRole('combobox', { name: 'Search employee' })
      await box.fill(code)
      await page.waitForTimeout(900)
      return page.getByRole('option').filter({ hasText: code }).count()
    }
    check(`Apply on behalf: someone on probation is listed (${probation[0]})`, await listed(probation[0]) > 0)
    check(`Apply on behalf: someone on notice period is listed (${notice[0]})`, await listed(notice[0]) > 0)
    check(`Apply on behalf: a leaver is not listed (${leaver[0]})`, await listed(leaver[0]) === 0)
    // Pick the probation person (anyone listed, if they are not), then the dates.
    const pickable = await listed(probation[0]) ? page.locator('.uko-dd-option').filter({ hasText: probation[0] }) : (await listed(''), page.locator('.uko-dd-option'))
    await pickable.first().click()
    check('Apply on behalf: the chosen person shows in the box', (await panel.locator('.uko-dd-trigger').first().innerText()).includes(probation[1]))
    await rangeFlow(panel, 'Apply on behalf', { a, b, c }, 'onbehalf-1440')
    await panel.getByRole('button', { name: 'Cancel' }).click()
    // Claim on behalf (Expenses): the same people.
    await page.goto(base + '/hrms/expenses?tab=behalf'); await o.settle()
    const native = page.locator('select[aria-label="For employee"]')
    const claimListed = async (code) => {
      if (await native.count()) return (await native.locator('option').allInnerTexts()).filter((t) => t.includes(code)).length
      const trigger = page.locator('.uko-dd').filter({ has: page.locator('.uko-sr', { hasText: 'For employee' }) }).locator('.uko-dd-trigger')
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
      await page.getByRole('combobox', { name: 'Search for employee' }).fill(code)
      await page.waitForTimeout(900)
      return page.getByRole('option').filter({ hasText: code }).count()
    }
    await page.getByText('For employee *').first().waitFor({ timeout: 20_000 })
    check(`Claim on behalf: someone on probation is listed (${probation[0]})`, await claimListed(probation[0]) > 0)
    check(`Claim on behalf: someone on notice period is listed (${notice[0]})`, await claimListed(notice[0]) > 0)
    check(`Claim on behalf: a leaver is not listed (${leaver[0]})`, await claimListed(leaver[0]) === 0)
    const sentSearch = []
    page.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.endsWith('/v1/hrms/employees') && u.searchParams.get('search')) sentSearch.push(u.searchParams.get('search')) })
    if (!(await native.count())) await claimListed(probation[1])
    check('Claim on behalf: the typed search goes to the server', sentSearch.includes(probation[1]), sentSearch.join(','))
    check('on behalf: no page errors or failed calls', !o.errors.length && !o.failedApi.length, [...o.errors, ...o.failedApi].join(' | '))
    await o.ctx.close()
  })

  // ── 3. Company-scoped lists: fixtures ──
  const made = await owner.call('/v1/hrms/companies', 'POST', { name: tempCoName, industry: 'Quality checks', country: 'India', currency: 'INR' })
  tempCo = made.json && made.json.id
  check('fixture: temporary second company created', made.status === 201 && !!tempCo, `status ${made.status}`)
  const mk = async (companyId, title) => {
    const r = await owner.call('/v1/learning/programs', 'POST', { companyId, title, category: 'QA', mode: 'ONLINE', capacity: 5 })
    if (r.json && r.json.id) programs.push(r.json.id)
    return r
  }
  const p1 = await mk(tempCo, otherProgram)
  const p2 = await mk(company, ownProgram)
  check('fixture: one program in each company', p1.status === 201 && p2.status === 201, `${p1.status} ${p2.status}`)
  const listNoHeader = await owner.call('/v1/learning/programs?page=0&size=50')
  info(`API without X-Company-Id lists the other company's program: ${JSON.stringify(listNoHeader.json).includes(otherProgram)}`)
  await section('company-scoped lists', async () => {
    // The company list arrives 1.5 s late (a slow network), as on a hard refresh in production.
    const o = await signIn('owner@unifiedtree.demo', {
      init: async (ctx) => {
        await ctx.route('**/api/v1/me/companies', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })
        await ctx.addInitScript(([own, other]) => {
          window.__seen = []
          let last = ''
          setInterval(() => {
            const t = document.body ? document.body.innerText : ''
            const s = `${t.includes(own) ? 'own' : '-'}/${t.includes(other) ? 'other' : '-'}`
            if (s !== last) { window.__seen.push(s); last = s }
          }, 25)
        }, [ownProgram, otherProgram])
      },
    })
    const { page } = o
    const sent = []
    page.on('request', (q) => { if (q.url().includes('/api/v1/learning/programs?')) sent.push(q.headers()['x-company-id'] ? 'header' : 'no-header') })
    await page.goto(base + '/hrms/learning?view=programs'); await o.settle()
    await page.waitForTimeout(2500); await o.settle()
    info(`programs list requests in order: ${sent.join(', ')} (cause: the first goes out before the company is known)`)
    const seen = await page.evaluate(() => window.__seen)
    info(`what the list showed over time (own/other): ${seen.join(' → ')}`)
    const text = await page.locator('body').innerText()
    check('Programs: ends on the current company — the other company’s program is not listed', text.includes(ownProgram) && !text.includes(otherProgram))
    const firstOwn = seen.findIndex((s) => s.startsWith('own'))
    check('Programs: the current company’s program never vanishes once shown (no flicker)', firstOwn >= 0 && seen.slice(firstOwn).every((s) => s.startsWith('own')), seen.join(' → '))
    check('Programs: after the company is known, the list is loaded for it (X-Company-Id)', sent.includes('header'), sent.join(','))
    await shot(page, 'programs-1440')

    // ── 3b. web-learn-01: the enrol search says why no one is listed ──
    await o.ctx.unroute('**/api/v1/me/companies')
    const group = page.getByRole('group', { name: 'People to enroll' })
    const DIR = /\/api\/v1\/hrms\/employees\?/
    /** The enrol search's line once it has settled on `want` (react-query retries a 5xx a couple of times). */
    const settled = async (want) => {
      let t = ''
      for (let i = 0; i < 30; i++) { t = (await group.innerText().catch(() => '')).trim(); if (want.test(t)) break; await page.waitForTimeout(500) }
      return t
    }
    await page.route(DIR, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Access denied', errorCode: 'ACCESS_DENIED' }) }))
    await page.goto(base + `/hrms/learning/programs/${programs[1]}`); await o.settle()
    await group.waitFor({ timeout: 20_000 }).catch(() => {})
    const said = await settled(/need access|No employees/)
    check('Enroll search, directory refused (403): says you need access, not "No employees in this company"', said === 'You need access to the employee directory to enroll people.', said)
    await page.unroute(DIR)
    await page.route(DIR, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'QA: the directory is down' }) }))
    await page.reload(); await o.settle()
    const said500 = await settled(/directory is down/)
    check('Enroll search, directory failed (500): shows the server’s reason', said500 === 'QA: the directory is down', said500)
    await page.unroute(DIR)
    await page.reload(); await o.settle()
    const ok = await settled(/\S/)
    check('Enroll search, directory fine: lists people again', !/need access|directory is down|No employees in this company/.test(ok) && ok.length > 0, ok.slice(0, 80))
    await o.ctx.close()
  })

  // ── 4. web-pay-11: blocked addresses show Access Restricted (manager); the owner still opens them ──
  await section('blocked addresses', async () => {
    const blocked = [
      ['/hrms/payroll/runs', 'payroll.runs.read'], ['/hrms/bank-disbursement', 'payroll.runs.read'], ['/hrms/bank-disbursement/setup', 'payroll.runs.read'],
      ['/hrms/employees', 'hrms.employee.read'], ['/settings/billing', 'workspace.billing.manage'], ['/business/billing', 'workspace.billing.manage'],
    ]
    const m = await signIn('mgr@unifiedtree.demo')
    for (const [path, perm] of blocked) {
      if (mgr.perms.has(perm)) { check(`manager ${path}: precondition (no ${perm})`, false, 'the manager holds it'); continue }
      await m.page.goto(base + path); await m.settle()
      const at = new URL(m.page.url()).pathname
      const restricted = await m.page.getByRole('heading', { name: 'Access Restricted' }).count()
      check(`manager ${path}: "Access Restricted", address kept`, restricted > 0 && at === path, `at ${at}, restricted ${restricted}`)
      if (path === '/hrms/payroll/runs') await shot(m.page, 'mgr-payroll-runs-1440')
    }
    await m.ctx.close()
    const o = await signIn('owner@unifiedtree.demo')
    for (const path of ['/hrms/payroll/runs', '/hrms/employees', '/settings/billing']) {
      await o.page.goto(base + path); await o.settle()
      check(`owner ${path}: opens (no Access Restricted)`, !(await o.page.getByRole('heading', { name: 'Access Restricted' }).count()) && new URL(o.page.url()).pathname === path)
    }
    await o.ctx.close()
  })

  // ── 5. web-perf-03: Review cycles' team-only note for a manager ──
  await section('review cycles note', async () => {
    check('precondition: the manager holds hrms.appraisal.initiate (as DEPT_MANAGER does in production) and not performance.write',
      mgr.perms.has('hrms.appraisal.initiate') && !mgr.perms.has('hrms.performance.write'), override ? 'granted for this test' : 'from their role')
    info(`manager: performance.read ${mgr.perms.has('hrms.performance.read')}, appraisal.initiate ${mgr.perms.has('hrms.appraisal.initiate')}, performance.write ${mgr.perms.has('hrms.performance.write')}`)
    const note = /Each cycle’s progress shows your team only/
    const m = await signIn('mgr@unifiedtree.demo')
    await m.page.goto(base + '/hrms/performance?view=cycles'); await m.settle()
    check('manager Review cycles: the team-only note shows', await m.page.getByText(note).count() > 0)
    await shot(m.page, 'mgr-cycles-1440')
    await m.ctx.close()
    const o = await signIn('owner@unifiedtree.demo')
    await o.page.goto(base + '/hrms/performance?view=cycles'); await o.settle()
    check('owner Review cycles: no team-only note', await o.page.getByText(note).count() === 0)
    await o.ctx.close()
  })
} catch (e) {
  check('test ran to the end', false, String(e && e.message || e).split('\n').slice(0, 6).join(' | '))
} finally {
  await browser.close()
  if (override) {
    try {
      sql(`delete from rbac.user_permission_overrides where id='${override}' and reason like 'QA B8 testerfix %'`)
      check('cleanup: manager’s temporary grant removed', sql(`select count(*) from rbac.user_permission_overrides where id='${override}'`) === '0')
    } catch (err) { check('cleanup: manager’s temporary grant removed', false, String(err).split('\n')[0]) }
  }
  // Remove what this test made: its programs (with any enrollments and audit rows), then the temporary company.
  try {
    for (const id of programs) {
      sql(`delete from learning_mgmt.training_enrollments where program_id='${id}'`)
      sql(`delete from audit.events where entity_id='${id}'`)
      sql(`delete from learning_mgmt.training_programs where id='${id}' and title like 'zz QA B8 %'`)
    }
    check('cleanup: programs removed', !programs.length || sql(`select count(*) from learning_mgmt.training_programs where id in (${programs.map(lit).join(',')})`) === '0')
  } catch (err) { check('cleanup: programs removed', false, String(err).split('\n')[0]) }
  if (tempCo) {
    try {
      const mine = sql(`select count(*) from org.companies where id='${tempCo}' and name=${lit(tempCoName)} and tenant_id='${tenant}'`) === '1'
      if (mine) sql(`delete from attendance.shift_policies p where p.company_id='${tempCo}' and not exists (select 1 from attendance.employee_shift_assignments a where a.shift_policy_id=p.id)`)
      const tables = sql("select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')").split('\n').filter(Boolean)
      const refs = sql(tables.map((t) => `select '${t}' where exists (select 1 from ${t} where company_id='${tempCo}')`).join(' union all ')).split('\n').filter(Boolean)
      if (mine && !refs.length) {
        sql(`delete from audit.events where entity_id='${tempCo}'`)
        const gone = sql(`with d as (delete from org.companies where id='${tempCo}' and name=${lit(tempCoName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
        check('cleanup: temporary company removed', gone === '1')
      } else {
        check('cleanup: temporary company removed', false, mine ? `still referenced by ${refs.join(', ')}` : 'not the company this test made; left alone')
      }
    } catch (err) { check('cleanup: temporary company removed', false, String(err).split('\n')[0]) }
  }
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} passed`)
  process.exit(failed ? 1 : 0)
}
