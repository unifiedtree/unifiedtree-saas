// Status pills, count badges, chips and status dots — the small labels the
// design uses everywhere (StyleGuide "Components", UtSection table pills, the
// dashboard's attendance rows, Team today, Companies & branches).
//
// Tones follow the README palette. Each has a soft background and a readable
// text colour, and works in dark mode (tokens, or a mix with the surface).
import type { ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

/**
 * brand     brand soft / brand text     (Present, Approved, Active)
 * mint      brand soft 2 / brand text   (Work from home in the style guide)
 * success   success soft / success text (In, Approved, Paid)
 * warning   gold soft / gold text       (Late, Waiting, Pending)
 * danger    red soft / red text         (Absent, Rejected, Failed)
 * info      blue                        (Home, In review)
 * leave     orange                      (On leave)
 * holiday   purple                      (Holiday)
 * amber     amber                       (Not in yet, Half day)
 * neutral   hover grey / ink 2          (Inactive, Draft)
 * muted     hover grey / ink 3          (Not marked)
 */
export type StatusTone = 'brand' | 'mint' | 'success' | 'warning' | 'danger' | 'info' | 'leave' | 'holiday' | 'amber' | 'neutral' | 'muted'

export const STATUS_TONES: readonly StatusTone[] = ['brand', 'mint', 'success', 'warning', 'danger', 'info', 'leave', 'holiday', 'amber', 'neutral', 'muted']

export interface StatusPillProps {
  tone?: StatusTone
  children: ReactNode
  /**
   * xs   22px at 11.5px, the due chips on Home and the quick-action badge
   * sm   22px, the table/list pill (default)
   * md   24px, the style-guide pill (use with `dot`)
   * tag  28px, 9px corners — the square-ish status tag in Home's team list
   */
  size?: 'xs' | 'sm' | 'md' | 'tag'
  /** A small dot in the text colour before the label. */
  dot?: boolean
  /** Fixed width (px) so a column of pills lines up (the dashboard uses 96). */
  minWidth?: number
  title?: string
  className?: string
}

/** A status label. The words come from your data ("Late", "Approved"); the tone is how it should read. */
export function StatusPill({ tone = 'neutral', children, size = 'sm', dot, minWidth, title, className }: StatusPillProps) {
  return (
    <span className={cx('uk-pill', `uk-pill--${size}`, `uk-tone--${tone}`, minWidth != null && 'uk-pill--fixed', className)}
      style={minWidth != null ? { minWidth } : undefined} title={title}>
      {dot && <span className="uk-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export interface CountBadgeProps {
  children: ReactNode
  /** brand (section counts), gold (things that need you), success (totals). */
  tone?: 'brand' | 'gold' | 'success' | 'neutral'
  /** sm 20px (UtSection), md 22px (Needs you), lg 24px (Branches). */
  size?: 'sm' | 'md' | 'lg'
  weight?: 500 | 600
  /** Screen-reader wording, e.g. "19 items need you". */
  label?: string
  className?: string
}

/** The small count next to a card title ("Needs your action 19"). */
export function CountBadge({ children, tone = 'brand', size = 'sm', weight, label, className }: CountBadgeProps) {
  return (
    <span className={cx('uk-count', `uk-count--${tone}`, `uk-count--${size}`, weight === 600 && 'uk-count--strong', className)}>
      {label ? <><span aria-hidden="true">{children}</span><span className="uk-sr">{label}</span></> : children}
    </span>
  )
}

export interface ChipProps {
  children: ReactNode
  /**
   * soft     grey filled, 28px (company facts: "IT Services", "India · INR")
   * outline  white with a line, 34px, with a bold `value` first ("3 companies")
   * code     monospace code chip ("BLR-HQ", "EMP-0031")
   */
  variant?: 'soft' | 'outline' | 'code'
  /** Outline chips: the figure shown in ink before the label. */
  value?: ReactNode
  title?: string
  className?: string
}

export function Chip({ children, variant = 'soft', value, title, className }: ChipProps) {
  return (
    <span className={cx('uk-chip', `uk-chip--${variant}`, className)} title={title}>
      {value != null && value !== '' && <b className="uk-chip__value">{value}</b>}
      {children}
    </span>
  )
}

export interface StatusDotProps {
  children: ReactNode
  /** success (Active), muted (Inactive), warning, danger, info. */
  tone?: 'success' | 'muted' | 'warning' | 'danger' | 'info' | 'brand'
  className?: string
}

/** A coloured dot and a word: "● Active". */
export function StatusDot({ children, tone = 'success', className }: StatusDotProps) {
  return (
    <span className={cx('uk-sdot', `uk-sdot--${tone}`, className)}>
      <span className="uk-sdot__dot" aria-hidden="true" />
      {children}
    </span>
  )
}
