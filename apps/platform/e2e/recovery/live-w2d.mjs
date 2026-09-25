// Live API check of w2d (V143.23): leave accrual, year-end carry forward and
// encashment; shift code, core hours and weekly offs per shift; policy delete,
// reminders, email on publish and optional acknowledgement. No browser.
//
// Needs the local recovery backend on RECOVERY_API_URL with V143_23 applied to
// the local database (unifiedtree_recovery on 55432) and the backend restarted
// afterwards (new columns, and the new permissions in fresh tokens).
// Everything the test creates is removed at the end.
//
//   node e2e/recovery/live-w2d.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333'
const psql = `${process.env.LOCALAPPDATA}/UnifiedTreeRecovery/pgsql/bin/psql.exe`
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const num = (q) => Number(sql(q) || 0)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

// Today in India (the server's business date), and the ISO weekday.
const ist = new Date(Date.now() + 5.5 * 3600e3)
const today = ist.toISOString().slice(0, 10)
const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7))
const isoDow = ((ist.getUTCDay() + 6) % 7) + 1
const stamp = Date.now()
const made = { leaveType: null, encash: [], shift: null, assignment: null, policies: [] }

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')

  // ── permissions ──────────────────────────────────────────────────────────
  for (const code of ['hrms.leave.encash.approve', 'hrms.leave.yearend.run']) {
    const roles = sql(`select string_agg(r.code, ',' order by r.code) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id where r.tenant_id is null and rp.permission_code = '${code}'`)
    check(`perm ${code}: OWNER, SUPER_ADMIN, ADMIN and HR_MANAGER hold it, with a description`, roles === 'ADMIN,HR_MANAGER,OWNER,SUPER_ADMIN' && sql(`select length(description) > 40 from rbac.permissions where code = '${code}'`) === 't', roles)
  }
  check('HR token carries both new permissions', hrm.perms.includes('hrms.leave.encash.approve') && hrm.perms.includes('hrms.leave.yearend.run'))

  // ── leave type: accrual frequency + encashment in the API ────────────────
  const typeBody = { name: `QA w2d Monthly ${stamp}`, code: `QW${String(stamp).slice(-6)}`, category: 'EARNED', annualEntitlement: 12, maxConsecutiveDays: 0, minNoticeDays: 0, isCarryForwardAllowed: true, maxCarryForwardDays: 5, isPaidLeave: true, accrualFrequency: 'MONTHLY', isEncashable: true, maxEncashDays: 3 }
  const lt = await hrm.call(`/v1/leave/types?companyId=${company}`, 'POST', typeBody)
  made.leaveType = lt.json?.id
  check('leave type: created with monthly accrual and encashment', lt.status === 201 && lt.json?.accrualFrequency === 'MONTHLY' && lt.json?.isEncashable === true && lt.json?.maxEncashDays === 3, `status=${lt.status}`)
  check('leave type: stored in the database', sql(`select accrual_frequency || '|' || is_encashable || '|' || max_encash_days from leave_mgmt.leave_types where id = '${made.leaveType}'`) === 'MONTHLY|t|3')
  const deny = await reader.call(`/v1/leave/types?companyId=${company}`, 'POST', { ...typeBody, code: `QX${String(stamp).slice(-6)}` })
  check('leave type: an employee cannot create one (403)', deny.status === 403, `status=${deny.status}`)
  const { accrualFrequency, isEncashable, maxEncashDays, ...oldShape } = typeBody
  const kept = await hrm.call(`/v1/leave/types/${made.leaveType}`, 'PUT', { ...oldShape, name: `QA w2d Monthly ${stamp} v2` })
  check('leave type: an old-shape PUT keeps accrual and encashment', kept.status === 200 && sql(`select accrual_frequency || '|' || is_encashable || '|' || max_encash_days from leave_mgmt.leave_types where id = '${made.leaveType}'`) === 'MONTHLY|t|3', `status=${kept.status}`)

  // ── accrual ──────────────────────────────────────────────────────────────
  const run1 = await hrm.call(`/v1/leave/accrual/run?leaveTypeId=${made.leaveType}`, 'POST')
  const readerTotal = Number(sql(`select total_entitlement from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`))
  check('accrual: HR runs it and the reader is credited 1 day for each month so far', run1.status === 200 && Math.abs(readerTotal - month) < 0.01, `status=${run1.status} total=${readerTotal} month=${month}`)
  const period = `${year}-${String(month).padStart(2, '0')}`
  check('accrual: the credit is on the ledger for this month', num(`select count(*) from leave_mgmt.leave_balance_ledger where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and kind = 'ACCRUAL' and period = '${period}'`) === 1)
  const ledgerRows = num(`select count(*) from leave_mgmt.leave_balance_ledger where leave_type_id = '${made.leaveType}'`)
  const run2 = await hrm.call(`/v1/leave/accrual/run?leaveTypeId=${made.leaveType}`, 'POST')
  check('accrual: running it again credits nothing (idempotent)', run2.status === 200 && run2.json?.balancesCredited === 0 && num(`select count(*) from leave_mgmt.leave_balance_ledger where leave_type_id = '${made.leaveType}'`) === ledgerRows, JSON.stringify(run2.json))
  for (const [who, u] of [['employee', reader], ['manager', mgr]]) {
    const r = await u.call(`/v1/leave/accrual/run?leaveTypeId=${made.leaveType}`, 'POST')
    check(`accrual: a ${who} cannot run it (403)`, r.status === 403, `status=${r.status}`)
  }
  const myLedger = await reader.call('/v1/leave/my/ledger')
  check('ledger: the employee sees their own credit', myLedger.status === 200 && (myLedger.json || []).some((l) => l.leaveTypeId === made.leaveType && l.kind === 'ACCRUAL'), `status=${myLedger.status}`)
  const hrLedger = await hrm.call(`/v1/leave/ledger?leaveTypeId=${made.leaveType}`)
  check('ledger: HR sees everyone’s credits', hrLedger.status === 200 && (hrLedger.json || []).length === ledgerRows, `status=${hrLedger.status} rows=${hrLedger.json?.length}`)
  const readerLedger = await reader.call('/v1/leave/ledger')
  check('ledger: an employee cannot read everyone’s (403)', readerLedger.status === 403, `status=${readerLedger.status}`)

  // ── encashment ───────────────────────────────────────────────────────────
  const opts = await reader.call('/v1/leave/encashments/my/options')
  const opt = (opts.json || []).find((o) => o.leaveTypeId === made.leaveType)
  check('encash: the employee’s options show the type, capped at 3 a year', opts.status === 200 && opt && opt.maxPerYear === 3 && opt.canRequest === Math.min(3, Math.floor(opt.available * 2) / 2), JSON.stringify(opt))
  const over = await reader.call('/v1/leave/encashments', 'POST', { leaveTypeId: made.leaveType, days: 4, reason: 'QA w2d' })
  check('encash: more than the yearly limit or the balance is refused (422)', over.status === 422, `status=${over.status} ${over.json?.message || ''}`)
  const half = await reader.call('/v1/leave/encashments', 'POST', { leaveTypeId: made.leaveType, days: 1.3 })
  check('encash: only whole or half days (422)', half.status === 422, `status=${half.status}`)
  const e1 = await reader.call('/v1/leave/encashments', 'POST', { leaveTypeId: made.leaveType, days: 1.5, reason: 'QA w2d encash' })
  if (e1.json?.id) made.encash.push(e1.json.id)
  check('encash: the employee asks for 1.5 days (PENDING, held as pending)', e1.status === 201 && e1.json?.status === 'PENDING' && Number(sql(`select pending from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`)) === 1.5, `status=${e1.status}`)
  const selfDecide = await reader.call(`/v1/leave/encashments/${e1.json?.id}/decision`, 'POST', { approved: true })
  check('encash: an employee cannot decide (403)', selfDecide.status === 403, `status=${selfDecide.status}`)
  const mgrList = await mgr.call('/v1/leave/encashments?status=PENDING')
  check('encash: a manager cannot see HR’s queue (403)', mgrList.status === 403, `status=${mgrList.status}`)
  const queue = await hrm.call('/v1/leave/encashments?status=PENDING')
  check('encash: HR’s queue has it', queue.status === 200 && (queue.json || []).some((r) => r.id === e1.json?.id && r.employeeName), `status=${queue.status}`)
  const ok = await hrm.call(`/v1/leave/encashments/${e1.json?.id}/decision`, 'POST', { approved: true, note: 'QA approve' })
  const bal = sql(`select pending || '|' || used from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`)
  check('encash: HR approves; the days move from pending to used', ok.status === 200 && ok.json?.status === 'APPROVED' && bal === '0|1.5', `status=${ok.status} pending|used=${bal}`)
  check('encash: the approval is on the ledger', num(`select count(*) from leave_mgmt.leave_balance_ledger where kind = 'ENCASHMENT' and source_id = '${e1.json?.id}'`) === 1)
  const payable = await fin.call(`/v1/leave/encashments/payable?employeeIds=${READER}`)
  check('encash: payroll sees it as payable', payable.status === 200 && (payable.json || []).some((p) => p.id === e1.json?.id), `status=${payable.status}`)
  const payDeny = await reader.call(`/v1/leave/encashments/payable?employeeIds=${READER}`)
  check('encash: an employee cannot read the payable list (403)', payDeny.status === 403, `status=${payDeny.status}`)
  const e2 = await reader.call('/v1/leave/encashments', 'POST', { leaveTypeId: made.leaveType, days: 1 })
  if (e2.json?.id) made.encash.push(e2.json.id)
  const c2 = await reader.call(`/v1/leave/encashments/${e2.json?.id}/cancel`, 'POST')
  check('encash: the employee cancels a pending request; the days come back', c2.status === 200 && c2.json?.status === 'CANCELLED' && Number(sql(`select pending from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`)) === 0, `status=${c2.status}`)
  const e3 = await hrm.call(`/v1/leave/encashments/for/${READER}`, 'POST', { leaveTypeId: made.leaveType, days: 0.5, reason: 'QA raised by HR' })
  if (e3.json?.id) made.encash.push(e3.json.id)
  check('encash: HR raises one for the employee', e3.status === 201 && e3.json?.raisedByHr === true && sql(`select raised_by_hr from leave_mgmt.leave_encashment_requests where id = '${e3.json?.id}'`) === 't', `status=${e3.status}`)
  const rej = await hrm.call(`/v1/leave/encashments/${e3.json?.id}/decision`, 'POST', { approved: false, note: 'QA reject' })
  check('encash: HR rejects; the days come back', rej.status === 200 && rej.json?.status === 'REJECTED' && Number(sql(`select pending from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`)) === 0, `status=${rej.status}`)
  const raiseDeny = await reader.call(`/v1/leave/encashments/for/${HRM}`, 'POST', { leaveTypeId: made.leaveType, days: 0.5 })
  check('encash: an employee cannot raise one for someone else (403)', raiseDeny.status === 403, `status=${raiseDeny.status}`)
  const own = await hrm.call('/v1/leave/encashments', 'POST', { leaveTypeId: made.leaveType, days: 0.5 })
  if (own.json?.id) made.encash.push(own.json.id)
  const ownDecide = await hrm.call(`/v1/leave/encashments/${own.json?.id}/decision`, 'POST', { approved: true })
  check('encash: HR cannot approve their own request (403)', own.status === 201 && ownDecide.status === 403, `create=${own.status} decide=${ownDecide.status}`)
  await hrm.call(`/v1/leave/encashments/${own.json?.id}/cancel`, 'POST')

  // ── year-end carry forward ───────────────────────────────────────────────
  const last = year - 1
  sql(`insert into leave_mgmt.leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_entitlement, used, pending, carry_forward, created_at, updated_at, created_by, updated_by, version)
       values (gen_random_uuid(), '${tenant}', '${READER}', '${made.leaveType}', ${last}, 12, 2, 0, 0, now(), now(), 'qa-w2d', 'qa-w2d', 0) on conflict do nothing`)
  const prev = await hrm.call(`/v1/leave/year-end/preview?fromYear=${last}&leaveTypeId=${made.leaveType}`)
  const line = (prev.json?.lines || []).find((l) => l.employeeId === READER)
  check('carry forward: the preview carries 5 (the cap) and lapses 5 of 10 unused', prev.status === 200 && line && line.unused === 10 && line.carried === 5 && line.lapsed === 5 && !line.done, JSON.stringify(line))
  const cf = await hrm.call(`/v1/leave/year-end/carry-forward?fromYear=${last}&leaveTypeId=${made.leaveType}`, 'POST')
  check('carry forward: run moves 5 days into this year', cf.status === 200 && cf.json?.processed === 1 && Number(sql(`select carry_forward from leave_mgmt.leave_balances where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and year = ${year}`)) === 5, `status=${cf.status} ${JSON.stringify(cf.json)}`)
  check('carry forward: carried and lapsed days are on the ledger', num(`select count(*) from leave_mgmt.leave_balance_ledger where employee_id = '${READER}' and leave_type_id = '${made.leaveType}' and period = 'YE-${last}' and ((kind = 'CARRY_FORWARD' and days = 5 and year = ${year}) or (kind = 'LAPSE' and days = 5 and year = ${last}))`) === 2)
  const cf2 = await hrm.call(`/v1/leave/year-end/carry-forward?fromYear=${last}&leaveTypeId=${made.leaveType}`, 'POST')
  check('carry forward: running it again changes nothing', cf2.status === 200 && cf2.json?.processed === 0 && cf2.json?.skippedAlreadyDone === 1, JSON.stringify(cf2.json))
  const notEnded = await hrm.call(`/v1/leave/year-end/preview?fromYear=${year}`)
  check('carry forward: the current year is refused until it ends (422)', notEnded.status === 422, `status=${notEnded.status}`)
  const cfDeny = await reader.call(`/v1/leave/year-end/carry-forward?fromYear=${last}&leaveTypeId=${made.leaveType}`, 'POST')
  check('carry forward: an employee cannot run it (403)', cfDeny.status === 403, `status=${cfDeny.status}`)

  // ── shift rules ──────────────────────────────────────────────────────────
  const code = `QW${String(stamp).slice(-6)}`
  const other = (isoDow % 7) + 1
  const shiftBody = { name: `QA w2d Flexi ${stamp}`, shiftType: 'FLEXIBLE', startTime: '08:00', endTime: '20:00', gracePeriodMinutes: 0, workingHoursPerDay: 8, overtimeApplicable: false, code: code.toLowerCase(), coreStartTime: '11:00', coreEndTime: '16:00', weeklyOffDays: [isoDow] }
  const sh = await hrm.call(`/v1/shifts?companyId=${company}`, 'POST', shiftBody)
  made.shift = sh.json?.id
  check('shift: created with code, core hours and weekly offs', sh.status === 201 && sh.json?.code === code && sh.json?.coreStartTime?.startsWith('11:00') && JSON.stringify(sh.json?.weeklyOffDays) === JSON.stringify([isoDow]), `status=${sh.status}`)
  check('shift: stored in the database', sql(`select code || '|' || core_start_time || '|' || core_end_time || '|' || weekly_off_days from attendance.shift_policies where id = '${made.shift}'`) === `${code}|11:00:00|16:00:00|${isoDow}`)
  const dupe = await hrm.call(`/v1/shifts?companyId=${company}`, 'POST', { ...shiftBody, name: `QA w2d dupe ${stamp}` })
  if (dupe.json?.id) sql(`delete from attendance.shift_policies where id = '${dupe.json.id}'`)
  check('shift: a code another active shift uses is refused (409)', dupe.status === 409, `status=${dupe.status}`)
  const outside = await hrm.call(`/v1/shifts?companyId=${company}`, 'POST', { ...shiftBody, code: '', name: `QA w2d outside ${stamp}`, coreStartTime: '07:00' })
  if (outside.json?.id) sql(`delete from attendance.shift_policies where id = '${outside.json.id}'`)
  check('shift: core hours outside the shift are refused (422)', outside.status === 422, `status=${outside.status}`)
  const keep = await hrm.call(`/v1/shifts/${made.shift}`, 'PUT', { name: `QA w2d Flexi ${stamp} v2`, gracePeriodMinutes: 0 })
  check('shift: an old-shape PUT keeps code, core hours and weekly offs', keep.status === 200 && sql(`select code || '|' || core_start_time || '|' || weekly_off_days from attendance.shift_policies where id = '${made.shift}'`) === `${code}|11:00:00|${isoDow}`, `status=${keep.status}`)
  const shDeny = await reader.call(`/v1/shifts?companyId=${company}`, 'POST', { ...shiftBody, code: '', name: 'QA w2d denied' })
  check('shift: an employee cannot create one (403)', shDeny.status === 403, `status=${shDeny.status}`)
  // Weekly offs per shift are used for someone with none of their own.
  const noOwn = sql(`select id from hrms.employees where tenant_id = '${tenant}' and is_active and employment_status = 'ACTIVE' and coalesce(weekly_off_days, '') = '' and date_of_joining <= '${today}' limit 1`)
  if (noOwn) {
    made.assignment = sql(`insert into attendance.employee_shift_assignments (id, tenant_id, employee_id, shift_policy_id, effective_from, effective_to, created_at, updated_at, created_by, updated_by, version)
      values (gen_random_uuid(), '${tenant}', '${noOwn}', '${made.shift}', '${today}', '${today}', now(), now(), 'qa-w2d', 'qa-w2d', 0) returning id`).split(/\s/)[0]
    const d1 = await owner.call(`/v1/attendance/dashboard?date=${today}`)
    const in1 = (d1.json?.staffStatuses || []).some((s) => s.employeeId === noOwn)
    await hrm.call(`/v1/shifts/${made.shift}`, 'PUT', { name: `QA w2d Flexi ${stamp} v2`, weeklyOffDays: [other] })
    const d2 = await owner.call(`/v1/attendance/dashboard?date=${today}`)
    const in2 = (d2.json?.staffStatuses || []).some((s) => s.employeeId === noOwn)
    check('shift: attendance uses the shift’s weekly off for someone with none of their own', d1.status === 200 && !in1 && in2, `off today: listed=${in1}; off another day: listed=${in2}`)
  } else console.log('SKIP  shift weekly offs in attendance — no active employee without weekly offs of their own')

  // ── policies ─────────────────────────────────────────────────────────────
  const live = num(`select count(*) from hrms.employees where tenant_id = '${tenant}' and is_active and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD')`)
  const draft = await hrm.call(`/v1/policy/policies?companyId=${company}`, 'POST', { title: `QA w2d draft ${stamp}`, category: 'Workplace', content: 'QA', version: 'v1', status: 'DRAFT', acknowledgementRequired: true, notifyOnPublish: true, autoRemindAfterDays: 7 })
  if (draft.json?.id) made.policies.push(draft.json.id)
  check('policy: a draft stores acknowledgement, email and reminder settings', draft.status === 201 && sql(`select acknowledgement_required || '|' || notify_on_publish || '|' || auto_remind_after_days from policy_mgmt.hr_policies where id = '${draft.json?.id}'`) === 't|t|7', `status=${draft.status}`)
  const delDeny = await reader.call(`/v1/policy/policies/${draft.json?.id}`, 'DELETE')
  check('policy: an employee cannot delete (403)', delDeny.status === 403, `status=${delDeny.status}`)
  const del = await hrm.call(`/v1/policy/policies/${draft.json?.id}`, 'DELETE')
  check('policy: deleting a draft removes it for good', del.status === 200 && del.json?.outcome === 'DELETED' && num(`select count(*) from policy_mgmt.hr_policies where id = '${draft.json?.id}'`) === 0, `status=${del.status}`)

  const p2 = await hrm.call(`/v1/policy/policies?companyId=${company}`, 'POST', { title: `QA w2d publish ${stamp}`, category: 'Workplace', content: 'QA', version: 'v1', status: 'DRAFT', notifyOnPublish: true })
  if (p2.json?.id) made.policies.push(p2.json.id)
  const pub = await hrm.call(`/v1/policy/policies/${p2.json?.id}/publish`, 'POST')
  check('policy: publishing stamps published_at', pub.status === 200 && sql(`select published_at is not null from policy_mgmt.hr_policies where id = '${p2.json?.id}'`) === 't', `status=${pub.status}`)
  check('policy: "email everyone" queues one notice per person', num(`select count(*) from policy_mgmt.policy_notices where policy_id = '${p2.json?.id}' and kind = 'PUBLISHED'`) === live, `live=${live}`)
  let inApp = 0
  for (let i = 0; i < 20 && inApp === 0; i++) { await sleep(500); inApp = num(`select count(*) from notif.notifications where data->>'policyId' = '${p2.json?.id}'`) }
  check('policy: the notices are sent (in-app, and email where configured)', inApp > 0 && num(`select count(*) from policy_mgmt.policy_notices where policy_id = '${p2.json?.id}' and attempts > 0`) > 0, `in-app=${inApp}`)
  const again = await hrm.call(`/v1/policy/policies/${p2.json?.id}/publish`, 'POST')
  check('policy: publishing again sends nothing twice', again.status === 200 && num(`select count(*) from policy_mgmt.policy_notices where policy_id = '${p2.json?.id}' and kind = 'PUBLISHED'`) === live)
  const ack = await reader.call(`/v1/policy/policies/${p2.json?.id}/acknowledge`, 'POST')
  const rem = await hrm.call(`/v1/policy/policies/${p2.json?.id}/remind`, 'POST')
  check('policy: Remind reaches everyone who hasn’t acknowledged', ack.status === 204 && rem.status === 200 && rem.json?.reminded === live - 1 && num(`select count(*) from policy_mgmt.policy_notices where policy_id = '${p2.json?.id}' and kind = 'REMINDER' and employee_id = '${READER}'`) === 0, `status=${rem.status} ${JSON.stringify(rem.json)}`)
  const rem2 = await hrm.call(`/v1/policy/policies/${p2.json?.id}/remind`, 'POST')
  check('policy: nobody is reminded twice within 24 hours', rem2.status === 200 && rem2.json?.reminded === 0 && rem2.json?.skippedRecentlyReminded === live - 1, JSON.stringify(rem2.json))
  const remDeny = await reader.call(`/v1/policy/policies/${p2.json?.id}/remind`, 'POST')
  check('policy: an employee cannot send reminders (403)', remDeny.status === 403, `status=${remDeny.status}`)
  const kept2 = await hrm.call(`/v1/policy/policies/${p2.json?.id}`, 'PUT', { title: `QA w2d publish ${stamp}`, category: 'Workplace', content: 'QA 2', version: 'v1' })
  check('policy: an old-shape PUT keeps the settings', kept2.status === 200 && sql(`select notify_on_publish || '|' || acknowledgement_required from policy_mgmt.hr_policies where id = '${p2.json?.id}'`) === 't|t', `status=${kept2.status}`)
  const arch = await hrm.call(`/v1/policy/policies/${p2.json?.id}`, 'DELETE')
  check('policy: deleting a published policy archives it instead', arch.status === 200 && arch.json?.outcome === 'ARCHIVED' && sql(`select status from policy_mgmt.hr_policies where id = '${p2.json?.id}'`) === 'ARCHIVED', `status=${arch.status}`)

  const p3 = await hrm.call(`/v1/policy/policies?companyId=${company}`, 'POST', { title: `QA w2d read only ${stamp}`, category: 'Workplace', content: 'QA', version: 'v1', status: 'ACTIVE', acknowledgementRequired: false })
  if (p3.json?.id) made.policies.push(p3.json.id)
  check('policy: one can be published for reading only', p3.status === 201 && p3.json?.acknowledgementRequired === false && num(`select count(*) from policy_mgmt.policy_notices where policy_id = '${p3.json?.id}'`) === 0, `status=${p3.status}`)
  const rem3 = await hrm.call(`/v1/policy/policies/${p3.json?.id}/remind`, 'POST')
  check('policy: a read-only policy has no reminders (422)', rem3.status === 422, `status=${rem3.status}`)
  const listed = await reader.call('/v1/policy/policies?status=ACTIVE&size=200')
  check('policy: employees see whether acknowledgement is asked', listed.status === 200 && (listed.json?.content || []).some((p) => p.id === p3.json?.id && p.acknowledgementRequired === false))
} catch (e) {
  check('run finished without an exception', false, e.stack || String(e))
} finally {
  // ── clean up everything created ──────────────────────────────────────────
  try {
    const ids = made.encash.map((id) => `'${id}'`).join(',')
    if (ids) sql(`delete from notif.notifications where data->>'encashmentId' in (${made.encash.map((id) => `'${id}'`).join(',')})`)
    if (made.leaveType) {
      sql(`delete from leave_mgmt.leave_balance_ledger where leave_type_id = '${made.leaveType}'`)
      sql(`delete from leave_mgmt.leave_encashment_requests where leave_type_id = '${made.leaveType}'`)
      sql(`delete from leave_mgmt.leave_balances where leave_type_id = '${made.leaveType}'`)
      sql(`delete from leave_mgmt.leave_types where id = '${made.leaveType}'`)
    }
    if (made.assignment) sql(`delete from attendance.employee_shift_assignments where id = '${made.assignment}'`)
    if (made.shift) {
      sql(`delete from attendance.employee_shift_assignments where shift_policy_id = '${made.shift}' and created_by = 'qa-w2d'`)
      sql(`delete from attendance.shift_policies where id = '${made.shift}'`)
    }
    for (const id of made.policies) {
      sql(`delete from notif.notifications where data->>'policyId' = '${id}'`)
      sql(`delete from policy_mgmt.hr_policies where id = '${id}'`)
    }
    const left = num(`select (select count(*) from leave_mgmt.leave_types where name like 'QA w2d%') + (select count(*) from attendance.shift_policies where name like 'QA w2d%') + (select count(*) from policy_mgmt.hr_policies where title like 'QA w2d%')`)
    check('cleanup: nothing the test created is left', left === 0, `left=${left}`)
  } catch (e) {
    check('cleanup finished', false, String(e))
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
