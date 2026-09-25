// Live API check of Workspace Settings -> Profile, Security and Danger zone (w2g, V143_26):
//  - Workspace profile: everyone reads it; only workspace.profile.update edits it;
//    bad GSTIN/PAN come back per field; the change lands in platform.tenants.
//  - Active sessions: every sign-in is a session with device + IP; signing one
//    out makes its access token stop at once (401) and its refresh token dead;
//    "sign out all others" keeps the current one; refresh keeps the session id.
//  - Two-factor: set-up (QR + secret), confirm, recovery codes (hashed), the
//    sign-in step (mfaCapable) and the mobile path (403 MFA_REQUIRED), replay
//    refused, recovery code sign-in, new recovery codes, turning it off.
//  - Workspace rule (ADMINS): a finance lead is walked through set-up at sign-in;
//    an employee is not; the rule blocks turning it off; an admin resets it.
//  - Data export: 403 for HR/employee; owner gets a real zip of CSVs per module
//    with a README and no secret columns.
//  - Reset / delete: scheduled, never immediate; OWNER only; typed name; one open
//    request; cancel; no employee is deleted.
// Everything it creates is removed (sessions, 2FA state, exports, requests,
// audit rows, profile values put back).
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w2g.mjs
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const PSQL = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const lit = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())

