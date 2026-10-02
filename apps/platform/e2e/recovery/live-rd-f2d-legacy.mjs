// Live check of the legacy page kit rebuilt on the redesign kit (package F2d): ModuleKit pages
// (Leave, Expenses, Hiring, Exit, Learning) and SettingsKit pages (HR configuration, Settings,
// Profile) for the owner, the HR manager and an employee, in the light AND the dark theme.
// Read-only: nothing is saved, so there is nothing to clean up (every edit is discarded, every
// panel is closed, and the one API failure it causes is injected in the browser, not the server).
//
//   node e2e/recovery/live-rd-f2d-legacy.mjs
//
// On every page: no page errors, no failed API calls, the kit page header, and the text of the
// rebuilt pieces readable against what's behind it (4.5:1). In dark, the rebuilt pieces look the
// same with the dark bridge switched off (they use the tokens only).
// Owner: the view pills keep role=group + aria-pressed; a failed load shows "Try again" and
//   recovers; the unsaved-changes bar counts a change, the tab-close guard asks, Discard clears
//   it; the error jump; a #st- link keeps its section in place while sections above fill in, and
//   lets go once the person scrolls; the calendar inside a side panel closes alone on Escape;
//   the frame is 1440 wide (1320 on self-service pages); the phone bar at 390 with no sideways scroll.
// HR manager and employee: their pages render in both themes; HR configuration is editable
//   only with the right, otherwise view-only (no text boxes) or closed.
/* global process, console, document, window, getComputedStyle, location, Event, URL, setTimeout */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.RD_SHOTS || ''
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
async function signIn(email, { theme = 'light', width = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript((t) => { try { window.localStorage.setItem('ut.theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failed = [], injected = new Set()
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => {
    const u = r.url()
    if (!u.includes('/api/') || r.status() < 400 || u.includes('/canonical-auth/refresh')) return
    if ([...injected].some((p) => u.includes(p))) return
    failed.push(`${r.status()} ${r.request().method()} ${u.split('/api')[1]}`)
  })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(700)
  }
  return { ctx, page, errors, failed, injected, settle }
}

// The rebuilt pieces' text: its colour against the colour actually behind it.
const PIECES = [
  '.uk-ph__eyebrow', '.uk-ph__title', '.uk-ph__sub', '.uk-stat__label', '.uk-stat__value', '.uk-stat__note', '.uk-fpill',
  '.umk-row__title', '.umk-row__meta', '.umk-note', '.uks-sec__title', '.uks-sec__sub', '.uks-toc__item', '.uks-toc__head',
  '.uks-label', '.uks-input', '.uks-hint', '.uks-viewonly__text', '.uks-bar__title', '.uk-pill', '.uko-apprc-fact dt',
  '.uko-apprc-fact dd', '.uk-empty__title', '.uk-empty__hint', '.uk-kv__k', '.uk-kv__v', '.uk-ptab', '.uks-chip',
].join(',')
const probe = (page) => page.evaluate((sel) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const behind = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break }
    }
    let col = { r: 255, g: 255, b: 255, a: 1 }
    const pageBg = parse(getComputedStyle(document.body).backgroundColor)
    if (pageBg && pageBg.a > 0) col = over(pageBg, col)
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col)
    return col
  }
  const out = { theme: document.documentElement.getAttribute('data-theme'), n: 0, low: [], sig: [] }
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || !(el.textContent || '').trim()) continue
    if (el.closest('[disabled],[aria-disabled="true"],[data-disabled]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const fg = parse(cs.color); if (!fg) continue
    const bg = behind(el)
    const a = lum(over(fg, bg)), b = lum(bg)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    out.n++
    out.sig.push(`${el.className}|${cs.color}|${cs.backgroundColor}|${cs.borderTopColor}`)
    if (ratio < 4.5) out.low.push(`${(el.textContent || '').trim().slice(0, 30)} (${String(el.className).split(' ')[0]}) ${ratio.toFixed(2)}`)
  }
  return out
}, PIECES)
/** Switches the dark bridge's stylesheet off or on (Vite dev serves it as its own <style>). */
const bridge = (page, on) => page.evaluate((enable) => {
  const s = [...document.querySelectorAll('style[data-vite-dev-id]')].filter((x) => /dark-bridge\.css/.test(x.getAttribute('data-vite-dev-id') || ''))
  s.forEach((x) => { x.disabled = !enable })
  return s.length
}, on)

