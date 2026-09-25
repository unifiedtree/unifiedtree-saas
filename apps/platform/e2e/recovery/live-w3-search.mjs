// Global search (wave 3): the top bar searches people, pages and HR records;
// the old ⌘K palette stays as "Advanced search".
//
// API (GET /v1/search/global), per role:
//  - owner finds a person (link = Workforce Directory with the query), their
//    leave (link = their workspace Leave tab) and payslips (link = the run,
//    searched by code), and a document created by this test;
//  - the employee (reader@) finds only their own leave, payslips and documents,
//    never another person, another person's document, or admin records;
//  - the department manager finds their report's leave, not the directory;
//  - short queries are refused (400), anonymous calls are refused (401).
// Browser:
//  - owner types a name → People → Enter opens the directory filtered by it;
//    "payroll" lists the payroll pages; a payslip opens its run searched by
//    code; the test's document opens on the person's Documents tab;
//    keyboard ↑/↓/Esc; "Advanced search" (link and Ctrl K) opens the palette
//    with the text carried over;
//  - the employee sees no people and no admin pages;
//  - phone (390 wide): the header's search icon opens the search sheet.
// Everything it creates (two documents) is deleted at the end.
//
//   node e2e/recovery/live-w3-search.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3014'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const READER = '22222222-2222-2222-2222-222222222222'
const MANAGER = '44444444-4444-4444-4444-444444444444'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const search = (call, q) => call(`/v1/search/global?q=${encodeURIComponent(q)}`)
const group = (res, type) => (res.json?.groups || []).find((g) => g.type === type)?.items || []
const allItems = (res) => (res.json?.groups || []).flatMap((g) => g.items.map((i) => ({ ...i, group: g.type })))

const stamp = Date.now()
const token = `srchqa${stamp}`
const created = []
let owner

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

