// Live API check of the reports & audit batch (w2h, V143_27). No browser.
//  - Server PDFs of every report page and the Workforce Analytics snapshot,
//    each behind its own report permission, each written to the export log.
//  - The export log: server CSV/PDF rows, browser-built files recorded with
//    POST /v1/reports/exports (only for reports the caller can open), and
//    GET /v1/reports/exports (everyone's with read_all, else your own).
//  - Scheduled report emails: eligible recipients, create / edit / pause /
//    send now / delete, recipients who can't open the report refused, and
//    roles without hrms.report.schedule.manage refused.
//  - The audit log's full CSV export (streamed, same filters, "who" by email),
//    record names on audit events, and the export itself audited.
//  - Employee status history: the trigger records a new employee and a status
//    change; headcount on a past date splits by the status on that date.
//  - Directory filters: noDepartment and the dashboard's milestone windows
//    (same people as /v1/hrms/milestones); top performers carry a department;
//    company notices page past the first five.
// Everything the test creates is removed at the end.
//
//   node e2e/recovery/live-w2h.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const PSQL = `${process.env.LOCALAPPDATA}/UnifiedTreeRecovery/pgsql/bin/psql.exe`
const U = { owner: '66666666-6666-6666-6666-666666666666', admin: '11111111-1111-1111-1111-111111111111', hrm: '33333333-3333-3333-3333-333333333333', mgr: '44444444-4444-4444-4444-444444444444', fin: '55555555-5555-5555-5555-555555555555', reader: '22222222-2222-2222-2222-222222222222' }
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  const raw = async (path) => {
    const res = await fetch(api + path, { headers })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', buf }
  }
  return { call, raw }
}

const startedAt = sql('select now()')
const company = sql(`select id from org.companies where tenant_id='${tenant}' order by created_at limit 1`)
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const created = { schedules: [], notices: [], employee: null }
const since = (extra = '') => `tenant_id='${tenant}' and created_at >= '${startedAt}'${extra}`

