// Review probe (b6-billing): Razorpay check before pausing + extra users at cycle end, against a MOCK
// Razorpay on 127.0.0.1 (never the real one). Run through the slot with the backend pointed at the mock:
//
//   export RAZORPAY_KEY_ID=rzp_test_mockonly RAZORPAY_KEY_SECRET=mockonly \
//          UNIFIEDTREE_RAZORPAY_API_BASE=http://127.0.0.1:18999/v1 \
//          UNIFIEDTREE_BILLING_EXTRA_USERS_CRON="*/10 * * * * *"
//   live-slot.sh /c/REACT/ut-wt/b6-billing 3106 node e2e/recovery/live-review-b6-billing-probe.mjs
//
// Each check states the OWNER RULE as the expectation, so a FAIL is a rule the code breaks.
// Extra-users scenarios use made-up business ids (platform.subscriptions has no tenant FK), so they
// never touch the demo business; the pause scenarios use the demo business (they need a sign-in).
// Everything planted is removed at the end.
// chakri/razorpay-check-before-pause: the pause scenarios are due 8 days ago (1 day past grace): the guard now
// stops failing open 48 h past the pause point (review should-fix 3), which 9 days would just reach.
/* global process, console, fetch, setTimeout, crypto */
import { execFileSync } from 'node:child_process'
import http from 'node:http'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const demo = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const demoCompany = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── mock Razorpay ──────────────────────────────────────────────────────────
const addons = []                 // every add-on Razorpay "created": { sub, amount, quantity }
const gets = []                   // every GET /subscriptions/:id
const getLog = []
const subStatus = {}              // sub id -> 'active' | 'pending' | 500 | 'hang'
const slowAddonOnce = new Set()   // sub ids whose FIRST add-on is created but answered after 25 s (> 20 s read timeout)
const day = 86400
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    let m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)\/addons$/)
    if (req.method === 'POST' && m) {
      const b = JSON.parse(body || '{}')
      if (!(b.item?.amount >= 100)) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The amount must be atleast INR 1.00' } })
      const a = { id: `ao_mock_${addons.length + 1}`, sub: m[1], amount: b.item.amount, quantity: b.quantity }
      addons.push(a)
      if (slowAddonOnce.delete(m[1])) { setTimeout(() => send(200, { id: a.id, entity: 'addon' }), 25000); return }
      return send(200, { id: a.id, entity: 'addon' })
    }
    m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)$/)
    if (req.method === 'GET' && m) {
      gets.push(m[1]); getLog.push(`${new Date().toISOString().slice(11, 19)} ${m[1]}`)
      const st = subStatus[m[1]] ?? 'active'
      if (st === 500) return send(500, { error: { code: 'SERVER_ERROR' } })
      if (st === 'hang') return   // never answers: the client's read timeout decides
      const t = Math.floor(Date.now() / 1000)
      // Extra-users subscriptions: no dates, so a reconcile sweep can't move their next_charge_at mid-probe.
      const dates = m[1].startsWith('sub_probeE') ? {} : { charge_at: t + 30 * day, current_end: t + 30 * day }
      return send(200, { id: m[1], entity: 'subscription', status: st, quantity: 40, ...dates })
    }
    send(404, { error: { code: 'NOT_FOUND' } })
  })
})
await new Promise((r) => mock.listen(18999, '127.0.0.1', r))

async function as(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': demo }, body: JSON.stringify({ tenantId: demo, email, password }) })
  const d = await r.json().catch(() => ({}))
  return async (path) => {
    const t0 = Date.now()
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': demo, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, ms: Date.now() - t0 }
  }
}

const planted = { subs: [], tenants: [] }
const uid = () => crypto.randomUUID()
const plantSub = ({ tenant, status = 'ACTIVE', seats = 40, unit = 49, modules = '{hrms,attendance,leave,payroll}', rzp, nextCharge = "now() + interval '90 minutes'", trialEnds = 'NULL', pastDue = 'NULL', grace = 'NULL', updated = "'2000-01-01'" }) => {
  const id = uid()
  planted.subs.push(id)
  sql(`insert into platform.subscriptions (id, tenant_id, subdomain, plan_keys, modules, seats, unit_price_inr, amount_inr, billing_cycle, status,
         current_period_start, current_period_end, next_charge_at, trial_ends_at, past_due_since, grace_until, razorpay_subscription_id, created_at, updated_at)
       values ('${id}', '${tenant}', 'probe', '{hr-employees}', '${modules}', ${seats}, ${unit}, ${seats * unit}, 'MONTHLY', '${status}',
         now() - interval '29 days', ${nextCharge}, ${nextCharge}, ${trialEnds}, ${pastDue}, ${grace}, '${rzp}', '2000-01-01', ${updated})`)
  return id
}
const cycleEnd = () => sql(`select ((now() + interval '90 minutes') at time zone 'Asia/Kolkata')::date`)
const reading = (tenant, dayExpr, n) => sql(`insert into platform.seat_usage_daily (tenant_id, day, company_id, active) values ('${tenant}', ${dayExpr}, '${uid()}', ${n})`)
const chargeRow = (sub) => sql(`select status || '|' || extra_users || '|' || peak_active || '|' || amount_inr || '|' || coalesce(razorpay_addon_id,'') || '|' || coalesce(error,'') from platform.extra_user_charges where subscription_id='${sub}' order by cycle_end`)

