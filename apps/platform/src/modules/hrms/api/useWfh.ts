import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend ApprovalStatus enum. Same set that LeaveApprovalStatus uses so
// pill styles + cancel gating logic can be reused between leave and WFH.
export type WfhApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'PENDING_L2'

/**
 * Mirrors com.hrms.leave.dto.WfhRequestResponse (enriched by WfhController with
 * requester employeeName / employeeCode / departmentName).
 */
export interface WfhRequestResponse {
  id: string
  employeeId: string
  employeeName?: string | null
  employeeCode?: string | null
  departmentName?: string | null
  fromDate: string
  toDate: string
  reason: string | null
  status: WfhApprovalStatus
  approverId: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
}

/**
 * Mirrors com.hrms.leave.dto.WfhRequestRequest. Dates are ISO yyyy-MM-dd (the
 * backend deserialises them into java.time.LocalDate).
 */
export interface WfhRequestRequest {
  fromDate: string
  toDate: string
  reason?: string
}

interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export function useMyWfhRequests(page = 0, size = 20) {
  return useQuery({
    queryKey: ['hrms', 'wfh', 'my', page, size],
    queryFn: () => apiJson<PageResponse<WfhRequestResponse>>(`/v1/wfh/my?page=${page}&size=${size}`),
    staleTime: 30_000,
    // There is no WFH *approvals* queue on web yet (see file footer), so this
    // is the only WFH list that goes stale under someone's eyes: an employee
    // parked on /me/wfh waiting for a decision. Poll it like the leave and
    // correction queues rather than making them refresh the browser.
    refetchInterval: 30_000,
  })
}

export function useApplyWfh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: WfhRequestRequest) =>
      apiJson<WfhRequestResponse>('/v1/wfh', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'wfh'] })
    },
  })
}

export function useCancelWfh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) =>
      apiJson<void>(`/v1/wfh/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'wfh'] }),
  })
}

// NOTE: web has no WFH approvals queue. notificationStore.ts:177 routes
// WFH_SUBMITTED to /hrms/leave?tab=approvals, but that tab renders
// usePendingApprovals() from useLeave.ts, which reads
// /v1/leave/approvals/pending — leave requests only. A WFH request submitted
// from the app notifies the approver and then lands on a screen that cannot
// show it. Approving WFH is app-only today; the web hook still needs writing.
