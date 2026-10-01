// "Your day" from the web (V143.53 redesign, BW-25/26/27): today's record, status and shift,
// worked time less breaks, breaks, and what the person may do from the browser.
//   GET  /v1/attendance/my-day          attendance.checkin.self
//   POST /v1/attendance/breaks/start    (where web check-in is on)
//   POST /v1/attendance/breaks/end
//   POST /v1/attendance/checkout/undo   (own check-out, within 10 minutes, where web check-in is on)
// A server without these answers 404 (or 503 FEATURE_NOT_READY): the hook reports `notAvailable`
// and the page hides the block, never an error. Breaks never change stored hours or pay.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { AttendanceDto } from '../../api/useAttendance'
import { asAvailable, useAvailableQuery } from '../../api/shared/available'

export interface MyDayShift {
  name: string
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
  /** yyyy-MM-dd: today, or yesterday while a night shift is still open. */
  date: string
  record: AttendanceDto | null
  /** PRESENT · LATE · HALF_DAY · ABSENT · NOT_MARKED · ON_LEAVE · HOLIDAY · WEEKLY_OFF · NOT_TRACKED */
  status: string | null
  statusNote: string | null
  shift: MyDayShift | null
  checkedIn: boolean
  checkedOut: boolean
  workedMinutes: number | null
  /** Worked less breaks: the number "Your day" shows. */
  activeMinutes: number | null
  onBreak: boolean
  breakStartedAt: string | null
  breakMinutes: number
  breaks: BreakSpan[]
  /** Web check-in is on for the company (the default) and the server can store it. */
  webPunchAllowed: boolean
  canUndoCheckOut: boolean
  undoCheckOutUntil: string | null
}

export interface MyDayBreaks { onBreak: boolean; breakStartedAt: string | null; breakMinutes: number; breaks: BreakSpan[] }

export const MY_DAY_KEY = ['hrms', 'attendance', 'my-day'] as const

export function useMyDay(opts?: { enabled?: boolean }) {
  return useAvailableQuery<MyDay>({
    queryKey: MY_DAY_KEY,
    queryFn: () => asAvailable(() => apiJson<MyDay>('/v1/attendance/my-day')),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    // The worked-time figure moves while checked in.
    refetchInterval: 60_000,
  })
}

/** Everything a punch, a break or an undo changes: your day, today's record, the month. */
export function refreshAfterPunch(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: MY_DAY_KEY })
  qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] })
  qc.invalidateQueries({ queryKey: ['attendance'] })
}

export function useBreak() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'end') => apiJson<MyDayBreaks>(`/v1/attendance/breaks/${action}`, { method: 'POST', body: '{}' }),
    onSuccess: () => refreshAfterPunch(qc),
  })
}

export function useUndoCheckOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<AttendanceDto>('/v1/attendance/checkout/undo', { method: 'POST', body: '{}' }),
    onSuccess: () => refreshAfterPunch(qc),
  })
}
