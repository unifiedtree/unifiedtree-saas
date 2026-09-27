// A short note on a tinted box (the design's inline notes: the step note under
// a payroll run, "Fri 2 Oct is a holiday…" on Home, "Next payday…", "Sent to
// Siddharth…"). Informational only — for errors that stop a block, use ErrorState.
import type { ReactNode } from 'react'
import { cx, renderIcon, type KitIcon } from './displayUtil'
import type { StatusTone } from './StatusPill'
import './display.css'

export interface CalloutProps {
  children: ReactNode
  /** brand (default), info, holiday, warning, danger, success, leave, amber, neutral. */
  tone?: StatusTone
  /** Icon name or element; default an info circle. Pass null for none. */
  icon?: KitIcon | null
  /** Announce it when it appears (a result the person just caused). */
  live?: boolean
  className?: string
}

export function Callout({ children, tone = 'brand', icon, live, className }: CalloutProps) {
  const ic = icon === null ? null : renderIcon(icon ?? 'info', 16)
  return (
    <div className={cx('uk-callout', `uk-tone--${tone}`, className)} role={live ? 'status' : undefined}>
      {ic && <span className="uk-callout__icon" aria-hidden="true">{ic}</span>}
      <div className="uk-callout__text">{children}</div>
    </div>
  )
}
