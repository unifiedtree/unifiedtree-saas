/* global process, console, fetch, FormData, Blob, URL, window, document, location, MutationObserver */
// Live check of shift planning's pilot (owner, 11 Oct 2026: Phase 1 for TEST businesses only), for a business that
// is NOT on the list. Run it with the backend's default list (UNIFIEDTREE_ROSTER_PILOT_TENANTS unset), which does
// not name the local demo business ("demo"), so demo plays nclever here.
//
//   · API (owner, who holds both planner permissions): GET /v1/rosters/availability says {enabled: false}; every
//     shift-planning endpoint family answers 403 FEATURE_NOT_ENABLED: rotation patterns, roster settings, rosters
//     (list, create, read, save, delete, check, publish, discard, history), schedule me/team, the planner's people
//     and preview, and the Excel template, validate, apply and export. Nothing is written (the nine tables and the
//     roster notifications are counted before and after). An employee (reader@) is refused their schedule too and
//     still gets the availability answer. Shifts & overtime's own endpoints answer as before.
//   · Web (owner, 1440 and 390 wide): Shifts & overtime has no Shift Planner tab; ?tab=planner shows another tab;
//     /hrms/shifts/planner/new, /hrms/shifts/planner/import and /hrms/shifts/planner/<id> land on /hrms/shifts; no
//     planner text ever appears, not even for a moment (a DOM observer watches from before the first paint); the web
//     calls no shift-planning endpoint other than availability; no page errors.
// It creates nothing, so there is nothing to remove.
//
//   live-slot.sh /c/REACT/ut-wt/shift-int 3197 node e2e/recovery/live-w3-shift-p1-pilot.mjs
//   env: RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD,
//        RECOVERY_WARMUP_SECONDS (default 480: a cold vite compiles every module on its first request)
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3197'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = istToday()
const end = addDays(today, 13)

