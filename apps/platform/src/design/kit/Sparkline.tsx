// Sparkline (prototype UtStat / UtLive): a smoothed line, a soft area under it
// and a dot on one point. The line draws itself when it appears and again on
// hover (motion.ts redraws [data-ufx-draw]); the dot grows with the card's --fx.
// Colour is currentColor, so the card decides it (brand, red, or its --k accent).
import type { CSSProperties } from 'react'
import { cx } from './displayUtil'

export type SparklineVariant = 'stat' | 'live' | 'live-stack'

interface Geometry {
  /** viewBox width / height */
  w: number
  h: number
  /** rendered size */
  rw: number
  rh: number
  pad: number
  /** left/right inset of the line (live cards keep 2 units clear) */
  inset: number
  stroke: number
  dotR: number
  areaOpacity: number
  dotGrow: number
}

const GEO: Record<SparklineVariant, Geometry> = {
  stat: { w: 88, h: 34, rw: 88, rh: 34, pad: 4, inset: 0, stroke: 1.8, dotR: 3, areaOpacity: 0.08, dotGrow: 0.45 },
  live: { w: 84, h: 34, rw: 84, rh: 34, pad: 4, inset: 2, stroke: 1.9, dotR: 3.2, areaOpacity: 0.1, dotGrow: 0.5 },
  'live-stack': { w: 84, h: 34, rw: 70, rh: 30, pad: 4, inset: 2, stroke: 2.1, dotR: 3.4, areaOpacity: 0.1, dotGrow: 0.5 },
}

type Pt = [number, number]

/** The design's smoothing: a cubic through every point, handles at 1/6 of the neighbours' span. */
export function smoothPath(xy: readonly Pt[]): string {
  const f = (n: number) => n.toFixed(1)
  return xy.reduce((s, p, i, a) => {
    if (!i) return 'M' + f(p[0]) + ' ' + f(p[1])
    const p0 = a[i - 1]
    const pm = a[i - 2] || p0
    const pn = a[i + 1] || p
    return s + ' C' + f(p0[0] + (p[0] - pm[0]) / 6) + ' ' + f(p0[1] + (p[1] - pm[1]) / 6) + ' ' + f(p[0] - (pn[0] - p0[0]) / 6) + ' ' + f(p[1] - (pn[1] - p0[1]) / 6) + ' ' + f(p[0]) + ' ' + f(p[1])
  }, '')
}

export interface SparkShape {
  /** No usable trend (fewer than two points, or all equal on a live card): draw the dashed baseline. */
  flat: boolean
  line: string
  area: string
  dot: Pt | null
}

/** Points → path data for a variant. Non-finite values are dropped. */
export function sparkShape(values: readonly number[], variant: SparklineVariant = 'stat', dotIndex?: number): SparkShape {
  const g = GEO[variant]
  const pts = values.map(Number).filter((n) => Number.isFinite(n))
  const mn = pts.length ? Math.min(...pts) : 0
  const mx = pts.length ? Math.max(...pts) : 0
  // UtStat draws a two-point series even when flat (a line along the bottom); UtLive shows a dashed baseline.
  const flat = pts.length < 2 || (variant !== 'stat' && mx === mn)
  if (flat) return { flat: true, line: '', area: '', dot: null }
  const rg = mx - mn || 1
  const span = g.w - g.inset * 2
  const xy: Pt[] = pts.map((v, i) => [g.inset + (i * span) / (pts.length - 1), g.h - g.pad - ((v - mn) / rg) * (g.h - g.pad * 2)])
  const line = smoothPath(xy)
  const area = line + ' L' + (g.w - g.inset) + ' ' + g.h + ' L' + g.inset + ' ' + g.h + ' Z'
  const di = Math.max(0, Math.min(xy.length - 1, dotIndex == null || !Number.isFinite(dotIndex) ? xy.length - 1 : Math.floor(dotIndex)))
  return { flat: false, line, area, dot: xy[di] }
}

export interface SparklineProps {
  /** The series, oldest first. Real data only — pass nothing to hide the line. */
  values: readonly number[]
  variant?: SparklineVariant
  /** Which point gets the dot (default: the last). */
  dot?: number
  /** Describe the trend for screen readers; without it the line is decorative. */
  label?: string
  className?: string
  style?: CSSProperties
}

/** A small trend line. Renders the dashed "no trend" baseline when there's nothing to draw (live variants). */
export function Sparkline({ values, variant = 'stat', dot, label, className, style }: SparklineProps) {
  const g = GEO[variant]
  const s = sparkShape(values, variant, dot)
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
  if (s.flat) {
    if (variant === 'stat') return null
    const row = variant === 'live'
    return (
      <svg className={cx('uk-spark', 'uk-spark--flat', className)} width={g.rw} height={g.rh} viewBox={`0 0 ${g.w} ${g.h}`} fill="none" style={style} {...a11y}>
        <path d="M2 30H82" stroke="currentColor" strokeOpacity={0.45} strokeWidth={row ? 1.8 : 2} strokeLinecap="round" strokeDasharray="2 5" />
        {row && <circle cx="82" cy="30" r="3" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.8} className="uk-spark__dot uk-spark__dot--still" />}
      </svg>
    )
  }
  return (
    <svg className={cx('uk-spark', className)} width={g.rw} height={g.rh} viewBox={`0 0 ${g.w} ${g.h}`} fill="none" style={style} {...a11y}>
      <path d={s.area} fill="currentColor" fillOpacity={g.areaOpacity} />
      <path className="ufx-draw" data-ufx-draw="" d={s.line} pathLength={1} strokeDasharray="1" stroke="currentColor" strokeWidth={g.stroke} strokeLinecap="round" strokeLinejoin="round" />
      {s.dot && (
        <circle className="uk-spark__dot" cx={s.dot[0]} cy={s.dot[1]} r={g.dotR} stroke="currentColor" strokeWidth={g.stroke}
          style={{ ['--uk-dot-grow' as string]: g.dotGrow } as CSSProperties} />
      )}
    </svg>
  )
}
