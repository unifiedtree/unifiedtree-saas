import { describe, expect, it } from 'vitest'
import type { StaffStatusResponse } from '../../api/useAttendance'
import { byBranch, hhmmIst, hm, inStatus, leaveLine, mainShift, methodLabel, rowStatus, statusOnDay, tileKeyOf, versus, workedMinutes } from './dailyModel'

const row = (o: Partial<StaffStatusResponse>): StaffStatusResponse => ({ employeeId: 'e', employeeCode: 'EMP1', fullName: 'A B', status: 'ABSENT', ...o })

describe('daily tracking view logic', () => {
  it('reads a row\'s status: the effective status first, else the punch', () => {
    expect(rowStatus(row({ effectiveStatus: 'LATE' }))).toBe('LATE')
    expect(rowStatus(row({ effectiveStatus: 'PRESENT', attendanceType: 'WFH' }))).toBe('WFH')
    expect(rowStatus(row({}))).toBe('NOT_MARKED')
    expect(rowStatus(row({ onLeave: true }))).toBe('ON_LEAVE')
    expect(rowStatus(row({ checkInAt: '2026-10-01T03:40:00Z', status: 'LATE' }))).toBe('LATE')
    expect(rowStatus(row({ checkInAt: '2026-10-01T03:40:00Z', status: 'PRESENT', attendanceType: 'WFH' }))).toBe('WFH')
    expect(rowStatus(row({ checkInAt: '2026-10-01T03:40:00Z', status: 'PRESENT' }))).toBe('PRESENT')
  })

  it('a past day has no "not marked yet": no punch and no leave is absent', () => {
    expect(statusOnDay('NOT_MARKED', true)).toBe('NOT_MARKED')
    expect(statusOnDay('NOT_MARKED', false)).toBe('ABSENT')
    expect(statusOnDay('LATE', false)).toBe('LATE')
  })

  it('"Present" counts everyone who came in (the bucket rule Daily Logs always used)', () => {
    for (const s of ['PRESENT', 'LATE', 'WFH', 'HALF_DAY']) expect(inStatus(s, 'PRESENT')).toBe(true)
    for (const s of ['ON_LEAVE', 'ABSENT', 'NOT_MARKED']) expect(inStatus(s, 'PRESENT')).toBe(false)
    expect(inStatus('LATE', 'LATE')).toBe(true)
    expect(inStatus('PRESENT', 'EARLY_OUT', true)).toBe(true)
    expect(tileKeyOf('WORK_FROM_HOME')).toBe('WFH')
  })

  it('writes times and durations as the design does', () => {
    expect(hhmmIst('2026-10-01T03:54:00Z')).toBe('09:24')
    expect(hhmmIst(null)).toBe('—')
    expect(hm(286)).toBe('4h 46m')
    expect(hm(5)).toBe('0h 05m')
    expect(workedMinutes('2026-10-01T03:54:00Z', '2026-10-01T08:40:00Z')).toBe(286)
    expect(workedMinutes('2026-10-01T03:54:00Z', null)).toBeNull()
    expect(workedMinutes('2026-10-01T03:54:00Z', null, Date.parse('2026-10-01T04:54:00Z'))).toBe(60)
  })

  it('names how a punch arrived and the leave', () => {
    expect(methodLabel('FACE_RECOGNITION')).toBe('Face')
    expect(methodLabel('WEB')).toBe('Web')
    expect(methodLabel('MOBILE_GPS')).toBe('Mobile')
    expect(methodLabel('SOMETHING_NEW')).toBe('Something new')
    expect(leaveLine({ leaveTypeName: 'Casual leave', leaveFrom: '2026-09-25', leaveTo: '2026-09-26' })).toBe('Casual leave · 25–26 Sep')
    expect(leaveLine({ leaveTypeName: 'Sick leave', leaveFrom: '2026-09-30', leaveTo: '2026-10-01' })).toBe('Sick leave · 30 Sep – 1 Oct')
    expect(leaveLine({ leaveTypeName: null, leaveFrom: null, leaveTo: null })).toBe('On leave')
  })

  it('checked in by branch, biggest first; on leave and people without a branch left out', () => {
    expect(byBranch([
      { branch: 'Pune', came: true, counted: true }, { branch: 'HQ', came: true, counted: true }, { branch: 'HQ', came: false, counted: true },
      { branch: 'HQ', came: false, counted: false }, { branch: null, came: true, counted: true },
    ])).toEqual([{ name: 'HQ', came: 1, total: 2, pct: 50 }, { name: 'Pune', came: 1, total: 1, pct: 100 }])
  })

  it('the main shift and the change against yesterday', () => {
    expect(mainShift([{ shiftName: 'General', start: '09:30', end: '18:30', grace: 15 }, { shiftName: 'General', start: '09:30', end: '18:30', grace: 15 }, { shiftName: 'Night', start: '21:00', end: '06:00' }]))
      .toBe('General shift 09:30–18:30 with 15 min grace')
    expect(mainShift([{ shiftName: null }])).toBeNull()
    expect(versus(8, 10)).toEqual({ delta: '2', mood: 'good', trend: 'down' })
    expect(versus(12, 10)).toEqual({ delta: '2', mood: 'bad', trend: 'up' })
    expect(versus(10, 10)?.delta).toBe('0')
    expect(versus(10, null)).toBeNull()
  })
})
