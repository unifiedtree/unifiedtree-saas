// Live check for the web "Payment needed" screen (402 MODULE_PAUSED, contract §2; core/billing/ModulePausedScreen.tsx).
//
//   live-slot.sh /c/REACT/ut-wt/b4-billing 3101 node e2e/recovery/live-b4-paused-screen.mjs
//
// Plants the newest subscription row for the demo business: PAST_DUE, due 9 days ago (past the 7-day grace),
// modules hrms/attendance/leave/payroll — then, in the browser:
//  - owner: sign-in works; /hrms/employees shows "HRMS is paused" with the amount and "Pay now";
//    "Pay now" opens /plan, which stays open (no paused screen there);
//  - employee (reader@): sign-in works; a module page shows "Ask your business owner to pay", no "Pay now".
// The planted row is removed at the end (and the business works again).
/* global process, console, URL */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

const id = randomUUID()
let browser
const errors = []

async function signIn(email, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`))
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 4000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  return page
}

try {
  sql(`insert into platform.subscriptions (id, tenant_id, subdomain, plan_keys, modules, seats, amount_inr, status, current_period_start, current_period_end, past_due_since, created_at, updated_at)
       values ('${id}', '${tenant}', 'demo', '{hr-employees}', '{hrms,attendance,leave,payroll}', 100, 4000, 'PAST_DUE', now() - interval '40 days', now() - interval '9 days',
               now() - interval '9 days', now(), now() + interval '1 day')`)
  browser = await chromium.launch()

  // ── Owner ──
  const owner = await signIn('owner@unifiedtree.demo', 1440)
  check('owner: sign-in works while paused', !new URL(owner.url()).pathname.startsWith('/login'), owner.url())
  await owner.goto(base + '/hrms/employees', { waitUntil: 'domcontentloaded', timeout: 90000 })
  const screen = owner.getByTestId('module-paused')
  await screen.waitFor({ timeout: 30000 }).catch(() => {})
  const text = (await screen.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('owner: a module page shows "HRMS is paused"', /HRMS is paused/.test(text), text.slice(0, 200))
  check('owner: the screen gives the amount due', text.includes('₹4,000'), text.slice(0, 200))
  check('owner: "Pay now" is offered', await owner.getByRole('button', { name: 'Pay now' }).isVisible().catch(() => false))
  await owner.screenshot({ path: `${shots}/b4-paused-owner-1440.png` })
  await owner.getByRole('button', { name: 'Pay now' }).click().catch(() => {})
  await owner.waitForURL((u) => u.pathname === '/plan', { timeout: 15000 }).catch(() => {})
  await owner.waitForTimeout(2500)
  check('owner: "Pay now" opens the plan page', new URL(owner.url()).pathname === '/plan', owner.url())
  check('owner: the plan page stays open (no paused screen)', (await owner.getByTestId('module-paused').count()) === 0)

  // ── Employee, phone width ──
  const reader = await signIn('reader@unifiedtree.demo', 390)
  check('employee: sign-in works while paused', !new URL(reader.url()).pathname.startsWith('/login'), reader.url())
  await reader.goto(base + '/me/salary', { waitUntil: 'domcontentloaded', timeout: 90000 })
  const rs = reader.getByTestId('module-paused')
  await rs.waitFor({ timeout: 30000 }).catch(() => {})
  const rt = (await rs.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('employee: a module page shows the paused screen', /is paused/.test(rt), rt.slice(0, 200) || reader.url())
  check('employee: "Ask your business owner to pay", no "Pay now"', /Ask your business owner to pay/.test(rt) && (await reader.getByRole('button', { name: 'Pay now' }).count()) === 0)
  await reader.screenshot({ path: `${shots}/b4-paused-reader-390.png` })
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  sql(`delete from platform.subscriptions where id='${id}'`)
  check('cleanup: planted subscription removed', sql(`select count(*) from platform.subscriptions where id='${id}'`) === '0')
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
