// Live check of the redesigned Documents and Letters pages:
//  - Documents: HR adds a document (by link) to the employee's file with the
//    searched picker; the employee sees it under My documents; HR deletes it.
//  - Documents to review: a pending document shows as a card; "View file" says
//    plainly that storage isn't set up (local) instead of opening nothing;
//    Reject needs a reason; Verify clears it from the queue.
//  - Letters: templates, generated letters (no UUID fragments), a letter,
//    distributions and one distribution open on the kit with one page header.
// No refused API calls or page errors. Everything created is removed.
//
//   node e2e/recovery/live-design-documents.mjs
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc', readerId = '22222222-2222-2222-2222-222222222222'
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
const h1 = (page) => page.locator('h1').count()
const stamp = Date.now()
const docTitle = `QA document ${stamp}`, pendingTitle = `QA pending ${stamp}`, rejectTitle = `QA reject ${stamp}`
try {
  const o = await session('owner@unifiedtree.demo')
  // ── add a document by link ──
  await o.page.goto(base + '/hrms/documents?view=all'); await settle(o.page)
  await o.page.getByRole('button', { name: /Add document/ }).click()
  const dlg = o.page.getByRole('dialog')
  await dlg.getByLabel('Find employee').fill('Reader')
  await dlg.getByRole('button', { name: /Reader User/ }).click()
  await dlg.getByLabel('Title', { exact: true }).fill(docTitle)
  await dlg.getByLabel('Or a link to an existing document').fill('https://example.com/qa-contract.pdf')
  await dlg.getByRole('button', { name: 'Store document' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  check('documents: HR stores a document on the employee’s file', sql(`select count(*) from document_mgmt.employee_documents where title='${docTitle}' and employee_id='${readerId}'`) === '1')
  await o.page.getByLabel('Find employee').fill('Reader')
  await o.page.getByRole('button', { name: /Reader User/ }).click(); await settle(o.page)
  check('documents: it shows on their file with a working link', (await o.page.getByRole('link', { name: new RegExp(docTitle) }).count()) === 1)

  // ── review queue ──
  sql(`insert into document_mgmt.employee_documents (tenant_id, employee_id, company_id, title, category, file_url, verification_status, original_filename, file_size_bytes) values ('${tenant}','${readerId}','${company}','${pendingTitle}','ID_PROOF','r2://employee-documents/${tenant}/qa-${stamp}.pdf','PENDING','qa.pdf',20480), ('${tenant}','${readerId}','${company}','${rejectTitle}','ID_PROOF','r2://employee-documents/${tenant}/qa-r-${stamp}.pdf','PENDING','qa-r.pdf',10240)`)
  await o.page.goto(base + '/hrms/documents/pending'); await settle(o.page)
  const card = o.page.locator('article').filter({ hasText: pendingTitle })
  check('review: the pending document is a card with its file details', (await card.count()) === 1 && /qa\.pdf · 20 KB/.test(await card.innerText()))
  await card.getByRole('button', { name: 'View file' }).click()
  await o.page.getByText('This file can’t be opened here', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  check('review: "View file" explains when storage isn’t set up', (await o.page.getByText('This file can’t be opened here', { exact: true }).count()) === 1)
  const rcard = o.page.locator('article').filter({ hasText: rejectTitle })
  await rcard.getByRole('button', { name: 'Reject' }).click()
  check('review: reject waits for a reason', await rcard.getByRole('button', { name: 'Reject and tell them' }).isDisabled())
  await rcard.getByLabel(/Why it’s rejected/).fill('Blurry scan, please upload again')
  await rcard.getByRole('button', { name: 'Reject and tell them' }).click()
  await o.page.getByText(/Rejected; the employee/).waitFor({ timeout: 10000 }).catch(() => {})
  check('review: reject records the reason', sql(`select verification_status||'|'||rejection_reason from document_mgmt.employee_documents where title='${rejectTitle}'`) === 'REJECTED|Blurry scan, please upload again')
  await card.getByRole('button', { name: 'Verify' }).click()
  await o.page.getByText('Verified', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  await settle(o.page)
  check('review: verify clears it from the queue', sql(`select verification_status from document_mgmt.employee_documents where title='${pendingTitle}'`) === 'VERIFIED' && (await o.page.locator('article').filter({ hasText: pendingTitle }).count()) === 0)

  // ── letters ──
  await o.page.goto(base + '/hrms/documents?view=letters'); await settle(o.page)
  check('documents: letter templates view has one page header', (await h1(o.page)) === 1 && (await o.page.getByText('Letter templates', { exact: true }).count()) >= 1)
  await o.page.goto(base + '/hrms/letters/templates'); await settle(o.page)
  // One Letters hub: the old routes open its views.
  check('letters: /templates opens the hub on Templates', (await o.page.getByRole('heading', { name: 'Letters', level: 1 }).count()) === 1 && (await o.page.getByRole('button', { name: /^Templates/, pressed: true }).count()) === 1)
  await o.page.goto(base + '/hrms/letters/generated'); await settle(o.page)
  const genText = await o.page.locator('main, body').first().innerText()
  check('letters: generated letters list without UUID fragments', (await o.page.getByRole('button', { name: /^Generated letters/, pressed: true }).count()) === 1 && !/[0-9a-f]{8}…/.test(genText))
  const letterId = sql(`select id from letters.generated order by created_at desc limit 1`)
  if (letterId) {
    await o.page.goto(base + `/hrms/letters/generated/${letterId}`); await settle(o.page)
    const t = await o.page.locator('body').innerText()
    check('letters: a letter opens, with no "Generated By"/"Template ID" UUIDs', (await h1(o.page)) === 1 && !/Template ID|Generated By/.test(t))
  }
  await o.page.goto(base + '/hrms/letters/distributions'); await settle(o.page)
  check('letters: /distributions opens the hub on Distributions', (await o.page.getByRole('button', { name: /^Distributions/, pressed: true }).count()) === 1)
  const jobId = sql(`select id from letters.distribution_jobs order by created_at desc limit 1`)
  if (jobId) {
    await o.page.goto(base + `/hrms/letters/distributions/${jobId}`); await settle(o.page)
    check('letters: a distribution opens with its tiles', (await o.page.getByText('Still to send', { exact: true }).count()) === 1)
  }
  check('owner: no refused API calls or page errors', !o.failed.length && !o.errors.length, o.failed[0] || o.errors[0] || '')

  // ── the employee sees it ──
  const r = await session('reader@unifiedtree.demo')
  await r.page.goto(base + '/hrms/documents'); await settle(r.page)
  check('employee: the document is under My documents', (await r.page.getByText(docTitle).count()) === 1)
  check('employee: no "Add document" or other people’s files', (await r.page.getByRole('button', { name: /Add document/ }).count()) === 0 && (await r.page.locator('[aria-label="Document views"]').count()) === 0)
  check('employee: no refused API calls or page errors', !r.failed.length && !r.errors.length, r.failed[0] || r.errors[0] || '')
  await r.ctx.close()

  // ── HR deletes it ──
  await o.page.goto(base + '/hrms/documents?view=all'); await settle(o.page)
  await o.page.getByLabel('Find employee').fill('Reader')
  await o.page.getByRole('button', { name: /Reader User/ }).click(); await settle(o.page)
  o.page.once('dialog', (d) => d.accept())
  await o.page.getByRole('button', { name: `Delete ${docTitle}` }).click()
  await o.page.getByText('Document deleted', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
  check('documents: HR deletes it', sql(`select count(*) from document_mgmt.employee_documents where title='${docTitle}'`) === '0')
  await o.ctx.close()
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  sql(`delete from document_mgmt.employee_documents where title like 'QA % ${stamp}' or title like 'QA document %' or title like 'QA pending %' or title like 'QA reject %'`)
  check('cleanup: QA documents removed', sql(`select count(*) from document_mgmt.employee_documents where title like 'QA %'`) === '0')
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
