// Live check of the redesigned employee workspace (/hrms/employees/:id) against
// the local API. A throw-away employee is created through the API, then the
// page's own controls are used: edit (saves), extend probation, confirm, start
// notice, cancel notice and change shift. Every tab renders in the design's
// frame; Leave and Expenses explain why they're empty. The fixture and its
// shift assignment are deleted from the local database at the end.
//
//   node e2e/recovery/live-design-workspace.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const stamp = Date.now() % 1000000
// Dates in India (the app's calendar), not UTC.
const day = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10)

const login = async (email) => (await (await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })).json()).accessToken
const token = await login('owner@unifiedtree.demo')
const created = await (await fetch(`${api}/v1/hrms/employees`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: JSON.stringify({ companyId: company, firstName: 'Workspace QA', lastName: String(stamp), email: `ws-${stamp}@example.invalid`, employmentType: 'FULL_TIME', dateOfJoining: day(-20), roleCode: 'EMPLOYEE' }) })).json()
const id = created.id
sql(`update hrms.employees set probation_end_date='${day(10)}' where id='${id}'`)
const status = () => sql(`select employment_status from hrms.employees where id='${id}'`)

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  const toast = (re) => page.locator('[role=status]').filter({ hasText: re }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  const dialog = () => page.getByRole('dialog')

  await page.goto(`${base}/hrms/employees/${id}`); await settle()
  await page.getByText(`Workspace QA ${stamp}`).first().waitFor({ timeout: 20000 })
  check('header shows the person, code and status', await page.getByText(created.employeeCode, { exact: true }).count() > 0 && await page.getByText('Probation', { exact: true }).count() > 0)
  check('probation banner counts down to the real end date', await page.getByText(/Probation ends in 10 days/).count() > 0)
  check('shell sub-tabs are hidden (the design has only ← Back)', await page.getByRole('navigation', { name: /sections$/ }).count() === 0)

  // ── Edit employee (Basic → Financial → Save) ──
  await page.getByRole('button', { name: 'Edit employee' }).click()
  await dialog().getByPlaceholder('+91 98450 12345').fill('+91 90000 54321')
  await page.getByRole('button', { name: 'Next: Financial →' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  check('edit saves through the API', await toast(/Employee details saved/) && sql(`select phone from hrms.employees where id='${id}'`) === '+91 90000 54321')

  // ── Extend → confirm → notice → cancel ──
  await page.getByRole('button', { name: 'Extend', exact: true }).click()
  await dialog().locator('input[type=date]').fill(day(40))
  await dialog().getByRole('button', { name: 'Extend probation' }).click()
  check('extend probation saves the new end date', await toast(/Probation extended/) && sql(`select probation_end_date from hrms.employees where id='${id}'`) === day(40))
  await settle()
  await page.getByRole('button', { name: 'Confirm as permanent' }).click()
  await dialog().getByRole('button', { name: 'Confirm probation' }).click()
  check('confirm makes the person active', await toast(/confirmed from/) && status() === 'ACTIVE')
  await settle()
  await page.getByRole('button', { name: /Actions/ }).click()
  await page.getByRole('menuitem', { name: 'Start notice' }).click()
  await dialog().getByRole('button', { name: 'Start notice' }).click()
  check('notice needs a last working day', await dialog().getByText('Last working day is required').count() > 0)
  await dialog().locator('input[type=date]').nth(1).fill(day(30))
  await dialog().getByRole('button', { name: 'Start notice' }).click()
  check('start notice records it', await toast(/Notice started/) && status() === 'NOTICE_PERIOD')
  await settle()
  await page.getByRole('button', { name: /Actions/ }).click()
  await page.getByRole('menuitem', { name: 'Cancel notice' }).click()
  await dialog().getByRole('button', { name: 'Cancel notice' }).click()
  check('cancel notice makes the person active again', await toast(/Notice cancelled/) && status() === 'ACTIVE')

  // ── Change shift ──
  await settle()
  await page.getByRole('button', { name: 'Change shift' }).click()
  await page.getByRole('button', { name: 'Save shift' }).click()
  check('change shift assigns a shift', await toast(/moves to/) && Number(sql(`select count(*) from attendance.employee_shift_assignments where employee_id='${id}'`)) > 0)

  // ── Every tab renders in the frame ──
  for (const tab of ['Personal', 'Job', 'Attendance', 'Payroll', 'Leave', 'Expenses', 'Documents', 'Letters', 'Performance', 'Exit', 'Overview']) {
    errors.length = 0
    await page.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await settle()
    const ok = tab === 'Leave' || tab === 'Expenses' ? await page.getByText(/only served for the signed-in person/).count() > 0 : !errors.length
    check(`${tab} tab renders`, ok, errors[0] || '')
  }
  check('no unexpected API errors', !failed.length, failed.slice(0, 3).join(' | '))
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  try {
    sql(`delete from attendance.employee_shift_assignments where employee_id='${id}'`)
    sql(`delete from leave_mgmt.leave_balances where employee_id='${id}'`)
    sql(`delete from hrms.probation_reminder_log where employee_id='${id}'`)
    sql(`delete from hrms.employees where id='${id}'`)
  } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
