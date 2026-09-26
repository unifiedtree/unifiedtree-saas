import { accessState, type Access, type AccessContext, type AccessState } from './access'
import { HUB_ACCESS, HUB_PAGES, canOpenHrmsSettings } from './hrmsSettings'

/**
 * Every page and sub-tab of the workspace, with who may open it.
 *
 * Built from the real routes in App.tsx (their RouteGuard permissions and
 * ModuleGate module) and from each page's own tab rules (`?tab=` / `?view=`,
 * shown only to the people the page shows them to). The ⌘K search offers
 * these, "/" path navigation resolves against them, and the launcher picks an
 * app's first page from them. When a route or a tab changes, change it here.
 *
 * `slash` is the path typed after "/" in the search box, e.g.
 * "attendance/daily-logs". Segments are matched ignoring case, spaces and
 * dashes, so "/attendance/dailylogs" and "/attendance/daily logs" work too.
 */

export interface PageEntry {
  id: string
  /** Shown in search results. */
  label: string
  /** Route to open, with its tab query when it is a tab. */
  path: string
  /** Section of the app it belongs to, shown under the label. */
  area: string
  /** Icon name from the design's icon set. */
  icon: string
  /** Canonical "/" path, without the leading slash. */
  slash: string
  /** Other "/" paths that open it. */
  aliases: string[]
  keywords: string[]
  /** All clauses must pass. */
  access: Access[]
  /** The parent page's id, for a tab. */
  parent?: string
  /** A module that isn't built yet: plan admins only, never anyone else. */
  comingSoon?: boolean
}

/** First "/" segment → the app area it opens. */
export interface SlashModule { key: string; label: string; icon: string; aliases: string[] }

const HR = 'hrms'
const PAY = 'payroll'
const REPORTS = ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.attendance', 'hrms.report.leave', 'hrms.report.diversity']
const SETTINGS = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read']
const ORG_SETUP = ['hrms.department.write', 'hrms.branch.write', 'hrms.designation.write']
const MASTER_ANY = ['hrms.employee.read', 'hrms.department.write', 'hrms.branch.write', 'hrms.designation.write', 'hrms.contractor.read', 'leave.type.write', 'hrms.policy.write', 'attendance.workforce.admin', 'payroll.components.read', 'payroll.settings.read']
const any = (...codes: string[]): Access => ({ anyOf: codes })
const notAdminRole = (ctx: AccessContext) => !ctx.adminRole
const planAdminOnly = (ctx: AccessContext) => ctx.planAdmin

export const SLASH_MODULES: SlashModule[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', aliases: ['home'] },
  { key: 'me', label: 'My workspace', icon: 'userCheck', aliases: ['my', 'self', 'ess', 'myself'] },
  { key: 'team', label: 'My team', icon: 'users', aliases: ['myteam'] },
  { key: 'company', label: 'Companies & Branches', icon: 'building', aliases: ['companies', 'branches', 'branch'] },
  { key: 'master', label: 'Master data', icon: 'database', aliases: ['masterdata', 'setup'] },
  { key: 'attendance', label: 'Attendance & Time', icon: 'clock', aliases: ['time', 'att'] },
  { key: 'leave', label: 'Leave', icon: 'calendarDays', aliases: ['leaves', 'timeoff'] },
  { key: 'hiring', label: 'Hiring', icon: 'userPlus', aliases: ['recruitment', 'recruit', 'jobs'] },
  { key: 'onboarding', label: 'Onboarding & Assets', icon: 'clipboard', aliases: ['joining'] },
  { key: 'documents', label: 'Documents', icon: 'fileText', aliases: ['docs', 'document', 'vault'] },
  { key: 'letters', label: 'Letters', icon: 'filePen', aliases: ['letter'] },
  { key: 'payroll', label: 'Payroll', icon: 'creditCard', aliases: ['pay'] },
  { key: 'expenses', label: 'Expenses', icon: 'receipt', aliases: ['expense', 'claims', 'reimbursement'] },
  { key: 'performance', label: 'Performance', icon: 'target', aliases: ['appraisal', 'appraisals'] },
  { key: 'learning', label: 'Learning & Skills', icon: 'award', aliases: ['training', 'skills'] },
  { key: 'compliance', label: 'Compliance', icon: 'shield', aliases: ['statutory'] },
  { key: 'reports', label: 'Reports & Analytics', icon: 'chart', aliases: ['report', 'analytics'] },
  { key: 'exit', label: 'Employee exit', icon: 'logOut', aliases: ['offboarding'] },
  { key: 'hr-setup', label: 'HRMS settings', icon: 'settings', aliases: ['hrsetup', 'hrconfig', 'configuration', 'hrms-settings', 'hr-settings'] },
  { key: 'settings', label: 'Workspace settings', icon: 'settings', aliases: ['admin', 'workspace'] },
  { key: 'apps', label: 'Apps', icon: 'grid', aliases: ['modules', 'launcher'] },
]

interface PageOpts { aliases?: string[]; keywords?: string[]; icon?: string; comingSoon?: boolean }
const entries: PageEntry[] = []
function page(id: string, label: string, path: string, area: string, slash: string, access: Access[], o: PageOpts = {}) {
  entries.push({ id, label, path, area, slash, access, icon: o.icon || iconOf(slash), aliases: o.aliases || [], keywords: o.keywords || [], comingSoon: o.comingSoon })
}
/** A tab of `parentId`: its path adds `query`, and it needs the parent's access plus its own. */
function tab(parentId: string, key: string, label: string, query: string, slash: string, access: Access[] = [], o: PageOpts = {}) {
  const p = entries.find((e) => e.id === parentId)
  if (!p) throw new Error('pageRegistry: unknown parent ' + parentId)
  entries.push({
    id: `${parentId}:${key}`, label, path: p.path + (p.path.includes('?') ? '&' : '?') + query, area: `${p.area} › ${p.label}`, slash,
    access: [...p.access, ...access], parent: parentId, icon: o.icon || p.icon, aliases: o.aliases || [], keywords: o.keywords || [],
  })
}
function iconOf(slash: string) { const m = SLASH_MODULES.find((x) => x.key === slash.split('/')[0]); return m ? m.icon : 'fileText' }

