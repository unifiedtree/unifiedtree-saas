// API-level live check of P-TEAM's backend (redesign BW-06 … BW-12), against a
// running server and its database:
//   · approval Undo for all five kinds, decided as mgr / hrm / owner: the state
//     is restored exactly (leave balance maths, attendance record, shift
//     assignments), the employee is told, and every refusal (a second Undo, the
//     wrong person, the window over, payroll locked, a work-from-home check-in,
//     overtime decided, the new shift started, another pending shift request,
//     a reimbursement batch, the request changed since)
//   · the Approvals inbox returns the same ids as each kind's own list for
//     owner, hrm, fin, mgr and reader, with canDecide false where the decide
//     check refuses
//   · team summary and time off, reminders (once per person and day), team
//     probation (rights, extend, confirm, HR and the employee told), team
//     messages (only the sender's team)
//   · 403 for roles without the rights; the HRMS module guard on /v1/team
//   · each new table renamed: FEATURE_NOT_READY, then renamed back
// Everything it creates is removed at the end (fixture people, requests,
// notifications, journal rows, audit rows of its own).
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-team-api.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB, RECOVERY_PASSWORD
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const MGR = '44444444-4444-4444-4444-444444444444'
const HRM = '33333333-3333-3333-3333-333333333333'
const OWNER_EMP = '11111111-1111-1111-1111-111111111111'
const READER = '22222222-2222-2222-2222-222222222222'
const JANE = '91d62f6a-7325-429c-86f4-2e59341a60d5' // an existing employee outside mgr's team

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => { results.push({ name, ok: true }); console.log(`PASS  ${name}  — skipped: ${why}`) }

// ── dates (India) ───────────────────────────────────────────────────────────
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
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

// ── sessions ────────────────────────────────────────────────────────────────
let allowNotReady = false
const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500 && !(allowNotReady && json?.errorCode === 'FEATURE_NOT_READY')) surprises.push(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    if (json?.errorCode === 'FEATURE_NOT_READY' && !allowNotReady) surprises.push(`${method} ${path} → FEATURE_NOT_READY outside the rename step`)
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId, permissions: new Set(d.permissions || []) }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const A = randomUUID(), UA = randomUUID(), P = randomUUID()
const aEmail = `qa-team-undo-${A.slice(0, 8)}@example.invalid`
const created = { leave: [], wfh: [], corrections: [], shifts: [], claims: [], records: [], batches: [], messages: [], rawLeave: [] }
const offDay = ((dow(today) + 2) % 7) + 1 // a weekly off that isn't today, so today's reminder can be tested
const tomorrowIst = addDays(today, 1)

const bal = (typeId, year) => {
  const row = sql(`select used || '|' || pending from leave_mgmt.leave_balances where employee_id='${A}' and leave_type_id='${typeId}' and year=${year}`)
  const [used, pending] = (row || '0|0').split('|').map(Number)
  return { used, pending }
}
const status = (table, id) => sql(`select status from ${table} where id='${id}'`)
const told = (requestId) => num(`select count(*) from notif.notifications where user_id='${A}' and type='DECISION_UNDONE' and data->>'requestId'='${requestId}'`) > 0

