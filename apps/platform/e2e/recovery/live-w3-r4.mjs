// Live check of the calendar rollout (wave 3, r4): every screen whose native
// date / month input now uses the shared calendar — report date filters,
// review cycles, KPIs, expense items, reimbursement batches, a person's extra
// permission end date, approval delegation, project tasks and the audit log.
// Each check opens the picker, picks a day (a previous year through the year
// list where it makes sense) and reads the value back from the field or the
// URL. Nothing is saved: every form is cancelled, so the test leaves no data.
// The save path (a picked date reaching the backend) is covered by
// performance-admin-live.mjs (review cycle period) and expense-batches-live.mjs (batch cutoff).
//
//   node e2e/recovery/live-w3-r4.mjs
/* global process, console, URL */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3024'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = process.env.R4_SHOTS || 'C:/REACT/ut-wt/_results/shots'
try { mkdirSync(SHOTS, { recursive: true }) } catch { /* screenshots are optional */ }
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = MONTHS.map((m) => m.slice(0, 3))
// Today in IST, like the app.
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const Y = Number(get('year')), today = `${get('year')}-${get('month')}-${get('day')}`
const py = Y - 1, ny = Y + 1
const shiftDay = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const yesterday = shiftDay(today, -1), tomorrow = shiftDay(today, 1)
const short = (iso) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = [], failed = []
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
const dateDialog = () => page.getByRole('dialog', { name: 'Choose date' })
const shot = async (name) => { try { await page.screenshot({ path: `${SHOTS}/r4-${name}.png` }) } catch { /* optional */ } }
const text = async (loc) => ((await loc.textContent()) || '').trim()
/** True when the field's visible text is cut off with an ellipsis. */
const isCut = (field) => field.locator('.utc-text').evaluate((el) => el.scrollWidth > el.clientWidth + 1)

/** Opens the field's calendar and picks y-m-d through the year list → month → day. */
async function pickViaYear(field, y, m, d, before) {
  await field.click()
  const dlg = dateDialog()
  await dlg.waitFor({ timeout: 5000 })
  await dlg.getByRole('button', { name: 'Choose year' }).click()
  await dlg.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  if (before) await before(dlg)
  await dlg.locator(`[role=gridcell][aria-label*=", ${d} ${MONTHS[m - 1]} ${y}"]`).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}
/** Runs one screen's checks; an exception fails that screen only. */
async function screen(name, fn) {
  try { await fn() } catch (e) {
    check(`${name}: completed`, false, String(e.message || e).split('\n')[0].slice(0, 220))
    await page.keyboard.press('Escape').catch(() => {})
  }
}
const noNativeDates = async (where) => {
  const n = await page.locator('input[type=date], input[type=month]').count()
  check(`${where}: no native date or month input left`, n === 0, n ? `${n} found` : '')
}

