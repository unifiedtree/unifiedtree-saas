// Crash sweep of the HRMS website, role by role, against a running app and API.
//
// For each role it signs in, works out (from the app's own page registry and rail, in the browser) which pages
// and tabs that person is offered, and opens every one of them; on each page it also clicks every tab it shows
// (and the tabs those open), and on list pages it opens the first row (a leave request, a payslip, an expense
// claim, a review, a document, a job and a candidate, a run, a settlement, …). Then it opens, by address, the
// pages the person is NOT offered (they must show a no-access page or move elsewhere, never the error screen),
// the detail pages of real records, and a few addresses that only redirect.
// After each step it waits for the network to go quiet and records: the error screen ("This page hit an
// error"), page errors, console errors and API answers of 500 and above.
//
// Fails on any error screen or page error. Console errors and 5xx answers are listed (with the page) as notes.
//
// Records it makes, and removes at the end (or on the way out after a failure):
//   - two people with only the fields the API requires (a company and a first name: no last name, email, joining
//     date, department, branch, designation, manager, shift, probation end date or login), the first on probation,
//     the second joined today; a document on the first one, and a leave request filed for them by HR when the
//     leave rules allow it;
//   - when asked for, two sign-ins: EMPLOYEE + FINANCE_LEAD, and EMPLOYEE + DEPT_MANAGER (each with its own sparse
//     employee record, and no one reporting to them).
//
//   SWEEP_ROLES=owner,hrm live-slot.sh /c/REACT/ut-wt/w19-sweep 3191 node e2e/recovery/live-crash-sweep.mjs
//   env: SWEEP_ROLES (owner,admin,hrm,mgr,fin,reader,empfin,empmgr; default all), SWEEP_WIDTH (1440 or 390),
//        SWEEP_NO_ROWS=1 (skip opening rows), SWEEP_MAX_TABS (per page, default 40), SWEEP_SHOTS=1 (a screenshot of each page),
//        RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev)
/* global process, console, fetch, document, window, performance, URL, PopStateEvent, getComputedStyle */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3191'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const width = Number(process.env.SWEEP_WIDTH || 1440)
const ROLES = (process.env.SWEEP_ROLES || 'owner,admin,hrm,mgr,fin,reader,empfin,empmgr').split(',').map((s) => s.trim()).filter(Boolean)
const MAX_TABS = Number(process.env.SWEEP_MAX_TABS || 40)
const ROWS = process.env.SWEEP_NO_ROWS !== '1'
const SHOTS = process.env.SWEEP_SHOTS === '1'
const results = 'C:/REACT/ut-wt/_results'
const shots = `${results}/shots`
mkdirSync(shots, { recursive: true })
const tag = `${ROLES.join('-')}-${width}`
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
const note = (m) => console.log(`NOTE  ${m}`)
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const stamp = Date.now() % 1000000
const t0 = Date.now()
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { ...d, call }
}

const EMAIL = { owner: 'owner@unifiedtree.demo', admin: 'admin@unifiedtree.demo', hrm: 'hrm@unifiedtree.demo', mgr: 'mgr@unifiedtree.demo', fin: 'fin@unifiedtree.demo', reader: 'reader@unifiedtree.demo' }
const COMBO = { empfin: ['EMPLOYEE', 'FINANCE_LEAD'], empmgr: ['EMPLOYEE', 'DEPT_MANAGER'] }

// ── What every step records ──────────────────────────────────────────────────
const visits = []                // { role, kind, url, at, outcome, crash, errors, console, fives }
const consoleSeen = new Map()    // message → first page
const fivesSeen = new Map()      // "status METHOD path" → pages
const deniedSeen = new Map()     // 403s on pages the role is offered: "METHOD path" → pages

const browser = await chromium.launch()
// The dev server compiles on first use: open the sign-in page once before timing anything.
{ const c = await browser.newContext(); const w = await c.newPage()
  for (let i = 0; i < 3; i++) { try { await w.goto(base + '/login', { timeout: 180_000 }); await w.locator('input[type=email]').waitFor({ timeout: 120_000 }); break } catch { /* still compiling */ } }
  await c.close() }

