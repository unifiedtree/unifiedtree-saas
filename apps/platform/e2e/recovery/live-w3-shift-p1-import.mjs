// Live check of shift planning Phase 1, package C (the roster's Excel import), API only.
//
//   · owner (HR/Admin): the template opens as an Excel workbook with the S13 headers, the people of the department
//     and the shift codes; a CSV in the same layout with planted problems is checked (unknown code, someone not
//     found, the same person twice, someone outside the department, a code on a day outside the period: errors with
//     row and column; L with no approved leave and PH with no holiday: warnings) and apply refuses it; the fixed file
//     is checked clean and applied as a DRAFT (source IMPORT, never published, nothing in the published schedule);
//     the draft is exported and the export checked again (round trip, the same codes); the export replaces the
//     draft's days; a published roster is never replaced (409 ROSTER_PUBLISHED)
//   · mgr@unifiedtree.demo (DEPT_MANAGER), made head of the test's department (undone at the end): the template of
//     their department works; checking a file for another department is refused (403 ROSTER_SCOPE)
//   · an employee (reader@): 403 everywhere
//   · the web page (owner): /hrms/shifts/planner/import through Import → Validate → Preview → Apply with next month's
//     sheet, at 1440 wide (screenshots shift-p1-import-*.png), and the page at 390 wide without sideways scroll;
//     page errors and API 4xx/5xx are failures
// Everything it creates is removed at the end (SQL on the slot's database, as the other live tests do).
//
//   live-slot.sh /c/REACT/ut-wt/shift-p1-import 3193 node e2e/recovery/live-w3-shift-p1-import.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev),
//        RECOVERY_PASSWORD
/* global process, console, fetch, FormData, Blob, Buffer, URL, document, window */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3193'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const num = (q) => Number(sql(q) || 0)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const header = (iso) => `${iso.slice(8, 10)} ${MON[Number(iso.slice(5, 7)) - 1]}`   // "01 Oct", the template's RANGE header

// A range of 10 days, a week from now (an import never publishes, so the dates only need to be a valid period).
const start = addDays(istToday(), 7)
const end = addDays(start, 9)
const dates = Array.from({ length: 10 }, (_, i) => addDays(start, i))

