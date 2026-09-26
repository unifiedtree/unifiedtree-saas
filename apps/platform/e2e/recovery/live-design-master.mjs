// Live check of the Master data design against the local API.
//
//   node e2e/recovery/live-design-master.mjs
//
// Owner: every section renders under the Master tabs with no page errors (the
// rules and payroll configuration open in HRMS settings, under its tabs); the
// employee list filters, opens a profile, exports a CSV and saves an edit; a
// test department, designation, grade, leave type, shift, policy draft, salary
// component, agency and employment type are created and edited through the
// design's own drawers and then removed from the local database. Statutory
// Settings flips LWF on and back off.
// Reader (employee): /hrms/policies keeps the page for acknowledging policies.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = `MQA${Date.now() % 100000}`

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
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  return { page, errors, failed, settle }
}
const drawer = (page) => page.locator('#utm-portal .drawer')
const toastSeen = (page, re) => page.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
async function save(page, cta) { await drawer(page).getByRole('button', { name: cta }).click() }
/** Open a row's ⋮ menu and pick an item. */
async function rowMenu(page, rowText, item) {
  // A new row is swapped for the server's copy once the save lands; wait for that.
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200)
  const row = page.locator('table.t tbody tr').filter({ hasText: rowText }).first()
  // The design's menus close when the page scrolls, so settle the row in view first.
  await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
  await row.getByRole('button', { name: 'More actions' }).click()
  await page.locator('#utm-portal .pop .opt').filter({ hasText: item }).first().click()
}
async function confirm(page, cta) { await page.locator('#utm-portal .modal').getByRole('button', { name: cta }).click() }

const cleanup = () => {
  sql(`delete from hrms.designations where title like '${tag}%'`)
  sql(`delete from hrms.departments where name like '${tag}%'`)
  sql(`delete from org.grades where code like '${tag}%'`)
  sql(`delete from leave_mgmt.leave_balances where leave_type_id in (select id from leave_mgmt.leave_types where code like '${tag}%')`)
  sql(`delete from leave_mgmt.leave_types where code like '${tag}%'`)
  sql(`delete from attendance.shift_policies where name like '${tag}%'`)
  sql(`delete from policy_mgmt.hr_policies where title like '${tag}%'`)
  sql(`delete from payroll.salary_components where code like '${tag}%'`)
  sql(`delete from hrms.contractors where agency_name like '${tag}%'`)
  sql(`delete from org.employment_types where code like '${tag}%'`)
}

