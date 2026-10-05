/* global URL, console, document, process, window */
// Tester report (5 Oct 2026): "Owner must NOT see personal My work menu or Attendance tab" — the owner
// still saw My reviews / My goals on Performance, My claims on Expenses, and so on.
// The rule is the one My work, Leave and Attendance already use (navigation/access.ts `adminRole`,
// useRoles().isAdmin): owners and admins get no personal "My …" views. Browser acceptance:
//  - Owner (OWNER): no My work group in the rail; Performance, Expenses, Advances, Documents, Learning,
//    Letters, Leave and Daily tracking show no personal "My …" view; a direct link to one
//    (?view=my-reviews, ?tab=my, /letters/my, …) opens the module's first view instead (no error, no
//    blank page); Regularization has no "My requests" / "New request"; search offers none of them.
//  - Super admin (SUPER_ADMIN): the same, as My work already treats them.
//  - HR manager, department manager and employee keep every one of those views.
// Screenshots at 1440 and 390 wide go to SHOTS. The test only reads: it creates nothing.
//
// Run from apps/platform:  node e2e/recovery/live-owner-personal-tabs.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3002), RECOVERY_PASSWORD, SHOTS
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
/** "Approvals 3" → "Approvals" (count badges sit inside the pill). */
const bare = (t) => clean(t).replace(/\s+\d+$/, '')

mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ headless: true })

/** A fresh signed-in session. Page errors and failed API calls are collected after sign-in. */
async function signIn(email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}

/**
 * Open a page and read its view bar (a PillTabs/FilterPills group or tablist with this accessible name):
 * the labels, the selected one, and the page's first heading.
 */
async function viewsAt(page, path, label) {
  await page.goto(base + path)
  const bar = page.locator(`[role=group][aria-label="${label}"], [role=tablist][aria-label="${label}"]`).first()
  await Promise.race([
    bar.waitFor({ timeout: 45_000 }),
    page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45_000 }),
  ]).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(700)
  const heading = clean(await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => ''))
  if (!(await bar.count())) return { tabs: [], selected: '', heading }
  const items = bar.locator('button, [role=tab]')
  const tabs = (await items.allInnerTexts()).map(bare)
  const selected = bare(await bar.locator('button[aria-pressed=true], [role=tab][aria-selected=true]').first().innerText().catch(() => ''))
  return { tabs, selected, heading }
}

