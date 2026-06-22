import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

// ── NEGATIVE / SECURITY — what finance genuinely CANNOT do (verified by ground truth). ──

test('finance direct-access to /hrms/organization is blocked', async ({ page }) => {
  await page.goto('/hrms/organization') // anyOf[department.read, branch.read] — finance lacks both
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('finance direct-access to /hrms/onboarding is blocked', async ({ page }) => {
  await page.goto('/hrms/onboarding') // onboarding.template.read — finance lacks
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('finance direct-access to /users, /roles, /audit-logs is blocked', async ({ page }) => {
  for (const path of ['/users', '/roles', '/audit-logs']) {
    await page.goto(path)
    await expect(page.getByText(/access restricted/i), `${path} blocked`).toBeVisible()
  }
})

test('finance cannot create an employee (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/employees', {
    method: 'POST',
    body: JSON.stringify({ companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55', firstName: 'X', email: `fin-${Date.now()}@x.demo`, employmentType: 'FULL_TIME' }),
  })
  expect(res.status).toBe(403)
})

test('finance cannot create a department (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/departments', {
    method: 'POST',
    body: JSON.stringify({ companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55', name: `FIN-DENIED-${Date.now()}`, code: 'FD1' }),
  })
  expect(res.status).toBe(403)
})

test('finance cannot invite a workspace user (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/workspace/users/invite', {
    method: 'POST',
    body: JSON.stringify({ email: `fin-invite-${Date.now()}@test.demo`, createEmployee: false, roleCodes: [] }),
  })
  expect(res.status).toBe(403)
})

test('finance is denied admin data endpoints (403)', async ({ apiRequest }) => {
  for (const path of ['/api/v1/workspace/users', '/api/v1/audit/events?page=0&size=5', '/api/v1/rbac/roles']) {
    const res = await apiRequest(path)
    expect(res.status, `${path} must be 403 for finance`).toBe(403)
  }
})

// ── Separation of duties (enforced by migration V066) ──
// FINANCE_LEAD must NOT hold HR-domain powers: leave approval, attendance
// regularization approval, employee bulk-import, or letter-template authoring.
// It KEEPS finance-appropriate access: payroll, reports, and operating on
// letters (read/generate/send/void + template.read).
test('finance is denied leave approval (separation of duties, 403)', async ({ apiRequest }) => {
  const l1 = await apiRequest('/api/v1/leave/approvals/pending')
  const l2 = await apiRequest('/api/v1/leave/approvals/pending-l2')
  expect(l1.status, 'finance must NOT approve L1 leave (V066 revoked hrms.leave.approve.l1)').toBe(403)
  expect(l2.status, 'finance must NOT approve L2 leave (V066 revoked hrms.leave.approve.l2)').toBe(403)
})

test('finance keeps letter template read but not regularization approval', async ({ apiRequest }) => {
  // template.read kept (needed to generate letters); authoring + attendance approval revoked in V066
  const read = await apiRequest('/api/v1/letters/templates')
  expect(read.status, 'finance keeps letters.template.read').toBe(200)
  const regapprovals = await apiRequest('/api/v1/attendance/corrections/approvals')
  expect(regapprovals.status, 'finance must NOT approve regularizations (V066 revoked attendance.regularization.approve)').toBe(403)
})

test('finance cannot bulk-import employees (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/bulk-import/employees/template')
  expect(res.status, 'finance must NOT import employees (V066 revoked hrms.employee.import)').toBe(403)
})
