import { describe, expect, it } from 'vitest'
import {
  breakdownGroups, breakdownOptions, breakdownRows, breakdownSheets, joinersByMonth, monthToDate, nothingRecorded, signed,
  type BreakdownGroup, type HeadcountBreakdown,
} from './workforceModel'

const g = (name: string, total: number, extra: Partial<BreakdownGroup> = {}): BreakdownGroup => ({ name, none: false, total, active: total, probation: 0, onNotice: 0, ...extra })

const answer = (over: Partial<HeadcountBreakdown> = {}): HeadcountBreakdown => ({
  asOf: '2026-10-06', total: 5, active: 3, probation: 1, onNotice: 1,
  byBranch: [g('Pune', 3, { active: 2, probation: 1 }), g('No branch', 2, { none: true, active: 1, onNotice: 1 })],
  byDesignation: [g('Developer', 5)],
  byEmploymentType: [g('Full-time', 5)],
  byAgeBand: [g('Under 25', 0), g('25–34', 2), g('Not recorded', 3, { none: true })],
  byTenureBand: [g('Under 6 months', 5)],
  genderIncluded: true,
  byGender: [g('Female', 2), g('Male', 3)],
  ...over,
})

describe('breakdown options', () => {
  it('lists every breakdown, gender only when the server included it', () => {
    expect(breakdownOptions(answer()).map((o) => o.value)).toEqual(['branch', 'designation', 'type', 'gender', 'age', 'tenure'])
    expect(breakdownOptions(answer({ genderIncluded: false, byGender: null })).map((o) => o.value)).toEqual(['branch', 'designation', 'type', 'age', 'tenure'])
    expect(breakdownOptions(undefined)).toEqual([])
  })

  it('picks the chosen breakdown, or the first one for an unknown or hidden choice', () => {
    expect(breakdownGroups(answer(), 'age')?.groups.map((x) => x.name)).toEqual(['Under 25', '25–34', 'Not recorded'])
    expect(breakdownGroups(answer(), 'nonsense')?.key).toBe('branch')
    expect(breakdownGroups(answer({ genderIncluded: false, byGender: null }), 'gender')?.key).toBe('branch')
    expect(breakdownGroups(undefined, 'branch')).toBeNull()
  })
})

describe('breakdown rows (table, CSV and workbook)', () => {
  it('has a header, one line per group and a total that matches the headcount', () => {
    expect(breakdownRows(answer(), 'branch')).toEqual([
      ['Branch', 'Total', 'Active', 'Probation', 'On notice', 'Share %'],
      ['Pune', 3, 2, 1, 0, 60],
      ['No branch', 2, 1, 0, 1, 40],
      ['Total', 5, 3, 1, 1, 100],
    ])
  })

  it('a company with nobody gets a zero total, not NaN', () => {
    const empty = answer({ total: 0, active: 0, probation: 0, onNotice: 0, byBranch: [] })
    expect(breakdownRows(empty, 'branch')).toEqual([['Branch', 'Total', 'Active', 'Probation', 'On notice', 'Share %'], ['Total', 0, 0, 0, 0, 0]])
  })

  it('one sheet per breakdown, names within Excel\'s 31 characters', () => {
    const sheets = breakdownSheets(answer())
    expect(sheets.map((s) => s.name)).toEqual(['By branch', 'By designation', 'By employment type', 'By gender', 'By age band', 'By time with us'])
    expect(sheets.every((s) => s.name.length <= 31)).toBe(true)
  })
})

describe('nothing recorded', () => {
  it('is true only when everyone sits on the "Not recorded" line', () => {
    expect(nothingRecorded([g('Under 25', 0), g('Not recorded', 4, { none: true })])).toBe(true)
    expect(nothingRecorded([g('Under 25', 1), g('Not recorded', 4, { none: true })])).toBe(false)
    expect(nothingRecorded([g('Under 25', 0)])).toBe(false)
    expect(nothingRecorded([])).toBe(false)
  })
})

describe('joiners and month to date', () => {
  it('maps joiners by month; no answer means not available', () => {
    expect(joinersByMonth([{ month: '2026-09', joined: 4 }, { month: '2026-10', joined: 0 }])?.get('2026-09')).toBe(4)
    expect(joinersByMonth(undefined)).toBeNull()
  })

  it('month to date starts the day before the 1st (the change endpoint counts after "from")', () => {
    expect(monthToDate('2026-10-06')).toEqual({ from: '2026-09-30', to: '2026-10-06' })
    expect(monthToDate('2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-03-01' })
    expect(monthToDate('2026-01-15')).toEqual({ from: '2025-12-31', to: '2026-01-15' })
  })

  it('signs the net change', () => {
    expect(signed(3)).toBe('+3')
    expect(signed(-2)).toBe('−2')
    expect(signed(0)).toBe('0')
  })
})
