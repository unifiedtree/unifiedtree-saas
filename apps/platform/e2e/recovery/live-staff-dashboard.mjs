// Staff Dashboard (/dashboard, RoleDashboard in HrmsDashboard.tsx) — browser
// acceptance against the local recovery runtime. Logs in through the UI as the
// EMPLOYEE seat and then the HR_MANAGER / DEPT_MANAGER seats (non-admin
// buckets), and checks: no hard-coded "Ionora", no "Data unavailable" /
// "(N/A)" tiles, no single-option <select> chips, every visible button on the
// page either navigates or opens something, KPI percentages never exceed 100%,
// the real Upcoming Milestones card is mounted, 0 page errors / failed API calls.
// Read-only: no DB fixtures are created.
//
// Run from apps/platform:  node e2e/recovery/live-staff-dashboard.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

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

const browser = await chromium.launch({ headless: true })
const summary = {}
try {
  for (const seat of seats) {
    const tag = seat.role
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    const pageErrors = [], failedApi = [], offPage = []
    // Tag every error with the SPA route it happened on: the button walk visits
    // other pages (attendance, leave, employees…), and only /dashboard is ours.
    const where = () => new URL(page.url()).pathname
    const push = (list, msg) => (where() === '/dashboard' ? list : offPage).push(`${msg} @${where()}`)
    page.on('pageerror', (e) => push(pageErrors, String(e).split('\n')[0]))
    page.on('console', (m) => { if (m.type() === 'error') push(pageErrors, 'console: ' + m.text().slice(0, 160)) })
    page.on('requestfailed', (r) => push(pageErrors, `requestfailed ${r.failure()?.errorText} ${r.url().slice(0, 120)}`))
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) push(failedApi, `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })

    await page.goto(base + '/login')
    await page.locator('input[type=email]').fill(seat.email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
    // Every sign-in currently produces two known 401→refresh(422) round trips
    // (HRMS_MODULE_ACTION_LEDGER.md, auth section). Measure the page, not the login.
    await page.waitForTimeout(1500)
    pageErrors.length = 0; failedApi.length = 0; offPage.length = 0

    const openDashboard = async () => {
      await page.goto(base + '/dashboard')
      await page.getByRole('heading', { level: 1 }).filter({ hasText: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 30_000 })
      // Let the KPI skeleton resolve and the cards settle.
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse'), null, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(800)
    }
    await openDashboard()
    check(`[${tag}] staff dashboard renders at /dashboard`, true)
    const root = page.getByRole('heading', { level: 1 }).locator('xpath=ancestor::div[contains(@class,"max-w-[1400px]")]').first()
    const text = await root.innerText()
    check(`[${tag}] no hard-coded "Ionora"`, !/Ionora/.test(text))
    const subtitle = (await root.locator('h1 + p').innerText()).trim()
    check(`[${tag}] subtitle names the real workspace`, /^Here's what's happening (at .+ )?today\.$/.test(subtitle), subtitle)
    check(`[${tag}] no "Data unavailable" tile`, !/Data unavailable/.test(text))
    check(`[${tag}] no "(N/A)" rows`, !/\(N\/A\)/.test(text))
    check(`[${tag}] no single-option chip <select>s`, (await root.locator('select').count()) === 0)
    check(`[${tag}] no static "Check milestones" placeholder`, !/Check milestones|Check probations list/.test(text))
    check(`[${tag}] real Upcoming Milestones card mounted`,
      (await root.locator('section[aria-label="Upcoming key dates"]').count()) === 1 &&
      /Upcoming Milestones|No birthdays in the next 14 days|Unable to load milestones/.test(await root.locator('section[aria-label="Upcoming key dates"]').innerText()))
    const pcts = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    check(`[${tag}] no percentage above 100%`, pcts.every((p) => p <= 100), pcts.length ? `max ${Math.max(...pcts)}%` : 'no percentages shown')
    check(`[${tag}] no hard-coded "↓" direction arrow`, !text.includes('↓'))

    // Every visible button must do something: navigate or open a dialog.
    // Milestone rows (inside UpcomingMilestones.tsx, outside this change) are
    // informational for seats without hrms.employee.read — see openIssues.
    const labels = await root.locator('button:visible').evaluateAll((els) => els.map((el) => ({
      label: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim(),
      inMilestones: !!el.closest('section[aria-label="Upcoming key dates"]') && !el.closest('table'),
    })))
    const toTest = labels.filter((l) => !l.inMilestones)
    const skipped = labels.length - toTest.length
    if (skipped) note(`[${tag}] ${skipped} milestone row button(s) not exercised (UpcomingMilestones.tsx)`)
    const dead = []
    for (let i = 0; i < toTest.length; i++) {
      if (i > 0) await openDashboard()
      const before = page.url()
      const btn = root.locator('button:visible').filter({ hasNotText: '___' })
      const all = await btn.evaluateAll((els) => els.map((el) => !!el.closest('section[aria-label="Upcoming key dates"]') && !el.closest('table')))
      const idx = all.reduce((acc, m, j) => (m ? acc : [...acc, j]), [])[i]
      await btn.nth(idx).click()
      await page.waitForTimeout(700)
      const moved = page.url() !== before
      const dialog = await page.getByRole('dialog').count()
      if (!moved && !dialog) dead.push(toTest[i].label)
      else if (i === 0 || /Attendance/.test(toTest[i].label)) console.log(`  ${toTest[i].label.slice(0, 50)} → ${new URL(page.url()).pathname}${new URL(page.url()).search}`)
    }
    check(`[${tag}] every visible dashboard button navigates or opens something (${toTest.length} tested)`, dead.length === 0, dead.join(' | '))

    // "My Attendance" (was the dead "Mark Attendance") → own attendance tab.
    await openDashboard()
    const myAtt = root.getByRole('button', { name: 'My Attendance' })
    if (await myAtt.count()) {
      await myAtt.click()
      await page.waitForURL((u) => u.pathname === '/hrms/attendance', { timeout: 15_000 })
      check(`[${tag}] "My Attendance" opens /hrms/attendance?tab=my`, new URL(page.url()).searchParams.get('tab') === 'my', page.url())
      await page.getByRole('heading', { name: 'Attendance', exact: true }).waitFor({ timeout: 15_000 })
    } else {
      note(`[${tag}] no attendance.checkin.self — "My Attendance" button hidden`)
    }
    check(`[${tag}] no "Mark Attendance" dead button`, (await page.getByRole('button', { name: 'Mark Attendance' }).count()) === 0)

    mkdirSync('test-results/recovery', { recursive: true })
    await openDashboard()
    await page.screenshot({ path: `test-results/recovery/staff-dashboard-${tag.toLowerCase()}.png`, fullPage: true })
    check(`[${tag}] no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    check(`[${tag}] no failed API calls from the page`, failedApi.length === 0, [...new Set(failedApi)].slice(0, 4).join(' | '))
    if (offPage.length) note(`[${tag}] ${offPage.length} error(s) on destination pages (not /dashboard): ${[...new Set(offPage)].slice(0, 3).join(' | ')}`)
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
