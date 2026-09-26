// Access for a person being added (Employee Master "Add employee" and the
// onboarding wizard): the roles they get and the single permissions added or
// removed for just them. Nothing new on the server: once the person has a login
// (their invitation creates it, with the Employee role), the choices go through
// the same APIs as Users & access —
//   POST /v1/workspace/users/{id}/roles          (workspace.users.manage)
//   PUT  /v1/workspace/users/{id}/permissions    (rbac.access.manage-overrides)
// and the server applies the same levels rules and audit there.
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import type { AssignableRole, OverrideInput, UserPermissionsView, WorkspaceUser } from './useWorkspaceAccess'

export interface AccessDraft {
  /** Roles on top of Employee (every employee has Employee; the invitation gives it). */
  roles: string[]
  /** Permissions their roles don't give, added for this person (GRANT overrides). */
  grants: string[]
  /** Permissions their roles give, taken away from this person (DENY overrides). */
  denies: string[]
  /** Kept with each single-permission change and in the audit log. */
  reason: string
  /** The admin confirmed the warning on a high-risk extra permission. */
  riskConfirmed: boolean
}

export const BASE_ROLE = 'EMPLOYEE'
export const DEFAULT_REASON = 'Set when adding the employee'
export const emptyAccess = (): AccessDraft => ({ roles: [], grants: [], denies: [], reason: DEFAULT_REASON, riskConfirmed: false })
/** Nothing beyond what every new employee gets today. */
export const isDefaultAccess = (d: AccessDraft | null | undefined) => !d || (!d.roles.length && !d.grants.length && !d.denies.length)

/**
 * Who sees the Access step: people who may give roles or single permissions
 * (and can look people up in Users & access). Everyone else adds people as
 * before and the new person gets the Employee role.
 */
export function useNewPersonAccessRights() {
  const canRead = usePermission(P.WORKSPACE_USERS_READ)
  const canRoles = usePermission(P.WORKSPACE_USERS_MANAGE)
  const canOverrides = usePermission('rbac.access.manage-overrides')
  // What a role includes is read from Roles & permissions.
  const canReadRolePermissions = usePermission(P.RBAC_ROLE_WRITE)
  return { visible: canRead && (canRoles || canOverrides), canRoles, canOverrides, canReadRolePermissions }
}

const errText = (e: unknown) => (e instanceof Error && e.message) || 'please try again'

export interface AccessOutcome {
  /** What didn't save, in plain words; empty when everything did. */
  problems: string[]
}

/**
 * Give the chosen roles and single permissions to the login of a person who was
 * just added and invited. Each part is tried on its own, so one refusal doesn't
 * stop the rest; the person stays created whatever happens here.
 */
export async function applyNewPersonAccess(employeeId: string, email: string | null | undefined, draft: AccessDraft): Promise<AccessOutcome> {
  if (isDefaultAccess(draft)) return { problems: [] }
  let users: WorkspaceUser[]
  try { users = await apiJson<WorkspaceUser[]>('/v1/workspace/users') } catch (e) { return { problems: [`their login couldn’t be looked up (${errText(e)})`] } }
  const mail = (email || '').trim().toLowerCase()
  const user = users.find((u) => u.employeeId === employeeId) ?? (mail ? users.find((u) => u.email.toLowerCase() === mail) : undefined)
  if (!user) return { problems: ['their login wasn’t found'] }

  const problems: string[] = []
  const refused: [string, string][] = []
  for (const code of draft.roles) {
    if (code === BASE_ROLE) continue
    try {
      await apiJson<void>(`/v1/workspace/users/${user.userId}/roles`, { method: 'POST', body: JSON.stringify({ roleCode: code }) })
    } catch (e) { refused.push([code, errText(e)]) }
  }
  if (refused.length) {
    let names = new Map<string, string>()
    try { names = new Map((await apiJson<AssignableRole[]>('/v1/workspace/assignable-roles')).map((r) => [r.roleCode, r.displayName])) } catch { /* the code will do */ }
    for (const [code, why] of refused) problems.push(`the ${names.get(code) ?? code} role wasn’t given (${why})`)
  }

  const reason = draft.reason.trim() || DEFAULT_REASON
  const wanted: OverrideInput[] = [
    ...draft.grants.map((code): OverrideInput => ({ permissionCode: code, effect: 'GRANT', reason, expiresAt: null })),
    ...draft.denies.map((code): OverrideInput => ({ permissionCode: code, effect: 'DENY', reason, expiresAt: null })),
  ]
  if (wanted.length) {
    try {
      // The PUT replaces their whole list, so keep anything already there (an existing login found by email).
      const view = await apiJson<UserPermissionsView>(`/v1/workspace/users/${user.userId}/permissions`)
      const mine = new Set(wanted.map((w) => w.permissionCode))
      const keep = view.overrides.filter((o) => !mine.has(o.permissionCode))
        .map((o): OverrideInput => ({ permissionCode: o.permissionCode, effect: o.effect, reason: o.reason, expiresAt: o.expiresAt }))
      await apiJson<UserPermissionsView>(`/v1/workspace/users/${user.userId}/permissions`, {
        method: 'PUT', body: JSON.stringify({ overrides: [...keep, ...wanted], acknowledgeRisk: draft.riskConfirmed }),
      })
    } catch (e) { problems.push(`the single permission changes weren’t saved (${errText(e)})`) }
  }
  return { problems }
}
