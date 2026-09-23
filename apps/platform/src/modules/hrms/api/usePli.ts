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

/**
 * Rows per page for both award lists. Exported so the pager's "Showing 1–20 of
 * N" is computed from the size we actually request — a literal at the call site
 * would silently start lying the day this number changes. PliController
 * declares @PageableDefault(size = 20) for /awards and /my.
 */
export const PLI_PAGE_SIZE = 20

export function useAllAwards(page = 0, enabled = true) {
  return useQuery({
    // `page` is part of the key: without it react-query would hand page 2 the
    // cached page-1 rows and the table would never appear to advance.
    queryKey: ['hrms', 'pli', 'awards', page],
    queryFn: () => apiJson<Page<PliAward>>(`/v1/pli/awards?page=${page}&size=${PLI_PAGE_SIZE}`),
    staleTime: 15_000,
    enabled,
  })
}

export function useMyIncentives(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'my', page],
    queryFn: () => apiJson<Page<PliAward>>(`/v1/pli/my?page=${page}&size=${PLI_PAGE_SIZE}`),
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


export interface PliTarget {
  id: string
  companyId: string
  title: string
  ownerType: string
  ownerId?: string
  period: string
  metric: string
  targetValue: number
  actualValue: number
  weightPercent: number
  payoutAmount: number
  status: string
  notes?: string
  createdAt: string
}

export interface PliTargetPayload {
  companyId?: string
  title: string
  ownerType?: string
  ownerId?: string
  period: string
  metric: string
  targetValue: number
  actualValue?: number
  weightPercent?: number
  payoutAmount?: number
  status?: string
  notes?: string
}

export function usePliTargets(page = 0, companyId?: string) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'targets', page, companyId ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(PLI_PAGE_SIZE) })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<PliTarget>>(`/v1/pli/targets?${params.toString()}`)
    },
    staleTime: 30_000,
  })
}

export function useCreatePliTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PliTargetPayload) => apiJson<PliTarget>('/v1/pli/targets', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'pli', 'targets'] }),
  })
}
