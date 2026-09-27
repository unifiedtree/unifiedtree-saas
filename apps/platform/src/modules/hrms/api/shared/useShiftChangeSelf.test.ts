import { describe, expect, it } from 'vitest'
import { myShiftChangesQuery, requestShiftChangeMutation, withdrawShiftChangeMutation } from './useShiftChangeSelf'
import type { ShiftChangeRequest } from './contracts'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const request: ShiftChangeRequest = {
  id: 's-1', employeeId: 'e-1', employeeName: 'Asha Rao', employeeCode: null, currentShiftPolicyId: 'p-1', currentShiftName: 'General',
  requestedShiftPolicyId: 'p-2', requestedShiftName: 'Early', reason: 'School run this month', status: 'PENDING',
  approverId: null, approverName: null, decisionNote: null, decidedAt: null, createdAt: '2026-09-27T04:00:00Z',
  requestedEffectiveDate: '2026-10-05', appliedEffectiveDate: null, requestedEndDate: '2026-10-30',
}

describe('useShiftChangeSelf (BW-31, BW-34)', () => {
  it('lists my requests under today\'s key', async () => {
    const { api, calls } = fakeApi(() => [request])
    const q = myShiftChangesQuery(api)
    // The same key shifts/ShiftChangeRequest.tsx and AttendanceContainer.tsx use today.
    expect(q.queryKey).toEqual(['shifts', 'change-requests', 'my'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: [request] })
    expect(calls[0].path).toBe('/v1/shifts/change-requests/my')
  })

  it('asks for a change with "Until" only when there is one', async () => {
    const { api, calls } = fakeApi(() => request)
    const { qc, invalidated } = spyQueryClient()
    const m = requestShiftChangeMutation(qc, api)
    const base = { requestedShiftPolicyId: 'p-2', effectiveDate: '2026-10-05', reason: 'School run this month' }
    const r = await m.mutationFn({ ...base, endDate: '2026-10-30' })
    expect(calls[0]).toEqual({ path: '/v1/shifts/change-requests', method: 'POST', body: { ...base, endDate: '2026-10-30' } })
    // A permanent change sends exactly today's body.
    await m.mutationFn({ ...base, endDate: null })
    await m.mutationFn(base)
    expect(calls[1].body).toEqual(base)
    expect(calls[2].body).toEqual(base)
    await m.onSuccess?.(r, base)
    expect(invalidated).toEqual([['shifts', 'change-requests', 'my'], ['shifts', 'requests']])
  })

  it('withdraws a waiting request', async () => {
    const { api, calls } = fakeApi(() => ({ ...request, status: 'CANCELLED' }))
    const { qc, invalidated } = spyQueryClient()
    const m = withdrawShiftChangeMutation(qc, api)
    const r = await m.mutationFn('s-1')
    expect(calls[0]).toEqual({ path: '/v1/shifts/change-requests/s-1/cancel', method: 'POST', body: undefined })
    await m.onSuccess?.(r, 's-1')
    expect(invalidated).toEqual([['shifts', 'change-requests', 'my'], ['shifts', 'requests']])
  })

  it('withdraw is not available until BW-34 ships; the rest follows the shared mapping', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => withdrawShiftChangeMutation(qc, api).mutationFn('s-1'))
    await expectSharedMapping((api) => requestShiftChangeMutation(qc, api).mutationFn({ requestedShiftPolicyId: 'p', effectiveDate: '2026-10-05', reason: 'x'.repeat(10), endDate: '2026-10-30' }))
    await expectSharedMapping((api) => myShiftChangesQuery(api).queryFn())
  })
})
