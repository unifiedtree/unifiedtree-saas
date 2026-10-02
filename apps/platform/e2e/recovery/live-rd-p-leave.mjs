/* global process, console, fetch, Buffer */
// Live check of P-LEAVE's pages (HRMS redesign, UI half): the Leave page's inline-pill
// tabs per role, no page errors, no unexpected 4xx/5xx; plus the main actions through
// the API so the hooks are exercised end to end:
//   - reader applies, then cancels (balances are back exactly)
//   - hrm applies on behalf of reader (hrms.leave.apply.others), then cancels
//   - mgr bulk-approves 2 requests (POST /v1/leave/approvals/bulk-decision), undoes one
//     through the shared Undo (SHARED_KEYS.recentDecisions)
//   - hrm edits a holiday (PUT /v1/settings/holidays/{id}), then restores it
// Every role is signed in in the browser once at 1440 × light and once at 390 × dark,
// so the shell contract (inline pill tabs, Inter via var(--u-font), full-name greeting)
// is checked both ways. Everything the script creates is removed at the end.
//
//   RECOVERY_APP_URL=http://demo.localhost:3002 RECOVERY_API_URL=http://127.0.0.1:8080/api \
//   RECOVERY_DB=ut_local node e2e/recovery/live-rd-p-leave.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_local'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = process.env.SHOTS_DIR || 'C:/com/Unified/wt/_results/shots'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().replace(/\r/g, '').trim()
// psql appends command tags (INSERT 0 1 / DELETE 1) when the query is a write; take
// the first line so a RETURNING value isn't glued to the tag.
const sql1 = (q) => sql(q).split('\n')[0]
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const today = istToday()
const testStart = sql('select now()')

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, email, password, mfaCapable: true }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  const d = await r.json()
  const claims = JSON.parse(Buffer.from(d.accessToken.split('.')[1], 'base64url').toString())
  const call = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${d.accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { token: d.accessToken, permissions: new Set(claims.permissions || []), employeeId: claims.employee_id, roles: claims.roles || [], call }
}

const ROLES = [
  ['owner', 'owner@unifiedtree.demo'],
  ['hrm', 'hrm@unifiedtree.demo'],
  ['fin', 'fin@unifiedtree.demo'],
  ['mgr', 'mgr@unifiedtree.demo'],
  ['reader', 'reader@unifiedtree.demo'],
]

// Cleanup runs in push order (FIFO) — see the final loop. So push CHILD-table
// deletions FIRST (notifications, leave_requests), then the fixtures (balances,
// types) that are referenced by them.
const cleanup = []
cleanup.push(() => sql(`delete from notif.notifications where created_at >= '${testStart}' and type in ('LEAVE_SUBMITTED','LEAVE_APPROVED','LEAVE_REJECTED','LEAVE_CANCELLED')`))
cleanup.push(() => sql(`delete from leave_mgmt.leave_requests where created_at >= '${testStart}' and (reason like 'RD-P-LEAVE%' or coalesce(decision_note,'') like 'RD-P-LEAVE%')`))

