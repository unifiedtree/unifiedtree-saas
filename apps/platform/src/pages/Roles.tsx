import React, { useState, useMemo } from 'react'
import { Shield, Search, X, UserCog, Plus, KeyRound, Copy, Pencil, Trash2 } from 'lucide-react'
import { DataTable, Badge, Drawer, Button, Modal } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { ModulePage, Views, useView, StatRow, State, Note } from '@/design/module/ModuleKit'
import {
  useRoles, usePermissionsCatalogue, useRolePermissions, useSetRolePermissions,
  useUserRoles, useGrantRole, useRevokeRole,
  useCreateRole, useUpdateRole, useDeleteRole, useDuplicateRole,
  RISK_LABEL, RISK_TONE, isRisky,
} from '@/modules/rbac/api/useRbac'
import type { RbacRole, RbacPermission } from '@/modules/rbac/api/useRbac'
import { useWorkspaceUsers, useAssignableRoles, workspaceUserDisplayName } from '@/modules/rbac/api/useWorkspaceAccess'

type RoleEditorState = { mode: 'create' | 'edit' | 'clone'; role?: RbacRole }

/** "Senior manager" → "SENIOR_MANAGER" (the same rule the server uses when no code is given). */
const codeFromName = (name: string) => {
  const c = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (c && /^[A-Z]/.test(c) ? c : c ? `ROLE_${c}` : '').slice(0, 50)
}
const errorText = (e: unknown) => (e as { message?: string })?.message || 'Please try again.'

// ── Permission Drawer ──────────────────────────────────────────────────────────

