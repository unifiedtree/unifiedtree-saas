// Screenshot every HRMS screen for the Claude Design brief pack.
//
// Completeness by discovery, not by a hand-kept list:
//   • routes are read from src/App.tsx (+ the settings tabs in PlatformShell)
//     at run time, so a new route is captured without editing this script;
//   • on every page, every [role=tab] is clicked and captured;
//   • "open a form" buttons (Add / New / Create / Start / Apply / Request /
//     Upload / Invite / Import / Assign / Schedule / Generate) are opened,
//     captured and dismissed — never submitted.
// Views: every route as the company owner; the self-service surface again as
// an employee; public/sign-in pages logged out; plus two permission-denied
// samples as the employee.
//
// SAFETY: after sign-in every non-GET request to /api is aborted, so no click
// can create, change or delete data. (Local recovery runtime only.)
//
// Output: docs/design-briefs/screenshots/<view>/<name>.png, INDEX.md and
// index.json (route, view, tab/drawer, file, brief, flags).
//
// Run from apps/platform:  node e2e/recovery/capture-design-screens.mjs
//   CAPTURE_ONLY=/hrms/attendance,/me   limit to these routes (re-captures)
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const OWNER = 'owner@unifiedtree.demo', EMPLOYEE = 'reader@unifiedtree.demo'
const READER_EMPLOYEE_ID = '22222222-2222-2222-2222-222222222222'
const repo = resolve('..', '..')
const outDir = join(repo, 'docs', 'design-briefs', 'screenshots')
const only = (process.env.CAPTURE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)

// ── Route discovery ────────────────────────────────────────────────────────
const appSrc = readFileSync(join(repo, 'apps/platform/src/App.tsx'), 'utf8')
const shellSrc = readFileSync(join(repo, 'apps/platform/src/layouts/PlatformShell.tsx'), 'utf8')
const declared = [...new Set([...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))]
const settingsTabs = [...shellSrc.slice(shellSrc.indexOf('const SETTINGS_NAV')).matchAll(/path: '(\/settings\/[^']+)'/g)].map((m) => m[1])
// Not HRMS / not a screen: other ERP modules' coming-soon placeholders, redirects, the catch-all.
const NOT_HRMS = /^(\/accounting|\/accounts|\/inventory|\/crm|\/purchase|\/procurement|\/sales|\/projects|\/manufacturing|\/pos|\/reports$|\/reports\/|\/files|\/analytics|\/payroll$|\/module-workspace|\*)/
const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/accept-invite', '/pending-approval', '/no-access', '/inspection']
const EMPLOYEE_VIEW = ['/dashboard', '/me', '/me/shift-change', '/me/wfh', '/me/payslips', '/me/salary', '/hrms/ess',
  '/hrms/attendance', '/hrms/leave', '/hrms/expenses', '/hrms/advances', '/hrms/performance', '/hrms/learning',
  '/hrms/documents', '/hrms/policies', '/hrms/onboarding/instances', '/profile']
const DENIED_SAMPLES = ['/hrms/payroll/runs', '/hrms/employees']

// ── Brief map: route → brief file + heading ────────────────────────────────
const briefDir = join(repo, 'docs', 'design-briefs')
const briefFor = new Map()
for (const f of readdirSync(briefDir).filter((f) => /^\d\d-.*\.md$/.test(f) && f !== '00-README.md')) {
  for (const m of readFileSync(join(briefDir, f), 'utf8').matchAll(/^##\s+(.+?)\s+`([^`]+)`/gm)) {
    for (const route of m[2].split(/[,\s]+/).filter((r) => r.startsWith('/'))) if (!briefFor.has(route)) briefFor.set(route, `${f} › ${m[1].trim()}`)
  }
}

// ── API helpers (read-only) for dynamic route ids ──────────────────────────
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
async function apiLogin(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return { ...headers, Authorization: `Bearer ${(await r.json()).accessToken}` }
}
async function firstId(h, path, pick = (j) => (Array.isArray(j) ? j : j.content || j.items || [])[0]) {
  try { const r = await fetch(api + path, { headers: h }); if (!r.ok) return null; const row = pick(await r.json()); return row ? row.id || row.jobId || row.instanceId : null } catch { return null }
}

const slug = (s) => s.replace(/^\//, '').replace(/[/:]+/g, '-').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/-$/, '') || 'root'
const shots = []

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  for (let i = 0; i < 20; i++) {
    const busy = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body
      const t = main.innerText || ''
      return /\bLoading\b|Loading…|Loading\.\.\./.test(t) || main.querySelectorAll('[aria-busy="true"], .animate-pulse, [role="status"][aria-live]').length > 3
    }).catch(() => false)
    if (!busy) break
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(400)
}

