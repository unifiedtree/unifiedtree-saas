import { test, expect } from '@playwright/test'

// Broad deployed-page sweep against the prod-backed `ravi` tenant. Each page must
// render (HTTP<400, not bounced to login) with ZERO console errors and ZERO
// failed/5xx network requests. Excludes pages that share the known attendance
// /v1/attendance/dashboard 500 (fix pending redeploy) and the 7 modules not yet
// deployed (their APIs 404 until the next railway up).

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://erpinfrastructure-production.up.railway.app'
const TENANT_ID = process.env.E2E_LIVE_TENANT_ID ?? '433cdd35-6d58-45bd-8db8-b468b3711fb7'
const EMAIL = process.env.E2E_LIVE_EMAIL ?? 'ravi@gmail.com'
const PASSWORD = process.env.E2E_LIVE_PASSWORD
const TOKEN_KEY = '__ut_access_token__'

let token = ''

test.beforeAll(async ({ request }) => {
  test.skip(!PASSWORD, 'Set E2E_LIVE_PASSWORD to run the live page sweep')
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), 'API login should succeed').toBeTruthy()
  token = (await r.json()).accessToken
  expect(token).toBeTruthy()
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(([k, v]) => { try { window.sessionStorage.setItem(k, v) } catch { /* */ } }, [TOKEN_KEY, token])
})

const PAGES = [
  '/hrms/employees', '/hrms/employees/import', '/hrms/leave', '/hrms/ess',
  '/hrms/expenses', '/hrms/advances', '/hrms/fnf', '/hrms/hiring', '/hrms/performance',
  '/hrms/payroll/runs', '/hrms/payroll/components', '/hrms/payroll/settings',
  '/hrms/payroll-dashboard', '/hrms/salary-structure', '/hrms/bank-disbursement', '/hrms/shifts',
  '/hrms/organization', '/hrms/attendance/geofencing', '/hrms/settings',
  '/hrms/reports', '/hrms/reports/headcount', '/hrms/reports/attrition', '/hrms/reports/diversity',
  '/hrms/reports/leave-balance', '/hrms/reports/late-marks', '/hrms/reports/attendance-summary',
  '/hrms/letters/templates', '/hrms/letters/generated', '/hrms/letters/distributions',
  '/hrms/onboarding', '/hrms/onboarding/instances', '/hrms/workforce-analytics',
  '/me', '/me/payslips', '/me/salary', '/roles', '/users', '/audit-logs', '/modules',
]

for (const path of PAGES) {
  test(`clean: ${path}`, async ({ page }) => {
    const consoleErrors: string[] = []
    const badRequests: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
    page.on('requestfailed', (r) => badRequests.push(`FAILED ${r.method()} ${safePath(r.url())}`))
    page.on('response', (r) => { if (r.status() >= 500) badRequests.push(`${r.status()} ${safePath(r.url())}`) })

    const resp = await page.goto(path, { waitUntil: 'load' })
    expect(resp?.status(), `HTTP status for ${path}`).toBeLessThan(400)
    await expect(page, `${path} should not bounce to /login`).not.toHaveURL(/\/login/, { timeout: 5000 })
    await page.waitForTimeout(1800)
    expect(consoleErrors, `console errors on ${path}:\n  ${consoleErrors.join('\n  ')}`).toEqual([])
    expect(badRequests, `failed/5xx requests on ${path}:\n  ${badRequests.join('\n  ')}`).toEqual([])
  })
}

function safePath(u: string) { try { return new URL(u).pathname } catch { return u } }
