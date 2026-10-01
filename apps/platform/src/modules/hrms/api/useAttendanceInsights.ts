// Attendance analytics read models (P-ATT-PLAN, BW-20 / BW-21). Both need attendance.team.read and answer for the
// caller's team (HR and admins: their company; a manager: their team).
//   GET /v1/attendance/dashboard/breakdown?from&to&by=department|branch
//   GET /v1/attendance/punctuality?from&to
// A server without them (404) leaves those blocks out instead of failing the page (notAvailable).
import { apiJson } from '@/core/api/client'
import { asAvailable, useAvailableQuery } from './shared/available'

/** Counts over person-days (working days only: not a weekly off or a holiday, up to today). */
export interface InsightStats {
  workingDays: number
  attendedDays: number
  lateDays: number
  leaveDays: number
  absentDays: number
  notMarkedDays: number
  /** attended ÷ (attended + absent + not marked), leave left out; null with nothing to count. */
  ratePct: number | null
  /** absent ÷ working days; null with nothing to count. */
  unplannedAbsencePct: number | null
  arrivals: number
  /** Average minutes after the shift's start (negative = before); null without arrivals. */
  avgArrivalMinutes: number | null
  /** The average arrival time, "HH:mm"; null without arrivals. */
  avgArrivalTime: string | null
}

export interface InsightGroup {
  /** The department or branch; null for people with none. */
  id: string | null
  name: string | null
  people: number
  current: InsightStats
  previous: InsightStats
}

export interface AttendanceBreakdown {
  from: string
  to: string
  by: 'department' | 'branch'
  previousFrom: string
  previousTo: string
  people: number
  overall: InsightStats
  previous: InsightStats
  groups: InsightGroup[]
}

export interface PunctualityRow {
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  departmentName: string | null
  lateDays: number
  avgDelayMinutes: number | null
  /** ISO weekday 1 (Monday) … 7 (Sunday). */
  worstWeekday: number | null
  worstWeekdayLateDays: number
  previousLateDays: number
}

export interface Punctuality {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  totals: { lateDays: number; people: number; avgDelayMinutes: number | null; previousLateDays: number }
  rows: PunctualityRow[]
}

export const INSIGHTS_KEY = ['hrms', 'attendance', 'insights'] as const

export function useAttendanceBreakdown(from: string, to: string, by: 'department' | 'branch', enabled = true) {
  return useAvailableQuery<AttendanceBreakdown>({
    queryKey: [...INSIGHTS_KEY, 'breakdown', from, to, by],
    queryFn: () => asAvailable(() => apiJson<AttendanceBreakdown>(`/v1/attendance/dashboard/breakdown?${new URLSearchParams({ from, to, by })}`)),
    enabled: enabled && !!from && !!to,
    staleTime: 60_000,
  })
}

export function usePunctuality(from: string, to: string, enabled = true) {
  return useAvailableQuery<Punctuality>({
    queryKey: [...INSIGHTS_KEY, 'punctuality', from, to],
    queryFn: () => asAvailable(() => apiJson<Punctuality>(`/v1/attendance/punctuality?${new URLSearchParams({ from, to })}`)),
    enabled: enabled && !!from && !!to,
    staleTime: 60_000,
  })
}
