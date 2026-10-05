// The bell's two tabs (F-21): Notifications and Messages (Team messages sent to you), as the app's
// Alerts. Rendered as markup (no DOM test environment): the popover is drawn in place.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TeamMessage } from '@/modules/hrms/api/shared/contracts'

const messages = { current: { data: undefined as TeamMessage[] | undefined, notAvailable: false, isLoading: false, isFetching: false, error: null as unknown, refetch: () => Promise.resolve() } }
vi.mock('@/modules/hrms/api/shared/useTeamMessages', () => ({ useTeamMessages: () => messages.current }))
vi.mock('@/design/kit/overlays', async () => ({
  ...(await vi.importActual<object>('@/design/kit/overlays')),
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog" aria-label="Notifications">{children}</div> : null),
}))

import { NotificationBell } from './NotificationBell'
import { TeamMessagesList } from './TeamMessagesList'
import { useNotificationStore } from '@/core/notifications/notificationStore'

const NOW = new Date('2026-10-06T10:00:00+05:30')
const MINUTES_AGO = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()
const msg = (o: Partial<TeamMessage> = {}): TeamMessage => ({
  id: 'm1', body: 'Stand-up moves to 10:30 tomorrow.', senderEmployeeId: 'e1', senderName: 'Priya Rao', teamLabel: 'Engineering',
  createdAt: MINUTES_AGO(5), recipientCount: null, ...o,
})
const bell = (open = true) => renderToStaticMarkup(<NotificationBell open={open} onToggle={() => {}} onClose={() => {}} onNavigate={() => {}} />)

beforeEach(() => {
  messages.current = { data: [msg()], notAvailable: false, isLoading: false, isFetching: false, error: null, refetch: () => Promise.resolve() }
  useNotificationStore.setState({ notifications: [], loading: false, loaded: true, error: null })
})

describe('NotificationBell tabs', () => {
  it('shows Notifications and Messages, Notifications first', () => {
    const s = bell()
    expect(s).toContain('role="tablist" aria-label="Alerts"')
    expect(s).toMatch(/role="tab" aria-selected="true"[^>]*>Notifications/)
    expect(s).toMatch(/role="tab" aria-selected="false"[^>]*>Messages/)
    expect(s).toContain('You’re all caught up')
    expect(s).toContain('Last 7 days and all unread')
    expect(s).toContain('class="ut-bellpop__heading">Alerts<')
  })

  it('leaves Messages out when the server has no Team messages', () => {
    messages.current = { ...messages.current, data: undefined, notAvailable: true }
    const s = bell()
    expect(s).not.toContain('role="tablist"')
    expect(s).not.toContain('Messages')
    expect(s).toContain('class="ut-bellpop__heading">Notifications<')
    expect(s).toContain('You’re all caught up')
  })

  it('keeps the bell button as it was', () => {
    const s = bell(false)
    expect(s).toContain('aria-label="Notifications"')
    expect(s).not.toContain('role="tablist"')
  })
})

describe('TeamMessagesList', () => {
  const list = (p: Partial<Parameters<typeof TeamMessagesList>[0]>) =>
    renderToStaticMarkup(<TeamMessagesList messages={undefined} loading={false} error={null} onRetry={() => {}} now={NOW} {...p} />)

  it('lists each message: who, when, the team and the whole text', () => {
    const s = list({ messages: [msg(), msg({ id: 'm2', senderName: 'Arjun', teamLabel: null, body: 'Line one\nLine two', createdAt: '2026-10-01T09:00:00+05:30' })] })
    expect(s).toContain('data-testid="team-message-list"')
    expect(s).toContain('Priya Rao')
    expect(s).toContain('5 min ago')
    expect(s).toContain('To Engineering')
    expect(s).toContain('Stand-up moves to 10:30 tomorrow.')
    expect(s).toContain('Line one\nLine two')
    expect(s.match(/To /g)?.length).toBe(1)
    expect(s).toContain('PR')
  })

  it('loading, empty and error states', () => {
    expect(list({ loading: true })).toContain('Loading team messages')
    expect(list({ messages: [] })).toContain('No team messages')
    expect(list({ messages: [] })).toContain('it shows up here for 30 days')
    const err = list({ error: new Error('Network down') })
    expect(err).toContain('Couldn’t load your team messages')
    expect(err).toContain('Try again')
  })
})
