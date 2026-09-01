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

// ─── Approver queue + decisions (Anil doc-2 issue 4, 2026-09-01) ──────────
// The web Approvals tab used to be leave-only. Employees applying for WFH
// from the mobile app notified the approver, but the approver landed on a
// screen that couldn't render the request. Both are now merged client-side
// in Leave.tsx ApprovalsTab; the backend endpoints have existed since
// WfhController shipped, so no server change is required.

/** Pending WFH approvals for the current caller (broadens to tenant-wide
 *  when the caller has hrms.leave.approve.l2 — HR/admin). Poll every 30s
 *  like the leave queue so a fresh mobile submission surfaces without a
 *  browser refresh. */
export function usePendingWfhApprovals(page = 0, size = 20) {
  return useQuery({
    queryKey: ['hrms', 'wfh', 'pending-approvals', page, size],
    queryFn: () =>
      apiJson<PageResponse<WfhRequestResponse>>(
        `/v1/wfh/pending-approvals?page=${page}&size=${size}`,
      ),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

/** Approve or reject one WFH request. Mirrors useLeaveDecision so the
 *  Approvals tab can pick the right hook per row (row.type === 'wfh'). */
export function useWfhDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { requestId: string; approved: boolean; comment?: string }) => {
      const path = args.approved
        ? `/v1/wfh/${args.requestId}/approve`
        : `/v1/wfh/${args.requestId}/reject`
      // Rejection reason is required by the backend (WFH_REJECT_REASON_REQUIRED);
      // callers must pass a comment when approved=false.
      return apiJson<WfhRequestResponse>(path, {
        method: 'POST',
        body: JSON.stringify({ comment: args.comment ?? '' }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'wfh'] })
      // The leave approvals queue includes WFH now — invalidate both so the
      // union list re-renders without a stale row.
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'approvals'] })
    },
  })
}
