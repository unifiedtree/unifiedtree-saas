/* global process, console, document, window, setTimeout, Storage, fetch */
// Live check of the paged lists' server-side date range (owner + client, 7 Oct 2026, w66):
//
//  1. Seeds TEST records on each list, one inside March 2025 and one outside it. The timestamp ones sit on either
//     side of India's midnight at the end of the range (31 Mar 23:30 IST in, 1 Apr 00:10 IST out — a UTC filter
//     would take both), and a leave that starts in February but ends on 1 March overlaps the range.
//  2. API, per endpoint: without dates both TEST records are there (today's list); with ?from=2025-03-01&to=2025-03-31
//     only the inside one, and the total matches the database; a backwards or 367-day range is a 400 with a plain
//     message; a list kept to one company (?companyId=) stays kept to it.
//  3. Pages: each opened with ?from=&to= shows the range in its box and its list call carries it; one picked on the
//     calendar (Apply) asks the server for it; Clear drops it.
//  4. Screenshots 1440 and 390 wide (/c/REACT/ut-wt/_results/shots/w66-rangeapi-*.png).
//
// Everything it writes is removed at the end.
//   node e2e/recovery/live-w3-w66-rangeapi.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3266'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const info = (s) => console.log(`INFO  ${s}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const FROM = '2025-03-01', TO = '2025-03-31', RANGE = `from=${FROM}&to=${TO}`
const IN_AT = '2025-03-31 23:30:00+05:30', OUT_AT = '2025-04-01 00:10:00+05:30'
const TAG = `TEST w66 ${Date.now() % 1000000}`
const made = {} // kind → { in, out } ids

