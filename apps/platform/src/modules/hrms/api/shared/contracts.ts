// Shared API contracts for the HRMS redesign (package C0; AUDIT.md §3, §5.16, §6.3).
//
// Every endpoint that two or more redesign packages use is typed here once.
// The package that owns an endpoint (named with its BW id on each section)
// builds the backend to exactly this contract; every page calls it through the
// hook next to this file (one file per hook, so each owner can adjust its own
// hook without touching the others). A page that needs a field a contract
// doesn't have extends the type locally (`type Row = TeamMember & { x?: string }`)
// and asks the owner, instead of editing another package's section.
//
// Rules for every endpoint below (AUDIT §3.1):
// - Paths are under the /api servlet context; apiJson adds the /api prefix.
// - IsoDate is a yyyy-MM-dd calendar day in IST; IsoInstant is an ISO-8601
//   instant (UTC, e.g. 2026-09-27T04:30:00Z).
// - Errors are { timestamp, status, errorCode, message } with a plain-English
//   message the page may show as it is, and an UPPER_SNAKE code.
// - Until an endpoint or its migration is live the backend answers 404 or
//   503 FEATURE_NOT_READY. The hooks turn both into `notAvailable` (a typed
//   state, never an error, never retried); the page hides that block's actions
//   and shows its empty or "not available yet" state.
// - Responses only ever gain fields (the mobile app reads several of them).

import type { LeaveDuration, LeaveRequestResponse } from '../useLeave'
import type { FnfStatus } from '../useFnf'

export type { LeaveDuration, LeaveRequestResponse, FnfStatus }

/** A calendar day, yyyy-MM-dd, in IST. */
export type IsoDate = string
/** An instant, ISO-8601 in UTC. */
export type IsoInstant = string

/** hrms.employees.employment_status. */
export type EmploymentStatus = 'PROBATION' | 'ACTIVE' | 'NOTICE_PERIOD' | 'SUSPENDED' | 'EXITED' | 'TERMINATED' | (string & {})

/**
 * Query-key prefixes of the shared hooks. Mutations anywhere in the app that
 * change what a shared hook shows invalidate the matching prefix; in
 * particular every approve/reject hook also invalidates `approvalsInbox` and
 * `recentDecisions`, so the inbox and Undo stay current (team audit §9).
 */
export const SHARED_KEYS = {
  recentDecisions: ['approvals', 'recent-decisions'],
  teamSummary: ['team', 'summary'],
  teamTimeOff: ['team', 'time-off'],
  approvalsInbox: ['team', 'approvals'],
  teamProbation: ['team', 'probation'],
  teamMessages: ['team', 'messages'],
  /** Today's `['team','schedule',from,to]` (TeamSchedule, AttendanceContainer). */
  teamSchedule: ['team', 'schedule'],
  reminders: ['hrms', 'attendance', 'reminders'],
  approvers: ['me', 'approvers'],
  quickActions: ['me', 'quick-actions'],
  paySchedule: ['hrms', 'payroll', 'me', 'schedule'],
  overtimeRules: ['attendance', 'overtime-rules'],
  /** Today's key for the Overtime list (AttendanceContainer). */
  overtime: ['attendance', 'overtime'],
  /** Today's key, shared with shifts/ShiftChangeRequest.tsx and AttendanceContainer.tsx. */
  myShiftChanges: ['shifts', 'change-requests', 'my'],
  /** The HR queue of shift change requests (useShiftRequests: ['shifts','requests',…]). */
  shiftRequests: ['shifts', 'requests'],
  /** Timesheet weeks and the timesheet approvals list (P-ATT-DAY keeps its timesheet hooks under this prefix). */
  timesheets: ['timesheets'],
  /** Today's time-entry key (ess/TimeEntries.tsx: ['ess','time-entries',date]). */
  timeEntries: ['ess', 'time-entries'],
  adminContacts: ['workspace', 'admin-contacts'],
  /** Under today's ['hrms','employee-counts'], which every employee change already refreshes (useWorkforce). */
  employeeStats: ['hrms', 'employee-counts', 'stats'],
  /** Under today's ['hrms','employees'], which every employee change already refreshes (useWorkforce). */
  myEmployeeRecord: ['hrms', 'employees', 'me'],
  /** Under today's ['hrms','fnf'], which the settlement actions already refresh (useFnf). */
  fnfStatus: ['hrms', 'fnf', 'status'],
  webPunchSetting: ['attendance', 'web-punch-setting'],
  // Today's module prefixes, refreshed after an Undo, an on-behalf request or a probation decision.
  leave: ['hrms', 'leave'],
  wfh: ['hrms', 'wfh'],
  attendance: ['hrms', 'attendance'],
  expense: ['hrms', 'expense'],
  shifts: ['shifts'],
  /** useProbation (the dashboard's probation card). */
  probation: ['hrms', 'probation'],
  /** useWorkforce: one employee is ['hrms','employee',id]; the directory ['hrms','employees',…]; its counts ['hrms','employee-counts',…]. */
  employee: ['hrms', 'employee'],
  employees: ['hrms', 'employees'],
  employeeCounts: ['hrms', 'employee-counts'],
} as const

