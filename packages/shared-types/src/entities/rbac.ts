export type PermissionAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'EXPORT'

export interface Role {
  id: string
  tenantId?: string
  name: string
  displayName: string
  description?: string
  isSystem: boolean
  level: number
  color: string
  permissions: Permission[]
  userCount?: number
  createdAt: string
}

export interface Permission {
  id: string
  code: string
  name: string
  module: string
  resource: string
  action: PermissionAction
  description?: string
}

export interface PermissionMatrix {
  module: string
  displayName: string
  resources: {
    resource: string
    actions: Record<PermissionAction, boolean>
  }[]
}

export interface CreateRoleRequest {
  name: string
  displayName: string
  description?: string
  color?: string
  permissions: string[]
}

export interface UpdateRoleRequest extends Partial<CreateRoleRequest> {
  id: string
}

// System roles that exist in every tenant
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  VIEWER: 'VIEWER',
} as const

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]
