/* global process, console, fetch, URL, localStorage, document, window, setTimeout */
// Redesign F3b: the one search dialog and the notifications popover, per role.
//
// For owner, hrm, fin, mgr and reader (desktop, light; owner and reader also dark):
//  - Ctrl K opens the dialog; the empty dialog shows quick-action tiles, Jump to and the scope chips;
//  - typing a name shows People exactly when the server lets this person find people (compared
//    with GET /v1/search/global for the same person), and only record groups the server returned;
//  - the chips count what is listed; picking Pages shows only pages;
//  - "/" navigation: "/leave" lists pages under Leave, Tab completes, Enter opens one;
//  - Recent: a page opened from search is listed first next time;
//  - a person (where allowed): the preview's "Open profile" opens their profile;
//  - no page errors, no failed search request, no 5xx.
// Phone (390): the search icon opens the same dialog full screen (Cancel, tiles, results), no
// sideways scroll.
// Bell: the owner rejects a test document of the employee's (a real DOCUMENT_REJECTED notification);
// the employee's popover lists it with its module, "Last 7 days", and a click opens My documents.
// Cleanup: the notification and the document are deleted.
//
//   node e2e/recovery/live-rd-f3b-search.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3132'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const SHOTS = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const visible = (locator, timeout = 15_000) => locator.waitFor({ timeout }).then(() => true, () => false)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}

async function signIn(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/') && r.status() >= 400) failed.push(`${label}: ${r.status()} ${new URL(u).pathname}`)
  })
  return { errors, failed }
}
const dialog = (page) => page.getByRole('dialog', { name: 'Search' })
async function typeAndSettle(page, text) {
  const box = dialog(page).getByTestId('top-search-input')
  await box.fill(text)
  await page.waitForTimeout(350)
  await page.getByTestId('top-search-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(400)
  return box
}
const groupKeys = (page) => page.locator('#top-search-results [data-result-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-result-group')))
async function chipCount(page, label) {
  const t = (await dialog(page).getByRole('button', { name: new RegExp(`^${label}`) }).first().innerText()).replace(/\s+/g, ' ').trim()
  const m = t.match(/(\d+)\+?$/)
  return m ? Number(m[1]) : null
}

const ROLES = [
  { who: 'owner', email: 'owner@unifiedtree.demo', home: '/dashboard', dark: true },
  { who: 'hrm', email: 'hrm@unifiedtree.demo', home: '/dashboard' },
  { who: 'fin', email: 'fin@unifiedtree.demo', home: '/dashboard' },
  { who: 'mgr', email: 'mgr@unifiedtree.demo', home: '/me' },
  { who: 'reader', email: 'reader@unifiedtree.demo', home: '/me', dark: true },
]

