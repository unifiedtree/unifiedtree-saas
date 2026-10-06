// Live check of employment types (owner decision 6 Oct 2026: "4–5 fixed defaults + companies can add their own;
// contract workers via agency"), against a running backend (with V143_103 and V143_104) and web app:
//   1. Defaults: every company has Full-time, Part-time, Contract, Intern and Consultant (V143_103 for the companies
//      that existed; a company made now gets them the first time its types are listed). They are marked builtIn and
//      can't be removed, renamed or switched off.
//   2. A company's own type: added, can't take a default's name or another type's name; people can be given it (Add
//      and edit); a code the company doesn't have is refused; switched off, it can't be given to new people but the
//      person who has it keeps it; the legacy /v1/employees read of that person works.
//   3. Contract still means a staffing agency: only a CONTRACT person can be linked to one.
//   4. The web: Classification Rules marks the five as Default; Add employee offers the company's own type and saves
//      its code; the directory shows it by name and its Type filter lists it. 1440 and 390 wide; no page errors.
// What it creates, and removes at the end: a company (with its seeded types), two employment types, a staffing agency
// and three people. On the slot's throw-away database (ut_w3_dev) they are deleted outright; anywhere else the people
// are exited, the agency ended, the types switched off and the company archived (they can't be deleted there).
//
//   node e2e/recovery/live-w3-w50-emptypes.mjs
//   env: RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD
/* global process, console, fetch, URL, localStorage */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const throwaway = db === 'ut_w3_dev'
const DEFAULTS = ['CONSULTANT', 'CONTRACT', 'FULL_TIME', 'INTERN', 'PART_TIME']

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body !== undefined ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

