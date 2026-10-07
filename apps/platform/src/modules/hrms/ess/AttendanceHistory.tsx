// An employee's own attendance for a start / end range picked on the calendar (this month by default; kept in
// the URL as ?from=&to=), from GET /v1/attendance/history month by month, in the module kit's panel style.
// Today without a punch isn't listed (the API leaves it out until the day is over).
import { useAttendanceHistoryRange } from '../api/useAttendance'
import { HrStatusPill, type PillTone } from '@/shared/components/hr'
import { Panel, State, dmy } from '@/design/module/ModuleKit'
import { RangeFilter, useRangeParam } from '@/design/kit/RangeFilter'
import { istToday } from '@/design/dc/dates'

const TONE: Record<string, PillTone> = { PRESENT: 'ok', ON_TIME: 'ok', LATE: 'warn', ABSENT: 'red', HOLIDAY: 'purple', ON_LEAVE: 'blue', WEEKEND: 'gray', HALF_DAY: 'warn' }
const time = (v?: string | null) => (!v ? '—' : v.includes('T') ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : v.slice(0, 5))

export function AttendanceHistory() {
  const today = istToday()
  // A year at most: the history is asked for month by month.
  const [picked, setPicked] = useRangeParam({ max: today, maxSpan: 366 })
  const range = picked ?? { from: `${today.slice(0, 7)}-01`, to: today }
  const q = useAttendanceHistoryRange(range)
  const rows = q.data ?? []
  const th = { textAlign: 'left' as const, padding: '10px 16px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: '#64748b', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' as const }
  const td = { padding: '11px 16px', fontSize: 13.5, borderBottom: '1px solid #f8fafc', whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as const }
  return (
    <Panel title="Attendance history" sub="Your punches, day by day" aside={
      <RangeFilter value={range} onChange={setPicked} max={today} maxSpan={366} label="Attendance dates" filterKey="attendance-dates" align="end" clearable={!!picked} />}>
      {q.isLoading ? <State kind="loading" />
        : q.isError ? <State kind="error" title="Couldn’t load your attendance" description={(q.error as Error)?.message} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <State kind="empty" icon="calendarDays" title={picked ? 'No attendance on these dates' : 'No attendance for this month'} description="Days you punch in appear here." />
            : (
              <div style={{ overflowX: 'auto', margin: '0 -20px -20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr><th style={th}>Date</th><th style={th}>In</th><th style={th}>Out</th><th style={th}>Hours</th><th style={th}>Status</th></tr></thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.date}>
                        <td style={{ ...td, fontWeight: 600 }}>{dmy(d.date)}</td>
                        <td style={td}>{time(d.checkInTime)}</td>
                        <td style={td}>{time(d.checkOutTime)}</td>
                        <td style={td}>{d.workHours == null ? '—' : `${d.workHours.toFixed(1)}h`}</td>
                        <td style={td}><HrStatusPill tone={TONE[d.status] || 'gray'}>{d.status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</HrStatusPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </Panel>
  )
}
