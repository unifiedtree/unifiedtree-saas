// Live check of the 2026-09-25 performance access rules (V143.9 + PerformanceTeamScope):
//  - Department manager sees only their team (same team as the My team page:
//    departments they head, else direct reports) in KPIs, reviews, cycle
//    progress and the performance directory; records progress on a team KPI
//    (hrms.kpi.progress) but not on anyone else's.
//  - ADMIN runs performance like HR: lists cycles, reviews and KPIs, records
//    KPI progress. (The local data has no ADMIN user, so the test grants the
//    ADMIN role to the finance lead for the run and removes it afterwards.)
//  - The nightly job marks an overdue KPI "At risk" (checked on a KPI the test
//    seeded before the backend started: pass SEEDED_OVERDUE_KPI=<id>).
//  - The manager's KPI view says it's their team and offers "Update progress".
// Everything created is removed.
//
//   node e2e/recovery/live-performance-scope.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}
const stamp = Date.now()
const created = []
let adminGrant = null
try {
  const owner = await login('owner@unifiedtree.demo')
  // Someone active who is not in the manager's team (not Reader, not the manager).
  const other = sql(`select id from hrms.employees where is_active and id not in ('${READER}','44444444-4444-4444-4444-444444444444') and tenant_id='${tenant}' order by created_at limit 1`)
  for (const [ownerId, label] of [[READER, 'team'], [other, 'other']]) {
    const r = await owner.call('/v1/performance/kpis', 'POST', { ownerId, title: `QA scope KPI ${label} ${stamp}`, targetValue: 100, currentValue: 0, unit: 'tasks', direction: 'HIGHER_IS_BETTER', weight: 1 })
    if (r.json?.id) created.push(r.json.id)
    check(`fixture: KPI for the ${label} employee`, r.status === 201, `status=${r.status}`)
  }
  const [teamKpi, otherKpi] = created
  // A review and a cycle assignment for someone outside the team, so "only the team" is a real test.
  const cycleId = sql(`select id from performance_mgmt.review_cycles where tenant_id='${tenant}' order by created_at desc limit 1`)
  const seededReview = cycleId ? sql(`insert into performance_mgmt.performance_reviews (tenant_id, cycle_id, employee_id, reviewer_id, reviewer_type, status) values ('${tenant}','${cycleId}','${other}','${other}','SELF','PENDING') returning id`).split(/\s/)[0] : ''
  const seededAssignment = cycleId ? sql(`insert into performance_mgmt.appraisal_reviewer_assignments (tenant_id, cycle_id, reviewee_id, reviewer_id, reviewer_type, status) values ('${tenant}','${cycleId}','${other}','${other}','SELF','PENDING') returning id`).split(/\s/)[0] : ''
  globalThis.__seeded = { seededReview, seededAssignment }

  // ── department manager ──
  const mgr = await login('mgr@unifiedtree.demo')
  check('manager: holds hrms.kpi.progress, not performance.write', mgr.perms.includes('hrms.kpi.progress') && !mgr.perms.includes('hrms.performance.write'))
  const kpis = await mgr.call(`/v1/performance/kpis?search=${encodeURIComponent('QA scope KPI')}&size=50`)
  const titles = (kpis.json?.items || []).map((k) => k.title)
  check('manager: KPI list shows the team KPI, not the other one', titles.includes(`QA scope KPI team ${stamp}`) && !titles.includes(`QA scope KPI other ${stamp}`), titles.join(' | '))
  const allKpis = await mgr.call('/v1/performance/kpis?size=200')
  check('manager: every KPI they can list belongs to their team', (allKpis.json?.items || []).every((k) => k.ownerId === READER), `${allKpis.json?.items?.length} KPIs`)
  const ok = await mgr.call(`/v1/performance/kpis/${teamKpi}/progress`, 'PUT', { newValue: 40, notes: 'Manager QA update' })
  check('manager: records progress on a team KPI', ok.status === 200 && Number(ok.json?.currentValue) === 40, `status=${ok.status}`)
  const denied = await mgr.call(`/v1/performance/kpis/${otherKpi}/progress`, 'PUT', { newValue: 40 })
  check('manager: cannot record progress outside the team', denied.status >= 400 && sql(`select current_value from performance_mgmt.goals where id='${otherKpi}'`).startsWith('0'), `status=${denied.status}`)
  const create = await mgr.call('/v1/performance/kpis', 'POST', { ownerId: READER, title: `QA mgr create ${stamp}`, targetValue: 1 })
  check('manager: still cannot create KPIs', create.status === 403, `status=${create.status}`)
  if (create.json?.id) created.push(create.json.id)
  const reviews = await mgr.call('/v1/performance/reviews?size=200')
  const reviewOwners = new Set((reviews.json?.content || []).map((r) => r.employeeId))
  const ownerReviews = await owner.call('/v1/performance/reviews?size=200')
  const allOwners = new Set((ownerReviews.json?.content || []).map((r) => r.employeeId))
  check('manager: reviews list only their team', [...reviewOwners].every((id) => id === READER) && allOwners.size > reviewOwners.size, `manager sees ${reviewOwners.size} people, owner ${allOwners.size}`)
  if (cycleId) {
    const prog = await mgr.call(`/v1/performance/cycles/${cycleId}/progress`)
    const ownerProg = await owner.call(`/v1/performance/cycles/${cycleId}/progress`)
    check('manager: cycle progress lists only their team', prog.status === 200 && (prog.json?.reviewees || []).every((r) => r.revieweeId === READER)
      && (ownerProg.json?.reviewees || []).some((r) => r.revieweeId === other), `manager ${prog.json?.reviewees?.length}, owner ${ownerProg.json?.reviewees?.length} reviewees`)
  }
  const dir = await mgr.call('/v1/performance/employees?size=200')
  check('manager: performance directory lists only their team', dir.status === 200 && (dir.json?.items || []).every((r) => r.employeeId === READER), `status=${dir.status} rows=${dir.json?.items?.length}`)

  // ── ADMIN (granted to the finance lead for this run) ──
  const finUser = (await owner.call('/v1/workspace/users')).json?.find((u) => u.email === 'fin@unifiedtree.demo')
  const adminRole = sql(`select id from rbac.roles where code='ADMIN' and tenant_id is null`)
  if (finUser && adminRole) {
    sql(`insert into rbac.user_roles (tenant_id, user_id, role_id, granted_at) values ('${tenant}','${finUser.userId}','${adminRole}', now()) on conflict do nothing`)
    adminGrant = { user: finUser.userId, role: adminRole }
    const admin = await login('fin@unifiedtree.demo')
    check('admin: holds performance read and write', admin.perms.includes('hrms.performance.read') && admin.perms.includes('hrms.performance.write'))
    const cycles = await admin.call('/v1/performance/cycles')
    check('admin: lists review cycles', cycles.status === 200, `status=${cycles.status}`)
    const akpis = await admin.call(`/v1/performance/kpis?search=${encodeURIComponent('QA scope KPI')}&size=50`)
    check('admin: sees every KPI', (akpis.json?.items || []).length === 2, `${akpis.json?.items?.length}`)
    const ap = await admin.call(`/v1/performance/kpis/${otherKpi}/progress`, 'PUT', { newValue: 55 })
    check('admin: records KPI progress for anyone', ap.status === 200, `status=${ap.status}`)
    const areviews = await admin.call('/v1/performance/reviews?size=200')
    check('admin: sees the whole company’s reviews', new Set((areviews.json?.content || []).map((r) => r.employeeId)).size === allOwners.size)
  } else check('admin: fixture user found', false)

  // ── the at-risk job ──
  const seeded = process.env.SEEDED_OVERDUE_KPI
  if (seeded) check('job: an overdue KPI was marked At risk at startup', sql(`select status from performance_mgmt.goals where id='${seeded}'`) === 'AT_RISK')

  // ── manager UI ──
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('mgr@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(base + '/hrms/performance?view=kpis'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800)
  check('manager UI: "Your team’s goals & KPIs" with the team note', (await page.getByText('Your team’s goals & KPIs', { exact: true }).count()) === 1 && (await page.getByText(/You see your team/).count()) === 1)
  check('manager UI: "Update progress" is offered', (await page.getByRole('button', { name: 'Update progress' }).count()) > 0)
  check('manager UI: no page errors', errors.length === 0, errors[0] || '')
  await browser.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  const seeded = globalThis.__seeded || {}
  if (seeded.seededReview) sql(`delete from performance_mgmt.performance_reviews where id='${seeded.seededReview}'`)
  if (seeded.seededAssignment) sql(`delete from performance_mgmt.appraisal_reviewer_assignments where id='${seeded.seededAssignment}'`)
  if (adminGrant) sql(`delete from rbac.user_roles where user_id='${adminGrant.user}' and role_id='${adminGrant.role}'`)
  for (const id of created) { sql(`delete from performance_mgmt.kpi_progress_updates where goal_id='${id}'`); sql(`delete from performance_mgmt.goals where id='${id}'`) }
  if (process.env.SEEDED_OVERDUE_KPI) sql(`delete from performance_mgmt.goals where id='${process.env.SEEDED_OVERDUE_KPI}'`)
  const left = sql(`select count(*) from performance_mgmt.goals where title like 'QA scope KPI %' or title like 'QA mgr create %' or title = 'QA overdue KPI'`)
  check('cleanup: QA KPIs removed and the ADMIN grant taken back', left === '0' && (!adminGrant || sql(`select count(*) from rbac.user_roles where user_id='${adminGrant.user}' and role_id='${adminGrant.role}'`) === '0'), `left=${left}`)
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
