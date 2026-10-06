// Approvals parity with the phone app: leave waiting for HR (LEAVE_L2), salary advances, overtime and skill levels
// in the website's Approvals list, with the same rules (never your own request; overtime and skill rejections need
// a note; extra rows count under All and under their own tab only when that tab is open).
import { describe, expect, it } from 'vitest'
import type { InboxRow } from '../api/shared/contracts'
import { approvalsInboxQuery } from '../api/shared/useApprovalsInbox'
import { fakeApi } from '../api/shared/testing'
import type { AdvanceRequest } from '../api/useAdvance'
import type { OvertimeEntry, OvertimeRequest } from '../api/useOvertime'
import type { SkillAssessment } from '../api/useLearning'
import { advanceRows, countsWithExtras, extraRowsInTab, newestFirst, overtimeRows, skillRows } from './extraApprovals'
import { KIND_LABEL, easyRows, inboxWhat, tabOfKind } from './teamModel'

const ME = 'me-1'

const advance = (over: Partial<AdvanceRequest> = {}): AdvanceRequest => ({
  id: 'a1', employeeId: 'e1', employeeName: 'Asha Rao', employeeCode: 'EMP7', companyId: 'c1', amount: 25000, reason: 'Medical',
  repaymentMonths: 5, monthlyDeduction: 5000, status: 'REQUESTED', outstandingAmount: 25000, createdAt: '2026-10-05T04:00:00Z', ...over,
})
const otEntry = (over: Partial<OvertimeEntry> = {}): OvertimeEntry => ({
  id: 'o1', employeeId: 'e2', employeeName: 'Ravi K', date: '2026-10-05', minutes: 95, countedMinutes: 90, status: 'PENDING',
  checkOutAt: '2026-10-05T14:00:00Z', shiftName: 'General', shiftEnd: '18:00:00', reason: 'Release', reasonSource: 'EMPLOYEE', ...over,
})
const otAsk = (over: Partial<OvertimeRequest> = {}): OvertimeRequest => ({
  id: 'q1', employeeId: 'e3', employeeName: 'Meena S', employeeCode: 'EMP9', date: '2026-10-08', minutes: 120, reason: 'Go-live',
  status: 'PENDING', decidedByName: null, decisionNote: null, decidedAt: null, createdAt: '2026-10-05T06:00:00Z', ...over,
})
const skill = (over: Partial<SkillAssessment> = {}): SkillAssessment => ({
  id: 's1', employeeId: 'e4', employeeName: 'Kiran P', employeeCode: 'EMP4', department: 'Engineering', skillName: 'React',
  currentProficiency: 2, proposedProficiency: 4, employeeNote: 'Shipped the portal', status: 'PENDING', createdAt: '2026-10-04T06:00:00Z',
  certificationName: null, ...over,
})

describe('Salary advances in Approvals', () => {
  it('lists only advances waiting for a decision, as Requests rows with the amount', () => {
    const rows = advanceRows([advance(), advance({ id: 'a2', status: 'APPROVED' }), advance({ id: 'a3', status: 'REJECTED' })], ME)
    expect(rows.map((r) => r.requestId)).toEqual(['a1'])
    const r = rows[0]
    expect(r.kind).toBe('ADVANCE')
    expect(tabOfKind(r.kind)).toBe('requests')
    expect(KIND_LABEL[r.kind]).toBe('Salary advance')
    expect(inboxWhat(r)).toBe('Salary advance · ₹25,000')
    expect(r.facts.map((f) => f.label)).toEqual(['Repaid over', 'Monthly deduction'])
    expect(r.canDecide).toBe(true)
    expect(r.rejectNeedsReason).toBe(false)
  })

  it('never lets you decide your own', () => {
    expect(advanceRows([advance({ employeeId: ME })], ME)[0].canDecide).toBe(false)
  })
})

describe('Overtime in Approvals', () => {
  it('lists waiting overtime from punches and asked for, under Attendance; a rejection needs a note', () => {
    const rows = overtimeRows([otEntry(), otEntry({ id: 'o2', status: 'APPROVED' })], [otAsk(), otAsk({ id: 'q2', status: 'CANCELLED' })], ME)
    expect(rows.map((r) => `${r.kind}:${r.requestId}`)).toEqual(['OVERTIME:o1', 'OVERTIME_REQUEST:q1'])
    for (const r of rows) {
      expect(tabOfKind(r.kind)).toBe('attendance')
      expect(r.rejectNeedsReason).toBe(true)
      expect(r.canDecide).toBe(true)
    }
    // the counted minutes, not the stored ones
    expect(inboxWhat(rows[0])).toBe('Overtime · Mon 5 Oct · +1h 30m')
    expect(rows[0].facts.find((f) => f.key === 'shiftEnded')?.value).toBe('6:00 PM · General')
    expect(rows[0].facts.find((f) => f.key === 'leftAt')?.value).toBe('7:30 PM')
    expect(inboxWhat(rows[1])).toBe('Overtime request · Thu 8 Oct · +2h')
  })

  it('reads a day sent as epoch millis, and never lets you decide your own', () => {
    const rows = overtimeRows([otEntry({ employeeId: ME, date: Date.UTC(2026, 9, 5, 6) })], [otAsk({ employeeId: ME })], ME)
    expect(rows[0].fromDate).toBe('2026-10-05')
    expect(rows.every((r) => !r.canDecide)).toBe(true)
  })
})

