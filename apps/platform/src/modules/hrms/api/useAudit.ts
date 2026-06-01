import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditEventDto {
  id: string
  occurredAt: string
  actorUserId: string
  actorEmail?: string | null
  resourceType?: string | null
  resourceId?: string | null
  action: string
  diff?: string | null
  ip?: string | null
  userAgent?: string | null
  traceId?: string | null
}

export interface AuditPage {
  data: AuditEventDto[]
  meta: {
    page: number
    size: number
    total: number
  }
}

export interface AuditFilters {
  actor?: string
  resource?: string
  resourceId?: string
  action?: string
  from?: string
  to?: string
  page?: number
  size?: number
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuditEvents(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: ['audit', 'events', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.actor)      params.set('actor', filters.actor)
      if (filters.resource)   params.set('resource', filters.resource)
      if (filters.resourceId) params.set('resourceId', filters.resourceId)
      if (filters.action)     params.set('action', filters.action)
      if (filters.from)       params.set('from', filters.from)
      if (filters.to)         params.set('to', filters.to)
      if (filters.page != null) params.set('page', String(filters.page))
      if (filters.size != null) params.set('size', String(filters.size))
      const qs = params.toString()
      return apiJson<AuditPage>(`/v1/audit/events${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}
