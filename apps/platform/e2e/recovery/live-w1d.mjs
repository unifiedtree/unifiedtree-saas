// Live API check for w1d (V143_13): expense receipts, another person's leave and
// expenses, document edit + typed (bulk) uploads + upload limits, document types
// for new workspaces, and the exit type with the attrition split. No browser.
//
//   RECOVERY_API_URL=http://127.0.0.1:8097/api node e2e/recovery/live-w1d.mjs
//
// Runs against a LOCAL backend and the local recovery database (demo tenant,
// users owner@ admin@ hrm@ mgr@ fin@ reader@ unifiedtree.demo). Where the local
// backend has no R2 document storage, the file-storing calls must answer 503 with
// a clear message; the checks accept that and say so. Everything created is removed.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const PSQL = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const DB = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const READER = '22222222-2222-2222-2222-222222222222' // EMPLOYEE, reports to the manager
const HR = '33333333-3333-3333-3333-333333333333'
const MGR = '44444444-4444-4444-4444-444444444444' // DEPT_MANAGER: team = direct reports
const FIN = '55555555-5555-5555-5555-555555555555'
const sql = (q) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const headers = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
  const read = async (res) => { const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text } return { status: res.status, json } }
  const call = async (path, method = 'GET', body) => read(await fetch(api + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }))
  /** multipart: parts is { name: Buffer|object } — objects are sent as JSON parts, Buffers as files. */
  const form = async (path, method, parts, fileName = 'file.pdf', type = 'application/pdf') => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(parts)) {
      if (Buffer.isBuffer(v)) fd.append(k, new Blob([v], { type }), fileName)
      else fd.append(k, new Blob([JSON.stringify(v)], { type: 'application/json' }))
    }
    return read(await fetch(api + path, { method, headers, body: fd }))
  }
  return { call, form, perms: JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString()).permissions || [] }
}

