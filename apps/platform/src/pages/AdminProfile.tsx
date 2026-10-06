// My profile for an administrator (/profile when the personal pages are off for the person's role,
// usePersonalPages; by default OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN). The client: "leave
// balance should not be there for admin; the admin's profile is not personalised for him".
//
// The Overview tab shows who they are in the business, not an employee's month:
//   - their role(s) and what each lets them do, and the areas they look after (their permissions)
//   - the business at a glance: people, companies, requests waiting, seats (billing holders only)
//   - the admin places they use most (each only when it opens for them, the menu's own rule)
//   - the companies they can open, with their role in each (GET /v1/me/companies)
//   - the business card: workspace name and logo, the current company, modules and seats (billing only)
//   - sign-in: two-factor and sessions at a glance, with the Sign-in & security tab
//   - their recent activity from the audit log (audit.read only)
// No leave, attendance, pay or "My …" pieces: those stay on the personal profile (Profile.tsx).
// Every number comes from an endpoint the website already uses, with that endpoint's permission.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore as useSdkStore, usePermission } from '@unifiedtree/sdk'
import { Avatar, Chip, IconTile, ListRow, ListRows, QuickActionGrid, QuickActionTile, Section, StatusPill } from '@/design/kit/display'
import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { canOpen } from '@/shared/navigation/access'
import { TEAM_APPROVE_CODES } from '@/shared/navigation/shellCodes'
import { useCurrentCompany } from '@/modules/hrms/company/CurrentCompany'
import { useEmployeeCounts } from '@/modules/hrms/api/useWorkforce'
import { useSeatsUsage } from '@/modules/hrms/api/useSeats'
import { useAuditEvents } from '@/modules/hrms/api/useAudit'
import { useApprovalsInbox } from '@/modules/hrms/api/shared/useApprovalsInbox'
import { GlanceRow, type Glance } from '@/modules/hrms/employees/workspace/HrOverview'
import { fmtDateTime, plural } from '@/modules/hrms/employees/workspace/profileFormat'
import { useMfaStatus, useSessions } from './workspaceSettingsApi'
import { activityLine, adminPlaces, areasFrom, moduleName, roleWords, rolesToShow } from './adminProfileModel'
import './adminProfile.css'

export interface AdminOverviewProps {
  /** The person's own company (GET /v1/users/me companyId): "Home" in the company list. */
  homeCompanyId?: string | null
  /** Their own employee record, when they have one: a link to it in People. */
  employeeId?: string | null
  /** The login's user id: their own events in the audit log. */
  userId: string
  /** Opens the Sign-in & security tab. */
  onSecurity: () => void
}

/** The roles' display line for the left card ("Owner", "Admin · HR manager"). */
export function useAdminRoleLine(): string {
  const roles = useSdkStore((s) => s.user?.roles) ?? []
  return rolesToShow(roles).map((c) => roleWords(c).name).join(' · ')
}

