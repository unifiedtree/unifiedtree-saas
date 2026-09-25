// Live check of the redesigned HR setup pages:
//  - Policies: the employee sees "Policies" with their acknowledge tiles and
//    can open a policy. With hrms.policy.read taken away (acknowledge.self
//    only, done on the local EMPLOYEE role and put back), they can still list
//    active policies (was a 403 and a "No policies access" page).
//  - Notification templates: add, edit and delete in the drawer; the page says
//    templates aren't used for sending yet.
//  - Integrations: add, mark configured, remove; "Recorded" shows a real date.
// No refused API calls or page errors. Everything created is removed.
//
//   node e2e/recovery/live-design-hrsetup.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const EMPLOYEE_ROLE = '00000000-0000-0000-0000-000000000004'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const browser = await chromium.launch()
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  return (await r.json()).accessToken
}
const stamp = Date.now()
const tplName = `QA template ${stamp}`, intName = `QA integration ${stamp}`
let removedRead = false
try {
  // ── Policies, as the employee ──
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/policies'); await settle(r.page)
  check('policies: the employee sees "Policies"', (await r.page.getByRole('heading', { name: 'Policies', level: 1 }).count()) === 1)
  check('policies: acknowledge tiles', (await r.page.getByText('Still to acknowledge', { exact: true }).count()) === 1)
  const first = r.page.locator('button[aria-expanded]').first()
  if (await first.count()) { await first.click(); check('policies: a policy opens', (await first.getAttribute('aria-expanded')) === 'true') }
  check('policies: no refused calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  // ── acknowledge.self only ──
  if (sql(`select count(*) from rbac.role_permissions where role_id='${EMPLOYEE_ROLE}' and permission_code='hrms.policy.read'`) === '1') {
    sql(`delete from rbac.role_permissions where role_id='${EMPLOYEE_ROLE}' and permission_code='hrms.policy.read'`)
    removedRead = true
  }
  // The server caches the employee baseline for 5 minutes; wait until a fresh login reflects the change.
  let token = '', perms = []
  for (let i = 0; i < 18; i++) {
    token = await apiLogin('reader@unifiedtree.demo')
    perms = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).permissions || []
    if (!perms.includes('hrms.policy.read')) break
    await new Promise((res) => setTimeout(res, 20000))
  }
  const list = await fetch(`${api}/v1/policy/policies?status=ACTIVE`, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` } })
  check('api: acknowledge-only can list active policies (was 403)', !perms.includes('hrms.policy.read') && perms.includes('hrms.policy.acknowledge.self') && list.status === 200, `read=${perms.includes('hrms.policy.read')} status=${list.status}`)
  const drafts = await fetch(`${api}/v1/policy/policies?status=DRAFT`, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` } })
  check('api: …but still not drafts', drafts.status === 403, `status=${drafts.status}`)
  const r2 = await session('reader@unifiedtree.demo')
  await r2.page.goto(base + '/hrms/policies'); await settle(r2.page)
  check('policies: acknowledge-only sees the policies, not "No policies access"', (await r2.page.getByText('No policies access', { exact: true }).count()) === 0 && (await r2.page.getByText('Active policies', { exact: true }).count()) === 1)
  check('policies: acknowledge-only has no refused calls', !r2.failed.length && !r2.errors.length, r2.failed[0] || r2.errors[0] || '')
  await r2.ctx.close()
  if (removedRead) { sql(`insert into rbac.role_permissions (role_id, permission_code) values ('${EMPLOYEE_ROLE}','hrms.policy.read') on conflict do nothing`); removedRead = false }

  // ── Notification templates ──
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/notification-templates'); await settle(o.page)
  check('templates: says they aren’t used for sending yet', (await o.page.getByText(/notifications still use their built-in wording/).count()) === 1)
  await o.page.getByRole('button', { name: /New template/ }).click()
  let dlg = o.page.getByRole('dialog')
  await dlg.getByLabel('Name').fill(tplName)
  await dlg.getByLabel('Event key').fill('qa.event')
  await dlg.getByLabel('Message').fill('Hello {{employee.firstName}}')
  await dlg.getByRole('button', { name: 'Add template' }).click()
  await o.page.getByRole('row').filter({ hasText: tplName }).waitFor({ timeout: 15000 })
  check('templates: adds one', true)
  await o.page.getByRole('button', { name: `Edit template ${tplName}` }).click()
  dlg = o.page.getByRole('dialog')
  await dlg.getByLabel('Subject').fill('QA subject')
  await dlg.getByRole('button', { name: 'Save template' }).click()
  await o.page.getByRole('row').filter({ hasText: 'QA subject' }).waitFor({ timeout: 15000 }).catch(() => {})
  check('templates: edits it', (await o.page.getByRole('row').filter({ hasText: 'QA subject' }).count()) === 1)
  await o.page.getByRole('button', { name: `Delete template ${tplName}` }).click()
  await o.page.getByRole('alertdialog').or(o.page.getByRole('dialog')).getByRole('button', { name: 'Delete' }).click()
  await o.page.getByText('Template deleted', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  check('templates: deletes it', sql(`select count(*) from notiftemplate_mgmt.notification_templates where name='${tplName}'`) === '0')

  // ── Integrations ──
  await o.page.goto(base + '/hrms/integrations'); await settle(o.page)
  await o.page.getByLabel('Name').fill(intName)
  await o.page.getByLabel('Provider').fill('Slack')
  await o.page.getByRole('button', { name: 'Add', exact: true }).click()
  const row = o.page.getByRole('row').filter({ hasText: intName })
  await row.waitFor({ timeout: 15000 })
  check('integrations: adds one, with a real "Recorded" date', /\d{1,2} [A-Z][a-z]{2} \d{4}/.test(await row.innerText()))
  await row.getByRole('button', { name: 'Mark configured' }).click()
  await row.getByText('Marked configured', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  check('integrations: marks it configured', (await row.getByText('Marked configured', { exact: true }).count()) === 1)
  await row.getByRole('button', { name: /Remove Slack integration/ }).click()
  await o.page.getByRole('alertdialog').or(o.page.getByRole('dialog')).getByRole('button', { name: 'Remove' }).click()
  await o.page.getByText('Integration removed', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  check('integrations: removes it', sql(`select count(*) from integration_mgmt.integration_connections where name='${intName}'`) === '0')
  check('owner: no refused calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  if (removedRead) sql(`insert into rbac.role_permissions (role_id, permission_code) values ('${EMPLOYEE_ROLE}','hrms.policy.read') on conflict do nothing`)
  sql(`delete from notiftemplate_mgmt.notification_templates where name like 'QA template %'`)
  sql(`delete from integration_mgmt.integration_connections where name like 'QA integration %'`)
  check('cleanup: role restored and QA rows removed', sql(`select count(*) from rbac.role_permissions where role_id='${EMPLOYEE_ROLE}' and permission_code='hrms.policy.read'`) === '1')
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
