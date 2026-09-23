import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const readerEmployee = '22222222-2222-2222-2222-222222222222'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }
const login = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }) })
assert.equal(login.status, 200)
headers.Authorization = `Bearer ${(await login.json()).accessToken}`
async function request(path, method = 'GET', body) {
  const response = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}
mkdirSync('test-results/recovery', { recursive: true })
const directory = await request('/v1/hrms/employees?pageSize=200')
const hire = directory.content.find(employee => `${employee.firstName} ${employee.lastName}` === 'Local Onboarding QA')
assert.ok(hire, 'Run the local onboarding workflow first; its employee supplies the salary and encrypted bank fixture')
assert.ok((await request(`/v1/employees/${hire.id}/profile/bank-accounts`)).some(account => account.primary))
assert.ok(await request(`/v1/payroll/structures/employee/${hire.id}`))
// A paid employee intentionally has no bank account until the correction step.
// Repeat runs create their own local employee, without sending an invitation.
let exclusionEmployee = { id: readerEmployee, name: 'Reader User' }
if ((await request(`/v1/employees/${readerEmployee}/profile/bank-accounts`)).some(account => account.primary)) {
  const created = await request('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'Local Payroll', lastName: `Exclusion QA ${Date.now()}`, dateOfJoining: '2026-09-01' })
  exclusionEmployee = { id: created.id, name: `${created.firstName} ${created.lastName}` }
}
if (!await request(`/v1/payroll/structures/employee/${exclusionEmployee.id}`)) {
  await request('/v1/payroll/structures', 'POST', { employeeId: exclusionEmployee.id, ctcAnnual: 360000, effectiveFrom: '2026-09-01', pfApplicable: false, taxRegime: 'NEW', revisionNote: 'Local recovery payroll verification' })
}
const existing = await request(`/v1/payroll/runs?companyId=${company}`)
const periods = [{ year: 2026, month: 9 }, ...Array.from({ length: 12 }, (_, i) => ({ year: 2027, month: i + 1 }))]
const period = periods.find(p => !existing.some(run => run.periodYear === p.year && run.periodMonth === p.month))
assert.ok(period, 'No unused local recovery payroll period')
const run = await request('/v1/payroll/runs', 'POST', { companyId: company, periodYear: period.year, periodMonth: period.month })
let processed = await request(`/v1/payroll/runs/${run.id}/process`, 'POST')
assert.equal(processed.status, 'PROCESSING')
assert.ok(processed.employeeCount >= 2)
assert.ok(processed.totalNet > 0)
await request(`/v1/payroll/runs/${run.id}/lock`, 'POST')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
let customRole
try {
  await page.goto(ui + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'))
  await page.goto(ui + `/hrms/payroll/runs/${run.id}`)
  await page.getByRole('button', { name: 'Reopen for corrections', exact: true }).click()
  await page.getByLabel('Reason for reopening').fill('Local verification: authorized payroll correction')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Process', exact: true })).toBeVisible()
  assert.equal((await request(`/v1/payroll/runs/${run.id}`)).status, 'DRAFT')
  console.log('PASS: payroll process/lock and browser reopen persist through real APIs')
  processed = await request(`/v1/payroll/runs/${run.id}/process`, 'POST')
  await request(`/v1/payroll/runs/${run.id}/lock`, 'POST')
  const pdf = await fetch(api + `/v1/payroll/runs/${run.id}/employees/${hire.id}/payslip.pdf`, { headers })
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  const bank = await request('/v1/payroll/bank-profiles', 'POST', { companyId: company, profileName: `Local payroll QA ${Date.now()}`, bankFormat: 'GENERIC_CSV', debitAccountNo: '123456789012', ifsc: 'HDFC0001234' })
  let detail = await request('/v1/payroll/disbursement/batches', 'POST', { runId: run.id, bankProfileId: bank.id })
  assert.equal(detail.lines.find(line => line.employeeId === hire.id)?.status, 'READY')
  assert.equal(detail.lines.find(line => line.employeeId === exclusionEmployee.id)?.status, 'SKIPPED_MISSING_DETAILS')
  assert.equal(detail.batch.totalAmount, detail.lines.reduce((sum, line) => sum + line.amount, 0))
  assert.ok(detail.batch.totalAmount < processed.totalNet)
  await page.goto(ui + '/hrms/bank-disbursement')
  await page.locator('select').filter({ has: page.locator(`option[value="${run.id}"]`) }).selectOption(run.id)
  await expect(page.getByRole('cell', { name: 'Skipped', exact: true })).toBeVisible()
  await expect(page.getByText('No primary bank account on file', { exact: true })).toBeVisible()
  const excludedRow = page.getByRole('row').filter({ hasText: exclusionEmployee.name }).last()
  await expect(excludedRow).toContainText('Skipped')
  await expect(page.getByRole('button', { name: 'Download bank file (posts batch)', exact: true })).toBeDisabled()
  await excludedRow.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/recovery/payroll-batch-exclusions-live.png', fullPage: true })
  const blocked = await fetch(api + `/v1/payroll/disbursement/batches/${detail.batch.id}/file`, { headers })
  assert.equal(blocked.status, 422)
  assert.ok((await blocked.text()).includes('BATCH_HAS_EXCLUDED_EMPLOYEES'))
  assert.equal((await request(`/v1/payroll/disbursement/batches/${detail.batch.id}`)).batch.status, 'DRAFT')
  assert.equal((await request(`/v1/payroll/runs/${run.id}`)).status, 'LOCKED')
  await request(`/v1/employees/${exclusionEmployee.id}/profile/bank-accounts`, 'POST', { accountNumber: '999912345678', ifscCode: 'HDFC0001234', bankName: 'Local QA bank', accountHolderName: exclusionEmployee.name, primary: true })
  await page.getByRole('button', { name: 'Rebuild batch', exact: true }).click()
  await expect(excludedRow).toContainText('Ready')
  detail = await request(`/v1/payroll/disbursement/batches/${detail.batch.id}`)
  assert.ok(detail.lines.every(line => line.status === 'READY'))
  assert.equal(detail.batch.totalAmount, processed.totalNet)
  console.log('PASS: missing-bank employee blocks partial payment; bank correction and browser rebuild include the full payroll')
  const download = await fetch(api + `/v1/payroll/disbursement/batches/${detail.batch.id}/file`, { headers })
  assert.equal(download.status, 200)
  const csv = await download.text()
  assert.ok(csv.startsWith('beneficiary_name,account_number,ifsc,amount,reference'))
  assert.ok(csv.includes('Local Onboarding QA'))
  assert.ok(csv.includes(exclusionEmployee.name))
  await request(`/v1/payroll/disbursement/batches/${detail.batch.id}/mark-paid`, 'POST', { paymentReference: `LOCAL-QA-${Date.now()}` })
  assert.equal((await request(`/v1/payroll/runs/${run.id}`)).status, 'PAID')
  const forbiddenReopen = await fetch(api + `/v1/payroll/runs/${run.id}/reopen`, { method: 'POST', headers, body: JSON.stringify({ reason: 'Must reject paid run' }) })
  assert.equal(forbiddenReopen.status, 422)
  console.log('PASS: named bank exclusions, PDF, bank CSV, recorded payment and paid-run reopen rejection')

  await page.goto(ui + '/roles')
  await page.getByRole('button', { name: /^View permissions for / }).first().click()
  await expect(page.getByText(/System role permissions are fixed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save permissions', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox').first()).toBeDisabled()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  customRole = await request('/v1/rbac/roles', 'POST', { code: `QA_ACCESS_${Date.now()}`, displayName: 'Local access toggle check', description: 'Temporary role with no permissions; removed by verification' })
  await page.goto(ui + '/users')
  await page.getByRole('row').filter({ hasText: 'reader@unifiedtree.demo' }).getByRole('button', { name: 'Manage access' }).click()
  const toggle = page.getByText(customRole.displayName, { exact: true }).locator('..').getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  console.log('PASS: system-role permissions read-only; grant/revoke refresh the open user access drawer')
  const slipRoute = `**/v1/payroll/runs/${run.id}/employees/*/payslip`
  await page.route(slipRoute, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Verification of unavailable payslip state' }) }))
  await page.goto(ui + `/hrms/payroll/runs/${run.id}`)
  await page.getByRole('tab', { name: 'Employees', exact: true }).click()
  await page.getByRole('button', { name: 'Payslip', exact: true }).first().click()
  await expect(page.getByText('Unable to load this payslip. It may no longer be available for this run.', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.unroute(slipRoute)
  console.log('PASS: injected payslip outage shows retry instead of an endless skeleton')
  await page.goto(ui + '/hrms/payroll/runs/00000000-0000-0000-0000-000000000001')
  await expect(page.getByRole('heading', { name: 'Payroll run unavailable' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  writeFileSync('test-results/recovery/payroll-access-live.json', JSON.stringify({ runId: run.id, period, employeeId: hire.id, batchId: detail.batch.id, payrollNet: processed.totalNet, batchTotal: detail.batch.totalAmount, beneficiaryCount: detail.batch.beneficiaryCount, correctedBankEmployee: exclusionEmployee.id, partialPaymentRejected: true, paidStatus: 'PAID', browserErrors: errors }, null, 2))
  console.log('PASS: missing payroll run shows an actionable error; no browser exceptions')
} finally {
  await browser.close()
  if (customRole) await request(`/v1/rbac/roles/${customRole.id}`, 'DELETE')
}
