// Notification clicks, every type for every role (client report 7 Oct 2026: "when they clicked on the
// notification it showed a full white page and nothing").
//
//   NODE_OPTIONS="--import ./e2e/recovery/_skip-punch-prompt.mjs" \
//   live-slot.sh /c/REACT/ut-wt/w62-notifclick 3162 node e2e/recovery/live-w3-w62-notifclick.mjs
//
// For owner@, hrm@, mgr@ and reader@, one at a time for each of the server's notification types:
// plant a notification with the payload the server really sends (data.route and ids as the senders
// write them), open the bell, click it, and look at what opened. A click passes when it lands on a
// page that shows something: not a blank page, not the error screen, not "Page not found", no page
// error. "Access Restricted" fails only for a type that person is really sent (AUDIENCE below).
// Every planted row carries data.w62 and is deleted at the end. Results: _results/w62-clicks.json;
// a screenshot of every failure, plus a few samples at 1440 and 390 wide, under SHOTS.
/* global process, console, document, URL */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const out = process.env.W62_OUT || 'C:/REACT/ut-wt/_results/w62-clicks.json'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const only = (process.env.W62_USERS || '').split(',').filter(Boolean)
const width = Number(process.env.W62_WIDTH || 1440)
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

const READER = '22222222-2222-2222-2222-222222222222'
const U = () => randomUUID()
const today = new Date().toISOString().slice(0, 10)

