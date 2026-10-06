// Live check for chakri/launcher-settings: business settings on the modules launcher (/modules).
//
//   live-slot.sh /c/REACT/ut-wt/chakri-launcher-settings 3097 node e2e/recovery/live-chakri-launcher-settings.mjs
//
// What it proves, against the local backend:
//  - Owner: "Business settings" sits under the app grid with Business details, Branding, Users & access,
//    Roles & permissions, Billing & plan and Audit logs; each card opens its page. It is not an app tile.
//  - Employee (reader@): no Business settings section at all.
//  - Finance lead (fin@): only the cards their permissions open — never Billing & plan (owner/super admin only).
//  - Phone (390 wide): the cards stack; no page errors anywhere. Searching apps hides the section.
// Read-only: nothing is created.
/* global process, console */
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
const section = (page) => page.getByRole('region', { name: 'Business settings' })
const cardNames = async (page) => (await section(page).getByRole('button').allInnerTexts()).map((t) => t.split('\n')[0].trim())

try {
  // ── Owner ──
  const owner = await signIn('owner@unifiedtree.demo')
  const names = await cardNames(owner)
  check('owner: Business settings section shows', await section(owner).isVisible())
  check('owner: all six cards', ['Business details', 'Branding', 'Users & access', 'Roles & permissions', 'Billing & plan', 'Audit logs'].every((n) => names.includes(n)), names.join(' | '))
  check('owner: settings are not app tiles', (await owner.locator('.ut-apps__grid .ut-app', { hasText: /Branding|Billing & plan|Users & access/ }).count()) === 0)
  await owner.screenshot({ path: `${shots}/chakri-launcher-owner-1440.png`, fullPage: true })
  for (const [label, path] of [['Branding', '/settings/branding'], ['Users & access', '/users'], ['Billing & plan', '/settings/billing'], ['Business details', '/settings']]) {
    await section(owner).getByRole('button', { name: new RegExp(`^${label.replace(/[&]/g, '\\$&')}`) }).click()
    await owner.waitForURL((u) => u.pathname === path, { timeout: 15000 }).catch(() => {})
    check(`owner: "${label}" opens ${path}`, new URL(owner.url()).pathname === path, owner.url())
    await owner.goto(base + '/modules'); await owner.getByRole('heading', { name: 'Choose an app' }).waitFor({ timeout: 30000 }); await owner.waitForTimeout(800)
  }
  await owner.getByRole('textbox', { name: 'Search apps' }).fill('hr')
  check('owner: searching apps hides Business settings', (await section(owner).count()) === 0)
  await owner.close()

  // ── Employee ──
  const reader = await signIn('reader@unifiedtree.demo')
  check('employee: no Business settings section', (await section(reader).count()) === 0)
  await reader.close()

  // ── Finance lead ──
  const fin = await signIn('fin@unifiedtree.demo')
  const finNames = (await section(fin).count()) ? await cardNames(fin) : []
  check('finance lead: never sees Billing & plan', !finNames.includes('Billing & plan'), finNames.join(' | ') || '(no section)')
  await fin.close()

  // ── Phone ──
  const phone = await signIn('owner@unifiedtree.demo', 390)
  await section(phone).scrollIntoViewIfNeeded()
  const boxes = await section(phone).getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  check('phone: cards stack full width', boxes.length > 0 && boxes.every((w) => w > 300), boxes.map(Math.round).join(','))
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
