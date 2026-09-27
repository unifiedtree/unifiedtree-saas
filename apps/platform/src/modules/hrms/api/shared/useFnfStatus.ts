// Full & final settlement status for a set of people (exit lists, a profile).
//
// Contract C0 · BW-64 · owner P-PAY-EXTRA
//   GET /v1/fnf/settlements/status?employeeIds=a,b,c   → FnfStatusRow[] (one per id, same order)
//   Permission: hrms.fnf.read. Each row is the person's most recent settlement
//   (any status, CANCELLED included), or nulls when none was started.
//   Not available: until P-PAY-EXTRA adds the literal path, the request matches
//   today's /settlements/{id} and answers 400 INVALID_PARAMETER ("status" isn't
//   an id); the hook reads that as not built yet, like a 404.
// Used by: P-GROW (Resignation & exit lists), P-PROFILE (an employee's profile).
// The key sits under today's ['hrms','fnf'], so useFnf's actions refresh it.
import { SHARED_KEYS, type FnfStatusRow } from './contracts'
import { asAvailable, defaultApi, unmatchedPathParam, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const FNF_STATUS_PATH = '/v1/fnf/settlements/status'

/** The same ids in any order share one cache entry. */
export function fnfStatusIds(employeeIds: readonly string[]): string[] {
  return [...new Set(employeeIds.filter(Boolean))].sort()
}

export function fnfStatusQuery(employeeIds: readonly string[], api: ApiFetch = defaultApi): SharedQueryOptions<FnfStatusRow[]> {
  const ids = fnfStatusIds(employeeIds)
  const qs = new URLSearchParams({ employeeIds: ids.join(',') })
  return {
    queryKey: [...SHARED_KEYS.fnfStatus, ids.join(',')],
    queryFn: () => asAvailable(() => api<FnfStatusRow[]>(`${FNF_STATUS_PATH}?${qs}`), unmatchedPathParam),
  }
}

/** Nothing is fetched for an empty list. Pass `enabled: false` without hrms.fnf.read. */
export function useFnfStatus(employeeIds: readonly string[], opts?: { enabled?: boolean }) {
  return useAvailableQuery<FnfStatusRow[]>({
    ...fnfStatusQuery(employeeIds),
    enabled: (opts?.enabled ?? true) && fnfStatusIds(employeeIds).length > 0,
  })
}
