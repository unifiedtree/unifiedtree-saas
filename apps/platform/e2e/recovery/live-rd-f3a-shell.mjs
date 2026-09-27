// Redesign shell (F3a): the rail, the Pages panel, the top bar and More, per role, against the local API.
//   - Home by permission: owner, HR and finance keep the admin dashboard (and its ?date=); manager and
//     employee go from /dashboard to /me; a custom role goes to the first page it can open; someone
//     with no page goes to /no-access (that last block changes a demo user's roles, so it only runs in
//     the isolated live slot, or with SHELL_ROLE_CHANGES=1, and puts them back).
//   - The rail's groups per role, the lit item (the item you came through stays lit), the Pages panel,
//     the pin (kept per device), More's entries, Preferences (the first settings page the person can
//     open, and More lit there), Help & support, the Light/Dark choice kept across reloads, the "?q="
//     filter chip, the phone drawer at 390, no vendor name, no page errors, no unexpected API errors.
// Read-only except the role block, which removes everything it adds.
//
//   RECOVERY_APP_URL=http://demo.localhost:3115 node e2e/recovery/live-rd-f3a-shell.mjs
/* global console, process, URL, document, localStorage, sessionStorage, fetch */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3115'
const api = process.env.RECOVERY_API_URL || base + '/api'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const roleChanges = process.env.SHELL_ROLE_CHANGES === '1' || /:8080\b/.test(api) || /:8080\b/.test(process.env.RECOVERY_BACKEND || '') || process.env.LIVE_SLOT === '1'
const shots = process.env.SHELL_SHOTS || ''

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }
const note = (msg) => console.log(`NOTE  ${msg}`)

const browser = await chromium.launch()
const pageErrors = []
const failedApi = new Set()
// Expected answers: the session refresh probe (422 with nothing to refresh), the Help & support list
// before its endpoint ships (404), and a person's own restricted reads the pages already make today.
const EXPECTED = [/422 POST \/api\/v1\/canonical-auth\/refresh$/, /404 GET \/api\/v1\/workspace\/admin-contacts$/]
function watch(page, who) {
  page.on('pageerror', (e) => pageErrors.push(`${who}: ${String(e.message || e).slice(0, 200)}`))
  page.on('response', (r) => {
    if (!r.url().includes('/api/') || r.status() < 400) return
    const line = `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`
    if (!EXPECTED.some((re) => re.test(line))) failedApi.add(`${who}: ${line}`)
  })
}

async function signIn(email, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  watch(page, email.split('@')[0] + (width < 700 ? ' (phone)' : ''))
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  // Past the sign-in page and the root's redirect to the post-login landing.
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 60_000 })
  return { context, page }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(400)
}
const at = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const rail = (page) => page.locator('.ut-railwrap nav[aria-label="Primary"]')

/** The desktop rail: its groups (in order) with their items' accessible names, and the lit one. */
const railState = (page) => page.evaluate(() => {
  const nav = document.querySelector('.ut-railwrap nav[aria-label="Primary"]')
  if (!nav) return null
  const name = (a) => a.getAttribute('aria-label') || a.textContent.replace(/\s+/g, ' ').trim()
  const groups = [...nav.querySelectorAll('[role=group]')].map((g) => ({ label: g.getAttribute('aria-label'), items: [...g.querySelectorAll('a.ut-rail__item')].map(name) }))
  const lit = [...nav.querySelectorAll('a[aria-current="page"]')].map(name)
  const more = nav.querySelector('.ut-rail__more')
  return { groups, lit, moreLit: more?.getAttribute('aria-current') === 'page', text: nav.textContent }
})
const panelState = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll('nav[aria-label$=" pages"]')].find((n) => n.getClientRects().length)
  if (!nav) return null
  return { label: nav.getAttribute('aria-label'), rows: [...nav.querySelectorAll('a')].map((a) => a.querySelector('.ut-pages__label')?.textContent.trim()), current: [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.querySelector('.ut-pages__label')?.textContent.trim()) }
})
async function clickRail(page, name) {
  await rail(page).getByRole('link', { name, exact: true }).click()
  await settle(page)
  await page.mouse.move(900, 600)
}
async function openMore(page) {
  await rail(page).locator('.ut-rail__more').click()
  const panel = page.getByRole('dialog', { name: 'More' })
  await panel.waitFor({ timeout: 10_000 })
  return panel
}

