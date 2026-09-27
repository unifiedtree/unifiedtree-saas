import { describe, expect, it } from 'vitest'
import { remindersQuery, sendRemindersMutation } from './useReminders'
import type { ReminderResult, SentReminder } from './contracts'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

describe('useReminders (BW-10)', () => {
  it('reads the day\'s reminders by date', async () => {
    const sent: SentReminder[] = [{ employeeId: 'e-1', reason: 'NOT_CHECKED_IN', sentAt: '2026-09-28T04:30:00Z', sentByName: 'Dept Manager' }]
    const { api, calls } = fakeApi(() => sent)
    const q = remindersQuery('2026-09-28', api)
    expect(q.queryKey).toEqual(['hrms', 'attendance', 'reminders', '2026-09-28'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: sent })
    expect(calls[0]).toEqual({ path: '/v1/attendance/reminders?date=2026-09-28', method: 'GET', body: undefined })
  })

  it('sends { date, reason, employeeIds } and refreshes that day', async () => {
    const results: ReminderResult[] = [
      { employeeId: 'e-1', outcome: 'SENT', message: null },
      { employeeId: 'e-2', outcome: 'ALREADY_SENT', message: null },
    ]
    const { api, calls } = fakeApi(() => results)
    const { qc, invalidated } = spyQueryClient()
    const m = sendRemindersMutation(qc, api)
    const vars = { date: '2026-09-28', reason: 'NOT_CHECKED_IN' as const, employeeIds: ['e-1', 'e-2'] }
    const r = await m.mutationFn(vars)
    expect(r).toEqual({ available: true, value: results })
    expect(calls[0]).toEqual({ path: '/v1/attendance/reminders', method: 'POST', body: vars })
    await m.onSuccess?.(r, vars)
    expect(invalidated).toEqual([['hrms', 'attendance', 'reminders', '2026-09-28']])
  })

  it('is not available until P-TEAM ships it', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => remindersQuery('2026-09-28', api).queryFn())
    await expectSharedMapping((api) => sendRemindersMutation(qc, api).mutationFn({ date: '2026-09-28', reason: 'NOT_CHECKED_IN', employeeIds: ['e-1'] }))
  })
})
