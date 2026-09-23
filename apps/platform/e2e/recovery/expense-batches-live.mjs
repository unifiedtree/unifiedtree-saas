import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const stamp = Date.now()
const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
async function login(email) {
  const result = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
  assert.equal(result.status, 200)
  return (await result.json()).accessToken
}
async function request(token, path, method = 'GET', body) {
  const result = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await result.text()
  assert.ok(result.ok, `${method} ${path}: ${result.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')
const title = `Browser reimbursement ${stamp}`
const claim = await request(reader, '/v1/expense/claims', 'POST', { companyId: company, title, currency: 'INR', notes: 'Client meeting travel reimbursement', items: [{ category: 'OTHER', amount: 321, expenseDate: cutoff, description: 'Local travel fare', merchantName: 'Local taxi' }] })
await request(owner, `/v1/expense/claims/${claim.id}/decision`, 'POST', { approved: true, comment: 'Receipts checked in local acceptance' })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], failures = [], probes = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (!response.url().includes('/api/') || response.status() < 400) return
  const entry = `${response.status()} ${response.url()}`
  if (response.url().includes('/canonical-auth/refresh') && response.status() === 422) probes.push(entry)
  else failures.push(entry)
})
mkdirSync('test-results/recovery', { recursive: true })
async function buildBatch() {
  await page.getByRole('button', { name: 'Build batch', exact: true }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Approval cutoff date').fill(cutoff)
  await form.getByLabel('Batch notes').fill(`Local browser run ${stamp}`)
  await form.getByRole('button', { name: 'Build draft batch', exact: true }).click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText(title, { exact: true })).toBeVisible()
  await expect(detail.getByText('Reader User', { exact: true }).first()).toBeVisible()
  return detail
}
async function postBatch(drawer) {
  await drawer.getByRole('button', { name: 'Post batch', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm post batch', exact: true }).click()
  await expect(drawer.getByRole('button', { name: 'Confirm post batch', exact: true })).toBeHidden()
  await expect(drawer.getByText('posted', { exact: true })).toBeVisible()
}
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 })
  await page.goto(base + '/hrms/expenses')
  await page.getByRole('tab', { name: 'Reimbursement batches', exact: true }).click()
  let drawer = await buildBatch()
  const claimCard = drawer.getByText(title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
  await claimCard.getByRole('button', { name: 'View expense items', exact: true }).click()
  await expect(claimCard.getByText('Local travel fare', { exact: true })).toBeVisible()
  await expect(claimCard.getByText('Client meeting travel reimbursement', { exact: true })).toBeVisible()
  await postBatch(drawer)
  await drawer.getByRole('button', { name: 'Cancel batch', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm cancel batch', exact: true }).click()
  await expect(drawer.getByRole('button', { name: 'Confirm cancel batch', exact: true })).toBeHidden()
  await expect(drawer.getByText('cancelled', { exact: true })).toBeVisible()
  assert.equal((await request(owner, `/v1/expense/claims/${claim.id}`)).status, 'APPROVED')
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(drawer).toBeHidden()
  console.log('PASS: build shows claimant, reason and expense lines; posting reserves claims; cancel atomically releases claims')

  drawer = await buildBatch()
  await postBatch(drawer)
  await drawer.getByRole('button', { name: 'Record payment', exact: true }).click()
  await drawer.getByLabel('Payment reference / UTR').fill(`LOCAL-UTR-${stamp}`)
  await drawer.getByLabel('Payment notes').fill('Recorded locally after test payment confirmation')
  await drawer.getByRole('button', { name: 'Confirm payment recorded', exact: true }).click()
  await expect(drawer.getByRole('button', { name: 'Confirm payment recorded', exact: true })).toBeHidden()
  await expect(drawer.getByText('paid', { exact: true })).toBeVisible()
  await expect(drawer.getByText(`LOCAL-UTR-${stamp}`, { exact: false })).toBeVisible()
  assert.equal((await request(owner, `/v1/expense/claims/${claim.id}`)).status, 'REIMBURSED')
  await page.screenshot({ path: 'test-results/recovery/expense-batch-paid-live.png', fullPage: true })
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(drawer).toBeHidden()
  await page.reload()
  await page.getByRole('tab', { name: 'Reimbursement batches', exact: true }).click()
  await expect(page.getByText(`LOCAL-UTR-${stamp}`, { exact: true })).toBeVisible()
  console.log('PASS: rebuild,post,record completed payment with UTR; claim reimbursed and payment visible after reload')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Build batch', exact: true }).click()
  await expect.poll(() => page.getByRole('heading', { name: 'Build reimbursement batch', exact: true }).evaluate(element => element.getBoundingClientRect().left)).toBeLessThan(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/recovery/expense-batch-mobile-live.png', fullPage: true })
  expect(errors).toEqual([])
  expect(failures).toEqual([])
  console.log(`PASS: mobile batch form fits; no browser/feature API errors; ${probes.length} expected signed-out refresh probes recorded`)
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-6000), failures)
  await page.screenshot({ path: 'test-results/recovery/expense-batch-failure.png', fullPage: true })
  throw error
} finally { await browser.close() }
