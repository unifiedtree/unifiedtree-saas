import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * One row from the tenant audit log, as the dashboard activity feed sees it.
 *
 * `summary` is mapped by the API but is NULL for every event today — nothing in
 * the backend calls AuditEvent.setSummary yet (verified 2026-08-22). Until a
 * writer starts populating it, {@link activityLabel} composes a readable line
 * from `action` + `resourceType` instead of rendering an empty row.
 */
export interface AuditEventDto {
  id: string
  occurredAt: string | null
  actorUserId: string | null
  actorEmail: string | null
  resourceType: string | null
  resourceId: string | null
  action: string | null
  diff: string | null
  ip: string | null
  userAgent: string | null
  traceId: string | null
  module: string | null
  summary: string | null
}

export interface AuditPageResponse {
  data: AuditEventDto[]
  meta: { page: number; size: number; total: number }
}

/** "leave.request.approve" -> "Leave request approve". Also handles snake_case. */
function humanise(token: string): string {
  const words = token.replace(/[._-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/**
 * Best-available human label for a feed row. Prefers the server `summary` the
 * moment one exists; otherwise builds "Action — Resource" from the structured
 * fields so the feed is never blank.
 */
export function activityLabel(event: AuditEventDto): string {
  if (event.summary && event.summary.trim()) return event.summary
  const action = event.action ? humanise(event.action) : 'Activity'
  const resource = event.resourceType ? humanise(event.resourceType) : null
  return resource && !action.toLowerCase().includes(resource.toLowerCase())
    ? `${action} — ${resource}`
    : action
}

/** Who did it. Falls back to the raw id, then to "System" for job-driven events. */
export function activityActor(event: AuditEventDto): string {
  return event.actorEmail || event.actorUserId || 'System'
}

/**
 * Recent workspace activity for the dashboard feed.
 *
 * Requires the `audit.read` authority — the caller must gate rendering on that
 * permission, since a cross-module feed can surface actions from areas the
 * viewer would not otherwise see.
 */
export function useActivityFeed(size: number = 8, enabled: boolean = true) {
  return useQuery({
    queryKey: ['hrms', 'activity', 'feed', size],
    queryFn: () => apiJson<AuditPageResponse>(`/v1/audit/events?page=0&size=${size}`),
    staleTime: 30_000,
    refetchInterval: 120_000,
    enabled,
  })
}
