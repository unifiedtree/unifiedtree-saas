import { describe, expect, it } from 'vitest'
import { MAX_PICKED_QUICK_ACTIONS, recordQuickActionUse, saveQuickActionsMutation, uiPrefsQuery } from './useUiPrefs'
import type { QuickActionPrefs } from './contracts'
import { answers, expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const prefs: QuickActionPrefs = { available: true, picked: ['leave', 'pay'], month: '2026-09', uses: { leave: 41, pay: 3 } }

describe('useUiPrefs (BW-112)', () => {
  it('reads one surface\'s prefs', async () => {
    const { api, calls } = fakeApi(() => prefs)
    const q = uiPrefsQuery('home', api)
    expect(q.queryKey).toEqual(['me', 'quick-actions', 'home'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: prefs })
    expect(calls[0]).toEqual({ path: '/v1/me/dashboard/quick-actions?surface=home', method: 'GET', body: undefined })
  })

  it('treats the server\'s { available: false } (table missing) as not available', async () => {
    const { api } = fakeApi(() => ({ available: false, picked: null, month: '2026-09', uses: {} }))
    await expect(uiPrefsQuery('dashboard', api).queryFn()).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_READY' })
  })

  it('saves the picks with PUT and shows the saved answer at once', async () => {
    expect(MAX_PICKED_QUICK_ACTIONS).toBe(6)
    const { api, calls } = fakeApi(() => prefs)
    const { qc, invalidated } = spyQueryClient()
    const m = saveQuickActionsMutation(qc, 'dashboard', api)
    const r = await m.mutationFn({ picked: ['leave', 'pay'] })
    expect(calls[0]).toEqual({ path: '/v1/me/dashboard/quick-actions?surface=dashboard', method: 'PUT', body: { picked: ['leave', 'pay'] } })
    await m.onSuccess?.(r, { picked: ['leave', 'pay'] })
    expect(qc.getQueryData(['me', 'quick-actions', 'dashboard'])).toEqual({ available: true, value: prefs })
    expect(invalidated).toEqual([])
    await m.mutationFn({ picked: null })
    expect(calls[1].body).toEqual({ picked: null })
  })

  it('a save while the table is missing is not available, and refreshes the prefs', async () => {
    const { qc, invalidated } = spyQueryClient()
    const m = saveQuickActionsMutation(qc, 'home', fakeApi(() => { throw answers.notReady() }).api)
    const r = await m.mutationFn({ picked: ['leave'] })
    expect(r).toEqual({ available: false, reason: 'FEATURE_NOT_READY' })
    await m.onSuccess?.(r, { picked: ['leave'] })
    expect(invalidated).toEqual([['me', 'quick-actions', 'home']])
    await expectSharedMapping((api) => saveQuickActionsMutation(qc, 'home', api).mutationFn({ picked: null }))
  })

  it('records a use and never rejects', async () => {
    const { api, calls } = fakeApi(() => null)
    await expect(recordQuickActionUse('dashboard', 'leave', api)).resolves.toBe(true)
    expect(calls[0]).toEqual({ path: '/v1/me/dashboard/quick-actions/leave/use?surface=dashboard', method: 'POST', body: undefined })
    await expect(recordQuickActionUse('home', 'pay', fakeApi(() => { throw answers.serverError() }).api)).resolves.toBe(false)
    await expect(recordQuickActionUse('home', 'pay', fakeApi(() => { throw answers.notReady() }).api)).resolves.toBe(false)
  })
})
