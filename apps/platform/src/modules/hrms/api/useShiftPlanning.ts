import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { errorCodeOf, httpStatusOf, isFeatureNotReady } from '@/core/api/featureNotReady'
import { useAuthStore } from '@/core/auth/authStore'

/**
 * Shift planning's pilot (owner, 11 Oct 2026): Phase 1 is on only for the test businesses, decided on the server
 * (com.hrms.api.roster.RosterPilot, by business subdomain). Every other business gets 403 FEATURE_NOT_ENABLED from
 * every shift-planning endpoint and sees no way in: no Shift Planner tab, and the planner's and the import's links
 * land on Shifts & overtime.
 *   GET /v1/rosters/availability → { enabled }   (anyone signed in; the pilot never refuses this one)
 */

export const FEATURE_NOT_ENABLED = 'FEATURE_NOT_ENABLED'

export interface ShiftPlanningAvailability { enabled: boolean }

/** 403 FEATURE_NOT_ENABLED: this business isn't in shift planning's pilot. */
export function isFeatureNotEnabled(error: unknown): boolean {
  return httpStatusOf(error) === 403 && errorCodeOf(error) === FEATURE_NOT_ENABLED
}

/** Shift planning can't be used here: the business isn't in the pilot (403), or its tables aren't live yet (503 FEATURE_NOT_READY). */
export function isShiftPlanningOff(error: unknown): boolean {
  return isFeatureNotEnabled(error) || isFeatureNotReady(error)
}

/**
 * Whether this business has shift planning. Asked once per sign-in (the cache is wiped at sign-out). `known` stays
 * false until the answer is in, and every way into the planner stays hidden until then, so nothing shows and then
 * disappears. A failed answer (an older backend, the attendance module off) counts as off.
 */
export function useShiftPlanningAvailability(opts?: { enabled?: boolean }) {
  const tenantId = useAuthStore((s) => s.tenant?.id ?? '')
  const asked = opts?.enabled ?? true
  const q = useQuery({
    queryKey: ['hrms', 'shift-planning', 'availability', tenantId] as const,
    queryFn: () => apiJson<ShiftPlanningAvailability>('/v1/rosters/availability'),
    enabled: asked,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const known = q.isSuccess || q.isError
  return { enabled: q.data?.enabled === true, known, pending: asked && !known }
}
