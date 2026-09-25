// Workspace Settings (/settings/:tab) in the Payroll Settings design's settings
// pattern (design/settings/SettingsKit). The settings *navigation* lives in the
// app shell; this page renders the tab named in the URL as section cards with
// the design's "On this page" list. What isn't built yet is shown as "Coming
// soon" rather than as controls that pretend to work (notes on each tab below).
// Profile, Security and Danger zone are their own pages (SettingsWorkspaceProfile,
// SettingsSecurity, SettingsDangerZone) because each saves to its own API.
import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { SettingsPage, SettingsSection, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import { DocumentTypesTab } from './SettingsDocumentTypes'
import { NotificationChoiceSections, useNotificationChoices, type NotificationChoicesState } from './NotificationChoices'
import { BrandingTab } from './branding/BrandingTab'
import { WorkspaceProfileSettings } from './SettingsWorkspaceProfile'
import { SecuritySettings } from './SettingsSecurity'
import { DangerZoneSettings } from './SettingsDangerZone'

type TabKey = 'profile' | 'branding' | 'security' | 'notifications' | 'billing' | 'integrations' | 'documents' | 'danger'
type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void

const TAB_META: Record<TabKey, { label: string; desc: string }> = {
  profile:       { label: 'Profile',        desc: 'Your account and the workspace’s own details.' },
  branding:      { label: 'Branding',       desc: 'Your logo and workspace identity.' },
  security:      { label: 'Security',       desc: 'Password, two-factor and active sessions.' },
  notifications: { label: 'Notifications',  desc: 'Which notifications reach you, and how: email, in the app or on your phone.' },
  billing:       { label: 'Billing & Plan', desc: 'Your subscription, plan and invoices.' },
  integrations:  { label: 'Integrations',   desc: 'Connect external tools and services.' },
  documents:     { label: 'Document Types', desc: 'Which documents employees must upload, and the rules for each.' },
  danger:        { label: 'Danger Zone',    desc: 'Export all data, or schedule a reset or deletion of the workspace.' },
}
const VALID_TABS = Object.keys(TAB_META) as TabKey[]

/**
 * Integrations roadmap. None of these are built yet. This tab once rendered a
 * "Connect" button that only flipped local state, with Slack, Zapier and
 * Stripe pre-marked "Connected". The list is the real roadmap, so it stays,
 * shown as coming soon with no control that pretends to do something.
 */
const INTEGRATIONS = [
  { key: 'slack', name: 'Slack', desc: 'Send notifications to Slack channels.', icon: 'megaphone' },
  { key: 'github', name: 'GitHub', desc: 'Link commits and pull requests to projects.', icon: 'workflow' },
  { key: 'jira', name: 'Jira', desc: 'Sync issues with Jira boards.', icon: 'clipboard' },
  { key: 'zapier', name: 'Zapier', desc: 'Automate with thousands of apps through Zapier.', icon: 'activity' },
  { key: 'stripe', name: 'Stripe', desc: 'Take payments through Stripe.', icon: 'creditCard' },
  { key: 'salesforce', name: 'Salesforce', desc: 'Sync CRM data with Salesforce.', icon: 'globe' },
]

/** The "On this page" list for each tab (sections are fixed per tab). Profile,
 *  Security and Danger zone build their own (their sections depend on data). */
const NAV: Partial<Record<TabKey, SettingsNavItem[]>> & { notifications: SettingsNavItem[] } = {
  branding: [{ key: 'logo', label: 'Workspace logo', state: 'none' }, { key: 'editor', label: 'Upload and edit', state: 'none' }],
  notifications: [{ key: 'today', label: 'What reaches you', state: 'none' }, { key: 'email', label: 'Email choices', state: 'on' }, { key: 'inapp', label: 'In-app choices', state: 'on' }, { key: 'push', label: 'Phone push choices', state: 'on' }],
  billing: [{ key: 'plan', label: 'Your plan', state: 'none' }, { key: 'invoices', label: 'Invoices', state: 'soon' }],
  integrations: INTEGRATIONS.map((i) => ({ key: i.key, label: i.name, state: 'soon' as const })),
  documents: [{ key: 'types', label: 'Document types', state: 'none' }],
}

/**
 * Notifications: the signed-in person's own choices, per event and channel
 * (GET/PUT /v1/me/notification-preferences). Every sender checks them; the
 * always-sent ones (security, access, billing, letters HR sends) are shown
 * locked on. Saved through the page's unsaved-changes bar.
 */
const NotificationsTab: React.FC<{ c: NotificationChoicesState }> = ({ c }) => {
  const user = useAuthStore((s) => s.user)
  return (
    <>
      <SettingsSection id="today" icon="bell" title="What reaches you" summary="Requests waiting for you and decisions on your own requests, in the app and on your phone.">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13.5, color: '#334155', lineHeight: 1.5 }}>
          <li>In the app and on your phone: leave, work-from-home, attendance, shift, expense, advance and document requests waiting for you, and decisions on your own requests</li>
          <li>By email: reminders such as probation ending, plus any event you switch on below</li>
          <li>Always: password reset and invitation emails, billing alerts for admins, and letters HR sends you</li>
        </ul>
        <SettingsNote>Changes apply to the next notification. The same email and push switches are on <Link to="/profile#st-notifications" style={{ color: '#047857', fontWeight: 600 }}>your profile</Link>. The wording comes from the workspace’s notification templates.</SettingsNote>
      </SettingsSection>
      {c.status === 'live' && <NotificationChoiceSections c={c} email={user?.email} masters />}
    </>
  )
}

