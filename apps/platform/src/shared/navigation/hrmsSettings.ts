import { accessState, type Access, type AccessContext } from './access'

/**
 * HRMS settings: the one place in HRMS that holds every HR setting.
 *
 * Settings pages open inside the hub (under /hrms/settings/…, with the hub's
 * section tabs): HR configuration, the rules and payroll configuration that
 * used to sit in Master data, payroll settings, expense policies, document
 * types, notification templates and roles. Their old addresses redirect here,
 * and the old entry points (Master data's tabs, Payroll's and Expenses' own
 * tabs) lead here too. Two cards open where they live, because they are part
 * of pages everyone uses: Holidays (the Leave page's holiday list) and punch
 * zones (each branch in Companies & Branches).
 *
 * Each item keeps the exact permission rule of the page it opens; the hub
 * shows only what the person may open, and nobody without any gets a hub.
 *
 * Workspace settings (branding, billing, users, security, audit logs) are not
 * here: they are opened from the Apps page (workspaceSettings.ts).
 *
 * The page registry (pageRegistry.ts) takes the rules of the hub's own pages
 * from here, so the menu, the ⌘K search and the hub can never disagree.
 */

export interface HrmsSettingsItem {
  key: string
  label: string
  /** One line: what is set there. */
  desc: string
  /** Where it opens. */
  path: string
  /** Icon name from the design's icon set. */
  icon: string
  /** All clauses must pass (see access.ts). */
  access: Access[]
  /** The page it opens when that page isn't part of the hub (shown on the card). */
  lives?: string
}

export interface HrmsSettingsGroup { key: string; title: string; desc: string; items: HrmsSettingsItem[] }

const HR = 'hrms'
const PAY = 'payroll'
/** Any settings capability (the old /settings route's rule). */
export const SETTINGS_ANY = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read']

/** The access rule of each page that opens inside the hub. */
export const HUB_ACCESS = {
  hrConfig: [{ anyOf: ['settings.hrconfig.write', 'settings.read', 'hrms.probation.config.read', 'attendance.policy.manage'], module: HR }] as Access[],
  payroll: [{ anyOf: ['payroll.settings.read'], module: PAY }] as Access[],
  documentTypes: [{ anyOf: SETTINGS_ANY }, { anyOf: ['hrms.document.type.read', 'hrms.document.type.write'] }] as Access[],
  notifications: [{ anyOf: ['hrms.notiftemplate.read', 'hrms.notiftemplate.write'], module: HR }] as Access[],
  roles: [{ anyOf: ['rbac.role.write', 'platform.admin'] }] as Access[],
  // Master data's rules and payroll configuration sections (MasterContainer checks the same codes).
  shiftRules: [{ anyOf: ['attendance.workforce.admin', 'hrms.policy.write'], module: HR }] as Access[],
  leaveRules: [{ anyOf: ['leave.type.write', 'hrms.policy.write'], module: HR }] as Access[],
  components: [{ anyOf: ['payroll.components.read'], module: PAY }] as Access[],
  statutory: [{ anyOf: ['payroll.settings.read'], module: HR }] as Access[],
  // The admin view of policy documents; everyone else reads policies at /hrms/policies.
  policies: [{ allOf: ['hrms.policy.read', 'hrms.policy.write'], module: HR }] as Access[],
  expensePolicies: [{ anyOf: ['hrms.expense.policy.read'], module: HR }] as Access[],
}

/** The hub's own pages, in tab order (the shell shows them as the hub's section tabs). */
export const HUB_PAGES = {
  overview: '/hrms/settings',
  hrConfig: '/hrms/settings/hr-configuration',
  shiftRules: '/hrms/settings/shift-rules',
  leaveRules: '/hrms/settings/leave-rules',
  payroll: '/hrms/settings/payroll',
  components: '/hrms/settings/salary-components',
  statutory: '/hrms/settings/statutory',
  expensePolicies: '/hrms/settings/expense-policies',
  documentTypes: '/hrms/settings/document-types',
  policies: '/hrms/settings/policies',
  notifications: '/hrms/settings/notifications',
  roles: '/hrms/settings/roles',
} as const

