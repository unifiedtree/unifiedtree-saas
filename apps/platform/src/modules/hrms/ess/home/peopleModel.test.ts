// The same cases run against the mobile app's copy (components/home/__tests__/peopleModel.test.ts).
import { describe, expect, it } from 'vitest'
import {
  celebrationSub, chipOf, dateTileOf, daysWords, fromAroundMe, fromCelebrations, homeRow, initialsOfName, isPast,
  nameFromTitle, nextHolidays, offFromColleagues, offFromTeam, sectionsOf, weekOf, whenWords, type Celebration,
} from './peopleModel'

const TODAY = '2026-10-05' // a Monday

const c = (kind: string, date: string, name: string, years: number | null = null): Celebration =>
  ({ kind, date, employeeId: name, name, departmentName: null, years })

describe('dates', () => {
  it('words a day the way both apps do', () => {
    expect(whenWords('2026-10-05', TODAY)).toBe('Today')
    expect(whenWords('2026-10-06', TODAY)).toBe('Tomorrow')
    expect(whenWords('2026-10-04', TODAY)).toBe('Yesterday')
    expect(whenWords('2026-10-09', TODAY)).toBe('Friday')
    expect(whenWords('2026-10-02', TODAY)).toBe('3 days ago')
    expect(whenWords('2026-11-14', TODAY)).toBe('14 Nov')
    expect(dateTileOf('2026-01-02')).toEqual({ day: '02', month: 'JAN', label: 'Friday 2 Jan' })
  })
  it('finds Monday to Sunday, across a month end', () => {
    expect(weekOf(TODAY)).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(weekOf('2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
  })
})

describe('celebrations', () => {
  it('chips: Birthday, 1 yr, 5 yrs, New', () => {
    expect(chipOf({ kind: 'BIRTHDAY', years: null })).toBe('Birthday')
    expect(chipOf({ kind: 'WORK_ANNIVERSARY', years: 1 })).toBe('1 yr')
    expect(chipOf({ kind: 'WORK_ANNIVERSARY', years: 5 })).toBe('5 yrs')
    expect(chipOf({ kind: 'NEW_JOINER', years: null })).toBe('New')
  })

  it('reads the server and the around-me fallback', () => {
    const d = fromCelebrations({ today: TODAY, included: ['BIRTHDAY', 'NEW_JOINER'], items: [
      { kind: 'NEW_JOINER', date: '2026-10-01', employeeId: 'e1', name: ' Ravi ', departmentName: 'Ops', years: null },
      { kind: 'BIRTHDAY', date: null, name: 'x' },
    ] })
    expect(d.items).toEqual([{ kind: 'NEW_JOINER', date: '2026-10-01', employeeId: 'e1', name: 'Ravi', departmentName: 'Ops', years: null }])
    expect(d.joinersKnown).toBe(true)
    expect(fromCelebrations({ included: ['BIRTHDAY'] }).joinersKnown).toBe(false)

    const f = fromAroundMe([
      { kind: 'BIRTHDAY', date: TODAY, title: 'Kavya Menon’s birthday', employeeId: 'k', departmentName: null, years: null },
      { kind: 'WORK_ANNIVERSARY', date: TODAY, title: "Asha's work anniversary", employeeId: 'a', departmentName: 'Eng', years: 3 },
      { kind: 'HOLIDAY', date: TODAY, title: 'Diwali', employeeId: null, departmentName: null, years: null },
    ])
    expect(f.items.map((i) => [i.name, chipOf(i)])).toEqual([['Kavya Menon', 'Birthday'], ['Asha', '3 yrs']])
    expect(f.joinersKnown).toBe(false)
    expect(nameFromTitle('Payday')).toBe('Payday')
  })

  it('puts today first on the Home row, then the next week, then the newest joiners', () => {
    const row = homeRow([
      c('BIRTHDAY', '2026-10-08', 'Zoya'),
      c('WORK_ANNIVERSARY', TODAY, 'Bala', 2),
      c('BIRTHDAY', TODAY, 'Asha'),
      c('BIRTHDAY', '2026-10-03', 'Gone'),
      c('BIRTHDAY', '2026-10-20', 'Later'),
      c('NEW_JOINER', '2026-10-02', 'Old'),
      c('NEW_JOINER', '2026-10-04', 'Newer'),
      c('NEW_JOINER', '2026-09-10', 'Month ago'),
    ], TODAY)
    expect(row.map((r) => r.name)).toEqual(['Asha', 'Bala', 'Zoya', 'Newer', 'Old'])
  })

  it('builds the page sections: upcoming first, gone-by last and faded, joiners newest first', () => {
    const items = [
      c('BIRTHDAY', '2026-10-03', 'Gone'), c('BIRTHDAY', '2026-10-09', 'Soon'), c('BIRTHDAY', TODAY, 'Today'),
      c('NEW_JOINER', '2026-09-20', 'A'), c('NEW_JOINER', '2026-10-01', 'B'),
    ]
    const s = sectionsOf({ today: TODAY, items, joinersKnown: true }, TODAY)
    expect(s.map((x) => x.key)).toEqual(['BIRTHDAY', 'WORK_ANNIVERSARY', 'NEW_JOINER'])
    expect(s[0].items.map((i) => i.name)).toEqual(['Today', 'Soon', 'Gone'])
    expect(s[0].items.map((i) => isPast(i, TODAY))).toEqual([false, false, true])
    expect(s[2].items.map((i) => i.name)).toEqual(['B', 'A'])
    expect(isPast(c('NEW_JOINER', '2026-09-20', 'A'), TODAY)).toBe(false)
    expect(sectionsOf({ today: null, items, joinersKnown: false }, TODAY).map((x) => x.key)).toEqual(['BIRTHDAY', 'WORK_ANNIVERSARY'])
  })

  it('words a person’s line', () => {
    expect(celebrationSub({ ...c('BIRTHDAY', TODAY, 'A'), departmentName: 'Ops' }, TODAY)).toBe('Today · Ops')
    expect(celebrationSub(c('NEW_JOINER', TODAY, 'A'), TODAY)).toBe('Joined today')
    expect(celebrationSub(c('NEW_JOINER', '2026-10-04', 'A'), TODAY)).toBe('Joined yesterday')
    expect(celebrationSub(c('NEW_JOINER', '2026-10-01', 'A'), TODAY)).toBe('Joined 4 days ago')
    expect(celebrationSub(c('NEW_JOINER', '2026-09-12', 'A'), TODAY)).toBe('Joined on 12 Sep')
    expect(initialsOfName('Kavya  Menon Rao')).toBe('KR')
    expect(initialsOfName('ravi')).toBe('R')
  })
})

describe('off this week', () => {
  const week = weekOf(TODAY)
  it('team: approved leave only, clipped to the week, today first', () => {
    const off = offFromTeam([
      { kind: 'LEAVE', status: 'APPROVED', employeeId: '1', employeeName: 'Kavya', fromDate: '2026-10-07', toDate: '2026-10-09', leaveTypeName: 'Casual' },
      { kind: 'LEAVE', status: 'APPROVED', employeeId: '2', employeeName: 'Bala', fromDate: '2026-10-01', toDate: '2026-10-05', leaveTypeName: 'Sick' },
      { kind: 'LEAVE', status: 'PENDING', employeeId: '3', employeeName: 'Waiting', fromDate: TODAY, toDate: TODAY, leaveTypeName: null },
      { kind: 'WFH', status: 'APPROVED', employeeId: '4', employeeName: 'Home', fromDate: TODAY, toDate: TODAY, leaveTypeName: null },
    ], week, TODAY)
    expect(off.map((o) => [o.name, o.when, o.offToday])).toEqual([['Bala', 'Today', true], ['Kavya', 'Wed – Fri', false]])
  })
  it('colleagues: grouped by name across the days', () => {
    const off = offFromColleagues([
      { date: '2026-10-06', names: ['Ravi', 'Asha'] }, { date: '2026-10-08', names: ['Ravi'] },
    ], TODAY)
    expect(off.map((o) => [o.name, o.when])).toEqual([['Asha', 'Tue'], ['Ravi', 'Tue, Thu']])
    expect(daysWords([], TODAY)).toBe('')
  })
})

describe('upcoming holidays', () => {
  it('the next three from today on, one per day and name', () => {
    const next = nextHolidays([
      { date: '2026-12-25', name: 'Christmas' }, { date: '2026-10-02', name: 'Gandhi Jayanti' },
      { date: '2026-10-20', name: 'Dussehra' }, { date: TODAY, name: 'Today one' }, { date: '2026-11-08', name: 'Diwali' },
      { date: '2026-10-20', name: 'Dussehra' },
    ], TODAY)
    expect(next.map((h) => h.name)).toEqual(['Today one', 'Dussehra', 'Diwali'])
  })
})
