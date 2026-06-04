import { test, expect } from '../../fixtures/test-base'
import { pickCompany, uniq } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

// A unique email created in test 2 and re-used by the search test (serial state).
const newEmail = `${uniq('e2e')}@test.demo`

test('employee list page loads and shows existing employees', async ({ page }) => {
  await page.goto('/hrms/employees')

  // Stats cards ("Total", "Active" …) — first match each.
  await expect(page.getByText(/total/i).first()).toBeVisible()
  await expect(page.getByText(/active/i).first()).toBeVisible()

  // Seeded demo tenant has employees → at least one row.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('admin can create a new employee with invitation', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.getByRole('button', { name: /add employee/i }).click()

  // Drawer opens (its own "Add Employee" heading).
  await expect(page.getByRole('heading', { name: /add employee/i })).toBeVisible()

  // Step 1 — Basic Info. The form's <label>s are not associated with inputs
  // (no htmlFor/id) so we target by placeholder. Company select lives here too and
  // must be chosen explicitly (its state seeds from a query that may resolve late).
  await pickCompany(page)
  await page.getByPlaceholder('First name').fill('E2ETest')
  await page.getByPlaceholder('employee@company.com').fill(newEmail)

  // Jump straight to the final step ("7. Emergency") via its step pill — the
  // intermediate steps (Work/Identity/Bank/Address) are all optional.
  await page.getByRole('button', { name: /emergency/i }).click()

  // "Send invitation email" checkbox is on the final step and defaults to checked
  // (the Pattern-A invite flow). Super admin has the invite permission.
  const invite = page.getByRole('checkbox')
  await expect(invite).toBeVisible()
  await expect(invite).toBeChecked()

  // Verify the create itself (the regression target). We assert the POST response
  // rather than the toast/drawer-close because, when SMTP isn't reachable, the
  // follow-up invite-email send blocks and the drawer stays open with no toast
  // (a separate finding — see report). The employee is created regardless.
  const createResp = page.waitForResponse(
    (r) => r.url().includes('/v1/hrms/employees') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /create employee/i }).click()
  expect((await createResp).status(), 'employee create should return 201').toBe(201)

  // Durable check: the new employee (first name "E2ETest") is listed in the directory.
  await page.goto('/hrms/employees')
  await expect(page.getByText('E2ETest').first()).toBeVisible({ timeout: 10_000 })
})

test('employee detail page shows the core tabs', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/employees/**')

  // Radix Tabs → role="tab". Admin sees all; assert the always-present core tabs.
  for (const tab of ['Overview', 'Contact', 'Work']) {
    await expect(page.getByRole('tab', { name: new RegExp(tab, 'i') }).first()).toBeVisible()
  }
})

test('admin can navigate through employee detail tabs without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/hrms/employees')
  await page.locator('table tbody tr').first().click()
  await page.waitForURL('**/hrms/employees/**')

  for (const tab of ['Overview', 'Contact', 'Work']) {
    const tabEl = page.getByRole('tab', { name: new RegExp(tab, 'i') }).first()
    if (await tabEl.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tabEl.click()
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(/access restricted/i)).not.toBeVisible()
    }
  }

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('admin can filter the employee directory via search', async ({ page }) => {
  await page.goto('/hrms/employees')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })

  const search = page.getByPlaceholder(/search/i).first()

  // The seeded "Admin" employee is always present → searching it keeps ≥1 row.
  await search.fill('Admin')
  await page.waitForTimeout(600) // debounce
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })

  // A guaranteed non-match then collapses the list, proving the filter is live.
  // (Scope to the table body so the header "Super Admin" badge isn't matched.)
  await search.fill('zzz-no-such-employee-xyz')
  await page.waitForTimeout(600)
  await expect(page.locator('table tbody').getByText('Admin')).toHaveCount(0)
})
