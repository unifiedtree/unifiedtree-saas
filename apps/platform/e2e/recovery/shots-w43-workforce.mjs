/* global console, process */
// Screenshots of every Workforce page (w43, 6 Oct 2026) at 1440 and 390, light and dark, for the
// icon-alignment pass. Read-only: nothing is created. Saves to SHOTS/w43-<tag>-<page>-<w>-<theme>.png.
// Run from apps/platform (inside live-slot.sh):  TAG=before node e2e/recovery/shots-w43-workforce.mjs
//   env: RECOVERY_APP_URL, RECOVERY_DB (default ut_w3_dev), PAGES (comma list of page keys to limit), WIDTHS, THEMES
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tag = process.env.TAG || 'shot'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
mkdirSync(shots, { recursive: true })
const empId = sql(`select id from hrms.employees where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and is_active order by employee_code limit 1 offset 2`)

const PAGES = {
  directory: '/hrms/employees', add: '/hrms/employees?add=1', import: '/hrms/employees/import', profile: `/hrms/employees/${empId}`,
  overview: '/hrms/master', contractors: '/hrms/master/contractors', classes: '/hrms/master/classifications', companies: '/hrms/master/companies',
  branches: '/hrms/master/branches', departments: '/hrms/master/departments', designations: '/hrms/master/designations', grades: '/hrms/master/grades',
  shifts: '/hrms/master/shift-rules', leaves: '/hrms/master/leave-rules', policies: '/hrms/policies', orgchart: '/hrms/master/org-chart',
  organization: '/hrms/organization', analytics: '/hrms/workforce-analytics', myprofile: '/profile',
}
const only = (process.env.PAGES || '').split(',').filter(Boolean)
const widths = (process.env.WIDTHS || '1440,390').split(',').map(Number)
const themes = (process.env.THEMES || 'light,dark').split(',')
const browser = await chromium.launch({ headless: true })
try {
  for (const w of widths) for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 1000 } })
    await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* none */ } }, theme)
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(90_000)
    await page.goto(base + '/login', { timeout: 180_000 })
    await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
    await page.locator('input[type=password]').fill('Hrms@12345')
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.waitForTimeout(2500)
    for (const [key, path] of Object.entries(PAGES)) {
      if (only.length && !only.includes(key)) continue
      await page.goto(base + path)
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${shots}/w43-${tag}-${key}-${w}-${theme}.png`, fullPage: w >= 600 })
      console.log('shot', key, w, theme)
    }
    await ctx.close()
  }
} finally { await browser.close() }
