import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, Calendar, Clock, Building2, ClipboardList,
  Settings, LogOut, Menu, X, ChevronRight, ChevronDown,
  UserCircle2, ShieldAlert, FileBarChart2, FileText, Bell, Search, Hexagon,
  TrendingUp, CreditCard, Package, ShoppingCart, HelpCircle, Briefcase,
  UserCheck, Star, Receipt, DollarSign, Lock, MapPin,
} from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'

const SIDEBAR_KEY = 'ut.sidebar.collapsed'

// Priority order: used for landing redirect and role badge display
const ROLE_PRIORITY = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'EMPLOYEE'] as const
type PlatformRole = typeof ROLE_PRIORITY[number]

const ROLE_LABELS: Record<PlatformRole | string, string> = {
  SUPER_ADMIN:  'Super Admin',
  HR_MANAGER:   'HR Manager',
  FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager',
  EMPLOYEE:     'Employee',
}

interface NavChild {
  label: string
  path: string
  icon: React.ReactNode
  visibleForRoles?: string[]
}

interface NavItemDef {
  key: string
  label: string
  icon: React.ReactNode
  path?: string
  module?: string
  visibleForRoles?: string[]
  children?: NavChild[]
}

// ─── Top-level nav (above modules) ────────────────────────────────────────────
const NAV_ITEMS: NavItemDef[] = [
  {
    key: 'dashboard',
    label: 'Overview',
    icon: <LayoutDashboard size={18} />,
    path: '/dashboard',
    visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'],
  },
  {
    key: 'myworkspace',
    label: 'My Workspace',
    icon: <UserCircle2 size={18} />,
    path: '/me',
    visibleForRoles: ['EMPLOYEE'],
  },
  {
    key: 'myteam',
    label: 'My Team',
    icon: <Users size={18} />,
    path: '/team',
    visibleForRoles: ['DEPT_MANAGER'],
  },
]

// ─── Module items (subscription-gated + role-tuned) ───────────────────────────
const MODULE_ITEMS: NavItemDef[] = [
  {
    key: 'hrms',
    label: 'HRMS Core',
    icon: <Users size={18} />,
    module: 'hrms',
    children: [
      {
        label: 'Directory',
        path: '/hrms/employees',
        icon: <UserCheck size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER'],
      },
      {
        label: 'Organization',
        path: '/hrms/organization',
        icon: <Building2 size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'Attendance',
        path: '/hrms/attendance',
        icon: <Clock size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER'],
      },
      {
        label: 'My Attendance',
        path: '/hrms/attendance',
        icon: <Clock size={15} />,
        visibleForRoles: ['EMPLOYEE'],
      },
      {
        label: 'Geofencing',
        path: '/hrms/attendance/geofencing',
        icon: <MapPin size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'Leave',
        path: '/hrms/leave',
        icon: <Calendar size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER'],
      },
      {
        label: 'My Leave',
        path: '/hrms/leave',
        icon: <Calendar size={15} />,
        visibleForRoles: ['EMPLOYEE'],
      },
      {
        label: 'Onboarding',
        path: '/hrms/onboarding',
        icon: <ClipboardList size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'My Onboarding',
        path: '/hrms/onboarding/instances',
        icon: <ClipboardList size={15} />,
        visibleForRoles: ['EMPLOYEE'],
      },
      {
        label: 'Letters',
        path: '/hrms/letters/templates',
        icon: <FileText size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'Distributions',
        path: '/hrms/letters/distributions',
        icon: <FileText size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'My Letters',
        path: '/hrms/letters/generated',
        icon: <FileText size={15} />,
        visibleForRoles: ['EMPLOYEE'],
      },
      {
        label: 'My Payslips',
        path: '/me/payslips',
        icon: <Receipt size={15} />,
        visibleForRoles: ['EMPLOYEE'],
      },
      {
        label: 'Reports',
        path: '/hrms/reports',
        icon: <FileBarChart2 size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER'],
      },
      {
        label: 'Settings',
        path: '/hrms/settings',
        icon: <Settings size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER'],
      },
      {
        label: 'Payroll Settings',
        path: '/hrms/payroll/settings',
        icon: <CreditCard size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'FINANCE_LEAD'],
      },
      {
        label: 'Salary Components',
        path: '/hrms/payroll/components',
        icon: <Receipt size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'FINANCE_LEAD', 'HR_MANAGER'],
      },
      {
        label: 'Payroll Runs',
        path: '/hrms/payroll/runs',
        icon: <Receipt size={15} />,
        visibleForRoles: ['SUPER_ADMIN', 'FINANCE_LEAD', 'HR_MANAGER'],
      },
    ],
  },
  {
    key: 'crm',
    label: 'CRM',
    icon: <TrendingUp size={18} />,
    module: 'crm',
    children: [
      { label: 'Leads',     path: '/crm/leads',     icon: <Star size={15} /> },
      { label: 'Customers', path: '/crm/customers', icon: <Users size={15} /> },
      { label: 'Deals',     path: '/crm/deals',     icon: <Briefcase size={15} /> },
    ],
  },
  {
    key: 'accounts',
    label: 'Accounts',
    icon: <DollarSign size={18} />,
    module: 'accounts',
    children: [
      { label: 'Invoices', path: '/accounts/invoices', icon: <FileText size={15} /> },
      { label: 'Payments', path: '/accounts/payments', icon: <CreditCard size={15} /> },
      { label: 'Expenses', path: '/accounts/expenses', icon: <Receipt size={15} /> },
    ],
  },
  { key: 'payroll', label: 'Payroll', icon: <CreditCard size={18} />, path: '/payroll', module: 'payroll' },
  {
    key: 'projects',
    label: 'Projects',
    icon: <Package size={18} />,
    module: 'projects',
    children: [
      { label: 'All Projects', path: '/projects',       icon: <Package size={15} /> },
      { label: 'Task Board',   path: '/projects/board', icon: <ClipboardList size={15} /> },
    ],
  },
  { key: 'inventory',   label: 'Inventory',   icon: <Building2 size={18} />,    path: '/inventory',   module: 'inventory' },
  { key: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />, path: '/procurement', module: 'procurement' },
  {
    key: 'helpdesk',
    label: 'Helpdesk',
    icon: <HelpCircle size={18} />,
    module: 'helpdesk',
    children: [
      { label: 'Tickets', path: '/helpdesk/tickets', icon: <ClipboardList size={15} /> },
    ],
  },
]