const browser = await chromium.launch()
const watched = []
try {
  owner = await login('owner@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')

  // ── test data: one document for the employee, one for the manager ──
  for (const [emp, who] of [[READER, 'reader'], [MANAGER, 'manager']]) {
    const r = await owner('/v1/document/documents', 'POST', { employeeId: emp, title: `${token} ${who} certificate`, category: 'CERTIFICATE', fileUrl: 'https://example.invalid/search-qa.pdf' })
    check(`setup: owner stores a test document for the ${who}`, r.status === 201 && !!r.json?.id, `status=${r.status}`)
    if (r.json?.id) created.push(r.json.id)
  }
  const [readerDoc, managerDoc] = created

  // ── API: owner ──
  const oPerson = await search(owner, 'reader')
  const person = group(oPerson, 'employee').find((i) => i.id === READER)
  check('api: owner finds the employee by name', oPerson.status === 200 && !!person, `status=${oPerson.status}`)
  check('api: the person links to the Workforce Directory with the query', person?.url === '/hrms/employees?q=reader', person?.url)
  const oLeave = group(oPerson, 'leave')
  check('api: owner finds the employee\'s leave, linked to their workspace Leave tab', oLeave.length > 0 && oLeave.every((i) => i.url === `/hrms/employees/${READER}?tab=leave`), oLeave.map((i) => i.url).join(', '))
  const oPay = group(oPerson, 'payslip')
  check('api: owner finds the employee\'s payslips, linked to the run searched by code', oPay.length > 0 && oPay.every((i) => /^\/hrms\/payroll\/runs\/[0-9a-f-]{36}\?tab=employees&q=EMP002$/.test(i.url)), oPay.map((i) => i.url).join(', '))
  const oDocs = await search(owner, token)
  const oDocIds = group(oDocs, 'document').map((i) => i.id)
  check('api: owner finds both test documents', created.length === 2 && created.every((id) => oDocIds.includes(id)), oDocIds.join(','))
  check('api: another person\'s document links to their workspace Documents tab', group(oDocs, 'document').find((i) => i.id === readerDoc)?.url === `/hrms/employees/${READER}?tab=documents`)
  check('api: typed words are data, not SQL (a quote finds nothing and does not fail)', (await search(owner, "x' or 1=1 --")).status === 200)

  // ── API: employee ──
  const rDocs = await search(reader, token)
  const rDocIds = group(rDocs, 'document').map((i) => i.id)
  check('api: employee finds their own document', rDocs.status === 200 && rDocIds.includes(readerDoc), `status=${rDocs.status}`)
  check('api: employee does NOT find the manager\'s document', !rDocIds.includes(managerDoc))
  check('api: employee\'s own document links to My documents', group(rDocs, 'document').find((i) => i.id === readerDoc)?.url === '/hrms/documents?view=my')
  const rOther = await search(reader, 'dept manager')
  check('api: employee finds no people (no directory access)', rOther.status === 200 && group(rOther, 'employee').length === 0)
  const rLeave = await search(reader, 'leave')
  check('api: employee finds their own leave requests only (My leave)', group(rLeave, 'leave').length > 0 && group(rLeave, 'leave').every((i) => i.url === '/hrms/leave?tab=my'), group(rLeave, 'leave').map((i) => i.url).join(', '))
  const rPay = await search(reader, 'payslips')
  check('api: employee finds their own payslips only (My payslips)', group(rPay, 'payslip').length > 0 && group(rPay, 'payslip').every((i) => i.url === '/me/payslips'), group(rPay, 'payslip').map((i) => i.url).join(', '))
  const rAny = [...allItems(rDocs), ...allItems(rOther), ...allItems(rLeave), ...allItems(rPay), ...allItems(await search(reader, 'manager')), ...allItems(await search(reader, 'EMP00'))]
  const leaks = rAny.filter((i) => /^\/hrms\/employees|^\/hrms\/payroll|^\/hrms\/hiring/.test(i.url) || ['employee', 'candidate', 'offer', 'job'].includes(i.group))
  check('api: employee never gets another person, admin payroll, or hiring results', leaks.length === 0, leaks.map((i) => `${i.group} ${i.url}`).slice(0, 3).join('; '))

  // ── API: department manager ──
  const mLeave = await search(mgr, 'reader leave')
  check('api: manager finds their report\'s leave (team scope)', group(mLeave, 'leave').some((i) => i.url === `/hrms/employees/${READER}?tab=leave`), group(mLeave, 'leave').map((i) => i.url).join(', '))
  check('api: manager finds no people (no directory access)', group(await search(mgr, 'reader'), 'employee').length === 0)
  check('api: manager does NOT find the employee\'s document (no document access)', !group(await search(mgr, token), 'document').some((i) => i.id === readerDoc))

  // ── API: refusals ──
  check('api: one-character query is refused (400)', (await search(owner, 'r')).status === 400)
  const anon = await fetch(`${api}/v1/search/global?q=reader`, { headers: { 'X-Tenant-ID': tenant } })
  check('api: anonymous call is refused (401)', anon.status === 401, `status=${anon.status}`)

  // ── Browser: owner, desktop ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const w = watch(page, 'owner'); watched.push(w)
  await signIn(page, 'owner@unifiedtree.demo')
  await page.goto(base + '/dashboard')
  const box = page.getByTestId('top-search-input')
  await box.waitFor({ timeout: 30_000 })
  await box.click()
  await box.fill('reader')
  await page.locator('[data-result-group="employee"]').waitFor({ timeout: 20_000 })
  check('ui: typing a name shows People', await page.locator('[data-result-group="employee"]').getByText('Reader User').first().isVisible())
  check('ui: the same search shows their leave and payslips', (await page.locator('[data-result-group="leave"]').count()) === 1 && (await page.locator('[data-result-group="payslip"]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/search-dropdown-1440.png` })
  // Keyboard: the first row is highlighted; ↓ moves; Esc closes.
  const selected = () => page.locator('#top-search-results [role=option][aria-selected=true]').getAttribute('id')
  const first = await selected()
  await box.press('ArrowDown')
  const second = await selected()
  await box.press('ArrowUp')
  check('ui: arrow keys move the highlight', first === 'tbs-row-0' && second === 'tbs-row-1' && (await selected()) === 'tbs-row-0', `${first} → ${second}`)
  await box.press('Escape')
  check('ui: Escape closes the results', (await page.getByTestId('top-search-results').count()) === 0)
  // Enter on the person opens the directory with the query in its search box.
  await box.fill('reader user')
  await page.locator('[data-result-group="employee"] [role=option]').first().waitFor({ timeout: 20_000 })
  const personRow = page.locator('[data-result-group="employee"] [role=option]').first()
  await personRow.hover()
  await box.press('Enter')
  await page.waitForURL((u) => u.pathname === '/hrms/employees', { timeout: 20_000 })
  const dirBox = page.locator('input[placeholder="Search name, code, email or role…"]')
  await dirBox.waitFor({ timeout: 30_000 })
  check('ui: the person opens the directory with the search prefilled', (await dirBox.inputValue()) === 'reader user', await dirBox.inputValue())
  check('ui: the directory is filtered to them', await page.getByText('EMP002').first().isVisible().catch(() => false))

  // A page by name.
  await box.click()
  await box.fill('payroll')
  await page.locator('[data-result-group="page"]').waitFor({ timeout: 10_000 })
  const pageTitles = await page.locator('[data-result-group="page"] [role=option]').allInnerTexts()
  check('ui: "payroll" lists the payroll pages', pageTitles.some((t) => /Payroll dashboard|Processing & Payslips/.test(t)), pageTitles.join(' | ').slice(0, 200))
  await page.screenshot({ path: `${SHOTS}/search-pages-1440.png` })
  await page.locator('[data-result-group="page"] [role=option]').filter({ hasText: 'Payroll dashboard' }).first().click()
  await page.waitForURL((u) => u.pathname === '/hrms/payroll-dashboard', { timeout: 20_000 })
  check('ui: choosing a page opens it', new URL(page.url()).pathname === '/hrms/payroll-dashboard')

  // A payslip opens its run with the search filled by employee code.
  await box.click()
  await box.fill('reader')
  await page.locator('[data-result-group="payslip"] [role=option]').first().waitFor({ timeout: 20_000 })
  await page.locator('[data-result-group="payslip"] [role=option]').first().click()
  await page.waitForURL((u) => /^\/hrms\/payroll\/runs\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 20_000 })
  const runBox = page.locator('input[placeholder="Find a person or EMP code…"]')
  const runOk = await runBox.waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check('ui: a payslip opens its payroll run, searched by the employee code', runOk && (await runBox.inputValue()) === 'EMP002', runOk ? await runBox.inputValue() : 'run page search not shown')

  // The test's document opens on the person's Documents tab.
  await box.click()
  await box.fill(token)
  await page.locator('[data-result-group="document"] [role=option]').first().waitFor({ timeout: 20_000 })
  await page.locator('[data-result-group="document"] [role=option]').filter({ hasText: `${token} reader certificate` }).click()
  await page.waitForURL((u) => u.pathname === `/hrms/employees/${READER}`, { timeout: 20_000 })
  check('ui: a document opens on the person\'s Documents tab', new URL(page.url()).searchParams.get('tab') === 'documents' && await page.getByText(`${token} reader certificate`).first().isVisible({ timeout: 20_000 }).catch(() => false))

  // Advanced search: from the link (text carried over) and from the shortcut.
  await box.click()
  await box.fill('leave')
  await page.getByTestId('top-search-advanced').click()
  const adv = page.getByRole('dialog', { name: 'Advanced search' })
  await adv.waitFor({ timeout: 10_000 })
  check('ui: "Advanced search" opens the palette with the text carried over', (await adv.locator('input[role=combobox]').inputValue()) === 'leave')
  await page.screenshot({ path: `${SHOTS}/search-advanced-1440.png` })
  await page.keyboard.press('Escape')
  await adv.waitFor({ state: 'detached', timeout: 10_000 })
  await page.keyboard.press('Control+k')
  check('ui: Ctrl K still opens Advanced search', await page.getByRole('dialog', { name: 'Advanced search' }).isVisible({ timeout: 10_000 }).catch(() => false))
  await page.keyboard.press('Escape')

  // Nothing found.
  await box.click()
  await box.fill('zzqxnomatch')
  const empty = await page.getByTestId('top-search-empty').waitFor({ timeout: 20_000 }).then(() => true, () => false)
  check('ui: a search with no results says so', empty)
  await page.screenshot({ path: `${SHOTS}/search-empty-1440.png` })
  await box.press('Escape')
  await ctx.close()

  // ── Browser: employee, desktop ──
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const rpage = await rctx.newPage()
  const rw = watch(rpage, 'reader'); watched.push(rw)
  await signIn(rpage, 'reader@unifiedtree.demo')
  const rbox = rpage.getByTestId('top-search-input')
  await rbox.waitFor({ timeout: 30_000 })
  await rbox.click()
  await rbox.fill('manager')
  await rpage.getByTestId('top-search-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await rpage.waitForTimeout(500)
  check('ui: the employee sees no people', (await rpage.locator('[data-result-group="employee"]').count()) === 0)
  await rbox.fill('payroll')
  await rpage.waitForTimeout(800)
  const rPages = await rpage.locator('[data-result-group="page"] [role=option]').allInnerTexts()
  check('ui: the employee is not offered admin payroll pages', !rPages.some((t) => /Payroll dashboard|Processing & Payslips|Salary structure/.test(t)), rPages.join(' | ').slice(0, 200))
  await rbox.fill('payslips')
  await rpage.locator('[data-result-group="payslip"]').waitFor({ timeout: 20_000 }).catch(() => {})
  check('ui: the employee finds their own payslips', (await rpage.locator('[data-result-group="payslip"] [role=option]').count()) > 0)
  await rpage.screenshot({ path: `${SHOTS}/search-employee-1440.png` })
  await rctx.close()

  // ── Browser: phone ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mpage = await mctx.newPage()
  const mw = watch(mpage, 'phone'); watched.push(mw)
  await signIn(mpage, 'owner@unifiedtree.demo')
  await mpage.goto(base + '/dashboard')
  await mpage.getByRole('button', { name: 'Search', exact: true }).first().click()
  const mbox = mpage.getByTestId('top-search-input')
  await mbox.waitFor({ timeout: 10_000 })
  await mbox.fill('reader')
  await mpage.locator('[data-result-group="employee"]').waitFor({ timeout: 20_000 })
  check('ui (phone): the search icon opens the search with results', await mpage.locator('[data-result-group="employee"]').isVisible())
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('ui (phone): no sideways scroll', overflow <= 0, `overflow=${overflow}`)
  await mpage.screenshot({ path: `${SHOTS}/search-sheet-390.png` })
  await mpage.getByRole('button', { name: 'Cancel' }).click()
  check('ui (phone): Cancel closes the search', (await mpage.getByTestId('top-search-input').count()) === 0)
  await mctx.close()

  const errors = watched.flatMap((x) => x.errors)
  check('ui: no page errors', errors.length === 0, errors[0] || '')
  const failed = watched.flatMap((x) => x.failed)
  const searchFailures = failed.filter((f) => f.includes('/v1/search'))
  check('ui: no search request failed', searchFailures.length === 0, searchFailures[0] || '')
  const serverErrors = failed.filter((f) => /: 5\d\d /.test(f))
  check('ui: no server errors (5xx) on the pages visited', serverErrors.length === 0, serverErrors.slice(0, 3).join('; '))
  if (failed.length) console.log('info: other API 4xx seen (pages\' own permission probes):', [...new Set(failed)].slice(0, 8).join('; '))
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  for (const id of created) {
    const r = await owner?.(`/v1/document/documents/${id}`, 'DELETE').catch(() => ({ status: 0 }))
    check(`cleanup: test document ${id.slice(0, 8)} deleted`, r?.status === 204, `status=${r?.status}`)
  }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
