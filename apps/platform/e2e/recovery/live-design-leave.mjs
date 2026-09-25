// Live check of the redesigned Leave page (ModuleKit) against the local API:
//  - employee: the Self-service nav has Leave; views are My leave / Apply /
//    Balances / Calendar / Leave types / Holidays, no Approvals; applying for
//    Fri–Mon previews 2 days (the company's Sat+Sun skipped); the request shows
//    as Pending; no refused (403) API calls
//  - approver (owner): the request is in Approvals as a card and approving it
//    saves; the employee then cancels it through the confirm dialog
// The request is removed and the balance put back at the end.
//
//   node e2e/recovery/live-design-leave.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || ''
const READER = '22222222-2222-2222-2222-222222222222'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const balances0 = sql(`select coalesce(string_agg(leave_type_id||':'||used||':'||pending, ',' order by leave_type_id),'') from leave_mgmt.leave_balances where employee_id='${READER}' and year=extract(year from current_date)`)
const before = new Set(sql(`select coalesce(string_agg(id::text, ','),'') from leave_mgmt.leave_requests where employee_id='${READER}'`).split(',').filter(Boolean))
// A Friday 10+ days out, to the Monday after.
const fri = new Date(Date.now() + 5.5 * 3600e3 + 10 * 864e5); while (fri.getUTCDay() !== 5) fri.setUTCDate(fri.getUTCDate() + 1)
const mon = new Date(fri.getTime() + 3 * 864e5)
const iso = (d) => d.toISOString().slice(0, 10)

const browser = await chromium.launch()
const session = async (email) => {
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
const toast = (page, re) => page.locator('[role=status],[role=alert]').filter({ hasText: re }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
let reqId = null

try {
  // ── employee applies ──
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/me'); await settle(r.page)
  check('employee: Self-service tabs include Leave', (await r.page.getByRole('link', { name: 'Leave', exact: true }).count()) > 0)
  await r.page.goto(base + '/hrms/leave'); await settle(r.page)
  const views = await r.page.getByRole('navigation', { name: 'Leave views' }).innerText().catch(async () => r.page.locator('[aria-label="Leave views"]').innerText())
  check('employee: views are My leave, Apply, Balances, Calendar, Leave types, Holidays', ['My leave', 'Apply', 'Balances', 'Calendar', 'Leave types', 'Holidays'].every((v) => views.includes(v)) && !views.includes('Approvals'), views.replace(/\s+/g, ' '))
  await r.page.getByRole('button', { name: /Apply for leave/ }).first().click(); await settle(r.page)
  await r.page.getByRole('button', { name: 'Choose a leave type' }).click()
  await r.page.getByRole('option').first().click()
  await r.page.getByLabel('From *').fill(iso(fri))
  await r.page.getByLabel('To *').fill(iso(mon))
  await r.page.getByPlaceholder('At least 10 characters').fill('Local QA: redesigned leave page check')
  check('employee: Fri–Mon previews 2 days (Sat and Sun are off)', (await r.page.getByText(/^2 days of leave/).count()) === 1)
  if (shots) await r.page.screenshot({ path: `${shots}/leave-apply-filled.png` })
  await r.page.getByRole('button', { name: 'Send request' }).click()
  check('employee: sending shows the confirmation', await toast(r.page, /Leave request sent/))
  const after = sql(`select coalesce(string_agg(id::text, ','),'') from leave_mgmt.leave_requests where employee_id='${READER}'`).split(',').filter((x) => x && !before.has(x))
  reqId = after[0] || null
  check('employee: the request is saved for 2 days', !!reqId && sql(`select total_days from leave_mgmt.leave_requests where id='${reqId}'`).startsWith('2'), `id=${reqId}`)
  await settle(r.page)
  check('employee: My leave lists it as Pending', (await r.page.getByText(/Pending|Awaiting HR/).count()) > 0)
  check('employee: no refused API calls', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')

  // ── approver decides ──
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/leave?tab=approvals'); await settle(o.page)
  const card = o.page.locator('article').filter({ hasText: 'Reader User' }).filter({ hasText: 'Local QA: redesigned leave page check' }).first()
  const inQueue = (await card.count()) > 0
  check('approver: the request is in Approvals as a card', inQueue)
  if (inQueue) {
    await card.locator('textarea').fill('Local QA approval')
    await card.getByRole('button', { name: 'Approve' }).click()
    check('approver: approving saves', await toast(o.page, /Leave approved/) && ['APPROVED', 'PENDING_L2'].includes(sql(`select status from leave_mgmt.leave_requests where id='${reqId}'`)), sql(`select status from leave_mgmt.leave_requests where id='${reqId}'`))
  }
  if (shots) await o.page.screenshot({ path: `${shots}/leave-approvals.png` })
  check('approver: no page errors', !o.errors.length, o.errors[0] || '')

  // ── employee cancels ──
  await r.page.goto(base + '/hrms/leave?tab=my'); await settle(r.page)
  const row = r.page.locator('div,button').filter({ hasText: 'Local QA: redesigned leave page check' }).last()
  await r.page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
  await r.page.getByRole('dialog').getByRole('button', { name: 'Cancel leave' }).click()
  check('employee: cancelling through the dialog saves', await toast(r.page, /Leave cancelled/) && sql(`select status from leave_mgmt.leave_requests where id='${reqId}'`) === 'CANCELLED')
  void row
  await r.ctx.close(); await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  try {
    if (reqId) sql(`delete from leave_mgmt.leave_requests where id='${reqId}'`)
    for (const b of balances0.split(',').filter(Boolean)) { const [t, used, pending] = b.split(':'); sql(`update leave_mgmt.leave_balances set used=${used}, pending=${pending} where employee_id='${READER}' and leave_type_id='${t}' and year=extract(year from current_date)`) }
  } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
