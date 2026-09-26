import { describe, expect, it } from 'vitest'
import * as D from './dateMath'

describe('shared calendar date math', () => {
  it('normalises values like a native date input', () => {
    expect(D.normDay('2026-09-26')).toBe('2026-09-26')
    expect(D.normDay('2026-09-26T10:00:00Z')).toBe('2026-09-26')
    expect(D.normDay('2026-02-31')).toBe('')
    expect(D.normDay('26/09/2026')).toBe('')
    expect(D.normDay(null)).toBe('')
    expect(D.normMonth('2026-09-26')).toBe('2026-09')
    expect(D.normMonth('2026-13')).toBe('')
  })

  it('moves by months without overflowing short months', () => {
    expect(D.addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(D.addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(D.addMonths('2026-03-15', -12)).toBe('2025-03-15')
    expect(D.addMonthsYm('2026-01', -1)).toBe('2025-12')
  })

  it('builds a Monday-first 6-week month', () => {
    const cells = D.monthCells('2026-09')
    expect(cells).toHaveLength(42)
    expect(cells[0]).toBe('2026-08-31') // Monday
    expect(cells[1]).toBe('2026-09-01')
    expect(D.weekdayMon0('2026-09-27')).toBe(6) // Sunday
  })

  it('formats like the existing picker', () => {
    expect(D.fmtDay('2026-09-26')).toBe('Sat, 26 Sep 2026')
    expect(D.fmtDay('2026-09-26', 'short')).toBe('26 Sep 2026')
    expect(D.fmtMonth('2026-09')).toBe('September 2026')
    expect(D.fmtRange('2026-09-08', '2026-09-19')).toBe('8 – 19 Sep 2026')
    expect(D.fmtRange('2026-08-24', '2026-09-10')).toBe('24 Aug – 10 Sep 2026')
    expect(D.fmtRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027')
    expect(D.spanDays('2026-08-24', '2026-09-10')).toBe(18)
  })

  it('offers years 1940 … today+10 unless min/max say otherwise', () => {
    expect(D.yearSpan({ today: '2026-09-26' })).toEqual([1940, 2036])
    expect(D.yearSpan({ today: '2026-09-26', max: '2008-09-26' })).toEqual([1940, 2008])
    expect(D.yearSpan({ today: '2026-09-26', min: '2020-01-01', max: '2026-09-26' })).toEqual([2020, 2026])
    expect(D.yearSpan({ today: '2026-09-26', value: '1931-04-02' })).toEqual([1931, 2036])
  })

  it('filters day presets by min/max', () => {
    expect(D.defaultDayPresets('2026-09-26').map((p) => p.label)).toEqual(['Today', 'Yesterday', 'Tomorrow'])
    expect(D.defaultDayPresets('2026-09-26', undefined, '2026-09-26').map((p) => p.label)).toEqual(['Today', 'Yesterday'])
    expect(D.defaultDayPresets('2026-09-26', '2026-09-27').map((p) => p.value)).toEqual(['2026-09-27', '2026-09-28'])
    expect(D.defaultDayPresets('2026-09-26', undefined, '2008-01-01')).toEqual([])
  })

  it('clamps range presets to min/max and drops ones wholly outside', () => {
    const r = D.defaultRangePresets('2026-09-26', undefined, '2026-09-26')
    expect(r.find((p) => p.label === 'This month')).toEqual({ label: 'This month', from: '2026-09-01', to: '2026-09-26' })
    expect(r.find((p) => p.label === 'Last 7 days')).toEqual({ label: 'Last 7 days', from: '2026-09-20', to: '2026-09-26' })
    expect(r.find((p) => p.label === 'Last year')).toEqual({ label: 'Last year', from: '2025-01-01', to: '2025-12-31' })
    const late = D.defaultRangePresets('2026-09-26', '2026-09-01')
    expect(late.map((p) => p.label)).not.toContain('Last year')
    expect(late.map((p) => p.label)).not.toContain('Last month')
  })
})
