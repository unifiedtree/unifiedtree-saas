// Live API check of w1h: roles & permissions (V143.17 / V143.17.1).
//  - Every permission has a description and a risk level; HIGH / CRITICAL
//    ones carry a warning. The catalogue API returns them.
//  - Per-person overrides: GET/PUT /v1/workspace/users/{id}/permissions.
//    A GRANT reaches the person's token, /me and the @perm bean; a DENY takes
//    a permission their role gives away; expired overrides are ignored.
//    Reason required, past end dates refused, high-risk grants need
//    acknowledgeRisk, platform permissions refused. Audited.
//  - Levels: nobody changes their own access, only the owner changes the
//    owner, you only give what you hold, critical permissions and the
//    Owner / Super admin roles only from the owner.
//  - Custom roles: duplicate a built-in role, add a permission (confirmed),
//    give it to someone, take it away, delete it. Audited.
//  - Role-name checks replaced by permissions (/v1/employees, settings,
//    tenant compat, milestones, attendance scope, performance scope, plan,
//    module buying): built-in roles keep their access, others get 403.
// Everything created is removed at the end. No browser.
//
//   node e2e/recovery/live-w1h.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const PSQL = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const READER_EMP = '22222222-2222-2222-2222-222222222222'
const MGR_EMP = '44444444-4444-4444-4444-444444444444'
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  const perms = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || []
  return { call, perms, userId: d.userId }
}
const code = (r) => r.json?.errorCode || r.json?.error || r.json?.code || ''
const msg = (r) => r.json?.message || ''
const stamp = Date.now()
const tomorrow = new Date(Date.now() + 36 * 3600e3).toISOString()
const created = { roles: [], departments: [], overrideUsers: new Set(), userRoles: [], weeklyOffs: null, auditFrom: new Date().toISOString() }

