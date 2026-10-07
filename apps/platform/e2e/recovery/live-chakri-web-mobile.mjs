// Live check for chakri/web-mobile-sign-in + chakri/sign-in-buttons-on: "Continue with mobile" (SMS code).
//
//   VITE_WEBSITE_URL=http://localhost:3106 live-slot.sh /c/REACT/ut-wt/chakri-web-mobile 3105 node e2e/recovery/live-chakri-web-mobile.mjs
//
// Starts the WEBSITE's vite on :3106 proxying to the slot backend (:8080, never production), then:
//  - the business login page's "Continue with mobile" opens the website step for that business;
//  - a number that isn't a login there is refused before any SMS (Firebase never called);
//  - Firebase's TEST number (+91 90000 00001 / 123456: no SMS, no charge) gets a code; a wrong code is refused;
//  - the right code gives a real Firebase ID token for that number, sent to /v1/auth/firebase-verify with the
//    business; the page hands the session to demo.localhost and the person is signed in;
// The slot backend runs with Firebase off (--unifiedtree.firebase.enabled=false), which removes BOTH
// /v1/auth/phone/check and /v1/auth/firebase-verify. The test answers them itself: phone/check from the
// database with PhoneLookupService's rule (last 10 digits of an employee's phone in that business, with an
// active login), firebase-verify with a real session for that login after checking what the page sent.
// Firebase itself (code sent, wrong code refused, ID token for the number) is real.
//  - an incomplete or odd link shows "isn't complete" and nothing else.
/* global process, console, fetch, Buffer, setTimeout */
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const site = process.env.VITE_WEBSITE_URL || 'http://localhost:3106'
const sitePort = new URL(site).port
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TEST_MOBILE = '9000000001', TEST_CODE = '123456'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

