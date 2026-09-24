// Live check of the redesigned Companies & Branches page against the local API.
// Creates a test branch (with a geofence), edits it, makes it HQ, archives it;
// edits the company's legal name and restores it; re-saves the ID format unchanged.
//
//   node e2e/recovery/live-design-companies.mjs
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const pageErrors = [], failed = []
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }

const name = `Design QA Branch ${Date.now() % 100000}`
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  await page.goto(base + '/hrms/companies'); await settle()
  check('page renders the company card', await page.getByText('STATUTORY INFORMATION', { exact: false }).count() > 0 || await page.getByText('Statutory information').count() > 0)

  // ── create a branch with a geofence ──
  await page.getByRole('button', { name: /^Add branch$/ }).first().click()
  await page.getByText('Create branch').first().waitFor()
  await page.getByPlaceholder('e.g. Mumbai Office').fill(name)
  await page.getByPlaceholder('MUM', { exact: true }).fill('DQA')
  await page.getByPlaceholder('Mumbai', { exact: true }).fill('Pune')
  await page.locator('select').filter({ hasText: 'Select state' }).selectOption('Maharashtra')
  await page.getByRole('button', { name: /^Create branch/ }).click()
  await page.getByText(name).first().waitFor({ timeout: 15000 })
  await settle()
  const card = page.locator('article').filter({ hasText: name })
  // The geofence is saved right after the branch is created, so its label updates a moment later.
  await card.getByText(/On\s*·\s*100 m/).first().waitFor({ timeout: 15000 }).catch(() => {})
  const cardText = (await card.first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('new branch appears with its geofence on', /On\s*·\s*100 m/.test(cardText), cardText.slice(0, 160))

  // ── edit it: rename + make HQ ──
  await card.getByRole('button', { name: /Manage/ }).click()
  await page.getByText('Edit branch').first().waitFor()
  await page.getByPlaceholder('e.g. Mumbai Office').fill(name + ' Edited')
  await page.getByText('Mark as headquarters').click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText(name + ' Edited').first().waitFor({ timeout: 15000 })
  await settle()
  const card2 = page.locator('article').filter({ hasText: name + ' Edited' })
  check('edited name shows', await card2.count() > 0)
  check('branch is now the headquarters', await card2.getByText('Headquarters').count() > 0)

  // ── archive it ──
  await card2.getByRole('button', { name: 'Archive' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click()
  await page.getByText(name + ' Edited').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await settle()
  check('branch archives and leaves the list', (await page.getByText(name + ' Edited').count()) === 0)

  // ── company: edit legal name, then restore ──
  await page.getByRole('button', { name: /^Edit$/ }).first().click()
  await page.getByText('Edit company').first().waitFor()
  const legal = page.getByPlaceholder('Registered legal name')
  const seen = await legal.inputValue()
  const original = seen === 'Design QA Legal Name Pvt Ltd' ? '' : seen // leftover from an interrupted run
  await legal.fill('Design QA Legal Name Pvt Ltd')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Design QA Legal Name Pvt Ltd').first().waitFor({ timeout: 15000 })
  check('company legal name saves', await page.getByText('Design QA Legal Name Pvt Ltd').count() > 0)
  await page.getByRole('button', { name: /^Edit$/ }).first().click()
  await page.getByText('Edit company').first().waitFor()
  await page.getByPlaceholder('Registered legal name').fill(original)
  // ID format: re-save the current values (no change to the next code).
  await page.getByRole('button', { name: 'Save format' }).click()
  await page.getByText(/Employee ID format saved/).first().waitFor({ timeout: 10000 }).catch(() => {})
  check('employee ID format saves', await page.getByText(/Employee ID format saved/).count() > 0)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await settle()
  check('legal name restored', (await page.getByText('Design QA Legal Name Pvt Ltd').count()) === 0)

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 240))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
