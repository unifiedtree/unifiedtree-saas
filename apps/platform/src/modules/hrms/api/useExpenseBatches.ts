import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { ExpenseStatus } from './useExpense'

export type ExpenseBatchStatus = 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED'
export interface ExpenseBatch {
  id: string
  companyId: string
  batchReference: string
  cutoffDate: string
  totalAmount: number
  currency?: string | null
  claimCount: number
  status: ExpenseBatchStatus
  postedAt?: string
  paidAt?: string
  paymentReference?: string
  notes?: string
  createdAt: string
  updatedAt: string
}
export interface ExpenseBatchItem {
  id: string
  claimId: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  amount: number
  currency?: string
  claimTitle: string
  claimNotes?: string
  claimStatus: ExpenseStatus
}
export interface ExpenseBatchDetail { batch: ExpenseBatch; items: ExpenseBatchItem[] }
const route = '/v1/expense/reimbursement-batches'

export function useExpenseBatches(companyId?: string, status?: string) {
  const params = new URLSearchParams()
  if (companyId) params.set('companyId', companyId)
  if (status) params.set('status', status)
  return useQuery({ queryKey: ['hrms', 'expense', 'batches', companyId, status], queryFn: () => apiJson<ExpenseBatch[]>(`${route}?${params}`), staleTime: 15_000 })
}
export function useExpenseBatch(id: string) {
  return useQuery({ queryKey: ['hrms', 'expense', 'batch', id], queryFn: () => apiJson<ExpenseBatchDetail>(`${route}/${id}`) })
}
export function useBuildExpenseBatch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (data: { companyId: string; cutoffDate: string; notes?: string; currency?: string }) => apiJson<ExpenseBatchDetail>(route, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}
export function useExpenseBatchAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, paymentReference, notes }: { id: string; action: 'post' | 'mark-paid' | 'cancel'; paymentReference?: string; notes?: string }) => apiJson<ExpenseBatch>(`${route}/${id}/${action}`, {
      method: 'POST', ...(action === 'mark-paid' ? { body: JSON.stringify({ paymentReference, notes }) } : {}),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}
