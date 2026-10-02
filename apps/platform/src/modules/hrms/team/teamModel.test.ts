import { describe, expect, it } from 'vitest'
import { dayBuckets } from '../attendance/attendanceBuckets'
import type { InboxRow, TeamSummary, TeamTimeOffEntry } from '../api/shared/contracts'
import type { CycleProgress } from '../api/usePerformanceAdmin'
import {
  approvalsSub, daysText, decisionsInTab, easyRows, extendedEnd, inboxTabsFor, inboxWhat, money, offTodayMembers, outSoon,
  pickTab, pickView, probationWhen, rangeShort, relTime, reviewsModel, roleLine, rosterBucket, rosterWhen, scheduleCell,
  schedulePeople, tabOfKind, teamSub, teamTiles, type RosterRow,
} from './teamModel'

const person = (over: Partial<RosterRow>): RosterRow => ({
  employeeId: Math.random().toString(36).slice(2), employeeCode: 'E1', fullName: 'Priya Sharma', status: 'NOT_MARKED', ...over,
})

describe('Team today', () => {
  const today = '2026-09-25'
  const roster: RosterRow[] = [
    person({ effectiveStatus: 'PRESENT', checkInAt: '2026-09-25T03:54:00Z', checkInMethod: 'FACE_RECOGNITION', locationName: 'BLR-HQ', graceMinutes: 15 }),
    person({ effectiveStatus: 'PRESENT', checkInAt: '2026-09-25T03:40:00Z', checkInMethod: 'MOBILE_GPS', graceMinutes: 15 }),
    person({ effectiveStatus: 'LATE', checkInAt: '2026-09-25T04:28:00Z', checkInMethod: 'FACE_RECOGNITION', graceMinutes: 15 }),
    person({ effectiveStatus: 'PRESENT', attendanceType: 'WFH', checkInAt: '2026-09-25T04:10:00Z', checkInMethod: 'WEB' }),
    person({ effectiveStatus: 'ON_LEAVE', onLeave: true, leaveTypeName: 'Sick leave', leaveFrom: today, leaveTo: today }),
    person({ effectiveStatus: 'NOT_MARKED' }),
    person({ effectiveStatus: 'HALF_DAY', checkInAt: '2026-09-25T07:00:00Z' }),
    person({ effectiveStatus: 'WEEKLY_OFF' }),
  ]

  it('puts each person in one bucket, the same way the dashboard counts them', () => {
    const tiles = Object.fromEntries(teamTiles(roster).map((t) => [t.key, t.count]))
    const b = dayBuckets({ date: today, counts: {} as never, staffStatuses: roster }, today)
    expect(tiles).toEqual({ in: b.regular, late: b.late, wfh: b.wfh, leave: b.onLeave, half: b.halfDay, none: b.notMarked })
    // without an effective status (older servers) the punch decides
    expect(rosterBucket(person({ checkInAt: 'x', status: 'LATE' }))).toBe('late')
    expect(rosterBucket(person({ onLeave: true }))).toBe('leave')
    expect(rosterBucket(person({}))).toBe('none')
  })

  it('writes the tile notes from the data: punch methods, the grace period; Half day only when someone has one', () => {
    const tiles = teamTiles(roster)
    expect(tiles.map((t) => t.label)).toEqual(['In the office', 'Late', 'At home', 'On leave', 'Half day', 'Not in yet'])
    expect(tiles[0].note).toBe('Face or mobile punch')
    expect(tiles[1].note).toBe('After the 15 min grace')
    const noHalf = teamTiles(roster.filter((r) => r.effectiveStatus !== 'HALF_DAY'))
    expect(noHalf.map((t) => t.key)).toEqual(['in', 'late', 'wfh', 'leave', 'none'])
    expect(teamTiles([person({ effectiveStatus: 'LATE', graceMinutes: 10 }), person({ effectiveStatus: 'LATE', graceMinutes: 15 })])[1].note)
      .toBe('After their grace period')
  })

  it('says where and how each person checked in', () => {
    expect(rosterWhen(roster[0], 'in', today)).toBe('In at 09:24 · Face · BLR-HQ')
    expect(rosterWhen(roster[3], 'wfh', today)).toBe('In at 09:40 · Web · home')
    expect(rosterWhen(roster[4], 'leave', today)).toBe('Sick leave · today')
    expect(rosterWhen(person({ leaveTypeName: 'Casual leave', leaveTo: '2026-09-29' }), 'leave', today)).toBe('Casual leave · until Tue 29 Sep')
    expect(rosterWhen(roster[5], 'none', today)).toBe('No punch yet')
    expect(rosterWhen(person({ pendingLeave: true }), 'none', today)).toBe('No punch yet · leave request waiting')
  })

  it('adds "joined" in someone’s first 30 days and "probation" while on it', () => {
    const m = { employeeId: 'a', name: 'Sana', employeeCode: null, jobTitle: 'Engineer', departmentName: null, employmentStatus: 'PROBATION',
      dateOfJoining: '2026-09-01', probationEndDate: '2026-12-01', offToday: null, profilePhotoUrl: null }
    expect(roleLine('Engineer', m, today)).toBe('Engineer · joined 1 Sep · probation')
    expect(roleLine('Engineer', { ...m, dateOfJoining: '2026-01-01', employmentStatus: 'ACTIVE' }, today)).toBe('Engineer')
  })

  it('names the team and its size by how the team is chosen', () => {
    const base = { departmentNames: [], members: [{}, {}] } as unknown as TeamSummary
    expect(teamSub({ ...base, scope: 'DIRECT_REPORTS' }, today)).toBe('Friday, 25 September · 2 people report to you')
    expect(teamSub({ ...base, scope: 'DEPARTMENT', departmentNames: ['Engineering'] }, today)).toBe('Friday, 25 September · Engineering · 2 people in your team')
    expect(teamSub({ ...base, scope: 'COMPANY' }, today)).toBe('Friday, 25 September · 2 people in the company')
    expect(teamSub(undefined, today)).toBe('Friday, 25 September')
  })

  it('adds team members who are off today and not on the roster', () => {
    const members = [
      { employeeId: 'x', offToday: 'WEEKLY_OFF' }, { employeeId: 'y', offToday: null }, { employeeId: roster[0].employeeId, offToday: 'HOLIDAY' },
    ] as never
    expect(offTodayMembers(members, roster).map((m) => m.employeeId)).toEqual(['x'])
  })

  it('lists leave in the next two weeks, soonest first, without work from home', () => {
    const e = (over: Partial<TeamTimeOffEntry>): TeamTimeOffEntry => ({ kind: 'LEAVE', requestId: Math.random().toString(), employeeId: 'a', employeeName: 'Arjun Nair',
      fromDate: today, toDate: today, status: 'APPROVED', leaveTypeName: 'Sick leave', duration: 'FULL_DAY', days: 1, canDecide: false, ...over })
    const list = outSoon([
      e({ fromDate: '2026-10-05', toDate: '2026-10-09', status: 'PENDING', canDecide: true, employeeName: 'Kavya Menon' }),
      e({}),
      e({ kind: 'WFH', employeeName: 'Home Person' }),
      e({ fromDate: '2026-09-20', toDate: '2026-09-24', employeeName: 'Already back' }),
      e({ fromDate: '2026-09-23', toDate: '2026-09-28', employeeName: 'Still out', status: 'PENDING_L2', canDecide: false }),
    ], today)
    expect(list.map((x) => [x.name, x.when, x.status])).toEqual([
      ['Still out', 'Until Mon 28 Sep', 'Waiting for approval'],
      ['Arjun Nair', 'Today', 'Sick leave'],
      ['Kavya Menon', 'Mon 5 – Fri 9 Oct', 'Waiting for you'],
    ])
  })

  it('words probation dates and extends by a month', () => {
    expect(probationWhen('2026-10-05', 10)).toBe('Probation ends Mon, 5 Oct · in 10 days')
    expect(probationWhen('2026-09-25', 0)).toBe('Probation ends Fri, 25 Sep · today')
    expect(probationWhen('2026-09-22', -3)).toBe('Probation ended Tue, 22 Sep · 3 days ago')
    expect(extendedEnd('2026-10-05')).toBe('2026-11-05')
    expect(extendedEnd('2027-01-31')).toBe('2027-02-28')
  })
})

