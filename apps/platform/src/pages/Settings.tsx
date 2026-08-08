import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Zap, Crown, Star, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson } from '@/core/api/client'
import { HrPageHeader, HrButton, HrStatusPill } from '@/shared/components/hr'

type TabKey = 'profile' | 'security' | 'notifications' | 'billing' | 'integrations' | 'danger'

// The settings *navigation* now lives in the app shell (workspace-scoped);
// this page just renders the section named in the URL (/settings/:tab).
const TAB_META: Record<TabKey, { label: string; desc: string }> = {
  profile:       { label: 'Profile',        desc: 'Your account and organization details.' },
  security:      { label: 'Security',       desc: 'Password, two-factor and active sessions.' },
  notifications: { label: 'Notifications',  desc: 'Email and in-app notification preferences.' },
  billing:       { label: 'Billing & Plan', desc: 'Your subscription, plan and invoices.' },
  integrations:  { label: 'Integrations',   desc: 'Connect external tools and services.' },
  danger:        { label: 'Danger Zone',    desc: 'Irreversible, workspace-wide actions.' },
}
const VALID_TABS = Object.keys(TAB_META) as TabKey[]

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={clsx(
      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
      enabled ? 'bg-[#059669]' : 'bg-bg-base border border-border-default'
    )}
  >
    <span className={clsx('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', enabled ? 'translate-x-5' : 'translate-x-1')} />
  </button>
)

const ProfileTab: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-4">Personal Information</h3>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-[#059669] to-[#047857] rounded-2xl flex items-center justify-center text-white text-xl font-bold">
            {user?.firstName[0]}{user?.lastName[0]}
          </div>
          <div>
            <p className="text-text-primary font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-text-secondary text-sm">{user?.email}</p>
            <button className="mt-1 text-xs text-[#047857] hover:text-[#047857]">Change avatar</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'First Name', value: user?.firstName ?? '' },
            { label: 'Last Name', value: user?.lastName ?? '' },
            { label: 'Email Address', value: user?.email ?? '' },
            { label: 'Role', value: user?.role ?? '' },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-text-tertiary mb-1.5">{label}</label>
              <input
                defaultValue={value}
                className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20 transition-all"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-text-primary font-semibold mb-4">Organization</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Company Name', value: tenant?.name ?? '' },
            { label: 'Industry', value: tenant?.industry ?? '' },
            { label: 'Subdomain', value: tenant?.subdomain ?? '' },
            { label: 'Plan', value: tenant?.planType ?? '' },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-text-tertiary mb-1.5">{label}</label>
              <input
                defaultValue={value}
                readOnly={label === 'Plan'}
                className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20 transition-all read-only:opacity-60"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <HrButton onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000) }}>
          {saved ? <><Check size={14} /> Saved!</> : 'Save Changes'}
        </HrButton>
      </div>
    </div>
  )
}

