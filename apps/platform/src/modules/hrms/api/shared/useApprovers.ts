// Who a request of mine would go to, before I send it ("Send to Siddharth Rao").
//
// Contract C0 · BW-122 · owner P-HOME
//   GET /v1/me/approvers?for=leave|wfh|correction|shift   → ApproverPreview
//   Permission: isAuthenticated(); always the caller's own chain.
//   The chain is the one LeaveController.apply and WfhController.apply use:
//   reporting manager → department head → HR manager → admin, then any active
//   delegation. Fixes and shift changes are decided by anyone with
//   attendance.regularization.approve in scope, so for them it is the name
//   their notification goes to. approver is null when nobody can be found.
//   Not available: 404 until P-HOME ships it (the panels then just don't name anyone).
// Used by: P-ATT-DAY (fix-a-day panel), P-HOME (work from home and shift change
//   panels), P-LEAVE (the apply panel, if it doesn't take the approver from BW-48).
import { SHARED_KEYS, type ApproverFor, type ApproverPreview } from './contracts'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const APPROVERS_PATH = '/v1/me/approvers'

export function approversQuery(kind: ApproverFor, api: ApiFetch = defaultApi): SharedQueryOptions<ApproverPreview> {
  return {
    queryKey: [...SHARED_KEYS.approvers, kind],
    queryFn: () => asAvailable(() => api<ApproverPreview>(`${APPROVERS_PATH}?for=${kind}`)),
  }
}

export function useApprovers(kind: ApproverFor, opts?: { enabled?: boolean }) {
  return useAvailableQuery<ApproverPreview>({ ...approversQuery(kind), enabled: opts?.enabled ?? true, staleTime: 60_000 })
}
