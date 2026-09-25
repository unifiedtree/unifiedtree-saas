import { accessState, type Access, type AccessContext } from './access'

/**
 * HRMS settings: the one place in HRMS that lists every HR setting.
 *
 * Pages that are only settings open inside the hub (under /hrms/settings/…,
 * with the hub's section tabs). Settings that live on a page of their own
 * (Shift Rules and Leave Rules in Master data, Holidays on the Leave page…)
 * are listed here too and open where they live. Each item keeps the exact
 * permission rule of the page it opens; the hub shows only what the person
 * may open, and nobody without any of them gets a hub at all.
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
}

/** The hub's own pages, in tab order (the shell shows them as the hub's section tabs). */
export const HUB_PAGES = {
  overview: '/hrms/settings',
  hrConfig: '/hrms/settings/hr-configuration',
  payroll: '/hrms/settings/payroll',
  documentTypes: '/hrms/settings/document-types',
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
      { key: 'shift-rules', label: 'Shift rules', desc: 'Shift timings, grace and overtime for each shift.', path: '/hrms/master/shift-rules', icon: 'calendarClock', access: [{ anyOf: ['attendance.workforce.admin', 'hrms.policy.write'], module: HR }], lives: 'Master data' },
      { key: 'punch-zones', label: 'Punch zones', desc: 'Where people may check in from: a zone on each branch.', path: '/hrms/companies', icon: 'mapPin', access: [{ allOf: ['hrms.branch.read', 'org.geofence.write'], module: HR }], lives: 'Companies & Branches' },
    ],
  },
  {
    key: 'leave', title: 'Leave & holidays', desc: 'Leave types, yearly entitlements and the holiday list.',
    items: [
      { key: 'leave-rules', label: 'Leave rules', desc: 'Leave types, yearly entitlements, carry forward and encashment.', path: '/hrms/master/leave-rules', icon: 'calendarCheck', access: [{ anyOf: ['leave.type.write', 'hrms.policy.write'], module: HR }], lives: 'Master data' },
      { key: 'holidays', label: 'Holidays', desc: 'The holiday list for each year and company.', path: '/hrms/leave?tab=holidays', icon: 'calendar', access: [{ anyOf: ['settings.holidays.write'], module: HR }], lives: 'Leave' },
    ],
  },
  {
    key: 'payroll', title: 'Payroll', desc: 'Statutory deductions, the payroll cycle and salary components.',
    items: [
      { key: 'payroll', label: 'Payroll settings', desc: 'PF, ESI, professional tax, LWF and the payroll cycle used by every run.', path: HUB_PAGES.payroll, icon: 'creditCard', access: HUB_ACCESS.payroll },
      { key: 'components', label: 'Salary components', desc: 'The earnings and deductions payroll works out.', path: '/hrms/payroll/components', icon: 'rupee', access: [{ anyOf: ['payroll.components.read'], module: PAY }], lives: 'Master data' },
      { key: 'statutory', label: 'Statutory settings', desc: 'How PF, ESI, PT and LWF apply to salary components.', path: '/hrms/master/statutory', icon: 'shield', access: [{ anyOf: ['payroll.settings.read'], module: HR }], lives: 'Master data' },
    ],
  },
  {
    key: 'documents', title: 'Documents & policies', desc: 'What employees upload, and the policies they read and acknowledge.',
    items: [
      { key: 'document-types', label: 'Document types', desc: 'Which documents employees upload, which are required, and the rules for each.', path: HUB_PAGES.documentTypes, icon: 'fileText', access: HUB_ACCESS.documentTypes },
      { key: 'policies', label: 'Policy documents', desc: 'Handbooks and policies employees read and acknowledge.', path: '/hrms/policies', icon: 'clipboard', access: [{ allOf: ['hrms.policy.read', 'hrms.policy.write'], module: HR }], lives: 'Master data' },
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
