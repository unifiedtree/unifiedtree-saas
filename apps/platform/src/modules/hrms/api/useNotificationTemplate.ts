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

/** One placeholder a template may use for an event. */
export interface NotificationPlaceholder { name: string; description: string; link: boolean }

/** Channels the senders deliver on (SMS isn't sent by anything). */
export type NotificationDeliveryChannel = 'IN_APP' | 'PUSH' | 'EMAIL'

/** An event the senders use (GET /v1/notiftemplate/events). */
export interface NotificationEvent {
  key: string
  /** Older spelling accepted for the key, e.g. LEAVE_APPROVED */
  alias: string | null
  group: string
  label: string
  audience: string
  description: string
  channels: NotificationDeliveryChannel[]
  /** Channels a template can be written for; empty = fixed wording */
  templateChannels: NotificationDeliveryChannel[]
  essential: boolean
  external: boolean
  placeholders: NotificationPlaceholder[]
  /** Built-in wording per template channel (subject is the title for in-app / push) */
  defaults: Partial<Record<NotificationDeliveryChannel, { subject: string | null; body: string | null }>>
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useNotificationEvents(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'notiftemplate', 'events'],
    queryFn: () => apiJson<NotificationEvent[]>('/v1/notiftemplate/events'),
    staleTime: 10 * 60_000,
    enabled,
  })
}

/** The event a stored key refers to (canonical key or its older alias), ignoring case. */
export function findNotificationEvent(events: NotificationEvent[] | undefined, key: string | undefined): NotificationEvent | undefined {
  if (!events || !key) return undefined
  const k = key.trim().toLowerCase()
  return events.find((e) => e.key === k || (e.alias ?? '').toLowerCase() === k)
}

export function useNotificationTemplates(companyId: string | undefined, page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'notiftemplate', 'list', companyId, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<NotificationTemplate>>(`/v1/notiftemplate/templates?${params.toString()}`)
    },
    staleTime: 30_000,
    enabled,
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