interface BillingSubDto {
  primaryPlanKey: string | null
  planKeys: string[]
  seats: number
  billingCycle: string | null
  unitPriceInr: number | null
  amountInr: number | null
  status: string
  nextChargeAt: string | null
  graceUntil: string | null
  razorpaySubscriptionId: string | null
  billed: boolean
}

/**
 * Billing, from GET /v1/workspace/plan/current (the same endpoint /plan uses,
 * so the two can't disagree). It replaced a mock of USD tiers and invented
 * invoices. Invoice history needs Razorpay's invoice API, so it's "coming soon".
 */
const BillingTab: React.FC = () => {
  const navigate = useNavigate()
  const [subs, setSubs] = useState<BillingSubDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    apiJson<{ subscriptions: BillingSubDto[] }>('/v1/workspace/plan/current')
      .then((r) => { if (alive) { setSubs(r.subscriptions ?? []); setFailed(false) } })
      .catch(() => { if (alive) { setSubs([]); setFailed(true) } })
    return () => { alive = false }
  }, [])
  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const pill = (s: BillingSubDto) =>
    !s.billed ? { tone: 'warn' as const, text: 'No autopay set up' }
      : s.status === 'ACTIVE' ? { tone: 'ok' as const, text: 'Active' }
        : s.status === 'TRIALING' ? { tone: 'ok' as const, text: '7-day trial' }
          : s.status === 'PAST_DUE' ? { tone: 'warn' as const, text: 'Payment retrying' }
            : s.status === 'HALTED' ? { tone: 'red' as const, text: 'Payment failed' }
              : { tone: 'warn' as const, text: s.status }
  const summary = subs === null ? 'Loading your plan…' : failed ? 'Couldn’t load your plan' : subs.length === 0 ? 'No modules on autopay yet' : `${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'} · modules, seats and billing`
  return (
    <>
      <SettingsSection id="plan" icon="creditCard" title="Your plan" summary={summary}>
        {subs === null ? <div role="status" aria-label="Loading your plan"><SkeletonBlock className="h-20 w-full rounded-xl" /></div>
          : failed ? <SettingsNote tone="amber">We couldn’t load your billing details just now. Open Manage plan to see the latest.</SettingsNote>
            : subs.length === 0 ? <SettingsNote>Pick the modules your team needs and set up autopay. The first 7 days are free.</SettingsNote>
              : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {subs.map((s) => {
                    const p = pill(s), next = fmtDate(s.nextChargeAt)
                    return (
                      <div key={s.razorpaySubscriptionId ?? s.primaryPlanKey} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }}>
                        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 4 }}>
                          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 14 }}>{s.planKeys.join(', ') || s.primaryPlanKey}</strong><HrStatusPill tone={p.tone}>{p.text}</HrStatusPill></span>
                          <span style={{ fontSize: 12.5, color: '#64748b' }}>
                            {s.seats > 0 ? <><span className="tabular-nums">{s.seats}</span> seats</> : <>Seat count not set</>}
                            {s.billed && s.amountInr != null && <> · <span className="tabular-nums">₹{s.amountInr.toLocaleString('en-IN')}</span>/{s.billingCycle === 'ANNUAL' ? 'yr' : 'mo'}</>}
                            {next && <> · next charge {next}</>}
                            {!s.billed && <> · unlocked, but nothing is being charged</>}
                          </span>
                        </div>
                        <HrButton variant="ghost" onClick={() => navigate('/plan')}>{s.billed ? 'Change seats' : 'Set up autopay'}</HrButton>
                      </div>
                    )
                  })}
                </div>
              )}
        <div><HrButton onClick={() => navigate('/plan')}>{subs && subs.length === 0 && !failed ? 'Choose modules' : 'Manage plan'}</HrButton></div>
      </SettingsSection>
      <SettingsSection id="invoices" icon="receipt" title="Invoices" summary="Razorpay emails an invoice to your registered address after every successful charge. Downloading past invoices here is coming soon." soon />
    </>
  )
}

