// Live check of "Remove" on the Ask payroll queue (DELETE /v1/payroll/queries/{id}).
//
//   live-slot.sh /c/REACT/ut-wt/w18-payq 3018 node e2e/recovery/live-payslip-query-remove.mjs
//   (or RECOVERY_APP_URL=… RECOVERY_API_URL=… RECOVERY_DB=… node e2e/recovery/live-payslip-query-remove.mjs)
//
// The reader asks about their own final payslip, fin answers, and HR (hrm, which holds
// payroll.queries.answer) removes it: first through the API rules (who may, which state,
// another workspace's id), then through the real Remove button on the payroll dashboard.
// READ-ONLY on payroll runs: nothing is processed, locked or paid.
// It creates, and removes at the end: two questions, one question planted under another
// workspace id (straight in the database), and their notifications and audit rows.
/* global process, console, fetch, crypto */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3018'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const otherTenant = 'bbbbbbbb-0000-4000-8000-00000000f0f0'
const shots = 'C:/REACT/ut-wt/_results/shots'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const unexpected = []

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 500) unexpected.push(`${email} ${method} ${path} → ${res.status} ${json?.errorCode ?? ''}`)
    return { status: res.status, json }
  }
  return { email, call, employeeId: d.employeeId }
}

const hrm = await session('hrm@unifiedtree.demo')
const fin = await session('fin@unifiedtree.demo')
const mgr = await session('mgr@unifiedtree.demo')
const reader = await session('reader@unifiedtree.demo')
const readerId = reader.employeeId || '22222222-2222-2222-2222-222222222222'
const startedAt = sql('select now()')
const stamp = Date.now()
const created = []
let foreignId = null
let browser = null