// ── Home ───────────────────────────────────────────────────────────────────
page('dashboard', 'Dashboard', '/dashboard', 'Home', 'dashboard', [], { keywords: ['home', 'overview', 'today', 'summary'] })
page('apps', 'All apps', '/modules', 'Home', 'apps', [], { keywords: ['launcher', 'modules', 'my apps'] })
page('plan', 'Manage plan', '/plan', 'Home', 'apps/plan', [{ when: planAdminOnly }], { aliases: ['plan'], keywords: ['plan', 'subscription', 'add module', 'upgrade', 'seats'] })

// ── My workspace (self-service) ────────────────────────────────────────────
page('me', 'My workspace', '/me', 'Me', 'me', [{ ...any('hrms.ess.read', 'attendance.checkin.self'), module: HR, self: true }], { aliases: ['me/overview', 'me/home'], keywords: ['self service', 'ess', 'my home'] })
page('me-attendance', 'My attendance', '/hrms/attendance?tab=my', 'Me', 'me/attendance', [{ ...any('attendance.checkin.self'), module: HR, self: true, when: notAdminRole }], { keywords: ['punch', 'check in', 'my days', 'present'] })
page('me-leave', 'My leave', '/hrms/leave?tab=my', 'Me', 'me/leave', [{ allOf: ['leave.request.self'], module: HR, self: true, when: notAdminRole }], { keywords: ['time off', 'my requests', 'leave status'] })
page('me-payslips', 'My payslips', '/me/payslips', 'Me', 'me/payslips', [{ ...any('payroll.payslip.read.self'), module: PAY, self: true }], { aliases: ['payslips', 'payslip'], keywords: ['salary slip', 'pay slip', 'download payslip'] })
page('me-salary', 'My salary', '/me/salary', 'Me', 'me/salary', [{ ...any('payroll.structure.read.self'), module: PAY, self: true }], { aliases: ['salary'], keywords: ['ctc', 'salary structure', 'pay'] })
page('me-wfh', 'Work from home', '/me/wfh', 'Me', 'me/wfh', [{ ...any('wfh.request.self'), module: HR, self: true }], { aliases: ['me/work-from-home', 'wfh'], keywords: ['wfh', 'remote', 'home'] })
page('me-shift', 'Shift change request', '/me/shift-change', 'Me', 'me/shift-change', [{ ...any('hrms.ess.read', 'attendance.checkin.self'), module: HR, self: true }], { keywords: ['change shift', 'shift swap', 'timing'] })
page('me-documents', 'My documents', '/hrms/documents?view=my', 'Me', 'me/documents', [{ ...any('hrms.document.read.self'), module: HR }], { keywords: ['upload', 'aadhaar', 'pan', 'id proof', 'certificate'] })
page('me-letters', 'My letters', '/hrms/letters/my', 'Me', 'me/letters', [{ ...any('hrms.letters.read.self'), module: HR }], { keywords: ['offer letter', 'experience letter', 'relieving'] })
page('me-assets', 'My assets', '/me/assets', 'Me', 'me/assets', [{ ...any('hrms.onboarding.asset.self'), module: HR, self: true }], { keywords: ['laptop', 'equipment', 'handed over', 'returned'] })
page('me-interviews', 'My interviews', '/me/interviews', 'Me', 'me/interviews', [{ ...any('hrms.hiring.interview.self', 'hrms.hiring.read'), module: HR }], { keywords: ['interview', 'scorecard', 'panel', 'candidate feedback'] })
page('me-incentives', 'My incentives', '/hrms/pli', 'Me', 'me/incentives', [{ ...any('hrms.pli.read.self'), noneOf: ['hrms.pli.read', 'hrms.pli.target.read'], module: PAY }], { keywords: ['pli', 'bonus', 'incentive'] })
page('me-advances', 'My advances', '/hrms/advances?tab=my', 'Me', 'me/advances', [{ ...any('hrms.advance.request.self'), module: HR }], { keywords: ['loan', 'salary advance', 'emi'] })
page('me-claims', 'My expense claims', '/hrms/expenses?tab=my', 'Me', 'me/expenses', [{ ...any('hrms.expense.claim.self'), module: HR }], { aliases: ['me/claims'], keywords: ['reimbursement', 'claim', 'receipt'] })
page('me-reviews', 'My reviews', '/hrms/performance?view=my-reviews', 'Me', 'me/reviews', [{ ...any('hrms.performance.review.self'), module: HR }], { keywords: ['appraisal', 'self review', 'feedback'] })
page('me-goals', 'My goals', '/hrms/performance?view=my-goals', 'Me', 'me/goals', [{ ...any('hrms.performance.review.self'), module: HR }], { keywords: ['kpi', 'objectives', 'targets'] })
page('me-training', 'My training', '/hrms/learning?view=my', 'Me', 'me/training', [{ ...any('hrms.learning.enroll.self'), module: HR }], { keywords: ['course', 'learning', 'enrol'] })
page('me-onboarding', 'My onboarding', '/hrms/onboarding/instances?view=hires', 'Me', 'me/onboarding', [{ ...any('hrms.onboarding.instance.read'), noneOf: ['hrms.onboarding.instance.write'], module: HR }], { keywords: ['joining', 'checklist', 'tasks'] })
page('profile', 'My profile', '/profile', 'Me', 'me/profile', [], { aliases: ['profile', 'settings/profile'], keywords: ['account', 'my details', 'personal', 'password', 'photo'] })
page('team', 'My team', '/team', 'Me', 'team', [{ ...any('attendance.team.read', 'hrms.leave.approve.l1'), noneOf: ['hrms.employee.read'], module: HR }], { keywords: ['team', 'reports', 'my people', 'who is in'] })

