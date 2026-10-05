// The self-service Home's own reads and actions (redesign P-HOME):
//   Your day, breaks and undo check-out: P-ATT-DAY's shared hooks, re-exported below
//   GET  /v1/ess/my-requests?limit=        My requests (BW-119)
//   GET  /v1/ess/needs-you                 Needs you (BW-120)
//   GET  /v1/ess/around-me?days=           Upcoming events (BW-121)
//   GET  /v1/attendance/assisted-punch/eligible   who a manager may punch for (V143.40)
// The lists answer "not available" (404, or 503 FEATURE_NOT_READY) before their
// backend is live; each block then hides instead of erroring (DECISIONS 18).
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from '../../api/shared/available'
import { fromAroundMe, fromCelebrations, type CelebrationsData } from './peopleModel'
import { fromWishes, type WishOccasion, type WishesData } from './wishModel'

/** Query-key prefixes for Home's own lists. */
export const HOME_KEYS = {
  ess: ['ess'],
  myRequests: ['ess', 'my-requests'],
  needsYou: ['ess', 'needs-you'],
  aroundMe: ['ess', 'around-me'],
  celebrations: ['ess', 'celebrations'],
  wishes: ['ess', 'celebration-wishes'],
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
    // Its own key under the shared prefix: AssistedPunchDialog caches the raw list at [...eligible, q],
    // and this hook caches an Availability wrapper, so the two must never share an entry.
    queryKey: [...HOME_KEYS.eligible, 'home', q],
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

export function useMeEmployee(opts?: { enabled?: boolean }) {
  return useQuery({ queryKey: ['employee', 'me'], queryFn: () => apiJson<MeEmployee>('/v1/employees/me'), staleTime: 60_000, retry: false, enabled: opts?.enabled ?? true })
}

// ── Celebrations (birthdays, work anniversaries, Welcome aboard) ────────────
//   GET /v1/ess/celebrations?days=   a week back to `days` ahead, and who joined in the last 30 days.
// A server without it (404) falls back to around-me's birthdays and anniversaries, with no
// Welcome aboard; the mobile app reads it the same way (services/api/celebrations.api.ts).

export function celebrationsQuery(days: number, api: ApiFetch = defaultApi): SharedQueryOptions<CelebrationsData> {
  return {
    queryKey: [...HOME_KEYS.celebrations, days],
    queryFn: async () => {
      const own = await asAvailable(() => api<Parameters<typeof fromCelebrations>[0]>(`/v1/ess/celebrations?days=${days}`))
      if (own.available) return { available: true, value: fromCelebrations(own.value) }
      const around = await asAvailable(() => api<AroundMeResponse>(`/v1/ess/around-me?days=${days}`))
      return around.available ? { available: true, value: fromAroundMe(around.value.items) } : around
    },
  }
}

export function useCelebrations(days = 30, enabled = true) {
  return useAvailableQuery<CelebrationsData>({ ...celebrationsQuery(days), enabled, staleTime: 5 * 60_000 })
}

// ── Send wishes (V143_84) ───────────────────────────────────────────────────
//   GET  /v1/ess/celebrations/wishes   what I received this week and what I sent (wishModel.ts)
//   POST /v1/ess/celebrations/wishes   { toEmployeeId, occasion, message } → { wish, created }
// Anyone who sees Celebrations. Not available (404, or 503 before the migration): no button.

export const WISHES_PATH = '/v1/ess/celebrations/wishes'

export function celebrationWishesQuery(api: ApiFetch = defaultApi): SharedQueryOptions<WishesData> {
  return {
    queryKey: HOME_KEYS.wishes,
    queryFn: async () => {
      const got = await asAvailable(() => api<Parameters<typeof fromWishes>[0]>(WISHES_PATH))
      return got.available ? { available: true, value: fromWishes(got.value) } : got
    },
  }
}

export function useCelebrationWishes(enabled = true) {
  return useAvailableQuery<WishesData>({ ...celebrationWishesQuery(), enabled, staleTime: 60_000 })
}

export interface SendWishRequest { toEmployeeId: string; occasion: WishOccasion; message: string }

export interface SendWishResult {
  wish: { id: string; toEmployeeId: string; occasion: string; occasionDate: string; message: string; createdAt: string }
  /** False: the same wish was sent before, so nobody was told again. */
  created: boolean
}

/** Sends a wish; the button reads "Wished" straight away, then the list is read again. */
export function sendWishMutation(qc: QueryClient, api: ApiFetch = defaultApi): SharedMutationOptions<SendWishResult, SendWishRequest> {
  return {
    mutationFn: (body) => asAvailable(() => api<SendWishResult>(WISHES_PATH, { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: (result) => {
      if (result.available) {
        const w = result.value.wish
        qc.setQueryData<Availability<WishesData>>(HOME_KEYS.wishes, (cur) => (cur && cur.available
          ? { available: true, value: { ...cur.value, sent: [{ toEmployeeId: w.toEmployeeId, occasion: w.occasion, occasionDate: String(w.occasionDate).slice(0, 10) }, ...cur.value.sent] } }
          : cur))
      }
      return qc.invalidateQueries({ queryKey: HOME_KEYS.wishes })
    },
  }
}

export function useSendWish() {
  const qc = useQueryClient()
  return useAvailableMutation(sendWishMutation(qc))
}
