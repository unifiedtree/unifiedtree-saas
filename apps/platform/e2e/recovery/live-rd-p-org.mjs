/* global process, console, URL, fetch, document, localStorage */
// Live check for the org chart (P-ORG): GET /v1/hrms/org-chart and the page at /hrms/org-chart
// (route added by the lead) plus the "Org chart" sub-tab of Organization Setup (/hrms/master/org-chart).
//   API
//   - owner, hrm, fin (hrms.employee.read): the whole company tree; every status shows
//   - reader (EMPLOYEE, reports to mgr): mgr above and the line to the top, themself, their own reports; nobody unrelated;
//     a companyId is ignored; the status shows only on their own card
//   - mgr: reader below; reader's record open (direct report), people further down not
//   - canViewRecord agrees with GET /v1/hrms/employees/{id} (200 vs 403); unknown company 422; no token 401
//   UI
//   - owner: the tree in light and dark, you highlighted, search jumps to a person (opens the line above them)
//   - Organization Setup shows the Org chart sub-tab
//   - reader: only their line; a card they can't open shows the small card, their own opens My profile
//   - mgr: reader's card opens reader's profile
//   - 390: the indented list, no sideways scroll, light and dark; no page errors anywhere
// Read-only: creates nothing.
//
//   live-slot.sh /c/REACT/ut-wt/rd-p-org 3142 node e2e/recovery/live-rd-p-org.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3142'
const apiBase = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.RECOVERY_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const OWNER = '11111111-1111-1111-1111-111111111111', READER = '22222222-2222-2222-2222-222222222222'
const HRM = '33333333-3333-3333-3333-333333333333', MGR = '44444444-4444-4444-4444-444444444444', FIN = '55555555-5555-5555-5555-555555555555'
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
const ids = (c) => new Set(c.people.map((p) => p.id))
const byId = (c, id) => c.people.find((p) => p.id === id)

