/**
 * Typed constants for all 97 permission codes used across UnifiedTree modules.
 * Import as: import { P } from '@unifiedtree/sdk'
 */
export const P = {
  // ── HRMS: Employee ─────────────────────────────────────────────────────────
  HRMS_EMPLOYEE_READ:              'hrms.employee.read',
  HRMS_EMPLOYEE_WRITE:             'hrms.employee.write',
  HRMS_EMPLOYEE_DELETE:            'hrms.employee.delete',
  HRMS_EMPLOYEE_PROFILE_READ:      'hrms.employee.profile.read',
  HRMS_EMPLOYEE_PROFILE_WRITE:     'hrms.employee.profile.write',
  HRMS_EMPLOYEE_IDENTITY_READ:     'hrms.employee.identity.read',
  HRMS_EMPLOYEE_IDENTITY_WRITE:    'hrms.employee.identity.write',
  HRMS_EMPLOYEE_BANK_READ:         'hrms.employee.bank.read',
  HRMS_EMPLOYEE_BANK_WRITE:        'hrms.employee.bank.write',
  HRMS_EMPLOYEE_DOCUMENT_READ:     'hrms.employee.document.read',
  HRMS_EMPLOYEE_DOCUMENT_UPLOAD:   'hrms.employee.document.upload',
  HRMS_EMPLOYEE_IMPORT:            'hrms.employee.import',
  HRMS_EMPLOYEE_INVITE:            'hrms.employee.invite',

  // ── HRMS: Probation ───────────────────────────────────────────────────────
  HRMS_PROBATION_CONFIG_READ:      'hrms.probation.config.read',
  HRMS_PROBATION_CONFIG_UPDATE:    'hrms.probation.config.update',
  HRMS_PROBATION_REMINDERS_READ:   'hrms.probation.reminders.read',

  // ── Payroll (config foundation) ───────────────────────────────────────────
  PAYROLL_SETTINGS_READ:           'payroll.settings.read',
  PAYROLL_SETTINGS_UPDATE:         'payroll.settings.update',
  PAYROLL_COMPONENTS_READ:         'payroll.components.read',
  PAYROLL_COMPONENTS_MANAGE:       'payroll.components.manage',
  PAYROLL_STRUCTURE_READ:          'payroll.structure.read',
  PAYROLL_STRUCTURE_READ_SELF:     'payroll.structure.read.self',
  PAYROLL_STRUCTURE_MANAGE:        'payroll.structure.manage',
  PAYROLL_RUNS_READ:               'payroll.runs.read',
  PAYROLL_RUNS_MANAGE:             'payroll.runs.manage',
  PAYROLL_RUNS_LOCK:               'payroll.runs.lock',
  PAYROLL_PAYSLIP_READ_SELF:       'payroll.payslip.read.self',
  PAYROLL_PT_SLABS_READ:           'payroll.pt_slabs.read',

  // ── HRMS: Org ──────────────────────────────────────────────────────────────
  HRMS_DEPARTMENT_READ:            'hrms.department.read',
  HRMS_DEPARTMENT_WRITE:           'hrms.department.write',
  HRMS_DESIGNATION_READ:           'hrms.designation.read',
  HRMS_DESIGNATION_WRITE:          'hrms.designation.write',
  HRMS_CONTRACTOR_READ:            'hrms.contractor.read',
  HRMS_CONTRACTOR_WRITE:           'hrms.contractor.write',
  HRMS_CLASSIFICATION_READ:        'hrms.classification.read',
  HRMS_CLASSIFICATION_WRITE:       'hrms.classification.write',
  HRMS_BRANCH_READ:                'hrms.branch.read',
  HRMS_BRANCH_WRITE:               'hrms.branch.write',
  HRMS_GRADE_WRITE:                'hrms.grade.write',
  HRMS_EMPLOYMENT_TYPE_WRITE:      'hrms.employment-type.write',
  HRMS_SHIFT_WRITE:                'hrms.shift.write',

  // ── HRMS: Onboarding ──────────────────────────────────────────────────────
  HRMS_ONBOARDING_TEMPLATE_READ:   'hrms.onboarding.template.read',
  HRMS_ONBOARDING_TEMPLATE_WRITE:  'hrms.onboarding.template.write',
  HRMS_ONBOARDING_INSTANCE_READ:   'hrms.onboarding.instance.read',
  HRMS_ONBOARDING_INSTANCE_WRITE:  'hrms.onboarding.instance.write',
  HRMS_ONBOARDING_TASK_COMPLETE:   'hrms.onboarding.task.complete',

  // ── HRMS: Letters ─────────────────────────────────────────────────────────
  HRMS_LETTERS_TEMPLATE_READ:   'hrms.letters.template.read',
  HRMS_LETTERS_TEMPLATE_CREATE: 'hrms.letters.template.create',
  HRMS_LETTERS_TEMPLATE_UPDATE: 'hrms.letters.template.update',
  HRMS_LETTERS_TEMPLATE_DELETE: 'hrms.letters.template.delete',
  HRMS_LETTERS_GENERATE:        'hrms.letters.generate',
  HRMS_LETTERS_READ:            'hrms.letters.read',
  HRMS_LETTERS_READ_SELF:       'hrms.letters.read.self',
  HRMS_LETTERS_SEND:            'hrms.letters.send',
  HRMS_LETTERS_VOID:            'hrms.letters.void',
  HRMS_LETTERS_DISTRIBUTE:      'hrms.letters.distribute',

  // ── HRMS: Leave ───────────────────────────────────────────────────────────
  HRMS_LEAVE_APPROVE_L1:           'hrms.leave.approve.l1',
  HRMS_LEAVE_APPROVE_L2:           'hrms.leave.approve.l2',
  HRMS_LEAVE_READ:                 'hrms.leave.read',
  HRMS_LEAVE_WRITE:                'hrms.leave.write',

  // ── HRMS: Payroll ─────────────────────────────────────────────────────────
  HRMS_PAYROLL_READ:               'hrms.payroll.read',
  HRMS_PAYROLL_WRITE:              'hrms.payroll.write',
  HRMS_PAYROLL_PROCESS:            'hrms.payroll.process',

  // ── HRMS: ESS ─────────────────────────────────────────────────────────────
  HRMS_ESS_READ:                   'hrms.ess.read',
  HRMS_ESS_WRITE:                  'hrms.ess.write',

  // ── HRMS: Reports ────────────────────────────────────────────────────────
  HRMS_ATTENDANCE_REPORT:          'hrms.attendance.report',
  HRMS_REPORT_HEADCOUNT:           'hrms.report.headcount',
  HRMS_REPORT_ATTRITION:           'hrms.report.attrition',
  HRMS_REPORT_ATTENDANCE:          'hrms.report.attendance',
  HRMS_REPORT_LEAVE:               'hrms.report.leave',
  HRMS_REPORT_DIVERSITY:           'hrms.report.diversity',

  // ── Attendance ────────────────────────────────────────────────────────────
  ATTENDANCE_CHECKIN_SELF:         'attendance.checkin.self',
  ATTENDANCE_CHECKIN_FACE:         'attendance.checkin.face',
  ATTENDANCE_REGULARIZATION_APPROVE: 'attendance.regularization.approve',
  ATTENDANCE_TEAM_READ:            'attendance.team.read',

  // ── Leave ─────────────────────────────────────────────────────────────────
  LEAVE_BALANCE_READ:              'leave.balance.read',
  LEAVE_REQUEST_SELF:              'leave.request.self',
  LEAVE_REQUEST_APPROVE:           'leave.request.approve',
  LEAVE_TYPE_WRITE:                'leave.type.write',

  // ── Org ───────────────────────────────────────────────────────────────────
  ORG_COMPANY_READ:                'org.company.read',
  ORG_COMPANY_WRITE:               'org.company.write',
  ORG_GEOFENCE_WRITE:              'org.geofence.write',

  // ── Branch ───────────────────────────────────────────────────────────────
  BRANCH_READ:                     'branch.read',
  BRANCH_WRITE:                    'branch.write',
  BRANCH_MANAGE:                   'branch.manage',

  // ── Department ───────────────────────────────────────────────────────────
  DEPARTMENT_READ:                 'department.read',
  DEPARTMENT_WRITE:                'department.write',

  // ── RBAC ─────────────────────────────────────────────────────────────────
  RBAC_ROLE_READ:                  'rbac.role.read',
  RBAC_ROLE_WRITE:                 'rbac.role.write',
  RBAC_PERMISSION_MANAGE:          'rbac.permission.manage',

  // ── Audit ─────────────────────────────────────────────────────────────────
  AUDIT_READ:                      'audit.read',
  AUDIT_EXPORT:                    'audit.export',

  // ── Settings ─────────────────────────────────────────────────────────────
  SETTINGS_READ:                   'settings.read',
  SETTINGS_WRITE:                  'settings.write',
  SETTINGS_HOLIDAYS_WRITE:         'settings.holidays.write',
  SETTINGS_HRCONFIG_WRITE:         'settings.hrconfig.write',

  // ── Notification ─────────────────────────────────────────────────────────
  NOTIFICATION_READ:               'notification.read',
  NOTIFICATION_MANAGE:             'notification.manage',

  // ── Platform ─────────────────────────────────────────────────────────────
  PLATFORM_ADMIN:                  'platform.admin',
  PLATFORM_TENANT_READ:            'platform.tenant.read',
  PLATFORM_TENANT_WRITE:           'platform.tenant.write',
  PLATFORM_TENANT_APPROVE:         'platform.tenant.approve',
  PLATFORM_TENANT_REJECT:          'platform.tenant.reject',
  PLATFORM_USER_READ:              'platform.user.read',
  PLATFORM_USER_WRITE:             'platform.user.write',
  PLATFORM_MODULE_MANAGE:          'platform.module.manage',
  PLATFORM_BILLING_READ:           'platform.billing.read',

  // ── Workspace (Users & Access) ───────────────────────────────────────────
  WORKSPACE_USERS_READ:            'workspace.users.read',
  WORKSPACE_USERS_MANAGE:          'workspace.users.manage',

  // ── Tenant ────────────────────────────────────────────────────────────────
  TENANT_USER_INVITE:              'tenant.user.invite',
  TENANT_USER_SUSPEND:             'tenant.user.suspend',
  TENANT_USER_DELETE:              'tenant.user.delete',
  TENANT_BILLING_READ:             'tenant.billing.read',
  TENANT_BILLING_WRITE:            'tenant.billing.write',
  TENANT_MODULE_ACTIVATE:          'tenant.module.activate',
  TENANT_SETTINGS_READ:            'tenant.settings.read',
  TENANT_SETTINGS_WRITE:           'tenant.settings.write',

  // ── CRM ───────────────────────────────────────────────────────────────────
  CRM_LEAD_READ:                   'crm.lead.read',
  CRM_LEAD_WRITE:                  'crm.lead.write',
  CRM_CUSTOMER_READ:               'crm.customer.read',
  CRM_CUSTOMER_WRITE:              'crm.customer.write',
  CRM_DEAL_READ:                   'crm.deal.read',
  CRM_DEAL_WRITE:                  'crm.deal.write',

  // ── Accounts ─────────────────────────────────────────────────────────────
  ACCOUNTS_INVOICE_READ:           'accounts.invoice.read',
  ACCOUNTS_INVOICE_WRITE:          'accounts.invoice.write',
  ACCOUNTS_PAYMENT_READ:           'accounts.payment.read',
  ACCOUNTS_PAYMENT_WRITE:          'accounts.payment.write',
  ACCOUNTS_EXPENSE_READ:           'accounts.expense.read',
  ACCOUNTS_EXPENSE_WRITE:          'accounts.expense.write',

  // ── Projects ─────────────────────────────────────────────────────────────
  PROJECTS_READ:                   'projects.read',
  PROJECTS_WRITE:                  'projects.write',

  // ── Helpdesk ─────────────────────────────────────────────────────────────
  HELPDESK_TICKET_READ:            'helpdesk.ticket.read',
  HELPDESK_TICKET_WRITE:           'helpdesk.ticket.write',

  // ── Inventory ────────────────────────────────────────────────────────────
  INVENTORY_READ:                  'inventory.read',
  INVENTORY_WRITE:                 'inventory.write',

  // ── Procurement ──────────────────────────────────────────────────────────
  PROCUREMENT_READ:                'procurement.read',
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];
