import {
  Users, Clock, CreditCard, DollarSign, Package, TrendingUp,
  ShoppingCart, BarChart3, Briefcase, Factory, Store, FileBarChart2,
  Settings, type LucideIcon,
} from 'lucide-react'

/**
 * Single source of truth for the "apps" a workspace can run — the Odoo-style
 * launcher grid, the sidebar app-switcher, and the shell's per-app scoping all
 * read from here. Only HRMS (and its attendance/payroll surfaces) is built
 * today; the rest are sellable modules that render a Coming-soon state once
 * owned, or an upsell when not owned.
 */

export interface AppDef {
  key: string          // module key used with hasModule()/activeModules
  label: string
  description: string
  icon: LucideIcon
  home: string         // route to enter when the app is opened
  match: string[]      // path prefixes that belong to this app (for scoping)
  built: boolean       // has a real in-app experience today
}

export const APPS: AppDef[] = [
  { key: 'hrms',          label: 'HRMS',          description: 'Employees, org, onboarding, letters & reports.', icon: Users,         home: '/dashboard',              match: ['/dashboard', '/hrms', '/me', '/team'], built: true },
  { key: 'attendance',    label: 'Attendance',    description: 'Punch in/out, geofencing, shifts & timesheets.', icon: Clock,         home: '/hrms/attendance',        match: [],                                      built: true },
  { key: 'payroll',       label: 'Payroll',       description: 'Salary structures, pay runs & payslips.',        icon: CreditCard,    home: '/hrms/payroll-dashboard', match: [],                                      built: true },
  { key: 'crm',           label: 'CRM',           description: 'Leads, customers, deals & pipeline.',            icon: TrendingUp,    home: '/crm',                    match: ['/crm'],                                built: false },
  { key: 'accounting',    label: 'Accounts',      description: 'Ledgers, invoices, payments & expenses.',        icon: DollarSign,    home: '/accounts',               match: ['/accounts', '/accounting'],            built: false },
  { key: 'projects',      label: 'Projects',      description: 'Projects, tasks & team boards.',                 icon: Briefcase,     home: '/projects',               match: ['/projects'],                           built: false },
  { key: 'inventory',     label: 'Inventory',     description: 'Stock, warehouses & item movements.',           icon: Package,       home: '/inventory',              match: ['/inventory'],                          built: false },
  { key: 'purchase',      label: 'Purchase',      description: 'Purchase orders, vendors & procurement.',        icon: ShoppingCart,  home: '/procurement',            match: ['/procurement', '/purchase'],           built: false },
  { key: 'sales',         label: 'Sales',         description: 'Quotes, sales orders & fulfilment.',             icon: BarChart3,     home: '/sales',                  match: ['/sales'],                              built: false },
  { key: 'manufacturing', label: 'Manufacturing', description: 'BOMs, work orders & production planning.',       icon: Factory,       home: '/manufacturing',          match: ['/manufacturing'],                      built: false },
  { key: 'pos',           label: 'POS',           description: 'Point of sale, registers & receipts.',           icon: Store,         home: '/pos',                    match: ['/pos'],                                built: false },
  { key: 'reports',       label: 'Reports',       description: 'Cross-module analytics & dashboards.',           icon: FileBarChart2, home: '/reports',                match: ['/reports'],                            built: false },
]

// The system "app" (not a purchasable module) — settings & platform admin.
export const ADMIN_APP: AppDef = {
  key: 'admin',
  label: 'Settings',
  description: 'Users, roles, audit logs & configuration.',
  icon: Settings,
  home: '/settings',
  match: ['/settings', '/users', '/roles', '/audit-logs'],
  built: true,
}

export type AppScope = 'hrms' | 'admin' | 'launcher' | string

/** Which app "owns" the current route — drives the scoped sidebar. */
export function resolveScope(pathname: string): AppScope {
  if (pathname.startsWith('/modules')) return 'launcher'
  if (ADMIN_APP.match.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'admin'
  const hrms = APPS.find(a => a.key === 'hrms')!
  if (hrms.match.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'hrms'
  const other = APPS.find(a => a.match.length > 0 && a.match.some(p => pathname === p || pathname.startsWith(p + '/')))
  return other?.key ?? 'hrms'
}

export function appByKey(key: string): AppDef | undefined {
  return APPS.find(a => a.key === key)
}
