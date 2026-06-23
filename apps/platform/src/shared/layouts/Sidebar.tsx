import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import {
  LayoutDashboard, BarChart3, Users, TrendingUp, FileText, CreditCard,
  Package, ShoppingCart, Briefcase, HelpCircle, Settings, Shield, Bell,
  Folder, ChevronDown, ChevronRight, ChevronLeft, Lock, DollarSign,
  ClipboardList, Building2, UserCheck, Calendar, Star, Receipt, MapPin,
} from 'lucide-react'
import { clsx } from 'clsx'
import { P } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'

interface NavChildDef {
  label: string
  path: string
  icon: React.ReactNode
  /** Hidden unless the user holds this single permission. */
  perm?: string
  /** Hidden unless the user holds AT LEAST ONE of these permissions (mirrors the route's anyOf guard). */
  anyPerm?: string[]
}

interface NavItemDef {
  key: string
  label: string
  icon: React.ReactNode
  path?: string
  module?: string
  /** Hidden unless the user holds this single permission. */
  perm?: string
  /** Hidden unless the user holds AT LEAST ONE of these permissions (mirrors the route's anyOf guard). */
  anyPerm?: string[]
  children?: NavChildDef[]
}

const NAV_ITEMS: NavItemDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, path: '/' },
  { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} />, path: '/analytics' },
]

