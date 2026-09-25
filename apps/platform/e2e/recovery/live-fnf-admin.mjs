import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const stamp = Date.now()
const exitDate = '2026-09-22'
async function login(email) {
  const response = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  assert.equal(response.status, 200)
  return (await response.json()).accessToken
}
const owner = await login('owner@unifiedtree.demo')
async function request(path, method = 'GET', body, token = owner, expected) {
  const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  if (expected) assert.equal(response.status, expected, `${method} ${path}: ${text}`)
  else assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const employee = await request('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'Local FnF', lastName: `QA ${stamp}`, dateOfJoining: '2026-01-01' })
await request(`/v1/hrms/employees/${employee.id}/exit?lastWorkingDay=${exitDate}&reason=Local%20settlement%20verification`, 'POST')
const payload = { employeeId: employee.id, companyId: company, lastWorkingDay: exitDate, notes: `Final handover ${stamp}`, components: [{ label: 'Final salary', type: 'EARNING', amount: 1000 }] }
await request('/v1/fnf/settlements', 'POST', { ...payload, companyId: randomUUID() }, owner, 422)
await request('/v1/fnf/settlements', 'POST', { ...payload, lastWorkingDay: '2026-09-23' }, owner, 422)
const first = await request('/v1/fnf/settlements', 'POST', payload)
await request('/v1/fnf/settlements', 'POST', payload, owner, 422)
assert.equal(first.employeeId, employee.id)
assert.equal(first.components[0].label, 'Final salary')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
mkdirSync('test-results/recovery', { recursive: true })
let paymentRole, readerUser
async function browserLogin(targetPage, email) {
  await targetPage.goto(ui + '/login')
  await targetPage.locator('input[type=email]').fill(email)
  await targetPage.locator('input[type=password]').fill(password)
  await targetPage.locator('button[type=submit]').click()
  await targetPage.waitForURL(url => !url.pathname.includes('login'))
}
try {
  await browserLogin(page, 'owner@unifiedtree.demo')
  await page.goto(ui + '/hrms/fnf')
  const name = `${employee.firstName} ${employee.lastName}`
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Review settlement', exact: true }).click()
  let drawer = page.getByRole('dialog', { name: 'Settlement details' })
  await expect(drawer.getByText('Final salary', { exact: true })).toBeVisible()
  await expect(drawer.getByText(`Final handover ${stamp}`, { exact: false })).toBeVisible()
  await drawer.getByRole('button', { name: 'Cancel settlement', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
  await expect(drawer.getByText('cancelled', { exact: true })).toBeVisible()
  assert.equal((await request(`/v1/fnf/settlements/${first.id}`)).status, 'CANCELLED')
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.locator('[aria-label="Settlement views"]').getByRole('button', { name: /^Create settlement/ }).click()
  await page.getByLabel('Find employee', { exact: true }).fill(employee.employeeCode)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByLabel('Component 1 label', { exact: true }).fill('Final salary')
  await page.getByLabel('Component 1 amount', { exact: true }).fill('1000')
  await page.getByRole('button', { name: 'Add deduction', exact: true }).click()
  await page.getByLabel('Component 2 label', { exact: true }).fill('Asset recovery')
  await page.getByRole('button', { name: 'Review settlement', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Complete every component')
  await expect(page.getByRole('button', { name: 'Confirm process settlement', exact: true })).toHaveCount(0)
  await page.getByLabel('Component 2 amount', { exact: true }).fill('10')
  await page.getByLabel('Settlement notes', { exact: true }).fill(`Corrected final handover ${stamp}`)
  await page.getByRole('button', { name: 'Review settlement', exact: true }).click()
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/v1/fnf/settlements') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Confirm process settlement', exact: true }).click()
  const response = await createdResponse
  assert.equal(response.status(), 201)
  const corrected = await response.json()
  assert.equal(corrected.components.length, 2)
  assert.equal(corrected.netSettlement, 990)
  drawer = page.getByRole('dialog', { name: 'Settlement details' })
  await expect(drawer.getByText('Asset recovery', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Approve settlement', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirm approval', exact: true }).click()
  await expect(drawer.getByText('approved', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled()
  await expect(drawer.getByText('Another authorized colleague must record payment because you approved this settlement.', { exact: true })).toBeVisible()
  await request(`/v1/fnf/settlements/${corrected.id}/pay`, 'POST', undefined, owner, 403)
  await request(`/v1/fnf/settlements/${corrected.id}/cancel`, 'POST', undefined, owner, 422)
  await page.screenshot({ path: 'test-results/recovery/fnf-approved-live.png', fullPage: true })
  console.log('PASS: duplicate/company/exit guards; detail components; cancel/correct; incomplete-row rejection; approval persists and approver cannot pay')

  readerUser = (await request('/v1/workspace/users')).find(user => user.email === 'reader@unifiedtree.demo')
  assert.ok(readerUser)
  paymentRole = await request('/v1/rbac/roles', 'POST', { code: `QA_FNF_PAY_${stamp}`, displayName: 'Local FnF payment verification', description: 'Temporary least-privilege payment role; removed after test' })
  await request(`/v1/rbac/roles/${paymentRole.id}/permissions`, 'PUT', ['hrms.fnf.read', 'hrms.fnf.pay'])
  await request(`/v1/rbac/users/${readerUser.userId}/roles/${paymentRole.id}`, 'POST')
  const payer = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  payer.on('pageerror', error => errors.push(error.message))
  await browserLogin(payer, 'reader@unifiedtree.demo')
  await payer.goto(ui + '/hrms/fnf')
  await payer.getByRole('row').filter({ hasText: name }).filter({ hasText: 'approved' }).getByRole('button', { name: 'Review settlement', exact: true }).click()
  const payerDrawer = payer.getByRole('dialog', { name: 'Settlement details' })
  await payerDrawer.getByRole('button', { name: 'Record payment', exact: true }).click()
  await payerDrawer.getByRole('button', { name: 'Confirm payment recorded', exact: true }).click()
  await expect(payerDrawer.getByText('paid', { exact: true })).toBeVisible()
  const paid = await request(`/v1/fnf/settlements/${corrected.id}`)
  assert.equal(paid.status, 'PAID')
  assert.ok(paid.paidAt)
  await payer.setViewportSize({ width: 390, height: 844 })
  assert.ok(await payer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await payer.screenshot({ path: 'test-results/recovery/fnf-paid-mobile-live.png', fullPage: true })
  console.log('PASS: separate authorized colleague records completed payment; paid state and two financial components persist; mobile drawer fits')

  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
  const listRoute = '**/v1/fnf/settlements?*'
  await page.route(listRoute, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Local verification: settlement list unavailable' }) }))
  // The "All" view, so the paid settlement is listed once the outage clears.
  await page.goto(ui + '/hrms/fnf?tab=all')
  await expect(page.getByRole('alert')).toContainText('Local verification: settlement list unavailable', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  await expect(page.getByText('No settlements yet.', { exact: false })).toHaveCount(0)
  await page.unroute(listRoute)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: name }).filter({ hasText: 'paid' })).toBeVisible()
  assert.deepEqual(errors, [])
  writeFileSync('test-results/recovery/fnf-admin-live.json', JSON.stringify({ employeeId: employee.id, cancelledSettlementId: first.id, paidSettlementId: paid.id, netSettlement: paid.netSettlement, componentCount: paid.components.length, paidAt: paid.paidAt, separatePayer: readerUser.userId, browserErrors: errors }, null, 2))
  console.log('PASS: unavailable settlement list shows retry, recovers successfully, and no browser exceptions')
} catch (error) {
  await page.screenshot({ path: 'test-results/recovery/fnf-admin-failure.png', fullPage: true })
  console.error((await page.locator('body').innerText()).slice(-5000))
  throw error
} finally {
  await browser.close()
  if (paymentRole && readerUser) await request(`/v1/rbac/users/${readerUser.userId}/roles/${paymentRole.id}`, 'DELETE')
  if (paymentRole) await request(`/v1/rbac/roles/${paymentRole.id}`, 'DELETE')
}
