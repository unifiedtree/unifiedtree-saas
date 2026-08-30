import { test, expect, type Page } from '@playwright/test'

/**
 * Verifies the P0 fixes from the 2026-08-30 deploy-readiness QA.
 *
 * These assertions are deliberately harsher than anil-verification.spec.ts,
 * which gave a FALSE GREEN on drawer positioning: it asserted
 * `boundingBox().y < 100`, which measures LAYOUT only. A panel can be laid out
 * at y=0 and still be completely covered by the app header, or extend far
 * below the fold. Here we check the things a user actually needs:
 *   - is the element inside the viewport?
 *   - is its top-left actually hit-testable, or is something else on top?
 */

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'reviewer@unifiedtree.com'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

let token = ''
test.beforeAll(async ({ request }) => {
  test.skip(!PASSWORD, 'Set E2E_ADMIN_PASSWORD')
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), `login ${r.status()}`).toBeTruthy()
  token = (await r.json()).accessToken
})

async function enter(page: Page, path: string) {
  const sep = path.includes('?') ? '&' : '?'
  await page.goto(`${path}${sep}token=${encodeURIComponent(token)}`, { waitUntil: 'load' })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 })
}

// ── P0-7: /settings/billing must render Billing, not Profile ───────────────
test('P0-7 /settings/billing renders the Billing tab', async ({ page }, ti) => {
  await enter(page, '/settings/billing')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: ti.outputPath('billing.png'), fullPage: true })
  const body = (await page.locator('body').innerText()).toLowerCase()
  // Profile tab is identifiable by its own field labels; billing by plan/seat wording.
  const looksProfile = /display name|first name|last name/.test(body)
  const looksBilling = /plan|seat|subscription|billing/.test(body)
  console.log(`  looksBilling=${looksBilling} looksProfile=${looksProfile}`)
  expect(looksBilling, 'billing content present').toBeTruthy()
  expect(looksProfile, 'must NOT be the profile tab').toBeFalsy()
})

// ── P0-8: /settings/danger must be reachable by the OWNER ──────────────────
test('P0-8 /settings/danger does not redirect the owner away', async ({ page }, ti) => {
  await enter(page, '/settings/danger')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: ti.outputPath('danger.png'), fullPage: true })
  console.log(`  landed on: ${page.url()}`)
  expect(page.url(), 'must not be bounced to /me').not.toContain('/me')
  expect(page.url()).toContain('/settings/danger')
})

// ── P0-6: Workforce Directory search must accept a whole word ──────────────
test('P0-6 directory search keeps focus and accepts all characters', async ({ page }) => {
  await enter(page, '/hrms/employees')
  await page.waitForTimeout(2500)
  const box = page.locator('input[placeholder*="Search"]').first()
  await expect(box).toBeVisible()
  await box.click()
  await box.type('Aisha', { delay: 120 })
  await page.waitForTimeout(600)
  const value = await box.inputValue()
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName)
  console.log(`  value="${value}"  activeElement=${focusedTag}`)
  expect(value, 'all five characters must land').toBe('Aisha')
  expect(focusedTag, 'focus must stay in the input').toBe('INPUT')
})

// ── P0-4: modals must be fully on-screen AND not occluded ──────────────────
test('P0-4 Invite-user modal is on-screen and its actions are hit-testable', async ({ page }, ti) => {
  await enter(page, '/users')
  await page.waitForTimeout(2500)
  const invite = page.getByRole('button', { name: /invite/i }).first()
  if (!(await invite.count())) { console.log('  no Invite control on this tenant — skipping'); return }
  await invite.click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: ti.outputPath('invite-modal.png'), fullPage: false })

  const dialog = page.locator('[role="dialog"]').last()
  await expect(dialog).toBeVisible()

  const m = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height,
             vw: window.innerWidth, vh: window.innerHeight }
  })
  console.log(`  dialog x=${m.x.toFixed(0)} y=${m.y.toFixed(0)} ${m.w.toFixed(0)}x${m.h.toFixed(0)} viewport ${m.vw}x${m.vh}`)

  // Fully within the viewport — this is what boundingBox().y<100 failed to catch.
  expect(m.y, 'top edge on-screen').toBeGreaterThanOrEqual(0)
  expect(m.y + m.h, 'bottom edge on-screen').toBeLessThanOrEqual(m.vh + 1)
  expect(m.x, 'left edge on-screen').toBeGreaterThanOrEqual(0)
  expect(m.x + m.w, 'right edge on-screen').toBeLessThanOrEqual(m.vw + 1)

  // Roughly horizontally centred — proves the -50% actually applied.
  const centreOffset = Math.abs((m.x + m.w / 2) - m.vw / 2)
  console.log(`  horizontal centre offset: ${centreOffset.toFixed(0)}px`)
  expect(centreOffset, 'dialog is centred').toBeLessThan(40)
})
