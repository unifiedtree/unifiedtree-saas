import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

test('HR Manager lands on /dashboard after login', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL('**/dashboard')
  expect(page.url()).toMatch(/\/dashboard/)
})

test('role badge shows HR Manager', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByText(/hr manager/i).first()).toBeVisible()
})

test('HR sidebar shows the operational HR sections', async ({ page }) => {
  // HRMS children render once the module is expanded (shell auto-expands on an HRMS route).
  await page.goto('/hrms/employees')
  await page.waitForLoadState('networkidle')
  for (const label of ['Directory', 'Organization', 'Attendance', 'Leave', 'Onboarding', 'Letters', 'Reports']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }).first(),
      `nav "${label}" should be visible to HR`,
    ).toBeVisible()
  }
})

test('HR sidebar hides the platform-admin sections', async ({ page }) => {
  await page.goto('/hrms/employees')
  await page.waitForLoadState('networkidle')
  // These nav items are gated to SUPER_ADMIN (visibleForRoles) — HR must not see them.
  for (const label of ['Users & Access', 'Roles & Perms', 'Audit Logs']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }),
      `nav "${label}" must be hidden from HR`,
    ).toHaveCount(0)
  }
})

test('HR can navigate all their pages without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  for (const path of [
    '/dashboard',
    '/hrms/employees',
    '/hrms/organization',
    '/hrms/leave',
    '/hrms/onboarding',
    '/hrms/letters/templates',
    '/hrms/reports',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }

  const real = errors.filter((e) => !e.includes('aria-describedby') && !e.includes('ResizeObserver'))
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})