try {
  const mine = await reader.call('/v1/payroll/payslips/me')
  const slip = (mine.json || []).find((s) => s.status === 'LOCKED' || s.status === 'PAID')
  check('fixture: the reader has a final payslip to ask about', mine.status === 200 && slip, `${mine.status}`)
  if (!slip) throw new Error('no LOCKED or PAID payslip for the reader')

  // ── The rules, through the API ──────────────────────────────────────────────
  const question = `Live remove check ${stamp}: why is my net different?`
  const answer = `Live remove answer ${stamp}: your LOP day is the 2nd.`
  const asked = await reader.call(`/v1/payroll/payslips/me/${slip.runId}/queries`, 'POST', { message: question })
  const id = asked.json?.id
  if (id) created.push(id)
  check('reader asks a question (OPEN)', asked.status === 201 && asked.json?.status === 'OPEN', `${asked.status}`)

  const early = await hrm.call(`/v1/payroll/queries/${id}`, 'DELETE')
  check('an open question can\u2019t be removed (409, answer it first)', early.status === 409 && early.json?.errorCode === 'QUERY_NOT_ANSWERED', `${early.status} ${early.json?.errorCode}`)

  const answered = await fin.call(`/v1/payroll/queries/${id}/answer`, 'POST', { answer })
  check('fin answers it', answered.status === 200 && answered.json?.status === 'ANSWERED', `${answered.status}`)

  const byMgr = await mgr.call(`/v1/payroll/queries/${id}`, 'DELETE')
  const byReader = await reader.call(`/v1/payroll/queries/${id}`, 'DELETE')
  check('a manager and the asker can\u2019t remove it from the queue (403)', byMgr.status === 403 && byReader.status === 403, `mgr ${byMgr.status}, reader ${byReader.status}`)

  foreignId = sql(`insert into payroll.payslip_queries (tenant_id, run_id, employee_id, message, status, answer, answered_at)
    values ('${otherTenant}', '${slip.runId}', '${readerId}', 'Live remove check ${stamp}: another workspace', 'ANSWERED', 'Planted', now())
    returning id`).split(/\r?\n/)[0].trim()
  const foreign = await hrm.call(`/v1/payroll/queries/${foreignId}`, 'DELETE')
  const foreignAfter = sql(`select status from payroll.payslip_queries where id='${foreignId}'`)
  check('another workspace\u2019s question is "not found" (404) and stays as it was', foreign.status === 404 && foreign.json?.errorCode === 'QUERY_NOT_FOUND' && foreignAfter === 'ANSWERED',
    `${foreign.status} ${foreign.json?.errorCode}, ${foreignAfter}`)
  const unknown = await fin.call(`/v1/payroll/queries/${crypto.randomUUID()}`, 'DELETE')
  check('an unknown id is 404', unknown.status === 404, `${unknown.status}`)

  const removed = await hrm.call(`/v1/payroll/queries/${id}`, 'DELETE')
  const row = sql(`select status || '|' || (answer = '${answer}') from payroll.payslip_queries where id='${id}'`)
  check('HR removes the answered question (204); it is kept, marked CLOSED, with its answer', removed.status === 204 && row === 'CLOSED|true', `${removed.status} ${row}`)
  const twice = await fin.call(`/v1/payroll/queries/${id}`, 'DELETE')
  check('removing it again is not an error (204)', twice.status === 204, `${twice.status}`)

  const all = await fin.call('/v1/payroll/queries')
  const ans = await fin.call('/v1/payroll/queries?status=ANSWERED')
  const closed = await fin.call('/v1/payroll/queries?status=CLOSED')
  const has = (r) => (r.json || []).some((x) => x.id === id)
  check('it leaves the queue (All and Answered); status=CLOSED still lists it', all.status === 200 && !has(all) && !has(ans) && has(closed),
    `all ${has(all)}, answered ${has(ans)}, closed ${has(closed)}`)
  const readerAfter = await reader.call(`/v1/payroll/payslips/me/queries?runId=${slip.runId}`)
  const readerRow = (readerAfter.json || []).find((x) => x.id === id)
  check('the employee still sees it, answered, with the answer', readerRow?.status === 'ANSWERED' && readerRow?.answer === answer, JSON.stringify(readerRow?.status))
  const audit = sql(`select count(*) || '|' || coalesce(bool_or(position('${stamp}' in coalesce(summary,'')) > 0), false)
    from audit.events where module='payroll' and action='PAYSLIP_QUERY_REMOVED' and entity_id='${id}'`)
  check('the removal is audited once, without the question\u2019s text', audit === '1|false', audit)

  // ── The Remove button on the payroll dashboard (hrm) ────────────────────────
  const question2 = `Live remove check ${stamp}: button`
  const asked2 = await reader.call(`/v1/payroll/payslips/me/${slip.runId}/queries`, 'POST', { message: question2 })
  const id2 = asked2.json?.id
  if (id2) created.push(id2)
  const answered2 = await fin.call(`/v1/payroll/queries/${id2}/answer`, 'POST', { answer: `Live remove answer ${stamp}: button` })
  check('fixture: a second answered question for the button', asked2.status === 201 && answered2.status === 200, `${asked2.status} ${answered2.status}`)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  const apiErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.request().method()} ${r.url().replace(/^.*\/api/, '')} → ${r.status()}`)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('hrm@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }).catch(() => {})
  await page.goto(base + '/hrms/payroll-dashboard')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
  mkdirSync(shots, { recursive: true })
  // A dialog that opens on its own after sign-in (not part of this check) is noted and closed.
  for (let i = 0; i < 3 && await page.locator('.uko-backdrop').count(); i++) {
    const text = (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
    console.log(`info: a dialog was open on the dashboard, closed with Escape: "${text}"`)
    if (i === 0) await page.screenshot({ path: `${shots}/w18-payq-dialog-1440.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
  const views = page.getByRole('group', { name: 'Payslip question views' })
  await views.getByRole('button', { name: 'Answered', exact: true }).click({ timeout: 30_000 })
  const card = page.locator('article').filter({ hasText: question2 })
  await card.waitFor({ timeout: 30_000 })
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${shots}/w18-payq-before-1440.png` })
  const button = card.getByRole('button', { name: 'Remove' })
  check('the answered question shows Remove, saying the employee keeps the answer',
    (await button.getAttribute('title')) === 'Takes it off this list. The employee still sees the answer.')
  await button.click()
  const toast = await page.getByText('Question removed').first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
  const gone = await card.waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)
  const row2 = sql(`select status from payroll.payslip_queries where id='${id2}'`)
  check('clicking Remove says "Question removed" and the card leaves the list', toast && gone && row2 === 'CLOSED', `toast ${toast}, gone ${gone}, ${row2}`)
  await page.screenshot({ path: `${shots}/w18-payq-after-1440.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await views.getByRole('button', { name: 'All', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByText('Ask payroll', { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: `${shots}/w18-payq-all-390.png` })
  const inAll = await page.locator('article').filter({ hasText: question2 }).count()
  check('it is not under All either', inAll === 0, `${inAll}`)
  const queueErrors = apiErrors.filter((e) => e.includes('/payroll/queries') || e.endsWith('→ 500') || e.endsWith('→ 503'))
  check('no page errors, and no failed queue calls or 5xx on the page', pageErrors.length === 0 && queueErrors.length === 0, [...pageErrors, ...queueErrors].join(' ; '))
  if (apiErrors.length) console.log(`info: other 4xx on the page (not part of this check): ${apiErrors.join(' ; ')}`)
  await ctx.close()
} catch (e) {
  check('run finished', false, e.stack || e.message)
} finally {
  if (browser) await browser.close().catch(() => {})
  try {
    const ids = [...created, foreignId].filter(Boolean).map((x) => `'${x}'`).join(',')
    if (ids) {
      sql(`delete from notif.notifications where type in ('PAYSLIP_QUERY_RAISED','PAYSLIP_QUERY_ANSWERED') and data->>'queryId' in (${ids})`)
      sql(`delete from audit.events where module='payroll' and entity_type='payslip_query' and entity_id in (${ids}) and occurred_at >= '${startedAt}'`)
      sql(`delete from payroll.payslip_queries where id in (${ids})`)
    }
    // Anything else this run created (a failed step may have left a question behind).
    sql(`delete from payroll.payslip_queries where created_at >= '${startedAt}' and message like 'Live remove check ${stamp}%'`)
    const left = sql(`select (select count(*) from payroll.payslip_queries where message like 'Live remove check ${stamp}%') || '|' ||
      (select count(*) from notif.notifications where created_at >= '${startedAt}' and data->>'queryId' in (${ids || "''"})) || '|' ||
      (select count(*) from audit.events where occurred_at >= '${startedAt}' and entity_id::text in (${ids || "''"}))`)
    check('cleanup: nothing this run created is left', left === '0|0|0', left)
  } catch (e) {
    check('cleanup', false, e.message)
  }
}

check('no unexpected 5xx from the API', unexpected.length === 0, unexpected.join(' ; '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
