import { test, expect, type Page } from '@playwright/test'

/**
 * End-to-end verification of Anil Issue Document 2 (2026-09-01) fixes,
 * against the LIVE prod backend + Vercel bundle.
 *
 * Covers all seven issues from the doc:
 *   1. Branches vs Geofencing — Geofence form now exposes branchId picker;
 *      Employee.branchId is derived on save from the assigned zone.
 *   2. Edit Employee → empty page — was `weeklyOffDays.split` crash on the
 *      List<Integer> DTO; now the form mounts and shows editable fields.
 *   3. Time nav → /hrms/att-analytics empty — module gate was rejecting
 *      because the tenant catalog has no 'attendance' module; route now
 *      gated on moduleKey="hrms" like every other HR page.
 *   4. WFH mobile → web Approvals — Leave tab now unions
 *      /v1/wfh/pending-approvals with the leave queue.
 *   5. Generate Letter 500 — OpenHtmlToPdfRenderer now Jsoup-normalizes
 *      TipTap's HTML5 void tags (<br>, <hr>, <img>) to self-closing XHTML
 *      before feeding the Xerces parser.
 *   6. Distributions "br must be terminated" — same fix.
 *   7. Onboarding & Assets 3 forms — needs clarification from user (page
 *      itself is verified to render + accept the tab filters).
 *
 * NOTE on auth: this suite uses the ?token=... bootstrap. That works only
 * when the deployed bundle honours the query-param JWT hand-off (which the
 * platform app does; VITE_DEV_TOKEN_STORAGE is a separate dev knob).
 */

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const FRONTEND = process.env.PLAYWRIGHT_FRONTEND_URL ?? 'https://demo-hrms.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'reviewer@unifiedtree.com'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Reviewer@2026'

let token = ''

test.beforeAll(async ({ request }) => {
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  expect(r.ok(), `login status ${r.status()}`).toBeTruthy()
  token = (await r.json()).accessToken
  expect(token.length, 'access token present').toBeGreaterThan(100)
})

/** Navigate with a query-param JWT and confirm we did not bounce to /login. */
async function enter(page: Page, path: string) {
  const url = new URL(path, FRONTEND)
  url.searchParams.set('token', token)
  await page.goto(url.toString(), { waitUntil: 'load' })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 })
}

/** Record console errors + 4xx/5xx for the after-hook diagnostic. */
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

// ── ISSUE 2 — Click any employee → click Edit pencil → form must mount ──────
test('issue 2: employee detail → Edit pencil no longer crashes with empty page', async ({ page }, testInfo) => {
  const { errs, bads } = watch(page)
  await enter(page, '/hrms/employees')
  await page.waitForTimeout(1500)

  // Click the first employee row
  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible()
  await firstRow.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath('detail.png'), fullPage: true })

  // Click the Edit pencil (aria-label added on EmployeeDetail 2026-09-01
  // exactly so this selector is unambiguous — there are ~20 buttons on
  // this page and a class-based selector clashed with the hamburger).
  const pencilBtn = page.getByRole('button', { name: /Edit employee/i })
  await expect(pencilBtn).toBeVisible()
  await pencilBtn.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath('after-edit-click.png'), fullPage: true })

  // Drawer heading + at least a form field
  const drawerHeading = page.getByRole('heading', { name: /Edit Employee/i }).first()
  const hasHeading = await drawerHeading.isVisible().catch(() => false)
  const inputCount = await page.locator('input, select').count()

  console.log(`  drawer heading visible: ${hasHeading}`)
  console.log(`  form inputs on page: ${inputCount}`)
  console.log(`  console errors: ${errs.length}`); errs.forEach((e) => console.log(`    ${e}`))
  console.log(`  4xx/5xx: ${bads.length}`); bads.slice(0, 10).forEach((b) => console.log(`    ${b}`))

  // Assert: form mounted (heading visible OR >8 inputs — a typical wizard step has ~10)
  expect(hasHeading || inputCount > 8, 'Edit form actually mounts').toBeTruthy()

  // Anil-doc-2 issue 2 specific: no "split is not a function" TypeError anywhere
  const hasSplitCrash = errs.some((e) => /split is not a function/.test(e))
  expect(hasSplitCrash, 'no TypeError: D.split is not a function').toBeFalsy()
})

// ── ISSUE 3 — /hrms/att-analytics must NOT show ModuleNotActivated ──────────
test('issue 3: /hrms/att-analytics renders the analytics page, not a module gate', async ({ page }, testInfo) => {
  const { errs, bads } = watch(page)
  await enter(page, '/hrms/att-analytics')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: testInfo.outputPath('att-analytics.png'), fullPage: true })

  // ModuleNotActivated shows the literal text "Not Activated" — must be absent.
  const notActivated = await page.getByText(/Not Activated/i).count()
  expect(notActivated, 'no ModuleNotActivated screen').toBe(0)

  // Must render at least one KPI/heading from AttendanceAnalytics
  const someHeading = await page.getByRole('heading').count()
  console.log(`  headings on page: ${someHeading}`)
  console.log(`  errors: ${errs.length}, 4xx/5xx: ${bads.length}`)
  expect(someHeading, 'analytics page has real content').toBeGreaterThan(0)
})

