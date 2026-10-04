import { describe, expect, it } from 'vitest'
import { punchAlertOptionsQuery, punchAlertSettingQuery, punchAlertSummary, savePunchAlertSettingMutation } from './usePunchAlertSetting'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const SETTING = {
  companyId: CO, notifyManager: true, alertOn: 'ALL' as const, updatedByName: null, updatedAt: null,
  people: [{ employeeId: 'e1', name: 'Priya Rao', employeeCode: 'EMP-0001', jobTitle: 'HR lead', working: true }],
  roles: [{ roleId: 'r1', name: 'Supervisor', builtIn: false }],
}

describe('usePunchAlertSetting (punch-in alerts, V143_72)', () => {
  it('reads the company’s setting', async () => {
    const { api, calls } = fakeApi(() => SETTING)
    const q = punchAlertSettingQuery(CO, api)
    expect(q.queryKey).toEqual(['attendance', 'punch-alert-setting', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: SETTING })
    expect(calls[0]).toEqual({ path: `/v1/attendance/punch-alert-setting?companyId=${CO}`, method: 'GET', body: undefined })
  })

  it('reads what can be picked', async () => {
    const options = { companyId: CO, roles: [{ roleId: 'r1', name: 'HR Manager', builtIn: true }], people: [], truncated: false }
    const { api, calls } = fakeApi(() => options)
    const q = punchAlertOptionsQuery(CO, api)
    expect(q.queryKey).toEqual(['attendance', 'punch-alert-options', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: options })
    expect(calls[0].path).toBe(`/v1/attendance/punch-alert-setting/options?companyId=${CO}`)
  })

  it('saves with PUT and shows the answer at once', async () => {
    const { api, calls } = fakeApi(() => SETTING)
    const { qc } = spyQueryClient()
    const m = savePunchAlertSettingMutation(qc, CO, api)
    const body = { notifyManager: true, employeeIds: ['e1'], roleIds: ['r1'], alertOn: 'ALL' as const }
    const r = await m.mutationFn(body)
    expect(calls[0]).toEqual({ path: `/v1/attendance/punch-alert-setting?companyId=${CO}`, method: 'PUT', body })
    await m.onSuccess?.(r, body)
    expect(qc.getQueryData(['attendance', 'punch-alert-setting', CO])).toEqual({ available: true, value: SETTING })
  })

  it('is not available while the table is missing', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => punchAlertSettingQuery(CO, api).queryFn())
    await expectSharedMapping((api) => punchAlertOptionsQuery(CO, api).queryFn())
    await expectSharedMapping((api) => savePunchAlertSettingMutation(qc, CO, api).mutationFn({ notifyManager: true, employeeIds: [], roleIds: [], alertOn: 'ALL' }))
  })

  it('sums up who is told', () => {
    expect(punchAlertSummary(SETTING)).toBe('Reporting manager · 1 person · 1 role · every punch-in')
    expect(punchAlertSummary({ notifyManager: false, people: [1, 2], roles: [], alertOn: 'LATE_OR_OUTSIDE' }))
      .toBe('2 people · late or outside-office punch-ins only')
    expect(punchAlertSummary({ notifyManager: false, people: [], roles: [], alertOn: 'ALL' })).toBe('Nobody · every punch-in')
  })
})
