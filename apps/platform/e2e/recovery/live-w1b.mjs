// Live API check of the payroll core (w1b, V143_11, 25 Sep 2026). No browser.
//
//  - Payroll Settings: LWF months saved, the cycle end day follows the start day.
//  - Salary components: a fixed monthly amount, "show on payslip", switching a
//    component off; built-in components can't be switched off; duplicates 409.
//  - A test run for Jun 2031 on a 26th cycle: pay period 26 May – 25 Jun, pay
//    date and working days stored, the employee's own weekly off used.
//  - Processing adds the approved PLI award as "Performance incentive", LWF
//    (June is an LWF month), the fixed earning and deduction; hidden components
//    fold into "Other deductions" on the payslip.
//  - PLI is never paid twice: the award payout refuses an award a run includes;
//    lock marks it paid, reopen reverts it.
//  - Per-component totals, statutory dues, the employee's own payslip (404 for
//    anyone else's run), names on the run's activity.
//  - Employees (and managers) are refused the admin endpoints.
// Everything it creates is removed and the settings are put back.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w1b.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const PSQL = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const num = (v) => Number(v || 0)
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.005

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const type = res.headers.get('content-type') || ''
    if (type.includes('application/pdf')) return { status: res.status, json: null, type, size: (await res.arrayBuffer()).byteLength }
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, type }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const stamp = Date.now().toString().slice(-6)
const Y = 2031, M = 6
const READER_EMAIL = 'reader@unifiedtree.demo'
const cleanup = { runId: null, awardId: null, components: [], readerOff: undefined, readerId: null, settings: null }
let owner

