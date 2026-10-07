/* global URL, console, process */
// Unknown and reserved workspace addresses (8 Oct 2026).
// Browser + API acceptance against a running backend + web app:
//  - a business (demo) still gets its own branded sign-in, and signing in works
//  - an unknown address (tata.) shows "This workspace doesn't exist" and no sign-in form
//  - UnifiedTree's own addresses (admin., marketing., app.) show the neutral page, no sign-in form
//  - the public lookup answers WORKSPACE_NOT_FOUND / WORKSPACE_RESERVED / the business's status
//  - sign-up refuses a reserved address (availability check and the free sign-up itself)
// Screenshots of every page at 1440 and 390 wide.
//
// Run from apps/platform:  node e2e/recovery/live-w70-subdomain.mjs
//   env: RECOVERY_APP_URL (default http://demo.localhost:3070), RECOVERY_DB (default ut_w3_dev),
//        PSQL, RECOVERY_PASSWORD, SHOTS
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3070'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

const u = new URL(base)
/** The same app on another workspace address: http://<sub>.localhost:<port>. */
const hostUrl = (sub) => `${u.protocol}//${sub}.localhost${u.port ? ':' + u.port : ''}`
const api = (path, init) => fetch(`${base}/api${path}`, init)

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function open(url, viewport) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(180_000)
  await page.goto(url, { timeout: 180_000 })
  return { ctx, page, errors, failedApi }
}

const formFields = (page) => page.locator('input[type=email], input[type=password], form').count()

