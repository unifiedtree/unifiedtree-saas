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
  /** When it was approved; the next payroll run whose period ends after this pays it. */
  approvedAt?: string | null
  /** The payroll run that pays it (approved awards are paid through payroll). */
  payrollRunId?: string | null
  /** That run's month, e.g. "Sep 2026". */
  payrollPeriod?: string | null
  paidAt?: string | null
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

/** The admin table's status filter (BW-63). PROPOSED/APPROVED/PAID/REJECTED, or null for all. */
export type PliStatusFilter = PliStatus | 'ALL'

export function useAllAwards(page = 0, enabled = true, filter: PliStatusFilter = 'ALL') {
  const query = filter === 'ALL' ? '' : `&status=${filter}`
  return useQuery({
    // `page` and the filter are part of the key: without them react-query would
    // hand page 2 the cached page-1 rows and switching filters would show stale
    // data.
    queryKey: ['hrms', 'pli', 'awards', page, filter],
    queryFn: () => apiJson<Page<PliAward>>(`/v1/pli/awards?page=${page}&size=${PLI_PAGE_SIZE}${query}`),
    staleTime: 15_000,
    enabled,
  })
}

export interface PliBucket { count: number; amount: number }

/** All awards: proposed / approved to be paid / paid / paid this FY (BW-63). */
export interface PliAwardsSummary {
  total: number
  proposed: PliBucket
  approved: PliBucket
  paid: PliBucket
  paidThisFinancialYear: PliBucket
  rejected: number
  financialYear: string
  financialYearStart: string
  financialYearEnd: string
}

export function usePliAwardsSummary(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'awards', 'summary'],
    queryFn: () => apiJson<PliAwardsSummary>('/v1/pli/awards/summary'),
    enabled,
    staleTime: 30_000,
  })
}

/** The signed-in person's awards summary (BW-63). */
export interface MyPliAwardsSummary {
  proposedForYou: PliBucket
  waiting: PliBucket
  approved: PliBucket
  paid: PliBucket
  rejected: number
}

export function useMyPliSummary(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'pli', 'my', 'summary'],
    queryFn: () => apiJson<MyPliAwardsSummary>('/v1/pli/my/summary'),
    enabled,
    staleTime: 30_000,
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
