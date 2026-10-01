// Live check of P-REPORTS (redesign BW-86 … BW-89): the Reports center, the six
// report pages and Workforce analytics, against a running server and its database.
//
// API (PHASE=api or all):
//   · /v1/reports/summary: every tile series matches the report it summarises AND
//     the database, for owner, hrm and fin; a custom role with only headcount +
//     attendance gets only those series; mgr and reader get 403 everywhere
//   · /v1/reports/headcount/change, /headcount/trend, /fiscal-year and diversity
//     ?asOf= match the headcount report and the status history in SQL
//   · report emails: a weekday email at 11:00 and a daily email are created,
//     listed, sent once (CSV next to the PDF in the export log) and deleted; bad
//     hours and people without the permission are refused; with V143_62's column
//     renamed the new options answer FEATURE_NOT_READY while weekly still works
// UI (PHASE=ui or all): the Reports center tiles and hero show the API's numbers,
//   Workforce analytics' three tabs (?tab=) per role with their downloads, the
//   six report pages, light and dark, 390 px without sideways scroll, no page
//   errors and no failed API calls.
// Everything it creates is removed (schedules, their export-log and audit rows,
// the custom role and its user).
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-reports.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_APP_URL, RECOVERY_DB, PHASE, SHOTS_DIR
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3150'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const phase = process.env.PHASE || 'all'
const shots = process.env.SHOTS_DIR || ''
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ── dates (India) ───────────────────────────────────────────────────────────
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const monthStart = (d, back = 0) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - back); return x.toISOString().slice(0, 10) }
const monthEnd = (d) => { const x = new Date(monthStart(d) + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10) }
const today = istToday()
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011

// ── sessions ────────────────────────────────────────────────────────────────
let allowNotReady = false
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
    if (res.status >= 500 && !(allowNotReady && json?.errorCode === 'FEATURE_NOT_READY')) surprises.push(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    if (json?.errorCode === 'FEATURE_NOT_READY' && !allowNotReady) surprises.push(`${method} ${path} → FEATURE_NOT_READY outside the rename step`)
    return { status: res.status, json }
  }
  return { call, userId: d.userId ?? d.user?.id, permissions: new Set(d.permissions || []) }
}
const q = (o) => new URLSearchParams(o).toString()

// ── SQL: the reports' own rules, written independently ─────────────────────
/** People employed on a date, by the headcount report's rule. */
const employedSql = (d) => `select count(*) from hrms.employees e where e.tenant_id='${tenant}' and e.company_id='${company}' and e.date_of_joining <= '${d}' and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') <= '${d}')`
/** Of them, the ones active, on notice or on probation on that date (status from the history; an exit recorded by then with a later last day = on notice). */
const bucketedSql = (d) => `with s as (select distinct on (h.employee_id) h.employee_id, h.status from hrms.employee_status_history h where h.tenant_id='${tenant}' and h.effective_on <= '${d}' order by h.employee_id, h.effective_on desc, h.recorded_at desc),
 l as (select distinct h.employee_id from hrms.employee_status_history h where h.tenant_id='${tenant}' and h.status in ('EXITED','TERMINATED','RESIGNED') and h.effective_on > '${d}' and (h.recorded_at at time zone 'Asia/Kolkata')::date <= '${d}')
 select count(*) from hrms.employees e left join s on s.employee_id=e.id left join l on l.employee_id=e.id where e.tenant_id='${tenant}' and e.company_id='${company}' and e.date_of_joining <= '${d}'
 and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') <= '${d}')
 and (l.employee_id is not null or coalesce(s.status, e.employment_status) in ('ACTIVE','PROBATION','NOTICE_PERIOD','EXITED','TERMINATED','RESIGNED'))`

const sum = (rows, k) => (rows || []).reduce((a, r) => a + Number(r[k] || 0), 0)