describe('Skill levels in Approvals', () => {
  it('lists waiting proposals under Requests, worded from level to level; a rejection needs a note', () => {
    const rows = skillRows([skill(), skill({ id: 's2', status: 'APPROVED' }), skill({ id: 's3', currentProficiency: null, proposedProficiency: 1, certificationName: 'AWS' })], ME)
    expect(rows.map((r) => r.requestId)).toEqual(['s1', 's3'])
    expect(rows[0].title).toBe('React: Basic → Advanced')
    expect(rows[1].title).toBe('React: new skill → Beginner')
    expect(rows[1].facts).toEqual([{ key: 'certification', label: 'Certification', value: 'AWS' }])
    expect(tabOfKind('SKILL')).toBe('requests')
    expect(rows.every((r) => r.rejectNeedsReason && r.canDecide)).toBe(true)
    expect(skillRows([skill({ employeeId: ME })], ME)[0].canDecide).toBe(false)
  })
})

describe('Leave waiting for HR', () => {
  it('is worded like leave and counted under Leave', () => {
    const r = { kind: 'LEAVE_L2', title: 'Casual leave', fromDate: '2026-09-28', toDate: '2026-09-29', days: 2 } as InboxRow
    expect(tabOfKind('LEAVE_L2')).toBe('leave')
    expect(KIND_LABEL.LEAVE_L2).toBe('Leave · HR approval')
    expect(inboxWhat(r)).toBe('Casual leave · Mon 28 – Tue 29 Sep · 2 days')
  })

  it('is asked for only by the Approvals page (includeL2), with its own cache key', async () => {
    const { api, calls } = fakeApi(() => ({}))
    const q = approvalsInboxQuery({ tab: 'all', page: 0, size: 50, includeL2: true }, api)
    expect(q.queryKey).toEqual(['team', 'approvals', 'all', 0, 50, 'l2'])
    await q.queryFn()
    expect(calls[0].path).toBe('/v1/team/approvals?kind=all&page=0&size=50&includeL2=true')
    // everyone else keeps today's request
    expect(approvalsInboxQuery({}, api).queryKey).toEqual(['team', 'approvals', 'all', 0, 20])
  })
})

describe('Merging with the server list', () => {
  const extras = [
    ...advanceRows([advance()], ME),
    ...overtimeRows([otEntry()], [], ME),
    ...skillRows([skill({ employeeId: ME })], ME),
  ]

  it('shows every extra row under All, and under a tab only when the person may open it', () => {
    expect(extraRowsInTab(extras, 'all', ['all', 'leave']).length).toBe(3)
    expect(extraRowsInTab(extras, 'attendance', ['all', 'leave'])).toEqual([])
    expect(extraRowsInTab(extras, 'attendance', ['all', 'attendance']).map((r) => r.kind)).toEqual(['OVERTIME'])
    expect(extraRowsInTab(extras, 'requests', ['all', 'requests']).map((r) => r.kind)).toEqual(['ADVANCE', 'SKILL'])
  })

  it('adds them to the counts the same way', () => {
    const counts = countsWithExtras({ all: 2, leave: 2, attendance: 0, requests: 0, expenses: 0 }, extras, ['all', 'leave', 'requests'])
    expect(counts).toEqual({ all: 5, leave: 2, attendance: 0, requests: 2, expenses: 0 })
    expect(countsWithExtras(undefined, [], undefined)).toEqual({ all: 0, leave: 0, attendance: 0, requests: 0, expenses: 0 })
  })

  it('sorts newest first, and "Approve N with no warnings" leaves out your own', () => {
    expect(newestFirst(extras).map((r) => r.kind)).toEqual(['OVERTIME', 'ADVANCE', 'SKILL'])
    expect(easyRows(extras).map((r) => r.kind)).toEqual(['ADVANCE', 'OVERTIME'])
  })
})
