// Live check of face enrollment on the web (wave 3), against the local API,
// with Chromium's fake camera (a moving test pattern, no face in it).
//
//   API    reader may read their own face status, and gets 403 on every route
//          that enrolls someone else; owner reads another person's status by
//          their employee id, and an employee with no sign-in can't be enrolled.
//   Self   reader opens Profile → Face enrollment → Enroll my face: the camera
//          preview shows, a photo can be retaken, the three photos are reviewed,
//          Save needs the consent box, and a refused photo is explained plainly.
//          With a face worker running on :8091 the "no face found" answer is the
//          real one for the fake video; without one the real answer is "service
//          not available" (checked), and "no face found" is then played back at
//          the network layer to check its wording.
//   HR     owner sees Enroll face on an employee's record and the drawer opens
//          on that person, with the camera.
// Screenshots (1440 and 390 wide) go to _results/shots/faceenroll-*.png.
// Rows the run creates (reader's pending enrollment and its face events) are
// deleted at the end; the real save runs only if reader had no enrollment.
//
//   node e2e/recovery/live-w3-faceenroll.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3020'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shotDir = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
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
console.log(`face worker on :8091: ${worker ? 'running' : 'not running'}; reader had an enrollment: ${hadEnrollment}`)

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

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const open = async (email, width, height) => {
  const ctx = await browser.newContext({ viewport: { width, height } })
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }
const cameraLive = (page) => page.waitForFunction(() => { const v = document.querySelector('video[aria-label="Camera preview"]'); return !!v && v.videoWidth > 0 && !v.paused }, null, { timeout: 20000 }).then(() => true, () => false)
const takeAndUse = async (page) => {
  await page.getByRole('button', { name: /Take photo/ }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: /^(Use photo|Use anyway)$/ }).click()
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  // ── Self: reader, desktop ──
  {
    const { page, ctx, errors, failed } = await open('reader@unifiedtree.demo', 1440, 900)
    await page.goto(`${base}/profile`); await settle(page)
    const section = page.locator('#st-face')
    check('profile has a Face enrollment section', await section.getByRole('heading', { name: 'Face enrollment' }).isVisible().catch(() => false))
    const enrolledBefore = await section.getByText('Re-enroll').count() > 0
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-profile.png` })
    await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).click()
    const d = page.getByRole('dialog')
    check('the drawer opens on your own face', await d.getByRole('heading', { name: enrolledBefore ? 'Re-enroll your face' : 'Enroll your face' }).isVisible().catch(() => false))
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-intro.png` })
    await d.getByRole('button', { name: /Open camera/ }).click()
    check('the camera preview shows', await cameraLive(page))
    check('the oval guide asks for a straight look', await d.getByText('Look straight at the camera').isVisible().catch(() => false))
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-camera.png` })
    await d.getByRole('button', { name: /Take photo/ }).click()
    check('a taken photo is shown back with Retake', await d.getByRole('img', { name: 'Photo 1: Straight' }).isVisible().catch(() => false) && await d.getByRole('button', { name: 'Retake' }).isVisible())
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-preview.png` })
    await d.getByRole('button', { name: 'Retake' }).click()
    check('Retake goes back to the live camera', await cameraLive(page))
    await takeAndUse(page)
    check('the next photo asks to turn left', await d.getByText('Turn your head a little to the left').isVisible({ timeout: 5000 }).catch(() => false))
    await takeAndUse(page)
    await takeAndUse(page)
    const save = d.getByRole('button', { name: /^(Save my face|Send again)$/ })
    check('all three photos are reviewed side by side', await d.getByRole('img', { name: /^Photo [123]:/ }).count() === 3)
    check('consent is required before saving', await save.isDisabled())
    await d.getByRole('checkbox').check()
    check('the consent line is plain', await d.getByText('I agree to my face being used to mark my attendance.').isVisible())
    check('ticking consent allows saving', await save.isEnabled())
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-review.png` })

    if (hadEnrollment) {
      console.log('SKIP  real save — reader already has a face enrollment here, and saving would replace it')
    } else {
      await save.click()
      if (worker) {
        check('no face in the fake video → a plain message (real face worker)', await d.getByText('No face found in this photo. Keep the face inside the oval and take it again.').first().isVisible({ timeout: 45000 }).catch(() => false))
      } else {
        check('face service down → a plain message, photos kept', await d.getByText(/The face check service isn’t available right now\. Your photos are kept here/).isVisible({ timeout: 45000 }).catch(() => false))
        check('the photo reached the face check (valid request)', failed.some((f) => f.startsWith('503 POST /v1/attendance/face/enroll/sample')), failed.join('; '))
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
      if (hadEnrollment) await page.route('**/enroll/start', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enrollmentId: '00000000-0000-0000-0000-000000000001', samplesRequired: 3, captureSequence: ['FRONT', 'LEFT_30', 'RIGHT_30'], liveness: [], workerHint: 'worker-offline' }) }))
      await save.click()
      check('no face found → a plain message on each photo', await d.getByText(/No face found in this photo\. Keep the face inside the oval and take it again\./).first().isVisible({ timeout: 20000 }).catch(() => false) && await d.getByText('Not accepted').count() === 3)
      check('a refused photo must be retaken before sending again', await save.isDisabled() && await d.getByRole('button', { name: 'Retake' }).count() === 3)
      await page.screenshot({ path: `${shotDir}/faceenroll-1440-error-noface.png` })
      await page.unroute('**/enroll/sample'); await page.unroute('**/enroll/start')
    }

    await d.getByRole('button', { name: 'Cancel' }).click()
    const leaving = await d.getByText(/Leave without finishing\?/).isVisible().catch(() => false)
    if (leaving) await d.getByRole('button', { name: 'Leave anyway' }).click()
    check('closing after sending asks first', hadEnrollment && worker ? true : leaving)
    check('the camera is released on close', await page.evaluate(() => !document.querySelector('video[aria-label="Camera preview"]')))
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
    check('phone: profile section fits the width', await section.isVisible() && await noHScroll(page))
    await page.screenshot({ path: `${shotDir}/faceenroll-390-profile.png` })
    await section.getByRole('button', { name: /^(Enroll my face|Re-enroll)$/ }).click()
    const d = page.getByRole('dialog')
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
    check('owner sees Face enrollment with Enroll on an employee’s record', await page.getByText('Face enrollment', { exact: false }).first().isVisible() && await btn.isVisible().catch(() => false))
    await btn.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-hr-record.png` })
    await btn.click()
    const d = page.getByRole('dialog')
    check('the drawer is about that person', await d.getByRole('heading', { name: /Reader User’s face$/ }).isVisible().catch(() => false) && await d.getByText(/Only Reader in the frame/).isVisible())
    await d.getByRole('button', { name: /Open camera/ }).click()
    check('HR: the camera preview shows', await cameraLive(page))
    await takeAndUse(page); await takeAndUse(page); await takeAndUse(page)
    check('HR: consent is given for the person', await d.getByText('Reader User agrees to their face being used to mark their attendance.').isVisible())
    await page.screenshot({ path: `${shotDir}/faceenroll-1440-hr-review.png` })
    await d.getByRole('button', { name: 'Cancel' }).click()
    check('no page errors or API failures (HR)', errors.length === 0 && failed.length === 0, [...errors, ...failed].join('; '))
    await ctx.close()

    const m = await open('owner@unifiedtree.demo', 390, 844)
    await m.page.goto(`${base}/hrms/employees/${READER}`); await settle(m.page)
    const b = m.page.getByRole('button', { name: /^(Enroll face|Re-enroll face)$/ })
    await b.scrollIntoViewIfNeeded().catch(() => {})
    check('phone: HR record shows Enroll face and fits', await b.isVisible().catch(() => false) && await noHScroll(m.page))
    await m.page.screenshot({ path: `${shotDir}/faceenroll-390-hr-record.png` })
    await m.ctx.close()
  }
} finally {
  await browser.close()
  // Remove what this run created (never an enrollment reader already had).
  sql(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${startedAt}'`)
  if (!hadEnrollment) sql(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
  const left = Number(sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${startedAt}'`))
    + (hadEnrollment ? 0 : Number(sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)))
  check('everything the run created is removed', left === 0)
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length ? 1 : 0)
