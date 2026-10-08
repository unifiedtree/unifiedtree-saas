// Platform operators can only sign in at the operator door (9 Oct 2026, finding F1 of
// PLATFORM_OPERATOR_CONTRACTS.md). API-only probe against a running backend:
//  - an operator's email + password at the business sign-in /v1/canonical-auth/login is
//    refused like an unknown email: with the platform tenant named, with no tenant, with the
//    platform address in X-Tenant-Subdomain, with another business named
//  - a platform-tenant refresh token (one minted before the fix) is refused, by body and by cookie
//  - a workspace-style platform-tenant access token (what that login minted: no token_type)
//    is refused on /v1/platform/admin/** and /v1/platform/tenant-requests/**
//  - forgot-password for an operator email creates no reset link (no tenant, platform tenant
//    named, platform address in X-Tenant-Subdomain)
//  - the operator door /v1/platform/auth/login still works and its token (token_type=platform)
//    opens /v1/platform/admin/me, a read and a manage endpoint
//  - the reverse: an operator token on business APIs never sees or changes a business's data
//  - business sign-in is unchanged: owner@ with and without the tenant, refresh, and the
//    owner's token is still refused on the platform API
//
// The operator is the one PlatformAdminBootstrap created when the backend was started with
// UNIFIEDTREE_PLATFORM_ADMIN_ENABLED/_EMAIL/_PASSWORD (read from the same env here). Without
// them the test makes a temporary one (as the bootstrap writer does) and removes it after.
// Everything the test creates is removed at the end.
//
//   UNIFIEDTREE_PLATFORM_ADMIN_ENABLED=true UNIFIEDTREE_PLATFORM_ADMIN_EMAIL=... UNIFIEDTREE_PLATFORM_ADMIN_PASSWORD=... \
//   live-slot.sh <worktree> <port> node e2e/recovery/live-w82-opsignin.mjs
/* global Buffer, console, fetch, process */
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DEMO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const DEMO_COMPANY = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const PLATFORM = '00000000-0000-0000-0000-000000000000'
const PLATFORM_ROLE = '00000000-0000-0000-0000-000000000006'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const DB = process.env.RECOVERY_DB || 'ut_w3_dev'
const PSQL = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'
const JWT_SECRET = process.env.UNIFIEDTREE_JWT_SECRET || ''
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const info = (name, detail) => console.log(`INFO  ${name}  — ${detail}`)

