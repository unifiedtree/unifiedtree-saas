// Face station (V143.95, spec 14.4, audit D-06 / D-07): a shared face-punch device for one branch.
//
// API:
//  - only admin / HR (attendance.policy.manage AND attendance.assisted_punch.any) may list or set up
//    stations: the owner may, the department manager and the employee get 403;
//  - a station started on a device gets a station sign-in that:
//      answers its own name and branch, searches its branch from 2 letters (never the whole branch),
//      is refused (403) on every other endpoint (people, attendance, stations, the session),
//      refuses a punch for someone no longer working there and for someone without an enrolled face
//      (before any face check), and never accepts a person's sign-in on the station endpoints;
//  - switching the station off stops its sign-in at the next request (401 STATION_REVOKED).
// Browser:
//  - owner: Attendance → Face stations → New station (name + branch) → it is listed; switch it off;
//  - the station page (/station) with that station's sign-in: start screen, Punch in → 2 letters →
//    the branch's people; after the switch-off a search ends it ("This station is switched off");
//  - "Open on this computer" signs the owner out and opens the station page;
//  - desktop 1440 and phone 390 screenshots.
// A real face match needs an enrolled face and the face worker, so no punch is recorded here.
// Everything it creates (two stations) is deleted at the end.
//
//   node e2e/recovery/live-w3-face-station.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
/* global process, console, fetch, URL, localStorage */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3035'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function call(token, path, method = 'GET', body) {
  const res = await fetch(api + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return d.accessToken
}
async function signIn(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
const expected = []  // API answers this test provokes on purpose
function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (!u.includes('/api/') || r.status() < 400) return
    const p = new URL(u).pathname
    if (expected.some((x) => p.includes(x.path) && r.status() === x.status)) return
    failed.push(`${label}: ${r.status()} ${p}`)
  })
  return { errors, failed }
}
const visible = (locator, timeout = 20_000) => locator.waitFor({ timeout }).then(() => true, () => false)

