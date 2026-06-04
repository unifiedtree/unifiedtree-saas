import { test, expect } from '../../fixtures/test-base'
import { pickCompany, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

test('onboarding templates page loads without 500', async ({ page }) => {
  // This page 500'd before the audit-sprint fixes — it must render cleanly now.
  await page.goto('/hrms/onboarding')
  await expect(page.getByText(/onboarding templates/i).first()).toBeVisible()
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByText(/internal_error|unexpected error/i)).not.toBeVisible()
})

test('admin can create an onboarding template (verifies the create-time fix)', async ({ page }) => {
  await page.goto('/hrms/onboarding')
  await page.getByRole('button', { name: /new template/i }).click()

  // Drawer "Create onboarding template". Company select shows when >1 company exists.
  await pickCompany(page)

  const templateName = uniq('E2E-Onboarding')
  await page.getByPlaceholder('e.g. Engineering Hire').fill(templateName)

  // Verify the create POST returns 201 (the create-time regression target) …
  const createResp = page.waitForResponse(
    (r) => r.url().includes('/v1/onboarding/templates') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /create template/i }).click()
  expect((await createResp).status(), 'onboarding template create should return 201').toBe(201)

  // … and that it shows up in the list. (The list endpoint GET /v1/onboarding/templates
  // previously 500'd — required companyId + lazy `tasks` under OSIV-disabled; fixed, see
  // report — so this also guards that regression.)
  await page.goto('/hrms/onboarding')
  await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 })
})