/** A browser tab that tracks requests in flight, page errors, console errors and 5xx answers. */
async function tab(who) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } })
  const page = await ctx.newPage()
  page.setDefaultNavigationTimeout(120_000); page.setDefaultTimeout(30_000)
  const t = { ctx, page, who, errors: [], cons: [], fives: [], denied: [], crashed: false }
  page.on('pageerror', (e) => t.errors.push(`${String(e.message || e).slice(0, 300)}${e.stack ? ' @ ' + frames(e.stack) : ''}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/^Failed to load resource/.test(text)) return   // the browser's own line for every 4xx/5xx answer
    if (text.includes('[RouteErrorBoundary]')) t.errors.push(text.slice(0, 600))
    t.cons.push(text.slice(0, 400))
  })
  const inflight = new Map()
  let last = Date.now()
  page.on('request', (r) => { const k = r.resourceType(); if (k === 'websocket' || k === 'eventsource') return; inflight.set(r, Date.now()); last = Date.now() })
  const done = (r) => { if (inflight.delete(r)) last = Date.now() }
  page.on('requestfinished', done); page.on('requestfailed', done)
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) t.fives.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
    if (r.status() === 403 && r.url().includes('/api/')) t.denied.push(`${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  /** Counts from now: the page has just been asked to do something (its requests may not have started yet). */
  t.touch = () => { last = Date.now() }
  /** Waits until no request has been in flight for `quiet` ms (requests open longer than 20 s don't count). */
  t.idle = async (quiet = 500, cap = 15_000) => {
    const start = Date.now()
    while (Date.now() - start < cap) {
      for (const [r, at] of inflight) if (Date.now() - at > 20_000) inflight.delete(r)
      if (inflight.size === 0 && Date.now() - last >= quiet) return true
      await page.waitForTimeout(100)
    }
    return false
  }
  return t
}
/** The first frames of a stack that point into our own code. */
function frames(stack) {
  return String(stack).split('\n').slice(1).map((l) => l.trim()).filter((l) => /\/src\/|packages\//.test(l)).slice(0, 3)
    .map((l) => l.replace(/https?:\/\/[^/]+/, '').replace(/\?[^:)]*/, '')).join(' < ')
}

async function closePunchPrompt(page, wait = 0) {
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  if (wait) await later.waitFor({ timeout: wait }).catch(() => {})
  if (await later.isVisible().catch(() => false)) { await later.click().catch(() => {}); await later.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {}) }
}
async function signIn(who, email) {
  const t = await tab(who)
  await t.page.goto(base + '/login')
  await t.page.locator('input[type=email]').fill(email)
  await t.page.locator('input[type=password]').fill(password)
  await t.page.locator('button[type=submit]').click()
  await t.page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90_000 })
  await t.idle()
  await closePunchPrompt(t.page, 4000)
  return t
}
const at = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const pathOf = (url) => url.split(/[?#]/)[0]

/** Waits for the page's code and data: the network goes quiet and the loading placeholders are gone. */
async function settle(t) {
  // After a click or a client-side move React renders, then fetches: wait at least `quiet` from now.
  t.touch()
  await t.idle(700)
  await t.page.waitForFunction(() => {
    const main = document.querySelector('main') || document.body
    const txt = main.innerText || ''
    return !/^\s*Loading…\s*$/.test(txt) && !document.querySelector('[aria-label="Loading page"], [aria-label="Loading employee"], [aria-label="Loading apps"]')
  }, null, { timeout: 10_000 }).catch(() => {})
  await t.idle(300, 8000)
}
/** Opens an address in the app (client-side, like a link; a fresh load after an error screen). */
async function go(t, url) {
  if (t.crashed || !t.page.url().startsWith(base)) {
    await t.page.goto(base + url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    t.crashed = false
  } else {
    await t.page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })) }, url)
  }
  await settle(t)
}
const errorScreen = (page) => page.evaluate(() => (document.body.innerText || '').includes('This page hit an error')).catch(() => false)
const NO_ACCESS = /Access Restricted|No access yet|don[’']t have (access|permission)|do not have (access|the required permissions)|isn[’']t part of your workspace|Not Activated|not available to you|You can[’']t open this/i

/** Records what the page shows now; returns whether it crashed. */
async function record(t, kind, url, extra = {}) {
  const screen = await errorScreen(t.page)
  const errors = t.errors.splice(0), cons = t.cons.splice(0), fives = t.fives.splice(0), denied = t.denied.splice(0)
  const now = at(t.page)
  const txt = await t.page.evaluate(() => (document.querySelector('main') || document.body).innerText.slice(0, 3000)).catch(() => '')
  let outcome = 'rendered'
  if (screen) outcome = 'error-screen'
  else if (pathOf(now) !== pathOf(url) && kind !== 'row') outcome = `moved to ${now}`
  else if (NO_ACCESS.test(txt)) outcome = 'no-access'
  else if (txt.trim().length < 15) outcome = 'blank'
  const crash = screen || errors.length > 0
  if (screen) t.crashed = true
  for (const c of cons) if (!consoleSeen.has(c)) consoleSeen.set(c, `${t.who} ${url}`)
  for (const f of fives) fivesSeen.set(f, [...(fivesSeen.get(f) || []), `${t.who} ${url}`])
  if (kind !== 'not-offered' && kind !== 'extra') for (const f of new Set(denied)) deniedSeen.set(f, [...(deniedSeen.get(f) || []), `${t.who} ${url}`])
  const v = { role: t.who, width, kind, url, at: now, outcome, crash, errors, console: cons, fives, ...extra }
  visits.push(v)
  if (crash) {
    const n = visits.filter((x) => x.crash).length
    await t.page.screenshot({ path: `${shots}/w19-sweep-${t.who}-${width}-crash${n}.png` }).catch(() => {})
    console.log(`FAIL  ${t.who} ${kind} ${url}${extra.what ? ' [' + extra.what + ']' : ''}  — ${screen ? 'ERROR SCREEN; ' : ''}${errors.join(' | ').slice(0, 900)}`)
  }
  return crash
}

/** Clicks every tab the page shows inside `scope` (and the tabs those open), checking after each. */
async function clickTabs(t, url, scope = 'main') {
  const done = new Set()
  const page = t.page
  const home = at(page)
  for (let round = 0; round < 4 && done.size < MAX_TABS; round++) {
    const names = await page.locator(`${scope} [role=tab]`).evaluateAll((els) => els.map((e) => ({
      name: (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      off: e.disabled || e.getAttribute('aria-disabled') === 'true' || !(e.offsetWidth || e.offsetHeight),
    }))).catch(() => [])
    const todo = names.filter((x) => x.name && !x.off && !done.has(x.name))
    if (!todo.length) break
    for (const { name } of todo) {
      if (done.size >= MAX_TABS) break
      done.add(name)
      await closePunchPrompt(page)
      const all = await page.locator(`${scope} [role=tab]`).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60))).catch(() => [])
      const i = all.indexOf(name)
      if (i < 0) continue
      const ok = await page.locator(`${scope} [role=tab]`).nth(i).click({ timeout: 5000 }).then(() => true, () => false)
      if (!ok) continue
      await settle(t)
      const crashed = await record(t, 'tab', url, { what: name })
      if (crashed) { await go(t, home); continue }
      // A tab that is a link to another page: come back before the next one.
      if (pathOf(at(page)) !== pathOf(home)) await go(t, home)
    }
  }
  return done.size
}

