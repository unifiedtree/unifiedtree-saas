// Staff Home (/me, the self-service Home of the redesign, P-HOME) — browser
// acceptance against a running backend + web app. Before the redesign this checked
// the staff dashboard at /dashboard (RoleDashboard); a non-admin's Home is now /me
// (DECISIONS 12), so the same behavioural checks run there. Logs in through the UI
// as the EMPLOYEE seat and then the HR_MANAGER / DEPT_MANAGER seats (non-admin
// buckets), and checks: no hard-coded "Ionora", the greeting's line is built from
// real figures, no "Data unavailable" / "(N/A)" tiles, no single-option <select>
// chips, every visible Home button either navigates or opens something (approve /
// reject, filters, toggles and breaks are left alone: they change data or state in
// place), no percentage above 100%, the real Upcoming events card is mounted, the
// month's "Open" goes to My Attendance, 0 page errors / failed API calls.
// Read-only: no DB fixtures are created.
//
// Run from apps/platform:  node e2e/recovery/live-staff-dashboard.mjs
//   env: RECOVERY_APP_URL, RECOVERY_DB (the database the backend uses; default ut_w3_dev), RECOVERY_PASSWORD
/* global process, console, URL, Node, document */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()

const checks = []
const notes = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const note = (s) => { notes.push(s); console.log('NOTE ' + s) }

// Non-admin seats that exist locally (rbac.user_roles). EMPLOYEE is mandatory;
// the HR-type seats are exercised when present, skipped with a note otherwise.
const seatRows = sql(`SELECT c.email, r.code FROM auth.user_credentials c JOIN rbac.user_roles ur ON ur.user_id=c.id JOIN rbac.roles r ON r.id=ur.role_id WHERE c.tenant_id='${tenant}' AND c.is_active`)
  .split(/\r?\n/).filter(Boolean).map((l) => { const [email, role] = l.split('|'); return { email, role } })
const seatFor = (role) => seatRows.find((s) => s.role === role)
const seats = [{ email: 'reader@unifiedtree.demo', role: 'EMPLOYEE' }]
for (const role of ['HR_MANAGER', 'DEPT_MANAGER']) {
  const s = seatFor(role)
  if (s) seats.push(s); else note(`no local ${role} user in rbac.user_roles — ${role} view skipped`)
}

// Buttons the walk leaves alone: they decide, filter or toggle in place rather than open something.
const IN_PLACE = '^(Approve|Reject|Undo|Show|Hide|Take a break|End break|Earlier days|Later days)\\b'

