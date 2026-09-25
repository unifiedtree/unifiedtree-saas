// The week's shift roster for a manager's team (GET /v1/team/schedule), in the
// module kit's panel style. Names link to the employee page only for people
// who can open it (hrms.employee.read); managers usually can't.
import { useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { Panel, State, Note } from '@/design/module/ModuleKit'

interface Schedule { employeeId: string; employeeName: string; date: string; shiftName?: string; startTime?: string; endTime?: string }

export function TeamSchedule() {
  const allowed = usePermission('attendance.team.read')
  const canOpen = usePermission(P.HRMS_EMPLOYEE_READ)
  const [week, setWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [page, setPage] = useState(0)
  const from = format(week, 'yyyy-MM-dd'), to = format(addDays(week, 6), 'yyyy-MM-dd')
  const q = useQuery({ queryKey: ['team', 'schedule', from, to], queryFn: () => apiJson<Schedule[]>(`/v1/team/schedule?from=${from}&to=${to}`), enabled: allowed })
  const people = [...new Map(q.data?.map((s) => [s.employeeId, s.employeeName])).entries()]
  if (!allowed) return null
  const th = { textAlign: 'left' as const, padding: '10px 12px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: '#64748b', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' as const }
  const td = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f8fafc', verticalAlign: 'top' as const, minWidth: 110 }
  return (
    <Panel title="Shift roster" sub={`${format(week, 'd MMM')} – ${format(addDays(week, 6), 'd MMM yyyy')}`} aside={
      <div style={{ display: 'flex', gap: 6 }}>
        <HrButton size="sm" variant="ghost" onClick={() => { setWeek(addDays(week, -7)); setPage(0) }}>← Previous</HrButton>
        <HrButton size="sm" variant="ghost" onClick={() => { setWeek(startOfWeek(new Date(), { weekStartsOn: 1 })); setPage(0) }}>This week</HrButton>
        <HrButton size="sm" variant="ghost" onClick={() => { setWeek(addDays(week, 7)); setPage(0) }}>Next →</HrButton>
      </div>}>
      {q.isLoading ? <State kind="loading" />
        : q.isError ? <State kind="error" title="Couldn’t load the roster" description={(q.error as Error).message} onRetry={() => q.refetch()} />
          : !people.length ? <State kind="empty" icon="calendarDays" title="No one in your team scope" description="Shift assignments for the people who report to you appear here." />
            : (
              <>
                <div style={{ overflowX: 'auto', margin: '0 -20px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                    <thead><tr><th style={{ ...th, paddingLeft: 20 }}>Person</th>{Array.from({ length: 7 }, (_, i) => <th key={i} style={th}>{format(addDays(week, i), 'EEE d')}</th>)}</tr></thead>
                    <tbody>
                      {people.slice(page * 10, page * 10 + 10).map(([id, name]) => (
                        <tr key={id}>
                          <td style={{ ...td, paddingLeft: 20, fontWeight: 600 }}>{canOpen ? <Link to={`/hrms/employees/${id}`} style={{ color: '#0f6e56', textDecoration: 'none' }}>{name}</Link> : name}</td>
                          {Array.from({ length: 7 }, (_, i) => {
                            const s = q.data?.find((x) => x.employeeId === id && x.date === format(addDays(week, i), 'yyyy-MM-dd'))
                            return <td key={i} style={td}><div style={{ fontWeight: 600, color: s?.shiftName ? '#0f172a' : '#94a3b8' }}>{s?.shiftName || 'Unassigned'}</div>{s?.startTime && <div style={{ fontSize: 12, color: '#64748b' }}>{s.startTime.slice(0, 5)}–{s.endTime?.slice(0, 5)}</div>}</td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {people.length > 10 && <HrPagination page={page} pageSize={10} totalElements={people.length} totalPages={Math.ceil(people.length / 10)} onPageChange={setPage} />}
                <Note>These are the shifts assigned. Leave, holidays and weekly offs are shown in attendance.</Note>
              </>
            )}
    </Panel>
  )
}
