import { describe, expect, it } from 'vitest'
import { saveWebPunchSettingMutation, webPunchAllowed, webPunchSettingQuery } from './useWebPunchSetting'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

describe('useWebPunchSetting (BW-24)', () => {
  it('reads the company switch', async () => {
    const { api, calls } = fakeApi(() => ({ companyId: CO, allowWebPunch: false }))
    const q = webPunchSettingQuery(CO, api)
    expect(q.queryKey).toEqual(['attendance', 'web-punch-setting', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: { companyId: CO, allowWebPunch: false } })
    expect(calls[0]).toEqual({ path: `/v1/attendance/web-punch-setting?companyId=${CO}`, method: 'GET', body: undefined })
  })

  it('is on only when the company switched it on', () => {
    expect(webPunchAllowed({ data: { companyId: CO, allowWebPunch: true } })).toBe(true)
    expect(webPunchAllowed({ data: { companyId: CO, allowWebPunch: false } })).toBe(false)
    expect(webPunchAllowed({ data: undefined })).toBe(false) // loading, error or not available
  })

  it('saves with PUT, shows the answer at once and refreshes attendance ("Your day")', async () => {
    const { api, calls } = fakeApi(() => ({ companyId: CO, allowWebPunch: true }))
    const { qc, invalidated } = spyQueryClient()
    const m = saveWebPunchSettingMutation(qc, CO, api)
    const r = await m.mutationFn({ allowWebPunch: true })
    expect(calls[0]).toEqual({ path: `/v1/attendance/web-punch-setting?companyId=${CO}`, method: 'PUT', body: { allowWebPunch: true } })
    await m.onSuccess?.(r, { allowWebPunch: true })
    expect(qc.getQueryData(['attendance', 'web-punch-setting', CO])).toEqual({ available: true, value: { companyId: CO, allowWebPunch: true } })
    expect(invalidated).toEqual([['hrms', 'attendance']])
  })

  it('is not available while the column is missing', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => webPunchSettingQuery(CO, api).queryFn())
    await expectSharedMapping((api) => saveWebPunchSettingMutation(qc, CO, api).mutationFn({ allowWebPunch: true }))
  })
})
