// Live check of the calendar rollout (wave 3, r1): every converted date field on
// the employee, onboarding, master-data and hiring screens opens the shared
// calendar, a pick lands in the field (previous years through the year list where
// that makes sense), min / max and "required" still hold, and the forms still
// save. The only records it writes are a dependent (added, then deleted) and the
// hire details' "offer accepted on" date (set, then cleared again); every other
// form is cancelled.
//
//   node e2e/recovery/live-w3-r1.mjs
/* global process, console, document */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3021'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Demo records (see RULES.md): a probation employee, one on notice, an in-progress onboarding.
const EMP_PROBATION = 'd80b2982-ca7e-4c43-9851-638925b10c86'
const EMP_NOTICE = '14cc2a9f-dc14-4593-a5cc-3f97a07877c3'
const INSTANCE = 'ca94579a-b02b-4f72-bbd5-9423f9cfa53c'
const FAKE_CANDIDATE = 'f0f0f0f0-0000-4000-8000-0000000000a1'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const today = `${get('year')}-${get('month')}-${get('day')}`
const Y = Number(get('year')), PY = Y - 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const yesterday = addDays(today, -1), tomorrow = addDays(today, 1)
/** "15 Jun 1995" — both field formats (long and short) contain it. */
const short = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
// The dev server compiles each page on its first visit.
page.setDefaultTimeout(45_000)
page.setDefaultNavigationTimeout(90_000)
const pageErrors = [], failed = []
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })

const dateDialog = () => page.getByRole('dialog', { name: 'Choose date' })
const textOf = async (loc) => ((await loc.textContent()) || '').replace(/\s+/g, ' ').trim()
async function shows(loc, sub, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if ((await textOf(loc)).includes(sub)) return true; await page.waitForTimeout(100) }
  return false
}
/** Open the field, go year → month → day, and wait for the calendar to close. */
async function pickViaYear(trigger, day) {
  const [y, m, d] = day.split('-').map(Number)
  await trigger.click()
  const dlg = dateDialog()
  await dlg.waitFor({ timeout: 5000 })
  await dlg.getByRole('button', { name: 'Choose year' }).click()
  await dlg.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await dlg.getByRole('gridcell', { name: new RegExp(`, ${d} ${MONTHS[m - 1]} ${y}`) }).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}
async function pickPreset(trigger, label) {
  await trigger.click()
  const dlg = dateDialog()
  await dlg.waitFor({ timeout: 5000 })
  await dlg.getByRole('button', { name: label, exact: true }).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}
/** The field's own × button (the trigger's parent is the field box). */
const clearOf = (trigger) => trigger.locator('xpath=..').getByRole('button', { name: 'Clear' })
async function section(name, fn) {
  try { await fn() } catch (e) {
    check(`${name}: finished`, false, String(e.message || e).split('\n')[0].slice(0, 240))
    await page.keyboard.press('Escape').catch(() => {})
  }
}

