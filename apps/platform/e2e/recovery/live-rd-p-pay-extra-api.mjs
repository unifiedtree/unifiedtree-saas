// API-level live check of P-PAY-EXTRA's backend half (redesign BW-62 … BW-64),
// against a running server and its database:
//   · advances: a DISPOSABLE employee (made here, reporting to mgr@) sees who
//     approves, previews the plan, asks, mgr@ approves, fin@ records the payout
//     with a bank reference and a later first month; the schedule, ledger labels,
//     recovery summary and personal totals follow; the employee reads their own
//     advance and nobody without the right reads it; the company totals and the
//     Recovering / Repaid / department filters match the database in each scope
//   · PLI: company and personal totals, the status filter, department on awards
//   · F&F: the status of each leaver's latest settlement (the literal path no
//     longer falls into /settlements/{id}), the ledger's totals, the status and
//     employee filters, department and employment status on settlements
//   · every read per role (owner, hrm, fin, mgr, reader), and the 403s
// READ-ONLY on everything seeded. No payroll run is processed, locked or paid.
// Everything it creates is removed at the end (the person, their login, the
// advance with its schedule and ledger, notifications and audit rows).
// No FEATURE_NOT_READY step: this package adds no table or column.
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-pay-extra-api.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB, RECOVERY_PASSWORD
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const MGR = '44444444-4444-4444-4444-444444444444'
const HRM = '33333333-3333-3333-3333-333333333333'
const READER = '22222222-2222-2222-2222-222222222222'
if (db === 'ut_w3_base') throw new Error('never run against the clean base copy')

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ── months (India) ──────────────────────────────────────────────────────────
const istNow = new Date(Date.now() + 5.5 * 3600e3)
const ym = (plus) => { const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + plus, 1)); return d.toISOString().slice(0, 7) }
const fyStartMonth = { JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 }
function fyOf(employeeId) {
  const stored = sql(`select coalesce(c.fiscal_year_start,'') from hrms.employees e left join org.companies c on c.id=e.company_id where e.id='${employeeId}'`)
  const m = fyStartMonth[(stored || '').toUpperCase()] || 4
  const y = istNow.getUTCMonth() + 1 >= m ? istNow.getUTCFullYear() : istNow.getUTCFullYear() - 1
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const endY = new Date(Date.UTC(y + 1, m - 1, 1))
  return { start, next: endY.toISOString().slice(0, 10) }
}
const monthName = (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]

// ── sessions ────────────────────────────────────────────────────────────────
const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500) surprises.push(`${email} ${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    if (json?.errorCode === 'FEATURE_NOT_READY') surprises.push(`${email} ${method} ${path} → FEATURE_NOT_READY`)
    return { status: res.status, json }
  }
  return { email, call, employeeId: d.employeeId }
}

// ── the disposable employee (with a login, reporting to mgr@) ──────────────
const A = randomUUID(), UA = randomUUID()
const aEmail = `qa-pay-extra-${A.slice(0, 8)}@example.invalid`
const stamp = Date.now()
let advanceId = null

function cleanup() {
  const run = (label, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${label}: ${String(e.message).split('\n')[0]}`) } }
  const ids = [A, UA, advanceId].filter(Boolean)
  const pattern = ids.join('|')
  run('notifications', `DELETE FROM notif.notifications WHERE user_id IN ('${A}','${UA}') OR data::text ~ '${pattern}'`)
  run('audit', `DELETE FROM audit.events WHERE tenant_id='${tenant}' AND (entity_id IN (${ids.map((x) => `'${x}'`).join(',')}) OR summary ~ '${A}' OR summary ~ 'QA Pay Extra')`)
  run('advance', `BEGIN;
    DELETE FROM advance_mgmt.advance_recovery_schedule WHERE advance_request_id IN (SELECT id FROM advance_mgmt.advance_requests WHERE employee_id='${A}');
    DELETE FROM advance_mgmt.advance_ledger_entries WHERE advance_request_id IN (SELECT id FROM advance_mgmt.advance_requests WHERE employee_id='${A}');
    DELETE FROM advance_mgmt.advance_requests WHERE employee_id='${A}';
    COMMIT;`)
  for (const t of sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.column_name='user_id' and t.table_type='BASE TABLE' and c.table_schema='auth'`).split('\n').filter(Boolean)) {
    run(t, `DELETE FROM ${t} WHERE user_id='${UA}'`)
  }
  run('people', `BEGIN; DELETE FROM rbac.user_roles WHERE user_id='${UA}'; DELETE FROM auth.user_credentials WHERE id='${UA}';
    DELETE FROM hrms.employee_status_history WHERE employee_id='${A}'; DELETE FROM hrms.employees WHERE id='${A}'; COMMIT;`)
  const tables = sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.column_name='employee_id' and t.table_type='BASE TABLE' and c.table_schema in ('advance_mgmt','hrms','notif','auth','leave_mgmt','attendance','payroll')
      and c.table_name not like '%\\_20%' and c.table_name not like '%\\_default'`).split('\n').filter(Boolean)
  const left = tables.map((t) => [t, num(`select count(*) from ${t} where employee_id='${A}'`)]).filter(([, n]) => n > 0)
  const leftOther = num(`select count(*) from hrms.employees where id='${A}'`) + num(`select count(*) from auth.user_credentials where id='${UA}'`)
    + num(`select count(*) from notif.notifications where data::text ~ '${pattern}'`)
    + (advanceId ? num(`select count(*) from advance_mgmt.advance_requests where id='${advanceId}'`) : 0)
  check('cleanup: nothing the test made is left behind', left.length === 0 && leftOther === 0, JSON.stringify(left) + ` other=${leftOther}`)
}

