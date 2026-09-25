// Live API check of the w2f attendance extras (V143_25). No browser.
//
//  1. Overtime details: GET /v1/attendance/overtime returns the shift in force that
//     day (name, end), the check-out time and a reason with where it came from;
//     PUT /v1/attendance/overtime/{id}/reason lets the employee explain their own
//     pending overtime (not someone else's, not once decided); a reason sent with
//     POST /v1/attendance/checkout (overtimeReason) is stored on the day's record.
//  2. Shift requests "Already decided": GET /v1/shifts/change-requests/decided with
//     who decided, when and the note; a manager sees only their team.
//  3. Change-shift note: POST /v1/shifts/employee/{id} keeps the note; it shows in
//     GET /v1/shifts/employee/{id}/history (self, workforce admins, own manager).
//  4. GET /v1/team/schedule returns shiftPolicyId, since and joinedOn.
//  5. Face events carry the device: sent with the check, put there by the face
//     check-in's deviceId, or worked out from the punch it cleared.
//  6-7. GET /v1/attendance/dashboard/trend: per-day checkedIn / workFromHomeOnTime
//     (no WFH + late double count) and the weekly-off fields.
// Refused roles get 403. Everything the test creates is removed at the end, and the
// reader's shift assignments are put back as they were.
//
// Needs the local recovery backend (with V143_25 applied) and Postgres:
//   RECOVERY_API_URL (default http://127.0.0.1:8097/api), RECOVERY_DB (default unifiedtree_recovery)
//   node e2e/recovery/live-w2f.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222' // reader@ — employee id and login id
const HRM = '33333333-3333-3333-3333-333333333333' // hrm@ — employee id and login id
const FIN = '55555555-5555-5555-5555-555555555555' // fin@ — not in the manager's team
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: process.env }).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => console.log(`SKIP  ${name}  — ${why}`)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

/** yyyy-MM-dd in India, n days from today. */
const istDay = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86_400_000))
const ms = (v) => (v == null ? NaN : new Date(v).getTime())

const made = { decisionFor: [], faceEvents: [], records: [], requests: [], assignment: null, reopen: [] }

