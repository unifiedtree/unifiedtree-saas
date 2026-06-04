import { test, expect } from '../../fixtures/test-base'
import { uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

// NB: Leave tabs are custom <button>s (not role="tab"), and "Apply" is a TAB that
// reveals an inline form (there is no separate "Apply leave" button). Leave Types is
// also a tab here — there is no /hrms/leave/types route.

test('leave page loads with My Leaves, Apply, Balances, Approvals tabs', async ({ page }) => {
  await page.goto('/hrms/leave')
  for (const tab of ['My Leaves', 'Apply', 'Balances', 'Approvals']) {
    await expect(page.getByRole('button', { name: tab, exact: true }).first(), `tab "${tab}"`).toBeVisible()
  }
})

test('admin can create a leave type', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: /leave types/i }).click()
  await page.getByRole('button', { name: /add type/i }).click()

  // Plain (unassociated) labels → target inputs by placeholder. Name + Code required.
  const typeName = uniq('E2E-Leave')
  await page.getByPlaceholder('e.g. Privilege Leave').fill(typeName)
  await page.getByPlaceholder('PL').fill(`E${Date.now() % 100000}`)

  await page.getByRole('button', { name: /create leave type/i }).click()

  // Leave types render as cards (not a table) → assert by name.
  await expect(page.getByText(typeName)).toBeVisible({ timeout: 10_000 })
})

test('admin can apply for a half-day leave (verifies the duration enum is accepted)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()

  // Leave Type select = the combobox containing the "Select leave type" placeholder option.
  await page.getByRole('combobox').filter({ hasText: 'Select leave type' }).selectOption({ index: 1 })

  // Two date inputs: [0] start, [1] end. Use a near-future date.
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(day)
  await dates.nth(1).fill(day)

  // Duration select = the combobox containing "Full Day". HALF_DAY_MORNING is the
  // value that the earlier enum-alignment fix made the backend accept.
  await page.getByRole('combobox').filter({ hasText: 'Full Day' }).selectOption('HALF_DAY_MORNING')

  await page.getByPlaceholder(/reason for leave/i).fill('E2E half-day leave')

  // The demo admin has no allocated leave balance, so the happy path isn't guaranteed.
  // The regression target is the DURATION ENUM: a HALF_DAY_MORNING request must be
  // *accepted and processed* by the backend — success (2xx) or the business error
  // (422 LEAVE_BALANCE_NOT_FOUND), NOT a 400 enum-deserialization rejection or a 5xx.
  // Asserting the response status verifies exactly that (and is robust to the error
  // toast surfacing the error CODE rather than the message).
  const applyResp = page.waitForResponse(
    (r) => r.url().includes('/v1/leave/apply') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /apply for leave/i }).click()
  const status = (await applyResp).status()
  expect(status, `apply status ${status} must not be a 400 enum rejection`).not.toBe(400)
  expect(status, `apply status ${status} must not be a server error`).toBeLessThan(500)
})
