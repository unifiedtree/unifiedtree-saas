import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type WorkspaceUserStatus = 'ACTIVE' | 'INVITED' | 'INACTIVE'

export interface WorkspaceRole {
  roleCode: string       // e.g. 'EMPLOYEE','HR_MANAGER'
  displayName: string    // e.g. 'HR Manager'
  module: string         // 'hrms' | 'crm' | 'accounts' | 'core' | ...
}

export type InvitationSendStatus = 'PENDING' | 'SENT' | 'FAILED'

export interface WorkspaceUser {
  userId: string
  email: string
  employeeId: string | null
  firstName: string | null   // RAW — may be null
  lastName: string | null
  status: WorkspaceUserStatus
  lastLoginAt: string | null
  roles: WorkspaceRole[]
  // Latest invitation email delivery state (null = never invited). The email is
  // sent asynchronously, so this reflects PENDING (queued) → SENT | FAILED.
  invitationSendStatus: InvitationSendStatus | null
  lastSendError: string | null
}

export interface AssignableRole {
  roleCode: string
  displayName: string
  module: string
  moduleActive: boolean
}

export interface InviteWorkspaceUserRequest {
  email: string
  firstName?: string
  lastName?: string
  createEmployee: boolean   // default true at the call-site
  roleCodes: string[]
  companyId?: string
}

const USERS_KEY = ['rbac', 'workspace', 'users'] as const
const ROLES_KEY = ['rbac', 'workspace', 'assignable-roles'] as const

export function useWorkspaceUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => apiJson<WorkspaceUser[]>('/v1/workspace/users'),
  })
}

export function useAssignableRoles() {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: () => apiJson<AssignableRole[]>('/v1/workspace/assignable-roles'),
    staleTime: 5 * 60_000,
  })
}

export function useAssignRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, roleCode }: { userId: string; roleCode: string }) =>
      apiJson<void>(`/v1/workspace/users/${userId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleCode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

export function useRevokeRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, roleCode }: { userId: string; roleCode: string }) =>
      apiJson<void>(`/v1/workspace/users/${userId}/roles/${roleCode}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

export function useInviteWorkspaceUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: InviteWorkspaceUserRequest) =>
      apiJson<{ sent: boolean; expiresAt: string }>('/v1/workspace/users/invite', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

/** Re-send the invitation email to an invited user (e.g. the original was deleted). */
export function useResendWorkspaceInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiJson<{ sent: boolean; expiresAt: string }>(`/v1/workspace/users/${userId}/invite/resend`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

/** Display name with email-username fallback when no employee name exists. */
export function workspaceUserDisplayName(
  u: Pick<WorkspaceUser, 'firstName' | 'lastName' | 'email'>,
): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return full || u.email.split('@')[0]
}

/** Group a list of roles by their module key, preserving a stable module order. */
export function groupRolesByModule<T extends { module: string }>(roles: T[]): [string, T[]][] {
  const order = ['hrms', 'crm', 'accounts', 'attendance', 'leave', 'core']
  const rank = (m: string) => { const i = order.indexOf(m); return i === -1 ? order.length : i }
  const map = new Map<string, T[]>()
  for (const r of roles) {
    if (!map.has(r.module)) map.set(r.module, [])
    map.get(r.module)!.push(r)
  }
  return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}
