// Live check: half-day leave in payroll (fix/payroll-halfday-paid, 10 Oct 2026). No browser.
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_API_URL=http://127.0.0.1:8080/api node e2e/recovery/live-w3-fix-halfday.mjs
//   (through live-slot.sh)
//
// A test run for Mar 2032 with the reader's leave saved the way the leave module
// saves it (duration HALF_DAY_MORNING / HALF_DAY_AFTERNOON, half_day false) and
// attendance records for the other half (docs/PAYROLL-LOP-RULES.md, case 1):
//   paid half + half day worked / late / nothing marked → PAID_LEAVE (paid in full)
//   paid half + absent                                  → HALF_DAY_LEAVE (half loss of pay)
//   unpaid half + half day worked / nothing marked      → HALF_DAY_LEAVE
//   unpaid half + absent                                → LOP_LEAVE (a whole day)
//   a half day worked with no leave, full-day leaves    → as before
//   a row with only the older half_day column set       → still a half day
// Checks payroll.run_lop_days (days and the day-by-day log), the run's employee
// row (what the web shows) and the payslip. The run is processed only, never
// locked or paid, and only when processing can't touch advances, encashments or
// PLI awards (fixture check). Everything it creates is removed.
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const first = (s) => s.split(/\r?\n/)[0].trim()   // INSERT … RETURNING: the value, then the command tag

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const near = (a, b, tol = 0.005) => a != null && Math.abs(Number(a) - Number(b)) < tol
const apiErrors = []

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!r.ok || !d.accessToken) throw new Error(`login ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 400) apiErrors.push(`${method} ${path} → ${res.status} ${json?.errorCode ?? ''}`)
    return { status: res.status, json }
  }
}

const Y = 2032, M = 3, DAYS = 31
const monthStart = '2032-03-01', monthEnd = '2032-03-31'
const stamp = Date.now().toString().slice(-6)
const created = { types: [], leaves: [], records: [], runId: null }
const RES_PAY = { PAID: 0, HALF: 0.5, LOP: 1 }

// [what, leave type, duration, half_day column, attendance status, check-in, expected status, expected resolution]
const CASES = [
  ['paid half-day leave, worked the other half (half day)', 'paid', 'HALF_DAY_MORNING', false, 'HALF_DAY', '13:30', 'PAID_LEAVE', 'PAID'],
  ['paid half-day leave, late for the other half', 'paid', 'HALF_DAY_MORNING', false, 'LATE', '13:40', 'PAID_LEAVE', 'PAID'],
  ['paid half-day leave, absent for the other half', 'paid', 'HALF_DAY_AFTERNOON', false, 'ABSENT', null, 'HALF_DAY_LEAVE', 'HALF'],
  ['paid half-day leave, no attendance', 'paid', 'HALF_DAY_AFTERNOON', false, null, null, 'PAID_LEAVE', 'PAID'],
  ['unpaid half-day leave, worked the other half', 'unpaid', 'HALF_DAY_MORNING', false, 'HALF_DAY', '13:30', 'HALF_DAY_LEAVE', 'HALF'],
  ['unpaid half-day leave, absent for the other half', 'unpaid', 'HALF_DAY_AFTERNOON', false, 'ABSENT', null, 'LOP_LEAVE', 'LOP'],
  ['unpaid half-day leave, no attendance', 'unpaid', 'HALF_DAY_MORNING', false, null, null, 'HALF_DAY_LEAVE', 'HALF'],
  ['a half day worked, no leave (as before)', null, null, false, 'HALF_DAY', '09:10', 'HALF_DAY_LEAVE', 'HALF'],
  ['full-day paid leave (as before)', 'paid', 'FULL_DAY', false, null, null, 'PAID_LEAVE', 'PAID'],
  ['full-day unpaid leave (as before)', 'unpaid', 'FULL_DAY', false, null, null, 'LOP_LEAVE', 'LOP'],
  ['older half_day column: paid, worked the other half', 'paid', null, true, 'HALF_DAY', '13:30', 'PAID_LEAVE', 'PAID'],
  ['older half_day column: paid, absent for the other half', 'paid', null, true, 'ABSENT', null, 'HALF_DAY_LEAVE', 'HALF'],
]

let reader = null
try {
  const owner = await session('owner@unifiedtree.demo')
  reader = sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and email='reader@unifiedtree.demo'`)

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const own = sql(`select coalesce(weekly_off_days,'') from hrms.employees where id='${reader}'`).split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7)
  const companyOff = sql(`select coalesce(array_to_string(weekend_days, ','), '') from settings.hr_configuration where company_id='${company}'`).split(',').filter(Boolean).map(Number)
  const off = new Set(own.length ? own : companyOff.length ? companyOff : [6, 7])
  const holidays = new Set(sql(`select holiday_date from settings.holiday_calendar where company_id='${company}' and is_active and holiday_date between '${monthStart}' and '${monthEnd}'
    union select holiday_date from leave_mgmt.holiday_calendars where company_id='${company}' and holiday_date between '${monthStart}' and '${monthEnd}'`).split(/\s+/).filter(Boolean))
  const workdays = []
  for (let d = 1; d <= DAYS; d++) {
    const iso = `2032-03-${String(d).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
    if (!off.has(dow) && !holidays.has(iso)) workdays.push(iso)
  }
  const clean = sql(`select (select count(*) from leave_mgmt.leave_requests where employee_id='${reader}' and start_date<='${monthEnd}' and end_date>='${monthStart}')
    + (select count(*) from attendance.records where employee_id='${reader}' and attendance_date between '${monthStart}' and '${monthEnd}')
    + (select count(*) from payroll.runs where company_id='${company}' and period_year=${Y} and period_month=${M})`)
  const untouched = sql(`select (select count(*) from advance_mgmt.advance_recovery_schedule where status='PENDING' and scheduled_month='${monthStart}')
    + (select count(*) from leave_mgmt.leave_encashment_requests where status='APPROVED' and payroll_run_id is null)
    + (select count(*) from pli_mgmt.pli_awards where status='APPROVED' and payroll_run_id is null and amount > 0)`)
  const fixturesOk = !!reader && workdays.length >= CASES.length && clean === '0' && untouched === '0'
  check('fixtures: the reader has nothing in Mar 2032, and processing touches no advance, encashment or PLI award', fixturesOk,
    `reader=${reader} workdays=${workdays.length} existing=${clean} wouldTouch=${untouched}`)
  if (!fixturesOk) throw new Error('fixtures not as expected — nothing processed')

  // ── Leave types, leave and attendance, saved as the app saves them ─────────
  const type = (paid) => {
    const id = first(sql(`insert into leave_mgmt.leave_types (id, tenant_id, company_id, name, code, annual_entitlement, is_paid_leave, is_active)
      values (gen_random_uuid(), '${tenant}', '${company}', 'QA half-day ${paid ? 'paid' : 'unpaid'} ${stamp}', 'QAH${paid ? 'P' : 'U'}${stamp}', 0, ${paid}, true) returning id`))
    created.types.push(id)
    return id
  }
  const types = { paid: type(true), unpaid: type(false) }
  const cases = CASES.map(([what, kind, duration, halfColumn, att, checkIn, status, resolution], i) => {
    const date = workdays[i]
    if (kind) {
      created.leaves.push(first(sql(`insert into leave_mgmt.leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, half_day, duration, total_days, reason, status)
        values (gen_random_uuid(), '${tenant}', '${reader}', '${types[kind]}', '${date}', '${date}', ${halfColumn}, ${duration ? `'${duration}'` : 'null'},
        ${duration === 'FULL_DAY' ? 1 : 0.5}, 'QA half-day payroll ${stamp}', 'APPROVED') returning id`)))
    }
    if (att) {
      created.records.push(first(sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, attendance_status, check_in_at)
        values (gen_random_uuid(), '${tenant}', '${reader}', '${company}', '${date}', '${att}', ${checkIn ? `'${date} ${checkIn}:00+05:30'` : 'null'}) returning id`)))
    }
    return { what, date, status, resolution }
  })
  const lop = cases.reduce((a, c) => a + RES_PAY[c.resolution], 0)
  const paid = DAYS - lop

  // ── Create and process the run (never locked or paid) ──────────────────────
  let r = await owner('/v1/payroll/runs', 'POST', { companyId: company, periodMonth: M, periodYear: Y })
  created.runId = r.json?.id || null
  const runId = created.runId
  check('run: created for Mar 2032', r.status === 201 && !!runId, `status=${r.status} ${r.json?.errorCode || ''}`)
  r = await owner(`/v1/payroll/runs/${runId}/process`, 'POST')
  check('run: processed', r.status === 200 && r.json?.status === 'PROCESSING', `status=${r.status} ${r.json?.errorCode || ''} ${r.json?.message || ''}`)

  // ── The LOP row and its day-by-day log ─────────────────────────────────────
  const row = sql(`select paid_days||'|'||lop_days||'|'||total_calendar from payroll.run_lop_days where run_id='${runId}' and employee_id='${reader}'`).split('|')
  const log = JSON.parse(sql(`select computation_log::text from payroll.run_lop_days where run_id='${runId}' and employee_id='${reader}'`) || '{}')
  const byDay = new Map((log.days || []).map((d) => [d.day, d]))
  for (const c of cases) {
    const got = byDay.get(Number(c.date.slice(8)))
    check(c.what, got?.status === c.status && got?.resolution === c.resolution, `${c.date}: ${got?.status} ${got?.resolution} (expected ${c.status} ${c.resolution})`)
  }
  check(`run_lop_days: ${paid} paid and ${lop} LOP days of ${DAYS}`, near(row[0], paid) && near(row[1], lop) && row[2] === String(DAYS) && near(log.paidDays, paid) && near(log.lopDays, lop),
    `row=${row.join('|')} log=${log.paidDays}/${log.lopDays}`)
  check('every other day of the month is paid', (log.days || []).filter((d) => !cases.some((c) => Number(c.date.slice(8)) === d.day)).every((d) => d.resolution === 'PAID'))

  // ── What the web and the payslip show ──────────────────────────────────────
  r = await owner(`/v1/payroll/runs/${runId}/employees`)
  const me = (Array.isArray(r.json) ? r.json : []).find((e) => e.employeeId === reader)
  check('run employees (the web\u2019s list): same paid and LOP days', r.status === 200 && near(me?.paidDays, paid) && near(me?.lopDays, lop), `status=${r.status} ${me?.paidDays}/${me?.lopDays}`)
  r = await owner(`/v1/payroll/runs/${runId}/employees/${reader}/payslip`)
  check('payslip: same paid and LOP days', r.status === 200 && near(r.json?.paidDays, paid) && near(r.json?.lopDays, lop) && r.json?.totalDays === DAYS,
    `status=${r.status} ${r.json?.paidDays}/${r.json?.lopDays} of ${r.json?.totalDays}`)
  const listed = sql(`select coalesce(max(esc.monthly_amount)::text, '') from payroll.employee_structure_components esc
    join payroll.employee_salary_structures s on s.id = esc.structure_id join payroll.salary_components c on c.id = esc.component_id
    where s.employee_id='${reader}' and s.is_current and c.code='BASIC'`)
  const basicFull = Number(listed || sql(`select ctc_monthly from payroll.employee_salary_structures where employee_id='${reader}' and is_current`))
  const basicPaid = sql(`select coalesce(sum(amount),0) from payroll.payslip_lines where run_id='${runId}' and employee_id='${reader}' and component_code='BASIC'`)
  check(`BASIC is paid for ${paid} of ${DAYS} days`, basicFull > 0 && near(basicPaid, basicFull * paid / DAYS, 0.011), `${basicPaid} of ${basicFull}`)
} catch (e) {
  check('run without errors', false, e.message)
} finally {
  try {
    const run = created.runId
    if (run) {
      // payslip_lines and run_lop_days go with the run (ON DELETE CASCADE); deleted first anyway.
      sql(`delete from payroll.payslip_lines where run_id='${run}'`)
      sql(`delete from payroll.run_lop_days where run_id='${run}'`)
      sql(`delete from payroll.runs where id='${run}'`)
    }
    for (const id of created.records) sql(`delete from attendance.records where id='${id}'`)
    for (const id of created.leaves) sql(`delete from leave_mgmt.leave_requests where id='${id}'`)
    for (const id of created.types) sql(`delete from leave_mgmt.leave_types where id='${id}'`)
    const left = sql(`select (select count(*) from payroll.runs where company_id='${company}' and period_year=${Y} and period_month=${M})
      + (select count(*) from leave_mgmt.leave_types where code like 'QAH_${stamp}')
      + (select count(*) from leave_mgmt.leave_requests where reason='QA half-day payroll ${stamp}')
      + (select count(*) from attendance.records where employee_id='${reader}' and attendance_date between '${monthStart}' and '${monthEnd}')`)
    check('cleanup: nothing left behind', left === '0', `left=${left}`)
  } catch (e) {
    check('cleanup', false, e.message)
  }
  check('no API call failed (4xx/5xx)', apiErrors.length === 0, apiErrors.join(' | '))
  const passed = results.filter((x) => x.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
