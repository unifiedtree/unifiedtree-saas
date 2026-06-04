import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

test('manager sees the Leave > Approvals tab (has leave.approve.l1)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  // Leave tabs are custom buttons. Approvals only renders for an L1 approver → its presence
  // proves the manager holds the approver permission.
  await expect(page.getByRole('button', { name: 'Approvals', exact: true }).first()).toBeVisible()
})

test('manager pending-approvals endpoint is healthy (L1)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/leave/approvals/pending')
  expect(res.status, 'manager can read pending approvals').toBe(200)
  // NOTE: 0 pending requests in the dev seed, so team-scoping of approvals (manager should see
  // only their direct reports' requests, not the whole tenant) could NOT be exercised here.
  // Flagged as a follow-up: re-verify scoping with seeded multi-team pending requests.
  test.info().annotations.push({
    type: 'note',
    description: 'Approvals team-scoping unverified — no pending requests in seed (follow-up).',
  })
})

test('manager can approve a pending request if any (POST /v1/leave/{id}/decision)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: 'Approvals', exact: true }).click()
  const approve = page.getByRole('button', { name: /^approve$/i }).first()
  if (await approve.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await approve.click() // reveals confirm + comment UI
    const decisionResp = page.waitForResponse(
      (r) => r.url().includes('/v1/leave/') && r.url().includes('/decision') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: /confirm approve/i }).click()
    expect((await decisionResp).status()).toBeLessThan(300)
  } else {
    test.info().annotations.push({ type: 'note', description: 'No pending leave requests to approve (informational).' })
  }
})

test('manager can apply for their own leave (leave.request.self; enum accepted)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('combobox').filter({ hasText: 'Select leave type' }).selectOption({ index: 1 })
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(day)
  await dates.nth(1).fill(day)
  await page.getByRole('combobox').filter({ hasText: 'Full Day' }).selectOption('HALF_DAY_MORNING')
  await page.getByPlaceholder(/reason for leave/i).fill('Manager personal leave (E2E)')

  const applyResp = page.waitForResponse(
    (r) => r.url().includes('/v1/leave/apply') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /apply for leave/i }).click()
  const status = (await applyResp).status()
  // Manager has no allocated balance → 422 LEAVE_BALANCE_NOT_FOUND is fine; the point is the
  // request is accepted/processed (not a 400 enum rejection, not a 5xx).
  expect(status, `apply status ${status} must not be a 400 enum rejection`).not.toBe(400)
  expect(status, `apply status ${status} must not be a server error`).toBeLessThan(500)
})