try {
  const hr = await signIn('owner@unifiedtree.demo')
  const { page, settle } = hr
  const lwfBefore = sql("select lwf_enabled from payroll.settings limit 1")

  // ── every section renders under the Master tabs ──
  const ROUTES = [['/hrms/master', 'Master data'], ['/hrms/employees', 'Employee Master'], ['/hrms/master/contractors', 'Contractor Master'], ['/hrms/master/classifications', 'Classification Rules'],
    ['/hrms/master/companies', 'Companies'], ['/hrms/master/branches', 'Branches'], ['/hrms/master/departments', 'Departments'], ['/hrms/master/designations', 'Designations'],
    ['/hrms/master/grades', 'Grades & Bands'], ['/hrms/organization', 'Companies']]
  for (const [route, heading] of ROUTES) {
    hr.errors.length = 0
    await page.goto(base + route); await settle()
    await page.getByRole('heading', { name: heading, exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {})
    const ok = (await page.getByRole('navigation', { name: 'Master sections' }).count()) === 1 && (await page.getByRole('heading', { name: heading, exact: true }).count()) > 0
    check(`${route} renders "${heading}" under the Master tabs`, ok && !hr.errors.length, hr.errors[0] || '')
  }

  // ── the rules and payroll configuration are settings: their old addresses open them in HRMS settings ──
  const MOVED = [['/hrms/master/shift-rules', '/hrms/settings/shift-rules', 'Shift Rules'], ['/hrms/master/leave-rules', '/hrms/settings/leave-rules', 'Leave Rules'],
    ['/hrms/policies', '/hrms/settings/policies', 'Policy Documents'], ['/hrms/payroll/components', '/hrms/settings/salary-components', 'Salary Components'],
    ['/hrms/master/statutory', '/hrms/settings/statutory', 'Statutory Settings']]
  for (const [route, to, heading] of MOVED) {
    hr.errors.length = 0
    await page.goto(base + route); await settle()
    await page.getByRole('heading', { name: heading, exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {})
    const ok = new URL(page.url()).pathname === to && (await page.getByRole('navigation', { name: 'HRMS settings sections' }).count()) === 1
      && (await page.getByRole('navigation', { name: 'Master sections' }).count()) === 0 && (await page.getByRole('heading', { name: heading, exact: true }).count()) > 0
    check(`${route} opens "${heading}" in HRMS settings (${to})`, ok && !hr.errors.length, hr.errors[0] || new URL(page.url()).pathname)
  }

  // ── Employee Master ──
  await page.goto(base + '/hrms/employees'); await settle()
  await page.getByRole('heading', { name: 'Employee Master' }).waitFor()
  const total = Number(sql("select count(*) from hrms.employees where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and coalesce(is_active,true)"))
  check('headcount table lists every employee', await page.locator('.tbar .meta').filter({ hasText: new RegExp(`of ${total}$`) }).count() === 1, `${total}`)
  await page.getByPlaceholder('Search name, code, email or role…').fill('EMP-0001')
  await page.waitForTimeout(300)
  check('search narrows the table', (await page.locator('table.t tbody tr').count()) === 1)
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Export$/ }).click()])
  check('Export downloads a CSV of the rows shown', /employees-.*\.csv$/.test(csv.suggestedFilename()) && await toastSeen(page, /Exported 1 employee to CSV/))
  await page.locator('table.t tbody tr').first().click()
  await drawer(page).waitFor()
  check('row opens the profile drawer', await drawer(page).getByText('Employee profile').count() > 0 && await drawer(page).getByText('EMP-0001').count() > 0)
  const phoneBefore = sql("select coalesce(phone,'') from hrms.employees where employee_code='EMP-0001'")
  await drawer(page).getByRole('button', { name: /Edit details/ }).click()
  await drawer(page).getByPlaceholder('+91 98xxx xxxxx').fill('+91 90000 12345')
  await save(page, /Save changes/)
  check('editing an employee saves to the API', await toastSeen(page, /Saved changes to/) && sql("select phone from hrms.employees where employee_code='EMP-0001'") === '+91 90000 12345')
  sql(`update hrms.employees set phone=${phoneBefore ? `'${phoneBefore}'` : 'null'} where employee_code='EMP-0001'`)
  await page.goto(base + '/hrms/employees'); await settle()
  await page.locator('table.t tbody tr').first().click()
  await drawer(page).getByRole('button', { name: /Full record/ }).click()
  await page.waitForURL(/\/hrms\/employees\/[0-9a-f-]{36}$/, { timeout: 15000 }).catch(() => {})
  check('"Full record" opens the employee page', /\/hrms\/employees\/[0-9a-f-]{36}$/.test(page.url()))

  // ── Departments: add, rename, assign a head, deactivate ──
  await page.goto(base + '/hrms/master/departments'); await settle()
  await page.getByRole('button', { name: /Add department/ }).click()
  await drawer(page).getByPlaceholder('e.g. Data Science').fill(`${tag} Dept`)
  await drawer(page).getByPlaceholder('e.g. DSC').fill(tag)
  await save(page, /Add department/)
  check('department is created', await toastSeen(page, new RegExp(`${tag} Dept added`)) && sql(`select count(*) from hrms.departments where name='${tag} Dept' and is_active`) === '1')
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Dept` }).first().waitFor()
  await rowMenu(page, `${tag} Dept`, 'Edit department')
  await drawer(page).getByPlaceholder('e.g. Data Science').fill(`${tag} Dept 2`)
  await save(page, /Save changes/)
  check('department rename saves', await toastSeen(page, new RegExp(`Saved ${tag} Dept 2`)) && sql(`select count(*) from hrms.departments where name='${tag} Dept 2'`) === '1')
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Dept 2` }).first().waitFor()
  await rowMenu(page, `${tag} Dept 2`, 'Edit department')
  await drawer(page).locator('.tgl').filter({ hasText: 'Active' }).getByRole('switch').click()
  await save(page, /Save changes/)
  await page.waitForTimeout(1500)
  check('switching a department off archives it', sql(`select is_active from hrms.departments where name='${tag} Dept 2'`) === 'f')

  // ── Designations and grades ──
  await page.goto(base + '/hrms/master/grades'); await settle()
  await page.getByRole('button', { name: /Add grade/ }).click()
  await drawer(page).locator('input').first().fill(tag)
  await drawer(page).getByPlaceholder('e.g. Principal').fill(`${tag} Grade`)
  check('grade pay band fields are switched off (coming soon)', await drawer(page).locator('input[disabled]').count() >= 2)
  await save(page, /Add grade/)
  check('grade is created', await toastSeen(page, new RegExp(`${tag} · ${tag} Grade added`)) && sql(`select count(*) from org.grades where code='${tag}'`) === '1')

  await page.goto(base + '/hrms/master/designations'); await settle()
  await page.getByRole('button', { name: /Add designation/ }).click()
  await drawer(page).getByPlaceholder('e.g. Data Analyst').fill(`${tag} Analyst`)
  await drawer(page).locator('.field').filter({ hasText: 'Department' }).locator('.ddb').click()
  await page.locator('#utm-portal .pop .opt').first().click()
  await drawer(page).locator('.field').filter({ hasText: 'Grade' }).locator('.ddb').click()
  await page.locator('#utm-portal .pop .opt').filter({ hasText: tag }).first().click()
  await save(page, /Add designation/)
  check('designation is created with its grade', await toastSeen(page, new RegExp(`${tag} Analyst added`)) && sql(`select grade from hrms.designations where title='${tag} Analyst'`) === tag)

  // ── Leave type ──
  await page.goto(base + '/hrms/master/leave-rules'); await settle()
  await page.getByRole('button', { name: /Add leave type/ }).click()
  await drawer(page).getByPlaceholder('e.g. Marriage Leave').fill(`${tag} Leave`)
  await drawer(page).getByPlaceholder('e.g. MRL').fill(tag)
  await save(page, /Add leave type/)
  check('leave type is created (12 days, paid)', await toastSeen(page, new RegExp(`${tag} Leave added`)) && sql(`select annual_entitlement||'/'||is_paid_leave::int from leave_mgmt.leave_types where code='${tag}'`) === '12/1')

  // ── Shift ──
  await page.goto(base + '/hrms/master/shift-rules'); await settle()
  await page.getByRole('button', { name: /Add shift/ }).click()
  await drawer(page).getByPlaceholder('e.g. General').fill(`${tag} Shift`)
  await save(page, /Add shift/)
  check('shift is created 09:00–18:00', await toastSeen(page, new RegExp(`${tag} Shift shift added`)) && sql(`select start_time||'-'||end_time from attendance.shift_policies where name='${tag} Shift'`) === '09:00:00-18:00:00')
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Shift` }).first().waitFor()
  await rowMenu(page, `${tag} Shift`, 'Deactivate')
  await page.waitForTimeout(1500)
  check('deactivating a shift archives it', sql(`select is_active from attendance.shift_policies where name='${tag} Shift'`) === 'f')

  // ── Policy draft → discard ──
  await page.goto(base + '/hrms/policies'); await settle()
  await page.getByRole('button', { name: /Publish a policy/ }).click()
  await drawer(page).getByPlaceholder('e.g. Remote Work Policy').fill(`${tag} Policy`)
  await drawer(page).getByRole('button', { name: 'Save as draft' }).click()
  check('policy saves as a draft', await toastSeen(page, new RegExp(`${tag} Policy saved as draft`)) && sql(`select status from policy_mgmt.hr_policies where title='${tag} Policy'`) === 'DRAFT')
  await page.locator('.ttab').filter({ hasText: 'Drafts' }).click()
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Policy` }).first().waitFor()
  await rowMenu(page, `${tag} Policy`, 'Discard draft')
  await page.waitForTimeout(1500)
  check('discarding a draft archives it (no delete in the API)', sql(`select status from policy_mgmt.hr_policies where title='${tag} Policy'`) === 'ARCHIVED')

  // ── Salary component: add, edit, delete ──
  await page.goto(base + '/hrms/payroll/components'); await settle()
  await page.getByRole('button', { name: /Add component/ }).click()
  await drawer(page).getByPlaceholder('e.g. Meal Allowance').fill(`${tag} Meal`)
  await drawer(page).getByPlaceholder('e.g. MEAL', { exact: true }).fill(tag)
  await save(page, /Add component/)
  check('component is created (fixed, taxable)', await toastSeen(page, new RegExp(`${tag} Meal added`)) && sql(`select computation_type||'/'||is_taxable::int from payroll.salary_components where code='${tag}'`) === 'FIXED/1')
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Meal` }).first().waitFor()
  await rowMenu(page, `${tag} Meal`, 'Edit component')
  await drawer(page).getByPlaceholder('e.g. Meal Allowance').fill(`${tag} Meal 2`)
  await save(page, /Save component/)
  check('component edit saves', await toastSeen(page, new RegExp(`${tag} Meal 2 saved`)) && sql(`select name from payroll.salary_components where code='${tag}'`) === `${tag} Meal 2`)
  await page.locator('table.t tbody tr').filter({ hasText: `${tag} Meal 2` }).first().waitFor()
  await rowMenu(page, `${tag} Meal 2`, 'Delete component')
  await confirm(page, 'Delete')
  await page.waitForTimeout(1500)
  check('unused component deletes', sql(`select count(*) from payroll.salary_components where code='${tag}'`) === '0')

  // ── Agency ──
  await page.goto(base + '/hrms/master/contractors'); await settle()
  await page.getByRole('button', { name: /Add agency/ }).click()
  await drawer(page).getByPlaceholder('e.g. Apex Staffing Solutions').fill(`${tag} Agency`)
  await drawer(page).getByPlaceholder('e.g. APX-9981').fill('QA-1')
  await drawer(page).locator('.field').filter({ hasText: 'Contact person' }).locator('input').fill('QA Contact')
  check('licence, sites and workers are switched off (coming soon)', await drawer(page).locator('input[disabled]').count() >= 3)
  await save(page, /Add agency/)
  check('agency is created', await toastSeen(page, new RegExp(`${tag} Agency added`)) && sql(`select count(*) from hrms.contractors where agency_name='${tag} Agency'`) === '1')

  // ── Employment type (Classification Rules) ──
  await page.goto(base + '/hrms/master/classifications'); await settle()
  await page.getByRole('button', { name: /Add classification/ }).click()
  await drawer(page).getByPlaceholder('e.g. Apprentice').fill(`${tag} Type`)
  await drawer(page).getByPlaceholder('e.g. PART_TIME').fill(tag)
  await save(page, /Add classification/)
  check('classification (employment type) is created', await toastSeen(page, new RegExp(`${tag} Type classification added`)) && sql(`select count(*) from org.employment_types where code='${tag}'`) === '1')

  // ── Statutory: LWF on then back ──
  await page.goto(base + '/hrms/master/statutory'); await settle()
  const lwf = page.locator('.ccard').filter({ hasText: 'Labour Welfare Fund' }).getByRole('switch')
  await lwf.click()
  const flipped = await toastSeen(page, /Labour Welfare Fund switched (on|off)/)
  check('statutory switch saves the payroll setting', flipped && sql('select lwf_enabled from payroll.settings limit 1') !== lwfBefore)
  sql(`update payroll.settings set lwf_enabled=${lwfBefore === 't'}`)

  check('no unexpected API errors (owner)', !hr.failed.length, hr.failed.slice(0, 4).join(' | '))

  // ── Reader keeps the policy acknowledgement page ──
  const rd = await signIn('reader@unifiedtree.demo')
  await rd.page.goto(base + '/hrms/policies'); await rd.settle()
  check('employee still gets the old policies page at /hrms/policies', (await rd.page.locator('.utm').count()) === 0 && !rd.errors.length)
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  try { cleanup() } catch (e) { console.log('cleanup failed', String(e).slice(0, 200)) }
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
