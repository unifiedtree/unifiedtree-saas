/* global process, console, fetch, setTimeout, Buffer, URL, document */
// Live: "Reset Password" end to end on a workspace's own pages, the case the
// demo-hrms tester hit on 5 Oct 2026 (new password refused after a reset that
// said it worked). Runs through the live slot:
//   live-slot.sh <wt> <port> node e2e/recovery/live-password-reset.mjs
// The reset email is caught by a tiny SMTP sink on 127.0.0.1:11025 (the slot's
// mail port); if a mail catcher already owns that port, its HTTP API on 18025 is read.
// Uses reader@unifiedtree.demo and puts its password (Hrms@12345) and two-factor
// (off) back in `finally`. The two-workspace case writes a throwaway workspace
// straight into the slot database, so it runs only against ut_w3_dev; set
// RESET_TEST_DB to the database the backend uses (row checks are read-only).
import { chromium } from '@playwright/test'
import net from 'node:net'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

const UI = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const API = (process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080') + '/api'
const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMAIL = 'reader@unifiedtree.demo'
const DEMO_PW = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const DB = process.env.RESET_TEST_DB || 'ut_w3_dev'
const PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const OTHER = 'b17b17b1-7b17-4b17-8b17-b17b17b17b17'
const shotDir = existsSync('C:/REACT/ut-wt/_results') ? 'C:/REACT/ut-wt/_results/shots' : 'test-results/recovery'
mkdirSync(shotDir, { recursive: true })

let failed = 0
const pass = (name) => console.log(`PASS  ${name}`)
const fail = (name, why) => { failed++; console.log(`FAIL  ${name}${why ? ` — ${why}` : ''}`) }
const check = (ok, name, why) => (ok ? pass(name) : fail(name, why))

// ---- mail -----------------------------------------------------------------------
const mails = []
let sink = null
async function startSink() {
  const srv = net.createServer((sock) => {
    let buf = '', inData = false
    sock.write('220 sink\r\n')
    sock.on('data', (c) => {
      buf += c.toString('latin1')
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n'); if (end < 0) return
          mails.push(buf.slice(0, end)); buf = buf.slice(end + 5); inData = false; sock.write('250 OK\r\n'); continue
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return
        const cmd = buf.slice(0, 4).toUpperCase(); buf = buf.slice(i + 2)
        if (cmd === 'EHLO') sock.write('250-sink\r\n250 OK\r\n')
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n') }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
        else sock.write('250 OK\r\n')
      }
    })
    sock.on('error', () => {})
  })
  return new Promise((resolve) => {
    srv.once('error', () => resolve(null))
    srv.listen(11025, '127.0.0.1', () => resolve(srv))
  })
}
async function allMail() {
  if (sink) return mails
  try {
    const list = await (await fetch('http://127.0.0.1:18025/messages')).json()
    return Promise.all(list.filter((m) => JSON.stringify(m.to).includes(EMAIL))
      .map(async (m) => (await fetch(`http://127.0.0.1:18025/messages/${m.id}`)).text()))
  } catch { return [] }
}
const decode = (raw) => raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
async function nextResetLink(before) {
  for (let i = 0; i < 60; i++) {
    const box = await allMail()
    if (box.length > before) {
      const m = decode(box[box.length - 1]).match(/https?:\/\/([^\s"'<>/]+)\/reset-password\?token=([A-Za-z0-9_-]+)/)
      if (m) return { host: m[1], token: m[2] }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

// ---- API helpers ------------------------------------------------------------------
async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text(); let data; try { data = t ? JSON.parse(t) : null } catch { data = t }
  return { status: r.status, data }
}
const login = (password) => call('/v1/canonical-auth/login', { method: 'POST', body: { tenantId: TENANT, email: EMAIL, password, mfaCapable: true } })
async function apiReset(password, headers = { 'X-Tenant-Subdomain': 'demo' }) {
  const before = (await allMail()).length
  await call('/v1/auth/forgot-password', { method: 'POST', headers, body: { email: EMAIL } })
  const link = await nextResetLink(before)
  if (!link) return { status: 0 }
  return call('/v1/auth/reset-password', { method: 'POST', body: { token: link.token, password } })
}
function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0')
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out)
}
function totp(secret, step) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac('sha1', b32(secret)).update(b).digest(); const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}
let lastStep = 0
async function code(secret) { // each code once (the server refuses a reused step)
  for (;;) { const s = Math.floor(Date.now() / 30000); if (s > lastStep) { lastStep = s; return totp(secret, s) } await new Promise((r) => setTimeout(r, 1000)) }
}
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()

// ---- the browser flow ---------------------------------------------------------------
const browser = await chromium.launch({ headless: true })
const errors = [], apiFailures = []
async function newPage(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) apiFailures.push(`${r.status()} ${new URL(r.url()).pathname} (on ${new URL(page.url()).pathname})`) })
  return page
}
/** Forgot -> email -> link -> new password, all on the workspace's own pages. Returns the page on "Password updated". */
async function uiReset(newPassword, shot) {
  const page = await newPage()
  await page.goto(UI + '/login')
  await page.getByRole('link', { name: 'Reset Password' }).click()
  await page.waitForURL(/\/forgot-password/)
  const before = (await allMail()).length
  await page.locator('input[type=email]').fill(EMAIL)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await page.getByText('Check your inbox').waitFor({ timeout: 15000 })
  const link = await nextResetLink(before)
  if (!link) throw new Error('no reset email arrived')
  // The email names the workspace's public host; open the same path on this app.
  await page.goto(`${UI}/reset-password?token=${link.token}`)
  await page.locator('input[placeholder="Minimum 8 characters"]').fill(newPassword)
  await page.locator('input[placeholder="Re-enter password"]').fill(newPassword)
  if (shot) await page.screenshot({ path: `${shotDir}/w17-pwreset-${shot}-form.png` })
  await page.getByRole('button', { name: 'Update password' }).click()
  await page.getByText(/Password updated|could not|invalid|expired/i).first().waitFor({ timeout: 15000 })
  return { page, link }
}
async function uiSignIn(page, password) {
  await page.getByRole('link', { name: /Go to login/ }).click()
  await page.waitForURL(/\/login/)
  await page.locator('input[type=email]').fill(EMAIL)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

let secret = null, other = false
const sink0 = await startSink(); sink = sink0
try {
  check((await login(DEMO_PW)).status === 200, 'start: reader signs in with the demo password')

  // 1 — plain reset, through the pages a person uses
  const pw1 = 'Reset@' + crypto.randomBytes(3).toString('hex')
  const r1 = await uiReset(pw1, 'plain')
  check(await r1.page.getByText('Password updated!').isVisible(), 'reset page says the password was updated')
  check(r1.link.host.startsWith('demo.'), 'the email link is for this workspace', r1.link.host)
  const row1 = sql(`select (password_updated_at > now() - interval '2 minutes')::text from auth.user_credentials where tenant_id='${TENANT}' and lower(email)=lower('${EMAIL}')`)
  check(row1 === 'true', 'the reset is stamped on this workspace\'s sign-in row', row1)
  await uiSignIn(r1.page, pw1)
  await r1.page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 })
    .then(() => pass('signs in with the NEW password on the login page'), () => fail('signs in with the NEW password on the login page'))
  const old1 = await login(DEMO_PW)
  check(old1.status === 422 && old1.data?.errorCode === 'INVALID_CREDENTIALS', 'the OLD password is refused', `${old1.status}`)
  const reuse = await call('/v1/auth/reset-password', { method: 'POST', body: { token: r1.link.token, password: 'Another@123' } })
  check(reuse.status === 422 && reuse.data?.errorCode === 'RESET_INVALID', 'the same link cannot be used twice', `${reuse.status}`)
  await r1.page.context().close()

  // 2 — two-factor on (as the tester had), then reset: new password -> code step
  const s = await login(pw1)
  const auth = { Authorization: `Bearer ${s.data.accessToken}`, 'X-Tenant-Subdomain': 'demo' }
  const setup = await call('/v1/me/security/totp/setup', { method: 'POST', headers: auth, body: {} })
  secret = setup.data?.secret
  const on = await call('/v1/me/security/totp/confirm', { method: 'POST', headers: auth, body: { code: await code(secret) } })
  check(on.status === 200, 'two-factor turned on for the account', `${on.status}`)
  const pw2 = 'Reset@' + crypto.randomBytes(3).toString('hex')
  const r2 = await uiReset(pw2, 'mfa')
  check(await r2.page.getByText('Password updated!').isVisible(), 'two-factor account: reset page says updated')
  await uiSignIn(r2.page, pw2)
  await r2.page.getByText('Two-factor sign-in', { exact: true }).waitFor({ timeout: 15000 })
    .then(() => pass('two-factor account: the new password is accepted and the code step shows'), () => fail('two-factor account: the new password is accepted and the code step shows'))
  await r2.page.screenshot({ path: `${shotDir}/w17-pwreset-mfa-step.png` })
  await r2.page.locator('#mfa-code').fill(await code(secret))
  await r2.page.getByRole('button', { name: 'Verify' }).click()
  await r2.page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 })
    .then(() => pass('two-factor account: signed in with the code'), () => fail('two-factor account: signed in with the code'))
  await r2.page.context().close()

  // 3 — the same address in a second workspace that it signed in to more recently
  if (DB === 'ut_w3_dev') {
    sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${OTHER}', 'w17other', 'W17 Other', 'ACTIVE', 'STARTER') on conflict do nothing`)
    sql(`insert into auth.user_credentials (id, tenant_id, email, password_hash, is_active, last_login_at, version, created_at, updated_at) select gen_random_uuid(), '${OTHER}', email, password_hash, true, now() + interval '1 hour', 0, now(), now() from auth.user_credentials where tenant_id='${TENANT}' and lower(email)=lower('${EMAIL}')`)
    other = true
    const pw3 = 'Reset@' + crypto.randomBytes(3).toString('hex')
    const r3 = await uiReset(pw3, null)
    check(r3.link.host.startsWith('demo.'), 'two workspaces: the link from this workspace\'s page is for this workspace', r3.link.host)
    const otherRow = sql(`select coalesce(password_updated_at::text, 'untouched') from auth.user_credentials where tenant_id='${OTHER}'`)
    check(otherRow === 'untouched', 'two workspaces: the other workspace\'s password is not changed', otherRow)
    const n3 = await login(pw3)
    check(n3.status === 200 && n3.data?.mfaRequired === true, 'two workspaces: this workspace accepts the new password', `${n3.status} ${n3.data?.errorCode || ''}`)
    await r3.page.context().close()
  } else {
    console.log(`SKIP  two workspaces (writes a throwaway workspace; only against ut_w3_dev, not ${DB})`)
  }

  // 4 — Microsoft Edge: one "show password" eye (ours), not Edge's as well
  let edge = null
  try { edge = await chromium.launch({ channel: 'msedge', headless: true }) } catch { edge = null }
  if (edge) {
    for (const width of [1440, 390]) {
      const ctx = await edge.newContext({ viewport: { width, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(UI + '/login')
      const box = page.locator('input[type=password]')
      await box.click()
      await box.pressSequentially('Secret@123') // Edge shows its eye only for typed input
      const rule = await page.evaluate(() => [...document.styleSheets]
        .flatMap((sh) => { try { return [...sh.cssRules] } catch { return [] } })
        .some((r) => r.selectorText?.includes('::-ms-reveal') && r.style.display === 'none'))
      if (width === 1440) check(rule, 'Edge: its own reveal button is hidden where ours is shown')
      await page.screenshot({ path: `${shotDir}/w17-pwreset-edge-login-${width}.png` })
      if (width === 1440) {
        // Control: the reset page's Confirm box has no toggle of ours, so Edge's eye stays there.
        await page.goto(UI + '/reset-password?token=preview-only')
        await page.locator('input[placeholder="Re-enter password"]').click()
        await page.keyboard.type('Secret@123')
        await page.screenshot({ path: `${shotDir}/w17-pwreset-edge-reset-confirm.png` })
        await page.locator('input[placeholder="Minimum 8 characters"]').click()
        await page.keyboard.type('Secret@123')
        await page.screenshot({ path: `${shotDir}/w17-pwreset-edge-reset-new.png` })
      }
      await ctx.close()
    }
    await edge.close()
  } else {
    console.log('SKIP  Edge check (Microsoft Edge is not available to Playwright)')
  }

  check(errors.length === 0, 'no page errors', errors.join(' | '))
  // Not part of this flow: a signed-out full page load (here /reset-password,
  // the second load in the tab) checks /me and gets 401 while the page boots,
  // before anything is submitted.
  const unexpected = apiFailures.filter((f) => !/\/canonical-auth\/refresh/.test(f) && !/^401 \/api\/v1\/canonical-auth\/me /.test(f))
  check(unexpected.length === 0, 'no failed API calls on the pages', unexpected.join(', '))
} catch (e) {
  fail('run', e.message)
} finally {
  // Put everything back: throwaway workspace gone, demo password, two-factor off.
  try {
    if (other) sql(`delete from auth.invitation_tokens where tenant_id='${OTHER}'; delete from auth.refresh_tokens where tenant_id='${OTHER}'; delete from auth.user_credentials where tenant_id='${OTHER}'; delete from platform.tenants where id='${OTHER}'`)
    const back = await apiReset(DEMO_PW)
    check(back.status === 200, 'cleanup: demo password restored', `${back.status}`)
    if (secret) {
      const ch = await login(DEMO_PW)
      const mf = await call('/v1/canonical-auth/login/mfa', { method: 'POST', body: { mfaToken: ch.data?.mfaToken, code: await code(secret) } })
      const off = await call('/v1/me/security/totp/disable', { method: 'POST', headers: { Authorization: `Bearer ${mf.data?.accessToken}`, 'X-Tenant-Subdomain': 'demo' }, body: { code: await code(secret) } })
      check(off.status === 200, 'cleanup: two-factor turned off', `${off.status}`)
    }
    const fin = await login(DEMO_PW)
    check(fin.status === 200 && !!fin.data?.accessToken, 'cleanup: reader signs in with the demo password, no code asked')
  } catch (e) { fail('cleanup', e.message) }
  await browser.close()
  if (sink0) sink0.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
