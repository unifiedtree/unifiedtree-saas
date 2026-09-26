// Live check of the redesigned Users & access, Roles & permissions and Audit
// logs pages (owner):
//  - Users: tiles, filter views, search, and granting / removing a temporary
//    custom role from the access drawer.
//  - Roles: a built-in role's permissions are read-only; the catalogue view
//    stays in ?view= and its search narrows the list.
//  - Audit logs: From = To = today now includes today's events (the "to"
//    date used to stop at that day's UTC midnight); "Export this page"
//    downloads a CSV.
// No refused API calls or page errors. The temporary role is removed.
//
//   node e2e/recovery/live-design-access.mjs
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// The From / To filters use the shared calendar: open it, then pick year, month and day.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
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
const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) })
const token = (await login.json()).accessToken
const request = async (path, method = 'GET', body) => { const r = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return t ? JSON.parse(t) : null }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const errors = [], failed = []
page.on('pageerror', (e) => errors.push(String(e.message || e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
let role = null
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0

  // ── Users ──
  const qa = Date.now()
  role = await request('/v1/rbac/roles', 'POST', { code: `QA_ACCESS_${qa}`, displayName: `Local access QA ${qa}`, description: 'Temporary; removed by the test' })
  await page.goto(base + '/users'); await settle()
  for (const t of ['Members', 'Active', 'Invited', 'No access yet']) check(`users: "${t}" tile`, (await page.getByText(t, { exact: true }).count()) > 0)
  await page.locator('[aria-label="User filters"]').getByRole('button', { name: /^Active/ }).click()
  check('users: the Active filter shows only active people', (await page.getByRole('row').filter({ hasText: 'Invited' }).count()) === 0)
  await page.locator('[aria-label="User filters"]').getByRole('button', { name: /^Everyone/ }).click()
  await page.getByPlaceholder('Search by name or email').fill('reader@')
  check('users: search narrows the list', (await page.getByRole('row').count()) === 2)
  await page.getByRole('row').filter({ hasText: 'reader@unifiedtree.demo' }).getByRole('button', { name: 'Manage access' }).click()
  const toggle = page.getByText(role.displayName, { exact: true }).locator('..').getByRole('switch')
  await toggle.click()
  await page.waitForTimeout(1200)
  check('users: grants a role from the drawer', (await toggle.getAttribute('aria-checked')) === 'true')
  await toggle.click()
  await page.waitForTimeout(1200)
  check('users: removes it again', (await toggle.getAttribute('aria-checked')) === 'false')
  await page.keyboard.press('Escape')

  // ── Roles ──
  await page.goto(base + '/roles'); await settle()
  check('roles: tiles and views', (await page.getByText('Built-in', { exact: true }).count()) === 1 && (await page.locator('[aria-label="Role views"]').count()) === 1)
  await page.getByRole('button', { name: /^View permissions for / }).first().click()
  check('roles: a built-in role is read-only', (await page.getByText(/System role permissions are fixed/).count()) === 1 && (await page.getByRole('button', { name: 'Save permissions', exact: true }).count()) === 0)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.locator('[aria-label="Role views"]').getByRole('button', { name: /^Permission catalogue/ }).click(); await settle()
  check('roles: the catalogue view is kept in the URL', page.url().includes('view=catalogue'))
  const before = await page.locator('table tbody tr').count()
  await page.getByLabel('Search permissions').fill('hrms.policy.')
  await page.waitForTimeout(400)
  const after = await page.locator('table tbody tr').count()
  check('roles: catalogue search narrows the list', after > 0 && after < before, `${before} → ${after}`)

  // ── Audit logs ──
  // The day of the latest event, in local time (there may be none today).
  const all = await request('/v1/audit/events?page=0&size=1')
  const latest = all?.data?.[0]?.occurredAt
  const today = latest ? localIso(new Date(latest)) : localIso(new Date())
  await page.goto(base + '/audit-logs'); await settle()
  await pickDate(page, page.getByLabel('From'), today)
  await pickDate(page, page.getByLabel('To'), today)
  await settle()
  const note = await page.getByText(/events? match these filters|event match these filters/).first().innerText().catch(() => '')
  const n = Number((note.match(/^([\d,]+)/)?.[1] || '0').replace(/,/g, ''))
  const startIso = new Date(`${today}T00:00`).toISOString(), endIso = new Date(new Date(`${today}T00:00`).getTime() + 864e5).toISOString()
  const direct = await request(`/v1/audit/events?page=0&size=1&from=${encodeURIComponent(startIso)}&to=${encodeURIComponent(endIso)}`)
  check('audit: From = To = one day covers that whole local day', n === (direct?.meta?.total ?? -1) && n > 0, `page=${n} api=${direct?.meta?.total} all=${all?.meta?.total}`)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export this page/ }).click()
  const dl = await downloading
  check('audit: exports this page as CSV', /^audit-log-\d{4}-\d{2}-\d{2}-page1\.csv$/.test(dl.suggestedFilename()) && !(await dl.failure()), dl.suggestedFilename())
  await page.locator('table tbody tr').first().click()
  check('audit: a row opens its details', (await page.getByRole('dialog').getByText('Event ID', { exact: true }).count()) === 1)
  check('no refused API calls or page errors', !failed.length && !errors.length, failed[0] || errors[0] || '')
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  if (role?.id) await request(`/v1/rbac/roles/${role.id}`, 'DELETE').catch(() => {})
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
