import React from 'react'
import { Navigate } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'

/**
 * Route-level permission gate.
 *
 * Wraps a route element and redirects (default: /me) when the signed-in user
 * lacks the required permission code. Complements the existing RouteGuard's
 * `anyOf` list for cases where a single-permission check is enough and we want
 * a soft redirect instead of the guard's blocking "Access Restricted" screen.
 *
 * The check delegates to the SDK's usePermission hook so it stays consistent
 * with the sidebar's <Can> gating and the backend's authority names — a role
 * that was granted the code by any means (direct assignment, role bundle,
 * super-admin wildcard) passes here too.
 */
export function RequirePermission({
  code,
  children,
  fallback,
}: {
  code: string
  children: React.ReactNode
  fallback?: string
}) {
  const has = usePermission(code)
  if (!has) return <Navigate to={fallback ?? '/me'} replace />
  return <>{children}</>
}