/** Opens the first row (or "Open …" button) of the list on the page; checks the drawer or page it opens, and its tabs. */
async function openFirstRow(t, url, what) {
  const page = t.page
  await closePunchPrompt(page)
  const target = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body
    const label = (el) => `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`.replace(/\s+/g, ' ').trim()
    const pick = (el) => { el.setAttribute('data-sweep-row', '1'); return label(el).slice(0, 80) }
    document.querySelectorAll('[data-sweep-row]').forEach((e) => e.removeAttribute('data-sweep-row'))
    const visible = (e) => !!(e.offsetWidth || e.offsetHeight)
    // Never anything that changes data: only things that open or show.
    const acts = /delete|remove|cancel|withdraw|reject|approve|lock|process|send|submit|mark |archive|remind|confirm|exit|terminat|disburse|record|reset|revoke|deactivat|unlink|convert|move to|create|add |new |upload|download|export|invite|apply|edit|assign|start|close|reopen|pay /i
    const safe = (e) => visible(e) && !acts.test(label(e))
    // 1. A clickable row of the kit's table.
    const link = [...main.querySelectorAll('tr.is-link')].find(visible)
    if (link) return pick(link)
    // 2. The first data row: its own "open" link or button (a person, View …), else the row when it is clickable.
    const row = [...main.querySelectorAll('tbody tr')].find((e) => visible(e) && e.querySelectorAll('td, th').length > 1)
    if (row) {
      const inner = [...row.querySelectorAll('a[href], button')].filter(safe)
      const best = inner.find((e) => e.querySelector('.uk-av, .uk-cell-person') || /^(view|open|details|manage)\b/i.test(label(e))) || inner[0]
      if (best) return pick(best)
      if (getComputedStyle(row).cursor === 'pointer' || row.getAttribute('tabindex') === '0') return pick(row)
    }
    // 3. "View …", "Manage …", "Open <someone>: …" buttons, or a person in a picker list.
    const btns = [...main.querySelectorAll('button, a[href]')].filter(safe)
    const open = btns.find((e) => /^(view|manage|details)\b/i.test((e.innerText || '').trim()) || /^Open .+:/.test(e.getAttribute('aria-label') || ''))
      || btns.find((e) => e.querySelector('.uk-av'))
    if (open) return pick(open)
    // 4. A list of months (payslips): the oldest one, so it isn't the one already shown.
    const month = btns.filter((e) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/.test((e.innerText || '').trim())).pop()
    if (month) return pick(month)
    return null
  }).catch(() => null)
  if (target == null) { visits.push({ role: t.who, width, kind: 'row', url, outcome: 'no rows', what, crash: false, errors: [], console: [], fives: [] }); return false }
  await page.locator('[data-sweep-row="1"]').first().click({ timeout: 5000 }).catch(() => {})
  await settle(t)
  const crashed = await record(t, 'row', url, { what: `${what}: ${target}` })
  if (!crashed) {
    const dialog = await page.locator('[role=dialog]').count()
    if (dialog) await clickTabs(t, url, '[role=dialog]')
    else if (pathOf(at(page)) !== pathOf(url)) await clickTabs(t, at(page))
  }
  await page.keyboard.press('Escape').catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  return true
}

/**
 * The sweep's own check, once per run: a page whose code can't be loaded (twice: the app reloads once for a new
 * build, then gives up) shows the error screen, and the sweep must see it. Nothing it sees here counts as a crash.
 */
