/* global process, console, document, innerWidth */
/* eslint-disable no-useless-escape -- the view-name regexes are kept as written */
import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// RECOVERY_DB points the check and cleanup at another local database (e.g. a test copy); default unchanged.
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Uses the isolated recovery API and real browser mutations, not route fixtures.
const base = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const stamp = Date.now()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const apiFailures = []
const sessionProbes = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (!response.url().includes('/api/') || response.status() < 400) return
  const entry = `${response.status()} ${response.url()}`
  if (response.url().includes('/canonical-auth/refresh') && response.status() === 422) sessionProbes.push(entry)
  else apiFailures.push(entry)
})
mkdirSync('test-results/recovery', { recursive: true })
// Date fields use the shared calendar: open it, then pick year, month and day.
async function pickDate(field, iso) {
  const [y, m, d] = iso.split('-').map(Number)
  await field.click()
  const calendar = page.getByRole('dialog', { name: 'Choose date' })
  await calendar.getByRole('button', { name: 'Choose year', exact: true }).click()
  await calendar.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await calendar.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await calendar.locator(`[role=gridcell][aria-label*=", ${d} ${MONTHS[m - 1]} ${y}"]`).click()
  await expect(calendar).toBeHidden()
}
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 })
  await page.goto(base + '/hrms/performance')
  await page.locator('[aria-label="Performance views"]').getByRole('button', { name: /^Goals\ \&\ KPIs/ }).click()
  await page.getByRole('button', { name: 'Create KPI', exact: true }).click()
  let drawer = page.getByRole('dialog')
  await drawer.getByLabel('Find employee').fill('Reader')
  await drawer.getByRole('button', { name: /Reader User/ }).click()
  await drawer.getByLabel('KPI title').fill(`Browser KPI ${stamp}`)
  await drawer.getByLabel('Target value').fill('100')
  await drawer.getByLabel('Starting value').fill('10')
  await drawer.getByLabel('Unit', { exact: true }).fill('tasks')
  await drawer.getByRole('button', { name: 'Save KPI', exact: true }).click()
  await expect(drawer).toBeHidden()
  await page.getByLabel('Search KPI titles').fill(`Browser KPI ${stamp}`)
  await page.getByRole('button', { name: /Browser KPI/ }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('New current value').fill('45')
  await drawer.getByLabel('Progress note').fill('Browser verified progress')
  await drawer.getByRole('button', { name: 'Record progress', exact: true }).click()
  await expect(drawer.getByText('Browser verified progress', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Record progress', exact: true })).toBeEnabled()
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(drawer).toBeHidden()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('Status', { exact: true }).selectOption('AT_RISK')
  await drawer.getByRole('button', { name: 'Save KPI', exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('row').getByText('At risk', { exact: true })).toBeVisible()
  await page.reload()
  await page.locator('[aria-label="Performance views"]').getByRole('button', { name: /^Goals\ \&\ KPIs/ }).click()
  await page.getByLabel('Search KPI titles').fill(`Browser KPI ${stamp}`)
  await expect(page.getByText('45 / 100 tasks', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/recovery/performance-kpis-live.png', fullPage: true })
  console.log('PASS: KPI create, quantified progress, audit history, status edit and reload persistence')
  await page.getByRole('button', { name: /Browser KPI/ }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Drop KPI', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm drop', exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('row').getByText('Dropped', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Browser KPI/ }).click()
  drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Browser verified progress', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Record progress', exact: true })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(drawer).toBeHidden()
  console.log('PASS: dropping a KPI keeps history and removes its progress action')

  await page.locator('[aria-label="Performance views"]').getByRole('button', { name: /^Review\ cycles/ }).click()
  await page.getByRole('button', { name: 'Create cycle', exact: true }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('Cycle name').fill(`Browser review cycle ${stamp}`)
  const periodStart = drawer.locator('label', { hasText: 'Period start' }).getByRole('combobox')
  const periodEnd = drawer.locator('label', { hasText: 'Period end' }).getByRole('combobox')
  await pickDate(periodStart, '2026-09-01')
  await pickDate(periodEnd, '2026-09-30')
  await expect(periodStart).toContainText('1 Sep 2026')
  await expect(periodEnd).toContainText('30 Sep 2026')
  await drawer.getByRole('button', { name: 'Create cycle', exact: true }).click()
  await expect(drawer).toBeHidden()
  expect(sql(`select period_start || '|' || period_end from performance_mgmt.review_cycles where name='Browser review cycle ${stamp}'`)).toBe('2026-09-01|2026-09-30')
  await page.getByRole('button', { name: `Browser review cycle ${stamp}`, exact: true }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('Find employee').fill('Reader')
  await drawer.getByRole('button', { name: /Reader User/ }).click()
  await drawer.getByRole('button', { name: 'Assign reviews (1)', exact: true }).click()
  await expect(drawer.getByText('1 employees considered; 1 new reviews created.', { exact: true })).toBeVisible()
  await expect(drawer.getByText('Active', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/recovery/performance-cycle-live.png', fullPage: true })
  await drawer.getByRole('button', { name: 'Close cycle', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm close cycle', exact: true }).click()
  await expect(drawer.getByText('Closed', { exact: true })).toBeVisible()
  await expect(drawer.getByText('Missed', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.locator('[aria-label="Performance views"]').getByRole('button', { name: /^Employee\ reviews/ }).click()
  await page.getByLabel('Review cycle').selectOption({ label: `Browser review cycle ${stamp}` })
  await page.getByRole('button', { name: 'View review', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Reader User', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Missed', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close panel', exact: true }).click()
  console.log('PASS: cycle creation, employee self-review assignment, progress, close and review details')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[aria-label="Performance views"]').getByRole('button', { name: /^Goals\ \&\ KPIs/ }).click()
  await page.getByRole('button', { name: 'Create KPI', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('KPI title')).toBeVisible()
  await expect.poll(() => page.getByRole('heading', { name: 'Create company KPI', exact: true }).evaluate(element => element.getBoundingClientRect().left)).toBeLessThan(40)
  await expect(page.getByRole('dialog').locator('button[aria-pressed]').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/recovery/performance-mobile-live.png', fullPage: true })
  expect(errors).toEqual([])
  expect(apiFailures).toEqual([])
  console.log('PASS: mobile form remains within viewport; no browser errors or failed feature API responses')
  console.log(`Session restoration: ${sessionProbes.length} expected missing-cookie refresh probes returned 422 before token fallback.`)
} catch (error) {
  console.error('Last page:', (await page.locator('body').innerText()).slice(-6000))
  console.error('Failed API responses:', apiFailures)
  await page.screenshot({ path: 'test-results/recovery/performance-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  // Fixtures: this run's KPI and review cycle (with its reviews and assignments).
  try {
    sql(`delete from performance_mgmt.kpi_progress_updates where goal_id in (select id from performance_mgmt.goals where title='Browser KPI ${stamp}')`)
    sql(`delete from performance_mgmt.goals where title='Browser KPI ${stamp}'`)
    const cycle = `select id from performance_mgmt.review_cycles where name='Browser review cycle ${stamp}'`
    sql(`delete from performance_mgmt.appraisal_reviewer_assignments where cycle_id in (${cycle})`)
    sql(`delete from performance_mgmt.goals where cycle_id in (${cycle})`)
    sql(`delete from performance_mgmt.performance_reviews where cycle_id in (${cycle})`)
    sql(`delete from performance_mgmt.review_cycles where name='Browser review cycle ${stamp}'`)
    console.log('cleanup: removed the KPI and review cycle from this run')
  } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
}

