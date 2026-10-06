import { describe, expect, it } from 'vitest'
import type { DailyAttendanceCounts } from '../api/useAttendance'
import {
  MAX_RANGE_DAYS, chipRangeLabel, dashboardPresets, parseRangeFrom, periodLabel, pickToUrl, rangeRollNote, rangeTotals,
} from './dashboardRange'

// Tue 6 Oct 2026.
const TODAY = '2026-10-06'

const day = (date: string, o: Partial<DailyAttendanceCounts> = {}): DailyAttendanceCounts => ({
  date, present: 0, onLeave: 0, late: 0, halfDay: 0, workFromHome: 0, notMarked: 0, absent: 0, overtimeMinutes: 0, ...o,
})

describe('the range start from the URL', () => {
  it('is one day without a start, or with a start that is not before the end', () => {
    expect(parseRangeFrom(null, TODAY)).toBeNull()
    expect(parseRangeFrom('', TODAY)).toBeNull()
    expect(parseRangeFrom(TODAY, TODAY)).toBeNull()
    expect(parseRangeFrom('2026-10-07', TODAY)).toBeNull()
    expect(parseRangeFrom('2026-02-30', TODAY)).toBeNull()
    expect(parseRangeFrom('1-10-2026', TODAY)).toBeNull()
  })
  it('keeps a start before the end', () => {
    expect(parseRangeFrom('2026-10-01', TODAY)).toBe('2026-10-01')
    expect(parseRangeFrom('2026-09-01', '2026-09-30')).toBe('2026-09-01')
  })
  it(`moves a start more than ${MAX_RANGE_DAYS} days back up to the earliest that fits`, () => {
    expect(parseRangeFrom('2026-01-01', TODAY)).toBe('2026-09-06')
    expect(parseRangeFrom('2026-09-06', TODAY)).toBe('2026-09-06')
  })
})