// ── BW-06 · Approval Undo and recent decisions (owner P-TEAM; V143_50) ──────
// POST /v1/{leave|wfh|attendance/corrections|shifts/change-requests|expense/claims}/{id}/decision/undo
// GET  /v1/approvals/recent-decisions

/** The five kinds of request whose decision can be taken back (DECISIONS 15); the journal's `kind`. */
export type DecisionKind = 'LEAVE' | 'WFH' | 'CORRECTION' | 'SHIFT_CHANGE' | 'EXPENSE'
export type DecisionOutcome = 'APPROVED' | 'REJECTED'

/** A decision the caller made that can still be taken back. */
export interface RecentDecision {
  /** The journal row. */
  id: string
  kind: DecisionKind
  requestId: string
  decision: DecisionOutcome
  /** Who raised the request. */
  employeeId: string
  employeeName: string
  /** The request in a few words, plain text from the server, e.g. "Casual leave · 28–29 Sep". */
  summary: string
  /** The note given with the decision. */
  note: string | null
  decidedAt: IsoInstant
  /**
   * Undo is offered until this instant (decidedAt + 10 minutes). The server can
   * still refuse earlier when something has used the decision (payroll locked
   * or paid, a reimbursement batch, the new shift started, a WFH punch).
   */
  undoUntil: IsoInstant
}

/** What an undo answers: the request, waiting again. */
export interface DecisionUndoResult {
  kind: DecisionKind
  requestId: string
  /** PENDING again (leave, WFH, fix, shift change), or SUBMITTED (expense claim). */
  status: string
  undoneAt: IsoInstant
  /** Who raised it; they have been told (DECISION_UNDONE). */
  employeeName: string
}

// ── BW-07 · Team summary (owner P-TEAM) ─────────────────────────────────────
// GET /v1/team/summary

/** How the caller's team is chosen (TeamEmployeeScope). */
export type TeamScopeKind = 'DEPARTMENT' | 'DIRECT_REPORTS' | 'COMPANY'

export interface TeamSummary {
  /** DEPARTMENT: the departments they head; DIRECT_REPORTS: people who report to them; COMPANY: attendance.workforce.admin. */
  scope: TeamScopeKind
  /** The departments they head (scope DEPARTMENT); empty otherwise. */
  departmentNames: string[]
  /** Everyone in the team, never the caller; people who have left are not included. Team size = members.length. */
  members: TeamMember[]
}

export interface TeamMember {
  employeeId: string
  name: string
  employeeCode: string | null
  jobTitle: string | null
  departmentName: string | null
  employmentStatus: EmploymentStatus
  dateOfJoining: IsoDate | null
  /** Set while they are on probation. */
  probationEndDate: IsoDate | null
  /** Why they aren't expected in today (IST), or null when they are. */
  offToday: 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE' | null
  profilePhotoUrl: string | null
}

// ── BW-08 · Team time off (owner P-TEAM) ────────────────────────────────────
// GET /v1/team/time-off?from=&to=   (at most 62 days)

export type TimeOffKind = 'LEAVE' | 'WFH'

