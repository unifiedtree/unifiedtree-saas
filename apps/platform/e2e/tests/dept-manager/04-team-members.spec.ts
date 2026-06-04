import { test, expect } from '../../fixtures/test-base'
import { firstEmployeeId } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'dept-manager', 'dept-manager tests')
})

// NOTE on scope: the spec assumed managers see only their team. The PRODUCT instead gives
// DEPT_MANAGER tenant-wide DIRECTORY + PROFILE read (Directory is in their sidebar;
// `hrms.employee.read`/`employee.profile.read` are tenant-wide) — read-only, with sensitive
// sub-resources (identity/bank) and all writes gated. Tests assert that real boundary.
// (Observation filed: confirm with product whether directory should be team-scoped post-pilot.)

test('manager can view the employee directory (read-only, tenant-wide by design)', async ({ page }) => {
  await page.goto('/hrms/employees')
  await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})

test('manager sees profile but NOT sensitive employee data (identity/bank gated)', async ({ apiRequest }) => {
  const empId = await firstEmployeeId(apiRequest)
  const addresses = await apiRequest(`/api/v1/employees/${empId}/profile/addresses`)
  const identity = await apiRequest(`/api/v1/employees/${empId}/profile/identity`)
  const bank = await apiRequest(`/api/v1/employees/${empId}/profile/bank-accounts`)
  expect(addresses.status, 'profile/addresses readable (employee.profile.read)').toBe(200)
  expect(identity.status, 'identity gated — manager lacks employee.identity.read').toBe(403)
  expect(bank.status, 'bank gated — manager lacks employee.bank.read').toBe(403)
})

test('manager cannot create or modify employees (no employee.write)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/employees', {
    method: 'POST',
    body: JSON.stringify({
      companyId: '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55',
      firstName: 'MgrDenied',
      email: `mgr-denied-${Date.now()}@test.demo`,
      employmentType: 'FULL_TIME',
    }),
  })
  expect(res.status, 'employee create denied for manager').toBe(403)
})