// What each sender puts in data (DomainEventListener and the notifier services, rd/int e232563b).
const PAYLOAD = {
  LEAVE_SUBMITTED: () => ({ route: '/requests-tab', leaveRequestId: U() }),
  LEAVE_APPROVED: () => ({ route: '/leave-history', leaveRequestId: U() }),
  LEAVE_REJECTED: () => ({ route: '/leave-history', leaveRequestId: U() }),
  LEAVE_CANCELLED: () => ({ route: '/requests-tab', leaveRequestId: U() }),
  FACE_ENROLLMENT_COMPLETE: () => ({ route: '/face-enroll' }),
  FACE_ENROLLMENT_FAILED: () => ({ route: '/face-enroll' }),
  FACE_ENROLLMENT_RESET: () => ({ route: '/face-enroll?reason=reset' }),
  WFH_SUBMITTED: () => ({ route: '/requests-tab', wfhRequestId: U() }),
  WFH_APPROVED: () => ({ route: '/wfh-apply', wfhRequestId: U() }),
  WFH_REJECTED: () => ({ route: '/wfh-apply', wfhRequestId: U() }),
  WFH_CANCELLED: () => ({ route: '/requests-tab', wfhRequestId: U() }),
  CORRECTION_SUBMITTED: () => ({ route: '/requests-tab', correctionId: U() }),
  CORRECTION_APPROVED: () => ({ route: '/my-corrections', correctionId: U() }),
  CORRECTION_REJECTED: () => ({ route: '/my-corrections', correctionId: U() }),
  SHIFT_CHANGE_SUBMITTED: () => ({ route: '/requests-tab', shiftChangeRequestId: U() }),
  SHIFT_CHANGE_APPROVED: () => ({ route: '/shift-change', shiftChangeRequestId: U() }),
  SHIFT_CHANGE_REJECTED: () => ({ route: '/shift-change', shiftChangeRequestId: U() }),
  EXPENSE_SUBMITTED: () => ({ route: '/requests-tab', expenseClaimId: U() }),
  EXPENSE_APPROVED: () => ({ route: '/my-claims', expenseClaimId: U() }),
  EXPENSE_REJECTED: () => ({ route: '/my-claims', expenseClaimId: U() }),
  ADVANCE_SUBMITTED: () => ({ route: '/requests-tab', advanceRequestId: U() }),
  ADVANCE_APPROVED: () => ({ route: '/my-advances', advanceRequestId: U() }),
  ADVANCE_REJECTED: () => ({ route: '/my-advances', advanceRequestId: U() }),
  ADVANCE_RAISED_FOR_YOU: () => ({ route: '/notifications', advanceRequestId: U() }),
  SALARY_REVISED: () => ({ route: '/notifications', structureId: U() }),
  OVERTIME_REQUESTED: () => ({ route: '/hrms/shifts?tab=overtime', overtimeRequestId: U() }),
  OVERTIME_APPROVED: () => ({ route: '/attendance', overtimeId: U() }),
  OVERTIME_REJECTED: () => ({ route: '/attendance', overtimeId: U() }),
  ATTENDANCE_STATUS_CHANGED: () => ({ route: '/attendance-history', date: today }),
  DOCUMENT_UPLOADED: () => ({ route: '/documents/pending', documentId: U(), employeeId: READER }),
  DOCUMENT_VERIFIED: () => ({ route: '/profile', documentId: U() }),
  DOCUMENT_REJECTED: () => ({ route: '/profile', documentId: U() }),
  LEAVE_ENCASHMENT_SUBMITTED: () => ({ route: '/hrms/leave?tab=encash', encashmentId: U(), audience: 'approver' }),
  LEAVE_ENCASHMENT_APPROVED: () => ({ route: '/hrms/leave?tab=encash', encashmentId: U() }),
  LEAVE_ENCASHMENT_REJECTED: () => ({ route: '/hrms/leave?tab=encash', encashmentId: U() }),
  POLICY_PUBLISHED: () => ({ route: '/hrms/policies', policyId: U() }),
  POLICY_REMINDER: () => ({ route: '/hrms/policies', policyId: U() }),
  INTERVIEW_SCHEDULED: () => ({ route: '/me/interviews', interviewId: U() }),
  INTERVIEW_RESCHEDULED: () => ({ route: '/me/interviews', interviewId: U() }),
  INTERVIEW_CANCELLED: () => ({ route: '/me/interviews', interviewId: U() }),
  SKILL_ASSESSMENT_SUBMITTED: () => ({ skillAssessmentId: U(), employeeId: READER }),
  SKILL_ASSESSMENT_APPROVED: () => ({ skillAssessmentId: U() }),
  SKILL_ASSESSMENT_REJECTED: () => ({ skillAssessmentId: U() }),
  WELCOME: () => ({ route: '/(tabs)' }),
  TRIAL_ENDING_SOON: () => ({ route: '/billing', upgradeUrl: 'https://unifiedtree.com/pricing' }),
  TRIAL_EXPIRED: () => ({ route: '/billing', upgradeUrl: 'https://unifiedtree.com/pricing' }),
  SUBSCRIPTION_HALTED: () => ({ route: '/plan', subscriptionId: U(), graceUntil: today }),
  PAYMENT_DUE_SOON: () => ({ route: '/plan', subscriptionId: U(), kind: 'DUE_SOON' }),
  PAYMENT_OVERDUE: () => ({ route: '/plan', subscriptionId: U(), kind: 'OVERDUE' }),
  BILLING_OVER_CAP: () => ({ route: '/plan', purchased: 10, current: 12 }),
  RETIREMENT_DUE: () => ({ route: '/milestones', employeeId: READER, retirementDate: '2027-01-01', daysLeft: 90 }),
  DECISION_UNDONE: () => ({ kind: 'LEAVE', requestId: U(), route: '/leave-history' }),
  CHECKIN_REMINDER: () => ({ route: '/(tabs)', reminderDate: today, reason: 'NOT_CHECKED_IN' }),
  PERFORMANCE_REVIEW_REMINDER: () => ({ route: '/hrms/performance?view=my-reviews', reviewId: U() }),
  TEAM_MESSAGE: () => ({ route: '/notifications', messageId: U() }),
  ASSET_ISSUE_REPORTED: () => ({ route: '/hrms/onboarding/instances?view=assets', issueId: U(), assetId: U() }),
  PAYSLIP_QUERY_RAISED: () => ({ route: '/hrms/payroll-dashboard', queryId: U(), runId: U() }),
  PAYSLIP_QUERY_ANSWERED: () => ({ route: '/me/payslips', queryId: U(), runId: U() }),
  LEAVE_APPLIED_ON_BEHALF: () => ({ route: '/leave-history', leaveRequestId: U() }),
  EXPENSE_CLAIM_RAISED_FOR_YOU: () => ({ route: '/my-claims', expenseClaimId: U() }),
  TIMESHEET_SUBMITTED: () => ({ route: '/requests-tab', timesheetWeekId: U(), weekStart: today }),
  TIMESHEET_DECIDED: () => ({ timesheetWeekId: U(), weekStart: today }),
  LETTER_SIGNATURE_REQUESTED: () => ({ route: '/hrms/letters/my', letterId: U() }),
  PROBATION_TEAM_DECISION: () => ({ route: '/notifications', employeeId: READER }),
  PUNCH_IN_ALERT: () => ({ route: '/notifications', employeeId: READER, employeeName: 'Reader', attendanceDate: today, method: 'FACE', assisted: false, latitude: 17.38504, longitude: 78.48667 }),
  CELEBRATION_WISH: () => ({ route: '/milestones', wishId: U(), fromEmployeeId: READER, occasion: 'BIRTHDAY' }),
  // A birthday heads-up (MilestoneReminderService) is a GENERAL row whose data.type is MILESTONE_*.
  GENERAL: () => ({ type: 'MILESTONE_BIRTHDAY', employeeId: READER, self: false, route: '/milestones' }),
}
const TYPES = Object.keys(PAYLOAD)