try {
  // A fresh dev server compiles on the first visit: give it time.
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.locator('input[type=email]').waitFor({ timeout: 180_000 })
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  // ── 1. Master: Add employee (date of joining) and Start exit (last working day) ──
  await section('master employees', async () => {
    await page.goto(base + '/hrms/employees')
    await page.getByRole('button', { name: 'Add employee' }).click()
    const drawer = page.getByRole('dialog', { name: 'Add employee' })
    await drawer.waitFor({ timeout: 15000 })
    const doj = drawer.getByRole('combobox', { name: 'Date of joining' })
    check('master Add employee: date of joining starts on today', await shows(doj, short(today)), await textOf(doj))
    await pickViaYear(doj, `${PY}-03-10`)
    check('master Add employee: a previous-year date lands', await shows(doj, short(`${PY}-03-10`)), await textOf(doj))
    await doj.click()
    await dateDialog().waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
    check('Escape closes only the calendar, not the drawer', !(await dateDialog().isVisible()) && (await drawer.isVisible()))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
    await drawer.waitFor({ state: 'hidden', timeout: 5000 })

    await page.getByPlaceholder('Search name, code, email or role…').fill('Reader')
    const row = page.locator('tr', { hasText: 'Reader User' }).first()
    await row.getByRole('button', { name: 'More actions' }).click()
    await page.locator('#utm-portal .pop .opt', { hasText: 'Start exit' }).click()
    const modal = page.locator('.modal[role=dialog]')
    await modal.waitFor({ timeout: 5000 })
    const lwd = modal.getByRole('combobox', { name: 'Last working day' })
    check('master Start exit: last working day is prefilled', /\d{1,2} \w{3} \d{4}/.test(await textOf(lwd)), await textOf(lwd))
    await pickPreset(lwd, 'Tomorrow')
    check('master Start exit: picked day lands, dialog stays open', (await shows(lwd, short(tomorrow))) && (await modal.isVisible()), await textOf(lwd))
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await modal.waitFor({ state: 'hidden', timeout: 5000 })
  })

  // ── 2. Master: company "Incorporated on" (max today, optional → clearable) ──
  await section('master company', async () => {
    await page.goto(base + '/hrms/master/companies')
    await page.getByRole('button', { name: 'Add company' }).click()
    const drawer = page.getByRole('dialog', { name: 'Add company' })
    await drawer.waitFor({ timeout: 15000 })
    const inc = drawer.getByRole('combobox', { name: 'Incorporated on' })
    await inc.click()
    await dateDialog().waitFor({ timeout: 5000 })
    check('max today: no Tomorrow preset on "Incorporated on"', (await dateDialog().getByRole('button', { name: 'Tomorrow', exact: true }).count()) === 0)
    await dateDialog().getByRole('button', { name: 'Choose year' }).click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/r1-company-years-1440.png` })
    check('max today: next year is not offered', (await dateDialog().locator(`[role=gridcell][aria-label="${Y + 1}"]`).count()) === 0)
    await page.keyboard.press('Escape')
    await pickViaYear(inc, '2019-04-12')
    check('master company: 12 Apr 2019 lands via the year list', await shows(inc, '12 Apr 2019'), await textOf(inc))
    await clearOf(inc).click()
    check('master company: optional date can be cleared', await shows(inc, 'Select date'), await textOf(inc))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 3. Master: staffing agency licence ──
  await section('master agency', async () => {
    await page.goto(base + '/hrms/master/contractors')
    await page.getByRole('button', { name: 'Add agency' }).click()
    const drawer = page.getByRole('dialog', { name: 'Add staffing agency' })
    await drawer.waitFor({ timeout: 15000 })
    const lic = drawer.getByRole('combobox', { name: 'Licence valid till' })
    await pickViaYear(lic, `${Y + 1}-01-31`)
    check('master agency: licence date lands', await shows(lic, short(`${Y + 1}-01-31`)), await textOf(lic))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 4. Policies: effective date (required) ──
  await section('policies', async () => {
    await page.goto(base + '/hrms/policies')
    await page.getByRole('button', { name: 'Publish a policy' }).click()
    const drawer = page.getByRole('dialog', { name: 'Publish a policy' })
    await drawer.waitFor({ timeout: 15000 })
    const eff = drawer.getByRole('combobox', { name: 'Effective date' })
    check('policy: effective date starts on today', await shows(eff, short(today)), await textOf(eff))
    check('policy: a required date has no Clear', (await clearOf(eff).count()) === 0)
    await pickPreset(eff, 'Yesterday')
    check('policy: picked day lands', await shows(eff, short(yesterday)), await textOf(eff))
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 5. Employee workspace: edit drawer, full form, lifecycle dialog, shift drawer ──
  await section('workspace', async () => {
    await page.goto(base + `/hrms/employees/${EMP_PROBATION}`)
    await page.getByRole('button', { name: 'Edit employee' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit employee' })
    await edit.waitFor({ timeout: 15000 })
    const doj = edit.locator('.utc-trigger')
    check('workspace edit: date of joining shows the saved date', await shows(doj, '22 Sep 2026'), await textOf(doj))
    await pickPreset(doj, 'Yesterday')
    check('workspace edit: picked day lands', await shows(doj, short(yesterday)), await textOf(doj))
    await edit.getByRole('button', { name: 'All fields…' }).click()
    const full = page.locator('.ut-card', { has: page.getByRole('heading', { name: 'Edit Employee' }) })
    await full.waitFor({ timeout: 15000 })
    const fdoj = page.getByRole('combobox', { name: 'Date of joining' })
    const fdob = page.getByRole('combobox', { name: 'Date of birth' })
    check('full form: date of joining prefilled', await shows(fdoj, '22 Sep 2026'), await textOf(fdoj))
    check('full form: date of birth prefilled', await shows(fdob, '15 Jan 1995'), await textOf(fdob))
    await fdoj.click()
    await dateDialog().waitFor({ timeout: 5000 })
    check('full form: joining date keeps max today (no Tomorrow)', (await dateDialog().getByRole('button', { name: 'Tomorrow', exact: true }).count()) === 0)
    await page.keyboard.press('Escape')
    await pickViaYear(fdob, '1990-07-04')
    check('full form: date of birth via the year list', await shows(fdob, '4 Jul 1990'), await textOf(fdob))
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await page.getByRole('heading', { name: 'Edit Employee' }).waitFor({ state: 'hidden', timeout: 5000 })

    await page.getByRole('button', { name: /^Actions/ }).click()
    await page.getByRole('menuitem', { name: 'Confirm probation' }).click()
    const modal = page.getByRole('dialog', { name: 'Confirm Probation' })
    await modal.waitFor({ timeout: 5000 })
    const conf = modal.locator('.utc-trigger')
    check('lifecycle dialog: confirmation date starts on today', await shows(conf, short(today)), await textOf(conf))
    await pickPreset(conf, 'Yesterday')
    check('lifecycle dialog: pick lands and the dialog stays open', (await shows(conf, short(yesterday))) && (await modal.isVisible()), await textOf(conf))
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await modal.waitFor({ state: 'hidden', timeout: 5000 })

    await page.getByRole('button', { name: 'Change shift', exact: true }).click()
    const shift = page.getByRole('dialog', { name: 'Change employee shift' })
    await shift.waitFor({ timeout: 5000 })
    const eff = shift.locator('.utc-trigger')
    await pickPreset(eff, 'Tomorrow')
    check('shift drawer: effective-from pick lands', await shows(eff, short(tomorrow)), await textOf(eff))
    check('shift drawer: the button follows the date', (await shift.getByRole('button', { name: 'Schedule shift change' }).count()) === 1)
    await eff.click()
    await dateDialog().waitFor({ timeout: 5000 })
    check('shift drawer: min keeps past days out', await dateDialog().getByRole('gridcell', { name: new RegExp(`${MONTHS[Number(yesterday.slice(5, 7)) - 1]} ${yesterday.slice(0, 4)}, not available`) }).first().isVisible().catch(() => false))
    await page.keyboard.press('Escape')
    await shift.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 6. Personal: identity (react-hook-form values), experience (required), dependents (save + delete) ──
  await section('personal', async () => {
    await page.route((u) => u.pathname.endsWith(`/v1/employees/${EMP_PROBATION}/profile/identity`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch()
      const body = res.ok() ? await res.json().catch(() => ({})) : {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, passportExpiry: '2031-03-15' }) })
    })
    await page.goto(base + `/hrms/employees/${EMP_PROBATION}?tab=personal`)
    const pass = page.getByLabel('Passport Expiry')
    await pass.waitFor({ timeout: 15000 })
    check('identity: loaded passport expiry shows in the field', await shows(pass, '15 Mar 2031'), await textOf(pass))
    const saveId = page.getByRole('button', { name: 'Save Identity' })
    check('identity: Save starts disabled', await saveId.isDisabled())
    await pickViaYear(pass, '2033-08-20')
    check('identity: new expiry lands', await shows(pass, '20 Aug 2033'), await textOf(pass))
    check('identity: form becomes dirty (Save enabled)', await saveId.isEnabled())
    await page.unroute((u) => u.pathname.endsWith(`/v1/employees/${EMP_PROBATION}/profile/identity`))

    await page.getByRole('button', { name: 'Add Experience' }).click()
    const exp = page.getByRole('dialog', { name: 'Add Experience' })
    await exp.waitFor({ timeout: 5000 })
    await exp.getByLabel('Company Name').fill('W3 R1 calendar check')
    const expSave = exp.getByRole('button', { name: 'Save' })
    await page.waitForTimeout(300)
    check('experience: empty required start date keeps Save disabled', await expSave.isDisabled())
    await pickViaYear(exp.getByLabel('Start Date'), `${PY}-01-10`)
    check('experience: start date lands', await shows(exp.getByLabel('Start Date'), short(`${PY}-01-10`)), await textOf(exp.getByLabel('Start Date')))
    check('experience: Save enabled once the date is set', await expSave.isEnabled())
    await exp.getByRole('button', { name: 'Close panel' }).click()
    await exp.waitFor({ state: 'hidden', timeout: 5000 })

    const name = `W3 R1 Dependent ${Date.now()}`
    await page.getByRole('button', { name: 'Add Dependent' }).click()
    const dep = page.getByRole('dialog', { name: 'Add Dependent' })
    await dep.waitFor({ timeout: 5000 })
    await dep.getByLabel(/^Name/).fill(name)
    await dep.getByLabel('Relationship').fill('Parent')
    const dob = dep.getByLabel('Date of Birth')
    await pickViaYear(dob, '1938-05-15')
    check('dependent: 1938 date of birth via the year list', await shows(dob, '15 May 1938'), await textOf(dob))
    await page.screenshot({ path: `${SHOTS}/r1-dependent-1440.png` })
    const saved = page.waitForResponse((r) => r.url().includes(`/v1/employees/${EMP_PROBATION}/profile/dependents`) && r.request().method() === 'POST', { timeout: 15000 })
    await dep.getByRole('button', { name: 'Save' }).click()
    const res = await saved
    const sent = JSON.parse(res.request().postData() || '{}')
    check('dependent: saved with the picked date', res.ok() && sent.dateOfBirth === '1938-05-15', `${res.status()} dateOfBirth=${sent.dateOfBirth}`)
    const rowText = page.locator('div', { hasText: name }).filter({ hasText: 'DOB: 1938-05-15' }).last()
    check('dependent: list shows the date of birth', await rowText.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))
    const del = page.waitForResponse((r) => r.url().includes('/profile/dependents/') && r.request().method() === 'DELETE', { timeout: 15000 })
    await page.locator('div.flex.items-start.justify-between', { hasText: name }).getByRole('button').click()
    const dres = await del
    check('dependent: test record deleted', dres.ok(), String(dres.status()))
    check('dependent: gone from the list', await page.getByText(name).waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false))
  })

  // ── 7. Payroll: salary structure "Effective from" ──
  await section('payroll', async () => {
    await page.goto(base + `/hrms/employees/${EMP_PROBATION}?tab=payroll`)
    await page.getByRole('button', { name: /^(Revise|Add) structure$/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Salary structure' })
    await drawer.waitFor({ timeout: 10000 })
    const eff = drawer.getByLabel('Effective from')
    check('salary structure: effective from is prefilled', /\d{1,2} \w{3} \d{4}/.test(await textOf(eff)), await textOf(eff))
    await pickViaYear(eff, `${Y + 1}-04-01`)
    check('salary structure: pick lands', await shows(eff, short(`${Y + 1}-04-01`)), await textOf(eff))
    await drawer.getByRole('button', { name: 'Close panel' }).click()
  })

  // ── 8. Exit: separation editor (required last working day gates Save) ──
  await section('separation', async () => {
    await page.goto(base + `/hrms/employees/${EMP_NOTICE}?tab=exit`)
    await page.getByRole('button', { name: 'Edit separation details' }).click()
    const drawer = page.getByRole('dialog', { name: 'Edit separation details' })
    await drawer.waitFor({ timeout: 10000 })
    const start = drawer.getByRole('combobox', { name: 'Notice start date' })
    const lwd = drawer.getByRole('combobox', { name: 'Last working day' })
    const save = drawer.getByRole('button', { name: 'Save separation details' })
    if ((await textOf(lwd)).includes('Select date')) check('separation: empty required last working day keeps Save disabled', await save.isDisabled())
    await pickViaYear(lwd, `${Y + 1}-02-14`)
    check('separation: last working day lands', await shows(lwd, short(`${Y + 1}-02-14`)), await textOf(lwd))
    await pickPreset(lwd, 'Tomorrow')
    // Keyboard: T = today, then three days right — the cursor stops at max (the last working day).
    await start.focus()
    await page.keyboard.press('ArrowDown')
    await dateDialog().waitFor({ timeout: 5000 })
    for (const k of ['t', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter']) await page.keyboard.press(k)
    check('separation: notice start stops at max = last working day', await shows(start, short(tomorrow)), await textOf(start))
    check('separation: Save enabled with the dates set', await save.isEnabled())
    await drawer.getByRole('button', { name: 'Cancel' }).click()
  })

  // ── 9. Onboarding wizard: required date of birth, then a pick through the year list ──
  await section('onboarding', async () => {
    await page.goto(base + '/hrms/onboarding/instances/new')
    const dob = page.getByRole('combobox', { name: 'Date of birth' })
    await dob.waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    check('onboarding: empty required date of birth blocks Next', await page.getByText('Date of birth is required').isVisible().catch(() => false))
    check('onboarding: the field is marked invalid', (await page.locator('.utc-field', { has: dob }).getAttribute('data-invalid')) !== null)
    await dob.click()
    await dateDialog().waitFor({ timeout: 5000 })
    check('onboarding: date of birth keeps max today (no Tomorrow)', (await dateDialog().getByRole('button', { name: 'Tomorrow', exact: true }).count()) === 0)
    await page.keyboard.press('Escape')
    await pickViaYear(dob, '1995-06-15')
    check('onboarding: 15 Jun 1995 lands', await shows(dob, '15 Jun 1995'), await textOf(dob))
    check('onboarding: the error clears', !(await page.getByText('Date of birth is required').isVisible().catch(() => false)))
  })

  // ── 10. Hire details: offer accepted on — save, check, clear again ──
  await section('hire details', async () => {
    const loaded = page.waitForResponse((r) => r.url().includes(`/v1/onboarding/instances/${INSTANCE}/hire-details`) && r.request().method() === 'GET', { timeout: 60000 })
    await page.goto(base + `/hrms/onboarding/instances/${INSTANCE}`)
    const original = await (await loaded).json().catch(() => ({}))
    const head = page.locator('h3', { hasText: /^Hire details$/ })
    await head.waitFor({ timeout: 15000 })
    const panel = head.locator('xpath=../..')
    const accepted = () => page.locator('dt', { hasText: /^Offer accepted$/ }).locator('xpath=following-sibling::dd[1]')
    const before = await textOf(accepted())
    await panel.getByRole('button', { name: 'Edit', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Hire details' })
    await drawer.waitFor({ timeout: 5000 })
    const field = drawer.getByLabel('Offer accepted on')
    await pickPreset(field, 'Yesterday')
    check('hire details: pick lands', await shows(field, short(yesterday)), await textOf(field))
    if (original.offerAcceptedOn) {
      // Already has a date (a long-lived database): check the pick only, and change nothing.
      await drawer.getByRole('button', { name: 'Cancel' }).click()
      return
    }
    let put = page.waitForResponse((r) => r.url().includes(`/hire-details`) && ['PUT', 'PATCH', 'POST'].includes(r.request().method()), { timeout: 15000 })
    await drawer.getByRole('button', { name: 'Save' }).click()
    let res = await put
    check('hire details: saved with the picked date', res.ok() && JSON.parse(res.request().postData() || '{}').offerAcceptedOn === yesterday, String(res.status()))
    check('hire details: panel shows the date', await shows(accepted(), short(yesterday), 10000), await textOf(accepted()))
    // Put it back: this demo onboarding had no date.
    await panel.getByRole('button', { name: 'Edit', exact: true }).click()
    await drawer.waitFor({ timeout: 5000 })
    await clearOf(field).click()
    check('hire details: optional date clears', await shows(field, 'Select date'), await textOf(field))
    put = page.waitForResponse((r) => r.url().includes(`/hire-details`) && ['PUT', 'PATCH', 'POST'].includes(r.request().method()), { timeout: 15000 })
    await drawer.getByRole('button', { name: 'Save' }).click()
    res = await put
    check('hire details: cleared date saved as empty', res.ok() && JSON.parse(res.request().postData() || '{}').offerAcceptedOn === null, String(res.status()))
    check('hire details: panel is back to how it was', await shows(accepted(), before, 10000), `${await textOf(accepted())} (was ${before})`)
  })

  // ── 11. Offers: joining date ──
  await section('offers', async () => {
    await page.goto(base + '/hrms/hiring?tab=offers')
    await page.getByRole('button', { name: 'Create offer' }).click()
    const jd = page.getByRole('combobox', { name: 'Joining date' })
    await jd.waitFor({ timeout: 10000 })
    await pickViaYear(jd, `${Y + 1}-01-05`)
    check('offer: joining date lands', await shows(jd, short(`${Y + 1}-01-05`)), await textOf(jd))
    await clearOf(jd).click()
    check('offer: joining date clears', await shows(jd, 'Select date'), await textOf(jd))
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
  })

  // ── 12. Interviews: schedule drawer date (a stand-in Screening candidate; nothing is booked) ──
  await section('interviews', async () => {
    await page.route((u) => u.pathname.endsWith('/v1/hiring/candidates'), async (route) => {
      const res = await route.fetch()
      const list = res.ok() ? await res.json().catch(() => []) : []
      const fake = {
        id: FAKE_CANDIDATE, requisitionId: list[0]?.requisitionId || FAKE_CANDIDATE, requisitionTitle: 'Calendar check', fullName: 'W3 R1 Stand-in', email: 'standin@example.invalid',
        stage: 'SCREENING', createdAt: new Date().toISOString(), convertedEmployeeId: null, upcomingInterviews: 0, nextInterviewAt: null,
        scorecards: { count: 0, averageRating: null, recommendations: { STRONG_YES: 0, YES: 0, NO: 0, STRONG_NO: 0 } },
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...(Array.isArray(list) ? list : []), fake]) })
    })
    await page.route((u) => u.pathname.endsWith(`/v1/hiring/candidates/${FAKE_CANDIDATE}/interviews`), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto(base + '/hrms/hiring?tab=pipeline&role=all')
    await page.getByRole('button', { name: 'Open W3 R1 Stand-in: interviews and scorecards' }).click()
    await page.getByRole('button', { name: 'Schedule interview' }).click()
    const drawer = page.getByRole('dialog', { name: 'Schedule an interview' })
    await drawer.waitFor({ timeout: 5000 })
    const d = drawer.getByLabel('Date', { exact: true })
    check('interview: date starts tomorrow', await shows(d, short(tomorrow)), await textOf(d))
    await d.click()
    await dateDialog().waitFor({ timeout: 5000 })
    check('interview: min today keeps Yesterday out', (await dateDialog().getByRole('button', { name: 'Yesterday', exact: true }).count()) === 0)
    await page.keyboard.press('Escape')
    await pickViaYear(d, `${Y + 1}-03-03`)
    check('interview: pick lands', await shows(d, short(`${Y + 1}-03-03`)), await textOf(d))
    check('interview: time input is untouched (native)', (await drawer.locator('input#iv-time[type=time]').count()) === 1)
    await drawer.getByRole('button', { name: 'Cancel' }).click()
    await page.unroute((u) => u.pathname.endsWith('/v1/hiring/candidates'))
  })

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 5).join(' | '))

  // ── 13. Phone width: the sheet stays inside the screen on a converted form ──
  await section('phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base + '/hrms/onboarding/instances/new')
    const dob = page.getByRole('combobox', { name: 'Date of birth' })
    await dob.waitFor({ timeout: 15000 })
    await dob.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/r1-onboarding-390.png` })
    await dob.click()
    await dateDialog().waitFor({ timeout: 5000 })
    await page.waitForTimeout(400)
    const b = await dateDialog().boundingBox()
    check('390px: the calendar sheet stays inside the viewport', !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 390.5 && b.y + b.height <= 844.5, JSON.stringify(b))
    await page.screenshot({ path: `${SHOTS}/r1-onboarding-sheet-390.png` })
    await page.keyboard.press('Escape')
    await page.goto(base + '/hrms/master/companies')
    await page.getByRole('button', { name: 'Add company' }).click()
    const inc = page.getByRole('dialog', { name: 'Add company' }).getByRole('combobox', { name: 'Incorporated on' })
    await inc.waitFor({ timeout: 15000 })
    await pickViaYear(inc, '2019-04-12')
    check('390px: company date lands', await shows(inc, '12 Apr 2019'), await textOf(inc))
    await inc.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/r1-company-390.png` })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('390px: no sideways page scroll', overflow <= 1, String(overflow))
  })
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
