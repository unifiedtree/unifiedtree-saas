// Live check for feat/marketing-launcher: the Marketing tile (All apps) and button (business frame), against the
// local backend's real SSO API and a LOCAL Marketing mock page that records the ticket it receives.
//
//   export UNIFIEDTREE_MARKETING_SERVICE_TOKEN=<32+ chars>  VITE_MARKETING_APP_URL=http://localhost:3998
//   live-slot.sh /c/REACT/ut-wt/w81-mktlaunch 3081 node e2e/recovery/live-w81-mktlaunch.mjs
//   (both variables reach the slot's backend and vite: they inherit the caller's environment)
//
// What it proves:
//  - Signed in with the workspace password only (no account sign-in): no tile, one refresh (401), no SSO call.
//  - Account sign-in, company without Marketing: no tile. With a Marketing entitlement (planted in the slot DB): the
//    tile on All apps and the button in the business frame; the SSO calls carry the ACCOUNT token, not the workspace one.
//  - A click hands off the CURRENT company and opens <Marketing>/auth/unifiedtree/callback#ticket=… in the same tab:
//    the mock's server never sees the ticket (no query string, not in any URL or Referer), only the page's fragment
//    does; Java redeems it once and refuses it the second time (single use).
//  - Refusals in plain words, each a real answer from Java: not entitled, not a member, login switched off, login
//    locked; service down (injected 503) offers Try again, which then works.
//  - Several companies: the chooser (current first); a company the person can't open is refused inside it.
//  - Phone (390 wide): no sideways scroll. Without VITE_MARKETING_APP_URL (a second vite): no tile and zero calls.
// The account sign-in cookie (ut_acct_rt) is Domain=.unifiedtree.com, which a browser on demo.localhost drops; the
// test rewrites the Set-Cookie domain of the refresh response (what the browser does by itself on *.unifiedtree.com),
// so rotation works as in production. Everything planted is removed at the end.
/* global process, console, fetch, URL, URLSearchParams, Buffer, setTimeout, document, window */
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3081'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const MKT_PORT = Number(process.env.MKT_PORT || 3998)
const NO_ENV_PORT = Number(process.env.NO_ENV_PORT || 3997)
const SERVICE_TOKEN = process.env.UNIFIEDTREE_MARKETING_SERVICE_TOKEN || ''
const MKT = `http://localhost:${MKT_PORT}`
const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const OWNER = 'owner@unifiedtree.demo'
const OWNER_USER = '66666666-6666-6666-6666-666666666666'
mkdirSync(shots, { recursive: true })

const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const payload = (jwt) => { try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString()) } catch { return {} } }
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

