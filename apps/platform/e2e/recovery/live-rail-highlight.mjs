// Rail highlight: the rail item you click is the one lit. A manager's Leave,
// Attendance and Team pages are also tabs of "Me"; clicking Leave used to light
// Me. Now the item you came through stays lit (Leave → Leave, Me → its Leave
// tab → Me), a fresh link lights the page's own item, and a refresh keeps it.
// The click counts only on the page it opened: a dashboard card, a button on a
// page, search, Back or a new sign-in go by the page alone. Settings pages light
// what they lit before 26 Sep (the header gear, HR Setup, Master, Payroll).
// Read-only: it only opens pages (and signs out and in once).
//
//   RECOVERY_APP_URL=http://demo.localhost:3040 node e2e/recovery/live-rail-highlight.mjs
//   RAIL_BEFORE_URL=<app with the old code>  also compares the Leave page a Leave click opens
//   RAIL_SHOTS=<folder>                       saves the manager screenshots there
/* global console, process, URL, document, getComputedStyle, sessionStorage */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const before = process.env.RAIL_BEFORE_URL || ''
const shots = process.env.RAIL_SHOTS || ''
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const ACCOUNTS = [
  ['owner', 'owner@unifiedtree.demo'], ['admin', 'admin@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'],
  ['fin', 'fin@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo'],
]
// Pages that draw their own section bar, so the shell shows no tab row there (PlatformShell OWN_SECTION_BAR).
const OWN_BAR = /^\/hrms\/(att-analytics|attendance|shifts|payroll-dashboard|salary-structure|payroll\/runs|payroll\/settings|pli|advances|bank-disbursement|employees|organization|policies|payroll\/components|master)(\/|$)/
const ME = 'Employee Self Service'

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(context, email, url = base) {
  const page = await context.newPage()
  await page.goto(url + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}

async function settle(page) {
  await page.waitForTimeout(250)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(150)
}

// The desktop rail: every item's full name, and the lit ones (aria-current="page").
const rail = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll('nav[aria-label="Primary"]')].find((n) => n.offsetParent !== null || getComputedStyle(n).display !== 'none')
  // Rail items (the workspace tile at the top is the way home, not an item).
  const buttons = nav ? [...nav.querySelectorAll('button[title]:not([aria-label])')] : []
  return { items: buttons.map((b) => b.title), lit: buttons.filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.title) }
})
// The shell's section tab row under the header (not a page's own section bar).
const SHELL_ROW = 'nav[aria-label$=" sections"]:has(> .ds-subnav-scroll)'
const tabRow = (page) => page.evaluate((sel) => {
  const nav = document.querySelector(sel)
  if (!nav) return null
  const links = [...nav.querySelectorAll('a')]
  return { label: nav.getAttribute('aria-label'), tabs: links.map((a) => a.textContent.trim()), current: links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent.trim()) }
}, SHELL_ROW)
const where = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const leaveView = (page) => page.locator('[role=group][aria-label="Leave views"] button[aria-pressed="true"]').first().textContent({ timeout: 15_000 }).then((t) => t.trim()).catch(() => null)

async function clickRail(page, title) {
  await page.locator('nav[aria-label="Primary"]').first().locator(`button[title="${title}"]`).click()
  await settle(page)
}
async function clickTab(page, label) {
  await page.locator(SHELL_ROW).getByRole('link', { name: label, exact: true }).click()
  await settle(page)
}
// A link opened with nothing remembered in this browser tab (bookmark, email link, a new tab):
// forget the rail item this tab came through (railLit.ts keeps it in sessionStorage), then load.
async function openFresh(page, path) {
  await page.evaluate(() => { try { sessionStorage.removeItem('ut:rail-via') } catch { /* ignore */ } })
  await page.goto(base + path)
  await settle(page)
}
const litOnly = async (page, title) => { const r = await rail(page); return { ok: r.lit.length === 1 && r.lit[0] === title, detail: `lit: ${JSON.stringify(r.lit)} at ${where(page)}` } }

