/* global URL, console, fetch, process, PopStateEvent, window, localStorage */
// Web quick batch (6 Oct 2026), browser + API acceptance against a running backend and web app:
//  1. F-20 "Page not found": an unknown address shows the screen in the shell (the address, Go to Home,
//     Back after an in-app move) instead of landing on Home; old addresses still redirect; signed out,
//     an unknown address still goes to sign-in.
//  2. F-21 the bell has Notifications and Messages: a Team message the manager sends shows under
//     Messages for the team member.
//  3. C-10 the "Select date" picker (one day) on Fix a day and Request overtime: pick a day, Done,
//     the form shows it. Nothing is sent.
//  4. GET /v1/attendance/review/history for people who have left (exited, terminated): owner, admin
//     and HR read it; a manager still only their team; an employee only their own.
// Everything created (the team message, its notifications, the history rows) is removed at the end.
//
// Run from apps/platform:  node e2e/recovery/live-web-quick-batch.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3002), RECOVERY_API_URL (default http://127.0.0.1:8080/api),
//        RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD, SHOTS (screenshot folder; "0" for none)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.SHOTS === '0' ? null : (process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots')
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER_EMP = '22222222-2222-2222-2222-222222222222'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const stamp = Date.now() % 1000000
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
  return { call }
}

const browser = await chromium.launch({ headless: true })

