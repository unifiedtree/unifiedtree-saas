// Live API check of the w2b build (performance and learning), no browser:
//  1. KPI history for employees: GET /v1/performance/goals/my/{id}/history (own
//     goals only), and personal-goal progress with a note lands in the history.
//  2. Reviewee's goals while writing a review: GET /v1/performance/reviews/{id}/goals
//     (reviewer, reviewee, HR; refused to anyone else; only that cycle's goals).
//  3. Per-employee page: GET /v1/performance/employees/{id} (HR any; manager
//     their team only; employees refused), with ratings over time.
//  4. Goals tile: GET /v1/performance/kpis?active=true counts active / at-risk only.
//  5. Program edit: PUT /v1/learning/programs/{id} (seats >= enrolled, dates,
//     mode, unlimited seats, closed programs locked; learning.write only).
//  6. Skill self-assessment: propose / withdraw (employee), queue / decide
//     (manager for their team, HR for all), skill matrix updated on approval,
//     notifications both ways.
// Everything it creates is removed at the end.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w2b.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const READER = '22222222-2222-2222-2222-222222222222'
const MGR = '44444444-4444-4444-4444-444444444444'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const stamp = Date.now()
const TAG = `QA w2b ${stamp}`
const iso = (d) => d.toISOString().slice(0, 10)
const day = (offset) => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCDate(d.getUTCDate() + offset); return iso(d) } // India date
const made = { goals: [], cycles: [], reviews: [], programs: [], assessments: [] }

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const other = sql(`select id from hrms.employees where tenant_id='${tenant}' and is_active and id not in ('${READER}','${MGR}') and reporting_manager_id is distinct from '${MGR}' order by created_at limit 1`)

  // ── permissions (V143_21) ──
  check('perm: employees can propose skill levels, not approve them', reader.perms.includes('hrms.learning.skill.assess.self') && !reader.perms.includes('hrms.learning.skill.approve'))
  check('perm: department manager and HR can approve skill levels', mgr.perms.includes('hrms.learning.skill.approve') && hrm.perms.includes('hrms.learning.skill.approve'))
  check('perm: owner holds both new permissions', owner.perms.includes('hrms.learning.skill.assess.self') && owner.perms.includes('hrms.learning.skill.approve'))

  // ── fixtures: KPIs for the reader and someone else ──
  const mk = async (body) => { const r = await owner.call('/v1/performance/kpis', 'POST', { unit: 'tasks', direction: 'HIGHER_IS_BETTER', weight: 1, ...body }); if (r.json?.id) made.goals.push(r.json.id); return r }
  const kpiA = (await mk({ ownerId: READER, title: `${TAG} active KPI`, targetValue: 100, currentValue: 10 })).json?.id
  const kpiB = (await mk({ ownerId: READER, title: `${TAG} dropped KPI`, targetValue: 10, currentValue: 0 })).json?.id
  const kpiE = (await mk({ ownerId: READER, title: `${TAG} old KPI`, targetValue: 5, currentValue: 0, dueDate: day(-60) })).json?.id
  const kpiO = (await mk({ ownerId: other, title: `${TAG} other KPI`, targetValue: 5, currentValue: 0 })).json?.id
  check('fixture: four KPIs created', kpiA && kpiB && kpiE && kpiO)
  const drop = await owner.call(`/v1/performance/kpis/${kpiB}`, 'DELETE')
  check('fixture: one KPI dropped', drop.status === 204 && sql(`select status from performance_mgmt.goals where id='${kpiB}'`) === 'DROPPED')

  // ── 4. active filter (Goals tile) ──
  const act = await owner.call(`/v1/performance/kpis?ownerId=${READER}&active=true&size=200`)
  const actIds = (act.json?.items || []).map((k) => k.id)
  const dbActive = sql(`select count(*) from performance_mgmt.goals where tenant_id='${tenant}' and employee_id='${READER}' and status in ('ACTIVE','AT_RISK')`)
  check('active filter: only active / at-risk goals, matching the database', act.status === 200 && actIds.includes(kpiA) && !actIds.includes(kpiB) && String(act.json?.total) === dbActive, `total=${act.json?.total} db=${dbActive}`)
  const all = await owner.call(`/v1/performance/kpis?ownerId=${READER}&size=200`)
  check('active filter: without it the dropped KPI is still listed', (all.json?.items || []).some((k) => k.id === kpiB))

  // ── 1. KPI history for the employee ──
  const prog = await owner.call(`/v1/performance/kpis/${kpiA}/progress`, 'PUT', { newValue: 40, notes: `${TAG} owner update` })
  check('history: owner records KPI progress', prog.status === 200 && Number(prog.json?.currentValue) === 40, `status=${prog.status}`)
  const hist = await reader.call(`/v1/performance/goals/my/${kpiA}/history`)
  const latest = hist.json?.[0]
  check('history: employee reads their own KPI history (value, date, who, note)', hist.status === 200 && hist.json.length >= 2 && Number(latest?.newValue) === 40 && latest?.notes === `${TAG} owner update` && !!latest?.updatedAt && !!latest?.updatedByName, `status=${hist.status} n=${hist.json?.length} by=${latest?.updatedByName}`)
  const histOther = await reader.call(`/v1/performance/goals/my/${kpiO}/history`)
  check('history: someone else’s goal is refused (403)', histOther.status === 403, `status=${histOther.status}`)
  const histFin = await fin.call(`/v1/performance/goals/my/${kpiA}/history`)
  check('history: a colleague cannot read it through the self route (403)', histFin.status === 403, `status=${histFin.status}`)
  const personal = await reader.call('/v1/performance/goals', 'POST', { title: `${TAG} personal goal`, weight: 10 })
  if (personal.json?.id) made.goals.push(personal.json.id)
  const pp = await reader.call(`/v1/performance/goals/${personal.json?.id}/progress`, 'PUT', { progress: 30, note: `${TAG} note` })
  const ppRow = sql(`select new_value::int || '|' || coalesce(notes,'') from performance_mgmt.kpi_progress_updates where goal_id='${personal.json?.id}' order by updated_at desc limit 1`)
  check('history: personal goal progress with a note is recorded', pp.status === 200 && pp.json?.progress === 30 && ppRow === `30|${TAG} note`, `status=${pp.status} row=${ppRow}`)
  const ph = await reader.call(`/v1/performance/goals/my/${personal.json?.id}/history`)
  check('history: the personal goal’s history shows the update', ph.status === 200 && ph.json?.[0]?.notes === `${TAG} note`)

  // ── 2. reviewee's goals while writing a review ──
  const cyc = await owner.call('/v1/performance/cycles', 'POST', { name: `${TAG} cycle`, periodStart: day(-30), periodEnd: day(30) })
  if (cyc.json?.id) made.cycles.push(cyc.json.id)
  check('fixture: review cycle created', cyc.status === 201, `status=${cyc.status}`)
  const reviewId = sql(`insert into performance_mgmt.performance_reviews (tenant_id, cycle_id, employee_id, reviewer_id, reviewer_type, status) values ('${tenant}','${cyc.json?.id}','${READER}','${MGR}','MANAGER','PENDING') returning id`).split(/\s/)[0]
  made.reviews.push(reviewId)
  const rg = await mgr.call(`/v1/performance/reviews/${reviewId}/goals`)
  const rgIds = (rg.json?.goals || []).map((g) => g.id)
  check('review goals: the reviewer sees the reviewee’s goals for the cycle', rg.status === 200 && rg.json?.employeeId === READER && rgIds.includes(kpiA), `status=${rg.status} n=${rgIds.length}`)
  check('review goals: dropped goals and goals due before the cycle are left out', !rgIds.includes(kpiB) && !rgIds.includes(kpiE))
  const rgA = (rg.json?.goals || []).find((g) => g.id === kpiA)
  check('review goals: target, current and status are shown', rgA && Number(rgA.targetValue) === 100 && Number(rgA.currentValue) === 40 && rgA.status === 'ACTIVE' && rgA.kpi === true)
  check('review goals: the reviewee can see them too', (await reader.call(`/v1/performance/reviews/${reviewId}/goals`)).status === 200)
  check('review goals: HR can see them', (await hrm.call(`/v1/performance/reviews/${reviewId}/goals`)).status === 200)
  const rgFin = await fin.call(`/v1/performance/reviews/${reviewId}/goals`)
  check('review goals: anyone else is refused (403)', rgFin.status === 403, `status=${rgFin.status}`)

  // ── 3. per-employee page ──
  const sub = await mgr.call(`/v1/performance/reviews/${reviewId}/submit`, 'POST', { overallRating: 4, strengths: `${TAG} strengths`, improvements: `${TAG} improve` })
  check('fixture: manager submits the review', sub.status === 200, `status=${sub.status}`)
  const prof = await owner.call(`/v1/performance/employees/${READER}`)
  const point = (prof.json?.ratings || []).find((r) => r.cycleId === cyc.json?.id)
  check('profile: owner opens the reader’s page with goals and reviews', prof.status === 200 && prof.json?.employee?.id === READER && (prof.json?.goals || []).some((g) => g.id === kpiA) && (prof.json?.reviews || []).some((r) => r.id === reviewId), `status=${prof.status}`)
  check('profile: ratings over time include the cycle’s rating', point && Number(point.averageRating) === 4 && point.reviewCount >= 1, JSON.stringify(point))
  check('profile: summary counts match', prof.json?.summary && prof.json.summary.activeGoals === Number(sql(`select count(*) from performance_mgmt.goals where tenant_id='${tenant}' and employee_id='${READER}' and status in ('ACTIVE','AT_RISK')`)))
  const reviewRow = (prof.json?.reviews || []).find((r) => r.id === reviewId)
  check('profile: the review shows the reviewer’s name and rating', reviewRow && Number(reviewRow.overallRating) === 4 && !!reviewRow.reviewerName)
  check('profile: the manager opens their team member', (await mgr.call(`/v1/performance/employees/${READER}`)).status === 200)
  const mOut = await mgr.call(`/v1/performance/employees/${other}`)
  check('profile: the manager is refused outside their team (403)', mOut.status === 403, `status=${mOut.status}`)
  check('profile: HR opens anyone', (await hrm.call(`/v1/performance/employees/${other}`)).status === 200)
  const rSelf = await reader.call(`/v1/performance/employees/${READER}`)
  const fProf = await fin.call(`/v1/performance/employees/${READER}`)
  check('profile: employees without performance.read are refused (403)', rSelf.status === 403 && fProf.status === 403, `reader=${rSelf.status} fin=${fProf.status}`)

  // ── 5. learning program edit ──
  const companyId = sql(`select company_id from hrms.employees where id='${READER}'`)
  const cp = await owner.call('/v1/learning/programs', 'POST', { companyId, title: `${TAG} program`, capacity: 3, mode: 'ONLINE', startDate: day(5), endDate: day(10) })
  const progId = cp.json?.id
  if (progId) made.programs.push(progId)
  check('program: created with a mode', cp.status === 201 && sql(`select mode from learning_mgmt.training_programs where id='${progId}'`) === 'ONLINE', `status=${cp.status}`)
  const zero = await owner.call('/v1/learning/programs', 'POST', { companyId, title: `${TAG} zero seats`, capacity: 0 })
  if (zero.json?.id) made.programs.push(zero.json.id)
  check('program: 0 seats is refused', zero.status === 422, `status=${zero.status}`)
  const be = await owner.call(`/v1/learning/programs/${progId}/enrollments/bulk`, 'POST', { employeeIds: [READER, MGR] })
  check('program: two people enrolled', be.status === 200 && be.json?.enrolled === 2, `status=${be.status}`)
  const below = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { capacity: 1 })
  check('program: seats below the enrolled count are refused', below.status === 422, `status=${below.status} ${JSON.stringify(below.json)?.slice(0, 120)}`)
  check('program: seats unchanged after the refusal', sql(`select capacity from learning_mgmt.training_programs where id='${progId}'`) === '3')
  const badDates = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { endDate: day(1) })
  check('program: an end date before the saved start date is refused', badDates.status === 422, `status=${badDates.status}`)
  const ed = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { title: `${TAG} program edited`, trainer: 'QA Trainer', mode: 'HYBRID', capacity: 2, description: `${TAG} description`, startDate: day(6), endDate: day(12) })
  const row = sql(`select title||'|'||trainer||'|'||mode||'|'||capacity||'|'||start_date||'|'||end_date from learning_mgmt.training_programs where id='${progId}'`)
  check('program: title, trainer, mode, seats and dates saved', ed.status === 200 && row === `${TAG} program edited|QA Trainer|HYBRID|2|${day(6)}|${day(12)}`, `status=${ed.status} row=${row}`)
  const unl = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { unlimitedSeats: true })
  check('program: seat limit removed', unl.status === 200 && sql(`select coalesce(capacity::text,'none') from learning_mgmt.training_programs where id='${progId}'`) === 'none')
  const rEd = await reader.call(`/v1/learning/programs/${progId}`, 'PUT', { title: 'hack' })
  const mEd = await mgr.call(`/v1/learning/programs/${progId}`, 'PUT', { title: 'hack' })
  check('program: employees and managers cannot edit (403)', rEd.status === 403 && mEd.status === 403, `reader=${rEd.status} mgr=${mEd.status}`)
  const rGet = await reader.call(`/v1/learning/programs/${progId}`)
  check('program: employees read the detail page with the mode', rGet.status === 200 && rGet.json?.mode === 'HYBRID' && rGet.json?.enrolledCount === 2)
  await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { status: 'ONGOING' })
  const done = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { status: 'COMPLETED' })
  const locked = await owner.call(`/v1/learning/programs/${progId}`, 'PUT', { title: `${TAG} after completion` })
  check('program: a completed program keeps its details', done.status === 200 && locked.status === 422 && sql(`select title from learning_mgmt.training_programs where id='${progId}'`) === `${TAG} program edited`, `done=${done.status} locked=${locked.status}`)

  // ── 6. skill self-assessment ──
  const skill = `${TAG} Skill`
  const p1 = await reader.call('/v1/learning/skill-assessments', 'POST', { skillName: skill, proposedProficiency: 3, note: `${TAG} led the rewrite` })
  if (p1.json?.id) made.assessments.push(p1.json.id)
  check('skill: employee proposes a level', p1.status === 201 && p1.json?.status === 'PENDING' && sql(`select status||'|'||proposed_proficiency from learning_mgmt.skill_assessments where id='${p1.json?.id}'`) === 'PENDING|3', `status=${p1.status}`)
  const dup = await reader.call('/v1/learning/skill-assessments', 'POST', { skillName: skill.toLowerCase(), proposedProficiency: 4 })
  if (dup.json?.id) made.assessments.push(dup.json.id)
  check('skill: a second open proposal for the same skill is refused', dup.status === 422, `status=${dup.status}`)
  check('skill: the manager was notified', sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and user_id='${MGR}' and type='SKILL_ASSESSMENT_SUBMITTED' and data->>'skillAssessmentId'='${p1.json?.id}'`) === '1')
  const mq = await mgr.call('/v1/learning/skill-assessments?view=PENDING')
  check('skill: it is in the manager’s queue', mq.status === 200 && (mq.json || []).some((a) => a.id === p1.json?.id))
  check('skill: it is in HR’s queue', ((await hrm.call('/v1/learning/skill-assessments')).json || []).some((a) => a.id === p1.json?.id))
  const fq = await fin.call('/v1/learning/skill-assessments')
  const rd = await reader.call(`/v1/learning/skill-assessments/${p1.json?.id}/decide`, 'POST', { decision: 'APPROVED' })
  check('skill: people without the approve permission are refused (403)', fq.status === 403 && rd.status === 403, `fin=${fq.status} reader=${rd.status}`)
  const noNote = await mgr.call(`/v1/learning/skill-assessments/${p1.json?.id}/decide`, 'POST', { decision: 'REJECTED' })
  check('skill: a rejection without a note is refused', noNote.status === 422 || noNote.status === 400, `status=${noNote.status}`)
  const ok = await mgr.call(`/v1/learning/skill-assessments/${p1.json?.id}/decide`, 'POST', { decision: 'APPROVED', note: 'Agreed' })
  check('skill: the manager approves it', ok.status === 200 && ok.json?.status === 'APPROVED', `status=${ok.status}`)
  check('skill: the skill matrix now has the level', sql(`select proficiency from learning_mgmt.employee_skills where tenant_id='${tenant}' and employee_id='${READER}' and skill_name='${skill}'`) === '3')
  check('skill: the employee was told', sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and user_id='${READER}' and type='SKILL_ASSESSMENT_APPROVED' and data->>'skillAssessmentId'='${p1.json?.id}'`) === '1')
  const mySkills = await reader.call('/v1/learning/skills/me')
  check('skill: the employee sees it under My skills', (mySkills.json || []).some((s) => s.skillName === skill && s.proficiency === 3))
  const same = await reader.call('/v1/learning/skill-assessments', 'POST', { skillName: skill, proposedProficiency: 3 })
  if (same.json?.id) made.assessments.push(same.json.id)
  check('skill: proposing the level already recorded is refused', same.status === 422, `status=${same.status}`)
  const p2 = await reader.call('/v1/learning/skill-assessments', 'POST', { skillName: skill, proposedProficiency: 5 })
  if (p2.json?.id) made.assessments.push(p2.json.id)
  const rj = await hrm.call(`/v1/learning/skill-assessments/${p2.json?.id}/decide`, 'POST', { decision: 'REJECTED', note: `${TAG} not yet` })
  check('skill: HR rejects with a note; the matrix is unchanged', rj.status === 200 && rj.json?.status === 'REJECTED' && sql(`select proficiency from learning_mgmt.employee_skills where tenant_id='${tenant}' and employee_id='${READER}' and skill_name='${skill}'`) === '3', `status=${rj.status}`)
  check('skill: the employee was told it wasn’t approved', sql(`select count(*) from notif.notifications where user_id='${READER}' and type='SKILL_ASSESSMENT_REJECTED' and data->>'skillAssessmentId'='${p2.json?.id}'`) === '1')
  const again = await hrm.call(`/v1/learning/skill-assessments/${p2.json?.id}/decide`, 'POST', { decision: 'APPROVED' })
  check('skill: a decided proposal can’t be decided again', again.status === 422, `status=${again.status}`)
  const p3 = await reader.call('/v1/learning/skill-assessments', 'POST', { skillName: skill, proposedProficiency: 4 })
  if (p3.json?.id) made.assessments.push(p3.json.id)
  const wd = await reader.call(`/v1/learning/skill-assessments/${p3.json?.id}/withdraw`, 'POST')
  check('skill: the employee withdraws a waiting proposal', wd.status === 200 && sql(`select status from learning_mgmt.skill_assessments where id='${p3.json?.id}'`) === 'WITHDRAWN', `status=${wd.status}`)
  const mine = await reader.call('/v1/learning/skill-assessments/me')
  check('skill: the employee lists their proposals', mine.status === 200 && [p1, p2, p3].every((p) => (mine.json || []).some((a) => a.id === p.json?.id)))
  const own = await mgr.call('/v1/learning/skill-assessments', 'POST', { skillName: `${TAG} Mgr Skill`, proposedProficiency: 2 })
  if (own.json?.id) made.assessments.push(own.json.id)
  const ownQ = await mgr.call('/v1/learning/skill-assessments')
  const ownD = await mgr.call(`/v1/learning/skill-assessments/${own.json?.id}/decide`, 'POST', { decision: 'APPROVED' })
  check('skill: nobody decides their own proposal', !(ownQ.json || []).some((a) => a.id === own.json?.id) && ownD.status === 403, `decide=${ownD.status}`)
  // The finance lead is outside the manager's team: only HR may decide theirs.
  const finP = await fin.call('/v1/learning/skill-assessments', 'POST', { skillName: `${TAG} Fin Skill`, proposedProficiency: 2 })
  if (finP.json?.id) made.assessments.push(finP.json.id)
  const finInTeam = sql(`select count(*) from hrms.employees where id='55555555-5555-5555-5555-555555555555' and reporting_manager_id='${MGR}'`) !== '0'
  if (!finInTeam) {
    const mFin = await mgr.call(`/v1/learning/skill-assessments/${finP.json?.id}/decide`, 'POST', { decision: 'APPROVED' })
    check('skill: a manager cannot decide for someone outside their team (403)', mFin.status === 403 && !((await mgr.call('/v1/learning/skill-assessments')).json || []).some((a) => a.id === finP.json?.id), `status=${mFin.status}`)
  }
} catch (e) {
  check('run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  const list = (ids) => ids.filter(Boolean).map((x) => `'${x}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`
  try {
    sql(`delete from notif.notifications where data->>'skillAssessmentId' in (${list(made.assessments)}) or data->>'skillAssessmentId' in (select id::text from learning_mgmt.skill_assessments where skill_name like 'QA w2b ${stamp}%')`)
    sql(`delete from learning_mgmt.skill_assessments where skill_name like 'QA w2b ${stamp}%' or id in (${list(made.assessments)})`)
    sql(`delete from learning_mgmt.employee_skills where skill_name like 'QA w2b ${stamp}%'`)
    sql(`delete from learning_mgmt.training_enrollments where program_id in (${list(made.programs)})`)
    sql(`delete from learning_mgmt.training_programs where id in (${list(made.programs)}) or title like 'QA w2b ${stamp}%'`)
    sql(`delete from performance_mgmt.appraisal_reviewer_assignments where review_id in (${list(made.reviews)})`)
    sql(`delete from performance_mgmt.performance_reviews where id in (${list(made.reviews)}) or cycle_id in (${list(made.cycles)})`)
    sql(`delete from performance_mgmt.kpi_progress_updates where goal_id in (select id from performance_mgmt.goals where title like 'QA w2b ${stamp}%') or goal_id in (${list(made.goals)})`)
    sql(`delete from performance_mgmt.goals where title like 'QA w2b ${stamp}%' or id in (${list(made.goals)})`)
    sql(`delete from performance_mgmt.review_cycles where id in (${list(made.cycles)}) or name like 'QA w2b ${stamp}%'`)
  } catch (e) { console.log('cleanup error: ' + String(e?.message || e).slice(0, 300)) }
  const left = sql(`select (select count(*) from performance_mgmt.goals where title like 'QA w2b ${stamp}%')
                      + (select count(*) from performance_mgmt.review_cycles where name like 'QA w2b ${stamp}%')
                      + (select count(*) from learning_mgmt.training_programs where title like 'QA w2b ${stamp}%')
                      + (select count(*) from learning_mgmt.skill_assessments where skill_name like 'QA w2b ${stamp}%')
                      + (select count(*) from learning_mgmt.employee_skills where skill_name like 'QA w2b ${stamp}%')`)
  check('cleanup: everything the test created is removed', left === '0', `left=${left}`)
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
