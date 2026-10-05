/* global process, console, fetch, Buffer, document, window, localStorage, sessionStorage, setTimeout, getComputedStyle */
// Live check of the admin dashboard's numbers and its Check in (testers, 5 Oct 2026):
//
//  1. Totals agree. HR (hrm@, company-wide) and the owner see Total employees = the summary's headcount,
//     and the attendance cards count everyone on the roll, themselves too (includeSelf): Present's note
//     is "<n>% of <scheduled> scheduled", plus "· <k> off today" when someone on the roll isn't scheduled
//     (scheduled + off = Total employees). Today's attendance says "<present> of <scheduled> checked in",
//     the cards equal the day's roster from the API, and the Total employees note says "confirmed", never
//     "active" (people on probation are active too).
//  2. Check in from the dashboard. hrm@ presses Check in in the header (the browser's fake camera, a
//     location in the work area, and a stand-in face worker on :8091 that matches any photo, as
//     live-rd-p-att-day does): without a reload Present goes up by one, Not marked down by one, Today's
//     attendance lists them first, and the header offers Check out. The owner's dashboard counts them too.
//  3. The check-in prompt after sign-in, for a brand-new employee added the way the testers did (joined
//     today, no shift, Employee + Dept Manager access, signed in through the invitation): it opens.
//
// It adds that employee (and their login) and enrols hrm@'s face when it has none; everything it creates
// is removed at the end (the punch, its face check, the employee and login, notifications and audit rows).
// Screenshots: /c/REACT/ut-wt/_results/shots/dash-counts-*.png (1440 and 390 wide).
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-dashboard-counts.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3150'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const HRM = '33333333-3333-3333-3333-333333333333' // hrm@'s employee id
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── a stand-in face worker on :8091: one face in every photo, and every photo matches ──
const b64 = (s) => Buffer.from(s).toString('base64')
const ENROL_PHOTO = b64('MATCH-enrol-' + Date.now())
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
      const n = (b.candidateEmbeddingsBase64 || []).length
      return json({ ...face, match_score: 0.95, match_mean: 0.95, match_scores: Array(n).fill(0.95), candidate_count: n })
    }
    res.writeHead(404); res.end()
  })
})
const workerUp = await new Promise((resolve) => { worker.once('error', () => resolve(false)); worker.listen(8091, () => resolve(true)) })

async function apiLogin(email, pw = password) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: pw }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.claims = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString())
  return call
}

// ── the day's roster as the dashboard counts it (attendanceBuckets.dayBuckets, today) ──
const WORKED = new Set(['PRESENT', 'LATE', 'HALF_DAY'])
const COUNTED = new Set([...WORKED, 'ON_LEAVE', 'ABSENT', 'NOT_MARKED'])
function buckets(rows) {
  let present = 0, notMarked = 0, other = 0
  for (const s of rows) {
    const eff = s.effectiveStatus
    if (eff) {
      if (WORKED.has(eff)) present++
      else if (eff === 'ABSENT' || eff === 'NOT_MARKED') notMarked++
      else if (!COUNTED.has(eff)) other++
      continue
    }
    if (s.checkInAt) present++
    else if (!s.onLeave) notMarked++
  }
  return { total: rows.length, present, notMarked, sched: Math.max(0, rows.length - other) }
}
const pct = (n, whole) => (whole > 0 ? Math.round((n / whole) * 100) : 0)
// dashboardModel.presentNote: a company-wide viewer (scheduled + off = Total employees), or a viewer who sees their team.
const presentNote = (present, sched, total, team = false) => {
  if (team) return sched ? `Your team: ${pct(present, sched)}% of ${sched}` : 'Your team: nobody'
  if (!sched) return 'Nobody scheduled today'
  const off = total - sched
  return off > 0 ? `${sched} scheduled · ${off} off` : `${pct(present, sched)}% of ${sched} scheduled`
}
// The note is one line with an ellipsis: it must be read whole (its text, in its font, no wider than its box).
const noteFits = (page, label) => page.getByRole('button', { name: new RegExp('^\\s*' + label, 'i') }).first().locator('.uk-stat__note')
  .evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d')
    c.font = getComputedStyle(el).font
    return c.measureText(el.textContent || '').width <= el.getBoundingClientRect().width + 1
  }).catch(() => false)