function PermissionsDrawer({
  role,
  permissions,
  onClose,
}: {
  role: RbacRole
  permissions: RbacPermission[]
  onClose: () => void
}) {
  const { data: currentPerms, isLoading: loadingPerms, isError: permsError, refetch: refetchPerms, isSuccess: permsLoaded } = useRolePermissions(role.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialised, setInitialised] = useState(false)
  const setPerms = useSetRolePermissions(role.id)
  const readOnly = role.systemRole

  React.useEffect(() => {
    if (permsLoaded && !initialised) {
      setSelected(new Set(currentPerms ?? []))
      setInitialised(true)
    }
  }, [permsLoaded, initialised, currentPerms])

  const byModule = useMemo(
    () =>
      permissions.reduce<Record<string, RbacPermission[]>>((acc, p) => {
        ;(acc[p.module] ??= []).push(p)
        return acc
      }, {}),
    [permissions],
  )

  const toggle = (code: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(code)
      else next.delete(code)
      return next
    })
  }

  const toggleModule = (moduleCodes: string[]) => {
    const allOn = moduleCodes.every((c) => selected.has(c))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOn) moduleCodes.forEach((c) => next.delete(c))
      else moduleCodes.forEach((c) => next.add(c))
      return next
    })
  }

  // Adding a HIGH / CRITICAL permission to a role gives it to everyone who holds
  // the role, so the warnings are shown and confirmed first (the server insists).
  const [confirmRisky, setConfirmRisky] = useState<RbacPermission[] | null>(null)
  const byCode = useMemo(() => new Map(permissions.map((p) => [p.code, p])), [permissions])
  const save = (acknowledgeRisk: boolean) => {
    setPerms.mutate({ codes: Array.from(selected), acknowledgeRisk }, {
      onSuccess: () => {
        toast.success(`Permissions updated — ${selected.size} granted to ${role.displayName}`)
        setConfirmRisky(null)
        onClose()
      },
      onError: (e) => { setConfirmRisky(null); toast.error('Couldn’t update the permissions', { description: errorText(e) }) },
    })
  }
  const handleSave = () => {
    if (readOnly) return
    const added = Array.from(selected).filter((c) => !currentPerms?.includes(c))
    const risky = added.map((c) => byCode.get(c)).filter((p): p is RbacPermission => !!p && isRisky(p.riskLevel))
    if (risky.length) { setConfirmRisky(risky); return }
    save(false)
  }

  const isDirty = initialised && (
    selected.size !== (currentPerms?.length ?? 0) ||
    Array.from(selected).some((c) => !currentPerms?.includes(c))
  )

  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={`${role.displayName} — Permissions`}
    >
      <div className="space-y-4">
        {readOnly && <p className="rounded-lg border border-border-default bg-bg-subtle p-3 text-sm text-text-secondary">System role permissions are fixed. Clone this role from the roles list to customize access for your company.</p>}
        {/* Summary bar */}
        {initialised && (
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-border-default px-3 py-2">
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{selected.size}</span> of {permissions.length} permissions granted
            </span>
            {isDirty && <span className="text-xs text-amber-600 font-medium">● Unsaved changes</span>}
          </div>
        )}

        {loadingPerms ? (
          <div className="py-8 text-center text-sm text-text-tertiary">Loading current permissions…</div>
        ) : permsError ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center space-y-2">
            <p className="text-sm text-red-400">Failed to load current permissions</p>
            <button onClick={() => refetchPerms()} className="text-xs text-red-300 underline hover:text-red-200">Retry</button>
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {Object.entries(byModule).sort(([a], [b]) => a.localeCompare(b)).map(([module, perms]) => {
              const codes = perms.map((p) => p.code)
              const allOn = codes.every((c) => selected.has(c))
              const someOn = codes.some((c) => selected.has(c))
              return (
              <div key={module} className="rounded-lg border border-border-default overflow-hidden">
                {/* Module header — click to toggle all */}
                <button
                  disabled={readOnly}
                  onClick={() => toggleModule(codes)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{module}</span>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${allOn ? 'bg-green-100 text-green-700' : someOn ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>
                    {codes.filter((c) => selected.has(c)).length}/{codes.length}
                    {allOn ? ' ✓ all' : someOn ? ' partial' : ' none'}
                  </span>
                </button>
                <div className="divide-y divide-border-default/50">
                  {perms.map((p) => (
                    <label
                      key={p.code}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-interactive-hover transition-colors"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 flex-shrink-0 accent-[#059669] h-4 w-4"
                        checked={selected.has(p.code)}
                        disabled={readOnly}
                        onChange={(e) => toggle(p.code, e.target.checked)}
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary">
                          {p.displayName}
                          {p.riskLevel && p.riskLevel !== 'LOW' && <span className="ml-2"><HrStatusPill tone={RISK_TONE[p.riskLevel]}>{RISK_LABEL[p.riskLevel]}</HrStatusPill></span>}
                        </p>
                        {p.description && <p className="text-xs text-text-secondary">{p.description}</p>}
                        {isRisky(p.riskLevel) && p.warning && <p className="text-xs text-text-tertiary">{p.warning}</p>}
                        <p className="font-mono text-xs text-text-tertiary">{p.code}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )})}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border-default pt-4">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {readOnly ? 'Done' : 'Cancel'}
          </Button>
          {!readOnly && <Button
            size="sm"
            loading={setPerms.isPending}
            onClick={handleSave}
            disabled={!initialised || loadingPerms}
          >
            Save permissions
          </Button>}
        </div>
      </div>
      {confirmRisky && (
        <Modal open onOpenChange={(o) => { if (!o) setConfirmRisky(null) }} title="Add high-risk permissions?"
          description={`Everyone who holds ${role.displayName} gets these. Please read before confirming.`} size="sm">
          <div className="space-y-2">
            {confirmRisky.map((p) => (
              <Note key={p.code} tone={p.riskLevel === 'CRITICAL' ? 'red' : 'amber'}><strong>{p.displayName}</strong> ({RISK_LABEL[p.riskLevel]}): {p.warning ?? p.description}</Note>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmRisky(null)}>Cancel</Button>
              <Button size="sm" variant="danger" loading={setPerms.isPending} onClick={() => save(true)}>Yes, add them</Button>
            </div>
          </div>
        </Modal>
      )}
    </Drawer>
  )
}

// ── Assignments tab ─────────────────────────────────────────────────────────────

function AssignmentsTab({ roles }: { roles: RbacRole[] }) {
  const { data: users = [], isLoading: usersLoading } = useWorkspaceUsers()
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const { data: userRoles, isLoading: userRolesLoading } = useUserRoles(selectedUserId)
  const grant = useGrantRole()
  const revoke = useRevokeRole()
  // Which roles the signed-in admin may give (levels: only what you hold,
  // critical ones and Owner / Super admin only by the owner).
  const { data: assignable = [] } = useAssignableRoles()
  const assignableByCode = useMemo(() => new Map(assignable.map((a) => [a.roleCode, a])), [assignable])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || workspaceUserDisplayName(u).toLowerCase().includes(q),
    )
  }, [users, search])

  const selectedUser = users.find((u) => u.userId === selectedUserId)
  const assignedRoleIds = new Set((userRoles?.roles ?? []).map((r) => r.id))
  // Platform roles and the legacy MANAGER role are never offered; the server has the final say on the rest.
  const availableRoles = roles.filter((r) => !assignedRoleIds.has(r.id)
    && (assignable.length ? assignableByCode.has(r.code) : r.code !== 'PLATFORM_SUPER_ADMIN' && r.code !== 'MANAGER'))
  const busy = grant.isPending || revoke.isPending

  const handleGrant = (roleId: string) => {
    if (!selectedUserId || !roleId) return
    grant.mutate({ userId: selectedUserId, roleId }, {
      onSuccess: () => toast.success('Role granted'),
      onError: (e) => toast.error('Couldn’t grant the role', { description: (e as Error)?.message }),
    })
  }
  const handleRevoke = (roleId: string, label: string) => {
    if (!selectedUserId) return
    revoke.mutate({ userId: selectedUserId, roleId }, {
      onSuccess: () => toast.success(`Removed ${label}`),
      onError: (e) => toast.error('Couldn’t remove the role', { description: (e as Error)?.message }),
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* User list */}
      <div className="ut-card overflow-hidden">
        <div className="relative border-b border-border-default p-2.5">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="ut-input ut-input-sm w-full pl-8"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {usersLoading ? (
            <div className="p-4 text-sm text-text-tertiary">Loading users…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-text-tertiary">No users match “{search}”.</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.userId}
                onClick={() => setSelectedUserId(u.userId)}
                className={`block w-full border-b border-border-default/40 px-3 py-2 text-left transition-colors hover:bg-interactive-hover ${
                  selectedUserId === u.userId ? 'bg-accent-subtle' : ''
                }`}
              >
                <p className="truncate text-sm font-medium text-text-primary">{workspaceUserDisplayName(u)}</p>
                <p className="truncate text-xs text-text-tertiary">{u.email}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="ut-card p-5">
        {!selectedUser ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-text-tertiary">
            <UserCog size={28} className="mb-2" />
            <p className="text-sm">Select a user to view and manage their role assignments.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-text-primary">{workspaceUserDisplayName(selectedUser)}</h3>
              <p className="text-sm text-text-secondary">{selectedUser.email}</p>
            </div>

            {/* Assigned roles */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">Assigned roles</p>
              {userRolesLoading ? (
                <p className="text-sm text-text-tertiary">Loading…</p>
              ) : (userRoles?.roles.length ?? 0) === 0 ? (
                <p className="text-sm text-text-tertiary">No roles assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {userRoles!.roles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-slate-50 py-1 pl-3 pr-1.5 text-sm text-text-primary"
                    >
                      {r.displayName}
                      <button
                        onClick={() => handleRevoke(r.id, r.displayName)}
                        disabled={busy}
                        title="Revoke role"
                        className="rounded-full p-0.5 text-text-tertiary hover:bg-red-100 hover:text-red-600 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Grant a role */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">Grant a role</p>
              <select
                value=""
                disabled={busy || availableRoles.length === 0}
                onChange={(e) => handleGrant(e.target.value)}
                className="ut-select w-full max-w-sm"
              >
                <option value="">
                  {availableRoles.length === 0 ? 'All roles already assigned' : 'Select a role to grant…'}
                </option>
                {availableRoles.map((r) => {
                  const a = assignableByCode.get(r.code)
                  return (
                    <option key={r.id} value={r.id} disabled={a?.canGrant === false} title={a?.grantBlockedReason ?? undefined}>
                      {r.displayName} {r.systemRole ? '(built-in)' : '(custom)'}{a?.canGrant === false ? ' — you can’t give this' : ''}
                    </option>
                  )
                })}
              </select>
              {availableRoles.some((r) => assignableByCode.get(r.code)?.canGrant === false) && (
                <p className="mt-1.5 text-xs text-text-tertiary">Greyed-out roles include permissions you don’t hold, or can only be given by the workspace owner.</p>
              )}
            </section>

            {/* Effective permissions */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Effective permissions ({userRoles?.effectivePermissions.length ?? 0})
              </p>
              {(userRoles?.effectivePermissions.length ?? 0) === 0 ? (
                <p className="text-sm text-text-tertiary">No permissions — assign a role above.</p>
              ) : (
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                  {userRoles!.effectivePermissions.map((p) => (
                    <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                      {p}
                    </code>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Role editor (create / edit / clone) ─────────────────────────────────────────

function RoleEditorModal({ state, onClose, onCreated }: { state: RoleEditorState; onClose: () => void; onCreated: (role: RbacRole) => void }) {
  const { mode, role } = state
  const isCreate = mode === 'create' || mode === 'clone'
  const create = useCreateRole()
  const duplicate = useDuplicateRole()
  const update = useUpdateRole()

  const [displayName, setDisplayName] = useState(
    mode === 'edit' && role ? role.displayName : mode === 'clone' && role ? `${role.displayName} (copy)` : '',
  )
  // The code follows the name until someone types their own.
  const [code, setCode] = useState(mode === 'clone' && role ? codeFromName(`${role.displayName} copy`) : '')
  const [codeEdited, setCodeEdited] = useState(false)
  const [description, setDescription] = useState(mode === 'edit' && role ? role.description ?? '' : mode === 'clone' && role ? role.description ?? '' : '')

  const busy = create.isPending || update.isPending || duplicate.isPending
  const title = mode === 'create' ? 'New role' : mode === 'clone' ? `Duplicate “${role?.displayName}”` : `Edit “${role?.displayName}”`

  const submit = () => {
    if (isCreate) {
      if (!code.trim() || !displayName.trim()) { toast.error('Role code and name are required'); return }
      const body = { code: codeFromName(code), displayName: displayName.trim(), description: description.trim() || undefined }
      const done = {
        onSuccess: (created: RbacRole) => {
          toast.success(mode === 'clone' ? `${created.displayName} created from ${role?.displayName}` : 'Role created',
            { description: 'Now choose what this role can do.' })
          onClose()
          onCreated(created)
        },
        onError: (e: unknown) => toast.error(mode === 'clone' ? 'Couldn’t duplicate the role' : 'Couldn’t create the role', { description: errorText(e) }),
      }
      if (mode === 'clone' && role) duplicate.mutate({ roleId: role.id, ...body }, done)
      else create.mutate(body, done)
    } else {
      if (!displayName.trim()) { toast.error('Name is required'); return }
      update.mutate(
        { roleId: role!.id, displayName: displayName.trim(), description: description.trim() || undefined },
        {
          onSuccess: () => { toast.success('Role updated'); onClose() },
          onError: (e) => toast.error('Couldn’t update the role', { description: errorText(e) }),
        },
      )
    }
  }

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }} title={title}>
      <div className="space-y-4">
        {isCreate && (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Role code <span className="text-danger">*</span></label>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeEdited(true) }}
              placeholder="e.g. REGIONAL_HR"
              className="ut-input"
            />
            <p className="mt-1 text-xs text-text-tertiary">Uppercase identifier, unique within your workspace. Spaces become underscores. It can’t be a built-in role’s code.</p>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Display name <span className="text-danger">*</span></label>
          <input
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); if (isCreate && !codeEdited) setCode(codeFromName(e.target.value)) }}
            placeholder="e.g. Regional HR"
            className="ut-input"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this role for?"
            className="w-full rounded-xl border border-border/60 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        {mode === 'clone' && role && (
          <p className="rounded-lg bg-slate-50 border border-border-default px-3 py-2 text-xs text-text-secondary">
            Every permission of <span className="font-medium text-text-primary">{role.displayName}</span> is copied into the new role, and its permissions open next so you can add or remove some. {role.displayName} itself doesn’t change. You can only copy permissions you hold yourself.
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-border-default pt-4">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={submit}>{isCreate ? 'Create role' : 'Save changes'}</Button>
        </div>
      </div>
    </Drawer>
  )
}

function DeleteRoleConfirm({ role, onClose }: { role: RbacRole; onClose: () => void }) {
  const del = useDeleteRole()
  const { data: users } = useWorkspaceUsers()
  const holders = users?.filter((u) => u.roles.some((r) => r.roleCode === role.code)) ?? null
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }} title={`Delete “${role.displayName}”?`}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          This permanently deletes the <span className="font-mono text-xs">{role.code}</span> role, its permission set,
          and removes it from every user who currently holds it. This cannot be undone.
        </p>
        {holders && holders.length > 0 && (
          <Note tone="amber">
            {holders.length === 1 ? '1 person holds' : `${holders.length} people hold`} this role ({holders.slice(0, 5).map((u) => workspaceUserDisplayName(u)).join(', ')}{holders.length > 5 ? '…' : ''}).
            They lose everything it gives them unless another role gives it too.
          </Note>
        )}
        <div className="flex justify-end gap-2 border-t border-border-default pt-4">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={del.isPending}
            onClick={() =>
              del.mutate(role.id, {
                onSuccess: () => { toast.success('Role deleted'); onClose() },
                onError: (e) => toast.error('Couldn’t delete the role', { description: errorText(e) }),
              })
            }
            className="bg-red-600 hover:bg-red-700"
          >
            Delete role
          </Button>
        </div>
      </div>
    </Drawer>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export const Roles: React.FC = () => {
  const canWriteRoles = usePermission(P.RBAC_ROLE_WRITE)
  const [activeTab, setActiveTab] = useView(['roles', 'assignments', 'catalogue'])
  const [permSearch, setPermSearch] = useState('')
  const [drawerRole, setDrawerRole] = useState<RbacRole | null>(null)
  const [editorState, setEditorState] = useState<RoleEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RbacRole | null>(null)
  const [moduleFilter, setModuleFilter] = useState('')

  const { data: roles = [], isLoading: rolesLoading, error: rolesError, refetch: refetchRoles } = useRoles()
  const { data: permissions = [], isLoading: permsLoading, error: permsError, refetch: refetchPerms } = usePermissionsCatalogue()

  const roleColumns: Column<RbacRole>[] = [
    {
      key: 'displayName',
      header: 'Role',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
            <Shield size={13} className="text-accent-default" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">{row.displayName}</p>
            <p className="font-mono text-xs text-text-tertiary">{row.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      cell: (row) => (
        <span className="text-sm text-text-secondary">{row.description ?? '—'}</span>
      ),
      hideBelow: 'md',
    },
    {
      key: 'systemRole',
      header: 'Type',
      cell: (row) => (
        <Badge tone={row.systemRole ? 'info' : 'default'}>
          {row.systemRole ? 'System' : 'Tenant'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <Can code={P.RBAC_ROLE_WRITE}>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label={`${row.systemRole ? 'View' : 'Edit'} permissions for ${row.displayName}`}
              title={row.systemRole ? 'View permissions' : 'Edit permissions'}
              onClick={(e) => { e.stopPropagation(); setDrawerRole(row) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            >
              <KeyRound size={15} />
            </button>
            <button
              type="button"
              aria-label={`Duplicate ${row.displayName}`}
              title="Duplicate role"
              onClick={(e) => { e.stopPropagation(); setEditorState({ mode: 'clone', role: row }) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            >
              <Copy size={15} />
            </button>
            {!row.systemRole && (
              <button
                type="button"
                aria-label={`Edit ${row.displayName}`}
                title="Edit"
                onClick={(e) => { e.stopPropagation(); setEditorState({ mode: 'edit', role: row }) }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
              >
                <Pencil size={15} />
              </button>
            )}
            {!row.systemRole && (
              <button
                type="button"
                aria-label={`Delete ${row.displayName}`}
                title="Delete"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--status-error-bg)] hover:text-[var(--status-error-fg)]"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </Can>
      ),
    },
  ]

  const permColumns: Column<RbacPermission>[] = [
    {
      key: 'code',
      header: 'Permission code',
      cell: (row) => (
        <span className="font-mono text-sm text-text-primary">{row.code}</span>
      ),
    },
    {
      key: 'displayName',
      header: 'Name',
      cell: (row) => (
        <span className="text-sm text-text-secondary">{row.displayName}</span>
      ),
    },
    {
      key: 'module',
      header: 'Module',
      cell: (row) => <Badge tone="default">{row.module}</Badge>,
    },
    {
      key: 'description',
      header: 'What it lets someone do',
      cell: (row) => (
        <span className="text-xs text-text-secondary">
          {row.description ?? '—'}
          {isRisky(row.riskLevel) && row.warning && <span className="block text-text-tertiary">{row.warning}</span>}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      key: 'riskLevel',
      header: 'Risk',
      cell: (row) => row.riskLevel ? <HrStatusPill tone={RISK_TONE[row.riskLevel]}>{RISK_LABEL[row.riskLevel]}</HrStatusPill> : null,
    },
  ]

  const modules = useMemo(
    () => [...new Set(permissions.map((p) => p.module))].sort(),
    [permissions],
  )

  const filteredPerms = useMemo(() => {
    const q = permSearch.trim().toLowerCase()
    return permissions.filter((p) => (!moduleFilter || p.module === moduleFilter)
      && (!q || p.code.toLowerCase().includes(q) || (p.displayName ?? '').toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q) || (p.riskLevel ?? '').toLowerCase() === q))
  }, [permissions, moduleFilter, permSearch])
  const systemCount = roles.filter((r) => r.systemRole).length

  return (
    <ModulePage crumb="Settings" title="Roles & permissions" subtitle="What each role can do, and who holds which role."
      actions={canWriteRoles && activeTab === 'roles' ? <HrButton onClick={() => setEditorState({ mode: 'create' })}><Plus size={15} /> New role</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      {rolesLoading ? <State kind="loading" height={96} /> : !rolesError && <StatRow tiles={[
        { icon: 'shield', color: 'blue', label: 'Roles', value: String(roles.length), sub: 'In this workspace', onClick: () => setActiveTab('roles') },
        { icon: 'lock', color: 'teal', label: 'Built-in', value: String(systemCount), sub: 'Permissions can be viewed, not changed' },
        { icon: 'workflow', color: 'green', label: 'Custom', value: String(roles.length - systemCount), sub: 'Made for this workspace' },
        { icon: 'list', color: 'orange', label: 'Permissions', value: permsLoading ? '…' : String(permissions.length), sub: `${modules.length} modules`, onClick: () => setActiveTab('catalogue') },
      ]} />}
      <Views label="Role views" active={activeTab} onChange={setActiveTab} items={[
        { key: 'roles', label: 'Roles', icon: 'shield' },
        { key: 'assignments', label: 'Who has which role', icon: 'users' },
        { key: 'catalogue', label: 'Permission catalogue', icon: 'list' },
      ]} />

      {/* ── Roles ──────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Note>Click a role to see its permissions. Built-in roles can’t be changed: use “Duplicate role” to make a custom copy (for example a “Senior manager” from Dept Manager) and add or remove permissions. You can only give permissions you hold; critical ones only the workspace owner can give. Every change is recorded in the audit log.</Note>
          {rolesLoading ? (
            <State kind="loading" height={220} />
          ) : rolesError ? (
            <State kind="error" title="Couldn’t load roles" description={(rolesError as Error).message} onRetry={() => refetchRoles()} />
          ) : (
            <DataTable
              data={roles}
              columns={roleColumns}
              getRowKey={(row) => row.id}
              onRowClick={(row) => setDrawerRole(row)}
              emptyTitle="No roles found"
              emptyDescription="Roles will appear here once the tenant is provisioned."
              emptyVariant="first-run"
            />
          )}
        </div>
      )}

      {/* ── Assignments ────────────────────────────────────────────────── */}
      {activeTab === 'assignments' && (rolesLoading ? <State kind="loading" height={220} /> : <AssignmentsTab roles={roles} />)}

      {/* ── Permission catalogue ───────────────────────────────────────── */}
      {activeTab === 'catalogue' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {!permsLoading && !permsError && (
            <input type="search" aria-label="Search permissions" value={permSearch} onChange={(e) => setPermSearch(e.target.value)} placeholder="Search code, name or description" className="ut-input" style={{ maxWidth: 420 }} />
          )}
          {!permsLoading && !permsError && modules.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  !moduleFilter
                    ? 'border-[#059669] bg-[#059669] text-white'
                    : 'border-border-default text-text-secondary hover:border-accent-default'
                }`}
                onClick={() => setModuleFilter('')}
              >
                All
              </button>
              {modules.map((m) => (
                <button
                  key={m}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    moduleFilter === m
                      ? 'border-[#059669] bg-[#059669] text-white'
                      : 'border-border-default text-text-secondary hover:border-accent-default'
                  }`}
                  onClick={() => setModuleFilter(m === moduleFilter ? '' : m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {permsLoading ? (
            <State kind="loading" height={220} />
          ) : permsError ? (
            <State kind="error" title="Couldn’t load permissions" description={(permsError as Error).message} onRetry={() => refetchPerms()} />
          ) : (
            <DataTable
              data={filteredPerms}
              columns={permColumns}
              getRowKey={(row) => row.code}
              emptyTitle="No permissions"
              emptyDescription={
                permSearch ? 'Nothing matches that search.' : moduleFilter
                  ? `No permissions in module "${moduleFilter}".`
                  : 'No permissions registered.'
              }
              emptyVariant={moduleFilter || permSearch ? 'filtered' : 'first-run'}
            />
          )}
        </div>
      )}
      </div>

      {drawerRole && (
        <PermissionsDrawer
          role={drawerRole}
          permissions={permissions}
          onClose={() => setDrawerRole(null)}
        />
      )}

      {editorState && (
        <RoleEditorModal state={editorState} onClose={() => setEditorState(null)} onCreated={(r) => setDrawerRole(r)} />
      )}

      {deleteTarget && (
        <DeleteRoleConfirm role={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </ModulePage>
  )
}
