import { describe, expect, it } from 'vitest'
import type { StaffStatusResponse } from '../api/useAttendance'
import { dayBuckets, type DayBuckets } from '../attendance/attendanceBuckets'
import {
  attendanceExceptions, attRows, dayRange, lateNote, monthSpan, niceScale, payrollHint, payrollMonths, pctOf, presentNote, quickActions, rollNote, rollTotal,
  scheduledOf, sectionPills, trendColumns, workingWindow,
} from './dashboardModel'

const day = (p: Partial<DayBuckets> = {}): DayBuckets => ({ total: 10, present: 8, regular: 6, late: 2, halfDay: 0, wfh: 0, onLeave: 1, notMarked: 1, absent: 0, earlyOut: 0, other: 0, ...p })
const person = (p: Partial<StaffStatusResponse>): StaffStatusResponse => ({ employeeId: p.fullName || 'x', employeeCode: 'E', fullName: 'X', status: 'PRESENT', ...p } as StaffStatusResponse)

describe('section pills', () => {
  it('follow the design order and hide sections the viewer can’t see', () => {
    const pills = sectionPills({ overview: true, attendance: false, upcoming: true, people: true, hiring: false, payroll: true })
    expect(pills.map((p) => p.key)).toEqual(['overview', 'upcoming', 'people', 'payroll'])
    expect(pills[3].label).toBe('Payroll & activity')
  })
})

describe('numbers', () => {
  it('percent of a whole, 0 without one', () => {
    expect(pctOf(3, 12)).toBe(25)
    expect(pctOf(3, 0)).toBe(0)
  })
  it('scheduled leaves out holidays, weekly offs and people not tracked', () => {
    expect(scheduledOf({ total: 40, other: 3 })).toBe(37)
  })
  it('a tidy chart top', () => {
    expect(niceScale(37)).toEqual({ max: 40, ticks: [40, 30, 20, 10, 0] })
    expect(niceScale(0).max).toBe(4)
  })
  it('date ranges read short', () => {
    expect(dayRange('2026-09-28', '2026-09-29')).toBe('28–29 Sep')
    expect(dayRange('2026-09-30', '2026-10-02')).toBe('30 Sep – 2 Oct')
    expect(dayRange('2026-10-05', '2026-10-05')).toBe('5 Oct')
  })
})

