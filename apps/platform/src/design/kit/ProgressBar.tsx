// Progress bars (dashboard onboarding / projects / seats strip, Home's "Your
// day" and "My requests") and the stacked bar ("Where people work"). Bars grow
// in from the left when they appear (motion.css .ufx-grow-x).
import type { CSSProperties, ReactNode } from 'react'
import { fxIndex } from '@/design/theme/motion'
import { clampPct, cx, pctOf } from './displayUtil'
import type { StatusTone } from './StatusPill'
import './display.css'

/** Fill colours: the status tones plus mint (the design's lighter brand green). */
export type BarTone = StatusTone

export interface ProgressBarProps {
  /** 0–100, or a count when `max` is given. */
  value: number | null | undefined
  max?: number
  tone?: BarTone
  /** Bar height in px: 4 (requests), 6 (default), 8, 10, 14, 24 (pipeline). */
  height?: number
  /** Track: the neutral hover grey (default) or a soft tint of the tone (leave balances, seats). */
  track?: 'neutral' | 'tone'
  /** Smallest visible fill in % so a tiny non-zero value still shows (UtSection bars use 2). */
  minVisible?: number
  /** Accessible name. Without it the bar is decorative (the numbers are written next to it). */
  label?: string
  /** Screen-reader value text, e.g. "6.5 of 12 days left". */
  valueText?: string
  /** Grow in from the left (default true). */
  animate?: boolean
  index?: number
  className?: string
  style?: CSSProperties
}

export function ProgressBar({ value, max, tone = 'brand', height = 6, track = 'neutral', minVisible = 0, label, valueText, animate = true, index, className, style }: ProgressBarProps) {
  const pct = max != null ? pctOf(value, max) : clampPct(value)
  const shown = pct > 0 ? Math.max(pct, minVisible) : 0
  const radius = height / 2 > 7 ? 7 : height / 2
  const a11y = label
    ? { role: 'progressbar' as const, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max ?? 100, 'aria-valuenow': max != null ? Number(value) || 0 : Math.round(pct), 'aria-valuetext': valueText }
    : { 'aria-hidden': true as const }
  return (
    <span className={cx('uk-bar', `uk-tone--${tone}`, track === 'tone' && 'uk-bar--tint', className)} style={fxIndex(index, { height, borderRadius: radius, ...style })} {...a11y}>
      <span className={cx('uk-bar__fill', animate && 'ufx-grow-x')} style={{ width: `${shown}%`, borderRadius: radius }} />
    </span>
  )
}

export interface StackedSegment {
  key?: string
  label: ReactNode
  value: number
  /** A tone, or leave out to use the brand ramp (brand, mint, pale mint, gold, grey) in order. */
  tone?: BarTone
  /** Any CSS colour instead of a tone. */
  color?: string
}

const RAMP = ['var(--u-br,#0F6E56)', 'var(--u-g2,#5FB39C)', 'var(--u-g3,#A9D6C6)', 'var(--u-gd,#C8912E)', 'var(--u-gy,#C9D2CE)']
const TONE_SOLID: Record<BarTone, string> = {
  brand: 'var(--u-br,#0F6E56)', mint: 'var(--u-g2,#5FB39C)', success: 'var(--u-ok,#12805F)', warning: 'var(--u-gd,#C8912E)', danger: 'var(--u-rd,#C4453A)',
  info: 'var(--u-info,#2585C7)', leave: 'var(--u-lv,#E0661B)', holiday: 'var(--u-hol,#8B4FE0)', amber: 'var(--u-am,#C27A0E)', neutral: 'var(--u-gy,#C9D2CE)', muted: 'var(--u-gy,#C9D2CE)',
}

/** The colour a segment is drawn in (also for your own legend swatches). */
export function segmentColor(seg: Pick<StackedSegment, 'tone' | 'color'>, i: number): string {
  if (seg.color) return seg.color
  if (seg.tone) return TONE_SOLID[seg.tone]
  return RAMP[i % RAMP.length]
}

export interface StackedBarProps {
  segments: readonly StackedSegment[]
  /** Total the bar represents (default: the sum of the segments). */
  total?: number
  height?: number
  /** Show the legend under the bar (default true). */
  legend?: boolean
  /** Accessible summary, e.g. "30 people across 3 branches". */
  label?: string
  className?: string
}

/** One bar split into parts, with a legend (Companies: "Where people work"). */
export function StackedBar({ segments, total, height = 14, legend = true, label, className }: StackedBarProps) {
  const sum = total ?? segments.reduce((s, x) => s + (Number.isFinite(x.value) && x.value > 0 ? x.value : 0), 0)
  let x = 0
  return (
    <div className={cx('uk-stack', className)}>
      <span className="uk-stack__bar" style={{ height, borderRadius: height / 2 }} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
        {sum > 0 && segments.map((s, i) => {
          const w = pctOf(s.value, sum)
          const left = x
          x += w
          return <span key={s.key ?? i} className="uk-stack__seg" style={{ left: `${left}%`, width: `${w}%`, background: segmentColor(s, i) }} />
        })}
      </span>
      {legend && segments.length > 0 && <Legend items={segments.map((s, i) => ({ key: s.key ?? String(i), label: s.label, color: segmentColor(s, i) }))} />}
    </div>
  )
}

export interface LegendItem {
  key?: string
  label: ReactNode
  /** A tone or a CSS colour for the swatch. */
  tone?: BarTone
  color?: string
  /** square (default), dot, outline (a ring, e.g. "To fix"), hatch (holidays in the planner). */
  shape?: 'square' | 'dot' | 'outline' | 'hatch'
}

/** A row of swatches with labels, for bars, rings and calendars. */
export function Legend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <div className={cx('uk-legend', className)}>
      {items.map((it, i) => (
        <span key={it.key ?? i} className="uk-legend__item">
          <span aria-hidden="true" className={cx('uk-legend__sw', `uk-legend__sw--${it.shape ?? 'square'}`, it.tone && `uk-tone--${it.tone}`)}
            style={it.color ? { ['--sw' as string]: it.color } as CSSProperties : undefined} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
