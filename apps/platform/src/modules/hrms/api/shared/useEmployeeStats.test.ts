import { describe, expect, it } from 'vitest'
import { employeeStatsQuery } from './useEmployeeStats'
import type { EmployeeStats } from './contracts'
import { answers, expectSharedMapping, fakeApi } from './testing'

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const stats: EmployeeStats = {
  counts: { total: 12, active: 8, probation: 2, notice: 1, suspended: 0, exited: 1, terminated: 0 },
  joinedThisMonth: 2, leftThisMonth: 1, noticeStartedLast7Days: 1, probationReviewsDueNextMonth: 1, exitedThisYear: 1,
  attritionPercent: null,
  activeSeries: [{ date: '2026-03-31', active: 6 }, { date: '2026-09-27', active: 8 }],
  suspendedSince: [],
}

describe('useEmployeeStats (BW-90)', () => {
  it('reads one company\'s stats, or every company\'s', async () => {
    const { api, calls } = fakeApi(() => stats)
    const q = employeeStatsQuery(CO, api)
    // Under today's ['hrms','employee-counts'], which every employee change refreshes.
    expect(q.queryKey).toEqual(['hrms', 'employee-counts', 'stats', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: stats })
    expect(calls[0].path).toBe(`/v1/hrms/employees/stats?companyId=${CO}`)
    const all = employeeStatsQuery(undefined, api)
    expect(all.queryKey).toEqual(['hrms', 'employee-counts', 'stats', null])
    await all.queryFn()
    expect(calls[1].path).toBe('/v1/hrms/employees/stats')
  })

  it('reads today\'s 400 INVALID_PARAMETER ("stats" taken as an employee id) as not built yet', async () => {
    const { api } = fakeApi(() => { throw answers.invalidParameter() })
    await expect(employeeStatsQuery(CO, api).queryFn()).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
    await expectSharedMapping((a) => employeeStatsQuery(CO, a).queryFn())
  })
})
