import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

test('My Letters page renders for employee', async ({ page }) => {
  await page.goto('/hrms/letters/generated')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
})

test('employee reads only their OWN letters, never templates', async ({ apiRequest }) => {
  const mine = await apiRequest('/api/v1/letters/my')
  expect(mine.status, 'own generated letters (hrms.letters.read.self)').toBe(200)
  // Letter templates are an HR authoring surface — the employee must not read them.
  const templates = await apiRequest('/api/v1/letters/templates')
  expect(templates.status, 'letter templates are HR-only').toBe(403)
})
