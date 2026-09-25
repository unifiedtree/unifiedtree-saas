// The Access step for a person being added (Employee Master "Add employee" and
// the onboarding wizard). First the roles (Employee is always on), then every
// permission grouped by module: what the roles give shows ticked, the admin can
// untick one (taken away from just this person) or tick an extra one (given to
// just this person). Each row says whether it comes from the roles, was added
// or was removed. Nothing is saved here — the add flow saves it once the person
// has a login (see api/newPersonAccess.ts). The same levels rules as Users &
// access are shown up front: only roles and permissions you could give, critical
// ones only by the owner, high-risk ones after reading the warning.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Minus, Search } from 'lucide-react'
import clsx from 'clsx'
import { apiJson } from '@/core/api/client'
import { useAuthStore } from '@/core/auth/authStore'
import { Note } from '@/design/module/ModuleKit'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { usePermissionsCatalogue, RISK_LABEL, RISK_TONE, isRisky, type RbacPermission, type RbacRole, type RiskLevel } from '../api/useRbac'
import { useAssignableRoles, type AssignableRole } from '../api/useWorkspaceAccess'
import { BASE_ROLE, DEFAULT_REASON, useNewPersonAccessRights, type AccessDraft } from '../api/newPersonAccess'

const MODULE_LABEL: Record<string, string> = {
  advance: 'Salary advances', attendance: 'Attendance', audit: 'Audit log', compliance: 'Compliance', document: 'Documents',
  expense: 'Expenses', fnf: 'Full and final settlement', hiring: 'Hiring', hrms: 'HR records', integration: 'Integrations',
  learning: 'Learning', leave: 'Leave', notiftemplate: 'Notification templates', onboarding: 'Onboarding', org: 'Organisation',
  payroll: 'Payroll', performance: 'Performance', pli: 'Incentives', policy: 'Policies', rbac: 'Roles and permissions',
  settings: 'Settings', wfh: 'Work from home', workspace: 'Workspace', crm: 'CRM', accounts: 'Accounts', core: 'Platform',
}
const moduleLabel = (m: string) => MODULE_LABEL[m] ?? (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Other')
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'

type Filter = 'all' | 'on' | 'changes'
type RowState = 'kept' | 'removed' | 'added' | 'none'
interface Confirm { anchor: string; items: { name: string; risk: RiskLevel; text: string }[]; yes: string; run: (v: AccessDraft) => AccessDraft }

/** Shown instead of the picker when the person won't have a login yet. */
export function NoLoginNote({ why }: { why?: string }) {
  return (
    <Note>
      Access can be set once this person has a login.{why ? ` ${why}` : ''} Then give roles and permissions
      in <Link to="/users" className="font-semibold text-[#059669] hover:underline">Users &amp; access</Link>.
    </Note>
  )
}

/** Each chosen role's permission codes, read from Roles & permissions. */
function useRolePermissionSets(codes: string[], enabled: boolean) {
  const rolesQ = useQuery({ queryKey: ['rbac', 'roles'], queryFn: () => apiJson<RbacRole[]>('/v1/rbac/roles'), enabled })
  const idOf = useMemo(() => new Map((rolesQ.data ?? []).map((r) => [r.code, r.id])), [rolesQ.data])
  const qs = useQueries({
    queries: codes.map((code) => ({
      queryKey: ['rbac', 'role-permissions', idOf.get(code) ?? ''],
      queryFn: () => apiJson<string[]>(`/v1/rbac/roles/${idOf.get(code)}/permissions`),
      enabled: enabled && idOf.has(code), staleTime: 60_000,
    })),
  })
  const missing = rolesQ.isSuccess ? codes.filter((c) => !idOf.has(c)) : []
  const loading = enabled && (rolesQ.isLoading || qs.some((q) => q.isLoading))
  const error = rolesQ.error ?? qs.find((q) => q.error)?.error ?? null
  const dataKey = qs.map((q) => q.dataUpdatedAt).join(',')
  const byRole = useMemo(() => new Map(codes.map((c, i) => [c, qs[i]?.data ?? []])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [codes.join(','), dataKey])
  const retry = () => { void rolesQ.refetch(); qs.forEach((q) => { if (q.isError) void q.refetch() }) }
  return { loading, error, missing, byRole, retry }
}

function Tick({ state }: { state: 'on' | 'off' | 'mixed' }) {
  return (
    <span aria-hidden className={clsx(
      'mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
      state === 'off' ? 'border-slate-300 bg-white' : 'border-[#059669] bg-[#059669] text-white',
    )}>
      {state === 'on' ? <Check size={12} strokeWidth={3.2} /> : state === 'mixed' ? <Minus size={12} strokeWidth={3.2} /> : null}
    </span>
  )
}

function RiskConfirm({ c, onCancel, onYes }: { c: Confirm; onCancel: () => void; onYes: () => void }) {
  const critical = c.items.some((i) => i.risk === 'CRITICAL')
  return (
    <div className="grid gap-2">
      <Note tone={critical ? 'red' : 'amber'}>
        {c.items.map((i) => <span key={i.name} className="block"><strong>{i.name}</strong> ({RISK_LABEL[i.risk]}): {i.text}</span>)}
      </Note>
      <div className="flex flex-wrap justify-end gap-2">
        <HrButton size="sm" variant="ghost" onClick={onCancel}>Cancel</HrButton>
        <HrButton size="sm" variant="danger" onClick={onYes}>{c.yes}</HrButton>
      </div>
    </div>
  )
}

export function AccessPicker({ value, onChange }: { value: AccessDraft; onChange: (next: AccessDraft) => void }) {
  const rights = useNewPersonAccessRights()
  const rolesQ = useAssignableRoles()
  const catQ = usePermissionsCatalogue()
  const heldList = useAuthStore((s) => s.user?.permissions)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const roles = useMemo(() => (rolesQ.data ?? []).slice()
    .sort((a, b) => (a.roleCode === BASE_ROLE ? -1 : b.roleCode === BASE_ROLE ? 1 : a.displayName.localeCompare(b.displayName))), [rolesQ.data])
  const roleByCode = useMemo(() => new Map(roles.map((r) => [r.roleCode, r])), [roles])
  const nameOf = (code: string) => roleByCode.get(code)?.displayName ?? (code === BASE_ROLE ? 'Employee' : code)
  const roleCodes = useMemo(() => [BASE_ROLE, ...value.roles.filter((c) => c !== BASE_ROLE)], [value.roles])
  const rp = useRolePermissionSets(roleCodes, rights.canReadRolePermissions)
  const ready = rights.canReadRolePermissions && !rp.loading && !rp.error && !rp.missing.length

  /** permission code -> the roles that give it */
  const inheritedFrom = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const code of roleCodes) for (const p of rp.byRole.get(code) ?? []) {
      const list = m.get(p) ?? []
      list.push(roleByCode.get(code)?.displayName ?? (code === BASE_ROLE ? 'Employee' : code))
      m.set(p, list)
    }
    return m
  }, [roleCodes, rp.byRole, roleByCode])

  // A role added later may already give an extra permission, and one taken off
  // may have given a removed one: keep only the changes that still mean something.
  useEffect(() => {
    if (!ready) return
    const grants = value.grants.filter((c) => !inheritedFrom.has(c))
    const denies = value.denies.filter((c) => inheritedFrom.has(c))
    if (grants.length !== value.grants.length || denies.length !== value.denies.length) onChange({ ...value, grants, denies })
  }, [ready, inheritedFrom, value, onChange])

  const held = useMemo(() => new Set(heldList ?? []), [heldList])
  const isOwner = roleByCode.get('OWNER')?.canGrant === true
  const perms = useMemo(() => (catQ.data ?? []).filter((p) => !p.code.startsWith('platform.')), [catQ.data])
  const grants = useMemo(() => new Set(value.grants), [value.grants])
  const denies = useMemo(() => new Set(value.denies), [value.denies])
  const stateOf = (code: string): RowState => (inheritedFrom.has(code) ? (denies.has(code) ? 'removed' : 'kept') : grants.has(code) ? 'added' : 'none')
  const isOn = (code: string) => { const s = stateOf(code); return s === 'kept' || s === 'added' }
  const canEditPerms = ready && rights.canOverrides
  /** Why this extra permission can't be given by the signed-in admin, or null. */
  const blockedWhy = (p: RbacPermission): string | null => {
    if (inheritedFrom.has(p.code) || grants.has(p.code)) return null
    if (!held.has(p.code) && !held.has('*')) return 'You can only give permissions you hold yourself.'
    if (p.riskLevel === 'CRITICAL' && !isOwner) return 'Only the workspace owner can give critical permissions.'
    return null
  }
  const riskText = (p: RbacPermission) => p.warning ?? p.description ?? 'This permission is sensitive.'

  // ── roles ──
  const roleLocked = (r: AssignableRole): string | null => {
    if (r.roleCode === BASE_ROLE) return 'Every employee has this.'
    if (!rights.canRoles) return 'You can’t give roles.'
    if (!r.moduleActive) return 'Its module isn’t active in this workspace.'
    if (r.canGrant === false && !value.roles.includes(r.roleCode)) return r.grantBlockedReason ?? 'You can’t give this role.'
    return null
  }
  const clickRole = (r: AssignableRole) => {
    const code = r.roleCode
    if (value.roles.includes(code)) { onChange({ ...value, roles: value.roles.filter((c) => c !== code) }); return }
    const add = (v: AccessDraft): AccessDraft => ({ ...v, roles: v.roles.includes(code) ? v.roles : [...v.roles, code] })
    if (isRisky(r.riskLevel)) {
      setConfirm({
        anchor: 'roles', yes: 'Yes, give the role', run: add,
        items: [{ name: r.displayName, risk: r.riskLevel!, text: r.riskLevel === 'CRITICAL'
          ? 'They will be able to change who can do what, billing or the workspace itself.'
          : 'They will be able to see or change money, salaries or personal data.' }],
      })
      return
    }
    setConfirm(null); onChange(add(value))
  }

  // ── permissions ──
  const clickPerm = (p: RbacPermission) => {
    if (!canEditPerms) return
    const code = p.code
    if (inheritedFrom.has(code)) {
      onChange({ ...value, denies: denies.has(code) ? value.denies.filter((c) => c !== code) : [...value.denies, code] })
    } else if (grants.has(code)) {
      onChange({ ...value, grants: value.grants.filter((c) => c !== code) })
    } else if (!blockedWhy(p)) {
      const add = (v: AccessDraft): AccessDraft => ({ ...v, grants: v.grants.includes(code) ? v.grants : [...v.grants, code], riskConfirmed: v.riskConfirmed || isRisky(p.riskLevel) })
      if (isRisky(p.riskLevel)) { setConfirm({ anchor: `perm:${code}`, yes: 'Yes, give it', run: add, items: [{ name: p.displayName, risk: p.riskLevel, text: riskText(p) }] }); return }
      onChange(add(value))
    }
  }
  const selectAll = (module: string, list: RbacPermission[]) => {
    const back = list.filter((p) => inheritedFrom.has(p.code) && denies.has(p.code)).map((p) => p.code)
    const extra = list.filter((p) => !inheritedFrom.has(p.code) && !grants.has(p.code) && !blockedWhy(p))
    const risky = extra.filter((p) => isRisky(p.riskLevel))
    const run = (v: AccessDraft): AccessDraft => ({
      ...v, denies: v.denies.filter((c) => !back.includes(c)),
      grants: [...v.grants, ...extra.map((p) => p.code).filter((c) => !v.grants.includes(c))],
      riskConfirmed: v.riskConfirmed || risky.length > 0,
    })
    if (risky.length) { setConfirm({ anchor: `group:${module}`, yes: `Yes, give ${risky.length === 1 ? 'it' : 'them'}`, run, items: risky.map((p) => ({ name: p.displayName, risk: p.riskLevel, text: riskText(p) })) }); return }
    onChange(run(value))
  }
  const clearAll = (list: RbacPermission[]) => {
    const codes = list.map((p) => p.code)
    const take = codes.filter((c) => inheritedFrom.has(c) && !denies.has(c))
    onChange({ ...value, denies: [...value.denies, ...take], grants: value.grants.filter((c) => !codes.includes(c)) })
  }

  const q = search.trim().toLowerCase()
  const groups = useMemo(() => {
    const m = new Map<string, RbacPermission[]>()
    for (const p of perms) {
      if (q && ![p.displayName, p.code, p.description ?? '', moduleLabel(p.module)].some((s) => s.toLowerCase().includes(q))) continue
      const s = stateOf(p.code)
      if (filter === 'on' && s !== 'kept' && s !== 'added') continue
      if (filter === 'changes' && s !== 'added' && s !== 'removed') continue
      const list = m.get(p.module) ?? []
      list.push(p)
      m.set(p.module, list)
    }
    return [...m.entries()].sort(([a], [b]) => moduleLabel(a).localeCompare(moduleLabel(b)))
    // stateOf reads grants/denies/inheritedFrom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, q, filter, grants, denies, inheritedFrom])

  const fromRoles = perms.filter((p) => inheritedFrom.has(p.code)).length
  const onCount = perms.filter((p) => isOn(p.code)).length
  const changes = value.grants.length + value.denies.length

  const confirmAt = (anchor: string) => confirm && confirm.anchor === anchor
    ? <RiskConfirm c={confirm} onCancel={() => setConfirm(null)} onYes={() => { onChange(confirm.run(value)); setConfirm(null) }} />
    : null

  return (
    <div className="grid gap-5" data-access-picker>
      {/* ── Roles ── */}
      <div className="grid gap-2.5">
        <div>
          <p className="text-[13px] font-semibold text-text-primary">Roles</p>
          <p className="text-[12px] text-text-secondary">Every new person starts as Employee. Add roles for more.</p>
        </div>
        {rolesQ.isLoading ? <Note>Loading roles…</Note>
          : rolesQ.isError ? (
            <Note tone="red">Couldn’t load the roles: {errText(rolesQ.error)}{' '}
              <button type="button" className="font-semibold underline" onClick={() => rolesQ.refetch()}>Try again</button></Note>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Roles">
              {roles.map((r) => {
                const on = r.roleCode === BASE_ROLE || value.roles.includes(r.roleCode)
                const locked = roleLocked(r)
                return (
                  <button key={r.roleCode} type="button" role="checkbox" aria-checked={on} aria-label={r.displayName}
                    disabled={!!locked} onClick={() => clickRole(r)} title={locked ?? undefined}
                    className={clsx(
                      'flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      on ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]' : 'border-border-default bg-[var(--bg-surface)] hover:border-border-strong',
                      locked && r.roleCode !== BASE_ROLE && 'cursor-not-allowed opacity-60',
                      locked && r.roleCode === BASE_ROLE && 'cursor-default',
                    )}>
                    <Tick state={on ? 'on' : 'off'} />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-text-primary">
                        {r.displayName}
                        {isRisky(r.riskLevel) && <HrStatusPill tone={RISK_TONE[r.riskLevel!]}>{RISK_LABEL[r.riskLevel!]}</HrStatusPill>}
                      </span>
                      {r.description && <span className="line-clamp-2 text-[12px] text-text-secondary">{r.description}</span>}
                      {locked && <span className="text-[11.5px] text-text-tertiary">{locked}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        {confirmAt('roles')}
      </div>

      {/* ── Permissions ── */}
      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">Permissions</p>
            <p className="text-[12px] text-text-secondary">
              What the roles give is ticked. Untick to take something away from just this person, or tick an extra one.
            </p>
          </div>
        </div>

        {!rights.canReadRolePermissions ? (
          <Note>You can choose roles here. To add or remove single permissions, open this person in <Link to="/users" className="font-semibold text-[#059669] hover:underline">Users &amp; access</Link> once they’re added.</Note>
        ) : catQ.isLoading || (rp.loading && inheritedFrom.size === 0) ? <Note>Loading the permission list…</Note>
          : catQ.isError || rp.error || rp.missing.length ? (
            <Note tone="red">
              Couldn’t load what the roles include: {catQ.isError ? errText(catQ.error) : rp.error ? errText(rp.error) : `${rp.missing.map(nameOf).join(', ')} not found`}{' '}
              <button type="button" className="font-semibold underline" onClick={() => { void catQ.refetch(); rp.retry() }}>Try again</button>
            </Note>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
                <HrStatusPill tone="info">{onCount} of {perms.length} on</HrStatusPill>
                <HrStatusPill tone="gray">{fromRoles} from roles</HrStatusPill>
                <HrStatusPill tone={value.grants.length ? 'ok' : 'gray'}>{value.grants.length} added</HrStatusPill>
                <HrStatusPill tone={value.denies.length ? 'red' : 'gray'}>{value.denies.length} removed</HrStatusPill>
                {rp.loading && <span className="text-[12px] text-text-tertiary">Adding what the new role gives…</span>}
              </div>
              {!rights.canOverrides && <Note>You can’t add or remove single permissions, so this shows what the roles give.</Note>}
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[180px] flex-1">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search permissions"
                    aria-label="Search permissions" className="ut-input w-full" style={{ paddingLeft: 34 }} />
                </label>
                <div className="inline-flex rounded-lg border border-border-default bg-[var(--bg-surface)] p-0.5" role="group" aria-label="Show">
                  {([['all', 'All'], ['on', 'Ticked'], ['changes', 'Changes']] as [Filter, string][]).map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                      className={clsx('rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
                        filter === k ? 'bg-[#059669] text-white' : 'text-text-secondary hover:text-text-primary')}>{l}</button>
                  ))}
                </div>
              </div>

              {groups.length === 0 ? (
                <Note>{q ? 'No permission matches that search.' : filter === 'changes' ? 'No changes yet: they get exactly what their roles give.' : 'Nothing to show.'}</Note>
              ) : (
                <div className="grid gap-2">
                  {groups.map(([module, list]) => {
                    const label = moduleLabel(module)
                    const expanded = open.has(module) || !!q || filter !== 'all'
                    const all = perms.filter((p) => p.module === module)
                    const on = all.filter((p) => isOn(p.code)).length
                    const added = all.filter((p) => grants.has(p.code)).length
                    const removed = all.filter((p) => inheritedFrom.has(p.code) && denies.has(p.code)).length
                    const selectable = list.filter((p) => inheritedFrom.has(p.code) || grants.has(p.code) || !blockedWhy(p))
                    const listOn = list.filter((p) => isOn(p.code)).length
                    const head: 'on' | 'off' | 'mixed' = listOn === 0 ? 'off' : selectable.every((p) => isOn(p.code)) ? 'on' : 'mixed'
                    return (
                      <div key={module} className="overflow-hidden rounded-xl border border-border-default bg-[var(--bg-surface)]" data-access-group={module}>
                        <div className="flex items-center gap-2 bg-[var(--bg-subtle)] px-3 py-2">
                          <button type="button" role="checkbox" aria-checked={head === 'mixed' ? 'mixed' : head === 'on'}
                            aria-label={`All ${label} permissions`} disabled={!canEditPerms || !selectable.length}
                            onClick={() => (head === 'on' ? clearAll(list) : selectAll(module, list))}
                            className="flex shrink-0 items-center disabled:cursor-not-allowed disabled:opacity-50">
                            <Tick state={head} />
                          </button>
                          <button type="button" aria-expanded={expanded} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(module)) n.delete(module); else n.add(module); return n })}
                            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
                            {expanded ? <ChevronDown size={15} className="text-text-tertiary" /> : <ChevronRight size={15} className="text-text-tertiary" />}
                            <span className="text-[13px] font-semibold text-text-primary">{label}</span>
                            <span className="text-[12px] text-text-tertiary">{on} of {all.length} on</span>
                            {added > 0 && <HrStatusPill tone="ok">{added} added</HrStatusPill>}
                            {removed > 0 && <HrStatusPill tone="red">{removed} removed</HrStatusPill>}
                          </button>
                        </div>
                        {confirmAt(`group:${module}`) && <div className="border-t border-border-default p-3">{confirmAt(`group:${module}`)}</div>}
                        {expanded && (
                          <div className="divide-y divide-[var(--border-subtle)] border-t border-border-default">
                            {list.map((p) => {
                              const s = stateOf(p.code)
                              const blocked = blockedWhy(p)
                              const from = inheritedFrom.get(p.code)
                              return (
                                <div key={p.code}>
                                  <button type="button" role="checkbox" aria-checked={s === 'kept' || s === 'added'} aria-label={p.displayName}
                                    disabled={!canEditPerms || !!blocked} onClick={() => clickPerm(p)} title={p.code}
                                    className={clsx('flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                                      canEditPerms && !blocked ? 'hover:bg-[var(--bg-subtle)]' : 'cursor-default',
                                      blocked && 'opacity-60')}>
                                    <Tick state={s === 'kept' || s === 'added' ? 'on' : 'off'} />
                                    <span className="grid min-w-0 flex-1 gap-0.5">
                                      <span className="flex flex-wrap items-center gap-1.5">
                                        <span className={clsx('text-[13px] font-medium', s === 'removed' ? 'text-text-tertiary line-through' : 'text-text-primary')}>{p.displayName}</span>
                                        {s === 'kept' && <HrStatusPill tone="gray">From {from!.length === 1 ? from![0] : 'roles'}</HrStatusPill>}
                                        {s === 'added' && <HrStatusPill tone="ok">Added</HrStatusPill>}
                                        {s === 'removed' && <HrStatusPill tone="red">Removed</HrStatusPill>}
                                        {p.riskLevel !== 'LOW' && <HrStatusPill tone={RISK_TONE[p.riskLevel]}>{RISK_LABEL[p.riskLevel]}</HrStatusPill>}
                                      </span>
                                      {p.description && <span className="text-[12px] leading-snug text-text-secondary">{p.description}</span>}
                                      {from && from.length > 1 && <span className="text-[11.5px] text-text-tertiary">From {from.join(', ')}</span>}
                                      {blocked && <span className="text-[11.5px] text-text-tertiary">{blocked}</span>}
                                    </span>
                                  </button>
                                  {confirmAt(`perm:${p.code}`) && <div className="px-3 pb-3">{confirmAt(`perm:${p.code}`)}</div>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {changes > 0 && (
                <label className="grid gap-1">
                  <span className="text-[12px] font-semibold text-text-primary">Reason for the changes</span>
                  <input className="ut-input" value={value.reason} maxLength={500} aria-label="Reason for the changes"
                    onChange={(e) => onChange({ ...value, reason: e.target.value })} placeholder={DEFAULT_REASON} />
                  <span className="text-[11.5px] text-text-tertiary">Kept with each added or removed permission and in the audit log.</span>
                </label>
              )}
            </>
          )}
      </div>
    </div>
  )
}
