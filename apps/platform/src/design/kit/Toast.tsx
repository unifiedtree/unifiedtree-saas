// The design's toast (HrmsPlatform): bottom centre, dark, a check icon, gone after 2.6s.
// Errors stay longer (7s) and use role="alert"; success/info use role="status".
// An `undo` toast shows "Undo" with a seconds countdown and a draining bar; `onExpire` fires
// only when the time runs out (not on Undo or dismiss), so a caller can commit then.
// Other toasts pause while the pointer or keyboard focus is on them; an undo countdown never
// pauses, because it stands for a real deadline.
//
//   <ToastProvider> once near the app root renders the stack; useToast() anywhere pushes to it:
//     const toast = useToast()
//     toast.success('Approved · Priya has been told', { undo: { onUndo: revert } })
//   Without a provider the first toast mounts a stack of its own, so a toast is never lost.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { CircleCheckBig, Info, TriangleAlert, X } from 'lucide-react'
import './overlays.css'

export type ToastTone = 'success' | 'error' | 'info'
export type ToastCloseReason = 'timeout' | 'dismiss' | 'undo' | 'action'

/** Default lifetimes (ms). */
export const TOAST_MS = { success: 2600, info: 2600, error: 7000, undo: 5000 } as const

export interface ToastUndo {
  onUndo: () => void
  /** Seconds the Undo stays offered (default 5). */
  seconds?: number
  label?: string
}

export interface ToastProps {
  tone?: ToastTone
  message: ReactNode
  /** Second, quieter line. */
  detail?: ReactNode
  /** Lifetime in ms; 0 keeps it until dismissed. Default 2600 (errors 7000; undo: its seconds). */
  duration?: number
  undo?: ToastUndo
  /** Another action button (e.g. "View"). */
  action?: { label: string; onClick: () => void }
  /** Show the small dismiss button (default true). */
  dismissible?: boolean
  /** Called once when the toast should go away, with the reason. */
  onDone?: (reason: ToastCloseReason) => void
}

const ICON = { success: CircleCheckBig, error: TriangleAlert, info: Info }

/** One toast (no positioning; the stack or useDesignToast places it). */
export function Toast({ tone = 'success', message, detail, duration, undo, action, dismissible = true, onDone }: ToastProps) {
  const total = undo ? Math.max(1, undo.seconds ?? TOAST_MS.undo / 1000) * 1000 : duration ?? TOAST_MS[tone]
  const left = useRef(total)
  const [secs, setSecs] = useState(Math.ceil(total / 1000))
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const paused = !undo && (hover || focus)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const finished = useRef(false)
  const finish = (reason: ToastCloseReason) => {
    if (finished.current) return
    finished.current = true
    doneRef.current?.(reason)
  }

  useEffect(() => {
    if (!total || paused || finished.current) return
    const started = Date.now()
    const from = left.current
    const t = setTimeout(() => { left.current = 0; finish('timeout') }, from)
    const tick = undo ? setInterval(() => setSecs(Math.max(1, Math.ceil((from - (Date.now() - started)) / 1000))), 200) : undefined
    return () => {
      clearTimeout(t)
      if (tick) clearInterval(tick)
      left.current = Math.max(0, from - (Date.now() - started))
    }
  }, [paused, total]) // eslint-disable-line react-hooks/exhaustive-deps

  const Icon = ICON[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="uko-toast"
      data-tone={tone}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false) }}
    >
      <Icon className="uko-toast-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
      <span className="uko-toast-text">
        <span className="uko-toast-msg">{message}</span>
        {detail && <span className="uko-toast-detail">{detail}</span>}
      </span>
      {undo && (
        <button type="button" className="uko-toast-act" onClick={() => { undo.onUndo(); finish('undo') }}>
          {undo.label ?? 'Undo'}
          <span className="uko-toast-count" aria-label={`${secs} seconds left`}>{secs}s</span>
        </button>
      )}
      {action && (
        <button type="button" className="uko-toast-act" onClick={() => { action.onClick(); finish('action') }}>{action.label}</button>
      )}
      {dismissible && (
        <button type="button" className="uko-toast-x" aria-label="Dismiss" onClick={() => finish('dismiss')}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
      {undo && <span className="uko-toast-bar" style={{ animationDuration: `${total}ms` }} aria-hidden="true" />}
    </div>
  )
}

