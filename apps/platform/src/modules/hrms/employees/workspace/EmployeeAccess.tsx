/**
 * Access — the client's request (1 Oct): "Roles and access of every employee should be there in
 * employee details, so the client can give access and do additional options."
 *
 * One person's sign-in state, their roles (give / remove) and their individual extra or removed
 * permissions, all through the endpoints Users & access uses today:
 *   GET    /v1/workspace/users                        find this employee's login (workspace.users.read)
 *   GET    /v1/workspace/assignable-roles             what can be given, and whether the viewer may give it
 *   POST   /v1/workspace/users/{userId}/roles         give a role      (workspace.users.manage)
 *   DELETE /v1/workspace/users/{userId}/roles/{code}  remove a role    (workspace.users.manage)
 *   GET/PUT /v1/workspace/users/{userId}/permissions  extra / removed permissions (rbac.access.manage-overrides)
 *   POST   /v1/workspace/users/{userId}/invite/resend resend an invitation (workspace.users.manage)
 * The server applies the levels rules (never your own roles, only what you hold, owner-only roles) and
 * audits every change; this tab only says up front what it will refuse. The tab is shown to people who
 * hold workspace.users.manage (with workspace.users.read, which finding the login needs).
 * Companies (6 Oct): their role in each company (rbac/components/CompanyAccessSection). Give a role →
 * Create makes a new role on the spot (POST /v1/rbac/roles, rbac.role.write, as Add employee's Access
 * step) and gives it straight away, through the same list of roles you may give, never around it.
 * The full Roles & access pages stay where they are (/users, /roles); this tab links to them.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, Callout, KeyValueGrid, ListRow, ListRows, Section, StatusPill, IconTile, type StatusTone } from '@/design/kit/display'
import { Dialog, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { useAuthStore } from '@/core/auth/authStore'
import { RISK_LABEL, isRisky, useCreateRole } from '@/modules/rbac/api/useRbac'
import {
  useAssignableRoles, useAssignRole, useRevokeRole, useUserPermissions, useWorkspaceUsers, useResendWorkspaceInvite,
  groupRolesByModule, type AssignableRole, type WorkspaceUser,
} from '@/modules/rbac/api/useWorkspaceAccess'
import { pickCreatedRole, type CreatedRolePick } from '@/modules/rbac/api/newPersonAccess'
import { CompanyAccessSection } from '@/modules/rbac/components/CompanyAccessSection'
import { RoleFields, newRoleBody, roleDraftFor, roleDraftProblem, type RoleDraft } from '@/modules/rbac/components/RoleFields'
import { CreateButton, CreatePanel, needPermission, useCreatePanel } from '@/shared/components/inlineCreate/InlineCreate'
import { UserPermissionOverrides } from '@/pages/users/UserPermissionOverrides'
import { sendInvite } from '../api/useInvitation'
import { invitationKey, useInvitationStatus } from '../api/useProfileData'
import { fmtDate, fmtDateTime } from './profileFormat'

const MODULE_LABEL: Record<string, string> = { hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts', attendance: 'Attendance', leave: 'Leave', core: 'Platform' }
// Only an owner may give or take away these (the server enforces it too).
const OWNER_ONLY = new Set(['OWNER', 'SUPER_ADMIN'])
const RISK_PILL: Record<string, StatusTone> = { MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' }
const USER_STATUS: Record<string, [string, StatusTone]> = { ACTIVE: ['Can sign in', 'brand'], INVITED: ['Invited, not joined yet', 'warning'], INACTIVE: ['Sign-in turned off', 'neutral'] }

/** Whether the viewer sees the Access tab: the existing access-management permission. */
export function useCanManageAccess() {
  const manage = usePermission(P.WORKSPACE_USERS_MANAGE)
  const read = usePermission(P.WORKSPACE_USERS_READ)
  return manage && read
}

