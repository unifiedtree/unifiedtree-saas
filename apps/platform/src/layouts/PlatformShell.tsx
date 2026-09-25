import React, { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, Calendar, Clock, Building2, ClipboardList,
  Settings, LogOut, ChevronDown,
  UserCircle2, ShieldAlert, FileBarChart2, FileText, Bell,
  TrendingUp, CreditCard, Package, ShoppingCart, HelpCircle, Briefcase,
  UserCheck, Star, Receipt, DollarSign,
  Database, Target, Wallet, Plug, Award, Shield, AlertTriangle,
  LayoutGrid, ArrowLeft,
  Image as ImageIcon, Banknote, UserPlus, Home} from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { clsx } from 'clsx'
import { GlobalSearch } from '@/shared/components/GlobalSearch'
import { accessState } from '@/shared/navigation/access'
import { menuRule } from '@/shared/navigation/pageRegistry'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { formatDistanceToNow } from 'date-fns'
import { dashIcon } from '@/design/dc/icons'
import { RouteErrorBoundary } from '@/shared/components/RouteErrorBoundary'
import { PageSkeleton } from '@/shared/components/PageSkeleton'
import { preloadPath, preloadPathsWhenIdle } from '@/shared/routing/lazyPage'
import {
  DesignRail, DesignHeader, DesignSubNav, DesignMobileHeader, DesignMobileNav, DesignTooltip,
  HeaderSearch, HeaderIconButton, HeaderBellButton, HeaderProfileButton, HeaderDivider,
  type RailEntry, type SubNavEntry, type MobileNavEntry,
} from '@/design/shell/ShellChrome'

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

interface NavChild { label: string; path: string; icon: React.ReactNode; visibleForRoles?: string[]; visibleWithAnyPermission?: string[]; /** Other routes that belong to this section. */ also?: string[] }
interface NavItemDef { key: string; label: string; icon: React.ReactNode; path?: string; module?: string; visibleForRoles?: string[]; children?: NavChild[] }

