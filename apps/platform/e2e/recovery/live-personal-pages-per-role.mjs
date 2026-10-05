/* global URL, console, document, fetch, process, window */
// Personal pages per role (V143.90). The owner decided on 5 Oct 2026: "admin also should lose tabs, but the
// role and permissions should be given for the owner to keep or remove". By default nothing changes (the
// roles that run the workspace don't see My work and the other "My …" pages); the owner switches them on or
// off per role in Roles & permissions, and people see it at their next sign-in or page reload.
//
// Browser and API acceptance, against the demo workspace:
//  - The sign-in answer carries personalPages: false for admin@ (SUPER_ADMIN) and the owner, true for staff.
//  - Owner: Roles & permissions › Super Admin has the "Personal pages" switch, off by default; turning it on
//    is saved for the role.
//  - admin@ (signed in before the change) reloads: My work is in the rail, Expenses opens My claims, search
//    offers My claims. The owner turns it off again: after a reload it is all gone.
//  - The built-in Admin role can be switched too (API), and back.
//  - The employee keeps their personal pages throughout. admin@ (Roles page access, not the owner) sees the
//    switch read-only and is refused a change; an HR manager is refused too.
//  - Every setting the test touched is put back as it found it (switching a role back to its default
//    removes its row), even when a check fails.
// Screenshots at 1440 and 390 wide go to SHOTS.
//
// Run from apps/platform:  node e2e/recovery/live-personal-pages-per-role.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3002), RECOVERY_API_URL (default http://127.0.0.1:8080/api),
//        RECOVERY_PASSWORD, SHOTS
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
// Node can't resolve demo.localhost, so API calls go straight to the backend, naming the workspace.
const apiBase = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const SUB = new URL(base).hostname.split('.')[0]

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
const bare = (t) => clean(t).replace(/\s+\d+$/, '')

mkdirSync(shots, { recursive: true })

