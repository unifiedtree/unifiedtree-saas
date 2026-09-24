import { P } from '@unifiedtree/sdk'

/**
 * Quick actions for the ⌘K palette.
 *
 * WHY THIS EXISTS
 * ---------------
 * The client's loudest complaint is "I have to hunt through the app to find
 * things". The palette that was meant to answer it returned `[]` — global
 * search was gutted on 2026-08-10 after it painted invented employees into a
 * live customer's panel, and nothing replaced it. This is the half of the
 * replacement that needs no backend: task-shaped entry points into
 * functionality the user can already reach.
 *
 * RULES FOR ADDING AN ACTION
 * --------------------------
 * 1. The destination must be a REAL route in App.tsx. A palette entry that
 *    404s or dead-ends is worse than no entry — it is the "convincing dead
 *    control" problem the audit called out on the audit-log Export button.
 * 2. Query params must be ones the destination actually reads. Verified at
 *    the time of writing: Leave and Attendance parse `?tab=`; Employees parses
 *    `?add=1`; Attendance parses `?status=`. Expense, Compliance,
 *    DocumentVault, Employees and Performance do NOT parse `?tab=`, so those
 *    entries deep-link to the page only.
 * 3. `permission` is the code the DESTINATION enforces, so the palette can
 *    never offer something that 403s on arrival. Actions with no permission
 *    are reachable by every authenticated user.
 * 4. `keywords` carry the words a user would actually type, including the ones
 *    the label does not contain ("regularize" for corrections, "hire" for
 *    requisitions, "reimburse" for expense claims).
 *
 * This registry is the ONLY list of actions. Pages come from the live
 * navigation in PlatformShell, not from here — see `buildSearchPages`.
 */
export interface QuickAction {
  /** Stable id — also the React key and the test handle. */
  id: string
  label: string
  /** Where the label alone is ambiguous. Rendered under the label. */
  description?: string
  /** Grouping shown in the palette. */
  category: 'People' | 'Time' | 'Leave' | 'Pay' | 'Hiring' | 'Documents' | 'Insights' | 'Admin'
  /** Route to navigate to. Must exist in App.tsx. */
  path: string
  /**
   * Permission code the destination enforces. Omit when the route is open to
   * any authenticated user. `anyOf` when several codes can open it.
   */
  permission?: string
  anyOf?: string[]
  /** Extra search terms. The label is always searchable; these are additions. */
  keywords: string[]
}

