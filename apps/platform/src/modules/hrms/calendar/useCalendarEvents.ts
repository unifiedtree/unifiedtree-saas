// The month calendar's data, all from endpoints that already exist:
//   approved leave   GET /v1/leave/calendar?from=&to=&statuses=APPROVED (scoped by the server: the workspace
//                    for HR, the team for approvers, else your own; at most 62 days)
//   holidays         GET /v1/settings/holidays?companyId=&from=&to=
//   birthdays and work anniversaries   GET /v1/hrms/milestones?birthdayFrom=…&anniversaryFrom=…
// Each source loads and fails on its own: a failed one is reported, the others still show.
import { useMemo } from 'react'
import { useLeaveCalendarFeed } from '../api/useLeave'
import { useHolidaysBetween, useMilestonesBetween } from '../api/useMilestones'
import { holidayEvents, leaveEvents, leaveWindow, milestoneEvents, type CalEvent } from './calendarEvents'

export interface CalendarSources {
  events: CalEvent[]
  loading: boolean
  /** Which sources failed ("leave", "holidays", "birthdays and anniversaries"). */
  failed: string[]
  /** The leave feed only covered the first 62 days of the range. */
  leaveClipped: boolean
  /** The scope the server used for leave: TENANT, TEAM or SELF (undefined until known). */
  leaveScope?: string
  refetch: () => void
}

export function useCalendarEvents(from: string, to: string, opts: { companyId?: string; canLeave: boolean; people?: boolean; enabled?: boolean }): CalendarSources {
  const on = opts.enabled ?? true
  const lw = leaveWindow(from, to)
  const range = { from, to }
  const leave = useLeaveCalendarFeed(lw.from, lw.to, ['APPROVED'], on && opts.canLeave)
  const holidays = useHolidaysBetween(opts.companyId, range, { enabled: on })
  const birthdays = useMilestonesBetween('birthdays', range, { enabled: on && (opts.people ?? true) })
  const anniversaries = useMilestonesBetween('anniversaries', range, { enabled: on && (opts.people ?? true) })

  const events = useMemo(() => [
    ...holidayEvents(holidays.data ?? [], from, to),
    ...leaveEvents(leave.data?.entries ?? [], from, to),
    ...milestoneEvents('birthday', birthdays.data ?? [], from, to),
    ...milestoneEvents('anniversary', anniversaries.data ?? [], from, to),
  ], [holidays.data, leave.data, birthdays.data, anniversaries.data, from, to])

  const failed: string[] = []
  if (leave.isError) failed.push('leave')
  if (holidays.isError) failed.push('holidays')
  if (birthdays.isError || anniversaries.isError) failed.push('birthdays and anniversaries')

  return {
    events,
    // isLoading is false for a disabled query, so a source that isn't asked for never holds the calendar.
    loading: leave.isLoading || holidays.isLoading || birthdays.isLoading || anniversaries.isLoading,
    failed,
    leaveClipped: opts.canLeave && lw.clipped,
    leaveScope: leave.data?.scope,
    refetch: () => {
      if (leave.isError) void leave.refetch()
      if (holidays.isError) void holidays.refetch()
      if (birthdays.isError) void birthdays.refetch()
      if (anniversaries.isError) void anniversaries.refetch()
    },
  }
}
