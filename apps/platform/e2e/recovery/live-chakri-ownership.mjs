// Live check for chakri/ownership-transfer-build (owner decisions, 6 Oct 2026).
//
//   live-slot.sh /c/REACT/ut-wt/chakri-ownership 3103 node e2e/recovery/live-chakri-ownership.mjs
//
// owner@ hands the demo business to hrm@:
//  - start: wrong password refused; right password -> PENDING, hrm@ sees the offer (youAreNewOwner);
//  - exactly one owner: owner@ can't give hrm@ the Owner role on the Access screen (OWNER_BY_TRANSFER_ONLY);
//  - web: hrm@ sees "Accept and become the owner" on /business/ownership (1440 and 390 wide);
//  - accept: hrm@ holds OWNER + SUPER_ADMIN, owner@ holds ADMIN and not OWNER; owner@'s old session is
//    signed out; the business's contact email is hrm@'s;
//  - end the handover: owner@ loses ADMIN and keeps EMPLOYEE (they are an employee); COMPLETED.
// Everything is put back at the end (roles, contact, the transfer row).
/* global process, console, fetch */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

async function as(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const uid = (email) => sql(`select id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='${email}'`)
const roles = (id) => sql(`select coalesce(string_agg(r.code, ',' order by r.code), '') from rbac.user_roles ur join rbac.roles r on r.id = ur.role_id where ur.tenant_id='${tenant}' and ur.user_id='${id}'`)

const OWNER = uid('owner@unifiedtree.demo'), HRM = uid('hrm@unifiedtree.demo')
const before = { owner: roles(OWNER), hrm: roles(HRM), contact: sql(`select contact_email from platform.tenants where id='${tenant}'`),
  hrmCompanies: sql(`select count(*) from rbac.user_company_access where tenant_id='${tenant}' and user_id='${HRM}'`) }
let transferId = null
let browser
try {
  check('V144_5 applied', sql(`select to_regclass('platform.ownership_transfers') is not null`) === 't')
  const owner = await as('owner@unifiedtree.demo')
  const cands = await owner('GET', '/v1/workspace/ownership-transfer/candidates')
  check('owner: hrm@ is a candidate, not themselves', cands.status === 200 && cands.json.some((c) => c.userId === HRM) && !cands.json.some((c) => c.userId === OWNER))

  const wrong = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password: 'nope-nope', note: 'QA' })
  check('start: a wrong password is refused', wrong.status >= 400 && JSON.stringify(wrong.json).includes('PASSWORD_WRONG'), `${wrong.status} ${JSON.stringify(wrong.json).slice(0, 120)}`)
  const started = await owner('POST', '/v1/workspace/ownership-transfer', { toUserId: HRM, password, note: 'QA handover' })
  transferId = started.json?.id
  check('start: the offer is PENDING', started.status === 200 && started.json?.status === 'PENDING', JSON.stringify(started.json).slice(0, 160))

  const hrm = await as('hrm@unifiedtree.demo')
  const seen = await hrm('GET', '/v1/workspace/ownership-transfer')
  check('hrm@ sees the offer as the new owner', seen.status === 200 && seen.json?.youAreNewOwner === true)

  const ownerRole = await owner('POST', `/v1/workspace/users/${HRM}/roles`, { roleCode: 'OWNER' })
  check('exactly one owner: the Owner role can\'t be given on the Access screen', ownerRole.status >= 400 && JSON.stringify(ownerRole.json).includes('OWNER_BY_TRANSFER_ONLY'), `${ownerRole.status} ${JSON.stringify(ownerRole.json).slice(0, 120)}`)

  // Web: the person offered sees Accept on the Ownership page.
  browser = await chromium.launch()
  for (const [w, label] of [[1440, 'desktop'], [390, 'phone']]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } })
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.locator('input[type=email]').waitFor({ timeout: 90000 })
    await page.locator('input[type=email]').fill('hrm@unifiedtree.demo')
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
    const later = page.getByRole('button', { name: 'Continue without checking in' })
    await later.waitFor({ timeout: 4000 }).catch(() => {})
    if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
    await page.goto(base + '/business/ownership', { waitUntil: 'domcontentloaded', timeout: 90000 })
    const accept = page.getByRole('button', { name: 'Accept and become the owner' })
    await accept.waitFor({ timeout: 30000 }).catch(() => {})
    check(`web ${label}: hrm@ sees "Accept and become the owner"`, await accept.isVisible().catch(() => false))
    await page.screenshot({ path: `${shots}/chakri-ownership-offer-${label}.png`, fullPage: true })
    await page.close()
  }

  const accepted = await hrm('POST', `/v1/workspace/ownership-transfer/${transferId}/accept`)
  check('accept: TRANSITION', accepted.status === 200 && accepted.json?.status === 'TRANSITION', `${accepted.status} ${JSON.stringify(accepted.json).slice(0, 120)}`)
  check('hrm@ now holds OWNER and SUPER_ADMIN', /OWNER/.test(roles(HRM)) && /SUPER_ADMIN/.test(roles(HRM)), roles(HRM))
  check('owner@ holds ADMIN and no longer OWNER', /(^|,)ADMIN(,|$)/.test(roles(OWNER)) && !/(^|,)OWNER(,|$)/.test(roles(OWNER)), roles(OWNER))
  check('the business\'s contact email is now hrm@', sql(`select contact_email from platform.tenants where id='${tenant}'`) === 'hrm@unifiedtree.demo')
  const stale = await owner('GET', '/v1/workspace/ownership-transfer')
  check('owner@\'s old session is signed out', stale.status === 401, String(stale.status))

  const hrm2 = await as('hrm@unifiedtree.demo')
  const ended = await hrm2('POST', `/v1/workspace/ownership-transfer/${transferId}/end-transition`)
  check('the new owner ends the handover', ended.status === 204, String(ended.status))
  check('owner@ keeps only their employee access (no ADMIN)', !/(^|,)ADMIN(,|$)/.test(roles(OWNER)) && /EMPLOYEE/.test(roles(OWNER)), roles(OWNER))
  check('the transfer is COMPLETED', sql(`select status from platform.ownership_transfers where id='${transferId}'`) === 'COMPLETED')
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  // Put the demo business back as it was.
  const restore = (id, list) => {
    sql(`delete from rbac.user_roles where tenant_id='${tenant}' and user_id='${id}'`)
    for (const code of list ? list.split(',') : []) {
      sql(`insert into rbac.user_roles (tenant_id, user_id, role_id, granted_at) select '${tenant}', '${id}', id, now() from rbac.roles where code='${code}' and tenant_id is null on conflict do nothing`)
    }
  }
  restore(OWNER, before.owner)
  restore(HRM, before.hrm)
  sql(`update auth.user_credentials set is_active = true where id in ('${OWNER}', '${HRM}')`)
  sql(`update platform.tenants set contact_email = ${before.contact ? `'${before.contact}'` : 'null'} where id='${tenant}'`)
  if (transferId) sql(`delete from platform.ownership_transfers where id='${transferId}'`)
  check('cleanup: roles and contact are as before', roles(OWNER) === before.owner && roles(HRM) === before.hrm
    && sql(`select coalesce(contact_email, '') from platform.tenants where id='${tenant}'`) === (before.contact || ''),
    `owner ${roles(OWNER)} / hrm ${roles(HRM)} (company grants before: ${before.hrmCompanies})`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
