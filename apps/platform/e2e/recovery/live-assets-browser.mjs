// Browser check of the Assets view (Onboarding & assets → Assets) and the
// compliance filing calendar: register an asset, assign it, take it back,
// check its history after a reload, then page the calendar. The QA asset is
// removed at the end.
//
//   node e2e/recovery/live-assets-browser.mjs
import { execFileSync } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
const base = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const tag = `UI-${Date.now()}`
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 60000 })
  await page.goto(base + '/hrms/onboarding/instances?view=assets')
  await page.getByRole('button', { name: 'Register asset' }).click()
  let dialog = page.getByRole('dialog')
  const pickCompany = dialog.locator('button').filter({ hasText: 'Choose a company' })
  if (await pickCompany.count()) { await pickCompany.click(); await page.getByRole('option').first().click() }
  await dialog.getByLabel('Asset tag', { exact: true }).fill(tag)
  await dialog.getByLabel('Category', { exact: true }).fill('Laptop')
  await dialog.getByLabel('Asset name', { exact: true }).fill('UI verification laptop')
  await dialog.getByRole('button', { name: 'Register asset' }).click()
  const row = page.getByRole('row').filter({ hasText: tag })
  await expect(row).toBeVisible()
  await expect(row.getByText('In store', { exact: true })).toBeVisible()
  await row.getByRole('button', { name: 'Assign', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Find employee').fill('admin@unifiedtree.demo')
  await dialog.getByRole('button', { name: /Admin User/ }).click()
  await dialog.getByRole('button', { name: 'Confirm assignment' }).click()
  await expect(row.getByText('With employee', { exact: true })).toBeVisible()
  await row.getByRole('button', { name: 'Take back' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Condition on return').fill('Intact after UI verification')
  await dialog.getByRole('button', { name: 'Record return' }).click()
  await expect(row.getByText('Returned', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: tag }).getByText('Intact after UI verification')).toBeVisible()
  await page.getByRole('row').filter({ hasText: tag }).getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Asset allocation history' })).toContainText('Admin User')
  await expect(page.getByRole('region', { name: 'Asset allocation history' })).toContainText('back')
  await page.goto(base + '/hrms/compliance')
  await expect(page.getByRole('region', { name: 'Filing calendar' })).toBeVisible()
  await page.getByRole('button', { name: 'Next →' }).click()
  await page.getByRole('button', { name: '← Previous' }).click()
  expect(errors).toEqual([])
  console.log('PASS asset registration, assignment, return and persisted reload; calendar navigation')
} finally {
  await browser.close()
  try {
    sql(`delete from hrms.asset_allocations where asset_id in (select id from hrms.onboarding_assets where asset_tag='${tag}')`)
    sql(`delete from hrms.onboarding_assets where asset_tag='${tag}'`)
    console.log('cleanup: removed the QA asset')
  } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
}
