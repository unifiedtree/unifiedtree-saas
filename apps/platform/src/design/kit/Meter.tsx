// Meters and bar lists.
//
//   Meter    a labelled balance: "Casual leave … 6.5 / 12" with a bar under it (Home → Leave).
//   BarList  label | bar | figure rows (dashboard "Dept distribution", hiring pipeline,
//            UtSection "bars"); rows can be buttons that filter something.
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { fxIndex } from '@/design/theme/motion'
import { clampPct, cx, pctOf } from './displayUtil'
import { ProgressBar, type BarTone } from './ProgressBar'
import './display.css'

export interface MeterProps {
  label: ReactNode
  /** What's left / used, e.g. 6.5. */
  value: number | null | undefined
  /** Out of, e.g. 12. */
  max: number | null | undefined
  /** How the figures are written; default "6.5 / 12". */
  display?: ReactNode
  tone?: BarTone
  /** Bar height (default 6). */
  height?: number
  /** Screen-reader sentence, e.g. "Casual leave: 6.5 of 12 days left". */
  valueText?: string
  index?: number
  className?: string
}

/** One balance line with its bar. The bar's track is a soft tint of the tone, as in the design. */
export function Meter({ label, value, max, display, tone = 'leave', height = 6, valueText, index, className }: MeterProps) {
  const has = value != null && Number.isFinite(Number(value))
  const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
  const spoken = valueText ?? (has && max != null ? `${fmt(value)} of ${fmt(max)}` : undefined)
  return (
    <div className={cx('uk-meter', className)}>
      <div className="uk-meter__head">
        <span className="uk-meter__label">{label}</span>
        <span className="uk-meter__fig">
          <span aria-hidden={spoken ? true : undefined}>
            {display ?? (<><b>{fmt(value)}</b> <span className="uk-meter__of">/ {fmt(max)}</span></>)}
          </span>
          {spoken && <span className="uk-sr">{spoken}</span>}
        </span>
      </div>
      <ProgressBar value={has ? Number(value) : 0} max={max ?? 0} tone={tone} height={height} track="tone" index={index} />
    </div>
  )
}

export interface BarListItem {
  key?: string
  label: ReactNode
  /** The figure shown at the end of the row. */
  value: ReactNode
  /** Bar length 0–100 (give either pct or amount + max on the list). */
  pct?: number
  amount?: number
  tone?: BarTone
  /** A second, quieter column after the figure (e.g. conversion "36%"). */
  extra?: ReactNode
  /** Makes the row a button (e.g. filter the directory by this department). */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Tooltip / accessible description ("Engineering · 72 people"). */
  title?: string
}

export interface BarListProps {
  items: readonly BarListItem[]
  /** Scale for `amount` values (default: the largest amount). */
  max?: number
  /** Label column: px or a grid track (default "minmax(90px,150px)"). */
  labelWidth?: number | string
  /** Figure column width in px (default 64). */
  valueWidth?: number
  /** Extra column width in px (default 40). */
  extraWidth?: number
  /** Bar height: 8 (dashboard), 10 (UtSection, default), 24 (pipeline). */
  height?: number
  /** The tone used when an item has none. */
  tone?: BarTone
  label?: string
  className?: string
  style?: CSSProperties
}

export function BarList({ items, max, labelWidth = 'minmax(90px,150px)', valueWidth = 64, extraWidth = 40, height = 10, tone = 'brand', label, className, style }: BarListProps) {
  const top = max ?? Math.max(0, ...items.map((i) => (Number.isFinite(i.amount) ? Number(i.amount) : 0)))
  const hasExtra = items.some((i) => i.extra != null && i.extra !== '')
  const buttons = items.some((i) => !!i.onClick)
  const cols = `${typeof labelWidth === 'number' ? labelWidth + 'px' : labelWidth} minmax(0,1fr) ${valueWidth}px${hasExtra ? ` ${extraWidth}px` : ''}`
  return (
    <div role="list" aria-label={label} className={cx('uk-barlist', buttons && 'uk-barlist--btns', className)} style={style}>
      {items.map((it, i) => {
        const pct = it.pct != null ? clampPct(it.pct) : pctOf(it.amount, top)
        const row = (
          <>
            <span className="uk-barlist__label">{it.label}</span>
            <ProgressBar value={pct} tone={it.tone ?? tone} height={height} minVisible={2} index={i} />
            <span className="uk-barlist__value">{it.value}</span>
            {hasExtra && <span className="uk-barlist__extra">{it.extra}</span>}
          </>
        )
        return (
          <div role="listitem" key={it.key ?? i} className="uk-barlist__item" style={fxIndex(i)}>
            {it.onClick ? (
              <button type="button" className="uk-barlist__row uk-barlist__row--btn" style={{ gridTemplateColumns: cols }} onClick={it.onClick} title={it.title}>{row}</button>
            ) : (
              <span className="uk-barlist__row" style={{ gridTemplateColumns: cols }} title={it.title}>{row}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
