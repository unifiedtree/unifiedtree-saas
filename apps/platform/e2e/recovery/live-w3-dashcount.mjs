/* global process, console, fetch, setTimeout, localStorage */
// Live check of three dashboard counting bugs found in production (demo-hrms, 7 Oct 2026):
//
//  1. People without a joining date. Two TEST employees are saved with no joining date (their records
//     created three days ago), as Users & Access invites and older API clients used to save them. Today's
//     Total employees, the headcount report (and its department chart), a past day, a range ending today and
//     one ending yesterday, the People page's joiners and the joiners report all count them, and today's roster
//     lists them: no more "18 scheduled" beside "Total 15". An employee added through the API without a
//     joining date now gets today's.
//  2. Leavers in today's trend. A TEST employee who left yesterday is in yesterday's trend with
//     includeLeavers (and not without it), and the dashboard's trend ending today asks for it.
//  3. A reviewer's status on a weekly off. HR marks a TEST employee ABSENT on yesterday, their weekly off:
//     yesterday's roster lists and counts them, and the trend's absent goes up by one ("scheduled" does not).
//
// Everything it creates is removed at the end (employees, their status history, the review, its record,
// notifications and audit rows). Screenshots: /c/REACT/ut-wt/_results/shots/w64-dashcount-*.png.
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-w3-dashcount.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3164'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const apiErrors = []

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 400) apiErrors.push(`${res.status} ${method} ${path} ${text.slice(0, 160)}`)
    return { status: res.status, json }
  }
}

// ── dates (India) ────────────────────────────────────────────────────────────
const [today, yesterday, created, weekAgo, eightAgo, monthAgo, isoYesterday, isoOff] = sql(`select
    d::text, (d - 1)::text, (d - 3)::text, (d - 6)::text, (d - 7)::text, (d - 30)::text,
    extract(isodow from d - 1)::int::text, extract(isodow from d + 3)::int::text
  from (select (now() at time zone 'Asia/Kolkata')::date d) x`).split('|')
const start = sql(`select now()`)
const tag = String(Date.now() % 1000000)
const made = {} // name → employee id

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  const ids = Object.values(made).filter(Boolean)
  const also = sql(`select coalesce(string_agg(id::text, ','), '') from hrms.employees where tenant_id='${tenant}' and last_name like 'DashCount ${tag}%'`)
  for (const x of String(also).split(',').filter(Boolean)) if (!ids.includes(x)) ids.push(x)
  if (!ids.length) return
  const list = ids.map((x) => `'${x}'`).join(',')
  q(`delete from notif.notifications where tenant_id='${tenant}' and created_at >= '${start}' and (${ids.map((x) => `data::text like '%${x}%'`).join(' or ')})`)
  q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and entity_id::text in (${list})`)
  q(`delete from attendance.day_status_reviews where employee_id in (${list})`)
  q(`delete from attendance.event_logs where record_id in (select id from attendance.records where employee_id in (${list}))`)
  q(`delete from attendance.records where employee_id in (${list})`)
  for (const t of ['attendance.employee_shift_assignments', 'hrms.onboarding_instances', 'hrms.employee_onboarding_records',
    'leave_mgmt.leave_balances', 'hrms.probation_reminder_log', 'hrms.employee_status_history']) q(`delete from ${t} where employee_id in (${list})`)
  q(`delete from hrms.employees where id in (${list})`)
}

// ── what the dashboard and reports say ───────────────────────────────────────
let owner
const stats = async (qs) => (await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}${qs}`)).json || {}
const reportTotal = async (asOf) => ((await owner('GET', `/v1/reports/headcount?companyId=${company}&asOf=${asOf}`)).json || [])
  .reduce((n, r) => n + Number(r.total || 0), 0)
const roster = async (date, extra = '') => (await owner('GET', `/v1/attendance/dashboard?date=${date}&includeSelf=true${extra}`)).json || { staffStatuses: [], counts: {} }
const trendDay = async (date, leavers) => ((await owner('GET', `/v1/attendance/dashboard/trend?from=${date}&to=${date}&includeSelf=true${leavers ? '&includeLeavers=true' : ''}`)).json || [])[0] || {}
const joinersThisMonth = async () => ((await owner('GET', `/v1/reports/attrition/joiners?companyId=${company}&from=${today.slice(0, 8)}01&to=${today}`)).json || [])
  .reduce((n, r) => n + Number(r.joined || 0), 0)
const peopleStats = async () => (await owner('GET', `/v1/hrms/employees/stats?companyId=${company}`)).json || {}
async function snapshot() {
  const day = await roster(today, '&includeWeeklyOff=true')
  return {
    total: Number((await stats('')).headcount),
    totalYesterday: Number((await stats(`&date=${yesterday}`)).headcount),
    week: Number((await stats(`&from=${weekAgo}`)).joinedInPeriod),
    pastWeek: Number((await stats(`&date=${yesterday}&from=${eightAgo}`)).joinedInPeriod),
    report: await reportTotal(today),
    reportYesterday: await reportTotal(yesterday),
    listedToday: day.staffStatuses.length,
    joiners: await joinersThisMonth(),
    peopleJoined: Number((await peopleStats()).joinedThisMonth),
  }
}

