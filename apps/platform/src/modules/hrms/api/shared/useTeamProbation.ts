// Probation for managers: see the team's end dates; Confirm or Extend with the permission.
//
// Contract C0 · BW-11 · owner P-TEAM (permission hrms.probation.team.decide in V143_55)
//   GET  /v1/team/probation?days=30                        → TeamProbationRow[]
//        Permission: attendance.team.read; team scope. People whose probation
//        ends within `days`, plus every overdue one; soonest first.
//   POST /v1/team/probation/{employeeId}/confirm  { confirmationDate? }   → TeamProbationDecision
//   POST /v1/team/probation/{employeeId}/extend   { newEndDate, note? }   → TeamProbationDecision
//        Permission: @perm.check('hrms.probation.team.decide') (OWNER and
//        SUPER_ADMIN only by default, DECISIONS 15) + the person is in the
//        caller's team. Reuses today's probation service; HR and the employee
//        are told (PROBATION_TEAM_DECISION); audited. Show the buttons only
//        with P.HRMS_PROBATION_TEAM_DECIDE. The stored auto-extend setting stays
//        inactive: never say probation "extends on its own".
//   Not available: 404 until P-TEAM ships it.
// Used by: P-TEAM (Team today's probation card), P-HOME (the manager's Home and
//   its "Needs you").
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  SHARED_KEYS, type ConfirmProbationRequest, type ExtendProbationRequest, type TeamProbationDecision, type TeamProbationRow,
} from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const TEAM_PROBATION_PATH = '/v1/team/probation'

export function teamProbationQuery(days = 30, api: ApiFetch = defaultApi): SharedQueryOptions<TeamProbationRow[]> {
  return {
    queryKey: [...SHARED_KEYS.teamProbation, days],
    queryFn: () => asAvailable(() => api<TeamProbationRow[]>(`${TEAM_PROBATION_PATH}?days=${days}`)),
  }
}

export function useTeamProbation(days = 30, opts?: { enabled?: boolean }) {
  return useAvailableQuery<TeamProbationRow[]>({ ...teamProbationQuery(days), enabled: opts?.enabled ?? true })
}

export type ConfirmProbationVars = ConfirmProbationRequest & { employeeId: string }
export type ExtendProbationVars = ExtendProbationRequest & { employeeId: string }

/** Everything that shows this person's probation or status. */
function refreshAfterDecision(qc: QueryClient, employeeId: string) {
  const keys: QueryKey[] = [
    SHARED_KEYS.teamProbation,
    SHARED_KEYS.teamSummary,
    SHARED_KEYS.probation,
    [...SHARED_KEYS.employee, employeeId],
    SHARED_KEYS.employees,
    SHARED_KEYS.employeeCounts,
  ]
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

function decide(action: 'confirm' | 'extend', employeeId: string, body: object, api: ApiFetch) {
  return api<TeamProbationDecision>(`${TEAM_PROBATION_PATH}/${encodeURIComponent(employeeId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function confirmProbationMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<TeamProbationDecision, ConfirmProbationVars> {
  return {
    mutationFn: ({ employeeId, ...body }) => asAvailable(() => decide('confirm', employeeId, body, api)),
    onSuccess: (result, { employeeId }) => (result.available ? refreshAfterDecision(qc, employeeId) : undefined),
  }
}

export function extendProbationMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<TeamProbationDecision, ExtendProbationVars> {
  return {
    mutationFn: ({ employeeId, ...body }) => asAvailable(() => decide('extend', employeeId, body, api)),
    onSuccess: (result, { employeeId }) => (result.available ? refreshAfterDecision(qc, employeeId) : undefined),
  }
}

export function useConfirmTeamProbation() {
  const qc = useQueryClient()
  return useAvailableMutation(confirmProbationMutation(qc))
}

export function useExtendTeamProbation() {
  const qc = useQueryClient()
  return useAvailableMutation(extendProbationMutation(qc))
}
