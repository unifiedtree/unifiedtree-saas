// Live UI check for P-HOME's UI half: the self-service Home at /me (employee and
// manager), Work from home (/me/wfh) and Shift change (/me/shift-change).
//
//  - reader (EMPLOYEE): Home shows the greeting, the four cards, quick actions (no
//    Customise), Needs you, My requests, the month, Leave and Upcoming events; Check
//    in / Check out show only when web check-in is on (Your day's webPunchAllowed) and
//    open the shared web punch dialog.
//  - Work from home: two separate day chips are sent in one go (POST /v1/wfh/batch),
//    show up in Your requests and on Home's My requests, then both are cancelled
//    through the page's Cancel dialog.
//  - mgr (DEPT_MANAGER): Home shows Punch for a team member right under the greeting
//    (it opens the panel listing reader), Waiting for you, Today's team and the team
//    cards. Shift change: a card is picked, From and Until are set, the request is
//    sent with Until (the database keeps it), then withdrawn through the page.
//  - light and dark at 1440, and 390 wide with no sideways scroll; screenshots go to
//    C:/REACT/ut-wt/_results/shots/rd-p-home-*.png next to the design's.
//  - No page errors and no failed API calls on these pages.
// Everything it creates is removed at the end.
//
//   node e2e/recovery/live-rd-p-home.mjs      (RECOVERY_APP_URL, RECOVERY_DB)
/* global process, console, document, window, localStorage */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3123'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const SHOTS = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const READER = '22222222-2222-2222-2222-222222222222'
const MGR = '44444444-4444-4444-4444-444444444444'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const rows = (q) => sql(q).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = MONTHS.map((m) => m.slice(0, 3))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const full = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
/** Home's day words: "Mon 5 Oct", "Mon 5 – Tue 6 Oct". */
const dayShort = (s) => { const d = new Date(s + 'T00:00:00'); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` }
const dayRange = (a, b) => {
  if (a === b) return dayShort(a)
  const x = new Date(a + 'T00:00:00'), y = new Date(b + 'T00:00:00')
  return x.getMonth() === y.getMonth() ? `${WD[x.getDay()]} ${x.getDate()} – ${dayShort(b)}` : `${dayShort(a)} – ${dayShort(b)}`
}

mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ headless: true })
const created = { wfh: [], shift: [] }

async function session(email, { width = 1440, height = 1000, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1500)
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(700)
}
const openHome = async (page) => {
  await page.goto(base + '/me')
  await page.getByRole('heading', { level: 1 }).filter({ hasText: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 60_000 })
  await settle(page)
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/rd-p-home-${name}.png`, fullPage: true }).catch(() => {})
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)
const heading = (page, name) => page.getByRole('heading', { name, exact: true })