const IntegrationsTab: React.FC = () => (
  <>{INTEGRATIONS.map((i) => <SettingsSection key={i.key} id={i.key} icon={i.icon} title={i.name} summary={i.desc} soon />)}</>
)

const DocumentsTab: React.FC = () => (
  <SettingsSection id="types" icon="fileText" title="Document types" summary="What employees see on their profile. Mark a type Required to make it a mandatory upload; HR verifies each upload.">
    <DocumentTypesTab bare />
  </SettingsSection>
)

/**
 * @param tab  Forces the tab for routes with a LITERAL path (/settings/billing,
 *             /settings/danger). Those have no `:tab` param; without the prop
 *             the page fell back to Profile under a "Billing" header (P0-7).
 */
export const Settings: React.FC<{ tab?: TabKey }> = ({ tab: tabProp }) => {
  const { tab } = useParams<{ tab?: string }>()
  const resolved = tabProp ?? tab
  const active: TabKey = VALID_TABS.includes(resolved as TabKey) ? (resolved as TabKey) : 'profile'
  const meta = TAB_META[active]
  const { toast, show, dismiss } = useSettingsToast()
  // Notifications is the one tab with a draft; it drives the unsaved-changes bar.
  const isNotif = active === 'notifications'
  const notif = useNotificationChoices(isNotif)
  const saveNotif = async () => {
    try { await notif.save(); show('ok', 'Notification choices saved', 'They apply to the next notification.') } catch (e) { show('error', 'Couldn’t save your choices', (e as Error)?.message) }
  }
  const nav = isNotif && notif.draft
    ? NAV.notifications.map((n) => (n.key === 'email' ? { ...n, state: notif.draft!.emailEnabled ? 'on' as const : 'off' as const }
      : n.key === 'push' ? { ...n, state: notif.draft!.pushEnabled ? 'on' as const : 'off' as const } : n))
    : (NAV[active] ?? [])
  if (active === 'profile' || active === 'security' || active === 'danger') {
    const Page = active === 'profile' ? WorkspaceProfileSettings : active === 'security' ? SecuritySettings : DangerZoneSettings
    return <DesignFrame><Page key={active} crumb="Workspace Settings" title={meta.label} subtitle={meta.desc} /></DesignFrame>
  }
  const body: Partial<Record<TabKey, React.ReactNode>> = {
    branding: <BrandingTab show={show} />,
    notifications: <NotificationsTab c={notif} />,
    billing: <BillingTab />,
    integrations: <IntegrationsTab />,
    documents: <DocumentsTab />,
  }
  return (
    <DesignFrame>
      <SettingsPage key={active} crumb="Workspace Settings" title={meta.label} subtitle={meta.desc} nav={nav} access="edit"
        status={isNotif ? notif.status : 'live'} onRetry={isNotif ? notif.refetch : undefined} entity={isNotif ? 'your notification choices' : 'settings'}
        dirty={isNotif && notif.dirty} changeCount={isNotif ? notif.changeCount : 0} errorCount={0} saving={isNotif && notif.saving}
        onSave={isNotif ? () => { void saveNotif() } : () => {}} onDiscard={isNotif ? notif.discard : () => {}} toast={toast} onDismissToast={dismiss}>
        {body[active]}
      </SettingsPage>
    </DesignFrame>
  )
}
