// Workforce figures from the server: counts by status, joiners and leavers, attrition, a trend.
//
// Contract C0 · BW-90 · owner P-WF-PEOPLE
//   GET /v1/hrms/employees/stats?companyId=   → EmployeeStats   (companyId optional: every company)
//   Permission: hrms.employee.read; attritionPercent only with
//   hrms.report.attrition (null otherwise). JDBC over hrms.employees and
//   hrms.employee_status_history. Today's GET /v1/hrms/employees/counts stays as it is.
//   Not available: until P-WF-PEOPLE adds the literal path, the request matches
//   today's /employees/{id} and answers 400 INVALID_PARAMETER ("stats" isn't an
//   id); the hook reads that as not built yet, like a 404. Pages then keep
//   today's browser counts.
// Used by: P-WF-SETUP (Master overview), P-GROW (Resignation & exit),
//   P-WF-PEOPLE (the directory's status pills; builds the endpoint).
// The key sits under today's ['hrms','employee-counts'], so every employee change refreshes it.
import { SHARED_KEYS, type EmployeeStats } from './contracts'
import { asAvailable, defaultApi, unmatchedPathParam, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const EMPLOYEE_STATS_PATH = '/v1/hrms/employees/stats'

export function employeeStatsQuery(companyId?: string | null, api: ApiFetch = defaultApi): SharedQueryOptions<EmployeeStats> {
  const path = companyId ? `${EMPLOYEE_STATS_PATH}?${new URLSearchParams({ companyId })}` : EMPLOYEE_STATS_PATH
  return {
    queryKey: [...SHARED_KEYS.employeeStats, companyId ?? null],
    queryFn: () => asAvailable(() => api<EmployeeStats>(path), unmatchedPathParam),
  }
}

/** Pass `enabled: false` for people without hrms.employee.read (the API answers 403). */
export function useEmployeeStats(companyId?: string | null, opts?: { enabled?: boolean }) {
  return useAvailableQuery<EmployeeStats>({ ...employeeStatsQuery(companyId), enabled: opts?.enabled ?? true })
}
