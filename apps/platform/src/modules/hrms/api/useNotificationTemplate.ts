import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.notiftemplate.enums.NotificationChannel
export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP'

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['EMAIL', 'SMS', 'PUSH', 'IN_APP']

export interface NotificationTemplate {
  id: string
  companyId: string
  name: string
  channel: NotificationChannel
  eventKey: string
  subject?: string
  body?: string
  active: boolean
  createdAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export interface NotificationTemplatePayload {
  companyId?: string
  name: string
  channel: NotificationChannel
  eventKey: string
  subject?: string
  body: string
  active?: boolean
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useNotificationTemplates(companyId: string | undefined, page = 0) {
  return useQuery({
    queryKey: ['hrms', 'notiftemplate', 'list', companyId, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<NotificationTemplate>>(`/v1/notiftemplate/templates?${params.toString()}`)
    },
    staleTime: 30_000,
  })
}

export function useNotificationTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'notiftemplate', 'one', id],
    queryFn: () => apiJson<NotificationTemplate>(`/v1/notiftemplate/templates/${id}`),
    enabled: !!id,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: NotificationTemplatePayload) =>
      apiJson<NotificationTemplate>('/v1/notiftemplate/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'notiftemplate'] }),
  })
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: NotificationTemplatePayload & { id: string }) =>
      apiJson<NotificationTemplate>(`/v1/notiftemplate/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'notiftemplate'] }),
  })
}

export function useDeleteNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/notiftemplate/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'notiftemplate'] }),
  })
}
