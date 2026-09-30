// P-HIRE backend (redesign BW-65..BW-70, migration V143_59), API level.
//
// Hiring: a candidate walked through every stage writes a history row per move
// (same transaction), the no-skip rule still holds, the funnel and the summary
// count them; the candidate email on an offer, its fallback and one-click send.
// Onboarding: the New hires overview and its scope, "Used by" on templates.
// Assets: holder names only with hrms.employee.read; the holder confirms an
// asset, reports a problem (asset managers are notified), HR resolves it.
// 403s per role. In the slot database only (ut_w3_dev): each new table is
// renamed for one step, which must answer FEATURE_NOT_READY (or leave the new
// field empty) while everything else keeps working, and the one-time
// confirmation backfill is exercised by re-applying the migration.
// Everything created is removed.
//
// Run from apps/platform (API on :8080):
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-hire-api.mjs
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const slotDb = db === 'ut_w3_dev'
const mailApi = process.env.RECOVERY_MAIL_API || 'http://127.0.0.1:18025'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const psqlArgs = ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1']
const sql = (q) => execFileSync(PSQL, [...psqlArgs, '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const here = path.dirname(fileURLToPath(import.meta.url))
const migration = path.resolve(here, '../../../../backend/app/hrms-app/src/main/resources/db/canonical/V143_59__hiring_history_offer_email_asset_care.sql')

let pass = 0, fail = 0
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`) }

// Any FEATURE_NOT_READY outside a deliberate rename step is a bug (all migrations are applied).
let renameStep = false
const notReadyOutsideRename = []
const unexpected5xx = []

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const token = (await r.json()).accessToken
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  return { h: { ...headers, Authorization: `Bearer ${token}` }, employeeId: claims.employee_id, email }
}
async function call(who, method, p, body) {
  const r = await fetch(api + p, { method, headers: who.h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null; try { json = await r.json() } catch { /* empty */ }
  if (json?.errorCode === 'FEATURE_NOT_READY' && !renameStep) notReadyOutsideRename.push(`${method} ${p}`)
  if (r.status >= 500 && !(renameStep && r.status === 503)) unexpected5xx.push(`${method} ${p} ${r.status} ${json?.errorCode ?? ''}`)
  return { status: r.status, json }
}
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const reachedOf = (f) => Object.fromEntries((f?.stages ?? []).map((s) => [s.stage, s.reached]))
const openStagesOf = (s) => Object.fromEntries((s?.openRoleStages ?? []).map((x) => [x.stage, x.count]))

const tag = randomUUID().slice(0, 6)
const created = { requisition: null, offers: [], assets: [], employee: null, issueIds: [] }
const renamed = [] // [schema, original, temporary] to put back if the run stops half-way
async function withRenamed(schema, table, fn) {
  const tmp = `${table}_qa_${tag}`
  sql(`ALTER TABLE ${schema}.${table} RENAME TO ${tmp}`)
  renamed.push([schema, table, tmp])
  renameStep = true
  try { return await fn() } finally {
    renameStep = false
    sql(`ALTER TABLE ${schema}.${tmp} RENAME TO ${table}`)
    renamed.pop()
  }
}

const startedAt = new Date().toISOString()
try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const today = istToday()

  // ── Hiring: summary and funnel before ────────────────────────────────────
  const summary0 = await call(owner, 'GET', `/v1/hiring/summary?companyId=${company}`)
  check('summary answers for the owner', summary0.status === 200, `${summary0.status}`)
  const funnel0 = await call(owner, 'GET', `/v1/hiring/funnel?from=${today}&to=${today}`)
  check('funnel answers for the owner', funnel0.status === 200, `${funnel0.status} ${funnel0.json?.errorCode ?? ''}`)

  const req = await call(owner, 'POST', '/v1/hiring/requisitions', { companyId: company, title: `QA Funnel Engineer ${tag}`, openings: 3, employmentType: 'FULL_TIME', location: 'Hyderabad' })
  check('requisition created', req.status === 201, `${req.status}`)
  created.requisition = req.json.id
  const add = (name, email) => call(owner, 'POST', `/v1/hiring/requisitions/${req.json.id}/candidates`, { fullName: name, email, source: 'Referral', stage: 'OFFER' })
  const a = (await add(`Asha QA${tag}`, `asha.qa.${tag}@example.test`)).json
  const b = (await add(`Bala QA${tag}`, `bala.qa.${tag}@example.test`)).json
  const c = (await add(`Chitra QA${tag}`, null)).json
  check('a new candidate always starts at Applied (a stage in the request is ignored)', [a, b, c].every((x) => x?.stage === 'APPLIED'), [a, b, c].map((x) => x?.stage).join(','))
  const skip = await call(owner, 'PUT', `/v1/hiring/candidates/${c.id}/stage`, { stage: 'OFFER' })
  check('no-skip rule: Applied → Offer is refused', skip.status === 409 || skip.status === 422, `${skip.status} ${skip.json?.errorCode ?? ''}`)

  for (const stage of ['SCREENING', 'INTERVIEW']) await call(owner, 'PUT', `/v1/hiring/candidates/${a.id}/stage`, { stage })
  await call(owner, 'PUT', `/v1/hiring/candidates/${b.id}/stage`, { stage: 'SCREENING' })
  await call(owner, 'PUT', `/v1/hiring/candidates/${b.id}/stage`, { stage: 'REJECTED' })
  const same = await call(owner, 'PUT', `/v1/hiring/candidates/${b.id}/stage`, { stage: 'REJECTED' })
  check('saving the same stage is still fine', same.status === 200, `${same.status}`)

  // Offer for Asha: created while in Interview → Offer; then sent and accepted → Hired.
  const joining = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
  const offerA = await call(owner, 'POST', '/v1/hiring/offers', { companyId: company, requisitionId: req.json.id, candidateId: a.id, candidateName: `Asha QA${tag}`, roleTitle: 'QA Engineer', offeredCtc: 900000, joiningDate: joining, offerTerms: 'Standard terms.' })
  check('offer created for the interviewed candidate', offerA.status === 201, `${offerA.status}`)
  created.offers.push(offerA.json.id)
  check('offer without a typed email falls back to the linked candidate\'s email', offerA.json.candidateEmail === `asha.qa.${tag}@example.test`, offerA.json.candidateEmail)
  const mismatch = await call(owner, 'PUT', `/v1/hiring/offers/${offerA.json.id}`, { companyId: company, requisitionId: req.json.id, candidateId: a.id, candidateName: `Asha QA${tag}`, roleTitle: 'QA Engineer', offeredCtc: 900000, joiningDate: joining, offerTerms: 'Standard terms.', candidateEmail: `someone.${tag}@example.test` })
  check('a linked candidate\'s offer only takes their recorded email', mismatch.status === 422 && mismatch.json?.errorCode === 'OFFER_EMAIL_MISMATCH', `${mismatch.status} ${mismatch.json?.errorCode}`)
  for (const status of ['SENT', 'ACCEPTED']) await call(owner, 'POST', `/v1/hiring/offers/${offerA.json.id}/status`, { status })
  const aNow = (await call(owner, 'GET', `/v1/hiring/requisitions/${req.json.id}/candidates`)).json.find((x) => x.id === a.id)
  check('accepted offer moves the candidate to Hired', aNow?.stage === 'HIRED', aNow?.stage)

  // Conversion writes its own row.
  const conv = await call(owner, 'POST', `/v1/hiring/candidates/${a.id}/convert`)
  check('hired candidate converted', conv.status === 201, `${conv.status} ${conv.json?.errorCode ?? ''}`)
  created.employee = conv.json?.employee?.id ?? null

  const events = sql(`SELECT string_agg(coalesce(from_stage,'-')||'>'||to_stage||':'||event_kind, ' ' ORDER BY changed_at) FROM hiring_mgmt.candidate_stage_events WHERE candidate_id='${a.id}'`)
  check('every move of the candidate has its history row, in order', events === '->APPLIED:ADDED APPLIED>SCREENING:STAGE_CHANGE SCREENING>INTERVIEW:STAGE_CHANGE INTERVIEW>OFFER:OFFER_CREATED OFFER>HIRED:OFFER_ACCEPTED HIRED>HIRED:CONVERTED', events)
  const bEvents = sql(`SELECT count(*) FROM hiring_mgmt.candidate_stage_events WHERE candidate_id='${b.id}'`)
  check('a same-stage save and a refused move add no rows', bEvents === '3' && sql(`SELECT count(*) FROM hiring_mgmt.candidate_stage_events WHERE candidate_id='${c.id}'`) === '1', `b=${bEvents}`)
  const actor = sql(`SELECT count(DISTINCT changed_by) FROM hiring_mgmt.candidate_stage_events WHERE candidate_id='${a.id}' AND changed_by IS NOT NULL`)
  check('rows say who made the move', actor === '1', actor)

  const funnel1 = await call(owner, 'GET', `/v1/hiring/funnel?from=${today}&to=${today}`)
  const r0 = reachedOf(funnel0.json), r1 = reachedOf(funnel1.json)
  const delta = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'].map((s) => (r1[s] ?? 0) - (r0[s] ?? 0))
  check('funnel: 3 applied, 2 screened, 1 interviewed, 1 offered, 1 hired', delta.join(',') === '3,2,1,1,1', delta.join(','))
  check('funnel: the cohort grew by exactly our 3 tracked candidates', funnel1.json.trackedCandidates - funnel0.json.trackedCandidates === 3, `${funnel0.json.trackedCandidates}→${funnel1.json.trackedCandidates}`)
  check('funnel: history start is known', !!funnel1.json.trackedFrom, funnel1.json.trackedFrom)
  check('funnel: time to hire counts the hire', funnel1.json.timeToHire.hires - (funnel0.json.timeToHire?.hires ?? 0) === 1 && funnel1.json.timeToHire.averageDays !== null, JSON.stringify(funnel1.json.timeToHire))
  check('funnel: conversion rates are between 0 and 1', funnel1.json.conversions.every((x) => x.rate === null || (x.rate >= 0 && x.rate <= 1)), funnel1.json.conversions.map((x) => x.rate).join(','))
  const funnelCompany = await call(owner, 'GET', `/v1/hiring/funnel?companyId=${company}&from=${today}&to=${today}`)
  check('funnel for one company answers', funnelCompany.status === 200 && funnelCompany.json.trackedCandidates >= 3, `${funnelCompany.status}`)
  const upside = await call(owner, 'GET', `/v1/hiring/funnel?from=${today}&to=2020-01-01`)
  check('an upside-down period is refused', upside.status === 422 && upside.json?.errorCode === 'FUNNEL_RANGE_INVALID', `${upside.status}`)

  const summary1 = await call(owner, 'GET', `/v1/hiring/summary?companyId=${company}`)
  const s0 = summary0.json, s1 = summary1.json
  check('summary: our open requisition and its 3 positions are counted', s1.requisitions.open - s0.requisitions.open === 1 && s1.positionsToFill - s0.positionsToFill === 3, `open ${s0.requisitions.open}→${s1.requisitions.open}, positions ${s0.positionsToFill}→${s1.positionsToFill}`)
  check('summary: candidates this quarter grew by 3', s1.candidatesThisQuarter - s0.candidatesThisQuarter === 3, `${s0.candidatesThisQuarter}→${s1.candidatesThisQuarter}`)
  const o0 = openStagesOf(s0), o1 = openStagesOf(s1)
  check('summary: stages on open roles (hired, rejected, applied)', o1.HIRED - o0.HIRED === 1 && o1.REJECTED - o0.REJECTED === 1 && o1.APPLIED - o0.APPLIED === 1, JSON.stringify(o1))

  // One-click offer email with a typed candidate email (no linked candidate).
  const plain = await call(owner, 'POST', '/v1/hiring/offers', { companyId: company, candidateName: `Deepa QA${tag}`, roleTitle: 'Analyst', offeredCtc: 600000, offerTerms: 'Approved QA terms.', candidateEmail: `deepa.qa.${tag}@example.test` })
  created.offers.push(plain.json?.id)
  check('offer stores a typed candidate email', plain.status === 201 && plain.json.candidateEmail === `deepa.qa.${tag}@example.test`, `${plain.status} ${plain.json?.candidateEmail}`)
  const listed = (await call(owner, 'GET', '/v1/hiring/offers?size=50')).json?.content?.find((o) => o.id === plain.json.id)
  check('the offers list carries the email too', listed?.candidateEmail === `deepa.qa.${tag}@example.test`, listed?.candidateEmail)
  const sent = await call(owner, 'POST', `/v1/hiring/offers/${plain.json.id}/email`, {})
  check('one-click "Send offer email" uses the stored email', sent.status === 200 && sent.json?.emailRecipient === `deepa.qa.${tag}@example.test` && sent.json?.status === 'SENT', `${sent.status} ${sent.json?.emailRecipient ?? sent.json?.errorCode}`)
  try {
    const messages = await (await fetch(`${mailApi}/messages`)).json()
    check('the mail catcher got exactly one offer for that address', messages.filter((m) => m.to.includes(`deepa.qa.${tag}@example.test`)).length === 1)
  } catch (e) { check('the mail catcher got the offer', false, String(e)) }
  const noEmail = await call(owner, 'POST', '/v1/hiring/offers', { companyId: company, candidateName: `Esha QA${tag}`, roleTitle: 'Analyst', offeredCtc: 600000, offerTerms: 'Terms.' })
  created.offers.push(noEmail.json?.id)
  const refused = await call(owner, 'POST', `/v1/hiring/offers/${noEmail.json.id}/email`, {})
  check('send with no email anywhere is refused, nothing sent', refused.status === 422 && refused.json?.errorCode === 'OFFER_EMAIL_REQUIRED', `${refused.status} ${refused.json?.errorCode}`)
  const cleared = await call(owner, 'PUT', `/v1/hiring/offers/${noEmail.json.id}`, { companyId: company, candidateName: `Esha QA${tag}`, roleTitle: 'Analyst', offeredCtc: 600000, offerTerms: 'Terms.', candidateEmail: `esha.qa.${tag}@example.test` })
  const kept = await call(owner, 'PUT', `/v1/hiring/offers/${noEmail.json.id}`, { companyId: company, candidateName: `Esha QA${tag}`, roleTitle: 'Analyst', offeredCtc: 650000, offerTerms: 'Terms.' })
  check('an edit that leaves the email out keeps it', cleared.json?.candidateEmail === `esha.qa.${tag}@example.test` && kept.json?.candidateEmail === `esha.qa.${tag}@example.test`, kept.json?.candidateEmail)

  // My interviews this quarter.
  for (const who of [owner, hrm, fin, mgr, reader]) {
    const m = await call(who, 'GET', '/v1/hiring/interviews/mine/summary')
    check(`${who.email.split('@')[0]}: my interviews this quarter answers`, m.status === 200 && typeof m.json.tookThisQuarter === 'number', `${m.status}`)
  }

  // Hiring 403s.
  for (const [who, code] of [[hrm, 200], [mgr, 200], [fin, 403], [reader, 403]]) {
    const s = await call(who, 'GET', '/v1/hiring/summary'), f = await call(who, 'GET', '/v1/hiring/funnel')
    check(`${who.email.split('@')[0]}: summary and funnel ${code}`, s.status === code && f.status === code, `${s.status}/${f.status}`)
  }

  // ── Onboarding: overview and templates ───────────────────────────────────
  const ov = await call(owner, 'GET', '/v1/onboarding/instances/overview')
  check('overview answers for the owner with counts and rows', ov.status === 200 && typeof ov.json.counts.all === 'number' && Array.isArray(ov.json.rows), `${ov.status}`)
  const conversionRun = ov.json.rows.find((r) => r.employeeId === created.employee)
  if (created.employee && conversionRun) check('the converted hire\'s onboarding shows name, checklist and tasks', !!conversionRun.employeeName && !!conversionRun.templateName && conversionRun.tasksTotal >= 0, `${conversionRun.employeeName} · ${conversionRun.templateName}`)
  check('overview counts match its rows', ov.json.counts.all === ov.json.rows.length, `${ov.json.counts.all} vs ${ov.json.rows.length}`)
  const listCount = (await call(owner, 'GET', '/v1/onboarding/instances')).json?.length
  check('overview covers the same onboardings as the list', listCount === ov.json.rows.length, `${listCount} vs ${ov.json.rows.length}`)
  for (const who of [fin, mgr, reader]) {
    const o = await call(who, 'GET', '/v1/onboarding/instances/overview')
    check(`${who.email.split('@')[0]}: overview shows only their own onboarding`, o.status === 200 && o.json.rows.every((r) => r.employeeId === who.employeeId), `${o.status} rows=${o.json?.rows?.length}`)
  }
  const templates = await call(owner, 'GET', '/v1/onboarding/templates')
  check('templates carry "used by"', templates.status === 200 && templates.json.every((t) => typeof t.usedBy === 'number' && t.id && 'tasks' in t), `${templates.status}`)

  // ── Assets ───────────────────────────────────────────────────────────────
  const readerName = sql(`SELECT concat_ws(' ', first_name, last_name) FROM hrms.employees WHERE id='${reader.employeeId}'`)
  const newAsset = async (n) => {
    const r = await call(owner, 'POST', '/v1/onboarding/assets', { companyId: company, assetTag: `QA-${tag}-${n}`, assetName: `QA Laptop ${n}`, assetType: 'Laptop' })
    created.assets.push(r.json.id)
    return r.json
  }
  const asset = await newAsset(1)
  const given = await call(owner, 'POST', `/v1/onboarding/assets/${asset.id}/assign`, { employeeId: reader.employeeId })
  check('asset given to reader, dated today', given.status === 200 && given.json.assignedAt === today, `${given.status} ${given.json?.assignedAt}`)

  let mine = (await call(reader, 'GET', '/v1/me/assets')).json.find((x) => x.assetId === asset.id)
  check('reader sees it waiting for confirmation', mine?.withMe && mine.canConfirm === true && mine.confirmedAt === null, JSON.stringify(mine))
  const findRow = async (who) => (await call(who, 'GET', `/v1/onboarding/assets?companyId=${company}`)).json?.find?.((x) => x.id === asset.id)
  const ownerRow = await findRow(owner)
  check('owner (employee read): holder named, confirmation pending', ownerRow?.holderName === readerName && ownerRow.confirmationPending === true && ownerRow.assetTag === asset.assetTag && ownerRow.status === 'ASSIGNED', JSON.stringify({ h: ownerRow?.holderName, p: ownerRow?.confirmationPending }))
  const finRow = await findRow(fin)
  check('fin (asset read + employee read): holder named', finRow?.holderName === readerName, finRow?.holderName)
  const mgrRow = await findRow(mgr)
  check('mgr (asset read, NO employee read): no holder name, id still there', mgrRow && mgrRow.holderName === null && mgrRow.lastHolderName === null && mgrRow.employeeId === reader.employeeId, JSON.stringify({ h: mgrRow?.holderName }))
  check('reader cannot list everyone\'s assets', (await call(reader, 'GET', '/v1/onboarding/assets')).status === 403)

  const notMine = await call(mgr, 'POST', `/v1/me/assets/${asset.id}/confirm`)
  check('someone else cannot confirm it', notMine.status === 404 && notMine.json?.errorCode === 'ASSET_NOT_WITH_YOU', `${notMine.status} ${notMine.json?.errorCode}`)
  const conf = await call(reader, 'POST', `/v1/me/assets/${asset.id}/confirm`)
  check('holder confirms: confirmed, nothing more to confirm', conf.status === 200 && !!conf.json.confirmedAt && conf.json.canConfirm === false, `${conf.status} ${conf.json?.confirmedAt}`)
  const conf2 = await call(reader, 'POST', `/v1/me/assets/${asset.id}/confirm`)
  check('confirming twice changes nothing', conf2.status === 200 && conf2.json.confirmedAt === conf.json.confirmedAt)
  check('HR list shows the confirmation', (await findRow(owner))?.confirmationSource === 'EMPLOYEE')

  const badKind = await call(reader, 'POST', `/v1/me/assets/${asset.id}/problem`, { kind: 'STOLEN_BY_ALIENS' })
  check('an unknown problem kind is refused', badKind.status === 422, `${badKind.status}`)
  const rep = await call(reader, 'POST', `/v1/me/assets/${asset.id}/problem`, { kind: 'DAMAGED', note: `Cracked screen ${tag}` })
  check('holder reports a problem', rep.status === 201 && rep.json.status === 'OPEN' && rep.json.kind === 'DAMAGED', `${rep.status} ${rep.json?.errorCode ?? ''}`)
  if (rep.json?.id) created.issueIds.push(rep.json.id)
  const rep2 = await call(reader, 'POST', `/v1/me/assets/${asset.id}/problem`, { kind: 'LOST' })
  check('a second open report is refused', rep2.status === 409 && rep2.json?.errorCode === 'ASSET_ISSUE_ALREADY_OPEN', `${rep2.status}`)
  mine = (await call(reader, 'GET', '/v1/me/assets')).json.find((x) => x.assetId === asset.id)
  check('My assets shows the open report', mine?.openIssue?.kind === 'DAMAGED', JSON.stringify(mine?.openIssue))
  await new Promise((r) => setTimeout(r, 1500)) // notifications are sent after the commit
  const notified = sql(`SELECT count(*) FROM notif.notifications n WHERE n.type = 'ASSET_ISSUE_REPORTED' AND n.data->>'issueId' = '${rep.json?.id}'`)
  check('asset managers were notified (assets.issue_reported)', Number(notified) >= 1, notified)
  const toReader = sql(`SELECT count(*) FROM notif.notifications n JOIN auth.user_credentials uc ON uc.id = n.user_id OR uc.employee_id = n.user_id WHERE n.type = 'ASSET_ISSUE_REPORTED' AND n.data->>'issueId' = '${rep.json?.id}' AND uc.email = 'reader@unifiedtree.demo'`)
  check('…but not the reporter', toReader === '0', toReader)

  const issuesOwner = await call(owner, 'GET', '/v1/onboarding/assets/issues')
  const mineIssue = issuesOwner.json?.find?.((x) => x.id === rep.json?.id)
  check('HR sees the open problem with who reported it', issuesOwner.status === 200 && mineIssue?.employeeName === readerName && mineIssue.note === `Cracked screen ${tag}`, `${issuesOwner.status} ${mineIssue?.employeeName}`)
  check('HR asset list shows the open problem', (await findRow(owner))?.openIssue?.id === rep.json?.id)
  for (const who of [fin, mgr, reader]) {
    const r = await call(who, 'GET', '/v1/onboarding/assets/issues')
    const x = await call(who, 'POST', `/v1/onboarding/assets/issues/${rep.json?.id}/resolve`, { note: 'no' })
    check(`${who.email.split('@')[0]}: cannot list or resolve problems (403)`, r.status === 403 && x.status === 403, `${r.status}/${x.status}`)
  }
  const resolved = await call(hrm, 'POST', `/v1/onboarding/assets/issues/${rep.json?.id}/resolve`, { note: 'Screen replaced' })
  check('HR resolves it', resolved.status === 200 && resolved.json.status === 'RESOLVED' && !!resolved.json.resolvedAt && !!resolved.json.resolvedByName, `${resolved.status} ${resolved.json?.resolvedByName}`)
  const again = await call(owner, 'POST', `/v1/onboarding/assets/issues/${rep.json?.id}/resolve`, {})
  check('resolving twice is refused', again.status === 409 && again.json?.errorCode === 'ASSET_ISSUE_ALREADY_RESOLVED', `${again.status}`)
  check('RESOLVED filter lists it, OPEN no longer does', (await call(owner, 'GET', '/v1/onboarding/assets/issues?status=RESOLVED')).json.some((x) => x.id === rep.json?.id)
    && !(await call(owner, 'GET', '/v1/onboarding/assets/issues')).json.some((x) => x.id === rep.json?.id))
  mine = (await call(reader, 'GET', '/v1/me/assets')).json.find((x) => x.assetId === asset.id)
  check('My assets no longer shows an open report', mine?.openIssue === null, JSON.stringify(mine?.openIssue))

  const back = await call(owner, 'POST', `/v1/onboarding/assets/${asset.id}/return`, { notes: 'good condition' })
  const backRow = await findRow(owner)
  check('returned asset keeps the "Returned" status and names the last holder', back.status === 200 && backRow?.status === 'RETURNED' && backRow.lastHolderName === readerName && backRow.holderName === null, `${backRow?.status} ${backRow?.lastHolderName}`)
  check('…and mgr still gets no name', (await findRow(mgr))?.lastHolderName === null)

  // ── Missing-table steps (slot database only) ─────────────────────────────
  if (!slotDb) {
    console.log(`SKIP  rename-the-table steps: database ${db} is not the slot copy (ut_w3_dev)`)
  } else {
    await withRenamed('hiring_mgmt', 'candidate_stage_events', async () => {
      const f = await call(owner, 'GET', `/v1/hiring/funnel?from=${today}&to=${today}`)
      check('no history table: funnel answers FEATURE_NOT_READY', f.status === 503 && f.json?.errorCode === 'FEATURE_NOT_READY', `${f.status} ${f.json?.errorCode}`)
      const move = await call(owner, 'PUT', `/v1/hiring/candidates/${c.id}/stage`, { stage: 'SCREENING' })
      check('no history table: stage moves still work', move.status === 200 && move.json.stage === 'SCREENING', `${move.status}`)
      const s = await call(owner, 'GET', '/v1/hiring/summary')
      check('no history table: summary still works', s.status === 200, `${s.status}`)
    })
    check('the move made without the table left no row', sql(`SELECT count(*) FROM hiring_mgmt.candidate_stage_events WHERE candidate_id='${c.id}'`) === '1')

    await withRenamed('hiring_mgmt', 'offer_candidate_emails', async () => {
      const o = await call(owner, 'POST', '/v1/hiring/offers', { companyId: company, candidateName: `Farah QA${tag}`, roleTitle: 'Analyst', offeredCtc: 500000, candidateEmail: `farah.qa.${tag}@example.test` })
      created.offers.push(o.json?.id)
      check('no offer email table: offers are still created, email left empty', o.status === 201 && o.json.candidateEmail === null, `${o.status} ${o.json?.candidateEmail}`)
      const l = await call(owner, 'GET', '/v1/hiring/offers')
      check('no offer email table: offers still list', l.status === 200, `${l.status}`)
    })

    const asset2 = await newAsset(2)
    await withRenamed('hrms', 'asset_issue_reports', async () => {
      await call(owner, 'POST', `/v1/onboarding/assets/${asset2.id}/assign`, { employeeId: reader.employeeId })
      const r = await call(reader, 'POST', `/v1/me/assets/${asset2.id}/problem`, { kind: 'LOST' })
      check('no reports table: reporting answers FEATURE_NOT_READY', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status}`)
      const l = await call(owner, 'GET', '/v1/onboarding/assets/issues')
      check('no reports table: HR list answers FEATURE_NOT_READY', l.status === 503 && l.json?.errorCode === 'FEATURE_NOT_READY', `${l.status}`)
      const list = await call(owner, 'GET', '/v1/onboarding/assets')
      check('no reports table: the asset list still works', list.status === 200 && list.json.every((x) => x.openIssue === null), `${list.status}`)
      const me = await call(reader, 'GET', '/v1/me/assets')
      check('no reports table: My assets still works', me.status === 200, `${me.status}`)
    })

    await withRenamed('hrms', 'asset_confirmations', async () => {
      const r = await call(reader, 'POST', `/v1/me/assets/${asset2.id}/confirm`)
      check('no confirmations table: confirming answers FEATURE_NOT_READY', r.status === 503 && r.json?.errorCode === 'FEATURE_NOT_READY', `${r.status}`)
      const me = (await call(reader, 'GET', '/v1/me/assets')).json?.find((x) => x.assetId === asset2.id)
      check('no confirmations table: My assets shows nothing to confirm', me && me.canConfirm === false && me.confirmedAt === null, JSON.stringify(me))
      const row = (await call(owner, 'GET', '/v1/onboarding/assets')).json?.find((x) => x.id === asset2.id)
      check('no confirmations table: HR list leaves confirmation empty', row && row.confirmationPending === null && row.holderName === readerName, JSON.stringify({ p: row?.confirmationPending }))

      // The one-time backfill: re-apply the migration while the table is "missing".
      execFileSync(PSQL, [...psqlArgs, '-q', '-f', migration], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: ['ignore', 'ignore', 'pipe'] })
      const backfilled = sql(`SELECT source FROM hrms.asset_confirmations c JOIN hrms.asset_allocations al ON al.id = c.allocation_id WHERE al.asset_id='${asset2.id}' AND al.returned_at IS NULL`)
      check('backfill: a hand-over open when the table is created counts as confirmed', backfilled === 'BACKFILL', backfilled)
      const returnedOne = sql(`SELECT count(*) FROM hrms.asset_confirmations c JOIN hrms.asset_allocations al ON al.id = c.allocation_id WHERE al.asset_id='${asset.id}'`)
      check('backfill: returned hand-overs are not backfilled', returnedOne === '0', returnedOne)
      sql('DROP TABLE hrms.asset_confirmations')
    })
    // Back on the real table: re-applying the migration must not backfill again.
    execFileSync(PSQL, [...psqlArgs, '-q', '-f', migration], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: ['ignore', 'ignore', 'pipe'] })
    const notAgain = sql(`SELECT count(*) FROM hrms.asset_confirmations c JOIN hrms.asset_allocations al ON al.id = c.allocation_id WHERE al.asset_id='${asset2.id}'`)
    check('the migration is idempotent: re-applying it backfills nothing', notAgain === '0', notAgain)
    const me2 = (await call(reader, 'GET', '/v1/me/assets')).json?.find((x) => x.assetId === asset2.id)
    check('after the migration is back, the new hand-over waits for the holder', me2?.canConfirm === true, JSON.stringify(me2))
  }

  check('no FEATURE_NOT_READY outside the rename steps', notReadyOutsideRename.length === 0, notReadyOutsideRename.join(' | '))
  check('no unexpected 5xx', unexpected5xx.length === 0, unexpected5xx.join(' | '))
} catch (e) {
  check('script completed without an exception', false, String(e?.stack || e).split('\n').slice(0, 3).join(' '))
} finally {
  try {
    for (const [schema, table, tmp] of renamed.reverse()) {
      if (sql(`SELECT to_regclass('${schema}.${tmp}') IS NOT NULL`) === 't') {
        sql(`DROP TABLE IF EXISTS ${schema}.${table}`)
        sql(`ALTER TABLE ${schema}.${tmp} RENAME TO ${table}`)
      }
    }
    const assetIds = created.assets.filter(Boolean).map((x) => `'${x}'`).join(',')
    if (assetIds) {
      sql(`DELETE FROM notif.notifications WHERE type = 'ASSET_ISSUE_REPORTED' AND data->>'assetId' IN (${assetIds})`)
      sql(`DELETE FROM hrms.asset_allocations WHERE asset_id IN (${assetIds}); DELETE FROM hrms.onboarding_assets WHERE id IN (${assetIds})`)
    }
    if (created.employee) {
      const e = `'${created.employee}'`
      sql(`UPDATE hiring_mgmt.candidates SET converted_employee_id=NULL WHERE converted_employee_id=${e}`)
      sql(`DELETE FROM hrms.onboarding_instance_tasks WHERE instance_id IN (SELECT id FROM hrms.onboarding_instances WHERE employee_id=${e}); DELETE FROM hrms.onboarding_instances WHERE employee_id=${e}`)
      sql(`DELETE FROM hrms.employees WHERE id=${e} AND tenant_id='${tenant}'`)
    }
    const offerIds = created.offers.filter(Boolean).map((x) => `'${x}'`).join(',')
    if (offerIds) sql(`DELETE FROM hiring_mgmt.offer_email_attempts WHERE offer_id IN (${offerIds}); DELETE FROM hiring_mgmt.offers WHERE id IN (${offerIds})`)
    if (created.requisition) sql(`DELETE FROM hiring_mgmt.job_requisitions WHERE id='${created.requisition}'`)
    const left = sql(`SELECT (SELECT count(*) FROM hiring_mgmt.job_requisitions WHERE title LIKE '%${tag}%')
                          + (SELECT count(*) FROM hiring_mgmt.offers WHERE candidate_name LIKE '%${tag}%')
                          + (SELECT count(*) FROM hrms.onboarding_assets WHERE asset_tag LIKE 'QA-${tag}-%')
                          + (SELECT count(*) FROM hrms.asset_issue_reports WHERE note LIKE '%${tag}%')
                          + (SELECT count(*) FROM hiring_mgmt.candidates WHERE full_name LIKE '%${tag}%')`)
    check('everything created is removed', left === '0', `left ${left} (since ${startedAt})`)
  } catch (e) { check('cleanup', false, String(e).split('\n')[0]) }
  console.log(`\n${pass}/${pass + fail} checks passed`)
  process.exit(fail ? 1 : 0)
}
