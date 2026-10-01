// Section layout (prototype UtSections, also the profile tabs' card flow): cards that
// share a row and wrap. A full-width card takes the whole row (flex 1 1 100%); a
// half-width card starts at 440px and grows (flex 1 1 440px), so two halves sit side
// by side until the row is narrower than two of them, then stack.
//
// Cards keep their own height (the design aligns them to the top); `equal` stretches
// the cards of a row to the tallest one.
//
//   <SectionGrid>
//     <SectionCell><Section title="Shifts" …/></SectionCell>
//     <SectionCell width="half"><Section title="Your shift" …/></SectionCell>
//     <SectionCell width="half"><Section title="Ask to change" …/></SectionCell>
//   </SectionGrid>
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'
import './data.css'

export type SectionWidth = 'full' | 'half'

export interface SectionGridProps {
  children: ReactNode
  /** Space between cards in px (default 16, as the design). */
  gap?: number
  /** Stretch the cards of a row to the same height (default: each keeps its own). */
  equal?: boolean
  /** Accessible name for the group (optional; the cards carry their own titles). */
  label?: string
  className?: string
  style?: CSSProperties
}

export function SectionGrid({ children, gap = 16, equal, label, className, style }: SectionGridProps) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={cx('uk-sgrid', equal && 'uk-sgrid--equal', className)}
      style={{ ...style, ['--uk-sgap' as string]: `${gap}px` } as CSSProperties}>
      {children}
    </div>
  )
}

export interface SectionCellProps {
  children: ReactNode
  /** full = the whole row (default); half = 440px and up, two to a row on wide screens. */
  width?: SectionWidth
  className?: string
  style?: CSSProperties
}

/** One card's slot in a {@link SectionGrid}. Its child fills the slot. */
export function SectionCell({ children, width = 'full', className, style }: SectionCellProps) {
  return <div className={cx('uk-sgrid__cell', `uk-sgrid__cell--${width}`, className)} style={style}>{children}</div>
}
