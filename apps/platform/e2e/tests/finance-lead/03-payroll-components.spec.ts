import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('finance sees the seeded salary components', async ({ page }) => {
  await page.goto('/hrms/payroll/components')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /salary components/i })).toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('finance sees the component category tabs', async ({ page }) => {
  await page.goto('/hrms/payroll/components')
  // Tabs: All / Earnings / Deductions / Employer / Reimbursements
  for (const tab of ['All', 'Earnings', 'Deductions']) {
    await expect(page.getByText(tab, { exact: true }).first(), `tab "${tab}"`).toBeVisible()
  }
})
