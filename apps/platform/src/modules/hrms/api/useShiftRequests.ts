import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface ShiftRequest {
  id: string
  employeeId: string
  currentShiftPolicyId?: string
  currentShiftName?: string
  requestedShiftPolicyId: string
  requestedShiftName?: string
  reason?: string
  status: string
  createdAt: string
  decisionNote?: string
}

export function usePendingShiftRequests() {
  return useQuery({
    queryKey: ['shifts', 'requests', 'pending'],
    queryFn: () => apiJson<ShiftRequest[]>('/v1/shifts/change-requests/pending'),
    refetchInterval: 30_000,
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
