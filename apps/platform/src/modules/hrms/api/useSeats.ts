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
 *   currentExcludingAdmin   — count of ACTIVE employees whose role is NOT in
 *                             {OWNER, SUPER_ADMIN}. OWNERs are billed as the
 *                             workspace owner, not as headcount, so they never
 *                             count against the paid seat cap.
 *   remaining               — max(purchased - currentExcludingAdmin, 0).
 */
export interface SeatsUsage {
  purchased: number
  currentExcludingAdmin: number
  remaining: number
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
