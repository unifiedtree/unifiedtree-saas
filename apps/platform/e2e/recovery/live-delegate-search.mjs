// Approval delegation: a manager without hrms.employee.read can pick a delegate.
//
// The delegation card's colleague picker used the directory search (/v1/search,
// hrms.employee.read), which a DEPT_MANAGER doesn't hold, so they couldn't choose
// anyone. GET /v1/approvals/delegation/candidates is open to everyone who may set a
// delegation (isAuthenticated, as POST /v1/me/delegation).
//
// API (mgr@ = DEPT_MANAGER, no hrms.employee.read):
//  - the directory search still refuses them (403); the candidates search answers;
//  - finds a colleague by name, by employee code and by login email prefix;
//  - never lists themselves, people who left (EXITED / TERMINATED), or people
//    without a login; the employee (reader@) gets the same rules;
//  - each hit carries only id, name, code, department, designation and photo;
//  - under two characters is 400, the limit is capped at 20, signed out is 401.
// Browser (mgr@, 1440 and 390 wide): Profile › Preferences › Approval delegation →
// Add delegation → type a name → pick the colleague → Save → the window is listed →
// Remove (confirm) → gone. Screenshots of the picker at both widths.
// Everything it creates (the delegation) is removed at the end.
//
//   node e2e/recovery/live-delegate-search.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
/* global process, console, fetch, URL */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3021'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const MANAGER = '44444444-4444-4444-4444-444444444444'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const PATH = '/v1/approvals/delegation/candidates'
const FIELDS = ['departmentName', 'displayName', 'employeeCode', 'id', 'jobTitle', 'profilePhotoUrl']
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const candidates = (call, q, limit) => call(`${PATH}?q=${encodeURIComponent(q)}${limit != null ? `&limit=${limit}` : ''}`)
const ids = (res) => (res.json?.employees || []).map((e) => e.id)

async function signIn(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/') && r.status() >= 400) failed.push(`${label}: ${r.status()} ${new URL(u).pathname}`)
  })
  return { errors, failed }
}

