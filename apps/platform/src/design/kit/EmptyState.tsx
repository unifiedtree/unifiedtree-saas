// Empty and error states (prototype UtEmpty, UtSection's dashed empty box and
// the dashboard's "all caught up" box). Every data block shows one of these
// instead of blank space: a friendly line and, where there is one, the next action.
import type { ReactNode } from 'react'
import { cx, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

export type EmptyVariant = 'plain' | 'dashed' | 'success'

export interface EmptyStateProps {
  /** Short, friendly line: "No leave requests yet." */
  title: ReactNode
  /** What happens next or what to do: "Requests show up here once someone applies." */
  hint?: ReactNode
  /** Icon name (design/dc/icons) or element. Plain variant only; default an inbox. */
  icon?: KitIcon
  /** The next action — usually one button. */
  action?: ReactNode
  /**
   * plain   UtEmpty: icon badge with a soft halo, centred (cards, lists).
   * dashed  UtSection: a dashed box inside a section, no icon.
   * success the dashboard's "all caught up": green dashed box with a check.
   */
  variant?: EmptyVariant
  /** Minimum height of the block in px (e.g. to match the card it replaces). */
  minHeight?: number
  className?: string
}

export function EmptyState({ title, hint, icon, action, variant = 'plain', minHeight, className }: EmptyStateProps) {
  const style = minHeight ? { minHeight } : undefined
  if (variant === 'dashed') {
    return (
      <div className={cx('uk-empty', 'uk-empty--dashed', className)} style={style} role="status">
        <div className="uk-empty__title">{title}</div>
        {hint != null && hint !== '' && <div className="uk-empty__hint">{hint}</div>}
        {action && <div className="uk-empty__action">{action}</div>}
      </div>
    )
  }
  if (variant === 'success') {
    return (
      <div className={cx('uk-empty', 'uk-empty--success', className)} style={style} role="status">
        <span className="uk-empty__check" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <div className="uk-empty__title">{title}</div>
        {hint != null && hint !== '' && <div className="uk-empty__hint">{hint}</div>}
        {action && <div className="uk-empty__action">{action}</div>}
      </div>
    )
  }
  return (
    <div className={cx('uk-empty', className)} style={style} role="status">
      <span className="uk-empty__icon" aria-hidden="true">{renderIcon(icon ?? 'inbox', 24)}</span>
      <div className="uk-empty__title">{title}</div>
      {hint != null && hint !== '' && <div className="uk-empty__hint">{hint}</div>}
      {action && <div className="uk-empty__action">{action}</div>}
    </div>
  )
}

/** The message to show for a failed load: the server's own message when there is one. */
export function errorText(error: unknown, fallback = 'Something went wrong while loading this. Check your connection and try again.'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    const m = (error as { message: string }).message
    if (m.trim()) return m
  }
  return fallback
}

export interface ErrorStateProps {
  /** Default "Couldn’t load this". */
  title?: ReactNode
  /** The error (its message is shown) or your own sentence. */
  error?: unknown
  message?: ReactNode
  /** Shows the "Try again" button (the label existing tests look for). */
  onRetry?: () => void
  retryLabel?: string
  /** Hide the Retry button while a retry is in flight. */
  retrying?: boolean
  minHeight?: number
  className?: string
}

/** A failed load: red badge, what failed and why, and Retry. */
export function ErrorState({ title = 'Couldn’t load this', error, message, onRetry, retryLabel = 'Try again', retrying, minHeight, className }: ErrorStateProps) {
  const text = message ?? errorText(error)
  return (
    <div className={cx('uk-empty', 'uk-empty--error', className)} style={minHeight ? { minHeight } : undefined} role="alert">
      <span className="uk-empty__icon" aria-hidden="true">{renderIcon('alertTriangle', 22)}</span>
      <div className="uk-empty__title">{title}</div>
      {text && <div className="uk-empty__hint">{text}</div>}
      {onRetry && (
        <div className="uk-empty__action">
          <button type="button" className="uk-retry" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
            {retrying ? 'Retrying…' : retryLabel}
          </button>
        </div>
      )}
    </div>
  )
}
