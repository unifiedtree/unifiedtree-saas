// The white card every block sits on (README: content lives on white cards).
// Radius 16–20, 1px line, the card shadow. `spot` gives data cards (tables,
// lists, charts) the design's quiet hover: a faint spotlight under the pointer
// and a brand hairline. `soft` is the inset grey tile used inside cards
// (company KPI tiles, the branch geofence box).
//
// Carries the platform's `.ut-card` class, which existing tests use to find
// cards; pass cardClass={false} for a card nested inside another card.
import type { CSSProperties, ReactNode } from 'react'
import { fxIndex, useHoverFx } from '@/design/theme/motion'
import { cx } from './displayUtil'
import './display.css'

export interface CardProps {
  as?: 'div' | 'section' | 'article' | 'aside'
  children?: ReactNode
  /** Corner radius: 16 (dashboard cards), 18 (default), 20 (company cards), 14 (small tiles). */
  radius?: 14 | 16 | 18 | 20
  /** none · sm 16px · md 18px 20px (default) · lg 22px. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** surface = white card (default); soft = the grey inset tile (no line, no shadow). */
  tone?: 'surface' | 'soft'
  /** Quiet hover for data cards: spotlight + brand hairline. */
  spot?: boolean
  /** Fade/rise in on first show (default true for surface cards). */
  rise?: boolean
  index?: number
  /** Accessible name (sections and asides). */
  label?: string
  labelledBy?: string
  /** Add the legacy `.ut-card` class (default true). */
  cardClass?: boolean
  id?: string
  className?: string
  style?: CSSProperties
}

export function Card({
  as: Tag = 'div', children, radius = 18, padding = 'md', tone = 'surface', spot, rise, index, label, labelledBy, cardClass = true, id, className, style,
}: CardProps) {
  const fx = useHoverFx<HTMLElement>('spot')
  const soft = tone === 'soft'
  const doRise = rise ?? !soft
  return (
    <Tag
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cx(cardClass && !soft && 'ut-card', 'uk-card', `uk-card--r${radius}`, `uk-card--p-${padding}`, soft && 'uk-card--soft', spot && 'uk-card--spot ufx-spot', doRise && 'ufx-rise', className)}
      style={fxIndex(index, style)}
      {...(spot ? fx : {})}
    >
      {spot && <span aria-hidden="true" className="uk-fx-spot" />}
      {children}
    </Tag>
  )
}
