// An approval request row, in the design's two sizes:
//  - "compact" (EmpHome "Waiting for you"): avatar, name, what, when, round reject/approve buttons;
//    once decided, a status pill and Undo while it is still allowed.
//  - "card" (TeamApprovals): avatar, name, kind pill, when, what, the reason, facts, a warning,
//    an optional note box and Reject / Approve; once decided, a one-line result with Undo.
// It holds no data: it shows what it is given and calls the callbacks it is given. Buttons only
// render when their callback is passed, so a page passes them only with the permission.
import { useEffect, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { dashIcon } from '@/design/dc/icons'
import './overlays.css'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalBusy = boolean | 'approve' | 'reject' | 'undo'

export interface ApprovalRowProps {
  /** Who asked, e.g. "Priya Sharma". */
  name: string
  /** What they asked for, e.g. "Casual leave · Mon 28 – Tue 29 Sep · 2 days". */
  title: ReactNode
  /** When, e.g. "12 min ago". */
  meta?: ReactNode
  /** Kind pill in the card layout, e.g. "Leave". */
  kind?: ReactNode
  /** Avatar content; default: initials from the name. */
  avatar?: ReactNode
  /** The reason they gave (shown in quotes in the card layout). */
  reason?: ReactNode
  /** Label/value facts in the card layout, e.g. Balance after, Others out. */
  facts?: { label: ReactNode; value: ReactNode }[]
  /** A warning in the card layout, e.g. "Two of eight people out on 7–8 Oct". */
  flag?: ReactNode
  status: ApprovalStatus
  /** Text of the decided pill/line; default "Approved" / "Rejected". */
  statusLabel?: ReactNode
  /** Disable the buttons while a call is running; pass which one to show "Saving…" on it. */
  busy?: ApprovalBusy
  onApprove?: (note: string) => void
  onReject?: (note: string) => void
  onUndo?: () => void
  /** Undo shows only while this is true (default true when onUndo is given)… */
  canUndo?: boolean
  /** …and until this moment (ms timestamp, ISO string or Date), after which it hides by itself. */
  undoUntil?: number | string | Date | null
  /** Card layout: show the "Add a note (optional)" box; its text goes to onApprove / onReject. */
  withNote?: boolean
  notePlaceholder?: string
  /** Opens the request's details (the name becomes a button). */
  onOpen?: () => void
  variant?: 'compact' | 'card'
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

const toMs = (v: ApprovalRowProps['undoUntil']) =>
  v == null ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)

/** True while `until` is in the future; flips to false on time, without polling. */
function useStillBefore(until: number | null): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until == null || Number.isNaN(until)) return
    const wait = until - Date.now()
    if (wait <= 0) { setNow(Date.now()); return }
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait + 20, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [until])
  return until == null || Number.isNaN(until) ? true : now < until
}

export function ApprovalRow({
  name, title, meta, kind, avatar, reason, facts, flag, status, statusLabel, busy = false,
  onApprove, onReject, onUndo, canUndo, undoUntil, withNote = false, notePlaceholder = 'Add a note (optional)',
  onOpen, variant = 'compact',
}: ApprovalRowProps) {
  const [note, setNote] = useState('')
  const inTime = useStillBefore(toMs(undoUntil))
  const decided = status !== 'pending'
  const showUndo = decided && !!onUndo && (canUndo ?? true) && inTime
  const isBusy = !!busy
  const result = statusLabel ?? (status === 'approved' ? 'Approved' : 'Rejected')
  const who = onOpen
    ? <button type="button" className="uko-appr-name uko-appr-link" onClick={onOpen}>{name}</button>
    : <span className="uko-appr-name">{name}</span>
  const undoBtn = showUndo && (
    <button type="button" className="uko-appr-undo" onClick={onUndo} disabled={isBusy} aria-busy={busy === 'undo' || undefined}>
      {busy === 'undo' ? 'Undoing…' : 'Undo'}
    </button>
  )
  const av = <span className="uko-appr-av" data-size={variant === 'card' ? 'lg' : undefined} aria-hidden="true">{avatar ?? initials(name)}</span>

  if (variant === 'compact') {
    return (
      <div className="uko-appr" data-status={status} role="group" aria-label={name}>
        {av}
        <span className="uko-appr-main">
          {who}
          <span className="uko-appr-what">{title}</span>
        </span>
        {meta != null && <span className="uko-appr-when">{meta}</span>}
        {!decided && onReject && (
          <button type="button" className="uko-appr-no" aria-label="Reject" title="Reject" onClick={() => onReject(note)} disabled={isBusy} aria-busy={busy === 'reject' || undefined}>
            {busy === 'reject' ? <span className="uko-spin" aria-hidden="true" /> : <X size={15} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        )}
        {!decided && onApprove && (
          <button type="button" className="uko-appr-yes" aria-label="Approve" title="Approve" onClick={() => onApprove(note)} disabled={isBusy} aria-busy={busy === 'approve' || undefined}>
            {busy === 'approve' ? <span className="uko-spin" aria-hidden="true" /> : <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
          </button>
        )}
        {decided && <span className="uko-appr-pill" data-status={status}>{result}</span>}
        {undoBtn}
      </div>
    )
  }

  if (decided) {
    return (
      <article className="uko-apprc" data-status={status} aria-label={name}>
        <div className="uko-apprc-done">
          <span className="uko-apprc-mark" data-status={status} aria-hidden="true">
            {status === 'approved' ? <Check size={14} strokeWidth={2.6} /> : <X size={14} strokeWidth={2.6} />}
          </span>
          <span className="uko-apprc-line"><b>{result}</b> · {name} · {title}</span>
          {undoBtn}
        </div>
      </article>
    )
  }

  return (
    <article className="uko-apprc" data-status={status} aria-label={name}>
      <div className="uko-apprc-open">
        <div className="uko-apprc-top">
          {av}
          <div className="uko-apprc-main">
            <div className="uko-apprc-row">
              {who}
              {kind != null && <span className="uko-apprc-kind">{kind}</span>}
              {meta != null && <span className="uko-appr-when">{meta}</span>}
            </div>
            <div className="uko-apprc-what">{title}</div>
            {reason != null && reason !== '' && <div className="uko-apprc-reason">“{reason}”</div>}
          </div>
        </div>
        {facts && facts.length > 0 && (
          <dl className="uko-apprc-facts">
            {facts.map((f, i) => (
              <div key={i} className="uko-apprc-fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
        )}
        {flag != null && flag !== '' && (
          <div className="uko-apprc-flag">{dashIcon('alertTriangle', 16)}<span>{flag}</span></div>
        )}
        {(onApprove || onReject || withNote) && (
          <div className="uko-apprc-actions">
            {withNote && (
              <input
                type="text"
                className="uko-apprc-note"
                placeholder={notePlaceholder}
                aria-label={`Note for ${name}`}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                disabled={isBusy}
              />
            )}
            {onReject && (
              <button type="button" className="uko-btn" data-variant="secondary" data-size="md" data-tone="reject" onClick={() => onReject(note)} disabled={isBusy} aria-busy={busy === 'reject' || undefined}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            )}
            {onApprove && (
              <button type="button" className="uko-btn" data-variant="primary" data-size="md" onClick={() => onApprove(note)} disabled={isBusy} aria-busy={busy === 'approve' || undefined}>
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
