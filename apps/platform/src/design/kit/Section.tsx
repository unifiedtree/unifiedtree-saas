// A titled card (prototype UtSection, and the dashboard / Home / Team cards):
// title with an optional count badge, a sub-line, header actions (a segmented
// control, an outlined action), the body, and an optional "View all" link at
// the bottom. It owns its data states: pass `loading`, `error` (+ onRetry) and
// `empty`, and it shows the skeleton, the error with "Try again", or the empty
// line instead of the body.
//
//   variant "section"    UtSection: 18px corners, 15px title (admin module pages, default)
//   variant "dashboard"  dashboard cards: 16px corners, roomier header, quiet hover spotlight
//   variant "panel"      Home / Team / Time cards: 18px corners, 16px title (a flush body reaches the edges)
//   variant "large"      Companies & branches: 20px corners, 18px title
//
// Also here: SectionHeading (the dashboard's group headings and the "Quick
// actions  Most used first" line), SectionLink / SectionAction (the small
// header and footer buttons), MiniStat (UtSection "stats") and KeyValueGrid
// (UtSection "kv").
import { useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { fxIndex, useHoverFx } from '@/design/theme/motion'
import { CountUp } from './StatCard'
import { CountBadge } from './StatusPill'
import { EmptyState, ErrorState, type EmptyVariant } from './EmptyState'
import { SkeletonChart, SkeletonList, SkeletonStats, SkeletonTable, SkeletonText } from './Skeleton'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

export interface SectionEmpty {
  title: ReactNode
  hint?: ReactNode
  icon?: KitIcon
  action?: ReactNode
  /** dashed (default in sections) or plain (the icon badge, dashboard cards) or success (all caught up). */
  variant?: EmptyVariant
}

export type SectionSkeleton = 'list' | 'stats' | 'table' | 'text' | 'chart'

export interface SectionLinkProps {
  label: ReactNode
  onClick?: (e: MouseEvent<HTMLElement>) => void
  href?: string
  /** Trailing arrow (default true for footers and "View …" links). */
  arrow?: boolean
  /** sm 30px/13px (card headers), md 34px/13.5px (group headings), block = full-width footer. */
  size?: 'sm' | 'md' | 'block'
  ariaLabel?: string
  className?: string
}

/** A quiet brand-coloured link button: "See all", "View attendance →", or the full-width card footer. */
export function SectionLink({ label, onClick, href, arrow, size = 'sm', ariaLabel, className }: SectionLinkProps) {
  const showArrow = arrow ?? size !== 'sm'
  const cls = cx('uk-slink', `uk-slink--${size}`, className)
  const inner = (
    <>
      {label}
      {showArrow && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
    </>
  )
  return href
    ? <a className={cls} href={href} aria-label={ariaLabel} onClick={linkClick(onClick)}>{inner}</a>
    : <button type="button" className={cls} aria-label={ariaLabel} onClick={onClick}>{inner}</button>
}

export interface SectionActionProps {
  label: ReactNode
  onClick?: (e: MouseEvent<HTMLElement>) => void
  href?: string
  icon?: KitIcon
  disabled?: boolean
  ariaLabel?: string
  /** brand = UtSection's brand-text action (default); neutral = grey text, 32px (the dashboard's Customise). */
  tone?: 'brand' | 'neutral'
}

/** The outlined header button of a section ("Export", "Customise"). */
export function SectionAction({ label, onClick, href, icon, disabled, ariaLabel, tone = 'brand' }: SectionActionProps) {
  const ic = renderIcon(icon, 14)
  const inner = <>{ic && <span className="uk-sact__icon" aria-hidden="true">{ic}</span>}{label}</>
  return href && !disabled
    ? <a className={cx('uk-sact', tone === 'neutral' && 'uk-sact--neutral')} href={href} aria-label={ariaLabel} onClick={linkClick(onClick)}>{inner}</a>
    : <button type="button" className={cx('uk-sact', tone === 'neutral' && 'uk-sact--neutral')} aria-label={ariaLabel} onClick={onClick} disabled={disabled}>{inner}</button>
}

export interface SectionProps {
  title: ReactNode
  /** Heading level (default 2; use 3 for cards under a SectionHeading). */
  level?: 2 | 3
  /** Count after the title. Hidden when null/empty. */
  count?: ReactNode
  countTone?: 'brand' | 'gold' | 'success' | 'neutral'
  /** Screen-reader wording for the count ("19 need you"). */
  countLabel?: string
  sub?: ReactNode
  /** Right side of the header: SegmentedControl, buttons… */
  actions?: ReactNode
  /** The design's single outlined header action. */
  action?: SectionActionProps
  /** Full-width link at the bottom ("View all 19 items"). */
  footerLink?: SectionLinkProps
  /** Any footer content (instead of footerLink). */
  footer?: ReactNode
  variant?: 'section' | 'dashboard' | 'panel' | 'large'
  /** Body padding: default 4px 20px 20px · tight 4px 16px 16px (stat tiles, calendars) · list (rows with their own padding) · flush (tables). Panels have none. */
  body?: 'default' | 'tight' | 'list' | 'flush'
  loading?: boolean
  /** Truthy = the load failed; its message is shown. */
  error?: unknown
  onRetry?: () => void
  retrying?: boolean
  /** true = "Nothing here yet", or your own line and next action. */
  empty?: boolean | SectionEmpty
  /** What the loading placeholder looks like (default list). */
  skeleton?: SectionSkeleton
  skeletonRows?: number
  /** Quiet hover spotlight (default on for dashboard cards). */
  spot?: boolean
  rise?: boolean
  index?: number
  /** Add the legacy `.ut-card` class (default true). */
  cardClass?: boolean
  id?: string
  className?: string
  bodyClassName?: string
  style?: CSSProperties
  children?: ReactNode
}

function Placeholder({ kind, rows, label }: { kind: SectionSkeleton; rows?: number; label: string }) {
  switch (kind) {
    case 'stats': return <SkeletonStats count={rows ?? 4} min={150} label={label} />
    case 'table': return <SkeletonTable rows={rows ?? 5} label={label} />
    case 'text': return <SkeletonText lines={rows ?? 3} label={label} />
    case 'chart': return <SkeletonChart label={label} />
    default: return <SkeletonList rows={rows ?? 4} label={label} />
  }
}

export function Section({
  title, level = 2, count, countTone = 'brand', countLabel, sub, actions, action, footerLink, footer, variant = 'section', body = 'default',
  loading, error, onRetry, retrying, empty, skeleton = 'list', skeletonRows, spot, rise = true, index, cardClass = true, id, className, bodyClassName, style, children,
}: SectionProps) {
  const uid = useId()
  const titleId = `${uid}-t`
  const fx = useHoverFx<HTMLElement>('spot')
  const doSpot = spot ?? variant === 'dashboard'
  const H = level === 3 ? 'h3' : 'h2'
  const hasCount = count != null && count !== '' && count !== false
  const titleText = typeof title === 'string' ? title : 'this section'

  let content: ReactNode = children
  let state: 'ready' | 'loading' | 'error' | 'empty' = 'ready'
  if (loading) {
    state = 'loading'
    content = <Placeholder kind={skeleton} rows={skeletonRows} label={`Loading ${titleText}`} />
  } else if (error) {
    state = 'error'
    content = <ErrorState error={error} onRetry={onRetry} retrying={retrying} />
  } else if (empty) {
    state = 'empty'
    const e: SectionEmpty = empty === true ? { title: 'Nothing here yet' } : empty
    content = <EmptyState title={e.title} hint={e.hint} icon={e.icon} action={e.action} variant={e.variant ?? (variant === 'dashboard' ? 'plain' : 'dashed')} />
  }

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      data-state={state}
      className={cx(cardClass && 'ut-card', 'uk-sec', `uk-sec--${variant}`, doSpot && 'ufx-spot uk-sec--spot', rise && 'ufx-rise', className)}
      style={fxIndex(index, style)}
      {...(doSpot ? fx : {})}
    >
      {doSpot && <span aria-hidden="true" className="uk-fx-spot" />}
      <div className="uk-sec__head">
        <div className="uk-sec__titles">
          <div className="uk-sec__trow">
            <H id={titleId} className="uk-sec__title">{title}</H>
            {hasCount && (
              <CountBadge tone={countTone} size={variant === 'large' ? 'lg' : countTone === 'gold' ? 'md' : 'sm'} weight={variant === 'large' ? 600 : undefined} label={countLabel}>{count}</CountBadge>
            )}
          </div>
          {sub != null && sub !== '' && <p className="uk-sec__sub">{sub}</p>}
        </div>
        {(actions != null || action) && (
          <div className="uk-sec__acts">
            {actions}
            {action && <SectionAction {...action} />}
          </div>
        )}
      </div>
      <div className={cx('uk-sec__body', `uk-sec__body--${state === 'ready' ? body : 'state'}`, bodyClassName)}>{content}</div>
      {state === 'ready' && footerLink && <div className="uk-sec__foot"><SectionLink size="block" {...footerLink} /></div>}
      {state === 'ready' && footer != null && !footerLink && <div className="uk-sec__foot">{footer}</div>}
    </section>
  )
}

export interface SectionHeadingProps {
  title: ReactNode
  sub?: ReactNode
  /** With an icon: the dashboard's group heading (36px tile, 18px title). Without: the inline "Quick actions  Most used first". */
  icon?: KitIcon
  actions?: ReactNode
  level?: 2 | 3
  id?: string
  className?: string
}

/** A heading over a group of cards. */
export function SectionHeading({ title, sub, icon, actions, level = 2, id, className }: SectionHeadingProps) {
  const H = level === 3 ? 'h3' : 'h2'
  const grouped = icon != null && icon !== ''
  return (
    <div className={cx('uk-shead', grouped ? 'uk-shead--group' : 'uk-shead--inline', className)}>
      <div className="uk-shead__main">
        {grouped && <span className="uk-shead__icon" aria-hidden="true">{renderIcon(icon, 18)}</span>}
        <div className="uk-shead__text">
          <H id={id} className="uk-shead__title">{title}</H>
          {sub != null && sub !== '' && <p className="uk-shead__sub">{sub}</p>}
        </div>
      </div>
      {actions != null && <div className="uk-shead__acts">{actions}</div>}
    </div>
  )
}

export interface MiniStatProps {
  label: ReactNode
  value: string | number | null | undefined
  note?: ReactNode
  /** A status dot before the label. */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  countUp?: boolean
}

/** A small figure tile inside a section (UtSection "stats"). Put several in MiniStatGrid. */
export function MiniStat({ label, value, note, tone, countUp = true }: MiniStatProps) {
  return (
    <div className="uk-mstat">
      <div className="uk-mstat__label">
        {tone && <span className={cx('uk-mstat__dot', `uk-mstat__dot--${tone}`)} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className="uk-mstat__value"><CountUp value={value} countUp={countUp} /></div>
      {note != null && note !== '' && <div className="uk-mstat__note">{note}</div>}
    </div>
  )
}

/** The grid for MiniStat tiles: auto-fit, 150px minimum, 10px apart. */
export function MiniStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('uk-mstats', className)}>{children}</div>
}

export interface KeyValueItem {
  key?: string
  label: ReactNode
  /** Empty values show as "—". */
  value: ReactNode
}

/** Label / value pairs in a responsive grid (UtSection "kv"). */
export function KeyValueGrid({ items, className }: { items: readonly KeyValueItem[]; className?: string }) {
  return (
    <dl className={cx('uk-kv', className)}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="uk-kv__item">
          <dt className="uk-kv__k">{it.label}</dt>
          <dd className="uk-kv__v">{it.value == null || it.value === '' ? '—' : it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
