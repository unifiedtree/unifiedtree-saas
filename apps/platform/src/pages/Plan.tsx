import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Minus, Plus, ShieldCheck, Sparkles, Users,
  AlertCircle, Lock,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
// useSdkStore.getState() is used inline for the hard-refresh in the polling
// loop's ACTIVATED branch — see below.
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
// Survives reload / re-login so the mandate poll can resume. Cleared on any
// terminal outcome (activated, failed, cancelled, expired).
const PENDING_KEY = 'ut.plan.pendingChangeId'
// The Razorpay checkout URL, persisted alongside the id. Without it, a modal
// resumed after a reload has a "focus the Razorpay tab" button pointing at a
// Window handle that no longer exists — a silent no-op next to copy claiming
// we just opened a tab.
const PENDING_URL_KEY = 'ut.plan.pendingCheckoutUrl'

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

/** Response shape from GET /v1/workspace/plan/current. */
interface CurrentSubscriptionsResponse {
  subscriptions: ActiveSubDto[]
}

interface ActiveSubDto {
  primaryPlanKey: string | null
  planKeys: string[]
  seats: number
  billingCycle: string | null   // 'MONTHLY' | 'ANNUAL' — null when unbilled
  unitPriceInr: number | null
  amountInr: number | null
  /** 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'HALTED' | 'PAUSED' | 'GRACE' | 'NO_AUTOPAY' */
  status: string
  currentPeriodEnd: string | null   // ISO
  nextChargeAt: string | null        // ISO
  haltedAt: string | null            // ISO
  graceUntil: string | null          // ISO
  razorpaySubscriptionId: string | null
  /**
   * false = the workspace HAS these modules unlocked but nothing is billing
   * for them (mandate cancelled, or activated before the ledger write
   * existed). Every billing field is null in that case, there is no mandate
   * to adjust, and the card must offer "set up autopay" instead of seat
   * controls. Derived server-side from platform.tenant_modules.
   */
  billed: boolean
}

interface ChangeSeatsResponse {
  previousSeats: number
  newSeats: number
  charged: boolean
  message: string
}

/** Result of asking the backend to re-check Razorpay for a stranded payment. */
interface RecoverResponse {
  activated: number
  message: string
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
  // Resume an in-flight mandate across a reload. The admin authorises the
  // mandate in a SEPARATE Razorpay tab, so it is entirely normal for them to
  // reload, navigate away, or even re-login on this one while the payment is
  // completing. Keeping the pending id only in React state meant the polling
  // loop died on any of those, the admin was dropped back on the plan picker
  // as though they had never paid, and our own "refresh this page" error
  // message was impossible to act on. localStorage survives all three.
  const [awaitingMandate, setAwaitingMandate] = useState(
    () => !!localStorage.getItem(PENDING_KEY))
  const [pendingId, setPendingId] = useState<string | null>(
    () => localStorage.getItem(PENDING_KEY))
  const [checkoutTab, setCheckoutTab] = useState<Window | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(
    () => localStorage.getItem(PENDING_URL_KEY))
  const [recovering, setRecovering] = useState(false)

  // Active subscriptions on THIS workspace, keyed by primary planKey. When
  // present, the /plan page shows a "Your current plan" section with a
  // Change Seats control that reuses the SAME UPI mandate (Hotstar-style,
  // Razorpay auto-prorates the difference on the existing mandate). The
  // seat picker further down HIDES already-subscribed plans so the admin
  // can only ADD new modules (creating parallel subscriptions), never
  // accidentally create a duplicate for a plan they already own.
  const [activeSubs, setActiveSubs] = useState<ActiveSubDto[]>([])
  const [activeSubsLoading, setActiveSubsLoading] = useState(true)
  const [subsLoadFailed, setSubsLoadFailed] = useState(false)
  // Per-plan "pending seat change" state — the +/- on the current-plan card
  // is optimistic; we submit when the admin clicks Confirm.
  const [pendingSeatChanges, setPendingSeatChanges] = useState<Record<string, number>>({})
  const [changingPlanKey, setChangingPlanKey] = useState<string | null>(null)
  const [changeMessage, setChangeMessage] = useState('')

