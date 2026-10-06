// Live check for chakri/module-pause: after the 7-day grace only the unpaid modules pause;
// sign-in and the business's own pages stay open (owner rule, 6 Oct 2026; contract §2).
//
//   live-slot.sh /c/REACT/ut-wt/chakri-module-pause 3099 node e2e/recovery/live-chakri-module-pause.mjs
//
// It plants the newest subscription row for the demo business: PAST_DUE, due 9 days ago, modules
// hrms/attendance/leave/payroll — then:
//  - owner: /v1/leave/types and /v1/payroll/settings answer 402 MODULE_PAUSED with the agreed body
//    (moduleKey, dueSince, graceEndedOn = due + 7 days, dueAmountInr, canPay true, old error field);
//  - owner: sign-in works, and /v1/me/companies, /v1/notifications, /v1/workspace/seats/usage answer 200;
//  - employee (reader@): paused too, canPay false;
//  - due only 6 days ago: nothing is paused.
// The planted row is removed at the end.
/* global process, console, fetch, crypto */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms))

async function as(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  const call = async (path) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { ok: r.status === 200 && !!d.accessToken, call }
}

const id = crypto.randomUUID()
const DAY = 86400000
const now = Date.now()
try {
  check('V144_1 applied (past_due_since)', sql(`select count(*) from information_schema.columns where table_schema='platform' and table_name='subscriptions' and column_name='past_due_since'`) === '1')
  sql(`insert into platform.subscriptions (id, tenant_id, subdomain, plan_keys, modules, seats, amount_inr, status, current_period_start, current_period_end, past_due_since, created_at, updated_at)
       values ('${id}', '${tenant}', 'demo', '{hr-employees}', '{hrms,attendance,leave,payroll}', 100, 4000, 'PAST_DUE', now() - interval '40 days', now() - interval '9 days',
               now() - interval '9 days', now(), now() + interval '1 day')`)

  const owner = await as('owner@unifiedtree.demo')
  check('owner: sign-in still works while paused', owner.ok)
  const leave = await owner.call('/v1/leave/types')
  const b = leave.json || {}
  check('owner: leave answers 402 MODULE_PAUSED', leave.status === 402 && b.code === 'MODULE_PAUSED' && b.moduleKey === 'leave', `${leave.status} ${JSON.stringify(b).slice(0, 220)}`)
  check('owner: body has due date, grace end (due + 7 days), amount, canPay', b.dueSince === istDay(now - 9 * DAY) && b.graceEndedOn === istDay(now - 2 * DAY)
    && Number(b.dueAmountInr) === 4000 && b.canPay === true, JSON.stringify(b))
  check('owner: body keeps the old fields for older clients', b.error === 'subscription_lapsed' && 'graceExpiredAt' in b && b.companyId === null)
  const pay = await owner.call('/v1/payroll/settings')
  check('owner: payroll paused too', pay.status === 402 && pay.json?.moduleKey === 'payroll', String(pay.status))
  for (const open of ['/v1/me/companies', '/v1/notifications?size=5', '/v1/workspace/seats/usage']) {
    const r = await owner.call(open)
    check(`owner: ${open} stays open`, r.status === 200, String(r.status))
  }

  const reader = await as('reader@unifiedtree.demo')
  const rl = await reader.call('/v1/leave/types')
  check('employee: paused, and canPay false', rl.status === 402 && rl.json?.canPay === false, `${rl.status} ${JSON.stringify(rl.json).slice(0, 120)}`)

  sql(`update platform.subscriptions set past_due_since = now() - interval '6 days' where id='${id}'`)
  const inGrace = await owner.call('/v1/leave/types')
  check('due 6 days ago (inside grace): nothing paused', inGrace.status === 200, String(inGrace.status))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  sql(`delete from platform.subscriptions where id='${id}'`)
  check('cleanup: planted subscription removed', sql(`select count(*) from platform.subscriptions where id='${id}'`) === '0')
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
