import { useAuthStore } from '@/core/auth/authStore'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'

export const usePermissions = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const hasModule = useAuthStore((s) => s.hasModule)
  const tenant = useAuthStore((s) => s.tenant)
  // isSuperAdmin via permission code — never role string equality
  const isSuperAdmin = useSdkStore((s) => s.permissions.has('*') || s.permissions.size > 50)

  return {
    hasPermission,
    hasModule,
    isSuperAdmin,
    activeModules: tenant?.activeModules ?? [],
    canRead: (module: string) => hasModule(module) && hasPermission(`${module}:read`),
    canWrite: (module: string) => hasModule(module) && hasPermission(`${module}:write`),
    canDelete: (module: string) => hasModule(module) && hasPermission(`${module}:delete`),
  }
}
