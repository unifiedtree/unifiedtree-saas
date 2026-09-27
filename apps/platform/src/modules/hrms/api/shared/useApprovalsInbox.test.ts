import { describe, expect, it } from 'vitest'
import { approvalsInboxQuery } from './useApprovalsInbox'
import type { ApprovalsInbox } from './contracts'
import { expectSharedMapping, fakeApi } from './testing'

describe('useApprovalsInbox (BW-09)', () => {
  it('asks for all, page 0, size 20 by default', async () => {
    const inbox: ApprovalsInbox = {
      counts: { all: 1, leave: 1, attendance: 0, requests: 0, expenses: 0 },
      tabs: ['all', 'leave'],
      rows: [{
        kind: 'LEAVE', requestId: 'r-1', employeeId: 'e-1', employeeName: 'Asha Rao', employeeCode: null, departmentName: 'Engineering',
        createdAt: '2026-09-27T04:00:00Z', title: 'Casual leave', fromDate: '2026-09-28', toDate: '2026-09-29', days: 2,
        amount: null, currency: null, reason: 'Family function',
        facts: [{ key: 'balanceAfter', label: 'Balance after', value: '4 days' }], warnings: [], canDecide: true, rejectNeedsReason: false,
      }],
      page: 0, size: 20, totalElements: 1, recentDecisions: [], unavailable: [],
    }
    const { api, calls } = fakeApi(() => inbox)
    const q = approvalsInboxQuery({}, api)
    expect(q.queryKey).toEqual(['team', 'approvals', 'all', 0, 20])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: inbox })
    expect(calls[0].path).toBe('/v1/team/approvals?kind=all&page=0&size=20')
  })

  it('passes the tab as `kind`, and the page', async () => {
    const { api, calls } = fakeApi(() => ({}))
    const q = approvalsInboxQuery({ tab: 'requests', page: 2, size: 10 }, api)
    expect(q.queryKey).toEqual(['team', 'approvals', 'requests', 2, 10])
    await q.queryFn()
    expect(calls[0].path).toBe('/v1/team/approvals?kind=requests&page=2&size=10')
  })

  it('is not available until P-TEAM ships it', async () => {
    await expectSharedMapping((api) => approvalsInboxQuery({ tab: 'leave' }, api).queryFn())
  })
})
