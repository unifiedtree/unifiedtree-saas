import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { LeaveRequestResponse } from '../api/useLeave'

/**
 * Data source for the Leave Calendar ("Who's away") tab.
 *
 * There is no date-range leave endpoint yet — nothing on the server answers
 * "approved leave between X and Y for my team". The two lists that DO carry
 * approved requests with employee + date span are:
 *
 *   GET /v1/leave/approvals/history  — hrms.leave.approve.l1; tenant-wide for
 *     HR/admin, the requests they decided for a plain manager. Rows carry
 *     employeeName (enrichPage in LeaveController).
 *   GET /v1/leave/my                 — leave.balance.read; the caller's own
 *     requests (no employeeName — the caller's name is filled in by the tab).
 *
 * Both are paged and ordered by recency, not by date, so a month cannot be
 * requested on its own: every page is walked (up to CALENDAR_MAX_PAGES) and
 * the tab buckets the APPROVED rows per day. When the cap is hit the result
 * says so (`truncated`) and the tab shows an honest "showing N of M" note.
 *
 * Query keys sit under ['hrms','leave','approvals'] and ['hrms','leave','my']
 * so useLeaveDecision / useApplyLeave / useCancelLeave invalidations refresh
 * the calendar as well.
 */

const CALENDAR_PAGE_SIZE = 100
const CALENDAR_MAX_PAGES = 10

export interface LeaveCalendarFeed {
  rows: LeaveRequestResponse[]
  /** Server-side total for the list, across all pages. */
  totalElements: number
  /** True when the page cap stopped the walk before the last page. */
  truncated: boolean
}

interface LeavePage {
  content: LeaveRequestResponse[]
  totalElements: number
  totalPages?: number
  last?: boolean
}

async function fetchAllPages(path: string): Promise<LeaveCalendarFeed> {
  const rows: LeaveRequestResponse[] = []
  let totalElements = 0
  for (let page = 0; page < CALENDAR_MAX_PAGES; page++) {
    const res = await apiJson<LeavePage>(`${path}?page=${page}&size=${CALENDAR_PAGE_SIZE}`)
    rows.push(...(res.content ?? []))
    totalElements = res.totalElements ?? rows.length
    const isLast = res.last ?? (res.totalPages != null ? page + 1 >= res.totalPages : (res.content ?? []).length < CALENDAR_PAGE_SIZE)
    if (isLast) return { rows, totalElements, truncated: false }
  }
  return { rows, totalElements, truncated: rows.length < totalElements }
}

/** Decided requests visible to this approver (see docblock above). */
export function useLeaveCalendarTeam(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'approvals', 'history', 'calendar'],
    queryFn: () => fetchAllPages('/v1/leave/approvals/history'),
    enabled,
    staleTime: 30_000,
  })
}

/** The caller's own requests. */
export function useLeaveCalendarSelf(enabled: boolean) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'my', 'calendar'],
    queryFn: () => fetchAllPages('/v1/leave/my'),
    enabled,
    staleTime: 30_000,
  })
}
