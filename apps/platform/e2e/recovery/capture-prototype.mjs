// Screenshot every designed screen of the Claude Design prototype export so the
// implementation can be compared against it side by side.
//
//   node e2e/recovery/capture-prototype.mjs "<path to UnifiedTree HRMS Prototype.html>" <outDir> [route ...]
//
// The export is a self-unpacking bundle; it restores its route from
// localStorage['ut-proto-route'], so each capture seeds that key first.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [file, outDir, ...rest] = process.argv.slice(2)
if (!file || !outDir) {
  console.error('usage: capture-prototype.mjs <bundle.html> <outDir> [--mobile] [route ...]')
  process.exit(2)
}
const mobile = rest.includes('--mobile')
const only = rest.filter((a) => a !== '--mobile')

const ROUTES = only.length ? only : [
  '/dashboard',
  '/hrms/companies',
  '/hrms/att-analytics?tab=overview',
  '/hrms/att-analytics?tab=calendar',
  '/hrms/attendance?tab=team',
  '/hrms/attendance?tab=face',
  '/hrms/attendance?tab=corrections',
  '/hrms/attendance?tab=my',
  '/hrms/shifts?tab=schedules',
  '/hrms/shifts?tab=roster',
  '/hrms/shifts?tab=overtime',
  '/hrms/shifts?tab=requests',
  '/hrms/payroll-dashboard',
  '/hrms/salary-structure',
  '/hrms/payroll/runs',
  '/hrms/payroll/runs/2026-09',
  '/hrms/payroll/settings',
  '/hrms/pli',
  '/hrms/advances',
  '/hrms/bank-disbursement',
  '/hrms/employees',
]

const VIEWPORTS = mobile ? { mobile: { width: 390, height: 844 } } : { desktop: { width: 1440, height: 900 } }
const url = pathToFileURL(resolve(file)).href
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
try {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
      await ctx.addInitScript((r) => { try { localStorage.setItem('ut-proto-route', r) } catch {} }, route)
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message || e)))
      await page.goto(url, { waitUntil: 'load' })
      // The bundle unpacks, swaps the document, then the dc runtime renders.
      await page.waitForFunction(() => !document.getElementById('__bundler_loading') && document.body && document.body.innerText.length > 200, null, { timeout: 60000 })
      await page.waitForTimeout(2500)
      const name = `${vp}${route.replace(/[/?=&]+/g, '_')}.png`
      await page.screenshot({ path: join(outDir, name), fullPage: true })
      console.log(`${errors.length ? 'ERR ' : 'ok  '} ${name}${errors.length ? '  ' + errors[0].slice(0, 120) : ''}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
