import { test, expect, type Page } from '@playwright/test'

/**
 * Regression sweep for everything changed on 2026-09-09.
 *
 * 35 frontend files changed that day and none had been opened in a browser —
 * they only had `tsc --noEmit`. TypeScript cannot catch a null deref inside a
 * render, a conditional hook, or a component that throws on mount, and any of
 * those white-screens the page for the client while the API behind it is
 * perfectly healthy. That is precisely the gap between "the endpoint works"
 * and "the button works".
 *
 * So this asserts what tsc cannot:
 *   1. the route renders real chrome (not React's blank body after an error)
 *   2. no uncaught page error and no console error
 *   3. the page is not showing an error boundary / crash state
 *
 * It deliberately does NOT assert on data — the demo tenant is nearly empty,
 * and "table has rows" would fail for reasons that are not defects.
 */

/**
 * All four roles, not just admin.
 *
 * Testing as an administrator proves almost nothing about the seats the client
 * actually staffs. On 2026-09-09 the two worst defects were both invisible to
 * an admin account: PUT /v1/users/me silently discarded every Profile save,
 * and a missing @securityHelper bean 500'd every plain employee reading their
 * own record — while admins got a clean 200 on both, because a SpEL
 * short-circuit meant they never evaluated the broken half of the guard. An
 * admin-only sweep would have gone green through both.
 */
const ACCOUNTS = {
  ADMIN: { email: 'reviewer@unifiedtree.com',              password: 'Reviewer@2026' },
  HR:    { email: 'e2e-hr-parity@unifiedtree.example',     password: 'E2eParity@2026' },
  MGR:   { email: 'e2e-mgr-parity@unifiedtree.example',    password: 'E2eParity@2026' },
  EMP:   { email: 'e2e-emp-parity@unifiedtree.example',    password: 'E2eParity@2026' },
} as const

type RoleName = keyof typeof ACCOUNTS

/** Every route whose page or hooks changed on 2026-09-09. */
const ROUTES: { path: string; label: string }[] = [
  { path: '/hrms/learning',                 label: 'Learning (module rebuilt)' },
  { path: '/hrms/bank-disbursement',        label: 'Bank Disbursement (batch + profile panels)' },
  { path: '/hrms/onboarding/instances',     label: 'Onboarding Instances (start control)' },
  { path: '/hrms/onboarding/templates',     label: 'Onboarding Templates' },
  { path: '/hrms/policies',                 label: 'Policies (status filter + restore)' },
  { path: '/hrms/compliance',               label: 'Compliance (3 paginated registers)' },
  { path: '/hrms/documents',                label: 'Document Vault (pagination)' },
  { path: '/hrms/pli',                      label: 'PLI (pagination)' },
  { path: '/hrms/fnf',                      label: 'Full & Final (pagination)' },
  { path: '/hrms/expense',                  label: 'Expense (detail expand + caps)' },
  { path: '/hrms/hiring',                   label: 'Hiring (requisition edit drawer)' },
  { path: '/hrms/organization',             label: 'Org Setup (dept rename, designation fix)' },
  { path: '/hrms/attendance',               label: 'Attendance (corrections gating)' },
  { path: '/hrms/muster-roll',              label: 'Muster Roll (export + dept filter)' },
  // 2026-09-10: this route was MISSING from the sweep, which is why 96/96
  // was green while it crashed in production on a null employee_name.
  { path: '/hrms/att-analytics',            label: 'Attendance Analytics (Time tab)' },
  { path: '/hrms/workforce-analytics',      label: 'Workforce Analytics' },
  { path: '/hrms/leave',                    label: 'Leave (weekend-day preview)' },
  { path: '/hrms/performance',              label: 'Performance (Cycles gating)' },
  { path: '/hrms/attendance/manual-entry',  label: 'Manual Entry (team-roster fallback)' },
  { path: '/hrms/shifts-ot',                label: 'Shifts & Overtime (new CRUD)' },
  { path: '/hrms/employees',                label: 'Employees (form gating)' },
  { path: '/profile',                       label: 'Profile (PUT now persists)' },
  { path: '/hrms/reports/headcount',        label: 'Report: Headcount (export button)' },
  { path: '/hrms/reports/attrition',        label: 'Report: Attrition (export button)' },
  { path: '/hrms/reports/attendance-summary', label: 'Report: Attendance (export button)' },
  { path: '/hrms/reports/late-marks',       label: 'Report: Late Marks (export button)' },
  { path: '/hrms/reports/leave-balance',    label: 'Report: Leave Balance (export button)' },
  { path: '/hrms/reports/diversity',        label: 'Report: Diversity (export button)' },
]

/**
 * The login form's placeholders are "you@company.com" and a row of bullet
 * characters — neither contains the words "email" or "password", so matching
 * on those regexes finds nothing. Target the two textboxes positionally
 * instead, which is stable against copy changes.
 */
async function login(page: Page, role: RoleName) {
  const creds = ACCOUNTS[role]
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  const boxes = page.getByRole('textbox')
  await boxes.first().waitFor({ state: 'visible', timeout: 30_000 })
  await boxes.nth(0).fill(creds.email)
  await boxes.nth(1).fill(creds.password)
  await page.getByRole('button', { name: /^log ?in$|^sign ?in$/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 })
}

for (const role of Object.keys(ACCOUNTS) as RoleName[]) {
test.describe(`2026-09-09 regression [${role}] — pages render without crashing`, () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page

  // Login against a cold Cloud Run instance can take a while; the default 60s
  // hook timeout was being consumed by the page load alone.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000)
    page = await browser.newPage()
    await login(page, role)
  })

  test.afterAll(async () => { await page?.close() })

  for (const route of ROUTES) {
    test(`${role}: ${route.label}`, async () => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      const onConsole = (m: { type: () => string; text: () => string }) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
      }
      const onPageError = (e: Error) => pageErrors.push(e.message)
      page.on('console', onConsole)
      page.on('pageerror', onPageError)

      try {
        await page.goto(route.path, { waitUntil: 'domcontentloaded' })
        // Let react-query settle so a render triggered by data arrival is covered.
        await page.waitForTimeout(3500)

        // A crashed React tree leaves an essentially empty body.
        const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
        expect(bodyText.trim().length, 'page rendered no text — likely a crashed render').toBeGreaterThan(40)

        // Explicit crash states this app can show.
        //
        // "This page hit an error" is RouteErrorBoundary's fallback, added
        // 2026-09-10. It matters that this assertion exists: the boundary
        // renders real copy, so a crashed page now passes the bodyText length
        // check above. Without this line the sweep would go blind to exactly
        // the failure it was written to catch.
        await expect(page.getByText(/something went wrong|unexpected error|application error|this page hit an error/i))
          .toHaveCount(0)

        // A render-phase throw is the failure tsc cannot see. Ignore network
        // noise (4xx/5xx are covered by the API probes, and a 403 on a gated
        // widget is correct behaviour, not a crash).
        const realPageErrors = pageErrors.filter(
          (e) => !/Failed to fetch|NetworkError|Load failed/i.test(e),
        )
        expect(realPageErrors, `uncaught error on ${route.path}`).toEqual([])

        const realConsoleErrors = consoleErrors.filter(
          (e) => !/(Failed to load resource|net::ERR|40[0-9]|50[0-9]|favicon|Download the React DevTools)/i.test(e),
        )
        expect(realConsoleErrors, `console errors on ${route.path}`).toEqual([])
      } finally {
        page.off('console', onConsole)
        page.off('pageerror', onPageError)
      }
    })
  }
})
}
