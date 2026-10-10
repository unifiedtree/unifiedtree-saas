// Live check of shift planning Phase 1, package A (store, publish, schedule, notifications), API only.
//
//   · owner (HR/Admin): roster settings; a rotation pattern; a draft roster for a department; save with the lock;
//     a stale save is 409 ROSTER_CHANGED; publish (days from today on, one history row each); the members read
//     their schedule at /v1/schedule/me and are told ("Your shift schedule is ready"); change a day and clear one,
//     publish again (CHANGED + REMOVED, "Your schedule changed"); history newest first; team schedule;
//     a published roster's dates are locked and it can't be deleted; another roster for the same person and day
//     is refused (E3); discard changes; the preview and check answer when the planner package is in the build
//   · mgr@unifiedtree.demo (DEPT_MANAGER), made head of a department this test creates (undone at the end): plans a
//     roster for that department, can't plan one outside it or with someone outside it, can't publish
//   · an employee (reader@): no roster endpoints (403), but their own schedule (200)
// Everything it creates is removed at the end (SQL on the slot's database, as the other live tests do).
//
//   live-slot.sh /c/REACT/ut-wt/shift-p1-store 3191 node e2e/recovery/live-w3-shift-p1-api.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD
/* global process, console, fetch, setTimeout */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ROLE_EMPLOYEE = '00000000-0000-0000-0000-000000000004'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => { results.push({ name, ok: true }); console.log(`PASS  ${name}  — skipped: ${why}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = istToday()
const end = addDays(today, 13)

// ── sessions ────────────────────────────────────────────────────────────────
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
    if (res.status >= 500 && !(json && json.errorCode === 'FEATURE_NOT_READY')) surprises.push(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const tag = randomUUID().slice(0, 6)
const DEPT = randomUUID(), M1 = randomUUID(), M2 = randomUUID(), O = randomUUID()
const UM1 = randomUUID()
const DAY = randomUUID(), NIGHT = randomUUID()
const people = { M1, M2, O }
const NAME = { M1: 'Member1', M2: 'Member2', O: 'Outside' }
const email = (k) => `qa-shift-${NAME[k].toLowerCase()}-${tag}@example.invalid`
const everyone = Object.values(people)
const created = { rosters: [], templates: [] }
let settingsBefore = null

function insertFixtures() {
  const emp = (k, dept) => `('${people[k]}','${tenant}','${company}','QSH-${NAME[k].slice(0, 3)}-${tag}','QA Shift','${NAME[k]}-${tag}','${email(k)}',
      'FULL_TIME','ACTIVE',${dept ? `'${dept}'` : 'NULL'},'2025-01-01','qa','qa')`
  const login = (u, k, role) => `INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active)
      SELECT '${u}','${tenant}','${email(k)}',password_hash,'${people[k]}',true FROM auth.user_credentials
       WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) VALUES ('${tenant}','${u}','${role}');`
  sql(`BEGIN;
    INSERT INTO hrms.departments(id,tenant_id,company_id,name,code,is_active,created_by,updated_by) VALUES
      ('${DEPT}','${tenant}','${company}','QA Shift Ops ${tag}','QSO${tag}',true,'qa','qa');
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      department_id,date_of_joining,created_by,updated_by) VALUES
      ${emp('M1', DEPT)}, ${emp('M2', DEPT)}, ${emp('O', null)};
    INSERT INTO attendance.shift_policies(id,tenant_id,company_id,name,code,shift_type,start_time,end_time) VALUES
      ('${DAY}','${tenant}','${company}','QA Day ${tag}','QD${tag.slice(0, 3)}','FIXED','09:00','17:00'),
      ('${NIGHT}','${tenant}','${company}','QA Night ${tag}','QN${tag.slice(0, 3)}','NIGHT','22:00','06:00');
    ${login(UM1, 'M1', ROLE_EMPLOYEE)}
    COMMIT;`)
}

const P = (d) => ({ shiftPolicyId: d, weeklyOff: false })
const WO = { shiftPolicyId: null, weeklyOff: true }
const pattern = [P(DAY), P(DAY), P(NIGHT), P(NIGHT), WO]
const tokenAt = (offset, i) => { const p = pattern[(i + offset) % pattern.length]; return p.weeklyOff ? 'WO' : p.shiftPolicyId }
const days = 14
const rowFor = (emp, offset, edit = (i, t) => t) => ({ employeeId: emp, cells: Array.from({ length: days }, (_, i) => edit(i, tokenAt(offset, i))), edited: [] })
const config = (templateId) => ({ templateId, pattern, repeats: true, weeklyOffMode: 'ROTATIONAL', staggerMode: 'SPREAD', continueFromRosterId: null, shiftIds: [DAY, NIGHT], designationIds: [] })
const draftBody = (over = {}) => ({
  name: `QA Shift ${tag}`, periodType: 'RANGE', startDate: today, endDate: end, departmentId: DEPT, branchId: null,
  config: config(null), members: [{ employeeId: M1, rotationOffset: 0 }, { employeeId: M2, rotationOffset: 2 }],
  staffing: [], rows: [rowFor(M1, 0), rowFor(M2, 2)], ...over,
})
const notices = (rosterId, type) => num(`select count(*) from notif.notifications where tenant_id='${tenant}' and type='${type}' and data::text ~ '${rosterId}'`)
async function waitFor(fn, ms = 15000) { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return true; await wait(500) } return false }

async function main(owner) {
  insertFixtures()
  const head = await session('mgr@unifiedtree.demo')
  sql(`UPDATE hrms.departments SET department_head_employee_id='${head.employeeId}' WHERE id='${DEPT}'`)
  const m1 = await session(email('M1'))
  const reader = await session('reader@unifiedtree.demo')
  check('fixture: mgr@ heads the new department and a member can sign in', !!head.employeeId && m1.employeeId === M1)

  // ── settings ──────────────────────────────────────────────────────────────
  const s0 = await owner.call(`/v1/rosters/settings?companyId=${company}`)
  check('settings: GET 200 with the minimum rest', s0.status === 200 && Number.isInteger(s0.json?.minRestMinutes), `${s0.status} ${JSON.stringify(s0.json)}`)
  check('settings: rosters don\'t drive attendance (Phase 3\'s switch, off)', s0.json?.rostersDriveAttendance === false)
  settingsBefore = { row: num(`select count(*) from attendance.roster_settings where tenant_id='${tenant}' and company_id='${company}'`), min: s0.json?.minRestMinutes }
  const s1 = await owner.call(`/v1/rosters/settings?companyId=${company}`, 'PUT', { minRestMinutes: 420 })
  check('settings: PUT 420 minutes', s1.status === 200 && s1.json?.minRestMinutes === 420 && !!s1.json?.updatedByName, `${s1.status}`)
  const bad = await owner.call(`/v1/rosters/settings?companyId=${company}`, 'PUT', { minRestMinutes: 2000 })
  check('settings: more than 24 hours is refused (400)', bad.status === 400, `${bad.status} ${bad.json?.errorCode}`)

  // ── a rotation pattern ────────────────────────────────────────────────────
  const t = await owner.call(`/v1/rotation-templates?companyId=${company}`, 'POST', { name: `QA DDNNWO ${tag}`, departmentId: null, repeats: true, days: pattern })
  check('pattern: POST 201', t.status === 201 && t.json?.days?.length === 5 && t.json?.editable === true, `${t.status} ${JSON.stringify(t.json)?.slice(0, 200)}`)
  if (t.json?.id) created.templates.push(t.json.id)
  const tDup = await owner.call(`/v1/rotation-templates?companyId=${company}`, 'POST', { name: `qa ddnnwo ${tag}`, repeats: true, days: [WO] })
  check('pattern: the same name (any case) is 409 TEMPLATE_NAME_TAKEN', tDup.status === 409 && tDup.json?.errorCode === 'TEMPLATE_NAME_TAKEN', `${tDup.status}`)
  const tBad = await owner.call(`/v1/rotation-templates?companyId=${company}`, 'POST', { name: `QA bad ${tag}`, repeats: true, days: [{ shiftPolicyId: DAY, weeklyOff: true }] })
  check('pattern: a day that is a shift and WO is 400 TEMPLATE_INVALID', tBad.status === 400 && tBad.json?.errorCode === 'TEMPLATE_INVALID', `${tBad.status}`)
  const tl = await owner.call(`/v1/rotation-templates?companyId=${company}`)
  check('pattern: listed', tl.status === 200 && (tl.json || []).some((x) => x.id === t.json?.id))
  const hl = await head.call(`/v1/rotation-templates?companyId=${company}`)
  const seenByHead = (hl.json || []).find((x) => x.id === t.json?.id)
  check('pattern: the department head sees the company pattern read-only', hl.status === 200 && seenByHead && seenByHead.editable === false, `${hl.status}`)
  const hEdit = await head.call(`/v1/rotation-templates/${t.json?.id}`, 'PUT', { name: `QA hijack ${tag}`, repeats: true, days: [WO] })
  check('pattern: the department head can\'t change it (403 ROSTER_SCOPE)', hEdit.status === 403 && hEdit.json?.errorCode === 'ROSTER_SCOPE', `${hEdit.status}`)

  // ── the planner's preview (package B) ─────────────────────────────────────
  const pv = await owner.call(`/v1/rosters/preview?companyId=${company}`, 'POST', {
    startDate: today, endDate: end, departmentId: DEPT, branchId: null, rosterId: null, config: config(t.json?.id),
    members: draftBody().members, staffing: [], rows: draftBody().rows, regenerate: false, keepEdits: true,
  })
  if (pv.status === 404 || pv.status === 405) skip('preview: POST /v1/rosters/preview', 'the planner package (B) is not in this build')
  else check('preview: POST /v1/rosters/preview 200 with rows and checks', pv.status === 200 && Array.isArray(pv.json?.rows) && !!pv.json?.checks, `${pv.status}`)

  // ── a draft ───────────────────────────────────────────────────────────────
  const c = await owner.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ config: config(t.json?.id) }))
  check('draft: POST 201, DRAFT, version 0', c.status === 201 && c.json?.roster?.status === 'DRAFT' && c.json?.roster?.version === 0, `${c.status} ${JSON.stringify(c.json)?.slice(0, 240)}`)
  const id = c.json?.roster?.id
  if (!id) throw new Error('no roster created')
  created.rosters.push(id)
  check('draft: two people, a row each, 14 days', c.json.members.length === 2 && c.json.rows.length === 2 && c.json.rows[0].cells.length === days)
  check('draft: the owner can edit and publish it', c.json.roster.canEdit === true && c.json.roster.canPublish === true)
  check('draft: the department and the pattern are kept', c.json.roster.departmentId === DEPT && c.json.roster.departmentName === `QA Shift Ops ${tag}` && c.json.roster.config.templateId === t.json?.id)
  check('draft: nothing is published by a save', num(`select count(*) from attendance.schedule_days where roster_id='${id}'`) === 0)
  const list = await owner.call(`/v1/rosters?companyId=${company}`)
  check('draft: in the roster list', list.status === 200 && (list.json || []).some((r) => r.id === id && r.memberCount === 2), `${list.status}`)

  const u = await owner.call(`/v1/rosters/${id}`, 'PUT', draftBody({ name: `QA Shift ${tag} v2`, lockVersion: c.json.roster.lockVersion }))
  check('draft: PUT with the lock saves and moves the lock on', u.status === 200 && u.json?.roster?.lockVersion === c.json.roster.lockVersion + 1 && u.json.roster.name === `QA Shift ${tag} v2`, `${u.status} ${u.json?.errorCode}`)
  const stale = await owner.call(`/v1/rosters/${id}`, 'PUT', draftBody({ lockVersion: c.json.roster.lockVersion }))
  check('draft: a stale lock is 409 ROSTER_CHANGED', stale.status === 409 && stale.json?.errorCode === 'ROSTER_CHANGED', `${stale.status} ${stale.json?.errorCode}`)
  const longRange = await owner.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ endDate: addDays(today, 62), rows: [] }))
  check('draft: more than 62 days is 400 ROSTER_RANGE_INVALID', longRange.status === 400 && longRange.json?.errorCode === 'ROSTER_RANGE_INVALID', `${longRange.status}`)
  const junk = await owner.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ rows: [{ employeeId: M1, cells: ['XYZ'], edited: [] }] }))
  check('draft: a day that is neither WO nor a shift of the company is 400', junk.status === 400 && junk.json?.errorCode === 'ROSTER_INVALID', `${junk.status}`)

  const ck = await owner.call(`/v1/rosters/${id}/check`)
  if (ck.status === 503 && ck.json?.errorCode === 'FEATURE_NOT_READY') skip('check: GET /v1/rosters/{id}/check', 'the planner package (B) is not in this build')
  else check('check: GET /v1/rosters/{id}/check 200', ck.status === 200 && Array.isArray(ck.json?.errors), `${ck.status}`)

  // ── publish ───────────────────────────────────────────────────────────────
  const lock1 = u.json.roster.lockVersion
  const p1 = await owner.call(`/v1/rosters/${id}/publish`, 'POST', { lockVersion: lock1, acknowledgeWarnings: true, note: `QA first ${tag}` })
  check('publish: 200, version 1, 28 days added, 2 people to tell', p1.status === 200 && p1.json?.version === 1 && p1.json?.daysAdded === 28 && p1.json?.peopleToNotify === 2,
    `${p1.status} ${JSON.stringify(p1.json)?.slice(0, 300)}`)
  check('publish: the roster is PUBLISHED with nothing unpublished', p1.json?.roster?.status === 'PUBLISHED' && p1.json?.roster?.hasUnpublishedChanges === false && !!p1.json?.roster?.publishedByName)
  check('publish: 28 schedule days, none before today, all from this roster', num(`select count(*) from attendance.schedule_days where roster_id='${id}'`) === 28
    && num(`select count(*) from attendance.schedule_days where roster_id='${id}' and work_date < '${today}'`) === 0)
  check('publish: one history row per day, version 1, with the note', num(`select count(*) from attendance.schedule_day_history where roster_id='${id}' and roster_version=1 and change_kind='ADDED' and note='QA first ${tag}'`) === 28)
  check('publish: attendance is untouched (no shift assignment written for the members)', num(`select count(*) from attendance.employee_shift_assignments where employee_id in ('${M1}','${M2}')`) === 0)
  const told = await waitFor(() => notices(id, 'ROSTER_PUBLISHED') >= 2)
  check('publish: both members are told their schedule is ready (in the app)', told, `${notices(id, 'ROSTER_PUBLISHED')} notices`)
  check('publish: the notice opens My Schedule (data.route)', num(`select count(*) from notif.notifications where tenant_id='${tenant}' and type='ROSTER_PUBLISHED' and data::text ~ '${id}' and data->>'route' = '/my-schedule'`) >= 2)
  const wrongLock = await owner.call(`/v1/rosters/${id}/publish`, 'POST', { lockVersion: lock1, acknowledgeWarnings: true })
  check('publish: the old lock no longer works (409 ROSTER_CHANGED)', wrongLock.status === 409 && wrongLock.json?.errorCode === 'ROSTER_CHANGED', `${wrongLock.status}`)

  // ── the member's schedule ─────────────────────────────────────────────────
  const me = await m1.call(`/v1/schedule/me?from=${today}&to=${end}`)
  const mine = me.json?.days || []
  check('schedule/me: 200, 14 days for the member', me.status === 200 && me.json?.employeeId === M1 && mine.length === 14, `${me.status} ${mine.length}`)
  check('schedule/me: every day comes from the roster, in pattern order', mine.every((d) => d.source === 'ROSTER' && d.rosterId === id)
    && mine.map((d) => (d.kind === 'WO' ? 'WO' : d.shiftPolicyId)).join() === Array.from({ length: days }, (_, i) => tokenAt(0, i)).join(), JSON.stringify(mine.slice(0, 3)))
  check('schedule/me: the night shift is marked, with its times', mine[2]?.nightShift === true && mine[2]?.startTime === '22:00' && mine[2]?.endTime === '06:00', JSON.stringify(mine[2]))
  check('schedule/me: no employee name on "me"', !('employeeName' in (mine[0] || {})))
  const after = await m1.call(`/v1/schedule/me?from=${addDays(end, 1)}&to=${addDays(end, 3)}`)
  check('schedule/me: after the roster, the usual answer (BASELINE)', after.status === 200 && (after.json?.days || []).every((d) => d.source === 'BASELINE'), `${after.status}`)
  const tooLong = await m1.call(`/v1/schedule/me?from=${today}&to=${addDays(today, 62)}`)
  check('schedule/me: more than 62 days is 400', tooLong.status === 400 && tooLong.json?.errorCode === 'ROSTER_RANGE_INVALID', `${tooLong.status}`)
  const team = await owner.call(`/v1/schedule/team?from=${today}&to=${addDays(today, 2)}&departmentId=${DEPT}`)
  const teamM1 = (team.json || []).filter((d) => d.employeeId === M1)
  check('schedule/team: the department\'s people, named, from the roster', team.status === 200 && teamM1.length === 3 && teamM1.every((d) => d.source === 'ROSTER' && d.employeeName === `QA Shift Member1-${tag}`), `${team.status} ${teamM1.length}`)

  // ── change a day, clear one, publish again ────────────────────────────────
  const edit = (i, tkn) => (i === 1 ? NIGHT : i === 4 ? null : tkn)
  const u2 = await owner.call(`/v1/rosters/${id}`, 'PUT', draftBody({ name: `QA Shift ${tag} v2`, lockVersion: p1.json.roster.lockVersion ?? lock1 + 1,
    rows: [rowFor(M1, 0, edit), rowFor(M2, 2)] }))
  check('republish: the save marks unpublished changes', u2.status === 200 && u2.json?.roster?.hasUnpublishedChanges === true, `${u2.status} ${u2.json?.errorCode} ${u2.json?.message}`)
  const locked = await owner.call(`/v1/rosters/${id}`, 'PUT', draftBody({ endDate: addDays(end, 1), rows: [], lockVersion: u2.json?.roster?.lockVersion }))
  check('republish: a published roster\'s dates can\'t change (409 ROSTER_PERIOD_LOCKED)', locked.status === 409 && locked.json?.errorCode === 'ROSTER_PERIOD_LOCKED', `${locked.status}`)
  const p2 = await owner.call(`/v1/rosters/${id}/publish`, 'POST', { lockVersion: u2.json?.roster?.lockVersion, acknowledgeWarnings: true, note: `QA second ${tag}` })
  check('republish: 1 changed, 1 removed, 1 person told', p2.status === 200 && p2.json?.version === 2 && p2.json?.daysChanged === 1 && p2.json?.daysRemoved === 1 && p2.json?.daysAdded === 0 && p2.json?.peopleToNotify === 1,
    `${p2.status} ${JSON.stringify(p2.json)?.slice(0, 300)}`)
  check('republish: the changed day is NIGHT, version 2; the cleared day is gone', sql(`select shift_policy_id||'/'||roster_version from attendance.schedule_days where employee_id='${M1}' and work_date='${addDays(today, 1)}'`) === `${NIGHT}/2`
    && num(`select count(*) from attendance.schedule_days where employee_id='${M1}' and work_date='${addDays(today, 4)}'`) === 0)
  const changed = await waitFor(() => notices(id, 'ROSTER_DAY_CHANGED') >= 1)
  check('republish: the member is told their schedule changed', changed && num(`select count(*) from notif.notifications where tenant_id='${tenant}' and type='ROSTER_DAY_CHANGED' and data::text ~ '${id}' and user_id='${M1}'`) === 1)
  const hist = await owner.call(`/v1/rosters/${id}/history?employeeId=${M1}`)
  check('history: the member\'s changes, newest first', hist.status === 200 && hist.json?.length === 16 && hist.json[0].rosterVersion === 2
    && ['CHANGED', 'REMOVED'].includes(hist.json[0].change) && hist.json[0].note === `QA second ${tag}` && hist.json.at(-1).change === 'ADDED', `${hist.status} ${hist.json?.length}`)
  const changedRow = (hist.json || []).find((x) => x.change === 'CHANGED')
  check('history: codes, not ids (QD → QN)', changedRow?.oldCode === `QD${tag.slice(0, 3)}` && changedRow?.newCode === `QN${tag.slice(0, 3)}`, JSON.stringify(changedRow))
  const del = await owner.call(`/v1/rosters/${id}`, 'DELETE')
  check('delete: a published roster is kept (409 ROSTER_PUBLISHED)', del.status === 409 && del.json?.errorCode === 'ROSTER_PUBLISHED', `${del.status}`)

  // ── discard changes ───────────────────────────────────────────────────────
  const r2 = await owner.call(`/v1/rosters/${id}`)
  const u3 = await owner.call(`/v1/rosters/${id}`, 'PUT', draftBody({ name: `QA Shift ${tag} v2`, lockVersion: r2.json?.roster?.lockVersion,
    rows: [rowFor(M1, 0, (i, tkn) => (i === 6 ? null : edit(i, tkn))), rowFor(M2, 2)] }))
  check('discard: an unpublished edit', u3.status === 200 && u3.json?.roster?.hasUnpublishedChanges === true, `${u3.status} ${u3.json?.message}`)
  const dc = await owner.call(`/v1/rosters/${id}/discard-changes`, 'POST', { lockVersion: u3.json?.roster?.lockVersion })
  const m1Row = (dc.json?.rows || []).find((r) => r.employeeId === M1)
  check('discard: back to the published days', dc.status === 200 && dc.json?.roster?.hasUnpublishedChanges === false && m1Row?.cells[6] === tokenAt(0, 6) && m1Row?.cells[1] === NIGHT && m1Row?.cells[4] === null,
    `${dc.status} ${dc.json?.errorCode} ${JSON.stringify(m1Row?.cells?.slice(0, 7))}`)

  // ── another roster for the same person and day: E3 ────────────────────────
  const c2 = await owner.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ name: `QA Clash ${tag}`, departmentId: null, members: [{ employeeId: M1, rotationOffset: 0 }], rows: [rowFor(M1, 0)] }))
  if (c2.json?.roster?.id) created.rosters.push(c2.json.roster.id)
  check('clash: a second draft with the same person saves (drafts may overlap)', c2.status === 201, `${c2.status} ${c2.json?.errorCode}`)
  const p3 = await owner.call(`/v1/rosters/${c2.json?.roster?.id}/publish`, 'POST', { lockVersion: c2.json?.roster?.lockVersion, acknowledgeWarnings: true })
  const e3 = (p3.json?.checks?.errors || []).find((x) => x.id === 'E3')
  check('clash: its publish is 409 ROSTER_HAS_ERRORS with E3 and the other roster named', p3.status === 409 && p3.json?.errorCode === 'ROSTER_HAS_ERRORS' && e3?.employeeId === M1 && String(e3?.message).includes(`QA Shift ${tag} v2`),
    `${p3.status} ${JSON.stringify(p3.json)?.slice(0, 300)}`)
  check('clash: nothing of the second roster is published', num(`select count(*) from attendance.schedule_days where roster_id='${c2.json?.roster?.id}'`) === 0)
  const d2 = await owner.call(`/v1/rosters/${c2.json?.roster?.id}`, 'DELETE')
  check('clash: the unpublished draft can be deleted (204)', d2.status === 204, `${d2.status}`)

  // ── the department head ───────────────────────────────────────────────────
  const hList = await head.call(`/v1/rosters?companyId=${company}`)
  const hSeen = (hList.json || []).find((r) => r.id === id)
  check('head: sees the department\'s roster, may edit, may not publish', hList.status === 200 && hSeen?.canEdit === true && hSeen?.canPublish === false, `${hList.status} ${JSON.stringify(hSeen)?.slice(0, 160)}`)
  check('head: sees no roster outside the department', (hList.json || []).every((r) => r.departmentId === DEPT), `${(hList.json || []).length}`)
  const hc = await head.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ name: `QA Head ${tag}`, members: [{ employeeId: M2, rotationOffset: 0 }], rows: [rowFor(M2, 0)] }))
  if (hc.json?.roster?.id) created.rosters.push(hc.json.roster.id)
  check('head: plans a roster for the department they head (201)', hc.status === 201 && hc.json?.roster?.canPublish === false, `${hc.status} ${hc.json?.errorCode} ${hc.json?.message}`)
  const hOutside = await head.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ name: `QA Head company ${tag}`, departmentId: null }))
  check('head: a company-wide roster is 403 ROSTER_SCOPE', hOutside.status === 403 && hOutside.json?.errorCode === 'ROSTER_SCOPE', `${hOutside.status}`)
  const hO = await head.call(`/v1/rosters?companyId=${company}`, 'POST', draftBody({ name: `QA Head outsider ${tag}`, members: [{ employeeId: O, rotationOffset: 0 }], rows: [] }))
  check('head: someone outside the department is 403 ROSTER_SCOPE', hO.status === 403 && hO.json?.errorCode === 'ROSTER_SCOPE', `${hO.status}`)
  const hp = await head.call(`/v1/rosters/${hc.json?.roster?.id}/publish`, 'POST', { lockVersion: hc.json?.roster?.lockVersion, acknowledgeWarnings: true })
  check('head: can\'t publish (403)', hp.status === 403, `${hp.status} ${hp.json?.errorCode}`)
  const hd = await head.call(`/v1/rosters/${hc.json?.roster?.id}`, 'DELETE')
  check('head: deletes their own draft (204)', hd.status === 204, `${hd.status}`)

  // ── an employee ───────────────────────────────────────────────────────────
  const rl = await reader.call(`/v1/rosters?companyId=${company}`)
  check('employee: the roster list is 403', rl.status === 403, `${rl.status}`)
  const rt = await reader.call(`/v1/rotation-templates?companyId=${company}`, 'POST', { name: 'nope', repeats: true, days: [WO] })
  check('employee: can\'t make a pattern (403)', rt.status === 403, `${rt.status}`)
  const rp = await reader.call(`/v1/rosters/${id}/publish`, 'POST', { lockVersion: 0, acknowledgeWarnings: true })
  check('employee: can\'t publish (403)', rp.status === 403, `${rp.status}`)
  const rm = await reader.call(`/v1/schedule/me?from=${today}&to=${addDays(today, 6)}`)
  check('employee: their own schedule (200, their usual shift)', rm.status === 200 && rm.json?.days?.length === 7 && rm.json.days.every((d) => d.source === 'BASELINE'), `${rm.status}`)
  const rteam = await reader.call(`/v1/schedule/team?from=${today}&to=${today}`)
  check('employee: no team schedule (403)', rteam.status === 403, `${rteam.status}`)
}

async function restoreSettings(owner) {
  if (!settingsBefore) return
  if (settingsBefore.row === 0) {
    sql(`DELETE FROM attendance.roster_settings WHERE tenant_id='${tenant}' AND company_id='${company}'`)
  } else {
    const r = await owner.call(`/v1/rosters/settings?companyId=${company}`, 'PUT', { minRestMinutes: settingsBefore.min })
    check('cleanup: the minimum rest is put back', r.status === 200 && r.json?.minRestMinutes === settingsBefore.min)
  }
}

function cleanup() {
  const run = (what, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${what}: ${String(e.message).split('\n')[0]}`) } }
  const list = (ids) => ids.filter(Boolean).map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const ppl = list(everyone)
  const rosters = sql(`select string_agg(''''||id||'''', ',') from attendance.rosters where tenant_id='${tenant}' and name ~ '${tag}'`) || list(created.rosters)
  run('notifications', `DELETE FROM notif.notifications WHERE tenant_id='${tenant}' AND (user_id IN (${ppl}) OR data::text ~ '${[...created.rosters].join('|') || randomUUID()}')`)
  run('schedule', `BEGIN; DELETE FROM attendance.schedule_day_history WHERE roster_id IN (${rosters}) OR employee_id IN (${ppl});
    DELETE FROM attendance.schedule_days WHERE roster_id IN (${rosters}) OR employee_id IN (${ppl});
    DELETE FROM attendance.rosters WHERE id IN (${rosters}); COMMIT;`)
  run('patterns', `DELETE FROM attendance.rotation_templates WHERE tenant_id='${tenant}' AND name ~ '${tag}'`)
  for (const t of sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.column_name='user_id' and t.table_type='BASE TABLE' and c.table_schema='auth'`).split('\n').filter(Boolean)) {
    run(t, `DELETE FROM ${t} WHERE user_id IN ('${UM1}')`)
  }
  run('people', `BEGIN; DELETE FROM rbac.user_roles WHERE user_id IN ('${UM1}'); DELETE FROM auth.user_credentials WHERE id IN ('${UM1}');
    UPDATE hrms.departments SET department_head_employee_id=NULL WHERE id='${DEPT}';
    DELETE FROM hrms.employee_status_history WHERE employee_id IN (${ppl}); DELETE FROM hrms.employees WHERE id IN (${ppl});
    DELETE FROM hrms.departments WHERE id='${DEPT}';
    DELETE FROM attendance.shift_policies WHERE id IN ('${DAY}','${NIGHT}'); COMMIT;`)
  const tables = sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.column_name='employee_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')
      and c.table_name not like '%\\_20%' and c.table_name not like '%\\_default'`).split('\n').filter(Boolean)
  const left = tables.map((t) => [t, num(`select count(*) from ${t} where employee_id in (${ppl})`)]).filter(([, n]) => n > 0)
  const leftOther = num(`select count(*) from hrms.employees where id in (${ppl})`) + num(`select count(*) from hrms.departments where id='${DEPT}'`)
    + num(`select count(*) from attendance.rosters where tenant_id='${tenant}' and name ~ '${tag}'`)
    + num(`select count(*) from attendance.rotation_templates where tenant_id='${tenant}' and name ~ '${tag}'`)
    + num(`select count(*) from attendance.shift_policies where id in ('${DAY}','${NIGHT}')`)
  check('cleanup: nothing the test made is left behind', left.length === 0 && leftOther === 0, JSON.stringify(left) + ` other=${leftOther}`)
}

let owner = null
try {
  owner = await session('owner@unifiedtree.demo')
  await main(owner)
} catch (e) {
  check('script completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  if (owner) await restoreSettings(owner).catch((e) => check('cleanup: roster settings', false, String(e)))
  cleanup()
}
check('no unexpected 5xx', surprises.length === 0, surprises.slice(0, 5).join(' || '))
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
