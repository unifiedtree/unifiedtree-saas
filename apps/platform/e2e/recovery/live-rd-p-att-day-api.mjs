// Live API check for P-ATT-DAY's backend half (HRMS redesign; V143_53, V143_65).
// API only (the pages come in the UI half). Against a running backend and its
// database, with every migration applied:
//  - the migrations: the "Allow web check-in" column (on by default), WEB in both method
//    checks on the partitioned records, the punch-rules and timesheet tables,
//    hrms.timesheet.approve seeded and granted to exactly OWNER, SUPER_ADMIN,
//    HR_MANAGER and DEPT_MANAGER
//  - web check-in: on by default; who may switch it (403s); refused while off,
//    without a location or without a face photo; the face scan (a stand-in face
//    worker on :8091, as live-w3-punch): not enrolled, a stranger's face, then
//    reader@ enrols from the web and punches in and out with a matching face
//    (both in the face log, from the browser); a break, check-out (the open break
//    ends with it, worked hours stay check-in to check-out), undo check-out, the
//    10-minute window; one person's face punches for the month calendar;
//    switched off, web punches are refused again
//  - "Anywhere" per person: who may set it, and the phone's pre-punch zone check
//  - bulk "Mark attendance", recent manual entries, the day register CSV (and
//    its export-log row), one employee's month, the roster/review/fix fields
//  - bug E28: approving a fix on a work-from-home day keeps it work from home
//  - the timesheet: a project, Submit week, the lock, who sees and decides weeks
//    (and never their own), reject opens the week again, approve locks it, and
//    both notifications
//  - FEATURE_NOT_READY: with each new table (or the new column) renamed away the
//    new parts answer 503 FEATURE_NOT_READY and the old ones keep working;
//    anywhere else a FEATURE_NOT_READY fails the run
// Everything it creates is removed at the end.
//
//   RECOVERY_API_URL=http://127.0.0.1:8080/api RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-att-day-api.mjs
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333'
const FIN = '55555555-5555-5555-5555-555555555555'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Any FEATURE_NOT_READY outside the deliberate rename step is a bug (all migrations are applied here).
let renaming = false
const unexpectedNotReady = []

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (json && json.errorCode === 'FEATURE_NOT_READY' && !renaming) unexpectedNotReady.push(`${method} ${path}`)
    return { status: res.status, json, text, headers: res.headers }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const code = (r) => (r.json && r.json.errorCode) || ''

// ── a stand-in face worker on :8091 (as live-w3-punch): one face in every photo; a photo starting with MATCH matches ──
const b64 = (s) => Buffer.from(s).toString('base64')
const MATCH_PHOTO = b64('MATCH-photo-of-reader-' + Date.now())
const STRANGER_PHOTO = b64('STRANGER-photo-' + Date.now())
const embedding = (() => { const f = new Float32Array(128); for (let i = 0; i < 128; i++) f[i] = Math.sin(i + 1) / 8; return Buffer.from(f.buffer).toString('base64') })()
const worker = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/health') return json({ status: 'ok', models_loaded: true })
    let b = {}; try { b = JSON.parse(body || '{}') } catch { /* empty */ }
    const face = { face_detected: true, exactly_one_face: true, quality_score: 0.9, liveness_score: 0.9 }
    if (req.url === '/face/enroll/sample') return json({ ...face, embedding_base64: embedding, embedding_dim: 128 })
    if (req.url === '/face/verify') {
      const photo = Buffer.from(b.imageBase64 || '', 'base64').toString()
      const n = (b.candidateEmbeddingsBase64 || []).length
      const score = photo.startsWith('MATCH') ? 0.95 : 0.3
      return json({ ...face, match_score: score, match_mean: score, match_scores: Array(n).fill(score), candidate_count: n })
    }
    res.writeHead(404); res.end()
  })
})
const workerUp = await new Promise((resolve) => { worker.once('error', () => resolve(false)); worker.listen(8091, () => resolve(true)) })
const ist = (dateIso, hhmm) => new Date(`${dateIso}T${hhmm}:00+05:30`).toISOString()

