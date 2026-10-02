/* global console, process */
// Live check of the redesigned Payroll module against the local API.
//
//   node e2e/recovery/live-design-payroll.mjs
//
// Owner: every section renders under the module's own section bar; a TEST run
// for Jun 2027 (a month with no advance recoveries due) is created → processed →
// payslip opened → locked → reopened, then deleted from the local database; a
// paid run's register and a payslip PDF download; the planned bank file shows;
// drawers open and close without saving (salary, PLI, advances, settings).
// Reader (employee): keeps the self-service advance and incentive pages.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
  return { page, errors, failed, settle }
}
// The module's section bar: the top bar's "Payroll pages" tabs since Release 1.1 (the page's own copy is hidden).
const bar = (page) => page.getByRole('navigation', { name: 'Payroll pages' })
const dialogButton = (page, name) => page.getByRole('dialog').getByRole('button', { name })

let testRunId = ''
let pliTargetId = ''
try {
  const hr = await signIn('owner@unifiedtree.demo')
  const { page } = hr
  const existing = sql("select id from payroll.runs where period_year = 2027 and period_month = 6")
  if (existing) sql(`delete from payroll.runs where id = '${existing}'`) // leftover of an interrupted run

  // ── every section renders under the module's section bar ──
  for (const [route, heading] of [['/hrms/payroll-dashboard', 'Payroll Dashboard'], ['/hrms/salary-structure', 'Salary Structure'], ['/hrms/payroll/runs', 'Processing & Payslips'], ['/hrms/payroll/settings', 'Payroll Settings'], ['/hrms/pli', 'Production-Linked Incentive (PLI)'], ['/hrms/advances', 'Advances & Loans'], ['/hrms/bank-disbursement', 'Bank Disbursement']]) {
    await page.goto(base + route); await hr.settle()
    const ok = await bar(page).count() === 1 && await page.getByRole('heading', { name: heading, exact: true }).count() > 0
    check(`${route} renders the design with its section bar`, ok)
  }
  check('one section bar on payroll pages (the top bar’s tabs; the page’s own copy hidden)', (await page.getByRole('navigation', { name: 'Payroll pages' }).count()) === 1 && (await page.getByRole('navigation', { name: 'Payroll sections' }).count()) === 0)

  // ── a test run: create → process → payslip → lock → reopen ──
  await page.goto(base + '/hrms/payroll/runs'); await hr.settle()
  await page.getByRole('button', { name: /New run/ }).first().click()
  await page.getByRole('dialog').waitFor()
  const yearSelect = page.getByRole('dialog').locator('button, [role=combobox]').filter({ hasText: /^20\d\d$/ }).first()
  await yearSelect.click(); await page.getByRole('option', { name: '2027' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Jun/ }).click()
  await dialogButton(page, /Create run/).click()
  await page.waitForURL(/\/hrms\/payroll\/runs\/[0-9a-f-]{36}$/, { timeout: 15000 })
  testRunId = page.url().split('/').pop()
  await hr.settle()
  check('new run is created and opens in Draft', await page.getByRole('heading', { name: 'Jun 2027' }).count() > 0 && await page.getByText('Draft', { exact: true }).first().count() > 0, testRunId)

  await page.getByRole('button', { name: /^Process$/ }).first().click()
  await dialogButton(page, 'Process payroll').click()
  await page.getByText(/Payroll processed · \d+ payslips/).first().waitFor({ timeout: 30000 })
  await hr.settle()
  check('processing calculates the run', (sql(`select status from payroll.runs where id='${testRunId}'`)) === 'PROCESSING')
  await page.getByRole('tab', { name: /Employees/ }).first().click().catch(async () => { await page.getByRole('button', { name: /^Employees/ }).first().click() })
  await hr.settle()
  // The HrTable in the redesign kit draws rows as divs with no <tr>/<tbody>.
  // Fall back to a visible rows locator, so the count works for both tables.
  // Scope to the employees table: the run header's crumb button reads
  // "Processing & Payslips" and would otherwise match /Payslip/ first — clicking
  // it goes back to all runs instead of opening the drawer.
  const payslipButtons = page.locator('table').getByRole('button', { name: /^\s*Payslip$/ })
  await payslipButtons.first().waitFor({ timeout: 15000 }).catch(() => {})
  const empRows = Math.max(await page.locator('tbody tr').count(), await payslipButtons.count())
  check('employees tab lists the payslips', empRows > 0, `${empRows} rows`)
  await payslipButtons.first().click()
  // Dialog opens async with the payslip payload; wait up to 20s for either marker.
  await page.locator('[role=dialog]').last().waitFor({ timeout: 20000 }).catch(() => {})
  await page.locator('[role=dialog]').last().getByText(/Preview|Rupees .* only/).first().waitFor({ timeout: 20000 }).catch(() => {})
  const drawerText = (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('payslip drawer shows the real payslip', /Preview/.test(drawerText) && /Rupees .* only/.test(drawerText), drawerText.slice(0, 160))
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  if (await page.locator('[role=dialog]').count()) await page.getByRole('button', { name: 'Close' }).last().click().catch(() => {})

  // Lock became "Lock run" in the redesigned PayrollRunPage (same action).
  await page.getByRole('button', { name: /^Lock( run)?$/ }).first().click()
  await dialogButton(page, 'Lock run').click()
  await page.getByText('Payroll locked · payslips are final').first().waitFor({ timeout: 15000 })
  await hr.settle()
  check('lock makes the run final', sql(`select status from payroll.runs where id='${testRunId}'`) === 'LOCKED')

  await page.getByRole('button', { name: /Reopen for corrections/ }).first().click()
  const confirm = dialogButton(page, 'Reopen payroll')
  check('reopen needs a reason', await confirm.isDisabled())
  await page.getByPlaceholder(/Wrong LOP/).fill('E2E check — reopen the test run')
  await confirm.click()
  await page.getByText('Payroll reopened').first().waitFor({ timeout: 15000 })
  check('reopen puts the run back to draft', sql(`select status from payroll.runs where id='${testRunId}'`) === 'DRAFT')

  // ── paid run: register + payslip PDF ──
  const paid = sql("select id from payroll.runs where status = 'PAID' order by period_year desc, period_month desc limit 1")
  await page.goto(`${base}/hrms/payroll/runs/${paid}`); await hr.settle()
  const [reg] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: /Download payroll register/ }).click()])
  check('paid run downloads the payroll register', !!reg && /salary-register.*\.pdf$/.test(reg.suggestedFilename()), reg ? reg.suggestedFilename() : 'no download')
  await page.getByRole('button', { name: /^Employees/ }).first().click().catch(() => {})
  await page.getByRole('tab', { name: /Employees/ }).first().click().catch(() => {})
  await hr.settle()
  // Same ambiguity as the employees tab above: the run header's crumb reads
  // "Processing & Payslips" and would match /Payslip/ first, navigating away.
  // Scope to the employees table and match the row button's exact name.
  await page.locator('table').getByRole('button', { name: /^\s*Payslip$/ }).first().click()
  await page.getByRole('button', { name: /Download PDF/ }).waitFor({ timeout: 15000 })
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: /Download PDF/ }).click()])
  check('payslip PDF downloads', !!pdf && /\.pdf$/.test(pdf.suggestedFilename()), pdf ? pdf.suggestedFilename() : 'no download')
  await page.keyboard.press('Escape')

  // ── bank: planned file + profiles page ──
  await page.goto(base + '/hrms/bank-disbursement'); await hr.settle()
  const bankText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('bank page shows this run and its file status', /Not prepared|Waiting for lock|File generated|Paid/.test(bankText))
  await page.getByRole('button', { name: /Bank profiles/ }).click()
  await page.waitForURL(/\/hrms\/bank-disbursement\/setup$/, { timeout: 10000 })
  await hr.settle()
  check('Bank profiles opens the setup page', await page.getByText(/Bank profiles/).count() > 0)

  // ── drawers that open and close without saving ──
  await page.goto(base + '/hrms/salary-structure'); await hr.settle()
  await page.getByRole('button', { name: /^ Edit$|Edit/ }).first().click()
  await page.getByText(/Edit salary structure|Add salary structure/).first().waitFor({ timeout: 10000 })
  const prev = (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('salary drawer previews the split from real settings', /Income tax \(TDS\)/.test(prev) && /Not calculated yet/.test(prev))
  await page.getByRole('button', { name: 'Cancel' }).last().click()

  await page.goto(base + '/hrms/payroll/settings'); await hr.settle()
  await page.getByRole('switch', { name: /Apply Provident Fund/ }).click()
  await page.getByText(/1 change · used by runs processed after saving/).first().waitFor({ timeout: 5000 })
  check('settings shows the unsaved-change bar', true)
  await page.getByRole('button', { name: /Discard/ }).first().click()
  await page.waitForTimeout(300)
  check('discard clears the change', (await page.getByText(/change · used by runs/).count()) === 0)

  // The PLI page lists the CURRENT month, and the seed's only target is pinned to an older
  // month, so on any later month the page legitimately shows its empty state and the
  // "Manage awards" link is absent. Seed a disposable target for this month; it is deleted
  // again in the cleanup below.
  pliTargetId = sql(`insert into pli_mgmt.pli_targets (id, tenant_id, company_id, title, owner_type, owner_id, period, metric, target_value, actual_value, weight_percent, payout_amount, status, created_at, updated_at, created_by, updated_by, version) values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'E2E disposable PLI target', 'EMPLOYEE', '22222222-2222-2222-2222-222222222222', to_char(now(), 'YYYY-MM'), 'On-time delivery %', 95.00, 91.00, 40.00, 0.00, 'ACTIVE', now(), now(), '66666666-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', 0) returning id`).split(String.fromCharCode(10))[0].trim()
  await page.goto(base + '/hrms/pli'); await hr.settle()
  await page.getByRole('button', { name: /Manage awards/ }).click()
  await page.getByText('PLI awards').first().waitFor({ timeout: 10000 })
  check('Manage awards opens the awards manager', true)
  await page.keyboard.press('Escape')

  await page.goto(base + '/hrms/advances'); await hr.settle()
  const activeRow = page.locator('tbody tr').filter({ hasText: 'Active deduction' }).first()
  await activeRow.getByRole('button', { name: 'View' }).click()
  await page.getByText('Advance details').first().waitFor({ timeout: 10000 })
  await page.locator('[role=dialog]').last().getByText(/Upcoming|Recovered|Deferred/).first().waitFor({ timeout: 10000 }).catch(() => {})
  const plan = (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('advance drawer shows the real recovery plan', /Upcoming|Recovered|In .* run|Deferred/.test(plan), plan.slice(0, 120))
  await page.getByRole('button', { name: 'Recovery options' }).click()
  await page.waitForTimeout(800)
  check('Recovery options opens the recovery tools', await page.getByText(/Record full repayment|Write off balance|Defer/).count() > 0)

  check('owner: no page errors', hr.errors.length === 0, hr.errors.slice(0, 2).join(' | '))
  const unexpected = hr.failed.filter((f) => !f.includes('/payroll/dashboard/kpis'))
  check('owner: no failed API calls', unexpected.length === 0, unexpected.slice(0, 4).join(' | '))

  // ── employee keeps self-service ──
  const me = await signIn('reader@unifiedtree.demo')
  await me.page.goto(base + '/hrms/advances'); await me.settle()
  // The redesigned self-service tabs read "My advances" / "Request an advance" (sentence case),
  // so the match is case-insensitive now. The check is the same: the employee keeps these pages.
  check('employee sees their own advances page', await me.page.getByText(/My advances|Request an advance/i).count() > 0)
  check('employee: no page errors', me.errors.length === 0, me.errors.slice(0, 2).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 240))
} finally {
  if (testRunId) { try { sql(`delete from payroll.runs where id = '${testRunId}' and period_year = 2027 and period_month = 6`); console.log('cleanup: test run deleted') } catch (e) { console.log('cleanup failed: ' + e.message) } }
  if (pliTargetId) { try { sql(`delete from pli_mgmt.pli_targets where id = '${pliTargetId}'`); console.log('cleanup: disposable PLI target deleted') } catch (e) { console.log('PLI cleanup failed: ' + e.message) } }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
