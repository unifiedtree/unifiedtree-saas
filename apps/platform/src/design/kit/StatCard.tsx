// Stat cards (prototype UtLive and UtStat).
//
//   variant "live"        UtLive row: 50px accent icon tile, label, big figure, note, sparkline on the right.
//                         The admin dashboard and self-service Home use this one.
//   variant "live-stack"  UtLive stacked: icon + sparkline on top, figures below (the compact layout).
//   variant "stat"        UtStat: round tone icon, sparkline top-right, figure, delta + note.
//                         Filter tiles on Team today / Time use it with `active`.
//
// Every figure counts up when it appears (motion.ts), the card lifts, tilts and
// lights its border on hover. A card only renders what it's given: pass the
// real figure, note and series from the API; `loading` shows its skeleton.
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { fxIndex, useCountUpText, useHoverFx } from '@/design/theme/motion'
import { AniIcon, type AniIconKind } from './AnimatedIcons'
import { Sparkline } from './Sparkline'
import { cx, formatFigure, linkClick, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

export type StatCardVariant = 'live' | 'live-stack' | 'stat'
/** The design's stat accents (README "Stat-card accents (--k)"). */
export type StatAccent = 'brand' | 'people' | 'present' | 'leave' | 'late' | 'half' | 'wfh' | 'none' | 'absent'
export type StatTone = 'brand' | 'gold' | 'red' | 'gray'
export type StatMood = 'good' | 'bad' | 'warn' | 'flat'
export type StatTrend = 'up' | 'down' | 'flat'

const ACCENT: Record<StatAccent, string> = {
  brand: 'var(--u-br,#0F6E56)',
  people: 'var(--u-k-people,#3B6FD9)',
  present: 'var(--u-k-present,#12805F)',
  leave: 'var(--u-k-leave,#E0661B)',
  late: 'var(--u-k-late,#D9352B)',
  half: 'var(--u-k-halfday,#8B4FE0)',
  wfh: 'var(--u-k-wfh,#2585C7)',
  none: 'var(--u-k-notmarked,#C27A0E)',
  absent: 'var(--u-k-absent,#D13A6E)',
}

/** CSS colour for an accent name, or the colour itself when a CSS colour is given. */
export function accentColor(accent: StatAccent | string | undefined): string {
  if (!accent) return ACCENT.brand
  return (ACCENT as Record<string, string>)[accent] ?? accent
}

const ARROW_UP = 'M7 17 17 7M8 7h9v9'
const ARROW_DOWN = 'M7 7l10 10M17 8v9H8'

export interface CountUpProps {
  /** A figure or formatted figure ("₹53,77,700", "6.5", "3 of 6"). The first number in it counts up. */
  value: string | number | null | undefined
  /** Set false for values that aren't counts (dates, codes). Default true. */
  countUp?: boolean
  /** Shown when there is no value. Default "—". */
  empty?: string
}

/**
 * A figure that counts up to its value (950 ms) the first time it shows and
 * from the old value when it changes. Screen readers get the final value only.
 */
export function CountUp({ value, countUp = true, empty = '—' }: CountUpProps) {
  const text = value == null || value === '' ? '' : typeof value === 'number' ? formatFigure(value) : String(value)
  const shown = useCountUpText(countUp ? text : null)
  if (!text) return <>{empty}</>
  if (!countUp || shown === text) return <>{text}</>
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="uk-sr">{text}</span>
    </>
  )
}

