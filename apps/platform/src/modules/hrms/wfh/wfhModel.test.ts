import { describe, expect, it } from 'vitest'
import type { WfhRequestResponse } from '../api/useWfh'
import { addRange, blockOf, nextWorkingDay, pickLine, spanDays, wfhDayMap, withLine, workingDays } from './wfhModel'

const SAT_SUN = new Set([6, 0])
const req = (over: Partial<WfhRequestResponse>): WfhRequestResponse => ({
  id: 'w1', employeeId: 'e1', fromDate: '2026-10-05', toDate: '2026-10-06', reason: 'Focus day', status: 'PENDING',
  approverId: null, decisionNote: null, decidedAt: null, createdAt: '2026-10-01T05:00:00Z', ...over,
})

describe('workingDays', () => {
  it('skips weekly offs and counts working days from the start', () => {
    // Thu 1 Oct 2026 → Thu, Fri, Mon, Tue
    expect(workingDays('2026-10-01', 4, SAT_SUN)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'])
  })
  it('honours a person’s own weekly off', () => {
    expect(workingDays('2026-10-02', 2, new Set([5]))).toEqual(['2026-10-03', '2026-10-04'])
  })
  it('finds the next page start after a weekend', () => {
    expect(nextWorkingDay('2026-10-02', SAT_SUN)).toBe('2026-10-05')
  })
})

describe('blockOf', () => {
  const ctx = { holidays: new Map([['2026-10-02', 'Gandhi Jayanti']]), leave: new Set(['2026-10-07']), wfh: wfhDayMap([req({}), req({ id: 'w2', fromDate: '2026-10-09', toDate: '2026-10-09', status: 'APPROVED' })]) }
  it('gives the reason a day cannot be picked', () => {
    expect(blockOf('2026-10-02', ctx)).toBe('Holiday')
    expect(blockOf('2026-10-07', ctx)).toBe('Leave')
    expect(blockOf('2026-10-06', ctx)).toBe('Asked')
    expect(blockOf('2026-10-09', ctx)).toBe('Approved')
    expect(blockOf('2026-10-08', ctx)).toBeNull()
  })
  it('frees the days of cancelled or rejected requests', () => {
    const m = wfhDayMap([req({ status: 'CANCELLED' }), req({ id: 'w3', status: 'REJECTED' })])
    expect(m.size).toBe(0)
  })
})

describe('wording', () => {
  it('lists the picked days in order', () => {
    expect(pickLine([])).toBe('No days picked yet')
    expect(pickLine(['2026-10-08', '2026-10-05'])).toBe('2 days: Mon 5 Oct, Thu 8 Oct')
  })
  it('counts the calendar days of a request', () => {
    expect(spanDays('2026-10-05', '2026-10-06')).toBe(2)
    expect(spanDays('2026-10-06', '2026-10-05')).toBe(0)
  })
  it('says who has the request', () => {
    expect(withLine({ status: 'PENDING', approverName: 'Siddharth Rao' })).toBe('With Siddharth Rao')
    expect(withLine({ status: 'APPROVED', approverName: 'Siddharth Rao' })).toBe('Approved by Siddharth Rao')
    expect(withLine({ status: 'CANCELLED', approverName: 'Siddharth Rao' })).toBe('')
    expect(withLine({ status: 'PENDING', approverName: null })).toBe('')
  })
})

describe('addRange ("Select dates" on Work from home)', () => {
  const ctx = { holidays: new Map([['2026-10-02', 'Gandhi Jayanti']]), leave: new Set(['2026-10-07']), wfh: wfhDayMap([req({})]) }
  it('adds the free working days of the range to what is picked, sorted', () => {
    // Thu 1 – Fri 9 Oct: 2 Oct holiday, 3–4 weekend, 5–6 asked, 7 leave.
    expect(addRange(['2026-10-12'], '2026-10-01', '2026-10-09', SAT_SUN, ctx, 31)).toEqual(['2026-10-01', '2026-10-08', '2026-10-09', '2026-10-12'])
  })
  it('stops at the most days one request may hold', () => {
    expect(addRange(['2026-10-01'], '2026-10-08', '2026-10-20', SAT_SUN, ctx, 3)).toEqual(['2026-10-01', '2026-10-08', '2026-10-09'])
  })
  it('runs across a month end and a year end', () => {
    const none = { holidays: new Map<string, string>(), leave: new Set<string>(), wfh: new Map<string, string>() }
    expect(addRange([], '2026-12-30', '2027-01-04', SAT_SUN, none, 31)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-04'])
  })
})
