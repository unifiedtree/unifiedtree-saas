// Live check for feat/payroll-settings-per-company (V143.105): payroll settings belong to a company.
//
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3160 node e2e/recovery/live-w3-w60-payrollco.mjs
//
// What it proves, against the local backend and database:
//  - The migration copied the workspace's settings to the demo company (same values).
//  - A second company (made here) starts on the workspace's settings, then gets its own: pay day the 5th
//    and PF the other way round, saved with ?companyId=. The demo company and the workspace row don't change.
//  - GET answers per company: by ?companyId=, by X-Company-Id, and an unknown company is refused.
//  - Permissions unchanged: reader@ can neither read nor save payroll settings.
//  - A DRAFT payroll run for the second company takes its pay date from that company's settings (the 5th),
//    not the workspace's. The run is never processed, locked or paid, and is removed at the end.
//  - Owner, 1440 wide: Payroll › Settings shows "Payroll settings · <company>" with that company's cycle;
//    switching company with the top bar's selector shows the other company's; a save on the second
//    company changes only its row. Phone (390 wide) shows the second company's heading. Screenshots:
//    W3_SHOTS/w60-*.png.
// Everything it creates (the company, its settings row, the draft run, their audit rows, the defaults a
// new company gets) is removed at the end: only what this test made, checked by id and name.
/* global process, console, fetch */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3160'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const tag = String(Date.now() % 1000000)
// Sorts after the demo company, so the demo company stays the first (default) one.
const coName = `zz QA Pay Settings Co ${tag}`
let coId = null, runId = null
let where = 'start', lastPage = null
const at = (name, page) => { where = name; if (page) lastPage = page; console.log(`..  ${name}`) }
mkdirSync(shots, { recursive: true })

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (method, path, body, headers = {}) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

