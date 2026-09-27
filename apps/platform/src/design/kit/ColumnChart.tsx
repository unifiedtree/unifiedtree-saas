// Column chart (prototype UtSection "chart" body): one column per period with
// its figure on top and its label below, bars growing up when they appear.
// brand = done (green), warning = in progress (hatched gold), muted = no data.
// Screen readers get the same figures as a list.
import type { CSSProperties, ReactNode } from 'react'
import { fxIndex } from '@/design/theme/motion'
import { clampPct, cx } from './displayUtil'
import './display.css'

export type ColumnTone = 'brand' | 'warning' | 'muted'

export interface ColumnBar {
  key?: string
  /** Under the column ("Apr"). */
  label: ReactNode
  /** On top of the column ("₹59.6L"). */
  value: ReactNode
  /** Height: 0–100 of the tallest column… */
  pct?: number
  /** …or an amount, scaled against `max` (default: the largest amount). */
  amount?: number
  tone?: ColumnTone
  /** Tooltip and screen-reader wording ("April · ₹59.6L paid"). */
  tip?: string
}

export interface ColumnChartProps {
  bars: readonly ColumnBar[]
  /** Scale for `amount` values. */
  max?: number
  /** Chart area height in px (default 180). */
  height?: number
  /** Swatches under the chart ("Paid", "In review"). */
  legend?: readonly { label: ReactNode; tone: ColumnTone }[]
  /** What the chart shows, for screen readers ("Payroll cost, last 6 months"). */
  label: string
  className?: string
  style?: CSSProperties
}

/** Column height as a share of the chart area: 86% at most, so the figure above it fits (as in the design). */
export function columnHeight(bar: Pick<ColumnBar, 'pct' | 'amount'>, max: number): number {
  const pct = bar.pct != null ? clampPct(bar.pct) : max > 0 && Number.isFinite(bar.amount) ? clampPct((Number(bar.amount) / max) * 100) : 0
  return Math.max(3, Math.min(100, pct * 0.86))
}

export function ColumnChart({ bars, max, height = 180, legend, label, className, style }: ColumnChartProps) {
  const top = max ?? Math.max(0, ...bars.map((b) => (Number.isFinite(b.amount) ? Number(b.amount) : 0)))
  const spoken = (b: ColumnBar) => b.tip ?? [b.label, b.value].filter((x) => typeof x === 'string' || typeof x === 'number').join(': ')
  return (
    <figure className={cx('uk-colchart', className)} style={style} aria-label={label}>
      <div className="uk-colchart__plot" style={{ height }} aria-hidden="true">
        {bars.map((b, i) => (
          <div key={b.key ?? i} className="uk-colchart__col" title={b.tip}>
            <span className="uk-colchart__v">{b.value}</span>
            <span className={cx('uk-colchart__bar', `uk-colchart__bar--${b.tone ?? 'brand'}`, 'ufx-grow-y')} style={fxIndex(i, { height: `${columnHeight(b, top).toFixed(1)}%` })} />
          </div>
        ))}
      </div>
      <div className="uk-colchart__labels" aria-hidden="true">
        {bars.map((b, i) => <span key={b.key ?? i} className="uk-colchart__l">{b.label}</span>)}
      </div>
      {legend && legend.length > 0 && (
        <div className="uk-colchart__legend" aria-hidden="true">
          {legend.map((l, i) => (
            <span key={i} className="uk-colchart__li"><span className={cx('uk-colchart__sw', `uk-colchart__sw--${l.tone}`)} />{l.label}</span>
          ))}
        </div>
      )}
      <ul className="uk-sr">
        {bars.map((b, i) => <li key={b.key ?? i}>{spoken(b) || <>{b.label}: {b.value}</>}</li>)}
      </ul>
    </figure>
  )
}
