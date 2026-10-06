// Workforce analytics' breakdowns and joiners. New endpoints: until the backend
// that has them is live they answer 404, which these hooks turn into
// `notAvailable` (the block is left out, never an error).
import { apiJson } from '@/core/api/client'
import { asAvailable, useAvailableQuery } from './shared/available'
import type { HeadcountBreakdown, JoinersMonth } from '@/modules/hrms/analytics/workforceModel'

/** GET /v1/reports/headcount/breakdown (hrms.report.headcount). */
export function useHeadcountBreakdown(companyId: string | null, asOf: string, opts?: { enabled?: boolean }) {
  return useAvailableQuery<HeadcountBreakdown>({
    queryKey: ['hrms', 'reports', 'headcount-breakdown', companyId, asOf],
    queryFn: () => asAvailable(() => apiJson<HeadcountBreakdown>(`/v1/reports/headcount/breakdown?${new URLSearchParams({ companyId: companyId!, asOf })}`)),
    enabled: !!companyId && !!asOf && (opts?.enabled ?? true),
    staleTime: 60_000,
  })
}

/** GET /v1/reports/attrition/joiners (hrms.report.attrition). */
export function useJoiners(companyId: string | null, from: string, to: string, opts?: { enabled?: boolean }) {
  return useAvailableQuery<JoinersMonth[]>({
    queryKey: ['hrms', 'reports', 'joiners', companyId, from, to],
    queryFn: () => asAvailable(() => apiJson<JoinersMonth[]>(`/v1/reports/attrition/joiners?${new URLSearchParams({ companyId: companyId!, from, to })}`)),
    enabled: !!companyId && !!from && !!to && (opts?.enabled ?? true),
    staleTime: 60_000,
  })
}
