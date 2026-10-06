/* global URL, console, fetch, process */
// Web partial sweep (6 Oct 2026), browser acceptance against a running backend and web app:
//  1. A-18 /hrms opens HRMS's home: the owner lands on the admin dashboard (/dashboard), an employee on
//     their own Home (/me) — no "Page not found". /hrms/ (trailing slash) too.
//  2. E-10 the Departments page loads the branches: GET /v1/hrms/branches answers 200 there, and
//     Add department's "Branches" field lists the company's active branch. Nothing is saved.
//  3. C-15 the admin dashboard still draws with the unreachable Upcoming Milestones card removed.
// Nothing is created, so there is nothing to remove.
//
// Run from apps/platform:  node e2e/recovery/live-w3-websweep.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3002), RECOVERY_DB (default ut_w3_dev),
//        RECOVERY_PASSWORD, SHOTS (screenshot folder; "0" for none)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.SHOTS === '0' ? null : (process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots')
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
if (shots) mkdirSync(shots, { recursive: true })

const browser = await chromium.launch({ headless: true })

/** A signed-in page. Page errors and failed API calls are collected after sign-in. */
async function signIn(email, { width = 1440, height = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = [], failedApi = [], okApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => {
    if (!r.url().includes('/api/')) return
    const p = `${r.request().method()} ${new URL(r.url()).pathname}`
    if (r.status() >= 400) failedApi.push(`${r.status()} ${p}`); else okApi.push(p)
  })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1000)
  errors.length = 0; failedApi.length = 0; okApi.length = 0
  return { ctx, page, errors, failedApi, okApi }
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/w42-websweep-${name}.png` }) }
const notFound = (page) => page.getByTestId('not-found')
const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(800) }

try {
  // ── 1 + 3. /hrms opens HRMS's home ─────────────────────────────────────────
  for (const v of [{ width: 1440, tag: '1440' }, { width: 390, tag: '390' }]) {
    const height = v.width < 600 ? 844 : 1000
    const owner = await signIn('owner@unifiedtree.demo', { width: v.width, height })
    for (const addr of ['/hrms', '/hrms/']) {
      await owner.page.goto(base + addr)
      await owner.page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 60_000 }).catch(() => {})
      await settle(owner.page)
      const path = new URL(owner.page.url()).pathname
      check(`${v.tag}: owner ${addr} → /dashboard`, path === '/dashboard', path)
      check(`${v.tag}: owner ${addr} is not "Page not found"`, (await notFound(owner.page).count()) === 0)
    }
    check(`${v.tag}: admin dashboard draws (no page errors)`, owner.errors.length === 0, owner.errors.join(' | '))
    check(`${v.tag}: admin dashboard API calls all answer`, owner.failedApi.length === 0, owner.failedApi.join(' | '))
    await shot(owner.page, `owner-hrms-${v.tag}`)
    await owner.ctx.close()

    const reader = await signIn('reader@unifiedtree.demo', { width: v.width, height })
    await reader.page.goto(base + '/hrms')
    await reader.page.waitForURL((u) => u.pathname === '/me', { timeout: 60_000 }).catch(() => {})
    await settle(reader.page)
    const rpath = new URL(reader.page.url()).pathname
    check(`${v.tag}: employee /hrms → their Home (/me)`, rpath === '/me', rpath)
    check(`${v.tag}: employee /hrms is not "Page not found"`, (await notFound(reader.page).count()) === 0)
    check(`${v.tag}: employee Home draws (no page errors)`, reader.errors.length === 0, reader.errors.join(' | '))
    await shot(reader.page, `reader-hrms-${v.tag}`)
    await reader.ctx.close()
  }

  // ── 2. Departments page loads the branches ─────────────────────────────────
  const branch = sql(`select name from org.branches where company_id='${company}' and is_active order by name limit 1`)
  check('fixture: the company has an active branch', !!branch)
  for (const v of [{ width: 1440, tag: '1440' }, { width: 390, tag: '390' }]) {
    const owner = await signIn('owner@unifiedtree.demo', { width: v.width, height: v.width < 600 ? 844 : 1000 })
    await owner.page.goto(base + '/hrms/master/departments')
    await settle(owner.page)
    check(`${v.tag}: departments page asks for the branches`, owner.okApi.some((p) => p === 'GET /api/v1/hrms/branches'), owner.okApi.filter((p) => p.includes('branch')).join(' | ') || 'none')
    const add = owner.page.getByRole('button', { name: 'Add department' }).first()
    await add.click({ timeout: 20_000 })
    const drawer = owner.page.getByRole('dialog', { name: 'Add department' })
    await drawer.waitFor({ timeout: 10_000 })
    const chip = drawer.locator('button', { hasText: branch })
    check(`${v.tag}: Add department → Branches lists "${branch}"`, (await chip.count()) > 0)
    await shot(owner.page, `departments-add-${v.tag}`)
    await drawer.getByRole('button', { name: 'Close' }).first().click()
    check(`${v.tag}: departments page has no page errors`, owner.errors.length === 0, owner.errors.join(' | '))
    check(`${v.tag}: departments page API calls all answer`, owner.failedApi.length === 0, owner.failedApi.join(' | '))
    await owner.ctx.close()
  }
} catch (e) {
  check('run finished without an exception', false, String(e).split('\n')[0])
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
