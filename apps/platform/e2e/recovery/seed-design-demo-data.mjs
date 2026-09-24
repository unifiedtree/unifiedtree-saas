// Local demo-data seed for the Claude Design screenshot pack.
//
// Every screenshot that came back EMPTY-STATE needs realistic content so the
// design agent designs against real data, not a placeholder. This inserts
// PERSISTENT records through the real local API (never a direct DB write for
// business data) so validation, permissions and side effects all apply
// exactly as they would from the UI. Idempotent: every insert first checks
// whether an equivalent row already exists.
//
// Local recovery runtime only (http://127.0.0.1:8080/api). Never production.
// Run from apps/platform:  node e2e/recovery/seed-design-demo-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const OWNER_ID = '11111111-1111-1111-1111-111111111111'
const READER_ID = '22222222-2222-2222-2222-222222222222'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plusDays = (n) => { const d = new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000); return d.toISOString().slice(0, 10) }
const currentPeriod = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
async function call(h, method, path, body) {
  const r = await fetch(api + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined })
  let json = null; try { json = await r.json() } catch { /* no body */ }
  return { status: r.status, json }
}
async function listOf(h, path, pick = (j) => (Array.isArray(j) ? j : j.content || j.items || [])) {
  const r = await call(h, 'GET', path)
  return r.status >= 200 && r.status < 300 ? pick(r.json) ?? [] : []
}

const results = []
const step = async (name, fn) => {
  try { const r = await fn(); results.push({ name, ok: true, detail: r ?? '' }); console.log(`SEED  ${name}${r ? ' — ' + r : ''}`) }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log(`SKIP  ${name} — ${e.message}`) }
}

const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

// ── Attendance: today's punch for owner and reader (fixes /me, /hrms/ess) ──
for (const [label, h] of [['owner', owner], ['reader', reader]]) {
  await step(`${label}: today's attendance record`, async () => {
    const day = await call(h, 'GET', `/v1/attendance/today`)
    if (day.status === 200 && day.json?.checkInAt) return 'already checked in'
    const r = await call(h, 'POST', '/v1/attendance/checkin', { latitude: 17.3601415, longitude: 78.5367771, locationName: 'Local QA Office' })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
    return 'checked in'
  })
}

// ── ESS: one time entry each (fixes "Add time entry" area on /me) ──────────
for (const [label, h] of [['owner', owner], ['reader', reader]]) {
  await step(`${label}: today's time entry`, async () => {
    const existing = await listOf(h, `/v1/ess/timesheets?from=${today()}&to=${today()}`)
    if (existing.length) return 'already logged'
    const r = await call(h, 'POST', '/v1/ess/timesheets', { workDate: today(), description: 'Sprint planning and code review', minutes: 120 })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
    return 'logged 2h'
  })
}

// ── WFH: one pending request each (fixes /me/wfh) ───────────────────────────
for (const [label, h] of [['owner', owner], ['reader', reader]]) {
  await step(`${label}: pending WFH request`, async () => {
    const existing = await listOf(h, '/v1/wfh/my')
    if (existing.some((w) => w.status === 'PENDING')) return 'already has one pending'
    const r = await call(h, 'POST', '/v1/wfh', { fromDate: plusDays(3), toDate: plusDays(3), reason: 'Home internet installation appointment' })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
    return 'requested'
  })
}

// ── Shift change request (fixes /hrms/shifts "Shift requests" tab) ─────────
await step('reader: pending shift-change request', async () => {
  const pending = await listOf(owner, '/v1/shifts/change-requests/pending')
  if (pending.some((r) => r.employeeId === READER_ID)) return 'already pending'
  const policies = await listOf(owner, `/v1/shifts?companyId=${company}`)
  const current = await call(reader, 'GET', `/v1/shifts/employee/${READER_ID}`)
  const target = policies.find((p) => p.id !== current.json?.shiftPolicyId)
  if (!target) throw new Error('no alternate shift policy to request')
  const r = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason: 'Better commute alignment with the school run' })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return `requested ${target.name}`
})

// ── Overtime: one record awaiting review (fixes /hrms/shifts "Overtime" tab) ─
await step('overtime record awaiting review', async () => {
  const pending = await listOf(owner, `/v1/attendance/overtime?date=${plusDays(-1)}&page=0&size=50`, (j) => j.content ?? [])
  if (pending.length) return 'already has one pending'
  // Yesterday's attendance record needs overtime_minutes > 0; manual-entry lets an admin record a completed day.
  const r = await call(owner, 'POST', '/v1/attendance/manual-entry', {
    employeeId: READER_ID, attendanceDate: plusDays(-1), checkInAt: `${plusDays(-1)}T03:30:00Z`, checkOutAt: `${plusDays(-1)}T14:30:00Z`,
    latitude: 17.3601415, longitude: 78.5367771, locationName: 'Local QA Office',
    reason: 'Release-night support (demo data)',
  })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'yesterday, 11h logged'
})

