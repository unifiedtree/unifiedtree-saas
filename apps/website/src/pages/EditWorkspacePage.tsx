import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Check, Loader2, Plus, Globe, Mail,
  Users, MapPin, Banknote, BarChart2, Package, Target, ShoppingCart,
  TrendingUp, Kanban, Settings, Monitor, PieChart, AlertTriangle, type LucideIcon,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { modules } from '../data/modules'
import { API_BASE_URL } from '../lib/api'

// hrms + attendance are BUILT (live now); the rest are coming soon.
const BUILT_MODULES = new Set(['hrms', 'attendance'])

// Map the lucide icon name stored in modules.ts to an actual component.
const ICON_MAP: Record<string, LucideIcon> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

type WorkspaceStatus = {
  // Best-effort: backend may return modules under a few different shapes.
  modules?: string[]
  activeModules?: string[]
  enabledModules?: Array<string | { key?: string; moduleKey?: string }>
}

/** Pull a flat list of active module keys out of whatever shape the status endpoint returns. */
function extractActiveKeys(data: WorkspaceStatus | null): string[] {
  if (!data) return []
  const raw =
    data.activeModules ??
    data.modules ??
    data.enabledModules ??
    []
  return raw
    .map((m) => (typeof m === 'string' ? m : m?.key || m?.moduleKey || ''))
    .map((k) => (k === 'hr' ? 'hrms' : k))
    .filter(Boolean) as string[]
}

