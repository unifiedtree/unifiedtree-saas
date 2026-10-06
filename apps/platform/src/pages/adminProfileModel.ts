// The administrator's own profile (/profile when the personal pages are off for their role):
// the plain-words pieces it shows, kept apart from the page so they can be tested.
//
//  - roleWords: what each of the person's roles lets them do, in plain words
//  - areasFrom: the parts of the HRMS they look after, read from the permissions they hold
//  - adminPlaces: the admin pages they use most, each only when the page registry opens it for them
//  - moduleName: a workspace module's name for the business card
import { canOpen, type AccessContext } from '@/shared/navigation/access'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { TEAM_APPROVE_CODES } from '@/shared/navigation/shellCodes'

/** The built-in roles, in the words the Roles & permissions page uses for them. */
const ROLE_WORDS: Record<string, { name: string; words: string }> = {
  OWNER: { name: 'Owner', words: 'Owns the workspace. Everything in every company, plus billing, the plan and who can do what.' },
  SUPER_ADMIN: { name: 'Super admin', words: 'Every module and setting, in every company.' },
  ADMIN: { name: 'Admin', words: 'Everything the owner can do except billing, buying modules and resetting or deleting the workspace.' },
  COMPANY_ADMIN: { name: 'Company admin', words: 'Runs the company: its people, settings and approvals.' },
  HR_MANAGER: { name: 'HR manager', words: 'People, leave, attendance and hiring.' },
  FINANCE_LEAD: { name: 'Finance lead', words: 'Payroll, expenses and reports.' },
  DEPT_MANAGER: { name: 'Department manager', words: 'Approves leave and sees attendance for their department.' },
  MANAGER: { name: 'Manager', words: 'Looks after a team, with the modules they were given.' },
  EMPLOYEE: { name: 'Employee', words: 'Their own leave, attendance, pay and documents.' },
}

export interface RoleView { code: string; name: string; words: string }

/** A role's name and plain words: the built-in wording, else the role's own description, else a generic line. */
export function roleWords(code: string, fromServer?: { name?: string | null; description?: string | null } | null): RoleView {
  const known = ROLE_WORDS[code]
  if (known) return { code, ...known }
  const name = fromServer?.name?.trim() || code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
  const words = fromServer?.description?.trim() || 'A role your workspace made. It opens what the owner chose for it in Roles & permissions.'
  return { code, name, words }
}

/** The roles to show, most powerful first; PLATFORM_SUPER_ADMIN is ours, never the customer's. */
export function rolesToShow(codes: readonly string[]): string[] {
  const order = Object.keys(ROLE_WORDS)
  return [...new Set(codes)]
    .filter((c) => c && c !== 'PLATFORM_SUPER_ADMIN')
    .sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
}

/** Areas of the HRMS, and the permission codes (or prefixes, ending in '.') that mean someone looks after it. */
const AREAS: { label: string; codes: string[] }[] = [
  { label: 'People', codes: ['hrms.employee.write', 'hrms.employee.read'] },
  { label: 'Attendance', codes: ['attendance.workforce.admin', 'attendance.team.read'] },
  { label: 'Leave', codes: ['hrms.leave.approve.l1', 'hrms.leave.approve.l2'] },
  { label: 'Payroll', codes: ['payroll.runs.read'] },
  { label: 'Expenses', codes: ['hrms.expense.claim.approve', 'hrms.expense.reimbursement'] },
  { label: 'Hiring', codes: ['hrms.hiring.read', 'hrms.hiring.write'] },
  { label: 'Performance', codes: ['hrms.performance.read'] },
  { label: 'Documents', codes: ['hrms.document.read', 'hrms.document.verify'] },
  { label: 'Reports', codes: ['hrms.report.headcount', 'hrms.report.attendance', 'hrms.report.leave'] },
  { label: 'Settings', codes: ['settings.read', 'settings.hrconfig.write'] },
  { label: 'Roles & access', codes: ['rbac.role.write'] },
  { label: 'Billing', codes: ['workspace.billing.manage'] },
  { label: 'Audit log', codes: ['audit.read'] },
]

/** The areas the person looks after: any one of an area's codes is enough. */
export function areasFrom(has: (code: string) => boolean): string[] {
  return AREAS.filter((a) => a.codes.some(has)).map((a) => a.label)
}

export interface AdminPlace { key: string; label: string; hint: string; path: string; icon: string }

const entry = (id: string) => PAGE_REGISTRY.find((e) => e.id === id)
// The /settings route's guard (App.tsx).
const SETTINGS_CODES = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read', 'workspace.profile.update', 'workspace.security.manage']

/**
 * The admin places the person uses most, in this order: Dashboard, People, Approvals, Settings,
 * Roles & access, Audit logs. Each is listed only when its page opens for them (the same rule as
 * the menu and search); Approvals needs one of the approve permissions.
 */
export function adminPlaces(ctx: AccessContext): AdminPlace[] {
  const out: AdminPlace[] = []
  const add = (id: string, p: Omit<AdminPlace, 'path'> & { path?: string }) => {
    const e = entry(id)
    if (e && canOpen(e.access, ctx)) out.push({ ...p, path: p.path ?? e.path })
  }
  add('dashboard', { key: 'dashboard', label: 'Dashboard', hint: 'Today across the company', icon: 'dashboard' })
  add('employees', { key: 'people', label: 'People', hint: 'Everyone, their records and access', icon: 'users' })
  if (TEAM_APPROVE_CODES.some(ctx.has)) out.push({ key: 'approvals', label: 'Approvals', hint: 'Requests waiting for you', icon: 'inbox', path: '/team?view=approvals' })
  // Settings: the HR configuration when it opens, else the workspace settings (the /settings route's own codes).
  const hrConfig = entry('hr-config')
  if (hrConfig && canOpen(hrConfig.access, ctx)) out.push({ key: 'settings', label: 'Settings', hint: 'Policies, work week, probation and more', icon: 'settings', path: hrConfig.path })
  else if (SETTINGS_CODES.some(ctx.has)) out.push({ key: 'settings', label: 'Settings', hint: 'Workspace settings', icon: 'settings', path: '/settings' })
  add('roles', { key: 'roles', label: 'Roles & access', hint: 'Who can do what', icon: 'shield' })
  add('audit', { key: 'audit', label: 'Audit logs', hint: 'Who did what, and when', icon: 'list' })
  return out
}

const MODULE_NAMES: Record<string, string> = {
  hrms: 'HRMS', payroll: 'Payroll', attendance: 'Attendance', recruitment: 'Hiring', performance: 'Performance', crm: 'CRM', accounts: 'Accounts',
}
export const moduleName = (key: string) => MODULE_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1)

/** "Signed in", "Updated an employee" — a short line for one audit event. */
export function activityLine(e: { action: string; summary?: string | null; resourceType?: string | null; resourceName?: string | null }): string {
  if (e.summary?.trim()) return e.summary.trim()
  const verb: Record<string, string> = { CREATE: 'Added', UPDATE: 'Changed', DELETE: 'Removed', LOGIN: 'Signed in', LOGOUT: 'Signed out', EXPORT: 'Exported', ACCESS: 'Opened', PERMISSION_CHANGE: 'Changed access for' }
  const v = verb[e.action] ?? e.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
  if (e.action === 'LOGIN' || e.action === 'LOGOUT') return v
  const what = e.resourceName || (e.resourceType ? e.resourceType.replace(/_/g, ' ').toLowerCase() : '')
  return what ? `${v} ${what}` : v
}
