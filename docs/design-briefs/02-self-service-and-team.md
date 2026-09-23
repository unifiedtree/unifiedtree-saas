# Employee self-service & My Team — page briefs

This group is the employee's own workspace (`/me` and its request pages, payslips, salary) plus the department manager's team home (`/team`). In the sidebar it lives in two places: the top-level links **My Workspace** (`/me`, role EMPLOYEE) and **My Team** (`/team`, role DEPT_MANAGER), and the collapsible group **Employee Self Service** › My Attendance & Leaves (`/hrms/attendance`, other brief) · My Payslip (`/me/payslips`) · My Profile (`/me`) · Team Attendance (`/team`). Sidebar visibility is by role (`PlatformShell.tsx` `R_ESS = ['EMPLOYEE']`, `['DEPT_MANAGER']`, MANAGER counts as DEPT_MANAGER); the routes themselves are gated by permission codes in `App.tsx` (`hrms.ess.read`, `attendance.checkin.self`, `attendance.team.read`, `hrms.leave.approve.l1`, `payroll.payslip.read.self`, `payroll.structure.read.self`) and the `hrms` / `payroll` module gates. Anyone with a permission but not the role can still open the URL (deep link, notifications, ⌘K search) — they just get no sidebar entry.

Source paths below are relative to `apps/platform/src/`. Audit-doc citations are to the repo-root files `HRMS_CLAUDE_HANDOFF.md`, `HRMS_IMPLEMENTATION_STATUS.md`, `HRMS_FUNCTIONALITY_AUDIT.md`, `HRMS_TARGET_BLUEPRINT.md`, `HRMS_IMPLEMENTATION_PLAN.md`.

---

## My Workspace (ESS Dashboard)  `/me`  (alias `/hrms/ess`)
- **File:** `modules/hrms/ess/EssDashboard.tsx` (+ `ess/AttendanceHistory.tsx`, `ess/TimeEntries.tsx`)  ·  **Sidebar:** top-level **My Workspace** (EMPLOYEE) and Employee Self Service › **My Profile** (EMPLOYEE); `/hrms/ess` has no sidebar entry (same component, alias route)  ·  **Roles:** sidebar EMPLOYEE; route `RouteGuard anyOf [hrms.ess.read, attendance.checkin.self]` + `ModuleGate hrms`. Any user with those permissions (incl. HR/admin who are also employees) can open it. Note: the `/` root route (`App.tsx` `RoleAwareLanding`) sends every authenticated user to `/modules`, never here — employees reach `/me` only via the sidebar.
- **Status:** LIVE — every block calls a real hook: `useMonthlyStats → GET /v1/attendance/monthly-stats`, `useMyBalances → GET /v1/leave/my/balances`, `useMyLeaves → GET /v1/leave/my`, `useAttendanceHistory → GET /v1/attendance/history`, `GET/POST/PUT/DELETE /v1/ess/timesheets`.

### Purpose
The employee's landing page. They come to check this month's attendance numbers, see leave balances, jump to Apply leave / WFH / Shift change / Onboarding tasks, review recent leave status, browse their punch history by month and log daily time entries. There is no punch-in/out here — the file comment says punching is mobile-only ("the web ESS dashboard no longer shows a check-in/out widget").

### Layout (map to the design-system parts)
1. **Greeting banner** — custom mint card (`bg-[#ECFDF5]`, border `#6EE7B7`), not an `HrPageHeader`: "Good morning," / `{firstName} {lastName}` (from `useAuthStore.user`) / today's date `EEEE, d MMMM yyyy` ("Wednesday, 23 September 2026"). No crumb, no actions.
2. Section label "This Month" then a **KPI strip** of 5 `HrStatCard` (`grid-cols-2 sm:grid-cols-5`): Present (green, `presentDays`) · Absent (red, `absentDays`) · Late (orange, `lateDays`) · On Time (blue, `onTimeDays`) · Score (teal, `${attendanceScore}%`). `CardSkeleton` while loading; `EmptyState variant="error"` with Retry on failure. `holidays` is returned but not shown.
3. **Leave Balances** `.ut-card` — header row with title + text link "Apply leave →"; body is a `grid-cols-2 sm:grid-cols-3` of plain tiles (first 6 balances): `leaveTypeName` / `available.toFixed(1)` big / "of {totalEntitlement.toFixed(1)} days".
4. **Onboarding Tasks** shortcut card (`.ut-card-sm`): icon ClipboardList, "Onboarding Tasks" / "View your onboarding checklist", link "Open →".
5. **Work From Home** shortcut card: icon Home, "Work From Home" / "Request approval to work from home", link "Request WFH →".
6. **Shift Change** shortcut card: icon Repeat, "Shift Change" / "Ask HR to move you to a different shift", link "Request Shift Change →".
7. **Recent Leave Requests** `.ut-card` (rendered only when ≥1 request): header with `HrStatusPill tone="warn"` "{n} pending"; up to 3 rows: `leaveTypeName` / "18 Sep – 20 Sep · 3d" / `HrStatusPill` status (APPROVED ok · PENDING warn · REJECTED red · CANCELLED gray · PENDING_L2 purple).
8. **Attendance history** section (`AttendanceHistory.tsx`) — `.ut-card` with title + `<input type="month">` filter (label "Month"); raw `hr-table` with columns Date (raw `yyyy-MM-dd` string, not formatted) · Punch in · Punch out (ISO timestamps → `h:mm a`, plain times → `HH:mm`, missing → "--") · Hours (`workHours.toFixed(2)` + "h", missing → "--") · Status (`HrStatusPill`, warn for LATE/ABSENT else gray; underscores replaced by spaces). Retry `HrButton` on error.
9. **Daily time entries** section (`TimeEntries.tsx`, only when user holds `attendance.checkin.self`) — `.ut-card`: title + helper "Record time spent on work. These entries do not change attendance punches or payroll."; Work date `<input type="date">`; "Total: {n} minutes"; entry list rows (description / "{minutes} minutes" / Edit · Delete ghost `HrButton`s, inline delete confirm); form: Work description textarea (max 1000) + Minutes number (1–1440) + submit `HrButton`.

Whole page is `max-w-5xl`, stacked, single column.

