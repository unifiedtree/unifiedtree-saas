import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('no uncaught JS errors across finance pages', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const p of ['/hrms/reports', '/hrms/payroll/settings', '/hrms/payroll/components', '/hrms/payroll/runs', '/hrms/employees']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
  }
  const real = errors.filter(
    (e) => !e.includes('aria-describedby') && !e.includes('DevTools') && !e.includes('ResizeObserver'),
  )
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})

test('finance can sign out and is redirected to login', async ({ page }) => {
  await page.goto('/hrms/reports')
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toMatch(/\/login/)
})