const stamp = Date.now()
const claims = [], docs = [], storedKeys = []
let exitEmp = null, typesMoved = null, seededTypeIds = []
const FAKE_TENANT = 'eeeeeeee-0000-4000-8000-0000000000d1'
try {
  const owner = await login('owner@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')

  // ── permissions (V143_13) ─────────────────────────────────────────────────
  check('perms: HR holds leave.employee.read and expense.employee.read', hrm.perms.includes('hrms.leave.employee.read') && hrm.perms.includes('hrms.expense.employee.read'))
  check('perms: OWNER and SUPER_ADMIN hold both new permissions', ['hrms.leave.employee.read', 'hrms.expense.employee.read'].every((p) => owner.perms.includes(p) && admin.perms.includes(p)))
  check('perms: finance reads anyone’s claims but not their leave', fin.perms.includes('hrms.expense.employee.read') && !fin.perms.includes('hrms.leave.employee.read'))
  check('perms: department manager and employee hold neither', ['hrms.leave.employee.read', 'hrms.expense.employee.read'].every((p) => !mgr.perms.includes(p) && !reader.perms.includes(p)))

  // ── another person's leave ────────────────────────────────────────────────
  const year = Number(istToday().slice(0, 4))
  const bal = await hrm.call(`/v1/leave/employees/${READER}/balances`)
  const dbBal = Number(sql(`select count(*) from leave_mgmt.leave_balances where employee_id='${READER}' and year=${year}`))
  check('leave: HR reads another person’s balances (= DB rows for the IST year)', bal.status === 200 && Array.isArray(bal.json) && bal.json.length === dbBal && bal.json.every((b) => b.employeeId === READER && b.year === year), `status=${bal.status} api=${bal.json?.length} db=${dbBal}`)
  const reqs = await hrm.call(`/v1/leave/employees/${READER}/requests?size=50`)
  const dbReqs = Number(sql(`select count(*) from leave_mgmt.leave_requests where employee_id='${READER}'`))
  check('leave: HR reads another person’s requests (= DB count, newest first)', reqs.status === 200 && reqs.json?.totalElements === dbReqs && (reqs.json?.content || []).every((r, i, a) => r.employeeId === READER && (i === 0 || a[i - 1].startDate >= r.startDate)), `status=${reqs.status} api=${reqs.json?.totalElements} db=${dbReqs}`)
  check('leave: manager reads their team member', (await mgr.call(`/v1/leave/employees/${READER}/balances`)).status === 200 && (await mgr.call(`/v1/leave/employees/${READER}/requests`)).status === 200)
  const mgrOut = await mgr.call(`/v1/leave/employees/${FIN}/balances`)
  check('leave: manager is refused outside their team (403)', mgrOut.status === 403 && (await mgr.call(`/v1/leave/employees/${FIN}/requests`)).status === 403, `status=${mgrOut.status}`)
  check('leave: employee reads themselves', (await reader.call(`/v1/leave/employees/${READER}/balances`)).status === 200)
  check('leave: employee is refused for someone else (403)', (await reader.call(`/v1/leave/employees/${HR}/balances`)).status === 403 && (await reader.call(`/v1/leave/employees/${HR}/requests`)).status === 403)
  check('leave: finance is refused for someone else’s leave (403)', (await fin.call(`/v1/leave/employees/${READER}/requests`)).status === 403)
  check('leave: unknown employee is 404 for HR', (await hrm.call(`/v1/leave/employees/${randomUUID()}/balances`)).status === 404)

  // ── expense receipts ──────────────────────────────────────────────────────
  const line = (extra = {}) => ({ category: 'TRAVEL', amount: 120, expenseDate: istToday(), description: 'QA w1d taxi', ...extra })
  const c1 = await reader.call('/v1/expense/claims', 'POST', { title: `QA w1d claim ${stamp}`, items: [line()] })
  if (c1.json?.id) claims.push(c1.json.id)
  check('expense: employee submits a claim (fixture)', c1.status === 201 && c1.json?.itemCount === 1 && c1.json?.receiptCount === 0, `status=${c1.status}`)
  const up = await reader.form('/v1/expense/receipts', 'POST', { file: PDF }, 'taxi.pdf')
  const storageOn = up.status === 201
  if (storageOn) {
    storedKeys.push(up.json.receiptUrl)
    check('receipt: upload stores under the claimant’s prefix', up.json.receiptUrl.startsWith(`r2://expense-receipts/${tenant}/${READER}/`) && up.json.contentType === 'application/pdf', up.json.receiptUrl)
    const c2 = await reader.call('/v1/expense/claims', 'POST', { title: `QA w1d receipt claim ${stamp}`, items: [line({ receiptUrl: up.json.receiptUrl })] })
    if (c2.json?.id) claims.push(c2.json.id)
    check('receipt: claim keeps the r2 key in the DB', c2.status === 201 && sql(`select receipt_url from expense_mgmt.expense_items where claim_id='${c2.json?.id}'`) === up.json.receiptUrl)
    const got = await reader.call(`/v1/expense/claims/${c2.json?.id}`)
    check('receipt: the claim hands out a signed link, never the key', got.status === 200 && got.json?.items?.[0]?.hasReceipt === true && /^https?:\/\//.test(got.json?.items?.[0]?.receiptUrl || ''), got.json?.items?.[0]?.receiptUrl)
    const att = await reader.form(`/v1/expense/claims/${c1.json?.id}/items/${c1.json?.items?.[0]?.id}/receipt`, 'POST', { file: PDF }, 'late.pdf')
    const attached = sql(`select receipt_url from expense_mgmt.expense_items where claim_id='${c1.json?.id}'`)
    if (attached) storedKeys.push(attached)
    check('receipt: attach to a waiting claim later', att.status === 200 && attached.startsWith(`r2://expense-receipts/${tenant}/${READER}/`) && att.json?.receiptCount === 1, `status=${att.status}`)
  } else {
    check('receipt: without R2 the upload says storage isn’t set up (503)', up.status === 503 && /storage/i.test(up.json?.message || ''), `status=${up.status} ${up.json?.message || ''}`)
    const att = await reader.form(`/v1/expense/claims/${c1.json?.id}/items/${c1.json?.items?.[0]?.id}/receipt`, 'POST', { file: PDF }, 'late.pdf')
    check('receipt: attach later answers 503 without storage, and stores nothing', att.status === 503 && sql(`select coalesce(receipt_url,'') from expense_mgmt.expense_items where claim_id='${c1.json?.id}'`) === '', `status=${att.status}`)
  }
  const bad = await reader.form('/v1/expense/receipts', 'POST', { file: Buffer.from('<script>alert(1)</script>') }, 'receipt.pdf')
  check('receipt: content that is not a PDF / image is refused (400)', bad.status === 400, `status=${bad.status} ${bad.json?.message || ''}`)
  const forged = await reader.call('/v1/expense/claims', 'POST', { title: `QA w1d forged ${stamp}`, items: [line({ receiptUrl: `r2://expense-receipts/${tenant}/${MGR}/${randomUUID()}.pdf` })] })
  if (forged.json?.id) claims.push(forged.json.id)
  check('receipt: a claim can’t reference someone else’s receipt (400, nothing saved)', forged.status === 400 && sql(`select count(*) from expense_mgmt.expense_claims where title='QA w1d forged ${stamp}'`) === '0', `status=${forged.status}`)
  const mgrAttach = await mgr.form(`/v1/expense/claims/${c1.json?.id}/items/${c1.json?.items?.[0]?.id}/receipt`, 'POST', { file: PDF }, 'x.pdf')
  check('receipt: nobody else can attach to your claim (403)', mgrAttach.status === 403, `status=${mgrAttach.status}`)

  // ── another person's claims ───────────────────────────────────────────────
  const hrList = await hrm.call(`/v1/expense/employees/${READER}/claims?size=100`)
  const dbClaims = Number(sql(`select count(*) from expense_mgmt.expense_claims where employee_id='${READER}'`))
  check('claims: HR lists another person’s claims (= DB count, with receipt counts)', hrList.status === 200 && hrList.json?.totalElements === dbClaims && claims.every((id) => (hrList.json?.content || []).some((c) => c.id === id && c.itemCount === 1)), `api=${hrList.json?.totalElements} db=${dbClaims}`)
  check('claims: finance lists them too', (await fin.call(`/v1/expense/employees/${READER}/claims`)).status === 200)
  check('claims: manager lists their team member’s claims', (await mgr.call(`/v1/expense/employees/${READER}/claims`)).status === 200)
  check('claims: manager is refused outside their team (403)', (await mgr.call(`/v1/expense/employees/${FIN}/claims`)).status === 403)
  check('claims: employee lists their own, not others (200 / 403)', (await reader.call(`/v1/expense/employees/${READER}/claims`)).status === 200 && (await reader.call(`/v1/expense/employees/${HR}/claims`)).status === 403)
  const finClaim = await fin.call('/v1/expense/claims', 'POST', { title: `QA w1d finance claim ${stamp}`, items: [line()] })
  if (finClaim.json?.id) claims.push(finClaim.json.id)
  check('claim detail: manager opens a team member’s claim', (await mgr.call(`/v1/expense/claims/${c1.json?.id}`)).status === 200)
  const outside = await mgr.call(`/v1/expense/claims/${finClaim.json?.id}`)
  check('claim detail: manager can no longer open a claim outside their team (403)', outside.status === 403, `status=${outside.status}`)
  check('claim detail: HR opens any claim', (await hrm.call(`/v1/expense/claims/${finClaim.json?.id}`)).status === 200)

  // ── document types for a workspace that has none (lazy seed) ──────────────
  const before = sql(`select string_agg(id::text, ',') from document_mgmt.document_types where tenant_id='${tenant}'`)
  typesMoved = before ? before.split(',') : []
  if (typesMoved.length) sql(`update document_mgmt.document_types set tenant_id='${FAKE_TENANT}' where id in (${typesMoved.map((x) => `'${x}'`).join(',')})`)
  // GET /my/missing seeds too (an employee's first stop may be the missing-documents card).
  const missing = await reader.call('/v1/document/my/missing')
  const afterMissing = Number(sql(`select count(*) from document_mgmt.document_types where tenant_id='${tenant}'`))
  check('types: GET /my/missing seeds the 10 defaults and lists the required ones', missing.status === 200 && afterMissing === 10 && Array.isArray(missing.json) && ['AADHAAR', 'PAN'].every((c) => missing.json.some((t) => t.code === c)), `status=${missing.status} db=${afterMissing}`)
  const seededList = await reader.call('/v1/document/types')
  seededTypeIds = sql(`select coalesce(string_agg(id::text, ','), '') from document_mgmt.document_types where tenant_id='${tenant}'`).split(',').filter(Boolean)
  check('types: GET /types then lists the 10 defaults, seeded once', seededList.status === 200 && seededList.json?.length === 10 && seededTypeIds.length === 10 && ['AADHAAR', 'PAN', 'PHOTO', 'RESUME', 'OTHER'].every((c) => seededList.json.some((t) => t.code === c)), `status=${seededList.status} api=${seededList.json?.length} db=${seededTypeIds.length}`)
  const again = await reader.call('/v1/document/types?includeInactive=true')
  check('types: a second read seeds nothing more', again.json?.length === 10 && Number(sql(`select count(*) from document_mgmt.document_types where tenant_id='${tenant}'`)) === 10)
  sql(`delete from document_mgmt.document_types where tenant_id='${tenant}'`)
  if (typesMoved.length) sql(`update document_mgmt.document_types set tenant_id='${tenant}' where tenant_id='${FAKE_TENANT}'`)
  typesMoved = null; seededTypeIds = []
  check('types: the workspace’s own types are back', Number(sql(`select count(*) from document_mgmt.document_types where tenant_id='${tenant}'`)) === (before ? before.split(',').length : 0))

  // ── documents: edit ───────────────────────────────────────────────────────
  const types = (await hrm.call('/v1/document/types')).json || []
  const eduType = types.find((t) => t.code === 'EDUCATION_CERT') || types[0]
  const photoType = types.find((t) => t.code === 'PHOTO')
  const aadhaarType = types.find((t) => t.code === 'AADHAAR') || types[0]
  const d1 = await hrm.call('/v1/document/documents', 'POST', { employeeId: READER, title: `QA w1d doc ${stamp}`, category: 'OTHER', fileUrl: 'https://example.com/w1d-a.pdf' })
  if (d1.json?.id) docs.push(d1.json.id)
  check('documents: HR stores a link document (fixture)', d1.status === 201, `status=${d1.status}`)
  const edit = { title: `QA w1d doc edited ${stamp}`, category: 'CERTIFICATE', documentTypeId: eduType?.id, issuedDate: '2024-06-01', expiryDate: '2030-06-01', notes: 'Edited by w1d', fileUrl: 'https://example.com/w1d-b.pdf' }
  const e1 = await hrm.call(`/v1/document/documents/${d1.json?.id}`, 'PUT', edit)
  const row = sql(`select title||'|'||category||'|'||coalesce(document_type_id::text,'')||'|'||issued_date||'|'||expiry_date||'|'||notes||'|'||file_url from document_mgmt.employee_documents where id='${d1.json?.id}'`)
  check('documents: edit saves title, category, type, dates, notes and link', e1.status === 200 && row === [edit.title, 'CERTIFICATE', eduType?.id, edit.issuedDate, edit.expiryDate, edit.notes, edit.fileUrl].join('|'), row)
  const eBad = await hrm.call(`/v1/document/documents/${d1.json?.id}`, 'PUT', { ...edit, issuedDate: '2030-01-01', expiryDate: '2029-01-01' })
  check('documents: expiry before issue is refused (400)', eBad.status === 400)
  check('documents: an unknown type is refused (404)', (await hrm.call(`/v1/document/documents/${d1.json?.id}`, 'PUT', { ...edit, documentTypeId: randomUUID() })).status === 404)
  const eMgr = await mgr.call(`/v1/document/documents/${d1.json?.id}`, 'PUT', { ...edit, title: 'hijack' })
  const eReader = await reader.call(`/v1/document/documents/${d1.json?.id}`, 'PUT', { ...edit, title: 'hijack' })
  check('documents: manager and employee cannot edit (403, unchanged)', eMgr.status === 403 && eReader.status === 403 && sql(`select title from document_mgmt.employee_documents where id='${d1.json?.id}'`) === edit.title, `mgr=${eMgr.status} reader=${eReader.status}`)
  if (photoType) {
    const wrongFmt = await hrm.form(`/v1/document/documents/${d1.json?.id}`, 'PUT', { metadata: { ...edit, documentTypeId: photoType.id }, file: PDF }, 'photo.pdf')
    check('documents: a replacement file must match the type’s formats (400)', wrongFmt.status === 400, `status=${wrongFmt.status} ${wrongFmt.json?.message || ''}`)
  }
  const replace = await hrm.form(`/v1/document/documents/${d1.json?.id}`, 'PUT', { metadata: edit, file: PDF }, 'cert.pdf')
  if (storageOn) {
    const r2 = sql(`select file_url||'|'||verification_status||'|'||content_type from document_mgmt.employee_documents where id='${d1.json?.id}'`)
    if (r2.startsWith('r2://')) storedKeys.push(r2.split('|')[0])
    check('documents: replacing the file stores it and marks it verified', replace.status === 200 && r2.startsWith(`r2://employee-documents/${tenant}/`) && r2.endsWith('|VERIFIED|application/pdf'), r2)
  } else {
    check('documents: without R2 a file replacement says so (503) and keeps the old link', replace.status === 503 && sql(`select file_url from document_mgmt.employee_documents where id='${d1.json?.id}'`) === edit.fileUrl, `status=${replace.status}`)
  }

  // ── documents: typed uploads (what bulk upload sends per file) + limits ───
  if (photoType) {
    const pdfAsPhoto = await hrm.form('/v1/document/upload', 'POST', { metadata: { employeeId: READER, title: `QA w1d bulk photo ${stamp}`, category: 'ID_PROOF', documentTypeId: photoType.id }, file: PDF }, 'photo.pdf')
    check('bulk: a file outside its type’s formats is refused (400)', pdfAsPhoto.status === 400 && /jpg|png/i.test(pdfAsPhoto.json?.message || ''), `status=${pdfAsPhoto.status} ${pdfAsPhoto.json?.message || ''}`)
    const bigPng = Buffer.concat([PNG, Buffer.alloc(Math.round(2.4 * 1024 * 1024))])
    const overType = await hrm.form('/v1/document/upload', 'POST', { metadata: { employeeId: READER, title: `QA w1d bulk big ${stamp}`, category: 'ID_PROOF', documentTypeId: photoType.id }, file: bigPng }, 'photo.png', 'image/png')
    check('bulk: a file over its type’s size cap is refused (400, not 500)', overType.status === 400 && /too large/i.test(overType.json?.message || ''), `status=${overType.status} ${overType.json?.message || ''}`)
  }
  const typed = await hrm.form('/v1/document/upload', 'POST', { metadata: { employeeId: READER, title: `QA w1d bulk aadhaar ${stamp}`, category: 'ID_PROOF', documentTypeId: aadhaarType?.id }, file: PDF }, 'aadhaar.pdf')
  if (typed.json?.id) { docs.push(typed.json.id); const k = sql(`select file_url from document_mgmt.employee_documents where id='${typed.json.id}'`); if (k.startsWith('r2://')) storedKeys.push(k) }
  check(storageOn ? 'bulk: a valid typed file is stored verified' : 'bulk: a valid typed file answers 503 without storage',
    storageOn ? typed.status === 201 && sql(`select verification_status||'|'||document_type_id from document_mgmt.employee_documents where id='${typed.json?.id}'`) === `VERIFIED|${aadhaarType?.id}` : typed.status === 503, `status=${typed.status}`)
  check('bulk: an employee can’t upload onto someone’s file (403)', (await reader.form('/v1/document/upload', 'POST', { metadata: { employeeId: HR, title: 'x', category: 'OTHER', documentTypeId: aadhaarType?.id }, file: PDF }, 'x.pdf')).status === 403)
  // Over the multipart limit: a clear 400 instead of the old 500. The limit is 10 MB in
  // production and Spring's 1 MB default otherwise; try just over 10 MB, then just over 1 MB.
  let limit = null
  for (const size of [10.3, 1.2]) {
    try {
      limit = await hrm.form('/v1/document/upload', 'POST', { metadata: { employeeId: READER, title: `QA w1d huge ${stamp}`, category: 'OTHER' }, file: Buffer.concat([PDF, Buffer.alloc(Math.round(size * 1024 * 1024))]) }, 'huge.pdf')
      if (limit.status === 400) break
    } catch (e) { limit = { status: 0, json: { message: String(e.message || e) } } }
  }
  check('limits: an upload over the multipart limit is 400 "File is too large (max N MB)"', limit?.status === 400 && /^File is too large \(max [\d.]+ MB\)$/.test(limit?.json?.message || ''), `status=${limit?.status} ${limit?.json?.message || ''}`)

  // ── exit type ─────────────────────────────────────────────────────────────
  const companyId = sql(`select company_id from hrms.employees where id='${READER}'`)
  exitEmp = randomUUID()
  sql(`insert into hrms.employees (id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, employment_status, date_of_joining) values ('${exitEmp}','${tenant}','${companyId}','QAW1D${String(stamp).slice(-6)}','QA w1d','Leaver','FULL_TIME','ACTIVE','2024-01-15')`)
  const lastMonth = (() => { const d = new Date(istToday() + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10) })()
  const n1 = await hrm.call(`/v1/hrms/employees/${exitEmp}/notice?noticeStart=${lastMonth.slice(0, 8)}01&lastWorkingDay=${lastMonth}&reason=${encodeURIComponent('Moving city')}&exitType=TERMINATION`, 'POST')
  check('exit: Start notice records the exit type', n1.status === 200 && n1.json?.exitType === 'TERMINATION' && sql(`select employment_status||'|'||exit_type from hrms.employees where id='${exitEmp}'`) === 'NOTICE_PERIOD|TERMINATION', `status=${n1.status}`)
  const bogus = await hrm.call(`/v1/hrms/employees/${exitEmp}/notice?noticeStart=${lastMonth.slice(0, 8)}01&lastWorkingDay=${lastMonth}&exitType=FIRED`, 'POST')
  check('exit: an unknown exit type is refused (400)', bogus.status === 400 && sql(`select exit_type from hrms.employees where id='${exitEmp}'`) === 'TERMINATION', `status=${bogus.status}`)
  check('exit: an employee cannot start a notice (403)', (await reader.call(`/v1/hrms/employees/${exitEmp}/notice?noticeStart=${lastMonth}&lastWorkingDay=${lastMonth}&exitType=RESIGNATION`, 'POST')).status === 403)
  const cancel = await hrm.call(`/v1/hrms/employees/${exitEmp}/cancel-notice`, 'POST')
  check('exit: cancelling the notice clears the exit type', cancel.status === 200 && sql(`select employment_status||'|'||coalesce(exit_type,'none') from hrms.employees where id='${exitEmp}'`) === 'ACTIVE|none')
  await hrm.call(`/v1/hrms/employees/${exitEmp}/notice?noticeStart=${lastMonth.slice(0, 8)}01&lastWorkingDay=${lastMonth}&reason=${encodeURIComponent('Moving city')}&exitType=TERMINATION`, 'POST')
  const x = await hrm.call(`/v1/hrms/employees/${exitEmp}/exit?lastWorkingDay=${lastMonth}&exitType=RETIREMENT`, 'POST')
  check('exit: Mark exited records its type and keeps the notice’s reason', x.status === 200 && sql(`select employment_status||'|'||exit_type||'|'||exit_reason from hrms.employees where id='${exitEmp}'`) === 'EXITED|RETIREMENT|Moving city', sql(`select employment_status||'|'||exit_type||'|'||coalesce(exit_reason,'') from hrms.employees where id='${exitEmp}'`))
  const month = lastMonth.slice(0, 7)
  const attr = async () => ((await hrm.call(`/v1/reports/attrition?companyId=${companyId}&from=${month}-01&to=${lastMonth}`)).json || []).find((r) => r.month === month) || {}
  // The month's split straight from the table: [resigned, terminated, other].
  const dbSplit = () => sql(`with x as (select coalesce(exit_type, case employment_status when 'RESIGNED' then 'RESIGNATION' when 'TERMINATED' then 'TERMINATION' end) t from hrms.employees where company_id='${companyId}' and employment_status in ('EXITED','TERMINATED','RESIGNED') and to_char(coalesce(last_working_day, date_of_termination),'YYYY-MM')='${month}') select count(*) filter (where t='RESIGNATION')||','||count(*) filter (where t='TERMINATION')||','||count(*) filter (where t is distinct from 'RESIGNATION' and t is distinct from 'TERMINATION') from x`).split(',').map(Number)
  const split = (a) => [Number(a.resignations), Number(a.terminations), Number(a.other_exits)]
  const a1 = await attr()
  check('attrition: a retirement counts as "other", not resigned or terminated (= DB split)', JSON.stringify(split(a1)) === JSON.stringify(dbSplit()) && split(a1)[2] >= 1, `api=${split(a1)} db=${dbSplit()}`)
  const fix = await hrm.call(`/v1/hrms/employees/${exitEmp}`, 'PUT', { exitType: 'RESIGNATION' })
  check('exit: HR corrects the exit type', fix.status === 200 && sql(`select exit_type from hrms.employees where id='${exitEmp}'`) === 'RESIGNATION')
  const a2 = await attr()
  check('attrition: the corrected exit moves to "resigned" (= DB split)', split(a2)[0] === split(a1)[0] + 1 && split(a2)[2] === split(a1)[2] - 1 && JSON.stringify(split(a2)) === JSON.stringify(dbSplit()), `api=${split(a2)} db=${dbSplit()}`)
  const list = await hrm.call(`/v1/hrms/employees?status=EXITED&search=${encodeURIComponent('Leaver')}&page=0&pageSize=50`)
  const rows = list.json?.content || []
  check('exit: the directory list carries the exit type for the Exit centre', rows.some((r) => r.id === exitEmp && r.exitType === 'RESIGNATION'), `status=${list.status} rows=${rows.length}`)
} catch (e) {
  check('run completed without an exception', false, String(e?.stack || e))
} finally {
  // ── cleanup ──
  try {
    if (typesMoved?.length) {
      sql(`delete from document_mgmt.document_types where tenant_id='${tenant}'`)
      sql(`update document_mgmt.document_types set tenant_id='${tenant}' where tenant_id='${FAKE_TENANT}'`)
    }
    for (const id of claims) {
      sql(`delete from notif.notifications where data::text like '%${id}%'`)
      sql(`delete from expense_mgmt.reimbursement_batch_items where claim_id='${id}'`)
      sql(`delete from expense_mgmt.expense_items where claim_id='${id}'`)
      sql(`delete from expense_mgmt.expense_claims where id='${id}'`)
    }
    sql(`delete from expense_mgmt.expense_claims where title like 'QA w1d % ${stamp}'`)
    sql(`delete from document_mgmt.employee_documents where title like 'QA w1d % ${stamp}' or id in (${docs.length ? docs.map((d) => `'${d}'`).join(',') : 'null'})`)
    if (exitEmp) sql(`delete from hrms.employees where id='${exitEmp}'`)
    check('cleanup: nothing the run created is left', sql(`select count(*) from expense_mgmt.expense_claims where title like 'QA w1d % ${stamp}'`) === '0'
      && sql(`select count(*) from document_mgmt.employee_documents where title like 'QA w1d % ${stamp}'`) === '0'
      && sql(`select count(*) from hrms.employees where employee_code like 'QAW1D%'`) === '0'
      && sql(`select count(*) from document_mgmt.document_types where tenant_id='${FAKE_TENANT}'`) === '0')
    if (storedKeys.length) console.log(`note: ${storedKeys.length} object(s) were written to the R2 document bucket (receipts / replaced files); remove them there if this was not a scratch bucket:\n  ${storedKeys.join('\n  ')}`)
  } catch (e) { check('cleanup', false, String(e?.message || e)) }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
