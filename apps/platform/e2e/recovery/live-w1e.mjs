// Live API check for w1e (25 Sep 2026), against the LOCAL recovery backend:
//  1. One headquarters per company, enforced on the server (V143_14 index +
//     BranchService swap): create/update swap in one save, archive clears the
//     flag, restoring an old headquarters keeps the current one, and the
//     database refuses a second active headquarters.
//  2. Branches: ?includeArchived=true returns archived branches ("Inactive").
//  3. Fiscal year: HR Configuration reads and writes the company record.
//  4. Default probation: a new hire gets joining date + N months; 0 = confirmed.
//  5. Retirement due: /v1/hrms/retirements/due and the milestones list use the
//     company's retirement age; /alerts/run sends the 30- and 90-day alerts
//     once, to holders of hrms.retirement.alerts only.
//  6. Headcount workbook: totals match the database, names only (no ids),
//     employee list / gender only for the right permissions, past and future dates.
// Every role that must be refused is checked for 403. Everything created is
// removed and every setting is put back.
//
//   node e2e/recovery/live-w1e.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8097/api), RECOVERY_DB, RECOVERY_PASSWORD
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const HR_EMPLOYEE = '33333333-3333-3333-3333-333333333333'
const FIN_EMPLOYEE = '55555555-5555-5555-5555-555555555555'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const minusYears = (iso, n) => `${Number(iso.slice(0, 4)) - n}${iso.slice(4)}`

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const tag = randomUUID().slice(0, 6)
const today = istToday()
const created = { branches: [], employees: [] }
// Settings to put back.
const origHq = sql(`select coalesce(string_agg(id::text, ','), '') from org.branches where company_id='${company}' and is_headquarters and is_active`).split(',').filter(Boolean)
const origFiscal = sql(`select fiscal_year_start from org.companies where id='${company}'`)
const cfgRow = sql(`select coalesce(probation_period_months::text,'') || '|' || coalesce(retirement_age::text,'') from settings.hr_configuration where company_id='${company}'`)
const [origMonths, origAge] = cfgRow ? cfgRow.split('|') : [null, null]
// Anything the alert run writes from here on is removed at the end, whoever it is about.
const startedAt = sql('select now()')