const browser = await chromium.launch()
async function session(email, { width = 1440, height = 900, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.waitForLoadState('networkidle').catch(() => {})
  for (let i = 0; i < 3; i++) {
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(password)
    if ((await page.locator('input[type=email]').inputValue()) === email) break
    await page.waitForTimeout(800)
  }
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page, ms = 1500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const shownIds = (page) => page.locator('[data-person]').evaluateAll((els) => els.map((e) => e.getAttribute('data-person')))
/** The card's box is inside the board's box. */
const onBoard = (page, id) => page.evaluate((pid) => {
  const v = document.querySelector('.uoc-view')?.getBoundingClientRect()
  const c = document.querySelector(`[data-card="${pid}"]`)?.getBoundingClientRect()
  return !!(v && c && c.left >= v.left - 1 && c.right <= v.right + 1 && c.top >= v.top - 1 && c.bottom <= v.bottom + 1)
}, id)

try {
  // ── API ─────────────────────────────────────────────────────────────────
  const api = { owner: await token('owner@unifiedtree.demo'), hrm: await token('hrm@unifiedtree.demo'), fin: await token('fin@unifiedtree.demo'), mgr: await token('mgr@unifiedtree.demo'), reader: await token('reader@unifiedtree.demo') }
  const all = await get(api.owner, `/v1/hrms/org-chart?companyId=${company}`)
  check('API owner: 200, the whole company', all.status === 200 && all.body.scope === 'COMPANY' && all.body.companyId === company, `${all.status} ${all.body?.scope}`)
  const everyone = all.body ? ids(all.body) : new Set()
  check('API owner: every demo person is on it', [OWNER, READER, HRM, MGR, FIN].every((id) => everyone.has(id)), `${everyone.size} people`)
  check('API owner: reader is drawn under mgr', byId(all.body, READER)?.parentId === MGR)
  check('API owner: every status shows and every record opens', all.body.people.every((p) => p.status && p.canViewRecord))
  check('API owner: only active people', all.body.people.every((p) => ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD', 'SUSPENDED'].includes(p.status)))
  check('API owner: parents come before their reports, each person once', (() => {
    const seen = new Set()
    for (const p of all.body.people) { if (p.parentId && !seen.has(p.parentId)) return false; if (seen.has(p.id)) return false; seen.add(p.id) }
    return true
  })())
  check('API owner: you are the owner\'s employee', all.body.viewerEmployeeId === OWNER)
  for (const who of ['hrm', 'fin']) {
    const c = await get(api[who], '/v1/hrms/org-chart')
    check(`API ${who}: the whole company (holds employee read)`, c.status === 200 && c.body.scope === 'COMPANY' && ids(c.body).size === everyone.size, `${c.body?.scope} ${c.body ? ids(c.body).size : ''}`)
  }

  const r = await get(api.reader, '/v1/hrms/org-chart')
  const rIds = r.body ? ids(r.body) : new Set()
  const readerReports = all.body.people.filter((p) => p.parentId === READER).map((p) => p.id)
  check('API reader: 200, their own line', r.status === 200 && r.body.scope === 'TEAM' && r.body.viewerEmployeeId === READER)
  check('API reader: mgr above (the top), reader under mgr', byId(r.body, MGR)?.relation === 'ABOVE' && byId(r.body, MGR)?.parentId === null && byId(r.body, READER)?.parentId === MGR && byId(r.body, READER)?.relation === 'SELF')
  check('API reader: their reports below them', readerReports.every((id) => byId(r.body, id)?.relation === 'BELOW'), `${readerReports.length} reports`)
  check('API reader: nobody unrelated', ![OWNER, HRM, FIN].some((id) => rIds.has(id)) && rIds.size === 2 + readerReports.length + all.body.people.filter((p) => readerReports.includes(p.parentId)).length, `${rIds.size} people`)
  check('API reader: status only on their own card', byId(r.body, READER)?.status != null && byId(r.body, MGR)?.status === null && readerReports.every((id) => byId(r.body, id)?.status === null))
  check('API reader: public fields kept for mgr', !!byId(r.body, MGR)?.name && byId(r.body, MGR)?.directReports >= 1)
  const rc = await get(api.reader, `/v1/hrms/org-chart?companyId=${company}`)
  check('API reader: a companyId does not widen it', rc.status === 200 && rc.body.scope === 'TEAM' && ids(rc.body).size === rIds.size)

  const m = await get(api.mgr, '/v1/hrms/org-chart')
  check('API mgr: their own line with reader below', m.status === 200 && m.body.scope === 'TEAM' && byId(m.body, READER)?.relation === 'BELOW' && byId(m.body, READER)?.parentId === MGR)
  check('API mgr: nobody unrelated', ![OWNER, HRM, FIN].some((id) => ids(m.body).has(id)))
  check('API mgr: reader\'s record opens (direct report), status shows', byId(m.body, READER)?.canViewRecord === true && byId(m.body, READER)?.status != null)
  if (readerReports.length) check('API mgr: further down does not open', readerReports.every((id) => byId(m.body, id)?.canViewRecord === false && byId(m.body, id)?.status === null))

  // canViewRecord agrees with the record endpoint.
  const recReaderMgr = await get(api.reader, `/v1/hrms/employees/${MGR}`)
  check('API reader: mgr\'s record is refused (403), as canViewRecord says', recReaderMgr.status === 403, String(recReaderMgr.status))
  const recMgrReader = await get(api.mgr, `/v1/hrms/employees/${READER}`)
  check('API mgr: reader\'s record opens (200), as canViewRecord says', recMgrReader.status === 200, String(recMgrReader.status))
  if (readerReports.length) {
    const deeper = await get(api.mgr, `/v1/hrms/employees/${readerReports[0]}`)
    check('API mgr: a skip-level record is refused (403), as canViewRecord says', deeper.status === 403, String(deeper.status))
  }
  const bad = await fetch(`${apiBase}/v1/hrms/org-chart?companyId=00000000-0000-0000-0000-00000000dead`, { headers: api.owner })
  check('API owner: a company outside the workspace is refused (422)', bad.status === 422, String(bad.status))
  const anon = await fetch(`${apiBase}/v1/hrms/org-chart`, { headers: { 'X-Tenant-ID': tenant } })
  check('API: no sign-in is refused (401)', anon.status === 401, String(anon.status))

  // ── UI: owner ───────────────────────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo', { theme })
    await page.goto(base + '/hrms/org-chart')
    await settle(page)
    const tag = `owner ${theme}`
    check(`${tag}: theme applied`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light')) === theme)
    check(`${tag}: title and real count in the sub-line`, (await page.locator('h1').first().textContent())?.trim() === 'Org chart' && (await page.locator('.uk-ph__sub').first().textContent()).includes(`${everyone.size} people`))
    const shown = await shownIds(page)
    check(`${tag}: cards drawn, all from the API`, shown.length > 1 && shown.every((id) => id === '__company__' || everyone.has(id)), `${shown.length} cards`)
    check(`${tag}: you are highlighted`, await page.locator(`.uoc-node.is-you [data-card="${OWNER}"]`).count() === 1)
    if (theme === 'light') {
      await page.screenshot({ path: `${shots}/p-org-owner-light-1440.png` })
      // Search jumps to a person and opens the line above them.
      await page.getByRole('combobox', { name: 'Search employee' }).fill('Reader User')
      await page.waitForTimeout(400)
      check(`${tag}: search lists the match`, await page.getByRole('option', { name: /Reader User/ }).count() >= 1)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1200)
      check(`${tag}: search jumps to the person (highlighted, on the board)`, await page.locator(`.uoc-node.is-found [data-card="${READER}"]`).count() === 1 && await onBoard(page, READER))
      check(`${tag}: their manager is shown above them`, await page.locator(`[data-card="${MGR}"]`).count() === 1)
      await page.screenshot({ path: `${shots}/p-org-owner-search-1440.png` })
      // Zoom and fit.
      const z0 = Number(await page.locator('.uoc-view').getAttribute('data-zoom'))
      await page.getByRole('button', { name: 'Zoom out' }).click(); await page.waitForTimeout(500)
      const z1 = Number(await page.locator('.uoc-view').getAttribute('data-zoom'))
      check(`${tag}: zoom out`, z1 < z0, `${z0}% → ${z1}%`)
      await page.getByRole('button', { name: 'Fit to screen' }).click(); await page.waitForTimeout(600)
      check(`${tag}: fit puts the top card on the board`, await page.evaluate(() => {
        const v = document.querySelector('.uoc-view').getBoundingClientRect(); const c = document.querySelector('[data-card]').getBoundingClientRect()
        return c.top >= v.top && c.bottom <= v.bottom
      }))
      // A count pill opens and closes a person's reports.
      const pill = page.locator(`[data-toggle="${MGR}"]`)
      const before = (await shownIds(page)).length
      await pill.click(); await page.waitForTimeout(400)
      const after = (await shownIds(page)).length
      check(`${tag}: the count pill hides and shows reports`, after < before && (await pill.getAttribute('aria-expanded')) === 'false', `${before} → ${after}`)
      await pill.click(); await page.waitForTimeout(300)
      // The list view.
      await page.getByRole('button', { name: 'List', exact: true }).click(); await page.waitForTimeout(400)
      check(`${tag}: list view lists the people`, await page.locator('.uoc-list [data-row]').count() > 1)
      await page.getByRole('button', { name: 'Chart', exact: true }).click(); await page.waitForTimeout(300)
      // Organization Setup sub-tab.
      await page.goto(base + '/hrms/master/org-chart'); await settle(page, 2000)
      const tabs = (await page.locator('.hero-tabs').allTextContents()).join(' ')
      check(`${tag}: Organization Setup has the Org chart sub-tab`, /Grades & Bands\s*Org chart/.test(tabs) && await page.locator('.uoc-view').count() === 1, tabs.slice(0, 120))
      await page.screenshot({ path: `${shots}/p-org-org-setup-tab-1440.png` })
    } else {
      await page.screenshot({ path: `${shots}/p-org-owner-dark-1440.png` })
    }
    check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    check(`${tag}: no refused or failed calls`, failed.length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── UI: reader ──────────────────────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page, errors, failed } = await session('reader@unifiedtree.demo', { theme })
    await page.goto(base + '/hrms/org-chart')
    await settle(page)
    const tag = `reader ${theme}`
    const shown = new Set(await shownIds(page))
    check(`${tag}: mgr above, reader, nobody unrelated`, shown.has(MGR) && shown.has(READER) && ![OWNER, HRM, FIN].some((id) => shown.has(id)) && [...shown].every((id) => rIds.has(id)), `${shown.size} cards`)
    check(`${tag}: reader is "you"`, await page.locator(`.uoc-node.is-you [data-card="${READER}"]`).count() === 1)
    check(`${tag}: the line from the top to you is drawn in brand`, await page.locator('.uoc-lines path.is-path').count() >= 1)
    await page.screenshot({ path: `${shots}/p-org-reader-${theme}-1440.png` })
    if (theme === 'light') {
      await page.locator(`[data-card="${MGR}"]`).click(); await page.waitForTimeout(500)
      const dlg = page.getByRole('dialog', { name: /Dept Manager/ })
      check(`${tag}: mgr's card (no access) opens the small card, not a profile`, await dlg.count() === 1 && new URL(page.url()).pathname === '/hrms/org-chart' && (await dlg.textContent()).includes('Direct reports'))
      await page.screenshot({ path: `${shots}/p-org-reader-card-1440.png` })
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      check(`${tag}: Escape closes it`, await page.getByRole('dialog', { name: /Dept Manager/ }).count() === 0)
      await page.locator(`[data-card="${READER}"]`).click()
      await page.waitForURL((u) => u.pathname === '/profile', { timeout: 15_000 }).catch(() => {})
      check(`${tag}: their own card opens My profile`, new URL(page.url()).pathname === '/profile', page.url().replace(base, ''))
    }
    check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    check(`${tag}: no refused or failed calls`, failed.filter((f) => f.includes('org-chart')).length === 0, failed.slice(0, 4).join(' | '))
    await ctx.close()
  }

  // ── UI: mgr ─────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await session('mgr@unifiedtree.demo')
    await page.goto(base + '/hrms/org-chart')
    await settle(page)
    const shown = new Set(await shownIds(page))
    check('mgr: reader below, nobody unrelated', shown.has(READER) && shown.has(MGR) && ![OWNER, HRM, FIN].some((id) => shown.has(id)))
    await page.screenshot({ path: `${shots}/p-org-mgr-light-1440.png` })
    await page.locator(`[data-card="${READER}"]`).click()
    await page.waitForURL((u) => u.pathname === `/hrms/employees/${READER}`, { timeout: 15_000 }).catch(() => {})
    check('mgr: reader\'s card opens reader\'s profile', new URL(page.url()).pathname === `/hrms/employees/${READER}`, page.url().replace(base, ''))
    check('mgr: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ── 390: the list ───────────────────────────────────────────────────────
  for (const [who, email] of [['owner', 'owner@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo']]) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page, errors } = await session(email, { width: 390, height: 844, theme })
      await page.goto(base + '/hrms/org-chart')
      await settle(page)
      const tag = `${who} 390 ${theme}`
      check(`${tag}: the indented list, no board`, await page.locator('.uoc-list [data-row]').count() > 1 && await page.locator('.uoc-view').count() === 0)
      const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.getElementById('workspace-content')?.scrollWidth || 0) - document.documentElement.clientWidth)
      check(`${tag}: no sideways scroll`, over <= 1, `overflow ${over}px`)
      if (who === 'owner' && theme === 'light') {
        await page.getByRole('combobox', { name: 'Search employee' }).fill('Reader User'); await page.waitForTimeout(400)
        await page.keyboard.press('Enter'); await page.waitForTimeout(900)
        check(`${tag}: search finds the row`, await page.locator(`.uoc-row.is-found[data-row="${READER}"]`).count() === 1)
      }
      await page.screenshot({ path: `${shots}/p-org-${who}-${theme}-390.png` })
      check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
      await ctx.close()
    }
  }
} catch (e) {
  check('run without a crash', false, String(e && e.stack || e).slice(0, 400))
} finally {
  await browser.close()
}

const failedChecks = results.filter((r) => !r.ok)
console.log(`\n${results.length - failedChecks.length}/${results.length} passed`)
process.exit(failedChecks.length ? 1 : 0)
