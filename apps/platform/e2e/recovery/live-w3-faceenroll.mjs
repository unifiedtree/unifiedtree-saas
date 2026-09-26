// Live check of face enrollment on the web (wave 3), against the local API,
// with Chromium's fake camera (a moving test pattern, no face in it).
//
//   API    reader may read their own face status, and gets 403 on every route
//          that enrolls someone else; owner reads another person's status by
//          their employee id, and an employee with no sign-in can't be enrolled.
//   Audit  one audit entry per finished enrollment: "enrolled" for a first one
//          (even after an abandoned try), "re-enrolled" over an earlier face,
//          also when a status check finishes it (then by whoever looked).
//   Lock   a locked face check says when it clears; your own re-enroll is
//          refused until then and allowed after (the server unlocks on start).
//   Self   reader opens Profile → Face enrollment → Enroll my face: the camera
//          preview shows, a photo can be retaken, the three photos are reviewed,
//          Save needs the consent box, and a refused photo is explained plainly.
//          With a face worker running on :8091 the "no face found" answer is the
//          real one for the fake video; without one Save stops at "service not
//          available" before sending, Send again reaches the server (503), and
//          "no face found" is then played back at the network layer.
//          Locked on the profile: no button until the lock's time, then
//          Re-enroll; once a re-enroll has started, a refusal says face punch-in
//          is off until new photos are accepted.
//   HR     owner sees Enroll face on an employee's record and the drawer opens
//          on that person, with the camera.
//   Real   only with the face worker and FACE_VIDEO (a .y4m of a real face, fed
//          to the fake camera): reader enrolls for real, a phone-style punch
//          photo (FACE_PUNCH) then passes the face check, and owner re-enrolls
//          reader's face from the record; each writes its audit entry.
// Screenshots (1440 and 390 wide) go to _results/shots/faceenroll-*.png.
// Rows the run creates (reader's enrollment, face events, audit entries and
// face notifications) are deleted at the end; anything that would replace an
// enrollment reader already had is skipped.
//
//   node e2e/recovery/live-w3-faceenroll.mjs
//   FACE_VIDEO=C:/path/face.y4m FACE_PUNCH=C:/path/punch.jpg node e2e/recovery/live-w3-faceenroll.mjs
/* global document, window, console, process, fetch */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { format } from 'date-fns'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3020'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shotDir = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const faceVideo = process.env.FACE_VIDEO && existsSync(process.env.FACE_VIDEO) ? process.env.FACE_VIDEO : null
const facePunch = process.env.FACE_PUNCH && existsSync(process.env.FACE_PUNCH) ? process.env.FACE_PUNCH : null
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const READER = '22222222-2222-2222-2222-222222222222' // reader's login and employee id
const MANAGER_EMP = '44444444-4444-4444-4444-444444444444'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shotDir, { recursive: true })

const login = async (email) => (await (await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })).json()).accessToken
const call = (token, method, path, body) => fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
const startedAt = sql('select now()')
const hadEnrollment = Number(sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)) > 0
const worker = await fetch('http://127.0.0.1:8091/health').then((r) => r.json()).then((j) => !!j.models_loaded, () => false)
const OWNER = sql(`select id from auth.user_credentials where tenant_id='${tenant}' and email='owner@unifiedtree.demo'`)
console.log(`face worker on :8091: ${worker ? 'running' : 'not running'}; face video: ${faceVideo ? 'yes' : 'no'}; reader had an enrollment: ${hadEnrollment}`)

