/* global process, console, URL, fetch, document, localStorage */
// Live check for the redesigned admin dashboard (P-DASH, Release 1: frontend only on today's backend).
//   - owner, hrm and fin open /dashboard: the section pills sit in the top bar, every card shows real data
//     (compared with the API), nothing is refused, no page errors, light and dark, and no sideways scroll at 390
//   - mgr and reader are sent to their own Home (/me), the shell's Home rule
//   - a past ?date= asks every card for that day and says so
//   - the notice panel: publish, open, edit, archive (with the confirmation) — removes what it creates
//   - quick actions follow their target page's permission; probation dialogs open and cancel (no change)
//
//   RECOVERY_APP_URL=http://demo.localhost:3131 RECOVERY_API_URL=http://127.0.0.1:8070/api node e2e/recovery/live-rd-p-dash.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const apiBase = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.RECOVERY_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const PAST = '2026-09-22', PAST_LABEL = '22 Sep 2026'
mkdirSync(shots, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function token(email) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
  const r = await fetch(`${apiBase}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const get = async (h, path) => { const r = await fetch(apiBase + path, { headers: h }); return { status: r.status, body: r.ok ? await r.json() : null } }
const del = async (h, path) => (await fetch(apiBase + path, { method: 'DELETE', headers: h })).status

const browser = await chromium.launch()
const created = [] // notice titles this run created (archived in finally if still up)

async function session(email, { width = 1440, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = [], calls = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  page.on('request', (r) => { if (r.url().includes('/api/v1/')) calls.push(r.url().split('/api')[1]) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed, calls }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500) }
const norm = (t) => (t || '').replace(/\s+/g, ' ').trim()

let ownerApi = null
try {
  ownerApi = await token('owner@unifiedtree.demo')

  // ── owner, hrm, fin: real data, pills, no refused calls, both themes ─────────
  for (const who of ['owner', 'hrm', 'fin']) {
    const api = who === 'owner' ? ownerApi : await token(`${who}@unifiedtree.demo`)
    for (const theme of ['light', 'dark']) {
      const { ctx, page, errors, failed } = await session(`${who}@unifiedtree.demo`, { theme })
      await page.goto(base + '/dashboard')
      await settle(page)
      const tag = `${who} ${theme}`
      check(`${tag}: stays on /dashboard (admin Home)`, new URL(page.url()).pathname === '/dashboard', page.url().replace(base, ''))
      check(`${tag}: theme applied`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light')) === theme)
      const h1 = norm(await page.locator('h1').first().textContent().catch(() => ''))
      check(`${tag}: greeting`, /^Good (morning|afternoon|evening), \S/.test(h1), h1)
      const nav = page.getByRole('navigation', { name: 'Dashboard sections' })
      const pills = (await nav.getByRole('button').allTextContents()).map(norm)
      // Release 1.1 (DECISIONS 21): a page's own views sit inside the page, under the module's top tabs.
      const inPage = (await nav.count()) > 0 && await nav.evaluate((n) => !!n.closest('#workspace-content'))
      check(`${tag}: section pills inside the page`, pills[0] === 'Overview' && pills.length >= 3 && inPage, pills.join(' | '))
      // Each pill has its section; each section has its pill.
      const secs = await page.locator('[data-sec]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
      check(`${tag}: one pill per visible section`, secs.length === pills.length, `${secs.join(',')} vs ${pills.join(',')}`)

      if (theme === 'light') {
        // Total employees: the roster and the company's active count from the API.
        const stats = await get(api, `/v1/admin/dashboard/stats?companyId=${company}`)
        const team = await get(api, `/v1/attendance/dashboard?date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}`)
        const card = page.getByRole('button', { name: /^\s*Total employees/i }).first()
        const value = norm(await card.locator('.uk-stat__value').textContent().catch(() => ''))
        const note = norm(await card.locator('.uk-stat__note').textContent().catch(() => ''))
        const roster = team.status === 200 ? team.body.staffStatuses.length : null
        check(`${tag}: Total employees = the day's roster, note = active employees`, roster != null && value === String(roster) && (stats.status !== 200 || note.startsWith(`${stats.body.activeEmployees} active`)), `${value} | ${note}`)
        // Notices: the count line is the API's total.
        const notices = await get(api, `/v1/admin/dashboard/notices?companyId=${company}&page=0&size=5`)
        if (stats.status === 200) {
          const want = notices.body.totalElements ? `${notices.body.totalElements} active` : 'None active'
          check(`${tag}: notices count = the API's`, (await page.locator('#ud-notices-title').locator('xpath=..').textContent()).includes(want), want)
        }
        // Needs your action: the leave tile counts leave + WFH waiting (the same lists as the rows).
        const leaveTile = page.getByRole('group', { name: 'Filter the items' }).getByRole('button', { name: /Leave approvals/ })
        if (await leaveTile.count()) {
          const l = await get(api, '/v1/leave/approvals/pending?page=0&size=20')
          const w = await get(api, '/v1/wfh/pending-approvals?page=0&size=20')
          const n = (l.body?.totalElements ?? 0) + (w.status === 200 ? w.body.totalElements : 0)
          const shown = norm(await leaveTile.locator('.ud-tile__n').textContent())
          check(`${tag}: Leave approvals tile = pending leave + WFH`, shown === String(n), `tile ${shown}, api ${n}`)
        }
        // Seats (billing managers): used / total from the API.
        if (await page.getByText('Seats used', { exact: true }).count()) {
          const s = await get(api, '/v1/workspace/seats/usage')
          check(`${tag}: seats line = the API's`, norm(await page.locator('.ud-seats__n').textContent()) === `${s.body.current} / ${s.body.purchased}`)
        }
        // Quick actions follow the target pages.
        const qa = (await page.getByRole('group', { name: 'Quick actions' }).getByRole('button').allTextContents()).map(norm)
        if (who === 'owner') check('owner: no Add time-off (the Leave page hides Apply for admin roles); Org setup shown', !qa.some((t) => t.startsWith('Add time-off')) && qa.some((t) => t.startsWith('Org setup')), qa.join(' | '))
        if (who === 'fin') check('fin: no Org setup (no organisation permission); Run payroll shown', !qa.some((t) => t.startsWith('Org setup')) && qa.some((t) => t.startsWith('Run payroll')), qa.join(' | '))
        // A pill jumps to its section.
        const last = pills[pills.length - 1]
        await nav.getByRole('button', { name: last }).click()
        await page.waitForTimeout(1300)
        check(`${tag}: a pill scrolls to its section and lights`, (await nav.getByRole('button', { name: last }).getAttribute('aria-current')) === 'location' && page.url().includes('#'), page.url().replace(base, ''))
        await page.screenshot({ path: `${shots}/rd-p-dash-live-${who}-1440.png` })
      }
      check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
      check(`${tag}: no refused or failed calls`, failed.length === 0, failed.slice(0, 4).join(' | '))
      await ctx.close()
    }
  }

  // ── owner at 390 in both themes: no sideways scroll ─────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page, errors } = await session('owner@unifiedtree.demo', { width: 390, theme })
    await page.goto(base + '/dashboard')
    await settle(page)
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.getElementById('workspace-content')?.scrollWidth || 0) - document.documentElement.clientWidth)
    check(`owner 390 ${theme}: no sideways scroll`, over <= 1, `overflow ${over}px`)
    check(`owner 390 ${theme}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ── mgr and reader: their own Home ──────────────────────────────────────────
  for (const who of ['mgr', 'reader']) {
    const { ctx, page, failed } = await session(`${who}@unifiedtree.demo`)
    await page.goto(base + '/dashboard')
    await page.waitForURL((u) => u.pathname === '/me', { timeout: 20000 }).catch(() => {})
    check(`${who}: /dashboard sends them to /me`, new URL(page.url()).pathname === '/me', page.url().replace(base, ''))
    check(`${who}: no admin dashboard calls`, !failed.some((f) => f.includes('/admin/dashboard')), failed.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // ── a past date ─────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors, failed, calls } = await session('owner@unifiedtree.demo')
    calls.length = 0
    await page.goto(`${base}/dashboard?date=${PAST}`)
    await settle(page)
    check(`${PAST}: banner names the day`, (await page.getByRole('status').filter({ hasText: `Viewing Tue, ${PAST_LABEL}` }).count()) > 0)
    check(`${PAST}: the date chip says Viewing`, (await page.getByRole('button', { name: /^Viewing Tue, 22 Sep 2026/ }).count()) > 0)
    check(`${PAST}: weekly trend ends on the day`, (await page.getByText(`7 days to ${PAST_LABEL} · IST`).count()) > 0)
    check(`${PAST}: activity is up to the day`, (await page.getByText(`Activity up to ${PAST_LABEL}`).count()) > 0)
    check(`${PAST}: attendance card names the day`, (await page.getByText('Attendance on Tue, 22 Sep').count()) > 0)
    check(`${PAST}: seats say As of today`, (await page.getByText('Seats used', { exact: true }).count()) === 0 || (await page.getByText('As of today').count()) > 0)
    check(`${PAST}: no Add notice in the past`, (await page.getByRole('button', { name: 'Add notice' }).count()) === 0)
    const want = ['/v1/admin/dashboard/stats', '/v1/admin/dashboard/alerts', '/v1/admin/dashboard/notices', '/v1/probation/upcoming', '/v1/hrms/projects']
    const missing = want.filter((p) => !calls.some((c) => c.startsWith(p) && c.includes(`date=${PAST}`)))
    check(`${PAST}: the cards ask for that day`, missing.length === 0 && calls.some((c) => c.startsWith(`/v1/attendance/dashboard?date=${PAST}&includeLeavers=true`)), missing.join(', '))
    // Clicking a day in the weekly chart loads it.
    await page.getByRole('button', { name: /^Mon, 21 Sep 2026: .* Load this day/ }).click().catch(() => {})
    await page.waitForTimeout(800)
    const monOff = await page.getByText('Mon 21').count()
    check('clicking a day in the weekly chart loads it (or it is an Off day)', page.url().includes('date=2026-09-21') || monOff > 0, page.url().replace(base, ''))
    await page.getByRole('button', { name: 'Back to today' }).click()
    await page.waitForTimeout(600)
    check('Back to today drops the date', !page.url().includes('date='), page.url().replace(base, ''))
    check('past date: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('past date: no failed calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── notices: publish, open, edit, archive ───────────────────────────────────
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/dashboard')
    await settle(page)
    const title = `P-DASH notice ${Date.now()}`
    created.push(title)
    await page.getByRole('button', { name: 'Add notice' }).click()
    const form = page.getByRole('dialog', { name: 'New notice' })
    await form.getByLabel('Notice title').fill(title)
    await form.getByLabel('Notice message').fill('Created by the P-DASH live check; archived straight away.')
    await form.getByRole('button', { name: 'Save notice' }).click()
    const chip = page.getByRole('button', { name: new RegExp(`^${title}\\.`) })
    check('notice: publishes and shows as a chip', await chip.waitFor({ timeout: 10000 }).then(() => true, () => false))
    await chip.click()
    const panel = page.getByRole('dialog', { name: title })
    check('notice: the chip opens the notice panel with its text', (await panel.getByText('Created by the P-DASH live check').count()) > 0)
    await panel.getByRole('button', { name: 'Edit notice' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit notice' })
    await edit.getByLabel('Notice message').fill('Edited by the P-DASH live check.')
    await edit.getByRole('button', { name: 'Save notice' }).click()
    await page.waitForTimeout(800)
    await chip.click()
    check('notice: edit is saved', (await page.getByRole('dialog', { name: title }).getByText('Edited by the P-DASH live check.').count()) > 0)
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Archive notice' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Archive', exact: true }).click()
    await chip.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    check('notice: archive (after the confirmation) removes it', (await chip.count()) === 0)
    if ((await chip.count()) === 0) created.pop()
    // Probation dialogs open and cancel (no data change).
    const extend = page.getByRole('button', { name: /^Extend .*probation$/ }).first()
    if (await extend.count()) {
      await extend.click()
      const dlg = page.getByRole('dialog', { name: 'Extend probation' })
      check('probation: Extend asks for the new end date', (await dlg.getByText('New end date').count()) > 0)
      await dlg.getByRole('button', { name: 'Cancel' }).click()
    } else console.log('NOTE  probation: nobody ends in the next 30 days here, so Extend / Confirm are not on screen')
    // The projects drawer.
    await page.getByRole('button', { name: /Manage projects/ }).click()
    check('Manage projects opens the projects panel', await page.getByRole('dialog', { name: 'Projects & Productivity' }).waitFor({ timeout: 8000 }).then(() => true, () => false))
    await page.keyboard.press('Escape')
    check('notices/projects: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    check('notices/projects: no failed calls', failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }
} catch (e) {
  check('script completed', false, String(e.stack || e).split(/\r?\n/).slice(0, 3).join(' | '))
} finally {
  // Archive anything this run created and left behind.
  try {
    if (created.length && ownerApi) {
      const list = await get(ownerApi, `/v1/admin/dashboard/notices?companyId=${company}&page=0&size=50`)
      for (const n of list.body?.content ?? []) if (created.includes(n.title)) await del(ownerApi, `/v1/admin/dashboard/notices/${n.id}`)
    }
  } catch (e) { console.log('cleanup:', String(e)) }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
