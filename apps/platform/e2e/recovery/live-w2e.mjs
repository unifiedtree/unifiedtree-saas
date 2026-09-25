// Live API check of the w2e payroll features (no browser):
//  1. Bulk revise CTC — options / preview / apply (payroll.structure.bulk-revise):
//     who may use it, the preview maths, the guards (reason, preview key, 1st of
//     the month), and what apply writes (a batch, a new structure per person with
//     the same split scaled, the old one closed, a notification and an audit row each).
//  2. Export every salary structure — JSON and CSV (payroll.structure.read).
//  3. Issue an advance for someone else (hrms.advance.request.others): HR raises
//     one for the Reader, it records who raised it, notifies the employee and the
//     approver, and then follows the normal approve → payout → recovery flow.
// Everything it creates is removed at the end (the revised structures are
// deleted and the previous ones made current again).
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w2e.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222', HR = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444', FIN = '55555555-5555-5555-5555-555555555555'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text, type: res.headers.get('content-type') || '' }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}
const money = (v) => Math.round(Number(v || 0) * 100) / 100
const firstOfMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
const cleanup = { batches: [], newStructures: [], oldStructures: [], advances: [] }

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── 1. Bulk revise CTC ────────────────────────────────────────────────────
  check('perm: owner and finance hold payroll.structure.bulk-revise; HR, manager and employee do not',
    owner.perms.includes('payroll.structure.bulk-revise') && fin.perms.includes('payroll.structure.bulk-revise')
      && !hrm.perms.includes('payroll.structure.bulk-revise') && !mgr.perms.includes('payroll.structure.bulk-revise') && !reader.perms.includes('payroll.structure.bulk-revise'))
  const opts = await fin.call('/v1/payroll/structures/bulk-revise/options')
  const people = opts.json?.people || []
  check('options: finance lists people who have a structure', opts.status === 200 && people.some((p) => p.id === FIN) && people.some((p) => p.id === READER), `status=${opts.status} people=${people.length}`)
  check('options: every listed person really has a current structure',
    people.length > 0 && Number(sql(`select count(*) from payroll.employee_salary_structures where tenant_id='${tenant}' and is_current and employee_id in (${people.map((p) => `'${p.id}'`).join(',')})`)) === people.length)
  for (const [who, c] of [['HR manager', hrm], ['manager', mgr], ['employee', reader]]) {
    const r = await c.call('/v1/payroll/structures/bulk-revise/options')
    check(`options: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
  }

  const oldRows = Object.fromEntries([READER, FIN].map((id) => {
    const [sid, ctc, eff] = sql(`select id, ctc_annual, effective_from from payroll.employee_salary_structures where employee_id='${id}' and is_current`).split('|')
    return [id, { sid, ctc: Number(ctc), eff }]
  }))
  const oldGross = (sid) => Number(sql(`select coalesce(sum(esc.monthly_amount),0) from payroll.employee_structure_components esc join payroll.salary_components c on c.id=esc.component_id where esc.structure_id='${sid}' and c.category in ('EARNING','REIMBURSEMENT')`))
  const finGross = oldGross(oldRows[FIN].sid)
  // The first month the two people can be revised from without a payroll run in the way.
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const base = { mode: 'PERCENT', value: 10, employeeIds: [READER, FIN] }
  let eff = '', preview = null
  for (let i = 1; i <= 6 && !preview; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1), cand = firstOfMonth(d)
    if ([READER, FIN].some((id) => oldRows[id].eff >= cand)) continue
    const r = await fin.call('/v1/payroll/structures/bulk-revise/preview', 'POST', { ...base, effectiveFrom: cand })
    if (r.status === 200 && !(r.json.blockers || []).length) { eff = cand; preview = r.json }
    else if (i === 6) check('preview: a month without blocking payroll runs', false, JSON.stringify(r.json?.blockers || r.json))
  }
  const structuresBefore = sql(`select count(*) from payroll.employee_salary_structures where tenant_id='${tenant}'`)
  if (preview) {
    const byId = Object.fromEntries(preview.rows.map((r) => [r.employeeId, r]))
    check('preview: both people, old/new/difference per person (+10%)', preview.employees === 2
      && money(byId[FIN]?.newCtc) === Math.round(oldRows[FIN].ctc * 1.1) && money(byId[READER]?.newCtc) === Math.round(oldRows[READER].ctc * 1.1)
      && money(byId[FIN]?.difference) === money(byId[FIN]?.newCtc - byId[FIN]?.oldCtc), JSON.stringify(preview.rows.map((r) => [r.employeeCode, r.oldCtc, r.newCtc, r.difference])))
    check('preview: totals add up', money(preview.totalNewCtc) === money(preview.rows.reduce((a, r) => a + Number(r.newCtc), 0))
      && money(preview.totalDifference) === money(preview.totalNewCtc - preview.totalOldCtc) && preview.change === '+10%', `${preview.totalOldCtc} → ${preview.totalNewCtc}`)
    check('preview: monthly gross of a split structure scales by the same ratio',
      finGross === 0 || money(byId[FIN]?.newMonthlyGross) === Math.round(finGross * (Math.round(oldRows[FIN].ctc * 1.1) / oldRows[FIN].ctc)), `${finGross} → ${byId[FIN]?.newMonthlyGross}`)
    check('preview: payroll warnings come as a list (months not yet locked before the date)', Array.isArray(preview.warnings) && Array.isArray(preview.blockers), JSON.stringify(preview.warnings))
    check('preview: writes nothing', sql(`select count(*) from payroll.employee_salary_structures where tenant_id='${tenant}'`) === structuresBefore)
    const amt = await fin.call('/v1/payroll/structures/bulk-revise/preview', 'POST', { ...base, mode: 'AMOUNT', value: 12000, effectiveFrom: eff })
    check('preview: a fixed yearly amount adds it to each CTC', amt.status === 200 && amt.json.rows.every((r) => money(r.newCtc) === money(Number(r.oldCtc) + 12000)), `status=${amt.status}`)
    const mid = await fin.call('/v1/payroll/structures/bulk-revise/preview', 'POST', { ...base, effectiveFrom: eff.slice(0, 8) + '15' })
    check('preview: a date that is not the 1st is refused (422)', mid.status === 422, `status=${mid.status} ${mid.json?.message || ''}`)
    const pct = await fin.call('/v1/payroll/structures/bulk-revise/preview', 'POST', { ...base, value: 150, effectiveFrom: eff })
    check('preview: more than 100% is refused (422)', pct.status === 422, `status=${pct.status}`)

    const body = { ...base, effectiveFrom: eff, reason: `QA w2e bulk revision ${Date.now()}`, previewKey: preview.previewKey }
    const noKey = await fin.call('/v1/payroll/structures/bulk-revise', 'POST', { ...body, previewKey: undefined })
    const badKey = await fin.call('/v1/payroll/structures/bulk-revise', 'POST', { ...body, previewKey: 'not-the-preview' })
    const noReason = await fin.call('/v1/payroll/structures/bulk-revise', 'POST', { ...body, reason: ' ' })
    check('apply: refused without a preview key, with a stale key, or without a reason (422)', noKey.status === 422 && badKey.status === 422 && noReason.status === 422,
      `${noKey.status}/${badKey.status}/${noReason.status}`)
    for (const [who, c] of [['HR manager', hrm], ['employee', reader]]) {
      const r = await c.call('/v1/payroll/structures/bulk-revise', 'POST', body)
      check(`apply: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
    }
    check('apply: refusals wrote nothing', sql(`select count(*) from payroll.employee_salary_structures where tenant_id='${tenant}'`) === structuresBefore)

    const applied = await fin.call('/v1/payroll/structures/bulk-revise', 'POST', body)
    const batch = applied.json?.batchId
    if (batch) cleanup.batches.push(batch)
    for (const s of applied.json?.structures || []) { cleanup.newStructures.push(s.structureId) }
    cleanup.oldStructures.push(oldRows[READER].sid, oldRows[FIN].sid)
    check('apply: finance applies the revision', applied.status === 200 && applied.json.applied === 2, `status=${applied.status} ${applied.json?.message || ''}`)
    if (batch) {
      check('db: one batch row with who, why and totals', sql(`select employee_count||'|'||mode||'|'||value::int||'|'||effective_from||'|'||(applied_by_employee_id='${FIN}') from payroll.salary_revision_batches where id='${batch}'`) === `2|PERCENT|10|${eff}|true`)
      for (const id of [READER, FIN]) {
        const [ctc, from, isCur, b, note] = sql(`select ctc_annual, effective_from, is_current, revision_batch_id, revision_note from payroll.employee_salary_structures where employee_id='${id}' and is_current`).split('|')
        check(`db: ${id === FIN ? 'Finance' : 'Reader'} has a new current structure (+10%, from ${eff}, linked to the batch)`,
          money(ctc) === Math.round(oldRows[id].ctc * 1.1) && from === eff && isCur === 't' && b === batch && note.startsWith('Bulk revision +10%'), `${ctc} ${from} ${note}`)
        const [closedTo, closedCur] = sql(`select effective_to, coalesce(is_current::text,'null') from payroll.employee_salary_structures where id='${oldRows[id].sid}'`).split('|')
        const dayBefore = new Date(Date.UTC(Number(eff.slice(0, 4)), Number(eff.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10)
        check(`db: the previous structure is closed the day before (${dayBefore})`, closedTo === dayBefore && closedCur === 'null', `${closedTo} ${closedCur}`)
        const notif = sql(`select count(*) from notif.notifications where user_id='${id}' and type='SALARY_REVISED' and data->>'structureId' in (select id::text from payroll.employee_salary_structures where revision_batch_id='${batch}')`)
        check(`db: ${id === FIN ? 'Finance' : 'Reader'} was notified`, Number(notif) === 1, `notifications=${notif}`)
      }
      if (finGross > 0) {
        const newSid = sql(`select id from payroll.employee_salary_structures where employee_id='${FIN}' and is_current`)
        const newGross = oldGross(newSid)
        const oldCount = sql(`select count(*) from payroll.employee_structure_components where structure_id='${oldRows[FIN].sid}'`)
        const newCount = sql(`select count(*) from payroll.employee_structure_components where structure_id='${newSid}'`)
        check('db: the split structure keeps every line, earnings scaled to the new gross', oldCount === newCount && newGross === Math.round(finGross * (Math.round(oldRows[FIN].ctc * 1.1) / oldRows[FIN].ctc)), `${oldCount}→${newCount} lines, gross ${finGross}→${newGross}`)
      }
      const audits = sql(`select count(*) from audit.events where tenant_id='${tenant}' and module='payroll' and action in ('SALARY_REVISED','SALARY_BULK_REVISION') and (entity_id='${batch}' or entity_id in (select id from payroll.employee_salary_structures where revision_batch_id='${batch}'))`)
      check('db: audit log has the batch and each person', Number(audits) === 3, `audit rows=${audits}`)
      const again = await fin.call('/v1/payroll/structures/bulk-revise', 'POST', body)
      check('apply: running it again changes nothing (422)', again.status === 422, `status=${again.status} ${again.json?.message || ''}`)
      const read = await owner.call(`/v1/payroll/structures/employee/${FIN}`)
      check('api: the salary drawer reads the revised structure', read.status === 200 && money(read.json?.ctcAnnual) === Math.round(oldRows[FIN].ctc * 1.1))
    }
  }

  // ── 2. Export every salary structure ─────────────────────────────────────
  const ex = await owner.call('/v1/payroll/structures/export')
  const current = Number(sql(`select count(*) from payroll.employee_salary_structures where tenant_id='${tenant}' and is_current`))
  const finRow = (ex.json?.rows || []).find((r) => r.employeeId === FIN)
  check('export: one row per current structure', ex.status === 200 && ex.json.rows.length === current, `rows=${ex.json?.rows?.length} db=${current}`)
  check('export: CTC and components per person match the database', !!finRow
    && money(finRow.ctcAnnual) === money(sql(`select ctc_annual from payroll.employee_salary_structures where employee_id='${FIN}' and is_current`))
    && Object.keys(finRow.amounts).length === Number(sql(`select count(distinct c.code) from payroll.employee_structure_components esc join payroll.salary_components c on c.id=esc.component_id join payroll.employee_salary_structures s on s.id=esc.structure_id where s.employee_id='${FIN}' and s.is_current`)),
  JSON.stringify(finRow?.amounts))
  const csv = await owner.call('/v1/payroll/structures/export?format=csv')
  check('export: CSV download', csv.status === 200 && csv.type.includes('text/csv') && csv.text.includes('Employee code,Employee name') && csv.text.includes('EMP005'), `status=${csv.status} ${csv.type}`)
  const hrEx = await hrm.call('/v1/payroll/structures/export')
  check('export: HR (payroll.structure.read) may export', hrEx.status === 200, `status=${hrEx.status}`)
  for (const [who, c] of [['manager', mgr], ['employee', reader]]) {
    const r = await c.call('/v1/payroll/structures/export?format=csv')
    check(`export: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
  }
  check('db: export is audited', Number(sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='SALARY_STRUCTURES_EXPORTED' and occurred_at > now() - interval '10 minutes'`)) >= 3)

  // ── 3. Issue an advance for someone else ─────────────────────────────────
  check('perm: HR, finance and owner hold hrms.advance.request.others; manager and employee do not',
    hrm.perms.includes('hrms.advance.request.others') && fin.perms.includes('hrms.advance.request.others') && owner.perms.includes('hrms.advance.request.others')
      && !mgr.perms.includes('hrms.advance.request.others') && !reader.perms.includes('hrms.advance.request.others'))
  const reason = `QA w2e on-behalf ${Date.now()}`
  const raised = await hrm.call('/v1/advance/requests/on-behalf', 'POST', { employeeId: READER, amount: 15000, reason, repaymentMonths: 3 })
  const adv = raised.json
  if (adv?.id) cleanup.advances.push(adv.id)
  check('advance: HR raises one for the Reader', raised.status === 201 && adv.employeeId === READER && adv.status === 'REQUESTED' && money(adv.monthlyDeduction) === 5000
    && adv.raisedById === HR && !!adv.raisedByName, `status=${raised.status} ${adv?.message || ''}`)
  if (adv?.id) {
    const [raisedBy, approver] = sql(`select raised_by_employee_id, approver_id from advance_mgmt.advance_requests where id='${adv.id}'`).split('|')
    check('db: the advance records who raised it and routes to the Reader’s approver', raisedBy === HR && !!approver && approver !== HR, `approver=${approver}`)
    check('db: the Reader is told it was raised for them', sql(`select count(*) from notif.notifications where user_id='${READER}' and type='ADVANCE_RAISED_FOR_YOU' and data->>'advanceRequestId'='${adv.id}'`) === '1')
    check('db: the approver gets the usual request', sql(`select count(*) from notif.notifications where user_id='${approver}' and type='ADVANCE_SUBMITTED' and data->>'advanceRequestId'='${adv.id}'`) === '1')
    const mine = await reader.call('/v1/advance/my?size=50')
    check('advance: the Reader sees it in My advances', (mine.json?.content || []).some((a) => a.id === adv.id && a.raisedById === HR), `status=${mine.status}`)
    const list = await fin.call('/v1/advance/requests?size=100')
    check('advance: finance’s list shows who raised it', (list.json?.content || []).some((a) => a.id === adv.id && a.raisedByName === adv.raisedByName))
    // The normal flow: the approver approves, finance pays out, recovery is scheduled.
    const decider = approver === MGR ? mgr : owner
    const ok = await decider.call(`/v1/advance/requests/${adv.id}/decision`, 'POST', { approved: true, comment: 'QA w2e' })
    check('flow: the approver approves it', ok.status === 200 && ok.json?.status === 'APPROVED', `status=${ok.status}`)
    const paid = await fin.call(`/v1/advance/requests/${adv.id}/disburse`, 'POST')
    check('flow: finance pays it out', paid.status === 200 && paid.json?.status === 'DISBURSED', `status=${paid.status}`)
    check('flow: recovery is scheduled over 3 months', sql(`select count(*) from advance_mgmt.advance_recovery_schedule where advance_request_id='${adv.id}'`) === '3')
  }
  const self = await hrm.call('/v1/advance/requests/on-behalf', 'POST', { employeeId: HR, amount: 1000, repaymentMonths: 1 })
  check('advance: raising one for yourself is refused (422)', self.status === 422, `status=${self.status}`)
  const exited = sql(`select id from hrms.employees where tenant_id='${tenant}' and employment_status in ('EXITED','TERMINATED') limit 1`)
  if (exited) {
    const gone = await hrm.call('/v1/advance/requests/on-behalf', 'POST', { employeeId: exited, amount: 1000, repaymentMonths: 1 })
    check('advance: someone who has left is refused (422)', gone.status === 422, `status=${gone.status}`)
    if (gone.json?.id) cleanup.advances.push(gone.json.id)
  }
  for (const [who, c] of [['manager', mgr], ['employee', reader]]) {
    const r = await c.call('/v1/advance/requests/on-behalf', 'POST', { employeeId: FIN, amount: 1000, repaymentMonths: 1 })
    check(`advance: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
    if (r.json?.id) cleanup.advances.push(r.json.id)
  }
} catch (e) {
  check('run finished without an error', false, String(e?.stack || e))
} finally {
  // ── cleanup ──
  try {
    for (const id of cleanup.advances) {
      sql(`delete from notif.notifications where data->>'advanceRequestId'='${id}'`)
      sql(`delete from advance_mgmt.advance_recovery_schedule where advance_request_id='${id}'`)
      sql(`delete from advance_mgmt.advance_ledger_entries where advance_request_id='${id}'`)
      sql(`delete from advance_mgmt.advance_requests where id='${id}'`)
    }
    for (const b of cleanup.batches) {
      const ids = sql(`select string_agg(quote_literal(id::text), ',') from payroll.employee_salary_structures where revision_batch_id='${b}'`)
      if (ids) {
        sql(`delete from notif.notifications where type='SALARY_REVISED' and data->>'structureId' in (${ids})`)
        try { sql(`delete from audit.events where entity_id::text in (${ids}, '${b}')`) } catch { /* audit is append-only where enforced */ }
        sql(`delete from payroll.employee_salary_structures where id::text in (${ids})`)
      }
      sql(`delete from payroll.salary_revision_batches where id='${b}'`)
    }
    for (const sid of cleanup.oldStructures) {
      const emp = sql(`select employee_id from payroll.employee_salary_structures where id='${sid}'`)
      if (emp && sql(`select count(*) from payroll.employee_salary_structures where employee_id='${emp}' and is_current`) === '0') {
        sql(`update payroll.employee_salary_structures set is_current = true, effective_to = null where id='${sid}'`)
      }
    }
    check('cleanup: revised structures removed and the previous ones current again',
      cleanup.oldStructures.every((sid) => sql(`select coalesce(is_current::text,'null') from payroll.employee_salary_structures where id='${sid}'`) === 'true'))
  } catch (e) {
    check('cleanup', false, String(e?.message || e))
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
