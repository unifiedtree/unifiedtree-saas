import { test, expect } from '../../fixtures/test-base'
import { DEMO_COMPANY } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('finance sees the payroll runs list', async ({ page }) => {
  await page.goto('/hrms/payroll/runs')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /payroll runs/i })).toBeVisible()
})

test('finance can create a DRAFT payroll run (has payroll.runs.manage)', async ({ page, apiRequest }) => {
  // Pick a free (Kishore, December, year) slot so the test is re-runnable.
  const res = await apiRequest('/api/v1/payroll/runs')
  let runs: Array<{ periodMonth: number; periodYear: number; companyName?: string }> = []
  if (res.ok) {
    const body = await res.json()
    runs = Array.isArray(body) ? body : (body.content ?? body.data ?? [])
  }
  const used = new Set(
    runs.filter((r) => !r.companyName || r.companyName === DEMO_COMPANY).map((r) => `${r.periodMonth}-${r.periodYear}`),
  )
  let freeYear = 2098
  for (let y = 2098; y >= 2030; y--) {
    if (!used.has(`12-${y}`)) { freeYear = y; break }
  }

  await page.goto('/hrms/payroll/runs')
  await page.getByRole('button', { name: /new run/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').filter({ hasText: DEMO_COMPANY }).selectOption({ label: DEMO_COMPANY })
  await dialog.getByRole('combobox').filter({ hasText: 'Jan' }).selectOption({ value: '12' }) // December
  await dialog.locator('input[type="number"]').fill(String(freeYear))
  await dialog.getByRole('button', { name: /create run/i }).click()

  // On success the app navigates to the new run's detail page.
  await page.waitForURL(/\/hrms\/payroll\/runs\/[0-9a-f-]{36}/, { timeout: 10_000 })
})

test('finance can open a payroll run detail page', async ({ page }) => {
  await page.goto('/hrms/payroll/runs')
  const firstRun = page.locator('table tbody tr').first()
  await expect(firstRun).toBeVisible({ timeout: 10_000 })
  await firstRun.click()
  await page.waitForURL(/\/hrms\/payroll\/runs\/[0-9a-f-]{36}/)
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
})
