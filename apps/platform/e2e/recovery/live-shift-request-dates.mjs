// Client acceptance case #2 — "an employee's shift-change request must take
// effect on the date the employee chose, not on the day a manager approves".
// Real local API + real browser against the local recovery runtime:
//   (a) the employee files the request from /me/shift-change with a start date
//       three days out; the POST carries it and the list shows it;
//   (b) the approver's card shows "Starts on"; approving assigns the shift FROM
//       THAT DATE — today's shift is untouched and the change is upcoming, the
//       team schedule flips on that day, and the employee's notification says so;
//   (c) a request still pending after its date has expired (client decision
//       2026-09-24): the approver queue leaves it out, approving it is refused
//       and rejects it, the employee is told to apply again, and an expired
//       request never blocks a new one;
//   (d) API rules: past / >12-month dates refused, reason 10+ characters, one
//       pending request per employee, a date before an already-scheduled
//       change is refused with that date.
// The demo employee's shift assignments are snapshotted first and restored
// exactly afterwards (SQL on the LOCAL database). Request rows stay, decided.
//
// Local recovery runtime only. Run from apps/platform:
//   node e2e/recovery/live-shift-request-dates.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const readerId = '22222222-2222-2222-2222-222222222222' // reader@unifiedtree.demo
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const psql = process.env.RECOVERY_PSQL || join(process.env.LOCALAPPDATA || '', 'UnifiedTreeRecovery', 'pgsql', 'bin', 'psql.exe')
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
async function call(h, method, path, body) {
  const r = await fetch(api + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await r.json() } catch { /* empty body */ }
  return { status: r.status, json }
}
// Local database only (superuser, trust auth) — fixtures and the exact restore.
// SQL goes in on stdin as UTF-8: Windows re-encodes argv to the ANSI code page.
function sql(statement) {
  return execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery',
    '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { input: statement, encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } }).trim()
}
// A pending request whose start date is already in the past (the API refuses
// to create one, which is the point — this stands in for one that waited).
function insertExpired(requestedShiftId, currentShiftId, date, reason) {
  return sql(`INSERT INTO attendance.shift_change_requests (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id, reason, status, requested_effective_date, created_at)
    VALUES (gen_random_uuid(), '${tenant}', '${readerId}', ${currentShiftId ? `'${currentShiftId}'` : 'NULL'}, '${requestedShiftId}', '${reason}', 'PENDING', '${date}', now() - interval '3 days') RETURNING id`).match(UUID_RE)[0]
}
async function signIn(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.waitForTimeout(1500)
}
async function latestShiftNotification(h, type) {
  const r = await call(h, 'GET', '/v1/notifications?page=0&size=20')
  const rows = Array.isArray(r.json) ? r.json : (r.json?.content ?? r.json?.items ?? [])
  return rows.filter((n) => n.type === type).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
}
// Sonner toasts; returns every toast text seen within the wait, for the check detail.
async function toastTexts(page, expected, timeout = 15_000) {
  const seen = new Set()
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const t of await page.locator('[data-sonner-toast]').allInnerTexts()) seen.add(t.replace(/\s+/g, ' ').trim())
    if ([...seen].some((t) => t.includes(expected))) break
    await page.waitForTimeout(250)
  }
  return [...seen]
}

const today = istToday()
const start = plusDays(today, 3)
const passed = plusDays(today, -2)

const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