export const HRMS_SETTINGS: HrmsSettingsGroup[] = [
  {
    key: 'company', title: 'Company rules', desc: 'How new people are numbered, probation, notice and the fiscal year.',
    items: [
      { key: 'hr-config', label: 'HR configuration', desc: 'Employee IDs, probation, notice and retirement, the work week and the fiscal year.', path: HUB_PAGES.hrConfig, icon: 'settings', access: HUB_ACCESS.hrConfig },
    ],
  },
  {
    key: 'attendance', title: 'Attendance & shifts', desc: 'When a day counts as late, half or absent, and the shifts people work.',
    items: [
      { key: 'late', label: 'Late arrival & attendance rules', desc: 'Grace period, late arrivals allowed, minimum hours, geofencing and work from home.', path: `${HUB_PAGES.hrConfig}#st-late`, icon: 'clock', access: HUB_ACCESS.hrConfig },
      { key: 'week', label: 'Work week', desc: 'The day the week starts and the weekly off days.', path: `${HUB_PAGES.hrConfig}#st-week`, icon: 'calendarDays', access: HUB_ACCESS.hrConfig },
      { key: 'shift-rules', label: 'Shift rules', desc: 'Shift timings, grace and overtime for each shift.', path: HUB_PAGES.shiftRules, icon: 'calendarClock', access: HUB_ACCESS.shiftRules },
      { key: 'punch-zones', label: 'Punch zones', desc: 'Where people may check in from: a zone on each branch.', path: '/hrms/companies', icon: 'mapPin', access: [{ allOf: ['hrms.branch.read', 'org.geofence.write'], module: HR }], lives: 'Companies & Branches' },
    ],
  },
  {
    key: 'leave', title: 'Leave & holidays', desc: 'Leave types, yearly entitlements and the holiday list.',
    items: [
      { key: 'leave-rules', label: 'Leave rules', desc: 'Leave types, yearly entitlements, carry forward and encashment.', path: HUB_PAGES.leaveRules, icon: 'calendarCheck', access: HUB_ACCESS.leaveRules },
      { key: 'holidays', label: 'Holidays', desc: 'The holiday list for each year and company.', path: '/hrms/leave?tab=holidays', icon: 'calendar', access: [{ anyOf: ['settings.holidays.write'], module: HR }], lives: 'Leave' },
    ],
  },
  {
    key: 'payroll', title: 'Payroll', desc: 'Statutory deductions, the payroll cycle and salary components.',
    items: [
      { key: 'payroll', label: 'Payroll settings', desc: 'PF, ESI, professional tax, LWF and the payroll cycle used by every run.', path: HUB_PAGES.payroll, icon: 'creditCard', access: HUB_ACCESS.payroll },
      { key: 'components', label: 'Salary components', desc: 'The earnings and deductions payroll works out.', path: HUB_PAGES.components, icon: 'rupee', access: HUB_ACCESS.components },
      { key: 'statutory', label: 'Statutory settings', desc: 'How PF, ESI, PT and LWF apply to salary components.', path: HUB_PAGES.statutory, icon: 'shield', access: HUB_ACCESS.statutory },
    ],
  },
  {
    key: 'expenses', title: 'Expenses', desc: 'The limits expense claims are checked against.',
    items: [
      { key: 'expense-policies', label: 'Expense policies', desc: 'The most one claim may be in each category.', path: HUB_PAGES.expensePolicies, icon: 'receipt', access: HUB_ACCESS.expensePolicies },
    ],
  },
  {
    key: 'documents', title: 'Documents & policies', desc: 'What employees upload, and the policies they read and acknowledge.',
    items: [
      { key: 'document-types', label: 'Document types', desc: 'Which documents employees upload, which are required, and the rules for each.', path: HUB_PAGES.documentTypes, icon: 'fileText', access: HUB_ACCESS.documentTypes },
      { key: 'policies', label: 'Policy documents', desc: 'Handbooks and policies employees read and acknowledge.', path: HUB_PAGES.policies, icon: 'clipboard', access: HUB_ACCESS.policies },
    ],
  },
  {
    key: 'notifications', title: 'Notifications', desc: 'The wording of the messages HRMS sends.',
    items: [
      { key: 'notifications', label: 'Notification templates', desc: 'Email, SMS, push and in-app wording for each event.', path: HUB_PAGES.notifications, icon: 'bell', access: HUB_ACCESS.notifications },
    ],
  },
  {
    key: 'access', title: 'Roles & access', desc: 'What each role can do, and who can use HRMS.',
    items: [
      { key: 'roles', label: 'Roles & permissions', desc: 'What each role can do. Duplicate a built-in role to make your own.', path: HUB_PAGES.roles, icon: 'shield', access: HUB_ACCESS.roles },
      { key: 'access', label: 'HRMS access', desc: 'Who can use HRMS, and with which role.', path: `${HUB_PAGES.roles}?view=assignments`, icon: 'users', access: HUB_ACCESS.roles },
    ],
  },
]

/** The groups and items this person may open (empty groups left out). */
export function hrmsSettingsFor(ctx: AccessContext): HrmsSettingsGroup[] {
  return HRMS_SETTINGS
    .map((g) => ({ ...g, items: g.items.filter((i) => accessState(i.access, ctx) === 'open') }))
    .filter((g) => g.items.length > 0)
}

/** Whether this person has any HR setting to open (the hub's own rule). */
export function canOpenHrmsSettings(ctx: AccessContext): boolean {
  return HRMS_SETTINGS.some((g) => g.items.some((i) => accessState(i.access, ctx) === 'open'))
}
