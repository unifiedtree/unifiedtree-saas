import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Notification,
  NotificationStats,
  PaginatedResponse,
  ApiResponse,
  PaginationParams,
  FilterParams,
  NotificationType,
  NotificationPriority,
} from '@erp/types'
import { useApi } from '../context/ApiContext'

type NotificationFilters = PaginationParams &
  FilterParams & {
    type?: NotificationType
    priority?: NotificationPriority
    isRead?: boolean
  }

const QUERY_KEYS = {
  all: (userId: string, tenantId: string) => ['notifications', userId, tenantId] as const,
  list: (userId: string, tenantId: string, params: NotificationFilters) =>
    ['notifications', userId, tenantId, 'list', params] as const,
  unreadCount: (userId: string, tenantId: string) =>
    ['notifications', userId, tenantId, 'unread-count'] as const,
  stats: (userId: string, tenantId: string) =>
    ['notifications', userId, tenantId, 'stats'] as const,
}

export function useNotifications(
  userId: string,
  tenantId: string,
  params: NotificationFilters = {}
) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.list(userId, tenantId, params),
    queryFn: () =>
      client.get<ApiResponse<PaginatedResponse<Notification>>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications`,
        params
      ),
    enabled: Boolean(userId) && Boolean(tenantId),
  })
}

export function useUnreadCount(userId: string, tenantId: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.unreadCount(userId, tenantId),
    queryFn: () =>
      client.get<ApiResponse<{ count: number }>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications/unread-count`
      ),
    enabled: Boolean(userId) && Boolean(tenantId),
    refetchInterval: 30_000, // Poll every 30 seconds
  })
}

export function useNotificationStats(userId: string, tenantId: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.stats(userId, tenantId),
    queryFn: () =>
      client.get<ApiResponse<NotificationStats>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications/stats`
      ),
    enabled: Boolean(userId) && Boolean(tenantId),
  })
}

export function useMarkAsRead(userId: string, tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: string) =>
      client.patch<ApiResponse<Notification>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications/${notificationId}/read`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(userId, tenantId) })
    },
  })
}

export function useMarkAllRead(userId: string, tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      client.post<ApiResponse<null>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications/mark-all-read`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(userId, tenantId) })
    },
  })
}

export function useDismissNotification(userId: string, tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: string) =>
      client.delete<ApiResponse<null>>(
        `/api/v1/tenants/${tenantId}/users/${userId}/notifications/${notificationId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(userId, tenantId) })
    },
  })
}
