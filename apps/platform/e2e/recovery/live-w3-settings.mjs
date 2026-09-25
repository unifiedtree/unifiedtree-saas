// Live check of the settings split (wave 3):
//  - HRMS settings (/hrms/settings): one hub in the HRMS rail listing every HR
//    setting; each card opens the right page; its own pages sit under its tabs.
//  - Workspace settings open from the Apps page (and the profile menu), not from
//    inside a module; each workspace page opens; the HRMS tile links its settings.
//  - Every old address lands on the new home (?view= and #section kept).
//  - reader@ (EMPLOYEE) and mgr@ (DEPT_MANAGER) see only what they may use.
// It changes nothing (only opens pages), so there is nothing to clean up.
//
//   node e2e/recovery/live-w3-settings.mjs
//   env: RECOVERY_APP_URL (the live slot sets it), RECOVERY_PASSWORD, SHOTS_DIR
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3013'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// The local tenant has no platform.account_workspaces row, so the plan endpoint answers 403
// "isn't linked to this workspace"; Billing shows its load-error note for it (see live-design-settings).
const KNOWN = ['403 GET /v1/workspace/plan/current']

const browser = await chromium.launch()
async function session(email, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    const f = `${r.status()} ${r.request().method()} ${r.url().split('/api')[1].split('?')[0]}`
    if (!KNOWN.includes(f)) failed.push(f)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await settle(page)
  errors.length = 0; failed.length = 0
  const clean = () => { const out = [...errors, ...failed]; errors.length = 0; failed.length = 0; return out }
  return { ctx, page, clean }
}
async function settle(page) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
const h1 = (page, name) => page.getByRole('heading', { level: 1, name, exact: true })
const here = (page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash }
async function open(page, path) { await page.goto(base + path); await settle(page) }
async function tabs(page, label) { const nav = page.getByRole('navigation', { name: label }); return (await nav.count()) ? nav.locator('a').allInnerTexts() : [] }
const restricted = (page) => page.getByText('Access Restricted', { exact: true }).count()

