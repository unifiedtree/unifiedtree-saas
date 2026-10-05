// Live check for feat/web-company-selector: the HRMS's one current company and the top bar's
// company selector (master context §9).
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3071 node e2e/recovery/live-company-selector.mjs
//
// What it proves, against the local backend and database:
//  - One company (the demo workspace as it is): no selector anywhere, Departments shows the demo company.
//  - With a second company (Company B, made here with a department, a leave type, a shift and a
//    dashboard notice), owner@ sees the selector on the demo company (the first company: owner@ has no
//    employee record, so no home company). Switching to B changes Departments, Leave › Leave types,
//    Shifts & overtime and the Dashboard to B's data, with nothing of the demo company's left on screen.
//  - The choice survives a reload; a link with ?co=<demo company> opens the demo company.
//  - reader@ (an employee: their own company only) gets no selector, even with two companies.
//  - Requests carry no X-Company-Id yet (it is switched on with GET /v1/me/companies).
//  - Phone 390 and dark mode: the selector and its menu read well (screenshots only).
//  - Once B is removed, owner@ is back to one company: no selector, the demo company's data.
// Screenshots go to W3_SHOTS (w26-cosel-*.png). Everything made here is removed at the end: only rows of
// the company this test made (checked by id and name).
/* global process, console, fetch, document, localStorage */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
// Sorts after the demo company, so the demo company stays the first (default) one.
const coName = `zz QA Cosel B ${tag}`
const deptName = `QA Cosel Dept ${tag}`
const leaveName = `QA Cosel Leave ${tag}`
const shiftName = `QA Cosel Shift ${tag}`
const noticeTitle = `QA Cosel notice ${tag}`
let coId = null
let where = 'start', lastPage = null
const at = (name, page) => { where = name; if (page) lastPage = page; console.log(`..  ${name}`) }
mkdirSync(shots, { recursive: true })

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

