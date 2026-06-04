import { test, expect } from '../../fixtures/test-base'
import { firstCompanyId, pickCompany } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'hr-manager', 'hr-manager tests')
})

const SLUGS = ['headcount', 'attrition', 'attendance-summary', 'leave-balance', 'late-marks', 'diversity']

test('HR sees the report cards', async ({ page }) => {
  await page.goto('/hrms/reports')
  for (const r of ['Headcount', 'Attrition', 'Attendance', 'Leave', 'Late', 'Diversity']) {
    await expect(page.getByText(new RegExp(r, 'i')).first(), `report "${r}"`).toBeVisible()
  }
})

test('all 6 report endpoints return 200 for HR (Bug F regression + HR report perms)', async ({ apiRequest }) => {
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
    expect(res.status, `${name} → 200 for HR`).toBe(200)
  }
})

test('each report page renders for HR without the load error', async ({ page }) => {
  for (const slug of SLUGS) {
    await page.goto(`/hrms/reports/${slug}`)
    await pickCompany(page)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/failed to load report/i), `${slug} should not error`).not.toBeVisible()
    await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  }
})