/** A signed-in page (light or dark). Page errors and failed API calls are collected after sign-in. */
async function signIn(email, { width = 1440, height = 1000, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  if (dark) await ctx.addInitScript(() => { try { localStorage.setItem('ut.theme', 'dark') } catch { /* blocked */ } })
  const page = await ctx.newPage()
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
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1000)
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/w28-webquick-${name}.png` }) }
const notFound = (page) => page.getByTestId('not-found')

let messageId = null
const historyRows = []
try {
  // ── 4. leavers' attendance history (API) ───────────────────────────────────
  const leaver = (status) => sql(`select id from hrms.employees where company_id=${lit(company)} and employment_status=${lit(status)} and reporting_manager_id is distinct from '44444444-4444-4444-4444-444444444444' order by created_at limit 1`)
  const exited = leaver('EXITED'), terminated = leaver('TERMINATED')
  check('fixture: an exited and a terminated person in the company', exited && terminated, `${exited} / ${terminated}`)
  const day = istDay(-10)
  for (const emp of [exited, terminated, READER_EMP].filter(Boolean)) {
    const id = sql(`insert into attendance.day_status_reviews(tenant_id, employee_id, company_id, attendance_date, action, from_status, to_status, reason, reviewer_name)
      values (${lit(tenant)}, ${lit(emp)}, ${lit(company)}, ${lit(day)}, 'SET', 'ABSENT', 'PRESENT', ${lit(`w28 quick batch ${stamp}`)}, 'QA') returning id`).split('\n')[0]
    historyRows.push(id)
  }
  const S = Object.fromEntries(await Promise.all(['owner', 'admin', 'hrm', 'mgr', 'reader'].map(async (k) => [k, await session(`${k}@unifiedtree.demo`)])))
  const history = (who, emp) => S[who].call(`/v1/attendance/review/history?employeeId=${emp}`)
  const has = (r, id) => r.status === 200 && Array.isArray(r.json) && r.json.some((x) => x.id === id)
  for (const who of ['owner', 'admin', 'hrm']) {
    const a = await history(who, exited), b = await history(who, terminated)
    check(`history: ${who} reads an exited person's history`, has(a, historyRows[0]), `${a.status}`)
    check(`history: ${who} reads a terminated person's history`, has(b, historyRows[1]), `${b.status}`)
  }
  const ownerReader = await history('owner', READER_EMP)
  check('history: owner still reads a current employee', has(ownerReader, historyRows[2]), `${ownerReader.status}`)
  const mgrLeaver = await history('mgr', exited), mgrTeam = await history('mgr', READER_EMP)
  check('history: a manager is refused a leaver outside their team (403)', mgrLeaver.status === 403, `${mgrLeaver.status}`)
  check('history: a manager still reads their own team member', has(mgrTeam, historyRows[2]), `${mgrTeam.status}`)
  const readerLeaver = await history('reader', exited), readerOwn = await history('reader', READER_EMP)
  check('history: an employee is refused someone else (403)', readerLeaver.status === 403, `${readerLeaver.status}`)
  check('history: an employee reads their own', has(readerOwn, historyRows[2]), `${readerOwn.status}`)

  // ── 2. a Team message to show under Messages ───────────────────────────────
  const text = `Stand-up moves to 10:30 tomorrow (${stamp})`
  const posted = await S.mgr.call('/v1/team/messages', 'POST', { body: text })
  messageId = posted.json?.id ?? null
  check('fixture: the manager sends a Team message', posted.status === 200 || posted.status === 201, `${posted.status} ${JSON.stringify(posted.json).slice(0, 160)}`)

  for (const v of [{ width: 1440, dark: false, tag: '1440-light' }, { width: 1440, dark: true, tag: '1440-dark' }, { width: 390, dark: false, tag: '390-light' }, { width: 390, dark: true, tag: '390-dark' }]) {
    const first = v.tag === '1440-light'
    const height = v.width < 600 ? 844 : 1000

    // ── 1. Page not found (owner) ─────────────────────────────────────────────
    {
      const { ctx, page, errors, failedApi } = await signIn('owner@unifiedtree.demo', { width: v.width, height, dark: v.dark })
      await page.goto(base + '/hrms/no-such-page?tab=x')
      await notFound(page).waitFor({ timeout: 30_000 }).catch(() => {})
      const shown = await notFound(page).isVisible().catch(() => false)
      check(`[${v.tag}] not found: an unknown address shows "Page not found"`, shown && (await page.getByRole('heading', { name: 'Page not found' }).count()) === 1)
      check(`[${v.tag}] not found: the address stays and is shown`, new URL(page.url()).pathname === '/hrms/no-such-page' && (await notFound(page).innerText()).includes('/hrms/no-such-page?tab=x'))
      check(`[${v.tag}] not found: no Back on a page opened directly`, (await notFound(page).getByRole('button', { name: 'Back' }).count()) === 0)
      await shot(page, `notfound-${v.tag}`)
      if (first) {
        await notFound(page).getByRole('button', { name: 'Go to Home' }).click()
        await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 20_000 }).catch(() => {})
        check('not found: Go to Home opens the owner’s Home (/dashboard)', new URL(page.url()).pathname === '/dashboard', page.url())
        // An in-app move to a bad address: Back returns.
        await page.evaluate(() => { window.history.pushState({ usr: null, key: 'w28', idx: 1 }, '', '/hrms/also-missing'); window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })) })
        await notFound(page).waitFor({ timeout: 10_000 }).catch(() => {})
        const back = notFound(page).getByRole('button', { name: 'Back' })
        check('not found: Back is offered after an in-app move', (await back.count()) === 1)
        if (await back.count()) { await back.click(); await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 10_000 }).catch(() => {}) }
        check('not found: Back returns to the page before', new URL(page.url()).pathname === '/dashboard', page.url())
        // Old addresses keep redirecting, not "Page not found".
        for (const [from, to] of [['/hrms/settings/shift-rules', '/hrms/master/shift-rules'], ['/hrms/settings/access', '/roles'], ['/payroll', '/hrms/payroll-dashboard'], ['/module-workspace', '/dashboard'], ['/settings/integrations/register', '/hrms/integrations']]) {
          await page.goto(base + from)
          await page.waitForURL((u) => u.pathname === to, { timeout: 20_000 }).catch(() => {})
          await page.waitForTimeout(500)
          check(`old address ${from} → ${to}`, new URL(page.url()).pathname === to && (await notFound(page).count()) === 0, page.url())
        }
        check('not found: no page errors', errors.length === 0, errors.join(' | '))
        check('not found: no failed API calls', failedApi.length === 0, failedApi.join(' | '))
      }
      await ctx.close()
    }

    // ── 2. the bell's Messages tab (reader) ───────────────────────────────────
    {
      const { ctx, page, errors, failedApi } = await signIn('reader@unifiedtree.demo', { width: v.width, height, dark: v.dark })
      await page.goto(base + '/me')
      await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^Notifications/ }).first().click()
      const pop = page.getByRole('dialog', { name: 'Notifications' })
      await pop.waitFor({ timeout: 15_000 })
      const tabs = pop.getByRole('tablist', { name: 'Alerts' })
      await tabs.waitFor({ timeout: 10_000 }).catch(() => {})
      const names = (await tabs.getByRole('tab').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim())
      check(`[${v.tag}] bell: Notifications and Messages tabs`, names.length === 2 && names[0].startsWith('Notifications') && names[1] === 'Messages', JSON.stringify(names))
      if (first) check('bell: opens on Notifications', (await tabs.getByRole('tab', { name: /^Notifications/ }).getAttribute('aria-selected')) === 'true')
      await tabs.getByRole('tab', { name: 'Messages' }).click()
      const list = pop.getByTestId('team-message-list')
      await list.waitFor({ timeout: 15_000 }).catch(() => {})
      const msgText = await list.innerText().catch(() => '')
      check(`[${v.tag}] bell: the manager's message shows under Messages`, msgText.includes(text) && /Manager|Mgr|Dept/i.test(msgText), msgText.slice(0, 200))
      check(`[${v.tag}] bell: the Messages footer`, (await pop.innerText()).includes('Messages from the last 30 days'))
      check(`[${v.tag}] bell: Messages is the chosen tab`, (await tabs.getByRole('tab', { name: 'Messages' }).getAttribute('aria-selected')) === 'true')
      if (first) check('bell: the heading reads Alerts over the two tabs', (await pop.locator('.ut-bellpop__heading').innerText()).trim() === 'Alerts')
      await page.waitForTimeout(400) // the tab's colour change (0.2s) settles before the picture
      await shot(page, `bell-messages-${v.tag}`)
      if (first) {
        await tabs.getByRole('tab', { name: /^Notifications/ }).click()
        await page.waitForTimeout(300)
        check('bell: back on Notifications, the list or the empty state', (await pop.getByTestId('notification-list').count()) + (await pop.getByText('You’re all caught up').count()) > 0)
        check('bell: no page errors', errors.length === 0, errors.join(' | '))
        check('bell: no failed API calls', failedApi.length === 0, failedApi.join(' | '))
      }
      await page.keyboard.press('Escape')

      // ── 3. the picker on Fix a day and Request overtime (reader) ──────────────
      const pickIn = async (fieldName, target, label) => {
        const field = page.getByRole('button', { name: fieldName })
        await field.waitFor({ timeout: 20_000 })
        await field.click()
        const dlg = page.getByRole('dialog', { name: 'Select day' })
        await dlg.waitFor({ timeout: 10_000 })
        const cell = dlg.locator(`[data-day="${target}"]`)
        if (!(await cell.count())) await dlg.getByRole('button', { name: 'Previous month' }).click()
        await cell.click()
        check(`[${v.tag}] ${label}: the clicked day is the chosen one`, (await cell.getAttribute('aria-pressed')) === 'true')
        await page.waitForTimeout(400) // the cells' colour change (0.12s) settles before the picture
        await shot(page, `${label}-picker-${v.tag}`)
        await dlg.getByRole('button', { name: 'Done' }).click()
        await dlg.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
        return (await field.getAttribute('aria-label')) || ''
      }
      await page.goto(base + '/hrms/attendance?tab=my')
      await page.getByRole('button', { name: 'Fix a day' }).first().click()
      const fixPanel = page.getByRole('dialog', { name: 'Fix a day' })
      await fixPanel.waitFor({ timeout: 15_000 })
      check(`[${v.tag}] fix a day: no browser date box`, (await fixPanel.locator('input[type=date]').count()) === 0)
      const fixDay = istDay(-3)
      const fixLabel = await pickIn(/^Which day:/, fixDay, 'fixday')
      check(`[${v.tag}] fix a day: the picked day shows in the form`, fixLabel.includes(ddmmyyyy(fixDay)), fixLabel)
      if (first) {
        await page.getByRole('button', { name: /^Which day:/ }).click()
        const dlg = page.getByRole('dialog', { name: 'Select day' })
        await dlg.waitFor({ timeout: 10_000 })
        check('fix a day: a future day can’t be picked', await dlg.locator(`[data-day="${istDay(1)}"]`).count() === 0 || await dlg.locator(`[data-day="${istDay(1)}"]`).isDisabled())
        await dlg.getByRole('button', { name: 'Close' }).click()
      }
      await fixPanel.getByRole('button', { name: 'Cancel' }).click()

      await page.goto(base + '/hrms/shifts')
      const ask = page.getByRole('button', { name: 'Request overtime' })
      await ask.waitFor({ timeout: 30_000 }).catch(() => {})
      if (await ask.count()) {
        await ask.first().click()
        const otPanel = page.getByRole('dialog', { name: 'Request overtime' })
        await otPanel.waitFor({ timeout: 15_000 })
        check(`[${v.tag}] overtime: no browser date box`, (await otPanel.locator('input[type=date]').count()) === 0)
        const otDay = istDay(-4)
        const otLabel = await pickIn(/^Day:/, otDay, 'overtime')
        check(`[${v.tag}] overtime: the picked day shows in the form`, otLabel.includes(ddmmyyyy(otDay)), otLabel)
        await otPanel.getByRole('button', { name: 'Cancel' }).click()
      } else check(`[${v.tag}] overtime: "Request overtime" is on the reader's Shifts page`, false)
      if (first) {
        check('pickers: no page errors', errors.length === 0, errors.join(' | '))
        check('pickers: no failed API calls', failedApi.length === 0, failedApi.join(' | '))
      }
      await ctx.close()
    }
  }

  // Signed out: an unknown address still goes to sign-in.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await page.goto(base + '/hrms/no-such-page', { timeout: 120_000 })
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {})
    check('signed out: an unknown address goes to sign-in', new URL(page.url()).pathname.startsWith('/login'), page.url())
    await ctx.close()
  }
} catch (e) {
  check('run finished without an exception', false, String(e?.stack || e).slice(0, 600))
} finally {
  await browser.close()
  try {
    if (messageId) {
      sql(`delete from notif.notifications where tenant_id=${lit(tenant)} and type='TEAM_MESSAGE' and data->>'messageId'=${lit(messageId)}`)
      sql(`delete from hrms.team_messages where tenant_id=${lit(tenant)} and id=${lit(messageId)}`)
    }
    if (historyRows.length) sql(`delete from attendance.day_status_reviews where id in (${historyRows.map(lit).join(',')})`)
    const left = Number(sql(`select count(*) from attendance.day_status_reviews where reason like ${lit(`w28 quick batch ${stamp}%`)}`))
      + (messageId ? Number(sql(`select count(*) from hrms.team_messages where id=${lit(messageId)}`)) : 0)
    check('cleanup: nothing left behind', left === 0, `${left} rows`)
  } catch (e) {
    check('cleanup', false, String(e).slice(0, 300))
  }
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
