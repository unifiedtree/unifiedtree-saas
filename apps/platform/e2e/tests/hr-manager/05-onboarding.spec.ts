import { test, expect } from '../../fixtures/test-base'
import { pickCompany, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

test('HR can list onboarding templates without 500 (Filed Bug 1 fix, as HR)', async ({ page }) => {
  await page.goto('/hrms/onboarding')
  await expect(page.getByText(/onboarding templates/i).first()).toBeVisible()
  await expect(page.getByText(/internal_error|unexpected error/i)).not.toBeVisible()
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
})

test('HR can create an onboarding template (hrms.onboarding.template.write)', async ({ page }) => {
  await page.goto('/hrms/onboarding')
  await page.getByRole('button', { name: /new template/i }).click()
  await pickCompany(page)

  const templateName = uniq('HR-Onb')
  await page.getByPlaceholder('e.g. Engineering Hire').fill(templateName)

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/v1/onboarding/templates') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /create template/i }).click()
  expect((await createResp).status(), 'onboarding template created').toBe(201)

  await page.goto('/hrms/onboarding')
  await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 })
})