try {
  // ── preconditions ──
  const cols = sql(`select count(*) from information_schema.columns where (table_schema, table_name, column_name) in (('attendance','records','overtime_reason'),('attendance','employee_shift_assignments','note'))`)
  check('setup: migration V143_25 is applied (overtime_reason, assignment note)', cols === '2', `${cols}/2 columns`)
  if (cols !== '2') throw new Error('apply V143_25__attendance_extras.sql first')

  const owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const company = sql(`select company_id from hrms.employees where id='${READER}'`)
  const hrmName = sql(`select concat_ws(' ', first_name, last_name) from hrms.employees where id='${HRM}'`)
  const today = istDay(0)

  // A recent past day the reader has no attendance on: the overtime / trend / face fixture.
  let D = ''
  for (let n = 1; n <= 20 && !D; n++) {
    const d = istDay(-n)
    if (sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${d}'`) === '0') D = d
  }
  if (!D) throw new Error('no free past day for the reader in the last 20 days')
  const recId = randomUUID()
  sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, check_in_at, check_out_at, attendance_type, attendance_status,
        check_in_method, check_out_method, overtime_minutes, work_hours, manual_entry, is_regularized, regularization_reason, device_id)
       values ('${recId}', '${tenant}', '${READER}', '${company}', '${D}', '${D} 09:00:00+05:30', '${D} 19:15:00+05:30', 'WFH', 'LATE',
        'MANUAL', 'MANUAL', 75, 10.25, false, true, 'QA w2f fix reason', 'QA derived kiosk w2f')`)
  made.records.push(recId)
  console.log(`fixture: overtime record ${recId} for the reader on ${D}`)

  // ── 1. overtime details ──
  const expectedEnd = sql(`select coalesce(to_char(s.end_time,'HH24:MI'),'') from (select 1) x left join lateral (
      select a.shift_policy_id from attendance.employee_shift_assignments a where a.employee_id='${READER}' and a.effective_from<='${D}'
      and (a.effective_to is null or a.effective_to>='${D}') order by a.effective_from desc, a.created_at desc limit 1) sa on true
      left join attendance.shift_policies s on s.id=sa.shift_policy_id`)
  const otRow = async (who) => ((await who(`/v1/attendance/overtime?from=${D}&to=${D}`)).json?.content || []).find((r) => r.id === recId)
  let row = await otRow(hrm)
  check('overtime list: the day carries left-at, shift end and a reason', !!row && ms(row.checkOutAt) === ms(`${D}T19:15:00+05:30`) && (row.shiftEnd || '') === expectedEnd
    && row.reason === 'QA w2f fix reason' && row.reasonSource === 'FIX_REQUEST' && row.minutes === 75,
  row ? `out=${row.checkOutAt} shiftEnd=${row.shiftEnd}/${expectedEnd || 'none'} reason=${row.reason} (${row.reasonSource})` : 'row missing')
  // A manual entry HR made is labelled as HR's, not as a fix request; the nightly auto-close marker is no reason.
  sql(`update attendance.records set manual_entry = true, manual_entry_reason = 'QA w2f manual reason' where id='${recId}'`)
  row = await otRow(hrm)
  check('overtime list: a manual entry’s reason is labelled as entered by HR', row?.reason === 'QA w2f manual reason' && row?.reasonSource === 'MANUAL_ENTRY', `${row?.reason} (${row?.reasonSource})`)
  sql(`update attendance.records set manual_entry = false, manual_entry_reason = null, regularization_reason = 'AUTO_CLOSED: no checkout recorded' where id='${recId}'`)
  row = await otRow(hrm)
  check('overtime list: the auto-close marker is not shown as a reason', !!row && row.reason == null && row.reasonSource == null, `${row?.reason} (${row?.reasonSource})`)
  sql(`update attendance.records set regularization_reason = 'QA w2f fix reason' where id='${recId}'`)
  check('overtime list: a manager sees their team member’s overtime', !!(await otRow(mgr)))
  check('overtime list: an employee is refused (403)', (await reader(`/v1/attendance/overtime?from=${D}&to=${D}`)).status === 403)

  let r = await reader(`/v1/attendance/overtime/${recId}/reason`, 'PUT', { reason: '  QA w2f stayed\nfor the audit ' })
  check('overtime reason: the employee explains their own pending overtime', r.status === 200 && sql(`select overtime_reason from attendance.records where id='${recId}'`) === 'QA w2f stayed for the audit', `status=${r.status}`)
  row = await otRow(hrm)
  check('overtime list: the employee’s reason wins over the fix reason', row?.reason === 'QA w2f stayed for the audit' && row?.reasonSource === 'EMPLOYEE', `${row?.reason} (${row?.reasonSource})`)
  r = await mgr(`/v1/attendance/overtime/${recId}/reason`, 'PUT', { reason: 'Manager writing it' })
  check('overtime reason: someone else (the manager) is refused (403)', r.status === 403 && sql(`select overtime_reason from attendance.records where id='${recId}'`) === 'QA w2f stayed for the audit', `status=${r.status}`)
  r = await reader(`/v1/attendance/overtime/${recId}/reason`, 'PUT', { reason: 'ok' })
  check('overtime reason: too short is refused', r.status === 422 && r.json?.errorCode === 'OVERTIME_REASON_REQUIRED', `status=${r.status} ${r.json?.errorCode}`)
  sql(`insert into attendance.overtime_decisions (tenant_id, record_id, record_date, status, reviewed_minutes, decided_by, note) values ('${tenant}', '${recId}', '${D}', 'APPROVED', 75, '${HRM}', 'QA w2f decision')`)
  made.decisionFor.push(recId)
  r = await reader(`/v1/attendance/overtime/${recId}/reason`, 'PUT', { reason: 'Changing it after the decision' })
  check('overtime reason: fixed once the overtime is decided', r.status === 422 && r.json?.errorCode === 'OVERTIME_ALREADY_REVIEWED', `status=${r.status} ${r.json?.errorCode}`)
  check('overtime list: the decided row keeps its reason and shows the decision', (await otRow(hrm))?.status === 'APPROVED')

  // ── 5. face device (sent / derived) ──
  const feSent = randomUUID(), feDerived = randomUUID()
  sql(`insert into attendance.face_verification_events (id, tenant_id, employee_id, purpose, result, score_bucket, device_fingerprint, created_at) values
       ('${feSent}', '${tenant}', '${READER}', 'PUNCH_IN', 'PASS', 'HIGH', 'QA kiosk w2f', '${D} 08:00:00+05:30'),
       ('${feDerived}', '${tenant}', '${READER}', 'PUNCH_IN', 'PASS', 'HIGH', null, '${D} 08:59:30+05:30')`)
  made.faceEvents.push(feSent, feDerived)
  const faceEvents = async (who) => who(`/v1/attendance/face/admin/events?employeeId=${READER}&limit=500`)
  const fe = await faceEvents(hrm)
  const byId = new Map((fe.json || []).map((e) => [e.id, e]))
  check('face events: the device the client sent is returned', byId.get(feSent)?.device === 'QA kiosk w2f', byId.get(feSent)?.device)
  check('face events: an older check gets the device of the punch it cleared', byId.get(feDerived)?.device === 'QA derived kiosk w2f', byId.get(feDerived)?.device)
  check('face events: without the face-log permission it is 403 (manager, employee)', (await faceEvents(mgr)).status === 403 && (await faceEvents(reader)).status === 403)

  // Check-in labels the face check; check-out stores the overtime reason. Needs a free today.
  if (sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === '0') {
    const feLive = randomUUID()
    sql(`insert into attendance.face_verification_events (id, tenant_id, employee_id, purpose, result, score_bucket, created_at) values ('${feLive}', '${tenant}', '${READER}', 'PUNCH_IN', 'PASS', 'HIGH', now() - interval '1 minute')`)
    made.faceEvents.push(feLive)
    r = await reader('/v1/attendance/checkin', 'POST', { latitude: 17.385044, longitude: 78.486671, checkInMethod: 'FACE_RECOGNITION', deviceId: ' QA Pixel w2f ', clientEventId: randomUUID() })
    const todayRec = sql(`select id from attendance.records where employee_id='${READER}' and attendance_date='${today}'`)
    if (todayRec) made.records.push(todayRec)
    check('check-in: a face punch puts its device on the face check', r.status === 200 && sql(`select coalesce(device_fingerprint,'') from attendance.face_verification_events where id='${feLive}'`) === 'QA Pixel w2f', `status=${r.status} ${r.json?.errorCode || ''}`)
    check('face events: the labelled check shows its device', ((await faceEvents(hrm)).json || []).find((e) => e.id === feLive)?.device === 'QA Pixel w2f')
    r = await reader('/v1/attendance/checkout', 'POST', { latitude: 17.385044, longitude: 78.486671, checkOutMethod: 'FACE_RECOGNITION', overtimeReason: '  QA w2f\nleft late  ' })
    check('check-out: the overtime reason sent with it is stored on the day', r.status === 200 && todayRec && sql(`select coalesce(overtime_reason,'') from attendance.records where id='${todayRec}'`) === 'QA w2f left late', `status=${r.status}`)
  } else {
    skip('check-in device label and check-out reason', `the reader already has attendance on ${today}`)
  }

  // ── 2. decided shift requests ──
  const policy = sql(`select id from attendance.shift_policies where company_id='${company}' and is_active order by name limit 1`)
  const reqReader = randomUUID(), reqFin = randomUUID()
  sql(`insert into attendance.shift_change_requests (id, tenant_id, employee_id, requested_shift_policy_id, reason, status, approver_id, decision_note, decided_at, requested_effective_date, applied_effective_date) values
       ('${reqReader}', '${tenant}', '${READER}', '${policy}', 'QA w2f evening classes', 'APPROVED', '${HRM}', 'QA w2f approved note', now(), '${today}', '${today}'),
       ('${reqFin}', '${tenant}', '${FIN}', '${policy}', 'QA w2f bus timings', 'REJECTED', '${HRM}', 'QA w2f rejected note', now(), '${today}', null)`)
  made.requests.push(reqReader, reqFin)
  const decided = async (who, days = 30) => who(`/v1/shifts/change-requests/decided?days=${days}`)
  let dr = await decided(hrm)
  const a = (dr.json || []).find((x) => x.id === reqReader), b = (dr.json || []).find((x) => x.id === reqFin)
  check('decided requests: HR sees both, with who decided, when and the note', dr.status === 200 && a?.approverName === hrmName && a?.decisionNote === 'QA w2f approved note' && !!a?.decidedAt
    && b?.status === 'REJECTED' && b?.approverName === hrmName, `status=${dr.status} approver=${a?.approverName}`)
  dr = await decided(mgr)
  check('decided requests: a manager sees only their team', dr.status === 200 && (dr.json || []).some((x) => x.id === reqReader) && !(dr.json || []).some((x) => x.id === reqFin), `status=${dr.status}`)
  check('decided requests: owner and super admin see them', (await decided(owner)).status === 200 && (await decided(admin)).status === 200)
  check('decided requests: an employee is refused (403)', (await decided(reader)).status === 403)
  check('decided requests: a look-back outside 1–365 days is refused', (await decided(hrm, 0)).status === 422 && (await decided(hrm, 366)).status === 422)

  // ── 3. change-shift note + history, 4. schedule since ──
  const open = sql(`select id || '|' || shift_policy_id || '|' || effective_from from attendance.employee_shift_assignments where employee_id='${READER}' and effective_to is null`)
    .split('\n').filter(Boolean).map((l) => { const [id, pid, from] = l.split('|'); return { id, pid, from } })
  let F = istDay(60)
  for (const o of open) if (o.from >= F) F = new Date(new Date(o.from + 'T12:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)
  const latestOpen = open.sort((x, y) => (x.from < y.from ? 1 : -1))[0]
  const target = sql(`select id from attendance.shift_policies where company_id='${company}' and is_active ${latestOpen ? `and id <> '${latestOpen.pid}'` : ''} order by name limit 1`)
  r = await mgr(`/v1/shifts/employee/${READER}`, 'POST', { shiftPolicyId: target, effectiveFrom: F, note: 'Manager should not' })
  check('assign: a manager without workforce admin is refused (403)', r.status === 403 && sql(`select count(*) from attendance.employee_shift_assignments where employee_id='${READER}' and effective_from='${F}'`) === '0', `status=${r.status}`)
  made.reopen = open.map((o) => o.id)
  r = await hrm(`/v1/shifts/employee/${READER}`, 'POST', { shiftPolicyId: target, effectiveFrom: F, note: '  QA w2f swapped\nwith Vikram  ' })
  const newRow = sql(`select id || '|' || coalesce(note,'') || '|' || coalesce(created_by,'') from attendance.employee_shift_assignments where employee_id='${READER}' and effective_from='${F}'`)
  const [newId, newNote, createdBy] = newRow.split('|')
  if (newId) made.assignment = newId
  check('assign: the Change-shift note is saved with the assignment', r.status === 200 && newNote === 'QA w2f swapped with Vikram' && createdBy === HRM, `status=${r.status} note=${newNote} by=${createdBy}`)

  const hist = async (who, emp) => who(`/v1/shifts/employee/${emp}/history`)
  let h = await hist(hrm, READER)
  const item = (h.json || []).find((x) => x.id === newId)
  check('history: HR sees the assignment with its note, who set it and the dates', h.status === 200 && item?.note === 'QA w2f swapped with Vikram' && item?.setBy === hrmName && item?.effectiveFrom === F && item?.shiftPolicyId === target,
    `status=${h.status} setBy=${item?.setBy}`)
  check('history: newest first', h.status === 200 && (h.json || [])[0]?.id === newId)
  check('history: owner sees it', (await hist(owner, READER)).status === 200)
  check('history: the employee sees their own', (await hist(reader, READER)).status === 200)
  check('history: the employee is refused someone else’s (403)', (await hist(reader, FIN)).status === 403)
  check('history: a manager sees their team member’s', (await hist(mgr, READER)).status === 200)
  check('history: a manager is refused outside their team (403)', (await hist(mgr, FIN)).status === 403)

  const sched = await hrm(`/v1/team/schedule?from=${F}&to=${F}`)
  const sr = (sched.json || []).find((x) => x.employeeId === READER)
  const joined = sql(`select coalesce(to_char(date_of_joining,'YYYY-MM-DD'),'') from hrms.employees where id='${READER}'`)
  check('schedule: returns the shift id, since (assignment start) and joining date', sched.status === 200 && sr?.shiftPolicyId === target && sr?.since === F && (sr?.joinedOn || '') === joined,
    `shift=${sr?.shiftPolicyId === target} since=${sr?.since} joined=${sr?.joinedOn}`)
  const noShift = (sched.json || []).find((x) => !x.shiftPolicyId)
  check('schedule: people with no shift have no since', !noShift || noShift.since == null)
  check('schedule: an employee is refused (403)', (await reader(`/v1/team/schedule?from=${F}&to=${F}`)).status === 403)

  // ── 6-7. trend ──
  const tr = await hrm(`/v1/attendance/dashboard/trend?from=${D}&to=${today}`)
  const rows = tr.json || []
  const dRow = rows.find((x) => x.date === D)
  check('trend: every day has the per-day totals and weekly-off fields', tr.status === 200 && rows.length > 0 && rows.every((x) => ['checkedIn', 'workFromHomeOnTime', 'scheduled', 'weeklyOff', 'weeklyOffDay'].every((k) => k in x)))
  check('trend: a WFH + late person is counted once (buckets add up to checkedIn)', !!dRow && dRow.checkedIn >= 1 && dRow.workFromHome - dRow.workFromHomeOnTime >= 1
    && dRow.present + dRow.late + dRow.halfDay + dRow.workFromHomeOnTime === dRow.checkedIn,
  dRow ? `checkedIn=${dRow.checkedIn} present=${dRow.present} late=${dRow.late} halfDay=${dRow.halfDay} wfh=${dRow.workFromHome} wfhOnTime=${dRow.workFromHomeOnTime}` : 'no row')
  check('trend: weeklyOffDay means nobody scheduled and someone off', rows.every((x) => x.weeklyOffDay === (x.scheduled === 0 && x.weeklyOff > 0)))
  const offDow = new Set(rows.filter((x) => x.weeklyOffDay).map((x) => new Date(x.date + 'T12:00:00Z').getUTCDay()))
  console.log(`      weekly-off weekdays in the window: ${[...offDow].map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'none'}`)
  check('trend: an employee is refused (403)', (await reader(`/v1/attendance/dashboard/trend?from=${D}&to=${today}`)).status === 403)
  check('trend: finance lead (team read) is allowed', (await fin(`/v1/attendance/dashboard/trend?from=${D}&to=${today}`)).status === 200)
} catch (e) {
  check('run completed without an error', false, String(e?.message || e))
} finally {
  // ── cleanup: everything created, and the reader's assignments as they were ──
  const ids = (xs) => xs.map((x) => `'${x}'`).join(',')
  try {
    if (made.decisionFor.length) sql(`delete from attendance.overtime_decisions where record_id in (${ids(made.decisionFor)})`)
    if (made.faceEvents.length) sql(`delete from attendance.face_verification_events where id in (${ids(made.faceEvents)})`)
    if (made.records.length) {
      sql(`delete from attendance.event_logs where record_id in (${ids(made.records)})`)
      sql(`delete from attendance.records where id in (${ids(made.records)})`)
    }
    if (made.requests.length) sql(`delete from attendance.shift_change_requests where id in (${ids(made.requests)})`)
    if (made.assignment) {
      sql(`delete from attendance.employee_shift_assignments where id='${made.assignment}'`)
      if (made.reopen.length) sql(`update attendance.employee_shift_assignments set effective_to = null where id in (${ids(made.reopen)})`)
    }
    const left = sql(`select (select count(*) from attendance.records where id in (${ids(made.records.length ? made.records : [randomUUID()])}))
      + (select count(*) from attendance.face_verification_events where id in (${ids(made.faceEvents.length ? made.faceEvents : [randomUUID()])}))
      + (select count(*) from attendance.shift_change_requests where id in (${ids(made.requests.length ? made.requests : [randomUUID()])}))`)
    check('cleanup: nothing the test created is left', left === '0', `${left} rows left`)
  } catch (e) {
    check('cleanup', false, String(e?.message || e))
  }
  const passed = results.filter((x) => x.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
