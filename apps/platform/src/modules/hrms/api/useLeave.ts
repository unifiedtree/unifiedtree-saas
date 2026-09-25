import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/** Default rows per page for the my-leaves list. Was the literal 20
 *  inlined in the query string; named so the pager label can never
 *  disagree with what was actually requested. */
const LEAVE_PAGE_SIZE = 20

// Mirrors backend ApprovalStatus enum. PENDING_L2 = approved at L1, awaiting HR
// (L2). ESCALATED was a phantom value the backend never returns and was removed.
export type LeaveApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'PENDING_L2'
export type LeaveDuration = 'FULL_DAY' | 'HALF_DAY_MORNING' | 'HALF_DAY_AFTERNOON'

export interface LeaveTypeResponse {
  id: string
  name: string
  code: string
  category: string
  annualEntitlement: number
  maxConsecutiveDays: number
  isPaidLeave: boolean
  isCarryForwardAllowed: boolean
  maxCarryForwardDays: number
  isActive: boolean
  // 2026-09-10: these three are stored server-side and settable via the API,
  // but were missing from this response type, so the edit drawer could not
  // read them back. Since PUT /leave/types/{id} is a full replace, every save
  // from the web wiped them — including the Min Notice Days that the mobile
  // Leave Policies screen collects.
  minNoticeDays?: number
  applicableGender?: string | null
  description?: string | null
  /** V143.23: YEARLY (credited upfront), MONTHLY or QUARTERLY. */
  accrualFrequency?: 'YEARLY' | 'MONTHLY' | 'QUARTERLY'
  isEncashable?: boolean
  /** The most days one person may encash a year; null = no yearly limit. */
  maxEncashDays?: number | null
}

export interface LeaveBalanceResponse {
  id: string
  employeeId: string
  leaveTypeId: string
  leaveTypeName: string
  year: number
  totalEntitlement: number
  used: number
  pending: number
  carryForward: number
  available: number
}

export interface LeaveRequestResponse {
  id: string
  employeeId: string
  // Requester identity — enriched by the backend on approval/decision responses
  // so approvers can see whose request they are deciding.
  employeeName?: string
  employeeCode?: string
  departmentName?: string
  leaveTypeId: string
  leaveTypeName?: string
  startDate: string
  endDate: string
  totalDays: number
  reason?: string
  status: LeaveApprovalStatus
  approverComment?: string
  approvedAt?: string
  createdAt: string
}

export interface LeaveOverviewResponse {
  balances: LeaveBalanceResponse[]
  recentRequests: LeaveRequestResponse[]
  pendingApprovals: number
}

export function useMyLeaves(page = 0, pageSize = LEAVE_PAGE_SIZE) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'my', page, pageSize],
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number }>(`/v1/leave/my?page=${page}&size=${pageSize}`),
    staleTime: 30_000,
  })
}

export function useMyBalances(year?: number) {
  const params = year ? `?year=${year}` : ''
  return useQuery({
    queryKey: ['hrms', 'leave', 'balances', year ?? 'current'],
    queryFn: () => apiJson<LeaveBalanceResponse[]>(`/v1/leave/my/balances${params}`),
    staleTime: 30_000,
  })
}

/**
 * Another person's leave, for the employee workspace's Leave tab (V143.13).
 * HR / admin (hrms.leave.employee.read) read anyone, department managers their
 * team, everyone else only themselves; the server answers 403 otherwise.
 */
