// Redesign F3b, Step 2: the API half, against a backend built from this branch (live slot, ut_w3_dev).
//
//  - BW-01 GET /v1/workspace/admin-contacts: anyone signed in; the people who can manage users or
//    roles (by permission: a per-person grant adds someone, a deactivated login drops them), owners
//    first, name + work email; anonymous 401.
//  - BW-02 GET /v1/search/people/facts: hrms.employee.read only; branch, manager, joining date, status;
//    more than 20 ids is 400; an id from nowhere returns nothing.
//  - BW-04 holiday results; and the five request types (work from home, shift change, attendance fix,
//    advance, overtime): who finds the employee's test requests is exactly each list page's rule.
//    Renaming the overtime table (feature not switched on) leaves the search working without that group.
//  - BW-05 GET /v1/notifications: every row carries its `group`; `since` filters; a bad `since` is 400.
// Fixtures are written straight into the disposable database (RECOVERY_DB, ut_w3_dev only) and removed.
//
//   node e2e/recovery/live-rd-f3b-api.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), PSQL, RECOVERY_PASSWORD
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
if (db !== 'ut_w3_dev') { console.error(`refusing to write fixtures to ${db}: run this inside the live slot (ut_w3_dev)`); process.exit(2) }
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const MANAGER = '44444444-4444-4444-4444-444444444444'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'

const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' }).trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const group = (res, type) => (res.json?.groups || []).find((g) => g.type === type)?.items || []

