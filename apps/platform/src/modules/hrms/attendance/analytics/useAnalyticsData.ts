// Everything Attendance analytics shows for one month, from real endpoints (ported from AttendanceContainer, which
// still serves Daily tracking): today's live roster, the month's trend, check-in methods, holidays, the attendance
// summary and late-marks reports (hrms.report.attendance), the shifts' grace, and the redesign's breakdown.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { P, usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { useCompanies } from '../../api/useOrg'
import { useTeamDashboard, useAttendanceTrend, useAttendanceSources, type AttendanceSourceBreakdown } from '../../api/useAttendance'
import { useHolidays } from '../../api/useSettings'
import { useAttendanceSummaryReport, useLateMarksReport } from '../../api/useReports'
import { useShiftPolicies } from '../../api/useShiftPolicies'
import { useAttendanceBreakdown } from '../../api/useAttendanceInsights'
import { dayBuckets, trendBuckets, offWeekdays, type DayBuckets } from '../attendanceBuckets'
import { addDays, isOffDay } from './analyticsModel'

/** How a punch arrived: capture method → label (as the page has always named them). */
const SOURCE: Record<string, string> = {
  FACE_RECOGNITION: 'Face check-in', FACE: 'Face check-in', GPS: 'Mobile app (GPS)', MOBILE_GPS: 'Mobile app (GPS)', MOBILE: 'Mobile app',
  WEB: 'Web check-in', BIOMETRIC: 'Fingerprint device', BIOMETRIC_FINGERPRINT: 'Fingerprint device', BIOMETRIC_DEVICE: 'Fingerprint device', DEVICE: 'Fingerprint device',
  PIN: 'PIN', MANUAL: 'Added by HR', OVERRIDE: 'Manager override', MANAGER_OVERRIDE: 'Manager override', KIOSK: 'Kiosk', GEO_FENCE: 'Mobile app (GPS)', API: 'Another system',
}
export const sourceLabel = (m: string) => SOURCE[m] || m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ')

export interface MonthCounts { total: number; present: number; regular: number; late: number; halfDay: number; wfh: number; onLeave: number; notMarked: number; absent: number; earlyOut: number; other: number }

