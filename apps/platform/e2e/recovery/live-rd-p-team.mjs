// Live check of My team's redesigned pages (/team: Team today, Team schedule, Approvals; package
// P-TEAM) in the browser, against a running app, its API and its database:
//   · mgr: the five status tiles and the roster, "Send a reminder" (it survives a reload, the
//     employee is told once), Waiting for you, probation dates without Confirm / Extend, Out soon,
//     Message team (the team is told), the week grid with weekly offs and a request waiting for
//     you that opens Approvals
//   · mgr decides each kind in Approvals (leave, work from home with the reason dialog, an
//     attendance fix, a shift change with a note, an expense claim, a timesheet week): the request
//     changes, the employee is told; then Undo for each undoable kind puts it back and tells them
//   · "Approve N with no warnings" (clicked only when every row it would take is this test's own)
//   · owner extends the fixture's probation from the card (with hrms.probation.team.decide)
//   · hrm doesn't get My team on the rail; reader can't open /team
//   · light and dark at 1440 and 390 (no sideways scroll), screenshots of each view
// Everything it creates is removed at the end.
//
//   RECOVERY_APP_URL=http://demo.localhost:<port> RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-team.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB, RECOVERY_PASSWORD, SHOTS_DIR
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3121'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const MGR = '44444444-4444-4444-4444-444444444444'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => { results.push({ name, ok: true }); console.log(`PASS  ${name}  — skipped: ${why}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await wait(250) } }

// ── dates (India) ───────────────────────────────────────────────────────────
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const addMonth = (d) => { const [y, m, day] = d.split('-').map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10) }
const dow = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w } // 1 Mon … 7 Sun
const today = istToday()
const weekend = (sql(`select coalesce(array_to_string(weekend_days, ','), '6,7') from settings.hr_configuration where company_id='${company}'`) || '6,7')
  .split(',').map(Number)
const holiday = (d) => num(`select count(*) from settings.holiday_calendar where company_id='${company}' and holiday_date='${d}' and is_active`) > 0
const locked = (d) => num(`select count(*) from payroll.runs where tenant_id='${tenant}' and company_id='${company}' and status in ('LOCKED','PAID') and period_start <= '${d}' and period_end >= '${d}'`) > 0
const working = (d) => !weekend.includes(dow(d)) && !holiday(d)
const taken = new Set()
function pick(from, step, ok, limit = 150) {
  for (let i = 0; i < limit; i++) {
    const d = addDays(from, i * step)
    if (!taken.has(d) && ok(d)) { taken.add(d); return d }
  }
  return null
}
const ist = (d, hhmm) => new Date(`${d}T${hhmm}:00+05:30`).toISOString()

// ── API sessions ────────────────────────────────────────────────────────────
async function apiSession(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId }
}

// ── browser sessions ────────────────────────────────────────────────────────
const browser = await chromium.launch()
async function signIn(email, { width = 1440, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* blocked */ } }, theme)
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
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
const toastText = async (page, re, ms = 10_000) => until(async () => {
  const texts = await page.locator('.uko-toast').allTextContents().catch(() => [])
  return texts.find((t) => re.test(t)) || null
}, ms)
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const railState = (page) => page.evaluate(() => {
  const nav = document.querySelector('.ut-railwrap nav[aria-label="Primary"]')
  if (!nav) return null
  const name = (a) => a.getAttribute('aria-label') || a.textContent.replace(/\s+/g, ' ').trim()
  return { groups: [...nav.querySelectorAll('[role=group]')].map((g) => g.getAttribute('aria-label')), items: [...nav.querySelectorAll('a.ut-rail__item')].map(name) }
})

// ── fixtures ────────────────────────────────────────────────────────────────
const A = randomUUID(), UA = randomUUID(), P = randomUUID()
const aEmail = `qa-team-ui-${A.slice(0, 8)}@example.invalid`
const A_NAME = 'QA Team UI Member', P_NAME = 'QA Team UI Probation'
const created = { leave: [], wfh: [], corrections: [], shifts: [], claims: [], weeks: [], messages: [] }
const offDay = ((dow(today) + 2) % 7) + 1 // a weekly off that isn't today, so today's reminder can be tested
const pEnd = addDays(today, 20)
const status = (table, id) => sql(`select status from ${table} where id='${id}'`)
const notesFor = (emp) => num(`select count(*) from notif.notifications where user_id='${emp}'`)
const told = (requestId) => num(`select count(*) from notif.notifications where user_id='${A}' and type='DECISION_UNDONE' and data->>'requestId'='${requestId}'`) > 0

