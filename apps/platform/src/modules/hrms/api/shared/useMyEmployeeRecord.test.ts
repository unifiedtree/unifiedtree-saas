import { describe, expect, it } from 'vitest'
import { myEmployeeRecordQuery } from './useMyEmployeeRecord'
import type { MyEmployeeRecord } from './contracts'
import { answers, expectSharedMapping, fakeApi } from './testing'

describe('useMyEmployeeRecord (BW-98)', () => {
  it('reads my own record', async () => {
    const me: MyEmployeeRecord = {
      employeeId: 'e-1', employeeCode: 'EMP-001', firstName: 'Asha', lastName: 'Rao', companyId: 'c-1', employmentStatus: 'PROBATION',
      dateOfJoining: '2026-07-01', designationName: 'Engineer', departmentName: 'Engineering', managerName: 'Dept Manager',
      probationEndDate: '2026-12-31', confirmationDate: null, noticeStartDate: null, lastWorkingDay: null,
    }
    const { api, calls } = fakeApi(() => me)
    const q = myEmployeeRecordQuery(api)
    // Under today's ['hrms','employees'], which every employee change refreshes.
    expect(q.queryKey).toEqual(['hrms', 'employees', 'me'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: me })
    expect(calls[0]).toEqual({ path: '/v1/hrms/employees/me', method: 'GET', body: undefined })
  })

  it('reads today\'s 400 INVALID_PARAMETER ("me" taken as an employee id) as not built yet', async () => {
    const { api } = fakeApi(() => { throw answers.invalidParameter() })
    await expect(myEmployeeRecordQuery(api).queryFn()).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
    await expectSharedMapping((a) => myEmployeeRecordQuery(a).queryFn())
  })
})
