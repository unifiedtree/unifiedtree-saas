// Live check for b8/appsms (owner's decision Q-21, 9 Oct): the mobile app's SMS sign-in, checked before any SMS.
//
//   live-slot.sh /c/REACT/ut-wt/b8-appsms 3121 node e2e/recovery/live-b8-appsms.mjs
//
// API only. The slot backend runs with Firebase off, which removes /v1/auth/phone/check and
// /v1/auth/firebase-verify (their app path is covered by unit tests); the app's other SMS path, MSG91
// (/v1/auth/otp/request), is always on and sends no SMS locally (no MSG91 key). For each case the test
// counts the code rows /request wrote (auth.otp_requests): a refused number must get none.
// It creates the logins it needs (and a second business) in the database and removes them after.
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ROLE = { OWNER: '00000000-0000-0000-0000-000000000010', ADMIN: '00000000-0000-0000-0000-000000000011', SUPER_ADMIN: '00000000-0000-0000-0000-000000000001', EMPLOYEE: '00000000-0000-0000-0000-000000000004' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const N = { several: '9000021001', twoBusinesses: '9000021002', twoFactor: '9000021003', owner: '9000021004', admin: '9000021005',
  superAdmin: '9000021006', plusInactive: '9000021007', onlyInactive: '9000021008', unknown: '9000021009' }
const numbers = Object.values(N)
const other = randomUUID()
const created = { employees: [], logins: [] }

/** An employee with this number and a login (roles, two-factor, switched off) in a business. */
function login(number, { business = tenant, role = 'EMPLOYEE', mfa = false, employeeActive = true, loginActive = true } = {}) {
  const emp = randomUUID(), user = randomUUID(), tag = emp.slice(0, 8)
  sql(`insert into hrms.employees (id, tenant_id, company_id, employee_code, first_name, employment_type, employment_status, email, phone, is_active)
       values ('${emp}', '${business}', '${company}', 'B8SMS-${tag}', 'B8 sms ${tag}', 'FULL_TIME', 'ACTIVE', 'b8sms-${tag}@test.local', '+91 ${number}', ${employeeActive})`)
  sql(`insert into auth.user_credentials (id, tenant_id, email, employee_id, is_active, is_mfa_enabled)
       values ('${user}', '${business}', 'b8sms-${tag}@test.local', '${emp}', ${loginActive}, ${mfa})`)
  sql(`insert into rbac.user_roles (tenant_id, user_id, role_id) values ('${business}', '${user}', '${ROLE[role]}')`)
  created.employees.push(emp); created.logins.push(user)
}

const codeRows = (n) => Number(sql(`select count(*) from auth.otp_requests where phone_last10 = '${n}'`))
async function request(n) {
  const res = await fetch(`${api}/v1/auth/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: `+91${n}` }) })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body, rows: codeRows(n) }
}

function cleanup() {
  const emps = created.employees.map((e) => `'${e}'`).join(',') || 'null'
  const users = created.logins.map((u) => `'${u}'`).join(',') || 'null'
  sql(`delete from rbac.user_roles where user_id in (${users})`)
  sql(`delete from auth.user_credentials where id in (${users})`)
  sql(`delete from hrms.employee_status_history where employee_id in (${emps})`)
  sql(`delete from hrms.employees where id in (${emps})`)
  sql(`delete from platform.tenants where id = '${other}'`)
  sql(`delete from auth.otp_requests where phone_last10 in (${numbers.map((n) => `'${n}'`).join(',')})`)
}

const SEVERAL = 'This number is on more than one login. Sign in with your email.'
const TWO_FACTOR = 'Your login uses two-factor sign-in. Use your password.'
try {
  const clash = sql(`select count(*) from hrms.employees where right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) in (${numbers.map((n) => `'${n}'`).join(',')})`)
  check('setup: the test numbers are on nobody yet', clash === '0', `on file: ${clash}`)
  sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${other}', 'b8sms-${other.slice(0, 8)}', 'B8 sms second business', 'ACTIVE', 'STARTER')`)
  login(N.several); login(N.several)
  login(N.twoBusinesses); login(N.twoBusinesses, { business: other })
  login(N.twoFactor, { mfa: true })
  login(N.owner, { role: 'OWNER' }); login(N.admin, { role: 'ADMIN' }); login(N.superAdmin, { role: 'SUPER_ADMIN' })
  login(N.plusInactive); login(N.plusInactive, { employeeActive: false })
  login(N.onlyInactive, { loginActive: false })

  let r = await request(N.unknown)
  check('an unknown number: the usual answer (200 with a request id), as before', r.status === 200 && !!r.body.requestId && r.rows === 1, `status ${r.status}, rows ${r.rows}`)

  r = await request(N.several)
  check('two active logins in one business: refused, no SMS', r.status === 409 && r.body.errorCode === 'PHONE_ON_SEVERAL_LOGINS' && r.rows === 0, `status ${r.status} ${r.body.errorCode}, rows ${r.rows}`)
  check('  … with the owner\'s message', r.body.message === SEVERAL, r.body.message)

  r = await request(N.twoBusinesses)
  check('one active login in each of two businesses: refused, no SMS', r.status === 409 && r.body.errorCode === 'PHONE_ON_SEVERAL_LOGINS' && r.rows === 0, `status ${r.status} ${r.body.errorCode}, rows ${r.rows}`)

  r = await request(N.twoFactor)
  check('a two-factor login: refused, no SMS', r.status === 403 && r.body.errorCode === 'USE_PASSWORD_FOR_TWO_FACTOR' && r.rows === 0, `status ${r.status} ${r.body.errorCode}, rows ${r.rows}`)
  check('  … told to use the password', r.body.message === TWO_FACTOR, r.body.message)

  for (const [role, n] of [['OWNER', N.owner], ['ADMIN', N.admin], ['SUPER_ADMIN', N.superAdmin]]) {
    r = await request(n)
    check(`${role}: keeps SMS sign-in in the app (code sent)`, r.status === 200 && !!r.body.requestId && r.rows === 1, `status ${r.status} ${r.body.errorCode || ''}, rows ${r.rows}`)
  }

  r = await request(N.plusInactive)
  check('one active login and an inactive employee with the number: the active one gets the code', r.status === 200 && r.rows === 1, `status ${r.status} ${r.body.errorCode || ''}, rows ${r.rows}`)

  r = await request(N.onlyInactive)
  check('only a switched-off login: the usual answer, as an unknown number', r.status === 200 && !!r.body.requestId, `status ${r.status} ${r.body.errorCode || ''}`)
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  try { cleanup() } catch (e) { check('cleanup', false, e.message.split('\n')[0]) }
  const left = sql(`select (select count(*) from hrms.employees where email like 'b8sms-%@test.local') + (select count(*) from auth.user_credentials where email like 'b8sms-%@test.local')
    + (select count(*) from platform.tenants where id = '${other}') + (select count(*) from auth.otp_requests where phone_last10 in (${numbers.map((n) => `'${n}'`).join(',')}))`)
  check('everything the test created is removed', left === '0', `left: ${left}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
