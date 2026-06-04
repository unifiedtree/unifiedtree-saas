import { test, expect } from '../fixtures/test-base'

test.describe('Framework smoke test', () => {
  // Runs only in the super-admin project (which gets the admin token injected).
  test('super-admin loads dashboard after auth setup', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'super-admin', 'super-admin project only')

    await page.goto('/dashboard')

    // Should NOT redirect to /login (proves auth injection worked)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    expect(page.url()).not.toContain('/login')

    // Page renders something meaningful
    await expect(page.locator('body')).toContainText(/welcome|dashboard|admin|overview/i)
  })

  // Self-contained: makes its own token-less context, so it proves the guard
  // regardless of project. Pinned to the 'unauthenticated' project to run once.
  test('unauthenticated user is redirected to login', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'unauthenticated', 'unauthenticated project only')

    const context = await browser.newContext()      // no token injected
    const page = await context.newPage()
    await page.goto('/dashboard')

    await page.waitForURL(/\/login/, { timeout: 15_000 })
    expect(page.url()).toContain('/login')
    await context.close()
  })
})
