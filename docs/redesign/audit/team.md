# Team audit: Team today, Team schedule, Approvals inbox (Phase 0, read-only)

Area: the manager's **My team** module. Prototype files (all in `design_handoff_hrms_redesign/prototype/`):
`TeamToday.dc.html`, `TeamSchedule.dc.html`, `TeamApprovals.dc.html` (shell deep links `#manager/team/t-today/0`,
`#manager/team/t-sched/0`, `#manager/team/t-appr/<0..4>`; nav model `hrms-core.js` → `M.team` = pages
`t-today` "Team today", `t-sched` "Team schedule", `t-appr` "Approvals" with tabs All, Leave, Attendance, Requests, Expenses).

Repo: `main` at `e32a4dc6`. Everything below was read in the repo, checked in the recovery database
(`unifiedtree_recovery`) and, where marked "verified live", checked with GET calls to the local API as
`mgr@` (DEPT_MANAGER), `owner@` and `reader@` on 27 Sep 2026 (a Sunday). Sample data in `emp-data.js` was used only
to learn which data points each screen shows.

Paths below are relative to `apps/platform/src` (web) or `backend/` (API) unless written in full.

---

## 0. Summary

- **Team today** exists as `/team` (`modules/hrms/team/TeamDashboard.tsx`), but with a different layout: 4 tiles,
  leave-only approvals (top 5), "Who's in today" and the week's shift roster at the bottom. The design adds 5
  status tiles that filter the roster, punch source per person, "Send a reminder", "Waiting for you" across all
  request kinds, a probation card, a reviews card and "Out soon". About half of its data exists today; the
  probation card, reminders, out-soon, punch method, leave type, team label/size and review due dates need backend work.
- **Team schedule** exists only as a panel inside `/team` (`team/TeamSchedule.tsx`, `GET /v1/team/schedule`). It
  shows shifts only. The design also shows approved and pending leave and work from home, holidays, weekly offs and
  a per-day "in the office" count. None of that is in the endpoint today.
- **Approvals inbox** does not exist. Today the five request kinds are decided on four different admin pages
  (Leave → Approvals for leave + WFH, Daily Tracking → Regularization, Shifts & Overtime → Shift Requests,
  Expense Center → Approvals). All five list and decide endpoints exist and are team-scoped; the inbox itself, the
  per-kind "facts" and "warnings", "Approve all with no warnings" and **Undo** do not.
- **Undo: no API exists.** No endpoint, no decision journal; every decision notifies the employee on commit. §6
  specifies it end to end: one new table (JDBC only), five undo endpoints on the existing modules, guards per kind,
  a "decision undone" notification, audit, hooks and tests. Size L.
- No existing route or URL has to change. The three pages fit the existing `/team` route (views), which is what the
  shell audit proposes.
- Two backend behaviours the design copy contradicts: probation "extends by a month on its own" (the setting is
  stored but never applied) and leave "would be unpaid" (applying beyond the balance is refused today).
- One existing mismatch to fix or handle: a manager's leave/WFH queue can show requests that the decide endpoint
  then refuses (§10, R5).

---

## 1. Where things are today

### 1.1 Route, menu, rail

