import { test, expect } from '../../fixtures/test-base'
import { pickCompany, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

// NB: Organization tabs are custom <button>s, NOT role="tab" (verified in OrgSetup.tsx),
// and the labels are exactly these — note "Emp. Types" (not "Employment Types").
const ENTITY_TABS = ['Companies', 'Branches', 'Departments', 'Designations', 'Grades', 'Emp. Types', 'Shifts']

test('organization page shows all 7 entity tabs', async ({ page }) => {
  await page.goto('/hrms/organization')
  for (const tab of ENTITY_TABS) {
    await expect(page.getByRole('button', { name: tab }).first(), `tab "${tab}"`).toBeVisible()
  }
})

test('admin sees existing companies', async ({ page }) => {
  await page.goto('/hrms/organization')
  // Companies tab is the default; demo tenant has 2 companies → at least one row.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('admin can create a new department', async ({ page }) => {
  await page.goto('/hrms/organization')
  await page.getByRole('button', { name: 'Departments' }).click()

  // Departments are company-scoped — pick a company in the "Viewing for:" selector
  // (also dodges the empty-state when no company is pre-selected).
  await pickCompany(page)

  const deptName = uniq('E2E-Dept')
  await page.getByRole('button', { name: /add department/i }).click()

  // Target inputs by placeholder — getByLabel does not resolve for the ui-kit <Field>
  // wrapper in practice (the cloned id/htmlFor association isn't matched at runtime).
  await page.getByPlaceholder('e.g. Engineering').fill(deptName)
  // exact:true — "e.g. ENG" is otherwise a case-insensitive substring of "e.g. Engineering".
  await page.getByPlaceholder('e.g. ENG', { exact: true }).fill(`E${Date.now() % 100000}`)

  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // New department appears in the DataTable.
  await expect(page.getByText(deptName)).toBeVisible({ timeout: 10_000 })
})
