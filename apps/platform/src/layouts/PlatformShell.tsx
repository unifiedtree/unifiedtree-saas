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
import { useNotificationStore } from '@/core/notifications/notificationStore'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { formatDistanceToNow } from 'date-fns'
// Canonical admin-roles SSOT — do NOT redeclare locally. See useRoles.ts.
import { ADMIN_ROLES as CANONICAL_ADMIN_ROLES } from '@/shared/hooks/useRoles'

// Sidebar collapse preference is per-tenant per-user within a browser:
// without the suffix, switching workspaces on a shared laptop dragged the
// previous workspace's collapsed/expanded state across, which is
// disorienting when the sidebar geometry changes between apps. The key
// shape `sidebar-collapsed:<tenantId>:<userId>` keeps two people sharing a
// laptop from stepping on each other's preference; the legacy tenant-slug
// key is read as a one-time fallback so existing users don't lose it.
const SIDEBAR_KEY_PREFIX = 'sidebar-collapsed'
const LEGACY_SIDEBAR_KEY_PREFIX = 'ut.sidebar.collapsed'
function sidebarKey(tenantId: string | null, userId: string | null): string {
  if (tenantId && userId) return `${SIDEBAR_KEY_PREFIX}:${tenantId}:${userId}`
  return SIDEBAR_KEY_PREFIX
}

// COMPANY_ADMIN sits at rank 2 (equivalent to OWNER) — a role emitted by the
// backend for a workspace admin who is not the global super-admin. Before it
// was added here, a user whose ONLY role was COMPANY_ADMIN fell through the
// primaryRole lookup and saw an empty sidebar (isVisible returned false for
// every item that carried a visibleForRoles filter). Treat COMPANY_ADMIN as
// admin-equivalent for the sidebar's role-gate; per-route permission checks
// still enforce the finer authority names.
const ROLE_PRIORITY = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'EMPLOYEE'] as const
type PlatformRole = typeof ROLE_PRIORITY[number]
const ROLE_LABELS: Record<PlatformRole | string, string> = {
  SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin',
  HR_MANAGER: 'HR Manager', FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager', EMPLOYEE: 'Employee',
}

interface NavChild { label: string; path: string; icon: React.ReactNode; visibleForRoles?: string[] }
interface NavItemDef { key: string; label: string; icon: React.ReactNode; path?: string; module?: string; visibleForRoles?: string[]; children?: NavChild[] }

