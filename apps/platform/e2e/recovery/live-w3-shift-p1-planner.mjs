/* global process, console, fetch */
// Live check (shift planning Phase 1, package D — the web planner): as the owner, plan a roster through the wizard,
// set a staffing number, generate, edit two cells and see coverage follow, save the draft, publish it with its
// warnings ticked, and read it back. Captures page errors and API 4xx/5xx on the way.
//
// Needs the backend packages (shift/p1-store + shift/p1-engine) in the jar. Removes everything it creates: the roster
// (and through it its members, staffing, cells), its published schedule days and their history, and the
// "schedule ready" notifications the publish sent.
//
//   live-slot.sh /c/REACT/ut-wt/shift-p1-web 3031 env RECOVERY_DB=ut_w3_dev node e2e/recovery/live-w3-shift-p1-planner.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3031'
const apiBase = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const shots = process.env.RECOVERY_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

async function token(email) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
  const r = await fetch(`${apiBase}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}

mkdirSync(shots, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = [], apiErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api/, '')}`) })
const preview = () => page.waitForResponse((r) => r.url().includes('/v1/rosters/preview') && r.request().method() === 'POST', { timeout: 30000 })
const coverageText = () => page.locator('tbody.spl-cov').innerText().catch(() => '')
let rosterId = null

