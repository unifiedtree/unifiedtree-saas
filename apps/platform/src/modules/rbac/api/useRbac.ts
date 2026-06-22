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

export interface UserRolesView {
  userId: string
  roles: RbacRole[]
  effectivePermissions: string[]
}

/** A user's assigned roles + the flattened permissions they grant. */
export function useUserRoles(userId: string | null) {
  return useQuery({
    queryKey: ['rbac', 'user-roles', userId],
    queryFn: () => apiJson<UserRolesView>(`/v1/rbac/users/${userId}/roles`),
    enabled: !!userId,
  })
}

export function useGrantRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      apiJson<unknown>(`/v1/rbac/users/${userId}/roles/${roleId}`, { method: 'POST' }),
    onSuccess: (_d, { userId }) =>
      qc.invalidateQueries({ queryKey: ['rbac', 'user-roles', userId] }),
  })
}

export function useRevokeRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      apiJson<void>(`/v1/rbac/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: (_d, { userId }) =>
      qc.invalidateQueries({ queryKey: ['rbac', 'user-roles', userId] }),
  })
}
