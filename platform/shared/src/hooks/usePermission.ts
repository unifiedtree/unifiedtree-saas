import { useAuthStore } from '../store/authStore'

/**
 * Check if the current user has a specific permission.
 * permissionCode format: "module:resource:action"
 * e.g. "hrms:employees:read", "crm:leads:create"
 * Returns true if user has the permission OR is a Super Admin.
 */
export function usePermission(permissionCode: string): boolean {
  const user = useAuthStore((s) => s.user)
  const permissions = useAuthStore((s) => s.permissions)

  if (!user) return false

  // Super admins bypass all permission checks
  if (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN') return true

  return permissions.includes(permissionCode)
}
