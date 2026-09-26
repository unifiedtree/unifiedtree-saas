// Live check for w3/access: the Access step (roles + single permissions) when
// adding a person, in both add flows.
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3015 node e2e/recovery/live-w3-access.mjs
//
// What it proves, against the local backend and database:
//  - Owner, Employee Master → Add employee: the drawer has an Access section,
//    Employee is on and locked, one extra permission is ticked (Added) and one
//    the Employee role gives is unticked (Removed); after Add employee the
//    person's login has the Employee role, a GRANT and a DENY override (read
//    back through GET /v1/workspace/users/{id}/permissions).
//  - Owner, onboarding wizard: an Access step before Joining; with the login
//    invite on, a role (Dept Manager, high risk → confirmed) plus one extra and
//    one removed permission are saved the same way.
//  - HR manager (adds people, can't give roles): no Access section or step, and
//    adding still works as before (Employee role only, no overrides).
//  - Department manager: no Access section or step anywhere.
// Screenshots of the step at 1440 and 390 wide go to W3_SHOTS. Everything the
// test creates is removed at the end.
import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
const created = [] // emails of people this test adds
let where = 'start', lastPage = null // for the failure report
const at = (name, page) => { where = name; if (page) lastPage = page; console.log(`..  ${name}`) }
mkdirSync(shots, { recursive: true })
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Dates are the shared calendar now (a trigger button + hidden input): pick year, month, then day.
async function pickDate(page, trigger, iso) {
  const [y, m, d] = iso.split('-').map(Number)
  await trigger.click()
  const calendar = page.getByRole('dialog', { name: 'Choose date' })
  await calendar.getByRole('button', { name: 'Choose year' }).click()
  await calendar.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await calendar.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await calendar.getByRole('gridcell', { name: new RegExp(`, ${d} ${MONTHS[m - 1]} ${y}`) }).click()
  await calendar.waitFor({ state: 'hidden' })
}

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

// ── fixtures: one permission to add (not given by Employee or Dept Manager, owner holds it) and one to remove (Employee gives it) ──
const roleCodes = (code) => `select permission_code from rbac.role_permissions rp join rbac.roles r on r.id=rp.role_id where r.code='${code}' and r.tenant_id is null`
const unique = 'display_name in (select display_name from rbac.permissions group by 1 having count(*)=1)'
const pick = (where) => sql(`select code||'|'||display_name from rbac.permissions where ${where} and ${unique} order by module, code limit 1`).split('|')
const [EXTRA, EXTRA_NAME] = pick(`risk_level='LOW' and code not like 'platform.%' and code not in (${roleCodes('EMPLOYEE')}) and code not in (${roleCodes('DEPT_MANAGER')}) and code in (${roleCodes('OWNER')})`)
const [REMOVE, REMOVE_NAME] = pick(`risk_level='LOW' and code in (${roleCodes('EMPLOYEE')})`)
console.log(`fixtures: add ${EXTRA} (${EXTRA_NAME}), remove ${REMOVE} (${REMOVE_NAME})`)