async function selfTest(t) {
  const code = /\/src\/modules\/hrms\/compliance\/InspectorView\.tsx(\?.*)?$/
  let hits = 0
  await t.page.route(code, (r) => (hits++ < 2 ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>gone</title>' }) : r.continue()))
  await t.page.goto(base + '/inspection', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await t.page.waitForFunction(() => /This page hit an error/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {})
  const seen = await errorScreen(t.page)
  await t.page.unroute(code)
  t.errors.length = 0; t.cons.length = 0; t.fives.length = 0; t.denied.length = 0
  t.crashed = true
  check(`the sweep sees the error screen (a page whose code could not be loaded, ${hits} tries)`, seen)
}

/** The pages and tabs the signed-in person is offered (the app's own registry and rail), and those they are not. */
async function planFor(t, s) {
  return t.page.evaluate(async (fallback) => {
    const reg = await import('/src/shared/navigation/pageRegistry.ts')
    const acc = await import('/src/shared/navigation/access.ts')
    const nav = await import('/src/design/shell/navModel.ts')
    const home = await import('/src/design/shell/useHome.tsx')
    const rolesMod = await import('/src/shared/hooks/useRoles.ts')
    const ua = await import('/src/shared/navigation/useAccess.ts')
    const local = await import('/src/core/auth/authStore.ts')
    let perms = fallback.permissions || [], roles = fallback.roles || [], modules = null, from = 'login answer'
    const sdkUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /packages\/sdk\/src\/index\.ts(\?|$)/.test(n))
    if (sdkUrl) {
      const sdk = await import(sdkUrl)
      const st = sdk.useAuthStore.getState()
      // A Map of code → scope (useAccessContext reads its keys).
      if (st.permissions?.size) { perms = [...st.permissions.keys()]; from = 'app session' }
      roles = st.user?.roles ?? roles
      modules = (st.modules || []).filter((m) => m.enabled).map((m) => m.key)
    }
    const lm = local.useAuthStore.getState().tenant?.activeModules
    if (lm) modules = lm
    const P = new Set(perms), wildcard = P.has('*')
    const ctx = {
      has: (c) => wildcard || P.has(c), modules: modules || [], self: !!fallback.employeeId,
      adminRole: roles.some((r) => rolesMod.ADMIN_ROLES.includes(r)), planAdmin: wildcard || roles.some((r) => ua.PLAN_ADMIN_ROLES.includes(r)),
    }
    const h = home.resolveHome(ctx)
    const offered = new Map(), hidden = new Map()
    for (const e of reg.visibleEntries(ctx)) offered.set(e.path, { path: e.path, label: e.label, state: e.state, tab: !!e.parent, src: 'registry' })
    for (const g of nav.railGroups(ctx, { selfFirst: h.kind !== 'admin' })) for (const m of g.modules) for (const p of m.pages) if (!offered.has(p.path)) offered.set(p.path, { path: p.path, label: `${m.label} › ${p.label}`, tab: false, src: 'rail' })
    for (const p of nav.settingsPages(ctx)) if (!offered.has(p.path)) offered.set(p.path, { path: p.path, label: `Settings › ${p.label}`, tab: false, src: 'settings' })
    for (const e of reg.PAGE_REGISTRY) if (!offered.has(e.path) && acc.accessState(e.access, ctx) === 'hidden') hidden.set(e.path, { path: e.path, label: e.label, tab: !!e.parent })
    for (const m of nav.NAV_MODULES) for (const p of m.pages) if (!offered.has(p.path) && !hidden.has(p.path)) hidden.set(p.path, { path: p.path, label: `${m.label} › ${p.label}`, tab: false })
    for (const p of nav.SETTINGS_PAGES) if (!offered.has(p.path) && !hidden.has(p.path)) hidden.set(p.path, { path: p.path, label: `Settings › ${p.label}`, tab: false })
    return { home: h, from, roles, permissions: perms.length, modules: ctx.modules, adminRole: ctx.adminRole, offered: [...offered.values()], hidden: [...hidden.values()] }
  }, { permissions: s.permissions, roles: s.roles, employeeId: s.employeeId })
}

// Addresses that aren't in the registry: redirects, old links, placeholders, the self-service pages' other doors.
const EXTRA = ['/', '/dashboard', '/modules', '/profile', '/hrms/ess', '/me/celebrations', '/hrms/onboarding', '/hrms/settings/work-time', '/analytics', '/files',
  '/settings', '/settings/profile', '/settings/branding', '/settings/notifications', '/settings/integrations', '/settings/documents', '/settings/billing', '/settings/danger', '/settings/security',
  '/hrms/attendance/geofencing', '/payroll', '/module-workspace', '/hrms/soon/timesheets', '/hrms/settings/payroll', '/hrms/settings/access', '/documents/pending',
  '/hrms/onboarding/instances/new', '/hrms/fnf?tab=settlements', '/hrms/performance?view=nonsense', '/hrms/leave?tab=nonsense', '/hrms/employees/00000000-0000-0000-0000-000000000000',
  '/crm', '/accounts', '/projects', '/inventory', '/procurement', '/sales', '/manufacturing', '/pos', '/reports', '/no-access',
  // Old links and notifications: odd dates and filters, and records that are gone.
  '/dashboard?date=not-a-date', '/hrms/attendance?tab=team&date=2099-12-31', '/hrms/attendance?tab=team&date=garbage&status=zzz', '/hrms/attendance?month=2026-13',
  '/hrms/att-analytics?month=2026-13', '/hrms/att-analytics?tab=calendar&month=x', '/hrms/muster-roll?date=garbage', '/hrms/attendance/manual-entry?date=garbage&employeeId=garbage',
  '/hrms/reports/attendance-summary?from=x&to=y', '/hrms/reports/leave-balance?year=abc', '/hrms/reports/attrition?from=2026-99-99', '/hrms/workforce-analytics?period=zzz',
  '/hrms/employees?status=WEIRD&dept=none&filter=birthday', '/hrms/org-chart?focus=00000000-0000-0000-0000-000000000000&co=garbage', '/hrms/payroll-dashboard?month=garbage',
  '/hrms/hiring?tab=pipeline&stage=WEIRD&role=garbage', '/hrms/bank-disbursement?run=garbage', '/hrms/salary-structure?employee=garbage', '/hrms/policies?policy=garbage',
  '/hrms/payroll/runs/00000000-0000-0000-0000-000000000000', '/hrms/performance/employees/00000000-0000-0000-0000-000000000000', '/hrms/learning/programs/00000000-0000-0000-0000-000000000000',
  '/hrms/onboarding/templates/00000000-0000-0000-0000-000000000000', '/hrms/onboarding/instances/00000000-0000-0000-0000-000000000000', '/hrms/letters/templates/00000000-0000-0000-0000-000000000000',
  '/hrms/letters/generated/00000000-0000-0000-0000-000000000000', '/hrms/letters/distributions/00000000-0000-0000-0000-000000000000', '/hrms/employees/not-an-id']
// List pages whose first row opens a detail (a drawer or a page). Only the ones the role is offered are opened.
const ROW_PAGES = [
  ['/hrms/employees', 'employee (quick profile)'], ['/team', 'team member'],
  ['/hrms/leave?tab=approvals', 'leave request'], ['/hrms/leave?tab=history', 'decided leave request'], ['/hrms/leave?tab=my', 'my leave request'],
  ['/me/payslips', 'payslip'], ['/hrms/payroll/runs', 'payroll run'], ['/hrms/salary-structure', 'salary structure'],
  ['/hrms/expenses?tab=approvals', 'expense claim'], ['/hrms/expenses?tab=my', 'my expense claim'], ['/hrms/expenses?tab=batches', 'reimbursement batch'],
  ['/hrms/performance?view=reviews', 'review'], ['/hrms/performance?view=cycles', 'review cycle'], ['/hrms/performance?view=people', 'person’s performance'], ['/hrms/performance?view=my-reviews', 'my review'], ['/hrms/performance?view=kpis', 'goal'],
  ['/hrms/documents?view=all', 'employee document'], ['/hrms/documents?view=my', 'my document'], ['/hrms/documents/pending', 'document to review'],
  ['/hrms/hiring?tab=requisitions', 'job'], ['/hrms/hiring?tab=pipeline', 'candidate'], ['/hrms/hiring?tab=offers', 'offer'],
  ['/hrms/fnf', 'settlement'], ['/hrms/advances', 'advance'], ['/hrms/advances?tab=my', 'my advance'], ['/hrms/exit', 'leaver'],
  ['/hrms/onboarding/instances', 'onboarding'], ['/hrms/learning?view=programs', 'training program'], ['/hrms/learning?view=my', 'my training'],
  ['/hrms/letters/generated', 'letter'], ['/hrms/letters/my', 'my letter'], ['/hrms/letters/templates', 'letter template'],
  ['/hrms/compliance', 'compliance item'], ['/hrms/policies', 'policy'], ['/hrms/policies?view=documents', 'policy to read'], ['/hrms/pli', 'incentive'],
  ['/hrms/attendance?tab=team', 'daily log'], ['/hrms/attendance?tab=corrections', 'regularization'], ['/hrms/attendance?tab=my', 'my day'],
  ['/hrms/shifts?tab=requests', 'shift request'], ['/hrms/master/departments', 'department'], ['/hrms/master/branches', 'branch'], ['/hrms/companies', 'company'],
  ['/users', 'user'], ['/roles', 'role'], ['/audit-logs', 'audit entry'], ['/hrms/muster-roll', 'muster row'],
]
const SEARCH_SPARSE = new Set(['/hrms/employees', '/hrms/documents?view=all'])
const PROFILE_TABS = ['overview', 'personal', 'job', 'attendance', 'payroll', 'leave', 'expenses', 'documents', 'letters', 'performance', 'exit', 'access']

// ── Records: real ones to open, and the sparse ones this run makes ──────────
const owner = await session(EMAIL.owner)
const hrmS = await session(EMAIL.hrm)
const created = { employees: [], users: [], documents: [], leaves: [] }
let failedSetup = false
try {
  // Only what the API requires (the company and a first name); the second one also joined today.
  for (const [k, extra] of [['sparse', {}], ['today', { dateOfJoining: istToday() }]]) {
    const firstName = k === 'sparse' ? 'Sweep Sparse' : 'Sweep Joined Today'
    let r = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName, ...extra })
    if (!r.json?.id) {
      note(`the ${k} person with only the required fields answered ${r.status} ${JSON.stringify(r.json).slice(0, 200)}; adding an email and employment type`)
      r = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName, email: `w19-${k}-${stamp}@example.invalid`, employmentType: 'FULL_TIME', ...extra })
    }
    if (r.json?.id) created.employees.push(r.json.id)
    else note(`creating the ${k} person answered ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  }
  const [sparse, today] = created.employees
  check('setup: two people with only the required fields', !!sparse && !!today)
  const ids = created.employees.map(lit).join(',')
  if (ids) {
    sql(`update hrms.employees set department_id=null, branch_id=null, designation_id=null, reporting_manager_id=null, probation_end_date=null, confirmation_date=null where id in (${ids})`)
    if (sparse) sql(`update hrms.employees set employment_status='PROBATION' where id=${lit(sparse)}`)
    sql(`delete from attendance.employee_shift_assignments where employee_id in (${ids})`)
  }
  if (sparse) {
    const d = await owner.call('/v1/document/documents', 'POST', { employeeId: sparse, title: `Sweep ${stamp} certificate`, category: 'OTHER', fileUrl: 'https://example.invalid/w19-sweep.pdf' })
    if (d.json?.id) created.documents.push(d.json.id); else note(`a document for the sparse person answered ${d.status}`)
    const types = await owner.call(`/v1/leave/types?companyId=${company}`)
    const list = Array.isArray(types.json) ? types.json : types.json?.content || []
    const day = new Date(Date.now() + 40 * 86400e3)
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1)
    const iso = day.toISOString().slice(0, 10)
    for (const lt of list) {
      const l = await hrmS.call(`/v1/leave/apply/for/${sparse}`, 'POST', { leaveTypeId: lt.id, startDate: iso, endDate: iso, duration: 'FULL_DAY', reason: `Sweep ${stamp}` })
      if (l.status < 300 && l.json?.id) { created.leaves.push(l.json.id); break }
    }
    if (!created.leaves.length) note('no leave request could be filed for the sparse person (leave rules); their leave list stays empty')
  }
  // Two sign-ins holding two roles each, with their own employee record.
  for (const key of ROLES.filter((r) => COMBO[r])) {
    const e = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'Sweep', lastName: key === 'empfin' ? 'Finance Employee' : 'Manager Employee', email: `w19-${key}-${stamp}@example.invalid`, employmentType: 'FULL_TIME', dateOfJoining: '2024-04-01' })
    if (!e.json?.id) { note(`creating ${key}'s employee answered ${e.status}`); continue }
    created.employees.push(e.json.id)
    // A new joiner's record, as sparse as the two above (no department, branch, designation, manager or shift).
    sql(`update hrms.employees set department_id=null, branch_id=null, designation_id=null, reporting_manager_id=null, probation_end_date=null, confirmation_date=null where id=${lit(e.json.id)}`)
    sql(`delete from attendance.employee_shift_assignments where employee_id=${lit(e.json.id)}`)
    const user = randomUUID()
    sql(`BEGIN;
      INSERT INTO auth.user_credentials(id, tenant_id, email, password_hash, employee_id, is_active)
        SELECT ${lit(user)}, ${lit(tenant)}, ${lit(`w19-${key}-${stamp}@example.invalid`)}, password_hash, ${lit(e.json.id)}, true FROM auth.user_credentials
         WHERE tenant_id = ${lit(tenant)} AND email = 'reader@unifiedtree.demo';
      INSERT INTO rbac.user_roles(tenant_id, user_id, role_id)
        SELECT ${lit(tenant)}, ${lit(user)}, id FROM rbac.roles WHERE code IN (${COMBO[key].map(lit).join(',')}) AND (tenant_id IS NULL OR tenant_id = ${lit(tenant)});
      COMMIT;`)
    created.users.push(user)
    EMAIL[key] = `w19-${key}-${stamp}@example.invalid`
  }
} catch (e) { failedSetup = true; check('setup', false, String(e.message || e).split('\n')[0]) }