export function EmployeeAccess({ employeeId, name, email, canInvite }: { employeeId: string; name: string; email?: string | null; canInvite: boolean }) {
  const navigate = useNavigate()
  const users = useWorkspaceUsers()
  const user = useMemo(() => users.data?.find((u) => u.employeeId === employeeId) ?? null, [users.data, employeeId])
  const canRoleWrite = usePermission('rbac.role.write'), canPlatform = usePermission(P.PLATFORM_ADMIN)
  const canRoles = canRoleWrite || canPlatform

  const links = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button size={36} variant="secondary" icon="users" onClick={() => navigate('/users')}>Open Users &amp; access</Button>
      {canRoles && <Button size={36} variant="secondary" icon="shield" onClick={() => navigate('/roles')}>Roles &amp; permissions</Button>}
    </div>
  )

  if (users.isLoading || users.error) {
    return (
      <Section title="Sign-in" loading={users.isLoading} error={users.error} onRetry={() => void users.refetch()} skeleton="text">{null}</Section>
    )
  }
  if (!user) return <NoLogin employeeId={employeeId} name={name} email={email} canInvite={canInvite} links={links} />
  return <UserAccess user={user} name={name} links={links} />
}

/** No login yet: an invitation creates one. */
function NoLogin({ employeeId, name, email, canInvite, links }: { employeeId: string; name: string; email?: string | null; canInvite: boolean; links: React.ReactNode }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const inv = useInvitationStatus(employeeId, true)
  const invited = !!inv.data?.invitedAt
  const invite = async () => {
    if (!email) { toast.error('Add a work email before sending an invitation'); return }
    setBusy(true)
    try {
      await sendInvite(employeeId)
      await Promise.all([qc.invalidateQueries({ queryKey: invitationKey(employeeId) }), qc.invalidateQueries({ queryKey: ['rbac', 'workspace', 'users'] })])
      toast.success(`Invitation sent to ${email}`)
    } catch (e) {
      toast.error('Couldn’t send the invitation', { detail: (e as Error)?.message })
    } finally { setBusy(false) }
  }
  return (
    <div className="upf-stack">
      <Section title="Sign-in" sub={`${name} has no login in this workspace yet, so there are no roles to change.`}
        actions={canInvite ? <Button size={36} variant="primary" icon="mail" loading={busy} onClick={invite}>{invited ? 'Send invitation again' : 'Send invitation'}</Button> : undefined}>
        <KeyValueGrid items={[
          { label: 'Sign-in status', value: <StatusPill tone="warning" dot>{invited ? 'Invited, not joined yet' : 'No login yet'}</StatusPill> },
          { label: 'Work email', value: email || '—' },
          { label: 'Invitation', value: invited ? `Sent ${fmtDate(inv.data?.invitedAt)}` : 'Not sent' },
        ]} />
      </Section>
      <Section title="Roles and permissions" sub="Roles are given once they have a login. The invitation gives them the Employee role.">{links}</Section>
    </div>
  )
}

