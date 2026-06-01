import { useAuthStore } from '../store/authStore'

interface ModuleAccessResult {
  isActive: boolean
  canActivate: boolean
}

/**
 * Check if a module is active for the current tenant
 * and if the current user can activate it.
 */
export function useModuleAccess(moduleKey: string): ModuleAccessResult {
  const activeModules = useAuthStore((s) => s.activeModules)
  const user = useAuthStore((s) => s.user)

  const isActive = activeModules.includes(moduleKey)
  const canActivate =
    user?.role === 'TENANT_ADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'PLATFORM_ADMIN'

  return { isActive, canActivate }
}
