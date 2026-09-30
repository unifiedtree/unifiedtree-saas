// The caller's team: how it is chosen, its departments and its members.
//
// Contract C0 · BW-07 · owner P-TEAM
//   GET /v1/team/summary   → TeamSummary
//   Permission: anyOf attendance.team.read, hrms.leave.approve.l1. The team is
//   TeamEmployeeScope: the departments the caller heads, else their direct
//   reports; the whole company with attendance.workforce.admin; never the caller.
//   Not available: 404 until P-TEAM ships it.
// Used by: P-TEAM (Team today: label, size, people off today, probation marks),
//   P-HOME (the manager's team blocks on Home).
import { SHARED_KEYS, type TeamSummary } from './contracts'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const TEAM_SUMMARY_PATH = '/v1/team/summary'

export function teamSummaryQuery(api: ApiFetch = defaultApi): SharedQueryOptions<TeamSummary> {
  return {
    queryKey: SHARED_KEYS.teamSummary,
    queryFn: () => asAvailable(() => api<TeamSummary>(TEAM_SUMMARY_PATH)),
  }
}

/** Pass `enabled: false` for people without either permission (the API answers 403). */
export function useTeamSummary(opts?: { enabled?: boolean }) {
  return useAvailableQuery<TeamSummary>({ ...teamSummaryQuery(), enabled: opts?.enabled ?? true })
}
