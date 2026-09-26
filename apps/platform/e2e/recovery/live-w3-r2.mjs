// Live check (wave 3, r2): the shared calendar on the leave, WFH, shift change,
// holiday, time entry, attendance history, muster roll, manual entry and exit
// screens. Picks dates with the mouse (including a previous year through the
// year view), checks each value lands, and that a required date still blocks
// saving while empty. Creates one time entry and one holiday, and deletes both.
//
//   node e2e/recovery/live-w3-r2.mjs
/* global process, console, document */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3022'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Dates, with "today" in IST like the app.
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const today = `${get('year')}-${get('month')}-${get('day')}`
const cy = Number(get('year')), py = cy - 1
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = MONTHS.map((m) => m.slice(0, 3))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const nm = (() => { const d = new Date(today + 'T00:00:00'); d.setDate(1); d.setMonth(d.getMonth() + 1); return iso(d).slice(0, 7) })()
const full = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const short = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
const past = `${py}-09-10`

const browser = await chromium.launch()
let ctx, page
const pageErrors = [], failed = []
async function login(email, viewport = { width: 1440, height: 900 }) {
  if (ctx) await ctx.close()
  ctx = await browser.newContext({ viewport })
  page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForLoadState('networkidle')
}
const dateDialog = () => page.getByRole('dialog', { name: 'Choose date', exact: true })
const monthDialog = () => page.getByRole('dialog', { name: 'Choose month', exact: true })
const text = async (loc) => ((await loc.textContent()) || '').trim()
/** Open a DateField and pick `day` through the year → month → day views. */
async function pickDay(trigger, day, { viaYear = true } = {}) {
  await trigger.click()
  const dlg = dateDialog()
  await dlg.waitFor({ timeout: 5000 })
  const [y, m] = day.split('-').map(Number)
  if (viaYear) {
    await dlg.getByRole('button', { name: 'Choose year' }).click()
    await dlg.locator(`[role=gridcell][aria-label="${y}"]`).click()
    await dlg.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  }
  await dlg.locator(`[role=gridcell][aria-label^="${full(day)}"]`).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}
const shot = (name) => page.screenshot({ path: `${SHOTS}/r2-${name}.png` }).catch(() => {})

