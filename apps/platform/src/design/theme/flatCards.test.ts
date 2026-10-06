// Owner decision, 6 Oct 2026: cards have no shadow or glow round them (the inside stays as it is).
// Hover and selected change the border colour; keyboard focus is the app-wide 2px outline; menus,
// popovers, dialogs and drawers float over the page and keep the popover shadow.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const tokens = read('./tokens.css')
const display = read('../kit/display.css')
const dashboard = read('../../modules/hrms/dashboard/dashboard.css')

const block = (css: string, selector: string) => {
  const i = css.indexOf(selector + ' {')
  expect(i, selector).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}
const rule = (css: string, selector: string) => {
  const line = css.split('\n').find((l) => l.startsWith(selector + ' {'))
  expect(line, selector).toBeTruthy()
  return line as string
}

describe('flat cards', () => {
  it('the card and hover shadows are none in both themes; the popover shadow stays', () => {
    for (const theme of [block(tokens, ':root'), block(tokens, "[data-theme='dark']")]) {
      expect(theme).toMatch(/--u-shc: none;/)
      expect(theme).toMatch(/--u-shh: none;/)
      expect(theme).toMatch(/--u-shp: 0 24px 60px -20px/)
    }
  })

  it('live stat tiles have no glow at rest, on hover or on focus', () => {
    const live = display.slice(display.indexOf('.uk-stat.uk-stat--live,\n.uk-stat.uk-stat--live-stack {'))
    expect(live.slice(0, live.indexOf('}'))).toMatch(/box-shadow: none;/)
    expect(display).not.toMatch(/0 26px 46px -28px color-mix/)
    expect(display).toMatch(/\.uk-stat\.uk-stat--live-stack:focus-visible \{[^}]*box-shadow: none;/)
    expect(display).toMatch(/:is\(\.uk-stat\.uk-stat--link, \.uk-qa\):focus-visible \{[^}]*box-shadow: none;/)
  })

  it('the dashboard filter tiles change the border instead of a shadow', () => {
    for (const sel of ['.ud-tile:hover', '.ud-tile:focus-visible', '.ud-tile[aria-pressed="true"]']) {
      expect(rule(dashboard, sel)).not.toMatch(/box-shadow/)
    }
    expect(rule(dashboard, '.ud-tile[aria-pressed="true"]')).toMatch(/border-color: #0B5A46/)
  })
})