// Who is really sent each type (catalog audiences): a page a person can't open fails only for these.
const ADMINS = ['owner']
const APPROVERS = ['owner', 'hrm', 'mgr']
const HR = ['owner', 'hrm']
const AUDIENCE = {
  LEAVE_SUBMITTED: APPROVERS, LEAVE_CANCELLED: APPROVERS, WFH_SUBMITTED: APPROVERS, WFH_CANCELLED: APPROVERS,
  CORRECTION_SUBMITTED: APPROVERS, SHIFT_CHANGE_SUBMITTED: APPROVERS, EXPENSE_SUBMITTED: APPROVERS, ADVANCE_SUBMITTED: APPROVERS,
  OVERTIME_REQUESTED: APPROVERS, TIMESHEET_SUBMITTED: APPROVERS, SKILL_ASSESSMENT_SUBMITTED: APPROVERS,
  DOCUMENT_UPLOADED: HR, LEAVE_ENCASHMENT_SUBMITTED: HR, ASSET_ISSUE_REPORTED: HR, PAYSLIP_QUERY_RAISED: HR, RETIREMENT_DUE: HR,
  TRIAL_ENDING_SOON: ADMINS, TRIAL_EXPIRED: ADMINS, SUBSCRIPTION_HALTED: ADMINS, PAYMENT_DUE_SOON: ADMINS, PAYMENT_OVERDUE: ADMINS, BILLING_OVER_CAP: ADMINS,
  PUNCH_IN_ALERT: APPROVERS,
}
// A few ok clicks are photographed too, to look at.
const SAMPLE = new Set(['PAYMENT_DUE_SOON', 'CELEBRATION_WISH', 'PUNCH_IN_ALERT', 'LEAVE_CANCELLED', 'GENERAL', 'RETIREMENT_DUE'])
const sentTo = (type, who) => (AUDIENCE[type] ?? ['owner', 'hrm', 'mgr', 'reader']).includes(who)

const USERS = [
  { who: 'owner', email: 'owner@unifiedtree.demo' },
  { who: 'hrm', email: 'hrm@unifiedtree.demo' },
  { who: 'mgr', email: 'mgr@unifiedtree.demo' },
  { who: 'reader', email: 'reader@unifiedtree.demo' },
].filter((u) => !only.length || only.includes(u.who))

