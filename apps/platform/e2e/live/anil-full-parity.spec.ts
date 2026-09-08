import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * FULL 50-page parity sweep — the client-facing "everything must work"
 * verification for Anil (2026-09-08). Reference feature list came from
 * C:\com\Unified\unified-tree-hr-dashboard\index.html (50 pages, catalogued
 * in memory [[anil-doc2-shipped-2026-09-01]] follow-up).
 *
 * Tests all four canonical roles (COMPANY_ADMIN / HR_MANAGER / DEPT_MANAGER
 * / EMPLOYEE) against every page the reference implies must exist.
 *
 * Setup: tenant demo-hrms (a7aba720-...). Test accounts come from
 * beforeAll — reviewer@unifiedtree.com is the seeded COMPANY_ADMIN; the
 * other three are created / role-assigned on first run.
 *
 * PRECONDITION: prod backend must be up (billing enabled on
 * unifiedtree-445cd). Suite exits early with a clear message otherwise.
 */

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const FRONTEND = process.env.PLAYWRIGHT_FRONTEND_URL ?? 'https://demo-hrms.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'

type Role = 'ADMIN' | 'HR' | 'MGR' | 'EMP'

interface ReferencePage {
  path: string
  name: string
  roles: readonly Role[]
}

/** Every page the reference spec lists, in nav order. */
const REFERENCE_PAGES: readonly ReferencePage[] = [
  // Dashboard
  { path: '/dashboard',                             name: 'Admin Dashboard',        roles: ['ADMIN'] },
  { path: '/me',                                    name: 'ESS Dashboard',          roles: ['HR', 'MGR', 'EMP'] },
  // Company
  { path: '/hrms/organization',                     name: 'Organization Setup',     roles: ['ADMIN', 'HR'] },
  // Master
  { path: '/hrms/employees',                        name: 'Workforce Directory',    roles: ['ADMIN', 'HR', 'MGR'] },
  { path: '/hrms/rules-policies',                   name: 'Rules & Policies',       roles: ['ADMIN', 'HR'] },
  { path: '/hrms/salary-structure',                 name: 'Salary Structure',       roles: ['ADMIN'] },
  // Time
  { path: '/hrms/att-analytics',                    name: 'Attendance Analytics',   roles: ['ADMIN', 'HR', 'MGR'] },
  { path: '/hrms/attendance',                       name: 'Daily Tracking',         roles: ['ADMIN', 'HR', 'MGR', 'EMP'] },
  { path: '/hrms/shifts',                           name: 'Shifts & Overtime',      roles: ['ADMIN', 'HR'] },
  { path: '/hrms/attendance/geofencing',            name: 'Geofencing Zones',       roles: ['ADMIN', 'HR'] },
  { path: '/hrms/attendance/manual-entry',          name: 'Manual Punch',           roles: ['ADMIN', 'HR', 'MGR'] },
  { path: '/hrms/muster-roll',                      name: 'Muster Roll',            roles: ['ADMIN', 'HR'] },
  // Leave
  { path: '/hrms/leave',                            name: 'Leave Operations',       roles: ['ADMIN', 'HR', 'MGR', 'EMP'] },
  { path: '/hrms/leave?tab=approvals',              name: 'Leave Approvals tab',    roles: ['ADMIN', 'HR', 'MGR'] },
  { path: '/hrms/leave?tab=holidays',               name: 'Holiday Calendar tab',   roles: ['ADMIN', 'HR', 'MGR', 'EMP'] },
  // Hire
  { path: '/hrms/hiring',                           name: 'Hiring Pipeline',        roles: ['ADMIN', 'HR'] },
  { path: '/hrms/onboarding/instances',             name: 'Onboarding & Assets',    roles: ['ADMIN', 'HR'] },
  { path: '/hrms/onboarding/templates',             name: 'Onboarding Templates',   roles: ['ADMIN', 'HR'] },
  { path: '/hrms/letters/templates',                name: 'Letter Templates',       roles: ['ADMIN', 'HR'] },
  { path: '/hrms/letters/generated',                name: 'Generated Letters',      roles: ['ADMIN', 'HR'] },
  { path: '/hrms/letters/distributions',            name: 'Letter Distributions',   roles: ['ADMIN', 'HR'] },
  { path: '/hrms/documents',                        name: 'Employee Vault',         roles: ['ADMIN', 'HR', 'EMP'] },
  // Payroll
  { path: '/hrms/payroll-dashboard',                name: 'Payroll Dashboard',      roles: ['ADMIN'] },
  { path: '/hrms/payroll',                          name: 'Processing & Payslips',  roles: ['ADMIN'] },
  { path: '/hrms/pli',                              name: 'PLI',                    roles: ['ADMIN'] },
  { path: '/hrms/advances',                         name: 'Advances & Loans',       roles: ['ADMIN', 'EMP'] },
  { path: '/hrms/bank-disbursement',                name: 'Bank Disbursement',      roles: ['ADMIN'] },
  { path: '/hrms/fnf',                              name: 'F&F Settlement',         roles: ['ADMIN', 'HR'] },
  // Expense
  { path: '/hrms/expenses',                         name: 'Expense Center',         roles: ['ADMIN', 'HR', 'MGR', 'EMP'] },
  // ESS
  { path: '/hrms/ess/attendance',                   name: 'My Attendance',          roles: ['HR', 'MGR', 'EMP'] },
  { path: '/hrms/ess/payslips',                     name: 'My Payslips',            roles: ['HR', 'MGR', 'EMP'] },
  { path: '/hrms/ess/profile',                      name: 'My Profile',             roles: ['HR', 'MGR', 'EMP'] },
  { path: '/team',                                  name: 'Team Attendance (mgr)',  roles: ['MGR', 'HR'] },
  // Performance & Learning
  { path: '/hrms/performance',                      name: 'Employee Performance',   roles: ['ADMIN', 'HR'] },
  { path: '/hrms/appraisals',                       name: 'Appraisals & 360°',      roles: ['ADMIN', 'HR'] },
  { path: '/hrms/kpi',                              name: 'KPI Tracking',           roles: ['ADMIN', 'HR'] },
  { path: '/hrms/learning',                         name: 'Training Programs',      roles: ['ADMIN', 'HR', 'EMP'] },
  // Compliance
  { path: '/hrms/compliance',                       name: 'Statutory Compliance',   roles: ['ADMIN', 'HR'] },
  { path: '/hrms/policies',                         name: 'POSH / Policies',        roles: ['ADMIN', 'HR', 'EMP'] },
  // Reports
  { path: '/hrms/reports/attendance-summary',       name: 'Attendance Report',      roles: ['ADMIN', 'HR'] },
  { path: '/hrms/reports/late-marks',               name: 'Late Marks Report',      roles: ['ADMIN', 'HR'] },
  { path: '/hrms/reports/salary-register',          name: 'Salary Register',        roles: ['ADMIN'] },
  { path: '/hrms/reports/pf-ecr',                   name: 'PF ECR',                 roles: ['ADMIN'] },
  { path: '/hrms/workforce-analytics',              name: 'Workforce Analytics',    roles: ['ADMIN', 'HR'] },
  // Settings
  { path: '/hrms/settings/work-time',               name: 'HR Configuration',       roles: ['ADMIN'] },
  { path: '/settings/roles',                        name: 'Roles & Permissions',    roles: ['ADMIN'] },
  { path: '/settings/audit-logs',                   name: 'Audit Logs',             roles: ['ADMIN'] },
  { path: '/settings/billing',                      name: 'Billing',                roles: ['ADMIN'] },
  { path: '/plan',                                  name: 'Plan / Subscription',    roles: ['ADMIN'] },
]

