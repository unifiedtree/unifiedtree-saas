// Live check of Workforce Analytics, the Reports Center and the six report
// pages in the Workforce Analytics design, against the local API.
//  - numbers on screen match the database (headcount, exits this month)
//  - a department click opens the directory filtered to it
//  - every export downloads a real file: CSV from the server, a valid .xlsx
//    workbook, chart PNGs; and the Reports Center lists them
//  - FINANCE_LEAD (report permissions, not an admin role) sees Workforce
//    Analytics in the nav; reader and manager (no report permissions) don't,
//    and are kept out of the pages
//
//   node e2e/recovery/live-design-reports.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const shots = process.env.SHOTS_DIR || ''
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// Who is employed today, by the report's own rule (exits end on the last working day).
const employed = Number(sql(`select count(*) from hrms.employees e where e.company_id='${company}' and e.date_of_joining <= current_date and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') <= current_date)`))
const exitsThisMonth = Number(sql(`select count(*) from hrms.employees e where e.company_id='${company}' and e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination) between date_trunc('month', current_date)::date and current_date`))

const browser = await chromium.launch()
const session = async (email, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
const exportAs = async (page, item) => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.getByRole('menuitem', { name: item }).click()])
  const path = await dl.path()
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) }
}
const isXlsx = (b) => b[0] === 0x50 && b[1] === 0x4b && b.includes(Buffer.from('xl/workbook.xml'))

