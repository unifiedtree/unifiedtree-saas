// Screenshot routes of the running local app (signed in) at the same size as the
// prototype captures, for side-by-side comparison with the design.
//
//   node e2e/recovery/capture-app.mjs <outDir> [--full] [--email x] [--mobile] route [route ...]
//
// Read-only: after sign-in every non-GET API call is blocked.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const outDir = args.shift()
let full = false, mobile = false, email = process.env.RECOVERY_EMAIL || 'owner@unifiedtree.demo'
const routes = []
while (args.length) {
  const a = args.shift()
  if (a === '--full') full = true
  else if (a === '--mobile') mobile = true
  else if (a === '--email') email = args.shift()
  else routes.push(a)
}
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1200)
  await context.route('**/api/**', (r) => (r.request().method() === 'GET' || r.request().url().includes('/canonical-auth/refresh') ? r.continue() : r.abort()))
  for (const route of routes) {
    errors.length = 0
    await page.goto(base + route, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const name = `${mobile ? 'mobile' : 'desktop'}${route.replace(/[/?=&]+/g, '_')}.png`
    // The app scrolls inside #workspace-content, so a "full page" shot needs that element's height.
    if (full) {
      const h = await page.evaluate(() => {
        const el = document.getElementById('workspace-content')
        return el ? el.scrollHeight + (el.getBoundingClientRect().top || 0) : document.body.scrollHeight
      })
      await page.setViewportSize({ width: mobile ? 390 : 1440, height: Math.min(Math.max(900, Math.ceil(h)), 12000) })
      await page.waitForTimeout(600)
    }
    await page.screenshot({ path: join(outDir, name), fullPage: !full })
    if (full) await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
    console.log(`${errors.length ? 'ERR ' : 'ok  '} ${name}${errors.length ? '  ' + errors[0].slice(0, 160) : ''}`)
  }
} finally {
  await browser.close()
}
