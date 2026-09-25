// API check of the 25 Sep backend fixes against the local server:
//  1. today with no punch is NOT_MARKED in the weekly summary (not ABSENT)
//  2. leave counts the company's own weekly off days and its Settings holidays
//  3. classifications are readable with hrms.employee.read (owner), not only by role name
//  4. a duplicate salary component code is refused (409), not silently "created"
//  5. listing shifts doesn't bring back a default shift that was archived
//  6. company and department employee counts are live, not frozen cached values
// Everything changed for the check is put back at the end.
//
//   node e2e/recovery/live-backend-fixes.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const iso = (d) => d.toISOString().slice(0, 10)

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId }
}

const owner = await session('owner@unifiedtree.demo')
const reader = await session('reader@unifiedtree.demo')
const restore = []
try {
  // ── 1. weekly summary ──
  const today = istToday()
  const punched = Number(sql(`select count(*) from attendance.records where employee_id='${reader.employeeId}' and attendance_date='${today}' and check_in_at is not null`))
  const wk = await owner.call(`/v1/attendance/employee/${reader.employeeId}/weekly-summary`)
  const day = (wk.json?.days || []).find((d) => d.date === today)
  if (punched) check('weekly summary: today (reader punched in, nothing to test)', true, 'skipped')
  else check('weekly summary: today without a punch is NOT_MARKED, not ABSENT', day?.status === 'NOT_MARKED', `status=${day?.status}`)
  check('weekly summary: no future day is called ABSENT', !(wk.json?.days || []).some((d) => d.date > today && d.status === 'ABSENT'))

  // ── 2. leave counting ──
  const w0 = sql(`select coalesce(weekend_days::text,'') from settings.hr_configuration where company_id='${company}'`)
  restore.push(() => sql(`update settings.hr_configuration set weekend_days=${w0 ? `'${w0}'` : 'null'} where company_id='${company}'`))
  sql(`update settings.hr_configuration set weekend_days='{7}' where company_id='${company}'`) // Sunday only
  // A Friday at least 10 days out, through the following Monday; that Monday is a company holiday.
  const fri = new Date(Date.now() + 5.5 * 3600e3 + 10 * 864e5); while (fri.getUTCDay() !== 5) fri.setUTCDate(fri.getUTCDate() + 1)
  const mon = new Date(fri.getTime() + 3 * 864e5)
  const hol = await owner.call('/v1/settings/holidays', 'POST', { companyId: company, holidayDate: iso(mon), holidayName: 'Local QA holiday' })
  if (hol.json?.id) restore.push(() => sql(`delete from settings.holiday_calendar where id='${hol.json.id}'`))
  const bal = await reader.call('/v1/leave/my/balances')
  const type = (bal.json || []).map((b) => ({ id: b.leaveTypeId, avail: Number(b.available ?? b.availableDays ?? b.balance ?? 0) })).sort((a, b) => b.avail - a.avail)[0]
  if (!type || type.avail < 3) check('leave: counts company off days and holidays', false, 'reader has no leave balance to test with')
  else {
    const applied = await reader.call(`/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: type.id, startDate: iso(fri), endDate: iso(mon), duration: 'FULL_DAY', reason: 'Local QA: leave day count' })
    if (applied.json?.id) restore.push(() => sql(`delete from leave_mgmt.leave_requests where id='${applied.json.id}'`), async () => { const c = await reader.call(`/v1/leave/${applied.json.id}/cancel?reason=${encodeURIComponent('Local QA cleanup')}`, 'POST'); if (c.status >= 300) throw new Error(`cancel ${c.status}`) })
    check('leave: Fri–Mon with Sunday off and Monday a holiday counts 2 days (Fri, Sat)', applied.status < 300 && Number(applied.json?.totalDays) === 2, `status=${applied.status} totalDays=${applied.json?.totalDays} ${applied.status >= 300 ? JSON.stringify(applied.json).slice(0, 160) : ''}`)
  }

  // ── 3. classifications ──
  const cls = await owner.call(`/v1/hrms/classifications?companyId=${company}`)
  check('classifications: the owner (hrms.employee.read) can list them', cls.status === 200, `status=${cls.status}`)
  const clsR = await reader.call(`/v1/hrms/classifications?companyId=${company}`)
  check('classifications: an employee without hrms.employee.read cannot', clsR.status === 403, `status=${clsR.status}`)

  // ── 4. duplicate component code ──
  const comps = await owner.call('/v1/payroll/components')
  const existing = (comps.json || [])[0]
  if (!existing) check('components: duplicate code is refused', false, 'no components to test with')
  else {
    const dup = await owner.call('/v1/payroll/components', 'POST', { code: String(existing.code).toLowerCase(), name: 'Local QA duplicate', category: existing.category || 'EARNING', computationType: existing.computationType || 'FIXED' })
    check('components: a duplicate code (any case) is refused with 409', dup.status === 409 && /already exists/.test(JSON.stringify(dup.json)), `status=${dup.status}`)
  }

  // ── 5. archived default shift stays archived ──
  const shifts = await owner.call(`/v1/shifts?companyId=${company}`)
  const cand = (shifts.json || []).filter((s) => ['morning', 'afternoon', 'night'].includes(String(s.name).trim().toLowerCase()))
    .find((s) => Number(sql(`select count(*) from attendance.employee_shift_assignments where shift_policy_id='${s.id}'`)) === 0)
  if (!cand) check('shifts: an archived default is not recreated', true, 'skipped: every default shift is assigned to someone')
  else {
    const del = await owner.call(`/v1/shifts/${cand.id}`, 'DELETE')
    restore.push(() => sql(`update attendance.shift_policies set is_active=true where id='${cand.id}'`))
    const again = await owner.call(`/v1/shifts?companyId=${company}`)
    const back = (again.json || []).some((s) => String(s.name).trim().toLowerCase() === String(cand.name).trim().toLowerCase())
    const added = (again.json || []).filter((s) => !(shifts.json || []).some((o) => o.id === s.id))
    for (const s of added) restore.push(() => sql(`delete from attendance.shift_policies where id='${s.id}'`))
    check(`shifts: archiving "${cand.name}" keeps it archived after the list is read again`, del.status < 300 && !back, `delete=${del.status} recreated=${back}`)
  }

  // ── 6. live counts ──
  const liveCo = Number(sql(`select count(*) from hrms.employees where company_id='${company}' and is_active and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD')`))
  const cos = await owner.call('/v1/hrms/companies')
  const co = (cos.json || []).find((c) => c.id === company)
  check('counts: the company’s employee count is live', co?.employeeCount === liveCo, `api=${co?.employeeCount} db=${liveCo}`)
  const depts = await owner.call(`/v1/hrms/departments?companyId=${company}`)
  const bad = (depts.json || []).filter((d) => d.employeeCount !== Number(sql(`select count(*) from hrms.employees where department_id='${d.id}' and is_active and employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD')`)))
  check('counts: every department’s count is live', (depts.json || []).length > 0 && !bad.length, bad.map((d) => `${d.name}=${d.employeeCount}`).join(', '))
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  for (const r of restore.reverse()) { try { await r() } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) } }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
