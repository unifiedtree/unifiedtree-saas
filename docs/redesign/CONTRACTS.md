# Shared contracts (C0, merged into rd/int at 33cc0d41). Binding for owners and users.

The hook files live in `apps/platform/src/modules/hrms/api/shared/`, one per hook, with types in `contracts.ts` and query-key prefixes in `SHARED_KEYS`.

**Owners:** build each endpoint exactly to its contract. If a contract is wrong, fix only YOUR endpoint's hook file in your branch and report it.

**Users:** import the hook; don't write your own fetch for these.

## Backend helpers
- **FeatureNotReady** (`backend/shared/hrms-core/.../exception/FeatureNotReady.java`)
  - Use it as `FeatureNotReady.guard(() -> …)`, `translate(e)` or `run(…)`, or throw `new FeatureNotReady()` after your own `to_regclass` check.
  - It turns SQL state 42P01/42703 into 503 `FEATURE_NOT_READY`, logs one WARN with the database message, and rethrows everything else.
  - In live tests with all migrations applied, ANY FEATURE_NOT_READY is a bug (except the deliberate rename-the-table step).
- **Notification types (13)** in `AppNotificationType` and the catalog. The key and its group:
  - Approvals: `approvals.decision_undone`
  - Attendance: `attendance.checkin_reminder`, `attendance.timesheet_submitted`, `attendance.timesheet_decided`
  - Performance: `performance.review_reminder`
  - Team: `team.message`
  - Assets: `assets.issue_reported`
  - Payroll: `payroll.payslip_query_raised`, `payroll.payslip_query_answered`
  - Leave: `leave.applied_on_behalf`
  - Expenses and advances: `expense.raised_for_you`
  - Letters: `letters.signature_requested`
  - People: `people.probation_team_decision`

## New permissions (constants in `packages/sdk/src/permissions/codes.ts`; the OWNER writes the migration + `rbac.permissions` row + grants)
| code | module | name to seed | grants | owner (migration) |
|---|---|---|---|---|
| hrms.probation.team.decide | hrms | Confirm or extend team probation | OWNER, SUPER_ADMIN, ADMIN (V143_67), DEPT_MANAGER, MANAGER (V143_85) | P-TEAM (V143_55) |
| hrms.team.message | hrms | Message your team | OWNER, SUPER_ADMIN, DEPT_MANAGER, MANAGER | P-TEAM (V143_55) |
| hrms.leave.apply.others | leave | Apply for leave for others | OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD (same as `hrms.advance.request.others`) | P-LEAVE (V143_56) |
| hrms.expense.claim.others | expense | Raise expense claims for others | same five | P-EXP (V143_57) |
| hrms.timesheet.approve | attendance | Approve timesheets | OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER | P-ATT-DAY (V143_65) |

