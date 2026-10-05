/* global process, console, fetch, Buffer, document, sessionStorage, localStorage */
// Live check of "Send wishes" and "Show birthdays to colleagues" on Celebrations (backend V143_84 and
// V143_89, owner approved 5 Oct 2026), against a local backend + web app (the shared live slot):
//
//  1. Send wishes. Dept Manager (mgr@) has a birthday today (set on their record for this run).
//     reader@ sends wishes from Home's Celebrations card at 1440 (the composer's second ready-made
//     message); the card then reads "Wished ✓". fin@ sends their own words from the Celebrations page
//     at 390. The manager gets each one as a CELEBRATION_WISH notification (who, and the message, People),
//     sees "2 people wished you" on Home and the wishes on the Celebrations page. hrm@ sends one through
//     the API with untidy spacing (it is trimmed).
//  2. The rules, through the API: sending again answers the wish already sent and tells nobody twice;
//     not to yourself (400), not an anniversary that isn't today (422), not more than 280 characters
//     (400), not someone who isn't in your company (422).
//  3. The setting. The owner turns "Show birthdays to colleagues" off in HR configuration →
//     Celebrations: everyone's Celebrations and Around you have no birthdays (birthdaysHidden), the
//     page has no Birthdays section, birthday wishes are refused (422), anniversaries and new joiners
//     still show; an employee can't change it (403). Turned back on, birthdays return.
//
// Everything it creates is removed at the end (the wishes, their notifications, the setting row and
// its audit rows), and the manager's date of birth is put back.
// Screenshots: /c/REACT/ut-wt/_results/shots/w20-wishes-*.png (1440 and 390 wide).
//
//   node e2e/recovery/live-celebration-wishes.mjs   (inside live-slot.sh)
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_APP_URL, RECOVERY_DB (default ut_w3_dev)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3220'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = process.env.SHOTS || 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const MGR = '44444444-4444-4444-4444-444444444444' // mgr@ (Dept Manager)
const READER = '22222222-2222-2222-2222-222222222222' // reader@ (Reader User)
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().replace(/\r/g, '').trim()
const lit = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
const note = (s) => console.log(`NOTE  ${s}`)

async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login ${email}: ${r.status}`)
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.claims = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString())
  return call
}

// ── what was there before ─────────────────────────────────────────────────────
const start = sql(`select now()`)
const startIso = sql(`select to_char(now() at time zone 'UTC' - interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)
const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`)
const mgrDob = sql(`select coalesce(date_of_birth::text, '') from hrms.employees where id='${MGR}'`)
const mgrJoined = sql(`select coalesce(date_of_joining::text, '') from hrms.employees where id='${MGR}'`)
const tables = sql(`select (to_regclass('hrms.celebration_wishes') is not null)::text || '|' || (to_regclass('settings.celebration_settings') is not null)::text`)
const settingBefore = tables.endsWith('true')
  ? sql(`select coalesce((select show_birthdays::text from settings.celebration_settings where tenant_id='${tenant}' and company_id='${company}'), 'none')`)
  : 'none'

function cleanup() {
  const q = (s) => { try { sql(s) } catch (e) { console.log(`cleanup: ${String(e.message).split('\n')[0]}`) } }
  if (tables.startsWith('true')) q(`delete from hrms.celebration_wishes where tenant_id='${tenant}' and created_at >= '${start}'`)
  q(`delete from notif.notifications where tenant_id='${tenant}' and type='CELEBRATION_WISH' and created_at >= '${start}'`)
  if (tables.endsWith('true')) {
    q(settingBefore === 'none'
      ? `delete from settings.celebration_settings where tenant_id='${tenant}' and company_id='${company}'`
      : `update settings.celebration_settings set show_birthdays=${settingBefore} where tenant_id='${tenant}' and company_id='${company}'`)
  }
  q(`delete from audit.events where tenant_id='${tenant}' and occurred_at >= '${start}' and action='CELEBRATION_SETTING_CHANGED'`)
  q(`update hrms.employees set date_of_birth=${lit(mgrDob)} where id='${MGR}'`)
}

const browser = await chromium.launch()
async function session(email, userId, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 860 : 900 } })
  await ctx.addInitScript(([id, day]) => {
    try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ }
    // The check-in prompt after sign-in has already been seen today: it stays away.
    try { sessionStorage.setItem(`ut.punch-prompt.opened:${id}`, day) } catch { /* private mode */ }
  }, [userId, today])
  const page = await ctx.newPage()
  const errors = [], failed = [], other = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    const path = r.url().split('/api')[1]
    // This feature's calls must not fail; anything else is printed as a note.
    ;(/celebration|\/ess\/around-me|\/settings\/celebrations/.test(path) ? failed : other).push(`${r.status()} ${r.request().method()} ${path}`)
  })
  await page.goto(base + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  // The cards fade in: a moment first, so the picture shows them settled.
  const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${SHOTS}/w20-wishes-${name}.png`, fullPage: false }).catch(() => {}) }
  const done = async (who) => {
    if (other.length) note(`${who}: other API calls failed (not this feature): ${[...new Set(other)].slice(0, 6).join(' | ')}`)
    await ctx.close()
  }
  return { page, errors, failed, shot, done }
}
const later = async (page) => {
  const btn = page.getByRole('button', { name: 'Continue without checking in' })
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {})
}
const notifs = async (who) => ((await who('GET', `/v1/notifications?size=50&since=${startIso}`)).json?.content || []).filter((n) => n.type === 'CELEBRATION_WISH')