// ── seed ──────────────────────────────────────────────────────────────────────
const one = (q) => sql(q).split('\n')[0]
function seed() {
  const leaveType = one(`select id from leave_mgmt.leave_types where tenant_id='${T}' and company_id='${CO}' and is_active order by created_at limit 1`)
  const shift = one(`select id from attendance.shift_policies where tenant_id='${T}' order by name limit 1`)
  const template = one(`select id from letters.templates where tenant_id='${T}' order by created_at limit 1`)
  const fnfPeople = sql(`select id from hrms.employees where tenant_id='${T}' and company_id='${CO}' and employment_status in ('EXITED','TERMINATED') order by employee_code limit 2`).split('\n')
  const leave = (start, end, note) => one(`insert into leave_mgmt.leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, total_days, status, reason, created_at, updated_at)
    values (gen_random_uuid(), '${T}', '${READER}', '${leaveType}', '${start}', '${end}', 1, 'APPROVED', '${TAG} ${note}', now(), now()) returning id`)
  made.leave = { in: leave('2025-02-27', '2025-03-01', 'leave in'), out: leave('2025-01-14', '2025-01-14', 'leave out') }
  const claim = (at, note) => one(`insert into expense_mgmt.expense_claims (tenant_id, employee_id, company_id, title, total_amount, status, submitted_at, created_at, updated_at)
    values ('${T}', '${READER}', '${CO}', '${TAG} ${note}', 100, 'SUBMITTED', '${at}', '${at}', now()) returning id`)
  made.claim = { in: claim(IN_AT, 'claim in'), out: claim(OUT_AT, 'claim out') }
  const adv = (at, note) => one(`insert into advance_mgmt.advance_requests (tenant_id, employee_id, company_id, amount, reason, repayment_months, monthly_deduction, status, outstanding_amount, created_at, updated_at)
    values ('${T}', '${READER}', '${CO}', 1000, '${TAG} ${note}', 2, 500, 'REQUESTED', 1000, '${at}', now()) returning id`)
  made.advance = { in: adv(IN_AT, 'adv in'), out: adv(OUT_AT, 'adv out') }
  const fnf = (who, lwd, note) => one(`insert into fnf_mgmt.fnf_settlements (tenant_id, employee_id, company_id, last_working_day, status, gross_payable, total_deductions, net_settlement, notes, created_at, updated_at)
    values ('${T}', '${who}', '${CO}', '${lwd}', 'INITIATED', 0, 0, 0, '${TAG} ${note}', now(), now()) returning id`)
  made.fnf = { in: fnf(fnfPeople[0], '2025-03-31', 'fnf in'), out: fnf(fnfPeople[1] || fnfPeople[0], '2025-04-01', 'fnf out') }
  const req = (at, note) => one(`insert into hiring_mgmt.job_requisitions (tenant_id, company_id, title, openings, status, created_at, updated_at)
    values ('${T}', '${CO}', '${TAG} ${note}', 1, 'OPEN', '${at}', now()) returning id`)
  made.requisition = { in: req(IN_AT, 'req in'), out: req(OUT_AT, 'req out') }
  const offer = (at, note) => one(`insert into hiring_mgmt.offers (tenant_id, company_id, candidate_name, role_title, offered_ctc, status, created_at, updated_at)
    values ('${T}', '${CO}', '${TAG} ${note}', 'Tester', 100000, 'DRAFT', '${at}', now()) returning id`)
  made.offer = { in: offer(IN_AT, 'offer in'), out: offer(OUT_AT, 'offer out') }
  const letter = (at, note) => one(`insert into letters.generated (tenant_id, company_id, template_id, employee_id, type, subject, body_html_rendered, status, generated_by, created_at, updated_at)
    values ('${T}', '${CO}', '${template}', '${READER}', 'CUSTOM', '${TAG} ${note}', '<p>test</p>', 'GENERATED', '${READER}', '${at}', now()) returning id`)
  made.letter = { in: letter(IN_AT, 'letter in'), out: letter(OUT_AT, 'letter out') }
  const job = (at, note) => one(`insert into letters.distribution_jobs (tenant_id, template_id, title, created_by, created_at, status, total_recipients, sent_count, failed_count)
    values ('${T}', '${template}', '${TAG} ${note}', '${READER}', '${at}', 'COMPLETED', 0, 0, 0) returning id`)
  made.distribution = { in: job(IN_AT, 'dist in'), out: job(OUT_AT, 'dist out') }
  const doc = (at, note) => one(`insert into document_mgmt.employee_documents (tenant_id, employee_id, company_id, title, category, file_url, created_at, updated_at)
    values ('${T}', '${READER}', '${CO}', '${TAG} ${note}', 'OTHER', 'test://w66', '${at}', now()) returning id`)
  made.document = { in: doc(IN_AT, 'doc in'), out: doc(OUT_AT, 'doc out') }
  const scr = (eff, note) => one(`insert into attendance.shift_change_requests (id, tenant_id, employee_id, requested_shift_policy_id, reason, status, decision_note, decided_at, created_at, updated_at, requested_effective_date, applied_effective_date)
    values (gen_random_uuid(), '${T}', '${READER}', '${shift}', '${TAG}', 'APPROVED', '${TAG} ${note}', now(), now(), now(), '${eff}', '${eff}') returning id`)
  made.shift = { in: scr('2025-03-31', 'shift in'), out: scr('2025-04-01', 'shift out') }
}

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  q(`delete from leave_mgmt.leave_requests where tenant_id='${T}' and reason like '${TAG}%'`)
  q(`delete from expense_mgmt.expense_claims where tenant_id='${T}' and title like '${TAG}%'`)
  q(`delete from advance_mgmt.advance_requests where tenant_id='${T}' and reason like '${TAG}%'`)
  q(`delete from fnf_mgmt.fnf_settlements where tenant_id='${T}' and notes like '${TAG}%'`)
  q(`delete from hiring_mgmt.job_requisitions where tenant_id='${T}' and title like '${TAG}%'`)
  q(`delete from hiring_mgmt.offers where tenant_id='${T}' and candidate_name like '${TAG}%'`)
  q(`delete from letters.generated where tenant_id='${T}' and subject like '${TAG}%'`)
  q(`delete from letters.distribution_jobs where tenant_id='${T}' and title like '${TAG}%'`)
  q(`delete from document_mgmt.employee_documents where tenant_id='${T}' and title like '${TAG}%'`)
  q(`delete from attendance.shift_change_requests where tenant_id='${T}' and reason = '${TAG}'`)
  const left = sql(`select (select count(*) from leave_mgmt.leave_requests where reason like '${TAG}%') + (select count(*) from expense_mgmt.expense_claims where title like '${TAG}%')
    + (select count(*) from advance_mgmt.advance_requests where reason like '${TAG}%') + (select count(*) from fnf_mgmt.fnf_settlements where notes like '${TAG}%')
    + (select count(*) from hiring_mgmt.job_requisitions where title like '${TAG}%') + (select count(*) from hiring_mgmt.offers where candidate_name like '${TAG}%')
    + (select count(*) from letters.generated where subject like '${TAG}%') + (select count(*) from letters.distribution_jobs where title like '${TAG}%')
    + (select count(*) from document_mgmt.employee_documents where title like '${TAG}%') + (select count(*) from attendance.shift_change_requests where reason = '${TAG}')`)
  check('Cleanup: every TEST record is gone', left === '0', `${left} left`)
}

