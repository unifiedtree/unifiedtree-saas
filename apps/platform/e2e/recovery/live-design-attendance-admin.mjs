// Live check of the redesigned Muster roll, Manual entry and Geofencing pages:
//  - Muster roll: today says "Not marked yet" (not "Absent"), a past day says
//    "Absent"; ?date= opens that day; the CSV export downloads and is recorded
//    for the Reports Center; the row shortcut opens Manual entry.
//  - Manual entry: saves a punch for the employee on a past day with no record
//    and lands back on the muster roll for that same day.
//  - Geofencing: add a zone (map shown), edit it, remove it.
//  - Department manager: muster roll opens with no refused calls.
// The manual punch and the QA zone are removed at the end.
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
const zoneName = `QA zone ${Date.now()}`
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
  check('muster: ?date= opens that day', (await o.page.getByLabel('Date').inputValue()) === yesterday)
  check('muster: a past day says "Absent"', (await o.page.getByText('Absent', { exact: true }).count()) > 0)
  check('owner: no refused calls on the muster roll', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')

  if (!day) check('manual entry: found a free past day for the employee', false)
  else {
    await o.page.goto(base + `/hrms/attendance/manual-entry?employeeId=${readerId}&date=${day}`); await settle(o.page)
    check('manual entry: the employee is pre-selected', (await o.page.getByLabel('Employee', { exact: true }).inputValue()) === readerId)
    await o.page.getByLabel('Reason').fill('Local QA: biometric downtime')
    await o.page.getByRole('button', { name: 'Save entry' }).click()
    await o.page.waitForURL(/\/hrms\/muster-roll\?date=/, { timeout: 15000 }).catch(() => {})
    check('manual entry: back on the muster roll for that day', o.page.url().includes(`date=${day}`) && (await o.page.getByLabel('Date').inputValue()) === day, o.page.url().replace(base, ''))
    const rec = sql(`select manual_entry||' '||to_char(check_in_at at time zone 'Asia/Kolkata','HH24:MI') from attendance.records where employee_id='${readerId}' and attendance_date='${day}'`)
    check('manual entry: saved as a manual record at 09:00 local time', rec === 'true 09:00', rec)
  }

  await o.page.goto(base + '/hrms/attendance/geofencing'); await settle(o.page)
  await o.page.getByRole('button', { name: /Add zone/ }).first().click()
  const dlg = o.page.getByRole('dialog')
  await dlg.getByLabel('Zone name').fill(zoneName)
  await dlg.getByLabel('Latitude').fill('17.385044')
  await dlg.getByLabel('Longitude').fill('78.486671')
  check('geofence: the map is shown in the drawer', (await dlg.locator('.leaflet-container').count()) === 1)
  await dlg.getByRole('button', { name: 'Add zone' }).click()
  const card = o.page.locator('article').filter({ hasText: zoneName })
  await card.waitFor({ timeout: 15000 })
  check('geofence: the new zone appears', (await card.count()) === 1)
  await card.getByRole('button', { name: 'Edit' }).click()
  await o.page.getByRole('dialog').getByLabel('Radius (metres)').fill('150')
  await o.page.getByRole('dialog').getByRole('button', { name: 'Save zone' }).click()
  await o.page.getByText('Zone saved', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  await settle(o.page)
  check('geofence: an edit is saved', (await o.page.locator('article').filter({ hasText: zoneName }).getByText('150 m', { exact: true }).count()) === 1)
  o.page.once('dialog', (d) => d.accept())
  await o.page.locator('article').filter({ hasText: zoneName }).getByRole('button', { name: 'Remove' }).click()
  await o.page.getByText('Zone removed', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  await settle(o.page)
  check('geofence: a removed zone leaves the list', (await o.page.locator('article').filter({ hasText: zoneName }).count()) === 0)
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
  try { sql(`delete from public.geo_fence_zones where name like 'QA zone %'`) } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
  const leftPunch = day ? sql(`select count(*) from attendance.records where employee_id='${readerId}' and attendance_date='${day}'`) : '0'
  const leftZone = sql(`select count(*) from public.geo_fence_zones where name like 'QA zone %'`)
  check('cleanup: QA punch and zone removed', leftPunch === '0' && leftZone === '0', `punch=${leftPunch} zone=${leftZone}`)
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
