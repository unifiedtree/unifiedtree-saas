// Apply for leave in another employee's name.
//
// Contract C0 · BW-43 · owner P-LEAVE (permission hrms.leave.apply.others in V143_56)
//   POST /v1/leave/apply/for/{employeeId}  { leaveTypeId, startDate, endDate, duration, reason? }
//                                           → 201 LeaveRequestResponse
//   The same body, validation and approver chain as POST /v1/leave/apply; the
//   request is filed under the employee's own company. Permission:
//   @perm.check('hrms.leave.apply.others') (OWNER, SUPER_ADMIN, ADMIN,
//   HR_MANAGER, FINANCE_LEAD). Who raised it is audited and shown to the
//   employee, who is told (LEAVE_APPLIED_ON_BEHALF). Leave beyond the balance is
//   refused, as today (422 with the real reason).
//   Not available: 404 until P-LEAVE ships it (hide "Apply leave on behalf").
// Used by: P-ATT-DAY (Daily Logs "Mark leave"), P-PROFILE (an employee's profile).
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { SHARED_KEYS, type ApplyLeaveForRequest, type LeaveRequestResponse } from './contracts'
import { asAvailable, defaultApi, useAvailableMutation, type ApiFetch, type SharedMutationOptions } from './available'

export type ApplyLeaveOnBehalfVars = ApplyLeaveForRequest & { employeeId: string }

export function applyLeaveOnBehalfPath(employeeId: string): string {
  return `/v1/leave/apply/for/${encodeURIComponent(employeeId)}`
}

/** Their balances, lists, calendar and counts; the approvers' queues and inbox; team time off. */
const AFTER_APPLY: readonly QueryKey[] = [SHARED_KEYS.leave, SHARED_KEYS.approvalsInbox, SHARED_KEYS.teamTimeOff, SHARED_KEYS.teamSchedule]

export function applyLeaveOnBehalfMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<LeaveRequestResponse, ApplyLeaveOnBehalfVars> {
  return {
    mutationFn: ({ employeeId, ...body }) =>
      asAvailable(() => api<LeaveRequestResponse>(applyLeaveOnBehalfPath(employeeId), { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: (result) =>
      result.available ? Promise.all(AFTER_APPLY.map((queryKey) => qc.invalidateQueries({ queryKey }))) : undefined,
  }
}

export function useApplyLeaveOnBehalf() {
  const qc = useQueryClient()
  return useAvailableMutation(applyLeaveOnBehalfMutation(qc))
}
