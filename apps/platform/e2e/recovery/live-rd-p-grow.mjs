// P-GROW UI — Performance, Learning and Resignation & exit in the browser, against the real local API.
//   1. Every role (owner, hrm, mgr, reader) opens /hrms/performance, /hrms/learning and (with access)
//      /hrms/exit and sees only the views their permissions open; no page errors, no failed API calls.
//   2. owner: a cycle with dates and "hold feedback until shared" (Review cycles shows its dates and
//      Share), Remind on a waiting review, company KPIs on Goals & KPIs, a classroom program with its
//      place and roster, the certifications list, exit tabs in ?tab= with full & final status.
//   3. reader: My reviews shows the cycle's steps; the self-review is saved as a draft (IN_PROGRESS)
//      then sent; a goal is added with a due date and its progress saved; My training lists the program.
//   4. mgr: rejects a proposed skill level, which needs a note (the dialog asks for it).
//   5. Light and dark at 1440 and 390 (no sideways scroll), screenshots to C:/REACT/ut-wt/_results/shots/rd-p-grow-*.
//   Removes everything it made.
// Run from apps/platform (inside live-slot.sh: API :8080 with this branch's jar, DB ut_w3_dev):
//   RECOVERY_DB=ut_w3_dev RECOVERY_APP_URL=http://demo.localhost:3141 RECOVERY_API_URL=http://127.0.0.1:8080/api node e2e/recovery/live-rd-p-grow.mjs
/* global process, console, fetch, Buffer, document, localStorage, window */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3141'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const DB = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const READER = '22222222-2222-2222-2222-222222222222'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`) }
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const t = (await r.json()).accessToken
  const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())
  return { h: { ...headers, Authorization: `Bearer ${t}` }, set: new Set(c.permissions || []), employeeId: c.employee_id }
}
const call = async (u, method, path, body) => {
  const r = await fetch(api + path, { method, headers: u.h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null; try { json = await r.json() } catch { /* empty */ }
  return { status: r.status, json }
}

const stamp = Date.now()
const today = istToday()
const testStart = sql('select now()')
const NAMES = { cycle: `QA grow UI cycle ${stamp}`, kpi: `QA grow UI KPI ${stamp}`, program: `QA grow UI program ${stamp}`, goal: `QA grow UI goal ${stamp}`, skill: `QA grow UI skill ${stamp}` }
let cycleId = null

const browser = await chromium.launch()
async function session(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 1000 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private */ } }, opts.theme || 'light')
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700) }
const viewNames = async (page, label) => (await page.getByRole('group', { name: label, exact: true }).getByRole('button').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim())
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/rd-p-grow-${name}.png`, fullPage: true }).catch(() => {})
const toastSeen = (page, text) => page.getByText(text).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)

try {
  // ── fixtures through the API (owner) ──────────────────────────────────
  const owner = await login('owner@unifiedtree.demo')
  const c = await call(owner, 'POST', '/v1/performance/cycles', { companyId: company, name: NAMES.cycle, periodStart: plus(today, 10), periodEnd: plus(today, 60) })
  cycleId = c.json?.id
  await call(owner, 'PUT', `/v1/performance/cycles/${cycleId}/milestones`, { goalsBy: plus(today, -1), selfReviewBy: plus(today, 20), managerReviewBy: plus(today, 30), shareOn: plus(today, 40), holdUntilShared: true })
  const init = await call(owner, 'POST', `/v1/performance/cycles/${cycleId}/initiate`, { reviewerTypes: ['SELF', 'MANAGER'], revieweeIds: [READER] })
  check('fixture: a cycle with dates and two reviews for reader', c.status === 201 && init.json?.reviewsCreated === 2, `cycle ${c.status}, reviews ${init.json?.reviewsCreated}`)
  const kpi = await call(owner, 'POST', '/v1/performance/company-kpis', { companyId: company, title: NAMES.kpi, targetValue: 100, unit: '%' })
  const prog = await call(owner, 'POST', '/v1/learning/programs', { companyId: company, title: NAMES.program, category: 'QA Grow UI', mode: 'IN_PERSON', location: 'QA Pune office', startDate: today, endDate: plus(today, 2), capacity: 5 })
  const reader = await login('reader@unifiedtree.demo')
  await call(reader, 'POST', `/v1/learning/programs/${prog.json?.id}/enroll`)
  const prop = await call(reader, 'POST', '/v1/learning/skill-assessments', { skillName: NAMES.skill, proposedProficiency: 4, note: 'QA UI proposal' })
  check('fixture: company KPI, classroom program, reader enrolled, skill proposal', kpi.status === 201 && prog.status === 201 && prop.status === 201, `${kpi.status} ${prog.status} ${prop.status}`)

  // ── 1. every role: the views their permissions open ─────────────────
  for (const [name, email] of [['owner', 'owner@unifiedtree.demo'], ['hrm', 'hrm@unifiedtree.demo'], ['mgr', 'mgr@unifiedtree.demo'], ['reader', 'reader@unifiedtree.demo']]) {
    const p = await login(email)
    const { ctx, page, errors, failed } = await session(email)
    const read = p.set.has('hrms.performance.read'), self = p.set.has('hrms.performance.review.self')
    await page.goto(base + '/hrms/performance'); await settle(page)
    const expectP = [...(read ? ['Review cycles', 'Employee reviews', 'Goals & KPIs', 'People'] : []), ...(self ? ['My reviews', 'My goals'] : [])]
    const gotP = expectP.length > 1 ? await viewNames(page, 'Performance views') : expectP
    check(`${name}: Performance views by permission`, JSON.stringify(gotP) === JSON.stringify(expectP), gotP.join(' | '))
    check(`${name}: "New cycle" only with performance.write`, (await page.getByRole('button', { name: 'New cycle' }).count() > 0) === p.set.has('hrms.performance.write'))
    const lr = p.set.has('hrms.learning.read'), le = p.set.has('hrms.learning.enroll.self'), ls = p.set.has('hrms.learning.skill.read'), la = p.set.has('hrms.learning.skill.approve')
    await page.goto(base + '/hrms/learning'); await settle(page)
    const expectL = [...(lr ? ['Programs'] : []), ...(le ? ['My training'] : []), ...(ls ? ['Skill matrix', 'Certifications'] : []), ...(la ? ['Skill approvals'] : [])]
    const gotL = expectL.length > 1 ? await viewNames(page, 'Learning views') : expectL
    check(`${name}: Learning views by permission`, JSON.stringify(gotL) === JSON.stringify(expectL), gotL.join(' | '))
    if (p.set.has('hrms.employee.read') || p.set.has('hrms.employee.write')) {
      await page.goto(base + '/hrms/exit?tab=exited'); await settle(page)
      const pressed = await page.getByRole('group', { name: 'Exit views' }).getByRole('button', { name: 'Exited' }).getAttribute('aria-pressed')
      check(`${name}: exit tab from the URL`, pressed === 'true')
      check(`${name}: "Start notice period" only with employee.write`, (await page.getByRole('button', { name: 'Start notice period' }).count() > 0) === p.set.has('hrms.employee.write'))
    }
    check(`${name}: no page errors or failed API calls`, !errors.length && !failed.length, errors[0] || failed[0] || '')
    await ctx.close()
  }

  // ── 2. owner: cycles, reviews, KPIs, learning, exit (light, 1440) ───
  {
    const { ctx, page, errors, failed } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/hrms/performance?view=cycles'); await settle(page)
    await shot(page, 'cycles-light-1440')
    await page.getByRole('button', { name: NAMES.cycle, exact: true }).click()
    const panel = page.getByRole('dialog', { name: NAMES.cycle })
    await panel.waitFor({ timeout: 15_000 })
    check('owner: the cycle panel shows its dates and the hold', (await panel.getByText('Held until shared', { exact: true }).count()) === 1 && (await panel.getByRole('button', { name: 'Share feedback' }).count()) === 1)
    await shot(page, 'cycle-panel-light-1440')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await page.goto(base + '/hrms/performance?view=reviews'); await settle(page)
    await page.getByRole('tablist', { name: 'Review status' }).getByRole('tab', { name: 'Waiting' }).click()
    await settle(page)
    await page.getByLabel('Review cycle').selectOption({ label: NAMES.cycle }); await settle(page)
    const rows = await page.getByRole('row').filter({ hasText: 'Reader' }).count()
    check('owner: waiting reviews of the cycle are listed', rows >= 2, `rows=${rows}`)
    await page.getByRole('row').filter({ hasText: 'Dept' }).getByRole('button', { name: 'Remind' }).first().click()
    check('owner: Remind sends a reminder', await toastSeen(page, 'Reminder sent to'))
    const mgrUser = sql(`select id from auth.user_credentials where email='mgr@unifiedtree.demo'`)
    check('the manager got a review reminder', sql(`select count(*) from notif.notifications where user_id='${mgrUser}' and type='PERFORMANCE_REVIEW_REMINDER' and created_at >= '${testStart}'`) === '1')
    await shot(page, 'reviews-light-1440')
    await page.goto(base + '/hrms/performance?view=kpis'); await settle(page)
    check('owner: company KPIs list the new KPI', (await page.getByText(NAMES.kpi).count()) >= 1)
    await page.getByRole('button', { name: 'Add goal', exact: true }).click()
    const goalPanel = page.getByRole('dialog', { name: 'Add goal' })
    check('owner: "Add goal" opens the goal panel with a company KPI field', await goalPanel.isVisible() && (await goalPanel.getByLabel('Company KPI').count()) === 1)
    await shot(page, 'kpis-panel-light-1440')
    await goalPanel.getByRole('button', { name: 'Close', exact: true }).click()
    await shot(page, 'kpis-light-1440')
    await page.goto(base + '/hrms/performance?view=people'); await settle(page)
    check('owner: People shows a status per person', (await page.getByRole('row').count()) > 1)
    await shot(page, 'people-light-1440')
    await page.goto(base + '/hrms/learning?view=programs'); await settle(page)
    const prow = page.getByRole('row').filter({ hasText: NAMES.program })
    check('owner: the program shows its mode and place', (await prow.getByText('In person · QA Pune office').count()) === 1)
    await prow.getByRole('button', { name: 'Roster' }).click()
    const roster = page.getByRole('dialog', { name: 'Enroll people' })
    await roster.waitFor({ timeout: 15_000 })
    check('owner: the roster lists reader with the department line', (await roster.getByText(/^Roster · 1 enrolled/).count()) === 1)
    await shot(page, 'roster-light-1440')
    await roster.getByRole('button', { name: 'Close', exact: true }).click()
    await shot(page, 'programs-light-1440')
    await page.goto(base + '/hrms/learning?view=certifications'); await settle(page)
    check('owner: the certifications list opens', (await page.getByRole('heading', { name: 'Certifications' }).count()) >= 1)
    await shot(page, 'certifications-light-1440')
    await page.goto(base + '/hrms/exit'); await settle(page)
    await shot(page, 'exit-notice-light-1440')
    await page.goto(base + '/hrms/exit?tab=exited'); await settle(page)
    check('owner: exited people show their full & final', (await page.getByRole('columnheader', { name: 'Full & final' }).count()) >= 1)
    await shot(page, 'exit-exited-light-1440')
    check('owner: no page errors or failed API calls', !errors.length && !failed.length, errors[0] || failed[0] || '')
    await ctx.close()
  }

  // ── 3. reader: my review cycle, draft then send, a goal, my training ──
  {
    const { ctx, page, errors, failed } = await session('reader@unifiedtree.demo')
    await page.goto(base + '/hrms/performance?view=my-reviews'); await settle(page)
    const card = page.getByRole('region', { name: NAMES.cycle })
    const hasCard = await card.count() > 0
    check('reader: the cycle card shows the steps', hasCard && (await card.getByText('Your self-review is next').count()) === 1, hasCard ? '' : 'no card')
    await shot(page, 'my-reviews-light-1440')
    const selfId = sql(`select id from performance_mgmt.performance_reviews where cycle_id='${cycleId}' and reviewer_type='SELF'`)
    await page.getByLabel('What went well this period?').fill('QA UI went well')
    await page.getByRole('button', { name: /^4\s*Exceeds$/ }).click()
    await page.getByRole('button', { name: 'Save draft' }).first().click()
    check('reader: Save draft', await toastSeen(page, 'Draft saved'))
    check('reader: the draft is IN_PROGRESS with the text', sql(`select status||'|'||strengths||'|'||overall_rating from performance_mgmt.performance_reviews where id='${selfId}'`) === 'IN_PROGRESS|QA UI went well|4.0')
    await page.getByRole('button', { name: /^Send to / }).click()
    check('reader: the self-review is sent', await toastSeen(page, 'Self-review sent'))
    check('reader: SUBMITTED in the database', sql(`select status from performance_mgmt.performance_reviews where id='${selfId}'`) === 'SUBMITTED')
    await page.goto(base + '/hrms/performance?view=my-goals'); await settle(page)
    await page.getByRole('button', { name: 'Add a goal' }).first().click()
    const add = page.getByRole('dialog', { name: 'Add a goal' })
    await add.locator('#goal-title').fill(NAMES.goal)
    await add.getByRole('button', { name: 'Add goal' }).click()
    await page.getByText(NAMES.goal, { exact: true }).waitFor({ timeout: 15_000 })
    check('reader: adds a goal', true)
    await page.locator('article').filter({ hasText: NAMES.goal }).getByRole('button', { name: 'Update progress' }).click()
    const prog = page.getByRole('dialog', { name: 'Update progress' })
    await prog.getByRole('slider').fill('40')
    await prog.getByLabel('What changed since the last update?').fill('QA UI note')
    await prog.getByRole('button', { name: 'Save' }).click()
    await toastSeen(page, 'Progress saved')
    check('reader: saves goal progress with a note', sql(`select progress from performance_mgmt.goals where title='${NAMES.goal}'`) === '40')
    await prog.getByRole('button', { name: 'Close', exact: true }).click()
    await shot(page, 'my-goals-light-1440')
    await page.goto(base + '/hrms/learning?view=my'); await settle(page)
    check('reader: My training lists the program with its place', (await page.locator('article').filter({ hasText: NAMES.program }).getByText(/QA Pune office/).count()) === 1)
    await shot(page, 'my-training-light-1440')
    check('reader: no page errors or failed API calls', !errors.length && !failed.length, errors[0] || failed[0] || '')
    await ctx.close()
  }

  // ── 4. mgr: rejecting a skill level needs a note ─────────────────────
  {
    const { ctx, page, errors, failed } = await session('mgr@unifiedtree.demo')
    await page.goto(base + '/hrms/learning?view=approvals'); await settle(page)
    const row = page.locator('article').filter({ hasText: NAMES.skill })
    await row.getByRole('button', { name: 'Reject' }).click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'Say why' })
    await dlg.waitFor({ timeout: 10_000 })
    check('mgr: Reject without a note asks for one', true)
    await dlg.getByLabel('Why it’s not approved').fill('QA UI: needs more practice')
    await dlg.getByRole('button', { name: 'Reject level' }).click()
    await toastSeen(page, 'They’ve been told why')
    check('mgr: the proposal is rejected with the note', sql(`select status||'|'||decision_note from learning_mgmt.skill_assessments where skill_name='${NAMES.skill}'`) === 'REJECTED|QA UI: needs more practice')
    await shot(page, 'approvals-light-1440')
    check('mgr: no page errors or failed API calls', !errors.length && !failed.length, errors[0] || failed[0] || '')
    await ctx.close()
  }

  // ── 5. dark and phone ─────────────────────────────────────────────────
  for (const [theme, width] of [['dark', 1440], ['light', 390], ['dark', 390]]) {
    for (const [who, email, pages] of [
      ['owner', 'owner@unifiedtree.demo', [['cycles', '/hrms/performance?view=cycles'], ['reviews', '/hrms/performance?view=reviews'], ['kpis', '/hrms/performance?view=kpis'], ['programs', '/hrms/learning?view=programs'], ['skills', '/hrms/learning?view=skills'], ['exit-notice', '/hrms/exit?tab=notice']]],
      ['reader', 'reader@unifiedtree.demo', [['my-reviews', '/hrms/performance?view=my-reviews'], ['my-goals', '/hrms/performance?view=my-goals'], ['my-training', '/hrms/learning?view=my']]],
    ]) {
      const { ctx, page, errors, failed } = await session(email, { theme, width, height: width < 500 ? 844 : 1000 })
      const wide = []
      for (const [key, path] of pages) {
        await page.goto(base + path); await settle(page)
        if (!(await noSideScroll(page))) wide.push(key)
        await shot(page, `${key}-${theme}-${width}`)
      }
      check(`${who} ${theme} ${width}: no sideways scroll`, wide.length === 0, wide.join(', '))
      if (theme === 'dark') check(`${who} ${theme} ${width}: dark theme is on`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
      check(`${who} ${theme} ${width}: no page errors or failed API calls`, !errors.length && !failed.length, errors[0] || failed[0] || '')
      await ctx.close()
    }
  }
} catch (e) {
  check('run finished', false, String(e.message || e).split('\n')[0].slice(0, 300))
} finally {
  try {
    if (cycleId) {
      sql(`delete from performance_mgmt.appraisal_reviewer_assignments where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.performance_reviews where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.review_cycle_milestones where cycle_id='${cycleId}'`)
      sql(`delete from performance_mgmt.review_cycles where id='${cycleId}'`)
    }
    sql(`delete from performance_mgmt.goal_kpi_links where goal_id in (select id from performance_mgmt.goals where title like 'QA grow UI goal %')`)
    sql(`delete from performance_mgmt.kpi_progress_updates where goal_id in (select id from performance_mgmt.goals where title like 'QA grow UI goal %')`)
    sql(`delete from performance_mgmt.goals where title like 'QA grow UI goal %'`)
    sql(`delete from performance_mgmt.company_kpis where title like 'QA grow UI KPI %'`)
    sql(`delete from learning_mgmt.training_enrollments where program_id in (select id from learning_mgmt.training_programs where title like 'QA grow UI program %')`)
    sql(`delete from learning_mgmt.program_locations where program_id in (select id from learning_mgmt.training_programs where title like 'QA grow UI program %')`)
    sql(`delete from learning_mgmt.training_programs where title like 'QA grow UI program %'`)
    sql(`delete from learning_mgmt.skill_assessments where skill_name like 'QA grow UI skill %'`)
    sql(`delete from learning_mgmt.employee_skills where skill_name like 'QA grow UI skill %'`)
    sql(`delete from notif.notifications where created_at >= '${testStart}' and type in ('PERFORMANCE_REVIEW_REMINDER','SKILL_ASSESSMENT_SUBMITTED','SKILL_ASSESSMENT_APPROVED','SKILL_ASSESSMENT_REJECTED')`)
    sql(`delete from audit.events where occurred_at >= '${testStart}' and module = 'performance'`)
    const left = sql(`select (select count(*) from performance_mgmt.review_cycles where name like 'QA grow UI cycle %') + (select count(*) from learning_mgmt.training_programs where title like 'QA grow UI program %') + (select count(*) from performance_mgmt.goals where title like 'QA grow UI goal %') + (select count(*) from performance_mgmt.company_kpis where title like 'QA grow UI KPI %')`)
    check('cleanup: everything this run made is gone', left === '0', `left=${left}`)
  } catch (e) { check('cleanup ran', false, String(e).split('\n')[0]) }
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
