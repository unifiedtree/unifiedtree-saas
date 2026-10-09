import { useMemo } from 'react'
import { jwtDecode } from 'jwt-decode'
import { getAccessToken, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { ADMIN_ROLES } from '@/shared/hooks/useRoles'
import { personalPagesShown, type AccessContext } from './access'
import { visibleEntries, type VisibleEntry } from './pageRegistry'

/**
 * "Can buy and manage plans and billing" (owner, Q-26, 9 Oct 2026): one permission, which the owner can
 * tick on any custom role or give one person. The server checks the same code (WorkspacePlanController,
 * the module-buy endpoint, the billing breakdown), so the menu, /plan, the Billing tab and the upsell
 * all follow it. Role names no longer decide billing.
 */
export const BILLING_PERMISSION = 'workspace.billing.manage'

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
  // The local store copies the session's modules one render after sign-in (AuthProvider); until it
  // has, read them from the session itself, so nothing module-gated is hidden (or redirected) meanwhile.
  const sessionModules = useSdkStore((s) => s.modules)
  // The owner's per-role setting, as the server answered at sign-in (null from an older server).
  const personalPages = useSdkStore((s) => s.personalPages)
  const roleKey = (roles ?? []).join('|')
  const moduleKey = (modules ?? sessionModules.filter((m) => m.enabled).map((m) => m.key)).join('|')
  return useMemo<AccessContext>(() => {
    const wildcard = permissions.has('*')
    const r = roleKey ? roleKey.split('|') : []
    const adminRole = r.some((x) => (ADMIN_ROLES as readonly string[]).includes(x))
    return {
      has: (code: string) => wildcard || permissions.has(code),
      modules: moduleKey ? moduleKey.split('|') : [],
      // Recomputed whenever the grants change (a new token); employee_id doesn't change within a session.
      self: tokenHasEmployee(),
      adminRole,
      personalPages: personalPagesShown(personalPages, adminRole),
      planAdmin: wildcard || permissions.has(BILLING_PERMISSION),
    }
  }, [permissions, roleKey, moduleKey, personalPages])
}

/** Whether the signed-in person may buy and manage plans and billing (see {@link BILLING_PERMISSION}). */
export function useCanManageBilling(): boolean {
  return useAccessContext().planAdmin
}

/** Every page and tab the signed-in person may see (locked-module pages only for plan admins). */
export function useVisibleEntries(): { ctx: AccessContext; entries: VisibleEntry[] } {
  const ctx = useAccessContext()
  const entries = useMemo(() => visibleEntries(ctx), [ctx])
  return { ctx, entries }
}
