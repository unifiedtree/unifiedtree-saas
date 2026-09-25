// Live API check for w2a (V143.20): hiring interviews and scorecards, the
// pipeline board across roles and stages, onboarding hire details, template
// task order and owner roles, and "my assets". No browser.
//
// What it proves, against the local recovery backend and database:
//  - the board lists candidates across roles and filters by stage (the
//    dashboard's ?tab=candidates&stage=… links) and carries interview and
//    scorecard summaries; a stage move uses the same API as drag and drop
//  - HR schedules / reschedules / cancels interviews (IST times), the
//    interviewers get notifications, only Screening / Interview candidates can
//    be booked, bad input is refused
//  - an interviewer sees only their interviews and their own scorecard, submits
//    it once the interview has started; others get 403; hiring roles see all
//  - converting a candidate starts onboarding with the hire details filled in
//    (offer accepted date, hiring manager, recruiter, source); HR edits them
//    (buddy); the employee workspace's onboarding record shows them
//  - template tasks reorder; the owner role must be one of the workspace roles
//  - /v1/me/assets shows the caller's own equipment only
// Everything it creates is removed at the end.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w2a.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444'
const FIN = '55555555-5555-5555-5555-555555555555'
const psql = `${process.env.LOCALAPPDATA}/UnifiedTreeRecovery/pgsql/bin/psql.exe`
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const istDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const tag = randomUUID().slice(0, 6)
const created = { requisition: null, offer: null, employee: null, template: null, asset: null, interviews: [] }
const notifCount = (interviewId, user, type) => Number(sql(`select count(*) from notif.notifications where tenant_id='${tenant}' and data->>'interviewId'='${interviewId}' and user_id='${user}' and type='${type}'`))

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')

  // ── permissions ──
  check('owner holds all three new permissions', ['hrms.hiring.interview.write', 'hrms.hiring.interview.self', 'hrms.onboarding.asset.self'].every((p) => owner.perms.includes(p)))
  check('HR manager and super admin can schedule interviews', hrm.perms.includes('hrms.hiring.interview.write') && admin.perms.includes('hrms.hiring.interview.write'))
  check('manager is an interviewer, not a scheduler', mgr.perms.includes('hrms.hiring.interview.self') && !mgr.perms.includes('hrms.hiring.interview.write'))
  check('employee can take interviews and see their assets', reader.perms.includes('hrms.hiring.interview.self') && reader.perms.includes('hrms.onboarding.asset.self') && !reader.perms.includes('hrms.hiring.read'))

  // ── fixtures: a requisition (hiring manager = the dept manager) and two candidates added by HR ──
  const req = await owner.call('POST', '/v1/hiring/requisitions', { companyId: company, title: `QA w2a Engineer ${tag}`, openings: 1, employmentType: 'FULL_TIME', location: 'Hyderabad', hiringManagerId: MGR })
  created.requisition = req.json?.id
  check('fixture: requisition', req.status === 201, `status=${req.status}`)
  const a = await hrm.call('POST', `/v1/hiring/requisitions/${created.requisition}/candidates`, { fullName: `Asha QA${tag}`, email: `asha.qa.${tag}@unifiedtree.demo`, phone: '9876500011', source: 'Referral', expectedCtc: 900000 })
  const b = await hrm.call('POST', `/v1/hiring/requisitions/${created.requisition}/candidates`, { fullName: `Bala QA${tag}` })
  const A = a.json?.id, B = b.json?.id
  check('fixture: two candidates', a.status === 201 && b.status === 201)
  const toScreening = await hrm.call('PUT', `/v1/hiring/candidates/${A}/stage`, { stage: 'SCREENING' })
  check('stage move (the API drag and drop uses) works', toScreening.status === 200 && sql(`select stage from hiring_mgmt.candidates where id='${A}'`) === 'SCREENING')
  const skip = await hrm.call('PUT', `/v1/hiring/candidates/${B}/stage`, { stage: 'OFFER' })
  check('a drop that skips stages is refused', skip.status >= 400 && sql(`select stage from hiring_mgmt.candidates where id='${B}'`) === 'APPLIED', `status=${skip.status}`)

  // ── board ──
  const board = await hrm.call('GET', `/v1/hiring/candidates?requisitionId=${created.requisition}`)
  check('board lists the role’s candidates with the role title', board.status === 200 && board.json.length === 2 && board.json.every((c) => c.requisitionTitle === `QA w2a Engineer ${tag}`))
  const screening = await hrm.call('GET', '/v1/hiring/candidates?stage=SCREENING')
  check('stage filter across all roles (dashboard link) shows only that stage', screening.status === 200 && screening.json.some((c) => c.id === A) && !screening.json.some((c) => c.id === B) && screening.json.every((c) => c.stage === 'SCREENING'))
  const mgrBoard = await mgr.call('GET', `/v1/hiring/candidates?requisitionId=${created.requisition}`)
  check('department manager (hiring.read) can see the board', mgrBoard.status === 200)
  check('employee cannot read the board (403)', (await reader.call('GET', '/v1/hiring/candidates')).status === 403)

  // ── schedule ──
  const slot = (days, time) => `${istDate(days)}T${time}`
  const body = { title: 'Technical round', scheduledAt: slot(1, '10:30'), durationMinutes: 45, mode: 'VIDEO', location: 'https://meet.example.com/qa-w2a', interviewerIds: [READER, MGR], criteria: ['Coding', 'Communication'] }
  const notSchedulable = await hrm.call('POST', `/v1/hiring/candidates/${B}/interviews`, body)
  check('an Applied candidate cannot be booked (422)', notSchedulable.status === 422 && notSchedulable.json?.errorCode === 'INTERVIEW_STAGE_INVALID', `${notSchedulable.status} ${notSchedulable.json?.errorCode}`)
  check('manager cannot schedule (403)', (await mgr.call('POST', `/v1/hiring/candidates/${A}/interviews`, body)).status === 403)
  check('employee cannot schedule (403)', (await reader.call('POST', `/v1/hiring/candidates/${A}/interviews`, body)).status === 403)
  const past = await hrm.call('POST', `/v1/hiring/candidates/${A}/interviews`, { ...body, scheduledAt: slot(-1, '10:00') })
  check('a past time is refused', past.status === 422 && past.json?.errorCode === 'INTERVIEW_TIME_PAST', `${past.status} ${past.json?.errorCode}`)
  const noLink = await hrm.call('POST', `/v1/hiring/candidates/${A}/interviews`, { ...body, location: '' })
  check('a video interview needs its link', noLink.status === 422 && noLink.json?.errorCode === 'INTERVIEW_LINK_REQUIRED', `${noLink.status} ${noLink.json?.errorCode}`)
  const s1 = await hrm.call('POST', `/v1/hiring/candidates/${A}/interviews`, body)
  const I1 = s1.json?.id
  if (I1) created.interviews.push(I1)
  check('HR schedules an interview (201)', s1.status === 201 && s1.json?.interviewers?.length === 2, `status=${s1.status} ${s1.json?.message ?? ''}`)
  const storedUtc = sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') from hiring_mgmt.interviews where id='${I1}'`)
  const expectedUtc = new Date(`${istDate(1)}T10:30:00+05:30`).toISOString().slice(0, 16)
  check('10:30 IST is stored as 05:00 UTC', storedUtc === expectedUtc, `${storedUtc} vs ${expectedUtc}`)
  check('DB: two interviewers and the criteria', sql(`select count(*) from hiring_mgmt.interview_interviewers where interview_id='${I1}'`) === '2' && sql(`select criteria::text from hiring_mgmt.interviews where id='${I1}'`) === '["Coding", "Communication"]')
  check('both interviewers were notified', notifCount(I1, READER, 'INTERVIEW_SCHEDULED') === 1 && notifCount(I1, MGR, 'INTERVIEW_SCHEDULED') === 1)
  const card = (await hrm.call('GET', `/v1/hiring/candidates?requisitionId=${created.requisition}`)).json?.find((c) => c.id === A)
  check('board card shows the next interview', card?.upcomingInterviews === 1 && !!card?.nextInterviewAt)

  // ── who sees what ──
  const upcoming = await hrm.call('GET', '/v1/hiring/interviews')
  check('HR sees it among upcoming interviews', upcoming.status === 200 && upcoming.json.some((i) => i.id === I1))
  check('employee cannot list all interviews (403)', (await reader.call('GET', '/v1/hiring/interviews')).status === 403)
  check('the interviewer sees it under their interviews', (await reader.call('GET', '/v1/hiring/interviews/mine')).json?.some((i) => i.id === I1))
  check('someone not on it does not', !(await fin.call('GET', '/v1/hiring/interviews/mine')).json?.some((i) => i.id === I1))
  check('someone not on it cannot open it (403)', (await fin.call('GET', `/v1/hiring/interviews/${I1}`)).status === 403)
  check('the interviewer can open it', (await reader.call('GET', `/v1/hiring/interviews/${I1}`)).status === 200)

  // ── reschedule: new time, finance lead replaces the manager ──
  const r1 = await hrm.call('PUT', `/v1/hiring/interviews/${I1}`, { ...body, scheduledAt: slot(2, '15:00'), interviewerIds: [READER, FIN] })
  check('HR reschedules and changes the panel', r1.status === 200 && r1.json?.interviewers?.map((p) => p.employeeId).sort().join() === [READER, FIN].sort().join(), `status=${r1.status}`)
  check('the kept interviewer is told it changed', notifCount(I1, READER, 'INTERVIEW_RESCHEDULED') === 1)
  check('the new interviewer is told they are on it', notifCount(I1, FIN, 'INTERVIEW_SCHEDULED') === 1)
  check('the removed interviewer is told they are off it', notifCount(I1, MGR, 'INTERVIEW_CANCELLED') === 1)
  check('manager cannot reschedule (403)', (await mgr.call('PUT', `/v1/hiring/interviews/${I1}`, body)).status === 403)

  // ── scorecards ──
  const early = await reader.call('PUT', `/v1/hiring/interviews/${I1}/scorecard`, { ratings: [{ criterion: 'Coding', rating: 4 }, { criterion: 'Communication', rating: 5 }], recommendation: 'YES' })
  check('no scorecard before the interview starts', early.status === 422 && early.json?.errorCode === 'SCORECARD_TOO_EARLY', `${early.status} ${early.json?.errorCode}`)
  sql(`update hiring_mgmt.interviews set scheduled_at = now() - interval '1 hour' where id='${I1}'`) // the interview "happened"
  const startedIst = (await hrm.call('GET', `/v1/hiring/interviews/${I1}`)).json?.scheduledAtIst
  const keep = await hrm.call('PUT', `/v1/hiring/interviews/${I1}`, { ...body, scheduledAt: startedIst, interviewerIds: [READER, FIN], notes: 'Panel confirmed after the call' })
  check('a started interview can still be changed when its time is kept', keep.status === 200 && sql(`select notes from hiring_mgmt.interviews where id='${I1}'`) === 'Panel confirmed after the call', `${keep.status} ${keep.json?.errorCode ?? ''}`)
  const movedPast = await hrm.call('PUT', `/v1/hiring/interviews/${I1}`, { ...body, scheduledAt: slot(-2, '10:00'), interviewerIds: [READER, FIN] })
  check('but it cannot be moved to another past time', movedPast.status === 422 && movedPast.json?.errorCode === 'INTERVIEW_TIME_PAST', `${movedPast.status} ${movedPast.json?.errorCode}`)
  const missing = await reader.call('PUT', `/v1/hiring/interviews/${I1}/scorecard`, { ratings: [{ criterion: 'Coding', rating: 4 }], recommendation: 'YES' })
  check('every criterion must be rated', missing.status === 422 && missing.json?.errorCode === 'SCORECARD_RATING_MISSING', `${missing.status} ${missing.json?.errorCode}`)
  const sc1 = await reader.call('PUT', `/v1/hiring/interviews/${I1}/scorecard`, { ratings: [{ criterion: 'Coding', rating: 4 }, { criterion: 'Communication', rating: 5 }], strengths: 'Clear thinker', concerns: 'Little cloud work', recommendation: 'YES' })
  check('the interviewer submits their scorecard', sc1.status === 200 && sql(`select overall_rating||'|'||recommendation from hiring_mgmt.interview_scorecards where interview_id='${I1}' and interviewer_id='${READER}'`) === '4.50|YES', `status=${sc1.status}`)
  check('the manager, taken off the panel, cannot submit (403)', (await mgr.call('PUT', `/v1/hiring/interviews/${I1}/scorecard`, { ratings: [{ criterion: 'Coding', rating: 1 }, { criterion: 'Communication', rating: 1 }], recommendation: 'NO' })).status === 403)
  const sc2 = await fin.call('PUT', `/v1/hiring/interviews/${I1}/scorecard`, { ratings: [{ criterion: 'Coding', rating: 3 }, { criterion: 'Communication', rating: 4 }], recommendation: 'STRONG_YES' })
  check('the second interviewer submits', sc2.status === 200)
  const readerView = await reader.call('GET', `/v1/hiring/interviews/${I1}`)
  check('an interviewer sees only their own scorecard', readerView.json?.scorecards?.length === 1 && readerView.json.scorecards[0].interviewerId === READER)
  const hrView = await hrm.call('GET', `/v1/hiring/candidates/${A}/interviews`)
  check('HR sees every scorecard on the candidate', hrView.status === 200 && hrView.json?.[0]?.scorecards?.length === 2)
  const summary = (await hrm.call('GET', `/v1/hiring/candidates?requisitionId=${created.requisition}`)).json?.find((c) => c.id === A)?.scorecards
  check('board summary: 2 scorecards, 4.0 average, 1 yes + 1 strong yes', summary?.count === 2 && Number(summary?.averageRating) === 4 && summary?.recommendations?.YES === 1 && summary?.recommendations?.STRONG_YES === 1, JSON.stringify(summary))
  const cancelScored = await hrm.call('POST', `/v1/hiring/interviews/${I1}/cancel`, {})
  check('an interview with feedback cannot be cancelled', cancelScored.status === 422 && cancelScored.json?.errorCode === 'INTERVIEW_HAS_FEEDBACK')

  // ── cancel ──
  const s2 = await hrm.call('POST', `/v1/hiring/candidates/${A}/interviews`, { ...body, title: 'Culture round', scheduledAt: slot(3, '11:00'), mode: 'IN_PERSON', location: 'Hyderabad office, room 3', interviewerIds: [MGR] })
  const I2 = s2.json?.id
  if (I2) created.interviews.push(I2)
  check('a second, in-person interview', s2.status === 201)
  check('manager cannot cancel (403)', (await mgr.call('POST', `/v1/hiring/interviews/${I2}/cancel`, {})).status === 403)
  const c2 = await hrm.call('POST', `/v1/hiring/interviews/${I2}/cancel`, { reason: 'Candidate asked to move it' })
  check('HR cancels it; the interviewer is told', c2.status === 200 && sql(`select status from hiring_mgmt.interviews where id='${I2}'`) === 'CANCELLED' && notifCount(I2, MGR, 'INTERVIEW_CANCELLED') === 1)
  check('a cancelled interview cannot be changed', (await hrm.call('PUT', `/v1/hiring/interviews/${I2}`, body)).status === 422)

  // ── onboarding: owner roles, task order ──
  const roles = await hrm.call('GET', '/v1/onboarding/owner-roles')
  check('owner roles come from the workspace roles', roles.status === 200 && roles.json.some((r) => r.code === 'HR_MANAGER') && !roles.json.some((r) => r.code === 'PLATFORM_SUPER_ADMIN'))
  check('employee cannot list owner roles (403)', (await reader.call('GET', '/v1/onboarding/owner-roles')).status === 403)
  const tpl = await hrm.call('POST', '/v1/onboarding/templates', { companyId: company, name: `AAA QA w2a joining ${tag}`, description: 'QA', active: true })
  created.template = tpl.json?.id
  check('fixture: general checklist template', tpl.status === 201)
  const t1 = await hrm.call('POST', `/v1/onboarding/templates/${created.template}/tasks`, { title: 'QA sign handbook', dueOffsetDays: 1, required: true, sequenceNo: 1, ownerRole: 'HR_MANAGER' })
  const t2 = await hrm.call('POST', `/v1/onboarding/templates/${created.template}/tasks`, { title: 'QA laptop', dueOffsetDays: 1, required: true, ownerRole: 'EMPLOYEE' })
  const t3 = await hrm.call('POST', `/v1/onboarding/templates/${created.template}/tasks`, { title: 'QA meet team', dueOffsetDays: 2, required: false })
  check('tasks added; one without a position goes last', t1.status === 201 && t2.status === 201 && t3.status === 201 && t2.json?.sequenceNo === 2 && t3.json?.sequenceNo === 3)
  const badRole = await hrm.call('POST', `/v1/onboarding/templates/${created.template}/tasks`, { title: 'QA bad owner', dueOffsetDays: 1, ownerRole: 'NOT_A_ROLE' })
  check('an owner role outside the workspace roles is refused', badRole.status === 422 && badRole.json?.errorCode === 'TASK_OWNER_ROLE_UNKNOWN', `${badRole.status} ${badRole.json?.errorCode}`)
  const order = [t3.json.id, t1.json.id, t2.json.id]
  const re = await hrm.call('PUT', `/v1/onboarding/templates/${created.template}/tasks/order`, { taskIds: order })
  check('tasks reordered', re.status === 200 && re.json?.tasks?.map((t) => t.id).join() === order.join()
    && sql(`select string_agg(id::text, ',' order by sequence_no) from hrms.onboarding_tasks where template_id='${created.template}'`) === order.join())
  const reBad = await hrm.call('PUT', `/v1/onboarding/templates/${created.template}/tasks/order`, { taskIds: [t1.json.id, t2.json.id] })
  check('a reorder that leaves a task out is refused', reBad.status === 422 && reBad.json?.errorCode === 'TASK_ORDER_INVALID')
  check('employee cannot reorder (403)', (await reader.call('PUT', `/v1/onboarding/templates/${created.template}/tasks/order`, { taskIds: order })).status === 403)

  // ── conversion → onboarding with hire details ──
  for (const stage of ['INTERVIEW', 'OFFER', 'HIRED']) await hrm.call('PUT', `/v1/hiring/candidates/${A}/stage`, { stage })
  const offer = await owner.call('POST', '/v1/hiring/offers', { companyId: company, requisitionId: created.requisition, candidateId: A, candidateName: `Asha QA${tag}`, roleTitle: 'QA Engineer', offeredCtc: 1000000, joiningDate: istDate(14), offerTerms: 'Standard terms.' })
  created.offer = offer.json?.id
  for (const status of ['SENT', 'ACCEPTED']) await owner.call('POST', `/v1/hiring/offers/${created.offer}/status`, { status })
  const conv = await owner.call('POST', `/v1/hiring/candidates/${A}/convert`)
  created.employee = conv.json?.employee?.id
  check('conversion starts the onboarding', conv.status === 201 && !!conv.json?.onboardingInstanceId, `status=${conv.status} instance=${conv.json?.onboardingInstanceId} template=${conv.json?.onboardingTemplateName}`)
  const inst = conv.json?.onboardingInstanceId
  const row = inst ? sql(`select coalesce(candidate_id::text,'')||'|'||coalesce(hire_source,'')||'|'||coalesce(hiring_manager_id::text,'')||'|'||coalesce(recruiter_id::text,'')||'|'||coalesce(offer_accepted_on::text,'') from hrms.onboarding_instances where id='${inst}'`) : ''
  check('hire details filled from the candidate and accepted offer', row === `${A}|Referral|${MGR}|${HRM}|${istDate(0)}`, row)
  const hd = await hrm.call('GET', `/v1/onboarding/instances/${inst}/hire-details`)
  check('HR reads the hire details with names', hd.status === 200 && hd.json?.hiringManager?.name === 'Dept Manager' && hd.json?.recruiter?.name === 'HR Manager' && hd.json?.source === 'Referral')
  check('someone else cannot read them (403)', (await reader.call('GET', `/v1/onboarding/instances/${inst}/hire-details`)).status === 403)
  const setBuddy = await hrm.call('PUT', `/v1/onboarding/instances/${inst}/hire-details`, { ...{ offerAcceptedOn: hd.json.offerAcceptedOn, hiringManagerId: MGR, recruiterId: HRM, source: 'Referral' }, buddyId: READER })
  check('HR sets the buddy', setBuddy.status === 200 && sql(`select buddy_id from hrms.onboarding_instances where id='${inst}'`) === READER)
  const selfBuddy = await hrm.call('PUT', `/v1/onboarding/instances/${inst}/hire-details`, { buddyId: created.employee })
  check('the new hire cannot be their own buddy', selfBuddy.status === 422 && selfBuddy.json?.errorCode === 'HIRE_BUDDY_SELF')
  const future = await hrm.call('PUT', `/v1/onboarding/instances/${inst}/hire-details`, { offerAcceptedOn: istDate(5) })
  check('a future offer date is refused', future.status === 422 && future.json?.errorCode === 'HIRE_OFFER_DATE_FUTURE')
  check('manager cannot edit hire details (403)', (await mgr.call('PUT', `/v1/onboarding/instances/${inst}/hire-details`, { buddyId: READER })).status === 403)
  const record = await hrm.call('GET', `/v1/hrms/employees/${created.employee}/onboarding-record`)
  check('employee workspace onboarding record shows the hire details', record.status === 200 && record.json?.hire?.buddy?.name === 'Reader User' && record.json?.hire?.hiringManager?.name === 'Dept Manager' && !!record.json?.hire?.offerAcceptedOn, JSON.stringify(record.json?.hire))

  // ── my assets ──
  const asset = await hrm.call('POST', '/v1/onboarding/assets', { companyId: company, assetTag: `QA-W2A-${tag}`, assetType: 'Laptop', assetName: 'QA ThinkPad', serialNo: `SN-${tag}` })
  created.asset = asset.json?.id
  const assign = await hrm.call('POST', `/v1/onboarding/assets/${created.asset}/assign`, { employeeId: READER })
  check('fixture: laptop handed to the employee', asset.status === 201 && assign.status === 200)
  const mine = await reader.call('GET', '/v1/me/assets')
  check('employee sees the laptop as with them', mine.status === 200 && mine.json.some((x) => x.assetId === created.asset && x.withMe && x.serialNo === `SN-${tag}`))
  check('another employee does not see it', !(await fin.call('GET', '/v1/me/assets')).json?.some((x) => x.assetId === created.asset))
  await hrm.call('POST', `/v1/onboarding/assets/${created.asset}/return`, { notes: 'QA returned' })
  const after = (await reader.call('GET', '/v1/me/assets')).json?.find((x) => x.assetId === created.asset)
  check('after the return it shows as returned, with the date and note', after && !after.withMe && after.returnedAt === istDate(0) && after.returnNotes === 'QA returned', JSON.stringify(after))
} catch (e) {
  check('run completed without an exception', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  try {
    for (const id of created.interviews) sql(`delete from notif.notifications where tenant_id='${tenant}' and data->>'interviewId'='${id}'`)
    if (created.asset) sql(`delete from hrms.asset_allocations where asset_id='${created.asset}'; delete from hrms.onboarding_assets where id='${created.asset}'`)
    if (created.employee) sql(`update hiring_mgmt.candidates set converted_employee_id=null where converted_employee_id='${created.employee}'; delete from hrms.employee_onboarding_records where employee_id='${created.employee}'; delete from hrms.employees where id='${created.employee}' and tenant_id='${tenant}'`)
    if (created.template) sql(`delete from hrms.onboarding_instances where template_id='${created.template}'; delete from hrms.onboarding_templates where id='${created.template}'`)
    if (created.offer) sql(`delete from hiring_mgmt.offers where id='${created.offer}'`)
    if (created.requisition) sql(`delete from hiring_mgmt.job_requisitions where id='${created.requisition}'`) // candidates, interviews, panels and scorecards cascade
    console.log('fixtures removed')
  } catch (e) { console.log('cleanup failed (QA records left):', String(e).split('\n')[0]) }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  if (failed) process.exitCode = 1
}