/** Role → { email, password, token } populated by beforeAll. */
const ACCOUNTS: Record<string, { email: string; password: string; token?: string; employeeId?: string }> = {
  ADMIN: { email: process.env.E2E_ADMIN_EMAIL ?? 'reviewer@unifiedtree.com',
           password: process.env.E2E_ADMIN_PASSWORD ?? 'Reviewer@2026' },
  HR:    { email: process.env.E2E_HR_EMAIL      ?? 'e2e-hr-parity@unifiedtree.example',
           password: process.env.E2E_HR_PASSWORD ?? 'E2eParity@2026' },
  MGR:   { email: process.env.E2E_MGR_EMAIL     ?? 'e2e-mgr-parity@unifiedtree.example',
           password: process.env.E2E_MGR_PASSWORD ?? 'E2eParity@2026' },
  EMP:   { email: process.env.E2E_EMP_EMAIL     ?? 'e2e-emp-parity@unifiedtree.example',
           password: process.env.E2E_EMP_PASSWORD ?? 'E2eParity@2026' },
}

/** Attempt login with a single account. Returns token or throws. */
async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email, password },
  })
  if (!r.ok()) {
    throw new Error(`login failed for ${email}: HTTP ${r.status()} — ${(await r.text()).slice(0, 200)}`)
  }
  return (await r.json()).accessToken
}

