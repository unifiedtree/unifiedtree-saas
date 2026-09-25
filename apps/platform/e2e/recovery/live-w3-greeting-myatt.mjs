// Wave 3 — greeting name rule + no "My Attendance" for owners and admins.
// Browser acceptance against a running backend + web app:
//  - Owner (OWNER) and admin@ (SUPER_ADMIN): Daily Tracking has no My Attendance
//    tab, ?tab=my falls back to Daily Logs (no crash, no blank page), no
//    My Attendance anywhere on the page, and search doesn't offer it.
//  - reader@ (EMPLOYEE), mgr@ (DEPT_MANAGER) and hrm@ (HR_MANAGER) still see
//    the tab and open it with ?tab=my; search still offers it to them.
//  - Greeting: the owner's normal greeting still shows the first name. With a
//    one-letter first name ("A" / "R.") the dashboards show the full name. The
//    two names are changed in the database for the check and put back after.
//
// Run from apps/platform:  node e2e/recovery/live-w3-greeting-myatt.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3012),
//        RECOVERY_DB (the database the backend uses; default ut_w3_dev),
//        PSQL (psql.exe path), RECOVERY_PASSWORD, SHOTS (screenshot folder)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3012'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const OWNER_EMP = '11111111-1111-1111-1111-111111111111' // owner@ and admin@ ("Admin User")
const READER_EMP = '22222222-2222-2222-2222-222222222222' // reader@ ("Reader User")
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const GREETING = /Good (morning|afternoon|evening), /

mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ headless: true })

/** A fresh signed-in session. Page errors and failed API calls are collected after sign-in. */
async function signIn(email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  // A dev server compiles each page on its first visit; allow for that.
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Let the welcome splash finish. Sign-in itself makes known 401 → refresh round
  // trips; measure the pages, not the login.
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}