// ── fixtures ────────────────────────────────────────────────────────────────
const fx = { role: randomUUID(), user: randomUUID(), employee: randomUUID(), schedules: [] }
const fxEmail = `qa-reports-${fx.user.slice(0, 8)}@example.invalid`
function makeCustomRole() {
  sql(`BEGIN;
    INSERT INTO rbac.roles(id, tenant_id, code, display_name, description, is_system) VALUES ('${fx.role}', '${tenant}', 'QA_REPORTS_${fx.role.slice(0, 8).toUpperCase()}', 'QA reports headcount + attendance', 'live-rd-p-reports fixture', false);
    INSERT INTO rbac.role_permissions(role_id, permission_code) VALUES ('${fx.role}', 'hrms.report.headcount'), ('${fx.role}', 'hrms.report.attendance');
    INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, email, employment_type, employment_status, date_of_joining)
      VALUES ('${fx.employee}', '${tenant}', '${company}', 'QARP-${fx.employee.slice(0, 6)}', 'Qa', 'Reports', '${fxEmail}', 'FULL_TIME', 'ACTIVE', DATE '2020-01-01');
    INSERT INTO auth.user_credentials(id, tenant_id, email, password_hash, employee_id, is_active)
      SELECT '${fx.user}', '${tenant}', '${fxEmail}', password_hash, '${fx.employee}', true FROM auth.user_credentials WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id, user_id, role_id) VALUES ('${tenant}', '${fx.user}', '${fx.role}');
    COMMIT;`)
}
function cleanup() {
  try {
    for (const id of fx.schedules) {
      sql(`DELETE FROM hrms.report_exports WHERE tenant_id='${tenant}' AND schedule_id='${id}'`)
      sql(`DELETE FROM hrms.report_schedules WHERE tenant_id='${tenant}' AND id='${id}'`)
      sql(`DELETE FROM audit.events WHERE tenant_id='${tenant}' AND entity_type='report_schedule' AND entity_id='${id}'`)
    }
    sql(`BEGIN;
      DELETE FROM rbac.user_roles WHERE tenant_id='${tenant}' AND user_id='${fx.user}';
      DELETE FROM auth.user_credentials WHERE tenant_id='${tenant}' AND id='${fx.user}';
      DELETE FROM hrms.employee_status_history WHERE tenant_id='${tenant}' AND employee_id='${fx.employee}';
      DELETE FROM hrms.employees WHERE tenant_id='${tenant}' AND id='${fx.employee}';
      DELETE FROM rbac.role_permissions WHERE role_id='${fx.role}';
      DELETE FROM rbac.roles WHERE id='${fx.role}';
      COMMIT;`)
  } catch (e) { console.log('cleanup problem: ' + String(e.message || e).slice(0, 300)) }
}

