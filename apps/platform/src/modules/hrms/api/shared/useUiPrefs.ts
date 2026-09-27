// Quick-action tiles: which ones a person picked, and how often they use each (Customise, "Most used first").
//
// Contract C0 · BW-112 · owner P-DASH (migration V143_51, hrms.user_dashboard_prefs)
//   GET  /v1/me/dashboard/quick-actions?surface=dashboard|home        → QuickActionPrefs
//   PUT  /v1/me/dashboard/quick-actions?surface=  { picked }          → QuickActionPrefs
//        At most 6 unique, known keys; null = automatic. Refused with 422 otherwise.
//   POST /v1/me/dashboard/quick-actions/{key}/use?surface=            → 204
//        +1 for the current IST month; counts start again each month.
//   Permission: isAuthenticated(); the caller's own row only (identity from the token).
//   Not available: GET answers { available: false } while the table is missing
//   (hide Customise, keep the default order, drop "Most used first"); PUT
//   answers 503 FEATURE_NOT_READY; a use is simply not recorded. 404 until
//   P-DASH ships it. The hook folds all of these into notAvailable.
// Used by: P-DASH (the admin dashboard's tiles), P-HOME (the Home tiles, surface=home).
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { SHARED_KEYS, type QuickActionPrefs, type QuickActionSurface, type SaveQuickActionsRequest } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const QUICK_ACTIONS_PATH = '/v1/me/dashboard/quick-actions'
export const MAX_PICKED_QUICK_ACTIONS = 6

/** The server's own "not switched on" answer ({ available: false }) reads the same as FEATURE_NOT_READY. */
function foldUnavailable(result: Availability<QuickActionPrefs>): Availability<QuickActionPrefs> {
  return result.available && result.value.available === false ? { available: false, reason: 'FEATURE_NOT_READY' } : result
}

export function uiPrefsQuery(surface: QuickActionSurface, api: ApiFetch = defaultApi): SharedQueryOptions<QuickActionPrefs> {
  return {
    queryKey: [...SHARED_KEYS.quickActions, surface],
    queryFn: async () => foldUnavailable(await asAvailable(() => api<QuickActionPrefs>(`${QUICK_ACTIONS_PATH}?surface=${surface}`))),
  }
}

export function useUiPrefs(surface: QuickActionSurface, opts?: { enabled?: boolean }) {
  return useAvailableQuery<QuickActionPrefs>({ ...uiPrefsQuery(surface), enabled: opts?.enabled ?? true })
}

export function saveQuickActionsMutation(
  qc: QueryClient,
  surface: QuickActionSurface,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<QuickActionPrefs, SaveQuickActionsRequest> {
  const queryKey = [...SHARED_KEYS.quickActions, surface]
  return {
    mutationFn: async (body) => foldUnavailable(await asAvailable(() =>
      api<QuickActionPrefs>(`${QUICK_ACTIONS_PATH}?surface=${surface}`, { method: 'PUT', body: JSON.stringify(body) }))),
    // The saved picks come back in the answer: show them at once.
    onSuccess: (result) => {
      if (!result.available) return qc.invalidateQueries({ queryKey })
      qc.setQueryData<Availability<QuickActionPrefs>>(queryKey, result)
      return undefined
    },
  }
}

/** Save the picks (Customise → Save), or `{ picked: null }` for Reset to automatic. */
export function useSaveQuickActions(surface: QuickActionSurface) {
  const qc = useQueryClient()
  return useAvailableMutation(saveQuickActionsMutation(qc, surface))
}

/** Fire and forget: resolves true when the use was recorded, false otherwise. It never rejects. */
export async function recordQuickActionUse(surface: QuickActionSurface, key: string, api: ApiFetch = defaultApi): Promise<boolean> {
  try {
    await api<void>(`${QUICK_ACTIONS_PATH}/${encodeURIComponent(key)}/use?surface=${surface}`, { method: 'POST' })
    return true
  } catch {
    return false
  }
}

/**
 * One use of a tile. The counts are refreshed lazily (on the next load of the
 * page), so tiles don't reorder under the pointer right after a click.
 */
export function useRecordQuickActionUse(surface: QuickActionSurface) {
  return useMutation({ mutationFn: (key: string) => recordQuickActionUse(surface, key) })
}