try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  // ── 1. Report date filters (ReportKit DateFilter): From through the year list, To capped at today ──
  await screen('Attendance summary report', async () => {
    await page.goto(base + '/hrms/reports/attendance-summary')
    const from = page.getByRole('combobox', { name: 'From', exact: true })
    await from.waitFor({ timeout: 20000 })
    await pickViaYear(from, py, 9, 10, async () => { await shot('report-from-open-1440') })
    await page.waitForURL((u) => u.searchParams.get('from') === `${py}-09-10`, { timeout: 10000 }).catch(() => {})
    check('report From: previous-year pick lands in the URL', new URL(page.url()).searchParams.get('from') === `${py}-09-10`, page.url().replace(base, ''))
    check('report From: field shows the day', (await text(from)).includes(`10 Sep ${py}`), await text(from))
    const to = page.getByRole('combobox', { name: 'To', exact: true })
    await to.click()
    await dateDialog().waitFor({ timeout: 5000 })
    if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
      const t = dateDialog().locator(`[role=gridcell][aria-label*=", ${Number(tomorrow.slice(8))} ${MONTHS[Number(tomorrow.slice(5, 7)) - 1]} ${Y}"]`)
      check('report To: days after today are not available', (await t.getAttribute('aria-disabled')) === 'true')
    }
    await dateDialog().getByRole('button', { name: 'Yesterday' }).click()
    await page.waitForURL((u) => u.searchParams.get('to') === yesterday, { timeout: 10000 }).catch(() => {})
    check('report To: preset lands in the URL', new URL(page.url()).searchParams.get('to') === yesterday, page.url().replace(base, ''))
    await noNativeDates('attendance summary report')
  })

  await screen('Headcount report', async () => {
    await page.goto(base + '/hrms/reports/headcount')
    const asOf = page.getByRole('combobox', { name: 'As of', exact: true })
    await asOf.waitFor({ timeout: 20000 })
    await pickViaYear(asOf, py, 3, 31)
    check('report As of: field shows the previous-year day', (await text(asOf)).includes(`31 Mar ${py}`), await text(asOf))
    check('report As of: the note follows the pick', (await page.getByText(new RegExp(`Data as of .*${py}`)).count()) > 0)
  })

  // ── 2. Review cycles: empty dates still block the submit; end can't be before start ──
  await screen('Review cycles', async () => {
    await page.goto(base + '/hrms/performance?view=cycles')
    await page.getByRole('button', { name: 'Create cycle' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'Create review cycle' })
    await drawer.waitFor({ timeout: 10000 })
    await drawer.getByRole('button', { name: 'Create cycle' }).click()
    check('review cycle: empty period dates block the submit', await drawer.getByRole('alert').filter({ hasText: 'set both period dates' }).isVisible())
    const start = drawer.locator('label', { hasText: 'Period start' }).getByRole('combobox')
    const end = drawer.locator('label', { hasText: 'Period end' }).getByRole('combobox')
    await pickViaYear(start, py, 9, 10)
    check('review cycle: start shows the previous-year day', (await text(start)).includes(`10 Sep ${py}`), await text(start))
    let dayBeforeOff = false
    await pickViaYear(end, py, 9, 20, async (dlg) => {
      dayBeforeOff = (await dlg.locator(`[role=gridcell][aria-label*=", 9 September ${py}"]`).getAttribute('aria-disabled')) === 'true'
      await shot('review-cycle-end-open-1440')
    })
    check('review cycle: days before the start are not available for the end', dayBeforeOff)
    check('review cycle: end shows the day', (await text(end)).includes(`20 Sep ${py}`), await text(end))
    await noNativeDates('review cycle drawer')
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 3. KPIs: optional due date — pick next year, then clear ──
  await screen('KPIs', async () => {
    await page.goto(base + '/hrms/performance?view=kpis')
    await page.getByRole('button', { name: 'Create KPI' }).click()
    const drawer = page.getByRole('dialog', { name: 'Create company KPI' })
    await drawer.waitFor({ timeout: 10000 })
    const due = drawer.locator('label', { hasText: 'Due date' }).getByRole('combobox')
    await pickViaYear(due, ny, 3, 15)
    check('KPI due date: next-year pick shows', (await text(due)).includes(`15 Mar ${ny}`), await text(due))
    await drawer.locator('label', { hasText: 'Due date' }).getByRole('button', { name: 'Clear' }).click()
    check('KPI due date: can be cleared again', (await text(due)).includes('Select date'), await text(due))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 4. Expense claim item date and the reimbursement batch cutoff ──
  await screen('Expense claim', async () => {
    await page.goto(base + '/hrms/expenses?tab=submit')
    const d = page.getByRole('combobox', { name: 'Date', exact: true }).first()
    await d.waitFor({ timeout: 20000 })
    check('expense item: defaults to today', (await text(d)).includes(short(today)), await text(d))
    await d.click()
    await dateDialog().getByRole('button', { name: 'Yesterday' }).click()
    check('expense item: preset lands', (await text(d)).includes(short(yesterday)), await text(d))
    await pickViaYear(d, py, 12, 31)
    check('expense item: previous-year pick lands', (await text(d)).includes(`31 Dec ${py}`), await text(d))
    await d.click()
    await dateDialog().waitFor({ timeout: 5000 })
    await shot('expense-item-open-1440')
    await page.keyboard.press('Escape')
    await noNativeDates('expense claim form')
  })

  await screen('Reimbursement batches', async () => {
    await page.goto(base + '/hrms/expenses?tab=batches')
    await page.getByRole('button', { name: 'Build batch' }).click()
    const drawer = page.getByRole('dialog', { name: 'Build reimbursement batch' })
    await drawer.waitFor({ timeout: 10000 })
    const cutoff = drawer.locator('label', { hasText: 'Approval cutoff date' }).getByRole('combobox')
    check('batch cutoff: defaults to today', (await text(cutoff)).includes(short(today)), await text(cutoff))
    await pickViaYear(cutoff, py, 3, 31)
    check('batch cutoff: previous-year pick lands', (await text(cutoff)).includes(`31 Mar ${py}`), await text(cutoff))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 5. A person's extra permission: optional end date, not before today ──
  await screen('Permission end date', async () => {
    await page.goto(base + '/users')
    await page.locator('tr', { hasText: 'reader@unifiedtree.demo' }).getByRole('button', { name: 'Manage access' }).click()
    const search = page.getByRole('textbox', { name: 'Search permissions' })
    await search.waitFor({ timeout: 20000 })
    await search.fill('audit')
    await page.locator('button.ut-row-hover', { hasText: /audit/i }).first().click()
    const until = page.getByRole('combobox', { name: 'End date', exact: true })
    await until.waitFor({ timeout: 10000 })
    await until.click()
    await dateDialog().waitFor({ timeout: 5000 })
    const y = dateDialog().locator(`[role=gridcell][aria-label*=", ${Number(yesterday.slice(8))} ${MONTHS[Number(yesterday.slice(5, 7)) - 1]} ${yesterday.slice(0, 4)}"]`)
    if (yesterday.slice(0, 7) === today.slice(0, 7)) check('permission end date: past days are not available', (await y.getAttribute('aria-disabled')) === 'true')
    await page.keyboard.press('Escape')
    await pickViaYear(until, ny, 1, 31)
    check('permission end date: pick lands', (await text(until)).includes(`31 Jan ${ny}`), await text(until))
    await page.locator('.utc-field', { has: until }).getByRole('button', { name: 'Clear' }).click()
    check('permission end date: can be left empty again', (await text(until)).includes('Select date'), await text(until))
    await page.getByRole('button', { name: 'Cancel' }).last().click()
  })

  // ── 6. Approval delegation on the profile ──
  await screen('Approval delegation', async () => {
    await page.goto(base + '/profile')
    await page.getByRole('button', { name: '+ Add delegation' }).click()
    const from = page.getByRole('combobox', { name: 'From', exact: true })
    const to = page.getByRole('combobox', { name: 'To', exact: true })
    await from.waitFor({ timeout: 10000 })
    check('delegation: From defaults to today', (await text(from)).includes(short(today)), await text(from))
    await pickViaYear(from, ny, 1, 10)
    check('delegation: From pick lands', (await text(from)).includes(`10 Jan ${ny}`), await text(from))
    let dayBeforeOff = false
    await pickViaYear(to, ny, 1, 14, async (dlg) => {
      dayBeforeOff = (await dlg.locator(`[role=gridcell][aria-label*=", 9 January ${ny}"]`).getAttribute('aria-disabled')) === 'true'
    })
    check('delegation: To can’t be before From', dayBeforeOff)
    check('delegation: To pick lands', (await text(to)).includes(`14 Jan ${ny}`), await text(to))
    await noNativeDates('profile')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 7. Project task due date (dashboard → Manage projects) ──
  await screen('Project task due date', async () => {
    await page.goto(base + '/dashboard')
    await page.getByRole('button', { name: 'Manage projects →' }).click()
    const drawer = page.getByRole('dialog', { name: 'Projects & Productivity' })
    await drawer.waitFor({ timeout: 10000 })
    const select = drawer.getByRole('combobox', { name: 'Project', exact: true })
    await select.waitFor({ timeout: 10000 })
    const firstProject = await select.locator('option:not([value=""])').first().getAttribute('value').catch(() => null)
    if (!firstProject) { check('project task: a project exists to test with', false, 'no project in this database'); return }
    await select.selectOption(firstProject)
    const due = drawer.locator('label', { hasText: 'Due date' }).getByRole('combobox')
    await due.waitFor({ timeout: 10000 })
    await due.click()
    await dateDialog().getByRole('button', { name: 'Tomorrow' }).click()
    check('project task: due date pick lands', (await text(due)).includes(short(tomorrow)), await text(due))
    await drawer.locator('label', { hasText: 'Due date' }).getByRole('button', { name: 'Clear' }).click()
    check('project task: due date can be cleared', (await text(due)).includes('Select date'), await text(due))
  })

  // ── 8. Audit log To filter (FilterBar): previous year ──
  await screen('Audit log', async () => {
    await page.goto(base + '/audit-logs')
    const toField = page.locator('[data-filter=to]')
    await toField.waitFor({ timeout: 15000 })
    const withTo = page.waitForResponse((r) => r.url().includes('/v1/audit/events?') && r.url().includes(`to=${py}-01-15`), { timeout: 15000 }).catch(() => null)
    await pickViaYear(toField, py, 1, 15)
    check('audit To: previous-year pick refetches with to=', !!(await withTo))
    check('audit To: field shows the day', (await text(toField)).includes(`15 Jan ${py}`), await text(toField))
  })

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))

  // ── 9. Phone width: the calendar is a sheet inside the viewport ──
  await page.setViewportSize({ width: 390, height: 844 })
  await screen('Phone: expense item', async () => {
    await page.goto(base + '/hrms/expenses?tab=submit')
    const d = page.getByRole('combobox', { name: 'Date', exact: true }).first()
    await d.waitFor({ timeout: 20000 })
    await pickViaYear(d, py, 12, 28)
    check('390px: expense item date shows in full', !(await isCut(d)), await text(d))
    await d.scrollIntoViewIfNeeded()
    await shot('expense-item-390')
    await d.click()
    await dateDialog().waitFor({ timeout: 5000 })
    await page.waitForTimeout(350)
    const b = await dateDialog().boundingBox()
    check('390px: expense calendar stays inside the viewport', !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 390.5 && b.y + b.height <= 844.5, JSON.stringify(b))
    await shot('expense-item-open-390')
    await page.keyboard.press('Escape')
  })
  await screen('Phone: report filters', async () => {
    await page.goto(base + '/hrms/reports/attendance-summary')
    const from = page.getByRole('combobox', { name: 'From', exact: true })
    await from.waitFor({ timeout: 20000 })
    const box = await from.boundingBox()
    check('390px: report From fits the screen', !!box && box.x >= 0 && box.x + box.width <= 390.5, JSON.stringify(box))
    check('390px: report From shows the date in full', !(await isCut(from)), await text(from))
    await shot('report-filters-390')
    await from.click()
    await dateDialog().waitFor({ timeout: 5000 })
    await page.waitForTimeout(350)
    await shot('report-from-open-390')
    await page.keyboard.press('Escape')
  })
  await screen('Phone: review cycle', async () => {
    await page.goto(base + '/hrms/performance?view=cycles')
    await page.getByRole('button', { name: 'Create cycle' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'Create review cycle' })
    await drawer.waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)
    await pickViaYear(drawer.locator('label', { hasText: 'Period start' }).getByRole('combobox'), py, 9, 10)
    await shot('review-cycle-390')
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })
  await screen('Phone: KPI due date', async () => {
    await page.goto(base + '/hrms/performance?view=kpis')
    await page.getByRole('button', { name: 'Create KPI' }).click()
    const drawer = page.getByRole('dialog', { name: 'Create company KPI' })
    await drawer.waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)
    const due = drawer.locator('label', { hasText: 'Due date' }).getByRole('combobox')
    await pickViaYear(due, ny, 12, 28)
    check('390px: KPI due date shows in full', !(await isCut(due)), await text(due))
    await due.scrollIntoViewIfNeeded()
    await shot('kpi-due-390')
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })
  check('phone: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('phone: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 200))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