// Mobile drawer: open it, read the lit entry, close it.
async function mobileLit(page) {
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const nav = page.locator('nav[aria-label="Primary"]').last()
  await nav.waitFor()
  const lit = await nav.locator('button[aria-current="page"]').allTextContents()
  return { nav, lit: lit.map((t) => t.trim()) }
}
async function mobileGo(page, label) {
  const { nav } = await mobileLit(page)
  await nav.getByRole('button', { name: label, exact: true }).click()
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

// What a Leave click opens with the old code (URL and view), to compare against.
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
      // Start on a page no rail item owns (the dashboard asks employees for approvals they can't see, a known 403).
      await page.goto(base + '/profile'); await settle(page)
      const { items } = await rail(page)
      check(`${who}: the rail shows`, items.length > 0, items.join(', '))
      const has = (t) => items.includes(t)

      // Every rail item: the clicked one is the only one lit; every tab in its row keeps it lit.
      const bad = []
      for (const title of items) {
        await clickRail(page, title)
        const lit = await litOnly(page, title)
        if (!lit.ok) { bad.push(`${title} → ${lit.detail}`); continue }
        const row = await tabRow(page)
        if (!row) continue
        for (const tab of row.tabs) {
          await clickTab(page, tab)
          const now = await litOnly(page, title)
          const path = new URL(page.url()).pathname
          const after = await tabRow(page)
          if (!now.ok) bad.push(`${title} › ${tab} → ${now.detail}`)
          else if (OWN_BAR.test(path)) { if (after) bad.push(`${title} › ${tab}: a tab row on a page with its own bar`) }
          else if (!after || after.label !== row.label || !after.current.includes(tab)) bad.push(`${title} › ${tab}: row ${JSON.stringify(after)}`)
          // A page with its own bar has no row to go on from: step back to the section.
          if (OWN_BAR.test(path)) { await page.goBack(); await settle(page) }
        }
      }
      check(`${who}: every rail item and every tab in its row keeps that item lit`, !bad.length, bad.slice(0, 4).join(' | '))

      if (has('Leave Management')) {
        await clickRail(page, 'Leave Management')
        let r = await litOnly(page, 'Leave Management')
        check(`${who}: Leave click lights Leave`, r.ok, r.detail)
        const opened = { at: where(page), view: await leaveView(page) }
        check(`${who}: Leave click opens /hrms/leave on its first view`, opened.at.startsWith('/hrms/leave') && !!opened.view, JSON.stringify(opened))
        if (before) {
          const old = await leaveClickOn(before, email)
          check(`${who}: Leave click opens the same page and view as before`, old.at === opened.at && old.view === opened.view, `before ${JSON.stringify(old)}, now ${JSON.stringify(opened)}`)
        }
        check(`${who}: Leave click shows no section tab row (as before)`, !(await tabRow(page)), JSON.stringify(await tabRow(page)))
        if (shots && who === 'mgr') await page.screenshot({ path: `${shots}/railfix-mgr-leave-click-1440.png` })
        await page.reload(); await settle(page)
        r = await litOnly(page, 'Leave Management')
        check(`${who}: refresh after a Leave click keeps Leave lit`, r.ok, r.detail)
      }

      if (has(ME)) {
        for (const [tab, path] of [['Leave', '/hrms/leave'], ['Attendance', '/hrms/attendance'], ['Team Attendance', '/team'], ['Letters', '/hrms/letters/my']]) {
          await clickRail(page, ME)
          const row = await tabRow(page)
          if (!row?.tabs.includes(tab)) continue
          await clickTab(page, tab)
          const r = await litOnly(page, ME)
          const after = await tabRow(page)
          const rowOk = OWN_BAR.test(path) ? !after : after?.label === `${ME} sections` && after.current.includes(tab)
          check(`${who}: Me → ${tab} keeps Me lit${OWN_BAR.test(path) ? ' (the page draws its own bar, as before)' : ' with Me\'s tab row'}`, r.ok && rowOk && new URL(page.url()).pathname === path, `${r.detail}; row ${JSON.stringify(after)}`)
          if (tab === 'Leave') {
            if (shots && who === 'mgr') await page.screenshot({ path: `${shots}/railfix-mgr-me-leave-1440.png` })
            await page.reload(); await settle(page)
            const again = await litOnly(page, ME)
            const rowAgain = await tabRow(page)
            check(`${who}: refresh after Me → Leave keeps Me lit and its row`, again.ok && rowAgain?.label === `${ME} sections`, again.detail)
          }
        }
      }

      if (has('My Team')) {
        await clickRail(page, 'My Team')
        const r = await litOnly(page, 'My Team')
        check(`${who}: Team click lights Team`, r.ok, r.detail)
      }
      if (has('Attendance & Time')) {
        await clickRail(page, 'Attendance & Time')
        const r = await litOnly(page, 'Attendance & Time')
        check(`${who}: Attendance click lights Attendance`, r.ok, r.detail)
      }

      // A link opened fresh (nothing remembered in this tab): the page's own item.
      for (const [path, title] of [['/hrms/leave', has('Leave Management') ? 'Leave Management' : has(ME) ? ME : null], ['/me', has(ME) ? ME : null], ['/team', has('My Team') ? 'My Team' : null], ['/hrms/attendance', has('Attendance & Time') ? 'Attendance & Time' : has(ME) ? ME : null]]) {
        if (!title) continue
        await openFresh(page, path)
        const r = await litOnly(page, title)
        check(`${who}: a fresh ${path} lights ${title}`, r.ok, r.detail)
      }

      // Any other way onto a page (a dashboard card, a button on a page, search, Back) goes by the
      // page: an earlier Me visit does not light Me there.
      if (has(ME) && has('Leave Management')) {
        await clickRail(page, ME); await clickTab(page, 'Leave')
        await page.goto(base + '/dashboard'); await settle(page)
        const card = page.getByText(/Open leave approvals|Add Time-Off/).filter({ visible: true }).first()
        if (await card.isVisible().catch(() => false)) {
          const label = (await card.textContent()).trim()
          await card.click(); await settle(page)
          const r = await litOnly(page, 'Leave Management')
          check(`${who}: Me → Leave, a load of the dashboard, then its "${label}" lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        } else if (who === 'mgr') check(`${who}: the dashboard shows a leave card`, false, 'no "Open leave approvals" or "Add Time-Off"')
        else console.log(`SKIP  ${who}: no leave card on the dashboard`)

        await clickRail(page, ME)
        const input = page.locator('input[aria-controls="top-search-results"]').filter({ visible: true }).first()
        await input.click(); await input.fill('leave')
        const opts = page.locator('[role=option]').filter({ visible: true })
        await opts.first().waitFor({ timeout: 15_000 }).catch(() => {})
        const texts = (await opts.allTextContents()).map((t) => t.trim())
        const i = texts.findIndex((t) => /^Leave/i.test(t) && !/rule|setting|polic|type|balance|encash|calendar|approv/i.test(t))
        if (i >= 0) {
          await opts.nth(i).click(); await settle(page)
          const r = await litOnly(page, 'Leave Management')
          check(`${who}: Me, then search "leave" → the Leave page lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        } else check(`${who}: search "leave" offers the Leave page`, false, JSON.stringify(texts.slice(0, 6)))
        await page.keyboard.press('Escape').catch(() => {})

        await clickRail(page, 'Leave Management'); await clickRail(page, ME)
        await page.goBack(); await settle(page)
        const r = await litOnly(page, 'Leave Management')
        check(`${who}: Leave, Me, then Back to /hrms/leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
      }
      if (has(ME) && has('My Team') && has('Attendance & Time')) {
        await clickRail(page, ME); await clickTab(page, 'Team Attendance')
        await page.getByRole('button', { name: /Team attendance/ }).first().click(); await settle(page)
        let r = await litOnly(page, 'Attendance & Time')
        check(`${who}: Me → Team Attendance, then the page's "Team attendance" button lights Attendance`, r.ok && new URL(page.url()).pathname === '/hrms/attendance', r.detail)
        await clickRail(page, 'My Team'); await clickRail(page, ME); await clickTab(page, 'Team Attendance')
        await page.goBack(); await page.goBack(); await settle(page)
        r = await litOnly(page, 'My Team')
        check(`${who}: Team, Me → Team Attendance, then Back twice to /team lights Team`, r.ok && new URL(page.url()).pathname === '/team', r.detail)
      }
      if (who === 'owner') {
        // Settings pages light what they lit before 26 Sep (5f45946): workspace settings light the
        // header gear and no rail item; HR Setup's pages light HR Setup; Master's rules and policy
        // documents light Master; Payroll settings light Payroll; expense policies light Expenses.
        const gearLit = () => page.locator('button[aria-label="Settings"]').filter({ visible: true }).first().evaluate((b) => /ds-hdr-active/.test(b.className)).catch(() => null)
        for (const [path, want] of [['/settings/profile', null], ['/roles', null], ['/users', null], ['/hrms/settings', 'HR Setup'], ['/hrms/notification-templates', 'HR Setup'],
          ['/hrms/integrations', 'HR Setup'], ['/hrms/master/shift-rules', 'Master'], ['/hrms/policies', 'Master'], ['/hrms/payroll/settings', 'Payroll'], ['/hrms/expenses?tab=policies', 'Expense Management']]) {
          await openFresh(page, path)
          const r = await rail(page), gear = await gearLit()
          check(`${who}: ${path} lights ${want ?? 'the header gear and no rail item'} (as before)`, want ? r.lit.length === 1 && r.lit[0] === want && gear === false : r.lit.length === 0 && gear === true, `lit: ${JSON.stringify(r.lit)}, gear ${gear ? 'lit' : 'not lit'}`)
        }
        // A rail click, then the gear: the gear alone is lit.
        await clickRail(page, 'HR Setup')
        await page.locator('button[aria-label="Settings"]').filter({ visible: true }).first().click(); await settle(page)
        const r = await rail(page), gear = await gearLit()
        check(`${who}: HR Setup, then the header gear lights the gear alone`, r.lit.length === 0 && gear === true && new URL(page.url()).pathname === '/settings', `lit: ${JSON.stringify(r.lit)}, gear ${gear ? 'lit' : 'not lit'} at ${where(page)}`)
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
      await clickRail(page, ME); await clickTab(page, 'Leave')
      await page.getByRole('button', { name: 'Account' }).filter({ visible: true }).first().click()
      await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).first().click()
      await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 })
      const kept = await page.evaluate(() => { try { return sessionStorage.getItem('ut:rail-via') } catch { return 'unreadable' } })
      check('sign out forgets the remembered rail item', kept === null, String(kept))
      await page.locator('input[type=email]').fill('hrm@unifiedtree.demo')
      await page.locator('input[type=password]').fill(password)
      await page.locator('button[type=submit]').click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(base + '/dashboard'); await settle(page)
      const card = page.getByText(/Open leave approvals|Add Time-Off/).filter({ visible: true }).first()
      await card.click({ timeout: 15_000 }); await settle(page)
      const r = await litOnly(page, 'Leave Management')
      check('the next person signed in to the same tab: the dashboard leave card lights Leave', r.ok, r.detail)
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
      const entries = (await nav.locator('button').allTextContents()).map((t) => t.trim()).filter(Boolean)
      await page.getByRole('button', { name: 'Close navigation' }).click()
      const has = (t) => entries.includes(t)
      if (has(ME)) check(`${who} (phone): /me lights Me`, lit.length === 1 && lit[0] === ME, JSON.stringify(lit))

      if (has('Leave Management')) {
        await mobileGo(page, 'Leave Management')
        let r = await mobileLitIs(page, 'Leave Management')
        check(`${who} (phone): Leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
        if (shots && who === 'mgr') { await mobileLit(page); await page.screenshot({ path: `${shots}/railfix-mgr-leave-click-390.png` }); await page.getByRole('button', { name: 'Close navigation' }).click() }
        await page.reload(); await settle(page)
        r = await mobileLitIs(page, 'Leave Management')
        check(`${who} (phone): refresh keeps Leave lit`, r.ok, r.detail)
      }
      if (has(ME)) {
        await mobileGo(page, ME)
        const row = await tabRow(page)
        if (row?.tabs.includes('Leave')) {
          await clickTab(page, 'Leave')
          const r = await mobileLitIs(page, ME)
          const after = await tabRow(page)
          check(`${who} (phone): Me → Leave keeps Me lit with Me's tab row`, r.ok && after?.label === `${ME} sections`, `${r.detail}; row ${JSON.stringify(after)}`)
          if (shots && who === 'mgr') {
            await page.screenshot({ path: `${shots}/railfix-mgr-me-leave-390.png` })
            await mobileLit(page); await page.screenshot({ path: `${shots}/railfix-mgr-me-leave-390-drawer.png` }); await page.getByRole('button', { name: 'Close navigation' }).click()
          }
        }
      }
      if (has('My Team')) {
        await mobileGo(page, 'My Team')
        const r = await mobileLitIs(page, 'My Team')
        check(`${who} (phone): Team lights Team`, r.ok, r.detail)
      }
      if (has(ME) && has('Leave Management')) {
        await mobileGo(page, 'Leave Management'); await mobileGo(page, ME)
        await page.goBack(); await settle(page)
        const r = await mobileLitIs(page, 'Leave Management')
        check(`${who} (phone): Leave, Me, then Back to /hrms/leave lights Leave`, r.ok && new URL(page.url()).pathname === '/hrms/leave', r.detail)
      }
      await openFresh(page, '/hrms/leave')
      const want = has('Leave Management') ? 'Leave Management' : ME
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
