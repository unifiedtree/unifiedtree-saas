// Settings stay where they were (the "HRMS settings" hub of 26 Sep 2026 stays undone) now that the
// redesign shell is in: the header gear and the profile menu are gone and More holds their entries.
//
// For every role, at 1440 and on a phone, every settings address (and the pages around them) is
// compared with what it showed before the redesign shell (live-settings-restored.baseline.json,
// captured from rd/int 33cc0d41 on the stable demo data): where it ends up, the browser title, the
// heading, "Access Restricted" or not, and every section/tab bar on the page (Master's tabs and inner
// sections, Payroll's section bar, Expenses' views, Roles' views, the settings tabs) with the lit one.
// The shell's old "<Module> sections" row is now the top bar's page tabs (Release 1.1; in Release 1 the
// left Pages panel): the settings row is the "Settings pages" tabs (the same pages, plus Document types
// after Integrations for people who can open it), HR Setup's row is the "HR setup pages" tabs, with the
// same page lit. Payroll's and Workforce's own "Payroll sections" / "Master sections" bars show as the
// top bar's "Payroll pages" / "Workforce pages" tabs: the same pages, the same one lit. The rail lights what it lit
// then, under its new name (Master → Workforce…); what the gear lit, More lights now.
// The gear and the profile menu become More: My workspace (the person's Home), My profile, All apps,
// Preferences (the first settings page the person can open), Help & support and Sign out. On a phone
// the drawer holds the same. The hub's own addresses still open the original page. No module shows
// on the rail or in More that the person's rail didn't have before (renamed, or their own My work).
// Read-only: it only signs in and opens pages.
//
//   RECOVERY_APP_URL=<app under test> node e2e/recovery/live-settings-restored.mjs
//   SETTINGS_ONLY=owner,hrm            runs only those accounts
//   SETTINGS_BASELINE=<file.json>      another baseline (same shape)
/* global console, process, URL, document, location, getComputedStyle, window */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const only = (process.env.SETTINGS_ONLY || '').split(',').filter(Boolean)
const BASELINE = JSON.parse(readFileSync(process.env.SETTINGS_BASELINE || new URL('./live-settings-restored.baseline.json', import.meta.url), 'utf8')).accounts
const ACCOUNTS = [
  ['owner', 'owner@unifiedtree.demo'], ['admin', 'admin@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'],
  ['fin', 'fin@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo'],
].filter(([who]) => !only.length || only.includes(who))
const PHONE = new Set(['owner', 'hrm', 'reader'])
// Home by permission (DECISIONS 12): the admin dashboard, or the self-service Home.
const HOME = { owner: '/dashboard', admin: '/dashboard', hrm: '/dashboard', fin: '/dashboard', mgr: '/me', reader: '/me' }
const PLAN_ADMINS = new Set(['owner', 'admin'])

// Every settings address as it was before the hub, and the pages around them.
const PAGES = [
  '/settings', '/settings/profile', '/settings/branding', '/settings/security', '/settings/notifications', '/settings/billing',
  '/settings/integrations', '/settings/documents', '/settings/danger', '/profile', '/users', '/audit-logs', '/roles', '/roles?view=assignments',
  '/hrms/settings', '/hrms/settings#st-week', '/hrms/settings/work-time',
  '/hrms/master', '/hrms/master/shift-rules', '/hrms/master/leave-rules', '/hrms/master/statutory', '/hrms/payroll/components', '/hrms/policies',
  '/hrms/payroll-dashboard', '/hrms/payroll/settings', '/hrms/expenses', '/hrms/expenses?tab=policies',
  '/hrms/notification-templates', '/hrms/integrations',
]
// The hub's addresses and the page each must open (query and #section kept).
const HUB = [
  ['/hrms/settings/hr-configuration', '/hrms/settings'],
  ['/hrms/settings/hr-configuration#st-week', '/hrms/settings#st-week'],
  ['/hrms/settings/shift-rules', '/hrms/master/shift-rules'],
  ['/hrms/settings/leave-rules', '/hrms/master/leave-rules'],
  ['/hrms/settings/payroll', '/hrms/payroll/settings'],
  ['/hrms/settings/salary-components', '/hrms/payroll/components'],
  ['/hrms/settings/statutory', '/hrms/master/statutory'],
  ['/hrms/settings/expense-policies', '/hrms/expenses?tab=policies'],
  ['/hrms/settings/document-types', '/settings/documents'],
  ['/hrms/settings/policies', '/hrms/policies'],
  ['/hrms/settings/notifications', '/hrms/notification-templates'],
  ['/hrms/settings/roles', '/roles'],
  ['/hrms/settings/roles?view=catalogue', '/roles?view=catalogue'],
  ['/hrms/settings/access', '/roles?view=assignments'],
  ['/settings/integrations/register', '/hrms/integrations'],
]