export function useAnalyticsData(m: { month: string; past: boolean; from: string; to: string }, today: string) {
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canReport = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const { data: companies = [] } = useCompanies()
  const companyId: string = companies[0]?.id ?? ''

  // People on their weekly off are listed (as "Day off"), so "Who's where today" counts everyone on a Sunday too.
  const teamToday = useTeamDashboard(today, undefined, canTeam, false, { includeWeeklyOff: true })
  const trend = useAttendanceTrend(m.from, m.to, undefined, canTeam)
  const sources = useAttendanceSources(today, undefined, canTeam && !m.past)
  // A past month: every check-in of the month. A server without the range answers for today, which is dropped.
  const monthSources = useQuery({
    queryKey: ['hrms', 'attendance', 'dashboard', 'sources', 'range', m.from, m.to],
    queryFn: () => apiJson<AttendanceSourceBreakdown>(`/v1/attendance/dashboard/sources?from=${m.from}&to=${m.to}`),
    staleTime: 60_000,
    enabled: canTeam && m.past,
  })
  const holidays = useHolidays(companyId, Number(m.month.slice(0, 4)))
  const summary = useAttendanceSummaryReport(canReport ? companyId || null : null, m.from, m.to, { enabled: true })
  const lateMarks = useLateMarksReport(canReport ? companyId || null : null, m.from, m.to)
  const policies = useShiftPolicies(companyId)
  const byDept = useAttendanceBreakdown(m.from, m.to, 'department', canTeam)
  const byBranch = useAttendanceBreakdown(m.from, m.to, 'branch', canTeam)

  const data = useMemo(() => {
    const idByCode = new Map<string, string>()
    for (const s of teamToday.data?.staffStatuses ?? []) idByCode.set(s.employeeCode, s.employeeId)
    const todayCounts = teamToday.data ? dayBuckets(teamToday.data, today) : null

    const daily: Record<string, DayBuckets> = {}
    for (const r of trend.data ?? []) daily[r.date] = trendBuckets(r, today)
    if (teamToday.data && !m.past) daily[today] = { ...dayBuckets(teamToday.data, today), ...(typeof daily[today]?.weeklyOff === 'boolean' ? { weeklyOff: daily[today].weeklyOff } : {}) }
    const holidayList = (holidays.data ?? []).filter((h) => h.active !== false).map((h) => ({ date: h.holidayDate, name: h.holidayName }))
    const holidayByDay: Record<string, string> = {}
    for (const h of holidayList) holidayByDay[h.date] = h.name
    const offWd = offWeekdays(daily)
    let workingDays = 0
    const monthCounts: MonthCounts = { total: 0, present: 0, regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, notMarked: 0, absent: 0, earlyOut: 0, other: 0 }
    for (let d = m.from; d <= m.to; d = addDays(d, 1)) {
      if (isOffDay(d, daily, offWd) || holidayByDay[d]) continue
      workingDays++
      const b = daily[d]
      if (b) for (const k of Object.keys(monthCounts) as (keyof MonthCounts)[]) monthCounts[k] += b[k] || 0
    }
    const rangeSources = monthSources.data && String(monthSources.data.date).slice(0, 10) === m.to ? monthSources.data.sources : null
    const srcList = m.past ? rangeSources ?? [] : sources.data?.sources ?? []
    const lateBy = new Map<string, { id: string; code: string; name: string; dept: string; n: number }>()
    for (const r of lateMarks.data ?? []) {
      const cur = lateBy.get(r.employee_code) || { id: idByCode.get(r.employee_code) || '', code: r.employee_code, name: r.employee_name, dept: r.department || '—', n: 0 }
      cur.n++
      lateBy.set(r.employee_code, cur)
    }
    const graces = [...new Set((policies.data ?? []).map((sp) => sp.gracePeriodMinutes ?? 0))]
    return {
      companyId,
      counts: (m.past ? monthCounts : todayCounts) as MonthCounts | DayBuckets | null,
      daily, offWd, holidays: holidayByDay, workingDays,
      graceMin: graces.length === 1 ? graces[0] : null,
      sources: srcList.filter((s) => s.count > 0).map((s) => ({ label: sourceLabel(s.method), n: s.count })),
      sourcesLoading: m.past ? monthSources.isLoading : sources.isLoading,
      sourcesMissing: m.past && !monthSources.isLoading && !rangeSources,
      lateMarks: [...lateBy.values()].sort((a, b) => b.n - a.n).slice(0, 5),
      summary: (summary.data ?? []).map((r) => ({
        id: idByCode.get(r.employee_code) || '', code: r.employee_code, name: r.employee_name, dept: r.department || '—',
        present: r.present_days, late: r.late_days, avgHours: r.avg_hours, ot: r.total_overtime_mins,
      })),
      reportLink: `/hrms/reports/attendance-summary?${new URLSearchParams({ ...(companyId ? { company: companyId } : {}), from: m.from, to: m.to })}`,
    }
  }, [teamToday.data, trend.data, sources.data, sources.isLoading, monthSources.data, monthSources.isLoading, holidays.data, summary.data, lateMarks.data,
    policies.data, companyId, today, m.past, m.from, m.to])

  // A past month has no live roster: its numbers all come from the trend.
  const main = m.past ? trend : teamToday
  return {
    data, canTeam, canReport,
    loading: main.isLoading || trend.isLoading,
    error: (main.error ?? trend.error) as unknown,
    retry: () => { teamToday.refetch(); trend.refetch(); if (m.past) monthSources.refetch(); else sources.refetch(); summary.refetch(); lateMarks.refetch() },
    trendError: trend.error as unknown,
    summaryLoading: summary.isLoading, summaryError: summary.error as unknown,
    byDept, byBranch,
  }
}
