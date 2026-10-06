// The Approvals inbox: every request waiting for the caller, one list.
//
// Contract C0 · BW-09 · owner P-TEAM
//   GET /v1/team/approvals?kind=all|leave|attendance|requests|expenses&page=0&size=20   → ApprovalsInbox
//   Kinds: Leave · Attendance (fixes) · Requests (work from home, shift change,
//   and submitted timesheet weeks once BW-36 is in) · Expenses (SUBMITTED only).
//   Permission: each kind only with its list permission and exactly that list's
//   scope (hrms.leave.approve.l1; attendance.regularization.approve; wfh.approve;
//   hrms.expense.claim.approve; hrms.timesheet.approve). Rows the caller can see
//   but not decide come back with canDecide=false (ApproverScopeGuard is not
//   widened); the caller's own requests are left out.
//   Decisions still go through each kind's decide endpoint (and Undo through
//   useDecisionUndo); those hooks refresh SHARED_KEYS.approvalsInbox.
//   Not available: 404 until P-TEAM ships it. A kind whose source fails or isn't
//   switched on is listed in `unavailable`; the rest still loads.
// Used by: P-TEAM (Approvals, Team today's "Waiting for you"), P-HOME (the
//   manager's "Waiting for you" on Home).
import { SHARED_KEYS, type ApprovalsInbox, type InboxTab } from './contracts'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const APPROVALS_INBOX_PATH = '/v1/team/approvals'

export interface InboxParams {
  /** Default 'all'. */
  tab?: InboxTab
  /** 0-based; default 0. */
  page?: number
  /** Default 20. */
  size?: number
  /** Also list leave a manager approved that waits for HR (kind LEAVE_L2, for hrms.leave.approve.l2). Default false. */
  includeL2?: boolean
}

export function approvalsInboxQuery(params: InboxParams = {}, api: ApiFetch = defaultApi): SharedQueryOptions<ApprovalsInbox> {
  const tab = params.tab ?? 'all'
  const page = params.page ?? 0
  const size = params.size ?? 20
  const qs = new URLSearchParams({ kind: tab, page: String(page), size: String(size) })
  if (params.includeL2) qs.set('includeL2', 'true')
  return {
    queryKey: params.includeL2 ? [...SHARED_KEYS.approvalsInbox, tab, page, size, 'l2'] : [...SHARED_KEYS.approvalsInbox, tab, page, size],
    queryFn: () => asAvailable(() => api<ApprovalsInbox>(`${APPROVALS_INBOX_PATH}?${qs}`)),
  }
}

export function useApprovalsInbox(params: InboxParams = {}, opts?: { enabled?: boolean }) {
  return useAvailableQuery<ApprovalsInbox>({
    ...approvalsInboxQuery(params),
    enabled: opts?.enabled ?? true,
    // Like today's approval queues (useLeave, useWfh, useShiftRequests): a
    // request raised on the phone shows up without a reload.
    refetchInterval: 30_000,
  })
}
