import { create } from 'zustand'
import type { Notification } from '@/types'
import { apiJson } from '@/core/api/client'
import { LAST_DAYS, groupFor, iconForGroup, mapUrlFor, severityFor, webRouteFor, type AppNotificationType } from './notificationRoutes'

export type { AppNotificationType } from './notificationRoutes'

/**
 * Web notification store — mirrors the mobile app's notification screen
 * against the same {@code /v1/notifications} endpoints served by
 * {@code com.unifiedtree.notifications.controller.NotificationsController}.
 *
 * It fetches the signed-in user's real, tenant-scoped notifications and
 * mirrors read/dismiss actions to the server so read-state stays in sync with
 * the mobile bell. Where each type opens, its module and its icon live in
 * notificationRoutes.ts (every type the server sends).
 */

/** Raw server DTO (see {@code NotificationDtos.NotificationDto}). */
interface ServerNotificationDto {
  id: string
  type: AppNotificationType
  title: string
  body: string
  data?: Record<string, unknown> | null
  readAt?: string | null
  createdAt: string
  /** The catalog's module ("Leave", "Payroll"…). Sent once the server has it (BW-05); taken from the type until then. */
  group?: string | null
}

interface PageResponse<T> {
  content: T[]
  totalElements?: number
  totalPages?: number
  page?: number
  size?: number
  first?: boolean
  last?: boolean
}

/** A notification as the bell shows it. */
export interface WebNotification extends Notification {
  /** The server type, e.g. LEAVE_SUBMITTED. */
  kind: string
  /** Module label ("Leave", "Expenses and advances"…). */
  group: string
  /** Icon name (design/dc icons) for the module. */
  icon: string
  /** A punch-in alert's Google Maps link (PUNCH_IN_ALERT), else null. */
  mapUrl: string | null
}

export function toDisplay(dto: ServerNotificationDto): WebNotification {
  const group = (typeof dto.group === 'string' && dto.group.trim()) || groupFor(dto.type)
  return {
    id: dto.id,
    title: dto.title,
    message: dto.body,
    type: severityFor(dto.type),
    isRead: dto.readAt != null,
    createdAt: dto.createdAt,
    link: webRouteFor(dto.type, dto.data),
    kind: dto.type,
    group,
    icon: iconForGroup(group),
    mapUrl: mapUrlFor(dto.type, dto.data),
  }
}

/** The bell's two pages (last 7 days, still unread) as one list: each notification once, newest first. */
export function mergeNewestFirst(...pages: ServerNotificationDto[][]): ServerNotificationDto[] {
  const byId = new Map<string, ServerNotificationDto>()
  for (const page of pages) for (const n of page) if (n?.id && !byId.has(n.id)) byId.set(n.id, n)
  const time = (n: ServerNotificationDto) => { const t = new Date(n.createdAt).getTime(); return Number.isNaN(t) ? 0 : t }
  return [...byId.values()].sort((a, b) => time(b) - time(a))
}

interface NotificationState {
  notifications: WebNotification[]
  loading: boolean
  loaded: boolean
  error: string | null
  /**
   * Authoritative unread count from the server. The visible list is capped
   * at 50 for the bell popover, so deriving unread from `notifications` gets
   * capped along with it — a workspace with 120 unread items shows "50 new".
   * `serverUnreadCount` is populated by {@link fetchUnreadCount} and refreshed
   * whenever we mutate read-state, so the bell badge stays truthful even
   * when the list is paginated.
   */
  serverUnreadCount: number | null
  fetch: () => Promise<void>
  fetchUnreadCount: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  removeNotification: (id: string) => Promise<void>
  unreadCount: () => number
  /**
   * Wipe all cached rows and reset load flags. Called on sign-out so a
   * subsequent sign-in as a different user does not briefly render the
   * previous user's notifications while the fresh /v1/notifications
   * request is in flight.
   */
  reset: () => void
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: [],
  loading: false,
  loaded: false,
  error: null,
  serverUnreadCount: null,