// ─── Top-level nav (the HRMS app's flat links) ────────────────────────────────
const NAV_ITEMS: NavItemDef[] = [
  // DEPT_MANAGER included: managers landed on / and the shell hid Overview,
  // so the analytics home was invisible to them even though every widget on
  // it is permission-gated and 403s cleanly for anything they can't see.
  { key: 'dashboard',   label: 'Overview',     icon: <LayoutDashboard size={18} />, path: '/dashboard', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER'] },
  { key: 'myworkspace', label: 'My Workspace', icon: <UserCircle2 size={18} />,     path: '/me',        visibleForRoles: ['EMPLOYEE'] },
  { key: 'myteam',      label: 'My Team',      icon: <Users size={18} />,           path: '/team',      visibleForRoles: ['DEPT_MANAGER'] },
]

// COMPANY_ADMIN is treated as admin-equivalent across every bundle — see the
// ROLE_PRIORITY comment above for why. Kept explicit (rather than folding into
// a single ANY_ADMIN alias) so an on-call reader can still read each bundle
// literally when triaging a "why can't this role see X" report.
// OWNER prepended to every admin bundle: an OWNER-only principal (the
// workspace creator, common on brand-new tenants where no COMPANY_ADMIN has
// been separately promoted yet) was falling through every visibleForRoles
// filter and rendering an empty sidebar. Additive — no role removed.
const R_ADMIN     = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD']
const R_ADMIN_MGR = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER']
const R_HR        = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']
// R_FIN was one bundle that included HR_MANAGER, which let HR into rupee-only
// screens (Payroll Dashboard, Salary Structure, Bank Disbursement, Payroll
// Settings). Client rule: only admin/finance see rupees. Split into two:
//   R_FIN_RUPEE — rupee screens; HR is not welcome.
//   R_FIN_META  — R_FIN_RUPEE ∪ HR_MANAGER, for meta/workflow payroll surfaces
//                 (payroll config, processing/payslips workflow, PLI) where HR
//                 needs to operate but rupee KPIs are page-gated in components.
const R_FIN_RUPEE = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'FINANCE_LEAD']
const R_FIN_META  = [...R_FIN_RUPEE, 'HR_MANAGER']
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
      // Workforce Directory restricted to HR/admin — DEPT_MANAGER should stay
      // on My Team, not open the full company directory.
      { label: 'Workforce Directory', path: '/hrms/employees',         icon: <UserCheck size={15} />,     visibleForRoles: R_HR },
      { label: 'Rules & Policies',    path: '/hrms/policies', icon: <ClipboardList size={15} />, visibleForRoles: R_HR },
      { label: 'Payroll Configuration', path: '/hrms/payroll/components', icon: <Receipt size={15} />,     visibleForRoles: R_FIN_META },
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
      // R_FIN_RUPEE: HR_MANAGER is NOT welcome on the rupee screens.
      { label: 'Payroll Dashboard',          path: '/hrms/payroll-dashboard', icon: <LayoutDashboard size={15} />, visibleForRoles: R_FIN_RUPEE },
      { label: 'Salary Structure',           path: '/hrms/salary-structure',  icon: <Receipt size={15} />,         visibleForRoles: R_FIN_RUPEE },
      // Processing & Payslips is a workflow surface — HR still runs it,
      // but rupee KPIs on the child pages defer to the useRoles guard.
      { label: 'Processing & Payslips',      path: '/hrms/payroll/runs',           icon: <Receipt size={15} />,         visibleForRoles: R_FIN_META },
      { label: 'Payroll Settings',           path: '/hrms/payroll/settings',       icon: <Settings size={15} />,        visibleForRoles: R_FIN_RUPEE },
      { label: 'Production-Linked Incentive', path: '/hrms/pli',              icon: <Target size={15} />,          visibleForRoles: R_FIN_META },
      { label: 'Advances & Loans',           path: '/hrms/advances',          icon: <Wallet size={15} />,          visibleForRoles: [...R_ADMIN_MGR, ...R_ESS] },
      { label: 'Bank Disbursement',          path: '/hrms/bank-disbursement', icon: <CreditCard size={15} />,      visibleForRoles: R_FIN_RUPEE },
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
    // Every non-muster-roll compliance sub-item routed to /hrms/compliance,
    // producing four "active" pills at once in the mobile drawer and a
    // duplicate-key React warning in the desktop rail. Trimmed to the two
    // distinct destinations that actually exist.
    children: [
      { label: 'Statutory Compliance', path: '/hrms/compliance',  icon: <ShieldAlert size={15} />, visibleForRoles: R_ADMIN },
      { label: 'Muster Roll',          path: '/hrms/muster-roll', icon: <FileText size={15} />,    visibleForRoles: R_HR },
    ],
  },
  {
    key: 'reports', label: 'Reports & Analytics', icon: <FileBarChart2 size={18} />, module: 'hrms',
    children: [
      { label: 'Reports Center',          path: '/hrms/reports',             icon: <FileBarChart2 size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_FIN_META] },
      { label: 'Workforce Analytics',     path: '/hrms/workforce-analytics', icon: <TrendingUp size={15} />,   visibleForRoles: R_ADMIN },
    ],
  },
  {
    key: 'exit', label: 'Employee Exit', icon: <LogOut size={18} />, module: 'hrms',
    children: [
      { label: 'Resignation & Exit',       path: '/hrms/fnf',  icon: <LogOut size={15} />,   visibleForRoles: R_HR },
      { label: 'Full & Final Settlement',  path: '/hrms/fnf',          icon: <Wallet size={15} />,   visibleForRoles: R_FIN_RUPEE },
    ],
  },
  {
    key: 'hrsettings', label: 'Settings', icon: <Settings size={18} />, module: 'hrms',
    children: [
      { label: 'HR Configuration',      path: '/hrms/settings',                   icon: <Settings size={15} />, visibleForRoles: R_HR },
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
  // Helpdesk was listed with a /helpdesk/tickets child but there is no
  // matching Route in App.tsx — clicking the sidebar link fell through to
  // the "*" catch-all and dumped the user on the launcher. Dropped from the
  // sidebar + app-switcher until the module + routes are actually wired.
]

// ─── Platform admin items (the "Settings" app) ────────────────────────────────
const PLATFORM_ITEMS: NavItemDef[] = [
  { key: 'users',    label: 'Users & Access', icon: <Users size={18} />,       path: '/users',      visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'roles',    label: 'Roles & Perms',  icon: <ShieldAlert size={18} />, path: '/roles',      visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'audit',    label: 'Audit Logs',     icon: <FileText size={18} />,    path: '/audit-logs', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'settings', label: 'Configuration',  icon: <Settings size={18} />,    path: '/settings',   visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] },
]