// ── Company notice (fixes /dashboard notices widget) ────────────────────────
await step('company notice', async () => {
  const existing = await listOf(owner, `/v1/admin/dashboard/notices?companyId=${company}&page=0&size=1`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/admin/dashboard/notices', { companyId: company, title: 'Festive season office hours', body: 'The office will observe revised hours from 20 Oct through 2 Nov. Please plan approvals and payroll cut-offs accordingly.', expiresOn: plusDays(45) })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'posted'
})

// ── Notification template (fixes /hrms/notification-templates) ─────────────
await step('notification template', async () => {
  const existing = await listOf(owner, `/v1/notiftemplate/templates?companyId=${company}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/notiftemplate/templates', { companyId: company, name: 'Leave approved', channel: 'EMAIL', eventKey: 'LEAVE_APPROVED', subject: 'Your leave request has been approved', body: 'Hi {{employeeName}}, your leave from {{fromDate}} to {{toDate}} has been approved.', active: true })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'created'
})

// ── Integration connection (fixes /hrms/integrations) ───────────────────────
await step('integration connection', async () => {
  const existing = await listOf(owner, `/v1/integration/connections?companyId=${company}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/integration/connections', { companyId: company, name: 'Payroll bank file (ICICI)', provider: 'ICICI_H2H', category: 'BANKING', configSummary: 'SFTP export configured for the 25th of each month.' })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'registered'
})

// ── Expense policy (fixes /hrms/expenses "Policies" tab) ────────────────────
await step('expense policy', async () => {
  const existing = await listOf(owner, `/v1/expense/policies?companyId=${company}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', `/v1/expense/policies?companyId=${company}`, { name: 'Domestic travel', category: 'TRAVEL', maxAmountPerClaim: 15000, requiresReceipt: true, requiresManagerApproval: true, requiresHrApproval: false })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'created'
})

// ── PLI target + award (fixes /hrms/pli) ────────────────────────────────────
await step('PLI target', async () => {
  const existing = await listOf(owner, `/v1/pli/targets?companyId=${company}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/pli/targets', { companyId: company, title: 'Q3 delivery accuracy', ownerType: 'EMPLOYEE', ownerId: READER_ID, period: currentPeriod(), metric: 'On-time delivery %', targetValue: 95, actualValue: 91, weightPercent: 40 })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'created'
})
await step('PLI award', async () => {
  const existing = await listOf(owner, `/v1/pli/awards?companyId=${company}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/pli/awards', { employeeId: READER_ID, companyId: company, planName: 'Quarterly delivery incentive', period: currentPeriod(), amount: 8000, ratingBasis: 4.2, notes: 'Consistent sprint delivery and mentoring.' })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'proposed'
})

// ── Learning: a certified skill (fixes /hrms/learning "Skill Matrix"/"Certifications") ─
await step('reader: certified skill', async () => {
  const existing = await listOf(owner, `/v1/learning/skills/${READER_ID}`)
  if (existing.length) return 'already exists'
  const r = await call(owner, 'POST', '/v1/learning/skills', { employeeId: READER_ID, skillName: 'AWS Solutions Architect', proficiency: 4, certified: true, certificationName: 'AWS Certified Solutions Architect', certifiedOn: plusDays(-120), expiresOn: plusDays(600) })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return 'added'
})
await step('reader: training enrolment', async () => {
  const programs = await listOf(owner, '/v1/learning/programs')
  const mine = await listOf(reader, '/v1/learning/enrollments/me')
  if (mine.length) return 'already enrolled'
  if (!programs.length) throw new Error('no training programs exist to enrol in')
  const r = await call(owner, 'POST', `/v1/learning/programs/${programs[0].id}/enroll`, { employeeId: READER_ID })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return `enrolled in ${programs[0].name ?? programs[0].title ?? programs[0].id}`
})

// ── Performance: a goal each (fixes /hrms/performance "My Goals", employee Performance tab) ──
for (const [label, h] of [['owner', owner], ['reader', reader]]) {
  await step(`${label}: performance goal`, async () => {
    const mine = await listOf(h, '/v1/performance/goals/my')
    if (mine.length) return 'already has one'
    const r = await call(h, 'POST', '/v1/performance/goals', { title: 'Improve sprint predictability', description: 'Keep sprint commitment accuracy above 90% for two consecutive quarters.', weight: 30 })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
    return 'created'
  })
}

// ── Letter distribution (fixes /hrms/letters/distributions) ─────────────────
await step('letter distribution job', async () => {
  const existing = await listOf(owner, '/v1/letters/distributions')
  if (existing.length) return 'already exists'
  const templates = await listOf(owner, '/v1/letters/templates')
  if (!templates.length) throw new Error('no letter templates exist to distribute')
  const r = await call(owner, 'POST', '/v1/letters/distributions', {
    templateId: templates[0].id, title: 'Festive greeting letter', customMessage: 'Wishing the team a great festive season.',
    recipientFilter: { type: 'ALL_EMPLOYEES', values: [], employeeIds: [] },
  })
  if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
  return `distribution for "${templates[0].name ?? templates[0].title}"`
})

// ── Payroll: salary structures for owner/reader (fixes /me/salary) ─────────
for (const [label, id, ctc] of [['owner', OWNER_ID, 1800000], ['reader', READER_ID, 900000]]) {
  await step(`${label}: salary structure`, async () => {
    const existing = await call(owner, 'GET', `/v1/payroll/structures/employee/${id}`)
    if (existing.status === 200 && existing.json && !existing.json.derivedFromCtc) return 'already configured'
    const r = await call(owner, 'POST', '/v1/payroll/structures', { employeeId: id, ctcAnnual: ctc, effectiveFrom: today(), taxRegime: 'NEW', pfApplicable: true, pfStatus: 'ENROLLED', revisionNote: 'Demo data for the Claude Design screenshot pack' })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.json)}`)
    return `₹${ctc.toLocaleString('en-IN')} CTC`
  })
}
await step('payroll runs (context for /hrms/payroll-dashboard, /hrms/payroll/runs)', async () => {
  const runs = await listOf(owner, '/v1/payroll/runs')
  return `${runs.length} run(s) already present`
})

mkdirSync('test-results/recovery', { recursive: true })
writeFileSync('test-results/recovery/seed-design-demo-data.json', JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps applied or already satisfied`)
if (failed.length) console.log('Not seeded (needs a follow-up or a real UI flow):\n' + failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'))
