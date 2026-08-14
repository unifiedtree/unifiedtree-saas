import { create } from 'zustand'
import type { Notification } from '@/types'
import { apiJson } from '@/core/api/client'

/**
 * Web notification store — mirrors the mobile app's notification screen
 * against the same {@code /v1/notifications} endpoints served by
 * {@code com.unifiedtree.notifications.controller.NotificationsController}.
 *
 * Previously this file held a hard-coded MOCK_NOTIFICATIONS array so the bell
 * always showed 4 "unread" fake alerts and clicking them did nothing useful.
 * Now it fetches the signed-in user's real, tenant-scoped notifications and
 * mirrors read/dismiss actions to the server so read-state stays in sync with
 * the mobile bell.
 */

/** Server enum — must stay in lock-step with
 *  {@code com.unifiedtree.notifications.enums.AppNotificationType}. */
export type AppNotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'FACE_ENROLLMENT_COMPLETE'
  | 'FACE_ENROLLMENT_FAILED'
  | 'WFH_SUBMITTED'
  | 'WFH_APPROVED'
  | 'WFH_REJECTED'
  | 'WFH_CANCELLED'
  | 'CORRECTION_SUBMITTED'
  | 'CORRECTION_APPROVED'
  | 'CORRECTION_REJECTED'
  | 'SHIFT_CHANGE_SUBMITTED'
  | 'SHIFT_CHANGE_APPROVED'
  | 'SHIFT_CHANGE_REJECTED'
  | 'WELCOME'
  | 'TRIAL_ENDING_SOON'
  | 'TRIAL_EXPIRED'
  | 'SUBSCRIPTION_HALTED'
  | 'GENERAL'

/** Raw server DTO (see {@code NotificationDtos.NotificationDto}). */
interface ServerNotificationDto {
  id: string
  type: AppNotificationType
  title: string
  body: string
  data?: Record<string, unknown> | null
  readAt?: string | null
  createdAt: string
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

/**
 * Sensible web fallback route by category. The mobile app carries an explicit
 * {@code data.route} in every notification, but that route uses Expo Router
 * segments (e.g. {@code /leaves/[id]}) that don't exist on the web SPA. This
 * table maps by category prefix; the sender's route is preferred if it looks
 * web-shaped (starts with "/" and isn't a mobile-only segment).
 */
function webRouteFor(type: AppNotificationType, data?: Record<string, unknown> | null): string | undefined {
  const raw = typeof data?.route === 'string' ? (data.route as string) : undefined
  // Mobile routes use bracket segments — {@code /leaves/[id]} — never used on web.
  const isMobileShaped = raw ? raw.includes('[') || raw.includes(']') : false
  if (raw && !isMobileShaped) return raw

  if (type.startsWith('LEAVE_')) return '/me/leaves'
  if (type.startsWith('WFH_')) return '/me/wfh'
  if (type.startsWith('CORRECTION_')) return '/me/correction'
  if (type.startsWith('SHIFT_CHANGE_')) return '/me/shift-change'
  if (type === 'FACE_ENROLLMENT_COMPLETE' || type === 'FACE_ENROLLMENT_FAILED') return '/me/profile'
  if (type === 'TRIAL_ENDING_SOON' || type === 'TRIAL_EXPIRED' || type === 'SUBSCRIPTION_HALTED') return '/settings/billing'
  if (type === 'WELCOME') return '/'
  return undefined
}

/** Severity used by NotificationPanel for icon + tone. */
function severityFor(type: AppNotificationType): Notification['type'] {
  if (type.endsWith('_APPROVED') || type === 'FACE_ENROLLMENT_COMPLETE' || type === 'WELCOME') return 'success'
  if (type.endsWith('_REJECTED') || type === 'FACE_ENROLLMENT_FAILED' || type === 'TRIAL_EXPIRED' || type === 'SUBSCRIPTION_HALTED')
    return 'error'
  if (type.endsWith('_SUBMITTED') || type === 'TRIAL_ENDING_SOON') return 'warning'
  return 'info'
}

function toDisplay(dto: ServerNotificationDto): Notification {
  return {
    id: dto.id,
    title: dto.title,
    message: dto.body,
    type: severityFor(dto.type),
    isRead: dto.readAt != null,
    createdAt: dto.createdAt,
    link: webRouteFor(dto.type, dto.data),
  }
}

interface NotificationState {
  notifications: Notification[]
  loading: boolean
  loaded: boolean
  error: string | null
  fetch: () => Promise<void>
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

  fetch: async () => {
    set({ loading: true, error: null })
    try {
      // size=50 keeps the bell useful without paying full-history cost on every open.
      const page = await apiJson<PageResponse<ServerNotificationDto>>('/v1/notifications?page=0&size=50')
      set({
        notifications: (page.content ?? []).map(toDisplay),
        loading: false,
        loaded: true,
        error: null,
      })
    } catch (e) {
      // Silent-fail the bell — a notifications endpoint hiccup must never
      // block the rest of the SPA, and the panel already renders an empty
      // state. Keep the message for debug/test surfaces.
      set({ loading: false, loaded: true, error: (e as Error).message })
    }
  },

  markAsRead: async (id) => {
    // Optimistic update — the bell is user-facing latency-sensitive.
    const before = get().notifications
    set({
      notifications: before.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    })
    try {
      await apiJson<void>(`/v1/notifications/${id}/read`, { method: 'PUT' })
    } catch {
      // Revert on failure so unread badge stays honest.
      set({ notifications: before })
    }
  },

  markAllAsRead: async () => {
    const before = get().notifications
    set({ notifications: before.map((n) => ({ ...n, isRead: true })) })
    try {
      await apiJson<void>('/v1/notifications/mark-all-read', { method: 'POST' })
    } catch {
      set({ notifications: before })
    }
  },

  removeNotification: async (id) => {
    const before = get().notifications
    set({ notifications: before.filter((n) => n.id !== id) })
    try {
      await apiJson<void>(`/v1/notifications/${id}`, { method: 'DELETE' })
    } catch {
      set({ notifications: before })
    }
  },

  unreadCount: () => get().notifications.filter((n) => !n.isRead).length,

  reset: () => set({ notifications: [], loading: false, loaded: false, error: null }),
}))
