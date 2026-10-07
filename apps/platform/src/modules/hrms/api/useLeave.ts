import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { rangeQs, rangeKey } from './shared/listRange'
import type { DayRange } from '@/design/kit/rangeFilterModel'
import { SHARED_KEYS } from './shared/contracts'

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
  // BW-49: balance notes. Fields are optional until the server starts sending
  // them (the UI shows only rules that exist and work today).
  /** How much lands next and when (null when the type is not accruing). */
  nextCredit?: { days: number; on: string } | null
  /** The day the leave year resets, usually `${year + 1}-01-01`. */
  resetDate?: string | null
  /** The maximum this type carries forward, when carry forward is on. */
  carryForwardCap?: number | null
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
  // BW-38: additive. Null when the server hasn't rolled out yet.
  leaveTypeCode?: string | null
  leaveTypeCategory?: string | null
  duration?: LeaveDuration | null
  startDate: string
  endDate: string
  totalDays: number
  reason?: string
  status: LeaveApprovalStatus
  approverComment?: string
  approvedAt?: string
  createdAt: string
  // BW-38: who decided, who the HR level went to, and the requester's balance.
  decidedByName?: string | null
  approverName?: string | null
  l2ApproverName?: string | null
  l2DecidedAt?: string | null
  balanceAvailable?: number | null
  balanceTotal?: number | null
  /** Same-department overlap with another approved or pending request. */
  conflicts?: LeaveConflict[]
}

/** One reason an approver should look twice before deciding (BW-38). */
export interface LeaveConflict {
  kind: 'TEAM_OVERLAP' | 'ON_NOTICE' | 'LOW_BALANCE' | (string & {})
  text: string
}

export interface LeaveOverviewResponse {
  balances: LeaveBalanceResponse[]
  recentRequests: LeaveRequestResponse[]
  pendingApprovals: number
}

/** `range`: only leave whose days overlap it (?from=&to=, calendar everywhere); none = every request, as before. */
export function useMyLeaves(page = 0, pageSize = LEAVE_PAGE_SIZE, range?: DayRange | null) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'my', page, pageSize, ...(range ? [rangeKey(range)] : [])],
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number }>(`/v1/leave/my?page=${page}&size=${pageSize}${rangeQs(range)}`),
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

export function useEmployeeLeaveRequests(employeeId: string, page = 0, pageSize = 10, enabled = true, range?: DayRange | null) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'employee', employeeId, 'requests', page, pageSize, ...(range ? [rangeKey(range)] : [])],
    queryFn: () => apiJson<{ content: LeaveRequestResponse[]; totalElements: number; totalPages: number }>(
      `/v1/leave/employees/${employeeId}/requests?page=${page}&size=${pageSize}${rangeQs(range)}`),
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
/** The possible server values of `status` on `/approvals/history`. */
export type DecidedStatus = 'APPROVED' | 'REJECTED' | 'CANCELLED'
export interface DecidedPage {
  content: LeaveRequestResponse[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
  /** Totals per decided status, in scope — null when the server failed to compute them (BW-40). */
  counts: Record<DecidedStatus, number> | null
}
/** `range`: only leave whose days overlap it; the counts follow it too. None = every decision, as before. */
export function useApprovalsHistory(page = 0, status?: DecidedStatus, range?: DayRange | null) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'history', page, status ?? 'all', ...(range ? [rangeKey(range)] : [])],
    queryFn: () => {
      const qs = status ? `&status=${status}` : ''
      return apiJson<DecidedPage>(`/v1/leave/approvals/history?page=${page}&size=20${qs}${rangeQs(range)}`)
    },
    staleTime: 30_000,
  })
}

/** Refreshed after any approve/reject/undo (apply, cancel, bulk, L1, L2, decide). */
function invalidateLeaveMutation(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'approvals'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'my'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'balances'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'overview'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'calendar'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'all-balances'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'usage'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'stats'] })
  // CONTRACTS.md: every approve/reject hook invalidates the shared Inbox and
  // Recent decisions keys, so Undo offers and the inbox stay current.
  qc.invalidateQueries({ queryKey: SHARED_KEYS.approvalsInbox })
  qc.invalidateQueries({ queryKey: SHARED_KEYS.recentDecisions })
  qc.invalidateQueries({ queryKey: SHARED_KEYS.teamTimeOff })
  qc.invalidateQueries({ queryKey: SHARED_KEYS.teamSchedule })
}

