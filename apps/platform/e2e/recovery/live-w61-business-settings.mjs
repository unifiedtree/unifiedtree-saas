// Live check for fix/invite-and-business-settings (2): the launcher's "Business settings" open the
// business's own pages, outside the HRMS module — no HRMS rail, no HRMS company selector.
// Since 10 Oct 2026 (owner) they are not cards on the launcher: its top bar's "Business settings" button
// opens the first one, with all of them as the business frame's left menu.
//
//   live-slot.sh /c/REACT/ut-wt/w61-bizfix 3161 node e2e/recovery/live-w61-business-settings.mjs
//
// For the owner, at 1440 and 390 wide: the launcher, its button, then each menu item. Prints where each goes
// and what chrome that page has, takes a screenshot of each, and fails on page errors or API 5xx.
// Read-only: nothing is created.
/* global process, console, URL, document */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3161'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const tag = process.env.W61_TAG || 'after'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

const browser = await chromium.launch()
const errors = []
const apiFailures = []

async function signIn(email, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.on('pageerror', (e) => errors.push(`${email}@${width}: ${e.message}`))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) apiFailures.push(`${r.status()} ${r.url()}`) })
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 4000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  return page
}
async function toLauncher(page) {
  await page.goto(base + '/modules', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('heading', { name: 'Choose an app' }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(1200)
}
// The launcher's "Business settings" button (its label is hidden on a phone), and the business frame's left menu.
const settingsButton = (page) => page.locator('a.ut-biz__apps[href^="/business/"]')
const menu = (page) => page.getByRole('navigation', { name: 'Business settings' })
const menuNames = async (page) => (await menu(page).getByRole('link').allInnerTexts()).map((t) => t.trim())
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '')

/** What chrome the page has: the HRMS rail, its company selector, and the HRMS modules listed. */
async function chrome(page) {
  return page.evaluate(() => ({
    rail: !!document.querySelector('.ut-rail'),
    company: !!document.querySelector('.ut-cosel'),
    hrmsItems: [...document.querySelectorAll('.ut-rail__item .ut-rail__label')].map((e) => e.textContent?.trim()).filter(Boolean),
    heading: document.querySelector('main h1, h1')?.textContent?.trim() ?? '',
  }))
}

// Where each card should open: the business frame (/business/*). Before this fix they opened /settings,
// /settings/branding, /users, /roles, /settings/billing and /audit-logs inside the HRMS shell.
const EXPECT = {
  'Business details': '/business/details',
  Branding: '/business/branding',
  'Users & access': '/business/users',
  'Roles & permissions': '/business/roles',
  'Billing & plan': '/business/billing',
  'Audit logs': '/business/audit-logs',
}

try {
  for (const width of [1440, 390]) {
    const page = await signIn('owner@unifiedtree.demo', width)
    await toLauncher(page)
    await page.screenshot({ path: `${shots}/w61-${tag}-launcher-${width}.png`, fullPage: true })
    await settingsButton(page).click()
    await page.waitForURL((u) => u.pathname !== '/modules', { timeout: 15000 }).catch(() => {})
    await menu(page).waitFor({ timeout: 30000 }).catch(() => {})
    const names = await menuNames(page)
    check(`${width}: the launcher's Business settings button opens the business frame, the settings as its menu`, names.length >= 6 && new URL(page.url()).pathname.startsWith('/business/'), `${new URL(page.url()).pathname}: ${names.join(' | ')}`)
    for (const name of names) {
      await menu(page).getByRole('link', { name, exact: true }).click()
      if (EXPECT[name]) await page.waitForURL((u) => u.pathname === EXPECT[name], { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(2500)
      const url = new URL(page.url())
      const c = await chrome(page)
      console.log(`INFO  ${width} "${name}" -> ${url.pathname}${url.search}  rail=${c.rail} company=${c.company} h1="${c.heading}" railItems=[${c.hrmsItems.join(', ')}]`)
      await page.screenshot({ path: `${shots}/w61-${tag}-${slug(name)}-${width}.png`, fullPage: false })
      if (EXPECT[name]) check(`${width}: "${name}" opens ${EXPECT[name]}`, url.pathname === EXPECT[name], url.pathname)
      check(`${width}: "${name}" has no HRMS rail or company selector`, !c.rail && !c.company, `rail=${c.rail} company=${c.company}`)
      check(`${width}: "${name}" shows its page`, !!c.heading && !/restricted|not found/i.test(c.heading), c.heading)
    }
    // "All apps" in the business frame goes back to the launcher.
    await page.goto(base + '/business/users', { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: 'All apps' }).click()
    await page.waitForURL((u) => u.pathname === '/modules', { timeout: 15000 }).catch(() => {})
    check(`${width}: "All apps" goes back to the launcher`, new URL(page.url()).pathname === '/modules', page.url())
    await page.close()
  }
  // The HRMS shell's own Settings pages are unchanged (More → Settings still opens them with the rail).
  const owner = await signIn('owner@unifiedtree.demo', 1440)
  await owner.goto(base + '/users', { waitUntil: 'domcontentloaded' }); await owner.waitForTimeout(2500)
  check('/users (HRMS shell) still opens with the rail', (await chrome(owner)).rail)
  await owner.close()
  // An employee can't open a business page by its address.
  const reader = await signIn('reader@unifiedtree.demo', 1440)
  await reader.goto(base + '/business/users', { waitUntil: 'domcontentloaded' }); await reader.waitForTimeout(2500)
  const r = await chrome(reader)
  check('employee: /business/users does not show Users & access', r.heading !== 'Users & access', r.heading)
  await reader.screenshot({ path: `${shots}/w61-${tag}-employee-business-users-1440.png` })
  await reader.close()
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  check('no API 5xx', apiFailures.length === 0, apiFailures.slice(0, 3).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
