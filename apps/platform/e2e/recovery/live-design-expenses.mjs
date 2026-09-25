// Live check of the redesigned Expenses page (ModuleKit) against the local API:
//  - employee: views are My claims / Submit a claim only; submitting a
//    one-line claim saves it; no refused (403) API calls
//  - owner: the claim is a decision card under "Waiting for your OK"; its line
//    items open; approving moves it to "Approved, to be paid"; Mark reimbursed
//    pays it; Reimbursement batches and Policies render
// The claim is deleted at the end.
//
//   node e2e/recovery/live-design-expenses.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || ''
const READER = '22222222-2222-2222-2222-222222222222'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const TITLE = `Local QA claim ${Date.now() % 100000}`

const browser = await chromium.launch()
const session = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
const toast = (page, re) => page.locator('[role=status],[role=alert],[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
const claimId = () => sql(`select coalesce((select id::text from expense_mgmt.expense_claims where title='${TITLE}' limit 1),'')`)

try {
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/expenses'); await settle(r.page)
  const views = await r.page.locator('[aria-label="Expense views"]').innerText()
  check('employee: views are My claims and Submit a claim only', views.includes('My claims') && views.includes('Submit a claim') && !views.includes('Approvals') && !views.includes('Policies'), views.replace(/\s+/g, ' '))
  await r.page.getByRole('button', { name: /New claim/ }).click(); await settle(r.page)
  await r.page.getByPlaceholder('e.g. Client visit — Mumbai').fill(TITLE)
  await r.page.locator('input[type=number]').first().fill('450')
  await r.page.getByRole('button', { name: 'Submit Claim' }).click()
  check('employee: submitting saves the claim', await toast(r.page, /Expense claim submitted/) && !!claimId())
  await settle(r.page)
  check('employee: My claims lists it', (await r.page.getByText(TITLE).count()) > 0)
  check('employee: no refused API calls', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/expenses'); await settle(o.page)
  const card = o.page.locator('article').filter({ hasText: TITLE })
  check('owner: the claim is a card under “Waiting for your OK”', (await o.page.getByText('Waiting for your OK').count()) > 0 && (await card.count()) === 1)
  await card.getByRole('button', { name: 'Show line items' }).click()
  check('owner: its line items open', await card.getByText('₹450').first().waitFor({ timeout: 10000 }).then(() => true, () => false))
  if (shots) await o.page.screenshot({ path: `${shots}/expenses-approvals.png` })
  await card.getByRole('button', { name: /Approve/ }).click()
  check('owner: approving saves', await toast(o.page, /Claim approved/) && sql(`select status from expense_mgmt.expense_claims where id='${claimId()}'`) === 'APPROVED')
  await settle(o.page)
  check('owner: it moves to “Approved, to be paid”', (await o.page.getByText('Approved, to be paid').count()) > 0)
  await o.page.locator('article').filter({ hasText: TITLE }).getByRole('button', { name: /Mark reimbursed/ }).click()
  check('owner: Mark reimbursed pays it', await toast(o.page, /Marked reimbursed/) && sql(`select status from expense_mgmt.expense_claims where id='${claimId()}'`) === 'REIMBURSED')
  for (const v of ['batches', 'policies']) {
    o.errors.length = 0; o.failed.length = 0
    await o.page.goto(`${base}/hrms/expenses?tab=${v}`); await settle(o.page)
    check(`owner: ${v} view renders without errors`, !o.errors.length && !o.failed.length, o.errors[0] || o.failed[0] || '')
  }
  await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  try {
    const id = claimId()
    if (id) {
      sql(`delete from expense_mgmt.reimbursement_batch_items where claim_id='${id}'`)
      sql(`delete from expense_mgmt.expense_items where claim_id='${id}'`)
      sql(`delete from expense_mgmt.expense_claims where id='${id}'`)
    }
  } catch (e) { console.log('cleanup:', String(e).split(String.fromCharCode(10))[0]) }
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
