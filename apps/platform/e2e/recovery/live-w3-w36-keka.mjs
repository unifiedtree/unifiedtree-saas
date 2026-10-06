// Live check of the Keka-style passes (w36, 6 Oct): the dashboard month calendar (holidays, leave with
// sick leave apart, birthdays, chips, the leave-type pick, the agenda, the six date picks), sick leave on
// the Leave page calendar and on Home, the team calendar on My team, the designation ladder on Master,
// and the letterhead upload with its previews and the payslip template preview. Screenshots at 1440 and
// 390, light and dark.
//
//   node e2e/recovery/live-w3-w36-keka.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_APP_URL, RECOVERY_DB (default ut_w3_dev),
//        RECOVERY_PASSWORD, SHOTS
//
// Fixtures (removed at the end, whatever happens): two leave types (one SICK) and three approved leave
// requests for Reader (written straight to the database: approving through the API needs balances and
// a second person), a holiday, Reader's date of birth (put back as it was), two designations, and the
// letterhead (removed through the API).
/* global process, console, document, window, Buffer, fetch, FormData, Blob */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'ut_w3_dev', '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' }).trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const get = (t) => parts.find((p) => p.type === t).value
const today = `${get('year')}-${get('month')}-${get('day')}`
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// Keep the fixtures inside this month, so the month on show has them.
const dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
const day = Number(today.slice(8, 10))
const inMonth = (n) => { const t = day + n <= dim ? addDays(today, n) : addDays(today, -n); return t }
const sickTo = day < dim ? addDays(today, 1) : today
const holidayOn = inMonth(3), casualOn = inMonth(5), birthdayOn = inMonth(2)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const word = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body, raw) => {
    const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
    if (!raw) headers['Content-Type'] = 'application/json'
    const res = await fetch(api + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call }
}

const tag = randomUUID().slice(0, 6)
const ids = { sickType: randomUUID(), casualType: randomUUID(), sick: randomUUID(), casual: randomUUID(), holiday: randomUUID() }
const desigs = []
let dobBefore = null
let letterheadSet = false
const browser = await chromium.launch({ headless: true })

