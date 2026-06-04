import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

// ── NEGATIVE / SECURITY tests — HR must NOT be able to do platform-admin things. ──
// These run unconditionally (no data dependencies) and assert the real boundaries.

// 1–3: the platform-admin routes are now permission-guarded (a fix from this suite —
// previously unguarded, relying only on a hidden sidebar + backend 403). HR lacks the
// gating permission → RouteGuard shows "Access Restricted".

test('HR direct-access to /roles is blocked (Access Restricted)', async ({ page }) => {
  await page.goto('/roles')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('HR direct-access to /audit-logs is blocked (Access Restricted)', async ({ page }) => {
  await page.goto('/audit-logs')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('HR direct-access to /users is blocked (Access Restricted)', async ({ page }) => {
  await page.goto('/users')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

// 4–6: backend permission enforcement — the definitive security boundary.

test('HR cannot lock a payroll run (lacks payroll.runs.lock → 403)', async ({ apiRequest }) => {
  // @PreAuthorize is evaluated before the handler, so a non-existent run id still yields 403
  // (permission denied) rather than 404 — no dependency on a DRAFT run existing.
  const res = await apiRequest('/api/v1/payroll/runs/11111111-1111-1111-1111-111111111111/lock', {
    method: 'POST',
    body: '{}',
  })
  expect(res.status, 'payroll lock denied for HR').toBe(403)
})

test('HR cannot invite a workspace user (lacks workspace.users.manage → 403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/workspace/users/invite', {
    method: 'POST',
    body: JSON.stringify({ email: `forbidden-${Date.now()}@test.demo`, createEmployee: false, roleCodes: [] }),
  })
  expect(res.status, 'workspace invite denied for HR').toBe(403)
})

test('HR cannot create an RBAC role', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/rbac/roles', {
    method: 'POST',
    body: JSON.stringify({ code: 'HR_FORBIDDEN_ROLE', name: 'Should Not Exist' }),
  })
  // HR is blocked. There is no POST /v1/rbac/roles handler (create-role is a backend TODO),
  // so the POST hits the GET-only mapping → 405 Method Not Allowed (this was previously
  // mis-mapped to 500 by the catch-all; fixed by adding a 405 handler to
  // GlobalExceptionHandler). Either way HR can never create a role: never 2xx.
  expect([403, 404, 405], `rbac role create must be cleanly blocked (got ${res.status})`).toContain(res.status)
})

// 7: the platform-admin DATA endpoints are 403 for HR (defense at the data layer).

test('HR is denied the platform-admin data endpoints (403)', async ({ apiRequest }) => {
  for (const path of ['/api/v1/rbac/roles', '/api/v1/audit/events?page=0&size=5', '/api/v1/workspace/users']) {
    const res = await apiRequest(path)
    expect(res.status, `${path} must be 403 for HR`).toBe(403)
  }
})
