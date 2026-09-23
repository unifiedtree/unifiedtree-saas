import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addMonths, format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'

interface CalendarEvent { id: string; title: string; type: string; date: string; status: string; category?: string }
export function FilingCalendar({ companyId }: { companyId: string }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string>()
  const from = format(startOfMonth(month), 'yyyy-MM-dd'), to = format(endOfMonth(month), 'yyyy-MM-dd')
  const query = useQuery({ queryKey: ['hrms', 'compliance', 'calendar', companyId, from, to],
    queryFn: () => apiJson<CalendarEvent[]>(`/v1/compliance/calendar-events?companyId=${encodeURIComponent(companyId)}&from=${from}&to=${to}`), enabled: !!companyId })
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
  const visible = query.data?.filter(event => !selected || event.date === selected) ?? []
  const move = (n: number) => { setMonth(addMonths(month, n)); setSelected(undefined) }
  return <section className="ut-card space-y-4 p-5" aria-label="Filing calendar">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{format(month, 'MMMM yyyy')}</h3><div className="flex gap-2"><HrButton variant="ghost" onClick={() => move(-1)}>Previous month</HrButton><HrButton variant="ghost" onClick={() => { setMonth(startOfMonth(new Date())); setSelected(undefined) }}>Today</HrButton><HrButton variant="ghost" onClick={() => move(1)}>Next month</HrButton></div></div>
    {query.isError ? <div role="alert"><p>{query.error.message}</p><HrButton onClick={() => query.refetch()}>Retry</HrButton></div> : query.isLoading ? <p role="status">Loading filing deadlines...</p> : <>
      <div className="grid grid-cols-7 gap-1">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="p-1 text-center text-xs text-text-secondary">{day}</div>)}
        {Array.from({ length: getDay(startOfMonth(month)) }, (_, i) => <div key={`blank-${i}`} />)}
        {days.map(day => { const date = format(day, 'yyyy-MM-dd'); const count = query.data?.filter(event => event.date === date).length ?? 0
          return <button key={date} aria-label={`${format(day, 'd MMMM')}: ${count} deadlines`} aria-pressed={selected === date} onClick={() => setSelected(selected === date ? undefined : date)} className={`min-h-16 rounded-lg border p-1 text-center sm:p-3 ${selected === date ? 'border-primary bg-primary/10' : 'border-border-default hover:bg-bg-subtle'}`}><span>{format(day, 'd')}</span>{count > 0 && <span className="mt-1 block text-xs font-semibold text-primary">{count} due</span>}</button>
        })}
      </div>
      <div className="flex justify-between"><p className="text-sm font-semibold">{selected ? `Deadlines on ${selected}` : 'This month'} · {visible.length}</p>{selected && <button onClick={() => setSelected(undefined)} className="text-sm text-primary">Show month</button>}</div>
      {!visible.length ? <p className="text-sm text-text-secondary">No recorded deadlines for this period.</p> : <ul className="divide-y divide-border-default">{visible.map(event => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-medium">{event.title}</p><p className="text-xs text-text-secondary">{event.date} · {event.category || event.type.replaceAll('_', ' ')}</p></div><HrStatusPill tone={event.status === 'DONE' || event.status === 'FILED' ? 'ok' : event.status === 'OVERDUE' || event.status === 'LATE' ? 'red' : 'warn'}>{event.status}</HrStatusPill></li>)}</ul>}
    </>}
  </section>
}
