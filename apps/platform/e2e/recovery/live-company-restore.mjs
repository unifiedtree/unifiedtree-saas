// Live check for fix/company-restore: an archived company can be found again and
// restored, and archiving is refused for the last active company and for one
// people still work at.
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3070 node e2e/recovery/live-company-restore.mjs
//
// What it proves, against the local backend and database:
//  - API: GET /v1/hrms/companies is unchanged (active companies only);
//    ?includeArchived=true adds archived ones with active:false; POST
//    /v1/hrms/companies/{id}/restore brings one back and does nothing to an
//    active one; each real archive or restore writes one audit row.
//  - Owner, Companies & Branches (1440 wide): a temporary company is archived
//    from its card (the dialog says where to find it again), shows under the
//    "Inactive" filter as an archived company with Restore; Restore asks first,
//    then the company is back in the company picker, in Master → Branches'
//    company picker and in Employee Master's company count.
//  - Archiving the demo company is refused in plain words while people work
//    there (tooltip + a dialog with no Archive button, 422 COMPANY_HAS_EMPLOYEES
//    from the API), and once it is the only active company with
//    LAST_ACTIVE_COMPANY. The demo company stays active throughout.
//  - reader@ and mgr@: restore is 403 (no org.company.write); includeArchived
//    follows org.company.read, like the branch list (403 without it).
//  - Phone (390 wide): the Inactive view lists the archived company, Restore
//    works, and the refusal dialog reads well.
// Screenshots go to W3_SHOTS (company-*.png). The temporary company is removed
// at the end: only the id this test created, and only if nothing references it.
/* global process, console, fetch, Buffer, document, window */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
const tempName = `QA Restore Co ${tag}`
let tempId = null
let where = 'start', lastPage = null // for the failure report
const at = (name, page) => { where = name; if (page) lastPage = page; console.log(`..  ${name}`) }
mkdirSync(shots, { recursive: true })

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  // What the server will check: the signed-in person's permissions (login response, else the token's claim).
  let perms = Array.isArray(d.permissions) ? d.permissions : []
  if (!perms.length) try { perms = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] } catch { /* opaque token */ }
  call.perms = new Set(perms)
  return call
}

const browser = await chromium.launch()
async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  lastPage = page
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  return { page, context, errors, failed, settle }
}
const aside = (page) => page.locator('aside[aria-label="Companies"]')
// The confirm modal (the company picker's popup is also a dialog, but not a modal one).
const dialog = (page) => page.locator('[role=dialog][aria-modal=true]')
const toastSeen = (page, text) => page.getByText(text).first().waitFor({ timeout: 20000 }).then(() => true, () => false)
/** Open the company picker and search; returns the matching option (count 0 when not listed). */
async function searchPicker(page, name) {
  const btn = page.locator('button[aria-labelledby="co-pick-label"]')
  if (await btn.getAttribute('aria-expanded') !== 'true') await btn.click()
  await page.getByLabel('Search companies').fill(name)
  return page.getByRole('option').filter({ hasText: name })
}
async function pickCompany(page, name) {
  at(`pick ${name}`)
  const opt = await searchPicker(page, name)
  await opt.first().click()
  await aside(page).locator('h2').filter({ hasText: name }).first().waitFor({ timeout: 15000 })
}
async function pickerLists(page, name) {
  const opt = await searchPicker(page, name)
  const n = await opt.count()
  await page.keyboard.press('Escape')
  return n > 0
}
/** The Branches panel's status filter. */
async function chooseStatus(page, label) {
  at(`status filter ${label}`)
  await page.getByRole('button', { name: /^(All statuses|Active|Inactive)$/ }).first().click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await page.waitForTimeout(300)
}
const archivedCard = (page, name) => page.locator('article').filter({ has: page.locator('h4', { hasText: name }) })
const peopleMsg = (n, name) => `${n === 1 ? '1 person still works' : `${n} people still work`} at ${name}. Move them to another company or record their exit first.`
const ONLY_MSG = 'This is the only active company. Add or restore another company before archiving this one.'
const auditActions = () => sql(`select coalesce(string_agg(action, ',' order by occurred_at), '') from audit.events where entity_id='${tempId}' and module='org' and entity_type='COMPANY'`)