// ─── Top-level nav (the HRMS app's flat links) ────────────────────────────────
const NAV_ITEMS: NavItemDef[] = [
  // DEPT_MANAGER included: managers landed on / and the shell hid Overview,
  // so the analytics home was invisible to them even though every widget on
  // it is permission-gated and 403s cleanly for anything they can't see.
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, path: '/dashboard', visibleForRoles: ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER'] },
  // Employees reach /me through the Self-service group below (one "Me" in the rail, its pages as tabs).
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
      { label: 'Overview', path: '/hrms/master', icon: <Database size={15} />, visibleForRoles: R_HR },
      { label: 'Workforce Directory', path: '/hrms/employees', icon: <UserCheck size={15} />, visibleForRoles: R_HR },
      { label: 'Organization Setup', path: '/hrms/organization', icon: <Building2 size={15} />, visibleForRoles: R_HR },
      { label: 'Rules & Policies', path: '/hrms/master/shift-rules', icon: <ClipboardList size={15} />, visibleForRoles: R_HR, also: ['/hrms/policies'] },
      { label: 'Payroll Configuration', path: '/hrms/payroll/components', icon: <Receipt size={15} />, visibleForRoles: R_FIN_META },
    ],
  },
  {
    key: 'attendance', label: 'Attendance & Time', icon: <Clock size={18} />, module: 'hrms',
    children: [
      { label: 'Attendance Analytics', path: '/hrms/att-analytics', icon: <FileBarChart2 size={15} />, visibleForRoles: R_ADMIN_MGR },
      { label: 'Daily Tracking', path: '/hrms/attendance', icon: <Clock size={15} />, visibleForRoles: R_ADMIN_MGR },
      { label: 'Shifts & Overtime', path: '/hrms/shifts', icon: <Clock size={15} />, visibleForRoles: R_HR },
      // Geofencing was retired (25 Sep): punch zones live on each branch in Companies & Branches.
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
      // "Documents to review" — the HR queue that lands every pending upload
      // in one place instead of forcing them to open each employee separately.
      { label: 'Docs to Review', path: '/hrms/documents/pending', icon: <FileText size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.document.verify'] },
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
      // Everything an employee does for themselves, one rail item with these as tabs.
      // Leave used to be missing here (the Leave group is for approvers), so an
      // employee could only reach it from links on their workspace.
      { label: 'Overview', path: '/me', icon: <UserCircle2 size={15} />, visibleForRoles: R_ESS },
      { label: 'Attendance', path: '/hrms/attendance', icon: <Clock size={15} />, visibleForRoles: R_ESS },
      { label: 'Leave', path: '/hrms/leave', icon: <Calendar size={15} />, visibleForRoles: R_ESS },
      { label: 'Payslips', path: '/me/payslips', icon: <Receipt size={15} />, visibleForRoles: R_ESS },
      { label: 'Salary', path: '/me/salary', icon: <Wallet size={15} />, visibleForRoles: R_ESS },
      { label: 'Work from home', path: '/me/wfh', icon: <Home size={15} />, visibleForRoles: R_ESS },
      { label: 'Shift change', path: '/me/shift-change', icon: <Clock size={15} />, visibleForRoles: R_ESS },
      { label: 'Team Attendance', path: '/team', icon: <Users size={15} />, visibleForRoles: ['DEPT_MANAGER'] },
    ],
  },
  {
    key: 'performance', label: 'Performance & Learning', icon: <Target size={18} />, module: 'hrms',
    children: [
      { label: 'Performance Center', path: '/hrms/performance', icon: <Target size={15} />, visibleForRoles: [...R_ADMIN_MGR, ...R_ESS, ...R_HR] },
      { label: 'Learning & Skills', path: '/hrms/learning', icon: <Award size={15} />, visibleForRoles: R_HR, visibleWithAnyPermission: ['hrms.learning.skill.read', 'hrms.learning.enroll.self'] },
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
      { label: 'Workforce Analytics', path: '/hrms/workforce-analytics', icon: <TrendingUp size={15} />, visibleForRoles: R_ADMIN,
        visibleWithAnyPermission: ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.diversity'] },
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


/** One-word labels for the Keka-style icon rail — the full names don't fit
 *  under an icon. Falls back to the first word of the nav label. */
const RAIL_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', myworkspace: 'Me', myteam: 'Team',
  company: 'Company', master: 'Master', attendance: 'Attendance', leave: 'Leave',
  recruit: 'Hiring', 'payroll-hr': 'Payroll', expense: 'Expenses', ess: 'Me',
  performance: 'Performance', compliance: 'Compliance', reports: 'Reports', exit: 'Exit',
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
/** Rail icons from the design's icon set (Claude Design prototype). Keys not
 *  listed fall back to the item's own lucide icon. */
const RAIL_ICONS: Record<string, string> = {
  dashboard: 'dashboard', myworkspace: 'home', myteam: 'users',
  company: 'building', master: 'database', attendance: 'clock', leave: 'calendar',
  recruit: 'userPlus', 'payroll-hr': 'creditCard', expense: 'receipt', ess: 'userCheck',
  performance: 'target', compliance: 'shield', reports: 'fileText', exit: 'logOut',
  hrsettings: 'settings',
}
/** Groups that start a new rail block (a thin divider above them), per the design. */
const RAIL_DIVIDERS = new Set(['company', 'attendance', 'payroll-hr', 'performance'])
/** Routes whose designed page has its own section bar, so the shell's sub-nav would double it. */
const OWN_SECTION_BAR = new Set([
  '/hrms/att-analytics', '/hrms/attendance', '/hrms/shifts',
  '/hrms/payroll-dashboard', '/hrms/salary-structure', '/hrms/payroll/runs', '/hrms/payroll/settings', '/hrms/pli', '/hrms/advances', '/hrms/bank-disbursement',
  // Master data (its own top tabs)
  '/hrms/employees', '/hrms/organization', '/hrms/policies', '/hrms/payroll/components',
])
/** A payroll run's own page (/hrms/payroll/runs/:id) sits under the same section bar. */
const ownsSectionBar = (path: string) => OWN_SECTION_BAR.has(path) || /^\/hrms\/payroll\/runs\/[^/]+$/.test(path) || /^\/hrms\/master(\/|$)/.test(path) || /^\/hrms\/employees\/[^/]+$/.test(path)

function matchPath(pathname: string, p?: string) {
  return !!p && (pathname === p || pathname.startsWith(p + '/'))
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

/**
 * Navigate from the search palette. Pages that keep their tab in the URL with
 * `useView` read it on mount and on popstate, so a jump to another tab of the
 * page already open (Leave → Leave › Approvals) also nudges them with a
 * popstate; the location itself is unchanged by it.
 */
function openInApp(navigate: (to: string) => void, path: string) {
  const samePage = window.location.pathname === path.split('?')[0]
  navigate(path)
  if (samePage) window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

export function PlatformShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useSdkStore(s => s.logout)
  const user = useSdkStore(s => s.user)
  // Active modules and permissions are read reactively by useAccessContext below,
  // so the menu updates the moment a module activates.
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

  useEffect(() => { setProfileOpen(false); setNotifOpen(false); setMobileOpen(false); setSearchOpen(false) }, [location.pathname])

  // Menus are permission-only (client rule, 25 Sep): a link shows when the person
  // holds the permission its page needs and the workspace has the page's module
  // (shared/navigation/pageRegistry.ts, the same rules the ⌘K search uses). A
  // link into a module the workspace doesn't have shows only to plan admins,
  // who land on the "add this module" page; nobody else sees locked or
  // coming-soon modules. The `visibleForRoles` lists above are no longer read.
  const accessCtx = useAccessContext()
  function isVisible(item: { path?: string }, group?: string): boolean {
    const rule = item.path ? menuRule(item.path, group) : undefined
    if (rule) return accessState(rule, accessCtx) !== 'hidden'
    // Links the registry doesn't know are the not-yet-built apps' own pages.
    return accessCtx.planAdmin
  }
  // The Settings gear: any workspace-settings page beyond your own profile.
  const canSettings = SETTINGS_NAV.some(i => i.key !== 's-profile' && isVisible(i))

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

  // Scoped navigation (only the current app's items)
  const scoped: { flat: NavItemDef[]; groups: NavItemDef[] } = (() => {
    // Settings pages keep the HRMS rail (the gear lights up and the settings
    // pages become section tabs) — Claude Design prototype.
    if (scope === 'hrms' || scope === 'admin') {
      const groups = HRMS_GROUPS.map(m => ({ ...m, children: m.children?.filter(c => isVisible(c, m.key)) })).filter(m => (m.children ? m.children.length > 0 : true))
      return { flat: NAV_ITEMS.filter(i => isVisible(i)), groups }
    }
    const m = NON_HRMS.find(x => x.module === scope)
    if (!m) return { flat: NAV_ITEMS.filter(i => isVisible(i)), groups: HRMS_GROUPS }
    const flat: NavItemDef[] = m.children
      ? m.children.map(c => ({ key: c.path, label: c.label, icon: c.icon, path: c.path }))
      : [{ key: m.key, label: m.label, icon: m.icon, path: m.path }]
    return { flat, groups: [] }
  })()

  const profileRef = useDismiss(profileOpen, () => setProfileOpen(false))
  const headerProfileRef = useDismiss(profileOpen, () => setProfileOpen(false))
  const notifRef = useDismiss(notifOpen, () => setNotifOpen(false))

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
      const kids = (g.children ?? []).filter(c => isVisible(c, g.key))
      if (!kids.length) continue
      list.push({
        key: g.key,
        label: RAIL_LABELS[g.key] ?? g.label.split(' ')[0],
        fullLabel: g.label,
        icon: g.icon,
        target: kids[0].path,
        active: kids.some(c => matchPath(location.pathname, c.path) || !!c.also?.some(p => matchPath(location.pathname, p))),
        children: kids,
      })
    }
    return list
  })()

  // Fetch the code of every page this person can reach from the rail and its sections while the
  // browser is idle, so opening one doesn't wait on a download (lazyPage.ts).
  const reachable = [...railItems.flatMap(i => [i.target, ...(i.children ?? []).map(c => c.path)]), ...(canSettings ? SETTINGS_NAV.filter(i => isVisible(i)).filter(i => i.path).map(t => t.path!) : [])].join('|')
  useEffect(() => {
    if (!reachable) return
    const t = window.setTimeout(() => preloadPathsWhenIdle(reachable.split('|')), 1200)
    return () => window.clearTimeout(t)
  }, [reachable])


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

  const profileMenu = (
    <>
      <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{fullName}</p>
        <p className="truncate text-xs text-[var(--text-tertiary)]">{user?.email}</p>
      </div>
      <div className="p-1.5">
        <button onClick={() => navigate('/profile')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><UserCircle2 size={16} /> My Profile</button>
        <button onClick={() => navigate('/modules')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><LayoutGrid size={16} /> My Apps</button>
        {canSettings && (
          <button onClick={() => navigate('/settings')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><Settings size={16} /> Settings</button>
        )}
      </div>
      <div className="border-t border-[var(--border-subtle)] p-1.5">
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]"><LogOut size={16} /> Sign out</button>
      </div>
    </>
  )

  const searchModal = (
    <AnimatePresence>
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSearchOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -10 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="ut-card ut-card-lg relative w-full max-w-2xl overflow-hidden">
            <GlobalSearch onSelect={(res) => { openInApp(navigate, res.path); setSearchOpen(false) }} />
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

  // ─── App mode: the Claude Design chrome (icon rail + green top bar) ────────
  // Only top-level sections live in the rail; a section's pages render as the
  // white tab row under the top bar. Settings pages keep the HRMS rail, light
  // up the gear, and list the settings pages as tabs.
  // One lit rail item at a time. When several match (an employee's "My Workspace"
  // link and Self-service group both own /me), prefer the group whose pages show
  // as tabs.
  const litKey = (railItems.find(i => i.active && i.children && i.children.length > 1) ?? railItems.find(i => i.active))?.key
  const railEntry = (item: (typeof railItems)[number]): RailEntry => ({
    key: item.key,
    label: item.label,
    title: item.fullLabel,
    icon: RAIL_ICONS[item.key] ? dashIcon(RAIL_ICONS[item.key], 20) : React.cloneElement(item.icon as React.ReactElement, { size: 20 }),
    active: scope !== 'admin' && item.key === litKey,
    divider: RAIL_DIVIDERS.has(item.key),
    onClick: () => navigate(item.target),
    onIntent: () => preloadPath(item.target),
  })
  const railTop = railItems.filter(i => i.key !== 'hrsettings').map(railEntry)
  const railBottom = railItems.filter(i => i.key === 'hrsettings').map(railEntry)

  const settingsTabs = SETTINGS_NAV.filter(i => isVisible(i)).filter(i => i.path)
  const sectionTabs: { label: string; items: SubNavEntry[] } | null = (() => {
    if (scope === 'admin') {
      return {
        label: 'Settings sections',
        // /settings itself opens on the Profile section, so Profile is the active tab there.
        items: settingsTabs.map(t => ({ label: t.label, path: t.path!, active: matchPath(location.pathname, t.path) || (location.pathname === '/settings' && t.key === 's-profile'), onClick: () => navigate(t.path!) })),
      }
    }
    // Designed pages that draw their own section bar under the header.
    if (ownsSectionBar(location.pathname.replace(/\/$/, ''))) return null
    const active = railItems.find(i => i.active && i.children && i.children.length > 0)
    if (!active?.children) return null
    const seen = new Set<string>()
    const kids = active.children.filter(c => { if (seen.has(c.path)) return false; seen.add(c.path); return true })
    if (kids.length < 2) return null
    // Longest matching path wins, so /hrms/documents/pending does not also light up /hrms/documents.
    const best = kids.filter(c => matchPath(location.pathname, c.path)).sort((a, b) => b.path.length - a.path.length)[0]
    return {
      label: `${active.fullLabel} sections`,
      items: kids.map(c => ({ label: c.label, path: c.path, active: c === best, onClick: () => navigate(c.path) })),
    }
  })()

  const mobileItems: MobileNavEntry[] = [
    ...railItems.map(i => ({
      key: i.key,
      label: i.fullLabel,
      icon: RAIL_ICONS[i.key] ? dashIcon(RAIL_ICONS[i.key], 18) : React.cloneElement(i.icon as React.ReactElement, { size: 18 }),
      active: scope !== 'admin' && i.key === litKey,
      onClick: () => navigate(i.target),
    })),
    ...(canSettings ? [{ key: 'settings', label: 'Settings', icon: dashIcon('settings', 18), active: scope === 'admin', onClick: () => navigate('/settings') }] : []),
  ]

  const profileDropdown = (
    <AnimatePresence>
      {profileOpen && (
        <motion.div initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.15 }} className="absolute right-0 top-[110%] z-dropdown w-56 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
          {profileMenu}
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div className="company-workspace flex h-screen overflow-hidden font-sans text-[var(--text-primary)]">
      <a href="#workspace-content" className="workspace-skip-link">Skip to workspace</a>
      <DesignRail top={railTop} bottom={railBottom} onHome={() => navigate('/dashboard')} />

      {mobileOpen && <DesignMobileNav items={mobileItems} onClose={() => setMobileOpen(false)} />}

      <main className="flex min-w-0 flex-1 flex-col">
        <DesignHeader
          search={<HeaderSearch onOpen={() => setSearchOpen(true)} />}
          right={<>
            {canSettings && (
              <HeaderIconButton label="Settings" active={scope === 'admin'} onClick={() => navigate('/settings')}>
                {dashIcon('settings', 19)}
              </HeaderIconButton>
            )}
            <HeaderIconButton label="All apps" onClick={() => navigate('/modules')}>{dashIcon('grid', 19)}</HeaderIconButton>
            <div className="relative" ref={notifRef}>
              <ShellNotificationBell open={notifOpen} onToggle={() => setNotifOpen(v => !v)} onNavigate={(to) => { setNotifOpen(false); navigate(to) }} />
            </div>
            <HeaderDivider />
            <div className="relative" ref={headerProfileRef}>
              <HeaderProfileButton initials={initials} name={fullName} role={roleBadgeText || 'Employee'} expanded={profileOpen} onClick={() => setProfileOpen(v => !v)} />
              {profileDropdown}
            </div>
          </>}
        />
        <DesignMobileHeader
          onMenu={() => setMobileOpen(true)}
          onSearch={() => setSearchOpen(true)}
          bell={<div className="relative"><ShellNotificationBell mobile open={notifOpen} onToggle={() => setNotifOpen(v => !v)} onNavigate={(to) => { setNotifOpen(false); navigate(to) }} /></div>}
          avatar={
            <div className="relative" ref={profileRef}>
              <button type="button" aria-label="Profile" onClick={() => setProfileOpen(v => !v)}
                style={{ width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '0', background: 'transparent', cursor: 'pointer' }}>
                <span style={{ width: '32px', height: '32px', borderRadius: '999px', background: '#0a5240', boxShadow: '0 0 0 2px rgba(255,255,255,.3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff' }}>{initials}</span>
              </button>
              {profileDropdown}
            </div>
          }
        />
        {sectionTabs && <DesignSubNav label={sectionTabs.label} items={sectionTabs.items} />}
        <div id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-auto">
          {/* The shell stays put between pages: a broken page is contained here, and a page whose
              code is still arriving shows its own outline instead of blanking the app. */}
          <RouteErrorBoundary resetKey={location.pathname} routeLabel={location.pathname}>
            <React.Suspense fallback={<PageSkeleton path={location.pathname} />}><Outlet /></React.Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
      {searchModal}
      <DesignTooltip />
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
  mobile,
}: {
  open: boolean
  onToggle: () => void
  onNavigate: (to: string) => void
  mobile?: boolean
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
      {/* The dot is truthful — shown only when something is unread. */}
      <HeaderBellButton unread={unreadCount > 0} onClick={onToggle} mobile={mobile} />
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