const empOf = (email) => sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='${email}'`)
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
function plant(emp, type) {
  const data = { type, ...PAYLOAD[type](), w62: true }
  return sql(`insert into notif.notifications (tenant_id, user_id, type, title, body, data)
    values ('${tenant}', '${emp}', ${lit(type === 'GENERAL' ? 'GENERAL' : type)}, ${lit('W62 ' + type)}, ${lit('Click test for ' + type)}, ${lit(JSON.stringify(data))}::jsonb) returning id`)
}

const browser = await chromium.launch({ headless: true })
const rows = []

async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } })
  const page = await ctx.newPage()
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90_000 })
  const splash = page.getByText('Welcome back').first()
  await splash.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  await splash.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  return { ctx, page }
}

/** What the screen shows after a click. */
async function look(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#root')
    const main = document.querySelector('#workspace-content')
    const text = (root?.innerText || '').trim()
    return {
      rootText: text.length,
      shell: !!document.querySelector('.ut-topbar__icon[aria-label^="Notifications"]'),
      mainText: main ? (main.innerText || '').trim().length : -1,
      snippet: ((main || root)?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 140),
      crashed: /This page hit an error|Something went wrong/.test(text),
      notFound: /Page not found/i.test(text),
      denied: /Access Restricted|You don.t have access|must be an admin|Only (an )?(owner|admin)/i.test(text),
    }
  })
}

async function sweep(user) {
  const emp = empOf(user.email)
  const { ctx, page } = await signIn(user.email)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error' && /Failed to fetch dynamically imported module|ChunkLoadError|RouteErrorBoundary/.test(m.text())) errors.push(m.text().split('\n')[0]) })
  const bell = page.locator('button.ut-topbar__icon[aria-label^="Notifications"]')
  for (const type of TYPES) {
    const row = { who: user.who, type, sentTo: sentTo(type, user.who) }
    try {
      plant(emp, type)
      if (!(await bell.isVisible().catch(() => false))) await page.goto(base + '/dashboard')
      await bell.waitFor({ timeout: 30_000 })
      await page.keyboard.press('Escape').catch(() => {})
      await bell.click()
      const item = page.locator('.ut-bellpop__row', { hasText: `W62 ${type}` }).first()
      await item.waitFor({ timeout: 30_000 })
      errors.length = 0
      const before = page.url()
      await item.click()
      await page.waitForURL((u) => u.href !== before, { timeout: 6_000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
      await page.waitForTimeout(600)
      let seen = await look(page)
      // A page still drawing its loading outline gets up to 15 s more before it counts as blank.
      for (let i = 0; i < 15 && (seen.rootText < 20 || (seen.shell && seen.mainText < 5)); i++) { await page.waitForTimeout(1000); seen = await look(page) }
      const u = new URL(page.url())
      row.to = u.pathname + u.search + u.hash
      Object.assign(row, seen, { errors: [...errors] })
      const blank = seen.rootText < 20 || (seen.shell && seen.mainText === 0)
      row.verdict = blank ? 'BLANK' : seen.crashed ? 'CRASH' : seen.notFound ? 'NOT_FOUND' : errors.length ? 'PAGE_ERROR'
        : seen.denied ? (row.sentTo ? 'DENIED' : 'denied-not-sent') : 'ok'
      if (row.verdict !== 'ok' && row.verdict !== 'denied-not-sent') await page.screenshot({ path: `${shots}/w62-${width}-${user.who}-${type}.png` }).catch(() => {})
      else if (SAMPLE.has(type)) await page.screenshot({ path: `${shots}/w62-${width}-${user.who}-${type}-ok.png` }).catch(() => {})
    } catch (e) {
      row.verdict = 'TEST_ERROR'
      row.errors = [String(e.message).split('\n')[0]]
      await page.screenshot({ path: `${shots}/w62-${width}-${user.who}-${type}-testerror.png` }).catch(() => {})
      await page.goto(base + '/dashboard').catch(() => {})
    }
    rows.push(row)
    console.log(`  ${user.who.padEnd(6)} ${type.padEnd(30)} ${String(row.verdict).padEnd(16)} ${row.to ?? ''} ${row.errors?.length ? row.errors.join(' | ').slice(0, 160) : ''}`)
  }
  // Samples to look at: one person's page at 1440 and the bell at 390.
  if (user.who === 'reader') {
    await page.goto(base + '/me')
    await bell.click().catch(() => {})
    await page.screenshot({ path: `${shots}/w62-reader-bell-1440.png` }).catch(() => {})
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${shots}/w62-reader-bell-390.png` }).catch(() => {})
  }
  await ctx.close()
}

/**
 * The app opens a page of the website in its in-app browser for a type it has no screen for: a
 * fresh browser at phone width, often not signed in there. Each such page must reach the sign-in
 * page (not a blank one) and come back to the page after signing in.
 */
async function deepLinks() {
  const paths = [...new Set(rows.map((r) => r.to).filter(Boolean))].filter((p) => !p.startsWith('/hrms/employees/')).concat('/hrms/employees/' + READER)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  const bad = []
  for (const p of paths) {
    errors.length = 0
    await page.goto(base + p).catch(() => {})
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {})
    const seen = await look(page)
    if (!new URL(page.url()).pathname.startsWith('/login') || seen.rootText < 20 || errors.length) bad.push(`${p} -> ${new URL(page.url()).pathname} ${errors.join(' | ').slice(0, 80)}`)
  }
  await page.screenshot({ path: `${shots}/w62-390-signed-out-deeplink.png` }).catch(() => {})
  check(`signed out, every page a notification opens (${paths.length}) goes to the sign-in page at 390 wide`, bad.length === 0, bad.join(', '))
  // Signing in there lands back on the page asked for.
  await page.goto(base + '/hrms/payroll-dashboard')
  await page.locator('input[type=email]').waitFor({ timeout: 30_000 })
  await page.locator('input[type=email]').fill('hrm@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  const seen = await look(page)
  await page.screenshot({ path: `${shots}/w62-390-after-signin-payroll.png` }).catch(() => {})
  check('after signing in there, the in-app browser shows the page asked for', new URL(page.url()).pathname === '/hrms/payroll-dashboard' && seen.rootText > 20 && !seen.crashed, `${page.url()} ${seen.snippet.slice(0, 60)}`)
  await ctx.close()
}

