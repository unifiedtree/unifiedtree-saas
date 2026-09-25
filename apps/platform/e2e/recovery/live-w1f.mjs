// Live API check of w1f — white label (V143_15, BrandingService, PublicBrandingController,
// WorkspaceLetterhead, workspace-named emails). No browser.
//
//  - settings.branding.write exists, is described, and is held by OWNER / SUPER_ADMIN / ADMIN only.
//  - GET /v1/workspace/branding: workspace name + monogram for any member.
//  - Public GET /v1/public/workspace-branding: name and images only, by subdomain; 404 for unknown.
//  - POST /v1/workspace/branding/{mark|logo}: 403 for HR / manager / finance / employee; stored
//    bytes, type, size and version for owner / super admin; server re-validation (too small,
//    not square, SVG, GIF, over 2 MB, unknown slot) leaves the database untouched.
//  - Public image address serves the exact bytes, cached for a year when the version matches.
//  - DELETE /v1/workspace/branding/{kind}: 403 for an employee; clears the image; public 404.
//  - Letter PDFs gain the workspace logo once uploaded; payslip / salary register too when a
//    locked run exists (skipped otherwise — this test never processes or locks payroll).
//  - Password-reset email: From = workspace name, no vendor branding in the body (when the local
//    mail catcher is running; skipped otherwise).
// Everything created is removed and the workspace's branding row is restored.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w1f.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const psql = path.join(process.env.LOCALAPPDATA || '', 'UnifiedTreeRecovery', 'pgsql', 'bin', 'psql.exe')
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => console.log(`SKIP  ${name}  — ${why}`)