// ── Per role, desktop ────────────────────────────────────────────────────────────
const HOME = { owner: '/dashboard', hrm: '/dashboard', fin: '/dashboard', mgr: '/me', reader: '/me' }
const PREFS = { owner: '/settings', hrm: '/settings', fin: '/settings', mgr: '/settings/security', reader: '/settings/security' }

for (const who of ['owner', 'hrm', 'fin', 'mgr', 'reader']) {
  const { context, page } = await signIn(`${who}@unifiedtree.demo`)
  try {
    check(`${who}: signing in lands on All apps`, new URL(page.url()).pathname === '/modules', at(page))

    // Home by permission; the admin dashboard keeps its ?date=, everyone else goes to /me without it.
    await page.goto(base + '/dashboard?date=2026-09-01'); await settle(page)
    const home = HOME[who]
    check(`${who}: /dashboard is ${home === '/dashboard' ? 'their admin dashboard (keeps ?date=)' : 'sent to their Home at /me'}`,
      home === '/dashboard' ? at(page) === '/dashboard?date=2026-09-01' : at(page) === '/me', at(page))

    // The rail's groups, per the design (their own groups first for a self-service Home).
    await page.goto(base + '/profile'); await settle(page)
    const r = await railState(page)
    const labels = r.groups.map((g) => g.label)
    const items = r.groups.flatMap((g) => g.items)
    check(`${who}: the rail starts with the Home group`, labels[0] === 'Home', JSON.stringify(labels))
    check(`${who}: no vendor name on the rail`, !/UnifiedTree HRMS/i.test(r.text), r.text.slice(0, 120))
    if (who === 'reader') {
      check('reader: the rail is Home, then My work (Time, Leave, Pay, Documents, Growth)', JSON.stringify(labels) === JSON.stringify(['Home', 'My work'])
        && JSON.stringify(items) === JSON.stringify(['Home', 'My time', 'My leave', 'My pay', 'My documents', 'My growth']), JSON.stringify(r.groups))
    }
    if (who === 'mgr') {
      check('mgr: Home, My team and My work come first; their admin modules follow', JSON.stringify(labels.slice(0, 3)) === JSON.stringify(['Home', 'My team', 'My work']) && labels.includes('Time'), JSON.stringify(labels))
      const mine = r.groups.find((g) => g.label === 'My work')
      check('mgr: My work\'s Leave reads "My leave" next to the admin Leave', !!mine && mine.items.includes('My leave') && items.includes('Leave'), JSON.stringify(r.groups))
      check('mgr: no admin dashboard on the rail; Home is the self-service Home', items[0] === 'Home' && !items.includes('Dashboard'), JSON.stringify(items))
    }
    if (who === 'hrm' || who === 'fin') {
      check(`${who}: the admin dashboard is Home; My work follows the admin groups; no My team`, items[0] === 'Dashboard' && labels.includes('My work') && labels.indexOf('My work') > labels.indexOf('People') && !labels.includes('My team'), JSON.stringify(labels))
    }
    if (who === 'owner') {
      check('owner: no My work (the roles that run the workspace), and the Business apps group', !labels.includes('My work') && labels.includes('Business apps') && items[0] === 'Dashboard', JSON.stringify(labels))
    }

    // The top block opens Home.
    await rail(page).locator('.ut-rail__brand').click(); await settle(page)
    check(`${who}: the rail's top block opens their Home`, new URL(page.url()).pathname === home, at(page))

    // A rail click lights that item; a module with several pages opens its Pages panel.
    const multi = { owner: 'Workforce', hrm: 'Workforce', fin: 'Payroll', mgr: 'My time', reader: 'My pay' }[who]
    await clickRail(page, multi)
    let s = await railState(page)
    const panel = await panelState(page)
    check(`${who}: clicking ${multi} lights it alone and opens its Pages panel on its first page`, JSON.stringify(s.lit) === JSON.stringify([multi]) && !!panel && panel.current.length === 1 && panel.current[0] === panel.rows[0], `lit ${JSON.stringify(s.lit)}, panel ${JSON.stringify(panel)}`)
    if (panel && panel.rows.length > 1) {
      await page.locator(`nav[aria-label="${panel.label}"]`).getByRole('link', { name: panel.rows[1], exact: true }).click(); await settle(page)
      s = await railState(page)
      const p2 = await panelState(page)
      check(`${who}: a page in the Pages panel keeps ${multi} lit and marks that page`, JSON.stringify(s.lit) === JSON.stringify([multi]) && p2?.current[0] === panel.rows[1], `lit ${JSON.stringify(s.lit)}, panel ${JSON.stringify(p2)}`)
      if (shots && (who === 'hrm' || who === 'reader')) await page.screenshot({ path: `${shots}/rd-f3a-live-${who}-pages-1440.png` })
      // Hide pages → the top bar's Pages button brings it back.
      await page.getByRole('button', { name: 'Hide pages' }).click()
      const btn = page.getByRole('button', { name: /^Show pages: / })
      const shown = await btn.isVisible().catch(() => false)
      if (shown) await btn.click()
      check(`${who}: Hide pages, then the Pages button shows them again`, shown && !!(await panelState(page)), shown ? '' : 'no Pages button')
      // The module reopens on the last page used in it.
      await page.goto(base + '/profile'); await settle(page)
      await clickRail(page, multi)
      check(`${who}: ${multi} reopens on the last page used in it`, (await panelState(page))?.current[0] === panel.rows[1], at(page))
    }

    // The item you came through stays lit on a page two items own (manager: Leave and My leave).
    if (who === 'mgr') {
      await clickRail(page, 'My leave')
      s = await railState(page)
      check('mgr: My leave → /hrms/leave keeps My leave lit', new URL(page.url()).pathname === '/hrms/leave' && JSON.stringify(s.lit) === JSON.stringify(['My leave']), JSON.stringify(s.lit))
      await page.reload(); await settle(page)
      check('mgr: a refresh keeps My leave lit', JSON.stringify((await railState(page)).lit) === JSON.stringify(['My leave']))
      await clickRail(page, 'Leave')
      check('mgr: the admin Leave lights Leave', JSON.stringify((await railState(page)).lit) === JSON.stringify(['Leave']))
      await page.evaluate(() => { try { sessionStorage.removeItem('ut:rail-via') } catch { /* ignore */ } })
      await page.goto(base + '/hrms/leave'); await settle(page)
      check('mgr: a fresh /hrms/leave lights the admin Leave, not My leave', JSON.stringify((await railState(page)).lit) === JSON.stringify(['Leave']))
      await page.goto(base + '/team'); await settle(page)
      check('mgr: /team lights My team', JSON.stringify((await railState(page)).lit) === JSON.stringify(['My team']))
    }

    // More: its entries, My workspace, Preferences, Help & support.
    let more = await openMore(page)
    const moreText = (await more.textContent()).replace(/\s+/g, ' ')
    const want = ['My space', 'My workspace', 'My profile', 'All apps', 'Settings', 'Preferences', 'Help & support', 'Light', 'Dark', 'Sign out', 'View my profile']
    check(`${who}: More lists My space, Settings, Light/Dark and Sign out`, want.every((w) => moreText.includes(w)), moreText.slice(0, 300))
    check(`${who}: More shows no vendor name`, !/UnifiedTree HRMS/i.test(moreText))
    if (shots && (who === 'owner' || who === 'reader')) await page.screenshot({ path: `${shots}/rd-f3a-live-${who}-more-1440.png` })
    await more.getByRole('link', { name: 'My workspace' }).click(); await settle(page)
    check(`${who}: My workspace opens their Home`, new URL(page.url()).pathname === home, at(page))
    more = await openMore(page)
    await more.getByRole('link', { name: 'Preferences' }).click(); await settle(page)
    check(`${who}: Preferences opens the first settings page they can open (${PREFS[who]})`, new URL(page.url()).pathname === PREFS[who] && !(await page.getByText('Access Restricted').isVisible().catch(() => false)), at(page))
    s = await railState(page)
    const sp = await panelState(page)
    check(`${who}: on a settings page More is lit and no rail item`, s.moreLit && s.lit.length === 0, JSON.stringify(s.lit))
    check(`${who}: the settings pages list opens with Preferences`, !!sp && sp.label === 'Settings pages' && sp.rows.includes('Security'), JSON.stringify(sp))
    if (who === 'owner') {
      check('owner: the settings list is today\'s row with Document types after Integrations', JSON.stringify(sp?.rows) === JSON.stringify(['Profile', 'Branding', 'Security', 'Notifications', 'Billing & Plan', 'Integrations', 'Document types', 'Users & Access', 'Roles & Permissions', 'Audit Logs', 'Danger Zone']), JSON.stringify(sp?.rows))
    }
    more = await openMore(page)
    await more.getByRole('button', { name: 'Help & support' }).click()
    const help = page.getByRole('dialog', { name: 'Help & support' })
    await help.waitFor({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const helpText = (await help.textContent().catch(() => '')).replace(/\s+/g, ' ')
    check(`${who}: Help & support opens (the workspace's admins, or "not available yet" until its endpoint ships)`, /Help & support/.test(helpText) && (/@/.test(helpText) || /aren’t available yet|No one to list yet/.test(helpText)) && !/UnifiedTree HRMS|unifiedtree\.com/i.test(helpText), helpText.slice(0, 200))
    await help.getByRole('button', { name: 'Close panel' }).click()

    // Light / Dark, kept on this device across reloads.
    more = await openMore(page)
    await more.getByRole('radio', { name: 'Dark' }).click()
    await page.keyboard.press('Escape')
    await page.reload(); await settle(page)
    const dark = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), saved: localStorage.getItem('ut.theme') }))
    check(`${who}: Dark stays after a reload`, dark.theme === 'dark' && dark.saved === 'dark', JSON.stringify(dark))
    if (shots && who === 'hrm') await page.screenshot({ path: `${shots}/rd-f3a-live-hrm-settings-dark-1440.png` })
    more = await openMore(page)
    await more.getByRole('radio', { name: 'Light' }).click()
    await page.keyboard.press('Escape')
    await page.reload(); await settle(page)
    check(`${who}: Light is back after a reload`, await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'))

    // The pin keeps the rail open (per device).
    await page.goto(base + home); await settle(page)
    // The pin sits in the wide part of the rail: hover it open first.
    await rail(page).hover({ position: { x: 30, y: 300 } }); await page.waitForTimeout(500)
    await rail(page).getByRole('button', { name: 'Keep sidebar open' }).click()
    await page.reload(); await settle(page)
    const pinned = await page.evaluate(() => ({ push: document.querySelector('.ut-railwrap')?.hasAttribute('data-push'), width: document.querySelector('.ut-rail')?.getBoundingClientRect().width }))
    check(`${who}: the pin keeps the rail open after a reload`, pinned.push === true && pinned.width >= 240, JSON.stringify(pinned))
    await rail(page).getByRole('button', { name: 'Collapse sidebar' }).click()
    await page.mouse.move(900, 600); await page.waitForTimeout(600)
    const unpinned = await page.evaluate(() => document.querySelector('.ut-rail')?.getBoundingClientRect().width)
    check(`${who}: Collapse sidebar brings it back to icons`, unpinned <= 80, String(unpinned))

    // The page's name as one pill when it publishes no tabs; the "?q=" chip where the page reads it.
    if (who === 'owner' || who === 'hrm') {
      await page.goto(base + '/hrms/employees?q=zz-no-match'); await settle(page)
      const pill = await page.locator('.ut-topbar .uk-ppill').textContent().catch(() => null)
      check(`${who}: a page without published tabs shows its name as one pill`, pill?.trim() === 'Workforce Directory', String(pill))
      const chip = page.getByRole('button', { name: 'Clear the filter “zz-no-match” on this page' })
      const chipShown = await chip.isVisible().catch(() => false)
      if (chipShown) { await chip.click(); await settle(page) }
      check(`${who}: the "?q=" filter shows as a chip that clears it`, chipShown && !new URL(page.url()).searchParams.has('q'), at(page))
    }
  } catch (e) {
    check(`${who}: run finished`, false, String(e.message || e).slice(0, 300))
  } finally {
    await context.close()
  }
}

