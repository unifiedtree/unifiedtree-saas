import React, { useMemo, useState } from 'react'
import { Plus, Search, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { Can, P } from '@unifiedtree/sdk'
import { Badge, Avatar, EmptyState, TableSkeleton } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
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
  if (status === 'ACTIVE')  return <Badge tone="success">Active</Badge>
  if (status === 'INVITED') return <Badge tone="warning">Invited</Badge>
  return <Badge tone="default">Inactive</Badge>
}

function RolesCell({ user }: { user: WorkspaceUser }) {
  if (user.roles.length === 0) return <Badge tone="warning">No access</Badge>
  const groups = groupRolesByModule(user.roles)
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map(([moduleKey, roles]) => (
        <div key={moduleKey} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-14 shrink-0">
            {MODULE_LABEL[moduleKey] ?? moduleKey}
          </span>
          {roles.map(r => <Badge key={r.roleCode} tone="accent">{r.displayName}</Badge>)}
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">Workspace Users</h1>
          <p className="text-sm text-slate-500 mt-1">{users.length} members in your workspace</p>
        </div>
        <Can code={P.WORKSPACE_USERS_MANAGE}>
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 bg-[#0F6E56] hover:bg-[#0A5240] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <Plus size={16} /> Invite User
          </button>
        </Can>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          placeholder="Search by name or email…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#0F6E56] focus:bg-white focus:ring-4 focus:ring-[#0F6E56]/10 transition-all"
        />
      </div>

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
      ) : filtered.length === 0 ? (
        <EmptyState variant="filtered" title="No matches" description="Try a different search." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Roles</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(user => {
                const name = workspaceUserDisplayName(user)
                return (
                  <tr key={user.userId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={name} size="md" />
                        <div>
                          <p className="font-bold text-slate-900">{name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {user.email}
                            {user.employeeId == null && (
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">· user only</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><RolesCell user={user} /></td>
                    <td className="px-6 py-4"><StatusBadge status={user.status} /></td>
                    <td className="px-6 py-4 text-right">
                      <Can code={P.WORKSPACE_USERS_MANAGE}>
                        <div className="inline-flex items-center justify-end gap-1">
                          {user.status === 'INVITED' && (
                            <button
                              onClick={() => handleResend(user)}
                              disabled={resend.isPending && resend.variables === user.userId}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#0F6E56] hover:bg-[#0F6E56]/10 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <Send size={12} />
                              {resend.isPending && resend.variables === user.userId ? 'Sending…' : 'Resend invite'}
                            </button>
                          )}
                          <button
                            onClick={() => setManageUser(user)}
                            className="px-3 py-1.5 text-xs font-bold text-[#0F6E56] hover:bg-[#0F6E56]/10 rounded-lg transition-colors"
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
        </div>
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
