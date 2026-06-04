import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

// ── NEGATIVE / SECURITY — the employee can do NO management work. ──

test('employee cannot create an employee (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/employees', {
    method: 'POST',
    body: JSON.stringify({
      companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55',
      firstName: 'X',
      email: `emp-denied-${Date.now()}@x.demo`,
      employmentType: 'FULL_TIME',
    }),
  })
  expect(res.status).toBe(403)
})

test('employee cannot approve leave (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/leave/00000000-0000-0000-0000-000000000000/decision', {
    method: 'POST',
    body: JSON.stringify({ status: 'APPROVED', comment: 'self-approval attempt' }),
  })
  expect(res.status).toBe(403)
})

test('employee cannot reach payroll runs (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/payroll/runs')
  expect(res.status).toBe(403)
})

test('employee is denied workspace / rbac / audit admin endpoints (403)', async ({ apiRequest }) => {
  for (const ep of ['/api/v1/workspace/users', '/api/v1/rbac/roles', '/api/v1/audit/events?page=0&size=5']) {
    const res = await apiRequest(ep)
    expect(res.status, `${ep} must be 403 for employee`).toBe(403)
  }
})

test('employee direct-URL to the Directory is blocked in the UI', async ({ page }) => {
  // RouteGuard anyOf[hrms.employee.read] — that grant was revoked from EMPLOYEE by V051.
  await page.goto('/hrms/employees')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('employee direct-URL to payroll runs is blocked in the UI', async ({ page }) => {
  await page.goto('/hrms/payroll/runs')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})
