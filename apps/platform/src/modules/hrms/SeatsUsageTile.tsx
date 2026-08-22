import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users2, AlertTriangle } from 'lucide-react'
import { HrButton } from '@/shared/components/hr'
import { useSeatsUsage } from './api/useSeats'

/**
 * Seats-Usage tile for the admin HrmsDashboard.
 *
 * Client rule (2026-08-17): "let admin know in his dashboard more how many
 * employees he has left how many seats used… only admin will see this who
 * has access for manage your plan for workspace."
 *
 * Consumer gates on isAdmin AND `usePermission(P.WORKSPACE_BILLING_MANAGE)`
 * before rendering this tile — a Company-Admin without billing rights (rare
 * but possible with custom RBAC) should not see a card that links to a page
 * they cannot open.
 *
 * The tile is data-driven, not hardcoded:
 *   - purchased/current/remaining come from GET /v1/workspace/seats/usage,
 *     which reads platform.subscriptions ∪ platform.tenant_modules ∪ TRIAL
 *     fallback (SeatQuotaService.seatCap logic). One source of truth for
 *     both the enforcer that 402s on POST and this UI.
 *   - The urgency colour tier is a function of `remaining / purchased`,
 *     computed inline here so we don't spread magic thresholds across the
 *     app. If purchased==0 (no active plan) we render an explicit
 *     "no active plan" state, not "0 of 0 remaining" which would confuse.
 *
 * Design notes:
 *   - Matches the card language of the rest of HrmsDashboard (rounded-2xl,
 *     hairline border, emerald accent) so it sits naturally beside the
 *     Payroll Cost and Positions-Hired cards.
 *   - Progress bar as secondary encoding of remaining — visually reinforces
 *     the warning tier at a glance for CVD users who miss the colour.
 *   - Upgrade CTA routes to /settings/billing which is the RequirePermission-
 *     wrapped billing page (App.tsx guards P.WORKSPACE_BILLING_MANAGE), so
 *     if a stray click ends up here without perms, the RequirePermission
 *     redirect kicks in cleanly instead of a 403.
 */

type Tier = 'ok' | 'low' | 'critical' | 'exhausted' | 'unlimited' | 'inactive'

interface TierStyles {
  ring: string
  bar: string
  chipBg: string
  chipText: string
  chipLabel: string
}

const STYLES: Record<Tier, TierStyles> = {
  ok:         { ring: 'border-emerald-100',  bar: 'bg-emerald-500',  chipBg: 'bg-emerald-50',  chipText: 'text-emerald-700',  chipLabel: 'Healthy' },
  low:        { ring: 'border-amber-200',    bar: 'bg-amber-500',    chipBg: 'bg-amber-50',    chipText: 'text-amber-800',    chipLabel: 'Running low' },
  critical:   { ring: 'border-orange-300',   bar: 'bg-orange-500',   chipBg: 'bg-orange-50',   chipText: 'text-orange-800',   chipLabel: 'Almost full' },
  exhausted:  { ring: 'border-red-300',      bar: 'bg-red-500',      chipBg: 'bg-red-50',      chipText: 'text-red-800',      chipLabel: 'Seats exhausted' },
  unlimited:  { ring: 'border-emerald-100',  bar: 'bg-emerald-500',  chipBg: 'bg-emerald-50',  chipText: 'text-emerald-700',  chipLabel: 'Unlimited' },
  inactive:   { ring: 'border-slate-200',    bar: 'bg-slate-400',    chipBg: 'bg-slate-100',   chipText: 'text-slate-700',    chipLabel: 'No active plan' },
}

/**
 * Compute the tier from usage. Kept as a pure function so future tiers
 * (e.g. an "in trial" chip when the plan is on a trial subscription) can be
 * added without touching the render code.
 */
function computeTier(usage: { purchased: number; current: number; remaining: number }): Tier {
  if (usage.purchased <= 0) return 'inactive'
  // A signed contract with unlimited seats would set purchased to a
  // sentinel (e.g. 9999). We treat >= 1000 as effectively unlimited so we
  // don't render a scary progress bar for enterprise plans.
  if (usage.purchased >= 1000) return 'unlimited'
  if (usage.remaining <= 0) return 'exhausted'
  const ratio = usage.remaining / usage.purchased
  if (ratio <= 0.05) return 'critical'
  if (ratio <= 0.15) return 'low'
  return 'ok'
}

export const SeatsUsageTile: React.FC = () => {
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useSeatsUsage()

  // Loading skeleton — matches SkeletonCard geometry so the surrounding grid
  // does not jump when it lands.
  if (isPending) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5" role="status" aria-label="Loading seat usage">
        <div className="flex items-start justify-between">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="mt-4 h-9 w-24 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-2 w-full animate-pulse rounded bg-slate-100" />
      </div>
    )
  }

  // Error surface — never silent. Admin needs to know if the seat check is
  // unreachable because that's the same signal that the 402 enforcement on
  // POST would fail too (both hit SeatQuotaService.getUsage).
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-red-800">Seat usage unavailable</div>
            <div className="mt-1 text-xs text-red-700">
              {(error as { message?: string })?.message ?? 'Could not load the current seat count.'}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-xs font-medium text-red-700 underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const tier = computeTier(data)
  const style = STYLES[tier]
  const isFinite = tier !== 'unlimited' && tier !== 'inactive'
  const percentUsed = isFinite && data.purchased > 0
    ? Math.min(100, Math.round((data.current / data.purchased) * 100))
    : 0

  return (
    <div className={`rounded-2xl border bg-white p-5 ${style.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
            <Users2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="text-sm font-semibold text-slate-800">Employee Seats</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.chipBg} ${style.chipText}`}>
          {style.chipLabel}
        </span>
      </div>

      {tier === 'inactive' ? (
        <>
          <div className="mt-4 text-sm text-slate-700">
            No active subscription on this workspace.
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.current.toLocaleString()} employee{data.current === 1 ? '' : 's'} on file.
          </div>
          <HrButton size="sm" className="mt-4 w-full" onClick={() => navigate('/settings/billing')}>
            Choose a plan
          </HrButton>
        </>
      ) : tier === 'unlimited' ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="text-3xl font-bold text-slate-900">{data.current.toLocaleString()}</div>
            <div className="text-sm text-slate-500">employees onboarded</div>
          </div>
          <div className="mt-1 text-xs text-slate-500">Enterprise plan — no seat cap.</div>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="text-3xl font-bold text-slate-900">{data.current.toLocaleString()}</div>
            <div className="text-sm text-slate-500">
              of {data.purchased.toLocaleString()} seats used
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.remaining.toLocaleString()} remaining · admins included
          </div>

          <div
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentUsed}
            aria-label={`${percentUsed} percent of seats used`}
          >
            <div
              className={`h-full ${style.bar} transition-[width] duration-300`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>

          {(tier === 'low' || tier === 'critical' || tier === 'exhausted') && (
            <HrButton
              size="sm"
              className="mt-4 w-full"
              variant={tier === 'exhausted' ? 'primary' : 'ghost'}
              onClick={() => navigate('/settings/billing')}
            >
              {tier === 'exhausted' ? 'Upgrade to add more employees' : 'Manage plan'}
            </HrButton>
          )}
        </>
      )}
    </div>
  )
}
