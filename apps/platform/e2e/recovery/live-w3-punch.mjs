// Live API check for w3/punch (V143.40): a manager or HR punches an employee in
// or out with the employee's face, on the manager's phone ("Punch for team
// member" in the mobile app). No mobile here: the API the app calls, plus one
// look at the web Face Punch tab for "Punched by".
//
// What it proves, against a running backend and its database:
//  - the two permissions are in the token of the roles that should have them
//    (owner: both; mgr@ DEPT_MANAGER: team; hrm@ HR_MANAGER: anyone; reader@ none)
//  - reader@ (no permission) gets 403 on both endpoints
//  - mgr@ may list and target their report (reader@) but not someone outside
//    the team (hrm@), and never themself; owner@ can list anyone
//  - a person without a face enrolment is refused (FACE_NOT_ENROLLED)
//  - a phone outside the employee's work area is refused (OUTSIDE_GEOFENCE),
//    before the face is checked
//  - a face that doesn't match is refused and nothing is punched
//  - night shift: someone punched in yesterday evening is listed as in, and a
//    punch out after midnight closes yesterday's shift (no new day); a shift
//    left open over 20 hours is refused before the face is scanned
//  - success: the punch lands on the EMPLOYEE's attendance (FACE_RECOGNITION),
//    "punched by" is stored, the audit log has it; a second punch in is
//    refused; owner@ and hrm@ punching out at the same moment: one wins, the
//    other gets ALREADY_CHECKED_OUT and only one "punched by" is recorded
//  - the web shows "Punched by": the Face Punch tab, Daily Logs (row and the
//    day drawer) and the employee's attendance records (GET /punched-by, which
//    reader@ without team attendance can't read)
//
// The face worker (Python, SFace) doesn't run locally, so the success path uses
// a tiny stand-in worker on :8091 that the backend's FaceWorkerClient talks to:
// it "detects" one face in every photo and scores a photo starting with MATCH
// as a match and anything else as a stranger. The Spring side (enrolment,
// encrypted templates, thresholds, quorum, lockout, audit) is the real code.
// If :8091 is taken (a real worker), the success path is skipped and says so.
//
// Everything it creates is removed at the end.
//
//   RECOVERY_API_URL=http://127.0.0.1:8080/api RECOVERY_DB=ut_w3_dev node e2e/recovery/live-w3-punch.mjs
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222' // employee id and login id
const HRM = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444'
const FIN = '55555555-5555-5555-5555-555555555555'
const PERM_TEAM = 'attendance.assisted_punch.team'
const PERM_ANY = 'attendance.assisted_punch.any'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const shots = '/c/REACT/ut-wt/_results/shots'.replace(/^\/c\//, 'C:/')

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => console.log(`SKIP  ${name}  — ${why}`)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

// ── a stand-in face worker (see the header) ──────────────────────────────────
const b64 = (s) => Buffer.from(s).toString('base64')
const MATCH_PHOTO = b64('MATCH-photo-of-reader-' + Date.now())
const STRANGER_PHOTO = b64('STRANGER-photo-' + Date.now())
const embedding = (() => { const f = new Float32Array(128); for (let i = 0; i < 128; i++) f[i] = Math.sin(i + 1) / 8; return Buffer.from(f.buffer).toString('base64') })()
const workerCalls = []
const worker = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    workerCalls.push(req.url)
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
const workerUp = await new Promise((resolve) => {
  worker.once('error', () => resolve(false))
  worker.listen(8091, () => resolve(true))
})

// ── where the reader's work area is (the resolver's rule: zone, else branch, else HQ / first active branch) ──
function workArea() {
  const row = sql(`select coalesce(z.latitude, b.latitude, hq.latitude) || '|' || coalesce(z.longitude, b.longitude, hq.longitude)
      from hrms.employees e
      left join public.geo_fence_zones z on z.id = e.geo_fence_zone_id and z.is_active
      left join org.branches b on b.id = e.branch_id
      left join lateral (select latitude, longitude from org.branches where company_id = e.company_id and is_active
                          order by is_headquarters desc, name asc limit 1) hq on true
     where e.id = '${READER}'`)
  const [lat, lng] = row.split('|').map(Number)
  return { lat, lng }
}

const start = sql(`select now()`)
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const hadEnrollment = sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) !== '0'
const readerHadRecord = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) !== '0'
const finEnrolled = sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${FIN}' and status='ACTIVE'`) !== '0'
const yesterday = sql(`select (now() at time zone 'Asia/Kolkata')::date - 1`)
const readerHadYesterday = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${yesterday}'`) !== '0'
let createdEnrollment = false
let nightRecord = null // yesterday's shift the night-shift check seeds

