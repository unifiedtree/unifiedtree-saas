// Tests for the overlay & form kit and for the restyled HrDrawer, ConfirmDialog and ui-kit
// Modal/Drawer. The repo has no DOM test environment (no jsdom / happy-dom in the lockfile), so
// these run the real components in headless Chromium: vite serves __tests__/harness.html and
// Playwright drives it. Run just this file:
//   cd apps/platform && npx vitest run src/design/kit
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, type Browser, type Locator, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
let server: ViteDevServer
let browser: Browser
let base = ''

beforeAll(async () => {
  server = await createServer({
    root: appRoot,
    configFile: path.join(appRoot, 'vite.config.ts'),
    cacheDir: path.join(appRoot, 'node_modules/.vite-kit-tests'),
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['src/design/kit/__tests__/harness.html'] },
  })
  await server.listen()
  const address = server.httpServer?.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/src/design/kit/__tests__/harness.html`
  browser = await chromium.launch()
  // Warm up once so dependency optimisation doesn't reload a page in the middle of a test.
  const warm = await browser.newPage()
  await warm.goto(`${base}?case=form`)
  await warm.waitForSelector('body[data-ready]', { timeout: 120_000 })
  await warm.close()
}, 240_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const T = 45_000
interface Opened { page: Page; errors: string[]; log: () => Promise<string[]>; done: () => Promise<void> }

async function open(name: string, opts: { width?: number; clock?: boolean } = {}): Promise<Opened> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 860 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  if (opts.clock) await page.clock.install()
  await page.goto(`${base}?case=${name}`)
  await page.waitForSelector('body[data-ready]')
  return {
    page,
    errors,
    log: () => page.evaluate(() => window.__log.slice()),
    done: async () => { expect(errors).toEqual([]); await context.close() },
  }
}

/** Retries `read` until it equals `want` (or matches it, for a RegExp); vitest 1.x has no expect.poll. */
async function eventually<T>(read: () => Promise<T> | T, want: T | RegExp, timeout = 6000) {
  const end = Date.now() + timeout
  let got: T = await read()
  const ok = (v: T) => (want instanceof RegExp ? want.test(String(v)) : JSON.stringify(v) === JSON.stringify(want))
  while (!ok(got) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); got = await read() }
  if (want instanceof RegExp) expect(String(got)).toMatch(want)
  else expect(got).toEqual(want)
}

/** Waits for CSS animations/transitions on the element to finish (entry pop-in, focus ring fade). */
const settle = (loc: Locator) =>
  loc.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))

const activeInside = (page: Page, selector: string) =>
  page.evaluate((sel) => { const root = document.querySelector(sel); return !!root && !!document.activeElement && root.contains(document.activeElement) }, selector)
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName || '')

describe('SidePanel', () => {
  it('opens as a named modal dialog, focuses itself and closes with the round button, giving focus back', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    const dialog = t.page.getByRole('dialog', { name: 'Create branch' })
    await dialog.waitFor()
    expect(await dialog.getAttribute('aria-modal')).toBe('true')
    expect(await dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(await activeInside(t.page, '[role="dialog"]')).toBe(true)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await eventually(() => dialog.count(), 0)
    expect(await t.log()).toEqual(['close'])
    expect(await activeId(t.page)).toBe('open')
    await t.done()
  }, T)

  it('closes on Escape and on a backdrop click', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    await t.page.click('#open')
    await t.page.mouse.click(40, 400)
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    expect(await t.log()).toEqual(['close', 'close'])
    await t.done()
  }, T)

  it('keeps Tab and Shift+Tab inside the panel', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    for (let i = 0; i < 12; i++) {
      await t.page.keyboard.press('Tab')
      expect(await activeInside(t.page, '[role="dialog"]')).toBe(true)
    }
    for (let i = 0; i < 12; i++) {
      await t.page.keyboard.press('Shift+Tab')
      expect(await activeInside(t.page, '[role="dialog"]')).toBe(true)
    }
    await t.done()
  }, T)

  it('keeps Next inactive with a tooltip until the step is filled, and reports the attempt', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    const next = t.page.getByRole('button', { name: 'Next' })
    expect(await next.getAttribute('aria-disabled')).toBe('true')
    expect(await next.getAttribute('data-tip')).toBe('Add the branch name')
    expect(await next.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') || '')?.textContent)).toBe('Add the branch name')
    // Playwright won't click aria-disabled buttons on its own; a person's click still lands on them.
    await next.click({ force: true })
    await t.page.getByRole('button', { name: 'Location' }).click({ force: true })
    expect(await t.page.locator('[aria-current="step"]').innerText()).toContain('Branch details')
    expect(await t.log()).toEqual(['blocked:0:Add the branch name', 'blocked:0:Add the branch name'])
    await t.page.getByLabel('Branch name').fill('Pune office')
    expect(await next.getAttribute('aria-disabled')).toBeNull()
    await next.click()
    expect(await t.page.locator('[aria-current="step"]').innerText()).toContain('Location')
    expect(await t.page.locator('.uko-step').first().getAttribute('data-state')).toBe('done')
    expect(await t.page.evaluate(() => document.activeElement?.textContent)).toBe('Location')
    await t.done()
  }, T)

  it('never loses typed input when moving between steps (controlled and uncontrolled fields)', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    await t.page.getByLabel('Branch name').fill('Pune office')
    await t.page.getByLabel('Code').fill('PUN')
    await t.page.getByRole('button', { name: 'Next' }).click()
    await t.page.getByLabel('City').fill('Pune')
    await t.page.getByRole('button', { name: 'Back' }).click()
    expect(await t.page.getByLabel('Branch name').inputValue()).toBe('Pune office')
    expect(await t.page.getByLabel('Code').inputValue()).toBe('PUN')
    await t.page.getByRole('button', { name: /Location/ }).click()
    expect(await t.page.getByLabel('City').inputValue()).toBe('Pune')
    await t.done()
  }, T)

  it('walks every step and finishes with the final action', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    await t.page.getByLabel('Branch name').fill('Pune office')
    await t.page.getByRole('button', { name: 'Next' }).click()
    await t.page.getByLabel('City').fill('Pune')
    await t.page.getByRole('dialog').getByText('Mark as headquarters').click()
    await t.page.getByRole('button', { name: 'Next' }).click()
    await t.page.getByRole('slider', { name: /Radius/ }).focus()
    await t.page.keyboard.press('ArrowRight')
    await t.page.getByRole('button', { name: 'Next' }).click()
    expect(await t.page.getByTestId('review').innerText()).toBe('Pune office · Pune, Karnataka')
    await t.page.getByRole('button', { name: 'Create branch' }).click()
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    expect((await t.log()).filter((l) => l.startsWith('finish'))).toEqual(['finish:Pune office|Pune|Karnataka|true|160|true'])
    await t.done()
  }, T)

  it('uses the design look: square panel with a 1px left border, blur only on the sibling backdrop', async () => {
    const t = await open('sidepanel')
    await t.page.click('#open')
    const look = await t.page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
      const backdrop = document.querySelector<HTMLElement>('.uko-backdrop')!
      const ps = getComputedStyle(panel), bs = getComputedStyle(backdrop)
      return {
        radius: ps.borderTopLeftRadius, borderLeft: ps.borderLeftWidth, panelFilter: ps.backdropFilter, width: Math.round(panel.getBoundingClientRect().width),
        backdropFilter: bs.backdropFilter, backdropImage: bs.backgroundImage, sibling: backdrop.parentElement === panel.parentElement, stepList: Math.round(document.querySelector('.uko-steps')!.getBoundingClientRect().width),
      }
    })
    expect(look.radius).toBe('0px')
    expect(look.borderLeft).toBe('1px')
    expect(look.panelFilter).toBe('none')
    expect(look.width).toBe(680)
    expect(look.backdropFilter).toContain('blur(4px)')
    expect(look.backdropImage).toContain('linear-gradient')
    expect(look.sibling).toBe(true)
    expect(look.stepList).toBe(228)
    await t.done()
  }, T)

  it('goes full width on a phone with the steps in a row', async () => {
    const t = await open('sidepanel', { width: 390 })
    await t.page.click('#open')
    const box = await t.page.getByRole('dialog').boundingBox()
    expect(Math.round(box!.width)).toBe(390)
    expect(await t.page.locator('.uko-steps').evaluate((el) => getComputedStyle(el).flexDirection)).toBe('row')
    await t.done()
  }, T)
})

describe('layers: Escape closes only the top one', () => {
  it('a dropdown inside a panel, then the panel', async () => {
    const t = await open('nested')
    await t.page.click('#open')
    await t.page.locator('.uko-dd-trigger').click()
    await t.page.getByRole('listbox', { name: 'Company' }).waitFor()
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('listbox').count(), 0)
    expect(await t.page.getByRole('dialog', { name: 'Edit branch' }).count()).toBe(1)
    expect(await t.page.evaluate(() => document.activeElement?.classList.contains('uko-dd-trigger'))).toBe(true)
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    expect(await t.log()).toEqual(['panel-close'])
    await t.done()
  }, T)

  it('a dialog over a panel: Escape closes the dialog, focus returns, Tab stays in the dialog', async () => {
    const t = await open('nested')
    await t.page.click('#open')
    await t.page.click('#delete')
    const dialog = t.page.getByRole('dialog', { name: 'Delete Pune office?' })
    await dialog.waitFor()
    for (let i = 0; i < 6; i++) {
      await t.page.keyboard.press('Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
    await t.page.keyboard.press('Escape')
    await eventually(() => dialog.count(), 0)
    expect(await t.page.getByRole('dialog', { name: 'Edit branch' }).count()).toBe(1)
    expect(await activeId(t.page)).toBe('delete')
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    expect(await t.log()).toEqual(['dialog-close', 'panel-close'])
    await t.done()
  }, T)

  it('the dialog has the design look: 12px radius and the popover shadow', async () => {
    const t = await open('nested')
    await t.page.click('#open')
    await t.page.click('#delete')
    const s = await t.page.getByRole('dialog', { name: 'Delete Pune office?' }).evaluate((el) => {
      const cs = getComputedStyle(el); return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow }
    })
    expect(s.radius).toBe('12px')
    expect(s.shadow).toContain('60px -20px')
    await t.done()
  }, T)
})

describe('Menu', () => {
  it('opens on the first item, moves with the keyboard, skips disabled rows and chooses with Enter', async () => {
    const t = await open('menu')
    await t.page.click('#trigger')
    const menu = t.page.getByRole('menu', { name: 'Account' })
    await menu.waitFor()
    await eventually(() => t.page.evaluate(() => document.activeElement?.textContent), 'My profile')
    await t.page.keyboard.press('ArrowDown')
    expect(await t.page.evaluate(() => document.activeElement?.textContent)).toBe('Preferences')
    await t.page.keyboard.press('ArrowDown')
    expect(await t.page.evaluate(() => document.activeElement?.textContent)).toBe('Sign out')
    await t.page.keyboard.press('End')
    await t.page.keyboard.press('Home')
    await t.page.keyboard.type('p')
    expect(await t.page.evaluate(() => document.activeElement?.textContent)).toBe('Preferences')
    await t.page.keyboard.press('Enter')
    await eventually(() => menu.count(), 0)
    expect(await t.log()).toEqual(['menu:prefs'])
    expect(await activeId(t.page)).toBe('trigger')
    await t.done()
  }, T)

  it('closes on Escape (focus back on the trigger), on an outside press, and moves on with Tab', async () => {
    const t = await open('menu')
    await t.page.click('#trigger')
    await t.page.getByRole('menu').waitFor()
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('menu').count(), 0)
    expect(await activeId(t.page)).toBe('trigger')
    await t.page.click('#trigger')
    await t.page.getByRole('menu').waitFor()
    await t.page.mouse.click(900, 600)
    await eventually(() => t.page.getByRole('menu').count(), 0)
    await t.page.click('#trigger')
    await t.page.getByRole('menu').waitFor()
    await eventually(() => t.page.evaluate(() => document.activeElement?.textContent), 'My profile')
    await t.page.keyboard.press('Tab')
    await eventually(() => t.page.getByRole('menu').count(), 0)
    expect(await activeId(t.page)).toBe('after')
    expect(await t.log()).toEqual([])
    await t.done()
  }, T)

  it('has the popover look (12px radius) and names disabled rows', async () => {
    const t = await open('menu')
    await t.page.click('#trigger')
    const pop = t.page.locator('.uko-pop')
    await pop.waitFor()
    expect(await pop.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('12px')
    expect(await t.page.getByRole('menuitem', { name: 'Archived items' }).getAttribute('aria-disabled')).toBe('true')
    await t.done()
  }, T)
})

describe('Dropdown', () => {
  it('searches with a live count, picks with Enter and shows the choice in the trigger', async () => {
    const t = await open('dropdown')
    const trigger = t.page.locator('.uko-dd-trigger')
    expect(await trigger.textContent()).toContain('Company 1 of 3')
    await trigger.click()
    const search = t.page.getByRole('combobox', { name: 'Search company' })
    await eventually(() => t.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.placeholder), 'Search companies…')
    expect(await t.page.locator('.uko-dd-count').innerText()).toBe('3 total')
    expect(await t.page.getByRole('option', { selected: true }).innerText()).toContain('Demo Technologies Pvt Ltd')
    await search.fill('retail')
    expect(await t.page.getByRole('option').count()).toBe(1)
    expect(await t.page.locator('.uko-dd-count').innerText()).toBe('1 of 3')
    await t.page.keyboard.press('Enter')
    await eventually(() => t.page.getByRole('listbox').count(), 0)
    expect(await t.log()).toEqual(['pick:dr'])
    expect(await trigger.textContent()).toContain('Demo Retail Pvt Ltd')
    expect(await trigger.textContent()).toContain('Company 2 of 3')
    expect(await t.page.evaluate(() => document.activeElement?.classList.contains('uko-dd-trigger'))).toBe(true)
    await t.done()
  }, T)

  it('shows the empty line, moves with the arrow keys, and runs the footer action', async () => {
    const t = await open('dropdown')
    await t.page.locator('.uko-dd-trigger').click()
    const search = t.page.getByRole('combobox', { name: 'Search company' })
    await search.fill('zzz')
    expect(await t.page.getByText('No company matches that search.').isVisible()).toBe(true)
    expect(await t.page.locator('.uko-dd-count').innerText()).toBe('0 of 3')
    await search.fill('')
    await t.page.keyboard.press('ArrowDown')
    const active = await search.getAttribute('aria-activedescendant')
    expect(await t.page.locator(`[id="${active}"]`).innerText()).toContain('Demo Retail')
    await t.page.getByRole('button', { name: 'Add company' }).click()
    await eventually(() => t.page.getByRole('listbox').count(), 0)
    expect(await t.log()).toEqual(['add-company'])
    await t.done()
  }, T)

  it('closes on Escape without changing the value', async () => {
    const t = await open('dropdown')
    await t.page.locator('.uko-dd-trigger').click()
    await t.page.getByRole('listbox').waitFor()
    await t.page.keyboard.press('ArrowDown')
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('listbox').count(), 0)
    expect(await t.log()).toEqual([])
    await t.done()
  }, T)
})

describe('Toast', () => {
  const freeze = async (page: Page) => { const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 50) }

  it('success: bottom centre, role=status, gone after 2.6s, then onExpire', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#ok')
    const toast = t.page.locator('.uko-toast')
    await toast.waitFor()
    expect(await toast.getAttribute('role')).toBe('status')
    await settle(toast)
    const box = await toast.boundingBox()
    expect(Math.round(box!.x + box!.width / 2)).toBe(640)
    expect(Math.round(860 - (box!.y + box!.height))).toBe(24)
    await t.page.clock.runFor(2500)
    expect(await toast.count()).toBe(1)
    await t.page.clock.runFor(200)
    await eventually(() => toast.count(), 0)
    expect(await t.log()).toEqual(['ok-expired'])
    await t.done()
  }, T)

  it('error: role=alert and stays 7s', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#err')
    const toast = t.page.getByRole('alert')
    await toast.waitFor()
    expect(await toast.innerText()).toContain('The server said no.')
    await t.page.clock.runFor(6900)
    expect(await toast.count()).toBe(1)
    await t.page.clock.runFor(200)
    await eventually(() => toast.count(), 0)
    await t.done()
  }, T)

  it('undo: counts down, Undo reverts and never expires', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#undo')
    const undo = t.page.locator('.uko-toast').getByRole('button', { name: /^Undo/ })
    await undo.waitFor()
    expect(await undo.innerText()).toMatch(/Undo\s*5s/)
    await t.page.clock.runFor(1100)
    await eventually(() => undo.innerText(), /Undo\s*4s/)
    await undo.click()
    await eventually(() => t.page.locator('.uko-toast').count(), 0)
    await t.page.clock.runFor(6000)
    expect(await t.log()).toEqual(['undone'])
    await t.done()
  }, T)

  it('undo: when the countdown runs out the toast goes and onExpire fires (hover does not stretch it)', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#undo')
    const toast = t.page.locator('.uko-toast')
    await toast.waitFor()
    await toast.hover()
    await t.page.clock.runFor(4900)
    expect(await toast.count()).toBe(1)
    await t.page.clock.runFor(200)
    await eventually(() => toast.count(), 0)
    expect(await t.log()).toEqual(['undo-expired'])
    await t.done()
  }, T)

  it('a plain toast pauses while the pointer is on it', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#ok')
    const toast = t.page.locator('.uko-toast')
    await toast.waitFor()
    await t.page.clock.runFor(2000)
    await toast.hover()
    await t.page.clock.runFor(3000)
    expect(await toast.count()).toBe(1)
    await t.page.mouse.move(5, 5)
    await t.page.clock.runFor(700)
    await eventually(() => toast.count(), 0)
    await t.done()
  }, T)

  it('useDesignToast keeps its call signature and renders the kit toast (success 2.6s, error 7s, Dismiss)', async () => {
    const t = await open('toast', { clock: true })
    await freeze(t.page)
    await t.page.click('#design-ok')
    const ok = t.page.getByRole('status').filter({ hasText: 'Leave approved' })
    await ok.waitFor()
    expect(await ok.getAttribute('class')).toContain('uko-toast')
    await t.page.clock.runFor(2700)
    await eventually(() => ok.count(), 0)
    await t.page.click('#design-err')
    const err = t.page.getByRole('alert').filter({ hasText: 'Could not approve' })
    await err.waitFor()
    expect(await err.innerText()).toContain('Try again in a minute.')
    await t.page.clock.runFor(6800)
    expect(await err.count()).toBe(1)
    await err.getByRole('button', { name: 'Dismiss' }).click()
    await eventually(() => err.count(), 0)
    await t.done()
  }, T)
})

describe('FormField', () => {
  it('ties label, hint and inline error to the control', async () => {
    const t = await open('form')
    const input = t.page.getByLabel('Branch name')
    expect(await input.getAttribute('aria-invalid')).toBe('true')
    expect(await input.getAttribute('required')).not.toBeNull()
    const described = (await input.getAttribute('aria-describedby'))!.split(' ')
    const texts = await Promise.all(described.map((id) => t.page.locator(`[id="${id}"]`).innerText()))
    expect(texts).toEqual(['As people will see it', 'Add the branch name'])
    await input.fill('Pune office')
    expect(await input.getAttribute('aria-invalid')).toBeNull()
    expect(await t.page.getByText('Add the branch name').count()).toBe(0)
    await t.done()
  }, T)

  it('shows the brand focus ring', async () => {
    const t = await open('form')
    await t.page.getByLabel('State').focus()
    await settle(t.page.getByLabel('State'))
    const s = await t.page.getByLabel('State').evaluate((el) => { const cs = getComputedStyle(el); return { border: cs.borderTopColor, shadow: cs.boxShadow } })
    expect(s.border).toBe('rgb(15, 110, 86)')
    expect(s.shadow).toContain('rgb(232, 243, 238)')
    await t.done()
  }, T)

  it('switch, slider and check card work by pointer and keyboard', async () => {
    const t = await open('form')
    const sw = t.page.getByRole('switch', { name: 'Only allow check-in inside this area' })
    expect(await sw.getAttribute('aria-checked')).toBe('false')
    await t.page.getByText('Mobile and web punches outside it are flagged').click()
    expect(await sw.getAttribute('aria-checked')).toBe('true')
    await sw.focus()
    await t.page.keyboard.press('Space')
    expect(await sw.getAttribute('aria-checked')).toBe('false')
    const slider = t.page.getByRole('slider', { name: /Radius/ })
    expect(await slider.getAttribute('aria-valuetext')).toBe('150 m')
    await slider.focus()
    await t.page.keyboard.press('ArrowRight')
    expect(await slider.getAttribute('aria-valuetext')).toBe('160 m')
    expect(await t.page.locator('.uko-slider-value').innerText()).toBe('160 m')
    await t.page.getByText('Main address on letters and payslips.').click()
    expect(await t.page.getByRole('checkbox', { name: 'Mark as headquarters' }).isChecked()).toBe(true)
    expect(await t.log()).toEqual(['toggle:true', 'toggle:false', 'check:true'])
    await t.done()
  }, T)

  it('date fields are the shared calendar, even when type="date" is asked for', async () => {
    const t = await open('form')
    expect(await t.page.locator('input[type="date"], input[type="month"]').count()).toBe(0)
    expect(await t.page.locator('.uko-field .utc-field').count()).toBe(2)
    const day = t.page.getByLabel('Joining date')
    await day.click()
    const cal = t.page.getByRole('dialog', { name: 'Choose date' })
    await cal.waitFor()
    await cal.getByRole('button', { name: 'Today' }).click()
    await eventually(async () => (await t.log()).length, 1)
    expect((await t.log())[0]).toMatch(/^day:\d{4}-\d{2}-\d{2}$/)
    await t.done()
  }, T)
})

describe('ApprovalRow', () => {
  it('compact: approve, then Undo while allowed', async () => {
    const t = await open('approval')
    const row = t.page.locator('#compact')
    await row.getByRole('button', { name: 'Approve' }).click()
    expect(await row.getByText('Approved').isVisible()).toBe(true)
    expect(await row.getByRole('button', { name: 'Approve' }).count()).toBe(0)
    await row.getByRole('button', { name: 'Undo' }).click()
    expect(await row.getByRole('button', { name: 'Reject' }).isVisible()).toBe(true)
    expect(await t.log()).toEqual(['approve:a', 'undo:a'])
    await t.done()
  }, T)

  it('compact: Undo hides by itself once undoUntil has passed', async () => {
    const t = await open('approval', { clock: true })
    const row = t.page.locator('#compact')
    await row.getByRole('button', { name: 'Reject' }).click()
    expect(await row.getByText('Rejected').isVisible()).toBe(true)
    expect(await row.getByRole('button', { name: 'Undo' }).count()).toBe(1)
    await t.page.clock.runFor(3500)
    await eventually(() => row.getByRole('button', { name: 'Undo' }).count(), 0)
    expect(await t.log()).toEqual(['reject:a'])
    await t.done()
  }, T)

  it('card: passes the note to the callback and shows the one-line result with Undo', async () => {
    const t = await open('approval')
    const card = t.page.locator('#card')
    expect(await card.innerText()).toContain('Two of eight people out on 7–8 Oct')
    await card.getByRole('textbox', { name: 'Note for Kavya Menon' }).fill('ok by me')
    await card.getByRole('button', { name: 'Approve' }).click()
    expect(await card.innerText()).toMatch(/Approved · Kavya Menon · Earned leave/)
    await card.getByRole('button', { name: 'Undo' }).click()
    expect(await card.getByRole('button', { name: 'Approve' }).isVisible()).toBe(true)
    expect(await t.log()).toEqual(['approve:b:ok by me', 'undo:b'])
    await t.done()
  }, T)

  it('shows no buttons when no callbacks are given', async () => {
    const t = await open('approval')
    expect(await t.page.locator('#readonly').getByRole('button').count()).toBe(0)
    await t.done()
  }, T)
})

describe('HrDrawer (restyled, same API)', () => {
  it('keeps its dialog name, "Close panel", focus handling and footer', async () => {
    const t = await open('hrdrawer')
    await t.page.click('#open')
    const drawer = t.page.getByRole('dialog', { name: 'Reject advance' })
    await drawer.waitFor()
    expect(await drawer.getAttribute('aria-modal')).toBe('true')
    expect(await drawer.locator('h3').innerText()).toBe('Reject advance')
    expect(await t.page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('dialog')
    expect(await drawer.getByRole('button', { name: 'Confirm rejection' }).isVisible()).toBe(true)
    await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
    await eventually(() => drawer.count(), 0)
    expect(await t.log()).toEqual(['hr-close'])
    expect(await activeId(t.page)).toBe('open')
    await t.done()
  }, T)

  it('closes on Escape and on the backdrop; Tab stays inside', async () => {
    const t = await open('hrdrawer')
    await t.page.click('#open')
    for (let i = 0; i < 10; i++) {
      await t.page.keyboard.press('Tab')
      expect(await activeInside(t.page, '[role="dialog"]')).toBe(true)
    }
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    await t.page.click('#open')
    await t.page.mouse.click(40, 400)
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    expect(await t.log()).toEqual(['hr-close', 'hr-close'])
    await t.done()
  }, T)

  it('Escape in the calendar or a select inside closes only that, not the drawer', async () => {
    const t = await open('hrdrawer')
    await t.page.click('#open')
    const drawer = t.page.getByRole('dialog', { name: 'Reject advance' })
    await drawer.getByLabel('Pay back from').click()
    await t.page.getByRole('dialog', { name: 'Choose date' }).waitFor()
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog', { name: 'Choose date' }).count(), 0)
    expect(await drawer.count()).toBe(1)
    await drawer.getByRole('button', { name: 'First' }).click()
    await t.page.getByRole('listbox').waitFor()
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('listbox').count(), 0)
    expect(await drawer.count()).toBe(1)
    expect(await t.log()).toEqual([])
    await t.done()
  }, T)

  it('keeps its width class, goes full width on phones, and has the design look', async () => {
    const wide = await open('hrdrawer')
    await wide.page.click('#open')
    const look = await wide.page.getByRole('dialog').evaluate((el) => {
      const cs = getComputedStyle(el); return { width: Math.round(el.getBoundingClientRect().width), radius: cs.borderTopLeftRadius, border: cs.borderLeftWidth, filter: cs.backdropFilter }
    })
    expect(look).toEqual({ width: 448, radius: '0px', border: '1px', filter: 'none' })
    await wide.done()
    const phone = await open('hrdrawer', { width: 390 })
    await phone.page.click('#open')
    expect(Math.round((await phone.page.getByRole('dialog').boundingBox())!.width)).toBe(390)
    await phone.done()
  }, T)
})

describe('ui-kit Modal and Drawer (restyled, same API)', () => {
  it('Modal: named dialog with description, 12px radius, Escape and Close work', async () => {
    const t = await open('uikit')
    await t.page.click('#open-modal')
    const modal = t.page.getByRole('dialog', { name: 'Cancel this leave?' })
    await modal.waitFor()
    expect(await modal.innerText()).toContain('The days go back to your balance.')
    expect(await modal.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('12px')
    await t.page.keyboard.press('Escape')
    await eventually(() => modal.count(), 0)
    await t.page.click('#open-modal')
    await modal.waitFor()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await eventually(() => modal.count(), 0)
    expect(await t.log()).toEqual(['modal:false', 'modal:false'])
    await t.done()
  }, T)

  it('Drawer: square side panel, backdrop closes it', async () => {
    const t = await open('uikit')
    await t.page.click('#open-drawer')
    const drawer = t.page.getByRole('dialog', { name: 'Manage access' })
    await drawer.waitFor()
    expect(await drawer.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px')
    await t.page.mouse.click(40, 400)
    await eventually(() => drawer.count(), 0)
    // Unchanged from before the restyle: the backdrop's own onClick and Radix's outside press both report the close.
    expect(new Set(await t.log())).toEqual(new Set(['drawer:false']))
    await t.done()
  }, T)
})

describe('ConfirmDialog (restyled, same API)', () => {
  it('focuses Confirm so Enter confirms, then gives focus back', async () => {
    const t = await open('confirm')
    await t.page.click('#ask')
    const dialog = t.page.getByRole('dialog', { name: 'Delete template?' })
    await dialog.waitFor()
    expect(await t.page.locator('#confirm-dialog-title').innerText()).toBe('Delete template?')
    expect(await dialog.innerText()).toContain('This cannot be undone.')
    await eventually(() => t.page.evaluate(() => document.activeElement?.textContent), 'Delete')
    await t.page.keyboard.press('Enter')
    await eventually(() => dialog.count(), 0)
    await eventually(() => t.log(), ['confirm:true'])
    expect(await activeId(t.page)).toBe('ask')
    await t.done()
  }, T)

  it('resolves false on Escape, on the backdrop and on Cancel', async () => {
    const t = await open('confirm')
    await t.page.click('#ask')
    await t.page.getByRole('dialog').waitFor()
    await t.page.keyboard.press('Escape')
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    await t.page.click('#ask')
    await t.page.getByRole('dialog').waitFor()
    await t.page.mouse.click(30, 700)
    await eventually(() => t.page.getByRole('dialog').count(), 0)
    await t.page.click('#ask-plain')
    const plain = t.page.getByRole('dialog', { name: 'Send reminders?' })
    await plain.waitFor()
    expect(await plain.getByRole('button', { name: 'Confirm' }).isVisible()).toBe(true)
    await plain.getByRole('button', { name: 'Cancel' }).click()
    await eventually(() => t.log(), ['confirm:false', 'confirm:false', 'plain:false'])
    await t.done()
  }, T)
})