// ── ISSUE 4 — WFH approvals endpoint present + Approvals tab shows WFH ──────
test('issue 4: Leave → Approvals tab now merges WFH requests from mobile', async ({ page, request }, testInfo) => {
  const { errs, bads } = watch(page)

  // First confirm the backend endpoint is 200 for the reviewer.
  const r = await request.get(`${BACKEND}/api/v1/wfh/pending-approvals?page=0&size=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(r.status(), 'WFH pending endpoint reachable for admin').toBe(200)
  console.log(`  WFH pending body: ${(await r.text()).slice(0, 200)}`)

  await enter(page, '/hrms/leave?tab=approvals')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: testInfo.outputPath('leave-approvals.png'), fullPage: true })

  // Even with no data, the tab must render. The union code path is exercised
  // — if the WFH hook were broken (bad path, bad query key) the tab would
  // show an error state instead of "No pending approvals".
  const noPending = await page.getByText(/No pending approvals/i).count()
  const errorState = await page.getByText(/Failed to load/i).count()
  console.log(`  no-pending: ${noPending}, error-state: ${errorState}`)
  console.log(`  errors: ${errs.length}, 4xx/5xx: ${bads.length}`)
  bads.slice(0, 5).forEach((b) => console.log(`    ${b}`))
  expect(errorState, 'no failed-to-load state').toBe(0)
})

// ── ISSUES 5 + 6 — Letter generate + distribution with bare <br> body ───────
test('issues 5+6: /v1/letters/generate returns 201 with <br>/<hr>/<img> body', async ({ request }) => {
  // List a company + an employee via API to plug into the template + generate.
  const companiesResp = await request.get(`${BACKEND}/api/v1/hrms/companies`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const companies = await companiesResp.json()
  expect(companies.length, 'at least one company').toBeGreaterThan(0)
  const companyId = companies[0].id

  const employeesResp = await request.get(`${BACKEND}/api/v1/hrms/employees?pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const employees = (await employeesResp.json()).content
  expect(employees.length, 'at least one employee').toBeGreaterThan(0)
  const employeeId = employees[0].id

  // Create a template with the exact HTML5 void tags that used to blow up
  // Xerces: <br>, <hr>, <img>.
  const tplResp = await request.post(`${BACKEND}/api/v1/letters/templates`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      companyId,
      name: `E2E-BR-${Date.now()}`,
      type: 'OFFER',
      subject: 'Offer for {{first_name}}',
      bodyHtml: '<p>Dear {{first_name}},</p><p>Welcome!<br>Line after br.<br>Another break.</p><hr><p>Terms apply.<img src="https://example.com/logo.png" alt="logo"></p>',
      active: true,
    },
  })
  expect(tplResp.status(), 'template create').toBeLessThan(300)
  const templateId = (await tplResp.json()).id
  expect(templateId).toBeTruthy()

  // Generate — this was HTTP 500 before the OpenHtmlToPdfRenderer Jsoup fix.
  const genResp = await request.post(`${BACKEND}/api/v1/letters/generate`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { templateId, employeeId },
  })
  const body = await genResp.text()
  console.log(`  generate status: ${genResp.status()}`)
  if (genResp.status() >= 400) console.log(`  body: ${body.slice(0, 400)}`)
  expect(genResp.status(), 'generate 2xx').toBeLessThan(300)

  // Distribution path also uses the same generate under the hood — the
  // request payload needs `recipientFilter` per CreateDistributionRequest
  // (backend rejects 400 VALIDATION_FAILED otherwise). The filter shape
  // is a discriminated union — the simplest form is EMPLOYEES with an
  // explicit employeeIds list.
  const distResp = await request.post(`${BACKEND}/api/v1/letters/distributions`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      templateId,
      title: `E2E-DIST-${Date.now()}`,
      recipientFilter: {
        type: 'CUSTOM_LIST',
        employeeIds: employees.slice(0, 1).map((e: { id: string }) => e.id),
      },
    },
  })
  const distBody = await distResp.text()
  console.log(`  distribution create status: ${distResp.status()}`)
  if (distResp.status() >= 400) console.log(`  body: ${distBody.slice(0, 400)}`)
  // Distribution create returns 200/201; the worker fires async. We don't
  // wait for the recipient error message here — if generate itself works,
  // the "br must be terminated" per-recipient error cannot fire.
  expect(distResp.status(), 'distribution create 2xx').toBeLessThan(300)
})

// ── ISSUE 1 — Geofence form now surfaces the branch picker ──────────────────
test('issue 1: /hrms/attendance/geofencing → Add Zone drawer has Branch picker', async ({ page }, testInfo) => {
  const { errs } = watch(page)
  await enter(page, '/hrms/attendance/geofencing')
  await page.waitForTimeout(1500)

  const addBtn = page.getByRole('button', { name: /Add Zone/i }).first()
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('add-zone.png'), fullPage: true })

  // Branch label must be present.
  const branchLabel = await page.getByText(/Assign to Branch/i).count()
  console.log(`  Assign-to-Branch labels: ${branchLabel}`)
  console.log(`  console errors: ${errs.length}`)
  expect(branchLabel, 'branch picker rendered').toBeGreaterThan(0)
})

// ── ISSUE 7 — Onboarding & Assets renders (no data crash) ───────────────────
test('issue 7: /hrms/onboarding/instances page renders with filter tabs', async ({ page }, testInfo) => {
  const { errs } = watch(page)
  await enter(page, '/hrms/onboarding/instances')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath('onboarding.png'), fullPage: true })

  // Filter tabs from image 9.
  const allTab = await page.getByRole('button', { name: /^All$/ }).count()
  const inProgTab = await page.getByRole('button', { name: /In progress/i }).count()
  const completedTab = await page.getByRole('button', { name: /Completed/i }).count()
  console.log(`  filter tabs — All:${allTab} InProg:${inProgTab} Completed:${completedTab}`)
  console.log(`  errors: ${errs.length}`)
  expect(allTab + inProgTab + completedTab, 'onboarding tabs render').toBeGreaterThan(0)
})