  // Two different questions, two different sets — conflating them breaks one
  // case or the other:
  //
  //   ownedPlanKeys  — "is this already shown in Your current plan?"  Used to
  //                    hide it from the picker so the same plan is not listed
  //                    twice on one screen. Includes unbilled plans.
  //   billedPlanKeys — "would buying this charge them a second time?"  Used to
  //                    keep it out of the summary and the Pay request. ONLY
  //                    billed plans, because a plan whose modules are active
  //                    with no mandate is precisely one the admin still needs
  //                    to be able to pay for.
  const ownedPlanKeys = useMemo(
    () => new Set(activeSubs.flatMap(s => s.planKeys)), [activeSubs])
  const billedPlanKeys = useMemo(
    () => new Set(activeSubs.filter(s => s.billed).flatMap(s => s.planKeys)), [activeSubs])

  // Distinguishes "this workspace owns nothing" from "we could not find out".
  // Treating a failed fetch as an empty list is dangerous here: activePlanKeys
  // collapses to empty, which silently disables BOTH duplicate-purchase guards
  // (the summary filter and the picker filter) in exactly the situation they
  // exist for, and hides the "Your current plan" card including its HALTED /
  // grace-period warning — so an admin mid-grace sees what looks like a fresh
  // workspace and is invited to buy a module they already pay for.
  const fetchCurrent = async () => {
    try {
      const r = await apiJson<CurrentSubscriptionsResponse>('/v1/workspace/plan/current')
      const list = r.subscriptions ?? []
      setActiveSubs(list)
      setSubsLoadFailed(false)
      // Seed the seat picker for plans that are unlocked with no autopay
      // behind them. Their whole purpose on this page is "start paying for
      // what you already have", so the sensible starting number is the seat
      // count they are already running — the admin adjusts from there rather
      // than typing it in again. Only seeds keys the admin has not already
      // touched, so a re-fetch (after a recovery, say) never overwrites an
      // edit in progress.
      setSeatsByPlan(prev => {
        const next = { ...prev }
        for (const s of list) {
          if (s.billed || !s.primaryPlanKey) continue
          if (next[s.primaryPlanKey] == null) {
            next[s.primaryPlanKey] = Math.max(1, s.seats)
          }
        }
        return next
      })
    } catch {
      setActiveSubs([])
      setSubsLoadFailed(true)
    } finally {
      setActiveSubsLoading(false)
    }
  }

