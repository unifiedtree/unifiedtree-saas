// Approvals parity with the phone app: each new kind is decided through its own page's endpoint, with the
// same body; "Approve N with no warnings" takes them one by one like expense claims (leave still in bulk).
// Rendered as markup (the repo has no DOM test environment); the hooks are captured from the render.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxRow } from '../api/shared/contracts'

const calls: { path: string; body: unknown }[] = []
vi.mock('@/core/api/client', async () => ({
  ...(await vi.importActual<object>('@/core/api/client')),
  apiJson: async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path === '/v1/leave/approvals/bulk-decision') return { results: [{ id: 'l1', ok: true }] }
    return {}
  },
}))

import { useTeamDecisions } from './useTeamDecisions'

let hook: ReturnType<typeof useTeamDecisions>
function Probe() { hook = useTeamDecisions(); return null }
beforeEach(() => {
  calls.length = 0
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>)
})

const row = (kind: InboxRow['kind'], requestId: string) => ({ kind, requestId, employeeName: 'Asha Rao' }) as InboxRow

describe('useTeamDecisions: the kinds the app added to Approvals', () => {
  it('sends leave waiting for HR to the second-level decision', async () => {
    await hook.decide('LEAVE_L2', 'l2', false, ' Team is short ')
    expect(calls).toEqual([{ path: '/v1/leave/l2/l2-decision', body: { status: 'REJECTED', comment: 'Team is short' } }])
  })

  it('sends an advance to the advance decision', async () => {
    await hook.decide('ADVANCE', 'a1', true, '')
    expect(calls).toEqual([{ path: '/v1/advance/requests/a1/decision', body: { approved: true } }])
  })

  it('sends overtime to approve / reject with the note', async () => {
    await hook.decide('OVERTIME', 'o1', false, 'Not agreed')
    await hook.decide('OVERTIME_REQUEST', 'q1', true, '')
    expect(calls).toEqual([
      { path: '/v1/attendance/overtime/o1/reject', body: { note: 'Not agreed' } },
      { path: '/v1/attendance/overtime/requests/q1/approve', body: { note: '' } },
    ])
  })

  it('sends a skill level to the skill decision', async () => {
    await hook.decide('SKILL', 's1', false, 'Show the project first')
    expect(calls).toEqual([{ path: '/v1/learning/skill-assessments/s1/decide', body: { decision: 'REJECTED', note: 'Show the project first' } }])
  })

  it('"Approve N with no warnings" takes leave in bulk and the new kinds one by one', async () => {
    const report = await hook.approveAll([row('LEAVE', 'l1'), row('LEAVE_L2', 'l2'), row('ADVANCE', 'a1'), row('OVERTIME', 'o1'), row('SKILL', 's1')])
    expect(report).toEqual({ approved: 5, failed: [] })
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/leave/approvals/bulk-decision',
      '/v1/leave/l2/l2-decision',
      '/v1/advance/requests/a1/decision',
      '/v1/attendance/overtime/o1/approve',
      '/v1/learning/skill-assessments/s1/decide',
    ])
    expect(calls[0].body).toEqual({ ids: ['l1'], status: 'APPROVED' })
  })
})