try {
  const owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo') // SUPER_ADMIN, not owner
  const hrm = await login('hrm@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  let mgr = await login('mgr@unifiedtree.demo')
  const users = (await owner.call('/v1/workspace/users')).json || []
  const idOf = (email) => users.find((u) => u.email === email)?.userId
  const OWNER = idOf('owner@unifiedtree.demo'), ADMIN = idOf('admin@unifiedtree.demo'), MGR = idOf('mgr@unifiedtree.demo'), READER = idOf('reader@unifiedtree.demo')
  check('fixture: demo users found', OWNER && ADMIN && MGR && READER)

  // ── 1. catalogue: descriptions, risk levels, warnings ─────────────────────
  check('db: every permission has a description', sql(`select count(*) from rbac.permissions where description is null or btrim(description) = ''`) === '0')
  check('db: HIGH / CRITICAL permissions all carry a warning', sql(`select count(*) from rbac.permissions where risk_level in ('HIGH','CRITICAL') and warning is null`) === '0')
  check('db: OWNER and SUPER_ADMIN hold the new permissions', sql(`select count(*) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id where r.tenant_id is null and r.code in ('OWNER','SUPER_ADMIN') and rp.permission_code in ('rbac.access.manage-overrides','hrms.employee.team.manage')`) === '4')
  check('db: DEPT_MANAGER holds hrms.employee.team.manage', sql(`select count(*) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id where r.tenant_id is null and r.code = 'DEPT_MANAGER' and rp.permission_code = 'hrms.employee.team.manage'`) === '1')
  const cat = await owner.call('/v1/rbac/permissions')
  const salary = (cat.json || []).find((p) => p.code === 'payroll.structure.read')
  check('api: catalogue returns description, risk and warning', cat.status === 200 && salary?.riskLevel === 'HIGH' && /salary/i.test(salary?.warning || '') && !!salary?.description, `status=${cat.status} risk=${salary?.riskLevel}`)
  check('api: rbac.access.manage-overrides is CRITICAL', (cat.json || []).find((p) => p.code === 'rbac.access.manage-overrides')?.riskLevel === 'CRITICAL')
  check('api: reader cannot read the catalogue', (await reader.call('/v1/rbac/permissions')).status === 403)

  // ── 2. per-person overrides ────────────────────────────────────────────────
  const view0 = await owner.call(`/v1/workspace/users/${MGR}/permissions`)
  const src = (view0.json?.effective || []).find((e) => e.code === 'hrms.advance.approve')?.sources || []
  check('api: GET permissions shows where each permission comes from', view0.status === 200 && src.some((s) => /Role: /.test(s)) && view0.json?.canEdit === true, `status=${view0.status} sources=${src.join('|')}`)
  check('api: reader cannot view someone’s permissions', (await reader.call(`/v1/workspace/users/${MGR}/permissions`)).status === 403)
  check('api: manager (no users.read) cannot view them either', (await mgr.call(`/v1/workspace/users/${READER}/permissions`)).status === 403)

  // Control: before any override the manager passes the @perm check (an unknown request id, so nothing is decided).
  const beforeDecide = await mgr.call(`/v1/advance/requests/${crypto.randomUUID()}/decision`, 'POST', { approved: false, comment: 'QA w1h' })
  check('control: manager passes @perm.check(hrms.advance.approve) before the DENY', beforeDecide.status !== 403, `status=${beforeDecide.status}`)

  created.overrideUsers.add(MGR)
  const give = [{ permissionCode: 'payroll.structure.read', effect: 'GRANT', reason: `QA w1h ${stamp}: covers payroll review`, expiresAt: null }]
  const noAck = await owner.call(`/v1/workspace/users/${MGR}/permissions`, 'PUT', { overrides: give, acknowledgeRisk: false })
  check('api: a HIGH grant without confirming the warning is refused', noAck.status === 422 && code(noAck) === 'RISK_NOT_ACKNOWLEDGED', `status=${noAck.status} ${code(noAck)}`)
  const noReason = await owner.call(`/v1/workspace/users/${MGR}/permissions`, 'PUT', { overrides: [{ ...give[0], reason: '  ' }], acknowledgeRisk: true })
  check('api: a reason is required', noReason.status === 422 && code(noReason) === 'REASON_REQUIRED', `status=${noReason.status}`)
  const past = await owner.call(`/v1/workspace/users/${MGR}/permissions`, 'PUT', { overrides: [{ ...give[0], expiresAt: new Date(Date.now() - 3600e3).toISOString() }], acknowledgeRisk: true })
  check('api: an end date in the past is refused', past.status === 422 && code(past) === 'EXPIRY_IN_PAST', `status=${past.status}`)
  const plat = await owner.call(`/v1/workspace/users/${MGR}/permissions`, 'PUT', { overrides: [{ permissionCode: 'platform.admin', effect: 'GRANT', reason: 'QA', expiresAt: null }], acknowledgeRisk: true })
  check('api: platform permissions are never given', plat.status === 403, `status=${plat.status}`)
  check('db: refused changes wrote nothing', sql(`select count(*) from rbac.user_permission_overrides where user_id = '${MGR}'`) === '0')

  const both = [...give, { permissionCode: 'hrms.advance.approve', effect: 'DENY', reason: `QA w1h ${stamp}: conflict of interest`, expiresAt: tomorrow }]
  const put = await owner.call(`/v1/workspace/users/${MGR}/permissions`, 'PUT', { overrides: both, acknowledgeRisk: true })
  check('api: owner gives one extra and removes one permission', put.status === 200 && put.json?.overrides?.length === 2, `status=${put.status} ${msg(put)}`)
  check('db: GRANT and DENY rows stored with reason, author and end date',
    sql(`select string_agg(effect || ':' || permission_code || ':' || (granted_by = '${OWNER}') || ':' || (expires_at is not null), ',' order by effect) from rbac.user_permission_overrides where user_id = '${MGR}'`)
      === 'DENY:hrms.advance.approve:true:true,GRANT:payroll.structure.read:true:false')
  check('api: view lists the removed permission separately', (put.json?.removed || []).some((e) => e.code === 'hrms.advance.approve')
    && (put.json?.effective || []).find((e) => e.code === 'payroll.structure.read')?.sources?.some((s) => /Extra permission/.test(s)))
  check('db: the change is in the audit log', Number(sql(`select count(*) from audit.events where tenant_id = '${tenant}' and module = 'rbac' and action = 'PERMISSION_CHANGE' and entity_type = 'USER' and entity_id = '${MGR}' and occurred_at >= '${created.auditFrom}' and diff ? 'added'`)) >= 1)

  // The @perm bean (DB, cache evicted on change) applies the DENY straight away, even with the old token.
  const oldTokenDecide = await mgr.call(`/v1/advance/requests/${crypto.randomUUID()}/decision`, 'POST', { approved: false, comment: 'QA w1h' })
  check('@perm: a DENY applies at once, even on the old token', oldTokenDecide.status === 403, `status=${oldTokenDecide.status}`)
  mgr = await login('mgr@unifiedtree.demo')
  check('jwt: the next sign-in carries the GRANT and drops the DENY', mgr.perms.includes('payroll.structure.read') && !mgr.perms.includes('hrms.advance.approve'))
  const me = await mgr.call('/v1/canonical-auth/me')
  check('/me: reports the same set', me.status === 200 && me.json?.permissions?.includes('payroll.structure.read') && !me.json?.permissions?.includes('hrms.advance.approve'))
  check('api: the GRANT opens a salary endpoint for this one manager', (await mgr.call(`/v1/payroll/structures/employee/${READER_EMP}`)).status !== 403)
  check('api: the DENY closes the approvals queue for this one manager', (await mgr.call('/v1/advance/requests/approvals')).status === 403)
  const rolesView = await owner.call(`/v1/rbac/users/${MGR}/roles`)
  check('api: Roles page “effective permissions” include overrides', rolesView.status === 200 && rolesView.json?.effectivePermissions?.includes('payroll.structure.read') && !rolesView.json?.effectivePermissions?.includes('hrms.advance.approve'))

  // Expired overrides are ignored.
  sql(`update rbac.user_permission_overrides set expires_at = now() - interval '1 minute' where user_id = '${MGR}' and permission_code = 'payroll.structure.read'`)
  mgr = await login('mgr@unifiedtree.demo')
  check('jwt: an expired GRANT no longer applies', !mgr.perms.includes('payroll.structure.read'))
  const expiredView = await owner.call(`/v1/workspace/users/${MGR}/permissions`)
  check('api: an expired override is shown as ended', expiredView.json?.overrides?.find((o) => o.permissionCode === 'payroll.structure.read')?.expired === true)

  // ── 3. levels ──────────────────────────────────────────────────────────────
  const self = await owner.call(`/v1/workspace/users/${OWNER}/permissions`, 'PUT', { overrides: [], acknowledgeRisk: false })
  check('levels: nobody changes their own overrides (owner either)', self.status === 403 && code(self) === 'CANNOT_EDIT_OWN_ACCESS', `status=${self.status} ${code(self)}`)
  const onOwner = await admin.call(`/v1/workspace/users/${OWNER}/permissions`, 'PUT', { overrides: [{ permissionCode: 'hrms.leave.read', effect: 'DENY', reason: 'QA', expiresAt: null }], acknowledgeRisk: false })
  check('levels: a super admin cannot change the owner', onOwner.status === 403 && code(onOwner) === 'OWNER_ONLY', `status=${onOwner.status}`)
  created.overrideUsers.add(READER)
  const critical = await admin.call(`/v1/workspace/users/${READER}/permissions`, 'PUT', { overrides: [{ permissionCode: 'rbac.access.manage-overrides', effect: 'GRANT', reason: 'QA', expiresAt: null }], acknowledgeRisk: true })
  check('levels: only the owner gives CRITICAL permissions', critical.status === 403 && code(critical) === 'CRITICAL_OWNER_ONLY', `status=${critical.status} ${code(critical)}`)
  check('levels: HR manager (no manage-overrides) is refused', (await hrm.call(`/v1/workspace/users/${READER}/permissions`, 'PUT', { overrides: [], acknowledgeRisk: false })).status === 403)
  check('db: refused level checks wrote nothing', sql(`select count(*) from rbac.user_permission_overrides where user_id in ('${READER}','${OWNER}')`) === '0')

  const asAdmin = (await admin.call('/v1/workspace/assignable-roles')).json || []
  const asOwner = (await owner.call('/v1/workspace/assignable-roles')).json || []
  check('levels: the super admin sees Owner as not givable, with a reason', asAdmin.find((r) => r.roleCode === 'OWNER')?.canGrant === false && !!asAdmin.find((r) => r.roleCode === 'OWNER')?.grantBlockedReason)
  check('levels: the owner can give Owner / Admin; nobody is offered MANAGER or platform roles', asOwner.find((r) => r.roleCode === 'OWNER')?.canGrant === true && asOwner.find((r) => r.roleCode === 'ADMIN')?.canGrant === true && !asOwner.some((r) => ['MANAGER', 'PLATFORM_SUPER_ADMIN'].includes(r.roleCode)))
  const saGrant = await admin.call(`/v1/workspace/users/${READER}/roles`, 'POST', { roleCode: 'SUPER_ADMIN' })
  check('levels: the super admin cannot give Super admin', saGrant.status === 403, `status=${saGrant.status}`)
  const selfRevoke = await admin.call(`/v1/workspace/users/${ADMIN}/roles/SUPER_ADMIN`, 'DELETE')
  check('levels: nobody removes their own role', selfRevoke.status === 403 && code(selfRevoke) === 'CANNOT_EDIT_OWN_ACCESS', `status=${selfRevoke.status}`)
  const ownerRevoke = await admin.call(`/v1/workspace/users/${OWNER}/roles/OWNER`, 'DELETE')
  check('levels: the super admin cannot take the owner’s role away', ownerRevoke.status === 403, `status=${ownerRevoke.status}`)
  check('db: every refused role change left the roles alone', sql(`select count(*) from rbac.user_roles ur join rbac.roles r on r.id = ur.role_id where (ur.user_id = '${READER}' and r.code = 'SUPER_ADMIN') or (ur.user_id = '${ADMIN}' and r.code = 'SUPER_ADMIN') or (ur.user_id = '${OWNER}' and r.code = 'OWNER')`) === '2')
  created.userRoles.push([READER, 'DEPT_MANAGER'])
  const give2 = await admin.call(`/v1/workspace/users/${READER}/roles`, 'POST', { roleCode: 'DEPT_MANAGER' })
  check('levels: the super admin can give a role whose permissions they hold', give2.status === 204, `status=${give2.status} ${msg(give2)}`)
  const take2 = await admin.call(`/v1/workspace/users/${READER}/roles/DEPT_MANAGER`, 'DELETE')
  check('levels: …and take it away again (both audited)', take2.status === 204 && sql(`select count(*) from rbac.user_roles ur join rbac.roles r on r.id = ur.role_id where ur.user_id = '${READER}' and r.code = 'DEPT_MANAGER'`) === '0'
    && Number(sql(`select count(*) from audit.events where tenant_id = '${tenant}' and module = 'rbac' and entity_id = '${READER}' and occurred_at >= '${created.auditFrom}' and (diff ? 'roleGiven' or diff ? 'roleRemoved')`)) >= 2)

  // ── 4. custom roles: duplicate, add a permission, give, take away, delete ──
  const deptRole = sql(`select id from rbac.roles where tenant_id is null and code = 'DEPT_MANAGER'`)
  const dup = await owner.call(`/v1/rbac/roles/${deptRole}/duplicate`, 'POST', { displayName: `QA Senior manager ${stamp}` })
  if (dup.json?.id) created.roles.push(dup.json.id)
  check('roles: duplicate Dept Manager as “Senior manager”', dup.status === 201 && dup.json?.code === `QA_SENIOR_MANAGER_${stamp}` && dup.json?.systemRole === false, `status=${dup.status} ${msg(dup)}`)
  const role = dup.json?.id
  check('db: the copy has exactly the source role’s permissions', role && sql(`select count(*) from rbac.role_permissions where role_id = '${role}'`) === sql(`select count(*) from rbac.role_permissions where role_id = '${deptRole}'`))
  check('db: the duplicate is audited', role && sql(`select count(*) from audit.events where tenant_id = '${tenant}' and entity_type = 'ROLE' and entity_id = '${role}' and action = 'CREATE'`) === '1')
  const renamed = await owner.call(`/v1/rbac/roles/${role}`, 'PUT', { displayName: `QA Senior manager ${stamp} (renamed)`, description: 'QA w1h rename' })
  check('roles: rename a custom role (audited)', renamed.status === 200 && renamed.json?.displayName === `QA Senior manager ${stamp} (renamed)`
    && sql(`select count(*) from audit.events where tenant_id = '${tenant}' and entity_type = 'ROLE' and entity_id = '${role}' and action = 'UPDATE'`) === '1', `status=${renamed.status} ${msg(renamed)}`)
  check('roles: reader cannot rename, duplicate or re-permission a role', (await reader.call(`/v1/rbac/roles/${role}`, 'PUT', { displayName: 'QA' })).status === 403
    && (await reader.call(`/v1/rbac/roles/${deptRole}/duplicate`, 'POST', { displayName: `QA reader ${stamp}` })).status === 403
    && (await reader.call(`/v1/rbac/roles/${role}/permissions?acknowledgeRisk=true`, 'PUT', ['hrms.leave.read'])).status === 403)
  check('roles: reader cannot read someone’s roles', (await reader.call(`/v1/rbac/users/${MGR}/roles`)).status === 403)
  const inviteOwner = await admin.call('/v1/workspace/users/invite', 'POST', { email: `qa-w1h-${stamp}@example.invalid`, firstName: 'QA', lastName: 'Invite', roleCodes: ['OWNER'], createEmployee: false })
  check('levels: the super admin cannot invite someone as Owner (nothing created)', inviteOwner.status === 403
    && sql(`select count(*) from auth.user_credentials where email = 'qa-w1h-${stamp}@example.invalid'`) === '0', `status=${inviteOwner.status} ${code(inviteOwner)}`)
  check('levels: reader cannot invite anyone', (await reader.call('/v1/workspace/users/invite', 'POST', { email: `qa-w1h-r-${stamp}@example.invalid`, roleCodes: [], createEmployee: false })).status === 403)
  const builtinCode = await owner.call('/v1/rbac/roles', 'POST', { code: 'OWNER', displayName: 'QA fake owner' })
  check('roles: a custom role cannot take a built-in role’s code', builtinCode.status === 422 && code(builtinCode) === 'ROLE_CODE_DUPLICATE', `status=${builtinCode.status}`)
  const adminRole = sql(`select id from rbac.roles where tenant_id is null and code = 'ADMIN'`)
  const dupCritical = await admin.call(`/v1/rbac/roles/${adminRole}/duplicate`, 'POST', { displayName: `QA admin copy ${stamp}` })
  if (dupCritical.json?.id) created.roles.push(dupCritical.json.id)
  check('roles: copying a role with critical permissions needs the owner', dupCritical.status === 403 && code(dupCritical) === 'CRITICAL_OWNER_ONLY', `status=${dupCritical.status} ${code(dupCritical)}`)
  check('roles: reader cannot create roles', (await reader.call('/v1/rbac/roles', 'POST', { code: `QA_R_${stamp}`, displayName: 'QA' })).status === 403)
  const current = (await owner.call(`/v1/rbac/roles/${role}/permissions`)).json || []
  const addNoAck = await owner.call(`/v1/rbac/roles/${role}/permissions`, 'PUT', [...current, 'payroll.structure.read'])
  check('roles: adding a HIGH permission needs the warning confirmed', addNoAck.status === 422 && code(addNoAck) === 'RISK_NOT_ACKNOWLEDGED', `status=${addNoAck.status}`)
  const addAck = await owner.call(`/v1/rbac/roles/${role}/permissions?acknowledgeRisk=true`, 'PUT', [...current, 'payroll.structure.read'])
  check('roles: …and is saved once confirmed (audited)', addAck.status === 200 && sql(`select count(*) from rbac.role_permissions where role_id = '${role}' and permission_code = 'payroll.structure.read'`) === '1'
    && sql(`select count(*) from audit.events where tenant_id = '${tenant}' and entity_type = 'ROLE' and entity_id = '${role}' and action = 'PERMISSION_CHANGE'`) === '1', `status=${addAck.status} ${msg(addAck)}`)
  const sysEdit = await owner.call(`/v1/rbac/roles/${deptRole}/permissions?acknowledgeRisk=true`, 'PUT', ['hrms.leave.read'])
  check('roles: built-in roles stay read-only', sysEdit.status === 422 && code(sysEdit) === 'SYSTEM_ROLE_LOCKED', `status=${sysEdit.status}`)
  const grantCustom = await owner.call(`/v1/rbac/users/${READER}/roles/${role}`, 'POST')
  check('roles: give the custom role from Roles & permissions', grantCustom.status === 201 && sql(`select count(*) from rbac.user_roles where user_id = '${READER}' and role_id = '${role}'`) === '1', `status=${grantCustom.status} ${msg(grantCustom)}`)
  const readerNow = await login('reader@unifiedtree.demo')
  check('jwt: the holder gets the role’s permissions at sign-in', readerNow.perms.includes('payroll.structure.read') && readerNow.perms.includes('hrms.employee.team.manage'))
  const selfGrant = await owner.call(`/v1/rbac/users/${OWNER}/roles/${role}`, 'POST')
  check('levels: the owner cannot give themselves a role either', selfGrant.status === 403, `status=${selfGrant.status}`)
  const revokeCustom = await owner.call(`/v1/rbac/users/${READER}/roles/${role}`, 'DELETE')
  check('roles: take the custom role away', revokeCustom.status === 204 && sql(`select count(*) from rbac.user_roles where user_id = '${READER}' and role_id = '${role}'`) === '0')
  const del = await owner.call(`/v1/rbac/roles/${role}`, 'DELETE')
  check('roles: delete the custom role (audited)', del.status === 204 && sql(`select count(*) from rbac.roles where id = '${role}'`) === '0'
    && sql(`select count(*) from audit.events where tenant_id = '${tenant}' and entity_type = 'ROLE' and entity_id = '${role}' and action = 'DELETE'`) === '1', `status=${del.status}`)
  if (del.status === 204) created.roles = created.roles.filter((r) => r !== role)

  // ── 5. role-name checks replaced by permissions ────────────────────────────
  // Someone outside the manager's team: not a direct report, not in a department they head.
  const other = sql(`select id from hrms.employees where tenant_id = '${tenant}' and is_active and id not in ('${READER_EMP}','${MGR_EMP}') and (reporting_manager_id is null or reporting_manager_id <> '${MGR_EMP}') and (department_id is null or department_id not in (select id from hrms.departments where department_head_employee_id = '${MGR_EMP}')) order by created_at limit 1`)
  check('employees: manager reads a direct report (hrms.employee.team.manage)', (await mgr.call(`/v1/employees/${READER_EMP}`)).status === 200)
  check('employees: manager cannot read someone outside the team', (await mgr.call(`/v1/employees/${other}`)).status === 403)
  check('employees: reader reads their own record', (await reader.call(`/v1/employees/${READER_EMP}`)).status === 200)
  check('employees: finance lead reads by company (hrms.employee.read)', (await fin.call(`/v1/employees/company/${company}?size=1`)).status === 200)
  check('employees: reader cannot list by company', (await reader.call(`/v1/employees/company/${company}?size=1`)).status === 403)
  const offs = sql(`select coalesce(weekly_off_days, '') from hrms.employees where id = '${READER_EMP}'`)
  created.weeklyOffs = offs
  const setOffs = await mgr.call(`/v1/employees/${READER_EMP}/weekly-offs?days=${encodeURIComponent(offs || '6,7')}`, 'PUT')
  check('employees: manager sets a team member’s weekly offs', setOffs.status === 200, `status=${setOffs.status}`)
  check('employees: manager cannot set weekly offs outside the team', (await mgr.call(`/v1/employees/${other}/weekly-offs?days=6,7`, 'PUT')).status === 403)
  check('employees: reader cannot set weekly offs', (await reader.call(`/v1/employees/${READER_EMP}/weekly-offs?days=6,7`, 'PUT')).status === 403)
  check('employees: reader cannot change a punch zone', (await reader.call(`/v1/employees/${READER_EMP}/punch-zone`, 'PUT')).status === 403)
  check('employees: reader cannot create or terminate employees', (await reader.call('/v1/employees', 'POST', {})).status === 403 && (await reader.call(`/v1/employees/${other}/terminate`, 'POST', {})).status === 403)
  check('employees: reader cannot add staff', (await reader.call('/v1/employees/staff', 'POST', {})).status === 403)
  check('employees: own emergency contacts readable; manager cannot read a report’s', (await reader.call(`/v1/employees/${READER_EMP}/emergency-contacts`)).status === 200 && (await mgr.call(`/v1/employees/${READER_EMP}/emergency-contacts`)).status === 403)
  check('employees: HR reads anyone’s emergency contacts', (await hrm.call(`/v1/employees/${READER_EMP}/emergency-contacts`)).status === 200)

  check('settings: HR manager reads HR configuration', (await hrm.call(`/v1/settings/hr-configuration?companyId=${company}`)).status === 200)
  check('settings: reader cannot', (await reader.call(`/v1/settings/hr-configuration?companyId=${company}`)).status === 403)
  check('settings: HR manager previews the next employee code; reader cannot', (await hrm.call(`/v1/settings/employee-code/preview?companyId=${company}`)).status === 200 && (await reader.call(`/v1/settings/employee-code/preview?companyId=${company}`)).status === 403)

  const dept = await hrm.call('/v1/tenant/departments', 'POST', { name: `QA w1h dept ${stamp}`, code: `QW${String(stamp).slice(-6)}`, companyId: company })
  if (dept.json?.id) created.departments.push(dept.json.id)
  check('tenant compat: HR manager creates a department (hrms.department.write)', dept.status === 201 && sql(`select count(*) from hrms.departments where id = '${dept.json?.id}'`) === '1', `status=${dept.status} ${msg(dept)}`)
  check('tenant compat: reader cannot create departments or branches', (await reader.call('/v1/tenant/departments', 'POST', { name: 'QA', companyId: company })).status === 403 && (await reader.call('/v1/tenant/branches', 'POST', { name: 'QA', companyId: company })).status === 403)
  if (dept.json?.id) {
    check('tenant compat: reader cannot set a department head', (await reader.call(`/v1/tenant/departments/${dept.json.id}/head?employeeId=${READER_EMP}`, 'POST')).status === 403)
    check('employees: finance lead lists any department (hrms.employee.read)', (await fin.call(`/v1/employees/department/${dept.json.id}?size=1`)).status === 200)
    check('employees: manager cannot list a department they neither head nor belong to', (await mgr.call(`/v1/employees/department/${dept.json.id}?size=1`)).status === 403)
    check('employees: reader cannot list departments', (await reader.call(`/v1/employees/department/${dept.json.id}?size=1`)).status === 403)
  }

  check('milestones: manager and reader cannot send reminders now', (await mgr.call('/v1/hrms/milestones/send-reminders', 'POST')).status === 403 && (await reader.call('/v1/hrms/milestones/send-reminders', 'POST')).status === 403)

  check('attendance: HR reads anyone’s records (attendance.workforce.admin)', (await hrm.call(`/v1/attendance/employee/${other}/records?size=1`)).status === 200)
  check('attendance: manager cannot read someone outside the team', (await mgr.call(`/v1/attendance/employee/${other}/records?size=1`)).status === 403)
  check('attendance: manager reads a direct report', (await mgr.call(`/v1/attendance/employee/${READER_EMP}/records?size=1`)).status === 200)

  const kpis = await mgr.call('/v1/performance/kpis?size=200')
  check('performance: manager KPI list is team-scoped by permission', kpis.status === 200 && (kpis.json?.items || []).every((k) => k.ownerId !== MGR_EMP && k.ownerId !== other), `status=${kpis.status}`)

  const planHr = await hrm.call('/v1/workspace/plan/current')
  check('plan: HR manager is refused', planHr.status === 403, `status=${planHr.status}`)
  const planOwner = await owner.call('/v1/workspace/plan/current')
  check('plan: the owner passes the permission check (tenant.settings.write)', !/Only workspace admins/.test(msg(planOwner)), `status=${planOwner.status} ${msg(planOwner)}`)
  check('modules: HR manager cannot buy modules', (await hrm.call('/v1/workspace/modules/crm/request-upgrade', 'POST')).status === 403)
} catch (e) {
  check('run finished', false, String(e?.stack || e).slice(0, 400))
} finally {
  // ── cleanup ───────────────────────────────────────────────────────────────
  try {
    if (created.weeklyOffs !== null) sql(`update hrms.employees set weekly_off_days = ${created.weeklyOffs ? `'${created.weeklyOffs}'` : 'null'} where id = '${READER_EMP}'`)
    for (const u of created.overrideUsers) sql(`delete from rbac.user_permission_overrides where user_id = '${u}'`)
    for (const [u, c] of created.userRoles) sql(`delete from rbac.user_roles ur using rbac.roles r where r.id = ur.role_id and ur.user_id = '${u}' and r.code = '${c}' and ur.granted_at >= '${created.auditFrom}'`)
    for (const r of created.roles) { sql(`delete from rbac.user_roles where role_id = '${r}'`); sql(`delete from rbac.role_permissions where role_id = '${r}'`); sql(`delete from rbac.roles where id = '${r}'`) }
    sql(`delete from rbac.roles where tenant_id = '${tenant}' and code like 'QA_%${stamp}'`)
    for (const d of created.departments) {
      sql(`delete from audit.events where tenant_id = '${tenant}' and entity_id = '${d}'`)
      sql(`delete from hrms.departments where id = '${d}'`)
    }
    sql(`delete from audit.events where tenant_id = '${tenant}' and module = 'rbac' and occurred_at >= '${created.auditFrom}' and (summary like '%QA%' or diff::text like '%QA%' or diff::text like '%${stamp}%' or entity_id in ('${[...created.overrideUsers].join("','") || '00000000-0000-0000-0000-000000000000'}'))`)
    const left = sql(`select (select count(*) from rbac.user_permission_overrides where tenant_id = '${tenant}') || ',' || (select count(*) from rbac.roles where tenant_id = '${tenant}' and code like 'QA_%${stamp}')`)
    check('cleanup: nothing left behind', left === '0,0', left)
  } catch (e) {
    check('cleanup', false, String(e?.message || e).slice(0, 300))
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
