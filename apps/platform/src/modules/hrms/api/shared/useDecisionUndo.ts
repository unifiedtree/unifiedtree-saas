// Take back an approve or reject (approval Undo), one mechanism for five kinds.
//
// Contract C0 · BW-06 · owner P-TEAM (migration V143_50, hrms.approval_decisions)
//   POST /v1/leave/{id}/decision/undo
//   POST /v1/wfh/{id}/decision/undo
//   POST /v1/attendance/corrections/{id}/decision/undo
//   POST /v1/shifts/change-requests/{id}/decision/undo
//   POST /v1/expense/claims/{id}/decision/undo
//     no body   → DecisionUndoResult (the request, waiting again)
//   Permission: the same guard as that kind's decide endpoint, plus "only the
//   person who decided". The employee is told (DECISION_UNDONE).
//   Refused (422, plain-English message): after 10 minutes, once something used
//   the decision (payroll locked or paid, a reimbursement batch, the new shift
//   started, a WFH punch), or when the request changed since.
//   Not available: 404 until P-TEAM ships it, or when there is no journal row
//   for the request (decided before the journal existed); 503 FEATURE_NOT_READY
//   while the table is missing. mutate resolves { available: false }: hide Undo.
// Used by: P-TEAM, P-HOME, P-LEAVE, P-ATT-DAY, P-ATT-PLAN, P-EXP, P-DASH.
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { SHARED_KEYS, type DecisionKind, type DecisionUndoResult } from './contracts'
import { asAvailable, defaultApi, useAvailableMutation, type ApiFetch, type SharedMutationOptions } from './available'

export interface UndoDecisionVars {
  kind: DecisionKind
  requestId: string
}

const BASE: Record<DecisionKind, string> = {
  LEAVE: '/v1/leave',
  WFH: '/v1/wfh',
  CORRECTION: '/v1/attendance/corrections',
  SHIFT_CHANGE: '/v1/shifts/change-requests',
  EXPENSE: '/v1/expense/claims',
}

export function undoPath(kind: DecisionKind, requestId: string): string {
  return `${BASE[kind]}/${encodeURIComponent(requestId)}/decision/undo`
}

/**
 * What an Undo refreshes for each kind: everything its decide hook refreshes
 * (useLeaveDecision, useWfhDecision, useDecideCorrection, useDecideShiftRequest,
 * useExpenseDecision), taken as whole module prefixes because an Undo also moves
 * balances, calendars and counts.
 */
export const UNDO_REFRESH: Record<DecisionKind, readonly QueryKey[]> = {
  // Team schedule rows show approved leave (BW-22).
  LEAVE: [SHARED_KEYS.leave, SHARED_KEYS.teamSchedule],
  // The Leave page's Approvals tab lists WFH requests too.
  WFH: [SHARED_KEYS.wfh, SHARED_KEYS.leave],
  CORRECTION: [SHARED_KEYS.attendance],
  // An approved change created a shift assignment; the schedule shows it.
  SHIFT_CHANGE: [SHARED_KEYS.shifts, SHARED_KEYS.attendance, SHARED_KEYS.teamSchedule],
  EXPENSE: [SHARED_KEYS.expense],
}

/** Refreshed after every Undo attempt, whatever happened: the offers themselves. */
const OFFERS: readonly QueryKey[] = [SHARED_KEYS.recentDecisions, SHARED_KEYS.approvalsInbox]

export function decisionUndoMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<DecisionUndoResult, UndoDecisionVars> {
  return {
    mutationFn: ({ kind, requestId }) =>
      asAvailable(() => api<DecisionUndoResult>(undoPath(kind, requestId), { method: 'POST' })),
    onSuccess: (result, { kind }) => {
      if (!result.available) return undefined
      return Promise.all([...UNDO_REFRESH[kind], SHARED_KEYS.teamTimeOff].map((queryKey) => qc.invalidateQueries({ queryKey })))
    },
    // Refused, not available or done: the row's Undo offer has changed either way.
    onSettled: () => Promise.all(OFFERS.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  }
}

export function useDecisionUndo() {
  const qc = useQueryClient()
  return useAvailableMutation(decisionUndoMutation(qc))
}
