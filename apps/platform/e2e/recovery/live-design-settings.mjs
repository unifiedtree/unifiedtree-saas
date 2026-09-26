// Live check of Profile (/profile) and Workspace Settings (/settings/:tab) in
// the Payroll Settings design's settings pattern, against the local API. The
// owner edits their phone on Profile (saved and checked in the database, then
// put back), a bad phone blocks the save, a switch change can be discarded,
// and a "#st-" link opens at its section. Every Workspace Settings tab renders
// its sections with no page errors or failed API calls. The password-reset
// button is not pressed (it sends an email).
//
//   node e2e/recovery/live-design-settings.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || ''
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const OWNER = 'owner@unifiedtree.demo'
const phone0 = sql(`select coalesce(mobile_number,'<null>') from auth.user_credentials where lower(email)='${OWNER}' limit 1`)

const browser = await chromium.launch()
const session = async (email, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }
const heading = (page, name) => page.getByRole('heading', { name, exact: true })

try {
  const { ctx, page, errors, failed } = await session(OWNER)

  // ── Profile ──
  await page.goto(base + '/profile'); await settle(page)
  await heading(page, 'Personal details').waitFor({ timeout: 30_000 })
  for (const h of ['Employment', 'Personal details', 'Approval delegation', 'My documents', 'Notifications']) check(`profile: "${h}" section renders`, (await heading(page, h).count()) === 1)
  check('profile: "On this page" lists six sections', (await page.getByRole('navigation', { name: 'On this page' }).getByRole('link').count()) === 6)
  if (shots) await page.screenshot({ path: `${shots}/profile.png` })

  const phone = page.getByLabel('Contact phone')
  await phone.fill('abc')
  check('profile: a bad phone shows an error', (await page.getByText(/Enter a phone number/).count()) > 0 && (await page.getByText(/Fix 1 error to save/).count()) === 1)
  const newPhone = phone0 === '+91 90000 11111' ? '+91 90000 22222' : '+91 90000 11111'
  await phone.fill(newPhone)
  check('profile: unsaved bar counts 1 change', (await page.getByText('1 change · not saved yet').count()) === 1)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await page.locator('[role=status]').filter({ hasText: 'Profile updated' }).first().waitFor({ timeout: 15_000 }).catch(() => {})
  check('profile: saving writes the phone', sql(`select mobile_number from auth.user_credentials where lower(email)='${OWNER}' limit 1`) === newPhone)
  check('profile: unsaved bar goes away after saving', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 0)

  await page.getByRole('switch', { name: 'Push notifications' }).click()
  check('profile: a switch change shows the unsaved bar', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 1)
  await page.getByRole('button', { name: 'Discard' }).click()
  check('profile: Discard puts it back', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 0)

  await page.goto(base + '/settings/notifications'); await settle(page)
  await page.goto(base + '/profile#st-delegation'); await settle(page)
  await heading(page, 'Approval delegation').waitFor({ timeout: 30_000 }); await page.waitForTimeout(500)
  const top = await heading(page, 'Approval delegation').evaluate((el) => el.getBoundingClientRect().top)
  check('profile: #st-delegation opens at that section', top < 260, `top=${Math.round(top)}`)
  check('profile: no page errors', !errors.length, errors[0] || '')
  check('profile: no failed API calls', !failed.length, failed.slice(0, 3).join(' | '))

  // ── Workspace Settings tabs ──
  const TABS = {
    profile: ['Your account', 'Organisation'],
    branding: ['Workspace logo'],
    security: ['Password', 'Two-factor authentication', 'Active sessions'],
    notifications: ['What reaches you today', 'Email choices', 'In-app choices'],
    billing: ['Your plan', 'Invoices'],
    integrations: ['Slack', 'GitHub', 'Jira', 'Zapier', 'Stripe', 'Salesforce'],
    documents: ['Document types'],
    danger: ['Export all data', 'Reset workspace', 'Delete organisation'],
  }
  for (const [tab, sections] of Object.entries(TABS)) {
    errors.length = 0; failed.length = 0
    await page.goto(`${base}/settings/${tab}`); await settle(page)
    await heading(page, sections[0]).waitFor({ timeout: 30_000 }).catch(() => {})
    let all = true
    for (const h of sections) if ((await heading(page, h).count()) !== 1) all = false
    check(`settings/${tab}: sections render`, all)
    // The local recovery tenant has no platform.account_workspaces row, so
    // /v1/workspace/plan/current answers 403 "isn't linked to this workspace".
    // That's accepted only when the page says so instead of showing a plan.
    const known = tab === 'billing' && failed.length > 0 && failed.every((f) => f === '403 GET /v1/workspace/plan/current') && (await page.getByText(/couldn’t load your billing details/).count()) === 1
    if (known) console.log('  note: billing 403 from local data (no account link); page shows the load-error note')
    check(`settings/${tab}: no page errors or failed API calls`, !errors.length && (!failed.length || known), errors[0] || failed[0] || '')
    if (shots && ['security', 'billing', 'documents'].includes(tab)) await page.screenshot({ path: `${shots}/settings-${tab}.png` })
  }
  check('security: coming-soon sections say so', (await (async () => { await page.goto(`${base}/settings/security`); await settle(page); return page.getByText('Coming soon', { exact: true }).count() })()) === 2)
  check('danger: requests open an email, not a delete', (await page.goto(`${base}/settings/danger`).then(() => settle(page)).then(() => page.getByRole('link', { name: 'Request deletion' }).getAttribute('href'))).startsWith('mailto:'))
  await ctx.close()

  // ── Phone width ──
  const m = await session(OWNER, 390)
  for (const path of ['/profile', '/settings/billing']) {
    await m.page.goto(base + path); await settle(m.page)
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`phone ${path}: no sideways scroll`, overflow <= 1, `overflow=${overflow}`)
  }
  if (shots) await m.page.screenshot({ path: `${shots}/settings-mobile.png` })
  await m.ctx.close()

  // ── Reader: own profile works; workspace settings don't leak ──
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/profile'); await settle(r.page)
  check('reader: own profile opens', (await heading(r.page, 'Personal details').count()) === 1)
  check('reader: no page errors or failed API calls on profile', !r.errors.length && !r.failed.length, r.errors[0] || r.failed[0] || '')
  await r.page.goto(base + '/settings/danger'); await settle(r.page)
  check('reader: danger zone is not open', (await heading(r.page, 'Delete organisation').count()) === 0)
  await r.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  try { sql(`update auth.user_credentials set mobile_number=${phone0 === '<null>' ? 'null' : `'${phone0}'`} where lower(email)='${OWNER}'`) } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) }
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
