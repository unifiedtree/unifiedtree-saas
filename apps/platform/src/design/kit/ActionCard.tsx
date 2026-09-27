// An item card with its state and actions (prototype EmpDocs: Letters, My documents, My assets,
// Policies): an icon tile, the item's name and a quiet line, then its state — a green tick and
// word when it's settled ("Verified", "Signed", "With you"), or a gold pill and a gold ring round
// the card when it needs the person ("Needs your signature", "Upload again", "Confirm you got
// it") — and its actions: a main one in brand green, a secondary one outlined.
//
// The design puts the state and both buttons on one line, which overflows a 300px card (the
// prototype's own screenshot shows it); here the buttons wrap onto their own line when they
// don't fit. Put several in an ActionCardGrid (auto-fill, 300px minimum, 12px apart).
//
// Only shows what it's given: the name, the state and whether an action is needed come from
// the record; the page decides which actions the person may take.
import { useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { fxIndex } from '@/design/theme/motion'
import { Button } from './Button'
import { StatusPill } from './StatusPill'
import { cx, renderIcon, type KitIcon } from './displayUtil'
import './display.css'
import './data.css'

export interface ActionCardAction {
  label: ReactNode
  onClick?: (e: MouseEvent<HTMLElement>) => void
  /** A real link (opens in place; target="_blank" for a file). */
  href?: string
  target?: string
  icon?: KitIcon
  loading?: boolean
  disabled?: boolean
  /** A fuller name for screen readers ("Download the appraisal letter"). */
  ariaLabel?: string
}

/** done = green tick and words; action = gold pill and a gold ring round the card; neutral = grey pill; danger = red pill. */
export type ActionCardTone = 'done' | 'action' | 'neutral' | 'danger'

export interface ActionCardProps {
  /** Icon name (design/dc/icons: file, mail, laptop, shieldPlain…) or an element. */
  icon?: KitIcon
  title: ReactNode
  /** The quiet line under the name ("Verified · 14 Mar 2022", "Sent by Meera Joshi on 22 Sep"). */
  sub?: ReactNode
  /** The state words ("Verified", "Needs your signature"). */
  status?: ReactNode
  tone?: ActionCardTone
  primary?: ActionCardAction
  secondary?: ActionCardAction
  /** Other controls in the actions row, after the two buttons. */
  actions?: ReactNode
  /** Heading level of the name (default 3, under a page's section heading). */
  headingLevel?: 2 | 3 | 4
  /** Entrance stagger position. */
  index?: number
  /** Add the legacy `.ut-card` class (default true). */
  cardClass?: boolean
  id?: string
  className?: string
  style?: CSSProperties
}

const PILL: Record<Exclude<ActionCardTone, 'done'>, 'warning' | 'neutral' | 'danger'> = { action: 'warning', neutral: 'neutral', danger: 'danger' }

function act(a: ActionCardAction, variant: 'primary' | 'secondary') {
  return (
    <Button variant={variant} size={36} className="uk-acard__btn" icon={a.icon} href={a.href} target={a.target} loading={a.loading}
      disabled={a.disabled} aria-label={a.ariaLabel} onClick={a.onClick}>
      {a.label}
    </Button>
  )
}

export function ActionCard({
  icon, title, sub, status, tone = 'done', primary, secondary, actions, headingLevel = 3, index, cardClass = true, id, className, style,
}: ActionCardProps) {
  const uid = useId()
  const titleId = `${uid}-t`
  const H = headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3'
  const needs = tone === 'action'
  const hasStatus = status != null && status !== ''
  const hasActs = !!(primary || secondary || actions)
  return (
    <article id={id} aria-labelledby={titleId} className={cx(cardClass && 'ut-card', 'uk-acard', needs && 'uk-acard--action', 'ufx-rise', className)}
      style={fxIndex(index, style)}>
      {needs && <span className="uk-acard__ring" aria-hidden="true" />}
      <div className="uk-acard__head">
        {icon != null && icon !== '' && <span className="uk-acard__tile" aria-hidden="true">{renderIcon(icon, 19)}</span>}
        <div className="uk-acard__text">
          <H id={titleId} className="uk-acard__title">{title}</H>
          {sub != null && sub !== '' && <p className="uk-acard__sub">{sub}</p>}
        </div>
      </div>
      {(hasStatus || hasActs) && (
        <div className="uk-acard__foot">
          {hasStatus && (tone === 'done'
            ? <span className="uk-acard__state">{renderIcon('check', 15)}<span>{status}</span></span>
            : <StatusPill tone={PILL[tone]} size="sm" className="uk-acard__pill">{status}</StatusPill>)}
          {hasActs && (
            <div className="uk-acard__acts">
              {primary && act(primary, 'primary')}
              {secondary && act(secondary, 'secondary')}
              {actions}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export interface ActionCardGridProps {
  children: ReactNode
  /** Narrowest card before the grid wraps (default 300, as the design). */
  min?: number
  /** Accessible name of the group ("Your letters"). */
  label?: string
  className?: string
  style?: CSSProperties
}

/** The cards' grid: repeat(auto-fill, minmax(min(100%, 300px), 1fr)), 12px apart. */
export function ActionCardGrid({ children, min = 300, label, className, style }: ActionCardGridProps) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={cx('uk-acards', className)}
      style={{ ...style, ['--uk-min' as string]: `${min}px` } as CSSProperties}>
      {children}
    </div>
  )
}