const browser = await chromium.launch()
const watched = []
let owner, reader
const cleanup = { docs: [], notifs: [] }
try {
  owner = await login('owner@unifiedtree.demo')
  reader = await login('reader@unifiedtree.demo')

  for (const role of ROLES) {
    const call = await login(role.email)
    const apiReader = await call('/v1/search/global?q=reader')
    const apiTypes = (apiReader.json?.groups || []).map((g) => g.type)
    const apiPeople = (apiReader.json?.groups || []).find((g) => g.type === 'employee')?.items || []
    // Whether this person's own team view (GET /v1/attendance/dashboard) includes the employee: only then may search show their status.
    const teamDash = await call('/v1/attendance/dashboard')
    const teamHasReader = teamDash.status === 200 && (teamDash.json?.staffStatuses || []).some((s) => s.employeeId === READER)

    for (const theme of role.dark ? ['light', 'dark'] : ['light']) {
      const tag = `${role.who}${theme === 'dark' ? ' (dark)' : ''}`
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private window */ } }, theme)
      const page = await ctx.newPage()
      const w = watch(page, tag); watched.push(w)
      await signIn(page, role.email)
      await page.goto(base + role.home)
      await page.getByRole('button', { name: 'Search everything' }).waitFor({ timeout: 30_000 })
      if (theme === 'dark') check(`${tag}: the page is in dark mode`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')

      // Ctrl K and the empty dialog.
      await page.keyboard.press('Control+k')
      const opened = await visible(dialog(page), 10_000)
      check(`${tag}: Ctrl K opens the search dialog`, opened)
      const tiles = await dialog(page).locator('.ut-sd__tile').count()
      check(`${tag}: the empty dialog shows quick-action tiles (1–6)`, tiles >= 1 && tiles <= 6, `tiles=${tiles}`)
      check(`${tag}: the empty dialog shows Jump to`, (await page.locator('[data-result-group="jump"] [role=option]').count()) > 0)
      const chips = await dialog(page).getByRole('group', { name: 'Search in' }).getByRole('button').allInnerTexts()
      check(`${tag}: scope chips All · People · Pages · Actions`, ['All', 'People', 'Pages', 'Actions'].every((c, i) => chips[i]?.startsWith(c)), chips.join(' | '))
      check(`${tag}: the preview shows the highlighted row`, await visible(dialog(page).getByRole('complementary', { name: 'Preview' }), 5_000))
      await page.screenshot({ path: `${SHOTS}/rd-f3b-${role.who}-search-empty-${theme}-1440.png` })

      // A name: People exactly when the server lets this person find people.
      await typeAndSettle(page, 'reader')
      const keys = await groupKeys(page)
      check(`${tag}: People shows exactly when the server returns people (${apiPeople.length ? 'yes' : 'no'})`, keys.includes('employee') === apiPeople.length > 0, keys.join(','))
      const strays = keys.filter((k) => !['employee', 'page', 'action', 'filter', ...apiTypes].includes(k))
      check(`${tag}: only record groups the server returned are listed`, strays.length === 0, strays.join(','))
      const peopleChip = await chipCount(page, 'People')
      check(`${tag}: the People chip counts the people found`, peopleChip === apiPeople.length, `chip=${peopleChip} api=${apiPeople.length}`)
      const listed = await page.locator('#top-search-results [role=option]').count()
      const allChip = await chipCount(page, 'All')
      check(`${tag}: the All chip counts at least what is listed`, allChip != null && allChip >= listed, `all=${allChip} listed=${listed}`)
      await page.screenshot({ path: `${SHOTS}/rd-f3b-${role.who}-search-reader-${theme}-1440.png` })

      if (apiPeople.some((p) => p.id === READER)) {
        // The person's preview opens their profile.
        await page.locator(`#top-search-results [data-result-group="employee"] [role=option]`).filter({ hasText: 'Reader User' }).first().hover()
        const preview = dialog(page).getByRole('complementary', { name: 'Preview' })
        check(`${tag}: the person's preview shows their code`, await visible(preview.getByText('EMP002').first(), 5_000))
        // Step 2 (needs this branch's backend): the facts (BW-02) and, for people with the team view,
        // today's status from the team's own dashboard row.
        if (process.env.F3B_STEP2 === '1') {
          check(`${tag}: the preview shows who they report to and when they joined`, await visible(preview.getByText('Reports to'), 8_000) && await visible(preview.getByText('Joined'), 3_000))
          const st = preview.locator('.uk-pill').filter({ hasText: /today|Not marked yet|Working from home|Exited/ })
          const shown = await visible(st.first(), teamHasReader ? 8_000 : 3_000)
          check(`${tag}: today's status shows exactly when their team includes the person (${teamHasReader ? 'yes' : 'no'})`, shown === teamHasReader, shown ? await st.first().innerText() : 'none')
          check(`${tag}: the preview offers the org chart`, await visible(preview.getByRole('button', { name: 'View in org chart' }), 3_000))
          await page.screenshot({ path: `${SHOTS}/rd-f3b-${role.who}-search-person-${theme}-1440.png` })
        }
        await preview.getByRole('button', { name: /Open profile/ }).click()
        await page.waitForURL((u) => u.pathname === `/hrms/employees/${READER}`, { timeout: 20_000 }).catch(() => {})
        check(`${tag}: "Open profile" opens the person's profile`, new URL(page.url()).pathname === `/hrms/employees/${READER}`, page.url())
        check(`${tag}: the dialog closes when a result opens`, (await dialog(page).count()) === 0)
        await page.getByRole('button', { name: 'Search everything' }).click()
        await dialog(page).waitFor({ timeout: 10_000 })
      }

      // One scope at a time.
      await typeAndSettle(page, 'leave')
      await dialog(page).getByRole('button', { name: /^Pages/ }).click()
      await page.waitForTimeout(300)
      const pageOnly = await groupKeys(page)
      check(`${tag}: the Pages chip lists only pages`, pageOnly.length > 0 && pageOnly.every((k) => k === 'page'), pageOnly.join(','))
      await dialog(page).getByRole('button', { name: /^All/ }).click()

      // "/" navigation: Tab completes, Enter opens.
      const box = await typeAndSettle(page, '/leave')
      const goto = page.locator('[data-result-group="goto"] [role=option]')
      check(`${tag}: "/leave" lists pages to go to`, (await goto.count()) > 0)
      await box.press('Tab')
      const completed = await box.inputValue()
      check(`${tag}: Tab completes the path`, completed.startsWith('/') && completed.length >= '/leave'.length, completed)
      await page.waitForTimeout(300)
      const target = (await goto.first().innerText()).split('\n')[0].trim()
      const before = page.url()
      await box.press('Enter')
      await page.waitForURL((u) => u.href !== before, { timeout: 20_000 }).catch(() => {})
      check(`${tag}: Enter opens the page`, page.url() !== before && (await dialog(page).count()) === 0, `${target} → ${new URL(page.url()).pathname}${new URL(page.url()).search}`)

      // Recent remembers it.
      await page.keyboard.press('Control+k')
      await dialog(page).waitFor({ timeout: 10_000 })
      const recent = page.locator('[data-result-group="recent"] [role=option]')
      check(`${tag}: Recent lists the page just opened`, (await recent.count()) > 0 && (await recent.first().innerText()).includes(target), target)
      await page.keyboard.press('Escape')
      check(`${tag}: Escape closes the dialog`, await dialog(page).waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false))
      await ctx.close()
    }
  }

  // ── Phone ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mpage = await mctx.newPage()
  const mw = watch(mpage, 'phone'); watched.push(mw)
  await signIn(mpage, 'reader@unifiedtree.demo')
  await mpage.goto(base + '/me')
  await mpage.getByRole('button', { name: 'Search', exact: true }).first().click()
  const sheet = dialog(mpage)
  check('phone: the search icon opens the dialog', await visible(sheet, 10_000))
  const box = await sheet.boundingBox()
  check('phone: the dialog fills the screen', !!box && box.width >= 388 && box.x <= 1, JSON.stringify(box))
  check('phone: quick-action tiles show', (await sheet.locator('.ut-sd__tile').count()) > 0)
  await mpage.screenshot({ path: `${SHOTS}/rd-f3b-reader-search-empty-light-390.png` })
  await typeAndSettle(mpage, 'leave')
  check('phone: results show', (await mpage.locator('#top-search-results [role=option]').count()) > 0)
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('phone: no sideways scroll', overflow <= 0, `overflow=${overflow}`)
  await mpage.screenshot({ path: `${SHOTS}/rd-f3b-reader-search-leave-light-390.png` })
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  check('phone: Cancel closes it', (await sheet.count()) === 0)
  await mctx.close()

  // ── Bell: a real notification for the employee ──
  const stamp = `f3bqa${Date.now()}`
  const doc = await owner('/v1/document/documents', 'POST', { employeeId: READER, title: `${stamp} certificate`, category: 'CERTIFICATE', fileUrl: 'https://example.invalid/f3b.pdf' })
  check('bell setup: owner stores a test document for the employee', doc.status === 201 && !!doc.json?.id, `status=${doc.status}`)
  if (doc.json?.id) cleanup.docs.push(doc.json.id)
  const rej = await owner(`/v1/document/documents/${doc.json?.id}/reject`, 'POST', { reason: `Blurry ${stamp}` })
  check('bell setup: owner rejects it (sends DOCUMENT_REJECTED)', rej.status === 200, `status=${rej.status}`)
  let notif = null
  for (let i = 0; i < 20 && !notif; i++) {
    const list = await reader('/v1/notifications?page=0&size=50')
    notif = (list.json?.content || []).find((n) => (n.body || '').includes(stamp))
    if (!notif) await new Promise((r) => setTimeout(r, 500))
  }
  check('bell setup: the employee received it', !!notif && notif.type === 'DOCUMENT_REJECTED', notif?.type || 'none')
  if (notif) cleanup.notifs.push(notif.id)

  for (const theme of ['light', 'dark']) {
    const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await bctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private window */ } }, theme)
    const bpage = await bctx.newPage()
    const bw = watch(bpage, `bell ${theme}`); watched.push(bw)
    await signIn(bpage, 'reader@unifiedtree.demo')
    await bpage.goto(base + '/me')
    const bell = bpage.getByRole('button', { name: /^Notifications/ })
    await bell.waitFor({ timeout: 30_000 })
    check(`bell (${theme}): the bell shows the unread count`, /unread/.test((await bell.getAttribute('aria-label')) || ''), await bell.getAttribute('aria-label'))
    await bell.click()
    const pop = bpage.getByRole('dialog', { name: 'Notifications' })
    await pop.waitFor({ timeout: 10_000 })
    const row = pop.locator('.ut-bellpop__row').filter({ hasText: stamp })
    const shown = await visible(row, 15_000)
    check(`bell (${theme}): the popover lists the real notification`, shown)
    check(`bell (${theme}): the row shows its module and when`, shown && /Documents · (now|\d+ min ago)/.test(await row.innerText()), shown ? (await row.innerText()).replace(/\s+/g, ' ') : '')
    check(`bell (${theme}): the popover says "Last 7 days"`, await visible(pop.getByText('Last 7 days'), 3_000))
    check(`bell (${theme}): the popover says how many are new`, await visible(pop.getByText(/\d+ new|All caught up/), 3_000))
    await bpage.screenshot({ path: `${SHOTS}/rd-f3b-reader-bell-${theme}-1440.png` })
    if (theme === 'dark' && shown) {
      await row.click()
      await bpage.waitForURL((u) => u.pathname === '/hrms/documents', { timeout: 20_000 }).catch(() => {})
      check('bell: clicking it opens My documents', new URL(bpage.url()).pathname === '/hrms/documents' && bpage.url().includes('view=my'), bpage.url())
      const after = await reader('/v1/notifications?page=0&size=50')
      check('bell: clicking it marks it read', !!(after.json?.content || []).find((n) => n.id === notif?.id)?.readAt)
    } else {
      await bpage.keyboard.press('Escape')
      check(`bell (${theme}): Escape closes the popover`, await pop.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false))
    }
    await bctx.close()
  }

  const errors = watched.flatMap((x) => x.errors)
  check('no page errors', errors.length === 0, errors[0] || '')
  const failed = watched.flatMap((x) => x.failed)
  const searchFailures = failed.filter((f) => /\/v1\/(search|notifications)/.test(f))
  check('no search or notification request failed', searchFailures.length === 0, searchFailures[0] || '')
  const serverErrors = failed.filter((f) => /: 5\d\d /.test(f))
  check('no server errors (5xx)', serverErrors.length === 0, serverErrors.slice(0, 3).join('; '))
  if (failed.length) console.log('info: other API 4xx seen (pages\' own permission probes):', [...new Set(failed)].slice(0, 8).join('; '))
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 1500))
} finally {
  await browser.close()
  for (const id of cleanup.notifs) {
    const r = await reader?.(`/v1/notifications/${id}`, 'DELETE').catch(() => ({ status: 0 }))
    check(`cleanup: test notification ${id.slice(0, 8)} deleted`, r?.status >= 200 && r?.status < 300, `status=${r?.status}`)
  }
  for (const id of cleanup.docs) {
    const r = await owner?.(`/v1/document/documents/${id}`, 'DELETE').catch(() => ({ status: 0 }))
    check(`cleanup: test document ${id.slice(0, 8)} deleted`, r?.status === 204, `status=${r?.status}`)
  }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