const browser = await chromium.launch({ headless: true })
const summary = {}
try {
  for (const seat of seats) {
    const tag = seat.role
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    const pageErrors = [], failedApi = [], offPage = []
    // Tag every error with the SPA route it happened on: the button walk visits
    // other pages (attendance, leave, payslips…), and only /me is ours.
    const where = () => new URL(page.url()).pathname
    const push = (list, msg) => (where() === '/me' ? list : offPage).push(`${msg} @${where()}`)
    page.on('pageerror', (e) => push(pageErrors, String(e).split('\n')[0]))
    // The web punch dialog asks for the camera and location; a headless browser has neither.
    page.on('console', (m) => { if (m.type() === 'error' && !/getUserMedia|camera|NotAllowed|NotFound|geolocation/i.test(m.text())) push(pageErrors, 'console: ' + m.text().slice(0, 160)) })
    // ERR_ABORTED is a request cut short because the walk navigated away, not a failure.
    page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') push(pageErrors, `requestfailed ${r.failure()?.errorText} ${r.url().slice(0, 120)}`) })
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) push(failedApi, `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })

    await page.goto(base + '/login')
    await page.locator('input[type=email]').fill(seat.email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
    await page.waitForTimeout(1500)
    pageErrors.length = 0; failedApi.length = 0; offPage.length = 0

    const openHome = async () => {
      await page.goto(base + '/me')
      await page.getByRole('heading', { level: 1 }).filter({ hasText: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 30_000 })
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse'), null, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(800)
    }
    await openHome()
    check(`[${tag}] Home renders at /me`, true)
    // The Home page itself (PageFrame's region), not the shell around it (search, notifications).
    const root = page.getByRole('region', { name: 'Home', exact: true })
    const text = await root.innerText()
    check(`[${tag}] no hard-coded "Ionora"`, !/Ionora/.test(text))
    const sub = (await page.locator('header.uk-ph .uk-ph__sub').first().innerText().catch(() => '')).trim()
    check(`[${tag}] greeting line is built from real figures`,
      /^(Nothing needs you today\.|\d+ things? needs? you today\.|\d+h \d{2}m into your day, and .+\.|\d+ of \d+ people in your team are working, and .+\.)$/.test(sub), sub)
    check(`[${tag}] no "Data unavailable" tile`, !/Data unavailable/.test(text))
    check(`[${tag}] no "(N/A)" rows`, !/\(N\/A\)/.test(text))
    check(`[${tag}] no single-option chip <select>s`, (await root.locator('select').evaluateAll((els) => els.filter((e) => e.options.length <= 1).length)) === 0)
    check(`[${tag}] no static "Check milestones" placeholder`, !/Check milestones|Check probations list/.test(text))
    check(`[${tag}] real Upcoming events card mounted`, (await page.getByRole('heading', { name: 'Upcoming events' }).count()) === 1)
    check(`[${tag}] no "Upcoming milestones" wording left`, !/Upcoming milestones/i.test(text))
    const pcts = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    check(`[${tag}] no percentage above 100%`, pcts.every((p) => p <= 100), pcts.length ? `max ${Math.max(...pcts)}%` : 'no percentages shown')
    check(`[${tag}] no hard-coded "↓" direction arrow`, !text.includes('↓'))

    // Every visible Home button must do something: navigate or open a dialog / panel.
    // My attendance history and time entries below the Shortcuts card are P-ATT-DAY's own sections.
    const homeButtons = () => root.locator('button:visible').evaluateAll((els, inPlace) => {
      const re = new RegExp(inPlace, 'i')
      const heading = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent?.trim() === 'Shortcuts')
      const cut = heading?.closest('section') ?? null
      return els.map((el, i) => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
        const below = cut ? !cut.contains(el) && !!(cut.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : false
        const toggle = el.hasAttribute('aria-pressed') || ['tab', 'radio', 'switch', 'checkbox'].includes(el.getAttribute('role') || '') || !!el.closest('[role=radiogroup], [role=tablist]')
        return { i, label, skip: below || toggle || re.test(label) || el.disabled }
      })
    }, IN_PLACE)
    const first = await homeButtons()
    const toTest = first.filter((b) => !b.skip)
    note(`[${tag}] ${first.length - toTest.length} button(s) left alone (in-place actions, filters, toggles, sections below Shortcuts)`)
    const dead = []
    for (let k = 0; k < toTest.length; k++) {
      if (k > 0) await openHome()
      const b = (await homeButtons()).filter((x) => !x.skip)[k]
      if (!b) { dead.push(`(button ${k} gone after reload)`); continue }
      const before = page.url()
      await root.locator('button:visible').nth(b.i).click()
      await page.waitForTimeout(800)
      const moved = page.url() !== before
      const dialog = await page.getByRole('dialog').count()
      if (!moved && !dialog) dead.push(b.label)
      else if (k < 2) console.log(`  ${b.label.slice(0, 50)} → ${moved ? new URL(page.url()).pathname + new URL(page.url()).search : 'dialog'}`)
      if (dialog) await page.keyboard.press('Escape').catch(() => {})
    }
    check(`[${tag}] every visible Home button navigates or opens something (${toTest.length} tested)`, dead.length === 0, dead.join(' | '))

    // The month's "Open" (Home's way to My Attendance) → own attendance tab.
    await openHome()
    const myAtt = root.getByRole('button', { name: 'Open my attendance' })
    if (await myAtt.count()) {
      await myAtt.click()
      await page.waitForURL((u) => u.pathname === '/hrms/attendance', { timeout: 15_000 })
      check(`[${tag}] the month's "Open" goes to /hrms/attendance?tab=my`, new URL(page.url()).searchParams.get('tab') === 'my', page.url())
    } else {
      note(`[${tag}] no month calendar on this Home (managers see Today's team instead, or no attendance.checkin.self)`)
    }
    check(`[${tag}] no "Mark Attendance" dead button`, (await page.getByRole('button', { name: 'Mark Attendance' }).count()) === 0)

    mkdirSync('test-results/recovery', { recursive: true })
    await openHome()
    await page.screenshot({ path: `test-results/recovery/staff-home-${tag.toLowerCase()}.png`, fullPage: true })
    check(`[${tag}] no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    check(`[${tag}] no failed API calls from the page`, failedApi.length === 0, [...new Set(failedApi)].slice(0, 4).join(' | '))
    if (offPage.length) note(`[${tag}] ${offPage.length} error(s) on destination pages (not /me): ${[...new Set(offPage)].slice(0, 3).join(' | ')}`)
    summary[tag] = { email: seat.email, buttonsTested: toTest.length, pageErrors, failedApi, offPage }
    await ctx.close()
  }
} finally {
  await browser.close()
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-staff-dashboard.json', JSON.stringify({ ranAt: new Date().toISOString(), seats: summary, notes, checks }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