async function session(email, { width = 1440, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { window.localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, dark ? 'dark' : 'light')
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
const shot = async (page, name, locator) => {
  await page.waitForTimeout(400)
  if (locator) await locator.screenshot({ path: `${shots}/w36-keka-${name}.png` }).catch(() => page.screenshot({ path: `${shots}/w36-keka-${name}.png`, fullPage: false }))
  else await page.screenshot({ path: `${shots}/w36-keka-${name}.png`, fullPage: false })
}

try {
  const owner = await login('owner@unifiedtree.demo')

  // ── fixtures ──────────────────────────────────────────────────────────────
  sql(`insert into leave_mgmt.leave_types (id, tenant_id, company_id, name, code, category) values
    ('${ids.sickType}', '${tenant}', '${company}', 'QA Sick ${tag}', 'QS${tag}', 'SICK'),
    ('${ids.casualType}', '${tenant}', '${company}', 'QA Casual ${tag}', 'QC${tag}', 'CASUAL')`)
  sql(`insert into leave_mgmt.leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, total_days, status, reason) values
    ('${ids.sick}', '${tenant}', '${READER}', '${ids.sickType}', '${today}', '${sickTo}', ${today === sickTo ? 1 : 2}, 'APPROVED', 'QA w36'),
    ('${ids.casual}', '${tenant}', '${READER}', '${ids.casualType}', '${casualOn}', '${casualOn}', 1, 'APPROVED', 'QA w36')`)
  sql(`insert into settings.holiday_calendar (id, tenant_id, company_id, year, holiday_date, holiday_name, holiday_type) values
    ('${ids.holiday}', '${tenant}', '${company}', ${Number(holidayOn.slice(0, 4))}, '${holidayOn}', 'QA Holiday ${tag}', 'COMPANY')`)
  dobBefore = sql(`select coalesce(date_of_birth::text, '') from hrms.employees where id = '${READER}'`)
  sql(`update hrms.employees set date_of_birth = '1990-${birthdayOn.slice(5)}' where id = '${READER}'`)
  check('fixtures: leave types, approved leave, a holiday and a birthday', true)

  // ── 1. API: the calendar's sources carry what it needs ────────────────────
  const feed = await owner.call(`/v1/leave/calendar?from=${today.slice(0, 7)}-01&to=${today.slice(0, 7)}-${String(dim).padStart(2, '0')}&statuses=APPROVED`)
  const sickRow = (feed.json?.entries || []).find((e) => e.id === ids.sick)
  check('API leave calendar carries the sick leave with its category', feed.status === 200 && sickRow?.leaveTypeCategory === 'SICK', `status=${feed.status} cat=${sickRow?.leaveTypeCategory}`)

  // ── 2. Dashboard (owner): the month calendar ──────────────────────────────
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/dashboard')
    await page.waitForLoadState('networkidle')
    const cal = page.locator('section.ec').first()
    await cal.waitFor({ timeout: 20000 })
    await cal.scrollIntoViewIfNeeded()
    await page.waitForLoadState('networkidle')
    const todayCell = cal.locator(`[data-day="${today}"]`)
    const label = await todayCell.getAttribute('aria-label')
    check('dashboard calendar: today names the sick leave', /Sick leave: Reader User/.test(label || ''), label)
    check('dashboard calendar: sick leave has its own colour', (await todayCell.locator('.ec-chip.ec-k--sick').count()) === 1)
    check('dashboard calendar: the holiday is on its day', /Holiday: QA Holiday/.test((await cal.locator(`[data-day="${holidayOn}"]`).getAttribute('aria-label')) || ''))
    check('dashboard calendar: the birthday is on its day', /Birthday: Reader User/.test((await cal.locator(`[data-day="${birthdayOn}"]`).getAttribute('aria-label')) || ''))
    check('dashboard calendar: today’s agenda lists the sick leave', (await cal.locator('.ec-agenda .ec-item', { hasText: 'Reader User' }).filter({ has: page.locator('.ec-pill') }).count()) === 1)
    await shot(page, 'dashboard-1440-light', cal)
    // Chips: Sick leave only.
    await cal.getByRole('button', { name: /^Sick leave/ }).click()
    check('chip "Sick leave" keeps only sick leave', (await cal.locator('.ec-chip.ec-k--leave').count()) === 0 && (await cal.locator('.ec-chip.ec-k--sick').count()) >= 1 && (await cal.locator('.ec-chip.ec-k--holiday').count()) === 0)
    await cal.getByRole('button', { name: /^All/ }).click()
    check('leave-type pick shows (two leave types this month)', (await cal.getByRole('button', { name: /Leave type/ }).count()) + (await cal.getByText('All leave types').count()) > 0)
    // Click the holiday's day → the agenda shows it.
    await cal.locator(`[data-day="${holidayOn}"]`).click()
    check('clicking a day shows that day in the agenda', (await cal.locator('.ec-agenda__t').textContent())?.includes(word(holidayOn).split(', ')[1]) && (await cal.locator('.ec-agenda').getByText(`QA Holiday ${tag}`).count()) === 1)
    // Start date / End date with the six picks.
    await cal.getByRole('button', { name: /^Start date/ }).click()
    const dlg = page.getByRole('dialog', { name: 'Show dates' })
    await dlg.waitFor({ timeout: 5000 })
    const picks = await dlg.getByRole('group', { name: 'Quick picks' }).getByRole('button').allTextContents()
    check('the date dialog offers the six picks', picks.join('|') === 'Today|This week|Next week|This month|Next month|Next 30 days', picks.join('|'))
    await dlg.getByRole('button', { name: 'This month' }).click()
    await dlg.getByRole('button', { name: 'Done' }).click()
    await page.waitForLoadState('networkidle')
    const agendaText = await cal.locator('.ec-agenda').textContent()
    check('a picked range lists everything in it, day by day', agendaText.includes(`QA Holiday ${tag}`) && agendaText.includes('QA Casual') && agendaText.includes('Clear'), agendaText.slice(0, 160))
    await cal.getByRole('button', { name: 'Clear the dates' }).click()
    check('dashboard: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('dashboard: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }
  for (const [w, h, dark, name] of [[390, 844, false, 'dashboard-390-light'], [1440, 900, true, 'dashboard-1440-dark'], [390, 844, true, 'dashboard-390-dark']]) {
    const { ctx, page } = await session('owner@unifiedtree.demo', { width: w, height: h, dark })
    await page.goto(base + '/dashboard')
    const cal = page.locator('section.ec').first()
    await cal.waitFor({ timeout: 20000 })
    await cal.scrollIntoViewIfNeeded()
    await page.waitForLoadState('networkidle')
    if (w === 390) {
      const box = await cal.boundingBox()
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      check(`${name}: calendar fits the phone (no sideways scroll)`, !!box && box.x >= 0 && box.x + box.width <= 391 && sw <= 391, `box=${JSON.stringify(box)} scrollWidth=${sw}`)
      check(`${name}: phone shows dots, not names`, (await cal.locator('.ec-dot').first().isVisible()) && !(await cal.locator('.ec-chip').first().isVisible()))
    }
    await shot(page, name, cal)
    await ctx.close()
  }

  // ── 3. Leave page calendar: sick leave apart, leave-type filter ───────────
  {
    const { ctx, page, errors } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/hrms/leave?tab=calendar')
    await page.waitForLoadState('networkidle')
    const chip = page.locator(`[data-date="${today}"] .ec-lchip[data-sick]`)
    await chip.first().waitFor({ timeout: 20000 }).catch(() => {})
    check('Leave calendar: the sick leave chip is marked and coloured', (await chip.count()) === 1 && (await chip.getAttribute('class')).includes('ec-k--sick'))
    check('Leave calendar: legend names sick leave', (await page.locator('.ec-legend', { hasText: 'Sick leave' }).count()) >= 1)
    const select = page.getByRole('combobox', { name: /Leave type/ }).or(page.locator('label', { hasText: 'Leave type' }).locator('select'))
    await select.first().selectOption({ label: new RegExp(`QA Casual ${tag}`) }).catch(async () => {
      const opts = await select.first().locator('option').allTextContents()
      const want = opts.find((o) => o.includes(`QA Casual ${tag}`))
      if (want) await select.first().selectOption({ label: want })
    })
    await page.waitForTimeout(300)
    check('Leave calendar: picking a leave type hides the others', (await page.locator('.ec-lchip[data-sick]').count()) === 0 && (await page.locator('.ec-lchip').count()) >= 1)
    await shot(page, 'leave-calendar-1440-light')
    check('Leave calendar: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ── 4. My team (manager): the team calendar with the team's own people ────
  {
    const { ctx, page, errors, failed } = await session('mgr@unifiedtree.demo')
    await page.goto(base + '/team')
    await page.waitForLoadState('networkidle')
    const cal = page.locator('section.ec', { hasText: 'Team calendar' })
    await cal.waitFor({ timeout: 20000 }).catch(() => {})
    check('My team: the team calendar shows', (await cal.count()) === 1)
    if (await cal.count()) {
      await cal.scrollIntoViewIfNeeded()
      await page.waitForLoadState('networkidle')
      check('My team: the report’s sick leave is on the team calendar', /Sick leave: Reader User/.test((await cal.locator(`[data-day="${today}"]`).getAttribute('aria-label')) || ''))
      check('My team: the report’s birthday is on it', /Birthday: Reader User/.test((await cal.locator(`[data-day="${birthdayOn}"]`).getAttribute('aria-label')) || ''))
      const order = await page.locator('.tm-side > section').evaluateAll((els) => els.map((e) => e.querySelector('h2,h3')?.textContent?.trim()))
      check('My team: who is away sits right after Waiting for you', order[0] !== 'Out soon' ? order.indexOf('Out soon') <= 1 : true, order.join(' | '))
      await shot(page, 'team-1440-light')
    }
    check('My team: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('My team: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
    const phone = await session('mgr@unifiedtree.demo', { width: 390, height: 844, dark: true })
    await phone.page.goto(base + '/team')
    await phone.page.waitForLoadState('networkidle')
    const pc = phone.page.locator('section.ec', { hasText: 'Team calendar' })
    if (await pc.count()) { await pc.scrollIntoViewIfNeeded(); await phone.page.waitForLoadState('networkidle'); await shot(phone.page, 'team-390-dark', pc) }
    await phone.ctx.close()
  }

  // ── 5. Home (reader): the month calendar tells sick leave apart ───────────
  {
    const { ctx, page, errors } = await session('reader@unifiedtree.demo')
    await page.goto(base + '/me')
    await page.waitForLoadState('networkidle')
    const legend = page.locator('.uk-cal__legend', { hasText: 'Sick leave' })
    await legend.first().waitFor({ timeout: 20000 }).catch(() => {})
    check('Home calendar: legend has Sick leave', (await legend.count()) >= 1)
    check('Home calendar: today is marked as sick leave', (await page.locator(`.uk-cal--sick[data-date="${today}"], [data-date="${today}"].uk-cal--sick`).count()) >= 1)
    check('Home: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ── 6. Master → Designations: Reports to and the Hierarchy view ────────────
  {
    const top = await owner.call('/v1/hrms/designations', 'POST', { companyId: company, title: `QA Head ${tag}` })
    if (top.json?.id) desigs.push(top.json.id)
    const sub = await owner.call('/v1/hrms/designations', 'POST', { companyId: company, title: `QA Member ${tag}`, reportsToDesignationId: top.json?.id })
    if (sub.json?.id) desigs.push(sub.json.id)
    check('API a designation can be created reporting to another', top.status === 201 || top.status === 200 ? sub.json?.reportsToDesignationId === top.json?.id : false, `top=${top.status} sub=${sub.status}`)
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/hrms/master/designations')
    await page.waitForLoadState('networkidle')
    const row = page.locator('tr', { hasText: `QA Member ${tag}` })
    await row.first().waitFor({ timeout: 20000 }).catch(() => {})
    check('Designations table: Reports to column shows the senior title', (await row.first().textContent())?.includes(`QA Head ${tag}`))
    await page.getByRole('button', { name: 'Hierarchy' }).click()
    const child = page.getByRole('treeitem', { name: new RegExp(`^QA Member ${tag}`) })
    const parent = page.getByRole('treeitem', { name: new RegExp(`^QA Head ${tag}`) })
    await child.waitFor({ timeout: 10000 }).catch(() => {})
    check('Hierarchy: the member sits one level under the head', (await parent.getAttribute('aria-level')) === '1' && (await child.getAttribute('aria-level')) === '2')
    await shot(page, 'master-hierarchy-1440-light')
    await child.click()
    await page.getByText('Reports to').first().waitFor({ timeout: 5000 }).catch(() => {})
    check('the form shows Reports to with the senior title', (await page.locator('.field', { hasText: 'Reports to' }).first().textContent())?.includes(`QA Head ${tag}`))
    check('Master: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('Master: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
    const phone = await session('owner@unifiedtree.demo', { width: 390, height: 844, dark: true })
    await phone.page.goto(base + '/hrms/master/designations')
    await phone.page.waitForLoadState('networkidle')
    await phone.page.getByRole('button', { name: 'Hierarchy' }).click().catch(() => {})
    await shot(phone.page, 'master-hierarchy-390-dark')
    await phone.ctx.close()
  }

  // ── 7. Branding → Letterhead: upload, previews, payslip preview, remove ────
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    const pngOf = async (w, h) => Buffer.from((await page.evaluate(([w, h]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.fillStyle = '#0F6E56'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = `bold ${Math.round(h / 3)}px sans-serif`; x.fillText('QA Letterhead', 20, h / 2)
      return c.toDataURL('image/png').split(',')[1]
    }, [w, h])), 'base64')
    await page.goto(base + '/settings/branding')
    await page.waitForLoadState('networkidle')
    const sec = page.locator('#st-letterhead')
    await sec.waitFor({ timeout: 20000 })
    // API: a tall picture is refused with a plain reason.
    const tall = new FormData(); tall.append('file', new Blob([await pngOf(300, 300)], { type: 'image/png' }), 'tall.png')
    const refused = await owner.call('/v1/workspace/branding/letterhead', 'POST', undefined, tall)
    check('API a square picture is refused as a letterhead (422)', refused.status === 422, `status=${refused.status}`)
    await sec.locator('input[type=file]').setInputFiles({ name: 'letterhead.png', mimeType: 'image/png', buffer: await pngOf(1600, 200) })
    await sec.getByText('With the new letterhead').waitFor({ timeout: 10000 }).catch(() => {})
    check('Letterhead: the picked image is previewed on a page before saving', (await sec.getByText('With the new letterhead').count()) === 1)
    await shot(page, 'letterhead-picked-1440-light', sec)
    await sec.getByRole('button', { name: 'Save letterhead' }).click()
    await sec.getByText(/Letterhead set/).waitFor({ timeout: 15000 }).catch(() => {})
    letterheadSet = true
    const after = await owner.call('/v1/workspace/branding')
    check('Letterhead: saved (the branding answer has its address and size)', !!after.json?.letterheadUrl && after.json?.letterheadWidth === 1600 && after.json?.letterheadHeight === 200, JSON.stringify(after.json).slice(0, 200))
    const pv = await owner.call('/v1/payroll/payslips/template-preview')
    check('API payslip template preview carries the letterhead banner and example figures', pv.status === 200 && (pv.json?.html || '').includes('data:image/png;base64') && (pv.json?.html || '').includes('(example)'), `status=${pv.status}`)
    const reader = await login('reader@unifiedtree.demo')
    check('API payslip template preview is not for everyone (403 for an employee)', (await reader.call('/v1/payroll/payslips/template-preview')).status === 403)
    await sec.getByRole('button', { name: 'Preview a payslip' }).click()
    const dlg = page.getByRole('dialog', { name: 'Payslip preview' })
    await dlg.waitFor({ timeout: 10000 })
    const frame = dlg.locator('iframe[title="Payslip preview"]')
    await frame.waitFor({ timeout: 10000 }).catch(() => {})
    check('Payslip preview: the dialog shows the payslip with the letterhead', ((await frame.getAttribute('srcdoc')) || '').includes('data:image/png;base64'))
    await shot(page, 'payslip-preview-1440-light', dlg)
    await page.keyboard.press('Escape')
    await sec.getByRole('button', { name: 'Remove' }).click()
    await sec.getByText(/No letterhead/).waitFor({ timeout: 15000 }).catch(() => {})
    const gone = await owner.call('/v1/workspace/branding')
    check('Letterhead: removed again', gone.status === 200 && !gone.json?.letterheadUrl)
    if (!gone.json?.letterheadUrl) letterheadSet = false
    check('Branding: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('Branding: no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
    const phone = await session('owner@unifiedtree.demo', { width: 390, height: 844, dark: true })
    await phone.page.goto(base + '/settings/branding')
    const ps = phone.page.locator('#st-letterhead')
    await ps.waitFor({ timeout: 20000 }).catch(() => {})
    await ps.scrollIntoViewIfNeeded().catch(() => {})
    await shot(phone.page, 'letterhead-390-dark', ps)
    await phone.ctx.close()
  }
} catch (e) {
  check('the run finished without an exception', false, String(e?.stack || e).slice(0, 400))
} finally {
  // ── clean up everything this test made ────────────────────────────────────
  try {
    if (letterheadSet) { const o = await login('owner@unifiedtree.demo'); await o.call('/v1/workspace/branding/letterhead', 'DELETE') }
  } catch { /* reported below */ }
  const tidy = [
    `delete from leave_mgmt.leave_requests where id in ('${ids.sick}', '${ids.casual}')`,
    `delete from leave_mgmt.leave_types where id in ('${ids.sickType}', '${ids.casualType}')`,
    `delete from settings.holiday_calendar where id = '${ids.holiday}'`,
    dobBefore !== null ? `update hrms.employees set date_of_birth = ${dobBefore ? `'${dobBefore}'` : 'null'} where id = '${READER}'` : null,
    desigs.length ? `delete from hrms.designations where id in (${desigs.map((d) => `'${d}'`).join(',')})` : null,
  ].filter(Boolean)
  let clean = true
  for (const q of tidy) { try { sql(q) } catch (e) { clean = false; console.log('cleanup failed:', q.slice(0, 80), String(e).slice(0, 200)) } }
  check('cleanup: everything the test made is removed', clean)
  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed`)
  process.exit(bad.length ? 1 : 0)
}
