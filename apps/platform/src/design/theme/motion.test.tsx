import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  UFX_MS, countUpAt, easeOutCubic, formatCountText, fxIndex, getMotionLevel, motionAllowed, parseCountText, prefersReducedMotion,
  useCountUp, useCountUpText, useMotionAllowed,
} from './motion'

type Globals = { window?: unknown; document?: unknown }
const g = globalThis as unknown as Globals

/** Pretend to be a browser with (or without) prefers-reduced-motion and a data-ufx level. */
function fakeBrowser({ reduce = false, level = null as string | null } = {}) {
  g.window = { matchMedia: () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }) }
  g.document = { documentElement: { getAttribute: (k: string) => (k === 'data-ufx' ? level : null) } }
}

afterEach(() => {
  delete g.window
  delete g.document
})

describe('count-up timing', () => {
  it('eases out and lands exactly on the value at 950ms', () => {
    expect(UFX_MS.count).toBe(950)
    expect(countUpAt(0, 249, 0)).toBe(0)
    expect(countUpAt(0, 249, 950)).toBe(249)
    expect(countUpAt(0, 249, 5000)).toBe(249)
    const mid = countUpAt(0, 100, 475)
    expect(mid).toBeGreaterThan(50) // ease-out: past halfway at half time
    expect(mid).toBeLessThan(100)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('counts down as well as up, and never overshoots', () => {
    let prev = 200
    for (let t = 0; t <= 950; t += 50) {
      const v = countUpAt(200, 120, t)
      expect(v).toBeLessThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(120)
      prev = v
    }
  })

  it('treats a zero or negative duration as "show the value"', () => {
    expect(countUpAt(0, 10, 5, 0)).toBe(10)
  })
})

describe('formatted figures', () => {
  it('keeps Indian grouping and the rupee sign', () => {
    const p = parseCountText('₹53,77,700')!
    expect(p).toMatchObject({ pre: '₹', num: 5377700, post: '', grouped: true, indian: true, decimals: 0 })
    expect(formatCountText(p, 1234567)).toBe('₹12,34,567')
    expect(formatCountText(p, p.num)).toBe('₹53,77,700')
  })

  it('keeps western grouping, decimals, suffixes and the text after the number', () => {
    const a = parseCountText('1,234.50 hrs')!
    expect(a).toMatchObject({ num: 1234.5, decimals: 2, grouped: true, indian: false, post: ' hrs' })
    expect(formatCountText(a, 99.5)).toBe('99.50 hrs')
    expect(formatCountText(parseCountText('92%')!, 41)).toBe('41%')
    expect(formatCountText(parseCountText('3 of 6')!, 1)).toBe('1 of 6')
    expect(formatCountText(parseCountText('6.5')!, 3.25)).toBe('3.3')
  })

  it('keeps leading zeros ("09:24" never shows as "9:24")', () => {
    const p = parseCountText('09:24')!
    expect(formatCountText(p, 3)).toBe('03:24')
  })

  it('returns null when there is no figure', () => {
    expect(parseCountText('No data')).toBeNull()
    expect(parseCountText('')).toBeNull()
  })
})

describe('motion level and reduced motion', () => {
  it('defaults to full motion without a browser', () => {
    expect(getMotionLevel()).toBe('full')
    expect(prefersReducedMotion()).toBe(false)
    expect(motionAllowed()).toBe(true)
  })

  it('reads <html data-ufx>', () => {
    fakeBrowser({ level: 'subtle' })
    expect(getMotionLevel()).toBe('subtle')
    expect(motionAllowed()).toBe(true)
    fakeBrowser({ level: 'off' })
    expect(getMotionLevel()).toBe('off')
    expect(motionAllowed()).toBe(false)
    fakeBrowser({ level: 'bogus' })
    expect(getMotionLevel()).toBe('full')
  })

  it('reduced motion switches animation off', () => {
    fakeBrowser({ reduce: true })
    expect(prefersReducedMotion()).toBe(true)
    expect(motionAllowed()).toBe(false)
  })

  it('fxIndex sets --i (whole, non-negative) and keeps other styles', () => {
    expect(fxIndex(3.7, { color: 'red' })).toEqual({ color: 'red', '--i': 3 })
    expect(fxIndex(-2)).toEqual({ '--i': 0 })
    expect(fxIndex(undefined, { color: 'red' })).toEqual({ color: 'red' })
  })
})

function Figure({ value }: { value: number | null }) {
  const v = useCountUp(value)
  return <span>{v == null ? 'none' : String(Math.round(v))}</span>
}
function Text({ value }: { value: string }) {
  return <span>{useCountUpText(value)}</span>
}
function Allowed() {
  return <span>{useMotionAllowed() ? 'yes' : 'no'}</span>
}

describe('useCountUp respects reduced motion', () => {
  it('starts from 0 when motion is allowed (the count runs after mount)', () => {
    fakeBrowser()
    expect(renderToStaticMarkup(<Figure value={249} />)).toBe('<span>0</span>')
    expect(renderToStaticMarkup(<Text value="₹53,77,700" />)).toBe('<span>₹0</span>')
  })

  it('shows the final value at once with prefers-reduced-motion', () => {
    fakeBrowser({ reduce: true })
    expect(renderToStaticMarkup(<Figure value={249} />)).toBe('<span>249</span>')
    expect(renderToStaticMarkup(<Text value="₹53,77,700" />)).toBe('<span>₹53,77,700</span>')
    expect(renderToStaticMarkup(<Allowed />)).toBe('<span>no</span>')
  })

  it('shows the final value at once with data-ufx="off"', () => {
    fakeBrowser({ level: 'off' })
    expect(renderToStaticMarkup(<Figure value={249} />)).toBe('<span>249</span>')
  })

  it('leaves 0, empty and non-numeric values alone', () => {
    fakeBrowser()
    expect(renderToStaticMarkup(<Figure value={0} />)).toBe('<span>0</span>')
    expect(renderToStaticMarkup(<Figure value={null} />)).toBe('<span>none</span>')
    expect(renderToStaticMarkup(<Text value="No data" />)).toBe('<span>No data</span>')
  })
})
