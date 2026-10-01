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
  /** Set when HR / finance raised it on the employee's behalf (null when the employee asked). */
  raisedById?: string | null
  raisedByName?: string | null
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

export function useMyAdvances(page = 0, size = 20) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'my', page, size],
    queryFn: () => apiJson<Page<AdvanceRequest>>(`/v1/advance/my?page=${page}&size=${size}`),
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

/** The admin list's filters, matching the backend (BW-62): a status, a phase, or a department. */
export type AdvancePhase = 'RECOVERING' | 'REPAID'
export interface AdvanceListFilters { status?: AdvanceStatus; phase?: AdvancePhase; departmentId?: string }

export function useCompanyAdvances(page = 0, filters: AdvanceListFilters = {}, size = 20) {
  const parts: string[] = []
  if (filters.status) parts.push(`status=${filters.status}`)
  if (filters.phase) parts.push(`phase=${filters.phase}`)
  if (filters.departmentId) parts.push(`departmentId=${encodeURIComponent(filters.departmentId)}`)
  const query = parts.length ? `&${parts.join('&')}` : ''
  return useQuery({
    queryKey: ['hrms', 'advance', 'company', page, filters.status ?? null, filters.phase ?? null, filters.departmentId ?? null, size],
    queryFn: () => apiJson<Page<AdvanceRequest>>(`/v1/advance/requests?page=${page}&size=${size}${query}`),
    staleTime: 15_000,
  })
}

// ── Summaries, preview, approver (BW-62) ─────────────────────────────────────

export interface Bucket { count: number; amount: number }

export interface AdvancesSummary {
  total: number
  requested: Bucket
  approvedNotDisbursed: Bucket
  recovering: number
  recoveringPeople: number
  outstanding: number
  repaid: number
  writtenOff: number
  rejected: number
  repaidThisFinancialYear: number
  financialYear: string
  financialYearStart: string
  financialYearEnd: string
}

export function useAdvancesSummary(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'summary'],
    queryFn: () => apiJson<AdvancesSummary>('/v1/advance/summary'),
    enabled,
    staleTime: 30_000,
  })
}

export interface MyAdvancesSummary {
  total: number
  waiting: Bucket
  approvedNotDisbursed: Bucket
  recovering: number
  stillToRepay: number
  monthlyRecovery: number
  installmentsLeft: number
  nextDeductionMonth: string | null
  repaid: number
}

export function useMyAdvancesSummary(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'my-summary'],
    queryFn: () => apiJson<MyAdvancesSummary>('/v1/advance/my/summary'),
    enabled,
    staleTime: 30_000,
  })
}

/** The server's AdvanceApprover record: who the next advance request would go to. */
export interface AdvanceApprover {
  employeeId: string | null
  name: string | null
  source: 'MANAGER' | 'DEPARTMENT_HEAD' | 'HR' | 'ADMIN' | 'DELEGATE' | string
  delegateForName?: string | null
}
/** GET /v1/advance/my/approver returns { approver: AdvanceApprover | null }. */
export function useMyAdvanceApprover(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'my-approver'],
    queryFn: () => apiJson<{ approver: AdvanceApprover | null }>('/v1/advance/my/approver'),
    enabled,
    staleTime: 60_000,
  })
}

/**
 * The plan the server would use for `amount` repaid over `months` months:
 * monthly deduction, last installment, assumed payout month, first and last
 * deduction months, and who approves it. See AdvanceController#myPreview.
 */
export interface AdvancePreview {
  amount: number
  months: number
  monthlyDeduction: number
  lastInstallment: number
  assumedPayoutMonth: string
  firstDeductionMonth: string
  lastDeductionMonth: string
  approver: AdvanceApprover
  netMonthly: number | null
  takeHomeAfterDeduction: number | null
}

export function useMyAdvancePreview(amount: number, months: number, enabled = true) {
  const ok = enabled && Number.isFinite(amount) && amount > 0 && Number.isInteger(months) && months >= 1 && months <= 60
  return useQuery({
    queryKey: ['hrms', 'advance', 'my-preview', amount, months],
    queryFn: () => apiJson<AdvancePreview>(`/v1/advance/my/preview?amount=${amount}&months=${months}`),
    enabled: ok,
    staleTime: 15_000,
  })
}

export interface AdvanceScheduleRow {
  id: string
  installmentNo: number
  scheduledMonth: string
  scheduledAmount: number
  status: 'PENDING' | 'RECOVERED' | 'SKIPPED' | 'CANCELLED'
  payrollRunId?: string
  recoveredAmount?: number
  recoveredAt?: string
}

export interface AdvanceLedgerRow {
  id: string
  entryType: string
  amount: number
  balanceAfter: number
  payrollRunId?: string
  reference?: string
  notes?: string
  createdAt: string
}

export interface AdvanceRecoverySummary {
  advanceRequestId: string
  principalAmount: number
  outstandingAmount: number
  installmentsPending: number
  installmentsRecovered: number
  nextScheduledMonth?: string
}

export function useAdvanceRecovery(id: string, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'advance', 'recovery', id],
    queryFn: async () => {
      const [summary, schedule, ledger] = await Promise.all([
        apiJson<AdvanceRecoverySummary>(`/v1/advance/${id}/summary`),
        apiJson<AdvanceScheduleRow[]>(`/v1/advance/${id}/schedule`),
        apiJson<AdvanceLedgerRow[]>(`/v1/advance/${id}/ledger`),
      ])
      return { summary, schedule, ledger }
    },
    enabled,
  })
}

export type RecoveryAction =
  | { id: string; action: 'skip-month'; installmentNo: number; reason: string }
  | { id: string; action: 'foreclose'; lumpSumAmount: number; reason: string }
  | { id: string; action: 'write-off'; reason: string }

export function useAdvanceRecoveryAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, ...body }: RecoveryAction) => apiJson<AdvanceRecoverySummary>(`/v1/advance/${id}/${action}`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'advance'] }),
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

/** HR / finance raise an advance in an employee's name (hrms.advance.request.others). Same approval → payout → recovery flow. */
export function useRequestAdvanceOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RequestAdvancePayload & { employeeId: string }) =>
      apiJson<AdvanceRequest>('/v1/advance/requests/on-behalf', { method: 'POST', body: JSON.stringify(data) }),
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

export interface DisburseBody {
  /** The bank/UTR reference the money went through, up to 100 chars; optional. */
  paymentReference?: string
  /** "2026-11": the first salary month to recover from. Null = the month after payout. */
  firstDeductionMonth?: string | null
}

export function useDisburseAdvance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: DisburseBody }) =>
      apiJson<AdvanceRequest>(`/v1/advance/requests/${id}/disburse`, {
        method: 'POST',
        ...(body && (body.paymentReference || body.firstDeductionMonth) ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'advance'] }),
  })
}