// ── Phone: the drawer is the rail expanded plus More ─────────────────────────────
for (const who of ['reader', 'owner']) {
  const { context, page } = await signIn(`${who}@unifiedtree.demo`, 390)
  try {
    await page.goto(base + HOME[who]); await settle(page)
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${who} (phone): no sideways scroll on Home`, wide <= 2, String(wide))
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await drawer.waitFor({ timeout: 10_000 })
    const nav = drawer.getByRole('navigation', { name: 'Primary' })
    const lit = (await nav.locator('a[aria-current="page"]').allTextContents()).map((t) => t.trim())
    const drawerText = (await drawer.textContent()).replace(/\s+/g, ' ')
    check(`${who} (phone): the drawer lights Home and carries More (Preferences, Light/Dark, Sign out)`, lit.length === 1 && /Home|Dashboard/.test(lit[0]) && /Preferences/.test(drawerText) && /Sign out/.test(drawerText) && /Dark/.test(drawerText), `lit ${JSON.stringify(lit)}`)
    if (shots) await page.screenshot({ path: `${shots}/rd-f3a-live-${who}-drawer-390.png` })
    const target = who === 'reader' ? 'My leave' : 'Leave'
    await nav.getByRole('link', { name: target, exact: true }).click(); await settle(page)
    const closed = !(await drawer.isVisible().catch(() => false))
    check(`${who} (phone): a drawer item opens its page and closes the drawer`, closed && new URL(page.url()).pathname === '/hrms/leave', at(page))
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const lit2 = (await page.getByRole('dialog', { name: 'Navigation' }).getByRole('navigation', { name: 'Primary' }).locator('a[aria-current="page"]').allTextContents()).map((t) => t.trim())
    check(`${who} (phone): the drawer lights the item used`, JSON.stringify(lit2) === JSON.stringify(['Leave']), JSON.stringify(lit2))
    await page.getByRole('button', { name: 'Close navigation' }).click()
    const wide2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${who} (phone): no sideways scroll on Leave`, wide2 <= 2, String(wide2))
    await page.getByRole('button', { name: 'Search' }).click()
    const sheet = await page.getByRole('dialog', { name: 'Search' }).isVisible().catch(() => false)
    check(`${who} (phone): the search icon opens today's search`, sheet)
    await page.keyboard.press('Escape')
    // The drawer's Preferences: the settings page, and the top bar's Pages button lists the settings pages over it.
    await page.goto(base + HOME[who]); await settle(page)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Preferences', exact: true }).click(); await settle(page)
    const pagesBtn = page.getByRole('button', { name: 'Show pages: Settings' })
    const hasBtn = await pagesBtn.isVisible().catch(() => false)
    if (hasBtn) await pagesBtn.click()
    const list = page.getByRole('dialog', { name: 'Settings pages' })
    const listed = hasBtn && await list.isVisible({ timeout: 5_000 }).catch(() => false)
    const lit3 = listed ? (await list.locator('a[aria-current="page"]').allTextContents()).map((t) => t.trim()) : []
    check(`${who} (phone): Preferences in the drawer keeps the Pages button, which lists the settings pages with this one lit`, listed && lit3.length === 1, `${at(page)}; button ${hasBtn}, lit ${JSON.stringify(lit3)}`)
  } catch (e) {
    check(`${who} (phone): run finished`, false, String(e.message || e).slice(0, 300))
  } finally {
    await context.close()
  }
}

