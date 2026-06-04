import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

test('employee can view their own workspace (/me)', async ({ page }) => {
  await page.goto('/me')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  // EssDashboard always renders the punch card heading — robust own-workspace signal.
  await expect(page.getByText(/today's attendance/i)).toBeVisible({ timeout: 10_000 })
})

test('own self record is reachable via /v1/employees/me', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/employees/me')
  expect(res.status).toBe(200)
  test.info().annotations.push({
    type: 'note',
    description:
      'reader@ is a workspace user with no linked employee row; self endpoints resolve 200 with sparse/empty data.',
  })
})

test('employee cannot mutate an employee record (no employee.write)', async ({ apiRequest }) => {
  // Attempt to change another employee's department/designation — a base employee
  // must never be able to write employee records (self-promotion / data tamper).
  const res = await apiRequest('/api/v1/hrms/employees/11111111-1111-1111-1111-111111111111', {
    method: 'PUT',
    body: JSON.stringify({ departmentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', designationId: null }),
  })
  expect(res.status).toBe(403)
})
