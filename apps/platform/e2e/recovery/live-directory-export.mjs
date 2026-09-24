// Workforce Directory CSV export against the local recovery runtime:
// API contract (filters honoured, sensitive fields absent, formula guard,
// permission) and the browser button (download happens, file matches filters).
//
// Run from apps/platform:  node e2e/recovery/live-directory-export.mjs
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q]).toString().trim()
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}

const owner = await login('owner@unifiedtree.demo')
const tag = randomUUID().slice(0, 6)
// A fixture whose name would execute as a spreadsheet formula if unguarded.
const fx = await (await fetch(`${api}/v1/hrms/employees`, { method: 'POST', headers: owner, body: JSON.stringify({ companyId: company, firstName: '=HYPERLINK("x")', lastName: `Qa${tag}`, email: `qa.export.${tag}@unifiedtree.demo` }) })).json()
const browser = await chromium.launch({ headless: true })
try {
  const r = await fetch(`${api}/v1/hrms/employees/export.csv?companyId=${company}`, { headers: owner })
  const text = (await r.text()).replace(/^\uFEFF/, '')
  const lines = text.trim().split(/\r?\n/)
  const dir = await (await fetch(`${api}/v1/hrms/employees?companyId=${company}&page=0&pageSize=1`, { headers: owner })).json()
  check('export returns 200 text/csv', r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv'), `${r.status} ${r.headers.get('content-type')}`)
  check('row count matches the directory total', lines.length - 1 === dir.totalElements, `${lines.length - 1} rows vs ${dir.totalElements}`)
  check('header has the directory columns', lines[0].startsWith('Employee code,First name,Last name,Work email'), lines[0].slice(0, 80))
  check('no salary / bank / identity columns', !/(ctc|salary|bank|pan|aadhaar|uan|esi|birth)/i.test(lines[0]), lines[0])
  const fxLine = lines.find((l) => l.includes(`Qa${tag}`)) || ''
  check('formula-like names are neutralised', fxLine.includes(`"'=HYPERLINK(""x"")"`), fxLine.slice(0, 80))
  const filtered = await (await fetch(`${api}/v1/hrms/employees/export.csv?companyId=${company}&status=NOTICE_PERIOD`, { headers: owner })).text()
  const noticeTotal = (await (await fetch(`${api}/v1/hrms/employees?companyId=${company}&status=NOTICE_PERIOD&page=0&pageSize=1`, { headers: owner })).json()).totalElements
  check('status filter is honoured', filtered.replace(/^\uFEFF/, '').trim().split(/\r?\n/).length - 1 === noticeTotal, `${noticeTotal} on notice`)
  const reader = await login('reader@unifiedtree.demo')
  const denied = await fetch(`${api}/v1/hrms/employees/export.csv`, { headers: reader })
  check('employee login is denied the export', denied.status === 403, `${denied.status}`)

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
  await page.goto(base + '/login'); await page.locator('input[type=email]').fill('owner@unifiedtree.demo'); await page.locator('input[type=password]').fill(password); await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }); await page.waitForTimeout(1500); errs.length = 0
  await page.goto(base + '/hrms/employees')
  const button = page.getByRole('button', { name: 'Export', exact: true })
  await button.waitFor({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), button.click()])
  mkdirSync('test-results/recovery', { recursive: true })
  const saved = 'test-results/recovery/employees-export.csv'
  await download.saveAs(saved)
  const uiLines = readFileSync(saved, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  check('browser button downloads the CSV', download.suggestedFilename().startsWith('employees-') && uiLines.length - 1 === dir.totalElements, `${download.suggestedFilename()} ${uiLines.length - 1} rows`)
  await page.locator('.toast').filter({ hasText: /Exported \d+ employees/ }).first().waitFor({ timeout: 10_000 })
  check('success toast shows the count', true)
  check('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  try { sql(`DELETE FROM hrms.employees WHERE id='${fx.id}' AND tenant_id='${tenant}'`) } catch (e) { console.log('cleanup failed:', String(e).split('\n')[0]) }
  mkdirSync('test-results/recovery', { recursive: true })
  writeFileSync('test-results/recovery/live-directory-export.json', JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) process.exitCode = 1
}