/** Open Daily Tracking (optionally with ?tab=) and return the tab labels and the selected one. */
async function openDaily(page, query = '') {
  await page.goto(base + '/hrms/attendance' + query)
  const list = page.getByRole('tablist').filter({ has: page.getByRole('tab') }).last()
  await list.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  const tabs = (await list.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  const selected = ((await list.locator('[role=tab][aria-selected=true]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  const heading = ((await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')) || '').trim()
  return { tabs, selected, heading }
}

/** Search the ⌘K palette and return the text of every result row. */
async function search(page, text) {
  await page.keyboard.press('Control+k')
  const input = page.locator('input[aria-controls="global-search-results"]')
  await input.waitFor({ timeout: 10_000 })
  await input.fill(text)
  await page.locator('#global-search-results [role=option], #global-search-results [role=status]').first().waitFor({ timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(700)
  const rows = await page.locator('#global-search-results [role=option]').allInnerTexts()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  return rows.map((r) => r.replace(/\s+/g, ' ').trim())
}
const offersMyAttendance = (rows) => rows.some((r) => /\bmy attendance\b/i.test(r))

async function greetingOn(page, path) {
  await page.goto(base + path)
  const h = page.getByRole('heading', { level: 1 }).filter({ hasText: GREETING }).first()
  await h.waitFor({ timeout: 30_000 })
  return (await h.innerText()).trim()
}

const restore = []
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
try {
  const nameOf = (id) => sql(`select first_name || '|' || coalesce(last_name, '') from hrms.employees where id='${id}'`).split('|')
  const [ownerFirst, ownerLast] = nameOf(OWNER_EMP)
  const [readerFirst, readerLast] = nameOf(READER_EMP)
  check('fixture: the owner and employee demo records exist', !!ownerFirst && !!readerFirst, `${ownerFirst} ${ownerLast} / ${readerFirst} ${readerLast} in ${db}`)

  // ── Owner: no My Attendance anywhere, ?tab=my falls back ─────────────────────
  {
    const s = await signIn('owner@unifiedtree.demo')
    const rows = await search(s.page, 'my attendance')
    check('owner: search does not offer My Attendance', !offersMyAttendance(rows), rows.slice(0, 4).join(' | ') || 'no results')
    const sanity = await search(s.page, 'daily logs')
    check('owner: search itself works (offers Daily Logs)', sanity.some((r) => /Daily Logs/.test(r)), sanity.slice(0, 3).join(' | ') || 'no results')

    const d = await openDaily(s.page)
    check('owner: Daily Tracking has no My Attendance tab', d.tabs.length > 0 && !d.tabs.some((t) => /My Attendance/i.test(t)), d.tabs.join(', '))
    check('owner: Daily Logs is still there', d.tabs.some((t) => /Daily Logs/.test(t)), d.tabs.join(', '))
    check('owner: nothing on the page says My Attendance (tabs, menu, header)', (await s.page.getByText(/My Attendance/i).count()) === 0)
    await s.page.screenshot({ path: `${shots}/greeting-myatt-owner-daily.png` })

    const f = await openDaily(s.page, '?tab=my')
    check('owner: ?tab=my opens the first tab they have (Daily Logs)', /Daily Logs/.test(f.selected) && /Daily Logs/.test(f.heading), `selected="${f.selected}" heading="${f.heading}"`)
    check('owner: ?tab=my shows no My Attendance tab', !f.tabs.some((t) => /My Attendance/i.test(t)), f.tabs.join(', '))
    await s.page.screenshot({ path: `${shots}/greeting-myatt-owner-tab-my.png` })

    const g = await greetingOn(s.page, '/dashboard')
    check(`owner: dashboard greeting shows the first name ("${ownerFirst}")`, new RegExp(`, ${esc(ownerFirst)}(\\s|$)`).test(g) && !(ownerLast && g.includes(`${ownerFirst} ${ownerLast}`)), g)
    await s.page.screenshot({ path: `${shots}/greeting-myatt-owner-dashboard.png` })

    check('owner: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('owner: no failed API calls', s.failedApi.length === 0, s.failedApi.slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── Owner on a phone: same fallback ─────────────────────────────────────────
  {
    const s = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    const f = await openDaily(s.page, '?tab=my')
    check('owner (phone): ?tab=my opens Daily Logs, no My Attendance tab', /Daily Logs/.test(f.selected) && !f.tabs.some((t) => /My Attendance/i.test(t)), `selected="${f.selected}" tabs=${f.tabs.join(', ')}`)
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('owner (phone): no sideways page scroll', overflow <= 1, `${overflow}px`)
    await s.page.screenshot({ path: `${shots}/greeting-myatt-owner-phone.png` })
    check('owner (phone): no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── Super admin: same as the owner ──────────────────────────────────────────
  {
    const s = await signIn('admin@unifiedtree.demo')
    const f = await openDaily(s.page, '?tab=my')
    check('super admin: no My Attendance tab; ?tab=my opens Daily Logs', /Daily Logs/.test(f.selected) && !f.tabs.some((t) => /My Attendance/i.test(t)), `selected="${f.selected}" tabs=${f.tabs.join(', ')}`)
    const rows = await search(s.page, 'my attendance')
    check('super admin: search does not offer My Attendance', !offersMyAttendance(rows), rows.slice(0, 4).join(' | ') || 'no results')
    check('super admin: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── Everyone else keeps My Attendance ───────────────────────────────────────
  for (const [who, email] of [['employee', 'reader@unifiedtree.demo'], ['dept manager', 'mgr@unifiedtree.demo'], ['HR manager', 'hrm@unifiedtree.demo']]) {
    const s = await signIn(email)
    const rows = await search(s.page, 'my attendance')
    check(`${who}: search still offers My Attendance`, offersMyAttendance(rows), rows.slice(0, 4).join(' | ') || 'no results')
    const d = await openDaily(s.page)
    check(`${who}: Daily Tracking still has the My Attendance tab`, d.tabs.some((t) => /My Attendance/.test(t)), d.tabs.join(', '))
    const f = await openDaily(s.page, '?tab=my')
    check(`${who}: ?tab=my opens My Attendance`, /My Attendance/.test(f.selected) && /My Attendance/.test(f.heading), `selected="${f.selected}" heading="${f.heading}"`)
    if (who === 'employee') await s.page.screenshot({ path: `${shots}/greeting-myatt-employee-tab-my.png` })
    if (who === 'dept manager') {
      const g = await greetingOn(s.page, '/team')
      check('dept manager: My team greeting shows the first name ("Dept")', /, Dept\b/.test(g) && !/Dept Manager/.test(g), g)
    }
    check(`${who}: no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check(`${who}: no failed API calls`, s.failedApi.length === 0, s.failedApi.slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── Greeting with a one-letter first name ───────────────────────────────────
  if (ownerFirst && readerFirst) {
    restore.push(() => sql(`update hrms.employees set first_name=${lit(ownerFirst)} where id='${OWNER_EMP}'`))
    restore.push(() => sql(`update hrms.employees set first_name=${lit(readerFirst)} where id='${READER_EMP}'`))
    sql(`update hrms.employees set first_name='A' where id='${OWNER_EMP}'`)
    sql(`update hrms.employees set first_name='R.' where id='${READER_EMP}'`)

    const ownerFull = `A ${ownerLast}`.trim(), readerFull = `R. ${readerLast}`.trim()
    const fullIn = (text, full) => new RegExp(`, ${esc(full)}(\\s|!|$)`).test(text)
    const o = await signIn('owner@unifiedtree.demo')
    const g = await greetingOn(o.page, '/dashboard')
    check(`first name "A": admin dashboard greets with the full name "${ownerFull}"`, fullIn(g, ownerFull), g)
    await o.page.screenshot({ path: `${shots}/greeting-myatt-owner-initial.png` })
    await o.page.goto(base + '/modules')
    const apps = o.page.getByText(GREETING).first()
    await apps.waitFor({ timeout: 20_000 })
    const appsText = (await apps.innerText()).trim()
    check(`first name "A": apps page greets with the full name "${ownerFull}"`, fullIn(appsText, ownerFull), appsText)
    check('first name "A": no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '))
    await o.ctx.close()

    const r = await signIn('reader@unifiedtree.demo')
    const rg = await greetingOn(r.page, '/dashboard')
    check(`first name "R.": staff dashboard greets with the full name "${readerFull}"`, fullIn(rg, readerFull), rg)
    const mg = await greetingOn(r.page, '/me')
    check(`first name "R.": My workspace greets with the full name "${readerFull}"`, fullIn(mg, readerFull), mg)
    await r.page.screenshot({ path: `${shots}/greeting-myatt-reader-initial.png` })
    check('first name "R.": no page errors', r.errors.length === 0, r.errors.slice(0, 3).join(' | '))
    await r.ctx.close()

    // Put the names back now (the finally block repeats it if anything threw first).
    while (restore.length) restore.pop()()
    check('names put back', sql(`select first_name from hrms.employees where id='${OWNER_EMP}'`) === ownerFirst && sql(`select first_name from hrms.employees where id='${READER_EMP}'`) === readerFirst)
  }
} catch (e) {
  check('scenario completed without an exception', false, String(e).split('\n')[0])
} finally {
  for (const f of restore.reverse()) { try { f() } catch (e) { console.log('restore failed: ' + String(e).split('\n')[0]) } }
  await browser.close()
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
