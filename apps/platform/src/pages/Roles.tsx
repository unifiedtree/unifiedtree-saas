import React, { useState, useMemo } from 'react'
import { Shield, Info } from 'lucide-react'
import {
  DataTable, Badge, Drawer, Tabs, TabsList, TabsTrigger, TabsContent,
  TableSkeleton, EmptyState, Button,
} from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import {
  useRoles, usePermissionsCatalogue, useRolePermissions, useSetRolePermissions,
} from '@/modules/rbac/api/useRbac'
import type { RbacRole, RbacPermission } from '@/modules/rbac/api/useRbac'

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
  const { data: currentPerms, isLoading: loadingPerms } = useRolePermissions(role.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialised, setInitialised] = useState(false)
  const setPerms = useSetRolePermissions(role.id)
  const isSystemRole = role.systemRole

  // Pre-load existing permissions once they arrive
  React.useEffect(() => {
    if (currentPerms && !initialised) {
      setSelected(new Set(currentPerms))
      setInitialised(true)
    }
  }, [currentPerms, initialised])

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

  const handleSave = () => {
    setPerms.mutate(Array.from(selected), {
      onSuccess: () => {
        toast.success('Permissions updated')
        onClose()
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? ''
        if (msg.includes('SYSTEM_ROLE_LOCKED')) {
          toast.error('System roles cannot be edited')
        } else {
          toast.error('Failed to update permissions')
        }
      },
    })
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={`${role.displayName} — Permissions`}
    >
      <div className="space-y-4">
        {isSystemRole && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-400 leading-relaxed flex items-start gap-2">
            <Shield size={13} className="mt-0.5 flex-shrink-0" />
            <span>System role — permissions are managed by UnifiedTree and cannot be changed. You can view what this role grants below.</span>
          </div>
        )}

        {loadingPerms ? (
          <div className="py-8 text-center text-sm text-text-tertiary">Loading current permissions…</div>
        ) : (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {Object.entries(byModule).sort(([a], [b]) => a.localeCompare(b)).map(([module, perms]) => (
              <div key={module}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  {module}
                </p>
                <div className="space-y-1">
                  {perms.map((p) => (
                    <label
                      key={p.code}
                      className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${isSystemRole ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-interactive-hover'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 flex-shrink-0 accent-indigo-500"
                        checked={selected.has(p.code)}
                        onChange={(e) => !isSystemRole && toggle(p.code, e.target.checked)}
                        disabled={isSystemRole}
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary">{p.displayName}</p>
                        <p className="font-mono text-xs text-text-tertiary">{p.code}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-t border-border-default pt-4">
          {!isSystemRole && (
            <Button
              size="sm"
              loading={setPerms.isPending}
              onClick={handleSave}
            >
              Save permissions
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {isSystemRole ? 'Close' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Drawer>
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
            {row.systemRole ? 'View permissions' : 'Edit permissions'}
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
          <div className="flex flex-col items-center justify-center rounded-xl border border-border-default bg-bg-surface p-10 text-center space-y-3">
            <Info size={32} className="text-text-tertiary" />
            <h3 className="font-semibold text-text-primary">User role assignments</h3>
            <p className="max-w-md text-sm text-text-secondary">
              Assigning roles to users requires a user-search endpoint and
              GET&nbsp;/v1/rbac/users/&#123;userId&#125;/roles — both pending backend
              implementation. Grant and revoke hooks are ready in{' '}
              <code className="text-xs font-mono">useRbac.ts</code> and will be wired
              once those endpoints ship.
            </p>
          </div>
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