// ── API ───────────────────────────────────────────────────────────────────────
const apiErrors = []
async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': T }, body: JSON.stringify({ tenantId: T, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  return async (path, { expect = 200 } = {}) => {
    const res = await fetch(api + path, { headers: { 'X-Tenant-ID': T, Authorization: `Bearer ${d.accessToken}` } })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (res.status >= 400 && res.status !== expect) apiErrors.push(`${res.status} GET ${path} ${text.slice(0, 160)}`)
    return { status: res.status, json }
  }
}
const rowsOf = (j) => (Array.isArray(j) ? j : j?.content ?? [])
const ids = (j) => rowsOf(j).map((x) => x.id ?? x.recordId)
const totalOf = (j) => (Array.isArray(j) ? j.length : j?.totalElements)

/** One endpoint: default unchanged, the range keeps only the inside record (and the database agrees), bad ranges refused. */
async function endpoint(call, name, path, kind, dbCount) {
  const sep = path.includes('?') ? '&' : '?'
  const all = await call(path)
  const pair = made[kind]
  check(`${name}: without dates both TEST records are listed (as before)`, all.status === 200 && ids(all.json).includes(pair.in) && ids(all.json).includes(pair.out), `status ${all.status}, ${rowsOf(all.json).length} rows`)
  const r = await call(`${path}${sep}${RANGE}`)
  check(`${name}: with the range only the one inside it`, r.status === 200 && ids(r.json).includes(pair.in) && !ids(r.json).includes(pair.out), `status ${r.status}, ${rowsOf(r.json).length} rows`)
  if (dbCount) {
    const want = Number(sql(dbCount))
    check(`${name}: the range's total matches the database (${want})`, totalOf(r.json) === want, `api ${totalOf(r.json)}`)
  }
  const back = await call(`${path}${sep}from=${TO}&to=${FROM}`, { expect: 400 })
  check(`${name}: a backwards range is a 400 in plain words`, back.status === 400 && /start date must be on or before the end date/.test(back.json?.message || ''), `${back.status} ${back.json?.message || ''}`)
  const long = await call(`${path}${sep}from=2025-01-01&to=2026-01-02`, { expect: 400 })
  check(`${name}: more than 366 days is a 400`, long.status === 400 && /366 days or fewer/.test(long.json?.message || ''), `${long.status} ${long.json?.message || ''}`)
}

