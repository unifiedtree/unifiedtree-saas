import { describe, expect, it } from 'vitest'
import { overtimeRulesQuery, saveOvertimeRulesMutation } from './useOvertimeRules'
import type { OvertimeRules } from './contracts'
import { answers, expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const rules: OvertimeRules = { companyId: CO, minimumMinutes: 60, minimumIsDefault: true, defaultMinimumMinutes: 60, monthlyCapMinutes: 2400, updatedByName: 'Owner', updatedAt: '2026-09-27T04:00:00Z' }

describe('useOvertimeRules (BW-29)', () => {
  it('reads one company\'s rules', async () => {
    const { api, calls } = fakeApi(() => rules)
    const q = overtimeRulesQuery(CO, api)
    expect(q.queryKey).toEqual(['attendance', 'overtime-rules', CO])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: rules })
    expect(calls[0]).toEqual({ path: `/v1/attendance/overtime-rules?companyId=${CO}`, method: 'GET', body: undefined })
  })

  it('saves with PUT, shows the answer at once and refreshes the Overtime list', async () => {
    const { api, calls } = fakeApi(() => rules)
    const { qc, invalidated } = spyQueryClient()
    const m = saveOvertimeRulesMutation(qc, CO, api)
    const body = { minimumMinutes: 90, monthlyCapMinutes: 2400 }
    const r = await m.mutationFn(body)
    expect(calls[0]).toEqual({ path: `/v1/attendance/overtime-rules?companyId=${CO}`, method: 'PUT', body })
    await m.onSuccess?.(r, body)
    expect(qc.getQueryData(['attendance', 'overtime-rules', CO])).toEqual({ available: true, value: rules })
    expect(invalidated).toEqual([['attendance', 'overtime']])
    await m.mutationFn({ minimumMinutes: null, monthlyCapMinutes: null })
    expect(calls[1].body).toEqual({ minimumMinutes: null, monthlyCapMinutes: null })
  })

  it('is not available while the table is missing; a bad value stays an error', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => overtimeRulesQuery(CO, api).queryFn())
    await expectSharedMapping((api) => saveOvertimeRulesMutation(qc, CO, api).mutationFn({ minimumMinutes: 30, monthlyCapMinutes: null }))
    const bad = answers.refused('VALIDATION_FAILED', 'Minutes can’t be negative.')
    await expect(saveOvertimeRulesMutation(qc, CO, fakeApi(() => { throw bad }).api).mutationFn({ minimumMinutes: -5, monthlyCapMinutes: null }))
      .rejects.toBe(bad)
  })
})
