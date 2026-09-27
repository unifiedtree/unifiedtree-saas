// Live API check of the payroll backend half of the redesign (P-PAY-CORE, BW-50–59).
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-pay-core-api.mjs   (through live-slot.sh)
//
// READ-ONLY on the seeded payroll runs: nothing is processed, locked or paid.
// It creates, and removes at the end:
//  - one DRAFT run for Dec 2029 (never processed), to see the month being prepared without figures
//  - one payslip question (reader asks, fin answers) and the notifications it sends
// The FEATURE_NOT_READY step renames the new table, only in ut_w3_dev, and always renames it back.
// Every other 503 FEATURE_NOT_READY, and any 5xx, is a failure.
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const q1 = (s) => s.replace(/'/g, "''")

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005

let notReadyAllowed = false
const unexpected = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500 && !(res.status === 503 && json?.errorCode === 'FEATURE_NOT_READY' && notReadyAllowed)) {
      unexpected.push(`${email} ${method} ${path} → ${res.status} ${json?.errorCode ?? ''}`)
    }
    return { status: res.status, json }
  }
  return { email, call, employeeId: d.employeeId }
}

const owner = await session('owner@unifiedtree.demo')
const hrm = await session('hrm@unifiedtree.demo')
const fin = await session('fin@unifiedtree.demo')
const mgr = await session('mgr@unifiedtree.demo')
const reader = await session('reader@unifiedtree.demo')
const everyone = { owner, hrm, fin, mgr, reader }
const readerId = reader.employeeId || '22222222-2222-2222-2222-222222222222'
const finId = fin.employeeId || '55555555-5555-5555-5555-555555555555'
const startedAt = sql('select now()')

