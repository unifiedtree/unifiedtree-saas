// The team's leave and work from home in a date range, approved and waiting.
//
// Contract C0 · BW-08 · owner P-TEAM
//   GET /v1/team/time-off?from=yyyy-MM-dd&to=yyyy-MM-dd   → TeamTimeOffEntry[]
//   Permission: anyOf attendance.team.read, hrms.leave.approve.l1, wfh.approve;
//   team scope (TeamEmployeeScope). At most 62 days (a longer range is a 400).
//   Each row carries its request id, kind and canDecide, so a waiting cell can
//   open that request in Approvals.
//   Not available: 404 until P-TEAM ships it.
// Used by: P-TEAM (Team schedule overlays, "Out soon", Approvals facts),
//   P-HOME (the manager's Home).
import { SHARED_KEYS, type IsoDate, type TeamTimeOffEntry } from './contracts'
import { asAvailable, daysInclusive, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const TEAM_TIME_OFF_PATH = '/v1/team/time-off'
export const TEAM_TIME_OFF_MAX_DAYS = 62

export function teamTimeOffQuery(from: IsoDate, to: IsoDate, api: ApiFetch = defaultApi): SharedQueryOptions<TeamTimeOffEntry[]> {
  const qs = new URLSearchParams({ from, to })
  return {
    queryKey: [...SHARED_KEYS.teamTimeOff, from, to],
    queryFn: () => asAvailable(() => api<TeamTimeOffEntry[]>(`${TEAM_TIME_OFF_PATH}?${qs}`)),
  }
}

/** True for a range the endpoint accepts: both days set, `from` not after `to`, at most 62 days. */
export function isTeamTimeOffRange(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to) return false
  const days = daysInclusive(from, to)
  return days >= 1 && days <= TEAM_TIME_OFF_MAX_DAYS
}

/** Nothing is fetched until the range is valid (see isTeamTimeOffRange). */
export function useTeamTimeOff(from: IsoDate | undefined, to: IsoDate | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<TeamTimeOffEntry[]>({
    ...teamTimeOffQuery(from ?? '', to ?? ''),
    enabled: (opts?.enabled ?? true) && isTeamTimeOffRange(from, to),
  })
}