| Item | Where | Rule today |
|---|---|---|
| Route `/team` | `App.tsx` L306–313 | `RouteGuard anyOf [attendance.team.read, hrms.leave.approve.l1]` + `ModuleGate hrms` |
| Registry / ⌘K / menu | `shared/navigation/pageRegistry.ts` L118 | `page('team', 'My team', '/team', …)`: anyOf `attendance.team.read`, `hrms.leave.approve.l1`, **noneOf `hrms.employee.read`**, module `hrms` |
| Rail item | `layouts/PlatformShell.tsx` L72 | flat item `myteam` "My Team" → `/team`; shown by `menuRule('/team')` (the `visibleForRoles` lists are no longer read, L441–462) |
| "Me" tab | `PlatformShell.tsx` L181 | ESS child "Team Attendance" → `/team`, same rule; the whole ESS group is hidden for OWNER/SUPER_ADMIN/COMPANY_ADMIN/ADMIN (L457) |
| Rail highlight | `layouts/railLit.ts` | `myteam` + `ess` both own `/team`; the item you came through stays lit; `railViaOn` compares the **pathname only**, so `?view=` changes keep the same item lit |
| Employee page links | `App.tsx` L335–342 | `/hrms/employees/:id` allows `attendance.team.read` too (backend scopes to the manager's reports), but `TeamSchedule.tsx` links names only with `hrms.employee.read` |
| Module guard (API) | `app/hrms-api/.../saasguard/TenantModuleGuard.java` L37–63 | `/v1/team` is **not** in `MODULE_PATHS`, so `/v1/team/**` skips the module check |

### 1.2 What `/team` renders today (`TeamDashboard.tsx`)

- Title: greeting "Good morning/afternoon/evening, {greetingName}" (browser-local hour), subtitle with today's date.
- Action: "Team attendance" → `/hrms/attendance` (only with `attendance.team.read`).
- Tiles (`attendance.team.read`): Present (`counts.present`), Not marked yet (`counts.notMarked`), On leave (`counts.onLeave`),
  plus "Waiting for you" (leave pending total, only with `hrms.leave.approve.l1`). These are the API's raw counts, not
  the one-bucket-per-person rule the admin pages use (`attendance/attendanceBuckets.ts → dayBuckets`).
- "Leave waiting for your OK": first 5 of `usePendingApprovals`, decided in place with `ApprovalList` (note textarea) → `useLeaveDecision`.
- "Who's in today": `staffStatuses` rows, "In {time} · Out {time}", status pill.
- `<TeamSchedule />`: "Shift roster" week grid, ← Previous / This week / Next →, 10 people per page, note "These are the shifts assigned…".
- Empty "No team access" when neither permission is held.

### 1.3 Who can list and decide each request kind today (backend + hooks)

| Kind | List endpoint (hook) | List permission + scope | Decide endpoint (hook) | Decide permission + object check | Reject needs a reason? | Web page today |
|---|---|---|---|---|---|---|
| Leave | `GET /v1/leave/approvals/pending` (`usePendingApprovals`, `api/useLeave.ts` L142) | `@perm.check('hrms.leave.approve.l1')`; holders of `hrms.leave.approve.l2` get every pending leave in the tenant, others get `approver_id = me OR applicant's reporting_manager_id = me OR applicant's department head = me` (`LeaveRequestRepository.findPendingForManager`) | `POST /v1/leave/{id}/decision` (`useLeaveDecision`, L196) | same permission + `ApproverScopeGuard` (l2 = tenant-wide, else TeamEmployeeScope) + self-approval guard + status must be PENDING | no | `/hrms/leave?tab=approvals` |
| WFH | `GET /v1/wfh/pending-approvals` (`usePendingWfhApprovals`) | `hasAuthority('wfh.approve')`; l2 → tenant-wide, else the same broadened manager match | `POST /v1/wfh/{id}/approve` · `/reject` (`useWfhDecision`) | `wfh.approve` + `ApproverScopeGuard` | **yes** (`WFH_REJECT_REASON_REQUIRED`, `WfhController` L203) | same Leave tab (needs `hrms.leave.approve.l1` to see the tab) |
| Attendance fix (regularization) | `GET /v1/attendance/corrections/approvals?status=PENDING` (`useCorrectionApprovals`, `api/useAttendance.ts` L376) | `attendance.regularization.approve`; scope = `TeamEmployeeScope` (org-wide with `attendance.workforce.admin`) | `POST /v1/attendance/corrections/{id}/decision` (`useDecideCorrection`, L431) | same + `ApproverScopeGuard` | no | `/hrms/attendance` → Regularization |
| Shift change | `GET /v1/shifts/change-requests/pending` (`usePendingShiftRequests`, `api/useShiftRequests.ts`) | `attendance.regularization.approve`; scope = `ShiftController.approverScope` (org-wide with `attendance.workforce.admin`, else TeamEmployeeScope); expired ones left out | `POST /v1/shifts/change-requests/{id}/decision` (`useDecideShiftRequest`) | same + team check; approving creates a shift assignment from the requested date | no | `/hrms/shifts?tab=requests` |
| Expense claim | `GET /v1/expense/claims/approvals` (`usePendingExpenseApprovals`, `api/useExpense.ts` L102) | `claim.approve` or `reimbursement`; `reimbursement` holders see the tenant, others `approver_id = me`; returns **SUBMITTED and APPROVED** (awaiting reimbursement) | `POST /v1/expense/claims/{id}/decision` (`useExpenseDecision`, L185) | `@perm.check('hrms.expense.claim.approve')` + assigned approver (or `reimbursement` holder) | no | `/hrms/expenses?tab=approvals` |

`TeamEmployeeScope` (`app/hrms-api/.../attendance/TeamEmployeeScope.java`): with `attendance.workforce.admin` the whole
company; otherwise everyone in the department(s) the caller heads, else their direct reports; never the caller.

### 1.4 Built-in roles (system seeds, read from `rbac.role_permissions`)

| Role | Team-relevant permissions held |
|---|---|
| DEPT_MANAGER (`mgr@`) | `attendance.team.read`, `hrms.leave.approve.l1`, `wfh.approve`, `attendance.regularization.approve`, `hrms.expense.claim.approve`, `hrms.performance.read`, `attendance.status.review/override`, `attendance.overtime.approve`, `hrms.advance.approve`, `hrms.learning.skill.approve`, `hrms.employee.team.manage`, `org.company.read`. **Not** `hrms.employee.read/write`, not `hrms.probation.*`, not `hrms.expense.policy.read`, not `hrms.leave.approve.l2` |
| MANAGER | `attendance.team.read`, `attendance.overtime.approve` only (no approvals) |
| HR_MANAGER | all of the above kinds + `hrms.leave.approve.l2`, `attendance.workforce.admin`, `hrms.employee.read/write`, probation perms |
| FINANCE_LEAD | `attendance.team.read`, `wfh.approve`, `hrms.employee.read`, `hrms.expense.reimbursement` (no leave approve, no `claim.approve`) |
| OWNER, SUPER_ADMIN, ADMIN | everything above |
| EMPLOYEE (`reader@`) | none (verified live: `/v1/team/schedule` and `/v1/attendance/dashboard` → 403) |

---

## 2. Proposed page map (no URL removed or renamed)

Follow the shell audit (`shell.md` §3.2, G20): one module, one route.

| Design page | URL | Page/tab rule (registry `tab('team', …)`) |
|---|---|---|
| Team today | `/team` (unchanged) | unchanged: anyOf `attendance.team.read`, `hrms.leave.approve.l1`, noneOf `hrms.employee.read`, module hrms |
| Team schedule | `/team?view=schedule` | + `attendance.team.read` (the API's permission) |
| Approvals | `/team?view=approvals&tab=all\|leave\|attendance\|requests\|expenses` | + anyOf `hrms.leave.approve.l1`, `wfh.approve`, `attendance.regularization.approve`, `hrms.expense.claim.approve`; each tab only with its own kind's permission (Requests = `wfh.approve` or `attendance.regularization.approve`) |

- The `/team` RouteGuard should widen to the same four approve permissions so a custom role that can only approve,
  say, expense claims can open Approvals. For the built-in roles nothing changes (everyone holding an approve
  permission already holds `attendance.team.read` or `hrms.leave.approve.l1`).
- Keep the rail key `myteam`, the path `/team` and the `team` registry id (unit tests read them).
- Add ⌘K entries (the prototype's manager search actions "Review approvals", "Team schedule").

---

## 3. Team today (`TeamToday.dc.html`)

**Maps to:** `/team` → `modules/hrms/team/TeamDashboard.tsx` (exists; layout changes). Page width 1320, padding per README.
Header pill: the shell's single solid pill "Team today" (page without tabs) + the "My team" pages button.

### 3.1 Data points

Status: **E** exists · **P** partial (what is missing) · **M** missing. "G#" refers to §7.

| # | Design element | Source today | Status |
|---|---|---|---|
| D1 | Date "Friday, 25 September" | client, IST (`istToday` in `design/dc/dates.ts`; today's page uses browser-local `todayIso()`) | E |
| D2 | Team label "Engineering" (the department(s) the manager heads) | none; `staffStatuses[].departmentName` only for people on today's roster | M (G1) |
| D3 | "8 people report to you" (team size) | `/v1/attendance/dashboard` drops people on their weekly off (verified live: Sunday → 0 rows for a manager with 1 report); `/v1/team/schedule` gives the whole team but no departments | P (G1) |
| D4 | "Approvals · 7" count | sum of 5 hooks' totals; expense total counts APPROVED claims awaiting reimbursement too | P (G9, G10) |
| D5 | Tile "In the office" (count) | `dayBuckets(useTeamDashboard).regular` (PRESENT, not WFH) | E |
| D6 | Its note "Face or mobile punch" | `GET /v1/attendance/dashboard/sources` gives team-scoped counts per punch method (includes late/WFH people) | P (label or per-method line) |
| D7 | Tile "Late" | `dayBuckets.late` | E |
| D8 | Its note "After the 15 min grace" | `staffStatuses[].graceMinutes` (write "their grace period" when people differ) | E |
| D9 | Tile "At home" | `dayBuckets.wfh` (a WFH punch type is only set on an approved WFH day: `AttendanceService.isApprovedWfhDay`) | E |
| D10 | Tile "On leave" | `dayBuckets.onLeave` | E |
| D11 | Tile "Not in yet" | `dayBuckets.notMarked` | E |
| D12 | (not in the design) Half day | `dayBuckets.halfDay` | E, needs a tile (C4) |
| D13 | Roster title "Who's in · 8 people" / "Late · 1" | client from rows | E |
| D14 | Row avatar initials, name | `staffStatuses[].fullName`, `profilePhotoUrl` | E |
| D15 | Row role line (job title) | `staffStatuses[].jobTitle` | E |
| D16 | Row annotations "· joined 1 Sep", "· probation" | none in the dashboard row (`joinedOn` is in `/v1/team/schedule`; employment status nowhere for managers) | M (G1) |
| D17 | "In at 09:24" | `checkInAt` | E |
| D18 | Punch source "Face" / "Mobile" / "Web" | not in `StaffStatusResponse` (the record has `check_in_method`) | M (G2) |
| D19 | Location "BLR-HQ" / "geofence" | `locationName`, `outsideGeofence` | E |
| D20 | On-leave text "Sick leave · today" | `onLeave` only; no leave type | P (G2) |
| D21 | "No punch yet" | derived (`checkInAt` null, not on leave) | E |
| D22 | Status pill In / Late / Home / On leave | `effectiveStatus` + `attendanceType` | E |
| D23 | "Reminder sent" state (survives reload) | none | M (G3) |
| D24 | Team members off today (weekly off / holiday) | dropped by the dashboard roster | M (G1) |
| D25 | "Waiting for you": 3 newest requests (who, what · n, when) | 5 separate hooks, merged client-side | P (G9) |
| D26 | Decided line "Approved · Priya has been told" | after the mutation | E |
| D27 | Probation: "Probation ends Mon, 5 Oct · in 10 days", name · role | `GET /v1/probation/upcoming` needs `hrms.employee.read` (verified live: 403 for mgr@) | M for managers (G4) |
| D28 | "Decide before then, or it extends by a month on its own." | `GET /v1/probation/config` is 403 for managers **and** auto-extend is never applied (C8) | M (G4, G5) |
| D29 | Reviews: cycle name "Q3 reviews" | `GET /v1/performance/cycles` (`useReviewCycles`, `hrms.performance.read`); 6 ACTIVE test cycles exist in the demo tenant, so a pick rule is needed | E (rule needed) |
| D30 | "· due 9 Oct" (manager review due) | no due dates anywhere (`review_cycles` has `period_start/end` only) | M (G6) |
| D31 | "2 of 8 self-reviews are in" | `GET /v1/performance/cycles/{id}/progress` (`useCycleProgress`), team-scoped, SELF assignments COMPLETED / total (verified live) | E |
| D32 | Per person "Self-review in · write yours" / "Due Wed, 30 Sep" | status from the same progress (SELF + MANAGER assignment); due date missing | P (G6) |
| D33 | "Out soon": who, dates, leave type or "Waiting for you" | no team date-range leave endpoint; the leave calendar walks `/approvals/history` pages; WFH has no approver history at all | M (G7) |

### 3.2 Actions

| # | Action | API today | Status |
|---|---|---|---|
| A1 | "Team schedule" button | navigation → `/team?view=schedule` | E (new target) |
| A2 | "Approvals · N" (primary) | navigation → `/team?view=approvals` | E (new target) |
| A3 | Tile click filters the roster (toggle, active ring) | client | E |
| A4 | "Show everyone" | client | E |
| A5 | "Send a reminder" → "Reminder sent" + toast | none | M (G3) |
| A6 | Approve (Waiting for you) | per kind: `useLeaveDecision`, `useWfhDecision`, `useDecideCorrection`, `useDecideShiftRequest`, `useExpenseDecision` | E |
| A7 | Reject (Waiting for you) | same; a WFH rejection needs a reason, and this card has no note field | P (C5) |
| A8 | "See all 7" | navigation | E |
| A9 | Probation "Confirm" | `POST /v1/hrms/employees/{id}/confirm?confirmationDate=` (`useConfirmEmployee`) needs `hrms.employee.write` | M for managers (G4) |
| A10 | Probation "Extend by a month" | `POST /v1/probation/employees/{id}/extend?newEndDate=` (`useExtendProbation`) needs `hrms.employee.write` | M for managers (G4) |
| — | Today's "Team attendance" button (→ Daily Tracking) | not in the design | conflict C2 |

### 3.3 Permissions per element

| Element | Gate today | Proposed gate |
|---|---|---|
| Page | route anyOf `attendance.team.read`, `hrms.leave.approve.l1`; menu noneOf `hrms.employee.read` | + the approve permissions (§2) |
| Tiles, roster, Team schedule button | `usePermission(P.ATTENDANCE_TEAM_READ)`; API `hasAuthority('attendance.team.read')` | same |
| Approvals button + "Waiting for you" | `usePermission(P.HRMS_LEAVE_APPROVE_L1)` (leave only) | anyOf the four approve permissions; each kind by its own permission |
| Send a reminder | — | new `attendance.team.remind` or reuse `attendance.team.read` (Q5; shared with dashboard G2) |
| Probation card | — (API needs `hrms.employee.read`; actions `hrms.employee.write`) | read with `attendance.team.read`; actions with new `hrms.probation.team.decide` (Q2) |
| Reviews card | — | `hrms.performance.read` (API scopes to the team via `PerformanceTeamScope`) |
| Out soon | — | anyOf `attendance.team.read`, `hrms.leave.approve.l1` |

### 3.4 Components

Shared: PageHeader (title, sub-line, 2 actions), StatCard (`UtStat` look: 42px round icon in brand/gold/red/gray tone,
label, 28px value, note, clickable, active inset ring, tilt/spotlight), Card/Section, ListRow, Avatar (40px initials),
StatusPill (In / Late / Home / On leave / Half day / Off), ApprovalRow **compact** variant (who, what, when, Reject /
Approve, decided line; Undo when possible), Button, Dialog (WFH reject reason; confirm probation), EmptyState, Skeleton,
Toast. Page-specific: ProbationCard, ReviewsCard, OutSoonCard, reminder button (red outline pill).
The Home (team variant, `EmpHome` role=manager) shows the same "Waiting for you" and a team roster with All / Late /
Not in filters: it must reuse these hooks and components.

---

## 4. Team schedule (`TeamSchedule.dc.html`)

**Maps to:** today a panel at the bottom of `/team` (`modules/hrms/team/TeamSchedule.tsx`, query key
`['team','schedule',from,to]`, `GET /v1/team/schedule?from&to`, `TeamScheduleController` L23–24,
`hasAuthority('attendance.team.read')`, up to 31 days, one row per person per day). Becomes its own view
`/team?view=schedule`. The same query key is used by `AttendanceContainer` (today's roster) and invalidated after a
shift assignment, so keep it.

### 4.1 Data points

| # | Design element | Source today | Status |
|---|---|---|---|
| S1 | Week label "Mon 28 Sep – Sun 4 Oct" | client (today uses `startOfWeek(new Date())`, browser-local; should be IST) | E |
| S2 | Day headers "Mon 28" | client | E |
| S3 | Per-day "In the office" bar + "7 of 8" | shifts only; leave, WFH, weekly off and holidays are not in the response | P (G7, G8) |
| S4 | "· thin" marker | no staffing rule exists; default proposal: fewer than half of the people scheduled that day | M (rule) |
| S5 | Column "Holiday" / "Weekend" when nobody works | not returned | M (G8) |
| S6 | Row avatar + name | `employeeName` | E |
| S7 | Shift cell "General 09:30 – 18:30" | `shiftName`, `startTime`, `endTime` | E |
| S8 | General (green) vs other shifts (indigo) | derive: the shift named "General" / code `GEN` is the client-chosen default (`EmployeeShiftService.seedMissingDefaults`) | E (rule) |
| S9 | Home cell "Approved" | none (no approver-side WFH list by date) | M (G7) |
| S10 | Leave cell "Approved" (+ type, half day) | none by date; leave calendar walks history pages | M (G7) |
| S11 | "Leave? Waiting for you" (dashed, clickable) | pending leave exists in the queue, but not per date/person here | M (G7) |
| S12 | "Home? Waiting for you" | same for WFH | M (G7) |
| S13 | Holiday cell "Gandhi Jayanti" | `GET /v1/settings/holidays?companyId&from&to` (`isAuthenticated`), company-level; branch holidays (`settings.holiday_branches`) not resolved per person | P (G8) |
| S14 | "Off" (weekly off) | not returned; rule lives in `AttendanceCalendar.resolveWeeklyOffDays` (person → shift → company → Sat/Sun) | M (G8) |
| S15 | No shift yet (today "Unassigned" / "Joined …" from `since`, `joinedOn`) | exists; no design state | E (keep, "No shift yet") |
| S16 | Legend (General, Other, Home, Leave, Waiting for you) | static labels | E |

### 4.2 Actions

| # | Action | API | Status |
|---|---|---|---|
| SA1 | ← Previous | refetch `/v1/team/schedule` for the week | E |
| SA2 | This week | same | E |
| SA3 | Next → | same | E |
| SA4 | Click a pending cell → Approvals (Leave or Requests tab, focused on that request) | navigation; needs the request id and kind in the row, and `canDecide` | P (G7) |
| SA5 | (kept) name → employee page | `/hrms/employees/:id`, today only with `hrms.employee.read` | E (C15) |

Permissions: `attendance.team.read` (page and API; org-wide scope with `attendance.workforce.admin`);
`hrms.employee.read` (name links); pending cells are clickable only with the matching approve permission.

Components: PageHeader with three outline buttons, Card, Avatar (32px), **WeekScheduleGrid** (page-specific:
200px name column + 7 day columns, min width 900 with horizontal scroll, coverage header row with a 4px bar, seven
cell variants: general, other, home, leave, pending button, holiday stripes, off), legend, EmptyState, Skeleton.
Pagination (10 per page today) should stay for large teams.

---

## 5. Approvals (`TeamApprovals.dc.html`), tabs All · Leave · Attendance · Requests · Expenses

**Maps to:** nothing today (new view `/team?view=approvals&tab=…`). Page max width 1100. Header pills = the tabs
(names and order from the design). Tab contents: Leave = leave; Attendance = attendance fixes (regularization);
Requests = work from home + shift change; Expenses = expense claims; All = everything.

### 5.1 Page-level data

| # | Element | Source today | Status |
|---|---|---|---|
| P1 | Sub-line "7 requests are waiting from your team. 2 need a closer look." / "… in leave." / "None have warnings." / "You're all caught up." | counts from the 5 queues (expense needs SUBMITTED only); warnings don't exist | P (G9, G10) |
| P2 | "Approve 5 with no warnings" (shown when more than 1) | needs warnings | P (G9, G12) |
| P3 | Tabs, each only with its permission | client | E |
| P4 | Empty state "All caught up · Nothing here is waiting for you. New requests from your team show up here and in the bell." | counts | E |
| P5 | Rows decided in this session (and still undoable after a reload) | none | M (G11) |

### 5.2 Card data per kind

Common to every card: initials + name (E: `employeeName` on every list), kind chip (client), "12 min ago" (E: `createdAt`;
expense `submittedAt`), reason in quotes (E: leave/WFH/fix/shift `reason`, expense `notes`), note input, Reject, Approve.

| Kind | "what · n" | Fact 1 | Fact 2 | Warning (amber) |
|---|---|---|---|---|
| Leave | "Casual leave · Mon 28 – Tue 29 Sep · 2 days": E (`leaveTypeName`, dates, `totalDays`); half-day part P (in the table, not in the response) | "Balance after": P, `GET /v1/leave/employees/{id}/balances` (team-scoped, one call per row); `available` already nets this request's pending days | "Others out": M, no team leave by date (G7) | overlap with others out: M (G7). "No leave left, would be unpaid" cannot happen today (apply refuses `INSUFFICIENT_LEAVE_BALANCE`, C6) |
| Attendance fix | "Missed punch-out · Wed 23 Sep · Says 19:05": P, `requestedDate` + requested times are E; which punch was missing needs the day's record | "Punch-in 09:31 · Face": M, not in `CorrectionRequestResponse` | "Hours if approved 9h 34m": M (needs the existing punch) | e.g. the day's payroll is locked, or the fix adds > N hours: M |
| Work from home | "Work from home · Wed 30 Sep · 1 day": E (`fromDate`, `toDate`) | "WFH this month 2 of 6": M, no approver-side count; no WFH allowance exists (Q6) | "Team in office 6 of 8" that day: M (G7, G8) | low office cover that day: M |
| Shift change | "Shift change · General → Early · From Mon 5 Oct": E (`currentShiftName`, `requestedShiftName`, `requestedEffectiveDate`, null on older app builds = "from the day it's approved") | "New timing 07:00 – 16:00": E via `GET /v1/shifts?companyId` (`attendance.checkin.self`) matched on `requestedShiftPolicyId` | "Early shift now: No one in your team": P, derive from `/v1/team/schedule` on the start date | a scheduled change after the date (`SHIFT_CHANGE_DATE_CONFLICT`) or the date passes soon: M |
| Expense | "Client visit travel · 3 receipts · ₹4,860": E (`title`, `itemCount`, `totalAmount`, `currency`) | "Policy check: Within limits": M for managers (`/v1/expense/policies` → 403 verified; list rows have no items) | "Receipts: All attached": E (`receiptCount` vs `itemCount`) | missing receipts / over a cap: M |

Decided state (after Approve/Reject): tick or cross, "Approved · {who} · {what}", **Undo** (M, §6).

### 5.3 Actions

| # | Action | API | Status |
|---|---|---|---|
| X1 | Switch tab | client + URL `tab=` | E |
| X2 | Note "Add a note (optional)" | `comment` on all five decide endpoints (keep today's 300-character limit and the "Decision note" label) | E |
| X3 | Approve | the five decide endpoints (§1.3) | E |
| X4 | Reject | same; WFH needs a note (server rule) | P (C5) |
| X5 | "Approve N with no warnings" | loop over the decide endpoints; needs warnings | P (G12) |
| X6 | Undo | none | M (G11, §6) |

Permissions per tab: Leave `hrms.leave.approve.l1` (tenant-wide with `hrms.leave.approve.l2`); Attendance
`attendance.regularization.approve` (org-wide with `attendance.workforce.admin`); Requests `wfh.approve` (WFH) and
`attendance.regularization.approve` (shift); Expenses `hrms.expense.claim.approve` (tenant-wide with
`hrms.expense.reimbursement`); All = any of them.

Components: PageHeader + primary action, PillTabs (header), **ApprovalRow full** variant (42px avatar, name, kind chip,
time, what · n, quoted reason, facts grid on surface-2, amber warning banner, note input + Reject + Approve; decided
row with icon, result and Undo), EmptyState, Skeleton, Toast, Dialog (reject reason for WFH).

---

## 6. Undo, end to end

### 6.1 What exists
Nothing. No undo endpoint, no record of the state before a decision, no "reopen" for leave, WFH, fixes, shift changes
or claims. Every decision publishes an event that notifies the employee right after commit (`DomainEventListener`,
AFTER_COMMIT). The other audits need the same thing (attendance G13, leave-payrun L7, pay G20, dashboard G3), so this
should be **one mechanism** they all use.

### 6.2 Why not a client-side delay
Holding the decision in the browser and sending it when the toast closes would show "has been told" before anything is
sent, lose the decision if the tab closes, and not exist for mobile decisions. That breaks "never a fake toast" and
DECISIONS §3 lists approval Undo as a feature to build end to end.

### 6.3 Design
**Table (new, JDBC only, no JPA entity):** `hrms.approval_decisions`
`id uuid pk default gen_random_uuid()`, `tenant_id uuid not null`, `kind varchar(20)` (LEAVE, WFH, CORRECTION, SHIFT_CHANGE,
EXPENSE), `request_id uuid`, `employee_id uuid` (requester), `decision varchar(10)` (APPROVED, REJECTED),
`decided_by_employee_id uuid`, `decided_by_user_id uuid`, `decided_at timestamptz default now()`, `undo_until timestamptz`,
`prior_state jsonb` (what to put back), `post_version bigint` (for fixes: the record version right after approval),
`note varchar(500)`, `undone_at timestamptz`, `undone_by_employee_id uuid`. Indexes `(tenant_id, decided_by_employee_id,
decided_at desc)` and `(tenant_id, kind, request_id)`. RLS `tenant_id = current_tenant_id()` (enable + force), grants to
`ut_app`. Migration `V143_4x__approval_decision_journal.sql`, idempotent, applied by hand in production. **No new
permission** (undo uses the decide permission), so no OWNER grant is needed.

**Recording (all decision paths: web pages, mobile, the new inbox):** a `DecisionJournal` bean in `hrms-api`, called
from the five existing decide controller methods through a `@Transactional` facade: lock the request row
(`SELECT … FOR UPDATE`), read the prior state, call the existing service (joins the same transaction, so every
existing guard, validation and event stays), then insert the journal row. If `to_regclass('hrms.approval_decisions')`
is null (migration not applied yet) it skips the insert and logs once: decisions work as today and Undo is simply not
offered. Request and response bodies of the existing endpoints do not change.

**Window:** `undo_until = decided_at + 10 minutes` (Q1), and only while nothing downstream has used the decision.

**Endpoints (one per module, same `@PreAuthorize` as that module's decide endpoint):**
`POST /v1/leave/{id}/decision/undo`, `POST /v1/wfh/{id}/decision/undo`, `POST /v1/attendance/corrections/{id}/decision/undo`,
`POST /v1/shifts/change-requests/{id}/decision/undo`, `POST /v1/expense/claims/{id}/decision/undo`.
Common checks: a journal row exists for this request, not yet undone, `undo_until > now()`, and the caller is the one
who decided (`decided_by_employee_id`); the request is still in the decided status (row lock + `UPDATE … WHERE status = ?`).
Per-kind "still possible" checks and reversal:

| Kind | Refuse when | Put back |
|---|---|---|
| Leave | status changed (cancelled, L2 decided); a LOCKED/PAID payroll run covers any leave day | status PENDING; approver, decision time and note from `prior_state`; balance: approved → `used −= days, pending += days`; rejected → `pending += days` |
| WFH | status changed (e.g. cancelled); the employee already punched in as WFH on a day of the request | status PENDING, approver from `prior_state`, `decided_at`/`decision_note` cleared |
| Attendance fix | status changed; the day's record changed since the approval (`version` ≠ `post_version`); a LOCKED/PAID run covers the day | status PENDING; the record's fields from `prior_state` (or delete the record if the approval created it); an attendance event of the existing type `MANUAL_OVERRIDE` with note "Correction approval undone" (a new event type would need a change to the `ck_event_logs_event_type` CHECK) |
| Shift change | approved: the new assignment already started before today, or started today and someone punched under it; the employee has raised another pending request (unique index `uq_scr_one_pending_per_employee`); rejected: `requested_effective_date` has passed | approved: delete the created assignment (or restore the in-place replaced shift and note), reopen the closed one (`effective_to` from `prior_state`); request PENDING with `approver_id`, `decision_note`, `decided_at`, `applied_effective_date` cleared |
| Expense | status is APPROVED_FOR_PAY or REIMBURSED; the claim sits in a non-cancelled reimbursement batch | status SUBMITTED; approver from `prior_state`; `approved_at`, `approver_comment` cleared |

**Side effects:** mark the journal row undone; audit event; publish `ApprovalDecisionUndoneEvent` →
`DomainEventListener` sends the employee "{approver} took back their decision on your {request}. It is waiting for a
decision again." (new `AppNotificationType.DECISION_UNDONE` and catalog keys such as `leave.decision_undone`; the
catalog test requires the entries; `notif.notifications.type` is VARCHAR(60), no schema change).

**Reads:** the inbox read model (G9) returns `recentDecisions`: journal rows decided by the caller, not undone,
`undo_until > now()`, with a request summary, so decided rows keep their Undo after a reload until the window ends.

**Web:** `useUndoDecision()` (dispatch by kind), invalidates the same keys as the decide hooks plus `['team','approvals']`;
ApprovalRow shows Undo while `now < undoUntil`; toast "Undone · {first name} has been told".

**Tests:** service tests per kind (balance maths, each refusal, second undo, wrong person, window over, table missing),
permission tests, and a live test (decide → undo → state restored → cleaned up).

**Size:** L (leave, WFH, expense M each; fix and shift change M–L).

---

## 7. Gaps (backend work)

| # | What | Backend work | Schema change | JPA | Size |
|---|---|---|---|---|---|
| G1 | Team label, size, members (incl. people off today, joined date, probation status) | `GET /v1/team/summary` (anyOf `attendance.team.read`, `hrms.leave.approve.l1`): scope kind (department / direct reports / company), department names, members with job title, department, employment status, joined date, off today. Reuses `TeamEmployeeScope` + `AttendanceCalendar`. Add `/v1/team` → `hrms` to `TenantModuleGuard` | no | reads JPA tables via JDBC, no mapping change | S |
| G2 | Punch method and leave type on the roster | add `checkInMethod` and `leaveTypeName` to `StaffStatusResponse` (additive; the mobile app reads it) in `AttendanceController.toStaffStatus` | no | no | S |
| G3 | "Send a reminder" (shared with dashboard G2) | `POST /v1/attendance/reminders {employeeId, date, reason: NOT_CHECKED_IN}` + `GET /v1/attendance/reminders?date=` (who was reminded today); team-scope check; once per person/day/reason by looking up `notif.notifications`; new notification type + catalog key; audit | no (a new permission is a data migration granting OWNER + SUPER_ADMIN) | `notif.notifications` is JPA, no column change | M |
| G4 | Probation for managers | `GET /v1/team/probation?days=30` (`attendance.team.read`, team scope; end date, days left, overdue, auto-extend setting); `POST /v1/team/probation/{employeeId}/confirm` and `/extend` with new permission `hrms.probation.team.decide` + team check; notify HR and the employee | data migration only (permission rows, grants OWNER, SUPER_ADMIN, + roles per Q2) | writes `hrms.employees` via existing services, no column change | M |
| G5 | Probation auto-extend is stored but never applied | apply `auto_extend_enabled/auto_extend_days` in the nightly probation scan (extend at the end date when nobody decided, tell manager and HR), or change the design line (Q2) | no | no | S–M |
| G6 | Review due dates ("due 9 Oct", "Due Wed, 30 Sep") | a deadlines store per cycle (`performance_mgmt.review_cycle_deadlines`: cycle, self-review due, manager review due), HR sets them in Performance → Review cycles; owned by the Growth audit. Without it, show the cycle name only | new table (JDBC) | `review_cycles` is JPA; don't add columns there | M |
| G7 | Team time off by date (Out soon, schedule overlays, "Others out", "Team in office") | `GET /v1/team/time-off?from&to` (anyOf `attendance.team.read`, `hrms.leave.approve.l1`, `wfh.approve`; ≤ 62 days): approved + pending leave (type, half-day part) and WFH per person, with `requestId`, `kind`, `canDecide` | no | no | S–M |
| G8 | Schedule: weekly off and holiday per person per day | extend `GET /v1/team/schedule` rows with `weeklyOff` and `holidayName` (additive, same one-row-per-person-per-day shape; aligns with attendance G10) | no | no | S |
| G9 | Approvals inbox read model | `GET /v1/team/approvals?kind=&page=&size=`: per-tab counts, merged rows newest first with structured facts and warnings, `canDecide`, `rejectNeedsReason`, and `recentDecisions` (G11). Each kind only with its list permission and exactly its list endpoint's scope; expenses SUBMITTED only; the caller's own requests left out. Facts computed in bulk with JDBC (balances, overlaps, WFH days this month, office cover, the fix's current punches, shift timings, receipts and category caps) | no | reads JPA tables via JDBC | L |
| G10 | Expense "waiting" counts include APPROVED claims | optional `status` param on `GET /v1/expense/claims/approvals` (or covered by G9) | no | no | S |
| G11 | Undo | §6 | **new table** | none mapped; updates JPA tables without column changes | L |
| G12 | "Approve N with no warnings" | client loops over the decide endpoints using G9's warnings and reports partial failures; optional bulk endpoint later | no | no | S |
| G13 | Navigation | registry tabs `team:schedule`, `team:approvals` (+ tab entries), wider `/team` guard, ⌘K actions; update `pageRegistry.test.ts` | no | no | S (web) |
| G14 | Queue vs decide scope mismatch (R5) | make `ApproverScopeGuard` also accept `approver_id = me` and `reporting_manager_id = me` (what the queue shows), or mark such rows `canDecide=false` in G9 | no | no | S–M |
| G15 | WFH allowance "of 6" | only if wanted (Q6): a WFH policy table per company (HR configuration is JPA, so not a column there) + setting UI | new table | no | M |
| G16 | Dark tokens for the schedule and roster tones (indigo other shift, tan leave, gold dashed pending, holiday stripes, blue-teal Home pill, red reminder outline) | theme package | no | no | S |

---

## 8. Conflicts with existing behaviour and client decisions

- **C1. Greeting on `/team`.** Today the page title is the greeting (`greetingName`, first name or full name when the
  first name has fewer than 2 letters); `e2e/recovery/live-w3-greeting-myatt.mjs` checks "Good …, Dept" on `/team`. The
  design's title is "Team today" with no greeting (the greeting is on Home). Recommend following the design and moving
  that check to the page that greets managers (their Home), keeping the same name rule.
- **C2. "Team attendance" button and the "Me → Team Attendance" tab.** Both go away in the design (My team becomes
  its own group; the self-service group splits into My work). `live-rail-highlight.mjs` clicks both, and
  `layouts/railLit.test.ts` has "Me → Team attendance keeps Me". Keep the `myteam` key and `/team` path and the rule
  "the item you came through stays lit"; rewrite those steps for the new group.
- **C3. Shift roster moves off `/team`** to `/team?view=schedule`. `live-design-team.mjs` expects "Shift roster" on `/team`.
- **C4. Tiles.** Today: Present / Not marked yet / On leave / Waiting for you (raw API counts). Design: In the office /
  Late / At home / On leave / Not in yet, which must follow the one-bucket-per-person rule (`dayBuckets`). The design
  has no Half day tile, so half-day people would be in no tile: add a Half day tile only when there is someone in it.
- **C5. WFH rejection needs a reason** (server rule). The design calls the note optional and the Team today card has
  no note field. Keep the rule: ask for a reason in a Dialog (or require the note) for WFH rejections only.
- **C6. "No casual leave left. This day would be unpaid."** can't happen: applying beyond the balance is refused. Use
  only warnings the data can produce (overlaps, balance reaching zero, missing receipts, locked payroll day…).
- **C7. Who gets My team.** Today's client rule hides it from anyone with `hrms.employee.read` (HR, finance, admins).
  The prompt's example "a finance lead who is also a team manager" would get it. Side effect today: FINANCE_LEAD holds
  `wfh.approve` but no web page lets them decide WFH (the Leave page's Approvals tab needs `hrms.leave.approve.l1`). See Q3.
- **C8. Probation copy.** "or it extends by a month on its own" is not true (auto-extend never runs), and "HR will send
  his confirmation letter" is not a behaviour (confirm only sets status ACTIVE and the confirmation date). Build (G4, G5)
  or change the copy.
- **C9. Notification links** for `*_SUBMITTED` go to the module pages (`core/notifications/notificationStore.ts`: leave and
  WFH → `/hrms/leave?tab=approvals`, shift → `/hrms/shifts`). Keep them; optionally send people who have My team to
  the inbox tab.
- **C10. Name links.** Keep today's rule (links only with `hrms.employee.read`) unless the lead wants managers to open
  their team's profiles (the route already allows `attendance.team.read`).
- **C11. Dates.** Week start and "today" must be IST (`istToday`), not browser-local (`todayIso()`, `new Date()` in
  today's code). A date picker, if added, uses `src/shared/components/calendar`.
- No conflict with: settings placement (these pages hold no settings), My Attendance hidden for admin roles (not
  shown here), Companies Inactive view/restore, the rail-highlight rule (views share `/team`, pathname-based).

---

## 9. Shared components needed

From the README list: PageHeader, PillTabs (Approvals tabs; single solid pill for Team today / Team schedule),
StatCard (the `UtStat` look, clickable + active), Card/Section, ListRow, StatusPill, **ApprovalRow** (compact and full,
inline approve/reject, note, facts, warning, decided state, Undo with `undoUntil`), Avatar, EmptyState, Skeleton, Toast,
Dialog, Button, ProgressBar (schedule coverage bar). Page-specific: WeekScheduleGrid + legend, ProbationCard,
ReviewsCard, OutSoonCard. Hooks to add (same pattern as `modules/hrms/api/*`): `useTeamSummary`, `useTeamTimeOff`,
`useTeamApprovals`, `useUndoDecision`, `useTeamProbation` (+ confirm/extend), `useCheckinReminders` (+ send); give
`useCycleProgress` an `enabled` flag. Every decide hook also invalidates `['team','approvals']` (existing keys kept).

---

## 10. Risks

**Live tests that assert today's markup (update selectors, keep every behaviour check):**
- `e2e/recovery/live-design-team.mjs`: tiles "Present", "Not marked yet", "On leave"; sections "Who's in today",
  "Shift roster" on `/team`; employee can't open it.
- `e2e/recovery/live-w3-greeting-myatt.mjs`: greeting "Good …, Dept" on `/team` (C1).
- `e2e/recovery/live-rail-highlight.mjs`: rail "My Team", Me tab "Team Attendance" → `/team`, the page's "Team attendance"
  button, fresh `/team` lights My Team, phone nav (C2).
- If `ApprovalList`/`ApprovalCard` are replaced by the new ApprovalRow everywhere: `live-design-leave.mjs` (`article` +
  `textarea` + toast "Leave approved"), `live-design-expenses.mjs` ("Waiting for your OK"), `live-shift-requests.mjs`
  ("All caught up", "Approve change"), `live-design-attendance.mjs` ("Approve overtime", "Reject").
- API shape of `/v1/team/schedule` (additive changes only): `live-role-matrix.mjs`, `live-shift-effective.mjs`,
  `live-shift-request-dates.mjs`, `live-time-workflows.mjs`, `live-w2f.mjs`.
- Unit: `shared/navigation/pageRegistry.test.ts` (My team open for DEPT_MANAGER, closed for HR and employee),
  `layouts/railLit.test.ts` (TEAM_PAGE cases), `shared/search/search.test.ts`.
- Backend (if the decide paths get the journal facade): `LeaveFlowIT`, `FreshTenantLeaveFlowIT`, `RbacMatrixIT`,
  `ShiftHistoryAccessTest`, `DashboardPastDateAccessTest`; `OwnerPermissionInvariantCheck` for any new permission.

**Other risks:**
- R1. Weekends: the dashboard roster is empty on a manager's weekly off (verified live), so Team today needs the team
  list (G1) and an "off today" state, or it looks broken.
- R2. Demo data: 6 ACTIVE "Local QA cycle …" review cycles; the reviews card needs a fixed pick rule (the newest ACTIVE
  cycle with the caller's MANAGER assignments or team SELF assignments).
- R3. The mobile app reads `/v1/attendance/dashboard`, `/v1/team/schedule` and the decide endpoints: additive fields only;
  the journal must not change responses.
- R4. HR/admin WFH queue includes the caller's own request (verified live for owner@); the server refuses
  self-approval. The inbox must leave out or disable the caller's own requests.
- R5. A manager's leave/WFH queue (approver, reporting manager or department head) is wider than what
  `ApproverScopeGuard` lets them decide (department head → only their departments; approver delegations): some visible
  rows answer 403 "This request is not from your team." (G14).
- R6. Undo after a notification: the employee may act in between (cancel, punch in, raise another shift request); the
  per-kind guards must refuse cleanly with a plain message.
- R7. Inbox cost for HR (tenant-wide): facts must be computed in bulk, not per row.
- R8. `/v1/team/**` is not module-guarded (G1 adds it); adding the prefix makes `/v1/team/schedule` refuse workspaces
  without HRMS, as the web route already does.

---

## 11. Open questions

1. **Undo window:** 10 minutes (and never after payroll lock, reimbursement or the new shift starting)? The leave audit asks the same.
2. **Probation:** may department managers confirm or extend their team's probation themselves (new
   `hrms.probation.team.decide` for DEPT_MANAGER), or only see it and leave the decision to HR? And should the stored
   "auto-extend" setting start working, so "extends by a month on its own" is true, or should the line change?
3. **My team for HR and finance people who manage staff:** keep hiding it from anyone with `hrms.employee.read`, or show
   My team with their own reports (not the whole company)?
4. **Inbox coverage:** only the five kinds in the design, or also overtime, advances and skill approvals (department
   managers can approve all three today, on other pages)?
5. **Reminders:** who may send one (`attendance.team.read` within their team, or a new permission), and by which
   channels? (Same question as the dashboard audit.)
6. **WFH allowance:** add a monthly WFH allowance setting so "2 of 6" is real, or show only the count ("2 days this month")?
