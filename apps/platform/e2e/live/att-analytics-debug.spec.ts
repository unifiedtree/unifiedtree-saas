import { test, expect, type Page } from '@playwright/test'

/**
 * Focused reproduction for the blank /hrms/att-analytics page reported
 * 2026-09-10. Captures the real console/page error instead of guessing,
 * and checks whether the crash takes the whole SPA down (the user reported
 * that back/forward stayed blank afterwards, which is the signature of an
 * unmounted React tree with no error boundary).
 */

const ACCOUNTS = {
  ADMIN: { email: 'reviewer@unifiedtree.com', password: 'Reviewer@2026' },
  EMP:   { email: 'e2e-emp-parity@unifiedtree.example', password: 'E2eParity@2026' },
} as const

async function login(page: Page, role: keyof typeof ACCOUNTS) {
  const c = ACCOUNTS[role]
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  const boxes = page.getByRole('textbox')
  await boxes.first().waitFor({ state: 'visible', timeout: 30_000 })
  await boxes.nth(0).fill(c.email)
  await boxes.nth(1).fill(c.password)
  await page.getByRole('button', { name: /^log ?in$|^sign ?in$/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 })
}

for (const role of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  test(`${role}: /hrms/att-analytics renders and does not kill the SPA`, async ({ browser }) => {
    test.setTimeout(180_000)
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack ?? ''}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`) })

    await login(page, role)
    await page.goto('/hrms/att-analytics', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)

    const body = (await page.locator('body').innerText().catch(() => '')) || ''
    // eslint-disable-next-line no-console
    console.log(`\n=== ${role} att-analytics bodyLen=${body.trim().length} ===`)
    // eslint-disable-next-line no-console
    console.log(errors.length ? errors.join('\n---\n').slice(0, 4000) : '(no errors captured)')

    // Then navigate AWAY to prove whether the SPA survived the visit.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const afterBody = (await page.locator('body').innerText().catch(() => '')) || ''
    // eslint-disable-next-line no-console
    console.log(`=== ${role} dashboard-after bodyLen=${afterBody.trim().length} ===`)

    await page.close()
    expect(body.trim().length, `att-analytics rendered nothing for ${role}`).toBeGreaterThan(40)
    expect(afterBody.trim().length, `SPA did not recover after visiting att-analytics as ${role}`).toBeGreaterThan(40)
  })
}
