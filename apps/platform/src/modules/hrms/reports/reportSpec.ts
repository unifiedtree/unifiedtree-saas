import { P } from '@unifiedtree/sdk'

// Each report's server CSV route and the permission that route checks,
// transcribed from ReportController.java. The backend has one export route per
// report (not a generic /{type}/export) because each JSON report is guarded by
// its own permission; this mapping keeps the Export button no wider than the
// endpoint behind it.
export type ReportKey =
  | 'headcount' | 'attrition' | 'attendance-summary'
  | 'leave-balance' | 'late-marks' | 'diversity'

export const EXPORT_SPEC: Record<ReportKey, { path: string; permission: string }> = {
  'headcount':          { path: '/v1/reports/headcount/export.csv',          permission: P.HRMS_REPORT_HEADCOUNT },
  'attrition':          { path: '/v1/reports/attrition/export.csv',          permission: P.HRMS_REPORT_ATTRITION },
  'attendance-summary': { path: '/v1/reports/attendance-summary/export.csv', permission: P.HRMS_REPORT_ATTENDANCE },
  'leave-balance':      { path: '/v1/reports/leave-balance/export.csv',      permission: P.HRMS_REPORT_LEAVE },
  // Late marks reads attendance data, so the backend guards it with
  // hrms.report.attendance (there is no "report.latemarks" permission).
  'late-marks':         { path: '/v1/reports/late-marks/export.csv',         permission: P.HRMS_REPORT_ATTENDANCE },
  'diversity':          { path: '/v1/reports/diversity/export.csv',          permission: P.HRMS_REPORT_DIVERSITY },
}
