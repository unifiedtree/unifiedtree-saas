import React, { useCallback, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '@/design/kit/Dialog'
import { PanelButton } from '@/design/kit/PanelButton'

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

  // The design's dialog (kit Dialog): the confirm button takes focus so Enter confirms;
  // Escape and the backdrop cancel; Tab stays inside; focus goes back to the trigger.
  return (
    <ConfirmContext.Provider value={request}>
      {children}
      {pending && (
        <Dialog
          open
          onClose={() => close(false)}
          title={pending.title}
          titleId="confirm-dialog-title"
          sub={pending.body || undefined}
          icon={pending.tone === 'danger' ? <AlertTriangle size={18} /> : undefined}
          tone="danger"
          width={384}
          hideClose
          initialFocus={confirmBtnRef}
          zIndex={9999}
          footer={(
            <>
              <PanelButton onClick={() => close(false)}>{pending.cancelLabel ?? 'Cancel'}</PanelButton>
              <PanelButton ref={confirmBtnRef} variant={pending.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
                {pending.confirmLabel ?? 'Confirm'}
              </PanelButton>
            </>
          )}
        />
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
