/* global process, console, document, getComputedStyle, innerHeight, localStorage */
// Live check: cards have no outer shadow / glow (owner decision, 6 Oct 2026).
// Opens each main page as the owner, in light and dark, at 1440 and 390 wide, and lists every visible
// element outside an overlay (dialog, menu, listbox, popover, toast) whose box-shadow draws a blurred
// shadow or glow. Also hovers a dashboard stat tile and checks the selected tile.
// Read-only: it only opens pages and hovers; it creates nothing.
//
//   RECOVERY_APP_URL=http://demo.localhost:3149 node e2e/recovery/live-w49-shadows.mjs
//   SHOTS_DIR=<folder> SHOTS_TAG=before|after   also saves screenshots; CENSUS_ONLY=1 never fails
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3149'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.SHOTS_DIR || ''
const tag = process.env.SHOTS_TAG || 'run'
const censusOnly = process.env.CENSUS_ONLY === '1'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const PAGES = [
  ['dashboard', '/dashboard'],
  ['home', '/me'],
  ['myteam', '/team'],
  ['workforce', '/hrms/employees'],
  ['attendance', '/hrms/attendance'],
  ['leave', '/hrms/leave'],
  ['payroll', '/hrms/payroll-dashboard'],
  ['settings', '/hrms/settings'],
]

// Every visible element outside overlays whose box-shadow has a blurred (non-inset) layer.
const census = () => {
  const OVERLAY = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[data-radix-popper-content-wrapper],.uk-pop,.uk-menu,.uk-toast,[class*="toast"],[class*="popover"],[class*="dropdown"]'
  const layers = (s) => {
    // split on commas outside parentheses
    const out = []; let depth = 0, cur = ''
    for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  const blurred = (layer) => {
    if (/\binset\b/.test(layer)) return false
    const nums = layer.replace(/rgba?\([^)]*\)|#[0-9a-f]+|[a-z-]+\([^)]*\)/gi, ' ').match(/-?[\d.]+px|\b0\b/g) || []
    const blur = parseFloat(nums[2] || '0')
    return blur > 0
  }
  const found = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el)
    if (!s.boxShadow || s.boxShadow === 'none') continue
    if (!layers(s.boxShadow).some(blurred)) continue
    if (el.closest(OVERLAY)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight * 4) continue
    if (s.visibility === 'hidden' || s.display === 'none') continue
    // a card = a surface at least 120x56 that sits in the page (not the rail, not a fixed/sticky bar);
    // buttons, pills, tabs, icons and switch knobs are smaller and are listed only for information
    const pos = s.position
    const card = r.width >= 120 && r.height >= 56 && pos !== 'fixed' && pos !== 'sticky' && !el.closest('.ut-rail')
    const key = `${card ? '' : '(not a card) '}${el.tagName.toLowerCase()}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 3).join('.')}`
    const prev = found.get(key)
    if (prev) prev.n++
    else found.set(key, { key, card, n: 1, size: `${Math.round(r.width)}x${Math.round(r.height)}`, shadow: s.boxShadow.slice(0, 160) })
  }
  return [...found.values()]
}

const report = {}
const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
      await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* blocked */ } }, theme)
      const page = await ctx.newPage()
      page.setDefaultNavigationTimeout(180_000)
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message || e)))
      await page.goto(base + '/login')
      await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
      await page.locator('input[type=password]').fill(password)
      await page.locator('button[type=submit]').click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      for (const [name, path] of PAGES) {
        await page.goto(base + path)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1200)
        await page.mouse.move(width - 1, (width === 390 ? 844 : 900) - 1)
        const found = await page.evaluate(census)
        report[`${name}-${theme}-${width}`] = found
        const cards = found.filter((f) => f.card)
        const detail = cards.slice(0, 6).map((f) => `${f.key} ${f.size} x${f.n} [${f.shadow}]`).join(' | ')
        check(`${name} ${theme} ${width}: no card shadows`, censusOnly || cards.length === 0, detail)
        if (shots) await page.screenshot({ path: `${shots}/w49-${tag}-${name}-${theme}-${width}.png`, fullPage: width === 390 ? false : true })
      }
      // dashboard tile: hover and selected state
      if (width === 1440) {
        await page.goto(base + '/dashboard')
        await page.waitForLoadState('networkidle').catch(() => {})
        const tile = page.getByRole('button', { name: /Total employees/i }).first()
        if (await tile.count()) {
          await tile.hover(); await page.waitForTimeout(700)
          const hover = await tile.evaluate((el) => getComputedStyle(el).boxShadow)
          check(`dashboard ${theme}: Total employees tile has no shadow on hover`, censusOnly || hover === 'none', hover)
          if (shots) await tile.screenshot({ path: `${shots}/w49-${tag}-tile-hover-${theme}.png` }).catch(() => {})
          // keyboard focus: a clean 2px outline, no glow
          await page.mouse.move(1439, 899); await page.waitForTimeout(800)
          await tile.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
          await page.waitForTimeout(700)
          const focus = await page.evaluate(() => { const a = document.activeElement; const s = a ? getComputedStyle(a) : null; return s ? { o: `${s.outlineStyle} ${s.outlineWidth}`, sh: s.boxShadow, label: (a.textContent || '').trim().slice(0, 30) } : null })
          check(`dashboard ${theme}: keyboard focus is a 2px outline without a glow`, !!focus && focus.o === 'solid 2px' && (censusOnly || focus.sh === 'none'), JSON.stringify(focus))
          if (shots) await page.screenshot({ path: `${shots}/w49-${tag}-tile-focus-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } })
        }
        // the Needs-your-action filter tiles: selected = filled tile with a matching border, no glow
        const ftile = page.locator('.ud-tile').first()
        if (await ftile.count()) {
          await ftile.scrollIntoViewIfNeeded(); await ftile.click(); await page.mouse.move(1439, 899); await page.waitForTimeout(700)
          const sel = await ftile.evaluate((el) => ({ pressed: el.getAttribute('aria-pressed'), sh: getComputedStyle(el).boxShadow, bc: getComputedStyle(el).borderTopColor }))
          check(`dashboard ${theme}: selected filter tile has no glow`, sel.pressed === 'true' && (censusOnly || sel.sh === 'none'), JSON.stringify(sel))
          if (shots) await ftile.locator('xpath=..').screenshot({ path: `${shots}/w49-${tag}-filter-tiles-${theme}.png` }).catch(() => {})
          await ftile.click() // back to no filter (page state only)
        }
      }
      check(`${theme} ${width}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }
  }
} catch (e) {
  check('run completed', false, String(e && e.stack || e).slice(0, 400))
} finally {
  await browser.close()
}
if (shots) writeFileSync(`${shots}/w49-${tag}-census.json`, JSON.stringify(report, null, 1))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
