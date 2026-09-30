import { describe, expect, it } from 'vitest'
import { isTeamTimeOffRange, teamTimeOffQuery, TEAM_TIME_OFF_MAX_DAYS } from './useTeamTimeOff'
import type { TeamTimeOffEntry } from './contracts'
import { expectSharedMapping, fakeApi } from './testing'

describe('useTeamTimeOff (BW-08)', () => {
  it('GETs the range with from and to, keyed by the range', async () => {
    const rows: TeamTimeOffEntry[] = [{
      kind: 'LEAVE', requestId: 'r-1', employeeId: 'e-1', employeeName: 'Asha Rao', fromDate: '2026-09-28', toDate: '2026-09-29',
      status: 'PENDING', leaveTypeName: 'Casual leave', duration: 'FULL_DAY', days: 2, canDecide: true,
    }]
    const { api, calls } = fakeApi(() => rows)
    const q = teamTimeOffQuery('2026-09-28', '2026-10-04', api)
    expect(q.queryKey).toEqual(['team', 'time-off', '2026-09-28', '2026-10-04'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: rows })
    expect(calls[0]).toEqual({ path: '/v1/team/time-off?from=2026-09-28&to=2026-10-04', method: 'GET', body: undefined })
  })

  it('only asks for ranges the endpoint accepts (1 to 62 days)', () => {
    expect(TEAM_TIME_OFF_MAX_DAYS).toBe(62)
    expect(isTeamTimeOffRange('2026-09-28', '2026-09-28')).toBe(true)
    expect(isTeamTimeOffRange('2026-09-01', '2026-11-01')).toBe(true)   // 62 days
    expect(isTeamTimeOffRange('2026-09-01', '2026-11-02')).toBe(false)  // 63 days
    expect(isTeamTimeOffRange('2026-10-01', '2026-09-30')).toBe(false)
    expect(isTeamTimeOffRange(undefined, '2026-09-30')).toBe(false)
    expect(isTeamTimeOffRange('not a date', '2026-09-30')).toBe(false)
  })

  it('is not available until P-TEAM ships it', async () => {
    await expectSharedMapping((api) => teamTimeOffQuery('2026-09-28', '2026-10-04', api).queryFn())
  })
})
