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

// ── OBSERVATION (not a restriction) — FINANCE_LEAD is broader than its name implies. ──
test('OBSERVATION: finance also holds leave-approve + letters perms (separation-of-duties)', async ({ apiRequest }) => {
  // Ground truth: FINANCE_LEAD has hrms.leave.approve.l1+l2, hrms.leave.write, and full
  // hrms.letters.* (incl template.create/delete) + hrms.employee.import — HR functions, not
  // finance. These pass (the perms are real); FLAGGED as a separation-of-duties concern for
  // product review (see report / memory). Not failed — this documents current behavior.
  const leave = await apiRequest('/api/v1/leave/approvals/pending')
  const letters = await apiRequest('/api/v1/letters/templates')
  expect(leave.status, 'finance can read leave approvals (has leave.read+approve)').toBe(200)
  expect(letters.status, 'finance can read letter templates (has letters.template.read)').toBe(200)
  test.info().annotations.push({
    type: 'issue',
    description: 'FINANCE_LEAD over-privileged: leave approve L1+L2 + full letters management + employee.import. Confirm intended vs over-grant (filed).',
  })
})
