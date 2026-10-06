// Live check for chakri/signup-one-business: one business per account, the
// sign-up says "Business name", and the first HRMS company gets its own name.
//
//   live-slot.sh /c/REACT/ut-wt/chakri-signup-one-business 3091 node e2e/recovery/live-chakri-signup.mjs
//
// What it proves, against the local backend and database:
//  - API: an anonymous free sign-up with a business name AND a company name
//    creates the tenant under the business name and the first org.companies
//    row under the company name. The same person signing up again (right
//    password) gets 409 "already has a business"; POST /v1/accounts/workspaces
//    with their account session is refused the same way. A sign-up without a
//    company name still works (the company takes the business name).
//  - Website (1440 and 390 wide, started here on WEBSITE_PORT with its /api
//    proxied to the LOCAL backend only): the form shows "Business Name" and a
//    separate "Company Name" that copies the business name until edited; after
//    signing in, /signup says "You already have a business" and /workspaces has
//    no "Create new workspace".
// The DB is recreated per slot; this test only reads SQL.
/* global process, console, fetch, window, PopStateEvent */
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const sitePort = Number(process.env.WEBSITE_PORT || 3092)
const site = `http://localhost:${sitePort}`
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

const tag = String(Date.now() % 1000000)
const email = `qa.onebiz.${tag}@example.test`
const password = 'Chakri@12345'
const business = `QA Group ${tag}`
const company = `QA Labs ${tag}`

async function post(p, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(api + p, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, json }
}
const signup = (sub, extra = {}) => post('/v1/public/free-signup', {
  companyName: business, subdomain: sub, adminName: 'Qa Tester', adminEmail: email,
  adminMobile: '+919000000000', password, country: 'India', timezone: 'Asia/Kolkata', currency: 'INR', ...extra,
})

// ---- API ----
const sub1 = `qa-onebiz-${tag}`
const r1 = await signup(sub1, { firstCompanyName: company })
check('free sign-up with a business and a company name answers 200', r1.status === 200, `status ${r1.status}`)
const tenantId = sql(`SELECT id FROM platform.tenants WHERE subdomain = ${lit(sub1)}`)
check('the business is created under the business name',
  tenantId && sql(`SELECT display_name FROM platform.tenants WHERE id = ${lit(tenantId)}`) === business)
check('the first HRMS company is created under the company name',
  tenantId && sql(`SELECT string_agg(name, '|') FROM org.companies WHERE tenant_id = ${lit(tenantId)}`) === company)

const r2 = await signup(`qa-onebiz2-${tag}`, { firstCompanyName: company })
check('the same person cannot sign up a second business (409)', r2.status === 409, `status ${r2.status} ${JSON.stringify(r2.json)?.slice(0, 160)}`)
check('the refusal says why, in plain words', JSON.stringify(r2.json || '').includes('already has a business'))
check('no second tenant was created', sql(`SELECT count(*) FROM platform.tenants WHERE subdomain = ${lit(`qa-onebiz2-${tag}`)}`) === '0')

const login = await post('/v1/accounts/auth/login', { email, password })
check('the new owner can sign in to their account', login.status === 200 && login.json?.accessToken, `status ${login.status}`)
const accountToken = login.json?.accessToken
const r3 = await post('/v1/accounts/workspaces', {
  companyName: 'Another', subdomain: `qa-onebiz3-${tag}`, requestedModules: ['hrms'],
}, accountToken)
check('POST /v1/accounts/workspaces is refused for an account that has a business (409)', r3.status === 409, `status ${r3.status}`)

const email2 = `qa.onebiz.b.${tag}@example.test`
const sub4 = `qa-onebizb-${tag}`
const r4 = await post('/v1/public/free-signup', {
  companyName: `QA Solo ${tag}`, subdomain: sub4, adminName: 'Qa Solo', adminEmail: email2,
  adminMobile: '+919000000001', password, country: 'India', timezone: 'Asia/Kolkata', currency: 'INR',
})
const t4 = sql(`SELECT id FROM platform.tenants WHERE subdomain = ${lit(sub4)}`)
check('without a company name the sign-up still works and the company takes the business name',
  r4.status === 200 && t4 && sql(`SELECT name FROM org.companies WHERE tenant_id = ${lit(t4)}`) === `QA Solo ${tag}`)

// ---- website (its /api goes to the LOCAL backend only) ----
const websiteDir = path.resolve(process.cwd(), '../website')
const target = api.replace(/\/api$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(target)) throw new Error(`refusing to start the website against ${target}`)
const vite = spawn(process.execPath, [path.join(websiteDir, 'node_modules/vite/bin/vite.js'), '--port', String(sitePort), '--strictPort'],
  { cwd: websiteDir, env: { ...process.env, VITE_PROXY_TARGET: target, VITE_API_BASE_URL: '' }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(site)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  browser = await chromium.launch()
  const errors = []
  for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${site}/signup?mode=trial`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    const biz = page.getByPlaceholder('Your business name')
    await biz.waitFor({ timeout: 90000 })
    const co = page.getByPlaceholder('Your first company (you can add more later)')
    check(`${label}: the form asks for "Business Name"`, await page.locator('label', { hasText: 'Business Name' }).first().isVisible())
    check(`${label}: the form has a separate "Company Name"`, await co.isVisible())
    await biz.fill('Sunrise Group')
    check(`${label}: the company name copies the business name`, (await co.inputValue()) === 'Sunrise Group')
    await co.fill('Sunrise Textiles')
    await biz.fill('Sunrise Holdings')
    check(`${label}: once edited, the company name keeps its own value`, (await co.inputValue()) === 'Sunrise Textiles')
    check(`${label}: no "no card required" promise on the form`, !(await page.getByText(/no card required/i).count()))
    await page.screenshot({ path: `${shots}/chakri-signup-form-${label}.png`, fullPage: true })
    await page.close()
  }

  // Signed in with a business: no second sign-up, no "Create new workspace".
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${site}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.locator('input[type="email"]').first().waitFor({ timeout: 60000 })
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('form button[type="submit"]').first().click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 }).catch(() => {})
  await page.getByText(business).first().waitFor({ timeout: 15000 }).catch(() => {})
  check('signed in: /workspaces lists the business', await page.getByText(business).first().isVisible())
  check('signed in: /workspaces has no "Create new workspace"', (await page.getByText(/create new workspace/i).count()) === 0)
  await page.screenshot({ path: `${shots}/chakri-signup-workspaces.png` })
  // Navigate inside the app: on localhost the refresh cookie (Secure, .unifiedtree.com) is not kept,
  // so a full reload would sign the visitor out; in production it restores the session.
  await page.evaluate(() => { window.history.pushState({}, '', '/signup?mode=trial'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.getByText('You already have a business').waitFor({ timeout: 10000 }).catch(() => {})
  check('signed in: /signup says "You already have a business"', await page.getByText('You already have a business').isVisible())
  check('signed in: it offers "Open your business"', await page.getByRole('link', { name: /open your business/i }).first().isVisible())
  await page.screenshot({ path: `${shots}/chakri-signup-already.png` })
  check('no page errors on the website', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  if (browser) await browser.close()
  vite.kill()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