describe('Approvals', () => {
  const row = (over: Partial<InboxRow>): InboxRow => ({
    kind: 'LEAVE', requestId: Math.random().toString(), employeeId: 'e', employeeName: 'Priya Sharma', employeeCode: null, departmentName: null,
    createdAt: '2026-09-25T05:00:00Z', title: 'Casual leave', fromDate: '2026-09-28', toDate: '2026-09-29', days: 2, amount: null, currency: null,
    reason: null, facts: [], warnings: [], canDecide: true, rejectNeedsReason: false, ...over,
  })

  it('writes each kind’s line the way the design does', () => {
    expect(inboxWhat(row({}))).toBe('Casual leave · Mon 28 – Tue 29 Sep · 2 days')
    expect(inboxWhat(row({ kind: 'WFH', title: 'Work from home', fromDate: '2026-09-30', toDate: '2026-09-30', days: 1 }))).toBe('Work from home · Wed 30 Sep · 1 day')
    expect(inboxWhat(row({ kind: 'CORRECTION', title: 'Missed punch-out', fromDate: '2026-09-23', toDate: '2026-09-23', days: null }))).toBe('Missed punch-out · Wed 23 Sep')
    expect(inboxWhat(row({ kind: 'SHIFT_CHANGE', title: 'Shift change: General → Early', fromDate: '2026-10-05', toDate: null, days: null })))
      .toBe('Shift change: General → Early · From Mon 5 Oct')
    expect(inboxWhat(row({ kind: 'SHIFT_CHANGE', title: 'Shift change to Early', fromDate: null, toDate: null, days: null })))
      .toBe('Shift change to Early · from the day it’s approved')
    expect(inboxWhat(row({ kind: 'EXPENSE', title: 'Client visit travel', amount: 4860, currency: 'INR', fromDate: null, toDate: null, days: null })))
      .toBe('Client visit travel · ₹4,860')
    expect(inboxWhat(row({ kind: 'TIMESHEET', title: 'Timesheet', fromDate: '2026-09-21', toDate: '2026-09-27', days: null })))
      .toBe('Timesheet · Mon 21 – Sun 27 Sep')
    expect(rangeShort('2026-09-30', '2026-10-02')).toBe('Wed 30 Sep – Fri 2 Oct')
    expect(rangeShort('2026-12-30', '2027-01-02')).toBe('Wed 30 Dec 2026 – Sat 2 Jan 2027')
    expect(daysText(0.5)).toBe('0.5 days')
  })

  it('counts the waiting requests and the ones with warnings', () => {
    expect(approvalsSub(7, 2, 'all')).toBe('7 requests are waiting from your team. 2 need a closer look.')
    expect(approvalsSub(1, 0, 'leave')).toBe('1 request is waiting in leave. None have warnings.')
    expect(approvalsSub(3, 1, 'requests')).toBe('3 requests are waiting in requests. 1 needs a closer look.')
    expect(approvalsSub(0, 0, 'all')).toBe('You’re all caught up.')
  })

  it('approves in one go only what the person may decide and what has no warning', () => {
    const rows = [row({}), row({ warnings: [{ key: 'othersOut', text: 'Arjun is out too' }] }), row({ canDecide: false })]
    expect(easyRows(rows)).toEqual([rows[0]])
  })

  it('puts each kind under its tab and opens only the tabs the permissions allow', () => {
    expect(['LEAVE', 'CORRECTION', 'WFH', 'SHIFT_CHANGE', 'EXPENSE', 'TIMESHEET'].map((k) => tabOfKind(k as never)))
      .toEqual(['leave', 'attendance', 'requests', 'requests', 'expenses', 'requests'])
    expect(inboxTabsFor({ leave: true, wfh: true, fixes: true, expenses: true, timesheets: true })).toEqual(['all', 'leave', 'attendance', 'requests', 'expenses'])
    expect(inboxTabsFor({ leave: false, wfh: true, fixes: false, expenses: false, timesheets: false })).toEqual(['all', 'requests'])
    expect(inboxTabsFor({ leave: false, wfh: false, fixes: false, expenses: false, timesheets: false })).toEqual([])
    expect(pickTab('expenses', ['all', 'requests'])).toBe('all')
    expect(pickTab('requests', ['all', 'requests'])).toBe('requests')
    expect(pickView('approvals', ['today', 'schedule'])).toBe('today')
    expect(pickView('schedule', ['today', 'schedule'])).toBe('schedule')
  })

  it('shows a tab’s decisions while they can still be undone', () => {
    const now = Date.parse('2026-09-25T06:00:00Z')
    const d = (kind: string, until: string) => ({ id: kind, kind, requestId: kind, decision: 'APPROVED', employeeId: 'e', employeeName: 'P', summary: 's', note: null,
      decidedAt: '2026-09-25T05:55:00Z', undoUntil: until })
    const list = [d('LEAVE', '2026-09-25T06:05:00Z'), d('EXPENSE', '2026-09-25T06:05:00Z'), d('WFH', '2026-09-25T05:59:00Z')] as never
    expect(decisionsInTab(list, 'all', now).map((x) => x.kind)).toEqual(['LEAVE', 'EXPENSE'])
    expect(decisionsInTab(list, 'expenses', now).map((x) => x.kind)).toEqual(['EXPENSE'])
  })

  it('says how long ago and formats amounts in Indian style', () => {
    const now = Date.parse('2026-09-25T06:00:00Z')
    expect(relTime('2026-09-25T05:48:00Z', now)).toBe('12 min ago')
    expect(relTime('2026-09-25T03:00:00Z', now)).toBe('3 hr ago')
    expect(relTime('2026-09-22T06:00:00Z', now)).toBe('3 days ago')
    expect(relTime('2026-09-25T05:59:40Z', now)).toBe('just now')
    expect(money(125000, 'INR')).toBe('₹1,25,000')
  })
})

