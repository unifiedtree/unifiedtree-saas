import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

test('no uncaught JS errors across manager pages', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const p of ['/team', '/me', '/hrms/leave', '/hrms/attendance', '/hrms/employees']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
  }
  const real = errors.filter(
    (e) => !e.includes('aria-describedby') && !e.includes('DevTools') && !e.includes('ResizeObserver'),
  )
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})

test('manager can sign out and is redirected to login', async ({ page }) => {
  await page.goto('/team')
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toMatch(/\/login/)
})
