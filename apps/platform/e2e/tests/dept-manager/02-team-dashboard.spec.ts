import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

test('team dashboard renders without errors', async ({ page }) => {
  // /team RouteGuard = anyOf[ATTENDANCE_TEAM_READ, LEAVE_APPROVE_L1, EMPLOYEE_READ] — manager has all.
  await page.goto('/team')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  await expect(page.locator('body')).toContainText(/team|attendance|leave|welcome|today|members/i)
})

test('team dashboard data endpoint is healthy for manager', async ({ apiRequest }) => {
  // TeamDashboard reads /v1/attendance/dashboard (manager has attendance.team.read).
  const res = await apiRequest('/api/v1/attendance/dashboard')
  expect(res.status, 'team attendance dashboard reachable for manager').toBe(200)
})
