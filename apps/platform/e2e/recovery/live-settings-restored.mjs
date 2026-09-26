// Settings are back where they were before 26 Sep 2026 (the "HRMS settings" hub is undone).
// Compares the app under test with the app as it was before that night (commit 5f45946),
// page by page, for every role: the rail (items, short labels, the lit one), the header gear
// (shown, lit, where it leads), the profile menu (entries, where each leads), the Apps page's
// buttons, and for every settings address: where it ends up, the page title and heading, the
// shell's tab row and every section/tab bar on the page (Master's tabs and its inner
// sections, Payroll's section bar, Expenses' views, Roles' views, Settings' tabs) with the lit
// one. They must match exactly. The hub's own addresses (live for a few hours) must open the
// original page, the same as opening that page directly on the old app. The app under test
// may show no page error or API 4xx/5xx the old app doesn't show.
// Read-only: it only signs in and opens pages.
//
//   RECOVERY_APP_URL=<app under test> SETTINGS_BEFORE_URL=<app at 5f45946> node e2e/recovery/live-settings-restored.mjs
//   SETTINGS_ONLY=owner,hrm   runs only those accounts
/* global console, process, URL, document, location, getComputedStyle */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const ref = process.env.SETTINGS_BEFORE_URL || 'http://demo.localhost:3050'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const only = (process.env.SETTINGS_ONLY || '').split(',').filter(Boolean)
const ACCOUNTS = [
  ['owner', 'owner@unifiedtree.demo'], ['admin', 'admin@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'],
  ['fin', 'fin@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo'],
].filter(([who]) => !only.length || only.includes(who))
const PHONE = new Set(['owner', 'hrm', 'reader'])

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

// What other changes of that night (kept) add to these pages; left out of the comparison and reported.
const KEPT = [
  { path: '/profile', bar: 'On this page', item: 'Face enrollment', why: 'face enrollment on the web' },
]

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()

async function session(url, email, width, who) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  const errors = new Set(), failed = new Set()
  page.on('pageerror', (e) => errors.add(String(e.message || e).slice(0, 160)))
  // The session refresh probe answers 422 when there is nothing to refresh (as in the other live tests).
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || (r.status() === 422 && r.url().includes('/canonical-auth/refresh'))) return
    failed.add(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  await page.goto(url + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, url, errors, failed, who }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 20_000 }).catch(() => {})
  await page.waitForFunction(() => !!document.querySelector('h1') || /Access Restricted|don.t have access/i.test(document.body.innerText), null, { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(700)
}

// What the person sees of the shell and the page's own section bars.
const snap = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const lit = (el) => el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || /(^|\s)(on|active)(\s|$)/.test(typeof el.className === 'string' ? el.className : '')
  const railNav = [...document.querySelectorAll('nav[aria-label="Primary"]')].find(vis)
  const railBtns = railNav ? [...railNav.querySelectorAll('button[title]:not([aria-label])')] : []
  const gear = [...document.querySelectorAll('button[aria-label="Settings"]')].find(vis)
  const shellRow = document.querySelector('nav[aria-label$=" sections"]:has(> .ds-subnav-scroll)')
  const bars = [...document.querySelectorAll('nav[aria-label], [role=navigation][aria-label], [role=tablist], [role=group][aria-label], .hero-tabs .seg')]
    .filter((n) => vis(n) && n.getAttribute('aria-label') !== 'Primary' && n !== shellRow && !n.closest('[aria-label="Primary"]'))
    .map((n) => { const items = [...n.querySelectorAll('a, button, [role=tab]')].filter(vis); return { bar: n.getAttribute('aria-label') || (n.matches('.seg') ? 'Master inner sections' : n.getAttribute('role')), items: items.map(txt), lit: items.filter(lit).map(txt) } })
  const h1 = [...document.querySelectorAll('h1')].filter(vis)
  const head = h1.length ? h1.map(txt) : [...document.querySelectorAll('h2, h3')].filter(vis).slice(0, 1).map(txt)
  const eyebrow = h1[0]?.previousElementSibling ? txt(h1[0].previousElementSibling).slice(0, 80) : ''
  const restricted = /Access Restricted/i.test(document.body.innerText)
  return {
    at: location.pathname + location.search + location.hash,
    title: document.title,
    heading: head, eyebrow, restricted,
    rail: railBtns.map((b) => `${b.title} [${txt(b)}]`),
    lit: railBtns.filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.title),
    gear: gear ? (/ds-hdr-active/.test(gear.className) ? 'lit' : 'shown') : 'none',
    row: shellRow ? { bar: shellRow.getAttribute('aria-label'), items: [...shellRow.querySelectorAll('a')].map(txt), lit: [...shellRow.querySelectorAll('a[aria-current=page]')].map(txt) } : null,
    bars,
  }
})

