// Live check for fix/invite-and-business-settings (1): one business per person on every path that makes or
// invites a login, not just the employee invite (that one: live-chakri-invite.mjs).
//
//   live-slot.sh /c/REACT/ut-wt/w61-bizfix 3161 node e2e/recovery/live-w61-invite-one-business.mjs
//
// It plants a second ACTIVE business with logins for two emails (w61-else-<ts>@, w61-pend-<ts>@) and, in demo,
// a never-accepted login for w61-pend-<ts>@ (an invite sent before the rule). As the owner:
//  - Users & access → Invite, sign-in only: refused, 409 EMAIL_IN_ANOTHER_BUSINESS, no login made;
//  - Users & access → Invite, with an employee: refused the same, no employee and no login made;
//  - Users & access → Re-send invite of the never-accepted login: refused the same;
//  - Users & access → Invite, sign-in only, a fresh email: still works (200) and makes the (inactive) login.
// Everything planted or made is removed at the end.
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const ts = Date.now()
const other = '0b61b61b-0000-4000-8000-' + String(ts).slice(-12).padStart(12, '0')
const elsewhere = `w61-else-${ts}@example.invalid`
const pending = `w61-pend-${ts}@example.invalid`
const fresh = `w61-fresh-${ts}@example.invalid`
const demoLogins = (email) => sql(`select count(*) from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${email}')`)
const removeDemoLogin = (email) => {
  const ids = sql(`select string_agg('''' || id || '''', ',') from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${email}')`)
  if (!ids) return
  sql(`delete from auth.invitation_tokens where user_id in (${ids})`)
  sql(`delete from rbac.user_roles where user_id in (${ids})`)
  sql(`delete from auth.user_credentials where id in (${ids})`)
}
const removeDemoEmployee = (email) => sql(`delete from hrms.employees where tenant_id='${tenant}' and lower(email)=lower('${email}')`)

let token = null
const call = async (method, path, body) => {
  const r = await fetch(`${api}${path}`, { method, headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, json, body: typeof json === 'string' ? json : JSON.stringify(json) }
}
const refused = (r) => r.status === 409 && r.body.includes('EMAIL_IN_ANOTHER_BUSINESS') && r.body.includes('This email already signs in to another business')

try {
  check('V144_2 applied (auth.email_signs_in_elsewhere)', sql(`select to_regprocedure('auth.email_signs_in_elsewhere(text,uuid)') is not null`) === 't')
  sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${other}', 'w61other${ts}', 'W61 other business', 'ACTIVE', 'STARTER')`)
  sql(`insert into auth.user_credentials (id, tenant_id, email) values (gen_random_uuid(), '${other}', '${elsewhere}'), (gen_random_uuid(), '${other}', '${pending}')`)
  const pendingId = sql(`insert into auth.user_credentials (id, tenant_id, email, is_active, invited_at) values (gen_random_uuid(), '${tenant}', '${pending}', false, now()) returning id`).split(/\r?\n/)[0].trim()

  const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) })
  token = (await login.json().catch(() => ({}))).accessToken
  check('owner signs in', !!token)

  const a = await call('POST', '/v1/workspace/users/invite', { email: elsewhere, roleCodes: [], createEmployee: false })
  check('Users & access, sign-in only: refused (409 EMAIL_IN_ANOTHER_BUSINESS, plain message)', refused(a), `${a.status} ${a.body.slice(0, 200)}`)
  check('  no login was made in demo', demoLogins(elsewhere) === '0')

  const b = await call('POST', '/v1/workspace/users/invite', { email: elsewhere, firstName: 'W61', lastName: 'Test', roleCodes: [], createEmployee: true, companyId: company })
  check('Users & access, with an employee: refused (409)', refused(b), `${b.status} ${b.body.slice(0, 200)}`)
  check('  no employee and no login were made', demoLogins(elsewhere) === '0'
    && sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and lower(email)=lower('${elsewhere}')`) === '0')

  const c = await call('POST', `/v1/workspace/users/${pendingId}/invite/resend`)
  check('Users & access, re-send a never-accepted invite: refused (409)', refused(c), `${c.status} ${c.body.slice(0, 200)}`)
  check('  no new invite link was made', sql(`select count(*) from auth.invitation_tokens where user_id='${pendingId}'`) === '0')

  const e = await call('POST', '/v1/workspace/users/invite', { email: fresh, roleCodes: [], createEmployee: false })
  check('Users & access, sign-in only, fresh email: still works (200)', e.status === 200, `${e.status} ${e.body.slice(0, 160)}`)
  check('  it made the (inactive) login', sql(`select count(*) from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${fresh}') and not is_active`) === '1')
} catch (err) {
  check('test ran to the end', false, err.message.split('\n')[0])
} finally {
  for (const email of [fresh, elsewhere, pending]) {
    try { removeDemoLogin(email); removeDemoEmployee(email) } catch (err) { console.log(`cleanup (${email}):`, err.message.split('\n')[0]) }
  }
  sql(`delete from auth.user_credentials where tenant_id='${other}'`)
  sql(`delete from platform.tenants where id='${other}'`)
  check('cleanup: planted business, logins and employees are gone',
    sql(`select count(*) from platform.tenants where id='${other}'`) === '0'
    && sql(`select count(*) from auth.user_credentials where lower(email) in (lower('${fresh}'), lower('${elsewhere}'), lower('${pending}'))`) === '0'
    && sql(`select count(*) from hrms.employees where lower(email) in (lower('${fresh}'), lower('${elsewhere}'))`) === '0')
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
