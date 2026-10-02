// Live API check for P-HOME's backend half (BW-35, BW-119, BW-120, BW-121, BW-122),
// as reader (EMPLOYEE), mgr (DEPT_MANAGER, reader's manager) and hrm (HR_MANAGER),
// plus a temporary person with a custom role and some permissions taken away.
//
//  - GET /v1/me/approvers?for=leave|wfh|correction|shift names the person the real
//    chain picks (worked out here from the database the same way), and the WFH batch
//    really goes to that person.
//  - GET /v1/ess/my-requests, /needs-you and /around-me answer with real data and
//    nothing "unavailable" (every migration is applied here, so any failing source is
//    a bug). Around you shows a notice, a holiday and a colleague's birthday, work
//    anniversary and probation end created for the check; probation ends only for
//    the manager.
//  - A temporary person whose self-service permissions are taken away one by one
//    (per-person DENY overrides; every employee otherwise gets the EMPLOYEE baseline)
//    gets 403 on the WFH batch and no Home source behind those permissions.
//  - POST /v1/wfh/batch makes one request per run of days with one approver
//    notification, refuses an overlap, and the requests are then cancelled.
//  - 401 without a session; 400 for an unknown approver kind.
//  - In the live slot's database (ut_w3_dev) only: a source whose table is renamed
//    away is reported unavailable while the rest of the list still answers; the
//    table is renamed back at once.
// Everything it creates is removed at the end.
//
//   node e2e/recovery/live-rd-p-home-api.mjs      (RECOVERY_API_URL, RECOVERY_DB)
/* global process, console, fetch, setTimeout */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const READER = '22222222-2222-2222-2222-222222222222'
const MGR = '44444444-4444-4444-4444-444444444444'
const HR_ROLE = '00000000-0000-0000-0000-000000000002'
const ADMIN_ROLE = '00000000-0000-0000-0000-000000000001'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, body: json }
  }
  return { call, perms: new Set(d.permissions || []) }
}

// IST calendar days, yyyy-MM-dd.
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

/** The terminal fallback, worked out the way ApproverFallbackResolver does: first active HR manager, else super admin. */
const firstHolder = (role) => sql(`SELECT uc.employee_id FROM rbac.user_roles ur JOIN auth.user_credentials uc ON uc.id = ur.user_id
  WHERE ur.tenant_id = ${lit(tenant)} AND ur.role_id = ${lit(role)} AND uc.employee_id IS NOT NULL AND uc.is_active = TRUE ORDER BY uc.created_at LIMIT 1`)

const created = { notices: [], holidays: [], employees: [], users: [], roles: [], wfh: [] }
let owner, reader, mgr, hrm
let renamed = []

