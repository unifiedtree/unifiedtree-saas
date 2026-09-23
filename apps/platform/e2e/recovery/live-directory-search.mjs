import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

// One disposable employee; no account, invitation or email is sent.
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const stamp = Date.now()
const res = await fetch(api + '/v1/canonical-auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant },
  body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }),
})
assert.equal(res.status, 200, 'Owner login')
const token = (await res.json()).accessToken
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : null
}
const employee = await request('/v1/hrms/employees', 'POST', {
  companyId: company, firstName: 'Local Directory QA', lastName: `Person ${stamp}`,
  email: `directory-${stamp}@example.invalid`, employmentType: 'FULL_TIME',
}, 201)
assert.equal(employee.hasAccount, false)
const evidence = []
async function finds(query, filters = {}) {
  const page = await request('/v1/hrms/employees?' + new URLSearchParams({ companyId: company, search: query, pageSize: '10', ...filters }))
  assert.ok(page.content.some(row => row.id === employee.id), `Directory finds employee for: ${query}`)
  evidence.push({ query, matchedEmployeeId: employee.id, filters })
}
const name = `${employee.firstName} ${employee.lastName}`
await finds(name)
await finds(`  ${name.toUpperCase().replaceAll(' ', '   ')}  `)
await finds(employee.firstName)
await finds(employee.lastName)
await finds(employee.employeeCode)
await finds(employee.email)
const middle = `MiddleQA${stamp}`
await request(`/v1/hrms/employees/${employee.id}`, 'PUT', { middleName: middle })
await finds(`${employee.firstName} ${middle} ${employee.lastName}`)
await finds(name)
await finds(middle)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
await request(`/v1/hrms/employees/${employee.id}/exit?` + new URLSearchParams({ lastWorkingDay: today, reason: 'Local directory search verification' }), 'POST')
await finds(`${employee.firstName} ${middle} ${employee.lastName}`, { status: 'EXITED' })
for (const filters of [{ status: 'ACTIVE' }, { companyId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }]) {
  const page = await request('/v1/hrms/employees?' + new URLSearchParams({ companyId: company, search: name, pageSize: '10', ...filters }))
  assert.ok(!page.content.some(row => row.id === employee.id), `Directory respects ${JSON.stringify(filters)}`)
}
mkdirSync('test-results/recovery', { recursive: true })
console.log('PASS: full-name, optional middle-name, spacing/case, first/last/email/code directory search; company/status filters preserved')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(ui + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'))
  await page.goto(ui + '/hrms/fnf')
  await page.getByRole('tab', { name: 'Create settlement', exact: true }).click()
  const row = page.getByRole('button').filter({ hasText: employee.employeeCode })
  for (const query of [name, `${employee.firstName} ${middle} ${employee.lastName}`]) {
    const response = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname.endsWith('/v1/hrms/employees') && url.searchParams.get('search') === query
    })
    await page.getByLabel('Find employee', { exact: true }).fill(query)
    const searchResponse = await response
    assert.equal(searchResponse.status(), 200)
    assert.ok((await searchResponse.json()).content.some(item => item.id === employee.id))
    await expect(row).toBeVisible()
  }
  await row.click()
  await expect(page.getByText(`Selected: ${name} (${employee.employeeCode})`, { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/recovery/fnf-full-name-picker-live.png', fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync('test-results/recovery/live-directory-search.json', JSON.stringify({ passed: true, employeeId: employee.id, evidence, companyAndStatusFiltersPreserved: true, settlementPickerSelectedByFullName: true, consoleErrors: errors }, null, 2))
  console.log('PASS: full-name and middle-name searches select the correct leaver in the FnF picker; no settlement created')
} finally { await browser.close() }
