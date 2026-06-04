import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

test('My Payslips page renders for employee', async ({ page }) => {
  await page.goto('/me/payslips')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
})

test('employee reads own payslips but cannot reach payroll runs', async ({ apiRequest }) => {
  const mine = await apiRequest('/api/v1/payroll/payslips/me')
  expect(mine.status, 'own payslips (payroll.payslip.read.self)').toBe(200)
  const runs = await apiRequest('/api/v1/payroll/runs')
  expect(runs.status, 'payroll runs are manager/finance-only').toBe(403)
})
