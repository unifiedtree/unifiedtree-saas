import React, { useState, useMemo } from 'react'
import { Shield, Search, X, UserCog } from 'lucide-react'
import {
  DataTable, Badge, Drawer, Tabs, TabsList, TabsTrigger, TabsContent,
  TableSkeleton, EmptyState, Button,
} from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import {
  useRoles, usePermissionsCatalogue, useRolePermissions, useSetRolePermissions,
  useUserRoles, useGrantRole, useRevokeRole,
} from '@/modules/rbac/api/useRbac'
import type { RbacRole, RbacPermission } from '@/modules/rbac/api/useRbac'
import { useWorkspaceUsers, workspaceUserDisplayName } from '@/modules/rbac/api/useWorkspaceAccess'

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

  const handleSave = () => {
    setPerms.mutate(Array.from(selected), {
      onSuccess: () => {
        toast.success(`Permissions updated — ${selected.size} granted to ${role.displayName}`)
        onClose()
      },
      onError: () => toast.error('Failed to update permissions'),
    })
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
                        className="mt-0.5 flex-shrink-0 accent-indigo-500 h-4 w-4"
                        checked={selected.has(p.code)}
                        onChange={(e) => toggle(p.code, e.target.checked)}
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary">{p.displayName}</p>
                        <p className="font-mono text-xs text-text-tertiary">{p.code}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )})}
          </div>
        )}

        <div className="flex gap-2 border-t border-border-default pt-4">
          <Button
            size="sm"
            loading={setPerms.isPending}
            onClick={handleSave}
            disabled={!initialised || loadingPerms}
          >
            Save permissions
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || workspaceUserDisplayName(u).toLowerCase().includes(q),
    )
  }, [users, search])

  const selectedUser = users.find((u) => u.userId === selectedUserId)
  const assignedRoleIds = new Set((userRoles?.roles ?? []).map((r) => r.id))
  const availableRoles = roles.filter((r) => !assignedRoleIds.has(r.id))
  const busy = grant.isPending || revoke.isPending

  const handleGrant = (roleId: string) => {
    if (!selectedUserId || !roleId) return
    grant.mutate({ userId: selectedUserId, roleId }, {
      onSuccess: () => toast.success('Role granted'),
      onError: () => toast.error('Failed to grant role'),
    })
  }
  const handleRevoke = (roleId: string, label: string) => {
    if (!selectedUserId) return
    revoke.mutate({ userId: selectedUserId, roleId }, {
      onSuccess: () => toast.success(`Removed ${label}`),
      onError: () => toast.error('Failed to revoke role'),
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* User list */}
      <div className="rounded-xl border border-border-default bg-bg-surface overflow-hidden">
        <div className="relative border-b border-border-default p-2.5">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="w-full rounded-lg border border-border-default bg-white py-1.5 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
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
      <div className="rounded-xl border border-border-default bg-bg-surface p-5">
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
                className="w-full max-w-sm rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              >
                <option value="">
                  {availableRoles.length === 0 ? 'All roles already assigned' : 'Select a role to grant…'}
                </option>
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName} {r.systemRole ? '(system)' : '(tenant)'}
                  </option>
                ))}
              </select>
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

// ── Main component ─────────────────────────────────────────────────────────────

export const Roles: React.FC = () => {
  const [activeTab, setActiveTab] = useState('roles')
  const [drawerRole, setDrawerRole] = useState<RbacRole | null>(null)
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
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setDrawerRole(row) }}
          >
            Edit permissions
          </Button>
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
      header: 'Description',
      cell: (row) => (
        <span className="text-xs text-text-tertiary">{row.description ?? '—'}</span>
      ),
      hideBelow: 'lg',
    },
  ]

  const modules = useMemo(
    () => [...new Set(permissions.map((p) => p.module))].sort(),
    [permissions],
  )

  const filteredPerms = moduleFilter
    ? permissions.filter((p) => p.module === moduleFilter)
    : permissions

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Role Management</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          View roles and manage permission assignments
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="catalogue">Permission Catalogue</TabsTrigger>
        </TabsList>

        {/* ── Tab: Roles ──────────────────────────────────────────────────── */}
        <TabsContent value="roles" className="mt-4">
          {rolesLoading ? (
            <TableSkeleton />
          ) : rolesError ? (
            <EmptyState
              variant="error"
              title="Failed to load roles"
              description={(rolesError as Error).message}
              primaryAction={{ label: 'Retry', onClick: () => refetchRoles() }}
            />
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
        </TabsContent>

        {/* ── Tab: Assignments ────────────────────────────────────────────── */}
        <TabsContent value="assignments" className="mt-4">
          {rolesLoading ? (
            <TableSkeleton />
          ) : (
            <AssignmentsTab roles={roles} />
          )}
        </TabsContent>

        {/* ── Tab: Permission Catalogue ───────────────────────────────────── */}
        <TabsContent value="catalogue" className="mt-4">
          {!permsLoading && !permsError && modules.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  !moduleFilter
                    ? 'border-accent-default bg-accent-default text-[#0F172A]'
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
                      ? 'border-accent-default bg-accent-default text-[#0F172A]'
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
            <TableSkeleton />
          ) : permsError ? (
            <EmptyState
              variant="error"
              title="Failed to load permissions"
              description={(permsError as Error).message}
              primaryAction={{ label: 'Retry', onClick: () => refetchPerms() }}
            />
          ) : (
            <DataTable
              data={filteredPerms}
              columns={permColumns}
              getRowKey={(row) => row.code}
              emptyTitle="No permissions"
              emptyDescription={
                moduleFilter
                  ? `No permissions in module "${moduleFilter}".`
                  : 'No permissions registered.'
              }
              emptyVariant={moduleFilter ? 'filtered' : 'first-run'}
            />
          )}
        </TabsContent>
      </Tabs>

      {drawerRole && (
        <PermissionsDrawer
          role={drawerRole}
          permissions={permissions}
          onClose={() => setDrawerRole(null)}
        />
      )}
    </div>
  )
}
