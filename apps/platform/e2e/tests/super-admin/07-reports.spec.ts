import { test, expect } from '../../fixtures/test-base'
import { firstCompanyId, pickCompany } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'super-admin', 'super-admin tests')
})

const SLUGS = ['headcount', 'attrition', 'attendance-summary', 'leave-balance', 'late-marks', 'diversity']

test('reports landing page shows all 6 report cards', async ({ page }) => {
  await page.goto('/hrms/reports')
  for (const r of ['Headcount', 'Attrition', 'Attendance', 'Leave', 'Late', 'Diversity']) {
    await expect(page.getByText(new RegExp(r, 'i')).first(), `report "${r}"`).toBeVisible()
  }
})

test('all 6 report endpoints return 200 (regression for the Bug F SQL fixes)', async ({ apiRequest }) => {
  const cid = await firstCompanyId(apiRequest)
  const from = '2020-01-01'
  const to = '2030-12-31'
  const year = '2026'
  const endpoints: Record<string, string> = {
    headcount: `/api/v1/reports/headcount?companyId=${cid}`,
    attrition: `/api/v1/reports/attrition?companyId=${cid}&from=${from}&to=${to}`,
    'attendance-summary': `/api/v1/reports/attendance-summary?companyId=${cid}&from=${from}&to=${to}`,
    'leave-balance': `/api/v1/reports/leave-balance?companyId=${cid}&year=${year}`,
    'late-marks': `/api/v1/reports/late-marks?companyId=${cid}&from=${from}&to=${to}`,
    diversity: `/api/v1/reports/diversity?companyId=${cid}`,
  }
  for (const [name, url] of Object.entries(endpoints)) {
    const res = await apiRequest(url)
    // apiRequest returns a native fetch Response → .status is a property, not a method.
    expect(res.status, `${name} should return 200 (was 500 before Bug F fix)`).toBe(200)
  }
})

test('each report page renders without the load error after selecting a company', async ({ page }) => {
  for (const slug of SLUGS) {
    await page.goto(`/hrms/reports/${slug}`)
    // ReportShell shows "Select a company" until one is chosen; pick one to fire the query.
    await pickCompany(page)
    await page.waitForLoadState('networkidle')
    // No data is fine (demo has none → "No data for this period"); a 500 would surface
    // "Failed to load report" — that must never appear now.
    await expect(page.getByText(/failed to load report/i), `${slug} should not error`).not.toBeVisible()
    await expect(page.getByRole('heading').first()).toBeVisible()
  }
})
