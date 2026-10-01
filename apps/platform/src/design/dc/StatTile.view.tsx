// hand-owned: edited by hand; scripts/design-build.mjs skips this view.
// Rebuilt by hand on the redesign kit (F2d).
//
// The StatTile's view, and LegacyStatCard: the design's stat card (prototype
// UtStat = the kit StatCard "stat" variant) for the older tile APIs, which pass
// ready-made nodes — an icon element, a value that may be a skeleton element, a
// small chart — that the kit StatCard's string/number props can't take. It uses
// the kit's own classes (display.css), so it looks exactly like the kit card.
import type { MouseEvent, ReactNode } from 'react'
import { cx } from '@/design/kit/displayUtil'
import { useHoverFx } from '@/design/theme/motion'
import '@/design/kit/display.css'
import './StatTile.view.css'

export type LegacyStatTone = 'brand' | 'gold' | 'red' | 'gray'

/**
 * The older tile colours on the design's four stat tones: attention (orange) is
 * gold, bad news (red) is red, everything else is brand, as in the prototype.
 */
export function statTone(color?: string | null): LegacyStatTone {
  switch (color) {
    case 'orange': case 'amber': case 'gold': return 'gold'
    case 'red': return 'red'
    case 'gray': return 'gray'
    default: return 'brand'
  }
}

export interface LegacyStatCardProps {
  label: ReactNode
  /** A figure (counts up when it's a string or number) or any node (a skeleton while loading). */
  value: ReactNode
  icon?: ReactNode
  tone?: LegacyStatTone
  /** Small chart top-right (where the design's sparkline sits). */
  chart?: ReactNode
  /** The line under the figure. */
  note?: ReactNode
  /** A change shown before the note, coloured by `mood`. */
  delta?: ReactNode
  trend?: 'up' | 'down'
  mood?: 'good' | 'bad' | 'flat'
  /** Tooltip text for the app's data-tip engine. */
  tip?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
  /** Render a <button> even without onClick (StatTile always was one). */
  button?: boolean
  loading?: boolean
  className?: string
}

const ARROW_UP = 'M7 17 17 7M8 7h9v9'
const ARROW_DOWN = 'M7 7l10 10M17 8v9H8'

export function LegacyStatCard({ label, value, icon, tone = 'brand', chart, note, delta, trend = 'up', mood = 'flat', tip, onClick, button, loading, className }: LegacyStatCardProps) {
  const fx = useHoverFx<HTMLElement>('tilt')
  const interactive = !!onClick || !!button
  if (loading) {
    return (
      <div className={cx('ut-card', 'uk-stat', 'uk-stat--stat', 'uk-stat--loading', className)} role="status" aria-busy="true" aria-label={typeof label === 'string' ? `Loading ${label}` : 'Loading'}>
        <span className="uk-skel uk-skel--hv" style={{ width: 42, height: 42, borderRadius: '50%' }} />
        <span className="uk-stat__skel">
          <span className="uk-skel uk-skel--hv" style={{ width: '52%', height: 10, borderRadius: 5 }} />
          <span className="uk-skel uk-skel--ln" style={{ width: '34%', height: 18, borderRadius: 6 }} />
        </span>
      </div>
    )
  }
  // The figure shows at once and exactly as given (no count-up, no regrouping), as these tiles always
  // did: pages and their tests read it as soon as the data arrives. The kit StatCard counts up.
  const figure = value == null ? null : typeof value === 'string' || typeof value === 'number' ? String(value) : value
  const hasNote = note != null && note !== '' && note !== ' '
  const inner = (
    <>
      <span aria-hidden="true" className="uk-fx-spot" />
      {interactive && <span aria-hidden="true" className="uk-fx-light ufx-light" />}
      <span className="uk-stat__top">
        <span className={cx('uk-stat__circle', `uk-stat__circle--${tone}`)} aria-hidden="true">
          <span className="uk-stat__halo" />
          {icon}
        </span>
        {chart != null && chart !== false && <span className="uk-stat__spark dcst-chart" aria-hidden="true">{chart}</span>}
      </span>
      <span className="uk-stat__body">
        <span className="uk-stat__label">{label}</span>
        <span className="uk-stat__value">{figure}</span>
        {(delta || hasNote) && (
          <span className="uk-stat__foot">
            {delta && (
              <span className={cx('uk-stat__delta', `uk-stat__delta--${mood}`)}>
                {mood !== 'flat' && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={trend === 'down' ? ARROW_DOWN : ARROW_UP} />
                  </svg>
                )}
                {delta}
              </span>
            )}
            {hasNote && <span className="uk-stat__note">{note}</span>}
          </span>
        )}
      </span>
    </>
  )
  const cls = cx('ut-card', 'uk-stat', 'uk-stat--stat', interactive && 'uk-stat--link ufx-tilt', 'ufx-rise', 'dcst', className)
  if (interactive) {
    return (
      <button type="button" className={cls} onClick={onClick} data-tip={tip || undefined} {...fx}>
        {inner}
      </button>
    )
  }
  return <div className={cls} data-tip={tip || undefined}>{inner}</div>
}

export function StatTileView({ v }: { v: any }) {
  const t = v.t || {}
  // Always a button, as before (tiles without an action do nothing when pressed).
  return <LegacyStatCard label={t.label} value={t.value} icon={t.icon} tone={v.tone} chart={t.chart} note={t.sub} tip={t.tip} onClick={t.onClick} button />
}