async function main() {
  const owner = await session('owner@unifiedtree.demo')
  const hrm = await session('hrm@unifiedtree.demo')
  const fin = await session('fin@unifiedtree.demo')
  const mgr = await session('mgr@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')

  sql(`BEGIN;
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      reporting_manager_id,date_of_joining,weekly_off_days,created_by,updated_by)
    VALUES ('${A}','${tenant}','${company}','QAT-${A.slice(0, 8)}','QA Team','Undo Member','${aEmail}','FULL_TIME','ACTIVE',
      '${MGR}','2025-01-01','${offDay}','qa','qa');
    INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active)
      SELECT '${UA}','${tenant}','${aEmail}',password_hash,'${A}',true FROM auth.user_credentials
       WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) SELECT '${tenant}','${UA}',id FROM rbac.roles WHERE code='EMPLOYEE' AND tenant_id IS NULL;
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      reporting_manager_id,date_of_joining,probation_end_date,created_by,updated_by)
    VALUES ('${P}','${tenant}','${company}','QAP-${P.slice(0, 8)}','QA Team','Probation Member','qa-team-prob-${P.slice(0, 8)}@example.invalid',
      'FULL_TIME','PROBATION','${MGR}','${addDays(today, -150)}','${addDays(today, 20)}','qa','qa');
    COMMIT;`)
  const a = await session(aEmail)
  check('fixture: a member of mgr\'s team can sign in', a.employeeId === A)

  const types = (await a.call(`/v1/leave/types?companyId=${company}`)).json || []
  const leaveType = types.find((t) => t.active !== false) || types[0]
  if (!leaveType) throw new Error('no leave type to test with')

  // ── 1. requests waiting, one of each kind ────────────────────────────────
  const dLeave = pick(addDays(today, 7), 1, (d) => working(d) && !locked(d))
  const L0 = (await a.call(`/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: leaveType.id, startDate: dLeave, endDate: dLeave, duration: 'FULL_DAY', reason: 'QA team undo leave' })).json
  created.leave.push(L0?.id)
  const dWfh = pick(addDays(today, 8), 1, (d) => working(d))
  const W0 = (await a.call('/v1/wfh', 'POST', { fromDate: dWfh, toDate: dWfh, reason: 'QA team undo WFH' })).json
  created.wfh.push(W0?.id)
  const dFix = pick(addDays(today, -1), -1, (d) => working(d) && !locked(d) && d >= addDays(today, -85))
  const C0 = dFix ? (await a.call('/v1/attendance/corrections', 'POST', { requestedDate: dFix, requestedCheckInAt: ist(dFix, '09:30'), requestedCheckOutAt: ist(dFix, '18:00'), reason: 'QA team undo fix' })).json : null
  if (C0?.id) created.corrections.push(C0.id)
  const shifts = (await a.call(`/v1/shifts?companyId=${company}`)).json || []
  const general = shifts.find((s) => s.name === 'General' && s.active !== false) || shifts[0]
  const morning = shifts.find((s) => s.name === 'Morning' && s.active !== false) || shifts[1]
  const S0 = (await a.call('/v1/shifts/change-requests', 'POST', { requestedShiftPolicyId: general.id, reason: 'QA team undo shift change', effectiveDate: addDays(today, 3) })).json
  created.shifts.push(S0?.id)
  const E0 = (await a.call('/v1/expense/claims', 'POST', { title: 'QA team undo claim', currency: 'INR', notes: 'QA', items: [{ category: 'TRAVEL', description: 'Taxi', amount: 500, expenseDate: addDays(today, -2) }] })).json
  created.claims.push(E0?.id)
  check('fixture: one waiting request of each kind', L0?.id && W0?.id && C0?.id && S0?.id && E0?.id,
    `leave=${!!L0?.id} wfh=${!!W0?.id} fix=${!!C0?.id} shift=${!!S0?.id} claim=${!!E0?.id}`)

  // A leave routed to mgr (approver) from someone outside mgr's team: listed, not decidable (ApproverScopeGuard).
  const Jl = randomUUID()
  const dJane = pick(addDays(today, 30), 1, working)
  sql(`INSERT INTO leave_mgmt.leave_requests(id,tenant_id,employee_id,leave_type_id,start_date,end_date,total_days,reason,status,approver_id,duration,created_by,updated_by)
       VALUES ('${Jl}','${tenant}','${JANE}','${leaveType.id}','${dJane}','${dJane}',1,'QA team routed elsewhere','PENDING','${MGR}','FULL_DAY','qa','qa')`)
  created.rawLeave.push(Jl)

  // ── 2. the inbox lists what each kind's own list shows ────────────────────
  const own = (s, rows) => (rows || []).filter((r) => r.employeeId !== s.employeeId)
  async function lists(s) {
    const get = async (path) => { const r = await s.call(path); return r.status === 200 ? r.json : null }
    const content = (j) => (j ? (j.content ?? j) : null)
    const leave = content(await get('/v1/leave/approvals/pending?size=1000'))
    const wfh = content(await get('/v1/wfh/pending-approvals?size=1000'))
    const fixes = content(await get('/v1/attendance/corrections/approvals?status=PENDING&size=1000'))
    const shiftList = content(await get('/v1/shifts/change-requests/pending'))
    const claims = content(await get('/v1/expense/claims/approvals?size=1000'))
    return {
      LEAVE: leave && own(s, leave).map((r) => r.id),
      WFH: wfh && own(s, wfh).map((r) => r.id),
      CORRECTION: fixes && own(s, fixes).map((r) => r.id),
      SHIFT_CHANGE: shiftList && own(s, shiftList).map((r) => r.id),
      // the inbox lists claims for those who decide them (claim.approve), SUBMITTED only
      EXPENSE: claims && s.permissions.has('hrms.expense.claim.approve') ? own(s, claims).filter((r) => r.status === 'SUBMITTED').map((r) => r.id) : null,
    }
  }
  async function inboxAll(s) {
    const rows = []
    for (let page = 0; page < 20; page++) {
      const r = await s.call(`/v1/team/approvals?kind=all&page=${page}&size=100`)
      if (r.status !== 200) return { status: r.status }
      rows.push(...r.json.rows)
      if (rows.length >= r.json.totalElements) return { status: 200, rows, body: r.json }
    }
    return { status: 200, rows }
  }
  const sorted = (x) => [...(x || [])].sort().join(',')
  for (const [name, s] of [['owner', owner], ['hrm', hrm], ['fin', fin], ['mgr', mgr], ['reader', reader]]) {
    const l = await lists(s)
    const box = await inboxAll(s)
    const anyList = Object.values(l).some((v) => v !== null)
    if (!anyList) { check(`inbox: ${name} has no approval list, so no inbox (403)`, box.status === 403, `status=${box.status}`); continue }
    check(`inbox: ${name} can open it`, box.status === 200, `status=${box.status}`)
    if (box.status !== 200) continue
    for (const kind of ['LEAVE', 'WFH', 'CORRECTION', 'SHIFT_CHANGE', 'EXPENSE']) {
      const expected = l[kind] || []
      const got = box.rows.filter((r) => r.kind === kind).map((r) => r.requestId)
      check(`inbox: ${name} ${kind} = its own list (${expected.length})`, sorted(expected) === sorted(got), `list=${expected.length} inbox=${got.length}`)
    }
    check(`inbox: ${name} never sees their own requests`, box.rows.every((r) => r.employeeId !== s.employeeId))
    check(`inbox: ${name} counts match the rows`, box.body.counts.all === box.rows.length, `all=${box.body.counts.all} rows=${box.rows.length}`)
  }
  const mgrBox = await inboxAll(mgr)
  const row = (id) => mgrBox.rows.find((r) => r.requestId === id)
  check('inbox: mgr can decide their team member\'s requests', [L0.id, W0.id, C0.id, S0.id, E0.id].every((id) => row(id)?.canDecide === true))
  check('inbox: a leave routed to mgr from outside their team is listed with canDecide=false', row(Jl) && row(Jl).canDecide === false)
  check('inbox: work from home needs a reason to reject', row(W0.id)?.rejectNeedsReason === true && row(L0.id)?.rejectNeedsReason === false)
  check('inbox: leave rows carry facts (balance after, others out)', row(L0.id)?.facts?.some((f) => f.key === 'balanceAfter') && row(L0.id)?.facts?.some((f) => f.key === 'othersOut'))
  check('inbox: the fix says what was asked for', row(C0.id)?.facts?.some((f) => f.key === 'askedFor'))
  check('inbox: the claim shows its amount', Number(row(E0.id)?.amount) === 500 && row(E0.id)?.currency === 'INR')
  const refusedJane = await mgr.call(`/v1/leave/${Jl}/decision`, 'POST', { status: 'APPROVED', comment: 'QA' })
  check('inbox: …and deciding it is refused by the decide endpoint (403)', refusedJane.status === 403, `status=${refusedJane.status}`)
  const finBox = await fin.call('/v1/team/approvals?kind=all')
  check('inbox: fin (work from home approver) gets the Requests tab only', finBox.status === 200 && sorted(finBox.json.tabs) === sorted(['all', 'requests']), JSON.stringify(finBox.json?.tabs))
  check('inbox: a tab you can\'t open is refused', (await fin.call('/v1/team/approvals?kind=expenses')).status === 403)

  // ── 3. team summary and time off ─────────────────────────────────────────
  const summary = await mgr.call('/v1/team/summary')
  const ids = new Set((summary.json?.members || []).map((m) => m.employeeId))
  check('summary: mgr\'s team is their direct reports, never mgr', summary.status === 200 && summary.json.scope === 'DIRECT_REPORTS' && ids.has(A) && ids.has(P) && ids.has(READER) && !ids.has(MGR))
  const pm = (summary.json?.members || []).find((m) => m.employeeId === P)
  check('summary: probation end date shown for someone on probation', pm?.probationEndDate === addDays(today, 20) && pm?.employmentStatus === 'PROBATION')
  const off = await mgr.call(`/v1/team/time-off?from=${today}&to=${addDays(today, 40)}`)
  const offL = (off.json || []).find((e) => e.requestId === L0.id), offW = (off.json || []).find((e) => e.requestId === W0.id)
  check('time off: waiting leave and WFH of the team, decidable by mgr', off.status === 200 && offL?.status === 'PENDING' && offL?.canDecide === true && offW?.kind === 'WFH' && offW?.canDecide === true)
  check('time off: at most 62 days', (await mgr.call(`/v1/team/time-off?from=${today}&to=${addDays(today, 62)}`)).status === 400)
  for (const path of ['/v1/team/summary', `/v1/team/time-off?from=${today}&to=${addDays(today, 7)}`, '/v1/team/approvals', '/v1/team/probation', `/v1/attendance/reminders?date=${today}`]) {
    check(`403: reader can't read ${path.split('?')[0]}`, (await reader.call(path)).status === 403)
  }
  check('recent decisions: open to everyone signed in (reader has none)', (await reader.call('/v1/approvals/recent-decisions')).status === 200)

  // ── 4. reminders ─────────────────────────────────────────────────────────
  if (holiday(today)) skip('reminders: sent, once a day', 'today is a company holiday')
  else {
    const first = await mgr.call('/v1/attendance/reminders', 'POST', { date: today, reason: 'NOT_CHECKED_IN', employeeIds: [A, HRM] })
    const rA = (first.json || []).find((r) => r.employeeId === A), rH = (first.json || []).find((r) => r.employeeId === HRM)
    check('reminders: sent to a team member who hasn\'t checked in', first.status === 200 && rA?.outcome === 'SENT', JSON.stringify(first.json))
    check('reminders: someone outside the team is skipped', rH?.outcome === 'SKIPPED')
    check('reminders: the employee is told (CHECKIN_REMINDER)', num(`select count(*) from notif.notifications where user_id='${A}' and type='CHECKIN_REMINDER'`) === 1)
    const again = await mgr.call('/v1/attendance/reminders', 'POST', { date: today, reason: 'NOT_CHECKED_IN', employeeIds: [A] })
    check('reminders: at most once per person, day and reason', again.json?.[0]?.outcome === 'ALREADY_SENT', JSON.stringify(again.json))
    check('reminders: …and nothing new is sent', num(`select count(*) from notif.notifications where user_id='${A}' and type='CHECKIN_REMINDER'`) === 1)
    const sentList = await mgr.call(`/v1/attendance/reminders?date=${today}`)
    check('reminders: "Reminder sent" survives a reload', (sentList.json || []).some((r) => r.employeeId === A && r.sentByName))
  }
  check('reminders: only for today', (await mgr.call('/v1/attendance/reminders', 'POST', { date: addDays(today, -1), reason: 'NOT_CHECKED_IN', employeeIds: [A] })).status === 422)
  check('reminders: reader can\'t send them (403)', (await reader.call('/v1/attendance/reminders', 'POST', { date: today, reason: 'NOT_CHECKED_IN', employeeIds: [A] })).status === 403)

  // ── 5. Undo: leave (single step, level 1, level 2) ────────────────────────
  const year = Number(dLeave.slice(0, 4))
  const b0 = bal(leaveType.id, year)
  check('leave: applying holds the day as pending', b0.pending === 1, JSON.stringify(b0))
  let r = await mgr.call(`/v1/leave/${L0.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA ok' })
  const b1 = bal(leaveType.id, year)
  check('leave: mgr approves; the day moves from pending to used', r.status === 200 && b1.used === b0.used + 1 && b1.pending === b0.pending - 1, JSON.stringify(b1))
  const recent = await mgr.call('/v1/approvals/recent-decisions')
  const rec = (recent.json || []).find((x) => x.requestId === L0.id)
  check('recent decisions: the approval is offered for Undo for 10 minutes', rec && rec.kind === 'LEAVE' && (Date.parse(rec.undoUntil) - Date.parse(rec.decidedAt)) === 600000, JSON.stringify(rec))
  const inboxRecent = await mgr.call('/v1/team/approvals?kind=leave')
  check('inbox: recentDecisions carries it too', (inboxRecent.json?.recentDecisions || []).some((x) => x.requestId === L0.id))
  check('undo: fin (no leave approval) is refused (403)', (await fin.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')).status === 403)
  check('undo: reader is refused (403)', (await reader.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')).status === 403)
  r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  const b2 = bal(leaveType.id, year)
  check('undo leave approval: waiting again, balance exactly as before', r.status === 200 && r.json?.status === 'PENDING' && r.json?.kind === 'LEAVE' && status('leave_mgmt.leave_requests', L0.id) === 'PENDING' && b2.used === b0.used && b2.pending === b0.pending, `${r.status} ${JSON.stringify(r.json)} ${JSON.stringify(b2)}`)
  check('undo leave: the employee is told (DECISION_UNDONE)', told(L0.id))
  check('undo leave: the approver and decision time are back as before', sql(`select approver_id || '|' || coalesce(decision_note,'-') || '|' || coalesce(decision_at::text,'-') from leave_mgmt.leave_requests where id='${L0.id}'`) === `${MGR}|-|-`)
  r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  check('undo: a second Undo is refused (422)', r.status === 422 && r.json?.errorCode === 'DECISION_ALREADY_UNDONE', `${r.status} ${r.json?.errorCode}`)
  check('recent decisions: an undone decision is no longer offered', !((await mgr.call('/v1/approvals/recent-decisions')).json || []).some((x) => x.requestId === L0.id))

  r = await mgr.call(`/v1/leave/${L0.id}/decision`, 'POST', { status: 'REJECTED', comment: 'QA no' })
  const b3 = bal(leaveType.id, year)
  r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  const b4 = bal(leaveType.id, year)
  check('undo leave rejection: the day is back on pending', b3.pending === b0.pending - 1 && r.status === 200 && b4.pending === b0.pending && b4.used === b0.used, `${JSON.stringify(b3)} → ${JSON.stringify(b4)}`)

  r = await mgr.call(`/v1/leave/${L0.id}/l1-decision`, 'POST', { status: 'APPROVED', comment: 'QA level 1' })
  check('leave level 1: approve sends it to HR (PENDING_L2)', r.status === 200 && status('leave_mgmt.leave_requests', L0.id) === 'PENDING_L2')
  r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  check('undo level 1: waiting for the manager again, balance unchanged', r.status === 200 && status('leave_mgmt.leave_requests', L0.id) === 'PENDING' && JSON.stringify(bal(leaveType.id, year)) === JSON.stringify(b0))
  await mgr.call(`/v1/leave/${L0.id}/l1-decision`, 'POST', { status: 'APPROVED', comment: 'QA level 1' })
  r = await hrm.call(`/v1/leave/${L0.id}/l2-decision`, 'POST', { status: 'APPROVED', comment: 'QA level 2' })
  const b5 = bal(leaveType.id, year)
  check('leave level 2: hrm approves; the day is used', r.status === 200 && status('leave_mgmt.leave_requests', L0.id) === 'APPROVED' && b5.used === b0.used + 1)
  r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  check('undo: only the person who decided (mgr can\'t take back hrm\'s decision, 403)', r.status === 403 && r.json?.errorCode === 'NOT_YOUR_DECISION', `${r.status} ${r.json?.errorCode}`)
  r = await hrm.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  const b6 = bal(leaveType.id, year)
  check('undo level 2: back with HR, the day is pending again', r.status === 200 && r.json?.status === 'PENDING_L2' && b6.used === b0.used && b6.pending === b0.pending, `${r.status} ${JSON.stringify(b6)}`)
  await hrm.call(`/v1/leave/${L0.id}/l2-decision`, 'POST', { status: 'APPROVED', comment: 'QA level 2 again' })
  sql(`UPDATE hrms.approval_decisions SET undo_until = now() - interval '1 minute' WHERE tenant_id='${tenant}' AND request_id='${L0.id}' AND undone_at IS NULL`)
  r = await hrm.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
  check('undo: refused once the 10 minutes have passed (422)', r.status === 422 && r.json?.errorCode === 'UNDO_WINDOW_PASSED', `${r.status} ${r.json?.errorCode}`)
  const journalled = (id) => num(`select count(*) from hrms.approval_decisions where tenant_id='${tenant}' and request_id='${id}'`)
  const beforeRefusal = journalled(L0.id)
  r = await mgr.call(`/v1/leave/${L0.id}/decision`, 'POST', { status: 'REJECTED', comment: 'QA too late' })
  check('recorder: a decision the service refuses answers as before and is not journalled', r.status === 422 && r.json?.errorCode === 'LEAVE_NOT_PENDING'
    && journalled(L0.id) === beforeRefusal && status('leave_mgmt.leave_requests', L0.id) === 'APPROVED', `${r.status} ${r.json?.errorCode}`)

  // changed since: the employee cancels after the approval
  const dL2 = pick(addDays(today, 9), 1, (d) => working(d) && !locked(d))
  const L2 = (await a.call(`/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: leaveType.id, startDate: dL2, endDate: dL2, duration: 'FULL_DAY', reason: 'QA team cancel' })).json
  created.leave.push(L2?.id)
  await owner.call(`/v1/leave/${L2.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA owner' })
  await a.call(`/v1/leave/${L2.id}/cancel?reason=${encodeURIComponent('QA changed my mind')}`, 'POST')
  r = await owner.call(`/v1/leave/${L2.id}/decision/undo`, 'POST')
  check('undo: refused when the request changed since (the employee cancelled, 422)', r.status === 422 && r.json?.errorCode === 'DECISION_CHANGED_SINCE', `${r.status} ${r.json?.errorCode}`)

  // payroll locked
  const dLocked = pick(addDays(today, 1), 1, (d) => working(d) && locked(d), 200)
  if (!dLocked) skip('undo leave: refused inside a locked payroll month', 'no LOCKED or PAID run ahead of today')
  else {
    const L3 = (await a.call(`/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: leaveType.id, startDate: dLocked, endDate: dLocked, duration: 'FULL_DAY', reason: 'QA team locked payroll' })).json
    created.leave.push(L3?.id)
    await mgr.call(`/v1/leave/${L3.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA' })
    r = await mgr.call(`/v1/leave/${L3.id}/decision/undo`, 'POST')
    check('undo leave: refused inside a locked or paid payroll month (422)', r.status === 422 && r.json?.errorCode === 'UNDO_PAYROLL_LOCKED', `${r.status} ${r.json?.message}`)
  }

  // ── 6. Undo: work from home ──────────────────────────────────────────────
  r = await hrm.call(`/v1/wfh/${W0.id}/approve`, 'POST', { comment: 'QA hrm ok' })
  check('wfh: hrm approves', r.status === 200 && status('leave_mgmt.wfh_requests', W0.id) === 'APPROVED')
  r = await hrm.call(`/v1/wfh/${W0.id}/decision/undo`, 'POST')
  check('undo wfh: waiting again, decision cleared, the employee told', r.status === 200 && status('leave_mgmt.wfh_requests', W0.id) === 'PENDING'
    && sql(`select coalesce(decided_at::text,'-') || '|' || coalesce(decision_note,'-') from leave_mgmt.wfh_requests where id='${W0.id}'`) === '-|-' && told(W0.id))
  r = await mgr.call(`/v1/wfh/${W0.id}/reject`, 'POST', { comment: 'QA busy week' })
  r = await mgr.call(`/v1/wfh/${W0.id}/decision/undo`, 'POST')
  check('undo wfh rejection: waiting again', r.status === 200 && status('leave_mgmt.wfh_requests', W0.id) === 'PENDING')
  const dW1 = pick(addDays(today, 10), 1, working)
  const W1 = (await a.call('/v1/wfh', 'POST', { fromDate: dW1, toDate: dW1, reason: 'QA team WFH used' })).json
  created.wfh.push(W1?.id)
  await mgr.call(`/v1/wfh/${W1.id}/approve`, 'POST', { comment: 'QA' })
  const rec1 = randomUUID()
  sql(`INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,attendance_type,attendance_status)
       VALUES ('${rec1}','${tenant}','${A}','${company}','${dW1}','${ist(dW1, '09:05')}','WFH','PRESENT')`)
  created.records.push([rec1, dW1])
  r = await mgr.call(`/v1/wfh/${W1.id}/decision/undo`, 'POST')
  check('undo wfh: refused once they checked in from home (422)', r.status === 422 && r.json?.errorCode === 'UNDO_WFH_USED', `${r.status} ${r.json?.errorCode}`)

  // ── 7. Undo: attendance fix ──────────────────────────────────────────────
  r = await mgr.call(`/v1/attendance/corrections/${C0.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA fix ok' })
  const fixRecord = sql(`select id from attendance.records where employee_id='${A}' and attendance_date='${dFix}'`)
  check('fix: approving creates the day', r.status === 200 && !!fixRecord)
  r = await mgr.call(`/v1/attendance/corrections/${C0.id}/decision/undo`, 'POST')
  check('undo fix: the day it created is removed, the fix waits again, the employee told', r.status === 200
    && num(`select count(*) from attendance.records where employee_id='${A}' and attendance_date='${dFix}'`) === 0
    && status('attendance.regularization_requests', C0.id) === 'PENDING' && told(C0.id), `${r.status} ${r.json?.errorCode}`)
  check('undo fix: noted in the day\'s activity log', num(`select count(*) from attendance.event_logs where employee_id='${A}' and event_type='MANUAL_OVERRIDE' and note like 'Correction approval undone%'`) >= 1)
  r = await mgr.call(`/v1/attendance/corrections/${C0.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA fix again' })
  const rec2 = sql(`select id from attendance.records where employee_id='${A}' and attendance_date='${dFix}'`)
  if (rec2) created.records.push([rec2, dFix])
  sql(`INSERT INTO attendance.overtime_decisions(tenant_id,record_id,record_date,status,reviewed_minutes,decided_by,note)
       VALUES ('${tenant}','${rec2}','${dFix}','APPROVED',30,'${MGR}','QA overtime')`)
  r = await mgr.call(`/v1/attendance/corrections/${C0.id}/decision/undo`, 'POST')
  check('undo fix: refused once the day\'s overtime was decided (422)', r.status === 422 && r.json?.errorCode === 'UNDO_OVERTIME_DECIDED', `${r.status} ${r.json?.errorCode}`)
  sql(`DELETE FROM attendance.overtime_decisions WHERE record_id='${rec2}'`)
  r = await mgr.call(`/v1/attendance/corrections/${C0.id}/decision/undo`, 'POST')
  check('undo fix: taken back once nothing used it', r.status === 200 && status('attendance.regularization_requests', C0.id) === 'PENDING')
  const dFixLocked = pick(addDays(today, -1), -1, (d) => working(d) && locked(d) && d >= addDays(today, -85), 90)
  if (!dFixLocked) skip('undo fix: refused inside a locked payroll month', 'no LOCKED or PAID run in the last 85 days')
  else {
    const C1 = (await a.call('/v1/attendance/corrections', 'POST', { requestedDate: dFixLocked, requestedCheckInAt: ist(dFixLocked, '09:30'), requestedCheckOutAt: ist(dFixLocked, '18:00'), reason: 'QA team locked fix' })).json
    if (C1?.id) created.corrections.push(C1.id)
    const hadRecord = num(`select count(*) from attendance.records where employee_id='${A}' and attendance_date='${dFixLocked}'`) > 0
    await mgr.call(`/v1/attendance/corrections/${C1.id}/decision`, 'POST', { status: 'APPROVED', comment: 'QA' })
    const rec3 = sql(`select id from attendance.records where employee_id='${A}' and attendance_date='${dFixLocked}'`)
    if (rec3 && !hadRecord) created.records.push([rec3, dFixLocked])
    r = await mgr.call(`/v1/attendance/corrections/${C1.id}/decision/undo`, 'POST')
    check('undo fix: refused inside a locked payroll month (422)', r.status === 422 && r.json?.errorCode === 'UNDO_PAYROLL_LOCKED', `${r.status} ${r.json?.errorCode}`)
  }

  // ── 8. Undo: shift change ────────────────────────────────────────────────
  const assignments = () => num(`select count(*) from attendance.employee_shift_assignments where employee_id='${A}'`)
  const before = assignments()
  r = await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision`, 'POST', { approved: true, comment: 'QA shift ok' })
  check('shift: approving schedules the new shift', r.status === 200 && assignments() === before + 1)
  r = await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision/undo`, 'POST')
  check('undo shift: the new shift is removed, the request waits again, the employee told', r.status === 200 && assignments() === before && status('attendance.shift_change_requests', S0.id) === 'PENDING'
    && sql(`select coalesce(approver_id::text,'-') || '|' || coalesce(applied_effective_date::text,'-') from attendance.shift_change_requests where id='${S0.id}'`) === '-|-' && told(S0.id), `${r.status} ${r.json?.errorCode}`)
  await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision`, 'POST', { approved: false, comment: 'QA no' })
  r = await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision/undo`, 'POST')
  check('undo shift rejection: waiting again', r.status === 200 && status('attendance.shift_change_requests', S0.id) === 'PENDING')
  await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision`, 'POST', { approved: false, comment: 'QA final no' })
  const S1 = (await a.call('/v1/shifts/change-requests', 'POST', { requestedShiftPolicyId: morning.id, reason: 'QA team shift from today', effectiveDate: today })).json
  created.shifts.push(S1?.id)
  r = await mgr.call(`/v1/shifts/change-requests/${S0.id}/decision/undo`, 'POST')
  check('undo shift: refused while they have another request waiting (422)', r.status === 422 && r.json?.errorCode === 'UNDO_SHIFT_PENDING_EXISTS', `${r.status} ${r.json?.errorCode}`)
  r = await mgr.call(`/v1/shifts/change-requests/${S1.id}/decision`, 'POST', { approved: true, comment: 'QA from today' })
  const recToday = randomUUID()
  sql(`INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,attendance_type,attendance_status)
       VALUES ('${recToday}','${tenant}','${A}','${company}','${today}',now(),'OFFICE','PRESENT')`)
  r = await mgr.call(`/v1/shifts/change-requests/${S1.id}/decision/undo`, 'POST')
  check('undo shift: refused once they checked in on the new shift (422)', r.status === 422 && r.json?.errorCode === 'UNDO_SHIFT_STARTED', `${r.status} ${r.json?.errorCode}`)
  sql(`DELETE FROM attendance.records WHERE id='${recToday}' AND attendance_date='${today}'`)
  r = await mgr.call(`/v1/shifts/change-requests/${S1.id}/decision/undo`, 'POST')
  check('undo shift: starting today but not yet used, it is taken back', r.status === 200 && assignments() === before)
  // The service rejects a request whose start date passed and then reports SHIFT_CHANGE_EXPIRED; it keeps
  // that rejection on purpose (noRollbackFor). Through the recorder it must still be kept, and not journalled.
  sql(`UPDATE attendance.shift_change_requests SET requested_effective_date = '${addDays(today, -1)}' WHERE id='${S1.id}'`)
  const s1Journal = num(`select count(*) from hrms.approval_decisions where tenant_id='${tenant}' and request_id='${S1.id}'`)
  r = await mgr.call(`/v1/shifts/change-requests/${S1.id}/decision`, 'POST', { approved: true, comment: 'QA expired' })
  check('recorder: an expired shift change is still rejected and reported as before', r.status === 422 && r.json?.errorCode === 'SHIFT_CHANGE_EXPIRED'
    && status('attendance.shift_change_requests', S1.id) === 'REJECTED' && assignments() === before
    && num(`select count(*) from hrms.approval_decisions where tenant_id='${tenant}' and request_id='${S1.id}'`) === s1Journal, `${r.status} ${r.json?.errorCode}`)

  // ── 9. Undo: expense claim ───────────────────────────────────────────────
  r = await owner.call(`/v1/expense/claims/${E0.id}/decision`, 'POST', { approved: true, comment: 'QA owner ok' })
  r = await owner.call(`/v1/expense/claims/${E0.id}/decision/undo`, 'POST')
  check('undo claim: submitted again, the employee told', r.status === 200 && r.json?.status === 'SUBMITTED' && status('expense_mgmt.expense_claims', E0.id) === 'SUBMITTED'
    && sql(`select coalesce(approved_at::text,'-') from expense_mgmt.expense_claims where id='${E0.id}'`) === '-' && told(E0.id), `${r.status} ${JSON.stringify(r.json)}`)
  await mgr.call(`/v1/expense/claims/${E0.id}/decision`, 'POST', { approved: true, comment: 'QA mgr ok' })
  const batch = randomUUID()
  sql(`BEGIN;
    INSERT INTO expense_mgmt.reimbursement_batches(id,tenant_id,company_id,batch_reference,cutoff_date,status,total_amount,claim_count)
      VALUES ('${batch}','${tenant}','${company}','QA-TEAM-${batch.slice(0, 8)}','${today}','POSTED',500,1);
    INSERT INTO expense_mgmt.reimbursement_batch_items(tenant_id,batch_id,claim_id,employee_id,amount)
      VALUES ('${tenant}','${batch}','${E0.id}','${A}',500);
    COMMIT;`)
  created.batches.push(batch)
  r = await mgr.call(`/v1/expense/claims/${E0.id}/decision/undo`, 'POST')
  check('undo claim: refused once it is in a reimbursement batch (422)', r.status === 422 && r.json?.errorCode === 'UNDO_REIMBURSEMENT_BATCH', `${r.status} ${r.json?.errorCode}`)

  // ── 10. probation ────────────────────────────────────────────────────────
  const prob = await mgr.call('/v1/team/probation?days=30')
  const pr = (prob.json || []).find((x) => x.employeeId === P)
  check('probation: mgr sees their team\'s end dates', prob.status === 200 && pr?.daysLeft === 20 && pr?.overdue === false, JSON.stringify(pr))
  check('probation: mgr can\'t confirm without the team decide permission (403)', (await mgr.call(`/v1/team/probation/${P}/confirm`, 'POST', {})).status === 403)
  check('probation: nor extend (403)', (await mgr.call(`/v1/team/probation/${P}/extend`, 'POST', { newEndDate: addDays(today, 50) })).status === 403)
  r = await owner.call(`/v1/team/probation/${P}/extend`, 'POST', { newEndDate: addDays(today, 50), note: 'QA more time' })
  check('probation: the owner (holds the permission) extends', r.status === 200 && r.json?.probationEndDate === addDays(today, 50)
    && sql(`select probation_end_date from hrms.employees where id='${P}'`) === addDays(today, 50), `${r.status} ${JSON.stringify(r.json)}`)
  check('probation: the employee is told', num(`select count(*) from notif.notifications where user_id='${P}' and type='PROBATION_TEAM_DECISION'`) === 1)
  check('probation: HR is told, not the person who decided', num(`select count(*) from notif.notifications where user_id='${HRM}' and type='PROBATION_TEAM_DECISION' and data->>'employeeId'='${P}'`) === 1
    && num(`select count(*) from notif.notifications where user_id='${OWNER_EMP}' and type='PROBATION_TEAM_DECISION' and data->>'employeeId'='${P}'`) === 0)
  r = await owner.call(`/v1/team/probation/${P}/extend`, 'POST', { newEndDate: addDays(today, 50) })
  check('probation: the new end must be later than the current one (422)', r.status === 422 && r.json?.errorCode === 'PROBATION_DATE_INVALID')
  r = await owner.call(`/v1/team/probation/${P}/confirm`, 'POST', {})
  check('probation: confirm makes them active', r.status === 200 && sql(`select employment_status || '|' || confirmation_date from hrms.employees where id='${P}'`) === `ACTIVE|${today}`, `${r.status} ${JSON.stringify(r.json)}`)
  check('probation: confirming again is refused (not on probation, 422)', (await owner.call(`/v1/team/probation/${P}/confirm`, 'POST', {})).status === 422)
  check('probation: the list looks at most a year ahead (400)', (await mgr.call('/v1/team/probation?days=400')).status === 400)

  // ── 11. team messages ────────────────────────────────────────────────────
  const teamSize = num(`select count(*) from hrms.employees where reporting_manager_id='${MGR}' and tenant_id='${tenant}' and employment_status not in ('EXITED','TERMINATED','RESIGNED','RETIRED') and id <> '${MGR}'`)
  r = await mgr.call('/v1/team/messages', 'POST', { body: 'QA team: stand-up moves to 10:30 tomorrow.' })
  if (r.json?.id) created.messages.push(r.json.id)
  check('messages: mgr posts to their own team only', r.status === 201 && r.json?.recipientCount === teamSize
    && num(`select count(*) from hrms.team_message_recipients where message_id='${r.json?.id}' and employee_id not in (select id from hrms.employees where reporting_manager_id='${MGR}')`) === 0, `${r.status} count=${r.json?.recipientCount} team=${teamSize}`)
  const msgId = r.json?.id
  check('messages: a member sees it (Around you)', ((await reader.call('/v1/team/messages/mine?days=30')).json || []).some((m) => m.id === msgId))
  check('messages: the fixture member sees it too', ((await a.call('/v1/team/messages/mine')).json || []).some((m) => m.id === msgId))
  check('messages: someone outside the team doesn\'t', !((await hrm.call('/v1/team/messages/mine')).json || []).some((m) => m.id === msgId))
  check('messages: the sender sees it with its reach', ((await mgr.call('/v1/team/messages/sent')).json || []).some((m) => m.id === msgId && m.recipientCount === teamSize))
  check('messages: members are told (TEAM_MESSAGE)', num(`select count(*) from notif.notifications where type='TEAM_MESSAGE' and data->>'messageId'='${msgId}'`) === teamSize)
  check('messages: reader can\'t post (403)', (await reader.call('/v1/team/messages', 'POST', { body: 'hi' })).status === 403)
  check('messages: hrm can\'t post (403)', (await hrm.call('/v1/team/messages', 'POST', { body: 'hi' })).status === 403)
  check('messages: fin can\'t post (403)', (await fin.call('/v1/team/messages', 'POST', { body: 'hi' })).status === 403)
  check('messages: an empty or too long message is refused (400)', (await mgr.call('/v1/team/messages', 'POST', { body: '  ' })).status === 400
    && (await mgr.call('/v1/team/messages', 'POST', { body: 'x'.repeat(501) })).status === 400)

  // ── 12. FEATURE_NOT_READY while a table is missing ───────────────────────
  const dW2 = pick(addDays(today, 11), 1, working)
  const W2 = (await a.call('/v1/wfh', 'POST', { fromDate: dW2, toDate: dW2, reason: 'QA team decided while off' })).json
  created.wfh.push(W2?.id)
  allowNotReady = true
  try {
    sql('ALTER TABLE hrms.approval_decisions RENAME TO approval_decisions_qa_off')
    try {
      r = await mgr.call('/v1/approvals/recent-decisions')
      check('not ready: recent decisions answer FEATURE_NOT_READY (503)', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status} ${r.json?.errorCode}`)
      r = await mgr.call(`/v1/leave/${L0.id}/decision/undo`, 'POST')
      check('not ready: Undo answers FEATURE_NOT_READY (503)', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status}`)
      r = await mgr.call('/v1/team/approvals')
      check('not ready: the inbox still loads, with no recent decisions', r.status === 200 && (r.json?.recentDecisions || []).length === 0)
      r = await mgr.call(`/v1/wfh/${W2.id}/approve`, 'POST', { comment: 'QA while off' })
      check('not ready: decisions work as before', r.status === 200 && status('leave_mgmt.wfh_requests', W2.id) === 'APPROVED')
    } finally {
      sql('ALTER TABLE hrms.approval_decisions_qa_off RENAME TO approval_decisions')
    }
    sql('ALTER TABLE hrms.team_messages RENAME TO team_messages_qa_off')
    try {
      for (const [m, path, body] of [['POST', '/v1/team/messages', { body: 'QA' }], ['GET', '/v1/team/messages/mine'], ['GET', '/v1/team/messages/sent']]) {
        r = await mgr.call(path, m, body)
        check(`not ready: ${m} ${path} answers FEATURE_NOT_READY (503)`, r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status}`)
      }
    } finally {
      sql('ALTER TABLE hrms.team_messages_qa_off RENAME TO team_messages')
    }
    sql('ALTER TABLE hrms.team_message_recipients RENAME TO team_message_recipients_qa_off')
    try {
      r = await reader.call('/v1/team/messages/mine')
      check('not ready: without the recipients table too (503)', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status}`)
    } finally {
      sql('ALTER TABLE hrms.team_message_recipients_qa_off RENAME TO team_message_recipients')
    }
  } finally {
    allowNotReady = false
  }
  r = await mgr.call(`/v1/wfh/${W2.id}/decision/undo`, 'POST')
  check('not ready: a decision made while the journal was missing has no Undo (404)', r.status === 404, `${r.status}`)
  check('back on: recent decisions work again', (await mgr.call('/v1/approvals/recent-decisions')).status === 200)

  // ── 13. the HRMS module guard on the new paths ───────────────────────────
  const moduleWas = sql(`select status from platform.tenant_modules where tenant_id='${tenant}' and module_key='hrms'`)
  try {
    sql(`update platform.tenant_modules set status='SUSPENDED' where tenant_id='${tenant}' and module_key='hrms'`)
    check('module guard: /v1/team needs HRMS', (await mgr.call('/v1/team/summary')).status === 403)
    check('module guard: /v1/approvals needs HRMS', (await mgr.call('/v1/approvals/recent-decisions')).status === 403)
  } finally {
    sql(`update platform.tenant_modules set status='${moduleWas}' where tenant_id='${tenant}' and module_key='hrms'`)
  }
  check('module guard: back with HRMS on', (await mgr.call('/v1/team/summary')).status === 200)
}