// ── Company ────────────────────────────────────────────────────────────────
page('companies', 'Companies & Branches', '/hrms/companies', 'Company', 'company', [{ ...any('hrms.branch.read'), module: HR }], {
  aliases: ['companies', 'branches', 'company/branches', 'geofence', 'geofencing', 'attendance/geofencing', 'punch-zones'],
  keywords: ['branch', 'geofence', 'geofencing', 'punch zone', 'punch location', 'office', 'headquarters', 'location', 'map'],
})

// ── Master data ────────────────────────────────────────────────────────────
page('master', 'Master data overview', '/hrms/master', 'Master data', 'master', [{ anyOf: MASTER_ANY, module: HR }], { aliases: ['master/overview'] })
page('employees', 'Workforce Directory', '/hrms/employees', 'Master data', 'master/employees', [{ ...any('hrms.employee.read'), module: HR }], { aliases: ['employees', 'people', 'directory', 'master/directory', 'master/workforce-directory'], keywords: ['employee', 'staff', 'people', 'directory', 'employee master'] })
page('employee-import', 'Import employees', '/hrms/employees/import', 'Master data', 'master/import', [{ ...any('hrms.employee.import'), module: HR }], { keywords: ['bulk', 'csv', 'upload', 'excel'] })
page('organization', 'Organization Setup', '/hrms/organization', 'Master data', 'master/organization', [{ anyOf: ORG_SETUP, module: HR }], { aliases: ['master/org', 'organization'], keywords: ['org', 'structure'] })
page('m-companies', 'Companies', '/hrms/master/companies', 'Master data', 'master/companies', [{ anyOf: ORG_SETUP, allOf: ['org.company.read'], module: HR }])
page('m-branches', 'Branches', '/hrms/master/branches', 'Master data', 'master/branches', [{ anyOf: ORG_SETUP, allOf: ['org.company.read'], module: HR }])
page('m-departments', 'Departments', '/hrms/master/departments', 'Master data', 'master/departments', [{ anyOf: ORG_SETUP, allOf: ['hrms.department.read'], module: HR }], { aliases: ['departments'], keywords: ['department', 'team', 'division'] })
page('m-designations', 'Designations', '/hrms/master/designations', 'Master data', 'master/designations', [{ anyOf: ORG_SETUP, allOf: ['hrms.designation.read'], module: HR }], { aliases: ['designations'], keywords: ['job title', 'role', 'position'] })
page('m-grades', 'Grades', '/hrms/master/grades', 'Master data', 'master/grades', [{ anyOf: ORG_SETUP, module: HR }], { keywords: ['band', 'level'] })
page('m-contractors', 'Contractor Master', '/hrms/master/contractors', 'Master data', 'master/contractors', [{ ...any('hrms.contractor.read'), module: HR }], { keywords: ['agency', 'vendor', 'contract workers'] })
page('m-classifications', 'Employee classifications', '/hrms/master/classifications', 'Master data', 'master/classifications', [{ ...any('hrms.employee.read'), module: HR }], { keywords: ['employment type', 'permanent', 'contract', 'intern'] })
// Master data's rules and payroll configuration open inside HRMS settings (Master's tabs lead there).
page('m-shift-rules', 'Shift Rules', HUB_PAGES.shiftRules, 'HRMS settings', 'hr-setup/shift-rules', HUB_ACCESS.shiftRules, { aliases: ['master/shift-rules', 'master/rules'], keywords: ['shift policy', 'timings', 'grace'] })
page('m-leave-rules', 'Leave Rules', HUB_PAGES.leaveRules, 'HRMS settings', 'hr-setup/leave-rules', HUB_ACCESS.leaveRules, { aliases: ['master/leave-rules'], keywords: ['leave policy', 'leave types', 'quota', 'carry forward'] })
page('policies', 'Policies', '/hrms/policies', 'Master data', 'master/policies', [{ ...any('hrms.policy.read', 'hrms.policy.write', 'hrms.policy.acknowledge.self'), module: HR }], { aliases: ['policies', 'me/policies'], keywords: ['policy', 'handbook', 'acknowledge', 'code of conduct'] })
page('components', 'Salary components', HUB_PAGES.components, 'HRMS settings', 'hr-setup/salary-components', HUB_ACCESS.components, { aliases: ['master/salary-components', 'master/payroll-configuration', 'payroll/components'], keywords: ['earnings', 'deductions', 'basic', 'hra', 'allowance'] })
page('m-statutory', 'Statutory settings', HUB_PAGES.statutory, 'HRMS settings', 'hr-setup/statutory', HUB_ACCESS.statutory, { aliases: ['master/statutory'], keywords: ['pf', 'esi', 'pt', 'professional tax', 'lwf'] })

