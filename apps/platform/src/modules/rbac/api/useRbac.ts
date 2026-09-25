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

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RbacPermission {
  code: string
  displayName: string
  module: string
  /** Plain-English: what this lets a person do. */
  description: string | null
  /** LOW · MEDIUM · HIGH (money, everyone's salary, personal data, deletions) · CRITICAL (who can do what, billing; owner-only to give). */
  riskLevel: RiskLevel
  /** Shown before granting a HIGH / CRITICAL permission. */
  warning: string | null
}

export const RISK_LABEL: Record<RiskLevel, string> = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk', CRITICAL: 'Critical' }
export const RISK_TONE: Record<RiskLevel, 'gray' | 'info' | 'warn' | 'red'> = { LOW: 'gray', MEDIUM: 'info', HIGH: 'warn', CRITICAL: 'red' }
export const isRisky = (r?: string | null) => r === 'HIGH' || r === 'CRITICAL'

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

/**
 * Replace a custom role's permissions. Adding a HIGH / CRITICAL permission
 * needs `acknowledgeRisk` (the page shows the warnings first).
 */
export function useSetRolePermissions(roleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ codes, acknowledgeRisk = false }: { codes: string[]; acknowledgeRisk?: boolean }) =>
      apiJson<string[]>(`/v1/rbac/roles/${roleId}/permissions?acknowledgeRisk=${acknowledgeRisk}`, {
        method: 'PUT',
        body: JSON.stringify(codes),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      qc.invalidateQueries({ queryKey: ['rbac', 'role-permissions', roleId] })
    },
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; displayName: string; description?: string; cloneFromRoleId?: string }) =>
      apiJson<RbacRole>('/v1/rbac/roles', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES_KEY }),
  })
}

/** "Duplicate role": copy a built-in or custom role into a new custom role you can change. */
export function useDuplicateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ roleId, displayName, code, description }: { roleId: string; displayName: string; code?: string; description?: string }) =>
      apiJson<RbacRole>(`/v1/rbac/roles/${roleId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ displayName, code, description }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      qc.invalidateQueries({ queryKey: ['rbac', 'workspace', 'assignable-roles'] })
    },
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ roleId, displayName, description }: { roleId: string; displayName: string; description?: string }) =>
      apiJson<RbacRole>(`/v1/rbac/roles/${roleId}`, {
        method: 'PUT',
        body: JSON.stringify({ displayName, description }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES_KEY }),
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roleId: string) => apiJson<void>(`/v1/rbac/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      qc.invalidateQueries({ queryKey: ['rbac', 'workspace'] })
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
