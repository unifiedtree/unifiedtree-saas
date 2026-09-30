import { describe, expect, it } from 'vitest'
import { payScheduleQuery } from './usePaySchedule'
import { answers, expectSharedMapping, fakeApi } from './testing'

describe('usePaySchedule (BW-55)', () => {
  it('reads my next pay date', async () => {
    const { api, calls } = fakeApi(() => ({ nextPayDate: '2026-09-30', processingDay: 30 }))
    const q = payScheduleQuery(api)
    expect(q.queryKey).toEqual(['hrms', 'payroll', 'me', 'schedule'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: { nextPayDate: '2026-09-30', processingDay: 30 } })
    expect(calls[0]).toEqual({ path: '/v1/payroll/payslips/me/schedule', method: 'GET', body: undefined })
  })

  it('reads today\'s 400 INVALID_PARAMETER ("schedule" taken as a run id) as not built yet', async () => {
    const { api } = fakeApi(() => { throw answers.invalidParameter() })
    await expect(payScheduleQuery(api).queryFn()).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
  })

  it('follows the shared mapping otherwise', async () => {
    await expectSharedMapping((api) => payScheduleQuery(api).queryFn())
  })
})
