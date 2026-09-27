// Screenshots every screen of the redesign handoff prototype: each role, module, page and tab, in light and
// dark, at 1440 and 390 wide, full height, plus the shell's open states (More, search, bell, Pages panel).
// These are the visual references every page builder compares against.
//
//   node e2e/capture-handoff.mjs [role|all] [widths=1440,390] [themes=light,dark]
//        [--out <dir>] [--only <key,...>] [--proto <prototypeDir>] [--base <url>]
//
// Output (default /c/REACT/ut-wt/redesign/ref): <role>/<module>__<page>__<tab>__<theme>__<width>.png,
// shell/<state>__<theme>__<width>.png, and index.json listing every file with its module, page and tab labels
// (merged into the folder's existing index.json).
//   --only   capture just these screens: role/module/page/tab keys as in the prototype's deep links
//            (admin/leave/l-ops/0), a shorter prefix (employee/etime), or shell/<state> (shell/more).
//   --proto  the prototype folder (default: the handoff's prototype folder); this script serves it itself.
//   --base   use an already running server instead, e.g. http://127.0.0.1:3900/
// React comes from the app's node_modules when it is the version the prototype pins (otherwise the prototype
// loads it from unpkg itself). Fonts still load from Google Fonts, as in the prototype.
// Run it from apps/platform. Screenshot the app itself with e2e/recovery/capture-app.mjs.
/* global process, console, URL, document, location, window */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const opts = { out: 'C:/REACT/ut-wt/redesign/ref', proto: 'C:/REACT/ut-wt/design-ref/design_handoff_hrms_redesign/prototype', only: '', base: '' }
const positional = []
for (let i = 0; i < args.length; i++) {
  const m = /^--(out|only|proto|base)(?:=(.*))?$/.exec(args[i])
  if (m) opts[m[1]] = m[2] ?? args[++i]
  else positional.push(args[i])
}
const [roleFilter, widthsArg, themesArg] = positional
const OUT = opts.out
const WIDTHS = (widthsArg || '1440,390').split(',').map(Number)
const THEMES = (themesArg || 'light,dark').split(',')
const ROLES = ['admin', 'manager', 'employee'].filter((r) => !roleFilter || roleFilter === 'all' || r === roleFilter)
const ONLY = opts.only ? opts.only.split(',').map((k) => k.trim().replace(/\/+$/, '')).filter(Boolean) : null
const wanted = (key) => !ONLY || ONLY.some((k) => key === k || key.startsWith(k + '/'))