## Hooks → endpoints
| Hook(s) | Endpoint | Permission | Owner | Used by |
|---|---|---|---|---|
| useRecentDecisions | GET /v1/approvals/recent-decisions | signed in (own) | P-TEAM BW-06 | TEAM, HOME, LEAVE, ATT-DAY, ATT-PLAN, EXP, DASH |
| useDecisionUndo | POST /v1/{leave, wfh, attendance/corrections, shifts/change-requests, expense/claims}/{id}/decision/undo | decide perm, and only the decider | P-TEAM BW-06 | same |
| useTeamSummary | GET /v1/team/summary | anyOf attendance.team.read, hrms.leave.approve.l1 | P-TEAM BW-07 | TEAM, HOME |
| useTeamTimeOff | GET /v1/team/time-off?from&to (≤62 days) | the above + wfh.approve | P-TEAM BW-08 | TEAM, HOME |
| useApprovalsInbox | GET /v1/team/approvals?kind=all\|leave\|attendance\|requests\|expenses&page&size | each kind's list permission | P-TEAM BW-09 | TEAM, HOME |
| useReminders, useSendReminders | GET/POST /v1/attendance/reminders | attendance.team.read + team scope | P-TEAM BW-10 | TEAM, HOME, ATT-DAY, DASH |
| useTeamProbation, useConfirmTeamProbation, useExtendTeamProbation | GET /v1/team/probation?days; POST …/{employeeId}/confirm \| extend | read: attendance.team.read; decide: hrms.probation.team.decide | P-TEAM BW-11 | TEAM, HOME |
| useTeamMessages, useSentTeamMessages, usePostTeamMessage | GET /v1/team/messages/mine?days, /sent; POST /v1/team/messages | post: hrms.team.message; reads: own rows | P-TEAM BW-12 | TEAM, HOME |
| useUiPrefs, useSaveQuickActions, useRecordQuickActionUse | GET/PUT /v1/me/dashboard/quick-actions?surface=dashboard\|home; POST …/{key}/use?surface | signed in (own row) | P-DASH BW-112 | DASH, HOME |
| usePaySchedule | GET /v1/payroll/payslips/me/schedule | payroll.payslip.read.self | P-PAY-CORE BW-55 | HOME, ATT-DAY, MYPAY |
| useOvertimeRules, useSaveOvertimeRules | GET/PUT /v1/attendance/overtime-rules?companyId | read attendance.team.read; write attendance.policy.manage | P-ATT-PLAN BW-29 | ATT-PLAN, SETUP |
| useMyShiftChanges, useRequestShiftChange, useWithdrawShiftChange | GET …/change-requests/my (exists); POST /v1/shifts/change-requests (+ optional endDate); POST …/{id}/cancel | attendance.checkin.self | P-ATT-PLAN BW-31/34 | HOME, ATT-PLAN |
| useTimesheetDecision | POST /v1/timesheets/weeks/{id}/decision {status, comment?} | hrms.timesheet.approve + team scope | P-ATT-DAY BW-36 | ATT-DAY, TEAM |
| useAdminContacts | GET /v1/workspace/admin-contacts | signed in | F3b BW-01 | F3a |
| useApprovers | GET /v1/me/approvers?for=leave\|wfh\|correction\|shift | signed in | P-HOME BW-122 | ATT-DAY, HOME, LEAVE |
| useApplyLeaveOnBehalf | POST /v1/leave/apply/for/{employeeId} (same body as /apply) | hrms.leave.apply.others | P-LEAVE BW-43 | ATT-DAY, PROFILE |
| useFnfStatus | GET /v1/fnf/settlements/status?employeeIds=a,b | hrms.fnf.read | P-PAY-EXTRA BW-64 | GROW, PROFILE |
| useEmployeeStats | GET /v1/hrms/employees/stats?companyId | hrms.employee.read (attrition % only with hrms.report.attrition) | P-WF-PEOPLE BW-90 | WF-SETUP, GROW, WF-PEOPLE |
| useMyEmployeeRecord | GET /v1/hrms/employees/me | signed in | P-WF-PEOPLE BW-98 | PROFILE (F3a later) |
| useWebPunchSetting, useSaveWebPunchSetting | GET/PUT /v1/attendance/web-punch-setting?companyId | read: signed in; write: settings.hrconfig.write or attendance.policy.manage | P-ATT-DAY BW-24 | SETUP, HOME |

**Rules:**
- 404 and 503 FEATURE_NOT_READY become `notAvailable` (never an error, never retried); mutations resolve `{available: false}`.
- 403, 422 and 500 stay errors.
- Pass `enabled` from permissions.
- Every existing approve/reject hook must also invalidate `SHARED_KEYS.approvalsInbox` and `SHARED_KEYS.recentDecisions`.
- P-ATT-DAY keeps its timesheet hooks under `['timesheets']`.
- BW-31 must answer FEATURE_NOT_READY when `endDate` is sent and the column is missing.
- Four paths (`usePaySchedule`, `useFnfStatus`, `useEmployeeStats`, `useMyEmployeeRecord`) fall into an existing `/{id}` mapping today (400). Their owners must add explicit mappings so these literal paths win over `/{id}`.
- F3b adds the web routes and icons for the 13 notification types. The mobile app's enum also needs them (report it; it's another repo).
