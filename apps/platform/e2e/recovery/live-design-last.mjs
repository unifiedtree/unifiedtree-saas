// Live check of the last pages moved onto the module kit:
//  - PLI for someone without the admin view: "My incentives" with its tiles
//    (the page used to open on an admin tab title for them).
//  - Employee import: kit header, stepper and template step.
//  - Bank profiles & payment tools: kit header, a way back to the designed
//    Bank disbursement page, and the run picker with readable statuses.
// No refused API calls or page errors.
//
//   node e2e/recovery/live-design-last.mjs
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const browser = await chromium.launch()
async function session(email) {
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800) }
try {
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/pli'); await settle(r.page)
  check('pli: an employee sees "My incentives"', (await r.page.getByRole('heading', { name: 'My incentives', level: 1 }).count()) === 1)
  check('pli: with its tiles', (await r.page.getByText('Waiting for approval', { exact: true }).count()) === 1 && (await r.page.getByText('Paid to you', { exact: true }).count()) === 1)
  check('pli: no admin views for them', (await r.page.locator('[aria-label="Incentive views"]').count()) === 0)
  check('employee: no refused calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/employees/import'); await settle(o.page)
  check('import: kit header', (await o.page.getByRole('heading', { name: 'Import employees', level: 1 }).count()) === 1)
  check('import: template step shown', (await o.page.getByText(/template/i).count()) > 0)
  await o.page.goto(base + '/hrms/bank-disbursement/setup'); await settle(o.page)
  check('bank setup: kit header', (await o.page.getByRole('heading', { name: 'Bank profiles & payment tools', level: 1 }).count()) === 1)
  check('bank setup: link back to Bank disbursement', (await o.page.getByRole('link', { name: '← Bank disbursement' }).count()) === 1)
  const opts = await o.page.locator('select').nth(1).locator('option').allInnerTexts()
  check('bank setup: run statuses read as words', opts.length > 0 && !opts.some((t) => /· [A-Z_]{4,}$/.test(t)), opts.slice(0, 2).join(' | '))
  check('owner: no refused calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
