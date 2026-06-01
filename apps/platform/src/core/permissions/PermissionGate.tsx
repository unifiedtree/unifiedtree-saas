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
  const hasModule = useAuthStore((s) => s.hasModule)

  if (moduleKey && !hasModule(moduleKey)) return <>{fallback}</>
  if (permission && !hasPermission(permission)) return <>{fallback}</>
  return <>{children}</>
}
