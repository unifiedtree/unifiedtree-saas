// Live check of the redesigned Performance page (/hrms/performance):
//  - owner: Review cycles, Employee reviews, Goals & KPIs, My reviews, My goals,
//    each once (the old page listed the three admin views twice)
//  - department manager (performance.read, no write): admin views read-only
//  - employee: only My reviews and My goals; adds a goal and saves progress
// No refused API calls or page errors for any of them. The QA goal is removed.
//
//   node e2e/recovery/live-design-performance.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
const viewNames = async (page) => (await page.locator('[aria-label="Performance views"] button').allInnerTexts()).map((t) => t.replace(/\s+\d+$/, '').trim())
const goalTitle = `QA goal ${Date.now()}`
try {
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/performance'); await settle(o.page)
  const ov = await viewNames(o.page)
  check('owner: five views, each once', JSON.stringify(ov) === JSON.stringify(['Review cycles', 'Employee reviews', 'Goals & KPIs', 'My reviews', 'My goals']), ov.join(' | '))
  for (const old of ['Employee Performance', 'Appraisals & 360 Feedback', 'KPI Tracking']) check(`owner: duplicate "${old}" is gone`, (await o.page.getByText(old, { exact: true }).count()) === 0)
  check('owner: can create a cycle', (await o.page.getByRole('button', { name: /Create cycle/ }).count()) === 1)
  for (const v of ['Employee reviews', 'Goals & KPIs', 'My reviews', 'My goals']) {
    await o.page.locator('[aria-label="Performance views"]').getByRole('button', { name: new RegExp(`^${v}`) }).click(); await settle(o.page)
  }
  check('owner: view kept in the URL', o.page.url().includes('view=my-goals'))
  await o.page.goto(base + '/hrms/performance?view=kpis'); await settle(o.page)
  check('owner: KPIs view opens from a link, with "Create KPI"', (await o.page.getByRole('button', { name: /Create KPI/ }).count()) === 1)
  check('owner: no refused API calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()

  const m = await session('mgr@unifiedtree.demo')
  await m.page.goto(base + '/hrms/performance'); await settle(m.page)
  const mv = await viewNames(m.page)
  check('manager: admin views plus their own', mv.length === 5, mv.join(' | '))
  check('manager: read-only (no "Create cycle")', (await m.page.getByRole('button', { name: /Create cycle/ }).count()) === 0)
  await m.page.goto(base + '/hrms/performance?view=kpis'); await settle(m.page)
  check('manager: read-only (no "Create KPI")', (await m.page.getByRole('button', { name: /Create KPI/ }).count()) === 0)
  check('manager: no refused API calls or page errors', !m.failed.length && !m.errors.length, m.failed[0] || m.errors[0] || '')
  await m.ctx.close()

  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/performance?view=cycles'); await settle(r.page)
  const rv = await viewNames(r.page)
  check('employee: only My reviews and My goals', JSON.stringify(rv) === JSON.stringify(['My reviews', 'My goals']), rv.join(' | '))
  check('employee: a link to an admin view falls back to their own', (await r.page.getByRole('button', { name: /Create cycle/ }).count()) === 0)
  await r.page.goto(base + '/hrms/performance?view=my-goals'); await settle(r.page)
  await r.page.locator('#goal-title').fill(goalTitle)
  await r.page.getByRole('button', { name: 'Add goal' }).click()
  await r.page.getByText(goalTitle, { exact: true }).waitFor({ timeout: 15000 })
  check('employee: adds a goal', true)
  const card = r.page.locator('article').filter({ hasText: goalTitle })
  await card.getByRole('slider').fill('40')
  await card.getByRole('button', { name: 'Save' }).click()
  await r.page.getByText('Progress saved', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  const saved = sql(`select progress from performance_mgmt.goals where title='${goalTitle}'`)
  check('employee: saves goal progress', saved === '40', `progress=${saved}`)
  check('employee: no refused API calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  sql(`delete from performance_mgmt.goals where title like 'QA goal %'`)
  check('cleanup: QA goal removed', sql(`select count(*) from performance_mgmt.goals where title like 'QA goal %'`) === '0')
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
