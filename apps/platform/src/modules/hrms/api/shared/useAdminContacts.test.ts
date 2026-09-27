import { describe, expect, it } from 'vitest'
import { adminContactsQuery } from './useAdminContacts'
import type { AdminContact } from './contracts'
import { expectSharedMapping, fakeApi } from './testing'

describe('useAdminContacts (BW-01)', () => {
  it('reads the workspace\'s admins to contact', async () => {
    const contacts: AdminContact[] = [
      { name: 'Owner Person', email: 'owner@unifiedtree.demo', roleLabel: 'Owner' },
      { name: 'HR Lead', email: 'hr@unifiedtree.demo', roleLabel: 'HR manager' },
    ]
    const { api, calls } = fakeApi(() => contacts)
    const q = adminContactsQuery(api)
    expect(q.queryKey).toEqual(['workspace', 'admin-contacts'])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: contacts })
    expect(calls[0]).toEqual({ path: '/v1/workspace/admin-contacts', method: 'GET', body: undefined })
  })

  it('is not available until F3b ships it (the panel shows its empty state)', async () => {
    await expectSharedMapping((api) => adminContactsQuery(api).queryFn())
  })
})
