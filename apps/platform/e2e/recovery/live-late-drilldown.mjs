// Client complaint #1 — "one person is late" must identify WHO. Inserts one LATE
// attendance record for the demo employee (today, IST), then drives the real
// dashboard: the Late Arrivals tile must show the count, open the attendance
// team view filtered to status=LATE, list the named employee with their
// check-in, and a row click must open their detail. Cleans the record up.
//
// Local recovery runtime only. Run from apps/platform:  node e2e/recovery/live-late-drilldown.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const employee = '22222222-2222-2222-2222-222222222222' // Reader User
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const record = randomUUID()
// Late by 47 minutes against a 09:00 IST shift: 09:47 IST = 04:17Z.
sql(`DELETE FROM attendance.records WHERE employee_id='${employee}' AND attendance_date='${today}' AND tenant_id='${tenant}'`)
sql(`INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,attendance_status) VALUES('${record}','${tenant}','${employee}','${company}','${today}','${today}T04:17:00Z',NULL,'LATE')`)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errs = []; page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
try {
  await page.goto(base + '/login'); await page.locator('input[type=email]').fill('owner@unifiedtree.demo'); await page.locator('input[type=password]').fill(password); await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }); await page.waitForTimeout(1500); errs.length = 0
  await page.goto(base + '/dashboard')
  const tile = page.getByRole('button', { name: /Late Arrivals/i }).first()
  await tile.waitFor({ timeout: 30_000 })
  // The tile renders "Loading…" until the dashboard query resolves (and re-mounts), so poll the live locator.
  for (let i = 0; i < 60 && !/Late Arrivalss+d+/i.test(((await tile.innerText().catch(() => '')) || '').replace(/s+/g, ' ')); i++) await page.waitForTimeout(500)
  const tileText = (await tile.innerText()).replace(/\s+/g, ' ')
  const tileCount = Number((tileText.match(/Late Arrivals\s+(\d+)/i) || [])[1])
  check('dashboard Late Arrivals tile counts the late employee', tileCount >= 1, tileText)
  await tile.click()
  await page.waitForURL(/\/hrms\/attendance.*status=LATE/, { timeout: 30_000 })
  check('tile opens the attendance team view filtered to LATE', true, new URL(page.url()).search)
  const row = page.getByRole('row').filter({ hasText: 'Reader User' })
  await row.first().waitFor({ timeout: 30_000 })
  const rowText = (await row.first().innerText()).replace(/\s+/g, ' ')
  check('the late employee is named in the filtered list', true, rowText.slice(0, 120))
  check('row shows the Late status', /late/i.test(rowText))
  check('row shows the check-in time', /09:47|9:47/.test(rowText), rowText)
  const lateRows = await page.getByRole('row').filter({ hasText: /late/i }).count()
  check('filtered list length matches the tile count', lateRows === tileCount, `${lateRows} late row(s) vs tile ${tileCount}`)
  await row.first().click()
  const detail = page.getByRole('dialog')
  await detail.waitFor({ timeout: 15_000 })
  const detailText = (await detail.innerText()).replace(/\s+/g, ' ')
  check('row click opens the employee\'s attendance detail', /Reader User/.test(detailText), detailText.slice(0, 140))
  mkdirSync('test-results/recovery', { recursive: true })
  await page.screenshot({ path: 'test-results/recovery/late-drilldown-live.png', fullPage: true })
  check('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  sql(`DELETE FROM attendance.records WHERE id='${record}' AND tenant_id='${tenant}'`)
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-late-drilldown.json', JSON.stringify({ ranAt: new Date().toISOString(), checks, pageErrors: errs }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