// Snapshot the reader's assignment rows so the run leaves the roster as found.
const snapshot = JSON.parse(sql(`SELECT coalesce(json_agg(a ORDER BY effective_from), '[]') FROM attendance.employee_shift_assignments a WHERE employee_id = '${readerId}'`))
// A leftover pending request from an aborted run would block the form.
for (const r of ((await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []).filter((x) => x.status === 'PENDING')) {
  await call(owner, 'POST', `/v1/shifts/change-requests/${r.id}/decision`, { approved: false, comment: 'QA automation cleanup — rejected' })
}

const original = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
const policies = (await call(reader, 'GET', `/v1/shifts?companyId=${company}`)).json
if (!original.shiftPolicyId || original.upcomingShiftPolicyId) {
  // Start from one shift and nothing scheduled (the snapshot restore puts back
  // whatever was there).
  sql(`DELETE FROM attendance.employee_shift_assignments WHERE employee_id = '${readerId}';
       INSERT INTO attendance.employee_shift_assignments (id, tenant_id, employee_id, shift_policy_id, effective_from)
       VALUES (gen_random_uuid(), '${tenant}', '${readerId}', '${policies[0].id}', '${plusDays(today, -30)}')`)
}
const before = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
const baseline = policies.find((p) => p.id === before.shiftPolicyId)
const target = policies.find((p) => p.id !== before.shiftPolicyId)
check('fixture: reader has a shift today and nothing scheduled', baseline && target && !before.upcomingShiftPolicyId, `${baseline?.name}; upcoming=${before.upcomingShiftName ?? 'none'}`)
const emp = (await call(owner, 'GET', `/v1/hrms/employees/${readerId}`)).json
const readerName = [emp.firstName, emp.lastName].filter(Boolean).join(' ')
const reason = `QA automation — start-date request ${new Date().toISOString()}`

const browser = await chromium.launch({ headless: true })
const pageErrors = [], failedApi = []
const watch = (page, label) => {
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${String(e).split('\n')[0]}`))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) failedApi.push(`${label} ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
}
let requestId = null
const extraIds = []
try {
  // ── (d) API rules ─────────────────────────────────────────────────────────
  const past = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason, effectiveDate: plusDays(today, -1) })
  check('a start date in the past is refused', past.status === 422 && past.json?.errorCode === 'SHIFT_CHANGE_DATE_PAST', `${past.status} ${past.json?.errorCode}`)
  const far = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason, effectiveDate: plusDays(today, 400) })
  check('a start date more than 12 months out is refused', far.status === 422 && far.json?.errorCode === 'SHIFT_CHANGE_DATE_TOO_FAR', `${far.status} ${far.json?.errorCode}`)
  const short = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason: 'too short', effectiveDate: start })
  check('a reason under 10 characters is refused', short.status === 422 && short.json?.errorCode === 'SHIFT_CHANGE_REASON_INVALID', `${short.status} ${short.json?.errorCode}`)

  // ── (a) employee files from the web form ─────────────────────────────────
  const empPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  watch(empPage, 'employee')
  await signIn(empPage, 'reader@unifiedtree.demo')
  await empPage.goto(base + '/me/shift-change')
  await empPage.getByRole('heading', { name: 'Request a Shift Change' }).waitFor({ timeout: 30_000 })
  const dateInput = empPage.locator('#scr-date')
  check('date field defaults to tomorrow', (await dateInput.inputValue()) === plusDays(today, 1), await dateInput.inputValue())
  check('date field allows today through 12 months', (await dateInput.getAttribute('min')) === today && !!(await dateInput.getAttribute('max')))
  check('form says an unapproved request expires', await empPage.getByText("If it isn't approved by then, the request").isVisible())
  await empPage.locator('#scr-shift').selectOption(target.id)
  await dateInput.fill(start)
  await empPage.locator('#scr-reason').fill(reason)
  const posted = empPage.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/v1/shifts/change-requests'), { timeout: 15_000 })
  await empPage.getByRole('button', { name: 'Send request to HR' }).click()
  const body = JSON.parse((await posted).postData() || '{}')
  check('the form posts the chosen start date', body.effectiveDate === start && body.requestedShiftPolicyId === target.id, JSON.stringify(body))
  await empPage.getByText('Request sent. HR will review and notify you.').waitFor({ timeout: 15_000 })
  await empPage.getByText(`Requested start ${longDate(start)}`).waitFor({ timeout: 15_000 })
  check('my requests list shows the requested start', true, longDate(start))
  const mine = (await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []
  const created = mine.find((r) => r.reason === reason)
  requestId = created?.id
  check('stored with the employee\'s date', created?.status === 'PENDING' && created?.requestedEffectiveDate === start, `${created?.status} ${created?.requestedEffectiveDate}`)
  const dup = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason, effectiveDate: plusDays(start, 7) })
  check('a second pending request is refused', dup.status === 422 && dup.json?.errorCode === 'SHIFT_CHANGE_PENDING_EXISTS', `${dup.status} ${dup.json?.errorCode}`)

  // ── (b) approver sees the date and approves ──────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  watch(page, 'owner')
  await signIn(page, 'owner@unifiedtree.demo')
  await page.goto(base + '/hrms/shifts')
  await page.getByRole('heading', { name: 'Shifts & Overtime' }).waitFor({ timeout: 30_000 })
  await page.getByRole('tab', { name: /^Shift requests/ }).click()
  check('queue explains the start date and the expiry',
    await page.getByText('A request still pending after that date is rejected automatically').waitFor({ timeout: 10_000 }).then(() => true, () => false))
  const card = page.getByRole('article').filter({ hasText: reason })
  await card.waitFor({ timeout: 20_000 })
  check('card shows "Starts on" with the employee\'s date', (await card.innerText()).includes(`Starts on: ${longDate(start)}`))
  check('card has no date picker', (await card.locator('input[type=date]').count()) === 0)
  const decisionCall = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/v1/shifts/change-requests/${requestId}/decision`), { timeout: 15_000 })
  await card.getByRole('button', { name: 'Approve change' }).click()
  const sent = JSON.parse((await decisionCall).postData() || '{}')
  check('approve posts only the decision', sent.approved === true && !('effectiveDate' in sent), JSON.stringify(sent))
  const approvedToast = `${readerName} moves to ${target.name} from ${longDate(start)}`
  const toasts1 = await toastTexts(page, approvedToast)
  check('success toast names the real start date', toasts1.some((t) => t.includes(approvedToast)), toasts1.join(' | '))

  const afterApprove = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
  check('TODAY\'s shift is unchanged after approval', afterApprove.shiftPolicyId === baseline.id, `${afterApprove.shiftName}`)
  check('the change is upcoming from the employee\'s date', afterApprove.upcomingShiftPolicyId === target.id && afterApprove.upcomingEffectiveFrom === start,
    `${afterApprove.upcomingShiftName} from ${afterApprove.upcomingEffectiveFrom}`)
  const schedule = (await call(owner, 'GET', `/v1/team/schedule?from=${plusDays(start, -1)}&to=${start}`)).json
  const rows = Array.isArray(schedule) ? schedule.filter((r) => r.employeeId === readerId) : []
  const dayBefore = rows.find((r) => String(r.date).slice(0, 10) === plusDays(start, -1))
  const onStart = rows.find((r) => String(r.date).slice(0, 10) === start)
  check('team schedule: old shift the day before, new shift from the date', dayBefore?.shiftName === baseline.name && onStart?.shiftName === target.name,
    `${dayBefore?.shiftName} → ${onStart?.shiftName}`)
  const approvedRow = ((await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []).find((r) => r.id === requestId)
  check('request records the start date', approvedRow?.status === 'APPROVED' && approvedRow?.appliedEffectiveDate === start, `${approvedRow?.status} ${approvedRow?.appliedEffectiveDate}`)
  const note1 = await latestShiftNotification(reader, 'SHIFT_CHANGE_APPROVED')
  check('employee is told the start date', note1?.body === `Your shift changes to ${target.name} from ${longDate(start)}.`, note1?.body)
  await empPage.reload()
  await empPage.getByText(`Starts ${longDate(start)}`).first().waitFor({ timeout: 15_000 }).then(
    () => check('employee list shows the start date after approval', true),
    () => check('employee list shows the start date after approval', false))
  const scheduledLine = await empPage.getByText(`Scheduled: ${target.name} from ${longDate(start)}`).waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check('employee page shows the scheduled change under the current shift', scheduledLine)

  // ── (d) a date before an already-scheduled change ────────────────────────
  const early = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: target.id, reason, effectiveDate: plusDays(today, 1) })
  check('a date before the scheduled change is refused, naming that date', early.status === 422 && early.json?.errorCode === 'SHIFT_CHANGE_DATE_CONFLICT'
    && String(early.json?.message).includes(longDate(start)), `${early.status} ${early.json?.message}`)

  // ── (c) a request still pending after its start date ─────────────────────
  const expiredId = insertExpired(baseline.id, target.id, passed, `${reason} (expired)`)
  extraIds.push(expiredId)
  const queue = (await call(owner, 'GET', '/v1/shifts/change-requests/pending')).json || []
  check('approver queue leaves the expired request out', !queue.some((r) => r.id === expiredId), `${queue.length} pending`)
  const approveExpired = await call(owner, 'POST', `/v1/shifts/change-requests/${expiredId}/decision`, { approved: true })
  check('approving it is refused as expired', approveExpired.status === 422 && approveExpired.json?.errorCode === 'SHIFT_CHANGE_EXPIRED', `${approveExpired.status} ${approveExpired.json?.message}`)
  const expiredRow = ((await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []).find((r) => r.id === expiredId)
  check('...and it is now rejected (the rejection survives the error)', expiredRow?.status === 'REJECTED' && !expiredRow?.approverId
    && String(expiredRow?.decisionNote).startsWith(`Expired: the start date (${longDate(passed)}) passed`), `${expiredRow?.status} "${expiredRow?.decisionNote}"`)
  const note2 = await latestShiftNotification(reader, 'SHIFT_CHANGE_REJECTED')
  check('employee is told it expired and to apply again', String(note2?.body).includes('Expired: the start date') && String(note2?.body).includes('apply again'), note2?.body)
  const afterExpiry = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
  check('an expired request changes no shift', afterExpiry.shiftPolicyId === baseline.id && afterExpiry.upcomingEffectiveFrom === start, `${afterExpiry.shiftName}; upcoming ${afterExpiry.upcomingShiftName} from ${afterExpiry.upcomingEffectiveFrom}`)
  await empPage.reload()
  const expiredNote = await empPage.getByText(`Expired: the start date (${longDate(passed)}) passed`).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check('employee list shows the expiry note (not signed "HR:")', expiredNote && !(await empPage.getByText(`HR: Expired`).count()))

  const blocking = insertExpired(baseline.id, target.id, passed, `${reason} (blocking)`)
  extraIds.push(blocking)
  const again = await call(reader, 'POST', '/v1/shifts/change-requests', { requestedShiftPolicyId: baseline.id, reason: `${reason} (again)`, effectiveDate: plusDays(start, 3) })
  if (again.json?.id) extraIds.push(again.json.id)
  const blockingRow = ((await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []).find((r) => r.id === blocking)
  check('an expired request does not block applying again', again.status === 201 && blockingRow?.status === 'REJECTED', `${again.status} ${again.json?.errorCode ?? ''}; old ${blockingRow?.status}`)

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no 5xx from the pages', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/shift-request-dates.png', fullPage: true })
} catch (error) {
  check('flow completed without an exception', false, String(error).split('\n')[0])
} finally {
  await browser.close()
  // Leave nothing pending; decided rows are kept.
  for (const id of [requestId, ...extraIds].filter(Boolean)) {
    const row = ((await call(reader, 'GET', '/v1/shifts/change-requests/my')).json || []).find((r) => r.id === id)
    if (row?.status === 'PENDING') await call(owner, 'POST', `/v1/shifts/change-requests/${id}/decision`, { approved: false, comment: 'QA automation cleanup — rejected' })
  }
  // Restore the reader's assignments exactly as snapshotted.
  const values = snapshot.map((a) => `('${a.id}','${a.tenant_id}','${a.employee_id}','${a.shift_policy_id}','${a.effective_from}',${a.effective_to ? `'${a.effective_to}'` : 'NULL'},'${a.created_at}','${a.updated_at}',${a.created_by ? `'${a.created_by}'` : 'NULL'},${a.updated_by ? `'${a.updated_by}'` : 'NULL'},${a.version})`).join(',')
  sql(`BEGIN; DELETE FROM attendance.employee_shift_assignments WHERE employee_id = '${readerId}';
       ${values ? `INSERT INTO attendance.employee_shift_assignments (id, tenant_id, employee_id, shift_policy_id, effective_from, effective_to, created_at, updated_at, created_by, updated_by, version) VALUES ${values};` : ''}
       COMMIT;`)
  const restored = (await call(reader, 'GET', `/v1/shifts/employee/${readerId}`)).json
  check('reader\'s schedule restored', restored.shiftPolicyId === original.shiftPolicyId && restored.effectiveFrom === original.effectiveFrom
    && restored.upcomingShiftPolicyId === original.upcomingShiftPolicyId, `${restored.shiftName ?? 'unassigned'} from ${restored.effectiveFrom}; upcoming ${restored.upcomingShiftName ?? 'none'}`)
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-shift-request-dates.json', JSON.stringify({ ranAt: new Date().toISOString(), today, start, passed, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