try {
  ;[owner, reader, mgr, hrm] = await Promise.all(['owner', 'reader', 'mgr', 'hrm'].map((u) => login(`${u}@unifiedtree.demo`)))
  const today = istToday()

  // ── BW-122 · who a request goes to ────────────────────────────────────────
  {
    const readerManager = sql(`SELECT reporting_manager_id FROM hrms.employees WHERE id = ${lit(READER)}`)
    for (const kind of ['leave', 'wfh', 'correction', 'shift']) {
      const r = await reader.call(`/v1/me/approvers?for=${kind}`)
      check(`approvers (reader, ${kind}): the reporting manager`, r.status === 200 && r.body?.for === kind && r.body?.approver?.employeeId === readerManager
        && r.body?.approver?.source === 'MANAGER' && !!r.body?.approver?.name, JSON.stringify(r.body))
    }
    // mgr has no manager and no department head: the terminal fallback (first HR manager, else admin).
    const hr = firstHolder(HR_ROLE), admin = firstHolder(ADMIN_ROLE)
    const expected = hr || admin
    const m = await mgr.call('/v1/me/approvers?for=leave')
    check('approvers (mgr, leave): the terminal fallback, as apply picks it', m.status === 200 && m.body?.approver?.employeeId === expected
      && m.body?.approver?.source === (hr ? 'HR' : 'ADMIN'), JSON.stringify(m.body))
    // A fix of the first HR manager's own never goes to themself: the next in the chain.
    const h = await hrm.call('/v1/me/approvers?for=correction')
    const hrmEmployee = sql(`SELECT employee_id FROM auth.user_credentials WHERE lower(email) = 'hrm@unifiedtree.demo' AND tenant_id = ${lit(tenant)}`)
    const hrmDirect = sql(`SELECT COALESCE(e.reporting_manager_id, d.department_head_employee_id) FROM hrms.employees e
      LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id WHERE e.id = ${lit(hrmEmployee)}`)
    const fixExpected = hrmDirect && hrmDirect !== hrmEmployee ? hrmDirect : (hr && hr !== hrmEmployee ? hr : (admin && admin !== hrmEmployee ? admin : ''))
    check('approvers (hrm, correction): the person the fix notification goes to, never themself',
      h.status === 200 && (h.body?.approver?.employeeId || '') === fixExpected && h.body?.approver?.employeeId !== hrmEmployee, JSON.stringify(h.body))
    const bad = await reader.call('/v1/me/approvers?for=expense')
    check('approvers: an unknown kind is a 400', bad.status === 400 && bad.body?.errorCode === 'INVALID_PARAMETER', JSON.stringify(bad.body))
    const anon = await fetch(`${api}/v1/me/approvers?for=leave`, { headers: { 'X-Tenant-ID': tenant } })
    check('approvers: 401 without a session', anon.status === 401, String(anon.status))
  }

  // ── BW-119 · my requests ──────────────────────────────────────────────────
  {
    for (const [who, s] of [['reader', reader], ['mgr', mgr], ['hrm', hrm]]) {
      const r = await s.call('/v1/ess/my-requests?limit=20')
      const rows = r.body?.requests || []
      const shapeOk = rows.every((x) => x.kind && x.id && x.status && x.state && Array.isArray(x.steps) && x.progress >= 0 && x.progress <= 100 && String(x.link).startsWith('/'))
      check(`my requests (${who}): 200, well formed, nothing unavailable`, r.status === 200 && shapeOk && (r.body?.unavailable || []).length === 0,
        `rows=${rows.length} included=${(r.body?.included || []).join(',')} unavailable=${(r.body?.unavailable || []).join(',')}`)
      check(`my requests (${who}): every kind the person may see is read`,
        ['LEAVE', 'WFH', 'CORRECTION', 'SHIFT_CHANGE', 'EXPENSE', 'ADVANCE'].every((k) => (r.body?.included || []).includes(k)), (r.body?.included || []).join(','))
      const waitingFirst = rows.findIndex((x) => x.state !== 'WAITING') === -1 || rows.slice(rows.findIndex((x) => x.state !== 'WAITING')).every((x) => x.state !== 'WAITING')
      check(`my requests (${who}): waiting requests come first`, waitingFirst)
    }
    const r = await reader.call('/v1/ess/my-requests?limit=20')
    check('my requests (reader): real rows', (r.body?.requests || []).length > 0, String((r.body?.requests || []).length))
    const myWfh = await reader.call('/v1/wfh/my?size=50')
    const wfhIds = new Set((myWfh.body?.content || []).map((w) => w.id))
    const wfhRows = (r.body?.requests || []).filter((x) => x.kind === 'WFH')
    check('my requests (reader): its WFH rows are the ones /v1/wfh/my lists', wfhRows.every((x) => wfhIds.has(x.id)), `${wfhRows.length} rows`)
    check('WFH rows now name who has them (approverName)', (myWfh.body?.content || []).filter((w) => w.approverId).every((w) => typeof w.approverName === 'string' && w.approverName.length > 0))
  }

  // ── BW-120 · needs you ────────────────────────────────────────────────────
  {
    for (const [who, s] of [['reader', reader], ['mgr', mgr], ['hrm', hrm]]) {
      const r = await s.call('/v1/ess/needs-you')
      const items = r.body?.items || []
      check(`needs you (${who}): 200, well formed, nothing unavailable`, r.status === 200 && (r.body?.unavailable || []).length === 0
        && items.every((i) => i.kind && i.title && ['bad', 'gold', 'blue', 'brand'].includes(i.tone) && String(i.link).startsWith('/'))
        && r.body?.count >= items.length, `items=${items.length} count=${r.body?.count} kinds=${[...new Set(items.map((i) => i.kind))].join(',')}`)
      check(`needs you (${who}): no probation decisions without hrms.probation.team.decide`,
        s.perms.has('hrms.probation.team.decide') || !items.some((i) => i.kind === 'PROBATION_DECISION'))
    }
    const r = await reader.call('/v1/ess/needs-you')
    check('needs you (reader): real items', (r.body?.items || []).length > 0, (r.body?.items || []).map((i) => i.title).join(' | '))
    const missing = await reader.call('/v1/document/my/missing')
    const redoTypes = (r.body?.items || []).filter((i) => i.kind === 'DOCUMENT_REDO').length
    const row = (r.body?.items || []).find((i) => i.kind === 'DOCUMENT_MISSING')
    if (redoTypes === 0 && Array.isArray(missing.body)) {
      check('needs you (reader): missing documents match /v1/document/my/missing', (row?.count || 0) === missing.body.length, `${row?.count || 0} vs ${missing.body.length}`)
    }
  }

  // ── BW-121 · around you (with fixtures) ───────────────────────────────────
  {
    const tag = `P-HOME live ${Date.now()}`
    const notice = await owner.call('/v1/admin/dashboard/notices', 'POST', { companyId: company, title: `${tag} notice`, body: 'Team lunch on the terrace. Please bring your own water bottle.' })
    if (notice.body?.id) created.notices.push(notice.body.id)
    const holidayDay = addDays(today, 5)
    const holiday = await owner.call('/v1/settings/holidays', 'POST', { companyId: company, holidayDate: holidayDay, holidayName: `${tag} holiday`, holidayType: 'COMPANY' })
    if (holiday.body?.id) created.holidays.push(holiday.body.id)
    check('fixtures: a notice and a holiday made through the API', notice.status < 300 && holiday.status === 201, `${notice.status} ${holiday.status}`)
    // A colleague reporting to mgr, on probation that ends in 6 days, with a birthday in 3 days and 2 years' service in 4.
    const colleague = randomUUID()
    const bday = `1990-${addDays(today, 3).slice(5)}`
    const joined = `${Number(addDays(today, 4).slice(0, 4)) - 2}-${addDays(today, 4).slice(5)}`
    sql(`INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, email, employment_type, employment_status,
           reporting_manager_id, probation_end_date, date_of_birth, date_of_joining)
         VALUES (${lit(colleague)}, ${lit(tenant)}, ${lit(company)}, ${lit('PH-' + colleague.slice(0, 8))}, 'Hometest', 'Colleague',
           ${lit(`ph-${colleague}@example.invalid`)}, 'FULL_TIME', 'PROBATION', ${lit(MGR)}, ${lit(addDays(today, 6))}, ${lit(bday)}, ${lit(joined)})`)
    created.employees.push(colleague)

    const a = await reader.call('/v1/ess/around-me?days=14')
    const items = a.body?.items || []
    check('around you (reader): 200, the window is today to 14 days on, nothing unavailable', a.status === 200 && a.body?.from === today
      && a.body?.to === addDays(today, 14) && (a.body?.unavailable || []).length === 0, `${a.body?.from}..${a.body?.to} unavailable=${(a.body?.unavailable || []).join(',')}`)
    const dates = items.map((i) => i.date || '')
    check('around you (reader): in date order', dates.every((d, i) => i === 0 || dates[i - 1] <= d))
    const n = items.find((i) => i.kind === 'NOTICE' && i.title === `${tag} notice`)
    check('around you (reader): the new notice (on its posted day until notices have event dates)', !!n && ['POSTED', 'ON'].includes(n.dateKind) && n.detail?.startsWith('Team lunch'), JSON.stringify(n))
    const h = items.find((i) => i.kind === 'HOLIDAY' && i.title === `${tag} holiday`)
    check('around you (reader): the new holiday, on its day, with its type', !!h && h.date === holidayDay && h.detail?.startsWith('Company holiday'), JSON.stringify(h))
    const b = items.find((i) => i.kind === 'BIRTHDAY' && i.employeeId === colleague)
    check('around you (reader): a colleague’s birthday', !!b && b.date === addDays(today, 3) && b.title === 'Hometest Colleague’s birthday', JSON.stringify(b))
    const w = items.find((i) => i.kind === 'WORK_ANNIVERSARY' && i.employeeId === colleague)
    check('around you (reader): a colleague’s work anniversary (2 years)', !!w && w.years === 2 && w.date === addDays(today, 4), JSON.stringify(w))
    check('around you (reader): no probation ends for an employee', !items.some((i) => i.kind === 'PROBATION_END'))
    const payRun = sql(`SELECT id FROM payroll.runs WHERE tenant_id = ${lit(tenant)} AND company_id = ${lit(company)} AND status <> 'CANCELLED'
      AND pay_date BETWEEN ${lit(today)} AND ${lit(addDays(today, 14))} ORDER BY pay_date LIMIT 1`)
    if (payRun) check('around you (reader): payday from the company’s payroll run', items.some((i) => i.kind === 'PAYDAY' && i.refId === payRun))
    else check('around you (reader): no payday without a payroll run in the window', !items.some((i) => i.kind === 'PAYDAY'))

    const m = await mgr.call('/v1/ess/around-me?days=14')
    const p = (m.body?.items || []).find((i) => i.kind === 'PROBATION_END' && i.employeeId === colleague)
    check('around you (mgr): their team’s probation end', m.status === 200 && !!p && p.date === addDays(today, 6) && (m.body?.unavailable || []).length === 0, JSON.stringify(p))
    const hr = await hrm.call('/v1/ess/around-me?days=14')
    check('around you (hrm): not someone else’s team', hr.status === 200 && !(hr.body?.items || []).some((i) => i.kind === 'PROBATION_END' && i.employeeId === colleague))
    const md = await mgr.call('/v1/ess/needs-you')
    check('needs you (mgr): seeing a probation date is not deciding it', !(md.body?.items || []).some((i) => i.kind === 'PROBATION_DECISION'))
  }

  // ── BW-35 · a batch of days from home ─────────────────────────────────────
  {
    // Three days, a run of two and one on its own, where reader has nothing yet.
    let d = addDays(today, 40)
    const free = (day) => sql(`SELECT count(*) FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND employee_id = ${lit(READER)}
      AND status IN ('PENDING','APPROVED') AND from_date <= ${lit(addDays(day, 3))} AND to_date >= ${lit(day)}`) === '0'
    for (let i = 0; i < 60 && !free(d); i++) d = addDays(d, 7)
    const days = [addDays(d, 3), d, addDays(d, 1)]
    const preview = await reader.call('/v1/me/approvers?for=wfh')
    const before = sql(`SELECT count(*) FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND employee_id = ${lit(READER)}`)
    const r = await reader.call('/v1/wfh/batch', 'POST', { dates: days, reason: 'Live P-HOME batch check: plumber and electrician visits' })
    const reqs = r.body?.requests || []
    reqs.forEach((x) => created.wfh.push(x.id))
    check('WFH batch: 201, one request per run of days', r.status === 201 && reqs.length === 2 && r.body?.days === 3
      && reqs[0].fromDate === d && reqs[0].toDate === addDays(d, 1) && reqs[1].fromDate === addDays(d, 3), JSON.stringify(r.body).slice(0, 300))
    check('WFH batch: sent to the person the preview names', reqs.length > 0 && reqs.every((x) => x.approverId === preview.body?.approver?.employeeId
      && x.approverName === preview.body?.approver?.name && x.status === 'PENDING'), `${reqs.map((x) => x.approverName).join(',')} vs ${preview.body?.approver?.name}`)
    let notes = []
    for (let i = 0; i < 10; i++) {
      notes = reqs.length ? sql(`SELECT user_id || '|' || body FROM notif.notifications WHERE tenant_id = ${lit(tenant)} AND type = 'WFH_SUBMITTED'
        AND (data->>'wfhRequestId' IN (${reqs.map((x) => lit(x.id)).join(',')}))`).split('\n').filter(Boolean) : []
      if (notes.length) break
      await sleep(300)
    }
    check('WFH batch: the approver is told once, about every day', notes.length === 1 && notes[0].startsWith(preview.body?.approver?.employeeId)
      && notes[0].includes('on 3 days:'), notes.join(' || '))
    const overlap = await reader.call('/v1/wfh/batch', 'POST', { dates: [addDays(d, 1), addDays(d, 10)], reason: 'Live P-HOME overlap check' })
    const after = sql(`SELECT count(*) FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND employee_id = ${lit(READER)}`)
    check('WFH batch: an overlap is refused and nothing is saved', overlap.status === 422 && overlap.body?.errorCode === 'WFH_OVERLAP'
      && Number(after) === Number(before) + 2, `${overlap.status} ${overlap.body?.errorCode} ${before}→${after}`)
    const queue = await mgr.call('/v1/wfh/pending-approvals?size=100')
    const queued = new Set((queue.body?.content || []).map((x) => x.id))
    check('WFH batch: both requests wait in the manager’s queue', reqs.every((x) => queued.has(x.id)))
    const mine = await reader.call('/v1/ess/my-requests?limit=20')
    const rows = (mine.body?.requests || []).filter((x) => reqs.some((q) => q.id === x.id))
    check('my requests: the batch shows as waiting, with who has it', rows.length === 2 && rows.every((x) => x.state === 'WAITING'
      && x.waitingForName === preview.body?.approver?.name && x.progress === 50), JSON.stringify(rows.map((x) => [x.state, x.waitingForName, x.progress])))
    let cancelled = 0
    for (const x of reqs) if ((await reader.call(`/v1/wfh/${x.id}/cancel`, 'POST')).status === 204) cancelled++
    const again = await reader.call('/v1/ess/my-requests?limit=20')
    const gone = (again.body?.requests || []).filter((x) => reqs.some((q) => q.id === x.id))
    check('WFH batch: cancelled again', cancelled === 2 && gone.every((x) => x.state === 'CANCELLED'), `${cancelled} cancelled`)
    const empty = await mgr.call('/v1/wfh/batch', 'POST', { dates: [], reason: 'x' })
    check('WFH batch: an empty list of days is refused (400)', empty.status === 400, String(empty.status))
  }

  // ── a person whose self-service permissions are taken away ──────────────
  {
    const role = await owner.call('/v1/rbac/roles', 'POST', { code: `QA_PHOME_${Date.now()}`, displayName: 'P-HOME live check', description: 'Temporary; removed by the test' })
    if (role.body?.id) created.roles.push(role.body.id)
    const perms = await owner.call(`/v1/rbac/roles/${role.body?.id}/permissions`, 'PUT', ['hrms.ess.read'])
    const employee = randomUUID(), user = randomUUID(), email = `qa-phome-${user}@example.invalid`
    sql(`BEGIN;
      INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, email, employment_type, employment_status)
        VALUES (${lit(employee)}, ${lit(tenant)}, ${lit(company)}, ${lit('PHR-' + employee.slice(0, 8))}, 'Hometest', 'Limited', ${lit(email)}, 'FULL_TIME', 'ACTIVE');
      INSERT INTO auth.user_credentials(id, tenant_id, email, password_hash, employee_id, is_active)
        SELECT ${lit(user)}, ${lit(tenant)}, ${lit(email)}, password_hash, ${lit(employee)}, true FROM auth.user_credentials
         WHERE tenant_id = ${lit(tenant)} AND email = 'owner@unifiedtree.demo';
      INSERT INTO rbac.user_roles(tenant_id, user_id, role_id) VALUES (${lit(tenant)}, ${lit(user)}, ${lit(role.body?.id)});
      COMMIT;`)
    created.employees.push(employee)
    created.users.push(user)
    // Every employee gets the EMPLOYEE role's permissions on top of their roles; a per-person DENY is how one is taken away.
    const denied = ['wfh.request.self', 'leave.balance.read', 'attendance.checkin.self', 'hrms.expense.claim.self', 'hrms.advance.request.self',
      'hrms.document.read.self', 'hrms.document.type.read', 'hrms.onboarding.task.complete', 'hrms.hiring.interview.self', 'hrms.hiring.read',
      'hrms.performance.review.self', 'hrms.policy.acknowledge.self', 'payroll.payslip.read.self', 'attendance.team.read', 'hrms.leave.approve.l1',
      'hrms.onboarding.asset.self']
    // (hrms.probation.team.decide isn't in the catalogue until P-TEAM's migration; nobody here holds it.)
    const deny = await owner.call(`/v1/workspace/users/${user}/permissions`, 'PUT', { overrides: denied.map((c) => ({ permissionCode: c, effect: 'DENY', reason: 'P-HOME live check (temporary)' })) })
    check('restricted person: a custom role and per-person DENY overrides', role.status === 201 && perms.status === 200 && deny.status === 200, `${role.status} ${perms.status} ${deny.status} ${JSON.stringify(deny.body).slice(0, 200)}`)
    const limited = await login(email)
    const stillHeld = denied.filter((c) => limited.perms.has(c))
    check('restricted person: signs in without those permissions', stillHeld.length === 0 && limited.perms.has('hrms.ess.read'), stillHeld.join(','))
    const batch = await limited.call('/v1/wfh/batch', 'POST', { dates: [addDays(today, 50)], reason: 'Should be refused' })
    check('restricted person: the WFH batch is refused (403)', batch.status === 403, String(batch.status))
    const r = await limited.call('/v1/ess/my-requests')
    check('restricted person: my requests reads no kind it may not see', r.status === 200 && (r.body?.included || []).length === 0 && (r.body?.requests || []).length === 0, JSON.stringify(r.body))
    const n = await limited.call('/v1/ess/needs-you')
    check('restricted person: needs you reads no source it may not see', n.status === 200 && (n.body?.included || []).length === 0 && n.body?.count === 0, JSON.stringify(n.body))
    const a = await limited.call('/v1/ess/around-me')
    const inc = a.body?.included || []
    check('restricted person: around you keeps what anyone signed in sees, and only that', a.status === 200
      && ['BIRTHDAY', 'HOLIDAY', 'NOTICE', 'WORK_ANNIVERSARY'].every((k) => inc.includes(k)) && !inc.includes('PAYDAY') && !inc.includes('PROBATION_END'), inc.join(','))
    const p = await limited.call('/v1/me/approvers?for=leave')
    check('restricted person: the approver preview needs only a session', p.status === 200 && p.body?.for === 'leave', JSON.stringify(p.body))
    for (const path of ['/v1/ess/my-requests', '/v1/ess/needs-you', '/v1/ess/around-me']) {
      const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant } })
      check(`${path}: 401 without a session`, res.status === 401, String(res.status))
    }
  }

  // ── one failing source never fails the list (live slot only) ──────────────
  if (db === 'ut_w3_dev') {
    const before = await reader.call('/v1/ess/my-requests?limit=20')
    const kinds = new Set((before.body?.requests || []).map((x) => x.kind))
    sql('ALTER TABLE advance_mgmt.advance_requests RENAME TO advance_requests_phome_off')
    renamed.push(['advance_mgmt.advance_requests_phome_off', 'advance_requests'])
    sql('ALTER TABLE hiring_mgmt.interview_scorecards RENAME TO interview_scorecards_phome_off')
    renamed.push(['hiring_mgmt.interview_scorecards_phome_off', 'interview_scorecards'])
    try {
      const r = await reader.call('/v1/ess/my-requests?limit=20')
      const still = (r.body?.requests || []).filter((x) => x.kind !== 'ADVANCE')
      check('isolation: my requests answers without the advances table, and says so', r.status === 200
        && JSON.stringify(r.body?.unavailable) === '["ADVANCE"]' && (still.length > 0 || kinds.size === 0), JSON.stringify(r.body?.unavailable))
      const n = await reader.call('/v1/ess/needs-you')
      check('isolation: needs you answers without the scorecards table, and says so', n.status === 200
        && JSON.stringify(n.body?.unavailable) === '["INTERVIEW_SCORECARD"]' && (n.body?.items || []).length > 0, JSON.stringify(n.body?.unavailable))
    } finally {
      for (const [from, to] of renamed.splice(0)) sql(`ALTER TABLE ${from} RENAME TO ${to}`)
    }
    const back = await reader.call('/v1/ess/my-requests?limit=20')
    check('isolation: back to normal once the tables are back', back.status === 200 && (back.body?.unavailable || []).length === 0)
  } else {
    console.log(`SKIP  isolation step: only in the live slot's ut_w3_dev (this run: ${db})`)
  }
} catch (e) {
  check('run finished', false, String(e?.stack || e).slice(0, 500))
} finally {
  // Put everything back.
  try { for (const [from, to] of renamed) sql(`ALTER TABLE ${from} RENAME TO ${to}`) } catch (e) { console.log('cleanup (rename):', String(e).split('\n')[0]) }
  try {
    // Anything a temporary person managed to request, too.
    for (const id of created.employees) {
      const theirs = sql(`SELECT id FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND employee_id = ${lit(id)}`).split('\n').filter(Boolean)
      created.wfh.push(...theirs)
    }
    if (created.wfh.length) {
      const ids = created.wfh.map(lit).join(',')
      sql(`DELETE FROM notif.notifications WHERE tenant_id = ${lit(tenant)} AND data->>'wfhRequestId' IN (${ids})`)
      sql(`DELETE FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND id IN (${ids})`)
    }
  } catch (e) { console.log('cleanup (wfh):', String(e).split('\n')[0]) }
  for (const id of created.notices) {
    try { await owner?.call(`/v1/admin/dashboard/notices/${id}`, 'DELETE'); sql(`DELETE FROM hrms.company_notices WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}`) } catch (e) { console.log('cleanup (notice):', String(e).split('\n')[0]) }
  }
  for (const id of created.holidays) {
    try { await owner?.call(`/v1/settings/holidays/${id}`, 'DELETE'); sql(`DELETE FROM settings.holiday_calendar WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}`) } catch (e) { console.log('cleanup (holiday):', String(e).split('\n')[0]) }
  }
  for (const id of created.users) {
    try { sql(`BEGIN; DELETE FROM rbac.user_permission_overrides WHERE user_id = ${lit(id)}; DELETE FROM rbac.user_roles WHERE tenant_id = ${lit(tenant)} AND user_id = ${lit(id)}; DELETE FROM auth.refresh_tokens WHERE user_id = ${lit(id)}; DELETE FROM auth.user_credentials WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}; COMMIT;`) } catch {
      try { sql(`BEGIN; DELETE FROM rbac.user_permission_overrides WHERE user_id = ${lit(id)}; DELETE FROM rbac.user_roles WHERE tenant_id = ${lit(tenant)} AND user_id = ${lit(id)}; DELETE FROM auth.user_credentials WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}; COMMIT;`) } catch (e2) { console.log('cleanup (user):', String(e2).split('\n')[0]) }
    }
  }
  for (const id of created.employees) {
    try { sql(`DELETE FROM hrms.employees WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}`) } catch (e) { console.log('cleanup (employee):', String(e).split('\n')[0]) }
  }
  for (const id of created.roles) {
    try { await owner?.call(`/v1/rbac/roles/${id}`, 'DELETE') } catch (e) { console.log('cleanup (role):', String(e).split('\n')[0]) }
  }
  try {
    const left = sql(`SELECT (SELECT count(*) FROM hrms.employees WHERE tenant_id = ${lit(tenant)} AND first_name = 'Hometest')
      + (SELECT count(*) FROM hrms.company_notices WHERE tenant_id = ${lit(tenant)} AND title LIKE 'P-HOME live %')
      + (SELECT count(*) FROM settings.holiday_calendar WHERE tenant_id = ${lit(tenant)} AND holiday_name LIKE 'P-HOME live %')
      + (SELECT count(*) FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND reason LIKE 'Live P-HOME %')
      + (SELECT count(*) FROM rbac.roles WHERE code LIKE 'QA_PHOME_%')
      + (SELECT count(*) FROM rbac.user_permission_overrides WHERE reason = 'P-HOME live check (temporary)')
      + (SELECT count(*) FROM auth.user_credentials WHERE email LIKE 'qa-phome-%')`)
    check('cleanup: nothing the check made is left', left === '0', `${left} left`)
  } catch (e) { check('cleanup: nothing the check made is left', false, String(e).split('\n')[0]) }
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
