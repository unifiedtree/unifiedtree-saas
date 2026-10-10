// Live check for chakri/launcher-settings: business settings on the modules launcher (/modules).
//
//   live-slot.sh /c/REACT/ut-wt/chakri-launcher-settings 3097 node e2e/recovery/live-chakri-launcher-settings.mjs
//
// What it proves, against the local backend. Since 10 Oct 2026 (owner) the settings are not cards on the Apps
// page any more: a "Business settings" button in its top bar opens the first one, with all of them as a left menu.
//  - Owner: the button opens Business details; the menu has Business details, Branding, Users & access,
//    Roles & permissions, Billing & plan and Audit logs; each opens its page. They are not app tiles.
//  - Employee (reader@): no Business settings button at all.
//  - Finance lead (fin@): only the settings their permissions open — never Billing & plan (owner/super admin only).
//  - Phone (390 wide): the menu fits the screen; no page errors anywhere. Searching apps shows no settings as tiles.
// Read-only: nothing is created.
/* global process, console, URL, document, window */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

const browser = await chromium.launch()
const errors = []

async function signIn(email, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`))
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 4000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  await page.goto(base + '/modules', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('heading', { name: 'Choose an app' }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  return page
}
// The Apps page's "Business settings" button (its label is hidden on a phone), and the business frame's left menu.
const settingsButton = (page) => page.locator('a.ut-biz__apps[href^="/business/"]')
const menu = (page) => page.getByRole('navigation', { name: 'Business settings' })
const menuNames = async (page) => (await menu(page).getByRole('link').allInnerTexts()).map((t) => t.trim())
const appTiles = (page) => page.locator('.ut-apps__grid .ut-app', { hasText: /Branding|Billing & plan|Users & access/ })
async function openBusinessSettings(page) {
  await settingsButton(page).click()
  await page.waitForURL((u) => u.pathname.startsWith('/business/'), { timeout: 15000 }).catch(() => {})
  await menu(page).waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
}

try {
  // ── Owner ──
  const owner = await signIn('owner@unifiedtree.demo')
  await settingsButton(owner).waitFor({ timeout: 15000 }).catch(() => {})
  check('owner: the Apps page has the Business settings button', await settingsButton(owner).isVisible())
  check('owner: settings are not app tiles', (await appTiles(owner).count()) === 0)
  await owner.screenshot({ path: `${shots}/chakri-launcher-owner-1440.png`, fullPage: true })
  await owner.getByRole('textbox', { name: 'Search apps' }).fill('hr')
  check('owner: searching apps shows no settings as tiles', (await appTiles(owner).count()) === 0)
  await owner.getByRole('textbox', { name: 'Search apps' }).fill('')
  await openBusinessSettings(owner)
  check('owner: Business settings opens its first page, Business details', new URL(owner.url()).pathname === '/business/details', owner.url())
  const names = await menuNames(owner)
  check('owner: all six in the menu', ['Business details', 'Branding', 'Users & access', 'Roles & permissions', 'Billing & plan', 'Audit logs'].every((n) => names.includes(n)), names.join(' | '))
  for (const [label, path] of [['Branding', '/business/branding'], ['Users & access', '/business/users'], ['Billing & plan', '/business/billing'], ['Business details', '/business/details']]) {
    await menu(owner).getByRole('link', { name: label, exact: true }).click()
    await owner.waitForURL((u) => u.pathname === path, { timeout: 15000 }).catch(() => {})
    check(`owner: "${label}" opens ${path}`, new URL(owner.url()).pathname === path, owner.url())
  }
  await owner.close()

  // ── Employee ──
  const reader = await signIn('reader@unifiedtree.demo')
  check('employee: no Business settings button', (await settingsButton(reader).count()) === 0)
  await reader.close()

  // ── Finance lead ──
  const fin = await signIn('fin@unifiedtree.demo')
  let finNames = []
  if (await settingsButton(fin).count()) { await openBusinessSettings(fin); finNames = await menuNames(fin) }
  check('finance lead: never sees Billing & plan', !finNames.includes('Billing & plan'), finNames.join(' | ') || '(no Business settings)')
  await fin.close()

  // ── Phone ──
  const phone = await signIn('owner@unifiedtree.demo', 390)
  await openBusinessSettings(phone)
  const fit = await menu(phone).evaluate((el) => ({ menu: Math.round(el.getBoundingClientRect().width), page: document.documentElement.scrollWidth, screen: window.innerWidth }))
  check('phone: the menu fits the screen, no sideways page scroll', fit.menu > 0 && fit.menu <= fit.screen && fit.page <= fit.screen + 1, JSON.stringify(fit))
  await phone.screenshot({ path: `${shots}/chakri-launcher-owner-390.png`, fullPage: true })
  await phone.close()

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
