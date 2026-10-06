/* global process, console, fetch, URL, URLSearchParams, document */
// Workforce Analytics with live numbers (w45, 6 Oct 2026), against a running server and its database.
// API:
//   · /v1/reports/headcount/breakdown adds up to the headcount report (today and a past date), and each
//     breakdown (branch, age "Not recorded", tenure under 6 months) matches SQL written independently
//   · /v1/reports/attrition/joiners: every month of the period, each month's joiners match SQL, the total
//     matches /headcount/change over the same window
//   · a custom role with only hrms.report.headcount gets the breakdown without gender and no joiners (403);
//     mgr and reader get 403 on both
// UI: the Headcount tab shows the joiners and leavers and the breakdown with the API's numbers (?by=age too),
//   the Attrition tab shows the Joined column and tiles; 1440 and 390 wide, no sideways scroll at 390,
//   no page errors and no failed API calls.
// Everything it creates (a custom role, its user and employee) is removed.
//
//   node e2e/recovery/live-w3-w45-analytics.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_APP_URL, RECOVERY_DB (default ut_w3_dev), SHOTS ("0" for none)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3245'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS === '0' ? null : (process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots')
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
if (shots) mkdirSync(shots, { recursive: true })

const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const monthStart = (d, back = 0) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - back); return x.toISOString().slice(0, 10) }
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }
const q = (o) => new URLSearchParams(o).toString()
const sum = (rows, k) => (rows || []).reduce((a, r) => a + Number(r[k] || 0), 0)

const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  return async (path) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500) surprises.push(`${path} → ${res.status} ${text.slice(0, 200)}`)
    return { status: res.status, json }
  }
}

// ── the headcount report's own rule, written independently ─────────────────
const employed = (d) => `e.tenant_id='${tenant}' and e.company_id='${company}' and e.date_of_joining <= '${d}' and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') <= '${d}')`

// ── fixture: a role with only the headcount report ─────────────────────────
const fx = { role: randomUUID(), user: randomUUID(), employee: randomUUID() }
const fxEmail = `qa-w45-${fx.user.slice(0, 8)}@example.invalid`
function makeFixture() {
  sql(`BEGIN;
    INSERT INTO rbac.roles(id, tenant_id, code, display_name, description, is_system) VALUES ('${fx.role}', '${tenant}', 'QA_W45_${fx.role.slice(0, 8).toUpperCase()}', 'QA w45 headcount only', 'live-w3-w45-analytics fixture', false);
    INSERT INTO rbac.role_permissions(role_id, permission_code) VALUES ('${fx.role}', 'hrms.report.headcount');
    INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, email, employment_type, employment_status, date_of_joining)
      VALUES ('${fx.employee}', '${tenant}', '${company}', 'QAW45-${fx.employee.slice(0, 6)}', 'Qa', 'Analytics', '${fxEmail}', 'FULL_TIME', 'ACTIVE', DATE '2020-01-01');
    INSERT INTO auth.user_credentials(id, tenant_id, email, password_hash, employee_id, is_active)
      SELECT '${fx.user}', '${tenant}', '${fxEmail}', password_hash, '${fx.employee}', true FROM auth.user_credentials WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id, user_id, role_id) VALUES ('${tenant}', '${fx.user}', '${fx.role}');
    COMMIT;`)
}
function cleanup() {
  try {
    sql(`BEGIN;
      DELETE FROM rbac.user_roles WHERE tenant_id='${tenant}' AND user_id='${fx.user}';
      DELETE FROM auth.user_credentials WHERE tenant_id='${tenant}' AND id='${fx.user}';
      DELETE FROM hrms.employee_status_history WHERE tenant_id='${tenant}' AND employee_id='${fx.employee}';
      DELETE FROM hrms.employees WHERE tenant_id='${tenant}' AND id='${fx.employee}';
      DELETE FROM rbac.role_permissions WHERE role_id='${fx.role}';
      DELETE FROM rbac.roles WHERE id='${fx.role}';
      COMMIT;`)
  } catch (e) { console.log('cleanup problem: ' + String(e.message || e).slice(0, 300)) }
}