### Data shown
- KPI strip: `useMonthlyStats()` → `GET /v1/attendance/monthly-stats` (current month; fields presentDays, absentDays, lateDays, onTimeDays, attendanceScore, holidays).
- Leave balances: `useMyBalances()` → `GET /v1/leave/my/balances` → `LeaveBalanceResponse[]` (leaveTypeName, available, totalEntitlement, used, pending, carryForward — only the first three rendered).
- Recent leaves + pending count: `useMyLeaves(0)` → `GET /v1/leave/my?page=0&size=20` (`LEAVE_PAGE_SIZE = 20`; `content[]`: leaveTypeName, startDate, endDate, totalDays, status). The "{n} pending" pill counts only `PENDING` (not `PENDING_L2`) within that first page.
- Attendance history: `useAttendanceHistory(year, month)` → `GET /v1/attendance/history?year=&month=` → `DayRecordResponse[]` (date, status, checkInTime, checkOutTime, workHours).
- Time entries: `GET /v1/ess/timesheets?from={date}&to={date}` → `{id, workDate, description, minutes}[]` (react-query key `['ess','time-entries',date]`).
- User name: `useAuthStore(s => s.user)` (SDK store).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Retry | This Month error state | `refetch()` monthly stats | all viewers | LIVE |
| Apply leave → | Leave Balances card header (text link) | `navigate('/hrms/leave')` — no `?tab=apply`, so it lands on the first visible tab ("My Leaves"), not "Apply". Route guard `anyOf [hrms.leave.read, hrms.ess.read, leave.request.self]` — NoAccess only for a user who holds just `attendance.checkin.self` | all viewers | LIVE (wrong tab) |
| Retry | Leave Balances error state | `refetch()` balances | all viewers | LIVE |
| Open → | Onboarding Tasks card | `navigate('/hrms/onboarding/instances')`; that route is guarded `anyOf [hrms.onboarding.instance.read, hrms.onboarding.task.complete, hrms.onboarding.asset.read]` — an employee without `hrms.onboarding.task.complete` hits NoAccess | all viewers | LIVE (may NoAccess) |
| Request WFH → | Work From Home card | `navigate('/me/wfh')` | all viewers | LIVE |
| Request Shift Change → | Shift Change card | `navigate('/me/shift-change')` | all viewers | LIVE |
| Month (`type=month`) | Attendance history header | re-queries `GET /v1/attendance/history?year&month` | all viewers | LIVE |
| Retry | Attendance history error | `refetch()` | all viewers | LIVE |
| Work date (`type=date`, max today) | Daily time entries | re-queries `/v1/ess/timesheets?from&to`; clears edit / delete state and the description field | `attendance.checkin.self` | LIVE |
| Retry | Daily time entries error (`HrButton`) | `entries.refetch()` | `attendance.checkin.self` | LIVE |
| Edit | time-entry row (ghost; disabled while a mutation is pending) | loads row into the form; submit label becomes "Save time entry" | `attendance.checkin.self` | LIVE |
| Delete | time-entry row (ghost; disabled while a mutation is pending) | shows inline "Delete this time entry?" | `attendance.checkin.self` | LIVE |
| Confirm deletion | inline confirm | `DELETE /v1/ess/timesheets/{id}`, invalidates list | `attendance.checkin.self` | LIVE |
| Keep entry | inline confirm | closes confirm | `attendance.checkin.self` | LIVE |
| Add time entry / Save time entry | form submit | `POST /v1/ess/timesheets` or `PUT /v1/ess/timesheets/{id}` with `{workDate, description, minutes}`; error → toast | `attendance.checkin.self` | LIVE |
| Cancel edit | form (only while editing) | resets form | `attendance.checkin.self` | LIVE |

### States
- loading: `CardSkeleton` for stats and balances; "Loading attendance..." table row; "Loading time entries..." text.
- empty: balances → "No leave types have been assigned to you yet. Contact HR to set up your balances."; attendance history → "No attendance records for this month."; time entries → "No time recorded for this date."; Recent Leave Requests card is hidden entirely when there are none (no empty message).
- error: stats → `EmptyState variant="error"` "Couldn't load attendance stats" / "Check your connection and retry." + Retry; balances → "Couldn't load leave balances" + Retry; history/time entries → raw `error.message` + Retry; time-entry mutation error → toast.
- no-permission: RouteGuard renders `NoAccess`; Daily time entries section silently disappears without `attendance.checkin.self`.
- special: greeting switches morning/afternoon/evening by local hour.

### Rules & permissions
- Route: any of `hrms.ess.read`, `attendance.checkin.self`; `hrms` module must be active for the tenant.
- Time entries: employee identity comes from the JWT (no employee id in the request); minutes 1–1440 per entry, work date cannot be in the future; backend enforces a 24-hour daily cap and per-employee ownership (FUNCTIONALITY_AUDIT row V133 `hrms.time_entries`; HANDOFF §5 "Self time-entry CRUD uses JWT identity, future-date checks, 24-hour daily cap"). Entries "do not silently alter attendance/payroll".
- Leave balances show only the first 6 types; recent leaves only the first 3.

### Gaps & plan  (keep / add / change)
- **Keep:** the five monthly KPIs, leave balance tiles, the three request shortcuts, month-filtered attendance history, time-entry CRUD (all verified live — STATUS "ESS | Real attendance history and self-owned daily time-entry CRUD").
- **Add:** [BLUEPRINT §21 / PLAN §17] "My Workspace: Today (punch status, today's shift, [Mark Attendance]) · My Attendance (calendar, late marks, [Regularize]) · My Leave (balances, [Apply], history) · My Payslips · My Documents (+ Upload) · My Profile (editable) · My Performance" — today's page has no shift/punch status, no calendar, no documents, no profile, no performance block. [BLUEPRINT §6 row 56] ESS is "Works … UX B — Coherent workspace". [PLAN §7.2 Overview tab] "Manager, shift, attendance %, leave balance, last payslip, pending items". [code] `holidays` from monthly-stats is fetched but never shown. [code] no link to `/me/payslips` or `/me/salary` from this page.
- **Change:** sidebar label "My Profile" points to this dashboard, which contains no profile data, while the header user-menu "My Profile" (`PlatformShell.tsx`, `navigate('/profile')`) goes to a different page — rename or add a real profile section. "Apply leave →" lands on the Leave page's "My Leaves" tab instead of "Apply" (no `?tab=apply`; `Leave.tsx` supports the param). "Open →" (onboarding) navigates to `/hrms/onboarding/instances`, which NoAccesses an employee without `hrms.onboarding.task.complete` (BLUEPRINT §21 rule: "an employee should never see an empty admin screen or a 403"). Greeting is a bespoke mint card instead of `HrPageHeader`. Attendance history and time entries use raw `hr-table`/`<table>` instead of `TableCard`+`DataTable`; the history Date column is an unformatted `yyyy-MM-dd`. Recent Leave Requests card vanishes instead of showing an `EmptyState`. Error text for history/time entries is the raw server message.

### Screenshot
`Attach: /me — current screen`

