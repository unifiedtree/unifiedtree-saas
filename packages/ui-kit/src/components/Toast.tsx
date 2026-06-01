import React, { createContext, useContext, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'

type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ToastItem extends ToastOptions {
  id: string
  variant: ToastVariant
  message: string
  removing?: boolean
}

const MAX_VISIBLE = 5

const icons: Record<ToastVariant, React.FC<{ size?: number }>> = {
  success: ({ size = 18 }) => <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />,
  error: ({ size = 18 }) => <AlertCircle size={size} className="text-red-400 shrink-0" />,
  info: ({ size = 18 }) => <Info size={size} className="text-blue-400 shrink-0" />,
  warning: ({ size = 18 }) => <AlertTriangle size={size} className="text-amber-400 shrink-0" />,
}

const variantBorders: Record<ToastVariant, string> = {
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  info: 'border-l-blue-500',
  warning: 'border-l-amber-500',
}

interface ToastContextValue {
  toasts: ToastItem[]
  addToast: (variant: ToastVariant, message: string, options?: ToastOptions) => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let idCounter = 0
const generateId = () => `toast-${++idCounter}`

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, removing: true } : t))
    )
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 300)
  }, [])

  const dismissAll = useCallback(() => {
    setToasts((prev) => prev.map((t) => ({ ...t, removing: true })))
    setTimeout(() => setToasts([]), 350)
  }, [])

  const addToast = useCallback(
    (variant: ToastVariant, message: string, options?: ToastOptions) => {
      const id = generateId()
      const duration = options?.duration ?? 4000
      const toast: ToastItem = { id, variant, message, ...options }

      setToasts((prev) => {
        const visible = prev.slice(-(MAX_VISIBLE - 1))
        return [...visible, toast]
      })

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration)
      }
    },
    [dismiss]
  )

  const contextValue: ToastContextValue = { toasts, addToast, dismiss, dismissAll }

  const portal =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
            role="region"
            aria-label="Notifications"
          >
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {portal}
    </ToastContext.Provider>
  )
}

const ToastItem: React.FC<{ toast: ToastItem; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const Icon = icons[toast.variant]

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 min-w-[300px] max-w-[420px]',
        'rounded-xl border-l-4 border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/50',
        'px-4 py-3.5 transition-all duration-300',
        variantBorders[toast.variant],
        toast.removing
          ? 'opacity-0 translate-x-4'
          : 'opacity-100 translate-x-0 animate-slide-in-right'
      )}
      role="alert"
    >
      <Icon />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 leading-relaxed">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick()
              onDismiss(toast.id)
            }}
            className="mt-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')

  return {
    toast: {
      success: (message: string, options?: ToastOptions) =>
        ctx.addToast('success', message, options),
      error: (message: string, options?: ToastOptions) =>
        ctx.addToast('error', message, options),
      info: (message: string, options?: ToastOptions) =>
        ctx.addToast('info', message, options),
      warning: (message: string, options?: ToastOptions) =>
        ctx.addToast('warning', message, options),
    },
    dismiss: ctx.dismiss,
    dismissAll: ctx.dismissAll,
  }
}