export function useApplyLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { leaveTypeId: string; startDate: string; endDate: string; duration: LeaveDuration; reason?: string; companyId?: string }) => {
      const { companyId, ...body } = data
      const url = companyId ? `/v1/leave/apply?companyId=${companyId}` : '/v1/leave/apply'
      return apiJson<LeaveRequestResponse>(url, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => invalidateLeaveMutation(qc),
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
    onSuccess: () => invalidateLeaveMutation(qc),
  })
}

/** One request's outcome in a bulk decision (LeaveBulkDecisions.Result). */
export interface LeaveBulkResult {
  id: string
  ok: boolean
  /** The new status when decided. */
  status: string | null
  /** Why it wasn't decided (the single decision's own refusal). */
  errorCode: string | null
  message: string | null
}

export interface LeaveBulkOutcome {
  requested: number
  decided: number
  failed: number
  results: LeaveBulkResult[]
}

/** Most ids one bulk decision takes (LeaveBulkDecisions.MAX_IDS). */
export const LEAVE_BULK_MAX = 100

/**
 * Approve or reject several leave requests at once (POST /v1/leave/approvals/bulk-decision, BW-42):
 * the same decision as useLeaveDecision once per request, with a result per request; one refused
 * request doesn't stop the others. Refreshes what useLeaveDecision refreshes.
 */
export function useBulkLeaveDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status, comment }: { ids: string[]; status: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      apiJson<LeaveBulkOutcome>('/v1/leave/approvals/bulk-decision', {
        method: 'POST',
        body: JSON.stringify({ ids, status, comment }),
      }),
    onSuccess: () => invalidateLeaveMutation(qc),
  })
}

/**
 * Cancel a request of your own.
 *
 * E29 fix: today the mutation only invalidated `['hrms','leave','my']`, so
 * cancelling an approved leave left the balances stale on the Overview and
 * Balances tabs until the browser was reloaded. The pending/available days
 * only came back the next time React Query refetched them on its own.
 */
export function useCancelLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      apiJson<void>(`/v1/leave/${requestId}/cancel?reason=${encodeURIComponent(reason)}`, { method: 'POST' }),
    onSuccess: () => invalidateLeaveMutation(qc),
  })
}

// ── Approvals: PENDING_L2, L1/L2 decide, bulk ───────────────────────────────