// ── Attendance & Time ──────────────────────────────────────────────────────
page('att-analytics', 'Attendance Analytics', '/hrms/att-analytics', 'Attendance & Time', 'attendance/analytics', [{ ...any('attendance.team.read'), module: HR }], { keywords: ['attendance report', 'trend', 'charts'] })
tab('att-analytics', 'overview', 'Attendance overview', 'tab=overview', 'attendance/overview')
tab('att-analytics', 'calendar', 'Attendance calendar', 'tab=calendar', 'attendance/calendar', [], { keywords: ['month', 'days'] })
page('att-daily', 'Daily Tracking', '/hrms/attendance', 'Attendance & Time', 'attendance/daily-tracking', [{ ...any('attendance.team.read', 'attendance.checkin.self'), module: HR }], { aliases: ['attendance/daily', 'attendance/tracking'], keywords: ['today', 'check-ins', 'punches'] })
tab('att-daily', 'team', 'Daily Logs', 'tab=team', 'attendance/daily-logs', [any('attendance.team.read')], { aliases: ['attendance/logs', 'attendance/today', 'attendance/roster-today'], keywords: ['who is in', 'present', 'late', 'absent', 'not marked'] })
tab('att-daily', 'face', 'Face Punch', 'tab=face', 'attendance/face-punch', [{ allOf: ['attendance.team.read', 'attendance.face.admin.read'] }], { aliases: ['attendance/face'], keywords: ['face', 'kiosk', 'selfie'] })
tab('att-daily', 'corrections', 'Regularization', 'tab=corrections', 'attendance/regularization', [], { aliases: ['attendance/corrections', 'attendance/fix', 'attendance/fixes'], keywords: ['regularize', 'regularise', 'correction', 'missed punch', 'fix'] })
tab('att-daily', 'review', 'Review', 'tab=review', 'attendance/review', [{ allOf: ['attendance.team.read', 'attendance.status.review'] }], { aliases: ['attendance/exceptions', 'attendance/status-review'], keywords: ['excuse', 'change status', 'late', 'half day', 'absent', 'no check-out', 'outside zone'] })
tab('att-daily', 'my', 'My Attendance', 'tab=my', 'attendance/my-attendance', [{ ...any('attendance.checkin.self'), when: notAdminRole }], { aliases: ['attendance/my', 'attendance/mine'] })
page('att-shifts', 'Shifts & Overtime', '/hrms/shifts', 'Attendance & Time', 'attendance/shifts', [{ ...any('attendance.team.read', 'attendance.checkin.self'), module: HR }], { aliases: ['attendance/shifts-overtime', 'shifts'], keywords: ['shift', 'overtime', 'ot', 'roster'] })
tab('att-shifts', 'schedules', 'Shift Schedules', 'tab=schedules', 'attendance/shift-schedules', [any('attendance.team.read')], { aliases: ['attendance/schedules'], keywords: ['shift timings', 'general shift', 'night shift'] })
tab('att-shifts', 'roster', 'Shift Roster', 'tab=roster', 'attendance/roster', [any('attendance.team.read')], { keywords: ['assign shift', 'change shift', 'who works when'] })
tab('att-shifts', 'overtime', 'Overtime', 'tab=overtime', 'attendance/overtime', [any('attendance.team.read')], { aliases: ['attendance/ot'], keywords: ['ot', 'extra hours'] })
tab('att-shifts', 'requests', 'Shift Requests', 'tab=requests', 'attendance/shift-requests', [any('attendance.team.read')], { keywords: ['shift change', 'swap'] })
tab('att-shifts', 'myshift', 'My Shift', 'tab=myshift', 'attendance/my-shift', [{ ...any('attendance.checkin.self'), noneOf: ['attendance.team.read'] }])
page('muster', 'Muster roll', '/hrms/muster-roll', 'Attendance & Time', 'attendance/muster-roll', [{ ...any('attendance.team.read', 'hrms.employee.read'), module: HR }], { aliases: ['compliance/muster-roll', 'muster-roll', 'muster'], keywords: ['register', 'muster'] })
page('manual-entry', 'Manual attendance entry', '/hrms/attendance/manual-entry', 'Attendance & Time', 'attendance/manual-entry', [{ ...any('attendance.workforce.admin'), module: HR }], { aliases: ['attendance/manual'], keywords: ['punch on behalf', 'backdate', 'manual punch'] })

// ── Leave ──────────────────────────────────────────────────────────────────
page('leave', 'Leave', '/hrms/leave', 'Leave', 'leave', [{ ...any('hrms.leave.read', 'hrms.ess.read', 'leave.request.self'), module: HR }], { keywords: ['time off', 'vacation', 'absence'] })
tab('leave', 'my', 'My leave requests', 'tab=my', 'leave/my-leave', [{ allOf: ['leave.request.self'], when: notAdminRole }], { aliases: ['leave/my'] })
tab('leave', 'apply', 'Apply for leave', 'tab=apply', 'leave/apply', [{ allOf: ['leave.request.self'], when: notAdminRole }], { keywords: ['request leave', 'time off'] })
tab('leave', 'balances', 'Leave balances', 'tab=balances', 'leave/balances', [{ allOf: ['leave.request.self'], when: notAdminRole }], { aliases: ['leave/balance'], keywords: ['remaining', 'quota', 'entitlement'] })
tab('leave', 'approvals', 'Leave approvals', 'tab=approvals', 'leave/approvals', [any('hrms.leave.approve.l1')], { aliases: ['leave/approve', 'leave/pending'], keywords: ['approve', 'pending', 'reject'] })
tab('leave', 'history', 'Decided leave requests', 'tab=history', 'leave/decided', [any('hrms.leave.approve.l1')], { aliases: ['leave/history'] })
tab('leave', 'encash', 'Leave encashment', 'tab=encash', 'leave/encash', [{ anyOf: ['hrms.leave.encash.approve', 'leave.request.self'] }], { keywords: ['encash', 'cash out leave'] })
tab('leave', 'yearend', 'Leave year end', 'tab=yearend', 'leave/year-end', [any('hrms.leave.yearend.run')], { keywords: ['carry forward', 'accrual', 'lapse'] })
tab('leave', 'calendar', 'Leave calendar', 'tab=calendar', 'leave/calendar', [], { keywords: ['who is off', 'out of office'] })
tab('leave', 'types', 'Leave types', 'tab=types', 'leave/types', [], { keywords: ['casual', 'sick', 'earned'] })
tab('leave', 'holidays', 'Holidays', 'tab=holidays', 'leave/holidays', [], { aliases: ['holidays'], keywords: ['holiday list', 'public holiday', 'festival'] })

