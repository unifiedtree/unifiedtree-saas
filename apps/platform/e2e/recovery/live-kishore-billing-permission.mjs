// Live check for chakri/billing-permission (owner Q-26, 9 Oct 2026): "Can buy and manage plans and billing"
// (workspace.billing.manage) on any custom role, or for one person, works end to end.
//
//   NODE_OPTIONS="--import ./e2e/recovery/_skip-punch-prompt.mjs" \
//     live-slot.sh /c/REACT/ut-wt/chakri-billing-perm 3110 node e2e/recovery/live-kishore-billing-permission.mjs
//
//  - the Roles editor shows it under its new name; a super admin (not the owner) can't give it;
//  - the owner ticks it on a new custom role and gives that role to mgr@ (a department manager):
//    mgr@ can now read the plan, the billing breakdown and request a module (API), and the web shows
//    Billing in Business settings and /plan opens; hrm@ (no billing) is still refused everywhere;
//  - the owner gives it to fin@ alone (a per-person grant): fin@ can read the plan;
//  - a deputy is now told about payments too (TenantAdminLookup's rule, checked in the database).
// Everything is put back at the end.
/* global process, console, fetch */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const BILLING = 'workspace.billing.manage'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

async function as(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
}
const uid = (email) => sql(`select id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='${email}'`)
/** Who the payment reminders go to: the same query as TenantAdminLookup.findAdminUsers. */
const told = () => sql(`
  select coalesce(string_agg(distinct uc.email, ',' order by uc.email), '') from auth.user_credentials uc
   where uc.tenant_id='${tenant}' and uc.employee_id is not null and uc.is_active
     and (exists (select 1 from rbac.user_roles ur where ur.tenant_id=uc.tenant_id and ur.user_id=uc.id
                   and ur.role_id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010'))
       or ((exists (select 1 from rbac.user_roles ur join rbac.role_permissions rp on rp.role_id=ur.role_id
                     where ur.tenant_id=uc.tenant_id and ur.user_id=uc.id and rp.permission_code='${BILLING}')
            or exists (select 1 from rbac.user_permission_overrides o where o.tenant_id=uc.tenant_id and o.user_id=uc.id
                     and o.permission_code='${BILLING}' and o.effect='GRANT' and (o.expires_at is null or o.expires_at > now())))
           and not exists (select 1 from rbac.user_permission_overrides o where o.tenant_id=uc.tenant_id and o.user_id=uc.id
                     and o.permission_code='${BILLING}' and o.effect='DENY' and (o.expires_at is null or o.expires_at > now()))))`)
const PLAN_APIS = ['/v1/workspace/plan/current', '/v1/workspace/plan/breakdown']
const refused = (r) => r.status === 403

