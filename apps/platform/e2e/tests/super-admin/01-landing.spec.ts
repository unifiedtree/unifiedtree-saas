import { test, expect } from '../../fixtures/test-base'

// Shared serial state; all tests gated to the super-admin project.
test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

test('admin lands on /dashboard after login', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL('**/dashboard')
  expect(page.url()).toMatch(/\/dashboard/)
})

test('role badge shows SUPER_ADMIN', async ({ page }) => {
  await page.goto('/dashboard')
  // Header badge renders the human label "Super Admin" (ROLE_LABELS), case-insensitive.
  await expect(page.getByText(/super admin/i).first()).toBeVisible()
})

test('admin sidebar shows all expected sections', async ({ page }) => {
  // The HRMS module's child links only render once the module is expanded, and the
  // shell auto-expands the module matching the current path (PlatformShell openModules
  // init). So land on an HRMS route first to expose Directory/Organization/etc.
  await page.goto('/hrms/employees')
  await page.waitForLoadState('networkidle')

  const expectedNav = [
    'Directory', // /hrms/employees
    'Organization',
    'Attendance',
    'Leave',
    'Onboarding',
    'Letters',
    'Reports',
    'Users & Access',
    'Roles & Perms',
    'Audit Logs',
    'Settings',
  ]

  for (const label of expectedNav) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }).first(),
      `nav link "${label}" should be visible`,
    ).toBeVisible()
  }
})

test('admin can navigate to dashboard, employees, settings without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  for (const path of ['/dashboard', '/hrms/employees', '/settings']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})
