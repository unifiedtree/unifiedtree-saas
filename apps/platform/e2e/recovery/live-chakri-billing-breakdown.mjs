// Live check for chakri/billing-breakdown: Settings → Billing → "Billing by company" (owner's option a).
//
//   live-slot.sh /c/REACT/ut-wt/b4-billing 3101 node e2e/recovery/live-chakri-billing-breakdown.mjs
//
// What it proves, against the local backend:
//  - GET /v1/workspace/plan/breakdown: 200 for the owner (one line per active company, employees + amount),
//    403 for an employee (reader@).
//  - Web, owner: Settings → Billing shows "Billing by company" with a row per company (name, employees,
//    amount) and "Print or save as PDF"; no page errors and no API 4xx/5xx. Phone width too.
// Read-only: nothing is created.
/* global process, console, fetch, URL */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

async function token(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  return (await r.json().catch(() => ({}))).accessToken
}
const get = async (path, t) => {
  const r = await fetch(api + path, { headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${t}` } })
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
  return { status: r.status, json }
}

let browser
try {
  // ── API ──
  const owner = await get('/v1/workspace/plan/breakdown', await token('owner@unifiedtree.demo'))
  const b = owner.json || {}
  check('API: owner gets the breakdown (200)', owner.status === 200, String(owner.status))
  check('API: one line per company, each with employees and an amount field', Array.isArray(b.companies) && b.companies.length > 0
    && b.companies.every((c) => c.companyId && c.name && Number.isInteger(c.employees) && 'amountInr' in c), JSON.stringify(b.companies?.map((c) => [c.name, c.employees, c.amountInr])))
  check('API: seats bought / used are numbers', Number.isInteger(b.seatsBought) && Number.isInteger(b.seatsUsed), `${b.seatsBought} bought, ${b.seatsUsed} used`)
  const reader = await get('/v1/workspace/plan/breakdown', await token('reader@unifiedtree.demo'))
  check('API: an employee is refused (403)', reader.status === 403, String(reader.status))

  // ── Web ──
  browser = await chromium.launch()
  const errors = []
  const bad = []
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`))
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${width}: ${r.status()} ${new URL(r.url()).pathname}`) })
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
    const later = page.getByRole('button', { name: 'Continue without checking in' })
    await later.waitFor({ timeout: 4000 }).catch(() => {})
    if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
    await page.goto(base + '/settings/billing', { waitUntil: 'domcontentloaded', timeout: 90000 })
    const table = page.getByRole('table', { name: 'Billing by company' })
    await table.waitFor({ timeout: 30000 }).catch(() => {})
    check(`web ${width}: "Billing by company" shows`, await table.isVisible().catch(() => false))
    const companies = b.companies || []
    let rowsOk = companies.length > 0
    for (const c of companies) {
      const row = table.getByRole('row').filter({ hasText: c.name }).first()
      const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ')
      if (!text.includes(String(c.employees))) rowsOk = false
    }
    check(`web ${width}: a row per company with its employees`, rowsOk)
    check(`web ${width}: "Print or save as PDF" is there`, await page.getByRole('button', { name: 'Print or save as PDF' }).isVisible().catch(() => false))
    await table.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${shots}/b4-billing-breakdown-${width}.png`, fullPage: width === 390 })
    await page.close()
  }
  check('web: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  check('web: no API 4xx/5xx', bad.length === 0, bad.slice(0, 4).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
