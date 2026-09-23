import { chromium, expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const base = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
const failures = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (response.url().includes('/api/') && response.status() >= 400) failures.push({ url: response.url(), status: response.status() })
})
mkdirSync('test-results/recovery', { recursive: true })
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 })
  console.log('Login landed:', new URL(page.url()).pathname)
  const source = readFileSync('src/App.tsx', 'utf8')
  const allRoutes = [...new Set(['/modules', '/dashboard', ...[...source.matchAll(/path="(\/hrms\/[^":*]+)"/g)].map(m => m[1]), '/hrms/employees/22222222-2222-2222-2222-222222222222', '/hrms/attendance?tab=corrections', '/settings', '/users', '/roles'])]
  const routes = process.env.RECOVERY_ROUTES ? process.env.RECOVERY_ROUTES.split(',') : allRoutes
  const results = []
  for (const route of routes) {
    const startErrors = errors.length, startFailures = failures.length
    await page.goto(base + route)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    if (route === '/modules') {
      await expect(page.getByRole('button', { name: 'HR & Employees', exact: true })).toBeEnabled({ timeout: 30000 })
      await expect(page.getByRole('status', { name: 'Loading apps' })).toHaveCount(0)
    }
    if (route === '/dashboard') {
      const overview = page.getByRole('region', { name: 'Live overview' })
      await expect(overview).toBeVisible({ timeout: 30000 })
      await expect(overview).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
      await expect(overview).not.toContainText('Unavailable')
      await expect(overview).not.toContainText('Loading...')
      await page.mouse.move(0, 0)
    }
    const text = await page.locator('body').innerText()
    const result = { route, landed: new URL(page.url()).pathname, headings: await page.locator('h1').allTextContents(), errors: errors.slice(startErrors), failures: failures.slice(startFailures), text: text.slice(-2000) }
    results.push(result)
    console.log(route, '=>', result.landed, JSON.stringify(result.headings), result.failures.map(f => f.status).join(','))
    if (route === '/dashboard') await page.screenshot({ path: 'test-results/recovery/company-admin-live.png', fullPage: true })
    writeFileSync(`test-results/recovery/${process.env.RECOVERY_ROUTES ? 'live-browser-targeted' : 'live-browser'}.json`, JSON.stringify(results, null, 2))
  }
  if (errors.length || failures.some(f => f.status >= 500)) process.exitCode = 1
} finally { await browser.close() }
