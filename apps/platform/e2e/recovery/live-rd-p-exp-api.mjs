// API-level live check of P-EXP's backend (redesign BW-60, BW-61; migration V143_57),
// against a running server and its database:
//   · the permission hrms.expense.claim.others: seeded with its name, module and
//     grants (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD only)
//   · a claim raised on behalf of reader by hrm: routed to reader's usual approver
//     (mgr), under reader's company, the employee told, the approver told, audited;
//     then approved by mgr (journaled), taken back through P-TEAM's Undo, then
//     rejected with a reason
//   · the refusals: yourself, another company, someone who doesn't exist, over the
//     cap, and 403 for roles without the permission (mgr, reader)
//   · my totals match the database; my approver; category caps readable by claimants;
//     claim rows carry department, approver name, categories, batch and the policy
//     check (the same caps the submit step enforces)
//   · the approvals status filter (SUBMITTED / APPROVED, 400 for anything else; no
//     filter = as before) for mgr and for finance
//   · tables renamed: the claim details leave the batch out, Undo answers
//     FEATURE_NOT_READY, my totals answer FEATURE_NOT_READY; then renamed back
// Everything it creates is removed at the end (claims, policies, batch rows,
// notifications, audit rows, journal rows).
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-exp-api.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB, RECOVERY_PASSWORD
/* global process, console, fetch, FormData, Blob, setTimeout */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = istToday()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── sessions ────────────────────────────────────────────────────────────────
let allowNotReady = false
const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const call = async (path, method = 'GET', body, form) => {
    const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
    if (!form) headers['Content-Type'] = 'application/json'
    const res = await fetch(api + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500 && !(allowNotReady && json?.errorCode === 'FEATURE_NOT_READY')) surprises.push(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    if (json?.errorCode === 'FEATURE_NOT_READY' && !allowNotReady) surprises.push(`${method} ${path} → FEATURE_NOT_READY outside the rename step`)
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId, permissions: new Set(d.permissions || []) }
}

const created = { claims: [], policies: [], batches: [] }
const claimStatus = (id) => sql(`select status from expense_mgmt.expense_claims where id='${id}'`)
async function notified(userId, type, claimId) {
  for (let i = 0; i < 20; i++) {
    if (num(`select count(*) from notif.notifications where user_id='${userId}' and type='${type}' and data->>'expenseClaimId'='${claimId}'`) > 0) return true
    await sleep(250)
  }
  return false
}
const ids = (j) => (j?.content || []).map((c) => c.id)
const line = (category, amount, extra = {}) => ({ category, amount, expenseDate: addDays(today, -2), description: `QA ${category}`, ...extra })

