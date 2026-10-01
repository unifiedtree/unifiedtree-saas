import { describe, expect, it } from 'vitest'
import { hours, mondayOf, shiftWeek, submitBlocker, weekDays, weekGrid, weekLabel, type TimeEntry } from './week'

describe('timesheet week maths', () => {
  it('finds the Monday of any day, Sunday included', () => {
    expect(mondayOf('2026-09-25')).toBe('2026-09-21') // Friday
    expect(mondayOf('2026-09-21')).toBe('2026-09-21') // Monday
    expect(mondayOf('2026-09-27')).toBe('2026-09-21') // Sunday
    expect(mondayOf('2026-10-01')).toBe('2026-09-28') // across a month
  })

  it('lists the seven days and moves by weeks', () => {
    expect(weekDays('2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(shiftWeek('2026-09-28', -1)).toBe('2026-09-21')
    expect(shiftWeek('2026-09-28', 1)).toBe('2026-10-05')
  })

  it('labels the week', () => {
    expect(weekLabel(weekDays('2026-09-21'), false)).toBe('Mon 21 – Fri 25 Sep')
    expect(weekLabel(weekDays('2026-09-28'), true)).toBe('Mon 28 Sep – Sun 4 Oct')
  })

  it('writes hours plainly', () => {
    expect(hours(0)).toBe('—')
    expect(hours(360)).toBe('6h')
    expect(hours(330)).toBe('5h 30m')
    expect(hours(30)).toBe('0h 30m')
  })

  it('adds time up per project and per day', () => {
    const days = weekDays('2026-09-21')
    const e = (id: string, workDate: string, minutes: number, projectId?: string, description = ''): TimeEntry =>
      ({ id, workDate, minutes, description, projectId: projectId ?? null, projectName: projectId ? 'Payments v2' : null, projectCode: projectId ? 'PAY-V2' : null })
    const g = weekGrid([
      e('1', '2026-09-21', 330, 'p1'), e('2', '2026-09-22', 360, 'p1'), e('3', '2026-09-21', 60, undefined, 'Code review'),
      e('4', '2026-09-23', 30, undefined, ' code review '), e('5', '2026-09-28', 99, 'p1'), // next week: left out
    ], days)
    expect(g.total).toBe(780)
    expect(g.perDay.slice(0, 3)).toEqual([390, 360, 30])
    expect(g.rows.map((r) => [r.name, r.code, r.total])).toEqual([['Payments v2', 'PAY-V2', 690], ['Code review', null, 90]])
  })

  it('says why a week can’t be submitted', () => {
    expect(submitBlocker('2026-10-05', '2026-10-01', 60, null)).toMatch(/started/)
    expect(submitBlocker('2026-09-28', '2026-10-01', 0, null)).toMatch(/Log some time/)
    expect(submitBlocker('2026-09-28', '2026-10-01', 60, 'SUBMITTED')).toMatch(/waiting/)
    expect(submitBlocker('2026-09-28', '2026-10-01', 60, 'REJECTED')).toBeNull()
    expect(submitBlocker('2026-09-21', '2026-10-01', 60, null)).toBeNull()
  })
})