async function main() {
  const owner = await session('owner@unifiedtree.demo')
  const hrm = await session('hrm@unifiedtree.demo')
  const fin = await session('fin@unifiedtree.demo')
  const mgr = await session('mgr@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')
  const everyone = { owner, hrm, fin, mgr, reader }
  const FIN = fin.employeeId || '55555555-5555-5555-5555-555555555555'

  // ═══ F&F (BW-64) ════════════════════════════════════════════════════════
  const leavers = sql(`select employee_id from fnf_mgmt.fnf_settlements where tenant_id='${tenant}' group by employee_id order by employee_id limit 2`).split('\n').filter(Boolean)
  check('fixtures: two people with settlements', leavers.length === 2)
  const asked = [leavers[0], READER, leavers[1]]
  const st = await owner.call(`/v1/fnf/settlements/status?employeeIds=${asked.join(',')}`)
  check('F&F status: the literal path answers 200 with one row per id', st.status === 200 && Array.isArray(st.json) && st.json.length === 3, `${st.status} ${JSON.stringify(st.json).slice(0, 200)}`)
  let stOk = true, stDetail = ''
  for (const [i, id] of asked.entries()) {
    const row = (st.json || [])[i] || {}
    const want = sql(`select id||'|'||status||'|'||last_working_day||'|'||net_settlement||'|'||coalesce(paid_at::text,'') from fnf_mgmt.fnf_settlements
      where tenant_id='${tenant}' and employee_id='${id}' order by created_at desc, id desc limit 1`)
    if (row.employeeId !== id) { stOk = false; stDetail += ` order ${i}` }
    if (!want) {
      if (row.settlementId !== null || row.status !== null || row.lastWorkingDay !== null || row.netSettlement !== null || row.paidAt !== null) { stOk = false; stDetail += ` ${id} not null` }
    } else {
      const [sid, status, lwd, net, paid] = want.split('|')
      if (row.settlementId !== sid || row.status !== status || row.lastWorkingDay !== lwd || !same(row.netSettlement, net) || (paid === '') !== (row.paidAt === null)) { stOk = false; stDetail += ` ${id} ${JSON.stringify(row)} vs ${want}` }
    }
  }
  check('F&F status: each person\u2019s most recent settlement (or nulls), in the order asked', stOk, stDetail)
  const bad = await owner.call('/v1/fnf/settlements/status?employeeIds=not-an-id')
  check('F&F status: a bad id is a 400 with its own code (not INVALID_PARAMETER)', bad.status === 400 && bad.json?.errorCode === 'INVALID_EMPLOYEE_ID', `${bad.status} ${bad.json?.errorCode}`)
  const noIds = await owner.call('/v1/fnf/settlements/status?employeeIds=')
  check('F&F status: no ids, no rows', noIds.status === 200 && Array.isArray(noIds.json) && noIds.json.length === 0)

  const fy = fyOf(owner.employeeId || '11111111-1111-1111-1111-111111111111')
  const fnfWant = sql(`select count(*) ||'|'|| count(*) filter (where status='PROCESSED') ||'|'|| coalesce(sum(net_settlement) filter (where status='PROCESSED'),0)
    ||'|'|| count(*) filter (where status='APPROVED') ||'|'|| coalesce(sum(net_settlement) filter (where status='APPROVED'),0)
    ||'|'|| count(*) filter (where status='PAID') ||'|'|| coalesce(sum(net_settlement) filter (where status='PAID'),0)
    ||'|'|| count(*) filter (where status='CANCELLED')
    ||'|'|| count(*) filter (where status='PAID' and paid_at >= ('${fy.start}'::date::timestamp at time zone 'Asia/Kolkata') and paid_at < ('${fy.next}'::date::timestamp at time zone 'Asia/Kolkata'))
    ||'|'|| coalesce(sum(net_settlement) filter (where status='PAID' and paid_at >= ('${fy.start}'::date::timestamp at time zone 'Asia/Kolkata') and paid_at < ('${fy.next}'::date::timestamp at time zone 'Asia/Kolkata')),0)
    from fnf_mgmt.fnf_settlements where tenant_id='${tenant}'`).split('|')
  const fs = (await owner.call('/v1/fnf/summary')).json || {}
  check('F&F summary matches the ledger', Number(fs.total) === Number(fnfWant[0]) && fs.pendingApproval?.count === Number(fnfWant[1]) && same(fs.pendingApproval?.amount, fnfWant[2])
    && fs.pendingPayment?.count === Number(fnfWant[3]) && same(fs.pendingPayment?.amount, fnfWant[4]) && fs.settled?.count === Number(fnfWant[5]) && same(fs.settled?.amount, fnfWant[6])
    && fs.cancelled === Number(fnfWant[7]) && fs.paidThisFinancialYear?.count === Number(fnfWant[8]) && same(fs.paidThisFinancialYear?.amount, fnfWant[9])
    && fs.financialYearStart === fy.start, `${JSON.stringify(fs)} vs ${fnfWant.join('|')}`)

  const all = await owner.call('/v1/fnf/settlements?size=100')
  check('F&F list without filters is unchanged', all.status === 200 && all.json?.totalElements === num(`select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${tenant}'`))
  check('F&F rows carry department and employment status', (all.json?.content || []).length > 0 && all.json.content.every((r) => 'departmentId' in r && 'departmentName' in r && 'employmentStatus' in r))
  const r0 = all.json?.content?.[0]
  if (r0) check('F&F employment status is the leaver\u2019s today', (r0.employmentStatus ?? '') === sql(`select employment_status from hrms.employees where id='${r0.employeeId}'`), `${r0.employmentStatus}`)
  const paid = await owner.call('/v1/fnf/settlements?status=PAID&size=100')
  check('F&F status filter', paid.status === 200 && paid.json.content.every((r) => r.status === 'PAID') && paid.json.totalElements === num(`select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${tenant}' and status='PAID'`))
  const two = await owner.call('/v1/fnf/settlements?status=APPROVED,CANCELLED&size=100')
  check('F&F several statuses', two.status === 200 && two.json.content.every((r) => ['APPROVED', 'CANCELLED'].includes(r.status)) && two.json.totalElements === num(`select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${tenant}' and status in ('APPROVED','CANCELLED')`))
  const one = await owner.call(`/v1/fnf/settlements?employeeId=${leavers[0]}&size=100`)
  check('F&F employee filter', one.status === 200 && one.json.content.every((r) => r.employeeId === leavers[0]) && one.json.totalElements === num(`select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${tenant}' and employee_id='${leavers[0]}'`))
  const both = await owner.call(`/v1/fnf/settlements?employeeId=${leavers[0]}&status=CANCELLED`)
  check('F&F employee and status together', both.status === 200 && both.json.totalElements === num(`select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${tenant}' and employee_id='${leavers[0]}' and status='CANCELLED'`))
  const oneSettlement = await owner.call(`/v1/fnf/settlements/${all.json?.content?.[0]?.id}`)
  check('F&F a settlement by id still opens', oneSettlement.status === 200 && oneSettlement.json?.id === all.json?.content?.[0]?.id)
  for (const [who, s] of Object.entries(everyone)) {
    const expect = ['owner', 'hrm', 'fin'].includes(who) ? 200 : 403
    const got = [(await s.call(`/v1/fnf/settlements/status?employeeIds=${leavers[0]}`)).status, (await s.call('/v1/fnf/summary')).status, (await s.call('/v1/fnf/settlements?status=PAID')).status]
    check(`F&F reads for ${who}: ${expect}`, got.every((x) => x === expect), got.join(','))
  }

  // ═══ PLI (BW-63) ════════════════════════════════════════════════════════
  const pliFy = (who) => `paid_at >= ('${fyOf(who).start}'::date::timestamp at time zone 'Asia/Kolkata') and paid_at < ('${fyOf(who).next}'::date::timestamp at time zone 'Asia/Kolkata')`
  const pw = sql(`select count(*) ||'|'|| count(*) filter (where status='PROPOSED') ||'|'|| coalesce(sum(amount) filter (where status='PROPOSED'),0)
    ||'|'|| count(*) filter (where status='APPROVED') ||'|'|| coalesce(sum(amount) filter (where status='APPROVED'),0)
    ||'|'|| count(*) filter (where status='PAID') ||'|'|| coalesce(sum(amount) filter (where status='PAID'),0)
    ||'|'|| count(*) filter (where status='PAID' and ${pliFy(FIN)}) ||'|'|| coalesce(sum(amount) filter (where status='PAID' and ${pliFy(FIN)}),0)
    ||'|'|| count(*) filter (where status='REJECTED') from pli_mgmt.pli_awards where tenant_id='${tenant}'`).split('|')
  const ps = await fin.call('/v1/pli/awards/summary')
  const p = ps.json || {}
  check('PLI totals match the awards', ps.status === 200 && p.total === Number(pw[0]) && p.proposed?.count === Number(pw[1]) && same(p.proposed?.amount, pw[2])
    && p.approved?.count === Number(pw[3]) && same(p.approved?.amount, pw[4]) && p.paid?.count === Number(pw[5]) && same(p.paid?.amount, pw[6])
    && p.paidThisFinancialYear?.count === Number(pw[7]) && same(p.paidThisFinancialYear?.amount, pw[8]) && p.rejected === Number(pw[9]), `${JSON.stringify(p)} vs ${pw.join('|')}`)
  const proposed = await owner.call('/v1/pli/awards?status=PROPOSED&size=100')
  check('PLI status filter', proposed.status === 200 && proposed.json.content.every((r) => r.status === 'PROPOSED') && proposed.json.totalElements === Number(pw[1]))
  const awards = await owner.call('/v1/pli/awards?size=100')
  check('PLI list without a filter is unchanged', awards.status === 200 && awards.json.totalElements === Number(pw[0]))
  const deptOk = (awards.json?.content || []).every((r) => 'departmentId' in r && 'departmentName' in r
    && (r.departmentName ?? '') === sql(`select coalesce(d.name,'') from hrms.employees e left join hrms.departments d on d.id=e.department_id where e.id='${r.employeeId}'`))
  check('PLI awards name the department from the employee record', deptOk)
  check('PLI rating basis stays a number', (awards.json?.content || []).every((r) => r.ratingBasis === null || typeof r.ratingBasis === 'number'))
  for (const [who, s] of Object.entries(everyone)) {
    const mine = await s.call('/v1/pli/my/summary')
    const w = sql(`select count(*) filter (where status<>'REJECTED') ||'|'|| coalesce(sum(amount) filter (where status<>'REJECTED'),0) ||'|'|| count(*) filter (where status='PROPOSED')
      ||'|'|| coalesce(sum(amount) filter (where status='PROPOSED'),0) ||'|'|| coalesce(sum(amount) filter (where status='APPROVED'),0) ||'|'|| coalesce(sum(amount) filter (where status='PAID'),0)
      from pli_mgmt.pli_awards where tenant_id='${tenant}' and employee_id='${s.employeeId}'`).split('|')
    const j = mine.json || {}
    check(`PLI my totals for ${who} are their own`, mine.status === 200 && j.proposedForYou?.count === Number(w[0]) && same(j.proposedForYou?.amount, w[1])
      && j.waiting?.count === Number(w[2]) && same(j.waiting?.amount, w[3]) && same(j.approved?.amount, w[4]) && same(j.paid?.amount, w[5]), `${JSON.stringify(j)} vs ${w.join('|')}`)
    const expect = ['owner', 'hrm', 'fin'].includes(who) ? 200 : 403
    const got = [(await s.call('/v1/pli/awards/summary')).status, (await s.call('/v1/pli/awards?status=PAID')).status]
    check(`PLI company reads for ${who}: ${expect}`, got.every((x) => x === expect), got.join(','))
  }

  // ═══ Advances (BW-62) ═══════════════════════════════════════════════════
  const dept = sql(`select id from hrms.departments where tenant_id='${tenant}' and company_id='${company}' order by name limit 1`)
  sql(`BEGIN;
    INSERT INTO hrms.employees(id,tenant_id,company_id,department_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      reporting_manager_id,date_of_joining,created_by,updated_by)
    VALUES ('${A}','${tenant}','${company}',${dept ? `'${dept}'` : 'NULL'},'QAX-${A.slice(0, 8)}','QA Pay Extra','Advance Member','${aEmail}','FULL_TIME','ACTIVE',
      '${MGR}','2025-01-01','qa','qa');
    INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active)
      SELECT '${UA}','${tenant}','${aEmail}',password_hash,'${A}',true FROM auth.user_credentials
       WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) SELECT '${tenant}','${UA}',id FROM rbac.roles WHERE code='EMPLOYEE' AND tenant_id IS NULL;
    COMMIT;`)
  const a = await session(aEmail)
  check('fixture: the disposable employee signs in', a.employeeId === A)

  // Who approves: mgr@, or their active delegate today.
  const delegate = sql(`select delegate_id from platform.approver_delegations where delegator_id='${MGR}' and from_date <= (now() at time zone 'Asia/Kolkata')::date
    and to_date >= (now() at time zone 'Asia/Kolkata')::date order by created_at desc limit 1`)
  const approverId = delegate || MGR
  const approverName = sql(`select trim(first_name || ' ' || coalesce(last_name,'')) from hrms.employees where id='${approverId}'`)
  const ap = await a.call('/v1/advance/my/approver')
  check('my approver: the reporting manager (or their delegate), by name', ap.status === 200 && ap.json?.approver?.employeeId === approverId
    && ap.json.approver.name === approverName && ap.json.approver.source === (delegate ? 'DELEGATE' : 'MANAGER'), JSON.stringify(ap.json))

  const pv = await a.call('/v1/advance/my/preview?amount=45000&months=4')
  const v = pv.json || {}
  check('preview: ₹45,000 over 4 months is ₹11,250 a month', pv.status === 200 && same(v.monthlyDeduction, 11250) && same(v.lastInstallment, 11250) && v.months === 4, JSON.stringify(v))
  check('preview: recovery from the month after payout, for 4 months', v.assumedPayoutMonth === ym(0) && v.firstDeductionMonth === ym(1) && v.lastDeductionMonth === ym(4), `${v.assumedPayoutMonth} ${v.firstDeductionMonth} ${v.lastDeductionMonth}`)
  check('preview: the same approver', v.approver?.employeeId === approverId)
  const hasStructure = num(`select count(*) from payroll.employee_salary_structures where employee_id='${A}' and is_current`) > 0
  check('preview: no take-home without a salary structure', !hasStructure && v.netMonthly === null && v.takeHomeAfterDeduction === null)
  const pv2 = (await a.call('/v1/advance/my/preview?amount=50000&months=6')).json || {}
  check('preview: rounding to paise, the last installment takes the rest', same(pv2.monthlyDeduction, 8333.33) && same(pv2.lastInstallment, 8333.35), JSON.stringify(pv2))
  const pvBad = [await a.call('/v1/advance/my/preview?amount=0&months=4'), await a.call('/v1/advance/my/preview?amount=1000&months=61')]
  check('preview: refuses what the request would refuse (422)', pvBad[0].status === 422 && pvBad[0].json?.errorCode === 'ADVANCE_INVALID_AMOUNT'
    && pvBad[1].status === 422 && pvBad[1].json?.errorCode === 'ADVANCE_INVALID_TERM', `${pvBad[0].status} ${pvBad[1].status}`)
  const rpv = (await reader.call('/v1/advance/my/preview?amount=12000&months=3'))
  const readerNet = sql(`select count(*) from payroll.employee_salary_structures where employee_id='${READER}' and is_current`) !== '0'
  check('preview for reader: take-home only from their own structure', rpv.status === 200 && (readerNet ? typeof rpv.json.netMonthly === 'number' && same(rpv.json.takeHomeAfterDeduction, rpv.json.netMonthly - 4000) : rpv.json.netMonthly === null), JSON.stringify(rpv.json))

  const req = await a.call('/v1/advance/requests', 'POST', { amount: 45000, repaymentMonths: 4, reason: `QA Pay Extra live check ${stamp}` })
  advanceId = req.json?.id
  check('the employee asks for an advance (today\u2019s flow): 201, routed to the previewed approver', req.status === 201 && req.json?.approverId === approverId
    && same(req.json?.monthlyDeduction, v.monthlyDeduction) && req.json?.departmentId === (dept || null), `${req.status} ${JSON.stringify(req.json).slice(0, 300)}`)
  const my1 = (await a.call('/v1/advance/my/summary')).json || {}
  check('my totals: one request waiting', my1.total === 1 && my1.waiting?.count === 1 && same(my1.waiting?.amount, 45000) && my1.recovering === 0, JSON.stringify(my1))
  check('my totals: the literal path is not taken for an advance id', (await a.call('/v1/advance/my/summary')).status === 200)

  const dec = await (delegate ? null : mgr)?.call(`/v1/advance/requests/${advanceId}/decision`, 'POST', { approved: true, comment: 'QA approve' })
  check('mgr@ approves it', dec?.status === 200 && dec.json?.status === 'APPROVED', `${dec?.status}`)
  const early = await fin.call(`/v1/advance/requests/${advanceId}/disburse`, 'POST', { paymentReference: 'x', firstDeductionMonth: ym(0) })
  const late = await fin.call(`/v1/advance/requests/${advanceId}/disburse`, 'POST', { firstDeductionMonth: ym(14) })
  check('payout: a first month before next month, or too far ahead, is refused and changes nothing', early.status === 422 && early.json?.errorCode === 'ADVANCE_INVALID_FIRST_MONTH'
    && late.status === 422 && sql(`select status from advance_mgmt.advance_requests where id='${advanceId}'`) === 'APPROVED'
    && num(`select count(*) from advance_mgmt.advance_ledger_entries where advance_request_id='${advanceId}'`) === 0, `${early.status} ${late.status}`)
  const ref = `NEFT QA ${stamp}`
  const pay = await fin.call(`/v1/advance/requests/${advanceId}/disburse`, 'POST', { paymentReference: `  ${ref} `, firstDeductionMonth: ym(2) })
  check('fin@ records the payout with a reference and a later first month', pay.status === 200 && pay.json?.status === 'DISBURSED', `${pay.status} ${JSON.stringify(pay.json).slice(0, 200)}`)

  const sched = await a.call(`/v1/advance/${advanceId}/schedule`)
  const rows = sched.json || []
  check('the employee reads their own schedule: 4 months from the chosen month, adding up', sched.status === 200 && rows.length === 4 && rows[0].scheduledMonth === `${ym(2)}-01`
    && rows[3].scheduledMonth === `${ym(5)}-01` && same(rows.reduce((s, r) => s + Number(r.scheduledAmount), 0), 45000), `${sched.status} ${rows.map((r) => r.scheduledMonth + ' ' + r.scheduledAmount).join(', ')}`)
  const led = await a.call(`/v1/advance/${advanceId}/ledger`)
  const l0 = (led.json || [])[0] || {}
  check('ledger: one payout row with the bank reference, in plain words', led.status === 200 && led.json.length === 1 && l0.entryType === 'DISBURSE' && l0.paymentReference === ref
    && l0.label === `Disbursed · ${ref}` && l0.payrollPeriod === null && sql(`select reference from advance_mgmt.advance_ledger_entries where advance_request_id='${advanceId}'`) === ref, JSON.stringify(l0))
  const sum1 = await a.call(`/v1/advance/${advanceId}/summary`)
  check('the employee reads their own recovery summary', sum1.status === 200 && same(sum1.json?.outstandingAmount, 45000) && sum1.json?.installmentsPending === 4 && sum1.json?.nextScheduledMonth === `${ym(2)}-01`, JSON.stringify(sum1.json))
  const my2 = (await a.call('/v1/advance/my/summary')).json || {}
  check('my totals: being recovered, ₹11,250 a month, 4 left, from the chosen month', my2.recovering === 1 && same(my2.stillToRepay, 45000) && same(my2.monthlyRecovery, 11250)
    && my2.installmentsLeft === 4 && my2.nextDeductionMonth === ym(2) && my2.waiting?.count === 0, JSON.stringify(my2))

  // Who may read this advance's recovery: the owner of it, the approver, finance (disburse); not reader@ or hrm@ (not routed, no disburse).
  const access = {}
  for (const [who, s] of Object.entries({ ...everyone, a })) {
    access[who] = [(await s.call(`/v1/advance/${advanceId}/schedule`)).status, (await s.call(`/v1/advance/${advanceId}/ledger`)).status, (await s.call(`/v1/advance/${advanceId}/summary`)).status]
  }
  const wantAccess = { owner: 200, fin: 200, mgr: delegate ? 403 : 200, a: 200, reader: 403, hrm: 403 }
  check('recovery reads: owner of the advance, approver and finance yes; reader@ and hrm@ no', Object.entries(wantAccess).every(([who, code]) => access[who].every((x) => x === code)), JSON.stringify(access))
  const readerOwn = sql(`select id from advance_mgmt.advance_requests where employee_id='${READER}' and status='DISBURSED' order by created_at limit 1`)
  if (readerOwn) {
    const got = [(await reader.call(`/v1/advance/${readerOwn}/schedule`)).status, (await reader.call(`/v1/advance/${readerOwn}/ledger`)).status, (await reader.call(`/v1/advance/${readerOwn}/summary`)).status]
    check('reader@ (request.self only) reads their own seeded advance', got.every((x) => x === 200), got.join(','))
  }

  // Ledger rows named by payroll month (seeded payroll recoveries).
  const rep = sql(`select l.advance_request_id||'|'||r.period_month||'|'||r.period_year from advance_mgmt.advance_ledger_entries l join payroll.runs r on r.id=l.payroll_run_id
    where l.tenant_id='${tenant}' and l.entry_type='REPAYMENT' limit 1`)
  if (rep) {
    const [adv, m, y] = rep.split('|')
    const rows2 = (await fin.call(`/v1/advance/${adv}/ledger`)).json || []
    const r = rows2.find((x) => x.entryType === 'REPAYMENT')
    check('ledger: a payroll recovery reads "Recovered · <month> payroll"', r?.payrollPeriod === `${monthName(Number(m))} ${y}` && r?.label === `Recovered · ${monthName(Number(m))} ${y} payroll`, JSON.stringify(r))
    const kinds = new Set(rows2.map((x) => x.entryType))
    check('ledger: every row has a label', rows2.every((x) => typeof x.label === 'string' && x.label.length > 0), [...kinds].join(','))
  } else {
    check('ledger: a payroll recovery reads "Recovered · <month> payroll"', false, 'no seeded REPAYMENT row')
  }

  // Filters, in the list's scope.
  const scopeSql = (who) => who === 'all' ? '' : ` and ar.approver_id='${who}'`
  const woJoin = `left join (select distinct advance_request_id from advance_mgmt.advance_ledger_entries where tenant_id='${tenant}' and entry_type='WRITE_OFF') w on w.advance_request_id=ar.id`
  const recoveringSql = `ar.status='DISBURSED' and ar.outstanding_amount>0`
  const repaidSql = `(ar.status='CLOSED' or (ar.status='DISBURSED' and ar.outstanding_amount<=0)) and w.advance_request_id is null`
  for (const [who, s, scope] of [['fin', fin, 'all'], ['mgr', mgr, MGR], ['hrm', hrm, HRM]]) {
    const recov = await s.call('/v1/advance/requests?phase=RECOVERING&size=100')
    const recWant = num(`select count(*) from advance_mgmt.advance_requests ar where ar.tenant_id='${tenant}' and ${recoveringSql}${scopeSql(scope)}`)
    check(`advances list, Recovering (${who})`, recov.status === 200 && recov.json.totalElements === recWant
      && recov.json.content.every((r) => r.status === 'DISBURSED' && Number(r.outstandingAmount) > 0 && (scope === 'all' || r.approverId === scope)), `${recov.json?.totalElements} vs ${recWant}`)
    const repaid = await s.call('/v1/advance/requests?phase=REPAID&size=100')
    const repWant = num(`select count(*) from advance_mgmt.advance_requests ar ${woJoin} where ar.tenant_id='${tenant}' and ${repaidSql}${scopeSql(scope)}`)
    check(`advances list, Repaid, write-offs left out (${who})`, repaid.status === 200 && repaid.json.totalElements === repWant
      && repaid.json.content.every((r) => r.status === 'CLOSED' || Number(r.outstandingAmount) <= 0), `${repaid.json?.totalElements} vs ${repWant}`)
    const fyw = fyOf(s.employeeId)
    const sw = sql(`select count(*) ||'|'|| count(*) filter (where ar.status='REQUESTED') ||'|'|| coalesce(sum(ar.amount) filter (where ar.status='REQUESTED'),0)
      ||'|'|| count(*) filter (where ar.status='APPROVED') ||'|'|| coalesce(sum(ar.amount) filter (where ar.status='APPROVED'),0)
      ||'|'|| count(*) filter (where ${recoveringSql}) ||'|'|| count(distinct ar.employee_id) filter (where ${recoveringSql}) ||'|'|| coalesce(sum(ar.outstanding_amount) filter (where ${recoveringSql}),0)
      ||'|'|| count(*) filter (where ${repaidSql}) ||'|'|| count(*) filter (where w.advance_request_id is not null) ||'|'|| count(*) filter (where ar.status='REJECTED')
      from advance_mgmt.advance_requests ar ${woJoin} where ar.tenant_id='${tenant}'${scopeSql(scope)}`).split('|')
    const repaidFy = sql(`select coalesce(-sum(l.amount),0) from advance_mgmt.advance_ledger_entries l join advance_mgmt.advance_requests ar on ar.id=l.advance_request_id
      where l.tenant_id='${tenant}' and l.entry_type in ('REPAYMENT','FORECLOSE') and l.created_at >= ('${fyw.start}'::date::timestamp at time zone 'Asia/Kolkata')
      and l.created_at < ('${fyw.next}'::date::timestamp at time zone 'Asia/Kolkata')${scopeSql(scope)}`)
    const sm = (await s.call('/v1/advance/summary')).json || {}
    check(`advance totals match the database in ${who}'s scope`, sm.total === Number(sw[0]) && sm.requested?.count === Number(sw[1]) && same(sm.requested?.amount, sw[2])
      && sm.approvedNotDisbursed?.count === Number(sw[3]) && same(sm.approvedNotDisbursed?.amount, sw[4]) && sm.recovering === Number(sw[5]) && sm.recoveringPeople === Number(sw[6])
      && same(sm.outstanding, sw[7]) && sm.repaid === Number(sw[8]) && sm.writtenOff === Number(sw[9]) && sm.rejected === Number(sw[10]) && same(sm.repaidThisFinancialYear, repaidFy),
    `${JSON.stringify(sm)} vs ${sw.join('|')} fy=${repaidFy}`)
  }
  const recovFin = (await fin.call('/v1/advance/requests?phase=RECOVERING&size=100')).json?.content || []
  check('the new advance is Recovering', recovFin.some((r) => r.id === advanceId))
  if (dept) {
    const byDept = await fin.call(`/v1/advance/requests?departmentId=${dept}&size=100`)
    const deptName = sql(`select name from hrms.departments where id='${dept}'`)
    check('advances list, by department, names it', byDept.status === 200 && byDept.json.content.some((r) => r.id === advanceId)
      && byDept.json.content.every((r) => r.departmentId === dept && r.departmentName === deptName)
      && byDept.json.totalElements === num(`select count(*) from advance_mgmt.advance_requests ar join hrms.employees e on e.id=ar.employee_id where ar.tenant_id='${tenant}' and e.department_id='${dept}'`))
  }
  const plain = await fin.call('/v1/advance/requests?size=100')
  check('advances list without the new filters is unchanged', plain.status === 200 && plain.json.totalElements === num(`select count(*) from advance_mgmt.advance_requests where tenant_id='${tenant}'`))
  check('advances list: an unknown phase is a 400', (await fin.call('/v1/advance/requests?phase=NOPE')).status === 400)
  for (const [who, s] of Object.entries(everyone)) {
    const expect = who === 'reader' ? 403 : 200
    const got = [(await s.call('/v1/advance/summary')).status, (await s.call('/v1/advance/requests?phase=RECOVERING')).status]
    check(`advance company reads for ${who}: ${expect}`, got.every((x) => x === expect), got.join(','))
    const self = [(await s.call('/v1/advance/my/summary')).status, (await s.call('/v1/advance/my/approver')).status, (await s.call('/v1/advance/my/preview?amount=1000&months=2')).status]
    check(`advance self reads for ${who}: 200`, self.every((x) => x === 200), self.join(','))
  }
}

try {
  await main()
} catch (e) {
  check('run finished', false, e.stack || e.message)
} finally {
  cleanup()
}
check('no unexpected 5xx and no FEATURE_NOT_READY', surprises.length === 0, surprises.join(' ; '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