// The owner's employee record carries Firebase's test number for the run.
const ownerEmp = sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='owner@unifiedtree.demo'`)
const oldPhone = sql(`select coalesce(phone, '') from hrms.employees where id='${ownerEmp}'`)
const clash = sql(`select count(*) from hrms.employees where tenant_id='${tenant}' and id <> '${ownerEmp}' and right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = '${TEST_MOBILE}'`)
sql(`update hrms.employees set phone='${TEST_MOBILE}' where id='${ownerEmp}'`)

// The website's dev server, proxying /api to the slot backend.
const vite = spawn('npx', ['vite', '--port', sitePort, '--strictPort'], { cwd: '../website', shell: true, env: { ...process.env, VITE_PROXY_TARGET: 'http://127.0.0.1:8080' }, stdio: 'ignore' })
const stopVite = () => { try { execFileSync('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ } }
for (let i = 0; i < 60; i++) {
  if (await fetch(site + '/').then((r) => r.ok).catch(() => false)) break
  await new Promise((r) => setTimeout(r, 1000))
}

const payload = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) } catch { return {} } }
let browser
try {
  check('setup: the test number belongs only to the owner here', clash === '0', `others with it: ${clash}`)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const firebaseCalls = []
  page.on('request', (r) => { if (r.url().includes('identitytoolkit.googleapis.com')) firebaseCalls.push(r.url()) })
  const checked = []
  await page.route('**/v1/auth/phone/check', async (route) => {
    const req = route.request()
    const last10 = String(req.postDataJSON()?.mobile || '').replace(/\D/g, '').slice(-10)
    const business = req.headers()['x-tenant-subdomain']
    checked.push({ business, last10 })
    const n = /^\d{10}$/.test(last10) && business === 'demo' ? sql(`select count(*) from hrms.employees e join auth.user_credentials c on c.employee_id = e.id and c.tenant_id = e.tenant_id and c.is_active
      where e.tenant_id='${tenant}' and right(regexp_replace(coalesce(e.phone,''), '\\D', '', 'g'), 10) = '${last10}'`) : '0'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registered: n !== '0' }) })
  })

  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  check('business login page shows "Continue with mobile" and "Continue with Google"',
    await page.getByRole('button', { name: 'Continue with mobile' }).isVisible() && await page.getByRole('button', { name: 'Continue with Google' }).isVisible())
  await page.getByRole('button', { name: 'Continue with mobile' }).click()
  await page.waitForURL((u) => u.pathname === '/mobile-sign-in', { timeout: 30000 }).catch(() => {})
  const opened = new URL(page.url())
  check('it opens the website step for this business', opened.origin === site && opened.searchParams.get('business') === 'demo' && opened.searchParams.get('port') === new URL(base).port, page.url())
  await page.getByRole('heading', { name: 'Sign in with your mobile' }).waitFor({ timeout: 30000 })
  const demoName = (await fetch(`${api}/v1/public/workspace-branding?subdomain=demo`).then((r) => r.json())).workspaceName || '(none)'
  // The name / logo arrive with the public branding lookup, a moment after the heading.
  await page.locator('main').getByText(demoName).or(page.locator('main img')).first().waitFor({ timeout: 15000 }).catch(() => {})
  check('the step shows the business, not the site', (await page.locator('main').innerText()).includes(demoName) || await page.locator('main img').count() > 0,
    `navbar links: ${await page.locator('nav a').count()}`)
  await page.screenshot({ path: `${shots}/chakri-web-mobile-1440.png` })

  // Firebase's test numbers need the reCAPTCHA skipped (dev only, ?testing=1).
  await page.goto(page.url() + '&testing=1', { waitUntil: 'domcontentloaded' })
  const mobile = page.getByLabel('Mobile number')
  await mobile.fill('98765 00000')
  await page.getByRole('button', { name: 'Send code' }).click()
  const alert = page.getByRole('alert')
  await alert.waitFor({ timeout: 20000 }).catch(() => {})
  check('a number that isn\'t a login here is refused before any SMS', (await alert.innerText().catch(() => '')).includes('isn’t on any login') && firebaseCalls.length === 0,
    `firebase calls: ${firebaseCalls.length}; checked ${JSON.stringify(checked)}`)

  await mobile.fill('+91 90000 00001')
  await page.getByRole('button', { name: 'Send code' }).click()
  const codeBox = page.getByLabel('One-time code')
  await codeBox.waitFor({ timeout: 45000 }).catch(() => {})
  check('Firebase sends a code to the registered number', await codeBox.isVisible().catch(() => false),
    (await alert.innerText().catch(() => '')) || `firebase calls: ${firebaseCalls.length}`)

  await codeBox.fill('111111')
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.getByText('That code isn’t right').waitFor({ timeout: 30000 }).catch(() => {})
  check('a wrong code is refused', await page.getByText('That code isn’t right').isVisible().catch(() => false), await alert.innerText().catch(() => ''))

  // The slot backend runs with Firebase off: the test answers firebase-verify with a real session for the
  // owner, after checking what the page sent.
  const session = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) }).then((r) => r.json())
  let sentToVerify = null
  await page.route('**/v1/auth/firebase-verify', async (route) => {
    const req = route.request()
    sentToVerify = { business: req.headers()['x-tenant-subdomain'], idToken: req.postDataJSON()?.idToken || '' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
  })
  await codeBox.fill(TEST_CODE)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL((u) => u.hostname === 'demo.localhost', { timeout: 45000 }).catch(() => {})
  const claims = payload(sentToVerify?.idToken || '')
  check('the right code gives a real Firebase token for that number, sent with the business',
    sentToVerify?.business === 'demo' && claims.phone_number === `+91${TEST_MOBILE}` && claims.aud === 'unifiedtree-445cd',
    `business=${sentToVerify?.business} phone=${claims.phone_number} aud=${claims.aud}`)
  await page.waitForURL((u) => u.hostname === 'demo.localhost' && !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 60000 }).catch(() => {})
  const landed = new URL(page.url())
  check('handed back to the business and signed in (no token left in the address)',
    landed.hostname === 'demo.localhost' && !landed.pathname.startsWith('/login') && !landed.searchParams.has('token'), page.url())
  await page.screenshot({ path: `${shots}/chakri-web-mobile-landed.png` })
  await page.close()

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.goto(`${site}/mobile-sign-in?business=demo&port=${new URL(base).port}`, { waitUntil: 'domcontentloaded' })
  await phone.getByRole('heading', { name: 'Sign in with your mobile' }).waitFor({ timeout: 30000 })
  const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('phone (390): the step fits the screen', fits)
  await phone.screenshot({ path: `${shots}/chakri-web-mobile-390.png` })

  for (const q of ['', '?business=Evil.com%2Fx', '?business=nosuch-business-xyz']) {
    await phone.goto(`${site}/mobile-sign-in${q}`, { waitUntil: 'domcontentloaded' })
    const incomplete = phone.getByRole('heading', { name: 'This sign-in link isn’t complete' })
    await incomplete.waitFor({ timeout: 20000 }).catch(() => {})
    check(`link "${q || '(no business)'}" shows only "isn't complete"`, await incomplete.isVisible().catch(() => false) && await phone.getByLabel('Mobile number').count() === 0)
  }
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  stopVite()
  sql(`update hrms.employees set phone=${oldPhone ? `'${oldPhone}'` : 'null'} where id='${ownerEmp}'`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
