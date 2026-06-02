import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { Drawer, Modal, Button, Badge } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore } from '@/core/auth/authStore'
import {
  useAssignableRoles, useAssignRole, useRevokeRole,
  groupRolesByModule, workspaceUserDisplayName,
  type WorkspaceUser, type AssignableRole,
} from '@/modules/rbac/api/useWorkspaceAccess'

const MODULE_LABEL: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts',
  attendance: 'Attendance', leave: 'Leave', core: 'Platform',
}

interface Props {
  user: WorkspaceUser
  open: boolean
  onClose: () => void
}

export const ManageAccessDrawer: React.FC<Props> = ({ user, open, onClose }) => {
  const { toast } = useToast()
  const hasModule = useAuthStore(s => s.hasModule)
  const { data: roles = [] } = useAssignableRoles()
  const assign = useAssignRole()
  const revoke = useRevokeRole()
  const [confirmRevoke, setConfirmRevoke] = useState<AssignableRole | null>(null)

  const grantedCodes = new Set(user.roles.map(r => r.roleCode))
  const groups = groupRolesByModule(roles)
  const busy = assign.isPending || revoke.isPending

  const doAssign = (role: AssignableRole) => {
    assign.mutate({ userId: user.userId, roleCode: role.roleCode }, {
      onSuccess: () => toast(`${role.displayName} granted`, 'success'),
      onError: (e) => toast((e as Error).message, 'error'),
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
    } else {
      doAssign(role)
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Manage access — ${workspaceUserDisplayName(user)}`}
      >
        <p className="text-sm text-[#64748B] mb-5">{user.email}</p>

        <div className="space-y-6">
          {groups.map(([moduleKey, moduleRoles]) => {
            const active = moduleKey === 'core' || hasModule(moduleKey)
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
                    return (
                      <div
                        key={role.roleCode}
                        className={clsx(
                          'flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-colors',
                          active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60',
                        )}
                      >
                        <span className="text-sm font-medium text-slate-800">{role.displayName}</span>
                        {active ? (
                          <button
                            role="switch"
                            aria-checked={granted}
                            disabled={busy}
                            onClick={() => onToggle(role)}
                            className={clsx(
                              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
                              granted ? 'bg-[#0F6E56]' : 'bg-slate-300',
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
                      <Link to="/settings" className="font-semibold text-[#0F6E56] hover:underline">
                        Activate {MODULE_LABEL[moduleKey] ?? moduleKey} →
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            )
          })}
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
            <strong>{workspaceUserDisplayName(user)}</strong> ({user.email}) will have no roles and will see
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
    </>
  )
}
