import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

// ── NEGATIVE / SECURITY — manager must not do HR/admin/finance work. All deterministic. ──

// Route guards (manager lacks the gating permission → "Access Restricted").
test('manager direct-access to /hrms/organization is blocked', async ({ page }) => {
  await page.goto('/hrms/organization') // anyOf[department.read, branch.read] — manager lacks both
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('manager direct-access to /users is blocked', async ({ page }) => {
  await page.goto('/users')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('manager direct-access to /roles is blocked', async ({ page }) => {
  await page.goto('/roles')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

test('manager direct-access to /audit-logs is blocked', async ({ page }) => {
  await page.goto('/audit-logs')
  await expect(page.getByText(/access restricted/i)).toBeVisible()
})

// Manager HAS letters.template.read (so the route loads) but NOT create/update → read-only.
test('manager can view letter templates but cannot create them', async ({ page }) => {
  await page.goto('/hrms/letters/templates')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
  // "Create template" is gated on letters.template.create (manager lacks) → not rendered.
  await expect(page.getByRole('button', { name: /create template/i })).toHaveCount(0)
})

// Backend permission enforcement — the definitive boundary.
test('manager cannot lock a payroll run (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/payroll/runs/00000000-0000-0000-0000-000000000000/lock', {
    method: 'POST',
    body: '{}',
  })
  expect(res.status).toBe(403)
})

test('manager cannot invite a workspace user (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/workspace/users/invite', {
    method: 'POST',
    body: JSON.stringify({ email: `forbidden-mgr-${Date.now()}@test.demo`, createEmployee: false, roleCodes: [] }),
  })
  expect(res.status).toBe(403)
})

test('manager cannot create a department (403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/departments', {
    method: 'POST',
    body: JSON.stringify({ companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55', name: `MGR-DENIED-${Date.now()}`, code: 'MGR1' }),
  })
  expect(res.status).toBe(403)
})

test('manager is denied admin/finance data endpoints (403)', async ({ apiRequest }) => {
  for (const path of [
    '/api/v1/workspace/users',
    '/api/v1/rbac/roles',
    '/api/v1/audit/events?page=0&size=5',
    '/api/v1/payroll/runs',
    '/api/v1/payroll/settings',
  ]) {
    const res = await apiRequest(path)
    expect(res.status, `${path} must be 403 for manager`).toBe(403)
  }
})
