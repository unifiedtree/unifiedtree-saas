// Live check of the redesign's overlay kit on real pages: the restyled HrDrawer (kit SidePanel),
// the ui-kit Modal and the page toasts, against the local API. Nothing is saved — every pop-up
// is opened and closed again, so there is nothing to clean up.
//
//   node e2e/recovery/live-rd-f2b-overlays.mjs
//
// Owner: Documents → "Add a document" (HrDrawer): a named modal dialog, square panel with a 1px
//   left border, the blurred gradient backdrop as a SIBLING of the panel (never on it), "Close
//   panel"; Escape closes the date picker first, then the drawer, and focus goes back to the
//   button; full width at 390px. Dashboard → "Add notice" (ui-kit Modal): named, 12px radius,
//   the same backdrop, Escape closes it.
// Reader (employee): My attendance → Fix requests → "New request" (HrDrawer "Ask for a fix"),
//   Cancel closes it.
// Both: no page errors and no failed API calls.
/* global process, console, document, getComputedStyle */
import { chromium } from '@playwright/test'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const shots = process.env.RD_SHOTS || 'C:/REACT/ut-wt/_results/shots'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch()
async function signIn(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/canonical-auth/refresh')) failed.push(`${r.status()} ${r.request().method()} ${r.url().split('/api')[1]}`) })
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  errors.length = 0; failed.length = 0
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
  return { page, errors, failed, settle }
}

/** Computed look of the open dialog and its backdrop. */
const panelLook = (dialog) => dialog.evaluate((el) => {
  const cs = getComputedStyle(el)
  const backdrop = el.parentElement?.querySelector(':scope > .uko-backdrop') || null
  const bs = backdrop ? getComputedStyle(backdrop) : null
  return {
    radius: cs.borderTopLeftRadius, borderLeft: cs.borderLeftWidth, ownFilter: cs.backdropFilter,
    width: Math.round(el.getBoundingClientRect().width),
    backdropFilter: bs ? bs.backdropFilter : 'missing', backdropImage: bs ? bs.backgroundImage : 'missing',
  }
})
const focusedText = (page) => page.evaluate(() => (document.activeElement?.textContent || '').trim())

