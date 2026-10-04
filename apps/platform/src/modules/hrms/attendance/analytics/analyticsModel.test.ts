import { describe, expect, it } from 'vitest'
import {
  analyticsMonth, arrivalNote, barTone, checkInsIn, dayKind, dayRate, dur, lateTrend, leadingBlanks, monthEnd, noLateMarks, pct, pickDay, rateBand, rateDelta,
  trendChart, weekdayPlural,
} from './analyticsModel'
import type { DayBuckets } from '../attendanceBuckets'

const b = (o: Partial<DayBuckets>): DayBuckets => ({ total: 0, present: 0, regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, notMarked: 0, absent: 0, earlyOut: 0, other: 0, ...o })

describe('the month on show', () => {
  it('is this month unless ?month= names a past one', () => {
    expect(analyticsMonth(null, '2026-10-02')).toEqual({ month: '2026-10', past: false, from: '2026-10-01', to: '2026-10-02', current: '2026-10' })
    expect(analyticsMonth('2025-03', '2026-10-02')).toEqual({ month: '2025-03', past: true, from: '2025-03-01', to: '2025-03-31', current: '2026-10' })
    expect(analyticsMonth('2999-01', '2026-10-02').month).toBe('2026-10')
    expect(analyticsMonth('2026-13', '2026-10-02').month).toBe('2026-10')
    expect(monthEnd('2024-02')).toBe('2024-02-29')
  })
})

describe('the design’s figures', () => {
  it('formats the rate and compares it with the month before', () => {
    expect(pct(94.23)).toBe('94.2%')
    expect(pct(null)).toBeNull()
    expect(rateDelta(94.2, 93.1, 'August')).toEqual({ text: 'Up 1.1% on August', trend: 'up', mood: 'good' })
    expect(rateDelta(90, 92.5, 'August')).toEqual({ text: 'Down 2.5% on August', trend: 'down', mood: 'bad' })
    expect(rateDelta(90, 90, 'August')?.text).toBe('Same as August')
    expect(rateDelta(90, null, 'August')).toBeNull()
  })

  it('says how early or late people arrive against the shift', () => {
    expect(arrivalNote(-9)).toBe('9 min before shift')
    expect(arrivalNote(4.4)).toBe('4 min after shift')
    expect(arrivalNote(65)).toBe('1h 05m after shift')
    expect(arrivalNote(0)).toBe('Right at the shift start')
    expect(arrivalNote(null)).toBeNull()
  })

  it('colours bars green from 95% and gold below', () => {
    expect(barTone(96)).toBe('brand')
    expect(barTone(95)).toBe('brand')
    expect(barTone(94.9)).toBe('warning')
    expect(barTone(null)).toBe('warning')
  })
})

describe('punctuality', () => {
  it('names the worst weekday and the trend against the month before', () => {
    expect(weekdayPlural(1)).toBe('Mondays')
    expect(weekdayPlural(7)).toBe('Sundays')
    expect(weekdayPlural(null)).toBeNull()
    expect(lateTrend(7, 3)).toEqual({ label: 'Rising', tone: 'danger' })
    expect(lateTrend(2, 5)).toEqual({ label: 'Falling', tone: 'success' })
    expect(lateTrend(4, 4)).toEqual({ label: 'Steady', tone: 'warning' })
  })
})

describe('the trend chart', () => {
  it('draws a bar per day up to today, stacked, with day offs as a stub', () => {
    const daily = { '2026-09-01': b({ total: 10, present: 8, late: 2, absent: 1 }), '2026-09-06': b({ total: 10, weeklyOff: true }) }
    const c = trendChart({ month: '2026-09', today: '2026-09-07', past: false, daily, holidays: { '2026-09-02': 'Festival' }, offWd: [0], mobile: false })
    expect(c.days).toHaveLength(7)
    expect(c.days[0].tip).toBe('Tue 1 Sep · 6 on time · 2 late · 1 absent — tap to open that day')
    expect(c.days[1].tip).toBe('Wed 2 Sep · Festival')
    expect(c.days[1].off).toBe(true)
    expect(c.days[5].tip).toBe('Sun 6 Sep · weekly off')
    expect(c.days[6].today).toBe(true)
    expect(c.days[6].tip).toContain('(today)')
    expect(c.grid.map((g) => g.label)).toEqual(['0', '3', '7', '10'])
  })

  it('draws every day of a past month and thins the labels on phones', () => {
    const c = trendChart({ month: '2025-03', today: '2026-09-07', past: true, daily: {}, holidays: {}, offWd: [], mobile: true })
    expect(c.days).toHaveLength(31)
    expect(c.days.filter((d) => d.label).map((d) => d.label)).toEqual(['1', '4', '7', '10', '13', '16', '19', '22', '25', '28', '31'])
  })
})

describe('the calendar', () => {
  const ctx = { today: '2026-09-10', daily: { '2026-09-08': b({ total: 4, present: 3, absent: 1 }) } as Record<string, DayBuckets>, holidays: { '2026-09-09': 'Holiday' }, offWd: [0, 6] }
  it('tells each day apart', () => {
    expect(dayKind('2026-09-08', ctx)).toBe('work')
    expect(dayKind('2026-09-09', ctx)).toBe('holiday')
    expect(dayKind('2026-09-06', ctx)).toBe('off')
    expect(dayKind('2026-09-07', ctx)).toBe('none')
    expect(dayKind('2026-09-11', ctx)).toBe('future')
  })
  it('rates a day and opens on today, else the last working day', () => {
    expect(dayRate(ctx.daily['2026-09-08'])).toBe(75)
    expect(rateBand(96)).toBe('Great')
    expect(rateBand(90)).toBe('Good')
    expect(rateBand(75)).toBe('Needs a look')
    expect(pickDay(null, { month: '2026-09', ...ctx })).toBe('2026-09-10')
    expect(pickDay(null, { month: '2026-08', ...ctx, today: '2026-09-10', daily: { '2026-08-20': b({ total: 2, present: 2 }) } })).toBe('2026-08-20')
    expect(pickDay('2026-09-03', { month: '2026-09', ...ctx })).toBe('2026-09-03')
    expect(leadingBlanks('2026-09')).toBe(1)
    expect(dur(125)).toBe('2h 05m')
  })
})

describe('Punctuality with no late marks', () => {
  const m = { from: '2026-10-01', to: '2026-10-04' }
  it('counts the month’s check-ins from the breakdown, else the trend, else unknown', () => {
    expect(checkInsIn(m, 12, {})).toBe(12)
    expect(checkInsIn(m, 0, { '2026-10-01': b({ present: 3 }) })).toBe(0)
    expect(checkInsIn(m, undefined, { '2026-09-30': b({ present: 5 }), '2026-10-01': b({ present: 0, absent: 10 }), '2026-10-02': b({ present: 2 }) })).toBe(2)
    expect(checkInsIn(m, null, {})).toBeNull()
  })
  it('is good news only when people came in', () => {
    // 1 Oct: ten people absent, nobody came in all month: not "everyone came in on time".
    expect(noLateMarks(0, false)).toMatchObject({ success: false, title: 'No check-ins yet' })
    expect(noLateMarks(0, true).hint).toContain('that month')
    expect(noLateMarks(14, false)).toEqual({ success: true, title: 'No late marks', hint: 'Everyone came in on time this period.' })
    expect(noLateMarks(null, false).success).toBe(true)
  })
})
