import { describe, expect, it } from 'vitest'
import { approversQuery } from './useApprovers'
import type { ApproverFor, ApproverPreview } from './contracts'
import { expectSharedMapping, fakeApi } from './testing'

describe('useApprovers (BW-122)', () => {
  it('asks who a request of each kind goes to', async () => {
    const preview: ApproverPreview = {
      for: 'leave',
      approver: { employeeId: 'e-9', name: 'Siddharth Rao', source: 'MANAGER', delegateForName: null },
    }
    const { api, calls } = fakeApi(() => preview)
    const q = approversQuery('leave', api)
    expect(q.queryKey).toEqual(['me', 'approvers', 'leave'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: preview })
    for (const kind of ['wfh', 'correction', 'shift'] as ApproverFor[]) await approversQuery(kind, api).queryFn()
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/me/approvers?for=leave', '/v1/me/approvers?for=wfh', '/v1/me/approvers?for=correction', '/v1/me/approvers?for=shift',
    ])
  })

  it('is not available until P-HOME ships it', async () => {
    await expectSharedMapping((api) => approversQuery('wfh', api).queryFn())
  })
})
