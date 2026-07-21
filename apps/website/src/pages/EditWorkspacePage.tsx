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
    <div className="flex min-h-screen flex-col bg-bg font-body">
      <Navbar />

      <main className="flex-1 px-4 pb-20 pt-28 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {/* Compact header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-8">
            <span className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">Manage your workspace</span>
            <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-text-primary sm:text-[38px]">Manage your modules</h1>
            <p className="mt-1.5 text-text-secondary">Switch modules on or off — changes apply instantly, no refresh needed.</p>
          </motion.div>

          {!ws && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4 text-sm font-semibold text-warning">
              <AlertTriangle size={16} className="shrink-0" />
              We couldn't tell which workspace to manage. Open this page from your workspace's “Manage modules” link.
            </div>
          )}
          {error && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm font-semibold text-danger">
              <span className="h-2 w-2 rounded-full bg-danger" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
            {/* LEFT: module grid */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-md font-semibold text-text-primary">Your modules</h2>
                {statusLoading ? (
                  <span className="flex items-center gap-1.5 text-xs text-text-secondary"><Loader2 size={13} className="animate-spin" /> Loading…</span>
                ) : saving ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Loader2 size={13} className="animate-spin" /> Saving…</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-text-secondary"><Check size={13} className="text-success" strokeWidth={3} /> Saved automatically</span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      className={`relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all duration-200 ${
                        isActive ? 'border-primary/40 bg-primary-light shadow-sm' : 'border-border bg-surface hover:border-primary/30 hover:shadow-card'
                      } ${isPending ? 'cursor-wait opacity-70' : !ws ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: isActive ? '#DCFCE7' : `${mod.color}14`, color: isActive ? '#3A7D22' : mod.color }}>
                        <Icon size={18} />
                      </div>

                      <div className="min-w-0 flex-1 pr-6">
                        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-text-primary">{mod.name}</h3>
                          {isBuilt ? (
                            <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">Live</span>
                          ) : (
                            <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">Soon</span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-xs leading-snug text-text-secondary">{mod.description}</p>
                        <span className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold ${isActive ? 'text-success' : 'text-text-tertiary'}`}>
                          {isActive ? <><Check size={11} strokeWidth={3} /> Active · tap to remove</> : <><Plus size={11} strokeWidth={3} /> Tap to add</>}
                        </span>
                      </div>

                      <div className={`absolute right-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                        isActive ? 'border-success bg-success text-white' : 'border-border bg-surface text-text-tertiary'
                      }`}>
                        {isPending ? <Loader2 size={12} className="animate-spin" /> : isActive ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* RIGHT: sticky workspace panel */}
            <aside className="lg:sticky lg:top-24">
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                <div className="bg-primary px-5 py-4 text-white">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-100/80"><Globe size={12} /> Your workspace</p>
                  <p className="mt-1 truncate font-bold text-lime">{ws || 'unknown'}<span className="font-normal text-emerald-100/70">.unifiedtree.com</span></p>
                </div>
                <div className="space-y-4 p-5">
                  {email && (
                    <div>
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"><Mail size={12} /> Admin</p>
                      <p className="mt-0.5 break-all text-sm font-medium text-text-primary">{email}</p>
                    </div>
                  )}

                  <div className="rounded-xl bg-bg p-3.5">
                    <div className="flex items-end justify-between">
                      <span className="text-xs text-text-secondary">Active modules</span>
                      <span className="text-lg font-bold text-text-primary">{statusLoading ? '—' : activeCount}<span className="text-xs font-normal text-text-secondary"> / {modules.length}</span></span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${statusLoading ? 0 : (activeCount / modules.length) * 100}%` }} />
                    </div>
                    <div className="mt-2.5 text-xs font-semibold">
                      {saving ? (
                        <span className="flex items-center gap-1.5 text-primary"><Loader2 size={13} className="animate-spin" /> Saving changes…</span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-success"><Check size={13} strokeWidth={3} /> Up to date</span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-text-tertiary">
                    Tap any module to switch it on or off. Changes apply to your workspace instantly — add or remove as often as you like, no refresh needed.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
