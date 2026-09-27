// A company's overtime rules: when extra time starts to count, and a monthly cap.
//
// Contract C0 · BW-29 · owner P-ATT-PLAN (migration V143_54, attendance.overtime_rules)
//   GET /v1/attendance/overtime-rules?companyId=   → OvertimeRules
//       Permission: attendance.team.read.
//   PUT /v1/attendance/overtime-rules?companyId=  { countsAfterMinutes, monthlyCapMinutes }   → OvertimeRules
//       Permission: attendance.policy.manage.
//   No row gives nulls, which is today's behaviour exactly. The Overtime list
//   and its approve/reject apply the rules (minutes count only past
//   countsAfter; approval stops at the cap). Stored overtime minutes and work
//   hours never change, and overtime is still recorded, not paid.
//   Not available: 404 until P-ATT-PLAN ships it; 503 FEATURE_NOT_READY while
//   the table is missing (hide the card and the HR configuration section).
// Used by: P-ATT-PLAN (read-only card on Shifts & Overtime › Overtime),
//   P-SETUP (the Overtime rules section in HR configuration).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { SHARED_KEYS, type OvertimeRules, type SaveOvertimeRulesRequest } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const OVERTIME_RULES_PATH = '/v1/attendance/overtime-rules'

export function overtimeRulesQuery(companyId: string, api: ApiFetch = defaultApi): SharedQueryOptions<OvertimeRules> {
  const qs = new URLSearchParams({ companyId })
  return {
    queryKey: [...SHARED_KEYS.overtimeRules, companyId],
    queryFn: () => asAvailable(() => api<OvertimeRules>(`${OVERTIME_RULES_PATH}?${qs}`)),
  }
}

export function useOvertimeRules(companyId: string | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<OvertimeRules>({
    ...overtimeRulesQuery(companyId ?? ''),
    enabled: (opts?.enabled ?? true) && !!companyId,
  })
}

export function saveOvertimeRulesMutation(
  qc: QueryClient,
  companyId: string,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<OvertimeRules, SaveOvertimeRulesRequest> {
  const qs = new URLSearchParams({ companyId })
  const queryKey = [...SHARED_KEYS.overtimeRules, companyId]
  return {
    mutationFn: (body) =>
      asAvailable(() => api<OvertimeRules>(`${OVERTIME_RULES_PATH}?${qs}`, { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: (result) => {
      if (!result.available) return qc.invalidateQueries({ queryKey })
      qc.setQueryData<Availability<OvertimeRules>>(queryKey, result)
      // The Overtime list applies the rules, so its rows can change.
      return qc.invalidateQueries({ queryKey: SHARED_KEYS.overtime })
    },
  }
}

export function useSaveOvertimeRules(companyId: string) {
  const qc = useQueryClient()
  return useAvailableMutation(saveOvertimeRulesMutation(qc, companyId))
}
