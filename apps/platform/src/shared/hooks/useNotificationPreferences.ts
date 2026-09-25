// The signed-in person's notification choices (GET/PUT /v1/me/notification-preferences).
// Master switches for email and phone push, and per event whether it reaches
// them in the app (the bell), on their phone and by email. Always-sent events
// (password reset, invitation, billing, letters HR sends) come back with
// `essential: true` and can't be switched off.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { CURRENT_USER_KEY } from './useCurrentUser'

export type DeliveryChannel = 'IN_APP' | 'PUSH' | 'EMAIL'

export interface NotificationEventChoice {
  key: string
  group: string
  label: string
  audience: string
  description: string
  channels: DeliveryChannel[]
  essential: boolean
  /** null when the event isn't sent on that channel */
  inApp: boolean | null
  push: boolean | null
  email: boolean | null
}

export interface NotificationPreferences {
  emailEnabled: boolean
  pushEnabled: boolean
  events: NotificationEventChoice[]
}

export type ChannelField = 'inApp' | 'push' | 'email'

export interface NotificationPreferencesPatch {
  emailEnabled?: boolean
  pushEnabled?: boolean
  events?: Record<string, Partial<Record<ChannelField, boolean>>>
}

export const NOTIFICATION_PREFS_KEY = ['me', 'notification-preferences'] as const

export function useNotificationPreferences(enabled = true) {
  return useQuery({
    queryKey: NOTIFICATION_PREFS_KEY,
    queryFn: () => apiJson<NotificationPreferences>('/v1/me/notification-preferences'),
    staleTime: 30_000,
    enabled,
  })
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: NotificationPreferencesPatch) =>
      apiJson<NotificationPreferences>('/v1/me/notification-preferences', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: (fresh) => {
      qc.setQueryData(NOTIFICATION_PREFS_KEY, fresh)
      // The Profile page reads the master switches from /v1/users/me.
      qc.invalidateQueries({ queryKey: CURRENT_USER_KEY })
    },
  })
}
