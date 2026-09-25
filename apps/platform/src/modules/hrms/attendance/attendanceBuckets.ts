// Attendance numbers for the designed pages (dashboard, Attendance & Time), one
// bucket per person so they add up to the roster. The API's own counts overlap:
// its `notMarked` includes people on leave and its `absent`, and `workFromHome`
// is a type that can also be late or half-day.
import type { DailyAttendanceCounts, TeamDashboardResponse } from '../api/useAttendance'

export interface DayBuckets {
  total: number
  /** Everyone who checked in ("Came in"). */
  present: number
  /** The on-time part of `present`. */
  regular: number
  late: number
  halfDay: number
  wfh: number
  /** On approved leave and no punch. */
  onLeave: number
  /** No punch, no leave, day not over yet. */
  notMarked: number
  /** No punch, no leave, day over. */
  absent: number
  earlyOut: number
  other: number
  /** The day is a weekly off for everyone in scope (from the trend API; unknown on older servers). */
  weeklyOff?: boolean
}

/** A day's roster from GET /v1/attendance/dashboard. Nobody is absent until the day is over. */
export function dayBuckets(resp: TeamDashboardResponse, today: string): DayBuckets {
  const n = { regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, noPunch: 0, earlyOut: 0 }
  for (const s of resp.staffStatuses) {
    if (s.earlyCheckout) n.earlyOut++
    if (!s.checkInAt) { if (s.onLeave) n.onLeave++; else n.noPunch++ }
    else if (s.status === 'HALF_DAY') n.halfDay++
    else if (s.status === 'LATE') n.late++
    else if (s.attendanceType === 'WFH') n.wfh++
    else n.regular++
  }
  const over = resp.date < today
  return {
    total: resp.staffStatuses.length, present: n.regular + n.late + n.halfDay + n.wfh, regular: n.regular, late: n.late, halfDay: n.halfDay, wfh: n.wfh,
    onLeave: n.onLeave, notMarked: over ? 0 : n.noPunch, absent: over ? n.noPunch : 0, earlyOut: n.earlyOut, other: 0,
  }
}

/**
 * A day from GET /v1/attendance/dashboard/trend. People on leave without a punch
 * are notMarked − absent; the API's absent (no punch, no leave) is "not marked
 * yet" until the day is over. "Came in" is the API's per-day checked-in total, so
 * someone who worked from home and was also late or half-day counts once, as a
 * late / half-day (the WFH bucket is the on-time home workers). Servers older
 * than V143.25 don't send that total; their days fall back to adding the buckets
 * up, which counts that person twice. Early departures aren't in the trend.
 */
export function trendBuckets(r: DailyAttendanceCounts, today: string): DayBuckets {
  const exact = typeof r.checkedIn === 'number'
  const wfh = exact ? r.workFromHomeOnTime ?? Math.max(0, r.checkedIn! - r.present - r.late - r.halfDay) : r.workFromHome
  const present = exact ? r.checkedIn! : r.present + r.late + r.halfDay + r.workFromHome
  const leave = Math.max(0, r.notMarked - r.absent), over = r.date < today
  return {
    total: present + leave + r.absent, present, regular: r.present, late: r.late, halfDay: r.halfDay, wfh,
    onLeave: leave, notMarked: over ? 0 : r.absent, absent: over ? r.absent : 0, earlyOut: 0, other: 0,
    ...(typeof r.weeklyOffDay === 'boolean' ? { weeklyOff: r.weeklyOffDay } : {}),
  }
}

/**
 * Weekdays (0 = Sunday … 6 = Saturday) that were a weekly off for everyone on
 * every day seen, for days the trend doesn't cover. Sunday when nothing is known
 * (no trend yet, or an older server).
 */
export function offWeekdays(daily: Record<string, DayBuckets>): number[] {
  const seen = new Map<number, boolean>()
  for (const [iso, d] of Object.entries(daily)) {
    if (typeof d.weeklyOff !== 'boolean') continue
    const wd = new Date(iso + 'T00:00:00').getDay()
    seen.set(wd, (seen.get(wd) ?? true) && d.weeklyOff)
  }
  if (!seen.size) return [0]
  return [...seen].filter(([, off]) => off).map(([wd]) => wd).sort()
}

/** Whether a day is a weekly off: the trend's answer for that day, else the weekday pattern. */
export function isWeeklyOff(iso: string, daily: Record<string, DayBuckets>, offDays: number[]): boolean {
  const d = daily[iso]
  if (d && typeof d.weeklyOff === 'boolean') return d.weeklyOff
  return offDays.includes(new Date(iso + 'T00:00:00').getDay())
}
