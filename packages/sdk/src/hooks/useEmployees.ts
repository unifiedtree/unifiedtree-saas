import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Employee,
  CreateEmployeeRequest,
  PaginatedResponse,
  ApiResponse,
  PaginationParams,
  FilterParams,
} from '@erp/types'
import { useApi } from '../context/ApiContext'

type EmployeeFilters = PaginationParams & FilterParams & {
  department?: string
  status?: string
  employmentType?: string
}

const QUERY_KEYS = {
  all: (tenantId: string) => ['employees', tenantId] as const,
  list: (tenantId: string, params: EmployeeFilters) => ['employees', tenantId, 'list', params] as const,
  detail: (tenantId: string, id: string) => ['employees', tenantId, id] as const,
}

export function useEmployees(tenantId: string, params: EmployeeFilters = {}) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.list(tenantId, params),
    queryFn: () =>
      client.get<ApiResponse<PaginatedResponse<Employee>>>(`/api/v1/tenants/${tenantId}/employees`, params),
    enabled: Boolean(tenantId),
  })
}

export function useEmployee(tenantId: string, id: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.detail(tenantId, id),
    queryFn: () =>
      client.get<ApiResponse<Employee>>(`/api/v1/tenants/${tenantId}/employees/${id}`),
    enabled: Boolean(tenantId) && Boolean(id),
  })
}

export function useCreateEmployee(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateEmployeeRequest) =>
      client.post<ApiResponse<Employee>>(`/api/v1/tenants/${tenantId}/employees`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useUpdateEmployee(tenantId: string, id: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<CreateEmployeeRequest>) =>
      client.patch<ApiResponse<Employee>>(`/api/v1/tenants/${tenantId}/employees/${id}`, data),
    onSuccess: (response) => {
      queryClient.setQueryData(QUERY_KEYS.detail(tenantId, id), response)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useDeleteEmployee(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      client.delete<ApiResponse<null>>(`/api/v1/tenants/${tenantId}/employees/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.detail(tenantId, id) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}