// ── API (the backend, as the web app's /api proxy reaches it) ───────────────────
async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(apiBase + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Subdomain': SUB, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
let tenantId = null
async function login(email) {
  if (!tenantId) tenantId = (await api('/v1/public/workspace-status')).json?.tenantId
  const r = await api('/v1/canonical-auth/login', { method: 'POST', body: { tenantId, email, password } })
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`)
  return r.json
}

// ── Browser ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true })

async function signIn(email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}

async function viewsAt(page, path, label) {
  await page.goto(base + path)
  const bar = page.locator(`[role=group][aria-label="${label}"], [role=tablist][aria-label="${label}"]`).first()
  await Promise.race([
    bar.waitFor({ timeout: 45_000 }),
    page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45_000 }),
  ]).catch(() => {})
  await settle(page)
  if (!(await bar.count())) return { tabs: [], selected: '' }
  const tabs = (await bar.locator('button, [role=tab]').allInnerTexts()).map(bare)
  const selected = bare(await bar.locator('button[aria-pressed=true], [role=tab][aria-selected=true]').first().innerText().catch(() => ''))
  return { tabs, selected }
}

async function search(page, text) {
  await page.keyboard.press('Control+k')
  const input = page.locator('input[aria-controls="top-search-results"]')
  await input.waitFor({ timeout: 10_000 })
  await input.fill(text)
  await page.locator('#top-search-results [role=option], #top-search-results [role=status]').first().waitFor({ timeout: 10_000 }).catch(() => {})
  await page.getByTestId('top-search-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(700)
  const rows = await page.locator('#top-search-results [role=option]').allInnerTexts()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  return rows.map(clean)
}

const myWork = (page) => page.locator('nav[aria-label="Primary"] [role=group][aria-label="My work"]')
const has = (list, re) => list.some((t) => re.test(t))
const show = (v) => `selected="${v.selected}" tabs=[${v.tabs.join(', ')}]`

/** Open Roles & permissions › the role with this code; returns its Personal pages switch. */
async function openRole(page, code) {
  await page.goto(base + '/roles')
  const row = page.locator('tr').filter({ has: page.getByText(code, { exact: true }) }).first()
  await row.waitFor({ timeout: 45_000 })
  await settle(page)
  await row.click()
  const sw = page.getByRole('switch', { name: /Personal pages/ })
  await sw.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
  return sw
}

/** What admin@ sees: the My work group, Expenses' My claims, search's My claims. */
async function adminSees(page) {
  await page.reload()
  await settle(page)
  const rail = (await myWork(page).count()) > 0
  const v = await viewsAt(page, '/hrms/expenses?tab=my', 'Expense views')
  const rows = await search(page, 'my claims')
  return { rail, claims: has(v.tabs, /^My claims$/) && v.selected === 'My claims', search: has(rows, /\bMy (expense )?claims\b/i), v }
}

// Settings to restore: roleId -> enabled as found.
const found = new Map()
let ownerToken = null

try {
  const owner = await login('owner@unifiedtree.demo')
  ownerToken = owner.accessToken
  const admin = await login('admin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')

  // ── The sign-in answer ──
  check('sign-in: the owner gets personalPages=false (default)', owner.personalPages === false, `got ${owner.personalPages}`)
  check('sign-in: admin@ (Super Admin) gets personalPages=false (default)', admin.personalPages === false, `got ${admin.personalPages} roles=${admin.roles}`)
  check('sign-in: the employee gets personalPages=true', reader.personalPages === true, `got ${reader.personalPages}`)
  check('sign-in: the HR manager gets personalPages=true', hrm.personalPages === true, `got ${hrm.personalPages}`)
  const me = await api('/v1/canonical-auth/me', { token: reader.accessToken })
  check('/me carries personalPages', me.status === 200 && me.json?.personalPages === true, `status ${me.status} value ${me.json?.personalPages}`)

  // ── The settings list ──
  const list = await api('/v1/rbac/personal-pages', { token: ownerToken })
  check('owner: GET /v1/rbac/personal-pages answers, editable, saving works', list.status === 200 && list.json?.canEdit === true && list.json?.ready === true, `status ${list.status} canEdit=${list.json?.canEdit} ready=${list.json?.ready}`)
  const roles = list.json?.roles ?? []
  const byCode = (c) => roles.find((r) => r.code === c)
  const superAdmin = byCode('SUPER_ADMIN'), adminRole = byCode('ADMIN'), employee = byCode('EMPLOYEE'), ownerRole = byCode('OWNER')
  for (const r of [superAdmin, adminRole, employee, ownerRole].filter(Boolean)) found.set(r.roleId, r.enabled)
  check('defaults: Owner, Super Admin and Admin off; Employee on', ownerRole?.enabled === false && superAdmin?.enabled === false && adminRole?.enabled === false && employee?.enabled === true
    && !ownerRole?.overridden && !superAdmin?.overridden && !adminRole?.overridden && !employee?.overridden,
  roles.map((r) => `${r.code}=${r.enabled}${r.overridden ? '*' : ''}`).join(' '))
  check('the list has no platform roles', !roles.some((r) => r.code.startsWith('PLATFORM_')))
  const asAdmin = await api('/v1/rbac/personal-pages', { token: admin.accessToken })
  check('admin@ (Roles page access) may read it but not change it', asAdmin.status === 200 && asAdmin.json?.canEdit === false, `status ${asAdmin.status} canEdit=${asAdmin.json?.canEdit}`)

  // ── Only the owner changes it ──
  const byHr = await api(`/v1/rbac/personal-pages/${superAdmin.roleId}`, { token: hrm.accessToken, method: 'PUT', body: { enabled: true } })
  check('HR manager can’t change it (403)', byHr.status === 403, `status ${byHr.status}`)
  const byAdmin = await api(`/v1/rbac/personal-pages/${superAdmin.roleId}`, { token: admin.accessToken, method: 'PUT', body: { enabled: true } })
  check('admin@ can’t change it either (403, owner only)', byAdmin.status === 403 && byAdmin.json?.errorCode === 'OWNER_ONLY', `status ${byAdmin.status} ${byAdmin.json?.errorCode}`)
  const byReader = await api(`/v1/rbac/personal-pages/${employee.roleId}`, { token: reader.accessToken, method: 'PUT', body: { enabled: false } })
  check('the employee can’t change it (403)', byReader.status === 403, `status ${byReader.status}`)
  const after = (await api('/v1/rbac/personal-pages', { token: ownerToken })).json?.roles ?? []
  check('nothing changed after the refusals', roles.every((r) => {
    const x = after.find((y) => y.roleId === r.roleId)
    return x && x.enabled === r.enabled && x.overridden === r.overridden
  }), after.filter((r) => r.overridden).map((r) => r.code).join(', '))

  // ── admin@ before: none of it ──
  const a = await signIn('admin@unifiedtree.demo')
  let seen = await adminSees(a.page)
  check('admin@ before: no My work, no My claims, search doesn’t offer it', !seen.rail && !seen.claims && !seen.search, `rail=${seen.rail} claims=${seen.claims} search=${seen.search} ${show(seen.v)}`)
  await a.page.screenshot({ path: `${shots}/w22-admin-before-expenses-1440.png` })
  {
    const p = await signIn('admin@unifiedtree.demo', { width: 390, height: 844 })
    const v = await viewsAt(p.page, '/hrms/expenses?tab=my', 'Expense views')
    check('admin@ (phone) before: Expenses has no My claims', !has(v.tabs, /^My claims$/), show(v))
    await p.page.screenshot({ path: `${shots}/w22-admin-before-expenses-390.png` })
    await p.ctx.close()
  }

  // admin@ sees the switch read-only.
  const roSwitch = await openRole(a.page, 'SUPER_ADMIN')
  check('admin@: the switch is there, read-only, with why', (await roSwitch.isDisabled()) && (await a.page.getByText('Only the workspace owner can change this.').count()) > 0)
  await a.page.screenshot({ path: `${shots}/w22-roles-switch-readonly-1440.png` })
  await a.page.keyboard.press('Escape')

  // ── The owner turns it on for Super Admin in Roles & permissions ──
  const o = await signIn('owner@unifiedtree.demo')
  const sw = await openRole(o.page, 'SUPER_ADMIN')
  check('owner: Super Admin has the Personal pages switch, off by default', (await sw.getAttribute('aria-checked')) === 'false' && !(await sw.isDisabled()))
  check('owner: the switch notes the default and when it applies',
    (await o.page.getByText(/Off by default for Owner and Admin roles/).count()) > 0 && (await o.page.getByText(/next sign-in or page reload/).count()) > 0)
  await o.page.screenshot({ path: `${shots}/w22-roles-switch-off-1440.png` })
  const [saved] = await Promise.all([
    o.page.waitForResponse((r) => r.url().includes('/v1/rbac/personal-pages/') && r.request().method() === 'PUT', { timeout: 20_000 }),
    sw.click(),
  ])
  check('owner: switching it on is saved', saved.status() === 200, `status ${saved.status()}`)
  await o.page.waitForTimeout(1200)
  check('owner: the switch now reads on', (await sw.getAttribute('aria-checked')) === 'true')
  await o.page.screenshot({ path: `${shots}/w22-roles-switch-on-1440.png` })
  const sa = (await api('/v1/rbac/personal-pages', { token: ownerToken })).json?.roles?.find((r) => r.code === 'SUPER_ADMIN')
  check('the server has Super Admin on, changed by the owner', sa?.enabled === true && sa?.overridden === true)

  // ── admin@ reloads: My work and My claims ──
  seen = await adminSees(a.page)
  check('admin@ after a reload: My work is in the rail', seen.rail)
  check('admin@ after a reload: Expenses opens My claims', seen.claims, show(seen.v))
  check('admin@ after a reload: search offers My claims', seen.search)
  await a.page.screenshot({ path: `${shots}/w22-admin-after-expenses-1440.png` })
  const signedInAgain = await login('admin@unifiedtree.demo')
  check('admin@ signing in again gets personalPages=true', signedInAgain.personalPages === true)
  {
    const p = await signIn('admin@unifiedtree.demo', { width: 390, height: 844 })
    const v = await viewsAt(p.page, '/hrms/expenses?tab=my', 'Expense views')
    check('admin@ (phone): Expenses opens My claims', v.selected === 'My claims', show(v))
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('admin@ (phone): no sideways page scroll', overflow <= 1, `${overflow}px`)
    await p.page.screenshot({ path: `${shots}/w22-admin-after-expenses-390.png` })
    await p.ctx.close()
  }
  {
    const p = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    await openRole(p.page, 'SUPER_ADMIN')
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('owner (phone): the role drawer has no sideways page scroll', overflow <= 1, `${overflow}px`)
    await p.page.screenshot({ path: `${shots}/w22-roles-switch-on-390.png` })
    await p.ctx.close()
  }

  // ── The employee is unaffected ──
  {
    const e = await signIn('reader@unifiedtree.demo')
    const v = await viewsAt(e.page, '/hrms/expenses?tab=my', 'Expense views')
    check('employee: still has My work and My claims', (await myWork(e.page).count()) > 0 && v.selected === 'My claims', show(v))
    check('employee: no page errors', e.errors.length === 0, e.errors.slice(0, 3).join(' | '))
    await e.ctx.close()
  }

  // ── The owner turns it off again: gone after a reload ──
  const [off] = await Promise.all([
    o.page.waitForResponse((r) => r.url().includes('/v1/rbac/personal-pages/') && r.request().method() === 'PUT', { timeout: 20_000 }),
    sw.click(),
  ])
  check('owner: switching it off is saved', off.status() === 200, `status ${off.status()}`)
  const back = (await api('/v1/rbac/personal-pages', { token: ownerToken })).json?.roles?.find((r) => r.code === 'SUPER_ADMIN')
  check('Super Admin is back on its default (no override kept)', back?.enabled === false && back?.overridden === false)
  seen = await adminSees(a.page)
  check('admin@ after the next reload: no My work, no My claims, search doesn’t offer it', !seen.rail && !seen.claims && !seen.search, `rail=${seen.rail} claims=${seen.claims} search=${seen.search} ${show(seen.v)}`)

  // ── The built-in Admin role too (API) ──
  const on = await api(`/v1/rbac/personal-pages/${adminRole.roleId}`, { token: ownerToken, method: 'PUT', body: { enabled: true } })
  check('owner: Admin role on', on.status === 200 && on.json?.enabled === true && on.json?.overridden === true, `status ${on.status}`)
  const offAgain = await api(`/v1/rbac/personal-pages/${adminRole.roleId}`, { token: ownerToken, method: 'PUT', body: { enabled: false } })
  check('owner: Admin role back off (its default)', offAgain.status === 200 && offAgain.json?.enabled === false && offAgain.json?.overridden === false, `status ${offAgain.status}`)
  const missing = await api('/v1/rbac/personal-pages/00000000-0000-0000-0000-0000000000ff', { token: ownerToken, method: 'PUT', body: { enabled: true } })
  check('an unknown role is not found', missing.status === 404, `status ${missing.status}`)

  check('owner: no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '))
  check('owner: no failed API calls', o.failedApi.length === 0, o.failedApi.slice(0, 4).join(' | '))
  check('admin@: no page errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | '))
  check('admin@: no failed API calls', a.failedApi.length === 0, a.failedApi.slice(0, 4).join(' | '))
  await o.ctx.close()
  await a.ctx.close()
} catch (e) {
  check('scenario completed without an exception', false, String(e).split('\n')[0])
} finally {
  // Put back every setting the test touched (the default removes the row).
  if (ownerToken) {
    const now = (await api('/v1/rbac/personal-pages', { token: ownerToken }).catch(() => ({ json: null }))).json?.roles ?? []
    for (const [roleId, enabled] of found) {
      const r = now.find((x) => x.roleId === roleId)
      if (r && r.enabled !== enabled) await api(`/v1/rbac/personal-pages/${roleId}`, { token: ownerToken, method: 'PUT', body: { enabled } }).catch(() => {})
    }
    const final = (await api('/v1/rbac/personal-pages', { token: ownerToken }).catch(() => ({ json: null }))).json?.roles ?? []
    check('cleanup: every touched role is as the test found it', [...found].every(([id, en]) => final.find((x) => x.roleId === id)?.enabled === en))
  }
  await browser.close()
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
