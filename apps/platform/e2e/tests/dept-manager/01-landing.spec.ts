import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

test('DEPT_MANAGER lands on /team (not /dashboard)', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL('**/team', { timeout: 10_000 })
  expect(page.url()).toMatch(/\/team/)
  expect(page.url()).not.toMatch(/\/dashboard/)
})

test('role badge shows Dept Manager', async ({ page }) => {
  await page.goto('/team')
  await expect(page.getByText(/dept manager/i).first()).toBeVisible()
})

test('manager sidebar shows their team-scoped HRMS sections', async ({ page }) => {
  // Navigate to an HRMS route so the HRMS module expands and its children render.
  await page.goto('/hrms/leave')
  await page.waitForLoadState('networkidle')
  // visibleForRoles for DEPT_MANAGER (PlatformShell): Directory, Attendance, Leave, Reports.
  for (const label of ['Directory', 'Attendance', 'Leave', 'Reports']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }).first(),
      `nav "${label}" should be visible to manager`,
    ).toBeVisible()
  }
})

test('manager sidebar hides HR/admin sections', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.waitForLoadState('networkidle')
  // None of these include DEPT_MANAGER in visibleForRoles.
  for (const label of ['Organization', 'Onboarding', 'Letters', 'Users & Access', 'Roles & Perms', 'Audit Logs', 'Payroll Settings']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }),
      `nav "${label}" must be hidden from manager`,
    ).toHaveCount(0)
  }
})

test('manager can navigate their pages without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const path of ['/team', '/me', '/hrms/leave']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  const real = errors.filter((e) => !e.includes('aria-describedby') && !e.includes('ResizeObserver'))
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})
