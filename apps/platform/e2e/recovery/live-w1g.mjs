// Live check of w1g (25 Sep): search, permission-only menus and dashboard,
// coming-soon modules, and branch geofences after the Geofencing page was
// retired. API only (no browser). Against a LOCAL backend and database.
//
//  - People search (GET /v1/search, changed): word-by-word partial matches
//    ("rea emp", "user reader") agree with the database, LIKE characters stay
//    literal, short queries are 400, and callers without hrms.employee.read
//    are refused (403).
//  - Permission-only menus: each role's grants back the menu rules
//    (self-service for employees, My team for team-scoped approvers, the
//    directory / branches / payroll only for holders), and the endpoint
//    behind each rule answers exactly those people (200) and refuses the
//    rest (403).
//  - Dashboard: every section's endpoint refuses exactly the roles the
//    section is now hidden from.
//  - Coming-soon modules: the catalogue still has them (the launcher shows
//    them to plan admins only) and the plan endpoints refuse non-admins.
//  - Branch geofence (where punch zones live now): HR saves it, managers and
//    employees are refused, and the employee's punch check uses it (inside
//    = allowed, far away = outside). The branch and the audit rows the check
//    writes are put back / removed.
//
//   node e2e/recovery/live-w1g.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => console.log(`SKIP  ${name}  — ${why}`)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const claims = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString())
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  const perms = new Set(claims.permissions || [])
  return { email, call, perms, has: (c) => perms.has(c) || perms.has('*'), roles: claims.roles || [], employeeId: claims.employee_id || null }
}

