import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('finance can view the employee directory (read-only)', async ({ page }) => {
  // Finance has hrms.employee.read (Directory is in their nav) — needs to see who is paid.
  await page.goto('/hrms/employees')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('finance CANNOT create or modify an employee (no employee.write)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/employees', {
    method: 'POST',
    body: JSON.stringify({
      companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55',
      firstName: 'FinanceDenied',
      email: `fin-denied-${Date.now()}@test.demo`,
      employmentType: 'FULL_TIME',
    }),
  })
  expect(res.status, 'employee create denied for finance').toBe(403)
})
