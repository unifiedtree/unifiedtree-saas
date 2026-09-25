import type { Access, AccessContext } from '../navigation/access'

/**
 * Quick actions for the ⌘K palette: task-shaped entry points ("Apply for
 * leave", "Run payroll") into screens the person can already reach.
 *
 * RULES FOR ADDING AN ACTION
 * 1. The destination is a real route, and any `?tab=` / `?view=` is one the
 *    page reads (see pageRegistry.ts for each page's tabs).
 * 2. `access` holds the permissions the destination and the action need, so
 *    the palette never offers something that 403s or lands on a page where
 *    the action isn't available.
 * 3. `keywords` carry the words people actually type ("regularize",
 *    "reimburse", "wfh").
 */
export interface QuickAction {
  id: string
  label: string
  description: string
  path: string
  /** Icon name from the design's icon set. */
  icon: string
  /** All clauses must pass (see navigation/access.ts). */
  access: Access[]
  keywords: string[]
}

const HR = 'hrms'
const PAY = 'payroll'
const notAdminRole = (ctx: AccessContext) => !ctx.adminRole
const REPORTS = ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.attendance', 'hrms.report.leave', 'hrms.report.diversity']

export const QUICK_ACTIONS: QuickAction[] = [
  // ── For yourself ──
  { id: 'apply-leave', label: 'Apply for leave', description: 'Opens the leave form', path: '/hrms/leave?tab=apply', icon: 'calendarPlus',
    access: [{ allOf: ['leave.request.self'], module: HR, self: true, when: notAdminRole }], keywords: ['request leave', 'time off', 'holiday', 'vacation', 'sick', 'casual'] },
  { id: 'request-wfh', label: 'Request work from home', description: 'Ask to work from home on a day', path: '/me/wfh', icon: 'home',
    access: [{ allOf: ['wfh.request.self'], module: HR, self: true }], keywords: ['wfh', 'remote', 'work from home'] },
  { id: 'fix-attendance', label: 'Ask for an attendance fix', description: 'Forgot to punch? Request a regularization', path: '/hrms/attendance?tab=corrections', icon: 'pencil',
    access: [{ allOf: ['attendance.checkin.self'], module: HR, self: true }], keywords: ['regularize', 'regularise', 'correction', 'missed punch', 'forgot to punch'] },
  { id: 'request-shift', label: 'Request a shift change', description: 'Ask HR to move you to another shift', path: '/me/shift-change', icon: 'swap',
    access: [{ anyOf: ['hrms.ess.read', 'attendance.checkin.self'], module: HR, self: true }], keywords: ['change shift', 'swap shift', 'night shift', 'timing'] },
  { id: 'submit-expense', label: 'Submit an expense claim', description: 'Claim money you spent for work', path: '/hrms/expenses?tab=submit', icon: 'receipt',
    access: [{ allOf: ['hrms.expense.claim.self'], module: HR }], keywords: ['expense', 'claim', 'reimburse', 'reimbursement', 'travel', 'bill'] },
  { id: 'request-advance', label: 'Request a salary advance', description: 'Borrow against your salary', path: '/hrms/advances?tab=request', icon: 'banknote',
    access: [{ allOf: ['hrms.advance.request.self'], module: HR }], keywords: ['advance', 'loan', 'emi'] },
  { id: 'my-payslip', label: 'Download my payslip', description: 'Your payslips, month by month', path: '/me/payslips', icon: 'download',
    access: [{ allOf: ['payroll.payslip.read.self'], module: PAY, self: true }], keywords: ['payslip', 'salary slip', 'pay slip'] },
  { id: 'upload-document', label: 'Upload a document', description: 'Add an ID proof or certificate to your file', path: '/hrms/documents?view=my', icon: 'fileText',
    access: [{ allOf: ['hrms.document.write.self', 'hrms.document.read.self'], module: HR }], keywords: ['aadhaar', 'pan', 'certificate', 'id proof', 'upload'] },

  // ── People ──
  { id: 'add-employee', label: 'Add an employee', description: 'Opens the Workforce Directory, where you add people', path: '/hrms/employees', icon: 'userPlus',
    access: [{ allOf: ['hrms.employee.write', 'hrms.employee.read'], module: HR }], keywords: ['new employee', 'hire', 'onboard', 'new joiner', 'create employee'] },
  { id: 'import-employees', label: 'Import employees', description: 'Bulk-load employees from a CSV file', path: '/hrms/employees/import', icon: 'download',
    access: [{ allOf: ['hrms.employee.import'], module: HR }], keywords: ['bulk', 'csv', 'excel', 'upload employees'] },
  { id: 'invite-user', label: 'Invite a user', description: 'Give someone a login to this workspace', path: '/users', icon: 'users',
    access: [{ allOf: ['workspace.users.manage', 'workspace.users.read'] }], keywords: ['invite', 'login', 'access', 'user'] },
  { id: 'set-punch-zone', label: 'Set a branch punch zone', description: 'Punch zones live on branches, in Companies & Branches', path: '/hrms/companies', icon: 'mapPin',
    access: [{ allOf: ['org.geofence.write', 'hrms.branch.read'], module: HR }], keywords: ['geofence', 'geofencing', 'punch zone', 'radius', 'location', 'office'] },

  // ── Time and leave ──
  { id: 'who-is-late', label: 'Who is late today', description: 'Today’s roster, filtered to late arrivals', path: '/hrms/attendance?tab=team&status=LATE', icon: 'alert',
    access: [{ allOf: ['attendance.team.read'], module: HR }], keywords: ['late', 'late comers', 'arrivals'] },
  { id: 'who-is-absent', label: 'Who is absent today', description: 'Today’s roster, filtered to absences', path: '/hrms/attendance?tab=team&status=ABSENT', icon: 'userX',
    access: [{ allOf: ['attendance.team.read'], module: HR }], keywords: ['absent', 'missing', 'not in'] },
  { id: 'approve-fixes', label: 'Approve attendance fixes', description: 'Regularization requests waiting for you', path: '/hrms/attendance?tab=corrections', icon: 'inbox',
    access: [{ allOf: ['attendance.regularization.approve', 'attendance.team.read'], module: HR }], keywords: ['approve regularization', 'corrections', 'pending fixes'] },
  { id: 'manual-entry', label: 'Record a punch for someone', description: 'Manual attendance entry', path: '/hrms/attendance/manual-entry', icon: 'clock',
    access: [{ allOf: ['attendance.workforce.admin'], module: HR }], keywords: ['manual entry', 'punch on behalf', 'backdate'] },
  { id: 'assign-shift', label: 'Change someone’s shift', description: 'Assign shifts on the roster', path: '/hrms/shifts?tab=roster', icon: 'swap',
    access: [{ allOf: ['attendance.workforce.admin', 'attendance.team.read'], module: HR }], keywords: ['assign shift', 'roster', 'shift change'] },
  { id: 'approve-leave', label: 'Approve leave requests', description: 'Leave waiting for your decision', path: '/hrms/leave?tab=approvals', icon: 'checkCircle',
    access: [{ allOf: ['hrms.leave.approve.l1'], module: HR }], keywords: ['approve', 'pending leave', 'reject leave'] },
  { id: 'add-holiday', label: 'Add a holiday', description: 'The company holiday list', path: '/hrms/leave?tab=holidays', icon: 'sun',
    access: [{ allOf: ['settings.holidays.write'], module: HR }], keywords: ['holiday list', 'festival', 'public holiday'] },
  { id: 'approve-expenses', label: 'Approve expense claims', description: 'Claims waiting for your decision', path: '/hrms/expenses?tab=approvals', icon: 'inbox',
    access: [{ anyOf: ['hrms.expense.claim.approve', 'hrms.expense.reimbursement'], module: HR }], keywords: ['approve claim', 'reimbursement', 'pending claims'] },
  { id: 'review-documents', label: 'Review uploaded documents', description: 'Verify or reject what employees uploaded', path: '/hrms/documents/pending', icon: 'shield',
    access: [{ allOf: ['hrms.document.verify'], module: HR }], keywords: ['verify documents', 'pending documents'] },

  // ── Pay ──
  { id: 'run-payroll', label: 'Run payroll', description: 'Create and process this month’s run', path: '/hrms/payroll/runs', icon: 'rupee',
    access: [{ allOf: ['payroll.runs.manage', 'payroll.runs.read'], module: PAY }], keywords: ['payroll', 'process salary', 'pay run', 'salary'] },
  { id: 'bank-file', label: 'Prepare the bank transfer file', description: 'Bank disbursement for a payroll run', path: '/hrms/bank-disbursement', icon: 'banknote',
    access: [{ allOf: ['payroll.runs.read', 'hrms.disbursement.build'], module: PAY }], keywords: ['bank file', 'neft', 'disbursement', 'salary transfer'] },
  { id: 'revise-salary', label: 'Revise someone’s salary', description: 'Salary structures', path: '/hrms/salary-structure', icon: 'creditCard',
    access: [{ allOf: ['payroll.runs.read', 'payroll.structure.manage'], module: PAY }], keywords: ['ctc revision', 'increment', 'hike', 'salary structure'] },

  // ── Hiring, performance and letters ──
  { id: 'new-requisition', label: 'Open a job requisition', description: 'Hiring requisitions', path: '/hrms/hiring?tab=requisitions', icon: 'briefcase',
    access: [{ allOf: ['hrms.hiring.write', 'hrms.hiring.read'], module: HR }], keywords: ['job opening', 'vacancy', 'post a job', 'hire'] },
  { id: 'start-onboarding', label: 'Start onboarding a new hire', description: 'Opens the onboarding form', path: '/hrms/onboarding/instances/new', icon: 'clipboard',
    access: [{ allOf: ['hrms.onboarding.instance.write'], module: HR }], keywords: ['onboard', 'joining', 'new joiner checklist'] },
  { id: 'review-cycle', label: 'Start a review cycle', description: 'Performance review cycles', path: '/hrms/performance?view=cycles', icon: 'target',
    access: [{ allOf: ['hrms.performance.write', 'hrms.performance.read'], module: HR }], keywords: ['appraisal', 'review cycle', 'performance review'] },
  { id: 'generate-letter', label: 'Generate a letter', description: 'Offer, experience and other letters', path: '/hrms/letters/generated', icon: 'filePen',
    access: [{ allOf: ['hrms.letters.generate', 'hrms.letters.read'], module: HR }], keywords: ['offer letter', 'experience letter', 'relieving letter'] },
  { id: 'export-headcount', label: 'Export headcount', description: 'Headcount report with CSV download', path: '/hrms/reports/headcount', icon: 'download',
    access: [{ allOf: ['hrms.report.headcount'], module: HR }], keywords: ['headcount csv', 'employee count', 'download report'] },
  { id: 'open-reports', label: 'View reports', description: 'Headcount, attrition, attendance and more', path: '/hrms/reports', icon: 'chart',
    access: [{ anyOf: REPORTS, module: HR }], keywords: ['report', 'analytics', 'export'] },

  // ── Workspace ──
  { id: 'manage-plan', label: 'Add a module', description: 'Opens your plan, where you add modules', path: '/plan', icon: 'grid',
    access: [{ when: (ctx) => ctx.planAdmin }], keywords: ['request module', 'upgrade', 'crm', 'accounts', 'inventory', 'plan'] },
]