const browser = await chromium.launch()
async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = [], failed = [], companyHeaders = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('request', (r) => { if (r.url().includes('/api/') && r.headers()['x-company-id']) companyHeaders.push(r.url().split('/api')[1]) })
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`)
  })
  await page.goto(base + '/login', { timeout: 180_000 }) // the first load compiles the app
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  lastPage = page
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
  const open = async (path) => { at(`${email} → ${path}`, page); await page.goto(base + path); await settle() }
  return { page, context, errors, failed, companyHeaders, settle, open }
}
const selector = (page) => page.locator('button.ut-cosel')
const seen = async (page, text, timeout = 15000) => page.getByText(text, { exact: false }).first().waitFor({ timeout }).then(() => true, () => false)
const absent = async (page, text) => (await page.getByText(text, { exact: false }).count()) === 0
async function switchTo(page, name) {
  at(`switch to ${name}`, page)
  await selector(page).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}

try {
  // ── fixtures ──
  at('fixtures')
  const owner = await apiLogin('owner@unifiedtree.demo')
  const list = await owner('GET', '/v1/hrms/companies')
  const demo = (list.json || [])[0]
  check('fixture: the workspace has one company', list.status === 200 && (list.json || []).length === 1, `${(list.json || []).map((c) => c.name).join(', ')}`)
  if (!demo || (list.json || []).length !== 1) throw new Error('expected a one-company workspace to start from')
  const demoDept = sql(`select name from hrms.departments where company_id='${demo.id}' and is_active order by name limit 1`)
  const demoLeave = sql(`select name from leave_mgmt.leave_types where company_id='${demo.id}' and is_active order by name limit 1`)
  check('fixture: the demo company has a department and a leave type', !!demoDept && !!demoLeave, `${demoDept} · ${demoLeave}`)

  // ── 1. one company: no selector, the demo company's data ──
  {
    const o = await signIn('owner@unifiedtree.demo')
    await o.open('/hrms/master/departments')
    check('one company: Departments shows the demo company', await seen(o.page, demoDept))
    check('one company: no company selector', await selector(o.page).count() === 0)
    await o.page.screenshot({ path: `${shots}/w26-cosel-single-1440.png` })
    await o.open('/dashboard')
    check('one company: no selector on the Dashboard either', await selector(o.page).count() === 0)
    check('one company: no page errors', !o.errors.length, o.errors[0] || '')
    check('one company: no failed API calls', !o.failed.length, o.failed.join(' | '))
    await o.context.close()
  }

  // ── Company B and a few of its records ──
  at('make company B')
  const made = await owner('POST', '/v1/hrms/companies', { name: coName, industry: 'Quality checks', country: 'India', currency: 'INR' })
  coId = made.json && made.json.id
  check('API: company B created', made.status === 201 && !!coId, `status ${made.status}`)
  if (!coId) throw new Error('could not create company B')
  const dept = await owner('POST', '/v1/hrms/departments', { companyId: coId, name: deptName, code: `QC${tag.slice(-4)}` })
  check('API: a department in B', dept.status === 201 || dept.status === 200, `status ${dept.status} ${JSON.stringify(dept.json).slice(0, 160)}`)
  const lt = await owner('POST', `/v1/leave/types?companyId=${coId}`, { name: leaveName, code: `QL${tag.slice(-4)}`, category: 'CASUAL', annualEntitlement: 3, isPaidLeave: true })
  check('API: a leave type in B', lt.status === 201 || lt.status === 200, `status ${lt.status} ${JSON.stringify(lt.json).slice(0, 160)}`)
  const sh = await owner('POST', `/v1/shifts?companyId=${coId}`, { name: shiftName, shiftType: 'FIXED', startTime: '07:00:00', endTime: '15:00:00', gracePeriodMinutes: 10, workingHoursPerDay: 8 })
  check('API: a shift in B', sh.status === 201 || sh.status === 200, `status ${sh.status} ${JSON.stringify(sh.json).slice(0, 160)}`)
  const nt = await owner('POST', '/v1/admin/dashboard/notices', { companyId: coId, title: noticeTitle, body: 'Only for company B.' })
  check('API: a dashboard notice in B', nt.status === 201 || nt.status === 200, `status ${nt.status} ${JSON.stringify(nt.json).slice(0, 160)}`)

  // ── 2. owner@ with two companies: switch A → B ──
  {
    const o = await signIn('owner@unifiedtree.demo')
    await o.open('/hrms/master/departments')
    check('two companies: the selector shows, on the demo company', await selector(o.page).count() === 1 && (await selector(o.page).innerText()).includes(demo.name), await selector(o.page).innerText().catch(() => ''))
    check('demo company: Departments shows its department', await seen(o.page, demoDept))
    check('demo company: … and not B’s', await absent(o.page, deptName))
    await o.page.screenshot({ path: `${shots}/w26-cosel-a-departments-1440.png` })
    await selector(o.page).click()
    await o.page.getByRole('menu', { name: 'Companies' }).waitFor(); await o.page.waitForTimeout(500) // the menu fades in
    await o.page.screenshot({ path: `${shots}/w26-cosel-menu-1440.png` })
    await o.page.keyboard.press('Escape')

    await switchTo(o.page, coName)
    check('switched: the selector names B', (await selector(o.page).innerText()).includes(coName))
    check('B: Departments shows B’s department', await seen(o.page, deptName))
    check('B: … and none of the demo company’s', await absent(o.page, demoDept))
    await o.page.screenshot({ path: `${shots}/w26-cosel-b-departments-1440.png` })

    await o.open('/hrms/leave?tab=types')
    check('B: Leave › Leave types shows B’s leave type', await seen(o.page, leaveName))
    check('B: … and not the demo company’s', await absent(o.page, demoLeave))
    await o.page.screenshot({ path: `${shots}/w26-cosel-b-leave-1440.png` })

    await o.open('/hrms/shifts?tab=schedules')
    check('B: Shifts & overtime shows B’s shift', await seen(o.page, shiftName))
    await o.page.screenshot({ path: `${shots}/w26-cosel-b-shifts-1440.png` })

    await o.open('/dashboard')
    check('B: the Dashboard shows B’s notice', await seen(o.page, noticeTitle))
    await o.page.screenshot({ path: `${shots}/w26-cosel-b-dashboard-1440.png` })

    await o.page.reload(); await o.settle()
    check('reload: still on B', (await selector(o.page).innerText()).includes(coName))

    await o.open(`/hrms/master/departments?co=${demo.id}`)
    check('?co= link: opens the demo company', (await selector(o.page).innerText()).includes(demo.name))
    check('?co= link: the demo company’s departments', await seen(o.page, demoDept) && await absent(o.page, deptName))
    await o.open('/dashboard')
    check('demo company: the Dashboard has no B notice', await absent(o.page, noticeTitle))

    // Back on B from the selector, on the Dashboard: the page follows at once.
    await switchTo(o.page, coName)
    check('switch on the Dashboard: B’s notice appears', await seen(o.page, noticeTitle))

    check('two companies: no X-Company-Id sent yet', !o.companyHeaders.length, o.companyHeaders.slice(0, 3).join(' | '))
    check('two companies: no page errors', !o.errors.length, o.errors[0] || '')
    check('two companies: no failed API calls', !o.failed.length, o.failed.join(' | '))

    // Dark mode (screenshots).
    await o.page.evaluate(() => localStorage.setItem('ut.theme', 'dark'))
    await o.open('/hrms/master/departments')
    await o.page.screenshot({ path: `${shots}/w26-cosel-dark-1440.png` })
    await selector(o.page).click()
    await o.page.getByRole('menu', { name: 'Companies' }).waitFor(); await o.page.waitForTimeout(500) // the menu fades in
    await o.page.screenshot({ path: `${shots}/w26-cosel-dark-menu-1440.png` })
    await o.page.keyboard.press('Escape')
    await o.page.evaluate(() => localStorage.setItem('ut.theme', 'light'))
    await o.context.close()
  }

  // ── 3. phone ──
  {
    const m = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    await m.open('/hrms/master/departments')
    check('phone: the selector shows', await selector(m.page).isVisible())
    const box = await selector(m.page).boundingBox()
    check('phone: it fits the bar', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box))
    const wide = await m.page.evaluate(() => document.documentElement.scrollWidth)
    check('phone: no sideways scroll', wide <= 390, `scrollWidth ${wide}`)
    await m.page.screenshot({ path: `${shots}/w26-cosel-phone-390.png` })
    await selector(m.page).click()
    await m.page.getByRole('menu', { name: 'Companies' }).waitFor(); await m.page.waitForTimeout(500)
    await m.page.screenshot({ path: `${shots}/w26-cosel-phone-menu-390.png` })
    await m.page.keyboard.press('Escape')
    await m.page.evaluate(() => localStorage.setItem('ut.theme', 'dark'))
    await m.open('/hrms/leave?tab=types')
    await m.page.screenshot({ path: `${shots}/w26-cosel-phone-dark-390.png` })
    await m.page.evaluate(() => localStorage.setItem('ut.theme', 'light'))
    check('phone: no page errors', !m.errors.length, m.errors[0] || '')
    await m.context.close()
  }

  // ── 4. an employee: their own company only ──
  {
    const r = await signIn('reader@unifiedtree.demo')
    await r.open('/hrms/leave')
    check('reader@: no company selector (one company of their own)', await selector(r.page).count() === 0)
    check('reader@: no page errors', !r.errors.length, r.errors[0] || '')
    await r.context.close()
  }
} catch (e) {
  check('test ran to the end', false, `at "${where}": ${String(e && e.message || e).split('\n').slice(0, 14).join(' | ')}`)
  try { await lastPage?.screenshot({ path: `${shots}/w26-cosel-fail.png`, fullPage: true }) } catch { /* page gone */ }
}

// ── cleanup: every row of company B (this test made it and everything in it), then B ──
async function removeB() {
  if (!coId) return
  const mine = sql(`select count(*) from org.companies where id='${coId}' and name=${lit(coName)} and tenant_id='${tenant}'`) === '1'
  if (!mine) { check('cleanup: company B removed', false, 'not the company this test made; left alone'); return }
  const tables = sql("select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema') and not exists (select 1 from pg_inherits i join pg_class k on k.oid=i.inhrelid join pg_namespace n on n.oid=k.relnamespace where n.nspname=c.table_schema and k.relname=c.table_name)").split('\n').filter(Boolean)
  // A few passes: rows that point at other rows of B go first.
  for (let pass = 0; pass < 4; pass++) {
    let left = 0
    for (const t of tables) {
      try { sql(`delete from ${t} where company_id='${coId}'`) } catch { left++ }
    }
    if (!left) break
  }
  try { sql(`delete from audit.events where entity_id='${coId}'`) } catch { /* no audit rows */ }
  const gone = sql(`with d as (delete from org.companies where id='${coId}' and name=${lit(coName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
  check('cleanup: company B and its rows removed', gone === '1')
  coId = null
}

try {
  await removeB()
  // ── 5. one company again: as before ──
  const o = await signIn('owner@unifiedtree.demo')
  await o.open('/hrms/master/departments')
  check('after cleanup: no selector', await selector(o.page).count() === 0)
  check('after cleanup: Departments shows the demo company', await seen(o.page, sql(`select name from hrms.departments where is_active and company_id=(select id from org.companies where tenant_id='${tenant}' order by name limit 1) order by name limit 1`)))
  check('after cleanup: no page errors', !o.errors.length, o.errors[0] || '')
  await o.context.close()
} catch (e) {
  check('cleanup ran', false, String(e && e.message || e).split('\n')[0])
} finally {
  if (coId) { try { await removeB() } catch { /* reported above */ } }
  await browser.close()
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
