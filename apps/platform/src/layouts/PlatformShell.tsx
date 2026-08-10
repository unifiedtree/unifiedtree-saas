import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, Calendar, Clock, Building2, ClipboardList,
  Settings, LogOut, Menu, ChevronRight, ChevronDown,
  UserCircle2, ShieldAlert, FileBarChart2, FileText, Bell, Search,
  TrendingUp, CreditCard, Package, ShoppingCart, HelpCircle, Briefcase,
  UserCheck, Star, Receipt, DollarSign, Lock, MapPin,
  Database, Target, Wallet, Plug, Award, Shield, AlertTriangle,
  PanelLeftClose, PanelLeft, LayoutGrid, ArrowLeft, Command,
  Image as ImageIcon,
} from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'
import { GlobalSearch } from '@/shared/components/GlobalSearch'

const SIDEBAR_KEY = 'ut.sidebar.collapsed'

const ROLE_PRIORITY = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'EMPLOYEE'] as const
type PlatformRole = typeof ROLE_PRIORITY[number]
const ROLE_LABELS: Record<PlatformRole | string, string> = {
  SUPER_ADMIN: 'Super Admin', HR_MANAGER: 'HR Manager', FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager', EMPLOYEE: 'Employee',
}

interface NavChild { label: string; path: string; icon: React.ReactNode; visibleForRoles?: string[] }
interface NavItemDef { key: string; label: string; icon: React.ReactNode; path?: string; module?: string; visibleForRoles?: string[]; children?: NavChild[] }

// ─── Top-level nav (the HRMS app's flat links) ────────────────────────────────
const NAV_ITEMS: NavItemDef[] = [
  { key: 'dashboard',   label: 'Overview',     icon: <LayoutDashboard size={18} />, path: '/dashboard', visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] },
  { key: 'myworkspace', label: 'My Workspace', icon: <UserCircle2 size={18} />,     path: '/me',        visibleForRoles: ['EMPLOYEE'] },
  { key: 'myteam',      label: 'My Team',      icon: <Users size={18} />,           path: '/team',      visibleForRoles: ['DEPT_MANAGER'] },
]

const R_ADMIN     = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD']
const R_ADMIN_MGR = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER']
const R_HR        = ['SUPER_ADMIN', 'HR_MANAGER']
const R_FIN       = ['SUPER_ADMIN', 'FINANCE_LEAD', 'HR_MANAGER']
const R_ESS       = ['EMPLOYEE']