async function visit(s, who, theme, path) {
  s.errors.length = 0; s.failed.length = 0
  await s.page.goto(base + path); await s.settle()
  const tag = `${who} ${theme} ${path}`
  const h1 = await s.page.locator('h1').first().textContent({ timeout: 15_000 }).catch(() => '')
  const restricted = await s.page.getByText(/Access restricted|don.t have access|Access Restricted/).count()
  check(`${tag}: the page renders (${restricted ? 'closed to this role' : `"${(h1 || '').trim()}"`})`, !!(h1 || '').trim() || restricted > 0)
  check(`${tag}: theme is ${theme}`, (await s.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === theme)
  // My profile (P-PROFILE) has the profile frame's header (banner, the person's name) instead of the kit page header.
  const header = path.startsWith('/profile') ? '.upf-name' : '.uk-ph__title'
  if (!restricted) check(`${tag}: the ${path.startsWith('/profile') ? 'profile frame' : 'kit page'} header`, (await s.page.locator(header).count()) >= 1)
  const p = await probe(s.page)
  check(`${tag}: rebuilt pieces readable (${p.n} checked)`, p.n > 0 && p.low.length === 0, p.low.slice(0, 3).join(' | '))
  if (theme === 'dark') {
    const n = await bridge(s.page, false)
    if (n) {
      await s.page.waitForTimeout(150)
      const q = await probe(s.page)
      await bridge(s.page, true)
      const diff = q.sig.filter((x, i) => x !== p.sig[i])
      check(`${tag}: no reliance on the dark bridge (pieces look the same without it)`, q.sig.length === p.sig.length && diff.length === 0, diff.slice(0, 2).join(' | '))
      // Text that turns hard to read without the bridge sits on a page's own (not yet rebuilt) container.
      if (q.low.length) console.log(`  note: without the bridge, page containers not rebuilt yet put ${q.low.length} piece(s) on a light fill: ${q.low.slice(0, 2).join(' | ')}`)
    } else console.log(`  note: dark bridge stylesheet not found (not a Vite dev server?) — bridge check skipped on ${path}`)
  }
  check(`${tag}: no page errors`, !s.errors.length, s.errors[0] || '')
  check(`${tag}: no failed API calls`, !s.failed.length, s.failed.slice(0, 3).join(' | '))
  if (shots) await s.page.screenshot({ path: `${shots}/rd-f2d-live-${who}-${theme}-${path.replace(/[/?#=&]+/g, '_')}.png` }).catch(() => {})
}

const headingTop = (page, name) => page.getByRole('heading', { name, exact: true }).evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => NaN)

