// Live check for feat/company-access: a person gets a role per company
// (docs/redesign/COMPANY_ACCESS.md). API only — the web selector and the app picker
// are built on top of this by other branches.
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-company-access.mjs
//
// With a second company B (temporary) next to the demo company A:
//  - Before any grant: mgr@ (Dept Manager) and reader@ (Employee) see only A in
//    /v1/me/companies and /v1/hrms/companies; naming B (X-Company-Id, ?companyId=,
//    /companies/{B}) is 403 COMPANY_ACCESS_DENIED. owner@ sees A and B. No header =
//    exactly as before; a malformed header is 400.
//  - B gets an employee with the same code as one in A (EMP001), reporting to mgr@.
//  - owner@ grants mgr@ Employee in B: mgr@ sees both companies; in B his /me roles are
//    [EMPLOYEE] and the team dashboard is 403; in A he is still a Dept Manager.
//  - owner@ makes it Manager in B: mgr@ reads B's team (B's EMP001, not A's people) and
//    B's departments; reader@ still cannot read B. The grant shows in the admin views.
//  - The rules: no grant for the home company, no whole-business role per company,
//    mgr@ cannot grant; rows are invisible from another workspace (RLS, read-only SQL).
//  - Revoke: B is gone from mgr@'s companies and 403 again. Every change is audited.
//  - Bodies (feat/company-access-2): a companyId in a request body must be a company the
//    caller may access AND the one the request runs in (header / parameter, else home):
//    403 COMPANY_ACCESS_DENIED before the endpoint's own permission check. owner@ unchanged.
//  - Lists whose companyId is optional: without one, mgr@ gets his current company (the
//    header's, else home) instead of every company; owner@ without a header: every company
//    as before, with a header: that company.
//  - Records addressed by id (feat/company-access-3): a record in a company the caller can't
//    access is 404 (as an unknown id); in a company they can access but are not working in,
//    403 COMPANY_ACCESS_DENIED; their own team's records always. owner@ unchanged.
//  - HR-level views: reader@ granted HR Manager in B sees only B's requests in the HR queue,
//    the decided list (and its counts), the calendar and the stats; owner@ keeps the workspace.
//  - Alerts: an HR Manager by grant in B is told about B's people (a probation decision).
// Everything created (company, employee, grants, audit rows) is removed at the end.
/* global process, console, fetch, setTimeout */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const companyA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
// As the application's own database role, so row-level security applies (read-only).
const appSql = (tenantId, q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'ut_app', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'],
  { input: `BEGIN; SET LOCAL app.tenant_id = '${tenantId}'; ${q}; COMMIT;`, env: { ...process.env, PGPASSWORD: process.env.UT_APP_PASSWORD || 'local_recovery_only' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
const tempName = `zz QA Access Co ${tag}` // sorts after every real company
let companyB = null, empB = null, empB2 = null, mgrUser = null, readerUser = null
const start = sql('select now()')
let where = 'start'
const at = (name) => { where = name; console.log(`..  ${name}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, { body, company } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
    if (company) headers['X-Company-Id'] = company
    const res = await fetch(api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.userId = d.userId
  call.employeeId = d.employeeId
  return call
}
const ids = (list) => (Array.isArray(list) ? list : []).map((c) => c.id || c.companyId)
const errorCode = (r) => (r.json && typeof r.json === 'object' ? r.json.errorCode : '')

try {
  at('sign in')
  const owner = await login('owner@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  mgrUser = mgr.userId
  readerUser = reader.userId
  check('fixtures: mgr@ and reader@ work in the demo company', !!mgr.userId && !!mgr.employeeId && !!reader.userId)

  // ── before company B exists ──
  at('baseline')
  const me0 = await mgr('GET', '/v1/me/companies')
  check('mgr@ /v1/me/companies: one company, the home one, as Dept Manager', me0.status === 200 && me0.json.homeCompanyId === companyA
    && me0.json.allCompanies === false && me0.json.companies.length === 1 && me0.json.companies[0].access === 'HOME'
    && me0.json.companies[0].roles.some((r) => r.code === 'DEPT_MANAGER' && r.source === 'ROLES'), JSON.stringify(me0.json).slice(0, 300))
  const meNoHeader = await mgr('GET', '/v1/canonical-auth/me')
  check('no header: /me is as before (DEPT_MANAGER)', meNoHeader.status === 200 && JSON.stringify(meNoHeader.json.roles) === '["DEPT_MANAGER"]')

  at('create company B')
  const made = await owner('POST', '/v1/hrms/companies', { body: { name: tempName, industry: 'Quality checks', country: 'India', currency: 'INR' } })
  companyB = made.json && made.json.id
  check('owner@ creates company B', made.status === 201 && !!companyB, `status ${made.status}`)
  if (!companyB) throw new Error('no company B')

  at('who sees B')
  const ownerMe = await owner('GET', '/v1/me/companies')
  check('owner@ /v1/me/companies: every company (workspace-wide), A first as home', ownerMe.status === 200 && ownerMe.json.allCompanies === true
    && ids(ownerMe.json.companies).includes(companyB) && ownerMe.json.companies[0].companyId === companyA
    && ownerMe.json.companies.every((c) => c.access === 'WORKSPACE'))
  check('owner@ /v1/hrms/companies lists B', ids((await owner('GET', '/v1/hrms/companies')).json).includes(companyB))
  const mgrList = await mgr('GET', '/v1/hrms/companies')
  check('mgr@ /v1/hrms/companies lists only A', mgrList.status === 200 && JSON.stringify(ids(mgrList.json)) === JSON.stringify([companyA]), JSON.stringify(ids(mgrList.json)))
  const readerList = await reader('GET', '/v1/hrms/companies')
  check('reader@ /v1/hrms/companies lists only A', readerList.status === 200 && JSON.stringify(ids(readerList.json)) === JSON.stringify([companyA]))
  const appList = await reader('GET', '/v1/tenant/companies')
  check('reader@ app list /v1/tenant/companies lists only A', appList.status === 200 && !JSON.stringify(appList.json).includes(companyB), `status ${appList.status}`)

  at('refusals before a grant')
  let r = await mgr('GET', '/v1/hrms/departments', { company: companyB })
  check('mgr@ X-Company-Id: B → 403 COMPANY_ACCESS_DENIED', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', `/v1/hrms/departments?companyId=${companyB}`)
  check('mgr@ ?companyId=B (no header, old app) → 403', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status}`)
  r = await reader('GET', `/v1/hrms/companies/${companyB}`)
  check('reader@ /companies/{B} → 403', r.status === 403, `status ${r.status}`)
  r = await reader('GET', `/v1/hrms/departments?companyId=${companyA}`)
  check('reader@ ?companyId=A (home) → 200 as before', r.status === 200, `status ${r.status}`)
  r = await mgr('GET', `/v1/hrms/departments?companyId=${companyA}`, { company: companyA })
  check('mgr@ X-Company-Id: A (home) → 200', r.status === 200, `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', '/v1/hrms/departments', { company: 'not-a-company' })
  check('malformed X-Company-Id → 400 INVALID_COMPANY_ID', r.status === 400 && errorCode(r) === 'INVALID_COMPANY_ID', `status ${r.status}`)
  r = await mgr('GET', '/v1/me/companies', { company: companyB })
  check('/v1/me/companies ignores a company the caller cannot use (recovery)', r.status === 200 && r.json.companies.length === 1)
  r = await owner('GET', `/v1/hrms/departments?companyId=${companyB}`, { company: companyB })
  check('owner@ X-Company-Id: B → 200', r.status === 200, `status ${r.status}`)
  r = await owner('GET', '/v1/hrms/departments', { company: '00000000-0000-0000-0000-00000000abcd' })
  check('owner@ X-Company-Id: a company not in the workspace → 403', r.status === 403, `status ${r.status}`)

  at('bodies and optional lists before a grant')
  const branch = await owner('POST', '/v1/hrms/branches', { body: { companyId: companyB, name: `QA Branch ${tag}` } })
  const branchB = branch.json && branch.json.id
  check('owner@ creates a branch in B (body companyId B, workspace-wide: unchanged)', branch.status === 201 && !!branchB, `status ${branch.status} ${errorCode(branch)}`)
  r = await mgr('POST', '/v1/hrms/branches', { body: { companyId: companyB, name: 'nope' } })
  check('mgr@ body companyId B → 403 COMPANY_ACCESS_DENIED', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/hrms/branches', { body: { companyId: companyA, name: 'nope' } })
  check('mgr@ body companyId A (home) passes the company check (then his permission refuses)', r.status === 403 && errorCode(r) !== 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/expense/claims', { body: { companyId: companyB, title: '' } })
  check('mgr@ expense claim with companyId B → 403 COMPANY_ACCESS_DENIED', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/expense/claims', { body: { companyId: companyA, title: '' } })
  check('mgr@ expense claim with companyId A → reaches validation (400)', r.status === 400, `status ${r.status} ${errorCode(r)}`)
  r = await reader('POST', '/v1/expense/claims', { body: { companyId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', title: '' } })
  check('reader@ body with a company of no workspace → 403', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status}`)
  const branchCos = (list) => [...new Set((Array.isArray(list) ? list : []).map((b) => b.companyId))].sort()
  r = await mgr('GET', '/v1/hrms/branches')
  check("mgr@ /branches without companyId: his home company's branches only (was every company)", r.status === 200 && JSON.stringify(branchCos(r.json)) === JSON.stringify([companyA]), JSON.stringify(branchCos(r.json)))
  r = await owner('GET', '/v1/hrms/branches')
  check('owner@ /branches without companyId or header: every company, as before', r.status === 200 && branchCos(r.json).includes(companyA) && branchCos(r.json).includes(companyB), JSON.stringify(branchCos(r.json)))
  r = await owner('GET', '/v1/hrms/branches', { company: companyB })
  check("owner@ /branches with X-Company-Id: B → B's branches only", r.status === 200 && JSON.stringify(branchCos(r.json)) === JSON.stringify([companyB]), JSON.stringify(branchCos(r.json)))
  r = await mgr('GET', '/v1/hiring/summary')
  check('mgr@ hiring summary without companyId covers his home company', r.status === 200 && r.json.companyId === companyA, `status ${r.status} ${r.json && r.json.companyId}`)
  r = await owner('GET', '/v1/hiring/summary')
  check('owner@ hiring summary without companyId or header: every company (null), as before', r.status === 200 && r.json.companyId === null, `status ${r.status} ${r.json && r.json.companyId}`)
  r = await owner('GET', '/v1/hiring/summary', { company: companyB })
  check('owner@ hiring summary with X-Company-Id: B covers B', r.status === 200 && r.json.companyId === companyB, `status ${r.status}`)

  at('employee in B')
  const readerCode = sql(`select employee_code from hrms.employees where id='${reader.employeeId}'`)
  const emp = await owner('POST', '/v1/hrms/employees', { body: { companyId: companyB, employeeCode: readerCode, firstName: 'QA', lastName: `Access ${tag}`, reportingManagerId: mgr.employeeId } })
  empB = emp.json && (emp.json.id || (emp.json.employee && emp.json.employee.id))
  check(`company B gets an employee with A's code ${readerCode}, reporting to mgr@`, (emp.status === 201 || emp.status === 200) && !!empB, `status ${emp.status} ${JSON.stringify(emp.json).slice(0, 200)}`)
  check('the code exists once in each company', sql(`select count(distinct company_id) from hrms.employees where employee_code=${lit(readerCode)} and company_id in ('${companyA}','${companyB}')`) === '2')

  // ── records addressed by id (feat/company-access-3) ──
  at('records by id before a grant')
  const emp2 = await owner('POST', '/v1/hrms/employees', { body: { companyId: companyB, employeeCode: `QA3${tag}`, firstName: 'QA', lastName: `Other ${tag}` } })
  empB2 = emp2.json && (emp2.json.id || (emp2.json.employee && emp2.json.employee.id))
  check('company B gets a second employee, reporting to nobody', (emp2.status === 201 || emp2.status === 200) && !!empB2, `status ${emp2.status}`)
  const agency = await owner('POST', '/v1/hrms/contractors', { body: { companyId: companyB, agencyName: `QA Agency ${tag}` } })
  const agencyB = agency.json && agency.json.id
  check('owner@ creates a contractor agency in B', (agency.status === 201 || agency.status === 200) && !!agencyB, `status ${agency.status} ${errorCode(agency)}`)
  const agencyA = sql(`select id from hrms.contractors where company_id='${companyA}' limit 1`)
  r = await mgr('GET', `/v1/hrms/contractors/${agencyB}/workers`)
  check("mgr@ (no access to B) opens B's agency by id → 404, as an unknown id", r.status === 404 && errorCode(r) === 'RESOURCE_NOT_FOUND', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', '/v1/hrms/contractors/00000000-0000-0000-0000-00000000abcd/workers')
  check('…the same answer as an id that does not exist', r.status === 404, `status ${r.status} ${errorCode(r)}`)
  if (agencyA) {
    r = await mgr('GET', `/v1/hrms/contractors/${agencyA}/workers`)
    check("mgr@ opens his home company's agency → 200 as before", r.status === 200, `status ${r.status} ${errorCode(r)}`)
  }
  r = await owner('GET', `/v1/hrms/contractors/${agencyB}/workers`)
  check("owner@ opens B's agency → 200 (workspace-wide: unchanged)", r.status === 200, `status ${r.status}`)
  r = await mgr('GET', `/v1/hrms/employees/${empB2}`)
  check("mgr@ opens a B employee by id → 404 (was 403 'not your team')", r.status === 404 && errorCode(r) === 'RESOURCE_NOT_FOUND', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', `/v1/hrms/employees/${empB}`)
  check('mgr@ still opens his own direct report in B → 200', r.status === 200 && r.json.id === empB, `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', `/v1/expense/employees/${empB2}/claims`)
  check("reader@ asks for a B employee's claims → 404", r.status === 404, `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', `/v1/expense/employees/${reader.employeeId}/claims`)
  check('reader@ reads his own claims → 200 as before', r.status === 200, `status ${r.status} ${errorCode(r)}`)

  // ── grant: Employee in B ──
  at('grant Employee in B')
  r = await owner('POST', `/v1/workspace/users/${mgrUser}/company-access`, { body: { companyId: companyB, roleCode: 'EMPLOYEE' } })
  const entryB = r.json && r.json.companies && r.json.companies.find((c) => c.companyId === companyB)
  check('owner@ grants mgr@ Employee in B', r.status === 200 && entryB && entryB.access === 'GRANT' && entryB.roles.some((x) => x.code === 'EMPLOYEE' && x.source === 'GRANT'), `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  const me1 = await mgr('GET', '/v1/me/companies')
  check('mgr@ now sees both companies, home first', me1.status === 200 && JSON.stringify(ids(me1.json.companies)) === JSON.stringify([companyA, companyB]))
  check('mgr@ /v1/hrms/companies lists A and B', JSON.stringify(ids((await mgr('GET', '/v1/hrms/companies')).json).sort()) === JSON.stringify([companyA, companyB].sort()))
  const meB = await mgr('GET', '/v1/canonical-auth/me', { company: companyB })
  check('in B, /me says Employee (no team permission)', meB.status === 200 && JSON.stringify(meB.json.roles) === '["EMPLOYEE"]'
    && !meB.json.permissions.includes('attendance.team.read') && meB.json.permissions.includes('leave.request.self'), JSON.stringify(meB.json.roles))
  r = await mgr('GET', '/v1/attendance/dashboard?includeWeeklyOff=true', { company: companyB })
  check('in B as Employee: team dashboard is 403', r.status === 403, `status ${r.status}`)
  r = await mgr('GET', '/v1/attendance/dashboard?includeWeeklyOff=true', { company: companyA })
  const teamA = (r.json && r.json.staffStatuses || []).map((s) => s.employeeId)
  check('in A he is still a Dept Manager: team = A people only', r.status === 200 && teamA.includes(reader.employeeId) && !teamA.includes(empB), `status ${r.status} team ${teamA.length}`)
  r = await mgr('GET', '/v1/attendance/dashboard?includeWeeklyOff=true')
  const teamNoHeader = (r.json && r.json.staffStatuses || []).map((s) => s.employeeId)
  check('no header: his team is as before (every direct report)', r.status === 200 && teamNoHeader.includes(reader.employeeId) && teamNoHeader.includes(empB), `team ${teamNoHeader.length}`)

  // ── Manager in B ──
  at('Manager in B')
  r = await owner('POST', `/v1/workspace/users/${mgrUser}/company-access`, { body: { companyId: companyB, roleCode: 'DEPT_MANAGER' } })
  check('owner@ grants mgr@ Dept Manager in B', r.status === 200, `status ${r.status} ${errorCode(r)}`)
  r = await owner('DELETE', `/v1/workspace/users/${mgrUser}/company-access/${companyB}?roleCode=EMPLOYEE`)
  const rolesB = (r.json && r.json.companies || []).find((c) => c.companyId === companyB)
  check('owner@ removes the Employee role in B only', r.status === 200 && rolesB && JSON.stringify(rolesB.roles.map((x) => x.code)) === '["DEPT_MANAGER"]', JSON.stringify(rolesB))
  r = await mgr('GET', '/v1/attendance/dashboard?includeWeeklyOff=true', { company: companyB })
  const teamB = (r.json && r.json.staffStatuses || [])
  check("mgr@ reads B's team: B's employee, none of A's people", r.status === 200 && teamB.some((s) => s.employeeId === empB && s.employeeCode === readerCode)
    && !teamB.some((s) => s.employeeId === reader.employeeId), `status ${r.status} ${JSON.stringify(teamB.map((s) => s.employeeCode))}`)
  r = await mgr('GET', `/v1/hrms/departments?companyId=${companyB}`, { company: companyB })
  check("mgr@ reads B's departments", r.status === 200, `status ${r.status}`)
  r = await mgr('GET', `/v1/hrms/companies/${companyB}`, { company: companyB })
  check("mgr@ reads company B's profile", r.status === 200 && r.json.id === companyB, `status ${r.status}`)
  r = await mgr('GET', `/v1/hrms/contractors/${agencyB}/workers`)
  check("with access to B but working in A (no header): B's agency → 403 COMPANY_ACCESS_DENIED (switch first)", r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', `/v1/hrms/contractors/${agencyB}/workers`, { company: companyB })
  check("working in B: B's agency → 200", r.status === 200, `status ${r.status} ${errorCode(r)}`)
  if (agencyA) {
    r = await mgr('GET', `/v1/hrms/contractors/${agencyA}/workers`, { company: companyB })
    check("working in B: his home company's agency → 403 COMPANY_ACCESS_DENIED", r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  }
  r = await mgr('GET', `/v1/hrms/employees/${empB2}`, { company: companyB })
  check("working in B: a B employee outside his team passes the company check (then 'not your team')", r.status === 403 && errorCode(r) !== 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', `/v1/hrms/employees/${reader.employeeId}`, { company: companyB })
  check('working in B: his own direct report in A still opens', r.status === 200, `status ${r.status} ${errorCode(r)}`)
  r = await mgr('GET', '/v1/hrms/branches', { company: companyB })
  check("mgr@ /branches with X-Company-Id: B → B's branches only", r.status === 200 && JSON.stringify(branchCos(r.json)) === JSON.stringify([companyB]), JSON.stringify(branchCos(r.json)))
  r = await mgr('GET', '/v1/hiring/summary', { company: companyB })
  check('mgr@ hiring summary with X-Company-Id: B covers B', r.status === 200 && r.json.companyId === companyB, `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/hrms/branches', { body: { companyId: companyB, name: 'nope' } })
  check('mgr@ body companyId B without the header → 403 (it would run with his home roles)', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/hrms/branches', { body: { companyId: companyB, name: 'nope' }, company: companyB })
  check('mgr@ body companyId B with X-Company-Id: B passes the company check (then his permission there refuses)', r.status === 403 && errorCode(r) !== 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/hrms/branches', { body: { companyId: companyA, name: 'nope' }, company: companyB })
  check('mgr@ body companyId A while working in B → 403 COMPANY_ACCESS_DENIED', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', '/v1/expense/claims', { body: { companyId: companyB, title: '' }, company: companyB })
  check('mgr@ expense claim companyId B with X-Company-Id: B → reaches validation (400)', r.status === 400, `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', '/v1/hrms/departments', { company: companyB })
  check('reader@ still cannot read B', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status}`)
  r = await reader('GET', `/v1/attendance/dashboard?companyId=${companyB}`)
  check("reader@ cannot reach B's team through a parameter either", r.status === 403, `status ${r.status}`)

  // ── HR-level views for a company-scoped level-two approver (feat/company-access-3) ──
  at('HR-level views')
  r = await owner('POST', `/v1/workspace/users/${readerUser}/company-access`, { body: { companyId: companyB, roleCode: 'HR_MANAGER' } })
  check('owner@ grants reader@ HR Manager in B', r.status === 200, `status ${r.status} ${errorCode(r)}`)
  const aDecided = Number(sql(`select count(*) from leave_mgmt.leave_requests lr join hrms.employees e on e.id=lr.employee_id where lr.tenant_id='${tenant}' and e.company_id='${companyA}' and lr.status <> 'PENDING'`))
  r = await reader('GET', '/v1/leave/approvals/history?size=50', { company: companyB })
  const histB = (r.json && r.json.content) || []
  check("reader@ in B: the decided list holds none of A's requests", r.status === 200 && !histB.some((x) => x.employeeId === reader.employeeId || x.employeeId === mgr.employeeId)
    && r.json.totalElements === Number(sql(`select count(*) from leave_mgmt.leave_requests lr join hrms.employees e on e.id=lr.employee_id where e.company_id='${companyB}' and lr.status <> 'PENDING'`)), `status ${r.status} total ${r.json && r.json.totalElements}`)
  check("…and its counts are B's (A has " + aDecided + ' decided)', r.status === 200 && r.json.counts && Object.values(r.json.counts).reduce((a, b) => a + b, 0) === r.json.totalElements, JSON.stringify(r.json && r.json.counts))
  r = await owner('GET', '/v1/leave/approvals/history?size=50', { company: companyB })
  check("owner@ with X-Company-Id: B still sees the workspace's decided list (unchanged)", r.status === 200 && r.json.totalElements >= aDecided, `status ${r.status} total ${r.json && r.json.totalElements} A ${aDecided}`)
  r = await reader('GET', '/v1/leave/approvals/pending-l2', { company: companyB })
  check("reader@ in B: HR's queue → 200, B's people only", r.status === 200 && (r.json.content || []).every((x) => x.employeeId === empB || x.employeeId === empB2), `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', '/v1/leave/approvals/pending-l2')
  check("reader@ in A (home, Employee there): HR's queue → 403", r.status === 403, `status ${r.status}`)
  r = await reader('GET', '/v1/wfh/pending-approvals', { company: companyB })
  check("reader@ in B: the WFH queue → 200, B's people only", r.status === 200 && (r.json.content || []).every((x) => x.employeeId === empB || x.employeeId === empB2), `status ${r.status} ${errorCode(r)}`)
  const month = new Date().toISOString().slice(0, 7)
  r = await reader('GET', `/v1/leave/calendar?from=${month}-01&to=${month}-28&statuses=APPROVED,PENDING,PENDING_L2`, { company: companyB })
  check("reader@ in B: the leave calendar → B's people only", r.status === 200 && r.json.scope === 'TENANT' && (r.json.entries || []).every((x) => x.employeeId === empB || x.employeeId === empB2), `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', '/v1/leave/approvals/stats', { company: companyB })
  check('reader@ in B: the approval stats → 200', r.status === 200 && r.json.scope === 'TENANT', `status ${r.status} ${errorCode(r)}`)
  r = await reader('GET', '/v1/team/approvals?kind=all&includeL2=true', { company: companyB })
  check("reader@ in B: the approvals inbox → 200, B's people only", r.status === 200 && (r.json.rows || []).every((x) => x.employeeId === empB || x.employeeId === empB2), `status ${r.status} ${errorCode(r)}`)

  at('alerts')
  sql(`update hrms.employees set employment_status='PROBATION', probation_end_date=current_date + 10 where id='${empB}' and company_id='${companyB}'`)
  const alertsFrom = sql('select now()')
  const until = sql("select to_char(current_date + 40, 'YYYY-MM-DD')")
  r = await owner('POST', `/v1/team/probation/${empB}/extend`, { body: { newEndDate: until, note: 'QA company access' }, company: companyB })
  check("owner@ extends B's employee's probation", r.status === 200, `status ${r.status} ${errorCode(r)} ${JSON.stringify(r.json).slice(0, 200)}`)
  let told = '0'
  for (let i = 0; i < 10 && told === '0'; i++) {
    told = sql(`select count(*) from notif.notifications where user_id='${readerUser}' and created_at >= '${alertsFrom}' and data->>'employeeId' = '${empB}'`)
    if (told === '0') await new Promise((res) => setTimeout(res, 500))
  }
  check('reader@, HR Manager of B by grant, is told about it', told !== '0', `notifications ${told}`)
  r = await owner('DELETE', `/v1/workspace/users/${readerUser}/company-access/${companyB}`)
  check("owner@ takes reader@'s access to B away again", r.status === 200, `status ${r.status}`)

  at('admin views')
  r = await owner('GET', `/v1/workspace/company-access?companyId=${companyB}`)
  check('workspace grant list for B: mgr@ as Dept Manager', r.status === 200 && Array.isArray(r.json) && r.json.length === 1
    && r.json[0].userId === mgrUser && r.json[0].roleCode === 'DEPT_MANAGER' && r.json[0].homeCompanyId === companyA, JSON.stringify(r.json).slice(0, 300))
  r = await owner('GET', `/v1/workspace/users/${mgrUser}/company-access`)
  check("mgr@'s access view: A (home) and B (grant)", r.status === 200 && r.json.companies.length === 2 && r.json.companies[1].access === 'GRANT')
  r = await mgr('GET', `/v1/workspace/users/${mgrUser}/company-access`)
  check('mgr@ cannot open the admin view (403)', r.status === 403, `status ${r.status}`)

  at('rules')
  r = await owner('POST', `/v1/workspace/users/${mgrUser}/company-access`, { body: { companyId: companyA, roleCode: 'EMPLOYEE' } })
  check('no grant for the home company (422 HOME_COMPANY)', r.status === 422 && errorCode(r) === 'HOME_COMPANY', `status ${r.status} ${errorCode(r)}`)
  r = await owner('POST', `/v1/workspace/users/${mgrUser}/company-access`, { body: { companyId: companyB, roleCode: 'ADMIN' } })
  check('no whole-business role per company (422 ROLE_IS_WORKSPACE_WIDE)', r.status === 422 && errorCode(r) === 'ROLE_IS_WORKSPACE_WIDE', `status ${r.status} ${errorCode(r)}`)
  r = await mgr('POST', `/v1/workspace/users/${reader.userId}/company-access`, { body: { companyId: companyB, roleCode: 'EMPLOYEE' } })
  check('mgr@ cannot grant (403)', r.status === 403, `status ${r.status}`)
  r = await owner('POST', `/v1/workspace/users/${owner.userId}/company-access`, { body: { companyId: companyB, roleCode: 'EMPLOYEE' } })
  check('nobody changes their own access (403 CANNOT_EDIT_OWN_ACCESS)', r.status === 403 && errorCode(r) === 'CANNOT_EDIT_OWN_ACCESS', `status ${r.status} ${errorCode(r)}`)

  at('workspace isolation')
  check('RLS: the grant is visible inside the workspace', appSql(tenant, `SELECT count(*) FROM rbac.user_company_access WHERE company_id='${companyB}'`) === '1')
  check('RLS: …and invisible from another workspace', appSql('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', `SELECT count(*) FROM rbac.user_company_access WHERE company_id='${companyB}'`) === '0')

  // ── revoke ──
  at('revoke')
  r = await owner('DELETE', `/v1/workspace/users/${mgrUser}/company-access/${companyB}`)
  check('owner@ takes away all of mgr@’s access to B', r.status === 200 && !ids(r.json.companies).includes(companyB))
  const me2 = await mgr('GET', '/v1/me/companies')
  check('B is gone from mgr@’s companies', me2.status === 200 && JSON.stringify(ids(me2.json.companies)) === JSON.stringify([companyA]))
  r = await mgr('GET', '/v1/attendance/dashboard', { company: companyB })
  check('and B is 403 again', r.status === 403 && errorCode(r) === 'COMPANY_ACCESS_DENIED', `status ${r.status}`)
  r = await owner('DELETE', `/v1/workspace/users/${mgrUser}/company-access/${companyB}`)
  check('revoking again is a harmless no-op', r.status === 200)
  const audits = sql(`select count(*) from audit.events where entity_id='${mgrUser}' and occurred_at >= '${start}' and summary like ${lit('%' + tempName + '%')}`)
  check('audit: 2 grants + 2 removals recorded', audits === '4', audits)
} catch (e) {
  check('test ran to the end', false, `at "${where}": ${String(e && e.message || e).split('\n').slice(0, 8).join(' | ')}`)
} finally {
  // Remove only what this test made: its grants and audit rows, the employee in B, company B.
  try {
    if (companyB) sql(`delete from rbac.user_company_access where company_id='${companyB}'`)
    if (mgrUser) sql(`delete from audit.events where entity_id='${mgrUser}' and occurred_at >= '${start}' and summary like ${lit('%' + tempName + '%')}`)
    if (readerUser) sql(`delete from audit.events where entity_id='${readerUser}' and occurred_at >= '${start}' and summary like ${lit('%' + tempName + '%')}`)
    for (const e of [empB, empB2].filter(Boolean)) sql(`delete from notif.notifications where created_at >= '${start}' and data->>'employeeId' = '${e}'`)
    const mine = companyB && sql(`select count(*) from org.companies where id='${companyB}' and name=${lit(tempName)} and tenant_id='${tenant}'`) === '1'
    if (mine) {
      const cols = (col) => sql(`select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='${col}' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')`).split('\n').filter(Boolean)
      const emps = [empB, empB2].filter(Boolean)
      const empTables = emps.length ? cols('employee_id') : []
      const coTables = cols('company_id').filter((t) => t !== 'org.companies')
      // A few passes: rows that point at other rows go first.
      for (let pass = 0; pass < 4; pass++) {
        for (const e of emps) {
          for (const t of empTables) { try { sql(`delete from ${t} where employee_id='${e}'`) } catch { /* later pass */ } }
          try { sql(`delete from audit.events where entity_id='${e}'`); sql(`delete from hrms.employees where id='${e}' and company_id='${companyB}'`) } catch { /* later pass */ }
        }
        for (const t of coTables) { try { sql(`delete from ${t} where company_id='${companyB}'`) } catch { /* later pass */ } }
      }
      sql(`delete from audit.events where entity_id='${companyB}'`)
      const gone = sql(`with d as (delete from org.companies where id='${companyB}' and name=${lit(tempName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
      check('cleanup: company B, its employees and the grants removed', gone === '1'
        && emps.every((e) => sql(`select count(*) from hrms.employees where id='${e}'`) === '0'))
    }
  } catch (err) {
    check('cleanup: company B, its employee and the grants removed', false, String(err).split('\n')[0])
  }
  const failedCount = results.filter((x) => !x.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
