import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

// The attendance module (check-in/face) is owned elsewhere and out of scope to modify. These
// tests only verify the manager's TEAM-VIEW + regularization-approval reads, which the manager
// holds permissions for (attendance.team.read, attendance.regularization.approve).

test('manager attendance page renders without errors', async ({ page }) => {
  await page.goto('/hrms/attendance')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
})

test('manager team attendance + regularization-approvals endpoints are healthy', async ({ apiRequest }) => {
  const dashboard = await apiRequest('/api/v1/attendance/dashboard')
  expect(dashboard.status, 'team attendance dashboard (attendance.team.read)').toBe(200)
  const corrections = await apiRequest('/api/v1/attendance/corrections/approvals?status=PENDING')
  expect(corrections.status, 'regularization approvals (attendance.regularization.approve)').toBe(200)
})
