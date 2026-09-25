// An employee's own attendance for a month (GET /v1/attendance/history), in
// the module kit's panel style. Today without a punch isn't listed (the API
// leaves it out until the day is over).
import { useState } from 'react'
import { useAttendanceHistory } from '../api/useAttendance'
import { HrStatusPill, type PillTone } from '@/shared/components/hr'
import { Panel, State, dmy } from '@/design/module/ModuleKit'

const TONE: Record<string, PillTone> = { PRESENT: 'ok', ON_TIME: 'ok', LATE: 'warn', ABSENT: 'red', HOLIDAY: 'purple', ON_LEAVE: 'blue', WEEKEND: 'gray', HALF_DAY: 'warn' }
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const time = (v?: string | null) => (!v ? '—' : v.includes('T') ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : v.slice(0, 5))

export function AttendanceHistory() {
  const [month, setMonth] = useState(monthNow)
  const [y, m] = month.split('-').map(Number)
  const q = useAttendanceHistory(y, m)
  const rows = [...(q.data ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const th = { textAlign: 'left' as const, padding: '10px 16px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: '#64748b', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' as const }
  const td = { padding: '11px 16px', fontSize: 13.5, borderBottom: '1px solid #f8fafc', whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as const }
  return (
    <Panel title="Attendance history" sub="Your punches, day by day" aside={
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>Month
        <input aria-label="Attendance month" type="month" value={month} max={monthNow()} onChange={(e) => { if (e.target.value) setMonth(e.target.value) }}
          style={{ height: 34, padding: '0 10px', border: '1px solid #e2e8f0', borderRadius: 10, font: 'inherit', fontSize: 13, color: '#0f172a' }} />
      </label>}>
      {q.isLoading ? <State kind="loading" />
        : q.isError ? <State kind="error" title="Couldn’t load your attendance" description={(q.error as Error)?.message} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <State kind="empty" icon="calendarDays" title="No attendance for this month" description="Days you punch in appear here." />
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
