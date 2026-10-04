import { beforeEach, describe, expect, it, vi } from 'vitest'

// The bell's badge counts every unread notification, so the list must hold every unread one too,
// however old: an employee whose 3 unread were older than 7 days saw "3 new" over "all caught up".

const apiJson = vi.fn()

vi.mock('@/core/api/client', () => ({
  apiJson: (path: string, init?: RequestInit) => apiJson(path, init),
}))

const { useNotificationStore, mergeNewestFirst } = await import('./notificationStore')
const { bellRows } = await import('./notificationRoutes')

const dto = (id: string, createdAt: string, readAt: string | null = null) => ({
  id, type: 'LEAVE_APPROVED' as const, title: `Notification ${id}`, body: '', data: null, readAt, createdAt, group: 'Leave',
})

describe('the bell list', () => {
  beforeEach(() => {
    apiJson.mockReset()
    useNotificationStore.getState().reset()
  })

  it('asks for the last 7 days and for everything unread, and lists each notification once, newest first', async () => {
    const recent = [dto('r2', '2026-10-04T09:00:00Z', '2026-10-04T10:00:00Z'), dto('r1', '2026-10-03T09:00:00Z')]
    const unread = [dto('r1', '2026-10-03T09:00:00Z'), dto('old2', '2026-09-24T09:00:00Z'), dto('old1', '2026-09-08T09:00:00Z')]
    apiJson.mockImplementation(async (path: string) => {
      if (path.includes('unread-count')) return { count: 3 }
      if (path.includes('unreadOnly=true')) return { content: unread }
      if (path.includes('since=')) return { content: recent }
      throw new Error(`unexpected ${path}`)
    })

    await useNotificationStore.getState().fetch()

    const paths = apiJson.mock.calls.map((c) => String(c[0]))
    expect(paths.some((p) => p.includes('since=') && !p.includes('unreadOnly'))).toBe(true)
    expect(paths.some((p) => p.includes('unreadOnly=true') && !p.includes('since='))).toBe(true)
    const s = useNotificationStore.getState()
    expect(s.notifications.map((n) => n.id)).toEqual(['r2', 'r1', 'old2', 'old1'])
    expect(s.error).toBeNull()
  })

  it('shows the unread ones older than 7 days in the popover', () => {
    const now = new Date('2026-10-05T12:00:00Z')
    const rows = [
      { id: 'a', createdAt: '2026-10-04T09:00:00Z', isRead: true },
      { id: 'b', createdAt: '2026-09-24T09:00:00Z', isRead: false },
      { id: 'c', createdAt: '2026-09-20T09:00:00Z', isRead: true },
      { id: 'd', createdAt: '2026-09-08T09:00:00Z', isRead: false },
    ]
    expect(bellRows(rows, now).map((r) => r.id)).toEqual(['a', 'b', 'd'])
  })

  it('never drops an unread row to make room, and fills up with read ones from the last 7 days', () => {
    const now = new Date('2026-10-05T12:00:00Z')
    const read = Array.from({ length: 10 }, (_, i) => ({ id: `read${i}`, createdAt: `2026-10-0${(i % 4) + 1}T0${i % 10}:00:00Z`, isRead: true }))
    const old = { id: 'old', createdAt: '2026-09-01T09:00:00Z', isRead: false }
    const rows = bellRows([...read, old], now, 8)
    expect(rows).toHaveLength(8)
    expect(rows[rows.length - 1].id).toBe('old')
    expect(rows.filter((r) => r.isRead)).toHaveLength(7)
  })

  it('merges without duplicates and keeps the newest first', () => {
    const merged = mergeNewestFirst([dto('x', '2026-10-01T00:00:00Z')], [dto('y', '2026-10-02T00:00:00Z'), dto('x', '2026-10-01T00:00:00Z')])
    expect(merged.map((n) => n.id)).toEqual(['y', 'x'])
  })
})
