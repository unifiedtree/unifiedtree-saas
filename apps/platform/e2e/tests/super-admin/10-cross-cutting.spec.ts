import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

test('no uncaught JS errors across the major pages', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  const pages = [
    '/dashboard',
    '/hrms/employees',
    '/hrms/organization',
    '/hrms/leave',
    '/hrms/onboarding',
    '/hrms/letters/templates',
    '/hrms/reports',
    '/hrms/payroll/settings',
    '/users',
    '/audit-logs',
  ]

  for (const p of pages) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
  }

  const real = errors.filter(
    (e) =>
      !e.includes('aria-describedby') &&
      !e.includes('DevTools') &&
      !e.includes('ResizeObserver'),
  )
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})

test('admin can sign out and is redirected to login', async ({ page }) => {
  await page.goto('/dashboard')
  // Logout is a "Sign out" button in the sidebar footer (not a menu item), visible
  // while the sidebar is expanded (the default for a fresh context).
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toMatch(/\/login/)
})
