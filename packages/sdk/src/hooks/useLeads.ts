import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Lead,
  CreateLeadRequest,
  PaginatedResponse,
  ApiResponse,
  PaginationParams,
  FilterParams,
  LeadStatus,
  LeadSource,
} from '@erp/types'
import { useApi } from '../context/ApiContext'

type LeadFilters = PaginationParams &
  FilterParams & {
    status?: LeadStatus
    source?: LeadSource
    assignedToId?: string
  }

const QUERY_KEYS = {
  all: (tenantId: string) => ['leads', tenantId] as const,
  list: (tenantId: string, params: LeadFilters) => ['leads', tenantId, 'list', params] as const,
  detail: (tenantId: string, id: string) => ['leads', tenantId, id] as const,
}

export function useLeads(tenantId: string, params: LeadFilters = {}) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.list(tenantId, params),
    queryFn: () =>
      client.get<ApiResponse<PaginatedResponse<Lead>>>(`/api/v1/tenants/${tenantId}/crm/leads`, params),
    enabled: Boolean(tenantId),
  })
}

export function useLead(tenantId: string, id: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.detail(tenantId, id),
    queryFn: () =>
      client.get<ApiResponse<Lead>>(`/api/v1/tenants/${tenantId}/crm/leads/${id}`),
    enabled: Boolean(tenantId) && Boolean(id),
  })
}

export function useCreateLead(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateLeadRequest) =>
      client.post<ApiResponse<Lead>>(`/api/v1/tenants/${tenantId}/crm/leads`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useUpdateLead(tenantId: string, id: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<CreateLeadRequest> & { status?: LeadStatus }) =>
      client.patch<ApiResponse<Lead>>(`/api/v1/tenants/${tenantId}/crm/leads/${id}`, data),
    onSuccess: (response) => {
      queryClient.setQueryData(QUERY_KEYS.detail(tenantId, id), response)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useDeleteLead(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      client.delete<ApiResponse<null>>(`/api/v1/tenants/${tenantId}/crm/leads/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.detail(tenantId, id) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useConvertLead(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (leadId: string) =>
      client.post<ApiResponse<{ customerId: string }>>(`/api/v1/tenants/${tenantId}/crm/leads/${leadId}/convert`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}