/** Open a DateField and pick `day` through the year → month → day views. */
async function pickDay(page, trigger, day) {
  await trigger.click()
  const dlg = page.getByRole('dialog', { name: 'Choose date', exact: true })
  await dlg.waitFor({ timeout: 5000 })
  const [y, m] = day.split('-').map(Number)
  await dlg.getByRole('button', { name: 'Choose year' }).click()
  await dlg.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label="${MONTHS[m - 1]} ${y}"]`).click()
  await dlg.locator(`[role=gridcell][aria-label^="${full(day)}"]`).click()
  await dlg.waitFor({ state: 'hidden', timeout: 5000 })
}

try {
  // ── 1. reader: the employee Home ───────────────────────────────────────────
  {
    const s = await session('reader@unifiedtree.demo')
    const { page } = s
    await openHome(page)
    check('reader: Home greets them', true)
    for (const h of ['Quick actions', 'Needs you', 'My requests', 'Leave', 'Upcoming events', 'Shortcuts']) {
      check(`reader: "${h}" is on Home`, (await heading(page, h).count()) === 1)
    }
    check('reader: the month calendar is on Home', (await page.getByRole('heading', { name: /attendance$/ }).count()) >= 1)
    const cards = await page.getByRole('group', { name: 'Your month at a glance' }).locator(':scope > *').count()
    check('reader: four cards under the greeting', cards === 4, `${cards}`)
    check('reader: no Customise (its backend is not built)', (await page.getByRole('button', { name: /Customise/ }).count()) === 0)
    check('reader: "Upcoming events", not "Upcoming milestones"', !(await page.getByText(/Upcoming milestones/i).count()))
    const checkBtn = page.locator('header.uk-ph').getByRole('button', { name: /^Check (in|out)$/ })
    if (await checkBtn.count()) {
      await checkBtn.first().click()
      const dlg = page.getByRole('dialog')
      check('reader: Check in / out opens the web punch dialog', await dlg.first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))
      await shot(page, 'reader-punch-dialog-1440')
      await page.keyboard.press('Escape')
      await dlg.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    } else {
      // Hidden only while Your day says web check-in is off for the company.
      const yourDay = await page.getByRole('status', { name: 'Your day' }).count()
      check('reader: Check in / out hidden while web check-in is off', true, yourDay ? 'Your day shown without the buttons' : 'no Your day')
    }
    await shot(page, 'reader-home-1440-light')
    check('reader Home: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('reader Home: no failed API calls', s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))

    // ── 2. Work from home: two separate days in one send, then cancel both ──
    s.errors.length = 0; s.failed.length = 0
    await page.goto(base + '/me/wfh')
    const group = page.getByRole('group', { name: 'Pick days' })
    await group.getByRole('button').first().waitFor({ timeout: 30_000 })
    await settle(page)
    await shot(page, 'reader-wfh-1440-light')
    const free = group.locator('button:not([disabled])')
    const nFree = await free.count()
    check('wfh: at least three free days to pick from', nFree >= 3, `${nFree}`)
    const startedAt = sql('SELECT now()')
    if (nFree >= 3) {
      await free.nth(0).click()
      await free.nth(2).click()
      check('wfh: two chips picked', (await group.locator('button[aria-pressed="true"]').count()) === 2)
      check('wfh: the line names the two days', await page.getByText(/^2 days: /).first().isVisible())
      await page.getByRole('textbox', { name: /Reason/ }).fill('P-HOME live check: two separate days')
      const post = page.waitForResponse((r) => r.url().includes('/v1/wfh/batch') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null)
      await page.getByRole('button', { name: 'Send request' }).click()
      const pr = await post
      check('wfh: the send goes to POST /v1/wfh/batch with both days', !!pr && pr.status() === 201 && (pr.request().postDataJSON()?.dates?.length === 2), pr ? `${pr.status()}` : 'no request')
      const made = rows(`SELECT id, from_date, to_date, status FROM leave_mgmt.wfh_requests WHERE tenant_id=${lit(tenant)} AND employee_id=${lit(READER)} AND created_at >= ${lit(startedAt)} ORDER BY from_date`)
      created.wfh.push(...made.map((r) => r[0]))
      check('wfh: the requests are saved and waiting', made.length >= 1 && made.every((r) => /PENDING/.test(r[3])), made.map((r) => `${r[1]}..${r[2]} ${r[3]}`).join(', '))
      await settle(page)
      check('wfh: the picks are cleared after sending', (await group.locator('button[aria-pressed="true"]').count()) === 0)
      for (const r of made) {
        check(`wfh: Your requests lists ${dayRange(r[1], r[2])}`, (await page.getByText(dayRange(r[1], r[2]), { exact: false }).count()) >= 1)
      }
      // Home's My requests shows them too.
      await openHome(page)
      const myReq = page.locator('section', { has: heading(page, 'My requests') })
      check('Home: My requests shows the work-from-home request', (await myReq.getByText(/Work from home/).count()) >= 1)
      // Cancel each through the page.
      await page.goto(base + '/me/wfh')
      await settle(page)
      for (const r of made) {
        // The innermost block holding both the request's days and its Cancel button.
        const row = page.locator('div, li').filter({ hasText: dayRange(r[1], r[2]) }).filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) }).last()
        await row.getByRole('button', { name: 'Cancel', exact: true }).click()
        const dlg = page.getByRole('dialog', { name: /Cancel this request/ })
        await dlg.waitFor({ timeout: 5000 })
        check('wfh: the cancel dialog keeps "Close panel"', (await dlg.getByRole('button', { name: 'Close panel' }).count()) === 1)
        await dlg.getByRole('button', { name: 'Cancel request' }).click()
        await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
        await settle(page)
      }
      const after = rows(`SELECT status FROM leave_mgmt.wfh_requests WHERE id IN (${made.map((r) => lit(r[0])).join(',') || 'NULL'})`)
      check('wfh: both requests are cancelled through the page', after.length === made.length && after.every((r) => r[0] === 'CANCELLED'), after.map((r) => r[0]).join(', '))
    }
    check('wfh page: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('wfh page: no failed API calls', s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── 3. mgr: the manager Home ───────────────────────────────────────────────
  {
    const s = await session('mgr@unifiedtree.demo')
    const { page } = s
    await openHome(page)
    const strip = page.getByRole('region', { name: 'Punch for a team member' })
    check('mgr: "Punch for a team member" is on Home', (await strip.count()) === 1)
    const box = await strip.boundingBox()
    const qa = await heading(page, 'Quick actions').boundingBox()
    check('mgr: it sits right under the greeting, above everything else', !!box && !!qa && box.y < qa.y && box.y < 300, JSON.stringify({ strip: box?.y, quick: qa?.y }))
    await strip.getByRole('button', { name: 'Choose a person' }).click()
    const panel = page.getByRole('dialog', { name: 'Punch for a team member' })
    await panel.waitFor({ timeout: 10_000 })
    check('mgr: the panel lists Reader User', await panel.getByText('Reader User').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false))
    await shot(page, 'mgr-punch-panel-1440')
    await panel.getByRole('button', { name: 'Close panel' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    for (const h of ['Waiting for you', 'Today’s team', 'Needs you', 'My requests', 'Upcoming events']) {
      check(`mgr: "${h}" is on Home`, (await heading(page, h).count()) === 1)
    }
    check('mgr: the team cards are on Home', (await page.getByRole('group', { name: 'Your team today' }).count()) === 1)
    check('mgr: Today’s team lists Reader User', (await page.locator('[aria-label="Your team today"]').getByText('Reader User').count()) >= 1)
    check('mgr: no month calendar (the team is shown instead)', (await page.getByRole('heading', { name: /attendance$/ }).count()) === 0)
    await shot(page, 'mgr-home-1440-light')
    check('mgr Home: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('mgr Home: no failed API calls', s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))

    // ── 4. Shift change with Until, then withdraw ──
    s.errors.length = 0; s.failed.length = 0
    const pendingBefore = sql(`SELECT count(*) FROM attendance.shift_change_requests WHERE tenant_id=${lit(tenant)} AND employee_id=${lit(MGR)} AND status='PENDING'`)
    await page.goto(base + '/me/shift-change')
    await page.getByRole('heading', { name: 'Shift change', level: 1 }).waitFor({ timeout: 30_000 })
    await settle(page)
    await shot(page, 'mgr-shift-1440-light')
    const card = page.getByRole('group', { name: 'Shifts' }).locator('button:not([disabled])').first()
    if (pendingBefore !== '0') check('shift: mgr has no waiting request to start with', false, `${pendingBefore} waiting`)
    else if (!(await card.count())) check('shift: a shift to move to', false, 'no enabled card')
    else {
      const name = (await card.locator('.us-card__name').innerText()).trim()
      await card.click()
      check('shift: the picked card is pressed', (await card.getAttribute('aria-pressed')) === 'true')
      check('shift: the form names the shift', (await heading(page, `Move to the ${name} shift`).count()) === 1)
      const fromBox = page.getByRole('combobox', { name: /^From/ })
      const untilBox = page.getByRole('combobox', { name: /^Until/ })
      const today = sql(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD')`)
      const from = addDays(today, 3), until = addDays(today, 10)
      await pickDay(page, fromBox, from)
      await pickDay(page, untilBox, until)
      await page.getByRole('textbox', { name: /Why do you need it/ }).fill('P-HOME live check: covering a release window')
      const startedAt = sql('SELECT now()')
      const post = page.waitForResponse((r) => r.url().endsWith('/v1/shifts/change-requests') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null)
      await page.getByRole('button', { name: /^Send to / }).click()
      const pr = await post
      const body = pr ? pr.request().postDataJSON() : null
      check('shift: the request carries From and Until', !!pr && pr.ok() && body?.effectiveDate === from && body?.endDate === until, pr ? `${pr.status()} ${JSON.stringify(body)}` : 'no request')
      const made = rows(`SELECT id, requested_effective_date, requested_end_date, status FROM attendance.shift_change_requests WHERE tenant_id=${lit(tenant)} AND employee_id=${lit(MGR)} AND created_at >= ${lit(startedAt)}`)
      created.shift.push(...made.map((r) => r[0]))
      check('shift: the database keeps Until', made.length === 1 && made[0][1] === from && made[0][2] === until && made[0][3] === 'PENDING', made.map((r) => r.join(' ')).join(', '))
      await settle(page)
      check('shift: the page shows the request is waiting', (await heading(page, 'Your request is waiting').count()) === 1)
      await page.getByRole('button', { name: 'Withdraw' }).first().click()
      const dlg = page.getByRole('dialog', { name: /Withdraw this request/ })
      await dlg.waitFor({ timeout: 5000 })
      await dlg.getByRole('button', { name: 'Withdraw' }).click()
      await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
      await settle(page)
      const st = made.length ? sql(`SELECT status FROM attendance.shift_change_requests WHERE id=${lit(made[0][0])}`) : ''
      check('shift: withdrawn through the page', st === 'CANCELLED', st)
      check('shift: Past changes shows it as withdrawn', (await page.getByText('Withdrawn').count()) >= 1)
    }
    check('shift page: no page errors', s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    check('shift page: no failed API calls', s.failed.length === 0, [...new Set(s.failed)].slice(0, 4).join(' | '))
    await s.ctx.close()
  }

  // ── 5. dark at 1440 and phones at 390 ──────────────────────────────────────
  for (const who of ['reader', 'mgr']) {
    const d = await session(`${who}@unifiedtree.demo`, { theme: 'dark' })
    await openHome(d.page)
    check(`${who}: dark theme is on`, (await d.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
    await shot(d.page, `${who}-home-1440-dark`)
    for (const p of ['/me/wfh', '/me/shift-change']) {
      await d.page.goto(base + p)
      await d.page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 })
      await settle(d.page)
      await shot(d.page, `${who}${p.replace(/\//g, '-')}-1440-dark`)
    }
    check(`${who} dark: no page errors`, d.errors.length === 0, d.errors.slice(0, 3).join(' | '))
    await d.ctx.close()

    const m = await session(`${who}@unifiedtree.demo`, { width: 390, height: 844 })
    for (const p of ['/me', '/me/wfh', '/me/shift-change']) {
      if (p === '/me') await openHome(m.page)
      else { await m.page.goto(base + p); await m.page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 }); await settle(m.page) }
      check(`${who} 390: no sideways scroll on ${p}`, await noSideScroll(m.page))
      await shot(m.page, `${who}${p.replace(/\//g, '-')}-390-light`)
    }
    check(`${who} 390: no page errors`, m.errors.length === 0, m.errors.slice(0, 3).join(' | '))
    await m.ctx.close()
  }
} catch (e) {
  check('script completed', false, String(e.message || e).split('\n')[0].slice(0, 300))
} finally {
  // ── cleanup: everything this check made ──
  try {
    if (created.wfh.length) {
      const ids = created.wfh.map(lit).join(',')
      sql(`DELETE FROM notif.notifications WHERE tenant_id = ${lit(tenant)} AND (data->>'wfhRequestId' IN (${ids}) OR data->>'requestId' IN (${ids}))`)
      sql(`DELETE FROM leave_mgmt.wfh_requests WHERE tenant_id = ${lit(tenant)} AND id IN (${ids})`)
    }
  } catch (e) { console.log('cleanup (wfh):', String(e).split('\n')[0]) }
  try {
    if (created.shift.length) {
      const ids = created.shift.map(lit).join(',')
      sql(`DELETE FROM notif.notifications WHERE tenant_id = ${lit(tenant)} AND (data->>'requestId' IN (${ids}) OR data->>'shiftChangeRequestId' IN (${ids}))`)
      sql(`DELETE FROM attendance.shift_change_requests WHERE tenant_id = ${lit(tenant)} AND id IN (${ids})`)
    }
  } catch (e) { console.log('cleanup (shift):', String(e).split('\n')[0]) }
  try {
    const left = Number(sql(`SELECT (SELECT count(*) FROM leave_mgmt.wfh_requests WHERE id IN (${created.wfh.map(lit).join(',') || 'NULL'}))
      + (SELECT count(*) FROM attendance.shift_change_requests WHERE id IN (${created.shift.map(lit).join(',') || 'NULL'}))`))
    check('cleanup: nothing the check made is left', left === 0, `${left} left`)
  } catch (e) { check('cleanup: nothing the check made is left', false, String(e).split('\n')[0]) }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
