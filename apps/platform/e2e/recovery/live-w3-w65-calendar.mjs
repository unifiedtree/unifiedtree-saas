/* global process, console, document, window, setTimeout, Storage, URL */
// Live check of "calendar everywhere" (owner + client, 7 Oct 2026, w65):
//
//  1. On every list page that got the start / end calendar, open it, jump to last month through the month title
//     (the month grid), click a start day and an end day, Apply: the URL keeps ?from=&to=, the box shows
//     DD/MM/YYYY – DD/MM/YYYY, and — where the API takes dates — the list's request carries the same from / to.
//  2. Reports: the CSV download asks the server for the same from / to.
//  3. Back keeps the range: leave the page and come back.
//  4. Quick picks and Clear: "Last month" fills both ends; Clear goes back to the page's default.
//  5. Keyboard: arrows + Enter pick a start and an end; the year title opens the year grid.
//  6. The dashboard: a range longer than 31 days says so in plain words and holds Apply (no days disabled).
//  7. Screenshots 1440 and 390 wide (/c/REACT/ut-wt/_results/shots/w65-calendar-*.png).
//
// It only reads, apart from the CSV export's export-log row, which it removes.
//   node e2e/recovery/live-w3-w65-calendar.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3265'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const info = (s) => console.log(`INFO  ${s}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const ym = (iso) => iso.slice(0, 7)
const prevYm = (() => { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
const D1 = `${prevYm}-03`, D2 = `${prevYm}-20`
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const started = sql('select now()')

const browser = await chromium.launch()
// The check-in prompt after sign-in opens once per visit: mark it as shown, as the app does after it opens.
const markPromptShown = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const day = ['year', 'month', 'day'].map((t) => p.find((x) => x.type === t)?.value ?? '').join('-')
  const original = Storage.prototype.getItem
  Storage.prototype.getItem = function (key) { return typeof key === 'string' && key.startsWith('ut.punch-prompt.opened:') ? day : original.call(this, key) }
}
async function session(email, { width = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })
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

const pop = (page) => page.locator('.urf-pop, [role="dialog"]:has(.udr)').first()
/** Opens a page's range box, jumps to last month through the month grid, clicks D1 then D2, and applies. */
async function pickRange(page, key, { from = D1, to = D2 } = {}) {
  const box = page.locator(`[data-filter="${key}"]`).first()
  await box.waitFor({ timeout: 30_000 })
  await box.click()
  await pop(page).waitFor({ timeout: 10_000 })
  await pop(page).locator('.udr-title').first().click() // the month title → the year's months
  // The grid opens on the year of the month shown (a report's default can start last year): step to the right year.
  for (let i = 0; i < 3 && !(await pop(page).locator(`[data-month="${ym(from)}"]`).count()); i++) {
    const shownYear = Number(((await pop(page).locator('.udr-title').first().textContent()) || '').trim().slice(0, 4))
    await pop(page).getByRole('button', { name: shownYear < Number(from.slice(0, 4)) ? 'Next year' : 'Previous year' }).click()
  }
  await pop(page).locator(`[data-month="${ym(from)}"]`).click()
  await pop(page).locator(`[data-day="${from}"]`).click()
  if (ym(to) !== ym(from)) await pop(page).getByRole('button', { name: 'Next month' }).click()
  await pop(page).locator(`[data-day="${to}"]`).click()
  const summary = (await pop(page).locator('.udr-sum').textContent()) || ''
  await pop(page).getByRole('button', { name: 'Apply' }).click()
  await pop(page).waitFor({ state: 'detached', timeout: 10_000 })
  await page.waitForURL((u) => u.searchParams.get(key === 'my-overtime-dates' ? 'mineFrom' : 'from') === from, { timeout: 10_000 })
  return { summary, boxText: ((await box.textContent()) || '').trim() }
}
const sawRequest = async (s, re, ms = 15_000) => {
  for (let t = 0; t < ms; t += 300) { const hit = s.requests.find((u) => re.test(u)); if (hit) return hit; await sleep(300) }
  return null
}
// Calls the slot's main-branch jar doesn't have yet (or answers 4xx for this demo data) on these pages before this
// change too: reported as INFO, not counted against the calendar.
const KNOWN = [/^404 GET \/v1\/me\/companies/, /^404 GET \/v1\/reports\/fiscal-year/, /^404 GET \/v1\/reports\/attrition\/joiners/, /^400 GET \/v1\/payroll\/payslips\/me\//]
const apiErrors = (s, who) => {
  const known = s.failed.filter((f) => KNOWN.some((k) => k.test(f)))
  if (known.length) info(`${who}: known calls this server doesn't answer (not from the calendar): ${[...new Set(known)].join(' | ')}`)
  return s.failed.filter((f) => !KNOWN.some((k) => k.test(f)))
}

// The pages: where the box is, how to reach it, and the API call that must carry the dates (null: the list comes
// whole and is kept to the range in the browser).
const ADMIN_PAGES = [
  { name: 'Reports · Attendance summary', path: '/hrms/reports/attendance-summary', key: 'report-dates', api: new RegExp(`/v1/reports/attendance-summary\\?.*from=${D1}&to=${D2}`) },
  { name: 'Reports · Attrition', path: '/hrms/reports/attrition', key: 'report-dates', api: new RegExp(`/v1/reports/attrition\\?.*from=${D1}&to=${D2}`) },
  { name: 'Reports · Late marks', path: '/hrms/reports/late-marks', key: 'report-dates', api: new RegExp(`/v1/reports/late-marks\\?.*from=${D1}&to=${D2}`) },
  { name: 'Workforce analytics · Attrition', path: '/hrms/workforce-analytics?tab=attrition', key: 'period', api: new RegExp(`/v1/reports/attrition(/joiners)?\\?.*from=${D1}&to=${D2}`) },
  { name: 'Audit logs', path: '/audit-logs', key: 'dates', api: /\/v1\/audit\/events\?.*from=.*&to=/ },
  { name: 'Daily tracking · Review', path: '/hrms/attendance?tab=review', key: 'review-dates', api: new RegExp(`/v1/attendance/review/exceptions\\?from=${D1}&to=${D2}`) },
  { name: 'Daily tracking · Regularization', path: '/hrms/attendance?tab=corrections', key: 'fix-dates', api: null },
  { name: 'Shifts & overtime · Overtime list', path: '/hrms/shifts?tab=overtime', key: 'overtime-dates', api: new RegExp(`/v1/attendance/overtime\\?from=${D1}&to=${D2}`), before: async (page) => { await page.getByRole('radio', { name: /This month/ }).or(page.getByRole('button', { name: /This month/ })).first().click() } },
  { name: 'Payroll runs', path: '/hrms/payroll/runs', key: 'dates', api: null },
  { name: 'Onboarding · New hires', path: '/hrms/onboarding', key: 'joining-dates', api: null, optional: true },
  { name: 'Hiring · Interviews', path: '/hrms/hiring?tab=interviews', key: 'interview-dates', api: null, optional: true },
  { name: 'Timesheet approvals', path: '/hrms/attendance?tab=timesheet', key: 'timesheet-dates', api: null, optional: true },
]
const SELF_PAGES = [
  { name: 'Home · Attendance history', path: '/', key: 'attendance-dates', api: new RegExp(`/v1/attendance/history\\?year=${prevYm.slice(0, 4)}&month=${Number(prevYm.slice(5))}`), optional: true },
  { name: 'My payslips', path: '/me/payslips', key: 'payslip-dates', api: null, optional: true },
  { name: 'My WFH requests', path: '/me/wfh', key: 'wfh-dates', api: null, optional: true },
]

async function runPages(s, pages) {
  for (const p of pages) {
    s.requests.length = 0
    const errs = s.errors.length
    try {
      await s.page.goto(base + p.path, { timeout: 60_000 })
      if (p.before) await p.before(s.page)
      const present = await s.page.locator(`[data-filter="${p.key}"]`).first().waitFor({ timeout: p.optional ? 12_000 : 30_000 }).then(() => true, () => false)
      if (!present && p.optional) { info(`${p.name}: no range box (the list is empty for this login), skipped`); continue }
      const r = await pickRange(s.page, p.key)
      const url = new URL(s.page.url())
      check(`${p.name}: the URL keeps the range`, url.searchParams.get('from') === D1 && url.searchParams.get('to') === D2, url.search)
      check(`${p.name}: the box shows DD/MM/YYYY – DD/MM/YYYY`, r.boxText.includes(`${dmy(D1)} – ${dmy(D2)}`), r.boxText)
      check(`${p.name}: the calendar's summary showed both ends`, r.summary.includes(dmy(D1)) && r.summary.includes(dmy(D2)), r.summary.replace(/\s+/g, ' '))
      if (p.api) { const hit = await sawRequest(s, p.api); check(`${p.name}: the list's API call carries the dates`, !!hit, hit || `none of ${s.requests.length} calls matched ${p.api}`) }
      check(`${p.name}: no page errors`, s.errors.length === errs, s.errors.slice(errs).join(' | '))
    } catch (e) {
      check(`${p.name}: picking a range`, false, String(e.message || e).split('\n')[0])
    }
  }
}

let shotIdx = 0
const shot = async (page, name) => { await page.screenshot({ path: `${SHOTS}/w65-calendar-${String(++shotIdx).padStart(2, '0')}-${name}.png`, fullPage: false }) }

try {
  // ── 1–2. admin pages ────────────────────────────────────────────────────────
  const o = await session('owner@unifiedtree.demo')
  await runPages(o, ADMIN_PAGES)

  // CSV download of a report uses the range (attrition: the demo company has leavers last month).
  await o.page.goto(base + `/hrms/reports/attrition?from=${D1}&to=${D2}`)
  await o.page.locator('[data-filter="report-dates"]').waitFor({ timeout: 30_000 })
  check('Report opened from a link shows the link’s range', ((await o.page.locator('[data-filter="report-dates"]').textContent()) || '').includes(`${dmy(D1)} – ${dmy(D2)}`))
  await o.page.waitForLoadState('networkidle').catch(() => {})
  await o.page.getByRole('heading', { name: 'Monthly attrition' }).first().waitFor({ timeout: 20_000 }).catch(() => {})
  const exportBtn = o.page.getByRole('button', { name: /^Export/ }).first()
  if (await exportBtn.isVisible().catch(() => false) && await exportBtn.isEnabled().catch(() => false)) try {
    o.requests.length = 0
    await exportBtn.click()
    const dl = o.page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
    await o.page.getByRole('menuitem', { name: /Raw rows/ }).click()
    await dl
    const hit = await sawRequest(o, new RegExp(`/v1/reports/attrition/export\\.csv\\?.*from=${D1}&to=${D2}`))
    check('Report CSV download asks for the same from / to', !!hit, hit || o.requests.join(' , '))
  } catch (e) { check('Report CSV download asks for the same from / to', false, String(e.message || e).slice(0, 200)) }
  else check('Attrition has rows for last month, so its CSV can be checked', false)

  // ── 3. Back keeps the range ────────────────────────────────────────────────
  await o.page.goto(base + '/audit-logs')
  await pickRange(o.page, 'dates')
  await o.page.goto(base + '/hrms/reports')
  await o.page.goBack()
  await o.page.locator('[data-filter="dates"]').waitFor({ timeout: 30_000 })
  const backUrl = new URL(o.page.url())
  check('Back to Audit logs keeps ?from=&to=', backUrl.searchParams.get('from') === D1 && backUrl.searchParams.get('to') === D2, backUrl.search)
  check('Back to Audit logs shows the range in the box', ((await o.page.locator('[data-filter="dates"]').textContent()) || '').includes(dmy(D1)))

  // ── 4. quick picks and Clear ───────────────────────────────────────────────
  await o.page.locator('[data-filter="dates"]').click()
  await pop(o.page).waitFor()
  await shot(o.page, 'audit-open-1440')
  await pop(o.page).getByRole('button', { name: 'Last month' }).click()
  const lastFrom = `${prevYm}-01`
  check('"Last month" fills both ends', ((await pop(o.page).locator('.udr-sum').textContent()) || '').includes(dmy(lastFrom)))
  await pop(o.page).getByRole('button', { name: 'Apply' }).click()
  await o.page.waitForURL((u) => u.searchParams.get('from') === lastFrom, { timeout: 10_000 }).catch(() => {})
  check('"Last month" applied to the URL', new URL(o.page.url()).searchParams.get('from') === lastFrom, o.page.url())
  await o.page.locator('[data-filter="dates"]').click()
  await pop(o.page).getByRole('button', { name: 'Clear' }).click()
  await o.page.waitForURL((u) => !u.searchParams.get('from'), { timeout: 10_000 }).catch(() => {})
  check('Clear removes the range (All dates)', !new URL(o.page.url()).searchParams.get('from') && ((await o.page.locator('[data-filter="dates"]').textContent()) || '').includes('All dates'))
  await shot(o.page, 'audit-cleared-1440')

  // ── 5. keyboard: arrows + Enter, and the year grid ─────────────────────────
  await o.page.goto(base + '/hrms/reports/late-marks')
  const lm = o.page.locator('[data-filter="report-dates"]')
  await lm.waitFor({ timeout: 30_000 })
  await lm.focus()
  await o.page.keyboard.press('Enter')
  await pop(o.page).waitFor()
  const cur = pop(o.page).locator('.udr-grid [data-day][tabindex="0"]')
  const startDay = await cur.getAttribute('data-day')
  await cur.focus()
  await o.page.keyboard.press('Enter') // start: the focused day
  await o.page.keyboard.press('ArrowRight')
  await o.page.keyboard.press('ArrowRight')
  await o.page.keyboard.press('Enter') // end: two days on
  const ksum = ((await pop(o.page).locator('.udr-sum').textContent()) || '').replace(/\s+/g, ' ')
  check('Keyboard: Enter, two arrows, Enter picks a 3-day range', ksum.includes('3 days') && ksum.includes(dmy(startDay)), ksum)
  await pop(o.page).locator('.udr-title').first().click()
  await pop(o.page).locator('.udr-title').first().click() // the year title → 12 years
  check('The year title opens a 12-year grid', (await pop(o.page).locator('[data-year]').count()) === 12)
  await shot(o.page, 'years-1440')
  await pop(o.page).locator(`[data-year="${today.slice(0, 4)}"]`).click()
  check('Picking a year shows its months', (await pop(o.page).locator('[data-month]').count()) === 12)
  await shot(o.page, 'months-1440')
  await o.page.keyboard.press('Escape')
  await pop(o.page).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
  check('Escape closes the calendar and leaves the URL alone', (await pop(o.page).count()) === 0 && !new URL(o.page.url()).searchParams.get('from'))

  // ── 6. the dashboard's longest range ───────────────────────────────────────
  await o.page.goto(base + '/dashboard')
  const chip = o.page.locator('.ud-date').first()
  await chip.waitFor({ timeout: 60_000 })
  await chip.click()
  const dpop = o.page.locator('.ud-range-pop')
  await dpop.waitFor()
  await dpop.locator('.udr-title').first().click()
  const two = (() => { const [y, m] = prevYm.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
  await dpop.locator(`[data-month="${two}"]`).click()
  check('Dashboard: a day 2 months back is clickable (not silently blocked)', !(await dpop.locator(`[data-day="${two}-05"]`).isDisabled()))
  await dpop.locator(`[data-day="${two}-05"]`).click()
  await dpop.getByRole('button', { name: 'Next month' }).click()
  await dpop.getByRole('button', { name: 'Next month' }).click()
  await dpop.locator(`[data-day="${today}"]`).click()
  const msg = (await dpop.locator('.udr-foot').textContent()) || ''
  check('Dashboard: a range over 31 days says so in plain words', /Pick 31 days or fewer\. This range is \d+ days\./.test(msg), msg)
  check('Dashboard: Apply waits until the range fits', await dpop.getByRole('button', { name: 'Apply' }).isDisabled())
  await shot(o.page, 'dashboard-too-long-1440')
  await dpop.getByRole('button', { name: 'Cancel' }).click()

  const oErr = apiErrors(o, 'Admin pages')
  check('Admin pages: no API errors', oErr.length === 0, oErr.slice(0, 6).join(' | '))
  await o.ctx.close()

  // ── 1 (self). an employee's own lists ─────────────────────────────────────
  const r = await session('reader@unifiedtree.demo')
  await runPages(r, SELF_PAGES)
  const rErr = apiErrors(r, 'Employee pages')
  check('Employee pages: no API errors', rErr.length === 0, rErr.slice(0, 6).join(' | '))
  await r.ctx.close()

  // ── 7. screenshots, phone ─────────────────────────────────────────────────
  const ph = await session('owner@unifiedtree.demo', { width: 390 })
  await ph.page.goto(base + `/hrms/reports/attendance-summary?from=${D1}&to=${D2}`)
  await ph.page.locator('[data-filter="report-dates"]').waitFor({ timeout: 30_000 })
  await shot(ph.page, 'report-390')
  await ph.page.locator('[data-filter="report-dates"]').click()
  await pop(ph.page).waitFor()
  await sleep(300)
  await shot(ph.page, 'report-open-390')
  const box = await pop(ph.page).boundingBox()
  check('Phone: the calendar fits the screen (390 wide)', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box))
  await pop(ph.page).locator('.udr-title').first().click()
  await shot(ph.page, 'months-390')
  await ph.page.keyboard.press('Escape')
  await ph.page.goto(base + '/audit-logs')
  await ph.page.locator('[data-filter="dates"]').waitFor({ timeout: 30_000 })
  await shot(ph.page, 'audit-390')
  await ph.page.goto(base + `/hrms/payroll/runs?from=${D1}&to=${D2}`)
  await ph.page.locator('[data-filter="dates"]').waitFor({ timeout: 30_000 }).catch(() => {})
  await shot(ph.page, 'payroll-390')
  const hscroll = await ph.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('Phone: no sideways scroll on Payroll runs with a range', !hscroll)
  await ph.ctx.close()

  // Desktop shots of a few wired pages with a range applied.
  const d = await session('owner@unifiedtree.demo')
  for (const [path, name, key] of [[`/hrms/reports/attendance-summary?from=${D1}&to=${D2}`, 'report', 'report-dates'], [`/hrms/payroll/runs?from=${D1}&to=${D2}`, 'payroll', 'dates'],
    [`/hrms/attendance?tab=review&from=${D1}&to=${D2}`, 'review', 'review-dates'], [`/hrms/workforce-analytics?tab=attrition&from=${D1}&to=${D2}`, 'workforce', 'period']]) {
    await d.page.goto(base + path)
    await d.page.locator(`[data-filter="${key}"]`).first().waitFor({ timeout: 30_000 }).catch(() => {})
    await sleep(800)
    await shot(d.page, `${name}-1440`)
  }
  await d.page.goto(base + `/hrms/reports/attendance-summary?from=${D1}&to=${D2}`)
  await d.page.locator('[data-filter="report-dates"]').click()
  await pop(d.page).waitFor()
  await sleep(300)
  await shot(d.page, 'report-open-1440')
  await d.ctx.close()
} catch (e) {
  check('the run finished', false, String(e.stack || e).split('\n').slice(0, 3).join(' | '))
} finally {
  // The CSV export writes one export-log row: remove what this run wrote.
  try { sql(`delete from hrms.report_exports where tenant_id='${tenant}' and created_at >= '${started}' and report like 'attrition%'`) } catch (e) { console.log(`cleanup: ${String(e.message).slice(0, 200)}`) }
  await browser.close()
}

const failedN = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failedN}/${results.length} passed`)
process.exit(failedN ? 1 : 0)
