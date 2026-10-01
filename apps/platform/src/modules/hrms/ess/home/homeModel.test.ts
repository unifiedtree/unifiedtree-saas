import { describe, expect, it } from 'vitest'
import type { DayRecordResponse } from '../../api/useAttendance'
import type { LeaveBalanceResponse, LeaveRequestResponse, LeaveTypeResponse } from '../../api/useLeave'
import type { WfhRequestResponse } from '../../api/useWfh'
import type { MyPayslip } from '../../api/usePayrollRuns'
import type { AroundItem, MyDay, MyRequest } from './homeApi'
import {
  calendarDays, calendarSub, cumulativeSeries, dayLine, dayRangeLong, dueChip, eventSub, greetingWord, hm, latestPayslip, lateDaysNote,
  leaveNote, liveActiveMinutes, longWeekendTip, mainBalance, money, needsLook, presentSeries, relDay, requestPill, requestSub, requestTitle,
  shiftMinutes, things, weeklyOffSet, wfhDaysInMonth,
} from './homeModel'

const day = (date: string, status: string, extra: Partial<DayRecordResponse> = {}): DayRecordResponse => ({ date, status, ...extra })
const SAT_SUN = new Set([6, 0])

describe('greeting and time', () => {
  it('words the greeting by the IST hour', () => {
    expect(greetingWord(9)).toBe('Good morning')
    expect(greetingWord(12)).toBe('Good afternoon')
    expect(greetingWord(17)).toBe('Good evening')
  })
  it('writes hours and minutes', () => {
    expect(hm(286)).toBe('4h 46m')
    expect(hm(5)).toBe('0h 05m')
    expect(hm(null)).toBe('0h 00m')
    expect(things(1)).toBe('1 thing')
    expect(things(5)).toBe('5 things')
  })
  it('runs the day timer on only while checked in, not out and not on a break', () => {
    const read = Date.parse('2026-10-01T05:00:00Z'), now = read + 7 * 60_000
    expect(liveActiveMinutes({ activeMinutes: 100, checkedIn: true, checkedOut: false, onBreak: false }, read, now)).toBe(107)
    expect(liveActiveMinutes({ activeMinutes: 100, checkedIn: true, checkedOut: false, onBreak: true }, read, now)).toBe(100)
    expect(liveActiveMinutes({ activeMinutes: 100, checkedIn: true, checkedOut: true, onBreak: false }, read, now)).toBe(100)
    expect(liveActiveMinutes({ activeMinutes: null, checkedIn: false, checkedOut: false, onBreak: false }, read, now)).toBeNull()
  })
  it('takes the shift’s working hours, else its span (night shifts wrap)', () => {
    const base = { name: 'General', graceMinutes: 15, expectedStart: null, expectedEnd: null }
    expect(shiftMinutes({ ...base, start: '09:30', end: '18:30', workingHours: 9 })).toBe(540)
    expect(shiftMinutes({ ...base, start: '22:00', end: '06:00', workingHours: null })).toBe(480)
    expect(shiftMinutes(null)).toBeNull()
  })
})

describe('the Your day line', () => {
  const base: MyDay = {
    date: '2026-10-01', record: null, status: 'NOT_MARKED', statusNote: null,
    shift: { name: 'General', start: '09:30', end: '18:30', graceMinutes: 15, workingHours: 9, expectedStart: null, expectedEnd: null },
    checkedIn: false, checkedOut: false, workedMinutes: null, activeMinutes: null, onBreak: false, breakStartedAt: null, breakMinutes: 0,
    breaks: [], webPunchAllowed: false, canUndoCheckOut: false, undoCheckOutUntil: null,
  }
  const now = new Date('2026-10-01T08:40:00Z') // 14:10 IST
  it('says when you came in, how, where, and when the shift ends', () => {
    const d = { ...base, checkedIn: true, record: { id: 'r', attendanceDate: '2026-10-01', checkInTime: '2026-10-01T03:54:00Z', checkInMethod: 'FACE_RECOGNITION', locationName: 'Bengaluru HQ', manualEntry: false } }
    expect(dayLine(d, now)).toEqual({ lead: 'In since 09:24 · Face · Bengaluru HQ.', rest: 'General shift ends at 18:30. It’s 2:10 PM.' })
    expect(dayLine({ ...d, onBreak: true, breakStartedAt: '2026-10-01T07:35:00Z' }, now).rest).toBe('On a break since 13:05. Your timer is paused.')
  })
  it('after check-out, and on days without a punch', () => {
    const out = { ...base, checkedIn: true, checkedOut: true, record: { id: 'r', attendanceDate: '2026-10-01', checkOutTime: '2026-10-01T13:10:00Z', manualEntry: false } }
    expect(dayLine(out, now)).toEqual({ lead: 'Checked out at 18:40.', rest: 'See you tomorrow.' })
    expect(dayLine(base, now)).toEqual({ lead: 'You haven’t checked in yet.', rest: 'General shift starts at 09:30.' })
    expect(dayLine({ ...base, status: 'WEEKLY_OFF' }, now).lead).toBe('It’s your weekly off.')
    expect(dayLine({ ...base, status: 'ON_LEAVE' }, now).lead).toBe('You’re on leave today.')
  })
})