try {
  // ─────────────────────────────── owner ───────────────────────────────
  const o = await signIn('owner@unifiedtree.demo')
  const { page } = o

  await page.goto(base + '/hrms/documents?view=all'); await o.settle()
  const addBtn = page.getByRole('button', { name: /Add document/ }).first()
  await addBtn.click()
  const drawer = page.getByRole('dialog', { name: 'Add a document' })
  await drawer.waitFor({ timeout: 10000 })
  check('owner: "Add a document" opens as a named modal dialog', (await drawer.getAttribute('aria-modal')) === 'true')
  const look = await panelLook(drawer)
  check('drawer: square panel with a 1px left border', look.radius === '0px' && look.borderLeft === '1px', JSON.stringify(look))
  check('drawer: blurred gradient backdrop is a sibling, the panel itself has no backdrop-filter',
    /blur\(4px\)/.test(look.backdropFilter) && /linear-gradient/.test(look.backdropImage) && look.ownFilter === 'none', JSON.stringify(look))
  check('drawer: close button is still "Close panel"', (await drawer.getByRole('button', { name: 'Close panel', exact: true }).count()) === 1)
  await page.screenshot({ path: `${shots}/rd-f2b-drawer-1440.png` }).catch(() => {})

  // A date picker inside the drawer: Escape closes the picker only, then the drawer.
  const dateTrigger = drawer.locator('#doc-issued')
  if (await dateTrigger.count()) {
    await dateTrigger.click()
    const cal = page.getByRole('dialog', { name: /^Choose / })
    const calOpen = await cal.first().waitFor({ timeout: 5000 }).then(() => true, () => false)
    await page.keyboard.press('Escape'); await page.waitForTimeout(250)
    check('drawer: Escape in the date picker leaves the drawer open', calOpen && (await cal.count()) === 0 && (await drawer.count()) === 1)
  } else check('drawer: has a date field to try Escape on', false, 'no #doc-issued field in the drawer')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  check('drawer: Escape closes it', (await drawer.count()) === 0)
  check('drawer: focus goes back to "Add document"', /Add document/.test(await focusedText(page)), await focusedText(page))

  // Phone width: the drawer takes the whole screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await addBtn.click()
  await drawer.waitFor({ timeout: 10000 })
  check('drawer: full width at 390px', (await panelLook(drawer)).width === 390)
  await page.screenshot({ path: `${shots}/rd-f2b-drawer-390.png` }).catch(() => {})
  await drawer.getByRole('button', { name: 'Close panel', exact: true }).click(); await page.waitForTimeout(300)
  check('drawer: "Close panel" closes it', (await drawer.count()) === 0)
  await page.setViewportSize({ width: 1440, height: 900 })

  // ui-kit Modal: the dashboard's "Add notice".
  await page.goto(base + '/dashboard'); await o.settle()
  const addNotice = page.getByRole('button', { name: /Add notice/ }).first()
  if (await addNotice.count()) {
    await addNotice.click()
    const modal = page.getByRole('dialog', { name: 'New notice' })
    await modal.waitFor({ timeout: 10000 })
    const m = await modal.evaluate((el) => {
      const overlay = [...document.querySelectorAll('div')].find((d) => d !== el && getComputedStyle(d).position === 'fixed' && /linear-gradient/.test(getComputedStyle(d).backgroundImage))
      return { radius: getComputedStyle(el).borderTopLeftRadius, filter: getComputedStyle(el).backdropFilter, overlay: overlay ? getComputedStyle(overlay).backdropFilter : 'missing' }
    })
    check('modal: "New notice" has the 12px radius and the blurred backdrop beside it', m.radius === '12px' && m.filter === 'none' && /blur\(4px\)/.test(m.overlay), JSON.stringify(m))
    await page.screenshot({ path: `${shots}/rd-f2b-modal-1440.png` }).catch(() => {})
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check('modal: Escape closes it', (await modal.count()) === 0)
  } else check('owner: dashboard shows "Add notice"', false, 'button not found')

  check('owner: no page errors', o.errors.length === 0, o.errors.slice(0, 2).join(' | '))
  check('owner: no failed API calls', o.failed.length === 0, o.failed.slice(0, 4).join(' | '))

  // ─────────────────────────────── reader / employee ────────────────────
  const me = await signIn('reader@unifiedtree.demo')
  await me.page.goto(base + '/hrms/attendance?tab=corrections'); await me.settle()
  await me.page.getByRole('button', { name: /New request/ }).first().click()
  const fix = me.page.getByRole('dialog', { name: 'Ask for a fix' })
  await fix.waitFor({ timeout: 10000 })
  const fl = await panelLook(fix)
  check('reader: "Ask for a fix" opens with the side-panel look', fl.radius === '0px' && fl.borderLeft === '1px' && /blur\(4px\)/.test(fl.backdropFilter), JSON.stringify(fl))
  check('reader: Tab stays inside the drawer', await (async () => {
    for (let i = 0; i < 8; i++) { await me.page.keyboard.press('Tab'); if (!(await fix.evaluate((el) => el.contains(document.activeElement)))) return false }
    return true
  })())
  await fix.getByRole('button', { name: /^Cancel$/ }).first().click(); await me.page.waitForTimeout(300)
  check('reader: Cancel closes it', (await fix.count()) === 0)
  check('reader: no page errors', me.errors.length === 0, me.errors.slice(0, 2).join(' | '))
  check('reader: no failed API calls', me.failed.length === 0, me.failed.slice(0, 4).join(' | '))
} catch (e) {
  check('run finished without an exception', false, String(e?.message || e).split('\n')[0])
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
