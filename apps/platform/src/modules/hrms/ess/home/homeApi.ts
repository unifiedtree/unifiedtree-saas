// The self-service Home's own reads and actions (redesign P-HOME):
//   Your day, breaks and undo check-out: P-ATT-DAY's shared hooks, re-exported below
//   GET  /v1/ess/my-requests?limit=        My requests (BW-119)
//   GET  /v1/ess/needs-you                 Needs you (BW-120)
//   GET  /v1/ess/around-me?days=           Upcoming events (BW-121)
//   GET  /v1/attendance/assisted-punch/eligible   who a manager may punch for (V143.40)
// The lists answer "not available" (404, or 503 FEATURE_NOT_READY) before their
// backend is live; each block then hides instead of erroring (DECISIONS 18).
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from '../../api/shared/available'

/** Query-key prefixes for Home's own lists. */
export const HOME_KEYS = {
  ess: ['ess'],
  myRequests: ['ess', 'my-requests'],
  needsYou: ['ess', 'needs-you'],
  aroundMe: ['ess', 'around-me'],
  eligible: ['attendance', 'assisted-punch', 'eligible'],
} as const

// ── Your day: P-ATT-DAY's shared hooks (attendance/webpunch/useMyDay) ─────────

export { useMyDay, useBreak, useUndoCheckOut, MY_DAY_KEY, refreshAfterPunch } from '../../attendance/webpunch/useMyDay'
export type { MyDay, MyDayShift, BreakSpan } from '../../attendance/webpunch/useMyDay'

// ── My requests ─────────────────────────────────────────────────────────────

export type RequestKind = 'LEAVE' | 'WFH' | 'CORRECTION' | 'SHIFT_CHANGE' | 'EXPENSE' | 'ADVANCE' | 'TIMESHEET'
export type RequestState = 'WAITING' | 'APPROVED' | 'DONE' | 'REJECTED' | 'CANCELLED'

export interface RequestStep { label: string; state: 'DONE' | 'CURRENT' | 'TODO' | 'SKIPPED'; personName: string | null; at: string | null }

export interface MyRequest {
  kind: RequestKind | (string & {})
  id: string
  title: string
  fromDate: string | null
  toDate: string | null
  days: number | null
  amount: number | null
  currency: string | null
  status: string
  state: RequestState | (string & {})
  statusLabel: string
  progress: number
  steps: RequestStep[]
  waitingForName: string | null
  decidedByName: string | null
  createdAt: string | null
  lastActivityAt: string | null
  link: string
}

export interface MyRequestsResponse { requests: MyRequest[]; included: string[]; unavailable: string[] }

export function myRequestsQuery(limit: number, api: ApiFetch = defaultApi): SharedQueryOptions<MyRequestsResponse> {
  return {
    queryKey: [...HOME_KEYS.myRequests, limit],
    queryFn: () => asAvailable(() => api<MyRequestsResponse>(`/v1/ess/my-requests?limit=${limit}`)),
  }
}

export function useMyRequests(limit = 6, enabled = true) {
  return useAvailableQuery<MyRequestsResponse>({ ...myRequestsQuery(limit), enabled, staleTime: 30_000, refetchInterval: 60_000 })
}

// ── Needs you ───────────────────────────────────────────────────────────────

export type NeedsTone = 'bad' | 'gold' | 'blue' | 'brand'

export interface NeedsYouItem {
  kind: string
  title: string
  detail: string | null
  onDate: string | null
  dueDate: string | null
  tone: NeedsTone | (string & {})
  refId: string | null
  /** How many things the row stands for (grouped rows); 1 otherwise. */
  count: number
  link: string
}

export interface NeedsYouResponse { items: NeedsYouItem[]; count: number; included: string[]; unavailable: string[] }

export function needsYouQuery(api: ApiFetch = defaultApi): SharedQueryOptions<NeedsYouResponse> {
  return { queryKey: HOME_KEYS.needsYou, queryFn: () => asAvailable(() => api<NeedsYouResponse>('/v1/ess/needs-you')) }
}

export function useNeedsYou(enabled = true) {
  return useAvailableQuery<NeedsYouResponse>({ ...needsYouQuery(), enabled, staleTime: 30_000, refetchInterval: 120_000 })
}

// ── Upcoming events (around me) ─────────────────────────────────────────────

export type AroundKind = 'BIRTHDAY' | 'WORK_ANNIVERSARY' | 'RETIREMENT' | 'HOLIDAY' | 'NOTICE' | 'PAYDAY' | 'PROBATION_END'

export interface AroundItem {
  kind: AroundKind | (string & {})
  date: string
  /** ON (the day it happens) or POSTED (a notice without an event date: the day it was posted). */
  dateKind: 'ON' | 'POSTED' | (string & {})
  title: string
  detail: string | null
  tag: string | null
  refId: string | null
  employeeId: string | null
  departmentName: string | null
  years: number | null
  link: string | null
}

export interface AroundMeResponse { from: string; to: string; items: AroundItem[]; included: string[]; unavailable: string[] }

export function aroundMeQuery(days: number, api: ApiFetch = defaultApi): SharedQueryOptions<AroundMeResponse> {
  return {
    queryKey: [...HOME_KEYS.aroundMe, days],
    queryFn: () => asAvailable(() => api<AroundMeResponse>(`/v1/ess/around-me?days=${days}`)),
  }
}

export function useAroundMe(days = 30, enabled = true) {
  return useAvailableQuery<AroundMeResponse>({ ...aroundMeQuery(days), enabled, staleTime: 5 * 60_000 })
}

// ── Punch for a team member (assisted face punch, V143.40) ─────────────────

export interface EligibleEmployee {
  employeeId: string
  employeeCode: string | null
  fullName: string
  jobTitle: string | null
  departmentName: string | null
  profilePhotoUrl: string | null
  /** ENROLLED · NOT_ENROLLED · LOCKED · NO_LOGIN */
  faceStatus: string
  todayStatus: string | null
  checkInTime: string | null
  checkOutTime: string | null
  sinceYesterday: boolean
}

export interface EligibleList { scope: 'TEAM' | 'ANY' | (string & {}); employees: EligibleEmployee[]; truncated: boolean }

export function useAssistedPunchEligible(enabled: boolean, q = '') {
  return useAvailableQuery<EligibleList>({
    queryKey: [...HOME_KEYS.eligible, q],
    queryFn: () => asAvailable(() => apiJson<EligibleList>(`/v1/attendance/assisted-punch/eligible${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
    enabled,
    staleTime: 30_000,
  })
}

// ── Your own employee record (today's /v1/employees/me) ─────────────────────

/** The fields Home, Work from home and Shift change read; the key is shared with today's pages. */
export interface MeEmployee {
  id: string
  companyId: string
  /** Own weekly offs, ISO days "6,7"; empty means the company's. */
  weeklyOffDays?: string | null
}

export function useMeEmployee() {
  return useQuery({ queryKey: ['employee', 'me'], queryFn: () => apiJson<MeEmployee>('/v1/employees/me'), staleTime: 60_000, retry: false })
}
