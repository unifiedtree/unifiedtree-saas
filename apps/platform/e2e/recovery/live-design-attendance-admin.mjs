// Live check of the redesigned Muster roll and Manual entry pages:
//  - Muster roll: today says "Not marked yet" (not "Absent"), a past day says
//    "Absent"; ?date= opens that day; the CSV export downloads and is recorded
//    for the Reports Center; the row shortcut opens Manual entry.
//  - Manual entry: saves a punch for the employee on a past day with no record
//    and lands back on the muster roll for that same day.
//  - Geofencing (retired 25 Sep): the old page now opens Companies & Branches,
//    where punch zones live on each branch.
//  - Department manager: muster roll opens with no refused calls.
// The manual punch is removed at the end.
//
//   node e2e/recovery/live-design-attendance-admin.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const readerId = '22222222-2222-2222-2222-222222222222'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// The muster roll's "Date" is the shared calendar: its label is on a trigger button,
// and the 'yyyy-MM-dd' value sits on the hidden input beside it.
const dateValue = (page) => page.locator('.utc-field', { has: page.getByLabel('Date') }).locator('.utc-native').inputValue()
const browser = await chromium.launch()
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
// A past weekday 20–60 days back with no attendance record for the employee.
let day = ''
for (let back = 20; back < 60 && !day; back++) {
  const d = new Date(Date.now() - back * 864e5)
  if (d.getDay() === 0 || d.getDay() === 6) continue
  const iso = localIso(d)
  if (sql(`select count(*) from attendance.records where employee_id='${readerId}' and attendance_date='${iso}'`) === '0') day = iso
}
try {
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/muster-roll'); await settle(o.page)
  check('muster: today has a "Not marked yet" tile, not "Absent"', (await o.page.getByText('Not marked yet', { exact: true }).count()) > 0 && (await o.page.getByText('Absent', { exact: true }).count()) === 0)
  check('muster: the day’s split donut', (await o.page.getByText('How the day splits', { exact: true }).count()) === 1)
  const downloading = o.page.waitForEvent('download')
  await o.page.getByRole('button', { name: /Export CSV/ }).click()
  const dl = await downloading
  check('muster: CSV downloads', /^muster-roll-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && !(await dl.failure()), dl.suggestedFilename())
  const recorded = await o.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ut.recentDownloads') || '[]')[0]?.report } catch { return null } })
  check('muster: export is recorded for the Reports Center', recorded === 'Muster roll', String(recorded))
  const yesterday = localIso(new Date(Date.now() - 864e5))
  await o.page.goto(base + `/hrms/muster-roll?date=${yesterday}`); await settle(o.page)
  check('muster: ?date= opens that day', (await dateValue(o.page)) === yesterday)
  check('muster: a past day says "Absent"', (await o.page.getByText('Absent', { exact: true }).count()) > 0)
  check('owner: no refused calls on the muster roll', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')

  if (!day) check('manual entry: found a free past day for the employee', false)
  else {
    await o.page.goto(base + `/hrms/attendance/manual-entry?employeeId=${readerId}&date=${day}`); await settle(o.page)
    check('manual entry: the employee is pre-selected', (await o.page.getByLabel('Employee', { exact: true }).inputValue()) === readerId)
    await o.page.getByLabel('Reason').fill('Local QA: biometric downtime')
    await o.page.getByRole('button', { name: 'Save entry' }).click()
    await o.page.waitForURL(/\/hrms\/muster-roll\?date=/, { timeout: 15000 }).catch(() => {})
    check('manual entry: back on the muster roll for that day', o.page.url().includes(`date=${day}`) && (await dateValue(o.page)) === day, o.page.url().replace(base, ''))
    const rec = sql(`select manual_entry||' '||to_char(check_in_at at time zone 'Asia/Kolkata','HH24:MI') from attendance.records where employee_id='${readerId}' and attendance_date='${day}'`)
    check('manual entry: saved as a manual record at 09:00 local time', rec === 'true 09:00', rec)
  }

  await o.page.goto(base + '/hrms/attendance/geofencing'); await settle(o.page)
  check('geofencing: the retired page opens Companies & Branches', new URL(o.page.url()).pathname === '/hrms/companies', o.page.url())
  check('geofencing: no longer in the menu', (await o.page.getByRole('link', { name: 'Geofencing' }).count()) + (await o.page.getByRole('button', { name: 'Geofencing', exact: true }).count()) === 0)
  check('owner: no refused calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()

  const m = await session('mgr@unifiedtree.demo')
  await m.page.goto(base + '/hrms/muster-roll'); await settle(m.page)
  check('manager: muster roll opens', (await m.page.getByText('On the roster', { exact: true }).count()) === 1)
  check('manager: no refused calls or page errors', !m.failed.length && !m.errors.length, m.failed[0] || m.errors[0] || '')
  await m.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  try {
    if (day) {
      sql(`delete from attendance.event_logs where employee_id='${readerId}' and event_date='${day}' and event_type='MANUAL_ENTRY'`)
      sql(`delete from attendance.records where employee_id='${readerId}' and attendance_date='${day}' and manual_entry`)
    }
  } catch { /* the audit table may not reference zones this way */ }
  const leftPunch = day ? sql(`select count(*) from attendance.records where employee_id='${readerId}' and attendance_date='${day}'`) : '0'
  check('cleanup: QA punch removed', leftPunch === '0', `punch=${leftPunch}`)
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
