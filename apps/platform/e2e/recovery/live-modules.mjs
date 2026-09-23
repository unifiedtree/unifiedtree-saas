import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const response = await fetch(api + '/v1/public/module-plans')
assert.equal(response.status, 200, 'Public module catalog must load without signing in')
const plans = await response.json()
assert.ok(plans.some(plan => plan.key === 'hr-employees' && plan.status === 'AVAILABLE'))
assert.ok(plans.every(plan => typeof plan.included === 'boolean'), 'Catalog included flag is part of the real DB contract')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1536, height: 1000 } })
const errors = []
const failures = []
let simulateOutage = false
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (response.url().includes('/v1/public/module-plans') && response.status() >= 400 && !simulateOutage) failures.push(response.status())
})
await page.route('**/api/v1/public/module-plans', async route => {
  if (simulateOutage) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Test catalog outage' }) })
  return route.continue()
})
mkdirSync('test-results/recovery', { recursive: true })
try {
  await page.goto(ui + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  // Exercise the actual first page after login; do not bypass it with page.goto.
  await page.waitForURL('**/modules', { timeout: 30000 })
  const hr = () => page.getByRole('button', { name: 'HR & Employees', exact: true })
  await expect(hr()).toBeEnabled({ timeout: 30000 })
  await expect(page.getByRole('button', { name: /Manage plan/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading apps' })).toHaveCount(0)
  await page.getByPlaceholder('Search apps', { exact: false }).fill('no-such-app-local-check')
  await expect(page.getByText('No apps match your search.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(page.getByRole('button', { name: /Reports & BI/ })).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/recovery/modules-loaded-live.png', fullPage: true })
  await hr().click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Live overview', exact: true })).toBeVisible()
  console.log('PASS: login lands on loaded catalog; company owner opens HR dashboard; empty search is explicit')

  simulateOutage = true
  await page.goto(ui + '/modules')
  const outage = page.getByRole('alert').filter({ hasText: "We couldn't load the app catalog." })
  await expect(outage).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('status', { name: 'Loading apps' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'HRMS', exact: true })).toBeEnabled()
  await page.screenshot({ path: 'test-results/recovery/modules-outage-live.png', fullPage: true })
  await page.getByRole('button', { name: 'HRMS', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Live overview', exact: true })).toBeVisible()
  await page.goto(ui + '/modules')
  await expect(outage).toBeVisible({ timeout: 30000 })
  simulateOutage = false
  await outage.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(hr()).toBeEnabled({ timeout: 15000 })
  await expect(outage).toHaveCount(0)
  await page.reload()
  await expect(hr()).toBeEnabled({ timeout: 15000 })
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  writeFileSync('test-results/recovery/live-modules.json', JSON.stringify({ passed: true, catalogCount: plans.length, freshLogin: true, opensHrDashboard: true, catalogOutageFallback: true, retryRecovery: true, reload: true, errors, failures }, null, 2))
  console.log('PASS: catalog outage shows retry and keeps enabled HR app accessible; retry and reload restore real catalog')
} finally { await browser.close() }
