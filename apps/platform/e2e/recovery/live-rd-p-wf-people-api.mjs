/* global process, console, fetch, FormData, Blob */
// P-WF-PEOPLE backend (redesign BW-90–98) against a live backend: API only.
//
//   employee stats and "my record" per role, checked against SQL · drafts (stripped,
//   personal) · Add employee from a draft with onboarding · a direct manager's masked
//   view · direct-reports filter and word search · exit lists · department cost centre
//   and head name · imports through the Add path (2 rows, then 1 with onboarding) ·
//   403s · FEATURE_NOT_READY while a new table is renamed away.
//
// Everything it creates is removed at the end (API where there is a delete, SQL
// otherwise). Run through the live slot (fresh ut_w3_dev with V143_52 applied):
//   live-slot.sh /c/REACT/ut-wt/rd-p-wf-people 3127 node e2e/recovery/live-rd-p-wf-people-api.mjs
// Against another database: RECOVERY_API_URL=… RECOVERY_DB=… node e2e/recovery/live-rd-p-wf-people-api.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ids = {
  owner: '11111111-1111-1111-1111-111111111111',
  reader: '22222222-2222-2222-2222-222222222222',
  hrm: '33333333-3333-3333-3333-333333333333',
  mgr: '44444444-4444-4444-4444-444444444444',
  fin: '55555555-5555-5555-5555-555555555555',
}
const tag = randomUUID().slice(0, 8)

