import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.expense.enums
export type ExpenseCategory =
  | 'TRAVEL' | 'FOOD' | 'ACCOMMODATION' | 'COMMUNICATION' | 'OFFICE_SUPPLIES'
  | 'MEDICAL' | 'TRAINING' | 'ENTERTAINMENT' | 'OTHER'
export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED'

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'TRAVEL', 'FOOD', 'ACCOMMODATION', 'COMMUNICATION', 'OFFICE_SUPPLIES',
  'MEDICAL', 'TRAINING', 'ENTERTAINMENT', 'OTHER',
]

export interface ExpenseItem {
  id?: string
  category: ExpenseCategory
  description?: string
  amount: number
  expenseDate: string
  receiptUrl?: string
  merchantName?: string
}

export interface ExpenseClaim {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  companyId: string
  title: string
  totalAmount: number
  currency: string
  status: ExpenseStatus
  submittedAt?: string
  approverId?: string
  approvedAt?: string
  approverComment?: string
  reimbursedAt?: string
  notes?: string
  createdAt: string
  items?: ExpenseItem[]
}

export interface ExpensePolicy {
  id: string
  companyId: string
  name: string
  category: ExpenseCategory
  maxAmountPerClaim?: number | null
  requiresReceipt: boolean
  requiresManagerApproval: boolean
  requiresHrApproval: boolean
  active: boolean
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

// ── Claims ─────────────────────────────────────────────────────────────────

export function useMyClaims(page = 0, size = 20) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'my', page, size],
    queryFn: () => apiJson<Page<ExpenseClaim>>(`/v1/expense/my?page=${page}&size=${size}`),
    staleTime: 30_000,
  })
}

export function useExpenseClaim(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'claim', id],
    queryFn: () => apiJson<ExpenseClaim>(`/v1/expense/claims/${id}`),
    enabled: !!id,
  })
}

export function usePendingExpenseApprovals(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'approvals', page],
    queryFn: () => apiJson<Page<ExpenseClaim>>(`/v1/expense/claims/approvals?page=${page}&size=20`),
    staleTime: 15_000,
    enabled,
  })
}

export interface SubmitClaimPayload {
  companyId?: string
  title: string
  currency?: string
  notes?: string
  items: Array<Omit<ExpenseItem, 'id'>>
}

export function useSubmitClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubmitClaimPayload) =>
      apiJson<ExpenseClaim>('/v1/expense/claims', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}

export function useExpenseDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved, comment }: { id: string; approved: boolean; comment?: string }) =>
      apiJson<ExpenseClaim>(`/v1/expense/claims/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approved, comment }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}

export function useReimburseClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<ExpenseClaim>(`/v1/expense/claims/${id}/reimburse`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}

// ── Policies ───────────────────────────────────────────────────────────────

export function useExpensePolicies(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'policies', companyId],
    queryFn: () => apiJson<ExpensePolicy[]>(`/v1/expense/policies?companyId=${companyId}`),
    enabled: !!companyId && enabled,
  })
}

export interface PolicyPayload {
  companyId?: string
  name: string
  category: ExpenseCategory
  maxAmountPerClaim?: number | null
  requiresReceipt?: boolean
  requiresManagerApproval?: boolean
  requiresHrApproval?: boolean
}

export function useCreatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, ...body }: PolicyPayload & { companyId: string }) =>
      apiJson<ExpensePolicy>(`/v1/expense/policies?companyId=${companyId}`, {
        method: 'POST',
        body: JSON.stringify({ ...body, companyId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense', 'policies'] }),
  })
}

export function useUpdatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: PolicyPayload & { id: string }) =>
      apiJson<ExpensePolicy>(`/v1/expense/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense', 'policies'] }),
  })
}

export function useDeletePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/expense/policies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense', 'policies'] }),
  })
}