// ── API phase ───────────────────────────────────────────────────────────────
async function apiPhase() {
  const owner = await session('owner@unifiedtree.demo')
  const hrm = await session('hrm@unifiedtree.demo')
  const fin = await session('fin@unifiedtree.demo')
  const mgr = await session('mgr@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')
  makeCustomRole()
  // The fixture person is employed now; every SQL count below includes them, like the API does.
  const custom = await session(fxEmail)

  // 1. The summary, per role, against its reports and SQL.
  for (const [who, s] of [['owner', owner], ['hrm', hrm], ['fin', fin]]) {
    const r = await s.call(`/v1/reports/summary?${q({ companyId: company })}`)
    check(`${who}: summary answers`, r.status === 200, `status ${r.status}`)
    const S = r.json || {}
    check(`${who}: every series is there`, ['headcount', 'attrition', 'diversity', 'attendance', 'lateMarks', 'leaveBalance'].every((k) => S[k]), Object.keys(S).join(','))
    const head = (await s.call(`/v1/reports/headcount?${q({ companyId: company, asOf: today })}`)).json
    check(`${who}: headcount tile = headcount report = SQL`, S.headcount?.total === sum(head, 'total') && S.headcount?.total === num(employedSql(today)),
      `tile ${S.headcount?.total}, report ${sum(head, 'total')}, sql ${num(employedSql(today))}`)
    check(`${who}: headcount tile departments = report rows`, (S.headcount?.departments || []).length === (head || []).length
      && (S.headcount?.departments || []).every((d) => (head || []).some((h) => (h.department_id ?? null) === (d.departmentId ?? null) && Number(h.total) === d.count)))
    const attr = (await s.call(`/v1/reports/attrition?${q({ companyId: company, from: monthStart(today, 5), to: today })}`)).json || []
    check(`${who}: attrition tile = last six months of the attrition report`, (S.attrition?.months || []).length === 6
      && S.attrition.months.every((m, i) => m.month === attr[i]?.month && close(m.pct, attr[i].attrition_pct) && m.exits === Number(attr[i].exits)))
    const exitsThisMonth = num(`select count(*) from hrms.employees e where e.tenant_id='${tenant}' and e.company_id='${company}' and e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination) between '${monthStart(today)}' and '${today}'`)
    check(`${who}: this month's exits = SQL`, S.attrition?.months?.[5]?.exits === exitsThisMonth, `tile ${S.attrition?.months?.[5]?.exits}, sql ${exitsThisMonth}`)
    const div = (await s.call(`/v1/reports/diversity?${q({ companyId: company })}`)).json || []
    const women = div.filter((x) => x.gender === 'FEMALE').reduce((a, x) => a + Number(x.count), 0)
    const dbDiv = num(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD')`)
    const dbWomen = num(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD') and gender='FEMALE'`)
    check(`${who}: diversity tile = diversity report = SQL`, S.diversity?.total === sum(div, 'count') && S.diversity?.total === dbDiv && S.diversity?.women === women && women === dbWomen,
      `tile ${JSON.stringify(S.diversity)}, sql ${dbDiv}/${dbWomen}`)
    const att = (await s.call(`/v1/reports/attendance-summary?${q({ companyId: company, from: addDays(today, -6), to: today })}`)).json || []
    check(`${who}: attendance tile (7 days) adds up to the summary's present days`, (S.attendance?.days || []).length === 7
      && sum(S.attendance.days, 'present') === sum(att, 'present_days'), `tile ${sum(S.attendance?.days, 'present')}, report ${sum(att, 'present_days')}`)
    const late = (await s.call(`/v1/reports/late-marks?${q({ companyId: company, from: addDays(today, -13), to: today })}`)).json || []
    check(`${who}: late marks tile (14 days) = the late marks report's rows`, (S.lateMarks?.days || []).length === 14 && sum(S.lateMarks.days, 'count') === late.length,
      `tile ${sum(S.lateMarks?.days, 'count')}, report ${late.length}`)
    const year = Number(today.slice(0, 4))
    const leave = (await s.call(`/v1/reports/leave-balance?${q({ companyId: company, year })}`)).json || []
    const dbUsed = Number(sql(`select coalesce(sum(lb.used),0) from leave_mgmt.leave_balances lb join hrms.employees e on e.id=lb.employee_id where lb.tenant_id='${tenant}' and e.company_id='${company}' and lb.year=${year} and e.employment_status='ACTIVE'`))
    check(`${who}: leave tile = leave balance report = SQL`, close(S.leaveBalance?.used, sum(leave, 'used')) && close(S.leaveBalance?.available, sum(leave, 'available')) && close(S.leaveBalance?.used, dbUsed),
      `tile ${JSON.stringify(S.leaveBalance)}, sql used ${dbUsed}`)
  }

  // 2. Each series only with its own permission.
  const cs = await custom.call(`/v1/reports/summary?${q({ companyId: company })}`)
  check('custom role (headcount + attendance): summary answers', cs.status === 200, `status ${cs.status}`)
  check('custom role: gets headcount, attendance and late marks', !!(cs.json?.headcount && cs.json?.attendance && cs.json?.lateMarks))
  check('custom role: no attrition, diversity or leave series', cs.json && !('attrition' in cs.json) && !('diversity' in cs.json) && !('leaveBalance' in cs.json), Object.keys(cs.json || {}).join(','))
  check('custom role: its own endpoints answer', (await custom.call(`/v1/reports/headcount/change?${q({ companyId: company, from: addDays(today, -7), to: today })}`)).status === 200
    && (await custom.call(`/v1/reports/headcount/trend?${q({ companyId: company, months: 6 })}`)).status === 200
    && (await custom.call(`/v1/reports/fiscal-year?${q({ companyId: company })}`)).status === 200)
  check('custom role: the diversity report stays closed', (await custom.call(`/v1/reports/diversity?${q({ companyId: company, asOf: today })}`)).status === 403)
  check('custom role: report emails stay closed', (await custom.call('/v1/reports/schedules/options')).status === 403)
  for (const [who, s] of [['mgr', mgr], ['reader', reader]]) {
    const codes = []
    for (const p of [`/v1/reports/summary?${q({ companyId: company })}`, `/v1/reports/headcount/change?${q({ companyId: company, from: addDays(today, -7), to: today })}`,
      `/v1/reports/headcount/trend?${q({ companyId: company })}`, `/v1/reports/fiscal-year?${q({ companyId: company })}`, `/v1/reports/diversity?${q({ companyId: company, asOf: today })}`]) codes.push((await s.call(p)).status)
    check(`${who}: every new report endpoint is closed (403)`, codes.every((c) => c === 403), codes.join(','))
  }

  // 3. Headcount change, trend, diversity as of a date, fiscal year.
  const from = addDays(monthStart(today), -1)
  const ch = (await owner.call(`/v1/reports/headcount/change?${q({ companyId: company, from, to: today })}`)).json || {}
  const joined = num(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and date_of_joining > '${from}' and date_of_joining <= '${today}'`)
  const left = num(`select count(*) from hrms.employees where tenant_id='${tenant}' and company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(last_working_day, date_of_termination) > '${from}' and coalesce(last_working_day, date_of_termination) <= '${today}'`)
  check('headcount change: both ends = SQL, joined and left = SQL', ch.headcountFrom === num(employedSql(from)) && ch.headcountTo === num(employedSql(today))
    && ch.change === ch.headcountTo - ch.headcountFrom && ch.joined === joined && ch.left === left, JSON.stringify(ch))
  check('headcount change: dates the wrong way round are refused', [400, 422].includes((await owner.call(`/v1/reports/headcount/change?${q({ companyId: company, from: today, to: from })}`)).status))
  const trend = (await owner.call(`/v1/reports/headcount/trend?${q({ companyId: company, months: 6 })}`)).json || []
  const wantMonths = [5, 4, 3, 2, 1, 0].map((b) => monthStart(today, b).slice(0, 7))
  check('trend: six month-end points ending today', trend.length === 6 && trend.every((p, i) => p.month === wantMonths[i]) && trend[5].asOf === today && trend[0].asOf === monthEnd(monthStart(today, 5)),
    trend.map((p) => p.asOf).join(','))
  let trendOk = true; const trendDetail = []
  for (const p of trend) { const n = num(employedSql(p.asOf)); trendDetail.push(`${p.asOf}:${p.headcount}/${n}`); if (p.headcount !== n) trendOk = false }
  check('trend: each point = the headcount on that date in SQL', trendOk, trendDetail.join(' '))
  for (const d of [addDays(today, -40), monthEnd(monthStart(today, 4)), today]) {
    const dv = (await owner.call(`/v1/reports/diversity?${q({ companyId: company, asOf: d })}`)).json || []
    const hd = (await owner.call(`/v1/reports/headcount?${q({ companyId: company, asOf: d })}`)).json || []
    const buckets = sum(hd, 'active') + sum(hd, 'on_notice') + sum(hd, 'probation')
    check(`diversity as of ${d} = headcount's active + notice + probation = status history in SQL`, sum(dv, 'count') === buckets && buckets === num(bucketedSql(d)),
      `diversity ${sum(dv, 'count')}, headcount ${buckets}, sql ${num(bucketedSql(d))}`)
  }
  const startMonth = sql(`select coalesce(nullif(upper(trim(fiscal_year_start)), ''), 'APRIL') from org.companies where tenant_id='${tenant}' and id='${company}'`)
  const fy = (await owner.call(`/v1/reports/fiscal-year?${q({ companyId: company })}`)).json || {}
  check('fiscal year: starts in the company’s month and contains today', fy.startMonth === startMonth && fy.from <= today && today <= fy.to, JSON.stringify(fy))
  const stranger = (await owner.call(`/v1/reports/summary?${q({ companyId: randomUUID() })}`)).json || {}
  check('summary for a company outside this workspace is empty, not someone else’s data', stranger.headcount?.total === 0 && stranger.diversity?.total === 0)

  // 4. Report emails.
  const hrmUser = sql(`select id from auth.user_credentials where tenant_id='${tenant}' and email='hrm@unifiedtree.demo'`)
  const opts = (await owner.call('/v1/reports/schedules/options')).json || {}
  check('email options: every day and every weekday, 7 to 23', opts.ready === true && ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'].every((f) => opts.frequencies?.includes(f)) && opts.firstHour === 7 && opts.lastHour === 23, JSON.stringify(opts))
  const wk = await owner.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'WEEKDAYS', dayOfWeek: null, dayOfMonth: null, recipientIds: [hrmUser], active: true, sendHour: 11 })
  if (wk.json?.id) fx.schedules.push(wk.json.id)
  const nextWeekday = (() => { let d = addDays(today, 1); while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = addDays(d, 1); return d })()
  check('weekday email at 11:00 is set up', wk.status === 201 && wk.json?.frequency === 'WEEKDAYS' && wk.json?.sendHour === 11 && wk.json?.nextRunOn === nextWeekday, `${wk.status} ${JSON.stringify(wk.json).slice(0, 200)}`)
  check('weekday email: stored with its hour and no day', wk.json?.id && sql(`select frequency||'|'||coalesce(send_hour::text,'')||'|'||coalesce(day_of_week::text,'-')||'|'||coalesce(day_of_month::text,'-') from hrms.report_schedules where tenant_id='${tenant}' and id='${wk.json.id}'`) === 'WEEKDAYS|11|-|-')
  const dl = await owner.call('/v1/reports/schedules', 'POST', { report: 'late-marks', companyId: company, frequency: 'DAILY', dayOfWeek: 3, dayOfMonth: 9, recipientIds: [hrmUser], active: false, sendHour: null })
  if (dl.json?.id) fx.schedules.push(dl.json.id)
  check('daily email (no hour) is set up, paused, without a day', dl.status === 201 && dl.json?.frequency === 'DAILY' && dl.json?.dayOfWeek == null && dl.json?.dayOfMonth == null && dl.json?.sendHour == null && dl.json?.active === false && dl.json?.nextRunOn === addDays(today, 1),
    `${dl.status} ${JSON.stringify(dl.json).slice(0, 200)}`)
  const bad = await owner.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'DAILY', recipientIds: [hrmUser], active: true, sendHour: 6 })
  if (bad.json?.id) fx.schedules.push(bad.json.id)
  check('a send hour outside 7–23 is refused', [400, 422].includes(bad.status), `${bad.status}`)
  const finTry = await fin.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'DAILY', recipientIds: [hrmUser], active: true })
  if (finTry.json?.id) fx.schedules.push(finTry.json.id)
  check('fin (no schedule permission) can’t set up emails', finTry.status === 403, `${finTry.status}`)
  const listed = (await owner.call('/v1/reports/schedules')).json || []
  check('both emails are listed with their timing', listed.some((x) => x.id === wk.json?.id && x.sendHour === 11) && listed.some((x) => x.id === dl.json?.id && x.frequency === 'DAILY'))
  const upd = await owner.call(`/v1/reports/schedules/${wk.json?.id}`, 'PUT', { report: 'headcount', companyId: company, frequency: 'WEEKDAYS', recipientIds: [hrmUser], active: true, sendHour: 15 })
  check('the hour can be changed', upd.status === 200 && upd.json?.sendHour === 15, `${upd.status}`)
  // One send to a demo mailbox (the local mail sink): the CSV goes next to the PDF.
  const sent = await owner.call(`/v1/reports/schedules/${wk.json?.id}/send-now`, 'POST')
  const files = sql(`select string_agg(format||':'||source, ',' order by format) from hrms.report_exports where tenant_id='${tenant}' and schedule_id='${wk.json?.id}'`)
  check('send now: the email carries the PDF and the CSV (both logged)', sent.status === 200 && files === 'CSV:SCHEDULE,PDF:SCHEDULE', `${sent.status} ${sent.json?.status} files=${files}`)
  for (const id of [...fx.schedules]) {
    const del = await owner.call(`/v1/reports/schedules/${id}`, 'DELETE')
    check(`email ${id.slice(0, 8)} deleted`, del.status === 204 && num(`select count(*) from hrms.report_schedules where tenant_id='${tenant}' and id='${id}'`) === 0, `${del.status}`)
  }

  // 5. Before V143_62: the column renamed, the new options are "not switched on yet"; weekly still works.
  allowNotReady = true
  try {
    sql('ALTER TABLE hrms.report_schedules RENAME COLUMN send_hour TO send_hour_qa')
    const o2 = (await owner.call('/v1/reports/schedules/options')).json || {}
    check('without V143_62: options offer weekly and monthly only', o2.ready === false && o2.frequencies?.join(',') === 'WEEKLY,MONTHLY', JSON.stringify(o2))
    const nr = await owner.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'DAILY', recipientIds: [hrmUser], active: false })
    if (nr.json?.id) fx.schedules.push(nr.json.id)
    check('without V143_62: a daily email answers FEATURE_NOT_READY', nr.status === 503 && nr.json?.errorCode === 'FEATURE_NOT_READY', `${nr.status}`)
    const wk2 = await owner.call('/v1/reports/schedules', 'POST', { report: 'headcount', companyId: company, frequency: 'WEEKLY', dayOfWeek: 1, recipientIds: [hrmUser], active: false })
    if (wk2.json?.id) fx.schedules.push(wk2.json.id)
    check('without V143_62: a weekly email still works', wk2.status === 201 && wk2.json?.sendHour == null, `${wk2.status}`)
    check('without V143_62: the list still loads', (await owner.call('/v1/reports/schedules')).status === 200)
    if (wk2.json?.id) check('without V143_62: the weekly email can be deleted', (await owner.call(`/v1/reports/schedules/${wk2.json.id}`, 'DELETE')).status === 204)
  } finally {
    sql('ALTER TABLE hrms.report_schedules RENAME COLUMN send_hour_qa TO send_hour')
    allowNotReady = false
  }
}

// ── UI phase ────────────────────────────────────────────────────────────────
async function uiPhase() {
  const { uiChecks } = await import('./live-rd-p-reports-ui.mjs')
  await uiChecks({ base, company, today, sql, num, check, shots, employedSql })
}

try {
  if (phase === 'api' || phase === 'all') await apiPhase()
  if (phase === 'ui' || phase === 'all') await uiPhase()
} catch (e) {
  check('run finished', false, String(e.stack || e.message || e).slice(0, 400))
} finally {
  cleanup()
  check('no unexpected 5xx or FEATURE_NOT_READY', surprises.length === 0, surprises.slice(0, 3).join(' | '))
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