try {
  // ═══ Owner ═══════════════════════════════════════════════════════════════
  const o = await session('owner@unifiedtree.demo')
  const p = o.page

  // ── Apps page: workspace settings entry + the HRMS tile's settings link ──
  await open(p, '/modules')
  await p.getByRole('heading', { name: 'Choose an app' }).waitFor({ timeout: 30_000 })
  const wsBtn = p.getByRole('button', { name: 'Workspace settings', exact: true })
  check('apps: a "Workspace settings" entry is shown', (await wsBtn.count()) === 1)
  const hrLink = p.getByRole('button', { name: /settings$/ }).filter({ hasText: /^\s*Settings\s*$/ })
  check('apps: the HR tile has a "Settings" link', (await hrLink.count()) === 1, `${await hrLink.count()} found`)
  await p.screenshot({ path: `${shots}/settings-modules-1440.png`, fullPage: true })
  const appsBad = o.clean()
  check('apps: no page errors or failed API calls', appsBad.length === 0, appsBad.slice(0, 3).join(' | '))

  await hrLink.first().click(); await settle(p)
  check('apps: the HR tile\'s Settings opens HRMS settings', here(p) === '/hrms/settings', here(p))
  await open(p, '/modules')
  await wsBtn.click(); await settle(p)
  check('apps: Workspace settings opens the workspace profile', here(p) === '/settings/profile', here(p))
  await h1(p, 'Workspace profile').waitFor({ timeout: 20_000 }).catch(() => {})
  await p.screenshot({ path: `${shots}/settings-workspace-1440.png` })

  // ── Workspace settings: its tabs, and each page opens ──
  const wsTabs = await tabs(p, 'Settings sections')
  const WANT = ['Workspace profile', 'Branding', 'Security', 'Notifications', 'Billing & Plan', 'Integrations', 'Users & Access', 'Audit Logs', 'Danger Zone']
  check('workspace: tabs are the workspace pages, in order', JSON.stringify(wsTabs) === JSON.stringify(WANT), wsTabs.join(', '))
  check('workspace: Roles and Document types are no longer workspace tabs', !wsTabs.some((t) => /Roles|Document/.test(t)))
  const WS = [
    ['/settings/profile', 'Workspace profile'], ['/settings/branding', 'Branding'], ['/settings/security', 'Security'], ['/settings/notifications', 'Notifications'],
    ['/settings/billing', 'Billing & Plan'], ['/settings/integrations', 'Integrations'], ['/users', 'Users & access'], ['/audit-logs', 'Audit logs'], ['/settings/danger', 'Danger Zone'],
  ]
  for (const [path, title] of WS) {
    o.clean()
    await open(p, path)
    await h1(p, title).waitFor({ timeout: 20_000 }).catch(() => {})
    const bad = o.clean()
    check(`workspace ${path}: opens ("${title}")`, (await h1(p, title).count()) === 1 && here(p) === path, here(p))
    check(`workspace ${path}: no page errors or failed API calls`, bad.length === 0, bad.slice(0, 3).join(' | '))
  }
  await open(p, '/settings/integrations')
  await p.getByRole('button', { name: 'Open the register' }).click(); await settle(p)
  check('workspace: Integrations → "Open the register" opens the integration register', here(p) === '/settings/integrations/register' && (await h1(p, 'Integrations').count()) === 1, here(p))
  const lit = await p.getByRole('navigation', { name: 'Settings sections' }).locator('a[aria-current=page]').allInnerTexts()
  check('workspace: the Integrations tab stays lit on the register', JSON.stringify(lit) === '["Integrations"]', lit.join(','))
  check('workspace: the register opens with no errors', o.clean().length === 0)

  // ── Inside HRMS: no workspace gear in the header; the rail's gear is HRMS settings ──
  await open(p, '/dashboard')
  check('shell: the header has no workspace "Settings" gear any more', (await p.locator('button[aria-label="Settings"]').count()) === 0 && (await p.getByRole('button', { name: 'All apps' }).count()) >= 1)
  const railHub = p.getByRole('navigation', { name: 'Primary' }).locator('button[title="HRMS settings"]')
  check('shell: the rail has one "HRMS settings" entry', (await railHub.count()) === 1)
  check('shell: "HR Setup" and a Payroll Settings tab are gone from the rail', (await p.getByRole('navigation', { name: 'Primary' }).locator('button[title="HR Setup"]').count()) === 0)
  await p.getByRole('button', { name: 'Account' }).first().click()
  const menuWs = p.getByRole('button', { name: 'Workspace settings' })
  check('shell: the profile menu offers "Workspace settings"', (await menuWs.count()) >= 1)
  await menuWs.first().click(); await settle(p)
  check('shell: it opens workspace settings', here(p) === '/settings/profile', here(p))

  // ── HRMS settings hub ──
  await open(p, '/dashboard')
  await railHub.click(); await settle(p)
  check('hub: the rail entry opens /hrms/settings', here(p) === '/hrms/settings', here(p))
  await h1(p, 'HRMS settings').waitFor({ timeout: 20_000 }).catch(() => {})
  check('hub: page renders', (await h1(p, 'HRMS settings').count()) === 1)
  const hubTabs = await tabs(p, 'HRMS settings sections')
  check('hub: its tabs are the hub pages', JSON.stringify(hubTabs) === JSON.stringify(['Overview', 'HR configuration', 'Payroll settings', 'Document types', 'Notification templates', 'Roles & permissions']), hubTabs.join(', '))
  const cards = await p.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))
  const CARDS = ['hr-config', 'late', 'week', 'shift-rules', 'punch-zones', 'leave-rules', 'holidays', 'payroll', 'components', 'statutory', 'document-types', 'policies', 'notifications', 'roles', 'access']
  check('hub: the owner sees every HR setting', CARDS.every((k) => cards.includes(k)) && cards.length === CARDS.length, cards.join(','))
  for (const g of ['Company rules', 'Attendance & shifts', 'Leave & holidays', 'Payroll', 'Documents & policies', 'Notifications', 'Roles & access']) check(`hub: group "${g}"`, (await p.getByRole('heading', { level: 2, name: g, exact: true }).count()) === 1)
  check('hub: no page errors or failed API calls', o.clean().length === 0)
  await p.screenshot({ path: `${shots}/settings-hub-1440.png`, fullPage: true })

  // Each card opens the right place.
  const DEST = {
    'hr-config': ['/hrms/settings/hr-configuration', 'HR Configuration'], late: ['/hrms/settings/hr-configuration#st-late', 'HR Configuration'], week: ['/hrms/settings/hr-configuration#st-week', 'HR Configuration'],
    'shift-rules': ['/hrms/master/shift-rules'], 'punch-zones': ['/hrms/companies'], 'leave-rules': ['/hrms/master/leave-rules'], holidays: ['/hrms/leave?tab=holidays'],
    payroll: ['/hrms/settings/payroll', 'Payroll Settings'], components: ['/hrms/payroll/components'], statutory: ['/hrms/master/statutory'],
    'document-types': ['/hrms/settings/document-types', 'Document types'], policies: ['/hrms/policies'], notifications: ['/hrms/settings/notifications', 'Notification templates'],
    roles: ['/hrms/settings/roles', 'Roles & permissions'], access: ['/hrms/settings/roles?view=assignments', 'Roles & permissions'],
  }
  for (const [key, [path, title]] of Object.entries(DEST)) {
    await open(p, '/hrms/settings'); o.clean()
    await p.locator(`[data-setting="${key}"]`).click(); await settle(p)
    if (title) await h1(p, title).waitFor({ timeout: 20_000 }).catch(() => {})
    const bad = o.clean()
    check(`hub card "${key}" opens ${path}`, here(p) === path && (!title || (await h1(p, title).count()) === 1), here(p))
    check(`hub card "${key}": no page errors or failed API calls`, bad.length === 0, bad.slice(0, 3).join(' | '))
  }
  // The in-hub pages keep the hub's tabs, with the right one lit.
  for (const [path, tab] of [['/hrms/settings/hr-configuration', 'HR configuration'], ['/hrms/settings/payroll', 'Payroll settings'], ['/hrms/settings/document-types', 'Document types'], ['/hrms/settings/notifications', 'Notification templates'], ['/hrms/settings/roles', 'Roles & permissions']]) {
    await open(p, path)
    const on = await p.getByRole('navigation', { name: 'HRMS settings sections' }).locator('a[aria-current=page]').allInnerTexts()
    check(`hub ${path}: the "${tab}" tab is lit`, JSON.stringify(on) === JSON.stringify([tab]), on.join(','))
  }
  check('hub payroll: shown without the payroll section bar', await (async () => { await open(p, '/hrms/settings/payroll'); return (await p.getByRole('navigation', { name: 'Payroll sections' }).count()) === 0 })())
  await open(p, '/hrms/settings/roles?view=assignments')
  check('hub: HRMS access opens "Who has which role"', (await p.getByRole('group', { name: 'Role views' }).getByRole('button', { name: 'Who has which role' }).getAttribute('aria-pressed')) === 'true')

  // Payroll's own section bar: its Payroll Settings tab leads to the hub.
  await open(p, '/hrms/payroll-dashboard')
  const payTab = p.getByRole('navigation', { name: 'Payroll sections' }).getByRole('button', { name: 'Payroll Settings' })
  if (await payTab.count()) { await payTab.click(); await settle(p); check('payroll: the section bar\'s Payroll Settings opens HRMS settings', here(p) === '/hrms/settings/payroll', here(p)) }
  else check('payroll: the section bar has a Payroll Settings tab', false)

  // ── Old addresses land on the new home ──
  const OLD = [
    ['/hrms/settings/work-time', '/hrms/settings/hr-configuration#st-week'], ['/hrms/payroll/settings', '/hrms/settings/payroll'],
    ['/hrms/notification-templates', '/hrms/settings/notifications'], ['/hrms/integrations', '/settings/integrations/register'],
    ['/settings/documents', '/hrms/settings/document-types'], ['/roles', '/hrms/settings/roles'], ['/roles?view=catalogue', '/hrms/settings/roles?view=catalogue'],
    ['/settings', '/settings/profile'], ['/settings/profile', '/settings/profile'], ['/settings/branding', '/settings/branding'], ['/settings/security', '/settings/security'],
    ['/settings/notifications', '/settings/notifications'], ['/settings/billing', '/settings/billing'], ['/settings/integrations', '/settings/integrations'],
    ['/settings/danger', '/settings/danger'], ['/users', '/users'], ['/audit-logs', '/audit-logs'], ['/hrms/settings', '/hrms/settings'], ['/profile', '/profile'],
  ]
  for (const [from, to] of OLD) {
    o.clean()
    await open(p, from)
    const bad = o.clean()
    check(`old ${from} → ${to}`, here(p) === to && (await restricted(p)) === 0 && bad.length === 0, `${here(p)}${bad.length ? ' · ' + bad[0] : ''}`)
  }
  await open(p, '/hrms/settings/work-time')
  await p.getByRole('heading', { level: 2, name: 'Work week', exact: true }).waitFor({ timeout: 20_000 }).catch(() => {}); await p.waitForTimeout(800)
  const weekTop = await p.getByRole('heading', { level: 2, name: 'Work week', exact: true }).evaluate((el) => el.getBoundingClientRect().top).catch(() => 9999)
  check('old /hrms/settings/work-time opens at the Work week section', weekTop < 320, `top=${Math.round(weekTop)}`)
  await open(p, '/roles?view=catalogue')
  check('old /roles?view=catalogue keeps its view', (await p.getByRole('group', { name: 'Role views' }).getByRole('button', { name: 'Permission catalogue' }).getAttribute('aria-pressed')) === 'true')
  await o.ctx.close()

  // ── Phone width ──
  const m = await session('owner@unifiedtree.demo', 390)
  for (const [path, name] of [['/modules', 'modules'], ['/hrms/settings', 'hub'], ['/settings/profile', 'workspace']]) {
    await open(m.page, path)
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`phone ${path}: no sideways scroll`, overflow <= 1, `overflow=${overflow}`)
    await m.page.screenshot({ path: `${shots}/settings-${name}-390.png`, fullPage: true })
  }
  check('phone /modules: Workspace settings entry is shown', await (async () => { await open(m.page, '/modules'); return (await m.page.getByRole('button', { name: 'Workspace settings', exact: true }).isVisible()) })())
  check('phone: no page errors or failed API calls', m.clean().length === 0)
  await m.ctx.close()

  // ═══ reader@ (EMPLOYEE) ══════════════════════════════════════════════════
  const r = await session('reader@unifiedtree.demo')
  await open(r.page, '/modules')
  check('reader: no Settings link on the HR tile', (await r.page.getByRole('button', { name: /settings$/ }).filter({ hasText: /^\s*Settings\s*$/ }).count()) === 0)
  const rWs = r.page.getByRole('button', { name: 'Workspace settings', exact: true })
  check('reader: Workspace settings is offered (their own security)', (await rWs.count()) === 1)
  await rWs.click(); await settle(r.page)
  check('reader: it opens Security, the one page they can use', here(r.page) === '/settings/security' && (await h1(r.page, 'Security').count()) === 1 && (await restricted(r.page)) === 0, here(r.page))
  const rTabs = await tabs(r.page, 'Settings sections')
  check('reader: workspace tabs show only Security', rTabs.length === 0 || JSON.stringify(rTabs) === '["Security"]', rTabs.join(','))
  await open(r.page, '/me')
  check('reader: no HRMS settings in the menu', (await r.page.locator('button[title="HRMS settings"]').count()) === 0 && (await r.page.getByRole('button', { name: 'HRMS settings' }).count()) === 0)
  await open(r.page, '/hrms/settings')
  check('reader: the hub lists nothing ("No HR settings for your role")', (await r.page.getByText('No HR settings for your role').count()) === 1 && (await r.page.locator('[data-setting]').count()) === 0)
  for (const path of ['/hrms/settings/hr-configuration', '/hrms/settings/payroll', '/hrms/settings/notifications', '/hrms/settings/roles', '/hrms/settings/document-types', '/roles', '/settings/profile', '/settings/integrations/register']) {
    await open(r.page, path)
    check(`reader: ${path} is not open`, (await restricted(r.page)) === 1 || (await r.page.getByText(/not activated/i).count()) > 0, here(r.page))
  }
  await open(r.page, '/settings')
  check('reader: /settings opens Security, not a refusal', here(r.page) === '/settings/security' && (await restricted(r.page)) === 0, here(r.page))
  check('reader: no page errors', r.clean().filter((e) => !/^\d{3} /.test(e)).length === 0)
  await r.ctx.close()

  // ═══ mgr@ (DEPT_MANAGER) ═════════════════════════════════════════════════
  const g = await session('mgr@unifiedtree.demo')
  await open(g.page, '/modules')
  check('manager: no Settings link on the HR tile', (await g.page.getByRole('button', { name: /settings$/ }).filter({ hasText: /^\s*Settings\s*$/ }).count()) === 0)
  await open(g.page, '/dashboard')
  check('manager: no HRMS settings in the rail', (await g.page.locator('nav[aria-label="Primary"] button[title="HRMS settings"]').count()) === 0)
  await open(g.page, '/hrms/settings')
  check('manager: the hub lists nothing', (await g.page.locator('[data-setting]').count()) === 0)
  await open(g.page, '/settings')
  check('manager: workspace settings open at Security', here(g.page) === '/settings/security', here(g.page))
  const gTabs = await tabs(g.page, 'Settings sections')
  check('manager: workspace tabs show only Security', gTabs.length === 0 || JSON.stringify(gTabs) === '["Security"]', gTabs.join(','))
  for (const path of ['/hrms/settings/roles', '/hrms/settings/payroll', '/users']) {
    await open(g.page, path)
    check(`manager: ${path} is not open`, (await restricted(g.page)) === 1 || (await g.page.getByText('Access restricted').count()) > 0, here(g.page))
  }
  await g.ctx.close()

  // ═══ fin@ (FINANCE_LEAD): payroll settings, not roles ════════════════════
  const f = await session('fin@unifiedtree.demo')
  await open(f.page, '/hrms/settings')
  const finCards = await f.page.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))
  check('finance: the hub offers payroll settings and HR configuration, not roles', finCards.includes('payroll') && finCards.includes('hr-config') && !finCards.includes('roles') && !finCards.includes('notifications'), finCards.join(','))
  await open(f.page, '/hrms/settings/payroll')
  check('finance: Payroll settings open in the hub', (await h1(f.page, 'Payroll Settings').count()) === 1 && f.clean().length === 0)
  await f.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