/** One leave or work-from-home request of someone in the team that overlaps the range. */
export interface TeamTimeOffEntry {
  kind: TimeOffKind
  requestId: string
  employeeId: string
  employeeName: string
  /** First and last day of the request (inclusive); it may start before or end after the range asked for. */
  fromDate: IsoDate
  toDate: IsoDate
  /** Approved, or still waiting: PENDING (first level) or PENDING_L2 (waiting for HR). */
  status: 'APPROVED' | 'PENDING' | 'PENDING_L2'
  /** Leave only. */
  leaveTypeName: string | null
  /** Leave only; null for work from home. */
  duration: LeaveDuration | null
  /** Leave: the request's total days. Work from home: days in the request. */
  days: number
  /** True for a waiting request the caller may decide (the same rule as its decide endpoint); false for approved ones. */
  canDecide: boolean
}

// ── BW-09 · Approvals inbox (owner P-TEAM) ──────────────────────────────────
// GET /v1/team/approvals?kind=&page=&size=

/**
 * A row's own kind. TIMESHEET appears under Requests once BW-36 is in. LEAVE_L2 (leave waiting for HR) comes
 * only when the client asks for it (includeL2). ADVANCE, OVERTIME, OVERTIME_REQUEST and SKILL are not listed
 * by the server's inbox: the Approvals page reads them from their own lists (team/useExtraApprovals.ts).
 */
export type ApprovalKind = DecisionKind | 'TIMESHEET' | 'LEAVE_L2' | 'ADVANCE' | 'OVERTIME' | 'OVERTIME_REQUEST' | 'SKILL'

/** The inbox tabs (the design's: All · Leave · Attendance · Requests · Expenses); the `kind` query parameter takes these. */
export type InboxTab = 'all' | 'leave' | 'attendance' | 'requests' | 'expenses'

export interface ApprovalsInbox {
  /** Waiting requests per tab, each over the kinds the caller may list. */
  counts: Record<InboxTab, number>
  /** The tabs the caller may open (each kind needs its list permission); 'all' whenever any other is there. */
  tabs: InboxTab[]
  /** The asked tab's rows, newest first. */
  rows: InboxRow[]
  page: number
  size: number
  totalElements: number
  /** The caller's decisions that can still be undone (BW-06); empty while the journal isn't switched on. */
  recentDecisions: RecentDecision[]
  /** Kinds whose list failed or isn't switched on; the rest of the inbox still loads. */
  unavailable: ApprovalKind[]
}

export interface InboxRow {
  kind: ApprovalKind
  requestId: string
  employeeId: string
  employeeName: string
  employeeCode: string | null
  departmentName: string | null
  /** When it was raised (an expense claim: when it was submitted). */
  createdAt: IsoInstant
  /** The request in a few words: "Casual leave", "Missed punch-out", "Work from home", "Shift change: General → Early", a claim's title, "Timesheet". */
  title: string
  /** The days it covers, when it has any. */
  fromDate: IsoDate | null
  toDate: IsoDate | null
  /** Leave and work from home: number of days. */
  days: number | null
  /** Expense claims: the total and its currency. */
  amount: number | null
  currency: string | null
  /** What the employee wrote (a claim's notes). */
  reason: string | null
  /** The card's facts, e.g. { key: 'balanceAfter', label: 'Balance after', value: '4 days' }. */
  facts: InboxFact[]
  /** Amber warnings, e.g. { key: 'othersOut', text: 'Arjun is also out on Mon 28 Sep' }. */
  warnings: InboxWarning[]
  /** False when the caller can see the row but may not decide it (ApproverScopeGuard would refuse); show it without buttons. */
  canDecide: boolean
  /** True when Reject needs a note (work from home: WFH_REJECT_REASON_REQUIRED). */
  rejectNeedsReason: boolean
}

export interface InboxFact { key: string; label: string; value: string }
export interface InboxWarning { key: string; text: string }

// ── BW-10 · Reminders (owner P-TEAM) ────────────────────────────────────────
// POST /v1/attendance/reminders   GET /v1/attendance/reminders?date=

/** Why the reminder is sent. CHECKIN_REMINDER's wording is for this reason; a new reason needs its own wording first. */
export type ReminderReason = 'NOT_CHECKED_IN'

