import { test, expect } from '../../fixtures/test-base'
import { firstEmployeeId, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

// Create first so the suite is self-contained regardless of seeded templates.
const templateName = uniq('E2E-Letter')

test('admin can create a letter template (verifies the create-time fix)', async ({ page }) => {
  await page.goto('/hrms/letters/templates')
  await page.getByRole('button', { name: /create template/i }).first().click()

  // Editor at /hrms/letters/templates/new. companyId is taken from companies[0] on save;
  // only the name is required. Plain (unassociated) labels → use placeholder for name.
  await page.waitForURL('**/hrms/letters/templates/new')
  await page.getByPlaceholder('e.g. Standard Offer Letter').fill(templateName)
  await page.getByRole('combobox').filter({ hasText: 'Custom' }).selectOption('CUSTOM')
  await page.getByPlaceholder(/offer of employment/i).fill(`Subject ${templateName}`)
  await page.locator('[contenteditable="true"]').first().fill('Hello {{employee.firstName}}, this is an E2E test.')

  await page.getByRole('button', { name: /save template/i }).click()

  // Save must NOT 400 (the validation fix) and returns to the list with the new row.
  await expect(page.getByText(/bad request|^400$/i)).not.toBeVisible()
  await page.waitForURL('**/hrms/letters/templates')
  await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 })
})

test('letter templates list shows templates', async ({ page }) => {
  await page.goto('/hrms/letters/templates')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('letter template preview returns rendered HTML (verifies the apiText fix)', async ({ page, apiRequest }) => {
  const employeeId = await firstEmployeeId(apiRequest)

  await page.goto('/hrms/letters/templates')
  // Open the first template for editing (row click navigates to /:id).
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/letters/templates/**')
  await page.waitForLoadState('networkidle')

  await page.getByPlaceholder('Employee ID').fill(employeeId)

  const previewResp = page.waitForResponse(
    (r) => r.url().includes('/preview') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const resp = await previewResp

  // The fix routes preview through apiText() and the endpoint returns text/html, not JSON.
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type'] ?? '').toMatch(/html/i)

  // The iframe only renders when previewHtml is truthy → its presence proves rendered HTML.
  await expect(page.locator('iframe[title="Letter preview"]')).toBeVisible({ timeout: 5_000 })
})
