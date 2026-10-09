// Live check for chakri/hrms-settings-index (owner Q-06, 9 Oct 2026): one HRMS "Settings" page of cards.
//
//   NODE_OPTIONS="--import ./e2e/recovery/_skip-punch-prompt.mjs" \
//     live-slot.sh /c/REACT/ut-wt/chakri-hrms-settings 3109 node e2e/recovery/live-kishore-hrms-settings.mjs
//
//  - owner: the rail's Settings item is there; the index shows the cards; each card opens the page where
//    the setting already lives (nothing moved), and that page opens (no "no access", no 404);
//  - HR manager and finance lead: only the settings their role opens; employee: no cards;
//  - the 26 Sep hub's old addresses still redirect; light, dark, 1440 and 390; no page errors.
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
async function session(email, { width = 1440, theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* ignore */ } }, theme)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 3000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  return { page, errors, close: () => context.close() }
}
async function openIndex(page) {
  await page.goto(base + '/hrms/settings-index', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('heading', { name: 'Settings', exact: true }).first().waitFor({ timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(1500)
  return page.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')))
}
const deny = /don.t have access|no access|not found|404/i

try {
  // ── Owner ────────────────────────────────────────────────────────────────
  const owner = await session('owner@unifiedtree.demo')
  await owner.page.goto(base + '/hrms/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await owner.page.waitForTimeout(2500)
  const railText = await owner.page.locator('nav, aside').allInnerTexts().then((t) => t.join(' | ')).catch(() => '')
  check('owner: the HRMS rail has a "Settings" item (was "HR setup")', /\bSettings\b/.test(railText) && !/HR setup/.test(railText), railText.slice(0, 160))
  const ownerCards = await openIndex(owner.page)
  check('owner: the index shows the HR settings as cards', ownerCards.length >= 15, `${ownerCards.length}: ${ownerCards.join(', ')}`)
  await owner.page.screenshot({ path: `${shots}/kishore-hrms-settings-owner-1440.png`, fullPage: true })
  for (const [id, want] of [['hr-config', '/hrms/settings'], ['m-leave-rules', '/hrms/master/leave-rules'], ['notif-templates', '/hrms/notification-templates'], ['pay-settings', '/hrms/payroll/settings']]) {
    if (!ownerCards.includes(id)) { check(`owner: card ${id} opens its page`, false, 'card missing'); continue }
    await openIndex(owner.page)
    await owner.page.locator(`[data-setting="${id}"]`).click()
    await owner.page.waitForURL((u) => u.pathname === want, { timeout: 30000 }).catch(() => {})
    await owner.page.waitForTimeout(2000)
    const body = await owner.page.locator('main').innerText().catch(() => '')
    check(`owner: "${id}" opens where it lives (${want}) and the page opens`, new URL(owner.page.url()).pathname === want && !deny.test(body.slice(0, 400)), owner.page.url())
  }
  await owner.page.goto(base + '/hrms/settings/notifications', { waitUntil: 'domcontentloaded' })
  await owner.page.waitForURL((u) => u.pathname === '/hrms/notification-templates', { timeout: 20000 }).catch(() => {})
  check('the 26 Sep hub addresses still redirect (/hrms/settings/notifications)', new URL(owner.page.url()).pathname === '/hrms/notification-templates', owner.page.url())
  check('owner: no page errors', owner.errors.length === 0, owner.errors.slice(0, 2).join(' | '))
  await owner.close()

  const dark = await session('owner@unifiedtree.demo', { theme: 'dark' })
  await openIndex(dark.page)
  const bg = await dark.page.evaluate(() => getComputedStyle(document.querySelector('[data-setting]')).backgroundColor)
  check('dark: the cards use the dark surface', !/rgb\(255, 255, 255\)/.test(bg), bg)
  await dark.page.screenshot({ path: `${shots}/kishore-hrms-settings-owner-dark.png`, fullPage: true })
  await dark.close()

  const phone = await session('owner@unifiedtree.demo', { width: 390 })
  await openIndex(phone.page)
  const fits = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('phone (390): the cards fit the screen', fits)
  await phone.page.screenshot({ path: `${shots}/kishore-hrms-settings-owner-390.png`, fullPage: true })
  await phone.close()

  // ── HR manager ───────────────────────────────────────────────────────────
  const hrm = await session('hrm@unifiedtree.demo')
  const hrmCards = await openIndex(hrm.page)
  // In this business HR_MANAGER holds every HR setting's permission, so they see all the cards.
  check('HR manager: the HR settings their role opens', hrmCards.length > 0, `${hrmCards.length}: ${hrmCards.join(', ')}`)
  for (const id of hrmCards.slice(0, 3)) {
    await openIndex(hrm.page)
    const href = await hrm.page.locator(`[data-setting="${id}"]`).getAttribute('href')
    await hrm.page.locator(`[data-setting="${id}"]`).click()
    await hrm.page.waitForTimeout(2500)
    const body = await hrm.page.locator('main').innerText().catch(() => '')
    check(`HR manager: "${id}" opens for them`, !deny.test(body.slice(0, 400)), href)
  }
  await hrm.page.screenshot({ path: `${shots}/kishore-hrms-settings-hrm-1440.png`, fullPage: true })
  check('HR manager: no page errors', hrm.errors.length === 0, hrm.errors.slice(0, 2).join(' | '))
  await hrm.close()

  // ── Finance lead: only the money settings their role opens ──────────────
  const fin = await session('fin@unifiedtree.demo')
  const finCards = await openIndex(fin.page)
  check('finance lead: only some settings (fewer than the owner)', finCards.length > 0 && finCards.length < ownerCards.length, `${finCards.length}: ${finCards.join(', ')}`)
  await fin.page.screenshot({ path: `${shots}/kishore-hrms-settings-finance-1440.png`, fullPage: true })
  await fin.close()

  // ── Employee ─────────────────────────────────────────────────────────────
  const emp = await session('reader@unifiedtree.demo')
  const empCards = await openIndex(emp.page)
  const empBody = await emp.page.locator('main').innerText().catch(() => '')
  check('employee: no settings cards', empCards.length === 0, `${empCards.length} / ${empBody.slice(0, 80).replace(/\n/g, ' ')}`)
  await emp.close()
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
