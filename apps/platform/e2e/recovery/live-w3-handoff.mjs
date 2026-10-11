/* global URL, console, process, fetch, setTimeout, document, window, localStorage, performance, MutationObserver */
// The business's sign-in page uses the website's sign-in (fix/handoff-signin, 11 Oct 2026).
// Browser + API acceptance against a running backend + web app (live-slot.sh):
//
// API (POST /v1/accounts/workspaces/session):
//  - silent: true for a login without two-factor gets this business's session;
//  - silent: true for a login that needs two-factor is refused (403 USE_PASSWORD_FOR_TWO_FACTOR), while the
//    website's Enter (no flag) is as before; a business the account is not part of is refused.
// Browser (the account cookie is Domain=.unifiedtree.com and can't exist on demo.localhost, so the one call that
// reads it, POST /v1/accounts/auth/refresh, is answered by the test with a REAL account token from the account
// sign-in above; every other call goes to the real backend):
//  - no account sign-in (the real refresh, 401): the form, quickly; the password sign-in still works;
//  - "Sign out": the form at once, the business marked signed out, and nothing is tried, even with an account
//    sign-in and after a reload; signing in with the form clears the mark, and so does a hand-over (?token=);
//  - an account sign-in: a deep link (/hrms/leave) signs in without the form ever showing and stays on the deep
//    link, with the welcome; the root lands on the Apps page (/modules); 1440 and 390 wide;
//  - the server refuses (two-factor required): the form, no error, no toast, no second try;
//  - no answer in time: the form after about 4 s, and a late answer signs nobody in;
//  - UnifiedTree's own addresses and unknown ones never ask.
// Everything the test creates (one website account and its membership) is removed at the end, and the
// business's two-factor rule is put back.
//
// Run from apps/platform (through the slot):
//   NODE_OPTIONS="--import ./e2e/recovery/_skip-punch-prompt.mjs" node e2e/recovery/live-w3-handoff.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3121), RECOVERY_API_URL, RECOVERY_DB (default ut_w3_dev),
//        PSQL, RECOVERY_PASSWORD, SHOTS
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3121'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev' // safe default: never the long-lived recovery DB by accident
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const DEMO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const MARK = 'ut.signed-out:demo'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const info = (name, detail) => console.log(`INFO  ${name}  — ${detail}`)
const u = new URL(base)
const hostUrl = (sub) => `${u.protocol}//${sub}.localhost${u.port ? ':' + u.port : ''}`

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

mkdirSync(shots, { recursive: true })
const restore = []
let browser
let accountToken = ''
let accountEmail = ''

/** A fresh browser with what the page did recorded: account calls, page errors, failed calls, what it showed. */
async function open({ account = false, delayMs = 0, viewport = { width: 1440, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => {
    window.__seen = { password: false, signingIn: false, signingInAt: 0, formAt: 0 }
    const look = () => {
      const s = window.__seen
      if (!s.password && document.querySelector('input[type=password]')) { s.password = true; s.formAt = performance.now() }
      if (!s.signingIn && (document.body?.textContent || '').includes('Signing you in')) { s.signingIn = true; s.signingInAt = performance.now() }
    }
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true })
  })
  const page = await ctx.newPage()
  page.setDefaultNavigationTimeout(180_000)
  const rec = { refresh: 0, refreshStatus: [], session: [], sessionStatus: [], urls: [], errors: [], failedApi: [] }
  page.on('pageerror', (e) => rec.errors.push(String(e).split('\n')[0]))
  page.on('request', (r) => {
    rec.urls.push(r.url())
    if (r.url().includes('/v1/accounts/auth/refresh')) rec.refresh++
    if (r.url().includes('/v1/accounts/workspaces/session')) rec.session.push(r.postData() || '')
  })
  page.on('response', (r) => {
    if (r.url().includes('/v1/accounts/auth/refresh')) rec.refreshStatus.push(r.status())
    if (r.url().includes('/v1/accounts/workspaces/session')) rec.sessionStatus.push(r.status())
    if (r.url().includes('/api/') && r.status() >= 400) rec.failedApi.push(`${r.status()} ${new URL(r.url()).pathname}`)
  })
  if (account) await withAccount(ctx, delayMs)
  return { ctx, page, rec }
}

