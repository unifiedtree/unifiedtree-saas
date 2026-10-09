/* global process, console, fetch, setTimeout */
// Live (API only): two backend gaps from the 9 Oct tester triage. Runs through the live slot:
//   live-slot.sh /c/REACT/ut-wt/b8-testerfix-be <port> node e2e/recovery/live-b8-testerfix-be.mjs
//
// 1. web-signin-09: resetting a password through the emailed link signs that login out of
//    every existing session in its workspace (old refresh tokens and access tokens stop
//    working), the new password works, and a login in ANOTHER workspace with the same email
//    keeps its session.
// 2. web-onb-05: the employee baseline comes from the built-in EMPLOYEE role only. A
//    workspace's own role coded EMPLOYEE (made straight in the database; the app refuses that
//    code) must not hand its grants to employees.
//
// Uses reader@unifiedtree.demo and puts its password (Hrms@12345) back in `finally`. The
// second-workspace and rogue-role cases write straight into the slot database, so they run
// only against ut_w3_dev (set RESET_TEST_DB to the database the backend uses); everything
// they add is removed in `finally`.
// The reset email is caught by a tiny SMTP sink on 127.0.0.1:11025 (the slot's mail port);
// if a mail catcher already owns that port, its HTTP API on 18025 is read.
import net from 'node:net'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const API = (process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080') + '/api'
const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMAIL = 'reader@unifiedtree.demo'
const DEMO_PW = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const DB = process.env.RESET_TEST_DB || 'ut_w3_dev'
const PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const OTHER = 'b8b8b8b8-0909-4b80-8b80-b8b8b8b8b8b8'
const ROGUE_ROLE = 'b8b8b8b8-0909-4b80-8b80-0000000000e1'
const ROGUE_PERM = 'hrms.onboarding.instance.write'
const DEV_DB = DB === 'ut_w3_dev'

let failed = 0
const pass = (name) => console.log(`PASS  ${name}`)
const fail = (name, why) => { failed++; console.log(`FAIL  ${name}${why ? ` — ${why}` : ''}`) }
const check = (ok, name, why) => (ok ? pass(name) : fail(name, why))
const apiFailures = []

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
async function call(path, { method = 'GET', body, headers = {}, expectFail = false } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text(); let data; try { data = t ? JSON.parse(t) : null } catch { data = t }
  if (r.status >= 400 && !expectFail) apiFailures.push(`${r.status} ${method} ${path}`)
  return { status: r.status, data }
}
const login = (password, tenantId = TENANT, expectFail = false) =>
  call('/v1/canonical-auth/login', { method: 'POST', body: { tenantId, email: EMAIL, password, mfaCapable: true }, expectFail })
const me = (access, expectFail = false) =>
  call('/v1/canonical-auth/me', { headers: { Authorization: `Bearer ${access}`, 'X-Tenant-Subdomain': 'demo' }, expectFail })
const refresh = (token, subdomain = 'demo', expectFail = false) =>
  call('/v1/canonical-auth/refresh', { method: 'POST', headers: subdomain ? { 'X-Tenant-Subdomain': subdomain } : {}, body: { refreshToken: token }, expectFail })
/** Forgot -> email -> link -> new password, as the reset page does it. */
async function linkReset(password) {
  const before = (await allMail()).length
  await call('/v1/auth/forgot-password', { method: 'POST', headers: { 'X-Tenant-Subdomain': 'demo' }, body: { email: EMAIL } })
  const link = await nextResetLink(before)
  if (!link) return { status: 0, data: 'no reset email arrived' }
  return call('/v1/auth/reset-password', { method: 'POST', body: { token: link.token, password } })
}
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const liveTokens = (tenant) => Number(sql(`select count(*) from auth.refresh_tokens rt join auth.user_credentials uc on uc.id = rt.user_id where rt.tenant_id='${tenant}' and lower(uc.email)=lower('${EMAIL}')`))

let other = false, rogue = false, changed = false
const sink0 = await startSink(); sink = sink0
try {
  // ---- 2. the employee baseline ignores a workspace's own role coded EMPLOYEE -------------
  if (DEV_DB) {
    // Added before this run's first sign-in, so the baseline is loaded with it present.
    sql(`insert into rbac.roles (id, tenant_id, code, display_name, is_system) values ('${ROGUE_ROLE}', '${TENANT}', 'EMPLOYEE', 'B8 rogue employee role', false)`)
    sql(`insert into rbac.role_permissions (role_id, permission_code) values ('${ROGUE_ROLE}', '${ROGUE_PERM}')`)
    rogue = true
  }
  const a = await login(DEMO_PW)
  check(a.status === 200 && !!a.data?.refreshToken, 'start: reader signs in with the demo password (session A)', `${a.status}`)
  const perms = a.data?.permissions || []
  check(perms.includes('payroll.payslip.read.self') && perms.includes('leave.request.self'),
    'baseline: reader still gets the built-in Employee self-service permissions', perms.length + ' permissions')
  if (DEV_DB) {
    check(!perms.includes(ROGUE_PERM), `baseline: a workspace role coded EMPLOYEE does not add ${ROGUE_PERM}`)
    const meA = await me(a.data.accessToken)
    check(meA.status === 200 && !(meA.data?.permissions || []).includes(ROGUE_PERM), 'baseline: /me agrees')
    sql(`delete from rbac.roles where id='${ROGUE_ROLE}'`)
    rogue = false
  } else {
    console.log(`SKIP  rogue EMPLOYEE role (writes a role; only against ut_w3_dev, not ${DB})`)
  }

  // ---- 1. a reset through the link signs the old sessions out ------------------------------
  const b = await login(DEMO_PW)
  check(b.status === 200, 'second sign-in (session B)', `${b.status}`)
  // Session A refreshes before the reset: proves the refresh path works for this login.
  const a2 = await refresh(a.data.refreshToken)
  check(a2.status === 200 && !!a2.data?.refreshToken, 'before the reset: session A refreshes', `${a2.status}`)
  check((await me(a2.data?.accessToken)).status === 200, 'before the reset: session A is signed in')

  // The same email in another workspace, signed in there too.
  let o = null
  if (DEV_DB) {
    sql(`insert into platform.tenants (id, subdomain, display_name, status, plan_type) values ('${OTHER}', 'b8other', 'B8 Other', 'ACTIVE', 'STARTER') on conflict do nothing`)
    sql(`insert into auth.user_credentials (id, tenant_id, email, password_hash, is_active, version, created_at, updated_at) select gen_random_uuid(), '${OTHER}', email, password_hash, true, 0, now(), now() from auth.user_credentials where tenant_id='${TENANT}' and lower(email)=lower('${EMAIL}')`)
    other = true
    o = await login(DEMO_PW, OTHER, true)
    if (o.status !== 200) {
      // Fall back to a stored session row if that workspace refuses the sign-in for its own reasons.
      console.log(`NOTE  other workspace sign-in answered ${o.status} ${o.data?.errorCode || ''}; using a stored session row instead`)
      sql(`insert into auth.refresh_tokens (id, tenant_id, user_id, token_hash, issued_at, expires_at, session_id, session_started_at) select gen_random_uuid(), '${OTHER}', id, 'b8-other-' || gen_random_uuid(), now(), now() + interval '1 day', gen_random_uuid(), now() from auth.user_credentials where tenant_id='${OTHER}'`)
      o = null
    }
  }
  const otherBefore = DEV_DB ? liveTokens(OTHER) : 0
  const demoBefore = liveTokens(TENANT)
  check(demoBefore >= 2, 'before the reset: this workspace holds the sessions', `${demoBefore}`)

  const pw1 = 'Reset@' + crypto.randomBytes(3).toString('hex')
  const r = await linkReset(pw1)
  check(r.status === 200, 'the reset through the emailed link succeeds', `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`)
  changed = r.status === 200

  check(liveTokens(TENANT) === 0, 'after the reset: no session of this login is left in this workspace', `${liveTokens(TENANT)}`)
  const meOld = await me(a2.data?.accessToken, true)
  check(meOld.status === 401, 'after the reset: session A\'s access token stops working', `${meOld.status}`)
  const refA = await refresh(a2.data?.refreshToken, 'demo', true)
  check(refA.status >= 400 && refA.status < 500, 'after the reset: session A\'s refresh token is refused', `${refA.status} ${refA.data?.errorCode || ''}`)
  const refB = await refresh(b.data?.refreshToken, 'demo', true)
  check(refB.status >= 400 && refB.status < 500, 'after the reset: session B\'s refresh token is refused', `${refB.status} ${refB.data?.errorCode || ''}`)

  if (DEV_DB) {
    check(liveTokens(OTHER) === otherBefore && otherBefore > 0, 'other workspace: its session with the same email is kept', `${otherBefore} -> ${liveTokens(OTHER)}`)
    if (o) {
      const ro = await refresh(o.data.refreshToken, null)
      check(ro.status === 200 && ro.data?.tenantId === OTHER, 'other workspace: its refresh token still works', `${ro.status}`)
    }
  } else {
    console.log(`SKIP  other workspace (writes a throwaway workspace; only against ut_w3_dev, not ${DB})`)
  }

  const old = await login(DEMO_PW, TENANT, true)
  check(old.status === 422 && old.data?.errorCode === 'INVALID_CREDENTIALS', 'the OLD password is refused', `${old.status}`)
  const fresh = await login(pw1)
  check(fresh.status === 200 && !!fresh.data?.accessToken, 'the person who reset signs in fresh with the NEW password', `${fresh.status}`)
  check((await me(fresh.data?.accessToken)).status === 200, 'the fresh session works')
  const fr = await refresh(fresh.data?.refreshToken)
  check(fr.status === 200, 'the fresh session refreshes', `${fr.status}`)

  check(apiFailures.length === 0, 'no unexpected API failures', apiFailures.join(', '))
} catch (e) {
  fail('run', e.message)
} finally {
  // Put everything back: rogue role and throwaway workspace gone, demo password restored.
  try {
    if (rogue) sql(`delete from rbac.roles where id='${ROGUE_ROLE}'`)
    if (other) sql(`delete from auth.invitation_tokens where tenant_id='${OTHER}'; delete from auth.refresh_tokens where tenant_id='${OTHER}'; delete from auth.user_credentials where tenant_id='${OTHER}'; delete from platform.tenants where id='${OTHER}'`)
    if (changed) {
      const back = await linkReset(DEMO_PW)
      check(back.status === 200, 'cleanup: demo password restored', `${back.status}`)
    }
    const fin = await login(DEMO_PW)
    check(fin.status === 200 && !!fin.data?.accessToken, 'cleanup: reader signs in with the demo password')
    if (DEV_DB) {
      const left = sql(`select (select count(*) from rbac.roles where id='${ROGUE_ROLE}') + (select count(*) from platform.tenants where id='${OTHER}')`)
      check(left === '0', 'cleanup: nothing this test added is left', left)
    }
  } catch (e) { fail('cleanup', e.message) }
  if (sink0) sink0.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
