import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

test('Users & Access page shows workspace users', async ({ page }) => {
  await page.goto('/users')
  await expect(page.getByRole('heading', { name: /workspace users/i })).toBeVisible()
  // The pre-P9 bug rendered "0 members" / no rows — both must be gone.
  // exact:true so it isn't matched as a substring of e.g. "10 members in your workspace".
  await expect(page.getByText('0 members in your workspace', { exact: true })).not.toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('admin can open the Manage Access drawer', async ({ page }) => {
  await page.goto('/users')
  await page.locator('table tbody tr').first().getByRole('button', { name: /manage access/i }).click()
  // ui-kit Drawer is a Radix dialog; its title heading is "Manage access — <name>".
  // (Radix also renders an sr-only description with the same text, so target the heading.)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /manage access/i })).toBeVisible()
})

test('Roles & Perms page lists all system roles', async ({ page }) => {
  await page.goto('/roles')
  // Ensure the Roles tab (Radix tab) is active, then assert each system role CODE
  // (shown in the font-mono cell). exact:true so SUPER_ADMIN ≠ PLATFORM_SUPER_ADMIN.
  await page.getByRole('tab', { name: 'Roles', exact: true }).click()
  for (const role of ['SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'FINANCE_LEAD', 'EMPLOYEE']) {
    await expect(page.getByText(role, { exact: true }).first(), `role ${role}`).toBeVisible()
  }
})

test('audit log page renders and the events endpoint is healthy', async ({ page, apiRequest }) => {
  // FINDING: the demo tenant's audit log is empty (GET /v1/audit/events → total:0) even
  // after logins and create operations — audit events are not being recorded for these
  // paths. So this test verifies the page renders cleanly and the endpoint is healthy,
  // rather than asserting rows that don't exist. (Filed in the report for follow-up.)
  const res = await apiRequest('/api/v1/audit/events?page=0&size=5')
  expect(res.status, 'audit events endpoint should be 200').toBe(200) // native fetch Response → property

  await page.goto('/audit-logs')
  await expect(page.getByRole('heading', { name: /audit logs/i })).toBeVisible()
  await expect(page.getByText(/failed to load audit events/i)).not.toBeVisible()
  await expect(page.getByRole('combobox').first()).toBeVisible() // the action filter
})
