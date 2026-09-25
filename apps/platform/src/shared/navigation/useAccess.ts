import { useMemo } from 'react'
import { jwtDecode } from 'jwt-decode'
import { getAccessToken, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { ADMIN_ROLES } from '@/shared/hooks/useRoles'
import type { AccessContext } from './access'
import { visibleEntries, type VisibleEntry } from './pageRegistry'

/** Roles the server lets add modules and change the plan or branding (WorkspacePlanController, BrandingController). */
export const PLAN_ADMIN_ROLES = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] as const

/**
 * Whether the signed-in person has an employee record: the access token carries
 * employee_id only then. If the token can't be read at all, self-service stays
 * visible (the pages themselves say when there is no employee record) rather
 * than hiding an employee's own menu over a read failure.
 */
function tokenHasEmployee(): boolean {
  const token = getAccessToken()
  if (!token) return true
  try { return !!jwtDecode<{ employee_id?: string }>(token).employee_id } catch { return true }
}

/** The signed-in person's access context (permissions, active modules, own employee record). */
export function useAccessContext(): AccessContext {
  const permissions = useSdkStore((s) => s.permissions)
  const roles = useSdkStore((s) => s.user?.roles)
  const modules = useLocalAuthStore((s) => s.tenant?.activeModules)
  const roleKey = (roles ?? []).join('|')
  const moduleKey = (modules ?? []).join('|')
  return useMemo<AccessContext>(() => {
    const wildcard = permissions.has('*')
    const r = roleKey ? roleKey.split('|') : []
    return {
      has: (code: string) => wildcard || permissions.has(code),
      modules: moduleKey ? moduleKey.split('|') : [],
      // Recomputed whenever the grants change (a new token); employee_id doesn't change within a session.
      self: tokenHasEmployee(),
      adminRole: r.some((x) => (ADMIN_ROLES as readonly string[]).includes(x)),
      planAdmin: wildcard || r.some((x) => (PLAN_ADMIN_ROLES as readonly string[]).includes(x)),
    }
  }, [permissions, roleKey, moduleKey])
}

/** Every page and tab the signed-in person may see (locked-module pages only for plan admins). */
export function useVisibleEntries(): { ctx: AccessContext; entries: VisibleEntry[] } {
  const ctx = useAccessContext()
  const entries = useMemo(() => visibleEntries(ctx), [ctx])
  return { ctx, entries }
}