try {
  const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')

  // ── Workforce Analytics ──
  await page.goto(`${base}/hrms/workforce-analytics?co=${company}`); await settle(page)
  await page.getByRole('heading', { name: 'Headcount by department' }).waitFor({ timeout: 30_000 })
  const total = await page.locator('text=Total headcount').locator('xpath=..').innerText()
  check('analytics: total headcount matches the database', total.includes(String(employed)), `db=${employed} card="${total.replace(/\s+/g, ' ')}"`)
  const readout = await page.getByText(/\d+ exits ·/).first().innerText().catch(() => '')
  check('analytics: this month’s exits match the database', readout.startsWith(`${exitsThisMonth} exits`), `db=${exitsThisMonth} readout="${readout}"`)
  check('analytics: gender split shows everyone (none dropped)', (await page.getByText(`${employed} people`).count()) > 0)
  if (shots) await page.screenshot({ path: `${shots}/analytics.png` })

  const csv = await exportAs(page, /Departments \(CSV\)/)
  check('analytics: departments CSV downloads', csv.name.endsWith('-departments.csv') && csv.bytes.toString('utf8').includes('Department,Total,Active'), csv.name)
  const xlsx = await exportAs(page, /Data workbook/)
  check('analytics: Excel workbook is a real .xlsx', xlsx.name.endsWith('.xlsx') && isXlsx(xlsx.bytes) && xlsx.bytes.includes(Buffer.from('Monthly attrition')), `${xlsx.name} ${xlsx.bytes.length} bytes`)
  const [png] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.getByRole('button', { name: 'Download chart as PNG' }).first().click()])
  const pngBytes = readFileSync(await png.path())
  check('analytics: chart downloads as PNG', png.suggestedFilename().endsWith('.png') && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47, png.suggestedFilename())
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 15_000 }), (async () => { await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: /Dashboard snapshot/ }).click() })()])
  await popup.waitForLoadState('domcontentloaded')
  check('analytics: PDF snapshot opens a print-ready page', (await popup.locator('h1', { hasText: 'Workforce Analytics' }).count()) === 1 && (await popup.locator('svg').count()) >= 2)
  await popup.close()

  const dept = sql(`select d.id from hrms.departments d join hrms.employees e on e.department_id=d.id where e.company_id='${company}' and e.employment_status in ('ACTIVE','PROBATION','NOTICE_PERIOD') group by d.id order by count(*) desc limit 1`)
  await page.locator('.ut-bar-col, [title^="Open "][title$="in the directory"]').first().click()
  await page.waitForURL((u) => u.pathname === '/hrms/employees', { timeout: 15_000 }).catch(() => {})
  const url = new URL(page.url())
  check('analytics: a department opens the directory filtered to it', url.pathname === '/hrms/employees' && url.searchParams.get('co') === company && (!dept || url.searchParams.get('departmentId') === dept), page.url().replace(base, ''))
  check('analytics: no page errors or failed API calls', !errors.length && !failed.length, errors[0] || failed[0] || '')

  // ── Report pages ──
  const REPORTS = [
    ['headcount', 'Headcount Report', 'Departments'],
    ['attrition', 'Attrition Report', 'Months'],
    ['diversity', 'Diversity Report', 'By department'],
    ['attendance-summary', 'Attendance Summary', 'People'],
    ['late-marks', 'Late Marks Report', 'Late marks'],
    ['leave-balance', 'Leave Balance Report', 'Balances'],
  ]
  for (const [key, title, table] of REPORTS) {
    errors.length = 0; failed.length = 0
    await page.goto(`${base}/hrms/reports/${key}?co=${company}`); await settle(page)
    await page.getByRole('heading', { name: title }).waitFor({ timeout: 30_000 })
    const empty = (await page.getByText('No data for this period').count()) > 0
    const rendered = empty || (await page.getByText(table, { exact: true }).count()) > 0
    check(`${key}: renders in the design${empty ? ' (no data in range)' : ''}`, rendered)
    if (!empty) {
      const c = await exportAs(page, /Raw rows \(CSV\)/)
      check(`${key}: server CSV downloads`, c.name.endsWith('.csv') && c.bytes.length > 10, `${c.name} ${c.bytes.length} bytes`)
      const x = await exportAs(page, /Data workbook/)
      check(`${key}: Excel workbook is a real .xlsx`, isXlsx(x.bytes), `${x.name} ${x.bytes.length} bytes`)
    }
    check(`${key}: no page errors or failed API calls`, !errors.length && !failed.length, errors[0] || failed[0] || '')
    if (shots) await page.screenshot({ path: `${shots}/report-${key}.png` })
  }
  const hc = sql(`select count(*) from hrms.employees e where e.company_id='${company}' and e.date_of_joining <= current_date and not (e.employment_status in ('EXITED','TERMINATED','RESIGNED') and coalesce(e.last_working_day, e.date_of_termination, date '1900-01-01') <= current_date)`)
  await page.goto(`${base}/hrms/reports/headcount?co=${company}`); await settle(page)
  check('headcount: total matches the database (exited people not counted)', (await page.locator('text=Total headcount').locator('xpath=..').innerText()).includes(hc), `db=${hc}`)

  // ── Reports Center ──
  await page.goto(`${base}/hrms/reports?co=${company}`); await settle(page)
  await page.getByRole('heading', { name: 'Reports Center' }).waitFor({ timeout: 30_000 })
  for (const t of ['Headcount', 'Attrition', 'Diversity', 'Attendance summary', 'Late marks', 'Leave balance', 'Workforce Analytics']) check(`center: "${t}" card`, (await page.getByRole('button', { name: new RegExp(t) }).count()) > 0)
  check('center: recent downloads lists this session’s files', (await page.getByText(/-departments\.csv$/).count()) > 0 && (await page.getByText(/\.xlsx$/).count()) > 0)
  await page.getByRole('button', { name: /^Attrition/ }).click()
  await page.waitForURL((u) => u.pathname === '/hrms/reports/attrition', { timeout: 15_000 })
  check('center: a card opens its report on the same company', new URL(page.url()).searchParams.get('co') === company)
  await ctx.close()

  // ── Phone width ──
  const m = await session('owner@unifiedtree.demo', 390)
  for (const p of [`/hrms/workforce-analytics?co=${company}`, `/hrms/reports?co=${company}`, `/hrms/reports/leave-balance?co=${company}`]) {
    await m.page.goto(base + p); await settle(m.page)
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`phone ${p.split('?')[0]}: no sideways scroll`, overflow <= 1, `overflow=${overflow}`)
  }
  await m.ctx.close()

  // ── Roles ──
  const fin = await session('fin@unifiedtree.demo')
  await fin.page.goto(`${base}/hrms/reports`); await settle(fin.page)
  check('FINANCE_LEAD: sees Workforce Analytics in the section tabs', (await fin.page.getByRole('link', { name: 'Workforce Analytics' }).count()) > 0)
  await fin.page.goto(`${base}/hrms/workforce-analytics`); await settle(fin.page)
  check('FINANCE_LEAD: analytics opens with its charts', (await fin.page.getByRole('heading', { name: 'Monthly attrition' }).count()) === 1 && !fin.failed.length, fin.failed[0] || '')
  await fin.ctx.close()
  for (const who of ['reader@unifiedtree.demo', 'mgr@unifiedtree.demo']) {
    const s = await session(who)
    for (const p of ['/hrms/reports', '/hrms/workforce-analytics', '/hrms/reports/headcount']) {
      await s.page.goto(base + p); await settle(s.page)
      const leaked = (await s.page.getByRole('heading', { name: /Reports Center|Workforce Analytics|Headcount Report/ }).count()) > 0
      check(`${who.split('@')[0]}: ${p} stays closed`, !leaked)
    }
    check(`${who.split('@')[0]}: no report API was called`, !s.failed.some((f) => f.includes('/v1/reports/')), s.failed.find((f) => f.includes('/v1/reports/')) || '')
    await s.ctx.close()
  }
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
