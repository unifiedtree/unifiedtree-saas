/**
 * Companies — one person's access per company, on the employee Access tab and on
 * Roles & permissions → Who has which role. One login, one employee record in
 * their main company (their roles apply there); every other company is a grant
 * with a role for that company ("Beta Ltd: Dept Manager"). People whose roles
 * cover the whole business (Owner, Admin, HR manager…) reach every company.
 * Endpoints and rules: api/useCompanyAccess.ts. Hidden in a single-company
 * workspace; on a server without company access it says so in this section only.
 */
import { useMemo, useState } from 'react'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, Callout, IconTile, ListRow, ListRows, Section, StatusPill, type StatusTone } from '@/design/kit/display'
import { Dialog, Dropdown, FormField, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import { useAuthStore } from '@/core/auth/authStore'
import { fmtDate } from '@/modules/hrms/employees/workspace/profileFormat'
import { RISK_LABEL, isRisky } from '../api/useRbac'
import { useAssignableRoles, type AssignableRole } from '../api/useWorkspaceAccess'
import {
  accessLabel, companyAccessError, companyAccessUnavailable, grantableCompanies, rolesForCompany,
  useGrantCompanyAccess, useRevokeCompanyAccess, useUserCompanyAccess, type CompanyAccessEntry,
} from '../api/useCompanyAccess'

const ACCESS_TONE: Record<string, StatusTone> = { WORKSPACE: 'brand', HOME: 'info', GRANT: 'neutral' }

export function CompanyAccessSection({ userId, name, locked, lockedReason }: {
  userId: string
  name: string
  /** Their roles can't be changed by the viewer (their own, or an owner's): the server refuses grants too. */
  locked?: boolean
  lockedReason?: string
}) {
  const toast = useToast()
  const canManage = usePermission(P.WORKSPACE_USERS_MANAGE)
  const hasModule = useAuthStore((s) => s.hasModule)
  const companies = useCompanies()
  const view = useUserCompanyAccess(userId)
  const roles = useAssignableRoles()
  const grant = useGrantCompanyAccess(), revoke = useRevokeCompanyAccess()
  const [giving, setGiving] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [roleCode, setRoleCode] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ company: CompanyAccessEntry; code: string; label: string } | null>(null)

  const all = useMemo(() => (companies.data ?? []).map((c) => ({ id: c.id, name: c.name })), [companies.data])
  const options = grantableCompanies(view.data, all)
  const roleOptions = companyId ? rolesForCompany(roles.data ?? [], view.data, companyId) : []
  const picked = roleOptions.find((r) => r.roleCode === roleCode) ?? null
  const busy = grant.isPending || revoke.isPending
  const why = (r: AssignableRole): string | null => {
    if (r.module !== 'core' && !(r.moduleActive ?? hasModule(r.module))) return 'Its module isn’t switched on for this workspace.'
    return r.canGrant === false ? r.grantBlockedReason ?? 'You can’t give this role.' : null
  }

  // One company: nothing to choose between, so nothing to show.
  if (!companies.isLoading && all.length <= 1) return null

  const unavailable = view.error && companyAccessUnavailable(view.error)
  const entries = view.data?.companies ?? []
  const blocked = locked ? lockedReason || 'You can’t change this person’s access.' : null

  const open = () => {
    setCompanyId(options.length === 1 ? options[0].id : null)
    setRoleCode(null)
    setGiving(true)
  }
  const give = () => {
    if (!companyId || !picked) return
    const company = all.find((c) => c.id === companyId)?.name ?? 'the company'
    grant.mutate({ userId, companyId, roleCode: picked.roleCode }, {
      onSuccess: () => { toast.success(`${name} can now work in ${company} as ${picked.displayName}`); setGiving(false) },
      onError: (e) => toast.error('Couldn’t give access', { detail: companyAccessError(e) }),
    })
  }
  const remove = () => {
    if (!removing) return
    const { company, code, label } = removing
    const last = company.roles.filter((r) => r.source === 'GRANT').length <= 1
    revoke.mutate({ userId, companyId: company.companyId, roleCode: code }, {
      onSuccess: () => { toast.success(last ? `${name} no longer has access to ${company.name}` : `${label} removed in ${company.name}`); setRemoving(null) },
      onError: (e) => { toast.error('Couldn’t remove the access', { detail: companyAccessError(e) }); setRemoving(null) },
    })
  }

  return (
    <Section title="Companies" count={entries.length || undefined}
      sub="Where they can work, and their role in each. Their roles above apply in their main company."
      loading={view.isLoading || companies.isLoading} error={unavailable ? undefined : view.error} onRetry={() => void view.refetch()} skeleton="list"
      body="list"
      actions={canManage && view.data && !view.data.allCompanies ? (
        <Button size={36} variant="secondary" icon="plus" disabled={busy || !!blocked || options.length === 0}
          title={blocked ?? (options.length === 0 ? 'There are no other companies to give.' : undefined)} onClick={open}>Give company access</Button>
      ) : undefined}>
      {unavailable ? (
        <div style={{ padding: '0 20px 16px' }}><Callout tone="info">Access per company isn’t switched on for this workspace yet. Until then everyone works in their own company.</Callout></div>
      ) : view.data && (
        <>
          {view.data.allCompanies && (
            <div style={{ padding: '0 20px 8px' }}>
              <Callout tone="info">{name}’s roles cover the whole business, so they can work in every company with the same access. To limit them to some companies, give them roles that don’t cover every company.</Callout>
            </div>
          )}
          {!view.data.allCompanies && !view.data.homeCompanyId && (
            <div style={{ padding: '0 20px 8px' }}><Callout tone="info">{name} has no employee record, so their access isn’t tied to a company.</Callout></div>
          )}
          <ListRows label={`${name}’s companies`} inset>
            {entries.flatMap((c) => {
              const grants = c.roles.filter((r) => r.source === 'GRANT')
              if (c.access !== 'GRANT' || grants.length === 0) {
                return [(
                  <ListRow key={c.companyId} variant="hover" leading={<IconTile icon="building" tone="brand" />}
                    title={c.active ? c.name : `${c.name} (archived)`}
                    sub={c.roles.length ? c.roles.map((r) => r.name).join(', ') : c.access === 'HOME' ? 'Employee self-service only' : undefined}
                    end={<StatusPill tone={ACCESS_TONE[c.access] ?? 'neutral'}>{accessLabel(c.access)}</StatusPill>} />
                )]
              }
              return grants.map((r) => (
                <ListRow key={`${c.companyId}-${r.code}`} variant="hover" leading={<IconTile icon="building" tone="neutral" />}
                  title={c.active ? c.name : `${c.name} (archived)`}
                  sub={[r.name, r.grantedAt ? `given ${fmtDate(r.grantedAt)}` : null].filter(Boolean).join(' · ')}
                  end={<StatusPill tone="neutral">{accessLabel(c.access)}</StatusPill>}
                  actions={canManage ? (
                    <Button size={30} variant="danger-outline" disabled={busy || !!blocked} title={blocked ?? undefined}
                      aria-label={`Remove ${r.name} in ${c.name}`} onClick={() => setRemoving({ company: c, code: r.code, label: r.name })}>Remove</Button>
                  ) : undefined} />
              ))
            })}
          </ListRows>
        </>
      )}

      <SidePanel open={giving} onClose={() => setGiving(false)} title="Give company access" busy={grant.isPending}
        sub={`${name} keeps their main company. Here you choose another company and their role there.`}
        footer={<>
          <PanelButton size="lg" onClick={() => setGiving(false)}>Cancel</PanelButton>
          <PanelButton size="lg" variant="primary" busy={grant.isPending}
            blockedReason={!companyId ? 'Choose a company first.' : !picked ? 'Choose a role.' : why(picked)} onClick={give}>Give access</PanelButton>
        </>}>
        <div style={{ display: 'grid', gap: 16 }}>
          <FormField label="Company" required>
            <Dropdown label="Company" placeholder="Choose a company" value={companyId}
              options={options.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => { setCompanyId(v); setRoleCode(null) }} />
          </FormField>
          <FormField label="Role in that company" required hint="Owner, Super admin and Admin cover every company, so they are given as roles instead.">
            <Dropdown label="Role in that company" placeholder={companyId ? 'Choose a role' : 'Choose a company first'} value={roleCode} disabled={!companyId}
              searchable={roleOptions.length > 8}
              options={roleOptions.map((r) => ({ value: r.roleCode, label: r.displayName, sub: why(r) ?? r.description ?? undefined, disabled: !!why(r) }))}
              onChange={(v) => setRoleCode(v)} />
          </FormField>
          {roles.error && <Callout tone="danger">Couldn’t load the roles: {(roles.error as Error).message}</Callout>}
          {picked && isRisky(picked.riskLevel) && (
            <Callout tone={picked.riskLevel === 'CRITICAL' ? 'danger' : 'warning'}>
              {RISK_LABEL[picked.riskLevel!]}: {picked.riskLevel === 'CRITICAL'
                ? `${name} will be able to change who can do what in that company.`
                : `${name} will be able to see or change money, salaries or personal data in that company.`} The change is recorded in the audit log.
            </Callout>
          )}
        </div>
      </SidePanel>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} icon="alertTriangle" tone="danger" busy={revoke.isPending}
        title={removing && removing.company.roles.filter((r) => r.source === 'GRANT').length <= 1 ? `Remove access to ${removing.company.name}?` : `Remove ${removing?.label ?? ''} in ${removing?.company.name ?? ''}?`}
        sub={removing && removing.company.roles.filter((r) => r.source === 'GRANT').length <= 1
          ? `${name} won’t be able to open ${removing.company.name} any more. Their main company is not affected.`
          : `${name} keeps their other roles in ${removing?.company.name ?? 'that company'}.`}
        footer={<>
          <PanelButton onClick={() => setRemoving(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={revoke.isPending} onClick={remove}>Remove</PanelButton>
        </>} />
    </Section>
  )
}
