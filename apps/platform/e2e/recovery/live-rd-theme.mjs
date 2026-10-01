// Live check of the redesign theme (design/theme): light by default, dark from
// localStorage['ut.theme'], the sign-in page always light, one font (Inter,
// nothing else loaded; the sign-in page too) and a readable dark theme on real
// pages for every role (owner, hrm, fin, mgr, reader).
//  - light: <html data-theme="light">, color-scheme light, data-ufx="full",
//    the page background is the redesign's #F3F6F4
//  - dark: applied before the first paint, stays on through in-app navigation,
//    page background #0A110E, no text below 3:1 against what is behind it
//    (dark-on-dark / light-on-light) and no large light panel left over
//  - the sign-in page renders light even with dark saved
//  - no Plus Jakarta Sans / JetBrains Mono / Tabler font is loaded or used anywhere
// Read-only: it only opens pages; the theme lives in each test browser's own
// storage, which is thrown away at the end.
//
//   RECOVERY_APP_URL=http://demo.localhost:3101 node e2e/recovery/live-rd-theme.mjs
//   SHOTS_DIR=<folder>  also saves 1440 and 390 screenshots of each page in both themes
/* global console, process, document, getComputedStyle, localStorage, innerHeight, NodeFilter, window */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || ''
const ACCOUNTS = [
  ['owner', 'owner@unifiedtree.demo', ['/dashboard', '/hrms/leave', '/hrms/employees', '/settings']],
  ['hrm', 'hrm@unifiedtree.demo', ['/dashboard', '/hrms/attendance']],
  ['fin', 'fin@unifiedtree.demo', ['/hrms/payroll-dashboard', '/hrms/expenses']],
  ['mgr', 'mgr@unifiedtree.demo', ['/team', '/hrms/leave']],
  ['reader', 'reader@unifiedtree.demo', ['/me', '/hrms/leave']],
]

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200) }

// Theme facts of the open page.
const facts = (page) => page.evaluate(() => {
  const d = document.documentElement
  return {
    theme: d.getAttribute('data-theme'), scheme: d.style.colorScheme || getComputedStyle(d).colorScheme, ufx: d.getAttribute('data-ufx'),
    bodyBg: getComputedStyle(document.body).backgroundColor, bodyFont: getComputedStyle(document.body).fontFamily,
    atFirstPaint: window.__themeAtStart || null,
  }
})

// Fonts: what is loaded (stylesheets and FontFace) and what any element asks for first.
const fontFacts = (page) => page.evaluate(async () => {
  await document.fonts.ready
  const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href)
  const families = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))
  const firstFamilies = new Set()
  for (const el of document.querySelectorAll('body *')) firstFamilies.add(getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, ''))
  return { links, loaded: [...families], firstFamilies: [...firstFamilies], inter: document.fonts.check('500 14px "Inter"') }
})

// Text that cannot be read against what is painted behind it (< 3:1), and large
// light panels in the dark theme.
const audit = (page) => page.evaluate(() => {
  const parse = (c) => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 })
  const bgOf = (el) => {
    const stack = []
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.95) break } }
    let acc = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) acc = blend(stack[i], acc)
    return acc
  }
  const shown = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.3) return false } return true }
  const bad = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  while (walker.nextNode()) {
    const t = walker.currentNode; const txt = t.textContent.trim(); const el = t.parentElement
    if (!txt || !el || seen.has(el)) continue
    seen.add(el)
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight * 3) continue
    if (!shown(el)) continue
    const fg = parse(getComputedStyle(el).color); if (!fg) continue
    const bg = bgOf(el); const f = fg.a < 1 ? blend(fg, bg) : fg
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    if (ratio < 3) bad.push(`${txt.slice(0, 30)} (${ratio.toFixed(2)})`)
  }
  const slabs = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (r.width * r.height < 20000 || r.bottom < 0 || r.top > innerHeight * 2) continue
    const c = parse(getComputedStyle(el).backgroundColor); if (!c || c.a < 0.5 || lum(c) < 0.55 || !shown(el)) continue
    slabs.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  return { bad, slabs }
})

async function signIn(context, email) {
  const page = await context.newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { page, errors, failed }
}