function removeNight() {
  if (!nightRecord) return
  sql(`delete from attendance.event_logs where record_id::text = '${nightRecord}'`)
  try { sql(`delete from attendance.assisted_punches where attendance_record_id = '${nightRecord}'`) } catch { /* table missing */ }
  sql(`delete from attendance.records where id = '${nightRecord}' and attendance_date = '${yesterday}'`)
  nightRecord = null
}

function cleanup() {
  removeNight()
  const ids = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from attendance.records where employee_id='${READER}' and attendance_date='${today}' and created_at >= '${start}'`)
  if (ids) {
    sql(`delete from attendance.event_logs where record_id::text in (${ids})`)
    sql(`delete from attendance.records where id::text in (${ids})`)
  }
  try { sql(`delete from attendance.assisted_punches where tenant_id='${tenant}' and created_at >= '${start}'`) } catch { /* table missing: nothing to remove */ }
  sql(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}','${HRM}') and created_at >= '${start}'`)
  sql(`delete from public.geo_fence_audits where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}') and created_at >= '${start}'`)
  try { sql(`delete from audit.events where tenant_id='${tenant}' and module='attendance' and action like 'ASSISTED_PUNCH_%' and occurred_at >= '${start}'`) } catch { /* append-only where enforced */ }
  if (createdEnrollment) {
    sql(`delete from attendance.face_embedding_templates where tenant_id='${tenant}' and employee_id='${READER}'`)
    sql(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
  }
}

