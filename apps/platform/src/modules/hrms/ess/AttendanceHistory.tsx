import { useState } from 'react'
import { format } from 'date-fns'
import { useAttendanceHistory } from '../api/useAttendance'
import { HrButton, HrStatusPill } from '@/shared/components/hr'

export function AttendanceHistory() {
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [year, number] = month.split('-').map(Number)
  const query = useAttendanceHistory(year, number)
  const time = (value?: string) => value ? value.includes('T') ? format(new Date(value), 'h:mm a') : value.slice(0, 5) : '--'
  return <section className="ut-card overflow-hidden"><div className="flex flex-wrap justify-between gap-3 border-b border-border-default p-4"><h2 className="font-semibold">Attendance history</h2><label className="text-sm">Month<input aria-label="Attendance month" className="ut-input" type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value) }} /></label></div>
    {query.isError ? <div role="alert" className="p-4"><p>{query.error.message}</p><HrButton onClick={() => query.refetch()}>Retry</HrButton></div> : <div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Date</th><th>Punch in</th><th>Punch out</th><th>Hours</th><th>Status</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={5}>Loading attendance...</td></tr> : !query.data?.length ? <tr><td colSpan={5}>No attendance records for this month.</td></tr> : query.data.map(day => <tr key={day.date}><td>{day.date}</td><td>{time(day.checkInTime)}</td><td>{time(day.checkOutTime)}</td><td>{day.workHours == null ? '--' : `${day.workHours.toFixed(2)}h`}</td><td><HrStatusPill tone={day.status === 'LATE' || day.status === 'ABSENT' ? 'warn' : 'gray'}>{day.status.replaceAll('_', ' ')}</HrStatusPill></td></tr>)}</tbody></table></div>}
  </section>
}
