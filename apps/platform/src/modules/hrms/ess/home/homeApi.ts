// The self-service Home's own reads and actions (redesign P-HOME):
//   GET  /v1/attendance/my-day            "Your day" (P-ATT-DAY, BW-27; attendance.checkin.self)
//   POST /v1/attendance/breaks/start|end   breaks pause the Your day timer only (BW-26)
//   POST /v1/attendance/checkout/undo      take back one's own check-out within 10 minutes (BW-25)
//   GET  /v1/ess/my-requests?limit=        My requests (BW-119)
//   GET  /v1/ess/needs-you                 Needs you (BW-120)
//   GET  /v1/ess/around-me?days=           Upcoming events (BW-121)
//   GET  /v1/attendance/assisted-punch/eligible   who a manager may punch for (V143.40)
// The lists answer "not available" (404, or 503 FEATURE_NOT_READY) before their
// backend is live; each block then hides instead of erroring (DECISIONS 18).
// P-ATT-DAY's own hooks for the day may later replace the first three here.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { AttendanceDto } from '../../api/useAttendance'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from '../../api/shared/available'

/** Query-key prefixes. My day sits under today's attendance prefix, so attendance changes refresh it. */
export const HOME_KEYS = {
  myDay: ['hrms', 'attendance', 'my-day'],
  ess: ['ess'],
  myRequests: ['ess', 'my-requests'],
  needsYou: ['ess', 'needs-you'],
  aroundMe: ['ess', 'around-me'],
  eligible: ['attendance', 'assisted-punch', 'eligible'],
} as const

// ── Your day ────────────────────────────────────────────────────────────────

export interface MyDayShift {
  name: string | null
  /** IST "HH:mm". */
  start: string | null
  end: string | null
  graceMinutes: number | null
  workingHours: number | null
  expectedStart: string | null
  expectedEnd: string | null
}

export interface BreakSpan { startedAt: string; endedAt: string | null }

export interface MyDay {
  date: string
  record: AttendanceDto | null
  /** PRESENT, LATE, HALF_DAY, ABSENT, NOT_MARKED, ON_LEAVE, HOLIDAY, WEEKLY_OFF, NOT_TRACKED. */
  status: string | null
  statusNote: string | null
  shift: MyDayShift | null
  checkedIn: boolean
  checkedOut: boolean
  /** Check-in to check-out (or to now). */
  workedMinutes: number | null
  /** Worked less breaks: the number "Your day" shows. */
  activeMinutes: number | null
  onBreak: boolean
  breakStartedAt: string | null
  breakMinutes: number
  breaks: BreakSpan[]
  /** The company's "Allow web check-in" (and its migration): breaks and undo need it. */
  webPunchAllowed: boolean
  canUndoCheckOut: boolean
  undoCheckOutUntil: string | null
}

export interface BreaksResponse { onBreak: boolean; breakStartedAt: string | null; breakMinutes: number; breaks: BreakSpan[] }

export function myDayQuery(api: ApiFetch = defaultApi): SharedQueryOptions<MyDay> {
  return { queryKey: HOME_KEYS.myDay, queryFn: () => asAvailable(() => api<MyDay>('/v1/attendance/my-day')) }
}

export function useMyDay(enabled: boolean) {
  // The timer moves on the page; a refetch each minute keeps check-out, breaks and undo windows true.
  return useAvailableQuery<MyDay>({ ...myDayQuery(), enabled, staleTime: 20_000, refetchInterval: 60_000 })
}

function useDayAction<R>(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<R>(path, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] }),
  })
}

export const useStartBreak = () => useDayAction<BreaksResponse>('/v1/attendance/breaks/start')
export const useEndBreak = () => useDayAction<BreaksResponse>('/v1/attendance/breaks/end')
export const useUndoCheckOut = () => useDayAction<AttendanceDto>('/v1/attendance/checkout/undo')

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
