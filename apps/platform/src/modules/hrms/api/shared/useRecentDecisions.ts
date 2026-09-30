// Decisions you made that you can still take back (approval Undo).
//
// Contract C0 · BW-06 · owner P-TEAM (migration V143_50, hrms.approval_decisions)
//   GET /v1/approvals/recent-decisions   → RecentDecision[]
//   Permission: isAuthenticated(). Only the caller's own decisions that are not
//   undone yet and whose undoUntil is still ahead; newest first.
//   Not available: 404 until P-TEAM ships it; 503 FEATURE_NOT_READY while the
//   journal table is missing. Decisions still work as today; just offer no Undo.
// Used by: P-TEAM (Approvals, Team today), P-HOME (manager's "Waiting for you"),
//   and the approval pages of P-LEAVE, P-ATT-DAY, P-ATT-PLAN, P-EXP, P-DASH, so a
//   decided row keeps its Undo after a reload. Show Undo only while
//   Date.now() < Date.parse(undoUntil).
import { SHARED_KEYS, type RecentDecision } from './contracts'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const RECENT_DECISIONS_PATH = '/v1/approvals/recent-decisions'

export function recentDecisionsQuery(api: ApiFetch = defaultApi): SharedQueryOptions<RecentDecision[]> {
  return {
    queryKey: SHARED_KEYS.recentDecisions,
    queryFn: () => asAvailable(() => api<RecentDecision[]>(RECENT_DECISIONS_PATH)),
  }
}

export function useRecentDecisions(opts?: { enabled?: boolean }) {
  return useAvailableQuery<RecentDecision[]>({ ...recentDecisionsQuery(), enabled: opts?.enabled ?? true })
}
