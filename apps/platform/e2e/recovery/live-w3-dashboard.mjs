// Live check (wave 3): the Company Admin Dashboard follows the selected date end
// to end. A past day (here in the previous year) asks every card for that day,
// the numbers match that day's reality in the database, seats say "As of today",
// the headcount export carries the date, and today's view is unchanged. A past
// working day with punches, and one in the previous year, match the attendance
// records; the reports, the projects drawer and the Attendance page follow suit.
//
// Creates nothing: the export's log entry is answered locally (route) so no row
// is written. Reads the database (read-only) to check the numbers.
//
//   node e2e/recovery/live-w3-dashboard.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const apiBase = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const shots = process.env.RECOVERY_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const PAST = '2025-03-14', PAST_LABEL = '14 Mar 2025'
const MID = '2026-06-30' // a day when people who have left since were still employed
const WORKDAY = '2026-09-22', WORKDAY_LABEL = '22 Sep 2026' // a past working day with punches (and leavers' last day)
const YEAR_AGO = '2025-03-12' // a working day in the previous year

const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const TODAY = istToday()

/** Active employees and headcount on a day, by the headcount report's rules (status history). */
const activeOn = (day) => sql(`
  WITH status_on AS (
    SELECT DISTINCT ON (h.employee_id) h.employee_id, h.status FROM hrms.employee_status_history h
     WHERE h.tenant_id = '${tenant}' AND h.effective_on <= DATE '${day}' ORDER BY h.employee_id, h.effective_on DESC, h.recorded_at DESC),
  leaving_on AS (
    SELECT DISTINCT h.employee_id FROM hrms.employee_status_history h
     WHERE h.tenant_id = '${tenant}' AND h.status IN ('EXITED','TERMINATED','RESIGNED') AND h.effective_on > DATE '${day}'
       AND (h.recorded_at AT TIME ZONE 'Asia/Kolkata')::date <= DATE '${day}')
  SELECT count(*) FILTER (WHERE l.employee_id IS NULL AND COALESCE(s.status, e.employment_status) = 'ACTIVE') || '|' || count(*)
    FROM hrms.employees e LEFT JOIN status_on s ON s.employee_id = e.id LEFT JOIN leaving_on l ON l.employee_id = e.id
   WHERE e.tenant_id = '${tenant}' AND e.company_id = '${company}' AND e.date_of_joining <= DATE '${day}'
     AND NOT (e.employment_status IN ('EXITED','TERMINATED','RESIGNED') AND COALESCE(e.last_working_day, e.date_of_termination, DATE '1900-01-01') <= DATE '${day}')`).split('|').map(Number)

