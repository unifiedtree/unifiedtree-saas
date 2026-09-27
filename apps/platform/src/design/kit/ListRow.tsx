// List rows (dashboard lists, Team today, Home cards): a leading avatar / icon
// tile / date tile, a title with a sub-line, an optional middle column, then
// right-hand content — times, pills — and, outside the clickable area, any
// buttons (approve, remind…). The whole left part can be a button or a link.
//
//   variant "hover"    rows with a rounded hover fill (dashboard cards; put in <ListRows inset>)
//   variant "divided"  rows separated by a hairline (Home and Team cards)
//   variant "table"    full-bleed rows with a top hairline and 20px sides (Team today's roster)
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import type { StatusTone } from './StatusPill'
import './display.css'

export type ListRowVariant = 'hover' | 'divided' | 'table'

export interface ListRowProps {
  /** Avatar, IconTile or DateTile. */
  leading?: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** A middle column ("In at 09:24 · Face · BLR-HQ"); drops below the title on narrow screens. */
  meta?: ReactNode
  /** Right-hand content that isn't a control: a time, a status pill, a due chip. */
  end?: ReactNode
  /** Buttons for this row (approve / reject / remind). Kept outside the row's own click area. */
  actions?: ReactNode
  /** A chevron at the end, for rows that open something. */
  chevron?: boolean
  variant?: ListRowVariant
  /** compact 8px, default 10px, comfy 12px vertical padding. */
  density?: 'compact' | 'default' | 'comfy'
  onClick?: (e: MouseEvent<HTMLElement>) => void
  href?: string
  /** Accessible name for the clickable part, when the visible text isn't enough. */
  ariaLabel?: string
  selected?: boolean
  className?: string
  style?: CSSProperties
}

export function ListRow({
  leading, title, sub, meta, end, actions, chevron, variant = 'hover', density = 'default', onClick, href, ariaLabel, selected, className, style,
}: ListRowProps) {
  const interactive = !!(onClick || href)
  const body = (
    <>
      {leading != null && <span className="uk-row__lead">{leading}</span>}
      <span className="uk-row__text">
        <span className="uk-row__title">{title}</span>
        {sub != null && sub !== '' && <span className="uk-row__sub">{sub}</span>}
      </span>
      {meta != null && meta !== '' && <span className="uk-row__meta">{meta}</span>}
      {end != null && end !== '' && <span className="uk-row__end">{end}</span>}
      {chevron && (
        <svg className="uk-row__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </>
  )
  return (
    <div role="listitem" className={cx('uk-row', `uk-row--${variant}`, `uk-row--${density}`, interactive && 'uk-row--link', selected && 'uk-row--selected', className)} style={style}>
      {href ? (
        <a className="uk-row__main" href={href} aria-label={ariaLabel} aria-current={selected ? 'true' : undefined} onClick={linkClick(onClick)}>{body}</a>
      ) : onClick ? (
        <button type="button" className="uk-row__main" aria-label={ariaLabel} aria-pressed={selected === undefined ? undefined : selected} onClick={onClick}>{body}</button>
      ) : (
        <span className="uk-row__main">{body}</span>
      )}
      {actions != null && <span className="uk-row__actions">{actions}</span>}
    </div>
  )
}

export interface ListRowsProps {
  children: ReactNode
  /** Accessible name for the list. */
  label?: string
  /** 8px side inset so hover rows sit inside the card (dashboard lists). */
  inset?: boolean
  /** Pull the rows 8px past the card padding so their hover fill reaches out (Home / panel cards). */
  bleed?: boolean
  className?: string
  style?: CSSProperties
}

/** The list wrapper for ListRow (role="list"). */
export function ListRows({ children, label, inset, bleed, className, style }: ListRowsProps) {
  return (
    <div role="list" aria-label={label} className={cx('uk-rows', inset && 'uk-rows--inset', bleed && 'uk-rows--bleed', className)} style={style}>
      {children}
    </div>
  )
}

export interface IconTileProps {
  icon: KitIcon
  /** Colour family; the icon takes the solid colour, the tile its soft fill. */
  tone?: StatusTone
  /** Tile size in px (default 38; section headings use 36). */
  size?: number
  className?: string
}

/** A soft square with an icon (Home's "Needs you" rows, section headings). */
export function IconTile({ icon, tone = 'brand', size = 38, className }: IconTileProps) {
  return (
    <span className={cx('uk-itile', `uk-tone--${tone}`, className)} aria-hidden="true"
      style={{ width: size, height: size, borderRadius: size >= 36 ? 11 : 9 }}>
      {renderIcon(icon, size >= 36 ? 18 : 16)}
    </span>
  )
}

export interface DateTileProps {
  /** Day of month, e.g. 28. */
  day: ReactNode
  /** Short month, e.g. "Sep". */
  month: ReactNode
  /** Full date for screen readers, e.g. "Monday 28 September". */
  label?: string
  className?: string
}

/** The date block on "Around you" rows. */
export function DateTile({ day, month, label, className }: DateTileProps) {
  return (
    <span className={cx('uk-dtile', className)} {...(label ? { role: 'img', 'aria-label': label } : {})}>
      <span className="uk-dtile__d" aria-hidden={label ? true : undefined}>{day}</span>
      <span className="uk-dtile__m" aria-hidden={label ? true : undefined}>{month}</span>
    </span>
  )
}
