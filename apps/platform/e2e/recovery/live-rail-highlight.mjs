// Rail highlight: the rail item you click is the one lit. Some pages belong to two rail items: a
// manager's or HR's Leave and Attendance are both an admin item and a page of My work (My leave,
// My time). The item you came through stays lit (Leave → Leave, My leave → My leave), a fresh link
// lights the page's own admin item, and a refresh keeps it. The click counts only on the page it
// opened: a card on Home, a button on a page, search, Back or a new sign-in go by the page alone.
// Settings pages light More (which replaced the header gear) and no rail item; HR setup's pages light
// HR setup, Workforce's rules and policy documents light Workforce, Payroll settings light Payroll,
// expense policies light Expenses (or More, when that item moved into More for lack of room). Pages
// in a module's Pages panel keep the module lit.
// Read-only: it only opens pages (and signs out and in once).
//
//   RECOVERY_APP_URL=http://demo.localhost:3115 node e2e/recovery/live-rail-highlight.mjs
//   RAIL_BEFORE_URL=<app with the pre-redesign code>  also compares the Leave page a Leave click opens
//   RAIL_SHOTS=<folder>                                saves the manager screenshots there
/* global console, process, URL, document, sessionStorage */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const before = process.env.RAIL_BEFORE_URL || ''
const shots = process.env.RAIL_SHOTS || ''
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const ACCOUNTS = [
  ['owner', 'owner@unifiedtree.demo'], ['admin', 'admin@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'],
  ['fin', 'fin@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo'],
]
// A card or button on the person's Home (the admin dashboard, or Home for everyone else) that opens Leave.
const HOME_LEAVE = /Open leave approvals|Add Time-Off|Add time-off|Open approvals|Open leave|Apply for leave/

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(context, email, url = base) {
  const page = await context.newPage()
  await page.goto(url + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 60_000 })
  return page
}

async function settle(page) {
  await page.waitForTimeout(250)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(150)
}

// The desktop rail: every item's full name (its title), the lit ones (aria-current="page"), and whether More is lit.
const RAIL = '.ut-railwrap nav[aria-label="Primary"]'
const rail = (page) => page.evaluate((sel) => {
  const nav = document.querySelector(sel)
  const links = nav ? [...nav.querySelectorAll('a.ut-rail__item')] : []
  return { items: links.map((a) => a.title), lit: links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.title), more: nav?.querySelector('.ut-rail__more')?.getAttribute('aria-current') === 'page' }
}, RAIL)
// The Pages panel (it replaced the "<Module> sections" tab row under the header).
const panel = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll('nav[aria-label$=" pages"]')].find((n) => n.getClientRects().length)
  if (!nav) return null
  const label = (a) => a.querySelector('.ut-pages__label')?.textContent.trim()
  const links = [...nav.querySelectorAll('a')]
  return { label: nav.getAttribute('aria-label'), pages: links.map(label), current: links.filter((a) => a.getAttribute('aria-current') === 'page').map(label) }
})
const where = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const leaveView = (page) => page.locator('[role=group][aria-label="Leave views"] button[aria-pressed="true"]').first().textContent({ timeout: 15_000 }).then((t) => t.trim()).catch(() => null)

async function clickRail(page, title) {
  await page.locator(`${RAIL} a.ut-rail__item[title="${title}"]`).click()
  await settle(page)
  // Off the rail, so it folds back to its icons.
  await page.mouse.move(900, 600)
}
async function clickPage(page, label) {
  const p = await panel(page)
  await page.locator(`nav[aria-label="${p.label}"]`).getByRole('link', { name: label, exact: true }).click()
  await settle(page)
}
// A link opened with nothing remembered in this browser tab (bookmark, email link, a new tab):
// forget the rail item this tab came through (railLit.ts keeps it in sessionStorage), then load.
async function openFresh(page, path) {
  await page.evaluate(() => { try { sessionStorage.removeItem('ut:rail-via') } catch { /* ignore */ } })
  await page.goto(base + path)
  await settle(page)
}
const litOnly = async (page, title) => { const r = await rail(page); return { ok: r.lit.length === 1 && r.lit[0] === title && !r.more, detail: `lit: ${JSON.stringify(r.lit)}${r.more ? ' + More' : ''} at ${where(page)}` } }
const openMore = async (page) => { await page.locator(`${RAIL} .ut-rail__more`).click(); return page.getByRole('dialog', { name: 'More' }) }