try {
  // ─────────────────────────────── owner ───────────────────────────────
  const OWNER_PAGES = ['/hrms/leave', '/hrms/expenses', '/hrms/hiring', '/hrms/exit', '/hrms/learning', '/hrms/settings', '/settings/profile', '/profile']
  for (const theme of ['light', 'dark']) {
    const o = await signIn('owner@unifiedtree.demo', { theme })
    for (const path of OWNER_PAGES) await visit(o, 'owner', theme, path)
    await o.ctx.close()
  }

  const o = await signIn('owner@unifiedtree.demo')
  const { page } = o

  // Frame: 1440 for admin pages, the design's padding.
  await page.goto(base + '/hrms/leave'); await o.settle()
  const frame = await page.locator('[data-frame]').first().evaluate((el) => ({ w: getComputedStyle(el).maxWidth, pt: getComputedStyle(el).paddingTop, kind: el.getAttribute('data-frame') })).catch(() => null)
  check('owner: admin pages sit in the 1440 frame with 28px top padding', !!frame && frame.kind === 'wide' && frame.w === '1440px' && frame.pt === '28px', JSON.stringify(frame))

  check('owner: Leave (Approvals) shows the design stat cards', (await page.locator('.uk-stat.uk-stat--stat').count()) > 0)

  // View pills: role=group + aria-pressed, one pressed; picking another moves it.
  const group = page.locator('[role=group]:has(> .uk-fpill)').first()
  const pills = group.locator('button.uk-fpill')
  const nPills = await pills.count()
  const pressed0 = await group.locator('button[aria-pressed="true"]').count()
  check('owner: Leave view pills are a labelled group with one pressed pill', nPills > 1 && pressed0 === 1 && !!(await group.getAttribute('aria-label')), `${nPills} pills, ${pressed0} pressed`)
  if (nPills > 1) {
    const second = pills.nth(1)
    const label = ((await second.textContent()) || '').trim()
    await second.click(); await o.settle()
    check(`owner: pressing "${label}" moves the pressed state and the address`, (await second.getAttribute('aria-pressed')) === 'true' && (await group.locator('button[aria-pressed="true"]').count()) === 1 && /[?&](tab|view)=/.test(page.url()), page.url().replace(base, ''))
  }

  // A failed load shows the error state with "Try again", and recovers.
  o.injected.add('/v1/learning/programs')
  let failNext = true
  const PROGRAMS = /\/api\/v1\/learning\/programs\?/
  await page.route(PROGRAMS, (r) => (failNext ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Local check: programs are unavailable' }) }) : r.continue()))
  await page.goto(base + '/hrms/learning'); await o.settle()
  // Learning (P-GROW) shows the kit error state in its "All programs" card; the reason is the server's message.
  const alert = page.getByRole('alert').filter({ hasText: 'Local check: programs are unavailable' })
  await alert.waitFor({ timeout: 20_000 }).catch(() => {})
  check('owner: a failed load shows the error state (role=alert, the reason)', (await alert.count()) === 1 && (await alert.innerText()).includes('Local check: programs are unavailable'))
  failNext = false
  await alert.getByRole('button', { name: 'Try again', exact: true }).click().catch(() => {})
  await page.waitForTimeout(1500)
  check('owner: "Try again" loads it again', (await page.getByRole('alert').filter({ hasText: 'Local check: programs are unavailable' }).count()) === 0)
  await page.unroute(PROGRAMS)
  o.injected.delete('/v1/learning/programs')

  // Unsaved changes and the tab-close guard (My profile). The redesigned profile edits display name and
  // Mobile in its left card: the card's "Unsaved changes" note counts the change, with Discard there and
  // Update to save. Nothing is saved.
  o.errors.length = 0; o.failed.length = 0
  await page.goto(base + '/profile'); await o.settle()
  const nameField = page.getByLabel('Display name', { exact: true })
  const name0 = await nameField.inputValue()
  await nameField.click()
  await nameField.fill(name0 + ' x')
  const bar = page.getByRole('region', { name: 'Unsaved changes' })
  check('owner: an edit shows the unsaved-changes bar with its count', (await bar.count()) === 1 && (await bar.getByText('1 change · not saved yet').count()) === 1)
  check('owner: the note offers Discard, and Update saves', (await bar.getByRole('button', { name: 'Discard' }).count()) === 1 && await page.getByRole('button', { name: 'Update', exact: true }).isEnabled())
  const guarded = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
  check('owner: with unsaved changes the tab-close guard is on', guarded)
  let dialogType = ''
  const onDialog = (d) => { dialogType = d.type(); d.dismiss().catch(() => {}) }
  page.on('dialog', onDialog)
  await page.evaluate(() => { window.setTimeout(() => { location.href = '/hrms/leave' }, 0) })
  for (let i = 0; i < 25 && !dialogType; i++) await page.waitForTimeout(200)
  await page.waitForTimeout(400)
  check('owner: leaving the page asks first (beforeunload), and staying keeps the edit', dialogType === 'beforeunload' && new URL(page.url()).pathname === '/profile' && (await bar.count()) === 1, `dialog=${dialogType || 'none'} at ${new URL(page.url()).pathname}`)
  await bar.getByRole('button', { name: 'Discard' }).click()
  check('owner: Discard clears the bar and restores the value', (await bar.count()) === 0 && (await nameField.inputValue()) === name0)
  const guardedAfter = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
  dialogType = ''
  await page.reload({ timeout: 20_000 }).catch(() => {}); await o.settle()
  check('owner: with nothing to save the page leaves without asking', !guardedAfter && !dialogType)
  page.off('dialog', onDialog)

  // Error jump (HR configuration): an empty prefix blocks the save; the bar's link goes to it.
  await page.goto(base + '/hrms/settings'); await o.settle()
  const prefix = page.getByLabel('Prefix', { exact: true })
  if (await prefix.count()) {
    await prefix.fill('')
    await page.getByRole('button', { name: 'Save settings' }).click()
    const fix = page.getByRole('button', { name: /Fix 1 error to save/ })
    check('owner: an invalid field blocks the save and shows the error (role=alert)', (await fix.count()) === 1 && (await page.getByRole('alert').filter({ hasText: 'Use 1–10 letters or digits' }).count()) === 1)
    await page.locator('.uks-card').last().scrollIntoViewIfNeeded().catch(() => {})
    await fix.click(); await page.waitForTimeout(900)
    const top = await headingTop(page, 'Employee IDs')
    check('owner: the error link brings its section into view', top >= 0 && top < 400, `top=${top}`)
    await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click()
    check('owner: Discard clears the error', (await page.getByRole('region', { name: 'Unsaved changes' }).count()) === 0)
  } else check('owner: HR configuration has the Prefix field', false)

  // A #st- link holds its section while sections above fill in (real data arriving late).
  o.injected.add('/v1/employees/me')
  const ME = /\/api\/v1\/employees\/me(\?|$)/
  await page.route(ME, async (r) => { await new Promise((res) => setTimeout(res, 1400)); await r.continue() })
  await page.goto(base + '/profile#st-delegation')
  const samples = []
  for (let i = 0; i < 26; i++) { await page.waitForTimeout(120); samples.push(await headingTop(page, 'Approval delegation')) }
  await page.unroute(ME)
  o.injected.delete('/v1/employees/me')
  // The shell scrolls smoothly, so the section is "placed" once two readings in a row agree near the top.
  const placed = samples.findIndex((t, i) => i > 0 && Number.isFinite(t) && t >= 0 && t < 260 && t === samples[i - 1])
  const after = placed >= 0 ? samples.slice(placed).filter(Number.isFinite) : []
  const spread = after.length ? Math.max(...after) - Math.min(...after) : NaN
  check('owner: #st-delegation opens at its section and stays there while Employment loads above it', placed >= 0 && spread <= 24, `samples ${samples.join(',')}`)
  // …and holds against a section above growing, then lets go once the person scrolls.
  await page.goto('about:blank')
  await page.goto(base + '/profile#st-delegation')
  // Wait until the page has placed the section (two equal readings near the top), then grow a card above it.
  let prev = NaN
  for (let i = 0; i < 60; i++) { const t = await headingTop(page, 'Approval delegation'); if (t >= 0 && t < 260 && t === prev) break; prev = t; await page.waitForTimeout(60) }
  const t0 = await headingTop(page, 'Approval delegation')
  await page.evaluate(() => { const el = document.getElementById('st-employment'); if (el) el.style.paddingBottom = '360px' })
  await page.waitForTimeout(350)
  const t1 = await headingTop(page, 'Approval delegation')
  check('owner: the held section stays put when a card above grows', Math.abs(t1 - t0) <= 24, `before ${t0}, after ${t1}`)
  await page.mouse.move(700, 500)
  await page.mouse.wheel(0, 60); await page.waitForTimeout(450)
  const t2 = await headingTop(page, 'Approval delegation')
  await page.evaluate(() => { const el = document.getElementById('st-details'); if (el) el.style.paddingBottom = '300px' })
  await page.waitForTimeout(450)
  const t3 = await headingTop(page, 'Approval delegation')
  await page.evaluate(() => { for (const id of ['st-employment', 'st-details']) { const el = document.getElementById(id); if (el) el.style.paddingBottom = '' } })
  check('owner: after the person scrolls the page no longer holds it', t3 - t2 >= 250, `after scroll ${t2}, after growth ${t3}`)

  // The calendar inside a side panel closes alone on Escape (Exit → Start notice). Nothing is saved.
  await page.goto(base + '/hrms/exit'); await o.settle()
  const start = page.getByRole('button', { name: /Start notice/ }).first()
  if (await start.count()) {
    await start.click()
    const panel = page.getByRole('dialog', { name: 'Start notice period' })
    await panel.waitFor({ timeout: 10_000 }).catch(() => {})
    const field = panel.locator('.utc-field').first().getByRole('combobox')
    await field.click()
    const cal = page.getByRole('dialog', { name: 'Choose date' })
    await cal.waitFor({ timeout: 5000 }).catch(() => {})
    check('owner: the date field opens its calendar inside the side panel', await cal.isVisible())
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    check('owner: Escape closes only the calendar; the side panel stays open', !(await cal.isVisible().catch(() => false)) && (await panel.isVisible()))
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check('owner: a second Escape closes the side panel', (await panel.count()) === 0)
  } else check('owner: Exit has the Start notice button', false)
  check('owner: no page errors in the checks above', !o.errors.length, o.errors[0] || '')
  check('owner: no failed API calls in the checks above', !o.failed.length, o.failed.slice(0, 3).join(' | '))
  await o.ctx.close()

  // Phone: the unsaved bar spans the bottom, no sideways scroll.
  const m = await signIn('owner@unifiedtree.demo', { width: 390 })
  for (const path of ['/hrms/leave', '/hrms/settings', '/profile']) {
    await m.page.goto(base + path); await m.settle()
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`phone ${path}: no sideways scroll`, overflow <= 1, `overflow=${overflow}`)
  }
  const phoneName = m.page.getByLabel('Display name', { exact: true })
  const pn0 = await phoneName.inputValue()
  await phoneName.fill(pn0 + ' x')
  const pbar = m.page.getByRole('region', { name: 'Unsaved changes' })
  const pb = await pbar.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), pos: getComputedStyle(el).position } }).catch(() => null)
  // On a phone the note sits in the profile card, which spans the screen.
  const ov = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: the unsaved note spans the profile card, no sideways scroll', !!pb && pb.w >= 300 && ov <= 1, JSON.stringify({ ...pb, ov }))
  await pbar.getByRole('button', { name: 'Discard' }).click()
  check('phone: Discard clears it', (await pbar.count()) === 0)
  check('phone: no page errors', !m.errors.length, m.errors[0] || '')
  await m.ctx.close()

  // ─────────────────────────────── HR manager ───────────────────────────────
  for (const theme of ['light', 'dark']) {
    const h = await signIn('hrm@unifiedtree.demo', { theme })
    for (const path of ['/hrms/leave', '/hrms/expenses', '/hrms/exit', '/hrms/settings', '/profile']) await visit(h, 'hrm', theme, path)
    await h.page.goto(base + '/hrms/settings'); await h.settle()
    const viewOnly = await h.page.getByText('View only', { exact: true }).count()
    const boxes = await h.page.getByRole('textbox').count()
    check(`hrm ${theme}: HR configuration is either editable or view-only with no text boxes`, viewOnly ? boxes === 0 : true, `viewOnly=${viewOnly} boxes=${boxes}`)
    await h.ctx.close()
  }

  // ─────────────────────────────── employee ───────────────────────────────
  for (const theme of ['light', 'dark']) {
    const r = await signIn('reader@unifiedtree.demo', { theme })
    for (const path of ['/hrms/leave', '/hrms/learning', '/me/payslips', '/profile']) await visit(r, 'reader', theme, path)
    await r.page.goto(base + '/me/payslips'); await r.settle()
    const f = await r.page.locator('[data-frame]').first().evaluate((el) => ({ w: getComputedStyle(el).maxWidth, kind: el.getAttribute('data-frame') })).catch(() => null)
    if (f) check(`reader ${theme}: self-service pages sit in the 1320 frame`, f.kind === 'narrow' && f.w === '1320px', JSON.stringify(f))
    await r.page.goto(base + '/hrms/settings'); await r.settle(); await r.page.waitForTimeout(600)
    const heading = await r.page.getByRole('heading', { name: 'HR Configuration' }).count()
    const viewOnly = await r.page.getByText('View only', { exact: true }).count()
    const boxes = await r.page.getByRole('textbox').count()
    check(`reader ${theme}: HR configuration is view-only or closed, never editable`, !heading || (viewOnly > 0 && boxes === 0), `heading=${heading} viewOnly=${viewOnly} boxes=${boxes}`)
    check(`reader ${theme}: no page errors`, !r.errors.length, r.errors[0] || '')
    await r.ctx.close()
  }
} catch (e) {
  check('run finished', false, String(e.message || e).slice(0, 300))
} finally {
  await browser.close()
  const pass = results.filter((x) => x.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
}
