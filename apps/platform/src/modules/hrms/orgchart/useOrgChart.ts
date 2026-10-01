// The org chart's data: GET /v1/hrms/org-chart (P-ORG).
//   Permission: signed in (isAuthenticated). What comes back depends on the caller:
//     hrms.employee.read → scope COMPANY: everyone active in one company (?companyId, else their own)
//     anyone else        → scope TEAM: their line up to the top, themself, and everyone below them
//   Cards carry public fields only. `status` is set only where the viewer may
//   already open that person's record (`canViewRecord`).
//   Not available (404, or 503 FEATURE_NOT_READY) → `notAvailable`, never retried.
// The key sits under ['hrms', 'employees'], so any employee change (a new
// manager, an exit) refreshes the chart too.
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from '../api/shared/available'

export const ORG_CHART_PATH = '/v1/hrms/org-chart'

export interface OrgPerson {
  id: string
  name: string
  designation: string | null
  department: string | null
  /** The branch they work from. */
  location: string | null
  photoUrl: string | null
  /** ACTIVE, PROBATION, NOTICE_PERIOD or SUSPENDED; null where the viewer may not see it. */
  status: string | null
  /** The person drawn above (null: top level). */
  parentId: string | null
  /** Active people who report to them (wherever they work). */
  directReports: number
  /** Team view only: how they relate to the viewer. */
  relation: 'SELF' | 'ABOVE' | 'BELOW' | null
  /** Why someone with a manager on record sits at the top level. */
  note: 'MANAGER_NOT_SHOWN' | 'CYCLE' | null
  /** The viewer may open their employee record. */
  canViewRecord: boolean
}

export interface OrgChartData {
  scope: 'COMPANY' | 'TEAM'
  companyId: string | null
  companyName: string | null
  viewerEmployeeId: string | null
  /** More people than one chart shows (10,000); the rest are left out. */
  truncated: boolean
  /** Parents before their reports. */
  people: OrgPerson[]
}

export const orgChartKey = (companyId: string | null | undefined) => ['hrms', 'employees', 'org-chart', companyId || 'own'] as const

export function orgChartQuery(companyId?: string | null, api: ApiFetch = defaultApi): SharedQueryOptions<OrgChartData> {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
  return {
    queryKey: orgChartKey(companyId),
    queryFn: () => asAvailable(() => api<OrgChartData>(ORG_CHART_PATH + qs)),
  }
}

/** The chart for this company (people with hrms.employee.read), or the caller's own line (everyone else; companyId is ignored). */
export function useOrgChart(companyId?: string | null, opts?: { enabled?: boolean }) {
  return useAvailableQuery<OrgChartData>({ ...orgChartQuery(companyId), enabled: opts?.enabled ?? true, staleTime: 60_000 })
}
