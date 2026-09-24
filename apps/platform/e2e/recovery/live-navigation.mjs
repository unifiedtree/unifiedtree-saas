// Page-to-page navigation: the shell must stay mounted (no full-app remount),
// a page still loading shows its own outline (never a bare "Loading…"), and
// switching is quick once the idle preload has run.
//
//   node e2e/recovery/live-navigation.mjs
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(base + '/dashboard')
  await page.locator('nav[aria-label="Primary"]').waitFor({ timeout: 30000 })
  // Tag the rail's DOM node: if the shell remounts, the tag is gone.
  await page.evaluate(() => { document.querySelector('nav[aria-label="Primary"]').dataset.keep = '1' })

  // Watch for the old full-screen text fallback appearing at any point.
  await page.evaluate(() => {
    window.__bareLoading = 0
    new MutationObserver(() => { for (const el of document.querySelectorAll('div')) if (el.childElementCount === 0 && el.textContent === 'Loading…' && !el.closest('[aria-label="Notifications"]')) window.__bareLoading++ })
      .observe(document.body, { subtree: true, childList: true })
  })
  await page.waitForTimeout(6000) // let the idle preload fetch the reachable pages

  const RAIL = ['Master', 'Attendance', 'Leave', 'Hiring', 'Payroll', 'Expenses', 'Performance', 'Compliance', 'Reports', 'Company', 'Dashboard']
  const times = []
  for (const label of RAIL) {
    const btn = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: label, exact: true })
    if (!(await btn.count())) continue
    const t0 = Date.now()
    await btn.click()
    await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]') && document.querySelector('#workspace-content')?.textContent.trim().length > 40, null, { timeout: 30000 })
    times.push([label, Date.now() - t0])
  }
  console.log('open times (ms):', times.map(([l, t]) => `${l} ${t}`).join(' · '))
  check('the shell is never remounted between pages', await page.evaluate(() => document.querySelector('nav[aria-label="Primary"]')?.dataset.keep === '1'))
  check('no bare "Loading…" screen at any point', (await page.evaluate(() => window.__bareLoading)) === 0)
  const slow = times.filter(([, t]) => t > 2500)
  check('every page opens within 2.5 s after preload', !slow.length, slow.map(([l, t]) => `${l} ${t}ms`).join(', '))
  check('no page errors', !errors.length, errors[0] || '')
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
