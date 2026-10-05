// The Keka-style month calendar (audit C-08 / G-46 / C-12): one month with everything dated on it —
// company holidays, approved leave (sick leave in its own colour), birthdays and work anniversaries —
// chips to show one kind, a leave-type pick, and an agenda beside the month for the day you click or
// for dates you pick (Start date / End date, with six quick picks). Ideas from Keka's calendar; our
// palette and kit. Read-only: it never changes anything.
//
//   <EventsCalendar today={today} companyId={companyId} canLeave={canLeave} />
//
// Data: useCalendarEvents (existing endpoints only). Each source fails on its own with a note and Retry.
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Award, Cake, ChevronLeft, ChevronRight, Flag, Plane, Thermometer, X } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Section } from '@/design/kit/display'
import { Dropdown } from '@/design/kit/overlays'
import { FilterPills } from '@/design/kit/FilterPills'
import { DateRangeButton, DateRangeDialog } from '@/design/kit/DateRangePicker'
import { monthTitle, monthWeeks, shiftDay, shiftMonth, viewPresets, weekdayOf, type WorkCalendar } from '@/design/kit/dateRangeModel'
import { useWeekendDays, jsWeekendDays } from '../api/useSettings'
import {
  KIND_LABEL, agenda, applyFilter, byDay, filterCounts, leaveTypesIn, monthSpan, onlyPeople, spanText,
  type CalEvent, type CalFilter, type EventKind,
} from './calendarEvents'
import { useCalendarEvents } from './useCalendarEvents'
import './eventsCalendar.css'

export interface EventsCalendarProps {
  today: string
  companyId?: string
  /** May read the leave calendar; default: hrms.leave.approve.l1 or leave.balance.read (the endpoint's own check). The server picks the scope. */
  canLeave?: boolean
  title?: string
  variant?: 'dashboard' | 'panel'
  level?: 2 | 3
  footerLink?: { label: string; onClick: () => void }
  /** A team calendar: birthdays and anniversaries of these people only. */
  people?: ReadonlySet<string> | null
  /** The line under the title; default says what the calendar shows. */
  sub?: string
  className?: string
  style?: CSSProperties
}

const ICON: Record<EventKind, typeof Flag> = { holiday: Flag, leave: Plane, sick: Thermometer, birthday: Cake, anniversary: Award }
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Tue, 7 Oct". */
export const dayWord = (iso: string) => `${WD[weekdayOf(iso)]}, ${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`
const FILTERS: { value: CalFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'holiday', label: 'Holidays' }, { value: 'leave', label: 'Leave' },
  { value: 'sick', label: 'Sick leave' }, { value: 'birthday', label: 'Birthdays' }, { value: 'anniversary', label: 'Anniversaries' },
]
const PER_DAY = 2

const scopeWord = (scope?: string) => scope === 'TENANT' ? 'Leave across the company' : scope === 'TEAM' ? 'Leave in your team' : scope === 'SELF' ? 'Your own leave' : 'Leave'