describe('stat cards', () => {
  const sept = [day('2026-09-21', 'PRESENT'), day('2026-09-22', 'LATE'), day('2026-09-23', 'ABSENT'), day('2026-09-24', 'PRESENT'), day('2026-09-25', 'LATE'), day('2026-10-02', 'PRESENT')]
  it('builds cumulative sparklines up to today, last 7 points', () => {
    expect(presentSeries(sept, '2026-09-30')).toEqual([1, 2, 2, 3, 4])
    expect(cumulativeSeries(sept, '2026-09-30', (d) => d.status === 'LATE')).toEqual([0, 1, 1, 1, 2])
    expect(cumulativeSeries(Array.from({ length: 10 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, 'PRESENT')), '2026-09-30', () => true)).toEqual([4, 5, 6, 7, 8, 9, 10])
  })
  it('names the late days', () => {
    expect(lateDaysNote(sept, '2026-09-30')).toBe('22 and 25 Sep')
    expect(lateDaysNote([day('2026-08-28', 'LATE'), day('2026-09-03', 'LATE')], '2026-09-30')).toBe('28 Aug and 3 Sep')
    expect(lateDaysNote([day('2026-09-01', 'PRESENT')], '2026-09-30')).toBeNull()
  })
  it('reads weekly offs: own first, then the company’s, then Sat + Sun', () => {
    expect([...weeklyOffSet('5,6', [6, 7])].sort()).toEqual([5, 6])
    expect([...weeklyOffSet(null, [5, 6])].sort()).toEqual([5, 6])
    expect([...weeklyOffSet('', null)].sort()).toEqual([0, 6])
  })
  it('counts approved work-from-home days in the month, weekly offs left out', () => {
    const w = (fromDate: string, toDate: string, status: WfhRequestResponse['status']) => ({ id: fromDate, employeeId: 'e', fromDate, toDate, reason: null, status, approverId: null, decisionNote: null, decidedAt: null, createdAt: '' }) as WfhRequestResponse
    const reqs = [w('2026-09-25', '2026-09-29', 'APPROVED'), w('2026-09-30', '2026-09-30', 'PENDING'), w('2026-08-31', '2026-09-01', 'APPROVED')]
    expect(wfhDaysInMonth(reqs, '2026-09', SAT_SUN)).toEqual(['2026-09-01', '2026-09-25', '2026-09-28', '2026-09-29'])
    expect(wfhDaysInMonth(reqs, '2026-09', SAT_SUN, '2026-09-26')).toEqual(['2026-09-01', '2026-09-25'])
  })
  it('leads Leave left with casual, then earned', () => {
    const b = (id: string, name: string, available: number) => ({ id, employeeId: 'e', leaveTypeId: id, leaveTypeName: name, year: 2026, totalEntitlement: 12, used: 0, pending: 0, carryForward: 0, available }) as LeaveBalanceResponse
    const t = (id: string, category: string) => ({ id, name: id, code: id, category }) as LeaveTypeResponse
    const bal = [b('s', 'Sick Leave', 5), b('e', 'Earned Leave', 11), b('c', 'Casual Leave', 6.5)]
    const main = mainBalance(bal, [t('s', 'SICK'), t('e', 'EARNED'), t('c', 'CASUAL')])!
    expect(main.id).toBe('c')
    expect(leaveNote(main, bal)).toBe('casual · 5 sick days')
    expect(mainBalance(bal, undefined)!.id).toBe('c')
    expect(mainBalance([], [])).toBeNull()
  })
  it('picks the newest locked or paid payslip that isn’t after this month', () => {
    const p = (y: number, m: number, status: MyPayslip['status']) => ({ runId: `${y}-${m}`, period: '', periodMonth: m, periodYear: y, netPay: 1, status }) as MyPayslip
    expect(latestPayslip([p(2026, 8, 'PAID'), p(2026, 9, 'PROCESSING'), p(2027, 1, 'PAID')], '2026-10-01')!.runId).toBe('2026-8')
    expect(latestPayslip([p(2027, 1, 'PAID')], '2026-10-01')).toBeNull()
  })
  it('writes money the Indian way', () => {
    expect(money(4860, 'INR')).toBe('₹4,860')
    expect(money(218640, null)).toBe('₹2,18,640')
    expect(money(null)).toBe('')
  })
})

