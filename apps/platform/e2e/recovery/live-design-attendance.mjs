// Live check of the redesigned Attendance & Time module against the local API.
//
//   node e2e/recovery/live-design-attendance.mjs
//
// Owner (HR): the three sections render with the page's own section bar (no
// shell sub-nav), tiles add up to the table, a status tile filters, "Fix this
// day" opens manual entry for that person, a shift is added → edited → deleted,
// rejecting overtime without a note is stopped before any call is made.
// Reader (employee): only their own tabs; asks for a fix, which the owner then
// rejects (attendance unchanged). Nothing irreversible is approved.
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
async function signIn(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = [], failed = [], sent = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${r.url().split('/api')[1]}`) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0; sent.length = 0
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  return { page, errors, failed, sent, settle }
}
const sections = (page) => page.getByRole('navigation', { name: 'Attendance sections' })

const stamp = Date.now() % 100000
const shiftName = `E2E Shift ${stamp}`
const reason = `E2E design check ${stamp}`
try {
  // ─────────────────────────────── owner / HR ───────────────────────────────
  const hr = await signIn('owner@unifiedtree.demo')
  const { page } = hr

  await page.goto(base + '/hrms/attendance'); await hr.settle()
  const secText = (await sections(page).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('section bar shows the three sections', /Attendance Analytics/.test(secText) && /Daily Tracking/.test(secText) && /Shifts & Overtime/.test(secText), secText)
  check('shell sub-nav is hidden on the designed page', (await page.getByRole('navigation', { name: 'Attendance & Time sections' }).count()) === 0)
  check('Daily Logs opens by default', await page.getByRole('heading', { name: 'Daily Logs' }).count() > 0)

  // Tiles count the same rows the table shows.
  const came = Number((await page.getByRole('button', { name: /Came in/ }).first().innerText()).match(/\d+/)?.[0] ?? NaN)
  const rows = await page.locator('tbody tr').count()
  const showing = (await page.getByText(/^Showing \d+ of \d+/).first().innerText().catch(() => '')).trim()
  check('result line matches the table', new RegExp(`^Showing ${rows} of ${rows}\\b`).test(showing), `${showing} · ${rows} rows · came in ${came}`)
  await page.getByRole('button', { name: /Not marked/ }).first().click(); await page.waitForTimeout(300)
  const notMarkedRows = await page.locator('tbody tr').count()
  const nm = (await page.getByText(/^Showing \d+ of \d+/).first().innerText()).trim()
  check('a status tile filters the table', /not marked/.test(nm) && notMarkedRows > 0 && notMarkedRows <= rows, nm)
  await page.getByRole('button', { name: /Not marked/ }).first().click(); await page.waitForTimeout(300)

  // Open a person, "Fix this day" → manual entry for them.
  await page.locator('tbody tr').first().click()
  await page.getByRole('button', { name: 'Fix this day' }).first().waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Fix this day' }).first().click()
  await page.waitForURL(/\/hrms\/attendance\/manual-entry\?employeeId=[0-9a-f-]{36}&date=\d{4}-\d{2}-\d{2}/, { timeout: 10000 }).catch(() => {})
  check('HR "Fix this day" opens manual entry for that person', /manual-entry\?employeeId=[0-9a-f-]{36}&date=\d{4}-\d{2}-\d{2}/.test(page.url()), page.url().replace(base, ''))

  // Tabs switch and the URL follows.
  await page.goto(base + '/hrms/attendance'); await hr.settle()
  await page.getByRole('tab', { name: /^Regularization/ }).first().click(); await hr.settle()
  check('tab switch updates the URL', page.url().includes('tab=corrections'), page.url().replace(base, ''))

  // Analytics: donut adds up to the roster.
  await page.goto(base + '/hrms/att-analytics'); await hr.settle()
  const who = (await page.getByText(/^All \d+ people, grouped/).first().innerText().catch(() => '')).match(/All (\d+) people/)
  const people = who ? Number(who[1]) : NaN
  const mixText = await page.locator('text=/^\\d+%$/').allInnerTexts().catch(() => [])
  check('overview renders today and this month', await page.getByText('Attendance trend').count() > 0 && await page.getByText('Everyone’s month').count() > 0)
  const pct = mixText.slice(0, 8).map((t) => Number(t.replace('%', ''))).reduce((a, b) => a + b, 0)
  check('who’s-where percentages add up to ~100%', people > 0 && pct >= 97 && pct <= 103, `${people} people · ${pct}%`)
  await page.getByRole('button', { name: /Open the full report/ }).first().click(); await hr.settle()
  check('"Open the full report" keeps this month', /\/hrms\/reports\/attendance-summary\?.*from=\d{4}-\d{2}-01.*to=\d{4}-\d{2}-\d{2}/.test(page.url()), page.url().replace(base, ''))

  // Shifts: add → edit → delete a test shift.
  await page.goto(base + '/hrms/shifts?tab=schedules'); await hr.settle()
  await page.getByRole('button', { name: /^Add shift$/ }).first().click()
  await page.getByPlaceholder('e.g. Early morning').fill(shiftName)
  await page.getByRole('button', { name: /^Add shift$/ }).last().click()
  await page.getByText(`${shiftName} shift added`).first().waitFor({ timeout: 10000 }).catch(() => {})
  await hr.settle()
  const card = page.locator('article').filter({ hasText: shiftName })
  check('new shift is saved and shows as a card', await card.count() === 1)
  await card.getByRole('button', { name: /Edit/ }).click()
  await page.locator('select').filter({ hasText: '30 min' }).first().selectOption('30')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText(`${shiftName} shift updated`).first().waitFor({ timeout: 10000 }).catch(() => {})
  await hr.settle()
  const edited = (await page.locator('article').filter({ hasText: shiftName }).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('edited grace time is saved', /Late after 9:30 AM/.test(edited), edited.slice(0, 140))
  await page.locator('article').filter({ hasText: shiftName }).getByRole('button', { name: /Delete/ }).click()
  await page.getByRole('button', { name: 'Delete shift' }).click()
  await page.getByText(`${shiftName} deleted`).first().waitFor({ timeout: 10000 }).catch(() => {})
  await hr.settle()
  check('test shift deletes', (await page.locator('article').filter({ hasText: shiftName }).count()) === 0)

  // Overtime: rejecting without a note is stopped here (the API requires one).
  await page.goto(base + '/hrms/shifts?tab=overtime'); await hr.settle()
  const pendingOt = page.locator('article').filter({ has: page.getByRole('button', { name: 'Approve overtime' }) })
  if (await pendingOt.count()) {
    const before = hr.sent.length
    await pendingOt.first().getByRole('button', { name: 'Reject' }).click(); await page.waitForTimeout(600)
    check('overtime reject without a note is blocked', hr.sent.length === before && await page.getByText('Add a note saying why before rejecting').count() > 0)
  } else check('overtime tab renders (nothing pending)', await page.getByText('Recorded, not paid.').count() > 0)

  check('HR: no page errors', hr.errors.length === 0, hr.errors.slice(0, 2).join(' | '))
  check('HR: no failed API calls', hr.failed.length === 0, hr.failed.slice(0, 4).join(' | '))

  // ─────────────────────────────── reader / employee ────────────────────────
  const me = await signIn('reader@unifiedtree.demo')
  await me.page.goto(base + '/hrms/attendance'); await me.settle()
  const meSec = (await sections(me.page).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('employee sees no Analytics section', !/Attendance Analytics/.test(meSec) && /Daily Tracking/.test(meSec), meSec)
  check('employee opens on My Attendance', await me.page.getByRole('heading', { name: 'My Attendance' }).count() > 0)
  check('employee has no Daily Logs tab', (await me.page.getByRole('tab', { name: /^Daily Logs/ }).count()) === 0)

  await me.page.goto(base + '/hrms/attendance?tab=corrections'); await me.settle()
  await me.page.getByRole('button', { name: /New request/ }).first().click()
  await me.page.getByPlaceholder('e.g. Forgot to punch out').fill(reason)
  await me.page.getByRole('button', { name: 'Send request' }).click()
  await me.page.getByText('Fix request sent').first().waitFor({ timeout: 10000 }).catch(() => {})
  await me.settle()
  check('employee fix request is sent and listed as waiting', await me.page.getByText(reason).count() > 0, (await me.page.getByText('Fix request sent').count()) ? 'toast shown' : 'no toast')

  await me.page.goto(base + '/hrms/shifts'); await me.settle()
  check('employee Shifts shows My Shift', await me.page.getByRole('heading', { name: 'My Shift' }).count() > 0)
  check('employee: no page errors', me.errors.length === 0, me.errors.slice(0, 2).join(' | '))
  check('employee: no failed API calls', me.failed.length === 0, me.failed.slice(0, 4).join(' | '))

  // ─────────────────────────────── owner rejects it ─────────────────────────
  await page.goto(base + '/hrms/attendance?tab=corrections'); await hr.settle()
  const req = page.locator('article').filter({ hasText: reason })
  check('HR sees the new request waiting', await req.count() === 1)
  if (await req.count()) {
    await req.getByPlaceholder('Decision note (optional)').fill('E2E check — rejected, attendance unchanged')
    await req.getByRole('button', { name: 'Reject' }).click()
    await page.getByText('Fix rejected — attendance stays as it was').first().waitFor({ timeout: 10000 }).catch(() => {})
    await hr.settle()
    check('HR rejects it and it leaves the waiting list', (await page.locator('article').filter({ hasText: reason }).count()) === 0)
  }
  check('HR (after reject): no failed API calls', hr.failed.length === 0, hr.failed.slice(0, 4).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 240))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
