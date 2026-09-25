// A month view of compliance deadlines (GET /v1/compliance/calendar-events,
// hrms.compliance.read), in the module kit's panel style. Click a day to list
// only its deadlines.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addMonths, format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { Panel, State, RowList, Row, dmy, todayIso } from '@/design/module/ModuleKit'

interface CalendarEvent { id: string; title: string; type: string; date: string; status: string; category?: string }
const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const STATUS_WORD: Record<string, string> = { LATE: 'Filed late' }

export function FilingCalendar({ companyId }: { companyId: string }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string>()
  const from = format(startOfMonth(month), 'yyyy-MM-dd'), to = format(endOfMonth(month), 'yyyy-MM-dd')
  const query = useQuery({
    queryKey: ['hrms', 'compliance', 'calendar', companyId, from, to],
    queryFn: () => apiJson<CalendarEvent[]>(`/v1/compliance/calendar-events?companyId=${encodeURIComponent(companyId)}&from=${from}&to=${to}`),
    enabled: !!companyId,
  })
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
  const visible = query.data?.filter((e) => !selected || e.date === selected) ?? []
  const move = (n: number) => { setMonth(addMonths(month, n)); setSelected(undefined) }
  const today = todayIso()
  return (
    <section aria-label="Filing calendar">
      <Panel title={format(month, 'MMMM yyyy')} sub="Every obligation and filing due this month." aside={
        <div style={{ display: 'flex', gap: 6 }}>
          <HrButton size="sm" variant="ghost" onClick={() => move(-1)}>← Previous</HrButton>
          <HrButton size="sm" variant="ghost" onClick={() => { setMonth(startOfMonth(new Date())); setSelected(undefined) }}>This month</HrButton>
          <HrButton size="sm" variant="ghost" onClick={() => move(1)}>Next →</HrButton>
        </div>}>
        {query.isError ? <State kind="error" title="Couldn’t load the deadlines" description={query.error.message} onRetry={() => query.refetch()} />
          : query.isLoading ? <State kind="loading" height={220} /> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={{ padding: 4, textAlign: 'center', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#64748b' }}>{d}</div>)}
                {Array.from({ length: getDay(startOfMonth(month)) }, (_, i) => <div key={`blank-${i}`} />)}
                {days.map((day) => {
                  const date = format(day, 'yyyy-MM-dd')
                  const count = query.data?.filter((e) => e.date === date).length ?? 0
                  const on = selected === date, isToday = date === today
                  return (
                    <button key={date} type="button" aria-label={`${format(day, 'd MMMM')}: ${count} deadlines`} aria-pressed={on} onClick={() => setSelected(on ? undefined : date)}
                      style={{ minHeight: 56, borderRadius: 10, border: `1px solid ${on ? '#059669' : isToday ? '#a7f3d0' : '#eef2f6'}`, background: on ? '#ecfdf5' : count ? '#fffbeb' : '#fff', cursor: 'pointer', padding: 6, fontFamily: 'inherit', display: 'grid', alignContent: 'start', justifyItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? '#0f6e56' : '#0f172a' }}>{format(day, 'd')}</span>
                      {count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>{`${count} due`}</span>}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 13.5 }}>{`${selected ? `Due on ${dmy(selected)}` : 'This month'} · ${visible.length}`}</strong>
                {selected && <HrButton size="sm" variant="ghost" onClick={() => setSelected(undefined)}>Show the whole month</HrButton>}
              </div>
              {!visible.length ? <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Nothing due in this period.</p> : (
                <RowList>
                  {visible.map((e) => (
                    <Row key={e.id} title={e.title} meta={`${dmy(e.date)} · ${e.category || words(e.type)}`}
                      trail={<HrStatusPill tone={e.status === 'DONE' || e.status === 'FILED' ? 'ok' : e.status === 'OVERDUE' || e.status === 'LATE' ? 'red' : 'warn'}>{STATUS_WORD[e.status] || words(e.status)}</HrStatusPill>} />
                  ))}
                </RowList>
              )}
            </>
          )}
      </Panel>
    </section>
  )
}
