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
//  - success: the punch lands on the EMPLOYEE's attendance (FACE_RECOGNITION),
//    "punched by" is stored, the audit log has it, the web Face Punch tab says
//    "Punched by Dept Manager"; a second punch in is refused; owner@ punches out
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
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3019'
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
let createdEnrollment = false

function cleanup() {
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
    const by = sql(`select punched_by_employee_id || '|' || punch_type || '|' || (face_event_id is not null) || '|' || within_fence from attendance.assisted_punches where employee_id='${READER}' and created_at >= '${start}'`)
    check('"punched by" is stored (manager, check-in, the face check, inside the area)', by === `${MGR}|CHECK_IN|true|true`, by)
    check('the audit log has it', sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='ASSISTED_PUNCH_IN' and entity_id='${READER}' and occurred_at >= '${start}'`) === '1')
    const again = await punch(mgr, READER)
    check('a second punch in the same day is refused (409 ALREADY_CHECKED_IN)', again.status === 409 && again.json?.errorCode === 'ALREADY_CHECKED_IN', `${again.status} ${again.json?.message}`)
    const listed = (await mgr.call('GET', '/v1/attendance/assisted-punch/eligible')).json.employees.find((e) => e.employeeId === READER)
    check('the list now shows reader@ enrolled and punched in', listed?.faceStatus === 'ENROLLED' && listed?.todayStatus === 'PUNCHED_IN', `${listed?.faceStatus} ${listed?.todayStatus}`)

    const fe = await mgr.call('GET', `/v1/attendance/review/face-events?from=${today}&to=${today}`)
    const ev = (fe.json || []).find((e) => e.employeeId === READER && e.result === 'PASS' && e.purpose === 'PUNCH_IN')
    check('the web face-events API says who punched (punchedBy)', fe.status === 200 && ev?.punchedBy === 'Dept Manager' && ev?.device === 'live-w3-punch', `${fe.status} ${ev?.punchedBy} ${ev?.device}`)

    // The web Face Punch tab (desktop and phone), owner's view.
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
        await page.goto(base + '/hrms/attendance?tab=face')
        const all = page.getByRole('button', { name: /All punches/ })
        if (await all.count()) await all.first().click().catch(() => {})
        let seen = false
        try { await page.getByText('Punched by Dept Manager').first().waitFor({ timeout: 30_000 }); seen = true } catch { /* reported below */ }
        mkdirSync(shots, { recursive: true })
        await page.screenshot({ path: `${shots}/punch-face-tab-${label}.png`, fullPage: false })
        check(`web Face Punch tab (${label}) shows "Punched by Dept Manager"`, seen)
        check(`web Face Punch tab (${label}): no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
        await ctx.close()
      }
    } finally { await browser.close() }

    const out = await punch(owner, READER, 'CHECK_OUT')
    check('owner@ ("anyone") punches reader@ out: 200', out.status === 200 && out.json?.type === 'CHECK_OUT' && out.json?.attendance?.checkOutTime, `${out.status} ${out.json?.message ?? ''}`)
    check('…recorded as punched out by the owner', sql(`select count(*) from attendance.assisted_punches where employee_id='${READER}' and punch_type='CHECK_OUT' and created_at >= '${start}'`) === '1')
    const outAgain = await punch(owner, READER, 'CHECK_OUT')
    check('a second punch out is refused (409 ALREADY_CHECKED_OUT)', outAgain.status === 409 && outAgain.json?.errorCode === 'ALREADY_CHECKED_OUT', `${outAgain.status}`)
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
  const leftovers = sql(`select (select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}' and created_at >= '${start}')
      + (select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}') and created_at >= '${start}')`)
  check('cleanup: nothing left behind', leftovers === '0', leftovers)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
