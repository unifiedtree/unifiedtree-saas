// Live check: one email per employee in a workspace (owner, 2026-10-05: "unique mails should be
// there for each company — same mail is being registered twice with a different name").
//
//   API  - "READER@unifiedtree.demo " (another case, a trailing space) is refused on Add employee
//          (409 EMAIL_ALREADY_USED naming Reader User (EMP002)), on the older /v1/employees create
//          and on Edit; the check endpoint answers the same; a manager without the directory gets
//          no name; an employee can't ask at all; an import with the same email twice in the file
//          and one already taken is flagged per row before anything is saved; a phone number
//          someone already has is a warning only.
//   Web  - Add employee: the Work email field says whose the email is as you type; the Mobile
//          field says who else has the number; Add employee then stays open and saves nothing.
//          Import: the rows are flagged on the page. Screenshots at 1440 and 390.
//
// Everything it tries is refused or only validated, so it creates nothing; the one edit it makes
// (Reader's email re-saved in another case) leaves the address as it was.
//
//   node e2e/recovery/live-unique-email.mjs
/* global process, console, URL, URLSearchParams, Buffer, fetch, FormData, Blob, localStorage, sessionStorage */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const ui = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const SHOTS = process.env.SHOTS_DIR || 'C:/REACT/ut-wt/_results/shots'
try { mkdirSync(SHOTS, { recursive: true }) } catch { /* screenshots are optional */ }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function login(email) {
  const r = await fetch(api + '/v1/canonical-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant },
    body: JSON.stringify({ tenantId: tenant, email, password }),
  })
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`)
  const token = (await r.json()).accessToken
  const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
  return { token, sub }
}
async function call(who, path, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${who.token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(api + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { status: r.status, json }
}
const q = (o) => new URLSearchParams(o).toString()

const owner = await login('owner@unifiedtree.demo')
const mgr = await login('mgr@unifiedtree.demo')
const reader = await login('reader@unifiedtree.demo')

// Reader User's record (EMP002) and a number someone in the demo data already has.
const readerRow = (await call(owner, '/v1/hrms/employees?' + q({ companyId: company, search: 'reader@unifiedtree.demo', pageSize: '5' }))).json?.content?.find((e) => e.email === 'reader@unifiedtree.demo')
check('setup: Reader User (EMP002) is in the directory', readerRow && readerRow.employeeCode === 'EMP002', readerRow?.employeeCode)
const sharedPhone = (await call(owner, '/v1/hrms/employees?' + q({ companyId: company, pageSize: '200' }))).json?.content?.map((e) => e.phone).find((p) => p && p.replace(/\D/g, '').length >= 10) || '9000000000'
const NAME = 'Reader User (EMP002)'

// ── API: the check endpoint ──
{
  const r = await call(owner, '/v1/employees/email-check?' + q({ email: 'READER@unifiedtree.demo ' }))
  check('email-check: a taken email in another case with a space is not available', r.status === 200 && r.json.available === false, JSON.stringify(r.json))
  check('email-check: names the person for HR', r.json?.ownerName === 'Reader User' && r.json?.ownerCode === 'EMP002' && r.json?.message === `This email already belongs to ${NAME}.`, r.json?.message)
  const self = await call(owner, '/v1/employees/email-check?' + q({ email: 'reader@unifiedtree.demo', excludeEmployeeId: readerRow?.id }))
  check('email-check: the person being edited keeps their own email', self.json?.available === true, JSON.stringify(self.json))
  const free = await call(owner, '/v1/employees/email-check?' + q({ email: `nobody-${Date.now()}@example.invalid` }))
  check('email-check: a free email is available', free.json?.available === true)
  const m = await call(mgr, '/v1/employees/email-check?' + q({ email: 'reader@unifiedtree.demo' }))
  check('email-check: a manager without the directory is told without a name', m.status === 403 || (m.json?.available === false && !m.json?.ownerName && !String(m.json?.message).includes('Reader')), `${m.status} ${JSON.stringify(m.json)}`)
  const e = await call(reader, '/v1/employees/email-check?' + q({ email: 'mgr@unifiedtree.demo' }))
  check('email-check: an employee can\'t ask', e.status === 403, String(e.status))
  const p = await call(owner, '/v1/employees/phone-check?' + q({ phone: sharedPhone }))
  check('phone-check: a number someone has is reported, with who', p.status === 200 && p.json?.inUse === true && /^Also used by /.test(p.json?.message || ''), `${sharedPhone}: ${p.json?.message}`)
}

// ── API: every create / edit path refuses it ──
const created = []
{
  const r = await call(owner, '/v1/hrms/employees', { method: 'POST', body: { companyId: company, firstName: 'Dup', lastName: 'Reader', email: 'READER@unifiedtree.demo ', employmentType: 'FULL_TIME', dateOfJoining: today } })
  if (r.status === 201) created.push(r.json.id)
  check('Add employee: the same email in another case is refused with 409', r.status === 409 && r.json?.errorCode === 'EMAIL_ALREADY_USED', `${r.status} ${r.json?.errorCode}`)
  check('Add employee: the refusal names the existing person', r.json?.message === `This email already belongs to ${NAME}.`, r.json?.message)
  const legacy = await call(owner, '/v1/employees', { method: 'POST', body: { firstName: 'Dup', lastName: 'Legacy', email: 'Reader@UnifiedTree.demo', companyId: company } })
  if (legacy.status === 201) created.push(legacy.json.id)
  check('older create (/v1/employees): refused too', legacy.status === 409 && legacy.json?.errorCode === 'EMAIL_ALREADY_USED', `${legacy.status} ${legacy.json?.message}`)
  const mine = (await call(owner, '/v1/hrms/employees?' + q({ companyId: company, search: 'mgr@unifiedtree.demo', pageSize: '5' }))).json?.content?.find((x) => x.email === 'mgr@unifiedtree.demo')
  const edit = await call(owner, `/v1/hrms/employees/${readerRow?.id}`, { method: 'PUT', body: { email: ' MGR@unifiedtree.demo' } })
  check('Edit: moving to someone else\'s email is refused, naming them', edit.status === 409 && edit.json?.message === `This email already belongs to Dept Manager (${mine?.employeeCode || 'EMP004'}).`, `${edit.status} ${edit.json?.message}`)
  const same = await call(owner, `/v1/hrms/employees/${readerRow?.id}`, { method: 'PUT', body: { email: 'Reader@UnifiedTree.demo ' } })
  check('Edit: the person\'s own email in another case is fine and is saved lower-cased', same.status === 200 && same.json?.email === 'reader@unifiedtree.demo', `${same.status} ${same.json?.email}`)
}

// ── API: import, before anything is saved ──
const fresh = `unique-${Date.now()}@example.invalid`
const csv = 'first_name,last_name,email,employment_type,date_of_joining,phone\n'
  + `Ana,One,${fresh},FULL_TIME,${today},\n`
  + `Ana,Two, ${fresh.toUpperCase()} ,FULL_TIME,${today},\n`
  + `Dup,Reader,READER@unifiedtree.demo,FULL_TIME,${today},${sharedPhone}\n`
async function upload(action) {
  const fd = new FormData()
  fd.set('file', new Blob([csv], { type: 'text/csv' }), 'unique-email.csv')
  return call(owner, `/v1/bulk-import/employees/${action}?companyId=${company}`, { method: 'POST', form: fd })
}
{
  const v = await upload('validate')
  const errs = v.json?.errors || []
  check('import: the same email twice in the file is flagged on its row', errs.some((e) => e.startsWith('Row 3: email appears more than once in this file (also row 2)')), errs.join(' | '))
  check('import: an email someone already has names them on its row', errs.some((e) => e === `Row 4: email already belongs to ${NAME}: reader@unifiedtree.demo`), errs.join(' | '))
  check('import: a phone someone already has is a warning, not a problem', (v.json?.warnings || []).some((w) => w.row === 4 && w.column === 'phone' && /^Also used by /.test(w.message)) && !errs.some((e) => e.includes('phone')), JSON.stringify(v.json?.warnings))
  const c = await upload('commit')
  check('import: commit with those rows saves nobody', c.json?.committed === false && (c.json?.created || []).length === 0, `committed=${c.json?.committed}`)
  const after = await call(owner, '/v1/employees/email-check?' + q({ email: fresh }))
  check('import: the first row\'s email is still free afterwards', after.json?.available === true)
}

// ── Web ──
const browser = await chromium.launch()
async function session(width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } })
  await ctx.addInitScript(([id, day]) => {
    try { localStorage.setItem('ut.theme', 'light'); sessionStorage.setItem(`ut.punch-prompt.opened:${id}`, day) } catch { /* private mode */ }
  }, [owner.sub, today])
  const page = await ctx.newPage()
  const errors = [], failed = [], posts = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/v1/hrms/employees')) posts.push(r.url()) })
  await page.goto(ui + '/login', { timeout: 120_000 })
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { ctx, page, errors, failed, posts }
}

for (const width of [1440, 390]) {
  const s = await session(width)
  const { page } = s
  try {
    await page.goto(ui + '/hrms/employees?add=1')
    // By placeholder: the labels carry the required mark ("Work email *").
    const email = page.getByPlaceholder('name@company.com', { exact: true })
    await email.waitFor({ timeout: 30_000 })
    await page.getByPlaceholder('e.g. Ananya', { exact: true }).fill('Dup')
    await page.getByPlaceholder('e.g. Sharma', { exact: true }).fill('Reader')
    await email.fill('READER@unifiedtree.demo ')
    const taken = page.getByText(`This email already belongs to ${NAME}.`, { exact: true })
    const shown = await taken.waitFor({ timeout: 10_000 }).then(() => true, () => false)
    check(`web ${width}: Add employee says whose the email is as you type`, shown)
    await page.getByPlaceholder('+91 98xxx xxxxx', { exact: true }).fill(sharedPhone)
    const phone = page.getByText(/^Also used by /).first()
    const phoneShown = await phone.waitFor({ timeout: 10_000 }).then(() => true, () => false)
    check(`web ${width}: Mobile says who else has the number`, phoneShown)
    await page.screenshot({ path: `${SHOTS}/w23-unique-add-${width}.png` })
    await page.getByRole('button', { name: 'Add employee', exact: true }).last().click()
    await page.waitForTimeout(1500)
    check(`web ${width}: Add employee stays open and saves nothing`, await email.isVisible() && s.posts.length === 0, `posts=${s.posts.length}`)
    // A free email clears the message.
    await email.fill(`free-${Date.now()}@example.invalid`)
    const cleared = await taken.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false)
    check(`web ${width}: a free email clears it`, cleared)
    await page.keyboard.press('Escape').catch(() => {})

    {
      // Import: the rows are flagged on the page.
      await page.goto(ui + '/hrms/employees/import')
      await page.getByRole('button', { name: /Download template/ }).first().waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: 'I have a file ready', exact: true }).click()
      await page.locator('input[type=file]').first().setInputFiles({ name: 'unique-email.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await page.getByRole('button', { name: 'Validate file', exact: true }).click()
      const row3 = page.getByText(/email appears more than once in this file \(also row 2\)/).first()
      const row4 = page.getByText(`email already belongs to ${NAME}: reader@unifiedtree.demo`, { exact: true })
      const flagged = await row3.waitFor({ timeout: 20_000 }).then(() => true, () => false) && await row4.isVisible().catch(() => false)
      check(`web ${width} import: both rows are flagged before anything is saved`, flagged)
      const note = await page.getByText(/^phone: Also used by /).first().isVisible().catch(() => false)
      check(`web ${width} import: the shared phone shows as a note`, note)
      await page.waitForTimeout(2500) // the result cards count up and fade in
      await row3.scrollIntoViewIfNeeded().catch(() => {})
      await page.screenshot({ path: `${SHOTS}/w23-unique-import-${width}.png` })
    }
  } catch (e) {
    check(`web ${width}: completed`, false, String(e.message || e).split('\n')[0].slice(0, 200))
    await page.screenshot({ path: `${SHOTS}/w23-unique-fail-${width}.png` }).catch(() => {})
  }
  check(`web ${width}: no page errors`, s.errors.length === 0, s.errors.join(' | ').slice(0, 300))
  const unexpected = s.failed.filter((f) => !/^409 /.test(f))
  check(`web ${width}: no unexpected API errors`, unexpected.length === 0, unexpected.join(' | ').slice(0, 300))
  await s.ctx.close()
}
await browser.close()

// ── Clean up: nothing should have been created; remove anything that was ──
for (const id of created) console.log(`NOTE  created ${id} by mistake — remove it`)
check('nothing was created', created.length === 0, created.join(', '))

const failedChecks = results.filter((r) => !r.ok)
console.log(`\n${results.length - failedChecks.length}/${results.length} passed`)
process.exit(failedChecks.length ? 1 : 0)