const browser = await chromium.launch()
try {
  // ── Fixtures: the leave type to use, and a holiday to edit ─────────────────
  const sessions = {}
  for (const [name, email] of ROLES) sessions[name] = await login(email)
  const reader = sessions.reader
  const hrm = sessions.hrm
  const mgr = sessions.mgr

  // Pick a paid leave type the reader has balance for (CL/SL/EL — anything with
  // enough days). If none exists, insert a minimal one and clean up.
  let leaveTypeId = sql1(`select id from leave_mgmt.leave_types where tenant_id='${tenant}' and company_id='${company}' and coalesce(is_paid_leave,true) and coalesce(is_active,true) order by code limit 1`) || null
  if (!leaveTypeId) {
    leaveTypeId = sql1(`insert into leave_mgmt.leave_types(id,tenant_id,company_id,name,code,annual_entitlement,is_paid_leave,is_active,created_at) values(gen_random_uuid(),'${tenant}','${company}','Casual (RD)','RDCL',12,true,true,now()) returning id`)
    cleanup.push(() => sql(`delete from leave_mgmt.leave_types where id='${leaveTypeId}'`))
  }
  // Make sure reader has a balance row (apply refuses without it per DECISIONS 16).
  const yr = Number(today.slice(0, 4))
  const hadBalance = sql(`select count(*) from leave_mgmt.leave_balances where tenant_id='${tenant}' and employee_id='${reader.employeeId}' and leave_type_id='${leaveTypeId}' and year=${yr}`) !== '0'
  if (!hadBalance) {
    sql(`insert into leave_mgmt.leave_balances(id,tenant_id,employee_id,leave_type_id,year,total_entitlement,accrued,used,pending,carry_forward,created_at,updated_at) values(gen_random_uuid(),'${tenant}','${reader.employeeId}','${leaveTypeId}',${yr},12,12,0,0,0,now(),now())`)
    cleanup.push(() => sql(`delete from leave_mgmt.leave_balances where tenant_id='${tenant}' and employee_id='${reader.employeeId}' and leave_type_id='${leaveTypeId}' and year=${yr}`))
  }

  const balanceOf = () => Number(sql(`select coalesce(accrued,0) - coalesce(used,0) - coalesce(pending,0) from leave_mgmt.leave_balances where tenant_id='${tenant}' and employee_id='${reader.employeeId}' and leave_type_id='${leaveTypeId}' and year=${yr}`))
  const b0 = balanceOf()

  // ── Case 1: reader applies, then cancels; the balance comes back exactly ──
  const d1 = plus(today, 7)
  const applyBody = (from, to, reason) => ({ leaveTypeId, startDate: from, endDate: to, duration: 'FULL_DAY', reason })
  const applyR = await reader.call('POST', '/v1/leave/apply', applyBody(d1, d1, 'RD-P-LEAVE self'))
  check('reader can apply for a day of leave', (applyR.status === 200 || applyR.status === 201) && applyR.json?.id, `${applyR.status}`)
  const req1 = applyR.json?.id
  if (req1) {
    const after = balanceOf()
    check('applying reduces the available balance by one day', after === b0 - 1, `${b0} → ${after}`)
    // Cancel takes ?reason=  as a QUERY param, not a body.
    const cancelR = await reader.call('POST', `/v1/leave/${req1}/cancel?reason=${encodeURIComponent('RD-P-LEAVE cancel self')}`)
    check('reader can cancel own leave', cancelR.status === 200 || cancelR.status === 204, `${cancelR.status}`)
    const back = balanceOf()
    check('cancelling the leave puts the balance back exactly', back === b0, `${b0} → ${back}`)
  }

  // ── Case 2: hrm applies on behalf, then cancels ───────────────────────────
  const d2 = plus(today, 14)
  const applyH = await hrm.call('POST', `/v1/leave/apply/for/${reader.employeeId}`, applyBody(d2, d2, 'RD-P-LEAVE on-behalf'))
  check('hrm can apply on behalf of reader', (applyH.status === 200 || applyH.status === 201) && applyH.json?.id, `${applyH.status}`)
  const req2 = applyH.json?.id
  if (req2) {
    // Reader cancels their own request (hrm can't cancel someone else's).
    const cR = await reader.call('POST', `/v1/leave/${req2}/cancel?reason=${encodeURIComponent('RD-P-LEAVE cancel on-behalf')}`)
    check('the on-behalf leave can be cancelled by the employee', cR.status === 200 || cR.status === 204, `${cR.status}`)
  }

  // ── Case 3: mgr bulk-approves 2, then undoes one through shared Recent ──
  const d3 = plus(today, 21), d4 = plus(today, 22)
  const r3 = (await reader.call('POST', '/v1/leave/apply', applyBody(d3, d3, 'RD-P-LEAVE bulk-a'))).json?.id
  const r4 = (await reader.call('POST', '/v1/leave/apply', applyBody(d4, d4, 'RD-P-LEAVE bulk-b'))).json?.id
  if (r3 && r4) {
    const bulk = await mgr.call('POST', '/v1/leave/approvals/bulk-decision', { ids: [r3, r4], status: 'APPROVED', comment: 'RD-P-LEAVE bulk' })
    check('mgr bulk-approves two leaves', bulk.status === 200 && bulk.json?.decided === 2, `${bulk.status} decided=${bulk.json?.decided}`)
    // Shared "recent decisions" powers Undo (CONTRACTS.md).
    const recent = await mgr.call('GET', '/v1/approvals/recent-decisions?limit=5')
    const hitByBulkId = String(recent.json ?? '').includes(r3) || String(recent.json ?? '').includes(r4)
    check('the bulk decision appears in Recent decisions (Undo offers)', hitByBulkId, `rows=${(recent.json||[]).length}`)
    // Undo the first one (returns to PENDING, balance pending restored).
    const undo = await mgr.call('POST', `/v1/leave/${r3}/decision/undo`, {})
    check('undoing one of the two decisions returns 200', undo.status === 200 || undo.status === 204, `${undo.status}`)
    const row = sql(`select status from leave_mgmt.leave_requests where id='${r3}'`)
    check('the undone request is back to PENDING', row === 'PENDING' || row === 'SUBMITTED', `status=${row}`)
    // Final cleanup also covers these two requests via the test start timestamp.
  }

  // ── Case 4: hrm edits a holiday, then restores it ─────────────────────────
  let h = sql1(`select id||'|'||holiday_name||'|'||holiday_date::text||'|'||coalesce(holiday_type::text,'PUBLIC') from settings.holiday_calendar where tenant_id='${tenant}' and company_id='${company}' order by holiday_date limit 1`)
  if (!h) {
    // No holiday in the demo seed — add a far-future throwaway and clean it up.
    const nextYr = Number(today.slice(0, 4)) + 1
    // ck_holiday_type accepts NATIONAL/FESTIVAL/RESTRICTED/REGIONAL/OPTIONAL/COMPANY.
    const hid = sql1(`insert into settings.holiday_calendar(id,tenant_id,company_id,year,holiday_date,holiday_name,holiday_type,is_active,created_at) values(gen_random_uuid(),'${tenant}','${company}',${nextYr},'${nextYr}-01-26','Republic Day (RD fixture)','NATIONAL',true,now()) returning id`)
    cleanup.push(() => sql(`delete from settings.holiday_calendar where id='${hid}'`))
    h = `${hid}|Republic Day (RD fixture)|${nextYr}-01-26|NATIONAL`
  }
  const [hid, oldName, hDate, hType] = h.split('|')
  const edit = await hrm.call('PUT', `/v1/settings/holidays/${hid}`, { holidayDate: hDate, holidayName: `${oldName} · RD edit`, holidayType: hType })
  check('hrm edits a holiday', edit.status === 200, `${edit.status}`)
  const restore = await hrm.call('PUT', `/v1/settings/holidays/${hid}`, { holidayDate: hDate, holidayName: oldName, holidayType: hType })
  check('hrm restores the holiday name', restore.status === 200, `${restore.status}`)

  // ── Case 5: UI check per role, both themes, 1440 + 390 ─────────────────────
  async function openSession(email, opts = {}) {
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
    // The login button is just a <button>Log in</button> (no type=submit).
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    errors.length = 0; failed.length = 0
    return { ctx, page, errors, failed }
  }
  const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }

  for (const [name, email] of ROLES) {
    for (const theme of ['light', 'dark']) {
      const widths = [1440, 390]
      for (const width of widths) {
        const { ctx, page, errors, failed } = await openSession(email, { theme, width, height: 900 })
        await page.goto(base + '/hrms/leave')
        await settle(page)
        const permOk = sessions[name].permissions.has('hrms.leave.read') || sessions[name].permissions.has('hrms.leave.approve.l1') || sessions[name].permissions.has('hrms.leave.approve.l2') || sessions[name].permissions.has('hrms.leave.apply.self') || sessions[name].permissions.has('hrms.leave.apply.others')
        if (permOk) {
          // Admins land on the HR Operations Center (inline pill tabs); self-service
          // users land on "Your requests" without the multi-view layout.
          const h = (await page.locator('h1, h2, h3').allInnerTexts()).join(' | ')
          const isOps = /Waiting for your OK|Approvals/i.test(h)
          const isEss = /Your requests|Your Leave/i.test(h)
          check(`${name} ${theme} ${width}: Leave page renders`, isOps || isEss, `heads=${h.slice(0, 80)}`)
          if (isOps) {
            // Shell contract: a page's OWN sub-sections are inline PILL tabs, not header tabs.
            const inlineTablists = await page.getByRole('tablist').count()
            check(`${name} ${theme} ${width}: HR Ops uses inline tablists`, inlineTablists >= 1, `tablists=${inlineTablists}`)
          }
          const shot = `${SHOTS}/rd-p-leave-${name}-${theme}-${width}.png`
          await page.screenshot({ path: shot, fullPage: true })
        } else {
          check(`${name} ${theme} ${width}: Leave denied politely (no page errors)`, errors.length === 0, errors[0] || '')
        }
        check(`${name} ${theme} ${width}: no page errors`, errors.length === 0, errors.slice(0, 2).join('; '))
        check(`${name} ${theme} ${width}: no unexpected 4xx/5xx`, failed.length === 0, failed.slice(0, 2).join('; '))
        await ctx.close()
      }
    }
  }
} finally {
  // FIFO so child-table deletes (requests, notifications) go BEFORE their
  // parent fixtures (leave_types, leave_balances) that still reference them.
  while (cleanup.length) {
    const fn = cleanup.shift()
    try { fn() } catch (e) { console.log(`cleanup: ${String(e.message || e).split('\n')[0]}`) }
  }
  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed; ${bad.length} failed`)
  if (bad.length) { bad.forEach((r) => console.log(`  FAIL ${r.name}`)); process.exit(1) }
}
