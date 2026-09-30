// Quick-action tiles (prototype UtQuick): a 54px mint tile holding a line scene
// that plays on hover (QuickIcon), an optional gold count badge, the label, a
// one-line hint and an arrow that slides in on hover. The tile lifts, tilts and
// lights its border like the stat cards. Pages decide which actions show (by
// permission) and pass real hints/counts.
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { fxIndex, useHoverFx } from '@/design/theme/motion'
import { QuickIcon, type QuickIconKind } from './AnimatedIcons'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

export interface QuickActionTileProps {
  label: string
  /** One short line under the label ("9 requests waiting"). */
  hint?: ReactNode
  /** The moving scene: user, coins, calendar, clock, megaphone, chart, home, download, swap, mail. */
  kind?: QuickIconKind
  /** A plain icon instead of a scene (icon name or element), for actions without one. */
  icon?: KitIcon
  /** Gold count chip at the top right (e.g. waiting requests). Hidden when empty or 0. */
  badge?: string | number | null
  /** What the badge counts, for screen readers ("9 waiting"). Defaults to the badge text. */
  badgeLabel?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
  href?: string
  disabled?: boolean
  index?: number
  className?: string
  style?: CSSProperties
}

export function QuickActionTile({ label, hint, kind, icon, badge, badgeLabel, onClick, href, disabled, index, className, style }: QuickActionTileProps) {
  const fx = useHoverFx<HTMLElement>('tilt')
  const showBadge = badge != null && badge !== '' && badge !== 0 && badge !== '0'
  const cls = cx('uk-qa', !disabled && 'ufx-tilt', disabled && 'uk-qa--disabled', 'ufx-rise', className)
  const inner = (
    <>
      <span aria-hidden="true" className="uk-fx-spot" />
      <span aria-hidden="true" className="uk-fx-light ufx-light" />
      <span className="uk-qa__top">
        <span className="uk-qa__tile" aria-hidden="true">
          {kind ? <QuickIcon kind={kind} size={44} /> : <span className="uk-qa__plain">{renderIcon(icon, 24)}</span>}
        </span>
        {showBadge && (
          <span className="uk-qa__badge">
            <span aria-hidden="true">{badge}</span>
            <span className="uk-sr">{badgeLabel ?? String(badge)}</span>
          </span>
        )}
      </span>
      <span className="uk-qa__text">
        <span className="uk-qa__label">{label}</span>
        {hint != null && hint !== '' && <span className="uk-qa__hint">{hint}</span>}
        <svg className="uk-qa__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </>
  )
  const st = fxIndex(index, style)
  if (href && !disabled) {
    return <a href={href} className={cls} style={st} onClick={linkClick(onClick)} {...fx}>{inner}</a>
  }
  return (
    <button type="button" className={cls} style={st} onClick={onClick} disabled={disabled} {...(disabled ? {} : fx)}>
      {inner}
    </button>
  )
}

export interface QuickActionGridProps {
  children: ReactNode
  /** Narrowest tile before wrapping (default 150, as the design). */
  min?: number
  label?: string
  className?: string
}

/** The quick-action row: auto-fit tiles, 12px apart. */
export function QuickActionGrid({ children, min = 150, label = 'Quick actions', className }: QuickActionGridProps) {
  return (
    <div role="group" aria-label={label} className={cx('uk-grid uk-grid--qa', className)}
      style={{ ['--uk-min' as string]: `${min}px`, ['--uk-gap' as string]: '12px' } as CSSProperties}>
      {children}
    </div>
  )
}