// Reader's face rows (only ever touched when reader had none to begin with).
const clearReader = () => sql(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
const readerRow = (col) => sql(`select ${col} from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
const lockReader = (minutesAgo) => sql(`update attendance.face_enrollments set status='LOCKED', consecutive_failures=8, locked_reason='live test', locked_at = now() - interval '${minutesAgo} minutes' where tenant_id='${tenant}' and employee_id='${READER}'`)
/** This run's audit entries about reader's face: "ACTION|actor|summary". */
const audits = () => sql(`select action || '|' || actor_user_id || '|' || summary from audit.events where tenant_id='${tenant}' and module='attendance' and action in ('FACE_ENROLLED','FACE_REENROLLED') and entity_id='${READER}' and occurred_at >= '${startedAt}' order by occurred_at`).split('\n').filter(Boolean)

// ── API: who may do what ──
const reader = await login('reader@unifiedtree.demo'), owner = await login('owner@unifiedtree.demo')
check('reader can read their own face status', (await call(reader, 'GET', '/v1/attendance/face/enrollment-status')).status === 200)
const adm = `/v1/attendance/face/admin/employees/${MANAGER_EMP}`
const denied = []
for (const [m, p, b] of [['GET', `${adm}/enrollment-status`], ['POST', `${adm}/enroll/start`, {}], ['POST', `${adm}/enroll/sample`, { enrollmentId: READER, captureAngle: 'FRONT', imageBase64: 'AAAA' }], ['POST', `${adm}/enroll/complete`, {}]]) {
  const r = await call(reader, m, p, b)
  if (r.status !== 403) denied.push(`${m} ${p.split('/admin')[1]} → ${r.status}`)
}
check('reader gets 403 enrolling someone else through the API', denied.length === 0, denied.join('; '))
const ownerView = await call(owner, 'GET', `/v1/attendance/face/admin/employees/${READER}/enrollment-status`)
const ownerJson = ownerView.status === 200 ? await ownerView.json() : {}
check('owner reads an employee’s face status by employee id', ownerView.status === 200 && ownerJson.hasLogin === true && !!ownerJson.status, `${ownerView.status} ${JSON.stringify(ownerJson).slice(0, 120)}`)
const noLogin = sql(`select e.id from hrms.employees e where e.tenant_id='${tenant}' and e.is_active and not exists (select 1 from auth.user_credentials uc where uc.employee_id=e.id and uc.is_active) limit 1`)
if (noLogin) {
  const s = await (await call(owner, 'GET', `/v1/attendance/face/admin/employees/${noLogin}/enrollment-status`)).json()
  const st = await call(owner, 'POST', `/v1/attendance/face/admin/employees/${noLogin}/enroll/start`, {})
  const body = await st.json().catch(() => ({}))
  check('someone with no sign-in shows as such and can’t be enrolled', s.hasLogin === false && st.status === 409 && /^FACE_NO_LOGIN:/.test(body.message || ''), `${st.status} ${body.message || ''}`)
}

// ── API: audit entries and the lock (photos marked accepted in the DB; no face needed) ──
if (hadEnrollment) {
  console.log('SKIP  audit and lock checks — reader already has a face enrollment here')
} else {
  const start = () => call(reader, 'POST', '/v1/attendance/face/enroll/start', { deviceFingerprint: 'live test' })
  const complete = () => call(reader, 'POST', '/v1/attendance/face/enroll/complete', {})
  const allAccepted = () => sql(`update attendance.face_enrollments set samples_captured = 3 where tenant_id='${tenant}' and employee_id='${READER}'`)
  const readerStatus = async () => (await call(reader, 'GET', '/v1/attendance/face/enrollment-status')).json()

  clearReader()
  const s1 = await start(); allAccepted(); const c1 = await complete(); await complete() // the phone completes twice
  let a = audits()
  check('a first enrollment writes one audit entry, “enrolled”', s1.status === 200 && c1.status === 200 && a.length === 1 && a[0].startsWith(`FACE_ENROLLED|${READER}|Enrolled their own face`), a.join(' / '))

  await start()
  const marked = readerRow('revoked_reason')
  allAccepted(); await complete()
  a = audits()
  check('re-enrolling over a face is audited as a replacement', marked === 'Replaced by a new enrollment' && a.length === 2 && a[1].startsWith(`FACE_REENROLLED|${READER}|Re-enrolled their own face. The earlier face record was replaced.`), `${marked} / ${a.at(-1)}`)

  clearReader(); await start(); await start(); allAccepted(); await complete()
  a = audits()
  check('a first enrollment after an abandoned try is not called a replacement', a.length === 3 && a[2].startsWith('FACE_ENROLLED|'), a.at(-1))

  clearReader(); await start(); allAccepted()
  const healed = await readerStatus()
  await complete()
  a = audits()
  check('an enrollment finished by a status check is audited once', healed.status === 'ACTIVE' && a.length === 4 && a[3].startsWith(`FACE_ENROLLED|${READER}|`), `${healed.status} / ${a.length}`)

  await start(); allAccepted()
  const hrSaw = await (await call(owner, 'GET', `/v1/attendance/face/admin/employees/${READER}/enrollment-status`)).json()
  a = audits()
  check('…and by HR’s status check, recorded as HR', hrSaw.status === 'ACTIVE' && a.length === 5 && a[4].startsWith(`FACE_REENROLLED|${OWNER}|Re-enrolled Reader User's face.`), a.at(-1))

  lockReader(10)
  const locked = await readerStatus()
  const mins = locked.unlocksAt ? (new Date(locked.unlocksAt).getTime() - Date.now()) / 60000 : NaN
  check('a locked face check says when it clears by itself', locked.status === 'LOCKED' && mins > 18 && mins < 21, `${locked.status} unlocksAt=${locked.unlocksAt} (${mins.toFixed(1)} min)`)
  const tooSoon = await start()
  const tooSoonBody = await tooSoon.json().catch(() => ({}))
  check('your own re-enroll is refused while the lock lasts', tooSoon.status === 403 && /^FACE_LOCKED:/.test(tooSoonBody.message || ''), `${tooSoon.status}`)
  const hrLocked = await (await call(owner, 'GET', `/v1/attendance/face/admin/employees/${READER}/enrollment-status`)).json()
  check('HR sees the same unlock time', hrLocked.status === 'LOCKED' && hrLocked.unlocksAt === locked.unlocksAt)
  lockReader(31)
  const due = await readerStatus()
  check('reading the status never unlocks by itself', due.status === 'LOCKED' && new Date(due.unlocksAt).getTime() < Date.now())
  const after = await start()
  check('after the lock’s time your own re-enroll starts (and replaces the face)', after.status === 200 && readerRow('status') === 'PENDING' && readerRow('revoked_reason') === 'Replaced by a new enrollment', `${after.status}`)
  check('no audit entry until a re-enroll is finished', audits().length === 5)
  clearReader()
}

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const faceBrowser = faceVideo && worker && !hadEnrollment
  ? await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${faceVideo}`] })
  : null
const open = async (email, width, height, b = browser) => {
  const ctx = await b.newContext({ viewport: { width, height } })
  await ctx.grantPermissions(['camera'], { origin: base })
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
  return { page, ctx, errors, failed }
}
/** Waits for the locator to show (isVisible() alone doesn't wait). */
const seen = (loc, timeout = 15000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }
const cameraLive = (page) => page.waitForFunction(() => { const v = document.querySelector('video[aria-label="Camera preview"]'); return !!v && v.videoWidth > 0 && !v.paused }, null, { timeout: 20000 }).then(() => true, () => false)
const takeAndUse = async (page) => {
  await page.getByRole('button', { name: /Take photo/ }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: /^(Use photo|Use anyway)$/ }).click()
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const WORKER_DOWN = /The face check service isn’t available right now\. Your photos are kept here/
const OFF_SELF = 'Face punch-in stays off for you until the new photos are accepted, because the earlier face has been replaced.'
/** Cancel, and Leave anyway if asked; true when it asked. */
const leave = async (d) => {
  await d.getByRole('button', { name: 'Cancel' }).click()
  const asked = await seen(d.getByText(/Leave without finishing\?/), 3000)
  if (asked) await d.getByRole('button', { name: 'Leave anyway' }).click()
  return asked
}

try {
  // ── Self: reader, desktop ──
  {
    const { page, ctx, errors, failed } = await open('reader@unifiedtree.demo', 1440, 900)
    await page.goto(`${base}/profile`); await settle(page)
    const section = page.locator('#st-face')
    check('profile has a Face enrollment section', await seen(section.getByRole('heading', { name: 'Face enrollment' })))
    await seen(section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }))
    const enrolledBefore = await section.getByRole('button', { name: 'Re-enroll', exact: true }).count() > 0
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-profile.png` })
    await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).click()
    const d = page.getByRole('dialog')
    check('the drawer opens on your own face', await seen(d.getByRole('heading', { name: enrolledBefore ? 'Re-enroll your face' : 'Enroll your face' })))
    await page.waitForTimeout(500) // the drawer slides in
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-intro.png` })
    await d.getByRole('button', { name: /Open camera/ }).click()
    check('the camera preview shows', await cameraLive(page))
    check('the oval guide asks for a straight look', await seen(d.getByText('Look straight at the camera')))
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-camera.png` })
    await d.getByRole('button', { name: /Take photo/ }).click()
    check('a taken photo is shown back with Retake', await seen(d.getByRole('img', { name: 'Photo 1: Straight' })) && await d.getByRole('button', { name: 'Retake' }).isVisible())
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-preview.png` })
    await d.getByRole('button', { name: 'Retake' }).click()
    check('Retake goes back to the live camera', await cameraLive(page))
    await takeAndUse(page)
    check('the next photo asks to turn left', await seen(d.getByText('Turn your head a little to the left')))
    await takeAndUse(page)
    await takeAndUse(page)
    const save = d.getByRole('button', { name: /^(Save my face|Send again)$/ })
    await seen(save)
    check('all three photos are reviewed side by side', await d.getByRole('img', { name: /^Photo [123]:/ }).count() === 3)
    check('consent is required before saving', await save.isDisabled())
    await d.getByRole('checkbox').check()
    check('the consent line is plain', await d.getByText('I agree to my face being used to mark my attendance.').isVisible())
    check('ticking consent allows saving', await save.isEnabled())
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-review.png` })

    if (hadEnrollment) {
      console.log('SKIP  real save — reader already has a face enrollment here, and saving would replace it')
    } else {
      const failedBefore = failed.length
      await save.click()
      if (worker) {
        const answered = await seen(d.getByText(/^Photo 3 \(Right\):/), 60000)
        check('no face in the fake video → a plain message (real face worker)', answered && await d.getByText(/No face found in this photo\. Keep the face inside the oval and take it again\./).count() === 3 && await d.getByText('Not accepted', { exact: true }).count() === 3)
        check('a refused photo must be retaken before sending again (real)', await save.isDisabled() && await d.getByRole('button', { name: 'Retake' }).count() === 3)
        check('a first enrollment says nothing about face punch-in being off', await d.getByText(/Face punch-in stays off/).count() === 0)
      } else {
        check('face service down → Save stops before sending, photos kept', await seen(d.getByText(WORKER_DOWN), 60000) && failed.length === failedBefore && await d.getByRole('img', { name: /^Photo [123]:/ }).count() === 3, failed.slice(failedBefore).join('; '))
        await save.click() // Send again: now the photos go
        await page.waitForResponse((r) => r.url().includes('/enroll/sample'), { timeout: 60000 }).catch(() => {})
        await seen(d.getByText(WORKER_DOWN), 30000)
        await page.waitForTimeout(500)
        check('Send again reaches the face check (valid request)', failed.some((f) => f.startsWith('503 POST /v1/attendance/face/enroll/sample')), failed.join('; '))
      }
      check('each web photo is logged as from the web browser', sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and purpose='ENROLLMENT_SAMPLE' and device_fingerprint='Web browser' and created_at >= '${startedAt}'`) !== '0')
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-error-real.png` })
    }

    if (!worker) {
      // No worker here: play back the server's own "no face" answer for each photo.
      await page.route('**/enroll/sample', async (route) => {
        const b = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: false, capturedAngle: b.captureAngle, samplesCaptured: 0, samplesRequired: 3, qualityScore: null, livenessScore: null, rejectionCode: 'FAIL_NO_FACE', rejectionReason: 'We can’t see a face in the frame.', remainingAngles: ['FRONT', 'LEFT_30', 'RIGHT_30'] }) })
      })
      if (hadEnrollment) await page.route('**/enroll/start', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enrollmentId: '00000000-0000-0000-0000-000000000001', samplesRequired: 3, captureSequence: ['FRONT', 'LEFT_30', 'RIGHT_30'], liveness: [], workerHint: 'worker-online' }) }))
      await save.click()
      const answered = await seen(d.getByText(/^Photo 3 \(Right\):/), 20000)
      check('no face found → a plain message on each photo', answered && await d.getByText(/No face found in this photo\. Keep the face inside the oval and take it again\./).count() === 3 && await d.getByText('Not accepted', { exact: true }).count() === 3)
      check('a refused photo must be retaken before sending again', await save.isDisabled() && await d.getByRole('button', { name: 'Retake' }).count() === 3)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-error-noface.png` })
      await page.unroute('**/enroll/sample'); await page.unroute('**/enroll/start')
    }

    const leaving = await leave(d)
    check('closing after sending asks first', hadEnrollment && worker ? true : leaving)
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    check('the camera is released on close', await page.evaluate(() => !document.querySelector('video[aria-label="Camera preview"]')))

    // ── Locked, on your own profile ──
    if (!hadEnrollment) {
      if (!readerRow('id')) await call(reader, 'POST', '/v1/attendance/face/enroll/start', {})
      lockReader(10)
      await page.reload(); await settle(page)
      await section.scrollIntoViewIfNeeded()
      check('locked: the profile says when you can re-enroll, with no button yet',
        await seen(section.getByText(/You can re-enroll from \d{1,2}:\d{2} (AM|PM), or ask HR to unlock it sooner\./))
        && await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).count() === 0
        && await section.getByText('Locked', { exact: true }).count() >= 1, `expected about ${format(new Date(Date.now() + 20 * 60000), 'h:mm a')}`)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-locked.png` })
      lockReader(31)
      await page.reload(); await settle(page)
      await section.scrollIntoViewIfNeeded()
      const reBtn = section.getByRole('button', { name: 'Re-enroll', exact: true })
      check('after the lock’s time: Re-enroll is offered', await seen(reBtn) && await seen(section.getByText('Face check was locked after several failed tries. Re-enroll your face to use face punch-in again.')))
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-unlockable.png` })
      await reBtn.click()
      check('the drawer re-enrolls your face', await seen(d.getByRole('heading', { name: 'Re-enroll your face' })))
      await d.getByRole('button', { name: /Open camera/ }).click()
      await cameraLive(page)
      await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
      await d.getByRole('checkbox').check()
      await d.getByRole('button', { name: 'Save my face' }).click()
      if (worker) {
        await seen(d.getByText(/^Photo 3 \(Right\):/), 60000)
        check('a refused re-enroll says face punch-in is off until new photos are accepted', await seen(d.getByText(OFF_SELF)) && await d.getByText(/No face found in this photo/).count() === 3)
      } else {
        check('face service down on a re-enroll: says face punch-in is off until new photos are accepted', await seen(d.getByText(WORKER_DOWN), 60000) && await seen(d.getByText(OFF_SELF)))
      }
      check('the server unlocked and started the re-enroll', readerRow('status') === 'PENDING')
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-reenroll-off.png` })
      check('leaving a started re-enroll asks first', await leave(d))
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
      clearReader()
    }

    const expected = (f) => /^503 POST \/v1\/attendance\/face\/enroll\/sample/.test(f) && !worker
    check('no page errors or unexpected API failures (self)', errors.length === 0 && failed.filter((f) => !expected(f)).length === 0, [...errors, ...failed.filter((f) => !expected(f))].join('; '))
    await ctx.close()
  }

  // ── Self: reader, phone width ──
  {
    const { page, ctx, errors, failed } = await open('reader@unifiedtree.demo', 390, 844)
    await page.goto(`${base}/profile`); await settle(page)
    const section = page.locator('#st-face')
    await section.scrollIntoViewIfNeeded()
    check('phone: profile section fits the width', await seen(section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ })) && await noHScroll(page))
    await page.screenshot({ path: `${shotDir}/faceenroll-390-profile.png` })
    await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).click()
    const d = page.getByRole('dialog')
    await seen(d.getByRole('button', { name: /Open camera/ }))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${shotDir}/faceenroll-390-intro.png` })
    await d.getByRole('button', { name: /Open camera/ }).click()
    check('phone: camera preview shows', await cameraLive(page) && await noHScroll(page))
    await page.screenshot({ path: `${shotDir}/faceenroll-390-camera.png` })
    await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
    await d.getByRole('checkbox').check()
    check('phone: review fits the width', await d.getByRole('img', { name: /^Photo [123]:/ }).count() === 3 && await noHScroll(page))
    await page.screenshot({ path: `${shotDir}/faceenroll-390-review.png` })
    await d.getByRole('button', { name: 'Cancel' }).click()
    check('no page errors or API failures (phone)', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
    await ctx.close()
  }

  // ── HR: owner on reader's record ──
  {
    const { page, ctx, errors, failed } = await open('owner@unifiedtree.demo', 1440, 900)
    await page.goto(`${base}/hrms/employees/${READER}`); await settle(page)
    await page.getByText('Reader User').first().waitFor({ timeout: 20000 })
    const btn = page.getByRole('button', { name: /^(Enroll face|Re-enroll face)$/ })
    check('owner sees Face enrollment with Enroll on an employee’s record', await seen(page.getByText('Face enrollment')) && await seen(btn) && await seen(page.getByText('Not enrolled')))
    await btn.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-hr-record.png` })
    await btn.click()
    const d = page.getByRole('dialog')
    check('the drawer is about that person', await seen(d.getByRole('heading', { name: /Reader User’s face$/ })) && await d.getByText(/Only Reader in the frame/).isVisible())
    await d.getByRole('button', { name: /Open camera/ }).click()
    check('HR: the camera preview shows', await cameraLive(page))
    await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
    check('HR: consent is given for the person', await seen(d.getByText('Reader User agrees to their face being used to mark their attendance.')))
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-hr-review.png` })
    await d.getByRole('button', { name: 'Cancel' }).click()
    check('no page errors or API failures (HR)', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
    await ctx.close()

    const m = await open('owner@unifiedtree.demo', 390, 844)
    await m.page.goto(`${base}/hrms/employees/${READER}`); await settle(m.page)
    const b = m.page.getByRole('button', { name: /^(Enroll face|Re-enroll face)$/ })
    const shown = await seen(b)
    await b.scrollIntoViewIfNeeded().catch(() => {})
    check('phone: HR record shows Enroll face and fits', shown && await noHScroll(m.page))
    await m.page.screenshot({ path: `${shotDir}/faceenroll-390-hr-record.png` })
    await m.ctx.close()
  }

  // ── Real: a real face in the fake camera, with the real face worker ──
  if (!faceBrowser) {
    console.log(`SKIP  real enrollment — needs the face worker on :8091 and FACE_VIDEO${hadEnrollment ? ', and reader without an enrollment' : ''}`)
  } else {
    clearReader()
    const today = format(new Date(), 'd MMM yyyy')
    const auditsBefore = audits().length // the API checks above wrote their own
    {
      const { page, ctx, errors, failed } = await open('reader@unifiedtree.demo', 1440, 900, faceBrowser)
      await page.goto(`${base}/profile`); await settle(page)
      const section = page.locator('#st-face')
      await section.getByRole('button', { name: 'Enroll my face' }).click()
      const d = page.getByRole('dialog')
      await d.getByRole('button', { name: /Open camera/ }).click()
      check('real: the camera shows the face video', await cameraLive(page))
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-real-camera.png` })
      await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
      await d.getByRole('checkbox').check()
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-real-review.png` })
      await d.getByRole('button', { name: 'Save my face' }).click()
      const done = await seen(d.getByRole('heading', { name: 'Face enrolled' }), 90000)
      const refused = done ? '' : (await d.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ')
      check('real: all three photos are accepted and the face is enrolled', done, refused)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-real-done.png` })
      if (done) {
        await d.getByRole('button', { name: 'Done' }).click()
        check('real: the profile now says “Enrolled on” today', await seen(section.getByText(`Enrolled on ${today}`)) && await seen(section.getByRole('button', { name: 'Re-enroll', exact: true })))
        await section.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${shotDir}/faceenroll-1440-real-profile.png` })
        check('real: saved as 3 encrypted face patterns, enrollment active', readerRow('status') === 'ACTIVE' && sql(`select count(*) from attendance.face_embedding_templates where tenant_id='${tenant}' and employee_id='${READER}' and is_active`) === '3')
        const a = audits()
        check('real: one audit entry, “enrolled their own face”', a.length === auditsBefore + 1 && (a.at(-1) || '').startsWith(`FACE_ENROLLED|${READER}|Enrolled their own face for face punch-in.`), a.slice(auditsBefore).join(' / '))
        if (facePunch) {
          const img = readFileSync(facePunch).toString('base64')
          const v = await call(reader, 'POST', '/v1/attendance/face/verify', { imageBase64: img, challengePerformed: 'BLINK', deviceFingerprint: 'live test' })
          const vj = await v.json().catch(() => ({}))
          check('real: a phone-style (not mirrored) punch photo matches the web-enrolled face', v.status === 200 && vj.passed === true, `${v.status} ${JSON.stringify(vj).slice(0, 160)}`)
        }
      } else {
        await leave(d)
      }
      check('real: no page errors or API failures (self)', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
      await ctx.close()
    }
    {
      const { page, ctx, errors, failed } = await open('reader@unifiedtree.demo', 390, 844, faceBrowser)
      await page.goto(`${base}/profile`); await settle(page)
      const section = page.locator('#st-face')
      await section.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${shotDir}/faceenroll-390-real-profile.png` })
      await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).click()
      const d = page.getByRole('dialog')
      await d.getByRole('button', { name: /Open camera/ }).click()
      await cameraLive(page)
      await page.waitForTimeout(800)
      check('real, phone: the camera fits the width', await noHScroll(page))
      await page.screenshot({ path: `${shotDir}/faceenroll-390-real-camera.png` })
      await d.getByRole('button', { name: 'Back' }).click()
      await d.getByRole('button', { name: 'Cancel' }).click()
      check('real, phone: no page errors or API failures', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
      await ctx.close()
    }
    {
      const { page, ctx, errors, failed } = await open('owner@unifiedtree.demo', 1440, 900, faceBrowser)
      await page.goto(`${base}/hrms/employees/${READER}`); await settle(page)
      await page.getByText('Reader User').first().waitFor({ timeout: 20000 })
      const enrolledNow = readerRow('status') === 'ACTIVE'
      check('real, HR: the record shows the real enrollment', !enrolledNow || await seen(page.getByText(`Enrolled on ${today}`)))
      await page.getByRole('button', { name: enrolledNow ? 'Re-enroll face' : 'Enroll face' }).click()
      const d = page.getByRole('dialog')
      await d.getByRole('button', { name: /Open camera/ }).click()
      await cameraLive(page)
      await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
      await d.getByRole('checkbox').check()
      await d.getByRole('button', { name: 'Save face' }).click()
      const done = await seen(d.getByRole('heading', { name: enrolledNow ? 'Face re-enrolled' : 'Face enrolled' }), 90000)
      check('real, HR: owner enrolls reader’s face from the record', done)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-real-hr-done.png` })
      const a = audits()
      check('real, HR: audited as the owner replacing reader’s face', !enrolledNow || (a.length === auditsBefore + 2 && (a.at(-1) || '').startsWith(`FACE_REENROLLED|${OWNER}|Re-enrolled Reader User's face. The earlier face record was replaced.`)), a.at(-1))
      if (!done) await leave(d)
      check('real, HR: no page errors or API failures', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await faceBrowser?.close()
  // Remove what this run created (never an enrollment reader already had).
  sql(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${startedAt}'`)
  sql(`delete from audit.events where tenant_id='${tenant}' and module='attendance' and action in ('FACE_ENROLLED','FACE_REENROLLED') and entity_id='${READER}' and occurred_at >= '${startedAt}'`)
  const faceNotes = `from notif.notifications where tenant_id='${tenant}' and user_id='${READER}' and created_at >= '${startedAt}' and (type ilike '%face%' or data->>'route' = '/face-enroll')`
  sql(`delete ${faceNotes}`)
  if (!hadEnrollment) clearReader()
  const left = Number(sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${startedAt}'`))
    + audits().length + Number(sql(`select count(*) ${faceNotes}`))
    + (hadEnrollment ? 0 : Number(sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)))
  check('everything the run created is removed', left === 0)
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length ? 1 : 0)
