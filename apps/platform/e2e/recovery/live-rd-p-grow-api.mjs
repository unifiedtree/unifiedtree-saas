// P-GROW backend — API-level live check against the real local API (redesign BW-78…BW-85):
//   BW-78 cycle dates + "hold feedback until shared": the manager's submitted review is
//         hidden from the reviewee's My reviews until an admin shares the cycle
//   BW-79 reviews/submitted per cycle, stages by reviewer type, ratings so far (team scope)
//   BW-80 Remind sends PERFORMANCE_REVIEW_REMINDER to the reviewer; the 24 h throttle holds
//   BW-81 status filter (WAITING / SUBMITTED / MISSED), department and reviewer type on reviews
//   BW-82 Goals & KPIs tiles in scope, department on KPI rows, people status
//   BW-83 company KPIs: create, list, a goal linked to one, roll-up from the goal's progress
//   BW-84 my current cycle, a self-review saved as a draft then submitted, goal due date and last note
//   BW-85 learning summary, categories, program place, department/dates on enrollments,
//         certifications list, a skill proposal naming a certification, approved → on the record
//   403s per role, derived from each login's own permissions; tenant: another tenant's
//   header can't read these rows
//   FEATURE_NOT_READY: renames each new table/column (ut_w3_dev only), checks the answers
//   and that the old paths keep working, renames them back. Any FEATURE_NOT_READY or 5xx
//   outside that step is a failure.
// Removes everything it creates.
//
// Run from apps/platform (API on :8080, DB ut_w3_dev), e.g. inside live-slot.sh:
//   RECOVERY_DB=ut_w3_dev RECOVERY_API_URL=http://127.0.0.1:8080/api node e2e/recovery/live-rd-p-grow-api.mjs
/* global process, console, fetch, Buffer */
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DB = process.env.RECOVERY_DB || 'ut_w3_dev'
if (DB === 'unifiedtree_recovery' || DB === 'ut_w3_base') { console.log(`Refusing to run against ${DB}: this test renames tables.`); process.exit(2) }
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const MGR = '44444444-4444-4444-4444-444444444444'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  — ' + detail : ''}`) }
let renameStep = false
const unexpected = []
async function call(user, method, path, body) {
  const r = await fetch(base + path, { method, headers: user.h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null; try { json = await r.json() } catch { /* empty body */ }
  if (r.status >= 500 && !(renameStep && json?.errorCode === 'FEATURE_NOT_READY')) unexpected.push(`${method} ${path} → ${r.status} ${json?.errorCode ?? ''} ${json?.message ?? ''} (${user.name})`)
  if (json?.errorCode === 'FEATURE_NOT_READY' && !renameStep) unexpected.push(`${method} ${path} → FEATURE_NOT_READY (${user.name})`)
  return { status: r.status, json }
}
async function login(name, email) {
  const r = await fetch(`${base}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const token = (await r.json()).accessToken
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  return { name, token, h: { ...headers, Authorization: `Bearer ${token}` }, perms: new Set(claims.permissions || []), employeeId: claims.employee_id }
}
const can = (u, ...any) => any.some((p) => u.perms.has(p))
const run = async (label, fn) => { try { await fn() } catch (e) { check(`${label}: finished without an exception`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')) } }

const stamp = Date.now()
const testStart = sql('select now()')
const today = istToday()
const U = {
  owner: await login('owner', 'owner@unifiedtree.demo'),
  hrm: await login('hrm', 'hrm@unifiedtree.demo'),
  fin: await login('fin', 'fin@unifiedtree.demo'),
  mgr: await login('mgr', 'mgr@unifiedtree.demo'),
  reader: await login('reader', 'reader@unifiedtree.demo'),
}
const roles = Object.values(U)
console.log(`DB ${DB}, today ${today}, API ${base}`)
const cycleName = `QA grow cycle ${stamp}`
const kpiTitle = `QA company KPI ${stamp}`
const goalTitle = `QA grow goal ${stamp}`
const programTitle = `QA grow program ${stamp}`
const skillName = `QA grow skill ${stamp}`
let cycleId = null, kpiId = null, programId = null

try {
  // ── 403s per role ────────────────────────────────────────────────────────
  await run('permissions', async () => {
    for (const u of roles) {
      const read = can(u, 'hrms.performance.read'), self = can(u, 'hrms.performance.review.self')
      const lRead = can(u, 'hrms.learning.read'), skillRead = can(u, 'hrms.learning.skill.read')
      const pairs = [
        ['GET /v1/performance/cycles/summary', read], ['GET /v1/performance/kpis/summary', read],
        ['GET /v1/performance/cycles/my-current', self], ['GET /v1/performance/company-kpis', read || self],
        ['GET /v1/learning/programs/summary', lRead], ['GET /v1/learning/programs/categories', lRead],
        ['GET /v1/learning/certifications', skillRead],
      ]
      const wrong = []
      for (const [ep, ok] of pairs) {
        const [m, p] = ep.split(' ')
        const r = await call(u, m, p)
        if ((r.status === 200) !== ok || (!ok && r.status !== 403)) wrong.push(`${ep}=${r.status} (expected ${ok ? 200 : 403})`)
      }
      check(`${u.name}: each new read answers by permission`, wrong.length === 0, wrong.join('; ') || 'ok')
      const write = await call(u, 'POST', '/v1/performance/company-kpis', { companyId: company, title: 'x' })
      if (!can(u, 'hrms.kpi.manage')) check(`${u.name}: can't add a company KPI without hrms.kpi.manage`, write.status === 403, `status=${write.status}`)
      else if (write.status === 201) sql(`delete from performance_mgmt.company_kpis where id='${write.json.id}'`)
    }
    const share = await call(U.mgr, 'POST', '/v1/performance/cycles/00000000-0000-0000-0000-000000000000/share')
    check('mgr: sharing a cycle needs hrms.performance.write', share.status === 403, `status=${share.status}`)
  })

  // ── BW-78 / BW-79 / BW-80 / BW-81 / BW-84 ────────────────────────────────
  await run('cycle', async () => {
    const created = await call(U.owner, 'POST', '/v1/performance/cycles', { companyId: company, name: cycleName, periodStart: plus(today, -30), periodEnd: plus(today, 30) })
    check('owner: creates a review cycle', created.status === 201, `status=${created.status}`)
    cycleId = created.json?.id
    const bad = await call(U.owner, 'PUT', `/v1/performance/cycles/${cycleId}/milestones`, { selfReviewBy: plus(today, 10), managerReviewBy: plus(today, 5) })
    check('dates out of step order are refused', bad.status === 422 || bad.status === 400, `status=${bad.status} ${bad.json?.errorCode}`)
    const dates = await call(U.owner, 'PUT', `/v1/performance/cycles/${cycleId}/milestones`,
      { goalsBy: plus(today, -20), selfReviewBy: plus(today, 5), managerReviewBy: plus(today, 10), shareOn: plus(today, 15), holdUntilShared: true })
    check('owner: sets the cycle dates with the hold on', dates.status === 200 && dates.json?.holdUntilShared === true && dates.json?.selfReviewBy === plus(today, 5), JSON.stringify(dates.json))
    const listed = (await call(U.owner, 'GET', '/v1/performance/cycles')).json?.find((c) => c.id === cycleId)
    check('cycles list carries the dates', listed?.milestones?.managerReviewBy === plus(today, 10) && listed?.status === 'DRAFT', JSON.stringify(listed?.milestones))
    const init = await call(U.owner, 'POST', `/v1/performance/cycles/${cycleId}/initiate`, { reviewerTypes: ['SELF', 'MANAGER'], revieweeIds: [READER] })
    check('owner: assigns a self and a manager review for reader', init.status === 200 && init.json?.reviewsCreated === 2, JSON.stringify(init.json))

    const mine = (await call(U.reader, 'GET', '/v1/performance/cycles/my-current')).json || []
    const myCycle = mine.find((c) => c.cycleId === cycleId)
    check('reader: my current cycle has my steps', !!myCycle?.selfReview?.reviewId && myCycle?.managerReview?.reviewerName?.startsWith('Dept') && myCycle?.feedbackHeld === true,
      JSON.stringify({ self: myCycle?.selfReview?.status, mgr: myCycle?.managerReview?.reviewerName, held: myCycle?.feedbackHeld }))
    const selfId = myCycle?.selfReview?.reviewId
    const managerReviewId = myCycle?.managerReview?.reviewId

    const reminded = await call(U.owner, 'POST', `/v1/performance/reviews/${managerReviewId}/remind`)
    check('owner: reminds the manager', reminded.status === 200 && reminded.json?.newReminderCount === 1, `status=${reminded.status}`)
    const mgrUser = sql(`select id from auth.user_credentials where employee_id='${MGR}' and tenant_id='${tenant}'`)
    const notes = sql(`select count(*) from notif.notifications where user_id='${mgrUser}' and type='PERFORMANCE_REVIEW_REMINDER' and created_at >= '${testStart}'`)
    check('the manager got a review reminder', notes === '1', `notifications=${notes}`)
    const again = await call(U.owner, 'POST', `/v1/performance/reviews/${managerReviewId}/remind`)
    check('a second reminder the same day is refused', again.status >= 400 && again.status < 500 && again.json?.errorCode === 'REMINDER_THROTTLED', `status=${again.status} ${again.json?.errorCode}`)

    const notMine = await call(U.mgr, 'PUT', `/v1/performance/reviews/${selfId}/draft`, { strengths: 'x' })
    check('mgr: can\'t save reader\'s self-review', notMine.status >= 400 && notMine.status < 500, `status=${notMine.status}`)
    const draft = await call(U.reader, 'PUT', `/v1/performance/reviews/${selfId}/draft`, { strengths: 'Shipped the QA draft', improvements: null, overallRating: 3 })
    check('reader: saves the self-review as a draft', draft.status === 200 && draft.json?.status === 'IN_PROGRESS' && draft.json?.reviewerType === 'SELF' && draft.json?.dueDate === plus(today, 5),
      JSON.stringify({ s: draft.json?.status, t: draft.json?.reviewerType, due: draft.json?.dueDate }))
    const waiting = (await call(U.owner, 'GET', `/v1/performance/reviews?cycleId=${cycleId}&status=WAITING`)).json?.content || []
    check('a draft counts as waiting', waiting.length === 2 && waiting.every((r) => r.department !== undefined), `rows=${waiting.length}`)
    const submitted = await call(U.reader, 'POST', `/v1/performance/reviews/${selfId}/submit`, { overallRating: 4, strengths: 'Shipped the QA draft', improvements: 'Delegate more' })
    check('reader: submits the drafted self-review', submitted.status === 200 && submitted.json?.status === 'SUBMITTED', `status=${submitted.status}`)
    const mgrSubmit = await call(U.mgr, 'POST', `/v1/performance/reviews/${managerReviewId}/submit`, { overallRating: 4.6, strengths: 'QA manager praise', improvements: 'QA manager note' })
    check('mgr: submits the manager review', mgrSubmit.status === 200, `status=${mgrSubmit.status}`)

    const held = (await call(U.reader, 'GET', '/v1/performance/reviews/my')).json || []
    check('hold on: reader doesn\'t see the manager\'s review yet', !held.some((r) => r.id === managerReviewId) && held.some((r) => r.id === selfId), `${held.length} reviews`)
    const subs = (await call(U.owner, 'GET', `/v1/performance/reviews?cycleId=${cycleId}&status=SUBMITTED`)).json?.content || []
    check('status filter: both submitted', subs.length === 2 && subs.some((r) => r.reviewerType === 'MANAGER'), subs.map((r) => r.reviewerType).join(','))
    const bogus = await call(U.owner, 'GET', `/v1/performance/reviews?status=DONE`)
    check('an unknown status is refused', bogus.status >= 400 && bogus.status < 500, `status=${bogus.status}`)

    const sumOwner = ((await call(U.owner, 'GET', '/v1/performance/cycles/summary')).json || []).find((c) => c.cycleId === cycleId)
    check('summary: 2 reviews, 2 submitted', sumOwner?.reviews === 2 && sumOwner?.submitted === 2, JSON.stringify(sumOwner))
    const sumMgr = ((await call(U.mgr, 'GET', '/v1/performance/cycles/summary')).json || []).find((c) => c.cycleId === cycleId)
    check('summary: the manager sees their team (reader) in it', sumMgr?.reviews === 2, JSON.stringify(sumMgr))
    const stages = (await call(U.owner, 'GET', `/v1/performance/cycles/${cycleId}/stages`)).json
    const byType = Object.fromEntries((stages?.rows || []).map((r) => [r.reviewerType, r]))
    check('stages: self and manager counted, one reviewee', byType.SELF?.submitted === 1 && byType.MANAGER?.submitted === 1 && stages?.reviewees === 1, JSON.stringify(stages?.rows))
    const ratings = (await call(U.owner, 'GET', `/v1/performance/cycles/${cycleId}/ratings`)).json
    check('ratings: the manager\'s 4.6 counts as 4 (Exceeds)', ratings?.total === 1 && ratings?.buckets?.find((b) => b.rating === 4)?.count === 1, JSON.stringify(ratings?.buckets))
    const readerStages = await call(U.reader, 'GET', `/v1/performance/cycles/${cycleId}/stages`)
    check('reader: no access to stages', readerStages.status === 403, `status=${readerStages.status}`)

    const shared = await call(U.owner, 'POST', `/v1/performance/cycles/${cycleId}/share`)
    check('owner: shares the cycle', shared.status === 200 && !!shared.json?.sharedAt, `status=${shared.status}`)
    const after = (await call(U.reader, 'GET', '/v1/performance/reviews/my')).json || []
    const mgrRev = after.find((r) => r.id === managerReviewId)
    check('after sharing: reader sees the manager\'s review', mgrRev?.strengths === 'QA manager praise' && mgrRev?.reviewerType === 'MANAGER', mgrRev ? 'shown' : 'missing')
  })

  // ── BW-82 / BW-83 / BW-84 goals ─────────────────────────────────────────
  await run('goals', async () => {
    const kpi = await call(U.owner, 'POST', '/v1/performance/company-kpis', { companyId: company, title: kpiTitle, targetValue: 100, unit: '%', dueDate: plus(today, 60) })
    check('owner: adds a company KPI', kpi.status === 201 && kpi.json?.progress === null && kpi.json?.linkedGoals === 0, `status=${kpi.status}`)
    kpiId = kpi.json?.id
    const forReader = (await call(U.reader, 'GET', `/v1/performance/company-kpis?companyId=${company}`)).json || []
    check('reader: lists company KPIs for the goal form', forReader.some((k) => k.id === kpiId))
    const goal = await call(U.reader, 'POST', '/v1/performance/goals', { title: goalTitle, weight: 2, dueDate: plus(today, 40), companyKpiId: kpiId })
    check('reader: adds a goal with a due date, linked to the KPI', goal.status === 201 && goal.json?.dueDate === plus(today, 40) && goal.json?.companyKpiId === kpiId,
      JSON.stringify({ s: goal.status, due: goal.json?.dueDate, k: goal.json?.companyKpiTitle }))
    const goalId = goal.json?.id
    await call(U.reader, 'PUT', `/v1/performance/goals/${goalId}/progress`, { progress: 60, note: 'QA halfway note' })
    const mine = ((await call(U.reader, 'GET', '/v1/performance/goals/my')).json || []).find((g) => g.id === goalId)
    check('My goals: last note and update time', mine?.lastNote === 'QA halfway note' && !!mine?.lastUpdatedAt && mine?.companyKpiTitle === kpiTitle, JSON.stringify({ n: mine?.lastNote, k: mine?.companyKpiTitle }))
    const rolled = ((await call(U.owner, 'GET', `/v1/performance/company-kpis?companyId=${company}`)).json || []).find((k) => k.id === kpiId)
    check('company KPI rolls up the linked goal (60%)', rolled?.progress === 60 && rolled?.linkedGoals === 1, JSON.stringify({ p: rolled?.progress, n: rolled?.linkedGoals }))
    const tiles = (await call(U.owner, 'GET', '/v1/performance/kpis/summary')).json
    check('Goals & KPIs tiles', typeof tiles?.total === 'number' && tiles.total >= 1 && typeof tiles?.averageProgress === 'number', JSON.stringify(tiles))
    const mgrTiles = (await call(U.mgr, 'GET', '/v1/performance/kpis/summary')).json
    check('manager tiles count only their team', mgrTiles?.total <= tiles?.total, `${mgrTiles?.total} ≤ ${tiles?.total}`)
    const row = ((await call(U.owner, 'GET', `/v1/performance/kpis?search=${encodeURIComponent(goalTitle)}`)).json?.items || [])[0]
    check('KPI rows carry department and the company KPI', row && 'department' in row && row.companyKpiId === kpiId, JSON.stringify({ d: row?.department, k: row?.companyKpiTitle }))
    const people = (await call(U.owner, 'GET', `/v1/performance/employees?search=Reader`)).json?.items || []
    const r = people.find((p) => p.employeeId === READER)
    check('people: employment status and the open-cycle flag', r?.employmentStatus === 'ACTIVE' && typeof r?.pendingInOpenCycle === 'boolean', JSON.stringify({ s: r?.employmentStatus, p: r?.pendingInOpenCycle }))
    const mgrKpi = await call(U.mgr, 'PUT', `/v1/performance/company-kpis/${kpiId}`, { status: 'DROPPED' })
    check('mgr: can\'t change a company KPI', mgrKpi.status === 403, `status=${mgrKpi.status}`)
    const dropped = await call(U.owner, 'PUT', `/v1/performance/company-kpis/${kpiId}`, { status: 'COMPLETED' })
    check('owner: marks the company KPI completed', dropped.status === 200 && dropped.json?.status === 'COMPLETED', `status=${dropped.status}`)
  })

  // ── BW-85 learning ───────────────────────────────────────────────────────
  await run('learning', async () => {
    const before = (await call(U.owner, 'GET', '/v1/learning/programs/summary')).json
    check('programs summary', typeof before?.inCatalogue === 'number' && before?.locations === true && before?.certificationNames === true, JSON.stringify(before))
    const prog = await call(U.owner, 'POST', '/v1/learning/programs', { companyId: company, title: programTitle, category: 'QA Grow', mode: 'IN_PERSON', location: 'QA Bengaluru office', startDate: today, endDate: plus(today, 3) })
    check('owner: creates a classroom program with its place', prog.status === 201 && prog.json?.location === 'QA Bengaluru office', `status=${prog.status} ${prog.json?.location}`)
    programId = prog.json?.id
    const cats = (await call(U.reader, 'GET', '/v1/learning/programs/categories')).json || []
    check('categories include the new one', cats.includes('QA Grow'), cats.join(', '))
    const moved = await call(U.owner, 'PUT', `/v1/learning/programs/${programId}`, { location: 'QA Pune office' })
    check('owner: moves the program', moved.status === 200 && moved.json?.location === 'QA Pune office', `${moved.json?.location}`)
    const after = (await call(U.owner, 'GET', '/v1/learning/programs/summary')).json
    check('summary counts the new program', after?.inCatalogue === before.inCatalogue + 1 && after?.planned === before.planned + 1, `${before?.inCatalogue} → ${after?.inCatalogue}`)
    await call(U.reader, 'POST', `/v1/learning/programs/${programId}/enroll`)
    const mine = ((await call(U.reader, 'GET', '/v1/learning/enrollments/me')).json || []).find((e) => e.programId === programId)
    check('My training: program dates, mode and place', mine?.programStartDate === today && mine?.programMode === 'IN_PERSON' && mine?.programLocation === 'QA Pune office', JSON.stringify(mine && { s: mine.programStartDate, m: mine.programMode, l: mine.programLocation }))
    const roster = (await call(U.owner, 'GET', `/v1/learning/programs/${programId}/enrollments`)).json || []
    check('roster rows carry the department', roster.length === 1 && 'department' in roster[0], JSON.stringify(roster[0]?.department))
    const after2 = (await call(U.owner, 'GET', '/v1/learning/programs/summary')).json
    check('enrollments this year went up by one', after2?.enrollmentsThisYear === before.enrollmentsThisYear + 1, `${before?.enrollmentsThisYear} → ${after2?.enrollmentsThisYear}`)

    const proposal = await call(U.reader, 'POST', '/v1/learning/skill-assessments', { skillName, proposedProficiency: 4, note: 'QA', certificationName: 'QA Certified Grower' })
    check('reader: proposes a skill with a certification', proposal.status === 201 && proposal.json?.certificationName === 'QA Certified Grower', `status=${proposal.status}`)
    const reject = await call(U.mgr, 'POST', `/v1/learning/skill-assessments/${proposal.json?.id}/decide`, { decision: 'REJECTED' })
    check('a rejection without a note is refused', reject.status >= 400 && reject.status < 500, `status=${reject.status}`)
    const approve = await call(U.mgr, 'POST', `/v1/learning/skill-assessments/${proposal.json?.id}/decide`, { decision: 'APPROVED' })
    check('mgr: approves it', approve.status === 200, `status=${approve.status}`)
    const skill = ((await call(U.reader, 'GET', '/v1/learning/skills/me')).json || []).find((s) => s.skillName === skillName)
    check('the skill is on the record, certified, with its updated time', skill?.proficiency === 4 && skill?.certified === true && skill?.certificationName === 'QA Certified Grower' && !!skill?.updatedAt, JSON.stringify(skill && { c: skill.certificationName, u: skill.updatedAt }))
    const certs = (await call(U.owner, 'GET', `/v1/learning/certifications?search=${encodeURIComponent('QA Certified Grower')}`)).json
    check('certifications list shows it as certified', certs?.items?.[0]?.status === 'CERTIFIED' && certs?.items?.[0]?.employeeId === READER, JSON.stringify(certs?.items?.[0]))
    const badStatus = await call(U.owner, 'GET', '/v1/learning/certifications?status=soon')
    check('an unknown certification status is refused', badStatus.status >= 400 && badStatus.status < 500, `status=${badStatus.status}`)
  })

  // ── tenant isolation ─────────────────────────────────────────────────────
  await run('tenant', async () => {
    const other = '00000000-0000-0000-0000-00000000beef'
    const r = await fetch(`${base}/v1/performance/cycles/${cycleId}/stages`, { headers: { ...U.owner.h, 'X-Tenant-ID': other } })
    check('another tenant header can\'t read this cycle', r.status >= 400, `status=${r.status}`)
  })

  // ── FEATURE_NOT_READY (renames in ut_w3_dev only) ────────────────────────
  await run('not ready', async () => {
    renameStep = true
    sql('ALTER TABLE performance_mgmt.review_cycle_milestones RENAME TO review_cycle_milestones_x')
    try {
      const put = await call(U.owner, 'PUT', `/v1/performance/cycles/${cycleId}/milestones`, { holdUntilShared: false })
      check('milestones missing: saving dates is FEATURE_NOT_READY', put.status === 503 && put.json?.errorCode === 'FEATURE_NOT_READY', `status=${put.status}`)
      const list = await call(U.owner, 'GET', '/v1/performance/cycles')
      check('milestones missing: cycles still list, dates empty', list.status === 200 && list.json?.every((c) => c.milestones === null), `status=${list.status}`)
      const my = await call(U.reader, 'GET', '/v1/performance/reviews/my')
      check('milestones missing: My reviews still works', my.status === 200, `status=${my.status}`)
    } finally { sql('ALTER TABLE performance_mgmt.review_cycle_milestones_x RENAME TO review_cycle_milestones') }
    sql('ALTER TABLE performance_mgmt.company_kpis RENAME TO company_kpis_x')
    try {
      const kl = await call(U.owner, 'GET', '/v1/performance/company-kpis')
      check('company KPIs missing: FEATURE_NOT_READY', kl.status === 503 && kl.json?.errorCode === 'FEATURE_NOT_READY', `status=${kl.status}`)
      const goals = await call(U.reader, 'GET', '/v1/performance/goals/my')
      check('company KPIs missing: My goals still works', goals.status === 200, `status=${goals.status}`)
      const kpis = await call(U.owner, 'GET', '/v1/performance/kpis?size=5')
      check('company KPIs missing: KPI list still works', kpis.status === 200, `status=${kpis.status}`)
    } finally { sql('ALTER TABLE performance_mgmt.company_kpis_x RENAME TO company_kpis') }
    sql('ALTER TABLE learning_mgmt.program_locations RENAME TO program_locations_x')
    try {
      const withPlace = await call(U.owner, 'POST', '/v1/learning/programs', { companyId: company, title: `${programTitle} b`, location: 'QA' })
      check('locations missing: a program with a place is FEATURE_NOT_READY, nothing saved', withPlace.status === 503 && sql(`select count(*) from learning_mgmt.training_programs where title='${programTitle} b'`) === '0', `status=${withPlace.status}`)
      const list = await call(U.owner, 'GET', '/v1/learning/programs?size=5')
      const sum = (await call(U.owner, 'GET', '/v1/learning/programs/summary')).json
      check('locations missing: programs still list; summary says no places', list.status === 200 && sum?.locations === false, `status=${list.status}`)
    } finally { sql('ALTER TABLE learning_mgmt.program_locations_x RENAME TO program_locations') }
    sql('ALTER TABLE learning_mgmt.skill_assessments RENAME COLUMN certification_name TO certification_name_x')
    try {
      const p = await call(U.reader, 'POST', '/v1/learning/skill-assessments', { skillName: `${skillName} b`, proposedProficiency: 2, certificationName: 'X' })
      check('certification column missing: naming one is FEATURE_NOT_READY', p.status === 503, `status=${p.status}`)
      const mine = await call(U.reader, 'GET', '/v1/learning/skill-assessments/me')
      check('certification column missing: proposals still list', mine.status === 200, `status=${mine.status}`)
    } finally { sql('ALTER TABLE learning_mgmt.skill_assessments RENAME COLUMN certification_name_x TO certification_name') }
    renameStep = false
  })
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  try {
    if (cycleId) {
      sql(`delete from performance_mgmt.appraisal_reviewer_assignments where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.performance_reviews where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.review_cycle_milestones where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.review_cycles where id='${cycleId}'`)
    }
    sql(`delete from performance_mgmt.goal_kpi_links where goal_id in (select id from performance_mgmt.goals where title like 'QA grow goal %')`)
    sql(`delete from performance_mgmt.kpi_progress_updates where goal_id in (select id from performance_mgmt.goals where title like 'QA grow goal %')`)
    sql(`delete from performance_mgmt.goals where title like 'QA grow goal %'`)
    sql(`delete from performance_mgmt.company_kpis where title like 'QA company KPI %' or title = 'x'`)
    sql(`delete from learning_mgmt.training_enrollments where program_id in (select id from learning_mgmt.training_programs where title like 'QA grow program %')`)
    sql(`delete from learning_mgmt.program_locations where program_id in (select id from learning_mgmt.training_programs where title like 'QA grow program %')`)
    sql(`delete from learning_mgmt.training_programs where title like 'QA grow program %'`)
    sql(`delete from learning_mgmt.skill_assessments where skill_name like 'QA grow skill %'`)
    sql(`delete from learning_mgmt.employee_skills where skill_name like 'QA grow skill %'`)
    sql(`delete from notif.notifications where created_at >= '${testStart}' and type in ('PERFORMANCE_REVIEW_REMINDER','SKILL_ASSESSMENT_SUBMITTED','SKILL_ASSESSMENT_APPROVED','SKILL_ASSESSMENT_REJECTED')`)
    sql(`delete from audit.events where occurred_at >= '${testStart}' and module = 'performance'`)
    const left = sql(`select (select count(*) from performance_mgmt.review_cycles where name like 'QA grow cycle %') + (select count(*) from performance_mgmt.goals where title like 'QA grow goal %') + (select count(*) from learning_mgmt.training_programs where title like 'QA grow program %') + (select count(*) from performance_mgmt.company_kpis where title like 'QA company KPI %')`)
    check('cleanup: everything this run made is gone', left === '0', `left=${left}`)
  } catch (e) { check('cleanup ran', false, String(e).split('\n')[0]) }
  check('no unexpected 5xx or FEATURE_NOT_READY', unexpected.length === 0, unexpected.slice(0, 5).join(' | ') || 'none')
  const pass = checks.filter((c) => c.ok).length
  console.log(`\n${pass}/${checks.length} passed`)
  process.exit(pass === checks.length ? 0 : 1)
}
