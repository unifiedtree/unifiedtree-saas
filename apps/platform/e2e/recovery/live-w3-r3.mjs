// Live check of the shared calendar on Documents, Compliance, Learning,
// the inspector's month picker and the profile's My documents (wave 3, r3):
//  - Documents: HR adds a document with an issue date picked through the year
//    view and an expiry 20 years out; the server stores both; Edit shows them and
//    changes the expiry; then the document is deleted (API).
//  - Compliance: a required due date, cleared, still blocks the form (no POST);
//    the filing and POSH drawers take a picked date. Nothing is saved.
//  - Learning: new program (Ends can't go before Starts), program edit, and a
//    certification date (no future days). Nothing is saved.
//  - Inspector view (API mocked): a previous-year month asks for that month.
//  - My documents (employee): the Passport card's Issued / Expires take a date.
// Screenshots at 1440 and 390 go to _results/shots/r3-*.png.
//
//   node e2e/recovery/live-w3-r3.mjs
/* global process, console, sessionStorage, fetch */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', readerId = '22222222-2222-2222-2222-222222222222'
const shots = process.env.R3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Today in IST, like the app.
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const today = `${get('year')}-${get('month')}-${get('day')}`
const ty = Number(get('year')), py = ty - 1
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ymd = (iso) => iso.split('-').map(Number)
const fullLabel = (iso) => { const [y, m, d] = ymd(iso); return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS[m - 1]} ${y}` }
const shortText = (iso) => { const [y, m, d] = ymd(iso); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` }
const addDays = (iso, n) => { const [y, m, d] = ymd(iso); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

const browser = await chromium.launch()
async function session(email, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
/** An API call made from the page, with the signed-in user's token. */
const api = (page, method, path, body) => page.evaluate(async ({ method, path, body, tenant }) => {
  const token = sessionStorage.getItem('__ut_access_token__')
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const raw = await r.text()
  let json
  try { json = raw ? JSON.parse(raw) : null } catch { json = raw }
  return { status: r.status, json }
}, { method, path, body, tenant })
const dateDialog = (page) => page.getByRole('dialog', { name: 'Choose date' })
const monthDialog = (page) => page.getByRole('dialog', { name: 'Choose month' })
/** Open a DateField and pick a day through its year → month → day views. */
async function pickDay(page, trigger, iso) {
  const [y, m] = ymd(iso)
  await trigger.click()
  const dlg = dateDialog(page)
  await dlg.waitFor({ timeout: 5000 })
  await dlg.getByRole('button', { name: 'Choose year' }).click()
  await dlg.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label^="${fullLabel(iso)}"]`).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}
const text = async (loc) => ((await loc.textContent()) || '').trim()
const stamp = Date.now()
const docTitle = `QA calendar ${stamp}`
let docId = null
let owner = null

try {
  owner = await session('owner@unifiedtree.demo')
  const o = owner.page

  // ── 1. Documents: add with picked dates, the server stores them, edit, delete ──
  await o.goto(base + '/hrms/documents?view=all'); await settle(o)
  await o.getByRole('button', { name: /Add document/ }).click()
  const drawer = o.getByRole('dialog', { name: 'Add a document' })
  await drawer.waitFor({ timeout: 10000 })
  await drawer.getByLabel('Find employee').fill('Reader')
  await drawer.getByRole('button', { name: /Reader User/ }).click()
  await drawer.getByLabel('Title', { exact: true }).fill(docTitle)
  await drawer.getByLabel('Or a link to an existing document').fill('https://example.com/qa-calendar.pdf')
  const issued = `${ty - 6}-03-14`, expires = `${ty + 20}-03-13`, expires2 = `${ty + 5}-12-31`
  await pickDay(o, o.locator('#doc-issued'), issued)
  check('documents: Issued takes a date six years back via the year view', (await text(o.locator('#doc-issued'))).includes(shortText(issued)), await text(o.locator('#doc-issued')))
  await o.locator('#doc-exp').click()
  await dateDialog(o).getByRole('button', { name: 'Choose year' }).click()
  const years = dateDialog(o).locator('[role=grid][aria-label=Years]')
  check('documents: Expires starts at the issue year (min) and reaches 20+ years ahead',
    (await years.locator(`[aria-label="${ty - 7}"]`).count()) === 0 && (await years.locator(`[aria-label="${ty + 40}"]`).count()) === 1)
  await o.keyboard.press('Escape')
  check('documents: Escape closes only the calendar, not the drawer', !(await dateDialog(o).isVisible()) && (await drawer.isVisible()))
  await pickDay(o, o.locator('#doc-exp'), expires)
  check('documents: Expires takes a date 20 years out', (await text(o.locator('#doc-exp'))).includes(shortText(expires)), await text(o.locator('#doc-exp')))
  // Before the issue date is off limits in the Expires calendar.
  await o.locator('#doc-exp').click()
  await dateDialog(o).getByRole('button', { name: 'Choose year' }).click()
  await dateDialog(o).locator(`[role=gridcell][aria-label="${ty - 6}"]`).click()
  await dateDialog(o).locator(`[role=gridcell][aria-label="March ${ty - 6}"]`).click()
  check('documents: days before the issue date are disabled in Expires',
    (await dateDialog(o).locator(`[role=gridcell][aria-label^="${fullLabel(addDays(issued, -1))}"]`).getAttribute('aria-disabled')) === 'true')
  await o.screenshot({ path: `${shots}/r3-documents-add-1440.png` })
  await o.keyboard.press('Escape')
  const created = o.waitForResponse((r) => r.url().includes('/v1/document/documents') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
  await drawer.getByRole('button', { name: 'Store document' }).click()
  const cr = await created
  if (cr?.ok()) docId = (await cr.json().catch(() => ({})))?.id || null
  await drawer.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const list1 = await api(o, 'GET', `/v1/document/employee/${readerId}?page=0&size=100`)
  const doc1 = (list1.json?.content || []).find((d) => d.title === docTitle)
  if (doc1) docId = doc1.id
  check('documents: the server stored the picked dates as yyyy-MM-dd', !!doc1 && doc1.issuedDate === issued && doc1.expiryDate === expires, doc1 ? `${doc1.issuedDate} / ${doc1.expiryDate}` : `status ${list1.status}`)

  // Edit: the drawer shows the stored dates; change the expiry.
  await o.getByLabel('Find employee').fill('Reader')
  await o.getByRole('button', { name: /Reader User/ }).click(); await settle(o)
  await o.getByRole('button', { name: `Edit ${docTitle}` }).click()
  const edit = o.getByRole('dialog', { name: new RegExp(`Edit .${docTitle}`) })
  await edit.waitFor({ timeout: 10000 })
  check('documents edit: shows the stored dates', (await text(o.locator('#edit-doc-issued'))).includes(shortText(issued)) && (await text(o.locator('#edit-doc-exp'))).includes(shortText(expires)))
  await pickDay(o, o.locator('#edit-doc-exp'), expires2)
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await edit.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const doc2 = (await api(o, 'GET', `/v1/document/documents/${docId}`)).json
  check('documents edit: the new expiry is saved', doc2?.expiryDate === expires2 && doc2?.issuedDate === issued, `${doc2?.issuedDate} / ${doc2?.expiryDate}`)

  // Phone: the Add drawer's calendar is a bottom sheet inside the screen.
  await o.setViewportSize({ width: 390, height: 844 })
  await o.getByRole('button', { name: /Add document/ }).click()
  await o.getByRole('dialog', { name: 'Add a document' }).waitFor({ timeout: 10000 })
  await o.locator('#doc-issued').scrollIntoViewIfNeeded()
  await o.locator('#doc-issued').click()
  await dateDialog(o).waitFor({ timeout: 5000 }); await o.waitForTimeout(350)
  const sb = await dateDialog(o).boundingBox()
  check('390px: the calendar sheet stays inside the screen', !!sb && sb.x >= 0 && sb.x + sb.width <= 390.5 && sb.y + sb.height <= 844.5, JSON.stringify(sb))
  await o.screenshot({ path: `${shots}/r3-documents-add-390.png` })
  await o.keyboard.press('Escape')
  await o.getByRole('dialog', { name: 'Add a document' }).getByRole('button', { name: 'Cancel' }).click()
  await o.setViewportSize({ width: 1440, height: 900 })

  // ── 2. Compliance: a cleared required date still blocks the form ──
  await o.goto(base + '/hrms/compliance?view=calendar'); await settle(o)
  await o.getByRole('button', { name: /Add obligation/ }).click()
  const cd = o.getByRole('dialog', { name: 'Add compliance obligation' })
  await cd.waitFor({ timeout: 10000 })
  await cd.getByLabel('Obligation').fill(`QA obligation ${stamp}`)
  const due = cd.getByLabel('Due date')
  check('compliance: Due date starts on today', (await text(due)).includes(shortText(today)), await text(due))
  await due.locator('xpath=..').getByRole('button', { name: 'Clear' }).click()
  check('compliance: Due date can be cleared', (await text(due)).includes('Select date'))
  let posted = 0
  const onReq = (r) => { if (r.url().includes('/v1/compliance/items') && r.method() === 'POST') posted++ }
  o.on('request', onReq)
  await cd.getByRole('button', { name: 'Add obligation' }).click()
  await o.waitForTimeout(800)
  check('compliance: an empty required due date blocks the save', posted === 0 && (await cd.getByText('Pick a due date').count()) === 1 && (await cd.isVisible()))
  const nextMonth = addDays(today, 35)
  await pickDay(o, due, nextMonth)
  check('compliance: picking a date clears the message', (await text(due)).includes(shortText(nextMonth)) && (await cd.getByText('Pick a due date').count()) === 0)
  await due.click(); await dateDialog(o).waitFor({ timeout: 5000 }); await o.waitForTimeout(200)
  await o.screenshot({ path: `${shots}/r3-compliance-due-1440.png` })
  await o.keyboard.press('Escape')
  await o.setViewportSize({ width: 390, height: 844 }); await o.waitForTimeout(300)
  const dueBox = await due.boundingBox()
  check('390px: the due date shows in full', !!dueBox && (await due.evaluate((el) => { const t = el.querySelector('.utc-text'); return !!t && t.scrollWidth <= t.clientWidth })), JSON.stringify(dueBox))
  await o.screenshot({ path: `${shots}/r3-compliance-due-390.png` })
  await o.setViewportSize({ width: 1440, height: 900 })
  await cd.getByRole('button', { name: 'Cancel' }).click()
  o.off('request', onReq)
  check('compliance: nothing was saved', posted === 0)

  await o.goto(base + '/hrms/compliance?view=filings'); await settle(o)
  await o.getByRole('button', { name: /Schedule filing/ }).click()
  const fd = o.getByRole('dialog', { name: 'Schedule statutory filing' })
  await fd.waitFor({ timeout: 10000 })
  const fdue = addDays(today, 50)
  await pickDay(o, fd.getByLabel('Due date'), fdue)
  check('filings: Due date takes a picked date', (await text(fd.getByLabel('Due date'))).includes(shortText(fdue)))
  await fd.getByRole('button', { name: 'Cancel' }).click()

  await o.goto(base + '/hrms/compliance?view=posh'); await settle(o)
  const poshBtn = o.getByRole('button', { name: /Register complaint/ })
  if (await poshBtn.count()) {
    await poshBtn.click()
    const pd = o.getByRole('dialog', { name: 'Register POSH complaint' })
    await pd.waitFor({ timeout: 10000 })
    const filed = `${py}-11-05`
    await pickDay(o, pd.getByLabel('Filed date'), filed)
    check('posh: Filed date takes last year’s date', (await text(pd.getByLabel('Filed date'))).includes(shortText(filed)))
    await pd.getByRole('button', { name: 'Cancel' }).click()
  } else check('posh: register button shown to the owner', false)

  // ── 3. Learning ──
  await o.goto(base + '/hrms/learning?view=programs'); await settle(o)
  await o.getByRole('button', { name: /New program/ }).click()
  const start = addDays(today, 10), end = addDays(today, 12)
  await pickDay(o, o.locator('#lp-start'), start)
  await pickDay(o, o.locator('#lp-end'), end)
  check('learning: new program Starts / Ends take picked dates', (await text(o.locator('#lp-start'))).includes(shortText(start)) && (await text(o.locator('#lp-end'))).includes(shortText(end)))
  await o.locator('#lp-end').click()
  check('learning: Ends can’t go before Starts', (await dateDialog(o).locator(`[role=gridcell][aria-label^="${fullLabel(addDays(start, -1))}"]`).getAttribute('aria-disabled')) === 'true')
  await o.keyboard.press('Escape')
  await o.getByRole('button', { name: 'Cancel' }).first().click()

  const progs = await api(o, 'GET', '/v1/learning/programs?page=0&size=50')
  const prog = (progs.json?.items || progs.json?.content || []).find((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED')
  if (prog) {
    await o.goto(base + `/hrms/learning/programs/${prog.id}`); await settle(o)
    await o.getByRole('button', { name: 'Edit details' }).click()
    const ps = `${py}-06-15`
    await pickDay(o, o.locator('#pe-start'), ps)
    check('program edit: Starts takes last year’s date', (await text(o.locator('#pe-start'))).includes(shortText(ps)))
    await o.getByRole('button', { name: 'Cancel' }).first().click()
  } else check('program edit: an open program to try', false, `status ${progs.status}`)

  await o.goto(base + '/hrms/learning?view=certifications'); await settle(o)
  await o.getByLabel('Find employee').fill('Reader')
  await o.getByRole('button', { name: /Reader User/ }).click(); await settle(o)
  const on = o.locator('#sk-on')
  await on.click()
  const tomorrow = addDays(today, 1)
  if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
    check('certification: Certified on has no future days', (await dateDialog(o).locator(`[role=gridcell][aria-label^="${fullLabel(tomorrow)}"]`).getAttribute('aria-disabled')) === 'true')
  }
  await o.keyboard.press('Escape')
  const certOn = `${py}-02-20`, certExp = `${ty + 3}-02-19`
  await pickDay(o, on, certOn)
  await pickDay(o, o.locator('#sk-exp'), certExp)
  check('certification: Certified on / Expires on take picked dates', (await text(on)).includes(shortText(certOn)) && (await text(o.locator('#sk-exp'))).includes(shortText(certExp)))

  // Policies: the Manage form (Effective date) only renders for someone who can write policies but
  // not read them; every demo role that writes also reads (and gets the Master page), so it isn't
  // reachable here without changing someone's access. Not checked live.

  check('owner: no page errors', owner.errors.length === 0, owner.errors.slice(0, 2).join(' | '))
  check('owner: no failed API calls', owner.failed.length === 0, owner.failed.slice(0, 4).join(' | '))

  // ── 4. Inspector view (the API is mocked; nothing is created) ──
  const guest = await owner.ctx.newPage()
  const gErrors = []
  guest.on('pageerror', (e) => gErrors.push(String(e.message || e)))
  const bodies = []
  await guest.route('**/v1/public/inspector-view', async (route) => {
    bodies.push(JSON.parse(route.request().postData() || '{}'))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inspectorName: 'QA inspector', purpose: 'QA calendar check', expiresAt: new Date(Date.now() + 3600e3).toISOString(), documents: [], events: [] }) })
  })
  await guest.goto(base + '/inspection#qa-calendar-token'); await settle(guest)
  const month = guest.getByRole('combobox', { name: 'Reporting month' })
  await month.waitFor({ timeout: 15000 })
  check('inspector: the month shows as a name', (await text(month)).includes(`${MONTHS[Number(today.slice(5, 7)) - 1]} ${ty}`), await text(month))
  await month.click()
  await monthDialog(guest).getByRole('button', { name: 'Choose year' }).click()
  await monthDialog(guest).locator(`[role=gridcell][aria-label="${py}"]`).click()
  await monthDialog(guest).locator(`[role=gridcell][aria-label="March ${py}"]`).click()
  await guest.waitForTimeout(800)
  const lastBody = bodies[bodies.length - 1] || {}
  check('inspector: a previous-year month asks for that month', lastBody.from === `${py}-03-01` && lastBody.to === `${py}-03-31`, JSON.stringify(lastBody))
  check('inspector: the field shows it', (await text(month)).includes(`March ${py}`))
  check('inspector: no page errors', gErrors.length === 0, gErrors[0] || '')
  await guest.close()
  await owner.ctx.close(); owner = null

  // ── 5. My documents on the profile (employee) ──
  const r = await session('reader@unifiedtree.demo', 390, 844)
  await r.page.goto(base + '/profile'); await settle(r.page)
  // An expiry-tracked type the employee can upload to (Passport, else Driving License).
  let card = null
  for (const name of ['Passport', 'Driving License']) {
    const c = r.page.locator('.ut-card').filter({ has: r.page.getByText(name, { exact: true }) })
    if ((await c.count()) === 1 && (await c.getByTitle(/Upload|Re-upload/).count())) { card = c; break }
  }
  if (card) {
    await card.scrollIntoViewIfNeeded()
    await card.getByTitle(/Upload|Re-upload/).click()
    const pIssued = `${ty - 4}-07-01`, pExp = `${ty + 6}-06-30`
    await pickDay(r.page, card.getByLabel('Issued'), pIssued)
    await pickDay(r.page, card.getByLabel('Expires'), pExp)
    check('my documents: Issued / Expires take picked dates', (await text(card.getByLabel('Issued'))).includes(shortText(pIssued)) && (await text(card.getByLabel('Expires'))).includes(shortText(pExp)))
    check('390px: both dates show in full', await card.evaluate((el) => [...el.querySelectorAll('.utc-text')].every((t) => t.scrollWidth <= t.clientWidth)))
    await card.scrollIntoViewIfNeeded()
    await r.page.screenshot({ path: `${shots}/r3-mydocs-390.png` })
    await r.page.setViewportSize({ width: 1440, height: 900 })
    await card.scrollIntoViewIfNeeded()
    await r.page.screenshot({ path: `${shots}/r3-mydocs-1440.png` })
  } else check('my documents: an expiry-tracked card to upload to', false)
  check('employee: no page errors', r.errors.length === 0, r.errors.slice(0, 2).join(' | '))
  check('employee: no failed API calls', r.failed.length === 0, r.failed.slice(0, 4).join(' | '))
  await r.ctx.close()
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
} finally {
  // Remove the QA document (by id, or by title if the id was never read).
  try {
    const c = owner || await session('owner@unifiedtree.demo')
    if (!docId) docId = ((await api(c.page, 'GET', `/v1/document/employee/${readerId}?page=0&size=100`)).json?.content || []).find((d) => d.title === docTitle)?.id || null
    if (docId) {
      const del = await api(c.page, 'DELETE', `/v1/document/documents/${docId}`)
      const left = ((await api(c.page, 'GET', `/v1/document/employee/${readerId}?page=0&size=100`)).json?.content || []).filter((d) => d.title === docTitle).length
      check('cleanup: the QA document is deleted', del.status < 300 && left === 0, `status ${del.status}`)
    }
    await c.ctx.close()
  } catch (e) { check('cleanup ran', false, String(e.message || e).slice(0, 200)) }
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
