// Permission code lists the shell and its menu rules read, in one place (the /team guard, Home, the
// team blocks). New codes come from the SDK's P constants (packages/sdk/src/permissions/codes.ts).
import { P } from '@unifiedtree/sdk'

/** Approving submitted timesheet weeks (the redesign's new permission; harmless before its migration). */
export const TIMESHEET_APPROVE: string = P.HRMS_TIMESHEET_APPROVE

/** The approve permissions that open My team › Approvals (the /team route guard adds them to today's codes). */
export const TEAM_APPROVE_CODES = [
  'hrms.leave.approve.l1',
  'wfh.approve',
  'attendance.regularization.approve',
  'hrms.expense.claim.approve',
  TIMESHEET_APPROVE,
] as const

/** Company-wide reads that give a person the admin dashboard as their Home (DECISIONS 12). */
export const ADMIN_HOME_CODES = [
  'hrms.employee.read',
  'payroll.runs.read',
  'org.company.write',
  'hrms.report.headcount',
  'hrms.report.attrition',
  'hrms.report.attendance',
  'hrms.report.leave',
  'hrms.report.diversity',
] as const

/** Team permissions behind Home's team blocks and the My team group (today's /team rule, with none of `hrms.employee.read`). */
export const TEAM_READ_CODES = ['attendance.team.read', 'hrms.leave.approve.l1'] as const