try {
  check('the migrations V143_84 and V143_89 are applied', tables === 'true|true', tables)
  const owner = await apiLogin('owner@unifiedtree.demo')
  const mgr = await apiLogin('mgr@unifiedtree.demo')
  const reader = await apiLogin('reader@unifiedtree.demo')
  const fin = await apiLogin('fin@unifiedtree.demo')
  const hrm = await apiLogin('hrm@unifiedtree.demo')

  // ── the manager's birthday is today (30 years ago) ──
  sql(`update hrms.employees set date_of_birth=('${today}'::date - interval '30 years')::date where id='${MGR}'`)
  const cel0 = await reader('GET', '/v1/ess/celebrations?days=30')
  const bday = (cel0.json?.items || []).find((i) => i.kind === 'BIRTHDAY' && i.employeeId === MGR)
  check('Celebrations lists the manager’s birthday today, without a year', cel0.status === 200 && bday?.date === today && bday.years == null && cel0.json.birthdaysHidden === false,
    `${cel0.status} ${JSON.stringify(bday)}`)
  const others0 = (cel0.json?.items || []).filter((i) => i.kind !== 'BIRTHDAY').length
  const mine0 = await reader('GET', '/v1/ess/celebrations/wishes')
  check('the wishes read answers (nothing sent yet)', mine0.status === 200 && Array.isArray(mine0.json?.sent) && !mine0.json.sent.some((s) => s.toEmployeeId === MGR), `${mine0.status}`)

  // ── 1a. reader@ wishes from Home's card (1440) ──
  {
    const s = await session('reader@unifiedtree.demo', reader.claims.sub, 1440)
    await s.page.goto(base + '/me')
    await later(s.page)
    const wish = s.page.getByRole('button', { name: 'Send wishes to Dept Manager' }).first()
    const shown = await wish.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check('Home’s Celebrations card offers "Wish" under the manager’s face', shown)
    await s.page.locator('.uh-faces').first().scrollIntoViewIfNeeded().catch(() => {})
    await s.shot('home-1440')
    if (shown) {
      await wish.click()
      const dialog = s.page.getByRole('dialog', { name: 'Wish Dept a happy birthday' })
      const open = await dialog.waitFor({ timeout: 10_000 }).then(() => true, () => false)
      check('the composer opens with ready-made messages, the first picked', open
        && (await dialog.getByRole('radio').count()) === 3 && (await dialog.getByRole('radio').first().isChecked()))
      await dialog.getByText('Many happy returns, Dept! Have a great day.').click()
      await s.shot('composer-1440')
      await dialog.getByRole('button', { name: 'Send wishes' }).click()
      const toast = await s.page.getByText('Wishes sent to Dept').first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
      check('sending says so', toast)
      const wished = await s.page.getByLabel('You wished Dept').first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
      check('the card then reads "Wished ✓"', wished && (await s.page.getByText('Wished ✓').count()) > 0)
      await s.shot('home-wished-1440')
    }
    await s.page.goto(base + '/me/celebrations')
    await later(s.page)
    await s.page.getByRole('heading', { name: 'Birthdays' }).first().waitFor({ timeout: 20_000 }).catch(() => {})
    check('the Celebrations page shows "Wished ✓" on the manager’s row', await s.page.getByLabel('You wished Dept').first().waitFor({ timeout: 10_000 }).then(() => true, () => false))
    await s.shot('page-1440')
    check('no page errors or failed wishes calls (reader, 1440)', !s.errors.length && !s.failed.length, [...s.errors, ...s.failed].join(' | '))
    await s.done('reader')
  }
  const rows1 = sql(`select count(*) || '|' || coalesce(max(message), '') from hrms.celebration_wishes where tenant_id='${tenant}' and from_employee_id='${READER}' and to_employee_id='${MGR}' and occasion='BIRTHDAY' and occasion_date='${today}'`)
  check('one wish is saved, with the picked message', rows1 === '1|Many happy returns, Dept! Have a great day.', rows1)

  // ── 1b. the manager is told ──
  const n1 = await notifs(mgr)
  const fromReader = n1.find((n) => /^Reader User wished you a happy birthday$/.test(n.title))
  check('the manager gets a notification: who wished them and the message', !!fromReader && fromReader.body === 'Many happy returns, Dept! Have a great day.'
    && fromReader.group === 'People' && fromReader.data?.route === '/milestones' && fromReader.data?.type === 'CELEBRATION_WISH', JSON.stringify(n1).slice(0, 300))

  // ── 2. the rules ──
  const again = await reader('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: MGR, occasion: 'BIRTHDAY', message: 'Happy birthday again!' })
  check('sending again answers the wish already sent (200, created false)', again.status === 200 && again.json?.created === false
    && again.json?.wish?.message === 'Many happy returns, Dept! Have a great day.', `${again.status} ${JSON.stringify(again.json).slice(0, 200)}`)
  check('…and tells nobody twice', (await notifs(mgr)).length === n1.length)
  const self = await reader('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: READER, occasion: 'BIRTHDAY', message: 'Me!' })
  check('nobody can wish themself (400)', self.status === 400 && self.json?.errorCode === 'CELEBRATION_WISH_SELF', `${self.status} ${self.json?.errorCode}`)
  if (mgrJoined.slice(5) !== today.slice(5)) {
    const anniv = await reader('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: MGR, occasion: 'ANNIVERSARY', message: 'Congrats!' })
    check('no anniversary wishes on another day (422)', anniv.status === 422 && anniv.json?.errorCode === 'CELEBRATION_WISH_NOT_THE_DAY', `${anniv.status} ${anniv.json?.errorCode}`)
  }
  const long = await reader('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: MGR, occasion: 'BIRTHDAY', message: 'x'.repeat(281) })
  check('a message over 280 characters is refused (400)', long.status === 400 && long.json?.errorCode === 'CELEBRATION_WISH_TOO_LONG', `${long.status} ${long.json?.errorCode}`)
  const nobody = await reader('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: '99999999-9999-9999-9999-999999999999', occasion: 'BIRTHDAY', message: 'Hi' })
  check('someone outside your company can’t be wished (422)', nobody.status === 422 && nobody.json?.errorCode === 'CELEBRATION_WISH_PERSON_INVALID', `${nobody.status} ${nobody.json?.errorCode}`)
  const tidy = await hrm('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: MGR, occasion: 'birthday', message: '  Have a   great\none!  ' })
  check('a message is trimmed and kept on one line', tidy.status === 200 && tidy.json?.created === true && tidy.json?.wish?.message === 'Have a great one!', `${tidy.status} ${JSON.stringify(tidy.json).slice(0, 200)}`)

  // ── 1c. fin@ writes their own words on the Celebrations page (390) ──
  {
    const s = await session('fin@unifiedtree.demo', fin.claims.sub, 390)
    await s.page.goto(base + '/me/celebrations')
    await later(s.page)
    const wish = s.page.getByRole('button', { name: 'Send wishes to Dept Manager' }).first()
    const shown = await wish.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check('the Celebrations page offers "Send wishes" on the manager’s row (390)', shown)
    await s.shot('page-390')
    if (shown) {
      await wish.click()
      const dialog = s.page.getByRole('dialog', { name: 'Wish Dept a happy birthday' })
      await dialog.waitFor({ timeout: 10_000 }).catch(() => {})
      await dialog.getByLabel(/Or write your own/).fill('Have a fantastic birthday, Dept! 🎉')
      check('the composer counts the characters and says the own words go instead',
        (await dialog.getByText('Your own words are sent instead of the message above.').count()) === 1 && (await dialog.getByText(/\/280$/).count()) === 1)
      await s.shot('composer-390')
      await dialog.getByRole('button', { name: 'Send wishes' }).click()
      check('…and sends them', await s.page.getByLabel('You wished Dept').first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
      const noHScroll = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1)
      check('no sideways scrolling at 390', noHScroll)
      await s.shot('page-wished-390')
    }
    check('no page errors or failed wishes calls (fin, 390)', !s.errors.length && !s.failed.length, [...s.errors, ...s.failed].join(' | '))
    await s.done('fin')
  }
  const n2 = await notifs(mgr)
  check('the manager has three wishes in their notifications, each once', n2.length === 3 && n2.some((n) => n.body === 'Have a fantastic birthday, Dept! 🎉'), `${n2.length}`)
  const mgrMine = await mgr('GET', '/v1/ess/celebrations/wishes')
  check('the manager’s wishes read: 3 received from 3 people', mgrMine.status === 200 && mgrMine.json?.receivedPeople === 3 && mgrMine.json?.received?.length === 3,
    `${mgrMine.status} ${mgrMine.json?.receivedPeople}`)

  // ── 1d. the manager sees who wished them (390 and 1440) ──
  {
    const s = await session('mgr@unifiedtree.demo', mgr.claims.sub, 390)
    await s.page.goto(base + '/me')
    await later(s.page)
    const line = s.page.getByRole('button', { name: /3 people wished you/ }).first()
    check('Home says "3 people wished you"', await line.waitFor({ timeout: 30_000 }).then(() => true, () => false))
    await line.scrollIntoViewIfNeeded().catch(() => {})
    await s.shot('home-wishedme-390')
    await line.click().catch(() => {})
    await s.page.waitForURL((u) => u.pathname === '/me/celebrations', { timeout: 15_000 }).catch(() => {})
    const yours = s.page.getByRole('heading', { name: 'Your wishes' }).first()
    check('…which opens Celebrations, with "Your wishes" and their words', await yours.waitFor({ timeout: 20_000 }).then(() => true, () => false)
      && (await s.page.getByText('Many happy returns, Dept! Have a great day.').count()) > 0 && (await s.page.getByText('Reader User').count()) > 0)
    await yours.scrollIntoViewIfNeeded().catch(() => {})
    await s.shot('page-wishes-390')
    check('the manager can’t wish themself: no button on their own row', (await s.page.getByRole('button', { name: 'Send wishes to Dept Manager' }).count()) === 0)
    check('no page errors or failed wishes calls (manager, 390)', !s.errors.length && !s.failed.length, [...s.errors, ...s.failed].join(' | '))
    await s.done('mgr')
  }
  {
    const s = await session('mgr@unifiedtree.demo', mgr.claims.sub, 1440)
    await s.page.goto(base + '/me/celebrations')
    await later(s.page)
    await s.page.getByRole('heading', { name: 'Your wishes' }).first().waitFor({ timeout: 20_000 }).catch(() => {})
    await s.shot('page-wishes-1440')
    await s.done('mgr 1440')
  }

  // ── 3. the setting ──
  const set0 = await owner('GET', `/v1/settings/celebrations?companyId=${company}`)
  check('the setting reads on by default', set0.status === 200 && set0.json?.showBirthdays === true, `${set0.status} ${JSON.stringify(set0.json)}`)
  const denied = await reader('PUT', `/v1/settings/celebrations?companyId=${company}`, { showBirthdays: false })
  check('an employee can’t change it (403)', denied.status === 403, `${denied.status}`)
  {
    const s = await session('owner@unifiedtree.demo', owner.claims.sub, 1440)
    await s.page.goto(base + '/hrms/settings')
    const sec = s.page.locator('#st-celebrations')
    const there = await sec.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check('HR configuration has a Celebrations section with the switch', there && (await sec.getByRole('switch', { name: 'Show birthdays to colleagues' }).count()) === 1)
    await sec.scrollIntoViewIfNeeded().catch(() => {})
    await s.shot('hrconfig-1440')
    if (there) {
      await sec.getByRole('switch', { name: 'Show birthdays to colleagues' }).click()
      await s.page.getByRole('button', { name: 'Save settings' }).first().click()
      check('the owner turns it off and saves', await s.page.getByText('HR settings saved').first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
      await sec.scrollIntoViewIfNeeded().catch(() => {})
      await s.shot('hrconfig-off-1440')
    }
    check('no page errors or failed settings calls (owner)', !s.errors.length && !s.failed.length, [...s.errors, ...s.failed].join(' | '))
    await s.done('owner')
  }
  const set1 = await owner('GET', `/v1/settings/celebrations?companyId=${company}`)
  check('the setting is saved off, with who changed it', set1.json?.showBirthdays === false && !!set1.json?.updatedAt, JSON.stringify(set1.json))
  const cel1 = await reader('GET', '/v1/ess/celebrations?days=30')
  check('Celebrations has no birthdays and says they are hidden', cel1.status === 200 && cel1.json?.birthdaysHidden === true
    && !(cel1.json?.items || []).some((i) => i.kind === 'BIRTHDAY') && !(cel1.json?.included || []).includes('BIRTHDAY'), JSON.stringify(cel1.json).slice(0, 300))
  check('…while work anniversaries and new joiners still show', (cel1.json?.items || []).length === others0, `${(cel1.json?.items || []).length} vs ${others0}`)
  const around = await reader('GET', '/v1/ess/around-me?days=30')
  check('Home’s Upcoming events have no birthdays either', around.status === 200 && !(around.json?.items || []).some((i) => i.kind === 'BIRTHDAY'))
  const off = await owner('POST', '/v1/ess/celebrations/wishes', { toEmployeeId: MGR, occasion: 'BIRTHDAY', message: 'Happy birthday!' })
  check('birthday wishes are refused (422)', off.status === 422 && off.json?.errorCode === 'CELEBRATION_BIRTHDAYS_HIDDEN', `${off.status} ${off.json?.errorCode}`)
  {
    const s = await session('reader@unifiedtree.demo', reader.claims.sub, 390)
    await s.page.goto(base + '/me/celebrations')
    await later(s.page)
    await s.page.getByRole('heading', { name: 'Work anniversaries' }).first().waitFor({ timeout: 20_000 }).catch(() => {})
    check('the page has no Birthdays section', (await s.page.getByRole('heading', { name: 'Birthdays' }).count()) === 0
      && (await s.page.getByText('Work anniversaries and new joiners in your company').count()) === 1)
    await s.shot('page-hidden-390')
    check('no page errors or failed calls (reader, birthdays hidden)', !s.errors.length && !s.failed.length, [...s.errors, ...s.failed].join(' | '))
    await s.done('reader 390')
  }
  {
    const s = await session('owner@unifiedtree.demo', owner.claims.sub, 390)
    await s.page.goto(base + '/hrms/settings')
    const sec = s.page.locator('#st-celebrations')
    await sec.waitFor({ timeout: 30_000 }).catch(() => {})
    await sec.scrollIntoViewIfNeeded().catch(() => {})
    await s.shot('hrconfig-390')
    await s.done('owner 390')
  }
  const back = await owner('PUT', `/v1/settings/celebrations?companyId=${company}`, { showBirthdays: true })
  const cel2 = await reader('GET', '/v1/ess/celebrations?days=30')
  check('turned back on, birthdays return', back.status === 200 && cel2.json?.birthdaysHidden === false
    && (cel2.json?.items || []).some((i) => i.kind === 'BIRTHDAY' && i.employeeId === MGR))
} catch (e) {
  check('the run finished', false, String(e?.stack || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close().catch(() => {})
  cleanup()
  const left = sql(`select (select count(*) from hrms.celebration_wishes where tenant_id='${tenant}' and created_at >= '${start}') + (select count(*) from notif.notifications where tenant_id='${tenant}' and type='CELEBRATION_WISH' and created_at >= '${start}')`)
  check('everything this run made is removed, and the manager’s date of birth is back',
    left === '0' && sql(`select coalesce(date_of_birth::text, '') from hrms.employees where id='${MGR}'`) === mgrDob, `left ${left}`)
}

const failedChecks = results.filter((r) => !r.ok)
console.log(`\n${results.length - failedChecks.length}/${results.length} passed`)
process.exit(failedChecks.length ? 1 : 0)
