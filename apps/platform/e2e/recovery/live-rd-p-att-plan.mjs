// P-ATT-PLAN UI — Attendance analytics and Shifts & overtime in the browser, against the real local API.
//   1. Every role (owner, hrm, fin, mgr, reader) opens /hrms/att-analytics and /hrms/shifts and sees what their
//      permissions open: the analytics and the four Shifts tabs with attendance.team.read; My Shift otherwise.
//   2. Overtime (DECISIONS 22): with the 1-hour default minimum, 1 h 20 m counts fully and 45 minutes isn't listed;
//      owner changes the minimum to 30 minutes (45 minutes shows up), then restores the default.
//   3. reader asks for 1 h 20 m of overtime from My Shift; mgr approves it on the Overtime tab.
//   4. Light and dark at 1440 and 390 (no sideways scroll), screenshots to C:/REACT/ut-wt/_results/shots/rd-p-att-plan-*.
//   5. No page errors and no unexpected 4xx/5xx; removes everything it made.
// Run from apps/platform:
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3125 RECOVERY_API_URL=http://127.0.0.1:8080/api node e2e/recovery/live-rd-p-att-plan.mjs
/* global process, console, fetch, Buffer, document, localStorage */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3125'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`) }

async function perms(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const t = (await r.json()).accessToken
  const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())
  return { set: new Set(c.permissions || []), employeeId: c.employee_id }
}

const today = istToday()
const testStart = sql('select now()')
const cleanup = []
const rulesBefore = sql(`select coalesce(minimum_minutes::text,'null')||'|'||coalesce(monthly_cap_minutes::text,'null') from attendance.overtime_rules where tenant_id='${tenant}' and company_id='${company}'`)
cleanup.push(() => rulesBefore
  ? sql(`update attendance.overtime_rules set minimum_minutes=${rulesBefore.split('|')[0]}, monthly_cap_minutes=${rulesBefore.split('|')[1]} where tenant_id='${tenant}' and company_id='${company}'`)
  : sql(`delete from attendance.overtime_rules where tenant_id='${tenant}' and company_id='${company}'`))
cleanup.push(() => sql(`delete from audit.events where action='OVERTIME_RULES_UPDATED' and occurred_at >= '${testStart}'`))
cleanup.push(() => sql(`delete from notif.notifications where created_at >= '${testStart}' and (type in ('OVERTIME_REQUESTED','OVERTIME_APPROVED','OVERTIME_REJECTED'))`))
cleanup.push(() => sql(`delete from attendance.overtime_requests where created_at >= '${testStart}'`))

