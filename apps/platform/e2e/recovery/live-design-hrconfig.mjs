// Live check of HR Configuration (/hrms/settings) in the Payroll Settings
// design's settings pattern, against the local API. The owner changes the
// late-grace minutes and the probation reminder days, saves, and the database
// is checked; a bad prefix blocks the save; /hrms/settings/work-time opens the
// same page. The reader and the manager see it view-only or not at all. Every
// value is put back at the end.
//
//   node e2e/recovery/live-design-hrconfig.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const shots = process.env.SHOTS_DIR || ''
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const grace0 = sql(`select coalesce(late_grace_minutes::text,'null') from settings.hr_configuration where company_id='${company}'`)
const prob0 = sql(`select count(*) from hrms.probation_config`)
const probRow0 = sql(`select coalesce(string_agg(reminder_days_before||'/'||auto_extend_enabled||'/'||auto_extend_days, ','),'') from hrms.probation_config`)

const browser = await chromium.launch()
const session = async (email, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }

try {
  // ── Owner: edits and saves ──
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/hrms/settings'); await settle(page)
    await page.getByRole('heading', { name: 'HR Configuration' }).waitFor({ timeout: 30_000 })
    const toc = page.getByRole('navigation', { name: 'On this page' })
    check('"On this page" lists the seven sections', (await toc.getByRole('link').count()) === 7)
    for (const h of ['Employee IDs', 'Probation', 'Notice & retirement', 'Work week', 'Late arrival', 'Attendance rules', 'Fiscal year']) {
      check(`section "${h}" renders`, (await page.getByRole('heading', { name: h, exact: true }).count()) === 1)
    }
    check('next employee code preview uses the real settings', (await page.getByText(/next: EMP-\d{4}/).count()) > 0)
    if (shots) await page.screenshot({ path: `${shots}/hrconfig-owner.png`, fullPage: false })

    // Validation: an empty prefix blocks the save.
    const prefix = page.getByLabel('Prefix', { exact: true })
    await prefix.fill('')
    await page.getByRole('button', { name: 'Save settings' }).click()
    check('empty prefix shows an error and blocks the save', (await page.getByText('Use 1–10 letters or digits').count()) > 0 && (await page.getByText(/Fix 1 error to save/).count()) > 0)
    await page.getByRole('button', { name: 'Discard' }).click()
    check('discard clears the unsaved bar', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 0)

    // Save: late grace + reminder days.
    const grace = page.getByLabel('Company grace period')
    const g = grace0 === '17' ? '18' : '17'
    await grace.fill(g)
    await page.getByLabel('Remind managers and HR').fill('21')
    check('unsaved bar counts 2 changes', (await page.getByText('2 changes · not saved yet').count()) === 1)
    await page.getByRole('button', { name: 'Save settings' }).click()
    await page.locator('[role=status]').filter({ hasText: 'HR settings saved' }).first().waitFor({ timeout: 15_000 }).catch(() => {})
    check('save writes the grace minutes', sql(`select late_grace_minutes from settings.hr_configuration where company_id='${company}'`) === g)
    check('save writes the reminder days', sql(`select reminder_days_before from hrms.probation_config limit 1`) === '21')
    check('unsaved bar goes away after saving', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 0)

    // Old link opens the same page.
    await page.goto(base + '/hrms/settings/work-time'); await settle(page)
    await page.getByRole('heading', { name: 'HR Configuration' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(600)
    const top = await page.getByRole('heading', { name: 'Work week', exact: true }).evaluate((el) => el.getBoundingClientRect().top)
    check('/hrms/settings/work-time opens at the Work week section', top < 400, `top=${Math.round(top)}`)
    check('owner: no page errors', !errors.length, errors[0] || '')
    check('owner: no failed API calls', !failed.length, failed.slice(0, 3).join(' | '))

    // Phone width: chip nav instead of the side list.
    const m = await session('owner@unifiedtree.demo', 390)
    await m.page.goto(base + '/hrms/settings'); await settle(m.page)
    await m.page.getByRole('heading', { name: 'HR Configuration' }).waitFor({ timeout: 30_000 })
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('phone: no sideways scroll', overflow <= 1, `overflow=${overflow}`)
    if (shots) await m.page.screenshot({ path: `${shots}/hrconfig-mobile.png` })
    await m.ctx.close()
    await ctx.close()
  }

  // ── Reader and manager: view only, or no access ──
  for (const who of ['reader@unifiedtree.demo', 'mgr@unifiedtree.demo']) {
    const { ctx, page, errors, failed } = await session(who)
    await page.goto(base + '/hrms/settings'); await settle(page); await page.waitForTimeout(800)
    const heading = await page.getByRole('heading', { name: 'HR Configuration' }).count()
    const viewOnly = await page.getByText('View only', { exact: true }).count()
    const saveable = await page.getByRole('textbox').count()
    const state = heading ? (viewOnly ? 'view-only' : saveable ? 'EDITABLE' : 'shown') : 'blocked'
    check(`${who}: view-only or blocked, never editable`, state === 'view-only' || state === 'blocked', state)
    check(`${who}: no page errors`, !errors.length, errors[0] || '')
    check(`${who}: no failed API calls`, !failed.length, failed.slice(0, 3).join(' | '))
    if (shots && heading) await page.screenshot({ path: `${shots}/hrconfig-${who.split('@')[0]}.png` })
    await ctx.close()
  }
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  try {
    sql(`update settings.hr_configuration set late_grace_minutes=${grace0} where company_id='${company}'`)
    if (prob0 === '0') sql(`delete from hrms.probation_config`)
    else { const [d, a, x] = probRow0.split(',')[0].split('/'); sql(`update hrms.probation_config set reminder_days_before=${d}, auto_extend_enabled=${a === 't'}, auto_extend_days=${x}`) }
  } catch (e) { console.log('cleanup:', String(e).split('\n')[0]) }
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
