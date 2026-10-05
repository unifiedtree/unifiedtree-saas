// The "Select dates" rules (dateRangeModel.ts), the same cases as the mobile app's
// utils/dateRange.node-test.ts: the count is the server's (LeaveService.calculateWorkingDays)
// and every answer is the same whatever the machine's time zone.
import { describe, expect, it } from 'vitest'
import {
  countWorkingDays, datePresets, ddmmyyyy, monthWeeks, offDaysFromIso, settled, shiftDay, shiftMonth, tapDay, weekdayOf,
  workingDaysLabel, type WorkCalendar,
} from './dateRangeModel'
import { istToday } from '@/design/dc/dates'

const SAT_SUN: WorkCalendar = { off: offDaysFromIso([6, 7]), holidays: new Map() }
const DIWALI: WorkCalendar = { off: offDaysFromIso([6, 7]), holidays: new Map([['2026-11-09', 'Diwali']]) }
const byKey = (list: ReturnType<typeof datePresets>) => Object.fromEntries(list.map((p) => [p.key, p]))

describe('calendar arithmetic', () => {
  it('weekdays and day steps are the calendar’s, whatever the zone', () => {
    expect(weekdayOf('2026-10-05')).toBe(1)
    expect(weekdayOf('2026-10-04')).toBe(0)
    expect(weekdayOf('2027-01-01')).toBe(5)
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29')
  })
  it('the server’s weekly offs: ISO days, Sat + Sun when none are set', () => {
    expect([...offDaysFromIso([6, 7])].sort()).toEqual([0, 6])
    expect([...offDaysFromIso([7])]).toEqual([0])
    expect([...offDaysFromIso(null)].sort()).toEqual([0, 6])
    expect([...offDaysFromIso([0, 9])].sort()).toEqual([0, 6])
  })
})

describe('working days (as the server counts leave)', () => {
  it('skips the weekly offs', () => {
    expect(countWorkingDays('2026-10-09', '2026-10-12', SAT_SUN)).toBe(2)
    expect(countWorkingDays('2026-10-05', '2026-10-11', SAT_SUN)).toBe(5)
    expect(countWorkingDays('2026-10-05', '2026-10-05', SAT_SUN)).toBe(1)
    expect(countWorkingDays('2026-10-05', '2026-10-11', { off: offDaysFromIso([7]), holidays: new Map() })).toBe(6)
  })
  it('skips the company’s holidays; only offs and holidays is 0', () => {
    expect(countWorkingDays('2026-11-09', '2026-11-13', DIWALI)).toBe(4)
    expect(countWorkingDays('2026-11-09', '2026-11-09', DIWALI)).toBe(0)
    expect(countWorkingDays('2026-11-07', '2026-11-09', DIWALI)).toBe(0)
  })
  it('a half day is 0.5 on a working day, 0 on an off day', () => {
    expect(countWorkingDays('2026-10-05', '2026-10-05', SAT_SUN, true)).toBe(0.5)
    expect(countWorkingDays('2026-10-10', '2026-10-10', SAT_SUN, true)).toBe(0)
    expect(countWorkingDays('2026-11-09', '2026-11-09', DIWALI, true)).toBe(0)
    expect(workingDaysLabel(0.5)).toBe('0.5 working day')
    expect(workingDaysLabel(1)).toBe('1 working day')
    expect(workingDaysLabel(3)).toBe('3 working days')
  })
  it('runs across a month end and a year end', () => {
    expect(countWorkingDays('2026-10-28', '2026-11-03', SAT_SUN)).toBe(5)
    const ny: WorkCalendar = { off: offDaysFromIso([6, 7]), holidays: new Map([['2027-01-01', 'New Year’s Day']]) }
    expect(countWorkingDays('2026-12-31', '2027-01-04', ny)).toBe(2)
    expect(countWorkingDays('2026-10-12', '2026-10-09', SAT_SUN)).toBe(0)
  })
})

