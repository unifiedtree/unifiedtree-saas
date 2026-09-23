import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
async function login(email) {
  const res = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  assert.equal(res.status, 200)
  return (await res.json()).accessToken
}
async function request(token, path, method = 'GET', body, expected = 200) {
  const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  assert.equal(res.status, expected, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : null
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')
const manager = await login('mgr@unifiedtree.demo')
async function disbursedAdvance(amount) {
  const advance = await request(reader, '/v1/advance/requests', 'POST', { amount, repaymentMonths: 3, reason: `Local advance recovery verification ${Date.now()}` }, 201)
  await request(owner, `/v1/advance/requests/${advance.id}/decision`, 'POST', { approved: true })
  await request(owner, `/v1/advance/requests/${advance.id}/disburse`, 'POST')
  return advance
}
const advance = await disbursedAdvance(1000)
const list = await request(owner, '/v1/advance/requests?status=DISBURSED&size=100')
assert.ok(list.content.some(row => row.id === advance.id && row.employeeName === 'Reader User'))
await request(reader, '/v1/advance/requests', 'GET', undefined, 403)
assert.ok(!(await request(manager, '/v1/advance/requests?size=100')).content.some(row => row.id === advance.id))
await request(manager, `/v1/advance/requests/${advance.id}`, 'GET', undefined, 403)
for (const part of ['schedule', 'ledger', 'summary']) await request(manager, `/v1/advance/${advance.id}/${part}`, 'GET', undefined, 403)
await request(manager, `/v1/advance/${advance.id}/skip-month`, 'POST', { installmentNo: 1, reason: 'Unrelated manager must be denied' }, 403)
const schedule = await request(owner, `/v1/advance/${advance.id}/schedule`)
assert.equal(schedule.reduce((sum, row) => sum + Math.round(Number(row.scheduledAmount) * 100), 0), 100000)
assert.equal(Number(schedule[2].scheduledAmount), 333.34)
await request(owner, `/v1/advance/${advance.id}/foreclose`, 'POST', { lumpSumAmount: 999, reason: 'Partial amount must fail' }, 422)
assert.equal(Number((await request(owner, `/v1/advance/${advance.id}/summary`)).outstandingAmount), 1000)
await request(owner, `/v1/advance/${advance.id}/skip-month`, 'POST', { installmentNo: 3, reason: 'Local final-installment deferral' })
const deferred = await request(owner, `/v1/advance/${advance.id}/schedule`)
assert.equal(Number(deferred[3].scheduledAmount), 333.34)
assert.equal(deferred.filter(row => row.status === 'PENDING').reduce((sum, row) => sum + Math.round(Number(row.scheduledAmount) * 100), 0), 100000)
assert.ok((await request(owner, `/v1/advance/${advance.id}/ledger`)).some(row => row.entryType === 'SKIP_MONTH' && row.notes === 'Local final-installment deferral'))
await request(owner, `/v1/advance/${advance.id}/foreclose`, 'POST', { lumpSumAmount: 1000, reason: 'Local full-settlement verification' })
const closed = await request(owner, `/v1/advance/requests/${advance.id}`)
assert.equal(closed.status, 'CLOSED')
assert.equal(Number(closed.outstandingAmount), 0)
assert.ok((await request(owner, `/v1/advance/${advance.id}/schedule`)).every(row => row.status !== 'PENDING'))
console.log('PASS: scoped company listing, exact rounding, partial-payment rejection, deferral audit, full settlement closure')
const writtenOff = await disbursedAdvance(30)
await request(owner, `/v1/advance/${writtenOff.id}/write-off`, 'POST', { reason: 'Local write-off verification' })
assert.equal((await request(owner, `/v1/advance/requests/${writtenOff.id}`)).status, 'CLOSED')
assert.ok((await request(owner, `/v1/advance/${writtenOff.id}/ledger`)).some(row => row.entryType === 'WRITE_OFF' && Number(row.balanceAfter) === 0))
console.log('PASS: write-off closes request and records zero balance')

const browserAdvance = await disbursedAdvance(3210.45)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
mkdirSync('test-results/recovery', { recursive: true })
try {
  await page.goto(ui + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'))
  await page.goto(ui + '/hrms/advances')
  await expect(page.getByRole('heading', { name: 'Company advances', exact: true })).toBeVisible()
  await page.getByLabel('Advance status', { exact: true }).selectOption('DISBURSED')
  await page.getByRole('row').filter({ hasText: '3,210.45' }).first().getByRole('button', { name: /View advance/ }).click()
  await expect(page.getByRole('heading', { name: 'Salary recovery' })).toBeVisible()
  await page.getByRole('button', { name: 'Defer month', exact: true }).first().click()
  await page.getByLabel('Reason / payment reference').fill('Deferred through the admin screen')
  await page.getByRole('button', { name: 'Review and confirm', exact: true }).click()
  const saved = page.waitForResponse(r => r.url().endsWith(`/v1/advance/${browserAdvance.id}/skip-month`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Defer installment', exact: true }).click()
  assert.equal((await saved).status(), 200)
  await expect(page.locator('ol').getByText('Deferred through the admin screen', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/recovery/advance-recovery-live.png', fullPage: true })
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.screenshot({ path: 'test-results/recovery/company-advances-live.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: real company-admin advance list, employee details, recovery ledger and deferral UI')
} finally { await browser.close() }
