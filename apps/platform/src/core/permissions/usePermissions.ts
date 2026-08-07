import { useAuthStore } from '@/core/auth/authStore'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'

export const usePermissions = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  // Subscribe to activeModules directly instead of the stable hasModule
  // function reference — Zustand only re-renders when the selected slice
  // reference changes, and hasModule closes over get() so its identity
  // doesn't change on activeModules mutation. Result: components using
  // usePermissions().canRead(...) would stay stale until an unrelated
  // re-render. Now they update the instant tenant.activeModules changes.
  const activeModules = useAuthStore((s) => s.tenant?.activeModules ?? [])
  const hasModule = (k: string) => activeModules.includes(k)
  // isSuperAdmin via permission code — never role string equality
  const isSuperAdmin = useSdkStore((s) => s.permissions.has('*') || s.permissions.size > 50)

  return {
    hasPermission,
    hasModule,
    isSuperAdmin,
    activeModules,
    canRead: (module: string) => hasModule(module) && hasPermission(`${module}:read`),
    canWrite: (module: string) => hasModule(module) && hasPermission(`${module}:write`),
    canDelete: (module: string) => hasModule(module) && hasPermission(`${module}:delete`),
  }
}