const browser = await chromium.launch()
try {
  // ── fixture: fin@ worked 45 and 80 minutes over on two recent days ──
  const fin = (await perms('fin@unifiedtree.demo')).employeeId
  const d0 = Number(today.slice(8)) >= 4 ? `${today.slice(0, 8)}02` : `${plus(`${today.slice(0, 8)}01`, -1).slice(0, 8)}10`, d1 = plus(d0, 1)
  const small = sql(`insert into attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) values (gen_random_uuid(),'${tenant}','${fin}','${company}','${d0}','${d0}T03:30:00Z','${d0}T12:45:00Z',45,'QA P-ATT-PLAN UI fixture') returning id`).split('\n')[0]
  const big = sql(`insert into attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) values (gen_random_uuid(),'${tenant}','${fin}','${company}','${d1}','${d1}T03:30:00Z','${d1}T13:20:00Z',80,'QA P-ATT-PLAN UI fixture') returning id`).split('\n')[0]
  cleanup.push(() => sql(`delete from attendance.overtime_decisions where record_id in ('${small}','${big}'); delete from attendance.records where id in ('${small}','${big}')`))
  if (rulesBefore) sql(`delete from attendance.overtime_rules where tenant_id='${tenant}' and company_id='${company}'`)

  async function session(email, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 1000 } })
    await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private */ } }, opts.theme || 'light')
    const page = await ctx.newPage()
    const errors = [], failed = []
    page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]))
    page.on('response', (r) => {
      if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
      failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`)
    })
    await page.goto(base + '/login')
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    errors.length = 0; failed.length = 0
    return { ctx, page, errors, failed }
  }
  const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
  const tabNames = async (page, label) => (await page.getByRole('tablist', { name: label }).getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim())

  // ── 1. every role ──
  for (const [name, email] of [['owner', 'owner@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'], ['fin', 'fin@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo']]) {
    const p = await perms(email)
    const team = p.set.has('attendance.team.read'), self = p.set.has('attendance.checkin.self')
    const { ctx, page, errors, failed } = await session(email)
    await page.goto(base + '/hrms/att-analytics')
    await settle(page)
    const routeOk = team || p.set.has('hrms.report.attendance')
    if (team) {
      await page.getByRole('heading', { name: 'Attendance analytics' }).waitFor({ timeout: 20_000 })
      check(`${name}: analytics has Overview · Punctuality · Calendar`, (await tabNames(page, 'Analytics views')).join('|') === 'Overview|Punctuality|Calendar')
      check(`${name}: the month's figures render`, await page.getByText('Attendance rate', { exact: true }).isVisible() && await page.getByText('Avg arrival', { exact: true }).isVisible())
      check(`${name}: department and branch bars`, (await page.getByRole('heading', { name: 'Attendance by department' }).count()) === 1 && (await page.getByRole('heading', { name: 'Attendance by branch' }).count()) === 1)
      await page.getByRole('tab', { name: 'Punctuality' }).click()
      await page.getByRole('heading', { name: /late marks/i }).waitFor({ timeout: 10_000 })
      check(`${name}: punctuality renders from the team-scoped endpoint`, page.url().includes('tab=punctuality'))
    } else {
      check(`${name}: analytics not offered without team access`, !routeOk || (await page.getByText('Analytics needs team attendance access').count()) === 1 || !page.url().includes('att-analytics'), page.url().replace(base, ''))
    }
    await page.goto(base + '/hrms/shifts')
    await settle(page)
    if (team) {
      await page.getByRole('heading', { name: 'Shifts & overtime' }).waitFor({ timeout: 20_000 })
      check(`${name}: Shifts has today's four tabs`, (await tabNames(page, 'Shifts & overtime views')).join('|') === 'Shift Schedules|Roster|Overtime|Shift Requests')
      const people = await page.getByRole('columnheader', { name: 'People' }).count()
      check(`${name}: the shift list shows people per shift`, people === 1)
      check(`${name}: Add shift only with attendance.workforce.admin`, ((await page.getByRole('button', { name: 'Add shift' }).count()) > 0) === p.set.has('attendance.workforce.admin'))
    } else if (self) {
      await page.getByRole('heading', { name: 'My Shift' }).waitFor({ timeout: 20_000 })
      check(`${name}: My Shift with the shift cards and Past changes`, (await page.getByRole('group', { name: 'Shifts' }).count()) === 1 && (await page.getByRole('heading', { name: 'Past changes' }).count()) === 1)
      check(`${name}: Request overtime offered`, (await page.getByRole('button', { name: 'Request overtime' }).count()) === 1)
    }
    check(`${name}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
    check(`${name}: no failed API calls`, failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── 2. owner: the minimum, changed and restored ──
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/hrms/shifts?tab=overtime')
    await page.getByRole('heading', { name: 'Overtime rules' }).waitFor({ timeout: 20_000 })
    await settle(page)
    const card = page.locator('section, article').filter({ has: page.getByRole('heading', { name: 'Overtime rules' }) }).last()
    check('rules card: 1-hour default minimum', (await card.innerText()).includes('1h (default)'), (await card.innerText()).replace(/\s+/g, ' ').slice(0, 160))
    const finCards = page.getByRole('article', { name: 'Finance Lead' })
    const texts = await finCards.allInnerTexts()
    check('1 h 20 m counts fully (+1h 20m waiting)', texts.some((t) => t.includes('+1h 20m')), texts.map((t) => t.split('\n')[1]).join(' / '))
    check('45 minutes isn’t overtime under the 1-hour minimum', !texts.some((t) => t.includes('+45m')))
    await page.screenshot({ path: `${SHOTS}/rd-p-att-plan-overtime-1440-light.png`, fullPage: true })
    await page.getByRole('button', { name: 'Edit rules' }).click()
    const panel = page.getByRole('dialog', { name: 'Overtime rules' })
    await panel.waitFor()
    await panel.getByText(/Use the default minimum/).click()
    await panel.getByLabel('Minimum: hours').fill('0')
    await panel.getByLabel('Minimum: minutes').fill('30')
    await panel.getByRole('button', { name: 'Save rules' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 10_000 })
    await page.waitForTimeout(800)
    check('rules changed: the card shows 30m', (await card.innerText()).includes('30m') && !(await card.innerText()).includes('(default)'))
    check('stored for the company', sql(`select minimum_minutes from attendance.overtime_rules where company_id='${company}'`) === '30')
    await page.waitForTimeout(800)
    check('with a 30-minute minimum 45 minutes is waiting too', (await finCards.allInnerTexts()).some((t) => t.includes('+45m')))
    await page.getByRole('button', { name: 'Edit rules' }).click()
    await panel.waitFor()
    await panel.getByText(/Use the default minimum/).click()
    await panel.getByRole('button', { name: 'Save rules' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 10_000 })
    await page.waitForTimeout(800)
    check('rules restored to the default', (await card.innerText()).includes('1h (default)') && sql(`select coalesce(minimum_minutes::text,'null') from attendance.overtime_rules where company_id='${company}'`) === 'null')
    check('owner overtime: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('owner overtime: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── 3. reader asks, mgr approves ──
  {
    const { ctx, page, errors, failed } = await session('reader@unifiedtree.demo')
    await page.goto(base + '/hrms/shifts')
    await page.getByRole('button', { name: 'Request overtime' }).click()
    const panel = page.getByRole('dialog', { name: 'Request overtime' })
    await panel.waitFor()
    await panel.getByLabel('Hours').fill('0')
    await panel.getByLabel('Minutes').fill('45')
    await panel.getByLabel('Reason').fill('QA live — month-end closing')
    await panel.getByRole('button', { name: 'Send request' }).click()
    const refused = await page.getByText(/Overtime starts at 1h/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
    check('45 minutes is refused: overtime starts at the 1-hour minimum', refused && (await panel.isVisible()))
    // That refusal is the expected 422; anything else still fails the run.
    for (let i = failed.length - 1; i >= 0; i--) if (failed[i] === '422 POST /v1/attendance/overtime/requests') failed.splice(i, 1)
    await panel.getByLabel('Hours').fill('1')
    await panel.getByLabel('Minutes').fill('20')
    await panel.getByRole('button', { name: 'Send request' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 10_000 })
    await page.getByText(`1h 20m on`).first().waitFor({ timeout: 10_000 })
    check('reader’s request is listed as waiting', (await page.locator('.apl-past li').filter({ hasText: '1h 20m on' }).first().innerText()).includes('Waiting'))
    check('reader: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('reader: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await page.screenshot({ path: `${SHOTS}/rd-p-att-plan-myshift-1440-light.png`, fullPage: true })
    await ctx.close()
  }
  {
    const { ctx, page, errors, failed } = await session('mgr@unifiedtree.demo')
    await page.goto(base + '/hrms/shifts?tab=overtime')
    const row = page.getByRole('article', { name: 'Reader User' }).filter({ hasText: 'Asked for' }).first()
    await row.waitFor({ timeout: 20_000 })
    check('mgr sees the reader’s request (+1h 20m)', (await row.innerText()).includes('+1h 20m'))
    await row.getByRole('button', { name: 'Approve' }).click()
    await page.getByText('Overtime approved').first().waitFor({ timeout: 10_000 })
    const status = sql(`select status from attendance.overtime_requests where created_at >= '${testStart}' and minutes=80`)
    check('approved and stored', status === 'APPROVED', status)
    check('mgr: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('mgr: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── 4. light and dark, 1440 and 390 ──
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const { ctx, page, errors } = await session('owner@unifiedtree.demo', { theme, width, height: width === 390 ? 844 : 1000 })
      for (const [key, path, heading] of [['analytics', '/hrms/att-analytics', 'Attendance analytics'], ['calendar', '/hrms/att-analytics?tab=calendar', 'Attendance analytics'], ['shifts', '/hrms/shifts?tab=schedules', 'Shifts & overtime'], ['overtime', '/hrms/shifts?tab=overtime', 'Shifts & overtime'], ['requests', '/hrms/shifts?tab=requests', 'Shifts & overtime']]) {
        await page.goto(base + path)
        await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 })
        await settle(page)
        const wide = await page.evaluate(() => document.documentElement.scrollWidth)
        if (width === 390) check(`${theme} 390 ${key}: no sideways scroll`, wide <= 392, String(wide))
        if (theme === 'dark') check(`dark ${width} ${key}: the theme is dark`, (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
        await page.screenshot({ path: `${SHOTS}/rd-p-att-plan-${key}-${width}-${theme}.png`, fullPage: true })
      }
      check(`${theme} ${width}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }
  }
} catch (e) {
  check('script completed', false, String(e.message || e).split('\n').slice(0, 3).join(' | '))
} finally {
  await browser.close()
  for (const fn of cleanup.reverse()) { try { fn() } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) } }
  const left = sql(`select (select count(*) from attendance.records where remarks='QA P-ATT-PLAN UI fixture') + (select count(*) from attendance.overtime_requests where created_at >= '${testStart}')`)
  check('cleanup: nothing the test made is left', left === '0', `${left} left`)
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
