// The browser tab's page name ("<Page> - <Workspace>", usePageTitle), kept exactly as it was before
// the redesign's rail. It is worked out from the menu as it was then: its links, their labels and
// the rules each link used, with the longest matching path winning (ties: the first link). The new
// rail's groups and labels don't change any page's title.
//
// The rules below are a copy of MENU_RULES as they were (pageRegistry.ts); every other link uses its
// registry entry, as the menu did.
import { accessState, personalPagesOn, type Access, type AccessContext } from '@/shared/navigation/access'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'

const HR = 'hrms'
const PAY = 'payroll'
const REPORTS = ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.attendance', 'hrms.report.leave', 'hrms.report.diversity']
const SETTINGS = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read']
const any = (...codes: string[]): Access => ({ anyOf: codes })

const RULES_BEFORE: Record<string, Access[]> = {
  '/dashboard': [{ anyOf: ['hrms.employee.read', 'attendance.team.read', 'org.company.write', 'payroll.runs.read', ...REPORTS] }],
  'ess:/hrms/attendance': [{ ...any('attendance.checkin.self'), module: HR, self: true }],
  'ess:/hrms/leave': [{ ...any('leave.request.self'), module: HR, self: true }],
  'attendance:/hrms/attendance': [{ ...any('attendance.team.read'), module: HR }],
  'attendance:/hrms/shifts': [{ ...any('attendance.team.read'), module: HR }],
  'leave:/hrms/leave': [{ anyOf: ['hrms.leave.approve.l1', 'settings.holidays.write', 'leave.type.write', 'hrms.report.leave'], module: HR }],
  'recruit:/hrms/onboarding/instances': [{ ...any('hrms.onboarding.instance.write', 'hrms.onboarding.asset.read', 'hrms.onboarding.template.read'), module: HR }],
  'recruit:/hrms/documents': [{ ...any('hrms.document.read', 'hrms.letters.template.read'), module: HR }],
  'payroll-hr:/hrms/pli': [{ ...any('hrms.pli.read', 'hrms.pli.target.read'), module: PAY }],
  '/profile': [],
  '/settings': [{ anyOf: SETTINGS }],
}

function ruleBefore(path: string, group?: string): Access[] | undefined {
  if (group && RULES_BEFORE[`${group}:${path}`]) return RULES_BEFORE[`${group}:${path}`]
  if (RULES_BEFORE[path]) return RULES_BEFORE[path]
  const hits = PAGE_REGISTRY.filter((e) => !e.parent && e.path === path)
  return (hits.find((e) => !e.id.startsWith('me-')) ?? hits[0])?.access
}

type Link = [label: string, path: string]

// The menu's links, in its order: the flat links, the Settings app's links and the settings row
// (no group), then each group's links.
const FLAT: Link[] = [
  ['Dashboard', '/dashboard'], ['My Team', '/team'],
  ['Users & Access', '/users'], ['Roles & Perms', '/roles'], ['Audit Logs', '/audit-logs'], ['Configuration', '/settings'],
  ['Profile', '/profile'], ['Branding', '/settings/branding'], ['Security', '/settings/security'], ['Notifications', '/settings/notifications'],
  ['Billing & Plan', '/settings/billing'], ['Integrations', '/settings/integrations'], ['Users & Access', '/users'], ['Roles & Permissions', '/roles'],
  ['Audit Logs', '/audit-logs'], ['Danger Zone', '/settings/danger'],
]
const GROUPED: [group: string, links: Link[]][] = [
  ['company', [['Companies & Branches', '/hrms/companies']]],
  ['master', [['Overview', '/hrms/master'], ['Workforce Directory', '/hrms/employees'], ['Organization Setup', '/hrms/organization'], ['Rules & Policies', '/hrms/master/shift-rules'], ['Payroll Configuration', '/hrms/payroll/components']]],
  ['attendance', [['Attendance Analytics', '/hrms/att-analytics'], ['Daily Tracking', '/hrms/attendance'], ['Shifts & Overtime', '/hrms/shifts']]],
  ['leave', [['Leave Operations Center', '/hrms/leave']]],
  ['recruit', [['Hiring Pipeline', '/hrms/hiring'], ['Onboarding & Assets', '/hrms/onboarding/instances'], ['Letters', '/hrms/letters'], ['Employee Vault', '/hrms/documents'], ['Docs to Review', '/hrms/documents/pending']]],
  ['payroll-hr', [['Payroll Dashboard', '/hrms/payroll-dashboard'], ['Salary Structure', '/hrms/salary-structure'], ['Processing & Payslips', '/hrms/payroll/runs'], ['Payroll Settings', '/hrms/payroll/settings'], ['Production-Linked Incentive', '/hrms/pli'], ['Advances & Loans', '/hrms/advances'], ['Bank Disbursement', '/hrms/bank-disbursement']]],
  ['expense', [['Expense Center', '/hrms/expenses']]],
  ['ess', [['Overview', '/me'], ['Attendance', '/hrms/attendance'], ['Leave', '/hrms/leave'], ['Payslips', '/me/payslips'], ['Salary', '/me/salary'], ['Work from home', '/me/wfh'], ['Shift change', '/me/shift-change'], ['My assets', '/me/assets'], ['Letters', '/hrms/letters/my'], ['Team Attendance', '/team']]],
  ['performance', [['Performance Center', '/hrms/performance'], ['Learning & Skills', '/hrms/learning']]],
  ['compliance', [['Statutory Compliance', '/hrms/compliance'], ['Muster Roll', '/hrms/muster-roll']]],
  ['reports', [['Reports Center', '/hrms/reports'], ['Workforce Analytics', '/hrms/workforce-analytics']]],
  ['exit', [['Resignation & Exit', '/hrms/exit'], ['Full & Final Settlement', '/hrms/fnf']]],
  ['hrsettings', [['HR Configuration', '/hrms/settings'], ['Notification Templates', '/hrms/notification-templates'], ['Integrations', '/hrms/integrations']]],
  ['crm', [['Leads', '/crm/leads'], ['Customers', '/crm/customers'], ['Deals', '/crm/deals']]],
  ['accounts', [['Invoices', '/accounts/invoices'], ['Payments', '/accounts/payments'], ['Expenses', '/accounts/expenses']]],
  ['projects', [['All Projects', '/projects'], ['Task Board', '/projects/board']]],
]

function visibleBefore(path: string, group: string | undefined, ctx: AccessContext): boolean {
  // The self-service group follows the personal pages rule (by default hidden from the roles that run the workspace).
  if (group === 'ess' && !personalPagesOn(ctx)) return false
  const rule = ruleBefore(path, group)
  if (rule) return accessState(rule, ctx) !== 'hidden'
  return ctx.planAdmin
}

const matches = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + '/')

/** The page name for the browser tab at this address (null: just the workspace name). */
export function pageTitleLabel(pathname: string, ctx: AccessContext): string | null {
  const links: Link[] = []
  for (const [label, path] of FLAT) if (visibleBefore(path, undefined, ctx)) links.push([label, path])
  for (const [group, list] of GROUPED) for (const [label, path] of list) if (visibleBefore(path, group, ctx)) links.push([label, path])
  let best: Link | null = null
  for (const l of links) if (matches(pathname, l[1]) && (!best || l[1].length > best[1].length)) best = l
  return best ? best[0] : null
}
