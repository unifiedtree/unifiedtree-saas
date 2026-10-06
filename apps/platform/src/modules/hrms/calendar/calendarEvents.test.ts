import { describe, expect, it } from 'vitest'
import { viewPresets } from '@/design/kit/dateRangeModel'
import {
  agenda, applyFilter, byDay, filterCounts, holidayEvents, isSickLeave, leaveEvents, leaveTypesIn, leaveWindow, milestoneEvents, monthSpan, onlyPeople, spanText,
  type LeaveLike,
} from './calendarEvents'

const leave = (p: Partial<LeaveLike>): LeaveLike => ({
  id: 'r1', employeeName: 'Asha Verma', leaveTypeId: 'cl', leaveTypeName: 'Casual Leave', leaveTypeCode: 'CL', leaveTypeCategory: 'CASUAL',
  startDate: '2026-10-06', endDate: '2026-10-06', status: 'APPROVED', ...p,
})

describe('isSickLeave', () => {
  it('goes by the category first', () => {
    expect(isSickLeave({ leaveTypeCategory: 'SICK', leaveTypeName: 'Medical' })).toBe(true)
    expect(isSickLeave({ leaveTypeCategory: 'CASUAL', leaveTypeName: 'Sick-ish casual' })).toBe(false)
  })
  it('falls back to the code or the name for types without a category', () => {
    expect(isSickLeave({ leaveTypeCode: 'SL' })).toBe(true)
    expect(isSickLeave({ leaveTypeName: 'Sick Leave' })).toBe(true)
    expect(isSickLeave({ leaveTypeName: 'Casual Leave', leaveTypeCode: 'CL' })).toBe(false)
  })
})

describe('leaveEvents', () => {
  it('puts approved leave on every day inside the window, sick leave apart', () => {
    const ev = leaveEvents([
      leave({ id: 'a', startDate: '2026-09-29', endDate: '2026-10-02' }),
      leave({ id: 's', leaveTypeId: 'sl', leaveTypeName: 'Sick Leave', leaveTypeCategory: 'SICK', startDate: '2026-10-05', endDate: '2026-10-06' }),
      leave({ id: 'p', status: 'PENDING' }),
    ], '2026-10-01', '2026-10-31')
    expect(ev.map((e) => `${e.kind}:${e.date}`)).toEqual(['leave:2026-10-01', 'leave:2026-10-02', 'sick:2026-10-05', 'sick:2026-10-06'])
    expect(ev[0].detail).toBe('Casual Leave · 29 Sep – 2 Oct · 4 days')
    expect(ev[2].detail).toBe('Sick Leave · 5 – 6 Oct · 2 days')
  })
  it('counts a request once even when the feed repeats it', () => {
    expect(leaveEvents([leave({}), leave({})], '2026-10-01', '2026-10-31')).toHaveLength(1)
  })
})

describe('holidays and people', () => {
  it('keeps active holidays and milestones in the window', () => {
    const h = holidayEvents([{ id: 'h1', holidayDate: '2026-10-20', holidayName: 'Diwali' }, { id: 'h2', holidayDate: '2026-11-01', holidayName: 'Later' },
      { id: 'h3', holidayDate: '2026-10-21', holidayName: 'Off', active: false }], '2026-10-01', '2026-10-31')
    expect(h.map((e) => e.title)).toEqual(['Diwali'])
    const b = milestoneEvents('anniversary', [{ employeeId: 'e1', name: 'Ravi', date: '2026-10-09', years: 3 }], '2026-10-01', '2026-10-31')
    expect(b[0]).toMatchObject({ kind: 'anniversary', detail: '3 years at work', employeeId: 'e1' })
  })
  it('keeps a team’s own birthdays only', () => {
    const list = [...milestoneEvents('birthday', [{ employeeId: 'in', name: 'A', date: '2026-10-09' }, { employeeId: 'out', name: 'B', date: '2026-10-09' }], '2026-10-01', '2026-10-31'),
      ...holidayEvents([{ holidayDate: '2026-10-20', holidayName: 'Diwali' }], '2026-10-01', '2026-10-31')]
    expect(onlyPeople(list, new Set(['in'])).map((e) => e.title)).toEqual(['A', 'Diwali'])
    expect(onlyPeople(list, null)).toHaveLength(3)
  })
})

describe('filters and grouping', () => {
  const list = [
    ...holidayEvents([{ holidayDate: '2026-10-20', holidayName: 'Diwali' }], '2026-10-01', '2026-10-31'),
    ...leaveEvents([leave({ id: 'a', startDate: '2026-10-19', endDate: '2026-10-20' }),
      leave({ id: 's', leaveTypeId: 'sl', leaveTypeName: 'Sick Leave', leaveTypeCategory: 'SICK', startDate: '2026-10-20', endDate: '2026-10-20' })], '2026-10-01', '2026-10-31'),
    ...milestoneEvents('birthday', [{ employeeId: 'e1', name: 'Ravi', date: '2026-10-20' }], '2026-10-01', '2026-10-31'),
  ]
  it('"Leave" is every leave type; "Sick leave" only sick; a leave type narrows only the leave', () => {
    expect(new Set(applyFilter(list, 'leave', null).map((e) => e.kind))).toEqual(new Set(['leave', 'sick']))
    expect(applyFilter(list, 'sick', null).every((e) => e.kind === 'sick')).toBe(true)
    expect(applyFilter(list, 'all', 'sl').map((e) => e.kind).sort()).toEqual(['birthday', 'holiday', 'sick'])
  })
  it('counts things, not days', () => {
    expect(filterCounts(list)).toMatchObject({ all: 4, holiday: 1, leave: 2, sick: 1, birthday: 1, anniversary: 0 })
    expect(leaveTypesIn(list)).toEqual([{ id: 'cl', name: 'Casual Leave', sick: false, count: 1 }, { id: 'sl', name: 'Sick Leave', sick: true, count: 1 }])
  })
  it('orders a day holiday, sick leave, leave, birthday', () => {
    expect(byDay(list).get('2026-10-20')!.map((e) => e.kind)).toEqual(['holiday', 'sick', 'leave', 'birthday'])
    expect(agenda(list, '2026-10-19', '2026-10-19').map((g) => g.date)).toEqual(['2026-10-19'])
  })
})

describe('dates', () => {
  it('month span, span text and the leave feed window', () => {
    expect(monthSpan('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthSpan('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(spanText('2026-10-06', '2026-10-06')).toBe('6 Oct')
    expect(leaveWindow('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31', clipped: false })
    expect(leaveWindow('2026-10-01', '2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-01', clipped: true })
  })
  it('the six view presets', () => {
    const p = viewPresets('2026-10-06') // a Tuesday
    expect(p.map((x) => x.label)).toEqual(['Today', 'This week', 'Next week', 'This month', 'Next month', 'Next 30 days'])
    expect(p.map((x) => [x.from, x.to])).toEqual([
      ['2026-10-06', '2026-10-06'], ['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18'],
      ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-10-06', '2026-11-04'],
    ])
  })
})
