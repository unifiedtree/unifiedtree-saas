// Live check: Attendance's sections are the shell's top tabs (the page's own "Attendance sections"
// bar is gone). For owner@, mgr@ (team view) and reader@ (no team view):
//  - no "Attendance sections" bar on /hrms/attendance, /hrms/att-analytics or /hrms/shifts;
//  - owner and mgr: the top bar's "Attendance & time pages" are Attendance Analytics, Daily Tracking,
//    Shifts & Overtime (the bar's sections, in its order) and each tab opens its address, lit there;
//  - reader: no Analytics anywhere; "My time pages" has Attendance and My shift, and My shift opens
//    /hrms/shifts (their My Shift);
//  - old addresses with ?tab= still open the right view (Daily Logs / Roster for the team, My
//    Attendance for reader);
//  - the section's own views stay inline in the page (its tab list is still there);
//  - light and dark at 1440, light at 390 with no sideways scroll; screenshots to
//    C:/REACT/ut-wt/_results/shots/rd-p-home-att-*.png. No page errors, no failed API calls.
// Read-only.
//
//   node e2e/recovery/live-rd-p-home-att-tabs.mjs      (RECOVERY_APP_URL)
/* global process, console, document, window, localStorage, URL */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3123'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function session(email, { width = 1440, height = 1000, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1500)
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const open = async (page, path) => {
  await page.goto(base + path)
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}
const tabsOf = (page, label) => page.locator(`nav[aria-label="${label}"] a`).evaluateAll((as) => as.map((a) => ({ label: a.textContent.trim(), href: a.getAttribute('href'), on: a.getAttribute('aria-current') === 'page' })))
const noBar = async (page) => (await page.locator('nav[aria-label="Attendance sections"]').count()) === 0
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/rd-p-home-att-${name}.png`, fullPage: true }).catch(() => {})
const TEAM = [['Attendance Analytics', '/hrms/att-analytics'], ['Daily Tracking', '/hrms/attendance'], ['Shifts & Overtime', '/hrms/shifts']]

try {
  for (const who of ['owner', 'mgr']) {
    const s = await session(`${who}@unifiedtree.demo`)
    const { page } = s
    for (const [label, path] of TEAM) {
      await open(page, path)
      check(`${who}: no in-page "Attendance sections" bar on ${path}`, await noBar(page))
      const tabs = await tabsOf(page, 'Attendance & time pages')
      check(`${who}: the top tabs on ${path} are the bar's sections, in order`, JSON.stringify(tabs.map((t) => [t.label, t.href])) === JSON.stringify(TEAM), tabs.map((t) => t.label).join(' · '))
      check(`${who}: "${label}" is the lit tab on ${path}`, tabs.find((t) => t.on)?.label === label, tabs.find((t) => t.on)?.label)
    }
    // Moving with the tabs.
    await open(page, '/hrms/attendance')
    await page.locator('nav[aria-label="Attendance & time pages"]').getByRole('link', { name: 'Shifts & Overtime' }).click()
    await page.waitForURL((u) => u.pathname === '/hrms/shifts', { timeout: 30_000 })
    check(`${who}: the Shifts & Overtime tab opens /hrms/shifts`, new URL(page.url()).pathname === '/hrms/shifts')
    // Old addresses with a view still open that view; the section's views stay inline.
    await open(page, '/hrms/attendance?tab=team')
    check(`${who}: /hrms/attendance?tab=team opens Daily Logs (inline views kept)`, (await page.getByRole('tab', { name: /^Daily Logs/, selected: true }).count()) === 1)
    await open(page, '/hrms/shifts?tab=roster')
    check(`${who}: /hrms/shifts?tab=roster still opens the roster`, /tab=roster/.test(page.url()) && (await page.getByText(/Roster/).count()) > 0)
    for (const [label, path] of TEAM) {
      await open(page, path)
      await shot(page, `${who}-${path.split('/').pop()}-1440-light`)
      void label
    }
    check(`${who}: no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check(`${who}: no failed API calls`, s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  {
    const s = await session('reader@unifiedtree.demo')
    const { page } = s
    await open(page, '/hrms/attendance')
    check('reader: no in-page "Attendance sections" bar', await noBar(page))
    check('reader: no Attendance & time tabs (no team view)', (await page.locator('nav[aria-label="Attendance & time pages"]').count()) === 0)
    const tabs = await tabsOf(page, 'My time pages')
    check('reader: My time has Attendance then My shift (the bar\'s Daily Tracking and Shifts & Overtime)',
      tabs[0]?.label === 'Attendance' && tabs[1]?.label === 'My shift' && tabs[1]?.href === '/hrms/shifts', tabs.map((t) => t.label).join(' · '))
    check('reader: no Analytics link anywhere on the page', (await page.getByRole('link', { name: /Attendance Analytics/ }).count()) === 0)
    check('reader: My Attendance is their view', (await page.getByRole('tab', { name: /^My Attendance/, selected: true }).count()) === 1)
    await shot(page, 'reader-attendance-1440-light')
    await page.locator('nav[aria-label="My time pages"]').getByRole('link', { name: 'My shift' }).click()
    await page.waitForURL((u) => u.pathname === '/hrms/shifts', { timeout: 30_000 })
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(800)
    const lit = (await tabsOf(page, 'My time pages')).find((t) => t.on)?.label
    check('reader: My shift opens /hrms/shifts and is lit there', lit === 'My shift', lit)
    check('reader: /hrms/shifts shows their My Shift', (await page.getByRole('heading', { name: 'My Shift', level: 1 }).count()) === 1)
    await shot(page, 'reader-shifts-1440-light')
    check('reader: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('reader: no failed API calls', s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // Dark at 1440 and phones at 390.
  for (const who of ['owner', 'mgr', 'reader']) {
    const d = await session(`${who}@unifiedtree.demo`, { theme: 'dark' })
    await open(d.page, '/hrms/attendance')
    check(`${who} dark: dark theme is on`, (await d.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
    await shot(d.page, `${who}-attendance-1440-dark`)
    check(`${who} dark: no page errors`, d.errors.length === 0, d.errors.slice(0, 3).join(' | '))
    await d.ctx.close()
    for (const theme of ['light', 'dark']) {
      const m = await session(`${who}@unifiedtree.demo`, { width: 390, height: 844, theme })
      await open(m.page, '/hrms/attendance')
      check(`${who} 390 ${theme}: no sideways scroll on /hrms/attendance`, await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5))
      check(`${who} 390 ${theme}: no in-page sections bar`, await noBar(m.page))
      await shot(m.page, `${who}-attendance-390-${theme}`)
      await m.ctx.close()
    }
  }
} catch (e) {
  check('script completed', false, String(e.message || e).split('\n')[0].slice(0, 300))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
