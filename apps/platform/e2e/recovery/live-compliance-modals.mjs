// Statutory Compliance (/hrms/compliance) — browser acceptance for the
// dialog/drawer rework against the local recovery runtime. As the owner it
// schedules a statutory filing through the new header-action drawer, checks
// the required-field validation, cancels the Mark-filed dialog (must not call
// the API), then records the filing through the dialog and verifies the result
// via the API. The obligation and POSH drawers are opened and cancelled only —
// nothing is written to the confidential POSH register.
//
// /v1/compliance has no DELETE for filings, so the QA filing is removed with
// SQL in the finally block (matched on its unique QA period string).
//
// Run from apps/platform:  node e2e/recovery/live-compliance-modals.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const iso = (d) => d.toISOString().slice(0, 10)
const dueDate = iso(new Date(Date.now() + 10 * 86_400_000))
const suffix = randomUUID().slice(0, 6)
const period = `QA-${suffix}` // unique marker, <= 20 chars (StatutoryFilingRequest @Size)
const reference = `QA-CHALLAN-${suffix}`

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const owner = await login('owner@unifiedtree.demo')
const findFiling = async () => {
  const r = await fetch(`${api}/v1/compliance/filings?companyId=${company}&page=0&size=500`, { headers: owner })
  if (!r.ok) throw new Error(`list filings: ${r.status}`)
  return (await r.json()).content.find((f) => f.period === period)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], failedApi = [], fileCalls = [], createCalls = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
