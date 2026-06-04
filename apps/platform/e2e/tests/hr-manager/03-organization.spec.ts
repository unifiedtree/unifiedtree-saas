import { test, expect } from '../../fixtures/test-base'
import { pickCompany, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

// Org tabs are custom <button>s (not role="tab"); "Emp. Types" not "Employment Types".
const ENTITY_TABS = ['Companies', 'Branches', 'Departments', 'Designations', 'Grades', 'Emp. Types', 'Shifts']

test('HR sees the organization entity tabs', async ({ page }) => {
  await page.goto('/hrms/organization')
  for (const tab of ENTITY_TABS) {
    await expect(page.getByRole('button', { name: tab }).first(), `tab "${tab}"`).toBeVisible()
  }
})

test('HR sees existing companies', async ({ page }) => {
  await page.goto('/hrms/organization')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('HR can create a department (hrms.department.write)', async ({ page }) => {
  await page.goto('/hrms/organization')
  await page.getByRole('button', { name: 'Departments' }).click()
  await pickCompany(page)

  const deptName = uniq('HR-Dept')
  await page.getByRole('button', { name: /add department/i }).click()
  await page.getByPlaceholder('e.g. Engineering').fill(deptName)
  await page.getByPlaceholder('e.g. ENG', { exact: true }).fill(`H${Date.now() % 100000}`)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(page.getByText(deptName)).toBeVisible({ timeout: 10_000 })
})
