import { type Page, expect } from '@playwright/test'

export async function waitForToast(page: Page, text: string | RegExp, timeout = 5000) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible({ timeout })
}

export async function expectNoConsoleErrors(page: Page, fn: () => Promise<void>) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await fn()
  // Filter out known-noisy errors (third-party warnings, etc.)
  const real = errors.filter(
    (e) =>
      !e.includes('Download the React DevTools') &&
      !e.includes('aria-describedby'),
  )
  expect(real, `Unexpected console errors:\n${real.join('\n')}`).toEqual([])
}

export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  expectedStatus = 200,
) {
  return await page.waitForResponse(
    (response) =>
      (typeof urlPattern === 'string'
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url())) &&
      response.status() === expectedStatus,
  )
}