// ─── Platform admin items ──────────────────────────────────────────────────────
const PLATFORM_ITEMS: NavItemDef[] = [
  { key: 'users',    label: 'Users & Access', icon: <Users size={18} />,       path: '/users',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'roles',    label: 'Roles & Perms',  icon: <ShieldAlert size={18} />, path: '/roles',      visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'audit',    label: 'Audit Logs',     icon: <Bell size={18} />,        path: '/audit-logs', visibleForRoles: ['SUPER_ADMIN'] },
  { key: 'settings', label: 'Settings',       icon: <Settings size={18} />,    path: '/settings',   visibleForRoles: ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] },
]

export function PlatformShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useSdkStore(s => s.logout)
  const user = useSdkStore(s => s.user)

  const hasModule = useLocalAuthStore(s => s.hasModule)
  const tenant = useSdkStore(s => s.tenant)
  const permissions = useSdkStore(s => s.permissions)
  const userRoles: string[] = user?.roles ?? []

  // Primary role for filtering and badge display
  const primaryRole = (ROLE_PRIORITY as readonly string[]).find(r => userRoles.includes(r)) ?? null

  // ─── Admin detection (mirrors loginWithCredentials' admin-role set + wildcard perm) ──
  // Admin = SUPER_ADMIN/COMPANY_ADMIN/HR_MANAGER role OR a wildcard ('*') permission grant.
  const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']
  const isAdmin =
    userRoles.some(r => ADMIN_ROLES.includes(r)) ||
    permissions.has('*')

  // Tenant subdomain + admin email — source for the Edit-Workspace deep link.
  const subdomain  = tenant?.slug ?? ''
  const adminEmail = user?.email ?? ''

  // Opens the main website's Edit-Workspace page (to add/buy a module) in a new tab.
  const openEditWorkspace = (moduleKey: string) => {
    const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'https://unifiedtree.com'
    window.open(
      websiteUrl + '/edit-workspace?ws=' + encodeURIComponent(subdomain) +
        '&email=' + encodeURIComponent(adminEmail) +
        '&add=' + encodeURIComponent(moduleKey),
      '_blank',
      'noopener',
    )
  }

  // Filter a nav item by visibleForRoles
  function isVisible(item: { visibleForRoles?: string[] }): boolean {
    if (!item.visibleForRoles || item.visibleForRoles.length === 0) return true
    if (!primaryRole) return false
    return item.visibleForRoles.includes(primaryRole)
  }

  // Visible top-level nav items
  const visibleNavItems = NAV_ITEMS.filter(isVisible)

  // For module items: filter children by role visibility, then decide if the group shows
  const visibleModuleItems = MODULE_ITEMS.map(m => ({
    ...m,
    children: m.children?.filter(isVisible),
  })).filter(m => {
    if (m.children) return (m.children.length > 0)
    return true
  })

  const activeModules   = visibleModuleItems.filter(m => hasModule(m.module ?? ''))
  // Locked modules are surfaced ONLY to admins. Managers/Employees see active modules only.
  const lockedModules   = isAdmin
    ? visibleModuleItems.filter(m => !hasModule(m.module ?? ''))
    : []
  const displayedLocked = lockedModules.slice(0, 2)
  const hiddenLocked    = lockedModules.slice(2)

  const visiblePlatformItems = PLATFORM_ITEMS.filter(isVisible)
  const showPlatformSection  = visiblePlatformItems.length > 0

  const [openModules, setOpenModules] = useState<string[]>(() => {
    const active = visibleModuleItems.find(m => m.children?.some(c => location.pathname.startsWith(c.path)))
    return active ? [active.key] : []
  })
  const [showLockedDropdown, setShowLockedDropdown] = useState(false)

  const toggleModule = (key: string) =>
    setOpenModules(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderModuleItem = (item: NavItemDef, active: boolean) => {
    if (collapsed) {
      return (
        <NavLink
          key={item.key}
          to={item.path ?? (item.children?.[0]?.path ?? '/')}
          className={({ isActive }) => clsx(
            'flex w-11 h-11 mx-auto items-center justify-center rounded-xl px-3 py-2.5 transition-all',
            !active && 'opacity-50 grayscale',
            isActive && active ? 'bg-[#0F6E56]/10 text-[#0F6E56]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
          )}
          title={item.label}
          onClick={e => {
            if (!active) {
              e.preventDefault()
              openEditWorkspace(item.module ?? item.key)
            }
          }}
        >
          {item.icon}
        </NavLink>
      )
    }

    if (item.children && active) {
      const isOpen = openModules.includes(item.key)
      const hasActiveChild = item.children.some(c =>
        location.pathname === c.path || location.pathname.startsWith(c.path + '/'),
      )
      return (
        <div key={item.key}>
          <button
            onClick={() => toggleModule(item.key)}
            className={clsx(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              hasActiveChild ? 'bg-slate-50 text-[#0F6E56]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            <span className={hasActiveChild ? 'text-[#0F6E56]' : 'text-slate-400'}>{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {isOpen
              ? <ChevronDown size={14} className="text-slate-400" />
              : <ChevronRight size={14} className="text-slate-400" />}
          </button>
          {isOpen && (
            <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l-2 border-slate-100 pl-3">
              {item.children.map(child => (
                <NavLink
                  key={child.path + child.label}
                  to={child.path}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                    isActive ? 'bg-[#0F6E56]/10 text-[#0F6E56] font-bold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
                  )}
                >
                  {child.icon}
                  {child.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <NavLink
        key={item.key}
        to={item.path ?? '/'}
        className={({ isActive }) => clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
          !active ? 'cursor-default text-slate-400 hover:bg-slate-50' : isActive
            ? 'bg-[#0F6E56]/10 text-[#0F6E56]'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        )}
        onClick={e => {
          if (!active) {
            e.preventDefault()
            openEditWorkspace(item.module ?? item.key)
          }
        }}
        title={collapsed ? item.label : undefined}
      >
        <span className={clsx(active ? (location.pathname === item.path ? 'text-[#0F6E56]' : 'text-slate-400') : 'text-slate-300')}>
          {item.icon}
        </span>
        {!collapsed && <span className="flex-1">{item.label}</span>}
        {!collapsed && !active && <Lock size={12} className="text-slate-300" />}
      </NavLink>
    )
  }

  // ─── Role badge ────────────────────────────────────────────────────────────
  const roleLabel    = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : null
  const extraRoles   = userRoles.filter(r => r !== primaryRole && (ROLE_LABELS[r] !== undefined)).length
  const roleBadgeText = roleLabel
    ? (extraRoles > 0 ? `${roleLabel} +${extraRoles}` : roleLabel)
    : null

  // ─── Sidebar content ───────────────────────────────────────────────────────
  const sidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200 z-30 transition-all duration-300">
      {/* Logo */}
      <div className={clsx('flex h-16 shrink-0 items-center border-b border-slate-100 transition-all', collapsed ? 'justify-center px-2' : 'justify-start px-6')}>
        <img
          src="/UnifiedTreeLogo.png"
          alt="UnifiedTree Logo"
          className={clsx('object-contain', collapsed ? 'w-8 h-8' : 'h-8 w-auto max-w-[200px]')}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-hide">

        {/* Top-level nav (Overview / My Workspace / My Team) */}
        {visibleNavItems.map(item => (
          <NavLink
            key={item.key}
            to={item.path!}
            end={item.path === '/dashboard' || item.path === '/me' || item.path === '/team'}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all group relative',
              isActive
                ? 'bg-[#0F6E56]/10 text-[#0F6E56] font-semibold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              collapsed && 'justify-center px-0 w-11 h-11 mx-auto',
            )}
            title={collapsed ? item.label : undefined}
          >
            <span className={clsx(
              location.pathname === item.path ? 'text-[#0F6E56]' : 'text-slate-400 group-hover:text-[#0F6E56] transition-colors',
            )}>
              {item.icon}
            </span>
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        {!collapsed && (
          <p className="px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
            Modules
          </p>
        )}
        {collapsed && <div className="w-8 h-px bg-slate-200 mx-auto my-4" />}

        {activeModules.map(m => renderModuleItem(m, true))}

        {lockedModules.length > 0 && !collapsed && (
          <div className="w-full h-px bg-slate-100 my-4" />
        )}

        {displayedLocked.map(m => renderModuleItem(m, false))}

        {!collapsed && hiddenLocked.length > 0 && (
          <div className="mt-1">
            <button
              onClick={() => setShowLockedDropdown(!showLockedDropdown)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all"
            >
              <div className="flex items-center gap-3">
                <Hexagon size={18} className="text-slate-400" />
                <span>Other Locked Modules</span>
              </div>
              <ChevronDown size={14} className={clsx('transition-transform text-slate-400', showLockedDropdown && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {showLockedDropdown && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-1"
                >
                  <div className="space-y-1">
                    {hiddenLocked.map(m => renderModuleItem(m, false))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {showPlatformSection && (
          <>
            {!collapsed && (
              <p className="px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                Platform Admin
              </p>
            )}
            {collapsed && <div className="w-8 h-px bg-slate-200 mx-auto my-4" />}
            {visiblePlatformItems.map(item => (
              <NavLink
                key={item.key}
                to={item.path!}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all group relative',
                  isActive
                    ? 'bg-[#0F6E56]/10 text-[#0F6E56] font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  collapsed && 'justify-center px-0 w-11 h-11 mx-auto',
                )}
                title={collapsed ? item.label : undefined}
              >
                <span className={clsx(
                  location.pathname === item.path ? 'text-[#0F6E56]' : 'text-slate-400 group-hover:text-[#0F6E56] transition-colors',
                )}>
                  {item.icon}
                </span>
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User profile + role badge + sign out */}
      <div className="border-t border-slate-100 p-4 bg-slate-50">
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl bg-white border border-slate-200 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F6E56]/10 text-sm font-bold text-[#0F6E56]">
              {(user.firstName?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {user.firstName} {user.lastName}
              </p>
              {roleBadgeText && (
                <span className="inline-block mt-0.5 rounded-full bg-[#0F6E56]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0F6E56] leading-tight">
                  {roleBadgeText}
                </span>
              )}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className={clsx(
            'flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors group',
            collapsed ? 'justify-center px-0 w-11 h-11 mx-auto' : 'px-3',
          )}
          title="Log out"
        >
          <LogOut size={18} className="text-slate-400 group-hover:text-rose-500 group-hover:scale-110 transition-all" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] font-sans selection:bg-[#0F6E56]/15 selection:text-[#0F6E56]">
      {/* Desktop Sidebar */}
      <aside
        className={clsx(
          'hidden md:block shrink-0 transition-all duration-300 relative',
          collapsed ? 'w-[80px]' : 'w-[280px]',
        )}
      >
        {sidebarContent}
        <button
          onClick={() => {
            const next = !collapsed
            setCollapsed(next)
            localStorage.setItem(SIDEBAR_KEY, String(next))
          }}
          className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 shadow-sm hover:text-slate-700 hover:border-slate-300 transition-all z-40"
        >
          <ChevronRight size={14} className={clsx('transition-transform duration-300', !collapsed && 'rotate-180')} />
        </button>
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] md:hidden"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
        {/* Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-8 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-lg md:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors w-64 focus-within:ring-2 focus-within:ring-[#0F6E56]/20 focus-within:border-[#0F6E56]/50">
              <Search size={14} className="text-slate-400" />
              <input
                type="text"
                placeholder="Search everywhere... (?K)"
                className="bg-transparent border-none outline-none text-sm w-full placeholder:text-slate-400 text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Role badge in header (visible on mobile where sidebar is hidden) */}
            {roleBadgeText && (
              <span className="hidden sm:inline-flex rounded-full bg-[#0F6E56]/10 px-2.5 py-1 text-xs font-semibold text-[#0F6E56]">
                {roleBadgeText}
              </span>
            )}
            <button className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 border-2 border-white" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto relative z-0">
          <div className="absolute inset-0 bg-[url('/grid-bg.svg')] bg-repeat opacity-[0.03] pointer-events-none" />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