// Real records whose detail pages are opened by address.
const one = (q) => { try { return sql(q).split('\n').filter(Boolean) } catch { return [] } }
const empOf = (status) => one(`select id from hrms.employees where tenant_id=${lit(tenant)} and employment_status=${lit(status)} limit 1`)[0]
const DETAIL = [
  ...[['11111111-1111-1111-1111-111111111111', 'owner’s own'], ['22222222-2222-2222-2222-222222222222', 'reader (mgr’s report)'], ['55555555-5555-5555-5555-555555555555', 'finance'],
    [empOf('EXITED'), 'exited'], [empOf('NOTICE_PERIOD'), 'on notice'], [empOf('TERMINATED'), 'terminated'], [created.employees[0], 'sparse, on probation, no login'], [created.employees[1], 'joined today, sparse']]
    .filter(([id]) => id).map(([id, what]) => [`/hrms/employees/${id}`, `profile: ${what}`]),
  ...one(`select id from payroll.runs where tenant_id=${lit(tenant)} order by created_at desc limit 2`).flatMap((id) => [[`/hrms/payroll/runs/${id}`, 'payroll run'], [`/hrms/payroll/runs/${id}?tab=employees`, 'payroll run › employees']]),
  ...['22222222-2222-2222-2222-222222222222', created.employees[0]].filter(Boolean).map((id) => [`/hrms/performance/employees/${id}`, 'performance of a person']),
  ...one(`select id from learning_mgmt.training_programs where tenant_id=${lit(tenant)} limit 1`).map((id) => [`/hrms/learning/programs/${id}`, 'training program']),
  ...one(`select id from hrms.onboarding_templates where tenant_id=${lit(tenant)} limit 1`).map((id) => [`/hrms/onboarding/templates/${id}`, 'onboarding template']),
  ...one(`select id from hrms.onboarding_instances where tenant_id=${lit(tenant)} order by created_at desc limit 1`).map((id) => [`/hrms/onboarding/instances/${id}`, 'onboarding']),
  ...one(`select id from letters.templates where tenant_id=${lit(tenant)} limit 1`).map((id) => [`/hrms/letters/templates/${id}`, 'letter template']),
  ...one(`select id from letters.generated where tenant_id=${lit(tenant)} limit 1`).map((id) => [`/hrms/letters/generated/${id}`, 'generated letter']),
  ...one(`select id from letters.distribution_jobs where tenant_id=${lit(tenant)} limit 1`).map((id) => [`/hrms/letters/distributions/${id}`, 'letter distribution']),
]
note(`detail pages to open: ${DETAIL.length}`)

