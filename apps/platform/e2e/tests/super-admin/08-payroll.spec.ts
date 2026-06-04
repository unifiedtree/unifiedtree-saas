import { test, expect } from '../../fixtures/test-base'
import { DEMO_COMPANY } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

test('payroll settings page loads with statutory cards', async ({ page }) => {
  await page.goto('/hrms/payroll/settings')
  await expect(page.getByText(/provident fund/i).first()).toBeVisible() // PF
  await expect(page.getByText(/\bESI\b/i).first()).toBeVisible()
  await expect(page.getByText(/professional tax/i).first()).toBeVisible() // PT
})

test('admin can toggle a statutory setting and save', async ({ page }) => {
  await page.goto('/hrms/payroll/settings')

  // Settings toggles are role="switch"; the first is "Enable PF". The Save button is
  // disabled until something changes (dirty), and re-disables on success → a durable
  // post-condition we can assert without depending on the (auto-dismissing) toast.
  const firstSwitch = page.getByRole('switch').first()
  const saveBtn = page.getByRole('button', { name: /save settings/i })

  await firstSwitch.click()
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 }) // saved → dirty=false

  // Flip back to restore the original state (keeps the suite idempotent).
  await firstSwitch.click()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
})

test('salary components page shows seeded defaults', async ({ page }) => {
  await page.goto('/hrms/payroll/components')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('admin can create a payroll run', async ({ page, apiRequest }) => {
  // Pick a (company, month, year) slot with no existing run so this is re-runnable
  // even if the backend enforces uniqueness per period.
  const res = await apiRequest('/api/v1/payroll/runs')
  let runs: Array<{ periodMonth: number; periodYear: number; companyName?: string }> = []
  if (res.ok) {
    const body = await res.json()
    runs = Array.isArray(body) ? body : (body.content ?? body.data ?? [])
  }
  const used = new Set(
    runs.filter((r) => !r.companyName || r.companyName === DEMO_COMPANY).map((r) => `${r.periodMonth}-${r.periodYear}`),
  )
  let freeYear = 2099
  for (let y = 2099; y >= 2030; y--) {
    if (!used.has(`12-${y}`)) { freeYear = y; break }
  }

  await page.goto('/hrms/payroll/runs')
  await page.getByRole('button', { name: /new run/i }).click()

  // Scope to the modal dialog. getByLabel doesn't resolve for ui-kit <Field>, so locate
  // the selects by the option text they contain and the year by its number input.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').filter({ hasText: DEMO_COMPANY }).selectOption({ label: DEMO_COMPANY })
  // Month options are abbreviated (Jan…Dec) with value = month number; locate that
  // select via "Jan" and pick December by value (12).
  await dialog.getByRole('combobox').filter({ hasText: 'Jan' }).selectOption({ value: '12' })
  await dialog.locator('input[type="number"]').fill(String(freeYear))

  await dialog.getByRole('button', { name: /create run/i }).click()

  // On success the app navigates to the new run's detail page.
  await page.waitForURL(/\/hrms\/payroll\/runs\/[0-9a-f-]{36}/, { timeout: 10_000 })
})
