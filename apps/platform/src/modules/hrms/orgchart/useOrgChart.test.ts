import { describe, expect, it } from 'vitest'
import { orgChartKey, orgChartQuery, type OrgChartData } from './useOrgChart'
import { expectSharedMapping, fakeApi } from '../api/shared/testing'

describe('useOrgChart (GET /v1/hrms/org-chart)', () => {
  const data: OrgChartData = {
    scope: 'TEAM', companyId: 'c-1', companyName: 'Demo Corp', viewerEmployeeId: 'e-1', truncated: false,
    people: [{ id: 'e-1', name: 'Asha Rao', designation: 'Engineer', department: 'Engineering', location: null, photoUrl: null,
      status: 'ACTIVE', parentId: null, directReports: 0, relation: 'SELF', note: null, canViewRecord: true }],
  }

  it('reads the caller\'s own chart, or one company\'s when asked', async () => {
    const { api, calls } = fakeApi(() => data)
    await expect(orgChartQuery(null, api).queryFn()).resolves.toEqual({ available: true, value: data })
    await orgChartQuery('c 2', api).queryFn()
    expect(calls.map((c) => c.path)).toEqual(['/v1/hrms/org-chart', '/v1/hrms/org-chart?companyId=c%202'])
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('keeps its key under the employees key, so employee changes refresh it', () => {
    expect(orgChartKey(null)).toEqual(['hrms', 'employees', 'org-chart', 'own'])
    expect(orgChartKey('c-1')).toEqual(['hrms', 'employees', 'org-chart', 'c-1'])
  })

  it('reads 404 and FEATURE_NOT_READY as not available; 403, 422 and 500 stay errors', async () => {
    await expectSharedMapping((a) => orgChartQuery(null, a).queryFn())
  })
})