describe('labels', () => {
  it('says the period as each card note does', () => {
    expect(periodLabel('2026-10-01', '2026-10-06')).toBe('1–6 Oct')
    expect(periodLabel('2026-09-28', '2026-10-03')).toBe('28 Sep – 3 Oct')
    expect(periodLabel('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026')
    expect(periodLabel('2026-10-06', '2026-10-06')).toBe('6 Oct')
  })
  it('the date chip shows both ends with the year once', () => {
    expect(chipRangeLabel('2026-10-01', '2026-10-06')).toBe('1 Oct – 6 Oct 2026')
    expect(chipRangeLabel('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026')
  })
})

describe('quick picks', () => {
  it('Today, Yesterday, This week, Last week, This month, Last month, never past today', () => {
    expect(dashboardPresets(TODAY).map((p) => [p.label, p.from, p.to])).toEqual([
      ['Today', '2026-10-06', '2026-10-06'],
      ['Yesterday', '2026-10-05', '2026-10-05'],
      ['This week', '2026-10-05', '2026-10-06'],
      ['Last week', '2026-09-28', '2026-10-04'],
      ['This month', '2026-10-01', '2026-10-06'],
      ['Last month', '2026-09-01', '2026-09-30'],
    ])
  })
  it('a Sunday ends its week; January looks back to December', () => {
    const sun = dashboardPresets('2026-10-11')
    expect(sun.find((p) => p.key === 'thisWeek')).toMatchObject({ from: '2026-10-05', to: '2026-10-11' })
    const jan = dashboardPresets('2027-01-01')
    expect(jan.find((p) => p.key === 'lastMonth')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
    expect(jan.find((p) => p.key === 'yesterday')).toMatchObject({ from: '2026-12-31' })
  })
  it('every pick fits the longest range', () => {
    for (const t of ['2026-10-06', '2026-03-31', '2026-08-31']) {
      for (const p of dashboardPresets(t)) {
        const span = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 + 1
        expect(span).toBeLessThanOrEqual(MAX_RANGE_DAYS)
      }
    }
  })
})

describe('Apply', () => {
  it('one day: the URL has only the date (none for today)', () => {
    expect(pickToUrl({ from: TODAY, to: TODAY }, TODAY)).toEqual({ from: null, date: null })
    expect(pickToUrl({ from: '2026-10-02', to: '2026-10-02' }, TODAY)).toEqual({ from: null, date: '2026-10-02' })
  })
  it('a range: its first day and its last (none when it ends today)', () => {
    expect(pickToUrl({ from: '2026-10-01', to: TODAY }, TODAY)).toEqual({ from: '2026-10-01', date: null })
    expect(pickToUrl({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toEqual({ from: '2026-09-01', date: '2026-09-30' })
  })
  it('never past today', () => {
    expect(pickToUrl({ from: '2026-10-05', to: '2026-10-09' }, TODAY)).toEqual({ from: '2026-10-05', date: null })
  })
})

describe('the period’s totals', () => {
  // Thu 1 – Sun 4 Oct 2026 (V143.25 server: checkedIn sent). Sat and Sun are offs: nobody counted.
  const rows = [
    day('2026-09-30', { present: 9, checkedIn: 9 }), // before the period: left out
    day('2026-10-01', { present: 6, late: 2, halfDay: 1, checkedIn: 10, workFromHomeOnTime: 1, notMarked: 2, absent: 1 }),
    day('2026-10-02', { present: 8, late: 1, checkedIn: 9, notMarked: 3, absent: 1 }),
    day('2026-10-03', { weeklyOffDay: true }),
    day('2026-10-04', { weeklyOffDay: true }),
  ]
  it('adds up each day as one day is bucketed (every person once)', () => {
    const t = rangeTotals(rows, '2026-10-01', '2026-10-04', TODAY)
    expect(t.days).toBe(4)
    expect(t.present).toBe(19) // 10 + 9 came in
    expect(t.late).toBe(3)
    expect(t.halfDay).toBe(1)
    expect(t.wfh).toBe(1)
    expect(t.onLeave).toBe(1 + 2) // notMarked − absent
    expect(t.absent).toBe(2) // past days: no punch, no leave
    expect(t.notMarked).toBe(0)
    expect(t.scheduled).toBe(19 + 3 + 2)
    expect(t.attendancePct).toBe(79) // 19 of 24
    expect(t.perDay.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  })
  it('today in the period: no punch yet is "not marked", not an absence', () => {
    const t = rangeTotals([day('2026-10-05', { checkedIn: 4, present: 4, notMarked: 1, absent: 1 }), day(TODAY, { checkedIn: 3, present: 3, notMarked: 2, absent: 2 })], '2026-10-05', TODAY, TODAY)
    expect(t.absent).toBe(1)
    expect(t.notMarked).toBe(2)
    expect(t.attendancePct).toBe(Math.round((7 / 10) * 100))
  })
  it('nobody expected is 0%, never a division by zero', () => {
    const t = rangeTotals([day('2026-10-03', { weeklyOffDay: true })], '2026-10-03', '2026-10-03', TODAY)
    expect(t.attendancePct).toBe(0)
    expect(t.scheduled).toBe(0)
  })
})

describe('Total employees for a range', () => {
  it('the period’s joiners and leavers, or the end date on a server that can’t say', () => {
    expect(rangeRollNote({ joinedInPeriod: 3, leftInPeriod: 1 }, '1–6 Oct', '6 Oct')).toBe('3 joined · 1 left, 1–6 Oct')
    expect(rangeRollNote({ joinedInPeriod: 0 }, '1–6 Oct', '6 Oct')).toBe('0 joined · 0 left, 1–6 Oct')
    expect(rangeRollNote({}, '1–6 Oct', '6 Oct')).toBe('On 6 Oct')
    expect(rangeRollNote(undefined, '1–6 Oct', '6 Oct')).toBe('On 6 Oct')
  })
})