const stamp = Date.now()
const created = []
const browser = await chromium.launch()
const watched = []
let owner
try {
  owner = await login('owner@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── who may set up stations ──
  const list0 = await call(owner, '/v1/attendance/stations')
  check('api: the owner may list face stations', list0.status === 200 && Array.isArray(list0.json), `status=${list0.status}`)
  check('api: a department manager may not (403)', (await call(mgr, '/v1/attendance/stations')).status === 403)
  check('api: an employee may not (403)', (await call(reader, '/v1/attendance/stations')).status === 403)
  check('api: an employee may not set one up (403)', (await call(reader, '/v1/attendance/stations', 'POST', { name: 'x', branchId: READER })).status === 403)

  const branches = await call(owner, '/v1/hrms/branches')
  const branch = (branches.json || []).find((b) => b.active !== false && b.isActive !== false)
  check('setup: the company has an active branch', !!branch, branch?.name)

  // ── browser: owner sets up a station ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  watched.push(watch(page, 'owner'))
  await signIn(page, 'owner@unifiedtree.demo')
  await page.goto(base + '/hrms/attendance/stations')
  check('web: the Face stations page opens for the owner', await visible(page.getByRole('heading', { name: 'Face stations' })))
  const name = `QA station ${stamp}`
  await page.getByRole('button', { name: 'New station' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Branch').selectOption({ label: branch.name })
  await page.screenshot({ path: `${SHOTS}/w35-kiosk-setup-new.png` })
  await page.getByRole('button', { name: 'Set up station' }).click()
  check('web: the new station is listed', await visible(page.getByText(name).first()))
  const list1 = await call(owner, '/v1/attendance/stations')
  const st = (list1.json || []).find((s) => s.name === name)
  if (st) created.push(st.id)
  check('api: the station is saved at the chosen branch, switched on', st?.status === 'ACTIVE' && st?.branchId === branch.id, JSON.stringify(st && { status: st.status, branch: st.branchName }))
  await page.screenshot({ path: `${SHOTS}/w35-kiosk-setup-desktop.png`, fullPage: true })

  // ── the station's sign-in ──
  check('api: a manager can’t start a station on a device (403)', (await call(mgr, `/v1/attendance/stations/${st.id}/device-session`, 'POST')).status === 403)
  const sess = await call(owner, `/v1/attendance/stations/${st.id}/device-session`, 'POST')
  const tok = sess.json?.token
  check('api: starting it on a device gives a station sign-in', sess.status === 200 && !!tok && sess.json?.station?.name === name, `status=${sess.status}`)
  const me = await call(tok, '/v1/attendance/station/me')
  check('station: it knows its own name and branch', me.status === 200 && me.json?.name === name && me.json?.branchName === branch.name, JSON.stringify(me.json))
  const short = await call(tok, '/v1/attendance/station/people?q=r')
  check('station: one letter lists nobody (never the whole branch)', short.status === 200 && short.json?.people?.length === 0 && !!short.json?.hint)
  const found = await call(tok, '/v1/attendance/station/people?q=re')
  const people = found.json?.people || []
  check('station: 2 letters search the branch, at most 8, with no attendance or contact data',
    found.status === 200 && people.length <= 8 && people.every((p) => Object.keys(p).sort().join(',') === 'departmentName,employeeCode,employeeId,faceReady,fullName'),
    `${people.length} found: ${people.map((p) => p.fullName).join(', ')}`)
  for (const [path, method] of [['/v1/hrms/employees', 'GET'], [`/v1/hrms/employees/${READER}`, 'GET'], ['/v1/attendance/today', 'GET'],
    ['/v1/attendance/stations', 'GET'], ['/v1/attendance/assisted-punch/eligible', 'GET'], ['/v1/canonical-auth/me', 'GET'],
    ['/v1/notifications', 'GET'], ['/v1/payroll/runs', 'GET'], ['/v1/attendance/checkin', 'POST']]) {
    const r = await call(tok, path, method, method === 'POST' ? {} : undefined)
    check(`station: refused on ${method} ${path}`, r.status === 403 && r.json?.errorCode === 'STATION_ONLY_PUNCHES', `status=${r.status} ${r.json?.errorCode || ''}`)
  }
  check('api: a person’s sign-in can’t use the station endpoints (403)', (await call(owner, '/v1/attendance/station/me')).status === 403)

  // Punches refused before any face check (nothing is written).
  const exited = (await call(owner, '/v1/hrms/employees?status=EXITED&size=50')).json
  const gone = (exited?.content || exited || []).find((e) => (e.branchId === branch.id) && e.employmentStatus === 'EXITED')
  if (gone) {
    const r = await call(tok, '/v1/attendance/station/punch', 'POST', { employeeId: gone.id, type: 'CHECK_IN', imageBase64: 'QUJD', latitude: 17.36, longitude: 78.53 })
    check('station: someone who has left can’t punch', r.status === 422 && r.json?.errorCode === 'ASSISTED_PUNCH_NOT_ACTIVE', `status=${r.status} ${r.json?.errorCode}`)
  } else check('station: someone who has left can’t punch (no such person in the data — skipped)', true)
  const noFace = people.find((p) => !p.faceReady)
  if (noFace) {
    const r = await call(tok, '/v1/attendance/station/punch', 'POST', { employeeId: noFace.employeeId, type: 'CHECK_IN', imageBase64: 'QUJD', latitude: 17.36, longitude: 78.53 })
    check('station: someone without an enrolled face is told so before any face check', r.status === 409 && r.json?.errorCode === 'FACE_NOT_ENROLLED', `status=${r.status} ${r.json?.errorCode}`)
  }
  const noPic = await call(tok, '/v1/attendance/station/punch', 'POST', { employeeId: READER, type: 'CHECK_IN', latitude: 17.36, longitude: 78.53 })
  check('station: a punch without a photo is refused', noPic.status === 422 && noPic.json?.errorCode === 'FACE_IMAGE_REQUIRED', `status=${noPic.status} ${noPic.json?.errorCode}`)

  // ── browser: the station page ──
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await sctx.addInitScript((s) => { try { localStorage.setItem('ut.faceStation', s) } catch { /* */ } }, JSON.stringify(sess.json))
  const sp = await sctx.newPage()
  const sw = watch(sp, 'station')
  watched.push(sw)
  await sp.goto(base + '/station')
  check('web: the station page shows its start screen', await visible(sp.getByText('Punch with your face')) && await visible(sp.getByText(name).first()))
  await sp.screenshot({ path: `${SHOTS}/w35-kiosk-station-start-desktop.png` })
  await sp.getByRole('button', { name: 'Punch in' }).click()
  check('web: Punch in asks for 2 letters', await visible(sp.getByText('Type at least 2 letters.')))
  await sp.getByLabel('Your name or employee code').fill('re')
  check('web: the branch’s people are found', await visible(sp.locator('.ufs-person').first()))
  await sp.screenshot({ path: `${SHOTS}/w35-kiosk-station-find-desktop.png` })
  await sp.setViewportSize({ width: 390, height: 844 })
  await sp.screenshot({ path: `${SHOTS}/w35-kiosk-station-find-phone.png`, fullPage: true })
  await sp.getByRole('button', { name: 'Cancel' }).click()
  await sp.screenshot({ path: `${SHOTS}/w35-kiosk-station-start-phone.png`, fullPage: true })
  check('web: the station page had no failed calls', sw.failed.length === 0, sw.failed.join(' | '))

  // ── switch it off (owner, in the page) ──
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/w35-kiosk-setup-phone.png`, fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  const row = page.locator('.umk-row', { hasText: name })
  await row.getByRole('button', { name: 'Switch off' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click()
  check('web: the switched-off station says so', await visible(row.getByText('Switched off', { exact: true })))
  expected.push({ path: '/v1/attendance/station/', status: 401 })
  const after = await call(tok, '/v1/attendance/station/me')
  check('station: switched off, its sign-in stops at once (401 STATION_REVOKED)', after.status === 401 && after.json?.errorCode === 'STATION_REVOKED', `status=${after.status} ${after.json?.errorCode}`)
  check('api: a switched-off station can’t be started on a device again', (await call(owner, `/v1/attendance/stations/${st.id}/device-session`, 'POST')).status === 409)
  await sp.setViewportSize({ width: 1440, height: 900 })
  await sp.getByRole('button', { name: 'Punch out' }).click()
  await sp.getByLabel('Your name or employee code').fill('rea')
  check('web: the station page ends itself after the switch-off', await visible(sp.getByText('This station is switched off')))
  await sp.screenshot({ path: `${SHOTS}/w35-kiosk-station-off-desktop.png` })

  // ── "Open on this computer" signs the owner out and opens the station ──
  const two = await call(owner, '/v1/attendance/stations', 'POST', { name: `QA station B ${stamp}`, branchId: branch.id })
  if (two.json?.id) created.push(two.json.id)
  check('api: the owner sets up a second station', two.status === 200 && two.json?.status === 'ACTIVE', `status=${two.status}`)
  await page.reload()
  const row2 = page.locator('.umk-row', { hasText: `QA station B ${stamp}` })
  await row2.getByRole('button', { name: 'Open on this computer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out and open' }).click()
  await page.waitForURL((u) => u.pathname === '/station', { timeout: 30_000 }).catch(() => {})
  check('web: Open on this computer lands on the station page', await visible(page.getByText('Punch with your face')) && await visible(page.getByText(`QA station B ${stamp}`).first()))
  await page.goto(base + '/dashboard')
  check('web: the owner is signed out on that computer', await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => true, () => false), page.url())

  for (const w of watched) {
    check(`web: no page errors (${w.errors.length})`, w.errors.length === 0, w.errors.join(' | '))
  }
  const failedCalls = watched.flatMap((w) => w.failed)
  check('web: no unexpected API errors', failedCalls.length === 0, failedCalls.join(' | '))
} catch (e) {
  check('test ran to the end', false, String(e?.stack || e))
} finally {
  // ── clean up: switch off and delete every station this test made (none punched anyone) ──
  for (const id of created) {
    await call(owner, `/v1/attendance/stations/${id}/revoke`, 'POST').catch(() => {})
    const d = await call(owner, `/v1/attendance/stations/${id}`, 'DELETE').catch(() => ({ status: 0 }))
    check(`cleanup: station ${id.slice(0, 8)} deleted`, d.status === 204, `status=${d.status}`)
  }
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