// The old rail's names and what each is called now (an admin module, or the person's own My work item).
const MY_WORK = ['My time', 'My leave', 'My pay', 'My documents', 'My growth']
const RENAMED = {
  'Dashboard': ['Dashboard', 'Home'], 'Company Profile': ['Company'], 'Master': ['Workforce'], 'Attendance & Time': ['Attendance & time', 'My time'],
  'Leave Management': ['Leave', 'My leave'], 'Recruitment & Onboarding': ['Hiring & onboarding'], 'Payroll': ['Payroll', 'My pay'],
  'Expense Management': ['Expenses', 'My pay'], 'Performance & Learning': ['Performance', 'My growth'], 'Compliance': ['Compliance'],
  'Reports & Analytics': ['Reports'], 'Employee Exit': ['Employee exit'], 'HR Setup': ['HR setup'], 'My Team': ['My team'],
  'Employee Self Service': ['Home', ...MY_WORK],
}
const BUSINESS_APPS = ['CRM', 'Accounts', 'Projects', 'Inventory', 'Purchase']
// The shell's old rows and the top bar's page tabs that replaced them.
const PANEL_FOR_ROW = { 'Settings sections': 'Settings pages', 'HR Setup sections': 'HR setup pages' }
// Pages' own module bars that the top bar's page tabs show now (the page's copy is hidden).
const TOP_FOR_BAR = { 'Payroll sections': 'Payroll pages', 'Master sections': 'Workforce pages' }
// Pages a later redesign package rebuilt on purpose: what the baseline recorded, adjusted to the new page.
// My profile (P-PROFILE, DECISIONS 17): the tabbed profile. Its heading is the person's name, and its bar is
// the "Profile sections" tabs with Overview open (the person's own tabs, Preferences last). The old
// "On this page" sections moved: Face enrollment and Employment to Overview (checked by its anchor below),
// delegation and notification choices to Preferences, My documents to Documents.
const REDESIGNED = {
  '/profile': (was, now) => {
    const tabs = now.bars.find((b) => b.bar === 'Profile sections')
    const ok = tabs && tabs.items[0] === 'Overview' && tabs.items.at(-1) === 'Preferences'
    return { ...was, heading: now.heading.length === 1 ? now.heading : ['(the person’s name)'], bars: [{ bar: 'Profile sections', items: ok ? tabs.items : ['Overview', '…', 'Preferences'], lit: ['Overview'] }] }
  },
}
// Bars whose lit item is the chosen tab (the "On this page" jump bars light what is scrolled into view).
const LIT_BARS = /(sections|views|Master inner sections)$/
// API answers expected here: the session refresh probe (nothing to refresh), the admin contacts behind
// Help & support (its endpoint is not built yet: the panel says so), and Billing & Plan's current plan
// on the demo data (the owner's workspace has no billing account linked; the same before the redesign,
// see live-design-settings on main).
const EXPECTED_API = [/^422 POST .*\/canonical-auth\/refresh$/, /^404 GET .*\/admin-contacts$/, /^403 GET .*\/workspace\/plan\/current$/]

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const note = (msg) => console.log(`NOTE  ${msg}`)
const show = (v) => JSON.stringify(v)

const browser = await chromium.launch()

