// Live check for w3 "Upcoming milestones: date ranges" (26 Sep 2026), against a
// local backend + web app (the shared live slot):
//  1. API: each list (birthdays, work anniversaries, retirements) follows its
//     own range — every preset, a custom range across the year end, 29 February
//     on the 28th, no anniversary in the joining year; a list without a range
//     keeps its old window; bad ranges are refused (12-month cap).
//  2. "View all": the directory's milestone filter with the same range picks
//     the same people; retirement due takes the range too.
//  3. Access: department manager and employee see what they saw before (the
//     milestones list; still refused on the directory and retirement due). A
//     range on the milestones list reaches no further than its old windows:
//     birthdays / anniversaries a year either side of today (no birth years,
//     no anniversaries of people not yet joined), retirements today to 60
//     months on (no dates of birth from far or past retirements).
//  4. Browser (owner): each preset changes the dashboard card's list, a custom
//     range on the calendar across the year end, "View all" opens the directory
//     on that range; the manager's dashboard and the employee's staff dashboard
//     work with ranges too; no page errors or failed API calls. Screenshots of
//     the card at 1440 and 390 wide.
// Creates a few test employees and removes them at the end.
//
//   node e2e/recovery/live-w3-milestones.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_APP_URL,
//        RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD, SHOTS
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
mkdirSync(shots, { recursive: true })
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',
  ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }

// ── dates (IST), the same rules as src/design/dc/milestoneRange.ts ─────────────
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const P = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const I = (d) => d.toISOString().slice(0, 10)
const addDays = (iso, n) => { const d = P(iso); d.setUTCDate(d.getUTCDate() + n); return I(d) }
const addMonths = (iso, n) => {
  const d = P(iso), day = d.getUTCDate(), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  t.setUTCDate(Math.min(day, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()))
  return I(t)
}
const endOfMonth = (iso) => { const d = P(iso); return I(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) }
const firstOfMonth = (iso, n = 0) => addMonths(iso.slice(0, 8) + '01', n)
const today = istToday()
const year = Number(today.slice(0, 4))
const PRESETS = {
  'This month': { from: today, to: endOfMonth(today) },
  'Next month': { from: firstOfMonth(today, 1), to: endOfMonth(firstOfMonth(today, 1)) },
  'Next 3 months': { from: today, to: addMonths(today, 3) },
  'Next 6 months': { from: today, to: addMonths(today, 6) },
  'This year': { from: today, to: `${year}-12-31` },
}
const inRange = (iso, r) => iso >= r.from && iso <= r.to
/** Where a yearly date falls inside a range (29 Feb → 28 Feb in other years), or null. */
const occurrence = (original, r) => {
  for (let y = Number(r.from.slice(0, 4)); y <= Number(r.to.slice(0, 4)); y++) {
    if (y <= Number(original.slice(0, 4))) continue
    let md = original.slice(5)
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    if (md === '02-29' && !leap) md = '02-28'
    const d = `${y}-${md}`
    if (inRange(d, r)) return d
  }
  return null
}
const withYear = (iso, y) => `${y}${iso.slice(4)}`
const dayLabel = (iso) => { const d = P(iso); return `${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}` }

// Fixture days: one in each preset band. `soon` is in "This month", `nextM` in
// "Next month" only, `in3` in "Next 3 months" but neither of those, `in6` in
// "Next 6 months" but not "Next 3 months".
const soon = addDays(today, 2) <= endOfMonth(today) ? addDays(today, 2) : today
const nextM = addDays(firstOfMonth(today, 1), 9)
const in3 = addDays(firstOfMonth(today, 2), 14)
const in6 = addDays(firstOfMonth(today, 5), 9)
// The nearest December-to-January inside a year of today (the reach of a birthday range).
const yeY = today < `${year}-01-20` ? year - 1 : year
const yearEnd = { from: `${yeY}-12-15`, to: `${yeY + 1}-01-20` }
// Retirement fixtures outside the milestones list's reach: 7 years on, and 2 months ago (still working).
const farRetire = addMonths(today, 84)
const pastRetire = addMonths(today, -2)

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call }
}