export function EventsCalendar({ today, companyId, canLeave: canLeaveProp, title = 'Calendar', variant = 'dashboard', level = 3, footerLink, people, sub: subProp, className, style }: EventsCalendarProps) {
  const canApprove = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canOwn = usePermission(P.LEAVE_BALANCE_READ)
  const canLeave = canLeaveProp ?? (canApprove || canOwn)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [day, setDay] = useState(today)
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState<CalFilter>('all')
  const [typeId, setTypeId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const span = monthSpan(month)
  const grid = useCalendarEvents(span.from, span.to, { companyId, canLeave })
  // The picked dates load on their own (they may reach past the month on show).
  const picked = useCalendarEvents(range?.from ?? span.from, range?.to ?? span.to, { companyId, canLeave, enabled: !!range })
  const weekend = useWeekendDays(companyId)
  const off = useMemo(() => jsWeekendDays(weekend.data?.weekendDays), [weekend.data])

  const all = useMemo(() => onlyPeople(grid.events, people), [grid.events, people])
  const shown = useMemo(() => applyFilter(all, filter, typeId), [all, filter, typeId])
  const days = useMemo(() => byDay(shown), [shown])
  const counts = useMemo(() => filterCounts(applyFilter(all, 'all', typeId)), [all, typeId])
  const types = useMemo(() => leaveTypesIn(all), [all])
  const workCal = useMemo<WorkCalendar>(() => ({
    off, holidays: new Map(all.filter((e) => e.kind === 'holiday').map((e) => [e.date, e.title])),
  }), [off, all])

  const source = range ? picked : grid
  const list = useMemo(() => {
    const from = range?.from ?? day, to = range?.to ?? day
    return agenda(applyFilter(onlyPeople(source.events, people), filter, typeId), from, to)
  }, [source.events, people, filter, typeId, range, day])

  const goMonth = (n: -1 | 1) => setMonth((m) => shiftMonth(m, n))
  const toToday = () => { setMonth(today.slice(0, 7)); setDay(today); setRange(null) }
  const pickDay = (d: string) => { setDay(d); setRange(null) }
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (!(e.key in step)) return
    e.preventDefault()
    const next = shiftDay(day.slice(0, 7) === month ? day : `${month}-01`, step[e.key])
    setDay(next)
    setRange(null)
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7))
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus())
  }

  const failed = [...new Set([...grid.failed, ...(range ? picked.failed : [])])]
  const focusDay = day.slice(0, 7) === month ? day : `${month}-01`
  const weeks = monthWeeks(month)
  const sub = subProp ?? (canLeave ? `Holidays, ${scopeWord(grid.leaveScope).toLowerCase()}, birthdays and work anniversaries` : 'Holidays, birthdays and work anniversaries')
  const agendaTitle = range ? spanText(range.from, range.to) : day === today ? `Today · ${dayWord(day)}` : dayWord(day)
  const typeOptions = [{ value: '', label: 'All leave types' }, ...types.map((t) => ({ value: t.id, label: t.name, sub: `${t.count} ${t.count === 1 ? 'request' : 'requests'}${t.sick ? ' · sick leave' : ''}` }))]

  return (
    <Section variant={variant} level={level} title={title} sub={sub} className={['ec', className].filter(Boolean).join(' ')} style={style}
      footerLink={footerLink} bodyClassName="ec-wrap"
      actions={(
        <div className="ec-nav">
          <button type="button" className="ec-arrow" aria-label="Previous month" onClick={() => goMonth(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="ec-month" aria-live="polite">{monthTitle(month)}</span>
          <button type="button" className="ec-arrow" aria-label="Next month" onClick={() => goMonth(1)}><ChevronRight size={16} aria-hidden="true" /></button>
          <button type="button" className="ec-today" onClick={toToday} disabled={month === today.slice(0, 7) && day === today && !range}>Today</button>
        </div>
      )}>
      <div className="ec-toolbar">
        <FilterPills<CalFilter> size="sm" label="Show on the calendar" value={filter} onChange={setFilter}
          options={FILTERS.filter((f) => canLeave || (f.value !== 'leave' && f.value !== 'sick'))
            .map((f) => ({ value: f.value, label: f.value === 'all' || f.value === 'leave' ? f.label : <span className="ec-fl"><i className={`ec-sw ec-sw--${f.value}`} aria-hidden="true" />{f.label}</span>, count: grid.loading ? null : counts[f.value] }))} />
        {canLeave && types.length > 1 && (
          <div className="ec-type">
            <Dropdown label="Leave type" value={typeId ?? ''} options={typeOptions} onChange={(v) => setTypeId(v || null)} />
          </div>
        )}
      </div>

      {failed.length > 0 && (
        <p className="ec-note" role="alert">
          Couldn’t load the {failed.join(' or ')}. The rest is shown.
          <button type="button" className="ec-link" onClick={() => { grid.refetch(); if (range) picked.refetch() }}>Try again</button>
        </p>
      )}

      <div className="ec-body">
        <div className="ec-cal">
          <div ref={gridRef} role="grid" aria-label={`${monthTitle(month)} calendar`} aria-busy={grid.loading || undefined} className="ec-grid" onKeyDown={onGridKey}>
            <div role="row" className="ec-row ec-row--head">
              {WEEK.map((w, i) => <span key={w} role="columnheader" className={`ec-wd${off.has((i + 1) % 7) ? ' is-off' : ''}`}>{w}</span>)}
            </div>
            {weeks.map((week, wi) => (
              <div role="row" className="ec-row" key={wi}>
                {week.map((d, di) => {
                  if (!d) return <span key={`b${di}`} role="gridcell" className="ec-cell is-blank" />
                  const evs = days.get(d) ?? []
                  const hol = evs.find((e) => e.kind === 'holiday')
                  const isOff = off.has(weekdayOf(d))
                  const inRange = !!range && d >= range.from && d <= range.to
                  const sel = !range && d === day
                  const label = [dayWord(d), d === today ? 'today' : null, isOff && !hol ? 'weekly off' : null,
                    ...evs.map((e) => `${KIND_LABEL[e.kind]}: ${e.title}`)].filter(Boolean).join(', ')
                  return (
                    <span key={d} role="gridcell" aria-selected={sel || inRange} className="ec-cell">
                      <button type="button" data-day={d} tabIndex={d === focusDay ? 0 : -1} aria-label={label} onClick={() => pickDay(d)}
                        className={['ec-day', isOff && 'is-off', hol && 'is-holiday', d === today && 'is-today', sel && 'is-sel', inRange && 'in-range'].filter(Boolean).join(' ')}>
                        <span className="ec-n">{Number(d.slice(8))}</span>
                        <span className="ec-chips" aria-hidden="true">
                          {evs.slice(0, PER_DAY).map((e) => <span key={e.key} className={`ec-chip ec-k--${e.kind}`}>{e.title}</span>)}
                          {evs.length > PER_DAY && <span className="ec-more">+{evs.length - PER_DAY} more</span>}
                        </span>
                        <span className="ec-dots" aria-hidden="true">
                          {[...new Set(evs.map((e) => e.kind))].slice(0, 4).map((k) => <i key={k} className={`ec-dot ec-k--${k}`} />)}
                        </span>
                      </button>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="ec-legend" aria-hidden="true">
            {(['holiday', 'leave', 'sick', 'birthday', 'anniversary'] as EventKind[]).filter((k) => canLeave || (k !== 'leave' && k !== 'sick'))
              .map((k) => <span key={k}><i className={`ec-sw ec-sw--${k}`} />{KIND_LABEL[k]}</span>)}
            <span><i className="ec-sw ec-sw--off" />Weekly off</span>
          </div>
        </div>

        <aside className="ec-agenda" aria-label="Agenda">
          <div className="ec-agenda__head">
            <div className="ec-agenda__t">{agendaTitle}</div>
            {range && <button type="button" className="ec-clear" onClick={() => setRange(null)} aria-label="Clear the dates"><X size={14} aria-hidden="true" />Clear</button>}
          </div>
          <DateRangeButton from={range?.from ?? ''} to={range?.to ?? ''} onOpen={() => setPicking(true)} />
          {grid.leaveClipped || (range && picked.leaveClipped) ? <p className="ec-hint">Leave shows for the first 62 days of these dates.</p> : null}
          <div className="ec-agenda__list" aria-busy={source.loading || undefined}>
            {source.loading ? (
              <p className="ec-empty">Loading…</p>
            ) : list.length === 0 ? (
              <p className="ec-empty">{range ? 'Nothing in these dates.' : day === today ? 'Nothing on today.' : 'Nothing on this day.'}</p>
            ) : list.map((g) => (
              <section key={g.date} className="ec-group" aria-label={dayWord(g.date)}>
                {range && <h4 className="ec-group__d">{dayWord(g.date)}{g.date === today && <span className="ec-tag">Today</span>}</h4>}
                <ul className="ec-items">
                  {g.events.map((e) => <AgendaItem key={e.key} e={e} />)}
                </ul>
              </section>
            ))}
          </div>
        </aside>
      </div>

      <DateRangeDialog open={picking} onClose={() => setPicking(false)} title="Show dates" from={range?.from ?? ''} to={range?.to ?? ''}
        calendar={workCal} today={today} presets={viewPresets(today)}
        footerText={(r) => (r ? `Showing ${spanText(r.from, r.to)}` : 'Pick the first day, then the last')}
        onDone={(r) => { setPicking(false); setRange({ from: r.from, to: r.to }); setMonth(r.from.slice(0, 7)) }} />
    </Section>
  )
}

function AgendaItem({ e }: { e: CalEvent }) {
  const Icon = ICON[e.kind]
  return (
    <li className="ec-item">
      <span className={`ec-ic ec-k--${e.kind}`} aria-hidden="true"><Icon size={15} /></span>
      <span className="ec-item__txt">
        <span className="ec-item__t">{e.title}</span>
        <span className="ec-item__s">{e.kind === 'holiday' || e.kind === 'birthday' ? KIND_LABEL[e.kind] : e.detail}</span>
      </span>
      {e.kind === 'sick' && <span className="ec-pill ec-k--sick">Sick</span>}
    </li>
  )
}
