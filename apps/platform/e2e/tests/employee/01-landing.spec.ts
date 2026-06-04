import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'employee', 'employee tests')
})

test('EMPLOYEE lands on /me after login', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL('**/me', { timeout: 10_000 })
  expect(page.url()).toMatch(/\/me/)
})

test('role badge shows Employee', async ({ page }) => {
  await page.goto('/me')
  await expect(page.getByText(/employee/i).first()).toBeVisible()
})

test('employee sidebar shows ONLY self-service items', async ({ page }) => {
  // Navigate to an EMPLOYEE-allowed HRMS route so the HRMS group is expanded and
  // its "My X" children render. (The "My …" labels are unique nav links.)
  await page.goto('/hrms/leave')
  await page.waitForLoadState('networkidle')
  for (const label of ['My Workspace', 'My Attendance', 'My Leave', 'My Payslips', 'My Letters']) {
    await expect(
      page.getByRole('link', { name: label }).first(),
      `self-service nav "${label}" should be visible`,
    ).toBeVisible()
  }
})

test('employee sidebar HIDES every management section', async ({ page }) => {
  await page.goto('/hrms/leave')
  await page.waitForLoadState('networkidle')
  // Labels deliberately chosen NOT to substring-match the shown "My Attendance/
  // My Leave/My Letters" items (lesson from P5's brittle nav regex).
  for (const label of ['Directory', 'Organization', 'Reports', 'Payroll', 'Users', 'Roles', 'Audit']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }),
      `management nav "${label}" must be hidden from employee`,
    ).toHaveCount(0)
  }
})

test('employee can navigate self-service pages without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const p of ['/me', '/hrms/leave', '/hrms/attendance', '/me/payslips', '/hrms/letters/generated']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
  }
  const real = errors.filter(
    (e) => !e.includes('aria-describedby') && !e.includes('ResizeObserver') && !e.includes('DevTools'),
  )
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})