export interface SendRemindersRequest {
  date: IsoDate
  reason: ReminderReason
  employeeIds: string[]
}

/** One person's result. At most one reminder per person, day and reason. */
export interface ReminderResult {
  employeeId: string
  /** SENT now; ALREADY_SENT by someone earlier for this day and reason; SKIPPED (not in your team, no login, already checked in or on leave). */
  outcome: 'SENT' | 'ALREADY_SENT' | 'SKIPPED'
  /** Why it was skipped, in plain English. */
  message: string | null
}

/** A reminder already sent for the day, so "Reminder sent" survives a reload. */
export interface SentReminder {
  employeeId: string
  reason: ReminderReason
  sentAt: IsoInstant
  sentByName: string | null
}

// ── BW-11 · Probation for managers (owner P-TEAM; permission in V143_55) ─────
// GET /v1/team/probation?days=   POST /v1/team/probation/{employeeId}/confirm   POST …/extend

/** Someone in the team whose probation ends within the asked days, or is already overdue. */
export interface TeamProbationRow {
  employeeId: string
  name: string
  jobTitle: string | null
  departmentName: string | null
  probationEndDate: IsoDate
  /** Days from today (IST) to the end date; negative once it has passed. */
  daysLeft: number
  overdue: boolean
}

export interface ConfirmProbationRequest {
  /** Defaults to today (IST). */
  confirmationDate?: IsoDate | null
}

export interface ExtendProbationRequest {
  /** The new last day of probation; after the current one. */
  newEndDate: IsoDate
  note?: string | null
}

/** Where the person stands after Confirm or Extend. */
export interface TeamProbationDecision {
  employeeId: string
  employmentStatus: EmploymentStatus
  /** The new end date after Extend; null once confirmed. */
  probationEndDate: IsoDate | null
  /** Set after Confirm. */
  confirmationDate: IsoDate | null
}

// ── BW-12 · Team messages (owner P-TEAM; V143_55) ───────────────────────────
// POST /v1/team/messages   GET /v1/team/messages/mine?days=   GET /v1/team/messages/sent

export interface TeamMessage {
  id: string
  /** Up to 500 characters, plain text. */
  body: string
  senderEmployeeId: string
  senderName: string
  /** The team it went to, e.g. "Engineering"; null when it has no name. */
  teamLabel: string | null
  createdAt: IsoInstant
  /** Messages the caller sent: how many people it went to. Null in the received list. */
  recipientCount: number | null
}

export interface PostTeamMessageRequest {
  /** 1–500 characters. */
  body: string
}

// ── BW-112 · Quick-action preferences (owner P-DASH; V143_51) ───────────────
// GET/PUT /v1/me/dashboard/quick-actions?surface=   POST /v1/me/dashboard/quick-actions/{key}/use?surface=

/** Which page's tiles: the admin dashboard or the self-service Home. */
export type QuickActionSurface = 'dashboard' | 'home'

export interface QuickActionPrefs {
  /** False while the preferences table isn't switched on: hide Customise and use the default order. */
  available: boolean
  /** The picked tile keys in order; null means automatic (every permitted tile, most used first). */
  picked: string[] | null
  /** The IST month the counts are for, e.g. "2026-09". */
  month: string
  /** Uses this month, by tile key. */
  uses: Record<string, number>
}

export interface SaveQuickActionsRequest {
  /** At most 6 unique, known keys; null goes back to automatic. */
  picked: string[] | null
}

// ── BW-55 · Next pay date (owner P-PAY-CORE) ────────────────────────────────
// GET /v1/payroll/payslips/me/schedule

export interface PaySchedule {
  /**
   * The next pay date for the caller's company: the next run's pay date when
   * one exists, else the day payroll is processed this cycle ("Payroll is
   * processed on {date}"). Null when payroll isn't set up.
   */
  nextPayDate: IsoDate | null
  /** The day of the month payroll is processed (payroll settings), 1–31; null when not set. */
  processingDay: number | null
}

// ── BW-29 · Company overtime rules (owner P-ATT-PLAN; V143_54; DECISIONS 22) ─
// GET/PUT /v1/attendance/overtime-rules?companyId=