describe('words for dates, requests and tasks', () => {
  it('writes day ranges as the design', () => {
    expect(dayRangeLong('2026-09-28', '2026-09-29')).toBe('Mon 28 – Tue 29 Sep')
    expect(dayRangeLong('2026-09-23', '2026-09-23')).toBe('Wed 23 Sep')
    expect(dayRangeLong('2026-09-28', '2026-10-02')).toBe('Mon 28 Sep – Fri 2 Oct')
    expect(relDay('2026-10-01', '2026-10-01')).toBe('Today')
    expect(relDay('2026-10-02', '2026-10-01')).toBe('Tomorrow')
    expect(relDay('2026-10-05', '2026-10-01')).toBe('Monday')
    expect(relDay('2026-11-06', '2026-10-01')).toBe('6 Nov')
  })
  const req = (o: Partial<MyRequest>): MyRequest => ({
    kind: 'LEAVE', id: 'r', title: 'Casual Leave', fromDate: '2026-09-28', toDate: '2026-09-29', days: 2, amount: null, currency: null,
    status: 'PENDING', state: 'WAITING', statusLabel: 'Waiting', progress: 50, steps: [], waitingForName: 'Siddharth Rao', decidedByName: null,
    createdAt: '2026-10-01T08:28:00Z', lastActivityAt: '2026-10-01T08:28:00Z', link: '/hrms/leave?tab=my', ...o,
  })
  it('titles and sub-lines a request', () => {
    expect(requestTitle(req({}))).toBe('Casual Leave · Mon 28 – Tue 29 Sep')
    expect(requestTitle(req({ title: 'Client visit travel', fromDate: null, toDate: null, amount: 4860, currency: 'INR' }))).toBe('Client visit travel · ₹4,860')
    expect(requestSub(req({}), '2026-10-01')).toBe('Waiting for Siddharth Rao · sent today, 1:58 PM')
    expect(requestSub(req({ waitingForName: null, statusLabel: 'Waiting for HR' }), '2026-10-01')).toBe('Waiting for HR · sent today, 1:58 PM')
    expect(requestSub(req({ state: 'APPROVED', statusLabel: 'Approved', decidedByName: 'Siddharth Rao', lastActivityAt: '2026-09-21T06:00:00Z' }), '2026-10-01')).toBe('Approved by Siddharth Rao on 21 Sep')
    expect(requestSub(req({ state: 'CANCELLED', statusLabel: 'Cancelled', lastActivityAt: '2026-09-21T06:00:00Z' }), '2026-10-01')).toBe('Cancelled on 21 Sep')
    expect(requestPill(req({}))).toBe('wait')
    expect(requestPill(req({ state: 'DONE' }))).toBe('ok')
    expect(requestPill(req({ state: 'REJECTED' }))).toBe('bad')
  })
  it('writes the due chip', () => {
    expect(dueChip('2026-09-30', '2026-10-01')).toBe('Overdue')
    expect(dueChip('2026-10-01', '2026-10-01')).toBe('Due today')
    expect(dueChip('2026-10-07', '2026-10-01')).toBe('Due Wed')
    expect(dueChip('2026-10-09', '2026-10-01')).toBe('Due 9 Oct')
    expect(dueChip(null, '2026-10-01')).toBeNull()
  })
  it('gives each task its icon and colour', () => {
    expect(needsLook({ kind: 'MISSED_PUNCH_OUT', tone: 'bad' })).toEqual({ icon: 'clock', tone: 'danger' })
    expect(needsLook({ kind: 'PROBATION_DECISION', tone: 'gold' })).toEqual({ icon: 'timer', tone: 'warning' })
    expect(needsLook({ kind: 'SOMETHING_NEW', tone: 'brand' })).toEqual({ icon: 'info', tone: 'brand' })
  })
  it('words an upcoming event’s sub-line', () => {
    const e = (o: Partial<AroundItem>): AroundItem => ({ kind: 'BIRTHDAY', date: '2026-10-02', dateKind: 'ON', title: 't', detail: 'Engineering', tag: null, refId: null, employeeId: null, departmentName: null, years: null, link: null, ...o })
    expect(eventSub(e({}), '2026-10-01')).toBe('Tomorrow · Engineering')
    expect(eventSub(e({ kind: 'NOTICE', dateKind: 'POSTED', date: '2026-10-01', detail: null }), '2026-10-01')).toBe('Posted today')
    expect(eventSub(e({ kind: 'NOTICE', dateKind: 'POSTED', date: '2026-09-22', detail: 'Lunch' }), '2026-10-01')).toBe('Posted 22 Sep · Lunch')
  })
})

