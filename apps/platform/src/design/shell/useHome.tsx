// Which Home a person gets (DECISIONS 12, AUDIT §5.2). Decided by permission, never by a role name:
//   - a company-wide read (ADMIN_HOME_CODES) → the admin dashboard at /dashboard ("Dashboard")
//   - else the self-service Home at /me ("Home"), when they may open it
//   - else the first page they may open
//   - else /no-access
// Team blocks (Home's team cards, the My team group) show for today's /team rule.
import { useMemo } from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { accessState, type AccessContext } from '@/shared/navigation/access'
import { PAGE_REGISTRY, type PageEntry } from '@/shared/navigation/pageRegistry'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { ADMIN_HOME_CODES, TEAM_READ_CODES } from '@/shared/navigation/shellCodes'

export type HomeKind = 'admin' | 'self' | 'first' | 'none'

export interface Home {
  kind: HomeKind
  /** Where Home opens. */
  path: string
  /** Its name ("Dashboard", "Home", or the first page's name). */
  label: string
  /** Team blocks on Home and the My team group. */
  team: boolean
}

/** Always-open pages that are not a place to land: the launcher, the plan page, your own profile and sign-in security. */
const NOT_A_HOME = new Set(['dashboard', 'me', 'apps', 'plan', 'profile', 's-security'])

export const hasAdminHome = (ctx: AccessContext) => ADMIN_HOME_CODES.some(ctx.has)

/** Today's /team rule: a team permission, and not the company directory. */
export const hasTeamBlocks = (ctx: AccessContext) => TEAM_READ_CODES.some(ctx.has) && !ctx.has('hrms.employee.read')

export function resolveHome(ctx: AccessContext, registry: readonly PageEntry[] = PAGE_REGISTRY): Home {
  const team = hasTeamBlocks(ctx)
  if (hasAdminHome(ctx)) return { kind: 'admin', path: '/dashboard', label: 'Dashboard', team }
  const me = registry.find((e) => e.id === 'me')
  if (me && accessState(me.access, ctx) === 'open') return { kind: 'self', path: '/me', label: 'Home', team }
  const first = registry.find((e) => !e.parent && !e.comingSoon && !NOT_A_HOME.has(e.id) && accessState(e.access, ctx) === 'open')
  if (first) return { kind: 'first', path: first.path, label: first.label, team }
  return { kind: 'none', path: '/no-access', label: '', team }
}

/**
 * The signed-in person's Home. `ready` is false until the session has loaded (the guard above the
 * shell waits for it too), so nothing redirects on a half-loaded session.
 */
export function useHome(): Home & { ready: boolean } {
  const ctx = useAccessContext()
  const ready = useSdkStore((s) => s.status === 'authenticated')
  return useMemo(() => ({ ...resolveHome(ctx), ready }), [ctx, ready])
}
