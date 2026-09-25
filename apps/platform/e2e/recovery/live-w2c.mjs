// Live API check of the Master data organisation work (V143_22, docs/Designs/STATIC-UI-TO-BUILD.md §6):
//  - Grade pay bands: stored, validated, hidden from people without hrms.grade.band.read.
//  - Designations: grade linked by id (old free-text grades link when a matching grade appears), codes unique.
//  - Pay bands per employee for the Salary Structure warning (permission-gated).
//  - Contractor agencies: licence, service, sites; edit, end, reactivate; contract workers linked.
//  - Departments: move under another (no loops), branches on create and later.
//  - Companies: TAN, date of incorporation, description.
//  - Branches: branch types; deactivated branches with includeArchived.
//  - Classification rules: update.
// Every refused role gets a 403. Everything created is removed at the end and the company is put back.
// No browser: API + database only.
//
//   node e2e/recovery/live-w2c.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8097/api), RECOVERY_DB (default unifiedtree_recovery)
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const refused = (r) => r.status >= 400 && r.status < 500 && r.status !== 403 && r.status !== 404

const tag = randomUUID().slice(0, 6).toUpperCase()
const made = { grades: [], desigs: [], contractors: [], employees: [], depts: [], branches: [], classes: [] }
let companyBefore = null

