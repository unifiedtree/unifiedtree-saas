// Live check (wave 3, r2): the shared calendar on the leave, shift change (WFH: day chips since P-HOME),
// holiday, time entry (Timesheet), attendance history (My Attendance), muster roll, manual entry and exit
// screens. Picks dates with the mouse (including a previous year through the
// year view), checks each value lands, and that a required date still blocks
// saving while empty. Creates one time entry and one holiday, and deletes both.
//
//   node e2e/recovery/live-w3-r2.mjs
/* global process, console, document */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
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
/** The Monday of a day's week (yyyy-MM-dd). */
const mondayOf = (s) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }
/** On the Timesheet: step back from this week to the week of `past`. */
async function goBackWeeks() {
  const weeksBack = Math.round((new Date(mondayOf(today) + 'T00:00:00') - new Date(mondayOf(past) + 'T00:00:00')) / (7 * 864e5))
  for (let i = 0; i < weeksBack; i++) await page.getByRole('button', { name: 'Previous week' }).click()
}
/** Delete one of reader@'s time entries (by its text) in the Timesheet week on screen; true when the DELETE succeeded. */
async function deleteEntry(text) {
  const row = page.getByRole('list', { name: 'Entries this week' }).locator('li', { hasText: text })
  await row.getByRole('button', { name: 'Edit' }).click()
  const panel = page.getByRole('dialog', { name: 'Edit time' })
  await panel.waitFor({ timeout: 10000 })
  await panel.getByRole('button', { name: 'Delete', exact: true }).click()
  const del = page.waitForResponse((r) => r.url().includes('/v1/ess/timesheets/') && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
  await panel.getByRole('button', { name: 'Delete this entry' }).click()
  const dr = await del
  return !!(dr && dr.ok())
}
const shot = (name) => page.screenshot({ path: `${SHOTS}/r2-${name}.png` }).catch(() => {})

let entryTitle = '', entryLeft = false, holidayName = '', holidayLeft = false
try {
  // ── 1. Leave → Apply (a manager applies for their own leave) ──
  await login('mgr@unifiedtree.demo')
  await page.goto(base + '/hrms/leave?tab=apply')
  // From / To open "Select dates" (one dialog for both ends).
  const leaveFrom = page.getByRole('button', { name: /^From:/ })
  const leaveTo = page.getByRole('button', { name: /^To:/ })
  const rangeDialog = () => page.getByRole('dialog', { name: 'Select dates', exact: true })
  const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  await leaveFrom.waitFor({ timeout: 20000 })
  check('leave: From / To open the Select dates dialog', (await leaveFrom.count()) === 1 && (await leaveTo.count()) === 1)
  await leaveFrom.click()
  await rangeDialog().waitFor({ timeout: 5000 })
  const yesterdayCell = rangeDialog().locator(`[data-day="${addDays(today, -1)}"]`)
  const yesterdayShown = await yesterdayCell.count()
  check('leave: min = today (yesterday not pickable)', yesterdayShown === 0 || await yesterdayCell.isDisabled())
  const lf = `${nm}-15`, lt = `${nm}-17`
  await rangeDialog().getByRole('button', { name: 'Next month' }).click()
  await rangeDialog().locator(`[data-day="${lf}"]`).click()
  await rangeDialog().locator(`[data-day="${lt}"]`).click()
  await rangeDialog().getByRole('button', { name: 'Done' }).click()
  check('leave: From shows the picked day', (await text(leaveFrom)).includes(ddmm(lf)), await text(leaveFrom))
  check('leave: To shows the picked day', (await text(leaveTo)).includes(ddmm(lt)), await text(leaveTo))
  await shot('leave-apply-1440')

  // ── 2. Work from home (P-HOME): separate days are picked as chips, not a From/To range ──
  await page.goto(base + '/me/wfh')
  const chips = page.getByRole('group', { name: 'Pick days' }).getByRole('button')
  await chips.first().waitFor({ timeout: 20000 })
  const free = page.getByRole('group', { name: 'Pick days' }).locator('button:not([disabled])')
  const nFree = await free.count()
  check('wfh: day chips for the coming working days', (await chips.count()) >= 5, `${await chips.count()} chips, ${nFree} free`)
  if (nFree >= 2) {
    await free.nth(0).click()
    await free.nth(1).click()
    check('wfh: picked chips are pressed', (await page.getByRole('group', { name: 'Pick days' }).locator('button[aria-pressed="true"]').count()) === 2)
    check('wfh: 2 days picked', await page.getByText(/^2 days: /).first().isVisible())
    await page.getByRole('button', { name: 'Later days' }).click()
    await page.getByRole('button', { name: 'Earlier days' }).click()
    check('wfh: picks are kept across pages', (await page.getByRole('group', { name: 'Pick days' }).locator('button[aria-pressed="true"]').count()) === 2)
  } else check('wfh: at least two free days to pick', false, `${nFree} free`)
  await page.locator('textarea').first().fill('Live chip check, not sent')

  // ── 3. Shift change request ──
  await page.goto(base + '/me/shift-change')
  // P-HOME: the date field is "From" and opens once a shift card is picked.
  const shiftDate = page.getByRole('combobox', { name: /^From/ })
  const hasForm = await shiftDate.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  check('shift change: From is the shared calendar', hasForm)
  // The field stays disabled until a shift card is picked.
  await page.waitForLoadState('networkidle')
  const card = page.getByRole('group', { name: 'Shifts' }).locator('button:not([disabled])').first()
  if (await card.count()) await card.click()
  for (let i = 0; hasForm && i < 20 && (await shiftDate.isDisabled()); i++) await page.waitForTimeout(500)
  if (hasForm && !(await shiftDate.isDisabled())) {
    const sd = `${nm}-25`
    await pickDay(shiftDate, sd)
    check('shift change: From shows the picked day', (await text(shiftDate)).includes(short(sd)), await text(shiftDate))
  } else if (hasForm) check('shift change: field disabled (no other shift to move to)', true)
  check('leave/wfh/shift pages: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // ── 4. My Attendance and Timesheet (P-ATT-DAY): the history month and a time entry on a previous-year day ──
  // Before P-ATT-DAY these were the fallback sections on /me (a month box and a day box). Now the month
  // is My Attendance's month view (arrows; the next month stops at this one) and time entries are the
  // Timesheet's, a week at a time.
  pageErrors.length = 0
  await login('reader@unifiedtree.demo')
  await page.goto(base + '/hrms/attendance?tab=my')
  const monthNext = page.getByRole('button', { name: 'Next month' })
  await monthNext.waitFor({ timeout: 30000 })
  const monthTitle = () => page.getByRole('heading', { name: new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`) }).first().textContent().then((t) => (t || '').trim())
  check('history: the month view opens on this month', (await monthTitle()) === `${MONTHS[Number(get('month')) - 1]} ${cy}`, await monthTitle())
  check('history: max = this month (next month not pickable)', await monthNext.isDisabled())
  const histReq = page.waitForRequest((r) => r.url().includes('/v1/attendance/history') && r.url().includes(`year=${py}`) && r.url().includes('month=9'), { timeout: 60000 }).catch(() => null)
  const back = (cy - py) * 12 + Number(get('month')) - 9
  for (let i = 0; i < back; i++) await page.getByRole('button', { name: 'Previous month' }).click()
  check('history: going back to September last year asks for it', !!(await histReq))
  check('history: the view shows September last year', (await monthTitle()) === `September ${py}`, await monthTitle())
  check('history: next month is pickable again in the past', !(await monthNext.isDisabled()))

  // A time entry on a previous-year day, through the Timesheet's week of that day.
  const pastMonday = mondayOf(past), pastSunday = addDays(pastMonday, 6)
  await page.goto(base + '/hrms/attendance?tab=timesheet')
  await page.getByRole('button', { name: 'Previous week' }).waitFor({ timeout: 30000 })
  const weekReq = page.waitForRequest((r) => r.url().includes(`/v1/ess/timesheets?from=${pastMonday}&to=${pastSunday}`), { timeout: 60000 }).catch(() => null)
  await goBackWeeks()
  check('time entries: going back to a previous-year week loads that week', !!(await weekReq))
  await page.waitForLoadState('networkidle')
  await shot('timesheet-1440')
  entryTitle = `W3 r2 calendar check ${Date.now()}`
  await page.getByRole('button', { name: 'Add time', exact: true }).first().click()
  const panel = page.getByRole('dialog', { name: 'Add time' })
  await panel.waitFor({ timeout: 10000 })
  await panel.getByLabel('Day').selectOption(past)
  check('time entries: the panel offers the previous-year day', (await panel.getByLabel('Day').inputValue()) === past, await panel.getByLabel('Day').inputValue())
  await panel.getByLabel('Hours').fill('0')
  await panel.getByLabel('Minutes').fill('30')
  await panel.getByLabel(/What did you work on|Notes/).fill(entryTitle)
  const post = page.waitForResponse((r) => r.url().includes('/v1/ess/timesheets') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
  await panel.getByRole('button', { name: 'Add time', exact: true }).click()
  const pr = await post
  const body = pr && pr.ok() ? await pr.request().postDataJSON() : null
  check('time entries: the entry is saved on the picked day', !!body && body.workDate === past, pr ? `${pr.status()} ${JSON.stringify(body)}` : 'no request')
  entryLeft = !!(pr && pr.ok())
  const row = page.getByRole('list', { name: 'Entries this week' }).locator('li', { hasText: entryTitle })
  check('time entries: the entry is listed', await row.waitFor({ timeout: 15000 }).then(() => true).catch(() => false))
  if (entryLeft) {
    entryLeft = !(await deleteEntry(entryTitle))
    check('time entries: the test entry is deleted', !entryLeft && await row.waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false))
  }
  check('my attendance and timesheet: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // Phone: My Attendance and the Timesheet fit, and the Add time panel stays inside the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/hrms/attendance?tab=my')
  await page.getByRole('button', { name: 'Next month' }).waitFor({ timeout: 30000 })
  const bw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no horizontal page scroll on My Attendance', bw <= 390, String(bw))
  await page.goto(base + '/hrms/attendance?tab=timesheet')
  await page.getByRole('button', { name: 'Add time', exact: true }).first().waitFor({ timeout: 30000 })
  const tw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no horizontal page scroll on the Timesheet', tw <= 390, String(tw))
  await page.getByRole('button', { name: 'Add time', exact: true }).first().click()
  const sheet = page.getByRole('dialog', { name: 'Add time' })
  await sheet.waitFor({ timeout: 5000 })
  await page.waitForTimeout(350)
  const sb = await sheet.boundingBox()
  check('390px: the Add time panel stays inside the viewport', !!sb && sb.x >= -0.5 && sb.x + sb.width <= 390.5, JSON.stringify(sb))
  await shot('timesheet-panel-390')
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
    // The card has Edit and Remove buttons (HolidayCalendar); pick Remove by its name.
    await hrow.getByRole('button', { name: `Remove ${holidayName}`, exact: true }).click()
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
  // P-GROW: kit fields label the combobox (the label no longer wraps it).
  const startF = drawer.getByRole('combobox', { name: 'Notice start date' })
  const lastF = drawer.getByRole('combobox', { name: 'Last working day' })
  check('exit: notice start prefilled to today', (await text(startF)).includes(short(today)), await text(startF))
  const lastNative = lastF.locator('xpath=..').locator('input.utc-native')
  check('exit: empty last working day is required (native valueMissing)', await lastNative.evaluate((el) => el.required && el.validity.valueMissing))
  await drawer.locator('#notice-employee-search').fill('Reader')
  await drawer.getByRole('option', { name: /Reader User/ }).first().click()
  // By its text: while blocked, the kit's tooltip (data-tip, CSS content) is part of the button's accessible name.
  const saveBtn = drawer.locator('button', { hasText: /^Start notice$/ })
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
    const sep = page.getByRole('dialog', { name: /^Edit dates/ })
    await sep.waitFor({ timeout: 10000 })
    const s1 = await text(sep.getByRole('combobox', { name: 'Notice start date' }))
    const s2 = await text(sep.getByRole('combobox', { name: 'Last working day' }))
    check('exit: Edit dates shows the saved notice dates', /\d{1,2} \w{3} \d{4}/.test(s1) && /\d{1,2} \w{3} \d{4}/.test(s2), `${s1} / ${s2}`)
    await sep.getByRole('button', { name: 'Close', exact: true }).click()
  } else check('exit: someone on notice to open Edit dates', false, 'no Edit dates button')
  check('owner pages: no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // Phone: the WFH day chips fit the screen (P-HOME: chips instead of the From/To calendar).
  await login('mgr@unifiedtree.demo', { width: 390, height: 844 })
  await page.goto(base + '/me/wfh')
  const pc = page.getByRole('group', { name: 'Pick days' }).getByRole('button').first()
  await pc.waitFor({ timeout: 20000 })
  const pw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: no horizontal page scroll on /me/wfh', pw <= 390, String(pw))
  const cb = await pc.boundingBox()
  check('390px: the day chips stay inside the viewport', !!cb && cb.x >= 0 && cb.x + cb.width <= 390.5, JSON.stringify(cb))
  await shot('wfh-chips-390')
  check('no failed API calls', failed.length === 0, failed.slice(0, 5).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
  await shot('fail')
} finally {
  // Best effort: never leave the test's own records behind.
  try {
    if (entryLeft && entryTitle) {
      await login('reader@unifiedtree.demo')
      await page.goto(base + '/hrms/attendance?tab=timesheet')
      await page.getByRole('button', { name: 'Previous week' }).waitFor({ timeout: 30000 })
      await goBackWeeks()
      await page.waitForLoadState('networkidle')
      if (await deleteEntry(entryTitle)) console.log('cleanup: removed the leftover time entry')
    }
    if (holidayLeft && holidayName) {
      await login('owner@unifiedtree.demo')
      await page.goto(base + '/hrms/leave?tab=holidays')
      await page.locator('select').filter({ has: page.locator(`option[value="${cy + 1}"]`) }).first().selectOption(String(cy + 1))
      page.once('dialog', (d) => d.accept())
      await page.locator('.ut-card-sm', { hasText: holidayName }).getByRole('button', { name: `Remove ${holidayName}`, exact: true }).click()
      await page.waitForTimeout(1500)
      console.log('cleanup: removed the leftover holiday')
    }
  } catch (e) { console.log('cleanup failed: ' + String(e.message || e).slice(0, 200)) }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
