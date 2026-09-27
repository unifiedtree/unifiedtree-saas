// P-ATT-PLAN backend (redesign .be milestone) — API-level live check against the
// real local API. Covers:
//   BW-29 company overtime rules: GET/PUT /v1/attendance/overtime-rules, the
//         Overtime list and decisions applying "counts after" and the monthly
//         cap, then cleared (the list is today's again, with no new fields)
//   BW-31 a shift change with an end date ("Until"): approved, the new shift
//         runs to the end date and the old shift comes back the day after;
//         and for someone with no shift before, none after
//   BW-34 withdraw a waiting request (requester only, waiting only)
//   BW-32 people per shift on GET /v1/shifts
//   BW-22 day facts (onLeave, weeklyOff, holidayName) on GET /v1/team/schedule
//   BW-20 GET /v1/attendance/dashboard/breakdown, BW-21 GET /v1/attendance/punctuality
//   403s per role, derived from each login's own permissions
//   FEATURE_NOT_READY: renames the new column and table (ut_w3_dev only), checks
//         the answers and that everything else keeps working, renames them back.
//         Any FEATURE_NOT_READY outside that step is a failure.
// Removes everything it creates (requests, assignments, fixture punches, overtime
// decisions, rules, holiday, leave, notifications and audit rows it caused).
//
// Run from apps/platform (API on :8080, DB ut_w3_dev), e.g. inside live-slot.sh:
//   RECOVERY_DB=ut_w3_dev RECOVERY_API_URL=http://127.0.0.1:8080/api node e2e/recovery/live-rd-p-att-plan-api.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isoDow = (iso) => { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d }
const day = (v) => String(v ?? '').slice(0, 10)

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  — ' + detail : ''}`) }

