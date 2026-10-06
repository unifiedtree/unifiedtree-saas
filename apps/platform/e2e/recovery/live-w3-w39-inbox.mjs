// Live check of w39 (6 Oct): the website's Approvals list at parity with the phone app, and Customise on the
// quick actions (G-59).
//   1. Approvals: a salary advance, an overtime request and a skill level raised by Reader show in his manager's
//      Approvals (My team › Approvals) next to the server's own rows; the inbox is asked for leave waiting for HR
//      (includeL2); the manager's own proposal is never his to decide; overtime and skill rejections ask for a
//      reason; each decision goes through its own page's endpoint.
//   2. Quick actions: Customise on the Dashboard (owner) and Home (Reader, phone width) picks and orders up to 6,
//      saves per person (GET/PUT /v1/me/quick-actions), survives a reload, and Reset to default goes back.
// What it creates: one advance, one overtime request and one skill proposal for Reader (rejected by the test:
// decided requests can't be deleted through the API, so they stay as history), one skill proposal for the manager
// (withdrawn at the end), and quick-action picks (reset at the end).
//
//   node e2e/recovery/live-w3-w39-inbox.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
/* global process, console, fetch, document */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body !== undefined ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
async function signIn(page, email) {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/') && r.status() >= 400 && !u.includes('/canonical-auth/refresh')) failed.push(`${label}: ${r.status()} ${r.request().method()} ${u.split('/api')[1]}`)
  })
  return { errors, failed }
}
const visible = (locator, timeout = 20_000) => locator.waitFor({ timeout }).then(() => true, () => false)
const tileLabels = async (page) => page.getByRole('group', { name: 'Quick actions' }).locator('.uk-qa__label').allTextContents()

const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const today = `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}-${parts.find((p) => p.type === 'day').value}`
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const stamp = Date.now().toString(36)
const skillName = `QA skill ${stamp}`
const ownSkillName = `QA own ${stamp}`
const made = { skill: null, ownSkill: null, overtime: null, advance: null }
let reader, mgr, owner
const browser = await chromium.launch()
const watched = []