// ─── Module items: HRMS nav groups (module 'hrms') + the sellable modules. ─────
const MODULE_ITEMS: NavItemDef[] = [
  {
    key: 'company', label: 'Company Profile', icon: <Building2 size={18} />, module: 'hrms',
    children: [
      { label: 'Companies & Branches', path: '/hrms/organization', icon: <Building2 size={15} />, visibleForRoles: R_HR },
    ],
  },
  {
    key: 'master', label: 'Master', icon: <Database size={18} />, module: 'hrms',
    children: [
      { label: 'Workforce Directory', path: '/hrms/employees',         icon: <UserCheck size={15} />,     visibleForRoles: R_ADMIN_MGR },
      { label: 'Organization Setup',  path: '/hrms/organization',      icon: <Building2 size={15} />,     visibleForRoles: R_HR },
      { label: 'Rules & Policies',    path: '/hrms/policies', icon: <ClipboardList size={15} />, visibleForRoles: R_HR },
      { label: 'Payroll Configuration', path: '/hrms/payroll/components', icon: <Receipt size={15} />,     visibleForRoles: R_FIN },
    ],
  },
  {
    key: 'attendance', label: 'Attendance & Time', icon: <Clock size={18} />, module: 'hrms',
    children: [
      { label: 'Attendance Analytics', path: '/hrms/att-analytics', icon: <FileBarChart2 size={15} />, visibleForRoles: R_ADMIN_MGR },
      { label: 'Daily Tracking',       path: '/hrms/attendance',          icon: <Clock size={15} />,         visibleForRoles: R_ADMIN_MGR },
      { label: 'Shifts & Overtime',    path: '/hrms/shifts',      icon: <Clock size={15} />,         visibleForRoles: R_HR },
      { label: 'Geofencing',           path: '/hrms/attendance/geofencing', icon: <MapPin size={15} />,      visibleForRoles: R_HR },
    ],
  },
  {
    key: 'leave', label: 'Leave Management', icon: <Calendar size={18} />, module: 'hrms',
    children: [
      { label: 'Leave Operations Center', path: '/hrms/leave', icon: <Calendar size={15} />, visibleForRoles: R_ADMIN_MGR },
    ],
  },
  {
    key: 'recruit', label: 'Recruitment & Onboarding', icon: <UserCheck size={18} />, module: 'hrms',
    children: [
      { label: 'Hiring Pipeline',      path: '/hrms/hiring',  icon: <UserCheck size={15} />,    visibleForRoles: R_HR },
      { label: 'Onboarding & Assets',  path: '/hrms/onboarding/instances',  icon: <ClipboardList size={15} />, visibleForRoles: R_HR },
      { label: 'Letter Templates',     path: '/hrms/letters/templates',     icon: <FileText size={15} />,      visibleForRoles: R_HR },
      { label: 'Generated Letters',    path: '/hrms/letters/generated',     icon: <FileText size={15} />,      visibleForRoles: R_HR },
      { label: 'Letter Distributions', path: '/hrms/letters/distributions', icon: <FileText size={15} />,      visibleForRoles: R_HR },
      { label: 'Employee Vault',       path: '/hrms/documents',        icon: <FileText size={15} />,      visibleForRoles: R_HR },
    ],
  },
  {
    key: 'payroll-hr', label: 'Payroll', icon: <CreditCard size={18} />, module: 'hrms',
    children: [
      { label: 'Payroll Dashboard',          path: '/hrms/payroll-dashboard', icon: <LayoutDashboard size={15} />, visibleForRoles: R_FIN },
      { label: 'Salary Structure',           path: '/hrms/salary-structure',  icon: <Receipt size={15} />,         visibleForRoles: R_FIN },
      { label: 'Processing & Payslips',      path: '/hrms/payroll/runs',           icon: <Receipt size={15} />,         visibleForRoles: R_FIN },
      { label: 'Payroll Settings',           path: '/hrms/payroll/settings',       icon: <Settings size={15} />,        visibleForRoles: R_FIN },
      { label: 'Production-Linked Incentive', path: '/hrms/pli',              icon: <Target size={15} />,          visibleForRoles: R_FIN },
      { label: 'Advances & Loans',           path: '/hrms/advances',          icon: <Wallet size={15} />,          visibleForRoles: [...R_ADMIN_MGR, ...R_ESS] },
      { label: 'Bank Disbursement',          path: '/hrms/bank-disbursement', icon: <CreditCard size={15} />,      visibleForRoles: R_FIN },
    ],
  },
  {
    key: 'expense', label: 'Expense Management', icon: <Receipt size={18} />, module: 'hrms',
    children: [
      { label: 'Expense Center', path: '/hrms/expenses', icon: <Receipt size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_ESS] },
    ],
  },
  {
    key: 'ess', label: 'Employee Self Service', icon: <UserCircle2 size={18} />, module: 'hrms',
    children: [
      { label: 'My Attendance & Leaves', path: '/hrms/attendance', icon: <Clock size={15} />,       visibleForRoles: R_ESS },
      { label: 'My Payslip',             path: '/me/payslips',     icon: <Receipt size={15} />,      visibleForRoles: R_ESS },
      { label: 'My Profile',             path: '/me',              icon: <UserCircle2 size={15} />,  visibleForRoles: R_ESS },
      { label: 'Team Attendance',        path: '/team',            icon: <Users size={15} />,        visibleForRoles: ['DEPT_MANAGER'] },
    ],
  },
  {
    key: 'performance', label: 'Performance & Learning', icon: <Target size={18} />, module: 'hrms',
    children: [
      { label: 'Performance Center',   path: '/hrms/performance', icon: <Target size={15} />,   visibleForRoles: [...R_ADMIN_MGR, ...R_ESS, ...R_HR] },
      { label: 'Learning & Skills',    path: '/hrms/learning',    icon: <Award size={15} />,    visibleForRoles: R_HR },
    ],
  },
  {
    key: 'compliance', label: 'Compliance', icon: <ShieldAlert size={18} />, module: 'hrms',
    children: [
      { label: 'Statutory Compliance', path: '/hrms/compliance',           icon: <ShieldAlert size={15} />, visibleForRoles: R_ADMIN },
      { label: 'Muster Roll',          path: '/hrms/muster-roll',         icon: <FileText size={15} />,    visibleForRoles: R_HR },
      { label: 'POSH Case Management', path: '/hrms/compliance',                icon: <ShieldAlert size={15} />, visibleForRoles: R_HR },
      { label: 'Inspector View',       path: '/hrms/compliance',      icon: <ShieldAlert size={15} />, visibleForRoles: R_ADMIN },
      { label: 'Compliance Calendar',  path: '/hrms/compliance', icon: <Calendar size={15} />,    visibleForRoles: R_ADMIN },
    ],
  },
  {
    key: 'reports', label: 'Reports & Analytics', icon: <FileBarChart2 size={18} />, module: 'hrms',
    children: [
      { label: 'Reports Center',          path: '/hrms/reports',             icon: <FileBarChart2 size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_FIN] },
      { label: 'Workforce Analytics',     path: '/hrms/workforce-analytics', icon: <TrendingUp size={15} />,   visibleForRoles: R_ADMIN },
    ],
  },
  {
    key: 'exit', label: 'Employee Exit', icon: <LogOut size={18} />, module: 'hrms',
    children: [
      { label: 'Resignation & Exit',       path: '/hrms/fnf',  icon: <LogOut size={15} />,   visibleForRoles: R_HR },
      { label: 'Full & Final Settlement',  path: '/hrms/fnf',          icon: <Wallet size={15} />,   visibleForRoles: R_FIN },
      { label: 'Experience Letter',        path: '/hrms/letters/templates', icon: <FileText size={15} />, visibleForRoles: R_HR },
    ],
  },
  {
    key: 'hrsettings', label: 'Settings', icon: <Settings size={18} />, module: 'hrms',
    children: [
      { label: 'HR Configuration',      path: '/hrms/settings',                   icon: <Settings size={15} />, visibleForRoles: R_HR },
      { label: 'Holiday Calendar',      path: '/hrms/leave',                      icon: <Calendar size={15} />, visibleForRoles: R_HR },
      { label: 'Notification Templates', path: '/hrms/notification-templates', icon: <Bell size={15} />,    visibleForRoles: R_HR },
      { label: 'Integrations',          path: '/hrms/integrations',          icon: <Plug size={15} />,     visibleForRoles: R_HR },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: <TrendingUp size={18} />, module: 'crm',
    children: [
      { label: 'Leads',     path: '/crm/leads',     icon: <Star size={15} /> },
      { label: 'Customers', path: '/crm/customers', icon: <Users size={15} /> },
      { label: 'Deals',     path: '/crm/deals',     icon: <Briefcase size={15} /> },
    ],
  },
  {
    key: 'accounts', label: 'Accounts', icon: <DollarSign size={18} />, module: 'accounts',
    children: [
      { label: 'Invoices', path: '/accounts/invoices', icon: <FileText size={15} /> },
      { label: 'Payments', path: '/accounts/payments', icon: <CreditCard size={15} /> },
      { label: 'Expenses', path: '/accounts/expenses', icon: <Receipt size={15} /> },
    ],
  },
  { key: 'payroll', label: 'Payroll', icon: <CreditCard size={18} />, path: '/payroll', module: 'payroll' },
  {
    key: 'projects', label: 'Projects', icon: <Package size={18} />, module: 'projects',
    children: [
      { label: 'All Projects', path: '/projects',       icon: <Package size={15} /> },
      { label: 'Task Board',   path: '/projects/board', icon: <ClipboardList size={15} /> },
    ],
  },
  { key: 'inventory',   label: 'Inventory',   icon: <Building2 size={18} />,    path: '/inventory',   module: 'inventory' },
  { key: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />, path: '/procurement', module: 'procurement' },
  {
    key: 'helpdesk', label: 'Helpdesk', icon: <HelpCircle size={18} />, module: 'helpdesk',
    children: [
      { label: 'Tickets', path: '/helpdesk/tickets', icon: <ClipboardList size={15} /> },
    ],
  },
]

