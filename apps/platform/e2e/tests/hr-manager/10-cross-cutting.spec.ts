import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

test('no uncaught JS errors across HR pages', async ({ page }) => {
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
    '/hrms/payroll/runs',
  ]
  for (const p of pages) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
  }

  const real = errors.filter(
    (e) => !e.includes('aria-describedby') && !e.includes('DevTools') && !e.includes('ResizeObserver'),
  )
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})

test('HR can sign out and is redirected to login', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toMatch(/\/login/)
})
