import { test } from '../../fixtures/test-base'

/**
 * Dark-theme screenshot audit (NOT a pass/fail test). Forces dark mode, navigates each
 * page, and saves a full-page PNG to apps/platform/audit-screenshots/dark/ for manual rating.
 *
 * IMPORTANT — how dark mode is actually toggled (verified in ThemeProvider.tsx):
 *   document.documentElement.setAttribute('data-theme', 'dark')   // NOT a `.dark` class
 *   driven by localStorage['ut.theme'] (default 'system')
 * The ThemeProvider re-applies the theme from `ut.theme` on mount, so the reliable way to
 * force dark is to seed ut.theme='dark' BEFORE boot (we also setAttribute as a pre-paint
 * head-start). Forcing a `.dark` class — as a naive audit would — does nothing here.
 *
 * Gated on AUDIT=1 so it never runs in the normal suites. Run with:
 *   AUDIT=1 pnpm exec playwright test audits/dark-theme-audit --project=super-admin
 */

const DIR = process.env.AUDIT_DIR || 'audit-screenshots/dark'
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://demo.localhost:3001'

const FORCE_DARK = () => {
  try {
    localStorage.setItem('ut.theme', 'dark')
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', 'dark')
}

const PAGES = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/hrms/employees', name: 'employees-list' },
  { path: '/hrms/organization', name: 'org-companies' },
  { path: '/hrms/leave', name: 'leave' },
  { path: '/hrms/onboarding', name: 'onboarding' },
  { path: '/hrms/letters/templates', name: 'letters-templates' },
  { path: '/hrms/reports', name: 'reports-landing' },
  { path: '/hrms/reports/headcount', name: 'reports-headcount' },
  { path: '/hrms/payroll/settings', name: 'payroll-settings' },
  { path: '/hrms/payroll/components', name: 'payroll-components' },
  { path: '/hrms/payroll/runs', name: 'payroll-runs' },
  { path: '/users', name: 'users' },
  { path: '/roles', name: 'roles' },
  { path: '/audit-logs', name: 'audit-logs' },
  { path: '/settings', name: 'settings' },
]

test.describe('Dark theme audit', () => {
  test.beforeEach(() => {
    test.skip(!process.env.AUDIT, 'audit-only (set AUDIT=1)')
    test.skip(test.info().project.name !== 'super-admin', 'audit runs as super-admin')
  })

  for (const p of PAGES) {
    test(`audit: ${p.name} (${p.path})`, async ({ page }) => {
      await page.addInitScript(FORCE_DARK)
      await page.goto(p.path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
      if (theme !== 'dark') console.warn(`⚠ ${p.name}: data-theme="${theme}" (dark not applied)`)
      await page.screenshot({ path: `${DIR}/${p.name}.png`, fullPage: true })
    })
  }

  // Public login page — needs a token-LESS context (the super-admin token would redirect to /dashboard).
  test('audit: login', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE, colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.addInitScript(FORCE_DARK)
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${DIR}/login.png`, fullPage: true })
    await ctx.close()
  })

  // Employee detail (needs navigation to a row).
  test('audit: employee-detail', async ({ page }) => {
    await page.addInitScript(FORCE_DARK)
    await page.goto('/hrms/employees')
    await page.waitForLoadState('networkidle')
    const firstRow = page.locator('table tbody tr').first()
    if (await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstRow.click()
      await page.waitForURL('**/hrms/employees/**')
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${DIR}/employee-detail.png`, fullPage: true })
    }
  })

  // A modal/drawer in dark (explicitly flagged as a problem area).
  test('audit: modal-add-employee', async ({ page }) => {
    await page.addInitScript(FORCE_DARK)
    await page.goto('/hrms/employees')
    await page.waitForLoadState('networkidle')
    const addBtn = page.getByRole('button', { name: /add employee/i })
    if (await addBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${DIR}/modal-add-employee.png`, fullPage: false })
    }
  })
})