let entryTitle = '', entryLeft = false, holidayName = '', holidayLeft = false
try {
  // ── 1. Leave → Apply (a manager applies for their own leave) ──
  await login('mgr@unifiedtree.demo')
  await page.goto(base + '/hrms/leave?tab=apply')
  const leaveFrom = page.getByRole('combobox', { name: 'From *', exact: true })
  const leaveTo = page.getByRole('combobox', { name: 'To *', exact: true })
  await leaveFrom.waitFor({ timeout: 20000 })
  check('leave: From / To are the shared calendar, linked to their labels', (await leaveFrom.count()) === 1 && (await leaveTo.count()) === 1)
  await leaveFrom.click()
  await dateDialog().waitFor({ timeout: 5000 })
  const yesterdayCell = dateDialog().locator(`[role=gridcell][aria-label^="${full(addDays(today, -1))}"]`)
  const yesterdayShown = await yesterdayCell.count()
  check('leave: From keeps min = today (yesterday not pickable)', yesterdayShown === 0 || (await yesterdayCell.getAttribute('aria-disabled')) === 'true')
  await page.keyboard.press('Escape')
  const lf = `${nm}-15`, lt = `${nm}-17`
  await pickDay(leaveFrom, lf)
  check('leave: From shows the picked day', (await text(leaveFrom)).includes(short(lf)), await text(leaveFrom))
  await leaveTo.click()
  await dateDialog().waitFor({ timeout: 5000 })
  check('leave: To keeps min = From', (await dateDialog().locator(`[role=gridcell][aria-label^="${full(addDays(lf, -1))}"]`).getAttribute('aria-disabled')) === 'true')
  await dateDialog().locator(`[role=gridcell][aria-label^="${full(lt)}"]`).click()
  check('leave: To shows the picked day', (await text(leaveTo)).includes(short(lt)), await text(leaveTo))
  await shot('leave-apply-1440')

  // ── 2. Work from home: From bumps To; the day count follows both ──
  await page.goto(base + '/me/wfh')
  const wfhFrom = page.getByRole('combobox', { name: 'From *', exact: true })
  const wfhTo = page.getByRole('combobox', { name: 'To *', exact: true })
  await wfhFrom.waitFor({ timeout: 20000 })
  const wf = `${nm}-20`
  await pickDay(wfhFrom, wf)
  check('wfh: From shows the picked day', (await text(wfhFrom)).includes(short(wf)), await text(wfhFrom))
  check('wfh: To moved up to From (same onChange rule as before)', (await text(wfhTo)).includes(short(wf)), await text(wfhTo))
  await page.locator('textarea').first().fill('Live calendar check, not sent')
  check('wfh: 1 day from home', await page.getByText('1 day from home').first().isVisible())
  await pickDay(wfhTo, addDays(wf, 2), { viaYear: false })
  check('wfh: 3 days from home after picking To', await page.getByText('3 days from home').first().isVisible(), await text(wfhTo))

  // ── 3. Shift change request ──
  await page.goto(base + '/me/shift-change')
  const shiftDate = page.getByRole('combobox', { name: 'Starting from *', exact: true })
  const hasForm = await shiftDate.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  check('shift change: Starting from is the shared calendar', hasForm)
  // The field stays disabled until the employee, company and shift list have loaded.
  await page.waitForLoadState('networkidle')
  for (let i = 0; hasForm && i < 20 && (await shiftDate.isDisabled()); i++) await page.waitForTimeout(500)
  if (hasForm && !(await shiftDate.isDisabled())) {
    const sd = `${nm}-25`
    await pickDay(shiftDate, sd)
    check('shift change: Starting from shows the picked day', (await text(shiftDate)).includes(short(sd)), await text(shiftDate))
  } else if (hasForm) check('shift change: field disabled (no other shift to move to)', true)
  check('leave/wfh/shift pages: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // ── 4. My workspace (/me): attendance history month + time entries on a previous-year day ──
  pageErrors.length = 0
  await login('reader@unifiedtree.demo')
  await page.goto(base + '/me')
  const monthF = page.getByRole('combobox', { name: 'Attendance month', exact: true })
  await monthF.waitFor({ timeout: 20000 })
  check('history: month box is the shared MonthField', (await text(monthF)).includes(`${MONTHS[Number(get('month')) - 1]} ${cy}`), await text(monthF))
  await monthF.click()
  await monthDialog().waitFor({ timeout: 5000 })
  const next = monthDialog().locator(`[role=gridcell][aria-label="${MONTHS[Number(nm.slice(5, 7)) - 1]} ${nm.slice(0, 4)}"]`)
  check('history: max = this month (next month not pickable)', (await next.count()) === 0 || (await next.getAttribute('aria-disabled')) === 'true')
  await monthDialog().getByRole('button', { name: 'Choose year' }).click()
  const histReq = page.waitForRequest((r) => r.url().includes('/v1/attendance/history') && r.url().includes(`year=${py}`) && r.url().includes('month=9'), { timeout: 15000 }).catch(() => null)
  await monthDialog().locator(`[role=gridcell][aria-label="${py}"]`).click()
  await monthDialog().locator(`[role=gridcell][aria-label="September ${py}"]`).click()
  check('history: picking September last year asks for it', !!(await histReq))
  check('history: box shows September last year', (await text(monthF)).includes(`September ${py}`), await text(monthF))

  const dayF = page.getByRole('combobox', { name: 'Time entry date', exact: true })
  const entriesReq = page.waitForRequest((r) => r.url().includes(`/v1/ess/timesheets?from=${past}&to=${past}`), { timeout: 15000 }).catch(() => null)
  await pickDay(dayF, past)
  check('time entries: a previous-year day through the year view loads that day', !!(await entriesReq))
  check('time entries: box shows the picked day', (await text(dayF)).includes(short(past)), await text(dayF))
  await page.waitForLoadState('networkidle')
  await shot('ess-1440')
  entryTitle = `W3 r2 calendar check ${Date.now()}`
  await page.getByLabel('Work description').fill(entryTitle)
  await page.getByLabel('Time entry minutes').fill('30')
  const post = page.waitForResponse((r) => r.url().includes('/v1/ess/timesheets') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
  await page.getByRole('button', { name: 'Add entry' }).click()
  const pr = await post
  const body = pr && pr.ok() ? await pr.request().postDataJSON() : null
  check('time entries: the entry is saved on the picked day', !!body && body.workDate === past, pr ? `${pr.status()} ${JSON.stringify(body)}` : 'no request')
  const row = page.locator('div', { has: page.locator('strong', { hasText: entryTitle }) }).last()
  entryLeft = await row.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  check('time entries: the entry is listed', entryLeft)
  if (entryLeft) {
    await row.getByRole('button', { name: 'Delete' }).click()
    const del = page.waitForResponse((r) => r.url().includes('/v1/ess/timesheets/') && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
    await row.getByRole('button', { name: 'Delete' }).click()
    const dr = await del
    entryLeft = !(dr && dr.ok())
    check('time entries: the test entry is deleted', !entryLeft && await page.locator('strong', { hasText: entryTitle }).waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false))
  }
  check('my workspace: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // Phone: the two boxes fit, and the calendar opens as a bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/me')
  await dayF.waitFor({ timeout: 20000 })
  await dayF.scrollIntoViewIfNeeded()
  const bw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no horizontal page scroll on /me', bw <= 390, String(bw))
  await dayF.click()
  await dateDialog().waitFor({ timeout: 5000 })
  await page.waitForTimeout(350)
  const sb = await dateDialog().boundingBox()
  check('390px: the calendar stays inside the viewport', !!sb && sb.x >= 0 && sb.x + sb.width <= 390.5 && sb.y + sb.height <= 844.5, JSON.stringify(sb))
  await shot('ess-sheet-390')
  await page.keyboard.press('Escape')

  // ── 5. Holidays (owner): add one next year with the calendar, then delete it ──
  pageErrors.length = 0
  await login('owner@unifiedtree.demo')
  await page.goto(base + '/hrms/leave?tab=holidays')
  const yearSel = page.locator('select').filter({ has: page.locator(`option[value="${cy + 1}"]`) }).first()
  await yearSel.waitFor({ timeout: 20000 })
  await yearSel.selectOption(String(cy + 1))
  await page.getByRole('button', { name: 'Add Holiday' }).first().click()
  const holDrawer = page.locator('div.ut-card', { has: page.locator('h3', { hasText: 'Add Holiday' }) })
  const holF = holDrawer.locator('.utc-field').getByRole('combobox')
  await holF.waitFor({ timeout: 10000 })
  check('holiday: date prefilled to 1 Jan of the viewed year', (await text(holF)).includes(`1 Jan ${cy + 1}`), await text(holF))
  const hd = `${cy + 1}-12-24`
  await pickDay(holF, hd)
  check('holiday: date shows the picked day', (await text(holF)).includes(short(hd)), await text(holF))
  holidayName = `W3 r2 calendar check ${Date.now()}`
  await page.getByPlaceholder('e.g. Republic Day').fill(holidayName)
  const hpost = page.waitForResponse((r) => r.url().includes('/v1/settings/holidays') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
  await page.getByRole('button', { name: 'Add Holiday' }).last().click()
  const hr = await hpost
  const hbody = hr && hr.ok() ? await hr.json() : null
  holidayLeft = !!hbody
  check('holiday: saved on the picked day', !!hbody && hbody.holidayDate === hd, hr ? `${hr.status()} ${hbody?.holidayDate}` : 'no request')
  const hrow = page.locator('.ut-card-sm', { hasText: holidayName })
  check('holiday: listed under that year', await hrow.waitFor({ timeout: 15000 }).then(() => true).catch(() => false))
  if (holidayLeft) {
    page.once('dialog', (d) => d.accept())
    const hdel = page.waitForResponse((r) => r.url().includes('/v1/settings/holidays/') && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
    await hrow.getByRole('button').click()
    const hdr = await hdel
    holidayLeft = !(hdr && hdr.ok())
    check('holiday: the test holiday is removed', !holidayLeft && await hrow.waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false))
  }

  // ── 6. Muster roll: a previous-year day ──
  await page.goto(base + '/hrms/muster-roll')
  const musterF = page.getByRole('combobox', { name: 'Date', exact: true })
  await musterF.waitFor({ timeout: 20000 })
  const mReq = page.waitForRequest((r) => r.url().includes('/v1/attendance/dashboard') && r.url().includes(`date=${past}`), { timeout: 15000 }).catch(() => null)
  await pickDay(musterF, past)
  check('muster roll: asks for the picked day', !!(await mReq))
  const longPast = `${new Date(past + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}, 10 September ${py}`
  check('muster roll: heading shows the picked day', await page.getByText(longPast).first().isVisible(), longPast)
  check('muster roll: box shows the picked day (short)', (await text(musterF)).includes(short(past)), await text(musterF))
  await shot('muster-1440')

  // ── 7. Manual entry: the label opens the calendar; a preset lands ──
  await page.goto(base + '/hrms/attendance/manual-entry')
  const meF = page.getByRole('combobox', { name: 'Date', exact: true })
  await meF.waitFor({ timeout: 20000 })
  await page.locator('label[for="me-date"]').click()
  check('manual entry: clicking the Date label opens the calendar', await dateDialog().waitFor({ timeout: 5000 }).then(() => true).catch(() => false))
  const future = dateDialog().locator(`[role=gridcell][aria-label^="${full(addDays(today, 1))}"]`)
  check('manual entry: max = today (tomorrow not pickable)', (await future.count()) === 0 || (await future.getAttribute('aria-disabled')) === 'true')
  await dateDialog().getByRole('button', { name: 'Yesterday' }).click()
  check('manual entry: Date shows yesterday', (await text(meF)).includes(short(addDays(today, -1))), await text(meF))
  check('manual entry: time boxes unchanged', (await page.locator('#me-in[type=time]').count()) === 1 && (await page.locator('#me-out[type=time]').count()) === 1)
  await shot('manual-entry-1440')

  // ── 8. Exit: Start notice blocks an empty last working day; Edit dates shows saved dates ──
  await page.goto(base + '/hrms/exit')
  await page.getByRole('button', { name: 'Start notice' }).first().click()
  const drawer = page.getByRole('dialog', { name: 'Start notice period' })
  await drawer.waitFor({ timeout: 10000 })
  const startF = drawer.locator('label', { hasText: 'Notice start date' }).getByRole('combobox')
  const lastF = drawer.locator('label', { hasText: 'Last working day' }).getByRole('combobox')
  check('exit: notice start prefilled to today', (await text(startF)).includes(short(today)), await text(startF))
  const lastNative = drawer.locator('label', { hasText: 'Last working day' }).locator('input.utc-native')
  check('exit: empty last working day is required (native valueMissing)', await lastNative.evaluate((el) => el.required && el.validity.valueMissing))
  await drawer.locator('#notice-employee-search').fill('Reader')
  await drawer.getByRole('option', { name: /Reader User/ }).first().click()
  const saveBtn = drawer.getByRole('button', { name: 'Start notice', exact: true })
  check('exit: Save stays blocked while the last working day is empty', await saveBtn.isDisabled())
  await lastF.click()
  await dateDialog().waitFor({ timeout: 5000 })
  const beforeStart = dateDialog().locator(`[role=gridcell][aria-label^="${full(addDays(today, -1))}"]`)
  check('exit: last working day keeps min = notice start', (await beforeStart.count()) === 0 || (await beforeStart.getAttribute('aria-disabled')) === 'true')
  await page.keyboard.press('Escape')
  const ld = `${nm}-28`
  await pickDay(lastF, ld)
  check('exit: last working day shows the picked day', (await text(lastF)).includes(short(ld)), await text(lastF))
  check('exit: the required date is filled (valueMissing cleared)', await lastNative.evaluate((el) => !el.validity.valueMissing))
  check('exit: Save is enabled once both dates are set', await saveBtn.isEnabled())
  await shot('exit-start-1440')
  await drawer.getByRole('button', { name: 'Cancel' }).click()
  await drawer.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const edit = page.getByRole('button', { name: 'Edit dates' }).first()
  if (await edit.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)) {
    await edit.click()
    const sep = page.getByRole('dialog', { name: /Separation details/ })
    await sep.waitFor({ timeout: 10000 })
    const s1 = await text(sep.locator('label', { hasText: 'Notice start date' }).getByRole('combobox'))
    const s2 = await text(sep.locator('label', { hasText: 'Last working day' }).getByRole('combobox'))
    check('exit: Edit dates shows the saved notice dates', /\d{1,2} \w{3} \d{4}/.test(s1) && /\d{1,2} \w{3} \d{4}/.test(s2), `${s1} / ${s2}`)
    await sep.getByRole('button', { name: 'Cancel' }).click()
  } else check('exit: someone on notice to open Edit dates', false, 'no Edit dates button')
  check('owner pages: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // Phone: WFH form fits, and its calendar is a bottom sheet inside the screen.
  await login('mgr@unifiedtree.demo', { width: 390, height: 844 })
  await page.goto(base + '/me/wfh')
  const pf = page.getByRole('combobox', { name: 'From *', exact: true })
  await pf.waitFor({ timeout: 20000 })
  const pw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no horizontal page scroll on /me/wfh', pw <= 390, String(pw))
  await pf.click()
  await dateDialog().waitFor({ timeout: 5000 })
  await page.waitForTimeout(350)
  await dateDialog().getByRole('button', { name: 'Choose year' }).click()
  await page.waitForTimeout(250)
  await shot('wfh-years-390')
  await page.keyboard.press('Escape')
  check('no failed API calls', failed.length === 0, failed.slice(0, 5).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
  await shot('fail')
} finally {
  // Best effort: never leave the test's own records behind.
  try {
    if (entryLeft && entryTitle) {
      await login('reader@unifiedtree.demo')
      await page.goto(base + '/me')
      const dayF = page.getByRole('combobox', { name: 'Time entry date', exact: true })
      await pickDay(dayF, past)
      const row = page.locator('div', { has: page.locator('strong', { hasText: entryTitle }) }).last()
      await row.getByRole('button', { name: 'Delete' }).click()
      await row.getByRole('button', { name: 'Delete' }).click()
      await page.waitForTimeout(1500)
      console.log('cleanup: removed the leftover time entry')
    }
    if (holidayLeft && holidayName) {
      await login('owner@unifiedtree.demo')
      await page.goto(base + '/hrms/leave?tab=holidays')
      await page.locator('select').filter({ has: page.locator(`option[value="${cy + 1}"]`) }).first().selectOption(String(cy + 1))
      page.once('dialog', (d) => d.accept())
      await page.locator('.ut-card-sm', { hasText: holidayName }).getByRole('button').click()
      await page.waitForTimeout(1500)
      console.log('cleanup: removed the leftover holiday')
    }
  } catch (e) { console.log('cleanup failed: ' + String(e.message || e).slice(0, 200)) }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
