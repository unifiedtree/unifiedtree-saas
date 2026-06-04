import { test, expect } from '../../fixtures/test-base'
import { firstCompanyId, pickCompany } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

const SLUGS = ['headcount', 'attrition', 'attendance-summary', 'leave-balance', 'late-marks', 'diversity']

test('finance sees the report cards', async ({ page }) => {
  await page.goto('/hrms/reports')
  for (const r of ['Headcount', 'Attrition', 'Attendance', 'Leave', 'Late', 'Diversity']) {
    await expect(page.getByText(new RegExp(r, 'i')).first(), `report "${r}"`).toBeVisible()
  }
})

test('all 6 report endpoints return 200 for finance (has every report permission)', async ({ apiRequest }) => {
  const cid = await firstCompanyId(apiRequest)
  const qp = `from=2020-01-01&to=2030-12-31&year=2026`
  for (const slug of SLUGS) {
    const url =
      slug === 'headcount' || slug === 'diversity'
        ? `/api/v1/reports/${slug}?companyId=${cid}`
        : `/api/v1/reports/${slug}?companyId=${cid}&${qp}`
    const res = await apiRequest(url)
    expect(res.status, `${slug} → 200 for finance`).toBe(200)
  }
})

test('each report page renders without the load error', async ({ page }) => {
  for (const slug of SLUGS) {
    await page.goto(`/hrms/reports/${slug}`)
    await pickCompany(page)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/failed to load report/i), `${slug}`).not.toBeVisible()
    await expect(page.getByText(/access restricted/i)).not.toBeVisible()
  }
})