// Phone: the navigation drawer's entries and the lit one (the rail is hidden).
async function drawer(page) {
  const open = page.getByRole('button', { name: 'Open navigation' })
  if (!(await open.isVisible().catch(() => false))) return null
  await open.click()
  const nav = page.locator('nav[aria-label="Primary"]').last()
  await nav.waitFor({ timeout: 10_000 }).catch(() => {})
  const items = (await nav.locator('button:not([aria-label])').allTextContents()).map((t) => t.trim())
  const lit = (await nav.locator('button[aria-current="page"]').allTextContents()).map((t) => t.trim())
  await page.getByRole('button', { name: 'Close navigation' }).click().catch(() => {})
  await page.waitForTimeout(200)
  return { items, lit }
}

async function look(s, path, phone) {
  await s.page.goto(s.url + path)
  await settle(s.page)
  const v = await snap(s.page)
  if (phone) v.drawer = await drawer(s.page)
  return v
}
// Leaves out what a kept change of that night adds to the page (KEPT), saying so once.
const noted = new Set()
function withoutKept(v) {
  for (const k of KEPT) {
    if (v.at !== k.path) continue
    for (const b of v.bars) {
      if (b.bar !== k.bar || !b.items.includes(k.item)) continue
      b.items = b.items.filter((i) => i !== k.item)
      if (!noted.has(k.item)) { noted.add(k.item); console.log(`NOTE  ${k.path}: "${k.item}" in "${k.bar}" is new from ${k.why} (kept), not compared`) }
    }
  }
  return v
}

const show = (v) => JSON.stringify(v)
function differences(a, b) {
  const out = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (show(a[k]) !== show(b[k])) out.push(`${k}: before ${show(a[k])}, now ${show(b[k])}`)
  return out
}

// Both apps, same address, compared; one more look after a pause if they differ (a slow load).
async function same(was, now, wasPath, nowPath, phone) {
  let [a, b] = await Promise.all([look(was, wasPath, phone), look(now, nowPath, phone).then(withoutKept)])
  let diff = differences(a, b)
  if (diff.length) {
    await Promise.all([was.page.waitForTimeout(2500), now.page.waitForTimeout(2500)])
    ;[a, b] = await Promise.all([look(was, wasPath, phone), look(now, nowPath, phone).then(withoutKept)])
    diff = differences(a, b)
  }
  return { a, b, diff }
}

// The profile menu: its entries, and where each leads (Sign out excepted).
async function profileMenu(s, phone) {
  const button = () => s.page.getByRole('button', { name: phone ? 'Profile' : 'Account' }).filter({ visible: true }).first()
  const menu = () => s.page.locator('.z-dropdown.w-56').filter({ visible: true }).first()
  await s.page.goto(s.url + '/profile'); await settle(s.page)
  await button().click()
  await menu().waitFor({ timeout: 10_000 })
  const entries = (await menu().locator('button').allTextContents()).map((t) => t.trim())
  const leads = {}
  for (const entry of entries.filter((e) => e !== 'Sign out')) {
    await s.page.goto(s.url + '/profile'); await settle(s.page)
    await button().click()
    await menu().getByRole('button', { name: entry, exact: true }).click()
    await settle(s.page)
    leads[entry] = new URL(s.page.url()).pathname
  }
  return { entries, leads }
}

// The header gear (desktop): shown or not, and where it leads.
async function gear(s) {
  await s.page.goto(s.url + '/profile'); await settle(s.page)
  const g = s.page.locator('button[aria-label="Settings"]').filter({ visible: true }).first()
  if (!(await g.count())) return 'none'
  await g.click(); await settle(s.page)
  return new URL(s.page.url()).pathname
}
// The phone drawer's Settings entry (the phone header has no gear): where it leads.
async function drawerSettings(s) {
  await s.page.goto(s.url + '/profile'); await settle(s.page)
  await s.page.getByRole('button', { name: 'Open navigation' }).click()
  const entry = s.page.locator('nav[aria-label="Primary"]').last().getByRole('button', { name: 'Settings', exact: true })
  if (!(await entry.count())) { await s.page.getByRole('button', { name: 'Close navigation' }).click(); return 'none' }
  await entry.click(); await settle(s.page)
  return new URL(s.page.url()).pathname
}