export const QUICK_ACTIONS: QuickAction[] = [
  // ── People ────────────────────────────────────────────────────────────────
  {
    id: 'add-employee', label: 'Add Employee', category: 'People',
    description: 'Open the new-employee form',
    path: '/hrms/employees?add=1', permission: P.HRMS_EMPLOYEE_WRITE,
    keywords: ['new', 'create', 'hire', 'onboard', 'staff', 'joiner', 'person'],
  },
  {
    id: 'import-employees', label: 'Import Employees', category: 'People',
    description: 'Bulk-load employees from a CSV',
    path: '/hrms/employees/import', permission: P.HRMS_EMPLOYEE_IMPORT,
    keywords: ['bulk', 'csv', 'upload', 'spreadsheet', 'migrate'],
  },
  {
    id: 'org-setup', label: 'Organization Setup', category: 'People',
    description: 'Companies, branches, departments and designations',
    path: '/hrms/organization', permission: P.ORG_COMPANY_WRITE,
    keywords: ['company', 'branch', 'department', 'designation', 'grade', 'structure', 'org'],
  },

  // ── Time & attendance ─────────────────────────────────────────────────────
  {
    id: 'who-is-late', label: 'Who is late today', category: 'Time',
    description: 'Today’s roster, filtered to late arrivals',
    path: '/hrms/attendance?tab=team&status=LATE', permission: P.ATTENDANCE_TEAM_READ,
    keywords: ['late', 'tardy', 'arrivals', 'today', 'attendance'],
  },
  {
    id: 'who-is-absent', label: 'Who is absent today', category: 'Time',
    description: 'Today’s roster, filtered to absentees',
    path: '/hrms/attendance?tab=team&status=ABSENT', permission: P.ATTENDANCE_TEAM_READ,
    keywords: ['absent', 'missing', 'away', 'today', 'attendance'],
  },
  {
    id: 'team-attendance', label: 'Team Attendance', category: 'Time',
    description: 'Who is in today',
    path: '/hrms/attendance?tab=team', permission: P.ATTENDANCE_TEAM_READ,
    keywords: ['team', 'roster', 'present', 'today', 'attendance'],
  },
  {
    id: 'regularize-attendance', label: 'Regularize Attendance', category: 'Time',
    description: 'Raise or review an attendance correction',
    path: '/hrms/attendance?tab=corrections', permission: P.ATTENDANCE_CHECKIN_SELF,
    keywords: ['regularize', 'regularise', 'correction', 'fix', 'missed', 'punch', 'amend'],
  },
  {
    id: 'manual-entry', label: 'Manual Attendance Entry', category: 'Time',
    description: 'Record attendance on someone’s behalf',
    path: '/hrms/attendance/manual-entry', permission: P.ATTENDANCE_MANUAL_ENTRY_WRITE,
    keywords: ['manual', 'entry', 'backdate', 'record', 'punch'],
  },
  {
    id: 'shifts-overtime', label: 'Shifts & Overtime', category: 'Time',
    description: 'Shift roster and overtime',
    path: '/hrms/shifts', permission: P.HRMS_SHIFT_WRITE,
    keywords: ['shift', 'roster', 'overtime', 'ot', 'schedule'],
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  {
    id: 'apply-leave', label: 'Apply for Leave', category: 'Leave',
    description: 'Submit a leave request',
    path: '/hrms/leave?tab=apply', permission: P.LEAVE_REQUEST_SELF,
    keywords: ['apply', 'request', 'time off', 'holiday', 'vacation', 'absence', 'leave'],
  },
  {
    id: 'leave-approvals', label: 'Approve Leave Requests', category: 'Leave',
    description: 'Pending leave approvals',
    path: '/hrms/leave?tab=approvals', permission: P.HRMS_LEAVE_APPROVE_L1,
    keywords: ['approve', 'approvals', 'pending', 'reject', 'decide', 'leave'],
  },
  {
    id: 'leave-balances', label: 'Leave Balances', category: 'Leave',
    description: 'Remaining leave by type',
    path: '/hrms/leave?tab=balances', permission: P.LEAVE_BALANCE_READ,
    keywords: ['balance', 'remaining', 'entitlement', 'quota', 'leave'],
  },

  // ── Pay ───────────────────────────────────────────────────────────────────
  {
    id: 'run-payroll', label: 'Run Payroll', category: 'Pay',
    description: 'Payroll runs and processing',
    path: '/hrms/payroll/runs', permission: P.PAYROLL_RUNS_READ,
    keywords: ['payroll', 'run', 'process', 'salary', 'pay', 'cycle', 'payslip'],
  },
  {
    id: 'salary-structure', label: 'Salary Structure', category: 'Pay',
    description: 'Employee salary structures',
    path: '/hrms/salary-structure', permission: P.PAYROLL_STRUCTURE_READ,
    keywords: ['salary', 'ctc', 'structure', 'components', 'pay'],
  },
  {
    id: 'bank-disbursement', label: 'Bank Disbursement', category: 'Pay',
    description: 'Generate the bank transfer file',
    path: '/hrms/bank-disbursement', permission: P.PAYROLL_DISBURSEMENT_INITIATE,
    keywords: ['bank', 'disbursement', 'neft', 'transfer', 'payout', 'file'],
  },
  {
    id: 'my-payslips', label: 'My Payslips', category: 'Pay',
    description: 'Download your payslips',
    path: '/me/payslips', permission: P.PAYROLL_PAYSLIP_READ_SELF,
    keywords: ['payslip', 'salary slip', 'my pay', 'download', 'payslips'],
  },
  {
    id: 'advances', label: 'Advances & Loans', category: 'Pay',
    description: 'Salary advances and recovery',
    path: '/hrms/advances',
    keywords: ['advance', 'loan', 'emi', 'recovery', 'salary advance'],
  },
  {
    id: 'expense-claims', label: 'Expense Claims', category: 'Pay',
    description: 'Submit or approve expense claims',
    path: '/hrms/expenses',
    keywords: ['expense', 'claim', 'reimburse', 'reimbursement', 'travel', 'receipt', 'spend'],
  },

  // ── Hiring ────────────────────────────────────────────────────────────────
  {
    id: 'hiring-pipeline', label: 'Hiring Pipeline', category: 'Hiring',
    description: 'Requisitions and candidates',
    path: '/hrms/hiring', permission: P.HRMS_HIRING_READ,
    keywords: ['hiring', 'recruit', 'requisition', 'candidate', 'job', 'opening', 'vacancy', 'applicant'],
  },
  {
    id: 'onboarding', label: 'Onboarding', category: 'Hiring',
    description: 'Onboarding instances and tasks',
    path: '/hrms/onboarding/instances', permission: P.HRMS_ONBOARDING_INSTANCE_READ,
    keywords: ['onboard', 'onboarding', 'joining', 'new joiner', 'checklist', 'tasks'],
  },

  // ── Documents & letters ───────────────────────────────────────────────────
  {
    id: 'employee-vault', label: 'Employee Documents', category: 'Documents',
    description: 'The document vault',
    path: '/hrms/documents',
    keywords: ['document', 'vault', 'file', 'contract', 'id proof', 'certificate', 'upload'],
  },
  {
    id: 'generate-letter', label: 'Generated Letters', category: 'Documents',
    description: 'Offer, experience and other letters',
    path: '/hrms/letters/generated', permission: P.HRMS_LETTERS_READ,
    keywords: ['letter', 'offer', 'experience', 'relieving', 'generate', 'issue'],
  },
  {
    id: 'letter-templates', label: 'Letter Templates', category: 'Documents',
    description: 'Manage letter templates',
    path: '/hrms/letters/templates', permission: P.HRMS_LETTERS_TEMPLATE_READ,
    keywords: ['template', 'letter', 'merge', 'draft'],
  },

  // ── Insights ──────────────────────────────────────────────────────────────
  {
    id: 'reports', label: 'Reports', category: 'Insights',
    description: 'Headcount, attrition, attendance and more',
    anyOf: [P.HRMS_REPORT_HEADCOUNT, P.HRMS_REPORT_ATTRITION, P.HRMS_REPORT_ATTENDANCE,
            P.HRMS_REPORT_LEAVE, P.HRMS_REPORT_DIVERSITY],
    path: '/hrms/reports',
    keywords: ['report', 'headcount', 'attrition', 'diversity', 'export', 'csv', 'analytics'],
  },
  {
    id: 'workforce-analytics', label: 'Workforce Analytics', category: 'Insights',
    description: 'Headcount, diversity and attrition trends',
    // The same codes the route admits (any one of the three reports it shows).
    anyOf: [P.HRMS_REPORT_HEADCOUNT, P.HRMS_REPORT_ATTRITION, P.HRMS_REPORT_DIVERSITY],
    path: '/hrms/workforce-analytics',
    keywords: ['analytics', 'workforce', 'trend', 'insight', 'chart'],
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    id: 'audit-logs', label: 'Audit Logs', category: 'Admin',
    description: 'Who did what, and when',
    path: '/audit-logs', permission: P.AUDIT_READ,
    keywords: ['audit', 'log', 'trail', 'history', 'who', 'security', 'compliance'],
  },
  {
    id: 'users', label: 'Workspace Users', category: 'Admin',
    description: 'Invite and manage portal users',
    path: '/users', permission: P.WORKSPACE_USERS_READ,
    keywords: ['user', 'invite', 'access', 'account', 'login'],
  },
  {
    id: 'roles', label: 'Roles & Permissions', category: 'Admin',
    description: 'Role definitions and permission grants',
    path: '/roles', anyOf: [P.RBAC_ROLE_WRITE, P.PLATFORM_ADMIN],
    keywords: ['role', 'permission', 'rbac', 'access', 'authorisation', 'authorization'],
  },
  {
    id: 'hr-settings', label: 'HR Configuration', category: 'Admin',
    description: 'Probation, notice period and HR defaults',
    path: '/hrms/settings', anyOf: [P.SETTINGS_READ, P.SETTINGS_HRCONFIG_WRITE],
    keywords: ['setting', 'configuration', 'config', 'probation', 'notice', 'policy'],
  },
  {
    id: 'my-profile', label: 'My Profile', category: 'People',
    description: 'Your own details',
    path: '/profile',
    keywords: ['profile', 'me', 'my details', 'account', 'personal'],
  },
]
