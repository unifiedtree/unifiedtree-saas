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