try {
  const owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── 1. one headquarters per company ─────────────────────────────────────
  const hqOf = (id) => sql(`select is_headquarters::text || '|' || is_active::text from org.branches where id='${id}'`)
  const activeHqs = () => Number(sql(`select count(*) from org.branches where company_id='${company}' and is_headquarters and is_active`))
  const mk = async (name, hq) => {
    const r = await owner.call('/v1/hrms/branches', 'POST', { companyId: company, name, code: `W1E${tag}`.slice(0, 12).toUpperCase() + name.slice(-1), city: 'Pune', state: 'Maharashtra', isHeadquarters: hq })
    if (r.json?.id) created.branches.push(r.json.id)
    return r
  }
  const a = await mk(`QA w1e ${tag} A`, true)
  check('branch: create as headquarters (owner) → 201, flagged in DB', a.status === 201 && hqOf(a.json?.id) === 'true|true', `status=${a.status}`)
  const b = await mk(`QA w1e ${tag} B`, true)
  check('branch: a second headquarters steps the first down in the same save', b.status === 201 && hqOf(b.json?.id) === 'true|true' && hqOf(a.json?.id) === 'false|true' && activeHqs() === 1, `A=${hqOf(a.json?.id)} B=${hqOf(b.json?.id)} active HQs=${activeHqs()}`)
  const swap = await owner.call(`/v1/hrms/branches/${a.json?.id}`, 'PUT', { isHeadquarters: true })
  check('branch: PUT isHeadquarters swaps back in one call', swap.status === 200 && swap.json?.headquarters === true && hqOf(a.json?.id) === 'true|true' && hqOf(b.json?.id) === 'false|true' && activeHqs() === 1, `status=${swap.status}`)
  if (origHq.length) check('branch: the demo company’s previous headquarters was stepped down too', origHq.every((id) => hqOf(id).startsWith('false')))
  let dbRefused = false
  try { sql(`begin; update org.branches set is_headquarters = true where id in ('${a.json?.id}','${b.json?.id}'); rollback;`) } catch { dbRefused = true }
  check('branch: the database refuses two active headquarters (V143_14 index)', dbRefused)
  const mgrPut = await mgr.call(`/v1/hrms/branches/${b.json?.id}`, 'PUT', { isHeadquarters: true })
  check('branch: department manager cannot change branches (403)', mgrPut.status === 403 && hqOf(b.json?.id) === 'false|true', `status=${mgrPut.status}`)
  const readerPost = await reader.call('/v1/hrms/branches', 'POST', { companyId: company, name: `QA w1e ${tag} X`, isHeadquarters: true })
  if (readerPost.json?.id) created.branches.push(readerPost.json.id)
  check('branch: employee cannot create branches (403)', readerPost.status === 403, `status=${readerPost.status}`)

  // ── 2. archive, include-archived listing, restore ───────────────────────
  const arch = await owner.call(`/v1/hrms/branches/${a.json?.id}`, 'DELETE')
  check('branch: archiving the headquarters clears its flag', arch.status === 204 && hqOf(a.json?.id) === 'false|false', `status=${arch.status} db=${hqOf(a.json?.id)}`)
  const withArchived = await owner.call(`/v1/hrms/branches?companyId=${company}&includeArchived=true`)
  const plain = await owner.call(`/v1/hrms/branches?companyId=${company}`)
  const archivedRow = (withArchived.json || []).find((x) => x.id === a.json?.id)
  check('branches: includeArchived=true returns the archived branch (active=false)', withArchived.status === 200 && archivedRow && archivedRow.active === false)
  check('branches: the default list still hides it', plain.status === 200 && !(plain.json || []).some((x) => x.id === a.json?.id))
  const allArchived = await owner.call('/v1/hrms/branches?includeArchived=true')
  check('branches: includeArchived works without a company too', allArchived.status === 200 && (allArchived.json || []).some((x) => x.id === a.json?.id))
  const restore = await owner.call(`/v1/hrms/branches/${a.json?.id}`, 'PUT', { isActive: true })
  check('branch: restore (PUT isActive=true) brings it back as an ordinary branch', restore.status === 200 && hqOf(a.json?.id) === 'false|true', `db=${hqOf(a.json?.id)}`)
  // An old headquarters archived before V143_14 still carries the flag; restoring it keeps the current one.
  await owner.call(`/v1/hrms/branches/${b.json?.id}`, 'PUT', { isHeadquarters: true })
  sql(`update org.branches set is_active = false, is_headquarters = true where id='${a.json?.id}'`)
  const restoreOld = await owner.call(`/v1/hrms/branches/${a.json?.id}`, 'PUT', { isActive: true })
  check('branch: restoring an old headquarters keeps the current one', restoreOld.status === 200 && hqOf(a.json?.id) === 'false|true' && hqOf(b.json?.id) === 'true|true', `A=${hqOf(a.json?.id)} B=${hqOf(b.json?.id)}`)

  // ── 3. fiscal year: the company record ──────────────────────────────────
  const fy = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { fiscalYearStart: 'january' })
  check('fiscal year: HR Configuration saves to org.companies', fy.status === 200 && fy.json?.fiscalYearStart === 'JANUARY' && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JANUARY', `status=${fy.status} db=${sql(`select fiscal_year_start from org.companies where id='${company}'`)}`)
  const fyGet = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`)
  const coGet = await owner.call(`/v1/hrms/companies/${company}`)
  check('fiscal year: HR Configuration and the company read the same value', fyGet.json?.fiscalYearStart === 'JANUARY' && coGet.json?.fiscalYearStart === 'JANUARY', `${fyGet.json?.fiscalYearStart} / ${coGet.json?.fiscalYearStart}`)
  const bad = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { fiscalYearStart: 'Q1' })
  check('fiscal year: a non-month is refused and nothing changes', bad.status >= 400 && bad.status < 500 && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JANUARY', `status=${bad.status}`)
  const coName = sql(`select name from org.companies where id='${company}'`)
  const coBad = await owner.call(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, fiscalYearStart: 'Apr' })
  check('fiscal year: the Companies API refuses a non-month too', coBad.status >= 400 && coBad.status < 500 && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JANUARY', `status=${coBad.status}`)
  const coLower = await owner.call(`/v1/hrms/companies/${company}`, 'PUT', { name: coName, fiscalYearStart: 'july' })
  check('fiscal year: the Companies API stores the month in the same form', coLower.status === 200 && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JULY', `status=${coLower.status}`)
  const coBack = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { fiscalYearStart: 'JANUARY' })
  check('fiscal year: HR Configuration sees the Companies change and can set it back', coBack.status === 200 && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JANUARY', `status=${coBack.status}`)
  const unrelated = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { retirementAge: 25 })
  check('HR config: a retirement age outside 30-100 is refused', unrelated.status >= 400 && unrelated.status < 500, `status=${unrelated.status}`)
  for (const [who, u] of [['HR manager', hrm], ['finance', fin], ['employee', reader]]) {
    const r = await u.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { fiscalYearStart: 'JULY' })
    check(`fiscal year: ${who} cannot change it (403)`, r.status === 403 && sql(`select fiscal_year_start from org.companies where id='${company}'`) === 'JANUARY', `status=${r.status}`)
  }

  // ── 4. default probation ────────────────────────────────────────────────
  const cfg = await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { probationPeriodMonths: 3, retirementAge: 58 })
  check('HR config: probation 3 months, retirement age 58 saved', cfg.status === 200 && cfg.json?.probationPeriodMonths === 3 && cfg.json?.retirementAge === 58, `status=${cfg.status}`)
  const hire = async (label, doj) => {
    const r = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'QA', lastName: `W1e${label}${tag}`, email: `qa.w1e.${label.toLowerCase()}.${tag}@unifiedtree.demo`, dateOfJoining: doj })
    if (r.json?.id) created.employees.push(r.json.id)
    return r
  }
  const e1 = await hire('One', '2026-10-01')
  const e1db = e1.json?.id ? sql(`select employment_status || '|' || coalesce(probation_end_date::text,'') from hrms.employees where id='${e1.json.id}'`) : ''
  check('probation: new hire ends probation on joining + 3 months', e1.status === 201 && e1db === 'PROBATION|2027-01-01' && e1.json?.probationEndDate === '2027-01-01', `status=${e1.status} db=${e1db}`)
  await owner.call(`/v1/settings/hr-configuration?companyId=${company}`, 'PUT', { probationPeriodMonths: 0 })
  const e2 = await hire('Two', '2026-10-01')
  const e2db = e2.json?.id ? sql(`select employment_status || '|' || coalesce(probation_end_date::text,'') || '|' || coalesce(confirmation_date::text,'') from hrms.employees where id='${e2.json.id}'`) : ''
  check('probation: 0 months means the new hire starts confirmed', e2.status === 201 && e2db === 'ACTIVE||2026-10-01', `db=${e2db}`)
  const mgrHire = await mgr.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'QA', lastName: `W1eMgr${tag}`, email: `qa.w1e.mgr.${tag}@unifiedtree.demo` })
  if (mgrHire.json?.id) created.employees.push(mgrHire.json.id)
  check('probation: department manager cannot add people (403)', mgrHire.status === 403, `status=${mgrHire.status}`)

  // ── 5. retirement due + alerts ──────────────────────────────────────────
  const r1 = addDays(today, 20), r2 = addDays(today, 60)
  const p1 = await owner.call(`/v1/hrms/employees/${e1.json?.id}`, 'PUT', { dateOfBirth: minusYears(r1, 58) })
  const p2 = await owner.call(`/v1/hrms/employees/${e2.json?.id}`, 'PUT', { dateOfBirth: minusYears(r2, 58) })
  check('retirement fixture: dates of birth set', p1.status === 200 && p2.status === 200, `${p1.status}/${p2.status}`)
  const due30 = await owner.call(`/v1/hrms/retirements/due?days=30&companyId=${company}`)
  const row1 = (due30.json || []).find((x) => x.employeeId === e1.json?.id)
  check('retirement due: 30-day window lists the person at the company’s age (58)', due30.status === 200 && row1 && row1.retirementAge === 58 && row1.retirementDate === r1 && row1.daysLeft === 20, JSON.stringify(row1 || {}).slice(0, 160))
  check('retirement due: someone 60 days away is outside the 30-day window', !(due30.json || []).some((x) => x.employeeId === e2.json?.id))
  const due90 = await hrm.call(`/v1/hrms/retirements/due?days=90`)
  check('retirement due: HR sees both within 90 days (all companies)', due90.status === 200 && [e1.json?.id, e2.json?.id].every((id) => (due90.json || []).some((x) => x.employeeId === id)), `status=${due90.status}`)
  for (const [who, u] of [['department manager', mgr], ['employee', reader]]) {
    const r = await u.call(`/v1/hrms/retirements/due?days=90`)
    check(`retirement due: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
  }
  const ms = await reader.call('/v1/hrms/milestones?retirementMonths=3')
  const msRow = (ms.json?.retirements || []).find((x) => x.employeeId === e1.json?.id)
  check('milestones: retirements use the company’s age too', ms.status === 200 && msRow && msRow.years === 58 && msRow.date === r1, JSON.stringify(msRow || {}).slice(0, 120))

  const permExists = sql(`select count(*) from rbac.permissions where code='hrms.retirement.alerts'`) === '1'
  check('alerts: hrms.retirement.alerts exists (V143_14 applied)', permExists)
  check('alerts: owner, super admin and HR hold the permission; finance does not', owner.perms.includes('hrms.retirement.alerts') && admin.perms.includes('hrms.retirement.alerts') && hrm.perms.includes('hrms.retirement.alerts') && !fin.perms.includes('hrms.retirement.alerts'))
  for (const [who, u] of [['finance', fin], ['department manager', mgr], ['employee', reader]]) {
    const r = await u.call('/v1/hrms/retirements/alerts/run', 'POST')
    check(`alerts: ${who} cannot run them (403)`, r.status === 403, `status=${r.status}`)
  }
  const run = await hrm.call('/v1/hrms/retirements/alerts/run', 'POST')
  const logOf = (id) => sql(`select coalesce(string_agg(kind || '@' || occurred_on::text, ','), '') from notif.milestone_reminder_log where employee_id='${id}'`)
  check('alerts: run sends one per person', run.status === 200 && run.json?.sent >= 2, `status=${run.status} sent=${run.json?.sent}`)
  check('alerts: 20 days out → the 30-day alert, logged against the retirement date', logOf(e1.json?.id) === `RETIREMENT_30@${r1}`, logOf(e1.json?.id))
  check('alerts: 60 days out → the 90-day alert', logOf(e2.json?.id) === `RETIREMENT_90@${r2}`, logOf(e2.json?.id))
  const notifs = (id) => sql(`select coalesce(string_agg(user_id::text, ','), '') from notif.notifications where type='RETIREMENT_DUE' and data->>'employeeId'='${id}'`).split(',').filter(Boolean)
  const to1 = notifs(e1.json?.id)
  check('alerts: HR got a RETIREMENT_DUE notification; finance and the person did not', to1.includes(HR_EMPLOYEE) && !to1.includes(FIN_EMPLOYEE) && !to1.includes(e1.json?.id), `recipients=${to1.length}`)
  const title = sql(`select title from notif.notifications where type='RETIREMENT_DUE' and data->>'employeeId'='${e1.json?.id}' limit 1`)
  check('alerts: the notification names the person and the days left', /retires in 20 days/.test(title) && !/UnifiedTree/i.test(title), title)
  const again = await owner.call('/v1/hrms/retirements/alerts/run', 'POST')
  check('alerts: running again sends nothing new', again.status === 200 && again.json?.sent === 0 && notifs(e1.json?.id).length === to1.length, `sent=${again.json?.sent}`)

  // ── 6. headcount workbook ───────────────────────────────────────────────
  const wbUrl = (asOf) => `/v1/reports/headcount/workbook?companyId=${company}${asOf ? `&asOf=${asOf}` : ''}`
  const wb = await owner.call(wbUrl(today))
  const dbTotal = Number(sql(`select count(*) from hrms.employees where company_id='${company}' and is_active and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED')`))
  const t = wb.json?.totals || {}
  check('workbook: owner gets it (200) for the company, as of today', wb.status === 200 && wb.json?.companyName === sql(`select name from org.companies where id='${company}'`) && wb.json?.asOf === today, `status=${wb.status}`)
  check('workbook: total matches the database', t.total === dbTotal, `${t.total} vs ${dbTotal}`)
  check('workbook: statuses add up to the total', t.active + t.probation + t.onNotice + t.suspended === t.total)
  const dbJoined = Number(sql(`select count(*) from hrms.employees where company_id='${company}' and coalesce(date_of_joining, (created_at at time zone 'Asia/Kolkata')::date) between date_trunc('month', date '${today}')::date and date '${today}'`))
  check('workbook: joined this month matches the database', t.joinedThisMonth === dbJoined, `${t.joinedThisMonth} vs ${dbJoined}`)
  check('workbook: department breakdown adds up', (wb.json?.byDepartment || []).reduce((n, g) => n + g.total, 0) === t.total)
  check('workbook: fiscal year comes from the company record', wb.json?.fiscalYear?.startMonth === 'JANUARY' && wb.json?.fiscalYear?.label === `FY ${today.slice(0, 4)}`, JSON.stringify(wb.json?.fiscalYear))
  check('workbook: no ids anywhere in the data', !UUID_RE.test(wb.text), (wb.text.match(UUID_RE) || [''])[0])
  const me1 = (wb.json?.employees || []).find((x) => x.name === `QA W1eOne${tag}`)
  check('workbook: employee list with readable names (owner has employee read)', wb.json?.employeesIncluded === true && me1 && me1.department === 'No department' && me1.status === 'On probation' && me1.probationEnds === '2027-01-01', JSON.stringify(me1 || {}).slice(0, 160))
  check('workbook: gender breakdown for a role with the diversity report', wb.json?.genderIncluded === true && Array.isArray(wb.json?.byGender))
  const wbFin = await fin.call(wbUrl(today))
  check('workbook: finance lead (headcount + employee read) gets it', wbFin.status === 200 && wbFin.json?.employeesIncluded === true, `status=${wbFin.status}`)
  const wbHr = await hrm.call(wbUrl())
  check('workbook: HR manager gets it, today by default', wbHr.status === 200 && wbHr.json?.asOf === today, `status=${wbHr.status}`)
  for (const [who, u] of [['department manager', mgr], ['employee', reader]]) {
    const r = await u.call(wbUrl(today))
    check(`workbook: ${who} is refused (403)`, r.status === 403, `status=${r.status}`)
  }
  const past = await owner.call(wbUrl('2026-01-01'))
  check('workbook: a past date is worked out from dates (future joiner not counted)', past.status === 200 && past.json?.pastDate === true && !(past.json?.employees || []).some((x) => x.name === `QA W1eOne${tag}`), `status=${past.status}`)
  const future = await owner.call(wbUrl('2099-01-01'))
  check('workbook: a future date is treated as today', future.status === 200 && future.json?.asOf === today, future.json?.asOf)
} catch (e) {
  check('run completed without an exception', false, String(e?.stack || e).split(/\r?\n/).slice(0, 3).join(' | '))
} finally {
  const cleanup = [
    `delete from notif.notifications where type='RETIREMENT_DUE' and created_at >= ${lit(startedAt)}`,
    `delete from notif.milestone_reminder_log where kind like 'RETIREMENT_%' and created_at >= ${lit(startedAt)}`,
    created.employees.length && `delete from notif.notifications where type='RETIREMENT_DUE' and data->>'employeeId' in (${created.employees.map(lit).join(',')})`,
    created.employees.length && `delete from notif.notifications where user_id in (${created.employees.map(lit).join(',')})`,
    created.employees.length && `delete from notif.milestone_reminder_log where employee_id in (${created.employees.map(lit).join(',')})`,
    created.employees.length && `delete from hrms.employees where id in (${created.employees.map(lit).join(',')}) and tenant_id='${tenant}'`,
    created.branches.length && `delete from org.branches where id in (${created.branches.map(lit).join(',')}) and tenant_id='${tenant}'`,
    origHq.length && `update org.branches set is_headquarters = true where id in (${origHq.map(lit).join(',')})`,
    `update org.companies set fiscal_year_start = ${lit(origFiscal)} where id='${company}'`,
    cfgRow ? `update settings.hr_configuration set probation_period_months = ${origMonths === '' ? 'NULL' : Number(origMonths)}, retirement_age = ${origAge === '' ? 'NULL' : Number(origAge)} where company_id='${company}'` : null,
  ].filter(Boolean)
  for (const q of cleanup) { try { sql(q) } catch (e) { console.log('cleanup failed:', q.slice(0, 80), String(e).split(/\r?\n/)[0]) } }
  const left = sql(`select (select count(*) from org.branches where name like 'QA w1e ${tag}%') + (select count(*) from hrms.employees where last_name like 'W1e%${tag}')`)
  check('cleanup: every branch and employee created is gone, settings put back', left === '0' && sql(`select fiscal_year_start from org.companies where id='${company}'`) === origFiscal, `left=${left}`)
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}