try {
  owner = await login('owner@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login(READER_EMAIL)
  const mgr = await login('mgr@unifiedtree.demo')

  const readerId = sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and email='${READER_EMAIL}'`)
  cleanup.readerId = readerId
  const company = sql(`select company_id from hrms.employees where id='${readerId}'`)
  check('fixture: the reader has a current salary structure', sql(`select count(*) from payroll.employee_salary_structures where employee_id='${readerId}' and is_current is true`) === '1')
  const clash = sql(`select count(*) from payroll.runs where tenant_id='${tenant}' and company_id='${company}' and period_year=${Y} and period_month=${M}`)
  if (clash !== '0') throw new Error(`a ${Y}-${M} run already exists for the company; not touching it`)

  // ── 1. Payroll Settings ────────────────────────────────────────────────────
  const orig = await owner.call('/v1/payroll/settings')
  check('settings: read (owner)', orig.status === 200, `status=${orig.status}`)
  cleanup.settings = orig.json
  const put = await owner.call('/v1/payroll/settings', 'PUT', { ...orig.json, payrollCycleStartDay: 26, payrollCycleEndDay: 3, salaryProcessingDay: 28, lwfEnabled: true, lwfEmployeeAmount: 25, lwfEmployerAmount: 75, lwfDeductionMonths: [12, 6] })
  check('settings: save cycle 26th, LWF ₹25/₹75 in June and December', put.status === 200 && JSON.stringify(put.json?.lwfDeductionMonths) === '[6,12]', `status=${put.status} months=${JSON.stringify(put.json?.lwfDeductionMonths)}`)
  check('settings: DB has the months and an end day of the 25th (the day before the start)', sql(`select payroll_cycle_start_day||'|'||payroll_cycle_end_day||'|'||array_to_string(lwf_deduction_months,',') from payroll.settings where tenant_id='${tenant}'`) === '26|25|6,12')
  const badMonths = await owner.call('/v1/payroll/settings', 'PUT', { ...put.json, lwfDeductionMonths: [13] })
  check('settings: a month outside 1–12 is refused', badMonths.status >= 400 && badMonths.status < 500, `status=${badMonths.status}`)
  const readerSettings = await reader.call('/v1/payroll/settings', 'PUT', { ...put.json })
  check('settings: an employee can’t change them (403)', readerSettings.status === 403, `status=${readerSettings.status}`)

  // ── 2. Salary components ───────────────────────────────────────────────────
  const meal = `QAMEAL${stamp}`, canteen = `QACANT${stamp}`, off = `QAOFF${stamp}`
  const mk = (code, name, category, amount, extra = {}) => ({ code, name, category, isStatutory: false, isTaxable: category === 'EARNING', computationType: 'FIXED', percentValue: null, displayOrder: 100, amount, ...extra })
  let r = await owner.call('/v1/payroll/components', 'POST', mk(meal, 'QA meal allowance', 'EARNING', 1500))
  cleanup.components.push(meal)
  check('components: add a fixed ₹1,500 earning', r.status === 201 && sql(`select amount from payroll.salary_components where tenant_id='${tenant}' and code='${meal}'`) === '1500.00', `status=${r.status}`)
  r = await owner.call('/v1/payroll/components', 'POST', mk(canteen, 'QA canteen', 'DEDUCTION', 300, { showOnPayslip: false }))
  cleanup.components.push(canteen)
  check('components: add a fixed ₹300 deduction hidden from payslips', r.status === 201 && sql(`select amount||'|'||show_on_payslip from payroll.salary_components where tenant_id='${tenant}' and code='${canteen}'`) === '300.00|f', `status=${r.status}`)
  r = await owner.call('/v1/payroll/components', 'POST', mk(off, 'QA switched off', 'EARNING', 700))
  cleanup.components.push(off)
  const offId = sql(`select id from payroll.salary_components where tenant_id='${tenant}' and code='${off}'`)
  r = await owner.call(`/v1/payroll/components/${offId}`, 'PUT', mk(off, 'QA switched off', 'EARNING', 700, { isActive: false }))
  check('components: switch a component off', r.status === 204 && sql(`select is_active from payroll.salary_components where id='${offId}'`) === 'f', `status=${r.status}`)
  r = await owner.call('/v1/payroll/components', 'POST', mk(meal.toLowerCase(), 'Duplicate', 'EARNING', 1))
  check('components: a duplicate code is refused (409)', r.status === 409, `status=${r.status}`)
  const basicId = sql(`select id from payroll.salary_components where tenant_id='${tenant}' and code='BASIC'`)
  r = await owner.call(`/v1/payroll/components/${basicId}`, 'PUT', { code: 'BASIC', name: 'Basic Salary', category: 'EARNING', isStatutory: false, isTaxable: true, computationType: 'FORMULA', percentValue: null, displayOrder: 10, isActive: false })
  check('components: a built-in component can’t be switched off', r.status === 422 && r.json?.errorCode === 'SYSTEM_COMPONENT_ACTIVE_LOCKED' && sql(`select is_active from payroll.salary_components where id='${basicId}'`) === 't', `status=${r.status} ${r.json?.errorCode}`)
  const ptId = sql(`select id from payroll.salary_components where tenant_id='${tenant}' and code='PT'`)
  if (ptId) {
    r = await owner.call(`/v1/payroll/components/${ptId}`, 'PUT', { code: 'PT', name: 'Professional Tax', category: 'DEDUCTION', isStatutory: true, isTaxable: false, computationType: 'STATUTORY', percentValue: null, displayOrder: 90, amount: 100 })
    check('components: a statutory component can’t take an amount', r.status === 422 && r.json?.errorCode === 'COMPONENT_AMOUNT_NOT_ALLOWED', `status=${r.status} ${r.json?.errorCode}`)
  }
  r = await reader.call('/v1/payroll/components', 'POST', mk(`QAX${stamp}`, 'Nope', 'EARNING', 1))
  check('components: an employee can’t add one (403)', r.status === 403, `status=${r.status}`)
  const list = await owner.call('/v1/payroll/components')
  const byCode = new Map((list.json || []).map((c) => [c.code, c]))
  check('components: the list returns amount, showOnPayslip and isActive', num(byCode.get(meal)?.amount) === 1500 && byCode.get(canteen)?.showOnPayslip === false && byCode.get(off)?.isActive === false)
  check('components: PLI and LWF built-ins exist', ['PLI_INCENTIVE', 'LWF_EMPLOYEE', 'LWF_EMPLOYER'].every((c) => byCode.has(c)))

  // ── 3. The structure preview uses the same rules ───────────────────────────
  const st = await owner.call(`/v1/payroll/structures/employee/${readerId}`)
  const earnCodes = (st.json?.earnings || []).map((l) => l.componentCode), dedCodes = (st.json?.deductions || []).map((l) => l.componentCode)
  check('structure preview: adds the fixed earning and deduction, not the switched-off one', earnCodes.includes(meal) && dedCodes.includes(canteen) && !earnCodes.includes(off), `earnings=${earnCodes.join(',')} deductions=${dedCodes.join(',')}`)

  // ── 4. The reader works a 6-day week (own weekly off: Sunday) ──────────────
  cleanup.readerOff = sql(`select coalesce(weekly_off_days,'<null>') from hrms.employees where id='${readerId}'`)
  sql(`update hrms.employees set weekly_off_days='7' where id='${readerId}'`)

  // ── 5. An approved PLI award for the reader ────────────────────────────────
  r = await owner.call('/v1/pli/awards', 'POST', { employeeId: readerId, companyId: company, planName: `QA PLI ${stamp}`, period: `${Y}-06`, amount: 4321 })
  cleanup.awardId = r.json?.id || null
  check('PLI: award proposed', r.status === 201 && !!cleanup.awardId, `status=${r.status}`)
  r = await owner.call(`/v1/pli/awards/${cleanup.awardId}/decision`, 'POST', { approved: true })
  check('PLI: approved, with the approval time recorded', r.status === 200 && sql(`select (approved_at is not null)::text from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === 'true', `status=${r.status}`)

  // ── 6. Create the run ──────────────────────────────────────────────────────
  r = await reader.call('/v1/payroll/runs', 'POST', { companyId: company, periodMonth: M, periodYear: Y })
  check('run: an employee can’t create one (403)', r.status === 403, `status=${r.status}`)
  r = await owner.call('/v1/payroll/runs', 'POST', { companyId: company, periodMonth: M, periodYear: Y })
  cleanup.runId = r.json?.id || null
  const runId = cleanup.runId
  check('run: created', r.status === 201 && !!runId, `status=${r.status}`)
  const weekend = sql(`select coalesce(array_to_string(weekend_days, ','), '') from settings.hr_configuration where company_id='${company}'`).split(',').filter(Boolean).map(Number)
  const companyOff = new Set(weekend.length ? weekend : [6, 7])
  const holidays = new Set(sql(`select holiday_date from settings.holiday_calendar where company_id='${company}' and is_active and holiday_date between '2031-05-26' and '2031-06-25' union select holiday_date from leave_mgmt.holiday_calendars where company_id='${company}' and holiday_date between '2031-05-26' and '2031-06-25'`).split(/\s+/).filter(Boolean))
  const workingDays = (off) => { let n = 0; for (let d = new Date(Date.UTC(2031, 4, 26)); d <= new Date(Date.UTC(2031, 5, 25)); d.setUTCDate(d.getUTCDate() + 1)) { const iso = d.toISOString().slice(0, 10), dow = d.getUTCDay() || 7; if (!off.has(dow) && !holidays.has(iso)) n++ } return n }
  check('run: pay period 26 May – 25 Jun, pay date 28 Jun, company working days stored', sql(`select period_start||'|'||period_end||'|'||pay_date||'|'||working_days from payroll.runs where id='${runId}'`) === `2031-05-26|2031-06-25|2031-06-28|${workingDays(companyOff)}`,
    sql(`select period_start||'|'||period_end||'|'||pay_date||'|'||working_days from payroll.runs where id='${runId}'`))
  check('run: the API returns the pay date, working days and who created it', r.json?.payDate === '2031-06-28' && r.json?.workingDays === workingDays(companyOff) && !!r.json?.createdByName, `${r.json?.payDate} ${r.json?.workingDays} ${r.json?.createdByName}`)

  // ── 7. Process ─────────────────────────────────────────────────────────────
  r = await reader.call(`/v1/payroll/runs/${runId}/process`, 'POST')
  check('process: an employee can’t (403)', r.status === 403, `status=${r.status}`)
  // Every approved, unpaid award for the reader is paid by the run (ours plus any already waiting).
  const expectedPli = num(sql(`select coalesce(sum(amount),0) from pli_mgmt.pli_awards where employee_id='${readerId}' and company_id='${company}' and status='APPROVED' and payroll_run_id is null`))
  r = await owner.call(`/v1/payroll/runs/${runId}/process`, 'POST')
  check('process: done', r.status === 200 && r.json?.status === 'PROCESSING' && !!r.json?.processedByName, `status=${r.status} ${r.json?.errorCode || ''} ${r.json?.message || ''}`)
  const line = (emp, code) => sql(`select coalesce(sum(amount),0) from payroll.payslip_lines where run_id='${runId}' and employee_id='${emp}' and component_code='${code}'`)
  check('PLI: the award is a "Performance incentive" line on the reader’s payslip', expectedPli >= 4321 && near(line(readerId, 'PLI_INCENTIVE'), expectedPli) && sql(`select component_name from payroll.payslip_lines where run_id='${runId}' and component_code='PLI_INCENTIVE' limit 1`) === 'Performance incentive', `line=${line(readerId, 'PLI_INCENTIVE')} expected=${expectedPli}`)
  check('PLI: the award is reserved for this run, still approved', sql(`select status||'|'||payroll_run_id from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === `APPROVED|${runId}`)
  r = await owner.call(`/v1/pli/awards/${cleanup.awardId}/pay`, 'POST')
  check('PLI: the separate payout refuses it (no double pay)', r.status === 422 && r.json?.errorCode === 'PLI_IN_PAYROLL' && sql(`select status from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === 'APPROVED', `status=${r.status} ${r.json?.errorCode}`)
  const people = Number(sql(`select count(distinct employee_id) from payroll.payslip_lines where run_id='${runId}'`))
  check('LWF: June run deducts ₹25 and records ₹75 employer share for everyone', people > 0 && sql(`select count(*) from payroll.payslip_lines where run_id='${runId}' and component_code='LWF_EMPLOYEE' and amount=25`) === String(people) && sql(`select count(*) from payroll.payslip_lines where run_id='${runId}' and component_code='LWF_EMPLOYER' and amount=75`) === String(people), `${people} people`)
  check('fixed: ₹1,500 earning paid (full month) and ₹300 deduction taken', line(readerId, meal) === '1500.00' && line(readerId, canteen) === '300.00', `meal=${line(readerId, meal)} canteen=${line(readerId, canteen)}`)
  check('fixed: the switched-off component isn’t paid', sql(`select count(*) from payroll.payslip_lines where run_id='${runId}' and component_code='${off}'`) === '0')
  const log = JSON.parse(sql(`select computation_log::text from payroll.run_lop_days where run_id='${runId}' and employee_id='${readerId}'`) || '{}')
  check('weekly off: the reader’s own 6-day week is used (Sunday only) and working days follow it', JSON.stringify(log.weeklyOffDays) === '[7]' && log.workingDays === workingDays(new Set([7])) && log.totalCalendar === 31, `off=${JSON.stringify(log.weeklyOffDays)} working=${log.workingDays} total=${log.totalCalendar}`)
  check('run: company working days stored after processing', sql(`select working_days from payroll.runs where id='${runId}'`) === String(workingDays(companyOff)))

  // ── 8. Per-component totals ────────────────────────────────────────────────
  r = await fin.call(`/v1/payroll/runs/${runId}/component-totals`)
  const dbTotals = new Map(sql(`select component_code||'='||sum(amount) from payroll.payslip_lines where run_id='${runId}' group by component_code`).split(/\s+/).filter(Boolean).map((s) => s.split('=')))
  check('totals: one row per component, matching the payslips', r.status === 200 && r.json?.length === dbTotals.size && r.json.every((t) => near(t.amount, dbTotals.get(t.code))), `status=${r.status} rows=${r.json?.length} db=${dbTotals.size}`)
  for (const [who, u] of [['employee', reader], ['department manager', mgr]]) {
    const x = await u.call(`/v1/payroll/runs/${runId}/component-totals`)
    check(`totals: a ${who} is refused (403)`, x.status === 403, `status=${x.status}`)
  }

  // ── 9. Payslip (admin view) folds hidden components ────────────────────────
  r = await owner.call(`/v1/payroll/runs/${runId}/employees/${readerId}/payslip`)
  const dedNames = (r.json?.deductions || []).map((l) => l.name), earnNames = (r.json?.earnings || []).map((l) => l.name)
  check('payslip: hidden deduction prints as "Other deductions"; the incentive prints', r.status === 200 && dedNames.includes('Other deductions') && !dedNames.includes('QA canteen') && earnNames.includes('Performance incentive') && r.json?.totalDays === 31, `deductions=${dedNames.join(',')}`)
  check('payslip: lines still add up to the totals', r.status === 200 && near((r.json.deductions || []).reduce((a, l) => a + num(l.amount), 0), r.json.totalDeductions) && near((r.json.earnings || []).reduce((a, l) => a + num(l.amount), 0), r.json.gross))
  r = await reader.call(`/v1/payroll/payslips/me/${runId}`)
  check('own payslip: not visible before the run is locked (404)', r.status === 404, `status=${r.status}`)

  // ── 10. Lock ───────────────────────────────────────────────────────────────
  r = await owner.call(`/v1/payroll/runs/${runId}/lock`, 'POST')
  check('lock: done, with who locked it', r.status === 200 && r.json?.status === 'LOCKED' && !!r.json?.lockedByName, `status=${r.status}`)
  check('PLI: locking marks the award paid through payroll', sql(`select status||'|'||payroll_run_id||'|'||(paid_at is not null) from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === `PAID|${runId}|true`)
  r = await owner.call(`/v1/pli/awards/${cleanup.awardId}/pay`, 'POST')
  check('PLI: paying it again is refused', r.status === 422 && r.json?.errorCode === 'PLI_IN_PAYROLL', `status=${r.status}`)
  r = await owner.call('/v1/pli/awards?size=200')
  const aw = (r.json?.content || []).find((a) => a.id === cleanup.awardId)
  check('PLI: the award list names the payroll month', aw?.payrollPeriod === 'Jun 2031' && aw?.status === 'PAID', `${aw?.payrollPeriod} ${aw?.status}`)
  r = await reader.call('/v1/pli/my?size=200')
  check('PLI: the employee sees which payroll paid it', (r.json?.content || []).some((a) => a.id === cleanup.awardId && a.payrollPeriod === 'Jun 2031'), `status=${r.status}`)

  // ── 11. The employee's own payslip ─────────────────────────────────────────
  r = await reader.call(`/v1/payroll/payslips/me/${runId}`)
  const net = num(sql(`select sum(case when category in ('EARNING','REIMBURSEMENT') then amount when category='DEDUCTION' then -amount else 0 end) from payroll.payslip_lines where run_id='${runId}' and employee_id='${readerId}'`))
  check('own payslip: the reader gets their lines', r.status === 200 && r.json?.employeeId === readerId && near(r.json?.netPay, net) && (r.json?.earnings || []).some((l) => l.name === 'Performance incentive'), `status=${r.status} net=${r.json?.netPay} db=${net}`)
  r = await mgr.call(`/v1/payroll/payslips/me/${runId}`)
  check('own payslip: someone not in the run gets 404', r.status === 404, `status=${r.status}`)
  r = await reader.call(`/v1/payroll/payslips/me/${randomUUID()}`)
  check('own payslip: an unknown run is 404', r.status === 404, `status=${r.status}`)
  r = await reader.call(`/v1/payroll/payslips/me/${runId}.pdf`)
  check('own payslip: the PDF still downloads', r.status === 200 && (r.type || '').includes('pdf') && r.size > 500, `status=${r.status} ${r.type}`)

  // ── 12. Statutory dues ─────────────────────────────────────────────────────
  r = await fin.call('/v1/payroll/statutory-dues?months=24')
  const lwfDue = (r.json || []).find((d) => d.period === '2031-06' && d.scheme === 'LWF' && d.companyId === company)
  check('dues: LWF for Jun 2031 is added up from the locked run', r.status === 200 && near(lwfDue?.employeeShare, 25 * people) && near(lwfDue?.employerShare, 75 * people) && near(lwfDue?.total, 100 * people), `status=${r.status} ${JSON.stringify(lwfDue)}`)
  const pfDb = num(sql(`select coalesce(sum(amount),0) from payroll.payslip_lines where run_id='${runId}' and component_code in ('PF_EMPLOYEE','PF_EMPLOYER')`))
  const pfDue = (r.json || []).find((d) => d.period === '2031-06' && d.scheme === 'PF' && d.companyId === company)
  check('dues: PF matches the payslips and is due on the 15th of the next month', pfDb === 0 ? !pfDue : near(pfDue?.total, pfDb) && pfDue?.dueDate === '2031-07-15', `db=${pfDb} api=${pfDue?.total} due=${pfDue?.dueDate}`)
  for (const [who, u] of [['employee', reader], ['department manager', mgr]]) {
    const x = await u.call('/v1/payroll/statutory-dues')
    check(`dues: a ${who} is refused (403)`, x.status === 403, `status=${x.status}`)
  }

  // ── 13. Reopen ─────────────────────────────────────────────────────────────
  r = await owner.call(`/v1/payroll/runs/${runId}/reopen`, 'POST', { reason: 'QA w1b check' })
  check('reopen: done', r.status === 200 && r.json?.status === 'DRAFT', `status=${r.status}`)
  check('PLI: reopening puts the award back to approved (unpaid), still reserved', sql(`select status||'|'||payroll_run_id||'|'||(paid_at is null) from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === `APPROVED|${runId}|true`)
  r = await owner.call(`/v1/pli/awards/${cleanup.awardId}/pay`, 'POST')
  check('PLI: still can’t be paid outside payroll while a run holds it', r.status === 422 && r.json?.errorCode === 'PLI_IN_PAYROLL', `status=${r.status}`)
} catch (e) {
  check('run without errors', false, e.message)
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  try {
    const run = cleanup.runId
    if (run) {
      // Anything the run reserved or paid goes back to approved and unreserved.
      sql(`update pli_mgmt.pli_awards set status='APPROVED', paid_at=null, payroll_run_id=null where payroll_run_id='${run}'`)
      sql(`delete from payroll.payslip_lines where run_id='${run}'`)
      sql(`delete from payroll.run_lop_days where run_id='${run}'`)
      sql(`delete from payroll.runs where id='${run}'`)
    }
    if (cleanup.awardId) sql(`delete from pli_mgmt.pli_awards where id='${cleanup.awardId}'`)
    for (const code of cleanup.components) sql(`delete from payroll.salary_components where tenant_id='${tenant}' and code='${code}'`)
    if (cleanup.readerId && cleanup.readerOff !== undefined) sql(`update hrms.employees set weekly_off_days=${cleanup.readerOff === '<null>' ? 'null' : `'${cleanup.readerOff}'`} where id='${cleanup.readerId}'`)
    if (cleanup.settings && owner) {
      const back = await owner.call('/v1/payroll/settings', 'PUT', cleanup.settings)
      const s = cleanup.settings
      check('cleanup: settings put back', back.status === 200 && sql(`select payroll_cycle_start_day||'|'||lwf_enabled||'|'||array_to_string(lwf_deduction_months,',') from payroll.settings where tenant_id='${tenant}'`) === `${s.payrollCycleStartDay}|${s.lwfEnabled ? 't' : 'f'}|${(s.lwfDeductionMonths || [6, 12]).join(',')}`)
    }
    check('cleanup: nothing left behind', (!cleanup.runId || sql(`select count(*) from payroll.runs where id='${cleanup.runId}'`) === '0')
      && sql(`select count(*) from payroll.salary_components where tenant_id='${tenant}' and code like 'QA%${stamp}'`) === '0'
      && (!cleanup.awardId || sql(`select count(*) from pli_mgmt.pli_awards where id='${cleanup.awardId}'`) === '0'))
  } catch (e) {
    check('cleanup', false, e.message)
  }
  const passed = results.filter((x) => x.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