// ── Recruitment & onboarding ───────────────────────────────────────────────
page('hiring', 'Hiring', '/hrms/hiring', 'Recruitment & Onboarding', 'hiring', [{ ...any('hrms.hiring.read', 'hrms.hiring.offer.read'), module: HR }], { keywords: ['recruit', 'candidate', 'applicant', 'job'] })
tab('hiring', 'pipeline', 'Hiring pipeline', 'tab=pipeline', 'hiring/pipeline', [any('hrms.hiring.read')], { aliases: ['hiring/candidates'], keywords: ['candidates', 'interview', 'stages'] })
tab('hiring', 'requisitions', 'Job requisitions', 'tab=requisitions', 'hiring/requisitions', [any('hrms.hiring.read')], { aliases: ['hiring/jobs', 'hiring/openings'], keywords: ['opening', 'vacancy', 'position'] })
tab('hiring', 'interviews', 'Interviews', 'tab=interviews', 'hiring/interviews', [any('hrms.hiring.read')], { keywords: ['interview schedule', 'scorecards', 'panel'] })
tab('hiring', 'offers', 'Job offers', 'tab=offers', 'hiring/offers', [any('hrms.hiring.offer.read')], { keywords: ['offer letter', 'ctc offer'] })
page('onboarding', 'Onboarding & Assets', '/hrms/onboarding/instances', 'Recruitment & Onboarding', 'onboarding', [{ ...any('hrms.onboarding.instance.read', 'hrms.onboarding.task.complete', 'hrms.onboarding.asset.read'), module: HR }], { keywords: ['joining', 'new joiner', 'checklist'] })
tab('onboarding', 'hires', 'New hires', 'view=hires', 'onboarding/new-hires', [{ ...any('hrms.onboarding.instance.read'), allOf: ['hrms.onboarding.instance.write'] }], { aliases: ['onboarding/hires'] })
tab('onboarding', 'assets', 'Assets', 'view=assets', 'onboarding/assets', [any('hrms.onboarding.asset.read', 'hrms.onboarding.instance.write')], { aliases: ['assets'], keywords: ['laptop', 'id card', 'equipment'] })
tab('onboarding', 'templates', 'Onboarding checklist templates', 'view=templates', 'onboarding/templates', [any('hrms.onboarding.template.read')], { aliases: ['onboarding/checklists'] })
page('documents', 'Documents', '/hrms/documents', 'Recruitment & Onboarding', 'documents', [{ ...any('hrms.document.read.self', 'hrms.document.read', 'hrms.document.write', 'hrms.letters.template.read'), module: HR }], { aliases: ['documents/vault'], keywords: ['document', 'file', 'vault', 'contract'] })
tab('documents', 'all', 'Employee documents', 'view=all', 'documents/employee-documents', [any('hrms.document.read')], { aliases: ['documents/all', 'documents/employees'], keywords: ['employee vault', 'id proofs'] })
page('docs-review', 'Documents to review', '/hrms/documents/pending', 'Recruitment & Onboarding', 'documents/to-review', [{ ...any('hrms.document.verify'), module: HR }], { aliases: ['documents/pending', 'documents/review', 'documents/verify'], keywords: ['verify', 'approve documents', 'pending documents'] })
page('letters', 'Letters', '/hrms/letters', 'Recruitment & Onboarding', 'letters', [{ ...any('hrms.letters.template.read', 'hrms.letters.read', 'hrms.letters.distribute'), module: HR }], { keywords: ['letter', 'offer letter', 'appointment letter'] })
page('letter-templates', 'Letter templates', '/hrms/letters/templates', 'Recruitment & Onboarding', 'letters/templates', [{ ...any('hrms.letters.template.read'), module: HR }], { aliases: ['documents/letter-templates'], keywords: ['template', 'merge fields'] })
page('letters-generated', 'Generated letters', '/hrms/letters/generated', 'Recruitment & Onboarding', 'letters/generated', [{ ...any('hrms.letters.read'), module: HR }], { aliases: ['letters/issued'], keywords: ['offer letter', 'experience letter', 'relieving letter', 'issue letter'] })
page('letters-distributions', 'Letter distributions', '/hrms/letters/distributions', 'Recruitment & Onboarding', 'letters/distributions', [{ ...any('hrms.letters.distribute', 'hrms.letters.read'), module: HR }], { aliases: ['letters/bulk'], keywords: ['bulk letters', 'send letters'] })

// ── Payroll ────────────────────────────────────────────────────────────────
page('pay-dashboard', 'Payroll dashboard', '/hrms/payroll-dashboard', 'Payroll', 'payroll/dashboard', [{ ...any('payroll.runs.read'), module: PAY }], { keywords: ['payroll cost', 'this month', 'dues'] })
page('pay-salary', 'Salary structure', '/hrms/salary-structure', 'Payroll', 'payroll/salary-structure', [{ ...any('payroll.runs.read'), module: PAY }], { aliases: ['payroll/salary', 'payroll/ctc', 'payroll/structures'], keywords: ['ctc', 'revision', 'salary'] })
page('pay-runs', 'Processing & Payslips', '/hrms/payroll/runs', 'Payroll', 'payroll/runs', [{ ...any('payroll.runs.read'), module: PAY }], { aliases: ['payroll/processing', 'payroll/payslips', 'payroll/run'], keywords: ['payroll run', 'process', 'payslips', 'lock'] })
// Payroll settings open inside HRMS settings (the Payroll section bar's tab leads there).
page('pay-settings', 'Payroll settings', HUB_PAGES.payroll, 'HRMS settings', 'payroll/settings', HUB_ACCESS.payroll, { aliases: ['hr-setup/payroll'], keywords: ['pf', 'esi', 'pt', 'cycle'] })
page('pay-pli', 'Production-Linked Incentive', '/hrms/pli', 'Payroll', 'payroll/pli', [{ ...any('hrms.pli.read', 'hrms.pli.target.read'), module: PAY }], { aliases: ['payroll/incentives', 'pli'], keywords: ['pli', 'bonus', 'targets', 'incentive'] })
page('pay-advances', 'Advances & Loans', '/hrms/advances', 'Payroll', 'payroll/advances', [{ ...any('hrms.advance.request.self', 'hrms.advance.read', 'hrms.advance.approve', 'hrms.advance.disburse'), module: HR }], { aliases: ['payroll/loans', 'advances', 'loans'], keywords: ['advance', 'loan', 'emi', 'recovery'] })
page('pay-bank', 'Bank disbursement', '/hrms/bank-disbursement', 'Payroll', 'payroll/bank', [{ ...any('payroll.runs.read'), module: PAY }], { aliases: ['payroll/bank-disbursement', 'payroll/disbursement'], keywords: ['bank file', 'neft', 'transfer', 'utr'] })
page('pay-bank-setup', 'Bank profiles', '/hrms/bank-disbursement/setup', 'Payroll', 'payroll/bank-profiles', [{ ...any('payroll.runs.read'), module: PAY }], { keywords: ['bank account', 'debit account'] })

