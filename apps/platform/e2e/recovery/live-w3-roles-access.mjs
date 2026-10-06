// Live check of Roles & access per company (audit A-14, A-15, A-16, C-05, C-06, F-22), as the owner:
//  - Employee → Access tab: Give a role → Create makes a new role on the spot and gives it
//    (it shows under Roles, and in the person's roles on the server); Remove takes it away.
//  - The Admin role (owner minus billing) can be given from the same list; Owner cannot be
//    given per company and Owner / Admin are never offered as a company role.
//  - Companies: with a second company, the tab shows the main company and "Give company
//    access" gives a role in the other company (POST …/company-access); Roles & permissions →
//    Who has which role, filtered to that company, lists the person with that role.
//    Remove takes the access away again.
//  - Phone width (390): the Access tab has no sideways scroll.
// No refused API calls or page errors. Everything made (company, role, grants) is removed.
//
//   node e2e/recovery/live-w3-roles-access.mjs
/* global process, console, fetch, document, window */
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
const companyName = `zz QA Roles Co ${tag}`
const roleName = `QA Roles ${tag}`
const roleCode = `QA_ROLES_${tag}`
const start = sql('select now()')

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.userId = d.userId
  call.employeeId = d.employeeId
  return call
}

const browser = await chromium.launch()
const errors = [], failed = []
let companyB = null, mgrUser = null, createdRoleId = null
try {
  const owner = await login('owner@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  mgrUser = mgr.userId
  const made = await owner('POST', '/v1/hrms/companies', { name: companyName, industry: 'Quality checks', country: 'India', currency: 'INR' })
  companyB = made.json && made.json.id
  check('fixture: a second company', made.status === 201 && !!companyB, `status ${made.status}`)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0

  // ── Access tab: roles ──
  await page.goto(`${base}/hrms/employees/${mgr.employeeId}?tab=access`); await settle()
  const rolesList = page.getByRole('list', { name: /’s roles$/ })
  check('access tab: shows their roles', (await rolesList.getByText('Dept Manager', { exact: true }).count()) === 1)
  await page.getByRole('button', { name: 'Give a role', exact: true }).click()
  const giving = page.getByRole('dialog', { name: 'Give a role' })
  await giving.waitFor()
  check('give a role: Admin (owner minus billing) is offered', (await giving.getByRole('button', { name: 'Give Admin', exact: true }).count()) === 1)
  await giving.getByRole('button', { name: 'Create role' }).click()
  const createPanel = page.getByRole('dialog', { name: 'New role' })
  await createPanel.waitFor()
  await createPanel.getByPlaceholder('e.g. Regional HR').fill(roleName)
  await createPanel.getByPlaceholder('e.g. REGIONAL_HR').fill(roleCode)
  await createPanel.getByRole('button', { name: 'Create and give' }).click()
  await page.waitForTimeout(2500); await settle()
  const users1 = await owner('GET', '/v1/workspace/users')
  const mgrRow1 = (users1.json || []).find((u) => u.userId === mgrUser)
  const roles1 = await owner('GET', '/v1/rbac/roles')
  createdRoleId = (roles1.json || []).find((r) => r.code === roleCode)?.id ?? null
  check('create role: made on the spot and given to the person', !!createdRoleId && !!mgrRow1?.roles.some((r) => r.roleCode === roleCode), JSON.stringify(mgrRow1?.roles?.map((r) => r.roleCode)))
  check('create role: shows under their roles', (await rolesList.getByText(roleName, { exact: true }).count()) === 1)
  await page.screenshot({ path: `${shots}/w30-roles-access-tab-1440.png`, fullPage: true })

  // ── Access tab: companies ──
  check('companies: main company shown', (await page.getByRole('list', { name: /’s companies$/ }).getByText('Main company', { exact: true }).count()) === 1)
  await page.getByRole('button', { name: 'Give company access', exact: true }).click()
  const grantPanel = page.getByRole('dialog', { name: 'Give company access' })
  await grantPanel.waitFor()
  await grantPanel.getByRole('button', { name: /^Company/ }).click()
  await page.getByRole('option', { name: companyName }).click()
  await grantPanel.getByRole('button', { name: /^Role in that company/ }).click()
  const offered = await page.getByRole('listbox', { name: 'Role in that company' }).getByRole('option').allInnerTexts()
  check('company role: Owner, Super admin and Admin are never offered', !offered.some((t) => /^(Owner|Super Admin|Admin)\b/.test(t.trim())), offered.join(' | ').slice(0, 200))
  await page.getByRole('option', { name: /^Employee/ }).click()
  await grantPanel.getByRole('button', { name: 'Give access', exact: true }).click()
  await page.waitForTimeout(2000); await settle()
  const view = await owner('GET', `/v1/workspace/users/${mgrUser}/company-access`)
  const inB = (view.json?.companies || []).find((c) => c.companyId === companyB)
  check('company access: given on the server (Employee in the new company)', inB?.access === 'GRANT' && inB.roles.some((r) => r.code === 'EMPLOYEE' && r.source === 'GRANT'), JSON.stringify(inB))
  check('company access: shows in the tab', (await page.getByRole('list', { name: /’s companies$/ }).getByText(companyName).count()) >= 1)

  // ── Roles & permissions: who has what per company ──
  await page.goto(`${base}/roles?view=assignments`); await settle()
  await page.getByRole('button', { name: /^Company/ }).first().click()
  await page.getByRole('option', { name: companyName }).click()
  await settle()
  const rows = await page.locator('[data-company-line]').allInnerTexts()
  check('roles page: the company filter lists the person with their role there', rows.some((t) => /^Given access · Employee$/.test(t.trim())), rows.join(' | ').slice(0, 200))
  check('roles page: people whose roles cover every company are listed too', rows.some((t) => t.startsWith('Every company')))
  await page.screenshot({ path: `${shots}/w30-roles-assignments-1440.png`, fullPage: true })

  // ── remove the company access and the new role from the tab ──
  await page.goto(`${base}/hrms/employees/${mgr.employeeId}?tab=access`); await settle()
  await page.getByRole('button', { name: `Remove Employee in ${companyName}` }).click()
  const dlg = page.getByRole('dialog', { name: `Remove access to ${companyName}?` })
  await dlg.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.waitForTimeout(1500); await settle()
  const view2 = await owner('GET', `/v1/workspace/users/${mgrUser}/company-access`)
  check('company access: removed', !(view2.json?.companies || []).some((c) => c.companyId === companyB))
  await page.getByRole('button', { name: `Remove ${roleName}` }).click()
  await page.waitForTimeout(1500); await settle()
  const users2 = await owner('GET', '/v1/workspace/users')
  check('remove role: taken away again', !(users2.json || []).find((u) => u.userId === mgrUser)?.roles.some((r) => r.roleCode === roleCode))

  // ── phone width ──
  await page.setViewportSize({ width: 390, height: 844 }); await settle()
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('phone 390: the Access tab has no sideways scroll', sideways <= 1, `${sideways}px`)
  await page.screenshot({ path: `${shots}/w30-roles-access-tab-390.png`, fullPage: true })

  check('no refused API calls or page errors', !failed.length && !errors.length, failed[0] || errors[0] || '')
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  try {
    const owner = await login('owner@unifiedtree.demo')
    if (mgrUser) await owner('DELETE', `/v1/workspace/users/${mgrUser}/roles/${roleCode}`)
    if (createdRoleId) await owner('DELETE', `/v1/rbac/roles/${createdRoleId}`)
  } catch { /* the SQL below still cleans up */ }
  try {
    if (companyB) sql(`delete from rbac.user_company_access where company_id='${companyB}'`)
    if (mgrUser) sql(`delete from audit.events where entity_id='${mgrUser}' and occurred_at >= '${start}' and (summary like ${lit('%' + companyName + '%')} or summary like ${lit('%' + roleName + '%')})`)
    sql(`delete from rbac.user_roles where role_id in (select id from rbac.roles where code=${lit(roleCode)} and tenant_id='${tenant}')`)
    sql(`delete from rbac.role_permissions where role_id in (select id from rbac.roles where code=${lit(roleCode)} and tenant_id='${tenant}')`)
    sql(`delete from rbac.roles where code=${lit(roleCode)} and tenant_id='${tenant}'`)
    const mine = companyB && sql(`select count(*) from org.companies where id='${companyB}' and name=${lit(companyName)} and tenant_id='${tenant}'`) === '1'
    if (mine) {
      const coTables = sql(`select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')`)
        .split('\n').filter(Boolean).filter((t) => t !== 'org.companies')
      for (let pass = 0; pass < 4; pass++) for (const t of coTables) { try { sql(`delete from ${t} where company_id='${companyB}'`) } catch { /* later pass */ } }
      sql(`delete from audit.events where entity_id='${companyB}'`)
      const gone = sql(`with d as (delete from org.companies where id='${companyB}' and name=${lit(companyName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
      check('cleanup: the company, the role and the grants removed', gone === '1' && sql(`select count(*) from rbac.roles where code=${lit(roleCode)}`) === '0')
    }
  } catch (err) {
    check('cleanup: the company, the role and the grants removed', false, String(err).split('\n')[0])
  }
  await browser.close()
  const failedCount = results.filter((x) => !x.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