let browser
try {
  makeFixture()
  const owner = await session('owner@unifiedtree.demo')
  const custom = await session(fxEmail)
  const mgr = await session('mgr@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')

  // 1. Breakdown = the headcount report, today and on a past date.
  const past = dayBefore(monthStart(today, 1)) // the last day of the month before last
  for (const d of [today, past]) {
    const b = await owner(`/v1/reports/headcount/breakdown?${q({ companyId: company, asOf: d })}`)
    const h = await owner(`/v1/reports/headcount?${q({ companyId: company, asOf: d })}`)
    check(`breakdown ${d}: answers`, b.status === 200 && h.status === 200, `${b.status}/${h.status}`)
    if (b.status !== 200) continue
    const B = b.json
    check(`breakdown ${d}: total, active, probation, on notice = the headcount report`,
      B.total === sum(h.json, 'total') && B.active === sum(h.json, 'active') && B.probation === sum(h.json, 'probation') && B.onNotice === sum(h.json, 'on_notice'),
      `${JSON.stringify([B.total, B.active, B.probation, B.onNotice])} vs ${JSON.stringify([sum(h.json, 'total'), sum(h.json, 'active'), sum(h.json, 'probation'), sum(h.json, 'on_notice')])}`)
    check(`breakdown ${d}: total = SQL`, B.total === num(`select count(*) from hrms.employees e where ${employed(d)}`), String(B.total))
    for (const k of ['byBranch', 'byDesignation', 'byEmploymentType', 'byAgeBand', 'byTenureBand', 'byGender']) {
      check(`breakdown ${d}: ${k} adds up`, Array.isArray(B[k]) && sum(B[k], 'total') === B.total && sum(B[k], 'active') === B.active && sum(B[k], 'onNotice') === B.onNotice, JSON.stringify(B[k]))
    }
    const branches = Object.fromEntries(sql(`select coalesce(nullif(trim(b.name),''),'No branch'), count(*) from hrms.employees e left join org.branches b on b.id=e.branch_id where ${employed(d)} group by 1`).split('\n').filter(Boolean).map((l) => { const [n, c] = l.split('|'); return [n, Number(c)] }))
    check(`breakdown ${d}: branches match SQL`, B.byBranch.length === Object.keys(branches).length && B.byBranch.every((g) => branches[g.name] === g.total), `${JSON.stringify(B.byBranch.map((g) => [g.name, g.total]))} vs ${JSON.stringify(branches)}`)
    const noDob = num(`select count(*) from hrms.employees e where ${employed(d)} and e.date_of_birth is null`)
    const nr = B.byAgeBand.find((g) => g.none)
    check(`breakdown ${d}: age "Not recorded" = people without a date of birth`, (nr ? nr.total : 0) === noDob, `${nr?.total} vs ${noDob}`)
    check(`breakdown ${d}: age bands in order`, B.byAgeBand.slice(0, 5).map((g) => g.name).join('|') === 'Under 25|25–34|35–44|45–54|55 and over')
    const under6 = num(`select count(*) from hrms.employees e where ${employed(d)} and e.date_of_joining > (date '${d}' - interval '6 months')::date`)
    check(`breakdown ${d}: tenure under 6 months = SQL`, B.byTenureBand[0].name === 'Under 6 months' && B.byTenureBand[0].total === under6, `${B.byTenureBand[0].total} vs ${under6}`)
    check(`breakdown ${d}: owner gets gender`, B.genderIncluded === true)
  }

  // 2. Joiners per month over the last 12 months.
  const from = monthStart(today, 11)
  const j = await owner(`/v1/reports/attrition/joiners?${q({ companyId: company, from, to: today })}`)
  check('joiners: answers with 12 months', j.status === 200 && Array.isArray(j.json) && j.json.length === 12, `${j.status} ${JSON.stringify(j.json)?.slice(0, 200)}`)
  if (j.status === 200) {
    let allMatch = true
    for (const m of j.json) {
      const n = num(`select count(*) from hrms.employees e where e.tenant_id='${tenant}' and e.company_id='${company}' and to_char(e.date_of_joining,'YYYY-MM')='${m.month}' and e.date_of_joining <= '${today}'`)
      if (n !== m.joined) { allMatch = false; console.log(`   ${m.month}: api ${m.joined} vs sql ${n}`) }
    }
    check('joiners: every month matches SQL', allMatch)
    const ch = await owner(`/v1/reports/headcount/change?${q({ companyId: company, from: dayBefore(from), to: today })}`)
    check('joiners: the total = /headcount/change joined over the same window', ch.status === 200 && sum(j.json, 'joined') === ch.json.joined, `${sum(j.json, 'joined')} vs ${ch.json?.joined}`)
    const at = await owner(`/v1/reports/attrition?${q({ companyId: company, from, to: today })}`)
    check('joiners: the months are the attrition report\'s months', at.status === 200 && at.json.map((r) => r.month).join() === j.json.map((r) => r.month).join())
    check('joiners: leavers (attrition exits) = /headcount/change left', sum(at.json, 'exits') === ch.json.left, `${sum(at.json, 'exits')} vs ${ch.json?.left}`)
  }
  const bad = await owner(`/v1/reports/attrition/joiners?${q({ companyId: company, from: today, to: from })}`)
  check('joiners: dates the wrong way round are refused', bad.status >= 400 && bad.status < 500, String(bad.status))

  // 3. Permissions.
  const cb = await custom(`/v1/reports/headcount/breakdown?${q({ companyId: company })}`)
  check('headcount-only role: breakdown without gender', cb.status === 200 && cb.json.genderIncluded === false && cb.json.byGender == null, `${cb.status} ${JSON.stringify(cb.json)?.slice(0, 120)}`)
  check('headcount-only role: no joiners (403)', (await custom(`/v1/reports/attrition/joiners?${q({ companyId: company, from, to: today })}`)).status === 403)
  for (const [who, s] of [['mgr', mgr], ['reader', reader]]) {
    const a = (await s(`/v1/reports/headcount/breakdown?${q({ companyId: company })}`)).status
    const b = (await s(`/v1/reports/attrition/joiners?${q({ companyId: company, from, to: today })}`)).status
    check(`${who}: 403 on breakdown and joiners`, a === 403 && b === 403, `${a}/${b}`)
  }
  const foreign = await owner(`/v1/reports/headcount/breakdown?${q({ companyId: randomUUID() })}`)
  check('another company id: nobody counted', foreign.status === 200 && foreign.json.total === 0, `${foreign.status} ${foreign.json?.total}`)

  // 4. UI.
  const change = (await owner(`/v1/reports/headcount/change?${q({ companyId: company, from: dayBefore(monthStart(today)), to: today })}`)).json
  const brk = (await owner(`/v1/reports/headcount/breakdown?${q({ companyId: company })}`)).json
  const joinedYear = sum((await owner(`/v1/reports/attrition/joiners?${q({ companyId: company, from, to: today })}`)).json, 'joined')
  browser = await chromium.launch({ headless: true })
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
    const page = await ctx.newPage()
    const errors = [], failedApi = []
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    page.setDefaultNavigationTimeout(90_000)
    await page.goto(base + '/login', { timeout: 180_000 })
    await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.waitForTimeout(2500)
    // The owner has no face enrolled: the web check-in prompt opens over the page; this test isn't about it.
    const skip = page.getByRole('button', { name: 'Continue without checking in' })
    if (await skip.isVisible().catch(() => false)) { await skip.click(); await page.waitForTimeout(500) }
    errors.length = 0; failedApi.length = 0
    const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(1200) }

    await page.goto(`${base}/hrms/workforce-analytics?co=${company}`); await settle()
    const jl = page.getByRole('region', { name: 'Joiners and leavers', exact: true }).first()
    const jlText = (await jl.innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`${width}: headcount tab shows joiners and leavers from the API`, jlText.includes(`Joined ${change.joined}`) && jlText.includes(`Left ${change.left}`), jlText.slice(0, 200))
    const bdText = (await page.getByRole('region', { name: 'Breakdown', exact: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const firstBranch = brk.byBranch[0]
    check(`${width}: breakdown shows the branches`, !!firstBranch && bdText.includes(firstBranch.name), bdText.slice(0, 200))
    if (shots) {
      await page.screenshot({ path: `${shots}/w45-analytics-headcount-${width}.png`, fullPage: true })
      await page.getByRole('region', { name: 'Breakdown', exact: true }).first().screenshot({ path: `${shots}/w45-analytics-breakdown-${width}.png` }).catch(() => {})
    }
    if (width === 390) {
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('390: no sideways scroll on the headcount tab', sideways <= 1, `${sideways}px`)
    }

    await page.goto(`${base}/hrms/workforce-analytics?co=${company}&by=age`); await settle()
    const ageText = (await page.getByRole('region', { name: 'Breakdown', exact: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`${width}: ?by=age shows the age bands`, ageText.includes('25–34') && ageText.includes('55 and over'), ageText.slice(0, 200))
    if (shots) await page.getByRole('region', { name: 'Breakdown', exact: true }).first().screenshot({ path: `${shots}/w45-analytics-age-${width}.png` }).catch(() => {})

    await page.goto(`${base}/hrms/workforce-analytics?co=${company}&tab=attrition&period=l12`); await settle()
    const atText = (await page.getByRole('region', { name: 'Joiners and leavers', exact: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`${width}: attrition tab shows the period's joiners`, atText.includes(`Joined ${joinedYear}`), atText.slice(0, 200))
    check(`${width}: monthly trend has a Joined column`, (await page.getByRole('columnheader', { name: 'Joined' }).count()) > 0 || width === 390)
    if (shots) await page.screenshot({ path: `${shots}/w45-analytics-attrition-${width}.png`, fullPage: true })
    if (width === 390) {
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('390: no sideways scroll on the attrition tab', sideways <= 1, `${sideways}px`)
    }
    check(`${width}: no page errors`, errors.length === 0, errors.join(' | '))
    check(`${width}: no failed API calls`, failedApi.length === 0, failedApi.join(' | '))
    await ctx.close()
  }
} catch (e) {
  check('run finished', false, String(e?.stack || e).slice(0, 400))
} finally {
  if (browser) await browser.close()
  cleanup()
  const left = num(`select count(*) from rbac.roles where id='${fx.role}'`) + num(`select count(*) from hrms.employees where id='${fx.employee}'`)
  check('fixtures removed', left === 0, String(left))
}
check('no server errors', surprises.length === 0, surprises.join(' | '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