let roleId = null, otherRoleId = null
const MGR = uid('mgr@unifiedtree.demo'), FIN = uid('fin@unifiedtree.demo')
// The plan endpoints record who started a plan change: the caller's platform account, else the business
// owner's (WorkspacePlanController.resolveAccountId). Every real business has an owner account from sign-up;
// the demo business has none, so the test gives it one (put back at the end).
const ownerAccountBefore = sql(`select coalesce(owner_account_id::text, '') from platform.tenants where id='${tenant}'`)
const QA_ACCOUNT = 'acc0acc0-0000-4000-8000-00000000a26a'
let browser
try {
  if (!ownerAccountBefore) {
    sql(`insert into platform.accounts (id, email, display_name, password_hash, status) values ('${QA_ACCOUNT}', 'qa-owner-q26@unifiedtree.demo', 'QA owner', 'qa-not-a-password', 'ACTIVE') on conflict do nothing`)
    sql(`update platform.tenants set owner_account_id='${QA_ACCOUNT}' where id='${tenant}'`)
  }
  check('V144_6: the Roles editor calls it "Can buy and manage plans and billing"',
    sql(`select display_name from rbac.permissions where code='${BILLING}'`) === 'Can buy and manage plans and billing')

  const owner = await as('owner@unifiedtree.demo')
  const ownerPlan = await owner('GET', '/v1/workspace/plan/current')
  check('owner: reads the plan', ownerPlan.status === 200, `${ownerPlan.status} ${ownerPlan.text.slice(0, 100)}`)
  const mgrBefore = await as('mgr@unifiedtree.demo')
  for (const p of PLAN_APIS) check(`before: a department manager is refused ${p}`, refused(await mgrBefore('GET', p)))

  // The owner makes a custom role with only billing and gives it to mgr@.
  const created = await owner('POST', '/v1/rbac/roles', { code: 'QA_BILLING_DEPUTY', displayName: 'QA Billing deputy', description: 'Pays the bills' })
  roleId = created.json?.id
  check('owner: creates a custom role', created.status === 201 && !!roleId, `${created.status} ${created.text.slice(0, 120)}`)
  const ticked = await owner('PUT', `/v1/rbac/roles/${roleId}/permissions?acknowledgeRisk=true`, [BILLING])
  check('owner: ticks "Can buy and manage plans and billing" on it', ticked.status === 200 && JSON.stringify(ticked.json).includes(BILLING), `${ticked.status} ${ticked.text.slice(0, 120)}`)

  // A super admin who isn't the owner can't hand out billing: adding it to a role that hasn't got it.
  const other = await owner('POST', '/v1/rbac/roles', { code: 'QA_NO_BILLING', displayName: 'QA No billing', description: 'Plain' })
  otherRoleId = other.json?.id
  const superAdmin = await as('admin@unifiedtree.demo')
  const sa = await superAdmin('PUT', `/v1/rbac/roles/${otherRoleId}/permissions?acknowledgeRisk=true`, [BILLING])
  check('a super admin (not the owner) cannot add billing to a role', sa.status >= 400 && /OWNER/.test(sa.text), `${sa.status} ${sa.text.slice(0, 140)}`)

  const given = await owner('POST', `/v1/rbac/users/${MGR}/roles/${roleId}`)
  check('owner: gives the role to mgr@', given.status === 201, `${given.status} ${given.text.slice(0, 120)}`)

  const mgr = await as('mgr@unifiedtree.demo')   // a new sign-in carries the new permission
  for (const p of PLAN_APIS) {
    const r = await mgr('GET', p)
    check(`deputy: ${p} answers (not 403)`, !refused(r), `${r.status} ${r.text.slice(0, 100)}`)
  }
  const buy = await mgr('POST', '/v1/workspace/modules/nosuchmodule/request-upgrade')
  check('deputy: may ask to buy a module (refused only because the module doesn\'t exist)', !refused(buy), `${buy.status} ${buy.text.slice(0, 100)}`)
  check('deputy: is now told about payments (reminders, extra users, trial)', told().split(',').includes('mgr@unifiedtree.demo'), told())

  const hrm = await as('hrm@unifiedtree.demo')
  for (const p of PLAN_APIS) check(`HR manager (no billing): still refused ${p}`, refused(await hrm('GET', p)))
  check('HR manager is not told about payments', !told().split(',').includes('hrm@unifiedtree.demo'))

  // One person, no role change: a per-person grant.
  const finBefore = await as('fin@unifiedtree.demo')
  check('before: the finance lead is refused the plan', refused(await finBefore('GET', '/v1/workspace/plan/current')))
  const grant = await owner('PUT', `/v1/workspace/users/${FIN}/permissions`, { overrides: [{ permissionCode: BILLING, effect: 'GRANT', reason: 'QA: pays the bills' }], acknowledgeRisk: true })
  check('owner: gives billing to the finance lead alone', grant.status === 200, `${grant.status} ${grant.text.slice(0, 140)}`)
  const fin = await as('fin@unifiedtree.demo')
  const finPlan = await fin('GET', '/v1/workspace/plan/current')
  check('finance lead: can read the plan now', !refused(finPlan), `${finPlan.status}`)

  // Web, as the deputy and as the HR manager.
  browser = await chromium.launch()
  async function web(email) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.locator('input[type=email]').waitFor({ timeout: 90000 })
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
    return page
  }
  const dp = await web('mgr@unifiedtree.demo')
  await dp.goto(base + '/modules', { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(3000)
  await dp.screenshot({ path: `${shots}/kishore-billing-deputy-launcher.png`, fullPage: true })
  // Business settings (owner, 10 Oct 2026): the launcher's top-bar button opens them, all of them as a left menu.
  const bizMenu = dp.getByRole('navigation', { name: 'Business settings' })
  const bizButton = dp.locator('a.ut-biz__apps[href^="/business/"]')
  if (await bizButton.count()) { await bizButton.click(); await bizMenu.waitFor({ timeout: 30000 }).catch(() => {}) }
  check('web deputy: the launcher\'s Business settings shows Billing & plan', await bizMenu.getByRole('link', { name: 'Billing & plan', exact: true }).isVisible().catch(() => false))
  await dp.goto(base + '/plan', { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(4000)
  check('web deputy: /plan opens (no "You can’t manage the plan")', !(await dp.getByText('You can’t manage the plan').isVisible().catch(() => false)))
  await dp.screenshot({ path: `${shots}/kishore-billing-deputy-plan.png`, fullPage: true })
  await dp.goto(base + '/business/billing', { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(4000)
  const billingText = await dp.locator('main').innerText().catch(() => '')
  check('web deputy: Business settings → Billing opens', !/don.t have access|no access/i.test(billingText.slice(0, 300)), billingText.slice(0, 80).replace(/\n/g, ' '))
  await dp.screenshot({ path: `${shots}/kishore-billing-deputy-billing.png`, fullPage: true })

  const hp = await web('hrm@unifiedtree.demo')
  await hp.goto(base + '/plan', { waitUntil: 'domcontentloaded' })
  await hp.getByText('You can’t manage the plan').waitFor({ timeout: 20000 }).catch(() => {})
  check('web HR manager: /plan says "You can’t manage the plan"', await hp.getByText('You can’t manage the plan').isVisible().catch(() => false))
  await hp.screenshot({ path: `${shots}/kishore-billing-hrm-plan.png`, fullPage: true })
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  if (roleId) {
    sql(`delete from rbac.user_roles where tenant_id='${tenant}' and role_id='${roleId}'`)
    sql(`delete from rbac.role_permissions where role_id='${roleId}'`)
    sql(`delete from rbac.roles where id='${roleId}'`)
  }
  if (otherRoleId) { sql(`delete from rbac.role_permissions where role_id='${otherRoleId}'`); sql(`delete from rbac.roles where id='${otherRoleId}'`) }
  sql(`delete from rbac.user_permission_overrides where tenant_id='${tenant}' and user_id='${FIN}' and permission_code='${BILLING}'`)
  if (!ownerAccountBefore) {
    sql(`update platform.tenants set owner_account_id=null where id='${tenant}' and owner_account_id='${QA_ACCOUNT}'`)
    sql(`delete from platform.accounts where id='${QA_ACCOUNT}'`)
  }
  check('cleanup: the roles, the grant and the QA owner account are gone', sql(`select count(*) from rbac.roles where code in ('QA_BILLING_DEPUTY', 'QA_NO_BILLING')`) === '0'
    && sql(`select count(*) from platform.accounts where id='${QA_ACCOUNT}'`) === '0'
    && sql(`select count(*) from rbac.user_permission_overrides where user_id='${FIN}'`) === '0')
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
