import { describe, expect, it } from 'vitest'
import { timesheetDecisionMutation, timesheetDecisionPath } from './useTimesheetDecision'
import type { TimesheetWeek } from './contracts'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const week: TimesheetWeek = {
  id: 'w-1', employeeId: 'e-1', employeeName: 'Asha Rao', weekStart: '2026-09-21', status: 'APPROVED', totalMinutes: 2310,
  submittedAt: '2026-09-26T12:00:00Z', decidedAt: '2026-09-27T04:00:00Z', decidedByName: 'Dept Manager', note: null,
}

describe('useTimesheetDecision (BW-36)', () => {
  it('posts { status, comment } to the week\'s decision path', async () => {
    expect(timesheetDecisionPath('w-1')).toBe('/v1/timesheets/weeks/w-1/decision')
    const { api, calls } = fakeApi(() => week)
    const { qc } = spyQueryClient()
    const m = timesheetDecisionMutation(qc, api)
    await expect(m.mutationFn({ weekId: 'w-1', status: 'APPROVED' })).resolves.toEqual({ available: true, value: week })
    expect(calls[0]).toEqual({ path: '/v1/timesheets/weeks/w-1/decision', method: 'POST', body: { status: 'APPROVED' } })
    await m.mutationFn({ weekId: 'w-1', status: 'REJECTED', comment: 'Project missing on Tuesday' })
    expect(calls[1].body).toEqual({ status: 'REJECTED', comment: 'Project missing on Tuesday' })
  })

  it('refreshes timesheets, time entries and the inbox', async () => {
    const { qc, invalidated } = spyQueryClient()
    await timesheetDecisionMutation(qc).onSuccess?.({ available: true, value: week }, { weekId: 'w-1', status: 'APPROVED' })
    expect(invalidated).toEqual([['timesheets'], ['ess', 'time-entries'], ['team', 'approvals']])
  })

  it('is not available while the table is missing', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => timesheetDecisionMutation(qc, api).mutationFn({ weekId: 'w-1', status: 'APPROVED' }))
  })
})