const browser = await chromium.launch({ headless: true })
async function signIn(email, { width = 1440, height = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* none */ } })
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(2500)
  // The web check-in prompt (face) can cover the page on a phone-width window; this test isn't about it.
  const skip = page.getByRole('button', { name: 'Continue without checking in' })
  if (await skip.count()) await skip.first().click().catch(() => {})
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(900)
  const skip = page.getByRole('button', { name: 'Continue without checking in' })
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500) }
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/w50-emptypes-${name}.png` })

const stamp = Date.now().toString().slice(-6)
const CODE = `W50AP${stamp}`, NAME = `W50 Apprentice ${stamp}`
let owner, reader, newCoId = null, typeId = null, type2Id = null, agencyId = null
const people = []
const person = (first, employmentType, extra = {}) => ({ companyId: company, firstName: first, lastName: `W50 ${stamp}`, email: `w50.${first.toLowerCase()}.${stamp}@unifiedtree.demo`, employmentType, roleCode: 'EMPLOYEE', ...extra })

try {
  owner = await login('owner@unifiedtree.demo')
  reader = await login('reader@unifiedtree.demo')

  // ── 1. defaults ──
  const missing = sql(`select count(*) from org.companies c cross join (values ${DEFAULTS.map((d) => `('${d}')`).join(',')}) d(code) where not exists (select 1 from org.employment_types t where t.company_id=c.id and upper(trim(t.code))=d.code)`)
  check('V143_103: no company in any workspace is missing a default', missing === '0', missing)
  check('V143_104: the five-codes-only check on hrms.employees is gone', sql(`select count(*) from pg_constraint where conrelid='hrms.employees'::regclass and conname='ck_employees_employment_type'`) === '0')
  const list = await owner(`/v1/hrms/employment-types?companyId=${company}`)
  const codes = (list.json || []).map((t) => t.code).sort()
  check('the demo company lists the five defaults', list.status === 200 && DEFAULTS.every((c) => codes.includes(c)), JSON.stringify(codes))
  check('…each marked builtIn', DEFAULTS.every((c) => (list.json || []).find((t) => t.code === c)?.builtIn === true))
  const co = await owner('/v1/hrms/companies', 'POST', { name: `W50 Types Co ${stamp}` })
  newCoId = co.json?.id
  check('fixture: a new company', co.status === 201 && !!newCoId, `${co.status} ${JSON.stringify(co.json)}`)
  const fresh = await owner(`/v1/hrms/employment-types?companyId=${newCoId}`)
  check('a company made now gets the five defaults the first time its types are listed',
    fresh.status === 200 && JSON.stringify((fresh.json || []).map((t) => t.code).sort()) === JSON.stringify(DEFAULTS), JSON.stringify(fresh.json))
  await owner(`/v1/hrms/employment-types?companyId=${newCoId}`)
  check('…and listing again adds nothing (idempotent)', sql(`select count(*) from org.employment_types where company_id='${newCoId}'`) === '5')
  const full = (list.json || []).find((t) => t.code === 'FULL_TIME')
  const del = await owner(`/v1/hrms/employment-types/${full.id}`, 'DELETE')
  check('a default can’t be removed (422)', del.status === 422, `${del.status} ${JSON.stringify(del.json)}`)
  const ren = await owner(`/v1/hrms/employment-types/${full.id}`, 'PUT', { ...full, name: 'Permanent' })
  check('…or renamed (422)', ren.status === 422, String(ren.status))
  const off = await owner(`/v1/hrms/employment-types/${full.id}`, 'PUT', { ...full, active: false })
  check('…or switched off (422)', off.status === 422, String(off.status))
  check('…and is unchanged', sql(`select name || '|' || is_active from org.employment_types where id='${full.id}'`) === `${full.name}|true`)

  // ── 2. a company's own type ──
  const mk = await owner('/v1/hrms/employment-types', 'POST', { companyId: company, name: NAME, code: CODE.toLowerCase(), payrollEligible: true, active: true })
  typeId = mk.json?.id
  check('a company type is added (code upper-cased, not builtIn)', mk.status === 201 && mk.json?.code === CODE && mk.json?.builtIn === false, `${mk.status} ${JSON.stringify(mk.json)}`)
  const byReader = await reader('/v1/hrms/employment-types', 'POST', { companyId: company, name: `R ${stamp}`, code: `R${stamp}` })
  check('an employee can’t add one (403)', byReader.status === 403, String(byReader.status))
  const stdName = await owner('/v1/hrms/employment-types', 'POST', { companyId: company, name: 'Part time', code: `PT${stamp}` })
  check('a company type can’t take a default’s name (422)', stdName.status === 422, `${stdName.status} ${JSON.stringify(stdName.json)}`)
  const dup = await owner('/v1/hrms/employment-types', 'POST', { companyId: company, name: NAME.toUpperCase(), code: `D${stamp}` })
  check('…or another type’s name (422)', dup.status === 422, String(dup.status))
  const mk2 = await owner('/v1/hrms/employment-types', 'POST', { companyId: company, name: `W50 Seasonal ${stamp}`, code: `W50SE${stamp}`, payrollEligible: true, active: true })
  type2Id = mk2.json?.id
  check('fixture: a second company type', mk2.status === 201, String(mk2.status))

  const a = await owner('/v1/hrms/employees', 'POST', person('Appr', CODE.toLowerCase()))
  if (a.json?.id) people.push(a.json.id)
  check('a person can be given the company’s own type', a.status === 201 && a.json?.employmentType === CODE, `${a.status} ${JSON.stringify(a.json)}`)
  check('…stored as its code', !!a.json?.id && sql(`select employment_type from hrms.employees where id='${a.json.id}'`) === CODE)
  const bad = await owner('/v1/hrms/employees', 'POST', person('Bad', 'GIG_WORKER'))
  if (bad.json?.id) people.push(bad.json.id)
  check('a code the company doesn’t have is refused (422 EMPLOYMENT_TYPE_UNKNOWN)', bad.status === 422 && /EMPLOYMENT_TYPE_UNKNOWN/.test(JSON.stringify(bad.json)), `${bad.status} ${JSON.stringify(bad.json)}`)
  const other = await owner('/v1/hrms/employees', 'POST', { ...person('Other', CODE), companyId: newCoId })
  if (other.json?.id) people.push(other.json.id)
  check('…as is another company’s type (422)', other.status === 422, `${other.status} ${JSON.stringify(other.json)}`)
  const pt = await owner(`/v1/hrms/employees/${a.json.id}`, 'PUT', { employmentType: 'PART_TIME' })
  check('the defaults work as before (edit to Part-time)', pt.status === 200 && pt.json?.employmentType === 'PART_TIME', `${pt.status}`)
  const back = await owner(`/v1/hrms/employees/${a.json.id}`, 'PUT', { employmentType: `W50SE${stamp}` })
  check('an edit can give a company type', back.status === 200 && back.json?.employmentType === `W50SE${stamp}`, `${back.status} ${JSON.stringify(back.json)}`)
  const offOwn = await owner(`/v1/hrms/employment-types/${type2Id}`, 'DELETE')
  check('a company type can be switched off', offOwn.status === 204, String(offOwn.status))
  const after = await owner(`/v1/hrms/employment-types?companyId=${company}`)
  const all = await owner(`/v1/hrms/employment-types?companyId=${company}&includeInactive=true`)
  check('…then it is gone from the pickers’ list, kept in Master’s (includeInactive)',
    !(after.json || []).some((t) => t.id === type2Id) && (all.json || []).some((t) => t.id === type2Id && t.active === false))
  const keep = await owner(`/v1/hrms/employees/${a.json.id}`, 'PUT', { employmentType: `W50SE${stamp}`, jobTitle: undefined, phone: '9845012345' })
  check('the person who has the switched-off type keeps it when edited', keep.status === 200 && sql(`select employment_type from hrms.employees where id='${a.json.id}'`) === `W50SE${stamp}`, `${keep.status} ${JSON.stringify(keep.json)}`)
  const newOff = await owner('/v1/hrms/employees', 'POST', person('Late', `W50SE${stamp}`))
  if (newOff.json?.id) people.push(newOff.json.id)
  check('…but it can’t be given to someone new (422)', newOff.status === 422, String(newOff.status))
  const legacy = await owner(`/v1/employees/${a.json.id}`)
  check('the legacy /v1/employees read of that person works', legacy.status === 200 && legacy.json?.employmentType === `W50SE${stamp}`, `${legacy.status} ${JSON.stringify(legacy.json)?.slice(0, 200)}`)
  const legacyPut = await owner(`/v1/employees/${a.json.id}`, 'PUT', { firstName: 'Appr', employmentType: `W50SE${stamp}` })
  check('…and its save (the phone’s staff profile) sends the type back without a 400', legacyPut.status === 200, `${legacyPut.status} ${JSON.stringify(legacyPut.json)?.slice(0, 200)}`)
  const dir = await owner(`/v1/hrms/employees?companyId=${company}&size=500`)
  check('the directory lists them', dir.status === 200 && JSON.stringify(dir.json).includes(a.json.id), String(dir.status))
  const recode = await owner(`/v1/hrms/employment-types/${type2Id}`, 'PUT', { companyId: company, name: `W50 Seasonal ${stamp}`, code: `X${stamp}`, payrollEligible: true, active: false })
  check('a code people hold can’t change (422)', recode.status === 422, `${recode.status} ${JSON.stringify(recode.json)}`)

  // ── 3. contract = staffing agency ──
  const ag = await owner('/v1/hrms/contractors', 'POST', { companyId: company, agencyName: `W50 Staffing ${stamp}`, serviceType: 'Security', contactPersonName: 'R. Iyer' })
  agencyId = ag.json?.id
  check('fixture: a staffing agency', (ag.status === 200 || ag.status === 201) && !!agencyId, `${ag.status} ${JSON.stringify(ag.json)}`)
  const notContract = await owner(`/v1/hrms/contractors/${agencyId}/workers/${a.json.id}`, 'PUT')
  check('someone with a company type can’t be linked to an agency (only Contract)', notContract.status >= 400 && notContract.status < 500, String(notContract.status))
  const c = await owner('/v1/hrms/employees', 'POST', person('Contr', 'CONTRACT'))
  if (c.json?.id) people.push(c.json.id)
  const link = await owner(`/v1/hrms/contractors/${agencyId}/workers/${c.json?.id}`, 'PUT')
  check('a Contract person is linked to the agency', c.status === 201 && link.status < 300, `${c.status} ${link.status}`)

  // ── 4. the web ──
  for (const v of [{ width: 1440, tag: '1440' }, { width: 390, tag: '390' }]) {
    const o = await signIn('owner@unifiedtree.demo', { width: v.width, height: v.width < 600 ? 844 : 1000 })
    await o.page.goto(base + '/hrms/master/classifications')
    await settle(o.page)
    const rows = o.page.locator('tbody tr')
    const text = await o.page.locator('body').innerText()
    const defRows = await rows.filter({ hasText: 'Default' }).count()
    check(`${v.tag}: Classification Rules marks the five defaults "Default"`, defRows >= 5, `${defRows} rows; ${text.slice(0, 200)}`)
    check(`${v.tag}: the company’s own type is listed, without the mark`, (await rows.filter({ hasText: NAME }).count()) === 1 && (await rows.filter({ hasText: NAME }).filter({ hasText: 'Default' }).count()) === 0)
    check(`${v.tag}: the switched-off company type is listed too`, (await rows.filter({ hasText: `W50 Seasonal ${stamp}` }).count()) === 1)
    await shot(o.page, `classifications-${v.tag}`)

    if (v.tag === '1440') {
      // Add employee → the company's own type, saved by its code
      await o.page.goto(base + '/hrms/employees?add=1')
      await settle(o.page)
      const form = o.page.getByRole('dialog', { name: 'Add employee' })
      await form.waitFor({ timeout: 20_000 })
      await form.locator('[data-field="type"] button.uko-dd-trigger').first().click()
      const opts = await o.page.getByRole('option').allInnerTexts()
      check('1440: Add employee’s types are the five defaults and the company’s own',
        ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant', NAME].every((x) => opts.some((t) => t.includes(x))) && !opts.some((t) => t.includes(`W50 Seasonal ${stamp}`)), opts.join(', '))
      await o.page.getByRole('option', { name: NAME }).first().click()
      check('1440: a company type doesn’t ask for a staffing agency', await form.locator('[data-field="agency"]').count() === 0)
      await shot(o.page, `add-employee-type-${v.tag}`)
      await form.getByLabel('First name').fill('Web')
      await form.getByLabel('Last name').fill(`W50 ${stamp}`)
      await form.getByLabel('Work email').fill(`w50.web.${stamp}@unifiedtree.demo`)
      const pick = async (field, re) => { await form.locator(`[data-field="${field}"] button.uko-dd-trigger`).first().click(); await o.page.getByRole('option', { name: re }).first().click() }
      await pick('branch', /./)
      await pick('dept', /./)
      await pick('desig', /./)
      await form.getByRole('button', { name: 'Add employee' }).click()
      await form.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
      await o.page.waitForTimeout(3000)
      const webId = sql(`select id from hrms.employees where lower(email)='w50.web.${stamp}@unifiedtree.demo'`)
      if (webId) people.push(webId)
      check('1440: the person is saved with the company type’s code', !!webId && sql(`select employment_type from hrms.employees where id='${webId}'`) === CODE)

      // Directory: shown by name; the Type filter lists it
      await o.page.goto(base + '/hrms/employees')
      await settle(o.page)
      await o.page.getByRole('button', { name: /All types/ }).first().click()
      const typeOpts = await o.page.getByRole('option').allInnerTexts()
      check('1440: the Type filter lists the company type', typeOpts.some((t) => t.includes(NAME)), typeOpts.join(', '))
      await o.page.getByRole('option', { name: NAME }).first().click()
      await settle(o.page)
      const body = await o.page.locator('table').first().innerText().catch(() => '')
      check('1440: …and narrows to the people who have it, shown by its name', body.includes(`Web W50 ${stamp}`) && body.includes(NAME), body.slice(0, 300))
      await shot(o.page, `directory-type-${v.tag}`)
    }
    check(`${v.tag}: no page errors`, o.errors.length === 0, o.errors.join(' | '))
    check(`${v.tag}: no failed API calls`, o.failedApi.length === 0, o.failedApi.join(' | '))
    await o.ctx.close()
  }
} catch (e) {
  check('run finished without an exception', false, String(e).split('\n')[0])
} finally {
  // ── clean up ──
  try {
    if (owner && agencyId) for (const id of people) await owner(`/v1/hrms/contractors/${agencyId}/workers/${id}`, 'DELETE')
    let gone = false
    if (throwaway) {
      try {
        for (const id of people) sql(`delete from auth.user_credentials where employee_id='${id}'; delete from hrms.employees where id='${id}'`)
        if (agencyId) sql(`delete from hrms.contractors where id='${agencyId}'`)
        sql(`delete from org.employment_types where id in (${[typeId, type2Id].filter(Boolean).map((x) => `'${x}'`).join(',') || 'null'})`)
        if (newCoId) sql(`delete from org.employment_types where company_id='${newCoId}'; delete from org.companies where id='${newCoId}'`)
        gone = true
      } catch (e) { console.log('cleanup (sql):', String(e).split('\n')[0]); gone = false }
    }
    if (!gone && owner) {
      for (const id of people) await owner(`/v1/hrms/employees/${id}/exit?lastWorkingDay=${new Date().toISOString().slice(0, 10)}`, 'POST')
      if (agencyId) await owner(`/v1/hrms/contractors/${agencyId}`, 'DELETE')
      for (const id of [typeId, type2Id].filter(Boolean)) await owner(`/v1/hrms/employment-types/${id}`, 'DELETE')
      if (newCoId) await owner(`/v1/hrms/companies/${newCoId}`, 'DELETE')
    }
    check('cleanup: nothing the test made is left', !throwaway || (sql(`select count(*) from hrms.employees where lower(email) like 'w50.%.${stamp}@unifiedtree.demo'`) === '0'
      && sql(`select count(*) from org.employment_types where code like 'W50%${stamp}'`) === '0' && sql(`select count(*) from org.companies where name='W50 Types Co ${stamp}'`) === '0'))
    console.log(gone ? 'cleanup: test records deleted' : 'cleanup: people exited, agency ended, types switched off, company archived')
  } catch (e) {
    check('cleanup finished', false, String(e).split('\n')[0])
  }
  await browser.close()
}
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
