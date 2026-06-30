import { test, expect } from '@playwright/test'

// Live critical-path smoke test against the prod-backed `ravi` tenant.
// Enterprise assertions per page: HTTP < 400, expected content visible,
// ZERO console errors, ZERO failed/5xx network requests.

// Configure via env (no secrets committed):
//   E2E_LIVE_PASSWORD  (required) — password for E2E_LIVE_EMAIL
//   E2E_LIVE_EMAIL / E2E_LIVE_TENANT_ID / PLAYWRIGHT_BACKEND_URL / PLAYWRIGHT_BASE_URL (optional)
const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://erpinfrastructure-production.up.railway.app'
const TENANT_ID = process.env.E2E_LIVE_TENANT_ID ?? '433cdd35-6d58-45bd-8db8-b468b3711fb7'
const EMAIL = process.env.E2E_LIVE_EMAIL ?? 'ravi@gmail.com'
const PASSWORD = process.env.E2E_LIVE_PASSWORD
const TOKEN_KEY = '__ut_access_token__'

let token = ''

test.beforeAll(async ({ request }) => {
  test.skip(!PASSWORD, 'Set E2E_LIVE_PASSWORD to run the live smoke suite against the prod-backed tenant')
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), 'API login should succeed').toBeTruthy()
  token = (await r.json()).accessToken
  expect(token, 'login returns an access token').toBeTruthy()
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([k, v]) => { try { window.sessionStorage.setItem(k, v) } catch { /* ignore */ } },
    [TOKEN_KEY, token],
  )
})

const PAGES: { path: string; content: RegExp }[] = [
  { path: '/dashboard', content: /Quick Actions|Welcome back|Good (morning|afternoon|evening)/i },
  { path: '/hrms/employees', content: /Workforce|Directory|Employees?/i },
  { path: '/hrms/leave', content: /Leave/i },
  { path: '/hrms/expenses', content: /Expense/i },
  { path: '/hrms/payroll/runs', content: /Payroll|Processing/i },
]

for (const p of PAGES) {
  test(`loads cleanly: ${p.path}`, async ({ page }) => {
    const consoleErrors: string[] = []
    const badRequests: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
    page.on('requestfailed', (r) => badRequests.push(`FAILED ${r.method()} ${r.url()}`))
    page.on('response', (r) => { if (r.status() >= 500) badRequests.push(`${r.status()} ${r.url()}`) })

    const resp = await page.goto(p.path, { waitUntil: 'load' })
    expect(resp?.status(), `HTTP status for ${p.path}`).toBeLessThan(400)
    await expect(page.locator('body'), `expected content on ${p.path}`).toContainText(p.content)

    // give async data calls a beat to settle, then assert clean
    await page.waitForTimeout(1500)
    expect(consoleErrors, `console errors on ${p.path}:\n  ${consoleErrors.join('\n  ')}`).toEqual([])
    expect(badRequests, `failed/5xx requests on ${p.path}:\n  ${badRequests.join('\n  ')}`).toEqual([])
  })
}
