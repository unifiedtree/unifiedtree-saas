// Ledger (prototype UtSection "ledger" body): side-by-side groups of lines —
// Earnings, Deductions — each with its total, and the net amount under them.
// The design draws the net amount on a dark green gradient; the README rule
// "no dark-green filled content blocks in pages" wins, so LedgerNet is a
// brand-soft banner (light green fill, brand line, ink figure).
import { useId, type ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

export interface LedgerLine {
  key?: string
  label: ReactNode
  /** The amount. Empty shows "—". */
  value?: ReactNode
  /** Small line under the label ("On ₹58,000 basic"). */
  note?: ReactNode
  /** Grey, lighter value (e.g. "Not calculated yet"). Empty values are always muted. */
  muted?: boolean
}

export interface LedgerGroup {
  key?: string
  /** "Earnings", "Deductions". Shown in small capitals. */
  title: string
  /** Dot colour: success (earnings), danger (deductions), neutral. */
  tone?: 'success' | 'danger' | 'neutral'
  lines: readonly LedgerLine[]
  totalLabel?: ReactNode
  total?: ReactNode
}

export interface LedgerNetProps {
  /** "Net pay", "Take-home". */
  label: ReactNode
  value: ReactNode
  /** "Preview until the run is locked". */
  note?: ReactNode
  className?: string
}

export interface LedgerProps {
  groups: readonly LedgerGroup[]
  /** The net amount under the groups. */
  net?: LedgerNetProps
  className?: string
}

export function Ledger({ groups, net, className }: LedgerProps) {
  const uid = useId()
  return (
    <div className={cx('uk-ledger', className)}>
      <div className="uk-ledger__groups">
        {groups.map((g, gi) => (
          <div key={g.key ?? gi} className="uk-ledger__group" role="group" aria-labelledby={`${uid}-${gi}`}>
            <div className="uk-ledger__head">
              <span className={cx('uk-ledger__dot', `uk-ledger__dot--${g.tone ?? 'neutral'}`)} aria-hidden="true" />
              <span id={`${uid}-${gi}`} className="uk-ledger__title">{g.title}</span>
            </div>
            <dl className="uk-ledger__lines">
              {g.lines.map((l, i) => {
                const empty = l.value == null || l.value === '' || l.value === '—'
                return (
                  <div key={l.key ?? i} className="uk-ledger__line">
                    <dt className="uk-ledger__k">
                      {l.label}
                      {l.note != null && l.note !== '' && <span className="uk-ledger__note">{l.note}</span>}
                    </dt>
                    <dd className={cx('uk-ledger__v', (empty || l.muted) && 'is-muted')}>{empty ? '—' : l.value}</dd>
                  </div>
                )
              })}
            </dl>
            {(g.totalLabel != null || g.total != null) && (
              <div className="uk-ledger__total">
                <span>{g.totalLabel}</span>
                <span className="uk-ledger__tv">{g.total}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {net && <LedgerNet {...net} />}
    </div>
  )
}

/** The net amount banner (brand-soft, see the file note). Usable on its own too. */
export function LedgerNet({ label, value, note, className }: LedgerNetProps) {
  return (
    <div className={cx('uk-ledger-net', className)} role="group" aria-label={typeof label === 'string' ? label : undefined}>
      <div className="uk-ledger-net__text">
        <div className="uk-ledger-net__k">{label}</div>
        {note != null && note !== '' && <div className="uk-ledger-net__note">{note}</div>}
      </div>
      <div className="uk-ledger-net__v">{value}</div>
    </div>
  )
}
