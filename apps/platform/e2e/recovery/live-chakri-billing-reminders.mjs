// Live check for chakri/billing-reminders: payment reminders from 3 days before the due date,
// every day until paid; grace counted 7 days from the due date (owner rules, 6 Oct 2026).
//
//   UNIFIEDTREE_BILLING_REMINDERS_CRON="*/15 * * * * *" \
//   live-slot.sh /c/REACT/ut-wt/chakri-billing-reminders 3095 node e2e/recovery/live-chakri-billing-reminders.mjs
//
// The cron override (inherited by the slot's backend) runs the daily job every 15 s here.
// What it proves, against the local backend and database:
//  - V144_1 is applied (past_due_since column, billing_reminders_sent table).
//  - A subscription due in 2 days -> "Payment of ₹4,000 due in 2 days" (PAYMENT_DUE_SOON) to the owner;
//    one that is past due -> "Payment of ₹1,25,000 is overdue … Pay by <due + 7 days>" (PAYMENT_OVERDUE);
//    one due in 10 days -> nothing.
//  - Once a day: after more job runs there is still one reminder per subscription per day.
//  - Web: the owner sees the reminder in the notification panel; it opens the plan page.
// The planted subscriptions are dated 2000-01-01 so they are never the "newest" row the access
// guard reads. Everything planted is removed at the end.
/* global process, console, fetch, setTimeout */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(shots, { recursive: true })

const ist = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
const DAY = 86400000
const now = Date.now()
const ids = { soon: crypto.randomUUID(), overdue: crypto.randomUUID(), later: crypto.randomUUID() }
const idList = Object.values(ids).map((i) => `'${i}'`).join(',')
const start = new Date(now - 5000).toISOString()
const plant = (id, status, amount, nextCharge, pastDue) => sql(`insert into platform.subscriptions
  (id, tenant_id, subdomain, plan_keys, amount_inr, status, current_period_start, current_period_end, next_charge_at, past_due_since, created_at, updated_at)
  values ('${id}', '${tenant}', 'demo', '{hr-employees}', ${amount}, '${status}', '2000-01-01', now() + interval '20 days',
          ${nextCharge}, ${pastDue}, '2000-01-01', now())`)

let browser
try {
  check('V144_1 applied: past_due_since + billing_reminders_sent exist',
    sql(`select count(*) from information_schema.columns where table_schema='platform' and table_name='subscriptions' and column_name='past_due_since'`) === '1'
    && sql(`select to_regclass('platform.billing_reminders_sent') is not null`) === 't')

  plant(ids.soon, 'ACTIVE', 4000, `now() + interval '2 days'`, 'null')
  plant(ids.overdue, 'PAST_DUE', 125000, `now() + interval '1 day'`, `now() - interval '2 days'`)
  plant(ids.later, 'ACTIVE', 700, `now() + interval '10 days'`, 'null')

  // Wait for the job (every 15 s here).
  let sent = ''
  for (let i = 0; i < 12; i++) {
    sent = sql(`select string_agg(kind, ',' order by kind) from platform.billing_reminders_sent where subscription_id in (${idList})`)
    if (sent.split(',').length >= 2) break
    await sleep(5000)
  }
  check('the job reminds the due-soon and the overdue subscription, not the one due in 10 days', sent === 'DUE_SOON,OVERDUE', sent)

  const ownerEmp = sql(`select employee_id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='owner@unifiedtree.demo'`)
  const rows = () => sql(`select type || '|' || title || '|' || coalesce(body,'') from notif.notifications
     where tenant_id='${tenant}' and user_id='${ownerEmp}' and type in ('PAYMENT_DUE_SOON','PAYMENT_OVERDUE') and created_at >= '${start}' order by type`).split('\n').filter(Boolean)
  const r1 = rows()
  const soon = r1.find((r) => r.startsWith('PAYMENT_DUE_SOON|'))
  const overdue = r1.find((r) => r.startsWith('PAYMENT_OVERDUE|'))
  check('owner: "Payment of ₹4,000 due in 2 days"', soon?.split('|')[1] === 'Payment of ₹4,000 due in 2 days', soon)
  check('owner: due-soon body names the date', soon?.includes(`on ${ist(new Date(now + 2 * DAY))}`), soon)
  const dueOn = new Date(now - 2 * DAY)
  check('owner: "Payment of ₹1,25,000 is overdue"', overdue?.split('|')[1] === 'Payment of ₹1,25,000 is overdue', overdue)
  check('owner: overdue body gives the due date and grace end (due + 7 days)',
    overdue?.includes(`due on ${ist(dueOn)}`) && overdue?.includes(`Pay by ${ist(new Date(dueOn.getTime() + 7 * DAY))}`), overdue)
  const admins = sql(`select count(distinct uc.employee_id) from rbac.user_roles ur join auth.user_credentials uc on uc.id = ur.user_id
     where ur.tenant_id='${tenant}' and ur.role_id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010')
       and uc.employee_id is not null and uc.is_active`)
  const told = sql(`select count(distinct user_id) from notif.notifications where tenant_id='${tenant}' and type='PAYMENT_OVERDUE' and created_at >= '${start}'`)
  check('every owner / super admin gets it (and no one else)', told === admins, `${told} told, ${admins} owner/super admins`)

  await sleep(35000)   // two more job runs
  check('still one reminder per subscription today', sql(`select count(*) from platform.billing_reminders_sent where subscription_id in (${idList})`) === '2')
  check('the owner still has one of each', rows().length === 2, String(rows().length))

  // Web: the reminder is in the owner's notifications and opens the plan page.
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 90000 })
  const later = page.getByRole('button', { name: 'Continue without checking in' })
  await later.waitFor({ timeout: 4000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  await page.getByRole('button', { name: /notifications/i }).first().click()
  const item = page.getByText('Payment of ₹4,000 due in 2 days').first()
  await item.waitFor({ timeout: 20000 }).catch(() => {})
  check('web: the owner sees the reminder in the notification panel', await item.isVisible().catch(() => false))
  await page.screenshot({ path: `${shots}/chakri-billing-reminder-panel.png` })
  await item.click().catch(() => {})
  await page.waitForURL(/\/plan/, { timeout: 15000 }).catch(() => {})
  check('web: clicking it opens the plan page', new URL(page.url()).pathname.startsWith('/plan'), page.url())
  check('web: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  sql(`delete from notif.notifications where tenant_id='${tenant}' and type in ('PAYMENT_DUE_SOON','PAYMENT_OVERDUE') and created_at >= '${start}'`)
  sql(`delete from platform.subscriptions where id in (${idList})`)   // billing_reminders_sent rows cascade
  check('cleanup: nothing planted is left', sql(`select count(*) from platform.subscriptions where id in (${idList})`) === '0')
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
