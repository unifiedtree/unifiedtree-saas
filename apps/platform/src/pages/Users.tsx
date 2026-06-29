import React, { useMemo, useState } from 'react'
import { Plus, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { Can, P } from '@unifiedtree/sdk'
import { EmptyState, TableSkeleton } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
import {
  useWorkspaceUsers, useResendWorkspaceInvite, workspaceUserDisplayName, groupRolesByModule,
  type WorkspaceUser, type WorkspaceUserStatus,
} from '@/modules/rbac/api/useWorkspaceAccess'
import { ManageAccessDrawer } from './users/ManageAccessDrawer'
import { InviteWorkspaceUserModal } from './users/InviteWorkspaceUserModal'

const MODULE_LABEL: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts',
  attendance: 'Attendance', leave: 'Leave', core: 'Platform',
}

function StatusBadge({ status }: { status: WorkspaceUserStatus }) {
  if (status === 'ACTIVE')  return <HrStatusPill tone="ok">Active</HrStatusPill>
  if (status === 'INVITED') return <HrStatusPill tone="warn">Invited</HrStatusPill>
  return <HrStatusPill tone="gray">Inactive</HrStatusPill>
}

function RolesCell({ user }: { user: WorkspaceUser }) {
  if (user.roles.length === 0) return <HrStatusPill tone="warn">No access</HrStatusPill>
  const groups = groupRolesByModule(user.roles)
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map(([moduleKey, roles]) => (
        <div key={moduleKey} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary w-14 shrink-0">
            {MODULE_LABEL[moduleKey] ?? moduleKey}
          </span>
          {roles.map(r => <HrStatusPill key={r.roleCode} tone="info">{r.displayName}</HrStatusPill>)}
        </div>
      ))}
    </div>
  )
}

const UsersInner: React.FC = () => {
  const { toast } = useToast()
  const { data: users = [], isLoading, isError } = useWorkspaceUsers()
  const resend = useResendWorkspaceInvite()
  const [searchTerm, setSearchTerm] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageUser, setManageUser] = useState<WorkspaceUser | null>(null)

  const handleResend = (user: WorkspaceUser) => {
    resend.mutate(user.userId, {
      onSuccess: () => toast(`Invitation resent to ${user.email}`, 'success'),
      onError: (e) => toast((e as Error).message || 'Failed to resend invitation', 'error'),
    })
  }

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      workspaceUserDisplayName(u).toLowerCase().includes(q))
  }, [users, searchTerm])

  return (
    <div className="max-w-6xl mx-auto p-6 sm:p-8">
      <HrPageHeader
        crumb="Settings"
        title="Workspace Users"
        subtitle={`${users.length} members in your workspace`}
        actions={
          <Can code={P.WORKSPACE_USERS_MANAGE}>
            <HrButton onClick={() => setInviteOpen(true)}>
              <Plus size={16} /> Invite User
            </HrButton>
          </Can>
        }
      />

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <EmptyState variant="error" title="Couldn't load users" description="Please try again." />
      ) : users.length === 0 ? (
        <EmptyState
          variant="first-run"
          title="No workspace users yet"
          description="Invite your first teammate to get started."
          primaryAction={{ label: 'Invite User', onClick: () => setInviteOpen(true) }}
        />
      ) : (
        <TableCard
          search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search by name or email…' }}
        >
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState variant="filtered" title="No matches" description="Try a different search." />
            </div>
          ) : (
            <table className="hr-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user, i) => {
                  const name = workspaceUserDisplayName(user)
                  const sub = user.employeeId == null ? `${user.email} · user only` : user.email
                  return (
                    <tr key={user.userId}>
                      <td><HrAvatar name={name} sub={sub} seed={i} /></td>
                      <td><RolesCell user={user} /></td>
                      <td><StatusBadge status={user.status} /></td>
                      <td className="text-right">
                        <Can code={P.WORKSPACE_USERS_MANAGE}>
                          <div className="inline-flex items-center justify-end gap-1">
                            {user.status === 'INVITED' && (() => {
                              const sending = resend.isPending && resend.variables === user.userId
                              const failed = user.invitationSendStatus === 'FAILED'
                              const queued = user.invitationSendStatus === 'PENDING'
                              const label = sending || queued ? 'Sending…' : failed ? 'Retry invitation' : 'Resend invitation'
                              return (
                                <button
                                  onClick={() => handleResend(user)}
                                  disabled={sending || queued}
                                  title={failed && user.lastSendError ? user.lastSendError : undefined}
                                  className={clsx(
                                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50',
                                    failed ? 'text-[#B91C1C] hover:bg-[#FEE2E2]' : 'text-[#C16E00] hover:bg-[#FFF4E1]',
                                  )}
                                >
                                  <Send size={12} />
                                  {label}
                                </button>
                              )
                            })()}
                            <button
                              onClick={() => setManageUser(user)}
                              className="px-3 py-1.5 text-xs font-bold text-[#C16E00] hover:bg-[#FFF4E1] rounded-lg transition-colors"
                            >
                              Manage access
                            </button>
                          </div>
                        </Can>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {inviteOpen && <InviteWorkspaceUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />}
      {manageUser && (
        <ManageAccessDrawer user={manageUser} open={!!manageUser} onClose={() => setManageUser(null)} />
      )}
    </div>
  )
}

export const Users: React.FC = () => (
  <Can
    code={P.WORKSPACE_USERS_READ}
    fallback={
      <div className="p-8">
        <EmptyState
          variant="forbidden"
          title="Access restricted"
          description="You don't have permission to manage workspace users."
        />
      </div>
    }
  >
    <UsersInner />
  </Can>
)