let draftRunId = null, questionId = null, renamed = false
try {
  // ── Runs: employer contributions and the paid date (BW-53) ──────────────────
  const runs = await owner.call('/v1/payroll/runs')
  check('owner lists runs', runs.status === 200 && Array.isArray(runs.json) && runs.json.length > 0, `${runs.status}`)
  const list = runs.json || []
  check('every run has employerContributions and paidAt', list.every((r) => 'employerContributions' in r && 'paidAt' in r))
  check('only paid runs have a paid date', list.every((r) => (r.status === 'PAID') === (r.paidAt != null)),
    list.map((r) => `${r.periodYear}-${r.periodMonth} ${r.status} ${r.paidAt}`).join(' | '))
  const contribOk = list.every((r) => same(r.employerContributions,
    sql(`select coalesce(sum(amount),0) from payroll.payslip_lines where run_id='${r.id}' and category='EMPLOYER_CONTRIBUTION'`)))
  check('employer contributions add up the run\u2019s employer lines', contribOk)
  const locked = list.find((r) => r.status === 'LOCKED')
  const final = list.filter((r) => r.status === 'LOCKED' || r.status === 'PAID')
  // A run whose company has a run the month before (for the previous-period fields).
  const withPrev = list.find((r) => list.some((p) => p.companyId === r.companyId && p.status !== 'CANCELLED' && p.status !== 'DRAFT'
    && (p.periodYear * 12 + p.periodMonth) === (r.periodYear * 12 + r.periodMonth - 1)))
  check('fixtures: a locked run and a run with a previous month exist', locked && withPrev)

  // ── Run employees (BW-50) ───────────────────────────────────────────────────
  if (withPrev) {
    const emps = await hrm.call(`/v1/payroll/runs/${withPrev.id}/employees`)
    check('hrm reads a run\u2019s employees', emps.status === 200 && Array.isArray(emps.json), `${emps.status}`)
    const rows = emps.json || []
    const oldKeys = ['employeeId', 'employeeCode', 'employeeName', 'paidDays', 'lopDays', 'gross', 'deductions', 'netPay']
    const newKeys = ['department', 'branch', 'designation', 'dateOfJoining', 'previousGross', 'previousNet', 'changePercent', 'newJoiner', 'hasBankAccount', 'fnfInProgress', 'reviewReasons']
    check('employee rows keep their old fields and gain the new ones', rows.length > 0 && rows.every((r) => [...oldKeys, ...newKeys].every((k) => k in r)))
    const prevMonth = withPrev.periodMonth === 1 ? 12 : withPrev.periodMonth - 1
    const prevYear = withPrev.periodMonth === 1 ? withPrev.periodYear - 1 : withPrev.periodYear
    let prevOk = true, bankOk = true, deptOk = true, detail = ''
    for (const r of rows) {
      const prevNet = sql(`select coalesce(sum(l.amount) filter (where l.category in ('EARNING','REIMBURSEMENT')),0) - coalesce(sum(l.amount) filter (where l.category='DEDUCTION'),0)
        from payroll.runs p join payroll.payslip_lines l on l.run_id=p.id where p.company_id='${withPrev.companyId}' and p.period_year=${prevYear} and p.period_month=${prevMonth}
        and p.status in ('PROCESSING','LOCKED','PAID') and l.employee_id='${r.employeeId}' having count(*)>0`)
      const expPrev = prevNet === '' ? null : Number(prevNet)
      const expChange = expPrev ? Math.round(((Number(r.netPay) - expPrev) / Math.abs(expPrev)) * 1000) / 10 : null
      if (!((expPrev === null && r.previousNet === null) || same(r.previousNet, expPrev))) { prevOk = false; detail += ` prev ${r.employeeCode} ${r.previousNet}≠${expPrev}` }
      if (!((expChange === null && r.changePercent === null) || same(r.changePercent, expChange))) { prevOk = false; detail += ` change ${r.employeeCode} ${r.changePercent}≠${expChange}` }
      const bank = sql(`select count(*) from hrms.employee_bank_accounts where employee_id='${r.employeeId}' and is_primary and ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'`) !== '0'
      if (bank !== r.hasBankAccount) bankOk = false
      const dept = sql(`select coalesce(d.name,'') from hrms.employees e left join hrms.departments d on d.id=e.department_id where e.id='${r.employeeId}'`)
      if ((dept || null) !== (r.department ?? null)) deptOk = false
      const reasons = [...(Math.abs(Number(r.changePercent ?? 0)) > 10 ? ['VARIANCE'] : []), ...(!r.hasBankAccount ? ['MISSING_BANK'] : []), ...(r.fnfInProgress ? ['FNF_IN_PROGRESS'] : [])]
      if (JSON.stringify(reasons) !== JSON.stringify(r.reviewReasons)) { prevOk = false; detail += ` reasons ${r.employeeCode}` }
    }
    check('previous month, change and review reasons match the ledger', prevOk, detail || `${withPrev.periodYear}-${withPrev.periodMonth} vs ${prevYear}-${prevMonth}`)
    check('bank on file is the bank file\u2019s own test', bankOk)
    check('department comes from the employee record', deptOk)

    // ── Checks before you lock (BW-51) ──────────────────────────────────────
    const checks = await owner.call(`/v1/payroll/runs/${withPrev.id}/checks`)
    const known = ['VARIANCE', 'MISSING_BANK', 'PRORATED_JOINERS', 'FNF_IN_PROGRESS', 'SKIPPED', 'LOP']
    check('checks: a list of known checks, each counting its people', checks.status === 200 && Array.isArray(checks.json)
      && checks.json.every((c) => known.includes(c.key) && c.count === c.employeeIds.length && c.count > 0 && typeof c.text === 'string'
        && ['INFO', 'WARNING', 'CRITICAL'].includes(c.severity)), JSON.stringify(checks.json))
    const variance = (checks.json || []).find((c) => c.key === 'VARIANCE')
    const expectVariance = rows.filter((r) => r.changePercent !== null && Math.abs(Number(r.changePercent)) > 10).map((r) => r.employeeId).sort()
    check('checks: the variance check names exactly the people who changed more than 10%',
      JSON.stringify((variance?.employeeIds || []).slice().sort()) === JSON.stringify(expectVariance))
    const skippedCount = (await owner.call(`/v1/payroll/runs/${withPrev.id}/skipped`)).json?.length || 0
    const skippedCheck = (checks.json || []).find((c) => c.key === 'SKIPPED')
    check('checks: the skipped check matches the Skipped list', (skippedCheck?.count || 0) === skippedCount, `${skippedCheck?.count || 0} vs ${skippedCount}`)
  }

  // ── Statutory dues from one run (BW-52) ─────────────────────────────────────
  for (const r of final.slice(0, 2)) {
    const dues = await owner.call(`/v1/payroll/runs/${r.id}/statutory`)
    const amounts = Object.fromEntries(sql(`select component_code || '=' || sum(amount) from payroll.payslip_lines where run_id='${r.id}'
      and component_code in ('PF_EMPLOYEE','PF_EMPLOYER','ESI_EMPLOYEE','ESI_EMPLOYER','PT','LWF_EMPLOYEE','LWF_EMPLOYER','TDS') group by component_code`)
      .split('\n').filter(Boolean).map((l) => l.split('=')))
    const expected = [['PF', 'PF_EMPLOYEE', 'PF_EMPLOYER'], ['ESI', 'ESI_EMPLOYEE', 'ESI_EMPLOYER'], ['PT', 'PT', null], ['LWF', 'LWF_EMPLOYEE', 'LWF_EMPLOYER'], ['TDS', 'TDS', null]]
      .map(([s, a, b]) => [s, Number(amounts[a] || 0) + Number(b ? amounts[b] || 0 : 0)]).filter(([, t]) => t > 0)
    const got = (dues.json || []).map((d) => [d.scheme, Number(d.total)])
    check(`statutory dues of ${r.periodYear}-${r.periodMonth} match the run\u2019s lines (TDS only when a TDS line exists)`,
      dues.status === 200 && JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got))
  }

  // ── Bank readiness before a file (BW-57) ────────────────────────────────────
  if (locked) {
    const ready = await fin.call(`/v1/payroll/runs/${locked.id}/bank-readiness`)
    const expectTotal = Number(sql(`select count(*) from (select employee_id from payroll.payslip_lines where run_id='${locked.id}'
      group by employee_id having coalesce(sum(amount) filter (where category in ('EARNING','REIMBURSEMENT')),0) - coalesce(sum(amount) filter (where category='DEDUCTION'),0) > 0) x`))
    const r = ready.json || {}
    check('bank readiness: everyone with pay to send, ready or with the reason', ready.status === 200 && r.total === expectTotal
      && r.ready + r.notReady === r.total && (r.people || []).every((p) => (p.status === 'READY') === (p.problem === null)), `${ready.status} ${r.ready}/${r.total}`)
    const readerLine = (r.people || []).find((p) => p.employeeId === readerId)
    if (readerLine) {
      const last4 = sql(`select coalesce(account_number_last4,'') from hrms.employee_bank_accounts where employee_id='${readerId}' and is_primary limit 1`)
      check('bank readiness shows the account\u2019s last 4 only', readerLine.bankLast4 === (last4 || null) && !('accountNumber' in readerLine))
    }
  }

  // ── Dashboard: pending disbursals as an amount (BW-54) ──────────────────────
  const kpis = await owner.call('/v1/payroll/dashboard/kpis')
  const expectPending = sql(`select coalesce(sum(r.total_net),0) from payroll.runs r where r.tenant_id='${tenant}' and r.status in ('PROCESSING','LOCKED')
    and not exists (select 1 from payroll.disbursement_batches b where b.run_id=r.id and b.status in ('POSTED','PAID'))`)
  check('dashboard: pending disbursals as an amount, next to the old count', kpis.status === 200 && same(kpis.json?.pendingDisbursalAmount, expectPending)
    && typeof kpis.json?.pendingDisbursals === 'number', `${kpis.json?.pendingDisbursalAmount} vs ${expectPending}`)

  // ── My payslips (BW-55): additive fields, own rows only ─────────────────────
  const mine = await reader.call('/v1/payroll/payslips/me')
  const rowsMine = mine.json || []
  const oldSlipKeys = ['runId', 'period', 'periodMonth', 'periodYear', 'paidDays', 'lopDays', 'gross', 'totalDeductions', 'netPay', 'status', 'lockedAt']
  check('my payslips keep every old field (the mobile app reads them)', mine.status === 200 && rowsMine.length > 0
    && rowsMine.every((s) => oldSlipKeys.every((k) => k in s)))
  const expectRuns = sql(`select string_agg(distinct r.id::text, ',' order by r.id::text) from payroll.runs r join payroll.payslip_lines l on l.run_id=r.id
    where l.employee_id='${readerId}' and r.status in ('LOCKED','PAID')`).split(',').filter(Boolean)
  check('my payslips are my own final runs only', JSON.stringify(rowsMine.map((s) => s.runId).sort()) === JSON.stringify(expectRuns.sort()))
  let extrasOk = true, why = ''
  for (const s of rowsMine) {
    const [payDate, paidAt] = sql(`select coalesce(r.pay_date::text,''), (coalesce(r.paid_at, (select max(b.paid_at) from payroll.disbursement_batches b where b.run_id=r.id and b.status='PAID')) is not null)::text
      from payroll.runs r where r.id='${s.runId}'`).split('|')
    if ((payDate || null) !== s.payDate) { extrasOk = false; why += ` payDate ${s.period}` }
    if ((paidAt === 'true') !== (s.paidAt != null)) { extrasOk = false; why += ` paidAt ${s.period}` }
    const days = sql(`select coalesce(total_calendar::text,'') from payroll.run_lop_days where run_id='${s.runId}' and employee_id='${readerId}'`)
    if ((days === '' ? null : Number(days)) !== s.totalDays) { extrasOk = false; why += ` days ${s.period}` }
    const adv = sql(`select coalesce(sum(amount),0) from payroll.payslip_lines where run_id='${s.runId}' and employee_id='${readerId}' and component_code='ADVANCE_RECOVERY'`)
    const note = (s.notes || []).find((n) => n.kind === 'ADVANCE_RECOVERY')
    if (Number(adv) > 0 ? !same(note?.amount, adv) : !!note) { extrasOk = false; why += ` advance note ${s.period}` }
  }
  check('each payslip row has its pay date, paid date, days and notes', extrasOk, why)
  const lockedMine = rowsMine.find((s) => s.status === 'LOCKED') || rowsMine[0]
  if (lockedMine) {
    const slip = await reader.call(`/v1/payroll/payslips/me/${lockedMine.runId}`)
    const acct = sql(`select coalesce(bank_name,'') || '|' || coalesce(account_number_last4,'') from hrms.employee_bank_accounts where employee_id='${readerId}' and is_primary order by updated_at desc limit 1`)
    const [bankName, last4] = acct ? acct.split('|') : ['', '']
    check('my payslip names the bank and its last 4', slip.status === 200 && (slip.json?.bankName ?? '') === bankName && (slip.json?.bankLast4 ?? '') === last4,
      `${slip.json?.bankName} ${slip.json?.bankLast4}`)
  }

  // ── One employee's payslips for HR and finance (BW-58) ──────────────────────
  const theirs = await owner.call(`/v1/payroll/employees/${readerId}/payslips`)
  check('HR and finance see one person\u2019s final payslips (the same rows the person sees)', theirs.status === 200
    && JSON.stringify((theirs.json || []).map((s) => s.runId).sort()) === JSON.stringify(rowsMine.map((s) => s.runId).sort()))

  // ── The pay schedule (BW-55, contract usePaySchedule) ───────────────────────
  const today = istToday()
  const schedule = await reader.call('/v1/payroll/payslips/me/schedule')
  check('/payslips/me/schedule answers (it was taken for a run id and answered 400)', schedule.status === 200, `${schedule.status}`)
  check('the schedule is exactly the shared contract', schedule.json && JSON.stringify(Object.keys(schedule.json).sort()) === JSON.stringify(['nextPayDate', 'processingDay']))
  const readerCompany = sql(`select company_id from hrms.employees where id='${readerId}'`)
  const [startDay, processingDay] = sql(`select payroll_cycle_start_day || '|' || salary_processing_day from payroll.settings where tenant_id='${tenant}'`).split('|').map(Number)
  let expectNext = sql(`select coalesce(min(pay_date)::text,'') from payroll.runs where company_id='${readerCompany}' and status in ('DRAFT','PROCESSING','LOCKED') and pay_date >= '${today}'`)
  if (!expectNext) {
    // Payroll settings: the processing day of the first month (from this cycle) that has no run yet and isn't past.
    const withRun = new Set(sql(`select period_year || '-' || lpad(period_month::text,2,'0') from payroll.runs where company_id='${readerCompany}' and status <> 'CANCELLED'`).split('\n'))
    const t = new Date(today + 'T00:00:00Z')
    let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1
    const cycleEnd = (yy, mm) => (startDay <= 1 ? new Date(Date.UTC(yy, mm, 0)) : new Date(Date.UTC(yy, mm - 1, Math.min(startDay, new Date(Date.UTC(yy, mm, 0)).getUTCDate()) - 1)))
    if (cycleEnd(y, m) < t) { m++; if (m > 12) { m = 1; y++ } }
    for (let i = 0; i < 4 && !expectNext; i++) {
      const end = cycleEnd(y, m), last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
      const pay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(processingDay, last)))
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (pay >= t && !withRun.has(key)) expectNext = pay.toISOString().slice(0, 10)
      m++; if (m > 12) { m = 1; y++ }
    }
  }
  check('the next pay date is the next run\u2019s pay date, else the processing day', schedule.json?.nextPayDate === (expectNext || null) && schedule.json?.processingDay === processingDay,
    `${schedule.json?.nextPayDate} vs ${expectNext}, day ${schedule.json?.processingDay}`)

  // ── This financial year (BW-55) ─────────────────────────────────────────────
  const ytd = await reader.call('/v1/payroll/payslips/me/ytd')
  const fyStartMonth = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
    .indexOf((sql(`select coalesce(upper(trim(fiscal_year_start)),'APRIL') from org.companies where id='${readerCompany}'`) || 'APRIL')) + 1 || 4
  const [ty, tm] = today.split('-').map(Number)
  const fyYear = tm >= fyStartMonth ? ty : ty - 1
  const fyStart = `${fyYear}-${String(fyStartMonth).padStart(2, '0')}-01`
  const fyEndDate = new Date(Date.UTC(fyYear + 1, fyStartMonth - 1, 0)).toISOString().slice(0, 10)
  const [n, gross, ded] = sql(`select count(distinct r.id) || '|' || coalesce(sum(l.amount) filter (where l.category in ('EARNING','REIMBURSEMENT')),0) || '|' || coalesce(sum(l.amount) filter (where l.category='DEDUCTION'),0)
    from payroll.runs r join payroll.payslip_lines l on l.run_id=r.id and l.employee_id='${readerId}'
    where r.status in ('LOCKED','PAID') and make_date(r.period_year, r.period_month, 1) between '${fyStart}' and '${fyEndDate}'`).split('|')
  check('this year\u2019s totals: final payslips of the company\u2019s financial year', ytd.status === 200 && ytd.json?.fyStart === fyStart && ytd.json?.payslips === Number(n)
    && same(ytd.json?.gross, gross) && same(ytd.json?.deductions, ded) && same(ytd.json?.net, Number(gross) - Number(ded)), `${JSON.stringify(ytd.json)}`)
  const tdsLines = sql(`select count(*) from payroll.payslip_lines where employee_id='${readerId}' and component_code='TDS'`)
  check('TDS stays empty while payroll has no TDS line ("Not calculated yet")', tdsLines !== '0' || ytd.json?.tds === null)

  // ── The month being prepared shows no figures (BW-55) ───────────────────────
  const upcomingBefore = await reader.call('/v1/payroll/payslips/me/upcoming')
  check('the month being prepared: a list', upcomingBefore.status === 200 && Array.isArray(upcomingBefore.json))
  const existingDec = sql(`select id from payroll.runs where company_id='${company}' and period_year=2029 and period_month=12`)
  if (!existingDec && readerCompany === company) {
    const created = await owner.call('/v1/payroll/runs', 'POST', { companyId: company, periodMonth: 12, periodYear: 2029 })
    draftRunId = created.json?.id
    check('a disposable DRAFT run for Dec 2029 (never processed)', created.status === 201 && created.json?.status === 'DRAFT', `${created.status}`)
    const up = await reader.call('/v1/payroll/payslips/me/upcoming')
    const dec = (up.json || []).find((u) => u.periodYear === 2029 && u.periodMonth === 12)
    check('the month being prepared shows the period and pay date only', dec && dec.status === 'BEING_PREPARED' && dec.period === 'Dec 2029'
      && JSON.stringify(Object.keys(dec).sort()) === JSON.stringify(['payDate', 'period', 'periodMonth', 'periodYear', 'status']), JSON.stringify(dec))
    const listAfter = await reader.call('/v1/payroll/payslips/me')
    check('a draft never appears among my payslips', !(listAfter.json || []).some((s) => s.runId === draftRunId))
    const slip = await reader.call(`/v1/payroll/payslips/me/${draftRunId}`)
    check('a draft payslip can\u2019t be opened', slip.status === 404, `${slip.status}`)
  } else {
    check('a disposable DRAFT run for Dec 2029', true, 'skipped: that month already has a run')
  }

  // ── Salary structures (BW-56) ───────────────────────────────────────────────
  const summary = await hrm.call('/v1/payroll/structures/summary')
  const s = summary.json || {}
  const [active, withS] = sql(`select count(*) || '|' || count(s.id) from hrms.employees e left join payroll.employee_salary_structures s on s.employee_id=e.id and s.is_current
    where e.tenant_id='${tenant}' and e.is_active and e.employment_status::text not in ('EXITED','TERMINATED')`).split('|').map(Number)
  check('structure tiles: people with and without a structure', summary.status === 200 && s.activeEmployees === active && s.withStructure === withS
    && s.withoutStructure === active - withS, JSON.stringify(s))
  const none = await hrm.call('/v1/payroll/structures?noStructure=true&size=5')
  check('structure list: "No structure" is filtered on the server', none.status === 200 && none.json?.totalElements === s.withoutStructure
    && (none.json?.content || []).length <= 5 && (none.json?.content || []).every((r) => r.hasStructure === false), `${none.json?.totalElements}`)
  const search = await owner.call('/v1/payroll/structures?q=reader&size=10')
  const readerRow = (search.json?.content || []).find((r) => r.employeeId === readerId)
  const single = await owner.call(`/v1/payroll/structures/employee/${readerId}`)
  check('structure list: search finds a person, with the same net as their own structure', search.status === 200 && readerRow
    && (single.json ? readerRow.hasStructure && same(readerRow.netMonthly, single.json.netMonthly) : !readerRow.hasStructure), `${readerRow?.netMonthly} vs ${single.json?.netMonthly}`)
  const history = await reader.call('/v1/payroll/structures/me/history')
  const histCount = Number(sql(`select count(*) from payroll.employee_salary_structures where employee_id='${readerId}'`))
  check('my salary history: every structure of mine, newest first', history.status === 200 && (history.json || []).length === histCount
    && (histCount === 0 || history.json[0].current === true), `${(history.json || []).length} vs ${histCount}`)

  // ── Ask payroll, both ways (BW-59) ──────────────────────────────────────────
  const stamp = Date.now()
  const question = `Live check question ${stamp}: why is this month different?`
  const answer = `Live check answer ${stamp}: nothing changed.`
  const target = lockedMine || rowsMine[0]
  const asked = await reader.call(`/v1/payroll/payslips/me/${target.runId}/queries`, 'POST', { message: question })
  questionId = asked.json?.id
  check('reader asks about their own payslip', asked.status === 201 && asked.json?.status === 'OPEN' && asked.json?.message === question, `${asked.status}`)
  const notMine = await reader.call(`/v1/payroll/payslips/me/${crypto.randomUUID()}/queries`, 'POST', { message: 'Not my run' })
  check('asking about a run that isn\u2019t mine is "No payslip for this period"', notMine.status === 404 && notMine.json?.errorCode === 'PAYSLIP_NOT_FOUND', `${notMine.status}`)
  const blank = await reader.call(`/v1/payroll/payslips/me/${target.runId}/queries`, 'POST', { message: '   ' })
  check('an empty question is refused', blank.status === 400, `${blank.status}`)
  const readerQs = await reader.call(`/v1/payroll/payslips/me/queries?runId=${target.runId}`)
  check('reader sees their question with the payslip', readerQs.status === 200 && (readerQs.json || []).some((x) => x.id === questionId))
  const mgrQs = await mgr.call('/v1/payroll/payslips/me/queries')
  check('someone else doesn\u2019t see it among their own', mgrQs.status === 200 && !(mgrQs.json || []).some((x) => x.id === questionId))
  const queue = await fin.call('/v1/payroll/queries?status=OPEN')
  const inQueue = (queue.json || []).find((x) => x.id === questionId)
  check('fin sees it in the payroll team\u2019s queue', queue.status === 200 && inQueue && inQueue.employeeId === readerId && inQueue.period === target.period, `${queue.status}`)
  const raisedNote = sql(`select count(*) || '|' || coalesce(bool_or(position('${q1(question)}' in title || coalesce(body,'') || data::text) > 0), false)
    from notif.notifications where type='PAYSLIP_QUERY_RAISED' and data->>'queryId'='${questionId}'`).split('|')
  const finNote = sql(`select count(*) from notif.notifications where type='PAYSLIP_QUERY_RAISED' and data->>'queryId'='${questionId}' and user_id='${finId}'`)
  check('the payroll team is told, without the question', Number(raisedNote[0]) > 0 && finNote !== '0' && raisedNote[1] === 'false', raisedNote.join(' '))
  const hrmAnswer = await hrm.call(`/v1/payroll/queries/${questionId}/answer`, 'POST', { answer: 'Not allowed' })
  check('hrm (no payroll.runs.manage) can\u2019t answer', hrmAnswer.status === 403, `${hrmAnswer.status}`)
  const answered = await fin.call(`/v1/payroll/queries/${questionId}/answer`, 'POST', { answer })
  check('fin answers', answered.status === 200 && answered.json?.status === 'ANSWERED' && answered.json?.answer === answer && !!answered.json?.answeredByName,
    `${answered.status} ${answered.json?.answeredByName}`)
  const again = await fin.call(`/v1/payroll/queries/${questionId}/answer`, 'POST', { answer: 'Second answer' })
  check('a question is answered only once', again.status === 409 && again.json?.errorCode === 'QUERY_ALREADY_ANSWERED', `${again.status}`)
  const readerAfter = await reader.call('/v1/payroll/payslips/me/queries')
  check('reader reads the answer next to the payslip', (readerAfter.json || []).some((x) => x.id === questionId && x.answer === answer))
  const answeredNote = sql(`select count(*) || '|' || coalesce(bool_or(position('${q1(answer)}' in title || coalesce(body,'') || data::text) > 0), false)
    from notif.notifications where type='PAYSLIP_QUERY_ANSWERED' and data->>'queryId'='${questionId}' and user_id='${readerId}'`).split('|')
  check('reader is told it was answered, without the answer', answeredNote[0] === '1' && answeredNote[1] === 'false', answeredNote.join(' '))

  // ── Who may call what (403 per role) ────────────────────────────────────────
  const runForGuards = (locked || list[0]).id
  const matrix = [
    [`/v1/payroll/runs/${runForGuards}/checks`, ['owner', 'hrm', 'fin']],
    [`/v1/payroll/runs/${runForGuards}/statutory`, ['owner', 'hrm', 'fin']],
    [`/v1/payroll/runs/${runForGuards}/bank-readiness`, ['owner', 'fin']],
    [`/v1/payroll/employees/${readerId}/payslips`, ['owner', 'hrm', 'fin']],
    ['/v1/payroll/structures/summary', ['owner', 'hrm', 'fin']],
    ['/v1/payroll/structures?size=1', ['owner', 'hrm', 'fin']],
    ['/v1/payroll/structures/me/history', ['owner', 'hrm', 'fin', 'mgr', 'reader']],
    ['/v1/payroll/payslips/me/schedule', ['owner', 'hrm', 'fin', 'mgr', 'reader']],
    ['/v1/payroll/payslips/me/ytd', ['owner', 'hrm', 'fin', 'mgr', 'reader']],
    ['/v1/payroll/payslips/me/upcoming', ['owner', 'hrm', 'fin', 'mgr', 'reader']],
    ['/v1/payroll/payslips/me/queries', ['owner', 'hrm', 'fin', 'mgr', 'reader']],
    ['/v1/payroll/queries', ['owner', 'fin']],
    ['/v1/payroll/dashboard/kpis', ['owner', 'hrm', 'fin']],
  ]
  for (const [path, allowed] of matrix) {
    const got = []
    for (const [name, who] of Object.entries(everyone)) {
      const r = await who.call(path)
      const ok = allowed.includes(name) ? r.status === 200 : r.status === 403
      got.push(`${name}:${r.status}${ok ? '' : '✗'}`)
    }
    check(`permissions ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`, !got.some((g) => g.endsWith('✗')), got.join(' '))
  }

  // ── FEATURE_NOT_READY while the table is missing (ut_w3_dev only) ───────────
  if (db === 'ut_w3_dev') {
    sql('ALTER TABLE payroll.payslip_queries RENAME TO payslip_queries_live_hidden')
    renamed = true
    notReadyAllowed = true
    try {
      const a = await reader.call('/v1/payroll/payslips/me/queries')
      const b = await fin.call('/v1/payroll/queries')
      const c = await reader.call(`/v1/payroll/payslips/me/${target.runId}/queries`, 'POST', { message: 'While the table is missing' })
      const d = await fin.call(`/v1/payroll/queries/${questionId}/answer`, 'POST', { answer: 'While the table is missing' })
      const nr = (x) => x.status === 503 && x.json?.errorCode === 'FEATURE_NOT_READY'
      check('without the table: reading, asking and answering say "not switched on yet"', nr(a) && nr(b) && nr(c) && nr(d),
        [a, b, c, d].map((x) => `${x.status} ${x.json?.errorCode}`).join(' | '))
      const other = await reader.call('/v1/payroll/payslips/me')
      const sched = await reader.call('/v1/payroll/payslips/me/schedule')
      check('without the table: payslips and the schedule still work', other.status === 200 && sched.status === 200)
    } finally {
      notReadyAllowed = false
      sql('ALTER TABLE payroll.payslip_queries_live_hidden RENAME TO payslip_queries')
      renamed = false
    }
    const back = await reader.call('/v1/payroll/payslips/me/queries')
    check('table back: questions answer again', back.status === 200 && (back.json || []).some((x) => x.id === questionId))
  } else {
    check('FEATURE_NOT_READY step', true, `skipped on ${db} (only renames tables in ut_w3_dev)`)
  }
} catch (e) {
  check('run finished', false, e.stack || e.message)
} finally {
  if (renamed) { try { sql('ALTER TABLE payroll.payslip_queries_live_hidden RENAME TO payslip_queries') } catch (e) { console.log('rename back failed: ' + e.message) } }
  try {
    if (questionId) {
      sql(`delete from notif.notifications where type in ('PAYSLIP_QUERY_RAISED','PAYSLIP_QUERY_ANSWERED') and data->>'queryId'='${questionId}'`)
      sql(`delete from payroll.payslip_queries where id='${questionId}'`)
    }
    // Anything else this run created (a failed step may have left a question behind).
    sql(`delete from notif.notifications where type in ('PAYSLIP_QUERY_RAISED','PAYSLIP_QUERY_ANSWERED') and created_at >= '${startedAt}'
      and data->>'queryId' in (select id::text from payroll.payslip_queries where message like 'Live check question %' or message in ('Not my run','While the table is missing'))`)
    sql(`delete from payroll.payslip_queries where created_at >= '${startedAt}' and (message like 'Live check question %' or message in ('Not my run','While the table is missing'))`)
    if (draftRunId) {
      const n = sql(`with d as (delete from payroll.runs where id='${draftRunId}' and status='DRAFT' and period_year=2029 and period_month=12
        and not exists (select 1 from payroll.payslip_lines l where l.run_id='${draftRunId}') returning 1) select count(*) from d`)
      console.log(`cleanup: draft run removed (${n})`)
    }
    const left = sql(`select (select count(*) from payroll.payslip_queries where created_at >= '${startedAt}') || '|' ||
      (select count(*) from payroll.runs where period_year=2029 and period_month=12 and company_id='${company}' ${draftRunId ? '' : 'and false'})`)
    check('cleanup: nothing this run created is left', left === '0|0', left)
  } catch (e) {
    check('cleanup', false, e.message)
  }
}

check('no unexpected 5xx and no FEATURE_NOT_READY outside the rename step', unexpected.length === 0, unexpected.join(' ; '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
