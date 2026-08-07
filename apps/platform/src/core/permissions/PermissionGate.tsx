import React from 'react'
import { useAuthStore } from '@/core/auth/authStore'

interface PermissionGateProps {
  permission?: string
  module?: string
  fallback?: React.ReactNode
  children: React.ReactNode
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  permission,
  module: moduleKey,
  fallback = null,
  children,
}) => {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  // Reactive slice selector — see usePermissions.ts comment for why the
  // stable `s.hasModule` reference doesn't re-render on activeModules change.
  const activeModules = useAuthStore((s) => s.tenant?.activeModules ?? [])
  const hasModule = (k: string) => activeModules.includes(k)

  if (moduleKey && !hasModule(moduleKey)) return <>{fallback}</>
  if (permission && !hasPermission(permission)) return <>{fallback}</>
  return <>{children}</>
}