// ── sessions ────────────────────────────────────────────────────────────────
const surprises = []
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const raw = async (path, init = {}) => {
    const res = await fetch(api + path, { ...init, headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}`, ...(init.headers || {}) } })
    const buf = Buffer.from(await res.arrayBuffer())
    let json = null
    try { json = buf.length && /json/.test(res.headers.get('content-type') || '') ? JSON.parse(buf.toString('utf8')) : null } catch { json = null }
    if (res.status >= 500 && !(json && json.errorCode === 'FEATURE_NOT_READY')) surprises.push(`${init.method || 'GET'} ${path} → ${res.status} ${buf.toString('utf8').slice(0, 200)}`)
    return { status: res.status, json, buf, type: res.headers.get('content-type') || '' }
  }
  const upload = (path, name, bytes, type) => {
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type }), name)
    return raw(path, { method: 'POST', body: fd })
  }
  return { raw, upload, employeeId: d.employeeId }
}

// ── a tiny .xlsx reader: the strings of the workbook (sharedStrings.xml), enough to check the headers ──
function zipEntry(buf, wanted) {
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (i < 0) return null
  const count = buf.readUInt16LE(i + 10)
  let p = buf.readUInt32LE(i + 16)
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === wanted) {
      const at = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(at, at + size)
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}
const xlsxStrings = (buf) => [...(zipEntry(buf, 'xl/sharedStrings.xml') || '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))

// ── fixtures ────────────────────────────────────────────────────────────────
const tag = randomUUID().slice(0, 6)
const DEPT = randomUUID(), OTHER_DEPT = randomUUID(), M1 = randomUUID(), M2 = randomUUID(), O = randomUUID()
const DAY = randomUUID(), NIGHT = randomUUID()
const people = { M1, M2, O }
const NAME = { M1: `Importone ${tag}`, M2: `Importtwo ${tag}`, O: `Importout ${tag}` }
const CODE = { M1: `QIM1${tag}`, M2: `QIM2${tag}`, O: `QIMO${tag}` }
const D = `D${tag.slice(0, 3)}`.toUpperCase(), N = `N${tag.slice(0, 3)}`.toUpperCase()   // the shifts' codes
const everyone = Object.values(people)

function insertFixtures() {
  const emp = (k, dept) => `('${people[k]}','${tenant}','${company}','${CODE[k]}','${NAME[k].split(' ')[0]}','${tag}',
      'qa-import-${k.toLowerCase()}-${tag}@example.invalid','FULL_TIME','ACTIVE','${dept}','2025-01-01','qa','qa')`
  sql(`BEGIN;
    INSERT INTO hrms.departments(id,tenant_id,company_id,name,code,is_active,created_by,updated_by) VALUES
      ('${DEPT}','${tenant}','${company}','QA Import ${tag}','QI${tag}',true,'qa','qa'),
      ('${OTHER_DEPT}','${tenant}','${company}','QA Import other ${tag}','QO${tag}',true,'qa','qa');
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,
      department_id,date_of_joining,created_by,updated_by) VALUES
      ${emp('M1', DEPT)}, ${emp('M2', DEPT)}, ${emp('O', OTHER_DEPT)};
    INSERT INTO attendance.shift_policies(id,tenant_id,company_id,name,code,shift_type,start_time,end_time) VALUES
      ('${DAY}','${tenant}','${company}','QA Import day ${tag}','${D}','FIXED','09:00','17:00'),
      ('${NIGHT}','${tenant}','${company}','QA Import night ${tag}','${N}','NIGHT','22:00','06:00');
    COMMIT;`)
}

// The S13 layout as CSV: a title row, the header, the weekday row, then people.
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
function csv(rows, extraDate = null) {
  const days = extraDate ? [...dates, extraDate] : dates
  const lines = [`Roster — QA ${tag}`,
    ['Employee', 'Employee code', 'Department', 'Designation', 'Building', ...days.map(header), 'Working days', 'WO', 'PH', 'L', 'COFF'].join(','),
    ['', '', '', '', '', ...days.map((d) => LETTERS[new Date(d + 'T00:00:00Z').getUTCDay()])].join(',')]
  for (const r of rows) lines.push([r.name, r.code ?? '', r.dept ?? '', '', '', ...days.map((_, i) => r.codes[i] ?? '')].join(','))
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')
}
const good = [
  { name: NAME.M1, code: CODE.M1, dept: `QA Import ${tag}`, codes: [D, D, N, N, 'WO', D.toLowerCase(), D, N, N, 'WO'] },
  { name: NAME.M2, code: CODE.M2, dept: `QA Import ${tag}`, codes: [N, 'WO', D, D, N, N, 'WO', D, D, 'W/O'] },
]
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString()
const scope = (over = {}) => q({ companyId: company, startDate: start, endDate: end, departmentId: DEPT, ...over })

async function main(owner) {
  insertFixtures()
  const head = await session('mgr@unifiedtree.demo')
  sql(`UPDATE hrms.departments SET department_head_employee_id='${head.employeeId}' WHERE id='${DEPT}'`)
  const reader = await session('reader@unifiedtree.demo')

  // ── template ──────────────────────────────────────────────────────────────
  const t = await owner.raw(`/v1/rosters/import/template?${scope()}`)
  const strings = t.status === 200 ? xlsxStrings(t.buf) : []
  check('template: 200, an Excel workbook (a zip)', t.status === 200 && t.type.includes('spreadsheetml') && t.buf.subarray(0, 2).toString() === 'PK', `${t.status} ${t.type}`)
  check('template: the S13 headers', ['Employee', 'Employee code', 'Department', 'Designation', 'Building', 'Working days', 'WO', 'PH', 'L', 'COFF', header(start), header(end)]
    .every((h) => strings.includes(h)), strings.slice(0, 20).join('|'))
  check('template: the department\'s people, nobody from elsewhere', strings.includes(`${NAME.M1.split(' ')[0]} ${tag}`) && strings.includes(CODE.M2) && !strings.includes(CODE.O))
  check('template: the codes sheet lists the shifts and WO, PH, L, COFF', strings.includes(D) && strings.includes(N) && strings.includes('COFF'))

  // ── validate a file with planted problems ─────────────────────────────────
  const outside = addDays(end, 1)
  // PH goes on a day the company has no holiday (the demo calendar may have some in this window).
  const holidays = new Set((sql(`select string_agg(holiday_date::text, ',') from settings.holiday_calendar where tenant_id='${tenant}'
    and company_id='${company}' and is_active and holiday_date between '${start}' and '${end}'`) || '').split(',').filter(Boolean))
  const ph = Math.max(3, dates.findIndex((d, i) => i >= 3 && !holidays.has(d)))
  const m2bad = [N, 'ZZ', 'L', D, D, N, D, 'WO', D, D]
  m2bad[ph] = 'PH'
  const bad = csv([
    { ...good[0], codes: [...good[0].codes, D] },                                            // row 4: a code on the day after the period
    { name: NAME.M2, code: CODE.M2, codes: m2bad },                                          // row 5: unknown code, L with no leave, PH with no holiday
    { name: `Nobody ${tag}`, codes: [D] },                                                   // row 6: not found
    { name: NAME.M1, code: CODE.M1, codes: [D] },                                            // row 7: the same person twice
    { name: NAME.O, code: CODE.O, codes: [D] },                                              // row 8: outside the department
  ], outside)
  const v1 = await owner.upload(`/v1/rosters/import/validate?${scope()}`, `qa-${tag}.csv`, bad, 'text/csv')
  const probs = v1.json?.problems ?? []
  const has = (code, sev, row) => probs.some((p) => p.code === code && p.severity === sev && (row === undefined || p.rowNo === row))
  check('validate: 200 with the summary', v1.status === 200 && v1.json?.summary?.rows === 5 && v1.json.summary.matched === 2, `${v1.status} ${JSON.stringify(v1.json?.summary)}`)
  check('validate: the header row and the period', v1.json?.headerRow === 2 && v1.json?.startDate === start && v1.json?.endDate === end)
  check('validate: unknown code is an error on its row, column and date',
    probs.some((p) => p.code === 'UNKNOWN_CODE' && p.severity === 'error' && p.rowNo === 5 && p.column === 'G' && p.date === dates[1]), JSON.stringify(probs.filter((p) => p.code === 'UNKNOWN_CODE')))
  check('validate: someone not found is an error', has('NOT_FOUND', 'error', 6))
  check('validate: the same person twice is an error', has('DUPLICATE_ROW', 'error', 7))
  check('validate: someone outside the department is an error (E2)', has('E2', 'error', 8))
  check('validate: a code on a day outside the period is an error', probs.some((p) => p.code === 'DAY_OUTSIDE_PERIOD' && p.severity === 'error' && p.rowNo === 4 && p.column === 'P'))
  check('validate: L with no approved leave is a warning', has('NO_LEAVE', 'warning', 5))
  check('validate: PH with no holiday is a warning', has('NO_HOLIDAY', 'warning'))
  check('validate: the planner\'s preview of the people found', v1.json?.plan?.rows?.length === 2 && v1.json.plan.checks && v1.json.plan.coverage)
  check('validate: wrote nothing', num(`select count(*) from attendance.rosters where tenant_id='${tenant}' and name ~ '${tag}'`) === 0)

  const a1 = await owner.upload(`/v1/rosters/import/apply?${scope({ name: `QA Import ${tag}` })}`, `qa-${tag}.csv`, bad, 'text/csv')
  check('apply: refused while the file has errors (400 IMPORT_FILE_INVALID)', a1.status === 400 && a1.json?.errorCode === 'IMPORT_FILE_INVALID', `${a1.status} ${JSON.stringify(a1.json)}`)
  check('apply: nothing saved after the refusal', num(`select count(*) from attendance.rosters where tenant_id='${tenant}' and name ~ '${tag}'`) === 0)

  // ── the fixed file: a draft ───────────────────────────────────────────────
  const fixed = csv(good)
  const v2 = await owner.upload(`/v1/rosters/import/validate?${scope()}`, `qa-${tag}-fixed.csv`, fixed, 'text/csv')
  check('validate (fixed): no errors, both people matched by code', v2.status === 200 && v2.json?.summary?.errors === 0 && v2.json.summary.matched === 2
    && v2.json.rows.every((r) => r.matchedBy === 'CODE'), `${v2.status} ${JSON.stringify(v2.json?.summary)} ${JSON.stringify((v2.json?.problems ?? []).slice(0, 3))}`)
  const a2 = await owner.upload(`/v1/rosters/import/apply?${scope({ name: `QA Import ${tag}` })}`, `qa-${tag}-fixed.csv`, fixed, 'text/csv')
  const id = a2.json?.roster?.id
  check('apply: 201, a DRAFT from the import', a2.status === 201 && a2.json?.roster?.status === 'DRAFT' && a2.json.roster.source === 'IMPORT' && a2.json.roster.version === 0,
    `${a2.status} ${JSON.stringify(a2.json?.roster ?? a2.json)}`)
  const cells = id ? num(`select count(*) from attendance.roster_cells where roster_id='${id}'`) : -1
  check('apply: every code of the file is a day of the draft', cells === 20, `cells=${cells}`)
  check('apply: the members in the file\'s order', id && sql(`select string_agg(employee_id::text, ',' order by sort_order) from attendance.roster_members where roster_id='${id}'`) === `${M1},${M2}`)
  check('apply: the draft is not published (no schedule days)', id && num(`select count(*) from attendance.schedule_days where roster_id='${id}'`) === 0)
  check('apply: weekly offs as the file says (CUSTOM), no pattern', id && sql(`select config->>'weeklyOffMode' || '|' || jsonb_array_length(config->'pattern') from attendance.rosters where id='${id}'`) === 'CUSTOM|0')

  // ── export and round trip ─────────────────────────────────────────────────
  const ex = id ? await owner.raw(`/v1/rosters/${id}/export?published=false`) : { status: 0, buf: Buffer.alloc(0), type: '' }
  check('export: 200, an Excel workbook', ex.status === 200 && ex.type.includes('spreadsheetml') && ex.buf.subarray(0, 2).toString() === 'PK', `${ex.status}`)
  const v3 = await owner.upload(`/v1/rosters/import/validate?${scope({ rosterId: id })}`, 'export.xlsx', ex.buf, XLSX)
  const codesOf = (val) => (val?.rows ?? []).map((r) => r.codes.map((c) => (c ?? '').toUpperCase().replace('W/O', 'WO')).join(' '))
  check('export: imports again with no errors or warnings', v3.status === 200 && v3.json?.summary?.errors === 0 && v3.json.summary.warnings === 0 && v3.json.summary.matched === 2,
    `${v3.status} ${JSON.stringify(v3.json?.summary)} ${JSON.stringify((v3.json?.problems ?? []).slice(0, 3))}`)
  check('export: the same codes as the file that made it (round trip)', JSON.stringify(codesOf(v3.json)) === JSON.stringify(codesOf(v2.json)), `${codesOf(v3.json)} vs ${codesOf(v2.json)}`)

  // ── replace the draft's days ──────────────────────────────────────────────
  const lock = a2.json?.roster?.lockVersion
  const r1 = await owner.upload(`/v1/rosters/import/apply?${scope({ rosterId: id, lockVersion: lock })}`, 'export.xlsx', ex.buf, XLSX)
  check('replace: 200, the same draft, saved again', r1.status === 200 && r1.json?.roster?.id === id && r1.json.roster.lockVersion > lock && r1.json.roster.name === `QA Import ${tag}`,
    `${r1.status} ${JSON.stringify(r1.json?.roster ?? r1.json)}`)
  const stale = await owner.upload(`/v1/rosters/import/apply?${scope({ rosterId: id, lockVersion: lock })}`, 'export.xlsx', ex.buf, XLSX)
  check('replace: a stale lock is 409 ROSTER_CHANGED', stale.status === 409 && stale.json?.errorCode === 'ROSTER_CHANGED', `${stale.status} ${stale.json?.errorCode}`)
  if (id) sql(`UPDATE attendance.rosters SET status='PUBLISHED', version=1 WHERE id='${id}'`)
  const pub = await owner.upload(`/v1/rosters/import/apply?${scope({ rosterId: id, lockVersion: r1.json?.roster?.lockVersion })}`, 'export.xlsx', ex.buf, XLSX)
  check('replace: a published roster is never replaced (409 ROSTER_PUBLISHED)', pub.status === 409 && pub.json?.errorCode === 'ROSTER_PUBLISHED', `${pub.status} ${pub.json?.errorCode}`)

  // ── a department head and an employee ─────────────────────────────────────
  const ht = await head.raw(`/v1/rosters/import/template?${scope()}`)
  check('department head: the template of their department', ht.status === 200 && ht.type.includes('spreadsheetml'), `${ht.status}`)
  const hv = await head.upload(`/v1/rosters/import/validate?${scope({ departmentId: OTHER_DEPT })}`, 'x.csv', fixed, 'text/csv')
  check('department head: another department is refused (403 ROSTER_SCOPE)', hv.status === 403 && hv.json?.errorCode === 'ROSTER_SCOPE', `${hv.status} ${hv.json?.errorCode}`)
  const rt = await reader.raw(`/v1/rosters/import/template?${scope()}`)
  const rv = await reader.upload(`/v1/rosters/import/validate?${scope()}`, 'x.csv', fixed, 'text/csv')
  const re = id ? await reader.raw(`/v1/rosters/${id}/export`) : { status: 403 }
  check('employee: no template, check or export (403)', rt.status === 403 && rv.status === 403 && re.status === 403, `${rt.status} ${rv.status} ${re.status}`)

  await ui()
}

// ── the web page ────────────────────────────────────────────────────────────
function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (!u.includes('/api/') || r.status() < 400) return
    failed.push(`${label}: ${r.status()} ${new URL(u).pathname}`)
  })
  return { errors, failed }
}
async function signIn(page, who) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 180_000 })   // a cold vite compiles on the first load
  await page.locator('input[type=email]').fill(who)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
/** Closes whatever opened by itself over the page (a punch reminder, a welcome card). */
async function dismissPopups(page) {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1200)
    const layer = page.locator('.uko-layer')
    if (!(await layer.count()) || !(await layer.first().isVisible().catch(() => false))) return
    await page.keyboard.press('Escape').catch(() => {})
  }
}
const visible = (locator, timeout = 60_000) => locator.waitFor({ timeout }).then(() => true, () => false)

/**
 * A cold dev server compiles every module on its first request, which on this machine can take longer than a page
 * load waits. Fetch the app's static module graph (and the import page's) once from Node first, on 127.0.0.1 (Node
 * can't resolve demo.localhost), so the browser then gets compiled modules. Bounded; it says what was slowest.
 */
async function warmUp() {
  const origin = base.replace('demo.localhost', '127.0.0.1')
  const seen = new Set(), queue = ['/', '/src/main.tsx', '/src/modules/hrms/attendance/planner/import/RosterImportPage.tsx']
  const t0 = Date.now()
  let slowest = { url: '', ms: 0 }
  const spec = /(?:\bfrom\s*|\bimport\s*)["'](\/[^"']+)["']/g
  while (queue.length && Date.now() - t0 < 240_000) {
    await Promise.all(queue.splice(0, 8).map(async (u) => {
      if (seen.has(u)) return
      seen.add(u)
      const s = Date.now()
      try {
        const text = await (await fetch(origin + u)).text()
        for (const m of text.matchAll(spec)) if (!seen.has(m[1])) queue.push(m[1])
      } catch { /* the browser will say */ }
      if (Date.now() - s > slowest.ms) slowest = { url: u, ms: Date.now() - s }
    }))
  }
  console.log(`warm-up: ${seen.size} modules in ${Math.round((Date.now() - t0) / 1000)} s, ${queue.length} left; slowest ${slowest.url} (${slowest.ms} ms)`)
}

async function ui() {
  mkdirSync(SHOTS, { recursive: true })
  await warmUp()
  // The page opens on next month (India time); a sheet for that month with day numbers 01 … 31.
  const [y, m] = istToday().split('-').map(Number)
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  const first = `${ny}-${String(nm).padStart(2, '0')}-01`
  const len = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const cycle = [D, D, N, N, 'WO']
  const lines = [`Roster — QA ${tag}`, ['Employee', 'Employee code', 'Department', 'Designation', 'Building',
    ...Array.from({ length: len }, (_, i) => String(i + 1).padStart(2, '0')), 'Working days', 'WO', 'PH', 'L', 'COFF'].join(',')]
  for (const [k, off] of [['M1', 0], ['M2', 2]]) {
    lines.push([NAME[k], CODE[k], `QA Import ${tag}`, '', '', ...Array.from({ length: len }, (_, i) => cycle[(i + off) % cycle.length])].join(','))
  }
  const sheet = Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')

  const browser = await chromium.launch()
  const watched = []
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    watched.push(watch(page, 'desktop'))
    await signIn(page, 'owner@unifiedtree.demo')
    await page.goto(base + '/hrms/shifts/planner/import', { waitUntil: 'domcontentloaded', timeout: 180_000 })
    check('web: the import page opens for the owner', await visible(page.getByRole('heading', { name: 'Import a roster from Excel' })))
    await dismissPopups(page)
    await page.getByLabel('Department').selectOption({ label: `QA Import ${tag}` })
    await page.locator('input[type=file]').setInputFiles({ name: `qa-${tag}-month.csv`, mimeType: 'text/csv', buffer: sheet })
    await page.screenshot({ path: `${SHOTS}/shift-p1-import-1-import-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'Check the file' }).click()
    check('web: the check finds both people and no errors', await visible(page.getByRole('button', { name: 'See the preview' })))
    await page.screenshot({ path: `${SHOTS}/shift-p1-import-2-validate-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'See the preview' }).click()
    const grid = page.getByRole('region', { name: 'Roster preview' })
    check('web: the preview shows the roster', await visible(grid) && (await grid.locator('tbody tr').count()) === 2)
    await page.screenshot({ path: `${SHOTS}/shift-p1-import-3-preview-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create draft roster' }).waitFor({ timeout: 10_000 })
    await page.screenshot({ path: `${SHOTS}/shift-p1-import-4-apply-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'Create draft roster' }).click()
    let saved = 0
    for (let i = 0; i < 30 && !saved; i++) {
      await page.waitForTimeout(500)
      saved = num(`select count(*) from attendance.rosters where tenant_id='${tenant}' and start_date='${first}' and name ~ '${tag}' and status='DRAFT' and source='IMPORT'`)
    }
    check('web: Create draft roster saves the draft and opens it in the planner', saved === 1
      && await page.waitForURL(/\/hrms\/shifts\/planner\/[0-9a-f-]{36}/, { timeout: 15_000 }).then(() => true, () => false), page.url())

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const pp = await phone.newPage()
    watched.push(watch(pp, 'phone'))
    await signIn(pp, 'owner@unifiedtree.demo')
    const overflow = () => pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const openOnPhone = async () => {
      await pp.goto(base + '/hrms/shifts/planner/import', { waitUntil: 'domcontentloaded', timeout: 180_000 })
      const ok = await visible(pp.getByRole('heading', { name: 'Import a roster from Excel' }))
      await dismissPopups(pp)
      await pp.getByLabel('Department').selectOption({ label: `QA Import ${tag}` })
      return ok
    }
    // a sheet with planted errors: the problems at phone width
    const withErrors = Buffer.from([...lines, [`Nobody ${tag}`, '', '', '', '', D].join(','), [NAME.M1, CODE.M1, '', '', '', 'ZZ'].join(',')]
      .join('\r\n') + '\r\n', 'utf8')
    check('web (390 wide): the import page opens', await openOnPhone())
    const o1 = await overflow()
    check('web (390 wide): step 1 has no sideways scroll', o1 <= 1, `overflow=${o1}px`)
    await pp.screenshot({ path: `${SHOTS}/shift-p1-import-1-import-phone.png`, fullPage: true })
    await pp.locator('input[type=file]').setInputFiles({ name: `qa-${tag}-errors.csv`, mimeType: 'text/csv', buffer: withErrors })
    await pp.getByRole('button', { name: 'Check the file' }).click()
    check('web (390 wide): a file with errors lists them and offers no preview', await visible(pp.getByRole('button', { name: 'Upload a fixed file' }))
      && (await pp.getByRole('button', { name: 'See the preview' }).count()) === 0)
    const o2 = await overflow()
    check('web (390 wide): the problems have no sideways scroll', o2 <= 1, `overflow=${o2}px`)
    await pp.screenshot({ path: `${SHOTS}/shift-p1-import-2-validate-phone.png`, fullPage: true })
    // the clean sheet: the preview at phone width
    await openOnPhone()
    await pp.locator('input[type=file]').setInputFiles({ name: `qa-${tag}-month.csv`, mimeType: 'text/csv', buffer: sheet })
    await pp.getByRole('button', { name: 'Check the file' }).click()
    await visible(pp.getByRole('button', { name: 'See the preview' }))
    await pp.getByRole('button', { name: 'See the preview' }).click()
    await visible(pp.getByRole('region', { name: 'Roster preview' }))
    const o3 = await overflow()
    check('web (390 wide): the preview scrolls inside its box, not the page', o3 <= 1, `overflow=${o3}px`)
    await pp.screenshot({ path: `${SHOTS}/shift-p1-import-3-preview-phone.png`, fullPage: true })
  } finally {
    await browser.close()
  }
  const errors = watched.flatMap((w) => w.errors), failedCalls = watched.flatMap((w) => w.failed)
  check('web: no page errors', errors.length === 0, errors.slice(0, 3).join(' || '))
  check('web: no API 4xx/5xx', failedCalls.length === 0, failedCalls.slice(0, 5).join(' || '))
}

function cleanup() {
  const run = (what, s) => { try { sql(s) } catch (e) { console.log(`cleanup ${what}: ${String(e.message).split('\n')[0]}`) } }
  const ppl = everyone.map((x) => `'${x}'`).join(',')
  run('rosters', `BEGIN; DELETE FROM attendance.schedule_day_history WHERE employee_id IN (${ppl});
    DELETE FROM attendance.schedule_days WHERE employee_id IN (${ppl});
    DELETE FROM attendance.rosters WHERE tenant_id='${tenant}' AND name ~ '${tag}'; COMMIT;`)
  run('people', `BEGIN; UPDATE hrms.departments SET department_head_employee_id=NULL WHERE id='${DEPT}';
    DELETE FROM hrms.employee_status_history WHERE employee_id IN (${ppl}); DELETE FROM hrms.employees WHERE id IN (${ppl});
    DELETE FROM hrms.departments WHERE id IN ('${DEPT}','${OTHER_DEPT}');
    DELETE FROM attendance.shift_policies WHERE id IN ('${DAY}','${NIGHT}'); COMMIT;`)
  const left = num(`select count(*) from hrms.employees where id in (${ppl})`) + num(`select count(*) from hrms.departments where id in ('${DEPT}','${OTHER_DEPT}')`)
    + num(`select count(*) from attendance.rosters where tenant_id='${tenant}' and name ~ '${tag}'`)
    + num(`select count(*) from attendance.roster_members where employee_id in (${ppl})`)
    + num(`select count(*) from attendance.shift_policies where id in ('${DAY}','${NIGHT}')`)
  check('cleanup: nothing the test made is left behind', left === 0, `left=${left}`)
}

let owner = null
try {
  owner = await session('owner@unifiedtree.demo')
  await main(owner)
} catch (e) {
  check('script completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  cleanup()
}
check('no unexpected 5xx', surprises.length === 0, surprises.slice(0, 5).join(' || '))
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
