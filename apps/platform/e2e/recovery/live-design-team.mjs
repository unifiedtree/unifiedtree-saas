// Live check of the redesigned My team page (/team) against the local API:
// the department manager sees today's tiles, who's in, leave waiting for them
// and the shift roster, with no refused API calls; an employee can't open it.
//
//   node e2e/recovery/live-design-team.mjs
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const browser = await chromium.launch()
const session = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
try {
  const m = await session('mgr@unifiedtree.demo')
  await m.page.goto(base + '/team'); await settle(m.page)
  for (const t of ['Present', 'Not marked yet', 'On leave']) check(`manager: "${t}" tile`, (await m.page.getByText(t, { exact: true }).count()) > 0)
  for (const h of ['Who’s in today', 'Shift roster']) check(`manager: "${h}" section`, (await m.page.getByText(h, { exact: true }).count()) > 0)
  check('manager: no refused API calls or page errors', !m.failed.length && !m.errors.length, m.failed[0] || m.errors[0] || '')
  await m.ctx.close()
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/team'); await settle(r.page)
  check('employee: My team stays closed', (await r.page.getByText('Who’s in today', { exact: true }).count()) === 0)
  await r.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