// ── fixtures and what was there before ───────────────────────────────────────
const start = sql(`select now()`)
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const area = (() => {
  const [lat, lng] = sql(`select coalesce(z.latitude, b.latitude, hq.latitude) || '|' || coalesce(z.longitude, b.longitude, hq.longitude)
      from hrms.employees e
      left join public.geo_fence_zones z on z.id = e.geo_fence_zone_id and z.is_active
      left join org.branches b on b.id = e.branch_id
      left join lateral (select latitude, longitude from org.branches where company_id = e.company_id and is_active
                          order by is_headquarters desc, name asc limit 1) hq on true
     where e.id = '${READER}'`).split('|').map(Number)
  return { latitude: lat, longitude: lng }
})()
const far = { latitude: 12.9716, longitude: 77.5946 } // Bengaluru, far from the work area
const readerHadEnrollment = sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) !== '0'
const readerEnrolled = readerHadEnrollment && sql(`select status from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) === 'ACTIVE'
let createdEnrollment = false
const readerHadToday = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) !== '0'
const hrConfigRows = sql(`select count(*) from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`)
const webWas = hrConfigRows === '0' ? null : sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`)
const ruleWas = sql(`select coalesce((select allow_anywhere::text from hrms.employee_punch_rules where tenant_id='${tenant}' and employee_id='${FIN}'), 'none')`)
// A past weekday with no record for hrm@ and fin@ (bulk mark), and one within 90 days with none for reader@ (the WFH fix).
const freeDay = (ids, fromBack, toBack, openPayrollOnly = false) => {
  for (let back = fromBack; back < toBack; back++) {
    const d = sql(`select ('${today}'::date - ${back})::text`)
    const dow = Number(sql(`select extract(isodow from '${d}'::date)`))
    if (dow >= 6) continue
    // Undo is refused once payroll is locked or paid for the day's month (DECISIONS 15).
    if (openPayrollOnly && sql(`select count(*) from payroll.runs where tenant_id='${tenant}' and period_year = extract(year from '${d}'::date)
        and period_month = extract(month from '${d}'::date) and status in ('LOCKED','PAID')`) !== '0') continue
    if (sql(`select count(*) from attendance.records where employee_id in (${ids.map((i) => `'${i}'`).join(',')}) and attendance_date='${d}'`) === '0') return d
  }
  return null
}
const bulkDay = freeDay([HRM, FIN], 20, 60)
const wfhDay = freeDay([READER], 10, 85, true)
const lastMonday = sql(`select (date_trunc('week', '${today}'::date) - interval '7 days')::date::text`)
const lastTuesday = sql(`select ('${lastMonday}'::date + 1)::text`)
const lastWednesday = sql(`select ('${lastMonday}'::date + 2)::text`)
let projectId = null
let wfhRecord = null
let correctionId = null
const entryIds = []

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  // put back any renamed table or column
  q(`do $$ begin if to_regclass('hrms.timesheet_weeks_rdtest') is not null then alter table hrms.timesheet_weeks_rdtest rename to timesheet_weeks; end if; end $$`)
  q(`do $$ begin if to_regclass('hrms.employee_punch_rules_rdtest') is not null then alter table hrms.employee_punch_rules_rdtest rename to employee_punch_rules; end if; end $$`)
  q(`do $$ begin if exists (select 1 from information_schema.columns where table_schema='settings' and table_name='hr_configuration' and column_name='allow_web_punch_rdtest') then alter table settings.hr_configuration rename column allow_web_punch_rdtest to allow_web_punch; end if; end $$`)
  // the web switch as it was
  if (hrConfigRows === '0') q(`delete from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}' and created_at >= '${start}'`)
  else q(`update settings.hr_configuration set allow_web_punch = ${webWas === 't' ? 'true' : 'false'} where tenant_id='${tenant}' and company_id='${company}'`)
  // the punch rule as it was
  if (ruleWas === 'none') q(`delete from hrms.employee_punch_rules where tenant_id='${tenant}' and employee_id='${FIN}'`)
  else q(`update hrms.employee_punch_rules set allow_anywhere = ${ruleWas} where tenant_id='${tenant}' and employee_id='${FIN}'`)
  // records this run made: reader@ today, the bulk marks, the WFH day
  const recs = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from attendance.records where tenant_id='${tenant}' and created_at >= '${start}'
      and ((employee_id='${READER}' and attendance_date in ('${today}'${wfhDay ? `,'${wfhDay}'` : ''})) or (employee_id in ('${HRM}','${FIN}') and attendance_date='${bulkDay}'))`)
  if (recs) {
    q(`delete from attendance.event_logs where record_id::text in (${recs})`)
    q(`delete from attendance.records where id::text in (${recs})`)
  }
  if (correctionId) q(`delete from attendance.regularization_requests where id='${correctionId}'`)
  q(`delete from public.geo_fence_audits where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}') and created_at >= '${start}'`)
  // the face checks and the enrolment this run made
  q(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}'`)
  if (createdEnrollment) {
    q(`delete from attendance.face_embedding_templates where tenant_id='${tenant}' and employee_id='${READER}'`)
    q(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
  }
  // the timesheet
  q(`do $$ begin if to_regclass('hrms.timesheet_weeks') is not null then delete from hrms.timesheet_weeks where tenant_id='${tenant}' and employee_id in ('${READER}','${HRM}') and created_at >= '${start}'; end if; end $$`)
  if (entryIds.length) q(`delete from hrms.time_entries where id in (${entryIds.map((i) => `'${i}'`).join(',')})`)
  q(`delete from hrms.time_entries where tenant_id='${tenant}' and employee_id in ('${READER}','${HRM}') and created_at >= '${start}' and work_date between '${lastMonday}' and ('${lastMonday}'::date + 6)`)
  if (projectId) q(`delete from hrms.projects where id='${projectId}'`)
  // what the run logged
  q(`delete from hrms.report_exports where tenant_id='${tenant}' and report='muster-roll' and created_at >= '${start}'`)
  q(`delete from notif.notifications where tenant_id='${tenant}' and created_at >= '${start}' and type in ('TIMESHEET_SUBMITTED','TIMESHEET_DECIDED','CORRECTION_SUBMITTED','CORRECTION_APPROVED','DECISION_UNDONE')`)
  q(`do $$ begin if to_regclass('hrms.approval_decisions') is not null then delete from hrms.approval_decisions where tenant_id='${tenant}' and decided_at >= '${start}'; end if; end $$`)
  q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and module='attendance'
      and action in ('MANUAL_ENTRY','WEB_PUNCH_SETTING_CHANGED','PUNCH_RULE_CHANGED','CHECKOUT_UNDONE','TIMESHEET_APPROVED','TIMESHEET_REJECTED')`)
}

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── 0. the migrations ──────────────────────────────────────────────────────
  check('V143_53: "Allow web check-in" column is there, on by default',
    sql(`select column_default from information_schema.columns where table_schema='settings' and table_name='hr_configuration' and column_name='allow_web_punch'`) === 'true')
  check('V143_53: both method checks on the partitioned records accept WEB and are validated',
    sql(`select count(*) from pg_constraint where conrelid='attendance.records'::regclass and conname in ('ck_attendance_records_check_in_method','ck_attendance_records_check_out_method') and convalidated and pg_get_constraintdef(oid) like '%''WEB''%'`) === '2'
    && sql(`select count(*) from pg_constraint where conrelid='attendance.records'::regclass and conname like '%_web'`) === '0')
  check('V143_53: every partition carries the new checks',
    sql(`select count(*) from pg_inherits i where i.inhparent='attendance.records'::regclass and 2 <> (select count(*) from pg_constraint c where c.conrelid=i.inhrelid and c.conname in ('ck_attendance_records_check_in_method','ck_attendance_records_check_out_method') and pg_get_constraintdef(c.oid) like '%''WEB''%')`) === '0')
  check('V143_53 / V143_65: the new tables are there',
    sql(`select (to_regclass('hrms.employee_punch_rules') is not null and to_regclass('hrms.timesheet_weeks') is not null)::text`) === 'true')
  check('V143_65: hrms.timesheet.approve is in the Attendance group as "Approve timesheets"',
    sql(`select display_name || '|' || module from rbac.permissions where code='hrms.timesheet.approve'`) === 'Approve timesheets|attendance')
  check('V143_65: granted to exactly OWNER, SUPER_ADMIN, HR_MANAGER and DEPT_MANAGER',
    sql(`select string_agg(r.code, ',' order by r.code) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id and r.tenant_id is null where rp.permission_code = 'hrms.timesheet.approve'`) === 'DEPT_MANAGER,HR_MANAGER,OWNER,SUPER_ADMIN')

  // ── A. web check-in: on by default, a face scan like the phone ─────────────
  if (readerHadToday) check('reader@ has no attendance record today (needed for the web punch)', false, 'a record exists; the web punch steps are skipped')
  const g0 = await reader.call('GET', `/v1/attendance/web-punch-setting?companyId=${company}`)
  check('anyone signed in reads the switch; it is on by default', g0.status === 200 && g0.json.allowWebPunch === true, `${g0.status} ${g0.text}`)
  const puts = await Promise.all([reader, mgr, fin].map((u) => u.call('PUT', `/v1/attendance/web-punch-setting?companyId=${company}`, { allowWebPunch: false })))
  check('reader@, mgr@ and fin@ may not change the switch (403)', puts.every((p) => p.status === 403), puts.map((p) => p.status).join('/'))
  const hrOff = await hrm.call('PUT', `/v1/attendance/web-punch-setting?companyId=${company}`, { allowWebPunch: false })
  check('hrm@ (attendance policy) turns web check-in off', hrOff.status === 200 && hrOff.json.allowWebPunch === false, `${hrOff.status}`)
  check('…stored on the company row', sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === 'f')
  const offPunch = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
  check('switch off: a web check-in is refused (422 WEB_PUNCH_NOT_ALLOWED), before any face check', offPunch.status === 422 && code(offPunch) === 'WEB_PUNCH_NOT_ALLOWED'
    && sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}'`) === '0', `${offPunch.status} ${code(offPunch)}`)
  const offBreak = await reader.call('POST', '/v1/attendance/breaks/start')
  check('switch off: no break from the web either', offBreak.status === 422 && code(offBreak) === 'WEB_PUNCH_NOT_ALLOWED', `${offBreak.status} ${code(offBreak)}`)
  const day0 = await reader.call('GET', '/v1/attendance/my-day')
  check('my day before punching: not in, web check-in off, nothing to undo',
    day0.status === 200 && day0.json.checkedIn === false && day0.json.webPunchAllowed === false && day0.json.canUndoCheckOut === false,
    `${day0.status} ${day0.text?.slice(0, 200)}`)
  const on = await owner.call('PUT', `/v1/attendance/web-punch-setting?companyId=${company}`, { allowWebPunch: true })
  check('owner@ switches web check-in back on', on.status === 200 && on.json.allowWebPunch === true && on.json.companyId === company, `${on.status} ${on.text}`)
  check('the switch is stored on the company row',
    sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === 't')

  if (!readerHadToday) {
    const noLoc = await reader.call('POST', '/v1/attendance/checkin', { latitude: 0, longitude: 0, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
    check('a web check-in without the browser\'s location is refused (422 LOCATION_REQUIRED)', noLoc.status === 422 && code(noLoc) === 'LOCATION_REQUIRED', `${noLoc.status} ${code(noLoc)}`)
    const noFace = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB' })
    check('a web check-in without a face photo is refused (422 FACE_IMAGE_REQUIRED)', noFace.status === 422 && code(noFace) === 'FACE_IMAGE_REQUIRED', `${noFace.status} ${code(noFace)}`)

    // reader@'s face: none yet → FACE_NOT_ENROLLED; then enrolled through the self enrolment the web uses.
    let enrolled = readerEnrolled
    if (!enrolled) {
      const ne = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
      check('no enrolled face: refused (409 FACE_NOT_ENROLLED), nothing punched', ne.status === 409 && code(ne) === 'FACE_NOT_ENROLLED'
        && sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === '0', `${ne.status} ${code(ne)}`)
      if (workerUp) {
        const st = await reader.call('POST', '/v1/attendance/face/enroll/start', { deviceFingerprint: 'Web browser (live-rd-p-att-day)' })
        createdEnrollment = !readerHadEnrollment
        let ok = st.status === 200
        for (const angle of (st.json?.captureSequence || ['FRONT', 'LEFT_30', 'RIGHT_30'])) {
          if (!ok) break
          const s = await reader.call('POST', '/v1/attendance/face/enroll/sample', { enrollmentId: st.json.enrollmentId, captureAngle: angle, imageBase64: MATCH_PHOTO, challengePerformed: 'BLINK' })
          ok = s.status === 200 && s.json?.accepted !== false
        }
        const done = ok ? await reader.call('POST', '/v1/attendance/face/enroll/complete') : { status: 0 }
        enrolled = done.status === 200
        check('reader@ enrols their face from the web (stand-in worker)', enrolled, `start ${st.status} complete ${done.status}`)
      }
    }
    if (!enrolled || !workerUp) {
      check('the face-matched web punch steps ran', false, !workerUp ? 'port 8091 is in use (a real face worker?), so the stand-in worker could not start' : 'reader@ could not be enrolled')
    } else {
      const bad = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: STRANGER_PHOTO })
      check('a face that isn\'t reader@\'s: 403 FAIL_MATCH, nothing punched', bad.status === 403 && code(bad) === 'FAIL_MATCH'
        && sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === '0', `${bad.status} ${code(bad)}`)
      const inn = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO, deviceId: 'Web browser (Chrome on Windows)', offlineCaptured: true, capturedAt: ist(today, '06:00') })
      check('web check-in with a matching face inside the work area: 200, method WEB, no face score on the record', inn.status === 200 && inn.json.checkInMethod === 'WEB' && inn.json.faceConfidenceScore == null, `${inn.status} ${inn.text?.slice(0, 200)}`)
      check('…stamped by the server clock, not the client\'s capture time',
        inn.status === 200 && Math.abs(new Date(inn.json.checkInTime).getTime() - Date.now()) < 5 * 60e3, inn.json?.checkInTime)
      check('…stored as WEB on the record', sql(`select check_in_method from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'WEB')
      check('…the face check is in the face log: PUNCH_IN, passed, from the browser',
        sql(`select purpose || '|' || result || '|' || coalesce(device_fingerprint, '') from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}'
              and created_at >= '${start}' and result = 'PASS' order by created_at desc limit 1`) === 'PUNCH_IN|PASS|Web browser (Chrome on Windows)')
      const again = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
      check('a second web check-in is refused before the face scan (422 ALREADY_CHECKED_IN)', again.status === 422 && code(again) === 'ALREADY_CHECKED_IN', `${again.status} ${code(again)}`)

      const b1 = await reader.call('POST', '/v1/attendance/breaks/start')
      check('take a break: on a break', b1.status === 200 && b1.json.onBreak === true && !!b1.json.breakStartedAt, `${b1.status} ${b1.text}`)
      const b1b = await reader.call('POST', '/v1/attendance/breaks/start')
      check('one break at a time (422 BREAK_ALREADY_STARTED)', b1b.status === 422 && code(b1b) === 'BREAK_ALREADY_STARTED', `${b1b.status} ${code(b1b)}`)
      const md = await reader.call('GET', '/v1/attendance/my-day')
      check('my day: checked in by web, on a break, web check-in allowed, the day counted as worked',
        md.status === 200 && md.json.checkedIn && !md.json.checkedOut && md.json.onBreak && md.json.webPunchAllowed
        && md.json.record?.checkInMethod === 'WEB' && ['PRESENT', 'LATE', 'HALF_DAY'].includes(md.json.status),
        `${md.status} status=${md.json?.status} onBreak=${md.json?.onBreak}`)
      const b1e = await reader.call('POST', '/v1/attendance/breaks/end')
      check('end the break', b1e.status === 200 && b1e.json.onBreak === false && b1e.json.breaks.length === 1, `${b1e.status}`)
      check('breaks are event-log rows only; the record\'s worked hours are untouched',
        sql(`select count(*) from attendance.event_logs where employee_id='${READER}' and event_date='${today}' and event_type in ('BREAK_START','BREAK_END') and created_at >= '${start}'`) === '2'
        && sql(`select coalesce(work_hours::text, 'none') from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'none')
      await reader.call('POST', '/v1/attendance/breaks/start') // left open: check-out must end it

      const outNoFace = await reader.call('POST', '/v1/attendance/checkout', { ...area, checkOutMethod: 'WEB' })
      check('a web check-out without a face photo is refused (422 FACE_IMAGE_REQUIRED)', outNoFace.status === 422 && code(outNoFace) === 'FACE_IMAGE_REQUIRED', `${outNoFace.status} ${code(outNoFace)}`)
      const out = await reader.call('POST', '/v1/attendance/checkout', { ...area, checkOutMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
      check('web check-out with a matching face: 200, method WEB', out.status === 200 && out.json.checkOutMethod === 'WEB' && !!out.json.checkOutTime, `${out.status} ${out.text?.slice(0, 200)}`)
      check('…its face check is in the face log as PUNCH_OUT',
        sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}' and purpose='PUNCH_OUT' and result='PASS'`) === '1')
      check('the open break ended with the check-out, at the check-out time',
        sql(`select count(*) from attendance.event_logs l join attendance.records r on r.id = l.record_id and r.attendance_date = l.event_date
              where r.employee_id='${READER}' and r.attendance_date='${today}' and l.event_type='BREAK_END' and l.event_at = r.check_out_at`) === '1')
      check('worked hours are check-in to check-out, breaks not taken off',
        sql(`select (abs(work_hours - round((extract(epoch from (check_out_at - check_in_at))::bigint / 60 / 60.0)::numeric, 2)) < 0.011)::text
               from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'true')
      const md2 = await reader.call('GET', '/v1/attendance/my-day')
      const until = md2.json?.undoCheckOutUntil ? new Date(md2.json.undoCheckOutUntil).getTime() : 0
      check('my day after check-out: undo offered until check-out + 10 minutes',
        md2.status === 200 && md2.json.checkedOut && md2.json.canUndoCheckOut && Math.abs(until - (new Date(out.json.checkOutTime).getTime() + 600e3)) < 2000,
        `${md2.status} can=${md2.json?.canUndoCheckOut} until=${md2.json?.undoCheckOutUntil}`)
      const outAgain = await reader.call('POST', '/v1/attendance/checkout', { ...area, checkOutMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
      check('a second web check-out is refused before the face scan (422 ALREADY_CHECKED_OUT)', outAgain.status === 422 && code(outAgain) === 'ALREADY_CHECKED_OUT', `${outAgain.status} ${code(outAgain)}`)
      const undo = await reader.call('POST', '/v1/attendance/checkout/undo')
      check('undo check-out: 200, checked in again', undo.status === 200 && undo.json.checkOutTime == null && undo.json.workHours == null, `${undo.status} ${undo.text?.slice(0, 200)}`)
      check('…the record is as before checking out, and the undo is logged',
        sql(`select (check_out_at is null and check_out_method is null and work_hours is null and overtime_minutes is null)::text from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'true'
        && sql(`select count(*) from attendance.event_logs where employee_id='${READER}' and event_date='${today}' and event_type='MANUAL_OVERRIDE' and created_at >= '${start}'`) === '1')
      const undo2 = await reader.call('POST', '/v1/attendance/checkout/undo')
      check('nothing left to undo (422 NOT_CHECKED_OUT)', undo2.status === 422 && code(undo2) === 'NOT_CHECKED_OUT', `${undo2.status} ${code(undo2)}`)
      const out2 = await reader.call('POST', '/v1/attendance/checkout', { ...area, checkOutMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
      // Back-date this test's own punch (in up to an hour ago but not before today began, out 11 minutes ago),
      // unless the check-out would then fall before today began (the first 12 minutes after midnight).
      const dayStart = `('${today}'::timestamp at time zone 'Asia/Kolkata')`
      const moved = sql(`update attendance.records set check_in_at = greatest(now() - interval '60 minutes', ${dayStart} + interval '1 minute'),
            check_out_at = now() - interval '11 minutes'
          where employee_id='${READER}' and attendance_date='${today}' and now() - interval '11 minutes' > ${dayStart} + interval '1 minute'
          returning 1`).split('\n')[0] === '1'
      const late = await reader.call('POST', '/v1/attendance/checkout/undo')
      check('after 10 minutes the check-out can\'t be undone (422 CHECKOUT_UNDO_WINDOW_PASSED)',
        out2.status === 200 && moved && late.status === 422 && code(late) === 'CHECKOUT_UNDO_WINDOW_PASSED',
        `${out2.status} moved=${moved} ${late.status} ${code(late)}`)
      const today1 = await reader.call('GET', '/v1/attendance/today')
      check('the mobile app\'s /today keeps its fields and says WEB',
        today1.status === 200 && today1.json.checkInMethod === 'WEB' && 'attendanceType' in today1.json && 'manualEntry' in today1.json && 'faceConfidenceScore' in today1.json, `${today1.status}`)

      // The Face Punch tab's month calendar: one person's face punches.
      const fe = await hrm.call('GET', `/v1/attendance/review/face-events/employee/${READER}?from=${today}&to=${today}`)
      const mine = (fe.json || []).filter((e) => e.employeeId === READER && String(e.device || '').startsWith('Web browser'))
      check('one person\'s face punches (hrm@): today\'s web punch in and out, with the name and device',
        fe.status === 200 && mine.some((e) => e.purpose === 'PUNCH_IN') && mine.some((e) => e.purpose === 'PUNCH_OUT') && mine.every((e) => e.employeeName && e.date === today),
        `${fe.status} ${mine.length}`)
      const feDenied = await reader.call('GET', `/v1/attendance/review/face-events/employee/${READER}`)
      check('…not for someone without the face log or review permission (reader@ 403)', feDenied.status === 403, `${feDenied.status}`)
    }
  }

  const off = await owner.call('PUT', `/v1/attendance/web-punch-setting?companyId=${company}`, { allowWebPunch: false })
  const offAgain = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB', faceImageBase64: MATCH_PHOTO })
  const offUndo = await reader.call('POST', '/v1/attendance/checkout/undo')
  check('switched off: web punches and undo are refused again',
    off.status === 200 && off.json.allowWebPunch === false && code(offAgain) === 'WEB_PUNCH_NOT_ALLOWED' && code(offUndo) === 'WEB_PUNCH_NOT_ALLOWED',
    `${off.status} ${code(offAgain)} ${code(offUndo)}`)

  // ── B. "Anywhere (no geofence)" ────────────────────────────────────────────
  const rulesDenied = await Promise.all([reader, mgr, fin].map((u) => u.call('GET', `/v1/attendance/punch-rules/${READER}`)))
  check('reader@, mgr@ and fin@ may not read or set punch rules (403)', rulesDenied.every((p) => p.status === 403), rulesDenied.map((p) => p.status).join('/'))
  const selfRule = await hrm.call('PUT', `/v1/attendance/punch-rules/${HRM}`, { allowAnywhere: true })
  check('nobody changes their own punch rules (403)', selfRule.status === 403, `${selfRule.status}`)
  const farBefore = await fin.call('POST', '/v1/attendance/geo-fence/check', far)
  const setRule = await hrm.call('PUT', `/v1/attendance/punch-rules/${FIN}`, { allowAnywhere: true })
  check('hrm@ lets fin@ check in from anywhere (fin@ has no WFH day today; reader@ has one in the base data)', setRule.status === 200 && setRule.json.allowAnywhere === true && !!setRule.json.updatedByName, `${setRule.status} ${setRule.text}`)
  const farAfter = await fin.call('POST', '/v1/attendance/geo-fence/check', far)
  check('the phone\'s pre-punch zone check: outside before, allowed from anywhere after',
    farBefore.status === 200 && farBefore.json.withinFence === false && farAfter.status === 200 && farAfter.json.withinFence === true,
    `${farBefore.json?.withinFence} → ${farAfter.json?.withinFence}`)
  const clearRule = await hrm.call('PUT', `/v1/attendance/punch-rules/${FIN}`, { allowAnywhere: false })
  const farCleared = await fin.call('POST', '/v1/attendance/geo-fence/check', far)
  check('switched off again, the zone applies again', clearRule.status === 200 && farCleared.json?.withinFence === false, `${clearRule.status} ${farCleared.json?.withinFence}`)

  // ── C. mark attendance, recent entries, the register, one employee's month ──
  if (!bulkDay) check('found a past weekday with no record for hrm@ and fin@', false)
  else {
    const body = { attendanceDate: bulkDay, checkInAt: ist(bulkDay, '09:30'), checkOutAt: ist(bulkDay, '18:30'), attendanceType: 'OFFICE',
      reason: 'Biometric device was down (live test)', employeeIds: [HRM, FIN, HRM] }
    const denied = await Promise.all([reader, mgr, fin].map((u) => u.call('POST', '/v1/attendance/manual-entry/bulk', body)))
    check('only attendance admins mark attendance (reader@, mgr@, fin@: 403)', denied.every((p) => p.status === 403), denied.map((p) => p.status).join('/'))
    const bulk = await hrm.call('POST', '/v1/attendance/manual-entry/bulk', body)
    check('hrm@ marks fin@ (hrm@ herself and the repeat are skipped)',
      bulk.status === 200 && bulk.json.saved === 1 && bulk.json.skipped === 2
      && bulk.json.results.find((r) => r.employeeId === HRM)?.code === 'MANUAL_ENTRY_SELF'
      && bulk.json.results.some((r) => r.code === 'DUPLICATE'), `${bulk.status} ${bulk.text?.slice(0, 300)}`)
    const bulk2 = await owner.call('POST', '/v1/attendance/manual-entry/bulk', body)
    check('owner@ marks hrm@ and fin@ in one go (fin@\'s day updated, the repeat skipped)', bulk2.status === 200 && bulk2.json.saved === 2 && bulk2.json.skipped === 1, `${bulk2.status} ${bulk2.text?.slice(0, 200)}`)
    check('…both days are manual entries with the reason, and each is in the audit log',
      sql(`select count(*) from attendance.records where employee_id in ('${HRM}','${FIN}') and attendance_date='${bulkDay}' and manual_entry and manual_entry_reason like 'Biometric%'`) === '2'
      && Number(sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='MANUAL_ENTRY' and occurred_at >= '${start}'`)) >= 3)
    const recent = await owner.call('GET', `/v1/attendance/manual-entries?from=${bulkDay}&to=${bulkDay}`)
    check('recent manual entries: who and why', recent.status === 200 && recent.json.filter((e) => e.date === bulkDay && e.reason?.startsWith('Biometric') && e.enteredByName).length === 2,
      `${recent.status} ${recent.text?.slice(0, 200)}`)
    const recentMgr = await mgr.call('GET', `/v1/attendance/manual-entries?from=${bulkDay}&to=${bulkDay}`)
    const recentReader = await reader.call('GET', `/v1/attendance/manual-entries?from=${bulkDay}&to=${bulkDay}`)
    check('a manager sees only their team\'s manual entries; an employee none (403)',
      recentMgr.status === 200 && !recentMgr.json.some((e) => [HRM, FIN].includes(e.employeeId)) && recentReader.status === 403, `${recentMgr.status} ${recentReader.status}`)

    const csv = await owner.call('GET', `/v1/attendance/register/export.csv?date=${bulkDay}`)
    const lines = (csv.text || '').replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
    check('the day register downloads as muster-roll-<date>.csv with the design\'s columns',
      csv.status === 200 && (csv.headers.get('content-disposition') || '').includes(`muster-roll-${bulkDay}.csv`)
      && lines[0] === 'Employee,Code,Department,Branch,Shift,In,Out,Hours,Status,Source', `${csv.status} ${lines[0]}`)
    check('…fin@\'s manual day is a row: 09:30–18:30, 9.00 hours, added by HR',
      lines.some((l) => l.startsWith('Finance Lead,') && l.includes(',09:30,18:30,9.00,') && l.endsWith(',Added by HR')), lines.find((l) => l.startsWith('Finance')))
    check('…and the download is in the export log for the Reports Center',
      sql(`select count(*) from hrms.report_exports where tenant_id='${tenant}' and report='muster-roll' and file_name='muster-roll-${bulkDay}.csv' and created_at >= '${start}'`) === '1')
    const csvDenied = await Promise.all([reader, mgr].map((u) => u.call('GET', `/v1/attendance/register/export.csv?date=${bulkDay}`)))
    check('the register needs the attendance report permission (reader@, mgr@: 403)', csvDenied.every((p) => p.status === 403), csvDenied.map((p) => p.status).join('/'))
  }

  const [y, m] = today.split('-').map(Number)
  const hist = await mgr.call('GET', `/v1/attendance/employee/${READER}/history?year=${y}&month=${m}`)
  const stats = await mgr.call('GET', `/v1/attendance/employee/${READER}/monthly-stats?year=${y}&month=${m}`)
  check('a manager reads their report\'s month, day by day, with the day details and leave days',
    hist.status === 200 && Array.isArray(hist.json) && hist.json.every((d) => 'status' in d && 'checkInMethod' in d && 'regularized' in d)
    && stats.status === 200 && 'leaveDays' in stats.json && 'attendanceScore' in stats.json, `${hist.status} ${stats.status}`)
  if (!readerHadToday) {
    const t = hist.json?.find((d) => d.date === today)
    check('…today shows the web check-in', t?.checkInMethod === 'WEB', JSON.stringify(t))
  }
  const histDenied = await Promise.all([fin.call('GET', `/v1/attendance/employee/${READER}/history`), reader.call('GET', `/v1/attendance/employee/${HRM}/history`)])
  check('someone else\'s month: not for fin@ (not their report) or reader@ (403)', histDenied.every((p) => p.status === 403), histDenied.map((p) => p.status).join('/'))
  const dash = await owner.call('GET', `/v1/attendance/dashboard?date=${today}`)
  const row = dash.json?.staffStatuses?.find((s) => s.employeeId === READER)
  check('the roster rows carry the new facts (branch, method, leave, waiting leave) next to every old one',
    dash.status === 200 && dash.json.staffStatuses.every((s) => ['branchName', 'checkInMethod', 'leaveTypeName', 'leaveFrom', 'leaveTo', 'pendingLeave', 'status', 'onLeave', 'attendanceType', 'effectiveStatus'].every((k) => k in s))
    && (readerHadToday || row?.checkInMethod === 'WEB'), `${dash.status} ${JSON.stringify(row)?.slice(0, 200)}`)
  const ex = await owner.call('GET', `/v1/attendance/review/exceptions?from=${sql(`select ('${today}'::date - 30)::text`)}&to=${today}`)
  check('review items carry branch, zone and method', ex.status === 200 && ex.json.every((i) => 'branchName' in i && 'zoneName' in i && 'checkInMethod' in i), `${ex.status} ${ex.json?.length}`)

  // ── D. bug E28: a fixed work-from-home day stays work from home ────────────
  if (!wfhDay) check('found a past weekday within 90 days with no record for reader@', false)
  else {
    wfhRecord = sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, check_in_at, attendance_type, attendance_status, check_in_method, created_at, updated_at)
      values (gen_random_uuid(), '${tenant}', '${READER}', '${company}', '${wfhDay}', '${ist(wfhDay, '09:10')}', 'WFH', 'ON_TIME', 'GPS', now(), now()) returning id`).split('\n')[0]
    const fix = await reader.call('POST', '/v1/attendance/corrections', { requestedDate: wfhDay, requestedCheckOutAt: ist(wfhDay, '18:10'), reason: 'Forgot to punch out from home (live test)' })
    correctionId = fix.json?.id
    check('a fix request says who it went to (reader@\'s manager)', fix.status === 200 && fix.json.approverName === 'Dept Manager', `${fix.status} ${fix.json?.approverName}`)
    const queue = await mgr.call('GET', '/v1/attendance/corrections/approvals?status=PENDING')
    check('the manager\'s queue shows the same approver', queue.status === 200 && queue.json.content.some((c) => c.id === correctionId && c.approverName === 'Dept Manager'), `${queue.status}`)
    const dec = await mgr.call('POST', `/v1/attendance/corrections/${correctionId}/decision`, { status: 'APPROVED', comment: 'ok' })
    check('the manager approves it; the answer names who decided', dec.status === 200 && dec.json.status === 'APPROVED' && dec.json.decidedByName === 'Dept Manager' && dec.json.approverName == null, `${dec.status} ${dec.text?.slice(0, 200)}`)
    check('E28: the work-from-home day is still WFH, with the fixed check-out',
      sql(`select attendance_type || '|' || (check_out_at is not null) || '|' || is_regularized from attendance.records where id='${wfhRecord}'`) === 'WFH|true|true')
    const [wy, wm] = wfhDay.split('-').map(Number)
    const wh = await reader.call('GET', `/v1/attendance/history?year=${wy}&month=${wm}`)
    const wd = wh.json?.find((d) => d.date === wfhDay)
    check('…and My Attendance shows it as a fixed work-from-home day', wd?.attendanceType === 'WFH' && wd?.regularized === true, JSON.stringify(wd))
    // With approval Undo (P-TEAM): taking the approval back restores the day as it was (still WFH, no check-out),
    // and approving again gives the same WFH day.
    const undo = await mgr.call('POST', `/v1/attendance/corrections/${correctionId}/decision/undo`)
    check('Undo of the approval puts the WFH day back as it was (WFH, no check-out, not fixed)',
      undo.status === 200 && sql(`select attendance_type || '|' || (check_out_at is null) || '|' || is_regularized from attendance.records where id='${wfhRecord}'`) === 'WFH|true|false',
      `${undo.status} ${code(undo)} ${sql(`select attendance_type || '|' || (check_out_at is null) || '|' || is_regularized from attendance.records where id='${wfhRecord}'`)}`)
    const again = await mgr.call('POST', `/v1/attendance/corrections/${correctionId}/decision`, { status: 'APPROVED', comment: 'ok again' })
    check('…approving it again keeps it WFH', again.status === 200
      && sql(`select attendance_type || '|' || (check_out_at is not null) from attendance.records where id='${wfhRecord}'`) === 'WFH|true', `${again.status} ${code(again)}`)
  }

  // ── E. the timesheet ───────────────────────────────────────────────────────
  const proj = await owner.call('POST', '/v1/hrms/projects', { companyId: company, name: `Live timesheet ${Date.now()}` })
  projectId = proj.json?.id
  if (projectId) sql(`update hrms.projects set code='LIVE-TS' where id='${projectId}'`)
  const projects = await reader.call('GET', '/v1/ess/timesheets/projects')
  check('an employee lists their company\'s active projects, with the code', projects.status === 200 && projects.json.some((p) => p.id === projectId && p.code === 'LIVE-TS'), `${projects.status}`)
  const blank = await reader.call('POST', '/v1/ess/timesheets', { workDate: lastTuesday, minutes: 60, description: ' ' })
  check('without a project the description is still required (400)', blank.status === 400 && code(blank) === 'VALIDATION_FAILED', `${blank.status} ${code(blank)}`)
  const e1 = await reader.call('POST', '/v1/ess/timesheets', { workDate: lastTuesday, minutes: 150, projectId })
  const e2 = await reader.call('POST', '/v1/ess/timesheets', { workDate: lastWednesday, minutes: 90, description: 'Code review (live test)' })
  ;[e1, e2].forEach((e) => e.json?.id && entryIds.push(e.json.id))
  check('time on a project (no description needed) and time with a description alone', e1.status === 200 && e2.status === 200, `${e1.status} ${e2.status}`)
  const week0 = await reader.call('GET', `/v1/ess/timesheets?from=${lastMonday}&to=${sql(`select ('${lastMonday}'::date + 6)::text`)}`)
  const onProject = week0.json?.find((e) => e.id === e1.json?.id)
  check('the entries show the project and are not locked', onProject?.projectCode === 'LIVE-TS' && onProject?.locked === false, JSON.stringify(onProject))
  const sub = await reader.call('POST', `/v1/ess/timesheets/weeks/${lastMonday}/submit`)
  const weekId = sub.json?.id
  check('Submit week: SUBMITTED with the week\'s total', sub.status === 200 && sub.json.status === 'SUBMITTED' && sub.json.totalMinutes >= 240, `${sub.status} ${sub.text?.slice(0, 200)}`)
  check('…the approver is told (TIMESHEET_SUBMITTED)', sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and type='TIMESHEET_SUBMITTED' and created_at >= '${start}'`) !== '0')
  const again = await reader.call('POST', `/v1/ess/timesheets/weeks/${lastMonday}/submit`)
  check('a submitted week can\'t be submitted again (409)', again.status === 409 && code(again) === 'TIMESHEET_WEEK_ALREADY_SUBMITTED', `${again.status}`)
  const edit = await reader.call('PUT', `/v1/ess/timesheets/${e2.json?.id}`, { workDate: lastWednesday, minutes: 30, description: 'changed' })
  const add = await reader.call('POST', '/v1/ess/timesheets', { workDate: lastWednesday, minutes: 30, description: 'late add' })
  const del = await reader.call('DELETE', `/v1/ess/timesheets/${e2.json?.id}`)
  check('a submitted week is locked: no edit, add or delete (422 TIMESHEET_WEEK_LOCKED)',
    [edit, add, del].every((r) => r.status === 422 && code(r) === 'TIMESHEET_WEEK_LOCKED'), [edit, add, del].map((r) => `${r.status}`).join('/'))
  const weeks = await reader.call('GET', `/v1/ess/timesheets/weeks?from=${lastMonday}&to=${today}`)
  check('the person sees their week\'s state', weeks.status === 200 && weeks.json.some((w) => w.id === weekId && w.status === 'SUBMITTED'), `${weeks.status}`)

  const apDenied = await Promise.all([reader, fin].map((u) => u.call('GET', '/v1/timesheets/approvals')))
  check('reader@ and fin@ can\'t see the approvals (403)', apDenied.every((p) => p.status === 403), apDenied.map((p) => p.status).join('/'))
  const apMgr = await mgr.call('GET', '/v1/timesheets/approvals')
  const apHrm = await hrm.call('GET', '/v1/timesheets/approvals')
  check('the manager (their team) and HR (the company) see the week',
    apMgr.status === 200 && apMgr.json.content.some((w) => w.id === weekId && w.employeeName === 'Reader User') && apHrm.status === 200 && apHrm.json.content.some((w) => w.id === weekId),
    `${apMgr.status} ${apHrm.status}`)
  const entries = await mgr.call('GET', `/v1/timesheets/weeks/${weekId}/entries`)
  check('the approver reads the week\'s entries', entries.status === 200 && entries.json.some((e) => e.projectCode === 'LIVE-TS'), `${entries.status}`)
  const readerDecides = await reader.call('POST', `/v1/timesheets/weeks/${weekId}/decision`, { status: 'APPROVED' })
  check('reader@ can\'t decide (403)', readerDecides.status === 403, `${readerDecides.status}`)

  // hrm@'s own week: HR can't decide their own, and a manager outside the team can't either
  const he = await hrm.call('POST', '/v1/ess/timesheets', { workDate: lastTuesday, minutes: 60, description: 'HR week (live test)' })
  if (he.json?.id) entryIds.push(he.json.id)
  const hs = await hrm.call('POST', `/v1/ess/timesheets/weeks/${lastMonday}/submit`)
  const hSelf = await hrm.call('POST', `/v1/timesheets/weeks/${hs.json?.id}/decision`, { status: 'APPROVED' })
  const hMgr = await mgr.call('POST', `/v1/timesheets/weeks/${hs.json?.id}/decision`, { status: 'APPROVED' })
  check('nobody decides their own week (422); a manager can\'t decide outside their team (403)',
    hs.status === 200 && hSelf.status === 422 && code(hSelf) === 'SELF_APPROVAL_NOT_ALLOWED' && hMgr.status === 403, `${hs.status} ${hSelf.status} ${hMgr.status}`)

  const rej = await mgr.call('POST', `/v1/timesheets/weeks/${weekId}/decision`, { status: 'REJECTED', comment: 'Project missing on Wednesday' })
  check('the manager rejects it with a note; the employee is told', rej.status === 200 && rej.json.status === 'REJECTED' && rej.json.note === 'Project missing on Wednesday' && rej.json.decidedByName === 'Dept Manager'
    && sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and type='TIMESHEET_DECIDED' and created_at >= '${start}'`) !== '0', `${rej.status} ${rej.text?.slice(0, 200)}`)
  const edit2 = await reader.call('PUT', `/v1/ess/timesheets/${e2.json?.id}`, { workDate: lastWednesday, minutes: 60, description: 'Code review', projectId })
  check('a rejected week opens again (the entry can be edited)', edit2.status === 200, `${edit2.status} ${code(edit2)}`)
  const resub = await reader.call('POST', `/v1/ess/timesheets/weeks/${lastMonday}/submit`)
  check('…and submitted again', resub.status === 200 && resub.json.id === weekId && resub.json.status === 'SUBMITTED' && resub.json.note == null, `${resub.status}`)
  const appr = await mgr.call('POST', `/v1/timesheets/weeks/${weekId}/decision`, { status: 'APPROVED' })
  check('the manager approves it', appr.status === 200 && appr.json.status === 'APPROVED', `${appr.status}`)
  const apprAgain = await mgr.call('POST', `/v1/timesheets/weeks/${weekId}/decision`, { status: 'REJECTED' })
  const editApproved = await reader.call('DELETE', `/v1/ess/timesheets/${e1.json?.id}`)
  check('an approved week stays decided (409) and locked (422)', apprAgain.status === 409 && code(apprAgain) === 'TIMESHEET_WEEK_NOT_SUBMITTED' && editApproved.status === 422, `${apprAgain.status} ${editApproved.status}`)

  // ── F. FEATURE_NOT_READY with each new table or column renamed away ────────
  renaming = true
  try {
    sql(`alter table hrms.timesheet_weeks rename to timesheet_weeks_rdtest`)
    const nrA = await mgr.call('GET', '/v1/timesheets/approvals')
    const nrW = await reader.call('GET', `/v1/ess/timesheets/weeks?from=${lastMonday}&to=${today}`)
    const nrS = await reader.call('POST', `/v1/ess/timesheets/weeks/${sql(`select date_trunc('week', '${today}'::date)::date::text`)}/submit`)
    const stillList = await reader.call('GET', `/v1/ess/timesheets?from=${lastMonday}&to=${today}`)
    check('no weeks table: approvals, my weeks and Submit week answer 503 FEATURE_NOT_READY',
      [nrA, nrW, nrS].every((r) => r.status === 503 && code(r) === 'FEATURE_NOT_READY'), [nrA, nrW, nrS].map((r) => `${r.status} ${code(r)}`).join(' / '))
    check('…while the time entries still list (nothing locked, no lock field)', stillList.status === 200 && stillList.json.every((e) => !('locked' in e)), `${stillList.status}`)
  } finally { sql(`alter table hrms.timesheet_weeks_rdtest rename to timesheet_weeks`) }
  try {
    sql(`alter table hrms.employee_punch_rules rename to employee_punch_rules_rdtest`)
    const nrR = await hrm.call('GET', `/v1/attendance/punch-rules/${READER}`)
    const zone = await reader.call('POST', '/v1/attendance/geo-fence/check', area)
    check('no punch-rules table: the rule answers FEATURE_NOT_READY and the zone check works as before',
      nrR.status === 503 && code(nrR) === 'FEATURE_NOT_READY' && zone.status === 200 && zone.json.withinFence === true, `${nrR.status} ${zone.status}`)
  } finally { sql(`alter table hrms.employee_punch_rules_rdtest rename to employee_punch_rules`) }
  try {
    sql(`alter table settings.hr_configuration rename column allow_web_punch to allow_web_punch_rdtest`)
    const nrG = await reader.call('GET', `/v1/attendance/web-punch-setting?companyId=${company}`)
    const nrWeb = await reader.call('POST', '/v1/attendance/checkin', { ...area, checkInMethod: 'WEB' })
    const nrDay = await reader.call('GET', '/v1/attendance/my-day')
    const hr = await owner.call('GET', `/v1/settings/hr-configuration?companyId=${company}`)
    check('no switch column: the setting answers FEATURE_NOT_READY, web punches are refused, my day says off, HR configuration still loads',
      nrG.status === 503 && code(nrG) === 'FEATURE_NOT_READY' && code(nrWeb) === 'WEB_PUNCH_NOT_ALLOWED'
      && nrDay.status === 200 && nrDay.json.webPunchAllowed === false && hr.status === 200, `${nrG.status} ${code(nrWeb)} ${nrDay.status} ${hr.status}`)
  } finally { sql(`alter table settings.hr_configuration rename column allow_web_punch_rdtest to allow_web_punch`) }
  renaming = false

  check('no FEATURE_NOT_READY outside the rename step', unexpectedNotReady.length === 0, unexpectedNotReady.join(', '))
} catch (e) {
  check('script completed without an exception', false, e.stack || String(e))
} finally {
  cleanup()
}

// ── after cleanup: nothing left behind ─────────────────────────────────────────
check('cleanup: the switch is as it was',
  hrConfigRows === '0'
    ? sql(`select count(*) from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === '0'
    : sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === webWas)
check('cleanup: no record, week, entry, project, rule, export or notification from this run is left',
  sql(`select count(*) from attendance.records where tenant_id='${tenant}' and created_at >= '${start}' and employee_id in ('${READER}','${HRM}','${FIN}')`) === '0'
  && sql(`select count(*) from hrms.timesheet_weeks where tenant_id='${tenant}' and created_at >= '${start}'`) === '0'
  && sql(`select count(*) from hrms.time_entries where tenant_id='${tenant}' and created_at >= '${start}'`) === '0'
  && sql(`select count(*) from hrms.projects where tenant_id='${tenant}' and created_at >= '${start}'`) === '0'
  && sql(`select count(*) from hrms.report_exports where tenant_id='${tenant}' and report='muster-roll' and created_at >= '${start}'`) === '0'
  && (ruleWas !== 'none' || sql(`select count(*) from hrms.employee_punch_rules where tenant_id='${tenant}' and employee_id='${FIN}'`) === '0')
  && sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and created_at >= '${start}' and type in ('TIMESHEET_SUBMITTED','TIMESHEET_DECIDED','CORRECTION_SUBMITTED','CORRECTION_APPROVED')`) === '0')

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
