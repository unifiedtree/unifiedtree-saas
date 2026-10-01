// Attendance tab, top: one person's month as the design's calendar (BW-16), with the month's
// numbers and a picker to look at earlier months. The records, shift history and status changes
// below it are today's EmployeeAttendance, unchanged.
//   GET /v1/attendance/employee/{id}/history?year&month    GET …/monthly-stats?year&month
//   attendance.team.read + the server's scope (self, their manager, attendance admins); 403 → no access.
import { useMemo, useState } from 'react'
import { Button, CalendarLegend, MonthCalendar, Section } from '@/design/kit/display'
import { istToday } from '@/design/dc/dates'
import { dayCell } from '../../attendance/daily/MyAttendance'
import { useEmployeeMonth, useEmployeeMonthStats } from '../api/useProfileData'
import { CAL_LEGEND } from './HrOverview'
import { MONTH_NAMES } from './profileFormat'

const shift = (ym: string, delta: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function EmployeeMonth({ employeeId, name }: { employeeId: string; name: string }) {
  const today = istToday()
  const [ym, setYm] = useState(today.slice(0, 7))
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const history = useEmployeeMonth(employeeId, y, m, true)
  const stats = useEmployeeMonthStats(employeeId, y, m, true)
  const cells = useMemo(() => (history.data ?? []).map((d) => dayCell(d, today)), [history.data, today])
  const forbidden = (history.error as { status?: number } | null)?.status === 403
  const s = stats.data
  const noOut = cells.filter((c) => c.tone === 'fix').length
  const summary = s ? [
    `${s.presentDays} present`, `${s.lateDays} late`, `${s.absentDays} absent`,
    s.leaveDays != null ? `${s.leaveDays} on leave` : '', noOut ? `${noOut} incomplete` : '',
  ].filter(Boolean).join(' · ') : ''
  return (
    <Section title={`${MONTH_NAMES[m - 1]} ${y}`} sub={summary || (history.isLoading ? '' : `${name}’s days this month`)} variant="section"
      actions={<span style={{ display: 'inline-flex', gap: 6 }}>
        <Button size={30} variant="secondary" icon="chevronLeft" aria-label="Previous month" onClick={() => setYm(shift(ym, -1))} />
        <Button size={30} variant="secondary" icon="chevronRight" aria-label="Next month" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(shift(ym, 1))} />
      </span>}
      loading={history.isLoading} error={forbidden ? undefined : history.error} onRetry={() => void history.refetch()} skeleton="chart"
      empty={forbidden ? { title: 'You can’t see this person’s attendance', hint: 'Their manager, HR and attendance admins can.' } : undefined}>
      <MonthCalendar month={ym} days={cells} variant="detail" today={today} label={`${MONTH_NAMES[m - 1]} ${y} attendance for ${name}`}
        onMonthChange={(d) => { const n = shift(ym, d); if (n <= today.slice(0, 7)) setYm(n) }} />
      <CalendarLegend items={CAL_LEGEND} variant="detail" />
      {cells.length === 0 && !history.isLoading && <p className="upf-note">No attendance recorded in {MONTH_NAMES[m - 1]} yet.</p>}
    </Section>
  )
}