try {
  // PROBE_PAUSE_ONLY=1 (chakri/razorpay-check-before-pause): no V144_4 on this branch, so no extra-users part.
  if (!process.env.PROBE_PAUSE_ONLY) {
  check('V144_4 applied', sql(`select to_regclass('platform.extra_user_charges') is not null`) === 't')
  const ce = cycleEnd()
  const d = (n) => `'${ce}'::date - ${n}`

  // ── E1: highest day, days the job missed, trial days, the charge day itself, an older cycle ──
  const t1 = uid(); planted.tenants.push(t1)
  const s1 = plantSub({ tenant: t1, rzp: 'sub_probeE1', trialEnds: `(${d(20)})::timestamp at time zone 'Asia/Kolkata'` })
  reading(t1, d(40), 80)     // previous cycle: ignored
  reading(t1, d(22), 60)     // free trial: ignored
  reading(t1, d(12), 30); reading(t1, d(12), 17)   // two companies, 47 that day = the highest
  reading(t1, d(5), 44)      // the days between are missing (job down): only recorded days count
  reading(t1, d(0), 70)      // the charge day starts the next cycle: ignored

  // ── E2: charge failed, Razorpay retrying: PAST_DUE with next_charge_at moved to the retry date ──
  const t2 = uid(); planted.tenants.push(t2)
  const s2 = plantSub({ tenant: t2, status: 'PAST_DUE', rzp: 'sub_probeE2' })
  reading(t2, d(12), 47)
  sql(`insert into platform.extra_user_charges (subscription_id, cycle_end, tenant_id, seats_bought, peak_active, extra_users, unit_price_inr, amount_inr, status, razorpay_addon_id, added_at)
       values ('${s2}', ${d(1)}, '${t2}', 40, 47, 7, 49, 343, 'ADDED', 'ao_earlier', now() - interval '1 day')`)

  // ── E3: Razorpay creates the add-on but the answer arrives after our 20 s read timeout ──
  const t3 = uid(); planted.tenants.push(t3)
  slowAddonOnce.add('sub_probeE3')
  const s3 = plantSub({ tenant: t3, rzp: 'sub_probeE3' })
  reading(t3, d(12), 47)

  // ── E4: one business, two monthly subscriptions (HRMS + Marketing) ──
  const t4 = uid(); planted.tenants.push(t4)
  const s4a = plantSub({ tenant: t4, rzp: 'sub_probeE4a' })
  const s4b = plantSub({ tenant: t4, rzp: 'sub_probeE4b', modules: '{whatsapp}', seats: 1, unit: 999 })
  reading(t4, d(12), 47)

  // ── E5: an older subscription row with unit_price_inr = 0 (signup rows before 10 Aug) ──
  const t5 = uid(); planted.tenants.push(t5)
  const s5 = plantSub({ tenant: t5, rzp: 'sub_probeE5', unit: 0 })
  reading(t5, d(12), 47)

  // Let the job (every 10 s here) run several times, including past E3's 20 s timeout and its retry.
  for (let i = 0; i < 14 && !process.env.PROBE_PAUSE_ONLY; i++) {
    await sleep(5000)
    if (addons.filter((a) => a.sub === 'sub_probeE3').length >= 2) break
  }
  if (!process.env.PROBE_PAUSE_ONLY) await sleep(25000)   // a few more runs: nothing may be added again

  const e1 = chargeRow(s1).split('|')
  check('E1 highest active employees on any day of the cycle (47) − 40 seats = 7 extras', e1[1] === '7' && e1[2] === '47', e1.join('|'))
  const a1 = addons.filter((a) => a.sub === 'sub_probeE1')
  check('E1 one add-on at the full-month price: 7 × ₹49 (4900 paise)', a1.length === 1 && a1[0].amount === 4900 && a1[0].quantity === 7, JSON.stringify(a1))
  check('E1 recorded ADDED ₹343 with the add-on id', e1[0] === 'ADDED' && e1[3] === '343.00' && e1[4] === 'ao_mock_' + (addons.indexOf(a1[0]) + 1), e1.join('|'))

  const a2 = addons.filter((a) => a.sub === 'sub_probeE2')
  check('E2 a failed charge being retried is NOT charged the extras a second time', a2.length === 0,
    `${a2.length} new add-on(s); rows: ${chargeRow(s2).split('\n').join(' / ')}`)

  const a3 = addons.filter((a) => a.sub === 'sub_probeE3')
  check('E3 an add-on Razorpay created but answered late is not created again (never double-charge)', a3.length === 1,
    `${a3.length} add-ons on Razorpay; row: ${chargeRow(s3)}`)

  const a4 = addons.filter((a) => a.sub.startsWith('sub_probeE4'))
  check('E4 one business = one extra-users charge (not one per subscription)', a4.length === 1,
    a4.map((a) => `${a.sub}: ${a.quantity} × ₹${a.amount / 100}`).join(', ') + ` | ${chargeRow(s4a)} | ${chargeRow(s4b)}`)

  const a5 = addons.filter((a) => a.sub === 'sub_probeE5')
  check('E5 a ₹0 unit price is not billed as ₹0 / not stuck FAILED (falls back to the price paid)', a5.length === 1 && a5[0].amount > 0,
    `${a5.length} add-ons; row: ${chargeRow(s5)}`)

  }
  // ── Pause: Razorpay asked before pausing (demo business; its newest subscription row) ──
  const call = await as('owner@unifiedtree.demo')
  const leave = `/v1/leave/types?companyId=${demoCompany}`
  const newest = "now() + interval '1 day'"

  const p1 = plantSub({ tenant: demo, status: 'PAST_DUE', rzp: 'sub_probeP1', nextCharge: "now() - interval '8 days'", pastDue: "now() - interval '8 days'", updated: newest })
  subStatus.sub_probeP1 = 'active'
  let r = await call(leave)
  check('P1 PAST_DUE past grace, Razorpay says paid → not paused', r.status === 200, `${r.status} in ${r.ms} ms`)
  const p1row = sql(`select status || '|' || (past_due_since is null) || '|' || coalesce(reconcile_error, '') from platform.subscriptions where id='${p1}'`)
  check('P1 … and our row is reconciled to ACTIVE (past due cleared)', p1row.startsWith('ACTIVE|t'), p1row)
  sql(`delete from platform.subscriptions where id='${p1}'`)

  await sleep(61000)   // the per-business 60 s cache
  const p2 = plantSub({ tenant: demo, status: 'HALTED', rzp: 'sub_probeP2', nextCharge: "now() - interval '8 days'", grace: "now() - interval '2 days'", updated: newest })
  subStatus.sub_probeP2 = 'pending'
  r = await call(leave)
  const r2 = await call(leave)
  check('P2 HALTED, Razorpay says unpaid → paused (402 MODULE_PAUSED)', r.status === 402 && r.json?.code === 'MODULE_PAUSED', `${r.status} in ${r.ms} ms`)
  check('P2 Razorpay asked once, not again within 60 s', gets.filter((g) => g === 'sub_probeP2').length === 1 && r2.status === 402)
  sql(`delete from platform.subscriptions where id='${p2}'`)

  await sleep(61000)
  const p3 = plantSub({ tenant: demo, status: 'PAST_DUE', rzp: 'sub_probeP3', nextCharge: "now() - interval '8 days'", pastDue: "now() - interval '8 days'", updated: newest })
  subStatus.sub_probeP3 = 500
  r = await call(leave)
  const r3 = await call(leave)
  check('P3 Razorpay errors → not paused (fail-open, owner rule)', r.status === 200 && r3.status === 200, `${r.status}/${r3.status}`)
  check('P3 … and not re-asked within 60 s', gets.filter((g) => g === 'sub_probeP3').length === 1)
  sql(`delete from platform.subscriptions where id='${p3}'`)

  await sleep(61000)
  const p4 = plantSub({ tenant: demo, status: 'PAST_DUE', rzp: 'sub_probeP4', nextCharge: "now() - interval '8 days'", pastDue: "now() - interval '8 days'", updated: newest })
  subStatus.sub_probeP4 = 'hang'
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => call(leave)))
  const slowest = Math.max(...burst.map((b) => b.ms))
  check('P4 Razorpay hangs → requests are not paused', burst.every((b) => b.status === 200), burst.map((b) => b.status).join(','))
  check('P4 a page load (5 calls at once) asks Razorpay once', gets.filter((g) => g === 'sub_probeP4').length === 1,
    `${gets.filter((g) => g === 'sub_probeP4').length} GETs`)
  check('P4 a paused request waits < 5 s for Razorpay', slowest < 5000, `slowest ${slowest} ms`)
  sql(`delete from platform.subscriptions where id='${p4}'`)
} catch (e) {
  check('probe ran to the end', false, e.message.split('\n')[0])
} finally {
  const ids = planted.subs.map((s) => `'${s}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"
  const ts = planted.tenants.map((s) => `'${s}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"
  if (sql(`select to_regclass('platform.extra_user_charges') is not null`) === 't') sql(`delete from platform.extra_user_charges where subscription_id in (${ids})`)
  sql(`delete from platform.subscriptions where id in (${ids})`)
  if (sql(`select to_regclass('platform.seat_usage_daily') is not null`) === 't') sql(`delete from platform.seat_usage_daily where tenant_id in (${ts})`)
  check('cleanup: nothing planted is left', sql(`select (select count(*) from platform.subscriptions where id in (${ids}))`) === '0')
  console.log('mock add-ons:', JSON.stringify(addons))
  console.log('mock GETs (UTC):', getLog.join(', '))
  mock.closeAllConnections?.(); mock.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
