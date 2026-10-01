import { describe, expect, it } from 'vitest'
import { daysUntil, fmtDate, fmtDateTime, hrs, inr, plural, tenure } from './profileFormat'

describe('profile formatters', () => {
  it('formats dates as the design does, a dash when empty or not a date', () => {
    expect(fmtDate('2022-03-12')).toBe('12 Mar 2022')
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('nonsense')).toBe('—')
  })

  it('says today and yesterday in India’s clock, else the date and time', () => {
    expect(fmtDateTime('2026-10-02T03:51:00Z', '2026-10-02')).toBe('Today 09:21')
    expect(fmtDateTime('2026-10-01T12:30:00Z', '2026-10-02')).toBe('Yesterday 18:00')
    expect(fmtDateTime('2026-09-20T04:00:00Z', '2026-10-02')).toBe('20 Sep 2026, 09:30')
    // 23:00 UTC on the 1st is already the 2nd in India.
    expect(fmtDateTime('2026-10-01T23:00:00Z', '2026-10-02')).toBe('Today 04:30')
    expect(fmtDateTime('', '2026-10-02')).toBe('—')
  })

  it('works out tenure in years and months, never a negative one', () => {
    expect(tenure('2022-03-12', '2026-09-25')).toBe('4 yrs 6 mos')
    expect(tenure('2026-01-15', '2026-02-14')).toBe('less than a month')
    expect(tenure('2025-09-25', '2026-09-25')).toBe('1 yr')
    expect(tenure('2026-12-01', '2026-10-02')).toBe('')
    expect(tenure(null, '2026-10-02')).toBe('')
  })

  it('counts days to a date', () => {
    expect(daysUntil('2026-10-12', '2026-10-02')).toBe(10)
    expect(daysUntil('2026-09-30', '2026-10-02')).toBe(-2)
  })

  it('formats money, hours and plurals', () => {
    expect(inr(1800000)).toBe('₹18,00,000')
    expect(inr(null)).toBe('—')
    expect(hrs(26.6667)).toBe('26h 40m')
    expect(hrs(8)).toBe('8h')
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(3, 'day')).toBe('3 days')
  })
})