/** Rows awaiting the HR level (`hrms.leave.approve.l2`); the whole tenant. */
export function usePendingL2Approvals(page = 0, size = 20, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'pending-l2', page, size],
    enabled,
    queryFn: () =>
      apiJson<{ content: LeaveRequestResponse[]; totalElements: number; totalPages?: number }>(
        `/v1/leave/approvals/pending-l2?page=${page}&size=${size}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

/** HR's final decision on a PENDING_L2 request. Reject needs a note. */
export function useLeaveL2Decision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, status, comment }: { requestId: string; status: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      apiJson<LeaveRequestResponse>(`/v1/leave/${requestId}/l2-decision`, {
        method: 'POST',
        body: JSON.stringify({ status, comment }),
      }),
    onSuccess: () => invalidateLeaveMutation(qc),
  })
}

export interface BulkDecisionOutcome {
  requestId: string
  status: 'APPROVED' | 'REJECTED'
  outcome: 'DONE' | 'REFUSED' | 'FORBIDDEN' | (string & {})
  message?: string | null
}

/** Decide several leave requests at once (BW-42). Each id is decided through
 *  the same guard as `/decision`; a refused one doesn't stop the others. */
export function useLeaveBulkDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status, comment }: { ids: string[]; status: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      apiJson<{ results?: BulkDecisionOutcome[]; approved?: number; refused?: number } | BulkDecisionOutcome[]>(
        '/v1/leave/approvals/bulk-decision',
        { method: 'POST', body: JSON.stringify({ ids, status, comment }) }),
    onSuccess: () => invalidateLeaveMutation(qc),
  })
}

// ── BW-37 Approval stats · BW-39 Calendar · BW-47 Colleagues off · BW-44 All balances / usage ──

export interface LeaveApprovalStatsMonth { month: string; approved: number; decided: number; avgDecisionHours: number | null }
export interface LeaveApprovalStatsResponse {
  scope: 'TENANT' | 'TEAM' | 'SELF'
  waiting: number
  pending: number
  pendingL2: number
  newLast24h: number
  approvedThisMonth: number
  approvedLastMonth: number
  avgDecisionHours: number | null
  avgDecisionHoursLastMonth: number | null
  onLeaveToday: number
  nextWorkingDay: string | null
  onLeaveNextWorkingDay: number
  months: LeaveApprovalStatsMonth[]
}

/** The design's four stat tiles on Approvals, in one call (BW-37). */
export function useLeaveApprovalStats(months = 7, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'stats', months],
    enabled,
    queryFn: () => apiJson<LeaveApprovalStatsResponse>(`/v1/leave/approvals/stats?months=${months}`),
    staleTime: 30_000,
  })
}

export interface LeaveCalendarEntry {
  id: string
  employeeId: string
  employeeName: string
  firstName: string
  departmentName: string | null
  leaveTypeId: string
  leaveTypeName: string
  leaveTypeCode: string | null
  leaveTypeCategory: string | null
  startDate: string
  endDate: string
  totalDays: number
  duration: string | null
  status: 'APPROVED' | 'PENDING' | 'PENDING_L2' | (string & {})
}

export interface LeaveCalendarFeed {
  from: string
  to: string
  scope: 'TENANT' | 'TEAM' | 'SELF'
  statuses: string[]
  truncated: boolean
  entries: LeaveCalendarEntry[]
}

/** Approved + pending leave between from and to (at most 62 days), scoped by
 *  the caller's level (BW-39). Replaces the 10-page history fetch. */
export function useLeaveCalendarFeed(from: string | undefined, to: string | undefined, statuses: string[] | undefined, enabled = true) {
  const key = statuses?.join(',') ?? 'default'
  return useQuery({
    queryKey: ['hrms', 'leave', 'calendar', from, to, key],
    enabled: enabled && !!from && !!to,
    queryFn: () => {
      const p = new URLSearchParams({ from: from!, to: to! })
      if (statuses?.length) p.set('statuses', statuses.join(','))
      return apiJson<LeaveCalendarFeed>(`/v1/leave/calendar?${p}`)
    },
    staleTime: 30_000,
  })
}

export interface ColleaguesOffDay { date: string; names: string[] }
export interface ColleaguesOffResponse { from: string; to: string; inDepartment: boolean; days: ColleaguesOffDay[] }

/** First names of same-department colleagues on APPROVED leave, per working day. */
export function useColleaguesOff(from: string | undefined, to: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'team-off', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: () => apiJson<ColleaguesOffResponse>(`/v1/leave/team-off?from=${from}&to=${to}`),
    staleTime: 30_000,
  })
}

export interface AllBalancesTypeBalance {
  leaveTypeId: string
  leaveTypeName: string
  leaveTypeCode: string | null
  category: string | null
  typeActive: boolean
  entitlement: number
  carryForward: number
  total: number
  used: number
  pending: number
  available: number
}
export interface AllBalancesPerson {
  employeeId: string
  employeeName: string
  employeeCode: string | null
  departmentName: string | null
  companyId: string
  employmentStatus: string
  balances: AllBalancesTypeBalance[]
}
export interface AllBalancesPage {
  content: AllBalancesPerson[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

/** Everyone's balances for a year, a page at a time (BW-44). */
export function useAllLeaveBalances({ companyId, year, q, page = 0, size = 20, enabled = true }: {
  companyId?: string; year?: number; q?: string; page?: number; size?: number; enabled?: boolean
}) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'all-balances', companyId ?? '', year ?? 'current', q ?? '', page, size],
    enabled,
    queryFn: () => {
      const p = new URLSearchParams()
      if (companyId) p.set('companyId', companyId)
      if (year) p.set('year', String(year))
      if (q) p.set('q', q)
      p.set('page', String(page))
      p.set('size', String(size))
      return apiJson<AllBalancesPage>(`/v1/leave/balances?${p}`)
    },
    staleTime: 30_000,
  })
}

export interface LeaveUsageType {
  leaveTypeId: string
  leaveTypeName: string
  leaveTypeCode: string | null
  category: string | null
  typeActive: boolean
  used: number
  pending: number
  granted: number
  people: number
}
export interface LeaveUsageResponse { year: number; companyId: string | null; types: LeaveUsageType[] }

/** Leave used this year per type, company-wide (BW-44). */
export function useLeaveUsage({ companyId, year, enabled = true }: { companyId?: string; year?: number; enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'usage', companyId ?? '', year ?? 'current'],
    enabled,
    queryFn: () => {
      const p = new URLSearchParams()
      if (companyId) p.set('companyId', companyId)
      if (year) p.set('year', String(year))
      const qs = p.toString()
      return apiJson<LeaveUsageResponse>(`/v1/leave/usage${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

// ── BW-48 Leave preview ─────────────────────────────────────────────────────

export interface LeavePreviewRefusal { code: string; message: string }
export interface LeavePreviewResponse {
  leaveTypeId: string
  leaveTypeName: string | null
  startDate: string
  endDate: string
  duration: LeaveDuration
  /** null when the dates can't be counted. */
  workingDays: number | null
  balanceAvailable: number | null
  balanceAfter: number | null
  approverName: string | null
  canApply: boolean
  blockingReasons: LeavePreviewRefusal[]
}

export interface LeavePreviewArgs {
  leaveTypeId?: string
  startDate?: string
  endDate?: string
  duration?: LeaveDuration
  companyId?: string
}

/** What applying for this leave would do (BW-48). The first blocking reason is
 *  the one applying would answer with (so the UI can show that message in
 *  place of the design's "extra days unpaid"). */
export function useLeavePreview(args: LeavePreviewArgs, enabled = true) {
  const ready = !!(args.leaveTypeId && args.startDate && args.endDate)
  return useQuery({
    queryKey: ['hrms', 'leave', 'preview', args.leaveTypeId ?? '', args.startDate ?? '', args.endDate ?? '', args.duration ?? 'FULL_DAY', args.companyId ?? ''],
    enabled: enabled && ready,
    queryFn: () => {
      const p = new URLSearchParams({
        leaveTypeId: args.leaveTypeId!, startDate: args.startDate!, endDate: args.endDate!,
      })
      if (args.duration) p.set('duration', args.duration)
      if (args.companyId) p.set('companyId', args.companyId)
      return apiJson<LeavePreviewResponse>(`/v1/leave/preview?${p}`)
    },
    staleTime: 10_000,
  })
}

// ── BW-46 Edit a holiday ────────────────────────────────────────────────────

export interface UpdateHolidayRequest {
  holidayDate: string
  holidayName: string
  holidayType?: string | null
  description?: string | null
}

/** PUT /v1/settings/holidays/{id} (BW-46). Inline here because useSettings.ts
 *  is owned by another package; the lead folds it in if other pages need it. */
export function useUpdateHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHolidayRequest }) =>
      apiJson<unknown>(`/v1/settings/holidays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'settings', 'holidays'] })
      // The leave calendar reads holidays as "office closed" days.
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'calendar'] })
    },
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

// ── Apply a leave type to everyone (4 Oct 2026) ─────────────────────────────
// A balance is made once a year per person with the type's days at that moment;
// editing the type never changes it. These give everyone still working in the
// type's company the type's days for this leave year, after a preview
// (LeaveTypeApplyController, permission leave.type.write).

/** Balances going from `from` to `to` days, for `people` people. */
export interface LeaveTypeApplyChange { from: number; to: number; people: number }
/** Someone who has used or asked for more than the new days: their balance would show below 0. */
export interface LeaveTypeApplyBelowZero { employeeId: string; employeeName: string | null; employeeCode: string | null; takenDays: number; availableAfter: number }
export interface LeaveTypeApplyPreview {
  leaveTypeId: string
  leaveTypeName: string
  year: number
  annualEntitlement: number
  accrualFrequency: 'YEARLY' | 'MONTHLY' | 'QUARTERLY'
  /** Everyone still working in the type's company. */
  people: number
  /** People whose balance exists and would get a different number of days. */
  changing: number
  /** People without a balance of this type yet this year; they get one. */
  adding: number
  unchanged: number
  belowZero: number
  changes: LeaveTypeApplyChange[]
  /** At most 20; `belowZero` is the full count. */
  belowZeroPeople: LeaveTypeApplyBelowZero[]
  /** Each change also goes on the balance audit trail (V143.71 applied). */
  ledgerReady: boolean
}
export interface LeaveTypeApplyResult {
  leaveTypeId: string
  leaveTypeName: string
  year: number
  annualEntitlement: number
  people: number
  changed: number
  added: number
  unchanged: number
  belowZero: number
  ledgerWritten: boolean
}

/** What giving everyone this type's days would do. Always fresh: it is read when the dialog opens. */
export function useLeaveTypeApplyPreview(leaveTypeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'types', 'apply-preview', leaveTypeId ?? ''],
    enabled: enabled && !!leaveTypeId,
    queryFn: () => apiJson<LeaveTypeApplyPreview>(`/v1/leave/types/${leaveTypeId}/apply-to-all/preview`),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/** Give everyone the type's days. `days` is what the preview showed; the server refuses if the type changed since. */
export function useApplyLeaveTypeToAll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      apiJson<LeaveTypeApplyResult>(`/v1/leave/types/${id}/apply-to-all?days=${encodeURIComponent(String(days))}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'types'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'balances'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'all-balances'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'usage'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'overview'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'employee'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'ledger'] })
    },
  })
}