export interface StatCardProps {
  variant?: StatCardVariant
  label: string
  /** The figure. Numbers are grouped Indian-style; strings are shown as given. */
  value: string | number | null | undefined
  note?: ReactNode
  /** Live variants: the moving icon (users, present, leave, late, half, wfh, none, absent). */
  aniIcon?: AniIconKind
  /** Stat variant (and live fallback): an icon name from design/dc/icons, or an element. */
  icon?: KitIcon
  /** Live variants: the card's accent colour (--k). A name from the design's set or any CSS colour. */
  accent?: StatAccent | string
  /** Stat variant: the icon circle's colour. */
  tone?: StatTone
  /** Trend series, oldest first (real data). Omit to show no line. */
  spark?: readonly number[] | null
  /** Live variants: which point gets the dot (default the last). */
  sparkDot?: number
  /** Screen-reader description of the trend, e.g. "Up from 128 to 142 over 7 days". */
  sparkLabel?: string
  /** Stat variant: the change, e.g. "3.1%". */
  delta?: string
  trend?: StatTrend
  /** Colour of the change: good (green), bad (red), warn (gold), flat (grey). */
  mood?: StatMood
  /** Stat variant as a filter tile: selected. Makes the card a toggle (aria-pressed). */
  active?: boolean
  onClick?: (e: MouseEvent<HTMLElement>) => void
  /** A real link; a plain click still calls onClick (for client-side navigation). */
  href?: string
  loading?: boolean
  /** Count the figure up (default true). */
  countUp?: boolean
  /** Entrance stagger position (0, 1, 2…). Siblings stagger on their own without it. */
  index?: number
  /** Replaces the accessible name built from the card's text. */
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

/** One stat card. Put several in a {@link StatGrid}. */
export function StatCard(props: StatCardProps) {
  const {
    variant = 'live', label, value, note, aniIcon, icon, accent, tone = 'brand', spark, sparkDot, sparkLabel,
    delta, trend = 'up', mood = 'flat', active, onClick, href, loading, countUp = true, index, ariaLabel, className, style,
  } = props
  const fx = useHoverFx<HTMLElement>('tilt')
  const live = variant !== 'stat'
  const interactive = !!(onClick || href)
  const rootStyle = fxIndex(index, live ? ({ ...style, ['--k' as string]: accentColor(accent) } as CSSProperties) : style)
  const cls = cx('ut-card', 'uk-stat', `uk-stat--${variant}`, interactive && 'uk-stat--link ufx-tilt', active && 'uk-stat--active', 'ufx-rise', className)

  if (loading) {
    return (
      <div className={cx('ut-card', 'uk-stat', `uk-stat--${variant}`, 'uk-stat--loading', className)} style={rootStyle} aria-busy="true" role="status" aria-label={`Loading ${label}`}>
        <span className="uk-skel uk-skel--hv" style={{ width: live ? (variant === 'live' ? 50 : 42) : 42, height: live ? (variant === 'live' ? 50 : 42) : 42, borderRadius: variant === 'stat' ? '50%' : variant === 'live' ? 15 : 13 }} />
        <span className="uk-stat__skel">
          <span className="uk-skel uk-skel--hv" style={{ width: '52%', height: 10, borderRadius: 5 }} />
          <span className="uk-skel uk-skel--ln" style={{ width: '34%', height: 18, borderRadius: 6 }} />
        </span>
      </div>
    )
  }

  const figure = <CountUp value={value} countUp={countUp} />
  const hasSpark = !!spark && spark.length > 0

  const inner = live ? (
    <>
      <span aria-hidden="true" className="uk-fx-spot" />
      <span aria-hidden="true" className="uk-fx-light ufx-light" />
      {variant === 'live' ? (
        <>
          <span className="uk-stat__tile" aria-hidden="true">
            <span className="uk-stat__halo" />
            {aniIcon ? <AniIcon kind={aniIcon} size={24} /> : renderIcon(icon, 24)}
          </span>
          <span className="uk-stat__body">
            <span className="uk-stat__label">{label}</span>
            <span className="uk-stat__value">{figure}</span>
            {note != null && note !== '' && <span className="uk-stat__note">{note}</span>}
          </span>
          {hasSpark && <Sparkline className="uk-stat__spark" values={spark!} variant="live" dot={sparkDot} label={sparkLabel} />}
        </>
      ) : (
        <>
          <span className="uk-stat__top">
            <span className="uk-stat__tile" aria-hidden="true">
              <span className="uk-stat__halo" />
              {aniIcon ? <AniIcon kind={aniIcon} size={21} /> : renderIcon(icon, 21)}
            </span>
            {hasSpark && <Sparkline className="uk-stat__spark" values={spark!} variant="live-stack" dot={sparkDot} label={sparkLabel} />}
          </span>
          <span className="uk-stat__body">
            <span className="uk-stat__label">{label}</span>
            <span className="uk-stat__value">{figure}</span>
            {note != null && note !== '' && <span className="uk-stat__note">{note}</span>}
          </span>
        </>
      )}
    </>
  ) : (
    <>
      <span aria-hidden="true" className="uk-fx-spot" />
      <span aria-hidden="true" className="uk-fx-light ufx-light" />
      {active && <span aria-hidden="true" className="uk-stat__ring" />}
      <span className="uk-stat__top">
        <span className={cx('uk-stat__circle', `uk-stat__circle--${tone}`)} aria-hidden="true">
          <span className="uk-stat__halo" />
          {renderIcon(icon, 20)}
        </span>
        {hasSpark && (
          <Sparkline className={cx('uk-stat__spark', mood === 'bad' && 'uk-stat__spark--bad')} values={spark!} variant="stat" label={sparkLabel} />
        )}
      </span>
      <span className="uk-stat__body">
        <span className="uk-stat__label">{label}</span>
        <span className="uk-stat__value">{figure}</span>
        {(delta || (note != null && note !== '')) && (
          <span className="uk-stat__foot">
            {delta && (
              <span className={cx('uk-stat__delta', `uk-stat__delta--${mood}`)}>
                {mood !== 'flat' && trend !== 'flat' && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={trend === 'down' ? ARROW_DOWN : ARROW_UP} />
                  </svg>
                )}
                {trend === 'down' && mood !== 'flat' && <span className="uk-sr">down </span>}
                {trend === 'up' && mood !== 'flat' && <span className="uk-sr">up </span>}
                {delta}
              </span>
            )}
            {note != null && note !== '' && <span className="uk-stat__note">{note}</span>}
          </span>
        )}
      </span>
    </>
  )

  if (href) {
    return (
      <a href={href} className={cls} style={rootStyle} aria-label={ariaLabel} onClick={linkClick(onClick)} {...fx}>
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={cls} style={rootStyle} aria-label={ariaLabel} aria-pressed={active === undefined ? undefined : active} onClick={onClick} {...fx}>
        {inner}
      </button>
    )
  }
  return (
    <div className={cls} style={rootStyle} aria-label={ariaLabel} role={ariaLabel ? 'group' : undefined}>
      {inner}
    </div>
  )
}

export interface StatGridProps {
  children: ReactNode
  /** Narrowest card width before the grid wraps (default 260; UtStat pages use ~140–200). */
  min?: number
  /** Gap in px (default 14). */
  gap?: number
  /** Accessible name for the group, e.g. "Today at a glance". */
  label?: string
  className?: string
  style?: CSSProperties
}

/** The responsive stat-card grid: repeat(auto-fit, minmax(min(100%, min), 1fr)). */
export function StatGrid({ children, min = 260, gap = 14, label, className, style }: StatGridProps) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={cx('uk-grid', className)}
      style={{ ...style, ['--uk-min' as string]: `${min}px`, ['--uk-gap' as string]: `${gap}px` } as CSSProperties}>
      {children}
    </div>
  )
}