const browser = await chromium.launch()
const watched = []
const before = new Set()
let mgr
try {
  mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const owner = await login('owner@unifiedtree.demo')

  const mine = await mgr('/v1/me/delegation')
  for (const d of mine.json || []) before.add(d.id)
  check('setup: the manager\'s own delegations load', mine.status === 200, `status=${mine.status}`)

  // ── API: the manager ──
  const dir = await mgr('/v1/search?q=reader&limit=5')
  check('api: the directory search still refuses the manager (no hrms.employee.read)', dir.status === 403, `status=${dir.status}`)
  const byName = await candidates(mgr, 'reader')
  check('api: the manager finds a colleague by name', byName.status === 200 && ids(byName).includes(READER), `status=${byName.status} ${JSON.stringify(byName.json)?.slice(0, 160)}`)
  const hit = (byName.json?.employees || []).find((e) => e.id === READER)
  check('api: a hit carries only id, name, code, department, designation and photo', !!hit && JSON.stringify(Object.keys(hit).sort()) === JSON.stringify(FIELDS), hit ? Object.keys(hit).join(',') : 'no hit')
  check('api: the name and code are the colleague\'s', hit?.displayName === 'Reader User' && hit?.employeeCode === 'EMP002', `${hit?.displayName} ${hit?.employeeCode}`)
  check('api: by employee code, case-insensitive', ids(await candidates(mgr, 'emp002')).includes(READER))
  check('api: by login email prefix', ids(await candidates(mgr, 'reader@unif')).includes(READER))
  check('api: by the start of the first and last name ("rea us")', ids(await candidates(mgr, 'rea us')).includes(READER))
  check('api: not by the middle of a name (prefix only)', !ids(await candidates(mgr, 'eader')).includes(READER))
  const selfRes = await candidates(mgr, 'dept')
  check('api: the manager is never listed (can\'t delegate to yourself)', selfRes.status === 200 && !ids(selfRes).includes(MANAGER), ids(selfRes).join(','))
  const all = await candidates(mgr, 'emp', 20)
  check('api: every listed colleague is someone else', all.status === 200 && all.json.employees.length > 0 && !ids(all).includes(MANAGER), `${all.json?.employees?.length} hits`)

  // People who left, and current people without a login (read from the owner's directory).
  const exited = [...((await owner('/v1/hrms/employees?status=EXITED&pageSize=5')).json?.content || []),
    ...((await owner('/v1/hrms/employees?status=TERMINATED&pageSize=5')).json?.content || [])]
  const leaverIds = exited.map((e) => e.id)
  let leaked = []
  for (const e of exited.slice(0, 4)) leaked = leaked.concat(ids(await candidates(mgr, e.employeeCode)).filter((id) => leaverIds.includes(id)))
  check('api: people who left (EXITED / TERMINATED) are not listed', exited.length > 0 && leaked.length === 0, `${exited.length} leavers checked, leaked=${leaked.join(',')}`)
  // Current people without any login (the owner's Users list says who has one).
  const users = (await owner('/v1/workspace/users')).json || []
  const withLogin = new Set(users.map((u) => u.employeeId).filter(Boolean))
  const current = [...((await owner('/v1/hrms/employees?status=PROBATION&pageSize=20')).json?.content || []),
    ...((await owner('/v1/hrms/employees?status=ACTIVE&pageSize=50')).json?.content || [])]
  const noLogin = current.filter((e) => !withLogin.has(e.id)).slice(0, 3)
  const noLoginLeak = []
  for (const e of noLogin) {
    const inDir = ids(await owner(`/v1/search?q=${encodeURIComponent(e.employeeCode)}&limit=5`)).includes(e.id)
    const inPicker = ids(await candidates(mgr, e.employeeCode)).includes(e.id)
    if (!inDir || inPicker) noLoginLeak.push(`${e.employeeCode} dir=${inDir} picker=${inPicker}`)
  }
  check('api: current people without a login are in the directory but not in the picker', withLogin.size > 0 && noLogin.length > 0 && noLoginLeak.length === 0, `${noLogin.map((e) => e.employeeCode).join(',')} ${noLoginLeak.join('; ')}`)
  const outside = ids(all).filter((id) => !withLogin.has(id))
  check('api: everyone the picker lists has a login', outside.length === 0, outside.join(','))

  // The employee gets the same rules (they may set a delegation too).
  const rRes = await candidates(reader, 'dept')
  check('api: the employee finds the manager and not themselves', rRes.status === 200 && ids(rRes).includes(MANAGER) && !ids(await candidates(reader, 'reader')).includes(READER), `status=${rRes.status}`)

  // Refusals and limits.
  check('api: one character is refused (400)', (await candidates(mgr, 'r')).status === 400)
  const capped = await candidates(mgr, 'emp', 500)
  check('api: the limit is capped at 20', capped.status === 200 && capped.json.limit === 20, `limit=${capped.json?.limit}`)
  check('api: typed wildcards are matched literally ("%%" finds nobody)', (await candidates(mgr, '%%')).json?.employees?.length === 0)
  const anon = await fetch(`${api}${PATH}?q=reader`, { headers: { 'X-Tenant-ID': tenant } })
  check('api: signed out is refused (401)', anon.status === 401, `status=${anon.status}`)

  // ── Browser: the manager picks a delegate, saves, then removes it ──
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const wt = watch(page, `mgr ${tag}`)
    watched.push(wt)
    page.on('dialog', (d) => d.accept())
    await signIn(page, 'mgr@unifiedtree.demo')
    await page.goto(base + '/profile#st-delegation')
    const add = page.getByRole('button', { name: '+ Add delegation' })
    check(`browser ${tag}: Preferences shows Approval delegation with Add`, await add.waitFor({ timeout: 30_000 }).then(() => true, () => false))
    await add.click()
    const box = page.getByPlaceholder('Search by name or employee ID')
    await box.fill('read')
    const pick = page.getByRole('button', { name: /Reader User\s*EMP002/ })
    const found = await pick.waitFor({ timeout: 20_000 }).then(() => true, () => false)
    check(`browser ${tag}: typing a name lists the colleague`, found)
    check(`browser ${tag}: no "no permission" message`, !(await page.getByText('You don\'t have permission to look up colleagues').isVisible().catch(() => false)))
    await box.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${SHOTS}/w21-delegate-picker-${tag}.png`, fullPage: false })
    if (!found) { await ctx.close(); continue }
    await pick.click()
    check(`browser ${tag}: the chosen colleague is shown with Change`, await page.getByRole('button', { name: 'Change' }).isVisible())
    const posted = page.waitForResponse((r) => r.url().endsWith('/v1/me/delegation') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null)
    await page.getByRole('button', { name: 'Save delegation' }).click()
    const res = await posted
    check(`browser ${tag}: Save creates the delegation (201)`, res?.status() === 201, `status=${res?.status()}`)
    const row = page.getByText('→ Reader User')
    check(`browser ${tag}: the window is listed`, await row.waitFor({ timeout: 15_000 }).then(() => true, () => false))
    await page.screenshot({ path: `${SHOTS}/w21-delegate-saved-${tag}.png`, fullPage: false })
    const listed = (await mgr('/v1/me/delegation')).json || []
    const created = listed.filter((d) => !before.has(d.id))
    check(`browser ${tag}: the server has it, to the colleague`, created.length === 1 && created[0].delegateEmployeeId === READER, JSON.stringify(created))
    const deleted = page.waitForResponse((r) => r.url().includes('/v1/me/delegation/') && r.request().method() === 'DELETE', { timeout: 20_000 }).catch(() => null)
    await page.getByRole('button', { name: 'Remove delegation' }).first().click()
    const del = await deleted
    check(`browser ${tag}: Remove (after the confirm) deletes it`, !!del && del.status() < 300, `status=${del?.status()}`)
    const after = ((await mgr('/v1/me/delegation')).json || []).filter((d) => !before.has(d.id))
    check(`browser ${tag}: nothing of the test is left`, after.length === 0, JSON.stringify(after))
    await ctx.close()
  }

  const errs = watched.flatMap((w) => w.errors)
  check('browser: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))
  const pickerFails = watched.flatMap((w) => w.failed).filter((f) => /\/v1\/(me\/delegation|approvals\/delegation|search)/.test(f))
  check('browser: no failed delegation or search calls', pickerFails.length === 0, pickerFails.slice(0, 3).join(' | '))
  const other = [...new Set(watched.flatMap((w) => w.failed))].filter((f) => !pickerFails.includes(f))
  if (other.length) console.log(`note  other 4xx/5xx on the page (not this change): ${other.slice(0, 6).join(' | ')}`)
} catch (e) {
  check('run', false, String(e?.stack || e))
} finally {
  // Remove any delegation this run created (never the ones that were there before).
  try {
    const left = ((await mgr?.('/v1/me/delegation'))?.json || []).filter((d) => !before.has(d.id))
    for (const d of left) await mgr(`/v1/me/delegation/${d.id}`, 'DELETE')
    if (left.length) console.log(`cleanup: removed ${left.length} delegation(s)`)
  } catch (e) { console.log(`cleanup failed: ${e}`) }
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
