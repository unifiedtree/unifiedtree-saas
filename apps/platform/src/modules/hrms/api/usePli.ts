import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.pli.enums.PliStatus (@Enumerated(STRING)).
export type PliStatus = 'PROPOSED' | 'APPROVED' | 'PAID' | 'REJECTED'

export interface PliAward {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  companyId: string
  planName: string
  period?: string
  amount: number
  ratingBasis?: number | null
  status: PliStatus
  notes?: string
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

// ── Awards (admin) ───────────────────────────────────────────────────────────

export function useAllAwards(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'awards', page],
    queryFn: () => apiJson<Page<PliAward>>(`/v1/pli/awards?page=${page}&size=20`),
    staleTime: 15_000,
    enabled,
  })
}

export function useMyIncentives(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'my', page],
    queryFn: () => apiJson<Page<PliAward>>(`/v1/pli/my?page=${page}&size=20`),
    staleTime: 30_000,
    enabled,
  })
}

export interface CreateAwardPayload {
  employeeId: string
  companyId?: string
  planName: string
  period?: string
  amount: number
  ratingBasis?: number | null
  notes?: string
}

export function useCreateAward() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAwardPayload) =>
      apiJson<PliAward>('/v1/pli/awards', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'pli'] }),
  })
}

export function usePliDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      apiJson<PliAward>(`/v1/pli/awards/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'pli'] }),
  })
}

export function usePayAward() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<PliAward>(`/v1/pli/awards/${id}/pay`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'pli'] }),
  })
}
