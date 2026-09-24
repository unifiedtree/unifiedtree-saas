// Expenses & Advances money decisions (/hrms/expenses, /hrms/advances) —
// browser acceptance against the local recovery runtime. The reader files a
// real expense claim and a real advance request through the API; the owner
// then rejects both through the "Reject claim" / "Reject advance" drawers
// (no more window.prompt) and the API is checked for the persisted status and
// reason. Also exercises the policy "Deactivate" confirm dialog (replacing
// window.confirm) on a throw-away policy, the readable status pills and the
// "Reimbursed this month" stat. The claim and advance are left REJECTED as QA
// records; the policy fixture is deleted.
//
// Run from apps/platform:  node e2e/recovery/live-money-modals.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
const post = async (h, path, body) => {
  const r = await fetch(api + path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
const get = async (h, path) => (await fetch(api + path, { headers: h })).json()
const tabButton = (page, name) => page.getByRole('tab', { name }).or(page.getByRole('button', { name, exact: true })).first()

const owner = await login('owner@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')
const suffix = randomUUID().slice(0, 6)
const claimTitle = `QA money modal ${suffix}`
const claimReason = `Receipt missing (QA ${suffix})`
const advanceAmount = 1000 + Math.floor(Math.random() * 8000)
const advanceReason = `Outside advance policy (QA ${suffix})`
const policyName = `QA deactivate ${suffix}`

const claim = await post(reader, '/v1/expense/claims', {
  title: claimTitle, notes: 'Created by live-money-modals.mjs',
  items: [{ category: 'FOOD', amount: 150, expenseDate: new Date().toISOString().slice(0, 10), description: 'QA lunch' }],
})
const advance = await post(reader, '/v1/advance/requests', { amount: advanceAmount, repaymentMonths: 2, reason: `QA money modal ${suffix}` })
const policy = await post(owner, `/v1/expense/policies?companyId=${company}`, { companyId: company, name: policyName, category: 'OTHER', maxAmountPerClaim: 9999999 })
console.log('fixtures claim', claim.id, claim.status, '· advance', advance.id, advance.status, '· policy', policy.id)

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')
const browser = await chromium.launch({ headless: true })
const pageErrors = [], failedApi = []
let nativeDialogs = 0
async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.on('dialog', async (d) => { nativeDialogs++; await d.dismiss() })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  // Every sign-in currently produces two known 401→refresh(422) round trips
  // (HRMS_MODULE_ACTION_LEDGER.md, auth section). Measure the pages, not login.
  await page.waitForTimeout(1500)
  pageErrors.length = 0; failedApi.length = 0
  return page
}

try {
  let page = await signIn('owner@unifiedtree.demo')

  // ── Expense: reject through the drawer ──────────────────────────────────
  await page.goto(base + '/hrms/expenses')
  await page.getByRole('heading', { name: 'Expense Center' }).waitFor({ timeout: 30_000 })
  const stats = await get(owner, '/v1/expense/dashboard-stats')
  const statCard = page.locator('.ut-card').filter({ hasText: 'Reimbursed this month' }).first()
  await statCard.waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  check('"Reimbursed this month" stat shows the API amount', (await statCard.innerText()).includes(inr(stats.reimbursedThisMonthAmount)), inr(stats.reimbursedThisMonthAmount))

  const claimRow = page.getByRole('row').filter({ hasText: claimTitle })
  await claimRow.waitFor({ timeout: 15_000 })
  const claimRowText = await claimRow.innerText()
  check('submitted claim pill reads "Pending approval" (not SUBMITTED)', claimRowText.includes('Pending approval') && !claimRowText.includes('SUBMITTED'))

  // Cancel must abort: open the drawer, dismiss it, the claim stays SUBMITTED.
  await claimRow.getByRole('button', { name: 'Reject' }).click()
  let drawer = page.getByRole('dialog', { name: 'Reject claim' })
  await drawer.waitFor({ timeout: 10_000 })
  check('Reject opens the "Reject claim" drawer', (await drawer.innerText()).includes(claimTitle))
  await drawer.getByRole('button', { name: 'Cancel' }).click()
  await drawer.waitFor({ state: 'detached', timeout: 10_000 })
  check('Cancel leaves the claim SUBMITTED', (await get(owner, `/v1/expense/claims/${claim.id}`)).status === 'SUBMITTED')

  await claimRow.getByRole('button', { name: 'Reject' }).click()
  drawer = page.getByRole('dialog', { name: 'Reject claim' })
  await drawer.getByLabel('Reason (optional)').fill(claimReason)
  await drawer.getByRole('button', { name: 'Confirm rejection' }).click()
  await page.getByText('Claim rejected').first().waitFor({ timeout: 15_000 })
  await page.getByRole('row').filter({ hasText: claimTitle }).waitFor({ state: 'detached', timeout: 15_000 })
  check('rejected claim leaves the approvals queue', true)
  const claimAfter = await get(owner, `/v1/expense/claims/${claim.id}`)
  check('API: claim REJECTED with the typed reason', claimAfter.status === 'REJECTED' && claimAfter.approverComment === claimReason, `${claimAfter.status} "${claimAfter.approverComment}"`)

  // ── Expense: policy deactivate through the confirm dialog ───────────────
  await tabButton(page, 'Policies').click()
  const policyRow = page.getByRole('row').filter({ hasText: policyName })
  await policyRow.waitFor({ timeout: 15_000 })
  await policyRow.getByTitle('Deactivate').click()
  const confirmBox = page.getByRole('dialog').filter({ hasText: policyName })
  await confirmBox.waitFor({ timeout: 10_000 })
  check('Deactivate opens the confirm dialog', (await confirmBox.innerText()).includes('Claims will stop being checked against this cap'))
  await confirmBox.getByRole('button', { name: 'Deactivate' }).click()
  await page.getByText('Policy deactivated').first().waitFor({ timeout: 15_000 })
  const policies = await get(owner, `/v1/expense/policies?companyId=${company}`)
  check('API: policy inactive after confirming', policies.find((p) => p.id === policy.id)?.active === false)
  await policyRow.getByText('Inactive').waitFor({ timeout: 10_000 })
  check('policy row shows Inactive', true)

  // ── Advance: reject through the drawer ──────────────────────────────────
  await page.goto(base + '/hrms/advances')
  await tabButton(page, 'Approvals').click({ timeout: 30_000 })
  const advRow = page.getByRole('row').filter({ hasText: inr(advanceAmount) }).filter({ hasText: 'Requested' }).first()
  await advRow.waitFor({ timeout: 15_000 })
  check('requested advance pill reads "Requested" (not REQUESTED)', !(await advRow.innerText()).includes('REQUESTED'))
  await advRow.getByRole('button', { name: 'Reject' }).click()
  const advDrawer = page.getByRole('dialog', { name: 'Reject advance' })
  await advDrawer.waitFor({ timeout: 10_000 })
  await advDrawer.getByLabel('Reason (optional)').fill(advanceReason)
  await advDrawer.getByRole('button', { name: 'Confirm rejection' }).click()
  await page.getByText('Advance rejected').first().waitFor({ timeout: 15_000 })
  const advAfter = await get(owner, `/v1/advance/requests/${advance.id}`)
  check('API: advance REJECTED with the typed reason', advAfter.status === 'REJECTED' && advAfter.approverComment === advanceReason, `${advAfter.status} "${advAfter.approverComment}"`)
  check('owner pages: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('owner pages: no failed API calls', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/money-modals-owner.png', fullPage: true })

  // ── Reader: readable pills on My Advances / My Claims ───────────────────
  page = await signIn('reader@unifiedtree.demo')
  await page.goto(base + '/hrms/advances')
  await tabButton(page, 'My Advances').click({ timeout: 30_000 })
  const myAdv = page.getByRole('row').filter({ hasText: inr(advanceAmount) }).first()
  await myAdv.waitFor({ timeout: 15_000 })
  const myAdvText = await myAdv.innerText()
  check('My Advances pill reads "Rejected"', myAdvText.includes('Rejected') && !myAdvText.includes('REJECTED'), myAdvText.replace(/\s+/g, ' '))
  await page.goto(base + '/hrms/expenses')
  await tabButton(page, 'My Claims').click({ timeout: 30_000 })
  const myClaim = page.getByRole('row').filter({ hasText: claimTitle })
  await myClaim.waitFor({ timeout: 15_000 })
  const myClaimText = await myClaim.innerText()
  check('My Claims pill reads "Rejected"', myClaimText.includes('Rejected') && !myClaimText.includes('REJECTED'), myClaimText.replace(/\s+/g, ' '))
  check('reader pages: no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('reader pages: no failed API calls', failedApi.length === 0, failedApi.slice(0, 3).join(' | '))
  check('no native window.prompt / window.confirm raised', nativeDialogs === 0, String(nativeDialogs))
} catch (e) {
  check('flow completed', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  // If the UI flow broke half-way, still leave the QA records REJECTED rather than pending in real queues.
  try {
    if ((await get(owner, `/v1/expense/claims/${claim.id}`)).status === 'SUBMITTED') await post(owner, `/v1/expense/claims/${claim.id}/decision`, { approved: false, comment: 'QA cleanup' })
    if ((await get(owner, `/v1/advance/requests/${advance.id}`)).status === 'REQUESTED') await post(owner, `/v1/advance/requests/${advance.id}/decision`, { approved: false, comment: 'QA cleanup' })
  } catch (e) { console.log('fallback rejection failed:', String(e).split('\n')[0]) }
  try { sql(`DELETE FROM expense_mgmt.expense_policies WHERE id='${policy.id}' AND tenant_id='${tenant}'`); console.log('policy fixture removed') }
  catch (e) { console.log('policy cleanup failed (left inactive):', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-money-modals.json', JSON.stringify({ ranAt: new Date().toISOString(), fixtures: { claim: claim.id, advance: advance.id, policy: policy.id }, checks, pageErrors, failedApi }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