describe('Team schedule', () => {
  const day = (over: object) => ({ employeeId: 'a', employeeName: 'Priya', date: '2026-09-28', ...over })
  const entry = (over: Partial<TeamTimeOffEntry>): TeamTimeOffEntry => ({ kind: 'LEAVE', requestId: 'r1', employeeId: 'a', employeeName: 'Priya',
    fromDate: '2026-09-28', toDate: '2026-09-29', status: 'PENDING', leaveTypeName: 'Casual leave', duration: 'FULL_DAY', days: 2, canDecide: true, ...over })

  it('shows the holiday, then approved leave, the weekly off, a request waiting, home, the shift, or nothing yet', () => {
    const d = '2026-09-28'
    expect(scheduleCell(day({ holidayName: 'Gandhi Jayanti', onLeave: { leaveTypeName: 'Sick' } }), [], d)).toEqual({ tone: 'holiday', title: 'Gandhi Jayanti' })
    expect(scheduleCell(day({ onLeave: { leaveTypeName: 'Sick leave', halfDay: true } }), [], d)).toEqual({ tone: 'leave', title: 'Sick leave', sub: 'Half day · approved' })
    expect(scheduleCell(day({ weeklyOff: true }), [entry({})], d)).toEqual({ tone: 'off', title: 'Off' })
    expect(scheduleCell(day({ shiftName: 'General' }), [entry({})], d))
      .toEqual({ tone: 'pending', title: 'Leave?', sub: 'Waiting for you', pending: { kind: 'LEAVE', requestId: 'r1', canDecide: true } })
    expect(scheduleCell(day({ shiftName: 'General' }), [entry({ kind: 'WFH', status: 'PENDING_L2', canDecide: false })], d).sub).toBe('Waiting')
    expect(scheduleCell(day({ shiftName: 'General' }), [entry({ kind: 'WFH', status: 'APPROVED' })], d)).toEqual({ tone: 'home', title: 'Home', sub: 'Approved' })
    expect(scheduleCell(day({ shiftName: 'General', startTime: '09:30:00', endTime: '18:30:00' }), [], d)).toEqual({ tone: 'shift', title: 'General', sub: '09:30 – 18:30' })
    expect(scheduleCell(day({ shiftName: 'Evening', startTime: '14:00:00', endTime: '23:00:00' }), [], d).tone).toBe('alt')
    expect(scheduleCell(day({ joinedOn: '2026-10-01' }), [], d)).toEqual({ tone: 'none', title: 'Not joined yet' })
    expect(scheduleCell(day({}), [], d)).toEqual({ tone: 'none', title: 'No shift yet' })
    // a request that doesn't cover the day changes nothing
    expect(scheduleCell(day({ shiftName: 'General' }), [entry({ fromDate: '2026-09-30', toDate: '2026-09-30' })], d).tone).toBe('shift')
  })

  it('groups the schedule by person in the API’s order', () => {
    const people = schedulePeople([day({}), day({ date: '2026-09-29' }), day({ employeeId: 'b', employeeName: 'Arjun' })] as never)
    expect(people.map((p) => [p.name, p.days.size])).toEqual([['Priya', 2], ['Arjun', 1]])
  })
})

