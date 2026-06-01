import React from 'react'
import { useLocation } from 'react-router-dom'
import { Search, Bell, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore } from '@/core/auth/authStore'
import { useNotificationStore } from '@/core/notifications/notificationStore'

interface HeaderProps {
  sidebarCollapsed: boolean
  onOpenCommandPalette: () => void
  onOpenNotifications: () => void
}

const BREADCRUMBS: Record<string, string> = {
  '/': 'Dashboard',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
  '/users': 'User Management',
  '/roles': 'Role Management',
  '/audit-logs': 'Audit Logs',
  '/files': 'Files',
  '/hrms/employees': 'Employees',
  '/hrms/attendance': 'Attendance',
  '/hrms/leave': 'Leave',
  '/hrms/payroll': 'Payroll',
  '/crm/leads': 'Leads',
  '/crm/customers': 'Customers',
  '/crm/deals': 'Deals',
  '/accounts/invoices': 'Invoices',
  '/accounts/payments': 'Payments',
  '/accounts/expenses': 'Expenses',
  '/projects': 'Projects',
  '/projects/board': 'Task Board',
  '/helpdesk/tickets': 'Tickets',
  '/inventory': 'Inventory',
  '/payroll': 'Payroll',
  '/procurement': 'Procurement',
}

const SEGMENT_LABELS: Record<string, string> = {
  hrms: 'HRMS',
  crm: 'CRM',
  accounts: 'Accounts',
  projects: 'Projects',
  helpdesk: 'Helpdesk',
  employees: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave',
  payroll: 'Payroll',
  leads: 'Leads',
  customers: 'Customers',
  deals: 'Deals',
  invoices: 'Invoices',
  payments: 'Payments',
  expenses: 'Expenses',
  board: 'Task Board',
  tickets: 'Tickets',
  inventory: 'Inventory',
  analytics: 'Analytics',
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles',
  files: 'Files',
}

export const Header: React.FC<HeaderProps> = ({ sidebarCollapsed, onOpenCommandPalette, onOpenNotifications }) => {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const unreadCount = useNotificationStore((s) => s.unreadCount())

  const pathParts = location.pathname.split('/').filter(Boolean)
  const breadcrumbs = pathParts.map((part, i) => {
    const path = '/' + pathParts.slice(0, i + 1).join('/')
    return { path, label: BREADCRUMBS[path] ?? SEGMENT_LABELS[part] ?? part }
  })

  return (
    <header
      className={clsx(
        'fixed right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-brand-100 bg-white/75 px-6 backdrop-blur-xl transition-all duration-300',
        sidebarCollapsed ? 'left-16' : 'left-64'
      )}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="hidden text-xs font-medium text-brand-900/55 sm:block">{tenant?.name}</span>
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={bc.path}>
            <ChevronRight size={14} className="text-brand-300" />
            <span className={i === breadcrumbs.length - 1 ? 'font-semibold text-brand-900' : 'text-brand-900/65'}>
              {bc.label}
            </span>
          </React.Fragment>
        ))}
        {breadcrumbs.length === 0 && (
          <span className="font-semibold text-brand-900">Dashboard</span>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 rounded-xl border border-brand-100 bg-white/70 px-3 py-1.5 text-xs font-medium text-brand-900/70 transition-all hover:border-brand-200 hover:bg-white"
        >
          <Search size={13} className="text-brand-600" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-1 hidden rounded bg-brand-soft px-1.5 py-0.5 text-[9px] text-brand-700 sm:inline">⌘K</kbd>
        </button>

        <button
          onClick={onOpenNotifications}
          className="relative rounded-xl p-2 text-brand-900/65 transition-colors hover:bg-brand-soft hover:text-brand-700"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-peach-500 text-[9px] font-bold text-[#0F172A]">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {user && (
          <div className="flex items-center gap-2 border-l border-brand-100 pl-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-[#0F172A] shadow-glow-brand">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-semibold text-brand-900">{user.firstName} {user.lastName}</p>
              <p className="text-[10px] text-brand-900/55">{user.role}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