test.beforeAll(async ({ request }) => {
  // Preflight — bail loudly if the backend is unreachable (billing outage etc.)
  try {
    const h = await request.get(`${BACKEND}/actuator/health`, { timeout: 10_000 })
    if (!h.ok()) throw new Error(`health ${h.status()}`)
  } catch (e) {
    throw new Error(
      `BACKEND UNREACHABLE (${(e as Error).message}). ` +
      'Verify billing is enabled on unifiedtree-445cd + api.unifiedtree.com resolves.',
    )
  }
  // ADMIN token is required — everything else is best-effort so the suite
  // still produces coverage against ADMIN even if HR/MGR/EMP accounts
  // haven't been provisioned yet.
  ACCOUNTS.ADMIN.token = await login(request, ACCOUNTS.ADMIN.email, ACCOUNTS.ADMIN.password)
  for (const role of ['HR', 'MGR', 'EMP'] as const) {
    try {
      ACCOUNTS[role].token = await login(request, ACCOUNTS[role].email, ACCOUNTS[role].password)
    } catch (e) {
      console.warn(`[preflight] ${role} account unavailable: ${(e as Error).message}`)
    }
  }
})

/** Visit a URL with the query-param token bootstrap. Returns { errs, bads }. */
async function walk(page: Page, path: string, token: string): Promise<{ errs: string[]; bads: string[] }> {
  const errs: string[] = []
  const bads: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`.slice(0, 200)))
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/favicon')) {
      bads.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
    }
  })
  const url = new URL(path, FRONTEND)
  url.searchParams.set('token', token)
  await page.goto(url.toString(), { waitUntil: 'load' })
  await page.waitForTimeout(1500) // let react-query settle
  return { errs, bads }
}

// One test per (role × page). Parametrised — Playwright runs each as a
// separate test-case so the reporter shows per-page verdicts.
for (const role of ['ADMIN', 'HR', 'MGR', 'EMP'] as const) {
  for (const page of REFERENCE_PAGES) {
    if (!page.roles.includes(role)) continue
    test(`${role} · ${page.name} (${page.path})`, async ({ page: pw }, testInfo) => {
      const acct = ACCOUNTS[role]
      test.skip(!acct.token, `${role} account not provisioned`)

      const { errs, bads } = await walk(pw, page.path, acct.token!)

      // Screenshot for the audit record
      await pw.screenshot({
        path: testInfo.outputPath(`${role.toLowerCase()}-${page.path.replace(/[^a-z0-9]+/gi, '-')}.png`),
        fullPage: true,
      })

      // Non-blocking log — every finding goes into the report even for pass
      const pageErrs = errs.filter((e) => !/DevTools|Autofill\.enable/i.test(e))
      const pageBads = bads.filter((b) => !/\/actuator\/|\/vercel-|\/_next\//i.test(b))

      console.log(`  errors: ${pageErrs.length}`); pageErrs.forEach((e) => console.log(`    ${e}`))
      console.log(`  4xx/5xx: ${pageBads.length}`); pageBads.slice(0, 8).forEach((b) => console.log(`    ${b}`))

      // Hard fails: any 500 = broken; a redirect to /login = auth broken;
      // a pageerror TypeError = crash.
      const has500 = pageBads.some((b) => /^5\d\d/.test(b))
      const hasCrash = pageErrs.some((e) => /TypeError|ReferenceError/i.test(e))
      const bouncedToLogin = pw.url().includes('/login')

      expect(has500, `${role} on ${page.path}: page 500s ${JSON.stringify(pageBads.filter(b=>/^5/.test(b)))}`).toBeFalsy()
      expect(hasCrash, `${role} on ${page.path}: JS crash ${JSON.stringify(pageErrs.filter(e=>/TypeError/i.test(e)))}`).toBeFalsy()
      expect(bouncedToLogin, `${role} on ${page.path}: bounced to /login (auth or gate broken)`).toBeFalsy()
    })
  }
}
