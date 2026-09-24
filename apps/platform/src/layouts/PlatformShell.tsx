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
  LayoutGrid, ArrowLeft, Command,
  Image as ImageIcon, Banknote, UserPlus} from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'
import { GlobalSearch, type SearchPage } from '@/shared/components/GlobalSearch'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { formatDistanceToNow } from 'date-fns'
// Canonical admin-roles SSOT — do NOT redeclare locally. See useRoles.ts.
import { ADMIN_ROLES as CANONICAL_ADMIN_ROLES } from '@/shared/hooks/useRoles'

// The sidebar/rail collapse preference was removed (2026-08-22). It reclaimed
// no space — the desktop rail is a fixed w-[96px] and the mobile drawer a fixed
// w-[272px], neither of which resized when collapsed — so all it did was strip
// the nav labels. Worse, its only toggle lived inside `sidebarContent`, which
// renders solely in the md:hidden mobile drawer, so a desktop user carrying
// `collapsed:true` in localStorage had no way to turn the labels back on.
// Labels now always render; stale `sidebar-collapsed:*` keys are ignored,
// which self-heals every browser that had one set.

// COMPANY_ADMIN sits at rank 2 (equivalent to OWNER) — a role emitted by the
// backend for a workspace admin who is not the global super-admin. Before it
// was added here, a user whose ONLY role was COMPANY_ADMIN fell through the
// primaryRole lookup and saw an empty sidebar (isVisible returned false for
// every item that carried a visibleForRoles filter). Treat COMPANY_ADMIN as
// admin-equivalent for the sidebar's role-gate; per-route permission checks
// still enforce the finer authority names.
const ROLE_PRIORITY = ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'MANAGER', 'EMPLOYEE'] as const
type PlatformRole = typeof ROLE_PRIORITY[number]
const ROLE_LABELS: Record<PlatformRole | string, string> = {
  SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin',
  OWNER: 'Company Owner', ADMIN: 'Company Admin', MANAGER: 'Manager',
  HR_MANAGER: 'HR Manager', FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager', EMPLOYEE: 'Employee',
}

interface NavChild { label: string; path: string; icon: React.ReactNode; visibleForRoles?: string[]; visibleWithAnyPermission?: string[] }
interface NavItemDef { key: string; label: string; icon: React.ReactNode; path?: string; module?: string; visibleForRoles?: string[]; children?: NavChild[] }

// ─── Top-level nav (the HRMS app's flat links) ────────────────────────────────
const NAV_ITEMS: NavItemDef[] = [
  // DEPT_MANAGER included: managers landed on / and the shell hid Overview,
  // so the analytics home was invisible to them even though every widget on
  // it is permission-gated and 403s cleanly for anything they can't see.
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, path: '/dashboard', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER'] },
  { key: 'myworkspace', label: 'My Workspace', icon: <UserCircle2 size={18} />, path: '/me', visibleForRoles: ['EMPLOYEE'] },
  { key: 'myteam', label: 'My Team', icon: <Users size={18} />, path: '/team', visibleForRoles: ['DEPT_MANAGER'] },
]

// COMPANY_ADMIN is treated as admin-equivalent across every bundle — see the
// ROLE_PRIORITY comment above for why. Kept explicit (rather than folding into
// a single ANY_ADMIN alias) so an on-call reader can still read each bundle
// literally when triaging a "why can't this role see X" report.
// OWNER prepended to every admin bundle: an OWNER-only principal (the
// workspace creator, common on brand-new tenants where no COMPANY_ADMIN has
// been separately promoted yet) was falling through every visibleForRoles
// filter and rendering an empty sidebar. Additive — no role removed.
const R_ADMIN = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD']
const R_ADMIN_MGR = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER']
const R_HR = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']
// R_FIN was one bundle that included HR_MANAGER, which let HR into rupee-only
// screens (Payroll Dashboard, Salary Structure, Bank Disbursement, Payroll
// Settings). Client rule: only admin/finance see rupees. Split into two:
//   R_FIN_RUPEE — rupee screens; HR is not welcome.
//   R_FIN_META  — R_FIN_RUPEE ∪ HR_MANAGER, for meta/workflow payroll surfaces
//                 (payroll config, processing/payslips workflow, PLI) where HR
//                 needs to operate but rupee KPIs are page-gated in components.
const R_FIN_RUPEE = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'FINANCE_LEAD']
const R_FIN_META = [...R_FIN_RUPEE, 'HR_MANAGER']
const R_ESS = ['EMPLOYEE']

