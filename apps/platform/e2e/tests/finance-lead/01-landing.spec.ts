import { test, expect } from '../../fixtures/test-base'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

test('FINANCE_LEAD lands on /hrms/reports after login', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL('**/hrms/reports', { timeout: 10_000 })
  expect(page.url()).toMatch(/\/hrms\/reports/)
})

test('role badge shows Finance Lead', async ({ page }) => {
  await page.goto('/hrms/reports')
  await expect(page.getByText(/finance lead/i).first()).toBeVisible()
})

test('finance sidebar shows finance sections', async ({ page }) => {
  // Use the payroll page (not /hrms/reports) so the "Attendance Summary"/"Leave Balance"
  // report *cards* (which are <Link>s in the page body) don't get matched as nav links.
  await page.goto('/hrms/payroll/runs') // HRMS route → module expands
  await page.waitForLoadState('networkidle')
  // visibleForRoles incl FINANCE_LEAD: Directory, Reports, Payroll Settings, Salary Components, Payroll Runs.
  for (const label of ['Directory', 'Reports', 'Payroll Settings', 'Salary Components', 'Payroll Runs']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }).first(),
      `nav "${label}" should be visible to finance`,
    ).toBeVisible()
  }
})

test('finance sidebar hides HR/admin/manager sections', async ({ page }) => {
  // On the payroll page so report-card <Link>s in the body can't false-match nav regexes.
  await page.goto('/hrms/payroll/runs')
  await page.waitForLoadState('networkidle')
  // NOTE: finance HOLDS leave/letters PERMISSIONS but those nav items exclude FINANCE_LEAD in
  // visibleForRoles, so they are hidden here (a perm/nav mismatch — see report).
  for (const label of ['Organization', 'Onboarding', 'Letters', 'Attendance', 'Leave', 'Users & Access', 'Roles & Perms', 'Audit Logs']) {
    await expect(
      page.getByRole('link', { name: new RegExp(label, 'i') }),
      `nav "${label}" must be hidden from finance`,
    ).toHaveCount(0)
  }
})

test('finance can navigate finance pages without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const path of ['/hrms/reports', '/hrms/payroll/settings', '/hrms/payroll/components', '/hrms/payroll/runs']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  const real = errors.filter((e) => !e.includes('aria-describedby') && !e.includes('ResizeObserver'))
  expect(real, `JS errors:\n${real.join('\n')}`).toEqual([])
})
