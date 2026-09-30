import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import {
  WeekGrid, WeekLegend, weekDays, shiftWeek, dayHead, weekLabel, weekCoverage, weekGridKeyTarget, type WeekRow, type WeekCell,
} from './data'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1

describe('week maths', () => {
  it('weekDays: the Monday-first week holding a day (the app rule), or Sunday-first', () => {
    // 25 Sep 2026 is a Friday.
    expect(weekDays('2026-09-25')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
    expect(weekDays('2026-09-28')[0]).toBe('2026-09-28') // a Monday starts its own week
    expect(weekDays('2026-10-04')[0]).toBe('2026-09-28') // a Sunday ends it
    expect(weekDays('2026-09-25', 0)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
  })
  it('weekDays crosses months and years, and ignores junk', () => {
    expect(weekDays('2026-12-31')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(weekDays('2024-02-29')[3]).toBe('2024-02-29')
    expect(weekDays('')).toEqual([])
    expect(weekDays('not a day')).toEqual([])
  })
  it('shiftWeek moves whole weeks either way', () => {
    expect(shiftWeek('2026-09-28', 1)).toBe('2026-10-05')
    expect(shiftWeek('2026-09-28', -1)).toBe('2026-09-21')
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
    expect(shiftWeek('2026-09-28', 0)).toBe('2026-09-28')
    expect(shiftWeek('', 1)).toBe('')
  })
  it('dayHead and weekLabel write days the design way', () => {
    expect(dayHead('2026-09-28')).toBe('Mon 28')
    expect(dayHead('2026-10-04')).toBe('Sun 4')
    expect(weekLabel(weekDays('2026-09-28'))).toBe('Mon 28 Sep – Sun 4 Oct')
    expect(weekLabel(weekDays('2026-09-21'))).toBe('Mon 21 Sep – Sun 27 Sep')
    expect(weekLabel(weekDays('2026-12-30'))).toBe('Mon 28 Dec 2026 – Sun 3 Jan 2027')
    expect(weekLabel(['2026-09-28'])).toBe('Mon 28 Sep')
    expect(weekLabel([])).toBe('')
  })
})

const c = (tone: WeekCell['tone']): WeekCell => ({ tone })

describe('weekCoverage', () => {
  // Mon 28 in the design: Priya waiting (leave?), six on the general shift, Arjun on the evening shift.
  const rows = [
    { cells: [c('pending'), c('holiday'), c('off')] },
    { cells: [c('shift'), c('holiday'), c('off')] },
    { cells: [c('shift'), c('holiday'), c('off')] },
    { cells: [c('home'), c('holiday'), c('off')] },
    { cells: [c('shift'), c('holiday'), c('off')] },
    { cells: [c('leave'), c('holiday'), c('off')] },
    { cells: [c('alt'), c('holiday'), c('off')] },
    { cells: [c('shift'), c('holiday'), c('off')] },
  ]
  it('counts people with a shift (another shift too); leave, home and waiting requests are not in', () => {
    expect(weekCoverage(rows, 0)).toEqual({ count: 5, total: 8, thin: false, rest: null })
  })
  it('a rest day: everyone on a holiday or a weekly off', () => {
    expect(weekCoverage(rows, 1)).toEqual({ count: 0, total: 8, thin: false, rest: 'holiday' })
    expect(weekCoverage(rows, 2)).toEqual({ count: 0, total: 8, thin: false, rest: 'off' })
    expect(weekCoverage([{ cells: [c('holiday')] }, { cells: [c('off')] }], 0)?.rest).toBe('holiday')
  })
  it('thin = under half the team (DECISIONS: a thin day is one with under half the team in)', () => {
    const four = [c('shift'), c('shift'), c('shift'), c('shift'), c('leave'), c('leave'), c('leave'), c('leave')].map((x) => ({ cells: [x] }))
    expect(weekCoverage(four, 0)).toMatchObject({ count: 4, total: 8, thin: false })
    const three = [c('shift'), c('shift'), c('shift'), c('leave'), c('leave'), c('leave'), c('leave'), c('off')].map((x) => ({ cells: [x] }))
    expect(weekCoverage(three, 0)).toMatchObject({ count: 3, total: 8, thin: true, rest: null })
  })
  it('a day nobody has anything for says nothing (no "0 of 8")', () => {
    expect(weekCoverage([{ cells: [] }, { cells: [null] }, { cells: [c('none')] }], 0)).toBeNull()
    expect(weekCoverage([], 0)).toBeNull()
  })
})

describe('weekGridKeyTarget', () => {
  const at = (key: string, row: number, col: number, ctrl = false) => weekGridKeyTarget(key, row, col, 3, 7, ctrl)
  it('arrows move a cell and stop at the edges; the name column is col -1', () => {
    expect(at('ArrowRight', 0, 0)).toEqual({ row: 0, col: 1 })
    expect(at('ArrowRight', 0, 6)).toEqual({ row: 0, col: 6 })
    expect(at('ArrowLeft', 1, 0)).toEqual({ row: 1, col: -1 })
    expect(at('ArrowLeft', 1, -1)).toEqual({ row: 1, col: -1 })
    expect(at('ArrowDown', 2, 3)).toEqual({ row: 2, col: 3 })
    expect(at('ArrowDown', 0, 3)).toEqual({ row: 1, col: 3 })
    expect(at('ArrowUp', 0, 3)).toEqual({ row: 0, col: 3 })
  })
  it('Home / End go to the row ends; with Ctrl, to the first and last cell', () => {
    expect(at('Home', 1, 4)).toEqual({ row: 1, col: -1 })
    expect(at('End', 1, 4)).toEqual({ row: 1, col: 6 })
    expect(at('Home', 2, 4, true)).toEqual({ row: 0, col: -1 })
    expect(at('End', 0, 0, true)).toEqual({ row: 2, col: 6 })
  })
  it('Page Up / Down ask for another week; other keys are not the grid’s', () => {
    expect(at('PageUp', 1, 1)).toBe('prev-week')
    expect(at('PageDown', 1, 1)).toBe('next-week')
    expect(at('Enter', 1, 1)).toBeNull()
    expect(at('a', 1, 1)).toBeNull()
    expect(weekGridKeyTarget('ArrowDown', 0, 0, 0, 7)).toBeNull()
  })
})

const days = weekDays('2026-09-28')
const general = (): WeekCell => ({ tone: 'shift', title: 'General', sub: '09:30 – 18:30' })
const rowsOf = (): WeekRow[] => [
  {
    key: 'p1', name: 'Priya Sharma',
    cells: [{ tone: 'pending', title: 'Leave?', sub: 'Waiting for you', onClick: () => {} }, general(), general(), general(),
      { tone: 'holiday', title: 'Gandhi Jayanti' }, { tone: 'off', title: 'Off' }, { tone: 'off', title: 'Off' }],
  },
  {
    key: 'p2', name: 'Arjun Nair', href: '/hrms/employees/p2',
    cells: [{ tone: 'alt', title: 'Evening', sub: '14:00 – 23:00' }, { tone: 'home', title: 'Home', sub: 'Approved' }, { tone: 'leave', title: 'Leave', sub: 'Approved' },
      null, { tone: 'holiday', title: 'Gandhi Jayanti' }, { tone: 'off', title: 'Off' }, { tone: 'off', title: 'Off' }],
  },
]

describe('WeekGrid: markup', () => {
  it('a grid: named, a column header per day and a row header per person, day cells', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="Team schedule" today="2026-09-30" />)
    expect(s).toContain('<table role="grid" aria-label="Team schedule" aria-readonly="true" class="uk-wg__table"')
    expect(count(s, 'role="columnheader"')).toBe(8)
    expect(count(s, 'role="rowheader"')).toBe(2)
    expect(count(s, 'role="gridcell"')).toBe(14)
    expect(s).toContain('<col class="uk-wg__col-name"/>')
    expect(s).toContain('Mon 28')
    expect(s).toContain('Sun 4')
  })
  it('is one Tab stop: only one cell (or its button / link) has tabindex 0, the rest -1', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="Team schedule" today="2026-09-30" />)
    expect(count(s, 'tabindex="0"')).toBe(1)
    // Starts on today's column of the first row (Wed 30 is index 2).
    expect(s).toMatch(/data-wg="0:2" tabindex="0"/)
    expect(count(s, 'data-wg=')).toBe(2 * 8)
  })
  it('without today in the week the first day takes the Tab stop', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" today="2026-09-25" />)
    expect(s).not.toContain('is-today')
    // Row 0 day 0 is Priya's waiting request: the button carries the stop.
    expect(s).toMatch(/data-wg="0:0" tabindex="0"/)
  })
  it('today’s column is marked in the header and the cells', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" today="2026-09-30" />)
    expect(s).toContain('<span class="uk-wg__todaytag">Today</span>')
    expect(count(s, 'class="uk-wg__td is-today"')).toBe(2)
    expect(s).toContain('aria-label="Wednesday, 30 September 2026, today"')
    expect(html(<WeekGrid days={days} rows={rowsOf()} label="x" today={null} />)).not.toContain('uk-wg__todaytag')
  })
  it('tiles in the design’s tones; a waiting request is a named button', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" today={null} />)
    expect(s).toContain('<button type="button" data-wg="0:0" tabindex="0" aria-label="Priya Sharma, Monday, 28 September 2026: Leave?, Waiting for you" class="uk-wg__tile uk-wg--pending uk-wg__act">')
    expect(s).toContain('<span class="uk-wg__tile uk-wg--shift"><span class="uk-wg__t">General</span><span class="uk-wg__s">09:30 – 18:30</span></span>')
    for (const tone of ['alt', 'home', 'leave', 'holiday', 'off']) expect(s).toContain(`uk-wg__tile uk-wg--${tone}`)
    // An empty day is an empty cell, still reachable by the arrows.
    expect(s).toMatch(/<td role="gridcell" class="uk-wg__td" data-wg="1:3" tabindex="-1"><\/td>/)
  })
  it('the name is a link only when the page gives one; it carries the row header’s focus', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" today={null} />)
    expect(s).toContain('<a class="uk-wg__person uk-wg__open" href="/hrms/employees/p2" data-wg="1:-1" tabindex="-1">')
    expect(s).toContain('<th scope="row" role="rowheader" class="uk-wg__name" data-wg="0:-1" tabindex="-1"><span class="uk-wg__person">')
    expect(s).toContain('>PS<')
  })
  it('coverage "auto": the header row counts who is in, or names the rest day', () => {
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" coverage="auto" today={null} />)
    expect(s).toContain('>In the office</th>')
    // Mon 28: Arjun on the evening shift is in, Priya's leave is still waiting: 1 of 2, not thin.
    expect(s).toContain('<span class="uk-wg__cov">1 of 2</span>')
    expect(s).toContain('aria-label="Monday, 28 September 2026, 1 of 2 in the office"')
    // Wed 30: Priya in, Arjun on leave → 1 of 2 (half is not thin).
    // Thu 1 Oct: Priya in, Arjun unknown.
    // Fri 2 Oct: the holiday.
    expect(s).toContain('<span class="uk-wg__cov">Holiday</span>')
    expect(s).toContain('<span class="uk-wg__cov">Weekly off</span>')
    expect(s).toContain('<span style="width:50.0%"></span>')
  })
  it('coverage from the page, with the thin note', () => {
    const cov = days.map((_, i) => (i === 0 ? { count: 3, total: 8, thin: true } : null))
    const s = html(<WeekGrid days={days} rows={rowsOf()} label="x" coverage={cov} today={null} />)
    expect(s).toContain('<span class="uk-wg__cov">3 of 8 · thin</span>')
    expect(s).toContain('3 of 8 in the office, thin')
  })
  it('pills: the roster look — status pills, a name column header, the department under the name', () => {
    const rows: WeekRow[] = [{ key: 'r', name: 'Farah Khan', sub: 'Support', cells: [{ tone: 'alt', title: 'Night' }, { tone: 'shift', title: 'General' }, { tone: 'leave', title: 'Leave' }, { tone: 'alt', title: 'Early', pill: 'warning' }, { tone: 'off', title: 'Off' }] }]
    const s = html(<WeekGrid days={days.slice(0, 5)} rows={rows} label="Roster" variant="pills" today={null} />)
    expect(s).toContain('uk-wg--pills')
    expect(s).toContain('>Employee</th>')
    expect(s).toContain('<span class="uk-wg__sub">Support</span>')
    expect(s).toContain('uk-pill uk-pill--sm uk-tone--info">Night</span>')
    expect(s).toContain('uk-pill uk-pill--sm uk-tone--brand">General</span>')
    expect(s).toContain('uk-pill uk-pill--sm uk-tone--neutral">Leave</span>')
    expect(s).toContain('uk-pill uk-pill--sm uk-tone--warning">Early</span>')
    expect(s).toContain('<span class="uk-wg__plain">Off</span>')
    expect(s).toContain('--wg-min:760px')
  })
  it('loading shows the table skeleton; no rows shows the page’s line', () => {
    const l = html(<WeekGrid days={days} rows={[]} label="Team schedule" loading />)
    expect(l).toContain('uk-skel-table')
    expect(l).toContain('Loading Team schedule')
    expect(l).not.toContain('<table')
    const e = html(<WeekGrid days={days} rows={[]} label="x" empty="No one in your team scope" />)
    expect(e).toContain('<td role="gridcell" colSpan="8" class="uk-wg__empty">No one in your team scope</td>')
  })
  it('legend swatches use the same tones', () => {
    const s = html(<WeekLegend items={[{ tone: 'shift', label: 'General shift' }, { tone: 'pending', label: 'Waiting for you · tap to decide' }]} />)
    expect(s).toContain('<span aria-hidden="true" class="uk-wg-legend__sw uk-wg--shift"></span>General shift')
    expect(s).toContain('uk-wg--pending')
  })
})
