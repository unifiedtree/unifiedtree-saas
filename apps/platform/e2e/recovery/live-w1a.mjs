// Live API check for w1a (V143.10): attendance timing policy, effective day
// status everywhere, the review list + manual status changes, face punch
// review, regularization proof, and the per-company geofence / WFH rules.
// No browser. Runs against a LOCAL backend and the local recovery database,
// and removes everything it creates (fixture employees, records, reviews,
// notifications, audit rows, face events, corrections) and restores every
// setting it changes.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w1a.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444'
const psqlBin = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const sql = (q) => execFileSync(psqlBin, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => console.log(`SKIP  ${name}  — ${why}`)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  const call = async (path, method = 'GET', body, raw) => {
    const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
    if (!raw) headers['Content-Type'] = 'application/json'
    const res = await fetch(api + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

// ── dates (India business dates) ──
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay() // 0 = Sun
const ist = (iso, hh, mm) => `${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`
const TODAY = istToday()
// Monday..Thursday of last week (all over, all weekdays) — shifted back while one is a company holiday.
let monday = addDays(TODAY, -((dow(TODAY) + 6) % 7) - 7)
for (let i = 0; i < 6; i++) {
  const days = [0, 1, 2, 3].map((k) => addDays(monday, k))
  const hol = sql(`select count(*) from settings.holiday_calendar where company_id='${company}' and is_active and holiday_date in (${days.map((d) => `'${d}'`).join(',')})`)
  if (hol === '0') break
  monday = addDays(monday, -7)
}
const [D1, D2, D3, D4] = [0, 1, 2, 3].map((k) => addDays(monday, k))
const stamp = Date.now()
const startedAt = new Date().toISOString()

const E = randomUUID(), F = randomUUID()
const created = { records: [], corrections: [], faceEvent: null, wfh: [], checkinRecord: null }
const restore = {}
let adminGrant = null

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── permissions from V143.10 ──
  check('hrm holds policy.manage, status.review, status.override', ['attendance.policy.manage', 'attendance.status.review', 'attendance.status.override'].every((p) => hrm.perms.includes(p)))
  check('owner holds all three new permissions', ['attendance.policy.manage', 'attendance.status.review', 'attendance.status.override'].every((p) => owner.perms.includes(p)))
  check('department manager holds review + override, not policy', mgr.perms.includes('attendance.status.review') && mgr.perms.includes('attendance.status.override') && !mgr.perms.includes('attendance.policy.manage'))
  check('employee and finance hold none of them', ['attendance.policy.manage', 'attendance.status.review', 'attendance.status.override'].every((p) => !reader.perms.includes(p) && !fin.perms.includes(p)))

  // ── policy ──
  const pol0 = await owner.call(`/v1/attendance/policy?companyId=${company}`)
  check('GET policy (owner) returns the company policy and it is stored', pol0.status === 200 && sql(`select count(*) from attendance.timing_policies where company_id='${company}'`) === '1', `status=${pol0.status}`)
  restore.policy = pol0.json
  restore.hrcfg = sql(`select coalesce(late_grace_minutes::text,'null')||'|'||enable_late_auto_deduction||'|'||allow_work_from_home||'|'||enforce_geofencing_for_mobile from settings.hr_configuration where company_id='${company}'`)
  const readerPol = await reader.call(`/v1/attendance/policy?companyId=${company}`)
  check('GET policy (employee) is allowed: it is the rule their day is judged by', readerPol.status === 200)
  const body = { graceMinutes: 15, defaultStartTime: '09:15', halfDayLateMinutes: null, fullDayMinHours: null, halfDayMinHours: null, earlyLeaveMinutes: 0, lateAllowanceCount: 1, lateAllowancePeriod: 'WEEK', afterAllowanceAction: 'HALF_DAY' }
  for (const [who, c] of [['manager', mgr], ['employee', reader], ['finance', fin]]) {
    const r = await c.call(`/v1/attendance/policy?companyId=${company}`, 'PUT', body)
    check(`PUT policy refused for ${who}`, r.status === 403, `status=${r.status}`)
  }
  const bad = await hrm.call(`/v1/attendance/policy?companyId=${company}`, 'PUT', { ...body, halfDayLateMinutes: 10 })
  check('PUT policy refuses a half-day limit inside the grace (422, plain message)', bad.status === 422 && /more than the grace/.test(bad.json?.message || ''), `status=${bad.status} ${bad.json?.message || ''}`)
  const put = await hrm.call(`/v1/attendance/policy?companyId=${company}`, 'PUT', { ...body, graceMinutes: 20 })
  check('PUT policy (HR) saves the policy', put.status === 200 && put.json?.lateAllowanceCount === 1 && put.json?.afterAllowanceAction === 'HALF_DAY', `status=${put.status}`)
  check('policy row in the DB has the new values and who changed it', sql(`select late_allowance_count||'|'||late_allowance_period||'|'||after_allowance_action||'|'||coalesce(updated_by_name,'') from attendance.timing_policies where company_id='${company}'`).startsWith('1|WEEK|HALF_DAY|'))
  check('grace is written to HR Configuration (one grace per company)', sql(`select late_grace_minutes from settings.hr_configuration where company_id='${company}'`) === '20')
  await hrm.call(`/v1/attendance/policy?companyId=${company}`, 'PUT', body) // grace back to 15 for the scenario

  // ── fixtures: E in the manager's team, F outside it ──
  sql(`insert into hrms.employees (id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, employment_status, date_of_joining, weekly_off_days, reporting_manager_id)
       values ('${E}','${tenant}','${company}','W1A-E-${stamp}','W1a','Team','FULL_TIME','ACTIVE','2024-01-01','6,7','${MGR}'),
              ('${F}','${tenant}','${company}','W1A-F-${stamp}','W1a','Other','FULL_TIME','ACTIVE','2024-01-01','6,7',null)`)
  const rec = (emp, day, inH, inM, outH, outM) => {
    const id = randomUUID()
    sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, check_in_at, check_out_at, attendance_status, attendance_type, check_in_method)
         values ('${id}','${tenant}','${emp}','${company}','${day}','${ist(day, inH, inM)}',${outH == null ? 'null' : `'${ist(day, outH, outM)}'`},'${inH * 60 + inM > 570 ? 'LATE' : 'ON_TIME'}','OFFICE','GPS')`)
    created.records.push(id)
    return id
  }
  rec(E, D1, 10, 0, 18, 0) // 45 min after 09:15 → late, first in the week → allowance
  const e2 = rec(E, D2, 10, 0, 18, 0) // second late → half day (allowance used)
  rec(E, D4, 9, 0, 18, 0) // on time

  // ── effective status ──
  const day = async (c, emp, d) => (await c.call(`/v1/attendance/review/day?employeeId=${emp}&date=${d}`)).json
  const d1 = await day(hrm, E, D1), d2 = await day(hrm, E, D2), d3 = await day(hrm, E, D3), d4 = await day(hrm, E, D4)
  check('day 1: late within the weekly allowance counts as present', d1?.status === 'PRESENT' && d1?.withinAllowance === true, JSON.stringify({ s: d1?.status, n: d1?.note }))
  check('day 2: late after the allowance counts as a half day', d2?.status === 'HALF_DAY' && d2?.payableFraction === 0.5, JSON.stringify({ s: d2?.status, n: d2?.note }))
  check('day 3: no punch, no leave, day over → absent', d3?.status === 'ABSENT', d3?.status)
  check('day 4: on time → present', d4?.status === 'PRESENT' && !d4?.lateMinutes, d4?.status)
  const readerDay = await reader.call(`/v1/attendance/review/day?employeeId=${E}&date=${D2}`)
  check('an employee cannot read someone else’s day', readerDay.status === 403, `status=${readerDay.status}`)

  const roster = await hrm.call(`/v1/attendance/dashboard?date=${D2}`)
  const row = (roster.json?.staffStatuses || []).find((s) => s.employeeId === E)
  check('roster: the row carries the effective status and the mobile word', row?.effectiveStatus === 'HALF_DAY' && row?.status === 'HALF_DAY' && !!row?.statusNote, JSON.stringify({ e: row?.effectiveStatus, s: row?.status }))
  check('roster tiles count the half day', (roster.json?.counts?.halfDay ?? 0) >= 1)
  const trend = await hrm.call(`/v1/attendance/dashboard/trend?from=${D1}&to=${D4}`)
  const t3 = (trend.json || []).find((x) => x.date === D3)
  check('trend: 4 days and day 3 counts an absence', trend.status === 200 && trend.json.length === 4 && (t3?.absent ?? 0) >= 1, `status=${trend.status}`)
  const week = await owner.call(`/v1/attendance/employee/${E}/weekly-summary?weekStart=${D1}`)
  const wd = (week.json?.days || [])
  check('weekly summary uses the policy (Mon on time via allowance, Tue half day, Wed absent)', wd.find((x) => x.date === D1)?.status === 'ON_TIME' && wd.find((x) => x.date === D2)?.status === 'HALF_DAY' && wd.find((x) => x.date === D3)?.status === 'ABSENT', wd.map((x) => x.status).join(','))

  // ── review list ──
  const exH = await hrm.call(`/v1/attendance/review/exceptions?from=${D1}&to=${D4}`)
  const mine = (exH.json || []).filter((x) => x.employeeId === E)
  check('review list (HR): day 2 half day and day 3 absent; not the allowance day or the on-time day', exH.status === 200 && mine.some((x) => x.date === D2 && x.flags.includes('HALF_DAY')) && mine.some((x) => x.date === D3 && x.flags.includes('ABSENT')) && !mine.some((x) => x.date === D1 || x.date === D4), mine.map((x) => x.date + ':' + x.flags).join(' '))
  check('review list (HR): includes the person outside the manager’s team', (exH.json || []).some((x) => x.employeeId === F))
  const exM = await mgr.call(`/v1/attendance/review/exceptions?from=${D1}&to=${D4}`)
  check('review list (manager): their team only', exM.status === 200 && (exM.json || []).some((x) => x.employeeId === E) && !(exM.json || []).some((x) => x.employeeId === F))
  for (const [who, c] of [['employee', reader], ['finance', fin]]) {
    const r = await c.call(`/v1/attendance/review/exceptions?from=${D1}&to=${D4}`)
    check(`review list refused for ${who}`, r.status === 403, `status=${r.status}`)
  }

  // ── manual status changes ──
  const noReason = await mgr.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: D3, status: 'EXCUSE', reason: '' })
  check('status change needs a reason (422)', noReason.status === 422, `status=${noReason.status}`)
  const future = await hrm.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: addDays(TODAY, 2), status: 'PRESENT', reason: 'Future test' })
  check('status change refuses a future day (422)', future.status === 422, `status=${future.status}`)
  const selfChange = await hrm.call('/v1/attendance/review/status', 'POST', { employeeId: HRM, date: D3, status: 'PRESENT', reason: 'Own day test' })
  check('nobody changes their own day (403)', selfChange.status === 403, `status=${selfChange.status}`)
  const outOfTeam = await mgr.call('/v1/attendance/review/status', 'POST', { employeeId: F, date: D3, status: 'EXCUSE', reason: 'Not my team test' })
  check('manager cannot change someone outside their team (403)', outOfTeam.status === 403, `status=${outOfTeam.status}`)
  const byReader = await reader.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: D3, status: 'EXCUSE', reason: 'Employee test' })
  check('employee cannot change a day (403)', byReader.status === 403, `status=${byReader.status}`)

  const excuse = await mgr.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: D3, status: 'EXCUSE', reason: 'Hospital visit, approved' })
  check('manager excuses their team member’s absence → present', excuse.status === 200 && excuse.json?.status === 'PRESENT' && excuse.json?.manual === true, `status=${excuse.status} ${excuse.json?.status}`)
  check('the change is audited: who, from → to, reason', sql(`select action||'|'||from_status||'|'||to_status||'|'||reason||'|'||(reviewer_employee_id='${MGR}') from attendance.day_status_reviews where employee_id='${E}' and attendance_date='${D3}' order by created_at desc limit 1`) === 'EXCUSE|ABSENT|PRESENT|Hospital visit, approved|true')
  check('the employee is notified', sql(`select count(*) from notif.notifications where user_id='${E}' and type='ATTENDANCE_STATUS_CHANGED' and created_at >= '${startedAt}'`) !== '0')
  check('an audit event is written', sql(`select count(*) from audit.events where entity_id='${E}' and module='attendance' and action='DAY_STATUS_EXCUSE' and occurred_at >= '${startedAt}'`) !== '0')
  const exAfter = await hrm.call(`/v1/attendance/review/exceptions?from=${D1}&to=${D4}`)
  check('an excused day leaves the review list', !(exAfter.json || []).some((x) => x.employeeId === E && x.date === D3))

  const setAbsent = await hrm.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: D2, status: 'ABSENT', reason: 'Left without telling anyone' })
  check('HR sets a worked day to absent', setAbsent.status === 200 && setAbsent.json?.status === 'ABSENT', `status=${setAbsent.status}`)
  check('the record payroll reads now says ABSENT', sql(`select attendance_status from attendance.records where id='${e2}' and attendance_date='${D2}'`) === 'ABSENT')
  const clear = await hrm.call('/v1/attendance/review/status', 'POST', { employeeId: E, date: D2, status: 'CLEAR', reason: 'Mistake, undo' })
  check('removing the manual status lets the rules decide again (half day)', clear.status === 200 && clear.json?.status === 'HALF_DAY' && clear.json?.manual === false, `status=${clear.status} ${clear.json?.status}`)
  check('the record goes back to the punch’s own status (LATE)', sql(`select attendance_status from attendance.records where id='${e2}' and attendance_date='${D2}'`) === 'LATE')

  const hist = await hrm.call(`/v1/attendance/review/history?employeeId=${E}`)
  check('history lists the three changes with names', hist.status === 200 && (hist.json || []).length === 3 && hist.json.every((h) => h.reviewerName), `rows=${hist.json?.length}`)
  const histReader = await reader.call(`/v1/attendance/review/history?employeeId=${E}`)
  check('history refused for someone else’s employee (403)', histReader.status === 403, `status=${histReader.status}`)
  const histMgrF = await mgr.call(`/v1/attendance/review/history?employeeId=${F}`)
  check('manager cannot read history outside their team (403)', histMgrF.status === 403, `status=${histMgrF.status}`)
  const ownHist = await reader.call(`/v1/attendance/review/history?employeeId=${READER}`)
  check('an employee reads their own history', ownHist.status === 200)

  // ── face punch review (reader is in the manager's team) ──
  const readerDays = [D4, addDays(monday, 4), D1, D2, D3].filter((d) => sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${d}'`) === '0')
  if (readerDays.length) {
    const FD = readerDays[0]
    const rr = rec(READER, FD, 9, 0, 17, 0)
    const ev = randomUUID()
    sql(`insert into attendance.face_verification_events (id, tenant_id, employee_id, purpose, result, match_score, score_bucket, created_at)
         values ('${ev}','${tenant}','${READER}','PUNCH_IN','PASS',0.850,'MEDIUM','${ist(FD, 8, 59)}')`)
    created.faceEvent = ev
    const fe = await hrm.call(`/v1/attendance/review/face-events?from=${FD}&to=${FD}`)
    const it = (fe.json || []).find((x) => x.id === ev)
    check('face list: a medium match needs a look, with the person’s name', it?.status === 'REVIEW' && /Reader/.test(it?.employeeName || ''), JSON.stringify({ s: it?.status, n: it?.employeeName }))
    const feReader = await reader.call(`/v1/attendance/review/face-events?from=${FD}&to=${FD}`)
    check('face list refused for an employee (403)', feReader.status === 403, `status=${feReader.status}`)
    const confirm = await mgr.call(`/v1/attendance/review/face-events/${ev}/decision`, 'POST', { decision: 'CONFIRMED' })
    check('manager confirms: "Yes, it’s them" is recorded', confirm.status === 200 && confirm.json?.event?.status === 'CONFIRMED' && sql(`select decision||'|'||(reviewer_employee_id='${MGR}') from attendance.face_event_reviews where event_id='${ev}' order by created_at desc limit 1`) === 'CONFIRMED|true', `status=${confirm.status}`)
    const noNote = await hrm.call(`/v1/attendance/review/face-events/${ev}/decision`, 'POST', { decision: 'REJECTED' })
    check('"Not them" needs a note (422)', noNote.status === 422, `status=${noNote.status}`)
    const byEmp = await reader.call(`/v1/attendance/review/face-events/${ev}/decision`, 'POST', { decision: 'REJECTED', note: 'self test' })
    check('employee cannot decide a face punch (403)', byEmp.status === 403, `status=${byEmp.status}`)
    const reject = await hrm.call(`/v1/attendance/review/face-events/${ev}/decision`, 'POST', { decision: 'REJECTED', note: 'A colleague punched in on their phone' })
    check('HR rejects the punch: the day no longer counts (absent)', reject.status === 200 && reject.json?.event?.status === 'FLAGGED' && reject.json?.day?.status === 'ABSENT', `status=${reject.status} ${reject.json?.day?.status}`)
    check('the record payroll reads says ABSENT after the rejection', sql(`select attendance_status from attendance.records where id='${rr}' and attendance_date='${FD}'`) === 'ABSENT')
    check('the rejection is in the day’s audit trail', sql(`select count(*) from attendance.day_status_reviews where employee_id='${READER}' and attendance_date='${FD}' and action='FACE_REJECT' and face_event_id='${ev}'`) === '1')
    const ym = FD.slice(0, 7).split('-')
    const hist2 = await reader.call(`/v1/attendance/history?year=${Number(ym[0])}&month=${Number(ym[1])}`)
    const hd = (hist2.json || []).find((x) => x.date === FD)
    check('the employee’s own month shows the rejected day as absent with the reason', hd?.status === 'ABSENT' && /rejected/i.test(hd?.note || ''), JSON.stringify(hd))
    const stats = await reader.call(`/v1/attendance/monthly-stats?year=${Number(ym[0])}&month=${Number(ym[1])}`)
    check('monthly stats answer (policy-based)', stats.status === 200 && typeof stats.json?.absentDays === 'number')
  } else skip('face punch review', 'the reader has records on every candidate day')

  // ── regularization proof ──
  const pdf = new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], { type: 'application/pdf' })
  const fd = new FormData(); fd.append('file', pdf, 'gate log.pdf')
  const up = await reader.call('/v1/attendance/corrections/attachments', 'POST', fd, true)
  check('proof upload: stored (201) or a clear "storage isn’t set up" (503) locally', up.status === 201 ? /^r2:\/\/attendance-proofs\//.test(up.json?.attachmentUrl || '') : up.status === 503 && /storage/i.test(up.json?.message || ''), `status=${up.status} ${up.json?.message || up.json?.attachmentUrl || ''}`)
  const txt = new FormData(); txt.append('file', new Blob([Buffer.from('hello, not a pdf')], { type: 'text/plain' }), 'note.txt')
  const upBad = await reader.call('/v1/attendance/corrections/attachments', 'POST', txt, true)
  check('proof upload refuses a file that isn’t a PDF or image (400)', upBad.status === 400, `status=${upBad.status}`)
  const own = up.status === 201 ? up.json.attachmentUrl : `r2://attendance-proofs/${tenant}/${READER}/${randomUUID()}/gate-log.pdf`
  const fixDay = addDays(TODAY, -2)
  const foreign = await reader.call('/v1/attendance/corrections', 'POST', { requestedDate: fixDay, requestedCheckInAt: ist(fixDay, 9, 0), requestedCheckOutAt: ist(fixDay, 18, 0), reason: `w1a proof ${stamp}`, attachmentUrl: `r2://attendance-proofs/${tenant}/${MGR}/x/other.pdf` })
  check('a fix request cannot point at someone else’s file (422)', foreign.status === 422, `status=${foreign.status}`)
  const corr = await reader.call('/v1/attendance/corrections', 'POST', { requestedDate: fixDay, requestedCheckInAt: ist(fixDay, 9, 0), requestedCheckOutAt: ist(fixDay, 18, 0), reason: `w1a proof ${stamp}`, attachmentUrl: own })
  if (corr.json?.id) created.corrections.push(corr.json.id)
  check('a fix request saves the proof link', corr.status === 200 && sql(`select attachment_url from attendance.regularization_requests where id='${corr.json?.id}'`) === own, `status=${corr.status}`)
  if (corr.json?.id) {
    const link = await mgr.call(`/v1/attendance/corrections/${corr.json.id}/attachment`)
    check('the approver gets a signed link (or 503 when storage is off locally)', link.status === 200 ? /^https?:\/\//.test(link.json?.url || '') : link.status === 503, `status=${link.status}`)
    const linkFin = await fin.call(`/v1/attendance/corrections/${corr.json.id}/attachment`)
    check('someone who is neither the requester nor an approver is refused (403)', linkFin.status === 403, `status=${linkFin.status}`)
    const approvals = await mgr.call('/v1/attendance/corrections/approvals?status=PENDING&size=100')
    check('the approver’s list carries the proof link for "View attachment"', (approvals.json?.content || []).some((c) => c.id === corr.json.id && c.attachmentUrl === own))
  }

  // ── company rule: work from home ──
  const wfhWas = restore.hrcfg.split('|')[2] === 't'
  const off = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { allowWorkFromHome: false })
  check('owner turns work from home off', off.status === 200 && sql(`select allow_work_from_home from settings.hr_configuration where company_id='${company}'`) === 'f', `status=${off.status}`)
  const tomorrow = addDays(TODAY, 1)
  const wfh = await reader.call('/v1/wfh', 'POST', { fromDate: tomorrow, toDate: tomorrow, reason: `w1a ${stamp}` })
  if (wfh.json?.id) created.wfh.push(wfh.json.id)
  check('WFH request refused with a clear message when the company turned it off', wfh.status === 422 && /turned off/.test(wfh.json?.message || ''), `status=${wfh.status} ${wfh.json?.message || ''}`)
  await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { allowWorkFromHome: wfhWas })
  check('work from home setting restored', sql(`select allow_work_from_home from settings.hr_configuration where company_id='${company}'`) === (wfhWas ? 't' : 'f'))

  // ── company rule: geofence on mobile (accepted outside the zone → flagged for review) ──
  const branch = sql(`select id||'|'||coalesce(latitude::text,'')||'|'||coalesce(longitude::text,'') from org.branches where company_id='${company}' and is_active order by is_headquarters desc, name limit 1`)
  const readerToday = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${TODAY}'`)
  if (branch && readerToday === '0') {
    const [bid, blat, blon] = branch.split('|')
    restore.branch = { id: bid, lat: blat, lon: blon }
    sql(`update org.branches set latitude=17.385000, longitude=78.486700 where id='${bid}'`)
    // The local backend runs canonical-prod, where the server-wide switch is on.
    await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { enforceGeofencingForMobile: true })
    const blocked = await reader.call('/v1/attendance/checkin', 'POST', { latitude: 12.9716, longitude: 77.5946, checkInMethod: 'GPS', clientEventId: `w1a-blocked-${stamp}` })
    if (blocked.json?.id) created.records.push(blocked.json.id)
    check('check-in outside the zone is refused when the company requires geofencing', blocked.status === 422 && /inside your office zone/.test(blocked.json?.message || ''), `status=${blocked.status} ${blocked.json?.message || ''}`)
    await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { enforceGeofencingForMobile: false })
    const ci = await reader.call('/v1/attendance/checkin', 'POST', { latitude: 12.9716, longitude: 77.5946, checkInMethod: 'GPS', clientEventId: `w1a-${stamp}` })
    if (ci.json?.id) created.checkinRecord = ci.json.id
    check('check-in outside the zone is accepted when the company doesn’t require geofencing', ci.status === 200, `status=${ci.status} ${ci.json?.message || ''}`)
    check('…and flagged with its distance for review', ci.json?.id && sql(`select check_in_outside_geofence||'|'||(check_in_distance_m > 1000) from attendance.records where id='${ci.json.id}'`) === 't|t')
    const exToday = await mgr.call(`/v1/attendance/review/exceptions?from=${TODAY}&to=${TODAY}`)
    check('…and listed as "outside the zone" for the manager', (exToday.json || []).some((x) => x.employeeId === READER && x.flags.includes('OUTSIDE_ZONE')))
  } else skip('geofence flag', branch ? 'the reader already checked in today' : 'no active branch')

  // ── ADMIN role (granted to the finance lead for this run) ──
  const finUser = sql(`select id from auth.user_credentials where lower(email)='fin@unifiedtree.demo'`)
  const adminRole = sql(`select id from rbac.roles where code='ADMIN' and tenant_id is null`)
  if (finUser && adminRole) {
    sql(`insert into rbac.user_roles (tenant_id, user_id, role_id, granted_at) values ('${tenant}','${finUser}','${adminRole}', now()) on conflict do nothing`)
    adminGrant = { user: finUser, role: adminRole }
    const admin = await login('fin@unifiedtree.demo')
    check('ADMIN holds the three new permissions', ['attendance.policy.manage', 'attendance.status.review', 'attendance.status.override'].every((p) => admin.perms.includes(p)))
    const cfg = await admin.call(`/v1/settings/hr-configuration?companyId=${company}`)
    check('ADMIN can open HR Configuration (to edit the attendance policy)', cfg.status === 200, `status=${cfg.status}`)
    const ex = await admin.call(`/v1/attendance/review/exceptions?from=${D1}&to=${D4}`)
    check('ADMIN sees the company-wide review list', ex.status === 200 && (ex.json || []).some((x) => x.employeeId === F))
  } else skip('ADMIN role', 'finance user or ADMIN role not found')
} catch (e) {
  check('run completed without an exception', false, String(e?.stack || e))
} finally {
  // ── cleanup: remove everything created, restore every setting ──
  const ids = [E, F, READER].map((x) => `'${x}'`).join(',')
  const safe = (q) => { try { sql(q) } catch (e) { console.log('cleanup warning:', String(e.message || e).split('\n')[0]) } }
  if (adminGrant) safe(`delete from rbac.user_roles where user_id='${adminGrant.user}' and role_id='${adminGrant.role}'`)
  safe(`delete from attendance.day_status_reviews where employee_id in (${ids}) and created_at >= '${startedAt}'`)
  if (created.faceEvent) { safe(`delete from attendance.face_event_reviews where event_id='${created.faceEvent}'`); safe(`delete from attendance.face_verification_events where id='${created.faceEvent}'`) }
  if (created.checkinRecord) { safe(`delete from attendance.event_logs where record_id='${created.checkinRecord}'`); created.records.push(created.checkinRecord) }
  if (created.records.length) safe(`delete from attendance.records where id in (${created.records.map((x) => `'${x}'`).join(',')})`)
  safe(`delete from public.geo_fence_audits where employee_id='${READER}' and created_at >= '${startedAt}'`)
  if (created.corrections.length) safe(`delete from attendance.regularization_requests where id in (${created.corrections.map((x) => `'${x}'`).join(',')})`)
  if (created.wfh.length) safe(`delete from leave_mgmt.wfh_requests where id in (${created.wfh.map((x) => `'${x}'`).join(',')})`)
  safe(`delete from notif.notifications where user_id in (${ids}) and created_at >= '${startedAt}' and type in ('ATTENDANCE_STATUS_CHANGED','CORRECTION_SUBMITTED')`)
  safe(`delete from notif.notifications where created_at >= '${startedAt}' and type='CORRECTION_SUBMITTED' and data->>'correctionId' in (${created.corrections.map((x) => `'${x}'`).join(',') || "''"})`)
  safe(`delete from audit.events where entity_id in (${ids}, '${company}') and module='attendance' and occurred_at >= '${startedAt}'`)
  safe(`delete from hrms.employees where id in ('${E}','${F}')`)
  if (restore.branch) safe(`update org.branches set latitude=${restore.branch.lat || 'null'}, longitude=${restore.branch.lon || 'null'} where id='${restore.branch.id}'`)
  if (restore.policy) {
    const p = restore.policy
    safe(`update attendance.timing_policies set default_start_time='${p.defaultStartTime}', half_day_late_minutes=${p.halfDayLateMinutes ?? 'null'}, full_day_min_hours=${p.fullDayMinHours ?? 'null'},
          half_day_min_hours=${p.halfDayMinHours ?? 'null'}, early_leave_minutes=${p.earlyLeaveMinutes}, late_allowance_count=${p.lateAllowanceCount},
          late_allowance_period='${p.lateAllowancePeriod}', after_allowance_action='${p.afterAllowanceAction}',
          updated_by_name=${p.updatedByName ? `'${String(p.updatedByName).replace(/'/g, "''")}'` : 'null'} where company_id='${company}'`)
  }
  if (restore.hrcfg) {
    const [g, auto, wfhOn, geo] = restore.hrcfg.split('|')
    safe(`update settings.hr_configuration set late_grace_minutes=${g}, enable_late_auto_deduction=${auto === 't'}, allow_work_from_home=${wfhOn === 't'}, enforce_geofencing_for_mobile=${geo === 't'} where company_id='${company}'`)
  }
  const left = sql(`select (select count(*) from hrms.employees where id in ('${E}','${F}')) + (select count(*) from attendance.day_status_reviews where employee_id in (${ids}) and created_at >= '${startedAt}')`)
  check('cleanup: fixtures and review rows removed', left === '0', `left=${left}`)
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