// ── The Marketing mock: records every request it gets, and what its callback page found in the fragment ──
const mock = { requests: [], records: [] }
const server = createServer((req, res) => {
  mock.requests.push({ method: req.method, url: req.url, referer: req.headers.referer || '' })
  if (req.method === 'POST' && req.url === '/record') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { try { mock.records.push(JSON.parse(body)) } catch { /* ignore */ } res.writeHead(204); res.end() })
    return
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/auth/unifiedtree/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Marketing (local mock)</title></head>
<body style="font-family:system-ui;padding:40px"><h1>Marketing (local mock)</h1><p id="s">Reading the link…</p><script>
const hash = location.hash, search = location.search, path = location.pathname;
history.replaceState(null, '', path);
fetch('/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash, search, path }) })
  .then(() => { document.getElementById('s').textContent = hash.indexOf('#ticket=') === 0 ? 'A ticket arrived in the fragment.' : 'No ticket.' });
</script></body></html>`)
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(MKT_PORT, r))

async function nextRecord(before, ms = 20000) {
  for (let t = 0; t < ms; t += 250) { if (mock.records.length > before) return mock.records[before]; await sleep(250) }
  return null
}
const ticketOf = (rec) => new URLSearchParams(String(rec?.hash || '').replace(/^#/, '')).get('ticket')
async function redeem(ticket) {
  const r = await fetch(`${api}/v1/internal/marketing/sso/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UnifiedTree-Service-Token': SERVICE_TOKEN }, body: JSON.stringify({ ticket }) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// ── What the browser sends to the API ──
const calls = []          // refresh + SSO calls: { label, method, path, status, auth, cookie, body }
const failures = []       // every API 4xx/5xx: { label, path, status }
const errors = []
let label = 'setup'
function watch(context) {
  context.on('response', async (res) => {
    const req = res.request()
    const u = new URL(req.url())
    if (!u.pathname.startsWith('/api/')) return
    const path = u.pathname.replace(/^\/api/, '')
    if (res.status() >= 400) failures.push({ label, path, status: res.status() })
    if (/^\/v1\/(accounts\/auth\/refresh|sso\/marketing\/)/.test(path)) {
      const h = await req.allHeaders().catch(() => ({}))
      calls.push({ label, port: u.port, method: req.method(), path, query: u.search, status: res.status(), auth: h.authorization || '', cookie: h.cookie || '', body: req.postData() || '' })
    }
  })
}
const callsIn = (l) => calls.filter((c) => c.label === l)

// route.fetch runs in Node, which can't resolve demo.localhost: the same vite, on the loopback address.
const fetchOnLoopback = async (route) => route.fetch({
  url: route.request().url().replace('//demo.localhost:', '//127.0.0.1:'),
  headers: await route.request().allHeaders(),
})

// Production's browser keeps the rotated ut_acct_rt (Domain=.unifiedtree.com); on demo.localhost the test does it.
async function rewriteAccountCookie(context) {
  await context.route('**/api/v1/accounts/auth/refresh', async (route) => {
    try {
      const response = await fetchOnLoopback(route)
      const headers = response.headers()
      if (headers['set-cookie']) {
        headers['set-cookie'] = headers['set-cookie'].split('\n').map((c) => c.replace(/;\s*Domain=[^;]*/i, '').replace(/;\s*Secure/i, '')).join('\n')
      }
      await route.fulfill({ response, headers })
    } catch (e) {
      errors.push(`refresh route: ${e.message.split('\n')[0]}`)
      await route.abort().catch(() => {})
    }
  })
}

/** A fresh account sign-in for the owner, as the website's login leaves it: the ut_acct_rt value. */
async function accountCookie() {
  const r = await fetch(`${api}/v1/accounts/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER, password }) })
  const set = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('ut_acct_rt='))
  if (r.status !== 200 || !set) throw new Error(`account login ${r.status}`)
  return set.split(';')[0].slice('ut_acct_rt='.length)
}

async function signIn(context, origin, width = 1440) {
  const page = await context.newPage()
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  await page.locator('input[type=email]').fill(OWNER)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 4000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  return page
}
async function openApps(page, origin = base) {
  await page.goto(origin + '/modules', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('heading', { name: 'Choose an app' }).waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
}
const tile = (page) => page.locator('.ut-apps__grid [data-app="marketing"]')
const frameButton = (page) => page.locator('.ut-topbar__right [data-app="marketing"]')
const errorDialog = (page) => page.getByRole('alertdialog', { name: 'Marketing couldn’t be opened' })
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Click, then the mock should get the ticket. Checks the URL contract and redeems it twice. */
async function handOff(page, click, name) {
  const before = mock.records.length
  const requestsBefore = mock.requests.length
  const handoffsBefore = calls.filter((c) => c.path === '/v1/sso/marketing/handoff').length
  await click()
  const rec = await nextRecord(before)
  check(`${name}: opens Marketing's callback in the same tab`, !!rec && rec.path === '/auth/unifiedtree/callback', rec ? rec.path : 'nothing arrived')
  await page.waitForURL((u) => u.origin === MKT, { timeout: 10000 }).catch(() => {})
  check(`${name}: same tab`, new URL(page.url()).origin === MKT, page.url().split('#')[0])
  const ticket = ticketOf(rec)
  check(`${name}: the ticket is in the fragment, the query string is empty`, !!ticket && /^#ticket=[A-Za-z0-9_-]{40,}$/.test(rec.hash) && rec.search === '', rec ? `search="${rec.search}" fragment ${rec.hash ? 'present' : 'missing'}` : '')
  const seen = mock.requests.slice(requestsBefore)
  check(`${name}: Marketing's server never sees the ticket (URLs, Referer)`, !!ticket && seen.length > 0 && seen.every((r) => !r.url.includes(ticket) && !r.url.includes('ticket') && !r.referer.includes(ticket)),
    seen.map((r) => `${r.method} ${r.url}`).join(', '))
  const handoff = calls.filter((c) => c.path === '/v1/sso/marketing/handoff').slice(handoffsBefore).pop()
  const body = handoff ? JSON.parse(handoff.body || '{}') : {}
  check(`${name}: the handoff was for this business and the current company`, body.tenantId === TENANT && body.companyId === CO, handoff ? handoff.body : 'no handoff call')
  check(`${name}: the handoff carried the ACCOUNT token, not the workspace one`, payload(handoff?.auth.replace(/^Bearer /, '')).token_type === 'account')
  check(`${name}: no ticket in any API call's URL`, !!ticket && calls.every((c) => !(c.path + c.query).includes(ticket)))
  const first = await redeem(ticket)
  check(`${name}: Java redeems it (the person and the company)`, first.status === 200 && first.json?.companyId === CO && first.json?.tenantId === TENANT && first.json?.email === OWNER,
    `${first.status} ${first.json ? `${first.json.email} ${first.json.companyId}` : ''}`)
  const second = await redeem(ticket)
  check(`${name}: a second redeem is refused (single use)`, second.status === 401, String(second.status))
  check(`${name}: the stored ticket is used`, sql(`select count(*) from platform.sso_handoff_tickets where ticket_hash='${sha256(ticket)}' and consumed_at is not null`) === '1')
}

// ── Setup: an account for the owner (the demo data has none) and, later, Marketing for the company ──
let createdAccount = null
let createdMembership = false
let createdEntitlement = false
let browser = null
let noEnvVite = null
const stopNoEnvVite = () => { if (noEnvVite) { try { execFileSync('taskkill', ['/pid', String(noEnvVite.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ } noEnvVite = null } }

try {
  check('precheck: V144_105 applied (sso_handoff_tickets)', sql(`select to_regclass('platform.sso_handoff_tickets') is not null`) === 't')
  const ent = await fetch(`${api}/v1/internal/marketing/companies/${CO}/entitlement?tenantId=${TENANT}`, { headers: { 'X-UnifiedTree-Service-Token': SERVICE_TOKEN } })
  check('precheck: the backend has a Marketing service token (to redeem)', ent.status === 200, String(ent.status))
  check('precheck: this vite was built with VITE_MARKETING_APP_URL = the mock', process.env.VITE_MARKETING_APP_URL === MKT, String(process.env.VITE_MARKETING_APP_URL))
  check('precheck: the company has no Marketing yet', sql(`select count(*) from platform.company_modules where company_id='${CO}' and module_key='whatsapp'`) === '0')

  let accountId = sql(`select id from platform.accounts where lower(email)='${OWNER}'`)
  if (!accountId) {
    accountId = randomUUID()
    sql(`insert into platform.accounts (id, email, display_name, password_hash, status, failed_login_count, password_updated_at)
         select '${accountId}', '${OWNER}', 'Demo Owner', password_hash, 'ACTIVE', 0, now() from auth.user_credentials where id='${OWNER_USER}'`)
    createdAccount = accountId
  }
  if (sql(`select count(*) from platform.account_workspaces where account_id='${accountId}' and tenant_id='${TENANT}'`) === '0') {
    sql(`insert into platform.account_workspaces (id, account_id, tenant_id, auth_user_id, role, default_workspace, status)
         values (gen_random_uuid(), '${accountId}', '${TENANT}', '${OWNER_USER}', 'OWNER', true, 'ACTIVE')`)
    createdMembership = true
  }

  // The token-type finding: the SSO endpoints refuse the business app's own (workspace) token
  const ws = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT }, body: JSON.stringify({ tenantId: TENANT, email: OWNER, password }) }).then((r) => r.json())
  const wsHeaders = { Authorization: `Bearer ${ws.accessToken}`, 'X-Tenant-ID': TENANT, 'Content-Type': 'application/json' }
  const wsList = await fetch(`${api}/v1/sso/marketing/companies`, { headers: wsHeaders })
  const wsHandoff = await fetch(`${api}/v1/sso/marketing/handoff`, { method: 'POST', headers: wsHeaders, body: JSON.stringify({ tenantId: TENANT, companyId: CO }) })
  check('a WORKSPACE token is refused by both SSO endpoints (403)', !!ws.accessToken && wsList.status === 403 && wsHandoff.status === 403, `${wsList.status} / ${wsHandoff.status}`)

  browser = await chromium.launch()

  // ── 1. Workspace password only: no account sign-in on this browser ──
  label = 'no-account'
  const plain = await browser.newContext()
  watch(plain)
  const p1 = await signIn(plain, base)
  await openApps(p1)
  check('password-only sign-in: no Marketing tile', (await tile(p1).count()) === 0)
  const c1 = callsIn('no-account')
  check('password-only sign-in: only refreshes (401), no SSO call', c1.length > 0 && c1.every((c) => c.path === '/v1/accounts/auth/refresh' && c.status === 401),
    c1.map((c) => `${c.method} ${c.path} ${c.status}`).join(', '))
  await plain.close()

  // ── 2. Account sign-in, company without Marketing ──
  label = 'no-entitlement'
  const ctx = await browser.newContext()
  watch(ctx)
  await rewriteAccountCookie(ctx)
  await ctx.addCookies([{ name: 'ut_acct_rt', value: await accountCookie(), domain: 'demo.localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }])
  const page = await signIn(ctx, base)
  await openApps(page)
  const c2 = callsIn('no-entitlement')
  check('no Marketing for the company: no tile', (await tile(page).count()) === 0)
  const refresh2 = c2.find((c) => c.path === '/v1/accounts/auth/refresh')
  check('the refresh sends the cookie and no bearer', refresh2?.status === 200 && refresh2.cookie.includes('ut_acct_rt=') && !refresh2.auth, refresh2 ? `${refresh2.status}` : 'none')
  const list2 = c2.find((c) => c.path === '/v1/sso/marketing/companies')
  check('the companies list is asked with the ACCOUNT token', list2?.status === 200 && payload(list2.auth.replace(/^Bearer /, '')).token_type === 'account', list2 ? String(list2.status) : 'none')

  // ── 3. Marketing for the company: the tile, the frame button, a real handoff from each ──
  sql(`insert into platform.company_modules (tenant_id, company_id, module_key, status, source, reason, granted_by)
       values ('${TENANT}', '${CO}', 'whatsapp', 'ACTIVE', 'MANUAL', 'live test w81 marketing launcher', 'w81-live-test')`)
  createdEntitlement = true
  label = 'entitled'
  await openApps(page)
  check('Marketing for the company: the tile shows on All apps', await tile(page).isVisible())
  check('one refresh for this page load', callsIn('entitled').filter((c) => c.path === '/v1/accounts/auth/refresh').length === 1)
  await page.screenshot({ path: `${shots}/w81-mktlaunch-apps-1440.png`, fullPage: true })

  await page.getByRole('button', { name: /^Business details/ }).click()
  await page.waitForURL((u) => u.pathname === '/business/details', { timeout: 15000 })
  await frameButton(page).waitFor({ timeout: 15000 })
  check('business frame: Marketing next to All apps', await frameButton(page).isVisible())
  check('moving inside the app: no second refresh', callsIn('entitled').filter((c) => c.path === '/v1/accounts/auth/refresh').length === 1)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${shots}/w81-mktlaunch-frame-1440.png` })
  await handOff(page, () => frameButton(page).click(), 'business frame')

  label = 'tile'
  await openApps(page)
  await tile(page).waitFor({ timeout: 15000 })
  await handOff(page, () => tile(page).click(), 'All apps tile')

  // ── 4. Refusals, each a real answer from Java (one page load: the tile stays, the database changes) ──
  label = 'refusals'
  await openApps(page)
  await tile(page).waitFor({ timeout: 15000 })
  const refusal = async (name, change, undo, text, retry = false) => {
    sql(change)
    try {
      await tile(page).click()
      await errorDialog(page).waitFor({ timeout: 15000 }).catch(() => {})
      const shown = await errorDialog(page).innerText().catch(() => '')
      check(`${name}: says so in plain words`, shown.includes(text), shown.replace(/\s+/g, ' ').slice(0, 160))
      check(`${name}: ${retry ? 'offers' : 'no'} Try again`, (await errorDialog(page).getByRole('button', { name: 'Try again' }).count()) === (retry ? 1 : 0))
      check(`${name}: stays on this page`, new URL(page.url()).origin === new URL(base).origin)
      return shown
    } finally {
      sql(undo)
    }
  }
  await refusal('not entitled', `update platform.company_modules set status='SUSPENDED' where company_id='${CO}' and module_key='whatsapp' and source='MANUAL'`,
    `update platform.company_modules set status='ACTIVE' where company_id='${CO}' and module_key='whatsapp' and source='MANUAL'`, 'This company doesn’t have Marketing.')
  await page.screenshot({ path: `${shots}/w81-mktlaunch-refused-1440.png` })
  await errorDialog(page).getByRole('button', { name: 'Close' }).click()
  await refusal('not a member', `update platform.account_workspaces set status='SUSPENDED' where account_id='${accountId}' and tenant_id='${TENANT}'`,
    `update platform.account_workspaces set status='ACTIVE' where account_id='${accountId}' and tenant_id='${TENANT}'`, 'You’re no longer a member of this business.')
  await errorDialog(page).getByRole('button', { name: 'Close' }).click()
  await refusal('login switched off', `update auth.user_credentials set is_active=false where id='${OWNER_USER}'`,
    `update auth.user_credentials set is_active=true where id='${OWNER_USER}'`, 'Your login is switched off.')
  await errorDialog(page).getByRole('button', { name: 'Close' }).click()
  await refusal('login locked', `update auth.user_credentials set locked_until=now() + interval '10 minutes' where id='${OWNER_USER}'`,
    `update auth.user_credentials set locked_until=null where id='${OWNER_USER}'`, 'Your login is locked for a while')
  await errorDialog(page).getByRole('button', { name: 'Close' }).click()
  // Service down: an injected 503 on the handoff; Try again once it is back
  await page.route('**/api/v1/sso/marketing/handoff', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Service Unavailable"}' }))
  await tile(page).click()
  await errorDialog(page).waitFor({ timeout: 15000 }).catch(() => {})
  const down = await errorDialog(page).innerText().catch(() => '')
  check('service down: says so, offers Try again', down.includes('Marketing can’t be opened right now') && (await errorDialog(page).getByRole('button', { name: 'Try again' }).count()) === 1, down.replace(/\s+/g, ' ').slice(0, 120))
  await page.unroute('**/api/v1/sso/marketing/handoff')
  label = 'retry'
  await handOff(page, () => errorDialog(page).getByRole('button', { name: 'Try again' }).click(), 'Try again after the outage')

  // ── 5. Several companies: the chooser (a second company is added to the answer; Java refuses it) ──
  label = 'chooser'
  const fakeCo = randomUUID()
  await page.route('**/api/v1/sso/marketing/companies', async (route) => {
    try {
      const response = await fetchOnLoopback(route)
      const list = await response.json()
      for (const ws of list) if (ws.tenantId === TENANT) ws.companies.push({ companyId: fakeCo, name: 'Second test company', home: false, access: 'GRANT', roles: [], marketingEntitled: true })
      await route.fulfill({ response, json: list })
    } catch (e) {
      errors.push(`companies route: ${e.message.split('\n')[0]}`)
      await route.abort().catch(() => {})
    }
  })
  await openApps(page)
  await tile(page).click()
  const chooser = page.getByRole('dialog', { name: 'Open Marketing' })
  await chooser.waitFor({ timeout: 15000 })
  const rows = (await chooser.locator('.ut-mkt__co').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check('several companies: the chooser lists them, the current one first', rows.length === 2 && rows[0].includes('Current company') && rows[1].includes('Second test company'), rows.join(' | '))
  await page.screenshot({ path: `${shots}/w81-mktlaunch-chooser-1440.png` })
  await chooser.locator('.ut-mkt__co', { hasText: 'Second test company' }).click()
  await chooser.locator('.uk-callout').waitFor({ timeout: 15000 }).catch(() => {})
  const said = await chooser.locator('.uk-callout').innerText().catch(() => '')
  check('a company the person can’t open: Java refuses, the chooser says so', said.includes('You don’t have access to this company.'), said)
  await page.screenshot({ path: `${shots}/w81-mktlaunch-chooser-refused-1440.png` })
  await handOff(page, () => chooser.locator('.ut-mkt__co', { hasText: 'Current company' }).click(), 'chooser')
  await page.unroute('**/api/v1/sso/marketing/companies')
  await page.close()

  // ── 6. Phone ──
  label = 'phone'
  const phone = await signIn(ctx, base, 390)
  await openApps(phone)
  await tile(phone).waitFor({ timeout: 15000 })
  check('phone: the tile shows; no sideways scroll on All apps', (await tile(phone).isVisible()) && await noSideScroll(phone))
  await tile(phone).scrollIntoViewIfNeeded()
  await phone.screenshot({ path: `${shots}/w81-mktlaunch-apps-390.png` })
  await phone.goto(base + '/business/details', { waitUntil: 'domcontentloaded' })
  await frameButton(phone).waitFor({ timeout: 20000 }).catch(() => {})
  check('phone: the business frame keeps Marketing; no sideways scroll', (await frameButton(phone).isVisible()) && await noSideScroll(phone))
  await phone.screenshot({ path: `${shots}/w81-mktlaunch-frame-390.png` })
  await phone.close()

  // ── 7. A build without VITE_MARKETING_APP_URL (production today): no tile, zero calls ──
  label = 'no-env'
  const env = { ...process.env, VITE_PROXY_TARGET: 'http://127.0.0.1:8080' }
  delete env.VITE_MARKETING_APP_URL
  noEnvVite = spawn('npx', ['vite', '--port', String(NO_ENV_PORT), '--strictPort'], { cwd: '.', shell: true, env, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${NO_ENV_PORT}/`).then((r) => r.ok).catch(() => false)) break; await sleep(1000) }
  const noEnvBase = `http://demo.localhost:${NO_ENV_PORT}`
  const p7 = await signIn(ctx, noEnvBase)
  await openApps(p7, noEnvBase)
  check('without the variable: no Marketing tile', (await tile(p7).count()) === 0)
  await p7.goto(noEnvBase + '/business/details', { waitUntil: 'domcontentloaded' })
  await p7.getByRole('link', { name: 'All apps' }).waitFor({ timeout: 20000 }).catch(() => {})
  await p7.waitForTimeout(1500)
  check('without the variable: no Marketing in the business frame', (await frameButton(p7).count()) === 0)
  check('without the variable: zero refresh or SSO calls', callsIn('no-env').length === 0, callsIn('no-env').map((c) => c.path).join(', '))
  await p7.close()
  stopNoEnvVite()
  await ctx.close()

  // ── Errors ──
  const expected = (f) => (f.label === 'no-account' && f.path === '/v1/accounts/auth/refresh' && f.status === 401)
    || (['refusals', 'chooser'].includes(f.label) && f.path === '/v1/sso/marketing/handoff' && [403, 503].includes(f.status))
  const unexpected = failures.filter((f) => !expected(f))
  check('no unexpected API 4xx/5xx', unexpected.length === 0, unexpected.slice(0, 5).map((f) => `${f.label} ${f.path} ${f.status}`).join(' | '))
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  stopNoEnvVite()
  if (browser) await browser.close().catch(() => {})
  server.close()
  try {
    sql(`update auth.user_credentials set is_active=true, locked_until=null where id='${OWNER_USER}'`)
    if (createdEntitlement) sql(`delete from platform.company_modules where company_id='${CO}' and module_key='whatsapp' and source='MANUAL' and granted_by='w81-live-test'`)
    if (createdMembership && !createdAccount) sql(`delete from platform.account_workspaces where account_id=(select id from platform.accounts where lower(email)='${OWNER}') and tenant_id='${TENANT}'`)
    if (createdAccount) sql(`delete from platform.accounts where id='${createdAccount}'`)   // its membership, refresh tokens and tickets cascade
    check('cleanup: the entitlement, account and its tickets are gone',
      sql(`select count(*) from platform.company_modules where company_id='${CO}' and module_key='whatsapp' and granted_by='w81-live-test'`) === '0'
      && (!createdAccount || sql(`select (select count(*) from platform.accounts where id='${createdAccount}') + (select count(*) from platform.sso_handoff_tickets where account_id='${createdAccount}') + (select count(*) from platform.account_workspaces where account_id='${createdAccount}')`) === '0'))
  } catch (e) {
    check('cleanup ran', false, e.message.split('\n')[0])
  }
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
