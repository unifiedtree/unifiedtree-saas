import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

// HR holds payroll READ permissions (runs.read, settings.read, components.read) but NOT the
// mutating ones (runs.manage, runs.lock, settings.update). The sidebar hides Payroll
// Settings/Components for HR, but the routes are permission-guarded on the READ perms HR has,
// so HR can VIEW them — just without the write affordances.

test('HR can view the payroll runs page but cannot create a run', async ({ page }) => {
  await page.goto('/hrms/payroll/runs')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /payroll runs/i })).toBeVisible()
  // "New run" is gated on payroll.runs.manage (HR lacks) → not rendered.
  await expect(page.getByRole('button', { name: /new run/i })).toHaveCount(0)
})

test('HR can view payroll settings read-only (no Save)', async ({ page }) => {
  await page.goto('/hrms/payroll/settings')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByText(/provident fund/i).first()).toBeVisible()
  // Save is gated on payroll.settings.update (HR lacks) → read-only view.
  await expect(page.getByRole('button', { name: /save settings/i })).toHaveCount(0)
})

test('HR can view salary components', async ({ page }) => {
  await page.goto('/hrms/payroll/components')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})
