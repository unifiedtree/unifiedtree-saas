import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@unifiedtree/sdk'
import { useAnyPermission } from '@unifiedtree/sdk'

interface RouteGuardProps {
  children: React.ReactNode
  /** If provided, the user must have at least one of these permission codes. */
  anyOf?: string[]
  /** Redirect target when unauthenticated (default: /login). */
  loginPath?: string
}

export function RouteGuard({
  children,
  anyOf,
  loginPath = '/login',
}: RouteGuardProps) {
  const location = useLocation()
  const status = useAuthStore(s => s.status)
  const hasAny = useAnyPermission(anyOf ?? [])

  if (status === 'idle' || status === 'loading') {
    return null // AuthProvider shows splash; this guard just blocks render
  }

  if (status === 'unauthenticated' || status === 'error') {
    return (
      <Navigate
        to={loginPath}
        state={{ returnUrl: location.pathname + location.search }}
        replace
      />
    )
  }

  // If anyOf was supplied and the user has none of the listed permissions → NoAccess
  if (anyOf && anyOf.length > 0 && !hasAny) {
    return <NoAccess />
  }

  return <>{children}</>
}

function NoAccess() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="text-5xl">🔒</div>
      <h2 className="text-xl font-semibold text-text-primary">Access Restricted</h2>
      <p className="max-w-sm text-sm text-text-secondary">
        You do not have the required permissions to view this page. Contact your administrator
        if you believe this is a mistake.
      </p>
    </div>
  )
}
