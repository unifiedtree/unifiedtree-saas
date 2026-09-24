// Live check of the redesigned Company Admin Dashboard against the local API.
// Creates one company notice and archives it again (cleans up after itself).
//
//   node e2e/recovery/live-design-dashboard.mjs
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

try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  pageErrors.length = 0; failed.length = 0

  await page.goto(base + '/dashboard')
  await page.waitForLoadState('networkidle')
  const heading = page.locator('h1', { hasText: /^Good (morning|afternoon|evening), / })
  check('greeting header renders', await heading.count() > 0, (await heading.first().textContent().catch(() => '')) || '')
  check('Live Overview tiles render', await page.getByRole('button', { name: /Total Employees/ }).count() > 0)
  await page.getByRole('button', { name: /Active employees/ }).first().waitFor({ timeout: 15000 }).catch(() => {})
  check('Company summary renders', await page.getByRole('button', { name: /Active employees/ }).count() > 0)

  // Date calendar: pick yesterday, apply, banner appears, back to today.
  await page.getByRole('button', { name: /September|October|November|December|January|February|March|April|May|June|July|August/ }).first().click()
  const cal = page.getByRole('dialog', { name: 'Choose dashboard date' })
  await cal.waitFor({ timeout: 5000 })
  check('date calendar opens', await cal.isVisible())
  await cal.getByRole('button', { name: 'Yesterday' }).click()
  await cal.getByRole('button', { name: /^Show .* on dashboard$/ }).click()
  await page.waitForLoadState('networkidle')
  const banner = page.getByRole('status').filter({ hasText: 'Viewing' })
  check('past-date banner shows after choosing yesterday', await banner.count() > 0)
  await page.getByRole('button', { name: 'Back to today' }).click()
  check('back to today clears the banner', (await page.getByRole('status').filter({ hasText: 'Viewing' }).count()) === 0)

  // Notice: publish then archive.
  const title = `Design check notice ${Date.now()}`
  await page.getByRole('button', { name: /Add notice/ }).click()
  await page.getByPlaceholder(/Diwali holiday/).fill(title)
  await page.getByPlaceholder('What should everyone know?').fill('Created by the design dashboard check; archived straight away.')
  await page.getByRole('button', { name: 'Save notice' }).click()
  await page.getByText(title).first().waitFor({ timeout: 10000 })
  check('notice publishes and appears in the list', await page.getByText(title).count() > 0)
  // Archive every notice this check ever created (including leftovers from earlier runs).
  const rowFor = (text) => page.locator('article').filter({ hasText: text })
  for (let guard = 0; guard < 10 && (await page.getByText(/^Design check notice \d+$/).count()) > 0; guard++) {
    const t = (await page.getByText(/^Design check notice \d+$/).first().textContent()) || ''
    await rowFor(t).getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Archive' }).click()
    await page.getByText(t, { exact: true }).first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  }
  check('notice archives and leaves the list', (await page.getByText(title).count()) === 0)

  // Projects panel keeps task management reachable.
  await page.getByRole('button', { name: /Manage projects/ }).click()
  const drawer = page.getByText('Projects & Productivity').last()
  check('Manage projects opens the projects panel', await drawer.isVisible())
  await page.keyboard.press('Escape')
  await page.locator('button[aria-label="Close"], button[aria-label="Close drawer"]').first().click().catch(() => {})

  // Tile drill-down.
  await page.goto(base + '/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /Late Arrivals/ }).click()
  await page.waitForURL(/\/hrms\/attendance\?tab=team&status=LATE&date=/, { timeout: 10000 }).catch(() => {})
  check('Late Arrivals tile opens the late list', /status=LATE/.test(page.url()), page.url().replace(base, ''))

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no failed API calls', failed.length === 0, failed.slice(0, 4).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 200))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
