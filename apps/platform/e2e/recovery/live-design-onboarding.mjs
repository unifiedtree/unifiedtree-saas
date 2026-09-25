// Live check of the redesigned Onboarding & assets pages against the local API.
//  - API: removing a template task that a started onboarding uses now works
//    (was a foreign-key 500) and the run keeps its copy; a task id from another
//    template is a 404.
//  - Owner (HR): New hires / Assets / Checklist templates views, the run row,
//    the checklist page with the new hire's name, the template page.
//  - Employee: "Your onboarding" with their own run, ticks off a task.
//  - Department manager: own onboarding + assets, read-only, no refused calls.
// Everything created is removed at the end.
//
//   node e2e/recovery/live-design-onboarding.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function apiSession(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call, employeeId: d.employeeId }
}

const browser = await chromium.launch()
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
const views = (page) => page.locator('[aria-label="Onboarding views"]')

const owner = await apiSession('owner@unifiedtree.demo')
const reader = await apiSession('reader@unifiedtree.demo')
const stamp = Date.now()
const tplName = `QA onboarding ${stamp}`
let tplId = '', otherTplId = '', runId = ''
try {
  // ── fixtures ──
  const tpl = await owner.call('/v1/onboarding/templates', 'POST', { companyId: company, name: tplName, description: 'Local QA template', active: true })
  tplId = tpl.json?.id
  const t1 = await owner.call(`/v1/onboarding/templates/${tplId}/tasks`, 'POST', { title: 'QA: sign the handbook', dueOffsetDays: 1, required: true, sequenceNo: 1, ownerRole: 'HR_MANAGER' })
  const t2 = await owner.call(`/v1/onboarding/templates/${tplId}/tasks`, 'POST', { title: 'QA: say hello to the team', dueOffsetDays: 2, required: false, sequenceNo: 2 })
  const t3 = await owner.call(`/v1/onboarding/templates/${tplId}/tasks`, 'POST', { title: 'QA: task to be removed', dueOffsetDays: 3, required: false, sequenceNo: 3 })
  check('fixture: template with three tasks', !!tplId && [t1, t2, t3].every((t) => t.status < 300), `${tpl.status} ${t1.status} ${t2.status} ${t3.status}`)
  const other = await owner.call('/v1/onboarding/templates', 'POST', { companyId: company, name: `${tplName} (other)`, active: true })
  otherTplId = other.json?.id
  const run = await owner.call('/v1/onboarding/instances', 'POST', { employeeId: reader.employeeId, templateId: tplId })
  runId = run.json?.id
  check('fixture: onboarding started for the employee', run.status === 201 && !!runId, `${run.status} ${JSON.stringify(run.json).slice(0, 160)}`)

  // ── API: removing a used template task ──
  const wrong = await owner.call(`/v1/onboarding/templates/${otherTplId}/tasks/${t3.json?.id}`, 'DELETE')
  check('api: a task id from another template is a 404', wrong.status === 404, `status=${wrong.status}`)
  const del = await owner.call(`/v1/onboarding/templates/${tplId}/tasks/${t3.json?.id}`, 'DELETE')
  check('api: removing a task a started onboarding uses works (was a 500)', del.status === 204, `status=${del.status}`)
  const kept = sql(`select count(*) from hrms.onboarding_instance_tasks where instance_id='${runId}' and title='QA: task to be removed' and task_id is null`)
  check('api: the started onboarding keeps its copy of the removed task', kept === '1', `rows=${kept}`)

  // ── owner (HR) ──
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/onboarding/instances'); await settle(o.page)
  for (const v of ['New hires', 'Assets', 'Checklist templates']) check(`owner: "${v}" view`, (await views(o.page).getByRole('button', { name: new RegExp(`^${v}`) }).count()) === 1)
  for (const t of ['All onboarding', 'In progress', 'Completed', 'On hold']) check(`owner: "${t}" tile`, (await o.page.getByText(t, { exact: true }).count()) > 0)
  check('owner: "Start onboarding" button', (await o.page.getByRole('button', { name: 'Start onboarding' }).count()) === 1)
  const readerName = sql(`select first_name||' '||coalesce(last_name,'') from hrms.employees where id='${reader.employeeId}'`).trim()
  const row = o.page.getByRole('row').filter({ hasText: readerName }).first()
  check('owner: the new hire’s row shows their name and checklist progress', (await row.count()) === 1 && /0\/3/.test(await row.innerText()), readerName)
  await o.page.goto(base + `/hrms/onboarding/instances/${runId}`); await settle(o.page)
  check('owner: checklist page is titled with the hire’s name', (await o.page.getByRole('heading', { name: `${readerName}’s onboarding` }).count()) === 1)
  check('owner: checklist shows the removed task as the run’s own copy', (await o.page.getByText('QA: task to be removed').count()) === 1)
  check('owner: "Put on hold" is offered', (await o.page.getByRole('button', { name: 'Put on hold' }).count()) === 1)
  await o.page.goto(base + '/hrms/onboarding/instances?view=templates'); await settle(o.page)
  check('owner: templates view lists the QA template', (await o.page.getByText(tplName, { exact: true }).count()) === 1)
  await o.page.getByText(tplName, { exact: true }).click(); await settle(o.page)
  check('owner: template page shows its tasks in order', (await o.page.getByText('Tasks, in order').count()) === 1 && (await o.page.getByText('QA: sign the handbook').count()) === 1)
  check('owner: owner role reads "HR manager"', (await o.page.getByText('HR manager', { exact: true }).count()) > 0)
  await o.page.goto(base + '/hrms/onboarding/instances?view=assets'); await settle(o.page)
  check('owner: assets view with tiles', (await o.page.getByText('With employees', { exact: true }).count()) === 1 && (await o.page.getByRole('button', { name: /Register asset/ }).count()) === 1)
  await o.page.goto(base + '/hrms/onboarding/instances/new'); await settle(o.page)
  check('owner: the new-hire wizard opens in the kit frame', (await o.page.getByText('Step 1 of', { exact: false }).count()) === 1)
  check('owner: no refused API calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()

  // ── employee ──
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/onboarding/instances'); await settle(r.page)
  check('employee: sees "Your onboarding", not the HR table', (await r.page.getByRole('table').count()) === 0 && (await r.page.getByText(/^Onboarding started /).count()) >= 1)
  check('employee: no "Start onboarding"', (await r.page.getByRole('button', { name: 'Start onboarding' }).count()) === 0)
  await r.page.goto(base + `/hrms/onboarding/instances/${runId}`); await settle(r.page)
  check('employee: checklist titled "Your onboarding"', (await r.page.getByRole('heading', { name: 'Your onboarding' }).count()) === 1)
  check('employee: can’t put it on hold', (await r.page.getByRole('button', { name: 'Put on hold' }).count()) === 0)
  const item = r.page.locator('article').filter({ hasText: 'QA: say hello to the team' })
  await item.getByRole('button', { name: 'Mark done' }).click()
  await r.page.getByText('Task done', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  await settle(r.page)
  check('employee: ticks off a task', (await item.getByText('Done', { exact: true }).count()) === 1)
  check('employee: no refused API calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  // ── department manager ──
  const m = await session('mgr@unifiedtree.demo')
  await m.page.goto(base + '/hrms/onboarding/instances?view=assets'); await settle(m.page)
  check('manager: assets view opens', (await m.page.getByText('With employees', { exact: true }).count()) === 1)
  check('manager: read-only (no "Register asset")', (await m.page.getByRole('button', { name: /Register asset/ }).count()) === 0)
  check('manager: no templates view', (await views(m.page).getByRole('button', { name: /^Checklist templates/ }).count()) === 0)
  check('manager: no refused API calls or page errors', !m.failed.length && !m.errors.length, m.failed[0] || m.errors[0] || '')
  await m.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  if (runId) sql(`delete from hrms.onboarding_instances where id='${runId}'`)
  for (const id of [tplId, otherTplId].filter(Boolean)) { sql(`delete from hrms.onboarding_tasks where template_id='${id}'`); sql(`delete from hrms.onboarding_templates where id='${id}'`) }
  const left = sql(`select count(*) from hrms.onboarding_templates where name like 'QA onboarding %'`)
  check('cleanup: no QA templates left', left === '0', `left=${left}`)
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
