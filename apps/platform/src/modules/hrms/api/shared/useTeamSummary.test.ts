import { describe, expect, it } from 'vitest'
import { teamSummaryQuery } from './useTeamSummary'
import type { TeamSummary } from './contracts'
import { expectSharedMapping, fakeApi } from './testing'

describe('useTeamSummary (BW-07)', () => {
  it('GETs /v1/team/summary under the shared key', async () => {
    const summary: TeamSummary = {
      scope: 'DEPARTMENT',
      departmentNames: ['Engineering'],
      members: [{
        employeeId: 'e-1', name: 'Asha Rao', employeeCode: 'EMP-001', jobTitle: 'Engineer', departmentName: 'Engineering',
        employmentStatus: 'PROBATION', dateOfJoining: '2026-09-01', probationEndDate: '2026-12-01', offToday: null, profilePhotoUrl: null,
      }],
    }
    const { api, calls } = fakeApi(() => summary)
    const q = teamSummaryQuery(api)
    expect(q.queryKey).toEqual(['team', 'summary'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: summary })
    expect(calls).toEqual([{ path: '/v1/team/summary', method: 'GET', body: undefined }])
  })

  it('is not available until P-TEAM ships it; other failures stay errors', async () => {
    await expectSharedMapping((api) => teamSummaryQuery(api).queryFn())
  })
})
