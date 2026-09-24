import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

// Creates one disposable employee without an account, invitation or email.
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const stamp = Date.now()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
function day(offset) {
  const value = new Date(today + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}
async function login(email) {
  const res = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  assert.equal(res.status, 200, `Login ${email}`)
  return (await res.json()).accessToken
}
async function request(token, path, method = 'GET', body, expected = 200) {
  const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  assert.equal(res.status, expected, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : null
}
const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')
const baseline = await request(owner, '/v1/hrms/employees/11111111-1111-1111-1111-111111111111')
assert.ok(Object.hasOwn(baseline, 'noticeStartDate'), 'Runtime must contain the separation response fields before creating a fixture')
const employee = await request(owner, '/v1/hrms/employees', 'POST', {
  companyId: company, firstName: 'Local Exit QA', lastName: String(stamp),
  email: `exit-${stamp}@example.invalid`, employmentType: 'FULL_TIME', dateOfJoining: day(-90),
}, 201)
assert.equal(employee.hasAccount, false)
const path = `/v1/hrms/employees/${employee.id}`
const read = () => request(owner, path)
await request(owner, path + `/confirm?confirmationDate=${day(-45)}`, 'POST')
assert.equal((await read()).employmentStatus, 'ACTIVE')
await request(reader, path, 'PUT', { exitReason: 'Unauthorized correction' }, 403)
const reason = `Local notice ${stamp}`
const startNotice = () => request(owner, path + '/notice?' + new URLSearchParams({ noticeStart: day(-30), lastWorkingDay: day(5), reason }), 'POST')
await startNotice()
let saved = await read()
assert.equal(saved.employmentStatus, 'NOTICE_PERIOD')
assert.equal(saved.noticeStartDate, day(-30))
assert.equal(saved.lastWorkingDay, day(5))
assert.equal(saved.exitReason, reason)
await request(owner, path, 'PUT', { exitReason: 'Local initial notice correction' })
assert.equal((await read()).employmentStatus, 'NOTICE_PERIOD')
await request(owner, path + '/cancel-notice', 'POST')
saved = await read()
assert.equal(saved.employmentStatus, 'ACTIVE')
assert.equal(saved.noticeStartDate, null)
assert.equal(saved.lastWorkingDay, null)
assert.ok(!saved.exitReason)
await startNotice()
console.log('PASS: notice dates/reason persist, reader cannot edit, cancelling notice clears details')

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
  await page.goto(ui + `/hrms/employees/${employee.id}?tab=exit`)
  await expect(page.getByText(reason, { exact: true })).toBeVisible()
  const corrected = `Local notice corrected in UI ${stamp}`
  await page.getByRole('button', { name: 'Edit separation details', exact: true }).click()
  await expect(page.getByLabel('Notice start date', { exact: true })).toHaveValue(day(-30))
  await page.getByLabel('Notice start date', { exact: true }).fill(day(-20))
  await page.getByLabel('Last working day', { exact: true }).fill(today)
  await page.getByLabel('Separation reason', { exact: true }).fill(corrected)
  let response = page.waitForResponse(res => res.url().endsWith(path) && res.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save separation details', exact: true }).click()
  assert.equal((await response).status(), 200)
  await expect(page.getByText(corrected, { exact: true })).toBeVisible()
  saved = await read()
  assert.equal(saved.noticeStartDate, day(-20))
  assert.equal(saved.lastWorkingDay, today)
  assert.equal(saved.exitReason, corrected)
  assert.equal(saved.employmentStatus, 'NOTICE_PERIOD')

  // The redesigned workspace keeps lifecycle actions in its Actions menu (docs/Designs, Employee Workspace).
  await page.getByRole('button', { name: /^Actions/ }).click()
  await page.getByRole('menuitem', { name: 'Mark exited', exact: true }).click()
  const exitModal = page.getByRole('dialog').filter({ has: page.getByText('Mark Employee as Exited', { exact: true }) })
  await expect(exitModal.locator('input[type=date]')).toHaveValue(today)
  await expect(exitModal.getByPlaceholder('Optional', { exact: true })).toHaveValue(corrected)
  response = page.waitForResponse(res => res.url().includes(path + '/exit?') && res.request().method() === 'POST')
  await exitModal.getByRole('button', { name: 'Mark exited', exact: true }).click()
  assert.equal((await response).status(), 200)
  await expect(page.getByText('Mark Employee as Exited', { exact: true })).toHaveCount(0)
  saved = await read()
  assert.equal(saved.employmentStatus, 'EXITED')
  assert.equal(saved.noticeStartDate, day(-20))
  assert.equal(saved.exitReason, corrected)

  for (const status of ['EXITED', 'TERMINATED']) {
    if (status === 'TERMINATED') await request(owner, path, 'PUT', { employmentStatus: status })
    await page.reload()
    await page.getByRole('button', { name: 'Edit separation details', exact: true }).click()
    const finalReason = `Local ${status.toLowerCase()} correction ${stamp}`
    await page.getByLabel('Separation reason', { exact: true }).fill(finalReason)
    response = page.waitForResponse(res => res.url().endsWith(path) && res.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save separation details', exact: true }).click()
    assert.equal((await response).status(), 200)
    await expect(page.getByText(finalReason, { exact: true })).toBeVisible()
    saved = await read()
    assert.equal(saved.employmentStatus, status)
    assert.equal(saved.exitReason, finalReason)
    assert.equal(saved.noticeStartDate, day(-20))
    assert.equal(saved.lastWorkingDay, today)
    await page.reload()
    await expect(page.getByText(finalReason, { exact: true })).toBeVisible()
  }
  const directory = await request(owner, '/v1/hrms/employees?' + new URLSearchParams({ companyId: company, status: 'TERMINATED', search: String(stamp), pageSize: '10' }))
  const listed = directory.content.find(row => row.id === employee.id)
  assert.ok(listed, 'Separated employee remains available to the filtered directory')
  assert.ok(!Object.hasOwn(listed, 'exitReason'), 'Separation reasons are detail-only')
  await expect(page.getByRole('link', { name: 'Open full & final settlements', exact: true })).toHaveAttribute('href', '/hrms/fnf')
  await page.screenshot({ path: 'test-results/recovery/employee-exit-live.png', fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync('test-results/recovery/live-employee-exit.json', JSON.stringify({ passed: true, employeeId: employee.id, employeeName: `${employee.firstName} ${employee.lastName}`, finalStatus: saved.employmentStatus, noticeStartDate: saved.noticeStartDate, lastWorkingDay: saved.lastWorkingDay, reason: saved.exitReason, directoryReasonOmitted: true, consoleErrors: errors }, null, 2))
  console.log('PASS: browser notice correction, prefilled exit, persisted exited/terminated corrections and directory privacy')
} catch (error) {
  await page.screenshot({ path: 'test-results/recovery/employee-exit-failure.png', fullPage: true })
  writeFileSync('test-results/recovery/live-employee-exit.json', JSON.stringify({ passed: false, employeeId: employee.id, error: error.message, consoleErrors: errors }, null, 2))
  throw error
} finally { await browser.close() }
