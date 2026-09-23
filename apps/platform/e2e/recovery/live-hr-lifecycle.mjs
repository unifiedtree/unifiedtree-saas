import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

// Local disposable workspace only. No invitations, email sends or external records.
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const readerEmployee = '22222222-2222-2222-2222-222222222222'
const ownerEmployee = '11111111-1111-1111-1111-111111111111'
const stamp = Date.now()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const results = [], findings = []

async function login(email) {
  const res = await fetch(base + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(res.status, 200, `Login ${email}`)
  return (await res.json()).accessToken
}
async function raw(token, path, method = 'GET', body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}
async function request(token, path, method = 'GET', body, expected = 200) {
  const res = await raw(token, path, method, body)
  assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(res.data)}`)
  return res.data
}
async function scenario(name, fn) {
  try { const evidence = await fn(); results.push({ name, passed: true, evidence }); console.log('PASS: ' + name) }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + ': ' + error.message) }
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

await scenario('Leave policy, named approval, cancellation and restored balance', async () => {
  const type = await request(owner, `/v1/leave/types?companyId=${company}`, 'POST', {
    name: `Local QA leave ${stamp}`, code: `QA${stamp}`, category: 'CASUAL', annualEntitlement: 12,
    maxConsecutiveDays: 5, minNoticeDays: 0, isCarryForwardAllowed: false, maxCarryForwardDays: 0, isPaidLeave: true,
    description: 'Local lifecycle verification policy',
  }, 201)
  assert.ok((await request(owner, `/v1/leave/types?companyId=${company}`)).some(row => row.id === type.id))
  const history = await request(reader, '/v1/leave/my?size=1000')
  const date = new Date(today + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + 2)
  while ([0, 6].includes(date.getUTCDay()) || history.content.some(row => ['PENDING', 'PENDING_L2', 'APPROVED'].includes(row.status) && row.startDate <= date.toISOString().slice(0, 10) && row.endDate >= date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1)
  const day = date.toISOString().slice(0, 10)
  const year = date.getUTCFullYear()
  const balance = async () => (await request(reader, `/v1/leave/my/balances?year=${year}`)).find(row => row.leaveTypeId === type.id)
  const initial = await balance()
  assert.ok(initial, 'New leave policy should allocate a reader balance')
  assert.equal(Number(initial.available), 12)
  const leave = await request(reader, `/v1/leave/apply?companyId=${company}`, 'POST', { leaveTypeId: type.id, startDate: day, endDate: day, duration: 'FULL_DAY', reason: `Local approval verification ${stamp}` }, 201)
  assert.equal(leave.status, 'PENDING')
  assert.equal(Number(leave.totalDays), 1)
  assert.equal(Number((await balance()).pending), 1)
  const queue = await request(owner, '/v1/leave/approvals/pending?size=1000')
  const named = queue.content.find(row => row.id === leave.id)
  assert.equal(named?.employeeName, 'Reader User')
  assert.equal(named?.employeeCode, 'EMP002')
  const approved = await request(owner, `/v1/leave/${leave.id}/decision`, 'POST', { status: 'APPROVED', comment: 'Approved in local acceptance check' })
  assert.equal(approved.status, 'APPROVED')
  const used = await balance()
  assert.equal(Number(used.used), 1)
  assert.equal(Number(used.pending), 0)
  assert.equal(Number(used.available), 11)
  await request(reader, `/v1/leave/${leave.id}/cancel?reason=Local%20acceptance%20cleanup`, 'POST', undefined, 204)
  const restored = await balance()
  assert.equal(Number(restored.used), 0)
  assert.equal(Number(restored.pending), 0)
  assert.equal(Number(restored.available), 12)
  assert.equal((await request(reader, '/v1/leave/my?size=1000')).content.find(row => row.id === leave.id)?.status, 'CANCELLED')
  return { typeId: type.id, requestId: leave.id, date: day, namedRequester: named.employeeName, restoredAvailable: restored.available }
})

await scenario('Hiring requisition, named candidate, pipeline and closure', async () => {
  const job = await request(owner, '/v1/hiring/requisitions', 'POST', { companyId: company, title: `Local QA recruitment ${stamp}`, openings: 1, employmentType: 'FULL_TIME', location: 'Local QA office', description: 'Local lifecycle test', hiringManagerId: ownerEmployee }, 201)
  assert.equal(job.status, 'OPEN')
  assert.equal(job.hiringManagerName, 'Admin User')
  const candidate = await request(owner, `/v1/hiring/requisitions/${job.id}/candidates`, 'POST', { fullName: `Local QA Candidate ${stamp}`, source: 'Local acceptance fixture', expectedCtc: 600000, notes: 'No email or invitation requested' }, 201)
  assert.equal(candidate.stage, 'APPLIED')
  for (const stage of ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED']) {
    assert.equal((await request(owner, `/v1/hiring/candidates/${candidate.id}/stage`, 'PUT', { stage })).stage, stage)
    assert.equal((await request(owner, `/v1/hiring/requisitions/${job.id}/candidates`)).find(row => row.id === candidate.id)?.stage, stage)
  }
  assert.equal(Number((await request(owner, `/v1/hiring/requisitions/${job.id}`)).candidateCount), 1)
  assert.equal((await request(owner, `/v1/hiring/requisitions/${job.id}/close`, 'POST')).status, 'CLOSED')
  assert.equal((await request(owner, `/v1/hiring/requisitions/${job.id}`)).status, 'CLOSED')
  await request(reader, '/v1/hiring/requisitions', 'POST', { companyId: company, title: 'Should be denied', openings: 1 }, 403)
  return { requisitionId: job.id, candidateId: candidate.id, hiringManagerName: job.hiringManagerName, finalStage: 'HIRED', finalStatus: 'CLOSED' }
})

await scenario('Policy draft, publish, employee acknowledgement and named roster', async () => {
  const policy = await request(owner, '/v1/policy/policies', 'POST', { companyId: company, title: `Local QA policy ${stamp}`, category: 'GENERAL', content: 'This is a local acceptance policy.', version: 'v1.0', effectiveDate: today, status: 'DRAFT' }, 201)
  assert.equal(policy.status, 'DRAFT')
  await request(reader, '/v1/policy/policies?status=DRAFT', 'GET', undefined, 403)
  const draftRead = await raw(reader, `/v1/policy/policies/${policy.id}`)
  if (draftRead.status !== 403) findings.push({ module: 'Policy', issue: 'Employee can read an unpublished draft by direct id', expected: 403, actual: draftRead.status, policyId: policy.id })
  const draftAck = await raw(reader, `/v1/policy/policies/${policy.id}/acknowledge`, 'POST')
  if (![403, 422].includes(draftAck.status)) findings.push({ module: 'Policy', issue: 'Employee can acknowledge an unpublished draft', expected: '403 or 422', actual: draftAck.status, policyId: policy.id })
  assert.equal((await request(owner, `/v1/policy/policies/${policy.id}/publish`, 'POST')).status, 'ACTIVE')
  assert.equal((await request(reader, `/v1/policy/policies/${policy.id}`)).title, policy.title)
  await request(reader, `/v1/policy/policies/${policy.id}/acknowledge`, 'POST', undefined, 204)
  assert.ok((await request(reader, '/v1/policy/my-acknowledgements')).includes(policy.id))
  const roster = await request(owner, `/v1/policy/policies/${policy.id}/acknowledgements`)
  const named = roster.content.find(row => row.employeeId === readerEmployee)
  assert.equal(named?.employeeName, 'Reader User')
  assert.equal(named?.employeeCode, 'EMP002')
  assert.ok(named?.acknowledgedAt)
  assert.equal((await request(owner, `/v1/policy/policies/${policy.id}/archive`, 'POST')).status, 'ARCHIVED')
  assert.equal((await request(owner, `/v1/policy/policies/${policy.id}`)).status, 'ARCHIVED', 'Authors retain archive preview')
  await request(reader, `/v1/policy/policies/${policy.id}`, 'GET', undefined, 403)
  await request(reader, `/v1/policy/policies/${policy.id}/acknowledge`, 'POST', undefined, 422)
  assert.equal((await request(owner, `/v1/policy/policies/${policy.id}/unarchive`, 'POST')).status, 'ACTIVE')
  assert.ok((await request(reader, '/v1/policy/my-acknowledgements')).includes(policy.id), 'Publication guards must preserve current-version acknowledgement')
  return { policyId: policy.id, acknowledgementId: named.id, acknowledgedBy: named.employeeName }
})

await scenario('Onboarding template, assigned task and employee completion', async () => {
  const template = await request(owner, '/v1/onboarding/templates', 'POST', { companyId: company, name: `Local QA onboarding ${stamp}`, description: 'Local lifecycle verification', active: true }, 201)
  const task = await request(owner, `/v1/onboarding/templates/${template.id}/tasks`, 'POST', { title: 'Confirm local orientation completed', description: 'No external invitation is sent.', sequenceNo: 1, ownerRole: 'EMPLOYEE', dueOffsetDays: 1, required: true }, 201)
  assert.ok((await request(owner, `/v1/onboarding/templates/${template.id}`)).tasks.some(row => row.id === task.id))
  const instance = await request(owner, '/v1/onboarding/instances', 'POST', { employeeId: readerEmployee, templateId: template.id, joiningDate: today }, 201)
  const tasks = await request(reader, `/v1/onboarding/instances/${instance.id}/tasks`)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].title, task.title)
  assert.equal(tasks[0].status, 'PENDING')
  assert.ok(tasks[0].dueDate)
  const done = await request(reader, `/v1/onboarding/instance-tasks/${tasks[0].id}/complete`, 'POST', { notes: 'Completed by employee in local acceptance' })
  assert.equal(done.status, 'COMPLETED')
  assert.ok(done.completedAt)
  assert.equal((await request(owner, `/v1/onboarding/instances/${instance.id}`)).status, 'COMPLETED')
  assert.equal((await request(reader, `/v1/onboarding/instances/${instance.id}/tasks`))[0].notes, 'Completed by employee in local acceptance')
  await request(reader, '/v1/onboarding/templates', 'POST', { companyId: company, name: 'Should be denied' }, 403)
  return { templateId: template.id, taskId: task.id, instanceId: instance.id, completedBy: done.completedBy, finalStatus: 'COMPLETED' }
})

mkdirSync('test-results/recovery', { recursive: true })
writeFileSync('test-results/recovery/live-hr-lifecycle.json', JSON.stringify({ checkedAt: new Date().toISOString(), results, findings }, null, 2))
for (const finding of findings) console.error('FINDING: ' + JSON.stringify(finding))
if (results.some(row => !row.passed) || findings.length) process.exitCode = 1