// ─── Workspace Settings nav (the "Settings" app — workspace-level, NOT a module) ──
// Account + Workspace sections everyone with settings access sees; Administration
// is super-admin only. Each maps to a route the shell drives.
const SETTINGS_NAV: NavItemDef[] = [
  { key: 's-profile',       label: 'Profile',             icon: <UserCircle2 size={18} />,  path: '/profile' },
  { key: 's-branding',      label: 'Branding',            icon: <ImageIcon size={18} />,     path: '/settings/branding',      visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-security',      label: 'Security',            icon: <Shield size={18} />,        path: '/settings/security' },
  // Notifications is deliberately open — every role can manage their OWN
  // notification preferences, so no visibleForRoles filter here.
  { key: 's-notifications', label: 'Notifications',       icon: <Bell size={18} />,          path: '/settings/notifications' },
  // Billing was previously visible to every role — a plain EMPLOYEE would see
  // a "Billing & Plan" pill they had no authority to open. Restrict to the
  // admins the backend actually lets manage billing.
  { key: 's-billing',       label: 'Billing & Plan',      icon: <CreditCard size={18} />,    path: '/settings/billing',       visibleForRoles: ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN'] },
  { key: 's-integrations',  label: 'Integrations',        icon: <Plug size={18} />,          path: '/settings/integrations' },
  { key: 's-users',         label: 'Users & Access',      icon: <Users size={18} />,         path: '/users',      visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-roles',         label: 'Roles & Permissions', icon: <ShieldAlert size={18} />,   path: '/roles',      visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-audit',         label: 'Audit Logs',          icon: <FileText size={18} />,      path: '/audit-logs', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  // Danger Zone is destructive tenant surgery — only SUPER_ADMIN and OWNER
  // (workspace owner) are allowed near it, never a HR/FIN admin.
  { key: 's-danger',        label: 'Danger Zone',         icon: <AlertTriangle size={18} />, path: '/settings/danger',        visibleForRoles: ['SUPER_ADMIN', 'OWNER'] },
]

// Non-HRMS modules become their own apps in the launcher / switcher.
const NON_HRMS = MODULE_ITEMS.filter(m => m.module && m.module !== 'hrms')
const HRMS_GROUPS = MODULE_ITEMS.filter(m => m.module === 'hrms')

const ROW_BASE = 'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150'
const ROW_IDLE = 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
const ROW_ACTIVE = 'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]'

/** One-word labels for the Keka-style icon rail — the full names don't fit
 *  under an icon. Falls back to the first word of the nav label. */
const RAIL_LABELS: Record<string, string> = {
  dashboard: 'Home', myworkspace: 'Me', myteam: 'Team',
  company: 'Company', master: 'Master', attendance: 'Time', leave: 'Leave',
  recruit: 'Hire', 'payroll-hr': 'Payroll', expense: 'Expense', ess: 'Me',
  performance: 'Perform', compliance: 'Comply', reports: 'Reports', exit: 'Exit',
  hrsettings: 'Settings',
  's-profile': 'Profile', 's-branding': 'Brand', 's-security': 'Security',
  's-notifications': 'Alerts', 's-billing': 'Billing', 's-integrations': 'Connect',
  's-users': 'Users', 's-roles': 'Roles', 's-audit': 'Audit', 's-danger': 'Danger',
}

/**
 * Chrome grounds — BRAND chrome (client-approved): blackish-green rail
 * (180deg #04503A → #043B2C → #02291E) + app-green header (90deg #047857 →
 * #058360 → #059669, joining the rail's top tone at the corner). Active states
 * are Keka-style: a lighter white-tint block on the rail, a white pill in the
 * header tab row. The #059669 stop sits at 75% so the lightest tone only ever
 * lives under the right-side icon cluster — white TEXT (tabs/label, left side)
 * always sits on ≤ #058360, which keeps it ≥ 4.5:1 (white on full #059669 is
 * only 3.77:1, fine for icons at 3:1 but not for text).
 *
 * There is deliberately no logo in this chrome. A workspace logo is whatever
 * shape the customer uploaded, and nothing fits a ~96px rail cell — it needed a
 * white chip to be legible at all, which is what made it look stuck on. The
 * rail's identity tile renders the workspace INITIAL on a white/95 tile with
 * the workspace name in tiny white text under it instead: always legible, never
 * distorted, and it doubles as the way back to the launcher (/modules).
 */
const RAIL_BG = 'linear-gradient(180deg,#04503A 0%,#043B2C 55%,#02291E 100%)'
const HEADER_BG = 'linear-gradient(90deg,#047857 0%,#058360 75%,#059669 100%)'

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
  // Read tenant+user ids synchronously so the collapse preference we look up
  // matches the workspace/user about to render. Falls back to the legacy
  // tenant-slug key and the fully-unscoped key for one-time migration paths.
  const initialAuthSnapshot = useSdkStore.getState()
  const initialTenantId = initialAuthSnapshot.tenant?.id ?? null
  const initialUserId = initialAuthSnapshot.user?.id ?? null
  const initialTenantSlug = initialAuthSnapshot.tenant?.slug ?? null
  const [collapsed, setCollapsed] = useState(() => {
    const scoped = localStorage.getItem(sidebarKey(initialTenantId, initialUserId))
    if (scoped != null) return scoped === 'true'
    // Legacy tenant-slug key — populated by an earlier revision.
    if (initialTenantSlug) {
      const legacyScoped = localStorage.getItem(`${LEGACY_SIDEBAR_KEY_PREFIX}:${initialTenantSlug}`)
      if (legacyScoped != null) return legacyScoped === 'true'
    }
    // Fully-unscoped legacy value from the very first revision.
    return localStorage.getItem(LEGACY_SIDEBAR_KEY_PREFIX) === 'true'
  })
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
  // The shell chrome carries no logo — the workspace NAME is the identity here,
  // because an uploaded logo is whatever shape the customer gave us and none of
  // them survive an 86px rail cell. tenantName comes from the auth store, which
  // is populated at login. The uploaded logo still appears where it has room
  // and belongs: the login page and Settings > Branding.
  const tenantName    = useLocalAuthStore(s => s.tenant?.name)
  const hasModule = (k: string) => activeModules.includes(k)
  const tenant = useSdkStore(s => s.tenant)
  const permissions = useSdkStore(s => s.permissions)
  const userRoles: string[] = user?.roles ?? []
  const primaryRole = (ROLE_PRIORITY as readonly string[]).find(r => userRoles.includes(r)) ?? null

  // Toggle handler for the sidebar collapse button. Writes the new state
  // to the per-tenant per-user localStorage key so the preference survives
  // a reload — the previous rework read the key on mount but never wrote
  // back, so users could not manually collapse at all.
  const collapseKey = sidebarKey(tenant?.id ?? null, user?.id ?? null)
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(collapseKey, String(next)) } catch { /* private mode / quota — ignore */ }
      return next
    })
  }, [collapseKey])

  // If the signed-in tenant or user changes while the shell is mounted
  // (e.g. the user re-hydrates from cold cache after AuthProvider loads),
  // re-read the collapse preference under the correct key.
  useEffect(() => {
    if (!tenant?.id || !user?.id) return
    const stored = localStorage.getItem(sidebarKey(tenant.id, user.id))
    if (stored != null) setCollapsed(stored === 'true')
  }, [tenant?.id, user?.id])

  // ⌘K global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { setProfileOpen(false); setNotifOpen(false); setMobileOpen(false); setSwitcherOpen(false); setSearchOpen(false) }, [location.pathname])

  // Canonical ADMIN_ROLES from useRoles. The previous local list dropped
  // OWNER + ADMIN and pulled HR_MANAGER in, so an OWNER-only principal was
  // treated as non-admin (no Settings tile, blocked from admin fallbacks)
  // while an HR_MANAGER got admin-only affordances they weren't meant to see.
  const isAdmin = userRoles.some(r => (CANONICAL_ADMIN_ROLES as readonly string[]).includes(r)) || permissions.has('*')
  const subdomain = tenant?.slug ?? ''

  const openEditWorkspace = (moduleKey: string) => {
    const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'https://unifiedtree.com'
    window.open(`${websiteUrl}/edit-workspace?ws=${encodeURIComponent(subdomain)}&email=${encodeURIComponent(user?.email ?? '')}&add=${encodeURIComponent(moduleKey)}`, '_blank', 'noopener')
  }

  // UNION check against every role the JWT carries — the earlier version
  // gated on `primaryRole` alone, which HID Employee Self Service from an
  // HR_MANAGER/admin who was ALSO an employee (their higher-priority role
  // won primaryRole, and the ESS rows only listed 'EMPLOYEE'). Every role
  // the user holds should get to reveal every menu it grants.
  function isVisible(item: { visibleForRoles?: string[] }): boolean {
    if (!item.visibleForRoles || item.visibleForRoles.length === 0) return true
    if (!userRoles.length) return false
    return item.visibleForRoles.some((r) => userRoles.includes(r))
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
  const headerProfileRef = useDismiss(profileOpen, () => setProfileOpen(false))
  const notifRef = useDismiss(notifOpen, () => setNotifOpen(false))
  const switcherRef = useDismiss(switcherOpen, () => setSwitcherOpen(false))

  // ─── Icon-rail model: top-level sections only ───────────────────────────────
  // Groups collapse to a single icon; their children become the in-page tab row
  // below the top bar (subTabs) instead of nesting in the sidebar.
  interface RailItem { key: string; label: string; fullLabel: string; icon: React.ReactNode; target: string; active: boolean; children?: NavChild[] }
  const railItems: RailItem[] = (() => {
    const list: RailItem[] = []
    for (const f of scoped.flat) {
      if (!f.path) continue
      list.push({
        key: f.key,
        label: RAIL_LABELS[f.key] ?? f.label.split(' ')[0],
        fullLabel: f.label,
        icon: f.icon,
        target: f.path,
        active: matchPath(location.pathname, f.path),
      })
    }
    for (const g of scoped.groups) {
      const kids = (g.children ?? []).filter(isVisible)
      if (!kids.length) continue
      list.push({
        key: g.key,
        label: RAIL_LABELS[g.key] ?? g.label.split(' ')[0],
        fullLabel: g.label,
        icon: g.icon,
        target: kids[0].path,
        active: kids.some(c => matchPath(location.pathname, c.path)),
        children: kids,
      })
    }
    return list
  })()

  // Several nav children intentionally share a route (e.g. the compliance
  // views all land on /hrms/compliance) — dedupe by path or every duplicate
  // tab would render "active" at once.
  const subTabs: NavChild[] | null = (() => {
    const active = railItems.find(i => i.active && i.children && i.children.length > 0)
    if (!active?.children) return null
    const seen = new Set<string>()
    const tabs = active.children.filter(c => { if (seen.has(c.path)) return false; seen.add(c.path); return true })
    return tabs.length > 1 ? tabs : null
  })()

  const roleLabel = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : null
  const extraRoles = userRoles.filter(r => r !== primaryRole && ROLE_LABELS[r] !== undefined).length
  const roleBadgeText = roleLabel ? (extraRoles > 0 ? `${roleLabel} +${extraRoles}` : roleLabel) : null
  // Centralised name resolution — every place in the shell that renders the
  // signed-in user's name or avatar tile now reads from the same hook so the
  // sidebar chip, the profile menu header and the top-bar avatar can never
  // disagree during hydration. See useDisplayName for the fallback chain.
  const { fullName, initials } = useDisplayName()

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

  /* The drawer's identity, same rule as the desktop chrome: the workspace name,
     not a logo. Doubles as the way back to the launcher. */
  const WorkspaceMark = () => (
    <button
      onClick={() => navigate('/modules')}
      className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-[var(--bg-subtle)]"
      title="Back to apps"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-solid)] text-white">
        <LayoutGrid size={15} />
      </span>
      <span className="min-w-0 truncate text-[14.5px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">
        {tenantName || 'Workspace'}
      </span>
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
                  <NavLink key={child.path + child.label} to={child.path} end
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
        <button onClick={() => navigate('/profile')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><UserCircle2 size={16} /> My Profile</button>
        <button onClick={() => navigate('/modules')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><LayoutGrid size={16} /> My Apps</button>
        {isAdmin && (
          <button onClick={() => navigate('/settings')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><Settings size={16} /> Settings</button>
        )}
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
          <>
            <button onClick={() => navigate('/modules')} title="Back to apps" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-solid)] text-white shadow-sm"><LayoutGrid size={18} /></button>
            <button onClick={toggleCollapsed} title="Expand sidebar" aria-label="Expand sidebar" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><PanelLeft size={14} /></button>
          </>
        ) : (
          <>
            <WorkspaceMark />
            <div className="flex items-center gap-1">
              <AppSwitcher />
              <button onClick={toggleCollapsed} title="Collapse sidebar" aria-label="Collapse sidebar" className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><PanelLeftClose size={16} /></button>
            </div>
          </>
        )}
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-sm font-semibold text-[var(--accent-fg-strong)]">{initials}</span>
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

  // ─── Launcher mode: header floats transparent over the page's gradient ─────
  // No bar background, no border — the launcher page paints the emerald field
  // and this header sits on it in white, so the whole screen reads as one.
  if (isLauncher) {
    return (
      <div className="relative flex h-screen flex-col overflow-hidden font-sans text-[var(--text-primary)]">
        <header className="absolute inset-x-0 top-0 z-sticky flex h-16 shrink-0 items-center justify-between gap-4 px-4 sm:px-6">
          {/* Nothing top-left on the launcher — the page IS the brand moment.
              The logo chip and the role badge were both removed at the client's
              request; the spacer keeps the avatar pinned right. */}
          <span aria-hidden />
          <div className="relative flex items-center gap-1.5" ref={profileRef}>
            <button onClick={() => setProfileOpen(v => !v)} className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-white/10">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-sm font-bold text-[#047857] shadow-sm">{initials}</span>
              <span className="hidden text-[13px] font-semibold text-white sm:block">{fullName}</span>
              <ChevronDown size={15} className="text-white/70" />
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

  // ─── App mode: dark-green icon rail + green header w/ in-header sub-tabs ────
  //
  // The sidebar carries ONLY top-level sections (icon over a tiny label); a
  // section's sub-options render as pills in the header's LEFT side, so the
  // rail never expands. Active rail item = Keka-style lighter block
  // (rounded-xl, bg-white/[0.14], white icon+label); everything else white/60.
  const workspaceInitial = (tenantName?.trim()?.[0] ?? 'W').toUpperCase()
  const activeRailItem = railItems.find(i => i.active)
  const sectionLabel = activeRailItem?.fullLabel ?? appMeta.label
  // Settings pins to the rail's bottom the way the reference pins Help/Settings.
  // Pure rendering split — railItems derivation above is untouched.
  const pinnedRail = railItems.filter(i => i.key === 'hrsettings')
  const mainRail = railItems.filter(i => i.key !== 'hrsettings')

  const renderRailItem = (item: (typeof railItems)[number]) => (
    <button
      key={item.key}
      onClick={() => navigate(item.target)}
      title={item.fullLabel}
      className={clsx(
        'flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 transition-colors duration-150',
        item.active
          ? 'bg-white/[0.14] text-white'
          : 'text-white/60 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      <span>{item.icon}</span>
      {/* Interim collapsed variant: when the user has toggled the sidebar
          collapsed we hide the tiny one-word label under each icon so the
          rail visually reads as pure-icon. A full redesign of the rail's
          collapsed geometry is deferred (see platform-objections). The
          tooltip on the parent button still surfaces the full section name
          for screen-reader and mouse hover users. */}
      {!collapsed && (
        <span className="text-[10px] font-semibold leading-none tracking-tight">{item.label}</span>
      )}
    </button>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)] font-sans text-[var(--text-primary)]">
      {/* Icon rail — blackish-green gradient, fixed width, its own scroll.
          No hairline border: the dark ground separates itself from the page. */}
      <aside className="relative z-10 hidden w-[96px] shrink-0 flex-col md:flex" style={{ background: RAIL_BG }}>
        {/* Identity tile — workspace initial + name (no logo by design; see the
            chrome comment above). Click = back to the launcher. Replaces both
            the old grid-icon launcher button and the header workspace name. */}
        <div className="shrink-0 px-2.5 pb-1 pt-3">
          <button
            onClick={() => navigate('/modules')}
            title="All apps"
            aria-label="All apps"
            className="flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 transition-colors hover:bg-white/10"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/95 text-[15px] font-bold text-[#047857] shadow-sm">
              {workspaceInitial}
            </span>
            {/* Hidden in the collapsed rail — see renderRailItem's comment. */}
            {!collapsed && (
              <span className="w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight text-white">
                {tenantName || 'Workspace'}
              </span>
            )}
          </button>
        </div>
        <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-2.5 pb-2 pt-2">
          {mainRail.map(renderRailItem)}
        </nav>
        {pinnedRail.length > 0 && (
          <div className="shrink-0 space-y-1 px-2.5 pb-3 pt-1">
            {pinnedRail.map(renderRailItem)}
          </div>
        )}
      </aside>

      {/* Mobile drawer keeps the fuller grouped list — small screens need labels */}
      <AnimatePresence>
        {mobileOpen && (<>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-modal-backdrop bg-black/40 backdrop-blur-sm md:hidden" />
          <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 26, stiffness: 240 }} className="fixed inset-y-0 left-0 z-modal w-[272px] md:hidden">{sidebarContent}</motion.aside>
        </>)}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — solid app green (gradient joins the rail's top tone at the
            corner), no bottom hairline. The current section's sub-tabs live
            HERE (left side); when the section has no children its name shows
            as a static white label instead. */}
        <header className="z-sticky flex h-[72px] shrink-0 items-center gap-3 px-4 sm:px-6" style={{ background: HEADER_BG }}>
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-2 text-white/85 transition-colors hover:bg-white/10 hover:text-white md:hidden" aria-label="Open menu"><Menu size={20} /></button>

          {/* Sub-sections of the current module as horizontal pills. pr-4 keeps
              a clipped tab from butting against the search pill when the row
              scrolls at narrow widths. */}
          <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-4">
            {subTabs ? (
              subTabs.map(tab => (
                <NavLink
                  key={tab.path + tab.label}
                  to={tab.path}
                  // `end` avoids the prefix-collision where a shorter parent
                  // path (e.g. /hrms/attendance) would render "active" at the
                  // same time as its child (/hrms/attendance/geofencing).
                  // Sub-tabs are always leaf routes for this shell.
                  end
                  className={({ isActive }) => clsx(
                    'shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] transition-colors',
                    isActive
                      ? 'bg-white/95 font-semibold text-[#047857] shadow-sm'
                      : 'font-medium text-white/70 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {tab.label}
                </NavLink>
              ))
            ) : (
              <span className="truncate text-[15px] font-semibold text-white">{sectionLabel}</span>
            )}
          </div>

          {/* Role badge removed at the client's request — the role still shows
              inside the profile menu, where it belongs. */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* White rounded-full search pill w/ command chip (reference style) */}
            <button onClick={() => setSearchOpen(true)} className="hidden h-9 w-52 items-center gap-2.5 rounded-full bg-white/95 px-3.5 text-left shadow-sm transition-colors hover:bg-white sm:flex lg:w-64">
              <Search size={15} className="shrink-0 text-[var(--text-tertiary)]" />
              <span className="flex-1 truncate text-[13px] text-[var(--text-tertiary)]">Search {appMeta.label}…</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] lg:inline-flex"><Command size={10} /> K</kbd>
            </button>
            <button onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-white/85 transition-colors hover:bg-white/10 hover:text-white sm:hidden" aria-label="Search"><Search size={18} /></button>
            <div className="relative" ref={notifRef}>
              <ShellNotificationBell open={notifOpen} onToggle={() => setNotifOpen(v => !v)} onNavigate={(to) => { setNotifOpen(false); navigate(to) }} />
            </div>
            {/* Avatar + chevron → profile menu (My Profile / My Apps / Settings / Sign out) */}
            <div className="relative" ref={headerProfileRef}>
              <button onClick={() => setProfileOpen(v => !v)} className="flex h-10 items-center gap-1.5 rounded-lg pl-1 pr-1.5 transition-colors hover:bg-white/10" aria-label="Account">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sm font-bold text-[#047857] shadow-sm">{initials}</span>
                <ChevronDown size={15} className={clsx('text-white/80 transition-transform', profileOpen && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {profileOpen && (
                  <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }} className="absolute right-0 top-12 z-dropdown w-56 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
                    {profileMenu}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Content ground — light grey so the white cards read against it */}
        <div className="flex-1 overflow-auto bg-[var(--bg-base)]"><Outlet /></div>
      </main>
      {searchModal}
    </div>
  )
}

/**
 * Notification bell rendered in the top bar of {@link PlatformShell}.
 *
 * <p>Was previously a hard-coded "0 new / You're all caught up" popup with an
 * always-on orange dot — the store-backed {@code NotificationPanel.tsx} was
 * never mounted here, so the fix that wired the store to real
 * {@code /v1/notifications} traffic never reached the user. This inline
 * component reads the same {@link useNotificationStore} the header badge
 * reads, so the dot, the count pill and the list are guaranteed to agree.
 */
function ShellNotificationBell({
  open,
  onToggle,
  onNavigate,
}: {
  open: boolean
  onToggle: () => void
  onNavigate: (to: string) => void
}) {
  const notifications = useNotificationStore((s) => s.notifications)
  const loading = useNotificationStore((s) => s.loading)
  const loaded = useNotificationStore((s) => s.loaded)
  const markAsRead = useNotificationStore((s) => s.markAsRead)
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead)
  const unreadCount = useNotificationStore((s) => s.unreadCount())

  // Cap the popup at 8 to keep the surface tight — the panel's own footer
  // links to a fuller view once we have one.
  const items = notifications.slice(0, 8)

  return (
    <>
      <button
        onClick={onToggle}
        className="relative rounded-lg p-2 text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {/* Dot is now truthful — only visible when there is at least one
            unread notification. Ringed with the header's green so it pops. */}
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#F97316] ring-2 ring-[#059669]" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-12 z-dropdown w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Notifications</p>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">
                  {unreadCount} new
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllAsRead()}
                    className="text-[11px] font-semibold text-[#047857] hover:text-[#053B2E]"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bg-subtle)]">
                  <Bell size={18} className="text-[var(--text-tertiary)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  {loading && !loaded ? 'Loading…' : "You're all caught up"}
                </p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {items.map((n) => {
                  const tone =
                    n.type === 'error'
                      ? 'bg-red-500/10 text-red-500'
                      : n.type === 'warning'
                      ? 'bg-amber-500/10 text-amber-600'
                      : n.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600'
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        markAsRead(n.id)
                        if (n.link) onNavigate(n.link)
                      }}
                      className={clsx(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                        !n.isRead ? 'bg-[#ECFDF5] hover:bg-[#D1FAE5]' : 'hover:bg-[var(--bg-subtle)]',
                      )}
                    >
                      <span
                        className={clsx(
                          'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                          tone,
                        )}
                      >
                        <Bell size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={clsx(
                            'block truncate text-sm font-medium',
                            !n.isRead ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                          )}
                        >
                          {n.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--text-secondary)] line-clamp-2">
                          {n.message}
                        </span>
                        <span className="mt-1 block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