/** Search in the ⌘K dialog and return the text of every result row. */
async function search(page, text) {
  await page.keyboard.press('Control+k')
  const input = page.locator('input[aria-controls="top-search-results"]')
  await input.waitFor({ timeout: 10_000 })
  await input.fill(text)
  await page.locator('#top-search-results [role=option], #top-search-results [role=status]').first().waitFor({ timeout: 10_000 }).catch(() => {})
  await page.getByTestId('top-search-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(700)
  const rows = await page.locator('#top-search-results [role=option]').allInnerTexts()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  return rows.map(clean)
}

const myWorkGroup = (page) => page.locator('nav[aria-label="Primary"] [role=group][aria-label="My work"]')
const has = (list, re) => list.some((t) => re.test(t))
const show = (v) => `selected="${v.selected}" tabs=[${v.tabs.join(', ')}] h1="${v.heading}"`

// Each personal view: the page, its view bar's name, the personal labels, and (for the owner) the first view a
// direct link falls back to.
const PERSONAL = [
  { key: 'performance', path: '/hrms/performance?view=my-reviews', bar: 'Performance views', mine: /^My (reviews|goals)$/, first: /^Review cycles$/ },
  { key: 'performance goals', path: '/hrms/performance?view=my-goals', bar: 'Performance views', mine: /^My (reviews|goals)$/, first: /^Review cycles$/ },
  { key: 'expenses', path: '/hrms/expenses?tab=my', bar: 'Expense views', mine: /^(My claims|Submit a claim)$/, first: /^Approvals$/ },
  { key: 'expenses submit', path: '/hrms/expenses?tab=submit', bar: 'Expense views', mine: /^(My claims|Submit a claim)$/, first: /^Approvals$/ },
  { key: 'documents', path: '/hrms/documents?view=my', bar: 'Document views', mine: /^My documents$/, first: /^Employee documents$/ },
  { key: 'learning', path: '/hrms/learning?view=my', bar: 'Learning views', mine: /^My training$/, first: /^Programs$/ },
  { key: 'letters', path: '/hrms/letters/my', bar: 'Letter views', mine: /^My letters$/, first: /^Templates$/ },
  { key: 'leave', path: '/hrms/leave?tab=my', bar: 'Leave views', mine: /^(My leave|Apply|Balances)$/, first: /^Approvals$/ },
  { key: 'daily tracking', path: '/hrms/attendance?tab=my', bar: 'Daily tracking views', mine: /^My Attendance$/, first: /^Daily Logs$/ },
]

/** The owner-side checks, shared by the owner and the super admin. */
async function adminChecks(who, s, opts = {}) {
  const { page } = s
  check(`${who}: no My work group in the rail`, (await myWorkGroup(page).count()) === 0)
  for (const p of PERSONAL) {
    const v = await viewsAt(page, p.path, p.bar)
    check(`${who}: ${p.key} has no personal view`, v.tabs.length > 0 && !has(v.tabs, p.mine), show(v))
    check(`${who}: ${p.path} opens the first view instead`, p.first.test(v.selected) && !!v.heading, show(v))
    if (opts.shots && (p.key === 'performance' || p.key === 'expenses')) await page.screenshot({ path: `${shots}/w16-owner-${who.replace(/\s+/g, '-')}-${p.key}-1440.png` })
  }
  // A header action for yourself goes with the view.
  await viewsAt(page, '/hrms/expenses?tab=my', 'Expense views')
  check(`${who}: Expenses has no "New claim" for themselves`, (await page.getByRole('button', { name: /^New claim$/ }).count()) === 0)
  await viewsAt(page, '/hrms/performance?view=my-goals', 'Performance views')
  check(`${who}: Performance has no "Add a goal" for themselves`, (await page.getByRole('button', { name: /^Add a goal$/ }).count()) === 0)

  // Advances: My pay's link (?tab=my) keeps the payroll admin's Advances & Loans, not the self-service page.
  await page.goto(base + '/hrms/advances?tab=my')
  await page.getByText('Advances & Loans').first().waitFor({ timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(800)
  const selfPage = await page.getByRole('heading', { level: 1, name: 'Salary advances' }).count()
  const myAdv = await page.locator('[role=group][aria-label="Advance views"]').count()
  check(`${who}: /hrms/advances?tab=my opens Advances & Loans (no My advances)`, (await page.getByText('Advances & Loans').count()) > 0 && selfPage === 0 && myAdv === 0)

  // Regularization: their team's requests only, no "My requests" or "New request".
  const r = await viewsAt(page, '/hrms/attendance?tab=corrections', 'Whose requests')
  check(`${who}: Regularization has no "My requests" switch`, r.tabs.length === 0, show(r))
  check(`${who}: Regularization has no "New request" for themselves`, (await page.getByRole('button', { name: /^New request$/ }).count()) === 0)
  check(`${who}: Regularization still shows the team's requests`, (await page.getByText('Waiting for your OK').count()) > 0)

  // Search offers none of the personal pages.
  for (const [q, re] of [['my claims', /\bMy (expense )?claims\b/i], ['my reviews', /\bMy reviews\b/i], ['my goals', /\bMy goals\b/i], ['my payslips', /\bMy payslips\b/i],
    ['my documents', /\bMy documents\b/i], ['my training', /\bMy training\b/i], ['submit an expense claim', /\bSubmit an expense claim\b/i]]) {
    const rows = await search(page, q)
    check(`${who}: search doesn't offer "${q}"`, !has(rows, re), rows.slice(0, 4).join(' | ') || 'no results')
  }
  const sanity = await search(page, 'review cycles')
  check(`${who}: search itself works (offers Review cycles)`, has(sanity, /Review cycles/i), sanity.slice(0, 3).join(' | ') || 'no results')
}

try {
  // ── Owner ────────────────────────────────────────────────────────────────────
  {
    const s = await signIn('owner@unifiedtree.demo')
    await adminChecks('owner', s, { shots: true })
    check('owner: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('owner: no failed API calls', s.failedApi.length === 0, s.failedApi.slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── Owner on a phone ─────────────────────────────────────────────────────────
  {
    const s = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    for (const p of [PERSONAL[0], PERSONAL[2]]) {
      const v = await viewsAt(s.page, p.path, p.bar)
      check(`owner (phone): ${p.path} opens the first view, no personal view`, p.first.test(v.selected) && !has(v.tabs, p.mine), show(v))
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(`owner (phone): ${p.key} has no sideways page scroll`, overflow <= 1, `${overflow}px`)
      await s.page.screenshot({ path: `${shots}/w16-owner-owner-${p.key}-390.png` })
    }
    check('owner (phone): no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── Super admin: the same as the owner (My work already treats them so) ─────
  {
    const s = await signIn('admin@unifiedtree.demo')
    await adminChecks('super admin', s)
    check('super admin: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── Everyone else keeps their own views ──────────────────────────────────────
  // [who, email, [path, bar, label that must show, label selected (or null: a one-view page, check the h1)]]
  const STAFF = [
    ['HR manager', 'hrm@unifiedtree.demo', [
      ['/hrms/performance?view=my-reviews', 'Performance views', /^My goals$/, /^My reviews$/],
      ['/hrms/expenses?tab=my', 'Expense views', /^Submit a claim$/, /^My claims$/],
      ['/hrms/documents?view=my', 'Document views', /^Employee documents$/, /^My documents$/],
      ['/hrms/learning?view=my', 'Learning views', /^Programs$/, /^My training$/],
      ['/hrms/letters/my', 'Letter views', /^Templates$/, /^My letters$/],
      ['/hrms/leave?tab=my', 'Leave views', /^Apply$/, /^My leave$/],
      ['/hrms/attendance?tab=my', 'Daily tracking views', /^Daily Logs$/, /^My Attendance$/],
      ['/hrms/advances?tab=my', 'Advance views', /^Request an advance$/, /^My advances$/],
      ['/hrms/attendance?tab=corrections', 'Whose requests', /^My requests$/, /^Team requests$/],
    ]],
    ['dept manager', 'mgr@unifiedtree.demo', [
      ['/hrms/performance?view=my-reviews', 'Performance views', /^My goals$/, /^My reviews$/],
      ['/hrms/expenses?tab=my', 'Expense views', /^Submit a claim$/, /^My claims$/],
      ['/hrms/learning?view=my', 'Learning views', /^Programs$/, /^My training$/],
      ['/hrms/leave?tab=my', 'Leave views', /^Apply$/, /^My leave$/],
      ['/hrms/attendance?tab=corrections', 'Whose requests', /^My requests$/, /^Team requests$/],
      ['/hrms/documents?view=my', 'Document views', null, /^My documents$/],
      ['/hrms/letters/my', 'Letter views', null, /^My letters$/],
    ]],
    ['employee', 'reader@unifiedtree.demo', [
      ['/hrms/performance?view=my-reviews', 'Performance views', /^My goals$/, /^My reviews$/],
      ['/hrms/expenses?tab=my', 'Expense views', /^Submit a claim$/, /^My claims$/],
      ['/hrms/learning?view=my', 'Learning views', /^Programs$/, /^My training$/],
      ['/hrms/documents?view=my', 'Document views', null, /^My documents$/],
      ['/hrms/letters/my', 'Letter views', null, /^My letters$/],
    ]],
  ]
  for (const [who, email, pages] of STAFF) {
    const s = await signIn(email)
    check(`${who}: the My work group is in the rail`, (await myWorkGroup(s.page).count()) > 0)
    for (const [path, bar, shown, selected] of pages) {
      const v = await viewsAt(s.page, path, bar)
      if (shown) check(`${who}: ${path} opens their own view`, has(v.tabs, shown) && selected.test(v.selected), show(v))
      else check(`${who}: ${path} opens their own page`, selected.test(v.heading), show(v))
      if (path.includes('my-reviews') && who === 'HR manager') await s.page.screenshot({ path: `${shots}/w16-owner-hrm-performance-1440.png` })
      if (path.includes('expenses') && who === 'employee') await s.page.screenshot({ path: `${shots}/w16-owner-employee-expenses-1440.png` })
    }
    if (who !== 'employee') {
      await viewsAt(s.page, '/hrms/attendance?tab=corrections', 'Whose requests')
      check(`${who}: Regularization still has "New request"`, (await s.page.getByRole('button', { name: /^New request$/ }).count()) > 0)
    } else {
      await viewsAt(s.page, '/hrms/attendance?tab=corrections', 'Daily tracking views')
      check('employee: Regularization still has "New request" and their requests', (await s.page.getByRole('button', { name: /^New request$/ }).count()) > 0 && (await s.page.getByText('My requests').count()) > 0)
    }
    await viewsAt(s.page, '/hrms/expenses?tab=my', 'Expense views')
    check(`${who}: Expenses still has "New claim"`, (await s.page.getByRole('button', { name: /^New claim$/ }).count()) > 0)
    const rows = await search(s.page, 'my claims')
    check(`${who}: search still offers My claims`, has(rows, /\bMy (expense )?claims\b/i), rows.slice(0, 4).join(' | ') || 'no results')
    const rev = await search(s.page, 'my reviews')
    check(`${who}: search still offers My reviews`, has(rev, /\bMy reviews\b/i), rev.slice(0, 4).join(' | ') || 'no results')
    check(`${who}: no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check(`${who}: no failed API calls`, s.failedApi.length === 0, s.failedApi.slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── An employee on a phone keeps My reviews ─────────────────────────────────
  {
    const s = await signIn('reader@unifiedtree.demo', { width: 390, height: 844 })
    const v = await viewsAt(s.page, '/hrms/performance?view=my-reviews', 'Performance views')
    check('employee (phone): My reviews opens', /^My reviews$/.test(v.selected), show(v))
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('employee (phone): no sideways page scroll', overflow <= 1, `${overflow}px`)
    await s.page.screenshot({ path: `${shots}/w16-owner-employee-performance-390.png` })
    await s.ctx.close()
  }
} catch (e) {
  check('scenario completed without an exception', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