try {
  const owner = await login('owner@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── permissions in the token ──
  check('owner holds both assisted-punch permissions', owner.perms.includes(PERM_TEAM) && owner.perms.includes(PERM_ANY))
  check('DEPT_MANAGER holds "their team" only', mgr.perms.includes(PERM_TEAM) && !mgr.perms.includes(PERM_ANY))
  check('HR_MANAGER holds "anyone"', hrm.perms.includes(PERM_ANY))
  check('EMPLOYEE holds neither', !reader.perms.includes(PERM_TEAM) && !reader.perms.includes(PERM_ANY))
  check('the permissions are in the Attendance group of the catalogue',
    sql(`select count(*) from rbac.permissions where module='attendance' and code in ('${PERM_TEAM}','${PERM_ANY}') and display_name like 'Punch in/out for%'`) === '2')

  // ── who may be listed / targeted ──
  const area = workArea()
  const inside = { latitude: area.lat, longitude: area.lng, accuracy: 8, deviceId: 'live-w3-punch' }
  const punch = (who, employeeId, type = 'CHECK_IN', imageBase64 = MATCH_PHOTO, where = inside) =>
    who.call('POST', '/v1/attendance/assisted-punch', { employeeId, type, imageBase64, challengePerformed: 'BLINK', ...where })

  const rl = await reader.call('GET', '/v1/attendance/assisted-punch/eligible')
  const rp = await punch(reader, MGR)
  check('reader@ (no permission): 403 on the list and on a punch', rl.status === 403 && rp.status === 403, `${rl.status} / ${rp.status}`)

  const ml = await mgr.call('GET', '/v1/attendance/assisted-punch/eligible')
  const mIds = (ml.json?.employees || []).map((e) => e.employeeId)
  check('mgr@ lists their report and nobody outside the team, never themself',
    ml.status === 200 && ml.json.scope === 'TEAM' && mIds.includes(READER) && !mIds.includes(HRM) && !mIds.includes(MGR), `${ml.status} ${JSON.stringify(mIds)}`)
  const mq = await mgr.call('GET', '/v1/attendance/assisted-punch/eligible?q=zzzz-nobody')
  check('the list searches by name / code', mq.status === 200 && mq.json.employees.length === 0)
  const ol = await owner.call('GET', '/v1/attendance/assisted-punch/eligible')
  const oIds = (ol.json?.employees || []).map((e) => e.employeeId)
  check('owner@ lists anyone (reader, mgr, hrm, fin)', ol.status === 200 && ol.json.scope === 'ANY' && [READER, MGR, HRM, FIN].every((id) => oIds.includes(id)), `${oIds.length} people`)

  const mOut = await punch(mgr, HRM)
  check('mgr@ can\'t punch for someone outside their team (403)', mOut.status === 403 && mOut.json?.errorCode === 'ASSISTED_PUNCH_NOT_IN_TEAM', `${mOut.status} ${mOut.json?.errorCode}: ${mOut.json?.message}`)
  const mSelf = await punch(mgr, MGR)
  check('mgr@ can\'t punch for themself', mSelf.status >= 400 && mSelf.status < 500 && mSelf.json?.errorCode === 'ASSISTED_PUNCH_SELF', `${mSelf.status} ${mSelf.json?.errorCode}`)
  const ownerEmp = sql(`select employee_id from auth.user_credentials where email='owner@unifiedtree.demo' and tenant_id='${tenant}'`)
  const oSelf = await punch(owner, ownerEmp)
  check('owner@ can\'t punch for themself either', oSelf.status >= 400 && oSelf.status < 500 && oSelf.json?.errorCode === 'ASSISTED_PUNCH_SELF', `${oSelf.status} ${oSelf.json?.errorCode}`)

  // ── not enrolled ──
  if (!finEnrolled) {
    const hFin = await punch(hrm, FIN)
    check('hrm@ ("anyone") reaches fin@, who has no face enrolment: 409 FACE_NOT_ENROLLED', hFin.status === 409 && hFin.json?.errorCode === 'FACE_NOT_ENROLLED', `${hFin.status} ${hFin.json?.message}`)
  } else skip('not-enrolled check via fin@', 'fin@ has a face enrolment in this database')
  if (!hadEnrollment) {
    const mNe = await punch(mgr, READER)
    check('mgr@ → reader@ before enrolment: 409 FACE_NOT_ENROLLED, nothing punched', mNe.status === 409 && mNe.json?.errorCode === 'FACE_NOT_ENROLLED'
      && sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}' and created_at >= '${start}'`) === '0', `${mNe.status} ${mNe.json?.message}`)
    const listed = ml.json.employees.find((e) => e.employeeId === READER)
    check('the list shows reader@ as not enrolled', listed?.faceStatus === 'NOT_ENROLLED', listed?.faceStatus)
  }

  // ── enrol reader@ (through the face module, against the stand-in worker) ──
  let enrolled = hadEnrollment && sql(`select status from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) === 'ACTIVE'
  if (workerUp && !hadEnrollment) {
    const st = await reader.call('POST', '/v1/attendance/face/enroll/start', { deviceFingerprint: 'live-w3-punch' })
    createdEnrollment = st.status === 200
    let ok = st.status === 200
    for (const angle of ['FRONT', 'LEFT_30', 'RIGHT_30']) {
      if (!ok) break
      const s = await reader.call('POST', '/v1/attendance/face/enroll/sample', { enrollmentId: st.json.enrollmentId, captureAngle: angle, imageBase64: MATCH_PHOTO, challengePerformed: 'BLINK' })
      ok = s.status === 200 && s.json?.accepted === true
    }
    const done = ok ? await reader.call('POST', '/v1/attendance/face/enroll/complete') : { status: 0 }
    enrolled = done.status === 200
    check('reader@ enrols their face (stand-in worker)', enrolled, `start ${st.status} complete ${done.status}`)
  }

  // ── outside the work area ──
  if (enrolled) {
    const far = { latitude: 0.5, longitude: 0.5, accuracy: 10, deviceId: 'live-w3-punch' }
    const before = workerCalls.filter((u) => u === '/face/verify').length
    const out = await punch(mgr, READER, 'CHECK_IN', MATCH_PHOTO, far)
    check('outside the employee\'s work area: 422 OUTSIDE_GEOFENCE', out.status === 422 && out.json?.errorCode === 'OUTSIDE_GEOFENCE', `${out.status} ${out.json?.message}`)
    check('…and the face was not even checked', workerCalls.filter((u) => u === '/face/verify').length === before)
  } else skip('outside-geofence rejection', 'reader@ has no active face enrolment and the stand-in worker could not start')

  // ── night shift: punched in yesterday evening, punched out after midnight ──
  // (The closed shift stays until cleanup, so Daily Logs can show it when today is a weekly off.)
  if (enrolled && workerUp && !readerHadYesterday && !readerHadRecord) {
    // First left open longer than the 20 hours AttendanceService.checkOut allows.
    nightRecord = sql(`insert into attendance.records (id, tenant_id, employee_id, company_id, attendance_date, check_in_at, attendance_type, attendance_status, check_in_method)
        values (gen_random_uuid(), '${tenant}', '${READER}', '${company}', '${yesterday}', now() - interval '21 hours', 'OFFICE', 'PRESENT', 'FACE_RECOGNITION') returning id`).split(/\r?\n/)[0].trim()
    const stale = (await mgr.call('GET', '/v1/attendance/assisted-punch/eligible')).json?.employees?.find((e) => e.employeeId === READER)
    check('a shift left open over 20 hours is not listed as in', stale?.todayStatus === 'NOT_PUNCHED' && stale?.sinceYesterday === false, `${stale?.todayStatus} ${stale?.sinceYesterday}`)
    const before = workerCalls.filter((u) => u === '/face/verify').length
    const sOut = await punch(mgr, READER, 'CHECK_OUT')
    check('…and punching it out is refused (409 NOT_CHECKED_IN) before the face is scanned',
      sOut.status === 409 && sOut.json?.errorCode === 'NOT_CHECKED_IN' && workerCalls.filter((u) => u === '/face/verify').length === before,
      `${sOut.status} ${sOut.json?.errorCode}`)

    // Then punched in four hours ago: still in, and the next punch closes yesterday's shift.
    sql(`update attendance.records set check_in_at = now() - interval '4 hours' where id='${nightRecord}' and attendance_date='${yesterday}'`)
    const nl = (await mgr.call('GET', '/v1/attendance/assisted-punch/eligible')).json?.employees?.find((e) => e.employeeId === READER)
    check('night shift: reader@, punched in yesterday evening, is listed as in (next punch: out)', nl?.todayStatus === 'PUNCHED_IN' && nl?.sinceYesterday === true, `${nl?.todayStatus} ${nl?.sinceYesterday}`)
    const nOut = await punch(mgr, READER, 'CHECK_OUT')
    const closed = sql(`select (check_out_at is not null) from attendance.records where id='${nightRecord}' and attendance_date='${yesterday}'`)
    check('night shift: mgr@ punches reader@ out after midnight; it closes yesterday\'s shift and starts no new day',
      nOut.status === 200 && closed === 't' && sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === '0',
      `${nOut.status} ${nOut.json?.message ?? ''} closed=${closed}`)
    check('night shift: "punched by" is filed on yesterday\'s day',
      sql(`select count(*) from attendance.assisted_punches where attendance_record_id='${nightRecord}' and attendance_date='${yesterday}' and punch_type='CHECK_OUT'`) === '1')
    const pb = await mgr.call('GET', `/v1/attendance/assisted-punch/punched-by?from=${yesterday}&to=${yesterday}`)
    check('night shift: the web "Punched by" API has it on yesterday', pb.status === 200
      && pb.json.some((p) => p.employeeId === READER && p.punchType === 'CHECK_OUT' && p.punchedByName === 'Dept Manager' && p.attendanceDate === yesterday),
      `${pb.status} ${JSON.stringify(pb.json)?.slice(0, 200)}`)
  } else {
    skip('night shift', !enrolled || !workerUp ? 'reader@ is not enrolled / the stand-in worker could not start'
      : 'reader@ already has attendance yesterday or today in this database')
  }

  // ── success path ──
  if (enrolled && workerUp && !readerHadRecord) {
    const bad = await punch(mgr, READER, 'CHECK_IN', STRANGER_PHOTO)
    check('a face that isn\'t reader@: 403 FAIL_MATCH, nothing punched', bad.status === 403 && bad.json?.errorCode === 'FAIL_MATCH'
      && sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}' and created_at >= '${start}'`) === '0', `${bad.status} ${bad.json?.message}`)

    const ok = await punch(mgr, READER)
    check('mgr@ punches reader@ in with reader@\'s face: 200', ok.status === 200 && ok.json?.employeeName === 'Reader User' && ok.json?.punchedByName === 'Dept Manager' && ok.json?.type === 'CHECK_IN',
      `${ok.status} ${JSON.stringify(ok.json)?.slice(0, 200)}`)
    const rec = sql(`select check_in_method || '|' || (check_in_at is not null) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`)
    check('the punch is on reader@\'s own attendance as a face punch', rec === 'FACE_RECOGNITION|true', rec)
    const by = sql(`select punched_by_employee_id || '|' || punch_type || '|' || (face_event_id is not null) || '|' || within_fence from attendance.assisted_punches where employee_id='${READER}' and punch_type='CHECK_IN' and created_at >= '${start}'`)
    check('"punched by" is stored (manager, check-in, the face check, inside the area)', by === `${MGR}|CHECK_IN|true|true`, by)
    check('the audit log has it', sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='ASSISTED_PUNCH_IN' and entity_id='${READER}' and occurred_at >= '${start}'`) === '1')
    const again = await punch(mgr, READER)
    check('a second punch in the same day is refused (409 ALREADY_CHECKED_IN)', again.status === 409 && again.json?.errorCode === 'ALREADY_CHECKED_IN', `${again.status} ${again.json?.message}`)
    const listed = (await mgr.call('GET', '/v1/attendance/assisted-punch/eligible')).json.employees.find((e) => e.employeeId === READER)
    check('the list now shows reader@ enrolled and punched in', listed?.faceStatus === 'ENROLLED' && listed?.todayStatus === 'PUNCHED_IN' && listed?.sinceYesterday === false, `${listed?.faceStatus} ${listed?.todayStatus}`)

    const fe = await mgr.call('GET', `/v1/attendance/review/face-events?from=${today}&to=${today}`)
    const ev = (fe.json || []).find((e) => e.employeeId === READER && e.result === 'PASS' && e.purpose === 'PUNCH_IN')
    check('the web face-events API says who punched (punchedBy)', fe.status === 200 && ev?.punchedBy === 'Dept Manager' && ev?.device === 'live-w3-punch', `${fe.status} ${ev?.punchedBy} ${ev?.device}`)

    // "Punched by" for Daily Logs / the employee's records: who may read it.
    const pbPath = `/v1/attendance/assisted-punch/punched-by?from=${today}&to=${today}`
    const [pbOwner, pbMgr, pbReader, pbOne] = await Promise.all([owner.call('GET', pbPath), mgr.call('GET', pbPath), reader.call('GET', pbPath),
      owner.call('GET', `${pbPath}&employeeId=${READER}`)])
    const hasIn = (r) => r.status === 200 && r.json.some((p) => p.employeeId === READER && p.punchType === 'CHECK_IN' && p.punchedByName === 'Dept Manager' && p.attendanceDate === today)
    check('the web "Punched by" API: owner@ and mgr@ (their report) see it, also asked for one employee', hasIn(pbOwner) && hasIn(pbMgr) && hasIn(pbOne), `${pbOwner.status} ${pbMgr.status} ${pbOne.status}`)
    check('…reader@ (no team attendance) gets 403', pbReader.status === 403, String(pbReader.status))
    const pbLong = await owner.call('GET', '/v1/attendance/assisted-punch/punched-by?from=2026-01-01&to=2026-12-31')
    check('…a range over 92 days is refused (422)', pbLong.status === 422 && pbLong.json?.errorCode === 'DATE_RANGE_TOO_LONG', `${pbLong.status} ${pbLong.json?.errorCode}`)

    // Two people punch reader@ out at the same moment: one wins, the other is told it's done.
    const [o1, o2] = await Promise.all([punch(owner, READER, 'CHECK_OUT'), punch(hrm, READER, 'CHECK_OUT')])
    const won = [o1, o2].filter((r) => r.status === 200 && r.json?.type === 'CHECK_OUT' && r.json?.attendance?.checkOutTime)
    const lost = [o1, o2].filter((r) => r.status === 409 && r.json?.errorCode === 'ALREADY_CHECKED_OUT')
    check('owner@ and hrm@ punch reader@ out at the same moment: one 200, one 409 ALREADY_CHECKED_OUT', won.length === 1 && lost.length === 1,
      `${o1.status} ${o1.json?.errorCode ?? ''} / ${o2.status} ${o2.json?.errorCode ?? ''}`)
    const outBy = sql(`select count(*) || '|' || coalesce(max(punched_by_name), '') from attendance.assisted_punches where employee_id='${READER}' and attendance_date='${today}' and punch_type='CHECK_OUT'`)
    check('…and only one "punched out by" is recorded, the winner\'s', outBy === `1|${won[0]?.json?.punchedByName}`, outBy)
    const outAgain = await punch(owner, READER, 'CHECK_OUT')
    check('a later punch out is refused (409 ALREADY_CHECKED_OUT)', outAgain.status === 409 && outAgain.json?.errorCode === 'ALREADY_CHECKED_OUT', `${outAgain.status}`)
    const outName = won[0]?.json?.punchedByName || ''
    const detail = `Dept Manager (in), ${outName} (out)`
    // Daily Logs leaves out anyone whose weekly off is that day: use today when reader@ is on today's
    // roster, else yesterday (the night shift mgr@ punched out, kept until cleanup).
    const onRoster = async (d) => ((await owner.call('GET', `/v1/attendance/dashboard?date=${d}`)).json?.staffStatuses || []).some((s) => s.employeeId === READER)
    const logDay = (await onRoster(today)) ? today : nightRecord && (await onRoster(yesterday)) ? yesterday : null
    const logDetail = logDay === today ? detail : 'Dept Manager (out)'

    // The web, owner's view (desktop and phone): Face Punch tab, Daily Logs (row + day drawer), the employee's records.
    const browser = await chromium.launch({ headless: true })
    try {
      for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport })
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
        await page.goto(base + '/login')
        await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
        await page.locator('input[type=password]').fill(password)
        await page.locator('button[type=submit]').click()
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
        mkdirSync(shots, { recursive: true })
        const sees = async (text) => { try { await page.getByText(text).first().waitFor({ timeout: 30_000 }); return true } catch { return false } }

        await page.goto(base + '/hrms/attendance?tab=face')
        const all = page.getByRole('button', { name: /All punches/ })
        if (await all.count()) await all.first().click().catch(() => {})
        const seenFace = await sees('Punched by Dept Manager')
        await page.screenshot({ path: `${shots}/punch-face-tab-${label}.png`, fullPage: false })
        check(`web Face Punch tab (${label}) shows "Punched by Dept Manager"`, seenFace)

        if (logDay) {
          await page.goto(base + `/hrms/attendance?tab=team${logDay === today ? '' : `&date=${logDay}`}`)
          const seenRow = await sees(/Punched by Dept Manager/)
          await page.getByText('Reader User').first().scrollIntoViewIfNeeded().catch(() => {})
          await page.screenshot({ path: `${shots}/punch-daily-logs-${label}.png`, fullPage: false })
          check(`web Daily Logs ${logDay} (${label}): reader@'s row says "Punched by Dept Manager"`, seenRow)
          if (seenRow) {
            await page.getByText('Reader User').first().click()
            const seenDrawer = await sees(logDetail)
            await page.screenshot({ path: `${shots}/punch-daily-drawer-${label}.png`, fullPage: false })
            check(`web Daily Logs day drawer (${label}): Punched by "${logDetail}"`, seenDrawer)
          }
        } else skip(`web Daily Logs (${label})`, 'today and yesterday are both off days in the Daily Logs roster for reader@')

        await page.goto(base + `/hrms/employees/${READER}?tab=attendance`)
        const seenRecords = await sees(`Punched by ${detail}`)
        await page.getByText(`Punched by ${detail}`).first().scrollIntoViewIfNeeded().catch(() => {})
        await page.screenshot({ path: `${shots}/punch-employee-records-${label}.png`, fullPage: false })
        check(`web employee attendance records (${label}): "Punched by ${detail}"`, seenRecords)

        check(`web (${label}): no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
        await ctx.close()
      }
    } finally { await browser.close() }
  } else {
    skip('success path (match, punch, punched by, web, punch out)',
      !workerUp ? 'port 8091 is in use (a real face worker?), so the stand-in worker could not start'
        : readerHadRecord ? 'reader@ already has attendance today in this database' : 'reader@ is not enrolled')
  }

  // ── nothing else moved: My team for the manager is unchanged ──
  const ex = await mgr.call('GET', `/v1/attendance/review/exceptions?from=${today}&to=${today}`)
  check('regression: the manager\'s review list (My team scope) still loads', ex.status === 200, String(ex.status))
} catch (e) {
  check('run without an exception', false, e?.stack || String(e))
} finally {
  try { cleanup() } catch (e) { check('cleanup', false, String(e)) }
  worker.close()
  let leftovers = 'unknown'
  try {
    const punchedBy = sql(`select to_regclass('attendance.assisted_punches') is not null`) === 't'
      ? `+ (select count(*) from attendance.assisted_punches where tenant_id='${tenant}' and created_at >= '${start}')` : ''
    leftovers = sql(`select (select count(*) from attendance.records where employee_id='${READER}' and attendance_date in ('${today}','${yesterday}') and created_at >= '${start}')
      + (select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}') and created_at >= '${start}')
      ${punchedBy}`)
  } catch (e) { leftovers = String(e).split('\n')[0] }
  check('cleanup: nothing left behind', leftovers === '0', leftovers)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
