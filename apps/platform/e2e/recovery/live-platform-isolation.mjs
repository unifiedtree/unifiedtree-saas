// Live check of the platform permission fix (V143_92 + PlatformAdminAccess).
//  - A business owner (owner@, OWNER) and a business super admin (admin@,
//    SUPER_ADMIN) get 403 on the sign-up approval API: the list of every
//    business's contact details, approve and reject. Their tokens carry no
//    platform.* code any more.
//  - No role except PLATFORM_SUPER_ADMIN holds platform.*; SUPER_ADMIN still
//    holds the workspace codes the "or platform.admin" guards pair with.
//  - Both still use the workspace screens those guards protect: roles,
//    permissions, users, companies, branches, departments, designations,
//    contractors (API; /v1/platform/users is not mounted in the canonical app), and the Roles, Users, Companies and Organization pages
//    (browser, no page errors, no failed API call).
//  - A real platform admin (a temporary one in the platform tenant, signed in
//    through /v1/platform/auth/login) still lists sign-ups (200).
// Everything created is removed at the end. Writes nothing to any business.
//
//   live-slot.sh <worktree> <port> node e2e/recovery/live-platform-isolation.mjs
/* global Buffer, URL, console, fetch, process */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3024'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const PLATFORM_TENANT = '00000000-0000-0000-0000-000000000000'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const DB = process.env.RECOVERY_DB || 'ut_w3_dev'
const PSQL = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function call(token, path, method = 'GET', body, tenantHeader = tenant) {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantHeader, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())

