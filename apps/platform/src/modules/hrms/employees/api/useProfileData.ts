// Reads and actions the redesigned profile adds (P-PROFILE). Each endpoint below
// exists on the server; every block that uses one hides or shows its own empty /
// no-access state when the call is refused, never a sample value.
//
//   GET  /v1/attendance/employee/{id}/history?year&month   one person's month (BW-16; attendance.team.read + scope)
//   GET  /v1/attendance/employee/{id}/monthly-stats         the same month in numbers
//   GET  /v1/payroll/employees/{id}/payslips                 their LOCKED and PAID payslips (BW-58; payroll.runs.read)
//   GET  /v1/hrms/employees?reportingManagerId=              their direct reports (BW-96; hrms.employee.read)
//   GET  /v1/employees/{id}/invitation-status                sign-in state + last device (BW-100)
//   POST /v1/expense/receipts/for/{id}, /claims/for/{id}     a claim raised in their name (BW-61; hrms.expense.claim.others)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { DayRecordResponse, MonthlyStatsResponse, WeeklySummaryResponse } from '../../api/useAttendance'
import type { LeaveBalanceResponse } from '../../api/useLeave'
import type { Goal, PerformanceReview } from '../../api/usePerformance'
import type { ExpenseClaim, StoredReceipt, SubmitClaimPayload } from '../../api/useExpense'
import type { WorkforceEmployee } from '../../api/useWorkforce'
import { SHARED_KEYS } from '../../api/shared/contracts'

export function useEmployeeMonth(employeeId: string, year: number, month: number, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'employee-history', employeeId, year, month],
    queryFn: () => apiJson<DayRecordResponse[]>(`/v1/attendance/employee/${employeeId}/history?year=${year}&month=${month}`),
    enabled: enabled && !!employeeId,
    staleTime: 30_000,
    retry: false,
  })
}

export function useEmployeeMonthStats(employeeId: string, year: number, month: number, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'employee-monthly-stats', employeeId, year, month],
    queryFn: () => apiJson<MonthlyStatsResponse>(`/v1/attendance/employee/${employeeId}/monthly-stats?year=${year}&month=${month}`),
    enabled: enabled && !!employeeId,
    staleTime: 30_000,
    retry: false,
  })
}

/** One month's payslip as the server lists it (PayrollRunService.MyPayslipDto). */
export interface EmployeePayslip {
  runId: string
  period: string
  periodMonth: number
  periodYear: number
  paidDays: number | null
  lopDays: number | null
  gross: number | null
  totalDeductions: number | null
  netPay: number | null
  status: string
  lockedAt: string | null
  payDate: string | null
  paidAt: string | null
  totalDays: number | null
}

export function useEmployeePayslips(employeeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'employee-payslips', employeeId],
    queryFn: () => apiJson<EmployeePayslip[]>(`/v1/payroll/employees/${employeeId}/payslips`),
    enabled: enabled && !!employeeId,
    retry: false,
  })
}

/** Direct reports: the directory filtered by reporting manager (list projection, no pay). */
export function useDirectReports(employeeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'employees', 'direct-reports', employeeId],
    queryFn: () => apiJson<{ content: WorkforceEmployee[]; totalElements: number }>(`/v1/hrms/employees?reportingManagerId=${employeeId}&page=0&pageSize=50`),
    enabled: enabled && !!employeeId,
    retry: false,
  })
}

/** GET /v1/employees/{id}/invitation-status; times are "" when not set. */
export interface InvitationStatus {
  activated?: boolean
  invitedAt?: string
  lastLoginAt?: string
  /** BW-100: "Chrome on Windows", "Android"; "" when unknown (older servers leave it out). */
  lastLoginDevice?: string
}

export const invitationKey = (employeeId: string) => ['hrms', 'employee', employeeId, 'invitation-status'] as const

export function useInvitationStatus(employeeId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitationKey(employeeId),
    queryFn: () => apiJson<InvitationStatus>(`/v1/employees/${employeeId}/invitation-status`),
    enabled: enabled && !!employeeId,
    retry: false,
  })
}

/** Uploads one receipt for someone else's claim; send its receiptUrl back on the line. */
export function uploadReceiptFor(employeeId: string, file: File) {
  const body = new FormData()
  body.append('file', file)
  return apiJson<StoredReceipt>(`/v1/expense/receipts/for/${employeeId}`, { method: 'POST', body })
}

/** Raise a claim in someone's name. It goes to their usual approver and they are told. */
export function useClaimOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employeeId, ...body }: SubmitClaimPayload & { employeeId: string }) =>
      apiJson<ExpenseClaim>(`/v1/expense/claims/for/${employeeId}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['hrms', 'expense'] }),
      qc.invalidateQueries({ queryKey: SHARED_KEYS.approvalsInbox }),
    ]),
  })
}

// ── My profile: the signed-in person's own figures, each only for people who may read it ──
// (same query keys as the self-service pages' hooks, so their caches are shared)

export function useMyLeaveBalancesIf(year: number, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'balances', year],
    queryFn: () => apiJson<LeaveBalanceResponse[]>(`/v1/leave/my/balances?year=${year}`),
    enabled, staleTime: 30_000, retry: false,
  })
}

export function useMyDocumentsIf(enabled: boolean, pageSize = 20) {
  return useQuery({
    queryKey: ['hrms', 'document', 'my', 0, pageSize],
    queryFn: () => apiJson<{ content: Array<{ id: string; verificationStatus?: string }>; totalElements: number }>(`/v1/document/my?page=0&size=${pageSize}`),
    enabled, staleTime: 30_000, retry: false,
  })
}

export function useMyMissingDocumentsIf(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'document', 'my', 'missing'],
    queryFn: () => apiJson<Array<{ id: string; code: string; displayName: string }>>('/v1/document/my/missing'),
    enabled, staleTime: 30_000, retry: false,
  })
}

export function useMyGoalsIf(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'goals', 'my'],
    queryFn: () => apiJson<Goal[]>('/v1/performance/goals/my'),
    enabled, retry: false,
  })
}

export function useMyReviewsIf(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'reviews', 'my'],
    queryFn: () => apiJson<PerformanceReview[]>('/v1/performance/reviews/my'),
    enabled, retry: false,
  })
}

/** GET /v1/attendance/weekly-summary: your own week (attendance.checkin.self). */
export function useMyWeekIf(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'weekly-summary', 'me'],
    queryFn: () => apiJson<WeeklySummaryResponse>('/v1/attendance/weekly-summary'),
    enabled, staleTime: 60_000, retry: false,
  })
}

export function useMyMonthIf(year: number, month: number, enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'history', year, month],
    queryFn: () => apiJson<DayRecordResponse[]>(`/v1/attendance/history?year=${year}&month=${month}`),
    enabled, staleTime: 30_000, retry: false,
  })
}