function cleanup() {
  const reqIds = [...created.leave, ...created.wfh, ...created.corrections, ...created.shifts, ...created.claims, ...created.rawLeave, ...created.messages].filter(Boolean)
  const idList = reqIds.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const everyone = [A, P, ...reqIds]
  const pattern = everyone.join('|')
  const run = (label, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${label}: ${String(e.message).split('\n')[0]}`) } }
  run('notifications', `DELETE FROM notif.notifications WHERE user_id IN ('${A}','${P}') OR data::text ~ '${pattern}'`)
  run('audit', `DELETE FROM audit.events WHERE tenant_id='${tenant}' AND (entity_id IN (${[A, P, ...reqIds].map((x) => `'${x}'`).join(',')}) OR summary ~ 'QA Team')`)
  run('journal', `DELETE FROM hrms.approval_decisions WHERE tenant_id='${tenant}' AND (employee_id IN ('${A}','${P}','${JANE}') AND request_id IN (${idList}))`)
  run('messages', `DELETE FROM hrms.team_messages WHERE tenant_id='${tenant}' AND id IN (${idList})`)
  run('batches', `BEGIN; DELETE FROM expense_mgmt.reimbursement_batch_items WHERE batch_id IN (${created.batches.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`}); DELETE FROM expense_mgmt.reimbursement_batches WHERE id IN (${created.batches.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`}); COMMIT;`)
  run('claims', `BEGIN; DELETE FROM expense_mgmt.expense_items WHERE claim_id IN (SELECT id FROM expense_mgmt.expense_claims WHERE employee_id='${A}'); DELETE FROM expense_mgmt.expense_claims WHERE employee_id='${A}'; COMMIT;`)
  run('overtime', `DELETE FROM attendance.overtime_decisions WHERE record_id IN (SELECT id FROM attendance.records WHERE employee_id='${A}')`)
  run('attendance', `BEGIN; DELETE FROM attendance.event_logs WHERE employee_id='${A}'; DELETE FROM attendance.records WHERE employee_id='${A}'; DELETE FROM attendance.regularization_requests WHERE employee_id='${A}'; DELETE FROM attendance.shift_change_requests WHERE employee_id='${A}'; DELETE FROM attendance.employee_shift_assignments WHERE employee_id='${A}'; COMMIT;`)
  run('leave', `BEGIN; DELETE FROM leave_mgmt.leave_requests WHERE employee_id='${A}' OR id IN (${idList}); DELETE FROM leave_mgmt.wfh_requests WHERE employee_id='${A}'; DELETE FROM leave_mgmt.leave_balance_ledger WHERE employee_id='${A}'; DELETE FROM leave_mgmt.leave_balances WHERE employee_id='${A}'; COMMIT;`)
  for (const t of sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.column_name='user_id' and t.table_type='BASE TABLE' and c.table_schema='auth'`).split('\n').filter(Boolean)) {
    run(t, `DELETE FROM ${t} WHERE user_id='${UA}'`)
  }
  run('people', `BEGIN; DELETE FROM rbac.user_roles WHERE user_id='${UA}'; DELETE FROM auth.user_credentials WHERE id='${UA}'; DELETE FROM hrms.employee_status_history WHERE employee_id IN ('${A}','${P}'); DELETE FROM hrms.employees WHERE id IN ('${A}','${P}'); COMMIT;`)
  // anything left behind?
  const tables = sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.column_name='employee_id' and t.table_type='BASE TABLE' and c.table_schema in ('leave_mgmt','attendance','expense_mgmt','hrms','notif','auth')
      and c.table_name not like '%\\_20%' and c.table_name not like '%\\_default'`).split('\n').filter(Boolean)
  const left = tables.map((t) => [t, num(`select count(*) from ${t} where employee_id in ('${A}','${P}')`)]).filter(([, n]) => n > 0)
  const leftOther = num(`select count(*) from hrms.approval_decisions where request_id in (${idList})`) + num(`select count(*) from notif.notifications where data::text ~ '${pattern}'`)
  check('cleanup: nothing the test made is left behind', left.length === 0 && leftOther === 0, JSON.stringify(left) + ` other=${leftOther}`)
}

try {
  await main()
} catch (e) {
  check('script completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  cleanup()
}
check('no unexpected 5xx and no FEATURE_NOT_READY outside the rename step', surprises.length === 0, surprises.slice(0, 5).join(' || '))
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
