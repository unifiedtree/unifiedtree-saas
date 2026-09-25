import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * Upcoming people milestones — birthdays, work anniversaries, retirements.
 *
 * Backend: GET /v1/hrms/milestones (MilestonesController, canonical-prod).
 * Only requires isAuthenticated(), so every signed-in user in the tenant can
 * read it — birthdays are the one HR surface the whole company cares about,
 * and the payload carries no salary or contact PII.
 *
 * The mobile app has consumed this endpoint since the milestones screen
 * shipped (Attendance_App/services/api/milestones.api.ts); this hook is the
 * web half of that parity, requested by the client on 2026-08-22.
 */

/** One upcoming milestone. */
export interface Milestone {
  employeeId: string
  name: string
  /** Pre-computed initials for the avatar circle; never empty. */
  initials: string
  department: string | null
  /**
   * ISO yyyy-MM-dd of the NEXT occurrence, already rolled forward server-side
   * — not the original birth or joining date. Someone born in 1990 whose
   * birthday falls next week comes back with next week's date.
   */
  date: string
  /** Which anniversary this is (1 = first year). Null for birthdays. */
  years: number | null
}

export interface MilestonesResponse {
  birthdays: Milestone[]
  anniversaries: Milestone[]
  retirements: Milestone[]
}

export interface MilestonesParams {
  /** Look-ahead for birthdays in days. Server default 7, clamped 1-366. */
  birthdayDays?: number
  /** Look-ahead for work anniversaries in days. Server default 31, clamped 1-366. */
  anniversaryDays?: number
  /** Look-ahead for retirements in months. Server default 6, clamped 1-60. */
  retirementMonths?: number
}

/** Milestones move once a day at most — no point re-fetching on every focus. */
const STALE_MS = 10 * 60_000

/** One of the three lists. */
export type MilestoneKind = keyof MilestonesResponse

/** A chosen date range (yyyy-MM-dd), both ends included, at most 12 months. */
export interface MilestoneRange {
  from: string
  to: string
}

/** The server's parameter prefix for each list's range (birthdayFrom, birthdayTo, …). */
const RANGE_PARAM: Record<MilestoneKind, string> = { birthdays: 'birthday', anniversaries: 'anniversary', retirements: 'retirement' }

/**
 * One list over a chosen date range (the dashboard card's presets and custom
 * range). Same endpoint and access as useMilestones; the server works out each
 * person's date inside the range (year end, 29 February, anniversaries of at
 * least one year). Disabled while `range` is null.
 */
export function useMilestonesBetween(kind: MilestoneKind, range: MilestoneRange | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'milestones', 'range', kind, range?.from ?? '', range?.to ?? ''],
    queryFn: async (): Promise<Milestone[]> => {
      const p = RANGE_PARAM[kind]
      const qs = new URLSearchParams({ [`${p}From`]: range!.from, [`${p}To`]: range!.to })
      const data = await apiJson<Partial<MilestonesResponse>>(`/v1/hrms/milestones?${qs}`)
      return data?.[kind] ?? []
    },
    staleTime: STALE_MS,
    enabled: !!range && (options?.enabled ?? true),
  })
}

export function useMilestones(params: MilestonesParams = {}, options?: { enabled?: boolean }) {
  const { birthdayDays = 14, anniversaryDays = 31, retirementMonths = 6 } = params
  const qs = new URLSearchParams({
    birthdayDays: String(birthdayDays),
    anniversaryDays: String(anniversaryDays),
    retirementMonths: String(retirementMonths),
  })
  return useQuery({
    queryKey: ['hrms', 'milestones', birthdayDays, anniversaryDays, retirementMonths],
    queryFn: async (): Promise<MilestonesResponse> => {
      const data = await apiJson<Partial<MilestonesResponse>>(`/v1/hrms/milestones?${qs}`)
      // Defend against a partial payload: the widget maps over all three
      // arrays and an absent key would crash the render rather than show an
      // empty column. Mirrors the app client's guard.
      return {
        birthdays: data?.birthdays ?? [],
        anniversaries: data?.anniversaries ?? [],
        retirements: data?.retirements ?? [],
      }
    },
    staleTime: STALE_MS,
    enabled: options?.enabled ?? true,
  })
}

/**
 * People reaching their company's retirement age (HR Configuration, from their
 * date of birth) within the next `days` days, soonest first.
 * Backend: GET /v1/hrms/retirements/due (needs hrms.employee.read).
 */
export interface RetirementDue {
  employeeId: string
  employeeCode: string
  name: string
  initials: string
  department: string | null
  designation: string | null
  companyName: string
  retirementAge: number
  /** yyyy-MM-dd: the day they reach the retirement age. */
  retirementDate: string
  daysLeft: number
}

export function useRetirementsDue(days: number, options?: { companyId?: string; enabled?: boolean }) {
  const companyId = options?.companyId
  return useQuery({
    queryKey: ['hrms', 'retirements', 'due', days, companyId ?? 'all'],
    queryFn: () => apiJson<RetirementDue[]>(`/v1/hrms/retirements/due?days=${days}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`),
    staleTime: STALE_MS,
    enabled: options?.enabled ?? true,
  })
}

/**
 * People whose retirement date falls inside a chosen range (both ends
 * included, at most 12 months), soonest first — the card's range for people
 * who can read employee records. Backend: GET /v1/hrms/retirements/due?from=&to=.
 */
export function useRetirementsBetween(range: MilestoneRange | null, options?: { companyId?: string; enabled?: boolean }) {
  const companyId = options?.companyId
  return useQuery({
    queryKey: ['hrms', 'retirements', 'range', range?.from ?? '', range?.to ?? '', companyId ?? 'all'],
    queryFn: () => {
      const qs = new URLSearchParams({ from: range!.from, to: range!.to })
      if (companyId) qs.set('companyId', companyId)
      return apiJson<RetirementDue[]>(`/v1/hrms/retirements/due?${qs}`)
    },
    staleTime: STALE_MS,
    enabled: !!range && (options?.enabled ?? true),
  })
}