const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`)
}

// Any FEATURE_NOT_READY outside the deliberate rename step is a failure (all migrations are applied here).
let renameStep = false
const unexpected = []
async function call(who, method, path, body, { form } = {}) {
  const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${who.token}` }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await fetch(api + path, { method, headers, body: payload })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (r.status === 503 && json?.errorCode === 'FEATURE_NOT_READY' && !renameStep) unexpected.push(`${method} ${path}`)
  if (r.status >= 500 && r.status !== 503) unexpected.push(`${r.status} ${method} ${path}`)
  return { status: r.status, body: json }
}
async function login(email) {
  const r = await fetch(api + '/v1/canonical-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant },
    body: JSON.stringify({ tenantId: tenant, email, password }),
  })
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`)
  return { email, token: (await r.json()).accessToken }
}
const csvForm = (text, name = 'people.csv') => {
  const f = new FormData()
  f.set('file', new Blob([text], { type: 'text/csv' }), name)
  return f
}

const owner = await login('owner@unifiedtree.demo')
const hrm = await login('hrm@unifiedtree.demo')
const fin = await login('fin@unifiedtree.demo')
const mgr = await login('mgr@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

const made = { employees: [], drafts: [], departments: [] }
const PAY_BANK_IDENTITY = ['ctcAnnual', 'monthlySalary', 'salaryFrequency', 'bankAccountNumber', 'bankIfsc', 'bankBranchName', 'uan', 'esi', 'panNumber', 'aadhaarNumber', 'passportNumber', 'exitReason']
const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null

try {
  // ── Stats (BW-90) per role, and against SQL ────────────────────────────────
  for (const [who, allowed] of [[owner, true], [hrm, true], [fin, true], [mgr, false], [reader, false]]) {
    const r = await call(who, 'GET', `/v1/hrms/employees/stats?companyId=${company}`)
    check(`stats: ${who.email} ${allowed ? '200' : '403'}`, r.status === (allowed ? 200 : 403), r)
    if (allowed && r.status === 200) {
      check(`stats: ${who.email} sees attrition (holds hrms.report.attrition)`, typeof r.body.attritionPercent === 'number', r.body.attritionPercent)
      check(`stats: ${who.email} series has 7 points ending today`, r.body.activeSeries?.length === 7, r.body.activeSeries)
    }
  }
  const noCompany = await call(owner, 'GET', '/v1/hrms/employees/stats')
  check('stats without companyId: every company (200)', noCompany.status === 200, noCompany)
  const stats = (await call(owner, 'GET', `/v1/hrms/employees/stats?companyId=${company}`)).body
  const where = `tenant_id='${tenant}' AND is_active AND company_id='${company}'`
  const bySql = Object.fromEntries(sql(`SELECT employment_status, count(*) FROM hrms.employees WHERE ${where} GROUP BY 1`).split('\n').filter(Boolean).map(l => l.split('|')))
  const n = (k) => Number(bySql[k] || 0)
  const total = Number(sql(`SELECT count(*) FROM hrms.employees WHERE ${where}`))
  check('stats counts match SQL', stats.counts.total === total && stats.counts.active === n('ACTIVE') && stats.counts.probation === n('PROBATION')
    && stats.counts.notice === n('NOTICE_PERIOD') && stats.counts.suspended === n('SUSPENDED') && stats.counts.exited === n('EXITED')
    && stats.counts.terminated === n('TERMINATED'), { api: stats.counts, sql: bySql, total })
  const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
  const joined = Number(sql(`SELECT count(*) FROM hrms.employees WHERE ${where} AND date_of_joining BETWEEN date_trunc('month', ${today})::date AND ${today}`))
  check('stats joinedThisMonth matches SQL', stats.joinedThisMonth === joined, { api: stats.joinedThisMonth, sql: joined })
  const exitedYear = Number(sql(`SELECT count(*) FROM hrms.employees WHERE ${where} AND employment_status IN ('EXITED','TERMINATED')
      AND COALESCE(last_working_day, date_of_termination) BETWEEN date_trunc('year', ${today})::date AND (date_trunc('year', ${today}) + interval '1 year - 1 day')::date`))
  check('stats exitedThisYear matches SQL', stats.exitedThisYear === exitedYear, { api: stats.exitedThisYear, sql: exitedYear })
  const onRollToday = Number(sql(`SELECT count(*) FROM hrms.employees WHERE ${where} AND date_of_joining <= ${today}
      AND NOT (employment_status IN ('EXITED','TERMINATED','RESIGNED') AND COALESCE(last_working_day, date_of_termination, DATE '1900-01-01') <= ${today})`))
  check('stats: today\'s point is the people on the roll (SQL)', stats.activeSeries[6].active === onRollToday, { api: stats.activeSeries[6], sql: onRollToday })
  const counts = await call(owner, 'GET', `/v1/hrms/employees/counts?companyId=${company}`)
  check('old /employees/counts still answers as before', counts.status === 200 && counts.body.total === total && Object.keys(counts.body).sort().join() === 'active,exited,notice,terminated,total', counts.body)

  // ── My record (BW-98) per role ─────────────────────────────────────────────
  for (const [who, id] of [[owner, ids.owner], [hrm, ids.hrm], [fin, ids.fin], [mgr, ids.mgr], [reader, ids.reader]]) {
    const r = await call(who, 'GET', '/v1/hrms/employees/me')
    check(`my record: ${who.email} gets their own`, r.status === 200 && r.body.employeeId === id, r)
    if (r.status === 200) check(`my record: ${who.email} has no pay, bank or identity field`, PAY_BANK_IDENTITY.every(k => !(k in r.body)), Object.keys(r.body))
  }
  const readerMe = (await call(reader, 'GET', '/v1/hrms/employees/me')).body
  const mgrName = sql(`SELECT trim(concat_ws(' ', first_name, last_name)) FROM hrms.employees WHERE id='${ids.mgr}'`)
  check('my record: the reader\'s manager is named', readerMe.managerName === mgrName, { api: readerMe.managerName, sql: mgrName })
  const oldMe = await call(reader, 'GET', '/v1/employees/me')
  check('old /v1/employees/me still answers', oldMe.status === 200 && oldMe.body.id === ids.reader, oldMe.status)

  // ── Exit lists (BW-91) ─────────────────────────────────────────────────────
  for (const [who, allowed] of [[owner, true], [hrm, true], [fin, false], [mgr, false], [reader, false]]) {
    const r = await call(who, 'GET', `/v1/hrms/employees/exits?companyId=${company}&status=EXITED`)
    check(`exits: ${who.email} ${allowed ? '200' : '403'}`, r.status === (allowed ? 200 : 403), r.status)
  }
  const exits = (await call(owner, 'GET', `/v1/hrms/employees/exits?companyId=${company}&status=EXITED&pageSize=200`)).body
  const exitedSql = Number(sql(`SELECT count(*) FROM hrms.employees WHERE ${where} AND employment_status='EXITED'`))
  check('exits: EXITED list matches SQL and carries type, reason, department', exits.totalElements === exitedSql
    && exits.content.every(e => e.employmentStatus === 'EXITED' && 'exitType' in e && 'exitReason' in e && 'departmentName' in e), { api: exits.totalElements, sql: exitedSql })
  check('exits: status=ACTIVE is refused', (await call(owner, 'GET', '/v1/hrms/employees/exits?status=ACTIVE')).status === 422)

  // ── Drafts (BW-92) ─────────────────────────────────────────────────────────
  const draftForm = { firstName: 'Draft QA', lastName: `Person ${tag}`, email: `wfp-draft-${tag}@example.invalid`, phone: '9876543210',
    departmentId: null, dateOfJoining: '2030-01-15', monthlySalary: 45000, salaryFrequency: 'MONTHLY',
    panNumber: 'ABCDE1234F', aadhaarNumber: '123412341234', bankName: 'HDFC Bank', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', uanNumber: '100200300400' }
  const d1 = await call(owner, 'POST', '/v1/hrms/employee-drafts', { companyId: company, payload: draftForm })
  check('drafts: owner saves a draft (201)', d1.status === 201, d1)
  if (d1.status === 201) made.drafts.push(d1.body.id)
  check('drafts: PAN, Aadhaar, UAN and bank details are not kept', d1.status === 201
    && ['panNumber', 'aadhaarNumber', 'bankName', 'bankAccountNumber', 'bankIfsc', 'uanNumber'].every(k => !(k in d1.body.payload))
    && ['panNumber', 'aadhaarNumber', 'bankName', 'bankAccountNumber', 'bankIfsc', 'uanNumber'].every(k => d1.body.strippedFields.includes(k)), d1.body)
  const stored = sql(`SELECT payload::text FROM hrms.employee_drafts WHERE id='${d1.body.id}'`)
  check('drafts: the stored row has none of them either', !/ABCDE1234F|123412341234|123456789012|HDFC0001234|100200300400/.test(stored) && stored.includes('Draft QA'), stored)
  const list = await call(owner, 'GET', `/v1/hrms/employee-drafts?companyId=${company}`)
  check('drafts: listed for their author', list.status === 200 && list.body.some(d => d.id === d1.body.id && d.displayName === `Draft QA Person ${tag}`), list.body)
  check('drafts: another HR user can\'t open it (404)', (await call(hrm, 'GET', `/v1/hrms/employee-drafts/${d1.body.id}`)).status === 404)
  check('drafts: nor list it', (await call(hrm, 'GET', '/v1/hrms/employee-drafts')).body.every(d => d.id !== d1.body.id))
  check('drafts: reader 403', (await call(reader, 'GET', '/v1/hrms/employee-drafts')).status === 403)
  check('drafts: mgr 403', (await call(mgr, 'POST', '/v1/hrms/employee-drafts', { companyId: company, payload: {} })).status === 403)
  const upd = await call(owner, 'PUT', `/v1/hrms/employee-drafts/${d1.body.id}`, { payload: { ...draftForm, phone: '9123456780' } })
  check('drafts: updated, still stripped', upd.status === 200 && upd.body.payload.phone === '9123456780' && !('panNumber' in upd.body.payload), upd)
  check('drafts: a non-object payload is refused (422)', (await call(owner, 'POST', '/v1/hrms/employee-drafts', { companyId: company, payload: [1] })).status === 422)

  // ── Add employee from the draft, with onboarding (BW-94) ───────────────────
  const opened = (await call(owner, 'GET', `/v1/hrms/employee-drafts/${d1.body.id}`)).body
  const dept = sql(`SELECT id FROM hrms.departments WHERE company_id='${company}' AND is_active AND name='Local QA Operations'`)
  const add = await call(owner, 'POST', '/v1/hrms/employees?startOnboarding=true', {
    ...opened.payload, companyId: company, departmentId: dept, reportingManagerId: ids.mgr,
    // re-entered by HR, as the draft never kept them
    panNumber: 'ABCDE1234F', bankName: 'HDFC Bank', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', uanNumber: '100200300400', esiNumber: '1234567890',
    ctcAnnual: 540000,
  })
  check('add: created from the draft (201)', add.status === 201, add)
  const fixture = add.body
  if (add.status === 201) made.employees.push(fixture.id)
  check('add: a future joining date is allowed', fixture?.dateOfJoining === '2030-01-15', fixture?.dateOfJoining)
  check('add: onboarding started and named', fixture?.onboardingStatus === 'STARTED' && fixture?.onboarding?.instanceId && fixture?.onboarding?.templateName, fixture && { s: fixture.onboardingStatus, o: fixture.onboarding })
  check('add: every employee field is still at the top level', fixture?.id && fixture?.employeeCode && fixture?.firstName === 'Draft QA' && !('employee' in (fixture || {})), fixture && Object.keys(fixture))
  if (fixture?.onboarding?.instanceId) {
    check('add: the onboarding run exists for the new person', sql(`SELECT employee_id FROM hrms.onboarding_instances WHERE id='${fixture.onboarding.instanceId}'`) === fixture.id)
  }
  check('add: no salary structure was created', sql(`SELECT count(*) FROM payroll.employee_salary_structures WHERE employee_id='${fixture.id}'`) === '0')
  const plain = await call(owner, 'POST', '/v1/hrms/employees', { companyId: company, firstName: 'Plain QA', lastName: `Person ${tag}`, email: `wfp-plain-${tag}@example.invalid` })
  check('add: without the flag the response is as before (no onboarding keys)', plain.status === 201 && !('onboarding' in plain.body) && !('onboardingStatus' in plain.body), plain.body && Object.keys(plain.body))
  if (plain.status === 201) made.employees.push(plain.body.id)
  check('add: without the flag no onboarding started', sql(`SELECT count(*) FROM hrms.onboarding_instances WHERE employee_id='${plain.body.id}'`) === '0')
  const del = await call(owner, 'DELETE', `/v1/hrms/employee-drafts/${d1.body.id}`)
  check('drafts: deleted after use (204), then gone (404)', del.status === 204 && (await call(owner, 'GET', `/v1/hrms/employee-drafts/${d1.body.id}`)).status === 404)
  if (del.status === 204) made.drafts = made.drafts.filter(x => x !== d1.body.id)

  // ── A direct manager's view (BW-97) ────────────────────────────────────────
  const full = await call(owner, 'GET', `/v1/hrms/employees/${fixture.id}`)
  check('record: owner (hrms.employee.read) still gets the full record', full.status === 200 && full.body.uan === '100200300400' && full.body.bankIfsc === 'HDFC0001234', full.body)
  const masked = await call(mgr, 'GET', `/v1/hrms/employees/${fixture.id}`)
  check('record: mgr opens a direct report (200)', masked.status === 200 && masked.body.id === fixture.id && masked.body.firstName === 'Draft QA', masked)
  check('record: …with pay, bank and identity left out', masked.status === 200 && PAY_BANK_IDENTITY.every(k => !has(masked.body, k)), masked.body)
  check('record: …and none of the values anywhere in the answer', !/540000|45000|ABCDE1234F|123456789012|HDFC0001234|100200300400|1234567890/.test(JSON.stringify(masked.body)))
  const mgrReader = await call(mgr, 'GET', `/v1/hrms/employees/${ids.reader}`)
  check('record: mgr opens the seeded direct report (reader)', mgrReader.status === 200 && PAY_BANK_IDENTITY.every(k => !has(mgrReader.body, k)), mgrReader.status)
  check('record: mgr can\'t open someone who isn\'t their report (403)', (await call(mgr, 'GET', `/v1/hrms/employees/${ids.fin}`)).status === 403)
  check('record: reader can\'t open a colleague (403)', (await call(reader, 'GET', `/v1/hrms/employees/${fixture.id}`)).status === 403)
  check('record: fin (hrms.employee.read) gets the record', (await call(fin, 'GET', `/v1/hrms/employees/${fixture.id}`)).status === 200)
  check('directory: still closed to mgr (403)', (await call(mgr, 'GET', `/v1/hrms/employees?companyId=${company}`)).status === 403)

  // ── Directory: direct reports and word search (BW-96) ─────────────────────
  const reports = await call(owner, 'GET', `/v1/hrms/employees?reportingManagerId=${ids.mgr}&pageSize=200`)
  check('directory: reportingManagerId lists the direct reports only', reports.status === 200
    && reports.body.content.some(e => e.id === fixture.id) && reports.body.content.some(e => e.id === ids.reader)
    && reports.body.content.every(e => e.reportingManagerId === ids.mgr), reports.body.content?.map(e => e.reportingManagerId))
  const words = await call(owner, 'GET', `/v1/hrms/employees?companyId=${company}&search=${encodeURIComponent(`operations ${tag}`)}`)
  check('directory: word search matches the department name and a word of the name', words.status === 200 && words.body.content.some(e => e.id === fixture.id), words.body?.content?.map(e => e.firstName))
  const whole = await call(owner, 'GET', `/v1/hrms/employees?companyId=${company}&search=${encodeURIComponent(`Draft QA Person ${tag}`)}`)
  check('directory: the whole-name search still works', whole.body.content.some(e => e.id === fixture.id))
  const miss = await call(owner, 'GET', `/v1/hrms/employees?companyId=${company}&search=${encodeURIComponent(`finance ${tag}`)}`)
  check('directory: every word must match', miss.body.content.every(e => e.id !== fixture.id))

  // ── Department cost centre and head (BW-95) ────────────────────────────────
  const dep = await call(owner, 'POST', '/v1/hrms/departments', { companyId: company, name: `QA Cost ${tag}`, costCentre: ' CC-QA-1 ', departmentHeadEmployeeId: ids.mgr })
  check('department: created with a cost centre and the head\'s name', dep.status === 201 && dep.body.costCentre === 'CC-QA-1' && dep.body.headName === mgrName, dep.body)
  if (dep.status === 201) made.departments.push(dep.body.id)
  const readerList = await call(reader, 'GET', `/v1/hrms/departments?companyId=${company}`)
  const seen = readerList.body?.find?.(d => d.id === dep.body.id)
  check('department: an employee sees the cost centre and head name in the list', readerList.status === 200 && seen?.costCentre === 'CC-QA-1' && seen?.headName === mgrName, seen)
  const patched = await call(owner, 'PATCH', `/v1/hrms/departments/${dep.body.id}/details?costCentre=CC-QA-2`)
  check('department: cost centre changed', patched.status === 200 && patched.body.costCentre === 'CC-QA-2', patched.body)
  const cleared = await call(owner, 'PATCH', `/v1/hrms/departments/${dep.body.id}/details?costCentre=`)
  check('department: blank clears it', cleared.status === 200 && cleared.body.costCentre === null, cleared.body)
  check('department: reader can\'t change it (403)', (await call(reader, 'PATCH', `/v1/hrms/departments/${dep.body.id}/details?costCentre=X`)).status === 403)

  // ── Import through the Add path (BW-93, BW-94) ─────────────────────────────
  const header = 'first_name,last_name,email,employment_type,date_of_joining,department,designation,reporting_manager,branch,pan,bank_account,ifsc\n'
  const rows = header
    + `Import QA,One ${tag},wfp-imp1-${tag}@example.invalid,FULL_TIME,2026-09-01,local qa operations,QA Specialist,EMP004,QAOFF,ABCDE1234F,123456789012,HDFC0001234\n`
    + `Import QA,Two ${tag},wfp-imp2-${tag}@example.invalid,INTERN,2031-02-01,Local QA Operations,Chief Tea Officer,dept@unifiedtree.demo,Local QA Office,,,\n`
  const bad = header + `Import QA,Bad ${tag},wfp-imp3-${tag}@example.invalid,FULL_TIME,2026-09-01,Nowhere Dept,,,,,,\n`
  const badCheck = await call(owner, 'POST', `/v1/bulk-import/employees/validate?companyId=${company}`, undefined, { form: csvForm(bad) })
  check('import: an unknown department is a problem on its row and column', badCheck.status === 200 && badCheck.body.errors.length === 1
    && badCheck.body.problems[0].row === 2 && badCheck.body.problems[0].column === 'department', badCheck.body)
  const badCommit = await call(owner, 'POST', `/v1/bulk-import/employees/commit?companyId=${company}`, undefined, { form: csvForm(bad) })
  check('import: …and the commit creates nobody', badCommit.status === 200 && badCommit.body.committed === false
    && sql(`SELECT count(*) FROM hrms.employees WHERE email='wfp-imp3-${tag}@example.invalid'`) === '0', badCommit.body)
  const okCheck = await call(owner, 'POST', `/v1/bulk-import/employees/validate?companyId=${company}`, undefined, { form: csvForm(rows) })
  check('import: 2 rows check clean (one warning: designation kept as job title)', okCheck.status === 200 && okCheck.body.errors.length === 0
    && okCheck.body.warnings.length === 1 && okCheck.body.warnings[0].column === 'designation', okCheck.body)
  const commit = await call(owner, 'POST', `/v1/bulk-import/employees/commit?companyId=${company}`, undefined, { form: csvForm(rows) })
  check('import: 2 rows committed', commit.status === 200 && commit.body.committed === true && commit.body.successCount === 2 && commit.body.created.length === 2, commit.body)
  for (const c of commit.body?.created || []) made.employees.push(c.employeeId)
  check('import: onboarding is off unless asked', (commit.body?.created || []).every(c => c.onboarding === null && c.onboardingStatus === null)
    && (commit.body?.created || []).every(c => sql(`SELECT count(*) FROM hrms.onboarding_instances WHERE employee_id='${c.employeeId}'`) === '0'))
  const [one, two] = await Promise.all((commit.body?.created || []).map(c => call(owner, 'GET', `/v1/hrms/employees/${c.employeeId}`).then(r => r.body)))
  check('import: status stays ACTIVE with no probation end', one?.employmentStatus === 'ACTIVE' && two?.employmentStatus === 'ACTIVE' && !one?.probationEndDate && !two?.probationEndDate, [one?.employmentStatus, two?.employmentStatus])
  check('import: department mapped by name (no longer dropped)', one?.departmentId === dept && two?.departmentId === dept, [one?.departmentId, two?.departmentId, dept])
  const specialist = sql(`SELECT id FROM hrms.designations WHERE company_id='${company}' AND title='QA Specialist'`)
  const branchId = sql(`SELECT id FROM org.branches WHERE company_id='${company}' AND code='QAOFF'`)
  check('import: designation, branch (code or name) and manager (code or email) mapped', one?.designationId === specialist && one?.branchId === branchId
    && two?.branchId === branchId && one?.reportingManagerId === ids.mgr && two?.reportingManagerId === ids.mgr, { one, two })
  check('import: the unmatched designation is the job title, and no designation was created',
    sql(`SELECT job_title FROM hrms.employees WHERE id='${two?.id}'`) === 'Chief Tea Officer'
    && sql(`SELECT count(*) FROM hrms.designations WHERE title='Chief Tea Officer'`) === '0' && two?.designationId === null)
  check('import: codes come from the company format', /^[A-Z]+-\d+$/.test(one?.employeeCode || ''), one?.employeeCode)
  check('import: a future joining date is allowed', two?.dateOfJoining === '2031-02-01', two?.dateOfJoining)
  const withOnb = await call(owner, 'POST', `/v1/bulk-import/employees/commit?companyId=${company}&startOnboarding=true`, undefined,
    { form: csvForm('first_name,last_name,email\n' + `Import QA,Three ${tag},wfp-imp4-${tag}@example.invalid\n`) })
  for (const c of withOnb.body?.created || []) made.employees.push(c.employeeId)
  check('import: with startOnboarding the checklist starts after the import', withOnb.status === 200 && withOnb.body.created?.[0]?.onboardingStatus === 'STARTED'
    && withOnb.body.created[0].onboarding?.instanceId, withOnb.body)
  check('import: reader 403', (await call(reader, 'POST', `/v1/bulk-import/employees/validate?companyId=${company}`, undefined, { form: csvForm(rows) })).status === 403)
  check('import: fin 403 (no hrms.employee.import)', (await call(fin, 'POST', `/v1/bulk-import/employees/commit?companyId=${company}`, undefined, { form: csvForm(rows) })).status === 403)
  const cols = await call(owner, 'GET', '/v1/bulk-import/employees/columns')
  check('import: the columns endpoint lists the new columns', cols.status === 200 && cols.body.optional.includes('reporting_manager') && cols.body.required.includes('email'), cols.body)
  const tmpl = await fetch(api + '/v1/bulk-import/employees/template?format=csv', { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${owner.token}` } })
  check('import: CSV template', tmpl.status === 200 && (await tmpl.text()).startsWith('first_name,last_name,email'), tmpl.status)

  // ── FEATURE_NOT_READY while the new tables are away ────────────────────────
  renameStep = true
  try {
    sql('ALTER TABLE hrms.employee_drafts RENAME TO employee_drafts_wfp_off')
    const off = await call(owner, 'GET', '/v1/hrms/employee-drafts')
    check('rename: drafts answer 503 FEATURE_NOT_READY', off.status === 503 && off.body.errorCode === 'FEATURE_NOT_READY', off)
    const offSave = await call(owner, 'POST', '/v1/hrms/employee-drafts', { companyId: company, payload: { firstName: 'x' } })
    check('rename: saving a draft answers 503 FEATURE_NOT_READY', offSave.status === 503 && offSave.body.errorCode === 'FEATURE_NOT_READY', offSave)
    sql('ALTER TABLE hrms.department_cost_centres RENAME TO department_cost_centres_wfp_off')
    const deps = await call(owner, 'GET', `/v1/hrms/departments?companyId=${company}`)
    check('rename: department list still 200, cost centre empty', deps.status === 200 && deps.body.every(d => d.costCentre === null), deps.status)
    const offCc = await call(owner, 'PATCH', `/v1/hrms/departments/${dep.body.id}/details?costCentre=CC-X`)
    check('rename: setting a cost centre answers 503 FEATURE_NOT_READY', offCc.status === 503 && offCc.body.errorCode === 'FEATURE_NOT_READY', offCc)
    const offDept = await call(owner, 'POST', '/v1/hrms/departments', { companyId: company, name: `QA Off ${tag}`, costCentre: 'CC-OFF' })
    check('rename: a new department with a cost centre is refused before anything is saved', offDept.status === 503
      && sql(`SELECT count(*) FROM hrms.departments WHERE name='QA Off ${tag}'`) === '0', offDept)
    const statsStill = await call(owner, 'GET', `/v1/hrms/employees/stats?companyId=${company}`)
    check('rename: stats and my record don\'t depend on the new tables', statsStill.status === 200 && (await call(reader, 'GET', '/v1/hrms/employees/me')).status === 200)
  } finally {
    try { sql('ALTER TABLE IF EXISTS hrms.employee_drafts_wfp_off RENAME TO employee_drafts') } catch (e) { console.log('rename back (drafts) failed', String(e).split('\n')[0]) }
    try { sql('ALTER TABLE IF EXISTS hrms.department_cost_centres_wfp_off RENAME TO department_cost_centres') } catch (e) { console.log('rename back (cost centres) failed', String(e).split('\n')[0]) }
    renameStep = false
  }
  check('rename: back again, drafts answer 200', (await call(owner, 'GET', '/v1/hrms/employee-drafts')).status === 200)
} catch (e) {
  check('run finished', false, e.stack || String(e))
} finally {
  // ── Clean up everything ────────────────────────────────────────────────────
  try {
    for (const id of made.drafts) await call(owner, 'DELETE', `/v1/hrms/employee-drafts/${id}`)
    const emp = made.employees.filter(Boolean).map(id => `'${id}'`).join(',')
    if (emp) {
      sql(`BEGIN;
        DELETE FROM hrms.onboarding_instance_tasks WHERE instance_id IN (SELECT id FROM hrms.onboarding_instances WHERE employee_id IN (${emp}));
        DELETE FROM hrms.onboarding_instances WHERE employee_id IN (${emp});
        DELETE FROM hrms.employees WHERE id IN (${emp}) AND tenant_id='${tenant}';
        COMMIT;`)
    }
    const deps = made.departments.map(id => `'${id}'`).join(',')
    if (deps) sql(`DELETE FROM hrms.departments WHERE id IN (${deps}) AND tenant_id='${tenant}'`)
    sql(`DELETE FROM hrms.employee_drafts WHERE tenant_id='${tenant}' AND payload->>'email' LIKE 'wfp-%${tag}@example.invalid'`)
    const left = sql(`SELECT (SELECT count(*) FROM hrms.employees WHERE email LIKE 'wfp-%${tag}@example.invalid')
      + (SELECT count(*) FROM hrms.departments WHERE name LIKE 'QA % ${tag}')
      + (SELECT count(*) FROM hrms.employee_drafts WHERE payload::text LIKE '%${tag}%')
      + (SELECT count(*) FROM hrms.department_cost_centres WHERE cost_centre LIKE 'CC-QA-%' AND department_id NOT IN (SELECT id FROM hrms.departments))`)
    check('cleanup: nothing left behind', left === '0', left)
  } catch (e) {
    check('cleanup', false, String(e).split('\n')[0])
  }
  check('no unexpected FEATURE_NOT_READY or 5xx', unexpected.length === 0, unexpected)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
