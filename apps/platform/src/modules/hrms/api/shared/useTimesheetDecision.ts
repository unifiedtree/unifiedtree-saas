// Approve or reject a submitted timesheet week.
//
// Contract C0 · BW-36 · owner P-ATT-DAY (migration V143_65, hrms.timesheet_weeks;
// permission hrms.timesheet.approve), in a new controller (not TimeEntryController).
//   POST /v1/timesheets/weeks/{id}/decision  { status: 'APPROVED' | 'REJECTED', comment? }   → TimesheetWeek
//   Permission: @perm.check('hrms.timesheet.approve') (OWNER, SUPER_ADMIN,
//   HR_MANAGER, DEPT_MANAGER) + the person is in the caller's team scope. Only a
//   SUBMITTED week can be decided; the employee is told (TIMESHEET_DECIDED).
//   An approved week stays locked; a rejected one opens for edits again.
//   Not available: 404 until P-ATT-DAY ships it; 503 FEATURE_NOT_READY while the
//   table is missing (the timesheet rows don't appear then).
// Used by: P-ATT-DAY (the Timesheet tab for approvers), P-TEAM (timesheet rows
//   under Approvals › Requests).
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { SHARED_KEYS, type TimesheetDecisionRequest, type TimesheetWeek } from './contracts'
import { asAvailable, defaultApi, useAvailableMutation, type ApiFetch, type SharedMutationOptions } from './available'

export type TimesheetDecisionVars = TimesheetDecisionRequest & { weekId: string }

export function timesheetDecisionPath(weekId: string): string {
  return `/v1/timesheets/weeks/${encodeURIComponent(weekId)}/decision`
}

/** Timesheet weeks and approvals (P-ATT-DAY keeps them under ['timesheets', …]), time entries (locked or not), and the inbox. */
const AFTER_DECISION: readonly QueryKey[] = [SHARED_KEYS.timesheets, SHARED_KEYS.timeEntries, SHARED_KEYS.approvalsInbox]

export function timesheetDecisionMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<TimesheetWeek, TimesheetDecisionVars> {
  return {
    mutationFn: ({ weekId, status, comment }) =>
      asAvailable(() => api<TimesheetWeek>(timesheetDecisionPath(weekId), {
        method: 'POST',
        body: JSON.stringify({ status, ...(comment ? { comment } : {}) }),
      })),
    onSuccess: (result) =>
      result.available ? Promise.all(AFTER_DECISION.map((queryKey) => qc.invalidateQueries({ queryKey }))) : undefined,
  }
}

export function useTimesheetDecision() {
  const qc = useQueryClient()
  return useAvailableMutation(timesheetDecisionMutation(qc))
}
