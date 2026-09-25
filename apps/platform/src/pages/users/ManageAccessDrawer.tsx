import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { Drawer, Modal, Button, Badge } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore } from '@/core/auth/authStore'
import { Note } from '@/design/module/ModuleKit'
import { HrStatusPill } from '@/shared/components/hr'
import { RISK_LABEL, RISK_TONE, isRisky } from '@/modules/rbac/api/useRbac'
import {
  useAssignableRoles, useAssignRole, useRevokeRole, useUserPermissions,
  groupRolesByModule, workspaceUserDisplayName,
  type WorkspaceUser, type AssignableRole,
} from '@/modules/rbac/api/useWorkspaceAccess'
import { UserPermissionOverrides } from './UserPermissionOverrides'

const MODULE_LABEL: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts',
  attendance: 'Attendance', leave: 'Leave', core: 'Platform',
}
// Only an owner may give or take away these (the server enforces it too).
const OWNER_ONLY = new Set(['OWNER', 'SUPER_ADMIN'])

interface Props {
  user: WorkspaceUser
  open: boolean
  onClose: () => void
}

export const ManageAccessDrawer: React.FC<Props> = ({ user, open, onClose }) => {
  const { toast } = useToast()
  const hasModule = useAuthStore(s => s.hasModule)
  const { data: roles = [] } = useAssignableRoles()
  const { data: access, isLoading: accessLoading, isError: accessError, error: accessErr, refetch: refetchAccess } = useUserPermissions(user.userId)
  const assign = useAssignRole()
  const revoke = useRevokeRole()
  const [confirmRevoke, setConfirmRevoke] = useState<AssignableRole | null>(null)
  const [confirmGrant, setConfirmGrant] = useState<AssignableRole | null>(null)

  const grantedCodes = new Set(user.roles.map(r => r.roleCode))
  const groups = groupRolesByModule(roles)
  const busy = assign.isPending || revoke.isPending
  const name = workspaceUserDisplayName(user)
  // Self, or an owner when you aren't one: the server refuses, so say why up front.
  const rolesLocked = access ? !access.canChangeRoles : false

  const doAssign = (role: AssignableRole) => {
    assign.mutate({ userId: user.userId, roleCode: role.roleCode }, {
      onSuccess: () => { toast(`${role.displayName} granted`, 'success'); setConfirmGrant(null) },
      onError: (e) => { toast((e as Error).message, 'error'); setConfirmGrant(null) },
    })
  }

  const doRevoke = (role: AssignableRole) => {
    revoke.mutate({ userId: user.userId, roleCode: role.roleCode }, {
      onSuccess: () => toast(`${role.displayName} removed`, 'success'),
      onError: (e) => toast((e as Error).message, 'error'),
    })
  }

  const onToggle = (role: AssignableRole) => {
    if (grantedCodes.has(role.roleCode)) {
      // Removing the user's LAST role -> confirm first.
      if (user.roles.length === 1) { setConfirmRevoke(role); return }
      doRevoke(role)
    } else if (isRisky(role.riskLevel)) {
      setConfirmGrant(role)
    } else {
      doAssign(role)
    }
  }

  /** Why this switch can't be used, or null. */
  const lockedWhy = (role: AssignableRole, granted: boolean): string | null => {
    if (rolesLocked) return access?.rolesBlockedReason ?? 'You can’t change this person’s roles.'
    if (granted) return OWNER_ONLY.has(role.roleCode) && role.canGrant === false ? role.grantBlockedReason ?? null : null
    return role.canGrant === false ? role.grantBlockedReason ?? 'You can’t give this role.' : null
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Manage access — ${name}`}
      >
        <p className="text-sm text-[#64748B] mb-5">{user.email}</p>

        {rolesLocked && access?.rolesBlockedReason && <div className="mb-4"><Note tone="amber">{access.rolesBlockedReason}</Note></div>}

        <div className="space-y-6">
          {groups.map(([moduleKey, moduleRoles]) => {
            // Trust the backend's per-role moduleActive (from /workspace/assignable-roles)
            // rather than recomputing client-side; fall back to hasModule only if absent.
            const active = moduleKey === 'core' || (moduleRoles[0]?.moduleActive ?? hasModule(moduleKey))
            return (
              <div key={moduleKey}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    {MODULE_LABEL[moduleKey] ?? moduleKey}
                  </span>
                  {!active && <Badge tone="default">Inactive</Badge>}
                </div>

                <div className="space-y-1.5">
                  {moduleRoles.map((role) => {
                    const granted = grantedCodes.has(role.roleCode)
                    const locked = lockedWhy(role, granted)
                    return (
                      <div
                        key={role.roleCode}
                        className={clsx(
                          'ut-card ut-card-sm flex items-center justify-between px-3.5 py-2.5',
                          !active && 'opacity-60',
                        )}
                      >
                        <span className="min-w-0 pr-3">
                          <span className="block text-sm font-medium text-slate-800">
                            {role.displayName}
                            {isRisky(role.riskLevel) && <span className="ml-2"><HrStatusPill tone={RISK_TONE[role.riskLevel!]}>{RISK_LABEL[role.riskLevel!]}</HrStatusPill></span>}
                          </span>
                          {role.description && <span className="block text-xs text-slate-500">{role.description}</span>}
                          {locked && !rolesLocked && <span className="block text-xs text-slate-500">{locked}</span>}
                        </span>
                        {active ? (
                          <button
                            role="switch"
                            aria-checked={granted}
                            aria-label={`${granted ? 'Remove' : 'Give'} ${role.displayName}`}
                            title={locked ?? undefined}
                            disabled={busy || !!locked}
                            onClick={() => onToggle(role)}
                            className={clsx(
                              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                              granted ? 'bg-[#059669]' : 'bg-slate-300',
                            )}
                          >
                            <span className={clsx(
                              'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                              granted ? 'translate-x-4.5' : 'translate-x-1',
                            )} style={{ transform: granted ? 'translateX(18px)' : 'translateX(4px)' }} />
                          </button>
                        ) : (
                          <Lock size={14} className="text-slate-400" />
                        )}
                      </div>
                    )
                  })}
                  {!active && (
                    <p className="text-xs text-slate-500 pt-1">
                      Activate this module to assign roles.{' '}
                      <Link to="/settings" className="font-semibold text-[#059669] hover:underline">
                        Activate {MODULE_LABEL[moduleKey] ?? moduleKey} →
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-8">
          {accessLoading ? <Note>Loading {name}’s permissions…</Note>
            : accessError ? (
              <Note tone="red">
                Couldn’t load {name}’s permissions: {(accessErr as Error)?.message}{' '}
                <button type="button" className="font-semibold underline" onClick={() => refetchAccess()}>Try again</button>
              </Note>
            ) : access ? (
              <UserPermissionOverrides view={access} userName={name}
                onDone={(message, error) => toast(error ? `${message}: ${error}` : message, error ? 'error' : 'success')} />
            ) : null}
        </div>

        <div className="mt-8 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </Drawer>

      {confirmRevoke && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setConfirmRevoke(null) }}
          title="Remove last role?"
          description="Removing this role leaves the user with no access. Continue?"
        >
          <p className="text-sm text-slate-600">
            <strong>{name}</strong> ({user.email}) will have no roles and will see
            a No-Access screen until a new role is granted.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() => revoke.mutate(
                { userId: user.userId, roleCode: confirmRevoke.roleCode },
                {
                  onSuccess: () => { toast('Role removed — user now has no access', 'warning'); setConfirmRevoke(null) },
                  onError: (e) => { toast((e as Error).message, 'error'); setConfirmRevoke(null) },
                },
              )}
            >
              Remove role
            </Button>
          </div>
        </Modal>
      )}

      {confirmGrant && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setConfirmGrant(null) }}
          title={`Give the ${confirmGrant.displayName} role?`}
          description="This role includes high-risk permissions. Please read before confirming."
        >
          <div className="space-y-3">
            <Note tone={confirmGrant.riskLevel === 'CRITICAL' ? 'red' : 'amber'}>
              {RISK_LABEL[confirmGrant.riskLevel!]}: {confirmGrant.riskLevel === 'CRITICAL'
                ? `${name} will be able to change who can do what, billing or the workspace itself.`
                : `${name} will be able to see or change money, salaries or personal data.`}
              {confirmGrant.description ? ` ${confirmGrant.description}` : ''}
            </Note>
            <p className="text-sm text-slate-600">
              See every permission this role gives on the Roles &amp; permissions page. The change is recorded in the audit log.
            </p>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmGrant(null)}>Cancel</Button>
            <Button variant="danger" loading={assign.isPending} onClick={() => doAssign(confirmGrant)}>
              Give role
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