### Claude Design prompt (ready to paste)
```
Design the My Workspace (ESS dashboard) page for EMPLOYEE users (also visible to HR/admins who hold hrms.ess.read).
Top: HrPageHeader, crumb "Employee Self-Service", title "Good morning, Priya Sharma", subtitle "Wednesday, 23 September 2026"; actions: HrButton primary "Apply leave", ghost "Request WFH", ghost "Request shift change".
KPI strip (5 HrStatCard, label "This Month"): Present 18 (green) · Absent 1 (red) · Late 2 (orange) · On Time 16 (blue) · Score 92% (teal); loading = skeleton values.
Leave Balances card: up to 6 tiles "Casual Leave — 6.5 of 12.0 days", "Earned Leave — 10.0 of 15.0 days", "Sick Leave — 4.0 of 7.0 days"; empty text "No leave types have been assigned to you yet. Contact HR to set up your balances."
Shortcut row (3 small cards): Onboarding Tasks → Open; Work From Home → Request WFH; Shift Change → Request Shift Change.
Recent Leave Requests card: header pill "1 pending"; rows "Casual Leave · 18 Sep – 19 Sep · 2d" with HrStatusPill (Approved ok / Pending warn / Rejected red / Cancelled gray / Awaiting HR purple); add an EmptyState "No leave requests yet" (today the card just disappears).
Attendance history: TableCard with a month picker (Sep 2026) and DataTable columns Date (18 Sep 2026 — today it renders the raw 2026-09-18) · Punch in (9:12 AM) · Punch out (6:31 PM, "--" when missing) · Hours (9.32h) · Status HrStatusPill (PRESENT gray / LATE warn / ABSENT warn); empty "No attendance records for this month."; error EmptyState + Retry.
Daily time entries card (only for attendance.checkin.self): helper "Record time spent on work. These entries do not change attendance punches or payroll."; "Work date" date picker (max today); "Total: 180 minutes"; rows "Sprint planning · 60 minutes" with ghost HrButton Edit / Delete and inline confirm "Delete this time entry?" [Confirm deletion] [Keep entry]; empty "No time recorded for this date."; error EmptyState + Retry; form "Work description" (textarea, max 1000) + "Minutes" (1–1440) + primary HrButton "Add time entry" / "Save time entry" + ghost "Cancel edit".
Keep single column, max-w-5xl. Add (from blueprint §21): a "Today" strip showing today's shift name + time (General · 09:00 – 18:00) and the last payslip link. Change: use HrPageHeader instead of the mint greeting card; rebuild both tables with TableCard/DataTable.
```

---

