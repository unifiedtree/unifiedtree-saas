import { describe, expect, it } from 'vitest'
import { decidedCount, decidedTotal, requestWho } from './leaveLabels'
import { holidayNames } from './LeaveCalendar'
import type { HolidayResponse } from '../api/useSettings'

// Audit 5 Oct 2026, Leave page.
describe('Decided filter counts', () => {
  it('counts a status the server left out as 0, never NaN or blank', () => {
    // GET /approvals/history used to send only the statuses that occur.
    const counts = { APPROVED: 1 } as Partial<Record<'APPROVED' | 'REJECTED' | 'CANCELLED', number>>
    expect(decidedCount(counts, 'REJECTED')).toBe(0)
    expect(decidedCount(counts, 'APPROVED')).toBe(1)
    expect(decidedTotal(counts)).toBe(1)
    expect(decidedTotal(null)).toBe(0)
    expect(decidedTotal({ APPROVED: 2, REJECTED: 3, CANCELLED: 1 })).toBe(6)
  })
})

describe('My leave: who a request is with', () => {
  const base = { approverName: 'Meera Rao', decidedByName: null, l2ApproverName: null }
  it('names the approver as who it is with while it waits', () => {
    expect(requestWho({ ...base, status: 'PENDING' })).toBe('with Meera Rao')
    expect(requestWho({ ...base, status: 'PENDING_L2' })).toBe('with HR')
    expect(requestWho({ ...base, status: 'PENDING_L2', l2ApproverName: 'Anita' })).toBe('with Anita')
  })
  it('says who decided it once decided, never "for <approver>"', () => {
    expect(requestWho({ ...base, status: 'APPROVED' })).toBe('approved by Meera Rao')
    expect(requestWho({ ...base, status: 'REJECTED', decidedByName: 'Anita' })).toBe('rejected by Anita')
    expect(requestWho({ ...base, status: 'CANCELLED' })).toBe('')
    expect(requestWho({ status: 'PENDING', approverName: null, decidedByName: null, l2ApproverName: null })).toBe('')
  })
})

describe('Leave calendar holidays', () => {
  const h = (holidayDate: string, holidayName: string, active = true): HolidayResponse =>
    ({ id: holidayName, companyId: 'c', year: 2026, holidayDate, holidayName, holidayType: 'NATIONAL', active })
  it('maps the active holidays by date', () => {
    const m = holidayNames([h('2026-10-02', 'Gandhi Jayanti'), h('2026-10-20', 'Diwali', false), h('2026-10-02', 'Founders day')])
    expect(m.get('2026-10-02')).toBe('Gandhi Jayanti · Founders day')
    expect(m.has('2026-10-20')).toBe(false)
    expect(holidayNames(undefined).size).toBe(0)
  })
})