const MODULE_ITEMS: NavItemDef[] = [
  {
    key: 'hrms', label: 'HRMS', icon: <Users size={18} />, module: 'hrms',
    children: [
      { label: 'Employees', path: '/hrms/employees', icon: <UserCheck size={15} />, anyPerm: [P.HRMS_EMPLOYEE_READ] },
      { label: 'Attendance', path: '/hrms/attendance', icon: <Calendar size={15} />, anyPerm: [P.HRMS_ESS_READ, P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF] },
      { label: 'Geofencing', path: '/hrms/attendance/geofencing', icon: <MapPin size={15} />, anyPerm: [P.ORG_GEOFENCE_WRITE, P.ATTENDANCE_TEAM_READ] },
      { label: 'Leave', path: '/hrms/leave', icon: <ClipboardList size={15} />, anyPerm: [P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF] },
      { label: 'Payroll', path: '/hrms/payroll', icon: <CreditCard size={15} />, anyPerm: [P.PAYROLL_SETTINGS_READ, P.PAYROLL_RUNS_READ, P.PAYROLL_COMPONENTS_READ] },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: <TrendingUp size={18} />, module: 'crm',
    children: [
      { label: 'Leads', path: '/crm/leads', icon: <Star size={15} /> },
      { label: 'Customers', path: '/crm/customers', icon: <Users size={15} /> },
      { label: 'Deals', path: '/crm/deals', icon: <Briefcase size={15} /> },
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
      { label: 'All Projects', path: '/projects', icon: <Package size={15} /> },
      { label: 'Task Board', path: '/projects/board', icon: <ClipboardList size={15} /> },
    ],
  },
  { key: 'inventory',   label: 'Inventory',   icon: <Building2 size={18} />,     path: '/inventory',   module: 'inventory' },
  { key: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />,  path: '/procurement', module: 'procurement' },
  {
    key: 'helpdesk', label: 'Helpdesk', icon: <HelpCircle size={18} />, module: 'helpdesk',
    children: [
      { label: 'Tickets', path: '/helpdesk/tickets', icon: <ClipboardList size={15} /> },
    ],
  },
]

const PLATFORM_ITEMS: NavItemDef[] = [
  { key: 'users',    label: 'Users',      icon: <Users size={18} />,    path: '/users',      anyPerm: [P.WORKSPACE_USERS_READ] },
  { key: 'roles',    label: 'Roles',      icon: <Shield size={18} />,   path: '/roles',      anyPerm: [P.RBAC_ROLE_WRITE] },
  { key: 'audit',    label: 'Audit Logs', icon: <Bell size={18} />,     path: '/audit-logs', anyPerm: [P.AUDIT_READ] },
  { key: 'files',    label: 'Files',      icon: <Folder size={18} />,   path: '/files' },
  { key: 'settings', label: 'Settings',   icon: <Settings size={18} />, path: '/settings',
    anyPerm: [P.SETTINGS_READ, P.SETTINGS_HRCONFIG_WRITE, P.SETTINGS_HOLIDAYS_WRITE, P.HRMS_PROBATION_CONFIG_READ] },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation()
  const tenant   = useAuthStore((s) => s.tenant)
  const user     = useAuthStore((s) => s.user)
  const hasModule = useAuthStore((s) => s.hasModule)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const [openModules, setOpenModules] = useState<string[]>(() => {
    // Open the module corresponding to the current URL on initial load
    const activeModule = MODULE_ITEMS.find(m => m.children?.some(c => location.pathname.startsWith(c.path)))
    return activeModule ? [activeModule.key] : []
  })

  const toggleModule = (key: string) => {
    setOpenModules((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  // Menu visibility = (single perm held, if required) AND (at least one anyPerm held, if required).
  // Items with neither constraint are always visible. Mirrors the route-level anyOf guards.
  const canSee = (it: { perm?: string; anyPerm?: string[] }) =>
    (!it.perm || hasPermission(it.perm)) &&
    (!it.anyPerm || it.anyPerm.some((p) => hasPermission(p)))

  const planColors: Record<string, string> = {
    STARTER:      'bg-brand-100 text-brand-700',
    PROFESSIONAL: 'bg-brand-600 text-[#0F172A]',
    ENTERPRISE:   'bg-peach-100 text-peach-600',
  }

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 bottom-0 z-30 flex flex-col border-r border-brand-100 bg-white/85 backdrop-blur-xl transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand lockup (logo + wordmark) temporarily hidden — restore it here later.
          The header bar + plan badge are kept so layout is unchanged. */}
      <div className="flex h-16 flex-shrink-0 items-center border-b border-brand-100 px-4">
        {!collapsed && tenant && (
          <span className={clsx('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider', planColors[tenant.planType] ?? planColors.STARTER)}>
            {tenant.planType}
          </span>
        )}
      </div>

      {/* Nav */}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {/* Main */}
        {NAV_ITEMS.filter(canSee).map((item) => (
          <NavLink
            key={item.key}
            to={item.path!}
            end={item.path === '/'}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-brand-600 text-[#0F172A] shadow-glow-brand'
                : 'text-brand-900/70 hover:bg-brand-soft hover:text-brand-700'
            )}
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        {/* Modules */}
        {!collapsed && (
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700/50">
            Modules
          </p>
        )}
        {collapsed && <div className="my-2 border-t border-brand-100" />}

        {MODULE_ITEMS.map((item) => {
          const active = hasModule(item.module ?? '')
          if (collapsed) {
            return (
              <NavLink
                key={item.key}
                to={item.path ?? (item.children?.[0]?.path ?? '/')}
                className={({ isActive }) => clsx(
                  'flex w-full items-center justify-center rounded-xl px-3 py-2.5 transition-all',
                  !active && 'opacity-40',
                  isActive && active ? 'bg-brand-600 text-[#0F172A] shadow-glow-brand' : 'text-brand-900/60 hover:bg-brand-soft hover:text-brand-700'
                )}
                title={item.label}
              >
                {item.icon}
              </NavLink>
            )
          }

          if (item.children) {
            const isOpen = openModules.includes(item.key)
            // Hide permission-gated children (e.g. admin-only Geofencing) from
            // users who lack the capability — the route is also RouteGuard-ed.
            const visibleChildren = item.children.filter(canSee)
            // If the module is active but the user can see none of its pages, hide it entirely.
            if (active && visibleChildren.length === 0) return null
            const hasActiveChild = visibleChildren.some((c) => location.pathname === c.path || location.pathname.startsWith(c.path + '/'))
            return (
              <div key={item.key}>
                <button
                  onClick={() => {
                    if (active) toggleModule(item.key)
                    else toast.error('Module Locked', { description: `The ${item.label} module is not purchased for this workspace.` })
                  }}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                    !active ? 'cursor-default text-brand-900/35' : hasActiveChild ? 'bg-brand-soft text-brand-700' : 'text-brand-900/70 hover:bg-brand-soft hover:text-brand-700'
                  )}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  {!active && <Lock size={12} className="text-brand-900/30" />}
                  {active && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                </button>
                {active && isOpen && (
                  <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-brand-100 pl-3">
                    {visibleChildren.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        className={({ isActive }) => clsx(
                          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                          isActive ? 'bg-brand-100 text-brand-700' : 'text-brand-900/55 hover:bg-brand-soft hover:text-brand-700'
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
              to={item.path!}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                !active ? 'cursor-not-allowed text-brand-900/35 opacity-60' : isActive
                  ? 'bg-brand-600 text-[#0F172A] shadow-glow-brand'
                  : 'text-brand-900/70 hover:bg-brand-soft hover:text-brand-700'
              )}
              onClick={(e) => {
                if (!active) {
                  e.preventDefault()
                  toast.error('Module Locked', { description: `The ${item.label} module is not purchased for this workspace.` })
                }
              }}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && !active && <Lock size={12} className="text-brand-900/30" />}
            </NavLink>
          )
        })}

        {/* Platform */}
        {!collapsed && (
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700/50">
            Platform
          </p>
        )}
        {collapsed && <div className="my-2 border-t border-brand-100" />}
        {PLATFORM_ITEMS.filter(canSee).map((item) => (
          <NavLink
            key={item.key}
            to={item.path!}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              isActive ? 'bg-brand-600 text-[#0F172A] shadow-glow-brand' : 'text-brand-900/70 hover:bg-brand-soft hover:text-brand-700'
            )}
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>

      {/* User */}
      {!collapsed && user && (
        <div className="border-t border-brand-100 px-3 py-3">
          <div className="flex items-center gap-3 rounded-xl bg-brand-soft/70 px-3 py-2.5">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-[#0F172A]">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-brand-900">{user.firstName} {user.lastName}</p>
              <p className="truncate text-xs text-brand-900/55">{user.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-brand-100 bg-white text-brand-700 shadow-soft transition-transform hover:scale-110"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  )
}
