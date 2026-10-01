/* global process, console, fetch, Buffer, document, window, localStorage */
// Live check of P-ATT-DAY's pages (HRMS redesign, UI half): Daily tracking, My Attendance, Timesheet,
// Face Punch, Regularization, Review, Muster roll, Manual entry and the web punch dialog, per role,
// against the real API, in light and dark, at 1440 and 390 wide.
//
//  - owner@ (HR): Daily Logs (filter cards add up to the table, a card filters, the day panel's
//    Fix this day, the day register download, Mark attendance and Punch for a team member open),
//    Face Punch (the month calendar per person, the log), Review, Regularization, Timesheet
//    approvals, Muster roll, Manual entry; HR configuration's "Allow web check-in" turned off
//    (reader@ then sees it off) and on again.
//  - hrm@: marks attendance for fin@ on a past day with the bulk panel (removed afterwards).
//  - reader@: My Attendance; the web punch dialog with the browser's fake camera and a location in
//    the work area: check in (the real captured frame goes to the server, which checks it with a
//    stand-in face worker on :8091 that matches any photo but a stranger's), a break, check out,
//    undo the check-out, check out again; a fix request; Timesheet: add time, submit the week.
//  - mgr@: the timesheet waiting for approval, approved; Punch for a team member is a header button;
//    the fix request approved, then taken back (Undo), then rejected.
//  - fin@: Daily tracking opens with no refused calls.
// The camera can be faked in headless Chromium (a test pattern), so the face path runs end to end
// except that the stand-in worker, not the real model, decides the match (as live-w3-punch does).
// Everything it creates is removed at the end. Screenshots: /c/REACT/ut-wt/_results/shots/rd-p-att-day-*.png
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-att-day.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3122'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const FIN = '55555555-5555-5555-5555-555555555555'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ── a stand-in face worker on :8091: one face in every photo; everything matches but a STRANGER photo ──
const b64 = (s) => Buffer.from(s).toString('base64')
const ENROL_PHOTO = b64('MATCH-enrol-' + Date.now())
const embedding = (() => { const f = new Float32Array(128); for (let i = 0; i < 128; i++) f[i] = Math.sin(i + 1) / 8; return Buffer.from(f.buffer).toString('base64') })()
let verifyCalls = 0
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
      verifyCalls++
      const photo = Buffer.from(b.imageBase64 || '', 'base64')
      const n = (b.candidateEmbeddingsBase64 || []).length
      const score = photo.toString('latin1').startsWith('STRANGER') ? 0.3 : 0.95
      return json({ ...face, match_score: score, match_mean: score, match_scores: Array(n).fill(score), candidate_count: n })
    }
    res.writeHead(404); res.end()
  })
})
const workerUp = await new Promise((resolve) => { worker.once('error', () => resolve(false)); worker.listen(8091, () => resolve(true)) })

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

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
const readerHadToday = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) !== '0'
const readerHadEnrollment = sql(`select count(*) from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) !== '0'
const hrConfigRows = sql(`select count(*) from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`)
const webWas = hrConfigRows === '0' ? null : sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`)
const monday = sql(`select date_trunc('week', '${today}'::date)::date::text`)
const freeDay = (ids, fromBack, toBack, openPayrollOnly = false) => {
  for (let back = fromBack; back < toBack; back++) {
    const d = sql(`select ('${today}'::date - ${back})::text`)
    if (Number(sql(`select extract(isodow from '${d}'::date)`)) >= 6) continue
    // Undo is refused once payroll is locked or paid for the day's month (DECISIONS 15).
    if (openPayrollOnly && sql(`select count(*) from payroll.runs where tenant_id='${tenant}' and period_year = extract(year from '${d}'::date)
        and period_month = extract(month from '${d}'::date) and status in ('LOCKED','PAID')`) !== '0') continue
    if (sql(`select count(*) from attendance.records where employee_id in (${ids.map((i) => `'${i}'`).join(',')}) and attendance_date='${d}'`) === '0'
      && sql(`select count(*) from attendance.regularization_requests where employee_id in (${ids.map((i) => `'${i}'`).join(',')}) and missing_for_date='${d}'`) === '0') return d
  }
  return null
}
const bulkDay = freeDay([FIN], 20, 60)
const fixDay = freeDay([READER], 1, 45, true)
let createdEnrollment = false
const fixReason = `RD att-day UI check ${Date.now() % 100000}`
const timeNote = `RD att-day timesheet ${Date.now() % 100000}`

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  if (hrConfigRows === '0') q(`delete from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}' and created_at >= '${start}'`)
  else q(`update settings.hr_configuration set allow_web_punch = ${webWas === 't' ? 'true' : 'false'} where tenant_id='${tenant}' and company_id='${company}'`)
  const recs = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from attendance.records where tenant_id='${tenant}' and created_at >= '${start}'
      and ((employee_id='${READER}' and attendance_date in ('${today}'${fixDay ? `,'${fixDay}'` : ''})) or (employee_id='${FIN}' and attendance_date='${bulkDay}'))`)
  if (recs) {
    q(`delete from attendance.event_logs where record_id::text in (${recs})`)
    q(`delete from attendance.records where id::text in (${recs})`)
  }
  q(`delete from attendance.regularization_requests where tenant_id='${tenant}' and employee_id='${READER}' and reason = '${fixReason}'`)
  q(`delete from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}'`)
  q(`delete from public.geo_fence_audits where tenant_id='${tenant}' and employee_id in ('${READER}','${FIN}') and created_at >= '${start}'`)
  if (createdEnrollment) {
    q(`delete from attendance.face_embedding_templates where tenant_id='${tenant}' and employee_id='${READER}'`)
    q(`delete from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`)
  }
  q(`do $$ begin if to_regclass('hrms.timesheet_weeks') is not null then delete from hrms.timesheet_weeks where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}'; end if; end $$`)
  q(`delete from hrms.time_entries where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}'`)
  q(`delete from hrms.report_exports where tenant_id='${tenant}' and report='muster-roll' and created_at >= '${start}'`)
  q(`delete from notif.notifications where tenant_id='${tenant}' and created_at >= '${start}' and type in ('TIMESHEET_SUBMITTED','TIMESHEET_DECIDED','CORRECTION_SUBMITTED','CORRECTION_APPROVED','CORRECTION_REJECTED','DECISION_UNDONE')`)
  q(`do $$ begin if to_regclass('hrms.approval_decisions') is not null then delete from hrms.approval_decisions where tenant_id='${tenant}' and decided_at >= '${start}'; end if; end $$`)
  q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and module='attendance'
      and action in ('MANUAL_ENTRY','WEB_PUNCH_SETTING_CHANGED','CHECKOUT_UNDONE','TIMESHEET_APPROVED','TIMESHEET_REJECTED')`)
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
async function session(email, { width = 1440, theme = 'light' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 }, acceptDownloads: true,
    permissions: ['geolocation', 'camera'], geolocation: { latitude: area.latitude, longitude: area.longitude, accuracy: 20 },
  })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  // The first page of a fresh slot compiles the app; give it time.
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(800)
  errors.length = 0; failed.length = 0
  const go = async (path) => { await page.goto(base + path); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(900) }
  const shot = (name) => page.screenshot({ path: `${SHOTS}/rd-p-att-day-${name}.png`, fullPage: true }).catch(() => {})
  // Refused calls a page makes on purpose don't count (a 4xx a test step provokes is listed by the step itself).
  const refused = (allowed = []) => failed.filter((f) => !allowed.some((a) => f.includes(a)))
  return { ctx, page, errors, failed, go, shot, refused }
}
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)

try {
  const ownerApi = await apiLogin('owner@unifiedtree.demo')
  const readerApi = await apiLogin('reader@unifiedtree.demo')

  // ─────────────────────────────── owner: Daily Logs ───────────────────────────────
  const o = await session('owner@unifiedtree.demo')
  await o.go('/hrms/attendance')
  const views = o.page.getByRole('tablist', { name: 'Daily tracking views' })
  check('owner: the views are inline pills, Daily Logs first and open', (await views.getByRole('tab', { name: /^Daily Logs/ }).getAttribute('aria-selected')) === 'true'
    && (await views.getByRole('tab').allInnerTexts()).join(' ').replace(/\s+/g, ' ').match(/Daily Logs.*Face Punch.*Regularization.*Review.*Timesheet/) !== null,
    (await views.getByRole('tab').allInnerTexts()).join(' | ').replace(/\s+/g, ' '))
  check('owner: no My Attendance view for an owner', (await views.getByRole('tab', { name: /^My Attendance/ }).count()) === 0)
  check('owner: the page title is the design\'s "Today"', (await o.page.getByRole('heading', { name: 'Today', exact: true }).count()) === 1)
  const dash = await ownerApi('GET', `/v1/attendance/dashboard?date=${today}`)
  const roster = dash.json?.staffStatuses?.length ?? -1
  const table = o.page.getByRole('table', { name: 'Check-ins' })
  const rows = await table.locator('tbody tr').count()
  const line = (await o.page.getByText(/Showing \d+ of \d+/).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('owner: the check-ins list everyone on today\'s roster, and the line says so', rows === Math.min(roster, 50) && new RegExp(`Showing ${roster > 50 ? '1–50' : roster} of ${roster} people`).test(line), `${rows} rows · roster ${roster} · ${line}`)
  const nmCard = o.page.getByRole('button', { name: /^Not marked \d+/ })
  const nmCount = Number((await nmCard.getAttribute('aria-label') || '').match(/\d+/)?.[0] ?? NaN)
  await nmCard.click(); await o.page.waitForTimeout(400)
  const nmRows = await table.locator('tbody tr').count()
  check('owner: a card filters the table (Not marked) and the URL keeps it', o.page.url().includes('status=NOT_MARKED') && (nmCount === 0 ? true : nmRows === Math.min(nmCount, 50)), `${nmRows} rows vs card ${nmCount}`)
  await nmCard.click(); await o.page.waitForTimeout(300)
  await table.locator('tbody tr').first().click()
  const fix = o.page.getByRole('button', { name: 'Fix this day' })
  await fix.waitFor({ timeout: 8000 }).catch(() => {})
  await o.shot('owner-logs-panel-1440-light')
  await fix.click()
  await o.page.waitForURL(/\/hrms\/attendance\/manual-entry\?employeeId=[0-9a-f-]{36}&date=\d{4}-\d{2}-\d{2}/, { timeout: 10_000 }).catch(() => {})
  check('owner: the day panel\'s "Fix this day" opens manual entry for that person and day', /manual-entry\?employeeId=[0-9a-f-]{36}&date=\d{4}-\d{2}-\d{2}/.test(o.page.url()), o.page.url().replace(base, ''))
  await o.go('/hrms/attendance')
  const downloading = o.page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
  await o.page.getByRole('button', { name: 'Export', exact: true }).click()
  const dl = await downloading
  check('owner: Export downloads the day register (muster-roll-<day>.csv)', !!dl && dl.suggestedFilename() === `muster-roll-${today}.csv`, dl?.suggestedFilename())
  await o.page.getByRole('button', { name: 'Mark attendance' }).first().click()
  const bulk = o.page.getByRole('dialog', { name: 'Mark attendance' })
  check('owner: Mark attendance opens its panel', await bulk.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))
  await bulk.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
  await o.page.getByRole('button', { name: 'Punch for a team member' }).click()
  const assist = o.page.getByRole('dialog', { name: 'Punch for a team member' })
  const assistOpen = await assist.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
  await o.page.waitForTimeout(1200)
  check('owner: Punch for a team member opens with the people they may punch', assistOpen && (await assist.getByRole('list', { name: 'People you can punch for' }).locator('li').count()) > 0)
  await o.shot('owner-assist-1440-light')
  await o.page.keyboard.press('Escape')
  await o.shot('owner-logs-1440-light')
  check('owner Daily Logs: no page errors or refused calls', !o.errors.length && !o.refused().length, o.errors[0] || o.refused()[0] || '')

  // Face Punch, Review, Regularization, Timesheet.
  await o.go('/hrms/attendance?tab=face')
  check('owner: Face Punch shows one person\'s month calendar and the full log',
    (await o.page.getByText('Face punches by person', { exact: true }).count()) === 1 && (await o.page.getByRole('grid').count()) > 0
    && (await o.page.getByText('Face Punch Logs', { exact: true }).count()) === 1, '')
  await o.shot('owner-face-1440-light')
  await o.go('/hrms/attendance?tab=review')
  check('owner: Review lists the days to look at', (await o.page.getByRole('table', { name: 'Review list' }).count()) === 1 && (await o.page.getByRole('group', { name: 'Review views' }).count()) === 1)
  await o.shot('owner-review-1440-light')
  await o.go('/hrms/attendance?tab=corrections')
  check('owner: Regularization opens on the team\'s requests', (await o.page.getByText('Waiting for your OK', { exact: true }).count()) === 1)
  await o.shot('owner-regularization-1440-light')
  await o.go('/hrms/attendance?tab=timesheet')
  check('owner: Timesheet shows the weeks waiting for approval (no own week for an owner)', (await o.page.getByText('Waiting for approval', { exact: true }).count()) === 1 && (await o.page.getByRole('table', { name: 'Time this week' }).count()) === 0)
  await o.go('/hrms/muster-roll'); await o.shot('owner-muster-1440-light')
  await o.go('/hrms/attendance/manual-entry'); await o.shot('owner-manual-entry-1440-light')
  check('owner: the other views have no page errors or refused calls', !o.errors.length && !o.refused().length, o.errors[0] || o.refused()[0] || '')

  // HR configuration: the company switch, off then on.
  await o.go('/hrms/settings')
  const sw = o.page.getByRole('switch', { name: /Allow web check-in/ })
  const swShown = await sw.first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
  check('owner: HR configuration > Attendance rules has "Allow web check-in", on', swShown && (await sw.first().getAttribute('aria-checked')) === 'true')
  if (swShown) {
    await sw.first().click()
    const saving = o.page.waitForResponse((r) => r.url().includes('/v1/attendance/web-punch-setting') && r.request().method() === 'PUT', { timeout: 15_000 }).catch(() => null)
    await o.page.getByRole('button', { name: /^Save/ }).first().click()
    const sv = await saving
    check('owner: turning it off saves the switch', !!sv && sv.ok() && sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === 'f', sv ? String(sv.status()) : 'no request')
  }
  await o.shot('owner-hrconfig-1440-light')

  // ─────────────────────────────── reader: My Attendance, web punch ───────────────────────────────
  const r = await session('reader@unifiedtree.demo')
  await r.go('/hrms/attendance')
  check('reader: opens on My Attendance; no Daily Logs', (await r.page.getByRole('tab', { name: /^My Attendance/ }).getAttribute('aria-selected')) === 'true'
    && (await r.page.getByRole('tab', { name: /^Daily Logs/ }).count()) === 0)
  check('reader: switched off, Your day says so and offers no Check in',
    (await r.page.getByText('Web check-in is turned off for your company').count()) === 1 && (await r.page.getByRole('button', { name: 'Check in', exact: true }).count()) === 0)
  if (swShown) {
    await o.go('/hrms/settings')
    await sw.first().click()
    const saving = o.page.waitForResponse((x) => x.url().includes('/v1/attendance/web-punch-setting') && x.request().method() === 'PUT', { timeout: 15_000 }).catch(() => null)
    await o.page.getByRole('button', { name: /^Save/ }).first().click()
    const sv = await saving
    check('owner: switched back on', !!sv && sv.ok() && sql(`select allow_web_punch from settings.hr_configuration where tenant_id='${tenant}' and company_id='${company}'`) === 't')
  }
  // reader@'s face: enrolled through the API the web enrolment uses (the dialog's own enrolment needs three poses).
  if (!readerHadEnrollment || sql(`select status from attendance.face_enrollments where tenant_id='${tenant}' and employee_id='${READER}'`) !== 'ACTIVE') {
    if (workerUp) {
      const st = await readerApi('POST', '/v1/attendance/face/enroll/start', { deviceFingerprint: 'Web browser (live-rd-p-att-day)' })
      createdEnrollment = !readerHadEnrollment
      let ok = st.status === 200
      for (const angle of (st.json?.captureSequence || ['FRONT', 'LEFT_30', 'RIGHT_30'])) {
        if (!ok) break
        const s = await readerApi('POST', '/v1/attendance/face/enroll/sample', { enrollmentId: st.json.enrollmentId, captureAngle: angle, imageBase64: ENROL_PHOTO, challengePerformed: 'BLINK' })
        ok = s.status === 200 && s.json?.accepted !== false
      }
      const done = ok ? await readerApi('POST', '/v1/attendance/face/enroll/complete') : { status: 0 }
      check('reader: face enrolled (stand-in worker)', done.status === 200, `${st.status}/${done.status}`)
    }
  }
  if (readerHadToday || !workerUp) {
    check('reader: the web punch steps ran', false, readerHadToday ? 'reader@ already has attendance today in this database' : 'port 8091 is in use, so the stand-in worker could not start')
  } else {
    // The dialog on a phone, dark (before reader@ checks in), then the real punch at 1440.
    for (const [width, theme] of [[390, 'dark'], [390, 'light'], [1440, 'dark']]) {
      const s = await session('reader@unifiedtree.demo', { width, theme })
      await s.go('/hrms/attendance?tab=my')
      await s.page.getByRole('button', { name: 'Check in', exact: true }).click()
      const d = s.page.getByRole('dialog', { name: 'Check in with your face' })
      await d.waitFor({ timeout: 10_000 }).catch(() => {})
      await s.page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Verify and check in'); return !!b && !b.disabled }, null, { timeout: 20_000 }).catch(() => {})
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      await s.shot(`reader-webpunch-${width}-${theme}`)
      check(`web punch dialog ${width} ${theme}: camera and Verify shown, no sideways scroll`, (await d.locator('video').count()) === 1 && overflow <= 1 && !s.errors.length, `overflow ${overflow}`)
      await s.ctx.close()
    }
    await r.go('/hrms/attendance?tab=my')
    await r.page.getByRole('button', { name: 'Check in', exact: true }).click()
    const dlg = r.page.getByRole('dialog', { name: 'Check in with your face' })
    await dlg.waitFor({ timeout: 10_000 })
    const verify = dlg.getByRole('button', { name: 'Verify and check in' })
    const ready = await verify.isEnabled({ timeout: 1 }).catch(() => false) || await r.page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Verify and check in')
      return !!b && !b.disabled
    }, null, { timeout: 20_000 }).then(() => true).catch(() => false)
    check('reader: the dialog shows the camera and finds the location, then offers Verify', ready && (await dlg.locator('video').count()) === 1,
      (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200))
    await r.shot('reader-webpunch-1440-light')
    const before = verifyCalls
    const posted = r.page.waitForResponse((x) => x.url().includes('/v1/attendance/checkin') && x.request().method() === 'POST', { timeout: 30_000 }).catch(() => null)
    await verify.click()
    const resp = await posted
    const sent = resp ? JSON.parse(resp.request().postData() || '{}') : {}
    check('reader: Verify sends the WEB punch with the camera\'s photo and the location', !!resp && resp.status() === 200 && sent.checkInMethod === 'WEB'
      && typeof sent.faceImageBase64 === 'string' && sent.faceImageBase64.length > 1000 && Math.abs(sent.latitude - area.latitude) < 0.001,
      resp ? `${resp.status()} ${String(sent.faceImageBase64 || '').length} chars` : 'no request')
    check('reader: the server checked that photo with the face worker', verifyCalls === before + 1, `${verifyCalls - before} verify calls`)
    check('reader: a toast says checked in, the dialog closes', await toast(r.page, /Checked in/) && await dlg.waitFor({ state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false))
    check('reader: stored as WEB, with a passed PUNCH_IN face check from the browser',
      sql(`select check_in_method from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'WEB'
      && sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}' and purpose='PUNCH_IN' and result='PASS' and device_fingerprint like 'Web browser%'`) === '1')
    await r.page.waitForTimeout(800)
    await r.page.getByRole('button', { name: 'Take a break' }).click()
    check('reader: Take a break', await toast(r.page, /Break started/))
    await r.page.getByRole('button', { name: 'End break' }).click()
    check('reader: End break', await toast(r.page, /Welcome back/))
    await r.page.getByRole('button', { name: 'Check out', exact: true }).click()
    const dlgOut = r.page.getByRole('dialog', { name: 'Check out with your face' })
    await dlgOut.waitFor({ timeout: 10_000 })
    await r.page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Verify and check out'); return !!b && !b.disabled }, null, { timeout: 20_000 }).catch(() => {})
    const postedOut = r.page.waitForResponse((x) => x.url().includes('/v1/attendance/checkout') && x.request().method() === 'POST', { timeout: 30_000 }).catch(() => null)
    await dlgOut.getByRole('button', { name: 'Verify and check out' }).click()
    const out = await postedOut
    check('reader: web check-out with the face: 200, WEB, a PUNCH_OUT face check', !!out && out.status() === 200
      && sql(`select check_out_method from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'WEB'
      && sql(`select count(*) from attendance.face_verification_events where tenant_id='${tenant}' and employee_id='${READER}' and created_at >= '${start}' and purpose='PUNCH_OUT' and result='PASS'`) === '1', out ? String(out.status()) : 'no request')
    await toast(r.page, /Checked out/)
    await r.page.waitForTimeout(1200)
    const undoBtn = r.page.getByRole('button', { name: /^Undo check-out/ })
    check('reader: Undo check-out is offered for ten minutes', await undoBtn.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))
    await undoBtn.click()
    check('reader: Undo check-out: checked in again', await toast(r.page, /Check-out taken back/)
      && sql(`select (check_out_at is null)::text from attendance.records where employee_id='${READER}' and attendance_date='${today}'`) === 'true')
    await r.page.waitForTimeout(800)
    await r.page.getByRole('button', { name: 'Check out', exact: true }).click()
    await r.page.getByRole('dialog', { name: 'Check out with your face' }).waitFor({ timeout: 10_000 })
    await r.page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Verify and check out'); return !!b && !b.disabled }, null, { timeout: 20_000 }).catch(() => {})
    await r.page.getByRole('button', { name: 'Verify and check out' }).click()
    check('reader: checked out again', await toast(r.page, /Checked out/))
    await r.page.waitForTimeout(1000)
    await r.shot('reader-my-1440-light')
  }
  // A fix request from My Attendance's "Fix a day".
  if (fixDay) {
    await r.go('/hrms/attendance?tab=my')
    await r.page.getByRole('button', { name: 'Fix a day' }).click()
    const panel = r.page.getByRole('dialog', { name: 'Fix a day' })
    await panel.waitFor({ timeout: 8000 })
    const dayBtn = panel.getByRole('combobox', { name: 'Which day' })
    await dayBtn.click()
    const cal = r.page.getByRole('dialog', { name: 'Choose date' })
    const label = new Date(fixDay + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const cell = cal.locator(`[role=gridcell][aria-label^="${label}"]`)
    if (!(await cell.count())) await cal.getByRole('button', { name: /Previous month/ }).click().catch(() => {})
    await cal.locator(`[role=gridcell][aria-label^="${label}"]`).click().catch(() => {})
    await panel.getByPlaceholder('e.g. Forgot to punch out').fill(fixReason)
    await panel.getByRole('button', { name: 'Send request' }).click()
    check('reader: Fix a day sends the request', await toast(r.page, /Fix request sent/)
      && sql(`select missing_for_date::text from attendance.regularization_requests where employee_id='${READER}' and reason='${fixReason}'`) === fixDay, fixDay)
  } else check('reader: found a free past weekday for the fix request', false)

  // Timesheet: add time and submit the week.
  await r.go('/hrms/attendance?tab=timesheet')
  await r.page.getByRole('button', { name: 'Add time' }).click()
  const add = r.page.getByRole('dialog', { name: 'Add time' })
  await add.waitFor({ timeout: 8000 })
  await add.getByLabel('Hours').fill('2')
  await add.getByLabel('Minutes').fill('30')
  await add.getByLabel(/What did you work on|Notes/).fill(timeNote)
  const savedEntry = r.page.waitForResponse((x) => x.url().includes('/v1/ess/timesheets') && x.request().method() === 'POST', { timeout: 15_000 }).catch(() => null)
  await add.getByRole('button', { name: 'Add time' }).click()
  const se = await savedEntry
  check('reader: Add time saves an entry', !!se && se.ok(), se ? String(se.status()) : 'no request')
  await r.page.waitForTimeout(1200)
  check('reader: the week grid shows it', (await r.page.getByRole('table', { name: 'Time this week' }).innerText().catch(() => '')).includes('2h 30m'))
  const submitted = r.page.waitForResponse((x) => x.url().includes(`/weeks/${monday}/submit`), { timeout: 15_000 }).catch(() => null)
  await r.page.getByRole('button', { name: 'Submit week' }).click()
  const sub = await submitted
  check('reader: Submit week sends it for approval and locks it', !!sub && sub.ok() && await toast(r.page, /Week sent for approval/), sub ? String(sub.status()) : 'no request')
  await r.shot('reader-timesheet-1440-light')
  check('reader: no page errors or refused calls', !r.errors.length && !r.refused().length, r.errors[0] || r.refused()[0] || '')
  await r.ctx.close()

  // ─────────────────────────────── mgr: approvals, assisted punch button ───────────────────────────────
  const m = await session('mgr@unifiedtree.demo')
  await m.go('/hrms/attendance')
  check('mgr: Punch for a team member is the header\'s main button', (await m.page.getByRole('button', { name: 'Punch for a team member' }).count()) === 1)
  await m.shot('mgr-logs-1440-light')
  await m.go('/hrms/attendance?tab=timesheet')
  const card = m.page.locator('article').filter({ hasText: 'Reader' }).filter({ hasText: 'Timesheet' }).first()
  const hasCard = await card.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
  check('mgr: reader@\'s week is waiting for approval', hasCard)
  if (hasCard) {
    const decided = m.page.waitForResponse((x) => x.url().includes('/v1/timesheets/weeks/') && x.url().includes('/decision'), { timeout: 15_000 }).catch(() => null)
    await card.getByRole('button', { name: 'Approve' }).click()
    const dr = await decided
    check('mgr: approves it', !!dr && dr.ok() && sql(`select status from hrms.timesheet_weeks where tenant_id='${tenant}' and employee_id='${READER}' and week_start='${monday}'`) === 'APPROVED', dr ? String(dr.status()) : 'no request')
  }
  if (fixDay) {
    await m.go('/hrms/attendance?tab=corrections')
    const req = m.page.locator('article').filter({ hasText: fixReason })
    check('mgr: the fix request is waiting', await req.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))
    await req.getByRole('button', { name: 'Approve' }).click().catch(() => {})
    check('mgr: approves the fix', await toast(m.page, /Fix approved/))
    await m.page.waitForTimeout(1500)
    const undo = m.page.getByRole('button', { name: 'Undo' }).first()
    const undoShown = await undo.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
    check('mgr: the decided fix offers Undo', undoShown)
    if (undoShown) {
      await undo.click()
      check('mgr: Undo takes the decision back; the request waits again', await toast(m.page, /Decision taken back/)
        && sql(`select status from attendance.regularization_requests where employee_id='${READER}' and reason='${fixReason}'`) === 'PENDING')
      await m.page.waitForTimeout(1200)
      const again = m.page.locator('article').filter({ hasText: fixReason })
      await again.getByPlaceholder('Decision note (optional)').fill('RD UI check — rejected, attendance unchanged')
      await again.getByRole('button', { name: 'Reject' }).click().catch(() => {})
      check('mgr: then rejects it, attendance unchanged', await toast(m.page, /Fix rejected — attendance stays as it was/))
    }
  }
  await m.shot('mgr-regularization-1440-light')
  check('mgr: no page errors or refused calls', !m.errors.length && !m.refused().length, m.errors[0] || m.refused()[0] || '')
  await m.ctx.close()

  // ─────────────────────────────── hrm: bulk mark ───────────────────────────────
  const h = await session('hrm@unifiedtree.demo')
  if (bulkDay) {
    await h.go(`/hrms/attendance?tab=team&date=${bulkDay}`)
    await h.page.getByRole('button', { name: 'Mark attendance' }).first().click()
    const panel = h.page.getByRole('dialog', { name: 'Mark attendance' })
    await panel.waitFor({ timeout: 8000 })
    await panel.getByLabel('Find a person').fill('Finance')
    await panel.getByRole('checkbox', { name: /Finance Lead/ }).first().check().catch(async () => { await panel.getByText('Finance Lead').first().click() })
    await panel.getByLabel('Reason').fill('RD UI check: device was down')
    const posted = h.page.waitForResponse((x) => x.url().includes('/v1/attendance/manual-entry/bulk'), { timeout: 15_000 }).catch(() => null)
    await panel.getByRole('button', { name: /^Mark 1 person/ }).click()
    const pr = await posted
    check('hrm: Mark attendance marks fin@ for a past day', !!pr && pr.ok() && sql(`select manual_entry::text from attendance.records where employee_id='${FIN}' and attendance_date='${bulkDay}'`) === 'true', pr ? String(pr.status()) : 'no request')
  } else check('hrm: found a past weekday with no record for fin@', false)
  await h.shot('hrm-logs-1440-light')
  check('hrm: no page errors or refused calls', !h.errors.length && !h.refused().length, h.errors[0] || h.refused()[0] || '')
  await h.ctx.close()

  // ─────────────────────────────── fin ───────────────────────────────
  const f = await session('fin@unifiedtree.demo')
  await f.go('/hrms/attendance')
  check('fin: Daily tracking opens', (await f.page.getByRole('tablist', { name: 'Daily tracking views' }).count()) === 1)
  check('fin: no page errors or refused calls', !f.errors.length && !f.refused().length, f.errors[0] || f.refused()[0] || '')
  await f.ctx.close()

  // ─────────────────────────────── dark mode and phones ───────────────────────────────
  for (const [who, path, name] of [['owner@unifiedtree.demo', '/hrms/attendance', 'owner-logs'], ['owner@unifiedtree.demo', '/hrms/attendance?tab=face', 'owner-face'],
    ['owner@unifiedtree.demo', '/hrms/attendance?tab=review', 'owner-review'], ['owner@unifiedtree.demo', '/hrms/muster-roll', 'owner-muster'],
    ['reader@unifiedtree.demo', '/hrms/attendance?tab=my', 'reader-my'], ['reader@unifiedtree.demo', '/hrms/attendance?tab=timesheet', 'reader-timesheet']]) {
    for (const [width, theme] of [[1440, 'dark'], [390, 'light'], [390, 'dark']]) {
      const s = await session(who, { width, theme })
      await s.go(path)
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const dark = await s.page.evaluate(() => document.documentElement.getAttribute('data-theme'))
      await s.shot(`${name}-${width}-${theme}`)
      check(`${name} ${width} ${theme}: renders, no sideways scroll${theme === 'dark' ? ', dark theme on' : ''}`, overflow <= 1 && (theme !== 'dark' || dark === 'dark') && !s.errors.length, `overflow ${overflow} · theme ${dark}`)
      await s.ctx.close()
    }
  }
} catch (e) {
  check('script completed', false, String(e.message || e).split('\n')[0].slice(0, 300))
} finally {
  await browser.close().catch(() => {})
  cleanup()
  const left = sql(`select count(*) from attendance.records where tenant_id='${tenant}' and created_at >= '${start}' and ((employee_id='${READER}' and attendance_date='${today}') or (employee_id='${FIN}' and attendance_date='${bulkDay}'))`)
  check('cleanup: the punches and marks this run made are gone', left === '0', left)
  worker.close()
  const failed = results.filter((x) => !x.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
