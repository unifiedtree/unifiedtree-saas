import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Minus, Plus, ShieldCheck, Sparkles, Users,
  AlertCircle, Lock,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { useModulePlans, iconMap, effectiveUnit, type ModulePlan } from '@/core/api/modulePlans'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'

/**
 * IN-WORKSPACE plan configurator + autopay setup.
 *
 * Client requirement (2026-08-07):
 *   - The marketing site's /signup?mode=trial creates a FREE workspace with
 *     every module locked. To unlock modules the admin comes HERE (inside the
 *     workspace) and picks per-module seat counts.
 *   - Each module gets its own +/- stepper for seats (not one workspace-wide
 *     seat count).
 *   - The right-side summary sums (plan.priceInr × seats × cycle) and offers
 *     a single "Pay ₹0 & Set Up Autopay" button — same UX as the old trial
 *     signup on the marketing site.
 *   - After the admin authorises the mandate, the 7-day trial starts. First
 *     charge happens on day 8. Failed charges → 7-day grace → workspace goes
 *     read-only (grace-period enforcement already lives in the backend).
 */

type BillingCycle = 'monthly' | 'annual'

// STRICT admin-only for plan / billing changes. HR_MANAGER is intentionally
// excluded — Modules.tsx uses a wider set (adds HR_MANAGER) for tile-click
// entry into apps, which is a UX permission, not a billing one. Only the
// workspace owner + explicit admin roles can authorise a mandate that will
// charge the workspace's account. (Client clarification, 2026-08-07.)
const ADMIN_ROLES = ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN']
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30 * 60 * 1000  // 30 min

// -- API contracts ----------------------------------------------------------

interface SetupAutopayResponse {
  planChangeRequestId: string
  razorpaySubscriptionId: string
  checkoutShortUrl: string
  keyId: string
}

interface StatusResponse {
  status: 'AWAITING_MANDATE' | 'ACTIVATED' | 'FAILED' | 'CANCELLED' | 'EXPIRED'
  activatedModules?: string[]
  failureReason?: string
}

