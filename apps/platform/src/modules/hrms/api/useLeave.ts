import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

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

export function useMyLeaves(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'my', page],
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number }>(`/v1/leave/my?page=${page}&size=20`),
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

export function usePendingApprovals(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'pending', page],
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number }>(`/v1/leave/approvals/pending?page=${page}&size=20`),
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
