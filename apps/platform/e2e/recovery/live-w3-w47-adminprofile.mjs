// Live check of w47 (6 Oct): My profile for an administrator. The client: "leave balance should not be there
// for admin; the admin's profile is not personalised for him — it shows an employee-type profile".
//   - owner@ (OWNER) and admin@ (SUPER_ADMIN), no personal pages: /profile shows their role in plain words,
//     the business at a glance, the admin places they use, the companies they can open, sign-in and their
//     recent activity; tabs Overview · Sign-in & security · Preferences; no Leave / Attendance / My pay /
//     Documents tabs, no leave balance, and none of those reads are made. Sign-in & security has the person's
//     own password, two-factor and sessions, not the workspace rule.
//   - hrm@ (HR_MANAGER) and reader@ (EMPLOYEE), personal pages on: today's employee profile, unchanged.
// Screenshots at 1440 and 390 wide, light and dark: C:/REACT/ut-wt/_results/shots/w47-*.png
// What it creates: nothing (sign-ins only; the theme choice is put back to light).
//
//   node e2e/recovery/live-w3-w47-adminprofile.mjs
//   env: RECOVERY_APP_URL (web app), RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_PASSWORD
/* global process, console, fetch, localStorage */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function session(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  return d
}
async function signIn(page, email) {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Continue without checking in' }), async (b) => { await b.click() })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
function watch(page, label) {
  const errors = [], failed = [], asked = []
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e.message || e)}`))
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) asked.push(u.split('/api')[1]) })
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/') && r.status() >= 400 && !u.includes('/canonical-auth/refresh')) failed.push(`${label}: ${r.status()} ${r.request().method()} ${u.split('/api')[1]}`)
  })
  return { errors, failed, asked }
}
const visible = (locator, timeout = 20_000) => locator.waitFor({ timeout }).then(() => true, () => false)
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

// The employee's own reads the administrator's profile must not make.
const PERSONAL_READS = [/\/leave\/balances/, /\/attendance\/(me|my)/, /\/documents\/(me|my)/, /\/performance\/(goals|reviews)\/(me|my)/, /\/employees\/[^/]+\/(addresses|emergency-contacts)/]

const PEOPLE = [
  { email: 'owner@unifiedtree.demo', key: 'owner', admin: true, role: 'Owner' },
  { email: 'admin@unifiedtree.demo', key: 'admin', admin: true, role: 'Super admin' },
  { email: 'hrm@unifiedtree.demo', key: 'hrm', admin: false },
  { email: 'reader@unifiedtree.demo', key: 'reader', admin: false },
]
const VIEWS = [{ w: 1440, h: 2300, tag: '1440' }, { w: 390, h: 3600, tag: '390' }]

const browser = await chromium.launch()
const watched = []
try {
  for (const p of PEOPLE) {
    const s = await session(p.email)
    check(`${p.key}: the session says personal pages ${p.admin ? 'off' : 'on'}`, s.personalPages === !p.admin, `personalPages=${s.personalPages}`)

    for (const v of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h } })
      const page = await ctx.newPage()
      const w = watch(page, `${p.key}@${v.tag}`)
      watched.push(w)
      await signIn(page, p.email)
      await page.evaluate(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ } })
      await page.goto(base + '/profile')
      const region = page.getByRole('region', { name: 'My profile' })
      check(`${p.key}@${v.tag}: My profile opens`, await visible(region))
      await settle(page)
      const tabs = (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\d+$/, '').trim())

      if (p.admin) {
        check(`${p.key}@${v.tag}: tabs are Overview · Sign-in & security · Preferences`, JSON.stringify(tabs) === JSON.stringify(['Overview', 'Sign-in & security', 'Preferences']), tabs.join(' · '))
        check(`${p.key}@${v.tag}: Your role says ${p.role} in plain words`, await visible(page.locator('.ap-role__name', { hasText: p.role })))
        check(`${p.key}@${v.tag}: the role chip on the card`, await visible(page.locator('.upf-left').getByText(p.role, { exact: false }).first()))
        check(`${p.key}@${v.tag}: companies with the role in each`, await visible(page.getByRole('heading', { name: 'Companies you can open' })) && (await page.locator('#ap-companies [role=listitem], #ap-companies .uk-row').count()) > 0)
        check(`${p.key}@${v.tag}: the business card`, await visible(page.getByRole('heading', { name: 'Business' })))
        check(`${p.key}@${v.tag}: admin places (Dashboard, People)`, await visible(page.getByRole('group', { name: 'Admin places' }).getByText('Dashboard')) && await visible(page.getByRole('group', { name: 'Admin places' }).getByText('People')))
        check(`${p.key}@${v.tag}: recent activity from the audit log`, await visible(page.getByRole('heading', { name: 'Your recent activity' })))
        const body = await region.innerText()
        check(`${p.key}@${v.tag}: no leave balance, attendance, pay or "My …" pieces`, !/Leave balance|This week|My pay|My documents|Payslip|Salary|Work from home/i.test(body))
        const bad = w.asked.filter((u) => PERSONAL_READS.some((rx) => rx.test(u)))
        check(`${p.key}@${v.tag}: none of the employee's own reads are made`, bad.length === 0, bad.slice(0, 4).join(', '))
      } else {
        check(`${p.key}@${v.tag}: today's employee profile (Overview, Personal, Job…)`, tabs[0] === 'Overview' && tabs.includes('Personal') && tabs.includes('Job') && !tabs.includes('Sign-in & security'), tabs.join(' · '))
        check(`${p.key}@${v.tag}: no administrator pieces`, !(await page.locator('.ap-role').count()))
        check(`${p.key}@${v.tag}: Leave stays on the personal profile`, tabs.includes('Leave'))
      }
      await page.screenshot({ path: `${SHOTS}/w47-${p.key}-${v.tag}-light.png` })
      await page.evaluate(() => { try { localStorage.setItem('ut.theme', 'dark') } catch { /* private mode */ } })
      await page.reload()
      await visible(region)
      await settle(page)
      await page.screenshot({ path: `${SHOTS}/w47-${p.key}-${v.tag}-dark.png` })

      if (p.admin && v.tag === '1440') {
        await page.getByRole('tab', { name: 'Sign-in & security' }).click()
        check(`${p.key}: Sign-in & security has password, two-factor and sessions`,
          await visible(page.getByRole('heading', { name: 'Password' }).first()) && await visible(page.getByRole('heading', { name: 'Two-factor authentication' }).first()) && await visible(page.getByRole('heading', { name: 'Active sessions' }).first()))
        check(`${p.key}: the workspace two-factor rule is not on the profile`, !(await page.getByRole('heading', { name: 'Two-factor for the workspace' }).count()))
        await settle(page)
        await page.screenshot({ path: `${SHOTS}/w47-${p.key}-1440-dark-security.png` })
        await page.evaluate(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ } })
        await page.reload()
        await settle(page)
        await page.screenshot({ path: `${SHOTS}/w47-${p.key}-1440-light-security.png` })
        // A #st-twofa link opens the tab.
        await page.goto(base + '/profile#st-twofa')
        check(`${p.key}: a #st-twofa link opens Sign-in & security`, await visible(page.getByRole('tab', { name: 'Sign-in & security', selected: true })))
      }
      await page.evaluate(() => { try { localStorage.setItem('ut.theme', 'light') } catch { /* private mode */ } })
      await ctx.close()
    }
  }
} catch (e) {
  check('the run finished', false, String(e?.stack || e))
} finally {
  await browser.close()
}

const errors = watched.flatMap((w) => w.errors)
const failed = watched.flatMap((w) => w.failed)
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '))
check('no failed API calls', failed.length === 0, failed.slice(0, 8).join(' | '))
const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length ? 1 : 0)