/** This browser is signed in on the website: the account refresh answers with the real account token. */
async function withAccount(ctx, delayMs = 0) {
  await ctx.route('**/api/v1/accounts/auth/refresh', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ accessToken: accountToken, account: { email: accountEmail }, workspaces: [] }),
    }).catch(() => { /* the page cancelled the call (its deadline): nothing to answer */ })
  })
}

const seen = (page) => page.evaluate(() => window.__seen)
const mark = (page) => page.evaluate((k) => { try { return localStorage.getItem(k) } catch { return 'unreadable' } }, MARK)
const toasts = (page) => page.locator('[data-sonner-toast]').count()

async function passwordSignIn(page, email) {
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  return page.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => true, () => false)
}

async function welcomeAndSettle(page) {
  const splash = page.getByText('Welcome back').first()
  const shown = await splash.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false)
  await splash.waitFor({ state: 'detached', timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(800)
  return shown
}

async function signOutHere(page) {
  if (!new URL(page.url()).pathname.startsWith('/modules')) { await page.goto(base + '/modules'); await page.waitForTimeout(1500) }
  await page.getByRole('button', { name: 'Account: profile and sign out' }).click()
  const item = page.getByRole('menuitem', { name: 'Sign out' })
  if (await item.count()) await item.first().click()
  else await page.getByText('Sign out', { exact: true }).first().click()
  return page.waitForURL((x) => x.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => true, () => false)
}

try {
  // ── Fixture: a website account for one demo login (the first one that has none yet) ──────────────────────────
  const logins = [
    ['owner@unifiedtree.demo', '66666666-6666-6666-6666-666666666666', 'OWNER'],
    ['admin@unifiedtree.demo', '11111111-1111-1111-1111-111111111111', 'ADMIN'],
    ['hrm@unifiedtree.demo', '33333333-3333-3333-3333-333333333333', 'EMPLOYEE'],
  ]
  const login = logins.find(([, id]) => sql(`SELECT count(*) FROM platform.account_workspaces WHERE tenant_id='${DEMO}' AND auth_user_id='${id}'`) === '0')
  if (!login) throw new Error('every demo login used here already has a website account; nothing to test with')
  const [loginEmail, loginId, workspaceRole] = login
  const accountId = randomUUID()
  accountEmail = `handoff-${Date.now()}@example.test`
  restore.push(() => sql(`DELETE FROM platform.accounts WHERE id='${accountId}'`)) // its membership and refresh rows go with it
  sql(`INSERT INTO platform.accounts (id, email, display_name, password_hash, status, email_verified)
       SELECT '${accountId}', '${accountEmail}', 'Handoff Test', password_hash, 'ACTIVE', true FROM auth.user_credentials WHERE id='${loginId}'`)
  sql(`INSERT INTO platform.account_workspaces (id, account_id, tenant_id, auth_user_id, role, default_workspace, status)
       VALUES ('${randomUUID()}', '${accountId}', '${DEMO}', '${loginId}', '${workspaceRole}', true, 'ACTIVE')`)
  const mfaBefore = sql(`SELECT coalesce(mfa_policy, 'OFF') FROM platform.tenants WHERE id='${DEMO}'`)
  restore.push(() => sql(`UPDATE platform.tenants SET mfa_policy='${mfaBefore}' WHERE id='${DEMO}'`))
  info('fixture', `website account ${accountEmail} → ${loginEmail} in demo; two-factor rule ${mfaBefore}`)

  // ── API ────────────────────────────────────────────────────────────────────────────────────────────────────
  const acct = await call('/v1/accounts/auth/login', { method: 'POST', body: { email: accountEmail, password } })
  accountToken = acct.json?.accessToken || ''
  check('API: the website account signs in', acct.status === 200 && !!accountToken, `status=${acct.status}`)
  const silentOk = await call('/v1/accounts/workspaces/session', { method: 'POST', token: accountToken, body: { tenantId: DEMO, silent: true } })
  check('API: silent: true, no two-factor: this business’s session', silentOk.status === 200 && !!silentOk.json?.auth?.accessToken && silentOk.json?.auth?.tenantId === DEMO, `status=${silentOk.status}`)
  sql(`UPDATE platform.tenants SET mfa_policy='EVERYONE' WHERE id='${DEMO}'`)
  const silent2fa = await call('/v1/accounts/workspaces/session', { method: 'POST', token: accountToken, body: { tenantId: DEMO, silent: true } })
  check('API: silent: true, two-factor needed: refused, 403 USE_PASSWORD_FOR_TWO_FACTOR', silent2fa.status === 403 && silent2fa.json?.errorCode === 'USE_PASSWORD_FOR_TWO_FACTOR', `status=${silent2fa.status} code=${silent2fa.json?.errorCode}`)
  const enter2fa = await call('/v1/accounts/workspaces/session', { method: 'POST', token: accountToken, body: { tenantId: DEMO } })
  check('API: without the flag (the website’s Enter): as before, a session', enter2fa.status === 200 && !!enter2fa.json?.auth?.accessToken, `status=${enter2fa.status}`)
  sql(`UPDATE platform.tenants SET mfa_policy='${mfaBefore}' WHERE id='${DEMO}'`)
  const notMember = await call('/v1/accounts/workspaces/session', { method: 'POST', token: accountToken, body: { tenantId: randomUUID(), silent: true } })
  check('API: a business the account is not part of: refused (403)', notMember.status === 403, `status=${notMember.status}`)
  const handOverToken = enter2fa.json?.auth?.accessToken || silentOk.json?.auth?.accessToken || ''

  browser = await chromium.launch({ headless: true })

  // ── No account sign-in: the form, quickly; password sign-in, sign-out, the mark ───────────────────────────────
  {
    const s = await open()
    await s.page.goto(base + '/login', { timeout: 180_000 })
    await s.page.locator('input[type=email]').waitFor({ timeout: 90_000 })
    const v = await seen(s.page)
    const waited = v.signingIn ? Math.round(v.formAt - v.signingInAt) : 0
    check('no account sign-in: the form shows', await s.page.locator('input[type=password]').isVisible())
    check('no account sign-in: "Signing you in…" for under 2 s before the form', waited < 2000, `${waited} ms${v.signingIn ? '' : ' (not shown)'}`)
    check('no account sign-in: the account refresh asked once, answered 401', s.rec.refresh === 1 && s.rec.refreshStatus[0] === 401, `${s.rec.refresh} call(s) ${s.rec.refreshStatus.join(',')}`)
    check('no account sign-in: no session asked for', s.rec.session.length === 0)
    check('no account sign-in: no toast', (await toasts(s.page)) === 0)
    await s.page.screenshot({ path: `${shots}/handoff-no-account-form-1440.png` })

    const inOk = await passwordSignIn(s.page, loginEmail)
    check('password sign-in still works', inOk, s.page.url())
    check('password sign-in: the welcome still plays', await welcomeAndSettle(s.page))
    check('password sign-in: no sign-out mark', (await mark(s.page)) === null)

    const outOk = await signOutHere(s.page)
    check('Sign out: back on the sign-in page', outOk, s.page.url())
    await s.page.locator('input[type=email]').waitFor({ timeout: 30_000 })
    check('Sign out: the form at once (no "Signing you in…")', !(await s.page.getByText('Signing you in…').isVisible()))
    check('Sign out: this business is marked signed out in this browser', (await mark(s.page)) === '1', String(await mark(s.page)))
    await s.page.screenshot({ path: `${shots}/handoff-after-signout-1440.png` })

    // Even signed in on the website, and after a reload (a new page load), nothing is tried.
    await withAccount(s.ctx)
    const before = s.rec.refresh
    await s.page.reload()
    await s.page.locator('input[type=email]').waitFor({ timeout: 60_000 })
    await s.page.waitForTimeout(2000)
    check('after Sign out, with an account sign-in, reloaded: the form, and no account call', s.rec.refresh === before && s.rec.session.length === 0, `${s.rec.refresh - before} refresh call(s)`)
    check('after Sign out, reloaded: still signed out (no welcome, on /login)', new URL(s.page.url()).pathname === '/login' && !(await s.page.getByText('Welcome back').isVisible()))

    // Signing in with the form spends the mark.
    const again = await passwordSignIn(s.page, loginEmail)
    await welcomeAndSettle(s.page)
    check('signing in with the form again clears the mark', again && (await mark(s.page)) === null, String(await mark(s.page)))

    // And so does a hand-over (the website's, as it reaches a local address: ?token=).
    await signOutHere(s.page)
    check('signed out again: marked', (await mark(s.page)) === '1')
    await s.page.goto(base + '/?token=' + encodeURIComponent(handOverToken))
    const handed = await s.page.waitForURL((x) => x.pathname === '/modules', { timeout: 60_000 }).then(() => true, () => false)
    await welcomeAndSettle(s.page)
    check('a hand-over from the website clears the mark', handed && (await mark(s.page)) === null, `${s.page.url()} mark=${await mark(s.page)}`)
    check('a hand-over leaves no token in the address', !new URL(s.page.url()).search.includes('token'), s.page.url())
    check('this browser: no page errors', s.rec.errors.length === 0, s.rec.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── Signed in on the website: a deep link signs in without the form, and stays on the deep link ──────────────
  {
    const s = await open({ account: true, delayMs: 1500 }) // a slower answer, so the screenshot catches the wait
    await s.page.goto(base + '/hrms/leave', { timeout: 180_000 })
    await s.page.getByText('Signing you in…').waitFor({ timeout: 90_000 })
    await s.page.screenshot({ path: `${shots}/handoff-signing-in-1440.png` })
    const landed = await s.page.waitForURL((x) => x.pathname === '/hrms/leave', { timeout: 30_000 }).then(() => true, () => false)
    const welcomed = await welcomeAndSettle(s.page)
    const v = await seen(s.page)
    check('account sign-in, deep link: signed in and on /hrms/leave', landed && new URL(s.page.url()).pathname === '/hrms/leave', s.page.url())
    check('account sign-in: "Signing you in…" was shown', v.signingIn)
    check('account sign-in: the form never showed', !v.password)
    check('account sign-in: the welcome plays, as after a password sign-in', welcomed)
    const body = s.rec.session[0] ? JSON.parse(s.rec.session[0]) : {}
    check('account sign-in: one session call for this business, silent', s.rec.session.length === 1 && body.tenantId === DEMO && body.silent === true, s.rec.session.join(' | '))
    check('account sign-in: one account refresh', s.rec.refresh === 1, String(s.rec.refresh))
    check('account sign-in: no token in any address', !s.rec.urls.some((x) => /[?&#](token|accessToken)=/i.test(x)))
    check('account sign-in: the page is the signed-in Leave page, not a sign-in', !(await s.page.locator('input[type=password]').count()) && !/Sign in to/.test(await s.page.locator('body').innerText()))
    check('account sign-in: no sign-out mark', (await mark(s.page)) === null)
    check('account sign-in: no page errors', s.rec.errors.length === 0, s.rec.errors.slice(0, 3).join(' | '))
    await s.page.screenshot({ path: `${shots}/handoff-deep-link-signed-in-1440.png` })
    await s.ctx.close()
  }

  // ── The root keeps today's landing (the Apps page), on a phone too ───────────────────────────────────────────
  for (const [w, h, tag] of [[1440, 1000, '1440'], [390, 844, '390']]) {
    const s = await open({ account: true, delayMs: tag === '390' ? 1500 : 0, viewport: { width: w, height: h } })
    await s.page.goto(base + '/', { timeout: 180_000 })
    if (tag === '390') {
      await s.page.getByText('Signing you in…').waitFor({ timeout: 90_000 })
      await s.page.screenshot({ path: `${shots}/handoff-signing-in-390.png` })
    }
    const landed = await s.page.waitForURL((x) => x.pathname === '/modules', { timeout: 90_000 }).then(() => true, () => false)
    await welcomeAndSettle(s.page)
    check(`[${tag}] account sign-in at the root: the Apps page (/modules)`, landed, s.page.url())
    check(`[${tag}] the form never showed`, !(await seen(s.page)).password)
    if (tag === '390') {
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check('[390] no sideways scroll', overflow <= 1, `${overflow}px`)
    }
    check(`[${tag}] no page errors`, s.rec.errors.length === 0, s.rec.errors.slice(0, 3).join(' | '))
    await s.ctx.close()
  }

  // ── /login opened directly, signed in on the website: into the app, the Apps page ────────────────────────────
  {
    const s = await open({ account: true })
    await s.page.goto(base + '/login', { timeout: 180_000 })
    const landed = await s.page.waitForURL((x) => x.pathname === '/modules', { timeout: 90_000 }).then(() => true, () => false)
    await welcomeAndSettle(s.page)
    check('/login opened directly, account sign-in: the Apps page, no form', landed && !(await seen(s.page)).password, s.page.url())
    await s.ctx.close()
  }

  // ── The server refuses (two-factor required): the form, without a word, and no second try ───────────────────
  {
    sql(`UPDATE platform.tenants SET mfa_policy='EVERYONE' WHERE id='${DEMO}'`)
    try {
      const s = await open({ account: true })
      await s.page.goto(base + '/hrms/leave', { timeout: 180_000 })
      await s.page.locator('input[type=email]').waitFor({ timeout: 90_000 })
      await s.page.waitForTimeout(2500)
      check('refused: the form shows, on the sign-in page', new URL(s.page.url()).pathname === '/login' && await s.page.locator('input[type=password]').isVisible(), s.page.url())
      check('refused: the server said 403 once, and nothing was tried again', s.rec.session.length === 1 && s.rec.sessionStatus[0] === 403 && s.rec.refresh === 1, `session ${s.rec.sessionStatus.join(',')} refresh ${s.rec.refresh}`)
      const text = await s.page.locator('body').innerText()
      check('refused: no error on the page, no toast', !/two-factor|couldn|failed|error/i.test(text) && (await toasts(s.page)) === 0, text.slice(0, 160).replace(/\s+/g, ' '))
      check('refused: the normal heading', text.includes('Sign in to'))
      await s.page.screenshot({ path: `${shots}/handoff-refused-form-1440.png` })
      await s.ctx.close()
    } finally {
      sql(`UPDATE platform.tenants SET mfa_policy='${mfaBefore}' WHERE id='${DEMO}'`)
    }
  }

  // ── No answer in time: the form after about 4 s; a late answer signs nobody in ───────────────────────────────
  {
    const s = await open({ account: true, delayMs: 7000, viewport: { width: 390, height: 844 } })
    await s.page.goto(base + '/login', { timeout: 180_000 })
    await s.page.getByText('Signing you in…').waitFor({ timeout: 90_000 })
    await s.page.locator('input[type=email]').waitFor({ timeout: 15_000 })
    const v = await seen(s.page)
    const waited = Math.round(v.formAt - v.signingInAt)
    check('no answer: the form after about 4 s', waited >= 3000 && waited <= 6000, `${waited} ms`)
    await s.page.waitForTimeout(5000) // past the late answer
    check('no answer: a late answer signs nobody in', new URL(s.page.url()).pathname === '/login' && s.rec.session.length === 0 && !(await s.page.getByText('Welcome back').isVisible()), `${s.page.url()} sessions=${s.rec.session.length}`)
    check('no answer: no toast, no page errors', (await toasts(s.page)) === 0 && s.rec.errors.length === 0, s.rec.errors.slice(0, 2).join(' | '))
    await s.page.screenshot({ path: `${shots}/handoff-timeout-form-390.png` })
    await s.ctx.close()
  }

  // ── UnifiedTree's own addresses and unknown ones never ask ───────────────────────────────────────────────────
  for (const [sub, heading] of [['admin', 'There’s no business here'], ['marketing', 'There’s no business here'], ['tata', 'This workspace doesn’t exist']]) {
    const s = await open({ account: true })
    await s.page.goto(hostUrl(sub) + '/login', { timeout: 180_000 })
    await s.page.getByRole('heading', { name: heading }).waitFor({ timeout: 60_000 }).catch(() => {})
    await s.page.waitForTimeout(1500)
    check(`${sub}.: its own page, and no account call`, (await s.page.getByRole('heading', { name: heading }).count()) === 1 && s.rec.refresh === 0 && s.rec.session.length === 0, `refresh=${s.rec.refresh}`)
    await s.ctx.close()
  }
} catch (e) {
  check('test ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const r of restore.reverse()) { try { r() } catch (e) { check('cleanup step', false, String(e).split('\n')[0]) } }
  if (accountEmail) {
    const left = sql(`SELECT count(*) FROM platform.accounts WHERE email='${accountEmail}'`)
    check('cleanup: the website account and its membership are gone', left === '0', `${left} left`)
  }
  check('cleanup: the business’s two-factor rule is back', ['OFF', 'ADMINS', 'EVERYONE'].includes(sql(`SELECT coalesce(mfa_policy, 'OFF') FROM platform.tenants WHERE id='${DEMO}'`)))
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
