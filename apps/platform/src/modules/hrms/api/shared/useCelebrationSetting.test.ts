import { describe, expect, it } from 'vitest'
import { celebrationSettingQuery, saveCelebrationSettingMutation } from './useCelebrationSetting'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const SETTING = { companyId: CO, showBirthdays: false, updatedByName: 'HR Manager', updatedAt: '2026-10-05T05:00:00Z' }

describe('useCelebrationSetting (show birthdays to colleagues, V143_89)', () => {
  it('reads the company’s setting', async () => {
    const { api, calls } = fakeApi(() => SETTING)
    const q = celebrationSettingQuery(CO, api)
    expect(q.queryKey).toEqual(['settings', 'celebrations', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: SETTING })
    expect(calls[0]).toEqual({ path: `/v1/settings/celebrations?companyId=${CO}`, method: 'GET', body: undefined })
  })

  it('saves with PUT, shows the answer at once and refreshes everyone’s celebrations', async () => {
    const { api, calls } = fakeApi(() => SETTING)
    const { qc, invalidated } = spyQueryClient()
    const m = saveCelebrationSettingMutation(qc, CO, api)
    const r = await m.mutationFn({ showBirthdays: false })
    expect(calls[0]).toEqual({ path: `/v1/settings/celebrations?companyId=${CO}`, method: 'PUT', body: { showBirthdays: false } })
    await m.onSuccess?.(r, { showBirthdays: false })
    expect(qc.getQueryData(['settings', 'celebrations', CO])).toEqual({ available: true, value: SETTING })
    expect(invalidated).toContainEqual(['ess'])
  })

  it('is not available while the table is missing', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => celebrationSettingQuery(CO, api).queryFn())
    await expectSharedMapping((api) => saveCelebrationSettingMutation(qc, CO, api).mutationFn({ showBirthdays: true }))
  })
})
