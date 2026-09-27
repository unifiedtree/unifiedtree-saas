// Horizontal steps (prototype UtSection "steps" body): numbered circles joined
// by a line — done (brand fill, tick), current (ringed number), to do (grey) —
// with a label and a short line under each. For a payroll run, a bank file,
// onboarding. The note under it is a Callout.
import type { ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

export type StepState = 'done' | 'current' | 'todo'

export interface StepItem {
  key?: string
  label: ReactNode
  /** The short line under the label ("25 Sep · 231 payslips", "Not yet"). */
  meta?: ReactNode
  state: StepState
}

export interface StepTrackProps {
  steps: readonly StepItem[]
  /** Accessible name ("Payroll run progress"). */
  label: string
  className?: string
}

const SPOKEN: Record<StepState, string> = { done: 'done', current: 'current step', todo: 'not started' }

export function StepTrack({ steps, label, className }: StepTrackProps) {
  return (
    <ol className={cx('uk-steps', className)} aria-label={label}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={s.key ?? i} className={cx('uk-step', `uk-step--${s.state}`)} aria-current={s.state === 'current' ? 'step' : undefined}>
            <div className="uk-step__track" aria-hidden="true">
              <span className="uk-step__dot">
                {s.state === 'done' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : i + 1}
              </span>
              {!last && <span className={cx('uk-step__line', s.state === 'done' && 'is-on')} />}
            </div>
            <div className="uk-step__text">
              <div className="uk-step__label">{s.label}<span className="uk-sr">, {SPOKEN[s.state]}</span></div>
              {s.meta != null && s.meta !== '' && <div className="uk-step__meta">{s.meta}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
