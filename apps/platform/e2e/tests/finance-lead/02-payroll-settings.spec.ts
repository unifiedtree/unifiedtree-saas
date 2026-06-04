import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('finance can view payroll settings', async ({ page }) => {
  await page.goto('/hrms/payroll/settings')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByText(/provident fund/i).first()).toBeVisible()
  await expect(page.getByText(/\bESI\b/i).first()).toBeVisible()
})

test('finance can update a payroll setting (has payroll.settings.update)', async ({ page }) => {
  await page.goto('/hrms/payroll/settings')
  const firstSwitch = page.getByRole('switch').first()
  const saveBtn = page.getByRole('button', { name: /save settings/i })
  // Unlike HR (read-only), finance HAS settings.update → the Save button is rendered.
  await expect(saveBtn).toBeVisible()

  await firstSwitch.click()
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 }) // saved → dirty=false

  // Restore original state.
  await firstSwitch.click()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
})