// ── Expenses ───────────────────────────────────────────────────────────────
page('expenses', 'Expense Center', '/hrms/expenses', 'Expense Management', 'expenses', [{ ...any('hrms.expense.claim.self', 'hrms.expense.claim.read', 'hrms.expense.claim.approve', 'hrms.expense.policy.read', 'hrms.expense.reimbursement', 'hrms.reimb_batch.read'), module: HR }], { keywords: ['expense', 'claim', 'reimbursement', 'travel'] })
tab('expenses', 'approvals', 'Expense approvals', 'tab=approvals', 'expenses/approvals', [any('hrms.expense.claim.approve', 'hrms.expense.reimbursement')], { keywords: ['approve claims', 'pending claims'] })
tab('expenses', 'submit', 'Submit an expense claim', 'tab=submit', 'expenses/submit', [any('hrms.expense.claim.self')], { aliases: ['expenses/new'], keywords: ['new claim', 'receipt'] })
tab('expenses', 'my', 'My claims', 'tab=my', 'expenses/my-claims', [any('hrms.expense.claim.self')], { aliases: ['expenses/my'] })
tab('expenses', 'batches', 'Reimbursement batches', 'tab=batches', 'expenses/batches', [any('hrms.reimb_batch.read')], { keywords: ['payout', 'batch'] })
// Expense policies open inside HRMS settings (the Expenses page's Policies tab leads there).
page('expense-policies', 'Expense policies', HUB_PAGES.expensePolicies, 'HRMS settings', 'hr-setup/expense-policies', HUB_ACCESS.expensePolicies, { aliases: ['expenses/policies'], keywords: ['limits', 'rules', 'claim limit'] })

// ── Performance & learning ─────────────────────────────────────────────────
page('performance', 'Performance', '/hrms/performance', 'Performance & Learning', 'performance', [{ ...any('hrms.performance.read', 'hrms.performance.write', 'hrms.performance.review.self'), module: HR }], { keywords: ['appraisal', 'review', 'kpi', 'goals'] })
tab('performance', 'cycles', 'Review cycles', 'view=cycles', 'performance/cycles', [any('hrms.performance.read')], { keywords: ['appraisal cycle'] })
tab('performance', 'reviews', 'Employee reviews', 'view=reviews', 'performance/reviews', [any('hrms.performance.read')])
tab('performance', 'kpis', 'Goals & KPIs', 'view=kpis', 'performance/kpis', [any('hrms.performance.read')], { aliases: ['performance/goals', 'kpis'], keywords: ['objectives', 'targets', 'kpi'] })
tab('performance', 'people', 'Performance by person', 'view=people', 'performance/people', [any('hrms.performance.read')], { keywords: ['employee performance', 'ratings'] })
tab('performance', 'my-reviews', 'My reviews', 'view=my-reviews', 'performance/my-reviews', [any('hrms.performance.review.self')])
tab('performance', 'my-goals', 'My goals', 'view=my-goals', 'performance/my-goals', [any('hrms.performance.review.self')])
page('learning', 'Learning & Skills', '/hrms/learning', 'Performance & Learning', 'learning', [{ ...any('hrms.learning.read', 'hrms.learning.write', 'hrms.learning.enroll.self', 'hrms.learning.skill.read'), module: HR }], { keywords: ['training', 'course', 'skills'] })
tab('learning', 'programs', 'Training programs', 'view=programs', 'learning/programs', [any('hrms.learning.read')], { aliases: ['learning/courses'] })
tab('learning', 'my', 'My training', 'view=my', 'learning/my-training', [any('hrms.learning.enroll.self')], { aliases: ['learning/my'] })
tab('learning', 'skills', 'Skill matrix', 'view=skills', 'learning/skills', [any('hrms.learning.skill.read')], { aliases: ['learning/skill-matrix'] })
tab('learning', 'approvals', 'Skill approvals', 'view=approvals', 'learning/skill-approvals', [any('hrms.learning.skill.approve')], { keywords: ['skill level', 'self assessment'] })
tab('learning', 'certifications', 'Certifications', 'view=certifications', 'learning/certifications', [any('hrms.learning.skill.read')])

// ── Compliance ─────────────────────────────────────────────────────────────
page('compliance', 'Statutory Compliance', '/hrms/compliance', 'Compliance', 'compliance', [{ ...any('hrms.compliance.read', 'hrms.compliance.write', 'hrms.compliance.posh', 'hrms.compliance.inspector.read'), module: HR }], { keywords: ['statutory', 'filings', 'deadline'] })
tab('compliance', 'calendar', 'Compliance calendar', 'view=calendar', 'compliance/calendar', [any('hrms.compliance.read')], { keywords: ['due dates'] })
tab('compliance', 'filings', 'Statutory filings', 'view=filings', 'compliance/filings', [any('hrms.compliance.read')], { keywords: ['pf return', 'esi return', 'challan'] })
tab('compliance', 'posh', 'POSH register', 'view=posh', 'compliance/posh', [any('hrms.compliance.posh')], { keywords: ['harassment', 'icc', 'complaint'] })
tab('compliance', 'inspector', 'Inspector access', 'view=inspector', 'compliance/inspector', [any('hrms.compliance.read', 'hrms.compliance.inspector.read')], { keywords: ['labour inspector', 'share link'] })