function UserAccess({ user, name, links }: { user: WorkspaceUser; name: string; links: React.ReactNode }) {
  const toast = useToast()
  const hasModule = useAuthStore((s) => s.hasModule)
  const canManage = usePermission(P.WORKSPACE_USERS_MANAGE)
  const roles = useAssignableRoles()
  const access = useUserPermissions(user.userId)
  const inv = useInvitationStatus(user.employeeId ?? '', !!user.employeeId)
  const assign = useAssignRole(), revoke = useRevokeRole(), resend = useResendWorkspaceInvite()
  const [picking, setPicking] = useState(false)
  const [confirmGrant, setConfirmGrant] = useState<AssignableRole | null>(null)
  const [confirmLast, setConfirmLast] = useState<AssignableRole | null>(null)
  const canCreateRole = usePermission(P.RBAC_ROLE_WRITE)
  const roleCreate = useCreatePanel()
  const createRole = useCreateRole()
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(() => roleDraftFor('create'))

  const all = roles.data ?? []
  const byCode = useMemo(() => new Map(all.map((r) => [r.roleCode, r])), [all])
  const held = new Set(user.roles.map((r) => r.roleCode))
  const busy = assign.isPending || revoke.isPending
  // Your own roles, or an owner's when you aren't one: the server refuses, so say why up front.
  const rolesLocked = access.data ? !access.data.canChangeRoles : false
  const lockedReason = access.data?.rolesBlockedReason || 'You can’t change this person’s roles.'
  const moduleActive = (r: Pick<AssignableRole, 'module' | 'moduleActive'>) => r.module === 'core' || (r.moduleActive ?? hasModule(r.module))

  const removeWhy = (code: string): string | null => {
    if (!canManage) return 'You can’t change roles.'
    if (rolesLocked) return lockedReason
    const r = byCode.get(code)
    return OWNER_ONLY.has(code) && r?.canGrant === false ? r.grantBlockedReason ?? 'Only an owner can remove this role.' : null
  }
  const giveWhy = (r: AssignableRole): string | null => {
    if (rolesLocked) return lockedReason
    if (!moduleActive(r)) return `Switch on ${MODULE_LABEL[r.module] ?? r.module} for this workspace to give its roles.`
    return r.canGrant === false ? r.grantBlockedReason ?? 'You can’t give this role.' : null
  }

  const give = (r: AssignableRole) => assign.mutate({ userId: user.userId, roleCode: r.roleCode }, {
    onSuccess: () => { toast.success(`${r.displayName} given to ${name}`); setConfirmGrant(null); setPicking(false) },
    onError: (e) => { toast.error('Couldn’t give the role', { detail: (e as Error).message }); setConfirmGrant(null) },
  })
  const remove = (code: string, label: string) => revoke.mutate({ userId: user.userId, roleCode: code }, {
    onSuccess: () => { toast.success(user.roles.length === 1 ? `${label} removed. ${name} now has no access.` : `${label} removed from ${name}`); setConfirmLast(null) },
    onError: (e) => { toast.error('Couldn’t remove the role', { detail: (e as Error).message }); setConfirmLast(null) },
  })
  const onGive = (r: AssignableRole) => { if (isRisky(r.riskLevel)) setConfirmGrant(r); else give(r) }
  // A new role made here is given through the list of roles you may give (read again after it is made).
  const startCreateRole = () => { setRoleDraft(roleDraftFor('create')); roleCreate.start() }
  const saveRole = () => void roleCreate.save(async (): Promise<CreatedRolePick> => {
    const missing = roleDraftProblem(roleDraft, true)
    if (missing) throw new Error(missing)
    const created = await createRole.mutateAsync(newRoleBody(roleDraft))
    const fresh = await roles.refetch()
    if (fresh.isError) return { kind: 'skip', reason: `${created.displayName} was created, but the list of roles couldn’t be loaded again, so it wasn’t given. Give it once the list is back.` }
    return pickCreatedRole(created.code, created.displayName, fresh.data ?? [])
  }, {
    then: (pick) => {
      if (pick.kind === 'skip') { toast.info(pick.reason, { duration: 7000 }); return }
      if (pick.kind === 'confirm') { setConfirmGrant(pick.role); return }
      give(pick.role)
      toast.info('The new role has no permissions yet. Choose what it can do in Roles & permissions.', { duration: 7000 })
    },
  })
  const onRemove = (code: string, label: string) => {
    if (user.roles.length === 1) { setConfirmLast(byCode.get(code) ?? { roleCode: code, displayName: label, module: 'core', moduleActive: true }); return }
    remove(code, label)
  }

  const [stLabel, stTone] = USER_STATUS[user.status] ?? [user.status, 'neutral' as StatusTone]
  const lastAt = inv.data?.lastLoginAt || user.lastLoginAt
  const device = inv.data?.lastLoginDevice
  const failed = user.invitationSendStatus === 'FAILED', queued = user.invitationSendStatus === 'PENDING'
  const sending = resend.isPending
  const giveable = all.filter((r) => !held.has(r.roleCode))

  return (
    <div className="upf-stack">
      <Section title="Sign-in" sub="Whether they can sign in, and when they last did."
        actions={canManage && user.status === 'INVITED' ? (
          <Button size={36} variant="secondary" icon="mail" loading={sending || queued} title={failed && user.lastSendError ? user.lastSendError : undefined}
            onClick={() => resend.mutate(user.userId, { onSuccess: () => toast.success(`Invitation sent again to ${user.email}`), onError: (e) => toast.error('Couldn’t resend the invitation', { detail: (e as Error).message }) })}>
            {failed ? 'Retry invitation' : 'Resend invitation'}
          </Button>
        ) : undefined}>
        <KeyValueGrid items={[
          { label: 'Sign-in status', value: <StatusPill tone={stTone} dot>{stLabel}</StatusPill> },
          { label: 'Sign-in email', value: user.email },
          { label: 'Last sign-in', value: lastAt ? [fmtDateTime(lastAt), device].filter(Boolean).join(' · ') : 'Hasn’t signed in yet' },
          ...(user.status === 'INVITED' ? [{ label: 'Invitation email', value: failed ? 'Didn’t go out' : queued ? 'Sending' : 'Sent' }] : []),
        ]} />
        {user.status === 'INVITED' && failed && <Callout tone="danger">The invitation email didn’t go out{user.lastSendError ? `: ${user.lastSendError}` : '.'}</Callout>}
      </Section>

      <Section title="Roles" count={user.roles.length || undefined} sub="What they can reach. Each role gives a set of permissions; the change applies the next time they sign in."
        actions={canManage ? <Button size={36} variant="primary" icon="plus" disabled={busy || rolesLocked} title={rolesLocked ? lockedReason : undefined} onClick={() => setPicking(true)}>Give a role</Button> : undefined}
        body="list" empty={user.roles.length === 0 ? { title: 'No roles', hint: `${name} sees a No access screen until a role is given.` } : undefined}>
        {rolesLocked && <div style={{ padding: '0 20px 8px' }}><Callout tone="warning">{lockedReason}</Callout></div>}
        <ListRows label={`${name}’s roles`} inset>
          {user.roles.map((r) => {
            const info = byCode.get(r.roleCode)
            const why = removeWhy(r.roleCode)
            return (
              <ListRow key={r.roleCode} variant="hover"
                leading={<IconTile icon="shield" tone="brand" />}
                title={r.displayName}
                sub={[MODULE_LABEL[r.module] ?? r.module, info?.description].filter(Boolean).join(' · ')}
                end={info?.riskLevel && isRisky(info.riskLevel) ? <StatusPill tone={RISK_PILL[info.riskLevel] ?? 'neutral'}>{RISK_LABEL[info.riskLevel]}</StatusPill> : undefined}
                actions={canManage ? (
                  <Button size={30} variant="danger-outline" disabled={busy || !!why} title={why ?? undefined} aria-label={`Remove ${r.displayName}`}
                    onClick={() => onRemove(r.roleCode, r.displayName)}>Remove</Button>
                ) : undefined} />
            )
          })}
        </ListRows>
      </Section>

      <CompanyAccessSection userId={user.userId} name={name} locked={rolesLocked} lockedReason={lockedReason} />

      <Section title="Permissions" sub="Individual changes on top of their roles, and everything they can do as a result."
        loading={access.isLoading} error={access.error} onRetry={() => void access.refetch()} skeleton="list">
        {access.data && (
          <UserPermissionOverrides view={access.data} userName={name}
            onDone={(message, error) => (error ? toast.error(message, { detail: error }) : toast.success(message))} />
        )}
      </Section>

      <Section title="Roles & access pages" sub="Manage everyone’s access, and what each role includes.">{links}</Section>

      <SidePanel open={picking} onClose={() => setPicking(false)} title="Give a role" sub={`To ${name}. They get it the next time they sign in.`} busy={assign.isPending}
        footer={<PanelButton size="lg" onClick={() => setPicking(false)}>Done</PanelButton>}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <span className="upf-note">Not the right role? Create one and give it now.</span>
          <CreateButton ref={roleCreate.trigger} noun="role" blockedReason={!canCreateRole ? needPermission('roles') : rolesLocked ? lockedReason : null} onClick={startCreateRole} />
        </div>
        {roles.isLoading ? <p className="upf-note">Loading roles…</p>
          : roles.error ? <Callout tone="danger">Couldn’t load the roles: {(roles.error as Error).message}</Callout>
            : giveable.length === 0 ? <p className="upf-note">{name} already has every role.</p>
              : groupRolesByModule(giveable).map(([mod, list]) => (
                <div key={mod} style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--u-ink3,#6A7A73)' }}>{MODULE_LABEL[mod] ?? mod}</div>
                  <ListRows label={`${MODULE_LABEL[mod] ?? mod} roles`}>
                    {list.map((r) => {
                      const why = giveWhy(r)
                      return (
                        <ListRow key={r.roleCode} variant="divided" title={r.displayName}
                          sub={why ?? r.description ?? undefined}
                          end={isRisky(r.riskLevel) ? <StatusPill tone={RISK_PILL[r.riskLevel!] ?? 'neutral'}>{RISK_LABEL[r.riskLevel!]}</StatusPill> : undefined}
                          actions={<Button size={32} variant="soft" disabled={busy || !!why} title={why ?? undefined} aria-label={`Give ${r.displayName}`} onClick={() => onGive(r)}>Give</Button>} />
                      )
                    })}
                  </ListRows>
                </div>
              ))}
      </SidePanel>

      <Dialog open={!!confirmGrant} onClose={() => setConfirmGrant(null)} title={`Give the ${confirmGrant?.displayName ?? ''} role?`} icon="alertTriangle"
        tone={confirmGrant?.riskLevel === 'CRITICAL' ? 'danger' : 'warning'} busy={assign.isPending}
        footer={<>
          <PanelButton onClick={() => setConfirmGrant(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={assign.isPending} onClick={() => confirmGrant && give(confirmGrant)}>Give role</PanelButton>
        </>}>
        {confirmGrant && (
          <Callout tone={confirmGrant.riskLevel === 'CRITICAL' ? 'danger' : 'warning'}>
            {RISK_LABEL[confirmGrant.riskLevel!]}: {confirmGrant.riskLevel === 'CRITICAL'
              ? `${name} will be able to change who can do what, billing or the workspace itself.`
              : `${name} will be able to see or change money, salaries or personal data.`}
            {confirmGrant.description ? ` ${confirmGrant.description}` : ''} The change is recorded in the audit log.
          </Callout>
        )}
      </Dialog>

      <CreatePanel open={roleCreate.open} title="New role" cta="Create and give" busy={roleCreate.busy || assign.isPending} error={roleCreate.error}
        sub={`It starts with no permissions and is given to ${name}. Choose what it can do in Roles & permissions.`}
        onCancel={roleCreate.cancel} onSubmit={saveRole}>
        <RoleFields draft={roleDraft} onChange={setRoleDraft} showCode />
      </CreatePanel>

      <Dialog open={!!confirmLast} onClose={() => setConfirmLast(null)} title="Remove their last role?" icon="alertTriangle" tone="danger" busy={revoke.isPending}
        sub={`${name} (${user.email}) will have no roles and will see a No access screen until a role is given.`}
        footer={<>
          <PanelButton onClick={() => setConfirmLast(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={revoke.isPending} onClick={() => confirmLast && remove(confirmLast.roleCode, confirmLast.displayName)}>Remove role</PanelButton>
        </>} />
    </div>
  )
}
