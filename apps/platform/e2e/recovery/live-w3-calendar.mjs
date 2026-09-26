// Live check of the shared calendar (wave 3): the dashboard date picker's month
// and year views, the design DatePicker (Daily Logs) by mouse and keyboard, the
// Audit logs date filter, and the phone sheet. Read-only: it creates nothing.
//
//   node e2e/recovery/live-w3-calendar.mjs
/* global process, console, URL, document */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Today in IST, like the app.
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const today = `${get('year')}-${get('month')}-${get('day')}`
const py = Number(get('year')) - 1
const yesterday = (() => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = [], failed = []
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
const dateDialog = () => page.getByRole('dialog', { name: 'Choose date' })

try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  // ── 1. Dashboard date picker: year view → a previous year → a day → the dashboard shows it ──
  await page.goto(base + '/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /January|February|March|April|May|June|July|August|September|October|November|December/ }).first().click()
  const cal = page.getByRole('dialog', { name: 'Choose dashboard date' })
  await cal.waitFor({ timeout: 5000 })
  check('dashboard picker opens', await cal.isVisible())
  await cal.getByRole('button', { name: 'Choose year' }).click()
  const yearCell = cal.locator(`[role=gridcell][aria-label="${py}"]`)
  await yearCell.waitFor({ timeout: 5000 })
  check('dashboard picker has a year view', await yearCell.isVisible())
  await yearCell.click()
  check('picking a year shows its months', await cal.getByRole('grid', { name: `Months of ${py}` }).isVisible())
  await cal.locator(`[role=gridcell][aria-label="September ${py}"]`).click()
  const day = cal.getByRole('gridcell', { name: new RegExp(`, 10 September ${py}`) })
  check('month pick shows that month\'s days', await day.isVisible())
  const dashReq = page.waitForRequest((r) => r.url().includes('/v1/attendance/dashboard') && r.url().includes(`date=${py}-09-10`), { timeout: 15000 }).catch(() => null)
  await day.click()
  await cal.getByRole('button', { name: /^Show 10 Sep on dashboard$/ }).click()
  check('dashboard asks for that date', !!(await dashReq))
  await page.waitForLoadState('networkidle')
  check('dashboard header shows the chosen date', (await page.getByRole('button', { name: new RegExp(`Viewing .*10 Sep ${py}`) }).count()) > 0)
  check('past-date banner shows', (await page.getByRole('status').filter({ hasText: 'Viewing' }).count()) > 0)
  await page.getByRole('button', { name: 'Back to today' }).click()

  // ── 2. Daily Logs picker (the design DatePicker): keyboard and year jump ──
  await page.goto(base + '/hrms/attendance?tab=team')
  await page.waitForLoadState('networkidle')
  const logsPicker = page.getByRole('combobox', { name: 'Showing day' })
  await logsPicker.waitFor({ timeout: 15000 })
  await logsPicker.focus()
  await page.keyboard.press('ArrowDown')
  check('ArrowDown opens the Daily Logs picker', await dateDialog().isVisible())
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => u.searchParams.get('date') === yesterday, { timeout: 10000 }).catch(() => {})
  check('arrow + Enter picks yesterday', new URL(page.url()).searchParams.get('date') === yesterday, page.url().replace(base, ''))
  check('picker closes after Enter', !(await dateDialog().isVisible()))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  check('Escape closes the picker and keeps the page', !(await dateDialog().isVisible()) && (await logsPicker.count()) === 1)
  check('focus returns to the field', await logsPicker.evaluate((el) => el === document.activeElement))
  await logsPicker.click()
  await dateDialog().getByRole('button', { name: 'Choose year' }).click()
  await dateDialog().locator(`[role=gridcell][aria-label="${py}"]`).click()
  await dateDialog().locator(`[role=gridcell][aria-label="September ${py}"]`).click()
  await dateDialog().locator(`[role=gridcell][aria-label^="${new Date(py, 8, 10).toLocaleDateString('en-GB', { weekday: 'long' })}, 10 September ${py}"]`).click()
  await page.waitForURL((u) => u.searchParams.get('date') === `${py}-09-10`, { timeout: 10000 }).catch(() => {})
  check('year → month → day on Daily Logs', new URL(page.url()).searchParams.get('date') === `${py}-09-10`, page.url().replace(base, ''))
  check('field shows the picked day', ((await logsPicker.textContent()) || '').includes(`10 Sep ${py}`), await logsPicker.textContent())

  // ── 3. Audit logs date filter ──
  await page.goto(base + '/audit-logs')
  await page.waitForLoadState('networkidle')
  const fromField = page.locator('[data-filter=from]')
  await fromField.waitFor({ timeout: 15000 })
  await fromField.click()
  const withFrom = page.waitForResponse((r) => r.url().includes('/v1/audit/events?') && r.url().includes('from='), { timeout: 15000 }).catch(() => null)
  await dateDialog().getByRole('button', { name: 'Yesterday' }).click()
  const r1 = await withFrom
  check('picking From refetches the audit list with from=', !!r1 && r1.ok(), r1 ? r1.url().split('/api')[1].slice(0, 120) : 'no request')
  check('From shows the picked day', /\d{1,2} \w{3} \d{4}/.test((await fromField.textContent()) || ''), await fromField.textContent())
  check('the list says it is filtered', await page.getByText(/match these filters\./).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false))
  await page.locator('.utc-field', { has: fromField }).getByRole('button', { name: 'Clear' }).click()
  // The unfiltered page may come straight from React Query's cache, so check the list, not the network.
  const unfiltered = await page.getByText(/events? recorded\./).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  check('clearing From shows the unfiltered list again', unfiltered)
  check('From is empty again', ((await fromField.textContent()) || '').includes('From'))

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))

  // ── 4. Phone width: the picker stays inside the viewport ──
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/hrms/attendance?tab=team')
  await page.waitForLoadState('networkidle')
  const phonePicker = page.getByRole('combobox', { name: 'Showing day' })
  await phonePicker.waitFor({ timeout: 15000 })
  await phonePicker.click()
  await dateDialog().waitFor({ timeout: 5000 })
  await page.waitForTimeout(350)
  const b = await dateDialog().boundingBox()
  check('390px: the calendar stays inside the viewport', !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 390 && b.y + b.height <= 844.5, JSON.stringify(b))
  const cell = await dateDialog().locator('.utc-day:not(.is-blank) .utc-dn').first().boundingBox()
  check('390px: day targets are at least 40px', !!cell && cell.width >= 40 && cell.height >= 40)
  await page.keyboard.press('Escape')
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 200))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