export const Plan: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const activeModules  = useLocalAuthStore(s => s.tenant?.activeModules ?? [])
  const tenantName     = useLocalAuthStore(s => s.tenant?.name ?? 'your workspace')
  const refreshTenant  = useLocalAuthStore(s => s.refreshTenant)
  // Roles + permissions come from the SDK auth store (same source Modules.tsx
  // reads). The LOCAL auth store's User type has a single `role` field that
  // is often empty for SUPER_ADMIN sessions — reading it caused a false
  // "Only admins can manage the plan" gate on 2026-08-07 for admins who
  // actually held the role in the SDK store.
  const sdkUser      = useSdkStore(s => s.user)
  const permissions  = useSdkStore(s => s.permissions)
  const roles: string[] = sdkUser?.roles ?? []
  const isAdmin      = roles.some(r => ADMIN_ROLES.includes(r)) || permissions.has('*')

  const { data: allPlans = [], isLoading } = useModulePlans()
  const plans = useMemo(
    () => allPlans.filter(p => p.status !== 'RETIRED'),
    [allPlans],
  )
  const available = useMemo(
    () => plans.filter(p => p.status === 'AVAILABLE'),
    [plans],
  )

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [seatsByPlan, setSeatsByPlan] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [awaitingMandate, setAwaitingMandate] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [checkoutTab, setCheckoutTab] = useState<Window | null>(null)

  // Pre-select the plan passed via ?add=<planKey> (from the tile grid's
  // "Add to plan" affordance on a locked tile). Default seat count = 1
  // so the admin only picks the size once, not per-plan on top of that.
  useEffect(() => {
    const add = searchParams.get('add')
    if (add && available.some(p => p.key === add) && !seatsByPlan[add]) {
      setSeatsByPlan(prev => ({ ...prev, [add]: 1 }))
    }
    // Also pre-tick every plan whose included_modules already include an
    // active module (so re-visits show the current state; seats default to
    // the current count when we wire it — for now default 1 since we don't
    // yet read per-module seat count from the tenant_modules row).
    for (const p of available) {
      const alreadyActive = p.includedModules.some(mk => activeModules.includes(mk))
      if (alreadyActive && !seatsByPlan[p.key]) {
        setSeatsByPlan(prev => ({ ...prev, [p.key]: 1 }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.length, searchParams])

  // -- derived pricing ------------------------------------------------------
  const selectedPlans: Array<{ plan: ModulePlan; seats: number }> = useMemo(() => {
    return available
      .map(p => ({ plan: p, seats: seatsByPlan[p.key] ?? 0 }))
      .filter(x => x.seats > 0)
  }, [available, seatsByPlan])

  const monthlyTotal = useMemo(() => {
    return selectedPlans.reduce((sum, { plan, seats }) => {
      return sum + effectiveUnit(plan, 'monthly') * seats
    }, 0)
  }, [selectedPlans])

  const annualTotal = useMemo(() => {
    return selectedPlans.reduce((sum, { plan, seats }) => {
      return sum + effectiveUnit(plan, 'annual') * seats * 12
    }, 0)
  }, [selectedPlans])

  const cycleTotal = billingCycle === 'annual' ? annualTotal : monthlyTotal

  // -- stepper helpers ------------------------------------------------------
  const inc = (key: string) => setSeatsByPlan(s => ({ ...s, [key]: Math.min(999, (s[key] ?? 0) + 1) }))
  const dec = (key: string) => setSeatsByPlan(s => ({ ...s, [key]: Math.max(0, (s[key] ?? 0) - 1) }))
  const setSeats = (key: string, n: number) => setSeatsByPlan(s => ({ ...s, [key]: Math.max(0, Math.min(999, Math.floor(n) || 0)) }))

  // -- submit ---------------------------------------------------------------
  const submit = async () => {
    setError('')
    if (selectedPlans.length === 0) {
      setError('Pick at least one module (set its seat count to 1 or more).')
      return
    }
    setLoading(true)
    try {
      const body = {
        items: selectedPlans.map(({ plan, seats }) => ({
          planKey: plan.key,
          seats,
        })),
        billingCycle,
      }
      const res = await apiJson<SetupAutopayResponse>(
        '/v1/workspace/plan/setup-autopay',
        { method: 'POST', body: JSON.stringify(body) },
      )
      const tab = window.open(res.checkoutShortUrl, '_blank', 'noopener,noreferrer')
      setCheckoutTab(tab)
      setPendingId(res.planChangeRequestId)
      setAwaitingMandate(true)
    } catch (err) {
      setError((err as Error).message || 'Could not set up autopay. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // -- polling --------------------------------------------------------------
  useEffect(() => {
    if (!awaitingMandate || !pendingId) return
    const deadline = Date.now() + POLL_MAX_MS
    const iv = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(iv)
        setError("We couldn't confirm your mandate approval. If you completed it in Razorpay, refresh this page.")
        setAwaitingMandate(false)
        return
      }
      try {
        const s = await apiJson<StatusResponse>(
          `/v1/workspace/plan/setup-autopay/status?id=${pendingId}`,
        )
        if (s.status === 'ACTIVATED') {
          clearInterval(iv)
          // Refresh the cached Tenant's activeModules from the backend so the
          // launcher tile flips from LOCKED to ACTIVE the moment the user
          // lands — no page reload required. This was a real symptom for a
          // customer on 2026-08-07: mandate approved + tenant_modules rows
          // written by the webhook, but the /modules grid still showed
          // "locked" because the local Zustand cache had the pre-activation
          // module list. Refetch, then navigate.
          try { await refreshTenant() } catch { /* best-effort, next reload picks it up */ }
          setAwaitingMandate(false)
          navigate('/modules')
        } else if (s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'EXPIRED') {
          clearInterval(iv)
          setAwaitingMandate(false)
          setError(s.failureReason || `Setup ${s.status.toLowerCase()}. Please try again.`)
        }
      } catch { /* network blip — keep polling */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingMandate, pendingId])

  // -- guards ---------------------------------------------------------------
  if (!isAdmin) {
    return (
      <div className="min-h-full bg-[var(--bg-base)]">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock size={32} className="mx-auto text-[var(--text-tertiary)]" />
            <h1 className="mt-4 text-xl font-semibold text-[var(--text-primary)]">Only workspace admins can manage the plan</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Ask your admin to open Manage Plan and add modules for you.</p>
            <button onClick={() => navigate('/modules')} className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">
              <ArrowLeft size={14} /> Back to apps
            </button>
          </div>
        </div>
      </div>
    )
  }

  // -- render ---------------------------------------------------------------
  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <button onClick={() => navigate('/modules')} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <ArrowLeft size={12} /> Back to apps
            </button>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Manage your plan</h1>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              Pick modules for {tenantName} and set the seat count for each. First 7 days are free — autopay kicks in after.
            </p>
          </div>
        </div>

        {/* Grid: modules on the left, plan summary on the right */}
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Modules */}
          <div className="space-y-3">
            {isLoading && available.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
              ))
            ) : (
              plans.map(plan => {
                const isAvailable = plan.status === 'AVAILABLE'
                const seats = seatsByPlan[plan.key] ?? 0
                const isSelected = seats > 0
                const Icon = (plan.icon && iconMap[plan.icon]) || Users
                return (
                  <div
                    key={plan.key}
                    className={clsx(
                      'rounded-xl border p-4 transition-colors',
                      !isAvailable
                        ? 'border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 opacity-70'
                        : isSelected
                          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]/40 shadow-sm'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)]',
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <span className={clsx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        isAvailable
                          ? 'bg-[var(--accent-bg)] text-[var(--accent-fg)]'
                          : 'bg-[var(--bg-subtle)] text-[var(--text-tertiary)]',
                      )}>
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{plan.displayName}</h3>
                          {!isAvailable && (
                            <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-fg-strong)]">
                              <Sparkles size={9} className="mr-0.5 inline" /> Launching soon
                            </span>
                          )}
                        </div>
                        {plan.tagline && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{plan.tagline}</p>}
                        {isAvailable && (
                          <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
                            ₹{plan.priceInr}/user/month
                            {billingCycle === 'annual' && (
                              <span className="ml-1 text-[var(--accent-fg-strong)]">
                                · ₹{effectiveUnit(plan, 'annual')}/user/mo billed yearly
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      {isAvailable ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => dec(plan.key)} disabled={seats === 0}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`Decrease seats for ${plan.displayName}`}>
                            <Minus size={14} />
                          </button>
                          <input type="number" min={0} max={999} value={seats}
                                 onChange={e => setSeats(plan.key, Number(e.target.value))}
                                 className="h-8 w-14 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-center text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--accent-solid)]/15" />
                          <button onClick={() => inc(plan.key)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)]"
                                  aria-label={`Increase seats for ${plan.displayName}`}>
                            <Plus size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="rounded-full bg-[var(--bg-subtle)] px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)]">Locked</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Plan summary */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-2xl border-2 border-[var(--accent-border)] bg-[var(--bg-surface)] shadow-sm">
              <div className="bg-[var(--accent-solid)] px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Your plan</p>
                <h2 className="text-lg font-bold text-white">
                  {selectedPlans.length === 0
                    ? 'No modules selected'
                    : selectedPlans.map(x => x.plan.displayName).join(' · ')}
                </h2>
              </div>

              <div className="p-5 space-y-4">
                {/* Cycle toggle */}
                <div className="inline-flex w-full rounded-lg bg-[var(--bg-subtle)] p-1">
                  {(['monthly', 'annual'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => setBillingCycle(c)}
                      className={clsx(
                        'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                        billingCycle === c
                          ? 'bg-[var(--accent-solid)] text-white shadow-sm'
                          : 'text-[var(--text-secondary)]',
                      )}
                    >
                      {c}
                      {c === 'annual' && <span className="ml-1 text-[10px]">Save 10%</span>}
                    </button>
                  ))}
                </div>

                {/* Line items */}
                {selectedPlans.length > 0 ? (
                  <div className="space-y-2">
                    {selectedPlans.map(({ plan, seats }) => {
                      const unit = effectiveUnit(plan, billingCycle)
                      const sub  = billingCycle === 'annual' ? unit * seats * 12 : unit * seats
                      return (
                        <div key={plan.key} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">
                            <Users size={11} className="mr-1 inline" />
                            {plan.displayName} · {seats}
                          </span>
                          <span className="tabular-nums font-medium text-[var(--text-primary)]">
                            ₹{sub.toLocaleString('en-IN')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-tertiary)] text-center py-4">
                    Set a seat count on any module to see your total here.
                  </p>
                )}

                {/* Totals */}
                <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-secondary)]">Today</span>
                    <span className="text-2xl font-bold text-[var(--accent-fg-strong)]">₹0</span>
                  </div>
                  {selectedPlans.length > 0 && (
                    <div className="rounded-lg bg-[var(--accent-bg)]/60 p-3 text-[11px] leading-snug text-[var(--text-secondary)]">
                      <Sparkles size={11} className="mr-1 inline text-[var(--accent-fg-strong)]" />
                      Autopay of <span className="font-semibold text-[var(--text-primary)]">₹{cycleTotal.toLocaleString('en-IN')}/{billingCycle === 'annual' ? 'yr' : 'mo'}</span> begins after your 7-day free trial. Cancel anytime.
                    </div>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-[var(--status-error-bg)] p-3 text-xs text-[var(--status-error-fg)]">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={loading || selectedPlans.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  {loading ? 'Setting up autopay…' : 'Pay ₹0 & Set Up Autopay'}
                </button>

                <p className="flex items-center justify-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                  <ShieldCheck size={11} /> Secured by Razorpay
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Waiting-for-mandate overlay */}
      {awaitingMandate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="max-w-md w-full rounded-2xl bg-[var(--bg-surface)] p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-bg)]">
              <Loader2 size={24} className="animate-spin text-[var(--accent-fg-strong)]" />
            </div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Waiting for mandate approval…</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              We opened Razorpay in a new tab. Complete the autopay authorisation there and your modules will unlock automatically.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button onClick={() => checkoutTab?.focus()} className="rounded-xl bg-[var(--accent-solid)] px-4 py-3 text-sm font-semibold text-white hover:opacity-90">
                I'm on the Razorpay tab → focus it
              </button>
              <button onClick={() => { setAwaitingMandate(false); setPendingId(null); }} className="py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                Cancel and edit my selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
