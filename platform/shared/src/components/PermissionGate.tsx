import React from 'react'
import { usePermission } from '../hooks/usePermission'

interface AccessDeniedProps {
  permission: string
}

function AccessDenied({ permission }: AccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h4 className="text-white font-medium mb-1">Access Restricted</h4>
      <p className="text-slate-400 text-sm">
        You don't have permission to perform this action.
        <br />
        <span className="text-slate-600 text-xs font-mono">{permission}</span>
      </p>
    </div>
  )
}

interface PermissionGateProps {
  permission: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function PermissionGate({ permission, children, fallback }: PermissionGateProps) {
  const hasPermission = usePermission(permission)

  if (!hasPermission) {
    return <>{fallback ?? <AccessDenied permission={permission} />}</>
  }

  return <>{children}</>
}