async function token(email) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
  const r = await fetch(`${apiBase}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const get = async (headers, path) => {
  const r = await fetch(apiBase + path, { headers })
  return { status: r.status, body: r.ok ? await r.json() : await r.text() }
}

mkdirSync(shots, { recursive: true })
/** The app scrolls inside its layout, so a full-page shot is one screen: take one shot per screen of the scroller. */
async function screens(page, name) {
  const scroller = await page.evaluateHandle(() => [...document.querySelectorAll('*')]
    .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 40)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement)
  const { h, ch } = await scroller.evaluate((el) => ({ h: el.scrollHeight, ch: el.clientHeight }))
  for (let i = 0, y = 0; y < h && i < 8; i++, y += ch - 60) {
    await scroller.evaluate((el, top) => el.scrollTo(0, top), y)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${shots}/${name}-${i + 1}.png` })
  }
  await scroller.evaluate((el) => el.scrollTo(0, 0))
}
const browser = await chromium.launch()
try {
  // ── API: backward compatible, and the past matches the database ─────────────
  const owner = await token('owner@unifiedtree.demo')
  const statsNow = await get(owner, `/v1/admin/dashboard/stats?companyId=${company}`)
  const statsToday = await get(owner, `/v1/admin/dashboard/stats?companyId=${company}&date=${TODAY}`)
  const statsFuture = await get(owner, `/v1/admin/dashboard/stats?companyId=${company}&date=2031-01-01`)
  check('stats without a date still answer (today\'s view)', statsNow.status === 200, JSON.stringify(statsNow.body).slice(0, 160))
  check('stats for today are the same as without a date', JSON.stringify(statsToday.body) === JSON.stringify(statsNow.body))
  check('a date after today is treated as today', JSON.stringify(statsFuture.body) === JSON.stringify(statsNow.body))
  const todayActive = Number(sql(`SELECT count(*) FROM hrms.employees WHERE tenant_id='${tenant}' AND company_id='${company}' AND employment_status='ACTIVE'`))
  check('today: active employees = the database (status ACTIVE)', statsNow.body.activeEmployees === todayActive, `api ${statsNow.body.activeEmployees}, sql ${todayActive}`)

  const statsPast = await get(owner, `/v1/admin/dashboard/stats?companyId=${company}&date=${PAST}`)
  const [pastActive, pastTotal] = activeOn(PAST)
  check(`${PAST}: active employees = the database on that day`, statsPast.body.activeEmployees === pastActive, `api ${statsPast.body.activeEmployees}, sql ${pastActive}`)
  check(`${PAST}: headcount = the database on that day`, statsPast.body.headcount === pastTotal, `api ${statsPast.body.headcount}, sql ${pastTotal}`)
  check(`${PAST}: the number differs from today (history, not today's copy)`, statsPast.body.activeEmployees !== statsNow.body.activeEmployees, `${statsPast.body.activeEmployees} vs ${statsNow.body.activeEmployees}`)
  check(`${PAST}: the payroll month is that month`, statsPast.body.month === PAST.slice(0, 7) && statsPast.body.asOf === PAST, `${statsPast.body.month} / ${statsPast.body.asOf}`)
  const pastRun = sql(`SELECT count(*) FROM payroll.runs WHERE tenant_id='${tenant}' AND company_id='${company}' AND period_year=2025 AND period_month=3 AND status IN ('LOCKED','PAID')`)
  check(`${PAST}: finalized payroll matches that month's runs`, (pastRun === '0') === (statsPast.body.monthlyPayroll == null), `runs ${pastRun}, payroll ${statsPast.body.monthlyPayroll}`)
  const report = await get(owner, `/v1/reports/headcount?companyId=${company}&asOf=${PAST}`)
  const reportActive = (report.body || []).reduce((n, r) => n + Number(r.active || 0), 0)
  check(`${PAST}: the tile agrees with the department chart (headcount report)`, reportActive === statsPast.body.activeEmployees, `report ${reportActive}`)

  const noticesPast = await get(owner, `/v1/admin/dashboard/notices?companyId=${company}&page=0&date=${PAST}`)
  const noticesSql = Number(sql(`SELECT count(*) FROM hrms.company_notices WHERE tenant_id='${tenant}' AND company_id='${company}' AND created_at < (DATE '${PAST}' + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AND (expires_on IS NULL OR expires_on >= DATE '${PAST}') AND (NOT archived OR updated_at >= (DATE '${PAST}' + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`))
  check(`${PAST}: notices = those up that day in the database`, noticesPast.status === 200 && noticesPast.body.totalElements === noticesSql, `api ${noticesPast.body?.totalElements}, sql ${noticesSql}`)
  const noticesNow = await get(owner, `/v1/admin/dashboard/notices?companyId=${company}&page=0`)
  check('notices without a date still answer', noticesNow.status === 200)

  // The team as it was: people who have left since still count on the days they worked.
  const teamNow = await get(owner, `/v1/attendance/dashboard?date=${MID}`)
  const teamThen = await get(owner, `/v1/attendance/dashboard?date=${MID}&includeLeavers=true`)
  const leaversThen = Number(sql(`SELECT count(*) FROM hrms.employees WHERE tenant_id='${tenant}' AND company_id='${company}'
      AND employment_status IN ('EXITED','TERMINATED','RESIGNED','RETIRED') AND COALESCE(last_working_day, date_of_termination) >= DATE '${MID}'
      AND COALESCE(date_of_joining, (created_at AT TIME ZONE 'Asia/Kolkata')::date) <= DATE '${MID}'
      AND NOT (',' || COALESCE(weekly_off_days, '6,7') || ',') LIKE '%,' || extract(isodow FROM DATE '${MID}')::int || ',%'`))
  check(`${MID}: the day's roster adds the people who have left since`, teamThen.status === 200 && teamThen.body.staffStatuses.length - teamNow.body.staffStatuses.length === leaversThen,
    `today's team ${teamNow.body.staffStatuses?.length}, as it was ${teamThen.body.staffStatuses?.length}, leavers ${leaversThen}`)
  const trendThen = await get(owner, `/v1/attendance/dashboard/trend?from=2026-06-01&to=${MID}&includeLeavers=true`)
  check('the trend takes the team as it was', trendThen.status === 200 && trendThen.body.length === 30)
  for (const path of [`/v1/admin/dashboard/alerts?date=${PAST}`, `/v1/admin/dashboard/performers?companyId=${company}&date=${PAST}`, `/v1/admin/dashboard/onboarding?companyId=${company}&date=${PAST}`,
    `/v1/admin/dashboard/hiring?companyId=${company}&date=${PAST}`, `/v1/hrms/projects?companyId=${company}&date=${PAST}`, `/v1/probation/upcoming?days=30&date=${PAST}`]) {
    const r = await get(owner, path)
    check(`history endpoint answers: ${path.split('?')[0]}`, r.status === 200, r.status === 200 ? JSON.stringify(r.body).slice(0, 100) : String(r.body).slice(0, 160))
  }
  // Other roles: a past date answers exactly as far as today's view does (same status, never a new error).
  for (const email of ['mgr@unifiedtree.demo', 'fin@unifiedtree.demo']) {
    const who = await token(email)
    const diffs = []
    for (const [now, then] of [[`/v1/admin/dashboard/stats?companyId=${company}`, `&date=${MID}`], [`/v1/admin/dashboard/alerts`, `?date=${MID}`],
      [`/v1/attendance/dashboard?date=${TODAY}`, `&includeLeavers=true`], [`/v1/attendance/dashboard/trend?to=${TODAY}`, `&includeLeavers=true`],
      [`/v1/admin/dashboard/performers?companyId=${company}`, `&date=${MID}`], [`/v1/admin/dashboard/notices?companyId=${company}&page=0`, `&date=${MID}`],
      [`/v1/probation/upcoming?days=30`, `&date=${MID}`], [`/v1/hrms/projects?companyId=${company}`, `&date=${MID}`]]) {
      const a = (await get(who, now)).status, b = (await get(who, now.includes('/attendance/') ? now.replace(TODAY, MID) + then : now + then)).status
      if (a !== b || b >= 500) diffs.push(`${now.split('?')[0]} ${a}→${b}`)
    }
    check(`${email}: past-date requests answer like today's (no new errors)`, diffs.length === 0, diffs.join(', '))
  }
  // Notices on a past date include ones archived since, so only the company view (org.company.read) gets them.
  const reader = await token('reader@unifiedtree.demo')
  const readerCompany = (await get(reader, `/v1/admin/dashboard/stats?companyId=${company}`)).status === 200
  const rNow = await get(reader, `/v1/admin/dashboard/notices?companyId=${company}&page=0`)
  const rPast = await get(reader, `/v1/admin/dashboard/notices?companyId=${company}&page=0&date=${PAST}`)
  check('notices: a past date is for the company view only (others get today\'s list)', rPast.status === 200 && JSON.stringify(rPast.body) === JSON.stringify(readerCompany ? noticesPast.body : rNow.body),
    `reader ${readerCompany ? 'can' : 'cannot'} read the company; past ${rPast.body?.totalElements}, today ${rNow.body?.totalElements}`)

  // Past working days: the day's roster, punches, late arrivals and leave match the attendance records.
  const me = await get(owner, '/v1/employees/me')
  const self = me.status === 200 && me.body?.id ? me.body.id : null
  const notSelf = self ? `AND e.id <> '${self}'` : ''
  const rosterOn = (day) => Number(sql(`SELECT count(*) FROM hrms.employees e WHERE e.tenant_id='${tenant}' AND e.company_id='${company}' ${notSelf}
      AND (e.employment_status NOT IN ('EXITED','TERMINATED','RESIGNED','RETIRED')
           OR (COALESCE(e.last_working_day, e.date_of_termination) >= DATE '${day}' AND COALESCE(e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date) <= DATE '${day}'))
      AND (e.date_of_joining IS NULL OR e.date_of_joining <= DATE '${day}')
      AND NOT (',' || COALESCE(e.weekly_off_days, '6,7') || ',') LIKE '%,' || extract(isodow FROM DATE '${day}')::int || ',%'`))
  const recordsOn = (day) => sql(`SELECT count(*) FILTER (WHERE r.check_in_at IS NOT NULL) || '|' || count(*) FILTER (WHERE r.attendance_status = 'LATE')
      FROM attendance.records r JOIN hrms.employees e ON e.id = r.employee_id WHERE r.tenant_id='${tenant}' AND e.company_id='${company}' AND r.attendance_date = DATE '${day}' ${notSelf}`).split('|').map(Number)
  const leaveOn = (day) => Number(sql(`SELECT count(DISTINCT l.employee_id) FROM leave_mgmt.leave_requests l JOIN hrms.employees e ON e.id = l.employee_id
      WHERE l.tenant_id='${tenant}' AND e.company_id='${company}' AND l.status = 'APPROVED' AND DATE '${day}' BETWEEN l.start_date AND l.end_date ${notSelf}`))
  const dayWant = {}
  for (const day of [WORKDAY, YEAR_AGO]) {
    const r = await get(owner, `/v1/attendance/dashboard?date=${day}&includeLeavers=true`)
    const s = r.body?.staffStatuses || []
    const [present, late] = recordsOn(day)
    const api = { total: s.length, present: s.filter((x) => x.checkInAt).length, late: s.filter((x) => x.status === 'LATE').length, onLeave: s.filter((x) => x.onLeave).length }
    dayWant[day] = { total: rosterOn(day), present, late, onLeave: leaveOn(day) }
    check(`${day}: the day's roster, punches, late arrivals and leave match the attendance records`, r.status === 200 && JSON.stringify(api) === JSON.stringify(dayWant[day]),
      `api ${JSON.stringify(api)}, sql ${JSON.stringify(dayWant[day])}`)
  }
  check(`${WORKDAY}: a day with real punches (not an empty day)`, dayWant[WORKDAY].present > 0, `punches ${dayWant[WORKDAY].present}`)

  const hiringPast = await get(owner, `/v1/admin/dashboard/hiring?companyId=${company}&date=${PAST}`)
  const candidatesSql = Number(sql(`SELECT count(*) FROM hiring_mgmt.candidates c JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id WHERE c.tenant_id='${tenant}' AND r.company_id='${company}' AND c.created_at < (DATE '${PAST}' + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`))
  check(`${PAST}: candidates = those who had applied by then`, hiringPast.body.stages.reduce((n, s) => n + Number(s.count), 0) === candidatesSql, `sql ${candidatesSql}`)

  // ── Browser: today, then the past day ───────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const pageErrors = [], failed = [], calls = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  page.on('request', (r) => { if (r.url().includes('/api/v1/')) calls.push(r.url().split('/api')[1]) })
  // The export's log entry: answered here so the check leaves no row behind.
  await page.route('**/api/v1/reports/exports', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }) : route.continue())

  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  const tileValue = async (label) => {
    const tile = page.getByRole('button', { name: new RegExp(label) }).first()
    await tile.waitFor({ timeout: 20000 })
    return ((await tile.textContent()) || '').replace(/\s+/g, ' ')
  }
  calls.length = 0
  await page.goto(base + '/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /Active employees/ }).first().waitFor({ timeout: 20000 })
  const todayTile = await tileValue('Active employees')
  check('today: Active employees tile shows the database count', new RegExp(`Active employees\\s*${todayActive}(?!\\d)`).test(todayTile), todayTile.slice(0, 80))
  check('today: no past-date banner', (await page.getByRole('status').filter({ hasText: 'Viewing' }).count()) === 0)
  check('today: no "As of today" label', (await page.getByText('As of today', { exact: false }).count()) === 0)
  const dated = calls.filter((c) => c.includes('includeLeavers') || (/^\/v1\/(admin\/dashboard|hrms\/projects|probation\/upcoming|audit\/events|reports\/headcount)/.test(c) && /[?&](date|asOf|to)=/.test(c)))
  check('today: the same requests as before (no date, no includeLeavers)', dated.length === 0, dated.join(' | ').slice(0, 200))
  check('today: weekly trend says Last 7 days', (await page.getByText('Last 7 days · IST').count()) > 0)
  // Today's payroll chart: the last six finalized months, whatever they are (as before the date work).
  const finalMonths = sql(`SELECT DISTINCT period_year || '-' || lpad(period_month::text, 2, '0') FROM payroll.runs WHERE tenant_id='${tenant}' AND company_id='${company}' AND status IN ('LOCKED','PAID') ORDER BY 1`).split('\n').map((x) => x.trim()).filter(Boolean).slice(-6)
  if (finalMonths.length && (await page.getByText('Finalized payroll', { exact: false }).count()) > 0) {
    const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], title = (m) => `${MONS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
    const first = finalMonths[0], last = finalMonths[finalMonths.length - 1]
    const range = `${first.slice(0, 4) === last.slice(0, 4) ? MONS[Number(first.slice(5, 7)) - 1] : title(first)} – ${title(last)}`
    check('today: payroll chart shows the last six finalized months', (await page.getByText(range, { exact: true }).count()) > 0, range)
  }
  await screens(page, 'dashboard-today-1440')

  // A day in the previous year, straight from the URL.
  calls.length = 0
  await page.goto(`${base}/dashboard?date=${PAST}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('status').filter({ hasText: 'Viewing' }).first().waitFor({ timeout: 20000 }).catch(() => {})
  check(`${PAST}: the banner names the day`, (await page.getByRole('status').filter({ hasText: `Viewing Fri, ${PAST_LABEL}` }).count()) > 0)
  await page.waitForTimeout(1500)
  const pastTile = await tileValue('Active employees')
  // The value is followed by the sub-line "<joined> joined · <left> left, 1–14 Mar 2025".
  check(`${PAST}: Active employees tile shows that day's count (${pastActive})`, pastTile.trim().startsWith(`Active employees${pastActive}${statsPast.body.joinedInMonth} joined · ${statsPast.body.leftInMonth} left`), pastTile.slice(0, 90))
  check(`${PAST}: the tile tells the month's joiners and leavers`, /joined · \d+ left, 1–14 Mar 2025/.test(pastTile), pastTile.slice(0, 120))
  const payTile = await page.getByRole('button', { name: /Finalized payroll/ }).first().textContent().catch(() => '')
  check(`${PAST}: payroll tile is that month's`, /Finalized payroll · 2025-03/.test(payTile || '') && (pastRun !== '0' || /Not finalized/.test(payTile || '')), (payTile || '').slice(0, 80))
  const asOf = page.getByText('As of today', { exact: false })
  const seatsShown = (await page.getByText('Seats used', { exact: false }).count()) > 0
  check('"As of today" labels the seats (no history)', seatsShown ? (await asOf.count()) > 0 : (await asOf.count()) === 0, seatsShown ? 'seats tile shown' : 'no seats tile for this workspace')
  const runsUpTo = Number(sql(`SELECT count(*) FROM payroll.runs WHERE tenant_id='${tenant}' AND company_id='${company}' AND status IN ('LOCKED','PAID') AND (period_year * 100 + period_month) <= 202503`))
  check(`${PAST}: the payroll chart ends at that month`, runsUpTo > 0 ? (await page.getByText(/Mar 2025$/).count()) > 0 : (await page.getByText('Up to Mar 2025').count()) > 0, `finalized months up to it: ${runsUpTo}`)
  check(`${PAST}: weekly trend ends on the day`, (await page.getByText(`7 days to ${PAST_LABEL} · IST`).count()) > 0)
  check(`${PAST}: activity is up to the day`, (await page.getByText(`Activity up to ${PAST_LABEL}`).count()) > 0)
  check(`${PAST}: notices are those up that day`, (await page.getByText(noticesSql ? `up on ${PAST_LABEL}` : `No company notices were up on ${PAST_LABEL}.`).count()) > 0)
  check(`${PAST}: notices can't be edited in the past`, (await page.getByRole('button', { name: /Add notice/ }).count()) === 0)
  check(`${PAST}: the banner says Upcoming milestones counts from today`, (await page.getByText('except Upcoming milestones, which counts from today', { exact: false }).count()) > 0)
  const want = ['/v1/admin/dashboard/stats', '/v1/admin/dashboard/alerts', '/v1/admin/dashboard/notices', '/v1/admin/dashboard/performers', '/v1/admin/dashboard/onboarding', '/v1/admin/dashboard/hiring', '/v1/hrms/projects', '/v1/probation/upcoming', '/v1/reports/headcount']
  const missing = want.filter((p) => !calls.some((c) => c.startsWith(p) && (c.includes(`date=${PAST}`) || c.includes(`asOf=${PAST}`))))
  check(`${PAST}: every card asks for that day`, missing.length === 0, missing.join(', '))
  check(`${PAST}: attendance asks for the team as it was`, calls.some((c) => c.startsWith(`/v1/attendance/dashboard?date=${PAST}&includeLeavers=true`)) && calls.some((c) => c.includes('/dashboard/trend') && c.includes(`to=${PAST}`)))
  check(`${PAST}: activity asks for events up to the day`, calls.some((c) => c.startsWith('/v1/audit/events') && c.includes('to=2025-03-14T18%3A29%3A59.999Z')))
  await screens(page, 'dashboard-past-1440')

  // The export carries the date in its name and inside.
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Export headcount/ }).click()])
  const file = download.suggestedFilename()
  check('export file name has the chosen date', file.endsWith(`-${PAST}.xlsx`) && file.startsWith('headcount-'), file)
  const saved = `${shots}/../dashboard-export-${PAST}.xlsx`
  await download.saveAs(saved)
  const xml = readFileSync(saved).toString('utf8') // the writer stores files uncompressed
  check('export content is as of the chosen date', xml.includes('As of') && xml.includes(PAST_LABEL), '')
  const wb = await get(owner, `/v1/reports/headcount/workbook?companyId=${company}&asOf=${PAST}`)
  const fileTotal = Number((/Total headcount<\/t><\/is><\/c><c r="B\d+"[^>]*><v>(\d+)<\/v>/.exec(xml) || [])[1])
  check('export headcount = that day\'s headcount', wb.status === 200 && fileTotal === wb.body.totals.total && wb.body.asOf === PAST, `file ${fileTotal}, api ${wb.body?.totals?.total}`)

  // Refresh keeps the date; Back to today drops it.
  await page.reload()
  await page.waitForLoadState('networkidle')
  check('refresh keeps the date', page.url().includes(`date=${PAST}`) && (await page.getByRole('status').filter({ hasText: 'Viewing' }).count()) > 0)
  await page.getByRole('button', { name: 'Back to today' }).click()
  await page.waitForTimeout(500)
  check('Back to today drops the date from the URL', !page.url().includes('date='), page.url().replace(base, ''))

  // A date after today can't be shown.
  await page.goto(`${base}/dashboard?date=2031-01-01`)
  // The note is a toast: look for it as soon as the page opens (it fades after a few seconds).
  const said = await page.getByText('not a date after today', { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false)
  await page.waitForLoadState('networkidle')
  check('a date after today shows today, and says so', said && !page.url().includes('date=') && (await page.getByRole('status').filter({ hasText: 'Viewing' }).count()) === 0, page.url().replace(base, ''))

  // A past working day with punches, and a working day in the previous year: the tiles show the records.
  const norm = (t) => (t || '').replace(/\s+/g, '')
  const tileText = async (label) => norm(await page.getByRole('button', { name: new RegExp('^\\s*' + label) }).first().textContent({ timeout: 20000 }).catch(() => ''))
  for (const day of [WORKDAY, YEAR_AGO]) {
    const w = dayWant[day]
    const active = (await get(owner, `/v1/admin/dashboard/stats?companyId=${company}&date=${day}`)).body?.activeEmployees
    await page.goto(`${base}/dashboard?date=${day}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const t = { total: await tileText('Total Employees'), present: await tileText('Present'), onLeave: await tileText('On Leave'), late: await tileText('Late Arrivals') }
    const ok = t.total.startsWith(norm(`Total Employees${w.total}${active} active`)) && t.present.startsWith(norm(`Present${w.present}Checked in`))
      && t.onLeave.startsWith(norm(`On Leave${w.onLeave}Approved leave`)) && new RegExp(`^LateArrivals${w.late}(Noonelate|Needsattention)`).test(t.late)
    check(`${day}: the Live Overview tiles show that day's records`, ok, `${t.total.slice(0, 40)} | ${t.present.slice(0, 30)} | ${t.onLeave.slice(0, 30)} | ${t.late.slice(0, 30)}`)
    if (day === WORKDAY) {
      check(`${day}: the tiles name the day`, (await page.getByText(`Attendance · ${WORKDAY_LABEL.slice(0, 6)}`, { exact: false }).count()) > 0 || (await page.getByText('Checked in on 22 Sep', { exact: false }).count()) > 0)
      await screens(page, 'dashboard-workday-1440')
    }
  }

  // The projects drawer is today's list: on a past date it says so.
  await page.goto(`${base}/dashboard?date=${PAST}`)
  await page.waitForLoadState('networkidle')
  const manage = page.getByRole('button', { name: /Manage projects/ }).first()
  if (await manage.count()) {
    await manage.click()
    const note = await page.getByRole('note').filter({ hasText: 'As of today.' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false)
    check(`${PAST}: the projects drawer says it shows today's projects`, note)
    await page.waitForTimeout(800) // the drawer slides in
    await page.screenshot({ path: `${shots}/dashboard-past-projects-1440.png` })
    await page.keyboard.press('Escape')
  } else check(`${PAST}: the projects drawer says it shows today's projects`, false, 'no Manage projects button')

  // View reports carries the date; the dated reports open on it.
  await page.goto(`${base}/dashboard?date=${PAST}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'View reports' }).first().click()
  await page.waitForURL((u) => u.pathname === '/hrms/reports', { timeout: 20000 }).catch(() => {})
  await page.getByText(`reports open on ${PAST_LABEL}`, { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {})
  check(`${PAST}: View reports opens the reports on that date`, page.url().includes(`asOf=${PAST}`) && (await page.getByText(`reports open on ${PAST_LABEL}`, { exact: false }).count()) > 0, page.url().replace(base, ''))
  await page.getByText(`reports open on ${PAST_LABEL}`, { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: `${shots}/dashboard-past-reports-1440.png` })
  await page.getByRole('button', { name: /^Headcount/ }).first().click()
  await page.waitForURL((u) => u.pathname === '/hrms/reports/headcount', { timeout: 20000 }).catch(() => {})
  check(`${PAST}: the headcount report opens as of that date`, page.url().includes(`asOf=${PAST}`), page.url().replace(base, ''))
  await page.goto(`${base}/hrms/reports`)
  await page.waitForLoadState('networkidle')
  check('Reports Center without a date is unchanged (no date note)', (await page.getByText('the date picked on the dashboard', { exact: false }).count()) === 0)

  // The Attendance page behind the tiles: a past day lists the team as it was; today is unchanged.
  calls.length = 0
  await page.goto(`${base}/hrms/attendance?tab=team&date=${MID}`)
  await page.waitForLoadState('networkidle')
  check(`${MID}: the Attendance page lists the team as it was (like the tiles)`, calls.some((c) => c.startsWith(`/v1/attendance/dashboard?date=${MID}&includeLeavers=true`)), calls.filter((c) => c.startsWith('/v1/attendance/dashboard?')).join(' | '))
  calls.length = 0
  await page.goto(`${base}/hrms/attendance?tab=team`)
  await page.waitForLoadState('networkidle')
  check('today: the Attendance page asks as before (no includeLeavers)', calls.some((c) => c.startsWith('/v1/attendance/dashboard?')) && !calls.some((c) => c.includes('includeLeavers')), calls.filter((c) => c.startsWith('/v1/attendance/dashboard?')).join(' | '))

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))

  // Phone width, past day.
  const phone = page
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.goto(`${base}/dashboard?date=${PAST}`)
  await phone.waitForLoadState('networkidle')
  await phone.waitForTimeout(1500)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: no sideways scroll on a past day', overflow <= 1, `overflow ${overflow}px`)
  await screens(phone, 'dashboard-past-390')
} catch (e) {
  check('script completed', false, String(e.stack || e).slice(0, 300))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
