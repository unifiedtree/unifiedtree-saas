import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * Seat quota usage for the current tenant.
 *
 * Backend: GET /v1/workspace/seats/usage (SeatQuotaController on the
 * canonical-prod profile). Requires only isAuthenticated() so any signed-in
 * user in the tenant can read it, but the UI only surfaces it to billing-
 * managing roles (see HrmsDashboard.tsx).
 *
 * Fields (mirrors SeatQuotaService.Usage):
 *   purchased               — seats sold on the current subscription /
 *                             tenant_modules row, or 0 if no billing record.
 *   current                 — count of ALL active employees, admins included.
 *                             Admins used to be subtracted here; the client
 *                             asked for them to be billed like anyone else
 *                             (2026-08-22), so every active employee counts.
 *   currentExcludingAdmin   — deprecated alias of `current`, still emitted by
 *                             the backend so a stale cached bundle keeps
 *                             rendering. Do not use in new code.
 *   remaining               — max(purchased - current, 0).
 */
export interface SeatsUsage {
  purchased: number
  current: number
  /** @deprecated same value as `current` — read `current` instead. */
  currentExcludingAdmin?: number
  remaining: number
  // Soft seat limit (contract 1, _results/chakri/CONTRACTS-PROPOSAL.md): a server with it also sends these,
  // and no longer refuses an employee over the bought seats (no 402 SEAT_LIMIT_EXCEEDED). Absent: old server.
  seatsBought?: number
  seatsUsed?: number
  /** max(0, seatsUsed − seatsBought). */
  overBy?: number
  /** The extra people are billed at the end of the billing cycle. */
  extraBilledAtCycleEnd?: boolean
  /** When the cycle ends (yyyy-MM-dd); null without a paid subscription. */
  cycleEndsOn?: string | null
  companyId?: string | null
}

/** What the seat line shows, from either server (seatsView). */
export interface SeatsView {
  used: number
  total: number
  /** The server allows going over the seats (the new fields are present). */
  soft: boolean
  /** People over the bought seats (0 when within them, or on an old server). */
  overBy: number
  billedAtCycleEnd: boolean
  cycleEndsOn: string | null
}

/** The seat numbers, the new fields when the server sends them, else the old ones. */
export function seatsView(u: SeatsUsage | null | undefined): SeatsView | null {
  if (!u) return null
  const soft = typeof u.overBy === 'number'
  const used = typeof u.seatsUsed === 'number' ? u.seatsUsed : u.current
  const total = typeof u.seatsBought === 'number' ? u.seatsBought : u.purchased
  return {
    used, total, soft,
    overBy: soft ? Math.max(0, u.overBy as number) : 0,
    billedAtCycleEnd: soft && u.extraBilledAtCycleEnd !== false,
    cycleEndsOn: soft && u.cycleEndsOn ? u.cycleEndsOn : null,
  }
}

/** "2 extra users will be billed at the end of the cycle (on 6 Nov 2026)" — `fmt` formats the date. */
export function overageText(v: SeatsView, fmt: (iso: string) => string): string {
  const n = v.overBy
  const who = `${n} extra ${n === 1 ? 'user' : 'users'}`
  if (!v.billedAtCycleEnd) return `${who} over your ${v.total} seats`
  return `${who} will be billed at the end of the cycle${v.cycleEndsOn ? ` (on ${fmt(v.cycleEndsOn)})` : ''}`
}

/** Refresh cadence: seats change on employee create/terminate + plan upgrade.
 *  The mutations already invalidate the parent 'workforce' key; we do NOT
 *  cross-invalidate this key from every employee mutation because a small
 *  30-second stale window on the dashboard tile is fine (no billing decision
 *  is made from a cached value — the backend enforces on POST anyway). */
const REFETCH_MS = 30_000

export function useSeatsUsage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['workspace', 'seats-usage'],
    queryFn: () => apiJson<SeatsUsage>('/v1/workspace/seats/usage'),
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
    // Only fire if the caller explicitly asks for it — the tile is admin-only
    // and there's no point paying a request from an EMPLOYEE session that will
    // never render the tile.
    enabled: options?.enabled ?? true,
  })
}
