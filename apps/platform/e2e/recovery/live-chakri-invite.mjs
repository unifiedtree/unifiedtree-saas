// Live check for chakri/invite-one-business: an email that already signs in to another business can't be
// invited; a normal invite still works (owner decision, 6 Oct 2026; migration V144_2).
//
//   live-slot.sh /c/REACT/ut-wt/b4-billing 3101 node e2e/recovery/live-chakri-invite.mjs
//
// It plants a second ACTIVE business with one login (b4-elsewhere-<ts>@example.invalid), gives a demo
// employee who has no login that email and asks for an invite (POST /v1/employees/{id}/invite as owner):
//  - refused, 409 EMAIL_IN_ANOTHER_BUSINESS (422 before fix/invite-and-business-settings), and no login is made in demo;
//  - with a fresh email the same invite works (200) and makes the (inactive) login.
// Everything planted or made is removed and the employee's email restored at the end.
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const ts = Date.now()
const other = '0b4b4b4b-0000-4000-8000-' + String(ts).slice(-12).padStart(12, '0')
const elsewhere = `b4-elsewhere-${ts}@example.invalid`
const fresh = `b4-invite-${ts}@example.invalid`
let empId = null
let originalEmail = null

const removeDemoLogin = (email) => {
  const ids = sql(`select string_agg('''' || id || '''', ',') from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${email}')`)
  if (!ids) return
  sql(`delete from auth.invitation_tokens where user_id in (${ids})`)
  sql(`delete from rbac.user_roles where user_id in (${ids})`)
  sql(`delete from auth.user_credentials where id in (${ids})`)
}

try {
  check('V144_2 applied (auth.email_signs_in_elsewhere)', sql(`select to_regprocedure('auth.email_signs_in_elsewhere(text,uuid)') is not null`) === 't')
  const row = sql(`select e.id || '|' || e.email from hrms.employees e where e.tenant_id='${tenant}' and e.email is not null and e.is_active
     and not exists (select 1 from auth.user_credentials c where c.employee_id=e.id) order by e.employee_code limit 1`)
  ;[empId, originalEmail] = row.split('|')
  check('found a demo employee without a login', !!empId, row)

  sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${other}', 'b4other${ts}', 'B4 other business', 'ACTIVE', 'STARTER')`)
  sql(`insert into auth.user_credentials (id, tenant_id, email) values (gen_random_uuid(), '${other}', '${elsewhere}')`)

  const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) })
  const t = (await login.json().catch(() => ({}))).accessToken
  check('owner signs in', !!t)
  const invite = async () => {
    const r = await fetch(`${api}/v1/employees/${empId}/invite`, { method: 'POST', headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } })
    const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: r.status, json }
  }

  sql(`update hrms.employees set email='${elsewhere}' where id='${empId}'`)
  const refused = await invite()
  const body = JSON.stringify(refused.json)
  check('an email that signs in to another business is refused (409 EMAIL_IN_ANOTHER_BUSINESS)', refused.status === 409 && body.includes('EMAIL_IN_ANOTHER_BUSINESS'), `${refused.status} ${body.slice(0, 200)}`)
  check('the refusal says why, in plain words', /another business/.test(body))
  check('no login was made in demo for it', sql(`select count(*) from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${elsewhere}')`) === '0')

  sql(`update hrms.employees set email='${fresh}' where id='${empId}'`)
  const ok = await invite()
  check('a normal invite still works (200)', ok.status === 200, `${ok.status} ${JSON.stringify(ok.json).slice(0, 160)}`)
  check('it made the (inactive) login', sql(`select count(*) from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower('${fresh}') and employee_id='${empId}' and not is_active`) === '1')
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  try { removeDemoLogin(fresh); removeDemoLogin(elsewhere) } catch (e) { console.log('cleanup (demo login):', e.message.split('\n')[0]) }
  if (empId && originalEmail) sql(`update hrms.employees set email='${originalEmail}' where id='${empId}'`)
  sql(`delete from auth.user_credentials where tenant_id='${other}'`)
  sql(`delete from platform.tenants where id='${other}'`)
  check('cleanup: planted business, logins and email change are gone',
    sql(`select count(*) from platform.tenants where id='${other}'`) === '0'
    && sql(`select count(*) from auth.user_credentials where lower(email) in (lower('${fresh}'), lower('${elsewhere}'))`) === '0'
    && (!empId || sql(`select email from hrms.employees where id='${empId}'`) === originalEmail))
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