## Request a Shift Change  `/me/shift-change`
- **File:** `modules/hrms/shifts/ShiftChangeRequest.tsx`  ·  **Sidebar:** not in sidebar / reached from `/me` "Request Shift Change →" card and from notification deep links (`SHIFT_CHANGE_APPROVED|REJECTED → /me/shift-change`, `core/notifications/notificationStore.ts`)  ·  **Roles:** `RouteGuard anyOf [hrms.ess.read, attendance.checkin.self]` + `ModuleGate hrms` (effectively EMPLOYEE).
- **Status:** LIVE — inline react-query calls `GET /v1/employees/me`, `GET /v1/shifts/employee/{id}`, `GET /v1/shifts?companyId=`, `GET /v1/shifts/change-requests/my`, `POST /v1/shifts/change-requests` (backend `ShiftController`, per the file's header comment).

### Purpose
An employee asks HR to move them to a different shift policy from a chosen date, with a reason, and tracks the status of past requests. Web mirror of the mobile `shift-change` screen.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Employee Self-Service", title "Request a Shift Change", subtitle "Ask HR to move you to a different shift. HR will review and approve or reject.", actions: `HrButton ghost sm` "← Back".
2. **Current shift** read-only `.ut-card-sm`: eyebrow "CURRENT SHIFT", Clock icon + "{shiftName} · 09:00 – 18:00" or "Default (unassigned)".
3. **Pending banner** (amber, only when a PENDING request exists): "You already have a pending shift-change request. Please wait for HR to decide before sending another."
4. **Form** `.ut-card-lg` (hidden while pending): Requested shift `<select>` ("— Select a shift —", options "{name} · 06:00 – 14:00", excludes current shift; helper "No other shifts available to switch to." when none) · Effective from `<input type="date">` (min today, default tomorrow; helper "Defaults to tomorrow. Cannot be in the past.") · Reason textarea (rows 4, placeholder "Why do you want to change shift?", helper "Minimum 10 characters." + counter "0/500") · inline red error box · inline green success box "Request sent. HR will review and notify you." · footer right-aligned `HrButton ghost` "Cancel" + `HrButton primary` "Send request to HR" / "Sending…".
5. **My shift-change requests** `.ut-card` list: each row `requestedShiftName` (bold) / "From {currentShiftName}" / "Submitted 18 Sep 2026" / `HrStatusPill` showing the raw status text (APPROVED ok · PENDING warn · REJECTED red · CANCELLED gray · anything else gray) / italic quoted reason / "HR: {decisionNote}". The whole list is rendered — no cap, no pagination.

`max-w-3xl`, single column.

### Data shown
- Me: `GET /v1/employees/me` → `{id, companyId, firstName, lastName}` (used to derive companyId + employeeId).
- Current shift: `GET /v1/shifts/employee/{employeeId}` → `{shiftPolicyId, shiftName, startTime, endTime}`.
- Shift options: `GET /v1/shifts?companyId={companyId}` → `ShiftPolicy[] {id, name, startTime, endTime, gracePeriodMinutes}`.
- History: `GET /v1/shifts/change-requests/my` → `ChangeRequest[] {currentShiftName, requestedShiftName, reason, status, decisionNote, decidedAt, createdAt}`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Back | header actions | `navigate('/me')` | all viewers | LIVE |
| Requested shift | form select | sets `requestedShiftPolicyId`; disabled while `shifts.isLoading` or when `disableForm` (pending request / no other shifts / me not loaded) | all viewers | LIVE |
| Effective from | form date | sets `effectiveDate` (sent in body; backend `ShiftDtos.CreateShiftChangeRequest` is `(UUID requestedShiftPolicyId, String reason)` only — Jackson drops the field); disabled by `disableForm` | all viewers | PARTIAL (field sent, not persisted server-side) |
| Reason | form textarea | 10–500 chars, live counter of trimmed length; disabled by `disableForm` | all viewers | LIVE |
| Cancel | form footer (ghost; disabled while sending) | `navigate('/me')` | all viewers | LIVE |
| Send request to HR | form footer (primary, submit) | client validate → `POST /v1/shifts/change-requests {requestedShiftPolicyId, effectiveDate, reason}`; on success clears form, invalidates history, shows green box | all viewers | LIVE |

No cancel/withdraw of a pending request exists.

### States
- loading: select disabled while `shifts.isLoading`; no skeletons elsewhere (current shift shows "Default (unassigned)" until loaded).
- empty: history → "Your shift-change requests will appear here."; no other shifts → "No other shifts available to switch to." (select still rendered, form disabled).
- error: client validation → inline red box with one of "Please select a shift to switch to." / "Requested shift must be different from your current shift." / "Please pick an effective date." / "Effective date cannot be in the past." / "Reason must be at least 10 characters." / "Reason must be at most 500 characters."; API error → its message or "Could not submit request. Please try again."; query errors for me/current/shifts/history are not rendered at all.
- special: **pending lock** — form replaced by the amber banner while any request is PENDING; success box "Request sent. HR will review and notify you."
- no-permission: `NoAccess` from RouteGuard.

### Rules & permissions
- Client validation: shift required and ≠ current; effective date required and ≥ today; reason trimmed 10–500 chars (`REASON_MIN/MAX`).
- Only one PENDING request at a time (client-side `hasPending`).
- Employee/company identity resolved from `/v1/employees/me`; form disabled until both `myId` and `companyId` are known.
- HR decides on `/hrms/shifts` (Shifts & Overtime — other brief); notification deep link returns the employee here.

### Gaps & plan  (keep / add / change)
- **Keep:** current-shift card, one-pending lock, validation messages, request history with HR note.
- **Add:** [code: header comment in ShiftChangeRequest.tsx; backend `backend/modules/hrms-attendance/.../dto/ShiftDtos.java` `CreateShiftChangeRequest(requestedShiftPolicyId, reason)`] "`effectiveDate` … forward-compatible when the backend adds the column" — backend does not yet store the effective date; the design should still show it in history rows once persisted. [BLUEPRINT §6 row 14] Shifts & Overtime "Partial … Roster + OT approvals" is the HR-side counterpart. [code] no way to withdraw a pending request (WFH has Cancel; this page has none).
- **Change:** query errors (shift list / current shift / history failing) are silent — add an error EmptyState + Retry. Success feedback is an inline box, while `/me/wfh` uses toasts — pick one. History is a bespoke `<ul>`; render with `DataTable` (Requested shift · From · Effective · Submitted · Status) or keep as a card list but with `EmptyState`.

### Screenshot
`Attach: /me/shift-change — current screen`

### Claude Design prompt (ready to paste)
```
Design the Request a Shift Change page for EMPLOYEE users. max-w-3xl, single column.
HrPageHeader: crumb "Employee Self-Service", title "Request a Shift Change", subtitle "Ask HR to move you to a different shift. HR will review and approve or reject.", actions: ghost sm "← Back".
Current shift card: eyebrow "CURRENT SHIFT", clock icon, "General Shift · 09:00 – 18:00" (or "Default (unassigned)").
Amber banner state (replaces the form when a request is PENDING): "You already have a pending shift-change request. Please wait for HR to decide before sending another."
Form card: HrSelect "Requested shift *" (options "Morning Shift · 06:00 – 14:00", "Night Shift · 22:00 – 06:00"; helper "No other shifts available to switch to." when empty) · date "Effective from *" default tomorrow, helper "Defaults to tomorrow. Cannot be in the past." · textarea "Reason *" placeholder "Why do you want to change shift?", helper "Minimum 10 characters." and counter "0/500" · inline error box (red) e.g. "Reason must be at least 10 characters." · inline success box (green) "Request sent. HR will review and notify you." · footer right: ghost "Cancel", primary "Send request to HR" (busy label "Sending…").
"My shift-change requests" card: rows "Night Shift" / "From General Shift" / "Submitted 18 Sep 2026" / HrStatusPill (Pending warn, Approved ok, Rejected red, Cancelled gray — today the pill prints the raw enum "PENDING"; use HR wording) / italic reason "Childcare in the mornings" / "HR: Approved from 1 Oct". Empty: "Your shift-change requests will appear here."
Keep the one-pending lock and validation copy. Add: an "Effective from" column in history (backend will persist it) and a row action "Withdraw" on PENDING rows (not yet in code — mark as proposed). Change: show an error EmptyState with Retry when shift options or history fail to load.
```

---

## Apply for Work From Home  `/me/wfh`
- **File:** `modules/hrms/wfh/ApplyWfh.tsx` (hook `modules/hrms/api/useWfh.ts`)  ·  **Sidebar:** not in sidebar / reached from `/me` "Request WFH →" card and notification deep links (`WFH_APPROVED|REJECTED|CANCELLED → /me/wfh`)  ·  **Roles:** `RouteGuard anyOf ['wfh.request.self', hrms.ess.read, attendance.checkin.self]` + `ModuleGate hrms` (effectively EMPLOYEE; App.tsx comment: submit will 403 "if the tenant hasn't granted wfh.request.self").
- **Status:** LIVE — `useMyWfhRequests → GET /v1/wfh/my?page=0&size=100` (polls every 30 s), `useApplyWfh → POST /v1/wfh`, `useCancelWfh → POST /v1/wfh/{id}/cancel`.

### Purpose
An employee requests approval to work from home for a date range with a reason, sees their recent WFH requests with status and approver note, and can cancel a request that is still pending. 1:1 mirror of the mobile `wfh-apply` screen.

### Layout (map to the design-system parts)
1. Text link "← Back to dashboard" (above the header).
2. `HrPageHeader` — crumb "Employee Self-Service", title "Apply for Work From Home", subtitle "Request approval to work from home for one or more days". No actions.
3. **Info banner** (mint card, Home icon): "Work From Home" / "Once approved, you can punch in from anywhere on the covered dates — the location check is skipped, but face verification still runs as normal."
4. **Form** `.ut-card-lg`: eyebrow "SELECT WFH DATES"; 2-col `Start Date *` / `End Date *` (`type=date`, default today, min today; end auto-bumps to start); one status line beneath — red "End date must be on or after the start date." / red "Start date cannot be in the past." / red "Overlaps with WFH on 18/09 – 19/09 (PENDING)" / green "3 days of Work From Home"; `Reason / Notes *` textarea (rows 4, placeholder "Briefly explain why you need to work from home...", counter "{n}/500" that appends "  ·  min 10" and turns `text-danger` only while something is typed but under 10 chars); grey hint box with the current `disabledReason` (hidden once the form is valid); full-width bespoke `<button>` "Submit Application" (Send icon; "Submitting..." while pending; disabled whenever a `disabledReason` exists).
5. **Recent WFH Requests** heading + list of `.ut-card-sm` rows (max 10): status icon tile · "18 Sep – 19 Sep 2026" + `HrStatusPill` (Pending warn · Approved ok · Rejected red · Cancelled gray · Awaiting HR purple) · "2 days · "reason"" · italic "Note: {decisionNote}" · text button "Cancel" (PENDING/PENDING_L2 only). `CardSkeleton` while loading; `EmptyState variant="first-run"` "No WFH requests yet" / "Submit one above to see it here."

`max-w-3xl`, single column.

### Data shown
- Requests: `useMyWfhRequests(0, 100)` → `GET /v1/wfh/my` → `PageResponse<WfhRequestResponse>` (fromDate, toDate, reason, status, decisionNote, decidedAt, createdAt). Same list drives the client overlap check.
- Day count is computed client-side (inclusive).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Back to dashboard | top link | `navigate('/me')` | all viewers | LIVE |
| Start Date | form | sets fromDate; bumps toDate forward if now earlier | all viewers | LIVE |
| End Date | form | sets toDate (min = start) | all viewers | LIVE |
| Reason / Notes | form | 10–500 chars | all viewers | LIVE |
| Submit Application | form (full-width bespoke button, `type=button`) | `POST /v1/wfh {fromDate, toDate, reason(trimmed)}`; toast "WFH request submitted" / error toast; resets reason and both dates to today; invalidates `['hrms','wfh']` | `wfh.request.self` (backend) | LIVE |
| Cancel | request row (PENDING / PENDING_L2 only) | `POST /v1/wfh/{id}/cancel`; toast "WFH request cancelled" / error toast; no confirm dialog | all viewers (own requests) | LIVE |

### States
- loading: `CardSkeleton` in the Recent list; form is always rendered.
- empty: `EmptyState first-run` "No WFH requests yet — Submit one above to see it here."
- error: mutation errors via toast ("Failed to submit WFH request" / "Failed to cancel WFH request" fallback); list query error is not rendered (list just stays empty).
- disabled: submit disabled with the reason shown in the grey hint box — "Pick a start date", "Pick an end date", "Start date cannot be in the past", "End date must be on or after the start date", "Reason needs at least 10 characters", "Reason must be 500 characters or fewer", "You already have a WFH request on these dates".
- no-permission: `NoAccess`; or a backend 403 toast on submit if `wfh.request.self` isn't granted.

### Rules & permissions
- Start ≥ today; end ≥ start; reason 10–500 chars; client-side overlap check against own PENDING / APPROVED / PENDING_L2 requests.
- Cancel allowed only while PENDING or PENDING_L2 (awaiting HR second level).
- Approvals happen on `/hrms/leave?tab=approvals` (merged with leave queue per `useWfh.ts` footer; `POST /v1/wfh/{id}/approve|reject`, reject reason required by backend).
- Once approved, location check is skipped on punch, face verification still runs (banner copy).

### Gaps & plan  (keep / add / change)
- **Keep:** date range with live day count and overlap guard, inline disabled-reason hint, request list with note and Cancel.
- **Add:** [BLUEPRINT §6 row 58] "WFH approvals — thin, 5 eps unexposed, `WfhController`, UI C — Approval queue" and [BLUEPRINT §22] "My Approvals: leave · regularization · WFH · expenses ← one queue" (manager side, see Team page). [BLUEPRINT §8.3 drill-down map / PLAN §6 dashboard table] "Work From Home | attendance/dashboard | …&status=WORK_FROM_HOME | ⚠️ unfiltered" (HR dashboard tile, not this page). [code: useWfh.ts `useMyWfhRequests` comment] "There is no WFH *approvals* queue on web yet" (now merged into Leave approvals). [code] the list is capped at 10 with no pagination although the hook fetches 100.
- **Change:** row "Cancel" is a bare text `<button>` that fires immediately with no `useConfirmDialog()` confirm. List-load errors are silent. Submit is a bespoke full-width button rather than `HrButton`/`Button`; "Back" is a loose text link instead of a header action (inconsistent with `/me/shift-change`). Date/status feedback uses hand-picked hex colours instead of tokens.

### Screenshot
`Attach: /me/wfh — current screen`

### Claude Design prompt (ready to paste)
```
Design the Apply for Work From Home page for EMPLOYEE users. max-w-3xl, single column.
HrPageHeader: crumb "Employee Self-Service", title "Apply for Work From Home", subtitle "Request approval to work from home for one or more days", actions: ghost sm "← Back".
Info banner (mint, Home icon): "Work From Home — Once approved, you can punch in from anywhere on the covered dates — the location check is skipped, but face verification still runs as normal."
Form card: eyebrow "SELECT WFH DATES"; two date fields "Start Date *" / "End Date *" (default 23 Sep 2026); one feedback line below in four variants — green "3 days of Work From Home", red "End date must be on or after the start date.", red "Start date cannot be in the past.", red "Overlaps with WFH on 18/09 – 19/09 (PENDING)"; textarea "Reason / Notes *" placeholder "Briefly explain why you need to work from home...", counter "0/500" (becomes red "4/500  ·  min 10" while under 10 chars); grey hint row showing the disabled reason ("Reason needs at least 10 characters"); primary Button "Submit Application" (Send icon, busy "Submitting...", disabled while a hint is showing).
"Recent WFH Requests" list (max 10 cards): status tile icon · "18 Sep – 19 Sep 2026" + HrStatusPill (Pending warn / Approved ok / Rejected red / Cancelled gray / Awaiting HR purple) · "2 days · "Plumber visit at home"" · italic "Note: Approved, keep camera on" · ghost sm "Cancel" only on Pending / Awaiting HR. Loading = SkeletonCard; empty = EmptyState "No WFH requests yet — Submit one above to see it here."
Keep the overlap guard and disabled-reason hint. Add: HrPagination under the list (hook already fetches 100). Change: Cancel becomes an HrButton ghost sm that opens a useConfirmDialog() confirm "Cancel this WFH request?"; Submit becomes an HrButton primary; use tokens (HrStatusPill tones) instead of hex; make Back a header action like the shift-change page.
```

---

## My Payslips  `/me/payslips`
- **File:** `modules/hrms/payroll/EmployeePayslips.tsx` (hook `modules/hrms/api/usePayrollRuns.ts`)  ·  **Sidebar:** Employee Self Service › **My Payslip** (EMPLOYEE); also ⌘K search action "My Payslips — Download your payslips" (`shared/search/actionRegistry.ts`)  ·  **Roles:** sidebar EMPLOYEE; route `RouteGuard anyOf [payroll.payslip.read.self]` + `ModuleGate payroll`.
- **Status:** LIVE — `useMyPayslips → GET /v1/payroll/payslips/me`; PDF via `downloadMyPayslipPdf → GET /v1/payroll/payslips/me/{runId}.pdf` (blob download).

### Purpose
An employee lists their payslips per payroll period and downloads the PDF for locked/paid months.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Payroll", title "My Payslips", subtitle "Download payslips for finalized payroll periods." No actions.
2. `TableCard` (no toolbar) wrapping `DataTable` (`keyField="runId"`), columns: **Month / Year** (`period`, bold) · **Paid Days** (`paidDays`, or "22 / 3" when `lopDays` > 0, right-aligned tabular) · **Gross Earnings** (`inr2(gross)` → ₹1,20,000.00) · **Total Deductions** (`inr2(totalDeductions)`) · **Net Paid** (`inr2(netPay)`, bold emerald) · **Status** (`HrStatusPill` with the raw status text: DRAFT gray · PROCESSING info · LOCKED ok · PAID ok · CANCELLED red) · action column (`HrButton ghost sm` Download icon + "PDF" for LOCKED/PAID, else muted text "Not ready").
3. `EmptyState` (icon FileText) "No payslips yet" / "Payslips appear here once payroll is locked for a period." when the list is empty.

`max-w-3xl`, page-level `CardSkeleton` while loading.

### Data shown
- `useMyPayslips()` → `GET /v1/payroll/payslips/me` → `MyPayslip[] {runId, period, periodMonth, periodYear, paidDays?, lopDays?, gross?, totalDeductions?, netPay, status, lockedAt?}`. Nulls render "—" (type comment: "a tenant that isn't tracking LOP won't have paidDays / lopDays").

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| PDF | row (ghost sm, only when status LOCKED or PAID) | `downloadMyPayslipPdf(runId)` → `GET /v1/payroll/payslips/me/{runId}.pdf`, browser download `payslip-{runId}.pdf`; error → toast | `payroll.payslip.read.self` | LIVE |
| Not ready | row (muted text, DRAFT/PROCESSING/CANCELLED) | nothing | — | disabled state |

No search, filters, pagination, year switch, or row click/detail view.

### States
- loading: `CardSkeleton` replaces the whole page (header included).
- empty: "No payslips yet — Payslips appear here once payroll is locked for a period."
- error: not handled — a failed query falls through to the empty state (no error message, no Retry).
- no-permission: `NoAccess`; also hidden if the `payroll` module is inactive.

### Rules & permissions
- Only the caller's own payslips (`/payslips/me`, JWT identity). PDF only for LOCKED/PAID runs. Payroll module must be active.

### Gaps & plan  (keep / add / change)
- **Keep:** the 5-figure row (period, paid/LOP days, gross, deductions, net) and PDF download — BLUEPRINT §6 row 27 rates "Processing & Payslips — Strong — Run lifecycle + PDF — Keep"; BLUEPRINT §15 (Payroll) lists "payslip PDFs" under "Working and tested".
- **Add:** [BLUEPRINT §21 / PLAN §17] "My Payslips — downloads, salary structure" — the salary structure view exists at `/me/salary` but this page does not link to it. [BLUEPRINT §6 row 56] ESS "Coherent workspace". [PLAN §7.2 Payroll tab] "Structure + history + payslips". [code] no year filter or pagination on the list; no on-screen payslip detail (only PDF).
- **Change:** query error is invisible (`useMyPayslips()` result's `error` is never read, so a failed fetch shows "No payslips yet") — add error `EmptyState` + Retry. Loading hides the page header; use `TableSkeleton` inside the card instead. "Not ready" gives no hint of when it becomes ready (status pill already says DRAFT/PROCESSING — consider a tooltip).

### Screenshot
`Attach: /me/payslips — current screen`

### Claude Design prompt (ready to paste)
```
Design the My Payslips page for EMPLOYEE users (permission payroll.payslip.read.self). max-w-3xl.
HrPageHeader: crumb "Payroll", title "My Payslips", subtitle "Download payslips for finalized payroll periods.", actions: ghost "View salary structure" (links to /me/salary — add).
TableCard (no search) with DataTable columns: Month / Year ("Aug 2026", bold) · Paid Days ("22" or "22 / 3" where the second number is LOP days, right-aligned tabular-nums) · Gross Earnings (₹1,20,000.00) · Total Deductions (₹14,250.00) · Net Paid (₹1,05,750.00, bold emerald) · Status HrStatusPill (Draft gray / Processing info / Locked ok / Paid ok / Cancelled red — today the pill prints the raw "LOCKED") · row action HrButton ghost sm with a Download icon + "PDF" for Locked/Paid, muted "Not ready" otherwise. Null figures render "—".
States: loading = TableSkeleton inside the card (keep the header visible); empty = EmptyState icon FileText "No payslips yet" / "Payslips appear here once payroll is locked for a period."; error = EmptyState "Couldn't load payslips" + Retry (missing today).
Keep the 5 money/day columns and the PDF-only-when-locked rule. Add: a year HrSelect in the toolbar and HrPagination footer. Change: nothing else — do not add search.
```

---

## My Salary  `/me/salary`
- **File:** `modules/hrms/payroll/MySalaryStructure.tsx` (hook `modules/hrms/api/usePayroll.ts`)  ·  **Sidebar:** not in sidebar and not linked from any screen, search action or notification (grep for `/me/salary` hits only `App.tsx`)  ·  **Roles:** `RouteGuard anyOf [payroll.structure.read.self]` + `ModuleGate payroll`.
- **Status:** DEAD (unreachable) — fully wired (`useMySalaryStructure → GET /v1/payroll/structures/me`) and renders server data, but nothing navigates to it; only a typed URL reaches it.

### Purpose
An employee sees their current salary structure: annual/monthly CTC, full-month gross, deductions and take-home, tax regime and PF status, and the component-wise earnings and deductions.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Payroll", title "My Salary", subtitle "Effective from 1 Apr 2026" (`effectiveFrom`). No actions.
2. **KPI strip** of 4 `HrStatCard`: Annual CTC (orange, `inr(ctcAnnual)`, sub "₹1,00,000 / month") · Gross / mo (green, `grossMonthly ?? ctcMonthly`) · Deductions / mo (red, `totalDeductions ?? 0`) · Take-home / mo (blue, `netMonthly ?? ctcMonthly`). `inr` = ₹ + en-IN, 0 decimals.
3. **Pill row**: `HrStatusPill info` "Tax regime: NEW" · `HrStatusPill ok|gray` "🛡 PF · ACTIVE" or "PF not applicable".
4. **Earnings** `TableCard` (`hr-table`): Component · Type (`HrStatusPill`: EARNING ok / DEDUCTION red / other info, label with `_` → space; hidden on mobile) · Monthly (`hr-mono`) · Annual (monthly × 12; hidden on mobile) + bold Total row (`grossMonthly`, only when non-null). Rows = `earnings ?? lines`; the whole table (and its heading) is hidden when there are no rows.
5. **Deductions** `TableCard` — same columns, rows = `deductions ?? []`, Total = `totalDeductions`. Hidden when empty.
6. Footnote: "Full-month figures. Your actual payslip is pro-rated by paid days, so a month with unpaid leave will pay less. Contact HR if something looks wrong."

`max-w-3xl`. `employerContributions` is returned by the API but not rendered.

### Data shown
- `useMySalaryStructure()` → `GET /v1/payroll/structures/me` → `EmployeeSalaryStructure | null` (ctcAnnual, ctcMonthly, pfApplicable, pfStatus, taxRegime OLD|NEW, effectiveFrom, isCurrent, revisionNote, lines[], earnings?[], deductions?[], employerContributions?[], grossMonthly?, totalDeductions?, netMonthly?). Lines: componentCode, componentName, category, monthlyAmount. Type comment: server computes statutory lines (PF/ESI/PT) and full-month totals so "a freshly onboarded employee" no longer shows ₹0.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| — | — | Page has no buttons, links, filters or forms | — | — |

### States
- loading: `CardSkeleton` alone in a `p-8` wrapper — no `HrPageHeader`.
- error: `EmptyState` (FileText) "Couldn't load your salary" / "Please try again." (no Retry button, no header).
- empty (`null` structure): `EmptyState` "No salary structure — Your salary structure has not been set up yet. Contact HR if you think this is a mistake." (no header).
- no-permission: `NoAccess`; hidden if payroll module inactive.

### Rules & permissions
- Own structure only (`/structures/me`). Figures are full-month with no LOP; payslips are pro-rated (footnote). Employer contributions never shown to the employee. HR edits structures on `/hrms/salary-structure` (FIN roles, other brief).

### Gaps & plan  (keep / add / change)
- **Keep:** the CTC / gross / deductions / take-home strip (file comment: "take-home is the number they came here for"), regime and PF pills, earnings + deductions breakdown with totals, the pro-rating footnote.
- **Add:** [code: App.tsx only] a navigation entry — sidebar "Employee Self Service" or a link from `/me` and `/me/payslips` (BLUEPRINT §21 / PLAN §17 put "salary structure" under My Payslips). [PLAN §7.2 Payroll tab] "Structure + history + payslips — `structures/employee/{id}` — Extend": structure revision history (`isCurrent`, `revisionNote` are in the payload, unused). [code] `employerContributions` returned but not displayed.
- **Change:** error state has no Retry, and loading/error/empty all drop the `HrPageHeader`. Both breakdown tables are raw `hr-table` inside `TableCard` — use `DataTable`. No link back to payslips.

### Screenshot
`Attach: /me/salary — current screen`

### Claude Design prompt (ready to paste)
```
Design the My Salary page for EMPLOYEE users (permission payroll.structure.read.self). max-w-3xl.
HrPageHeader: crumb "Payroll", title "My Salary", subtitle "Effective from 1 Apr 2026", actions: ghost "My payslips" (→ /me/payslips — add).
KPI strip, 4 HrStatCard: Annual CTC ₹12,00,000 (orange, sub "₹1,00,000 / month") · Gross / mo ₹1,00,000 (green) · Deductions / mo ₹8,400 (red) · Take-home / mo ₹91,600 (blue).
Pill row: HrStatusPill info "Tax regime: NEW" · HrStatusPill ok "PF · ACTIVE" (or gray "PF not applicable").
"Earnings" TableCard → DataTable columns Component (Basic, HRA, Special Allowance) · Type pill (Earning ok) · Monthly (₹50,000, tabular) · Annual (₹6,00,000) · bold Total row ₹1,00,000. "Deductions" TableCard same columns (Provident Fund, Professional Tax; Type pill Deduction red), Total ₹8,400; hide when empty.
Footnote: "Full-month figures. Your actual payslip is pro-rated by paid days, so a month with unpaid leave will pay less. Contact HR if something looks wrong."
States (keep the HrPageHeader visible in all three — today it disappears): loading SkeletonCard; error EmptyState "Couldn't load your salary" + Retry; empty EmptyState "No salary structure — Your salary structure has not been set up yet. Contact HR if you think this is a mistake."
Keep the four KPIs and two breakdowns. Add: a collapsed "Employer contributions" table (API returns it) and a small "Revision" line (revisionNote). Change: this page is unreachable today — give it a sidebar entry under Employee Self Service ("My Salary") and links from /me and /me/payslips.
```

---

## My Team (Team Dashboard)  `/team`
- **File:** `modules/hrms/team/TeamDashboard.tsx` (+ `team/TeamSchedule.tsx`)  ·  **Sidebar:** top-level **My Team** (DEPT_MANAGER, MANAGER via alias) and Employee Self Service › **Team Attendance** (DEPT_MANAGER)  ·  **Roles:** sidebar DEPT_MANAGER; route `RouteGuard anyOf [attendance.team.read, hrms.leave.approve.l1]` + `ModuleGate hrms` (App.tsx comment: HRMS_EMPLOYEE_READ was removed so HR/admin don't land here from directory deep links). Note: the `/` root route (`RoleAwareLanding`) sends everyone to `/modules`, not here — managers reach `/team` via the sidebar.
- **Status:** LIVE — `useTeamDashboard(today) → GET /v1/attendance/dashboard?date=` (refetch every 60 s), `usePendingApprovals(0) → GET /v1/leave/approvals/pending?page=0&size=20` (refetch every 30 s), `GET /v1/team/schedule?from&to` (roster, permission `attendance.team.read`).

### Purpose
A department manager's morning view: how many of the team are present / absent / on leave today, who punched in and when, this week's shift roster for their scoped employees, and how many leave approvals are waiting for them.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Good morning, Rahul — your team today", subtitle "Wednesday, 23 September 2026". No actions.
2. **KPI strip** of 4 `HrStatCard` (`grid-cols-2 sm:grid-cols-4`, `loading` prop): Present today (green, `counts.present`) · Absent today (red, `counts.absent`) · On leave (blue, `counts.onLeave`) · Pending approvals (orange, `approvals.content.length`). Not clickable.
3. **Team attendance — 23 Sep** `.ut-card`: header with Users icon + link "Full view →"; raw `<table>` (first 8 staff only) columns: Team Member (`HrAvatar name sub=""`) · Punch In (`hh:mm a`) · Punch Out · Role (`jobTitle ?? departmentName`) · Today Status (`HrStatusPill`: PRESENT/CHECKED_IN ok · ABSENT red · LATE late · else gray; label lower-cased with `_` → space then CSS-capitalised, e.g. "Present", "Checked in").
4. **Team shift roster** (`TeamSchedule.tsx`, only with `attendance.team.read`) `.ut-card`: title + helper "Effective shift assignments. Leave, holidays and weekly offs are shown in attendance."; week nav `HrButton ghost` "Previous week" · "22 Sep – 28 Sep 2026" · "Next week"; grid table: Employee (`<Link>` to `/hrms/employees/{id}`) + 7 day columns "Mon 22 … Sun 28", cell = shiftName or "Unassigned" + "09:00–18:00"; footer pager ghost `HrButton` "Previous" (disabled on page 1) · "1 / 2" · "Next" (disabled on the last page); 10 employees per page, client-side.
5. **Pending leave approvals** `.ut-card` (only when ≥1): header Clock icon + title + `HrStatusPill warn` count + `HrButton sm` "Approve →"; up to 5 rows: `leaveTypeName` / "18 Sep – 20 Sep · 3d" / `HrStatusPill warn` "Pending". Employee name is NOT shown although the response carries `employeeName`/`employeeCode`.

`max-w-6xl`.

### Data shown
- Counts + staff: `useTeamDashboard(today)` → `GET /v1/attendance/dashboard?date=2026-09-23` → `{date, counts{present, absent, onLeave,…}, staffStatuses[] {employeeId, employeeCode, fullName, jobTitle, departmentName, profilePhotoUrl, status, checkInAt, checkOutAt, locationName, …}}`. Only fullName, jobTitle/departmentName, checkInAt/checkOutAt, status are rendered.
- Approvals: `usePendingApprovals(0)` → `GET /v1/leave/approvals/pending?page=0&size=20` → `LeaveRequestResponse[]` (leaveTypeName, startDate, endDate, totalDays, employeeName, employeeCode, status).
- Roster: `GET /v1/team/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{employeeId, employeeName, date, shiftName?, startTime?, endTime?}[]` (react-query key `['team','schedule',from,to]`).
- Manager first name: `useAuthStore.user`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Full view → | Team attendance card header (text link) | `navigate('/hrms/attendance')` — no `?tab=team`; `Attendance.tsx` (title "Attendance") falls back to the "my" tab when the manager holds `attendance.checkin.self`, so they land on their own attendance, not the team tab | all viewers | LIVE (wrong tab for most managers) |
| Previous week / Next week | roster header (ghost) | shifts the 7-day window, resets page, re-queries `/v1/team/schedule` | `attendance.team.read` | LIVE |
| Employee name | roster row (`<Link>`) | `/hrms/employees/{employeeId}` (employee workspace; may NoAccess without `hrms.employee.read`) | `attendance.team.read` | LIVE |
| Retry | roster error | `refetch()` | `attendance.team.read` | LIVE |
| Previous / Next | roster footer pager (ghost; disabled at the ends) | client-side page of 10 employees | `attendance.team.read` | LIVE |
| Approve → | Pending leave approvals header (`HrButton sm`, primary) | `navigate('/hrms/leave')` — no `?tab=approvals`, so `Leave.tsx` opens its first visible tab ("My Leaves"); the approvals tab (`?tab=approvals`, gated `hrms.leave.approve.l1`) is one click further | all viewers | LIVE (no in-place approve; lands on the wrong tab) |

No date picker for the attendance table, no department filter, no row click on staff, no search.

### States
- loading: `HrStatCard loading`; attendance table → "Loading…"; roster → "Loading schedule...".
- empty: attendance → "No team data available for today"; roster → "No employees in your team scope."; pending approvals card hidden entirely when there are none.
- error: roster → raw `error.message` + Retry; dashboard and approvals query errors are not rendered (cards show 0 / empty).
- no-permission: `NoAccess`; the roster section silently disappears without `attendance.team.read`.

### Rules & permissions
- Team scope is server-side (`TeamEmployeeScope.java` — HANDOFF §5: "Shared team scope preserves admin/department/direct-report behavior"); the UI never passes an employee id.
- Roster shows effective shift assignments only — HANDOFF §12 / STATUS "Important limits": "Team roster shows effective assignments, not a leave/holiday/weekly-off planning engine."
- Staff table capped at 8 rows, approvals at 5, roster paged 10 per page. The "Pending approvals" KPI is `approvals.content.length` — the first page of 20 — so it never reads above 20.
- Leave approval decisions require `hrms.leave.approve.l1` and are made on `/hrms/leave`.

### Gaps & plan  (keep / add / change)
- **Keep:** four KPIs, today's punch table with status pills, weekly roster with effective assignments (STATUS: "Team schedules — Actual effective shift assignments for the manager's scoped employees, weekly navigation — verified"), pending-approval count.
- **Add:** [BLUEPRINT §6 row 57] "Team Attendance — `/team` — Partial — UX B — Add drill-down". [BLUEPRINT §22 / PLAN §17] "My Team: Team Attendance (who's in, late, absent — drill-through) · My Approvals (leave · regularization · WFH · expenses ← one queue) · Team Leave (calendar) · Team Performance" and "The single highest-value manager feature is a unified approvals inbox". [BLUEPRINT §6 row 58] WFH approvals queue — pending WFH requests are not counted or listed here. [HANDOFF §12] roster does not show leave/holidays/weekly offs ("Expand roster visibility for leave/holidays/weekly offs if required"). [code] `employeeName`/`employeeCode` available on approvals but not rendered; `employeeCode`, `locationName`, `profilePhotoUrl` on staff not rendered; KPI cards are not `onClick` drill-downs.
- **Change:** "Approve →" navigates to `/hrms/leave` without `?tab=approvals` (lands on "My Leaves") instead of approving in place — a per-row Approve/Reject (using `useLeaveDecision → POST /v1/leave/{id}/decision`) or at least the `?tab=approvals` deep link (which `Leave.tsx` and `actionRegistry.ts` already use) would be more direct. "Full view →" likewise omits `?tab=team`, so a manager who also punches in lands on their own "my" tab. Pending-approvals card disappears when empty (no "All caught up" state). Attendance table shows only 8 rows with no "and N more" hint. Dashboard/approvals fetch errors are invisible. Both tables are raw `<table>`s — use `TableCard`+`DataTable`. Greeting title mixes the manager's name into `HrPageHeader.title`.

### Screenshot
`Attach: /team — current screen`

### Claude Design prompt (ready to paste)
```
Design the My Team dashboard for DEPT_MANAGER users (permissions attendance.team.read / hrms.leave.approve.l1). max-w-6xl.
HrPageHeader: crumb "Attendance & Time", title "Good morning, Rahul — your team today", subtitle "Wednesday, 23 September 2026"; actions: HrButton ghost "Full attendance view" (→ /hrms/attendance?tab=team).
KPI strip, 4 HrStatCard with onClick drill-down: Present today 14 (green) · Absent today 2 (red) · On leave 1 (blue) · Pending approvals 3 (orange).
"Team attendance — 23 Sep" TableCard (add a search box) → DataTable: Team Member (HrAvatar "Anjali Mehta" sub "EMP-0142 · Sales") · Punch In (09:04 AM) · Punch Out (— or 06:12 PM) · Role (Sales Executive) · Today Status HrStatusPill (Present ok / Checked in ok / Late late / Absent red / Weekly off gray). Footer "Showing 8 of 16 · Full view →". Empty "No team data available for today".
"Team shift roster" TableCard: helper "Effective shift assignments. Leave, holidays and weekly offs are shown in attendance."; toolbar ghost "Previous week" · "22 Sep – 28 Sep 2026" · "Next week"; grid: Employee (link) + 7 columns "Mon 22 … Sun 28", cell "General" + "09:00–18:00" or muted "Unassigned"; HrPagination "1 / 2" (10 per page). Empty "No employees in your team scope."; error EmptyState + Retry.
"Pending leave approvals" card: header HrStatusPill warn "3", HrButton sm "Approve →" (→ /hrms/leave?tab=approvals); rows "Anjali Mehta · Casual Leave · 18 Sep – 20 Sep · 3d" with HrStatusPill warn "Pending" (add the employee name — API returns it). EmptyState "All caught up — no approvals waiting" (today the card is hidden).
Keep the 4 KPIs, punch table and weekly roster. Add (blueprint §22): a unified "My Approvals" queue block that also counts WFH requests, and Approve / Reject row actions. Change: KPIs become drill-downs to /hrms/attendance?tab=team&status=…; rebuild both tables with DataTable.
```