// ── TOTP (RFC 6238) for the authenticator-app side ──────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32decode(s) {
  const clean = s.replace(/[\s=]/g, '').toUpperCase()
  let bits = 0, value = 0
  const out = []
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 } }
  return Buffer.from(out)
}
function totp(secret, offsetSteps = 0) {
  const step = Math.floor(Date.now() / 1000 / 30) + offsetSteps
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest()
  const o = h[h.length - 1] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
const headers = (token) => ({ 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 live-w2g' })
async function raw(path, method = 'GET', body, token, extra = {}) {
  const res = await fetch(api + path, { method, headers: { ...headers(token), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const buf = Buffer.from(await res.arrayBuffer())
  let json = null
  try { json = buf.length ? JSON.parse(buf.toString('utf8')) : null } catch { json = null }
  return { status: res.status, json, buf, type: res.headers.get('content-type') || '' }
}
const sessionsMade = []
function client(auth) {
  const token = auth.accessToken
  if (token) { const sid = claims(token).sid; if (sid) sessionsMade.push(sid) }
  const call = (path, method = 'GET', body) => raw(path, method, body, token)
  return { ...auth, token, sid: token ? claims(token).sid : null, perms: token ? claims(token).permissions || [] : [], call }
}
async function loginRaw(email, extra = {}) {
  return raw('/v1/canonical-auth/login', 'POST', { tenantId: tenant, email, password, ...extra })
}
async function login(email) {
  const r = await loginRaw(email, { mfaCapable: true })
  if (r.status !== 200 || !r.json?.accessToken) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.json)}`)
  return client(r.json)
}

const userId = (email) => sql(`select id from auth.user_credentials where tenant_id='${tenant}' and lower(email)=lower(${lit(email)})`)
const start = sql('select now()')
const exportsMade = []
const requestsMade = []
let profileBefore = null
let policyBefore = null
const mfaUsers = ['reader@unifiedtree.demo', 'fin@unifiedtree.demo']

try {
  policyBefore = sql(`select mfa_policy from platform.tenants where id='${tenant}'`)
  let owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── permissions ──────────────────────────────────────────────────────────
  const NEW = ['workspace.profile.update', 'workspace.security.manage', 'workspace.data.export', 'workspace.lifecycle.manage']
  check('owner holds all four new permissions', NEW.every((p) => owner.perms.includes(p)))
  check('super admin holds all four new permissions', NEW.every((p) => admin.perms.includes(p)))
  check('HR manager, manager and employee hold none of them', [hrm, mgr, reader].every((c) => NEW.every((p) => !c.perms.includes(p))))
  check('OWNER role has every permission in the catalogue (invariant)', sql(`select count(*) from rbac.permissions p where p.module <> 'platform' and not exists (select 1 from rbac.role_permissions rp where rp.role_id='00000000-0000-0000-0000-000000000010' and rp.permission_code=p.code)`) === '0')

  // ── workspace profile ───────────────────────────────────────────────────
  profileBefore = (await owner.call('/v1/workspace/profile')).json
  const rp = await reader.call('/v1/workspace/profile')
  check('employee reads the workspace profile, not editable', rp.status === 200 && rp.json?.canEdit === false && rp.json?.subdomain, `status=${rp.status}`)
  check('owner sees it as editable', profileBefore?.canEdit === true)
  const body = { ...profileBefore, contactEmail: 'accounts@demo.example', contactPhone: '+91 20 1234 5678', addressLine1: '12 MG Road', addressLine2: 'Camp', city: 'Pune', state: 'Maharashtra', postalCode: '411001', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F' }
  const denyEdit = await reader.call('/v1/workspace/profile', 'PUT', body)
  check('employee cannot edit the workspace profile (403)', denyEdit.status === 403, `status=${denyEdit.status}`)
  const hrmEdit = await hrm.call('/v1/workspace/profile', 'PUT', body)
  check('HR manager cannot edit the workspace profile (403)', hrmEdit.status === 403, `status=${hrmEdit.status}`)
  const bad = await owner.call('/v1/workspace/profile', 'PUT', { ...body, gstin: '27AAPFU0939F1ZW', postalCode: '0110' })
  check('bad GSTIN and PIN come back per field (422)', bad.status === 422 && bad.json?.fields?.gstin && bad.json?.fields?.postalCode, JSON.stringify(bad.json?.fields))
  const ok = await owner.call('/v1/workspace/profile', 'PUT', { ...body, gstin: '27aapfu0939f1zv', pan: 'aapfu0939f' })
  const row = sql(`select concat_ws('|', gstin, pan, city, postal_code, contact_email) from platform.tenants where id='${tenant}'`)
  check('owner saves the profile; tax ids upper-cased; stored in platform.tenants', ok.status === 200 && row === '27AAPFU0939F1ZV|AAPFU0939F|Pune|411001|accounts@demo.example', row)
  check('profile change is in the audit trail', sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='WORKSPACE_PROFILE_UPDATED' and occurred_at >= '${start}'`) !== '0')

  // ── sessions ─────────────────────────────────────────────────────────────
  const a = await login('owner@unifiedtree.demo')
  const b = await login('owner@unifiedtree.demo')
  check('access tokens carry a session id (sid)', !!a.sid && !!b.sid && a.sid !== b.sid)
  const dbSess = sql(`select concat_ws('|', user_agent is not null, ip_address is not null, session_started_at is not null) from auth.refresh_tokens where session_id='${b.sid}'`)
  check('a session row records device and IP', dbSess === 't|t|t', dbSess)
  const list = await a.call('/v1/me/security/sessions')
  const mine = (list.json || []).find((s) => s.id === a.sid), other = (list.json || []).find((s) => s.id === b.sid)
  check('sessions list shows this one as current, with a device label', list.status === 200 && mine?.current === true && other && other.current === false && /Chrome on Windows/.test(other.device), `${list.json?.length} sessions`)
  const before = await b.call('/v1/me/security')
  const kill = await a.call(`/v1/me/security/sessions/${b.sid}`, 'DELETE')
  const after = await b.call('/v1/me/security')
  check('signing a session out stops its access token at once (401)', before.status === 200 && kill.status === 200 && after.status === 401 && after.json?.errorCode === 'SESSION_SIGNED_OUT', `before=${before.status} kill=${kill.status} after=${after.status}`)
  check('its refresh token is gone', sql(`select count(*) from auth.refresh_tokens where session_id='${b.sid}'`) === '0')
  const deadRefresh = await raw('/v1/canonical-auth/refresh', 'POST', { refreshToken: b.refreshToken })
  check('the signed-out session cannot refresh', deadRefresh.status >= 400, `status=${deadRefresh.status}`)
  const refreshed = await raw('/v1/canonical-auth/refresh', 'POST', { refreshToken: a.refreshToken })
  check('a refresh keeps the same session id', refreshed.status === 200 && claims(refreshed.json.accessToken).sid === a.sid, `status=${refreshed.status}`)
  const a2 = client(refreshed.json)
  const c = await login('owner@unifiedtree.demo')
  const others = await a2.call('/v1/me/security/sessions/sign-out-others', 'POST')
  const cAfter = await c.call('/v1/me/security')
  const aAfter = await a2.call('/v1/me/security')
  check('"sign out all others" ends the others and keeps this one', others.status === 200 && others.json?.signedOut >= 1 && cAfter.status === 401 && aAfter.status === 200, `others=${JSON.stringify(others.json)} c=${cAfter.status} a=${aAfter.status}`)
  const foreign = await reader.call(`/v1/me/security/sessions/${a2.sid}`, 'DELETE')
  check("someone else's session can't be signed out (404, still alive)", foreign.status === 404 && (await a2.call('/v1/me/security')).status === 200, `status=${foreign.status}`)
  // "Sign out all others" above also ended the owner session this test uses below: sign in again.
  owner = await login('owner@unifiedtree.demo')

  // ── two-factor for an employee (reader) ──────────────────────────────────
  const setup = await reader.call('/v1/me/security/totp/setup', 'POST')
  check('set-up returns a secret, an otpauth link and a QR image', setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.json?.secret || '') && setup.json?.otpauthUrl?.startsWith('otpauth://totp/') && setup.json?.qrSvg?.startsWith('<svg'), `status=${setup.status}`)
  const wsDisplay = sql(`select display_name from platform.tenants where id='${tenant}'`)
  check('the authenticator entry is named after the workspace', setup.json?.issuer === wsDisplay && decodeURIComponent(setup.json?.otpauthUrl || '').includes(`issuer=${wsDisplay}`), setup.json?.issuer)
  const secret = setup.json.secret
  check('pending secret is stored encrypted, not in plain text', sql(`select mfa_pending_secret_enc is not null and mfa_pending_secret_enc <> ${lit(secret)} from auth.user_credentials where id='${userId('reader@unifiedtree.demo')}'`) === 't')
  const wrong = await reader.call('/v1/me/security/totp/confirm', 'POST', { code: '000000' === totp(secret) ? '111111' : '000000' })
  check('a wrong set-up code is refused (422)', wrong.status === 422, `status=${wrong.status}`)
  const firstCode = totp(secret)
  const conf = await reader.call('/v1/me/security/totp/confirm', 'POST', { code: firstCode })
  const codes = conf.json?.recoveryCodes || []
  check('confirming turns it on and returns 10 recovery codes', conf.status === 200 && codes.length === 10, `status=${conf.status}`)
  const readerId = userId('reader@unifiedtree.demo')
  check('DB: is_mfa_enabled, secret encrypted, 10 hashed recovery codes', sql(`select concat_ws('|', is_mfa_enabled, mfa_secret_enc <> ${lit(secret)}, mfa_pending_secret_enc is null, (select count(*) from auth.mfa_recovery_codes r where r.user_id=c.id and r.used_at is null), (select count(*) from auth.mfa_recovery_codes r where r.user_id=c.id and r.code_hash = ${lit(codes[0])})) from auth.user_credentials c where id='${readerId}'`) === 't|t|t|10|0')
  const st = await reader.call('/v1/me/security')
  check('status says on, 10 codes left', st.json?.enabled === true && st.json?.recoveryCodesLeft === 10)
  const mobile = await loginRaw('reader@unifiedtree.demo')
  check('mobile-style sign-in (no mfaCapable) is refused with a clear 403', mobile.status === 403 && mobile.json?.errorCode === 'MFA_REQUIRED' && /mobile number/.test(mobile.json?.message || ''), `status=${mobile.status}`)
  const web = await loginRaw('reader@unifiedtree.demo', { mfaCapable: true })
  check('web sign-in stops at the code step (no session yet)', web.status === 200 && web.json?.mfaRequired === true && web.json?.mfaToken && !web.json?.accessToken, `status=${web.status}`)
  const asBearer = await raw('/v1/me/security', 'GET', undefined, web.json.mfaToken)
  check('the challenge token is not an access token', asBearer.status === 401 || asBearer.status === 403, `status=${asBearer.status}`)
  const replay = await raw('/v1/canonical-auth/login/mfa', 'POST', { mfaToken: web.json.mfaToken, code: firstCode })
  check('the code already used is refused (replay)', replay.status === 422, `status=${replay.status}`)
  const viaRecovery = await raw('/v1/canonical-auth/login/mfa', 'POST', { mfaToken: web.json.mfaToken, code: codes[0].toLowerCase() })
  check('a recovery code signs in once and is marked used', viaRecovery.status === 200 && viaRecovery.json?.accessToken && viaRecovery.json?.recoveryCodeUsed === true
    && sql(`select count(*) from auth.mfa_recovery_codes where user_id='${readerId}' and used_at is not null`) === '1', `status=${viaRecovery.status}`)
  if (viaRecovery.json?.accessToken) client(viaRecovery.json)
  const again = await loginRaw('reader@unifiedtree.demo', { mfaCapable: true })
  const reuse = await raw('/v1/canonical-auth/login/mfa', 'POST', { mfaToken: again.json?.mfaToken, code: codes[0] })
  check('the same recovery code does not work twice', reuse.status === 422, `status=${reuse.status}`)
  const regen = await reader.call('/v1/me/security/recovery-codes', 'POST', { code: codes[1] })
  const newCodes = regen.json?.recoveryCodes || []
  check('new recovery codes replace the old ones', regen.status === 200 && newCodes.length === 10 && sql(`select count(*) from auth.mfa_recovery_codes where user_id='${readerId}'`) === '10', `status=${regen.status}`)
  const oldCode = await reader.call('/v1/me/security/totp/disable', 'POST', { code: codes[2] })
  check('an old recovery code no longer works', oldCode.status === 422, `status=${oldCode.status}`)
  const off = await reader.call('/v1/me/security/totp/disable', 'POST', { code: newCodes[0] })
  check('turning it off with a code clears it', off.status === 200 && sql(`select concat_ws('|', is_mfa_enabled, mfa_secret_enc is null, (select count(*) from auth.mfa_recovery_codes where user_id='${readerId}')) from auth.user_credentials where id='${readerId}'`) === 'f|t|0', `status=${off.status}`)
  check('two-factor changes are audited', sql(`select count(distinct action) from audit.events where tenant_id='${tenant}' and action in ('MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_REPLACED') and occurred_at >= '${start}'`) === '3')

  // ── workspace rule ─────────────────────────────────────────────────────────
  check('HR manager cannot read or change the workspace rule (403)', (await hrm.call('/v1/workspace/security')).status === 403 && (await hrm.call('/v1/workspace/security', 'PUT', { mfaPolicy: 'EVERYONE' })).status === 403)
  const badPolicy = await owner.call('/v1/workspace/security', 'PUT', { mfaPolicy: 'SOMETIMES' })
  check('an unknown rule is refused (422)', badPolicy.status === 422, `status=${badPolicy.status}`)
  const setRule = await owner.call('/v1/workspace/security', 'PUT', { mfaPolicy: 'ADMINS' })
  check('owner requires two-factor for admins and HR', setRule.status === 200 && setRule.json?.mfaPolicy === 'ADMINS' && sql(`select mfa_policy from platform.tenants where id='${tenant}'`) === 'ADMINS', `status=${setRule.status}`)
  const finMobile = await loginRaw('fin@unifiedtree.demo')
  check('finance lead on the mobile path: 403 MFA_SETUP_REQUIRED', finMobile.status === 403 && finMobile.json?.errorCode === 'MFA_SETUP_REQUIRED', `status=${finMobile.status}`)
  const finWeb = await loginRaw('fin@unifiedtree.demo', { mfaCapable: true })
  check('finance lead on the web: walked through set-up first', finWeb.status === 200 && finWeb.json?.mfaSetupRequired === true && finWeb.json?.mfaToken, `status=${finWeb.status}`)
  const verifyTokenForSetup = await raw('/v1/canonical-auth/login/mfa/setup', 'POST', { mfaToken: web.json.mfaToken })
  check('a code-step challenge cannot start set-up (409)', verifyTokenForSetup.status === 409, `status=${verifyTokenForSetup.status}`)
  const finSetup = await raw('/v1/canonical-auth/login/mfa/setup', 'POST', { mfaToken: finWeb.json.mfaToken })
  const finDone = await raw('/v1/canonical-auth/login/mfa', 'POST', { mfaToken: finWeb.json.mfaToken, code: totp(finSetup.json?.secret || 'AAAA') })
  check('set-up at sign-in issues the session and the recovery codes', finSetup.status === 200 && finDone.status === 200 && finDone.json?.accessToken && finDone.json?.recoveryCodes?.length === 10, `setup=${finSetup.status} done=${finDone.status}`)
  const fin = client(finDone.json)
  check('finance lead now has two-factor on', sql(`select is_mfa_enabled from auth.user_credentials where id='${userId('fin@unifiedtree.demo')}'`) === 't')
  const readerLogin = await loginRaw('reader@unifiedtree.demo', { mfaCapable: true })
  check('an employee is not covered by the admins rule', readerLogin.status === 200 && !!readerLogin.json?.accessToken, `status=${readerLogin.status}`)
  if (readerLogin.json?.accessToken) client(readerLogin.json)
  const finOff = await fin.call('/v1/me/security/totp/disable', 'POST', { code: finDone.json.recoveryCodes[0] })
  check('the rule stops the finance lead turning it off (409)', finOff.status === 409 && finOff.json?.errorCode === 'MFA_REQUIRED_BY_WORKSPACE', `status=${finOff.status}`)
  const summary = await owner.call('/v1/workspace/security')
  const members = await owner.call('/v1/workspace/security/members')
  const finRow = (members.json || []).find((m) => m.email === 'fin@unifiedtree.demo')
  check('the workspace view counts and lists who has it on', summary.status === 200 && summary.json?.withTwoFactor >= 1 && finRow?.mfaEnabled === true && finRow?.requiredByRule === true, JSON.stringify(summary.json))
  const selfReset = await owner.call(`/v1/workspace/security/members/${userId('owner@unifiedtree.demo')}/mfa/reset`, 'POST')
  check('an admin cannot reset their own two-factor this way (409)', selfReset.status === 409, `status=${selfReset.status}`)
  const hrmReset = await hrm.call(`/v1/workspace/security/members/${userId('fin@unifiedtree.demo')}/mfa/reset`, 'POST')
  check('HR manager cannot reset someone else’s two-factor (403)', hrmReset.status === 403, `status=${hrmReset.status}`)
  const resetFin = await admin.call(`/v1/workspace/security/members/${userId('fin@unifiedtree.demo')}/mfa/reset`, 'POST')
  const finAfterReset = await fin.call('/v1/me/security')
  check('super admin resets it: off, and the person is signed out everywhere', resetFin.status === 200 && sql(`select is_mfa_enabled from auth.user_credentials where id='${userId('fin@unifiedtree.demo')}'`) === 'f' && finAfterReset.status === 401, `reset=${resetFin.status} fin=${finAfterReset.status}`)
  await owner.call('/v1/workspace/security', 'PUT', { mfaPolicy: policyBefore || 'OFF' })
  check('rule put back', sql(`select mfa_policy from platform.tenants where id='${tenant}'`) === (policyBefore || 'OFF'))

  // ── data export ─────────────────────────────────────────────────────────────
  check('HR manager and employee cannot export (403)', (await hrm.call('/v1/workspace/exports', 'POST')).status === 403 && (await reader.call('/v1/workspace/exports')).status === 403)
  const exp = await owner.call('/v1/workspace/exports', 'POST')
  if (exp.json?.id) exportsMade.push(exp.json.id)
  check('owner starts an export (202, queued in the database)', exp.status === 202 && ['QUEUED', 'RUNNING', 'READY'].includes(sql(`select status from platform.workspace_data_exports where id='${exp.json?.id}'`)), `status=${exp.status}`)
  const second = await owner.call('/v1/workspace/exports', 'POST')
  if (second.json?.id && second.status === 202) exportsMade.push(second.json.id)
  check('only one export at a time (409 while one is being prepared)', second.status === 409 || sql(`select status from platform.workspace_data_exports where id='${exp.json?.id}'`) === 'READY', `status=${second.status}`)
  let ready = null
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(2000)
    const l = await owner.call('/v1/workspace/exports')
    const r = (l.json || []).find((e) => e.id === exp.json?.id)
    if (r && (r.status === 'READY' || r.status === 'FAILED')) ready = r
  }
  check('the export is built in the background and becomes READY', ready?.status === 'READY' && ready.tableCount > 10 && ready.rowCount > 0, JSON.stringify(ready && { status: ready.status, tables: ready.tableCount, rows: ready.rowCount, error: ready.error }))
  if (ready?.status === 'READY') {
    const dl = await raw(`/v1/workspace/exports/${ready.id}/download`, 'GET', undefined, owner.token)
    const files = readZip(dl.buf)
    const names = Object.keys(files)
    check('download is a zip', dl.status === 200 && dl.type.includes('zip') && dl.buf.subarray(0, 2).toString() === 'PK', `status=${dl.status} ${dl.type}`)
    check('it has a folder per module, the README and users-and-access.csv', names.includes('README.txt') && names.includes('02-people/employees.csv') && names.includes('users-and-access.csv') && names.some((n) => n.startsWith('03-attendance/')) && names.some((n) => n.startsWith('04-leave/')), `${names.length} files`)
    const employees = files['02-people/employees.csv'] || ''
    const empCount = Number(sql(`select count(*) from hrms.employees where tenant_id='${tenant}'`))
    const empRows = csvRows(employees) - 1
    const empHeader = employees.split('\r\n')[0]
    check('employees.csv has every employee and no secret columns', empRows === empCount && /first_name/.test(empHeader) && !/aadhaar_number|face_embedding|tenant_id/.test(empHeader), `${empRows} rows vs ${empCount}`)
    const allHeaders = Object.values(files).map((t) => t.split('\r\n')[0]).join(',')
    check('no password, token or encrypted column anywhere in the export', !/password|token_hash|_encrypted|mfa_secret/.test(allHeaders))
    check('the download is counted and audited', sql(`select download_count from platform.workspace_data_exports where id='${ready.id}'`) === '1' && sql(`select count(*) from audit.events where tenant_id='${tenant}' and action='WORKSPACE_EXPORT_DOWNLOADED' and occurred_at >= '${start}'`) !== '0')
    check('HR manager cannot download it (403)', (await raw(`/v1/workspace/exports/${ready.id}/download`, 'GET', undefined, hrm.token)).status === 403)
  }

  // ── reset / delete requests ─────────────────────────────────────────────────
  const empBefore = sql(`select count(*) from hrms.employees where tenant_id='${tenant}'`)
  const wsName = sql(`select display_name from platform.tenants where id='${tenant}'`)
  check('HR manager cannot see reset/delete (403)', (await hrm.call('/v1/workspace/lifecycle-requests')).status === 403)
  const ov = await admin.call('/v1/workspace/lifecycle-requests')
  check('the page lists what reset removes and keeps', ov.status === 200 && ov.json?.resetRemoves?.length > 5 && ov.json?.resetKeeps?.length > 3 && ov.json?.coolingOffDays === 7 && ov.json?.youAreOwner === false, `status=${ov.status}`)
  const adminReq = await admin.call('/v1/workspace/lifecycle-requests', 'POST', { kind: 'RESET', confirmName: wsName })
  check('a super admin (not an owner) cannot schedule it (403)', adminReq.status === 403 && adminReq.json?.errorCode === 'OWNER_ONLY', `status=${adminReq.status}`)
  const wrongName = await owner.call('/v1/workspace/lifecycle-requests', 'POST', { kind: 'DELETE', confirmName: wsName + ' x' })
  check('the typed name must match (422)', wrongName.status === 422 && wrongName.json?.errorCode === 'CONFIRM_NAME_MISMATCH', `status=${wrongName.status}`)
  const sched = await owner.call('/v1/workspace/lifecycle-requests', 'POST', { kind: 'RESET', confirmName: `  ${wsName.toLowerCase()} `, reason: 'live-w2g test' })
  if (sched.json?.id) requestsMade.push(sched.json.id)
  const days = sched.json?.id ? Number(sql(`select round(extract(epoch from scheduled_for - created_at) / 86400) from platform.workspace_lifecycle_requests where id='${sched.json.id}'`)) : 0
  check('owner schedules a reset: 7 days out, not carried out', sched.status === 201 && sched.json?.status === 'SCHEDULED' && days === 7, `status=${sched.status} days=${days}`)
  const dup = await owner.call('/v1/workspace/lifecycle-requests', 'POST', { kind: 'DELETE', confirmName: wsName })
  if (dup.json?.id && dup.status === 201) requestsMade.push(dup.json.id)
  check('only one open request at a time (409)', dup.status === 409, `status=${dup.status}`)
  check('nothing was deleted', sql(`select count(*) from hrms.employees where tenant_id='${tenant}'`) === empBefore)
  const cancel = await admin.call(`/v1/workspace/lifecycle-requests/${sched.json?.id}/cancel`, 'POST')
  check('a super admin can cancel it', cancel.status === 200 && sql(`select status from platform.workspace_lifecycle_requests where id='${sched.json?.id}'`) === 'CANCELLED', `status=${cancel.status}`)
  const cancelAgain = await owner.call(`/v1/workspace/lifecycle-requests/${sched.json?.id}/cancel`, 'POST')
  check('a cancelled request cannot be cancelled again (409)', cancelAgain.status === 409, `status=${cancelAgain.status}`)
  check('schedule and cancel are audited', sql(`select count(distinct action) from audit.events where tenant_id='${tenant}' and action in ('WORKSPACE_RESET_SCHEDULED','WORKSPACE_RESET_CANCELLED') and occurred_at >= '${start}'`) === '2')
} catch (e) {
  check('run completed without an exception', false, e?.stack || String(e))
} finally {
  // ── clean up everything this run created ─────────────────────────────────
  try {
    if (profileBefore) {
      const p = profileBefore
      sql(`update platform.tenants set display_name=${lit(p.displayName)}, contact_email=${lit(p.contactEmail)}, contact_phone=${lit(p.contactPhone)}, address_line1=${lit(p.addressLine1)}, address_line2=${lit(p.addressLine2)}, city=${lit(p.city)}, state=${lit(p.state)}, postal_code=${lit(p.postalCode)}, gstin=${lit(p.gstin)}, pan=${lit(p.pan)} where id='${tenant}'`)
    }
    if (policyBefore) sql(`update platform.tenants set mfa_policy=${lit(policyBefore)} where id='${tenant}'`)
    for (const email of mfaUsers) {
      const id = userId(email)
      sql(`delete from auth.mfa_recovery_codes where user_id='${id}'`)
      sql(`update auth.user_credentials set is_mfa_enabled=false, mfa_secret_enc=null, mfa_enabled_at=null, mfa_pending_secret_enc=null, mfa_pending_created_at=null, mfa_last_used_step=null, mfa_failed_count=0, locked_until=null where id='${id}'`)
    }
    sql(`delete from platform.workspace_data_exports where tenant_id='${tenant}' and created_at >= '${start}'`)
    sql(`delete from platform.workspace_lifecycle_requests where tenant_id='${tenant}' and created_at >= '${start}'`)
    if (sessionsMade.length) sql(`delete from auth.refresh_tokens where session_id in (${sessionsMade.map(lit).join(',')})`)
    sql(`delete from auth.refresh_tokens where tenant_id='${tenant}' and issued_at >= '${start}' and user_agent like '%live-w2g%'`)
    sql(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and action in ('WORKSPACE_PROFILE_UPDATED','MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_REPLACED','MFA_RESET_BY_ADMIN','MFA_POLICY_CHANGED','SESSION_SIGNED_OUT','SESSIONS_SIGNED_OUT','WORKSPACE_EXPORT_REQUESTED','WORKSPACE_EXPORT_DOWNLOADED','WORKSPACE_RESET_SCHEDULED','WORKSPACE_RESET_CANCELLED','WORKSPACE_DELETE_SCHEDULED','WORKSPACE_DELETE_CANCELLED')`)
    const left = sql(`select (select count(*) from platform.workspace_data_exports where tenant_id='${tenant}' and created_at >= '${start}') + (select count(*) from platform.workspace_lifecycle_requests where tenant_id='${tenant}' and created_at >= '${start}') + (select count(*) from auth.user_credentials where tenant_id='${tenant}' and is_mfa_enabled)`)
    check('cleanup: no exports, requests or two-factor left behind', left === '0', left)
  } catch (e) {
    check('cleanup ran', false, String(e))
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}

/** Rows in a CSV (line breaks inside quoted cells don't count). */
function csvRows(text) {
  let rows = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    else if (ch === '\n' && !quoted) rows++
  }
  return rows
}

/** Minimal zip reader (central directory + raw inflate) for checking the export. */
function readZip(buf) {
  const out = {}
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break } }
  if (eocd < 0) return out
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(dataStart, dataStart + size)
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8').replace(/^﻿/, '')
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