async function addEmployee(name, body) {
  const r = await owner('POST', '/v1/hrms/employees', { companyId: company, firstName: name, lastName: `DashCount ${tag}`, employmentType: 'FULL_TIME', roleCode: 'EMPLOYEE', weeklyOffDays: isoOff, ...body })
  made[name] = r.json?.id || null
  return r
}

const browser = await chromium.launch()
try {
  owner = await apiLogin('owner@unifiedtree.demo')
  const before = await snapshot()
  console.log(`today ${today}, yesterday ${yesterday} (ISO weekday ${isoYesterday}); before: ${JSON.stringify(before)}`)

  // ── fixtures ─────────────────────────────────────────────────────────────
  // D: added through the API without a joining date: saved with today's.
  const d = await addEmployee('Nodate', {})
  check('an employee added without a joining date is saved with today\'s', d.status < 300 && d.json?.dateOfJoining === today, `${d.status} ${d.json?.dateOfJoining}`)
  // A, B: no joining date, records created three days ago (as invites and older clients saved them).
  for (const n of ['Ajoin', 'Bjoin']) {
    await addEmployee(n, { dateOfJoining: created })
    if (made[n]) sql(`update hrms.employees set date_of_joining = null, created_at = now() - interval '3 days' where id = '${made[n]}'`)
  }
  check('two TEST employees without a joining date, created three days ago', !!made.Ajoin && !!made.Bjoin
    && sql(`select count(*) from hrms.employees where id in ('${made.Ajoin}','${made.Bjoin}') and date_of_joining is null and (created_at at time zone 'Asia/Kolkata')::date = '${created}'`) === '2')
  // L: a leaver whose last working day was yesterday. C: yesterday is C's weekly off.
  await addEmployee('Leaver', { dateOfJoining: monthAgo })
  const exit = made.Leaver ? await owner('POST', `/v1/hrms/employees/${made.Leaver}/exit?lastWorkingDay=${yesterday}`) : { status: 0 }
  check('a TEST leaver whose last working day was yesterday', exit.status < 300 && exit.json?.employmentStatus === 'EXITED', `${exit.status}`)
  await addEmployee('Coff', { dateOfJoining: monthAgo, weeklyOffDays: isoYesterday })
  check('a TEST employee whose weekly off was yesterday', !!made.Coff)

  // ── 1. people without a joining date ──────────────────────────────────────
  const after = await snapshot()
  console.log(`after: ${JSON.stringify(after)}`)
  check('today\'s Total employees counts the two without a joining date (+4: A, B, C, D)', after.total - before.total === 4, `${before.total} → ${after.total}`)
  check('the headcount report and department chart for today: +4, the same as the tile', after.report - before.report === 4 && after.report === after.total, `${before.report} → ${after.report}, tile ${after.total}`)
  check('yesterday\'s Total employees: +4 (A, B, C and the leaver on their last day)', after.totalYesterday - before.totalYesterday === 4, `${before.totalYesterday} → ${after.totalYesterday}`)
  check('the headcount report for yesterday agrees', after.reportYesterday - before.reportYesterday === 4 && after.reportYesterday === after.totalYesterday, `${before.reportYesterday} → ${after.reportYesterday}`)
  check('today\'s roster lists the same people the tile adds (+4)', after.listedToday - before.listedToday === 4, `${before.listedToday} → ${after.listedToday}`)
  const day = await roster(today)
  const onDay = (id) => day.staffStatuses.some((s) => s.employeeId === id)
  check('A and B are on today\'s roster and the tile counts them', onDay(made.Ajoin) && onDay(made.Bjoin))
  check('joiners for the 7 days to today: +3 (A, B, D)', after.week - before.week === 3, `${before.week} → ${after.week}`)
  check('joiners for the 7 days to yesterday: +2 (A, B), never more than the range to today', after.pastWeek - before.pastWeek === 2 && after.week - before.week >= after.pastWeek - before.pastWeek, `${before.pastWeek} → ${after.pastWeek}`)
  // A, B (records created three days ago), D (today), C and the leaver (a month ago), when in this month.
  const monthJoiners = [created, created, today, monthAgo, monthAgo].filter((x) => x.slice(0, 7) === today.slice(0, 7)).length
  check(`the joiners report for this month: +${monthJoiners}`, after.joiners - before.joiners === monthJoiners, `${before.joiners} → ${after.joiners}`)
  check(`the People page's joined this month: +${monthJoiners}`, after.peopleJoined - before.peopleJoined === monthJoiners, `${before.peopleJoined} → ${after.peopleJoined}`)
  // Before the records existed they are not on the roll.
  const fourAgo = sql(`select ((now() at time zone 'Asia/Kolkata')::date - 4)::text`)
  const roster4 = await roster(fourAgo, '&includeLeavers=true&includeWeeklyOff=true')
  check('the day before their records were created, A and B are on no roster', !roster4.staffStatuses.some((s) => s.employeeId === made.Ajoin || s.employeeId === made.Bjoin))

  // ── 2. leavers in the trend ───────────────────────────────────────────────
  const withLeavers = await trendDay(yesterday, true), without = await trendDay(yesterday, false)
  const yRoster = await roster(yesterday, '&includeLeavers=true')
  check('yesterday\'s roster (as it was) lists the leaver', yRoster.staffStatuses.some((s) => s.employeeId === made.Leaver))
  check('yesterday\'s trend with includeLeavers counts the leaver (one more scheduled than without)', Number(withLeavers.scheduled) - Number(without.scheduled) >= 1,
    `scheduled ${without.scheduled} without, ${withLeavers.scheduled} with`)

  // ── 3. a reviewer's ABSENT on a weekly off ────────────────────────────────
  const rBefore = await roster(yesterday, '&includeLeavers=true'), tBefore = await trendDay(yesterday, true)
  check('before the review C (weekly off) is not counted yesterday', !rBefore.staffStatuses.some((s) => s.employeeId === made.Coff))
  const rev = made.Coff ? await owner('POST', '/v1/attendance/review/status', { employeeId: made.Coff, date: yesterday, status: 'ABSENT', reason: 'Live test: marked absent on a weekly off' }) : { status: 0 }
  check('HR marks C absent on their weekly off', rev.status < 300 && rev.json?.status === 'ABSENT' && rev.json?.manual === true, `${rev.status} ${rev.json?.status}`)
  const rAfter = await roster(yesterday, '&includeLeavers=true'), tAfter = await trendDay(yesterday, true)
  const cRow = rAfter.staffStatuses.find((s) => s.employeeId === made.Coff)
  check('yesterday\'s roster lists C as absent', cRow?.effectiveStatus === 'ABSENT', cRow ? `${cRow.status}/${cRow.effectiveStatus}` : 'missing')
  check('yesterday\'s absent tile goes up by one', Number(rAfter.counts.absent) - Number(rBefore.counts.absent) === 1, `${rBefore.counts.absent} → ${rAfter.counts.absent}`)
  check('yesterday\'s trend: absent +1, scheduled unchanged', Number(tAfter.absent) - Number(tBefore.absent) === 1 && Number(tAfter.scheduled) === Number(tBefore.scheduled),
    `absent ${tBefore.absent} → ${tAfter.absent}, scheduled ${tBefore.scheduled} → ${tAfter.scheduled}`)
  const tPlain = await trendDay(yesterday, false)
  check('the app\'s view (no includeLeavers) counts C too', Number(tPlain.absent) >= 1 && (await roster(yesterday)).staffStatuses.some((s) => s.employeeId === made.Coff))

  // ── the dashboard in the browser ──────────────────────────────────────────
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ } })
    const page = await ctx.newPage()
    const errors = [], failed = [], trendUrls = []
    page.on('pageerror', (e) => errors.push(String(e.message || e)))
    page.on('request', (r) => { if (r.url().includes('/attendance/dashboard/trend')) trendUrls.push(r.url()) })
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
    await page.goto(base + '/login', { timeout: 120_000 })
    await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(base + '/dashboard')
    await page.waitForLoadState('networkidle').catch(() => {})
    // The check-in prompt after sign-in covers the dashboard: set it aside.
    await page.getByRole('button', { name: 'Continue without checking in' }).click({ timeout: 5000 }).catch(() => {})
    await sleep(1500)
    const todays = trendUrls.filter((u) => u.includes(`to=${today}`))
    if (width === 1440) {
      check('the dashboard\'s trend ending today asks for leavers', todays.length > 0 && todays.every((u) => u.includes('includeLeavers=true')), todays.map((u) => u.split('/api')[1]).join(' | ') || 'no request')
      const tile = page.getByRole('button', { name: /^\s*Total employees/i }).first()
      let v = '', prev = null
      for (let i = 0; i < 12; i++) { v = ((await tile.locator('.uk-stat__value').textContent().catch(() => '')) || '').replace(/\s+/g, ''); if (v && v === prev) break; prev = v; await sleep(400) }
      check('the Total employees tile shows the headcount', v === String(after.total), `tile ${v}, headcount ${after.total}`)
    }
    await page.screenshot({ path: `${SHOTS}/w64-dashcount-${width}.png` }).catch(() => {})
    check(`no page errors or failed calls (${width} wide)`, errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 4).join(' | '))
    await ctx.close()
  }
} catch (e) {
  check('run completed', false, String(e.stack || e).slice(0, 400))
} finally {
  await browser.close()
  cleanup()
  const left = sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and last_name like 'DashCount ${tag}%'`)
  check('cleanup removed every TEST employee', left === '0', left)
}

if (apiErrors.length) console.log('API errors:\n  ' + apiErrors.join('\n  '))
check('no API errors', apiErrors.length === 0)
const failedChecks = results.filter((r) => !r.ok)
console.log(`\n${results.length - failedChecks.length}/${results.length} passed`)
process.exit(failedChecks.length ? 1 : 0)
