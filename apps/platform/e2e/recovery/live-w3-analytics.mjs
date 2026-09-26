// Live check of Attendance Analytics' month picker (wave 3) and the Daily Logs
// date picker with a previous-year day.
//
//  1. /hrms/att-analytics opens on this month ("Today" on top); the Month field
//     can't pick a future month; ?month= with a future or bad value falls back.
//  2. Picking March of last year (year view → month): the URL keeps ?month=, and
//     every number follows that month — the tiles and the check-in methods match
//     SQL, the trend bars and tiles match GET /dashboard/trend, "Everyone's month"
//     matches SQL, the report link carries the month's from/to.
//  3. The Calendar tab (reached from a tile) shows that month; a day's box and the
//     side panel match the trend. Switching tabs keeps the month; "This month"
//     goes back to today.
//  4. Daily Logs: year → month → day picks a day of last year, and the list is
//     that day's people (matches SQL).
//  Screenshots at 1440 and 390 wide go to C:/REACT/ut-wt/_results/shots.
//
// Fixture: six check-ins on three weekdays of March last year for three people
// (reader, dept manager, finance lead), inserted with SQL and deleted at the end.
//   RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api),
//   RECOVERY_DB (default unifiedtree_recovery)
//   node e2e/recovery/live-w3-analytics.mjs
/* global process, console, fetch, URL, document */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222', MGR = '44444444-4444-4444-4444-444444444444', FIN = '55555555-5555-5555-5555-555555555555'
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Dates — today in IST, like the app.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const pad = (n) => String(n).padStart(2, '0')
const Y = Number(today.slice(0, 4)), M = Number(today.slice(5, 7)), py = Y - 1
const P = `${py}-03`, pFrom = `${P}-01`, pTo = `${P}-31`, pName = `March ${py}`
const thisName = `${MONTHS[M - 1]} ${Y}`
const dow = (iso) => new Date(iso + 'T00:00:00').getDay()
// The first Tuesday of March last year, and the Wednesday and Thursday after it.
let first = 1
while (dow(`${P}-${pad(first)}`) !== 2) first++
const [A, B, C] = [first, first + 1, first + 2].map((d) => `${P}-${pad(d)}`)

const made = []
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (path) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
    return res.json()
  }
}

