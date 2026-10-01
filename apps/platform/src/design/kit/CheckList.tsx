// A list of checks with a mark before each line (prototype EmpClaims "Before you send": a
// green tick for what's fine, a gold warning for what needs a look). Also for task lists
// (onboarding: done / still to do) and form summaries. Each line may carry a quiet second
// line and a small action on the right ("Mark done").
//
// The checks and their words come from the page's real state (a receipt attached, the
// server's limit). Screen readers hear the state before each line ("Needs attention: Add a
// receipt…"), so the colour is never the only signal.
import type { ReactNode } from 'react'
import { cx, renderIcon } from './displayUtil'
import './display.css'
import './data.css'

/** ok (green tick) · warn (gold warning) · bad (red cross) · todo (empty ring: not done yet). */
export type CheckState = 'ok' | 'warn' | 'bad' | 'todo'

export interface CheckItem {
  key?: string
  label: ReactNode
  /** A quieter second line. */
  sub?: ReactNode
  state: CheckState
  /** A small control on the right of the line (a Button size={30}). */
  action?: ReactNode
  /** What screen readers hear before the line, when the default word doesn't fit. */
  stateLabel?: string
}

export interface CheckListProps {
  items: readonly CheckItem[]
  /** Accessible name of the list ("Before you send"). */
  label?: string
  /** md = 13.5px lines, 14px apart (the design); sm = 13px lines, 10px apart (inside forms). */
  size?: 'md' | 'sm'
  className?: string
}

const SPOKEN: Record<CheckState, string> = { ok: 'Done', warn: 'Needs attention', bad: 'Problem', todo: 'To do' }
const ICON: Record<CheckState, string | null> = { ok: 'check', warn: 'alertTriangle', bad: 'circleX', todo: null }

export function CheckList({ items, label, size = 'md', className }: CheckListProps) {
  return (
    <ul className={cx('uk-checks', size === 'sm' && 'uk-checks--sm', className)} aria-label={label}>
      {items.map((it, i) => {
        const icon = ICON[it.state]
        return (
          <li key={it.key ?? i} className={cx('uk-checks__item', `is-${it.state}`)}>
            <span className="uk-checks__icon" aria-hidden="true">{icon ? renderIcon(icon, 18) : <span className="uk-checks__ring" />}</span>
            <span className="uk-checks__text">
              <span className="uk-sr">{it.stateLabel ?? SPOKEN[it.state]}: </span>
              {it.label}
              {it.sub != null && it.sub !== '' && <span className="uk-checks__sub">{it.sub}</span>}
            </span>
            {it.action != null && <span className="uk-checks__action">{it.action}</span>}
          </li>
        )
      })}
    </ul>
  )
}
