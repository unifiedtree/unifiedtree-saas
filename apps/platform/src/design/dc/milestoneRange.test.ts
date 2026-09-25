import { describe, expect, it } from 'vitest'
import { addMonths, emptyText, isValidRange, lastTo, maxTo, presetRange, rangeLabel, rangeOf, rangeOptions, rangeReach, reachNote, rowLabels, serverRange, viewAllPath } from './milestoneRange'

const today = '2026-09-26'

describe('upcoming milestones: date ranges', () => {
  it('presets look ahead from today', () => {
    expect(presetRange('birthdays', 'this-month', today)).toEqual({ from: '2026-09-26', to: '2026-09-30' })
    expect(presetRange('birthdays', 'next-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('birthdays', 'next-3', today)).toEqual({ from: '2026-09-26', to: '2026-12-26' })
    expect(presetRange('birthdays', 'next-6', today)).toEqual({ from: '2026-09-26', to: '2027-03-26' })
    expect(presetRange('birthdays', 'this-year', today)).toEqual({ from: '2026-09-26', to: '2026-12-31' })
    // Each list's own window, as before ranges.
    expect(presetRange('birthdays', 'default', today)).toEqual({ from: today, to: '2026-10-10' })
    expect(presetRange('anniversaries', 'default', today)).toEqual({ from: today, to: '2026-10-27' })
    expect(presetRange('retirements', 'default', today)).toEqual({ from: today, to: '2027-03-26' })
    // "Next month" from December is January of the next year.
    expect(presetRange('birthdays', 'next-month', '2026-12-10')).toEqual({ from: '2027-01-01', to: '2027-01-31' })
  })

  it('months that are shorter move the day back', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('a custom range is at most 12 months, like the server', () => {
    expect(maxTo('2027-01-01')).toBe('2027-12-31')
    expect(maxTo('2028-02-29')).toBe('2029-02-27')
    expect(isValidRange('2026-12-15', '2027-01-20')).toBe(true)
    expect(isValidRange('2026-09-26', '2027-09-25')).toBe(true)
    expect(isValidRange('2026-09-26', '2027-09-26')).toBe(false)
    expect(isValidRange('2026-10-02', '2026-10-01')).toBe(false)
    expect(isValidRange('2026-02-30', '2026-03-01')).toBe(false)
    expect(isValidRange('nope', '2026-03-01')).toBe(false)
    expect(isValidRange(null, '2026-03-01')).toBe(false)
  })

  it('a custom range reaches only as far as the server shows', () => {
    // Birthdays and anniversaries: a year either side of today.
    expect(rangeReach('birthdays', today)).toEqual({ min: '2025-09-26', max: '2027-09-26' })
    expect(rangeReach('anniversaries', today, true)).toEqual({ min: '2025-09-26', max: '2027-09-26' })
    // Retirements on the milestones list: today to 60 months on; from retirement due: no limit.
    expect(rangeReach('retirements', today)).toEqual({ min: today, max: '2031-09-26' })
    expect(rangeReach('retirements', today, true)).toEqual({})
    // Every preset stays inside the reach.
    for (const kind of ['birthdays', 'anniversaries', 'retirements'] as const) {
      const reach = rangeReach(kind, today)
      for (const o of rangeOptions(kind).filter((x) => x.value !== 'custom')) {
        const r = presetRange(kind, o.value, today)
        expect(r.from >= reach.min! && r.to <= reach.max!).toBe(true)
      }
    }
    // The To calendar ends at 12 months less a day, or at the reach's end if sooner.
    expect(lastTo('2027-06-01')).toBe('2028-05-31')
    expect(lastTo('2027-06-01', rangeReach('birthdays', today))).toBe('2027-09-26')
    expect(lastTo('2031-06-01', rangeReach('retirements', today))).toBe('2031-09-26')
    expect(lastTo('2031-06-01', rangeReach('retirements', today, true))).toBe('2032-05-31')
    expect(reachNote('birthdays', rangeReach('birthdays', today))).toBe('Up to 12 months, within a year of today.')
    expect(reachNote('retirements', rangeReach('retirements', today))).toBe('Up to 12 months, from today to 5 years ahead.')
    expect(reachNote('retirements', rangeReach('retirements', today, true))).toBe('Up to 12 months.')
  })

  it('a list on its own window asks the server for nothing new; a range asks for its dates', () => {
    expect(serverRange('birthdays', { preset: 'default' }, today)).toBeNull()
    expect(serverRange('birthdays', { preset: 'next-3' }, today)).toEqual({ from: today, to: '2026-12-26' })
    expect(serverRange('birthdays', { preset: 'custom', from: '2026-12-15', to: '2027-01-20' }, today)).toEqual({ from: '2026-12-15', to: '2027-01-20' })
    // Unusable custom dates fall back to the window.
    expect(serverRange('birthdays', { preset: 'custom', from: '2026-12-15', to: '2028-01-20' }, today)).toBeNull()
    expect(rangeOf('birthdays', { preset: 'custom', from: '2026-12-15', to: '2028-01-20' }, today)).toEqual({ from: today, to: '2026-10-10' })
  })

  it('"View all" carries the same dates', () => {
    expect(viewAllPath('birthdays', { preset: 'default' }, today)).toBe('/hrms/employees?filter=birthday')
    expect(viewAllPath('anniversaries', { preset: 'next-month' }, today)).toBe('/hrms/employees?filter=anniversary&from=2026-10-01&to=2026-10-31')
    expect(viewAllPath('retirements', { preset: 'custom', from: '2026-12-15', to: '2027-01-20' }, today)).toBe('/hrms/employees?filter=retirement&from=2026-12-15&to=2027-01-20')
  })

  it('menus: each list keeps its own window first; retirements already have "Next 6 months"', () => {
    expect(rangeOptions('birthdays').map((o) => o.label)).toEqual(['Next 14 days', 'This month', 'Next month', 'Next 3 months', 'Next 6 months', 'This year', 'Custom range'])
    expect(rangeOptions('retirements').map((o) => o.value)).toEqual(['this-month', 'next-month', 'next-3', 'default', 'this-year', 'custom'])
  })

  it('labels', () => {
    expect(rangeLabel({ from: '2026-09-26', to: '2026-09-30' })).toBe('26 – 30 Sep 2026')
    expect(rangeLabel({ from: '2026-09-26', to: '2026-12-26' })).toBe('26 Sep – 26 Dec 2026')
    expect(rangeLabel({ from: '2026-12-15', to: '2027-01-20' })).toBe('15 Dec 2026 – 20 Jan 2027')
    expect(emptyText('anniversaries', { preset: 'default' })).toBe('No work anniversaries in the next 31 days.')
    expect(emptyText('birthdays', { preset: 'next-month' })).toBe('No birthdays next month.')
    expect(rowLabels('birthdays', '2026-09-27', null, today)).toEqual({ when: 'Tomorrow', sub: '27 Sep' })
    expect(rowLabels('birthdays', '2026-09-20', null, today)).toEqual({ when: '6 days ago', sub: '20 Sep' })
    expect(rowLabels('anniversaries', '2026-10-06', 3, today)).toEqual({ when: 'in 10 days', sub: '3 years' })
    expect(rowLabels('retirements', '2027-01-25', 60, today)).toEqual({ when: '25 Jan 2027', sub: 'in 4 months' })
  })
})
