import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const base = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const browser = await chromium.launch({ headless: true })
const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const purpose = `Browser inspection ${Date.now()}`
admin.on('pageerror', e => errors.push(e.message))
try {
  await admin.goto(base + '/login')
  await admin.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await admin.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await admin.locator('button[type=submit]').click()
  await admin.waitForURL(url => !url.pathname.includes('login'), { timeout: 60000 })
  await admin.goto(base + '/hrms/compliance')
  await admin.locator('[aria-label="Compliance views"]').getByRole('button', { name: /^Inspector access/ }).click()
  await admin.getByLabel('Inspector name', { exact: true }).fill('Browser inspector')
  await admin.getByLabel('Audit purpose').fill(purpose)
  const future = new Date(Date.now() + 3600000)
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  await admin.getByLabel('Access ends (within 7 days)').fill(local)
  await admin.getByRole('button', { name: 'Create inspection link' }).click()
  await expect(admin.getByLabel('Inspection link', { exact: true })).toBeVisible()
  const link = await admin.getByLabel('Inspection link', { exact: true }).inputValue()
  const row = admin.getByRole('row').filter({ hasText: purpose })
  await row.getByRole('button', { name: 'Documents', exact: true }).click()
  await admin.getByLabel('Shared document title').fill('Browser shared filing')
  await admin.getByLabel('Inspection PDF').setInputFiles('test-results/recovery/inspection-fixture.pdf')
  await admin.getByRole('button', { name: 'Share PDF', exact: true }).click()
  await expect(admin.getByText('Browser shared filing', { exact: true })).toBeVisible()
  const guest = await browser.newPage()
  guest.on('pageerror', e => errors.push(e.message))
  await guest.goto(link)
  await expect(guest.getByRole('heading', { name: purpose })).toBeVisible()
  const pdfDownloading = guest.waitForEvent('download')
  await guest.getByRole('button', { name: 'Download PDF', exact: true }).click()
  expect(await (await pdfDownloading).failure()).toBeNull()
  const downloading = guest.waitForEvent('download')
  await guest.getByRole('button', { name: 'Export records (CSV)' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^compliance-inspection-.*\.csv$/)
  expect(await download.failure()).toBeNull()
  admin.once('dialog', (d) => d.accept())
  await admin.getByRole('row').filter({ hasText: purpose }).getByRole('button', { name: 'Revoke' }).click()
  await expect(admin.getByRole('row').filter({ hasText: purpose }).getByText('Revoked', { exact: true })).toBeVisible()
  await guest.getByRole('button', { name: 'Export records (CSV)' }).click()
  await expect(guest.getByRole('alert').first()).toContainText(/invalid|expired|revoked/i)
  expect(errors).toEqual([])
  console.log('PASS browser inspection link creation, anonymous access and revocation')
} finally {
  await browser.close()
  try {
    sql(`delete from compliance_mgmt.inspection_documents where session_id in (select id from compliance_mgmt.inspector_sessions where purpose='${purpose}')`)
    sql(`delete from compliance_mgmt.inspector_sessions where purpose='${purpose}'`)
    console.log('cleanup: removed the QA inspection')
  } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
}
