import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.fnf.enums
export type FnfStatus = 'INITIATED' | 'PROCESSED' | 'APPROVED' | 'PAID'
export type FnfComponentType = 'EARNING' | 'DEDUCTION'

export interface FnfComponent {
  id?: string
  label: string
  type: FnfComponentType
  amount: number
}

export interface FnfSettlement {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  companyId: string
  lastWorkingDay: string
  status: FnfStatus
  grossPayable: number
  totalDeductions: number
  netSettlement: number
  notes?: string
  processedAt?: string
  approvedAt?: string
  paidAt?: string
  approverId?: string
  createdAt: string
  components?: FnfComponent[]
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

// ── Settlements ──────────────────────────────────────────────────────────────

/**
 * Rows per page for the settlements ledger. Exported so the pager's
 * "Showing 1–20 of N" is computed from the size we actually request — a literal
 * at the call site would silently start lying the day this number changes.
 * FnfController declares @PageableDefault(size = 20) on GET /settlements.
 */
export const FNF_PAGE_SIZE = 20

export function useFnfSettlements(page = 0) {
  return useQuery({
    // `page` is part of the key: without it react-query would hand page 2 the
    // cached page-1 rows and the table would never appear to advance.
    queryKey: ['hrms', 'fnf', 'settlements', page],
    queryFn: () => apiJson<Page<FnfSettlement>>(`/v1/fnf/settlements?page=${page}&size=${FNF_PAGE_SIZE}`),
    staleTime: 15_000,
  })
}

export function useFnfSettlement(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'fnf', 'settlement', id],
    queryFn: () => apiJson<FnfSettlement>(`/v1/fnf/settlements/${id}`),
    enabled: !!id,
  })
}

export interface ProcessSettlementPayload {
  employeeId: string
  companyId?: string
  lastWorkingDay: string
  notes?: string
  components: Array<Omit<FnfComponent, 'id'>>
}

export function useProcessSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProcessSettlementPayload) =>
      apiJson<FnfSettlement>('/v1/fnf/settlements', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'fnf'] }),
  })
}

export function useApproveSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<FnfSettlement>(`/v1/fnf/settlements/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'fnf'] }),
  })
}

export function usePaySettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<FnfSettlement>(`/v1/fnf/settlements/${id}/pay`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'fnf'] }),
  })
}
