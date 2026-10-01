// Where a request or a record stands, step by step.
//
//   variant "bars"  the request steps (EmpLeave "Your requests", EmpClaims, Home "My requests"):
//                   one short bar per step — green when done, gold while it waits, grey not yet —
//                   with the step's name and a quiet line under it ("Sent · Today, 1:58 PM",
//                   "Siddharth Rao · Reviewing now", "Balance updated · After approval").
//   variant "rail"  a vertical list of dots joined by a line (profile "Lifecycle": Joined,
//                   Probation ends, Confirmed, Notice started). Give items a `time` and it becomes
//                   the day's punch list (EmpTime day details): time · dot · what happened.
//
// Only shows what it's given: the steps, their order and their words come from the request's
// real state. An ordered list; each step says its state to screen readers, and the step that
// is waiting carries aria-current="step".
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'
import './data.css'

/** done · current (waiting on someone now) · todo (not yet) · failed (stopped, rejected, a missed punch). */
export type TimelineState = 'done' | 'current' | 'todo' | 'failed'

export interface TimelineItem {
  key?: string
  /** The step: "Sent", the approver's name, "Balance updated", "Joined", "Checked in". */
  label: ReactNode
  /** The quiet line under it: a date, "Reviewing now", "After approval". */
  sub?: ReactNode
  /** Rail only: a time before the dot ("09:24"); any item with a time switches the rail to the punch-list layout. */
  time?: ReactNode
  state: TimelineState
  /** What screen readers hear for the state, when the default word doesn't fit ("missed"). */
  stateLabel?: string
}

export interface TimelineProps {
  items: readonly TimelineItem[]
  variant?: 'bars' | 'rail'
  /** Accessible name ("Leave request progress", "Lifecycle"). */
  label: string
  className?: string
  style?: CSSProperties
}

const SPOKEN: Record<TimelineState, string> = { done: 'done', current: 'in progress', todo: 'not yet', failed: 'stopped' }

export function Timeline({ items, variant = 'bars', label, className, style }: TimelineProps) {
  const timed = variant === 'rail' && items.some((it) => it.time != null && it.time !== '')
  const cls = cx('uk-tl', `uk-tl--${variant}`, timed && 'uk-tl--timed', className)
  const st = variant === 'bars' ? ({ ...style, ['--uk-tl-n' as string]: Math.max(1, items.length) } as CSSProperties) : style
  return (
    <ol className={cls} aria-label={label} style={st}>
      {items.map((it, i) => {
        const spoken = <span className="uk-sr">, {it.stateLabel ?? SPOKEN[it.state]}</span>
        const sub = it.sub != null && it.sub !== '' ? <span className="uk-tl__sub">{it.sub}</span> : null
        const k = it.key ?? i
        const common = { className: cx('uk-tl__item', `is-${it.state}`), 'aria-current': it.state === 'current' ? ('step' as const) : undefined }
        if (variant === 'bars') {
          return (
            <li key={k} {...common}>
              <span className="uk-tl__bar" aria-hidden="true" />
              <span className="uk-tl__label">{it.label}{spoken}</span>
              {sub}
            </li>
          )
        }
        if (timed) {
          return (
            <li key={k} {...common}>
              <span className="uk-tl__time">{it.time}</span>
              <span className="uk-tl__dot" aria-hidden="true" />
              <span className="uk-tl__text">
                <span className="uk-tl__label">{it.label}{spoken}</span>
                {sub}
              </span>
            </li>
          )
        }
        const last = i === items.length - 1
        return (
          <li key={k} {...common}>
            <span className="uk-tl__track" aria-hidden="true">
              <span className="uk-tl__dot" />
              {!last && <span className="uk-tl__line" />}
            </span>
            <span className="uk-tl__text">
              <span className="uk-tl__label">{it.label}{spoken}</span>
              {sub}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
