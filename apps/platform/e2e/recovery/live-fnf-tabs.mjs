// Full & Final lifecycle tabs + the Exit page hand-off — browser acceptance
// against the local recovery runtime. Checks that /hrms/fnf splits the ledger
// into Pending approval / Pending payment / Settled / All with counts that match
// GET /v1/fnf/settlements, that ?tab=create&employeeId= preselects a leaver, and
// that the Exit page's F&F button on an exited row lands there. A throw-away
// employee is created, put on notice and exited through the real API, then a
// settlement is processed for them from the page; both are deleted afterwards.
//
// Run from apps/platform:  node e2e/recovery/live-fnf-tabs.mjs
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
const today = iso(new Date(Date.now() + 5.5 * 3600_000))

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const owner = await login('owner@unifiedtree.demo')
const call = async (path, init = {}) => {
  const r = await fetch(`${api}${path}`, { headers: owner, ...init })
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
const ledger = () => call('/v1/fnf/settlements?page=0&size=20')
const countBy = (rows) => ({ PROCESSED: 0, APPROVED: 0, PAID: 0, ...Object.fromEntries(['PROCESSED', 'APPROVED', 'PAID'].map((s) => [s, rows.filter((r) => r.status === s).length])) })

// Fixture leaver: create → notice → exit, so the picker has a separated employee to preselect.
const suffix = randomUUID().slice(0, 6)
const fixtureName = `Qa Fnf${suffix}`
const fixture = await call('/v1/hrms/employees', { method: 'POST', body: JSON.stringify({ companyId: company, firstName: 'Qa', lastName: `Fnf${suffix}`, email: `qa.fnf.${suffix}@unifiedtree.demo` }) })
let settlementId = ''
console.log('fixture employee', fixture.id, fixture.employeeCode)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], failedApi = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
// The design's view tabs are toggle buttons in a labelled group (aria-pressed), not ARIA tabs.
const view = (name, group = 'Settlement views') => page.locator(`[aria-label="${group}"]`).getByRole('button', { name: new RegExp('^' + name) })
// A zero count shows no badge in the design, so read it as 0.
const tabBadge = async (name) => (await view(name).first().innerText()).replace(name, '').trim() || '0'
const tableRows = () => page.locator('table tbody tr')
try {
  await call(`/v1/hrms/employees/${fixture.id}/notice?${new URLSearchParams({ noticeStart: today, lastWorkingDay: today })}`, { method: 'POST' })
  const exited = await call(`/v1/hrms/employees/${fixture.id}/exit?${new URLSearchParams({ lastWorkingDay: today, reason: 'QA automation — F&F tabs' })}`, { method: 'POST' })
  check('fixture employee is EXITED with a last working day', exited.employmentStatus === 'EXITED' && exited.lastWorkingDay === today, `${exited.employmentStatus} ${exited.lastWorkingDay}`)

  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Every sign-in currently produces two 401→refresh(422) round trips; measure the page, not the login.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0

  // 1. Lifecycle tabs and their counts against the API list.
  const before = await ledger()
  const beforeCounts = countBy(before.content)
  await page.goto(base + '/hrms/fnf')
  await page.getByRole('heading', { name: 'Full & final settlements' }).waitFor({ timeout: 30_000 })
  for (const name of ['Pending approval', 'Pending payment', 'Settled', 'All', 'Create settlement']) check(`tab "${name}" renders`, (await view(name).count()) === 1)
  check('default tab is Pending approval', (await view('Pending approval').getAttribute('aria-pressed')) === 'true')
  await page.locator('table').first().waitFor({ timeout: 15_000 })
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => {})
  if (before.totalPages <= 1) {
    check('Pending approval badge = PROCESSED count', (await tabBadge('Pending approval')) === String(beforeCounts.PROCESSED), `${await tabBadge('Pending approval')} vs ${beforeCounts.PROCESSED}`)
    check('Pending payment badge = APPROVED count', (await tabBadge('Pending payment')) === String(beforeCounts.APPROVED), `${await tabBadge('Pending payment')} vs ${beforeCounts.APPROVED}`)
    check('Settled badge = PAID count', (await tabBadge('Settled')) === String(beforeCounts.PAID), `${await tabBadge('Settled')} vs ${beforeCounts.PAID}`)
    check('All badge = server total', (await tabBadge('All')) === String(before.totalElements), `${await tabBadge('All')} vs ${before.totalElements}`)
  } else {
    check('multi-page ledger hides page-only badges', (await tabBadge('Settled')) === '', 'ledger spans several pages')
  }
  await view('Settled').click()
  await page.waitForURL((u) => u.searchParams.get('tab') === 'settled')
  const settledRows = beforeCounts.PAID ? await tableRows().count() : 0
  check('Settled tab lists only PAID settlements', beforeCounts.PAID ? settledRows === beforeCounts.PAID && (await tableRows().filter({ hasText: /processed|approved|cancelled/ }).count()) === 0 : (await page.getByText('No settlements have been paid yet').count()) > 0, `${settledRows} rows vs ${beforeCounts.PAID}`)
  await view('All').click()
  await page.waitForURL((u) => u.searchParams.get('tab') === 'all')
  check('All tab lists every row of the page', (await tableRows().count()) === before.content.length, `${await tableRows().count()} vs ${before.content.length}`)
  await view('Pending payment').click()
  check('Pending payment tab shows APPROVED rows or its empty state', beforeCounts.APPROVED ? (await tableRows().count()) === beforeCounts.APPROVED : (await page.getByText('No approved settlements are waiting for payment').count()) > 0)

  // 2. Exit page hand-off: the exited row's F&F button deep-links into Create settlement.
  await page.goto(base + '/hrms/exit')
  await page.getByRole('heading', { name: 'Resignation & exit' }).waitFor({ timeout: 30_000 })
  await view('Exited', 'Exit views').click()
  await page.getByPlaceholder('Search name, code, email…').fill(fixtureName)
  const exitRow = page.getByRole('row').filter({ hasText: fixtureName })
  await exitRow.waitFor({ timeout: 15_000 })
  const href = await exitRow.getByRole('link').filter({ hasText: 'F&F' }).getAttribute('href')
  check('Exited row F&F links to the create tab for that employee', href === `/hrms/fnf?tab=create&employeeId=${fixture.id}`, href)
  const notice = await call('/v1/hrms/employees?status=NOTICE_PERIOD&page=0&size=1')
  await exitRow.getByRole('link').filter({ hasText: 'F&F' }).click()
  await page.waitForURL((u) => u.pathname === '/hrms/fnf' && u.searchParams.get('employeeId') === fixture.id)
  check('Create settlement tab is selected from the link', (await view('Create settlement').getAttribute('aria-pressed')) === 'true')
  const banner = page.getByText(`Selected: ${fixtureName} (${fixture.employeeCode})`)
  await banner.waitFor({ timeout: 15_000 })
  check('linked leaver is preselected', true, `${fixtureName} (${fixture.employeeCode})`)
  check('picker narrowed to the leaver\'s status and code', (await page.getByLabel('Exit status').inputValue()) === 'EXITED' && (await page.getByLabel('Find employee').inputValue()) === fixture.employeeCode)
  await page.locator('button[aria-pressed="true"]').filter({ hasText: fixture.employeeCode }).first().waitFor({ timeout: 15_000 }).catch(() => {})
  check('preselected row is pressed in the picker', (await page.locator('button[aria-pressed="true"]').filter({ hasText: fixture.employeeCode }).count()) === 1)

  // 3. Process a settlement for the preselected leaver; it must land under Pending approval.
  await page.getByLabel('Component 1 label').fill('Salary dues')
  await page.getByLabel('Component 1 amount').fill('1500')
  await page.getByRole('button', { name: 'Review settlement' }).click()
  await page.getByRole('button', { name: 'Confirm process settlement' }).click()
  await page.getByText('Settlement processed and ready for approval').waitFor({ timeout: 15_000 })
  await page.waitForURL((u) => u.searchParams.get('tab') === 'pending-approval' && !u.searchParams.has('employeeId'))
  const after = await ledger()
  settlementId = after.content.find((r) => r.employeeId === fixture.id && r.status === 'PROCESSED')?.id || ''
  check('API has the new PROCESSED settlement', Boolean(settlementId), settlementId)
  // Processing jumps to Pending approval and opens the new settlement's drawer.
  await page.getByRole('dialog').getByText('Settlement details').waitFor({ timeout: 15_000 })
  check('new settlement drawer opens after processing', true)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 })
  await page.getByRole('row').filter({ hasText: fixtureName }).waitFor({ timeout: 15_000 })
  check('new settlement is listed under Pending approval', true)
  if (after.totalPages <= 1) check('Pending approval badge follows the API', (await tabBadge('Pending approval')) === String(countBy(after.content).PROCESSED), `${await tabBadge('Pending approval')} vs ${countBy(after.content).PROCESSED}`)
  await view('Settled').click()
  check('new settlement is not listed under Settled', (await page.getByRole('row').filter({ hasText: fixtureName }).count()) === 0)

  // 4. A non-separated employee id is refused with an explanation, not preselected.
  if (notice.content[0]) {
    const onNotice = notice.content[0]
    await page.goto(`${base}/hrms/fnf?tab=create&employeeId=${onNotice.id}`)
    await page.getByText('is not marked as exited or terminated yet').waitFor({ timeout: 15_000 })
    check('on-notice employee is not preselected', (await page.getByText(/^Selected:/).count()) === 0, onNotice.employeeCode)
  }

  mkdirSync('test-results/recovery', { recursive: true })
  await page.goto(base + '/hrms/fnf?tab=pending-approval')
  await page.getByRole('row').filter({ hasText: fixtureName }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: 'test-results/recovery/fnf-tabs-live.png', fullPage: true })
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls from the page', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
} catch (e) {
  check('scenario completed', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  try {
    sql(`DELETE FROM fnf_mgmt.fnf_settlements WHERE employee_id='${fixture.id}' AND tenant_id='${tenant}'`)
    sql(`DELETE FROM hrms.employees WHERE id='${fixture.id}' AND tenant_id='${tenant}'`)
    console.log('fixtures removed')
  } catch (e) { console.log('fixture cleanup failed (left as QA record):', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-fnf-tabs.json', JSON.stringify({ ranAt: new Date().toISOString(), fixture: fixture.id, settlementId, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