export interface OvertimeRules {
  companyId: string
  /**
   * The minimum overtime, in minutes: a THRESHOLD (DECISIONS 22). Extra time under it doesn't count; once it is
   * reached, ALL of it counts (1 h 20 m extra is 1 h 20 m of overtime). Always a number: the company's, else the default.
   */
  minimumMinutes: number
  /** True when the company hasn't set its own minimum and the default applies. */
  minimumIsDefault: boolean
  /** The default minimum (60). */
  defaultMinimumMinutes: number
  /** The most overtime that can be approved per person per month, in minutes; null = no cap. */
  monthlyCapMinutes: number | null
  /** Who last changed them, and when; null while never set. */
  updatedByName: string | null
  updatedAt: IsoInstant | null
}

export interface SaveOvertimeRulesRequest {
  /** Whole minutes, 0–1440; null goes back to the default (60). */
  minimumMinutes: number | null
  /** Whole minutes, 0 or more; null = no cap. */
  monthlyCapMinutes: number | null
}

// ── BW-31 / BW-34 · Shift change for yourself (owner P-ATT-PLAN; V143_54) ───
// GET /v1/shifts/change-requests/my   POST /v1/shifts/change-requests   POST /v1/shifts/change-requests/{id}/cancel

export type ShiftChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | (string & {})

/** Mirrors ShiftDtos.ShiftChangeRequestResponse, plus the end date BW-31 adds. */
export interface ShiftChangeRequest {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  currentShiftPolicyId: string | null
  currentShiftName: string | null
  requestedShiftPolicyId: string
  requestedShiftName: string | null
  reason: string | null
  status: ShiftChangeStatus
  /** Null when it was rejected automatically (expired before a decision). */
  approverId: string | null
  approverName: string | null
  decisionNote: string | null
  decidedAt: IsoInstant | null
  createdAt: IsoInstant
  /** The day the employee asked it to start; null on requests from older app builds. */
  requestedEffectiveDate: IsoDate | null
  /** The day the new shift started; set on approval. */
  appliedEffectiveDate: IsoDate | null
  /** BW-31: the last day of a temporary change; null = permanent, as before. Absent until BW-31 is in. */
  requestedEndDate?: IsoDate | null
}

export interface CreateShiftChangeRequest {
  requestedShiftPolicyId: string
  /** The first day on the new shift. */
  effectiveDate: IsoDate
  /** 10–500 characters. */
  reason: string
  /** BW-31: "Until", optional. Leave it out (or null) for a permanent change. */
  endDate?: IsoDate | null
}

// ── BW-36 · Timesheet week decision (owner P-ATT-DAY; V143_65) ──────────────
// POST /v1/timesheets/weeks/{id}/decision

export type TimesheetWeekStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface TimesheetWeek {
  id: string
  employeeId: string
  employeeName: string
  /** The Monday the week starts. */
  weekStart: IsoDate
  status: TimesheetWeekStatus
  /** Time logged that week. */
  totalMinutes: number
  submittedAt: IsoInstant
  decidedAt: IsoInstant | null
  decidedByName: string | null
  /** The approver's note. */
  note: string | null
}

export interface TimesheetDecisionRequest {
  status: 'APPROVED' | 'REJECTED'
  comment?: string
}

// ── BW-01 · Help & support contacts (owner F3b) ─────────────────────────────
// GET /v1/workspace/admin-contacts

/** An active person who can manage users and roles (workspace.users.manage or rbac.role.write). Owners first, at most 10. */
export interface AdminContact {
  name: string
  /** Their work (sign-in) email. */
  email: string
  /** A plain role name, e.g. "Owner", "Admin", "HR manager". */
  roleLabel: string | null
}

// ── BW-122 · Who a request goes to (owner P-HOME) ───────────────────────────
// GET /v1/me/approvers?for=leave|wfh|correction|shift

export type ApproverFor = 'leave' | 'wfh' | 'correction' | 'shift'

/** How the approver was chosen, in the order the chain tries them. */
export type ApproverSource = 'MANAGER' | 'DEPARTMENT_HEAD' | 'HR' | 'ADMIN' | 'DELEGATE'

