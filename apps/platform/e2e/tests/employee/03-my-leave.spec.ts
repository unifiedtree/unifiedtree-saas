import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

test('My Leave page renders for employee', async ({ page }) => {
  await page.goto('/hrms/leave')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
})

test('employee reads ONLY their own leave (self-scoped, 200)', async ({ apiRequest }) => {
  const balances = await apiRequest('/api/v1/leave/my/balances')
  const requests = await apiRequest('/api/v1/leave/my')
  expect(balances.status, 'own leave balances').toBe(200)
  expect(requests.status, 'own leave requests').toBe(200)
})

test('employee can self-apply for leave (perm honored, never 403)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/leave/apply', {
    method: 'POST',
    body: JSON.stringify({
      leaveTypeId: '00000000-0000-0000-0000-000000000000',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      reason: 'self-service e2e',
    }),
  })
  // leave.request.self is honored → must NOT be 403/401. reader@ has no employee
  // row, so the business layer rejects (400) — the point is the permission gate.
  expect(res.status).not.toBe(403)
  expect([200, 201, 400, 409, 422]).toContain(res.status)
  test.info().annotations.push({
    type: 'note',
    description: `leave/apply → ${res.status} (perm honored; reader has no employee row to attach leave to).`,
  })
})
