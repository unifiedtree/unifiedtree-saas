import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface RbacRole {
  id: string
  tenantId: string | null
  code: string
  displayName: string
  description: string
  systemRole: boolean
  defaultForNewUsers: boolean
  createdAt: string
}

export interface RbacPermission {
  code: string
  displayName: string
  module: string
  description: string
}

const ROLES_KEY = ['rbac', 'roles'] as const
const PERMISSIONS_KEY = ['rbac', 'permissions'] as const

export function useRoles() {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: () => apiJson<RbacRole[]>('/v1/rbac/roles'),
  })
}

export function usePermissionsCatalogue() {
  return useQuery({
    queryKey: PERMISSIONS_KEY,
    queryFn: () => apiJson<RbacPermission[]>('/v1/rbac/permissions'),
  })
}

export function useRolePermissions(roleId: string) {
  return useQuery({
    queryKey: ['rbac', 'role-permissions', roleId],
    queryFn: () => apiJson<string[]>(`/v1/rbac/roles/${roleId}/permissions`),
    enabled: !!roleId,
  })
}

export function useSetRolePermissions(roleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (permissionCodes: string[]) =>
      apiJson<void>(`/v1/rbac/roles/${roleId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify(permissionCodes),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      qc.invalidateQueries({ queryKey: ['rbac', 'role-permissions', roleId] })
    },
  })
}

export function useGrantRole() {
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      apiJson<unknown>(`/v1/rbac/users/${userId}/roles/${roleId}`, { method: 'POST' }),
  })
}

export function useRevokeRole() {
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      apiJson<void>(`/v1/rbac/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
  })
}

// TODO[backend]: POST /v1/rbac/roles — create role (endpoint not yet implemented)
// export function useCreateRole() { ... }

// TODO[backend]: PUT /v1/rbac/roles/{id} — update role metadata (endpoint not yet implemented)
// export function useUpdateRole(roleId: string) { ... }

// TODO[backend]: DELETE /v1/rbac/roles/{id} — delete role (endpoint not yet implemented)
// export function useDeleteRole() { ... }

// TODO[backend]: GET /v1/rbac/users/{userId}/roles — list user roles (endpoint not yet implemented)
// export function useUserRoles(userId: string) { ... }