describe('Reviews card', () => {
  it('counts self-reviews in and puts the people ready for their manager first', () => {
    const p: CycleProgress = {
      cycleId: 'c', cycleName: 'Q3 reviews', status: 'ACTIVE', totalAssignments: 4, completedAssignments: 1, overallPct: 25,
      reviewees: [
        { revieweeId: '1', revieweeName: 'Priya Sharma', totalAssignments: 2, completedAssignments: 0, completionPct: 0,
          assignments: [{ reviewerType: 'SELF', reviewerId: '1', status: 'PENDING' }, { reviewerType: 'MANAGER', reviewerId: 'm', status: 'PENDING' }] },
        { revieweeId: '2', revieweeName: 'Kavya Menon', totalAssignments: 2, completedAssignments: 1, completionPct: 50,
          assignments: [{ reviewerType: 'SELF', reviewerId: '2', status: 'COMPLETED' }, { reviewerType: 'MANAGER', reviewerId: 'm', status: 'PENDING' }] },
      ],
    }
    const m = reviewsModel(p)
    expect([m.selfIn, m.selfTotal, m.ready]).toEqual([1, 2, 1])
    expect(m.rows.map((r) => [r.name, r.text])).toEqual([
      ['Kavya Menon', 'Self-review in · manager review to write'],
      ['Priya Sharma', 'Self-review not in yet'],
    ])
  })
})
