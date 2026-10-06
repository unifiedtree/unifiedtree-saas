// Live check for chakri/soft-seat-limit: going over the bought seats no longer blocks adding employees.
//
//   live-slot.sh /c/REACT/ut-wt/chakri-soft-seat-limit 3098 node e2e/recovery/live-chakri-soft-seats.mjs
//
// What it proves, against the local backend and database:
//  - With the seats bought set to exactly the people already counted, the owner can still add one more
//    (POST /v1/hrms/employees answers 2xx, not 402 SEAT_LIMIT_EXCEEDED).
//  - GET /v1/workspace/seats/usage then reports overBy 1, extraBilledAtCycleEnd true, seatsBought = the cap,
//    seatsUsed = the count, and still carries the old fields (purchased, current, currentExcludingAdmin, remaining).
// The seats are put back and the employee is removed at the end.
/* global process, console, fetch */
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)

const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) }).then((r) => r.json())
const call = async (method, path, body) => {
  const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${login.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

const ACTIVE = `('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')`
const saved = sql(`select coalesce(string_agg(id || '=' || seats, ',' order by id), '') from platform.subscriptions where tenant_id='${tenant}' and status in ${ACTIVE}`)
const planted = crypto.randomUUID()
let empId = null
try {
  const before = await call('GET', '/v1/workspace/seats/usage')
  const used = before.json?.current
  check('usage answers with the old fields', before.status === 200 && ['purchased', 'current', 'currentExcludingAdmin', 'remaining'].every((k) => k in (before.json || {})), JSON.stringify(before.json))

  // Seats bought = exactly the people counted now.
  if (saved) sql(`update platform.subscriptions set seats=${used} where tenant_id='${tenant}' and status in ${ACTIVE}`)
  else sql(`insert into platform.subscriptions (id, tenant_id, subdomain, plan_keys, seats, status, current_period_start, current_period_end, created_at, updated_at)
            values ('${planted}', '${tenant}', 'demo', '{hr-employees}', ${used}, 'ACTIVE', now(), now() + interval '20 days', '2000-01-01', '2000-01-01')`)
  const full = await call('GET', '/v1/workspace/seats/usage')
  check('at the cap: overBy 0', full.json?.seatsBought === used && full.json?.overBy === 0, JSON.stringify(full.json))

  const company = sql(`select id from org.companies where tenant_id='${tenant}' and is_active order by created_at limit 1`)
  const today = new Date().toISOString().slice(0, 10)
  const made = await call('POST', '/v1/hrms/employees', { companyId: company, firstName: 'Soft Seat', lastName: `QA ${tag}`, email: `qa.softseat.${tag}@example.test`, dateOfJoining: today, employmentType: 'FULL_TIME', roleCode: 'EMPLOYEE' })
  empId = made.json?.id || null
  check('one more employee can be added past the bought seats (no 402)', made.status >= 200 && made.status < 300 && !!empId, `${made.status} ${JSON.stringify(made.json).slice(0, 200)}`)

  const after = await call('GET', '/v1/workspace/seats/usage')
  const u = after.json || {}
  check('usage: overBy 1, extra billed at cycle end', u.overBy === 1 && u.extraBilledAtCycleEnd === true, JSON.stringify(u))
  check('usage: seatsBought = cap, seatsUsed = count', u.seatsBought === used && u.seatsUsed === used + 1, JSON.stringify(u))
  check('usage: old fields still there and consistent', u.purchased === used && u.current === used + 1 && u.remaining === 0, JSON.stringify(u))
  check('usage: cycleEndsOn and companyId keys present', 'cycleEndsOn' in u && 'companyId' in u, JSON.stringify(u))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  if (empId) {
    q(`delete from audit.events where entity_id::text='${empId}'`)
    q(`delete from hrms.employees where id='${empId}'`)
  }
  for (const pair of saved ? saved.split(',') : []) {
    const [id, seats] = pair.split('=')
    q(`update platform.subscriptions set seats=${seats} where id='${id}'`)
  }
  q(`delete from platform.subscriptions where id='${planted}'`)
  check('cleanup: employee removed and seats restored',
    sql(`select count(*) from hrms.employees where email='qa.softseat.${tag}@example.test'`) === '0'
    && sql(`select coalesce(string_agg(id || '=' || seats, ',' order by id), '') from platform.subscriptions where tenant_id='${tenant}' and status in ${ACTIVE}`) === saved)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