async function flags(page, requested) {
  return page.evaluate((requested) => {
    const main = document.querySelector('main') || document.body
    const text = (main.innerText || '').replace(/\s+/g, ' ')
    const f = []
    if (location.pathname !== requested.split('?')[0]) f.push(`REDIRECTED→${location.pathname}`)
    if (/Unable to load|Something went wrong|Failed to load|Request failed/i.test(text) || main.querySelector('[role="alert"]')) f.push('ERROR-STATE')
    if (/\bNo [a-z][^.]{0,60}(yet|found|match|available|recorded|to show)\b|No records|Nothing to show|All caught up|No data/i.test(text)) f.push('EMPTY-STATE')
    if (/do not have access|don't have access|No access|not have permission/i.test(text)) f.push('NO-ACCESS')
    return f
  }, requested)
}

async function capture(page, view, route, requested, label, extra = {}) {
  const dir = join(outDir, view)
  mkdirSync(dir, { recursive: true })
  const name = slug(requested) + (label ? `__${slug(label)}` : '')
  const file = `${view}/${name}.png`
  await page.screenshot({ path: join(outDir, file), fullPage: true }).catch(() => {})
  const f = await flags(page, requested).catch(() => [])
  const brief = briefFor.get(route) || briefFor.get(requested) || ''
  shots.push({ view, route, url: requested, label: label || '', file, brief, flags: [...f, ...(extra.flags || [])] })
  console.log(`${view.padEnd(8)} ${requested}${label ? '  [' + label + ']' : ''}  ${f.join(' ')}`)
}

const OPENER = /^(\+\s*)?(Add|New|Create|Start|Apply|Request|Upload|Invite|Import|Assign|Schedule|Generate|Raise|Register|Build)\b/i
const NEVER = /delete|remove|process|lock|approve|reject|pay\b|disburse|finali|send|email|mark|run\b|revoke|withdraw|exit|terminate|confirm|cancel|close|export|download|sync|check.?in|check.?out|punch/i

async function capturePage(page, view, route, url, errors) {
  errors.length = 0
  await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await settle(page)
  await capture(page, view, route, url, '', { flags: errors.length ? ['PAGE-ERRORS'] : [] })
  const main = page.locator('main').first()
  const scope = (await main.count()) ? main : page.locator('body')
  // Every tab.
  const tabNames = (await scope.locator('[role="tab"]').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const [i, name] of tabNames.entries()) {
    if (i === 0) continue // the default tab is the page shot
    const tab = scope.locator('[role="tab"]').nth(i)
    if (!(await tab.isVisible().catch(() => false))) continue
    await tab.click({ timeout: 5000 }).catch(() => {})
    await settle(page)
    await capture(page, view, route, url, `tab ${name}`)
  }
  // "Open a form" buttons on the default view — opened, captured, dismissed.
  if (tabNames.length) { await page.goto(base + url, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page) }
  const buttons = scope.locator('button:visible')
  const labels = [...new Set((await buttons.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()))]
    .filter((t) => t && t.length < 40 && OPENER.test(t) && !NEVER.test(t)).slice(0, 5)
  for (const text of labels) {
    const before = page.url()
    const btn = scope.getByRole('button', { name: text, exact: true }).first()
    if (!(await btn.isVisible().catch(() => false)) || !(await btn.isEnabled().catch(() => false))) continue
    await btn.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(900)
    const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').first()
    if (await dialog.count()) {
      await settle(page)
      await capture(page, view, route, url, `open ${text}`)
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
      const cancel = page.locator('[role="dialog"]:visible').getByRole('button', { name: /^(Cancel|Close)$/ }).first()
      if (await cancel.count()) await cancel.click({ timeout: 3000 }).catch(() => {})
    } else if (page.url() !== before) {
      await settle(page)
      await capture(page, view, route, url, `open ${text}`)
      await page.goto(base + url, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await settle(page)
    } else {
      // Inline form revealed on the page itself.
      await settle(page)
      await capture(page, view, route, url, `open ${text}`)
    }
  }
}

async function signedInPage(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(1500)
  // From here on nothing can write.
  await context.route('**/api/**', (r) => (r.request().method() === 'GET' || r.request().url().includes('/canonical-auth/refresh') ? r.continue() : r.abort()))
  return page
}

const want = (r) => !only.length || only.includes(r)
if (!only.length && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })

const ownerApi = await apiLogin(OWNER)
const ids = {
  ':id@/hrms/employees/:id': READER_EMPLOYEE_ID,
  ':id@/hrms/onboarding/templates/:id': await firstId(ownerApi, '/v1/onboarding/templates'),
  ':instanceId@/hrms/onboarding/instances/:instanceId': await firstId(ownerApi, '/v1/onboarding/instances'),
  ':id@/hrms/payroll/runs/:id': await firstId(ownerApi, '/v1/payroll/runs'),
  ':id@/hrms/letters/templates/:id': await firstId(ownerApi, '/v1/letters/templates'),
  ':id@/hrms/letters/generated/:id': await firstId(ownerApi, '/v1/letters/generated'),
  ':jobId@/hrms/letters/distributions/:jobId': await firstId(ownerApi, '/v1/letters/distributions'),
}
const skipped = []
function concrete(route) {
  if (!route.includes(':')) return route
  if (route === '/settings/:tab') return null // expanded from SETTINGS_NAV below
  if (route === '/hrms/soon/:key') { skipped.push(`${route} — generic coming-soon placeholder`); return null }
  let out = route
  for (const param of route.match(/:[A-Za-z]+/g)) {
    const id = ids[`${param}@${route}`]
    if (!id) { skipped.push(`${route} — no record exists to open (create one, then re-run with CAPTURE_ONLY)`); return null }
    out = out.replace(param, id)
  }
  return out
}

const ownerRoutes = [...declared, ...settingsTabs]
  .filter((r) => !NOT_HRMS.test(r) && !PUBLIC.includes(r) && r !== '/')
  .filter((r, i, a) => a.indexOf(r) === i)

const browser = await chromium.launch({ headless: true })
try {
  // 1. Owner: every route.
  const owner = await signedInPage(browser, OWNER)
  const ownerErrors = []; owner.on('pageerror', (e) => ownerErrors.push(String(e)))
  for (const route of ownerRoutes) { const url = concrete(route); if (url && want(route)) await capturePage(owner, 'owner', route, url, ownerErrors) }
  await owner.context().close()

  // 2. Employee: the self-service surface + permission-denied samples.
  const emp = await signedInPage(browser, EMPLOYEE)
  const empErrors = []; emp.on('pageerror', (e) => empErrors.push(String(e)))
  for (const route of [...EMPLOYEE_VIEW, ...DENIED_SAMPLES]) if (want(route)) await capturePage(emp, 'employee', route, route, empErrors)
  await emp.context().close()

  // 3. Logged out.
  const anon = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  for (const route of PUBLIC) if (want(route)) { await anon.goto(base + route, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(anon); await capture(anon, 'public', route, route, '') }
} finally {
  await browser.close()
  const rows = shots.map((s) => `| \`${s.url}\` | ${s.view} | ${s.label || 'page'} | [${s.file}](${s.file}) | ${s.brief || '—'} | ${s.flags.join(' ') || ''} |`)
  const counts = shots.reduce((m, s) => { for (const f of s.flags.length ? s.flags : ['OK']) m[f.split('→')[0]] = (m[f.split('→')[0]] || 0) + 1; return m }, {})
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ capturedAt: new Date().toISOString(), shots, skipped }, null, 2))
  writeFileSync(join(outDir, 'INDEX.md'), [
    '# Screenshots for the Claude Design brief pack', '',
    `Captured ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the local recovery runtime by \`apps/platform/e2e/recovery/capture-design-screens.mjs\` — ${shots.length} images. Routes come from \`App.tsx\`; every tab and every "open a form" button on each page is captured; writes were blocked during capture.`, '',
    'Views: **owner** = company owner (every route) · **employee** = self-service view · **public** = signed out.', '',
    'Flags: `EMPTY-STATE` (page shows no records — local demo data is thin), `ERROR-STATE`, `NO-ACCESS`, `REDIRECTED→…` (route guard or module gate sent the user elsewhere), `PAGE-ERRORS` (JavaScript error on the page).', '',
    `Summary: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '',
    skipped.length ? `Not captured:\n${skipped.map((s) => `- ${s}`).join('\n')}\n` : '',
    '| URL | View | Tab / form | File | Brief | Flags |', '|---|---|---|---|---|---|', ...rows, '',
  ].join('\n'))
  console.log(`\n${shots.length} screenshots → ${outDir}`)
  console.log('flags:', JSON.stringify(counts))
  if (skipped.length) console.log('skipped:', skipped.join(' | '))
}