export function useEmployeeLeaveBalances(employeeId: string, year?: number, enabled = true) {
  const params = year ? `?year=${year}` : ''
  return useQuery({
    queryKey: ['hrms', 'leave', 'employee', employeeId, 'balances', year ?? 'current'],
    queryFn: () => apiJson<LeaveBalanceResponse[]>(`/v1/leave/employees/${employeeId}/balances${params}`),
    enabled: !!employeeId && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

export function useEmployeeLeaveRequests(employeeId: string, page = 0, pageSize = 10, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'employee', employeeId, 'requests', page, pageSize],
    queryFn: () => apiJson<{ content: LeaveRequestResponse[]; totalElements: number; totalPages: number }>(
      `/v1/leave/employees/${employeeId}/requests?page=${page}&size=${pageSize}`),
    enabled: !!employeeId && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

export function useLeaveOverview(year?: number) {
  const params = year ? `?year=${year}` : ''
  return useQuery({
    queryKey: ['hrms', 'leave', 'overview', year ?? 'current'],
    queryFn: () => apiJson<LeaveOverviewResponse>(`/v1/leave/overview${params}`),
    staleTime: 30_000,
  })
}

export function useLeaveTypes(companyId: string) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'types', companyId],
    queryFn: () => apiJson<LeaveTypeResponse[]>(`/v1/leave/types?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 30_000,
  })
}

export function usePendingApprovals(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'pending', page],
    enabled,
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number }>(`/v1/leave/approvals/pending?page=${page}&size=20`),
    staleTime: 30_000,
    // Approval queue — a manager parked on this screen has to see requests
    // submitted from the mobile app without navigating away and back.
    // Mirrors useAttendance's dashboard / logs polling.
    refetchInterval: 30_000,
  })
}

/**
 * Leaves this approver has already decided — approved, rejected or cancelled.
 *
 * The endpoint has existed since the approval flow was built but nothing in the
 * SPA ever called it, so an approved leave dropped out of the pending queue and
 * was not visible anywhere in the product afterwards. Reported by the client as
 * "leaves history after submitting the request not displaying".
 *
 * Scope follows the caller: tenant-wide for HR/admin, personal for a manager.
 * No polling — history only changes as a side effect of a decision made on the
 * Approvals tab, and useLeaveDecision already invalidates ['hrms','leave',
 * 'approvals'], which this key sits under.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- exported hook
export function useApprovalsHistory(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'history', page],
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number; totalPages?: number }>(
        `/v1/leave/approvals/history?page=${page}&size=20`),
    staleTime: 30_000,
  })
}

export function useApplyLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { leaveTypeId: string; startDate: string; endDate: string; duration: LeaveDuration; reason?: string; companyId?: string }) => {
      const { companyId, ...body } = data
      const url = companyId ? `/v1/leave/apply?companyId=${companyId}` : '/v1/leave/apply'
      return apiJson<LeaveRequestResponse>(url, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'my'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'balances'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'overview'] })
    },
  })
}

export function useLeaveDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, status, comment }: { requestId: string; status: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      apiJson<LeaveRequestResponse>(`/v1/leave/${requestId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status, comment }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'approvals'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'my'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'balances'] })
      // The overview carries pendingApprovals, so the dashboard's count read
      // one stale until the next navigation. useApplyLeave already does this.
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'overview'] })
    },
  })
}

export function useCancelLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      apiJson<void>(`/v1/leave/${requestId}/cancel?reason=${encodeURIComponent(reason)}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'my'] }),
  })
}

export function useCreateLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      companyId,
      data,
    }: {
      companyId: string
      data: {
        name: string
        code: string
        category: string
        annualEntitlement: number
        maxConsecutiveDays?: number
        minNoticeDays?: number
        isCarryForwardAllowed?: boolean
        maxCarryForwardDays?: number
        isPaidLeave?: boolean
        description?: string
      }
    }) => apiJson<LeaveTypeResponse>(`/v1/leave/types?companyId=${companyId}`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'types'] }),
  })
}

export function useUpdateLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: {
        name: string
        code: string
        category: string
        annualEntitlement: number
        maxConsecutiveDays?: number
        minNoticeDays?: number
        isCarryForwardAllowed?: boolean
        maxCarryForwardDays?: number
        isPaidLeave?: boolean
        description?: string
      }
    }) => apiJson<LeaveTypeResponse>(`/v1/leave/types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'types'] }),
  })
}

export function useDeactivateLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/leave/types/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'types'] }),
  })
}