// Any FEATURE_NOT_READY outside the deliberate rename step, and any 5xx, is a failure.
let renameStep = false
const unexpected = []
async function call(user, method, path, body) {
  const r = await fetch(base + path, { method, headers: user.h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null; try { json = await r.json() } catch { /* empty body */ }
  if (r.status >= 500 && !(renameStep && json?.errorCode === 'FEATURE_NOT_READY')) unexpected.push(`${method} ${path} → ${r.status} ${json?.errorCode ?? ''} (${user.name})`)
  if (json?.errorCode === 'FEATURE_NOT_READY' && !renameStep) unexpected.push(`${method} ${path} → FEATURE_NOT_READY (${user.name})`)
  return { status: r.status, json }
}
async function login(name, email) {
  const r = await fetch(`${base}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const token = (await r.json()).accessToken
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  return { name, h: { ...headers, Authorization: `Bearer ${token}` }, perms: new Set(claims.permissions || []), employeeId: claims.employee_id }
}
const can = (u, ...any) => any.some((p) => u.perms.has(p))
const expectStatus = (u, ok, okStatus = 200) => (ok ? okStatus : 403)

const testStart = sql('select now()')
const today = istToday()
const cleanup = []
const run = async (label, fn) => { try { await fn() } catch (e) { check(`${label}: finished without an exception`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')) } }

const U = {
  owner: await login('owner', 'owner@unifiedtree.demo'),
  hrm: await login('hrm', 'hrm@unifiedtree.demo'),
  fin: await login('fin', 'fin@unifiedtree.demo'),
  mgr: await login('mgr', 'mgr@unifiedtree.demo'),
  reader: await login('reader', 'reader@unifiedtree.demo'),
}
const roles = Object.values(U)
console.log(`DB ${DB}, today ${today}, API ${base}`)

try {
  // ── BW-29 · company overtime rules ─────────────────────────────────────────
  await run('overtime rules', async () => {
    const before = sql(`select coalesce(counts_after_minutes::text,'null')||'|'||coalesce(monthly_cap_minutes::text,'null') from attendance.overtime_rules where tenant_id='${tenant}' and company_id='${company}'`)
    cleanup.push(() => before
      ? sql(`update attendance.overtime_rules set counts_after_minutes=${before.split('|')[0]}, monthly_cap_minutes=${before.split('|')[1]} where tenant_id='${tenant}' and company_id='${company}'`)
      : sql(`delete from attendance.overtime_rules where tenant_id='${tenant}' and company_id='${company}'`))
    cleanup.push(() => sql(`delete from audit.events where action='OVERTIME_RULES_UPDATED' and occurred_at >= '${testStart}'`))
    const path = `/v1/attendance/overtime-rules?companyId=${company}`
    for (const u of roles) {
      const r = await call(u, 'GET', path)
      check(`${u.name}: read the rules → ${expectStatus(u, can(u, 'attendance.team.read', 'attendance.policy.manage'))}`,
        r.status === expectStatus(u, can(u, 'attendance.team.read', 'attendance.policy.manage')), r.status)
      if (!can(u, 'attendance.policy.manage')) {
        const w = await call(u, 'PUT', path, { countsAfterMinutes: 5, monthlyCapMinutes: null })
        check(`${u.name}: cannot change the rules (403)`, w.status === 403, w.status)
      }
    }
    if (!before) {
      const none = await call(U.owner, 'GET', path)
      check('never set: nulls', none.status === 200 && none.json.companyId === company && none.json.countsAfterMinutes === null
        && none.json.monthlyCapMinutes === null && none.json.updatedByName === null, JSON.stringify(none.json))
    }
    const bad = await call(U.owner, 'PUT', path, { countsAfterMinutes: -5, monthlyCapMinutes: null })
    check('a negative "counts after" is refused (422 OVERTIME_RULES_INVALID)', bad.status === 422 && bad.json?.errorCode === 'OVERTIME_RULES_INVALID', `${bad.status} ${bad.json?.errorCode}`)
    const set = await call(U.owner, 'PUT', path, { countsAfterMinutes: 30, monthlyCapMinutes: 40 })
    check('owner sets the rules: 30 min, 40 min cap', set.status === 200 && set.json.countsAfterMinutes === 30 && set.json.monthlyCapMinutes === 40
      && !!set.json.updatedByName && !!set.json.updatedAt, JSON.stringify(set.json))
    const seen = await call(U.mgr, 'GET', path)
    if (can(U.mgr, 'attendance.team.read')) check('a manager reads the same rules', seen.json?.countsAfterMinutes === 30 && seen.json?.monthlyCapMinutes === 40, JSON.stringify(seen.json))

    // Fixture punches for fin@ (two days this month or last): 20 extra minutes (inside the rule) and 77 (47 count).
    const d0 = Number(today.slice(8)) >= 4 ? `${today.slice(0, 8)}02` : `${plus(`${today.slice(0, 8)}01`, -1).slice(0, 8)}10`
    const d1 = plus(d0, 1)
    const fin = U.fin.employeeId
    const small = sql(`insert into attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) values (gen_random_uuid(),'${tenant}','${fin}','${company}','${d0}','${d0}T03:30:00Z','${d0}T12:20:00Z',20,'QA P-ATT-PLAN overtime fixture') returning id`).split('\n')[0]
    const big = sql(`insert into attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) values (gen_random_uuid(),'${tenant}','${fin}','${company}','${d1}','${d1}T03:30:00Z','${d1}T13:17:00Z',77,'QA P-ATT-PLAN overtime fixture') returning id`).split('\n')[0]
    cleanup.push(() => sql(`delete from attendance.overtime_decisions where record_id in ('${small}','${big}'); delete from attendance.records where id in ('${small}','${big}'); delete from notif.notifications where data::text like '%${small}%' or data::text like '%${big}%'`))
    const listPath = `/v1/attendance/overtime?from=${d0}&to=${d1}`
    let list = await call(U.owner, 'GET', listPath)
    let rows = list.json?.content || []
    const bigRow = rows.find((r) => r.id === big)
    check('with the rule: 77 extra minutes are listed, 47 of them counted', list.status === 200 && bigRow?.minutes === 77 && bigRow?.countedMinutes === 47, JSON.stringify(bigRow))
    check('with the rule: 20 extra minutes are not overtime (not listed)', !rows.some((r) => r.id === small), rows.map((r) => r.minutes).join(','))
    const inside = await call(U.owner, 'POST', `/v1/attendance/overtime/${small}/approve`, { note: 'QA' })
    check('approving time inside the rule is refused (422 OVERTIME_NOT_COUNTED)', inside.status === 422 && inside.json?.errorCode === 'OVERTIME_NOT_COUNTED', `${inside.status} ${inside.json?.errorCode}`)
    const capped = await call(U.owner, 'POST', `/v1/attendance/overtime/${big}/approve`, { note: 'QA' })
    check('approving 47 counted minutes past a 40-minute cap is refused (422 OVERTIME_MONTHLY_CAP_REACHED)', capped.status === 422 && capped.json?.errorCode === 'OVERTIME_MONTHLY_CAP_REACHED', `${capped.status} ${capped.json?.message}`)
    await call(U.owner, 'PUT', path, { countsAfterMinutes: 30, monthlyCapMinutes: null })
    const approved = await call(U.owner, 'POST', `/v1/attendance/overtime/${big}/approve`, { note: 'QA approve' })
    check('without the cap it is approved', approved.status === 200 && approved.json?.status === 'APPROVED', `${approved.status} ${JSON.stringify(approved.json)}`)
    const stored = sql(`select overtime_minutes||'|'||(select reviewed_minutes from attendance.overtime_decisions where record_id='${big}') from attendance.records where id='${big}'`)
    check('the stored minutes never change; the stored minutes are what was reviewed', stored === '77|77', stored)
    const noNote = await call(U.owner, 'POST', `/v1/attendance/overtime/${small}/reject`, { note: '  ' })
    check('a rejection needs a note (422 OVERTIME_REASON_REQUIRED)', noNote.status === 422 && noNote.json?.errorCode === 'OVERTIME_REASON_REQUIRED', `${noNote.status} ${noNote.json?.errorCode}`)

    const cleared = await call(U.owner, 'PUT', path, { countsAfterMinutes: null, monthlyCapMinutes: null })
    check('rules cleared: nulls back', cleared.status === 200 && cleared.json.countsAfterMinutes === null && cleared.json.monthlyCapMinutes === null, JSON.stringify(cleared.json))
    list = await call(U.owner, 'GET', listPath)
    rows = list.json?.content || []
    check('cleared: both days are overtime again', rows.some((r) => r.id === small) && rows.some((r) => r.id === big), rows.map((r) => r.minutes).join(','))
    check('cleared: the list has exactly today\'s fields (no countedMinutes)', rows.length > 0 && rows.every((r) => !('countedMinutes' in r)) && Object.keys(list.json).sort().join() === 'content,totalElements', Object.keys(rows[0] || {}).join(','))
    const rejected = await call(U.owner, 'POST', `/v1/attendance/overtime/${small}/reject`, { note: 'QA reject' })
    check('cleared: the 20 minutes can be decided again', rejected.status === 200 && rejected.json?.status === 'REJECTED', `${rejected.status}`)
    for (const u of [U.reader, U.fin]) {
      if (can(u, 'attendance.overtime.approve')) continue
      const r = await call(u, 'POST', `/v1/attendance/overtime/${small}/approve`, { note: 'x' })
      check(`${u.name}: cannot decide overtime (403)`, r.status === 403, r.status)
    }
  })

  // ── BW-31 · a temporary shift change ────────────────────────────────────────
  const shifts = (await call(U.owner, 'GET', `/v1/shifts?companyId=${company}`)).json || []
  const assignmentsOf = (id) => sql(`select id||'|'||coalesce(effective_to::text,'') from attendance.employee_shift_assignments where employee_id='${id}' order by effective_from, created_at`)
  const restoreAssignments = (id, beforeRows) => {
    // Drop what the test added, and give the rows that were there their old end dates back.
    sql(`delete from attendance.employee_shift_assignments where employee_id='${id}' and created_at >= '${testStart}'`)
    for (const line of beforeRows ? beforeRows.split('\n') : []) {
      const [aid, to] = line.split('|')
      sql(`update attendance.employee_shift_assignments set effective_to=${to ? `'${to}'` : 'null'} where id='${aid}'`)
    }
  }
  const scheduleFor = async (user, id, from, to) => ((await call(user, 'GET', `/v1/team/schedule?from=${from}&to=${to}`)).json || []).filter((r) => r.employeeId === id)

  await run('until (old shift restored)', async () => {
    const who = can(U.fin, 'attendance.checkin.self') ? U.fin : U.hrm
    const id = who.employeeId
    const beforeRows = assignmentsOf(id)
    cleanup.push(() => restoreAssignments(id, beforeRows))
    cleanup.push(() => sql(`delete from notif.notifications where created_at >= '${testStart}' and data->>'shiftChangeRequestId' in (select id::text from attendance.shift_change_requests where employee_id='${id}' and created_at >= '${testStart}'); delete from attendance.shift_change_requests where employee_id='${id}' and created_at >= '${testStart}'`))
    // Give them a shift from today, so there is an old shift to go back to.
    const [old, target] = shifts
    const base0 = await call(U.owner, 'POST', `/v1/shifts/employee/${id}`, { shiftPolicyId: old.id, effectiveFrom: today, note: 'QA P-ATT-PLAN baseline' })
    check(`${who.name} is on ${old.name} from today`, base0.status === 200, base0.status)
    const start = plus(today, 2), end = plus(today, 4)
    const wrong = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: start, endDate: plus(start, -1), reason: 'QA until — end before start' })
    check('an end date before the start is refused (422 SHIFT_CHANGE_END_BEFORE_START)', wrong.status === 422 && wrong.json?.errorCode === 'SHIFT_CHANGE_END_BEFORE_START', `${wrong.status} ${wrong.json?.errorCode}`)
    const created = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: start, endDate: end, reason: 'QA until — covering a colleague for three days' })
    check(`${who.name} asks for ${target.name} from ${start} until ${end}`, created.status === 201 && created.json?.requestedEndDate === end && created.json?.status === 'PENDING', `${created.status} ${JSON.stringify(created.json)?.slice(0, 200)}`)
    const reqId = created.json?.id
    const mine = (await call(who, 'GET', '/v1/shifts/change-requests/my')).json || []
    check('their list shows the range', mine.find((r) => r.id === reqId)?.requestedEndDate === end)
    const pending = (await call(U.owner, 'GET', '/v1/shifts/change-requests/pending')).json || []
    check('the HR queue shows the range', pending.find((r) => r.id === reqId)?.requestedEndDate === end)
    for (const u of [U.mgr, U.reader]) {
      const r = await call(u, 'POST', `/v1/shifts/change-requests/${reqId}/decision`, { approved: true, comment: 'x' })
      check(`${u.name} cannot decide it (403: no permission, or not their team)`, r.status === 403, r.status)
    }
    const ok = await call(U.owner, 'POST', `/v1/shifts/change-requests/${reqId}/decision`, { approved: true, comment: 'QA approve until' })
    check('owner approves it', ok.status === 200 && ok.json?.status === 'APPROVED' && ok.json?.appliedEffectiveDate === start && ok.json?.requestedEndDate === end, `${ok.status} ${ok.json?.status}`)
    const days = await scheduleFor(U.owner, id, today, plus(today, 7))
    const on = (d) => days.find((r) => day(r.date) === d)?.shiftName ?? null
    check(`the day before: ${old.name}`, on(plus(start, -1)) === old.name, on(plus(start, -1)))
    check(`from ${start} to ${end}: ${target.name}`, on(start) === target.name && on(plus(start, 1)) === target.name && on(end) === target.name, `${on(start)}, ${on(plus(start, 1))}, ${on(end)}`)
    check(`the day after (${plus(end, 1)}): back on ${old.name}, and it stays`, on(plus(end, 1)) === old.name && on(plus(end, 3)) === old.name, `${on(plus(end, 1))}, ${on(plus(end, 3))}`)
    const history = (await call(U.owner, 'GET', `/v1/shifts/employee/${id}/history`)).json || []
    const back = history.find((h) => day(h.effectiveFrom) === plus(end, 1))
    check('the history says why the old shift came back', back?.shiftName === old.name && back?.effectiveTo === null && /temporary shift change/i.test(back?.note || ''), JSON.stringify(back))
  })

  await run('until (no shift before)', async () => {
    const who = U.hrm
    const id = who.employeeId
    const beforeRows = assignmentsOf(id)
    if (beforeRows) { check('hrm@ has no shift (precondition for the no-shift case)', true, 'skipped: hrm@ already has a shift'); return }
    cleanup.push(() => restoreAssignments(id, beforeRows))
    cleanup.push(() => sql(`delete from notif.notifications where created_at >= '${testStart}' and data->>'shiftChangeRequestId' in (select id::text from attendance.shift_change_requests where employee_id='${id}' and created_at >= '${testStart}'); delete from attendance.shift_change_requests where employee_id='${id}' and created_at >= '${testStart}'`))
    const target = shifts[1]
    const start = plus(today, 3), end = plus(today, 3)
    const created = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: start, endDate: end, reason: 'QA until — one day only' })
    check('one-day change by someone with no shift', created.status === 201, `${created.status} ${created.json?.errorCode ?? ''}`)
    const self = await call(who, 'POST', `/v1/shifts/change-requests/${created.json?.id}/decision`, { approved: true })
    check('they cannot approve their own request (422 SELF_APPROVAL_NOT_ALLOWED)', self.status === 422 && self.json?.errorCode === 'SELF_APPROVAL_NOT_ALLOWED', `${self.status} ${self.json?.errorCode}`)
    const ok = await call(U.owner, 'POST', `/v1/shifts/change-requests/${created.json?.id}/decision`, { approved: true })
    check('owner approves it', ok.status === 200 && ok.json?.status === 'APPROVED', ok.status)
    const days = await scheduleFor(U.owner, id, today, plus(today, 6))
    const on = (d) => days.find((r) => day(r.date) === d)?.shiftName ?? null
    check(`on ${start}: ${target.name}; the day after: no shift again`, on(start) === target.name && on(plus(start, 1)) === null && on(plus(start, -1)) === null, `${on(plus(start, -1))} / ${on(start)} / ${on(plus(start, 1))}`)
  })

  // ── BW-34 · withdraw ───────────────────────────────────────────────────────
  await run('withdraw', async () => {
    const who = U.fin
    const id = who.employeeId
    cleanup.push(() => sql(`delete from attendance.shift_change_requests where employee_id='${id}' and created_at >= '${testStart}'`))
    const current = (await call(who, 'GET', `/v1/shifts/employee/${id}`)).json
    const target = shifts.find((s) => s.id !== current?.shiftPolicyId)
    // Later than the temporary change above, so its schedule doesn't block this date.
    const start = plus(today, 20)
    const created = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: start, reason: 'QA withdraw — plans changed' })
    check('a permanent request is filed (no end date)', created.status === 201 && created.json?.requestedEndDate === null, `${created.status} ${created.json?.errorCode ?? ''}`)
    const reqId = created.json?.id
    for (const u of [U.reader, U.owner]) {
      const r = await call(u, 'POST', `/v1/shifts/change-requests/${reqId}/cancel`)
      const want = can(u, 'attendance.checkin.self') ? 422 : 403
      check(`${u.name} cannot withdraw someone else's request (${want}${want === 422 ? ' SHIFT_CHANGE_NOT_YOURS' : ''})`, r.status === want && (want === 403 || r.json?.errorCode === 'SHIFT_CHANGE_NOT_YOURS'), `${r.status} ${r.json?.errorCode ?? ''}`)
    }
    const w = await call(who, 'POST', `/v1/shifts/change-requests/${reqId}/cancel`)
    check('the requester withdraws it: CANCELLED', w.status === 200 && w.json?.status === 'CANCELLED' && w.json?.id === reqId, `${w.status} ${w.json?.status}`)
    const again = await call(who, 'POST', `/v1/shifts/change-requests/${reqId}/cancel`)
    check('withdrawing twice is refused (422 SHIFT_CHANGE_NOT_PENDING)', again.status === 422 && again.json?.errorCode === 'SHIFT_CHANGE_NOT_PENDING', `${again.status} ${again.json?.errorCode}`)
    const pending = (await call(U.owner, 'GET', '/v1/shifts/change-requests/pending')).json || []
    check('it leaves the HR queue', !pending.some((r) => r.id === reqId))
    const mine = (await call(who, 'GET', '/v1/shifts/change-requests/my')).json || []
    check('it stays in their list as CANCELLED', mine.find((r) => r.id === reqId)?.status === 'CANCELLED')
    const next = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: start, reason: 'QA withdraw — asking again' })
    check('they can ask again (the waiting slot is free)', next.status === 201, `${next.status} ${next.json?.errorCode ?? ''}`)
    const decided = await call(U.owner, 'POST', `/v1/shifts/change-requests/${next.json?.id}/decision`, { approved: false, comment: 'QA cleanup' })
    const late = await call(who, 'POST', `/v1/shifts/change-requests/${next.json?.id}/cancel`)
    check('a decided request cannot be withdrawn', decided.status === 200 && late.status === 422 && late.json?.errorCode === 'SHIFT_CHANGE_NOT_PENDING', `${late.status} ${late.json?.errorCode}`)
  })

  // ── the rename step: FEATURE_NOT_READY, and nothing else breaks ───────────
  await run('feature not ready', async () => {
    if (DB !== 'ut_w3_dev') { check('rename step (ut_w3_dev only)', true, `skipped on ${DB}`); return }
    const who = U.fin
    const current = (await call(who, 'GET', `/v1/shifts/employee/${who.employeeId}`)).json
    const target = shifts.find((s) => s.id !== current?.shiftPolicyId)
    renameStep = true
    try {
      sql('alter table attendance.shift_change_requests rename column requested_end_date to requested_end_date_qa_renamed')
      const until = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: plus(today, 21), endDate: plus(today, 23), reason: 'QA not ready — until' })
      check('column missing: asking with an end date → 503 FEATURE_NOT_READY', until.status === 503 && until.json?.errorCode === 'FEATURE_NOT_READY', `${until.status} ${until.json?.errorCode}`)
      const mine = await call(who, 'GET', '/v1/shifts/change-requests/my')
      check('column missing: their list still works (no end dates)', mine.status === 200 && (mine.json || []).every((r) => r.requestedEndDate === null), mine.status)
      const pending = await call(U.owner, 'GET', '/v1/shifts/change-requests/pending')
      check('column missing: the HR queue still works', pending.status === 200, pending.status)
      const perm = await call(who, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, effectiveDate: plus(today, 21), reason: 'QA not ready — permanent' })
      check('column missing: a permanent request still works', perm.status === 201, `${perm.status} ${perm.json?.errorCode ?? ''}`)
      const w = await call(who, 'POST', `/v1/shifts/change-requests/${perm.json?.id}/cancel`)
      check('column missing: withdraw still works', w.status === 200 && w.json?.status === 'CANCELLED', w.status)
    } finally {
      sql('alter table attendance.shift_change_requests rename column requested_end_date_qa_renamed to requested_end_date')
    }
    try {
      sql('alter table attendance.overtime_rules rename to overtime_rules_qa_renamed')
      const g = await call(U.owner, 'GET', `/v1/attendance/overtime-rules?companyId=${company}`)
      check('table missing: reading the rules → 503 FEATURE_NOT_READY', g.status === 503 && g.json?.errorCode === 'FEATURE_NOT_READY', `${g.status} ${g.json?.errorCode}`)
      const p = await call(U.owner, 'PUT', `/v1/attendance/overtime-rules?companyId=${company}`, { countsAfterMinutes: 10, monthlyCapMinutes: null })
      check('table missing: saving the rules → 503 FEATURE_NOT_READY', p.status === 503 && p.json?.errorCode === 'FEATURE_NOT_READY', `${p.status} ${p.json?.errorCode}`)
      const list = await call(U.owner, 'GET', `/v1/attendance/overtime?from=${plus(today, -30)}&to=${today}`)
      check('table missing: the Overtime list works as it always did', list.status === 200 && Array.isArray(list.json?.content), list.status)
    } finally {
      sql('alter table attendance.overtime_rules_qa_renamed rename to overtime_rules')
      renameStep = false
    }
    const back = await call(U.owner, 'GET', `/v1/attendance/overtime-rules?companyId=${company}`)
    check('renamed back: the rules answer again', back.status === 200, back.status)
  })

  // ── BW-32 · people per shift ───────────────────────────────────────────────
  await run('people per shift', async () => {
    const list = await call(U.reader, 'GET', `/v1/shifts?companyId=${company}`)
    check('every shift carries employeeCount', list.status === 200 && list.json.length > 0 && list.json.every((s) => Number.isInteger(s.employeeCount)), list.json?.map((s) => `${s.name}:${s.employeeCount}`).join(', '))
    const bySql = Object.fromEntries(sql(`select a.shift_policy_id||'|'||count(*) from hrms.employees e join lateral (select x.shift_policy_id from attendance.employee_shift_assignments x where x.tenant_id=e.tenant_id and x.employee_id=e.id and x.effective_from<='${today}' and (x.effective_to is null or x.effective_to>='${today}') order by x.effective_from desc, x.created_at desc limit 1) a on true where e.tenant_id='${tenant}' and e.company_id='${company}' and e.employment_status not in ('TERMINATED','RESIGNED','RETIRED','EXITED') group by 1`)
      .split('\n').filter(Boolean).map((l) => l.split('|')))
    check('the counts match the assignments in force today', (list.json || []).every((s) => s.employeeCount === Number(bySql[s.id] || 0)), JSON.stringify(bySql))
  })

  // ── BW-22 · roster day facts ───────────────────────────────────────────────
  await run('schedule day facts', async () => {
    const reader = U.reader.employeeId
    const holidayDay = plus(today, 5), leaveDay = plus(today, 6)
    const holidayId = sql(`insert into settings.holiday_calendar(id,tenant_id,company_id,year,holiday_date,holiday_name,holiday_type,is_active) values (gen_random_uuid(),'${tenant}','${company}',${holidayDay.slice(0, 4)},'${holidayDay}','QA day-facts holiday','COMPANY',true) returning id`).split('\n')[0]
    cleanup.push(() => sql(`delete from settings.holiday_calendar where id='${holidayId}'`))
    const leaveType = sql(`select id from leave_mgmt.leave_types where tenant_id='${tenant}' order by name limit 1`)
    const leaveTypeName = sql(`select name from leave_mgmt.leave_types where id='${leaveType}'`)
    const leaveId = sql(`insert into leave_mgmt.leave_requests(id,tenant_id,employee_id,leave_type_id,start_date,end_date,half_day,total_days,reason,status,duration) values (gen_random_uuid(),'${tenant}','${reader}','${leaveType}','${leaveDay}','${leaveDay}',false,0.5,'QA day-facts leave','APPROVED','HALF_DAY_MORNING') returning id`).split('\n')[0]
    cleanup.push(() => sql(`delete from leave_mgmt.leave_requests where id='${leaveId}'`))
    const r = await call(U.owner, 'GET', `/v1/team/schedule?from=${today}&to=${plus(today, 6)}`)
    const rows = r.json || []
    check('schedule answers', r.status === 200 && rows.length > 0, r.status)
    const keys = ['employeeId', 'employeeName', 'date', 'shiftName', 'startTime', 'endTime', 'shiftPolicyId', 'since', 'joinedOn', 'onLeave', 'weeklyOff', 'holidayName']
    check('every row keeps its fields and gains onLeave, weeklyOff, holidayName (nothing else)', rows.every((x) => keys.every((k) => k in x) && Object.keys(x).length === keys.length), Object.keys(rows[0] || {}).join(','))
    const ids = [...new Set(rows.map((x) => x.employeeId))]
    check('still one row per person per day', rows.length === ids.length * 7, `${rows.length} rows, ${ids.length} people`)
    check(`the holiday is on ${holidayDay} for everyone`, rows.filter((x) => day(x.date) === holidayDay).every((x) => (x.holidayName || '').includes('QA day-facts holiday')), '')
    const lv = rows.find((x) => x.employeeId === reader && day(x.date) === leaveDay)?.onLeave
    check(`the reader's approved half-day leave on ${leaveDay}`, lv?.leaveTypeName === leaveTypeName && lv?.duration === 'HALF_DAY_MORNING' && lv?.halfDay === true, JSON.stringify(lv))
    check('no leave shown on the other days', rows.filter((x) => x.employeeId === reader && day(x.date) !== leaveDay).every((x) => x.onLeave === null))
    // Weekly offs: their own days, else their shift's that day, else the company's, else Sat+Sun.
    const offRow = sql(`select coalesce(e.weekly_off_days,'')||'|'||coalesce(array_to_string(hc.weekend_days,','),'') from hrms.employees e left join settings.hr_configuration hc on hc.company_id=e.company_id and hc.tenant_id=e.tenant_id where e.id='${reader}'`)
    const [own, co] = offRow.split('|')
    const readerRows = rows.filter((x) => x.employeeId === reader)
    const shiftOffs = (sid) => sid ? sql(`select coalesce(weekly_off_days,'') from attendance.shift_policies where id='${sid}' and is_active`) : ''
    const expectOff = (x) => { const pick = own || shiftOffs(x.shiftPolicyId) || co || '6,7'; return pick.split(',').map(Number).includes(isoDow(day(x.date))) }
    check('weeklyOff follows the weekly-off rule for each day', readerRows.length === 7 && readerRows.every((x) => x.weeklyOff === expectOff(x)), readerRows.map((x) => `${day(x.date)}:${x.weeklyOff}`).join(' '))
    for (const u of roles) {
      const s = await call(u, 'GET', `/v1/team/schedule?from=${today}&to=${today}`)
      check(`${u.name}: schedule → ${expectStatus(u, can(u, 'attendance.team.read'))}`, s.status === expectStatus(u, can(u, 'attendance.team.read')), s.status)
    }
  })

  // ── BW-20 / BW-21 · analytics ──────────────────────────────────────────────
  await run('analytics', async () => {
    const from = `${today.slice(0, 8)}01`
    const scopeOf = async (u) => new Set(((await call(u, 'GET', `/v1/team/schedule?from=${today}&to=${today}`)).json || []).map((x) => x.employeeId))
    for (const u of roles) {
      const allowed = can(u, 'attendance.team.read')
      const b = await call(u, 'GET', `/v1/attendance/dashboard/breakdown?from=${from}&to=${today}&by=department`)
      const p = await call(u, 'GET', `/v1/attendance/punctuality?from=${from}&to=${today}`)
      check(`${u.name}: breakdown → ${expectStatus(u, allowed)}, punctuality → ${expectStatus(u, allowed)}`, b.status === expectStatus(u, allowed) && p.status === expectStatus(u, allowed), `${b.status} / ${p.status}`)
      if (!allowed) continue
      const team = await scopeOf(u)
      check(`${u.name}: the breakdown covers exactly their team (${team.size} people)`, b.json.people === team.size && b.json.groups.reduce((n, g) => n + g.people, 0) === team.size, `${b.json.people}`)
      check(`${u.name}: punctuality lists only their team`, p.json.rows.every((r) => team.has(r.employeeId)), p.json.rows.length)
    }
    const b = (await call(U.owner, 'GET', `/v1/attendance/dashboard/breakdown?from=${from}&to=${today}&by=branch`)).json
    check('by branch: the comparison period is the same days of last month', b?.by === 'branch' && b?.previousFrom === `${plus(from, -1).slice(0, 8)}01`
      && typeof b?.overall?.workingDays === 'number' && 'ratePct' in b.overall && 'avgArrivalMinutes' in b.overall, JSON.stringify(b?.overall))
    const s = b.overall
    check('the overall numbers add up', s.workingDays === s.attendedDays + s.leaveDays + s.absentDays + s.notMarkedDays && s.lateDays <= s.attendedDays, JSON.stringify(s))
    const badBy = await call(U.owner, 'GET', `/v1/attendance/dashboard/breakdown?from=${from}&to=${today}&by=manager`)
    check('grouping by anything else is refused (422 BREAKDOWN_GROUP_INVALID)', badBy.status === 422 && badBy.json?.errorCode === 'BREAKDOWN_GROUP_INVALID', badBy.status)
    const tooLong = await call(U.owner, 'GET', `/v1/attendance/punctuality?from=${plus(today, -80)}&to=${today}`)
    check('more than 62 days is refused (422 PUNCTUALITY_RANGE_INVALID)', tooLong.status === 422 && tooLong.json?.errorCode === 'PUNCTUALITY_RANGE_INVALID', tooLong.status)
    // Punctuality agrees with the company late-marks report (same effective LATE days) for everyone it lists.
    if (can(U.owner, 'hrms.report.attendance')) {
      const p = (await call(U.owner, 'GET', `/v1/attendance/punctuality?from=${from}&to=${today}`)).json
      const report = (await call(U.owner, 'GET', `/v1/reports/late-marks?companyId=${company}&from=${from}&to=${today}`)).json || []
      const codes = Object.fromEntries(sql(`select id||'|'||employee_code from hrms.employees where tenant_id='${tenant}'`).split('\n').map((l) => l.split('|')))
      const mismatch = p.rows.filter((r) => report.filter((x) => x.employee_code === codes[r.employeeId]).length !== r.lateDays)
      check('punctuality late days match the late-marks report', mismatch.length === 0, `${p.rows.length} people, ${p.totals.lateDays} late days${mismatch.length ? ' — mismatch ' + mismatch.map((m) => m.employeeName).join(', ') : ''}`)
    }
  })
} finally {
  for (const fn of cleanup.reverse()) { try { fn() } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) } }
  const left = sql(`select (select count(*) from attendance.records where remarks='QA P-ATT-PLAN overtime fixture')
    + (select count(*) from attendance.shift_change_requests where created_at >= '${testStart}')
    + (select count(*) from attendance.employee_shift_assignments where created_at >= '${testStart}')
    + (select count(*) from settings.holiday_calendar where holiday_name='QA day-facts holiday')
    + (select count(*) from leave_mgmt.leave_requests where reason='QA day-facts leave')
    + (select count(*) from audit.events where action='OVERTIME_RULES_UPDATED' and occurred_at >= '${testStart}')`)
  check('cleanup: nothing the test made is left', left === '0', `${left} left`)
  const cols = sql(`select count(*) from pg_attribute where attrelid='attendance.shift_change_requests'::regclass and attname='requested_end_date' and not attisdropped`)
  check('cleanup: the column and table have their names back', cols === '1' && sql(`select to_regclass('attendance.overtime_rules') is not null`) === 't')
  check('no unexpected FEATURE_NOT_READY or 5xx', unexpected.length === 0, unexpected.join(' | '))
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-rd-p-att-plan-api.json', JSON.stringify({ ranAt: new Date().toISOString(), db: DB, checks }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