page.on('request', (r) => {
  if (r.method() !== 'POST') return
  const p = new URL(r.url()).pathname
  if (/\/v1\/compliance\/filings\/[^/]+\/file$/.test(p)) fileCalls.push(p)
  if (p.endsWith('/v1/compliance/filings')) createCalls.push(p)
})
let filingId = null
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // The login flow itself currently produces two 401→refresh(422) round trips
  // on every sign-in (recorded in HRMS_MODULE_ACTION_LEDGER.md, auth section).
  // Measure the page, not the login: reset the counters once we are in.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0

  await page.goto(base + '/hrms/compliance')
  await page.getByRole('heading', { name: 'Statutory Compliance' }).waitFor({ timeout: 30_000 })
  check('page renders at /hrms/compliance', true)

  // Calendar tab: the add form is no longer always open; it sits behind the header action.
  const addObligation = page.getByRole('button', { name: 'Add obligation' })
  await addObligation.waitFor({ timeout: 10_000 })
  check('calendar: add form is not rendered inline', (await page.getByLabel('Obligation').count()) === 0)
  await addObligation.click()
  let drawer = page.getByRole('dialog')
  await drawer.getByLabel('Obligation').waitFor({ timeout: 10_000 })
  check('calendar: header action opens a drawer with labelled fields',
    (await drawer.getByLabel('Due date').count()) === 1 && (await drawer.getByLabel('Owner').count()) === 1)
  await drawer.getByRole('button', { name: 'Add obligation' }).click()
  check('calendar: empty obligation shows an inline required error', await drawer.getByText('Give the obligation a title').isVisible())
  await drawer.getByRole('button', { name: 'Cancel' }).click()
  await drawer.waitFor({ state: 'detached', timeout: 10_000 })

  // Filings tab: schedule a filing through the drawer.
  await page.getByRole('tab', { name: 'Statutory Filings' }).click()
  await page.getByRole('button', { name: 'Schedule filing' }).waitFor({ timeout: 10_000 })
  check('filings: add form is not rendered inline', (await page.getByLabel('Period').count()) === 0)
  await page.getByRole('button', { name: 'Schedule filing' }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('Filing type').selectOption('ESI')
  await drawer.getByLabel('Due date').fill('')
  await drawer.getByRole('button', { name: 'Schedule filing' }).click()
  await drawer.getByText('Pick a due date').waitFor({ timeout: 5_000 })
  check('filings: missing due date is blocked client-side (no POST)', createCalls.length === 0)
  await drawer.getByLabel('Due date').fill(dueDate)
  await drawer.getByLabel('Period').fill(period)
  await drawer.getByLabel('Amount (₹)').fill('1234.50')
  await drawer.getByRole('button', { name: 'Schedule filing' }).click()
  await page.getByText('Filing scheduled').first().waitFor({ timeout: 15_000 })
  await drawer.waitFor({ state: 'detached', timeout: 10_000 })
  let row = page.getByRole('row').filter({ hasText: period })
  await row.waitFor({ timeout: 15_000 })
  check('filings: new filing appears in the table after create (list refreshed)', true)
  check('filings: row shows readable "Due" pill and the amount', /\bDue\b/.test(await row.innerText()) && (await row.innerText()).includes('1,234.5'), (await row.innerText()).replace(/\s+/g, ' '))
  const created = await findFiling()
  filingId = created?.id ?? null
  check('API: filing exists as DUE with the entered type/amount/due date',
    created && created.status === 'DUE' && created.filingType === 'ESI' && Number(created.amount) === 1234.5 && created.dueDate === dueDate,
    created ? `${created.status} ${created.filingType} ${created.amount} ${created.dueDate}` : 'not found')

  // Mark filed: Cancel must not call the endpoint.
  await row.getByRole('button', { name: 'Mark filed' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Challan / acknowledgement reference').waitFor({ timeout: 10_000 })
  check('mark filed: dialog names the filing', (await dialog.innerText()).includes(period))
  await dialog.getByLabel('Challan / acknowledgement reference').fill('should-not-save')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  await page.waitForTimeout(500)
  check('mark filed: Cancel does not call /file', fileCalls.length === 0, `${fileCalls.length} calls`)

  // Mark filed for real.
  await row.getByRole('button', { name: 'Mark filed' }).click()
  dialog = page.getByRole('dialog')
  const refInput = dialog.getByLabel('Challan / acknowledgement reference')
  await refInput.waitFor({ timeout: 10_000 })
  check('mark filed: reopened dialog starts with an empty reference', (await refInput.inputValue()) === '')
  await refInput.fill(reference)
  await dialog.getByRole('button', { name: 'Record filing' }).click()
  await page.getByText('Filing recorded').first().waitFor({ timeout: 15_000 })
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  row = page.getByRole('row').filter({ hasText: period })
  await row.filter({ hasText: reference }).waitFor({ timeout: 15_000 })
  const rowText = (await row.innerText()).replace(/\s+/g, ' ')
  check('filings: row now shows readable "Filed" pill + reference, no Mark filed button',
    /\bFiled\b/.test(rowText) && !rowText.includes('FILED') && rowText.includes(reference) && (await row.getByRole('button', { name: 'Mark filed' }).count()) === 0, rowText)
  check('mark filed: exactly one /file call', fileCalls.length === 1, `${fileCalls.length} calls`)
  const filed = await findFiling()
  const todayIst = iso(new Date(Date.now() + 5.5 * 3600_000))
  check('API: filing is FILED with the reference and today as filed date',
    filed && filed.status === 'FILED' && filed.referenceNo === reference && (filed.filedDate === todayIst || filed.filedDate === iso(new Date())),
    filed ? `${filed.status} ${filed.referenceNo} ${filed.filedDate}` : 'not found')

  // POSH: header action opens the drawer; cancel without writing to the register.
  await page.getByRole('tab', { name: 'POSH' }).click()
  await page.getByRole('button', { name: 'Register complaint' }).click()
  drawer = page.getByRole('dialog')
  await drawer.getByLabel('Filed date').waitFor({ timeout: 10_000 })
  check('posh: header action opens the register drawer with labelled fields',
    (await drawer.getByLabel('Severity').count()) === 1 && (await drawer.getByLabel('Description').count()) === 1)
  await drawer.getByRole('button', { name: 'Cancel' }).click()
  await drawer.waitFor({ state: 'detached', timeout: 10_000 })
  check('posh: no inline register form on the tab', (await page.getByLabel('Filed date').count()) === 0)

  // Employee-scope login cannot record filings.
  const reader = await login('reader@unifiedtree.demo')
  const denied = await fetch(`${api}/v1/compliance/filings/${filingId}/file`, { method: 'POST', headers: reader, body: '{}' })
  check('employee login cannot mark a filing filed', denied.status === 403, `${denied.status}`)

  mkdirSync('test-results/recovery', { recursive: true })
  await page.getByRole('tab', { name: 'Statutory Filings' }).click()
  await page.getByRole('row').filter({ hasText: period }).waitFor({ timeout: 10_000 })
  await page.screenshot({ path: 'test-results/recovery/compliance-modals-live.png', fullPage: true })
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
} catch (e) {
  check('scenario completed without exception', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  let cleanup = 'not attempted'
  try {
    const n = sql(`WITH d AS (DELETE FROM compliance_mgmt.statutory_filings WHERE tenant_id='${tenant}' AND period='${period}' RETURNING 1) SELECT count(*) FROM d`)
    cleanup = `removed ${n} QA filing row(s) with period ${period}`
    console.log(cleanup)
  } catch (e) { cleanup = `cleanup failed (QA filing left behind, period ${period}): ${String(e).split('\n')[0]}`; console.log(cleanup) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-compliance-modals.json', JSON.stringify({ ranAt: new Date().toISOString(), fixture: { filingId, period, reference }, cleanup, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