describe('the long-weekend tip', () => {
  it('Fri 2 Oct is a holiday: take Thu 1 Oct for a 4-day weekend', () => {
    expect(longWeekendTip([{ date: '2026-10-02', name: 'Gandhi Jayanti' }], SAT_SUN, '2026-09-25')).toEqual({ holiday: '2026-10-02', holidayName: 'Gandhi Jayanti', take: '2026-10-01', days: 4 })
  })
  it('a Monday holiday suggests Tuesday', () => {
    expect(longWeekendTip([{ date: '2026-10-05', name: 'X' }], SAT_SUN, '2026-09-25')?.take).toBe('2026-10-06')
  })
  it('nothing for a mid-week holiday, a weekend holiday, a day already off, or one too far away', () => {
    expect(longWeekendTip([{ date: '2026-09-30', name: 'Wed' }], SAT_SUN, '2026-09-25')).toBeNull()
    expect(longWeekendTip([{ date: '2026-10-03', name: 'Sat' }], SAT_SUN, '2026-09-25')).toBeNull()
    expect(longWeekendTip([{ date: '2026-10-02', name: 'Fri' }], SAT_SUN, '2026-09-25', new Set(['2026-10-01']))).toBeNull()
    expect(longWeekendTip([{ date: '2026-12-25', name: 'Christmas' }], SAT_SUN, '2026-09-25')).toBeNull()
  })
  it('follows the person’s own weekly offs (a Fri–Sat weekend)', () => {
    // Thu 1 Oct holiday, Fri + Sat off → take Wed 30 Sep (Wed, Thu, Fri, Sat).
    expect(longWeekendTip([{ date: '2026-10-01', name: 'X' }], new Set([5, 6]), '2026-09-25')?.take).toBe('2026-09-30')
  })
})

describe('the month calendar', () => {
  it('marks each day from real data', () => {
    const leave = { id: 'l', employeeId: 'e', leaveTypeId: 't', startDate: '2026-09-28', endDate: '2026-09-29', totalDays: 2, status: 'APPROVED', createdAt: '' } as LeaveRequestResponse
    const days = calendarDays({
      month: '2026-09', today: '2026-09-25',
      history: [day('2026-09-21', 'PRESENT', { checkInTime: '09:24', checkOutTime: '18:40' }), day('2026-09-22', 'LATE'), day('2026-09-23', 'PRESENT'), day('2026-09-18', 'PRESENT')],
      wfhDays: ['2026-09-23'], leaves: [leave], toFix: new Set(['2026-09-18']), holidays: [{ date: '2026-09-14', name: 'Holiday' }], off: SAT_SUN,
    })
    const tone = (d: string) => days.find((x) => x.date === d)?.tone
    expect(days).toHaveLength(30)
    expect(tone('2026-09-21')).toBe('present')
    expect(days.find((x) => x.date === '2026-09-21')?.tip).toBe('09:24 – 18:40')
    expect(tone('2026-09-22')).toBe('late')
    expect(tone('2026-09-23')).toBe('home')
    expect(tone('2026-09-18')).toBe('fix')
    expect(tone('2026-09-14')).toBe('holiday')
    expect(tone('2026-09-28')).toBe('leave')
    expect(tone('2026-09-26')).toBe('off')
    expect(tone('2026-09-30')).toBeUndefined()
  })
  it('sums up the month', () => {
    expect(calendarSub(17, 18, 1)).toBe('17 of 18 working days · 1 day to fix')
    expect(calendarSub(3, 3, 0)).toBe('3 of 3 working days')
    expect(calendarSub(null, null, 0)).toBe('')
  })
})