describe('sparklines and the weekly chart', () => {
  const daily: Record<string, DayBuckets> = {
    '2026-09-19': day({ weeklyOff: true, present: 0 }), '2026-09-20': day({ weeklyOff: true, present: 0 }),
    '2026-09-21': day({ weeklyOff: false }), '2026-09-22': day({ weeklyOff: false, present: 5, late: 1, absent: 2 }), '2026-09-23': day({ weeklyOff: false }),
    '2026-09-24': day({ weeklyOff: false }), '2026-09-25': day({ weeklyOff: false }),
  }
  it('the sparkline window skips weekly offs', () => {
    expect(workingWindow(daily, '2026-09-25')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'])
  })
  it('seven columns ending on the day; offs and holidays are "Off"; regular = came in less late', () => {
    const cols = trendColumns(daily, '2026-09-25', new Set(['2026-09-23']))
    expect(cols.map((c) => c.iso)).toEqual(['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'])
    expect(cols.map((c) => c.off)).toEqual([true, true, false, false, false, false, false]) // a holiday with punches stays a day
    const tue = cols[3]
    expect([tue.regular, tue.late, tue.absent]).toEqual([4, 1, 2])
    expect(tue.label).toBe('Tue 22')
    const quiet = trendColumns({ ...daily, '2026-09-23': day({ weeklyOff: false, present: 0 }) }, '2026-09-25', new Set(['2026-09-23']))
    expect(quiet[4].off).toBe(true)
  })
})

describe('today’s attendance and follow-ups', () => {
  const staff = [
    person({ fullName: 'Asha', checkInAt: '2026-09-25T03:40:00Z', effectiveStatus: 'PRESENT' }),
    person({ fullName: 'Bala', checkInAt: '2026-09-25T04:30:00Z', effectiveStatus: 'LATE', expectedCheckInAt: '2026-09-25T03:30:00Z', graceMinutes: 15 }),
    person({ fullName: 'Chitra', effectiveStatus: 'NOT_MARKED', shiftName: 'General' }),
    person({ fullName: 'Dev', effectiveStatus: 'ON_LEAVE', onLeave: true }),
    person({ fullName: 'Esha', checkInAt: '2026-09-25T03:50:00Z', effectiveStatus: 'PRESENT', attendanceType: 'WFH', outsideGeofence: true }),
  ]
  it('rows: latest check-ins first, filters by late / not marked', () => {
    expect(attRows(staff, 'all', false).map((r) => r.name)).toEqual(['Bala', 'Esha', 'Asha', 'Chitra', 'Dev'])
    expect(attRows(staff, 'late', false).map((r) => [r.name, r.status])).toEqual([['Bala', 'Late']])
    expect(attRows(staff, 'none', false).map((r) => r.status)).toEqual(['Not marked'])
    expect(attRows(staff, 'none', true).map((r) => r.status)).toEqual(['Absent'])
    expect(attRows(staff, 'all', false)[0].time).toBe('10:00')
  })
  it('late note names the grace when everyone shares one', () => {
    expect(lateNote(staff, 1)).toBe('After the 09:15 grace')
    expect(lateNote(staff, 0)).toBe('No one late')
    expect(lateNote([...staff, person({ expectedCheckInAt: '2026-09-25T04:30:00Z' })], 2)).toBe('After each shift’s grace')
  })
  it('follow-ups: outside the work area and no punch (not people on leave)', () => {
    expect(attendanceExceptions(staff, false).map((e) => [e.name, e.kind])).toEqual([['Chitra', 'No punch today'], ['Esha', 'Outside work area']])
  })
})

describe('payroll', () => {
  const runs = [
    { id: 'a', periodYear: 2026, periodMonth: 7, status: 'PAID', totalGross: 100 },
    { id: 'b', periodYear: 2026, periodMonth: 8, status: 'LOCKED', totalGross: 120 },
    { id: 'c', periodYear: 2026, periodMonth: 9, status: 'DRAFT', totalGross: 130 },
    { id: 'd', periodYear: 2026, periodMonth: 9, status: 'CANCELLED', totalGross: 999 },
    { id: 'e', periodYear: 2025, periodMonth: 12, status: 'PAID', totalGross: 90 },
  ]
  it('one bar per month; finalized wins, else in review; cancelled runs are left out', () => {
    const ms = payrollMonths(runs, 6)
    expect(ms.map((m) => [m.month, m.gross, m.finalized])).toEqual([['2025-12', 90, true], ['2026-07', 100, true], ['2026-08', 120, true], ['2026-09', 130, false]])
    expect(ms[3].path).toBe('/hrms/payroll/runs/c')
    expect(monthSpan(ms)).toBe('Dec 2025 – Sep 2026')
  })
  it('a past date ends at its month, and the window counts back from it', () => {
    expect(payrollMonths(runs, 2, '2026-08').map((m) => m.month)).toEqual(['2026-07', '2026-08'])
    expect(monthSpan(payrollMonths(runs, 2, '2026-08'))).toBe('Jul – Aug 2026')
  })
  it('the Run payroll hint says where this month’s run is', () => {
    expect(payrollHint(runs, '2026-09-10')).toBe('September is in review')
    expect(payrollHint(runs, '2026-08-10')).toBe('August is locked')
    expect(payrollHint(runs, '2026-10-01')).toBe('No run for October yet')
  })
})

describe('quick actions', () => {
  it('keep today’s order and show only allowed ones, at most six', () => {
    const qa = quickActions([
      { key: 'att', label: 'Attendance', path: '/a', allowed: true },
      { key: 'off', label: 'Add time-off', path: '/b', allowed: false },
      { key: 'rep', label: 'View reports', path: '/c', allowed: true },
    ])
    expect(qa.map((q) => q.key)).toEqual(['att', 'rep'])
  })
})

describe('Total employees', () => {
  it('is everyone on the roll, never the day’s attendance roster', () => {
    // 11 on the roll: the summary's headcount wins, then the headcount report's, then the directory's count.
    expect(rollTotal({ headcount: 11, activeEmployees: 1, probation: 10, onNotice: 0 }, [{ total: 4 }], 7)).toBe(11)
    expect(rollTotal({ activeEmployees: 1 }, [{ total: 4 }, { total: '7' }], 3)).toBe(11)
    expect(rollTotal(undefined, undefined, 11)).toBe(11)
    expect(rollTotal(undefined, undefined, undefined)).toBeNull()
    // A real zero is a zero, not "unknown".
    expect(rollTotal({ headcount: 0 }, undefined, undefined)).toBe(0)
  })
  it('the note adds up to the figure: confirmed, on probation and serving notice', () => {
    // People on probation are active employees too: the others are "confirmed", never "active" (testers, 5 Oct).
    expect(rollNote({ headcount: 11, activeEmployees: 1, probation: 10, onNotice: 0 }, false, '1–4 Oct')).toBe('1 confirmed · 10 on probation')
    expect(rollNote({ headcount: 12, activeEmployees: 1, probation: 10, onNotice: 1 }, false, '')).toBe('1 confirmed · 10 on probation · 1 on notice')
    expect(rollNote({ headcount: 13, activeEmployees: 1, probation: 12, onNotice: 0 }, false, '')).not.toMatch(/active/)
    expect(rollNote({ headcount: 0, activeEmployees: 0, probation: 0, onNotice: 0 }, false, '')).toBe('No one on the roll yet')
    // An older server sends the confirmed count alone: no split that reads as if the rest had left.
    expect(rollNote({ activeEmployees: 1 }, false, '')).toBe('Everyone on the roll')
    // A past day: that month's joiners and leavers.
    expect(rollNote({ headcount: 11, activeEmployees: 1, probation: 10, joinedInMonth: 2, leftInMonth: 1 }, true, '1–4 Oct')).toBe('2 joined · 1 left, 1–4 Oct')
  })
})

describe('Present: scheduled against Total employees', () => {
  const wide = (total: number | null, isPast = false) => ({ total, companyWide: true, isPast })
  it('a company-wide viewer: everyone scheduled is the whole roll, so nothing more is said', () => {
    expect(presentNote(2, 13, wide(13))).toBe('15% of 13 scheduled')
    expect(presentNote(2, 13, wide(null))).toBe('15% of 13 scheduled')
  })
  it('says how many on the roll are off that day instead of silently differing (scheduled + off = Total employees)', () => {
    expect(presentNote(2, 12, wide(13))).toBe('12 scheduled · 1 off')
    expect(presentNote(3, 10, wide(13, true))).toBe('10 scheduled · 3 off')
    // More scheduled than the headcount (someone without a joining date): no negative count.
    expect(presentNote(2, 14, wide(13))).toBe('14% of 14 scheduled')
  })
  it('nobody scheduled', () => {
    expect(presentNote(0, 0, wide(13))).toBe('Nobody scheduled today')
    expect(presentNote(0, 0, wide(13, true))).toBe('Nobody was scheduled')
  })
  it('a viewer whose attendance cards cover their team says so, beside the company’s Total employees', () => {
    expect(presentNote(1, 4, { total: 13, companyWide: false, isPast: false })).toBe('25% of 4 in your team')
    expect(presentNote(0, 0, { total: 13, companyWide: false, isPast: false })).toBe('No team members today')
    expect(presentNote(0, 0, { total: 13, companyWide: false, isPast: true })).toBe('No team members that day')
  })
  it('every wording fits the card’s one line', () => {
    for (const n of [presentNote(2, 312, wide(1500)), presentNote(9, 99, wide(99)), presentNote(1, 40, { total: 900, companyWide: false, isPast: false }), presentNote(0, 0, { total: 9, companyWide: false, isPast: true })]) {
      expect(n.length).toBeLessThanOrEqual(24)
    }
  })
})

describe('a weekly off on the team’s day', () => {
  it('lists the people off without counting them as scheduled, missing or absent', () => {
    const staff = [
      person({ fullName: 'Aisha Khan', status: 'WEEKLY_OFF', effectiveStatus: 'WEEKLY_OFF' }),
      person({ fullName: 'E2E Emp', status: 'WEEKLY_OFF', effectiveStatus: 'WEEKLY_OFF' }),
    ]
    const c = dayBuckets({ date: '2026-10-04', staffStatuses: staff } as never, '2026-10-04')
    expect(c.total).toBe(2)
    expect(scheduledOf(c)).toBe(0)
    expect(c.notMarked + c.absent + c.present + c.onLeave).toBe(0)
    expect(attRows(staff, 'all', false).map((r) => r.status)).toEqual(['Weekly off', 'Weekly off'])
    expect(attRows(staff, 'none', false)).toEqual([])
  })
})