async function login(email) {
  const r = await call(null, '/v1/canonical-auth/login', 'POST', { tenantId: tenant, email, password })
  if (!r.json?.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  return r.json.accessToken
}

const SUPER_ADMIN_CODES = ['rbac.role.write', 'rbac.access.manage-overrides', 'workspace.users.read', 'workspace.users.manage',
  'org.company.read', 'hrms.department.read', 'hrms.designation.read', 'hrms.contractor.read']
const nobody = randomUUID()  // a business that does not exist: approve / reject can change nothing even if let through
const platformUser = randomUUID()
const platformEmail = `qa-platform-${Date.now()}@unifiedtree.invalid`
let platformUserMade = false
let browser

try {
  // ── Database: who holds platform.* ──────────────────────────────────────────
  check('db: no role but PLATFORM_SUPER_ADMIN holds platform.*',
    sql(`select count(*) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id
          where rp.permission_code like 'platform.%' and not (r.tenant_id is null and r.code = 'PLATFORM_SUPER_ADMIN')`) === '0')
  check('db: PLATFORM_SUPER_ADMIN keeps its 4 platform codes',
    sql(`select count(*) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id
          where r.tenant_id is null and r.code = 'PLATFORM_SUPER_ADMIN' and rp.permission_code like 'platform.%'`) === '4')
  check('db: no platform.* override inside a workspace',
    sql(`select count(*) from rbac.user_permission_overrides where permission_code like 'platform.%' and tenant_id <> '${PLATFORM_TENANT}'`) === '0')
  const saHeld = sql(`select count(*) from rbac.role_permissions rp join rbac.roles r on r.id = rp.role_id
          where r.tenant_id is null and r.code = 'SUPER_ADMIN' and rp.permission_code in (${SUPER_ADMIN_CODES.map((c) => `'${c}'`).join(',')})`)
  check('db: SUPER_ADMIN holds the 8 workspace codes the platform.admin guards pair with', saHeld === '8', `held ${saHeld}`)

  // ── Workspace tokens: refused on the platform API, fine on workspace APIs ────
  const owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  for (const [who, token] of [['owner@ (OWNER)', owner], ['admin@ (SUPER_ADMIN)', admin]]) {
    const c = claims(token)
    check(`${who}: token is for the business, with no platform.* code`,
      c.tenant_id === tenant && !(c.permissions || []).some((p) => p.startsWith('platform.')),
      (c.permissions || []).filter((p) => p.startsWith('platform.')).join(','))

    const list = await call(token, '/v1/platform/tenant-requests')
    check(`${who}: GET /v1/platform/tenant-requests is 403`, list.status === 403, `status=${list.status}`)
    check(`${who}: no other business's contact details in the answer`, !JSON.stringify(list.json || '').includes('@'))
    const all = await call(token, '/v1/platform/tenant-requests?status=ALL')
    check(`${who}: ...?status=ALL is 403 too`, all.status === 403, `status=${all.status}`)
    const approve = await call(token, `/v1/platform/tenant-requests/${nobody}/approve`, 'POST', { approvedModules: ['hrms'] })
    check(`${who}: approve another business is 403`, approve.status === 403, `status=${approve.status}`)
    const reject = await call(token, `/v1/platform/tenant-requests/${nobody}/reject`, 'POST', { reason: 'QA platform isolation' })
    check(`${who}: reject another business is 403`, reject.status === 403, `status=${reject.status}`)
    // Same token, the platform tenant named in the header: the tenant comes from the token, so still refused.
    const spoof = await call(token, '/v1/platform/tenant-requests', 'GET', undefined, PLATFORM_TENANT)
    check(`${who}: naming the platform tenant in the header changes nothing`, spoof.status === 403, `status=${spoof.status}`)

    const roles = await call(token, '/v1/rbac/roles')
    check(`${who}: roles list 200`, roles.status === 200 && Array.isArray(roles.json) && roles.json.length > 0, `status=${roles.status}`)
    check(`${who}: the platform role is not listed in a business`, Array.isArray(roles.json) && !roles.json.some((r) => (r.code || '').startsWith('PLATFORM_')))
    const ownerRole = Array.isArray(roles.json) ? roles.json.find((r) => r.code === 'OWNER') : null
    const paths = ['/v1/rbac/permissions', '/v1/rbac/roles/new-permissions', '/v1/rbac/personal-pages',
      ownerRole ? `/v1/rbac/roles/${ownerRole.id}/permissions` : null,
      '/v1/workspace/users', '/v1/hrms/companies', '/v1/hrms/branches',
      `/v1/hrms/departments?companyId=${company}`, `/v1/hrms/designations?companyId=${company}`,
      `/v1/hrms/contractors?companyId=${company}`].filter(Boolean)
    for (const p of paths) {
      const r = await call(token, p)
      check(`${who}: GET ${p.replace(/[0-9a-f-]{36}/g, '{id}')} 200`, r.status === 200, `status=${r.status}`)
    }
  }

  // ── A real platform admin still gets in ─────────────────────────────────────
  const hash = sql(`select password_hash from auth.user_credentials where tenant_id = '${tenant}' and email = 'owner@unifiedtree.demo'`)
  sql(`begin;
    insert into auth.user_credentials (id, tenant_id, email, password_hash, is_active, is_biometric_enabled, failed_login_count,
        created_at, updated_at, created_by, updated_by, version)
      values ('${platformUser}', '${PLATFORM_TENANT}', '${platformEmail}', '${hash}', true, false, 0, now(), now(), 'qa', 'qa', 0);
    insert into rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
      values ('${PLATFORM_TENANT}', '${platformUser}', '00000000-0000-0000-0000-000000000006', now(), '${platformUser}');
    commit;`)
  platformUserMade = true
  const pl = await call(null, '/v1/platform/auth/login', 'POST', { email: platformEmail, password }, PLATFORM_TENANT)
  check('platform admin: signs in through /v1/platform/auth/login', pl.status === 200 && !!pl.json?.accessToken, `status=${pl.status}`)
  if (pl.json?.accessToken) {
    const pc = claims(pl.json.accessToken)
    check('platform admin: token is for the platform tenant with PLATFORM_SUPER_ADMIN',
      pc.tenant_id === PLATFORM_TENANT && (pc.roles || []).includes('PLATFORM_SUPER_ADMIN'))
    const list = await call(pl.json.accessToken, '/v1/platform/tenant-requests', 'GET', undefined, PLATFORM_TENANT)
    check('platform admin: GET /v1/platform/tenant-requests 200 and lists the demo business',
      list.status === 200 && Array.isArray(list.json) && list.json.some((t) => t.tenantId === tenant), `status=${list.status}`)
    // Past the guard: an empty reason is a validation error, not a refusal. Changes nothing.
    const bad = await call(pl.json.accessToken, `/v1/platform/tenant-requests/${nobody}/reject`, 'POST', { reason: '' }, PLATFORM_TENANT)
    check('platform admin: reject is not refused (400 for an empty reason)', bad.status === 400, `status=${bad.status}`)
  }

  // ── Browser: the workspace screens load for OWNER and SUPER_ADMIN ───────────
  mkdirSync(shots, { recursive: true })
  browser = await chromium.launch({ headless: true })
  for (const [who, email] of [['owner', 'owner@unifiedtree.demo'], ['admin', 'admin@unifiedtree.demo']]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
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
    await page.waitForTimeout(2500)
    for (const [path, name] of [['/roles', 'roles'], ['/users', 'users'], ['/hrms/companies', 'companies'], ['/hrms/organization', 'organization']]) {
      errors.length = 0; failedApi.length = 0
      await page.goto(base + path)
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45_000 }).catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(1200)
      const h1 = (await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')).trim()
      const denied = await page.getByText(/don.t have (access|permission)|not allowed|access denied/i).count()
      await page.screenshot({ path: `${shots}/w24-platsec-${who}-${name}.png` })
      check(`${who}@ browser: ${path} loads`, new URL(page.url()).pathname === path && !!h1 && denied === 0 && errors.length === 0 && failedApi.length === 0,
        `url=${new URL(page.url()).pathname} h1="${h1}" denied=${denied} errors=${errors.join(' | ')} api=${failedApi.join(', ')}`)
    }
    await ctx.close()
  }
} catch (e) {
  check('run finished without an exception', false, String(e?.stack || e).slice(0, 400))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (platformUserMade) {
    sql(`begin;
      delete from auth.refresh_tokens where user_id = '${platformUser}';
      delete from rbac.user_roles where user_id = '${platformUser}';
      delete from auth.user_credentials where id = '${platformUser}';
      commit;`)
  }
  check('cleanup: the temporary platform admin is gone',
    sql(`select count(*) from auth.user_credentials where id = '${platformUser}'`) === '0')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
