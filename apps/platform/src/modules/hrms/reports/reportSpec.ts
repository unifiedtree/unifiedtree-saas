import { P } from '@unifiedtree/sdk'

// Each report's server CSV and PDF routes and the permission they check,
// transcribed from ReportController.java / ReportExportController.java. The
// backend has one export route per report (not a generic /{type}/export)
// because each JSON report is guarded by its own permission; this mapping keeps
// the Export button no wider than the endpoint behind it.
export type ReportKey =
  | 'headcount' | 'attrition' | 'attendance-summary'
  | 'leave-balance' | 'late-marks' | 'diversity'

export const EXPORT_SPEC: Record<ReportKey, { path: string; pdf: string; permission: string }> = {
  'headcount':          { path: '/v1/reports/headcount/export.csv',          pdf: '/v1/reports/headcount/export.pdf',          permission: P.HRMS_REPORT_HEADCOUNT },
  'attrition':          { path: '/v1/reports/attrition/export.csv',          pdf: '/v1/reports/attrition/export.pdf',          permission: P.HRMS_REPORT_ATTRITION },
  'attendance-summary': { path: '/v1/reports/attendance-summary/export.csv', pdf: '/v1/reports/attendance-summary/export.pdf', permission: P.HRMS_REPORT_ATTENDANCE },
  'leave-balance':      { path: '/v1/reports/leave-balance/export.csv',      pdf: '/v1/reports/leave-balance/export.pdf',      permission: P.HRMS_REPORT_LEAVE },
  // Late marks reads attendance data, so the backend guards it with
  // hrms.report.attendance (there is no "report.latemarks" permission).
  'late-marks':         { path: '/v1/reports/late-marks/export.csv',         pdf: '/v1/reports/late-marks/export.pdf',         permission: P.HRMS_REPORT_ATTENDANCE },
  'diversity':          { path: '/v1/reports/diversity/export.csv',          pdf: '/v1/reports/diversity/export.pdf',          permission: P.HRMS_REPORT_DIVERSITY },
}

/** The report names the Reports Center shows for export-log rows and schedules. */
export const REPORT_LABEL: Record<string, string> = {
  'headcount': 'Headcount', 'attrition': 'Attrition', 'attendance-summary': 'Attendance summary', 'leave-balance': 'Leave balance',
  'late-marks': 'Late marks', 'diversity': 'Diversity', 'workforce-analytics': 'Workforce Analytics', 'audit-log': 'Audit log', 'employee-directory': 'Employee directory',
}