// The Apps page: every button and link on it.
async function apps(s) {
  await s.page.goto(s.url + '/modules'); await settle(s.page)
  await s.page.waitForTimeout(800)
  return s.page.evaluate(() => [...document.querySelectorAll('button, a')].filter((el) => el.getClientRects().length > 0).map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))
}

try {
  const runs = [...ACCOUNTS.map(([who, email]) => [who, email, 1440]), ...ACCOUNTS.filter(([who]) => PHONE.has(who)).map(([who, email]) => [who, email, 390])]
  for (const [who, email, width] of runs) {
    const phone = width < 700
    const tag = `${who}${phone ? ' (phone)' : ''}`
    let was, now
    try {
      ;[was, now] = await Promise.all([session(ref, email, width, tag), session(base, email, width, tag)])

      // ── the shell: rail, gear, profile menu, Apps page ──
      const [a, b] = await Promise.all([look(was, '/profile', phone), look(now, '/profile', phone)])
      if (phone) check(`${tag}: the navigation drawer's entries are as before`, show(a.drawer?.items) === show(b.drawer?.items), `before ${show(a.drawer?.items)}, now ${show(b.drawer?.items)}`)
      else check(`${tag}: the rail's items and labels are as before`, show(a.rail) === show(b.rail) && b.rail.length > 0, `before ${show(a.rail)}, now ${show(b.rail)}`)
      if (!phone) check(`${tag}: the rail has "HR Setup" exactly when it did before, and no "HRMS settings"`, a.rail.some((r) => r.startsWith('HR Setup ')) === b.rail.some((r) => r.startsWith('HR Setup ')) && !b.rail.some((r) => /HRMS settings/.test(r)))
      const [ga, gb] = phone ? await Promise.all([drawerSettings(was), drawerSettings(now)]) : await Promise.all([gear(was), gear(now)])
      check(`${tag}: the ${phone ? 'drawer\'s Settings entry' : 'header gear'} is ${ga === 'none' ? 'absent' : `there and opens ${ga}`}, as before`, ga === gb, `before ${ga}, now ${gb}`)
      const [ma, mb] = await Promise.all([profileMenu(was, phone), profileMenu(now, phone)])
      check(`${tag}: the profile menu has the same entries, each leading where it did`, show(ma) === show(mb), `before ${show(ma)}, now ${show(mb)}`)
      const [aa, ab] = await Promise.all([apps(was), apps(now)])
      check(`${tag}: the Apps page has the same buttons (no "Workspace settings")`, show(aa) === show(ab) && !ab.includes('Workspace settings'), `before ${show(aa)}, now ${show(ab)}`)

      // ── every settings address, and the pages around them ──
      for (const path of PAGES) {
        const r = await same(was, now, path, path, phone)
        check(`${tag}: ${path} → ${r.b.at} "${r.b.heading.join(' / ')}"${r.b.lit.length ? ` (rail: ${r.b.lit.join(', ')})` : ''} as before`, !r.diff.length, r.diff.slice(0, 3).join(' | '))
      }
      // ── the hub's addresses open the original page ──
      for (const [hub, page] of HUB) {
        const r = await same(was, now, page, hub, phone)
        check(`${tag}: ${hub} opens ${page} as it was`, r.b.at === page && !r.diff.length, [`at ${r.b.at}`, ...r.diff.slice(0, 3)].join(' | '))
      }

      const newErrors = [...now.errors].filter((e) => !was.errors.has(e))
      check(`${tag}: no page error the old app doesn't show`, !newErrors.length, newErrors.slice(0, 3).join(' | '))
      const newFailed = [...now.failed].filter((f) => !was.failed.has(f))
      check(`${tag}: no API 4xx/5xx the old app doesn't show`, !newFailed.length, newFailed.slice(0, 6).join(' | '))
    } catch (e) {
      check(`${tag}: run finished`, false, String(e.message || e).slice(0, 300))
    } finally {
      await was?.context.close().catch(() => {})
      await now?.context.close().catch(() => {})
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
