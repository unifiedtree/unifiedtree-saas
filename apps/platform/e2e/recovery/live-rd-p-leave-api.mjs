// P-LEAVE backend (.be) live check, API only, against the live slot's backend.
//
//  A. who may call what (owner, hrm, fin, mgr, reader): 200 / 403 per endpoint
//  B. hrm applies for leave on reader's behalf: reader's approver chain, the
//     preview agrees, reader is told, then reader cancels and every balance is
//     back to its value before
//  C. mgr approves two of reader's requests in one call, takes one back (undo
//     journal), plus one they can't
//     decide: reported, not fatal); the Decided counts and stats see them
//  D. a holiday is added, edited (the leave count follows it), restored, archived
//  E. reader sees colleagues off: first names of approved leave in the same
//     department only (reader and mgr are put in a fresh department for this
//     and put back)
//  F. the reads: calendar per level, all balances, usage, encash summary
//
// Everything it creates is removed (leave cancelled, notifications deleted,
// holiday archived, department archived, employees put back). On the live
// slot's disposable database (RECOVERY_DB=ut_w3_dev, the default) it also
// deletes its own cancelled leave rows, holiday and department with SQL.
// Any FEATURE_NOT_READY is a failure: every migration is applied here.
//
//   live-slot.sh /c/REACT/ut-wt/rd-p-leave 3124 node e2e/recovery/live-rd-p-leave-api.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DB = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
/** Writes only on the slot's throwaway database. */
const sqlDev = (q) => (DB === 'ut_w3_dev' ? sql(q) : '')
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => new Date(d.getTime() + n * 864e5)
const istToday = () => new Date(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00Z')
const notReady = []

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (json && json.errorCode === 'FEATURE_NOT_READY') notReady.push(`${email} ${method} ${path}`)
    return { status: res.status, json }
  }
  return { email, call, employeeId: d.employeeId }
}

const owner = await session('owner@unifiedtree.demo')
const hrm = await session('hrm@unifiedtree.demo')
const fin = await session('fin@unifiedtree.demo')
const mgr = await session('mgr@unifiedtree.demo')
const reader = await session('reader@unifiedtree.demo')
const year = istToday().getUTCFullYear()

const created = { leave: [], holidays: [], departments: [] }
const cleanup = []
/** reader's and mgr's departments before the colleagues-off check: "id:department" lines. */
let beforeDept = ''

/** The balances of one person, by leave type. */
async function balancesOf(s) {
  const r = await s.call(`/v1/leave/my/balances?year=${year}`)
  return Object.fromEntries((r.json || []).map((b) => [b.leaveTypeId, { available: b.available, pending: b.pending, used: b.used, total: b.totalEntitlement + b.carryForward, notes: { nextCredit: b.nextCredit, resetsOn: b.resetsOn, carryForwardCap: b.carryForwardCap } }]))
}

/** Mondays from two weeks out, all in this leave year when possible. */
function mondays(n) {
  let d = addDays(istToday(), 14)
  while (d.getUTCDay() !== 1) d = addDays(d, 1)
  const out = []
  for (let i = 0; out.length < n && i < 60; i++, d = addDays(d, 7)) if (addDays(d, 4).getUTCFullYear() === d.getUTCFullYear()) out.push(d)
  return out
}

/** Apply (for someone, or yourself), moving a week later while the dates overlap existing leave. */
async function applyFree(s, forId, typeId, startOffsetDays, days, reason, weeks) {
  for (const monday of weeks) {
    const start = addDays(monday, startOffsetDays), end = addDays(start, days - 1)
    const path = forId ? `/v1/leave/apply/for/${forId}` : '/v1/leave/apply'
    const r = await s.call(path, 'POST', { leaveTypeId: typeId, startDate: iso(start), endDate: iso(end), duration: 'FULL_DAY', reason })
    if (r.status === 201) { created.leave.push({ id: r.json.id, owner: forId || s.employeeId }); return { ...r, start, end } }
    if (r.json?.errorCode !== 'LEAVE_DATES_OVERLAP') return { ...r, start, end }
  }
  return { status: 0, json: { errorCode: 'NO_FREE_WEEK' } }
}