async function main() {
  // ── 0. the permission row and its grants ──────────────────────────────────
  const perm = sql(`select module || '|' || display_name from rbac.permissions where code='hrms.expense.claim.others'`)
  check('permission: seeded as "Raise expense claims for others" in the expense module', perm === 'expense|Raise expense claims for others', perm)
  const holders = sql(`select string_agg(r.code, ',' order by r.code) from rbac.role_permissions rp join rbac.roles r on r.id=rp.role_id
                        where rp.permission_code='hrms.expense.claim.others' and r.tenant_id is null`)
  check('permission: granted to OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD only', holders === 'ADMIN,FINANCE_LEAD,HR_MANAGER,OWNER,SUPER_ADMIN', holders)

  const owner = await session('owner@unifiedtree.demo')
  const hrm = await session('hrm@unifiedtree.demo')
  const fin = await session('fin@unifiedtree.demo')
  const mgr = await session('mgr@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')
  check('fixture: reader reports to mgr', sql(`select reporting_manager_id from hrms.employees where id='${READER}'`) === MGR)

  // Two policies of our own: a tighter travel cap that expects a receipt, and a meals cap without.
  const P1 = (await owner.call(`/v1/expense/policies?companyId=${company}`, 'POST', { name: 'QA P-EXP travel', category: 'TRAVEL', maxAmountPerClaim: 1000, requiresReceipt: true })).json
  const P2 = (await owner.call(`/v1/expense/policies?companyId=${company}`, 'POST', { name: 'QA P-EXP meals', category: 'FOOD', maxAmountPerClaim: 500, requiresReceipt: false })).json
  created.policies.push(P1?.id, P2?.id)
  check('fixture: two policies of our own', P1?.id && P2?.id)
  // What the submit step would use: the tightest active cap per category.
  const capOf = (cat) => Number(sql(`select min(max_amount_per_claim) from expense_mgmt.expense_policies where tenant_id='${tenant}' and company_id='${company}' and is_active and category='${cat}'`))

  // ── 1. category caps, readable by claimants ───────────────────────────────
  let r = await reader.call('/v1/expense/policies/caps')
  const travelCap = (r.json || []).find((c) => c.category === 'TRAVEL')
  check('caps: reader (no policy permission) reads the caps of their company', r.status === 200 && Number(travelCap?.maxAmountPerClaim) === capOf('TRAVEL')
    && travelCap?.policyName === 'QA P-EXP travel' && travelCap?.requiresReceipt === true, JSON.stringify(travelCap))
  check('caps: reader still can\'t list the policies themselves (403)', (await reader.call(`/v1/expense/policies?companyId=${company}`)).status === 403)
  r = await hrm.call(`/v1/expense/policies/caps?companyId=${company}`)
  check('caps: by company id too', r.status === 200 && (r.json || []).some((c) => c.category === 'FOOD' && Number(c.maxAmountPerClaim) === capOf('FOOD')))

  // ── 2. raise on behalf: who may, whose company ─────────────────────────────
  const body = { title: 'QA P-EXP on behalf', notes: 'QA', items: [line('TRAVEL', 800), line('FOOD', 300)] }
  check('on behalf: mgr (no permission) is refused (403)', (await mgr.call(`/v1/expense/claims/for/${READER}`, 'POST', body)).status === 403)
  check('on behalf: reader (no permission) is refused (403)', (await reader.call(`/v1/expense/claims/for/${HRM}`, 'POST', body)).status === 403)
  const pdf = () => { const f = new FormData(); f.append('file', new Blob(['%PDF-1.4 qa'], { type: 'application/pdf' }), 'qa.pdf'); return f }
  check('on behalf: receipts too, mgr refused (403)', (await mgr.call(`/v1/expense/receipts/for/${READER}`, 'POST', undefined, pdf())).status === 403)
  check('on behalf: receipts too, reader refused (403)', (await reader.call(`/v1/expense/receipts/for/${HRM}`, 'POST', undefined, pdf())).status === 403)
  r = await hrm.call(`/v1/expense/claims/for/${HRM}`, 'POST', body)
  check('on behalf: not for yourself (422 EXPENSE_ON_BEHALF_SELF)', r.status === 422 && r.json?.errorCode === 'EXPENSE_ON_BEHALF_SELF', `${r.status} ${r.json?.errorCode}`)
  r = await hrm.call(`/v1/expense/claims/for/${READER}`, 'POST', { ...body, companyId: randomUUID() })
  check('on behalf: only under the employee\'s own company (422 EXPENSE_ON_BEHALF_COMPANY)', r.status === 422 && r.json?.errorCode === 'EXPENSE_ON_BEHALF_COMPANY', `${r.status} ${r.json?.errorCode}`)
  r = await hrm.call(`/v1/expense/claims/for/${randomUUID()}`, 'POST', body)
  check('on behalf: someone who isn\'t in this workspace (404)', r.status === 404, `${r.status}`)
  r = await hrm.call(`/v1/expense/claims/for/${READER}`, 'POST', { ...body, items: [line('TRAVEL', capOf('TRAVEL') + 1)] })
  check('on behalf: the same caps as the employee\'s own claim (422 EXPENSE_POLICY_CAP_EXCEEDED)', r.status === 422 && r.json?.errorCode === 'EXPENSE_POLICY_CAP_EXCEEDED', `${r.status} ${r.json?.errorCode}`)
  r = await hrm.call(`/v1/expense/claims/for/${READER}`, 'POST', { ...body, items: [line('TRAVEL', 100, { receiptUrl: `r2://expense-receipts/${tenant}/${HRM}/${randomUUID()}.pdf` })] })
  check('on behalf: a receipt that wasn\'t uploaded for the employee is refused (400)', r.status === 400, `${r.status}`)
  check('on behalf: nothing was saved by the refusals', num(`select count(*) from expense_mgmt.expense_claims where title='QA P-EXP on behalf'`) === 0)

  r = await hrm.call(`/v1/expense/claims/for/${READER}`, 'POST', body)
  const E = r.json
  if (E?.id) created.claims.push(E.id)
  check('on behalf: hrm raises a claim for reader (201, waiting)', r.status === 201 && E?.status === 'SUBMITTED' && E?.employeeId === READER, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  check('on behalf: under reader\'s company, routed to reader\'s usual approver (mgr)', E?.companyId === company && E?.approverId === MGR && E?.approverName === 'Dept Manager', `${E?.companyId} ${E?.approverId} ${E?.approverName}`)
  check('on behalf: the total is worked out from the lines', Number(E?.totalAmount) === 1100)
  check('on behalf: reader is told it was raised for them', await notified(READER, 'EXPENSE_CLAIM_RAISED_FOR_YOU', E?.id))
  const told = sql(`select body from notif.notifications where user_id='${READER}' and type='EXPENSE_CLAIM_RAISED_FOR_YOU' and data->>'expenseClaimId'='${E?.id}' limit 1`)
  check('on behalf: the message names who raised it, the claim and the amount', told.includes('HR Manager') && told.includes('QA P-EXP on behalf') && told.includes('₹1,100'), told)
  check('on behalf: mgr is told there is a claim to decide, as usual', await notified(MGR, 'EXPENSE_SUBMITTED', E?.id))
  check('on behalf: the raise is audited', num(`select count(*) from audit.events where tenant_id='${tenant}' and action='EXPENSE_CLAIM_RAISED_ON_BEHALF' and entity_id='${E?.id}'`) === 1)

  r = await fin.call(`/v1/expense/claims/for/${READER}`, 'POST', { title: 'QA P-EXP by finance', items: [line('MEDICAL', 250)] })
  const F = r.json
  if (F?.id) created.claims.push(F.id)
  check('on behalf: finance may raise one too (201)', r.status === 201 && F?.approverId === MGR, `${r.status}`)

  // ── 3. the claim rows' details ────────────────────────────────────────────
  r = await reader.call('/v1/expense/my?size=100')
  const mine = (r.json?.content || []).find((c) => c.id === E?.id)
  check('my claims: the claim raised for me is listed', r.status === 200 && !!mine)
  check('my claims: approver name, department and categories', mine?.approverName === 'Dept Manager'
    && JSON.stringify(mine?.categories) === '["TRAVEL","FOOD"]'
    && mine?.department === (sql(`select d.name from hrms.employees e left join hrms.departments d on d.id=e.department_id where e.id='${READER}'`) || null),
    `${mine?.approverName} ${JSON.stringify(mine?.categories)} ${mine?.department}`)
  const pc = mine?.policyCheck
  check('my claims: policy check says a receipt is missing on travel (within its cap)', pc?.result === 'RECEIPT_MISSING' && pc?.category === 'TRAVEL'
    && pc?.policyName === 'QA P-EXP travel' && Number(pc?.cap) === capOf('TRAVEL'), JSON.stringify(pc))
  const food = (pc?.lines || []).find((l) => l.category === 'FOOD')
  check('my claims: meals within their cap, no receipt expected', food?.result === 'WITHIN' && Number(food?.subtotal) === 300 && food?.receiptRequired === false, JSON.stringify(food))
  check('my claims: not in a batch', mine?.batchReference == null && mine?.batchStatus == null)

  // ── 4. my totals and my approver ─────────────────────────────────────────
  const yearStart = `${today.slice(0, 4)}-01-01`
  const expect = (cond) => sql(`select count(*) || '|' || coalesce(sum(total_amount),0) from expense_mgmt.expense_claims where tenant_id='${tenant}' and employee_id='${READER}' and coalesce(currency,'INR')='INR' and ${cond}`)
    .split('|').map(Number)
  r = await reader.call('/v1/expense/my/summary')
  const s = r.json
  const [wN, wA] = expect(`status='SUBMITTED'`)
  const [aN, aA] = expect(`status in ('APPROVED','APPROVED_FOR_PAY')`)
  const [pN, pA] = expect(`status='REIMBURSED' and reimbursed_at >= timestamptz '${yearStart} 00:00+05:30'`)
  check('my totals: waiting matches the database (all my claims, not one page)', r.status === 200 && s?.waiting?.count === wN && Number(s?.waiting?.amount) === wA, `${JSON.stringify(s?.waiting)} vs ${wN}/${wA}`)
  check('my totals: approved, not paid yet', s?.approvedNotPaid?.count === aN && Number(s?.approvedNotPaid?.amount) === aA, `${JSON.stringify(s?.approvedNotPaid)} vs ${aN}/${aA}`)
  check('my totals: reimbursed this year', s?.reimbursedThisYear?.count === pN && Number(s?.reimbursedThisYear?.amount) === pA, `${JSON.stringify(s?.reimbursedThisYear)} vs ${pN}/${pA}`)
  check('my totals: in rupees, this year', s?.currency === 'INR' && s?.year === Number(today.slice(0, 4)))
  check('my totals: every waiting claim is with mgr, so mgr is named', s?.waitingApproverId === MGR && s?.waitingApproverName === 'Dept Manager', `${s?.waitingApproverId} ${s?.waitingApproverName}`)
  r = await reader.call('/v1/expense/my/approver')
  check('my approver: a new claim of mine goes to mgr', r.status === 200 && r.json?.approverId === MGR && r.json?.approverName === 'Dept Manager' && r.json?.via === 'MANAGER', JSON.stringify(r.json))
  r = await hrm.call('/v1/expense/my/approver')
  check('my approver: hrm has no manager, so their claims wait for finance', r.status === 200 && r.json?.approverId == null && r.json?.via === 'FINANCE', JSON.stringify(r.json))

  // ── 5. the approvals status filter ───────────────────────────────────────
  const all = await mgr.call('/v1/expense/claims/approvals?size=200')
  const onlyWaiting = await mgr.call('/v1/expense/claims/approvals?status=SUBMITTED&size=200')
  const onlyApproved = await mgr.call('/v1/expense/claims/approvals?status=APPROVED&size=200')
  check('filter: without it, mgr\'s list is as before and holds the new claim', all.status === 200 && ids(all.json).includes(E?.id)
    && (all.json.content || []).every((c) => c.status === 'SUBMITTED' || c.status === 'APPROVED'))
  check('filter: SUBMITTED only', onlyWaiting.status === 200 && ids(onlyWaiting.json).includes(E?.id) && (onlyWaiting.json.content || []).every((c) => c.status === 'SUBMITTED'))
  check('filter: APPROVED only', onlyApproved.status === 200 && !ids(onlyApproved.json).includes(E?.id) && (onlyApproved.json.content || []).every((c) => c.status === 'APPROVED'))
  check('filter: the two together are the unfiltered list (same scope)',
    [...ids(onlyWaiting.json), ...ids(onlyApproved.json)].sort().join() === ids(all.json).sort().join())
  r = await mgr.call('/v1/expense/claims/approvals?status=REJECTED')
  check('filter: anything else is refused (400 EXPENSE_STATUS_FILTER)', r.status === 400 && r.json?.errorCode === 'EXPENSE_STATUS_FILTER', `${r.status} ${r.json?.errorCode}`)
  check('filter: a word that isn\'t a status is refused (400)', (await mgr.call('/v1/expense/claims/approvals?status=NOPE')).status === 400)
  r = await fin.call('/v1/expense/claims/approvals?status=SUBMITTED&size=200')
  check('filter: finance sees the tenant\'s waiting claims, as before', r.status === 200 && ids(r.json).includes(E?.id) && ids(r.json).includes(F?.id))
  check('filter: reader can\'t open the approvals list (403)', (await reader.call('/v1/expense/claims/approvals?status=SUBMITTED')).status === 403)
  const row = (onlyWaiting.json?.content || []).find((c) => c.id === E?.id)
  check('approvals row: department, approver and policy check', row?.policyCheck?.result === 'RECEIPT_MISSING' && row?.approverName === 'Dept Manager' && row?.employeeName === 'Reader User', JSON.stringify(row?.policyCheck))

  // ── 6. approve → Undo → reject with a reason ─────────────────────────────
  check('decide: hrm can\'t decide a claim routed to mgr (403)', (await hrm.call(`/v1/expense/claims/${E.id}/decision`, 'POST', { approved: true })).status === 403)
  r = await mgr.call(`/v1/expense/claims/${E.id}/decision`, 'POST', { approved: true, comment: 'QA ok' })
  check('decide: mgr approves the claim raised on behalf', r.status === 200 && r.json?.status === 'APPROVED' && claimStatus(E.id) === 'APPROVED', `${r.status}`)
  check('decide: the decision is in the Undo journal', num(`select count(*) from hrms.approval_decisions where tenant_id='${tenant}' and request_id='${E.id}' and undone_at is null`) === 1)
  check('filter: now it is APPROVED, to be paid', ids((await mgr.call('/v1/expense/claims/approvals?status=APPROVED&size=200')).json).includes(E.id))
  check('undo: reader can\'t take it back (403)', (await reader.call(`/v1/expense/claims/${E.id}/decision/undo`, 'POST')).status === 403)
  r = await mgr.call(`/v1/expense/claims/${E.id}/decision/undo`, 'POST')
  check('undo: mgr takes the approval back; it waits again', r.status === 200 && r.json?.status === 'SUBMITTED' && claimStatus(E.id) === 'SUBMITTED', `${r.status} ${JSON.stringify(r.json).slice(0, 150)}`)
  check('undo: reader is told', num(`select count(*) from notif.notifications where user_id='${READER}' and type='DECISION_UNDONE' and data->>'requestId'='${E.id}'`) > 0)
  r = await mgr.call(`/v1/expense/claims/${E.id}/decision`, 'POST', { approved: false, comment: 'QA: not a business expense' })
  check('reject: with a reason', r.status === 200 && r.json?.status === 'REJECTED' && r.json?.approverComment === 'QA: not a business expense'
    && sql(`select approver_comment from expense_mgmt.expense_claims where id='${E.id}'`) === 'QA: not a business expense', `${r.status}`)
  check('reject: reader is told', await notified(READER, 'EXPENSE_REJECTED', E.id))
  check('reject: a decided claim can\'t be decided again (422)', (await mgr.call(`/v1/expense/claims/${E.id}/decision`, 'POST', { approved: true })).status === 422)

  // ── 7. batch reference on my rows ────────────────────────────────────────
  r = await mgr.call(`/v1/expense/claims/${F.id}/decision`, 'POST', { approved: true, comment: 'QA ok' })
  check('batch: finance\'s claim approved by mgr', r.status === 200 && r.json?.status === 'APPROVED')
  const batch = randomUUID()
  sql(`BEGIN;
    INSERT INTO expense_mgmt.reimbursement_batches(id,tenant_id,company_id,batch_reference,cutoff_date,status,total_amount,claim_count)
      VALUES ('${batch}','${tenant}','${company}','QA-PEXP-${batch.slice(0, 8)}','${today}','DRAFT',250,1);
    INSERT INTO expense_mgmt.reimbursement_batch_items(tenant_id,batch_id,claim_id,employee_id,amount)
      VALUES ('${tenant}','${batch}','${F.id}','${READER}',250);
    COMMIT;`)
  created.batches.push(batch)
  r = await reader.call('/v1/expense/my?size=100')
  const inBatch = (r.json?.content || []).find((c) => c.id === F.id)
  check('batch: my row carries the batch reference and status', inBatch?.batchReference === `QA-PEXP-${batch.slice(0, 8)}` && inBatch?.batchStatus === 'DRAFT', `${inBatch?.batchReference} ${inBatch?.batchStatus}`)
  r = await reader.call('/v1/expense/my/summary')
  check('my totals: the approved claim counts as approved, not paid yet', r.json?.approvedNotPaid?.count === expect(`status in ('APPROVED','APPROVED_FOR_PAY')`)[0] && r.json?.approvedNotPaid?.count >= 1)

  // ── 8. a table missing ───────────────────────────────────────────────────
  const G = (await hrm.call(`/v1/expense/claims/for/${READER}`, 'POST', { title: 'QA P-EXP while off', items: [line('MEDICAL', 120)] })).json
  if (G?.id) created.claims.push(G.id)
  allowNotReady = true
  try {
    sql('ALTER TABLE expense_mgmt.reimbursement_batch_items RENAME TO reimbursement_batch_items_qa_off')
    try {
      r = await reader.call('/v1/expense/my?size=100')
      const off = (r.json?.content || []).find((c) => c.id === F.id)
      check('not ready: without the batch table my claims still load, the batch left out', r.status === 200 && off && off.batchReference == null && off.policyCheck?.result, `${r.status}`)
    } finally {
      sql('ALTER TABLE expense_mgmt.reimbursement_batch_items_qa_off RENAME TO reimbursement_batch_items')
    }
    sql('ALTER TABLE hrms.approval_decisions RENAME TO approval_decisions_qa_off')
    try {
      r = await mgr.call(`/v1/expense/claims/${G.id}/decision`, 'POST', { approved: true, comment: 'QA while off' })
      check('not ready: without the journal a decision works as before', r.status === 200 && claimStatus(G.id) === 'APPROVED', `${r.status}`)
      r = await mgr.call(`/v1/expense/claims/${G.id}/decision/undo`, 'POST')
      check('not ready: Undo answers FEATURE_NOT_READY (503)', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status} ${r.json?.errorCode}`)
    } finally {
      sql('ALTER TABLE hrms.approval_decisions_qa_off RENAME TO approval_decisions')
    }
    sql('ALTER TABLE expense_mgmt.expense_claims RENAME TO expense_claims_qa_off')
    try {
      r = await reader.call('/v1/expense/my/summary')
      check('not ready: my totals answer FEATURE_NOT_READY (503), not a 500', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status} ${r.json?.errorCode}`)
    } finally {
      sql('ALTER TABLE expense_mgmt.expense_claims_qa_off RENAME TO expense_claims')
    }
  } finally {
    allowNotReady = false
  }
  check('back on: my totals work again', (await reader.call('/v1/expense/my/summary')).status === 200)
  check('back on: batch shows again', ((await reader.call('/v1/expense/my?size=100')).json?.content || []).find((c) => c.id === F.id)?.batchStatus === 'DRAFT')
}

