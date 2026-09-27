import { describe, expect, it } from 'vitest'
import { confirmProbationMutation, extendProbationMutation, teamProbationQuery } from './useTeamProbation'
import type { TeamProbationDecision, TeamProbationRow } from './contracts'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const REFRESHED = [
  ['team', 'probation'], ['team', 'summary'], ['hrms', 'probation'], ['hrms', 'employee', 'e-1'], ['hrms', 'employees'], ['hrms', 'employee-counts'],
]

describe('useTeamProbation (BW-11)', () => {
  it('reads the team\'s probation ends, 30 days by default', async () => {
    const rows: TeamProbationRow[] = [{
      employeeId: 'e-1', name: 'Asha Rao', jobTitle: 'Engineer', departmentName: 'Engineering',
      probationEndDate: '2026-10-05', daysLeft: 8, overdue: false,
    }]
    const { api, calls } = fakeApi(() => rows)
    const q = teamProbationQuery(undefined, api)
    expect(q.queryKey).toEqual(['team', 'probation', 30])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: rows })
    expect(calls[0].path).toBe('/v1/team/probation?days=30')
    expect(teamProbationQuery(60).queryKey).toEqual(['team', 'probation', 60])
  })

  it('confirms with an optional date and refreshes everything that shows the person\'s status', async () => {
    const decision: TeamProbationDecision = { employeeId: 'e-1', employmentStatus: 'ACTIVE', probationEndDate: null, confirmationDate: '2026-09-28' }
    const { api, calls } = fakeApi(() => decision)
    const { qc, invalidated } = spyQueryClient()
    const m = confirmProbationMutation(qc, api)
    const r = await m.mutationFn({ employeeId: 'e-1', confirmationDate: '2026-09-28' })
    expect(r).toEqual({ available: true, value: decision })
    expect(calls[0]).toEqual({ path: '/v1/team/probation/e-1/confirm', method: 'POST', body: { confirmationDate: '2026-09-28' } })
    await m.mutationFn({ employeeId: 'e-1' })
    expect(calls[1]).toEqual({ path: '/v1/team/probation/e-1/confirm', method: 'POST', body: {} })
    await m.onSuccess?.(r, { employeeId: 'e-1' })
    expect(invalidated).toEqual(REFRESHED)
  })

  it('extends with a new end date and a note', async () => {
    const { api, calls } = fakeApi(() => ({ employeeId: 'e-1', employmentStatus: 'PROBATION', probationEndDate: '2026-11-05', confirmationDate: null }))
    const { qc, invalidated } = spyQueryClient()
    const m = extendProbationMutation(qc, api)
    const r = await m.mutationFn({ employeeId: 'e-1', newEndDate: '2026-11-05', note: 'Needs another month' })
    expect(calls[0]).toEqual({ path: '/v1/team/probation/e-1/extend', method: 'POST', body: { newEndDate: '2026-11-05', note: 'Needs another month' } })
    await m.onSuccess?.(r, { employeeId: 'e-1', newEndDate: '2026-11-05' })
    expect(invalidated).toEqual(REFRESHED)
  })

  it('refreshes nothing when the action isn\'t there yet', async () => {
    const { qc, invalidated } = spyQueryClient()
    await confirmProbationMutation(qc).onSuccess?.({ available: false, reason: 'NOT_FOUND' }, { employeeId: 'e-1' })
    expect(invalidated).toEqual([])
  })

  it('maps "not there yet" for every call', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => teamProbationQuery(30, api).queryFn())
    await expectSharedMapping((api) => confirmProbationMutation(qc, api).mutationFn({ employeeId: 'e-1' }))
    await expectSharedMapping((api) => extendProbationMutation(qc, api).mutationFn({ employeeId: 'e-1', newEndDate: '2026-11-05' }))
  })
})
