import { describe, expect, it } from 'vitest'
import { fnfStatusIds, fnfStatusQuery } from './useFnfStatus'
import type { FnfStatusRow } from './contracts'
import { answers, expectSharedMapping, fakeApi } from './testing'

describe('useFnfStatus (BW-64)', () => {
  it('asks for the ids comma-separated, one cache entry whatever their order', async () => {
    const rows: FnfStatusRow[] = [
      { employeeId: 'a', settlementId: 's-1', status: 'APPROVED', lastWorkingDay: '2026-09-15', netSettlement: 48210, paidAt: null },
      { employeeId: 'b', settlementId: null, status: null, lastWorkingDay: null, netSettlement: null, paidAt: null },
    ]
    const { api, calls } = fakeApi(() => rows)
    const q = fnfStatusQuery(['b', 'a', 'b', ''], api)
    expect(q.queryKey).toEqual(['hrms', 'fnf', 'status', 'a,b'])
    expect(fnfStatusQuery(['a', 'b']).queryKey).toEqual(q.queryKey)
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: rows })
    expect(calls[0].path).toBe('/v1/fnf/settlements/status?employeeIds=a%2Cb')
    expect(fnfStatusIds([])).toEqual([])
  })

  it('reads today\'s 400 INVALID_PARAMETER ("status" taken as an id) as not built yet', async () => {
    const { api } = fakeApi(() => { throw answers.invalidParameter() })
    await expect(fnfStatusQuery(['a'], api).queryFn()).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
    await expectSharedMapping((a) => fnfStatusQuery(['a'], a).queryFn())
  })
})