try {
  // ── A. who may call what ───────────────────────────────────────────────
  const weeks = mondays(12)
  const readerBefore = await balancesOf(reader)
  const typeId = Object.entries(readerBefore).sort((a, b) => b[1].available - a[1].available)[0]?.[0]
  check('setup: reader has a leave balance to test with', typeId && readerBefore[typeId].available >= 6, JSON.stringify(readerBefore[typeId] || {}))
  const probeBody = { leaveTypeId: typeId, startDate: iso(weeks[0]), endDate: iso(weeks[0]), duration: 'FULL_DAY', reason: 'Local QA probe' }

  const forReaderByMgr = await mgr.call(`/v1/leave/apply/for/${reader.employeeId}`, 'POST', probeBody)
  check('apply on behalf: a manager without the permission gets 403', forReaderByMgr.status === 403, `status=${forReaderByMgr.status}`)
  const forMgrByReader = await reader.call(`/v1/leave/apply/for/${mgr.employeeId}`, 'POST', probeBody)
  check('apply on behalf: an employee gets 403', forMgrByReader.status === 403, `status=${forMgrByReader.status}`)
  for (const s of [owner, fin, hrm]) {
    const self = await s.call(`/v1/leave/apply/for/${s.employeeId}`, 'POST', probeBody)
    check(`apply on behalf: ${s.email.split('@')[0]} holds the permission (only "not for yourself" stops them)`, self.status === 422 && self.json?.errorCode === 'LEAVE_ON_BEHALF_SELF', `status=${self.status} ${self.json?.errorCode}`)
  }
  for (const [s, want] of [[owner, 200], [hrm, 200], [fin, 200], [mgr, 403], [reader, 403]]) {
    const b = await s.call(`/v1/leave/balances?companyId=${company}&year=${year}`)
    const u = await s.call(`/v1/leave/usage?companyId=${company}&year=${year}`)
    check(`all balances + usage: ${s.email.split('@')[0]} → ${want}`, b.status === want && u.status === want, `balances=${b.status} usage=${u.status}`)
  }
  for (const [s, want] of [[owner, 200], [mgr, 200], [fin, 403], [reader, 403]]) {
    const r = await s.call('/v1/leave/approvals/stats')
    check(`approval stats: ${s.email.split('@')[0]} → ${want}`, r.status === want, `status=${r.status}`)
  }
  for (const [s, want] of [[owner, 200], [hrm, 200], [fin, 403], [mgr, 403], [reader, 403]]) {
    const r = await s.call('/v1/leave/encashments/summary')
    check(`encash summary: ${s.email.split('@')[0]} → ${want}`, r.status === want, `status=${r.status}`)
  }
  for (const s of [reader, fin]) {
    const r = await s.call('/v1/leave/approvals/bulk-decision', 'POST', { ids: [randomUUID()], status: 'APPROVED' })
    check(`approve all: ${s.email.split('@')[0]} (no approval permission) gets 403`, r.status === 403, `status=${r.status}`)
  }
  const statsOwner = await owner.call('/v1/leave/approvals/stats?months=7')
  check('approval stats: HR / owner see the whole workspace with a 7-month series', statsOwner.json?.scope === 'TENANT' && statsOwner.json?.months?.length === 7 && typeof statsOwner.json?.pendingL2 === 'number' && !!statsOwner.json?.nextWorkingDay, JSON.stringify(statsOwner.json).slice(0, 220))
  const statsMgr = await mgr.call('/v1/leave/approvals/stats')
  check('approval stats: a manager sees their team, never the HR queue', statsMgr.json?.scope === 'TEAM' && statsMgr.json?.pendingL2 === 0, JSON.stringify(statsMgr.json).slice(0, 160))
  const from = iso(weeks[0]), to = iso(addDays(weeks[0], 30))
  for (const [s, scope] of [[owner, 'TENANT'], [mgr, 'TEAM'], [reader, 'SELF'], [fin, 'SELF']]) {
    const r = await s.call(`/v1/leave/calendar?from=${from}&to=${to}`)
    check(`calendar: ${s.email.split('@')[0]} sees ${scope}`, r.status === 200 && r.json?.scope === scope && Array.isArray(r.json?.entries), `status=${r.status} scope=${r.json?.scope}`)
  }
  const tooLong = await owner.call(`/v1/leave/calendar?from=${from}&to=${iso(addDays(weeks[0], 70))}`)
  check('calendar: more than 62 days is refused (400)', tooLong.status === 400 && tooLong.json?.errorCode === 'INVALID_DATE_RANGE', `status=${tooLong.status}`)
  const rejected = await owner.call(`/v1/leave/calendar?from=${from}&to=${to}&statuses=REJECTED`)
  check('calendar: only approved / pending / awaiting-HR statuses (400 otherwise)', rejected.status === 400, `status=${rejected.status}`)
  const histBad = await owner.call('/v1/leave/approvals/history?status=PENDING')
  check('decided: PENDING is not a decided status (400)', histBad.status === 400 && histBad.json?.errorCode === 'INVALID_LEAVE_STATUS', `status=${histBad.status}`)
  for (const s of [reader, mgr, fin]) {
    const r = await s.call(`/v1/settings/holidays/${randomUUID()}`, 'PUT', { holidayDate: from, holidayName: 'x' })
    check(`holiday edit: ${s.email.split('@')[0]} (no settings.holidays.write) gets 403`, r.status === 403, `status=${r.status}`)
  }

  // ── B. apply on behalf, then cancel: balances come back ────────────────
  const preview = await reader.call(`/v1/leave/preview?leaveTypeId=${typeId}&startDate=${iso(weeks[0])}&endDate=${iso(addDays(weeks[0], 1))}&duration=FULL_DAY`)
  const onBehalf = await applyFree(hrm, reader.employeeId, typeId, 0, 2, 'Local QA: applied by HR on behalf', weeks)
  const lr = onBehalf.json || {}
  check('apply on behalf: 201, filed for reader, waiting', onBehalf.status === 201 && lr.employeeId === reader.employeeId && lr.status === 'PENDING', `status=${onBehalf.status} ${JSON.stringify(lr).slice(0, 200)}`)
  check('apply on behalf: it goes to reader\'s own approver (their manager)', lr.approverName === 'Dept Manager', `approverName=${lr.approverName}`)
  check('apply on behalf: who applied is shown', lr.raisedByName === 'HR Manager', `raisedByName=${lr.raisedByName}`)
  if (onBehalf.start && iso(onBehalf.start) === iso(weeks[0])) {
    check('preview: same working days and approver as the request applying made', preview.status === 200 && preview.json?.canApply === true && preview.json?.workingDays === lr.totalDays && preview.json?.approverName === 'Dept Manager' && preview.json?.balanceAfter === readerBefore[typeId].available - lr.totalDays, JSON.stringify(preview.json).slice(0, 240))
  } else check('preview: ok (week moved because of existing leave)', preview.status === 200, `status=${preview.status}`)
  const afterApply = await balancesOf(reader)
  check('apply on behalf: reader\'s balance holds the days as pending', afterApply[typeId]?.pending === readerBefore[typeId].pending + lr.totalDays && afterApply[typeId]?.available === readerBefore[typeId].available - lr.totalDays, JSON.stringify(afterApply[typeId]))
  check('balance notes: reset date and carry-forward cap are there', afterApply[typeId]?.notes?.resetsOn === `${year + 1}-01-01` && typeof afterApply[typeId]?.notes?.carryForwardCap === 'number', JSON.stringify(afterApply[typeId]?.notes))
  const mine = await reader.call('/v1/leave/my?size=50')
  const mineRow = (mine.json?.content || []).find((r) => r.id === lr.id)
  check('my leave: reader sees who applied and who it went to', mineRow?.raisedByName === 'HR Manager' && mineRow?.approverName === 'Dept Manager' && mineRow?.conflicts == null, JSON.stringify(mineRow || {}).slice(0, 200))
  const notif = await reader.call('/v1/notifications?size=50')
  const told = (notif.json?.content || []).find((n) => n.type === 'LEAVE_APPLIED_ON_BEHALF' && n.data?.leaveRequestId === lr.id)
  check('apply on behalf: reader is told who applied', !!told && /HR Manager/.test(told.body || '') && told.data?.route === '/leave-history', JSON.stringify(told || {}).slice(0, 220))
  const queue = await mgr.call('/v1/leave/approvals/pending?size=50')
  const qRow = (queue.json?.content || []).find((r) => r.id === lr.id)
  check('approvals queue: the approver sees it with its details and checks', !!qRow && qRow.employeeName === 'Reader User' && Array.isArray(qRow.conflicts) && !!qRow.leaveTypeCode && typeof qRow.balanceAvailable === 'number', JSON.stringify(qRow || {}).slice(0, 220))
  const again = await hrm.call(`/v1/leave/apply/for/${reader.employeeId}`, 'POST', { leaveTypeId: typeId, startDate: lr.startDate, endDate: lr.endDate, duration: 'FULL_DAY', reason: 'Local QA overlap' })
  check('apply on behalf: reader\'s usual rules apply (overlap refused, 422)', again.status === 422 && again.json?.errorCode === 'LEAVE_DATES_OVERLAP', `status=${again.status} ${again.json?.errorCode}`)
  const cancel = await reader.call(`/v1/leave/${lr.id}/cancel?reason=${encodeURIComponent('Local QA cleanup')}`, 'POST')
  const afterCancel = await balancesOf(reader)
  check('cancel: reader cancels the request HR applied for', cancel.status === 204, `status=${cancel.status}`)
  // The balances list comes back in any order: compare type by type.
  const numbers = (b) => JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k].available, b[k].pending, b[k].used]))
  check('cancel: every balance is back to its value before', numbers(afterCancel) === numbers(readerBefore), JSON.stringify(afterCancel[typeId]))

  // ── C. approve all: two requests in one call ───────────────────────────
  const r1 = await applyFree(hrm, reader.employeeId, typeId, 0, 1, 'Local QA: bulk 1', weeks.slice(1))
  const r2 = await applyFree(hrm, reader.employeeId, typeId, 2, 1, 'Local QA: bulk 2', weeks.slice(1))
  const stranger = randomUUID()
  const bulk = await mgr.call('/v1/leave/approvals/bulk-decision', 'POST', { ids: [r1.json?.id, r2.json?.id, stranger], status: 'APPROVED', comment: 'Local QA bulk' })
  const byId = Object.fromEntries((bulk.json?.results || []).map((x) => [x.id, x]))
  check('approve all: both requests approved in one call', bulk.status === 200 && byId[r1.json?.id]?.ok && byId[r2.json?.id]?.ok && byId[r1.json?.id]?.status === 'APPROVED', `status=${bulk.status} ${JSON.stringify(bulk.json).slice(0, 240)}`)
  check('approve all: one it cannot decide is reported, not fatal', bulk.json?.requested === 3 && bulk.json?.decided === 2 && bulk.json?.failed === 1 && byId[stranger]?.ok === false && !!byId[stranger]?.errorCode, JSON.stringify(byId[stranger] || {}))
  const afterBulk = await balancesOf(reader)
  check('approve all: the days moved from pending to used', afterBulk[typeId]?.used === readerBefore[typeId].used + 2 && afterBulk[typeId]?.pending === readerBefore[typeId].pending, JSON.stringify(afterBulk[typeId]))
  const decided = await mgr.call('/v1/leave/approvals/history?status=APPROVED&size=50')
  const dRow = (decided.json?.content || []).find((x) => x.id === r1.json?.id)
  check('decided: filtered to approved, with counts and who decided', decided.status === 200 && (decided.json?.content || []).every((x) => x.status === 'APPROVED') && dRow?.decidedByName === 'Dept Manager' && decided.json?.counts?.APPROVED >= 2, `counts=${JSON.stringify(decided.json?.counts)} decidedBy=${dRow?.decidedByName}`)
  const statsAfter = await mgr.call('/v1/leave/approvals/stats')
  check('approval stats: this month\'s approvals include them', statsAfter.json?.approvedThisMonth >= 2, `approvedThisMonth=${statsAfter.json?.approvedThisMonth}`)
  // Every bulk decision reached the undo journal (P-TEAM): the decider can take one back.
  const undo = await mgr.call(`/v1/leave/${r1.json?.id}/decision/undo`, 'POST')
  const afterUndo = await balancesOf(reader)
  check('approve all: a bulk decision can be taken back (it was journaled)', undo.status === 200 && undo.json?.status === 'PENDING', `status=${undo.status} ${JSON.stringify(undo.json).slice(0, 160)}`)
  check('approve all: taking it back returns its day to pending', afterUndo[typeId]?.used === readerBefore[typeId].used + 1 && afterUndo[typeId]?.pending === readerBefore[typeId].pending + 1, JSON.stringify(afterUndo[typeId]))
  for (const r of [r1, r2]) {
    const c = await reader.call(`/v1/leave/${r.json?.id}/cancel?reason=${encodeURIComponent('Local QA cleanup')}`, 'POST')
    check('approve all cleanup: reader cancels the leave', c.status === 204, `status=${c.status}`)
  }
  const afterBulkCancel = await balancesOf(reader)
  check('approve all cleanup: balances back to before', afterBulkCancel[typeId]?.used === readerBefore[typeId].used && afterBulkCancel[typeId]?.available === readerBefore[typeId].available, JSON.stringify(afterBulkCancel[typeId]))

  // ── D. holiday: add, edit, restore, archive ────────────────────────────
  const hWeek = weeks[6]
  const original = { companyId: company, holidayDate: iso(addDays(hWeek, 2)), holidayName: 'Local QA P-LEAVE holiday' }
  const added = await owner.call('/v1/settings/holidays', 'POST', original)
  const hid = added.json?.id
  if (hid) created.holidays.push(hid)
  check('holiday: added for the edit check', added.status === 201 && !!hid, `status=${added.status}`)
  const edited = await owner.call(`/v1/settings/holidays/${hid}`, 'PUT', { holidayDate: iso(addDays(hWeek, 3)), holidayName: 'Local QA P-LEAVE holiday (edited)', holidayType: 'FESTIVAL', description: 'Moved to Thursday' })
  check('holiday edit: date, name, type and description change', edited.status === 200 && edited.json?.holidayDate === iso(addDays(hWeek, 3)) && edited.json?.holidayName === 'Local QA P-LEAVE holiday (edited)' && edited.json?.holidayType === 'FESTIVAL' && edited.json?.description === 'Moved to Thursday' && edited.json?.companyId === company, JSON.stringify(edited.json).slice(0, 200))
  const listed = await reader.call(`/v1/settings/holidays?companyId=${company}&year=${hWeek.getUTCFullYear()}`)
  check('holiday edit: everyone sees the edited holiday', (listed.json || []).some((h) => h.id === hid && h.holidayName === 'Local QA P-LEAVE holiday (edited)'))
  const weekPreview = await reader.call(`/v1/leave/preview?leaveTypeId=${typeId}&startDate=${iso(hWeek)}&endDate=${iso(addDays(hWeek, 4))}`)
  check('holiday edit: leave counting follows the new date (4 working days that week)', weekPreview.json?.workingDays === 4, `workingDays=${weekPreview.json?.workingDays}`)
  const restored = await owner.call(`/v1/settings/holidays/${hid}`, 'PUT', { holidayDate: original.holidayDate, holidayName: original.holidayName, holidayType: 'COMPANY', description: '' })
  check('holiday edit: restored to what it was', restored.status === 200 && restored.json?.holidayDate === original.holidayDate && restored.json?.holidayName === original.holidayName && restored.json?.holidayType === 'COMPANY' && restored.json?.description == null, JSON.stringify(restored.json).slice(0, 200))
  const missing = await owner.call(`/v1/settings/holidays/${randomUUID()}`, 'PUT', { holidayDate: original.holidayDate, holidayName: 'x' })
  check('holiday edit: an unknown holiday is 404', missing.status === 404, `status=${missing.status}`)
  const noName = await owner.call(`/v1/settings/holidays/${hid}`, 'PUT', { holidayDate: original.holidayDate, holidayName: ' ' })
  check('holiday edit: a name is required (400)', noName.status === 400, `status=${noName.status}`)
  const archived = await owner.call(`/v1/settings/holidays/${hid}`, 'DELETE')
  const editArchived = await owner.call(`/v1/settings/holidays/${hid}`, 'PUT', { holidayDate: original.holidayDate, holidayName: 'x' })
  check('holiday edit: an archived holiday can\'t be edited (404)', archived.status === 204 && editArchived.status === 404, `archive=${archived.status} edit=${editArchived.status}`)

  // ── E. colleagues off: first names, approved only, same department ─────
  beforeDept = sql(`select id || ':' || coalesce(department_id::text, '') from hrms.employees where id in ('${reader.employeeId}','${mgr.employeeId}') order by id`)
  const dept = await owner.call('/v1/hrms/departments', 'POST', { companyId: company, name: `Local QA P-LEAVE team ${Date.now()}` })
  const deptId = dept.json?.id
  if (deptId) created.departments.push(deptId)
  cleanup.push(() => {
    for (const line of beforeDept.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [id, d] = line.split(':').map((x) => x.trim())
      sql(`update hrms.employees set department_id = ${d ? `'${d}'` : 'null'} where id = '${id}'`)
    }
  })
  check('colleagues off: a department for the check', dept.status === 201 && !!deptId, `status=${dept.status}`)
  const noDept = await reader.call(`/v1/leave/team-off?from=${iso(weeks[8])}&to=${iso(addDays(weeks[8], 13))}`)
  check('colleagues off: nobody to show without a department', noDept.status === 200 && (noDept.json?.inDepartment === false ? noDept.json.days.length === 0 : true), JSON.stringify(noDept.json).slice(0, 120))
  sql(`update hrms.employees set department_id = '${deptId}' where id in ('${reader.employeeId}','${mgr.employeeId}')`)
  const mgrBefore = await balancesOf(mgr)
  const mgrType = Object.entries(mgrBefore).sort((a, b) => b[1].available - a[1].available)[0]?.[0] || typeId
  const approvedLeave = await applyFree(hrm, mgr.employeeId, mgrType, 0, 2, 'Local QA: colleague away', weeks.slice(8))
  const approve = await owner.call(`/v1/leave/${approvedLeave.json?.id}/decision`, 'POST', { status: 'APPROVED', comment: 'Local QA' })
  const pendingLeave = await applyFree(hrm, mgr.employeeId, mgrType, 3, 1, 'Local QA: colleague asked', [approvedLeave.start ? addDays(approvedLeave.start, 0) : weeks[8], ...weeks.slice(9)])
  check('colleagues off: mgr has one approved and one pending request', approvedLeave.status === 201 && approve.status === 200 && pendingLeave.status === 201, `apply=${approvedLeave.status} approve=${approve.status} pending=${pendingLeave.status}`)
  const offFrom = approvedLeave.start, offTo = addDays(approvedLeave.start, 13)
  const off = await reader.call(`/v1/leave/team-off?from=${iso(offFrom)}&to=${iso(offTo)}`)
  const days = off.json?.days || []
  const dayOf = (d) => days.find((x) => x.date === iso(d))
  check('colleagues off: reader sees mgr\'s first name on the approved days', off.status === 200 && off.json?.inDepartment === true && dayOf(approvedLeave.start)?.names?.includes('Dept') && dayOf(addDays(approvedLeave.start, 1))?.names?.includes('Dept'), JSON.stringify(off.json).slice(0, 240))
  check('colleagues off: never the pending request', !dayOf(pendingLeave.start)?.names?.includes('Dept'), JSON.stringify(dayOf(pendingLeave.start) || {}))
  check('colleagues off: first names only, no type, no ids', days.every((d) => Object.keys(d).sort().join() === 'date,names' && d.names.every((n) => !/Manager|User/.test(n))) && !JSON.stringify(off.json).includes(mgr.employeeId) && !/leaveType|Casual|QA leave/i.test(JSON.stringify(off.json)), JSON.stringify(days).slice(0, 200))
  check('colleagues off: never yourself', !JSON.stringify(off.json).includes('Reader'))
  const readerCal = await reader.call(`/v1/leave/calendar?from=${iso(offFrom)}&to=${iso(offTo)}&statuses=APPROVED,PENDING`)
  check('calendar: reader\'s own calendar doesn\'t show a colleague\'s leave', readerCal.status === 200 && !(readerCal.json?.entries || []).some((e) => e.employeeId === mgr.employeeId))
  const ownerCal = await owner.call(`/v1/leave/calendar?from=${iso(offFrom)}&to=${iso(offTo)}&statuses=APPROVED,PENDING`)
  const ownerIds = (ownerCal.json?.entries || []).map((e) => e.id)
  check('calendar: HR sees approved and, when asked, pending leave', ownerIds.includes(approvedLeave.json?.id) && ownerIds.includes(pendingLeave.json?.id))
  const ownerCalApproved = await owner.call(`/v1/leave/calendar?from=${iso(offFrom)}&to=${iso(offTo)}`)
  check('calendar: approved only by default', !(ownerCalApproved.json?.entries || []).some((e) => e.id === pendingLeave.json?.id) && (ownerCalApproved.json?.entries || []).some((e) => e.id === approvedLeave.json?.id))
  for (const r of [approvedLeave, pendingLeave]) {
    const c = await mgr.call(`/v1/leave/${r.json?.id}/cancel?reason=${encodeURIComponent('Local QA cleanup')}`, 'POST')
    check('colleagues off cleanup: mgr cancels', c.status === 204, `status=${c.status}`)
  }
  const mgrAfter = await balancesOf(mgr)
  check('colleagues off cleanup: mgr\'s balances back to before', mgrAfter[mgrType]?.available === mgrBefore[mgrType]?.available && mgrAfter[mgrType]?.used === mgrBefore[mgrType]?.used && mgrAfter[mgrType]?.pending === mgrBefore[mgrType]?.pending, JSON.stringify(mgrAfter[mgrType]))

  // ── F. the other reads ──────────────────────────────────────────────────
  const all = await hrm.call(`/v1/leave/balances?companyId=${company}&year=${year}&q=reader&size=20`)
  const readerRow = (all.json?.content || []).find((p) => p.employeeId === reader.employeeId)
  check('all balances: search finds reader with each type\'s balance', all.status === 200 && !!readerRow && readerRow.balances.some((b) => b.leaveTypeId === typeId && b.available === readerBefore[typeId].available), JSON.stringify(readerRow || {}).slice(0, 200))
  const everyone = await fin.call(`/v1/leave/balances?companyId=${company}&year=${year}&size=100`)
  check('all balances: people on probation and notice are included, people who left are not', (everyone.json?.content || []).some((p) => p.employmentStatus === 'PROBATION') && !(everyone.json?.content || []).some((p) => ['EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED'].includes(p.employmentStatus)), `total=${everyone.json?.totalElements}`)
  const usage = await owner.call(`/v1/leave/usage?companyId=${company}&year=${year}`)
  check('usage: per leave type, used and granted', usage.status === 200 && (usage.json?.types || []).length > 0 && usage.json.types.every((t) => typeof t.used === 'number' && typeof t.granted === 'number'), JSON.stringify(usage.json).slice(0, 160))
  const encash = await hrm.call('/v1/leave/encashments/summary')
  check('encash summary: can encash now, in total and per type', encash.status === 200 && typeof encash.json?.days === 'number' && Array.isArray(encash.json?.types), JSON.stringify(encash.json).slice(0, 160))
  const l2 = await owner.call('/v1/leave/approvals/pending-l2')
  check('HR queue (awaiting HR): still answers for level-2 approvers', l2.status === 200)
  const l2Mgr = await mgr.call('/v1/leave/approvals/pending-l2')
  check('HR queue (awaiting HR): not for a manager (403)', l2Mgr.status === 403, `status=${l2Mgr.status}`)
} catch (e) {
  check('no unexpected error', false, e.stack || String(e))
} finally {
  // Notifications about our requests, for everyone involved.
  const ids = new Set(created.leave.map((x) => x.id))
  for (const s of [reader, mgr, hrm, owner]) {
    try {
      const n = await s.call('/v1/notifications?size=100')
      for (const row of n.json?.content || []) if (ids.has(row.data?.leaveRequestId)) await s.call(`/v1/notifications/${row.id}`, 'DELETE')
    } catch { /* best effort */ }
  }
  for (const f of cleanup.reverse()) { try { await f() } catch (e) { console.log('cleanup error', e.message) } }
  for (const d of created.departments) { try { await owner.call(`/v1/hrms/departments/${d}`, 'DELETE') } catch { /* ignore */ } }
  // The slot's throwaway database only: remove the rows themselves.
  try {
    if (ids.size) sqlDev(`delete from leave_mgmt.leave_requests where id in (${[...ids].map((i) => `'${i}'`).join(',')}) and status in ('CANCELLED','REJECTED')`)
    for (const h of created.holidays) sqlDev(`delete from settings.holiday_calendar where id = '${h}' and is_active = false`)
    for (const d of created.departments) sqlDev(`delete from hrms.departments where id = '${d}' and not exists (select 1 from hrms.employees where department_id = '${d}')`)
  } catch (e) { console.log('sql cleanup error', e.message) }
  const leftOpen = ids.size ? sql(`select count(*) from leave_mgmt.leave_requests where id in (${[...ids].map((i) => `'${i}'`).join(',')}) and status in ('PENDING','PENDING_L2','APPROVED')`) : '0'
  check('cleanup: none of our leave requests is left open', leftOpen === '0', `open=${leftOpen}`)
  if (beforeDept) {
    const back = sql(`select id || ':' || coalesce(department_id::text, '') from hrms.employees where id in ('${reader.employeeId}','${mgr.employeeId}') order by id`)
    check('cleanup: reader and mgr are back in their own departments', back === beforeDept, `${back} vs ${beforeDept}`)
  }
  check('no FEATURE_NOT_READY (every migration is applied here)', notReady.length === 0, notReady.join('; '))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
