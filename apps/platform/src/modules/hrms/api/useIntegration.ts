import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.integration.enums.IntegrationStatus
export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR'

export interface IntegrationConnection {
  id: string
  companyId: string
  name: string
  provider: string
  category?: string
  status: IntegrationStatus
  configSummary?: string
  lastSyncedAt?: string
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

// ── Connections ──────────────────────────────────────────────────────────────

export function useIntegrationConnections(companyId?: string, page = 0) {
  return useQuery({
    queryKey: ['hrms', 'integration', 'connections', companyId ?? 'all', page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<IntegrationConnection>>(`/v1/integration/connections?${params.toString()}`)
    },
    staleTime: 30_000,
  })
}

export interface CreateConnectionPayload {
  companyId: string
  name: string
  provider: string
  category?: string
  configSummary?: string
}

export function useCreateConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateConnectionPayload) =>
      apiJson<IntegrationConnection>('/v1/integration/connections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'integration'] }),
  })
}

export function useToggleConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<IntegrationConnection>(`/v1/integration/connections/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'integration'] }),
  })
}

export function useDeleteConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/integration/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'integration'] }),
  })
}
