import { describe, expect, it } from 'vitest'
import { applyLeaveOnBehalfMutation, applyLeaveOnBehalfPath } from './useApplyLeaveOnBehalf'
import type { LeaveRequestResponse } from './contracts'
import { answers, expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const created: LeaveRequestResponse = {
  id: 'r-1', employeeId: 'e-1', employeeName: 'Asha Rao', leaveTypeId: 't-1', leaveTypeName: 'Casual leave',
  startDate: '2026-09-28', endDate: '2026-09-29', totalDays: 2, status: 'PENDING', createdAt: '2026-09-27T04:00:00Z',
}

describe('useApplyLeaveOnBehalf (BW-43)', () => {
  it('posts /apply\'s body to /apply/for/{employeeId}, without a company', async () => {
    expect(applyLeaveOnBehalfPath('e-1')).toBe('/v1/leave/apply/for/e-1')
    const { api, calls } = fakeApi(() => created)
    const { qc } = spyQueryClient()
    const body = { leaveTypeId: 't-1', startDate: '2026-09-28', endDate: '2026-09-29', duration: 'FULL_DAY' as const, reason: 'Unwell' }
    await expect(applyLeaveOnBehalfMutation(qc, api).mutationFn({ employeeId: 'e-1', ...body })).resolves.toEqual({ available: true, value: created })
    expect(calls[0]).toEqual({ path: '/v1/leave/apply/for/e-1', method: 'POST', body })
  })

  it('refreshes leave, the inbox, team time off and the schedule', async () => {
    const { qc, invalidated } = spyQueryClient()
    await applyLeaveOnBehalfMutation(qc).onSuccess?.({ available: true, value: created },
      { employeeId: 'e-1', leaveTypeId: 't-1', startDate: '2026-09-28', endDate: '2026-09-29', duration: 'FULL_DAY' })
    expect(invalidated).toEqual([['hrms', 'leave'], ['team', 'approvals'], ['team', 'time-off'], ['team', 'schedule']])
  })

  it('shows the real refusal (for example no balance left) as an error', async () => {
    const { qc } = spyQueryClient()
    const noBalance = answers.refused('INSUFFICIENT_LEAVE_BALANCE', 'Only 1 day of Casual leave is left.')
    await expect(applyLeaveOnBehalfMutation(qc, fakeApi(() => { throw noBalance }).api)
      .mutationFn({ employeeId: 'e-1', leaveTypeId: 't-1', startDate: '2026-09-28', endDate: '2026-09-30', duration: 'FULL_DAY' }))
      .rejects.toBe(noBalance)
    await expectSharedMapping((api) => applyLeaveOnBehalfMutation(qc, api)
      .mutationFn({ employeeId: 'e-1', leaveTypeId: 't-1', startDate: '2026-09-28', endDate: '2026-09-28', duration: 'HALF_DAY_MORNING' }))
  })
})