// ── sessions ────────────────────────────────────────────────────────────────
async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`)
  const d = await r.json()
  const auth = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }
  const call = async (path, method = 'GET', body) => {
    const form = body instanceof FormData
    const res = await fetch(api + path, { method, headers: form || body === undefined ? auth : { ...auth, 'Content-Type': 'application/json' }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call }
}

// ── what shift planning has stored for this business ────────────────────────
const TABLES = ['rotation_templates', 'rotation_template_days', 'rosters', 'roster_members', 'roster_staffing', 'roster_cells',
  'schedule_days', 'schedule_day_history', 'roster_settings']
const stored = () => sql(`SELECT ${TABLES.map((t) => `(SELECT count(*) FROM attendance.${t} WHERE tenant_id='${tenant}')`).join(" || ',' || ")}
  || ',' || (SELECT count(*) FROM notif.notifications WHERE tenant_id='${tenant}' AND type IN ('ROSTER_PUBLISHED','ROSTER_DAY_CHANGED'))`)

const sheet = () => {
  const f = new FormData()
  f.append('file', new Blob(['Employee,Employee code,01\r\nRavi Kumar,EMP001,A\r\n'], { type: 'text/csv' }), 'roster.csv')
  return f
}

async function apiChecks() {
  const owner = await session('owner@unifiedtree.demo')
  const reader = await session('reader@unifiedtree.demo')

  const av = await owner.call('/v1/rosters/availability')
  check('availability: 200 {enabled: false} for a business not on the pilot list', av.status === 200 && av.json?.enabled === false, `${av.status} ${JSON.stringify(av.json)}`)
  if (av.json?.enabled === true) {
    check('this run uses the default pilot list (demo not on it)', false, 'demo is on the list here: run with UNIFIEDTREE_ROSTER_PILOT_TENANTS unset')
    return
  }
  const before = stored()
  const id = randomUUID()
  const config = { templateId: null, pattern: [{ shiftPolicyId: null, weeklyOff: true }], repeats: true, weeklyOffMode: 'ROTATIONAL', staggerMode: 'SPREAD', continueFromRosterId: null, shiftIds: [], designationIds: [] }
  const draft = { name: `QA pilot ${id.slice(0, 6)}`, periodType: 'RANGE', startDate: today, endDate: end, departmentId: null, branchId: null, config, members: [], staffing: [], rows: [] }
  const scope = `companyId=${company}&startDate=${today}&endDate=${end}`
  const calls = [
    ['patterns: list', () => owner.call(`/v1/rotation-templates?companyId=${company}`)],
    ['patterns: create', () => owner.call(`/v1/rotation-templates?companyId=${company}`, 'POST', { name: 'QA pilot', repeats: true, days: config.pattern })],
    ['patterns: replace', () => owner.call(`/v1/rotation-templates/${id}`, 'PUT', { name: 'QA pilot', repeats: true, days: config.pattern })],
    ['patterns: delete', () => owner.call(`/v1/rotation-templates/${id}`, 'DELETE')],
    ['settings: read', () => owner.call(`/v1/rosters/settings?companyId=${company}`)],
    ['settings: change', () => owner.call(`/v1/rosters/settings?companyId=${company}`, 'PUT', { minRestMinutes: 420 })],
    ['rosters: list', () => owner.call(`/v1/rosters?companyId=${company}`)],
    ['rosters: create a draft', () => owner.call(`/v1/rosters?companyId=${company}`, 'POST', draft)],
    ['rosters: read', () => owner.call(`/v1/rosters/${id}`)],
    ['rosters: save', () => owner.call(`/v1/rosters/${id}`, 'PUT', { ...draft, lockVersion: 0 })],
    ['rosters: delete', () => owner.call(`/v1/rosters/${id}`, 'DELETE')],
    ['rosters: check', () => owner.call(`/v1/rosters/${id}/check`)],
    ['rosters: publish', () => owner.call(`/v1/rosters/${id}/publish`, 'POST', { lockVersion: 0, acknowledgeWarnings: true })],
    ['rosters: discard changes', () => owner.call(`/v1/rosters/${id}/discard-changes`, 'POST', { lockVersion: 0 })],
    ['rosters: history', () => owner.call(`/v1/rosters/${id}/history`)],
    ['schedule: me', () => owner.call(`/v1/schedule/me?from=${today}&to=${end}`)],
    ['schedule: team', () => owner.call(`/v1/schedule/team?from=${today}&to=${end}`)],
    ['planner: people', () => owner.call(`/v1/rosters/people?companyId=${company}&from=${today}&to=${end}`)],
    ['planner: preview', () => owner.call(`/v1/rosters/preview?companyId=${company}`, 'POST', { startDate: today, endDate: end, departmentId: null, branchId: null, rosterId: null, config, members: [], staffing: [], rows: [], regenerate: true, keepEdits: true })],
    ['import: template', () => owner.call(`/v1/rosters/import/template?${scope}`)],
    ['import: validate', () => owner.call(`/v1/rosters/import/validate?${scope}`, 'POST', sheet())],
    ['import: apply', () => owner.call(`/v1/rosters/import/apply?${scope}&name=QA`, 'POST', sheet())],
    ['import: export', () => owner.call(`/v1/rosters/${id}/export?published=false`)],
    ['schedule: me (employee)', () => reader.call(`/v1/schedule/me?from=${today}&to=${end}`)],
  ]
  for (const [name, run] of calls) {
    const r = await run()
    check(`refused: ${name} → 403 FEATURE_NOT_ENABLED`, r.status === 403 && r.json?.errorCode === 'FEATURE_NOT_ENABLED', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
  }
  check('refused calls wrote nothing (the nine tables and roster notifications)', stored() === before, `${before} → ${stored()}`)
  const avReader = await reader.call('/v1/rosters/availability')
  check('availability answers an employee too: {enabled: false}', avReader.status === 200 && avReader.json?.enabled === false, `${avReader.status}`)
  const shifts = await owner.call(`/v1/shifts?companyId=${company}`)
  check('Shifts & overtime\'s own shift list answers as before (200)', shifts.status === 200 && Array.isArray(shifts.json), `${shifts.status}`)
  const team = await owner.call(`/v1/team/schedule?from=${today}&to=${today}&includeSelf=true`)
  check('the team schedule answers as before (200)', team.status === 200 && Array.isArray(team.json), `${team.status}`)
}

// ── web ─────────────────────────────────────────────────────────────────────
/**
 * A cold dev server compiles every module on its first request, which on this machine can take longer than a page
 * load waits. Fetch the app's static module graph (and the Shifts page's) once from Node first, on 127.0.0.1.
 */
async function warmUp() {
  const origin = base.replace('demo.localhost', '127.0.0.1')
  const seen = new Set(), queue = ['/', '/src/main.tsx', '/src/modules/hrms/attendance/ShiftsRoute.tsx']
  const t0 = Date.now()
  const spec = /(?:\bfrom\s*|\bimport\s*)["'](\/[^"']+)["']/g
  const budget = Number(process.env.RECOVERY_WARMUP_SECONDS || 480) * 1000
  while (queue.length && Date.now() - t0 < budget) {
    await Promise.all(queue.splice(0, 8).map(async (u) => {
      if (seen.has(u)) return
      seen.add(u)
      try {
        const text = await (await fetch(origin + u)).text()
        for (const m of text.matchAll(spec)) if (!seen.has(m[1])) queue.push(m[1])
      } catch { /* the browser will say */ }
    }))
  }
  console.log(`warm-up: ${seen.size} modules in ${Math.round((Date.now() - t0) / 1000)} s, ${queue.length} left`)
}

/** Watches every document from before its first paint for any text only the planner shows. */
function plannerTextWatcher() {
  const words = ['Shift Planner', 'Shift planner', 'Plan a roster', 'Import from Excel', 'Import a roster from Excel', 'Rotation patterns', 'Shift planning isn’t switched on yet']
  const seen = []
  window.__plannerSeen = seen
  // A control: the watcher must also see a word every one of these pages shows, or "nothing seen" proves nothing.
  window.__plannerWatchSawControl = false
  const look = () => {
    const text = document.body ? document.body.textContent || '' : ''
    if (text.includes('Shift Schedules')) window.__plannerWatchSawControl = true
    for (const w of words) {
      const what = `${w} @ ${location.pathname}${location.search}`
      if (text.includes(w) && !seen.includes(what)) seen.push(what)
    }
  }
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true })
}

async function webChecks() {
  mkdirSync(SHOTS, { recursive: true })
  await warmUp()
  const browser = await chromium.launch()
  try {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport })
      await ctx.addInitScript(plannerTextWatcher)
      const page = await ctx.newPage()
      const errors = [], planningCalls = [], seen = [], blind = []
      page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)))
      page.on('response', (r) => {
        const u = new URL(r.url())
        if (/\/api\/v1\/(rosters|rotation-templates|schedule)(\/|$)/.test(u.pathname) && !u.pathname.endsWith('/v1/rosters/availability')) planningCalls.push(`${r.status()} ${u.pathname}`)
      })
      const collect = async () => {
        const w = await page.evaluate(() => ({ seen: window.__plannerSeen || [], control: window.__plannerWatchSawControl === true }))
          .catch(() => ({ seen: [], control: false }))
        seen.push(...w.seen)
        if (!w.control) blind.push(new URL(page.url()).pathname)
      }

      await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 180_000 })
      await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
      await page.locator('input[type=password]').fill(password)
      await page.locator('button[type=submit]').click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120_000 })

      // Shifts & overtime: the other tabs, no Shift Planner
      const asked = page.waitForResponse((r) => r.url().includes('/v1/rosters/availability'), { timeout: 120_000 }).catch(() => null)
      await page.goto(base + '/hrms/shifts', { waitUntil: 'domcontentloaded', timeout: 180_000 })
      const tabs = page.getByRole('tab')
      const tabsShown = await tabs.filter({ hasText: 'Shift Schedules' }).first().waitFor({ timeout: 120_000 }).then(() => true, () => false)
      const av = await asked
      await page.waitForTimeout(2500)
      const labels = (await tabs.allInnerTexts()).map((t) => t.trim())
      check(`web ${label}: Shifts & overtime shows its tabs`, tabsShown, labels.join(' | '))
      check(`web ${label}: the web asked whether shift planning is on`, !!av && av.status() === 200, av ? `${av.status()}` : 'no request')
      check(`web ${label}: no Shift Planner tab`, tabsShown && !labels.some((t) => /Shift Planner/i.test(t)), labels.join(' | '))
      await page.screenshot({ path: `${SHOTS}/shift-p1-pilot-off-${label}.png`, animations: 'disabled' })
      await collect()

      // A link to the planner tab shows another tab
      await page.goto(base + '/hrms/shifts?tab=planner', { waitUntil: 'domcontentloaded', timeout: 180_000 })
      await page.getByRole('tab', { name: /Shift Schedules/ }).waitFor({ timeout: 120_000 }).catch(() => {})
      await page.waitForTimeout(2500)
      check(`web ${label}: ?tab=planner shows no planner`, !(await page.getByRole('button', { name: 'Plan a roster' }).count())
        && !(await page.getByRole('tab', { name: /Shift Planner/ }).count()))
      await collect()

      // The planner's and the import's pages send people to Shifts & overtime
      for (const path of ['/hrms/shifts/planner/new', '/hrms/shifts/planner/import', `/hrms/shifts/planner/${randomUUID()}`]) {
        await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 180_000 })
        const landed = await page.waitForURL((u) => u.pathname === '/hrms/shifts', { timeout: 120_000 }).then(() => true, () => false)
        await page.waitForTimeout(2000)
        check(`web ${label}: ${path.replace(/[0-9a-f-]{36}$/, '<id>')} lands on Shifts & overtime`, landed, page.url())
        await collect()
      }
      if (label === 'phone') await page.screenshot({ path: `${SHOTS}/shift-p1-pilot-off-redirected-phone.png`, animations: 'disabled' })

      check(`web ${label}: the text watcher ran on every page (it saw "Shift Schedules")`, blind.length === 0, blind.join(' | '))
      check(`web ${label}: no planner text appeared, not even for a moment`, seen.length === 0, seen.join(' | '))
      check(`web ${label}: no shift-planning call other than availability`, planningCalls.length === 0, planningCalls.join(' | '))
      check(`web ${label}: no page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

try {
  await apiChecks()
  await webChecks()
} catch (e) {
  check('the run finished', false, String(e?.stack || e).slice(0, 400))
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