export interface ApproverPreview {
  for: ApproverFor
  /** Null when nobody can be found (applying would be refused with NO_APPROVER_AVAILABLE). */
  approver: {
    employeeId: string
    name: string
    source: ApproverSource
    /** When source is DELEGATE: the approver they stand in for. */
    delegateForName: string | null
  } | null
}

// ── BW-43 · Apply for leave on someone's behalf (owner P-LEAVE; permission in V143_56) ──
// POST /v1/leave/apply/for/{employeeId}   → 201 LeaveRequestResponse (useLeave.ts)

/**
 * The same body as POST /v1/leave/apply (LeaveRequestRequest), with the same
 * validation and approver chain. The request is filed under the employee's own
 * company; the employee is told (LEAVE_APPLIED_ON_BEHALF).
 */
export interface ApplyLeaveForRequest {
  leaveTypeId: string
  startDate: IsoDate
  endDate: IsoDate
  duration: LeaveDuration
  reason?: string
}

// ── BW-64 · F&F status per person (owner P-PAY-EXTRA) ───────────────────────
// GET /v1/fnf/settlements/status?employeeIds=a,b,c

/** One row per id asked for, in the same order. */
export interface FnfStatusRow {
  employeeId: string
  /** Their most recent settlement; null when none was started. */
  settlementId: string | null
  status: FnfStatus | null
  lastWorkingDay: IsoDate | null
  netSettlement: number | null
  paidAt: IsoInstant | null
}

// ── BW-90 · Employee stats (owner P-WF-PEOPLE) ──────────────────────────────
// GET /v1/hrms/employees/stats?companyId=

export interface EmployeeStats {
  /** People by exact status (so `active` is ACTIVE only); `total` is everyone on the roster. Every company when no companyId is given. */
  counts: {
    total: number
    active: number
    probation: number
    notice: number
    suspended: number
    exited: number
    terminated: number
  }
  /** Joined, and left (last working day), in the current calendar month (IST). */
  joinedThisMonth: number
  leftThisMonth: number
  /** Notice periods that started in the last 7 days. */
  noticeStartedLast7Days: number
  /** Probations that end next calendar month (the "reviews due" line). */
  probationReviewsDueNextMonth: number
  /** EXITED or TERMINATED with a last working day in the current calendar year. */
  exitedThisYear: number
  /** The TERMINATED people among exitedThisYear (same rule, same year), so exitedThisYear − terminatedThisYear resigned or left otherwise. */
  terminatedThisYear: number
  /** Attrition in the current calendar year, in percent; null for callers without hrms.report.attrition. */
  attritionPercent: number | null
  /** Seven points, oldest first: the active headcount at the end of each of the last six months, then today. */
  activeSeries: { date: IsoDate; active: number }[]
  /** When each suspended person's suspension began (employee_status_history); since is null when it wasn't recorded. */
  suspendedSince: { employeeId: string; since: IsoDate | null }[]
}

// ── BW-98 · My own record (owner P-WF-PEOPLE) ───────────────────────────────
// GET /v1/hrms/employees/me   (today's /v1/employees/me stays as it is)

/** The signed-in person's own work record: only the fields below, nothing about pay, bank or identity. */
export interface MyEmployeeRecord {
  employeeId: string
  employeeCode: string | null
  firstName: string
  lastName: string | null
  companyId: string
  employmentStatus: EmploymentStatus
  dateOfJoining: IsoDate | null
  /** The designation's name, else the job title. */
  designationName: string | null
  departmentName: string | null
  /** Their reporting manager's name. */
  managerName: string | null
  probationEndDate: IsoDate | null
  confirmationDate: IsoDate | null
  noticeStartDate: IsoDate | null
  lastWorkingDay: IsoDate | null
}

// ── BW-24 · Allow web check-in (owner P-ATT-DAY; V143_53) ───────────────────
// GET/PUT /v1/attendance/web-punch-setting?companyId=

export interface WebPunchSetting {
  companyId: string
  /** "Allow web check-in": on by default (client decision, 1 Oct; a web punch needs a face scan). While off, the punch API refuses WEB and "Your day" has no Check in/out. */
  allowWebPunch: boolean
}

export interface SaveWebPunchSettingRequest {
  allowWebPunch: boolean
}
