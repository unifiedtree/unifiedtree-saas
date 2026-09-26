import { describe, expect, it } from 'vitest'
import { endOfIstDay, monthToDate, parseDashboardDate, payrollWindow } from './dashboardDate'

const TODAY = '2026-09-26'

describe('dashboard date from the URL', () => {
  it('is today (live view) with no date', () => {
    expect(parseDashboardDate(null, TODAY)).toEqual({ date: null, future: false, invalid: false })
    expect(parseDashboardDate('', TODAY).date).toBeNull()
  })
  it('keeps a past day, including earlier years', () => {
    expect(parseDashboardDate('2025-03-14', TODAY).date).toBe('2025-03-14')
    expect(parseDashboardDate('2026-09-25', TODAY).date).toBe('2026-09-25')
  })
  it('treats today itself as the live view', () => {
    expect(parseDashboardDate(TODAY, TODAY)).toEqual({ date: null, future: false, invalid: false })
  })
  it('refuses a day after today', () => {
    expect(parseDashboardDate('2026-09-27', TODAY)).toEqual({ date: null, future: true, invalid: false })
    expect(parseDashboardDate('2031-01-01', TODAY).future).toBe(true)
  })
  it('ignores values that are not real days', () => {
    expect(parseDashboardDate('2025-02-30', TODAY).invalid).toBe(true)
    expect(parseDashboardDate('14-03-2025', TODAY).invalid).toBe(true)
    expect(parseDashboardDate('yesterday', TODAY).date).toBeNull()
  })
})

describe('dashboard date helpers', () => {
  it('ends an IST day at 18:29:59.999 UTC', () => {
    expect(endOfIstDay('2025-03-14')).toBe('2025-03-14T18:29:59.999Z')
    expect(endOfIstDay('2025-12-31')).toBe('2025-12-31T18:29:59.999Z')
  })
  it('labels the month so far', () => {
    expect(monthToDate('2025-03-14')).toBe('1–14 Mar 2025')
    expect(monthToDate('2025-03-01')).toBe('1 Mar 2025')
  })
  it('keeps the six payroll months ending at the selected month', () => {
    const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'].map((month) => ({ month }))
    expect(payrollWindow(months, '2025-03').map((m) => m.month)).toEqual(['2025-01', '2025-02', '2025-03'])
    expect(payrollWindow(months, '2026-09').map((m) => m.month)).toEqual(['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'])
    expect(payrollWindow(months, '2024-12')).toEqual([])
  })
})
