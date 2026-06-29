import React, { useState } from 'react'
import { User, Shield, Bell, CreditCard, Plug, AlertTriangle, Check, Zap, Crown, Star } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore } from '@/core/auth/authStore'
import { HrPageHeader, HrButton, HrStatusPill } from '@/shared/components/hr'

type TabKey = 'profile' | 'security' | 'notifications' | 'billing' | 'integrations' | 'danger'

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'Profile', icon: <User size={15} /> },
  { key: 'security', label: 'Security', icon: <Shield size={15} /> },
  { key: 'notifications', label: 'Notifications', icon: <Bell size={15} /> },
  { key: 'billing', label: 'Billing', icon: <CreditCard size={15} /> },
  { key: 'integrations', label: 'Integrations', icon: <Plug size={15} /> },
  { key: 'danger', label: 'Danger Zone', icon: <AlertTriangle size={15} /> },
]

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={clsx(
      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
      enabled ? 'bg-[#FF9D00]' : 'bg-bg-base border border-border-default'
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
          <div className="w-16 h-16 bg-gradient-to-br from-[#FF9D00] to-[#E08A00] rounded-2xl flex items-center justify-center text-white text-xl font-bold">
            {user?.firstName[0]}{user?.lastName[0]}
          </div>
          <div>
            <p className="text-text-primary font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-text-secondary text-sm">{user?.email}</p>
            <button className="mt-1 text-xs text-[#C16E00] hover:text-[#E08A00]">Change avatar</button>
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
                className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all"
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
                className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all read-only:opacity-60"
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
              <input type="password" className="w-full bg-white border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all" />
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

const BillingTab: React.FC = () => {
  const tenant = useAuthStore((s) => s.tenant)
  const plans = [
    { key: 'STARTER', name: 'Starter', price: 29, icon: Star, features: ['Up to 25 users', '3 modules', '5GB storage', 'Email support'], color: 'border-border-default' },
    { key: 'PROFESSIONAL', name: 'Professional', price: 79, icon: Zap, features: ['Up to 250 users', 'All modules', '100GB storage', 'Priority support', 'Advanced analytics'], color: 'border-[#FF9D00]', highlight: true },
    { key: 'ENTERPRISE', name: 'Enterprise', price: 199, icon: Crown, features: ['Unlimited users', 'All modules', 'Unlimited storage', 'Dedicated support', 'Custom integrations', 'SLA guarantee'], color: 'border-[#FFD68A]' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-1">Current Plan</h3>
        <p className="text-text-secondary text-sm mb-4">You are on the <span className="text-[#C16E00] font-medium">{tenant?.planType}</span> plan</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(({ key, name, price, icon: Icon, features, color, highlight }) => (
            <div key={key} className={clsx('relative border rounded-2xl p-5 transition-colors', color, highlight ? 'bg-[#FFF4E1]' : 'bg-white')}>
              {highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[#FF9D00] text-white text-[10px] font-bold rounded-full">MOST POPULAR</span>
              )}
              {tenant?.planType === key && (
                <span className="absolute top-3 right-3"><HrStatusPill tone="ok">Current</HrStatusPill></span>
              )}
              <Icon size={22} className={highlight ? 'text-[#C16E00]' : 'text-text-tertiary'} />
              <h4 className="text-text-primary font-bold mt-2">{name}</h4>
              <p className="text-2xl font-bold text-text-primary mt-1">${price}<span className="text-sm text-text-secondary font-normal">/mo</span></p>
              <ul className="mt-4 space-y-2">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-text-secondary">
                    <Check size={12} className="text-[#15803D] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {tenant?.planType !== key && (
                <button className={clsx('w-full mt-4 py-2 rounded-xl text-sm font-medium transition-colors', highlight ? 'bg-[#FF9D00] hover:bg-[#E08A00] text-white' : 'border border-border-default text-text-secondary hover:text-text-primary hover:border-[#FFD68A]')}>
                  Upgrade
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Billing History</h3>
        <div className="space-y-2">
          {[
            { date: 'Dec 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00089' },
            { date: 'Nov 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00076' },
            { date: 'Oct 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00063' },
          ].map((b) => (
            <div key={b.invoice} className="flex items-center justify-between p-3.5 bg-white border border-border-default rounded-xl">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">{b.date}</p>
                  <p className="text-xs text-text-secondary">{b.invoice}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-text-primary font-medium">{b.amount}</span>
                <HrStatusPill tone="ok">{b.status}</HrStatusPill>
                <button className="text-xs text-[#C16E00] hover:text-[#E08A00]">Download</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const IntegrationsTab: React.FC = () => {
  const [connected, setConnected] = useState<Record<string, boolean>>({ slack: true, github: false, jira: false, zapier: true, stripe: true, salesforce: false })
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
      <p className="text-text-secondary text-sm mb-4">Connect external tools and services to extend UnifiedTree functionality.</p>
      {integrations.map(({ key, name, desc, logo }) => (
        <div key={key} className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl">
          <div className="flex items-center gap-4">
            <span className="text-2xl">{logo}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">{name}</p>
              <p className="text-xs text-text-secondary">{desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {connected[key] && <HrStatusPill tone="ok">Connected</HrStatusPill>}
            <button
              onClick={() => setConnected((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                connected[key] ? 'border border-border-default text-text-secondary hover:text-[#B91C1C] hover:border-[#FCA5A5]' : 'bg-[#FF9D00] hover:bg-[#E08A00] text-white'
              )}
            >
              {connected[key] ? 'Disconnect' : 'Connect'}
            </button>
          </div>
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
  const [activeTab, setActiveTab] = useState<TabKey>('profile')

  const tabContent: Record<TabKey, React.ReactNode> = {
    profile: <ProfileTab />,
    security: <SecurityTab />,
    notifications: <NotificationsTab />,
    billing: <BillingTab />,
    integrations: <IntegrationsTab />,
    danger: <DangerTab />,
  }

  return (
    <div className="animate-fade-in max-w-7xl mx-auto p-6 sm:p-8">
      <HrPageHeader
        crumb="Settings"
        title="Settings"
        subtitle="Manage your account and workspace preferences"
      />
      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0">
          <nav className="space-y-0.5">
            {tabs.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors',
                  activeTab === key ? 'bg-[#FFF4E1] text-[#C16E00] border border-[#FFD68A]' : 'text-text-secondary hover:text-text-primary hover:bg-bg-base',
                  key === 'danger' && activeTab === key && 'bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]',
                  key === 'danger' && activeTab !== key && 'hover:text-[#B91C1C]'
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white border border-border-default rounded-2xl p-6 min-h-[500px]">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  )
}
