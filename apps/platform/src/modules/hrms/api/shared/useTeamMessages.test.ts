import { describe, expect, it } from 'vitest'
import { postTeamMessageMutation, sentTeamMessagesQuery, teamMessagesToMeQuery, TEAM_MESSAGE_MAX_LENGTH } from './useTeamMessages'
import type { TeamMessage } from './contracts'
import { expectSharedMapping, fakeApi, spyQueryClient } from './testing'

const message: TeamMessage = {
  id: 'm-1', body: 'Stand-up moves to 10:30 tomorrow.', senderEmployeeId: 'e-9', senderName: 'Dept Manager',
  teamLabel: 'Engineering', createdAt: '2026-09-27T04:00:00Z', recipientCount: null,
}

describe('useTeamMessages (BW-12)', () => {
  it('reads messages sent to me for the last N days (30 by default)', async () => {
    const { api, calls } = fakeApi(() => [message])
    const q = teamMessagesToMeQuery(undefined, api)
    expect(q.queryKey).toEqual(['team', 'messages', 'mine', 30])
    await expect(q.queryFn()).resolves.toEqual({ available: true, value: [message] })
    expect(calls[0].path).toBe('/v1/team/messages/mine?days=30')
  })

  it('reads the messages I sent', async () => {
    const { api, calls } = fakeApi(() => [{ ...message, recipientCount: 8 }])
    const q = sentTeamMessagesQuery(api)
    expect(q.queryKey).toEqual(['team', 'messages', 'sent'])
    await q.queryFn()
    expect(calls[0].path).toBe('/v1/team/messages/sent')
  })

  it('posts { body } and refreshes both lists', async () => {
    expect(TEAM_MESSAGE_MAX_LENGTH).toBe(500)
    const { api, calls } = fakeApi(() => ({ ...message, recipientCount: 8 }))
    const { qc, invalidated } = spyQueryClient()
    const m = postTeamMessageMutation(qc, api)
    const r = await m.mutationFn({ body: message.body })
    expect(calls[0]).toEqual({ path: '/v1/team/messages', method: 'POST', body: { body: message.body } })
    await m.onSuccess?.(r, { body: message.body })
    expect(invalidated).toEqual([['team', 'messages']])
  })

  it('is not available while its tables are missing', async () => {
    const { qc } = spyQueryClient()
    await expectSharedMapping((api) => teamMessagesToMeQuery(7, api).queryFn())
    await expectSharedMapping((api) => sentTeamMessagesQuery(api).queryFn())
    await expectSharedMapping((api) => postTeamMessageMutation(qc, api).mutationFn({ body: 'Hi' }))
  })
})