// ── Reports & analytics ────────────────────────────────────────────────────
page('reports', 'Reports Center', '/hrms/reports', 'Reports & Analytics', 'reports', [{ anyOf: REPORTS, module: HR }], { keywords: ['report', 'export', 'csv', 'download'] })
page('workforce-analytics', 'Workforce Analytics', '/hrms/workforce-analytics', 'Reports & Analytics', 'reports/workforce-analytics', [{ ...any('hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.diversity'), module: HR }], { aliases: ['analytics', 'reports/analytics'], keywords: ['headcount trend', 'charts', 'insights'] })
page('r-headcount', 'Headcount report', '/hrms/reports/headcount', 'Reports & Analytics', 'reports/headcount', [{ ...any('hrms.report.headcount'), module: HR }], { keywords: ['employees by department'] })
page('r-attrition', 'Attrition report', '/hrms/reports/attrition', 'Reports & Analytics', 'reports/attrition', [{ ...any('hrms.report.attrition'), module: HR }], { keywords: ['exits', 'turnover'] })
page('r-attendance', 'Attendance summary report', '/hrms/reports/attendance-summary', 'Reports & Analytics', 'reports/attendance-summary', [{ ...any('hrms.report.attendance'), module: HR }], { aliases: ['reports/attendance'] })
page('r-leave', 'Leave balance report', '/hrms/reports/leave-balance', 'Reports & Analytics', 'reports/leave-balance', [{ ...any('hrms.report.leave'), module: HR }], { aliases: ['reports/leave'] })
page('r-late', 'Late marks report', '/hrms/reports/late-marks', 'Reports & Analytics', 'reports/late-marks', [{ ...any('hrms.report.attendance'), module: HR }], { aliases: ['reports/late'], keywords: ['late coming'] })
page('r-diversity', 'Diversity report', '/hrms/reports/diversity', 'Reports & Analytics', 'reports/diversity', [{ ...any('hrms.report.diversity'), module: HR }], { keywords: ['gender', 'age'] })

// ── Employee exit ──────────────────────────────────────────────────────────
page('exit', 'Resignation & Exit', '/hrms/exit', 'Employee Exit', 'exit', [{ ...any('hrms.employee.write'), module: HR }], { aliases: ['exit/resignations', 'resignations'], keywords: ['resignation', 'notice period', 'leaver', 'offboarding'] })
page('fnf', 'Full & Final Settlement', '/hrms/fnf', 'Employee Exit', 'exit/full-and-final', [{ ...any('hrms.fnf.read', 'hrms.fnf.process', 'hrms.fnf.approve'), module: PAY }], { aliases: ['exit/fnf', 'fnf', 'full-and-final'], keywords: ['fnf', 'settlement', 'final pay'] })
tab('fnf', 'pending-approval', 'Settlements pending approval', 'tab=pending-approval', 'exit/fnf-pending-approval', [any('hrms.fnf.read')])
tab('fnf', 'pending-payment', 'Settlements pending payment', 'tab=pending-payment', 'exit/fnf-pending-payment', [any('hrms.fnf.read')])
tab('fnf', 'settled', 'Settled settlements', 'tab=settled', 'exit/fnf-settled', [any('hrms.fnf.read')])
tab('fnf', 'create', 'Create a settlement', 'tab=create', 'exit/fnf-create', [any('hrms.fnf.process')], { keywords: ['new settlement'] })

// ── HRMS settings (one hub: shared/navigation/hrmsSettings.ts) ─────────────
page('hrms-settings', 'HRMS settings', HUB_PAGES.overview, 'HRMS settings', 'hr-setup', [{ module: HR, when: canOpenHrmsSettings }], { aliases: ['hrms-settings', 'hr-settings'], keywords: ['settings', 'hr settings', 'configuration', 'setup', 'hr setup'] })
page('hr-config', 'HR Configuration', HUB_PAGES.hrConfig, 'HRMS settings', 'hr-setup/configuration', HUB_ACCESS.hrConfig, { aliases: ['hr-setup/hr-configuration', 'hr-config', 'hr-setup/work-time'], keywords: ['probation', 'notice period', 'work week', 'employee id format', 'fiscal year', 'late arrival', 'grace'] })
page('notif-templates', 'Notification templates', HUB_PAGES.notifications, 'HRMS settings', 'hr-setup/notification-templates', HUB_ACCESS.notifications, { aliases: ['hr-setup/templates', 'hr-setup/notifications'], keywords: ['email template', 'message', 'hr notifications'] })
page('s-documents', 'Document types', HUB_PAGES.documentTypes, 'HRMS settings', 'hr-setup/document-types', HUB_ACCESS.documentTypes, { aliases: ['settings/documents', 'settings/document-types'], keywords: ['aadhaar', 'pan', 'required documents'] })
page('roles', 'Roles & Permissions', HUB_PAGES.roles, 'HRMS settings', 'hr-setup/roles', HUB_ACCESS.roles, { aliases: ['roles', 'permissions', 'settings/roles'], keywords: ['role', 'permission', 'rbac', 'access'] })
tab('roles', 'assignments', 'HRMS access', 'view=assignments', 'hr-setup/hrms-access', [], { aliases: ['settings/role-assignments', 'hr-setup/role-assignments'], keywords: ['who has which role', 'role assignments', 'who can use hrms', 'grant role'] })
tab('roles', 'catalogue', 'Permission catalogue', 'view=catalogue', 'hr-setup/permissions', [], { aliases: ['settings/permissions'], keywords: ['all permissions'] })
page('m-policies', 'Policy documents', HUB_PAGES.policies, 'HRMS settings', 'hr-setup/policy-documents', HUB_ACCESS.policies, { aliases: ['master/policy-documents'], keywords: ['policy', 'handbook', 'publish policy', 'acknowledgements'] })