try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 })

  // ── The tab ──
  await page.goto(base + '/hrms/shifts?tab=planner')
  await page.getByRole('button', { name: 'Plan a roster' }).waitFor({ timeout: 30000 })
  check('the Shift Planner tab shows Plan a roster and Import from Excel', await page.getByRole('button', { name: 'Import from Excel' }).isVisible())
  await page.screenshot({ path: `${shots}/shift-p1-live-tab.png` })

  // ── The wizard ──
  await page.getByRole('button', { name: 'Plan a roster' }).click()
  await page.waitForURL(/\/hrms\/shifts\/planner\/new/)
  await page.getByRole('button', { name: /Rotation pattern/ }).click()
  await page.getByRole('button', { name: 'Build a pattern' }).click()
  const days = await page.locator('.spl-pattern__day select').count()
  check('the pattern builder starts a pattern of days', days >= 2, `${days} days`)
  const firstGen = preview()
  await page.getByRole('button', { name: 'Generate schedule' }).first().click()
  const gen = await firstGen
  check('Generate asks the preview to lay the pattern', gen.status() === 200 && JSON.parse(gen.request().postData() || '{}').regenerate === true, `${gen.status()}`)
  await page.locator('td.spl-cell[data-r="0"] .spl-cell__code').first().filter({ hasText: /\S/ }).waitFor({ timeout: 15000 }).catch(() => {})
  const coded = await page.locator('td.spl-cell .spl-cell__code').filter({ hasText: /\S/ }).count()
  check('the grid shows the generated codes', coded > 0, `${coded} cells with a code`)

  // A requirement on the first person's designation and today's shift, so coverage has numbers to change.
  const todayIdx = Number(istToday().slice(8, 10)) - 1
  const cellA = page.locator(`td.spl-cell[data-r="0"][data-c="${todayIdx}"]`)
  const code = (await cellA.locator('.spl-cell__code').innerText()).trim()
  const designation = (await page.locator('tr.spl-grid__row').first().locator('.spl-grid__meta').innerText()).split('·').pop().trim()
  if (code && code !== 'WO' && designation && designation !== 'No designation') {
    await page.getByRole('button', { name: /Staffing/ }).click()
    const staffed = preview()
    await page.getByLabel(`${designation} on ${code}`).fill('1')
    await staffed
  }
  const before = await coverageText()
  const edited = preview()
  await cellA.click()
  await page.getByRole('dialog', { name: 'Choose a shift' }).getByRole('button', { name: /Weekly off/ }).click()
  check('a cell edit paints at once', (await cellA.locator('.spl-cell__code').innerText()).trim() === 'WO')
  const editRes = await edited
  check('a cell edit refreshes the preview without laying the pattern again', editRes.status() === 200 && JSON.parse(editRes.request().postData() || '{}').regenerate === false)
  await page.waitForTimeout(400)
  const after = await coverageText()
  check('coverage follows the edit', !before || before !== after, before ? '' : 'no staffing requirement on that shift; skipped')
  const cellB = page.locator(`td.spl-cell[data-r="1"][data-c="${todayIdx}"]`)
  await cellB.click()
  await page.getByRole('dialog', { name: 'Choose a shift' }).locator('.spl-picker__opt').first().click()
  check('a second cell edit is marked as edited', await cellB.locator('.spl-cell__dot').count() === 1)
  await page.screenshot({ path: `${shots}/shift-p1-live-planner.png` })

  // ── Save the draft ──
  const created = page.waitForResponse((r) => /\/v1\/rosters\?companyId=/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 })
  await page.getByRole('button', { name: 'Save draft' }).click()
  const cr = await created
  rosterId = cr.ok() ? (await cr.json()).roster?.id ?? null : null
  check('Save draft creates the roster', cr.status() === 201 || cr.status() === 200, `${cr.status()} ${rosterId}`)
  await page.waitForURL(UUID, { timeout: 15000 }).catch(() => {})
  check('the address becomes the roster’s own', page.url().includes(`/hrms/shifts/planner/${rosterId}`))

  // ── Publish with its warnings ticked ──
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Publish roster/ })
  await dialog.waitFor({ timeout: 15000 })
  await dialog.getByText('Checking the roster…').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  check('the publish dialog says the roster is information only for now', await dialog.getByText('Until rosters drive attendance for the company').isVisible())
  const ack = dialog.getByRole('checkbox', { name: /Publish with \d+ warning/ })
  if (await ack.count()) await ack.check()
  const published = page.waitForResponse((r) => r.url().includes(`/v1/rosters/${rosterId}/publish`), { timeout: 30000 })
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  const pr = await published
  check('Publish publishes', pr.status() === 200, `${pr.status()}`)
  await page.getByText(/^Published\. \d+ (person|people) will be told\./).waitFor({ timeout: 15000 }).then(() => check('the toast says how many people will be told', true)).catch(() => check('the toast says how many people will be told', false))
  await page.screenshot({ path: `${shots}/shift-p1-live-published.png` })

  // ── Read it back ──
  const owner = await token('owner@unifiedtree.demo')
  const back = await fetch(`${apiBase}/v1/rosters/${rosterId}`, { headers: owner })
  const body = back.ok ? await back.json() : null
  check('the roster reads back published, version 1', body?.roster?.status === 'PUBLISHED' && body?.roster?.version === 1, `${back.status} ${body?.roster?.status} v${body?.roster?.version}`)
  const days2 = Number(sql(`SELECT count(*) FROM attendance.schedule_days WHERE tenant_id='${tenant}' AND roster_id='${rosterId}' AND work_date < DATE '${istToday()}'`))
  check('no day before today was published', days2 === 0, `${days2}`)
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  check('no API errors', apiErrors.length === 0, apiErrors.join(' | '))
} catch (e) {
  check('the run finished', false, String(e).slice(0, 400))
} finally {
  await browser.close()
  if (rosterId) {
    sql(`DELETE FROM notif.notifications WHERE tenant_id='${tenant}' AND type IN ('ROSTER_PUBLISHED','ROSTER_DAY_CHANGED') AND data->>'rosterId'='${rosterId}';
         DELETE FROM attendance.schedule_day_history WHERE tenant_id='${tenant}' AND roster_id='${rosterId}';
         DELETE FROM attendance.schedule_days WHERE tenant_id='${tenant}' AND roster_id='${rosterId}';
         DELETE FROM attendance.rosters WHERE tenant_id='${tenant}' AND id='${rosterId}';`)
    const left = sql(`SELECT count(*) FROM attendance.rosters WHERE id='${rosterId}'`)
    check('everything it created is removed', left === '0')
  }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
