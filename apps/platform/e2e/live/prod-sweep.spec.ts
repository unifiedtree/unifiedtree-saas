import { test, expect, type Page } from '@playwright/test'

/**
 * Deployed-page sweep against a LIVE workspace (Anil punchlist #4:
 * "check every button on the website and the app and ensure it works").
 *
 * Differs from pages-sweep.spec.ts, which seeds sessionStorage and therefore
 * only works against a dev server: the SDK keeps the access token in module
 * memory and mirrors it to sessionStorage ONLY when VITE_DEV_TOKEN_STORAGE=
 * session, a flag that is not set in .env.production. Here we bootstrap the
 * way "Enter Workspace" does, via the ?token= query param AuthProvider reads
 * on mount.
 *
 * Each page must: return HTTP < 400, not bounce to /login, raise ZERO console
 * errors, and issue ZERO failed or 5xx requests.
 *
 * Buttons are audited, never clicked. Blind-clicking a deployed workspace
 * would fire real deletes and real payments. Instead every enabled button is
 * checked for an accessible name — an unlabelled control is the one a
 * screen-reader user, and often a keyboard user, genuinely cannot operate.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://demo-hrms.unifiedtree.com \
 *   E2E_ADMIN_PASSWORD=... npx playwright test e2e/live/prod-sweep.spec.ts \
 *     --config playwright.live.config.ts
 */

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'reviewer@unifiedtree.com'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

/**
 * Console noise that is not a defect in the page under test.
 * Keep this list SHORT and justified — every entry is a blind spot.
 */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  // A 402/403 from a module the demo tenant has not purchased is the
  // subscription guard doing its job, not a broken page.
  /the .* module/i,
]

const PAGES = [
  '/dashboard', '/modules', '/me',
  '/hrms/employees', '/hrms/leave', '/hrms/attendance', '/hrms/policies',
  '/hrms/organization', '/hrms/shifts', '/hrms/hiring', '/hrms/onboarding',
  '/hrms/performance', '/hrms/learning', '/hrms/expenses', '/hrms/advances',
  '/hrms/payroll-dashboard', '/hrms/payroll/runs', '/hrms/payroll/components',
  '/hrms/payroll/settings', '/hrms/salary-structure', '/hrms/bank-disbursement',
  '/hrms/reports', '/hrms/compliance', '/hrms/muster-roll', '/hrms/documents',
  '/hrms/att-analytics', '/hrms/workforce-analytics', '/hrms/fnf',
  '/hrms/settings', '/users', '/roles', '/audit-logs', '/settings/billing',
]

let token = ''

test.beforeAll(async ({ request }) => {
  test.skip(!PASSWORD, 'Set E2E_ADMIN_PASSWORD to run the deployed sweep')
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), `API login (status ${r.status()})`).toBeTruthy()
  token = (await r.json()).accessToken
  expect(token).toBeTruthy()
})

function safePath(u: string): string {
  try { return new URL(u).pathname } catch { return u }
}

async function auditButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    const seen = new Set<string>()
    document.querySelectorAll('button').forEach((b) => {
      const el = b as HTMLButtonElement
      if (el.disabled) return                      // disabled is a deliberate state
      if (el.offsetParent === null) return         // not visible (closed menu, etc.)
      // Accessible name can come from several places. A toggle switch is
      // typically an empty <button role="switch"> wrapped in a <label> whose
      // text is the name — checking only the button's own text reports those
      // as unlabelled when they are in fact correct.
      const labelledBy = el.getAttribute('aria-labelledby')
      const name = (
        el.innerText?.trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.querySelector('svg')?.getAttribute('aria-label') ||
        (labelledBy && document.getElementById(labelledBy)?.textContent) ||
        el.closest('label')?.textContent ||
        ''
      ).trim()
      if (!name) {
        const cls = (el.className || '').toString().slice(0, 60)
        const key = `unlabelled:${cls}`
        if (!seen.has(key)) { seen.add(key); problems.push(key) }
      }
    })
    return problems
  })
}

for (const path of PAGES) {
  test(`clean: ${path}`, async ({ page }) => {
    const consoleErrors: string[] = []
    const badRequests: string[] = []

    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (IGNORED_CONSOLE.some((re) => re.test(t))) return
      consoleErrors.push(t.slice(0, 300))
    })
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`.slice(0, 300)))
    page.on('requestfailed', (r) => {
      // Aborted navigations and cancelled in-flight requests on unmount are noise.
      const f = r.failure()?.errorText ?? ''
      if (/ERR_ABORTED|net::ERR_CANCELED/i.test(f)) return
      badRequests.push(`FAILED ${r.method()} ${safePath(r.url())} (${f})`)
    })
    page.on('response', (r) => {
      if (r.status() >= 500) badRequests.push(`${r.status()} ${safePath(r.url())}`)
    })

    const sep = path.includes('?') ? '&' : '?'
    const resp = await page.goto(`${path}${sep}token=${encodeURIComponent(token)}`, { waitUntil: 'load' })

    expect(resp?.status(), `HTTP status for ${path}`).toBeLessThan(400)
    await expect(page, `${path} should not bounce to /login`).not.toHaveURL(/\/login/, { timeout: 8000 })

    await page.waitForTimeout(2500)

    const unlabelled = await auditButtons(page)

    expect(consoleErrors, `console errors on ${path}:\n  ${consoleErrors.join('\n  ')}`).toEqual([])
    expect(badRequests, `failed/5xx requests on ${path}:\n  ${badRequests.join('\n  ')}`).toEqual([])
    expect(unlabelled, `unlabelled enabled buttons on ${path}:\n  ${unlabelled.join('\n  ')}`).toEqual([])
  })
}
