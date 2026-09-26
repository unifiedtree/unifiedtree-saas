import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface ShiftRequest {
  id: string
  employeeId: string
  /** The requester, straight from their employee record. */
  employeeName?: string | null
  employeeCode?: string | null
  currentShiftPolicyId?: string
  currentShiftName?: string
  requestedShiftPolicyId: string
  requestedShiftName?: string
  reason?: string
  status: string
  createdAt: string
  decisionNote?: string
  /** Start date the employee asked for (yyyy-MM-dd); null on requests from older app builds. */
  requestedEffectiveDate?: string | null
  /** Date the new shift starts (yyyy-MM-dd); set on approval. */
  appliedEffectiveDate?: string | null
  /** When it was approved or rejected. */
  decidedAt?: string | null
  /** Who decided it; null while pending and for requests that expired on their own. */
  approverName?: string | null
}

export function usePendingShiftRequests(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['shifts', 'requests', 'pending'],
    queryFn: () => apiJson<ShiftRequest[]>('/v1/shifts/change-requests/pending'),
    refetchInterval: 30_000,
    // The endpoint needs attendance.regularization.approve; callers that
    // render for everyone pass enabled:false for people without it.
    enabled: opts?.enabled ?? true,
  })
}

/**
 * Requests approved or rejected in the last `days` days, newest decision first
 * (GET /v1/shifts/change-requests/decided). Same permission as the pending list;
 * a manager gets their own team's only.
 */
export function useDecidedShiftRequests(days = 30, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['shifts', 'requests', 'decided', days],
    queryFn: () => apiJson<ShiftRequest[]>(`/v1/shifts/change-requests/decided?days=${days}`),
    enabled: opts?.enabled ?? true,
  })
}

export function useDecideShiftRequest() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved, comment }: { id: string; approved: boolean; comment?: string }) =>
      apiJson<ShiftRequest>(`/v1/shifts/change-requests/${id}/decision`, {
        method: 'POST', body: JSON.stringify({ approved, comment }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['shifts'] }),
        client.invalidateQueries({ queryKey: ['hrms', 'attendance'] }),
      ])
    },
  })
}
