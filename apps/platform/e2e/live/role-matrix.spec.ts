import { test, expect, type Page } from '@playwright/test'

// Role-by-role render matrix against the LIVE demo-hrms tenant.
// Verifies the 2026-08-22 role-overlap fixes (Anil #3): each role must see
// exactly its own Leave tabs and Dashboard tiles — nothing more, nothing less.
//
// Run:
//   E2E_ROLE_PASSWORD=... npx playwright test e2e/live/role-matrix.spec.ts \
//     --config playwright.live.config.ts
// with PLAYWRIGHT_BASE_URL=https://demo-hrms.unifiedtree.com
//     PLAYWRIGHT_BACKEND_URL=https://api.unifiedtree.com

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const TENANT_ID = process.env.E2E_ROLE_TENANT_ID ?? 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const PASSWORD = process.env.E2E_ROLE_PASSWORD
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? PASSWORD
// (TOKEN_KEY removed - sessionStorage bootstrap does not work against prod builds)

interface RoleCase {
  label: string
  email: string
  password?: string
  leave: { visible: string[]; hidden: string[] }
  dashboard: { visible: string[]; hidden: string[] }
}

const CASES: RoleCase[] = [
  {
    label: 'ADMIN (OWNER+SUPER_ADMIN)',
    email: 'reviewer@unifiedtree.com',
    password: ADMIN_PASSWORD,
    // Client rule 2026-08-22: admins manage leave, they don't apply for it.
    leave: {
      visible: ['Approvals', 'Leave Types', 'Holidays'],
      hidden: ['My Leaves', 'Apply', 'Balances'],
    },
    dashboard: {
      visible: ['Total Employees'],
      hidden: ['My Attendance', 'Your Attendance', 'Team Attendance'],
    },
  },
  {
    label: 'HR_MANAGER',
    email: 'priya@demo-hrms.unifiedtree.com',
    leave: {
      visible: ['My Leaves', 'Apply', 'Balances', 'Approvals', 'Leave Types', 'Holidays'],
      hidden: [],
    },
    dashboard: {
      visible: ['Total Employees', 'Your Attendance'],
      hidden: ['Team Attendance'],
    },
  },
  {
    label: 'DEPT_MANAGER',
    email: 'rahul@demo-hrms.unifiedtree.com',
    leave: {
      visible: ['My Leaves', 'Apply', 'Balances', 'Approvals', 'Leave Types', 'Holidays'],
      hidden: [],
    },
    dashboard: {
      // Label fix: manager's card shows their OWN attendance — never "Team".
      visible: ['My Attendance'],
      hidden: ['Team Attendance', 'Total Employees'],
    },
  },
  {
    label: 'FINANCE_LEAD',
    email: 'qa-invite-test-1786619014@unifiedtree.example',
    leave: {
      // V066 revoked leave-approve from finance.
      visible: ['My Leaves', 'Apply', 'Balances', 'Leave Types', 'Holidays'],
      hidden: ['Approvals'],
    },
    dashboard: {
      // isFinance fix: finance holds hrms.employee.read → workforce tiles show.
      visible: ['Total Employees'],
      hidden: ['Team Attendance'],
    },
  },
  {
    label: 'EMPLOYEE',
    email: 'aisha@demo-hrms.unifiedtree.com',
    leave: {
      visible: ['My Leaves', 'Apply', 'Balances', 'Leave Types', 'Holidays'],
      hidden: ['Approvals'],
    },
    dashboard: {
      visible: ['My Attendance'],
      hidden: ['Total Employees', 'Team Attendance'],
    },
  },
]

async function loginToken(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email, password },
  })
  expect(r.ok(), `API login for ${email} (status ${r.status()})`).toBeTruthy()
  const token = (await r.json()).accessToken
  expect(token, `access token for ${email}`).toBeTruthy()
  return token
}

// A tab/tile label is "present" if a button/link/heading with that exact text
// exists. Scoped to exact text to avoid e.g. "Apply" matching "Apply filters".
function exact(page: Page, label: string) {
  return page.locator('button, a, h3, h4, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
}

for (const c of CASES) {
  test.describe(c.label, () => {
    let token = ''
    test.beforeAll(async ({ request }) => {
      test.skip(!PASSWORD, 'Set E2E_ROLE_PASSWORD to run the role-matrix suite')
      token = await loginToken(request, c.email, c.password ?? PASSWORD!)
    })
    // NOTE: do NOT try to seed sessionStorage here. The SDK keeps the access
    // token in module memory and only mirrors it to sessionStorage when
    // VITE_DEV_TOKEN_STORAGE=session — a dev-only flag that is NOT set in
    // .env.production. Against a deployed workspace the only supported
    // bootstrap is the ?token= query param that AuthProvider reads on mount
    // (the same one "Enter Workspace" uses), so every goto carries it.
    const enter = async (page: Page, path: string) => {
      const sep = path.includes('?') ? '&' : '?'
      await page.goto(`${path}${sep}token=${encodeURIComponent(token)}`, { waitUntil: 'load' })
    }

    test('Leave tabs match the role contract', async ({ page }) => {
      await enter(page, '/hrms/leave')
      await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 })
      await page.waitForTimeout(2500)
      for (const label of c.leave.visible) {
        await expect(exact(page, label).first(), `${c.label} should SEE Leave tab "${label}"`).toBeVisible()
      }
      for (const label of c.leave.hidden) {
        await expect(exact(page, label), `${c.label} should NOT see Leave tab "${label}"`).toHaveCount(0)
      }
    })

    test('Dashboard tiles match the role contract', async ({ page }) => {
      await enter(page, '/dashboard')
      await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 })
      await page.waitForTimeout(2500)
      for (const label of c.dashboard.visible) {
        await expect(page.getByText(label, { exact: true }).first(), `${c.label} should SEE "${label}"`).toBeVisible()
      }
      for (const label of c.dashboard.hidden) {
        await expect(page.getByText(label, { exact: true }), `${c.label} should NOT see "${label}"`).toHaveCount(0)
      }
    })
  })
}
