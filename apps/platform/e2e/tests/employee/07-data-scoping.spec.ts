import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

// ════════════════════════════════════════════════════════════════════════════
// SECURITY BEDROCK — a base employee must never reach another employee's data.
//
// REGRESSION GUARD: GET /v1/hrms/employees (list) and GET /v1/hrms/employees/{id}
// (detail) authorize with `… or hasAuthority('hrms.employee.read')` and the
// detail endpoint does NO self-scoping. The EMPLOYEE role was seeded (V017) with
// hrms.employee.read, so any employee could enumerate the whole company and open
// any coworker's record — and that payload carries ctcAnnual / DOB / phone.
// V051 revokes hrms.employee.read from the EMPLOYEE role. These MUST stay 403.
// ════════════════════════════════════════════════════════════════════════════

const OTHER = '11111111-1111-1111-1111-111111111111' // admin's employee id (well-known seed)

test('employee CANNOT list all employees in the tenant', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/hrms/employees')
  expect(res.status, 'tenant-wide employee directory must be denied').toBe(403)
})

test("employee CANNOT read another employee's record", async ({ apiRequest }) => {
  const res = await apiRequest(`/api/v1/hrms/employees/${OTHER}`)
  expect(res.status, 'cross-employee detail (carries ctcAnnual/DOB/phone) must be denied').toBe(403)
})

test("employee CANNOT read another employee's identity PII", async ({ apiRequest }) => {
  const res = await apiRequest(`/api/v1/employees/${OTHER}/profile/identity`)
  expect([403, 404]).toContain(res.status)
})

test("employee CANNOT read another employee's bank PII", async ({ apiRequest }) => {
  const res = await apiRequest(`/api/v1/employees/${OTHER}/profile/bank-accounts`)
  expect([403, 404]).toContain(res.status)
})

test("employee CANNOT read another employee's addresses", async ({ apiRequest }) => {
  const res = await apiRequest(`/api/v1/employees/${OTHER}/profile/addresses`)
  expect([403, 404]).toContain(res.status)
})

test('employee CANNOT read pending leave approvals (manager-only)', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/leave/approvals/pending')
  expect(res.status).toBe(403)
})

test('employee CANNOT read the team attendance dashboard', async ({ apiRequest }) => {
  const res = await apiRequest('/api/v1/attendance/dashboard?from=2026-06-01&to=2026-06-30')
  expect(res.status).toBe(403)
})
