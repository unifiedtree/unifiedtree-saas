import { test, expect } from '@playwright/test'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://api.unifiedtree.com'
const TENANT_ID = 'a7aba720-d487-4685-a57f-69a9f6c3551b'
const EMAIL = 'priya@demo-hrms.unifiedtree.com'
const PASSWORD = process.env.E2E_ROLE_PASSWORD ?? 'RoleTest@2026'

test('discover hr sidebar', async ({ page, request }) => {
  test.setTimeout(180_000)
  const r = await request.post(`${BACKEND}/api/v1/canonical-auth/login`, {
    data: { tenantId: TENANT_ID, email: EMAIL, password: PASSWORD },
  })
  console.log('login status', r.status())
  const body = await r.json()
  const token = body.accessToken
  console.log('roles', JSON.stringify(body.roles ?? body.user?.roles ?? null))
  await page.goto(`/dashboard?token=${encodeURIComponent(token)}`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  console.log('url after load:', page.url())

  // expand every collapsible group in the sidebar
  const aside = page.locator('aside').first()
  const btns = aside.locator('button')
  const n = await btns.count()
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText().catch(() => '')).trim()
    if (!t) continue
    await btns.nth(i).click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(500)
  const links = await aside.locator('a[href]').evaluateAll((els) =>
    els.map((e) => `${(e as HTMLAnchorElement).getAttribute('href')} :: ${(e.textContent || '').trim()}`))
  console.log('=== SIDEBAR LINKS ===')
  links.forEach((l) => console.log('  ' + l))
  const asideBtns = await aside.locator('button').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()))
  console.log('=== SIDEBAR BUTTONS ===', JSON.stringify(asideBtns))
  await page.screenshot({ path: 'test-results/hr-sidebar.png', fullPage: true })

  // in-page nav on dashboard + hrms pages
  for (const p of ['/dashboard', '/hrms/employees', '/hrms/attendance', '/hrms/leave', '/hrms/payroll', '/settings', '/me']) {
    await page.goto(`${p}?token=${encodeURIComponent(token)}`, { waitUntil: 'load' })
    await page.waitForTimeout(2500)
    const inPage = await page.locator('main a[href], [role="main"] a[href]').evaluateAll((els) =>
      Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href') || ''))))
    const tabs = await page.locator('main button, [role="tab"]').evaluateAll((els) =>
      Array.from(new Set(els.map((e) => (e.textContent || '').trim()).filter(Boolean))))
    console.log(`=== ${p} -> url=${page.url().replace(/\?.*/, '')}`)
    console.log('   links:', JSON.stringify(inPage))
    console.log('   buttons/tabs:', JSON.stringify(tabs.slice(0, 40)))
  }
})
