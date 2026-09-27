// Rings. Each arc draws itself in (motion.css .ufx-ring: stroke-dasharray from
// "0 100" to its value, 1000 ms, staggered by --i).
//
//   ProgressRing  a single arc with a figure in the middle (Workspace leave balances).
//   DonutRing     parts of a whole with a hole (Payroll "Where the money goes").
//   GeofenceRing  a branch's check-in boundary: the green area scales with the radius;
//                 a dashed amber circle when no boundary is set (Companies & branches).
import type { CSSProperties, ReactNode } from 'react'
import { fxIndex } from '@/design/theme/motion'
import { clampPct, cx, pctOf } from './displayUtil'
import { segmentColor, type BarTone, type StackedSegment } from './ProgressBar'
import './display.css'

export interface ProgressRingProps {
  /** 0–100, or a count when `max` is given. */
  value: number | null | undefined
  max?: number
  /** Diameter in px (default 56). */
  size?: number
  /** Stroke width in viewBox units (the design's 40-unit box uses 4). */
  thickness?: number
  tone?: BarTone
  /** The figure in the middle. */
  children?: ReactNode
  /** Accessible name; without it the ring is decorative. */
  label?: string
  valueText?: string
  index?: number
  className?: string
}

export function ProgressRing({ value, max, size = 56, thickness = 4, tone = 'brand', children, label, valueText, index, className }: ProgressRingProps) {
  const pct = max != null ? pctOf(value, max) : clampPct(value)
  const r = 20 - thickness / 2 - 2
  const a11y = label
    ? { role: 'img' as const, 'aria-label': valueText ? `${label}: ${valueText}` : `${label}: ${Math.round(pct)}%` }
    : { 'aria-hidden': true as const }
  return (
    <span className={cx('uk-pring', `uk-tone--${tone}`, className)} style={fxIndex(index, { width: size, height: size })} {...a11y}>
      <svg width={size} height={size} viewBox="0 0 40 40" className="uk-ring__svg" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth={thickness} className="uk-ring__track" />
        {pct > 0 && (
          <circle cx="20" cy="20" r={r} fill="none" strokeWidth={thickness} strokeLinecap="round" pathLength={100}
            strokeDasharray={`${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`} className="uk-ring__arc ufx-ring" />
        )}
      </svg>
      {children != null && <span className="uk-pring__mid">{children}</span>}
    </span>
  )
}

export interface DonutRingProps {
  segments: readonly StackedSegment[]
  /** Diameter in px (default 112). */
  size?: number
  /** Ring width in viewBox units (the design's 120-unit box uses 16). */
  thickness?: number
  children?: ReactNode
  label?: string
  className?: string
}

/** Arcs for each part, with a 0.9% gap between them, as in the design. */
export function donutArcs(values: readonly number[]): Array<{ dash: string; offset: string } | null> {
  const total = values.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  let cum = 0
  return values.map((v) => {
    if (!(total > 0) || !Number.isFinite(v) || v <= 0) return null
    const pv = (v / total) * 100
    const len = Math.max(0.1, pv - 0.9)
    const out = { dash: `${len.toFixed(2)} ${(100 - len).toFixed(2)}`, offset: (-cum).toFixed(2) }
    cum += pv
    return out
  })
}

export function DonutRing({ segments, size = 112, thickness = 16, children, label, className }: DonutRingProps) {
  const arcs = donutArcs(segments.map((s) => s.value))
  const r = 60 - thickness / 2 - 6
  return (
    <span className={cx('uk-donut', className)} style={{ width: size, height: size }} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <svg width={size} height={size} viewBox="0 0 120 120" className="uk-ring__svg" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth={thickness} className="uk-ring__track" />
        {arcs.map((a, i) => a && (
          <circle key={segments[i].key ?? i} cx="60" cy="60" r={r} fill="none" strokeWidth={thickness} pathLength={100}
            strokeDasharray={a.dash} strokeDashoffset={a.offset} className="ufx-ring" style={fxIndex(i, { stroke: segmentColor(segments[i], i) })} />
        ))}
      </svg>
      {children != null && <span className="uk-pring__mid">{children}</span>}
    </span>
  )
}

export interface GeofenceRingProps {
  /** The boundary radius in metres. Empty / 0 = no boundary set (dashed amber). */
  radius?: number | null
  /** The largest radius the scale shows (default 500 m, the slider's top). */
  maxRadius?: number
  /** card = 84px on the branch card; preview = 150px in the side panel. */
  size?: 'card' | 'preview'
  /** Accessible description; default "Check-in boundary: 150 m" / "No check-in boundary set". */
  label?: string
  index?: number
  className?: string
  style?: CSSProperties
}

/** Radius of the green area in the ring's own units, from the design's scale. */
export function geofenceRadius(metres: number, size: 'card' | 'preview' = 'card', maxRadius = 500): number {
  const m = Math.max(0, Math.min(maxRadius, metres))
  return size === 'card' ? Math.round(12 + (m / maxRadius) * 26) : Math.round(14 + (m / maxRadius) * 56)
}

export function GeofenceRing({ radius, maxRadius = 500, size = 'card', label, index, className, style }: GeofenceRingProps) {
  const set = radius != null && Number.isFinite(radius) && radius > 0
  const text = label ?? (set ? `Check-in boundary: ${Math.round(radius!)} m` : 'No check-in boundary set')
  if (size === 'preview') {
    return (
      <svg className={cx('uk-geo', 'uk-geo--preview', className)} width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={text} style={style}>
        <circle cx="75" cy="75" r="72" className="uk-geo__plate" />
        <circle cx="75" cy="75" r="48" fill="none" strokeDasharray="3 5" className="uk-geo__guide" />
        <circle cx="75" cy="75" r="24" fill="none" strokeDasharray="3 5" className="uk-geo__guide" />
        {set && <circle cx="75" cy="75" r={geofenceRadius(radius!, 'preview', maxRadius)} strokeWidth={2.5} className="uk-geo__area uk-geo__area--preview" />}
        <circle cx="75" cy="75" r="6" className="uk-geo__pin" />
        <circle cx="75" cy="75" r="11" fill="none" strokeWidth={2} className="uk-geo__pinring" />
      </svg>
    )
  }
  return (
    <svg className={cx('uk-geo', className)} width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={text} style={fxIndex(index, style)}>
      <g transform="rotate(-90 42 42)">
        <circle cx="42" cy="42" r="39" fill="none" strokeDasharray="2 4" className="uk-geo__outer" />
        <circle cx="42" cy="42" r="24" fill="none" className="uk-geo__guide" />
        {set ? (
          <circle cx="42" cy="42" r={geofenceRadius(radius!, 'card', maxRadius)} strokeWidth={2} pathLength={100} strokeDasharray="100 0" className="uk-geo__area ufx-ring" />
        ) : (
          <circle cx="42" cy="42" r="30" fill="none" strokeWidth={1.5} strokeDasharray="4 4" className="uk-geo__unset" />
        )}
      </g>
      <circle cx="42" cy="42" r="4.5" className="uk-geo__pin" />
    </svg>
  )
}