const browser = await chromium.launch()
async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = [], failed = [], calls = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('request', (r) => { if (r.url().includes('/api/v1/')) calls.push({ co: r.headers()['x-company-id'] || '', method: r.method(), path: '/v1/' + r.url().split('/api/v1/')[1] }) })
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`)
  })
  await page.goto(base + '/login', { timeout: 180_000 }) // the first load compiles the app
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  lastPage = page
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
  const pastPrompt = async () => { const later = page.getByRole('button', { name: 'Continue without checking in' }); if (await later.isVisible().catch(() => false)) { await later.click(); await page.waitForTimeout(400) } }
  const open = async (path) => { at(`${email} → ${path}`, page); await page.goto(base + path); await settle(); await pastPrompt() }
  return { page, context, errors, failed, calls, settle, open }
}
const selector = (page) => page.locator('button.ut-cosel')
const seen = async (page, text, timeout = 20000) => page.getByText(text, { exact: false }).first().waitFor({ timeout }).then(() => true, () => false)
async function switchTo(page, name) {
  at(`switch to ${name}`, page)
  await selector(page).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(900)
}
const ord = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th') }
const row = (company) => sql(`select salary_processing_day||'|'||pf_enabled from payroll.company_settings where tenant_id='${tenant}' and company_id='${company}'`)
const workspaceRow = () => sql(`select salary_processing_day||'|'||pf_enabled from payroll.settings where tenant_id='${tenant}'`)

try {
  // ── fixtures ──
  at('fixtures')
  const owner = await apiLogin('owner@unifiedtree.demo')
  const list = await owner('GET', '/v1/hrms/companies')
  const demo = (list.json || [])[0]
  check('fixture: the demo workspace has one company', list.status === 200 && (list.json || []).length === 1, (list.json || []).map((c) => c.name).join(', '))
  if (!demo) throw new Error('no company')
  const ws = workspaceRow()
  const [wsDay, wsPf] = ws.split('|')
  check('migration: the demo company has its own row, a copy of the workspace row', row(demo.id) === ws, `company ${row(demo.id)} · workspace ${ws}`)

  const a0 = await owner('GET', `/v1/payroll/settings?companyId=${demo.id}`)
  check('GET ?companyId=<demo> answers the demo company’s settings', a0.status === 200 && String(a0.json?.salaryProcessingDay) === wsDay, `${a0.status} day ${a0.json?.salaryProcessingDay}`)
  const plain = await owner('GET', '/v1/payroll/settings')
  check('one company: GET without a company answers that company (as before)', plain.status === 200 && JSON.stringify(plain.json) === JSON.stringify(a0.json))

  // ── a second company ──
  at('second company')
  const made = await owner('POST', '/v1/hrms/companies', { name: coName, industry: 'Quality checks', country: 'India', currency: 'INR' })
  coId = made.json?.id || null
  check('a second company is made', (made.status === 201 || made.status === 200) && !!coId, `${made.status}`)
  if (!coId) throw new Error('company not made')

  const b0 = await owner('GET', `/v1/payroll/settings?companyId=${coId}`)
  check('a new company starts on the workspace’s settings', b0.status === 200 && String(b0.json?.salaryProcessingDay) === wsDay && String(b0.json?.pfEnabled) === wsPf, `${b0.status} day ${b0.json?.salaryProcessingDay}`)
  check('reading makes no row for it', row(coId) === '')

  const bDay = wsDay === '5' ? 6 : 5
  const bPf = wsPf !== 'true'
  const saved = await owner('PUT', `/v1/payroll/settings?companyId=${coId}`, { ...b0.json, salaryProcessingDay: bDay, pfEnabled: bPf })
  check('PUT ?companyId=<second> saves its settings', saved.status === 200 && saved.json?.salaryProcessingDay === bDay && saved.json?.pfEnabled === bPf, `${saved.status} ${JSON.stringify(saved.json)?.slice(0, 120)}`)
  check('…into its own row', row(coId) === `${bDay}|${bPf}`, row(coId))
  check('…and the demo company is unchanged', row(demo.id) === ws, row(demo.id))
  check('…and the workspace row is unchanged', workspaceRow() === ws, workspaceRow())

  const a1 = await owner('GET', `/v1/payroll/settings?companyId=${demo.id}`)
  const b1 = await owner('GET', `/v1/payroll/settings?companyId=${coId}`)
  check('the two companies now read different settings', a1.json?.salaryProcessingDay !== b1.json?.salaryProcessingDay && a1.json?.pfEnabled !== b1.json?.pfEnabled, `demo ${a1.json?.salaryProcessingDay}/${a1.json?.pfEnabled} · second ${b1.json?.salaryProcessingDay}/${b1.json?.pfEnabled}`)
  const byHeader = await owner('GET', '/v1/payroll/settings', undefined, { 'X-Company-Id': coId })
  check('X-Company-Id picks the company too', byHeader.status === 200 && byHeader.json?.salaryProcessingDay === bDay, `${byHeader.status} day ${byHeader.json?.salaryProcessingDay}`)
  const byHeaderA = await owner('GET', '/v1/payroll/settings', undefined, { 'X-Company-Id': demo.id })
  check('X-Company-Id = demo company answers the demo company’s', byHeaderA.status === 200 && String(byHeaderA.json?.salaryProcessingDay) === wsDay)
  const stranger = await owner('GET', `/v1/payroll/settings?companyId=${randomUUID()}`)
  check('an unknown company is refused', stranger.status === 403 || stranger.status === 404, `${stranger.status} ${stranger.json?.errorCode || ''}`)

  // ── permissions unchanged ──
  const reader = await apiLogin('reader@unifiedtree.demo')
  const rGet = await reader('GET', `/v1/payroll/settings?companyId=${coId}`)
  const rPut = await reader('PUT', `/v1/payroll/settings?companyId=${coId}`, { salaryProcessingDay: 9 })
  check('reader@ cannot read or save payroll settings (as before)', rGet.status === 403 && rPut.status === 403, `${rGet.status}/${rPut.status}`)
  check('…and nothing changed', row(coId) === `${bDay}|${bPf}`)

  // ── payroll uses the run's company's settings (a DRAFT only; never processed) ──
  at('draft run')
  const now = new Date(); const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))
  const pm = next.getUTCMonth() + 1, py = next.getUTCFullYear()
  const run = await owner('POST', '/v1/payroll/runs', { companyId: coId, periodMonth: pm, periodYear: py })
  runId = run.json?.id || null
  const payDay = run.json?.payDate ? Number(run.json.payDate.slice(8, 10)) : null
  check(`a draft run for the second company is paid on the ${ord(bDay)} (its settings), not the ${ord(Number(wsDay))}`, (run.status === 201 || run.status === 200) && run.json?.status === 'DRAFT' && payDay === bDay, `${run.status} ${run.json?.status} payDate ${run.json?.payDate}`)

  // ── the page ──
  {
    const o = await signIn('owner@unifiedtree.demo')
    await o.open('/hrms/payroll/settings')
    check('two companies: the selector shows', await selector(o.page).count() === 1)
    // owner@ has no employee record: the first company (the demo company) is the default.
    check(`heading: "Payroll settings · ${demo.name}"`, await seen(o.page, `Payroll settings · ${demo.name}`))
    check(`demo company: processed on the ${ord(Number(wsDay))}`, await seen(o.page, `processed on the ${ord(Number(wsDay))}`))
    check('the page asked for the demo company’s settings', o.calls.some((c) => c.path.startsWith(`/v1/payroll/settings?companyId=${demo.id}`)), o.calls.filter((c) => c.path.includes('payroll/settings')).map((c) => c.path).join(' '))
    await o.page.screenshot({ path: `${shots}/w60-settings-demo-1440.png`, fullPage: false })

    o.calls.length = 0
    await switchTo(o.page, coName)
    check(`switch: heading "Payroll settings · ${coName}"`, await seen(o.page, `Payroll settings · ${coName}`))
    check(`switch: processed on the ${ord(bDay)}`, await seen(o.page, `processed on the ${ord(bDay)}`))
    check('switch: the page asked for the second company’s settings', o.calls.some((c) => c.path.startsWith(`/v1/payroll/settings?companyId=${coId}`)), o.calls.filter((c) => c.path.includes('payroll/settings')).map((c) => c.path).join(' '))
    check('switch: the demo company’s heading is gone', (await o.page.getByText(`Payroll settings · ${demo.name}`).count()) === 0)
    await o.page.screenshot({ path: `${shots}/w60-settings-second-1440.png`, fullPage: false })

    // A save on the second company, through the page.
    at('save on the second company', o.page)
    const saveDay = bDay + 1
    const field = o.page.getByLabel('Processing day')
    await field.fill(String(saveDay))
    await o.page.getByRole('button', { name: 'Save settings' }).first().click()
    const toast = await seen(o.page, 'Payroll settings saved')
    check('save: "Payroll settings saved"', toast)
    await o.settle()
    check(`save: the second company’s row has the ${ord(saveDay)}`, row(coId).startsWith(`${saveDay}|`), row(coId))
    check('save: the PUT named the second company', o.calls.some((c) => c.method === 'PUT' && c.path.startsWith(`/v1/payroll/settings?companyId=${coId}`)))
    check('save: the demo company and the workspace row are unchanged', row(demo.id) === ws && workspaceRow() === ws, `${row(demo.id)} · ${workspaceRow()}`)

    await switchTo(o.page, demo.name)
    check(`switch back: processed on the ${ord(Number(wsDay))} again`, await seen(o.page, `processed on the ${ord(Number(wsDay))}`) && await seen(o.page, `Payroll settings · ${demo.name}`))
    check('owner: no page errors', !o.errors.length, o.errors[0] || '')
    check('owner: no failed API calls', !o.failed.length, o.failed.slice(0, 3).join(' | '))
    await o.context.close()
  }
  {
    // Phone width, on the second company (a link with ?co=).
    const p = await signIn('owner@unifiedtree.demo', { width: 390, height: 844 })
    await p.open(`/hrms/payroll/settings?co=${coId}`)
    check('phone: the second company’s heading', await seen(p.page, `Payroll settings · ${coName}`))
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check('phone: no sideways scroll', !overflow)
    await p.page.screenshot({ path: `${shots}/w60-settings-second-390.png`, fullPage: false })
    check('phone: no page errors', !p.errors.length, p.errors[0] || '')
    await p.context.close()
  }
} catch (e) {
  check('test ran to the end', false, `at "${where}": ${String(e && e.message || e).split('\n').slice(0, 14).join(' | ')}`)
  try { await lastPage?.screenshot({ path: `${shots}/w60-fail.png`, fullPage: true }) } catch { /* page gone */ }
} finally {
  await browser.close()
  // Remove what this test made: the draft run (DRAFT, of the temporary company), the temporary company's
  // settings row, the defaults a new company gets (shifts, employment types) and the company itself — only
  // the company this test made (same id and name), and only when nothing else points at it.
  try {
    if (runId && coId) {
      sql(`delete from audit.events where entity_id='${runId}'`)
      sql(`delete from payroll.runs where id='${runId}' and company_id='${coId}' and status='DRAFT'`)
    }
    if (coId) {
      const mine = sql(`select count(*) from org.companies where id='${coId}' and name=${lit(coName)} and tenant_id='${tenant}'`) === '1'
      if (mine) {
        sql(`delete from payroll.company_settings where company_id='${coId}'`)
        sql(`delete from attendance.shift_policies p where p.company_id='${coId}' and not exists (select 1 from attendance.employee_shift_assignments a where a.shift_policy_id=p.id)`)
        sql(`delete from org.employment_types where company_id='${coId}'`)
      }
      const tables = sql("select c.table_schema||'.'||c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')").split('\n').filter(Boolean)
      const refs = sql(tables.map((t) => `select '${t}' where exists (select 1 from ${t} where company_id='${coId}')`).join(' union all ')).split('\n').filter(Boolean)
      if (mine && !refs.length) {
        sql(`delete from audit.events where entity_id='${coId}'`)
        const gone = sql(`with d as (delete from org.companies where id='${coId}' and name=${lit(coName)} and tenant_id='${tenant}' returning id) select count(*) from d`)
        check('cleanup: the temporary company, its settings and its draft run are removed', gone === '1' && sql(`select count(*) from payroll.runs where company_id='${coId}'`) === '0')
      } else {
        check('cleanup: the temporary company, its settings and its draft run are removed', false, mine ? `still referenced by ${refs.join(', ')}` : 'not the company this test made; left alone')
      }
    }
  } catch (err) {
    check('cleanup: the temporary company, its settings and its draft run are removed', false, String(err).split('\n')[0])
  }
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