try {
  const [owner, admin, hrm, mgr, fin, reader] = await Promise.all(['owner', 'admin', 'hrm', 'mgr', 'fin', 'reader'].map((u) => login(`${u}@unifiedtree.demo`)))
  check('fixture: a company to report on', !!company, company)

  // ── 1. report PDFs ──────────────────────────────────────────────────────────
  const from = `${today.slice(0, 7)}-01`
  const pdfs = [
    ['headcount', `asOf=${today}`], ['attrition', `from=${today.slice(0, 4)}-01-01&to=${today}`], ['attendance-summary', `from=${from}&to=${today}`],
    ['leave-balance', `year=${today.slice(0, 4)}`], ['late-marks', `from=${from}&to=${today}`], ['diversity', ''], ['workforce-analytics', `from=${Number(today.slice(0, 4)) - 1}${today.slice(4)}&to=${today}`],
  ]
  for (const [key, qs] of pdfs) {
    const r = await owner.raw(`/v1/reports/${key}/export.pdf?companyId=${company}${qs ? '&' + qs : ''}`)
    check(`PDF: ${key} downloads as a real PDF`, r.status === 200 && r.type.includes('application/pdf') && r.buf.subarray(0, 5).toString() === '%PDF-' && /attachment/.test(r.disposition), `status=${r.status} ${r.buf.length} bytes`)
  }
  const pdfRows = Number(sql(`select count(*) from hrms.report_exports where ${since(` and user_id='${U.owner}' and format='PDF' and source='SERVER'`)}`))
  check('export log: every server PDF is recorded (who, what, filters)', pdfRows === pdfs.length, `${pdfRows} rows`)
  const logged = sql(`select filters->>'asOf' from hrms.report_exports where ${since(` and report='headcount' and format='PDF'`)} limit 1`)
  check('export log: the filters are stored with the row', logged === today, logged)
  const hcNoText = (await owner.raw(`/v1/reports/headcount/export.pdf?companyId=${company}`)).buf.toString('latin1')
  check('PDF: no product name in the file', !/unified\s?tree/i.test(hcNoText))

  const readerPdf = await reader.raw(`/v1/reports/headcount/export.pdf?companyId=${company}`)
  const mgrPdf = await mgr.raw(`/v1/reports/diversity/export.pdf?companyId=${company}`)
  check('PDF: refused for the employee and the manager (403)', readerPdf.status === 403 && mgrPdf.status === 403, `reader=${readerPdf.status} mgr=${mgrPdf.status}`)
  const finPdf = await fin.raw(`/v1/reports/diversity/export.pdf?companyId=${company}`)
  check('PDF: finance lead (holds the diversity report) downloads it', finPdf.status === 200)
  const badRange = await owner.call(`/v1/reports/attrition/export.pdf?companyId=${company}&from=${today}&to=2020-01-01`)
  check('PDF: a backwards date range is refused (422)', badRange.status === 422, `status=${badRange.status}`)

  // ── 2. export log: server CSV + browser files + listing ─────────────────────
  const csv = await owner.raw(`/v1/reports/headcount/export.csv?companyId=${company}&asOf=${today}`)
  check('CSV: server CSV still downloads', csv.status === 200 && csv.type.includes('text/csv'))
  check('export log: server CSV recorded', Number(sql(`select count(*) from hrms.report_exports where ${since(` and format='CSV' and report='headcount' and source='SERVER'`)}`)) >= 1)

  const browser = await fin.call('/v1/reports/exports', 'POST', { report: 'attrition', format: 'XLSX', fileName: `live-w2h-${Date.now()}.xlsx`, companyId: company, filters: { from, to: today }, rowCount: 12, sizeBytes: 4096 })
  check('export log: a browser-built workbook is recorded (201)', browser.status === 201 && !!browser.json?.id, `status=${browser.status}`)
  check('export log: browser row stored as BROWSER, by the finance lead', sql(`select source||'|'||user_id||'|'||company_name from hrms.report_exports where id='${browser.json?.id}'`).startsWith(`BROWSER|${U.fin}|`))
  const forged = await fin.call('/v1/reports/exports', 'POST', { report: 'audit-log', format: 'CSV', fileName: 'x.csv' })
  check('export log: can’t record a report you can’t open (403)', forged.status === 403, `status=${forged.status}`)
  const badFormat = await fin.call('/v1/reports/exports', 'POST', { report: 'attrition', format: 'EXE', fileName: 'x.exe' })
  check('export log: unknown format refused (422)', badFormat.status === 422, `status=${badFormat.status}`)
  const readerPost = await reader.call('/v1/reports/exports', 'POST', { report: 'headcount', format: 'CSV', fileName: 'x.csv' })
  check('export log: the employee can’t record exports (403)', readerPost.status === 403, `status=${readerPost.status}`)

  const hrmList = await hrm.call('/v1/reports/exports?size=100')
  check('Recent downloads: HR sees everyone’s downloads', hrmList.status === 200 && hrmList.json?.scope === 'all' && hrmList.json?.canSeeAll === true && hrmList.json.content.some((x) => x.userId === U.owner && x.format === 'PDF'), `scope=${hrmList.json?.scope}`)
  const finList = await fin.call('/v1/reports/exports?size=100')
  check('Recent downloads: finance sees only their own', finList.status === 200 && finList.json?.scope === 'mine' && finList.json.content.length > 0 && finList.json.content.every((x) => x.userId === U.fin && x.mine), `${finList.json?.content?.length} rows`)
  const finAll = await fin.call('/v1/reports/exports?scope=all')
  const readerList = await reader.call('/v1/reports/exports')
  check('Recent downloads: "everyone" refused without read_all; employee refused (403)', finAll.status === 403 && readerList.status === 403, `fin all=${finAll.status} reader=${readerList.status}`)

  // ── 3. scheduled report emails ─────────────────────────────────────────────
  const eligible = await hrm.call('/v1/reports/schedules/recipients?report=headcount')
  const ids = (eligible.json || []).map((p) => p.id)
  check('schedules: recipients are people who can open the report', eligible.status === 200 && ids.includes(U.fin) && ids.includes(U.hrm) && !ids.includes(U.reader) && !ids.includes(U.mgr), `${ids.length} people`)
  const bad = await hrm.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'WEEKLY', dayOfWeek: 1, recipientIds: [U.fin, U.reader], active: true })
  check('schedules: a recipient who can’t open the report is refused (422)', bad.status === 422 && /can’t open|can't open/.test(JSON.stringify(bad.json)), `status=${bad.status}`)
  const finCreate = await fin.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'WEEKLY', dayOfWeek: 1, recipientIds: [U.fin] })
  const readerCreate = await reader.call('/v1/reports/schedules')
  check('schedules: roles without schedule.manage are refused (403)', finCreate.status === 403 && readerCreate.status === 403, `fin=${finCreate.status} reader=${readerCreate.status}`)
  const made = await hrm.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'WEEKLY', dayOfWeek: 1, recipientIds: [U.fin, U.hrm], active: true })
  if (made.json?.id) created.schedules.push(made.json.id)
  check('schedules: HR sets up a weekly headcount email (201)', made.status === 201 && made.json?.frequency === 'WEEKLY', `status=${made.status}`)
  const row = made.json?.id ? sql(`select frequency||'|'||day_of_week||'|'||array_length(recipient_user_ids,1)||'|'||(next_run_on > '${today}')||'|'||extract(isodow from next_run_on) from hrms.report_schedules where id='${made.json.id}'`) : ''
  check('schedules: stored with its next Monday after today', row === 'WEEKLY|1|2|true|1', row)
  const edited = await hrm.call(`/v1/reports/schedules/${made.json?.id}`, 'PUT', { report: 'headcount', companyId: company, frequency: 'MONTHLY', dayOfMonth: 5, recipientIds: [U.fin], active: true })
  check('schedules: changed to monthly on the 5th', edited.status === 200 && sql(`select frequency||'|'||day_of_month||'|'||extract(day from next_run_on) from hrms.report_schedules where id='${made.json?.id}'`) === 'MONTHLY|5|5', `status=${edited.status}`)
  const sent = await hrm.call(`/v1/reports/schedules/${made.json?.id}/send-now`, 'POST')
  check('schedules: send now answers with a result', sent.status === 200 && ['SENT', 'PARTIAL', 'FAILED'].includes(sent.json?.status), `${sent.json?.status}: ${sent.json?.message}`)
  check('schedules: the send is recorded on the schedule and in the export log',
    sql(`select coalesce(last_status,'') from hrms.report_schedules where id='${made.json?.id}'`) === sent.json?.status
    && Number(sql(`select count(*) from hrms.report_exports where ${since(` and source='SCHEDULE' and schedule_id='${made.json?.id}'`)}`)) >= 1)
  const paused = await hrm.call(`/v1/reports/schedules/${made.json?.id}`, 'PUT', { report: 'headcount', companyId: company, frequency: 'MONTHLY', dayOfMonth: 5, recipientIds: [U.fin], active: false })
  check('schedules: paused', paused.status === 200 && sql(`select active from hrms.report_schedules where id='${made.json?.id}'`) === 'f')
  const listed = await hrm.call('/v1/reports/schedules')
  check('schedules: listed with names of the recipients and who set it up', listed.status === 200 && listed.json.some((s) => s.id === made.json?.id && s.recipients[0]?.name && s.createdByName))
  check('schedules: create / change recorded in the audit trail',
    Number(sql(`select count(*) from audit.events where tenant_id='${tenant}' and entity_type='report_schedule' and entity_id='${made.json?.id}' and action in ('CREATE','UPDATE')`)) >= 2)

  // ── 4. audit: record names, full export ────────────────────────────────────
  const events = await owner.call(`/v1/audit/events?resource=report_schedule&resourceId=${made.json?.id}&size=10`)
  const named = (events.json?.data || []).find((e) => e.resourceId === made.json?.id)
  check('audit: events carry the record’s name and a link', !!named?.resourceName && named?.resourcePath === '/hrms/reports', `${named?.resourceName} → ${named?.resourcePath}`)
  const byEmail = await owner.call('/v1/audit/events?actor=hrm@unifiedtree.demo&size=100')
  check('audit: the "who" filter takes an email', byEmail.status === 200 && byEmail.json.data.length > 0 && byEmail.json.data.every((e) => e.actorUserId === U.hrm), `${byEmail.json?.data?.length} events`)
  const nobody = await owner.call('/v1/audit/events?actor=nobody-w2h@example.com')
  check('audit: an unknown email matches nothing', nobody.status === 200 && nobody.json.meta.total === 0)

  const full = await owner.raw(`/v1/audit/events/export.csv?resource=report_schedule&from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`)
  const lines = full.buf.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
  const expected = Number(sql(`select count(*) from audit.events where tenant_id='${tenant}' and entity_type='report_schedule' and occurred_at >= now() - interval '1 day'`))
  check('audit export: full filtered trail as CSV', full.status === 200 && full.type.includes('text/csv') && lines[0].startsWith('When (IST),Who,Email,Action') && lines.length - 1 === expected, `${lines.length - 1} rows, DB ${expected}`)
  check('audit export: rows name the record', lines.slice(1).some((l) => l.includes(' email')), lines[1]?.slice(0, 120))
  const hrmAudit = await hrm.raw('/v1/audit/events/export.csv')
  const readerAudit = await reader.raw('/v1/audit/events/export.csv')
  check('audit export: refused without audit.read (403)', hrmAudit.status === 403 && readerAudit.status === 403, `hrm=${hrmAudit.status} reader=${readerAudit.status}`)
  check('audit export: logged in the export log and in the audit trail',
    Number(sql(`select count(*) from hrms.report_exports where ${since(` and report='audit-log' and user_id='${U.owner}'`)}`)) >= 1
    && Number(sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='EXPORT' and entity_type='audit_log' and occurred_at >= '${startedAt}'`)) >= 1)

  const del = await hrm.call(`/v1/reports/schedules/${made.json?.id}`, 'DELETE')
  check('schedules: deleted', del.status === 204 && sql(`select count(*) from hrms.report_schedules where id='${made.json?.id}'`) === '0', `status=${del.status}`)
  if (del.status === 204) created.schedules = []

  // ── 5. employee status history ─────────────────────────────────────────────
  check('status history: backfilled for every employee',
    sql(`select count(*) from hrms.employees e where e.tenant_id='${tenant}' and not exists (select 1 from hrms.employee_status_history h where h.employee_id=e.id)`) === '0')
  const none = (rows) => (rows || []).find((r) => !r.department) || { probation: 0, active: 0, on_notice: 0 }
  const headcountOn = async (d) => none((await owner.call(`/v1/reports/headcount?companyId=${company}&asOf=${d}`)).json)
  const [basePast, baseLater] = [await headcountOn('2025-02-01'), await headcountOn('2025-06-01')]
  const code = `W2H${Date.now().toString().slice(-6)}`
  created.employee = sql(`insert into hrms.employees (id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, employment_status, date_of_joining, probation_end_date)
    values (gen_random_uuid(), '${tenant}', '${company}', '${code}', 'W2h', 'History', 'FULL_TIME', 'ACTIVE', date '2025-01-06', date '2025-04-06') returning id`).split(/\s/)[0]
  check('status history: a new employee gets a timeline (on probation, then confirmed)',
    sql(`select string_agg(status||'@'||effective_on, ',' order by effective_on, recorded_at) from hrms.employee_status_history where employee_id='${created.employee}'`) === `PROBATION@2025-01-06,ACTIVE@${today > '2025-04-06' ? '2025-04-06' : today}`)
  sql(`update hrms.employees set employment_status='NOTICE_PERIOD', notice_start_date=(date '${today}' - 2), last_working_day=(date '${today}' + 28) where id='${created.employee}'`)
  check('status history: a status change is recorded, dated by the notice start',
    sql(`select from_status||'>'||status||'@'||effective_on from hrms.employee_status_history where employee_id='${created.employee}' and source='CHANGE'`) === `ACTIVE>NOTICE_PERIOD@${sql(`select date '${today}' - 2`)}`)
  const hist = await owner.call(`/v1/hrms/employees/${created.employee}/status-history`)
  check('status history: API lists it oldest first', hist.status === 200 && hist.json.map((h) => h.status).join('>') === 'PROBATION>ACTIVE>NOTICE_PERIOD', hist.json?.map?.((h) => h.status).join('>'))
  const histReader = await reader.call(`/v1/hrms/employees/${created.employee}/status-history`)
  check('status history: refused for the employee role (403)', histReader.status === 403, `status=${histReader.status}`)
  // The new person (no department) was on probation in Feb 2025, confirmed by Jun 2025 and is on notice today.
  const [past, later, now] = [await headcountOn('2025-02-01'), await headcountOn('2025-06-01'), await headcountOn(today)]
  check('headcount on a past date: the split uses the status on that date',
    Number(past.probation) === Number(basePast.probation) + 1 && Number(past.active) === Number(basePast.active)
    && Number(later.active) === Number(baseLater.active) + 1 && Number(later.probation) === Number(baseLater.probation) && Number(now.on_notice) >= 1,
    `Feb 2025 probation ${basePast.probation}→${past.probation}, Jun 2025 active ${baseLater.active}→${later.active}, today on notice ${now.on_notice}`)

  // ── 6. directory filters, performers, notices ──────────────────────────────
  const noDept = await owner.call(`/v1/hrms/employees?noDepartment=true&pageSize=200`)
  const dbNoDept = Number(sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and is_active and department_id is null`))
  check('directory: "No department" lists exactly the people without one', noDept.status === 200 && noDept.json.totalElements === dbNoDept && noDept.json.content.every((e) => !e.departmentId), `${noDept.json?.totalElements} vs DB ${dbNoDept}`)
  const ms = await owner.call('/v1/hrms/milestones?birthdayDays=14&anniversaryDays=31&retirementMonths=6')
  for (const [kind, key] of [['birthday', 'birthdays'], ['anniversary', 'anniversaries'], ['retirement', 'retirements']]) {
    const dir = await owner.call(`/v1/hrms/employees?milestone=${kind}&pageSize=200`)
    const a = (dir.json?.content || []).map((e) => e.id).sort().join(','), b = (ms.json?.[key] || []).map((m) => m.employeeId).sort().join(',')
    check(`directory: ${kind} filter shows the dashboard card's people`, dir.status === 200 && a === b, `${dir.json?.content?.length} vs ${ms.json?.[key]?.length}`)
  }
  const badMs = await owner.call('/v1/hrms/employees?milestone=holiday')
  check('directory: unknown milestone refused (422)', badMs.status === 422, `status=${badMs.status}`)
  const readerDir = await reader.call('/v1/hrms/employees?noDepartment=true')
  check('directory: filters keep the directory permission (employee 403)', readerDir.status === 403, `status=${readerDir.status}`)
  const perf = await owner.call(`/v1/admin/dashboard/performers?companyId=${company}`)
  check('dashboard: top performers carry their department', perf.status === 200 && (perf.json || []).every((p) => 'department' in p), `${perf.json?.length} performers`)
  const hc = await owner.call(`/v1/reports/headcount?companyId=${company}`)
  check('dashboard: department bars carry the department id', hc.status === 200 && hc.json.filter((r) => r.department).every((r) => r.department_id))

  for (let i = 0; i < 6; i++) {
    const n = await owner.call('/v1/admin/dashboard/notices', 'POST', { companyId: company, title: `W2H pager ${i}`, body: 'Live test notice' })
    if (n.json?.id) created.notices.push(n.json.id)
  }
  const total = Number(sql(`select count(*) from hrms.company_notices where tenant_id='${tenant}' and company_id='${company}' and not archived and (expires_on is null or expires_on >= current_date)`))
  const p1 = await owner.call(`/v1/admin/dashboard/notices?companyId=${company}&page=1`)
  check('dashboard: notices page past the first five', created.notices.length === 6 && p1.status === 200 && p1.json.content.length === Math.min(5, total - 5) && p1.json.totalElements >= 6, `page 2 has ${p1.json?.content?.length} of ${p1.json?.totalElements}`)
} catch (e) {
  check('run finished without errors', false, e.stack || String(e))
} finally {
  // ── cleanup ────────────────────────────────────────────────────────────────
  try {
    for (const id of created.schedules) sql(`delete from hrms.report_schedules where id='${id}'`)
    if (created.notices.length) sql(`delete from hrms.company_notices where id in (${created.notices.map((x) => `'${x}'`).join(',')})`)
    if (created.employee) sql(`delete from hrms.employees where id='${created.employee}'`)
    sql(`delete from hrms.report_exports where ${since()}`)
    sql(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${startedAt}' and entity_type in ('report_schedule','audit_log')`)
    const left = sql(`select (select count(*) from hrms.report_exports where ${since()}) + (select count(*) from hrms.employee_status_history where employee_id='${created.employee || '00000000-0000-0000-0000-000000000000'}')`)
    check('cleanup: everything the test created is gone', left === '0', left)
  } catch (e) {
    check('cleanup', false, String(e))
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
