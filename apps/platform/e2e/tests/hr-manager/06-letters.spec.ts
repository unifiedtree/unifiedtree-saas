import { test, expect } from '../../fixtures/test-base'
import { firstEmployeeId, firstLetterTemplateId } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

test('HR sees the letter templates list', async ({ page }) => {
  await page.goto('/hrms/letters/templates')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('HR can preview a letter — text/html (apiText fix), as HR', async ({ page, apiRequest }) => {
  const employeeId = await firstEmployeeId(apiRequest)
  await page.goto('/hrms/letters/templates')
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/letters/templates/**')
  await page.waitForLoadState('networkidle')

  await page.getByPlaceholder('Employee ID').fill(employeeId)
  const previewResp = page.waitForResponse(
    (r) => r.url().includes('/preview') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const resp = await previewResp
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type'] ?? '').toMatch(/html/i)
  await expect(page.locator('iframe[title="Letter preview"]')).toBeVisible({ timeout: 5_000 })
})

test('HR can generate a letter for an employee (hrms.letters.generate)', async ({ apiRequest }) => {
  const templateId = await firstLetterTemplateId(apiRequest)
  const employeeId = await firstEmployeeId(apiRequest)
  const res = await apiRequest('/api/v1/letters/generate', {
    method: 'POST',
    body: JSON.stringify({ templateId, employeeId }),
  })
  expect(res.status, 'HR generates a letter (has hrms.letters.generate)').toBeLessThan(300)
})