try {
  // ── fixtures ──
  at('fixtures')
  const owner = await apiLogin('owner@unifiedtree.demo')
  const first = await owner('GET', '/v1/hrms/companies')
  check('API: the company list loads', first.status === 200 && Array.isArray(first.json), `status ${first.status}`)
  const demo = (first.json || []).find((c) => c.employeeCount > 0)
  check('fixture: an active company people work at', !!demo, demo ? `${demo.name}: ${demo.employeeCount} people` : 'none')
  if (!demo) throw new Error('no company with people to test the refusal on')
  const made = await owner('POST', '/v1/hrms/companies', { name: tempName, industry: 'Quality checks', country: 'India', currency: 'INR' })
  tempId = made.json && made.json.id
  check('API: temporary company created', made.status === 201 && !!tempId, `status ${made.status}`)
  if (!tempId) throw new Error('could not create the temporary company')

  // ── API: restore on an active company changes nothing; includeArchived on an active one ──
  at('API basics')
  const noop = await owner('POST', `/v1/hrms/companies/${tempId}/restore`)
  check('API: restoring an active company is a no-op (200, still active)', noop.status === 200 && noop.json && noop.json.active === true && noop.json.id === tempId, `status ${noop.status}`)
  check('API: … and writes no audit row', auditActions() === '')
  const missing = await owner('POST', '/v1/hrms/companies/00000000-0000-0000-0000-00000000abcd/restore')
  check('API: restoring an unknown company is 404', missing.status === 404, `status ${missing.status}`)

  // ── 1. desktop: archive from the card ──
  {
    at('desktop archive')
    const o = await signIn('owner@unifiedtree.demo')
    const { page, settle } = o
    await page.goto(base + '/hrms/companies'); await settle()
    await pickCompany(page, tempName)
    await aside(page).getByRole('button', { name: /Archive/ }).click()
    const dlg = dialog(page)
    await dlg.waitFor()
    check('Archive asks first and says where to find it again', await dlg.getByText(`Archive ${tempName}?`).count() > 0 && await dlg.getByText(/choose Inactive in the status filter/).count() > 0)
    await dlg.getByRole('button', { name: 'Archive', exact: true }).click()
    check('toast: Company archived', await toastSeen(page, 'Company archived'))
    await settle()
    check('the archived company leaves the company picker', !(await pickerLists(page, tempName)))
    const plain = await owner('GET', '/v1/hrms/companies')
    check('API: the default list leaves it out (as before)', plain.status === 200 && !plain.json.some((c) => c.id === tempId))
    const all = await owner('GET', '/v1/hrms/companies?includeArchived=true')
    check('API: includeArchived lists it as inactive, and the active ones', all.status === 200 && all.json.some((c) => c.id === tempId && c.active === false) && all.json.some((c) => c.id === demo.id && c.active === true))

    // ── 2. find it under Inactive and restore it ──
    at('desktop restore')
    await chooseStatus(page, 'Inactive')
    const card = archivedCard(page, tempName)
    await card.first().waitFor({ timeout: 15000 }).catch(() => {})
    check('Inactive shows "Archived companies" with it, marked Inactive', await page.getByRole('heading', { name: /Archived companies/ }).count() > 0 && await card.count() === 1 && await card.getByText('Inactive', { exact: true }).count() > 0)
    await page.getByRole('heading', { name: /Archived companies/ }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shots}/company-archived-1440.png`, fullPage: true })
    // Table view lists it too, with Restore.
    await page.getByRole('button', { name: /Table/ }).click()
    await page.waitForTimeout(300)
    check('table view lists it with Restore', await page.locator('tr').filter({ hasText: tempName }).getByRole('button', { name: 'Restore' }).count() === 1)
    await page.getByRole('button', { name: /Cards/ }).click()
    await page.waitForTimeout(300)
    await card.getByRole('button', { name: 'Restore' }).click()
    const rd = dialog(page)
    await rd.waitFor()
    check('Restore asks first', await rd.getByText(`Restore ${tempName}?`).count() > 0 && await rd.getByText('It shows in lists and pickers again.').count() > 0)
    await rd.getByRole('button', { name: 'Restore', exact: true }).click()
    check('toast: restored', await toastSeen(page, `${tempName} restored`))
    await settle()
    check('it leaves the archived list', await archivedCard(page, tempName).count() === 0)
    check('it is back in the company picker', await pickerLists(page, tempName))
    const back = await owner('GET', '/v1/hrms/companies')
    const nActive = back.json.length
    check('API: it is back in the default list', back.json.some((c) => c.id === tempId && c.active === true))

    // ── 3. company pickers elsewhere ──
    at('pickers elsewhere')
    await page.goto(base + '/hrms/master/branches'); await settle()
    await page.locator('.ddb').filter({ hasText: 'All companies' }).first().click()
    const opt = page.locator('#utm-portal .pop .opt').filter({ hasText: tempName })
    await opt.first().waitFor({ timeout: 10000 }).catch(() => {})
    check('Master → Branches company picker lists it again', await opt.count() > 0)
    await page.keyboard.press('Escape')
    await page.goto(base + '/hrms/employees'); await settle()
    check(`Employee Master counts it (${nActive} companies)`, await page.getByText(new RegExp(`across ${nActive} ${nActive === 1 ? 'company' : 'companies'}`)).count() > 0)

    // ── 4. the demo company: people still work there ──
    at('refusal: people')
    await page.goto(base + '/hrms/companies'); await settle()
    await pickCompany(page, demo.name)
    const n = demo.employeeCount
    const btn = aside(page).getByRole('button', { name: /Archive/ })
    const tip = await btn.getAttribute('data-tip')
    check('Archive tooltip says what to do first', tip === peopleMsg(n, demo.name), tip)
    await btn.click()
    const bd = dialog(page)
    await bd.waitFor()
    check('the dialog explains in plain words and offers no Archive', await bd.getByText('Can’t archive yet').count() > 0 && await bd.getByText(peopleMsg(n, demo.name)).count() > 0 && await bd.getByRole('button', { name: 'Archive' }).count() === 0)
    await page.screenshot({ path: `${shots}/company-refusal-1440.png` })
    await bd.getByRole('button', { name: 'OK', exact: true }).click()
    await bd.waitFor({ state: 'hidden' }).catch(() => {})
    const refused = await owner('DELETE', `/v1/hrms/companies/${demo.id}`)
    if (refused.status === 204) await owner('POST', `/v1/hrms/companies/${demo.id}/restore`) // guard broken: put it back
    check('API: refused, 422 COMPANY_HAS_EMPLOYEES, same words', refused.status === 422 && refused.json && refused.json.errorCode === 'COMPANY_HAS_EMPLOYEES' && refused.json.message === peopleMsg(n, demo.name), `${refused.status} ${JSON.stringify(refused.json).slice(0, 200)}`)
    check('the demo company is still active', sql(`select is_active from org.companies where id='${demo.id}'`) === 't')

    // ── 5. archive the temporary company again; now the demo company may be the only one ──
    at('archive again')
    await pickCompany(page, tempName)
    await aside(page).getByRole('button', { name: /Archive/ }).click()
    await dialog(page).getByRole('button', { name: 'Archive', exact: true }).click()
    check('archived again from the card', await toastSeen(page, 'Company archived'))
    await settle()
    const left = (await owner('GET', '/v1/hrms/companies')).json
    if (left.length === 1 && left[0].id === demo.id) {
      at('refusal: only company')
      await page.goto(base + '/hrms/companies'); await settle()
      await aside(page).getByRole('button', { name: /Archive/ }).click()
      const ld = dialog(page)
      await ld.waitFor()
      check('only active company: the dialog says add or restore another first', await ld.getByText(ONLY_MSG).count() > 0 && await ld.getByRole('button', { name: 'Archive' }).count() === 0)
      await page.screenshot({ path: `${shots}/company-refusal-last-1440.png` })
      await ld.getByRole('button', { name: 'OK', exact: true }).click()
      const last = await owner('DELETE', `/v1/hrms/companies/${demo.id}`)
      if (last.status === 204) await owner('POST', `/v1/hrms/companies/${demo.id}/restore`)
      check('API: refused, 422 LAST_ACTIVE_COMPANY', last.status === 422 && last.json && last.json.errorCode === 'LAST_ACTIVE_COMPANY' && last.json.message === ONLY_MSG, `${last.status} ${JSON.stringify(last.json).slice(0, 200)}`)
      check('the demo company is still active', sql(`select is_active from org.companies where id='${demo.id}'`) === 't')
    } else console.log(`..  ${left.length} active companies: the only-company refusal can't be reached here`)
    check('Desktop: no page errors', !o.errors.length, o.errors[0] || '')
    // The refused archives are the only expected 4xx.
    const unexpected = o.failed.filter((f) => !/^422 DELETE \/v1\/hrms\/companies\//.test(f))
    check('Desktop: no failed API calls', !unexpected.length, unexpected.join(' | '))
    await o.context.close()
  }

  // ── 6. who may restore / list archived ──
  for (const email of ['reader@unifiedtree.demo', 'mgr@unifiedtree.demo']) {
    at(`access ${email}`)
    const who = email.split('@')[0]
    const call = await apiLogin(email)
    const r = await call('POST', `/v1/hrms/companies/${tempId}/restore`)
    check(`${who}: restore is 403 (holds org.company.write: ${call.perms.has('org.company.write')})`, !call.perms.has('org.company.write') && r.status === 403, `status ${r.status}`)
    const l = await call('GET', '/v1/hrms/companies?includeArchived=true')
    const canRead = call.perms.has('org.company.read')
    check(`${who}: includeArchived is ${canRead ? '200' : '403'} (holds org.company.read: ${canRead})`, canRead ? l.status === 200 && l.json.some((c) => c.id === tempId && c.active === false) : l.status === 403, `status ${l.status}`)
  }
  check('still archived after the refused restores', sql(`select is_active from org.companies where id='${tempId}'`) === 'f')

  // ── 7. phone: the Inactive view and Restore ──
  {
    at('phone')
    const m = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    const { page, settle } = m
    await page.goto(base + '/hrms/companies'); await settle()
    await chooseStatus(page, 'Inactive')
    const card = archivedCard(page, tempName)
    await card.first().waitFor({ timeout: 15000 }).catch(() => {})
    check('Phone: the archived company shows under Inactive', await card.count() === 1)
    check('Phone: no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shots}/company-archived-390.png`, fullPage: true })
    await card.getByRole('button', { name: 'Restore' }).click()
    const rd = dialog(page)
    await rd.waitFor()
    await rd.getByRole('button', { name: 'Restore', exact: true }).click()
    check('Phone: Restore works', await toastSeen(page, `${tempName} restored`))
    await settle()
    check('Phone: it is active again', sql(`select is_active from org.companies where id='${tempId}'`) === 't')
    // The refusal dialog on a phone (the demo company, people still work there).
    await page.evaluate(() => window.scrollTo(0, 0))
    await pickCompany(page, demo.name)
    await aside(page).getByRole('button', { name: /Archive/ }).click()
    const bd = dialog(page)
    await bd.waitFor()
    check('Phone: the refusal reads in full', await bd.getByText(peopleMsg(demo.employeeCount, demo.name)).count() > 0)
    await page.screenshot({ path: `${shots}/company-refusal-390.png` })
    await bd.getByRole('button', { name: 'OK', exact: true }).click()
    check('Phone: no page errors', !m.errors.length, m.errors[0] || '')
    check('Phone: no failed API calls', !m.failed.length, m.failed.join(' | '))
    await m.context.close()
    const again = await owner('DELETE', `/v1/hrms/companies/${tempId}`)
    check('API: archive (no people, not the last company) is 204', again.status === 204, `status ${again.status}`)
  }

  // ── 8. the audit trail: one row per real change, none for no-ops or refusals ──
  check('audit: archive, restore, archive, restore, archive', auditActions() === 'ARCHIVE,RESTORE,ARCHIVE,RESTORE,ARCHIVE', auditActions())
  check('audit: rows name who did it', sql(`select count(*) from audit.events where entity_id='${tempId}' and module='org' and actor_user_id is null`) === '0')
  check('audit: nothing written for the demo company', sql(`select count(*) from audit.events where entity_id='${demo.id}' and module='org'`) === '0')
} catch (e) {
  check('test ran to the end', false, `at "${where}": ${String(e && e.message || e).split('\n').slice(0, 14).join(' | ')}`)
  try { await lastPage?.screenshot({ path: `${shots}/company-fail.png`, fullPage: true }) } catch { /* page gone */ }
} finally {
  await browser.close()
  // Remove the temporary company: only the id this test created (same name, this tenant), and only
  // when no row anywhere points at it (every company_id column). Its own audit rows go with it.
  if (tempId) {
    try {
      const mine = sql(`select count(*) from org.companies where id='${tempId}' and name=${lit(tempName)} and tenant_id='${tenant}'`) === '1'
      const tables = sql("select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')").split('\n').filter(Boolean)
      const refs = sql(tables.map((t) => `select '${t}' where exists (select 1 from ${t} where company_id='${tempId}')`).join(' union all ')).split('\n').filter(Boolean)
      if (mine && !refs.length) {
        sql(`delete from audit.events where entity_id='${tempId}' and module='org' and entity_type='COMPANY'`)
        const gone = sql(`with d as (delete from org.companies where id='${tempId}' and name=${lit(tempName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
        check('cleanup: temporary company removed', gone === '1')
      } else {
        check('cleanup: temporary company removed', false, mine ? `left archived — still referenced by ${refs.join(', ')}` : 'not the company this test made; left alone')
      }
    } catch (err) {
      check('cleanup: temporary company removed', false, String(err).split('\n')[0])
    }
  }
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