const browser = await chromium.launch()
try {
  // ── fixture ──
  const seed = [
    [READER, A, '09:05', 'ON_TIME', 'FACE_RECOGNITION'], [MGR, A, '09:00', 'ON_TIME', 'GPS'], [FIN, A, '10:40', 'LATE', 'MANUAL'],
    [READER, B, '09:00', 'ON_TIME', 'FACE_RECOGNITION'], [MGR, B, '09:10', 'ON_TIME', 'GPS'],
    [READER, C, '11:00', 'LATE', 'FACE_RECOGNITION'],
  ]
  const clash = sql(`select count(*) from attendance.records where tenant_id='${tenant}' and attendance_date in ('${A}','${B}','${C}') and employee_id in ('${READER}','${MGR}','${FIN}')`)
  if (clash !== '0') throw new Error(`records already exist on ${A}..${C}; clean them first`)
  for (const [emp, d, t, status, method] of seed) {
    const id = randomUUID()
    sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, check_in_at, check_out_at, attendance_type, attendance_status, check_in_method, check_out_method, work_hours, manual_entry, is_regularized)
         values ('${id}', '${tenant}', '${emp}', '${company}', '${d}', '${d} ${t}:00+05:30', '${d} 18:30:00+05:30', 'OFFICE', '${status}', '${method}', '${method}', 8, false, false)`)
    made.push(id)
  }
  console.log(`fixture: ${made.length} check-ins on ${A}, ${B}, ${C}`)

  // ── what SQL says about the month (weekdays that aren't holidays) ──
  const workdayCheckins = `from attendance.records r where r.tenant_id='${tenant}' and r.attendance_date between '${pFrom}' and '${pTo}' and r.check_in_at is not null
      and extract(isodow from r.attendance_date) < 6 and r.attendance_date not in (select holiday_date from settings.holiday_calendar where tenant_id='${tenant}' and is_active)`
  const sqlCameIn = Number(sql(`select count(*) ${workdayCheckins}`))
  const sqlFace = Number(sql(`select count(*) from attendance.records where tenant_id='${tenant}' and attendance_date between '${pFrom}' and '${pTo}' and check_in_at is not null and check_in_method='FACE_RECOGNITION'`))
  const sqlAll = Number(sql(`select count(*) from attendance.records where tenant_id='${tenant}' and attendance_date between '${pFrom}' and '${pTo}' and check_in_at is not null and check_in_method is not null`))
  const sqlReader = Number(sql(`select count(*) ${workdayCheckins} and r.employee_id='${READER}'`))
  const sqlOnA = Number(sql(`select count(*) from attendance.records where tenant_id='${tenant}' and attendance_date='${A}' and check_in_at is not null`))
  console.log(`SQL ${P}: ${sqlCameIn} check-ins on working days (${sqlFace} by face, ${sqlAll} with a method), reader ${sqlReader}, ${sqlOnA} on ${A}`)

  // ── what the API says (the page's source) ──
  const get = await login('owner@unifiedtree.demo')
  const trend = await get(`/v1/attendance/dashboard/trend?from=${pFrom}&to=${pTo}`)
  const work = trend.filter((r) => !r.weeklyOffDay)
  const came = (r) => (typeof r.checkedIn === 'number' ? r.checkedIn : r.present + r.late + r.halfDay + r.workFromHome)
  const sum = (f) => work.reduce((n, r) => n + f(r), 0)
  const apiCameIn = sum(came), apiLate = sum((r) => r.late), apiAbsent = sum((r) => r.absent), apiLeave = sum((r) => Math.max(0, r.notMarked - r.absent))
  const dayA = trend.find((r) => r.date === A), dayB = trend.find((r) => r.date === B)
  const src = await get(`/v1/attendance/dashboard/sources?from=${pFrom}&to=${pTo}`)
  check('API: sources for a range count the whole month', src.date === pTo && src.sources.reduce((n, s) => n + s.count, 0) === sqlAll, `${JSON.stringify(src.sources.filter((s) => s.count))} · date ${src.date}`)
  const srcToday = await get(`/v1/attendance/dashboard/sources?date=${today}`)
  check('API: sources without a range still answer for one day', srcToday.date === today)
  check('API: the trend counts the fixture', apiCameIn === sqlCameIn, `trend ${apiCameIn} · SQL ${sqlCameIn}`)

  // ── browser ──
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = [], failed = [], calls = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(decodeURIComponent(r.url())) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1000)
  pageErrors.length = 0; failed.length = 0

  const monthField = page.getByRole('combobox', { name: 'Month' })
  const tileValue = async (label) => {
    const t = page.getByRole('group', { name: /in numbers|Today’s numbers/ }).getByRole('button').filter({ hasText: label }).first()
    const txt = (await t.innerText()).split('\n').map((s) => s.trim()).filter(Boolean)
    return Number(txt[1])
  }
  const url = () => new URL(page.url())

  // 1. This month by default
  await page.goto(base + '/hrms/att-analytics')
  await monthField.waitFor({ timeout: 30_000 })
  // Today's section appears once the live roster has loaded.
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor({ timeout: 20_000 }).catch(() => {})
  check('opens on this month', (await monthField.innerText()).includes(thisName) && (await page.getByRole('heading', { name: 'Today', exact: true }).count()) === 1, await monthField.innerText())
  await page.waitForLoadState('networkidle')
  const todayTiles = await page.getByRole('group', { name: 'Today’s numbers' }).innerText()
  check('this month still shows today’s tiles', todayTiles.includes('Not marked') && todayTiles.includes('of people expected'))
  await page.screenshot({ path: `${SHOTS}/analytics-1440-this-month.png` })
  await monthField.click()
  const dlg = page.getByRole('dialog', { name: 'Choose month' })
  await dlg.waitFor({ timeout: 5000 })
  if (M < 12) {
    const next = dlg.locator(`[role=gridcell][aria-label="${MONTHS[M]} ${Y}"]`)
    check('a future month can’t be picked', (await next.getAttribute('aria-disabled')) === 'true')
  }
  // 2. Year view → last year → March
  await dlg.getByRole('button', { name: 'Choose year' }).click()
  await dlg.locator(`[role=gridcell][aria-label="${py}"]`).click()
  calls.length = 0
  await dlg.locator(`[role=gridcell][aria-label="${pName}"]`).click()
  await page.waitForURL((u) => u.searchParams.get('month') === P, { timeout: 10_000 }).catch(() => {})
  check('picking a month puts it in the URL', url().searchParams.get('month') === P, page.url().replace(base, ''))
  await page.getByRole('heading', { name: 'Month in total' }).waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  check('the field shows the picked month', (await monthField.innerText()).includes(pName))
  check('trend asked for the whole month', calls.some((u) => u.includes(`/v1/attendance/dashboard/trend?from=${pFrom}&to=${pTo}`)))
  check('check-in methods asked for the whole month', calls.some((u) => u.includes(`/v1/attendance/dashboard/sources?from=${pFrom}&to=${pTo}`)))
  check('reports asked for the whole month', calls.some((u) => u.includes('/v1/reports/attendance-summary') && u.includes(`from=${pFrom}`) && u.includes(`to=${pTo}`))
    && calls.some((u) => u.includes('/v1/reports/late-marks') && u.includes(`from=${pFrom}`) && u.includes(`to=${pTo}`)))

  const cameIn = await tileValue('Came in')
  check('"Came in" = SQL check-ins that month', cameIn === sqlCameIn, `page ${cameIn} · SQL ${sqlCameIn}`)
  check('"Late" = the trend’s late days', (await tileValue('Late')) === apiLate, `page ${await tileValue('Late')} · API ${apiLate}`)
  check('"Absent" = the trend’s absent days', (await tileValue('Absent')) === apiAbsent, `page ${await tileValue('Absent')} · API ${apiAbsent}`)
  check('"On leave" = the trend’s leave days', (await tileValue('On leave')) === apiLeave, `page ${await tileValue('On leave')} · API ${apiLeave}`)
  const srcCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'How people checked in' }) })
  check('check-in methods follow the month (SQL)', (await srcCard.innerText()).includes(`${sqlAll} check-ins in March`), (await srcCard.innerText()).split('\n').slice(0, 3).join(' | '))
  const faceRow = srcCard.locator('li').filter({ hasText: 'Face check-in' })
  check('face check-ins = SQL', (await faceRow.count()) === 1 && (await faceRow.innerText()).includes(String(sqlFace)), await faceRow.innerText().catch(() => 'no row'))
  const bar = page.locator(`svg[role=img] g[data-tip^="${WD[dow(A)]} ${Number(A.slice(8))} Mar "]`)
  const lateA = dayA.late, expA = `${came(dayA) - lateA} on time · ${lateA} late · ${dayA.absent} absent`
  check(`trend bar for ${A} matches the API`, ((await bar.getAttribute('data-tip')) || '').includes(expA), `${await bar.getAttribute('data-tip')} · expected ${expA}`)
  check('"Everyone’s month" names the month', (await page.getByText(`Days present, late marks, hours and overtime for ${pName}`).count()) === 1)
  const readerRow = page.locator('tr').filter({ hasText: 'Reader User' })
  check('reader’s days present = SQL', ((await readerRow.innerText().catch(() => '')) || '').includes(`${sqlReader} of `), (await readerRow.innerText().catch(() => 'no row')).replace(/\s+/g, ' '))
  await page.screenshot({ path: `${SHOTS}/analytics-1440-past-month.png`, fullPage: true })
  // Labels are read only when drawn (a zero-size <text> is invisible).
  const drawn = (loc) => loc.evaluateAll((els) => els.filter((e) => e.getBBox().width > 0).map((e) => (e.textContent || '').trim()).filter(Boolean))
  const dayLabels = await drawn(page.locator('section[aria-labelledby=ov-month] svg[role=img] g text'))
  check('trend draws every day of the month, labelled', dayLabels.length === 31 && dayLabels[30] === '31', `${dayLabels.length} labels`)
  await page.locator('section[aria-labelledby=ov-month] svg[role=img]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/analytics-1440-past-month-trend.png` })

  // Download report → the report page for that month
  await page.getByRole('button', { name: /Download report/ }).click()
  await page.waitForURL((u) => u.pathname === '/hrms/reports/attendance-summary', { timeout: 10_000 }).catch(() => {})
  check('Download report opens the month’s report', url().searchParams.get('from') === pFrom && url().searchParams.get('to') === pTo, page.url().replace(base, ''))
  await page.goBack()
  await page.getByRole('heading', { name: 'Month in total' }).waitFor({ timeout: 20_000 })
  check('back keeps the month', url().searchParams.get('month') === P)

  // 3. A tile opens the month's calendar
  await page.getByRole('group', { name: /in numbers/ }).getByRole('button').filter({ hasText: 'Came in' }).click()
  await page.getByRole('heading', { name: pName }).waitFor({ timeout: 10_000 })
  check('a tile opens that month’s calendar, month kept', url().searchParams.get('tab') === 'calendar' && url().searchParams.get('month') === P, page.url().replace(base, ''))
  // A past day: came in ÷ (came in + absent), like the calendar.
  const rate = (r) => { const e = came(r) + r.absent; return e ? Math.round((came(r) / e) * 100) : 0 }
  const boxA = page.getByRole('button', { name: new RegExp(`^${Number(A.slice(8))} Mar: `) })
  check(`calendar box ${A} matches the trend`, ((await boxA.getAttribute('aria-label')) || '').includes(`${rate(dayA)}% came in`), `${await boxA.getAttribute('aria-label')} · expected ${rate(dayA)}%`)
  const boxText = await drawn(boxA.locator('svg text'))
  check(`calendar box ${A} shows its day and rate`, boxText[0] === String(Number(A.slice(8))) && boxText[1] === `${rate(dayA)}%`, JSON.stringify(boxText))
  const before = `${P}-${pad(first - 1)}`
  if (first > 1 && dow(before) !== 0 && dow(before) !== 6) {
    const boxBefore = page.getByRole('button', { name: new RegExp(`^${first - 1} Mar: `) })
    check('a day before any attendance shows “no data”, not 0%', (await boxBefore.getAttribute('aria-label')) === `${first - 1} Mar: no data`, await boxBefore.getAttribute('aria-label'))
  }
  await page.getByRole('button', { name: new RegExp(`^${Number(B.slice(8))} Mar: `) }).click()
  const side = page.locator('aside[aria-live=polite]')
  check(`side panel for ${B} matches the trend`, (await side.innerText()).includes(`of ${came(dayB) + dayB.absent} expected came in`) && (await side.innerText()).includes(String(came(dayB))), (await side.innerText()).split('\n').slice(0, 3).join(' | '))
  await page.screenshot({ path: `${SHOTS}/analytics-1440-past-calendar.png`, fullPage: true })
  await page.getByRole('tab', { name: 'Overview' }).click()
  await page.getByRole('heading', { name: 'Month in total' }).waitFor({ timeout: 10_000 })
  check('switching tabs keeps the month', url().searchParams.get('month') === P && url().searchParams.get('tab') === 'overview')

  // "This month" preset → back to today
  await monthField.click()
  await dlg.getByRole('button', { name: 'This month' }).click()
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor({ timeout: 10_000 })
  check('"This month" goes back to today and drops ?month=', !url().searchParams.get('month') && (await monthField.innerText()).includes(thisName))
  await page.goto(base + '/hrms/att-analytics?month=2999-01')
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor({ timeout: 20_000 })
  check('a future ?month= falls back to this month', (await monthField.innerText()).includes(thisName))

  // 4. Daily Logs: a day of last year
  await page.goto(base + '/hrms/attendance?tab=team')
  const dayField = page.getByRole('combobox', { name: 'Showing day' })
  await dayField.waitFor({ timeout: 20_000 })
  await dayField.click()
  const ddlg = page.getByRole('dialog', { name: 'Choose date' })
  await ddlg.getByRole('button', { name: 'Choose year' }).click()
  await ddlg.locator(`[role=gridcell][aria-label="${py}"]`).click()
  await ddlg.locator(`[role=gridcell][aria-label="${pName}"]`).click()
  const logsReq = page.waitForRequest((r) => r.url().includes('/v1/attendance/dashboard?') && r.url().includes(`date=${A}`), { timeout: 15_000 }).catch(() => null)
  await ddlg.locator(`[role=gridcell][aria-label^="${new Date(A + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}, ${Number(A.slice(8))} March ${py}"]`).click()
  check('Daily Logs asks for that day', !!(await logsReq))
  await page.waitForURL((u) => u.searchParams.get('date') === A, { timeout: 10_000 }).catch(() => {})
  check('Daily Logs URL has the day', url().searchParams.get('date') === A, page.url().replace(base, ''))
  await page.getByText(new RegExp(`· ${Number(A.slice(8))} Mar ${py}, IST`)).waitFor({ timeout: 15_000 })
  const logTile = page.getByRole('group', { name: 'Filter by status' }).getByRole('button').filter({ hasText: 'Came in' })
  const logCame = Number((await logTile.innerText()).split('\n').map((s) => s.trim()).filter(Boolean)[1])
  check('Daily Logs "Came in" = SQL for that day', logCame === sqlOnA, `page ${logCame} · SQL ${sqlOnA}`)
  check('Daily Logs lists the reader that day', (await page.getByText('Reader User').count()) > 0)
  await page.screenshot({ path: `${SHOTS}/analytics-1440-daily-logs-last-year.png`, fullPage: true })

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))

  // Phone width
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/hrms/att-analytics?month=${P}`)
  await page.getByRole('heading', { name: 'Month in total' }).waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no sideways scroll', wide <= 392, String(wide))
  check('390px: the month field is on screen', !!(await monthField.boundingBox()) && (await monthField.boundingBox()).x + (await monthField.boundingBox()).width <= 390)
  await page.screenshot({ path: `${SHOTS}/analytics-390-past-month.png`, fullPage: true })
  await monthField.click()
  await dlg.waitFor({ timeout: 5000 })
  await page.waitForTimeout(350)
  const sheet = await dlg.boundingBox()
  check('390px: the month picker stays inside the screen', !!sheet && sheet.x >= 0 && sheet.x + sheet.width <= 390.5 && sheet.y + sheet.height <= 844.5, JSON.stringify(sheet))
  await page.screenshot({ path: `${SHOTS}/analytics-390-month-picker.png` })
  await page.keyboard.press('Escape')
  await page.goto(`${base}/hrms/att-analytics?tab=calendar&month=${P}`)
  await page.getByRole('heading', { name: pName }).waitFor({ timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/analytics-390-past-calendar.png`, fullPage: true })
  check('390px: no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  if (made.length) {
    sql(`delete from attendance.records where id in (${made.map((i) => `'${i}'`).join(',')})`)
    const left = sql(`select count(*) from attendance.records where id in (${made.map((i) => `'${i}'`).join(',')})`)
    console.log(`cleanup: fixture removed (${left} left)`)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