describe('taps', () => {
  it('start, then end; the same day twice is one day; a third tap starts again', () => {
    let r = tapDay({ from: null, to: null }, '2026-10-07', false)
    expect(r).toEqual({ from: '2026-10-07', to: null })
    expect(settled(r)).toEqual({ from: '2026-10-07', to: '2026-10-07' })
    r = tapDay(r, '2026-10-09', false)
    expect(r).toEqual({ from: '2026-10-07', to: '2026-10-09' })
    expect(tapDay(r, '2026-10-20', false)).toEqual({ from: '2026-10-20', to: null })
    expect(tapDay({ from: '2026-10-07', to: null }, '2026-10-07', false)).toEqual({ from: '2026-10-07', to: '2026-10-07' })
    expect(tapDay({ from: '2026-10-07', to: null }, '2026-10-05', false)).toEqual({ from: '2026-10-05', to: null })
    expect(tapDay({ from: '2026-10-07', to: '2026-10-07' }, '2026-10-09', true)).toEqual({ from: '2026-10-09', to: '2026-10-09' })
  })
})

describe('presets', () => {
  it('on a Monday', () => {
    const p = byKey(datePresets('2026-10-05', SAT_SUN, { min: '2026-10-05' }))
    expect([p.today.from, p.today.to]).toEqual(['2026-10-05', '2026-10-05'])
    expect([p.tomorrow.from, p.tomorrow.to]).toEqual(['2026-10-06', '2026-10-06'])
    expect([p.restOfWeek.from, p.restOfWeek.to]).toEqual(['2026-10-05', '2026-10-09'])
    expect([p.nextWeek.from, p.nextWeek.to]).toEqual(['2026-10-12', '2026-10-16'])
    expect([p.nextMonday.from, p.nextMonday.to]).toEqual(['2026-10-12', '2026-10-12'])
    expect(Object.values(p).every((x) => !x.disabled)).toBe(true)
  })
  it('across a month end and a year end', () => {
    const p = byKey(datePresets('2026-12-30', SAT_SUN))
    expect(p.tomorrow.from).toBe('2026-12-31')
    expect([p.restOfWeek.from, p.restOfWeek.to]).toEqual(['2026-12-30', '2027-01-01'])
    expect([p.nextWeek.from, p.nextWeek.to]).toEqual(['2027-01-04', '2027-01-08'])
    expect(p.nextMonday.from).toBe('2027-01-04')
    const q = byKey(datePresets('2026-10-30', SAT_SUN))
    expect(q.tomorrow.from).toBe('2026-10-31')
    expect([q.restOfWeek.from, q.restOfWeek.to]).toEqual(['2026-10-30', '2026-10-30'])
    expect(q.nextMonday.from).toBe('2026-11-02')
  })
  it('respect the form’s limits and the weekly offs', () => {
    expect(byKey(datePresets('2026-10-10', SAT_SUN)).restOfWeek.disabled).toBe(true)
    const hol = byKey(datePresets('2026-11-09', DIWALI))
    expect([hol.restOfWeek.from, hol.restOfWeek.to]).toEqual(['2026-11-10', '2026-11-13'])
    const capped = byKey(datePresets('2026-10-05', SAT_SUN, { max: '2026-10-06' }))
    expect(capped.nextWeek.disabled).toBe(true)
    expect(capped.nextMonday.disabled).toBe(true)
    expect([capped.restOfWeek.from, capped.restOfWeek.to]).toEqual(['2026-10-05', '2026-10-06'])
    expect(byKey(datePresets('2026-10-05', SAT_SUN, { min: '2026-10-06' })).today.disabled).toBe(true)
    expect(datePresets('2026-10-05', SAT_SUN, { single: true }).map((x) => x.key)).toEqual(['today', 'tomorrow', 'nextMonday'])
  })
  it('today is India’s day', () => {
    // 23:00 UTC on 4 Oct is 04:30 on 5 Oct in India.
    expect(istToday(new Date('2026-10-04T23:00:00Z'))).toBe('2026-10-05')
  })
})

describe('month grid', () => {
  it('is Monday first', () => {
    const oct = monthWeeks('2026-10')
    expect(oct[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(oct[oct.length - 1].filter(Boolean).pop()).toBe('2026-10-31')
    expect(monthWeeks('2027-02')).toHaveLength(4)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(ddmmyyyy('2026-10-05')).toBe('05/10/2026')
    expect(ddmmyyyy('')).toBe('DD/MM/YYYY')
  })
})