// ── browser ───────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const markPromptShown = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const day = ['year', 'month', 'day'].map((t) => p.find((x) => x.type === t)?.value ?? '').join('-')
  const original = Storage.prototype.getItem
  Storage.prototype.getItem = function (key) { return typeof key === 'string' && key.startsWith('ut.punch-prompt.opened:') ? day : original.call(this, key) }
}
async function session(email, { width = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript(markPromptShown)
  const page = await ctx.newPage()
  const errors = [], failed = [], requests = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('request', (r) => { if (r.url().includes('/api/v1/')) requests.push(decodeURIComponent(r.url().split('/api')[1])) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { ctx, page, errors, failed, requests }
}
const sawRequest = async (s, re, ms = 15_000) => {
  for (let t = 0; t < ms; t += 300) { const hit = s.requests.find((u) => re.test(u)); if (hit) return hit; await sleep(300) }
  return null
}
let shotIdx = 0
const shot = async (page, name) => { await page.screenshot({ path: `${SHOTS}/w66-rangeapi-${String(++shotIdx).padStart(2, '0')}-${name}.png`, fullPage: false }) }
const BOX = '01/03/2025 – 31/03/2025'

/** A page opened with ?from=&to=: the box shows the range, the list asks the server for it, the inside record shows. */
async function pageWith(s, p) {
  s.requests.length = 0
  const errs = s.errors.length
  const keys = p.keys || { from: 'from', to: 'to' }
  await s.page.goto(`${base}${p.path}${p.path.includes('?') ? '&' : '?'}${keys.from}=${FROM}&${keys.to}=${TO}`, { timeout: 60_000 })
  const box = s.page.locator(`[data-filter="${p.key}"]`).first()
  const present = await box.waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check(`${p.name}: the calendar box is there`, present)
  if (!present) return
  check(`${p.name}: the box shows the range from the link`, ((await box.textContent()) || '').includes(BOX), ((await box.textContent()) || '').trim())
  const hit = await sawRequest(s, p.api)
  check(`${p.name}: the list's request carries ?from=&to=`, !!hit, hit || `none of ${s.requests.length} calls matched ${p.api}`)
  if (p.inText) {
    const inside = await s.page.getByText(p.inText).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check(`${p.name}: the record inside the range is shown`, inside)
    check(`${p.name}: the record outside it is not`, (await s.page.getByText(p.outText).count()) === 0)
  }
  check(`${p.name}: no page errors`, s.errors.length === errs, s.errors.slice(errs).join(' | '))
  if (p.shot) { await sleep(500); await shot(s.page, p.shot) }
}

const pop = (page) => page.locator('.urf-pop, [role="dialog"]:has(.udr)').first()

try {
  cleanup() // a previous run that stopped half-way
  results.length = 0
  seed()
  info(`seeded ${Object.keys(made).length} kinds of TEST records (${TAG})`)

  const owner = await apiLogin('owner@unifiedtree.demo')
  const reader = await apiLogin('reader@unifiedtree.demo')
  const S = `'${FROM}'::date`, E = `'${TO}'::date`
  const tsIn = (col) => `${col} >= (${S})::timestamp at time zone 'Asia/Kolkata' and ${col} < (${E} + 1)::timestamp at time zone 'Asia/Kolkata'`

  // ── API, per endpoint ──────────────────────────────────────────────────────
  await endpoint(reader, 'Leave · my requests', '/v1/leave/my?size=100', 'leave',
    `select count(*) from leave_mgmt.leave_requests where employee_id='${READER}' and start_date <= ${E} and end_date >= ${S}`)
  await endpoint(owner, 'Leave · decided', '/v1/leave/approvals/history?size=100', 'leave',
    `select count(*) from leave_mgmt.leave_requests where tenant_id='${T}' and status <> 'PENDING' and start_date <= ${E} and end_date >= ${S}`)
  const counts = (await owner(`/v1/leave/approvals/history?size=100&${RANGE}`)).json?.counts
  const wantApproved = Number(sql(`select count(*) from leave_mgmt.leave_requests where tenant_id='${T}' and status = 'APPROVED' and start_date <= ${E} and end_date >= ${S}`))
  check('Leave · decided: the counts follow the range', counts?.APPROVED === wantApproved, JSON.stringify(counts))
  const onlyApproved = await owner(`/v1/leave/approvals/history?size=100&status=APPROVED&${RANGE}`)
  check('Leave · decided: a status and a range together', ids(onlyApproved.json).includes(made.leave.in) && !ids(onlyApproved.json).includes(made.leave.out))
  await endpoint(owner, 'Leave · a person\'s requests', `/v1/leave/employees/${READER}/requests?size=100`, 'leave',
    `select count(*) from leave_mgmt.leave_requests where employee_id='${READER}' and start_date <= ${E} and end_date >= ${S}`)
  const notMine = await reader(`/v1/leave/employees/44444444-4444-4444-4444-444444444444/requests?${RANGE}`, { expect: 403 })
  check('Leave · a person\'s requests: someone else\'s are still refused with dates', notMine.status === 403, String(notMine.status))
  await endpoint(reader, 'Expenses · my claims', '/v1/expense/my?size=100', 'claim',
    `select count(*) from expense_mgmt.expense_claims where employee_id='${READER}' and ${tsIn('coalesce(submitted_at, created_at)')}`)
  await endpoint(owner, 'Expenses · approvals', '/v1/expense/claims/approvals?size=100', 'claim',
    `select count(*) from expense_mgmt.expense_claims where tenant_id='${T}' and status in ('SUBMITTED','APPROVED') and ${tsIn('coalesce(submitted_at, created_at)')}`)
  await endpoint(owner, 'Advances', '/v1/advance/requests?size=100', 'advance',
    `select count(*) from advance_mgmt.advance_requests where tenant_id='${T}' and ${tsIn('created_at')}`)
  const advPending = await owner(`/v1/advance/requests?size=100&status=REQUESTED&${RANGE}`)
  check('Advances: a status and a range together', ids(advPending.json).includes(made.advance.in) && !ids(advPending.json).includes(made.advance.out))
  await endpoint(owner, 'Full & final', '/v1/fnf/settlements?size=100', 'fnf',
    `select count(*) from fnf_mgmt.fnf_settlements where tenant_id='${T}' and last_working_day between ${S} and ${E}`)
  // Exits: the demo data's leavers (no TEST rows): the range's total is the database's.
  for (const [status, f, t] of [['EXITED', '2026-09-22', '2026-09-22'], ['TERMINATED', '2026-09-01', '2026-09-30'], ['NOTICE_PERIOD', '2026-09-01', '2026-12-31']]) {
    const want = Number(sql(`select count(*) from hrms.employees where tenant_id='${T}' and is_active and company_id='${CO}' and employment_status='${status}' and last_working_day between '${f}' and '${t}'`))
    const all = Number(sql(`select count(*) from hrms.employees where tenant_id='${T}' and is_active and company_id='${CO}' and employment_status='${status}'`))
    const r = await owner(`/v1/hrms/employees/exits?status=${status}&pageSize=200&companyId=${CO}&from=${f}&to=${t}`)
    const d = await owner(`/v1/hrms/employees/exits?status=${status}&pageSize=200&companyId=${CO}`)
    check(`Exits · ${status}: the range's total matches the database (${want} of ${all})`, r.json?.totalElements === want && d.json?.totalElements === all, `api ${r.json?.totalElements} / ${d.json?.totalElements}`)
    check(`Exits · ${status}: every row's last working day is inside`, rowsOf(r.json).every((x) => x.lastWorkingDay >= f && x.lastWorkingDay <= t))
  }
  const exitBad = await owner(`/v1/hrms/employees/exits?status=EXITED&from=${TO}&to=${FROM}`, { expect: 400 })
  check('Exits: a backwards range is a 400', exitBad.status === 400, String(exitBad.status))
  await endpoint(owner, 'Hiring · requisitions', '/v1/hiring/requisitions?size=100', 'requisition',
    `select count(*) from hiring_mgmt.job_requisitions where tenant_id='${T}' and ${tsIn('created_at')}`)
  await endpoint(owner, 'Hiring · offers', '/v1/hiring/offers?size=100', 'offer',
    `select count(*) from hiring_mgmt.offers where tenant_id='${T}' and ${tsIn('created_at')}`)
  const otherCo = '99999999-9999-9999-9999-999999999999'
  for (const [name, path, kind] of [['Hiring · offers', '/v1/hiring/offers', 'offer'], ['Hiring · requisitions', '/v1/hiring/requisitions', 'requisition']]) {
    const mine = await owner(`${path}?size=100&companyId=${CO}&${RANGE}`)
    const other = await owner(`${path}?size=100&companyId=${otherCo}&${RANGE}`)
    check(`${name}: one company's list stays that company's with dates`, ids(mine.json).includes(made[kind].in) && !ids(other.json).includes(made[kind].in), `${rowsOf(mine.json).length} / ${rowsOf(other.json).length}`)
  }
  await endpoint(owner, 'Letters · generated', '/v1/letters/generated?size=100', 'letter',
    `select count(*) from letters.generated where tenant_id='${T}' and deleted_at is null and ${tsIn('created_at')}`)
  const theirs = await owner(`/v1/letters/generated?size=100&employeeId=${READER}&${RANGE}`)
  check('Letters · generated: one person\'s letters with dates', ids(theirs.json).includes(made.letter.in) && !ids(theirs.json).includes(made.letter.out))
  await endpoint(owner, 'Letters · distributions', '/v1/letters/distributions?size=100', 'distribution',
    `select count(*) from letters.distribution_jobs where tenant_id='${T}' and ${tsIn('created_at')}`)
  await endpoint(owner, 'Documents · a person\'s file', `/v1/document/employee/${READER}?size=100`, 'document',
    `select count(*) from document_mgmt.employee_documents where employee_id='${READER}' and ${tsIn('created_at')}`)
  await endpoint(owner, 'Shift requests · decided', '/v1/shifts/change-requests/decided?days=30', 'shift')
  const sr = await owner(`/v1/shifts/change-requests/decided?${RANGE}`)
  check('Shift requests · decided: every row starts inside the range', rowsOf(sr.json).every((x) => { const d = x.appliedEffectiveDate || x.requestedEffectiveDate; return d >= FROM && d <= TO }), `${rowsOf(sr.json).length} rows`)
  // Recent manual entries: the server took from / to before this change; the card now sends them.
  const me = await owner(`/v1/attendance/manual-entries?limit=100&from=2026-09-01&to=2026-09-30`)
  check('Manual entries: every row is inside the range asked', me.status === 200 && rowsOf(me.json).every((x) => x.date >= '2026-09-01' && x.date <= '2026-09-30'), `${me.status}, ${rowsOf(me.json).length} rows`)

  check('API: no unexpected errors', apiErrors.length === 0, apiErrors.slice(0, 5).join(' | '))

  // ── pages ─────────────────────────────────────────────────────────────────
  const o = await session('owner@unifiedtree.demo')
  const R = (p) => new RegExp(`${p}.*from=${FROM}&to=${TO}`)
  const OWNER_PAGES = [
    { name: 'Leave · Decided', path: '/hrms/leave?tab=history', key: 'decided-leave-dates', api: R('/v1/leave/approvals/history\\?'), inText: `${TAG} leave in`, outText: `${TAG} leave out`, shot: 'leave-decided-1440' },
    { name: 'Employee · Leave requests', path: `/hrms/employees/${READER}?tab=leave`, key: 'employee-leave-dates', api: R(`/v1/leave/employees/${READER}/requests\\?`), inText: `${TAG} leave in`, outText: `${TAG} leave out` },
    { name: 'Expenses · Approvals', path: '/hrms/expenses?tab=approvals', key: 'claim-approval-dates', api: R('/v1/expense/claims/approvals\\?'), inText: `${TAG} claim in`, outText: `${TAG} claim out`, shot: 'expense-approvals-1440' },
    { name: 'Advances & loans', path: '/hrms/advances', key: 'advance-dates', api: R('/v1/advance/requests\\?'), inText: `${TAG} adv in`.slice(0, 40), outText: `${TAG} adv out`.slice(0, 40), shot: 'advances-1440' },
    { name: 'Full & final', path: '/hrms/fnf', key: 'fnf-dates', api: R('/v1/fnf/settlements\\?'), shot: 'fnf-1440' },
    { name: 'Resignation & exit', path: '/hrms/exit?tab=exited', key: 'exit-dates', api: R('/v1/hrms/employees/exits\\?'), shot: 'exits-1440' },
    { name: 'Hiring · Requisitions', path: '/hrms/hiring?tab=requisitions', key: 'requisition-dates', api: R('/v1/hiring/requisitions\\?'), inText: `${TAG} req in`, outText: `${TAG} req out` },
    { name: 'Hiring · Offers', path: '/hrms/hiring?tab=offers', key: 'offer-dates', api: R('/v1/hiring/offers\\?'), inText: `${TAG} offer in`, outText: `${TAG} offer out`, shot: 'offers-1440' },
    { name: 'Letters · Generated', path: '/hrms/letters/generated', key: 'letter-dates', api: R('/v1/letters/generated\\?') },
    { name: 'Letters · Distributions', path: '/hrms/letters/distributions', key: 'distribution-dates', api: R('/v1/letters/distributions\\?'), inText: `${TAG} dist in`, outText: `${TAG} dist out` },
    { name: 'Employee · Documents', path: `/hrms/employees/${READER}?tab=documents`, key: 'employee-document-dates', api: R(`/v1/document/employee/${READER}\\?`), inText: `${TAG} doc in`, outText: `${TAG} doc out` },
    { name: 'Shift requests · Already decided', path: '/hrms/shifts?tab=requests', keys: { from: 'decidedFrom', to: 'decidedTo' }, key: 'decided-shift-dates', api: R('/v1/shifts/change-requests/decided\\?'), inText: `${TAG} shift in`, outText: `${TAG} shift out`, shot: 'shift-requests-1440' },
    { name: 'Manual entry · Recent entries', path: '/hrms/attendance/manual-entry', key: 'manual-entry-dates', api: R('/v1/attendance/manual-entries\\?'), shot: 'manual-entry-1440' },
  ]
  for (const p of OWNER_PAGES) {
    try { await pageWith(o, p) } catch (e) { check(`${p.name}: opened with a range`, false, String(e.message || e).split('\n')[0]) }
  }

  // Picked on the calendar: Leave · Decided, March 2025 through the month and year grids, Apply → the server is asked.
  try {
    await o.page.goto(base + '/hrms/leave?tab=history')
    const box = o.page.locator('[data-filter="decided-leave-dates"]').first()
    await box.waitFor({ timeout: 30_000 })
    o.requests.length = 0
    await box.click()
    await pop(o.page).waitFor({ timeout: 10_000 })
    await pop(o.page).locator('.udr-title').first().click() // months
    for (let i = 0; i < 4 && !(await pop(o.page).locator('[data-month="2025-03"]').count()); i++) await pop(o.page).getByRole('button', { name: 'Previous year' }).click()
    await pop(o.page).locator('[data-month="2025-03"]').click()
    await pop(o.page).locator(`[data-day="${FROM}"]`).click()
    await pop(o.page).locator(`[data-day="${TO}"]`).click()
    await shot(o.page, 'leave-decided-picking-1440')
    await pop(o.page).getByRole('button', { name: 'Apply' }).click()
    await o.page.waitForURL((u) => u.searchParams.get('from') === FROM && u.searchParams.get('to') === TO, { timeout: 10_000 })
    const hit = await sawRequest(o, R('/v1/leave/approvals/history\\?page=0'))
    check('Leave · Decided: a range picked on the calendar is asked of the server, from page 1', !!hit, hit || o.requests.join(' , '))
    await o.page.getByText(`${TAG} leave in`).first().waitFor({ timeout: 15_000 })
    check('Leave · Decided: after Apply only the record inside shows', (await o.page.getByText(`${TAG} leave out`).count()) === 0)
    o.requests.length = 0
    await box.click()
    await pop(o.page).getByRole('button', { name: 'Clear' }).click()
    await o.page.waitForURL((u) => !u.searchParams.get('from'), { timeout: 10_000 })
    // The list without dates may still be fresh in the cache (asked for when the page opened): what counts is that
    // the record outside March is listed again and no request carries dates any more.
    const back = await o.page.getByText(`${TAG} leave out`).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check('Leave · Decided: Clear lists every decision again', back && !o.requests.some((u) => /approvals\/history\?.*from=/.test(u)), o.requests.join(' , '))
  } catch (e) { check('Leave · Decided: picking on the calendar', false, String(e.message || e).split('\n')[0]) }

  const oFailed = o.failed.filter((f) => !/^404 GET \/v1\/me\/companies/.test(f))
  check('Owner pages: no API errors', oFailed.length === 0, oFailed.slice(0, 6).join(' | '))
  await o.ctx.close()

  // An employee's own lists.
  const r = await session('reader@unifiedtree.demo')
  for (const p of [
    { name: 'Leave · My leave', path: '/hrms/leave?tab=my', key: 'my-leave-dates', api: R('/v1/leave/my\\?'), inText: `${TAG} leave in`, outText: `${TAG} leave out`, shot: 'my-leave-1440' },
    { name: 'Expenses · My claims', path: '/hrms/expenses?tab=my', key: 'my-claim-dates', api: R('/v1/expense/my\\?'), inText: `${TAG} claim in`, outText: `${TAG} claim out`, shot: 'my-claims-1440' },
  ]) {
    try { await pageWith(r, p) } catch (e) { check(`${p.name}: opened with a range`, false, String(e.message || e).split('\n')[0]) }
  }
  const rFailed = r.failed.filter((f) => !/^404 GET \/v1\/me\/companies/.test(f))
  check('Employee pages: no API errors', rFailed.length === 0, rFailed.slice(0, 6).join(' | '))
  await r.ctx.close()

  // ── phone ─────────────────────────────────────────────────────────────────
  const ph = await session('owner@unifiedtree.demo', { width: 390 })
  for (const [path, key, name] of [['/hrms/leave?tab=history', 'decided-leave-dates', 'leave-decided-390'], ['/hrms/fnf', 'fnf-dates', 'fnf-390'],
    ['/hrms/hiring?tab=offers', 'offer-dates', 'offers-390'], ['/hrms/exit?tab=exited', 'exit-dates', 'exits-390'], ['/hrms/advances', 'advance-dates', 'advances-390']]) {
    await ph.page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}${RANGE}`)
    const box = ph.page.locator(`[data-filter="${key}"]`).first()
    await box.waitFor({ timeout: 30_000 }).catch(() => {})
    await box.scrollIntoViewIfNeeded().catch(() => {})
    await sleep(600)
    await shot(ph.page, name)
    const hscroll = await ph.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`Phone (390): no sideways scroll on ${name.replace('-390', '')}`, !hscroll)
  }
  await ph.page.goto(`${base}/hrms/leave?tab=history&${RANGE}`)
  await ph.page.locator('[data-filter="decided-leave-dates"]').first().click()
  await pop(ph.page).waitFor({ timeout: 10_000 })
  await sleep(300)
  await shot(ph.page, 'leave-decided-open-390')
  const pb = await pop(ph.page).boundingBox()
  check('Phone: the calendar fits the screen', !!pb && pb.x >= 0 && pb.x + pb.width <= 390, JSON.stringify(pb))
  await ph.ctx.close()
} catch (e) {
  check('the run finished', false, String(e.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  cleanup()
  await browser.close()
}

const failedN = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failedN}/${results.length} passed`)
process.exit(failedN ? 1 : 0)
