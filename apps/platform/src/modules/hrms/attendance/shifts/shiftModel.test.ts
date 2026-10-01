import { describe, expect, it } from 'vitest'
import {
  capLabel, changeRange, counted, dayBar, hm, isoDay, minimumLabel, overnight, overtimeTotals, span, statusOf, timeRange, toMinutes, weeklyOffLabel, workDaysLabel,
} from './shiftModel'
import type { OvertimeEntry, OvertimeRequest } from '../../api/useOvertime'

describe('shift timings', () => {
  it('reads times and spans, past midnight too', () => {
    expect(timeRange('09:30:00', '18:30:00')).toBe('09:30 – 18:30')
    expect(timeRange(null, '18:30')).toBe('—')
    expect(overnight('21:00', '06:00')).toBe(true)
    expect(overnight('09:00', '17:00')).toBe(false)
    expect(span('21:00', '06:00')).toBe(540)
    expect(span('09:00', '09:00')).toBe(1440)
    expect(dayBar('12:00', '18:00')).toEqual({ left: 50, width: 25 })
    expect(dayBar('21:00', '06:00')).toEqual({ left: 87.5, width: 12.5 })
  })

  it('names weekly offs and the working days they leave', () => {
    expect(weeklyOffLabel([7, 6])).toBe('Sat, Sun')
    expect(weeklyOffLabel([])).toBeNull()
    expect(weeklyOffLabel(null)).toBeNull()
    expect(workDaysLabel([6, 7])).toBe('Mon–Fri')
    expect(workDaysLabel([7])).toBe('Mon–Sat')
    expect(workDaysLabel(null)).toBe('Mon–Fri')
    expect(workDaysLabel([3])).toBe('Mon, Tue, Thu–Sun')
  })
})

describe('shift change requests', () => {
  it('says the days a change covers', () => {
    expect(changeRange('2026-10-05', null)).toBe('from 5 Oct')
    expect(changeRange('2026-08-03', '2026-08-07')).toBe('3 – 7 Aug')
    expect(changeRange('2026-09-30', '2026-10-02')).toBe('30 Sep – 2 Oct')
    expect(changeRange('2026-10-05', '2026-10-05')).toBe('on 5 Oct')
    expect(changeRange(null, null)).toBe('from the day it’s approved')
  })
  it('words a status', () => {
    expect(statusOf('PENDING')).toEqual({ tone: 'warning', label: 'Waiting' })
    expect(statusOf('CANCELLED').label).toBe('Withdrawn')
    expect(statusOf('ODD').label).toBe('Odd')
  })
})

describe('overtime', () => {
  const entry = (o: Partial<OvertimeEntry>): OvertimeEntry => ({ id: 'e', employeeId: 'a', employeeName: 'A', date: '2026-10-01', minutes: 80, status: 'PENDING', ...o })
  const req = (o: Partial<OvertimeRequest>): OvertimeRequest => ({ id: 'r', employeeId: 'b', employeeName: 'B', employeeCode: null, date: '2026-10-02', minutes: 90, reason: 'x', status: 'APPROVED', decidedByName: null, decisionNote: null, decidedAt: null, createdAt: '2026-10-02T04:00:00Z', ...o })

  it('counts what the server counted, all of it from the minimum', () => {
    expect(counted(entry({ minutes: 80, countedMinutes: 80 }))).toBe(80)
    expect(counted(entry({ minutes: 80 }))).toBe(80)
    expect(hm(80)).toBe('1h 20m')
    expect(hm(120)).toBe('2h')
    expect(hm(45)).toBe('45m')
  })

  it('adds up the month over punches and requests', () => {
    const t = overtimeTotals(
      [entry({}), entry({ id: 'e2', status: 'APPROVED', minutes: 60 }), entry({ id: 'e3', status: 'REJECTED', minutes: 300 }), entry({ id: 'old', date: '2026-09-30', minutes: 99 })],
      [req({}), req({ id: 'r2', status: 'CANCELLED', minutes: 500 })],
      '2026-10-01',
    )
    expect(t).toEqual({ logged: 80 + 60 + 90, approved: 60 + 90, waiting: 80, people: 2 })
    expect(isoDay(Date.UTC(2026, 9, 1, 6))).toBe('2026-10-01')
  })

  it('reads hours and minutes typed in two boxes', () => {
    expect(toMinutes('1', '20')).toBe(80)
    expect(toMinutes('', '45')).toBe(45)
    expect(toMinutes('', '')).toBeNull()
    expect(toMinutes('1.5', '')).toBeNull()
  })

  it('words the rules card', () => {
    expect(minimumLabel(60, true)).toBe('1h (default)')
    expect(minimumLabel(90, false)).toBe('1h 30m')
    expect(minimumLabel(0, false)).toBe('From the first minute')
    expect(capLabel(null)).toBe('No cap')
    expect(capLabel(2400)).toBe('40h a month per person')
    expect(capLabel(0)).toBe('None can be approved')
  })
})