// ── a tiny PNG encoder (RGBA, no filter) so the test needs no dependencies ──
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** A white field with a dark green square in the middle (a realistic mark with a flat background). */
function png(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const inner = x > w / 4 && x < (3 * w) / 4 && y > h / 4 && y < (3 * h) / 4
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = inner ? 12 : 255; raw[o + 1] = inner ? 90 : 255; raw[o + 2] = inner ? 69 : 255; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const version = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const auth = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(api + p, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  const upload = async (kind, bytes, filename = `${kind}.png`, type = 'image/png') => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type }), filename)
    const res = await fetch(`${api}/v1/workspace/branding/${kind}`, { method: 'POST', headers: auth, body: form })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  const binary = async (p) => {
    const res = await fetch(api + p, { headers: auth })
    return { status: res.status, type: res.headers.get('content-type') || '', bytes: Buffer.from(await res.arrayBuffer()) }
  }
  return { call, upload, binary, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

/** Raw PDF bytes plus every Flate stream inflated, as latin1 text (PDFBox may compress object streams). */
function pdfText(buf) {
  let out = buf.toString('latin1')
  const s = buf.toString('latin1')
  let i = 0
  while ((i = s.indexOf('stream', i)) >= 0) {
    let start = i + 6
    if (s[start] === '\r') start++
    if (s[start] === '\n') start++
    const end = s.indexOf('endstream', start)
    if (end < 0) break
    try { out += '\n' + inflateSync(buf.subarray(start, end)).toString('latin1') } catch { /* not flate */ }
    i = end + 9
  }
  return out
}
const hasImage = (buf) => /\/Subtype\s*\/Image/.test(pdfText(buf))

const BACKUP = 'public.w1f_branding_backup'
const col = (c) => sql(`select coalesce(${c}::text,'') from platform.tenant_branding where tenant_id='${tenant}'`)
const created = { templates: [], letters: [], resetSince: null }
let backedUp = false
let ownerRef = null
try {
  // Keep whatever branding the workspace had, and start from none.
  sql(`drop table if exists ${BACKUP}; create table ${BACKUP} as select * from platform.tenant_branding where tenant_id='${tenant}'`)
  backedUp = true
  sql(`delete from platform.tenant_branding where tenant_id='${tenant}'`)
  const displayName = sql(`select display_name from platform.tenants where id='${tenant}'`)
  const subdomain = sql(`select subdomain from platform.tenants where id='${tenant}'`)

  // ── permission ──
  const perm = sql(`select display_name || '|' || coalesce(description,'') from rbac.permissions where code='settings.branding.write'`)
  check('permission settings.branding.write exists with a description', perm.includes('|') && perm.split('|')[1].length > 40, perm.slice(0, 80))
  const holders = sql(`select string_agg(r.code, ',' order by r.code) from rbac.role_permissions rp join rbac.roles r on r.id=rp.role_id where rp.permission_code='settings.branding.write' and r.tenant_id is null`)
  check('granted to OWNER, SUPER_ADMIN and ADMIN only', holders === 'ADMIN,OWNER,SUPER_ADMIN', holders)

  const owner = await login('owner@unifiedtree.demo')
  ownerRef = owner
  const admin = await login('admin@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  check('owner and super admin carry the permission in their token', owner.perms.includes('settings.branding.write') && admin.perms.includes('settings.branding.write'))
  check('HR, manager, finance and employee do not', ![hrm, mgr, fin, reader].some((u) => u.perms.includes('settings.branding.write')))

  // ── reads ──
  const mine = await reader.call('/v1/workspace/branding')
  check('GET /v1/workspace/branding: any member gets the workspace name and monogram',
    mine.status === 200 && mine.json?.workspaceName === displayName && mine.json?.monogram === displayName.trim()[0].toUpperCase() && mine.json?.logoUrl === null && mine.json?.markUrl === null,
    `status=${mine.status} name=${mine.json?.workspaceName} monogram=${mine.json?.monogram}`)
  const pub = await fetch(`${api}/v1/public/workspace-branding?subdomain=${subdomain}`)
  const pubJson = await pub.json().catch(() => null)
  check('public lookup by subdomain: name and images only, no sign-in needed',
    pub.status === 200 && pubJson?.workspaceName === displayName && Object.keys(pubJson).sort().join(',') === 'logoUrl,markUrl,monogram,workspaceName',
    `status=${pub.status} keys=${pubJson && Object.keys(pubJson).join(',')}`)
  const pubHeader = await fetch(`${api}/v1/public/workspace-branding`, { headers: { 'X-Tenant-Subdomain': subdomain } })
  check('public lookup also works from the X-Tenant-Subdomain header (what the web app sends)', pubHeader.status === 200)
  const unknown = await fetch(`${api}/v1/public/workspace-branding?subdomain=no-such-workspace-w1f`)
  check('public lookup for an unknown workspace is 404', unknown.status === 404, `status=${unknown.status}`)

  // ── uploads: refused roles ──
  const mark = png(256, 256)
  for (const [label, u] of [['HR manager', hrm], ['department manager', mgr], ['finance lead', fin], ['employee', reader]]) {
    const r = await u.upload('mark', mark)
    check(`${label} cannot upload a mark (403)`, r.status === 403, `status=${r.status}`)
  }
  check('refused uploads wrote nothing', sql(`select count(*) from platform.tenant_branding where tenant_id='${tenant}'`) === '0')

  // ── uploads: owner / super admin ──
  const up = await owner.upload('mark', mark)
  check('owner uploads a 256 × 256 square mark (201)', up.status === 201 && (up.json?.markUrl || '').includes(version(mark)), `status=${up.status} markUrl=${up.json?.markUrl}`)
  check('database holds the exact bytes, type, size and version',
    col('octet_length(mark_bytes)') === String(mark.length) && col('mark_content_type') === 'image/png'
      && col('mark_width') === '256' && col('mark_height') === '256' && col('mark_version') === version(mark)
      && col('updated_by') === '66666666-6666-6666-6666-666666666666',
    `${col('octet_length(mark_bytes)')} bytes, ${col('mark_width')}x${col('mark_height')}, v=${col('mark_version')}`)
  const logo = png(512, 128)
  const upLogo = await admin.upload('logo', logo)
  check('super admin uploads a 512 × 128 wide logo (201)', upLogo.status === 201 && col('logo_width') === '512' && col('logo_height') === '128', `status=${upLogo.status}`)
  const after = await reader.call('/v1/workspace/branding')
  check('members now see both image addresses with their sizes',
    after.json?.markUrl?.startsWith(`/v1/public/workspace-branding/${tenant}/mark?v=`) && after.json?.logoUrl?.includes('/logo?v=') && after.json?.logoWidth === 512 && after.json?.markHeight === 256,
    `${after.json?.markUrl} | ${after.json?.logoUrl}`)
  const pub2 = await (await fetch(`${api}/v1/public/workspace-branding?subdomain=${subdomain}`)).json()
  check('the sign-in lookup returns the same addresses', pub2.markUrl === after.json?.markUrl && pub2.logoUrl === after.json?.logoUrl)

  // ── public image ──
  const img = await fetch(api + after.json.markUrl)
  const imgBytes = Buffer.from(await img.arrayBuffer())
  check('public image serves the exact PNG, cached for a year at its version',
    img.status === 200 && img.headers.get('content-type') === 'image/png' && imgBytes.equals(mark) && /immutable/.test(img.headers.get('cache-control') || '') && img.headers.get('x-content-type-options') === 'nosniff',
    `status=${img.status} type=${img.headers.get('content-type')} cache=${img.headers.get('cache-control')}`)
  const stale = await fetch(`${api}/v1/public/workspace-branding/${tenant}/mark?v=old`)
  check('an old version address still works but is cached briefly', stale.status === 200 && /max-age=300/.test(stale.headers.get('cache-control') || ''), stale.headers.get('cache-control'))
  const badKind = await fetch(`${api}/v1/public/workspace-branding/${tenant}/favicon`)
  check('unknown image slot is 404', badKind.status === 404, `status=${badKind.status}`)

  // ── server re-validation ──
  const before = col('mark_version')
  const tooSmall = await owner.upload('mark', png(64, 64))
  check('a 64 × 64 image is refused (422)', tooSmall.status === 422 && /128/.test(tooSmall.json?.message || ''), `${tooSmall.status} ${tooSmall.json?.message}`)
  const oblong = await owner.upload('mark', png(300, 200))
  check('a non-square mark is refused (422)', oblong.status === 422, `${oblong.status} ${oblong.json?.message}`)
  const svg = await owner.upload('mark', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), 'x.png', 'image/png')
  check('an SVG disguised as PNG is refused (415)', svg.status === 415, `${svg.status} ${svg.json?.message}`)
  const gif = await owner.upload('logo', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]), 'x.gif', 'image/gif')
  check('a GIF is refused (415)', gif.status === 415, `status=${gif.status}`)
  const big = Buffer.concat([png(256, 256), Buffer.alloc(2 * 1024 * 1024)])
  const tooBig = await owner.upload('logo', big)
  check('a file over 2 MB is refused (413)', tooBig.status === 413, `status=${tooBig.status}`)
  const slot = await owner.upload('favicon', mark)
  check('an unknown slot is refused (404)', slot.status === 404, `status=${slot.status}`)
  check('failed uploads left the stored mark unchanged', col('mark_version') === before)

  // ── letters carry the letterhead ──
  const companyId = sql(`select id from org.companies where tenant_id='${tenant}' and is_active order by created_at limit 1`)
  const employeeId = sql(`select id from hrms.employees where tenant_id='${tenant}' and is_active and company_id is not null order by created_at limit 1`)
  if (companyId && employeeId) {
    const tpl = await owner.call('/v1/letters/templates', 'POST', { companyId, name: `W1F letterhead ${Date.now()}`, type: 'CUSTOM', subject: 'Letterhead check', bodyHtml: '<p>Dear {{employee.first_name}},</p><p>This is a letterhead check.</p>' })
    if (tpl.json?.id) created.templates.push(tpl.json.id)
    const gen = await owner.call('/v1/letters/generate', 'POST', { templateId: tpl.json?.id, employeeId, overrides: {}, sendImmediately: false })
    if (gen.json?.id) created.letters.push(gen.json.id)
    const pdf = gen.json?.id ? await owner.binary(`/v1/letters/generated/${gen.json.id}/pdf`) : { status: 0, bytes: Buffer.alloc(0) }
    check('a generated letter PDF opens with the workspace logo', pdf.status === 200 && pdf.bytes.subarray(0, 4).toString() === '%PDF' && hasImage(pdf.bytes),
      `template=${tpl.status} generate=${gen.status} pdf=${pdf.status} ${pdf.bytes.length} bytes`)
  } else skip('letter letterhead', 'no company or employee with a company in this database')

  // ── payslip / salary register (only if a locked run already exists) ──
  const run = sql(`select r.id || '|' || l.employee_id from payroll.runs r join payroll.payslip_lines l on l.run_id=r.id where r.tenant_id='${tenant}' and r.status in ('LOCKED','PAID') limit 1`)
  if (run) {
    const [runId, empId] = run.split('|')
    const slip = await fin.binary(`/v1/payroll/runs/${runId}/employees/${empId}/payslip.pdf`)
    check('payslip PDF opens with the workspace logo', slip.status === 200 && hasImage(slip.bytes), `status=${slip.status}`)
    const reg = await fin.binary(`/v1/payroll/reports/salary-register?runId=${runId}`)
    check('salary register PDF opens with the workspace logo', reg.status === 200 && hasImage(reg.bytes), `status=${reg.status}`)
  } else skip('payslip and salary register letterhead', 'no locked payroll run in this database (the test never processes payroll)')

  // ── password reset email is sent under the workspace name ──
  const mailDir = path.join(process.env.LOCALAPPDATA || '', 'UnifiedTreeRecovery', 'mail')
  const seen = new Set(fs.existsSync(mailDir) ? fs.readdirSync(mailDir) : [])
  created.resetSince = sql('select now()')
  const fp = await fetch(`${api}/v1/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ email: 'reader@unifiedtree.demo', tenantId: tenant }) })
  check('forgot-password accepts the request', fp.status === 200, `status=${fp.status}`)
  let eml = null
  for (let i = 0; i < 20 && !eml; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (!fs.existsSync(mailDir)) continue
    const fresh = fs.readdirSync(mailDir).filter((f) => !seen.has(f)).map((f) => fs.readFileSync(path.join(mailDir, f), 'utf8'))
    eml = fresh.find((m) => /reader@unifiedtree\.demo/i.test(m) && /reset/i.test(m)) || null
  }
  if (eml) {
    const from = (eml.match(/^From:\s*(.*)$/im) || [])[1] || ''
    const subject = (eml.match(/^Subject:\s*(.*)$/im) || [])[1] || ''
    check('reset email: From shows the workspace name', from.includes(displayName) || /=\?UTF-8\?/i.test(from), from)
    check('reset email: subject names the workspace', subject.includes(displayName) || /=\?UTF-8\?/i.test(subject), subject)
    check('reset email: body carries no vendor product line', !/UnifiedTree (HRMS|account)/i.test(eml))
  } else skip('reset email From / body', 'local mail catcher (scripts/local-mail-catcher.mjs) not running or no mail captured')

  // ── removal ──
  const denied = await reader.call('/v1/workspace/branding/mark', 'DELETE')
  check('an employee cannot remove the mark (403)', denied.status === 403 && col('mark_version') === before, `status=${denied.status}`)
  const del = await owner.call('/v1/workspace/branding/mark', 'DELETE')
  check('owner removes the mark; the logo stays', del.status === 200 && del.json?.markUrl === null && !!del.json?.logoUrl && col('mark_bytes') === '' && col('logo_width') === '512', `status=${del.status}`)
  const gone = await fetch(`${api}/v1/public/workspace-branding/${tenant}/mark`)
  check('the removed mark is no longer served (404)', gone.status === 404, `status=${gone.status}`)
  const delLogo = await admin.call('/v1/workspace/branding/logo', 'DELETE')
  check('super admin removes the logo; the workspace falls back to its monogram', delLogo.status === 200 && delLogo.json?.logoUrl === null && delLogo.json?.markUrl === null && delLogo.json?.monogram, `status=${delLogo.status}`)
} catch (e) {
  check('test ran to completion', false, e.stack || String(e))
} finally {
  try {
    // Through the API first (removes the stored PDF file too), then make sure the rows are gone.
    for (const id of created.letters) { if (ownerRef) await ownerRef.call(`/v1/letters/generated/${id}`, 'DELETE').catch(() => null); sql(`delete from letters.generated where id='${id}'`) }
    for (const id of created.templates) { if (ownerRef) await ownerRef.call(`/v1/letters/templates/${id}`, 'DELETE').catch(() => null); sql(`delete from letters.templates where id='${id}'`) }
    if (created.resetSince) sql(`delete from auth.invitation_tokens where purpose='PASSWORD_RESET' and user_id='22222222-2222-2222-2222-222222222222' and created_at >= '${created.resetSince}'`)
    if (backedUp) {
      sql(`delete from platform.tenant_branding where tenant_id='${tenant}'; insert into platform.tenant_branding select * from ${BACKUP}; drop table ${BACKUP}`)
    }
    console.log('cleanup: letters, templates, reset tokens removed; branding row restored')
  } catch (e) {
    console.log('FAIL  cleanup', e.message)
    results.push({ name: 'cleanup', ok: false })
  }
}
const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