// ── Workspace settings ─────────────────────────────────────────────────────
// The same rule as the /settings/:tab route.
page('s-profile', 'Workspace profile', '/settings/profile', 'Workspace settings', 'settings/workspace-profile', [{ anyOf: [...SETTINGS, 'settings.branding.write', 'workspace.profile.update', 'workspace.security.manage'] }], { keywords: ['company name', 'organisation', 'gstin', 'pan', 'address', 'contact'] })
page('s-branding', 'Branding', '/settings/branding', 'Workspace settings', 'settings/branding', [any('settings.branding.write')], { keywords: ['logo', 'brand'] })
page('s-security', 'Security', '/settings/security', 'Workspace settings', 'settings/security', [], { keywords: ['password reset', 'two-factor', 'sessions', '2fa', 'authenticator', 'sign out'] })
page('s-notifications', 'Notification settings', '/settings/notifications', 'Workspace settings', 'settings/notifications', [{ anyOf: SETTINGS }], { keywords: ['email', 'alerts'] })
page('s-billing', 'Billing & Plan', '/settings/billing', 'Workspace settings', 'settings/billing', [{ allOf: ['workspace.billing.manage'], when: planAdminOnly }], { aliases: ['billing'], keywords: ['invoice', 'plan', 'seats', 'subscription'] })
page('s-integrations', 'Integrations', '/settings/integrations', 'Workspace settings', 'settings/integrations', [{ anyOf: SETTINGS }])
page('hr-integrations', 'Integration register', '/settings/integrations/register', 'Workspace settings', 'settings/integration-register', [{ ...any('hrms.integration.read', 'hrms.integration.write'), module: HR }], { aliases: ['hr-setup/integrations'], keywords: ['biometric', 'connect', 'hr integrations'] })
page('s-danger', 'Danger zone', '/settings/danger', 'Workspace settings', 'settings/danger-zone', [any('workspace.data.export', 'workspace.lifecycle.manage')], { aliases: ['settings/danger'], keywords: ['delete workspace', 'export all data', 'reset'] })
page('users', 'Users & Access', '/users', 'Workspace settings', 'settings/users', [any('workspace.users.read')], { aliases: ['users'], keywords: ['invite', 'user', 'login', 'access'] })
page('audit', 'Audit logs', '/audit-logs', 'Workspace settings', 'settings/audit-logs', [any('audit.read')], { aliases: ['audit', 'audit-logs'], keywords: ['history', 'who did what', 'trail', 'security'] })

// ── Apps that aren't built yet: plan admins only (they keep the request-module flow) ──
const SOON: [string, string, string, string][] = [
  ['crm', 'CRM', '/crm', 'crm'], ['accounting', 'Accounts', '/accounts', 'accounting'], ['projects', 'Projects', '/projects', 'projects'],
  ['inventory', 'Inventory', '/inventory', 'inventory'], ['purchase', 'Purchase', '/procurement', 'purchase'], ['sales', 'Sales', '/sales', 'sales'],
  ['manufacturing', 'Manufacturing', '/manufacturing', 'manufacturing'], ['pos', 'Point of Sale', '/pos', 'pos'], ['reports-bi', 'Reports & BI', '/reports', 'reports-bi'],
]
for (const [id, label, path, slug] of SOON) page(`soon-${id}`, label, path, 'Apps · coming soon', `apps/${slug}`, [{ when: planAdminOnly }], { comingSoon: true, icon: 'grid' })

export const PAGE_REGISTRY: readonly PageEntry[] = entries

/* ── Menu rules ──────────────────────────────────────────────────────────────
 * The shell's menu (PlatformShell) shows a link only when its rule passes.
 * Keys are "<rail group>:<path>" for links whose menu audience is narrower
 * than the route (e.g. Daily Tracking under Attendance & Time is the team
 * view; under Me it is your own attendance), else just the path. Anything not
 * listed uses the registry entry for the same path. */
const DASHBOARD_MENU: Access[] = [{ anyOf: ['hrms.employee.read', 'attendance.team.read', 'org.company.write', 'payroll.runs.read', ...REPORTS] }]
export const MENU_RULES: Record<string, Access[]> = {
  '/dashboard': DASHBOARD_MENU,
  'ess:/hrms/attendance': [{ ...any('attendance.checkin.self'), module: HR, self: true }],
  'ess:/hrms/leave': [{ ...any('leave.request.self'), module: HR, self: true }],
  'attendance:/hrms/attendance': [{ ...any('attendance.team.read'), module: HR }],
  'attendance:/hrms/shifts': [{ ...any('attendance.team.read'), module: HR }],
  'leave:/hrms/leave': [{ anyOf: ['hrms.leave.approve.l1', 'settings.holidays.write', 'leave.type.write', 'hrms.report.leave'], module: HR }],
  'recruit:/hrms/onboarding/instances': [{ ...any('hrms.onboarding.instance.write', 'hrms.onboarding.asset.read', 'hrms.onboarding.template.read'), module: HR }],
  'recruit:/hrms/documents': [{ ...any('hrms.document.read', 'hrms.letters.template.read'), module: HR }],
  'payroll-hr:/hrms/pli': [{ ...any('hrms.pli.read', 'hrms.pli.target.read'), module: PAY }],
  '/profile': [],
  // The Settings app's own entry (PlatformShell's platform items).
  '/settings': [{ anyOf: SETTINGS }],
}

/** The rule for a menu link; undefined when neither the menu rules nor the registry know the path. */
export function menuRule(path: string, group?: string): Access[] | undefined {
  if (group && MENU_RULES[`${group}:${path}`]) return MENU_RULES[`${group}:${path}`]
  if (MENU_RULES[path]) return MENU_RULES[path]
  // A "My …" entry can share its route with the admin page (My letters vs Generated letters);
  // the menu link is the admin page unless the route is self-service only.
  const hits = PAGE_REGISTRY.filter((e) => !e.parent && e.path === path)
  return (hits.find((e) => !e.id.startsWith('me-')) ?? hits[0])?.access
}

export interface VisibleEntry extends PageEntry { state: Exclude<AccessState, 'hidden'> }

/** Every page and tab this person may see, in registry order. Locked ones are only returned to plan admins. */
export function visibleEntries(ctx: AccessContext): VisibleEntry[] {
  const out: VisibleEntry[] = []
  for (const e of PAGE_REGISTRY) {
    const state = accessState(e.access, ctx)
    if (state === 'hidden') continue
    out.push({ ...e, state })
  }
  return out
}

/** The first page of an area that this person can open — used for "/attendance" and the launcher. */
export function firstOpenIn(moduleKey: string, visible: readonly VisibleEntry[]): VisibleEntry | undefined {
  return visible.find((e) => e.state === 'open' && !e.parent && e.slash.split('/')[0] === moduleKey)
    ?? visible.find((e) => e.state === 'open' && e.slash.split('/')[0] === moduleKey)
}
