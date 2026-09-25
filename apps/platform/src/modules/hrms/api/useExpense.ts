import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.expense.enums
export type ExpenseCategory =
  | 'TRAVEL' | 'FOOD' | 'ACCOMMODATION' | 'COMMUNICATION' | 'OFFICE_SUPPLIES'
  | 'MEDICAL' | 'TRAINING' | 'ENTERTAINMENT' | 'OTHER'
export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'APPROVED_FOR_PAY' | 'REJECTED' | 'REIMBURSED'

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
  /** On reads: a short-lived signed link (null when storage isn't set up). On submit: the reference POST /receipts returned. */
  receiptUrl?: string | null
  merchantName?: string
  /** A receipt is attached (true even when no link can be signed here). */
  hasReceipt?: boolean
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
  /** Line items on the claim and how many carry a receipt (list rows carry no items). */
  itemCount?: number
  receiptCount?: number
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

/**
 * Rows per page for the approvals queue. Exported so the pager's
 * "Showing 1–20 of N" is computed from the size we actually request — a literal
 * at the call site would silently start lying the day this number changes.
 * ExpenseController declares @PageableDefault(size = 20) on
 * GET /claims/approvals.
 */
export const EXPENSE_APPROVALS_PAGE_SIZE = 20

export function usePendingExpenseApprovals(page = 0, enabled = true, pageSize = EXPENSE_APPROVALS_PAGE_SIZE) {
  return useQuery({
    // `page` is part of the key: without it react-query would hand page 2 the
    // cached page-1 rows and the queue would never appear to advance.
    queryKey: ['hrms', 'expense', 'approvals', page, pageSize],
    queryFn: () => apiJson<Page<ExpenseClaim>>(`/v1/expense/claims/approvals?page=${page}&size=${pageSize}`),
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

// ── Receipts (V143.13) ─────────────────────────────────────────────────────

/** Mirrors the server's receipt rules (ExpenseReceipts): PDF, PNG or JPEG, up to 10 MB. */
export const RECEIPT_FORMATS = ['pdf', 'png', 'jpg', 'jpeg']
export const RECEIPT_MAX_MB = 10

/** Returns the problem with a receipt file, or '' when it can be uploaded. */
export function receiptProblem(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!RECEIPT_FORMATS.includes(ext)) return 'A receipt must be a PDF, PNG or JPEG'
  if (file.size > RECEIPT_MAX_MB * 1024 * 1024) return `The receipt is too large (max ${RECEIPT_MAX_MB} MB)`
  return ''
}

/** "2 of 3 lines" — how many lines of a claim carry a receipt (from the list row's counts). */
export const receiptSummary = (c: Pick<ExpenseClaim, 'itemCount' | 'receiptCount'>) =>
  c.itemCount ? `${c.receiptCount ?? 0} of ${c.itemCount} ${c.itemCount === 1 ? 'line' : 'lines'}` : '—'

export interface StoredReceipt { receiptUrl: string; fileName: string; sizeBytes: number; contentType: string }

/** Uploads one receipt for the signed-in person; send receiptUrl back on the claim's line. */
export function uploadReceipt(file: File) {
  const body = new FormData()
  body.append('file', file)
  return apiJson<StoredReceipt>('/v1/expense/receipts', { method: 'POST', body })
}

/** Attach or replace the receipt on a line of your own claim while it waits for a decision. */
export function useAttachReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, itemId, file }: { claimId: string; itemId: string; file: File }) => {
      const body = new FormData()
      body.append('file', file)
      return apiJson<ExpenseClaim>(`/v1/expense/claims/${claimId}/items/${itemId}/receipt`, { method: 'POST', body })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
  })
}

/**
 * Another person's claims, for the employee workspace's Expenses tab (V143.13).
 * HR / admin / finance (hrms.expense.employee.read) read anyone, department
 * managers their team, everyone else only themselves; the server answers 403 otherwise.
 */
export function useEmployeeClaims(employeeId: string, page = 0, pageSize = 10, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'employee', employeeId, page, pageSize],
    queryFn: () => apiJson<Page<ExpenseClaim>>(`/v1/expense/employees/${employeeId}/claims?page=${page}&size=${pageSize}`),
    enabled: !!employeeId && enabled,
    staleTime: 30_000,
    retry: false,
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
  /**
   * 2026-09-09: added so a deactivated policy can be restored. There was no
   * way back before — the request record carried no active flag and the
   * service never touched the column, so even a PUT could not revive one, and
   * the deactivate (trash) icon had no confirm. One mis-click retired a spend
   * policy permanently.
   *
   * On UPDATE the server now treats every omitted field as "leave alone", so
   * sending only { isActive: true } restores a policy without disturbing its
   * cap or approval rules.
   */
  isActive?: boolean
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


export interface ExpenseDashboardStats {
  pendingApprovals: number
  pendingApprovalAmount: number
  toBeReimbursed: number
  toBeReimbursedAmount: number
  reimbursedThisMonth: number
  reimbursedThisMonthAmount: number
}

export function useExpenseDashboardStats(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'expense', 'dashboard-stats'],
    queryFn: () => apiJson<ExpenseDashboardStats>('/v1/expense/dashboard-stats'),
    enabled,
    staleTime: 30_000,
  })
}