const tag = randomUUID().slice(0, 6)
const created = []
const age = (() => { const a = Number(sql(`select coalesce(retirement_age, 0) from settings.hr_configuration where company_id='${company}' and tenant_id='${tenant}'`) || 0); return a >= 30 && a <= 100 ? a : 60 })()
const browser = await chromium.launch({ headless: true })

try {
  const owner = await login('owner@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')

  // ── fixtures ──────────────────────────────────────────────────────────────
  const hire = async (label, body) => {
    const r = await owner.call('/v1/hrms/employees', 'POST', { companyId: company, firstName: 'QA', lastName: `Ms${label}${tag}`, email: `qa.ms.${label.toLowerCase()}.${tag}@unifiedtree.demo`, ...body })
    if (r.json?.id) created.push(r.json.id)
    if (r.status !== 201) throw new Error(`could not create ${label}: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
    return { id: r.json.id, name: `QA Ms${label}${tag}`, ...body }
  }
  const joinedOn = addDays(today, -400)
  const F = {
    bSoon: await hire('BSoon', { dateOfBirth: withYear(soon, 1990), dateOfJoining: joinedOn }),
    bNext: await hire('BNext', { dateOfBirth: withYear(nextM, 1991), dateOfJoining: joinedOn }),
    b3: await hire('BThree', { dateOfBirth: withYear(in3, 1992), dateOfJoining: joinedOn }),
    b6: await hire('BSix', { dateOfBirth: withYear(in6, 1993), dateOfJoining: joinedOn }),
    bDec: await hire('BDec', { dateOfBirth: '1994-12-20', dateOfJoining: joinedOn }),
    bJan: await hire('BJan', { dateOfBirth: '1995-01-05', dateOfJoining: joinedOn }),
    bLeap: await hire('BLeap', { dateOfBirth: '1996-02-29', dateOfJoining: joinedOn }),
    aNext: await hire('ANext', { dateOfJoining: withYear(nextM, year - 3) }),
    a3: await hire('AThree', { dateOfJoining: withYear(in3, year - 1) }),
    aNew: await hire('ANew', { dateOfJoining: nextM }),
    r3: await hire('RThree', { dateOfBirth: withYear(in3, Number(in3.slice(0, 4)) - age), dateOfJoining: joinedOn }),
    rFar: await hire('RFar', { dateOfBirth: withYear(farRetire, Number(farRetire.slice(0, 4)) - age), dateOfJoining: joinedOn }),
    rPast: await hire('RPast', { dateOfBirth: withYear(pastRetire, Number(pastRetire.slice(0, 4)) - age), dateOfJoining: joinedOn }),
  }
  check('fixtures: test employees created', created.length === Object.keys(F).length)
  const retireOn = in3

  // ── 1. API: each list follows its range ───────────────────────────────────
  const ms = async (u, q) => u.call(`/v1/hrms/milestones?${new URLSearchParams(q)}`)
  const ids = (list) => new Set((list || []).map((m) => m.employeeId))
  /** The directory returns employee records (id), the milestones list people (employeeId). */
  const dirIds = (list) => new Set((list || []).map((e) => e.id))
  for (const [label, r] of Object.entries(PRESETS)) {
    const b = await ms(owner, { birthdayFrom: r.from, birthdayTo: r.to })
    const want = [F.bSoon, F.bNext, F.b3, F.b6, F.bDec, F.bJan, F.bLeap].filter((f) => occurrence(f.dateOfBirth, r))
    const got = ids(b.json?.birthdays)
    const wrong = [F.bSoon, F.bNext, F.b3, F.b6, F.bDec, F.bJan, F.bLeap].filter((f) => got.has(f.id) !== want.includes(f))
    const row = (b.json?.birthdays || []).find((m) => m.employeeId === want[0]?.id)
    check(`API birthdays "${label}" (${r.from}..${r.to}) lists exactly the fixtures inside it`, b.status === 200 && !wrong.length && (!want.length || row?.date === occurrence(want[0].dateOfBirth, r)), `status=${b.status} wrong=${wrong.map((f) => f.name).join(',')}`)
    const a = await ms(owner, { anniversaryFrom: r.from, anniversaryTo: r.to })
    const aGot = ids(a.json?.anniversaries)
    const aWant = [F.aNext, F.a3].filter((f) => occurrence(f.dateOfJoining, r))
    const aWrong = [F.aNext, F.a3].filter((f) => aGot.has(f.id) !== aWant.includes(f))
    check(`API anniversaries "${label}" follow the range; the joining year is never listed`, a.status === 200 && !aWrong.length && !aGot.has(F.aNew.id), `wrong=${aWrong.map((f) => f.name).join(',')} new=${aGot.has(F.aNew.id)}`)
    const rt = await ms(owner, { retirementFrom: r.from, retirementTo: r.to })
    check(`API retirements "${label}" follow the range (company age ${age})`, rt.status === 200 && ids(rt.json?.retirements).has(F.r3.id) === inRange(retireOn, r))
    // The other two lists keep their own windows when only one list has a range.
    check(`API "${label}" on birthdays leaves anniversaries on their 31-day window`, b.status === 200 && ids(b.json?.anniversaries).has(F.aNext.id) === inRange(occurrence(F.aNext.dateOfJoining, { from: today, to: addDays(today, 366) }) || '9999', { from: today, to: addDays(today, 31) }))
  }
  const threeMonths = await ms(owner, { anniversaryFrom: PRESETS['Next 3 months'].from, anniversaryTo: PRESETS['Next 3 months'].to })
  const a3row = (threeMonths.json?.anniversaries || []).find((m) => m.employeeId === F.a3.id)
  const aNextRow = (threeMonths.json?.anniversaries || []).find((m) => m.employeeId === F.aNext.id)
  check('API anniversaries count the years (1 and 3)', a3row?.years === 1 && aNextRow?.years === 3, JSON.stringify([a3row, aNextRow]).slice(0, 200))
  const ye = await ms(owner, { birthdayFrom: yearEnd.from, birthdayTo: yearEnd.to })
  const yeRows = (ye.json?.birthdays || []).filter((m) => [F.bDec.id, F.bJan.id].includes(m.employeeId))
  check('API birthdays across the year end: 20 Dec and 5 Jan, soonest first', ye.status === 200 && yeRows.length === 2 && yeRows[0].date === `${yeY}-12-20` && yeRows[1].date === `${yeY + 1}-01-05` && !ids(ye.json?.birthdays).has(F.b3.id), JSON.stringify(yeRows).slice(0, 200))
  // A February to March in a non-leap year, inside a year of today.
  const nonLeap = [year - 1, year, year + 1].find((y) => !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) && `${y}-02-01` >= addMonths(today, -12) && `${y}-03-31` <= addMonths(today, 12))
  const leapRes = await ms(owner, { birthdayFrom: `${nonLeap}-02-01`, birthdayTo: `${nonLeap}-03-31` })
  check('API 29 February birthdays show on 28 February in a non-leap year', (leapRes.json?.birthdays || []).find((m) => m.employeeId === F.bLeap.id)?.date === `${nonLeap}-02-28`)
  const keys = Object.keys((ye.json?.birthdays || [])[0] || {}).sort().join(',')
  check('API a range row has the same fields as before (no extra data)', keys === 'date,department,employeeId,initials,name,years', keys)
  // No range: the old windows, unchanged.
  const old = await ms(owner, { birthdayDays: 14, anniversaryDays: 31, retirementMonths: 6 })
  check('API without a range: birthdays keep the 14-day window', old.status === 200 && ids(old.json?.birthdays).has(F.bSoon.id) && !ids(old.json?.birthdays).has(F.b3.id))
  check('API without a range: retirements keep the 6-month window', ids(old.json?.retirements).has(F.r3.id) === inRange(retireOn, { from: today, to: addMonths(today, 6) }))
  // Bad ranges.
  const tooLong = await ms(owner, { birthdayFrom: today, birthdayTo: addMonths(today, 12) })
  check('API a range of 12 months or more is refused (422)', tooLong.status === 422, `status=${tooLong.status}`)
  const twelve = await ms(owner, { birthdayFrom: today, birthdayTo: addDays(addMonths(today, 12), -1) })
  check('API 12 months less a day is accepted', twelve.status === 200, `status=${twelve.status}`)
  const backwards = await ms(owner, { anniversaryFrom: '2026-12-01', anniversaryTo: '2026-11-01' })
  check('API an end before the start is refused (422)', backwards.status === 422, `status=${backwards.status}`)
  const half = await ms(owner, { retirementFrom: '2026-12-01' })
  check('API a range with only a start is refused (422)', half.status === 422, `status=${half.status}`)
  const junk = await ms(owner, { birthdayFrom: 'soon', birthdayTo: '2026-12-01' })
  check('API a date that is not a date is refused (400)', junk.status === 400, `status=${junk.status}`)

  // ── 2. "View all" and retirement due take the same range ──────────────────
  const dir = async (u, kind, r) => u.call(`/v1/hrms/employees?milestone=${kind}&milestoneFrom=${r.from}&milestoneTo=${r.to}&pageSize=200`)
  for (const [kind, list, r] of [['birthday', 'birthdays', yearEnd], ['birthday', 'birthdays', PRESETS['Next 3 months']], ['anniversary', 'anniversaries', PRESETS['Next 3 months']], ['retirement', 'retirements', PRESETS['Next 6 months']]]) {
    const d = await dir(owner, kind, r)
    const m = await ms(owner, { [`${kind}From`]: r.from, [`${kind}To`]: r.to })
    const a = [...dirIds(d.json?.content)].sort().join(','), b = [...ids(m.json?.[list])].sort().join(',')
    check(`View all: the directory's ${kind} filter for ${r.from}..${r.to} is the card's list`, d.status === 200 && a === b && a.length > 0, `dir=${a.split(',').length} card=${b.split(',').length}`)
  }
  const dirOld = await owner.call('/v1/hrms/employees?milestone=birthday&pageSize=200')
  check('View all without a range keeps the 14-day window', dirOld.status === 200 && dirIds(dirOld.json?.content).has(F.bSoon.id) && !dirIds(dirOld.json?.content).has(F.b3.id))
  const dirBad = await owner.call(`/v1/hrms/employees?milestone=birthday&milestoneFrom=${today}&milestoneTo=${addMonths(today, 13)}`)
  check('View all refuses a range over 12 months (422)', dirBad.status === 422, `status=${dirBad.status}`)
  const due = await owner.call(`/v1/hrms/retirements/due?from=${PRESETS['Next 3 months'].from}&to=${PRESETS['Next 3 months'].to}&companyId=${company}`)
  check('retirement due takes the range (company age)', due.status === 200 && (due.json || []).some((x) => x.employeeId === F.r3.id && x.retirementDate === retireOn && x.retirementAge === age))
  const dueOld = await owner.call('/v1/hrms/retirements/due?days=30')
  check('retirement due without a range is unchanged', dueOld.status === 200 && ids((dueOld.json || []).map((x) => ({ employeeId: x.employeeId }))).has(F.r3.id) === inRange(retireOn, { from: today, to: addDays(today, 30) }))

  // ── 3. access unchanged ───────────────────────────────────────────────────
  for (const [who, u] of [['department manager', mgr], ['employee', reader]]) {
    const r = await ms(u, { birthdayFrom: PRESETS['Next 3 months'].from, birthdayTo: PRESETS['Next 3 months'].to })
    check(`access: ${who} reads the milestones list with a range, as before without one`, r.status === 200 && ids(r.json?.birthdays).has(F.b3.id))
    check(`access: ${who} is still refused on the directory filter (403)`, (await dir(u, 'birthday', yearEnd)).status === 403)
    check(`access: ${who} is still refused on retirement due with a range (403)`, (await u.call(`/v1/hrms/retirements/due?from=${today}&to=${addMonths(today, 3)}`)).status === 403)
    // A range reaches no further than the old windows did.
    const far = await ms(u, { retirementFrom: addMonths(today, 78), retirementTo: addDays(addMonths(today, 90), -1) })
    check(`access: ${who} sees no retirements more than 60 months out (no dates of birth)`, far.status === 200 && (far.json?.retirements || []).length === 0, `status=${far.status} n=${(far.json?.retirements || []).length}`)
    const past = await ms(u, { retirementFrom: addMonths(today, -6), retirementTo: addMonths(today, 3) })
    check(`access: ${who} sees retirements from today only (not people already past it)`, past.status === 200 && !ids(past.json?.retirements).has(F.rPast.id) && ids(past.json?.retirements).has(F.r3.id))
    const born = await ms(u, { birthdayFrom: '1994-06-01', birthdayTo: '1995-05-31' })
    check(`access: ${who} gets no birthdays decades back (no birth years)`, born.status === 200 && (born.json?.birthdays || []).length === 0, `status=${born.status} n=${(born.json?.birthdays || []).length}`)
    const ahead = await ms(u, { anniversaryFrom: addMonths(today, 6), anniversaryTo: addDays(addMonths(today, 18), -1) })
    check(`access: ${who} sees no anniversary of someone not joined yet`, ahead.status === 200 && !ids(ahead.json?.anniversaries).has(F.aNew.id))
  }
  // Retirement due (people who can read employee records) still takes any range.
  const dueFar = await owner.call(`/v1/hrms/retirements/due?from=${addMonths(today, 78)}&to=${addDays(addMonths(today, 90), -1)}&companyId=${company}`)
  check('retirement due still shows a retirement 7 years out to people who can read employee records', dueFar.status === 200 && (dueFar.json || []).some((x) => x.employeeId === F.rFar.id && x.retirementDate === farRetire))
  const duePast = await owner.call(`/v1/hrms/retirements/due?from=${addMonths(today, -6)}&to=${today}&companyId=${company}`)
  check('retirement due still shows a past retirement to people who can read employee records', duePast.status === 200 && (duePast.json || []).some((x) => x.employeeId === F.rPast.id))
  const ownerFar = await ms(owner, { retirementFrom: addMonths(today, 78), retirementTo: addDays(addMonths(today, 90), -1) })
  check('the milestones list keeps the same reach for everyone (owner too)', ownerFar.status === 200 && !ids(ownerFar.json?.retirements).has(F.rFar.id))

  // ── 4. browser ────────────────────────────────────────────────────────────
  const session = async (email, width = 1440) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
    const page = await ctx.newPage()
    const errors = [], failed = [], asked = [], other = []
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
    // This feature's calls must not fail; anything else that fails is printed as a note.
    page.on('response', (r) => {
      if (!r.url().includes('/api/')) return
      const mine = /\/milestones|\/retirements\/due|milestone=/.test(r.url())
      if (mine) asked.push(decodeURIComponent(r.url()))
      if (r.status() >= 400) (mine ? failed : other).push(`${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`)
    })
    await page.goto(base + '/login')
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
    await page.waitForTimeout(1500)
    errors.length = 0; failed.length = 0; other.length = 0
    const done = async (who) => { if (other.length) console.log(`NOTE  ${who}: other API calls failed (not this feature): ${[...new Set(other)].slice(0, 6).join(' | ')}`); await ctx.close() }
    return { ctx, page, errors, failed, asked, done }
  }
  const col = (page, kind) => page.locator(`[data-milestone-list="${kind}"]`)
  const settle = async (page) => { await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('[data-milestone-list] [aria-busy="true"], [data-milestone-list] .animate-pulse'), null, { timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(200) }
  const choose = async (page, kind, label) => {
    await col(page, kind).locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitemradio', { name: new RegExp('^' + label) }).click()
    await settle(page)
  }
  const listText = async (page, kind) => {
    const more = col(page, kind).getByRole('button', { name: /^Show all/ })
    if (await more.count()) await more.click()
    return col(page, kind).innerText()
  }
  /** Picks a day on a DatePicker: opens it, steps months with its arrows, clicks the day. */
  const pickDate = async (page, trigger, iso) => {
    await trigger.click()
    const pop = page.getByRole('dialog', { name: /^choose date$/i }).last()
    await pop.waitFor({ timeout: 5_000 })
    const day = pop.getByRole('gridcell', { name: new RegExp(`^\\w+, ${dayLabel(iso)}`) })
    const m = ((await trigger.innerText()) || '').match(/(\d{1,2}) (\w{3}) (\d{4})/)
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const cur = m ? `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : today
    const step = iso > cur ? /next month/i : /previous month/i
    for (let i = 0; i < 30 && !(await day.count()); i++) await pop.getByRole('button', { name: step }).click()
    await day.first().click()
    await settle(page)
  }

  /** Opens a DatePicker and says whether its "Previous month" arrow can be used, then closes it. */
  const prevEnabled = async (page, trigger) => {
    await trigger.click()
    const pop = page.getByRole('dialog', { name: /^choose date$/i }).last()
    await pop.waitFor({ timeout: 5_000 })
    const on = await pop.getByRole('button', { name: /previous month/i }).first().isEnabled()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    return on
  }

  // Owner: the admin dashboard card.
  {
    const { page, errors, failed, asked, done } = await session('owner@unifiedtree.demo')
    await page.goto(base + '/dashboard')
    const card = page.locator('[data-milestones-card]')
    await card.waitFor({ timeout: 30_000 })
    await settle(page)
    check('UI owner: the card shows three lists, each on its old window', (await col(page, 'birthdays').locator('button[aria-haspopup="menu"]').innerText()).includes('Next 14 days')
      && (await col(page, 'anniversaries').locator('button[aria-haspopup="menu"]').innerText()).includes('Next 31 days')
      && (await col(page, 'retirements').locator('button[aria-haspopup="menu"]').innerText()).includes('Next 6 months'))
    await card.scrollIntoViewIfNeeded()
    await card.screenshot({ path: `${shots}/milestones-card-1440.png` })
    const seen = {}
    for (const label of Object.keys(PRESETS)) {
      asked.length = 0
      await choose(page, 'birthdays', label)
      const t = await listText(page, 'birthdays')
      const r = PRESETS[label]
      const fx = [F.bSoon, F.bNext, F.b3, F.b6]
      const wrong = fx.filter((f) => t.includes(f.name) !== !!occurrence(f.dateOfBirth, r))
      const req = asked.find((u) => u.includes('birthdayFrom='))
      check(`UI owner birthdays "${label}": the list follows the range`, !wrong.length && req && req.includes(`birthdayFrom=${r.from}`) && req.includes(`birthdayTo=${r.to}`), `wrong=${wrong.map((f) => f.name).join(',')} req=${req || 'none'}`)
      seen[label] = fx.filter((f) => t.includes(f.name)).map((f) => f.name).join(',')
    }
    check('UI owner: every preset gave a different list', new Set(Object.values(seen)).size >= 4, JSON.stringify(seen))
    await choose(page, 'anniversaries', 'Next 3 months')
    const at = await listText(page, 'anniversaries')
    check('UI owner anniversaries "Next 3 months": both fixtures, with their years; the new joiner is not listed', at.includes(F.a3.name) && at.includes(F.aNext.name) && !at.includes(F.aNew.name) && /3 years/.test(at))
    await choose(page, 'retirements', 'Next 3 months')
    check('UI owner retirements "Next 3 months": the fixture retires inside it', (await listText(page, 'retirements')).includes(F.r3.name))
    // The menu, open, for the record.
    await col(page, 'birthdays').locator('button[aria-haspopup="menu"]').click()
    await page.waitForTimeout(200)
    await card.screenshot({ path: `${shots}/milestones-menu-1440.png` })
    await page.keyboard.press('Escape')
    // Custom range across the year end, on the calendar.
    await choose(page, 'birthdays', 'Custom range')
    const pickers = col(page, 'birthdays').locator('button[aria-haspopup="dialog"]')
    check('UI owner custom range: From and To calendars appear', (await pickers.count()) === 2)
    check('UI owner custom range: birthdays say how far they reach', (await col(page, 'birthdays').innerText()).includes('within a year of today'))
    await pickDate(page, pickers.nth(0), yearEnd.from)
    await pickDate(page, pickers.nth(1), yearEnd.to)
    const ct = await listText(page, 'birthdays')
    const req = asked.find((u) => u.includes(`birthdayFrom=${yearEnd.from}`) && u.includes(`birthdayTo=${yearEnd.to}`))
    check('UI owner custom range across the year end lists 20 Dec and 5 Jan, not November', !!req && ct.includes(F.bDec.name) && ct.includes(F.bJan.name) && !ct.includes(F.b3.name), `req=${!!req}`)
    const toAria = (await pickers.nth(1).innerText()) || ''
    check('UI owner custom range: the To calendar shows the chosen day', toAria.includes(`${Number(yearEnd.to.slice(8))} Jan ${yeY + 1}`), toAria)
    await card.screenshot({ path: `${shots}/milestones-custom-1440.png` })
    // "View all" follows the range.
    await col(page, 'birthdays').getByRole('button', { name: /View all/ }).click()
    await page.waitForURL((u) => u.pathname === '/hrms/employees', { timeout: 15_000 })
    const url = new URL(page.url())
    check('UI owner View all opens the directory on the same range', url.searchParams.get('filter') === 'birthday' && url.searchParams.get('from') === yearEnd.from && url.searchParams.get('to') === yearEnd.to, url.search)
    await page.getByText(/Milestone:/).first().waitFor({ timeout: 30_000 }).catch(() => {})
    const filterText = await page.getByText(/Milestone:/).first().innerText().catch(() => '')
    check('UI owner directory: the milestone filter names the range', filterText.includes('Birthdays') && filterText.includes('15 Dec'), filterText)
    await page.goto(base + `/hrms/employees?filter=birthday&from=${yearEnd.from}&to=${yearEnd.to}&q=${tag}`)
    await page.getByText(F.bDec.name).first().waitFor({ timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    check('UI owner directory: only the people inside the range (20 Dec, 5 Jan)', body.includes(F.bDec.name) && body.includes(F.bJan.name) && !body.includes(F.b3.name) && !body.includes(F.bSoon.name))
    // Retirements from retirement due (a company is chosen): the calendar is not limited to the milestones list's reach.
    await page.goto(base + '/dashboard')
    await card.waitFor({ timeout: 30_000 })
    await settle(page)
    const viaDue = asked.some((u) => u.includes('/retirements/due'))
    await choose(page, 'retirements', 'Custom range')
    const rNote = await col(page, 'retirements').innerText()
    const rPrev = await prevEnabled(page, col(page, 'retirements').locator('button[aria-haspopup="dialog"]').nth(0))
    check('UI owner retirements custom range: limited to today .. 5 years only when read from the milestones list', viaDue ? (rPrev && rNote.includes('Up to 12 months.')) : (!rPrev && rNote.includes('from today to 5 years ahead')), `viaDue=${viaDue} prev=${rPrev}`)
    check('UI owner: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('UI owner: no failed milestone / retirement / directory-filter calls', failed.length === 0, failed.slice(0, 5).join(' | '))
    await done('owner')
  }

  // Owner on a phone.
  {
    const { page, errors, done } = await session('owner@unifiedtree.demo', 390)
    await page.goto(base + '/dashboard')
    const card = page.locator('[data-milestones-card]')
    await card.waitFor({ timeout: 30_000 })
    await settle(page)
    await card.scrollIntoViewIfNeeded()
    await card.screenshot({ path: `${shots}/milestones-card-390.png` })
    const cb = await card.boundingBox()
    await choose(page, 'anniversaries', 'Custom range')
    await card.screenshot({ path: `${shots}/milestones-custom-390.png` })
    const box = await col(page, 'anniversaries').boundingBox()
    const inner = await card.evaluate((el) => el.scrollWidth - el.clientWidth)
    check('UI phone: the card fits 390 wide, custom range inside its list', cb && cb.x >= 0 && cb.x + cb.width <= 390 && box && box.x >= 0 && box.x + box.width <= 390 && inner <= 1, `card=${JSON.stringify(cb)} list=${JSON.stringify(box)} inner=${inner}`)
    await col(page, 'retirements').locator('button[aria-haspopup="menu"]').click()
    const menu = page.getByRole('menu').last()
    const mb = await menu.boundingBox()
    check('UI phone: the range menu opens on screen', mb && mb.x >= 0 && mb.x + mb.width <= 390, JSON.stringify(mb))
    await page.keyboard.press('Escape')
    check('UI phone: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await done('owner (phone)')
  }

  // Department manager: the admin dashboard, lists from the milestones endpoint as before.
  {
    const { page, errors, failed, asked, done } = await session('mgr@unifiedtree.demo')
    await page.goto(base + '/dashboard')
    await page.locator('[data-milestones-card]').waitFor({ timeout: 30_000 })
    await settle(page)
    asked.length = 0
    await choose(page, 'retirements', 'Next 3 months')
    await choose(page, 'birthdays', 'Next 3 months')
    const t = await listText(page, 'birthdays')
    check('UI manager: ranges work; retirements come from the milestones list (no retirement due)', t.includes(F.b3.name) && asked.some((u) => u.includes('retirementFrom=')) && !asked.some((u) => u.includes('/retirements/due')))
    check('UI manager: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('UI manager: no failed milestone calls', failed.length === 0, failed.slice(0, 5).join(' | '))
    await done('manager')
  }

  // Employee: the staff dashboard's card.
  {
    const { page, errors, failed, done } = await session('reader@unifiedtree.demo')
    await page.goto(base + '/dashboard')
    await col(page, 'birthdays').waitFor({ timeout: 30_000 })
    await settle(page)
    const pill = await col(page, 'birthdays').locator('button[aria-haspopup="menu"]').innerText()
    await choose(page, 'birthdays', 'Next 3 months')
    const t = await listText(page, 'birthdays')
    await choose(page, 'birthdays', 'This month')
    const t2 = await listText(page, 'birthdays')
    check('UI employee: the staff card has the same range menu and follows it', pill.includes('Next 14 days') && t.includes(F.b3.name) && !t2.includes(F.b3.name) && t2.includes(F.bSoon.name))
    await col(page, 'birthdays').locator('button[aria-haspopup="menu"]').click()
    const menu = page.getByRole('menu').last()
    const clipped = await menu.evaluate((m) => { const r = m.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6); return !(e && m.contains(e)) })
    check('UI employee: the range menu is not cut off by the card', !clipped)
    // The card and the open menu below it, in one picture.
    const sb = await page.locator('[data-milestones-staff-card]').boundingBox(), mb = await menu.boundingBox()
    if (sb && mb) await page.screenshot({ path: `${shots}/milestones-staff-1440.png`, clip: { x: sb.x, y: sb.y, width: sb.width, height: Math.max(sb.y + sb.height, mb.y + mb.height + 8) - sb.y } })
    await page.keyboard.press('Escape')
    // The custom range's calendars stay inside what the milestones list shows.
    await choose(page, 'retirements', 'Custom range')
    const rPick = col(page, 'retirements').locator('button[aria-haspopup="dialog"]')
    check('UI employee retirements custom range: From starts today (no earlier month)', !(await prevEnabled(page, rPick.nth(0))) && (await col(page, 'retirements').innerText()).includes('from today to 5 years ahead'))
    await choose(page, 'birthdays', 'Custom range')
    check('UI employee birthdays custom range: From can go back (a year)', await prevEnabled(page, col(page, 'birthdays').locator('button[aria-haspopup="dialog"]').nth(0)))
    check('UI employee: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('UI employee: no failed milestone calls', failed.length === 0, failed.slice(0, 5).join(' | '))
    await done('employee')
  }

  // Employee on a phone.
  {
    const { page, errors, done } = await session('reader@unifiedtree.demo', 390)
    await page.goto(base + '/dashboard')
    const staff = page.locator('[data-milestones-staff-card]')
    await staff.waitFor({ timeout: 30_000 })
    await settle(page)
    await staff.scrollIntoViewIfNeeded()
    await staff.screenshot({ path: `${shots}/milestones-staff-390.png` })
    const sb = await staff.boundingBox()
    check('UI employee phone: the staff card fits 390 wide', sb && sb.x >= 0 && sb.x + sb.width <= 390, JSON.stringify(sb))
    check('UI employee phone: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await done('employee (phone)')
  }
} catch (e) {
  check('run completed without an exception', false, String(e?.stack || e).split(/\r?\n/).slice(0, 3).join(' | '))
} finally {
  await browser.close().catch(() => {})
  const idList = created.map(lit).join(',')
  const cleanup = created.length ? [
    `delete from notif.notifications where user_id in (${idList}) or data->>'employeeId' in (${idList})`,
    `delete from notif.milestone_reminder_log where employee_id in (${idList})`,
    `delete from hrms.employees where id in (${idList}) and tenant_id='${tenant}'`,
  ] : []
  for (const q of cleanup) { try { sql(q) } catch (e) { console.log('cleanup failed:', q.slice(0, 80), String(e).split(/\r?\n/)[0]) } }
  const left = sql(`select count(*) from hrms.employees where last_name like 'Ms%${tag}'`)
  check('cleanup: every test employee is removed', left === '0', `left=${left}`)
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}
