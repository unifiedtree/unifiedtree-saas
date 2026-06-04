import { test, expect } from '../../fixtures/test-base'
import { uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

// Leave tabs are custom <button>s. HR is a manager (approve.l1/l2), can manage leave types
// (leave.type.write) and holidays (settings.holidays.write) → sees all of these tabs.
test('HR sees the leave tabs including Approvals', async ({ page }) => {
  await page.goto('/hrms/leave')
  for (const tab of ['My Leaves', 'Apply', 'Balances', 'Approvals', 'Leave Types', 'Holidays']) {
    await expect(page.getByRole('button', { name: tab, exact: true }).first(), `tab "${tab}"`).toBeVisible()
  }
})

test('HR can open Approvals (hrms.leave.approve.l1) and approve a pending request if any', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: 'Approvals', exact: true }).click()
  // Seeing the tab content at all proves HR holds the approver permission.
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()

  const approve = page.getByRole('button', { name: /^approve$/i }).first()
  if (await approve.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await approve.click() // reveals the confirm + comment UI
    const decisionResp = page.waitForResponse(
      (r) => r.url().includes('/v1/leave/') && r.url().includes('/decision') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: /confirm approve/i }).click()
    expect((await decisionResp).status(), 'leave decision accepted').toBeLessThan(300)
  } else {
    test.info().annotations.push({ type: 'note', description: 'No pending leave requests to approve (informational)' })
  }
})

test('HR can create a leave type (leave.type.write)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: /leave types/i }).click()
  await page.getByRole('button', { name: /add type/i }).click()

  await page.getByPlaceholder('e.g. Privilege Leave').fill(uniq('HR-Leave'))
  await page.getByPlaceholder('PL').fill(`H${Date.now() % 100000}`)

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/v1/leave/types') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /create leave type/i }).click()
  expect((await createResp).status(), 'leave type created').toBeLessThan(300)
})

test('HR can manage holidays (settings.holidays.write)', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.getByRole('button', { name: 'Holidays', exact: true }).click()
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByRole('button', { name: /add holiday/i }).first()).toBeVisible()
})