  useEffect(() => {
    fetchCurrent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-select the plan passed via ?add=<planKey> (from the tile grid's
  // "Add to plan" affordance on a locked tile). Skips if that plan is
  // already active (in which case the admin should see "Change seats"
  // on their current-plan card instead of the setup form).
  useEffect(() => {
    const add = searchParams.get('add')
    if (add && available.some(p => p.key === add) && !billedPlanKeys.has(add) && !seatsByPlan[add]) {
      setSeatsByPlan(prev => ({ ...prev, [add]: 1 }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.length, searchParams, billedPlanKeys.size])

  // -- derived pricing ------------------------------------------------------
  // Filters OUT plans the workspace already owns. Without this, a stray
  // seatsByPlan entry (from a stale ?add= link or a click before fetchCurrent
  // returned) would price the owned plan into the summary, enable the
  // "Set Up Autopay" button, and post it to /setup-autopay — creating a
  // SECOND Razorpay subscription for a module the customer already pays for.
  // The grid filter at the render layer hides the tile so the admin can't
  // even decrement the stale entry back to zero. Belt-and-suspenders here.
  const selectedPlans: Array<{ plan: ModulePlan; seats: number }> = useMemo(() => {
    return available
      .filter(p => !billedPlanKeys.has(p.key))
      .map(p => ({ plan: p, seats: seatsByPlan[p.key] ?? 0 }))
      .filter(x => x.seats > 0)
  }, [available, seatsByPlan, billedPlanKeys])

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

  // -- change-seats on an EXISTING subscription (Hotstar-style) -------------
  // Optimistic +/-  on the current-plan card; the pending value only submits
  // to the backend when the admin clicks Confirm. Razorpay reuses the same
  // mandate and auto-prorates the current-cycle difference — no new UPI PIN
  // required as long as the new amount stays under the mandate's max_amount
  // ceiling (typically 1.5–2x the initial setup amount).
  //
  // Bucket key = razorpay_subscription_id (unique per subscription). Previously
  // used primaryPlanKey ?? '' which meant two subs with null primaryPlanKey
  // collided on the same '' slot — clicking + on sub A moved sub B's stepper
  // and Cancel wiped both.
  // Unbilled rows have no subscription id, so fall back to the plan key. Still
  // unique per card (a plan appears at most once) and never collides with a
  // real sub_XXX id.
  const bucketKey = (sub: ActiveSubDto) =>
    sub.razorpaySubscriptionId ?? `unbilled:${sub.primaryPlanKey ?? ''}`
  const currentPendingSeats = (key: string, current: number) =>
    pendingSeatChanges[key] ?? current
  const seatsDelta = (key: string, current: number) =>
    currentPendingSeats(key, current) - current
  const bumpPending = (key: string, current: number, delta: number) => {
    setPendingSeatChanges(prev => {
      const next = Math.max(1, Math.min(999, currentPendingSeats(key, current) + delta))
      return { ...prev, [key]: next }
    })
  }
  const cancelPending = (key: string) => {
    setPendingSeatChanges(prev => { const c = { ...prev }; delete c[key]; return c })
  }
  const confirmSeatChange = async (sub: ActiveSubDto) => {
    const primaryKey = sub.primaryPlanKey
    const key = bucketKey(sub)
    if (!primaryKey) return
    const newSeats = currentPendingSeats(key, sub.seats)
    if (newSeats === sub.seats) { cancelPending(key); return }
    setChangingPlanKey(primaryKey)
    setError('')
    try {
      const res = await apiJson<ChangeSeatsResponse>(
        '/v1/workspace/plan/change-seats',
        { method: 'POST', body: JSON.stringify({ planKey: primaryKey, newSeats }) },
      )
      // Success — refresh current + tenant modules from the source of truth.
      // Razorpay's async subscription.charged webhook will refresh amount_inr
      // + current_period_end shortly; the poll here just reads what we just
      // wrote so the UI reflects the intent immediately.
      await fetchCurrent()
      try { await useSdkStore.getState().hydrate() } catch { /* best-effort */ }
      try { await refreshTenant() } catch { /* best-effort */ }
      cancelPending(key)
      // Show the server's proration message so the admin knows what happens.
      setChangeMessage(res.message)
      // Auto-clear after 8s so it doesn't linger.
      setTimeout(() => setChangeMessage(''), 8000)
    } catch (err) {
      setError((err as Error).message || 'Could not update seats. Please try again.')
    } finally {
      setChangingPlanKey(null)
    }
  }

  // Clear every trace of an in-flight purchase. Both the storage key AND the
  // React state must go: the amber "payment not confirmed" banner renders on
  // `pendingId && !awaitingMandate`, so clearing only one of them is what
  // turns the banner ON at exactly the wrong moments (right after a
  // successful recovery, or on top of a terminal FAILED/CANCELLED error).
  const clearPending = () => {
    localStorage.removeItem(PENDING_KEY)
    localStorage.removeItem(PENDING_URL_KEY)
    setPendingId(null)
  }

  // Tell the backend to release an abandoned setup, then clear locally.
  // Without the server call the plan_change_requests row stays
  // AWAITING_MANDATE and the duplicate-purchase guard refuses the admin's
  // next attempt to buy the same module — a button labelled "Cancel and edit
  // my selection" that makes re-selecting impossible.
  const cancelPendingSetup = async (id: string | null) => {
    if (id) {
      try {
        await apiJson('/v1/workspace/plan/setup-autopay/cancel',
          { method: 'POST', body: JSON.stringify({ id }) })
      } catch { /* best-effort — the expiry sweep closes it out within 24h */ }
    }
    clearPending()
    setAwaitingMandate(false)
  }

  // -- "I paid but it's still locked" ---------------------------------------
  // Asks the backend to check with Razorpay directly for any purchase of ours
  // stuck awaiting a mandate confirmation. Never charges anything — it only
  // grants access that was already paid for. The same recovery runs
  // automatically on page load and on a server-side cron; this button exists
  // so an admin whose money has left their bank has something to press
  // instead of being told to wait.
  const recoverPayment = async () => {
    setRecovering(true)
    setError('')
    try {
      // Explicit body even though the endpoint takes none. A bodyless POST
      // relies on the browser adding Content-Length: 0 (which the Fetch spec
      // requires) surviving every proxy in between — and Google's front end
      // answers 411 Length Required if it does not arrive. Sending "{}" costs
      // nothing and removes that dependency from the one button a customer
      // whose money is stuck will be pressing.
      const res = await apiJson<RecoverResponse>(
        '/v1/workspace/plan/recover', { method: 'POST', body: '{}' })
      if (res.activated > 0) {
        clearPending()          // must clear pendingId too, not just storage —
                                // the amber banner keys off pendingId && !awaitingMandate,
                                // so leaving it set renders "payment not confirmed"
                                // directly beneath the success message.
        setAwaitingMandate(false)
        await fetchCurrent()
        try { await useSdkStore.getState().hydrate() } catch { /* best-effort */ }
        try { await refreshTenant() } catch { /* best-effort */ }
        setChangeMessage(res.message)
        setTimeout(() => setChangeMessage(''), 8000)
      } else {
        setError(res.message)
      }
    } catch (err) {
      setError((err as Error).message || 'Could not check your payment. Please try again.')
    } finally {
      setRecovering(false)
    }
  }

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
      localStorage.setItem(PENDING_KEY, res.planChangeRequestId)
      localStorage.setItem(PENDING_URL_KEY, res.checkoutShortUrl)
      setCheckoutUrl(res.checkoutShortUrl)
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
        // Deliberately NOT clearing PENDING_KEY here. The mandate may still
        // be completing on Razorpay's side, and the backend self-heal on
        // /current plus the 10-minute sweep will activate it whenever the
        // truth arrives. Keeping the id means a later reload resumes this
        // poll rather than pretending the payment never happened.
        setError("We couldn't confirm your payment yet. If money has left your account, "
                 + "use “I paid but it's still locked” below — we'll check with Razorpay directly.")
        setAwaitingMandate(false)
        return
      }
      try {
        const s = await apiJson<StatusResponse>(
          `/v1/workspace/plan/setup-autopay/status?id=${pendingId}`,
        )
        if (s.status === 'ACTIVATED') {
          clearInterval(iv)
          localStorage.removeItem(PENDING_KEY)
          // Hard refresh of SDK auth state so SDK.modules AND SDK.permissions
          // AND the local Tenant all update atomically from the authenticated
          // /v1/canonical-auth/me endpoint. This addresses two 2026-08-07
          // symptoms in one go:
          //   1. /modules grid was still showing HR as locked after the
          //      webhook activated it (local Zustand had stale activeModules).
          //   2. Newly-activated module pages 403'd because SDK.permissions
          //      hadn't picked up the new RBAC codes.
          // SDK.hydrate() re-fetches /me and updates both; the AuthProvider
          // bridge propagates the SDK's fresh state into the local store, so
          // Modules.tsx's Zustand selector re-renders the tile grid without
          // a full page reload. refreshTenant() kept as a belt-and-suspenders
          // update to the local store in case hydrate fails.
          try { await useSdkStore.getState().hydrate() } catch { /* fall through to refreshTenant */ }
          try { await refreshTenant() } catch { /* best-effort */ }
          setAwaitingMandate(false)
          navigate('/modules')
        } else if (s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'EXPIRED') {
          clearInterval(iv)
          // Terminal — clear id AND storage. Leaving pendingId set would put
          // the amber "nothing is lost, we'll check with Razorpay" banner
          // directly above the failure error, reassuring the admin about a
          // payment the backend has just told us definitively did not happen.
          clearPending()
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

        {/* Could not read the current plan. Say so plainly and block purchase:
            with no view of what this workspace already owns we cannot tell a
            new module from a duplicate, and buying a duplicate means a second
            Razorpay mandate charging for something they already pay for. */}
        {subsLoadFailed && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-900">We couldn't load your current plan</p>
              <p className="mt-0.5 text-xs text-red-800">
                To avoid charging you twice for a module you may already have, purchasing is
                paused until we can confirm what your workspace is subscribed to.
              </p>
            </div>
            <button onClick={() => { setActiveSubsLoading(true); fetchCurrent() }}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">
              Retry
            </button>
          </div>
        )}

        {/* Outstanding-payment recovery. Shown when we know a purchase was
            started (the id survives reloads in localStorage) but we are not
            actively polling — i.e. the 30-minute window elapsed, or the admin
            reloaded / re-logged-in after paying. This is the exit from the
            worst state a payment system can put someone in: money gone,
            nothing unlocked, no way to act. */}
        {pendingId && !awaitingMandate && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">You have a payment we haven't confirmed yet</p>
              <p className="mt-0.5 text-xs text-amber-800">
                If money has already left your account, nothing is lost — we'll check with
                Razorpay and unlock your module. You will not be charged again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={recoverPayment} disabled={recovering}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                {recovering && <Loader2 size={12} className="animate-spin" />}
                {recovering ? 'Checking…' : "I paid but it's still locked"}
              </button>
              <button onClick={() => cancelPendingSetup(pendingId)}
                      className="rounded-lg px-2 py-2 text-xs font-medium text-amber-800 hover:text-amber-900">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Success banner for a completed change-seats operation */}
        {changeMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-[var(--accent-bg)]/60 p-3 text-sm text-[var(--accent-fg-strong)]">
            <Sparkles size={14} className="mt-0.5 shrink-0" />
            <span>{changeMessage}</span>
          </div>
        )}

        {/* YOUR CURRENT PLAN — one card per active subscription. Same UPI
            mandate reused when admin bumps seats (Razorpay auto-prorates on
            the existing mandate; no new PIN required as long as the new
            amount stays under the mandate's max_amount ceiling). */}
        {!activeSubsLoading && activeSubs.length > 0 && (
          <div className="mb-8 space-y-3">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Your current plan</h2>
            {activeSubs.map(sub => {
              // Bucket key = razorpay sub id (unique per sub). Was primaryPlanKey
              // which collided when two ledger rows had null primaryPlanKey.
              const bkey = bucketKey(sub)
              const plan = plans.find(p => sub.planKeys.includes(p.key))
              const Icon = (plan?.icon && iconMap[plan.icon]) || Users
              const displayName = plan?.displayName ?? (sub.primaryPlanKey ?? 'Subscription')
              const cycleLabel = sub.billingCycle === 'ANNUAL' ? 'yr' : 'mo'
              const pending = currentPendingSeats(bkey, sub.seats)
              const delta = seatsDelta(bkey, sub.seats)
              const isChanging = changingPlanKey === sub.primaryPlanKey
              // If the sub has HALTED / PAUSED / PAST_DUE the backend
              // changeSeatCount will 409 — pre-disable the +/- so the admin
              // doesn't hit an opaque error. They should re-authorise the
              // mandate first (surface a clearer CTA below when useful).
              // Unbilled plans have no mandate to prorate against, so seat
              // controls are meaningless — they get a "set up autopay" CTA.
              const seatChangeAllowed = sub.billed
                  && (sub.status === 'ACTIVE' || sub.status === 'TRIALING')
                  && !!sub.primaryPlanKey
              const nextCharge = sub.nextChargeAt
                ? new Date(sub.nextChargeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : null
              const statusPill =
                sub.status === 'NO_AUTOPAY' ? { text: 'No autopay set up', cls: 'bg-amber-100 text-amber-800' } :
                sub.status === 'ACTIVE'    ? { text: 'Active',       cls: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]' } :
                sub.status === 'TRIALING'  ? { text: '7-day trial',  cls: 'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]' } :
                sub.status === 'PAST_DUE'  ? { text: 'Payment retrying', cls: 'bg-amber-100 text-amber-800' } :
                sub.status === 'HALTED'    ? { text: 'Payment failed — grace period', cls: 'bg-red-100 text-red-700' } :
                sub.status === 'PAUSED'    ? { text: 'Paused',       cls: 'bg-slate-100 text-slate-700' } :
                                             { text: sub.status,     cls: 'bg-slate-100 text-slate-700' }
              return (
                <div key={bkey}
                     className="rounded-xl border-2 border-[var(--accent-border)] bg-[var(--bg-surface)] p-5 shadow-sm">
                  <div className="flex items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-fg)]">
                      <Icon size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{displayName}</h3>
                        <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', statusPill.cls)}>{statusPill.text}</span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {/* seats is 0 for most legacy activations — the column
                            was only populated once the in-workspace flow began
                            writing it. Printing "0 seats" reads as a fault, so
                            say nothing rather than something wrong. */}
                        {sub.seats > 0
                          ? <><span className="tabular-nums">{sub.seats}</span> seats</>
                          : <>Seat count not set</>}
                        {sub.billed ? (
                          <>
                            {' · '}<span className="tabular-nums">₹{(sub.amountInr ?? 0).toLocaleString('en-IN')}</span>/{cycleLabel}
                            {nextCharge && <> · next charge {nextCharge}</>}
                          </>
                        ) : (
                          <> unlocked · choose how many to pay for</>
                        )}
                      </p>
                    </div>
                    {sub.billed ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => bumpPending(bkey, sub.seats, -1)}
                                disabled={isChanging || pending <= 1 || !seatChangeAllowed}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40">
                          <Minus size={14} />
                        </button>
                        <div className="h-8 w-14 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-center text-sm font-medium leading-8 text-[var(--text-primary)] tabular-nums">
                          {pending}
                        </div>
                        <button onClick={() => bumpPending(bkey, sub.seats, +1)}
                                disabled={isChanging || pending >= 999 || !seatChangeAllowed}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40">
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      // No mandate behind this plan, so there is nothing to
                      // prorate against — but the admin still has to pick how
                      // many seats to START paying for. This drives the SAME
                      // seatsByPlan state the picker rows use, so the summary
                      // and the Pay button pick it up automatically.
                      //
                      // A previous version put a "Set up autopay" button here
                      // that only seeded the count and scrolled down. Since
                      // this plan is (correctly) hidden from the picker to
                      // avoid listing it twice, that left the seat count
                      // completely uneditable: you could buy 5 seats or
                      // nothing. The stepper has to live on the card.
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button onClick={() => sub.primaryPlanKey && dec(sub.primaryPlanKey)}
                                disabled={(seatsByPlan[sub.primaryPlanKey ?? ''] ?? 0) <= 1}
                                aria-label="Decrease seats"
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40">
                          <Minus size={14} />
                        </button>
                        <input
                          type="number" min={1} max={999}
                          value={seatsByPlan[sub.primaryPlanKey ?? ''] ?? Math.max(1, sub.seats)}
                          onChange={e => sub.primaryPlanKey && setSeats(sub.primaryPlanKey, Number(e.target.value))}
                          aria-label="Seats to pay for"
                          className="h-8 w-14 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-center text-sm font-medium text-[var(--text-primary)] tabular-nums outline-none focus:border-[var(--border-focus)]" />
                        <button onClick={() => sub.primaryPlanKey && inc(sub.primaryPlanKey)}
                                disabled={(seatsByPlan[sub.primaryPlanKey ?? ''] ?? 0) >= 999}
                                aria-label="Increase seats"
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40">
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {!sub.billed && (
                    <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                      These modules are unlocked and your team can use them, but there is no
                      active autopay behind them — so nothing is being charged. Set the number
                      of seats above, then use <b>Pay ₹0 &amp; Set Up Autopay</b> to start the
                      billing cycle. Your first 7 days stay free.
                    </div>
                  )}
                  {sub.billed && !seatChangeAllowed && sub.status !== 'ACTIVE' && sub.status !== 'TRIALING' && (
                    <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                      Seat changes are paused while your autopay is <b>{sub.status.toLowerCase()}</b>.
                      Please update your payment method first — the +/- controls will re-enable
                      once the next charge succeeds.
                    </div>
                  )}
                  {delta !== 0 && (
                    <div className="mt-4 rounded-lg bg-[var(--accent-bg)]/60 p-3">
                      <p className="text-xs text-[var(--accent-fg-strong)]">
                        {delta > 0 ? (
                          <>Add <b>{delta}</b> seat{delta === 1 ? '' : 's'} — Razorpay will charge the prorated difference on your existing UPI mandate. No new PIN needed.</>
                        ) : (
                          <>Reduce by <b>{-delta}</b> seat{delta === -1 ? '' : 's'} — credit applied at your next renewal ({nextCharge ?? 'next cycle'}).</>
                        )}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => confirmSeatChange(sub)} disabled={isChanging}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-solid)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
                          {isChanging && <Loader2 size={12} className="animate-spin" />}
                          {isChanging ? 'Updating…' : 'Confirm change'}
                        </button>
                        <button onClick={() => cancelPending(bkey)} disabled={isChanging}
                                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Grid: modules on the left, plan summary on the right */}
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Modules — only the ones NOT already active. Already-active plans
              have their own card above with +/- seat controls. */}
          <div className="space-y-3">
            {activeSubs.length > 0 && plans.filter(p => !ownedPlanKeys.has(p.key)).length > 0 && (
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                Add another module
              </p>
            )}
            {/* Hold the picker until BOTH the module catalog AND the current-plan
                fetch complete. Without gating on activeSubsLoading, on a cold
                load useModulePlans (react-query cache) resolves first while
                fetchCurrent is still in flight, activePlanKeys is an empty Set,
                and the picker renders EVERY plan — including ones the workspace
                already owns. An admin who clicks + on their existing HR plan in
                that window writes seatsByPlan.hr=1 which then flows into the
                summary + submit body once fetchCurrent resolves (the grid then
                hides the tile so they can't undo it). Belt-and-suspenders with
                selectedPlans' filter, but gating avoids the confusing flash. */}
            {(isLoading && available.length === 0) || activeSubsLoading || subsLoadFailed ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
              ))
            ) : (
              plans.filter(p => !ownedPlanKeys.has(p.key)).map(plan => {
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
                          <button onClick={() => inc(plan.key)} disabled={seats >= 999}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-40"
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
          <aside id="plan-summary" className="lg:sticky lg:top-6 lg:self-start">
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
                  disabled={loading || selectedPlans.length === 0 || subsLoadFailed}
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
              {checkoutTab
                ? 'We opened Razorpay in a new tab. Complete the autopay authorisation there and your modules will unlock automatically.'
                : 'Finish the autopay authorisation on Razorpay and your modules will unlock automatically.'}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {/* After a reload the Window handle is gone, so focus() would be a
                  silent no-op. Fall back to re-opening the persisted checkout
                  URL — the whole point of resuming is that this still works. */}
              <button
                onClick={() => {
                  if (checkoutTab && !checkoutTab.closed) { checkoutTab.focus(); return }
                  if (checkoutUrl) {
                    const t = window.open(checkoutUrl, '_blank', 'noopener,noreferrer')
                    setCheckoutTab(t)
                  }
                }}
                disabled={!checkoutTab && !checkoutUrl}
                className="rounded-xl bg-[var(--accent-solid)] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {checkoutTab && !checkoutTab.closed
                  ? "I'm on the Razorpay tab → focus it"
                  : 'Reopen the Razorpay payment page'}
              </button>
              <button onClick={recoverPayment} disabled={recovering}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-60">
                {recovering && <Loader2 size={14} className="animate-spin" />}
                {recovering ? 'Checking with Razorpay…' : 'Already paid? Check now'}
              </button>
              {/* Releases the setup server-side as well as locally. Clearing
                  only local state would leave the request AWAITING_MANDATE, and
                  the duplicate-purchase guard would then refuse the very
                  re-selection this button invites. Still safe for someone who
                  actually did pay: cancel is guarded on AWAITING_MANDATE, so if
                  the mandate went through it is already ACTIVATED and the call
                  is a no-op. */}
              <button onClick={() => cancelPendingSetup(pendingId)}
                      className="py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                Cancel and edit my selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