const SecurityTab: React.FC = () => {
  const [twoFa, setTwoFa] = useState(false)
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-4">Change Password</h3>
        <div className="space-y-4 max-w-md">
          {['Current Password', 'New Password', 'Confirm New Password'].map((label) => (
            <div key={label}>
              <label className="block text-xs font-medium text-text-tertiary mb-1.5">{label}</label>
              <input type="password" className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20 transition-all" />
            </div>
          ))}
          <HrButton>Update Password</HrButton>
        </div>
      </div>
      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Two-Factor Authentication</h3>
        <div className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl max-w-md">
          <div>
            <p className="text-sm font-medium text-text-primary">Authenticator App</p>
            <p className="text-xs text-text-secondary mt-0.5">Use Google Authenticator or similar apps</p>
          </div>
          <Toggle enabled={twoFa} onChange={setTwoFa} />
        </div>
      </div>
      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Active Sessions</h3>
        {[
          { device: 'Chrome on Windows', location: 'Hyderabad, India', time: 'Current session', current: true },
          { device: 'Safari on iPhone', location: 'Mumbai, India', time: '2 days ago', current: false },
        ].map((s, i) => (
          <div key={i} className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl mb-2">
            <div>
              <p className="text-sm font-medium text-text-primary">{s.device}</p>
              <p className="text-xs text-text-secondary">{s.location} — {s.time}</p>
            </div>
            {s.current ? (
              <HrStatusPill tone="ok">Current</HrStatusPill>
            ) : (
              <button className="text-xs text-[#B91C1C] hover:text-[#DC2626] transition-colors">Revoke</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const NotificationsTab: React.FC = () => {
  const [settings, setSettings] = useState({
    emailNewEmployee: true, emailLeaveRequest: true, emailPayroll: false,
    emailDeals: true, emailTickets: true, emailInvoices: false,
    pushAll: true, pushCritical: true, pushMentions: true,
  })

  const toggle = (key: keyof typeof settings) => setSettings((s) => ({ ...s, [key]: !s[key] }))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-1">Email Notifications</h3>
        <p className="text-text-secondary text-sm mb-4">Choose which events trigger email alerts</p>
        <div className="space-y-3">
          {[
            { key: 'emailNewEmployee' as const, label: 'New employee joined', desc: 'When a new user is added to the workspace' },
            { key: 'emailLeaveRequest' as const, label: 'Leave request submitted', desc: 'When an employee submits a leave request' },
            { key: 'emailPayroll' as const, label: 'Payroll processed', desc: 'Monthly payroll completion notification' },
            { key: 'emailDeals' as const, label: 'Deal status changed', desc: 'CRM deal stage updates' },
            { key: 'emailTickets' as const, label: 'Critical tickets opened', desc: 'High & critical priority helpdesk tickets' },
            { key: 'emailInvoices' as const, label: 'Invoice overdue', desc: 'When invoices pass their due date' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3.5 bg-white border border-border-default rounded-xl">
              <div>
                <p className="text-sm font-medium text-text-primary">{label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
              </div>
              <Toggle enabled={settings[key]} onChange={() => toggle(key)} />
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Push Notifications</h3>
        <div className="space-y-3">
          {[
            { key: 'pushAll' as const, label: 'All notifications', desc: 'Receive all in-app notifications' },
            { key: 'pushCritical' as const, label: 'Critical alerts only', desc: 'Security & system critical alerts' },
            { key: 'pushMentions' as const, label: 'Mentions & assignments', desc: 'When you are tagged or assigned' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3.5 bg-white border border-border-default rounded-xl">
              <div>
                <p className="text-sm font-medium text-text-primary">{label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
              </div>
              <Toggle enabled={settings[key]} onChange={() => toggle(key)} />
            </div>
          ))}
        </div>
      </div>
    </div>
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
 * Real billing state for this workspace.
 *
 * Replaces a hardcoded mock that showed three USD tiers ($29 / $79 / $199),
 * a "PROFESSIONAL" badge and three invented invoices (INV-00089 and friends).
 * None of it existed: pricing is per-module in rupees from
 * platform.module_plans (HR is ₹39/user/month), there are no such tiers, and
 * no invoice with those numbers was ever issued. A customer reading that page
 * was being shown fabricated financial records.
 *
 * Everything here now comes from GET /v1/workspace/plan/current, the same
 * endpoint /plan uses, so the two screens cannot disagree. Billing history is
 * deliberately absent rather than faked — real invoices need Razorpay's
 * invoice API, which is not wired yet.
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

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  const pill = (s: BillingSubDto) =>
    !s.billed                 ? { tone: 'warn' as const, text: 'No autopay set up' } :
    s.status === 'ACTIVE'     ? { tone: 'ok'   as const, text: 'Active' } :
    s.status === 'TRIALING'   ? { tone: 'ok'   as const, text: '7-day trial' } :
    s.status === 'PAST_DUE'   ? { tone: 'warn' as const, text: 'Payment retrying' } :
    s.status === 'HALTED'     ? { tone: 'red'  as const, text: 'Payment failed' } :
                                { tone: 'warn' as const, text: s.status }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-text-primary font-semibold mb-1">Your plan</h3>
            <p className="text-text-secondary text-sm">Modules, seats and billing for this workspace.</p>
          </div>
          <button onClick={() => navigate('/plan')}
                  className="px-4 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-medium">
            Manage plan
          </button>
        </div>

        {subs === null ? (
          <div className="h-24 animate-pulse rounded-2xl border border-border-default bg-white" />
        ) : failed ? (
          <div className="rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-5 text-sm text-[#B91C1C]">
            We couldn't load your billing details just now. Open Manage plan to see the latest.
          </div>
        ) : subs.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-white p-6 text-center">
            <p className="text-sm font-medium text-text-primary">No modules on autopay yet</p>
            <p className="mt-1 text-xs text-text-secondary">
              Pick the modules your team needs and set up autopay — the first 7 days are free.
            </p>
            <button onClick={() => navigate('/plan')}
                    className="mt-4 px-4 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-medium">
              Choose modules
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {subs.map((s) => {
              const p = pill(s)
              const next = fmtDate(s.nextChargeAt)
              return (
                <div key={s.razorpaySubscriptionId ?? s.primaryPlanKey}
                     className="flex flex-wrap items-center justify-between gap-3 p-5 bg-white border border-border-default rounded-2xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">
                        {s.planKeys.join(', ') || s.primaryPlanKey}
                      </p>
                      <HrStatusPill tone={p.tone}>{p.text}</HrStatusPill>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {s.seats > 0
                        ? <><span className="tabular-nums">{s.seats}</span> seats</>
                        : <>Seat count not set</>}
                      {s.billed && s.amountInr != null && (
                        <> · <span className="tabular-nums">₹{s.amountInr.toLocaleString('en-IN')}</span>
                          /{s.billingCycle === 'ANNUAL' ? 'yr' : 'mo'}</>
                      )}
                      {next && <> · next charge {next}</>}
                      {!s.billed && <> · unlocked, but nothing is being charged</>}
                    </p>
                  </div>
                  <button onClick={() => navigate('/plan')}
                          className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-text-secondary hover:text-text-primary hover:border-[#6EE7B7]">
                    {s.billed ? 'Change seats' : 'Set up autopay'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-2">Invoices</h3>
        <p className="text-text-secondary text-sm">
          Razorpay emails an invoice to your registered address after every successful
          charge. Downloadable invoice history is coming to this page soon.
        </p>
      </div>
    </div>
  )
}

/**
 * Integrations roadmap.
 *
 * None of these are built yet. This tab previously rendered a working-looking
 * "Connect" button whose only effect was flipping a local useState — and it
 * shipped with Slack, Zapier and Stripe pre-marked "Connected", so an admin
 * would reasonably believe their workspace was wired to services it has never
 * spoken to. The list is kept (it is the real roadmap) but presented honestly
 * as launching soon, with no control that pretends to do something.
 */
const IntegrationsTab: React.FC = () => {
  const integrations = [
    { key: 'slack', name: 'Slack', desc: 'Send notifications to Slack channels', logo: '🔔' },
    { key: 'github', name: 'GitHub', desc: 'Link commits and PRs to projects', logo: '🐙' },
    { key: 'jira', name: 'Jira', desc: 'Sync issues with Jira boards', logo: '📋' },
    { key: 'zapier', name: 'Zapier', desc: 'Automate with 5000+ apps via Zapier', logo: '⚡' },
    { key: 'stripe', name: 'Stripe', desc: 'Process payments via Stripe', logo: '💳' },
    { key: 'salesforce', name: 'Salesforce', desc: 'Sync CRM data with Salesforce', logo: '☁️' },
  ]

  return (
    <div className="space-y-3">
      <p className="text-text-secondary text-sm mb-4">
        Connect external tools and services to extend UnifiedTree functionality.
        These integrations are on the roadmap and will light up here as they ship.
      </p>
      {integrations.map(({ key, name, desc, logo }) => (
        <div key={key} className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl opacity-75">
          <div className="flex items-center gap-4">
            <span className="text-2xl grayscale">{logo}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">{name}</p>
              <p className="text-xs text-text-secondary">{desc}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-semibold text-[#047857]">
            <Sparkles size={11} /> Launching soon
          </span>
        </div>
      ))}
    </div>
  )
}

const DangerTab: React.FC = () => (
  <div className="space-y-4">
    <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl">
      <h3 className="text-[#B91C1C] font-semibold text-sm mb-1">Export All Data</h3>
      <p className="text-text-secondary text-xs mb-3">Download a full export of your workspace data in JSON format. This may take a few minutes.</p>
      <button className="px-4 py-2 border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEE2E2] rounded-xl text-sm font-medium transition-colors">
        Request Data Export
      </button>
    </div>
    <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl">
      <h3 className="text-[#B91C1C] font-semibold text-sm mb-1">Reset Workspace</h3>
      <p className="text-text-secondary text-xs mb-3">Remove all data from your workspace but keep your account and settings. This action cannot be undone.</p>
      <button className="px-4 py-2 border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEE2E2] rounded-xl text-sm font-medium transition-colors">
        Reset Workspace
      </button>
    </div>
    <div className="p-4 bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl">
      <h3 className="text-[#B91C1C] font-semibold text-sm mb-1">Delete Organization</h3>
      <p className="text-text-secondary text-xs mb-3">Permanently delete your organization and all associated data. This action is <span className="text-[#B91C1C] font-semibold">irreversible</span>.</p>
      <HrButton variant="danger">Delete Organization</HrButton>
    </div>
  </div>
)

export const Settings: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>()
  const active: TabKey = VALID_TABS.includes(tab as TabKey) ? (tab as TabKey) : 'profile'
  const meta = TAB_META[active]

  const tabContent: Record<TabKey, React.ReactNode> = {
    profile: <ProfileTab />,
    security: <SecurityTab />,
    notifications: <NotificationsTab />,
    billing: <BillingTab />,
    integrations: <IntegrationsTab />,
    danger: <DangerTab />,
  }

  return (
    <div className="animate-fade-in mx-auto max-w-4xl p-6 sm:p-8">
      <HrPageHeader crumb="Workspace Settings" title={meta.label} subtitle={meta.desc} />
      <div className="rounded-2xl border border-border-default bg-white p-6">
        {tabContent[active]}
      </div>
    </div>
  )
}
