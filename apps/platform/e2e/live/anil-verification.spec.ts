import { test, expect, type Page } from '@playwright/test'

/**
 * Live verification of the Anil-docx fixes. Each test opens the exact
 * screen Anil pointed at, performs the click he described, and records
 * a screenshot for the final report. No mocks — hits the deployed
 * backend + Vercel bundle on demo-hrms.
 */

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'reviewer@unifiedtree.com'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

let token = ''

test.beforeAll(async ({ request }) => {
  test.skip(!PASSWORD, 'Set E2E_ADMIN_PASSWORD to run')
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), `login status ${r.status()}`).toBeTruthy()
  token = (await r.json()).accessToken
})

async function enter(page: Page, path: string) {
  const sep = path.includes('?') ? '&' : '?'
  await page.goto(`${path}${sep}token=${encodeURIComponent(token)}`, { waitUntil: 'load' })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 })
}

/** Record every console error and every 4xx/5xx so we can see what
 *  actually happens when Anil clicks. */
function watch(page: Page): { errs: string[]; bads: string[] } {
  const errs: string[] = []
  const bads: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`.slice(0, 300)))
  page.on('response', (r) => {
    if (r.status() >= 400) bads.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  return { errs, bads }
}

// ── ITEM 10 — Add Employee, blank white page ───────────────────────────────
test('item 10: /hrms/employees → click Add Employee', async ({ page }, testInfo) => {
  const { errs, bads } = watch(page)
  await enter(page, '/hrms/employees')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: testInfo.outputPath('before-click.png'), fullPage: true })

  const addBtn = page.getByRole('button', { name: /Add Employee/i })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath('after-click.png'), fullPage: true })

  // Drawer heading should be present
  const drawer = page.getByRole('heading', { name: /Add Employee/i }).first()
  const drawerVisible = await drawer.isVisible().catch(() => false)

  // Body must NOT be blank — probe pixel by looking for at least the drawer or a form field
  const hasFormField = await page.locator('input, select, textarea').count()
  console.log(`  drawer heading visible: ${drawerVisible}, form fields on page: ${hasFormField}`)
  console.log(`  console errors: ${errs.length}`)
  errs.forEach((e) => console.log(`    ${e}`))
  console.log(`  4xx/5xx: ${bads.length}`)
  bads.slice(0, 10).forEach((b) => console.log(`    ${b}`))

  // Verdict: drawer heading visible OR body form fields visible
  expect(drawerVisible || hasFormField > 3, 'Add Employee opens some form').toBeTruthy()
})

// ── ITEMS 1-8 — Company / Branches / Departments etc. Same "Add" pattern ────
test('item 1-8: /hrms/organization → click Add Company', async ({ page }, testInfo) => {
  const { errs } = watch(page)
  await enter(page, '/hrms/organization')
  await page.waitForTimeout(1500)
  const addBtn = page.getByRole('button', { name: /Add Company/i })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: testInfo.outputPath('add-company.png'), fullPage: true })

  // Drawer heading + Company Name field
  await expect(page.getByRole('heading', { name: /Add Company/i })).toBeVisible()
  const nameInput = page.getByPlaceholder(/Acme Pvt Ltd/i)
  await expect(nameInput).toBeVisible()

  // Focus-loss test: type 3 chars, verify all 3 land AND cursor stays in input
  await nameInput.focus()
  await nameInput.type('Abc', { delay: 80 })
  await expect(nameInput).toHaveValue('Abc')
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  expect(focused, 'cursor stays in input after typing').toBe('INPUT')
  console.log(`  errors: ${errs.length}`)
})

// ── ITEM 11/17 — Leave Types drawer position ───────────────────────────────
test('item 11/17: /hrms/leave → Types → Add Type opens right drawer, not bottom', async ({ page }, testInfo) => {
  const { errs } = watch(page)
  await enter(page, '/hrms/leave?tab=types')
  await page.waitForTimeout(1500)
  const addBtn = page.getByRole('button', { name: /^\s*Add Type\s*$/i })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('add-leave-type.png'), fullPage: true })

  // Assert the drawer is anchored to the RIGHT (top < 100 = near top of viewport)
  const heading = page.getByRole('heading', { name: /Add Leave Type/i })
  await expect(heading).toBeVisible()
  const box = await heading.boundingBox()
  expect(box, 'heading has a bounding box').not.toBeNull()
  console.log(`  heading top=${box?.y} x=${box?.x} — must be near top (<100)`)
  expect(box!.y).toBeLessThan(100)
  console.log(`  errors: ${errs.length}`)
})

// ── ITEM 18 — Holidays: Add Holiday drawer position ─────────────────────────
test('item 18: /hrms/leave → Holidays → Add Holiday opens right drawer', async ({ page }, testInfo) => {
  await enter(page, '/hrms/leave?tab=holidays')
  await page.waitForTimeout(1500)
  const addBtn = page.getByRole('button', { name: /Add Holiday/i })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('add-holiday.png'), fullPage: true })
  const heading = page.getByRole('heading', { name: /Add Holiday/i })
  await expect(heading).toBeVisible()
  const box = await heading.boundingBox()
  console.log(`  heading top=${box?.y}`)
  expect(box!.y).toBeLessThan(100)
})

// ── ITEMS 9/15/22 — search icon overlap ────────────────────────────────────
test('items 9/15/22: search inputs — icon must NOT overlap placeholder', async ({ page }, testInfo) => {
  const routes = [
    { path: '/hrms/employees',        name: 'workforce' },
    { path: '/hrms/attendance',       name: 'team-attendance' },
    { path: '/hrms/salary-structure', name: 'salary-structure' },
  ]
  for (const r of routes) {
    await enter(page, r.path)
    await page.waitForTimeout(1500)
    const input = page.locator('input.ut-input.pl-9, input[placeholder*="Search"]').first()
    const exists = await input.count()
    if (!exists) { console.log(`  ${r.name}: no ut-input.pl-9 found`); continue }
    // Read the computed left padding vs the icon's left position
    const info = await input.evaluate((el) => {
      const cs = getComputedStyle(el as Element)
      const box = (el as Element).getBoundingClientRect()
      const icon = (el.parentElement?.querySelector('svg') as SVGElement | null)
      const iconBox = icon?.getBoundingClientRect()
      return {
        paddingLeft: cs.paddingLeft,
        inputX: box.x,
        iconRight: iconBox ? iconBox.x + iconBox.width - box.x : null,
      }
    })
    console.log(`  ${r.name}: padding-left=${info.paddingLeft}, icon extends to ${info.iconRight}px from input left`)
    await page.screenshot({ path: testInfo.outputPath(`${r.name}.png`), fullPage: false })
    // Padding-left must exceed icon width, else text sits under icon
    const padPx = parseFloat(info.paddingLeft)
    if (info.iconRight != null) {
      expect(padPx, `${r.name}: padding-left(${padPx}px) must be > icon-right(${info.iconRight}px)`).toBeGreaterThan(info.iconRight)
    }
  }
})

// ── ITEM 16 — Geofencing → Add Zone drawer position ────────────────────────
test('item 16: /hrms/attendance/geofencing → Add Zone opens right drawer', async ({ page }, testInfo) => {
  await enter(page, '/hrms/attendance/geofencing')
  await page.waitForTimeout(1500)
  const addBtn = page.getByRole('button', { name: /Add Zone/i }).first()
  if (!(await addBtn.count())) { console.log('  no Add Zone button on this tenant'); return }
  await addBtn.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('add-zone.png'), fullPage: true })
  const heading = page.getByRole('heading', { name: /Add Zone/i })
  await expect(heading).toBeVisible()
  const box = await heading.boundingBox()
  console.log(`  heading top=${box?.y}`)
  expect(box!.y).toBeLessThan(120)
})

// ── ITEM 20 — Letter Templates B/I toolbar re-renders on selection ─────────
test('item 20: /hrms/letters/templates/new → B and I toggle independently', async ({ page }, testInfo) => {
  await enter(page, '/hrms/letters/templates/new')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true })
  const bold = page.getByRole('button', { name: /^Bold$/ })
  const italic = page.getByRole('button', { name: /^Italic$/ })
  await expect(bold).toBeVisible()
  await expect(italic).toBeVisible()

  // Focus the editor first
  const editor = page.locator('.ProseMirror').first()
  if (await editor.count()) await editor.click()

  const boldBg0 = await bold.evaluate((el) => getComputedStyle(el).backgroundColor)
  const italicBg0 = await italic.evaluate((el) => getComputedStyle(el).backgroundColor)
  await bold.click()
  await page.waitForTimeout(300)
  const boldBg1 = await bold.evaluate((el) => getComputedStyle(el).backgroundColor)
  const italicBg1 = await italic.evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log(`  bold  bg: ${boldBg0} → ${boldBg1}`)
  console.log(`  italic bg: ${italicBg0} → ${italicBg1}`)
  // Bold must have changed, italic must NOT
  expect(boldBg0).not.toBe(boldBg1)
  expect(italicBg0).toBe(italicBg1)
})