  fetch: async () => {
    set({ loading: true, error: null })
    try {
      // size=50 keeps the bell useful without paying full-history cost on every open. `since` asks only for
      // the bell's last 7 days (BW-05); a server without it ignores the parameter and the bell filters itself.
      // Anything still unread is listed too, however old: the badge counts every unread notification, so
      // one older than 7 days must be in the list to be read (otherwise "3 new" over "all caught up").
      const since = new Date(Date.now() - LAST_DAYS * 86_400_000).toISOString()
      const [recent, unread] = await Promise.all([
        apiJson<PageResponse<ServerNotificationDto>>(`/v1/notifications?page=0&size=50&since=${encodeURIComponent(since)}`),
        apiJson<PageResponse<ServerNotificationDto>>('/v1/notifications?page=0&size=50&unreadOnly=true'),
      ])
      set({
        notifications: mergeNewestFirst(recent.content ?? [], unread.content ?? []).map(toDisplay),
        loading: false,
        loaded: true,
        error: null,
      })
      // Refresh the truthful unread count alongside the list — fire-and-forget
      // so a slow count endpoint never blocks the bell rendering.
      void get().fetchUnreadCount()
    } catch (e) {
      // Silent-fail the bell — a notifications endpoint hiccup must never
      // block the rest of the SPA, and the panel already renders an empty
      // state. Keep the message for debug/test surfaces.
      set({ loading: false, loaded: true, error: (e as Error).message })
    }
  },

  fetchUnreadCount: async () => {
    try {
      // Server endpoint returns the untruncated count so the bell dot is
      // right even in workspaces with hundreds of unread items.
      const res = await apiJson<{ count: number }>('/v1/notifications/unread-count')
      const n = Number(res?.count ?? 0)
      set({ serverUnreadCount: Number.isFinite(n) && n >= 0 ? n : 0 })
    } catch {
      // Endpoint not yet wired on some deployments — leave serverUnreadCount
      // as null so the unreadCount() getter falls back to the derived value.
    }
  },

  markAsRead: async (id) => {
    // Optimistic update — the bell is user-facing latency-sensitive.
    const before = get().notifications
    set({
      notifications: before.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    })
    // Optimistically decrement the server count too (clamped at 0) so the
    // badge doesn't lag one refresh behind the visible list.
    const prevCount = get().serverUnreadCount
    if (prevCount != null && prevCount > 0 && before.find((n) => n.id === id && !n.isRead)) {
      set({ serverUnreadCount: prevCount - 1 })
    }
    try {
      await apiJson<void>(`/v1/notifications/${id}/read`, { method: 'PUT' })
    } catch {
      // Revert on failure so unread badge stays honest.
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  markAllAsRead: async () => {
    const before = get().notifications
    const prevCount = get().serverUnreadCount
    set({ notifications: before.map((n) => ({ ...n, isRead: true })), serverUnreadCount: 0 })
    try {
      await apiJson<void>('/v1/notifications/mark-all-read', { method: 'POST' })
    } catch {
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  removeNotification: async (id) => {
    const before = get().notifications
    const prevCount = get().serverUnreadCount
    set({ notifications: before.filter((n) => n.id !== id) })
    if (prevCount != null && prevCount > 0 && before.find((n) => n.id === id && !n.isRead)) {
      set({ serverUnreadCount: prevCount - 1 })
    }
    try {
      await apiJson<void>(`/v1/notifications/${id}`, { method: 'DELETE' })
    } catch {
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  // Prefer the server total when we have it — the derived count is capped
  // at the visible page size (50) which understates on active workspaces.
  unreadCount: () => {
    const server = get().serverUnreadCount
    if (server != null) return server
    return get().notifications.filter((n) => !n.isRead).length
  },

  reset: () => set({ notifications: [], loading: false, loaded: false, error: null, serverUnreadCount: null }),
}))