async function main() {
  const mgrApi = await apiSession('mgr@unifiedtree.demo')
  sql(`BEGIN;
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      reporting_manager_id,date_of_joining,weekly_off_days,job_title,created_by,updated_by)
    VALUES ('${A}','${tenant}','${company}','QTU-${A.slice(0, 8)}','QA Team','UI Member','${aEmail}','FULL_TIME','ACTIVE',
      '${MGR}','2025-01-01','${offDay}','QA Engineer','qa','qa');
    INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active)
      SELECT '${UA}','${tenant}','${aEmail}',password_hash,'${A}',true FROM auth.user_credentials
       WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) SELECT '${tenant}','${UA}',id FROM rbac.roles WHERE code='EMPLOYEE' AND tenant_id IS NULL;
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      reporting_manager_id,date_of_joining,probation_end_date,job_title,created_by,updated_by)
    VALUES ('${P}','${tenant}','${company}','QTP-${P.slice(0, 8)}','QA Team','UI Probation','qa-team-ui-prob-${P.slice(0, 8)}@example.invalid',
      'FULL_TIME','PROBATION','${MGR}','${addDays(today, -150)}','${pEnd}','QA Analyst','qa','qa');
    COMMIT;`)
  const a = await apiSession(aEmail)
  check('fixture: a member of mgr\'s team can sign in', a.employeeId === A)

  const types = (await a.call(`/v1/leave/types?companyId=${company}`)).json || []
  const leaveType = types.find((t) => t.active !== false) || types[0]
  const dLeave = pick(addDays(today, 7), 1, (d) => working(d) && !locked(d))
  const L = (await a.call(`/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: leaveType?.id, startDate: dLeave, endDate: dLeave, duration: 'FULL_DAY', reason: 'QA team UI leave' })).json
  if (L?.id) created.leave.push(L.id)
  const dWfh = pick(addDays(today, 8), 1, working)
  const W = (await a.call('/v1/wfh', 'POST', { fromDate: dWfh, toDate: dWfh, reason: 'QA team UI WFH' })).json
  if (W?.id) created.wfh.push(W.id)
  const dFix = pick(addDays(today, -1), -1, (d) => working(d) && !locked(d) && d >= addDays(today, -85))
  const C = dFix ? (await a.call('/v1/attendance/corrections', 'POST', { requestedDate: dFix, requestedCheckInAt: ist(dFix, '09:30'), requestedCheckOutAt: ist(dFix, '18:00'), reason: 'QA team UI fix' })).json : null
  if (C?.id) created.corrections.push(C.id)
  const shiftList = (await a.call(`/v1/shifts?companyId=${company}`)).json || []
  const general = shiftList.find((s) => s.name === 'General' && s.active !== false) || shiftList[0]
  const S = (await a.call('/v1/shifts/change-requests', 'POST', { requestedShiftPolicyId: general?.id, reason: 'QA team UI shift change', effectiveDate: addDays(today, 3) })).json
  if (S?.id) created.shifts.push(S.id)
  const E = (await a.call('/v1/expense/claims', 'POST', { title: 'QA team UI claim', currency: 'INR', notes: 'QA team UI claim', items: [{ category: 'TRAVEL', description: 'Taxi', amount: 500, expenseDate: addDays(today, -2) }] })).json
  if (E?.id) created.claims.push(E.id)
  const lastMonday = addDays(today, -(dow(today) - 1) - 7)
  const entry = await a.call('/v1/ess/timesheets', 'POST', { workDate: lastMonday, description: 'QA team UI timesheet', minutes: 480 })
  const T = entry.status === 200 ? (await a.call(`/v1/ess/timesheets/weeks/${lastMonday}/submit`, 'POST')).json : null
  if (T?.id) created.weeks.push(T.id)
  check('fixture: one waiting request of each kind, and a submitted timesheet week', L?.id && W?.id && C?.id && S?.id && E?.id && T?.status === 'SUBMITTED',
    `leave=${!!L?.id} wfh=${!!W?.id} fix=${!!C?.id} shift=${!!S?.id} claim=${!!E?.id} week=${T?.status}`)

  // ── 1. Team today (mgr, 1440, light) ──────────────────────────────────────
  const m = await signIn('mgr@unifiedtree.demo')
  const page = m.page
  await page.goto(base + '/team'); await settle(page)
  check('mgr: Team today is the page title', await page.getByRole('heading', { name: 'Team today', level: 1 }).count() > 0)
  const views = page.getByRole('group', { name: 'My team views' })
  check('mgr: the page views are inline pills: Team today, Team schedule, Approvals',
    await views.getByRole('button', { name: /^Team today/ }).count() === 1 && await views.getByRole('button', { name: /^Team schedule/ }).count() === 1
    && await views.getByRole('button', { name: /^Approvals/ }).count() === 1)
  check('mgr: Team today is the chosen view', await views.getByRole('button', { name: /^Team today/ }).getAttribute('aria-pressed') === 'true')
  for (const t of ['In the office', 'Late', 'At home', 'On leave', 'Not in yet']) check(`mgr: "${t}" tile`, await page.getByText(t, { exact: true }).count() > 0)
  const row = page.locator('.uk-row', { hasText: A_NAME }).first()
  check('mgr: the fixture member is on the roster with their job title', await row.count() === 1 && /QA Engineer/.test(await row.textContent()))
  if (holiday(today) || weekend.includes(dow(today))) skip('mgr: Send a reminder', 'today is not a working day for the company')
  else {
    const remind = page.getByRole('button', { name: `Send a reminder to ${A_NAME}` })
    check('mgr: "Send a reminder" for someone not in yet', await remind.count() === 1)
    if (await remind.count()) {
      await remind.click()
      check('mgr: the reminder is confirmed', !!(await toastText(page, /Reminder sent to QA/)))
      check('mgr: …and the button turns into "Reminder sent"', !!(await until(async () => (await row.textContent()).includes('Reminder sent'))))
      check('reminder: the employee is told once (CHECKIN_REMINDER)', await until(() => num(`select count(*) from notif.notifications where user_id='${A}' and type='CHECKIN_REMINDER'`) === 1))
      await page.reload(); await settle(page)
      check('mgr: "Reminder sent" survives a reload', (await page.locator('.uk-row', { hasText: A_NAME }).first().textContent()).includes('Reminder sent'))
    }
  }
  // Clicking a tile filters the roster; "Show everyone" clears it.
  await page.getByRole('button', { name: /Not in yet/ }).first().click()
  check('mgr: a tile filters the roster', await page.getByRole('button', { name: 'Show everyone' }).count() === 1)
  await page.getByRole('button', { name: 'Show everyone' }).click()
  const waitingCard = page.locator('.uk-sec', { has: page.getByRole('heading', { name: 'Waiting for you' }) })
  check('mgr: Waiting for you lists the member\'s newest requests', !!(await until(async () => (await waitingCard.textContent()).includes(A_NAME))))
  const probCard = page.locator('.uk-sec', { has: page.getByRole('heading', { name: 'Probation' }) })
  const probText = (await probCard.count()) ? await probCard.textContent() : ''
  check('mgr: probation dates for the team member', probText.includes('QA Team UI Probation') && /Probation ends/.test(probText), probText.slice(0, 160))
  check('mgr: no Confirm or Extend without hrms.probation.team.decide', await probCard.getByRole('button', { name: /Confirm|Extend/ }).count() === 0)
  const outCard = page.locator('.uk-sec', { has: page.getByRole('heading', { name: 'Out soon' }) })
  check('mgr: Out soon shows the member\'s leave, waiting for them', (await outCard.textContent()).includes(A_NAME) && (await outCard.textContent()).includes('Waiting for you'))
  check('mgr: the Approvals button counts what is waiting', /Approvals · \d+/.test(await page.getByRole('button', { name: /^Approvals · / }).textContent()))
  await page.screenshot({ path: `${shots}/rd-p-team-today-light-1440.png`, fullPage: true })

  // Message team
  const teamSize = num(`select count(*) from hrms.employees where reporting_manager_id='${MGR}' and tenant_id='${tenant}' and employment_status not in ('EXITED','TERMINATED','RESIGNED','RETIRED') and id <> '${MGR}'`)
  await page.getByRole('button', { name: 'Message team' }).click()
  const panel = page.getByRole('dialog', { name: 'Message team' })
  check('mgr: Message team opens a side panel', await panel.count() === 1)
  await panel.getByLabel('Message').fill('QA team UI: stand-up moves to 10:30 tomorrow.')
  await panel.getByRole('button', { name: 'Send' }).click()
  const sentToast = await toastText(page, /Sent to \d+/)
  check('mgr: the message is sent to the team', !!sentToast && sentToast.includes(`Sent to ${teamSize}`), sentToast || '')
  const msgId = sql(`select id from hrms.team_messages where tenant_id='${tenant}' and sender_employee_id='${MGR}' and body like 'QA team UI:%' order by created_at desc limit 1`)
  if (msgId) created.messages.push(msgId)
  check('message: everyone in the team is told (TEAM_MESSAGE), the fixture member included', !!msgId
    && await until(() => num(`select count(*) from notif.notifications where type='TEAM_MESSAGE' and data->>'messageId'='${msgId}'`) === teamSize)
    && num(`select count(*) from notif.notifications where type='TEAM_MESSAGE' and user_id='${A}' and data->>'messageId'='${msgId}'`) === 1)

  // ── 2. Team schedule ──────────────────────────────────────────────────────
  await views.getByRole('button', { name: /^Team schedule/ }).click(); await settle(page)
  check('mgr: Team schedule view (?view=schedule)', new URL(page.url()).searchParams.get('view') === 'schedule' && await page.getByRole('heading', { name: 'Team schedule', level: 1 }).count() > 0)
  const grid = page.getByRole('grid')
  check('mgr: the week grid has the member\'s row', await grid.getByRole('rowheader', { name: new RegExp(A_NAME) }).count() === 1)
  const memberRow = grid.getByRole('row', { name: new RegExp(A_NAME) })
  check('mgr: their weekly off shows as Off', (await memberRow.textContent()).includes('Off'))
  check('mgr: the coverage row counts who is in the office', /\d+ of \d+/.test(await grid.locator('thead').textContent()))
  await page.screenshot({ path: `${shots}/rd-p-team-schedule-light-1440.png`, fullPage: true })
  let pendingCell = grid.getByRole('button', { name: /leave waiting for you/ })
  for (let i = 0; i < 3 && !(await pendingCell.count()); i++) {
    await page.getByRole('button', { name: 'Next →' }).click(); await settle(page)
    pendingCell = page.getByRole('grid').getByRole('button', { name: /leave waiting for you/ })
  }
  check('mgr: the leave waiting for them shows as "Leave?" in its week', await pendingCell.count() > 0)
  if (await pendingCell.count()) {
    await pendingCell.first().click(); await settle(page)
    const u = new URL(page.url())
    check('mgr: tapping it opens Approvals on the Leave tab', u.searchParams.get('view') === 'approvals' && u.searchParams.get('tab') === 'leave')
  }

  // ── 3. Approvals: decide and undo each kind ───────────────────────────────
  await page.goto(base + '/team?view=approvals'); await settle(page)
  check('mgr: Approvals view', await page.getByRole('heading', { name: 'Approvals', level: 1 }).count() > 0)
  const kinds = page.getByRole('group', { name: 'Approval kinds' })
  for (const t of ['All', 'Leave', 'Attendance', 'Requests', 'Expenses']) check(`mgr: "${t}" tab`, await kinds.getByRole('button', { name: new RegExp(`^${t}`) }).count() === 1)
  await page.screenshot({ path: `${shots}/rd-p-team-approvals-light-1440.png`, fullPage: true })
  const card = (marker) => page.locator('article.uko-apprc', { hasText: marker }).filter({ hasText: A_NAME })

  const steps = [
    { kind: 'LEAVE', id: L?.id, marker: 'QA team UI leave', approve: true, table: 'leave_mgmt.leave_requests', after: 'APPROVED', back: 'PENDING' },
    { kind: 'WFH', id: W?.id, marker: 'QA team UI WFH', approve: false, reasonDialog: true, table: 'leave_mgmt.wfh_requests', after: 'REJECTED', back: 'PENDING' },
    { kind: 'CORRECTION', id: C?.id, marker: 'QA team UI fix', approve: true, table: 'attendance.regularization_requests', after: 'APPROVED', back: 'PENDING' },
    { kind: 'SHIFT_CHANGE', id: S?.id, marker: 'QA team UI shift change', approve: false, note: 'QA: not this month', table: 'attendance.shift_change_requests', after: 'REJECTED', back: 'PENDING' },
    { kind: 'EXPENSE', id: E?.id, marker: 'QA team UI claim', approve: true, table: 'expense_mgmt.expense_claims', after: 'APPROVED', back: 'SUBMITTED' },
  ]
  for (const s of steps) {
    if (!s.id) { check(`approvals ${s.kind}: fixture exists`, false); continue }
    const c = card(s.marker)
    if (!(await until(async () => (await c.count()) > 0))) { check(`approvals ${s.kind}: the request is listed`, false); continue }
    const before = notesFor(A)
    if (s.note) await c.getByRole('textbox').fill(s.note)
    await c.getByRole('button', { name: s.approve ? 'Approve' : 'Reject', exact: true }).click()
    if (s.reasonDialog) {
      const dlg = page.getByRole('dialog', { name: /Reject QA.s work from home/ })
      check('approvals WFH: rejecting asks for the reason', !!(await until(async () => (await dlg.count()) === 1)))
      await dlg.getByLabel('Reason').fill('QA: the team is short that day')
      await dlg.getByRole('button', { name: 'Reject', exact: true }).click()
    }
    const word = s.approve ? 'Approved' : 'Rejected'
    check(`approvals ${s.kind}: "${word} · QA has been told"`, !!(await toastText(page, new RegExp(`${word} · QA has been told`))))
    check(`approvals ${s.kind}: the request is ${s.after}`, !!(await until(() => status(s.table, s.id) === s.after)), status(s.table, s.id))
    check(`approvals ${s.kind}: the employee is told`, !!(await until(() => notesFor(A) > before)))
    const undo = page.locator('article.uko-apprc', { hasText: word }).filter({ hasText: A_NAME }).getByRole('button', { name: 'Undo' })
    check(`approvals ${s.kind}: the decided card offers Undo`, !!(await until(async () => (await undo.count()) > 0)))
    if (await undo.count()) {
      await undo.first().click()
      check(`approvals ${s.kind}: "Undone · QA has been told"`, !!(await toastText(page, /Undone · QA has been told/)))
      check(`approvals ${s.kind}: Undo puts it back to ${s.back}`, !!(await until(() => status(s.table, s.id) === s.back)), status(s.table, s.id))
      check(`approvals ${s.kind}: the employee is told it was taken back`, !!(await until(() => told(s.id))))
      check(`approvals ${s.kind}: the request is waiting in the list again`, !!(await until(async () => (await card(s.marker).locator('button', { hasText: 'Approve' }).count()) > 0)))
    }
  }
  // A submitted timesheet week sits under Requests and is decided like the rest (it has no Undo).
  await kinds.getByRole('button', { name: /^Requests/ }).click(); await settle(page)
  check('mgr: the Requests tab (?tab=requests)', new URL(page.url()).searchParams.get('tab') === 'requests')
  const weekCard = page.locator('article.uko-apprc', { hasText: 'Timesheet' }).filter({ hasText: A_NAME })
  check('approvals TIMESHEET: the submitted week is listed with its hours', !!(await until(async () => (await weekCard.count()) > 0)) && /8h 0m/.test(await weekCard.first().textContent()))
  if (T?.id && await weekCard.count()) {
    await weekCard.first().getByRole('button', { name: 'Approve', exact: true }).click()
    check('approvals TIMESHEET: approved, the employee is told', !!(await toastText(page, /Approved · QA has been told/)) && !!(await until(() => status('hrms.timesheet_weeks', T.id) === 'APPROVED')))
  }
  await kinds.getByRole('button', { name: /^All/ }).click(); await settle(page)

  // "Approve N with no warnings": only clicked when every row it takes is this test's own.
  const box = (await mgrApi.call('/v1/team/approvals?kind=all&size=100')).json
  const easy = (box?.rows || []).filter((r) => r.canDecide && r.warnings.length === 0)
  const bulk = page.getByRole('button', { name: /^Approve \d+ with no warnings$/ })
  if (easy.length < 2) check('approvals: no "Approve N" button with fewer than two easy requests', await bulk.count() === 0)
  else {
    check(`approvals: "Approve ${easy.length} with no warnings"`, await bulk.count() === 1 && (await bulk.textContent()).includes(`Approve ${easy.length}`), await bulk.textContent().catch(() => ''))
    if (easy.every((r) => r.employeeId === A)) {
      await bulk.click()
      const dlg = page.getByRole('dialog', { name: /Approve \d+ requests/ })
      await dlg.getByRole('button', { name: new RegExp(`^Approve ${easy.length}$`) }).click()
      check('approvals: approved them all in one go', !!(await toastText(page, new RegExp(`Approved ${easy.length} requests`), 20_000)))
      const st = { LEAVE: 'leave_mgmt.leave_requests', WFH: 'leave_mgmt.wfh_requests', CORRECTION: 'attendance.regularization_requests', SHIFT_CHANGE: 'attendance.shift_change_requests', EXPENSE: 'expense_mgmt.expense_claims' }
      check('approvals: each one is approved', easy.every((r) => !st[r.kind] || status(st[r.kind], r.requestId) === 'APPROVED'))
    } else skip('approvals: Approve N with no warnings (click)', 'other waiting requests in this database would be approved too')
  }
  check('mgr: no refused API calls or page errors', !m.failed.length && !m.errors.length, m.failed.slice(0, 3).join(' | ') || m.errors.slice(0, 3).join(' | '))
  await m.ctx.close()

  // ── 4. dark and phone width ───────────────────────────────────────────────
  for (const [theme, width] of [['dark', 1440], ['light', 390], ['dark', 390]]) {
    const s = await signIn('mgr@unifiedtree.demo', { width, theme })
    for (const v of ['today', 'schedule', 'approvals']) {
      await s.page.goto(base + (v === 'today' ? '/team' : `/team?view=${v}`)); await settle(s.page)
      if (theme === 'dark') check(`mgr ${v} ${width}: dark theme is on`, await s.page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark')
      const over = await sideways(s.page)
      check(`mgr ${v} ${theme} ${width}: no sideways page scroll`, over <= 1, `${over}px`)
      await s.page.screenshot({ path: `${shots}/rd-p-team-${v}-${theme}-${width}.png`, fullPage: true })
    }
    check(`mgr ${theme} ${width}: no page errors`, !s.errors.length, s.errors.slice(0, 2).join(' | '))
    await s.ctx.close()
  }

  // ── 5. owner extends the fixture's probation from the card ────────────────
  const o = await signIn('owner@unifiedtree.demo')
  await o.page.goto(base + '/team'); await settle(o.page)
  const block = o.page.locator('.tm-prob', { hasText: P_NAME })
  check('owner: the probation card offers Confirm and Extend (hrms.probation.team.decide)', !!(await until(async () => (await block.count()) === 1))
    && await block.getByRole('button', { name: 'Confirm' }).count() === 1)
  if (await block.count()) {
    await block.getByRole('button', { name: 'Extend by a month' }).click()
    const dlg = o.page.getByRole('dialog', { name: /Extend .*probation/ })
    await dlg.getByRole('button', { name: 'Extend', exact: true }).click()
    check('owner: "Probation extended" is confirmed', !!(await toastText(o.page, /Probation extended to/)))
    check('owner: the end date moved a month', !!(await until(() => sql(`select probation_end_date from hrms.employees where id='${P}'`) === addMonth(pEnd))), sql(`select probation_end_date from hrms.employees where id='${P}'`))
    check('probation: the employee is told (PROBATION_TEAM_DECISION)', !!(await until(() => num(`select count(*) from notif.notifications where user_id='${P}' and type='PROBATION_TEAM_DECISION'`) === 1)))
  }
  await o.ctx.close()

  // ── 6. who doesn't get My team ────────────────────────────────────────────
  const h = await signIn('hrm@unifiedtree.demo')
  await h.page.goto(base + '/hrms/leave'); await settle(h.page)
  const hr = await railState(h.page)
  check('hrm: no My team on the rail', !!hr && !hr.groups.includes('My team') && !hr.items.includes('My team'), JSON.stringify(hr?.groups))
  await h.ctx.close()
  const r = await signIn('reader@unifiedtree.demo')
  await r.page.goto(base + '/team'); await settle(r.page)
  check('reader: My team stays closed', await r.page.getByRole('heading', { name: 'Team today' }).count() === 0
    && await r.page.getByRole('group', { name: 'My team views' }).count() === 0)
  await r.ctx.close()
}

function cleanup() {
  const reqIds = [...created.leave, ...created.wfh, ...created.corrections, ...created.shifts, ...created.claims, ...created.weeks, ...created.messages].filter(Boolean)
  const idList = reqIds.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const pattern = [A, P, ...reqIds].join('|')
  const run = (label, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${label}: ${String(e.message).split('\n')[0]}`) } }
  run('notifications', `DELETE FROM notif.notifications WHERE user_id IN ('${A}','${P}') OR data::text ~ '${pattern}'`)
  run('audit', `DELETE FROM audit.events WHERE tenant_id='${tenant}' AND (entity_id IN (${[A, P, ...reqIds].map((x) => `'${x}'`).join(',')}) OR summary ~ 'QA Team UI')`)
  run('journal', `DELETE FROM hrms.approval_decisions WHERE tenant_id='${tenant}' AND employee_id IN ('${A}','${P}')`)
  run('messages', `DELETE FROM hrms.team_messages WHERE tenant_id='${tenant}' AND id IN (${idList})`)
  run('claims', `BEGIN; DELETE FROM expense_mgmt.expense_items WHERE claim_id IN (SELECT id FROM expense_mgmt.expense_claims WHERE employee_id='${A}'); DELETE FROM expense_mgmt.expense_claims WHERE employee_id='${A}'; COMMIT;`)
  run('attendance', `BEGIN; DELETE FROM attendance.overtime_decisions WHERE record_id IN (SELECT id FROM attendance.records WHERE employee_id='${A}'); DELETE FROM attendance.event_logs WHERE employee_id='${A}'; DELETE FROM attendance.records WHERE employee_id='${A}'; DELETE FROM attendance.regularization_requests WHERE employee_id='${A}'; DELETE FROM attendance.shift_change_requests WHERE employee_id='${A}'; DELETE FROM attendance.employee_shift_assignments WHERE employee_id IN ('${A}','${P}'); COMMIT;`)
  run('timesheets', `BEGIN; DELETE FROM hrms.timesheet_weeks WHERE employee_id='${A}'; DELETE FROM hrms.time_entries WHERE employee_id='${A}'; COMMIT;`)
  run('leave', `BEGIN; DELETE FROM leave_mgmt.leave_requests WHERE employee_id='${A}'; DELETE FROM leave_mgmt.wfh_requests WHERE employee_id='${A}'; DELETE FROM leave_mgmt.leave_balance_ledger WHERE employee_id IN ('${A}','${P}'); DELETE FROM leave_mgmt.leave_balances WHERE employee_id IN ('${A}','${P}'); COMMIT;`)
  for (const t of sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.column_name='user_id' and t.table_type='BASE TABLE' and c.table_schema='auth'`).split('\n').filter(Boolean)) {
    run(t, `DELETE FROM ${t} WHERE user_id='${UA}'`)
  }
  run('people', `BEGIN; DELETE FROM rbac.user_roles WHERE user_id='${UA}'; DELETE FROM auth.user_credentials WHERE id='${UA}'; DELETE FROM hrms.employee_status_history WHERE employee_id IN ('${A}','${P}'); DELETE FROM hrms.employees WHERE id IN ('${A}','${P}'); COMMIT;`)
  const tables = sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.column_name='employee_id' and t.table_type='BASE TABLE' and c.table_schema in ('leave_mgmt','attendance','expense_mgmt','hrms','notif','auth')
      and c.table_name not like '%\\_20%' and c.table_name not like '%\\_default'`).split('\n').filter(Boolean)
  const left = tables.map((t) => [t, num(`select count(*) from ${t} where employee_id in ('${A}','${P}')`)]).filter(([, n]) => n > 0)
  const leftOther = num(`select count(*) from notif.notifications where data::text ~ '${pattern}'`) + num(`select count(*) from hrms.team_messages where id in (${idList})`)
  check('cleanup: nothing the test made is left behind', left.length === 0 && leftOther === 0, JSON.stringify(left) + ` other=${leftOther}`)
}

try {
  await main()
} catch (e) {
  check('script completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  cleanup()
  await browser.close()
}
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