// ─── Module items: HRMS nav groups (module 'hrms') + the sellable modules. ─────
const MODULE_ITEMS: NavItemDef[] = [
  {
    key: 'company', label: 'Company Profile', icon: <Building2 size={18} />, module: 'hrms',
    children: [
      { label: 'Companies & Branches', path: '/hrms/companies', icon: <Building2 size={15} />, visibleForRoles: R_HR },
    ],
  },
  {
    key: 'master', label: 'Master', icon: <Database size={18} />, module: 'hrms',
    children: [
      // Workforce Directory restricted to HR/admin — DEPT_MANAGER should stay
      // on My Team, not open the full company directory.
      { label: 'Workforce Directory', path: '/hrms/employees', icon: <UserCheck size={15} />, visibleForRoles: R_HR },
      { label: 'Organization Setup', path: '/hrms/organization', icon: <Building2 size={15} />, visibleForRoles: R_HR },
      { label: 'Rules & Policies', path: '/hrms/policies', icon: <ClipboardList size={15} />, visibleForRoles: R_HR },
      { label: 'Payroll Configuration', path: '/hrms/payroll/components', icon: <Receipt size={15} />, visibleForRoles: R_FIN_META },
    ],
  },
  {
    key: 'attendance', label: 'Attendance & Time', icon: <Clock size={18} />, module: 'hrms',
    children: [
      { label: 'Attendance Analytics', path: '/hrms/att-analytics', icon: <FileBarChart2 size={15} />, visibleForRoles: R_ADMIN_MGR },
      { label: 'Daily Tracking', path: '/hrms/attendance', icon: <Clock size={15} />, visibleForRoles: R_ADMIN_MGR },
      { label: 'Shifts & Overtime', path: '/hrms/shifts', icon: <Clock size={15} />, visibleForRoles: R_HR },
      { label: 'Geofencing', path: '/hrms/attendance/geofencing', icon: <MapPin size={15} />, visibleForRoles: R_HR },
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
      { label: 'Hiring Pipeline', path: '/hrms/hiring', icon: <UserCheck size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.hiring.offer.read', 'hrms.hiring.read'] },
      { label: 'Onboarding & Assets', path: '/hrms/onboarding/instances', icon: <ClipboardList size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.onboarding.asset.read'] },
      { label: 'Letter Templates', path: '/hrms/letters/templates', icon: <FileText size={15} />, visibleForRoles: R_HR },
      { label: 'Generated Letters', path: '/hrms/letters/generated', icon: <FileText size={15} />, visibleForRoles: R_HR },
      { label: 'Letter Distributions', path: '/hrms/letters/distributions', icon: <FileText size={15} />, visibleForRoles: R_HR },
      { label: 'Employee Vault', path: '/hrms/documents', icon: <FileText size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.letters.template.read'] },
    ],
  },
  {
    key: 'payroll-hr', label: 'Payroll', icon: <CreditCard size={18} />, module: 'hrms',
    children: [
      // R_FIN_RUPEE: HR_MANAGER is NOT welcome on the rupee screens.
      { label: 'Payroll Dashboard', path: '/hrms/payroll-dashboard', icon: <LayoutDashboard size={15} />, visibleForRoles: R_FIN_RUPEE },
      { label: 'Salary Structure', path: '/hrms/salary-structure', icon: <Receipt size={15} />, visibleForRoles: R_FIN_RUPEE },
      // Processing & Payslips is a workflow surface — HR still runs it,
      // but rupee KPIs on the child pages defer to the useRoles guard.
      { label: 'Processing & Payslips', path: '/hrms/payroll/runs', icon: <Receipt size={15} />, visibleForRoles: R_FIN_META },
      { label: 'Payroll Settings', path: '/hrms/payroll/settings', icon: <Settings size={15} />, visibleForRoles: R_FIN_RUPEE },
      { label: 'Production-Linked Incentive', path: '/hrms/pli', icon: <Target size={15} />, visibleForRoles: R_FIN_META },
      { label: 'Advances & Loans', path: '/hrms/advances', icon: <Wallet size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_ESS] },
      { label: 'Bank Disbursement', path: '/hrms/bank-disbursement', icon: <CreditCard size={15} />, visibleForRoles: R_FIN_RUPEE },
    ],
  },
  {
    key: 'expense', label: 'Expense Management', icon: <Receipt size={18} />, module: 'hrms',
    children: [
      { label: 'Expense Center', path: '/hrms/expenses', icon: <Receipt size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_ESS], visibleWithAnyPermission: ['hrms.expense.claim.read', 'hrms.expense.claim.approve', 'hrms.expense.reimbursement', 'hrms.reimb_batch.read'] },
    ],
  },
  {
    key: 'ess', label: 'Employee Self Service', icon: <UserCircle2 size={18} />, module: 'hrms',
    children: [
      { label: 'My Attendance & Leaves', path: '/hrms/attendance', icon: <Clock size={15} />, visibleForRoles: R_ESS },
      { label: 'My Payslip', path: '/me/payslips', icon: <Receipt size={15} />, visibleForRoles: R_ESS },
      { label: 'My Profile', path: '/me', icon: <UserCircle2 size={15} />, visibleForRoles: R_ESS },
      { label: 'Team Attendance', path: '/team', icon: <Users size={15} />, visibleForRoles: ['DEPT_MANAGER'] },
    ],
  },
  {
    key: 'performance', label: 'Performance & Learning', icon: <Target size={18} />, module: 'hrms',
    children: [
      { label: 'Performance Center', path: '/hrms/performance', icon: <Target size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_ESS, ...R_HR] },
      { label: 'Learning & Skills', path: '/hrms/learning', icon: <Award size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.learning.skill.read'] },
    ],
  },
  {
    key: 'compliance', label: 'Compliance', icon: <ShieldAlert size={18} />, module: 'hrms',
    // Every non-muster-roll compliance sub-item routed to /hrms/compliance,
    // producing four "active" pills at once in the mobile drawer and a
    // duplicate-key React warning in the desktop rail. Trimmed to the two
    // distinct destinations that actually exist.
    children: [
      { label: 'Statutory Compliance', path: '/hrms/compliance', icon: <ShieldAlert size={15} />, visibleForRoles: R_ADMIN, visibleWithAnyPermission: ['hrms.compliance.inspector.read'] },
      { label: 'Muster Roll', path: '/hrms/muster-roll', icon: <FileText size={15} />, visibleForRoles: R_HR },
    ],
  },
  {
    key: 'reports', label: 'Reports & Analytics', icon: <FileBarChart2 size={18} />, module: 'hrms',
    children: [
      // Reports endpoints require hrms.report.* which a plain DEPT_MANAGER doesn't
      // hold — that used to leave a manager clicking through to an Access
      // Restricted page. Show only when at least one report permission is held.
      { label: 'Reports Center', path: '/hrms/reports', icon: <FileBarChart2 size={15} />, visibleForRoles: R_ADMIN,
        visibleWithAnyPermission: ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.attendance', 'hrms.report.leave', 'hrms.report.diversity'] },
      { label: 'Workforce Analytics', path: '/hrms/workforce-analytics', icon: <TrendingUp size={15} />, visibleForRoles: R_ADMIN },
    ],
  },
  {
    key: 'exit', label: 'Employee Exit', icon: <LogOut size={18} />, module: 'hrms',
    children: [
      // Two leaves, two routes. Both used to point at /hrms/fnf, and the shell
      // dedupes by path, so "Resignation & Exit" never rendered: HR had no
      // list of who is serving notice — only each profile's Exit tab.
      { label: 'Resignation & Exit', path: '/hrms/exit', icon: <LogOut size={15} />, visibleForRoles: R_HR },
      { label: 'Full & Final Settlement', path: '/hrms/fnf', icon: <Wallet size={15} />, visibleForRoles: R_FIN_RUPEE },
    ],
  },
  {
    key: 'hrsettings', label: 'HR Setup', icon: <Settings size={18} />, module: 'hrms',
    children: [
      { label: 'HR Configuration', path: '/hrms/settings', icon: <Settings size={15} />, visibleForRoles: R_HR },
      { label: 'Notification Templates', path: '/hrms/notification-templates', icon: <Bell size={15} />, visibleForRoles: R_HR },
      { label: 'Integrations', path: '/hrms/integrations', icon: <Plug size={15} />, visibleForRoles: R_HR },
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
  { key: 'inventory', label: 'Inventory', icon: <Building2 size={18} />, path: '/inventory', module: 'inventory' },
  { key: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />, path: '/procurement', module: 'procurement' },
  // Helpdesk was listed with a /helpdesk/tickets child but there is no
  // matching Route in App.tsx — clicking the sidebar link fell through to
  // the "*" catch-all and dumped the user on the launcher. Dropped from the
  // sidebar + app-switcher until the module + routes are actually wired.
]

// ─── Platform admin items (the "Settings" app) ────────────────────────────────
const PLATFORM_ITEMS: NavItemDef[] = [
  { key: 'users', label: 'Users & Access', icon: <Users size={18} />, path: '/users', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'roles', label: 'Roles & Perms', icon: <ShieldAlert size={18} />, path: '/roles', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'audit', label: 'Audit Logs', icon: <FileText size={18} />, path: '/audit-logs', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 'settings', label: 'Configuration', icon: <Settings size={18} />, path: '/settings', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] },
]

// ─── Workspace Settings nav (the "Settings" app — workspace-level, NOT a module) ──
// Account + Workspace sections everyone with settings access sees; Administration
// is super-admin only. Each maps to a route the shell drives.
const SETTINGS_NAV: NavItemDef[] = [
  { key: 's-profile', label: 'Profile', icon: <UserCircle2 size={18} />, path: '/profile' },
  { key: 's-branding', label: 'Branding', icon: <ImageIcon size={18} />, path: '/settings/branding', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-security', label: 'Security', icon: <Shield size={18} />, path: '/settings/security' },
  // Notifications is deliberately open — every role can manage their OWN
  // notification preferences, so no visibleForRoles filter here.
  { key: 's-notifications', label: 'Notifications', icon: <Bell size={18} />, path: '/settings/notifications' },
  // Billing was previously visible to every role — a plain EMPLOYEE would see
  // a "Billing & Plan" pill they had no authority to open. Restrict to the
  // admins the backend actually lets manage billing.
  { key: 's-billing', label: 'Billing & Plan', icon: <CreditCard size={18} />, path: '/settings/billing', visibleForRoles: ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN'] },
  { key: 's-integrations', label: 'Integrations', icon: <Plug size={18} />, path: '/settings/integrations' },
  { key: 's-users', label: 'Users & Access', icon: <Users size={18} />, path: '/users', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-roles', label: 'Roles & Permissions', icon: <ShieldAlert size={18} />, path: '/roles', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { key: 's-audit', label: 'Audit Logs', icon: <FileText size={18} />, path: '/audit-logs', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'] },
  // Danger Zone is destructive tenant surgery — only SUPER_ADMIN and OWNER
  // (workspace owner) are allowed near it, never a HR/FIN admin.
  { key: 's-danger', label: 'Danger Zone', icon: <AlertTriangle size={18} />, path: '/settings/danger', visibleForRoles: ['SUPER_ADMIN', 'OWNER'] },
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
  dashboard: 'Dashboard', myworkspace: 'Me', myteam: 'Team',
  company: 'Company', master: 'Master', attendance: 'Time', leave: 'Leave',
  recruit: 'Hire', 'payroll-hr': 'Payroll', expense: 'Expense', ess: 'Me',
  performance: 'Perform', compliance: 'Comply', reports: 'Reports', exit: 'Exit',
  hrsettings: 'HR Setup',
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
const RAIL_BG = 'linear-gradient(180deg, #090D16 0%, #0C1525 50%, #052E22 100%)'
const HEADER_BG = 'linear-gradient(90deg, #090D16 0%, #0B192C 40%, #0F6E56 100%)'

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
  const tenantName = useLocalAuthStore(s => s.tenant?.name)
  const hasModule = (k: string) => activeModules.includes(k)
  const tenant = useSdkStore(s => s.tenant)
  const permissions = useSdkStore(s => s.permissions)
  const userRoles: string[] = user?.roles ?? []
  const primaryRole = (ROLE_PRIORITY as readonly string[]).find(r => userRoles.includes(r)) ?? null

  // ⌘K global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
      // Escape closes the palette. Handled HERE rather than inside
      // GlobalSearch so it works wherever focus happens to be — the panel was
      // previously dismissable only by clicking the backdrop, which is not
      // what anyone tries first, and its own "ESC" hint was therefore a lie.
      if (e.key === 'Escape') setSearchOpen(false)
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
  function isVisible(item: { visibleForRoles?: string[]; visibleWithAnyPermission?: string[] }): boolean {
    if (item.visibleWithAnyPermission?.some(code => permissions.has(code) || permissions.has('*'))) return true
    if (!item.visibleForRoles || item.visibleForRoles.length === 0) return true
    if (!userRoles.length) return false
    return item.visibleForRoles.some((r) => userRoles.includes(r)
      || (r === 'COMPANY_ADMIN' && userRoles.includes('ADMIN'))
      || (r === 'DEPT_MANAGER' && userRoles.includes('MANAGER')))
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
  /* ── Pages for the ⌘K palette ─────────────────────────────────────────────
   *
   * Derived from the SAME nav arrays the sidebar renders and filtered through
   * the SAME `isVisible`, so the palette can never offer a page the sidebar
   * hides — and there is no second list of routes to drift out of sync. That
   * drift is exactly what sank the earlier `shared/layouts/navigation.tsx`,
   * which ended up with 14 entries against the shell's 46 and nine paths that
   * pointed at routes which no longer existed.
   *
   * Deduped by path because several nav children intentionally share a route
   * (the compliance views all land on /hrms/compliance). */
  const searchPages: SearchPage[] = React.useMemo(() => {
    const out: SearchPage[] = []
    const seen = new Set<string>()
    /* Keywords are derived from the ROUTE, not hand-written, so they stay a
       by-product of the one source of truth. This matters because the nav
       labels are HR jargon and users type plain words: the directory is
       labelled "Workforce Directory" but everyone searches "employee", and
       "Leave Operations Center" is looked for as "leave". The path segments
       carry exactly those plain nouns (/hrms/employees, /hrms/leave). */
    const keywordsFor = (path: string, group?: string) => {
      const fromPath = path
        .split(/[/?=&]/)
        .filter((seg) => seg && seg !== 'hrms' && seg !== 'v1' && !/^\d+$/.test(seg))
        .flatMap((seg) => seg.split('-'))
      const fromGroup = (group ?? '').toLowerCase().split(/[\s&]+/).filter(Boolean)
      return Array.from(new Set([...fromPath, ...fromGroup]))
    }
    const push = (label: string, path: string, group?: string) => {
      if (!path || seen.has(path)) return
      seen.add(path)
      out.push({ id: path, label, path, group, keywords: keywordsFor(path, group) })
    }
    for (const item of [...NAV_ITEMS, ...PLATFORM_ITEMS, ...SETTINGS_NAV]) {
      if (!isVisible(item) || !item.path) continue
      push(item.label, item.path)
    }
    for (const group of MODULE_ITEMS) {
      // Only modules the workspace actually owns — an unsold SKU's pages are
      // not reachable, so offering them would be a dead end.
      if (group.module && group.module !== 'hrms' && !hasModule(group.module)) continue
      if (!isVisible(group)) continue
      for (const child of group.children ?? []) {
        if (!isVisible(child)) continue
        push(child.label, child.path, group.label)
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRoles.join('|'), activeModules.join('|'), permissions])

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
      className={({ isActive }) => clsx(ROW_BASE, isActive ? ROW_ACTIVE : ROW_IDLE)}>
      {({ isActive }) => (<>
        <ActiveBar show={isActive} />
        <span className={clsx('shrink-0', isActive ? 'text-[var(--accent-fg)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}>{item.icon}</span>
        <span>{item.label}</span>
      </>)}
    </NavLink>
  )

  const renderGroup = (item: NavItemDef) => {
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
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        <WorkspaceMark />
        <AppSwitcher />
      </div>

      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-fg)]">{appMeta.icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{appMeta.label}</span>
      </div>

      <nav className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {scoped.flat.map(renderFlat)}
        {scoped.groups.length > 0 && scoped.flat.length > 0 && <div className="my-2 h-px bg-[var(--border-subtle)]" />}
        {scoped.groups.map(renderGroup)}
      </nav>

      <div className="relative border-t border-[var(--border-subtle)] p-3" ref={profileRef}>
        <AnimatePresence>
          {profileOpen && (
            <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-[72px] left-3 right-3 z-dropdown overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
              {profileMenu}
            </motion.div>
          )}
        </AnimatePresence>
        <button onClick={() => setProfileOpen(v => !v)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-subtle)]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-sm font-semibold text-[var(--accent-fg-strong)]">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{fullName}</span>
            {roleBadgeText && <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{roleBadgeText}</span>}
          </span>
          <ChevronDown size={15} className={clsx('shrink-0 text-[var(--text-tertiary)] transition-transform', profileOpen && 'rotate-180')} />
        </button>
      </div>
    </div>
  )

  const searchModal = (
    <AnimatePresence>
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSearchOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -10 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="ut-card ut-card-lg relative w-full max-w-2xl overflow-hidden">
            <GlobalSearch pages={searchPages} onSelect={(res) => { navigate(res.path); setSearchOpen(false) }} />
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
      <span className="text-[10px] font-semibold leading-none tracking-tight">{item.label}</span>
    </button>
  )

  // ─── NEW SIDEBAR RENDER LOGIC matching hrms-dashboard.png ───
  // We extract specific child routes from MODULE_ITEMS to form the exact groups.
  const allModules = MODULE_ITEMS.flatMap(m => m.children || [])

  /** Row style for the dark desktop aside — one definition shared by the
   *  Dashboard link and the flat nav items so a row can never drift between
   *  them. Group children use their own denser variant inline. */
  const railLink = ({ isActive }: { isActive: boolean }) => clsx(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors',
    isActive ? 'bg-[#0F6E56] text-white shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white',
  )


  return (
    <div className="company-workspace flex h-screen overflow-hidden font-sans text-[var(--text-primary)]">
      <a href="#workspace-content" className="workspace-skip-link">Skip to workspace</a>
      <aside className="workspace-rail hidden md:flex" aria-label="Workspace sidebar">
        <NavLink to="/dashboard" className="workspace-brand" aria-label="UnifiedTree home">
          <span className="workspace-brand-mark">ut<span>&bull;</span></span>
          <span className="text-[9px] tracking-wide">UnifiedTree</span>
        </NavLink>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 px-2 py-3">
          {railItems.map(item => (
            <NavLink key={item.key} to={item.target} title={item.fullLabel}
              aria-current={item.active ? 'page' : undefined}
              className={clsx('workspace-rail-link', item.active && 'is-active')}>
              {item.icon}<span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        {scope !== 'admin' && isAdmin && (
          <NavLink to="/settings" className="workspace-rail-link mx-2 mb-3" title="Company settings">
            <Settings size={18} /><span>Company settings</span>
          </NavLink>
        )}
      </aside>

      {/* Mobile drawer ... */}
      <AnimatePresence>
        {mobileOpen && (<>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-modal-backdrop bg-black/40 backdrop-blur-sm md:hidden" />
          <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 26, stiffness: 240 }} className="fixed inset-y-0 left-0 z-modal w-[272px] md:hidden">{sidebarContent}</motion.aside>
        </>)}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* White Top Header */}
        <header className="workspace-header z-sticky flex h-[60px] shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] md:hidden" aria-label="Open menu"><Menu size={20} /></button>

          <div className="flex min-w-0 flex-1 items-center gap-5">
             <span className="hidden max-w-48 truncate text-sm font-semibold text-white lg:block">{tenantName || 'My company'}</span>
             <button onClick={() => setSearchOpen(true)} className="hidden h-10 w-full max-w-[520px] items-center gap-2.5 rounded-xl bg-[var(--bg-subtle)] px-3 text-left transition-colors hover:bg-[var(--bg-default)] sm:flex">
                <Search size={16} className="shrink-0 text-[var(--text-tertiary)]" />
                <span className="flex-1 truncate text-[13px] font-medium text-[var(--text-tertiary)]">Search employees, leaves, reports, settings...</span>
                <kbd className="hidden items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-tertiary)] shadow-sm lg:inline-flex"><Command size={10} /> K</kbd>
             </button>
             <button onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] sm:hidden" aria-label="Search"><Search size={18} /></button>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            {isAdmin && <button onClick={() => navigate('/settings')} aria-label="Company settings" className="text-white/85 hover:text-white transition-colors hidden sm:block">
               <Settings size={18} />
            </button>}
            <button onClick={() => navigate('/modules')} aria-label="Workspace modules" className="text-white/85 hover:text-white transition-colors hidden sm:block">
               <LayoutGrid size={18} />
            </button>

            <div className="relative" ref={notifRef}>
              <ShellNotificationBell open={notifOpen} onToggle={() => setNotifOpen(v => !v)} onNavigate={(to) => { setNotifOpen(false); navigate(to) }} />
            </div>

            {/* Avatar block perfectly matching the image */}
            <div className="relative border-l border-[var(--border-subtle)] pl-4 ml-1" ref={headerProfileRef}>
              <button onClick={() => setProfileOpen(v => !v)} className="flex items-center gap-2.5 rounded-xl transition-colors hover:bg-[var(--bg-subtle)] px-2 py-1" aria-label="Account">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#059669] text-sm font-bold text-white shadow-sm">{initials}</span>
                <div className="hidden text-left sm:block">
                   <div className="text-[13px] font-semibold text-white leading-tight">{fullName}</div>
                   <div className="text-[11px] font-medium text-white/80 leading-tight">{roleBadgeText || 'Employee'}</div>
                </div>
              </button>
              <AnimatePresence>
                {profileOpen && (
                  <motion.div initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.15 }} className="absolute right-0 top-[110%] z-dropdown w-56 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
                    {profileMenu}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {railItems.some(item => item.active && item.children?.length) && (
          <nav aria-label="Module navigation" className="workspace-module-nav">
            {Array.from(new Map(railItems.filter(item => item.active).flatMap(item => item.children ?? []).map(child => [child.path, child])).values()).map(child => (
              <NavLink key={child.path} to={child.path} className={({ isActive }) => clsx('workspace-module-link', isActive && 'is-active')}>
                {child.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-auto"><Outlet /></div>
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
  const fetchList = useNotificationStore((s) => s.fetch)

  // The background poll only refreshes the unread COUNT (see
  // NotificationProvider) — the 50-row list is fetched lazily when the panel
  // opens. Previously the provider pulled 50 rows per user per minute on
  // every route for a badge that only needed a number; at 5,000 users that
  // was ~83 req/s on this endpoint alone.
  React.useEffect(() => {
    if (open) void fetchList()
  }, [open, fetchList])

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