try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── Grades & pay bands ──────────────────────────────────────────────────
  const g1 = await owner('/v1/hrms/grades', 'POST', { companyId: company, code: `QW${tag}`, name: `QA band ${tag}`, level: 90, active: true, minCtcAnnual: 600000, maxCtcAnnual: 1200000 })
  if (g1.json?.id) made.grades.push(g1.json.id)
  check('grade: owner creates a grade with a pay band', g1.status === 201 && g1.json?.bandVisible === true, `status=${g1.status}`)
  check('grade: the band is stored', sql(`select min_ctc_annual::int||'-'||max_ctc_annual::int from org.grades where id='${g1.json?.id}'`) === '600000-1200000')
  const bad = await owner('/v1/hrms/grades', 'POST', { companyId: company, code: `QB${tag}`, name: 'QA bad band', level: 91, active: true, minCtcAnnual: 900000, maxCtcAnnual: 500000 })
  if (bad.json?.id) made.grades.push(bad.json.id)
  check('grade: a band whose maximum is below its minimum is refused', refused(bad) && sql(`select count(*) from org.grades where code='QB${tag}'`) === '0', `status=${bad.status}`)
  const asReader = await reader(`/v1/hrms/grades?companyId=${company}`)
  const seen = (asReader.json || []).find((g) => g.id === g1.json?.id)
  check('grade: an employee sees the grade but not its band', asReader.status === 200 && seen && seen.minCtcAnnual == null && seen.maxCtcAnnual == null && seen.bandVisible === false, JSON.stringify(seen || null).slice(0, 120))
  const asFin = await fin(`/v1/hrms/grades?companyId=${company}`)
  const finSeen = (asFin.json || []).find((g) => g.id === g1.json?.id)
  check('grade: the finance lead sees the band', finSeen && Number(finSeen.minCtcAnnual) === 600000)
  const hrmPut = await hrm(`/v1/hrms/grades/${g1.json?.id}`, 'PUT', { companyId: company, code: `QW${tag}`, name: `QA band ${tag}`, level: 90, active: true, minCtcAnnual: 700000, maxCtcAnnual: 1300000 })
  check('grade: HR changes the band', hrmPut.status === 200 && sql(`select min_ctc_annual::int from org.grades where id='${g1.json?.id}'`) === '700000', `status=${hrmPut.status}`)
  const mgrGrade = await mgr('/v1/hrms/grades', 'POST', { companyId: company, code: `QM${tag}`, name: 'QA mgr grade', level: 92, active: true })
  if (mgrGrade.json?.id) made.grades.push(mgrGrade.json.id)
  check('grade: a department manager cannot create grades (403)', mgrGrade.status === 403, `status=${mgrGrade.status}`)

  // ── Designations: grade by id, codes, legacy text ─────────────────────────
  const legacy = await owner('/v1/hrms/designations', 'POST', { companyId: company, title: `QA legacy title ${tag}`, grade: `QX${tag}`.slice(0, 20) })
  if (legacy.json?.id) made.desigs.push(legacy.json.id)
  check('designation: free text that matches no grade is kept as text', legacy.status === 201 && legacy.json?.gradeId == null && legacy.json?.grade === `QX${tag}`, `status=${legacy.status}`)
  const g2 = await owner('/v1/hrms/grades', 'POST', { companyId: company, code: `QX${tag}`, name: `QA later ${tag}`, level: 93, active: true })
  if (g2.json?.id) made.grades.push(g2.json.id)
  check('designation: a new grade with that code links the old title by id', g2.status === 201 && sql(`select grade_id from hrms.designations where id='${legacy.json?.id}'`) === g2.json?.id)
  const d1 = await owner('/v1/hrms/designations', 'POST', { companyId: company, title: `QA linked title ${tag}`, gradeId: g1.json?.id, code: `d${tag}` })
  if (d1.json?.id) made.desigs.push(d1.json.id)
  check('designation: created with a grade id and a code', d1.status === 201 && d1.json?.grade === `QW${tag}` && sql(`select grade_id||'|'||code from hrms.designations where id='${d1.json?.id}'`) === `${g1.json?.id}|D${tag}`, `status=${d1.status}`)
  const dup = await owner('/v1/hrms/designations', 'POST', { companyId: company, title: `QA dup code ${tag}`, code: `D${tag}` })
  if (dup.json?.id) made.desigs.push(dup.json.id)
  check('designation: a code already in use is refused', refused(dup), `status=${dup.status}`)
  const d1put = await owner(`/v1/hrms/designations/${d1.json?.id}`, 'PUT', { title: `QA linked title ${tag}`, gradeId: g2.json?.id, code: `D${tag}` })
  check('designation: moving to another grade by id', d1put.status === 200 && sql(`select grade_id||'|'||grade from hrms.designations where id='${d1.json?.id}'`) === `${g2.json?.id}|QX${tag}`, `status=${d1put.status}`)
  await owner(`/v1/hrms/designations/${d1.json?.id}`, 'PUT', { title: `QA linked title ${tag}`, gradeId: g1.json?.id, code: `D${tag}` })
  const mgrDes = await mgr('/v1/hrms/designations', 'POST', { companyId: company, title: `QA mgr title ${tag}` })
  if (mgrDes.json?.id) made.desigs.push(mgrDes.json.id)
  check('designation: a department manager cannot create titles (403)', mgrDes.status === 403, `status=${mgrDes.status}`)

  // ── A contract worker on that designation ───────────────────────────────
  const emp = await owner('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'QA', lastName: `Contract ${tag}`, email: `qa.w2c.${tag.toLowerCase()}@unifiedtree.demo`, employmentType: 'CONTRACT', designationId: d1.json?.id, roleCode: 'EMPLOYEE' })
  const empId = emp.json?.id
  if (empId) made.employees.push(empId)
  check('fixture: a contract worker on the linked designation', emp.status === 201 && !!empId, `status=${emp.status}`)

  // ── Pay bands per employee (Salary Structure warning) ────────────────────
  const pbFin = await fin(`/v1/hrms/pay-bands?employeeIds=${empId}`)
  const band = (pbFin.json || []).find((b) => b.employeeId === empId)
  check('pay band: the finance lead gets the band of the person\'s grade', pbFin.status === 200 && band && Number(band.minCtcAnnual) === 700000 && Number(band.maxCtcAnnual) === 1300000 && band.gradeCode === `QW${tag}`, JSON.stringify(band || pbFin.json).slice(0, 120))
  const pbReader = await reader(`/v1/hrms/pay-bands?employeeIds=${empId}`)
  check('pay band: an employee is refused (403)', pbReader.status === 403, `status=${pbReader.status}`)
  const pbMgr = await mgr(`/v1/hrms/pay-bands?employeeIds=${empId}`)
  check('pay band: a department manager is refused (403)', pbMgr.status === 403, `status=${pbMgr.status}`)

  // ── Branches: types, include archived ───────────────────────────────────
  const br = await owner('/v1/hrms/branches', 'POST', { companyId: company, name: `QA Warehouse ${tag}`, code: `QW${tag}`, city: 'Chennai', state: 'Tamil Nadu', branchType: 'WAREHOUSE' })
  const brId = br.json?.id
  if (brId) made.branches.push(brId)
  check('branch: created as a warehouse', br.status === 201 && br.json?.branchType === 'WAREHOUSE' && sql(`select branch_type||'|'||is_headquarters from org.branches where id='${brId}'`) === 'WAREHOUSE|f', `status=${br.status}`)
  const brPut = await owner(`/v1/hrms/branches/${brId}`, 'PUT', { branchType: 'PLANT' })
  check('branch: type changed to plant', brPut.status === 200 && sql(`select branch_type from org.branches where id='${brId}'`) === 'PLANT', `status=${brPut.status}`)
  const brBad = await owner(`/v1/hrms/branches/${brId}`, 'PUT', { branchType: 'CASTLE' })
  check('branch: an unknown type is refused', refused(brBad), `status=${brBad.status}`)
  const mgrBr = await mgr('/v1/hrms/branches', 'POST', { companyId: company, name: `QA mgr branch ${tag}`, branchType: 'STORE' })
  if (mgrBr.json?.id) made.branches.push(mgrBr.json.id)
  check('branch: a department manager cannot create branches (403)', mgrBr.status === 403, `status=${mgrBr.status}`)

  // ── Contractor agencies ─────────────────────────────────────────────────
  const ag = await owner('/v1/hrms/contractors', 'POST', { companyId: company, agencyName: `QA Agency ${tag}`, registrationNumber: `REG-${tag}`, gstin: '29AACCU1234F1Z5', contactPersonName: 'QA Contact', licenceNumber: `CLRA/${tag}`, licenceValidUntil: '2027-03-31', serviceType: 'Security & front desk', siteBranchIds: [brId] })
  const agId = ag.json?.id
  if (agId) made.contractors.push(agId)
  check('agency: created with licence, service and a site', ag.status === 201 && sql(`select licence_number||'|'||licence_valid_until||'|'||service_type from hrms.contractors where id='${agId}'`) === `CLRA/${tag}|2027-03-31|Security & front desk`
    && sql(`select count(*) from hrms.contractor_sites where contractor_id='${agId}' and branch_id='${brId}'`) === '1', `status=${ag.status}`)
  const agPut = await owner(`/v1/hrms/contractors/${agId}`, 'PUT', { serviceType: 'Housekeeping', licenceValidUntil: '2028-03-31' })
  check('agency: edit is partial (GSTIN not on the form survives)', agPut.status === 200 && sql(`select service_type||'|'||licence_valid_until||'|'||gstin from hrms.contractors where id='${agId}'`) === 'Housekeeping|2028-03-31|29AACCU1234F1Z5', `status=${agPut.status}`)
  const hrmAg = await hrm(`/v1/hrms/contractors/${agId}`, 'PUT', { serviceType: 'HR edit' })
  check('agency: HR (read-only on agencies) cannot edit (403)', hrmAg.status === 403, `status=${hrmAg.status}`)
  if (empId) {
    const link = await owner(`/v1/hrms/contractors/${agId}/workers/${empId}`, 'PUT')
    check('agency: a contract worker is linked', link.status === 200 && sql(`select contractor_id from hrms.contractor_workers where employee_id='${empId}'`) === agId, `status=${link.status}`)
    const list = await owner(`/v1/hrms/contractors?companyId=${company}`)
    const row = (list.json || []).find((a) => a.id === agId)
    const employed = sql(`select count(*) from hrms.employees where id='${empId}' and is_active and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD')`) === '1'
    check('agency: the worker count comes from the links', row && (row.workerIds || []).includes(empId) && row.activeWorkersCount === (employed ? 1 : 0) && (row.siteBranchIds || []).includes(brId), JSON.stringify(row || null).slice(0, 160))
    const mgrWorkers = await mgr(`/v1/hrms/contractors/${agId}/workers`)
    check('agency: a manager with agency read access sees the workers', mgrWorkers.status === 200 && (mgrWorkers.json || []).some((w) => w.employeeId === empId), `status=${mgrWorkers.status}`)
    const readerLink = await reader(`/v1/hrms/contractors/${agId}/workers/${empId}`, 'DELETE')
    check('agency: an employee cannot change links (403)', readerLink.status === 403 && sql(`select count(*) from hrms.contractor_workers where employee_id='${empId}'`) === '1', `status=${readerLink.status}`)
  }
  const perm = sql(`select id from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_type <> 'CONTRACT' and is_active order by created_at limit 1`)
  if (perm) {
    const nope = await owner(`/v1/hrms/contractors/${agId}/workers/${perm}`, 'PUT')
    check('agency: only contract workers can be linked', refused(nope) && sql(`select count(*) from hrms.contractor_workers where employee_id='${perm}'`) === '0', `status=${nope.status}`)
  }
  const end = await owner(`/v1/hrms/contractors/${agId}`, 'DELETE')
  const activeList = await owner(`/v1/hrms/contractors?companyId=${company}`)
  const allList = await owner(`/v1/hrms/contractors?companyId=${company}&includeArchived=true`)
  check('agency: ending the contract keeps it, listed with archived ones', end.status === 204 && sql(`select is_active from hrms.contractors where id='${agId}'`) === 'f'
    && !(activeList.json || []).some((a) => a.id === agId) && (allList.json || []).some((a) => a.id === agId && a.active === false), `status=${end.status}`)
  if (empId) {
    const endedLink = await owner(`/v1/hrms/contractors/${agId}/workers/${empId}`, 'PUT')
    check('agency: an ended agency takes no new links', refused(endedLink), `status=${endedLink.status}`)
  }
  const hrmRestore = await hrm(`/v1/hrms/contractors/${agId}/restore`, 'POST')
  check('agency: HR cannot reactivate (403)', hrmRestore.status === 403, `status=${hrmRestore.status}`)
  const restore = await owner(`/v1/hrms/contractors/${agId}/restore`, 'POST')
  check('agency: reactivated', restore.status === 200 && sql(`select is_active from hrms.contractors where id='${agId}'`) === 't', `status=${restore.status}`)
  if (empId) {
    const unlink = await owner(`/v1/hrms/contractors/${agId}/workers/${empId}`, 'DELETE')
    check('agency: worker unlinked', unlink.status === 204 && sql(`select count(*) from hrms.contractor_workers where employee_id='${empId}'`) === '0', `status=${unlink.status}`)
  }

  // ── Departments: parent moves, branches ─────────────────────────────────
  const pa = await owner('/v1/hrms/departments', 'POST', { companyId: company, name: `QA W2C Parent ${tag}`, code: `QP${tag}`, branchIds: [brId] })
  if (pa.json?.id) made.depts.push(pa.json.id)
  check('department: branchIds on create are stored', pa.status === 201 && sql(`select count(*) from hrms.department_branches where department_id='${pa.json?.id}' and branch_id='${brId}'`) === '1' && (pa.json?.branchIds || []).includes(brId), `status=${pa.status}`)
  const ch = await owner('/v1/hrms/departments', 'POST', { companyId: company, name: `QA W2C Child ${tag}`, code: `QC${tag}` })
  if (ch.json?.id) made.depts.push(ch.json.id)
  const mv = await owner(`/v1/hrms/departments/${ch.json?.id}/parent?parentId=${pa.json?.id}`, 'PATCH')
  check('department: moved under another department', mv.status === 200 && sql(`select parent_department_id from hrms.departments where id='${ch.json?.id}'`) === pa.json?.id, `status=${mv.status}`)
  const loop = await owner(`/v1/hrms/departments/${pa.json?.id}/parent?parentId=${ch.json?.id}`, 'PATCH')
  check('department: cannot move under its own sub-team', refused(loop) && sql(`select coalesce(parent_department_id::text,'none') from hrms.departments where id='${pa.json?.id}'`) === 'none', `status=${loop.status}`)
  const self = await owner(`/v1/hrms/departments/${pa.json?.id}/parent?parentId=${pa.json?.id}`, 'PATCH')
  check('department: cannot be its own parent', refused(self), `status=${self.status}`)
  const top = await owner(`/v1/hrms/departments/${ch.json?.id}/parent`, 'PATCH')
  check('department: moved back to the top level', top.status === 200 && sql(`select coalesce(parent_department_id::text,'none') from hrms.departments where id='${ch.json?.id}'`) === 'none', `status=${top.status}`)
  const clr = await owner(`/v1/hrms/departments/${pa.json?.id}/branches`, 'PUT', { branchIds: [] })
  check('department: branches replaced (cleared)', clr.status === 200 && sql(`select count(*) from hrms.department_branches where department_id='${pa.json?.id}'`) === '0', `status=${clr.status}`)
  const mgrMove = await mgr(`/v1/hrms/departments/${ch.json?.id}/parent?parentId=${pa.json?.id}`, 'PATCH')
  check('department: a department manager cannot move departments (403)', mgrMove.status === 403, `status=${mgrMove.status}`)

  // ── Companies: TAN, incorporation, description ──────────────────────────
  companyBefore = sql(`select coalesce(tan_number,'')||'|'||coalesce(incorporation_date::text,'')||'|'||coalesce(description,'') from org.companies where id='${company}'`)
  const coName = sql(`select name from org.companies where id='${company}'`)
  const co = await owner(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, tanNumber: 'blru01234e', incorporationDate: '2019-07-01', description: `QA description ${tag}` })
  check('company: TAN, incorporation date and description saved', co.status === 200 && co.json?.tanNumber === 'BLRU01234E'
    && sql(`select tan_number||'|'||incorporation_date||'|'||description from org.companies where id='${company}'`) === `BLRU01234E|2019-07-01|QA description ${tag}`, `status=${co.status}`)
  const coBad = await owner(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, tanNumber: 'NOT-A-TAN' })
  check('company: a malformed TAN is refused', refused(coBad) && sql(`select tan_number from org.companies where id='${company}'`) === 'BLRU01234E', `status=${coBad.status}`)
  const coFuture = await owner(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, incorporationDate: '2999-01-01' })
  check('company: a future incorporation date is refused', refused(coFuture), `status=${coFuture.status}`)
  const coMgr = await mgr(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, tanNumber: 'MGRX01234E' })
  check('company: a department manager cannot edit the company (403)', coMgr.status === 403, `status=${coMgr.status}`)

  // ── Classification rules: update ────────────────────────────────────────
  const cl = await owner('/v1/hrms/classifications', 'POST', { companyId: company, name: `QA class ${tag}`, code: `QC${tag}`, description: 'Before' })
  if (cl.json?.id) made.classes.push(cl.json.id)
  const clPut = await owner(`/v1/hrms/classifications/${cl.json?.id}`, 'PUT', { name: `QA class renamed ${tag}`, description: 'After' })
  check('classification: updated', clPut.status === 200 && sql(`select name||'|'||description||'|'||code from hrms.classification_rules where id='${cl.json?.id}'`) === `QA class renamed ${tag}|After|QC${tag}`, `status=${clPut.status}`)
  const clReader = await reader(`/v1/hrms/classifications/${cl.json?.id}`, 'PUT', { name: 'Reader edit' })
  check('classification: an employee cannot update (403)', clReader.status === 403, `status=${clReader.status}`)
  const clMgr = await mgr(`/v1/hrms/classifications/${cl.json?.id}`, 'PUT', { name: 'Manager edit' })
  check('classification: a department manager cannot update (403)', clMgr.status === 403 && sql(`select name from hrms.classification_rules where id='${cl.json?.id}'`) === `QA class renamed ${tag}`, `status=${clMgr.status}`)
  const brArch = await owner(`/v1/hrms/branches/${brId}`, 'PUT', { isActive: false })
  const brActive = await owner(`/v1/hrms/branches?companyId=${company}`)
  const brAll = await owner(`/v1/hrms/branches?companyId=${company}&includeArchived=true`)
  check('branch: a deactivated branch shows only with includeArchived', brArch.status === 200 && !(brActive.json || []).some((b) => b.id === brId) && (brAll.json || []).some((b) => b.id === brId && b.active === false), `status=${brArch.status}`)
} catch (e) {
  check('run finished without an exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  const clean = (label, q) => { try { sql(q) } catch (e) { console.log(`cleanup (${label}) failed:`, String(e).split('\n')[0]) } }
  const inList = (ids) => ids.map((x) => `'${x}'`).join(',')
  if (made.employees.length) clean('worker links', `DELETE FROM hrms.contractor_workers WHERE employee_id IN (${inList(made.employees)})`)
  if (made.contractors.length) clean('agencies', `DELETE FROM hrms.contractors WHERE id IN (${inList(made.contractors)})`)
  if (made.employees.length) clean('employees', `DELETE FROM hrms.employees WHERE id IN (${inList(made.employees)}) AND tenant_id='${tenant}'`)
  if (made.depts.length) clean('departments', `UPDATE hrms.departments SET parent_department_id = NULL WHERE id IN (${inList(made.depts)}); DELETE FROM hrms.departments WHERE id IN (${inList(made.depts)})`)
  if (made.desigs.length) clean('designations', `DELETE FROM hrms.designations WHERE id IN (${inList(made.desigs)})`)
  if (made.grades.length) clean('grades', `DELETE FROM org.grades WHERE id IN (${inList(made.grades)})`)
  if (made.branches.length) clean('branches', `DELETE FROM org.branches WHERE id IN (${inList(made.branches)})`)
  if (made.classes.length) clean('classifications', `DELETE FROM hrms.classification_rules WHERE id IN (${inList(made.classes)})`)
  if (companyBefore != null) {
    const [tan, inc, desc] = companyBefore.split('|')
    clean('company', `UPDATE org.companies SET tan_number=${tan ? lit(tan) : 'NULL'}, incorporation_date=${inc ? lit(inc) : 'NULL'}, description=${desc ? lit(desc) : 'NULL'} WHERE id='${company}'`)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