// ─── Platform admin items (the "Settings" app) ────────────────────────────────
const PLATFORM_ITEMS: NavItemDef[] = [
  { key: 'users',    label: 'Users & Access', icon: <Users size={18} />,       path: '/users',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'roles',    label: 'Roles & Perms',  icon: <ShieldAlert size={18} />, path: '/roles',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'audit',    label: 'Audit Logs',     icon: <FileText size={18} />,    path: '/audit-logs', visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'settings', label: 'Configuration',  icon: <Settings size={18} />,    path: '/settings',   visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] },
]

// ─── Workspace Settings nav (the "Settings" app — workspace-level, NOT a module) ──
// Account + Workspace sections everyone with settings access sees; Administration
// is super-admin only. Each maps to a route the shell drives.
const SETTINGS_NAV: NavItemDef[] = [
  { key: 's-profile',       label: 'Profile',             icon: <UserCircle2 size={18} />,  path: '/settings' },
  { key: 's-branding',      label: 'Branding',            icon: <ImageIcon size={18} />,     path: '/settings/branding',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 's-security',      label: 'Security',            icon: <Shield size={18} />,        path: '/settings/security' },
  { key: 's-notifications', label: 'Notifications',       icon: <Bell size={18} />,          path: '/settings/notifications' },
  { key: 's-billing',       label: 'Billing & Plan',      icon: <CreditCard size={18} />,    path: '/settings/billing' },
  { key: 's-integrations',  label: 'Integrations',        icon: <Plug size={18} />,          path: '/settings/integrations' },
  { key: 's-users',         label: 'Users & Access',      icon: <Users size={18} />,         path: '/users',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 's-roles',         label: 'Roles & Permissions', icon: <ShieldAlert size={18} />,   path: '/roles',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 's-audit',         label: 'Audit Logs',          icon: <FileText size={18} />,      path: '/audit-logs', visibleForRoles: ['SUPER_ADMIN'] },
  { key: 's-danger',        label: 'Danger Zone',         icon: <AlertTriangle size={18} />, path: '/settings/danger' },
]

