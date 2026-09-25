// Live API check of the w2i batch (no browser):
//  - Letters hub: each view's endpoint answers for the roles that see the view
//    and refuses the rest; a letter generated for an employee shows in their
//    My letters.
//  - Attendance day rules shared with the alternate JDBC service: today with no
//    punch is NOT_MARKED, and someone without their own weekly offs gets their
//    company's (HR Configuration), not a fixed Saturday + Sunday.
//  - Dashboard: top performers carry their department; the activity feed names
//    the record an event changed.
//  - Documents: row-level security is forced on the document tables (V143_28).
// Everything it creates or changes is removed or put back.
//
//   node e2e/recovery/live-w2i.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8097/api), RECOVERY_DB, RECOVERY_PASSWORD
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}
// India business date (never UTC).
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const isoDow = (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d }
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

const stamp = Date.now()
const cleanup = []
try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── Letters hub: one endpoint per view ──
  for (const [label, who] of [['owner', owner], ['HR', hrm]]) {
    const [t, g, d, m] = await Promise.all(['/v1/letters/templates?page=0&size=20', '/v1/letters/generated?page=0&size=20', '/v1/letters/distributions?page=0&size=20', '/v1/letters/my?page=0&size=20'].map((p) => who.call(p)))
    check(`letters: ${label} loads Templates, Generated letters, Distributions and My letters`, [t, g, d, m].every((r) => r.status === 200), [t, g, d, m].map((r) => r.status).join('/'))
  }
  const finDist = await fin.call('/v1/letters/distributions?page=0&size=20')
  check('letters: finance lead (letters.read) lists distributions', finDist.status === 200, `status=${finDist.status}`)
  const finCreate = await fin.call('/v1/letters/distributions', 'POST', { templateId: '00000000-0000-0000-0000-000000000000', title: 'x', recipientFilter: { type: 'ALL_EMPLOYEES' } })
  check('letters: finance lead cannot start a distribution (403)', finCreate.status === 403, `status=${finCreate.status}`)
  check('letters: employee holds only read.self (the hub shows just My letters)', reader.perms.includes('hrms.letters.read.self') && !['hrms.letters.read', 'hrms.letters.template.read', 'hrms.letters.distribute'].some((p) => reader.perms.includes(p)))
  const refused = await Promise.all(['/v1/letters/templates', '/v1/letters/generated', '/v1/letters/distributions'].map((p) => reader.call(p)))
  check('letters: employee is refused Templates, Generated letters and Distributions (403)', refused.every((r) => r.status === 403), refused.map((r) => r.status).join('/'))
  const mgrTemplates = await mgr.call('/v1/letters/templates')
  check('letters: department manager is refused templates (403)', mgrTemplates.status === 403, `status=${mgrTemplates.status}`)

  const tplName = `QA w2i hub template ${stamp}`
  const tpl = await owner.call('/v1/letters/templates', 'POST', { companyId: company, name: tplName, type: 'CUSTOM', subject: 'QA hub letter', bodyHtml: '<p>Dear {{employee.fullName}},</p><p>QA hub check.</p>' })
  check('letters: owner creates a template', tpl.status === 201 && !!tpl.json?.id, `status=${tpl.status}`)
  if (tpl.json?.id) cleanup.push(() => { sql(`delete from letters.generated where template_id='${tpl.json.id}'`); sql(`delete from letters.templates where id='${tpl.json.id}'`) })
  if (tpl.json?.id) {
    const gen = await owner.call('/v1/letters/generate', 'POST', { templateId: tpl.json.id, employeeId: READER, sendImmediately: false })
    check('letters: owner generates a letter for the employee', gen.status === 201 && !!gen.json?.id, `status=${gen.status}`)
    if (gen.json?.id) {
      check('letters: the letter is stored for the employee', sql(`select employee_id from letters.generated where id='${gen.json.id}'`) === READER)
      const mine = await reader.call('/v1/letters/my?page=0&size=50')
      check('letters: the employee sees it in My letters', mine.status === 200 && (mine.json?.content || []).some((l) => l.id === gen.json.id), `status=${mine.status}`)
      const open = await reader.call(`/v1/letters/generated/${gen.json.id}`)
      check('letters: the employee opens their own letter', open.status === 200, `status=${open.status}`)
      const del = await owner.call(`/v1/letters/generated/${gen.json.id}`, 'DELETE')
      check('letters: owner deletes the test letter', del.status === 204 && sql(`select count(*) from letters.generated where id='${gen.json.id}'`) === '0', `status=${del.status}`)
    }
    const delTpl = await owner.call(`/v1/letters/templates/${tpl.json.id}`, 'DELETE')
    check('letters: owner deletes the test template', delTpl.status === 204 || delTpl.status === 200, `status=${delTpl.status}`)
  }

  // ── Attendance day rules ──
  const today = istToday()
  const week = await reader.call('/v1/attendance/weekly-summary')
  const todayRow = (week.json?.days || []).find((d) => d.date === today)
  const punchedToday = sql(`select count(*) from attendance.records where employee_id='${READER}' and attendance_date='${today}' and check_in_at is not null`) !== '0'
  if (!todayRow) check('attendance: weekly summary lists today', false, `status=${week.status}`)
  else if (punchedToday || ['WEEKEND', 'HOLIDAY', 'ON_LEAVE'].includes(todayRow.status)) check('attendance: today is not called absent', todayRow.status !== 'ABSENT', `today is ${todayRow.status}`)
  else check('attendance: today with no punch is NOT_MARKED, not ABSENT', todayRow.status === 'NOT_MARKED', `today is ${todayRow.status}`)
  const month = await reader.call(`/v1/attendance/history?year=${today.slice(0, 4)}&month=${Number(today.slice(5, 7))}`)
  check('attendance: history never lists today as ABSENT', month.status === 200 && !(month.json || []).some((d) => d.date === today && d.status === 'ABSENT'), `status=${month.status}`)

  // Company weekly offs apply to someone without their own: make the company Fri+Sat for a moment.
  const ownOff = sql(`select coalesce(weekly_off_days,'<null>') from hrms.employees where id='${READER}'`)
  const companyOff = sql(`select coalesce(array_to_string(weekend_days, ','),'<null>') from settings.hr_configuration where company_id='${company}' and tenant_id='${tenant}'`)
  cleanup.push(() => {
    sql(`update hrms.employees set weekly_off_days=${ownOff === '<null>' ? 'null' : `'${ownOff}'`} where id='${READER}'`)
    if (companyOff) sql(`update settings.hr_configuration set weekend_days=${companyOff === '<null>' ? 'null' : `'{${companyOff}}'::int[]`} where company_id='${company}' and tenant_id='${tenant}'`)
  })
  if (companyOff) {
    sql(`update hrms.employees set weekly_off_days=null where id='${READER}'`)
    sql(`update settings.hr_configuration set weekend_days='{5,6}'::int[] where company_id='${company}' and tenant_id='${tenant}'`)
    const monday = addDays(today, -(isoDow(today) - 1) - 14)
    const past = await reader.call(`/v1/attendance/weekly-summary?weekStart=${monday}`)
    const byDow = Object.fromEntries((past.json?.days || []).map((d) => [isoDow(d.date), d.status]))
    check('attendance: with no own weekly offs, the company\'s Fri+Sat are the weekend', past.status === 200 && byDow[5] === 'WEEKEND' && byDow[6] === 'WEEKEND' && byDow[7] !== 'WEEKEND', JSON.stringify(byDow))
    const stats = await reader.call(`/v1/attendance/monthly-stats?year=${monday.slice(0, 4)}&month=${Number(monday.slice(5, 7))}`)
    check('attendance: monthly stats still load with the company rule', stats.status === 200, `status=${stats.status}`)
    // put it back straight away (the finally block repeats it if anything throws first)
    cleanup.pop()()
    const back = await reader.call(`/v1/attendance/weekly-summary?weekStart=${monday}`)
    const backDow = Object.fromEntries((back.json?.days || []).map((d) => [isoDow(d.date), d.status]))
    check('attendance: settings put back (own weekly offs apply again)', ownOff === '<null>' || (ownOff.split(',').map(Number).every((d) => backDow[d] === 'WEEKEND')), JSON.stringify(backDow))
  } else {
    check('attendance: company HR configuration row exists for the fallback check', false, 'no settings.hr_configuration row for the demo company')
  }

  // ── Dashboard: top performers' department ──
  const perfEmp = sql(`select e.id || '|' || d.name from hrms.employees e join hrms.departments d on d.id=e.department_id where e.tenant_id='${tenant}' and e.company_id='${company}' and e.is_active order by e.created_at limit 1`)
  if (perfEmp) {
    const [empId, deptName] = perfEmp.split('|')
    const cycle = sql(`insert into performance_mgmt.review_cycles (tenant_id, company_id, name, status) values ('${tenant}','${company}','QA w2i cycle ${stamp}','ACTIVE') returning id`).split(/\s/)[0]
    const review = sql(`insert into performance_mgmt.performance_reviews (tenant_id, cycle_id, employee_id, reviewer_id, reviewer_type, status, overall_rating, submitted_at) values ('${tenant}','${cycle}','${empId}','${empId}','MANAGER','SUBMITTED',5.0, now()) returning id`).split(/\s/)[0]
    cleanup.push(() => { sql(`delete from performance_mgmt.performance_reviews where id='${review}'`); sql(`delete from performance_mgmt.review_cycles where id='${cycle}'`) })
    const perf = await owner.call(`/v1/admin/dashboard/performers?companyId=${company}`)
    const row = (perf.json || []).find((p) => p.id === empId)
    check('dashboard: top performers carry the department', perf.status === 200 && (perf.json || []).every((p) => 'department' in p) && (!row || row.department === deptName), row ? `${row.name} · ${row.department}` : `${(perf.json || []).length} rows`)
    const perfReader = await reader.call(`/v1/admin/dashboard/performers?companyId=${company}`)
    check('dashboard: an employee is refused top performers (403)', perfReader.status === 403, `status=${perfReader.status}`)
  } else {
    check('dashboard: fixture employee with a department', false, 'none in the demo company')
  }

  // ── Dashboard: activity feed names the record ──
  const eventId = sql(`insert into audit.events (id, tenant_id, occurred_at, occurred_date, module, action, entity_type, entity_id, summary) values (gen_random_uuid(),'${tenant}',now(),current_date,'hrms','UPDATE','Employee','${READER}',null) returning id`).split(/\s/)[0]
  cleanup.push(() => sql(`delete from audit.events where id='${eventId}'`))
  const feed = await owner.call(`/v1/audit/events?resource=Employee&resourceId=${READER}&size=10`)
  const ev = (feed.json?.data || []).find((e) => e.id === eventId)
  const readerName = sql(`select btrim(concat_ws(' ', first_name, last_name)) from hrms.employees where id='${READER}'`)
  check('dashboard: the activity feed names the employee an event changed', feed.status === 200 && ev?.resourceName === readerName, ev ? `resourceName=${ev.resourceName}` : `status=${feed.status}`)
  const feedReader = await reader.call('/v1/audit/events?size=5')
  check('dashboard: an employee is refused the audit feed (403)', feedReader.status === 403, `status=${feedReader.status}`)

  // ── Hiring: the dashboard's stage counts open the "All roles" board ──
  const req = await owner.call('/v1/hiring/requisitions', 'POST', { companyId: company, title: `QA w2i role ${stamp}`, openings: 1, employmentType: 'FULL_TIME' })
  check('hiring: owner opens a requisition', (req.status === 201 || req.status === 200) && !!req.json?.id, `status=${req.status}`)
  if (req.json?.id) {
    cleanup.push(() => { sql(`delete from hiring_mgmt.candidates where requisition_id='${req.json.id}'`); sql(`delete from hiring_mgmt.job_requisitions where id='${req.json.id}'`) })
    const cand = sql(`insert into hiring_mgmt.candidates (id, tenant_id, requisition_id, full_name, stage, created_at, updated_at, version) values (gen_random_uuid(),'${tenant}','${req.json.id}','QA w2i candidate ${stamp}','INTERVIEW',now(),now(),0) returning id`).split(/\s/)[0]
    const all = await owner.call(`/v1/hiring/candidates?companyId=${company}&stage=INTERVIEW`)
    check('hiring: every role\'s interview-stage candidates are listed together', all.status === 200 && (all.json || []).some((c) => c.id === cand && c.requisitionId === req.json.id) && (all.json || []).every((c) => c.stage === 'INTERVIEW'), `${(all.json || []).length} candidates`)
    const dash = await owner.call(`/v1/admin/dashboard/hiring?companyId=${company}`)
    const dashInterview = Number((dash.json?.stages || []).find((s) => s.stage === 'INTERVIEW')?.count || 0)
    check('hiring: the board matches the dashboard\'s interview count', dash.status === 200 && dashInterview === (all.json || []).length, `dashboard ${dashInterview}, board ${(all.json || []).length}`)
    const applied = await owner.call(`/v1/hiring/candidates?companyId=${company}&stage=APPLIED`)
    check('hiring: the stage filter leaves other stages out', applied.status === 200 && !(applied.json || []).some((c) => c.id === cand), `status=${applied.status}`)
  }
  const candReader = await reader.call('/v1/hiring/candidates')
  check('hiring: an employee is refused the candidate list (403)', candReader.status === 403, `status=${candReader.status}`)
  const candMgr = await mgr.call('/v1/hiring/candidates')
  check('hiring: a department manager without hiring.read is refused (403)', mgr.perms.includes('hrms.hiring.read') ? candMgr.status === 200 : candMgr.status === 403, `status=${candMgr.status}`)

  // ── Documents: RLS forced (V143_28) ──
  const forced = sql(`select string_agg(c.relname || '=' || c.relforcerowsecurity, ',' order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='document_mgmt' and c.relname in ('employee_documents','document_types')`)
  check('documents: row-level security is forced on both document tables', forced === 'document_types=true,employee_documents=true', forced + (forced.includes('false') ? ' (apply V143_28__documents_force_rls.sql)' : ''))
} catch (e) {
  check('run finished without an exception', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  for (const undo of cleanup.reverse()) { try { undo() } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) } }
}
const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
