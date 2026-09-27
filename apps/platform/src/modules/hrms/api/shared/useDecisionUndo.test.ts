import { describe, expect, it } from 'vitest'
import { decisionUndoMutation, undoPath, UNDO_REFRESH } from './useDecisionUndo'
import { recentDecisionsQuery } from './useRecentDecisions'
import type { DecisionKind, DecisionUndoResult, RecentDecision } from './contracts'
import { answers, expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const KINDS: DecisionKind[] = ['LEAVE', 'WFH', 'CORRECTION', 'SHIFT_CHANGE', 'EXPENSE']

describe('useDecisionUndo (BW-06)', () => {
  it('posts to each kind\'s own undo path, with no body', async () => {
    expect(KINDS.map((k) => undoPath(k, 'r-1'))).toEqual([
      '/v1/leave/r-1/decision/undo',
      '/v1/wfh/r-1/decision/undo',
      '/v1/attendance/corrections/r-1/decision/undo',
      '/v1/shifts/change-requests/r-1/decision/undo',
      '/v1/expense/claims/r-1/decision/undo',
    ])
    const result: DecisionUndoResult = { kind: 'LEAVE', requestId: 'r-1', status: 'PENDING', undoneAt: '2026-09-27T05:00:00Z', employeeName: 'Asha Rao' }
    const { api, calls } = fakeApi(() => result)
    const { qc } = spyQueryClient()
    await expect(decisionUndoMutation(qc, api).mutationFn({ kind: 'LEAVE', requestId: 'r-1' })).resolves.toEqual({ available: true, value: result })
    expect(calls).toEqual([{ path: '/v1/leave/r-1/decision/undo', method: 'POST', body: undefined }])
  })

  it('maps "not switched on" and "no journal row" to not available; a refusal stays an error', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => decisionUndoMutation(qc, api).mutationFn({ kind: 'EXPENSE', requestId: 'c-9' }))
    const refusal = answers.refused('UNDO_WINDOW_OVER', 'It’s been more than 10 minutes, so this can’t be undone.')
    await expect(decisionUndoMutation(qc, fakeApi(() => { throw refusal }).api).mutationFn({ kind: 'WFH', requestId: 'w-1' }))
      .rejects.toBe(refusal)
  })

  it('after an undo, refreshes what that kind\'s decide hook refreshes, plus team time off', async () => {
    for (const kind of KINDS) {
      const { qc, invalidated } = spyQueryClient()
      const m = decisionUndoMutation(qc)
      await m.onSuccess?.({ available: true, value: { kind, requestId: 'x', status: 'PENDING', undoneAt: '', employeeName: '' } }, { kind, requestId: 'x' })
      expect(invalidated).toEqual([...UNDO_REFRESH[kind], ['team', 'time-off']])
    }
    expect(UNDO_REFRESH.LEAVE).toContainEqual(['hrms', 'leave'])
    expect(UNDO_REFRESH.WFH).toEqual([['hrms', 'wfh'], ['hrms', 'leave']])
    expect(UNDO_REFRESH.CORRECTION).toEqual([['hrms', 'attendance']])
    expect(UNDO_REFRESH.SHIFT_CHANGE).toEqual([['shifts'], ['hrms', 'attendance'], ['team', 'schedule']])
    expect(UNDO_REFRESH.EXPENSE).toEqual([['hrms', 'expense']])
  })

  it('refreshes nothing of the module when not available, but always the Undo offers', async () => {
    const { qc, invalidated } = spyQueryClient()
    const m = decisionUndoMutation(qc)
    await m.onSuccess?.({ available: false, reason: 'FEATURE_NOT_READY' }, { kind: 'LEAVE', requestId: 'x' })
    expect(invalidated).toEqual([])
    await m.onSettled?.(undefined, answers.refused('UNDO_WINDOW_OVER', 'too late'), { kind: 'LEAVE', requestId: 'x' })
    expect(invalidated).toEqual([['approvals', 'recent-decisions'], ['team', 'approvals']])
  })
})

describe('useRecentDecisions (BW-06)', () => {
  it('GETs the caller\'s undoable decisions under the shared key', async () => {
    const rows: RecentDecision[] = [{
      id: 'j-1', kind: 'LEAVE', requestId: 'r-1', decision: 'APPROVED', employeeId: 'e-1', employeeName: 'Asha Rao',
      summary: 'Casual leave · 28–29 Sep', note: null, decidedAt: '2026-09-27T04:55:00Z', undoUntil: '2026-09-27T05:05:00Z',
    }]
    const { api, calls } = fakeApi(() => rows)
    const q = recentDecisionsQuery(api)
    expect(q.queryKey).toEqual(['approvals', 'recent-decisions'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: rows })
    expect(calls).toEqual([{ path: '/v1/approvals/recent-decisions', method: 'GET', body: undefined }])
  })

  it('is not available while the journal is missing', async () => {
    await expectSharedMapping((api) => recentDecisionsQuery(api).queryFn())
  })
})