const browser = await chromium.launch()
try {
  // ── the sign-in page stays light, even with dark saved ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('ut.theme', 'dark') } catch { /* blocked */ } })
    const page = await ctx.newPage()
    await page.goto(base + '/login'); await settle(page)
    const f = await facts(page)
    check('sign-in page: light even with dark saved', f.theme === 'light' && f.scheme === 'light', `${f.theme} / ${f.scheme}`)
    check('sign-in page: the same font as the app (Inter)', /^"?Inter\b/.test(f.bodyFont), f.bodyFont)
    if (shots) await page.screenshot({ path: `${shots}/rd-theme-login-dark-saved.png` })
    await ctx.close()
  }

  for (const [who, email, paths] of ACCOUNTS) {
    // ── light (nothing saved) ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { window.__themeAtStart = document.documentElement.getAttribute('data-theme') }) })
    const { page, errors, failed } = await signIn(ctx, email)
    await settle(page)
    const light = await facts(page)
    check(`${who}: light by default (data-theme, color-scheme, motion level)`, light.theme === 'light' && light.scheme === 'light' && light.ufx === 'full', `${light.theme} / ${light.scheme} / ufx=${light.ufx}`)
    check(`${who}: light page background is #F3F6F4`, light.bodyBg === 'rgb(243, 246, 244)', light.bodyBg)
    check(`${who}: body font is Inter`, /^"?Inter\b/.test(light.bodyFont), light.bodyFont)
    const ff = await fontFacts(page)
    check(`${who}: only Inter is loaded (no Plus Jakarta Sans, JetBrains Mono or Tabler)`, ff.inter && !ff.links.some((h) => /Jakarta|JetBrains|tabler/i.test(h)) && !ff.loaded.some((f) => /Jakarta|JetBrains|tabler/i.test(f)), `loaded: ${ff.loaded.join(', ')}`)
    check(`${who}: no element asks for Plus Jakarta Sans`, !ff.firstFamilies.includes('Plus Jakarta Sans'), ff.firstFamilies.join(' | '))
    if (shots) for (const p of paths) {
      await page.goto(base + p); await settle(page)
      const name = p.replace(/\W+/g, '-').replace(/^-|-$/g, '')
      await page.screenshot({ path: `${shots}/rd-theme-${who}-${name}-light-1440.png` })
    }

    // ── dark (saved choice), checked on every page this person can open ──
    await page.evaluate(() => localStorage.setItem('ut.theme', 'dark'))
    for (const p of paths) {
      await page.goto(base + p); await settle(page)
      const f = await facts(page)
      const name = p.replace(/\W+/g, '-').replace(/^-|-$/g, '')
      check(`${who} ${p}: dark from the saved choice, before first paint`, f.theme === 'dark' && f.scheme === 'dark' && f.atFirstPaint === 'dark', `${f.theme} / ${f.scheme} / at first paint: ${f.atFirstPaint}`)
      check(`${who} ${p}: dark page background is #0A110E`, f.bodyBg === 'rgb(10, 17, 14)', f.bodyBg)
      const a = await audit(page)
      check(`${who} ${p}: dark has no unreadable text (< 3:1)`, a.bad.length === 0, a.bad.slice(0, 6).join('; '))
      check(`${who} ${p}: dark has no large light panel left`, a.slabs.length === 0, a.slabs.slice(0, 4).join('; '))
      if (shots) {
        await page.screenshot({ path: `${shots}/rd-theme-${who}-${name}-dark-1440.png` })
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600)
        await page.screenshot({ path: `${shots}/rd-theme-${who}-${name}-dark-390.png` })
        await page.setViewportSize({ width: 1440, height: 900 })
      }
    }
    // In-app navigation keeps the theme (no reload).
    const link = page.locator('nav a[href]').first()
    if (await link.count()) {
      await link.click().catch(() => {}); await settle(page)
      const f = await facts(page)
      check(`${who}: dark stays on after in-app navigation`, f.theme === 'dark', f.theme)
    }
    check(`${who}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    check(`${who}: no server errors`, failed.length === 0, failed.slice(0, 3).join(' | '))
    await page.evaluate(() => localStorage.removeItem('ut.theme'))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failedChecks = results.filter((r) => !r.ok)
console.log(`\n${results.length - failedChecks.length}/${results.length} passed`)
process.exit(failedChecks.length ? 1 : 0)