/**
 * A crash above every page (here: the notification provider, swapped for one that throws) shows
 * "Something went wrong" with Back and Home, not a white page; Home works once the fault is gone.
 */
async function crashScreen() {
  const { ctx, page } = await signIn('reader@unifiedtree.demo')
  const broken = '**/src/core/notifications/NotificationProvider.tsx*'
  await page.route(broken, (r) => r.fulfill({ contentType: 'application/javascript', body: "export const NotificationProvider = () => { throw new Error('w62 crash test') }" }))
  await page.reload()
  const fallback = page.getByRole('alert').filter({ hasText: 'Something went wrong' })
  await fallback.waitFor({ timeout: 30_000 }).catch(() => {})
  const seen = await look(page)
  check('a crash above the pages shows "Something went wrong", not a white page', await fallback.isVisible().catch(() => false) && seen.rootText > 20, seen.snippet.slice(0, 80))
  check('it offers Back and Home', await page.getByRole('button', { name: 'Back' }).isVisible().catch(() => false) && await page.getByRole('button', { name: 'Home' }).isVisible().catch(() => false))
  await page.screenshot({ path: `${shots}/w62-${width}-crash-fallback.png` }).catch(() => {})
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${shots}/w62-390-crash-fallback.png` }).catch(() => {})
  await page.unroute(broken)
  await page.getByRole('button', { name: 'Home' }).click()
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.locator('button.ut-topbar__icon[aria-label^="Notifications"]').waitFor({ timeout: 30_000 }).catch(() => {})
  check('Home opens the app again', !(await fallback.isVisible().catch(() => false)) && (await look(page)).shell, page.url())
  await ctx.close()
}

try {
  await Promise.all(USERS.map((u) => sweep(u).catch((e) => check(`${u.who}: sweep ran`, false, e.message.split('\n')[0]))))
  if (!process.env.W62_SKIP_DEEPLINKS) await crashScreen().catch((e) => check('crash screen ran', false, e.message.split('\n')[0]))
  if (!process.env.W62_SKIP_DEEPLINKS) await deepLinks().catch((e) => check('deep links ran', false, e.message.split('\n')[0]))
  for (const user of USERS) {
    const mine = rows.filter((r) => r.who === user.who)
    const bad = mine.filter((r) => r.verdict !== 'ok' && r.verdict !== 'denied-not-sent')
    check(`${user.who}: all ${TYPES.length} types open a page that shows something (${mine.length} clicked)`, mine.length === TYPES.length && bad.length === 0,
      bad.map((r) => `${r.type}=${r.verdict}@${r.to ?? '?'}`).join(', '))
  }
  // Where a few of them land (the fixes of 7 Oct).
  const to = (who, type) => rows.find((r) => r.who === who && r.type === type)?.to
  if (to('owner', 'LEAVE_CANCELLED')) check('owner: a cancelled leave or WFH opens the approvals', to('owner', 'LEAVE_CANCELLED') === '/hrms/leave?tab=approvals' && to('owner', 'WFH_CANCELLED') === '/hrms/leave?tab=approvals', `${to('owner', 'LEAVE_CANCELLED')} / ${to('owner', 'WFH_CANCELLED')}`)
  for (const who of USERS.map((u) => u.who)) if (to(who, 'GENERAL')) check(`${who}: a colleague's birthday heads-up opens Celebrations`, to(who, 'GENERAL') === '/me/celebrations', to(who, 'GENERAL'))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  await browser.close()
  writeFileSync(out, JSON.stringify(rows, null, 1))
  sql(`delete from notif.notifications where tenant_id='${tenant}' and data->>'w62' = 'true'`)
  check('cleanup: no planted notification is left', sql(`select count(*) from notif.notifications where data->>'w62' = 'true'`) === '0')
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
