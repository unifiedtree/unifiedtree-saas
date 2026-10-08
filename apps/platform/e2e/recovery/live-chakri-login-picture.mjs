// Live check for chakri/login-picture: the business's sign-in picture (owner, 6 Oct 2026; V144_3).
//
//   live-slot.sh /c/REACT/ut-wt/chakri-login-picture 3104 node e2e/recovery/live-chakri-login-picture.mjs
//
//  - owner uploads a 1200 × 800 PNG (POST /v1/workspace/branding/login) -> the answer carries loginUrl;
//  - the public sign-in lookup (GET /v1/public/workspace-branding?subdomain=demo) returns loginUrl, and the
//    image itself is served;
//  - the business login page (1440 wide) shows it in place of the standard panel;
//  - a 800 × 400 picture is refused (too small for a large screen);
//  - Remove -> loginUrl is null again and the standard panel is back.
/* global process, console, fetch, Blob, FormData */
import { chromium } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const shots = process.env.W3_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
mkdirSync(shots, { recursive: true })

/** A plain PNG of the given size: an emerald-to-gold gradient, so it's easy to see on the page. */
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3, t = x / w
      raw[i] = Math.round(15 + t * 220); raw[i + 1] = Math.round(110 + t * 60); raw[i + 2] = Math.round(86 - t * 60)
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const login = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password }) }).then((r) => r.json())
const auth = { 'X-Tenant-ID': tenant, Authorization: `Bearer ${login.accessToken}` }
const upload = async (buf) => {
  const form = new FormData(); form.append('file', new Blob([buf], { type: 'image/png' }), 'signin.png')
  const r = await fetch(`${api}/v1/workspace/branding/login`, { method: 'POST', headers: auth, body: form })
  const text = await r.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json }
}
const publicView = () => fetch(`${api}/v1/public/workspace-branding?subdomain=demo`).then((r) => r.json())

let browser
try {
  const up = await upload(png(1200, 800))
  check('owner uploads a 1200 × 800 sign-in picture', up.status >= 200 && up.status < 300 && !!up.json?.loginUrl, `${up.status} ${JSON.stringify(up.json).slice(0, 160)}`)
  const pub = await publicView()
  check('the public sign-in lookup returns it', !!pub?.loginUrl, JSON.stringify(pub).slice(0, 200))
  const img = pub?.loginUrl ? await fetch(api + pub.loginUrl.replace(/^\/?/, '/').replace(/^\/api/, '')) : null
  check('the picture itself is served', img?.status === 200 && (img.headers.get('content-type') || '').startsWith('image/png'), String(img?.status))

  const small = await upload(png(800, 400))
  check('a picture too small for a large screen is refused', small.status === 422 && JSON.stringify(small.json).includes('600'), `${small.status} ${JSON.stringify(small.json).slice(0, 140)}`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('input[type=email]').waitFor({ timeout: 90000 })
  const pic = page.locator('aside img')
  await pic.waitFor({ timeout: 20000 }).catch(() => {})
  check('web: the sign-in page shows the business\'s picture', await pic.isVisible().catch(() => false))
  await page.screenshot({ path: `${shots}/chakri-login-picture-1440.png` })

  const del = await fetch(`${api}/v1/workspace/branding/login`, { method: 'DELETE', headers: auth })
  check('Remove: the picture is gone', del.status === 200 && !(await publicView())?.loginUrl, String(del.status))
  // The public lookup is cached for 60 s in a browser that already loaded it (like the logo): a new visitor
  // sees the change at once.
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await fresh.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await fresh.locator('input[type=email]').waitFor({ timeout: 60000 })
  await fresh.waitForTimeout(2500)
  check('web: a new visitor sees the standard panel again', (await fresh.locator('aside img').count()) === 0)
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  await fetch(`${api}/v1/workspace/branding/login`, { method: 'DELETE', headers: auth }).catch(() => {})
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