const started = sql('select now()')
let branch = null
try {
  const [owner, hrm, fin, mgr, reader] = await Promise.all(['owner', 'hrm', 'fin', 'mgr', 'reader'].map((u) => login(`${u}@unifiedtree.demo`)))
  const everyone = [owner, hrm, fin, mgr, reader]
  const companyId = sql(`select company_id from hrms.employees where id='${READER}'`)

  // ── 1. People search ─────────────────────────────────────────────────────
  const tokensSql = (words) => `select e.id from hrms.employees e left join hrms.departments d on d.id=e.department_id left join hrms.designations g on g.id=e.designation_id
     where e.tenant_id='${tenant}' and e.is_active and ${words.map((w) => `(lower(e.employee_code) like ${lit('%' + w + '%')} or lower(e.first_name) like ${lit('%' + w + '%')} or lower(e.last_name) like ${lit('%' + w + '%')} or lower(e.email) like ${lit('%' + w + '%')} or lower(coalesce(d.name,'')) like ${lit('%' + w + '%')} or lower(coalesce(g.title,'')) like ${lit('%' + w + '%')})`).join(' and ')}`
  const words = await owner.call('/v1/search?q=' + encodeURIComponent('rea emp') + '&limit=20')
  const wordIds = new Set((words.json?.employees || []).map((e) => e.id))
  const expected = sql(tokensSql(['rea', 'emp'])).split(/\s+/).filter(Boolean)
  check('search: "rea emp" matches word by word (name + code) like the database', words.status === 200 && wordIds.has(READER) && expected.every((id) => wordIds.has(id)) && wordIds.size === expected.length,
    `status=${words.status} api=${wordIds.size} db=${expected.length}`)
  const reversed = await owner.call('/v1/search?q=' + encodeURIComponent('user reader'))
  check('search: words in any order ("user reader")', reversed.status === 200 && (reversed.json?.employees || []).some((e) => e.id === READER), `status=${reversed.status}`)
  const whole = await owner.call('/v1/search?q=' + encodeURIComponent('Reader User'))
  check('search: the full name still ranks the person first', whole.status === 200 && whole.json?.employees?.[0]?.id === READER, whole.json?.employees?.[0]?.displayName || '')
  const deptRow = sql(`select lower(split_part(d.name,' ',array_length(string_to_array(d.name,' '),1))) || '|' || lower(e.first_name) || '|' || e.id from hrms.employees e join hrms.departments d on d.id=e.department_id where e.tenant_id='${tenant}' and e.is_active and length(e.first_name) >= 3 limit 1`)
  if (deptRow) {
    const [dep, first, id] = deptRow.split('|')
    const q = `${dep.slice(0, 5)} ${first.slice(0, 3)}`
    const r = await owner.call('/v1/search?q=' + encodeURIComponent(q) + '&limit=20')
    check(`search: department + name words ("${q}")`, r.status === 200 && (r.json?.employees || []).some((e) => e.id === id), `status=${r.status}`)
  } else skip('search: department + name words', 'no active employee with a department in this database')
  const literal = await owner.call('/v1/search?q=' + encodeURIComponent('%_'))
  const pct = sql(`select count(*) from hrms.employees e left join hrms.departments d on d.id=e.department_id left join hrms.designations g on g.id=e.designation_id
     where e.tenant_id='${tenant}' and e.is_active and (e.first_name like '%\\%\\_%' or e.last_name like '%\\%\\_%' or e.employee_code like '%\\%\\_%' or e.email like '%\\%\\_%' or coalesce(d.name,'') like '%\\%\\_%' or coalesce(g.title,'') like '%\\%\\_%')`)
  check('search: % and _ are matched literally, not as wildcards', literal.status === 200 && (literal.json?.employees || []).length === Number(pct), `hits=${literal.json?.employees?.length} db=${pct}`)
  const short = await owner.call('/v1/search?q=r')
  check('search: a one-character query is refused (400)', short.status === 400, `status=${short.status}`)
  for (const u of everyone) {
    const r = await u.call('/v1/search?q=' + encodeURIComponent('rea emp'))
    const want = u.has('hrms.employee.read') ? 200 : 403
    check(`search: ${u.email} → ${want} (${want === 200 ? 'holds' : 'lacks'} hrms.employee.read)`, r.status === want, `status=${r.status}`)
  }

  // ── 2. Permission-only menus: the grants behind each rule, and the endpoint behind it ──
  check('menu: the employee has self-service grants and an employee record', ['hrms.ess.read', 'attendance.checkin.self', 'leave.request.self', 'payroll.payslip.read.self'].every(reader.has) && !!reader.employeeId)
  check('menu: the employee has none of the admin grants (directory, team, payroll, branches)', !['hrms.employee.read', 'attendance.team.read', 'payroll.runs.read', 'hrms.branch.read'].some(reader.has))
  check('menu: the manager is a team-scoped approver (My team shown, directory hidden)', mgr.has('attendance.team.read') && mgr.has('hrms.leave.approve.l1') && !mgr.has('hrms.employee.read'))
  check('menu: HR holds the directory and branch grants (My team stays hidden for HR)', hrm.has('hrms.employee.read') && hrm.has('hrms.branch.read'))
  const guarded = [
    ['Workforce Directory', 'hrms.employee.read', '/v1/hrms/employees?page=0&pageSize=1'],
    ['Daily Tracking (team)', 'attendance.team.read', '/v1/attendance/dashboard'],
    ['Processing & Payslips', 'payroll.runs.read', '/v1/payroll/runs'],
    ['Leave approvals', 'hrms.leave.approve.l1', '/v1/leave/approvals/pending?page=0&size=1'],
  ]
  for (const [label, perm, path] of guarded) {
    const bad = []
    for (const u of everyone) {
      const r = await u.call(path)
      const ok = u.has(perm) ? r.status === 200 : r.status === 403
      if (!ok) bad.push(`${u.email.split('@')[0]}=${r.status}`)
    }
    check(`menu: "${label}" shows for exactly the roles its endpoint serves (${perm})`, bad.length === 0, bad.join(' '))
  }

  // ── 3. Dashboard: each hidden section's endpoint refuses the roles it's hidden from ──
  const sections = [
    ['Company summary / notices', 'org.company.read', `/v1/admin/dashboard/stats?companyId=${companyId}`],
    ['Top performers', 'hrms.performance.read', `/v1/admin/dashboard/performers?companyId=${companyId}`],
    ['Onboarding progress', 'hrms.onboarding.instance.write', `/v1/admin/dashboard/onboarding?companyId=${companyId}`],
    ['Hiring pipeline', 'hrms.hiring.read', `/v1/admin/dashboard/hiring?companyId=${companyId}`],
    ['Projects & Productivity', 'hrms.project.read', `/v1/hrms/projects?companyId=${companyId}`],
    ['Recent activity', 'audit.read', '/v1/audit/events?page=0&size=5'],
    ['Attendance analytics', 'attendance.team.read', '/v1/attendance/dashboard/trend'],
  ]
  for (const [label, perm, path] of sections) {
    const bad = []
    for (const u of [owner, hrm, fin, mgr]) {
      const r = await u.call(path)
      const ok = u.has(perm) ? r.status === 200 : r.status === 403
      if (!ok) bad.push(`${u.email.split('@')[0]}=${r.status}`)
    }
    check(`dashboard: "${label}" is shown only where its endpoint answers (${perm})`, bad.length === 0, bad.join(' '))
  }

  // ── 4. Coming-soon modules ───────────────────────────────────────────────
  const plans = await fetch(`${api}/v1/public/module-plans`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => []) }))
  const soon = (plans.json || []).filter((p) => p.status === 'LAUNCHING_SOON')
  const me = await reader.call('/v1/canonical-auth/me')
  const active = me.json?.activeModules || []
  check('modules: the catalogue lists coming-soon apps (shown to plan admins only)', plans.status === 200 && soon.length > 0, `${soon.length} coming soon`)
  check('modules: none of the coming-soon apps is active for this workspace', soon.every((p) => !(p.includedModules || []).some((m) => active.includes(m))), active.join(','))
  for (const u of [reader, hrm, mgr]) {
    const r = await u.call('/v1/workspace/plan/current')
    check(`modules: the plan endpoint refuses ${u.email} (no request-module flow for non-admins)`, r.status === 403, `status=${r.status}`)
  }

  // ── 5. Branch geofence (Geofencing page retired) ─────────────────────────
  branch = sql(`select id||'|'||coalesce(latitude::text,'')||'|'||coalesce(longitude::text,'')||'|'||coalesce(geo_fence_radius_meters::text,'')||'|'||geo_fence_enforced
    from org.branches where tenant_id='${tenant}' and company_id='${companyId}' and is_active order by is_headquarters desc, name limit 1`)
  if (!branch) throw new Error('no active branch for the employee’s company')
  const [branchId] = branch.split('|')
  const zoneOverride = sql(`select coalesce(geo_fence_zone_id::text,'') from hrms.employees where id='${READER}'`)
  const body = { latitude: 17.385044, longitude: 78.486671, radiusMeters: 250, enforced: true }
  for (const u of [mgr, reader]) {
    const r = await u.call(`/v1/hrms/branches/${branchId}/geofence`, 'PUT', body)
    check(`geofence: ${u.email} cannot change a branch punch zone (403)`, r.status === 403, `status=${r.status}`)
  }
  check('geofence: refused saves changed nothing', sql(`select coalesce(geo_fence_radius_meters::text,'') from org.branches where id='${branchId}'`) === branch.split('|')[3])
  const saved = await hrm.call(`/v1/hrms/branches/${branchId}/geofence`, 'PUT', body)
  const row = sql(`select latitude||'|'||longitude||'|'||geo_fence_radius_meters||'|'||geo_fence_enforced from org.branches where id='${branchId}'`).split('|')
  check('geofence: HR saves the branch punch zone', saved.status === 200 && Math.abs(Number(row[0]) - 17.385044) < 1e-6 && Math.abs(Number(row[1]) - 78.486671) < 1e-6 && row[2] === '250' && /^t(rue)?$/.test(row[3]), `status=${saved.status} db=${row.join(',')}`)
  const wfhToday = sql(`select count(*) from leave_mgmt.wfh_requests where employee_id='${READER}' and status='APPROVED' and (now() at time zone 'Asia/Kolkata')::date between from_date and to_date`)
  if (zoneOverride) skip('geofence: the punch check uses the branch zone', 'the employee has a personal zone override')
  else if (wfhToday !== '0') skip('geofence: the punch check uses the branch zone', 'the employee has approved WFH today (any place is allowed)')
  else {
    const inside = await reader.call('/v1/attendance/geo-fence/check', 'POST', { latitude: 17.3851, longitude: 78.4867 })
    check('geofence: a punch inside the branch zone is allowed', inside.status === 200 && inside.json?.withinFence === true && inside.json?.branchId === branchId, `status=${inside.status} within=${inside.json?.withinFence}`)
    const outside = await reader.call('/v1/attendance/geo-fence/check', 'POST', { latitude: 12.9716, longitude: 77.5946 })
    check('geofence: a punch far from the branch is outside the zone', outside.status === 200 && outside.json?.withinFence === false && Number(outside.json?.distanceMeters) > 250, `status=${outside.status} distance=${Math.round(outside.json?.distanceMeters || 0)}m`)
  }
  const zones = await hrm.call('/v1/attendance/geofence/zones')
  check('geofence: existing personal zones still list for the employee form', zones.status === 200 && Array.isArray(zones.json), `status=${zones.status}`)
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  if (branch) {
    const [id, lat, lon, radius, enforced] = branch.split('|')
    try {
      sql(`update org.branches set latitude=${lat ? lit(lat) : 'null'}, longitude=${lon ? lit(lon) : 'null'}, geo_fence_radius_meters=${radius ? Number(radius) : 'null'}, geo_fence_enforced=${/^t(rue)?$/.test(enforced)} where id='${id}'`)
      sql(`delete from public.geo_fence_audits where employee_id='${READER}' and created_at >= ${lit(started)}`)
    } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
    const back = sql(`select coalesce(latitude::text,'')||'|'||coalesce(longitude::text,'')||'|'||coalesce(geo_fence_radius_meters::text,'')||'|'||geo_fence_enforced from org.branches where id='${id}'`)
    const audits = sql(`select count(*) from public.geo_fence_audits where employee_id='${READER}' and created_at >= ${lit(started)}`)
    check('cleanup: branch geofence restored and check audits removed', back === [lat, lon, radius, enforced].join('|') && audits === '0', `branch=${back} audits=${audits}`)
  }
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