try {
  // ── public lookup (the one call the web app makes) ─────────────────────────
  {
    const demo = await api('/v1/public/workspace-branding?subdomain=demo')
    const body = await demo.json().catch(() => ({}))
    check('lookup: a business answers 200 with its name and status', demo.status === 200 && body.workspaceName && body.status === 'ACTIVE', `${demo.status} ${body.workspaceName} ${body.status}`)
    const tata = await api('/v1/public/workspace-branding?subdomain=tata')
    const tb = await tata.json().catch(() => ({}))
    check('lookup: an unknown address is 404 WORKSPACE_NOT_FOUND', tata.status === 404 && tb.errorCode === 'WORKSPACE_NOT_FOUND', `${tata.status} ${tb.errorCode}`)
    for (const sub of ['admin', 'marketing', 'business', 'app', 'www']) {
      const r = await api(`/v1/public/workspace-branding?subdomain=${sub}`)
      const b = await r.json().catch(() => ({}))
      check(`lookup: ${sub} is 404 WORKSPACE_RESERVED`, r.status === 404 && b.errorCode === 'WORKSPACE_RESERVED', `${r.status} ${b.errorCode}`)
    }
  }

  // ── sign-up refuses reserved addresses ────────────────────────────────────
  {
    for (const sub of ['marketing', 'business', 'admin']) {
      const r = await api(`/v1/public/subdomains/check?slug=${sub}`)
      const b = await r.json().catch(() => ({}))
      check(`sign-up availability: ${sub} is reserved`, r.ok && b.available === false && /reserved/i.test(b.reason || ''), `${r.status} ${JSON.stringify(b)}`)
    }
    const email = `w70-reserved-${Date.now()}@example.test`
    const r = await api('/v1/public/free-signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: 'Marketing Test', subdomain: 'marketing', adminName: 'W70 Test', adminEmail: email, password: 'Reserved@12345', country: 'India', timezone: 'Asia/Kolkata', currency: 'INR' }),
    })
    const b = await r.json().catch(() => ({}))
    check('free sign-up with a reserved address is refused', r.status === 400 && /reserved/i.test(b.message || ''), `${r.status} ${b.message}`)
    const left = sql(`SELECT count(*) FROM platform.tenants WHERE subdomain = 'marketing'`) + '/' + sql(`SELECT count(*) FROM platform.accounts WHERE lower(email) = lower('${email}')`)
    check('the refused sign-up left nothing behind', left === '0/0', `tenants/accounts = ${left}`)
    // Clean up anyway, in case a later change creates the account before the check.
    sql(`DELETE FROM platform.accounts WHERE lower(email) = lower('${email}') AND NOT EXISTS (SELECT 1 FROM platform.account_workspaces aw WHERE aw.account_id = platform.accounts.id)`)
  }

  // ── pages ─────────────────────────────────────────────────────────────────
  for (const [w, h, tag] of [[1440, 1000, 'desk'], [390, 844, 'phone']]) {
    // A business: branded sign-in.
    {
      const { ctx, page, errors } = await open(base + '/login', { width: w, height: h })
      await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
      await page.waitForTimeout(800)
      const text = await page.locator('body').innerText()
      check(`[${tag}] demo: the sign-in form shows`, await page.locator('input[type=password]').count() === 1)
      check(`[${tag}] demo: with the business's name`, text.includes('UnifiedTree Demo'))
      check(`[${tag}] demo: not the not-found page`, !/doesn’t exist|no business here/i.test(text))
      check(`[${tag}] demo: no page errors`, errors.length === 0, errors.join(' | '))
      await page.screenshot({ path: `${shots}/w70-subdomain-demo-login-${tag}.png`, fullPage: true })
      await ctx.close()
    }
    // Unknown address.
    {
      const { ctx, page, errors } = await open(hostUrl('tata') + '/login', { width: w, height: h })
      await page.getByRole('heading', { name: 'This workspace doesn’t exist' }).waitFor({ timeout: 60_000 }).catch(() => {})
      const heading = await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')
      check(`[${tag}] tata: "This workspace doesn't exist"`, heading === 'This workspace doesn’t exist', heading)
      check(`[${tag}] tata: no sign-in form`, await formFields(page) === 0)
      check(`[${tag}] tata: a way back to unifiedtree.com`, await page.locator('a[href="https://www.unifiedtree.com"]').count() === 1)
      check(`[${tag}] tata: tab title says so`, (await page.title()) === 'This workspace doesn’t exist', await page.title())
      check(`[${tag}] tata: no page errors`, errors.length === 0, errors.join(' | '))
      await page.screenshot({ path: `${shots}/w70-subdomain-unknown-${tag}.png`, fullPage: true })
      await ctx.close()
    }
    // UnifiedTree's own addresses (also on a deep link, not just /login).
    for (const [sub, path] of [['admin', '/login'], ['marketing', '/'], ['app', '/dashboard']]) {
      const { ctx, page, errors } = await open(hostUrl(sub) + path, { width: w, height: h })
      await page.getByRole('heading', { name: 'There’s no business here' }).waitFor({ timeout: 60_000 }).catch(() => {})
      const heading = await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')
      check(`[${tag}] ${sub}${path}: the reserved page`, heading === 'There’s no business here', heading)
      check(`[${tag}] ${sub}${path}: no sign-in form`, await formFields(page) === 0)
      check(`[${tag}] ${sub}${path}: stays on its address (no redirect)`, new URL(page.url()).hostname === `${sub}.localhost`, page.url())
      check(`[${tag}] ${sub}${path}: no page errors`, errors.length === 0, errors.join(' | '))
      if (sub !== 'app') await page.screenshot({ path: `${shots}/w70-subdomain-reserved-${sub}-${tag}.png`, fullPage: true })
      await ctx.close()
    }
  }

  // ── a business's sign-in still works ──────────────────────────────────────
  {
    const { ctx, page, errors } = await open(base + '/login', { width: 1440, height: 1000 })
    await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
    await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    const ok = await page.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => true, () => false)
    check('demo: the owner signs in', ok, page.url())
    const splash = page.getByText('Welcome back').first()
    await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
    await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    // A reload with the session: the app comes back (the address check runs before the session).
    await page.reload()
    const back = await page.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => true, () => false)
    await page.waitForTimeout(2500)
    check('demo: after a reload the owner is still signed in', back && !page.url().includes('/login'), page.url())
    const text = await page.locator('body').innerText()
    check('demo: signed-in page is not a host page', !/doesn’t exist|no business here|isn’t available/i.test(text))
    check('demo: no page errors after sign-in', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── a suspended business: no sign-in (status set for the check and put back) ─
  {
    const before = sql(`SELECT status FROM platform.tenants WHERE subdomain = 'demo'`)
    sql(`UPDATE platform.tenants SET status = 'SUSPENDED' WHERE subdomain = 'demo'`)
    try {
      const { ctx, page, errors } = await open(base + '/login', { width: 1440, height: 1000 })
      await page.getByRole('heading', { name: 'This workspace isn’t available' }).waitFor({ timeout: 60_000 }).catch(() => {})
      const heading = await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')
      check('suspended demo: "This workspace isn\'t available"', heading === 'This workspace isn’t available', heading)
      check('suspended demo: no sign-in form', await formFields(page) === 0)
      check('suspended demo: its own name, no vendor link', (await page.locator('body').innerText()).includes('UnifiedTree Demo') && await page.locator('a[href*="unifiedtree.com"]').count() === 0)
      check('suspended demo: no page errors', errors.length === 0, errors.join(' | '))
      await page.screenshot({ path: `${shots}/w70-subdomain-suspended-desk.png`, fullPage: true })
      await ctx.close()
    } finally {
      sql(`UPDATE platform.tenants SET status = '${before}' WHERE subdomain = 'demo'`)
    }
    check('demo status put back', sql(`SELECT status FROM platform.tenants WHERE subdomain = 'demo'`) === before)
  }
} catch (e) {
  check('test ran to the end', false, String(e).split('\n')[0])
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
