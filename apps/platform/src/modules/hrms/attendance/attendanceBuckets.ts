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
}

/** A day's roster from GET /v1/attendance/dashboard. Nobody is absent until the day is over. */
export function dayBuckets(resp: TeamDashboardResponse, today: string): DayBuckets {
  const n = { regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, noPunch: 0, earlyOut: 0 }
  let other = 0
  for (const s of resp.staffStatuses) {
    if (s.earlyCheckout) n.earlyOut++
    // The server's effective status (company attendance policy + reviewers' changes) when it sends one.
    const eff = s.effectiveStatus
    if (eff) {
      if (eff === 'PRESENT') { if (s.attendanceType === 'WFH') n.wfh++; else n.regular++ }
      else if (eff === 'LATE') n.late++
      else if (eff === 'HALF_DAY') n.halfDay++
      else if (eff === 'ON_LEAVE') n.onLeave++
      else if (eff === 'ABSENT' || eff === 'NOT_MARKED') n.noPunch++
      else other++ // holiday, weekly off, not tracked
      continue
    }
    if (!s.checkInAt) { if (s.onLeave) n.onLeave++; else n.noPunch++ }
    else if (s.status === 'HALF_DAY') n.halfDay++
    else if (s.status === 'LATE') n.late++
    else if (s.attendanceType === 'WFH') n.wfh++
    else n.regular++
  }
  const over = resp.date < today
  return {
    total: resp.staffStatuses.length, present: n.regular + n.late + n.halfDay + n.wfh, regular: n.regular, late: n.late, halfDay: n.halfDay, wfh: n.wfh,
    onLeave: n.onLeave, notMarked: over ? 0 : n.noPunch, absent: over ? n.noPunch : 0, earlyOut: n.earlyOut, other,
  }
}

/**
 * A day from GET /v1/attendance/dashboard/trend. People on leave without a punch
 * are notMarked − absent; the API's absent (no punch, no leave) is "not marked
 * yet" until the day is over. Each person is in one bucket (the server counts
 * from effective statuses, V143.10), so present + late + half day + work from
 * home is the number who came in. Early departures aren't in the trend.
 */
export function trendBuckets(r: DailyAttendanceCounts, today: string): DayBuckets {
  const present = r.present + r.late + r.halfDay + r.workFromHome, leave = Math.max(0, r.notMarked - r.absent), over = r.date < today
  return {
    total: present + leave + r.absent, present, regular: r.present, late: r.late, halfDay: r.halfDay, wfh: r.workFromHome,
    onLeave: leave, notMarked: over ? 0 : r.absent, absent: over ? r.absent : 0, earlyOut: 0, other: 0,
  }
}