async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text }
}
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const short = (r) => `status=${r.status} ${typeof r.json === 'object' && r.json ? `code=${r.json.errorCode || r.json.error || ''} msg="${String(r.json.message || '').slice(0, 80)}"` : String(r.text || '').slice(0, 80)}`
/** An HS256 token signed like JwtService does (the slot's local secret only). */
function sign(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`
}

// ── The operator ──────────────────────────────────────────────────────────────
let opEmail = (process.env.UNIFIEDTREE_PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase()
let opPassword = process.env.UNIFIEDTREE_PLATFORM_ADMIN_PASSWORD || ''
let opId = opEmail ? sql(`select id from auth.user_credentials where tenant_id = '${PLATFORM}' and lower(email) = ${lit(opEmail)}`) : ''
let madeTenant = false, madeOperator = false
const created = { refreshHashes: [], resetBefore: 0, deptName: `qa-w82-probe-${Date.now()}` }
let opBefore = null

try {
  if (opId) {
    info('setup', `operator from PlatformAdminBootstrap: ${opEmail}`)
  } else {
    // The same rows PlatformAdminBootstrapWriter writes, with the demo owner's password hash.
    if (sql(`select count(*) from platform.tenants where id = '${PLATFORM}'`) === '0') {
      sql(`insert into platform.tenants (id, subdomain, display_name, contact_email, status, plan_type, region, created_at)
           values ('${PLATFORM}', 'unifiedtree', 'UnifiedTree Platform', 'ops@unifiedtree.com', 'ACTIVE', 'ENTERPRISE', 'in', now())`)
      madeTenant = true
    }
    opId = randomUUID(); opEmail = `qa-operator-${Date.now()}@unifiedtree.invalid`; opPassword = password
    const hash = sql(`select password_hash from auth.user_credentials where tenant_id = '${DEMO}' and email = 'owner@unifiedtree.demo'`)
    sql(`begin;
      insert into auth.user_credentials (id, tenant_id, email, password_hash, is_active, is_biometric_enabled, failed_login_count,
          created_at, updated_at, created_by, updated_by, version)
        values ('${opId}', '${PLATFORM}', ${lit(opEmail)}, ${lit(hash)}, true, false, 0, now(), now(), 'qa', 'qa', 0);
      insert into rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
        values ('${PLATFORM}', '${opId}', '${PLATFORM_ROLE}', now(), '${opId}');
      commit;`)
    madeOperator = true
    info('setup', `temporary operator ${opEmail} (no bootstrap env)`)
  }
  opBefore = sql(`select coalesce(last_login_at::text, 'null') || '|' || failed_login_count from auth.user_credentials where id = '${opId}'`)
  created.resetBefore = Number(sql(`select count(*) from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET'`))
  const tenantRow = sql(`select subdomain || '|' || status from platform.tenants where id = '${PLATFORM}'`)
  info('setup', `platform tenant row: ${tenantRow}`)
  const opPerms = sql(`select string_agg(permission_code, ',' order by permission_code) from rbac.role_permissions where role_id = '${PLATFORM_ROLE}'`).split(',').filter(Boolean)

  const nobody = randomUUID()   // no business has this id: reject can change nothing even when let through
  const REJECT_REASON = 'qa w82 probe: a business that does not exist'
  info('setup', `PLATFORM_SUPER_ADMIN holds ${opPerms.length} codes: ${opPerms.join(',')}`)
  const workspaceTokens = []   // any token the business door hands an operator (each is a finding)

  // ── 1. The operator door works and its token opens the console ─────────────
  const pl = await call('/v1/platform/auth/login', { method: 'POST', body: { email: opEmail, password: opPassword } })
  check('operator door: /v1/platform/auth/login 200 with a token', pl.status === 200 && !!pl.json?.accessToken, short(pl))
  const opToken = pl.json?.accessToken
  if (opToken) {
    const c = claims(opToken)
    check('operator door: token is the platform tenant, PLATFORM_SUPER_ADMIN, token_type=platform',
      c.tenant_id === PLATFORM && (c.roles || []).includes('PLATFORM_SUPER_ADMIN') && c.token_type === 'platform',
      `tenant_id=${c.tenant_id} roles=${c.roles} token_type=${c.token_type}`)
    check('operator door: no refresh token is handed out', !pl.json.refreshToken)
    const me = await call('/v1/platform/admin/me', { token: opToken })
    check('operator token: GET /v1/platform/admin/me 200', me.status === 200 && me.json?.email === opEmail, short(me))
    const ws = await call('/v1/platform/admin/workspaces', { token: opToken })
    check('operator token: GET /v1/platform/admin/workspaces 200 (a read)', ws.status === 200, short(ws))
    // A valid body, a business that does not exist: 404 = past the guard, nothing changed. (An empty
    // reason would be a 400 from body validation, which runs before @PreAuthorize, so it proves nothing.)
    const rej = await call(`/v1/platform/tenant-requests/${nobody}/reject`, { method: 'POST', token: opToken, body: { reason: REJECT_REASON } })
    check('operator token: POST reject (manage) is past the guard (404 for a business that does not exist)', rej.status === 404, short(rej))
  }

  // ── 2. The business door refuses the operator like an unknown email ───────
  const unknown = await call('/v1/canonical-auth/login', { method: 'POST', body: { email: `nobody-${Date.now()}@unifiedtree.invalid`, password: opPassword } })
  info('business door: unknown email', short(unknown))
  const sameAsUnknown = (r) => r.status === unknown.status && r.json?.errorCode === unknown.json?.errorCode && r.json?.message === unknown.json?.message
  const variants = [
    ['platform tenant named in the body', { tenantId: PLATFORM, email: opEmail, password: opPassword }, {}],
    ['no tenant (email routing)', { email: opEmail, password: opPassword }, {}],
    ['no tenant, platform address in X-Tenant-Subdomain, mfaCapable', { email: opEmail, password: opPassword, mfaCapable: true }, { 'X-Tenant-Subdomain': 'unifiedtree' }],
    ['the demo business named', { tenantId: DEMO, email: opEmail, password: opPassword }, {}],
  ]
  for (const [name, body, headers] of variants) {
    const r = await call('/v1/canonical-auth/login', { method: 'POST', body, headers })
    if (r.json?.accessToken) workspaceTokens.push([`login: ${name}`, r.json.accessToken, r.json.refreshToken])
    if (r.json?.mfaToken) info(`business door: ${name}`, 'answered with a two-factor challenge')
    check(`business door: operator refused, ${name} (same answer as an unknown email)`,
      !r.json?.accessToken && !r.json?.mfaToken && sameAsUnknown(r),
      `${short(r)}${r.json?.accessToken ? ` tenantId=${r.json.tenantId} roles=${r.json.roles} refreshToken=${r.json.refreshToken ? 'yes' : 'no'}` : ''}`)
  }
  // The legacy /v1/auth/login is not public in this profile.
  const legacy = await call('/v1/auth/login', { method: 'POST', body: { email: opEmail, password: opPassword }, headers: { 'X-Tenant-ID': PLATFORM } })
  check('legacy /v1/auth/login: no token for the operator', !legacy.json?.accessToken, short(legacy))

  // ── 3. A pre-fix platform session: refresh tokens and a workspace-style access token ──
  const session = randomUUID()
  const plainBody = randomBytes(48).toString('base64url'), plainCookie = randomBytes(48).toString('base64url')
  for (const p of [plainBody, plainCookie]) {
    created.refreshHashes.push(sha256(p))
    sql(`insert into auth.refresh_tokens (id, tenant_id, user_id, token_hash, issued_at, expires_at, session_id, session_started_at, last_used_at, user_agent)
         values ('${randomUUID()}', '${PLATFORM}', '${opId}', '${sha256(p)}', now(), now() + interval '7 days', '${session}', now(), now(), 'qa-w82')`)
  }
  if (JWT_SECRET) {
    const now = Math.floor(Date.now() / 1000)
    const forged = sign({ iss: 'unifiedtree', sub: opId, iat: now, exp: now + 3600, tenant_id: PLATFORM, email: opEmail,
      roles: ['PLATFORM_SUPER_ADMIN'], permissions: opPerms, sid: session })
    workspaceTokens.push(['a workspace-style platform token (as the business door minted it)', forged, null])
  } else {
    info('workspace-style token', 'skipped: UNIFIEDTREE_JWT_SECRET is not in the env')
  }
  const rb = await call('/v1/canonical-auth/refresh', { method: 'POST', body: { refreshToken: plainBody } })
  if (rb.json?.accessToken) workspaceTokens.push(['refresh (body)', rb.json.accessToken, rb.json.refreshToken])
  check('refresh: a platform-tenant refresh token in the body is refused', !rb.json?.accessToken && rb.status === 422, short(rb))
  const cookie = `ut_rt_${PLATFORM.replace(/-/g, '')}=${plainCookie}`
  const rc = await call('/v1/canonical-auth/refresh', { method: 'POST', headers: { Cookie: cookie, 'X-Tenant-Subdomain': 'unifiedtree' } })
  if (rc.json?.accessToken) workspaceTokens.push(['refresh (cookie + X-Tenant-Subdomain)', rc.json.accessToken, rc.json.refreshToken])
  check('refresh: the platform cookie with X-Tenant-Subdomain: unifiedtree is refused', !rc.json?.accessToken && rc.status === 422, short(rc))
  const rn = await call('/v1/canonical-auth/refresh', { method: 'POST', headers: { Cookie: cookie } })
  if (rn.json?.accessToken) workspaceTokens.push(['refresh (cookie, no tenant)', rn.json.accessToken, rn.json.refreshToken])
  // 204 = no session: without a tenant the controller cannot name the cookie's workspace.
  check('refresh: the platform cookie with no tenant is refused', !rn.json?.accessToken && (rn.status === 422 || rn.status === 204), short(rn))

  // ── 4. No workspace-style token gets into the operator console ─────────────
  for (const [name, token, refresh] of workspaceTokens) {
    if (refresh) created.refreshHashes.push(sha256(refresh))
    const c = claims(token)
    info(`token from ${name}`, `tenant_id=${c.tenant_id} roles=${c.roles} token_type=${c.token_type} sid=${c.sid ? 'yes' : 'no'} exp-in=${Math.round((c.exp - Date.now() / 1000) / 3600)}h`)
    const me = await call('/v1/platform/admin/me', { token })
    check(`console refuses ${name}: GET /v1/platform/admin/me`, me.status === 403 || me.status === 401, short(me))
    const ws = await call('/v1/platform/admin/workspaces', { token })
    check(`console refuses ${name}: GET /v1/platform/admin/workspaces`, ws.status === 403 || ws.status === 401, short(ws))
    const tr = await call('/v1/platform/tenant-requests', { token })
    check(`console refuses ${name}: GET /v1/platform/tenant-requests`, tr.status === 403 || tr.status === 401, short(tr))
    const rej = await call(`/v1/platform/tenant-requests/${nobody}/reject`, { method: 'POST', token, body: { reason: REJECT_REASON } })
    check(`console refuses ${name}: POST reject (manage)`, rej.status === 403 || rej.status === 401, short(rej))
  }

  // ── 5. Forgot password does not route an operator email ────────────────────
  for (const [name, body, headers] of [
    ['no tenant', { email: opEmail }, {}],
    ['platform tenant named', { email: opEmail, tenantId: PLATFORM }, {}],
    ['platform address in X-Tenant-Subdomain', { email: opEmail }, { 'X-Tenant-Subdomain': 'unifiedtree' }],
  ]) {
    const before = Number(sql(`select count(*) from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET'`))
    const r = await call('/v1/auth/forgot-password', { method: 'POST', body, headers })
    const after = Number(sql(`select count(*) from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET'`))
    check(`forgot-password (${name}): 200 and no reset link made for the operator`, r.status === 200 && after === before, `${short(r)} links ${before}->${after}`)
  }

  // ── 6. The reverse: an operator token on business APIs ─────────────────────
  if (opToken) {
    const steer = { 'X-Tenant-ID': DEMO, 'X-Company-Id': DEMO_COMPANY, 'X-Tenant-Subdomain': 'demo' }
    let leaked = []
    for (const p of ['/v1/canonical-auth/me', '/v1/hrms/companies', '/v1/hrms/branches', `/v1/hrms/departments?companyId=${DEMO_COMPANY}`,
      '/v1/hrms/employees', '/v1/rbac/roles', '/v1/workspace/users', '/v1/accounts/me', '/v1/accounts/workspaces']) {
      for (const [how, headers] of [['plain', {}], ['steered to demo', steer]]) {
        const r = await call(p, { token: opToken, headers })
        const demoData = r.status < 300 && /aaaaaaaa-aaaa|unifiedtree\.demo/i.test(r.text || '')
        if (demoData) leaked.push(`${p} (${how})`)
        info(`reverse: GET ${p.replace(/[0-9a-f-]{36}/g, '{id}')} ${how}`,
          r.status < 300 ? `status=${r.status} body=${String(r.text || '').replace(/\s+/g, ' ').slice(0, 140)}` : short(r))
      }
    }
    const post = await call('/v1/hrms/departments', { method: 'POST', token: opToken, headers: steer,
      body: { companyId: DEMO_COMPANY, name: created.deptName, code: 'QAW82' } })
    info('reverse: POST /v1/hrms/departments steered to demo', short(post))
    const madeDept = sql(`select coalesce(string_agg(tenant_id::text, ','), '') from hrms.departments where name = ${lit(created.deptName)}`)
    check('reverse: an operator token reads no business data', leaked.length === 0, leaked.join(', '))
    check('reverse: an operator token creates nothing in a business', !madeDept.includes(DEMO), `department rows in: ${madeDept || 'none'}`)
  }

  // ── 7. Business sign-in is unchanged ──────────────────────────────────────
  const own = await call('/v1/canonical-auth/login', { method: 'POST', body: { tenantId: DEMO, email: 'owner@unifiedtree.demo', password } })
  check('business: owner@ signs in with the tenant', own.status === 200 && !!own.json?.accessToken && !!own.json?.refreshToken, short(own))
  const own2 = await call('/v1/canonical-auth/login', { method: 'POST', body: { email: 'owner@unifiedtree.demo', password } })
  check('business: owner@ signs in by email alone, into demo', own2.status === 200 && own2.json?.tenantId === DEMO, short(own2))
  for (const r of [own, own2]) if (r.json?.refreshToken) created.refreshHashes.push(sha256(r.json.refreshToken))
  if (own.json?.refreshToken) {
    const rr = await call('/v1/canonical-auth/refresh', { method: 'POST', body: { refreshToken: own.json.refreshToken } })
    check('business: owner@ refresh works', rr.status === 200 && !!rr.json?.accessToken, short(rr))
    if (rr.json?.refreshToken) created.refreshHashes.push(sha256(rr.json.refreshToken))
    const cookieDemo = `ut_rt_${DEMO.replace(/-/g, '')}=${rr.json?.refreshToken}`
    const rr2 = await call('/v1/canonical-auth/refresh', { method: 'POST', headers: { Cookie: cookieDemo, 'X-Tenant-Subdomain': 'demo' } })
    check('business: owner@ cookie refresh on demo works', rr2.status === 200 && rr2.json?.tenantId === DEMO, short(rr2))
    if (rr2.json?.refreshToken) created.refreshHashes.push(sha256(rr2.json.refreshToken))
    const ownMe = await call('/v1/canonical-auth/me', { token: rr2.json?.accessToken || own.json.accessToken })
    check('business: owner@ /v1/canonical-auth/me 200', ownMe.status === 200 && ownMe.json?.tenantId === DEMO, short(ownMe))
    const ownConsole = await call('/v1/platform/admin/me', { token: own.json.accessToken })
    check('business: owner@ token still refused on /v1/platform/admin/me', ownConsole.status === 403, short(ownConsole))
  }
  for (const email of ['mgr@unifiedtree.demo', 'reader@unifiedtree.demo']) {
    const r = await call('/v1/canonical-auth/login', { method: 'POST', body: { email, password } })
    check(`business: ${email} signs in by email alone`, r.status === 200 && r.json?.tenantId === DEMO, short(r))
    if (r.json?.refreshToken) created.refreshHashes.push(sha256(r.json.refreshToken))
  }
} catch (e) {
  check('run finished without an exception', false, String(e?.stack || e).slice(0, 400))
} finally {
  try {
    const hashes = created.refreshHashes.map((h) => `'${h}'`).join(',')
    if (hashes) sql(`delete from auth.refresh_tokens where token_hash in (${hashes})`)
    if (opId) {
      sql(`begin;
        delete from auth.refresh_tokens where user_id = '${opId}' and tenant_id = '${PLATFORM}';
        delete from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET'
          and id not in (select id from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET' order by created_at limit ${created.resetBefore});
        delete from audit.events where tenant_id = '${PLATFORM}' and actor_user_id = '${opId}' and occurred_at > now() - interval '1 hour';
        commit;`)
      if (opBefore && !madeOperator) {
        const [ll, fc] = opBefore.split('|')
        sql(`update auth.user_credentials set last_login_at = ${ll === 'null' ? 'null' : lit(ll)}, failed_login_count = ${Number(fc)} where id = '${opId}'`)
      }
    }
    sql(`delete from hrms.departments where name = ${lit(created.deptName)}`)
    if (madeOperator) {
      sql(`begin;
        delete from rbac.user_roles where user_id = '${opId}';
        delete from auth.user_credentials where id = '${opId}';
        commit;`)
    }
    if (madeTenant) sql(`delete from platform.tenants where id = '${PLATFORM}'`)
    check('cleanup: no platform-tenant session, reset link or probe row left',
      sql(`select count(*) from auth.refresh_tokens where tenant_id = '${PLATFORM}'`) === '0'
      && Number(sql(`select count(*) from auth.invitation_tokens where user_id = '${opId}' and purpose = 'PASSWORD_RESET'`)) === (madeOperator ? 0 : created.resetBefore)
      && sql(`select count(*) from hrms.departments where name = ${lit(created.deptName)}`) === '0')
  } catch (e) {
    check('cleanup ran', false, String(e?.message || e).slice(0, 300))
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