// ── the prototype: served from its folder, unless --base points at a running server ──────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
function serve(root) {
  const top = path.resolve(root)
  const server = http.createServer((req, res) => {
    const file = path.resolve(top, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (file !== top && !file.startsWith(top + path.sep)) { res.writeHead(403); res.end(); return }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(buf)
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}
// The React build the prototype's runtime would fetch from unpkg, read from node_modules when the versions match.
function localReact(protoDir) {
  try {
    const pinned = /unpkg\.com\/react@([\d.]+)\//.exec(fs.readFileSync(path.join(protoDir, 'support.js'), 'utf8'))?.[1]
    const require = createRequire(import.meta.url)
    if (!pinned || require('react/package.json').version !== pinned || require('react-dom/package.json').version !== pinned) return null
    const umd = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd', file), 'utf8')
    return umd('react', 'react.production.min.js') + '\n' + umd('react-dom', 'react-dom.production.min.js')
  } catch {
    return null
  }
}

let server = null
if (!opts.base) {
  if (!fs.existsSync(path.join(opts.proto, 'HrmsPlatform.dc.html'))) { console.error(`HrmsPlatform.dc.html is not in ${opts.proto}`); process.exit(2) }
  server = await serve(opts.proto)
}
const BASE = (opts.base ? opts.base.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/`) + 'HrmsPlatform.dc.html'
const react = localReact(opts.proto)

const b = await chromium.launch()
fs.mkdirSync(OUT, { recursive: true })
const index = fs.existsSync(`${OUT}/index.json`) ? JSON.parse(fs.readFileSync(`${OUT}/index.json`, 'utf8')) : {}
const errors = []
let captured = 0

async function settle(p) {
  await p.waitForTimeout(900)
}
async function setDark(p) {
  await p.locator('button[aria-label="More modules"]').first().click()
  await p.waitForTimeout(500)
  await p.locator('[role=group][aria-label=Theme] button').first().click()
  await p.waitForTimeout(400)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } })
    if (react) await ctx.addInitScript({ content: react })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(`${width} ${theme}: ${String(e.message).slice(0, 160)}`))
    await p.goto(`${BASE}#admin/dashboard/dashboard/0`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(2500)
    if (theme === 'dark') {
      try { await setDark(p) } catch (e) { errors.push(`dark switch failed at ${width}: ${e.message.slice(0, 120)}`) }
    }
    for (const role of ROLES) {
      const plan = await p.evaluate((r) => {
        const C = window.UTCore
        return C.modsFor(r).map((mk) => ({
          mk,
          label: C.M[mk].label,
          soon: !!C.M[mk].soon,
          pages: C.M[mk].pages.map((pg) => ({ pk: pg[0], label: pg[1], tabs: pg[2] || [] })),
        }))
      }, role)
      for (const m of plan) {
        for (const pg of m.pages) {
          const tabs = pg.tabs.length ? pg.tabs : ['']
          for (let ti = 0; ti < tabs.length; ti++) {
            if (!wanted(`${role}/${m.mk}/${pg.pk}/${ti}`)) continue
            const hash = `#${role}/${m.mk}/${pg.pk}/${ti}`
            await p.setViewportSize({ width, height: 900 })
            await p.evaluate((h) => { location.hash = h }, hash)
            await settle(p)
            // The prototype scrolls inside [data-ut-scroll], so grow the viewport to the content's full height.
            const tall = await p.evaluate(() => {
              const sc = document.querySelector('[data-ut-scroll]')
              if (!sc) return 900
              return Math.ceil(sc.getBoundingClientRect().top + sc.scrollHeight + 2)
            })
            const height = Math.max(900, Math.min(9000, tall))
            if (height > 900) { await p.setViewportSize({ width, height }); await p.waitForTimeout(450) }
            const file = `${role}/${m.mk}__${pg.pk}__${ti}__${theme}__${width}.png`
            fs.mkdirSync(`${OUT}/${role}`, { recursive: true })
            await p.screenshot({ path: `${OUT}/${file}` })
            index[file] = { role, module: m.label, moduleKey: m.mk, page: pg.label, pageKey: pg.pk, tab: tabs[ti] || null, tabIndex: ti, theme, width, height, hash }
            captured++
          }
        }
      }
    }
    // Shell states (admin dashboard)
    const shells = ['more', 'search', 'bell', 'pages-panel'].filter((s) => wanted(`shell/${s}`))
    if (shells.length) {
      fs.mkdirSync(`${OUT}/shell`, { recursive: true })
      await p.setViewportSize({ width, height: 900 })
      await p.evaluate(() => { location.hash = '#admin/dashboard/dashboard/0' })
      await settle(p)
      const shots = [
        ['more', async () => { await p.locator('button[aria-label="More modules"]').first().click() }],
        ['search', async () => { await p.keyboard.press('Control+k') }],
        ['bell', async () => { await p.locator('button[aria-label="Notifications"]').first().click() }],
      ].filter(([name]) => shells.includes(name))
      for (const [name, open] of shots) {
        try {
          await open()
          await p.waitForTimeout(800)
          const file = `shell/${name}__${theme}__${width}.png`
          await p.screenshot({ path: `${OUT}/${file}` })
          index[file] = { role: 'admin', shell: name, theme, width }
          captured++
          await p.keyboard.press('Escape')
          await p.waitForTimeout(500)
        } catch (e) { errors.push(`shell ${name} ${theme} ${width}: ${e.message.slice(0, 120)}`) }
      }
      // Pages panel: click a rail module that has several pages (Workforce)
      if (shells.includes('pages-panel')) {
        try {
          await p.evaluate(() => { location.hash = '#admin/dashboard/dashboard/0' })
          await settle(p)
          await p.locator('button[title="Workforce"]').first().click()
          await p.waitForTimeout(800)
          const file = `shell/pages-panel__${theme}__${width}.png`
          await p.screenshot({ path: `${OUT}/${file}` })
          index[file] = { role: 'admin', shell: 'pages-panel', theme, width }
          captured++
        } catch (e) { errors.push(`pages panel ${theme} ${width}: ${e.message.slice(0, 120)}`) }
      }
    }
    await ctx.close()
    fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1))
    console.log(`done ${width} ${theme}`)
  }
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1))
console.log('files:', Object.keys(index).length, 'captured:', captured, 'errors:', errors.length)
if (ONLY && !captured) console.warn(`nothing matched --only ${opts.only}`)
for (const e of errors.slice(0, 20)) console.log(' ', e)
await b.close()
server?.close()
