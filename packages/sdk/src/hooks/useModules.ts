import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ErpModule, TenantModule, ApiResponse, ModuleActivationRequest } from '@erp/types'
import { useApi } from '../context/ApiContext'

const QUERY_KEYS = {
  catalog: () => ['modules', 'catalog'] as const,
  active: (tenantId: string) => ['modules', 'active', tenantId] as const,
  all: (tenantId: string) => ['modules', tenantId] as const,
}

export function useModuleCatalog() {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.catalog(),
    queryFn: () => client.get<ApiResponse<ErpModule[]>>('/api/v1/modules'),
    staleTime: 10 * 60 * 1000, // catalog rarely changes
  })
}

export function useActiveModules(tenantId: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.active(tenantId),
    queryFn: () =>
      client.get<ApiResponse<TenantModule[]>>(`/api/v1/tenants/${tenantId}/modules/active`),
    enabled: Boolean(tenantId),
  })
}

export function useAllTenantModules(tenantId: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.all(tenantId),
    queryFn: () =>
      client.get<ApiResponse<TenantModule[]>>(`/api/v1/tenants/${tenantId}/modules`),
    enabled: Boolean(tenantId),
  })
}

export function useActivateModule(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: ModuleActivationRequest) =>
      client.post<ApiResponse<TenantModule>>(`/api/v1/tenants/${tenantId}/modules/activate`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', tenantId] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.active(tenantId) })
    },
  })
}

export function useDeactivateModule(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (moduleKey: string) =>
      client.post<ApiResponse<null>>(`/api/v1/tenants/${tenantId}/modules/${moduleKey}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', tenantId] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.active(tenantId) })
    },
  })
}

// Convenience hook: returns a Set of active module keys for fast lookup
export function useActiveModuleKeys(tenantId: string): Set<string> {
  const { data } = useActiveModules(tenantId)
  const modules = data?.data ?? []
  return new Set(modules.filter((m) => m.status === 'ACTIVE').map((m) => m.moduleKey))
}
