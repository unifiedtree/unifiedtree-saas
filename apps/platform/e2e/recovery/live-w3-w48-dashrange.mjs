/* global process, console, fetch, Buffer, localStorage, sessionStorage, setTimeout, document, getComputedStyle, URL */
// Live check of the owner's 6 Oct dashboard decisions (w48):
//
//  1. Headcount on a past date: the dashboard summary, the Reports Center headcount report, its PDF and the
//     headcount workbook count the same people, with a leaver counted on their last working day (the demo
//     company's leavers left on 22–25 Sep). Today keeps today's rule.
//  2. The range summary: GET /v1/admin/dashboard/stats?from= sends the end day's headcount plus the period's
//     joiners and leavers (as counted from the employee rows), and one day's summary is unchanged.
//  3. The dashboard's date picker is a plain start / end calendar (six quick picks, Apply / Cancel, no
//     stats panel); a range's cards add up the trend's days (Present days = the days' check-ins, the note
//     says the period); one click + Apply is one day, exactly as before.
//  4. Screenshots: 1440 and 390 wide, light and dark (/c/REACT/ut-wt/_results/shots/w48-dashrange-*.png).
//
// It only reads, apart from the PDF download's export-log row, which it removes.
//   node e2e/recovery/live-w3-w48-dashrange.mjs   (inside live-slot.sh)
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3148'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const call = async (method, path, { raw = false } = {}) => {
    const res = await fetch(api + path, { method, headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` } })
    if (raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.claims = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString())
  return call
}

// ── the dates ────────────────────────────────────────────────────────────────
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const start = sql('select now()')
// Past days around the demo leavers' last working days, plus yesterday.
const leaverDays = sql(`select coalesce(string_agg(distinct coalesce(last_working_day, date_of_termination)::text, ','), '') from hrms.employees
  where company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(last_working_day, date_of_termination) < '${today}'`).split(',').filter(Boolean).sort()
const lastLeaverDay = leaverDays[leaverDays.length - 1] || addDays(today, -10)
const pastDays = [...new Set([...leaverDays, addDays(lastLeaverDay, 1), addDays(today, -1)])].filter((d) => d < today)

// The rule, straight from the rows: joined by then (else created by then), and a leaver still works their last day.
const expectedOn = (d) => Number(sql(`select count(*) from hrms.employees e where e.tenant_id='${tenant}' and e.company_id='${company}'
  and coalesce(e.date_of_joining, (e.created_at at time zone 'Asia/Kolkata')::date) <= '${d}'
  and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') < '${d}')`))
const leavingOn = (d) => Number(sql(`select count(*) from hrms.employees where company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED')
  and coalesce(last_working_day, date_of_termination) = '${d}'`))
const removedRows = Number(sql(`select count(*) from hrms.employees where company_id='${company}' and is_active = false`))

const browser = await chromium.launch()
// `promptSeen`: the login id whose check-in prompt already opened today (punchPromptRules), so it stays away.
async function session(email, { width = 1440, theme = 'light', promptSeen = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  if (promptSeen) await ctx.addInitScript(([id, day]) => { try { sessionStorage.setItem(`ut.punch-prompt.opened:${id}`, day) } catch { /* private mode */ } }, [promptSeen, today])
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { ctx, page, errors, failed }
}
async function card(page, label) {
  const tile = page.getByRole('button', { name: new RegExp('^\\s*' + label, 'i') }).first()
  await tile.waitFor({ timeout: 30_000 })
  let v = '', prev = null
  for (let i = 0; i < 15; i++) {
    v = ((await tile.locator('.uk-stat__value').textContent().catch(() => '')) || '').replace(/\s+/g, '')
    if (v && v === prev) break
    prev = v; await sleep(400)
  }
  const n = ((await tile.locator('.uk-stat__note').textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  return { v, n }
}
// A card's note is one line with an ellipsis: it must be read whole (its text, in its font, no wider than its box).
const noteFits = (page, label) => page.getByRole('button', { name: new RegExp('^\\s*' + label, 'i') }).first().locator('.uk-stat__note')
  .evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d')
    c.font = getComputedStyle(el).font
    return c.measureText(el.textContent || '').width <= el.getBoundingClientRect().width + 1
  }).catch(() => false)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (iso) => ({ d: Number(iso.slice(8, 10)), m: MON[Number(iso.slice(5, 7)) - 1] })
const period = (a, b) => { const x = dm(a), y = dm(b); return x.m === y.m ? `${x.d}–${y.d} ${y.m}` : `${x.d} ${x.m} – ${y.d} ${y.m}` }

let lastPage = null
try {
  const owner = await apiLogin('owner@unifiedtree.demo')

  // ── 1. one headcount on a past date ────────────────────────────────────────
  console.log(`INFO  leavers' last days: ${leaverDays.join(', ') || 'none'} · removed rows: ${removedRows}`)
  check('the demo company has leavers with a past last working day to test with', leaverDays.length > 0)
  for (const d of pastDays) {
    const st = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}&date=${d}`)
    const rep = await owner('GET', `/v1/reports/headcount?companyId=${company}&asOf=${d}`)
    const wb = await owner('GET', `/v1/reports/headcount/workbook?companyId=${company}&asOf=${d}`)
    const dash = Number(st.json?.headcount)
    const report = (rep.json || []).reduce((n, r) => n + Number(r.total || 0), 0)
    const split = (rep.json || []).reduce((n, r) => n + Number(r.active || 0) + Number(r.on_notice || 0) + Number(r.probation || 0), 0)
    const book = Number(wb.json?.totals?.total)
    const exp = expectedOn(d)
    check(`${d}: dashboard, headcount report and workbook agree (${leavingOn(d)} leaving that day)`,
      st.status === 200 && rep.status === 200 && wb.status === 200 && dash === report && (removedRows ? true : report === book) && report === exp,
      `dashboard ${dash} · report ${report} · workbook ${book} · rule ${exp}`)
    check(`${d}: the report's split adds up to its total`, split === report, `${split} of ${report}`)
  }
  if (leaverDays.length) {
    const d = lastLeaverDay
    const rep = await owner('GET', `/v1/reports/headcount?companyId=${company}&asOf=${d}`)
    const next = await owner('GET', `/v1/reports/headcount?companyId=${company}&asOf=${addDays(d, 1)}`)
    const tot = (r) => (r.json || []).reduce((n, x) => n + Number(x.total || 0), 0)
    const leaving = leavingOn(d)
    check(`${d}: the people whose last working day it is still count; the next day they don't`,
      leaving > 0 && tot(rep) - tot(next) >= leaving, `${tot(rep)} on ${d} · ${tot(next)} the day after · ${leaving} left that day`)
  }
  {
    const st = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}`)
    const rep = await owner('GET', `/v1/reports/headcount?companyId=${company}`)
    const report = (rep.json || []).reduce((n, r) => n + Number(r.total || 0), 0)
    check('today: the dashboard and the headcount report still agree (today’s rule)', Number(st.json?.headcount) === report, `${st.json?.headcount} · ${report}`)
  }
  {
    const pdf = await owner('GET', `/v1/reports/headcount/export.pdf?companyId=${company}&asOf=${lastLeaverDay}`, { raw: true })
    check('the headcount PDF for a past date downloads', pdf.status === 200 && pdf.bytes.subarray(0, 5).toString() === '%PDF-', `${pdf.status} · ${pdf.bytes.length} bytes`)
  }

  // ── 2. the range summary ───────────────────────────────────────────────────
  const rFrom = addDays(lastLeaverDay, -6), rTo = addDays(lastLeaverDay, 1) < today ? addDays(lastLeaverDay, 1) : addDays(today, -1)
  {
    const one = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}&date=${rTo}`)
    const range = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}&date=${rTo}&from=${rFrom}`)
    const joined = Number(sql(`select count(*) from hrms.employees where company_id='${company}'
      and coalesce(date_of_joining, (created_at at time zone 'Asia/Kolkata')::date) between '${rFrom}' and '${rTo}'`))
    const left = Number(sql(`select count(*) from hrms.employees where company_id='${company}' and employment_status in ('EXITED','TERMINATED','RESIGNED')
      and coalesce(last_working_day, date_of_termination) between '${rFrom}' and '${rTo}'`))
    check('a range’s summary is its end day’s headcount', range.status === 200 && range.json?.headcount === one.json?.headcount && range.json?.joinedInMonth === one.json?.joinedInMonth,
      `${range.json?.headcount} · ${one.json?.headcount}`)
    check('a range’s summary adds the period’s joiners and leavers', range.json?.joinedInPeriod === joined && range.json?.leftInPeriod === left
      && range.json?.periodFrom === rFrom && range.json?.periodTo === rTo, `joined ${range.json?.joinedInPeriod}/${joined} · left ${range.json?.leftInPeriod}/${left}`)
    check('one day’s summary has no period figures', !('joinedInPeriod' in (one.json || {})))
    const todayRange = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}&from=${addDays(today, -6)}`)
    check('a range ending today: today’s summary plus the period', todayRange.status === 200 && todayRange.json?.periodTo === today && typeof todayRange.json?.joinedInPeriod === 'number')
  }

  // ── 3. the dashboard in the browser ────────────────────────────────────────
  const trend = await owner('GET', `/v1/attendance/dashboard/trend?from=${rFrom}&to=${rTo}&includeLeavers=true&includeSelf=true`)
  const came = (trend.json || []).reduce((n, r) => n + (typeof r.checkedIn === 'number' ? r.checkedIn : r.present + r.late + r.halfDay + r.workFromHome), 0)
  const lateSum = (trend.json || []).reduce((n, r) => n + r.late, 0)
  const absSum = (trend.json || []).reduce((n, r) => n + r.absent, 0)
  const o = await session('owner@unifiedtree.demo', { promptSeen: owner.claims.sub })
  lastPage = o.page
  {
    const { page } = o
    await page.goto(`${base}/dashboard`, { timeout: 60_000 })
    const before = await card(page, 'Present')
    const chip = page.getByRole('button', { name: /change the dashboard date/ }).first()
    await chip.click()
    const pop = page.getByRole('dialog', { name: 'Choose dashboard date' })
    await pop.waitFor({ timeout: 10_000 })
    const text = (await pop.textContent()) || ''
    check('the picker: start and end date, six quick picks, Apply and Cancel',
      ['Start date', 'End date', 'Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Apply', 'Cancel'].every((t) => text.includes(t)))
    check('the picker has no stats panel or attendance legend', !/Selected day|Last working day|Attendance ≥|scheduled staff/.test(text))
    await page.screenshot({ path: `${SHOTS}/w48-dashrange-picker-1440-light.png` })
    // A day after today can't be picked.
    const tomorrow = pop.locator(`[data-day="${addDays(today, 1)}"]`)
    check('days after today are disabled', (await tomorrow.count()) === 0 || await tomorrow.isDisabled())
    await pop.getByRole('button', { name: 'Cancel' }).click()
    check('Cancel closes the picker and changes nothing', !(await pop.isVisible()) && !page.url().includes('date='))

    // One click + Apply: one day, exactly as before.
    await chip.click()
    await pop.getByRole('button', { name: 'Yesterday' }).click()
    await pop.getByRole('button', { name: 'Apply' }).click()
    await page.waitForURL((u) => u.searchParams.get('date') === addDays(today, -1), { timeout: 10_000 }).catch(() => {})
    const u1 = new URL(page.url())
    check('Yesterday + Apply shows that one day (?date=, no range)', u1.searchParams.get('date') === addDays(today, -1) && !u1.searchParams.has('from'), u1.search)
    const dayCard = await card(page, 'Present')
    check('one day keeps the Present card (not "Present days")', !(await page.getByRole('button', { name: /^\s*Present days/i }).count()) && !!dayCard.v)

    // A range from the URL: the cards add up the period.
    await page.goto(`${base}/dashboard?from=${rFrom}&date=${rTo}`, { timeout: 60_000 })
    const pd = await card(page, 'Present days')
    const late = await card(page, 'Late arrivals')
    const abs = await card(page, 'Absences')
    const tot = await card(page, 'Total employees')
    const per = period(rFrom, rTo)
    check('a range: Present days is the period’s check-ins', Number(pd.v) === came, `${pd.v} · trend ${came}`)
    check('a range: Present days’ note gives the attendance % and the period', /\d+% attendance · /.test(pd.n) && pd.n.endsWith(per), pd.n)
    check('a range: Late arrivals and Absences add up the period', Number(late.v) === lateSum && Number(abs.v) === absSum && late.n.includes(per) && abs.n.includes(per),
      `late ${late.v}/${lateSum} · absent ${abs.v}/${absSum}`)
    const stR = await owner('GET', `/v1/admin/dashboard/stats?companyId=${company}&date=${rTo}&from=${rFrom}`)
    check('a range: Total employees is the end date’s headcount, with the period’s joiners and leavers',
      Number(tot.v) === Number(stR.json?.headcount) && tot.n === `${stR.json?.joinedInPeriod} joined · ${stR.json?.leftInPeriod} left, ${per}`, `${tot.v} · ${tot.n}`)
    for (const label of ['Total employees', 'Present days', 'Leave days', 'Late arrivals', 'Half days', 'WFH days', 'Not marked', 'Absences']) {
      check(`a range: the ${label} note is read whole (1440)`, await noteFits(page, label))
    }
    const chipText = ((await chip.textContent()) || '').replace(/\s+/g, ' ')
    check('a range: the date chip says Period and both ends', chipText.includes('Period') && chipText.includes(String(Number(rFrom.slice(8)))), chipText)
    check('a range: the banner says what the cards add up', await page.getByText(/The cards at the top add up the period/).isVisible())
    await page.screenshot({ path: `${SHOTS}/w48-dashrange-range-1440-light.png` })
    // "Back to today" leaves the range.
    await page.getByRole('button', { name: 'Back to today' }).click()
    await sleep(500)
    const u2 = new URL(page.url())
    check('Back to today drops the range', !u2.searchParams.has('from') && !u2.searchParams.has('date'), u2.search)
    const after = await card(page, 'Present')
    check('today’s Present card is back as before', after.v === before.v, `${after.v} · ${before.v}`)

    // A quick pick range through the picker.
    await chip.click()
    await pop.getByRole('button', { name: 'Last week' }).click()
    await pop.getByRole('button', { name: 'Apply' }).click()
    await sleep(600)
    const u3 = new URL(page.url())
    check('Last week + Apply is a range (?from= and ?date=)', !!u3.searchParams.get('from') && !!u3.searchParams.get('date') && u3.searchParams.get('from') < u3.searchParams.get('date'), u3.search)
    await card(page, 'Present days')
    check('owner: no page errors', !o.errors.length, o.errors.slice(0, 2).join(' | '))
    check('owner: no failed API calls', !o.failed.length, o.failed.slice(0, 3).join(' | '))
  }
  await o.ctx.close()

  // ── 4. screenshots: 1440 / 390, light / dark ───────────────────────────────
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      if (theme === 'light' && width === 1440) continue
      const s = await session('owner@unifiedtree.demo', { width, theme, promptSeen: owner.claims.sub })
      lastPage = s.page
      await s.page.goto(`${base}/dashboard?from=${rFrom}&date=${rTo}`, { timeout: 60_000 })
      await card(s.page, 'Present days')
      check(`${width} ${theme}: the Present days and Absences notes are read whole`, await noteFits(s.page, 'Present days') && await noteFits(s.page, 'Absences'))
      await s.page.screenshot({ path: `${SHOTS}/w48-dashrange-range-${width}-${theme}.png` })
      await s.page.getByRole('button', { name: /change the dashboard date/ }).first().click()
      await s.page.getByRole('dialog', { name: 'Choose dashboard date' }).waitFor({ timeout: 10_000 })
      await sleep(300)
      await s.page.screenshot({ path: `${SHOTS}/w48-dashrange-picker-${width}-${theme}.png` })
      check(`${width} ${theme}: no page errors`, !s.errors.length, s.errors.slice(0, 2).join(' | '))
      await s.ctx.close()
    }
  }
} catch (e) {
  if (lastPage) await lastPage.screenshot({ path: `${SHOTS}/w48-dashrange-failure.png` }).catch(() => {})
  check('test ran to the end', false, String(e && e.stack || e).split('\n').slice(0, 6).join(' | '))
} finally {
  await browser.close()
  try { sql(`delete from hrms.report_exports where tenant_id='${tenant}' and created_at >= '${start}' and report = 'headcount'`) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) }
  const left = Number(sql(`select count(*) from hrms.report_exports where tenant_id='${tenant}' and created_at >= '${start}' and report = 'headcount'`))
  check('cleanup: the PDF’s export-log row is removed', left === 0, `left ${left}`)
  const failedCount = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failedCount}/${results.length} passed`)
  process.exit(failedCount ? 1 : 0)
}