export function EditWorkspacePage() {
  const [searchParams] = useSearchParams()
  const ws = (searchParams.get('ws') || '').trim().toLowerCase()
  const email = (searchParams.get('email') || '').trim()
  const addKeyParam = (searchParams.get('add') || '').trim().toLowerCase()

  // Keys currently active in the workspace (the source of truth, kept in sync
  // with the backend after every toggle).
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [statusLoading, setStatusLoading] = useState(true)
  // Keys with a toggle request in flight — used to disable + spin that one card.
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const activeSet = useMemo(() => new Set(activeKeys), [activeKeys])
  // Guards the ?add= deep-link so it auto-activates the module at most once.
  const autoAddDone = useRef(false)

  // Fetch the workspace's currently active modules on page load.
  useEffect(() => {
    let cancelled = false
    if (!ws) {
      setStatusLoading(false)
      return
    }
    setStatusLoading(true)
    fetch(`${API_BASE_URL}/v1/public/workspace-status?subdomain=${encodeURIComponent(ws)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: WorkspaceStatus) => {
        if (cancelled) return
        setActiveKeys(extractActiveKeys(data))
      })
      .catch(() => {
        // Fail open: if we can't read status, show everything as inactive.
        if (!cancelled) setActiveKeys([])
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ws])

  // Activate or deactivate a single module against the backend. Updates the UI
  // optimistically, then reconciles with the authoritative response so the user
  // can re-add / re-remove freely without refreshing.
  const toggleModule = async (key: string) => {
    if (!ws || pending.has(key)) return
    const nextActive = !activeSet.has(key)

    setError('')
    setPending((prev) => new Set(prev).add(key))
    // Optimistic update.
    setActiveKeys((prev) =>
      nextActive ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key),
    )

    try {
      const res = await fetch(`${API_BASE_URL}/v1/public/module-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: ws, module: key, active: nextActive }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = `Couldn't ${nextActive ? 'add' : 'remove'} this module (${res.status})`
        try {
          const j = text ? JSON.parse(text) : null
          msg = j?.message || j?.error || msg
        } catch {
          if (text) msg = text
        }
        throw new Error(msg)
      }
      // Reconcile with the server's authoritative active list.
      const data: WorkspaceStatus = await res.json()
      setActiveKeys(extractActiveKeys(data))
    } catch (err: any) {
      // Roll the optimistic change back.
      setActiveKeys((prev) =>
        nextActive ? prev.filter((k) => k !== key) : (prev.includes(key) ? prev : [...prev, key]),
      )
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  // Honor the ?add=<key> deep link from the platform console: if the requested
  // module is valid and not already active, switch it on once after load.
  useEffect(() => {
    if (statusLoading || autoAddDone.current) return
    const normalized = addKeyParam === 'hr' ? 'hrms' : addKeyParam
    if (!normalized) return
    const isValid = modules.some((m) => m.id === normalized)
    if (isValid && !activeSet.has(normalized)) {
      autoAddDone.current = true
      void toggleModule(normalized)
    }
    // toggleModule intentionally omitted: it closes over the latest state and
    // this effect is guarded by autoAddDone so it runs at most once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusLoading, addKeyParam, activeSet])

  const activeCount = modules.filter((m) => activeSet.has(m.id)).length
  const saving = pending.size > 0

  return (
    <div className="min-h-screen bg-bg flex flex-col font-body relative">
      <Navbar />

      <div className="flex-1 flex flex-col items-center pt-32 pb-24 px-4 sm:px-6 relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute -top-48 -left-48 w-96 h-96 bg-primary-light rounded-full blur-[140px] opacity-60 pointer-events-none" />
        <div className="absolute top-1/2 -right-48 w-96 h-96 bg-accent/10 rounded-full blur-[140px] opacity-40 pointer-events-none" />
        <div className="absolute inset-0 opacity-[0.03] pattern-dots pointer-events-none" />

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center relative z-10"
        >
          <div className="section-badge mb-5 inline-flex">Manage your workspace</div>
          <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-text-primary tracking-tight mb-3">
            Manage <span className="gradient-text">Your Modules</span>
          </h1>
          <p className="text-text-secondary font-body font-medium text-base max-w-xl mx-auto">
            Switch modules on or off for your workspace. Changes apply instantly — no refresh needed.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-4xl space-y-6 relative z-10"
        >
          {/* Workspace identity card (read-only) */}
          <div className="bg-white/80 backdrop-blur-md border border-border shadow-md rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex flex-col text-left gap-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Globe size={13} /> Your Workspace
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-text-primary font-heading font-extrabold text-lg select-all bg-primary/10 px-2.5 py-0.5 rounded-lg">
                  {ws || 'unknown'}
                </span>
                <span className="text-text-secondary font-body font-semibold text-base">.unifiedtree.com</span>
              </div>
            </div>
            {email && (
              <div className="flex flex-col text-left sm:text-right gap-1">
                <span className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5 sm:justify-end">
                  <Mail size={13} /> Admin
                </span>
                <span className="text-text-primary font-body font-semibold text-sm break-all">{email}</span>
              </div>
            )}
          </div>

          {/* Module management */}
          <div className="bg-surface rounded-3xl border border-border shadow-xl p-6 sm:p-9 relative">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />

            {!ws && (
              <div className="bg-warning/5 border border-warning/20 text-warning p-4 rounded-xl mb-6 text-sm font-body font-semibold flex items-center gap-3">
                <AlertTriangle size={16} className="flex-shrink-0" />
                We couldn't tell which workspace to manage. Open this page from your workspace's
                “Manage modules” link to switch modules on or off.
              </div>
            )}

            {error && (
              <div className="bg-danger/5 border border-danger/20 text-danger p-4 rounded-xl mb-6 text-sm font-body font-semibold flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-danger" />
                {error}
              </div>
            )}

            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading font-bold text-xl text-text-primary">Your modules</h2>
              {statusLoading ? (
                <span className="text-xs text-text-secondary font-body flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Loading your modules…
                </span>
              ) : saving ? (
                <span className="text-xs text-primary font-body font-semibold flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </span>
              ) : (
                <span className="text-xs text-text-secondary font-body flex items-center gap-1.5">
                  <Check size={13} className="text-success" strokeWidth={3} /> Changes save automatically
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modules.map((mod) => {
                const Icon = ICON_MAP[mod.icon] || Package
                const isActive = activeSet.has(mod.id)
                const isPending = pending.has(mod.id)
                const isBuilt = BUILT_MODULES.has(mod.id)

                return (
                  <button
                    type="button"
                    key={mod.id}
                    onClick={() => toggleModule(mod.id)}
                    disabled={isPending || !ws}
                    aria-pressed={isActive}
                    title={isActive ? 'Click to remove this module' : 'Click to add this module'}
                    className={`relative flex items-start gap-3.5 p-4 rounded-2xl border-2 text-left transition-all duration-200 ${
                      isActive
                        ? 'border-success bg-success/5 shadow-sm'
                        : 'border-border hover:border-primary/40 hover:bg-bg/60'
                    } ${
                      isPending
                        ? 'opacity-70 cursor-wait'
                        : !ws
                          ? 'opacity-60 cursor-not-allowed'
                          : 'cursor-pointer'
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: isActive ? '#DCFCE7' : `${mod.color}14`,
                        color: isActive ? '#16A34A' : mod.color,
                      }}
                    >
                      <Icon size={18} />
                    </div>

                    <div className="flex-1 min-w-0 pr-7">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-heading font-bold text-sm text-text-primary truncate">{mod.name}</h3>
                        {isBuilt ? (
                          <span className="text-[10px] font-body font-bold px-1.5 py-0.5 rounded bg-success/10 text-success uppercase tracking-wide">
                            Live now
                          </span>
                        ) : (
                          <span className="text-[10px] font-body font-bold px-1.5 py-0.5 rounded bg-warning/10 text-warning uppercase tracking-wide">
                            Coming soon
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs text-text-secondary leading-snug overflow-hidden"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      >
                        {mod.description}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-body font-bold mt-1.5 ${
                          isActive ? 'text-success' : 'text-text-tertiary'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <Check size={11} strokeWidth={3} /> Active · tap to remove
                          </>
                        ) : (
                          <>
                            <Plus size={11} strokeWidth={3} /> Tap to add
                          </>
                        )}
                      </span>
                    </div>

                    {/* Toggle indicator */}
                    <div
                      className={`absolute top-4 right-4 w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
                        isActive
                          ? 'bg-success border-success text-white'
                          : 'border-slate-300 bg-white text-slate-400'
                      }`}
                    >
                      {isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : isActive ? (
                        <Check size={13} strokeWidth={3} />
                      ) : (
                        <Plus size={13} strokeWidth={3} />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* How-it-works note */}
            <div className="mt-6 flex items-start gap-2.5 bg-bg border border-border rounded-xl p-3.5">
              <Check size={16} className="flex-shrink-0 mt-0.5 text-success" strokeWidth={3} />
              <p className="text-xs text-text-secondary font-body leading-relaxed">
                Tap any module to switch it on or off. Active modules show a green check and a highlighted
                border — changes apply to your workspace instantly, so you can add or remove modules as
                many times as you like without refreshing.
              </p>
            </div>

            {/* Status summary */}
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-border">
              <span className="text-sm font-body font-semibold text-text-secondary">
                {statusLoading
                  ? 'Checking your modules…'
                  : `${activeCount} of ${modules.length} ${activeCount === 1 ? 'module' : 'modules'} active`}
              </span>
              <span className="text-sm font-body font-semibold flex items-center gap-2">
                {saving ? (
                  <span className="text-primary flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Saving changes…
                  </span>
                ) : (
                  <span className="text-success flex items-center gap-2">
                    <Check size={16} strokeWidth={3} /> Up to date
                  </span>
                )}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      <Footer />
    </div>
  )
}