// Non-HRMS modules become their own apps in the launcher / switcher.
const NON_HRMS = MODULE_ITEMS.filter(m => m.module && m.module !== 'hrms')
const HRMS_GROUPS = MODULE_ITEMS.filter(m => m.module === 'hrms')

const ROW_BASE = 'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150'
const ROW_IDLE = 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
const ROW_ACTIVE = 'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]'

function matchPath(pathname: string, p?: string) {
  return !!p && (pathname === p || pathname.startsWith(p + '/'))
}

function ActiveBar({ show }: { show: boolean }) {
  return <span aria-hidden className={clsx('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-solid)] transition-opacity duration-150', show ? 'opacity-100' : 'opacity-0')} />
}

function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClick); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])
  return ref
}

export function PlatformShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useSdkStore(s => s.logout)
  const user = useSdkStore(s => s.user)
  // Subscribe to activeModules directly (reactive slice) instead of the
  // stable hasModule function reference — otherwise this shell won't
  // re-render when a new module activates, and the app-switcher would
  // keep showing a locked pill until an unrelated re-render triggers.
  const activeModules = useLocalAuthStore(s => s.tenant?.activeModules ?? [])
  // Workspace-uploaded logo overrides the UnifiedTree default in both the
  // shell header AND the loading fallback logo below. Rendered via the Logo
  // component further down.
  const tenantLogoUrl = useLocalAuthStore(s => s.tenant?.logoUrl)
  const tenantName    = useLocalAuthStore(s => s.tenant?.name)
  const hasModule = (k: string) => activeModules.includes(k)
  const tenant = useSdkStore(s => s.tenant)
  const permissions = useSdkStore(s => s.permissions)
  const userRoles: string[] = user?.roles ?? []
  const primaryRole = (ROLE_PRIORITY as readonly string[]).find(r => userRoles.includes(r)) ?? null

  // ⌘K global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { setProfileOpen(false); setNotifOpen(false); setMobileOpen(false); setSwitcherOpen(false); setSearchOpen(false) }, [location.pathname])

  const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']
  const isAdmin = userRoles.some(r => ADMIN_ROLES.includes(r)) || permissions.has('*')
  const subdomain = tenant?.slug ?? ''

  const openEditWorkspace = (moduleKey: string) => {
    const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'https://unifiedtree.com'
    window.open(`${websiteUrl}/edit-workspace?ws=${encodeURIComponent(subdomain)}&email=${encodeURIComponent(user?.email ?? '')}&add=${encodeURIComponent(moduleKey)}`, '_blank', 'noopener')
  }

  function isVisible(item: { visibleForRoles?: string[] }): boolean {
    if (!item.visibleForRoles || item.visibleForRoles.length === 0) return true
    if (!primaryRole) return false
    return item.visibleForRoles.includes(primaryRole)
  }

  // ─── Which app owns the current route → drives the scoped sidebar ───────────
  const scope: string = (() => {
    if (location.pathname.startsWith('/modules')) return 'launcher'
    if (PLATFORM_ITEMS.some(p => matchPath(location.pathname, p.path))) return 'admin'
    for (const m of NON_HRMS) {
      const paths = m.children ? m.children.map(c => c.path) : (m.path ? [m.path] : [])
      if (paths.some(p => matchPath(location.pathname, p))) return m.module!
    }
    return 'hrms'
  })()
  const isLauncher = scope === 'launcher'

  // Current-app label + icon (for the sidebar header)
  const appMeta: { label: string; icon: React.ReactNode } = (() => {
    if (scope === 'admin') return { label: 'Settings', icon: <Settings size={14} /> }
    if (scope === 'hrms') return { label: 'HRMS', icon: <LayoutDashboard size={14} /> }
    const m = NON_HRMS.find(x => x.module === scope)
    return { label: m?.label ?? 'App', icon: m ? React.cloneElement(m.icon as React.ReactElement, { size: 14 }) : <LayoutGrid size={14} /> }
  })()

  // Scoped navigation (only the current app's items)
  const scoped: { flat: NavItemDef[]; groups: NavItemDef[] } = (() => {
    if (scope === 'admin') return { flat: SETTINGS_NAV.filter(isVisible), groups: [] }
    if (scope === 'hrms') {
      const groups = HRMS_GROUPS.map(m => ({ ...m, children: m.children?.filter(isVisible) })).filter(m => (m.children ? m.children.length > 0 : true))
      return { flat: NAV_ITEMS.filter(isVisible), groups }
    }
    const m = NON_HRMS.find(x => x.module === scope)
    if (!m) return { flat: NAV_ITEMS.filter(isVisible), groups: HRMS_GROUPS }
    const flat: NavItemDef[] = m.children
      ? m.children.map(c => ({ key: c.path, label: c.label, icon: c.icon, path: c.path }))
      : [{ key: m.key, label: m.label, icon: m.icon, path: m.path }]
    return { flat, groups: [] }
  })()

  const [openModules, setOpenModules] = useState<string[]>(() => {
    const active = HRMS_GROUPS.find(m => m.children?.some(c => location.pathname.startsWith(c.path)))
    return active ? [active.key] : []
  })
  const toggleModule = (key: string) => setOpenModules(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const profileRef = useDismiss(profileOpen, () => setProfileOpen(false))
  const notifRef = useDismiss(notifOpen, () => setNotifOpen(false))
  const switcherRef = useDismiss(switcherOpen, () => setSwitcherOpen(false))

  const roleLabel = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : null
  const extraRoles = userRoles.filter(r => r !== primaryRole && ROLE_LABELS[r] !== undefined).length
  const roleBadgeText = roleLabel ? (extraRoles > 0 ? `${roleLabel} +${extraRoles}` : roleLabel) : null
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Account'
  const initial = (user?.firstName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  // ─── App-switcher (Odoo-style grid popover) ─────────────────────────────────
  const SWITCHER_APPS = [
    { key: 'hrms', label: 'HRMS', icon: <LayoutGrid size={17} />, home: '/dashboard', owned: hasModule('hrms') },
    ...NON_HRMS.map(m => ({ key: m.module!, label: m.label, icon: React.cloneElement(m.icon as React.ReactElement, { size: 17 }), home: m.children?.[0]?.path ?? m.path ?? '/', owned: hasModule(m.module!) })),
    ...(isAdmin ? [{ key: 'admin', label: 'Settings', icon: <Settings size={17} />, home: '/settings', owned: true }] : []),
  ]
  const openApp = (key: string, home: string, owned: boolean) => {
    setSwitcherOpen(false)
    if (owned) navigate(home)
    else if (isAdmin) openEditWorkspace(key)
  }

  const AppSwitcher = () => (
    <div className="relative" ref={switcherRef}>
      <button onClick={() => setSwitcherOpen(v => !v)} title="Switch app" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]">
        <LayoutGrid size={18} />
      </button>
      <AnimatePresence>
        {switcherOpen && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-11 z-dropdown w-[300px] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Apps</p>
              <button onClick={() => { navigate('/modules'); setSwitcherOpen(false) }} className="text-xs font-medium text-[var(--text-link)] hover:underline">Browse all</button>
            </div>
            <div className="grid grid-cols-3 gap-1 p-2">
              {SWITCHER_APPS.map(app => {
                const active = app.key === scope
                return (
                  <button key={app.key} onClick={() => openApp(app.key, app.home, app.owned)}
                    className={clsx('flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-center transition-colors', active ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-subtle)]')}>
                    <span className={clsx('relative flex h-9 w-9 items-center justify-center rounded-lg', app.owned ? 'bg-[var(--accent-bg)] text-[var(--accent-fg)]' : 'bg-[var(--bg-subtle)] text-[var(--text-tertiary)]')}>
                      {app.icon}
                      {!app.owned && <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-default)]"><Lock size={8} /></span>}
                    </span>
                    <span className={clsx('text-[11px] font-medium leading-tight', app.owned ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>{app.label}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  const Logo = () => (
    <button onClick={() => navigate('/modules')} className="flex items-center gap-2.5" title="Back to apps">
      <img
        src={tenantLogoUrl || '/UnifiedTreeLogo.png'}
        alt={tenantName || 'Unified Tree'}
        className="h-7 w-auto"
        onError={(e) => { (e.target as HTMLImageElement).src = '/UnifiedTreeLogo.png' }}
      />
    </button>
  )

  // ─── Nav renderers ──────────────────────────────────────────────────────────
  const renderFlat = (item: NavItemDef) => (
    <NavLink key={item.key} to={item.path!} end={['/dashboard', '/me', '/team', '/settings'].includes(item.path!)}
      className={({ isActive }) => clsx(ROW_BASE, isActive ? ROW_ACTIVE : ROW_IDLE, collapsed && 'mx-auto h-10 w-10 justify-center px-0')}
      title={collapsed ? item.label : undefined}>
      {({ isActive }) => (<>
        {!collapsed && <ActiveBar show={isActive} />}
        <span className={clsx('shrink-0', isActive ? 'text-[var(--accent-fg)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}>{item.icon}</span>
        {!collapsed && <span>{item.label}</span>}
      </>)}
    </NavLink>
  )

  const renderGroup = (item: NavItemDef) => {
    if (collapsed) {
      return (
        <NavLink key={item.key} to={item.children?.[0]?.path ?? '/'} title={item.label}
          className={({ isActive }) => clsx('relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors', isActive ? 'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]')}>
          {item.icon}
        </NavLink>
      )
    }
    const isOpen = openModules.includes(item.key)
    const hasActiveChild = item.children!.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/'))
    return (
      <div key={item.key}>
        <button onClick={() => toggleModule(item.key)} className={clsx(ROW_BASE, 'w-full', hasActiveChild ? 'text-[var(--text-primary)]' : ROW_IDLE)}>
          <span className={clsx('shrink-0', hasActiveChild ? 'text-[var(--accent-fg)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}>{item.icon}</span>
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronRight size={14} className={clsx('text-[var(--text-tertiary)] transition-transform duration-200', isOpen && 'rotate-90')} />
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
              <div className="ml-[22px] mb-1 mt-0.5 space-y-0.5 border-l border-[var(--border-default)] pl-3">
                {item.children!.map(child => (
                  <NavLink key={child.path + child.label} to={child.path}
                    className={({ isActive }) => clsx('group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors', isActive ? 'font-semibold text-[var(--accent-fg-strong)]' : 'font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                    {({ isActive }) => (<>
                      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full transition-colors', isActive ? 'bg-[var(--accent-solid)]' : 'bg-[var(--border-strong)] group-hover:bg-[var(--text-tertiary)]')} />
                      <span className="truncate">{child.label}</span>
                    </>)}
                  </NavLink>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  const profileMenu = (
    <>
      <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{fullName}</p>
        <p className="truncate text-xs text-[var(--text-tertiary)]">{user?.email}</p>
      </div>
      <div className="p-1.5">
        <button onClick={() => navigate('/settings')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><UserCircle2 size={16} /> My Profile</button>
        <button onClick={() => navigate('/modules')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><LayoutGrid size={16} /> All apps</button>
      </div>
      <div className="border-t border-[var(--border-subtle)] p-1.5">
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]"><LogOut size={16} /> Sign out</button>
      </div>
    </>
  )

  // ─── Sidebar ────────────────────────────────────────────────────────────────
  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className={clsx('flex h-16 shrink-0 items-center border-b border-[var(--border-subtle)]', collapsed ? 'flex-col justify-center gap-1 px-2' : 'justify-between px-4')}>
        {collapsed ? (
          <button onClick={() => navigate('/modules')} title="Back to apps" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-solid)] text-white shadow-sm"><LayoutGrid size={18} /></button>
        ) : (<><Logo /><AppSwitcher /></>)}
      </div>

      {!collapsed && (
        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-fg)]">{appMeta.icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{appMeta.label}</span>
        </div>
      )}

      <nav className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {scoped.flat.map(renderFlat)}
        {scoped.groups.length > 0 && scoped.flat.length > 0 && <div className="my-2 h-px bg-[var(--border-subtle)]" />}
        {scoped.groups.map(renderGroup)}
      </nav>

      <div className="relative border-t border-[var(--border-subtle)] p-3" ref={profileRef}>
        <AnimatePresence>
          {profileOpen && !collapsed && (
            <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-[72px] left-3 right-3 z-dropdown overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
              {profileMenu}
            </motion.div>
          )}
        </AnimatePresence>
        {collapsed ? (
          <button onClick={logout} title="Sign out" className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--status-error-bg)] hover:text-[var(--status-error-fg)]"><LogOut size={18} /></button>
        ) : (
          <button onClick={() => setProfileOpen(v => !v)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-subtle)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-sm font-semibold text-[var(--accent-fg-strong)]">{initial}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{fullName}</span>
              {roleBadgeText && <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{roleBadgeText}</span>}
            </span>
            <ChevronDown size={15} className={clsx('shrink-0 text-[var(--text-tertiary)] transition-transform', profileOpen && 'rotate-180')} />
          </button>
        )}
      </div>
    </div>
  )

  const searchModal = (
    <AnimatePresence>
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSearchOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -10 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
            <GlobalSearch onSelect={(res) => { navigate(res.path); setSearchOpen(false) }} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  // ─── Launcher mode: full-width, top bar only ────────────────────────────────
  if (isLauncher) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] font-sans text-[var(--text-primary)]">
        <header className="sticky top-0 z-sticky flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-overlay)] px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-2"><AppSwitcher /><Logo /></div>
          <div className="relative flex items-center gap-1.5" ref={profileRef}>
            {roleBadgeText && <span className="mr-1 hidden items-center rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-fg-strong)] ring-1 ring-inset ring-[var(--accent-border)] sm:inline-flex">{roleBadgeText}</span>}
            <button onClick={() => setProfileOpen(v => !v)} className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-[var(--bg-subtle)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-sm font-semibold text-[var(--accent-fg-strong)]">{initial}</span>
              <span className="hidden text-[13px] font-semibold text-[var(--text-primary)] sm:block">{fullName}</span>
              <ChevronDown size={15} className="text-[var(--text-tertiary)]" />
            </button>
            <AnimatePresence>
              {profileOpen && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }} className="absolute right-0 top-12 z-dropdown w-56 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
                  {profileMenu}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>
        <div className="flex-1 overflow-auto"><Outlet /></div>
        {searchModal}
      </div>
    )
  }

  // ─── App mode: sidebar + header + content ───────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)] font-sans text-[var(--text-primary)]">
      <aside className={clsx('relative hidden shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:block', collapsed ? 'w-[76px]' : 'w-[272px]')}>
        {sidebarContent}
        <button onClick={() => { const next = !collapsed; setCollapsed(next); localStorage.setItem(SIDEBAR_KEY, String(next)) }} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[74px] z-fixed flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] shadow-sm transition-colors hover:text-[var(--text-primary)]">
          {collapsed ? <PanelLeft size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </aside>

      <AnimatePresence>
        {mobileOpen && (<>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-modal-backdrop bg-black/40 backdrop-blur-sm md:hidden" />
          <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 26, stiffness: 240 }} className="fixed inset-y-0 left-0 z-modal w-[272px] md:hidden">{sidebarContent}</motion.aside>
        </>)}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-overlay)] px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] md:hidden" aria-label="Open menu"><Menu size={20} /></button>
            <button onClick={() => navigate('/modules')} className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] md:inline-flex" title="Back to apps"><ArrowLeft size={15} /> Apps</button>
            <div className="hidden h-5 w-px bg-[var(--border-default)] md:block" />
            <button onClick={() => setSearchOpen(true)} className="group hidden h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-left transition-colors hover:border-[var(--border-strong)] sm:flex">
              <Search size={15} className="shrink-0 text-[var(--text-tertiary)]" />
              <span className="flex-1 text-sm text-[var(--text-tertiary)]">Search {appMeta.label}…</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] lg:inline-flex"><Command size={10} /> K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {roleBadgeText && <span className="mr-1 hidden items-center rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-fg-strong)] ring-1 ring-inset ring-[var(--accent-border)] sm:inline-flex">{roleBadgeText}</span>}
            <div className="relative" ref={notifRef}>
              <button onClick={() => setNotifOpen(v => !v)} className="relative rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]" aria-label="Notifications">
                <Bell size={18} />
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--status-error-solid)] ring-2 ring-[var(--bg-surface)]" />
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.16 }} className="absolute right-0 top-12 z-dropdown w-80 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><p className="text-sm font-semibold text-[var(--text-primary)]">Notifications</p><span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">0 new</span></div>
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bg-subtle)]"><Bell size={18} className="text-[var(--text-tertiary)]" /></div>
                      <p className="text-sm font-medium text-[var(--text-secondary)]">You're all caught up</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button onClick={() => navigate('/me')} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-bg)] text-sm font-semibold text-[var(--accent-fg-strong)] sm:hidden" aria-label="Profile">{initial}</button>
          </div>
        </header>
        <div className="flex-1 overflow-auto"><Outlet /></div>
      </main>
      {searchModal}
    </div>
  )
}