export const AdminOverview: React.FC<AdminOverviewProps> = ({ homeCompanyId, employeeId, userId, onSecurity }) => {
  const navigate = useNavigate()
  const ctx = useAccessContext()
  const roles = useSdkStore((s) => s.user?.roles) ?? []
  const sessionModules = useSdkStore((s) => s.modules)
  const brand = useWorkspaceBranding()
  const { companies, company, companyId } = useCurrentCompany()

  // ── what they may read (each endpoint's own permission) ──
  const canPeople = usePermission('hrms.employee.read')
  const canAudit = usePermission('audit.read')
  const canApprove = TEAM_APPROVE_CODES.some(ctx.has)
  const billingEntry = PAGE_REGISTRY.find((e) => e.id === 's-billing')
  const canBilling = canOpen(billingEntry?.access, ctx)

  const counts = useEmployeeCounts(companyId || undefined, { enabled: canPeople && !!companyId })
  const inbox = useApprovalsInbox({ tab: 'all', size: 1 }, { enabled: canApprove })
  const seats = useSeatsUsage({ enabled: canBilling })
  const activity = useAuditEvents({ actor: userId, size: 6 }, { enabled: canAudit && !!userId })
  const mfa = useMfaStatus()
  const sessions = useSessions()

  const roleCodes = rolesToShow(roles)
  const views = roleCodes.map((c) => roleWords(c))
  const areas = areasFrom(ctx.has)
  const places = adminPlaces(ctx)
  const waiting = inbox.notAvailable ? null : inbox.data?.counts.all ?? null
  const modules = sessionModules.filter((m) => m.enabled).map((m) => moduleName(m.key))
  const allRoleNames = views.map((v) => v.name).join(', ')

  // ── the business at a glance ──
  const glance: Glance[] = [
    ...(canPeople ? [{ label: 'People', value: counts.data ? String(counts.data.active) : null, loading: counts.isLoading, icon: 'users', tone: 'brand' as const, note: company ? `active in ${company.name}` : 'active', onClick: () => navigate('/hrms/employees') }] : []),
    { label: 'Companies', value: companies.length ? String(companies.length) : null, loading: !companies.length, icon: 'building', tone: 'brand' as const, note: 'you can open', onClick: () => document.getElementById('ap-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    ...(canApprove && !inbox.notAvailable ? [{ label: 'Waiting for you', value: waiting != null ? String(waiting) : null, loading: inbox.isLoading, icon: 'inbox', tone: waiting ? 'gold' as const : 'brand' as const, note: waiting ? plural(waiting, 'request') : 'nothing waiting', onClick: () => navigate('/team?view=approvals') }] : []),
    ...(canBilling ? [{ label: 'Seats used', value: seats.data ? (seats.data.purchased > 0 ? `${seats.data.current} of ${seats.data.purchased}` : String(seats.data.current)) : null, loading: seats.isLoading, icon: 'creditCard', tone: seats.data && seats.data.purchased > 0 && seats.data.current >= seats.data.purchased ? 'red' as const : 'brand' as const, note: seats.data && seats.data.purchased > 0 ? `${seats.data.remaining} left` : 'on your plan', onClick: () => navigate('/settings/billing') }] : []),
  ]

  const events = activity.data?.data ?? []
  const sessionList = sessions.data ?? []
  const current = sessionList.find((s) => s.current)

  return (
    <div className="upf-stack">
      {/* Your role: who they are in this business, in plain words. */}
      <Section title="Your role" variant="section" sub="What you can do in this workspace. The owner sets it in Roles & permissions.">
        <div className="ap-roles">
          {views.length === 0 && <p className="upf-note">No role is on your account yet.</p>}
          {views.map((v) => (
            <div key={v.code} className="ap-role">
              <IconTile icon={v.code === 'OWNER' ? 'star' : 'shield'} tone="brand" size={40} />
              <div className="ap-role__t">
                <div className="ap-role__name">{v.name}</div>
                <div className="ap-role__words">{v.words}</div>
              </div>
            </div>
          ))}
          {areas.length > 0 && (
            <div className="ap-areas">
              <span className="ap-areas__k">You look after</span>
              <div className="upf-chips">{areas.map((a) => <Chip key={a}>{a}</Chip>)}</div>
            </div>
          )}
        </div>
      </Section>

      {glance.length > 0 && <GlanceRow items={glance} />}

      <div className="upf-flow">
        <div className="upf-main">
          {places.length > 0 && (
            <Section title="Go to" variant="section" sub="The places you use most">
              <QuickActionGrid min={170} label="Admin places">
                {places.map((p, i) => (
                  <QuickActionTile key={p.key} index={i} label={p.label} hint={p.key === 'approvals' && waiting ? `${plural(waiting, 'request')} waiting` : p.hint}
                    icon={p.icon} badge={p.key === 'approvals' && waiting ? waiting : undefined} onClick={() => navigate(p.path)} />
                ))}
              </QuickActionGrid>
            </Section>
          )}

          {canAudit && (
            <Section title="Your recent activity" variant="section" body="list"
              loading={activity.isLoading} error={activity.isError ? activity.error : undefined} onRetry={() => void activity.refetch()}
              empty={!activity.isLoading && !activity.isError && events.length === 0 ? { title: 'Nothing recorded yet', hint: 'Your sign-ins and the changes you make show here.' } : undefined}
              footerLink={events.length ? { label: 'Open the audit log', onClick: () => navigate('/audit-logs'), size: 'block' } : undefined}>
              <ListRows>
                {events.map((e) => (
                  <ListRow key={e.id} density="compact" leading={<IconTile icon={e.action === 'LOGIN' || e.action === 'LOGOUT' ? 'logOut' : e.action === 'PERMISSION_CHANGE' ? 'shield' : 'activity'} tone="neutral" size={32} />}
                    title={activityLine(e)} sub={e.summary && e.resourceName ? e.resourceName : undefined}
                    end={<span className="ap-when">{fmtDateTime(e.occurredAt)}</span>}
                    onClick={e.resourcePath ? () => navigate(e.resourcePath!) : undefined} chevron={!!e.resourcePath} />
                ))}
              </ListRows>
            </Section>
          )}
        </div>

        <div className="upf-side">
          {/* The business: the workspace's name and logo, the current company, modules and seats. */}
          <Section title="Business" variant="section">
            <div className="ap-biz">
              <div className="ap-biz__head">
                {brand.markUrl || brand.logoUrl
                  ? <img className="ap-biz__logo" src={(brand.markUrl || brand.logoUrl)!} alt="" />
                  : <Avatar name={brand.workspaceName || company?.name} initials={brand.monogram || undefined} shape="square" size={44} tone="solid" />}
                <div className="ap-biz__t">
                  <div className="ap-biz__name">{brand.workspaceName || company?.name || 'Your workspace'}</div>
                  {company && <div className="ap-biz__sub">{companies.length > 1 ? `Working in ${company.name}` : company.name}</div>}
                </div>
              </div>
              {modules.length > 0 && (
                <div className="upf-kvline"><span>Modules</span><span>{modules.join(', ')}</span></div>
              )}
              {canBilling && (
                <>
                  <div className="upf-kvline"><span>Seats</span><span>{seats.data ? (seats.data.purchased > 0 ? `${seats.data.current} used of ${seats.data.purchased}` : `${seats.data.current} in use`) : seats.isLoading ? '…' : '—'}</span></div>
                  <button type="button" className="ap-link" onClick={() => navigate('/settings/billing')}>Billing & plan</button>
                </>
              )}
              {employeeId && canPeople && (
                <button type="button" className="ap-link" onClick={() => navigate(`/hrms/employees/${employeeId}`)}>Your employee record</button>
              )}
            </div>
          </Section>

          {/* The companies they can open, and their role in each. */}
          <Section id="ap-companies" title="Companies you can open" variant="section" body="list" count={companies.length > 1 ? companies.length : undefined} countTone="neutral"
            empty={!companies.length ? { title: 'Loading your companies…' } : undefined}>
            <ListRows>
              {companies.map((c) => (
                <ListRow key={c.id} density="compact"
                  leading={<Avatar name={c.name} shape="square" size={32} tone="soft" />}
                  title={c.name}
                  sub={c.role || (allRoleNames ? `${allRoleNames} · every company` : undefined)}
                  end={<span className="upf-chips">
                    {c.id === homeCompanyId && <StatusPill tone="neutral" size="sm">Home</StatusPill>}
                    {c.id === companyId && companies.length > 1 && <StatusPill tone="brand" size="sm" dot>Current</StatusPill>}
                  </span>} />
              ))}
            </ListRows>
          </Section>

          {/* Sign-in at a glance; the tab has the controls. */}
          <Section title="Sign-in" variant="section" action={{ label: 'Manage', onClick: onSecurity }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mfa.data && !mfa.data.enabled && mfa.data.requiredForYou
                ? <div className="upf-banner-warn">Your workspace needs two-factor sign-in for you</div>
                : <div className="upf-banner-ok">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" /></svg>
                  Account active
                </div>}
              <div className="upf-kvline"><span>Two-factor</span><span>{mfa.data ? (mfa.data.enabled ? 'On' : 'Off') : mfa.isError ? '—' : '…'}</span></div>
              <div className="upf-kvline"><span>Signed in on</span><span>{sessions.data ? plural(sessionList.length, 'device') : sessions.isError ? '—' : '…'}</span></div>
              {current && <div className="upf-kvline"><span>This session since</span><span>{fmtDateTime(current.signedInAt)}</span></div>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
