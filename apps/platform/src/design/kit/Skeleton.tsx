// Loading placeholders in the design's shapes (prototype PgGeneric): soft
// surface-tinted bars and circles with a slow shimmer (still when motion is
// off or reduced). Use the ready-made blocks for the common layouts.
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  /** px or CSS value; `circle` makes it round. */
  radius?: number | string
  circle?: boolean
  /** hv = the lighter hover tint (default), ln = the stronger line tint for the main figure. */
  tone?: 'hv' | 'ln'
  className?: string
  style?: CSSProperties
}

/** One placeholder shape. Decorative — wrap groups in {@link SkeletonBlock} for the "Loading" announcement. */
export function Skeleton({ width = '100%', height = 10, radius, circle, tone = 'hv', className, style }: SkeletonProps) {
  return (
    <span aria-hidden="true" className={cx('uk-skel', `uk-skel--${tone}`, className)}
      style={{ width, height, borderRadius: circle ? '50%' : radius ?? (typeof height === 'number' ? Math.min(6, height / 2) : 5), ...style }} />
  )
}

export interface SkeletonBlockProps {
  /** What is loading, for screen readers ("Loading today's attendance"). */
  label?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/** A loading region: announces once, hides its shapes from assistive tech. */
export function SkeletonBlock({ label = 'Loading', className, style, children }: SkeletonBlockProps) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cx('uk-skelblock', className)} style={style}>
      {children}
    </div>
  )
}

/** Text lines, the last one shorter. */
export function SkeletonText({ lines = 3, label }: { lines?: number; label?: string }) {
  const widths = ['92%', '84%', '64%', '76%', '58%']
  return (
    <SkeletonBlock label={label} className="uk-skel-text">
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '48%' : widths[i % widths.length]} height={10} />
      ))}
    </SkeletonBlock>
  )
}

/** List rows: avatar circle, name + meta bars, a status pill. */
export function SkeletonList({ rows = 4, avatar = true, pill = true, label }: { rows?: number; avatar?: boolean; pill?: boolean; label?: string }) {
  return (
    <SkeletonBlock label={label} className="uk-skel-list">
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <div className="uk-skel-row" key={i}>
          {avatar && <Skeleton width={34} height={34} circle />}
          <span className="uk-skel-row__text">
            <Skeleton width={['64%', '52%', '70%', '46%'][i % 4]} height={10} />
            <Skeleton width={['38%', '44%', '30%', '36%'][i % 4]} height={8} />
          </span>
          {pill && <Skeleton width={72} height={22} radius={999} className="uk-skel--pill" />}
        </div>
      ))}
    </SkeletonBlock>
  )
}

/** Stat-card placeholders in a grid (icon circle, label bar, figure bar). */
export function SkeletonStats({ count = 4, min = 190, label }: { count?: number; min?: number; label?: string }) {
  return (
    <SkeletonBlock label={label} className="uk-grid" style={{ ['--uk-min' as string]: `${min}px`, ['--uk-gap' as string]: '12px' } as CSSProperties}>
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <div className="uk-skel-stat" key={i}>
          <Skeleton width={42} height={42} circle />
          <span className="uk-skel-stat__text">
            <Skeleton width="52%" height={10} />
            <Skeleton width="34%" height={18} radius={6} tone="ln" />
          </span>
        </div>
      ))}
    </SkeletonBlock>
  )
}

/** Table placeholder: a header strip and rows of cells. */
export function SkeletonTable({ rows = 6, cols = 4, label }: { rows?: number; cols?: number; label?: string }) {
  const c = Math.max(2, cols)
  const tpl = { gridTemplateColumns: `36px minmax(0,1.4fr) repeat(${c - 2}, minmax(0,1fr)) 90px` }
  return (
    <SkeletonBlock label={label} className="uk-skel-table">
      <div className="uk-skel-table__head" style={tpl}>
        <span />
        {Array.from({ length: c - 1 }, (_, i) => <Skeleton key={i} width={i === 0 ? '40%' : '55%'} height={8} />)}
        <span />
      </div>
      {Array.from({ length: Math.max(1, rows) }, (_, r) => (
        <div className="uk-skel-table__row" style={tpl} key={r}>
          <Skeleton width={34} height={34} circle />
          <Skeleton width={['64%', '58%', '70%'][r % 3]} height={10} />
          {Array.from({ length: c - 2 }, (_, i) => <Skeleton key={i} width={['46%', '60%', '52%'][(r + i) % 3]} height={10} />)}
          <Skeleton height={22} radius={999} tone="hv" className="uk-skel--pill" />
        </div>
      ))}
    </SkeletonBlock>
  )
}

/** A chart area: a row of rising bars. */
export function SkeletonChart({ bars = 7, height = 180, label }: { bars?: number; height?: number; label?: string }) {
  const hs = [46, 70, 58, 84, 64, 76, 52, 68, 60, 80]
  return (
    <SkeletonBlock label={label} className="uk-skel-chart" style={{ height }}>
      {Array.from({ length: Math.max(1, bars) }, (_, i) => (
        <Skeleton key={i} height={`${hs[i % hs.length]}%`} radius="9px 9px 3px 3px" className="uk-skel-chart__bar" />
      ))}
    </SkeletonBlock>
  )
}
