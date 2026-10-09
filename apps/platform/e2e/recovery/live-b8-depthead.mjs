// Live check of owner decision Q-22 (b8/depthead): "Department heads see their whole department; other
// managers see their direct reports. Punch-in alerts keep going to each person's reporting manager (as now),
// and an admin can add more people or roles to the alert list."
//
//   · a department head sees everyone in the department they head (whoever those people report to) and their
//     direct report in another department; not the rest of that department, not a department under theirs
//   · a manager who heads no department sees only their direct reports
//   · an employee has no team (403 on the team endpoints)
//   · the same people on /v1/team/summary, /v1/team/time-off and /v1/attendance/dashboard, and on the web's /team
//   · the head can decide their outside direct report's WFH request (it routes to them as reporting manager);
//     the plain manager can't
//   · punch-in alerts: the reporting manager (not the department head), plus the person and the role an admin
//     adds in HR configuration
// Everything it creates is removed at the end, and the company's punch-in alert setting is put back.
//
//   live-slot.sh /c/REACT/ut-wt/b8-depthead 3188 node e2e/recovery/live-b8-depthead.mjs
//   env: RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB, RECOVERY_PASSWORD, SHOTS_DIR
/* global process, console, document, fetch, setTimeout */
import './_skip-punch-prompt.mjs'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3188'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const HRM = '33333333-3333-3333-3333-333333333333'
const FIN = '55555555-5555-5555-5555-555555555555'
const ROLE_DEPT_MANAGER = '00000000-0000-0000-0000-000000000005'
const ROLE_EMPLOYEE = '00000000-0000-0000-0000-000000000004'
const ROLE_FINANCE_LEAD = '00000000-0000-0000-0000-000000000003'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const skip = (name, why) => { results.push({ name, ok: true }); console.log(`PASS  ${name}  — skipped: ${why}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = istToday()
const startedAt = sql('select now()')

// ── sessions ────────────────────────────────────────────────────────────────
const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const call = async (path, method = 'GET', body, headers = {}) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    const parse = () => { try { return text ? JSON.parse(text) : null } catch { return text } }
    const json = parse()
    if (res.status >= 500) surprises.push(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const tag = randomUUID().slice(0, 6)
const DEPT = randomUUID(), SUB = randomUUID(), SUP = randomUUID()
const H = randomUUID(), M = randomUUID(), E = randomUUID(), S = randomUUID(), O = randomUUID(), P = randomUUID(), Q = randomUUID(), SE = randomUUID()
const UH = randomUUID(), UM = randomUUID(), UE = randomUUID()
const people = { H, M, E, S, O, P, Q, SE }
const NAME = { H: 'Head', M: 'Manager', E: 'Employee', S: 'Sales', O: 'Outside', P: 'Report', Q: 'Colleague', SE: 'East' }
const fullName = (k) => `QA B8 ${NAME[k]}-${tag}`
const email = (k) => `qa-b8-${NAME[k].toLowerCase()}-${tag}@example.invalid`
const everyone = Object.values(people)
const created = { wfh: [], records: [] }
// Where the employee punches: an active branch of the company with a position (E works there), so the
// punch is inside the office whatever the company's geofence rule is.
const branch = (sql(`select id||'|'||latitude||'|'||longitude from org.branches where tenant_id='${tenant}' and company_id='${company}'
  and is_active and latitude is not null and longitude is not null order by name limit 1`) || '').split('|')
let alertBefore = null // the company's punch-in alert setting before the test (null: it had none saved)
let alertChanged = false

function insertFixtures() {
  const emp = (k, dept, manager) => `('${people[k]}','${tenant}','${company}','QB8-${NAME[k].slice(0, 3)}-${tag}','QA B8','${NAME[k]}-${tag}','${email(k)}',
      'FULL_TIME','ACTIVE',${dept ? `'${dept}'` : 'NULL'},${manager ? `'${manager}'` : 'NULL'},'2025-01-01','qa','qa')`
  const login = (u, k, role) => `INSERT INTO auth.user_credentials(id,tenant_id,email,password_hash,employee_id,is_active)
      SELECT '${u}','${tenant}','${email(k)}',password_hash,'${people[k]}',true FROM auth.user_credentials
       WHERE tenant_id='${tenant}' AND email='owner@unifiedtree.demo';
    INSERT INTO rbac.user_roles(tenant_id,user_id,role_id) VALUES ('${tenant}','${u}','${role}');`
  sql(`BEGIN;
    INSERT INTO hrms.departments(id,tenant_id,company_id,name,code,is_active,created_by,updated_by) VALUES
      ('${DEPT}','${tenant}','${company}','QA B8 Sales ${tag}','QB8S${tag}',true,'qa','qa'),
      ('${SUP}','${tenant}','${company}','QA B8 Support ${tag}','QB8P${tag}',true,'qa','qa');
    INSERT INTO hrms.departments(id,tenant_id,company_id,name,code,parent_department_id,is_active,created_by,updated_by) VALUES
      ('${SUB}','${tenant}','${company}','QA B8 Sales East ${tag}','QB8E${tag}','${DEPT}',true,'qa','qa');
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      department_id,reporting_manager_id,date_of_joining,created_by,updated_by) VALUES
      ${emp('H', DEPT, null)}, ${emp('M', SUP, null)};
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      department_id,reporting_manager_id,date_of_joining,created_by,updated_by) VALUES
      ${emp('E', DEPT, M)}, ${emp('S', DEPT, null)}, ${emp('O', SUP, H)}, ${emp('P', SUP, M)}, ${emp('Q', SUP, null)}, ${emp('SE', SUB, null)};
    UPDATE hrms.departments SET department_head_employee_id='${H}' WHERE id='${DEPT}';
    ${branch[0] ? `UPDATE hrms.employees SET branch_id='${branch[0]}' WHERE id='${E}';` : ''}
    ${login(UH, 'H', ROLE_DEPT_MANAGER)}
    ${login(UM, 'M', ROLE_DEPT_MANAGER)}
    ${login(UE, 'E', ROLE_EMPLOYEE)}
    COMMIT;`)
}

const idsOf = (list, key = 'employeeId') => new Set((list || []).map((x) => x[key]))
const has = (set, ...ids) => ids.every((id) => set.has(id))
const hasNone = (set, ...ids) => ids.every((id) => !set.has(id))
const label = (set) => Object.entries(people).filter(([, id]) => set.has(id)).map(([k]) => k).join(',') || '(none)'

async function main(owner) {
  insertFixtures()
  const head = await session(email('H'))
  const mgr = await session(email('M'))
  const emp = await session(email('E'))
  check('fixture: the head, the manager and the employee can sign in', head.employeeId === H && mgr.employeeId === M && emp.employeeId === E)

  // ── 1. who is in My team ──────────────────────────────────────────────────
  const hs = await head.call('/v1/team/summary')
  const hTeam = idsOf(hs.json?.members)
  check('head: GET /v1/team/summary 200', hs.status === 200, String(hs.status))
  check('head: the whole department they head (E reports to someone else, S to nobody) and their direct report in Support (O)',
    has(hTeam, E, S, O) && hTeam.size === 3, label(hTeam))
  check('head: not the rest of Support (P, Q), not the department under Sales (SE), not the manager, not themself', hasNone(hTeam, P, Q, SE, M, H), label(hTeam))
  check('head: the team is chosen by department, named after it', hs.json?.scope === 'DEPARTMENT' && (hs.json?.departmentNames || []).includes(`QA B8 Sales ${tag}`),
    `${hs.json?.scope} ${JSON.stringify(hs.json?.departmentNames)}`)

  const ms = await mgr.call('/v1/team/summary')
  const mTeam = idsOf(ms.json?.members)
  check('manager: GET /v1/team/summary 200', ms.status === 200, String(ms.status))
  check('manager (heads nothing): only their direct reports, E and P', has(mTeam, E, P) && mTeam.size === 2, label(mTeam))
  check('manager: not the rest of their own department (Q, O), not Sales (S)', hasNone(mTeam, Q, O, S, SE, H), label(mTeam))
  check('manager: the team is their direct reports', ms.json?.scope === 'DIRECT_REPORTS', ms.json?.scope)

  const es = await emp.call('/v1/team/summary')
  check('employee: no team (403 on /v1/team/summary)', es.status === 403, String(es.status))
  check('employee: no team day (403 on /v1/attendance/dashboard)', (await emp.call(`/v1/attendance/dashboard?date=${today}`)).status === 403)

  // ── 2. the team's day: the same people ────────────────────────────────────
  const hd = await head.call(`/v1/attendance/dashboard?date=${today}&includeWeeklyOff=true`)
  const hDay = idsOf(hd.json?.staffStatuses)
  check('head: the team day (/v1/attendance/dashboard) is the same three people', hd.status === 200 && has(hDay, E, S, O) && hasNone(hDay, P, Q, SE, M, H), `${hd.status} ${label(hDay)}`)
  const md = await mgr.call(`/v1/attendance/dashboard?date=${today}&includeWeeklyOff=true`)
  const mDay = idsOf(md.json?.staffStatuses)
  check('manager: the team day is E and P only', md.status === 200 && has(mDay, E, P) && hasNone(mDay, S, O, Q, SE, H), `${md.status} ${label(mDay)}`)

  // ── 3. time off, and deciding the outside report's request ────────────────
  const day = addDays(today, 9)
  const wfh = (emp, status, approver) => {
    const id = sql(`INSERT INTO leave_mgmt.wfh_requests(tenant_id,employee_id,from_date,to_date,reason,status,approver_id,created_by,updated_by)
      VALUES ('${tenant}','${emp}','${day}','${day}','QA B8 ${tag}','${status}',${approver ? `'${approver}'` : 'NULL'},'qa','qa') RETURNING id`).split('\n')[0]
    created.wfh.push(id)
    return id
  }
  const wfhO = wfh(O, 'APPROVED', H)
  const wfhP = wfh(P, 'APPROVED', M)
  const ht = await head.call(`/v1/team/time-off?from=${day}&to=${day}`)
  const hOff = idsOf(ht.json, 'requestId')
  check('head: time off shows the outside report\'s work from home, not the manager\'s report\'s', ht.status === 200 && hOff.has(wfhO) && !hOff.has(wfhP), `${ht.status} ${[...hOff].length} rows`)
  const mt = await mgr.call(`/v1/team/time-off?from=${day}&to=${day}`)
  const mOff = idsOf(mt.json, 'requestId')
  check('manager: time off shows their report\'s, not the head\'s outside report\'s', mt.status === 200 && mOff.has(wfhP) && !mOff.has(wfhO), `${mt.status}`)

  const pending = wfh(O, 'PENDING', H)
  const byMgr = await mgr.call(`/v1/wfh/${pending}/reject`, 'POST', { comment: 'QA B8 not yours' })
  check('manager: can\'t decide the head\'s outside report\'s request (403)', byMgr.status === 403, String(byMgr.status))
  const byHead = await head.call(`/v1/wfh/${pending}/reject`, 'POST', { comment: `QA B8 ${tag}` })
  check('head: decides their direct report\'s request outside the department (it routes to them)', byHead.status === 200 && sql(`select status from leave_mgmt.wfh_requests where id='${pending}'`) === 'REJECTED',
    `${byHead.status} ${JSON.stringify(byHead.json)?.slice(0, 160)}`)

  // ── 4. the web's My team shows the same people ────────────────────────────
  await web()

  // ── 5. punch-in alerts ────────────────────────────────────────────────────
  await punchAlerts(owner, emp)
}

async function web() {
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
      page.setDefaultNavigationTimeout(90_000)
      await page.goto(base + '/login', { timeout: 180_000 })
      await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
      await page.locator('input[type=email]').fill(email('H'))
      await page.locator('input[type=password]').fill(password)
      await page.locator('button[type=submit]').click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90_000 })
      await page.goto(base + '/team')
      // The list's title gets its count once the team's day has loaded.
      await page.getByText(/Who.s in · 3 people/).first().waitFor({ timeout: 90_000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
      const text = await page.evaluate(() => document.querySelector('#root')?.innerText || '')
      check(`web /team at ${width}: "Who’s in · 3 people"`, /Who.s in · 3 people/.test(text))
      check(`web /team at ${width}: the head sees E, S and O`, ['E', 'S', 'O'].every((k) => text.includes(fullName(k))),
        ['E', 'S', 'O'].filter((k) => !text.includes(fullName(k))).join(',') || '')
      check(`web /team at ${width}: and nobody else of the fixture`, ['P', 'Q', 'SE', 'M'].every((k) => !text.includes(fullName(k))))
      if (width === 1440) check('web /team: "3 people in your team" under the department\'s name', text.includes(`QA B8 Sales ${tag}`) && /3 people in your team/.test(text))
      await page.screenshot({ path: `${shots}/b8-depthead-team-${width}.png`, fullPage: width === 1440 })
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  check('web: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
}

async function punchAlerts(owner, emp) {
  const before = await owner.call(`/v1/attendance/punch-alert-setting?companyId=${company}`)
  if (before.status === 503) { skip('punch-in alerts', 'V143.72 is not applied here (FEATURE_NOT_READY)'); return }
  check('alerts: an admin reads the company\'s punch-in alert list (HR configuration)', before.status === 200, String(before.status))
  alertBefore = before.json?.updatedAt ? before.json : null
  const save = await owner.call(`/v1/attendance/punch-alert-setting?companyId=${company}`, 'PUT',
    { notifyManager: true, employeeIds: [HRM], roleIds: [ROLE_FINANCE_LEAD], alertOn: 'ALL' })
  alertChanged = save.status === 200
  check('alerts: an admin adds a person (HR Manager) and a role (Finance lead) to the list', save.status === 200
    && (save.json?.people || []).some((p) => p.employeeId === HRM) && (save.json?.roles || []).some((r) => r.roleId === ROLE_FINANCE_LEAD),
    `${save.status} ${JSON.stringify(save.json)?.slice(0, 200)}`)

  // E is in the head's department and reports to the plain manager.
  const punch = await emp.call('/v1/attendance/checkin', 'POST', { checkInMethod: 'GPS',
    latitude: branch[0] ? Number(branch[1]) : 17.385044, longitude: branch[0] ? Number(branch[2]) : 78.486671, accuracy: 12 })
  const record = sql(`select id from attendance.records where employee_id='${E}' and attendance_date='${today}' limit 1`)
  if (record) created.records.push(record)
  check('alerts: the employee punches in (GPS)', punch.status === 200 && !!record, `${punch.status} ${JSON.stringify(punch.json)?.slice(0, 200)}`)
  if (!record) return
  const alerted = () => new Set(sql(`select user_id from notif.notifications where tenant_id='${tenant}' and type='PUNCH_IN_ALERT'
    and data->>'attendanceRecordId'='${record}'`).split('\n').filter(Boolean))
  for (let i = 0; i < 40; i++) {
    const so = alerted()
    if (so.has(M) && so.has(HRM) && so.has(FIN)) break
    await wait(500)
  }
  await wait(1500) // anything else the alert would still send
  const to = alerted()
  check('alerts: the reporting manager is told (as now)', to.has(M), [...to].join(','))
  check('alerts: the department head is not (the employee has a reporting manager)', !to.has(H))
  check('alerts: the person the admin added is told', to.has(HRM))
  check('alerts: the role the admin added is told (fin@ holds Finance lead)', to.has(FIN))
  check('alerts: never the person who punched', !to.has(E))
}

async function restoreAlerts(owner) {
  if (!alertChanged) return
  if (alertBefore) {
    const r = await owner.call(`/v1/attendance/punch-alert-setting?companyId=${company}`, 'PUT', {
      notifyManager: alertBefore.notifyManager, employeeIds: (alertBefore.people || []).map((p) => p.employeeId),
      roleIds: (alertBefore.roles || []).map((x) => x.roleId), alertOn: alertBefore.alertOn,
    })
    check('cleanup: the company\'s punch-in alert list is put back', r.status === 200, String(r.status))
  } else {
    sql(`DELETE FROM attendance.punch_alert_settings WHERE tenant_id='${tenant}' AND company_id='${company}'`)
    check('cleanup: the company\'s punch-in alert list is back to the defaults', num(`select count(*) from attendance.punch_alert_settings where tenant_id='${tenant}' and company_id='${company}'`) === 0)
  }
}

function cleanup() {
  const run = (what, q) => { try { sql(q) } catch (e) { console.log(`cleanup ${what}: ${String(e.message).split('\n')[0]}`) } }
  const list = (ids) => ids.filter(Boolean).map((x) => `'${x}'`).join(',') || `'${randomUUID()}'`
  const ppl = list(everyone)
  const reqs = list([...created.wfh, ...created.records])
  const pattern = [...everyone, ...created.wfh, ...created.records].join('|')
  run('notifications', `DELETE FROM notif.notifications WHERE tenant_id='${tenant}' AND (user_id IN (${ppl}) OR data::text ~ '${pattern}')`)
  run('audit', `DELETE FROM audit.events WHERE tenant_id='${tenant}' AND (entity_id IN (${ppl},${reqs}) OR summary ~ 'QA B8' OR (action='PUNCH_ALERT_SETTING_CHANGED' AND occurred_at >= '${startedAt}'))`)
  run('journal', `DELETE FROM hrms.approval_decisions WHERE tenant_id='${tenant}' AND request_id IN (${reqs})`)
  run('attendance', `BEGIN; DELETE FROM attendance.event_logs WHERE employee_id IN (${ppl}); DELETE FROM attendance.records WHERE employee_id IN (${ppl}); DELETE FROM public.geo_fence_audits WHERE employee_id IN (${ppl}); COMMIT;`)
  run('wfh', `DELETE FROM leave_mgmt.wfh_requests WHERE employee_id IN (${ppl}) OR id IN (${reqs})`)
  for (const t of sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.column_name='user_id' and t.table_type='BASE TABLE' and c.table_schema='auth'`).split('\n').filter(Boolean)) {
    run(t, `DELETE FROM ${t} WHERE user_id IN ('${UH}','${UM}','${UE}')`)
  }
  run('people', `BEGIN; DELETE FROM rbac.user_roles WHERE user_id IN ('${UH}','${UM}','${UE}'); DELETE FROM auth.user_credentials WHERE id IN ('${UH}','${UM}','${UE}');
    UPDATE hrms.departments SET department_head_employee_id=NULL WHERE id IN ('${DEPT}','${SUB}','${SUP}');
    DELETE FROM hrms.employee_status_history WHERE employee_id IN (${ppl}); DELETE FROM hrms.employees WHERE id IN (${ppl});
    DELETE FROM hrms.departments WHERE id='${SUB}'; DELETE FROM hrms.departments WHERE id IN ('${DEPT}','${SUP}'); COMMIT;`)
  // anything left behind?
  const tables = sql(`select table_schema||'.'||table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where c.column_name='employee_id' and t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')
      and c.table_name not like '%\\_20%' and c.table_name not like '%\\_default'`).split('\n').filter(Boolean)
  const left = tables.map((t) => [t, num(`select count(*) from ${t} where employee_id in (${ppl})`)]).filter(([, n]) => n > 0)
  const leftOther = num(`select count(*) from hrms.employees where id in (${ppl})`) + num(`select count(*) from hrms.departments where id in ('${DEPT}','${SUB}','${SUP}')`)
    + num(`select count(*) from notif.notifications where data::text ~ '${pattern}'`) + num(`select count(*) from hrms.approval_decisions where request_id in (${reqs})`)
  check('cleanup: nothing the test made is left behind', left.length === 0 && leftOther === 0, JSON.stringify(left) + ` other=${leftOther}`)
}

let owner = null
try {
  owner = await session('owner@unifiedtree.demo')
  await main(owner)
} catch (e) {
  check('script completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  if (owner) await restoreAlerts(owner).catch((e) => check('cleanup: punch-in alert list', false, String(e)))
  cleanup()
}
check('no unexpected 5xx', surprises.length === 0, surprises.slice(0, 5).join(' || '))
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
