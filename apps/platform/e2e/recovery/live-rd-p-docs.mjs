// Live check of the redesigned letters and documents pages (P-DOCS) through the UI:
//  - Template preview BEFORE saving: a new template's body renders on its A4 page with the
//    letterhead and the fields filled for the viewer, and nothing is saved.
//  - Generate a letter with a signature asked (and its live preview); send it; the reader
//    sees it in My letters, reads it and signs it (typed name); HR sees "Signed"; HR voids
//    it with a reason and the reader sees "Withdrawn". An unsent draft never reaches the reader.
//  - A distribution scheduled for a later date ("Send on") is listed, then cancelled.
//  - FEATURE_NOT_READY: with letters.distribution_schedules renamed, the scheduled list
//    answers 503 and the page hides it (then the table is renamed back).
//  - Employee vault counts and a person's file; Docs to review counts and Reject with a reason.
//  - My documents: the rejected document asks for a new copy; the upload reaches the server.
//  - My assets: "Yes, I have it" confirms a new hand-over; Report a problem.
//  - Roles: owner, hrm, fin, mgr, reader each see only their views; light and dark; 390 px.
// No unexpected 4xx/5xx or page errors. Everything it creates is removed.
//
//   RECOVERY_DB=ut_w3_dev node e2e/recovery/live-rd-p-docs.mjs     (through live-slot.sh)
/* global process, console, document, window, localStorage */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3134'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.P_DOCS_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const readerId = '22222222-2222-2222-2222-222222222222'
mkdirSync(shots, { recursive: true })
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`) }
const stamp = Date.now()
const tplName = `QA letter ${stamp}`
const sendTitle = `QA send ${stamp}`
const docTitle = `QA reject ${stamp}`
const assetTag = `QA-${String(stamp).slice(-6)}`
// Calls that are expected to fail: the deliberate rename step, and self-upload where local storage isn't set up.
const expected = []
const isExpected = (entry) => expected.some((re) => re.test(entry))

const browser = await chromium.launch()
async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const token = (await r.json()).accessToken
  return async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, json }
  }
}
async function session(email, { width = 1440, height = 900, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400 || r.url().includes('/canonical-auth/refresh')) return
    const entry = `${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`
    if (!isExpected(entry)) failed.push(entry)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  return { ctx, page, errors, failed }
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600) }
const shot = (page, name) => page.screenshot({ path: `${shots}/p-docs-${name}.png`, fullPage: true }).catch(() => {})
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const viewNames = async (page, label) => page.locator(`[aria-label="${label}"] button`).allInnerTexts().then((a) => a.map((s) => s.trim())).catch(() => [])
const clean = (c) => !c.failed.length && !c.errors.length

let templateId = null, letterId = null, docId = null, assetId = null
const owner = await apiLogin('owner@unifiedtree.demo')
try {
  // ── setup ───────────────────────────────────────────────────────────────
  const t = await owner('POST', '/v1/letters/templates', { companyId: company, name: tplName, type: 'CUSTOM', subject: `QA subject for {{employee.fullName}} ${stamp}`,
    bodyHtml: '<p>Dear {{employee.fullName}},</p><p>This letter is dated {{today:long}} for {{employee.code}}.</p>' })
  templateId = t.json?.id
  check('setup: a QA template', t.status === 201 && !!templateId, t.status)

  const o = await session('owner@unifiedtree.demo')
  const p = o.page

  // ── 1. template preview before saving ───────────────────────────────────
  let posted = 0
  p.on('request', (r) => { if (r.method() !== 'GET' && /\/v1\/letters\/templates(\/[0-9a-f-]+)?$/.test(r.url())) posted++ })
  await p.goto(base + '/hrms/letters/templates/new'); await settle(p)
  await p.getByLabel('Template name').fill(`QA preview ${stamp}`)
  await p.getByLabel('Subject').fill('Offer for {{employee.fullName}}')
  await p.locator('.lt-editor__body').click()
  await p.keyboard.type('Dear {{employee.fullName}}, welcome on {{today:long}}. {{nope.field}}')
  const paper = p.frameLocator('iframe[title="Letter preview"]')
  await paper.locator('body').filter({ hasText: 'Dear ' }).waitFor({ timeout: 20000 }).catch(() => {})
  const paperText = await paper.locator('body').innerText().catch(() => '')
  check('preview: the draft renders before saving, with the fields filled', /Dear (?!\{\{)\S+/.test(paperText) && !paperText.includes('{{employee.fullName}}'), paperText.slice(0, 120))
  check('preview: the page size is shown (A4)', (await p.getByText(/A4 · 210 × 297 mm/).count()) >= 1)
  check('preview: a field with no value is named', (await p.getByText(/\{\{nope\.field\}\}/).count()) >= 1)
  check('preview: nothing was saved', posted === 0, `${posted} saves`)
  await shot(p, 'template-preview-light-1440')
  await p.goto(base + '/hrms/letters/templates'); await settle(p)
  check('letters: one page header and Templates pressed', (await p.getByRole('heading', { name: 'Letters', level: 1 }).count()) === 1 && (await p.getByRole('button', { name: /^Templates/, pressed: true }).count()) === 1)
  check('letters: the QA template is listed', (await p.getByRole('row').filter({ hasText: tplName }).count()) === 1)
  await shot(p, 'letters-templates-light-1440')

  // ── 2. generate with a signature asked ──────────────────────────────────
  await p.goto(base + '/hrms/letters/generated'); await settle(p)
  await p.getByRole('button', { name: 'Generate letter', exact: true }).click()
  const gen = p.getByRole('dialog', { name: 'Generate letter' })
  await gen.waitFor({ timeout: 10000 })
  await gen.getByLabel('Template').selectOption(templateId)
  await gen.getByLabel('Find employee').fill('Reader')
  await gen.getByRole('button', { name: /Reader User/ }).click()
  await gen.getByRole('switch', { name: /Ask for a signature/ }).click()
  await gen.frameLocator('iframe[title="Letter preview"]').locator('body').filter({ hasText: 'Reader' }).waitFor({ timeout: 20000 }).catch(() => {})
  check('generate: the preview shows the letter for that person', /Reader/.test(await gen.frameLocator('iframe[title="Letter preview"]').locator('body').innerText().catch(() => '')))
  await shot(p, 'generate-panel-light-1440')
  await gen.getByRole('button', { name: 'Generate letter', exact: true }).click()
  await p.waitForURL(/\/letters\/generated\/[0-9a-f-]+$/, { timeout: 20000 })
  letterId = new URL(p.url()).pathname.split('/').at(-1)
  const g1 = (await owner('GET', `/v1/letters/generated/${letterId}`)).json
  check('generate: a draft asking for a signature, dated today, with its template name', g1?.status === 'GENERATED' && g1?.signatureRequested === true && !!g1?.issueDate && g1?.templateName === tplName, JSON.stringify(g1 || {}).slice(0, 200))
  // An unsent draft never reaches the reader.
  const reader = await apiLogin('reader@unifiedtree.demo')
  check('my letters: an unsent draft is hidden', !((await reader('GET', '/v1/letters/my?size=100')).json?.content || []).some((l) => l.id === letterId))
  check('my letters: the reader can’t open the draft', (await reader('GET', `/v1/letters/generated/${letterId}`)).status === 404)
  await shot(p, 'letter-detail-light-1440')
  await p.getByRole('button', { name: 'Send letter', exact: true }).click()
  const sd = p.getByRole('dialog', { name: 'Send letter' })
  // Letters are emailed through the mail provider (Brevo). A local server has none, so the send
  // answers 500 with that reason; the dialog shows it, and the send is then recorded in the DB.
  expected.push(/^5\d\d POST \/v1\/letters\/generated\/[0-9a-f-]+\/send/)
  const sendRes = p.waitForResponse((res) => /\/v1\/letters\/generated\/[0-9a-f-]+\/send/.test(res.url()), { timeout: 20000 }).catch(() => null)
  await sd.getByRole('button', { name: 'Send letter', exact: true }).click()
  const sr = await sendRes
  const emailed = sr?.status() === 200
  if (emailed) {
    await sd.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    check('send: the letter is sent', (await owner('GET', `/v1/letters/generated/${letterId}`)).json?.status === 'SENT')
  } else {
    const why = sr ? await sr.json().catch(() => ({})) : {}
    check('send: without a mail provider the send is refused and nothing changes', (sr?.status() ?? 0) >= 500 && (await owner('GET', `/v1/letters/generated/${letterId}`)).json?.status === 'GENERATED', `${sr?.status()} ${why?.message}`)
    check('send: the dialog says why', (await p.getByText(/Failed to send letter/).count()) >= 1)
    await sd.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
    sql(`update letters.generated set status='SENT', sent_at=now(), sent_to_email='reader@unifiedtree.demo' where id='${letterId}'`)
  }

  // ── 3. the reader signs ─────────────────────────────────────────────────
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/letters/my'); await settle(r.page)
  const card = r.page.locator('article').filter({ hasText: tplName })
  check('my letters: the letter is a card that needs a signature', (await card.count()) === 1 && /Needs your signature/.test(await card.innerText()))
  check('my letters: the gold line asks for the e-signature', (await r.page.getByText(/needs your e-signature/).count()) === 1)
  await shot(r.page, 'my-letters-light-1440')
  await card.getByRole('button', { name: /Review and sign/ }).click()
  const sp = r.page.getByRole('dialog', { name: 'Review and sign' })
  await sp.frameLocator('iframe').locator('body').filter({ hasText: 'Dear' }).waitFor({ timeout: 15000 }).catch(() => {})
  check('sign: the letter shows on its page before signing', /Dear/.test(await sp.frameLocator('iframe').locator('body').innerText().catch(() => '')))
  await sp.getByText('I have read this letter and I accept it').click()
  await sp.getByLabel('Type your full name').fill('Reader User')
  await shot(r.page, 'sign-panel-light-1440')
  await sp.getByRole('button', { name: 'Sign letter' }).click()
  await sp.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const g2 = (await owner('GET', `/v1/letters/generated/${letterId}`)).json
  check('sign: the letter is SIGNED with the typed name and time', g2?.status === 'SIGNED' && g2?.signedName === 'Reader User' && !!g2?.signedAt, JSON.stringify({ s: g2?.status, n: g2?.signedName }))
  check('sign: the IP and browser are kept', sql(`select (signed_ip is not null and signed_user_agent is not null)::text from letters.letter_signatures where letter_id='${letterId}'`) === 'true')
  if (emailed) check('sign: the reader was told when it was sent', Number(sql(`select count(*) from notif.notifications where data->>'letterId'='${letterId}'`)) >= 1)
  else console.log('(the "you have a letter to sign" notice goes out with a real send: covered by LetterSigningServiceTest)')
  await settle(r.page)
  check('my letters: the card now says Signed', /Signed/.test(await card.innerText()))

  // ── 4. HR sees Signed, then voids it with a reason ──────────────────────
  await p.goto(base + '/hrms/letters/generated'); await settle(p)
  const row = p.getByRole('row').filter({ has: p.locator(`[title="QA subject for Reader User ${stamp}"]`) })
  check('generated: the row shows the department and Signed', (await row.count()) === 1 && /Signed/.test(await row.innerText()), (await row.innerText().catch(() => '')).replace(/\s+/g, ' '))
  await shot(p, 'letters-generated-light-1440')
  await row.getByRole('button', { name: /^Void / }).click()
  const vd = p.getByRole('dialog', { name: 'Void letter' })
  check('void: a reason is required', (await vd.getByRole('button', { name: 'Void letter' }).getAttribute('aria-disabled')) === 'true')
  await vd.getByLabel('Reason').fill('QA: issued by mistake')
  await vd.getByRole('button', { name: 'Void letter' }).click()
  await vd.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const g3 = (await owner('GET', `/v1/letters/generated/${letterId}`)).json
  check('void: VOID with the reason', g3?.status === 'VOID' && g3?.voidedReason === 'QA: issued by mistake')
  await r.page.reload(); await settle(r.page)
  check('my letters: a voided letter shows as Withdrawn', /Withdrawn/.test(await r.page.locator('article').filter({ hasText: tplName }).innerText().catch(() => '')))
  check('reader: no unexpected API failures or page errors', clean(r), r.failed[0] || r.errors[0] || '')

  // ── 5. schedule a send, then cancel it ──────────────────────────────────
  await p.goto(base + '/hrms/letters/distributions'); await settle(p)
  await p.getByRole('button', { name: 'New distribution' }).click()
  const wz = p.getByRole('dialog', { name: 'New distribution' })
  await wz.getByLabel('Letter template').selectOption(templateId)
  await wz.frameLocator('iframe[title="Letter preview"]').locator('body').filter({ hasText: 'Dear' }).waitFor({ timeout: 15000 }).catch(() => {})
  check('distribution: the letter is previewed before sending', /Dear/.test(await wz.frameLocator('iframe[title="Letter preview"]').locator('body').innerText().catch(() => '')))
  await wz.getByRole('button', { name: 'Next' }).click()
  await wz.getByRole('button', { name: 'Pick people' }).click()
  await wz.getByLabel('Search employees').fill('Reader')
  await wz.locator('.lt-picker__row').filter({ hasText: 'Reader User' }).locator('.uko-check-title').click()
  await wz.getByRole('button', { name: 'Next' }).click()
  await wz.getByLabel('Name').fill(sendTitle)
  await wz.getByRole('button', { name: 'Next' }).click()
  await wz.getByRole('radio', { name: 'Send on a date' }).click()
  await shot(p, 'distribution-send-on-light-1440')
  await wz.getByRole('button', { name: /^Schedule for / }).click()
  await wz.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await settle(p)
  const sched = (await owner('GET', '/v1/letters/distributions/scheduled')).json || []
  const mine = sched.find((s) => s.title === sendTitle)
  check('send on: scheduled for a later date, for one person', mine?.status === 'SCHEDULED' && mine?.recipientsAtSchedule === 1, JSON.stringify(mine || {}).slice(0, 200))
  const srow = p.getByRole('row').filter({ hasText: sendTitle })
  check('send on: listed as Scheduled with its day', (await srow.count()) === 1 && /Sends .*9:00/.test(await srow.innerText()))
  await shot(p, 'letters-distributions-light-1440')
  await srow.getByRole('button', { name: `Cancel ${sendTitle}` }).click()
  await p.getByRole('button', { name: 'Cancel the send' }).click()
  await srow.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  check('send on: cancelled and gone', !((await owner('GET', '/v1/letters/distributions/scheduled')).json || []).some((s) => s.title === sendTitle) && (await srow.count()) === 0)

  // ── 6. FEATURE_NOT_READY: the scheduled list without its table ──────────
  expected.push(/^503 GET \/v1\/letters\/distributions\/scheduled/)
  sql('ALTER TABLE letters.distribution_schedules RENAME TO distribution_schedules_qa_off')
  try {
    const off = await owner('GET', '/v1/letters/distributions/scheduled')
    check('not ready: the scheduled list answers FEATURE_NOT_READY', off.status === 503 && off.json?.errorCode === 'FEATURE_NOT_READY', `${off.status} ${off.json?.errorCode}`)
    await p.goto(base + '/hrms/letters/distributions'); await settle(p)
    check('not ready: the page hides Scheduled and still lists distributions', (await p.getByRole('heading', { name: 'Scheduled' }).count()) === 0 && (await p.getByRole('heading', { name: 'Distributions' }).count()) >= 1)
  } finally {
    sql('ALTER TABLE letters.distribution_schedules_qa_off RENAME TO distribution_schedules')
    expected.pop()
  }

  // ── 7. vault and the review queue ───────────────────────────────────────
  const typeId = sql(`select id from document_mgmt.document_types where tenant_id='${tenant}' and code='PAN' limit 1`)
  docId = sql(`insert into document_mgmt.employee_documents (tenant_id, employee_id, company_id, title, category, file_url, verification_status, original_filename, file_size_bytes, document_type_id, expiry_date)
    values ('${tenant}','${readerId}','${company}','${docTitle}','TAX','r2://employee-documents/${tenant}/qa-${stamp}.pdf','PENDING','qa.pdf',20480,${typeId ? `'${typeId}'` : 'null'}, current_date + 400) returning id`).split('\n')[0]
  await p.goto(base + '/hrms/documents?view=all'); await settle(p)
  check('vault: counts across everyone', (await p.getByRole('heading', { name: /^Across \d+ (people|person)$/ }).count()) === 1 && (await p.getByText('Expiring soon', { exact: true }).count()) >= 1)
  await p.getByLabel('Find employee').fill('Reader')
  await p.getByRole('button', { name: /Reader User/ }).click(); await settle(p)
  check('vault: the person’s file with their documents', (await p.getByRole('row').filter({ hasText: docTitle }).count()) === 1)
  await shot(p, 'vault-light-1440')
  await p.goto(base + '/hrms/documents/pending'); await settle(p)
  check('review: counts for the week', (await p.getByText('Verified this week', { exact: true }).count()) === 1 && (await p.getByText('Rejected this week', { exact: true }).count()) === 1)
  const qrow = p.getByRole('row').filter({ hasText: docTitle })
  check('review: the document with its file details and expiry', (await qrow.count()) === 1 && /qa\.pdf · 20 KB/.test(await qrow.innerText()))
  await shot(p, 'review-light-1440')
  await qrow.getByRole('button', { name: `Reject ${docTitle}` }).click()
  const rd = p.getByRole('dialog', { name: 'Reject document' })
  check('review: reject waits for a reason', await rd.getByRole('button', { name: 'Reject and tell them' }).isDisabled())
  await rd.getByLabel(/Why it’s rejected/).fill('Blurry scan, please upload again')
  await rd.getByRole('button', { name: 'Reject and tell them' }).click()
  await rd.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  check('review: rejected with the reason', sql(`select verification_status||'|'||rejection_reason from document_mgmt.employee_documents where id='${docId}'`) === 'REJECTED|Blurry scan, please upload again')
  check('owner: no unexpected API failures or page errors', clean(o), o.failed[0] || o.errors[0] || '')

  // ── 8. my documents: the rejected one, and an upload ────────────────────
  const r2 = await session('reader@unifiedtree.demo')
  await r2.page.goto(base + '/hrms/documents'); await settle(r2.page)
  const dcard = r2.page.locator('article').filter({ hasText: docTitle })
  check('my documents: the rejected document asks for a new copy, with HR’s reason', (await dcard.count()) === 1 && /Upload again/.test(await dcard.innerText()) && /Blurry scan/.test(await dcard.innerText()))
  check('my documents: no HR controls or other people’s files', (await r2.page.getByRole('button', { name: /Add document/ }).count()) === 0 && (await r2.page.locator('[aria-label="Document views"]').count()) === 0)
  await shot(r2.page, 'my-documents-light-1440')
  if (typeId) {
    await dcard.getByRole('button', { name: /Upload a new copy/ }).click()
    const up = r2.page.getByRole('dialog', { name: 'Upload a document' })
    await up.locator('input[type=file]').setInputFiles({ name: `qa-${stamp}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% QA\n') })
    expected.push(/^503 POST \/v1\/document\/upload\/self/)
    const sent = r2.page.waitForResponse((res) => res.url().includes('/v1/document/upload/self'), { timeout: 15000 }).catch(() => null)
    await up.getByRole('button', { name: 'Upload', exact: true }).click()
    const res = await sent
    check('my documents: the upload reaches the server (201, or 503 where storage isn’t set up)', !!res && (res.status() === 201 || res.status() === 503), res ? res.status() : 'no call')
    if (res?.status() === 201) { const j = await res.json().catch(() => ({})); if (j?.id) sql(`delete from document_mgmt.employee_documents where id='${j.id}'`) }
    else await up.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
  }

  // ── 9. my assets: confirm and report ────────────────────────────────────
  assetId = sql(`insert into hrms.onboarding_assets (id, tenant_id, company_id, employee_id, asset_tag, asset_type, asset_name, status, assigned_at, created_at, updated_at, version)
    values (gen_random_uuid(), '${tenant}', '${company}', '${readerId}', '${assetTag}', 'Monitor', 'QA monitor ${stamp}', 'ASSIGNED', current_date, now(), now(), 0) returning id`).split('\n')[0]
  sql(`insert into hrms.asset_allocations (id, tenant_id, asset_id, employee_id, assigned_at, created_at) values (gen_random_uuid(), '${tenant}', '${assetId}', '${readerId}', current_date, now())`)
  await r2.page.goto(base + '/me/assets'); await settle(r2.page)
  const acard = r2.page.locator('article').filter({ hasText: `QA monitor ${stamp}` })
  check('my assets: a new hand-over asks to be confirmed', (await acard.count()) === 1 && /Confirm you got it/.test(await acard.innerText()) && (await r2.page.getByText(/Did you get the/).count()) >= 1)
  await shot(r2.page, 'my-assets-light-1440')
  await acard.getByRole('button', { name: /Yes, I have/ }).click()
  await r2.page.getByText(/Confirmed: QA monitor/).waitFor({ timeout: 10000 }).catch(() => {})
  await settle(r2.page)
  check('my assets: confirmed (With you)', /With you/.test(await acard.innerText()) && sql(`select count(*) from hrms.asset_confirmations where asset_id='${assetId}'`) === '1')
  await acard.getByRole('button', { name: /Report a problem/ }).click()
  const pd = r2.page.getByRole('dialog', { name: 'Report a problem' })
  await pd.getByLabel(/Anything else/).fill('QA: screen flickers')
  await pd.getByRole('button', { name: 'Report it' }).click()
  await pd.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await settle(r2.page)
  check('my assets: the problem is reported and shown', /Reported not working/.test(await acard.innerText()) && sql(`select count(*) from hrms.asset_issue_reports where asset_id='${assetId}' and status='OPEN'`) === '1')
  check('reader (documents, assets): no unexpected API failures or page errors', clean(r2), r2.failed[0] || r2.errors[0] || '')

  // ── 10. dark and phone ──────────────────────────────────────────────────
  for (const [who, path, name] of [['owner@unifiedtree.demo', '/hrms/letters/generated', 'letters-generated'], ['owner@unifiedtree.demo', '/hrms/documents?view=all', 'vault'],
    ['owner@unifiedtree.demo', '/hrms/documents/pending', 'review'], ['reader@unifiedtree.demo', '/hrms/letters/my', 'my-letters'],
    ['reader@unifiedtree.demo', '/hrms/documents', 'my-documents'], ['reader@unifiedtree.demo', '/me/assets', 'my-assets']]) {
    for (const [theme, width, height] of [['dark', 1440, 900], ['light', 390, 844], ['dark', 390, 844]]) {
      const c = await session(who, { width, height, theme })
      await c.page.goto(base + path); await settle(c.page)
      if (width === 390) check(`${name} ${theme} 390: nothing scrolls sideways`, await noSideScroll(c.page))
      if (theme === 'dark') check(`${name} dark: the dark theme is on`, (await c.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
      await shot(c.page, `${name}-${theme}-${width}`)
      check(`${name} ${theme} ${width}: no unexpected API failures or page errors`, clean(c), c.failed[0] || c.errors[0] || '')
      await c.ctx.close()
    }
  }
  {
    const c = await session('owner@unifiedtree.demo', { width: 390, height: 844 })
    await c.page.goto(base + '/hrms/letters/templates/new'); await settle(c.page)
    await c.page.locator('.lt-editor__body').click(); await c.page.keyboard.type('Dear {{employee.fullName}}')
    await c.page.frameLocator('iframe[title="Letter preview"]').locator('body').filter({ hasText: 'Dear' }).waitFor({ timeout: 15000 }).catch(() => {})
    check('template preview 390: it fits the phone', await noSideScroll(c.page))
    await shot(c.page, 'template-preview-light-390')
    await c.ctx.close()
  }

  // ── 11. who sees what ───────────────────────────────────────────────────
  for (const [email, letters, vault, review] of [
    ['hrm@unifiedtree.demo', ['Templates', 'Generated letters', 'Distributions', 'My letters'], ['My documents', 'Employee documents', 'Letter templates'], true],
    ['fin@unifiedtree.demo', ['Templates', 'Generated letters', 'Distributions', 'My letters'], ['My documents', 'Letter templates'], false],
    ['mgr@unifiedtree.demo', [], [], false],
    ['reader@unifiedtree.demo', [], [], false],
  ]) {
    const c = await session(email)
    const who = email.split('@')[0]
    await c.page.goto(base + '/hrms/letters'); await settle(c.page)
    const lv = await viewNames(c.page, 'Letter views')
    check(`${who}: letter views ${letters.length ? letters.join(' · ') : 'none (My letters only)'}`, JSON.stringify(lv) === JSON.stringify(letters) && (letters.length || (await c.page.getByRole('heading', { name: 'My letters', level: 1 }).count()) === 1), JSON.stringify(lv))
    if (who === 'fin') {
      await c.page.goto(base + '/hrms/letters/distributions'); await settle(c.page)
      check('fin: can read distributions but not start one', (await c.page.getByRole('button', { name: 'New distribution' }).count()) === 0)
      await c.page.goto(base + '/hrms/letters/templates'); await settle(c.page)
      check('fin: can read templates but not create, edit or delete them', (await c.page.getByRole('button', { name: 'Create template' }).count()) === 0 && (await c.page.getByRole('button', { name: /^Delete / }).count()) === 0)
    }
    await c.page.goto(base + '/hrms/documents'); await settle(c.page)
    const vv = await viewNames(c.page, 'Document views')
    check(`${who}: document views ${vault.length ? vault.join(' · ') : 'none (My documents only)'}`, JSON.stringify(vv) === JSON.stringify(vault) && (vault.length || (await c.page.getByRole('heading', { name: 'My documents', level: 1 }).count()) === 1), JSON.stringify(vv))
    check(`${who}: Add document only with write`, (await c.page.getByRole('button', { name: 'Add document' }).count()) === (who === 'hrm' ? 1 : 0))
    await c.page.goto(base + '/hrms/documents/pending'); await settle(c.page)
    const queue = await c.page.getByRole('table', { name: 'Documents waiting for review' }).count() + await c.page.getByText('Nothing to review').count()
    check(`${who}: Docs to review ${review ? 'opens' : 'is closed'}`, review ? queue >= 1 : queue === 0)
    check(`${who}: no unexpected API failures or page errors`, clean(c), c.failed[0] || c.errors[0] || '')
    await c.ctx.close()
  }
  await r.ctx.close(); await r2.ctx.close(); await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 400))
} finally {
  try {
    sql(`do $$ begin if to_regclass('letters.distribution_schedules_qa_off') is not null then alter table letters.distribution_schedules_qa_off rename to distribution_schedules; end if; end $$`)
    if (templateId) {
      sql(`delete from notif.notifications where data->>'letterId' in (select id::text from letters.generated where template_id='${templateId}')`)
      sql(`delete from letters.distribution_schedules where template_id='${templateId}'`)
      sql(`delete from letters.generated where template_id='${templateId}'`)
      sql(`delete from letters.templates where id='${templateId}'`)
    }
    sql(`delete from letters.templates where name like 'QA preview ${stamp}%'`)
    sql(`delete from document_mgmt.employee_documents where title like 'QA % ${stamp}' or file_url like '%qa-${stamp}%'`)
    if (assetId) {
      sql(`delete from notif.notifications where data->>'assetId'='${assetId}'`)
      sql(`delete from hrms.asset_issue_reports where asset_id='${assetId}'`)
      sql(`delete from hrms.asset_confirmations where asset_id='${assetId}'`)
      sql(`delete from hrms.asset_allocations where asset_id='${assetId}'`)
      sql(`delete from hrms.onboarding_assets where id='${assetId}'`)
    }
    const left = sql(`select (select count(*) from letters.templates where name like 'QA % ${stamp}%') + (select count(*) from document_mgmt.employee_documents where title like 'QA % ${stamp}') + (select count(*) from hrms.onboarding_assets where asset_tag='${assetTag}')`)
    check('cleanup: everything created is removed', left === '0', left)
  } catch (e) { check('cleanup ran', false, String(e.message || e).slice(0, 200)) }
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
