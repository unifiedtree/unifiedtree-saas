import { describe, expect, it } from 'vitest'
import { changeText, datedParams, miniFor, ptsSince, ptsText, scheduleWhen, womenPct } from './reportModel'
import { solid } from '@/shared/export/charts'
import type { DiversityRow, ReportSummary } from '@/modules/hrms/api/useReports'

const S = (o: Partial<ReportSummary>): ReportSummary => ({ companyId: 'c', asOf: '2026-10-02', ...o })

describe('the dashboard date travels to the reports that take one', () => {
  it('headcount and diversity as of the day; attendance and late marks for its month; attrition for 12 months', () => {
    expect(datedParams('/hrms/reports/headcount', '2026-09-15')).toEqual({ asOf: '2026-09-15' })
    expect(datedParams('/hrms/reports/diversity', '2026-09-15')).toEqual({ asOf: '2026-09-15' })
    expect(datedParams('/hrms/reports/late-marks', '2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-15' })
    expect(datedParams('/hrms/reports/attrition', '2026-09-15')).toEqual({ from: '2025-10-01', to: '2026-09-15' })
    expect(datedParams('/hrms/reports/leave-balance', '2026-09-15')).toEqual({})
  })
})

describe('tile mini charts come from the summary, each only when its series is there', () => {
  it('draws nothing without a summary or without that series', () => {
    expect(miniFor('headcount', undefined)).toBeNull()
    expect(miniFor('attrition', S({}))).toBeNull()
    expect(miniFor('leave', S({}))).toBeNull()
  })
  it('headcount: the biggest departments as bars, the biggest lit', () => {
    const m = miniFor('headcount', S({ headcount: { total: 10, departments: [{ departmentId: 'a', name: 'Eng', count: 6 }, { departmentId: 'b', name: 'Ops', count: 4 }] } }))
    expect(m).toEqual({ kind: 'bars', values: [6, 4], hi: [0] })
  })
  it('attrition and late marks: a line of the real values', () => {
    expect(miniFor('attrition', S({ attrition: { months: [{ month: '2026-09', exits: 1, headcount: 20, pct: 4.9 }, { month: '2026-10', exits: 0, headcount: 20, pct: 0 }] } })))
      .toEqual({ kind: 'line', values: [4.9, 0] })
    expect(miniFor('late', S({ lateMarks: { from: 'a', to: 'b', days: [{ date: 'a', count: 2 }, { date: 'b', count: 0 }] } }))).toEqual({ kind: 'line', values: [2, 0] })
  })
  it('diversity: men and women shares, or a plain line when no gender is on file', () => {
    expect(miniFor('diversity', S({ diversity: { women: 3, men: 6, other: 1, total: 10 } }))).toEqual({ kind: 'split', a: 60, aLabel: '60% men', bLabel: '30% women' })
    expect(miniFor('diversity', S({ diversity: { women: 0, men: 0, other: 19, total: 19 } }))).toEqual({ kind: 'none', text: 'No gender recorded yet' })
  })
  it('attendance: the last day is lit; leave: used against available', () => {
    expect(miniFor('attendance', S({ attendance: { from: 'a', to: 'b', days: [{ date: 'a', present: 3 }, { date: 'b', present: 5 }] } }))).toEqual({ kind: 'bars', values: [3, 5], hi: [1] })
    expect(miniFor('leave', S({ leaveBalance: { year: 2026, entitlement: 20, used: 5, pending: 0, available: 15 } }))).toEqual({ kind: 'split', a: 25, aLabel: '25% used', bLabel: '75% available' })
    expect(miniFor('leave', S({ leaveBalance: { year: 2026, entitlement: 0, used: 0, pending: 0, available: 0 } }))).toEqual({ kind: 'none', text: 'No balances for 2026 yet' })
  })
})

describe('hero change lines', () => {
  it('says the change in words', () => {
    expect(changeText(6, 'this month')).toBe('+6 this month')
    expect(changeText(-2, 'this month')).toBe('2 fewer this month')
    expect(changeText(0, 'this month')).toBe('No change this month')
    expect(ptsText(-0.34, 'Sep')).toBe('0.3 pts lower than Sep')
    expect(ptsText(1.25, 'Sep')).toBe('1.3 pts higher than Sep')
    expect(ptsText(0.01, 'Sep')).toBe('Same as Sep')
    expect(ptsSince(2.4, '1 Apr')).toBe('+2 pts since 1 Apr')
    expect(ptsSince(-3, '1 Apr')).toBe('3 pts lower since 1 Apr')
    expect(ptsSince(0.2, '1 Apr')).toBe('No change since 1 Apr')
  })
  it('women share from the diversity rows; nothing without people', () => {
    const rows = [{ gender: 'FEMALE', count: 2 }, { gender: 'MALE', count: 6 }] as DiversityRow[]
    expect(womenPct(rows)).toBe(25)
    expect(womenPct([])).toBeNull()
    expect(womenPct(undefined)).toBeNull()
  })
})

describe('report email timing', () => {
  it('reads like the design, with the first run of the day when no hour is set', () => {
    expect(scheduleWhen({ frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: null, sendHour: 9 })).toBe('Every Monday, 09:00')
    expect(scheduleWhen({ frequency: 'WEEKDAYS', dayOfWeek: null, dayOfMonth: null, sendHour: 11 })).toBe('Every weekday, 11:00')
    expect(scheduleWhen({ frequency: 'MONTHLY', dayOfWeek: null, dayOfMonth: 1, sendHour: null })).toBe('1st of every month, 07:00')
    expect(scheduleWhen({ frequency: 'DAILY', dayOfWeek: null, dayOfMonth: null, sendHour: 23 })).toBe('Every day, 23:00')
  })
})

describe('PNG exports resolve design tokens', () => {
  it('uses the token’s light value', () => {
    expect(solid('var(--u-br,#0F6E56)')).toBe('#0F6E56')
    expect(solid('var(--u-g2, #5FB39C)')).toBe('#5FB39C')
    expect(solid('#34d399')).toBe('#34d399')
  })
})
