import React, { useState } from 'react'
import { User, Shield, Bell, CreditCard, Plug, AlertTriangle, Check, Zap, Crown, Star } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore } from '@/core/auth/authStore'

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
      enabled ? 'bg-indigo-600' : 'bg-[#F1F5F9]'
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
        <h3 className="text-[#0F172A] font-semibold mb-4">Personal Information</h3>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center text-[#0F172A] text-xl font-bold">
            {user?.firstName[0]}{user?.lastName[0]}
          </div>
          <div>
            <p className="text-[#0F172A] font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-[#64748B] text-sm">{user?.email}</p>
            <button className="mt-1 text-xs text-[#0F6E56] hover:text-[#0F6E56]">Change avatar</button>
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
              <label className="block text-xs font-medium text-[#64748B] mb-1.5">{label}</label>
              <input
                defaultValue={value}
                className="w-full bg-white/50 border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-[#0F172A] text-sm focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-[#0F172A] font-semibold mb-4">Organization</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Company Name', value: tenant?.name ?? '' },
            { label: 'Industry', value: tenant?.industry ?? '' },
            { label: 'Subdomain', value: tenant?.subdomain ?? '' },
            { label: 'Plan', value: tenant?.planType ?? '' },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-[#64748B] mb-1.5">{label}</label>
              <input
                defaultValue={value}
                readOnly={label === 'Plan'}
                className="w-full bg-white/50 border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-[#0F172A] text-sm focus:outline-none focus:border-indigo-500 transition-all read-only:opacity-60"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000) }}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
        >
          {saved ? <><Check size={14} /> Saved!</> : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

const SecurityTab: React.FC = () => {
  const [twoFa, setTwoFa] = useState(false)
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[#0F172A] font-semibold mb-4">Change Password</h3>
        <div className="space-y-4 max-w-md">
          {['Current Password', 'New Password', 'Confirm New Password'].map((label) => (
            <div key={label}>
              <label className="block text-xs font-medium text-[#64748B] mb-1.5">{label}</label>
              <input type="password" className="w-full bg-white/50 border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-[#0F172A] text-sm focus:outline-none focus:border-indigo-500 transition-all" />
            </div>
          ))}
          <button className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
            Update Password
          </button>
        </div>
      </div>
      <div className="border-t border-[#E2E8F0] pt-6">
        <h3 className="text-[#0F172A] font-semibold mb-4">Two-Factor Authentication</h3>
        <div className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0]/40 rounded-xl max-w-md">
          <div>
            <p className="text-sm font-medium text-[#0F172A]">Authenticator App</p>
            <p className="text-xs text-[#64748B] mt-0.5">Use Google Authenticator or similar apps</p>
          </div>
          <Toggle enabled={twoFa} onChange={setTwoFa} />
        </div>
      </div>
      <div className="border-t border-[#E2E8F0] pt-6">
        <h3 className="text-[#0F172A] font-semibold mb-4">Active Sessions</h3>
        {[
          { device: 'Chrome on Windows', location: 'Hyderabad, India', time: 'Current session', current: true },
          { device: 'Safari on iPhone', location: 'Mumbai, India', time: '2 days ago', current: false },
        ].map((s, i) => (
          <div key={i} className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0]/40 rounded-xl mb-2">
            <div>
              <p className="text-sm font-medium text-[#0F172A]">{s.device}</p>
              <p className="text-xs text-[#64748B]">{s.location} — {s.time}</p>
            </div>
            {s.current ? (
              <span className="text-xs text-emerald-400 px-2 py-1 bg-emerald-500/10 rounded-lg">Current</span>
            ) : (
              <button className="text-xs text-red-400 hover:text-red-300 transition-colors">Revoke</button>
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
        <h3 className="text-[#0F172A] font-semibold mb-1">Email Notifications</h3>
        <p className="text-[#64748B] text-sm mb-4">Choose which events trigger email alerts</p>
        <div className="space-y-3">
          {[
            { key: 'emailNewEmployee' as const, label: 'New employee joined', desc: 'When a new user is added to the workspace' },
            { key: 'emailLeaveRequest' as const, label: 'Leave request submitted', desc: 'When an employee submits a leave request' },
            { key: 'emailPayroll' as const, label: 'Payroll processed', desc: 'Monthly payroll completion notification' },
            { key: 'emailDeals' as const, label: 'Deal status changed', desc: 'CRM deal stage updates' },
            { key: 'emailTickets' as const, label: 'Critical tickets opened', desc: 'High & critical priority helpdesk tickets' },
            { key: 'emailInvoices' as const, label: 'Invoice overdue', desc: 'When invoices pass their due date' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3.5 bg-white border border-[#E2E8F0]/40 rounded-xl">
              <div>
                <p className="text-sm font-medium text-[#0F172A]">{label}</p>
                <p className="text-xs text-[#64748B] mt-0.5">{desc}</p>
              </div>
              <Toggle enabled={settings[key]} onChange={() => toggle(key)} />
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[#E2E8F0] pt-6">
        <h3 className="text-[#0F172A] font-semibold mb-4">Push Notifications</h3>
        <div className="space-y-3">
          {[
            { key: 'pushAll' as const, label: 'All notifications', desc: 'Receive all in-app notifications' },
            { key: 'pushCritical' as const, label: 'Critical alerts only', desc: 'Security & system critical alerts' },
            { key: 'pushMentions' as const, label: 'Mentions & assignments', desc: 'When you are tagged or assigned' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3.5 bg-white border border-[#E2E8F0]/40 rounded-xl">
              <div>
                <p className="text-sm font-medium text-[#0F172A]">{label}</p>
                <p className="text-xs text-[#64748B] mt-0.5">{desc}</p>
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
    { key: 'STARTER', name: 'Starter', price: 29, icon: Star, features: ['Up to 25 users', '3 modules', '5GB storage', 'Email support'], color: 'border-[#E2E8F0]' },
    { key: 'PROFESSIONAL', name: 'Professional', price: 79, icon: Zap, features: ['Up to 250 users', 'All modules', '100GB storage', 'Priority support', 'Advanced analytics'], color: 'border-indigo-500', highlight: true },
    { key: 'ENTERPRISE', name: 'Enterprise', price: 199, icon: Crown, features: ['Unlimited users', 'All modules', 'Unlimited storage', 'Dedicated support', 'Custom integrations', 'SLA guarantee'], color: 'border-purple-500' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[#0F172A] font-semibold mb-1">Current Plan</h3>
        <p className="text-[#64748B] text-sm mb-4">You are on the <span className="text-[#0F6E56] font-medium">{tenant?.planType}</span> plan</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(({ key, name, price, icon: Icon, features, color, highlight }) => (
            <div key={key} className={clsx('relative border rounded-2xl p-5 transition-colors', color, highlight ? 'bg-indigo-500/5' : 'bg-white')}>
              {highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-indigo-600 text-[#0F172A] text-[10px] font-bold rounded-full">MOST POPULAR</span>
              )}
              {tenant?.planType === key && (
                <span className="absolute top-3 right-3 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] rounded-lg">Current</span>
              )}
              <Icon size={22} className={highlight ? 'text-[#0F6E56]' : 'text-[#64748B]'} />
              <h4 className="text-[#0F172A] font-bold mt-2">{name}</h4>
              <p className="text-2xl font-bold text-[#0F172A] mt-1">${price}<span className="text-sm text-[#64748B] font-normal">/mo</span></p>
              <ul className="mt-4 space-y-2">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-[#64748B]">
                    <Check size={12} className="text-emerald-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {tenant?.planType !== key && (
                <button className={clsx('w-full mt-4 py-2 rounded-xl text-sm font-medium transition-colors', highlight ? 'bg-indigo-600 hover:bg-indigo-500 text-[#0F172A]' : 'border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-slate-600')}>
                  Upgrade
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[#E2E8F0] pt-6">
        <h3 className="text-[#0F172A] font-semibold mb-4">Billing History</h3>
        <div className="space-y-2">
          {[
            { date: 'Dec 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00089' },
            { date: 'Nov 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00076' },
            { date: 'Oct 1, 2024', amount: '$79.00', status: 'Paid', invoice: 'INV-00063' },
          ].map((b) => (
            <div key={b.invoice} className="flex items-center justify-between p-3.5 bg-white border border-[#E2E8F0]/40 rounded-xl">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium text-[#0F172A]">{b.date}</p>
                  <p className="text-xs text-[#64748B]">{b.invoice}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-[#0F172A] font-medium">{b.amount}</span>
                <span className="text-xs text-emerald-400 px-2 py-0.5 bg-emerald-500/10 rounded-lg">{b.status}</span>
                <button className="text-xs text-[#0F6E56] hover:text-[#0F6E56]">Download</button>
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
      <p className="text-[#64748B] text-sm mb-4">Connect external tools and services to extend Ionora functionality.</p>
      {integrations.map(({ key, name, desc, logo }) => (
        <div key={key} className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0]/40 rounded-xl">
          <div className="flex items-center gap-4">
            <span className="text-2xl">{logo}</span>
            <div>
              <p className="text-sm font-medium text-[#0F172A]">{name}</p>
              <p className="text-xs text-[#64748B]">{desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {connected[key] && <span className="text-xs text-emerald-400">Connected</span>}
            <button
              onClick={() => setConnected((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                connected[key] ? 'border border-[#E2E8F0] text-[#64748B] hover:text-red-400 hover:border-red-500/30' : 'bg-indigo-600 hover:bg-indigo-500 text-[#0F172A]'
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
    <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
      <h3 className="text-red-400 font-semibold text-sm mb-1">Export All Data</h3>
      <p className="text-[#64748B] text-xs mb-3">Download a full export of your workspace data in JSON format. This may take a few minutes.</p>
      <button className="px-4 py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition-colors">
        Request Data Export
      </button>
    </div>
    <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
      <h3 className="text-red-400 font-semibold text-sm mb-1">Reset Workspace</h3>
      <p className="text-[#64748B] text-xs mb-3">Remove all data from your workspace but keep your account and settings. This action cannot be undone.</p>
      <button className="px-4 py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition-colors">
        Reset Workspace
      </button>
    </div>
    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
      <h3 className="text-red-400 font-semibold text-sm mb-1">Delete Organization</h3>
      <p className="text-[#64748B] text-xs mb-3">Permanently delete your organization and all associated data. This action is <span className="text-red-400 font-semibold">irreversible</span>.</p>
      <button className="px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-400 hover:bg-red-600/30 rounded-xl text-sm font-medium transition-colors">
        Delete Organization
      </button>
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
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#0F172A]">Settings</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Manage your account and workspace preferences</p>
      </div>
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
                  activeTab === key ? 'bg-indigo-600/20 text-[#0F6E56] border border-indigo-500/20' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/5',
                  key === 'danger' && activeTab === key && 'bg-red-500/10 text-red-400 border-red-500/20',
                  key === 'danger' && activeTab !== key && 'hover:text-red-400'
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white border border-[#E2E8F0] rounded-2xl p-6 min-h-[500px]">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  )
}