/**
 * One toast pinned bottom centre (portalled to <body>). What the page-level toast hooks
 * (useDesignToast, useReportToast, the settings page toast) render; give it a new `key`
 * per message so its timer restarts.
 */
export function ToastSlot({ bottom = 24, ...toast }: ToastProps & { bottom?: number }) {
  if (typeof document === 'undefined') return null
  return createPortal(<div className="uko-toasts" style={{ bottom }}><Toast {...toast} /></div>, document.body)
}

// ── Stack + useToast ─────────────────────────────────────────────────────────
export interface ToastOptions extends Omit<ToastProps, 'message' | 'onDone' | 'tone'> {
  /** Replaces a toast with the same id instead of adding another. */
  id?: string
  /** Called when the toast times out (not when undone or dismissed). */
  onExpire?: () => void
}
export interface ToastApi {
  show: (message: ReactNode, options?: ToastOptions & { tone?: ToastTone }) => string
  success: (message: ReactNode, options?: ToastOptions) => string
  error: (message: ReactNode, options?: ToastOptions) => string
  info: (message: ReactNode, options?: ToastOptions) => string
  /** Removes one toast, or all of them. */
  dismiss: (id?: string) => void
}

interface Entry extends ToastOptions { id: string; key: number; tone: ToastTone; message: ReactNode }
const MAX_VISIBLE = 3
// `hosts`: ids of mounted ToastProviders; only the first one draws the stack.
const store = { list: [] as Entry[], hosts: [] as number[], listeners: new Set<() => void>() }
let nextKey = 0
let nextHost = 0
const emit = () => store.listeners.forEach((l) => l())
const subscribe = (l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l) } }
const getList = () => store.list
const getHosts = () => store.hosts

function remove(id: string) {
  const next = store.list.filter((t) => t.id !== id)
  if (next.length !== store.list.length) { store.list = next; emit() }
}

let fallbackMounted = false
function ensureHost() {
  if (fallbackMounted || typeof document === 'undefined') return
  fallbackMounted = true
  const el = document.createElement('div')
  el.setAttribute('data-uko-toast-host', '')
  document.body.appendChild(el)
  createRoot(el).render(<ToastStack fallback />)
}

const api: ToastApi = {
  show(message, options = {}) {
    const { tone = 'success', ...rest } = options
    const key = ++nextKey
    const id = rest.id ?? `toast-${key}`
    store.list = [...store.list.filter((t) => t.id !== id), { ...rest, id, key, tone, message }].slice(-MAX_VISIBLE)
    emit()
    if (!store.hosts.length) ensureHost()
    return id
  },
  success: (m, o) => api.show(m, { ...o, tone: 'success' }),
  error: (m, o) => api.show(m, { ...o, tone: 'error' }),
  info: (m, o) => api.show(m, { ...o, tone: 'info' }),
  dismiss(id) {
    if (id) remove(id)
    else if (store.list.length) { store.list = []; emit() }
  },
}

/** Push toasts from anywhere: toast.success(msg, { detail, undo, onExpire, duration }). */
export function useToast(): ToastApi {
  return api
}

function ToastStack({ fallback = false, host = 0 }: { fallback?: boolean; host?: number }) {
  const list = useSyncExternalStore(subscribe, getList, getList)
  const hosts = useSyncExternalStore(subscribe, getHosts, getHosts)
  if (fallback ? hosts.length > 0 : hosts[0] !== host) return null
  if (!list.length || typeof document === 'undefined') return null
  return createPortal(
    <div className="uko-toasts">
      {list.map(({ id, key, onExpire, ...t }) => (
        <Toast
          key={key}
          {...t}
          onDone={(reason) => { remove(id); if (reason === 'timeout') onExpire?.() }}
        />
      ))}
    </div>,
    document.body,
  )
}

/** Renders the toast stack (bottom centre). Mount once, near the app root. */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [host] = useState(() => ++nextHost)
  useEffect(() => {
    store.hosts = [...store.hosts, host]
    emit()
    return () => { store.hosts = store.hosts.filter((h) => h !== host); emit() }
  }, [host])
  return (
    <>
      {children}
      <ToastStack host={host} />
    </>
  )
}
