// Users & access (/users), on the module kit: everyone who can sign in to the
// workspace, their roles by module, and invitation state.
//   list: workspace.users.read · invite / resend / manage access: workspace.users.manage
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
import { ModulePage, Views, StatRow, State, useDesignToast } from '@/design/module/ModuleKit'
import {
  useWorkspaceUsers, useResendWorkspaceInvite, workspaceUserDisplayName, groupRolesByModule,
  type WorkspaceUser, type WorkspaceUserStatus,
} from '@/modules/rbac/api/useWorkspaceAccess'
import { ManageAccessDrawer } from './users/ManageAccessDrawer'
import { InviteWorkspaceUserModal } from './users/InviteWorkspaceUserModal'

const MODULE_LABEL: Record<string, string> = { hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts', attendance: 'Attendance', leave: 'Leave', core: 'Platform' }
const STATUS: Record<WorkspaceUserStatus, [string, 'ok' | 'warn' | 'gray']> = { ACTIVE: ['Active', 'ok'], INVITED: ['Invited', 'warn'], INACTIVE: ['Inactive', 'gray'] }
type Filter = 'all' | 'active' | 'invited' | 'noaccess'

function RolesCell({ user }: { user: WorkspaceUser }) {
  if (user.roles.length === 0) return <HrStatusPill tone="warn">No access yet</HrStatusPill>
  return (
    <div className="flex flex-col gap-1.5">
      {groupRolesByModule(user.roles).map(([moduleKey, roles]) => (
        <div key={moduleKey} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-text-tertiary">{MODULE_LABEL[moduleKey] ?? moduleKey}</span>
          {roles.map((r) => <HrStatusPill key={r.roleCode} tone="info">{r.displayName}</HrStatusPill>)}
        </div>
      ))}
    </div>
  )
}

export const Users: React.FC = () => {
  const canRead = usePermission(P.WORKSPACE_USERS_READ)
  const canManage = usePermission(P.WORKSPACE_USERS_MANAGE)
  const { show, node } = useDesignToast()
  const { data: users = [], isLoading, isError, error, refetch } = useWorkspaceUsers()
  const resend = useResendWorkspaceInvite()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageUserId, setManageUserId] = useState<string | null>(null)
  const manageUser = users.find((u) => u.userId === manageUserId) ?? null
  const counts = useMemo(() => ({
    active: users.filter((u) => u.status === 'ACTIVE').length,
    invited: users.filter((u) => u.status === 'INVITED').length,
    noaccess: users.filter((u) => u.roles.length === 0).length,
  }), [users])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => (filter === 'all' || (filter === 'active' && u.status === 'ACTIVE') || (filter === 'invited' && u.status === 'INVITED') || (filter === 'noaccess' && u.roles.length === 0))
      && (!q || u.email.toLowerCase().includes(q) || workspaceUserDisplayName(u).toLowerCase().includes(q)))
  }, [users, search, filter])
  const handleResend = (user: WorkspaceUser) => {
    resend.mutate(user.userId, {
      onSuccess: () => show(`Invitation sent again to ${user.email}`),
      onError: (e) => show('Couldn’t resend the invitation', true, (e as Error).message),
    })
  }

  if (!canRead) return <ModulePage crumb="Settings" title="Users & access"><State kind="empty" icon="lock" title="Access restricted" description="Your role can’t see workspace users." /></ModulePage>
  return (
    <ModulePage crumb="Settings" title="Users & access" subtitle="Everyone who can sign in, what they can reach, and pending invitations."
      actions={canManage ? <HrButton onClick={() => setInviteOpen(true)}><Plus size={15} /> Invite user</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {isLoading ? <State kind="loading" height={96} /> : !isError && <StatRow tiles={[
          { icon: 'users', color: 'blue', label: 'Members', value: String(users.length), sub: 'In this workspace', onClick: () => setFilter('all') },
          { icon: 'userCheck', color: 'green', label: 'Active', value: String(counts.active), sub: 'Can sign in', onClick: () => setFilter('active') },
          { icon: 'inbox', color: 'orange', label: 'Invited', value: String(counts.invited), sub: 'Not joined yet', onClick: () => setFilter('invited') },
          { icon: 'lock', color: 'red', label: 'No access yet', value: String(counts.noaccess), sub: 'No role assigned', onClick: () => setFilter('noaccess') },
        ]} />}
        {!isLoading && !isError && users.length > 0 && (
          <Views label="User filters" active={filter} onChange={(k) => setFilter(k as Filter)} items={[
            { key: 'all', label: 'Everyone', count: users.length },
            { key: 'active', label: 'Active', count: counts.active },
            { key: 'invited', label: 'Invited', count: counts.invited, urgent: counts.invited > 0 },
            { key: 'noaccess', label: 'No access', count: counts.noaccess, urgent: counts.noaccess > 0 },
          ]} />
        )}
        {isLoading ? <State kind="loading" height={220} />
          : isError ? <State kind="error" title="Couldn’t load users" description={(error as Error)?.message} onRetry={() => refetch()} />
            : users.length === 0 ? <State kind="empty" icon="users" title="No users yet" description={canManage ? 'Invite your first teammate to get started.' : 'Users an admin invites appear here.'} />
              : (
                <TableCard search={{ value: search, onChange: setSearch, placeholder: 'Search by name or email' }}>
                  {filtered.length === 0 ? <State kind="empty" icon="users" title="No one matches" description="Try another search or filter." /> : (
                    <table className="hr-table">
                      <thead><tr><th>User</th><th>Roles</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                      <tbody>
                        {filtered.map((user, i) => {
                          const [st, tone] = STATUS[user.status] ?? [user.status, 'gray']
                          const sending = resend.isPending && resend.variables === user.userId
                          const failed = user.invitationSendStatus === 'FAILED', queued = user.invitationSendStatus === 'PENDING'
                          return (
                            <tr key={user.userId}>
                              <td><HrAvatar name={workspaceUserDisplayName(user)} sub={user.employeeId == null ? `${user.email} · no employee record` : user.email} seed={i} /></td>
                              <td><RolesCell user={user} /></td>
                              <td>
                                <HrStatusPill tone={tone}>{st}</HrStatusPill>
                                {user.status === 'INVITED' && failed && <p className="mt-1 max-w-[220px] text-xs text-[#b91c1c]" title={user.lastSendError ?? undefined}>The invitation email didn’t go out</p>}
                              </td>
                              {canManage && (
                                <td>
                                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    {user.status === 'INVITED' && (
                                      <HrButton size="sm" variant="ghost" onClick={() => handleResend(user)} disabled={sending || queued} title={failed && user.lastSendError ? user.lastSendError : undefined}>
                                        {sending || queued ? 'Sending…' : failed ? 'Retry invitation' : 'Resend invitation'}
                                      </HrButton>
                                    )}
                                    <HrButton size="sm" variant="ghost" onClick={() => setManageUserId(user.userId)}>Manage access</HrButton>
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </TableCard>
              )}
      </div>
      {inviteOpen && <InviteWorkspaceUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />}
      {manageUser && <ManageAccessDrawer user={manageUser} open={!!manageUser} onClose={() => setManageUserId(null)} />}
      {node}
    </ModulePage>
  )
}
