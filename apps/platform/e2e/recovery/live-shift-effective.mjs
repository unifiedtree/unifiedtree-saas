// Client complaint #2 — "an employee's shift change must persist with correct
// effective behaviour". Exercises the real local API: schedule a future-dated
// reassignment for the demo employee, then prove (a) today's shift is unchanged,
// (b) the change is reported as upcoming, (c) the team schedule shows the old
// shift up to the day before and the new one from the effective date, (d) a
// reload returns the same, (e) a date before the current assignment is
// rejected, (f) an employee-scope login is denied. Restores the schedule after.
//
// Local recovery runtime only. Run from apps/platform:  node e2e/recovery/live-shift-effective.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const employee = '22222222-2222-2222-2222-222222222222' // reader@unifiedtree.demo
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const baseHeaders = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${base}/v1/canonical-auth/login`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email} failed: ${r.status} ${await r.text()}`)
  const j = await r.json()
  return { ...baseHeaders, Authorization: `Bearer ${j.accessToken}` }
}
async function call(headers, method, path, body) {
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await r.json() } catch { /* empty body */ }
  return { status: r.status, json }
}

const owner = await login('owner@unifiedtree.demo')
const today = istToday()
let restore = null
try {
  const policies = (await call(owner, 'GET', `/v1/shifts?companyId=${company}`)).json
  check('shift policies exist for the demo company', Array.isArray(policies) && policies.length >= 2, `${policies?.length ?? 0} policies`)
  const before = (await call(owner, 'GET', `/v1/shifts/employee/${employee}`)).json
  const futureDate = before.upcomingEffectiveFrom || plusDays(today, 7)
  // Baseline: the shift in force today (assign the first policy if unassigned).
  let baseline = policies.find(p => p.id === before.shiftPolicyId)
  if (!baseline) {
    baseline = policies[0]
    const r = await call(owner, 'POST', `/v1/shifts/employee/${employee}`, { shiftPolicyId: baseline.id, effectiveFrom: today })
    check('baseline assignment for an unassigned employee', r.status === 200, `${r.status}`)
  }
  const target = policies.find(p => p.id !== baseline.id)
  restore = { policyId: baseline.id, effectiveFrom: futureDate }

  // (a)+(b) schedule a future-dated change
  const scheduled = await call(owner, 'POST', `/v1/shifts/employee/${employee}`, { shiftPolicyId: target.id, effectiveFrom: futureDate })
  check('future-dated reassignment accepted', scheduled.status === 200 && scheduled.json?.effectiveFrom === futureDate, `${scheduled.status} effectiveFrom=${scheduled.json?.effectiveFrom}`)
  const current = (await call(owner, 'GET', `/v1/shifts/employee/${employee}`)).json
  check('shift in force today is still the baseline', current.shiftPolicyId === baseline.id, `${current.shiftName} (expected ${baseline.name})`)
  check('current assignment now ends the day before the change', current.effectiveTo === plusDays(futureDate, -1), `effectiveTo=${current.effectiveTo}`)
  check('change is reported as upcoming', current.upcomingShiftPolicyId === target.id && current.upcomingEffectiveFrom === futureDate, `${current.upcomingShiftName} from ${current.upcomingEffectiveFrom}`)

  // (c) the date-aware team schedule agrees
  const schedule = (await call(owner, 'GET', `/v1/team/schedule?from=${today}&to=${futureDate}`)).json
  const mine = Array.isArray(schedule) ? schedule.filter(row => row.employeeId === employee) : []
  const onToday = mine.find(row => String(row.date).slice(0, 10) === today)
  const onChange = mine.find(row => String(row.date).slice(0, 10) === futureDate)
  check('team schedule has rows for the employee', mine.length > 0, `${mine.length} days`)
  check('schedule shows the baseline shift today', onToday?.shiftName === baseline.name, `${onToday?.shiftName}`)
  check('schedule shows the new shift on the effective date', onChange?.shiftName === target.name, `${onChange?.shiftName}`)

  // (d) reload
  const again = (await call(owner, 'GET', `/v1/shifts/employee/${employee}`)).json
  check('persisted across reload', again.shiftPolicyId === current.shiftPolicyId && again.upcomingEffectiveFrom === futureDate)

  // (e) invalid: before the current assignment started
  const tooEarly = await call(owner, 'POST', `/v1/shifts/employee/${employee}`, { shiftPolicyId: target.id, effectiveFrom: plusDays(current.effectiveFrom, -1) })
  check('date before the current assignment is rejected', tooEarly.status >= 400 && tooEarly.status < 500, `${tooEarly.status} ${tooEarly.json?.errorCode ?? ''}`)

  // (f) denied for an employee-scope login
  const reader = await login('reader@unifiedtree.demo')
  const denied = await call(reader, 'POST', `/v1/shifts/employee/${employee}`, { shiftPolicyId: target.id, effectiveFrom: futureDate })
  check('employee login cannot assign shifts', denied.status === 403 || denied.status === 401, `${denied.status}`)
} finally {
  if (restore) {
    // Same-day replace turns the scheduled row back into the baseline policy,
    // so the demo employee's roster is unchanged after the run.
    const r = await call(owner, 'POST', `/v1/shifts/employee/${employee}`, { shiftPolicyId: restore.policyId, effectiveFrom: restore.effectiveFrom })
    check('schedule restored', r.status === 200, `${r.status}`)
  }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-shift-effective.json', JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2))
  const failed = checks.filter(c => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
