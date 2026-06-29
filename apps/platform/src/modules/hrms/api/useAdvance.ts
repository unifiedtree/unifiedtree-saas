import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.advance.enums
export type AdvanceStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'DISBURSED' | 'CLOSED'

export interface AdvanceRequest {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  companyId: string
  amount: number
  reason?: string
  repaymentMonths: number
  monthlyDeduction: number
  status: AdvanceStatus
  approverId?: string
  approvedAt?: string
  approverComment?: string
  disbursedAt?: string
  outstandingAmount: number
  createdAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export const inr = (n?: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// ── Requests ─────────────────────────────────────────────────────────────────

export function useMyAdvances(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'my', page],
    queryFn: () => apiJson<Page<AdvanceRequest>>(`/v1/advance/my?page=${page}&size=20`),
    staleTime: 30_000,
  })
}

export function useAdvance(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'request', id],
    queryFn: () => apiJson<AdvanceRequest>(`/v1/advance/requests/${id}`),
    enabled: !!id,
  })
}

export function usePendingAdvanceApprovals(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'approvals', page],
    queryFn: () => apiJson<Page<AdvanceRequest>>(`/v1/advance/requests/approvals?page=${page}&size=20`),
    staleTime: 15_000,
    enabled,
  })
}

export interface RequestAdvancePayload {
  amount: number
  reason?: string
  repaymentMonths: number
}

export function useRequestAdvance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RequestAdvancePayload) =>
      apiJson<AdvanceRequest>('/v1/advance/requests', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'advance'] }),
  })
}

export function useAdvanceDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved, comment }: { id: string; approved: boolean; comment?: string }) =>
      apiJson<AdvanceRequest>(`/v1/advance/requests/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approved, comment }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'advance'] }),
  })
}

export function useDisburseAdvance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<AdvanceRequest>(`/v1/advance/requests/${id}/disburse`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'advance'] }),
  })
}