const browser = await chromium.launch()
async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
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
  lastPage = page
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  return { page, context, errors, failed, settle }
}
const drawer = (page) => page.locator('#utm-portal .drawer')
const toastSeen = (page, re) => page.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 30000 }).then(() => true, () => false)
async function pickFirst(page, label, onlyIfEmpty = false) {
  at(`pick ${label}`)
  // The Field wrapper whose own label is exactly this (the dropdown inside it is also a .field).
  const field = drawer(page).locator('div.field').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^${label}\\*?$`) }) }).first()
  const btn = field.locator('.ddb').first()
  if (onlyIfEmpty && await btn.locator('.ph').count() === 0) return
  // The design closes its popovers on any scroll or resize (and its drawers on Escape), so open
  // it again if it closed under us, and pick the option with a plain DOM click.
  const opt = page.locator('#utm-portal .pop .opt').first()
  for (let i = 0; i < 4; i++) {
    if (await opt.count() === 0) await btn.click({ timeout: 10000 })
    try {
      await opt.waitFor({ state: 'attached', timeout: 3000 })
      await opt.dispatchEvent('click')
    } catch { /* closed again */ }
    await page.waitForTimeout(300)
    if (await btn.locator('.ph').count() === 0) { if (i) console.log(`..  (${label} needed ${i + 1} tries)`); return }
  }
  throw new Error(`couldn’t pick a ${label}`)
}
/** Open Employee Master → Add employee and fill the required fields. */
async function openAddEmployee(page, settle, first, email) {
  await page.goto(base + '/hrms/employees'); await settle()
  at('open Add employee')
  await page.locator('.utm .hero-act').getByRole('button', { name: /Add employee/ }).click()
  const d = drawer(page)
  await d.waitFor()
  // Let the Access section (when there is one) finish loading before using the dropdowns.
  if (await d.locator('[data-access-step]').count()) await d.locator('[data-access-step]').getByText(/of \d+ on/).first().waitFor({ timeout: 30000 })
  else await page.waitForTimeout(800)
  await d.getByPlaceholder('e.g. Ananya').fill(first)
  await d.getByPlaceholder('e.g. Sharma').fill('Access')
  await d.getByPlaceholder('name@company.com').fill(email)
  await pickFirst(page, 'Branch', true)
  await pickFirst(page, 'Department')
  await pickFirst(page, 'Designation')
  return d
}
/** Tick or untick one permission through the picker's search. */
async function togglePermission(scope, name) {
  at(`toggle ${name}`)
  await scope.getByRole('textbox', { name: 'Search permissions' }).fill(name)
  const box = scope.getByRole('checkbox', { name, exact: true })
  await box.waitFor({ timeout: 10000 })
  await box.click()
  return box
}
const pillNextTo = (box, text) => box.getByText(text, { exact: true }).count().then((n) => n > 0)
/** The onboarding wizard's step labels. */
const stepLabels = (page) => page.locator('ol').filter({ has: page.locator('button[aria-current="step"]') }).locator('li')
async function accessOf(call, email) {
  const users = (await call('GET', '/v1/workspace/users')).json || []
  const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase())
  if (!u) return null
  return (await call('GET', `/v1/workspace/users/${u.userId}/permissions`)).json
}

try {
  const ownerApi = await apiLogin('owner@unifiedtree.demo')

  // ── 1. Owner · Employee Master → Add employee ──
  {
    const o = await signIn('owner@unifiedtree.demo')
    const { page, settle } = o
    const email = `qa.access.m${tag}@example.invalid`
    created.push(email)
    const d = await openAddEmployee(page, settle, `QA${tag}M`, email)
    at('Master: access section')
    const step = d.locator('[data-access-step]')
    check('Master: the Add employee drawer has an Access section', await step.count() === 1)
    const employee = step.getByRole('checkbox', { name: 'Employee', exact: true })
    await employee.waitFor({ timeout: 15000 })
    check('Master: Employee role is on and locked', await employee.getAttribute('aria-checked') === 'true' && await employee.isDisabled())
    await step.getByText(/of \d+ on/).first().waitFor({ timeout: 20000 })
    const add = await togglePermission(step, EXTRA_NAME)
    check('Master: ticking a permission the roles don’t give marks it Added', await add.getAttribute('aria-checked') === 'true' && await pillNextTo(add, 'Added'))
    const rem = await togglePermission(step, REMOVE_NAME)
    check('Master: unticking a permission Employee gives marks it Removed', await rem.getAttribute('aria-checked') === 'false' && await pillNextTo(rem, 'Removed'))
    check('Master: the summary counts 1 added and 1 removed', await step.getByText('1 added', { exact: true }).count() > 0 && await step.getByText('1 removed', { exact: true }).count() > 0)
    await step.getByRole('textbox', { name: 'Search permissions' }).fill('')
    await step.getByRole('button', { name: 'Changes' }).click()
    await step.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/access-master-1440.png` })
    at('Master: save')
    await d.getByRole('button', { name: /Add employee/ }).click()
    check('Master: the employee is added', await toastSeen(page, new RegExp(`QA${tag}M Access added`)))
    await settle()
    const view = await accessOf(ownerApi, email)
    check('Master: a login was created for them', !!view)
    check('Master: roles saved (Employee)', !!view && JSON.stringify(view.roles.map((r) => r.roleCode).sort()) === '["EMPLOYEE"]', view && view.roles.map((r) => r.roleCode).join(','))
    check('Master: the extra permission is saved for them', !!view && view.overrides.some((x) => x.permissionCode === EXTRA && x.effect === 'GRANT') && view.effective.some((x) => x.code === EXTRA))
    check('Master: the removed permission is saved for them', !!view && view.overrides.some((x) => x.permissionCode === REMOVE && x.effect === 'DENY') && view.removed.some((x) => x.code === REMOVE))
    check('Master: no page errors', !o.errors.length, o.errors[0] || '')
    check('Master: no failed API calls', !o.failed.length, o.failed.join(' | '))
    await o.context.close()

    at('Master: phone width')
    const p = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    const d2 = await openAddEmployee(p.page, p.settle, `QA${tag}P`, `qa.access.p${tag}@example.invalid`)
    const step2 = d2.locator('[data-access-step]')
    await step2.getByText(/of \d+ on/).first().waitFor({ timeout: 20000 })
    // Select all / clear all on one group (this drawer is never saved).
    at('Master (390): select all in a group')
    await step2.getByRole('textbox', { name: 'Search permissions' }).fill(REMOVE_NAME)
    const group = step2.locator('[data-access-group]').first()
    const count = group.getByText(/^\d+ of \d+ on$/)
    const total = Number(((await count.textContent()) || '').match(/of (\d+)/)?.[1] || 0)
    const box = group.getByRole('checkbox', { name: /^All .* permissions$/ })
    await box.click()
    const yes = step2.getByRole('button', { name: /^Yes, give (it|them)$/ })
    if (await yes.count()) await yes.click()
    check('Master (390 wide): a group’s box ticks the whole group', total > 0 && (await count.textContent()) === `${total} of ${total} on`, await count.textContent())
    await box.click()
    check('Master (390 wide): clicking it again unticks the whole group', (await count.textContent()) === `0 of ${total} on`, await count.textContent())
    await box.click()
    if (await yes.count()) await yes.click()
    await group.scrollIntoViewIfNeeded(); await p.page.waitForTimeout(300)
    const noScroll = await p.page.evaluate(() => { const el = document.querySelector('#utm-portal .drawer .dr-b'); return !!el && el.scrollWidth <= el.clientWidth + 1 })
    check('Master (390 wide): the Access section fits without sideways scrolling', noScroll)
    await p.page.screenshot({ path: `${shots}/access-master-390.png` })
    check('Master (390 wide): no page errors', !p.errors.length, p.errors[0] || '')
    await p.context.close()
  }

  // ── 2. Owner · onboarding wizard ──
  {
    const o = await signIn('owner@unifiedtree.demo')
    const { page, settle } = o
    const email = `qa.access.o${tag}@example.invalid`
    created.push(email)
    at('Onboarding: basic')
    await page.goto(base + '/hrms/onboarding/instances/new'); await settle()
    check('Onboarding: the stepper has an Access step', await stepLabels(page).filter({ hasText: /^\d*Access$/ }).count() === 1)
    await page.locator('#field-fullName input').fill(`QA${tag}O Access`)
    await page.locator('#field-email input').fill(email)
    await page.locator('#field-phone input').fill('9000000000')
    await pickDate(page, page.locator('#field-dateOfBirth .utc-trigger'), '1995-01-15')
    const next = () => page.getByRole('button', { name: 'Next', exact: true }).click()
    await next()
    const choose = async (id) => {
      const select = page.locator(`#field-${id} select`)
      await expect.poll(() => select.locator('option').count()).toBeGreaterThan(1)
      const value = await select.locator('option').evaluateAll((options) => options.find((x) => x.value && !x.disabled)?.value)
      await select.selectOption(value)
    }
    at('Onboarding: employment')
    await choose('departmentId')
    await choose('branchId')
    await page.locator('#field-designationText input, #field-designationId select').first().waitFor({ state: 'visible' })
    if (await page.locator('#field-designationText input').count()) await page.locator('#field-designationText input').fill('QA Specialist')
    else await choose('designationId')
    await pickDate(page, page.locator('#field-dateOfJoining .utc-trigger'), '2026-10-01')
    await next()
    await next() // documents
    at('Onboarding: payroll')
    await page.locator('#field-ctcAnnual input').fill('600000')
    await page.locator('#field-accountHolderName input').fill(`QA${tag}O Access`)
    await choose('bankName')
    await page.locator('#field-accountNumber input').fill('123456789012')
    await page.locator('#field-ifsc input').fill('HDFC0000001')
    await next() // payroll
    await next() // benefits
    await next() // policies
    await next() // assets
    at('Onboarding: access')
    await page.getByRole('heading', { name: 'Roles and permissions' }).waitFor({ timeout: 15000 })
    check('Onboarding: Access starts with the invite off and says why', await page.getByText('Access can be set once this person has a login.').count() > 0)
    await page.getByText('Send their login invite when the employee is created').click()
    const picker = page.locator('[data-access-picker]')
    const mgrRole = picker.getByRole('checkbox', { name: 'Dept Manager', exact: true })
    await mgrRole.waitFor({ timeout: 15000 })
    await mgrRole.click()
    const yes = picker.getByRole('button', { name: 'Yes, give the role' })
    if (await yes.count()) await yes.click()
    check('Onboarding: Dept Manager role is on', await mgrRole.getAttribute('aria-checked') === 'true')
    await picker.getByText('Adding what the new role gives…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await picker.getByText(/of \d+ on/).first().waitFor({ timeout: 20000 })
    const add = await togglePermission(picker, EXTRA_NAME)
    check('Onboarding: extra permission marked Added', await add.getAttribute('aria-checked') === 'true' && await pillNextTo(add, 'Added'))
    const rem = await togglePermission(picker, REMOVE_NAME)
    check('Onboarding: removed permission marked Removed', await rem.getAttribute('aria-checked') === 'false' && await pillNextTo(rem, 'Removed'))
    await picker.getByRole('textbox', { name: 'Search permissions' }).fill('')
    await picker.getByRole('button', { name: 'Changes' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/access-onboarding-1440.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check('Onboarding (390 wide): no sideways page scroll', fits)
    await page.screenshot({ path: `${shots}/access-onboarding-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    at('Onboarding: create')
    await next() // → joining
    await page.getByRole('button', { name: 'Create Employee', exact: true }).click()
    const saved = await page.getByText('Login invite sent, and their roles and permissions are saved.').waitFor({ timeout: 60000 }).then(() => true, () => false)
    check('Onboarding: success card says the invite went and access is saved', saved)
    const view = await accessOf(ownerApi, email)
    check('Onboarding: a login was created for them', !!view)
    check('Onboarding: roles saved (Employee + Dept Manager)', !!view && JSON.stringify(view.roles.map((r) => r.roleCode).sort()) === '["DEPT_MANAGER","EMPLOYEE"]', view && view.roles.map((r) => r.roleCode).join(','))
    check('Onboarding: the extra permission is saved for them', !!view && view.overrides.some((x) => x.permissionCode === EXTRA && x.effect === 'GRANT'))
    check('Onboarding: the removed permission is saved for them', !!view && view.overrides.some((x) => x.permissionCode === REMOVE && x.effect === 'DENY') && !view.effective.some((x) => x.code === REMOVE))
    check('Onboarding: no page errors', !o.errors.length, o.errors[0] || '')
    check('Onboarding: no failed API calls', !o.failed.length, o.failed.join(' | '))
    await o.context.close()
  }

  // ── 3. HR manager: adds people, can't give roles → no Access step, adding works as before ──
  {
    at('HR manager')
    const h = await signIn('hrm@unifiedtree.demo')
    const { page, settle } = h
    const email = `qa.access.h${tag}@example.invalid`
    created.push(email)
    const d = await openAddEmployee(page, settle, `QA${tag}H`, email)
    await page.waitForTimeout(800)
    check('HR manager: no Access section in Add employee', await d.locator('[data-access-step]').count() === 0 && await d.getByText('Access', { exact: true }).count() === 0)
    await d.getByRole('button', { name: /Add employee/ }).click()
    check('HR manager: the employee is still added', await toastSeen(page, new RegExp(`QA${tag}H Access added`)))
    await settle()
    const roles = sql(`select coalesce(string_agg(r.code, ',' order by r.code), '') from auth.user_credentials uc join rbac.user_roles ur on ur.user_id=uc.id join rbac.roles r on r.id=ur.role_id where lower(uc.email)=lower('${email}')`)
    const overrides = sql(`select count(*) from rbac.user_permission_overrides o join auth.user_credentials uc on uc.id=o.user_id where lower(uc.email)=lower('${email}')`)
    check('HR manager: the new person gets the default (Employee only, invited)', roles === 'EMPLOYEE' && overrides === '0', `roles=${roles} overrides=${overrides}`)
    await page.goto(base + '/hrms/onboarding/instances/new'); await settle()
    await stepLabels(page).first().waitFor({ timeout: 15000 })
    check('HR manager: the onboarding wizard has no Access step', await stepLabels(page).filter({ hasText: /^\d*Access$/ }).count() === 0 && await stepLabels(page).count() === 8)
    check('HR manager: no page errors', !h.errors.length, h.errors[0] || '')
    await h.context.close()
  }

  // ── 4. Department manager: no Access step anywhere ──
  {
    at('Dept manager')
    const m = await signIn('mgr@unifiedtree.demo')
    const { page, settle } = m
    await page.goto(base + '/hrms/employees'); await settle()
    check('Dept manager: no Add employee / Access on Employee Master (as before)', await page.locator('[data-access-step]').count() === 0 && await page.locator('.utm .hero-act').getByRole('button', { name: /Add employee/ }).count() === 0)
    await page.goto(base + '/hrms/onboarding/instances/new'); await settle()
    check('Dept manager: no Access step in onboarding', await page.locator('[data-access-picker]').count() === 0 && await stepLabels(page).filter({ hasText: /^\d*Access$/ }).count() === 0)
    check('Dept manager: no page errors', !m.errors.length, m.errors[0] || '')
    await m.context.close()
  }
} catch (e) {
  check('test ran to the end', false, `at "${where}": ${String(e && e.message || e).split('\n').slice(0, 14).join(' | ')}`)
  try { await lastPage?.screenshot({ path: `${shots}/access-fail.png`, fullPage: true }) } catch { /* page gone */ }
} finally {
  await browser.close()
  // Remove everyone this test added: their login (roles, overrides and invitation cascade), the employee and what the wizard saved.
  for (const email of created) {
    const emp = sql(`select coalesce(string_agg(id::text, ','), '') from hrms.employees where lower(email)=lower('${email}')`)
    const user = sql(`select coalesce(string_agg(id::text, ','), '') from auth.user_credentials where lower(email)=lower('${email}')`)
    const ids = [...emp.split(','), ...user.split(',')].filter(Boolean)
    const qs = []
    if (ids.length) qs.push(`delete from audit.events where entity_id in (${ids.map((x) => `'${x}'`).join(',')})`)
    if (user) qs.push(`delete from auth.user_credentials where lower(email)=lower('${email}')`)
    for (const e of emp.split(',').filter(Boolean)) {
      qs.push(
        `delete from hrms.onboarding_instances where employee_id='${e}'`,
        `delete from hrms.employee_onboarding_records where employee_id='${e}'`,
        `delete from hrms.asset_allocations where employee_id='${e}'`,
        `delete from payroll.employee_structure_components where structure_id in (select id from payroll.employee_salary_structures where employee_id='${e}')`,
        `delete from payroll.employee_salary_structures where employee_id='${e}'`,
        `delete from leave_mgmt.leave_balances where employee_id='${e}'`,
        `delete from hrms.employees where id='${e}'`,
      )
    }
    for (const q of qs) { try { sql(q) } catch (err) { console.log('cleanup:', String(err).split('\n')[0]) } }
    const left = sql(`select (select count(*) from hrms.employees where lower(email)=lower('${email}')) + (select count(*) from auth.user_credentials where lower(email)=lower('${email}'))`)
    console.log(`cleanup: ${email} removed: ${left === '0'}`)
  }
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
