import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Check, Loader2, Lock, Plus, Sparkles, ShieldAlert, Globe, Mail,
  Users, MapPin, Banknote, BarChart2, Package, Target, ShoppingCart,
  TrendingUp, Kanban, Settings, Monitor, PieChart, type LucideIcon,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { modules } from '../data/modules'
import { API_BASE_URL } from '../lib/api'

// Canonical 12 module keys. hrms + attendance are BUILT (live now); the rest are coming soon.
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

  // Keys already active in the workspace (locked / "Included").
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [statusLoading, setStatusLoading] = useState(true)
  // Keys the admin has picked to ADD in this session.
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set())

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const activeSet = useMemo(() => new Set(activeKeys), [activeKeys])

  // Best-effort fetch of current workspace modules.
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
        // Fail open: if we can't read status, show all 12 as selectable.
        if (!cancelled) setActiveKeys([])
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ws])

  // Pre-check the requested module from ?add= once we know what's already active.
  useEffect(() => {
    if (statusLoading) return
    const normalized = addKeyParam === 'hr' ? 'hrms' : addKeyParam
    if (!normalized) return
    const isValid = modules.some((m) => m.id === normalized)
    if (isValid && !activeSet.has(normalized)) {
      setSelectedToAdd((prev) => {
        if (prev.has(normalized)) return prev
        const next = new Set(prev)
        next.add(normalized)
        return next
      })
    }
  }, [statusLoading, addKeyParam, activeSet])

  const toggleAdd = (key: string) => {
    if (activeSet.has(key)) return // Included modules are locked — adding only.
    setSelectedToAdd((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const addCount = selectedToAdd.size

  const handleSubmit = async () => {
    if (addCount === 0 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/v1/public/module-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: ws,
          adminEmail: email,
          modules: Array.from(selectedToAdd),
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = `Failed to send request (${res.status})`
        try {
          const j = text ? JSON.parse(text) : null
          msg = j?.message || j?.error || msg
        } catch {
          if (text) msg = text
        }
        throw new Error(msg)
      }
      setSubmitted(true)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

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
            Add Modules to <span className="gradient-text">Your Workspace</span>
          </h1>
          <p className="text-text-secondary font-body font-medium text-base max-w-xl mx-auto">
            Pick the modules you'd like to enable. We'll switch them on for your workspace shortly.
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

          {submitted ? (
            /* Success state */
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-surface rounded-3xl border border-border shadow-xl p-10 sm:p-14 text-center relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />
              <div className="w-16 h-16 rounded-2xl bg-success/10 text-success flex items-center justify-center mx-auto mb-6">
                <Check size={32} strokeWidth={3} />
              </div>
              <h2 className="font-heading font-extrabold text-2xl text-text-primary mb-3">
                Request sent — we'll enable these shortly.
              </h2>
              <p className="text-text-secondary font-body text-sm max-w-md mx-auto mb-7">
                We received your request to add{' '}
                <strong className="text-text-primary">{addCount}</strong>{' '}
                {addCount === 1 ? 'module' : 'modules'} to{' '}
                <strong className="text-text-primary">{ws}.unifiedtree.com</strong>. You'll be notified once they're live.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {Array.from(selectedToAdd).map((key) => {
                  const mod = modules.find((m) => m.id === key)
                  return (
                    <span
                      key={key}
                      className="px-3.5 py-1.5 rounded-full bg-primary-light text-primary text-xs font-body font-bold"
                    >
                      {mod?.name || key}
                    </span>
                  )
                })}
              </div>
            </motion.div>
          ) : (
            /* Module selection */
            <div className="bg-surface rounded-3xl border border-border shadow-xl p-6 sm:p-9 relative">
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />

              {error && (
                <div className="bg-danger/5 border border-danger/20 text-danger p-4 rounded-xl mb-6 text-sm font-body font-semibold flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-danger" />
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading font-bold text-xl text-text-primary">Choose modules to add</h2>
                {statusLoading && (
                  <span className="text-xs text-text-secondary font-body flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" /> Checking active modules…
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {modules.map((mod) => {
                  const Icon = ICON_MAP[mod.icon] || Package
                  const isIncluded = activeSet.has(mod.id)
                  const isSelected = selectedToAdd.has(mod.id)
                  const isBuilt = BUILT_MODULES.has(mod.id)

                  return (
                    <button
                      type="button"
                      key={mod.id}
                      onClick={() => toggleAdd(mod.id)}
                      disabled={isIncluded}
                      aria-pressed={isSelected}
                      className={`relative flex items-start gap-3.5 p-4 rounded-2xl border-2 text-left transition-all duration-200 ${
                        isIncluded
                          ? 'border-success/30 bg-success/5 cursor-default'
                          : isSelected
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border hover:border-primary/40 hover:bg-bg/60'
                      }`}
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: isIncluded ? '#DCFCE7' : `${mod.color}14`,
                          color: isIncluded ? '#16A34A' : mod.color,
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
                        {isIncluded && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-body font-bold text-success mt-1.5">
                            <Check size={11} strokeWidth={3} /> Included
                          </span>
                        )}
                      </div>

                      {/* Selection indicator */}
                      <div
                        className={`absolute top-4 right-4 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                          isIncluded
                            ? 'bg-success border-success text-white'
                            : isSelected
                              ? 'bg-primary border-primary text-white'
                              : 'border-slate-300 text-transparent'
                        }`}
                      >
                        {isIncluded ? (
                          <Lock size={11} strokeWidth={3} />
                        ) : isSelected ? (
                          <Check size={12} strokeWidth={3} />
                        ) : (
                          <Plus size={12} strokeWidth={3} className="text-slate-300" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Cannot-remove note */}
              <div className="mt-6 flex items-start gap-2.5 bg-bg border border-border rounded-xl p-3.5">
                <ShieldAlert size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#94A3B8' }} />
                <p className="text-xs text-text-secondary font-body leading-relaxed">
                  Removing modules isn't available here — contact support if you need to disable a module.
                  Included modules are locked and can only be added to.
                </p>
              </div>

              {/* Submit */}
              <div className="mt-7 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-border">
                <span className="text-sm font-body font-semibold text-text-secondary">
                  {addCount === 0
                    ? 'Select at least one module to add'
                    : `${addCount} new ${addCount === 1 ? 'module' : 'modules'} selected`}
                </span>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={addCount === 0 || submitting}
                  className="px-10 py-3.5 bg-primary text-white text-base font-body font-bold rounded-xl hover:bg-primary-dark transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 min-w-[220px] shadow-teal hover:shadow-teal-lg active:scale-[0.99] transform btn-shimmer"
                >
                  {submitting ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      <Sparkles size={18} /> Request these modules
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      <Footer />
    </div>
  )
}
