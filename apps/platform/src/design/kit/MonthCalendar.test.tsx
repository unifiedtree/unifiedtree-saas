import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthCalendar, CalendarLegend, calendarKeyTarget, monthWeeks, type CalendarDay } from './MonthCalendar'
import { monthCells } from '@/shared/components/calendar/dateMath'

const count = (s: string, needle: string) => s.split(needle).length - 1

describe('month layout (shared calendar model, Monday first)', () => {
  it('September 2026 starts on a Tuesday: one blank, then 30 days over 5 weeks', () => {
    const w = monthWeeks('2026-09')
    expect(w).toHaveLength(5)
    expect(w[0]).toEqual(['', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'])
    expect(w[4]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '', '', '', ''])
    expect(w.flat().filter(Boolean)).toHaveLength(30)
  })
  it('matches the shared calendar’s own grid, minus other months and empty weeks', () => {
    const shared = monthCells('2026-10').map((d) => (d.startsWith('2026-10') ? d : ''))
    expect(monthWeeks('2026-10').flat()).toEqual(shared.slice(0, monthWeeks('2026-10').length * 7))
  })
  it('February 2021 fills exactly four weeks; a day string works as the month', () => {
    expect(monthWeeks('2021-02')).toHaveLength(4)
    expect(monthWeeks('2021-02-14')).toEqual(monthWeeks('2021-02'))
  })
  it('bad input gives no weeks (and the component renders nothing)', () => {
    expect(monthWeeks('not a month')).toEqual([])
    expect(renderToStaticMarkup(<MonthCalendar month="x" />)).toBe('')
  })
})

describe('keyboard targets', () => {
  it('arrows move by day and week, clamped to the month', () => {
    expect(calendarKeyTarget('ArrowRight', '2026-09-18', '2026-09')).toBe('2026-09-19')
    expect(calendarKeyTarget('ArrowLeft', '2026-09-18', '2026-09')).toBe('2026-09-17')
    expect(calendarKeyTarget('ArrowDown', '2026-09-18', '2026-09')).toBe('2026-09-25')
    expect(calendarKeyTarget('ArrowUp', '2026-09-18', '2026-09')).toBe('2026-09-11')
    expect(calendarKeyTarget('ArrowLeft', '2026-09-01', '2026-09')).toBe('2026-09-01')
    expect(calendarKeyTarget('ArrowDown', '2026-09-28', '2026-09')).toBe('2026-09-30')
    expect(calendarKeyTarget('ArrowUp', '2026-09-03', '2026-09')).toBe('2026-09-01')
  })
  it('Home / End go to Monday / Sunday of the week (inside the month)', () => {
    expect(calendarKeyTarget('Home', '2026-09-18', '2026-09')).toBe('2026-09-14')
    expect(calendarKeyTarget('End', '2026-09-18', '2026-09')).toBe('2026-09-20')
    expect(calendarKeyTarget('Home', '2026-09-03', '2026-09')).toBe('2026-09-01')
    expect(calendarKeyTarget('End', '2026-09-29', '2026-09')).toBe('2026-09-30')
  })
  it('Page Up / Down ask for another month; other keys are ignored', () => {
    expect(calendarKeyTarget('PageUp', '2026-09-18', '2026-09')).toBe('prev-month')
    expect(calendarKeyTarget('PageDown', '2026-09-18', '2026-09')).toBe('next-month')
    expect(calendarKeyTarget('a', '2026-09-18', '2026-09')).toBeNull()
    expect(calendarKeyTarget('ArrowRight', 'bad', '2026-09')).toBeNull()
  })
})

const days: CalendarDay[] = [
  { date: '2026-09-01', tone: 'present', tip: 'In 09:24 · out 18:40' },
  { date: '2026-09-03', tone: 'late', label: 'Late 13 min' },
  { date: '2026-09-05', tone: 'off' },
  { date: '2026-09-14', tone: 'holiday' },
  { date: '2026-09-18', tone: 'fix', label: 'No punch-out' },
]

describe('MonthCalendar rendering', () => {
  it('an accessible grid: name, 7 column headers, rows, one tab stop, today marked', () => {
    const s = renderToStaticMarkup(<MonthCalendar month="2026-09" today="2026-09-25" days={days} label="September 2026 attendance" />)
    expect(s).toContain('role="grid" aria-label="September 2026 attendance" aria-readonly="true"')
    expect(count(s, 'role="columnheader"')).toBe(7)
    expect(s).toContain('aria-label="Monday"')
    expect(count(s, 'role="row"')).toBe(6) // header + 5 weeks
    expect(count(s, 'tabindex="0"')).toBe(1)
    expect(s).toMatch(/data-date="2026-09-25" tabindex="0" aria-label="Friday, 25 September 2026, today" aria-current="date"/)
    expect(s).not.toContain('aria-selected') // display only
  })
  it('compact: one-letter weekdays, tone classes, today in brand, tooltips and spoken states', () => {
    const s = renderToStaticMarkup(<MonthCalendar month="2026-09" today="2026-09-25" days={days} />)
    expect(s).toContain('>M</span>')
    expect(s).toContain('uk-cal__day--compact uk-cal--present')
    expect(s).toContain('uk-cal__day--compact uk-cal--none is-today')
    expect(s).toContain('title="In 09:24 · out 18:40"')
    expect(s).toContain('aria-label="Tuesday, 1 September 2026, Present, In 09:24 · out 18:40"')
    expect(s).toContain('aria-label="Friday, 18 September 2026, Needs a fix, No punch-out"')
  })
  it('the legend’s words are used for the spoken state', () => {
    const s = renderToStaticMarkup(<MonthCalendar month="2026-09" days={days} today={null} legend={[{ tone: 'late', label: 'Late arrival' }]} />)
    expect(s).toContain('aria-label="Thursday, 3 September 2026, Late arrival, Late 13 min"')
    expect(s).toContain('uk-cal__sw uk-cal__sw--late')
    expect(s).not.toContain('aria-current')
  })
  it('pickable: aria-selected on the picked day, which also takes the tab stop', () => {
    const s = renderToStaticMarkup(<MonthCalendar month="2026-09" variant="detail" today="2026-09-25" days={days} selected="2026-09-18" onSelect={() => {}} />)
    expect(s).not.toContain('aria-readonly')
    expect(s).toMatch(/data-date="2026-09-18" tabindex="0"[^>]*aria-selected="true"/)
    expect(count(s, 'aria-selected="true"')).toBe(1)
    expect(s).toContain('>Mon</span>')
    expect(s).toContain('<span class="uk-cal__label" aria-hidden="true">No punch-out</span>')
    expect(s).toContain('<span class="uk-cal__todaytag">Today</span>')
    expect(s).toContain('is-selected')
  })
  it('detail: holidays and weekly offs get no status dot', () => {
    const s = renderToStaticMarkup(<MonthCalendar month="2026-09" variant="detail" today={null} days={days} />)
    const holiday = /data-date="2026-09-14"[^]*?<\/div>/.exec(s)![0]
    expect(holiday).not.toContain('uk-cal__dot')
    const late = /data-date="2026-09-03"[^]*?<\/div>/.exec(s)![0]
    expect(late).toContain('uk-cal__dot')
  })
  it('planner: range ends are marked and in-range days tinted; muted and marked days', () => {
    const plan: CalendarDay[] = [{ date: '2026-10-03', tone: 'off', disabled: true }, { date: '2026-10-02', tone: 'holiday' }, { date: '2026-10-06', marker: true }]
    const s = renderToStaticMarkup(<MonthCalendar month="2026-10" variant="planner" today={null} days={plan} range={{ start: '2026-10-08', end: '2026-10-05' }} onSelect={() => {}} legend={[{ tone: 'marker', label: 'Someone in your team is off' }]} />)
    expect(s).toMatch(/data-date="2026-10-05"[^>]*class="uk-cal__day uk-cal__day--planner is-inrange is-edge/)
    expect(s).toMatch(/data-date="2026-10-06"[^>]*class="uk-cal__day uk-cal__day--planner is-inrange is-pickable"/)
    expect(s).toMatch(/data-date="2026-10-08"[^>]*class="uk-cal__day uk-cal__day--planner is-inrange is-edge/)
    expect(s).toContain('is-holiday')
    expect(s).toMatch(/data-date="2026-10-03"[^>]*aria-disabled="true"[^>]*class="[^"]*is-muted/)
    expect(s).toContain('uk-cal__marker')
    expect(s).toContain('Someone in your team is off')
    expect(count(s, 'aria-selected="true"')).toBe(2)
  })
  it('legend renders on its own', () => {
    const s = renderToStaticMarkup(<CalendarLegend variant="detail" items={[{ tone: 'present', label: 'On time' }, { tone: 'fix', label: 'To fix' }]} />)
    expect(s).toContain('uk-cal__legend--detail')
    expect(count(s, 'uk-legend__item')).toBe(2)
  })
})