/** Removes what the sweep made (synchronous, so it also runs when the slot's time limit stops the run). */
let putBackDone = false
function putBack() {
  if (putBackDone) return
  putBackDone = true
  // ── Put everything back ───────────────────────────────────────────────────
  for (const id of created.leaves) {
    try { sql(`delete from notif.notifications where tenant_id=${lit(tenant)} and data::text like ${lit('%' + id + '%')}`) } catch { /* table shape differs */ }
    try { sql(`delete from leave_mgmt.leave_requests where id=${lit(id)}`) } catch (e) { note(`cleanup (leave): ${String(e.message).split('\n')[0]}`) }
  }
  for (const id of created.documents) {
    try { sql(`delete from document_mgmt.employee_documents where id=${lit(id)}`) } catch (e) { note(`cleanup (document): ${String(e.message).split('\n')[0]}`) }
  }
  for (const id of created.users) {
    try { sql(`BEGIN; DELETE FROM rbac.user_permission_overrides WHERE user_id = ${lit(id)}; DELETE FROM rbac.user_roles WHERE tenant_id = ${lit(tenant)} AND user_id = ${lit(id)}; DELETE FROM auth.refresh_tokens WHERE user_id = ${lit(id)}; DELETE FROM auth.user_credentials WHERE tenant_id = ${lit(tenant)} AND id = ${lit(id)}; COMMIT;`) } catch (e) { note(`cleanup (user): ${String(e.message).split('\n')[0]}`) }
  }
  for (const id of created.employees) {
    for (const q of [
      `delete from attendance.records where employee_id='${id}'`,
      `delete from attendance.employee_shift_assignments where employee_id='${id}'`,
      `delete from hrms.employee_onboarding_records where employee_id='${id}'`,
      `delete from hrms.employee_dependents where employee_id='${id}'`,
      `delete from hrms.employee_status_history where employee_id='${id}'`,
      `delete from leave_mgmt.leave_balances where employee_id='${id}'`,
      `delete from hrms.probation_reminder_log where employee_id='${id}'`,
      `delete from hrms.employees where id='${id}'`,
    ]) { try { sql(q) } catch (e) { note(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  }
  const left = created.employees.length ? Number(sql(`select count(*) from hrms.employees where id in (${created.employees.map(lit).join(',')})`)) : 0
  const leftUsers = Number(sql(`select count(*) from auth.user_credentials where email like 'w19-%@example.invalid'`))
  check('cleanup: the people, sign-ins, document and leave request the sweep made are removed', left === 0 && leftUsers === 0, `${left} people, ${leftUsers} sign-ins left`)
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { putBack(); process.exit(1) })

// ── The sweep ──────────────────────────────────────────────────────────────
const coverage = []
try {
  if (failedSetup) throw new Error('setup failed')
  for (const who of ROLES) {
    if (!EMAIL[who]) { check(`${who}: has a sign-in`, false, 'not created'); continue }
    const rs = Date.now()
    const s = await session(EMAIL[who])
    const t = await signIn(who, EMAIL[who])
    await record(t, 'sign-in', '/login')
    const plan = await planFor(t, s)
    // 0. The shell's own menus: More, and the search with the sparse people's name.
    const more = t.page.locator('.ut-rail__more').first()
    if (await more.isVisible().catch(() => false)) {
      await more.click().catch(() => {}); await settle(t)
      await record(t, 'shell', at(t.page), { what: 'More menu' }); await t.page.keyboard.press('Escape').catch(() => {})
    }
    const search = t.page.getByRole('button', { name: 'Search everything' }).first()
    if (await search.isVisible().catch(() => false)) {
      await search.click().catch(() => {}); await t.page.keyboard.type('Sweep').catch(() => {}); await settle(t)
      await record(t, 'shell', at(t.page), { what: 'search: Sweep' }); await t.page.keyboard.press('Escape').catch(() => {})
    }
    if (who === ROLES[0]) await selfTest(t)
    note(`${who}: roles ${plan.roles.join('+')} · ${plan.permissions} permissions (${plan.from}) · home ${plan.home.path} · offered ${plan.offered.length} · not offered ${plan.hidden.length}`)
    let tabsClicked = 0, rowsOpened = 0
    // 1. Every page and tab they are offered; on each page, every tab it shows.
    for (const p of plan.offered) {
      await go(t, p.path)
      const crashed = await record(t, p.tab ? 'offered-tab' : 'offered', p.path, { what: p.label })
      if (SHOTS && !p.tab) await t.page.screenshot({ path: `${shots}/w19-sweep-${who}-${width}-${p.path.replace(/[^a-z0-9]+/gi, '_')}.png` }).catch(() => {})
      if (!crashed && !p.tab) tabsClicked += await clickTabs(t, p.path)
    }
    // 2. Detail pages of real and sparse records (a profile with every tab).
    for (const [url, what] of DETAIL) {
      await go(t, url)
      const crashed = await record(t, 'detail', url, { what })
      if (!crashed && /^\/hrms\/employees\//.test(url) && !(await t.page.locator('.upf-name').count())) continue
      if (!crashed) tabsClicked += await clickTabs(t, url)
    }
    for (const id of created.employees.slice(0, 2)) for (const k of PROFILE_TABS) {
      await go(t, `/hrms/employees/${id}?tab=${k}`)
      await record(t, 'detail', `/hrms/employees/${id}?tab=${k}`, { what: `sparse profile › ${k}` })
    }
    // 3. The first row of every list they are offered.
    if (ROWS) {
      const offeredPaths = new Set(plan.offered.map((p) => p.path))
      const offeredRoutes = new Set(plan.offered.map((p) => pathOf(p.path)))
      for (const [url, what] of ROW_PAGES) {
        if (!offeredPaths.has(url) && !(offeredRoutes.has(pathOf(url)) && !url.includes('?'))) continue
        await go(t, url)
        if (await record(t, 'offered', url, { what: `list: ${what}` })) continue
        // The directory and the vault: the sparse person's own row.
        if (SEARCH_SPARSE.has(url)) {
          const box = t.page.locator('main input[type=search], main input[placeholder*="Search" i]').first()
          if (await box.count()) { await box.fill('Sweep Sparse').catch(() => {}); await settle(t) }
        }
        if (await openFirstRow(t, url, what)) rowsOpened++
      }
    }
    // 4. Pages they are not offered, by address: a no-access page or a move elsewhere, never the error screen.
    for (const p of plan.hidden) {
      await go(t, p.path)
      await record(t, 'not-offered', p.path, { what: p.label })
    }
    // 5. Other addresses.
    for (const url of EXTRA) {
      await go(t, url)
      await record(t, 'extra', url)
    }
    const mine = visits.filter((v) => v.role === who)
    const row = { role: who, width, offered: plan.offered.length, notOffered: plan.hidden.length, tabsClicked, rowsOpened,
      visits: mine.length, crashes: mine.filter((v) => v.crash).length, seconds: Math.round((Date.now() - rs) / 1000) }
    coverage.push(row)
    check(`${who} (${width}): ${mine.length} pages, tabs and rows, no error screen or page error`, row.crashes === 0, `${row.crashes} crashes`)
    note(`${who}: ${JSON.stringify(row)} (${elapsed()})`)
    await t.ctx.close()
  }
} catch (e) {
  check('sweep ran to the end', false, String(e.stack || e).split('\n').slice(0, 3).join(' '))
} finally {
  putBack()
  await browser.close()
}

// ── Report ──────────────────────────────────────────────────────────────────
const crashes = visits.filter((v) => v.crash)
console.log('\n── coverage ──')
for (const c of coverage) console.log(`      ${c.role} @${c.width}: offered ${c.offered} · not offered ${c.notOffered} · tabs clicked ${c.tabsClicked} · rows opened ${c.rowsOpened} · ${c.visits} checks · ${c.crashes} crashes · ${c.seconds}s`)
const outcomes = {}
for (const v of visits.filter((x) => x.kind === 'not-offered')) { const k = v.outcome.startsWith('moved') ? 'moved elsewhere' : v.outcome; outcomes[k] = (outcomes[k] || 0) + 1 }
console.log(`      not-offered pages: ${JSON.stringify(outcomes)}`)
const rendered = visits.filter((x) => x.kind === 'not-offered' && x.outcome === 'rendered')
if (rendered.length) note(`not offered but the page renders (no crash; the page decides): ${[...new Set(rendered.map((v) => `${v.role} ${v.url}`))].slice(0, 60).join(', ')}`)
const blank = visits.filter((x) => x.outcome === 'blank')
if (blank.length) note(`pages that showed (almost) nothing: ${[...new Set(blank.map((v) => `${v.role} ${v.kind} ${v.url}${v.what ? ' [' + v.what + ']' : ''}`))].join(', ')}`)
const noRows = visits.filter((x) => x.kind === 'row' && x.outcome === 'no rows')
if (noRows.length) note(`lists with no row to open: ${noRows.map((v) => `${v.role} ${v.url}`).join(', ')}`)
if (crashes.length) {
  console.log('\n── crashes ──')
  for (const v of crashes) console.log(`      ${v.role} ${v.kind} ${v.url}${v.what ? ' [' + v.what + ']' : ''}: ${v.errors.join(' | ').slice(0, 600) || 'error screen'}`)
}
if (deniedSeen.size) {
  console.log('\n── API 403 on pages the role is offered (the page should show an empty or no-access state) ──')
  for (const [f, pages] of deniedSeen) console.log(`      403 ${f}  (${[...new Set(pages)].slice(0, 4).join('; ')}${new Set(pages).size > 4 ? ' …' : ''})`)
}
if (fivesSeen.size) {
  console.log('\n── API 5xx ──')
  for (const [f, pages] of fivesSeen) console.log(`      ${f}  (${[...new Set(pages)].slice(0, 4).join('; ')}${pages.length > 4 ? ' …' : ''})`)
}
if (consoleSeen.size) {
  console.log('\n── console errors (distinct) ──')
  for (const [m, first] of consoleSeen) console.log(`      ${m.replace(/\s+/g, ' ').slice(0, 260)}  (first: ${first})`)
}
writeFileSync(`${results}/w19-sweep-${tag}.json`, JSON.stringify({ coverage, visits, fives: [...fivesSeen], denied: [...deniedSeen], console: [...consoleSeen] }, null, 1))
const failed = checks.filter((r) => !r.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed (${elapsed()})`)
process.exit(failed.length ? 1 : 0)