function cleanup() {
  const run = (label, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${label}: ${String(e.message).split('\n')[0]}`) } }
  // A rename step that failed half way: put the tables back first.
  for (const [schema, off, name] of [['expense_mgmt', 'reimbursement_batch_items_qa_off', 'reimbursement_batch_items'], ['hrms', 'approval_decisions_qa_off', 'approval_decisions'], ['expense_mgmt', 'expense_claims_qa_off', 'expense_claims']]) {
    if (sql(`select to_regclass('${schema}.${off}') is not null`) === 't') run(`rename ${off}`, `ALTER TABLE ${schema}.${off} RENAME TO ${name}`)
  }
  const claimIds = created.claims.filter(Boolean)
  // Any claim these titles made (a refusal that unexpectedly went through, too).
  const extra = sql(`select string_agg(id::text, ',') from expense_mgmt.expense_claims where tenant_id='${tenant}' and title like 'QA P-EXP %'`)
  for (const x of (extra || '').split(',').filter(Boolean)) if (!claimIds.includes(x)) claimIds.push(x)
  const list = claimIds.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const batches = created.batches.map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const policies = created.policies.filter(Boolean).map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const pattern = claimIds.join('|') || randomUUID()
  run('notifications', `DELETE FROM notif.notifications WHERE tenant_id='${tenant}' AND data::text ~ '${pattern}'`)
  run('audit', `DELETE FROM audit.events WHERE tenant_id='${tenant}' AND (entity_id IN (${list}, ${policies}) OR summary ~ 'QA P-EXP')`)
  run('journal', `DELETE FROM hrms.approval_decisions WHERE tenant_id='${tenant}' AND request_id IN (${list})`)
  run('batches', `BEGIN; DELETE FROM expense_mgmt.reimbursement_batch_items WHERE batch_id IN (${batches}) OR claim_id IN (${list}); DELETE FROM expense_mgmt.reimbursement_batches WHERE id IN (${batches}); COMMIT;`)
  run('claims', `BEGIN; DELETE FROM expense_mgmt.expense_items WHERE claim_id IN (${list}); DELETE FROM expense_mgmt.expense_claims WHERE id IN (${list}); COMMIT;`)
  run('policies', `DELETE FROM expense_mgmt.expense_policies WHERE id IN (${policies})`)
  const left = num(`select count(*) from expense_mgmt.expense_claims where id in (${list}) or title like 'QA P-EXP %'`)
    + num(`select count(*) from expense_mgmt.expense_policies where id in (${policies}) or name like 'QA P-EXP %'`)
    + num(`select count(*) from expense_mgmt.reimbursement_batches where id in (${batches})`)
    + num(`select count(*) from hrms.approval_decisions where request_id in (${list})`)
    + num(`select count(*) from notif.notifications where data::text ~ '${pattern}'`)
    + num(`select count(*) from audit.events where entity_id in (${list})`)
  const tablesBack = ['expense_mgmt.reimbursement_batch_items', 'hrms.approval_decisions', 'expense_mgmt.expense_claims']
    .every((t) => sql(`select to_regclass('${t}') is not null`) === 't')
  check('cleanup: nothing the test made is left behind, every table is back', left === 0 && tablesBack, `left=${left} tables=${tablesBack}`)
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
