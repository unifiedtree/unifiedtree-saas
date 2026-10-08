// Review probe for chakri/ownership-transfer-build (lead's review, 7 Oct 2026). API + SQL only.
//
//   UNIFIEDTREE_OWNERSHIP_SWEEPCRON='*/10 * * * * *' \
//     live-slot.sh /c/REACT/ut-wt/b6-owner 3166 node e2e/recovery/live-b6-owner-abuse.mjs
//
// The sweep cron override makes the daily job run every 10 s so expiry / end of handover can be seen.
// Abuse cases: non-owners start; another business's login as target; inactive target; concurrent starts;
// the wrong person accepts/declines/cancels; expired offer; the old owner during the handover tries owner
// actions; end of handover by the job; cancel racing accept. Lines starting FINDING are review findings
// (not counted as failures). Everything created is removed and every role put back at the end.
/* global process, console, fetch, setTimeout */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FT = 'b6b6b6b6-0000-4000-8000-00000000b6b6'           // a second business, made here
const COMPANY = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const findings = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const finding = (name, detail = '') => { findings.push(name); console.log(`FINDING  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': T }, body: JSON.stringify({ tenantId: T, email, password }) })
  const d = await r.json().catch(() => ({}))
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': T, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, s: `${res.status} ${JSON.stringify(json ?? '').slice(0, 140)}` }
  }
  call.status = r.status
  call.token = d.accessToken
  call.perms = (() => { try { return JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] } catch { return [] } })()
  return call
}
const has = (res, code) => JSON.stringify(res.json ?? '').includes(code)
const refused = (res, code) => res.status >= 400 && res.status < 500 && (!code || has(res, code))
const uid = (email) => sql(`select id from auth.user_credentials where tenant_id='${T}' and lower(email)='${email}'`)
const roles = (id) => sql(`select coalesce(string_agg(r.code, ',' order by r.code), '') from rbac.user_roles ur join rbac.roles r on r.id = ur.role_id where ur.tenant_id='${T}' and ur.user_id='${id}'`)
const owners = () => sql(`select count(*) from rbac.user_roles ur join rbac.roles r on r.id=ur.role_id where ur.tenant_id='${T}' and r.code='OWNER' and r.tenant_id is null`)
const status = (id) => sql(`select status from platform.ownership_transfers where id='${id}'`)
const waitFor = async (fn, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(1000) } return fn() }

const OWNER = uid('owner@unifiedtree.demo'), HRM = uid('hrm@unifiedtree.demo'), FIN = uid('fin@unifiedtree.demo')
const ADMIN_USER = uid('admin@unifiedtree.demo')
const OWNER_ACC = '0b6b6b6b-0000-4000-8000-0000000000a1'
const FOREIGN_USER = '0b6b6b6b-0000-4000-8000-0000000000f1'
const PENDING_USER = '0b6b6b6b-0000-4000-8000-0000000000e1'
const started = sql('select now()')
const tenantBefore = sql(`select concat_ws('|', coalesce(contact_email,''), coalesce(admin_name,''), coalesce(contact_phone,''), coalesce(owner_account_id::text,'')) from platform.tenants where id='${T}'`)
const subsBefore = sql(`select coalesce(string_agg(id || '=' || coalesce(contact_email,''), ';'), '') from platform.subscriptions where tenant_id='${T}'`)
const rolesBefore = sql(`select md5(string_agg(user_id::text||role_id::text, ',' order by user_id, role_id)) from rbac.user_roles where tenant_id='${T}'`)

try {
  // ── fixtures ──────────────────────────────────────────────────────────────
  sql(`drop table if exists public.b6probe_roles; create table public.b6probe_roles as select * from rbac.user_roles where tenant_id='${T}'`)
  // The owner has a platform account (as every real sign-up does); hrm@ does not (an invited employee).
  sql(`insert into platform.accounts (id, email, display_name, password_hash) values ('${OWNER_ACC}', 'owner@unifiedtree.demo', 'Owner', 'x') on conflict do nothing`)
  sql(`insert into platform.account_workspaces (id, account_id, tenant_id, auth_user_id, role, status) values (gen_random_uuid(), '${OWNER_ACC}', '${T}', '${OWNER}', 'OWNER', 'ACTIVE') on conflict do nothing`)
  sql(`update platform.tenants set owner_account_id='${OWNER_ACC}' where id='${T}'`)
  // hrm@ holds a per-company grant (should go when they become owner).
  sql(`insert into rbac.user_company_access (tenant_id, user_id, company_id, role_id) select '${T}', '${HRM}', '${COMPANY}', id from rbac.roles where code='DEPT_MANAGER' and tenant_id is null on conflict do nothing`)
  // A login in ANOTHER business, and a not-yet-activated login in this one.
  sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${FT}', 'b6probe', 'B6 probe', 'ACTIVE', 'STARTER') on conflict do nothing`)
  sql(`insert into auth.user_credentials (id, tenant_id, email, is_active) values ('${FOREIGN_USER}', '${FT}', 'b6probe-foreign@example.test', true) on conflict do nothing`)
  sql(`insert into auth.user_credentials (id, tenant_id, email, is_active) values ('${PENDING_USER}', '${T}', 'b6probe-pending@unifiedtree.demo', false) on conflict do nothing`)
  check('fixtures: one owner to start with', owners() === '1')

  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  check('logins', [owner, hrm, fin, admin].every((c) => c.status === 200))

  // ── who can start ─────────────────────────────────────────────────────────
  let r = await hrm('POST', '/v1/workspace/ownership-transfer', { toUserId: FIN, password })
  check('HR manager cannot start a transfer', refused(r, 'OWNER_ONLY'), r.s)
  r = await admin('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password })
  check('SUPER_ADMIN (not owner) cannot start a transfer', refused(r, 'OWNER_ONLY'), r.s)
  r = await admin('GET', '/v1/workspace/ownership-transfer/candidates')
  check('SUPER_ADMIN cannot list candidates', refused(r, 'OWNER_ONLY'), r.s)
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: OWNER, password })
  check('owner cannot transfer to themselves', refused(r, 'SAME_PERSON'), r.s)
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: FOREIGN_USER, password })
  check('target in ANOTHER business is refused (not found)', refused(r, 'USER_NOT_FOUND'), r.s)
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: PENDING_USER, password })
  check('target with a not-activated login is refused', refused(r, 'USER_NOT_ACTIVE'), r.s)
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password: '' })
  check('empty password is refused', refused(r, 'PASSWORD_WRONG'), r.s)
  r = await owner('GET', '/v1/workspace/ownership-transfer/candidates')
  check('candidates: no foreign / inactive / self', r.status === 200 && !r.json.some((c) => [FOREIGN_USER, PENDING_USER, OWNER].includes(c.userId)), `${r.json?.length} candidates`)
  check('nothing was opened by the refused attempts', sql(`select count(*) from platform.ownership_transfers where tenant_id='${T}'`) === '0')

  // ── concurrent starts: exactly one wins ──────────────────────────────────
  const [a, b] = await Promise.all([
    owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password }),
    owner('POST', '/v1/workspace/ownership-transfer', { toUserId: FIN, password }),
  ])
  const wins = [a, b].filter((x) => x.status === 200)
  check('two starts at once: exactly one opens', wins.length === 1 && [a, b].some((x) => refused(x, 'TRANSFER_OPEN')), `${a.s} | ${b.s}`)
  check('DB: exactly one open transfer', sql(`select count(*) from platform.ownership_transfers where tenant_id='${T}' and status in ('PENDING','TRANSITION')`) === '1')
  const first = wins[0]?.json
  const target = first?.toUserId === HRM ? hrm : fin, other = first?.toUserId === HRM ? fin : hrm
  r = await other('POST', `/v1/workspace/ownership-transfer/${first?.id}/accept`)
  check('someone else cannot accept', refused(r, 'NOT_ALLOWED'), r.s)
  r = await other('POST', `/v1/workspace/ownership-transfer/${first?.id}/decline`)
  check('someone else cannot decline', refused(r, 'NOT_ALLOWED'), r.s)
  r = await owner('POST', `/v1/workspace/ownership-transfer/${first?.id}/accept`)
  check('the owner cannot accept their own offer', refused(r, 'NOT_ALLOWED'), r.s)
  r = await target('POST', `/v1/workspace/ownership-transfer/${first?.id}/cancel`)
  check('the person offered cannot cancel', refused(r, 'NOT_ALLOWED'), r.s)
  r = await other('GET', '/v1/workspace/ownership-transfer')
  check('a bystander does not see the offer', r.status === 204, r.s)
  r = await owner('POST', `/v1/workspace/ownership-transfer/${first?.id}/cancel`)
  check('the owner cancels', r.status === 204 && status(first?.id) === 'CANCELLED', r.s)
  r = await target('POST', `/v1/workspace/ownership-transfer/${first?.id}/accept`)
  check('a cancelled offer cannot be accepted', refused(r, 'TRANSFER_NOT_OPEN'), r.s)

  // ── expiry ────────────────────────────────────────────────────────────────
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password })
  const exp = r.json?.id
  sql(`update platform.ownership_transfers set expires_at = now() - interval '1 minute' where id='${exp}'`)
  r = await hrm('POST', `/v1/workspace/ownership-transfer/${exp}/accept`)
  check('an expired offer cannot be accepted', refused(r, 'TRANSFER_EXPIRED'), r.s)
  check('…and ownership did not move', /(^|,)OWNER(,|$)/.test(roles(OWNER)) && owners() === '1')
  if (status(exp) !== 'EXPIRED') finding('accept() marks EXPIRED then throws inside @Transactional, so the EXPIRED write rolls back', `status right after = ${status(exp)}`)
  check('the job marks the unanswered offer EXPIRED', await waitFor(() => status(exp) === 'EXPIRED'), status(exp))

  // ── accept: ownership moves ───────────────────────────────────────────────
  r = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password, note: 'probe' })
  const tid = r.json?.id
  check('start (password right) → PENDING', r.status === 200 && r.json?.status === 'PENDING', r.s)
  r = await hrm('POST', `/v1/workspace/ownership-transfer/${tid}/accept`)
  check('hrm@ accepts → TRANSITION', r.status === 200 && r.json?.status === 'TRANSITION', r.s)
  check('exactly one OWNER after accept, and it is hrm@', owners() === '1' && /(^|,)OWNER(,|$)/.test(roles(HRM)) && /SUPER_ADMIN/.test(roles(HRM)), roles(HRM))
  check('old owner: ADMIN, no OWNER / SUPER_ADMIN', /(^|,)ADMIN(,|$)/.test(roles(OWNER)) && !/(^|,)(OWNER|SUPER_ADMIN)(,|$)/.test(roles(OWNER)), roles(OWNER))
  check('hrm@\'s per-company grants removed', sql(`select count(*) from rbac.user_company_access where tenant_id='${T}' and user_id='${HRM}'`) === '0')
  check('audit: ownership handover recorded', sql(`select count(*) from audit.events where tenant_id='${T}' and occurred_at >= '${started}' and summary like 'Handed ownership to hrm@%'`) === '1')
  check('notification to the old owner', sql(`select count(*) from notif.notifications where tenant_id='${T}' and created_at >= '${started}' and title='Ownership handed over'`) !== '0')
  check('contact email moved', sql(`select contact_email from platform.tenants where id='${T}'`) === 'hrm@unifiedtree.demo')
  check('old owner\'s account membership is now ADMIN', sql(`select role from platform.account_workspaces where account_id='${OWNER_ACC}' and tenant_id='${T}'`) === 'ADMIN')
  const accNow = sql(`select coalesce(owner_account_id::text,'') from platform.tenants where id='${T}'`)
  if (accNow === OWNER_ACC) finding('new owner has no platform account → tenants.owner_account_id still the OLD owner\'s account; no OWNER account_workspaces row for the new owner (WorkspacePlanController.resolveAccountId falls back to it)')
  check('old owner\'s session signed out', (await owner('GET', '/v1/workspace/users')).status === 401)
  check('new owner\'s old session signed out', (await hrm('GET', '/v1/workspace/users')).status === 401)

  // ── the old owner during the handover ─────────────────────────────────────
  const old = await login('owner@unifiedtree.demo')
  const neo = await login('hrm@unifiedtree.demo')
  const ownerOnly = ['tenant.settings.write', 'workspace.lifecycle.manage', 'workspace.data.export', 'workspace.modules.buy']
  check('old owner\'s new token has no owner-only permission', old.status === 200 && !ownerOnly.some((p) => old.perms.includes(p)), ownerOnly.filter((p) => old.perms.includes(p)).join(',') || 'none')
  check('old owner can still help (users list)', (await old('GET', '/v1/workspace/users')).status === 200)
  r = await old('POST', '/v1/workspace/ownership-transfer', { toUserId: FIN, password })
  check('old owner cannot start another transfer', refused(r, 'OWNER_ONLY'), r.s)
  r = await old('GET', '/v1/workspace/ownership-transfer/candidates')
  check('old owner cannot list candidates', refused(r, 'OWNER_ONLY'), r.s)
  r = await old('POST', `/v1/workspace/ownership-transfer/${tid}/end-transition`)
  check('old owner cannot end/undo the handover', refused(r, 'NOT_ALLOWED'), r.s)
  r = await old('POST', `/v1/workspace/users/${FIN}/roles`, { roleCode: 'OWNER' })
  check('old owner cannot grant OWNER', refused(r, 'OWNER_BY_TRANSFER_ONLY'), r.s)
  r = await old('POST', `/v1/workspace/users/${FIN}/roles`, { roleCode: 'SUPER_ADMIN' })
  check('old owner cannot grant SUPER_ADMIN', refused(r, 'OWNER_ONLY'), r.s)
  r = await old('POST', `/v1/workspace/users/${FIN}/roles`, { roleCode: 'ADMIN' })
  check('old owner cannot make a stand-in ADMIN', refused(r), r.s)
  r = await old('POST', `/v1/workspace/users/${OWNER}/roles`, { roleCode: 'HR_MANAGER' })
  check('old owner cannot give themselves a role to outlast the handover', refused(r, 'CANNOT_EDIT_OWN_ACCESS'), r.s)
  r = await old('DELETE', `/v1/workspace/users/${HRM}/roles/SUPER_ADMIN`)
  check('old owner cannot take SUPER_ADMIN from the new owner', refused(r), r.s)
  r = await old('DELETE', `/v1/workspace/users/${HRM}/roles/OWNER`)
  check('old owner cannot take OWNER from the new owner', refused(r), r.s)
  r = await old('GET', '/v1/workspace/lifecycle-requests')
  check('old owner cannot reach delete/reset workspace', r.status === 403, r.s)
  r = await old('GET', '/v1/workspace/exports')
  check('old owner cannot export the workspace', r.status === 403, r.s)
  r = await old('POST', '/v1/workspace/plan/cancel', { razorpaySubscriptionId: 'sub_b6probe' })
  check('old owner cannot cancel the plan', r.status === 403, r.s)
  r = await old('POST', '/v1/workspace/modules/payroll/request-upgrade')
  check('old owner cannot buy modules', r.status === 403, r.s)
  r = await neo('POST', '/v1/workspace/ownership-transfer', { toUserId: FIN, password })
  check('no second transfer while the handover is open', refused(r, 'TRANSFER_OPEN'), r.s)
  check('still exactly one owner', owners() === '1')

  // ── end of handover by the job (15 days simulated) ───────────────────────
  sql(`update platform.ownership_transfers set transition_ends_at = now() - interval '1 minute' where id='${tid}'`)
  check('the job ends the handover (COMPLETED)', await waitFor(() => status(tid) === 'COMPLETED'), status(tid))
  check('old owner keeps only EMPLOYEE', roles(OWNER) === 'EMPLOYEE', roles(OWNER))
  check('old owner\'s handover session signed out', (await old('GET', '/v1/workspace/users')).status === 401)
  const after = await login('owner@unifiedtree.demo')
  check('old owner (an employee) can still sign in', after.status === 200)
  check('…without admin permissions', !after.perms.includes('workspace.users.manage') && !after.perms.includes('rbac.role.write'))
  // Review nit (7 Oct): an old owner who is an employee keeps the business on their account as EMPLOYEE
  // (self-service); only someone with no employee record loses it (REMOVED).
  const membership = sql(`select role || '|' || status from platform.account_workspaces where account_id='${OWNER_ACC}' and tenant_id='${T}'`)
  check('old owner (an employee) keeps their account membership as EMPLOYEE', membership === 'EMPLOYEE|ACTIVE', membership)
  check('audit: transition end recorded', sql(`select count(*) from audit.events where tenant_id='${T}' and occurred_at >= '${started}' and summary like 'Ownership transition ended%'`) === '1')

  // ── cancel racing accept (hrm@ now owner → fin@) ─────────────────────────
  const snapshot = `drop table if exists public.b6probe_roles2; create table public.b6probe_roles2 as select * from rbac.user_roles where tenant_id='${T}'`
  sql(snapshot)
  let raced = false
  for (const delay of [0, 10, 25, 50, 90]) {
    sql(`delete from rbac.user_roles where tenant_id='${T}'; insert into rbac.user_roles select * from public.b6probe_roles2; delete from platform.ownership_transfers where tenant_id='${T}' and status in ('PENDING','TRANSITION')`)
    const o = await login('hrm@unifiedtree.demo'), f = await login('fin@unifiedtree.demo')
    const s = await o('POST', '/v1/workspace/ownership-transfer', { toUserId: FIN, password })
    const id = s.json?.id
    const [acc, can] = await Promise.all([f('POST', `/v1/workspace/ownership-transfer/${id}/accept`), sleep(delay).then(() => o('POST', `/v1/workspace/ownership-transfer/${id}/cancel`))])
    const finOwner = /(^|,)OWNER(,|$)/.test(roles(FIN)), st = status(id)
    console.log(`      race delay=${delay}ms accept=${acc.status} cancel=${can.status} status=${st} finIsOwner=${finOwner} owners=${owners()}`)
    if ((finOwner && st !== 'TRANSITION') || (acc.status === 200 && can.status === 204)) {
      finding('cancel racing accept: both succeed / row status disagrees with the roles', `delay ${delay}ms: accept ${acc.status}, cancel ${can.status}, row ${st}, fin@ owner=${finOwner}`)
      raced = true
      break
    }
  }
  if (!raced) console.log('      (race not reproduced in 5 tries — finding stands from the code)')
  check('after the races: still exactly one owner', owners() === '1', owners())
} catch (e) {
  check('probe ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  // Put everything back.
  try {
    sql(`delete from rbac.user_roles where tenant_id='${T}'; insert into rbac.user_roles select * from public.b6probe_roles`)
    sql('drop table if exists public.b6probe_roles; drop table if exists public.b6probe_roles2')
    sql(`delete from rbac.user_company_access where tenant_id='${T}' and user_id='${HRM}' and granted_at >= '${started}'`)
    sql(`update auth.user_credentials set is_active = true where id in ('${OWNER}', '${HRM}', '${FIN}', '${ADMIN_USER}')`)
    const [ce, an, cp, oa] = tenantBefore.split('|')
    const lit = (v) => (v ? `'${v.replace(/'/g, "''")}'` : 'null')
    sql(`update platform.tenants set contact_email=${lit(ce)}, admin_name=${lit(an)}, contact_phone=${lit(cp)}, owner_account_id=${lit(oa)} where id='${T}'`)
    for (const pair of subsBefore ? subsBefore.split(';') : []) { const [id, em] = pair.split('='); sql(`update platform.subscriptions set contact_email=${lit(em)} where id='${id}'`) }
    sql(`delete from platform.account_workspaces where tenant_id='${T}' and created_at >= '${started}'`)
    sql(`delete from platform.accounts where id='${OWNER_ACC}'`)
    sql(`delete from platform.ownership_transfers where tenant_id='${T}' and requested_at >= '${started}'`)
    sql(`delete from notif.notifications where tenant_id='${T}' and created_at >= '${started}' and data::text like '%/business/ownership%'`)
    sql(`delete from auth.user_credentials where id in ('${FOREIGN_USER}', '${PENDING_USER}')`)
    sql(`delete from platform.tenants where id='${FT}'`)
    check('cleanup: roles, contact and owner account as before', sql(`select md5(string_agg(user_id::text||role_id::text, ',' order by user_id, role_id)) from rbac.user_roles where tenant_id='${T}'`) === rolesBefore
      && sql(`select concat_ws('|', coalesce(contact_email,''), coalesce(admin_name,''), coalesce(contact_phone,''), coalesce(owner_account_id::text,'')) from platform.tenants where id='${T}'`) === tenantBefore)
  } catch (e) {
    check('cleanup ran', false, e.message.split('\n')[0])
  }
}
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} passed, ${findings.length} finding(s)`)
process.exit(failed ? 1 : 0)