// Phone drawer: open it, read the lit entry, close it.
const drawerName = (els) => els.map((a) => a.getAttribute('aria-label') || a.querySelector('.ut-rail__label')?.textContent.trim() || '')
async function mobileLit(page) {
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const nav = page.getByRole('dialog', { name: 'Navigation' }).getByRole('navigation', { name: 'Primary' })
  await nav.waitFor()
  const lit = await nav.locator('a[aria-current="page"]').evaluateAll(drawerName)
  return { nav, lit }
}
async function mobileGo(page, label) {
  const { nav } = await mobileLit(page)
  await nav.getByRole('link', { name: label, exact: true }).click()
  await settle(page)
  // Opening the page already open leaves the drawer up.
  const close = page.getByRole('button', { name: 'Close navigation' })
  if (await close.isVisible()) await close.click()
}
async function mobileLitIs(page, label) {
  const { lit } = await mobileLit(page)
  await page.getByRole('button', { name: 'Close navigation' }).click()
  return { ok: lit.length === 1 && lit[0] === label, detail: `lit: ${JSON.stringify(lit)} at ${where(page)}` }
}

const browser = await chromium.launch()
const pageErrors = []
const failedApi = []
function watch(page, who) {
  page.on('pageerror', (e) => pageErrors.push(`${who}: ${String(e.message || e).slice(0, 200)}`))
  // The session refresh probe answers 422 when there is nothing to refresh (as in the other live tests).
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 422 && r.url().includes('/canonical-auth/refresh'))) failedApi.push(`${who}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
}

// What a Leave click opens with the pre-redesign code (URL and view), to compare against.
async function leaveClickOn(url, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const page = await login(context, email, url)
    await page.goto(url + '/dashboard'); await settle(page)
    await page.locator('nav[aria-label="Primary"]').first().locator('button[title="Leave Management"]').click()
    await settle(page)
    return { at: where(page), view: await leaveView(page) }
  } finally { await context.close() }
}

try {
  for (const [who, email] of ACCOUNTS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const page = await login(context, email)
      watch(page, who)
      // Start on a page no rail item owns.
      await page.goto(base + '/profile'); await settle(page)
      const { items } = await rail(page)
      check(`${who}: the rail shows`, items.length > 0, items.join(', '))
      const has = (t) => items.includes(t)

      // Every rail item: the clicked one is the only one lit; every page in its Pages panel keeps it lit.
      const bad = []
      for (const title of items) {
        await clickRail(page, title)
        const lit = await litOnly(page, title)
        if (!lit.ok) { bad.push(`${title} → ${lit.detail}`); continue }
        const p = await panel(page)
        if (!p) continue
        for (const pg of p.pages) {
          await clickPage(page, pg)
          const now = await litOnly(page, title)
          const after = await panel(page)
          if (!now.ok) bad.push(`${title} › ${pg} → ${now.detail}`)
          else if (!after || after.label !== p.label || !after.current.includes(pg)) bad.push(`${title} › ${pg}: panel ${JSON.stringify(after)}`)
        }
      }
      check(`${who}: every rail item and every page in its Pages panel keeps that item lit`, !bad.length, bad.slice(0, 4).join(' | '))

      if (has('Leave')) {
        await clickRail(page, 'Leave')
        let r = await litOnly(page, 'Leave')
        check(`${who}: Leave click lights Leave`, r.ok, r.detail)
        const opened = { at: where(page), view: await leaveView(page) }
        check(`${who}: Leave click opens /hrms/leave on its first view`, opened.at.startsWith('/hrms/leave') && !!opened.view, JSON.stringify(opened))
        if (before) {
          const old = await leaveClickOn(before, email)
          check(`${who}: Leave click opens the same page and view as before`, old.at === opened.at && old.view === opened.view, `before ${JSON.stringify(old)}, now ${JSON.stringify(opened)}`)
        }
        check(`${who}: Leave (one page) opens no Pages panel`, !(await panel(page)), JSON.stringify(await panel(page)))
        if (shots && who === 'mgr') await page.screenshot({ path: `${shots}/railfix-mgr-leave-click-1440.png` })
        await page.reload(); await settle(page)
        r = await litOnly(page, 'Leave')
        check(`${who}: refresh after a Leave click keeps Leave lit`, r.ok, r.detail)
      }

      // My work: a page it shares with an admin item keeps the My work item lit when you came through it,
      // with its Pages panel when it has several pages.
      for (const [item, pageLabel, path] of [['My leave', 'Leave', '/hrms/leave'], ['My time', 'Attendance', '/hrms/attendance'], ['My documents', 'Letters', '/hrms/letters/my']]) {
        if (!has(item)) continue
        await clickRail(page, item)
        let p = await panel(page)
        if (p && !p.current.includes(pageLabel)) { await clickPage(page, pageLabel); p = await panel(page) }
        const r = await litOnly(page, item)
        const panelOk = !p || p.current.includes(pageLabel)
        check(`${who}: ${item} → ${pageLabel} keeps ${item} lit${p ? ' with its Pages panel' : ''}`, r.ok && panelOk && new URL(page.url()).pathname === path, `${r.detail}; panel ${JSON.stringify(p)}`)
        if (item === 'My leave') {
          if (shots && who === 'mgr') await page.screenshot({ path: `${shots}/railfix-mgr-my-leave-1440.png` })
          await page.reload(); await settle(page)
          const again = await litOnly(page, item)
          check(`${who}: refresh after My leave → Leave keeps My leave lit`, again.ok, again.detail)
        }
      }

      if (has('My team')) {
        await clickRail(page, 'My team')
        const r = await litOnly(page, 'My team')
        check(`${who}: Team click lights My team`, r.ok, r.detail)
      }
      if (has('Attendance & time')) {
        await clickRail(page, 'Attendance & time')
        const r = await litOnly(page, 'Attendance & time')
        check(`${who}: Attendance click lights Attendance & time`, r.ok, r.detail)
      }

      // A link opened fresh (nothing remembered in this tab): the page's own admin item, else My work's.
      for (const [path, title] of [['/hrms/leave', has('Leave') ? 'Leave' : has('My leave') ? 'My leave' : null], ['/me', has('Home') ? 'Home' : null], ['/team', has('My team') ? 'My team' : null],
        ['/hrms/attendance', has('Attendance & time') ? 'Attendance & time' : has('My time') ? 'My time' : null]]) {
        if (!title) continue
        await openFresh(page, path)
        const r = await litOnly(page, title)
        check(`${who}: a fresh ${path} lights ${title}`, r.ok, r.detail)
      }

      // Any other way onto a page (a card on Home, a button on a page, search, Back) goes by the page:
      // an earlier My leave visit does not light My leave there.
      if (has('My leave') && has('Leave')) {
        await clickRail(page, 'My leave')
        await page.goto(base + '/dashboard'); await settle(page)
        const homeAt = new URL(page.url()).pathname
        const card = page.getByText(HOME_LEAVE).filter({ visible: true }).first()
        if (await card.isVisible().catch(() => false)) {
          const label = (await card.textContent()).trim()
          await card.click(); await settle(page)
          const r = await litOnly(page, 'Leave')
          check(`${who}: My leave, a load of Home (/dashboard → ${homeAt}), then its "${label}" lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        } else if (who === 'mgr') check(`${who}: Home shows a way into Leave`, false, `nothing matching ${HOME_LEAVE} at ${where(page)}`)
        else console.log(`SKIP  ${who}: no leave card on Home`)

        // My leave opens /hrms/leave itself; leave it (More → My profile) so search is a new arrival there.
        await clickRail(page, 'My leave')
        await (await openMore(page)).getByRole('link', { name: 'My profile', exact: true }).click(); await settle(page)
        const input = page.locator('input[aria-controls="top-search-results"]').filter({ visible: true }).first()
        await input.click(); await input.fill('leave')
        const opts = page.locator('[role=option]').filter({ visible: true })
        await opts.first().waitFor({ timeout: 15_000 }).catch(() => {})
        const texts = (await opts.allTextContents()).map((t) => t.trim())
        const i = texts.findIndex((t) => /^Leave/i.test(t) && !/rule|setting|polic|type|balance|encash|calendar|approv/i.test(t))
        if (i >= 0) {
          await opts.nth(i).click(); await settle(page)
          const r = await litOnly(page, 'Leave')
          check(`${who}: My leave, My profile, then search "leave" → the Leave page lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        } else check(`${who}: search "leave" offers the Leave page`, false, JSON.stringify(texts.slice(0, 6)))
        await page.keyboard.press('Escape').catch(() => {})

        await clickRail(page, 'Leave'); await clickRail(page, 'My time')
        await page.goBack(); await settle(page)
        const r = await litOnly(page, 'Leave')
        check(`${who}: Leave, My time, then Back to /hrms/leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
      }
      if (has('My team') && has('Attendance & time')) {
        await clickRail(page, 'My team')
        await page.getByRole('button', { name: /Team attendance/ }).first().click({ timeout: 15_000 }); await settle(page)
        let r = await litOnly(page, 'Attendance & time')
        check(`${who}: My team, then the page's "Team attendance" button lights Attendance & time`, r.ok && new URL(page.url()).pathname === '/hrms/attendance', r.detail)
        await clickRail(page, 'My team'); await clickRail(page, 'Attendance & time')
        await page.goBack(); await settle(page)
        r = await litOnly(page, 'My team')
        check(`${who}: My team, Attendance & time, then Back to /team lights My team`, r.ok && new URL(page.url()).pathname === '/team', r.detail)
      }
      if (who === 'owner') {
        // Settings pages light More (the gear's successor) and no rail item; HR setup's pages light HR
        // setup; Workforce's rules and policy documents light Workforce; Payroll settings light Payroll;
        // expense policies light Expenses. An item that moved into More for lack of room lights More.
        for (const [path, want] of [['/settings/profile', null], ['/roles', null], ['/users', null], ['/hrms/settings', 'HR setup'], ['/hrms/notification-templates', 'HR setup'],
          ['/hrms/integrations', 'HR setup'], ['/hrms/master/shift-rules', 'Workforce'], ['/hrms/policies', 'Workforce'], ['/hrms/payroll/settings', 'Payroll'], ['/hrms/expenses?tab=policies', 'Expenses']]) {
          await openFresh(page, path)
          const r = await rail(page)
          const onRail = want && r.items.includes(want)
          const ok = onRail ? r.lit.length === 1 && r.lit[0] === want && !r.more : r.lit.length === 0 && r.more
          check(`${who}: ${path} lights ${onRail ? want : want ? `More (${want} is in More)` : 'More and no rail item'}`, ok, `lit: ${JSON.stringify(r.lit)}, More ${r.more ? 'lit' : 'not lit'}`)
        }
        // A rail click, then More → Preferences: More alone is lit.
        const from = has('HR setup') ? 'HR setup' : items[0]
        await clickRail(page, from)
        const more = await openMore(page)
        await more.getByRole('button', { name: 'Preferences' }).or(more.getByRole('link', { name: 'Preferences' })).first().click(); await settle(page)
        const r = await rail(page)
        check(`${who}: ${from}, then More → Preferences lights More alone`, r.lit.length === 0 && r.more && new URL(page.url()).pathname.startsWith('/settings'), `lit: ${JSON.stringify(r.lit)}, More ${r.more ? 'lit' : 'not lit'} at ${where(page)}`)
      }
    } catch (e) {
      check(`${who}: run finished`, false, String(e.message || e).slice(0, 300))
    } finally { await context.close() }
  }

  // Signing out forgets the remembered rail item: the next person in this browser tab starts from the page alone.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const page = await login(context, 'mgr@unifiedtree.demo')
      watch(page, 'sign-out')
      await page.goto(base + '/profile'); await settle(page)
      await clickRail(page, 'My leave')
      const via = await page.evaluate(() => { try { return sessionStorage.getItem('ut:rail-via') } catch { return null } })
      check('a My leave click is remembered in this tab', !!via, String(via))
      const more = await openMore(page)
      await more.getByRole('button', { name: 'Sign out' }).click()
      await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 })
      const kept = await page.evaluate(() => { try { return sessionStorage.getItem('ut:rail-via') } catch { return 'unreadable' } })
      check('sign out forgets the remembered rail item', kept === null, String(kept))
      await page.locator('input[type=email]').fill('hrm@unifiedtree.demo')
      await page.locator('input[type=password]').fill(password)
      await page.locator('button[type=submit]').click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 60_000 })
      await page.goto(base + '/dashboard'); await settle(page)
      const card = page.getByText(HOME_LEAVE).filter({ visible: true }).first()
      await card.click({ timeout: 15_000 }); await settle(page)
      const r = await litOnly(page, 'Leave')
      check('the next person signed in to the same tab: the leave card on Home lights Leave', r.ok, r.detail)
    } catch (e) {
      check('sign-out run finished', false, String(e.message || e).slice(0, 300))
    } finally { await context.close() }
  }

  // Phone width: the navigation drawer follows the same rule.
  for (const [who, email] of ACCOUNTS.filter(([w]) => ['mgr', 'hrm', 'reader', 'owner'].includes(w))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    try {
      const page = await login(context, email)
      watch(page, `${who} (phone)`)
      await page.goto(base + '/me'); await settle(page)
      const { nav, lit } = await mobileLit(page)
      const entries = await nav.locator('a').evaluateAll(drawerName)
      await page.getByRole('button', { name: 'Close navigation' }).click()
      const has = (t) => entries.includes(t)
      if (has('Home')) check(`${who} (phone): /me lights Home`, lit.length === 1 && lit[0] === 'Home', JSON.stringify(lit))

      if (has('Leave')) {
        await mobileGo(page, 'Leave')
        let r = await mobileLitIs(page, 'Leave')
        check(`${who} (phone): Leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        if (shots && who === 'mgr') { await mobileLit(page); await page.screenshot({ path: `${shots}/railfix-mgr-leave-click-390.png` }); await page.getByRole('button', { name: 'Close navigation' }).click() }
        await page.reload(); await settle(page)
        r = await mobileLitIs(page, 'Leave')
        check(`${who} (phone): refresh keeps Leave lit`, r.ok, r.detail)
      }
      if (has('My leave')) {
        await mobileGo(page, 'My leave')
        const r = await mobileLitIs(page, 'My leave')
        check(`${who} (phone): My leave → Leave keeps My leave lit`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        if (shots && who === 'mgr') {
          await page.screenshot({ path: `${shots}/railfix-mgr-my-leave-390.png` })
          await mobileLit(page); await page.screenshot({ path: `${shots}/railfix-mgr-my-leave-390-drawer.png` }); await page.getByRole('button', { name: 'Close navigation' }).click()
        }
      }
      if (has('My team')) {
        await mobileGo(page, 'My team')
        const r = await mobileLitIs(page, 'My team')
        check(`${who} (phone): My team lights My team`, r.ok, r.detail)
      }
      if (has('My time') && has('Leave')) {
        await mobileGo(page, 'Leave'); await mobileGo(page, 'My time')
        // My time has several pages: on a phone its Pages panel opens over the page; close it.
        const hide = page.getByRole('button', { name: 'Hide pages' })
        if (await hide.isVisible().catch(() => false)) await hide.click()
        await page.goBack(); await settle(page)
        const r = await mobileLitIs(page, 'Leave')
        check(`${who} (phone): Leave, My time, then Back to /hrms/leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
      }
      await openFresh(page, '/hrms/leave')
      const want = has('Leave') ? 'Leave' : 'My leave'
      const r = await mobileLitIs(page, want)
      check(`${who} (phone): a fresh /hrms/leave lights ${want}`, r.ok, r.detail)
    } catch (e) {
      check(`${who} (phone): run finished`, false, String(e.message || e).slice(0, 300))
    } finally { await context.close() }
  }

  check('no page errors', !pageErrors.length, pageErrors.slice(0, 3).join(' | '))
  const uniqueApi = [...new Set(failedApi)]
  check('no API 4xx/5xx', !uniqueApi.length, uniqueApi.slice(0, 8).join(' | '))
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
