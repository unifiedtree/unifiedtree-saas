// Live check for chakri/extra-users: extra users billed at the end of each cycle (owner, 7 Oct 2026).
//
//   UNIFIEDTREE_BILLING_EXTRA_USERS_CRON="*/15 * * * * *" \
//   live-slot.sh /c/REACT/ut-wt/chakri-extra-users 3102 node e2e/recovery/live-chakri-extra-users.mjs
//
// Plants, for the demo business: a MONTHLY subscription charging in 90 minutes with 40 seats and a
// Razorpay id, and yesterday's reading of 43 active employees in the demo company. The job (every
// 15 s here) then must:
//  - take today's reading (platform.seat_usage_daily);
//  - record the cycle once with 3 extra users (busiest day 43 − 40 seats) and the company they came from;
//  - tell the owner "3 extra users will be billed on <date>" (PAYMENT_DUE_SOON), once;
//  - in the last 2 hours, try to add them to the charge — locally there is no Razorpay, so the cycle is
//    kept as FAILED (retried next run), never ADDED, and nothing is charged twice;
//  - GET /v1/workspace/plan/breakdown shows this cycle's extra users and their company.
// Everything planted is removed at the end.
/* global process, console, fetch, setTimeout */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const id = crypto.randomUUID()
const start = new Date(Date.now() - 5000).toISOString()
const yesterday = sql(`select (now() at time zone 'Asia/Kolkata')::date - 1`)

try {
  check('V144_4 applied', sql(`select to_regclass('platform.extra_user_charges') is not null and to_regclass('platform.seat_usage_daily') is not null`) === 't')
  sql(`insert into platform.subscriptions (id, tenant_id, subdomain, plan_keys, modules, seats, unit_price_inr, amount_inr, billing_cycle, status,
         current_period_start, current_period_end, next_charge_at, razorpay_subscription_id, created_at, updated_at)
       values ('${id}', '${tenant}', 'demo', '{hr-employees}', '{hrms,attendance,leave,payroll}', 40, 400, 16000, 'MONTHLY', 'ACTIVE',
         now() - interval '29 days', now() + interval '90 minutes', now() + interval '90 minutes', 'sub_qa_${id.slice(0, 8)}', '2000-01-01', '2000-01-01')`)
  sql(`insert into platform.seat_usage_daily (tenant_id, day, company_id, active) values ('${tenant}', '${yesterday}', '${company}', 43)
       on conflict (tenant_id, day, company_id) do update set active = 43`)

  let row = ''
  for (let i = 0; i < 16; i++) {
    row = sql(`select status || '|' || extra_users || '|' || peak_active || '|' || by_company::text from platform.extra_user_charges where subscription_id='${id}'`)
    if (row.startsWith('FAILED') || row.startsWith('ADDED')) break
    await sleep(5000)
  }
  check('today\'s reading is taken', Number(sql(`select count(*) from platform.seat_usage_daily where tenant_id='${tenant}' and day=(now() at time zone 'Asia/Kolkata')::date`)) > 0)
  const [status, extra, peak, by] = row.split('|')
  check('the cycle is recorded with 3 extra users (43 − 40 seats)', extra === '3' && peak === '43', row)
  check('the extras name the company they came from', by?.includes(company) && /"extra":\s*3/.test(by), by)
  check('no Razorpay here: kept as FAILED for the next run, never ADDED', status === 'FAILED', status)
  check('one record for the cycle', sql(`select count(*) from platform.extra_user_charges where subscription_id='${id}'`) === '1')

  const ownerEmp = sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='owner@unifiedtree.demo'`)
  const notes = sql(`select title from notif.notifications where tenant_id='${tenant}' and user_id='${ownerEmp}' and type='PAYMENT_DUE_SOON' and created_at >= '${start}'`).split('\n').filter(Boolean)
  check('the owner is told "3 extra users will be billed on …", once', notes.length === 1 && /^3 extra users will be billed on /.test(notes[0]), notes.join(' / '))

  const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) }).then((r) => r.json())
  const bd = await fetch(`${api}/v1/workspace/plan/breakdown`, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${login.accessToken}` } }).then((r) => r.json())
  const ec = bd?.extraCharge
  check('Billing by company shows this cycle\'s extra users and their company',
    ec?.extraUsers === 3 && ec?.byCompany?.some((c) => c.companyId === company && c.extra === 3), JSON.stringify(ec))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  sql(`delete from notif.notifications where tenant_id='${tenant}' and type='PAYMENT_DUE_SOON' and created_at >= '${start}'`)
  sql(`delete from platform.subscriptions where id='${id}'`)   // its extra_user_charges row cascades
  sql(`delete from platform.seat_usage_daily where tenant_id='${tenant}' and day >= '${yesterday}'`)
  check('cleanup: nothing planted is left', sql(`select count(*) from platform.subscriptions where id='${id}'`) === '0'
    && sql(`select count(*) from platform.seat_usage_daily where tenant_id='${tenant}' and day >= '${yesterday}'`) === '0')
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
