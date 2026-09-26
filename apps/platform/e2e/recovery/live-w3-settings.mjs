// Live check of the settings split (wave 3):
//  - HRMS settings (/hrms/settings): one hub in the HRMS rail holding every HR
//    setting; each card opens the right page; the settings pages (Master data's
//    rules and payroll configuration, expense policies too) sit under its tabs,
//    and the old entry points (Master's, Payroll's and Expenses' tabs) lead there.
//    Unsaved payroll settings are guarded when a hub tab is clicked (discarded).
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
/** The hub's pages, in tab order, with their tab labels. */
const HUB_TABS = [
  ['/hrms/settings', 'Overview'], ['/hrms/settings/hr-configuration', 'HR configuration'], ['/hrms/settings/shift-rules', 'Shifts'], ['/hrms/settings/leave-rules', 'Leave'],
  ['/hrms/settings/payroll', 'Payroll'], ['/hrms/settings/salary-components', 'Components'], ['/hrms/settings/statutory', 'Statutory'], ['/hrms/settings/expense-policies', 'Expenses'],
  ['/hrms/settings/document-types', 'Documents'], ['/hrms/settings/policies', 'Policies'], ['/hrms/settings/notifications', 'Notifications'], ['/hrms/settings/roles', 'Roles & permissions'],
]

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
  check('hub: its tabs are every hub page, in order', JSON.stringify(hubTabs) === JSON.stringify(HUB_TABS.map(([, t]) => t)), hubTabs.join(', '))
  const hubRow = await p.getByRole('navigation', { name: 'HRMS settings sections' }).locator('div').first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth })).catch(() => null)
  check('hub: every tab fits one row at 1440 (nothing hidden off the side)', !!hubRow && hubRow.sw <= hubRow.cw, `scrollWidth=${hubRow?.sw} clientWidth=${hubRow?.cw}`)
  const cards = await p.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))
  const CARDS = ['hr-config', 'late', 'week', 'shift-rules', 'punch-zones', 'leave-rules', 'holidays', 'payroll', 'components', 'statutory', 'expense-policies', 'document-types', 'policies', 'notifications', 'roles', 'access']
  check('hub: the owner sees every HR setting', CARDS.every((k) => cards.includes(k)) && cards.length === CARDS.length, cards.join(','))
  for (const g of ['Company rules', 'Attendance & shifts', 'Leave & holidays', 'Payroll', 'Expenses', 'Documents & policies', 'Notifications', 'Roles & access']) check(`hub: group "${g}"`, (await p.getByRole('heading', { level: 2, name: g, exact: true }).count()) === 1)
  check('hub: only Holidays and Punch zones say they open elsewhere', (await p.getByText(/^Opens in /).count()) === 2)
  check('hub: no page errors or failed API calls', o.clean().length === 0)
  await p.screenshot({ path: `${shots}/settings-hub-1440.png`, fullPage: true })

  // Each card opens the right place.
  const DEST = {
    'hr-config': ['/hrms/settings/hr-configuration', 'HR Configuration'], late: ['/hrms/settings/hr-configuration#st-late', 'HR Configuration'], week: ['/hrms/settings/hr-configuration#st-week', 'HR Configuration'],
    'shift-rules': ['/hrms/settings/shift-rules', 'Shift Rules'], 'punch-zones': ['/hrms/companies'], 'leave-rules': ['/hrms/settings/leave-rules', 'Leave Rules'], holidays: ['/hrms/leave?tab=holidays'],
    payroll: ['/hrms/settings/payroll', 'Payroll Settings'], components: ['/hrms/settings/salary-components', 'Salary Components'], statutory: ['/hrms/settings/statutory', 'Statutory Settings'],
    'expense-policies': ['/hrms/settings/expense-policies', 'Expense policies'],
    'document-types': ['/hrms/settings/document-types', 'Document types'], policies: ['/hrms/settings/policies', 'Policy Documents'], notifications: ['/hrms/settings/notifications', 'Notification templates'],
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
  for (const [path, tab] of HUB_TABS.slice(1)) {
    await open(p, path)
    const on = await p.getByRole('navigation', { name: 'HRMS settings sections' }).locator('a[aria-current=page]').allInnerTexts()
    check(`hub ${path}: the "${tab}" tab is lit`, JSON.stringify(on) === JSON.stringify([tab]), on.join(','))
  }
  check('hub payroll: shown without the payroll section bar', await (async () => { await open(p, '/hrms/settings/payroll'); return (await p.getByRole('navigation', { name: 'Payroll sections' }).count()) === 0 })())
  await open(p, '/hrms/settings/roles?view=assignments')
  check('hub: HRMS access opens "Who has which role"', (await p.getByRole('group', { name: 'Role views' }).getByRole('button', { name: 'Who has which role' }).getAttribute('aria-pressed')) === 'true')

  // Master data's sections inside the hub: the hub's tabs, not Master's tabs or crumbs.
  for (const path of ['/hrms/settings/shift-rules', '/hrms/settings/leave-rules', '/hrms/settings/salary-components', '/hrms/settings/statutory', '/hrms/settings/policies']) {
    await open(p, path)
    const masterTabs = await p.getByRole('navigation', { name: 'Master sections' }).count()
    const crumbs = await p.locator('.utm .crumbs').first().isVisible().catch(() => false)
    const segs = await p.locator('.utm .hero-tabs').first().isVisible().catch(() => false)
    check(`hub ${path}: no Master tabs, crumbs or section switch`, masterTabs === 0 && !crumbs && !segs, `tabs=${masterTabs} crumbs=${crumbs} seg=${segs}`)
  }
  await open(p, '/hrms/settings/shift-rules')
  await p.screenshot({ path: `${shots}/settings-shiftrules-1440.png`, fullPage: true })
  await open(p, '/hrms/settings/expense-policies')
  await p.screenshot({ path: `${shots}/settings-expense-1440.png`, fullPage: true })

  // Master data's own tabs lead into the hub.
  await open(p, '/hrms/master')
  const masterNav = p.getByRole('navigation', { name: 'Master sections' })
  check('master: its tabs still offer Rules & Policies and Payroll Configuration', (await masterNav.getByRole('button', { name: 'Rules & Policies' }).count()) === 1 && (await masterNav.getByRole('button', { name: 'Payroll Configuration' }).count()) === 1)
  await masterNav.getByRole('button', { name: 'Rules & Policies' }).click(); await settle(p)
  check('master: Rules & Policies opens Shift rules in HRMS settings', here(p) === '/hrms/settings/shift-rules', here(p))
  await open(p, '/hrms/master')
  await masterNav.getByRole('button', { name: 'Payroll Configuration' }).click(); await settle(p)
  check('master: Payroll Configuration opens Salary components in HRMS settings', here(p) === '/hrms/settings/salary-components', here(p))
  await open(p, '/hrms/master/departments')
  check('master: other sections stay in Master data', (await p.getByRole('navigation', { name: 'Master sections' }).count()) === 1 && here(p) === '/hrms/master/departments', here(p))
  check('master: no page errors or failed API calls', o.clean().length === 0)

  // Payroll's own section bar: its Payroll Settings tab leads to the hub.
  await open(p, '/hrms/payroll-dashboard')
  const payTab = p.getByRole('navigation', { name: 'Payroll sections' }).getByRole('button', { name: 'Payroll Settings' })
  if (await payTab.count()) { await payTab.click(); await settle(p); check('payroll: the section bar\'s Payroll Settings opens HRMS settings', here(p) === '/hrms/settings/payroll', here(p)) }
  else check('payroll: the section bar has a Payroll Settings tab', false)

  // Expenses: its Policies tab leads to the hub.
  await open(p, '/hrms/expenses')
  const expPolicies = p.getByRole('group', { name: 'Expense views' }).getByRole('button', { name: /^Policies/ })
  check('expenses: the Policies tab is still offered', (await expPolicies.count()) === 1)
  if (await expPolicies.count()) { await expPolicies.click(); await settle(p) }
  check('expenses: Policies opens Expense policies in HRMS settings', here(p) === '/hrms/settings/expense-policies' && (await h1(p, 'Expense policies').count()) === 1, here(p))
  check('expenses: no page errors or failed API calls', o.clean().length === 0)

  // Unsaved payroll settings: the hub's tabs ask first, as Payroll's own bar does. Nothing is saved.
  await open(p, '/hrms/settings/payroll')
  const pf = p.getByRole('switch', { name: /Apply Provident Fund/ })
  if (await pf.count()) {
    await pf.click()
    await p.getByText(/1 change · used by runs processed after saving/).first().waitFor({ timeout: 5000 }).catch(() => {})
    const hubNav = p.getByRole('navigation', { name: 'HRMS settings sections' })
    await hubNav.getByRole('link', { name: 'HR configuration', exact: true }).click(); await p.waitForTimeout(500)
    const asked = (await p.getByText('Discard unsaved changes?').count()) === 1
    check('guard: a hub tab asks before leaving unsaved payroll settings', asked && here(p) === '/hrms/settings/payroll', here(p))
    if (asked) {
      await p.getByRole('button', { name: 'Keep editing', exact: true }).click(); await p.waitForTimeout(300)
      check('guard: "Keep editing" stays on Payroll settings', here(p) === '/hrms/settings/payroll', here(p))
      await hubNav.getByRole('link', { name: 'HR configuration', exact: true }).click(); await p.waitForTimeout(500)
      await p.getByRole('button', { name: 'Discard', exact: true }).click(); await settle(p)
      check('guard: "Discard" then opens the tab', here(p) === '/hrms/settings/hr-configuration', here(p))
    }
  } else check('guard: the Provident Fund switch is there', false)
  o.clean()

  // ── Old addresses land on the new home ──
  const OLD = [
    ['/hrms/settings/work-time', '/hrms/settings/hr-configuration#st-week'], ['/hrms/settings#st-late', '/hrms/settings/hr-configuration#st-late'], ['/hrms/payroll/settings', '/hrms/settings/payroll'],
    ['/hrms/notification-templates', '/hrms/settings/notifications'], ['/hrms/integrations', '/settings/integrations/register'],
    ['/settings/documents', '/hrms/settings/document-types'], ['/roles', '/hrms/settings/roles'], ['/roles?view=catalogue', '/hrms/settings/roles?view=catalogue'],
    ['/hrms/master/shift-rules', '/hrms/settings/shift-rules'], ['/hrms/master/leave-rules', '/hrms/settings/leave-rules'], ['/hrms/master/statutory', '/hrms/settings/statutory'],
    ['/hrms/payroll/components', '/hrms/settings/salary-components'], ['/hrms/policies', '/hrms/settings/policies'],
    ['/hrms/policies?q=Leave&status=Active', '/hrms/settings/policies?q=Leave&status=Active'], ['/hrms/expenses?tab=policies', '/hrms/settings/expense-policies'],
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
  for (const [path, name] of [['/modules', 'modules'], ['/hrms/settings', 'hub'], ['/settings/profile', 'workspace'], ['/hrms/settings/shift-rules', 'shiftrules'], ['/hrms/settings/roles', 'roles']]) {
    await open(m.page, path)
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`phone ${path}: no sideways scroll`, overflow <= 1, `overflow=${overflow}`)
    await m.page.screenshot({ path: `${shots}/settings-${name}-390.png`, fullPage: true })
  }
  // The hub's long tab row scrolls sideways; the lit tab is kept in view.
  await open(m.page, '/hrms/settings/roles')
  const litBox = await m.page.getByRole('navigation', { name: 'HRMS settings sections' }).locator('a[aria-current=page]').boundingBox().catch(() => null)
  check('phone: the lit hub tab is in view', !!litBox && litBox.x >= 0 && litBox.x + litBox.width <= 391, JSON.stringify(litBox))
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
  for (const path of [...HUB_TABS.slice(1).map(([hp]) => hp), '/roles', '/settings/profile', '/settings/integrations/register']) {
    await open(r.page, path)
    check(`reader: ${path} is not open`, (await restricted(r.page)) === 1 || (await r.page.getByText(/not activated/i).count()) > 0, here(r.page))
  }
  await open(r.page, '/hrms/policies')
  check('reader: /hrms/policies stays the page where they read and acknowledge policies', here(r.page) === '/hrms/policies' && (await h1(r.page, 'Policies').count()) === 1 && (await r.page.locator('.utm').count()) === 0, here(r.page))
  await open(r.page, '/hrms/expenses')
  check('reader: Expenses opens as before (no Policies tab)', here(r.page).startsWith('/hrms/expenses') && (await r.page.getByRole('group', { name: 'Expense views' }).getByRole('button', { name: /^Policies/ }).count()) === 0, here(r.page))
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
  for (const path of ['/hrms/settings/roles', '/hrms/settings/payroll', '/hrms/settings/shift-rules', '/hrms/settings/leave-rules', '/hrms/settings/policies', '/hrms/settings/expense-policies', '/users']) {
    await open(g.page, path)
    check(`manager: ${path} is not open`, (await restricted(g.page)) === 1 || (await g.page.getByText('Access restricted').count()) > 0, here(g.page))
  }
  await g.ctx.close()

  // ═══ fin@ (FINANCE_LEAD): payroll settings, not roles ════════════════════
  const f = await session('fin@unifiedtree.demo')
  await open(f.page, '/hrms/settings')
  const finCards = await f.page.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))
  check('finance: the hub offers payroll, salary components, statutory, expense policies and HR configuration', ['payroll', 'components', 'statutory', 'expense-policies', 'hr-config'].every((k) => finCards.includes(k)), finCards.join(','))
  check('finance: …not roles, notifications, shift or leave rules, or policy documents', !['roles', 'notifications', 'shift-rules', 'leave-rules', 'policies'].some((k) => finCards.includes(k)), finCards.join(','))
  for (const [path, title] of [['/hrms/settings/payroll', 'Payroll Settings'], ['/hrms/settings/salary-components', 'Salary Components'], ['/hrms/settings/statutory', 'Statutory Settings'], ['/hrms/settings/expense-policies', 'Expense policies']]) {
    f.clean()
    await open(f.page, path)
    await h1(f.page, title).waitFor({ timeout: 20_000 }).catch(() => {})
    const bad = f.clean()
    check(`finance: ${path} opens in the hub`, (await h1(f.page, title).count()) === 1 && bad.length === 0, bad.slice(0, 2).join(' | '))
  }
  await open(f.page, '/hrms/settings/shift-rules')
  check('finance: /hrms/settings/shift-rules is not open', (await restricted(f.page)) === 1, here(f.page))
  await f.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