async function session(email, width, who) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  const errors = new Set(), failed = new Set()
  page.on('pageerror', (e) => errors.add(String(e.message || e).slice(0, 160)))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400) return
    const line = `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`
    if (!EXPECTED_API.some((re) => re.test(line))) failed.add(line)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 60_000 })
  return { context, page, errors, failed, who }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 20_000 }).catch(() => {})
  await page.waitForFunction(() => !!document.querySelector('h1') || /Access Restricted|don.t have access/i.test(document.body.innerText), null, { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(700)
}

// What the person sees: where they are, title, heading, the page's own bars (a bar the page put in
// the top bar counts: it is the page's), and the rail's lit item or More.
const snap = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const lit = (el) => el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || /(^|\s)(on|active|is-on)(\s|$)/.test(typeof el.className === 'string' ? el.className : '')
  const shell = (n) => n.getAttribute('aria-label') === 'Primary' || !!n.closest('[aria-label="Primary"], .ut-more, .ut-drawer, .ut-topbar') || /\spages$/.test(n.getAttribute('aria-label') || '')
  const bars = [...document.querySelectorAll('nav[aria-label], [role=navigation][aria-label], [role=tablist], [role=group][aria-label], .hero-tabs .seg')]
    .filter((n) => vis(n) && !shell(n))
    .map((n) => { const items = [...n.querySelectorAll('a, button, [role=tab]')].filter(vis); return { bar: n.getAttribute('aria-label') || (n.matches('.seg') ? 'Master inner sections' : n.getAttribute('role')), items: items.map(txt), lit: items.filter(lit).map(txt) } })
  const h1 = [...document.querySelectorAll('h1')].filter(vis)
  const head = h1.length ? h1.map(txt) : [...document.querySelectorAll('h2, h3')].filter(vis).slice(0, 1).map(txt)
  const rail = document.querySelector('.ut-railwrap nav[aria-label="Primary"]')
  const railLinks = rail ? [...rail.querySelectorAll('a.ut-rail__item')] : []
  return {
    at: location.pathname + location.search + location.hash,
    title: document.title,
    heading: head,
    restricted: /Access Restricted/i.test(document.body.innerText),
    bars,
    lit: railLinks.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.title),
    more: rail?.querySelector('.ut-rail__more')?.getAttribute('aria-current') === 'page',
    pagesButton: [...document.querySelectorAll('button[aria-label^="Show pages: "]')].filter(vis).map((b) => b.getAttribute('aria-label').slice('Show pages: '.length))[0] ?? null,
  }
})

// The module's pages for this page: the top bar's tabs (all of them, scrolled into view or not).
async function pagesPanel(page) {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('.ut-topbar nav[aria-label$=" pages"]')].find((n) => n.getClientRects().length)
    if (!nav) return null
    const label = (a) => a.textContent.replace(/\s+/g, ' ').trim()
    const links = [...nav.querySelectorAll('a')]
    return { bar: nav.getAttribute('aria-label'), items: links.map(label), lit: links.filter((a) => a.getAttribute('aria-current') === 'page').map(label) }
  })
}

async function look(s, path) {
  await s.page.goto(base + path)
  await settle(s.page)
  return snap(s.page)
}

const digits = (t) => t.replace(/\d+/g, '').trim()
// Time of day in the greeting ("Good morning, …") is not a difference, and neither is the greeting's full
// name (Release 1.1: the client's "full name everywhere"; the baseline has the first name): the first name
// must still lead it.
const heading = (h) => h.map((t) => t.replace(/^Good (morning|afternoon|evening)/, 'Good <time of day>').replace(/^(Good <time of day>, \S+) .*$/, '$1'))
const barsOf = (bars) => bars.map((b) => ({ bar: b.bar, items: b.items.map(digits), ...(LIT_BARS.test(b.bar) ? { lit: b.lit.map(digits) } : {}) }))