try {
  reader = await login('reader@unifiedtree.demo')
  mgr = await login('mgr@unifiedtree.demo')
  owner = await login('owner@unifiedtree.demo')

  // ── seed: three requests from Reader, one proposal from the manager himself ──
  const sk = await reader('/v1/learning/skill-assessments', 'POST', { skillName, proposedProficiency: 4, note: 'Live test w39' })
  made.skill = sk.json?.id ?? null
  check('seed: Reader proposes a skill level', sk.status < 300 && !!made.skill, `${sk.status} ${JSON.stringify(sk.json).slice(0, 160)}`)
  const own = await mgr('/v1/learning/skill-assessments', 'POST', { skillName: ownSkillName, proposedProficiency: 3, note: 'Live test w39 (own)' })
  made.ownSkill = own.json?.id ?? null
  check('seed: the manager proposes his own skill level', own.status < 300 && !!made.ownSkill, `${own.status}`)
  for (let n = 3; n <= 12 && !made.overtime; n++) {
    const ot = await reader('/v1/attendance/overtime/requests', 'POST', { date: plusDays(today, n), minutes: 120, reason: 'Live test w39 overtime' })
    if (ot.status < 300) made.overtime = ot.json?.id ?? null
    else if (ot.json?.errorCode !== 'OVERTIME_REQUEST_EXISTS') { check('seed: Reader asks for overtime', false, `${ot.status} ${JSON.stringify(ot.json).slice(0, 200)}`); break }
  }
  if (made.overtime) check('seed: Reader asks for overtime', true)
  const adv = await reader('/v1/advance/requests', 'POST', { amount: 5000, reason: `Live test w39 ${stamp}`, repaymentMonths: 2 })
  made.advance = adv.json?.id ?? null
  check('seed: Reader asks for a salary advance', adv.status < 300 && !!made.advance, `${adv.status} ${JSON.stringify(adv.json).slice(0, 200)}`)

  // ── 1. the manager's Approvals ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const w = watch(page, 'mgr'); watched.push(w)
  await signIn(page, 'mgr@unifiedtree.demo')
  const inboxCall = page.waitForResponse((r) => r.url().includes('/v1/team/approvals?') && r.request().method() === 'GET', { timeout: 30_000 }).catch(() => null)
  await page.goto(base + '/team?view=approvals')
  const ir = await inboxCall
  check('the inbox is asked for leave waiting for HR (includeL2)', !!ir && ir.url().includes('includeL2=true') && ir.ok(), ir ? `${ir.status()} ${ir.url().split('/api')[1]}` : 'no request')

  const card = (text) => page.locator('article.uko-apprc').filter({ hasText: text })
  const skillTitle = `${skillName}: new skill → Advanced`
  check('a skill level shows in Approvals', await visible(card(skillTitle)))
  check('… labelled as a skill level', ((await card(skillTitle).first().textContent()) || '').includes('Skill level'))
  if (made.overtime) check('an overtime request shows in Approvals', await visible(card('Overtime request').filter({ hasText: 'Reader' })))
  if (made.advance) check('a salary advance shows in Approvals', await visible(card('Salary advance').filter({ hasText: '₹5,000' })))
  const ownCards = card(ownSkillName)
  const ownCount = await ownCards.count()
  const ownDecidable = ownCount > 0 && (await ownCards.first().getByRole('button', { name: 'Approve' }).count()) > 0
  check('the manager\'s own proposal is never his to decide', !ownDecidable, ownCount ? 'shown without buttons' : 'not listed')
  await page.screenshot({ path: `${SHOTS}/w39-approvals-1440.png`, fullPage: true })

  // Overtime request: Reject with no note asks for a reason, then goes through the overtime endpoint.
  if (made.overtime) {
    const otCard = card('Overtime request').filter({ hasText: 'Reader' }).first()
    await otCard.getByRole('button', { name: 'Reject' }).click()
    const dlg = page.getByRole('dialog', { name: /Reject Reader’s overtime request\?/ })
    check('rejecting overtime asks for a reason', await visible(dlg, 5000))
    await page.screenshot({ path: `${SHOTS}/w39-approvals-reason-1440.png` })
    await dlg.getByRole('textbox', { name: /Reason/ }).fill('Not planned this week (live test)')
    const call = page.waitForResponse((r) => r.url().includes(`/v1/attendance/overtime/requests/${made.overtime}/reject`), { timeout: 15_000 }).catch(() => null)
    await dlg.getByRole('button', { name: 'Reject' }).click()
    const rr = await call
    check('… and is rejected through the overtime endpoint', !!rr && rr.ok(), rr ? String(rr.status()) : 'no request')
    const mine = await reader('/v1/attendance/overtime/requests/my')
    check('… Reader sees it rejected with the note', (mine.json || []).some((x) => x.id === made.overtime && x.status === 'REJECTED' && /Not planned/.test(x.decisionNote || '')))
    if ((mine.json || []).some((x) => x.id === made.overtime && x.status === 'REJECTED')) made.overtime = null
  }

  // Skill: the same, through the skill endpoint.
  {
    const skCard = card(skillTitle).first()
    await skCard.getByRole('button', { name: 'Reject' }).click()
    const dlg = page.getByRole('dialog', { name: /Reject Reader’s skill level\?/ })
    check('rejecting a skill level asks for a reason', await visible(dlg, 5000))
    await dlg.getByRole('textbox', { name: /Reason/ }).fill('Show the project first (live test)')
    const call = page.waitForResponse((r) => r.url().includes(`/v1/learning/skill-assessments/${made.skill}/decide`), { timeout: 15_000 }).catch(() => null)
    await dlg.getByRole('button', { name: 'Reject' }).click()
    const rr = await call
    check('… and is rejected through the skill endpoint', !!rr && rr.ok(), rr ? String(rr.status()) : 'no request')
    check('… and leaves the list', await card(skillTitle).first().waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false))
    if (rr && rr.ok()) made.skill = null
  }

  // Advance: Reject needs no reason; it goes through the advance decision.
  if (made.advance) {
    const advCard = card('Salary advance').filter({ hasText: '₹5,000' }).first()
    const call = page.waitForResponse((r) => r.url().includes(`/v1/advance/requests/${made.advance}/decision`), { timeout: 15_000 }).catch(() => null)
    await advCard.getByRole('button', { name: 'Reject' }).click()
    const rr = await call
    check('rejecting an advance goes through the advance decision', !!rr && rr.ok(), rr ? String(rr.status()) : 'no request')
    const one = await reader(`/v1/advance/requests/${made.advance}`)
    check('… Reader sees it rejected', one.json?.status === 'REJECTED', String(one.json?.status))
  }

  // Phone width: the list stays inside the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/team?view=approvals')
  await page.waitForLoadState('networkidle')
  const sw = await page.evaluate(() => document.documentElement.scrollWidth)
  check('390px: Approvals has no sideways scroll', sw <= 391, `scrollWidth ${sw}`)
  await page.screenshot({ path: `${SHOTS}/w39-approvals-390.png`, fullPage: true })
  await ctx.close()

  // ── 2a. Quick actions on the Dashboard (owner) ──
  const g = await owner('/v1/me/quick-actions')
  check('GET /v1/me/quick-actions answers (no picks yet)', g.status === 200 && g.json?.available === true && g.json?.picked == null, `${g.status} ${JSON.stringify(g.json)}`)
  const bad7 = await owner('/v1/me/quick-actions?surface=dashboard', 'PUT', { picked: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
  check('more than 6 picks are refused', bad7.status === 422, String(bad7.status))
  const badSurface = await owner('/v1/me/quick-actions?surface=payroll')
  check('an unknown surface is refused', badSurface.status === 400, String(badSurface.status))

  const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const op = await octx.newPage()
  const ow = watch(op, 'owner'); watched.push(ow)
  await signIn(op, 'owner@unifiedtree.demo')
  await op.goto(base + '/dashboard')
  await op.getByRole('group', { name: 'Quick actions' }).waitFor({ timeout: 30_000 })
  const before = await tileLabels(op)
  check('Dashboard shows the default quick actions', before.length >= 3, before.join(', '))
  const customise = op.getByRole('button', { name: 'Customise' })
  check('Dashboard offers Customise', await visible(customise))
  await customise.click()
  const dlg = op.getByRole('dialog', { name: 'Customise quick actions' })
  check('Customise opens', await visible(dlg, 5000))
  const last = before[before.length - 1], third = before[2]
  await dlg.getByText(last, { exact: true }).click() // untick the last one
  await dlg.getByRole('button', { name: `Move ${third} up` }).click()
  await dlg.getByRole('button', { name: `Move ${third} up` }).click()
  await op.screenshot({ path: `${SHOTS}/w39-customise-1440.png` })
  const save = op.waitForResponse((r) => r.url().includes('/v1/me/dashboard/quick-actions') && r.request().method() === 'PUT', { timeout: 15_000 }).catch(() => null)
  await dlg.getByRole('button', { name: 'Save' }).click()
  const sr = await save
  check('Save stores the picks', !!sr && sr.ok(), sr ? String(sr.status()) : 'no request')
  const expected = [third, ...before.slice(0, before.length - 1).filter((x) => x !== third)]
  await op.waitForTimeout(500)
  check('the tiles follow the picks', JSON.stringify(await tileLabels(op)) === JSON.stringify(expected), (await tileLabels(op)).join(', '))
  await op.reload()
  await op.getByRole('group', { name: 'Quick actions' }).waitFor({ timeout: 30_000 })
  await op.waitForTimeout(800)
  check('… and survive a reload', JSON.stringify(await tileLabels(op)) === JSON.stringify(expected), (await tileLabels(op)).join(', '))
  const g2 = await owner('/v1/me/quick-actions?surface=dashboard')
  check('the app can read the same picks', Array.isArray(g2.json?.picked) && g2.json.picked.length === expected.length, JSON.stringify(g2.json?.picked))
  await op.getByRole('button', { name: 'Customise' }).click()
  const reset = op.waitForResponse((r) => r.url().includes('/v1/me/dashboard/quick-actions') && r.request().method() === 'PUT', { timeout: 15_000 }).catch(() => null)
  await op.getByRole('dialog', { name: 'Customise quick actions' }).getByRole('button', { name: 'Reset to default' }).click()
  await reset
  await op.waitForTimeout(500)
  check('Reset to default brings back the default tiles', JSON.stringify(await tileLabels(op)) === JSON.stringify(before), (await tileLabels(op)).join(', '))
  check('… and clears the saved picks', (await owner('/v1/me/quick-actions')).json?.picked == null)
  await octx.close()

  // ── 2b. Quick actions on Home (Reader, phone width) ──
  const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const rp = await rctx.newPage()
  const rw = watch(rp, 'reader'); watched.push(rw)
  await signIn(rp, 'reader@unifiedtree.demo')
  await rp.goto(base + '/')
  await rp.getByRole('group', { name: 'Quick actions' }).waitFor({ timeout: 30_000 })
  const homeBefore = await tileLabels(rp)
  await rp.getByRole('button', { name: 'Customise' }).click()
  const hd = rp.getByRole('dialog', { name: 'Customise quick actions' })
  check('Home offers Customise', await visible(hd, 5000))
  const keep = homeBefore.slice(0, 2)
  for (const label of homeBefore.slice(2, 6)) await hd.getByText(label, { exact: true }).click()
  await rp.waitForTimeout(300)
  const db = await hd.boundingBox()
  check('390px: the dialog stays inside the screen', !!db && db.x >= 0 && db.x + db.width <= 390.5, JSON.stringify(db))
  await rp.screenshot({ path: `${SHOTS}/w39-customise-home-390.png` })
  const hs = rp.waitForResponse((r) => r.url().includes('/v1/me/dashboard/quick-actions?surface=home') && r.request().method() === 'PUT', { timeout: 15_000 }).catch(() => null)
  await hd.getByRole('button', { name: 'Save' }).click()
  const hsr = await hs
  check('Home saves its own picks (surface=home)', !!hsr && hsr.ok(), hsr ? String(hsr.status()) : 'no request')
  await rp.waitForTimeout(500)
  const homeAfter = await tileLabels(rp)
  check('Home shows only the picked tiles', JSON.stringify(homeAfter) === JSON.stringify(keep), homeAfter.join(', '))
  check('the Dashboard picks are untouched by Home', (await reader('/v1/me/quick-actions?surface=dashboard')).json?.picked == null)
  await rp.getByRole('button', { name: 'Customise' }).click()
  await rp.getByRole('dialog', { name: 'Customise quick actions' }).getByRole('button', { name: 'Reset to default' }).click()
  await rp.waitForTimeout(800)
  check('Home: Reset to default', JSON.stringify(await tileLabels(rp)) === JSON.stringify(homeBefore), (await tileLabels(rp)).join(', '))
  const hsw = await rp.evaluate(() => document.documentElement.scrollWidth)
  check('390px: Home has no sideways scroll', hsw <= 391, `scrollWidth ${hsw}`)
  await rctx.close()

  const errors = watched.flatMap((x) => x.errors), failed = watched.flatMap((x) => x.failed)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  check('no failed API calls from the pages', failed.length === 0, failed.slice(0, 4).join(' | '))
} catch (e) {
  check('script completed', false, String(e.message || e).slice(0, 300))
} finally {
  // Remove what can be removed: anything still waiting is withdrawn; picks go back to the default.
  try {
    if (reader && made.skill) await reader(`/v1/learning/skill-assessments/${made.skill}/withdraw`, 'POST')
    if (mgr && made.ownSkill) await mgr(`/v1/learning/skill-assessments/${made.ownSkill}/withdraw`, 'POST')
    if (reader && made.overtime) await reader(`/v1/attendance/overtime/requests/${made.overtime}/cancel`, 'POST')
    for (const call of [owner, reader]) {
      if (!call) continue
      for (const s of ['dashboard', 'home']) await call(`/v1/me/quick-actions?surface=${s}`, 'PUT', { picked: null })
    }
  } catch (e) {
    console.log('cleanup: ' + String(e.message || e))
  }
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
