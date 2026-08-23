import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * A promise-based confirmation modal shared by every destructive action in the
 * platform. Replaces `window.confirm(...)` — the native dialog is unstyled,
 * screen-reader-hostile on some browsers, and (worse) some browsers now suppress
 * repeated prompts so a "delete" click silently no-ops.
 *
 * Usage:
 *   const confirm = useConfirmDialog()
 *   const handleDelete = async () => {
 *     if (!(await confirm({ title: 'Delete template?', body: '...', tone: 'danger' }))) return
 *     ...
 *   }
 *
 * The provider wraps the app root; `useConfirmDialog` returns an imperative
 * `(opts) => Promise<boolean>` — resolves `true` on confirm, `false` on cancel
 * or escape. One dialog is rendered at a time.
 */

export type ConfirmOptions = {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
}

type PendingRequest = ConfirmOptions & { resolve: (v: boolean) => void }

const ConfirmContext = React.createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const request = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = useCallback((result: boolean) => {
    setPending((p) => {
      if (p) p.resolve(result)
      return null
    })
  }, [])

  // Autofocus the confirm button so Enter confirms and Escape cancels.
  useEffect(() => {
    if (pending) {
      const id = requestAnimationFrame(() => confirmBtnRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  return (
    <ConfirmContext.Provider value={request}>
      {children}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => close(false)}
            aria-hidden
          />
          <div className="ut-card ut-card-lg relative w-full max-w-sm p-5">
            <div className="flex items-start gap-3">
              {pending.tone === 'danger' && (
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]">
                  <AlertTriangle size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 id="confirm-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
                  {pending.title}
                </h3>
                {pending.body && (
                  <div className="mt-1.5 text-sm text-[var(--text-secondary)]">
                    {pending.body}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => close(true)}
                className={
                  pending.tone === 'danger'
                    ? 'rounded-lg bg-[#DC2626] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B91C1C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C] focus-visible:ring-offset-2'
                    : 'rounded-lg bg-[#059669] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#047857] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2'
                }
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirmDialog() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    // Fallback so callers work without the provider mounted (e.g. isolated
    // tests). Native window.confirm is synchronous — wrap in a resolved
    // promise so the API stays the same.
    return (opts: ConfirmOptions) => Promise.resolve(
      typeof window !== 'undefined'
        ? window.confirm(`${opts.title}${opts.body ? `\n\n${typeof opts.body === 'string' ? opts.body : ''}` : ''}`)
        : true
    )
  }
  return ctx
}