// What the old settings row becomes in the Settings pages panel: Document types after Integrations,
// for people who could open /settings/documents.
function settingsPanelWant(row, at, docsOpen) {
  const items = [...row.items]
  if (docsOpen && !items.includes('Document types')) {
    const i = items.indexOf('Integrations')
    const j = i >= 0 ? i + 1 : items.indexOf('Users & Access') >= 0 ? items.indexOf('Users & Access') : items.length
    items.splice(j, 0, 'Document types')
  }
  const lit = at.split(/[?#]/)[0] === '/settings/documents' && docsOpen ? ['Document types'] : row.lit
  return { items, lit }
}

// The rail's lit item now, from what it lit then: settings (the gear, and My profile) light More;
// a module under its new name, or More when that module sits in More for lack of room, or nothing
// when the person has no such item now (HR's and Finance's old "Employee Self Service" item for /me:
// their Home is the dashboard). A page nothing lit before may now light the person's own My work
// item it belongs to (Policies is in My documents), or More when that item sits in More.
const LIT_AS = { ...RENAMED, 'Employee Self Service': ['Home'] }
function railOk(was, now, onRail, inMore) {
  const path = now.at.split(/[?#]/)[0]
  if (was.gear === 'lit' || /^\/(settings|users|roles|audit-logs|profile|modules)(\/|$)/.test(path)) return { ok: !now.lit.length && now.more, want: 'More' }
  if (!was.lit.length) return { ok: now.lit.length === 0 || (now.lit.length === 1 && [...MY_WORK, 'Home'].includes(now.lit[0]) && !now.more), want: 'nothing, or their own My work item' }
  const names = LIT_AS[was.lit[0]] ?? [was.lit[0]]
  const name = names.find((n) => onRail.includes(n))
  if (name) return { ok: show(now.lit) === show([name]) && !now.more, want: name }
  if (names.some((n) => inMore.includes(n))) return { ok: !now.lit.length && now.more, want: `More (${names.join('/')} is in More)` }
  return { ok: !now.lit.length && !now.more, want: 'nothing (no such item now)' }
}

// More (the gear's and the profile menu's successor): its groups and rows.
async function openMore(s) {
  await s.page.locator('.ut-railwrap .ut-rail__more').click()
  const dialog = s.page.getByRole('dialog', { name: 'More' })
  await dialog.waitFor({ timeout: 10_000 })
  return dialog
}
const moreGroups = (dialog) => dialog.locator('.ut-more__sec').evaluateAll((els) => els.map((g) => ({ group: g.getAttribute('aria-label'), rows: [...g.querySelectorAll('.ut-more__row')].map((r) => r.querySelector('.ut-more__rowlabel')?.textContent.trim()) })))
// A More row's full module name (My work's rows may carry the short name).
const moduleName = (group, label) => (group === 'My work' && !/^My /.test(label) ? `My ${label.toLowerCase()}` : label)

// The phone drawer: its modules (full names), and its own More rows.
async function openDrawer(s) {
  await s.page.getByRole('button', { name: 'Open navigation' }).click()
  const dialog = s.page.getByRole('dialog', { name: 'Navigation' })
  await dialog.waitFor({ timeout: 10_000 })
  return dialog
}

try {
  const runs = [...ACCOUNTS.map(([who, email]) => [who, email, 1440]), ...ACCOUNTS.filter(([who]) => PHONE.has(who)).map(([who, email]) => [who, email, 390])]
  for (const [who, email, width] of runs) {
    const phone = width < 700
    const tag = `${who}${phone ? ' (phone)' : ''}`
    const before = BASELINE[`${who}@${width}`]
    const oldRail = BASELINE[`${who}@1440`]?.rail ?? []
    if (!before) { check(`${tag}: a baseline to compare with`, false, `no ${who}@${width} in the baseline`); continue }
    let s
    try {
      s = await session(email, width, tag)

      // ── the shell: the modules, More (gear + profile menu), the Apps page ──
      await s.page.goto(base + '/profile'); await settle(s.page)
      let modules, groups, inMore = []
      if (phone) {
        const drawer = await openDrawer(s)
        modules = await drawer.getByRole('navigation', { name: 'Primary' }).locator('a').evaluateAll((els) => els.map((a) => a.getAttribute('aria-label') || a.querySelector('.ut-rail__label')?.textContent.trim() || ''))
        groups = await moreGroups(drawer)
        await s.page.getByRole('button', { name: 'Close navigation' }).click()
      } else {
        const rail = await snap(s.page)
        const railNames = await s.page.locator('.ut-railwrap nav[aria-label="Primary"] a.ut-rail__item').evaluateAll((els) => els.map((a) => a.title))
        const more = await openMore(s)
        groups = await moreGroups(more)
        const overflow = groups.filter((g) => g.group !== 'My space' && g.group !== 'Settings').flatMap((g) => g.rows.map((r) => moduleName(g.group, r)))
        modules = [...railNames, ...overflow]
        inMore = overflow
        check(`${tag}: /profile lights More, not a rail item (More holds My profile now)`, rail.more && !rail.lit.length, show(rail.lit))
        await s.page.keyboard.press('Escape')
      }
      // Every module of the old rail is still there, under its new name; nothing new but the person's own My work (and the business apps for plan admins).
      const allowed = new Set(oldRail.flatMap((n) => RENAMED[n] ?? [n]))
      if (oldRail.includes('Employee Self Service') || oldRail.includes('Dashboard')) for (const n of ['Home', ...MY_WORK]) allowed.add(n)
      if (PLAN_ADMINS.has(who)) for (const n of BUSINESS_APPS) allowed.add(n)
      const missing = oldRail.filter((n) => !(RENAMED[n] ?? [n]).some((m) => modules.includes(m)))
      const extra = modules.filter((m) => !allowed.has(m))
      check(`${tag}: every module of the old rail is still there under its new name`, !missing.length, `missing ${show(missing)}; now ${show(modules)}`)
      check(`${tag}: no module the person's rail didn't have before`, !extra.length, `new ${show(extra)}`)
      check(`${tag}: "HR setup" exactly when "HR Setup" was on the rail, and no "HRMS settings"`, oldRail.includes('HR Setup') === modules.includes('HR setup') && !modules.some((m) => /HRMS settings/i.test(m)), show(modules))

      const mySpace = groups.find((g) => g.group === 'My space')?.rows ?? []
      const settingsRows = groups.find((g) => g.group === 'Settings')?.rows ?? []
      check(`${tag}: More has My workspace, My profile, All apps; Preferences, Help & support (the gear and profile menu)`, show(mySpace) === show(['My workspace', 'My profile', 'All apps']) && show(settingsRows) === show(['Preferences', 'Help & support']), show(groups))
      const lead = async (row, kind = 'link') => {
        await s.page.goto(base + '/profile'); await settle(s.page)
        const box = phone ? await openDrawer(s) : await openMore(s)
        await box.getByRole(kind, { name: row, exact: true }).click()
        await settle(s.page)
        return new URL(s.page.url()).pathname
      }
      const leads = { 'My workspace': await lead('My workspace'), 'My profile': await lead('My profile'), 'All apps': await lead('All apps') }
      check(`${tag}: My workspace opens their Home (${HOME[who]}), My profile /profile, All apps /modules`, show(leads) === show({ 'My workspace': HOME[who], 'My profile': '/profile', 'All apps': '/modules' }), show(leads))
      // Preferences: /settings when the person could open it before, else the first settings page they can open.
      const rowBefore = before.pages['/settings']?.row?.items ?? []
      const openBefore = (p) => before.pages[p] && !before.pages[p].restricted && before.pages[p].at.split(/[?#]/)[0] === p
      const pathOf = { 'Branding': '/settings/branding', 'Security': '/settings/security', 'Notifications': '/settings/notifications', 'Billing & Plan': '/settings/billing', 'Integrations': '/settings/integrations', 'Document types': '/settings/documents', 'Users & Access': '/users', 'Roles & Permissions': '/roles', 'Audit Logs': '/audit-logs', 'Danger Zone': '/settings/danger' }
      const prefWant = openBefore('/settings') ? '/settings' : rowBefore.filter((r) => r !== 'Profile').map((r) => pathOf[r]).find((p) => p && openBefore(p))
      const pref = await lead('Preferences', 'link')
      const prefSnap = await snap(s.page)
      const prefPanel = await pagesPanel(s.page)
      check(`${tag}: Preferences opens ${prefWant} (a settings page they can open) with the Settings pages lit on it`, pref === prefWant && !prefSnap.restricted && prefPanel?.bar === 'Settings pages' && prefPanel.lit.length === 1, `at ${pref}, restricted ${prefSnap.restricted}, panel ${show(prefPanel)}`)
      // Help & support: its panel opens (the contacts come later; it says so).
      await s.page.goto(base + '/profile'); await settle(s.page)
      await (phone ? await openDrawer(s) : await openMore(s)).getByRole('button', { name: 'Help & support', exact: true }).click()
      const help = s.page.getByRole('dialog', { name: 'Help & support' })
      check(`${tag}: Help & support opens its panel`, await help.isVisible({ timeout: 10_000 }).catch(() => false))
      await s.page.keyboard.press('Escape')
      const signOut = await (async () => { const box = phone ? await openDrawer(s) : await openMore(s); const n = await box.getByRole('button', { name: 'Sign out', exact: true }).count(); await s.page.keyboard.press('Escape'); return n })()
      check(`${tag}: Sign out is in ${phone ? 'the drawer' : 'More'}`, signOut === 1)

      // The Apps page: no "Workspace settings" (the hub's button), the apps, and Manage plan for plan admins.
      await s.page.goto(base + '/modules'); await settle(s.page)
      const appButtons = await s.page.locator('#workspace-content').locator('button, a').evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))
      const tiles = await s.page.locator('button.ut-app').count()
      check(`${tag}: the Apps page has the apps, no "Workspace settings"${PLAN_ADMINS.has(who) ? ', and Manage plan' : ''}`, tiles > 0 && !appButtons.includes('Workspace settings') && appButtons.includes('Manage plan') === PLAN_ADMINS.has(who), show(appButtons))

      // ── every settings address, and the pages around them ──
      const docsOpen = openBefore('/settings/documents')
      const compare = async (label, path, was) => {
        let now = await look(s, path)
        if (REDESIGNED[path] && was) was = REDESIGNED[path](was, now)
        let diff = []
        const run = async () => {
          diff = []
          if (now.at !== was.at) diff.push(`at: before ${was.at}, now ${now.at}`)
          if (now.title !== was.title) diff.push(`title: before ${show(was.title)}, now ${show(now.title)}`)
          if (show(heading(now.heading)) !== show(heading(was.heading))) diff.push(`heading: before ${show(was.heading)}, now ${show(now.heading)}`)
          if (now.restricted !== was.restricted) diff.push(`restricted: before ${was.restricted}, now ${now.restricted}`)
          // A page's own module bar that the top bar's tabs show now: compared with those tabs instead. When
          // the top bar shows no tabs for it (the person has one page of that module), the page keeps its bar.
          const topTabs = await pagesPanel(s.page)
          const moved = was.bars.filter((b) => TOP_FOR_BAR[b.bar] && topTabs?.bar === TOP_FOR_BAR[b.bar])
          const wasBars = was.bars.filter((b) => !moved.includes(b))
          if (show(barsOf(now.bars)) !== show(barsOf(wasBars))) diff.push(`bars: before ${show(barsOf(wasBars))}, now ${show(barsOf(now.bars))}`)
          for (const b of moved) {
            const tabs = topTabs
            const want = { bar: TOP_FOR_BAR[b.bar], items: b.items.map(digits), lit: b.lit.map(digits) }
            if (!tabs || show({ bar: tabs.bar, items: tabs.items.map(digits), lit: tabs.lit.map(digits) }) !== show(want)) diff.push(`page bar → top tabs: before ${show(b)}, now ${show(tabs)} (want ${show(want)})`)
          }
          if (!phone) {
            const railNames = await s.page.locator('.ut-railwrap nav[aria-label="Primary"] a.ut-rail__item').evaluateAll((els) => els.map((a) => a.title))
            const r = railOk(was, now, railNames, inMore)
            if (!r.ok) diff.push(`rail: before ${show(was.lit)}${was.gear === 'lit' ? ' + gear' : ''}, now ${show(now.lit)}${now.more ? ' + More' : ''} (want ${r.want})`)
          }
          // The old row → the top bar's page tabs, same pages (Document types added), same one lit.
          if (was.row && PANEL_FOR_ROW[was.row.bar]) {
            const want = was.row.bar === 'Settings sections' ? settingsPanelWant(was.row, now.at, docsOpen) : { items: was.row.items, lit: was.row.lit }
            const panel = await pagesPanel(s.page)
            if (!panel || panel.bar !== PANEL_FOR_ROW[was.row.bar] || show(panel.items) !== show(want.items) || show(panel.lit) !== show(want.lit)) diff.push(`pages: before ${show(was.row)}, now ${show(panel)} (want ${show({ bar: PANEL_FOR_ROW[was.row.bar], ...want })})`)
          } else if (was.row) note(`${tag}: ${path}: the old "${was.row.bar}" row is My work on the rail now (not compared)`)
        }
        await run()
        if (diff.length) { await s.page.waitForTimeout(2500); now = await look(s, path); await run() }
        check(`${tag}: ${label} → ${now.at} "${now.heading.join(' / ')}"${now.lit.length ? ` (rail: ${now.lit.join(', ')})` : now.more ? ' (More)' : ''} as before`, !diff.length, diff.slice(0, 3).join(' | '))
        return now
      }
      for (const path of PAGES) await compare(path, path, before.pages[path])
      // My profile's "On this page" listed Face enrollment; it now lives on the Overview tab under the same anchor.
      if (before.pages['/profile']?.bars?.some((b) => b.items.includes('Face enrollment'))) {
        await s.page.goto(base + '/profile#st-face'); await settle(s.page)
        const face = s.page.locator('#st-face')
        const shown = await face.getByRole('heading', { name: 'Face enrollment', exact: true }).isVisible().catch(() => false)
        // In view: its heading sits inside the window (it is the last card, so the page may stop scrolling before it reaches the top).
        const top = shown ? await face.getByRole('heading', { name: 'Face enrollment', exact: true }).evaluate((el) => el.getBoundingClientRect().top) : Infinity
        const vh = await s.page.evaluate(() => window.innerHeight)
        const onOverview = (await s.page.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected').catch(() => null)) === 'true'
        check(`${tag}: /profile#st-face opens My profile's Overview with Face enrollment scrolled into view`, shown && onOverview && top >= 0 && top < vh - 40, `shown ${shown}, overview ${onOverview}, top ${Math.round(top)} of ${vh}`)
      }
      // ── the hub's addresses open the original page ──
      for (const [hub, page] of HUB) {
        if (before.pages[page]) await compare(`${hub} (the hub's address for ${page})`, hub, before.pages[page])
        else {
          const [a, b] = [await look(s, page), await look(s, hub)]
          const same = a.at === page && show({ ...a, bars: barsOf(a.bars) }) === show({ ...b, bars: barsOf(b.bars) })
          check(`${tag}: ${hub} opens ${page}, the same as opening it directly`, same, `direct ${show({ at: a.at, heading: a.heading })}, hub ${show({ at: b.at, heading: b.heading })}`)
        }
      }

      check(`${tag}: no page errors`, !s.errors.size, [...s.errors].slice(0, 3).join(' | '))
      check(`${tag}: no API 4xx/5xx`, !s.failed.size, [...s.failed].slice(0, 6).join(' | '))
    } catch (e) {
      // The first line and, from Playwright's call log, why an element could not be used.
      const lines = String(e.message || e).split('\n').map((l) => l.trim()).filter(Boolean)
      check(`${tag}: run finished`, false, [lines[0], ...lines.filter((l) => /intercepts|not stable|not visible|not enabled|detached/.test(l)).slice(-2)].join(' / ').slice(0, 500))
    } finally {
      await s?.context.close().catch(() => {})
    }
  }
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