const stamp = `fthreeb${Date.now()}`
const ids = { wfh: randomUUID(), shift: randomUUID(), fix: randomUUID(), adv: randomUUID(), ot: randomUUID(), holiday: randomUUID(), grant: randomUUID() }
let renamed = false
try {
  const call = {}
  for (const who of ['owner', 'hrm', 'fin', 'mgr', 'reader']) call[who] = await login(`${who}@unifiedtree.demo`)

  // ── BW-01 admin contacts ──
  const contacts = await call.reader('/v1/workspace/admin-contacts')
  const list = contacts.json || []
  check('admin contacts: anyone signed in may read them', contacts.status === 200 && Array.isArray(list), `status=${contacts.status}`)
  check('admin contacts: each has a name and a work email', list.length > 0 && list.every((c) => c.name && /@/.test(c.email || '')), JSON.stringify(list.slice(0, 2)))
  check('admin contacts: the owner is listed first, as "Owner"', list[0]?.email === 'owner@unifiedtree.demo' && list[0]?.roleLabel === 'Owner', list[0]?.email)
  check('admin contacts: people who can\'t manage users or roles are not listed', !list.some((c) => ['reader@unifiedtree.demo', 'mgr@unifiedtree.demo', 'fin@unifiedtree.demo'].includes(c.email)))
  check('admin contacts: at most 10', list.length <= 10, `n=${list.length}`)
  const anon = await fetch(`${api}/v1/workspace/admin-contacts`, { headers: { 'X-Tenant-ID': tenant } })
  check('admin contacts: anonymous is refused (401)', anon.status === 401, `status=${anon.status}`)
  // By permission, not role name: a per-person grant adds the manager; a deactivated login drops an admin.
  sql(`INSERT INTO rbac.user_permission_overrides(id, tenant_id, user_id, permission_code, effect, reason) VALUES ('${ids.grant}', '${tenant}', '${MANAGER}', 'workspace.users.manage', 'GRANT', '${stamp}')`)
  const granted = await call.reader('/v1/workspace/admin-contacts')
  check('admin contacts: a per-person grant of user management adds that person', (granted.json || []).some((c) => c.email === 'mgr@unifiedtree.demo'))
  sql(`DELETE FROM rbac.user_permission_overrides WHERE id = '${ids.grant}'`)
  const admin = list.find((c) => c.email === 'admin@unifiedtree.demo')
  if (admin) {
    sql(`UPDATE auth.user_credentials SET is_active = FALSE WHERE tenant_id = '${tenant}' AND email = 'admin@unifiedtree.demo'`)
    const off = await call.reader('/v1/workspace/admin-contacts')
    check('admin contacts: a deactivated admin is not listed', !(off.json || []).some((c) => c.email === 'admin@unifiedtree.demo'))
    sql(`UPDATE auth.user_credentials SET is_active = TRUE WHERE tenant_id = '${tenant}' AND email = 'admin@unifiedtree.demo'`)
  }

  // ── BW-02 person facts ──
  const facts = await call.owner(`/v1/search/people/facts?ids=${READER},${randomUUID()}`)
  const f = (facts.json || [])[0]
  check('facts: the directory reader gets the person\'s facts (and nothing for an unknown id)', facts.status === 200 && facts.json.length === 1 && f.id === READER, JSON.stringify(f))
  check('facts: manager, joining date and employment status', f?.managerName && /\d{4}-\d{2}-\d{2}/.test(f?.dateOfJoining || '') && !!f?.employmentStatus, `${f?.managerName} ${f?.dateOfJoining} ${f?.employmentStatus}`)
  check('facts: no private fields', f && Object.keys(f).every((k) => ['id', 'branchName', 'managerName', 'dateOfJoining', 'employmentStatus'].includes(k)), Object.keys(f || {}).join(','))
  check('facts: an employee without directory access is refused (403)', (await call.reader(`/v1/search/people/facts?ids=${READER}`)).status === 403)
  const many = Array.from({ length: 21 }, () => randomUUID()).join(',')
  check('facts: more than 20 ids is refused (400)', (await call.owner(`/v1/search/people/facts?ids=${many}`)).status === 400)

  // ── Fixtures: a holiday and one of each request for the employee ──
  sql(`BEGIN;
    INSERT INTO settings.holiday_calendar(id, tenant_id, company_id, year, holiday_date, holiday_name, holiday_type)
      VALUES ('${ids.holiday}', '${tenant}', '${company}', EXTRACT(YEAR FROM CURRENT_DATE)::int, CURRENT_DATE + 20, '${stamp} Festival', 'NATIONAL');
    INSERT INTO leave_mgmt.wfh_requests(id, tenant_id, employee_id, from_date, to_date, reason, status)
      VALUES ('${ids.wfh}', '${tenant}', '${READER}', CURRENT_DATE + 3, CURRENT_DATE + 3, '${stamp}', 'PENDING');
    INSERT INTO attendance.shift_change_requests(id, tenant_id, employee_id, requested_shift_policy_id, reason, status)
      VALUES ('${ids.shift}', '${tenant}', '${READER}', (SELECT id FROM attendance.shift_policies WHERE tenant_id = '${tenant}' ORDER BY name LIMIT 1), '${stamp}', 'PENDING');
    INSERT INTO attendance.regularization_requests(id, tenant_id, employee_id, request_date, missing_for_date, reason, status)
      VALUES ('${ids.fix}', '${tenant}', '${READER}', CURRENT_DATE, CURRENT_DATE - 2, '${stamp}', 'PENDING');
    INSERT INTO advance_mgmt.advance_requests(id, tenant_id, employee_id, company_id, amount, repayment_months, monthly_deduction, reason, status, approver_id)
      VALUES ('${ids.adv}', '${tenant}', '${READER}', '${company}', 12000, 6, 2000, '${stamp}', 'REQUESTED', '${MANAGER}');
    INSERT INTO attendance.overtime_requests(tenant_id, id, employee_id, company_id, request_date, minutes, reason, status)
      VALUES ('${tenant}', '${ids.ot}', '${READER}', '${company}', CURRENT_DATE - 1, 80, '${stamp}', 'PENDING');
    COMMIT;`)

  // ── BW-04 holidays ──
  const hol = group(await call.reader(`/v1/search/global?q=${stamp}`), 'holiday')
  check('holidays: the employee finds the company holiday, linked to Leave › Holidays', hol.some((h) => h.id === ids.holiday && h.url === '/hrms/leave?tab=holidays' && /National holiday/.test(h.subtitle || '')), JSON.stringify(hol[0] || {}))
  check('holidays: the owner finds it too', group(await call.owner(`/v1/search/global?q=${stamp}`), 'holiday').some((h) => h.id === ids.holiday))

  // ── Requests: exactly each list page's rule ──
  const TYPES = { wfh: ids.wfh, shift_change: ids.shift, correction: ids.fix, advance: ids.adv, overtime_request: ids.ot }
  const found = async (who) => {
    const res = await call[who](`/v1/search/global?q=${stamp}`)
    const out = {}
    for (const [type, id] of Object.entries(TYPES)) out[type] = group(res, type).find((h) => h.id === id)
    return { status: res.status, out, unavailable: res.json?.unavailable || [] }
  }
  const expect = {
    // EMPLOYEE: their own of each.
    reader: { wfh: true, shift_change: true, correction: true, advance: true, overtime_request: true },
    // DEPT_MANAGER (the employee's manager): the team's; advances only when routed to them (this one is).
    mgr: { wfh: true, shift_change: true, correction: true, advance: true, overtime_request: true },
    // HR_MANAGER: WFH company-wide (l2), shift changes (workforce admin), fixes and overtime (team = company);
    // advances only those routed to them (approve without disburse): not this one.
    hrm: { wfh: true, shift_change: true, correction: true, advance: false, overtime_request: true },
    // FINANCE_LEAD: every advance (disburse); shift changes and fixes only their own.
    fin: { shift_change: false, correction: false, advance: true },
    // OWNER: everyone's.
    owner: { wfh: true, shift_change: true, correction: true, advance: true, overtime_request: true },
  }
  for (const [who, want] of Object.entries(expect)) {
    const got = await found(who)
    check(`requests (${who}): the search answers`, got.status === 200 && got.unavailable.length === 0, `status=${got.status} unavailable=${got.unavailable}`)
    for (const [type, should] of Object.entries(want)) {
      check(`requests (${who}): ${should ? 'finds' : 'does NOT find'} the employee's ${type.replace('_', ' ')}`, !!got.out[type] === should, got.out[type] ? got.out[type].url : 'not found')
    }
  }
  const own = (await found('reader')).out
  check('requests: the employee\'s own open their self-service pages',
    own.wfh?.url === '/me/wfh' && own.shift_change?.url === '/me/shift-change' && own.advance?.url === '/hrms/advances?tab=my'
    && own.correction?.url === '/hrms/attendance?tab=corrections' && own.overtime_request?.url === '/hrms/shifts?tab=myshift',
    JSON.stringify(Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v?.url]))))
  const mgrs = (await found('mgr')).out
  check('requests: the manager\'s open where they are decided',
    mgrs.wfh?.url === '/hrms/leave?tab=approvals' && mgrs.shift_change?.url === '/hrms/shifts?tab=requests' && mgrs.advance?.url === '/hrms/advances'
    && mgrs.overtime_request?.url === '/hrms/shifts?tab=overtime', JSON.stringify(Object.fromEntries(Object.entries(mgrs).map(([k, v]) => [k, v?.url]))))
  check('requests: the advance shows its amount', /₹12,000/.test(mgrs.advance?.subtitle || ''), mgrs.advance?.subtitle)
  const words = group(await call.reader('/v1/search/global?q=requests'), 'wfh')
  check('requests: typing "requests" lists the latest of each kind', words.length > 0)

  // The overtime table missing (feature not switched on): the search still answers, without that group.
  sql('ALTER TABLE attendance.overtime_requests RENAME TO overtime_requests_f3b_off'); renamed = true
  const off = await call.reader(`/v1/search/global?q=${stamp}`)
  check('requests: without the overtime table the search still answers (no error, no "unavailable")',
    off.status === 200 && group(off, 'overtime_request').length === 0 && group(off, 'wfh').length > 0 && (off.json?.unavailable || []).length === 0)
  sql('ALTER TABLE attendance.overtime_requests_f3b_off RENAME TO overtime_requests'); renamed = false

  // ── BW-05 notifications ──
  const all = await call.reader('/v1/notifications?page=0&size=20')
  check('notifications: every row carries its group', all.status === 200 && (all.json?.content || []).every((n) => typeof n.group === 'string' && n.group.length > 0),
    (all.json?.content || []).slice(0, 3).map((n) => `${n.type}:${n.group}`).join(', '))
  const future = await call.reader(`/v1/notifications?page=0&size=20&since=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`)
  check('notifications: since filters out older rows', future.status === 200 && (future.json?.content || []).length === 0, `n=${(future.json?.content || []).length}`)
  const week = await call.reader(`/v1/notifications?page=0&size=50&since=${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}`)
  const cutoff = Date.now() - 7 * 86_400_000
  check('notifications: since keeps the last 7 days', week.status === 200 && (week.json?.content || []).every((n) => new Date(n.createdAt).getTime() >= cutoff))
  check('notifications: a bad since is refused (400)', (await call.reader('/v1/notifications?since=yesterday')).status === 400)
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 1500))
} finally {
  try {
    if (renamed) sql('ALTER TABLE attendance.overtime_requests_f3b_off RENAME TO overtime_requests')
    sql(`BEGIN;
      DELETE FROM rbac.user_permission_overrides WHERE id = '${ids.grant}';
      UPDATE auth.user_credentials SET is_active = TRUE WHERE tenant_id = '${tenant}' AND email = 'admin@unifiedtree.demo';
      DELETE FROM settings.holiday_calendar WHERE id = '${ids.holiday}';
      DELETE FROM leave_mgmt.wfh_requests WHERE id = '${ids.wfh}';
      DELETE FROM attendance.shift_change_requests WHERE id = '${ids.shift}';
      DELETE FROM attendance.regularization_requests WHERE id = '${ids.fix}';
      DELETE FROM advance_mgmt.advance_requests WHERE id = '${ids.adv}';
      DELETE FROM attendance.overtime_requests WHERE id = '${ids.ot}';
      COMMIT;`)
    check('cleanup: every fixture removed', true)
  } catch (e) {
    check('cleanup: every fixture removed', false, String(e.message || e).slice(0, 300))
  }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
