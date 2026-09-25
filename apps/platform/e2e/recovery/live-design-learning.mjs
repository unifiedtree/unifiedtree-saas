// Live check of the redesigned Learning page (/hrms/learning):
//  - owner: Programs, My training, Skill matrix, Certifications; creates a
//    QA program and opens its roster
//  - employee: can now reach Learning from the sidebar (it was HR-only before,
//    though employees can enroll); sees Programs and My training only; enrolls,
//    sees "You're enrolled", finds it under My training and leaves it
//  - department manager: no refused API calls
// The QA program and its enrollments are removed at the end.
//
//   node e2e/recovery/live-design-learning.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const browser = await chromium.launch()
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
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
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
const viewNames = async (page) => (await page.locator('[aria-label="Learning views"] button').allInnerTexts()).map((t) => t.replace(/\s+\d+$/, '').trim())
const title = `QA program ${Date.now()}`
try {
  const o = await session('owner@unifiedtree.demo')
  await o.page.goto(base + '/hrms/learning'); await settle(o.page)
  const ov = await viewNames(o.page)
  check('owner: four views', JSON.stringify(ov) === JSON.stringify(['Programs', 'My training', 'Skill matrix', 'Certifications']), ov.join(' | '))
  await o.page.getByRole('button', { name: /New program/ }).click()
  await o.page.locator('#lp-title').fill(title)
  await o.page.locator('#lp-cap').fill('5')
  await o.page.getByRole('button', { name: 'Create program' }).click()
  await o.page.getByText(title, { exact: true }).waitFor({ timeout: 15000 })
  check('owner: creates a program', true)
  const row = o.page.getByRole('row').filter({ hasText: title })
  check('owner: status reads "Planned"', (await row.getByRole('combobox').inputValue()) === 'PLANNED' && (await row.getByRole('option', { name: 'Planned' }).count()) === 1)
  await row.getByRole('button', { name: 'Roster' }).click(); await settle(o.page)
  check('owner: roster opens', (await o.page.getByText(/^Roster · 0 enrolled/).count()) === 1)
  await o.page.locator('[aria-label="Learning views"]').getByRole('button', { name: /^Skill matrix/ }).click(); await settle(o.page)
  check('owner: skill matrix asks whose record', (await o.page.getByText('Whose skills?', { exact: true }).count()) === 1)
  check('owner: no refused API calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')
  await o.ctx.close()

  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/performance'); await settle(r.page)
  check('employee: "Learning & Skills" is in the navigation', (await r.page.getByText('Learning & Skills', { exact: true }).count()) > 0)
  await r.page.goto(base + '/hrms/learning?view=skills'); await settle(r.page)
  const rv = await viewNames(r.page)
  check('employee: Programs and My training only', JSON.stringify(rv) === JSON.stringify(['Programs', 'My training']), rv.join(' | '))
  const rrow = r.page.getByRole('row').filter({ hasText: title })
  await rrow.getByRole('button', { name: 'Enroll' }).click()
  await rrow.getByText('You’re enrolled', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  check('employee: enrolls and sees "You’re enrolled"', (await rrow.getByText('You’re enrolled', { exact: true }).count()) === 1)
  check('employee: no roster or status controls', (await rrow.getByRole('button', { name: 'Roster' }).count()) === 0 && (await rrow.getByRole('combobox').count()) === 0)
  await r.page.locator('[aria-label="Learning views"]').getByRole('button', { name: /^My training/ }).click(); await settle(r.page)
  check('employee: the program is under My training', (await r.page.getByText(title, { exact: true }).count()) === 1)
  r.page.once('dialog', (d) => d.accept())
  await r.page.locator('div').filter({ has: r.page.getByText(title, { exact: true }) }).filter({ has: r.page.getByRole('button', { name: 'Leave' }) }).last().getByRole('button', { name: 'Leave' }).click()
  await r.page.getByText(/You’ve left/).waitFor({ timeout: 15000 }).catch(() => {})
  const st = sql(`select e.status from learning_mgmt.training_enrollments e join learning_mgmt.training_programs p on p.id=e.program_id where p.title='${title}'`)
  check('employee: leaves the program', st === 'DROPPED', `status=${st}`)
  check('employee: no refused API calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  const m = await session('mgr@unifiedtree.demo')
  await m.page.goto(base + '/hrms/learning'); await settle(m.page)
  const mv = await viewNames(m.page)
  check('manager: Programs and My training', JSON.stringify(mv) === JSON.stringify(['Programs', 'My training']), mv.join(' | '))
  check('manager: no refused API calls or page errors', !m.failed.length && !m.errors.length, m.failed[0] || m.errors[0] || '')
  await m.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  sql(`delete from learning_mgmt.training_enrollments where program_id in (select id from learning_mgmt.training_programs where title like 'QA program %')`)
  sql(`delete from learning_mgmt.training_programs where title like 'QA program %'`)
  check('cleanup: QA program removed', sql(`select count(*) from learning_mgmt.training_programs where title like 'QA program %'`) === '0')
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