// ── fixtures and what was there before ───────────────────────────────────────
const start = sql(`select now()`)
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const tag = String(Date.now() % 1000000)
const newEmail = `dash-counts-${tag}@example.invalid`
const area = (() => {
  const [lat, lng] = sql(`select coalesce(z.latitude, b.latitude, hq.latitude) || '|' || coalesce(z.longitude, b.longitude, hq.longitude)
      from hrms.employees e
      left join public.geo_fence_zones z on z.id = e.geo_fence_zone_id and z.is_active
      left join org.branches b on b.id = e.branch_id
      left join lateral (select latitude, longitude from org.branches where company_id = e.company_id and is_active
                          order by is_headquarters desc, name asc limit 1) hq on true
     where e.id = '${HRM}'`).split('|').map(Number)
  return { latitude: lat, longitude: lng }
})()
const hrmHadToday = sql(`select count(*) from attendance.records where employee_id='${HRM}' and attendance_date='${today}'`) !== '0'
const hrmHadEnrollment = sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${HRM}'`) !== '0'
let createdEnrollment = false
let newEmp = null, newUser = null

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  // hrm@'s punch today (only one this run made) and its face check, zone check and notifications.
  const recs = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from attendance.records where employee_id='${HRM}' and attendance_date='${today}' and created_at >= '${start}'`)
  if (recs) {
    q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and entity_id::text in (${recs})`)
    q(`delete from attendance.event_logs where record_id::text in (${recs})`)
    q(`delete from attendance.records where id::text in (${recs})`)
  }
  q(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${HRM}' and created_at >= '${start}'`)
  q(`delete from public.geo_fence_audits where tenant_id='${tenant}' and employee_id='${HRM}' and created_at >= '${start}'`)
  if (createdEnrollment) {
    q(`delete from attendance.face_embedding_templates where tenant_id='${tenant}' and employee_id='${HRM}'`)
    q(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${HRM}'`)
  }
  // The employee this run added, and their login (roles, overrides and invitation go with it).
  const emp = newEmp || sql(`select coalesce(string_agg(id::text, ','), '') from hrms.employees where lower(email)=lower('${newEmail}')`)
  const user = newUser || sql(`select coalesce(string_agg(id::text, ','), '') from auth.user_credentials where lower(email)=lower('${newEmail}')`)
  const ids = [...String(emp || '').split(','), ...String(user || '').split(',')].filter(Boolean)
  q(`delete from notif.notifications where tenant_id='${tenant}' and created_at >= '${start}'
      and (data::text like '%${HRM}%'${ids.map((x) => ` or data::text like '%${x}%' or user_id::text = '${x}'`).join('')})`)
  if (ids.length) q(`delete from audit.events where entity_id::text in (${ids.map((x) => `'${x}'`).join(',')})`)
  // hrm@'s face enrolment, when this run made it.
  if (createdEnrollment) q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and entity_id::text = '${HRM}' and module='attendance'`)
  q(`delete from auth.user_credentials where lower(email)=lower('${newEmail}')`)
  for (const e of String(emp || '').split(',').filter(Boolean)) {
    for (const s of [
      `delete from attendance.face_verification_events where employee_id='${e}'`,
      `delete from attendance.employee_shift_assignments where employee_id='${e}'`,
      `delete from hrms.onboarding_instances where employee_id='${e}'`,
      `delete from hrms.employee_onboarding_records where employee_id='${e}'`,
      `delete from leave_mgmt.leave_balances where employee_id='${e}'`,
      `delete from hrms.probation_reminder_log where employee_id='${e}'`,
      `delete from hrms.employee_status_history where employee_id='${e}'`,
      `delete from hrms.employees where id='${e}'`,
    ]) q(s)
  }
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
// `promptSeen`: the login id whose check-in prompt already opened in this visit (punchPromptRules' memory), so it
// stays away and the dashboard's own Check in button is the one pressed.
async function session(email, { width = 1440, pw = password, promptSeen = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    permissions: ['geolocation', 'camera'], geolocation: { latitude: area.latitude, longitude: area.longitude, accuracy: 20 },
  })
  await ctx.addInitScript(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ } })
  if (promptSeen) await ctx.addInitScript(([id, day]) => { try { sessionStorage.setItem(`ut.punch-prompt.opened:${id}`, day) } catch { /* private mode */ } }, [promptSeen, today])
  const page = await ctx.newPage()
  const errors = [], failed = []
  let navigations = 0
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(pw)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  const shot = (name) => page.screenshot({ path: `${SHOTS}/dash-counts-${name}.png`, fullPage: false }).catch(() => {})
  return { ctx, page, errors, failed, shot, navs: () => navigations }
}

// A stat card's figure and note (the figure counts up, so it's read once it has settled).
async function card(page, label) {
  const tile = page.getByRole('button', { name: new RegExp('^\\s*' + label, 'i') }).first()
  await tile.waitFor({ timeout: 30_000 })
  let v = '', prev = null
  for (let i = 0; i < 12; i++) {
    v = ((await tile.locator('.uk-stat__value').textContent().catch(() => '')) || '').replace(/\s+/g, '')
    if (v && v === prev) break
    prev = v; await sleep(400)
  }
  const n = ((await tile.locator('.uk-stat__note').textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  return { v, n }
}
const attSub = async (page) => ((await page.getByText(/\d+ of \d+ checked in/).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()

try {
  const owner = await apiLogin('owner@unifiedtree.demo')
  const hrm = await apiLogin('hrm@unifiedtree.demo')
  check('hrm@ (HR manager) is a company-wide viewer who may check in from the web',
    ['attendance.workforce.admin', 'attendance.checkin.self', 'attendance.face.verify.self'].every((p) => hrm.claims.permissions?.includes(p)) && hrm.claims.employee_id === HRM)

  // ── a brand-new employee, as the testers added one: joined today, no shift, Employee + Dept Manager ──
  const made = await owner('POST', '/v1/hrms/employees', { companyId: company, firstName: 'Dash Counts', lastName: `QA ${tag}`, email: newEmail, dateOfJoining: today, employmentType: 'FULL_TIME', roleCode: 'EMPLOYEE' })
  newEmp = made.json?.id || null
  check('owner adds an employee (joined today, no shift)', made.status >= 200 && made.status < 300 && !!newEmp, `${made.status} ${JSON.stringify(made.json).slice(0, 160)}`)
  const inv = newEmp ? await owner('POST', `/v1/employees/${newEmp}/invite`, {}) : { status: 0 }
  newUser = sql(`select coalesce(string_agg(id::text, ','), '') from auth.user_credentials where lower(email)=lower('${newEmail}')`) || null
  const role = newUser ? await owner('POST', `/v1/workspace/users/${newUser}/roles`, { roleCode: 'DEPT_MANAGER' }) : { status: 0 }
  // The invitation e-mail isn't read here: its link's token is swapped for one this run knows (accepted in part 3).
  const raw = randomBytes(24).toString('hex')
  if (newUser) sql(`update auth.invitation_tokens set token_hash='${createHash('sha256').update(raw).digest('hex')}' where user_id='${newUser}' and purpose='INVITATION' and used_at is null`)
  check('they are invited with Employee + Dept Manager access', inv.status === 200 && role.status >= 200 && role.status < 300, `invite ${inv.status} · role ${role.status}`)

  // hrm@'s face, for the web punch (enrolled through the API the web enrolment uses).
  if (!hrmHadEnrollment && workerUp) {
    const st = await hrm('POST', '/v1/attendance/face/enroll/start', { deviceFingerprint: 'Web browser (live-dashboard-counts)' })
    createdEnrollment = st.status === 200
    let ok = st.status === 200
    for (const angle of (st.json?.captureSequence || ['FRONT', 'LEFT_30', 'RIGHT_30'])) {
      if (!ok) break
      const s = await hrm('POST', '/v1/attendance/face/enroll/sample', { enrollmentId: st.json.enrollmentId, captureAngle: angle, imageBase64: ENROL_PHOTO, challengePerformed: 'BLINK' })
      ok = s.status === 200 && s.json?.accepted !== false
    }
    const done = ok ? await hrm('POST', '/v1/attendance/face/enroll/complete') : { status: 0 }
    check('hrm@: face enrolled (stand-in worker)', done.status === 200, `${st.status}/${done.status}`)
  }

  // ── 1. the numbers, from the API ──
  const stats = await hrm('GET', `/v1/admin/dashboard/stats?companyId=${company}`)
  const headcount = Number(stats.json?.headcount)
  const rosterOf = async (who) => (await who('GET', `/v1/attendance/dashboard?date=${today}&includeSelf=true`)).json?.staffStatuses ?? []
  const roster0 = await rosterOf(hrm)
  const b0 = buckets(roster0)
  const hrmRow0 = roster0.find((s) => s.employeeId === HRM)
  check('the dashboard roster lists the viewer (includeSelf), not marked yet', !!hrmRow0 && !hrmRow0.checkInAt, hrmRow0 ? hrmRow0.effectiveStatus : 'hrm@ not on the roster')
  check('the new employee (no shift) is on today\'s roster, not marked', roster0.some((s) => s.employeeId === newEmp && !s.checkInAt && s.effectiveStatus === 'NOT_MARKED'))
  check('everyone on the roll is either scheduled or off today (scheduled ≤ headcount)', Number.isFinite(headcount) && b0.sched <= headcount, `headcount ${headcount} · scheduled ${b0.sched} · roster ${b0.total}`)

  // HR gets the check-in prompt after signing in, as anyone who punches does (testers: "HR and Owner also get the check-in dialog").
  {
    const p = await session('hrm@unifiedtree.demo')
    const shown = await p.page.getByRole('dialog', { name: 'Check in with your face' }).waitFor({ timeout: 25_000 }).then(() => true, () => false)
    check('hrm@: the check-in prompt opens after signing in', shown)
    await p.ctx.close()
  }

  // ── 1. the numbers, on the page (hrm@, 1440; the prompt already seen this visit) ──
  const h = await session('hrm@unifiedtree.demo', { promptSeen: hrm.claims.sub })
  await h.page.goto(base + '/dashboard')
  await h.page.waitForLoadState('networkidle').catch(() => {})
  const total = await card(h.page, 'Total employees')
  const present0 = await card(h.page, 'Present')
  const none0 = await card(h.page, 'Not marked')
  check('Total employees is the headcount', total.v === String(headcount), `${total.v} vs ${headcount}`)
  check('its note says "confirmed", never "active" (people on probation are active too)', /confirmed|on probation|Everyone on the roll/.test(total.n) && !/\bactive\b/i.test(total.n), total.n)
  check('Present and Not marked are the roster\'s', present0.v === String(b0.present) && none0.v === String(b0.notMarked), `present ${present0.v}/${b0.present} · not marked ${none0.v}/${b0.notMarked}`)
  check('Present\'s note: scheduled, and who is off when that isn\'t the whole roll', present0.n === presentNote(b0.present, b0.sched, headcount), `"${present0.n}" vs "${presentNote(b0.present, b0.sched, headcount)}"`)
  check('Present\'s note is read whole at 1440 (not cut off)', await noteFits(h.page, 'Present'))
  const sub0 = await attSub(h.page)
  check('Today\'s attendance says the same "<present> of <scheduled>"', sub0.startsWith(`${b0.present} of ${b0.sched} checked in`), sub0)
  await h.shot('hrm-before-1440')

  // ── 2. Check in from the dashboard header, no reload ──
  if (hrmHadToday || !workerUp) {
    check('hrm@ checks in from the dashboard', false, hrmHadToday ? 'hrm@ already has attendance today in this database' : 'port 8091 is in use, so the stand-in worker could not start')
  } else {
    const navsBefore = h.navs()
    await h.page.getByRole('button', { name: 'Check in', exact: true }).click()
    const dlg = h.page.getByRole('dialog', { name: 'Check in with your face' })
    await dlg.waitFor({ timeout: 10_000 })
    const verify = dlg.getByRole('button', { name: 'Verify and check in' })
    await h.page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Verify and check in'); return !!b && !b.disabled }, null, { timeout: 25_000 }).catch(() => {})
    const posted = h.page.waitForResponse((x) => x.url().includes('/v1/attendance/checkin') && x.request().method() === 'POST', { timeout: 30_000 }).catch(() => null)
    await verify.click()
    const resp = await posted
    check('the header\'s Check in punches hrm@ in (WEB, with the face check)', !!resp && resp.status() === 200
      && sql(`select check_in_method from attendance.records where employee_id='${HRM}' and attendance_date='${today}'`) === 'WEB', resp ? String(resp.status()) : 'no request')
    await dlg.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
    // The cards follow without a reload: the punch refreshes the day's roster.
    let present1 = present0, none1 = none0
    for (let i = 0; i < 30; i++) {
      present1 = await card(h.page, 'Present'); none1 = await card(h.page, 'Not marked')
      if (present1.v === String(b0.present + 1)) break
      await sleep(500)
    }
    const b1 = buckets(await rosterOf(hrm))
    check('Present goes up by one, without a reload', present1.v === String(b0.present + 1) && b1.present === b0.present + 1 && h.navs() === navsBefore, `${present0.v} → ${present1.v} · reloads ${h.navs() - navsBefore}`)
    check('Not marked goes down by one', none1.v === String(b0.notMarked - 1), `${none0.v} → ${none1.v}`)
    check('Present\'s note keeps the same scheduled count', present1.n === presentNote(b0.present + 1, b0.sched, headcount), present1.n)
    const sub1 = await attSub(h.page)
    check('Today\'s attendance: one more checked in, and hrm@ first in the list', sub1.startsWith(`${b0.present + 1} of ${b0.sched} checked in`)
      && ((await h.page.getByRole('list', { name: 'Check-ins today' }).getByRole('listitem').first().innerText().catch(() => '')).includes('HR Manager')), sub1)
    check('the header now offers Check out', await h.page.getByRole('button', { name: 'Check out', exact: true }).waitFor({ timeout: 10_000 }).then(() => true, () => false))
    await h.page.getByRole('button', { name: 'Check in', exact: true }).waitFor({ state: 'detached', timeout: 1000 }).catch(() => {})
    await h.shot('hrm-after-1440')
    await h.page.setViewportSize({ width: 390, height: 844 }); await sleep(900)
    const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('390 wide: no sideways scroll, and Present\'s note is read whole', overflow <= 1 && await noteFits(h.page, 'Present'), `overflow ${overflow}`)
    await h.shot('hrm-after-390')
    await h.page.evaluate(() => document.getElementById('workspace-content')?.scrollTo(0, 0))
    await h.page.setViewportSize({ width: 1440, height: 900 })

    // The owner's dashboard counts hrm@'s check-in, and the owner themself (on the roll, not checked in).
    const o = await session('owner@unifiedtree.demo', { promptSeen: owner.claims.sub })
    await o.page.goto(base + '/dashboard')
    await o.page.waitForLoadState('networkidle').catch(() => {})
    const ob = buckets(await rosterOf(owner))
    const oTotal = await card(o.page, 'Total employees'), oPresent = await card(o.page, 'Present')
    check('owner: Total employees and Present agree with the roster; the owner is on it', oTotal.v === String(headcount) && oPresent.v === String(ob.present)
      && oPresent.n === presentNote(ob.present, ob.sched, headcount) && (await rosterOf(owner)).some((s) => s.employeeId === owner.claims.employee_id), `${oTotal.v} · ${oPresent.v} · ${oPresent.n}`)
    check('owner: hrm@\'s check-in counts on the owner\'s dashboard too', ob.present === b0.present + 1)
    check('owner: no page errors or refused calls', !o.errors.length && !o.failed.length, [...o.errors, ...o.failed].slice(0, 3).join(' | '))
    await o.shot('owner-1440')
    await o.ctx.close()
  }
  check('hrm@: no page errors or refused calls', !h.errors.length && !h.failed.length, [...h.errors, ...h.failed].slice(0, 3).join(' | '))
  await h.ctx.close()

  // fin@ (Finance lead: the directory, and their own team's attendance only): Present says it is their team.
  {
    const fin = await apiLogin('fin@unifiedtree.demo')
    const fb = buckets((await fin('GET', `/v1/attendance/dashboard?date=${today}&includeSelf=true`)).json?.staffStatuses ?? [])
    const f = await session('fin@unifiedtree.demo', { promptSeen: fin.claims.sub })
    await f.page.goto(base + '/dashboard')
    await f.page.waitForLoadState('networkidle').catch(() => {})
    const fTotal = await card(f.page, 'Total employees'), fPresent = await card(f.page, 'Present')
    check('fin@: Total employees is the company, Present says it is their team', !fin.claims.permissions?.includes('attendance.workforce.admin')
      && fTotal.v === String(headcount) && fPresent.n === presentNote(fb.present, fb.sched, headcount, true) && await noteFits(f.page, 'Present'), `${fTotal.v} · ${fPresent.v} · ${fPresent.n}`)
    await f.shot('fin-1440')
    await f.ctx.close()
  }

  // ── 3. the check-in prompt for the brand-new employee ──
  if (newUser) {
    // First the invitation link: set a password, which signs them in and opens Home.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['geolocation', 'camera'], geolocation: { latitude: area.latitude, longitude: area.longitude, accuracy: 20 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message || e)))
    await page.goto(`${base}/accept-invite?token=${raw}`, { timeout: 120_000 })
    await page.getByPlaceholder('Minimum 8 characters').fill(password)
    await page.getByPlaceholder('Re-enter password').fill(password)
    await page.locator('button[type=submit]').click()
    const activated = await page.waitForURL((u) => u.pathname.startsWith('/me'), { timeout: 30_000 }).then(() => true, () => false)
    check('new employee: the invitation link sets the password and opens Home', activated, page.url().replace(base, ''))
    const me = await apiLogin(newEmail)
    const day = await me('GET', '/v1/attendance/my-day')
    const setting = await me('GET', `/v1/attendance/web-punch-setting?companyId=${company}`)
    const facts = `employee_id ${me.claims.employee_id ? 'yes' : 'no'} · checkin.self ${me.claims.permissions?.includes('attendance.checkin.self')} · face.verify.self ${me.claims.permissions?.includes('attendance.face.verify.self')} · my-day ${day.status} ${day.json?.status} checkedIn=${day.json?.checkedIn} web=${day.json?.webPunchAllowed} · setting ${setting.status} ${JSON.stringify(setting.json)?.slice(0, 60)}`
    console.log(`INFO  new employee: ${facts}`)
    const promptA = page.getByRole('dialog', { name: 'Check in with your face' })
    const shownA = await promptA.waitFor({ timeout: 20_000 }).then(() => true, () => false)
    await page.screenshot({ path: `${SHOTS}/dash-counts-new-employee-invite-1440.png` }).catch(() => {})
    check('new employee, straight from the invitation link: the check-in prompt opens on Home', shownA, facts)
    check('new employee: no page errors (invitation)', !errs.length, errs.slice(0, 2).join(' | '))
    await ctx.close()
    // Then a later sign-in on the sign-in page (the welcome plays first).
    const n = await session(newEmail)
    const prompt = n.page.getByRole('dialog', { name: 'Check in with your face' })
    const shown = await prompt.waitFor({ timeout: 25_000 }).then(() => true, () => false)
    await n.shot('new-employee-signin-1440')
    check('new employee, signing in on the sign-in page: the check-in prompt opens after the welcome', shown, facts)
    check('new employee: no page errors (sign-in)', !n.errors.length, n.errors.slice(0, 2).join(' | '))
    await n.ctx.close()
  }
} catch (e) {
  check('test ran to the end', false, String(e && e.stack || e).split('\n').slice(0, 6).join(' | '))
} finally {
  await browser.close()
  worker.close()
  cleanup()
  const left = sql(`select (select count(*) from hrms.employees where lower(email)=lower('${newEmail}'))
      + (select count(*) from auth.user_credentials where lower(email)=lower('${newEmail}'))
      + (select count(*) from attendance.records where employee_id='${HRM}' and attendance_date='${today}' and created_at >= '${start}')
      + (select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${HRM}')`)
  check('cleanup: nothing this run made is left', Number(left) === (hrmHadEnrollment ? 1 : 0), `left ${left}`)
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