// ── A custom role and "no page at all" (changes reader's roles; the slot only) ────
if (!roleChanges) {
  note('custom-role and no-access checks skipped (they change a demo user\'s roles: run in the live slot or with SHELL_ROLE_CHANGES=1)')
} else {
  const call = async (path, method = 'GET', body, token) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
    return { status: res.status, json }
  }
  const login = await call('/v1/canonical-auth/login', 'POST', { tenantId, email: 'owner@unifiedtree.demo', password })
  const token = login.json?.accessToken
  const READER = '22222222-2222-2222-2222-222222222222'
  const EMPLOYEE_ROLE = '00000000-0000-0000-0000-000000000004'
  let role = null
  let revoked = false
  try {
    const before = await call(`/v1/rbac/users/${READER}/roles`, 'GET', undefined, token)
    const hadEmployee = JSON.stringify(before.json || '').includes(EMPLOYEE_ROLE) || JSON.stringify(before.json || '').includes('EMPLOYEE')
    check('setup: reader starts with the Employee role', before.status === 200 && hadEmployee, JSON.stringify(before.json).slice(0, 200))
    const created = await call('/v1/rbac/roles', 'POST', { code: `QA_SHELL_${Date.now()}`, displayName: 'Shell home check', description: 'Temporary role for the shell live test; removed by it' }, token)
    role = created.json
    check('setup: a temporary role with no permissions', created.status < 300 && !!role?.id, JSON.stringify(created.json).slice(0, 200))
    const granted = await call(`/v1/rbac/users/${READER}/roles/${role.id}`, 'POST', undefined, token)
    const rev = await call(`/v1/rbac/users/${READER}/roles/${EMPLOYEE_ROLE}`, 'DELETE', undefined, token)
    revoked = rev.status < 300
    check('setup: reader holds only the temporary role', granted.status < 300 && revoked, `${granted.status} / ${rev.status}`)

    // No permission at all: /dashboard ends on /no-access.
    {
      const { context, page } = await signIn('reader@unifiedtree.demo')
      await page.goto(base + '/dashboard'); await settle(page)
      check('none: /dashboard goes to /no-access', new URL(page.url()).pathname === '/no-access', at(page))
      check('none: /no-access explains and offers Sign out', await page.getByRole('heading', { name: 'No access yet' }).isVisible().catch(() => false) && await page.getByRole('button', { name: 'Sign out' }).isVisible().catch(() => false))
      if (shots) await page.screenshot({ path: `${shots}/rd-f3a-live-none-no-access-1440.png` })
      await context.close()
    }
    // A custom role that can only read policies: Home is the first page it can open.
    const put = await call(`/v1/rbac/roles/${role.id}/permissions?acknowledgeRisk=true`, 'PUT', ['hrms.policy.read'], token)
    check('setup: the temporary role reads policies only', put.status < 300, `${put.status} ${JSON.stringify(put.json).slice(0, 160)}`)
    {
      const { context, page } = await signIn('reader@unifiedtree.demo')
      await page.goto(base + '/dashboard'); await settle(page)
      check('custom role: /dashboard goes to the first page it can open (Policies)', new URL(page.url()).pathname === '/hrms/policies', at(page))
      const r = await railState(page)
      check('custom role: the rail shows only what the role opens (My documents › Policies)', !!r && r.groups.flatMap((g) => g.items).every((i) => ['Home', 'My documents'].includes(i)), JSON.stringify(r?.groups))
      await context.close()
    }
  } catch (e) {
    check('role block finished', false, String(e.message || e).slice(0, 300))
  } finally {
    // Put reader back exactly as before, and remove the temporary role.
    if (revoked) {
      const back = await call(`/v1/rbac/users/${READER}/roles/${EMPLOYEE_ROLE}`, 'POST', undefined, token)
      check('cleanup: reader has the Employee role again', back.status < 300 || back.status === 409, String(back.status))
    }
    if (role?.id) {
      await call(`/v1/rbac/users/${READER}/roles/${role.id}`, 'DELETE', undefined, token)
      const del = await call(`/v1/rbac/roles/${role.id}`, 'DELETE', undefined, token)
      check('cleanup: the temporary role is removed', del.status < 300 || del.status === 404, String(del.status))
    }
    const after = await call(`/v1/rbac/users/${READER}/roles`, 'GET', undefined, token)
    check('cleanup: reader\'s roles are as before', after.status === 200 && JSON.stringify(after.json).includes('EMPLOYEE') && !JSON.stringify(after.json).includes('QA_SHELL_'), JSON.stringify(after.json).slice(0, 200))
  }
}

check('no page errors', !pageErrors.length, pageErrors.slice(0, 3).join(' | '))
check('no unexpected API 4xx/5xx', !failedApi.size, [...failedApi].slice(0, 8).join(' | '))
await browser.close()
const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} passed`)
process.exit(pass === results.length ? 0 : 1)
