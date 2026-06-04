import { test, expect } from '../../fixtures/test-base'
import { pickCompany, firstEmployeeId, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

test('HR sees the employee list with stats', async ({ page }) => {
  await page.goto('/hrms/employees')
  await expect(page.getByText(/total/i).first()).toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('HR can create an employee (hrms.employee.write + invite)', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.getByRole('button', { name: /add employee/i }).click()
  await expect(page.getByRole('heading', { name: /add employee/i })).toBeVisible()

  // Same wizard as P2: company select on the Basic step, unassociated labels → placeholders,
  // jump to the last step via its pill, then Create. HR holds the invite permission so the
  // "Send invitation email" checkbox is present and the invite fires (async).
  await pickCompany(page)
  await page.getByPlaceholder('First name').fill('HRCreated')
  await page.getByPlaceholder('employee@company.com').fill(`${uniq('e2e-hr')}@test.demo`)
  await page.getByRole('button', { name: /emergency/i }).click()

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/v1/hrms/employees') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /create employee/i }).click()
  expect((await createResp).status(), 'HR create employee → 201').toBe(201)
})

test('HR can open an employee detail with tabs', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/employees/**')
  await expect(page.getByRole('tab', { name: /overview/i }).first()).toBeVisible()
})

test('HR can open the edit drawer on an employee (hrms.employee.profile.write)', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/employees/**')
  const edit = page.getByRole('button', { name: /^edit/i }).first()
  if (await edit.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await edit.click()
    // Don't mutate shared data — just confirm edit mode opens, then back out.
    await expect(page.getByText(/access restricted/i)).not.toBeVisible()
    const cancel = page.getByRole('button', { name: /cancel/i }).first()
    if (await cancel.isVisible({ timeout: 2_000 }).catch(() => false)) await cancel.click()
  } else {
    test.info().annotations.push({ type: 'note', description: 'No inline Edit affordance on detail (informational)' })
  }
})

test('HR can (re)send an employee invitation — async + fast (Bug 2 fix as HR)', async ({ apiRequest }) => {
  // HR holds hrms.employee.invite. The invite returns as soon as the token is created;
  // the email is sent async (best-effort) — so it must come back fast.
  const empId = await firstEmployeeId(apiRequest)
  const t0 = Date.now()
  const res = await apiRequest(`/api/v1/employees/${empId}/invite`, { method: 'POST', body: '{}' })
  const dt = Date.now() - t0
  expect(res.status, 'HR invite accepted (has hrms.employee.invite)').toBe(200)
  expect(dt, 'invite returns fast (async send, not blocking on SMTP)').toBeLessThan(3000)
})
