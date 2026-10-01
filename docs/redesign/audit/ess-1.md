# Phase 0 audit: Self-service Home (employee and manager), Time, Leave

Area: the self-service **Home** (`EmpHome.dc.html`, `role=employee` and `role=manager`), **Time** (`EmpTime.dc.html`: Attendance with the tabs This month and Timesheet, Work from home, Shift change) and **Leave** (`EmpLeave.dc.html`: Overview, Apply, Requests, Holidays). `emp-data.js` was read only to learn which data each screen shows.

Repo: `C:\REACT\unifiedtree-saas` at `e32a4dc6`. Read-only audit. Nothing in the repo was changed.

**Live check: done.** The local API (`127.0.0.1:8080/api`) and the recovery database (`55432/unifiedtree_recovery`) were up. I signed in as owner, hrm, fin, mgr and reader and made only GET calls. The permission lists below for `reader@` (EMPLOYEE, 33 permissions) and `mgr@` (DEPT_MANAGER, 53 permissions) come from their live tokens. 27 Sep 2026 is a Sunday (everyone's weekly off), so today's team lists were empty.

Legend: **exists** = real data or a real API is there today. **partial** = most of it is there; the missing piece is named. **missing** = no data source or API today. Gap ids (`E1` …) point to §10.

Binding context used: `DECISIONS.md` items 1–13. The ones that shape this area:
- **Item 12:** Home is chosen by permission. People without an admin home get the self-service Home at **`/me`**, and `/dashboard` redirects them there. `RoleDashboard` is no longer routed. Team blocks show for anyOf `attendance.team.read`, `hrms.leave.approve.l1`, and not `hrms.employee.read`.
- **Item 11:** "My work" (Time, Leave, …) replaces the single Employee Self Service rail item. The admin-role exclusion stays. **Tab names and order stay as today.**
- **Item 2:** new tables and columns are JDBC-only. Every new feature degrades gracefully until its migration is applied. Every new permission is granted to OWNER and SUPER_ADMIN.
- **Item 3:** missing features are built end to end.

---

## 1. Summary

1. **Most of what the three designs show already has a real source.** This month's stats, the month calendar, leave balances and requests, WFH and shift requests, time entries, payslip amounts, holidays, birthdays and notices, the manager's team counts and approval queues are all there. Much of it needs frontend work only: combining existing calls in new ways.
2. **Check out / Check in again on Home conflicts with a product decision.** On 6 Jun 2026 all web punching was removed on purpose ("mobile-only": `ERP_READINESS.md:17`, comments in `HrmsDashboard.tsx:162-165`, `:397-398`). The API still works (`POST /v1/attendance/checkin`, `/checkout`), and the hooks `useCheckIn` / `useCheckOut` still exist.
   - Production enforces the geofence (`HRMS_GEOFENCE_ENFORCE` defaults to true), so a web punch without a location is refused.
   - A second check-in on the same day is refused (`ALREADY_CHECKED_IN`).
   - Needs a decision (Q1, Q2).
3. **Take a break has no backend.** The event types `BREAK_START` / `BREAK_END` are already allowed in `attendance.event_logs` and in the `AttendanceEventType` enum, so it can be built without a schema change (E3). Whether breaks reduce counted hours is a pay question (Q3).
4. **New aggregations needed for Home:**
   - **Needs you:** tasks only this person can do (E11).
   - **My requests with progress:** approver names are missing on leave, WFH and fix requests (E9, E10).
   - **Around you:** dated events (E12).
   - **Next payday:** no self endpoint (E13).
5. **New features the design introduces:**
   - WFH monthly allowance (E6)
   - picking several separate WFH days (E7)
   - "someone in your team is off" on the leave planner (E14)
   - optional-holiday booking with a yearly quota (E17): large, and it changes how attendance, leave and payroll count days
   - timesheet by project with "Submit week" (E19): large
   - shift change with an end date (E20)
   - people per shift (E21)
   - "Message team" for managers (E22)
   - team-scoped probation for managers (E23)
6. **Conflicts:** the design drops things that exist today. Examples:
   - half-day leave
   - cancelling approved future leave
   - fix-request proof upload
   - month navigation
   - time-entry edit/delete
   - the Regularization history
   - the WFH cancel button
   - the Absent / On time / Score tiles

   These must be kept (§11). The design's tab names differ from today's, and DECISIONS item 11 keeps today's names, so §7 gives a mapping.
7. **About 15 live e2e scripts** assert today's markup of these pages (§13).

---

## 2. Screens, tabs and where they live

| Prototype (file · section) | Tabs in the design | Current route(s) | Current file(s) | Page exists? |
|---|---|---|---|---|
| `EmpHome.dc.html` `role=employee` (whole file) | none (top bar shows one solid "Home" pill) | `/me`, alias `/hrms/ess` (App.tsx:253-258, :628-633). Per DECISIONS 12, `/dashboard` redirects non-admin-home users to `/me` | `modules/hrms/ess/EssDashboard.tsx` (+ `ess/AttendanceHistory.tsx`, `ess/TimeEntries.tsx`). Plain EMPLOYEEs also get `RoleDashboard` at `/dashboard` (`HrmsDashboard.tsx:149-919`, chosen by `useRoles().isEmployee` at :921-924); it is retired by DECISIONS 12 | Yes, different layout |
| `EmpHome.dc.html` `role=manager` (`isManager` blocks) | none | `/me` with team blocks (DECISIONS 12). Today DEPT_MANAGER lands on the admin dashboard (`AdminDashboardContainer`) and has `/team` | `EssDashboard.tsx` (no team blocks), `team/TeamDashboard.tsx` (today's numbers, leave waiting, who's in), `team/TeamSchedule.tsx` | No team blocks on `/me` today |
| `EmpTime.dc.html` `page=e-att`, `tab=0` ("This month": stats, month calendar, day details, fix this day) | This month · Timesheet | `/hrms/attendance` (employee view: tabs My Attendance `?tab=my`, Regularization `?tab=corrections`) | `attendance/AttendanceContainer.tsx`, `design/dc/AttendancePage.tsx`, `AttMine.tsx`, `AttRegularization.tsx`; also `ess/AttendanceHistory.tsx` on `/me` | Yes, split across two tabs and `/me` |
| `EmpTime.dc.html` `page=e-att`, `tab=1` ("Timesheet") | (same page) | none: time entries are a section of `/me` | `ess/TimeEntries.tsx` (`/v1/ess/timesheets`) | Partly (a day list, not a week grid) |
| `EmpTime.dc.html` `page=e-wfh` | none | `/me/wfh` (App.tsx:275-281) | `wfh/ApplyWfh.tsx`, `api/useWfh.ts` | Yes |
| `EmpTime.dc.html` `page=e-shift` | none | `/me/shift-change` (App.tsx:261-266). The same request form also sits on `/hrms/shifts` → tab "My Shift" for employees | `shifts/ShiftChangeRequest.tsx`; `design/dc/ShiftRequests.tsx` (`mode="mine"`) | Yes (twice) |
| `EmpLeave.dc.html` `tab=0` Overview | Overview · Apply · Requests · Holidays | `/hrms/leave?tab=balances` (closest match) | `Leave.tsx` → `Balances` (+ `LedgerRows`) | Partly |
| `EmpLeave.dc.html` `tab=1` Apply | | `/hrms/leave?tab=apply` | `Leave.tsx` → `Apply` | Yes (a form, not a planner) |
| `EmpLeave.dc.html` `tab=2` Requests | | `/hrms/leave?tab=my` | `Leave.tsx` → `MyLeave` | Yes |
| `EmpLeave.dc.html` `tab=3` Holidays | | `/hrms/leave?tab=holidays` | `leave/HolidayCalendar.tsx` (embedded) | Yes (no optional-holiday booking) |

Today's `/hrms/leave` employee tabs are My leave, Apply, Balances, Encash, Calendar, Leave types, Holidays. None of Encash, Calendar or Leave types is in the self-service design; they stay (§11 C5).

Nav model (`hrms-core.js`): `ehome` = Home; `etime` = pages `e-att` (tabs This month, Timesheet), `e-wfh`, `e-shift`; `eleave` = page `e-leave` (tabs Overview, Apply, Requests, Holidays). The admin `me` module (`me-att`, `me-leave`, `me-wfh`, `me-shift`) is not in any role's `RGROUPS`, so `EmpTime`/`EmpLeave` are the live designs for these URLs (the attendance audit says the same).

---

## 3. Home: employee variant (`EmpHome`, role=employee)

### 3.1 Who gets it (today and planned)

| Gate | Where | Rule |
|---|---|---|
| Route `/me` (and `/hrms/ess`) | App.tsx:253-258 | `RouteGuard anyOf [P.HRMS_ESS_READ 'hrms.ess.read', P.ATTENDANCE_CHECKIN_SELF 'attendance.checkin.self']` + `ModuleGate moduleKey="hrms"` |
| Registry / search | pageRegistry.ts:99 | `page('me', 'My workspace', '/me', …, [{ ...any('hrms.ess.read','attendance.checkin.self'), module: HR, self: true }])` |
| Menu | PlatformShell.tsx:167-183, :457 | ESS group, hidden for admin roles: `if (group === 'ess' && administersWorkspace) return false` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN) |
| Home selection (planned) | DECISIONS 12 | admin dashboard for anyOf `hrms.employee.read`, `payroll.runs.read`, `org.company.write`, `hrms.report.*`; everyone else → `/me` |

### 3.2 Data points

| # | Design data point | Source today (hook → endpoint → guard) | Status | Notes |
|---|---|---|---|---|
| H1 | Greeting word (morning / afternoon / evening) | computed | exists | `EssDashboard.tsx:55` uses the browser's local hour; use IST like the dashboard |
| H2 | Name in greeting | `greetingName(firstName, lastName)` (`shared/hooks/greetingName.ts`) | exists | Client rule: first name, or the full name when the first name has fewer than 2 letters |
| H3 | "**4h 46m** into your day" | `useTodayAttendance` → `GET /v1/attendance/today` (`attendance.checkin.self`; 204 when no record) + clock | exists | Derived: now − checkInTime. Break-aware only with E3. States not drawn in the design: not checked in yet, weekly off, holiday, on leave (use `GET /v1/attendance/review/day?employeeId=me&date=today` `status`) |
| H4 | "and **5 things** need you today" | none | **missing** | The count of H35 (E11). Manager variant adds approvals waiting |
| H5 | Date chip: TODAY + full date | IST today | exists | No day picker on Home |
| H6 | In/out state that picks "Check out" or "Check in again" | `GET /v1/attendance/today` (`checkInTime`, `checkOutTime`) | exists | The action is a gap (E1, E2) |
| H7 | Present days value | `useMonthlyStats` → `GET /v1/attendance/monthly-stats` `presentDays` (`attendance.checkin.self`) | exists | |
| H8 | "of 18 working days so far" | same: `presentDays + absentDays` | exists | Derived |
| H9 | Present sparkline (7 points) | `useAttendanceHistory(y,m)` → `GET /v1/attendance/history` | exists | Cumulative present count per day, derived |
| H10 | Leave left value (main type) | `useMyBalances` → `GET /v1/leave/my/balances` (`leave.balance.read`) `available` | exists | Pick the main type by category (CASUAL, then EARNED…) from `GET /v1/leave/types?companyId` (isAuthenticated) |
| H11 | "casual · 11 earned days" | same two calls | exists | |
| H12 | Leave left sparkline | none | partial | No balance history. `GET /v1/leave/my/ledger` holds credits only (empty for reader). Can be rebuilt from approved requests (`GET /v1/leave/my`) + today's balance; accruals make it approximate |
| H13 | Late marks value | monthly-stats `lateDays` | exists | |
| H14 | "3 and 11 Sep · 15 min grace" | `/history` (days with status LATE) + grace from `GET /v1/shifts/employee/{me}` `gracePeriodMinutes` (`attendance.checkin.self`) | exists | |
| H15 | Late sparkline | `/history` | exists | Derived |
| H16 | Work from home "3 of 6" | used: `useMyWfhRequests` → `GET /v1/wfh/my` (`wfh.request.self`) | partial | "Used" is derived (approved days in the month, minus weekly offs and holidays). **"of 6" has no source**: there is no WFH allowance anywhere (E6) |
| H17 | "days used in September" | computed | exists | |
| H18 | WFH sparkline | `/v1/wfh/my` | exists | Derived |
| H19 | Quick action tiles (6), by permission | frontend | exists | Tiles: Apply leave `leave.request.self`, WFH `wfh.request.self`, Fix a punch `attendance.checkin.self`, Payslip `payroll.payslip.read.self` + payroll module, Change shift `attendance.checkin.self`, Letters `hrms.letters.read.self` |
| H20 | "Most used first" order | none | **missing** | Shared with the admin dashboard's Customise (dashboard audit G1); E26 |
| H21 | Hint "6.5 casual days left" | balances | exists | |
| H22 | Hint "3 of 6 used this month" | `/v1/wfh/my` | partial | Allowance (E6) |
| H23 | Hint "18 Sep · no punch-out" + badge | `/history` (past day, check-in, no check-out) minus `useMyCorrections` → `GET /v1/attendance/corrections/my` (PENDING for that date) | exists | Derived |
| H24 | Hint "August is ready" | `useMyPayslips` → `GET /v1/payroll/payslips/me` (`payroll.payslip.read.self`) | exists | Use the newest LOCKED/PAID period **not after this month**. The recovery DB holds test runs for Jan–Mar 2027 |
| H25 | Hint "General · 09:30–18:30" | `GET /v1/shifts/employee/{me}` | exists | |
| H26 | Hint "1 waiting to be signed" + badge | `GET /v1/letters/my` (`hrms.letters.read.self`); `letters.generated.status` allows `SIGNED` (`signed_at` column) | partial | Whether a letter "needs a signature", and the sign action, belong to the Documents audit (`EmpDocs`) |
| H27 | Your day: worked time | `/today` + clock | exists | Derived; break-aware with E3 |
| H28 | Your day: "/ 9h 00m" | shift from `GET /v1/shifts?companyId` (`workingHoursPerDay`) or the span of `/v1/shifts/employee/{me}` | exists | Choose one rule: the shift's working hours (a target) or its span |
| H29 | Your day: progress bar | derived | exists | |
| H30 | Your day: "In since 09:24 · Face · Bengaluru HQ" | `/today` `checkInTime`, `checkInMethod`, `locationName` | exists | Method labels as in `AttendanceContainer.tsx:53-57` (`SOURCE`) |
| H31 | Your day: "General shift ends at 18:30. It's 2:10 PM." | `/v1/shifts/employee/{me}` or `GET /v1/attendance/review/day` (`expectedEnd`, `shiftName`) | exists | `/review/day` is allowed for self (`attendance.checkin.self`), checked live |
| H32 | Your day: "Checked out at 18:40. See you tomorrow." | `/today` `checkOutTime` | exists | |
| H33 | Your day: on a break / break time | none | **missing** | E3 |
| H34 | Needs you: count badge | none | **missing** | E11 |
| H35 | Needs you: rows (icon tone, title, sub, due chip, link) | sources exist one by one: `/history` + `/corrections/my` (missed punch-outs), `GET /v1/letters/my`, `GET /v1/document/my` (`hrms.document.read.self`) + `/v1/document/my/missing` (`hrms.document.type.read`), `GET /v1/performance/reviews/my` (`hrms.performance.review.self`), `GET /v1/learning/enrollments/me` (`hrms.learning.enroll.self`), `GET /v1/policy/policies` + `/v1/policy/my-acknowledgements` (`hrms.policy.acknowledge.self`), `GET /v1/me/assets` (`hrms.onboarding.asset.self`), interviews (`useMyInterviews`) | **missing** (as a list) | E11. Due dates for reviews, courses and policies depend on the Growth and Documents audits. "Payroll locks Mon, 28 Sep" needs E13 |
| H36 | My requests: rows (title, "Waiting for {approver} · sent …", status pill) | `GET /v1/leave/my`, `GET /v1/wfh/my`, `GET /v1/attendance/corrections/my`, `GET /v1/shifts/change-requests/my` (`attendance.checkin.self`), `GET /v1/expense/my` (`hrms.expense.claim.self`), `GET /v1/advance/my` | partial | **Approver names are missing** on leave (`LeaveRequestResponse` has no approver field at all), WFH (`approverId` only) and fixes (`approverId` only). Shift requests carry `approverName`. E9, E10 |
| H37 | My requests: progress bar (33 / 50 / 66 / 100 %) | status per type | partial | Derived from status; needs one step model per type (E10) |
| H38 | "September attendance · 17 of 18 working days · 1 day to fix" | monthly-stats + `/history` | exists | |
| H39 | Mini calendar states: present, late, holiday, leave (approved), leave pending, weekly off, today, future, to fix | `/history` statuses (PRESENT, LATE, HALF_DAY, ABSENT, HOLIDAY, ON_LEAVE, WEEKEND), `/v1/leave/my` (PENDING future), `/corrections/my` | exists | Days before tracking started are left out (checked live: reader's September starts on the 21st) |
| H40 | Mini calendar "Home" (WFH) state | `DayRecordResponse` has no `attendanceType` | partial | E5. Fallback: approved WFH days from `/v1/wfh/my` (the plan, not the punch) |
| H41 | Tooltip "25 Sep · 09:24 – —" | `/history` times | exists | |
| H42 | Leave card: first 3 balances, "left / of" and meter | balances (`available`, `totalEntitlement + carryForward`) | exists | |
| H43 | "Fri 2 Oct is a holiday. Take Thu 1 Oct for a 4-day weekend." | `GET /v1/settings/holidays?companyId&from&to` (isAuthenticated) + weekly offs (`GET /v1/employees/me` `weeklyOffDays`, else `/v1/settings/hr-configuration/weekend-days`) | exists | Derived suggestion |
| H44 | Pay: "August take-home" + amount, hidden until Show | `GET /v1/payroll/payslips/me` `netPay`, `period` | exists | Show/Hide is local state |
| H45 | Pay: "Next payday Wed, 30 Sep · in 5 days" | none for self (`payroll.runs.pay_date` and `payroll.settings.salary_processing_day` exist but need `payroll.runs.read` / settings access) | **missing** | E13 |
| H46 | Around you: dated events (payroll date, birthdays, holidays, company events) | `GET /v1/hrms/milestones` (isAuthenticated), holidays (isAuthenticated), `GET /v1/admin/dashboard/notices?companyId` (isAuthenticated; no event date, only `expiresOn`) | partial | E12 (+ E13 for the payroll date) |

### 3.3 Actions

| # | Action | API / route | Status |
|---|---|---|---|
| HA1 | Apply leave (primary) | → `/hrms/leave?tab=apply` (keep the query; `live-dead-entrypoints.mjs` asserts it) | exists |
| HA2 | Check out | `POST /v1/attendance/checkout` (`attendance.checkin.self`), hook `useCheckOut` | partial: the API exists, but the web button was removed on purpose (§11 C1). E1 |
| HA3 | Check in again (after checking out) | refused today: `ALREADY_CHECKED_IN` (`AttendanceService.java:205-209`); checkout on a closed record returns it unchanged (:335-337) | **missing** (E2) |
| HA4 | Check in (not drawn: a person not in yet has no button in the design) | `POST /v1/attendance/checkin`, hook `useCheckIn` (sends `MANUAL` and 0,0 by default) | partial (E1) |
| HA5 | Stat card click (Present / Late → Time; Leave left → Leave; WFH → WFH page) | navigation | exists |
| HA6 | Customise quick actions | none | **missing** (E26) |
| HA7 | Quick tiles (6) | navigation: `/hrms/leave?tab=apply`, `/me/wfh`, `/hrms/attendance` (the day to fix pre-selected), `/me/payslips`, `/me/shift-change`, `/hrms/letters/my` | exists |
| HA8 | Take a break / end the break | none | **missing** (E3) |
| HA9 | Needs you row → its page | deep links | **missing** (E11) |
| HA10 | My requests row → its page | navigation (`/hrms/leave?tab=my`, `/me/wfh`, `/hrms/attendance?tab=corrections`, `/me/shift-change`, `/hrms/expenses?tab=my`, `/hrms/advances?tab=my`) | exists |
| HA11 | Calendar "Open" | → `/hrms/attendance` | exists |
| HA12 | Leave card "Apply" | → `/hrms/leave?tab=apply` | exists |
| HA13 | Pay "Show" / "Hide" | local state | exists |
| HA14 | Pay "All payslips" | → `/me/payslips` | exists |

Entry points on today's `/me` that must stay reachable: Salary, Onboarding tasks, My assets, Interviews (with "N scorecards waiting"), Letters, Profile. They can live on tiles (via Customise), in My work, and as Needs-you rows (interviews, onboarding tasks). `live-dead-entrypoints.mjs` asserts the Salary and Onboarding shortcuts on `/me` (§13).

### 3.4 Permissions per block (planned, all from permissions)

| Block | Show when |
|---|---|
| Present days, Late marks, Your day, calendar card, Fix a punch tile | `attendance.checkin.self` |
| Leave left, Leave card | `leave.balance.read` (API guard of `/my/balances`); Apply button: `leave.request.self` |
| Work from home stat and tile | `wfh.request.self`. Today `EssDashboard.tsx:41` uses anyOf `wfh.request.self`, `hrms.ess.read`, `attendance.checkin.self`, which shows the tile to people the API refuses (§11 C12) |
| Pay card, Payslip tile | `payroll.payslip.read.self` + tenant module `payroll` (as `EssDashboard.tsx:38-40`) |
| Letters tile | `hrms.letters.read.self` |
| Change shift tile | `attendance.checkin.self` (the API guard of `/v1/shifts/change-requests`) |
| Needs you / My requests rows | each source only with its own permission (server-side in E10/E11) |
| Around you | milestones, holidays and notices are open to every signed-in user; payroll date: `payroll.payslip.read.self` |
| Check out / Take a break | `attendance.checkin.self` + the new company switch (E1) |

---

## 4. Home: manager variant (`EmpHome`, role=manager)

Shown on `/me` when anyOf `attendance.team.read`, `hrms.leave.approve.l1` and not `hrms.employee.read` (DECISIONS 12; today's `/team` rule, pageRegistry.ts:118). mgr@ holds `attendance.team.read`, `hrms.leave.approve.l1`, `wfh.approve`, `attendance.regularization.approve`, `hrms.expense.claim.approve`, `hrms.advance.approve`, `attendance.overtime.approve` and `hrms.employee.team.manage`, but not `hrms.employee.read`.

The team scope is the departments they head, else their direct reports (`TeamEmployeeScope.teamOf`). Checked live: mgr's trend covers only reader.

Your day, My requests, Leave, Pay and Around you are the same blocks as §3. The calendar card is not shown to managers in the design.

### 4.1 Data points (team blocks)

| # | Design data point | Source today | Status | Notes |
|---|---|---|---|---|
| MH1 | "**6 of 8** people in your team are working" | `useTeamDashboard` → `GET /v1/attendance/dashboard` (`attendance.team.read`), `dayBuckets()` (`attendance/attendanceBuckets.ts`) | exists | |
| MH2 | "and **N things** need you" | approvals (MH21) + Needs you (E11) | partial | |
| MH3 | Team working today "6 of 8" | same | exists | |
| MH4 | "4 in office · 1 late · 1 at home" | same (`effectiveStatus`, `attendanceType`) | exists | |
| MH5 | Sparkline (7 days) | `useAttendanceTrend` → `GET /v1/attendance/dashboard/trend` (`attendance.team.read`, team-scoped) | exists | |
| MH6 | On leave value | dashboard `counts.onLeave` | exists | |
| MH7 | "Arjun Nair · sick leave" | name from `staffStatuses[].fullName`; **no leave type** on `StaffStatusResponse` | partial | E24 |
| MH8 | On leave sparkline | trend `onLeave` | exists | |
| MH9 | Late today value | counts | exists | |
| MH10 | "Aditya Rao · in at 09:58" | `staffStatuses` (`checkInAt`, `lateByMinutes`) | exists | |
| MH11 | Late sparkline | trend `late` | exists | |
| MH12 | Not in yet value | counts `notMarked` | exists | |
| MH13 | "Divya Pillai · no punch" | `staffStatuses` | exists | |
| MH14 | Not in sparkline | trend `notMarked` | exists | |
| MH15 | Tile Approvals "7 waiting for you" + badge | `usePendingApprovals` (`/v1/leave/approvals/pending`, `hrms.leave.approve.l1`), `usePendingWfhApprovals` (`wfh.approve`), `useCorrectionApprovals` (`attendance.regularization.approve`), `usePendingShiftRequests` (`attendance.regularization.approve`), `usePendingExpenseApprovals` (`hrms.expense.claim.approve`), `usePendingAdvanceApprovals` (`hrms.advance.approve`) | exists | Same sum as `HrmsDashboard.tsx:270-278` |
| MH16 | Tile Team today "6 of 8 working" | dashboard | exists | |
| MH17 | Tile Team schedule "Week of 28 Sep" | computed | exists | Page: `/team` (`GET /v1/team/schedule`, `attendance.team.read`) |
| MH18 | Tile Message team "Post to Engineering" | department name: `GET /v1/employees/me` `departmentId` + departments (`hrms.department.read`) | **missing** (the feature) | E22 |
| MH19 | Tile Apply leave "11 earned days left" | balances | exists | |
| MH20 | Tile Payslip | payslips/me | exists | |
| MH21 | "7 requests from your team · oldest 4 days" | the queues in MH15 (`createdAt`) | exists | |
| MH22 | Waiting rows: initials, who, what ("Casual leave · Mon 28 – Tue 29 Sep · 2 days"), when | queue rows (`employeeName`, dates, `totalDays`, `createdAt`) | exists | |
| MH23 | Row result pill "Approved" / "Rejected" after a decision | mutation result | exists | |
| MH24 | "6 of 8 working · IST" | dashboard | exists | |
| MH25 | Filter counts "Late 1", "Not in 1" | dashboard | exists | |
| MH26 | Team rows: initials, name, role, check-in time, pill (Present / Late / Home / On leave / Not in) | `staffStatuses` (`jobTitle`, `checkInAt`, `effectiveStatus`, `attendanceType`, `onLeave`) | exists | |
| MH27 | Needs you (manager): "Decide on Aditya Rao's probation", "Write 8 Q3 reviews", "Accept the Code of conduct" | probation: `GET /v1/probation/upcoming` needs `hrms.employee.read` → **403 for mgr (checked live)**; reviews to write: Growth audit; policies: as H35 | **missing** | E23, E11 |
| MH28 | Around you (manager): team birthdays, "probation ends", holidays | milestones, holidays; probation: 403 | partial | E12, E23 |

### 4.2 Actions (team blocks)

| # | Action | API | Status |
|---|---|---|---|
| MHA1 | Review approvals (primary) | → the Approvals page (Team area). Today: `/hrms/leave?tab=approvals`, `/hrms/attendance?tab=corrections`, `/hrms/shifts?tab=requests`, expenses | exists (the page is the Team audit's) |
| MHA2 | Approve inline | `useLeaveDecision` `POST /v1/leave/{id}/decision`; `useWfhDecision` `POST /v1/wfh/{id}/approve`; `useDecideCorrection` `POST /v1/attendance/corrections/{id}/decision`; `useDecideShiftRequest` `POST /v1/shifts/change-requests/{id}/decision`; expense `POST /v1/expense/claims/{id}/decision` (`@perm.check('hrms.expense.claim.approve')`); advance | exists |
| MHA3 | Reject inline | same | partial: a WFH rejection needs a note (`WFH_REJECT_REASON_REQUIRED`), so Reject must ask for one (§11 C15) |
| MHA4 | Undo a decision | none | **missing** (E27, shared with Team approvals) |
| MHA5 | See all | → Approvals | exists |
| MHA6 | All / Late / Not in filter | local | exists |
| MHA7 | Tiles Approvals, Team today, Team schedule | navigation (`/team`) | exists |
| MHA8 | Tile Message team | none | **missing** (E22) |
| MHA9 | Stat cards → Team today | navigation | exists |
| MHA10 | Needs you "Decide on probation" → the probation page | no team-scoped probation | **missing** (E23) |

---

## 5. Time → Attendance (`EmpTime` `e-att`)

Route today: `/hrms/attendance`. The guards:
- `RouteGuard anyOf [P.HRMS_ESS_READ, P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]` (App.tsx:375-381).
- Registry `me-attendance` = `attendance.checkin.self` + self + `when: notAdminRole` (pageRegistry.ts:100).
- Menu rule `'ess:/hrms/attendance'` = `attendance.checkin.self` + self (:290).
- The My Attendance tab is hidden for admin roles: `hideMine={isAdmin}` (AttendanceContainer.tsx:539 → AttendancePage.tsx:49).

Employees see today: section "Daily Tracking" with tabs **My Attendance** (`AttMine`: 6 tiles and a colour grid for this month only) and **Regularization** (`AttRegularization`: my fix requests and a New request form with date, in, out, reason and proof). `/me` also shows `AttendanceHistory` (a month picker and a day table).

### 5.1 Tab "This month": data points

| # | Design data point | Source today | Status | Notes |
|---|---|---|---|---|
| TM1 | Stat Present "17 · of 18 working days" | `GET /v1/attendance/monthly-stats` | exists | |
| TM2 | Stat Late "2 · 3 and 11 Sep" | monthly-stats + `/history` | exists | |
| TM3 | Stat Work from home "3 · of 6 allowed" | `/v1/wfh/my` for used days | partial | Allowance: E6 |
| TM4 | Stat Average day "9h 12m · target 9h 00m" | `/history` `workHours` (days with a check-out); target from the shift (`workingHoursPerDay` via `GET /v1/shifts?companyId`) | exists | Derived |
| TM5 | Stat To fix "1 · missed punch-out" | `/history` + `/corrections/my` | exists | Derived |
| TM6 | Month title "September 2026" | computed | exists | The design has **no month navigation**; today's `AttendanceHistory` has a `MonthField`. Keep one (§11 C5) |
| TM7 | Day cell: number and dot (on time / late or leave / home / to fix) | `/history` | exists | Home: E5 |
| TM8 | Cell label "09:21 – 18:40" | `/history` `checkInTime`, `checkOutTime` | exists | |
| TM9 | "Late · 09:48" | `/history` LATE | exists | |
| TM10 | "Home · 09:05" | none per day | partial | E5 |
| TM11 | "Holiday" (the note names it) | `/history` HOLIDAY + names from `GET /v1/settings/holidays` | exists | Derived join |
| TM12 | "No punch-out" | derived (past day, in, no out); the server note says "No check-out was recorded." | exists | |
| TM13 | Today: "In · 09:24" + Today badge | `/today` | exists | |
| TM14 | "Leave · waiting" / approved leave | `/v1/leave/my` (PENDING) / `/history` ON_LEAVE | exists | |
| TM15 | "Off" | `/history` WEEKEND (each person's own weekly offs) | exists | |
| TM16 | "Fix sent" | `/corrections/my` PENDING for that date | exists | |
| TM17 | Day details: weekday + date | computed | exists | |
| TM18 | Day details: note ("On time. Worked 9h 19m", "Checked in 18 min after shift start", holiday name) | `GET /v1/attendance/review/day?employeeId=me&date=` → `EffectiveDay` (`note`, `lateMinutes`, `workedMinutes`, `shiftName`, `expectedStart/End`, `attendanceType`, `lossOfPay`) | exists | Checked live for reader on 24 Sep. One call per selected day |
| TM19 | Timeline: check-in time + source ("Face · Bengaluru HQ", "Web · home") | time: `/history`; **source per past day is not returned** (`/today` has it only for today; `GET /v1/attendance/my` is paged with no date filter) | partial | E5 |
| TM20 | Timeline: check-out time + source + worked | same | partial | E5 |
| TM21 | "Now · Still working · 4h 46m so far" | `/today` | exists | |
| TM22 | Fix form: "Note for Siddharth", "Send to Siddharth" | none | **missing** | Approver preview (E8) |
| TM23 | "Payroll locks on Mon, 28 Sep. Fixes after that count next month." | none | **missing** | E13 for the date. The second sentence is not true today: no arrears are paid for fixes after a run is locked (§11 C7) |
| TM24 | Sent state "Sent to Siddharth Rao…" | the correction row, but no approver name | partial | E8 / E9 |
| TM25 | Day CTA: "See the request" (leave), "Ask to work from home" (future), "Something wrong? Ask to correct it" (on time), "Explain the late mark" (late) | navigation / correction | exists, except "Explain the late mark" | E25 |

### 5.2 Tab "This month": actions

| # | Action | API | Status |
|---|---|---|---|
| TA1 | Work from home (header) | → `/me/wfh` | exists |
| TA2 | Fix a day (header): selects the newest day to fix | local | exists |
| TA3 | Stat card → selects a day | local | exists |
| TA4 | Tap a day → day details | `GET /v1/attendance/review/day` | exists |
| TA5 | Change month (keep) | `/history?year&month`, `/monthly-stats?year&month` | exists |
| TA6 | Send a fix (left-at time, what happened, note) | `useCreateCorrection` → `POST /v1/attendance/corrections` (`attendance.checkin.self`): `requestedDate`, `requestedCheckOutAt` only, `reason` (put "What happened" + note in it; `@NotBlank`) | exists. `requestedCheckInAt` is optional in `CorrectionRequestRequest`, and approval only sets the times that were sent (`AttendanceService.java:1837-1843`) |
| TA7 | Attach proof (keep; not in the design) | `POST /v1/attendance/corrections/attachments` | exists |
| TA8 | See the request | → `/hrms/leave?tab=my` | exists |
| TA9 | Ask to work from home on that day | → `/me/wfh` with the day picked | exists (the prefill is new frontend) |
| TA10 | Ask to correct it (check-in and check-out) | `POST /v1/attendance/corrections` | exists |
| TA11 | Explain the late mark | none | **missing** (E25) |

### 5.3 Tab "Timesheet": data points and actions

Today: `ess/TimeEntries.tsx` on `/me`. It works one day at a time (a DateField for any past day), with free-text description, minutes, edit and delete.
- API: `GET/POST/PUT/DELETE /v1/ess/timesheets` (class-level `@PreAuthorize("hasAuthority('attendance.checkin.self')")`, `TimeEntryController.java`), JDBC table `hrms.time_entries` (no project, no status).
- Rules: no future dates, 24 h/day cap, own entries only.

| # | Design item | Source today | Status |
|---|---|---|---|
| TS1 | "This week · Mon 21 – Fri 25 Sep" | computed | exists |
| TS2 | "38h logged" | `GET /v1/ess/timesheets?from=Mon&to=Sun` | exists |
| TS3 | "aim for 8 hours a day" | shift `workingHoursPerDay` | exists |
| TS4 | Rows by project: name + code ("Payments v2 · PAY-V2") | none: entries have a free-text `description` only. `hrms.projects` exists (name, status; no code; `hrms.project.read`, which employees don't hold) | **missing** (E19) |
| TS5 | Hours per day per row | entries summed | exists |
| TS6 | Row totals | derived | exists |
| TS7 | Day totals + bar vs target | derived | exists |
| TS8 | Week total | derived | exists |
| TS9 | Week state (submitted / approved) | none | **missing** (E19) |
| TSA1 | Add time: Project | none | **missing** (E19) |
| TSA2 | Add time: Day, Hours (0.25 steps) → Add | `POST /v1/ess/timesheets` (`minutes`) | exists (the description is `@NotBlank` today) |
| TSA3 | Submit week | none | **missing** (E19) |
| TSA4 | Edit / delete an entry (keep; not in the design) | `PUT/DELETE /v1/ess/timesheets/{id}` | exists |
| TSA5 | Other weeks (keep; not in the design) | range query | exists |

Proposed home for this tab: a new `?tab=timesheet` on `/hrms/attendance`, a tab the design adds. It is hidden for admin roles like My Attendance. `/me` no longer shows it, and `live-w3-r2.mjs` follows it (§13).

---

## 6. Time → Work from home (`e-wfh`) and Shift change (`e-shift`)

### 6.1 Work from home (`/me/wfh`)

Guards:
- Route: `RouteGuard anyOf ['wfh.request.self', P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]` (App.tsx:275-281).
- Registry `me-wfh`: `wfh.request.self` + self (pageRegistry.ts:104).
- API: `POST /v1/wfh`, `GET /v1/wfh/my` and `POST /v1/wfh/{id}/cancel` all require `wfh.request.self`.
- Company rule "Allow work from home" (`settings.hr_configuration.allow_work_from_home`) → `WFH_NOT_ALLOWED`.

| # | Design item | Source today | Status |
|---|---|---|---|
| W1 | "Siddharth Rao approves them, usually the same day" | none | **missing**: approver preview (E8). "Usually the same day" is not something we measure; drop it or compute it (§11 C7) |
| W2 | "3 of 6 days used in September" (used) | `/v1/wfh/my` | exists (derived) |
| W3 | "Policy · up to 6 days a month" | none | **missing** (E6) |
| W4 | Allowance bar | derived | partial (E6) |
| W5 | Pick days: the next 10 working days (weekday, date) | weekly offs + holidays | exists (derived) |
| W6 | Blocked days with the reason (Leave / Holiday) | `/v1/leave/my`, `/v1/settings/holidays`; also block days already asked (`/v1/wfh/my`); the server refuses overlaps (`WFH_OVERLAP`) | exists (derived) |
| W7 | "2 days: Wed 30 Sep, Thu 1 Oct" | local | exists |
| W8 | Your requests: date(s) | `/v1/wfh/my` `fromDate`, `toDate` | exists |
| W9 | reason | `reason` | exists |
| W10 | "Siddharth Rao · 21 Sep" (who decided, when) | `decidedAt` exists; **`approverId` only, no name** | partial (E9) |
| W11 | Status pill | `status` | exists |
| W12 | WFH switched off for the company | only the 422 on submit; employees can't read HR configuration | partial (E6 returns it) |
| WA1 | Pick / unpick a day | local | exists |
| WA2 | Reason | `reason` (API: optional, max 500; web and mobile rule: 10–500 characters) | exists (§11 C5) |
| WA3 | Send request (several separate days) | `POST /v1/wfh` takes one from/to range | partial: one call per run of days, or E7 |
| WA4 | Cancel a waiting request (keep; not in the design) | `POST /v1/wfh/{id}/cancel` | exists |

### 6.2 Shift change (`/me/shift-change`)

Guards:
- Route: `RouteGuard anyOf [P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]` (App.tsx:261-266).
- Registry `me-shift` (pageRegistry.ts:105).
- API: `GET /v1/shifts?companyId`, `GET /v1/shifts/employee/{id}`, `POST /v1/shifts/change-requests` and `GET /v1/shifts/change-requests/my` all require `attendance.checkin.self` (ShiftController.java:84-181). HR decides with `attendance.regularization.approve`.
- One pending request per person (`uq_scr_one_pending_per_employee`).
- A request not approved by its start date expires.

| # | Design item | Source today | Status |
|---|---|---|---|
| S1 | "You work the General shift, 09:30 to 18:30 with 15 minutes' grace" | `GET /v1/shifts/employee/{me}` (`shiftName`, `startTime`, `endTime`, `gracePeriodMinutes`) | exists |
| S2 | Shift cards: name | `GET /v1/shifts?companyId` | exists |
| S3 | "Your shift" badge | `shiftPolicyId` match | exists |
| S4 | "09:30 – 18:30" | policy times | exists |
| S5 | 24-hour bar | derived (overnight shifts wrap) | exists |
| S6 | "Mon–Fri" | policy `weeklyOffDays`, else the company's weekend days | exists |
| S7 | "41 people" | none for employees (`GET /v1/team/schedule` needs `attendance.team.read`) | **missing** (E21) |
| S8 | Scheduled change "Morning from 30 Sep" (keep; not in the design) | `upcomingShiftName`, `upcomingEffectiveFrom` | exists |
| S9 | Pending request (keep): "Wait for HR…" | `/change-requests/my` | exists |
| S10 | Past changes: title (the reason) | `reason` | exists |
| S11 | Past changes: "3 – 7 Aug" | start: `requestedEffectiveDate` / `appliedEffectiveDate`; **no end date** | partial (E20) |
| S12 | "Meera Joshi · 30 Jul" | `approverName`, `decidedAt` | exists |
| S13 | Status | `status` | exists |
| SA1 | Pick a shift card | local | exists |
| SA2 | From (date) | `effectiveDate` (use `DateField`, not `<input type="date">`) | exists |
| SA3 | Until (optional) | none | **missing** (E20) |
| SA4 | Why do you need it? (10–500 characters) | `reason` | exists |
| SA5 | Send to HR | `POST /v1/shifts/change-requests` | exists |

A duplicate of this form lives at `/hrms/shifts` → "My Shift" for employees (`ShiftRequests mode="mine"`). Keep the URL, and render the same Shift change content there (§11 C5).

---

## 7. Leave (`EmpLeave`), at `/hrms/leave`

Guards:
- Route: `RouteGuard anyOf [P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF]` (App.tsx:387-392).
- Self tabs `my`, `apply` and `balances`: `allOf ['leave.request.self']` + `when: notAdminRole` (pageRegistry.ts:165-167), and `Leave.tsx:297-299` `!isAdmin`.
- `encash`: anyOf `hrms.leave.encash.approve`, `leave.request.self` (:170).
- `calendar`, `types` and `holidays`: no rule (:172-174).
- Menu: `'ess:/hrms/leave'` = `leave.request.self` + self (:291).
- API: `POST /v1/leave/apply` and `POST /v1/leave/{id}/cancel` require `leave.request.self`. `GET /v1/leave/my`, `/my/balances` and `/overview` require `leave.balance.read`. `GET /v1/leave/types` is open to any signed-in user. Holidays: `GET /v1/settings/holidays` is open to any signed-in user; POST and DELETE require `settings.holidays.write`.

**Tab mapping** (DECISIONS 11 keeps today's names and order; `?tab=my|apply|balances` stay, because they are deep-linked from search, notifications and the dashboard):

| Design tab | Today's tab (key) | Content |
|---|---|---|
| Overview | Balances (`balances`) | balance rings, Coming up, Make the most of it, and today's ledger rows |
| Apply | Apply (`apply`) | the planner |
| Requests | My leave (`my`) | request cards with steps, keeping pagination |
| Holidays | Holidays (`holidays`) | public list + optional holidays |
| — | Encash, Calendar, Leave types | kept, restyled with the kit |

The default tab stays My leave. The design opens on Overview (Q13).

### 7.1 Overview (→ Balances)

| # | Design item | Source today | Status |
|---|---|---|---|
| LO1 | Balance cards: type, ring, "6.5 of 12 left" | `/my/balances` | exists |
| LO2 | Note: "Resets on 1 Jan", "+1.5 days on 1 Oct", "A note is needed after 2 days", "Use it by 30 Oct" | the leave year is the calendar year; accrual from `accrualFrequency` + `annualEntitlement` (`LeaveAccrualMath`); `leave_types.requires_attachment_after_days` exists in the DB but no Java code reads it; `leave_mgmt.comp_off_balances` exists but is unused | partial: reset and next credit (E16); the attachment rule and comp-off expiry have no feature behind them (Q13) |
| LO3 | Coming up: waiting requests ("waiting for Siddharth Rao") | `/v1/leave/my` PENDING / PENDING_L2 | partial: approver name (E9) |
| LO4 | Coming up: next holidays, "In 7 days", tip | holidays + weekly offs | exists (derived) |
| LO5 | "Make the most of it": long-weekend suggestions ("Thu 1 Oct → 4 days off · 1 casual day") | holidays + weekly offs + balances | exists (derived) |
| LO6 | Credits, carry forward and encashments (keep) | `useMyLeaveLedger` → `GET /v1/leave/my/ledger` | exists |
| LOA1 | Apply leave (header) | → `?tab=apply` | exists |
| LOA2 | "Plan it →" | → `?tab=apply` with the dates filled in | exists (frontend) |

### 7.2 Apply

| # | Design item | Source today | Status |
|---|---|---|---|
| LA1 | Type tiles: name + "6.5 days left" | `/v1/leave/types?companyId` + balances | exists |
| LA2 | Month range calendar (tap a start day, then an end day) | local | exists. It needs month navigation, and must be built on `src/shared/components/calendar` parts (§11 C10) |
| LA3 | Weekends muted | weekly offs | exists |
| LA4 | Holidays striped + tooltip | holidays | exists |
| LA5 | "Someone in your team is off" dots + names | none: employees see only their own leave (`leave/useLeaveCalendar.ts` notes there is no date-range leave endpoint) | **missing** (E14) |
| LA6 | Summary: date range | local | exists |
| LA7 | Summary: Working days | client count (today skips weekly offs only; the server also skips holidays) | partial: count holidays too, or E15 |
| LA8 | Summary: "Casual leave after this" | balance − days | exists |
| LA9 | Summary: Approver | none | **missing** (E8) |
| LA10 | Warning "That's more than you have. N days would be unpaid." | the server refuses: `INSUFFICIENT_LEAVE_BALANCE` (`LeaveService.java:251-256`); today's UI blocks | conflict (§11 C6, Q7) |
| LA11 | Warning "Kavya and Arjun will also be off" | none | **missing** (E14) |
| LA12 | Half-day duration (keep; not in the design) | `duration` FULL_DAY / HALF_DAY_MORNING / HALF_DAY_AFTERNOON | exists |
| LA13 | Overlap warning (keep) | `/v1/leave/my` | exists |
| LAA1 | Pick type, pick days, reason | local; reason 10–500 characters today (the API allows it empty) | exists (§11 C5) |
| LAA2 | "Send to Siddharth Rao" | `useApplyLeave` → `POST /v1/leave/apply` | exists (name: E8) |

### 7.3 Requests (→ My leave)

| # | Design item | Source today | Status |
|---|---|---|---|
| LR1 | "Casual leave · 2 days" + status pill (Waiting / Approved / Cancelled / Rejected / Awaiting HR) | `/v1/leave/my` | exists |
| LR2 | Dates · "reason" | same | exists |
| LR3 | Steps: Sent (when) → Siddharth Rao (reviewing / approved / stopped) → Balance updated | `createdAt`, `status`, `approvedAt`; **no approver name**; PENDING_L2 means an HR step | partial (E9) |
| LR4 | Approver comment (keep) | `approverComment` | exists |
| LR5 | Pagination (keep) | `page`, `size` | exists |
| LRA1 | Cancel request | `useCancelLeave` → `POST /v1/leave/{id}/cancel?reason=` | exists. The design shows it only for waiting requests; today it is also offered for approved leave that hasn't ended (the server allows it, `LeaveService.java:484-520`). Keep. `useCancelLeave` refreshes only `['hrms','leave','my']`, not the balances (E29) |

### 7.4 Holidays

| # | Design item | Source today | Status |
|---|---|---|---|
| LH1 | "Public holidays · Bengaluru" | holidays are per company; `settings.holiday_branches` exists but no code reads it | partial: E18 (shared with the Leave audit's L12); use the company name until then |
| LH2 | Rows: weekday, date, name, tip, "In 7 days" | holidays + weekly offs | exists |
| LH3 | "Pick up to 2 a year · 1 left" | none | **missing** (E17) |
| LH4 | Optional rows: name, date, Taken / Booked / Take it / None left | the `OPTIONAL` and `RESTRICTED` holiday types exist, but leave and attendance treat every active holiday as a day off for everyone | **missing** (E17) |
| LHA1 | Take it | none | **missing** (E17) |
| LHA2 | Add / archive holiday (keep, HR only) | `settings.holidays.write` | exists |

---

## 8. Web check-in and check-out, face kiosk, breaks: what exists

- **Web check-in/out API: exists.**
  - `POST /v1/attendance/checkin` (JSON; optional face image) and `POST /v1/attendance/checkout`, both `attendance.checkin.self`, identity from the token (`AttendanceController.java:123-247`).
  - `GET /v1/attendance/today`, `/checkout-summary` and `/app/home` (the mobile punch screen: `punchedIn`, `todayRecord`, `monthlySummary`, `scheduledStart`, `graceMinutes`).
  - Hooks `useCheckIn`/`useCheckOut` in `modules/hrms/api/useAttendance.ts:398-420`. They are unused on the web.
- **Web punch UI: removed on purpose on 6 Jun 2026** (`ERP_READINESS.md:17`, "removed all punch/check-in/out buttons (mobile-only)"). `RoleDashboard` has "My Attendance" instead of "Mark Attendance".
- **Production rules that a web punch would meet:**
  - The geofence is hard-blocked when `hrms.attendance.geofence-enforce` (prod default `true`, `application-canonical-prod.yml:27`) and the company rule "Require geofencing on mobile" (default true) are both on, unless it's an approved WFH day.
  - `useCheckIn` sends latitude/longitude 0,0, so it would be refused with `OUTSIDE_GEOFENCE`.
  - One record per person per day: a second check-in → `ALREADY_CHECKED_IN`.
  - The punch method column allows `MANUAL, FACE_RECOGNITION, BIOMETRIC_FINGERPRINT, MOBILE_GPS, KIOSK, GEO_FENCE, API, GPS, PIN, MANAGER_OVERRIDE, BIOMETRIC_DEVICE`. There is **no `WEB`**, and the admin screens label `MANUAL` as "Added by HR".
- **Face:**
  - Face check-in: `POST /v1/attendance/checkin/face` (`attendance.face.verify.self`, `FaceController`).
  - Enrolment runs on web for HR (`attendance/face/*`, the webcam).
  - Kiosk and phone devices are labelled (`FacePunchDevices`).
  - Managers can punch for their team with the person's face (`/v1/attendance/assisted-punch`).
  - There is no web face punch for the employee.
- **Breaks: missing.** There is no endpoint and no service. `AttendanceEventType` has `BREAK_START` and `BREAK_END` (enum lines 6-7), and the `attendance.event_logs` check constraint allows them. Shift policies store `working_hours_per_day`; the break is implied by span minus working hours (`AttendanceContainer.tsx` `breakMin`).
- **"Your day": can be built today** from `GET /v1/attendance/today` (times, method, location, type) and `GET /v1/attendance/review/day?employeeId=me&date=today` (today's effective status, shift name, expected start/end, grace), both self-allowed. E4 folds them into one call.

---

## 9. Around you, Needs you, My requests: source by source

| Block | Item in the design | Source today | Status |
|---|---|---|---|
| Around you | Payroll date ("Payroll locks · Monday") | none for self | missing (E13) |
| | Birthdays / anniversaries ("Kavya Menon's birthday · Tomorrow · Engineering") | `GET /v1/hrms/milestones` (isAuthenticated; birthdays 7 days, anniversaries 31 days by default) | exists |
| | Public holidays | `GET /v1/settings/holidays` | exists |
| | Company events ("Diwali party · RSVP by 30 Oct") | `GET /v1/admin/dashboard/notices` (isAuthenticated; title, body, `expiresOn`, `createdAt`; **no event date**) | partial (E12) |
| | Manager: "probation ends · decide before then" | `/v1/probation/upcoming` → 403 for managers | missing (E23) |
| Needs you | Fix your missed punch-out (due: payroll date) | `/history` + `/corrections/my` | exists (the due date needs E13) |
| | Sign your appraisal letter | `/v1/letters/my` (`SIGNED` status exists) | partial (Documents audit) |
| | Upload a clearer address proof | `/v1/document/my` statuses + `/v1/document/my/missing` | partial (Documents audit) |
| | Write your Q3 self-review (due Wed) | `/v1/performance/reviews/my` | partial: cycle due date (Growth audit) |
| | Finish POSH awareness (required, due Wed) | `/v1/learning/enrollments/me` | partial: required flag / due date (Growth audit) |
| | Accept the Code of conduct | policies + `/v1/policy/my-acknowledgements` | partial: due date |
| | (today's shortcuts) onboarding tasks, interview scorecards, assets to confirm | `useMyInterviews`, onboarding, `/v1/me/assets` | exists / partial |
| My requests | Leave, WFH, fix, shift change, expense, advance | the `/my` lists | partial: approver names (E9), steps (E10) |

---

## 10. Gaps: backend work each missing piece needs

Rules applied (DECISIONS 2):
- New tables and columns are JDBC-only.
- A column added to a JPA-mapped table stays unmapped by the entity (`ddl-auto=validate` ignores extra columns).
- Each feature hides itself until its migration is applied.
- New permissions are granted to OWNER and SUPER_ADMIN in their migration.

| Id | What | Backend work | Schema change | Table JPA-mapped? | Size |
|---|---|---|---|---|---|
| E1 | Web check-in / check-out on Home, including the not-checked-in state | Company switch `allow_web_punch` (new column on `settings.hr_configuration`, read/written with JdbcTemplate; entity `HrConfiguration` must not map it). `WEB` value in `CheckInMethod`, and a migration widening `ck_attendance_records_check_in_method` / `_check_out_method`. Refuse `WEB` punches when the switch is off (`WEB_PUNCH_NOT_ALLOWED`) and when the migration isn't applied. Browser location required (the geofence rule is unchanged; approved WFH days are exempt). Label `WEB` "Web check-in" (already in `SOURCE`). Toggle in HR Configuration → Attendance rules (its own settings section). Tests + live test | Yes: 1 column + 2 check constraints | `settings.hr_configuration`: yes (entity `HrConfiguration`; new column unmapped). `attendance.records`: yes (`AttendanceRecord`; enum value only, no column change) | M |
| E2 | "Check in again" | Recommended: `POST /v1/attendance/checkout/undo`. Same IST day, within N minutes, only a check-out the person made themselves. It clears `check_out_at`, the method, `work_hours` and overtime, and logs `MANUAL_OVERRIDE` with a note. (A real second session would need a sessions table and would change hours, the policy and payroll: L.) | No (the recommended option) | — | S |
| E3 | Take a break | `POST /v1/attendance/breaks/start` and `/end` (`attendance.checkin.self`, identity from the token). Allowed only while checked in and not checked out; one open break at a time. Writes `BREAK_START`/`BREAK_END` rows to `attendance.event_logs` (JPA `AttendanceEventLog`; both values already allowed). An open break closes at check-out. Break minutes are returned by E4. Whether `work_hours` subtracts breaks is Q3 (default: no, so pay doesn't change). Unit + controller + live tests | No | `event_logs`: yes (no change) | M |
| E4 | "Your day" in one call | `GET /v1/attendance/my-day`: today's record (in, out, method, location, type), effective status (weekly off / holiday / leave / not marked), shift (name, start, end, grace, working hours), break state, worked minutes so far | No | — | S |
| E5 | Per-day details on the month calendar | Add `attendanceType`, `lateMinutes`, `checkInMethod`, `checkOutMethod`, `locationName` and `regularized` to `DayRecordResponse` (`GET /v1/attendance/history`). They come from `EffectiveDay` and the record. New JSON fields only; the mobile app ignores them | No | — | S |
| E6 | WFH monthly allowance | Column `settings.hr_configuration.wfh_days_per_month INT NULL` (JDBC-only; null = no limit). `GET /v1/wfh/my/summary?month=` (`wfh.request.self`) → `allowed`, `used`, `pending`, `allowWorkFromHome`. Optionally refuse beyond the limit (`WFH_LIMIT_REACHED`; Q4). Field in HR Configuration → Attendance rules | Yes: 1 column | yes (unmapped column) | M |
| E7 | Several separate WFH days in one send | `POST /v1/wfh/batch {dates[], reason}`: splits the days into runs, one transaction, overlap checks, one approver notification | No | `wfh_requests`: yes (no change) | S |
| E8 | Approver preview ("Send to Siddharth Rao") | `GET /v1/me/approvers?for=leave\|wfh\|correction\|shift` → name and how it was chosen (manager, department head, HR, admin, delegate). Move the chain duplicated in `LeaveController.apply` and `WfhController.apply` into one service. Fix requests and shift changes are decided by anyone with `attendance.regularization.approve` in scope, so the notification path (manager → head → HR) is the name to show | No | — | S |
| E9 | Approver names on my requests | Add `approverName` (+ L2 name/time) to `LeaveRequestResponse` (`/v1/leave/my`, `/overview`), `WfhRequestResponse`, `CorrectionRequestResponse`; expenses and advances if missing. API fields only | No | — | S |
| E10 | "My requests" on Home | `GET /v1/ess/my-requests?limit=`: one list across leave, WFH, fixes, shift changes, expenses and advances. Each row has type, title, dates, status, steps, progress, approver and link. Each source only with its own self permission; one failing source doesn't fail the list | No | — | M |
| E11 | "Needs you" (+ the count in the greeting) | `GET /v1/ess/needs-you` → items with kind, title, sub-line, due date, tone and link. Employee sources: missed punch-outs with no fix, letters to sign, documents to redo or missing, self-review due, required course due, policies to accept, onboarding tasks, assets to confirm, interview scorecards. Manager sources: probation decisions (E23), reviews to write. Each source behind its permission; isolated failures. Due dates depend on the Documents and Growth audits | No (unless those areas add due dates) | — | L (M with today's sources only) |
| E12 | "Around you" | `GET /v1/ess/around-me?days=`: milestones, holidays, notices, payroll date (E13) and team probation ends (E23), sorted by date. Optional `event_date DATE NULL` on `hrms.company_notices` (JDBC table) + a field in the notices form (dashboard area) | Optional: 1 column | no | M |
| E13 | Next payday / payroll date for self | `GET /v1/payroll/payslips/me/schedule` (`payroll.payslip.read.self`) → next pay date (next run's `pay_date`, else `payroll.settings.salary_processing_day`) and the processing day. Add `payDate` to `/payslips/me` rows | No | — | S |
| E14 | "Someone in your team is off" | `GET /v1/leave/team-off?from&to` (`leave.balance.read`) → per day, first names of colleagues (same department, else same manager) with approved or pending leave. No leave type is shown (privacy, Q12) | No | — | M |
| E15 | Exact leave preview | `GET /v1/leave/preview?leaveTypeId&startDate&endDate&duration` → working days as `applyLeave` counts them, balance after, approver, and the blocking reasons (notice, max consecutive, overlap, balance) | No | — | S |
| E16 | Balance notes | `nextCredit {days, on}` (from `LeaveAccrualMath`), the reset date and the carry-forward cap on each balance (new fields on `LeaveBalanceResponse`, or `GET /v1/leave/my/balance-notes`) | No | — | S |
| E17 | Optional holidays | New table `leave_mgmt.optional_holiday_choices` (tenant, company, employee, holiday, year, status, times; RLS; JDBC). Yearly quota: column `settings.hr_configuration.optional_holidays_per_year` (JDBC-only). Endpoints `GET /v1/leave/optional-holidays/my?year`, `POST …/{holidayId}/book`, `POST …/{id}/cancel` (`leave.request.self`). Change `EffectiveDayStatusService`, `AttendanceService.resolveHolidayDates`, `LeaveService.fetchHolidayDates`, payroll working days and the muster roll so that `OPTIONAL`/`RESTRICTED` holidays are days off only for people who booked them. Admin list of bookings (Leave → Holidays) | Yes: new table + 1 column | new table: no; `hr_configuration`: yes (unmapped column) | L |
| E18 | Branch holidays ("Public holidays · Bengaluru") | Use `settings.holiday_branches` in the holiday reads and in the leave, attendance and payroll counts. Same item as the Leave audit's L12 | No (the table exists) | — | M (shared) |
| E19 | Timesheet by project + "Submit week" | `project_id` on `hrms.time_entries` and `code` on `hrms.projects` (both JDBC). `GET /v1/ess/timesheets/projects` (`attendance.checkin.self`: my company's active projects). Description optional when a project is set. New table `hrms.timesheet_weeks` (status, submitted/decided by and at, note). `POST /v1/ess/timesheets/weeks/{monday}/submit`. Manager queue + decision with a new permission `hrms.timesheet.approve` (migration grants OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER). Entries of submitted or approved weeks are locked. Notifications. A row type in the Approvals inbox | Yes: 2 columns + 1 table + 1 permission | no | L |
| E20 | Shift change with an end date | `requested_end_date DATE NULL` on `attendance.shift_change_requests` (JDBC table created by `ShiftChangeRequestSchemaBootstrap`). On approval, assign the shift with `effective_to` and put the old shift back the day after. The HR card and the employee list show the range | Yes: 1 column | no | M |
| E21 | People per shift | `employeeCount` on `GET /v1/shifts` (assignments in force today, same company) | No | — | S |
| E22 | "Message team" | Team announcements: audience columns on `hrms.company_notices` (JDBC), or a new table `hrms.team_messages`. `POST /v1/team/messages` with a new permission `hrms.team.message` (granted to DEPT_MANAGER/MANAGER + OWNER/SUPER_ADMIN). In-app notification to `TeamEmployeeScope.teamOf(manager)`. Shown in the team's Around you | Yes | no | M |
| E23 | Probation decisions for managers | Team-scoped probation list for `hrms.employee.team.manage` holders (people from `teamOf(manager)` only), for example `GET /v1/probation/upcoming?scope=team` | No | — | S |
| E24 | Leave type for people on leave today | `leaveTypeName` on `StaffStatusResponse` for people on leave (`GET /v1/attendance/dashboard`) | No | — | S |
| E25 | "Explain the late mark" | Option A: open a fix request with the corrected check-in time (frontend only). Option B: new excuse request (`attendance.excuse_requests`, JDBC) + endpoints + a row in the Review list + notification. Q9 | B: yes (new table) | no | S (A) / M (B) |
| E26 | Customise + "Most used first" on Home | Reuse the dashboard audit's G1 (table `hrms.user_dashboard_prefs`, `/v1/me/dashboard/quick-actions`) with a `surface=home` key | Covered by G1 | no | S (on top of G1) |
| E27 | Undo on "Waiting for you" rows | Shared with Team approvals and the dashboard (DECISIONS item 3) | per that design | — | M (shared) |
| E28 | Existing bug: approving a fix turns a WFH day into an office day | `applyApprovedCorrection` always sets `AttendanceType.OFFICE` (`AttendanceService.java:1848`). Keep the record's type when it exists. The design's Fix-a-day makes this common | No | `records`: yes (no change) | S |
| E29 | Existing bug: cancelling leave doesn't refresh balances | `useCancelLeave` refreshes `['hrms','leave','my']` only; add `balances` and `overview` (frontend) | No | — | S |

---

## 11. Conflicts with existing behaviour and earlier client decisions

**C1. Web punching was removed on purpose (6 Jun 2026).**
- The design brings back Check out, Check in again and Take a break.
- Production blocks punches outside the zone, and a web punch has no face check.
- Needs Q1. Safest default: the "Your day" strip is read-only until a company switches web punching on (E1).

**C2. One check-in a day.**
- "Check in again" can't work as drawn.
- Options are in E2 and Q2.

**C3. Breaks and pay.**
- The design says "Your timer is paused".
- Today's worked hours (half-day rules, payroll) use check-in to check-out.
- Q3.

**C4. Tab names.**
- DECISIONS 11: today's tab names and order stay.
- Design Leave tabs are Overview / Apply / Requests / Holidays. Today's are My leave / Apply / Balances / Encash / Calendar / Leave types / Holidays. Mapping in §7.
- Design Time tabs are This month / Timesheet. Today's are My Attendance / Regularization (+ the new Timesheet).
- The page titles in the design ("Attendance", "Leave") differ from today's ("Daily Tracking", "Leave Management"), and `live-rail-highlight.mjs` reads "Leave Management".

**C5. Things the design leaves out that exist today. All kept:**
- **Leave:**
  - half-day duration
  - the 10-character minimum reason (the design says "Optional")
  - cancelling approved leave that hasn't ended
  - pagination
  - the overlap warning
  - the Encash, Calendar and Leave types tabs
  - the ledger rows
- **WFH:** Cancel, and the 10-character reason.
- **Shift change:** the pending note, the scheduled change, the expiry note, and the duplicate "My Shift" tab at `/hrms/shifts`.
- **Attendance:**
  - month navigation
  - fix requests with both check-in and check-out times
  - proof upload
  - the Regularization list of my requests
- **Time entries:** edit and delete, free-text description, any past day.
- **`/me`:**
  - the Absent / On time / Score tiles (the design shows Present, Leave left, Late marks and WFH). Proposal: put absent days and the score in the Present card's note.
  - the Salary, Onboarding tasks, My assets, Interviews and Profile shortcuts

**C6. Leave beyond the balance.**
- The design's warning says the extra days would be unpaid, and it lets the request go.
- The server refuses (`INSUFFICIENT_LEAVE_BALANCE`), and today's UI blocks.
- Keep blocking unless Q7 says otherwise.

**C7. Copy the system can't back:**
- "Fixes after that count next month": no arrears are paid for fixes after a locked run.
- "Payroll locks on …": there is no per-person lock date. The processing day is real (E13).
- "usually the same day" (WFH).
- "You can cancel until it starts": the server allows it until the leave ends.
- "Send to HR" (shift): managers with `attendance.regularization.approve` also decide them.

**C8. Admin-role rule.**
- My Attendance, My leave, Apply and Balances are hidden for OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN. The ESS group is hidden for them too (`PlatformShell.tsx:457`).
- The new Timesheet tab and every "My work" key follow the same rule (DECISIONS 11).
- `/me` is still reachable by URL for owners (found but not fixed on 26 Sep; shell audit C16).

**C9. Greeting.**
- Use `greetingName()` (the first name, or the full name when it has fewer than 2 letters).
- Use the IST hour. `EssDashboard` uses the browser's local hour.

**C10. Calendar rule.**
- Every date field uses `src/shared/components/calendar`. The design uses `<input type="date">` for the shift change From/Until fields.
- The three month grids (Home, Time, Leave planner) should be built on its `DayGrid` parts.
- `live-w3-r2.mjs` checks the shared fields on Leave Apply From/To, WFH From/To, shift "Starting from", the history `MonthField` and the time-entries `DateField`. The design removes Leave Apply's From/To fields (a range calendar instead), so that check changes.

**C11. Rail highlight.**
- `/hrms/leave` and `/hrms/attendance` belong to both an admin rail item and My work.
- New My work keys go into `railLit.SELF_SERVICE_RAIL` (DECISIONS 11). `live-rail-highlight.mjs` covers it.

**C12. WFH tile permission.**
- Today's `/me` shows the WFH shortcut to anyone with `hrms.ess.read` or `attendance.checkin.self`, and the API then refuses them without `wfh.request.self`.
- Gate the tile, stat and page link on `wfh.request.self`. This hides a dead end; it is not a removal.

**C13. Settings stay in their own sections.**
- The new switches (web punching, WFH days per month, optional holidays per year) go to HR Configuration → Attendance / leave rules, or Leave → Holidays (admin).
- They never go on self-service pages.

**C14. The fix-approval bug (E28)** changes a WFH day's type. It's a behaviour fix, so say so in the report.

**C15. Inline reject.**
- The design rejects in one click.
- WFH rejection needs a note, so Reject opens a short note dialog for those rows (same as the Leave audit's D.5).

**C16. Managers move from the admin dashboard to Home** (25 Sep decision reversed by DECISIONS 12). Past-day team history stays under Attendance & time.

**C17. Holidays.**
- Holidays are company-wide today, and Optional/Restricted holidays are days off for everyone.
- The design implies branch holidays and personal optional holidays (E17, E18).

**C18. Dark mode.**
- The design's calendar chips, pills and notes use raw hex that stays light in its own dark mode.
- Build them with tokens (REDESIGN_RULES).

---

## 12. Shared components needed

From the README list:
- **PageHeader:** title, sub-line, actions. For Home it is a greeting row with a TODAY date chip.
- **PillTabs** in the top bar: Time has a Pages button plus tabs; Home and Leave show one pill or tabs.
- **StatCard:**
  - `live` variant: accent `--k`, animated icon, sparkline with dot (Home, both roles; `UtLive`).
  - `stat` variant: icon tone brand, gold or red (Time → This month; `UtStat`).
- **QuickActionTile** (`UtQuick` kinds calendar, home, clock, download, swap, mail, user, megaphone; hint; badge) and a Customise popover.
- **Card/Section**.
- **ListRow**: task rows with a tone icon and due chip; request rows with a status pill and progress bar; team rows with an avatar and pill.
- **StatusPill**: ok, warn, info, leave, gray.
- **ApprovalRow**: inline approve/reject, result pill, Undo, and a note dialog for WFH.
- **SegmentedControl**: All / Late / Not in.
- **MonthCalendar**, in three forms on `src/shared/components/calendar` parts:
  - mini with a legend (Home)
  - large with labels, dots, a Today badge and a selection ring (Time)
  - range picker with holiday stripes and team dots (Leave Apply)
- **Meter/ProgressBar**: leave balances, request progress, WFH allowance, the day bar, timesheet day bars.
- **Ring**: leave balance rings.
- **Avatar** (initials).
- **EmptyState**, **Skeleton**, **Toast**.
- **Popover/Menu** (Customise).
- **Dialog**: cancel leave or WFH, reject note.
- **FormField**: time input, select, textarea, number, `DateField`.

Page-specific pieces:
- "Your day" strip (DayStrip)
- DateTile: day + month for Around you; weekday + day for Coming up and holidays
- PayCard with a hidden amount
- DayDetail panel with a punch timeline and the Fix-this-day form
- TimesheetGrid (scrolls sideways under 720 px)
- WFH day chips: free / picked / blocked with a reason
- ShiftOptionCard with a 24-hour bar (reuse `design/dc/ShiftBar`)
- LeaveTypeTile (selectable)
- Request summary aside (sticky, key–value rows)
- StepProgress (3–4 steps)
- Long-weekend tip card
- Optional-holiday row

---

## 13. Risks

**R1. Live e2e scripts that assert today's markup of these pages.** Update their selectors and keep every behavioural check.

| Script | What it asserts |
|---|---|
| `e2e/recovery/live-w3-greeting-myatt.mjs` | tab labels "My Attendance" / "Daily Logs" and the heading on `/hrms/attendance`; `?tab=my` fallback for admins; greetings on `/dashboard` (staff dashboard), `/me` and `/team` |
| `live-dead-entrypoints.mjs` | `/me` text "Your balance this year", a button `/^Salary.*View/`, "Apply for leave" → `/hrms/leave?tab=apply`, "Onboarding tasks" |
| `live-w3-r2.mjs` | Leave Apply From/To shared fields; WFH From/To and "N days from home"; shift "Starting from"; the history `MonthField` and time-entries `DateField` on `/me` (adds and deletes an entry); 390 px on `/me` and `/me/wfh`; holidays tab |
| `live-staff-dashboard.mjs` | the old staff dashboard at `/dashboard`. Retired by DECISIONS 12, and already failing on the 26 Sep baseline (shell audit) |
| `live-design-attendance.mjs` | employee: the "Daily Tracking" section, the "My Attendance" heading, no Daily Logs; corrections "New request", placeholder "e.g. Forgot to punch out", "Send request", toast "Fix request sent"; `/hrms/shifts` heading "My Shift" |
| `live-design-leave.mjs` | the employee views My leave / Apply / Balances / Calendar / Leave types / Holidays; Fri–Mon preview = 2 days; Pending; the cancel dialog; toasts "Leave request sent", "Leave cancelled" |
| `live-rail-highlight.mjs` | Me → Leave / Attendance / Team Attendance / Letters tabs; the titles "Leave Management" and the Me label; phone view |
| `live-w3-search.mjs` | employee search results → `/hrms/leave?tab=my`, `/me/payslips`; `/me` loads |
| `live-shift-request-dates.mjs`, `live-shift-requests.mjs` | `/me/shift-change` form and dates (partly stale already) |
| `live-leave-calendar.mjs` | the employee's own calendar view |
| `live-design-team.mjs` | `/team` for the manager; an employee can't open it |
| `live-time-workflows.mjs`, `live-w1c.mjs` | API only: time entries, team schedule, WFH apply and its notification wording (E7 must keep the wording) |
| unit: `src/shared/navigation/pageRegistry.test.ts`, `src/layouts/railLit.test.ts`, `src/shared/search/search.test.ts`, `src/shared/hooks/greetingName.test.ts` | menu rules for `ess:` keys, rail lighting, search entries, greeting rule |

**R2. Web punching in production** (if enabled): refused punches outside the zone, a missing `WEB` value (an insert fails until the migration is applied, so gate on it), and punches mislabelled "Added by HR" if they are stored as `MANUAL`.

**R3. Optional holidays (E17)** change leave day counts, attendance and payroll working days for tenants that already use Optional/Restricted holidays.

**R4. Request count on Home.** It would otherwise fire about 15 calls for an employee and 20+ for a manager. Use the aggregators (E4, E10, E11, E12), sensible `staleTime`, and one failure = one block's error state.

**R5. Data edge cases:**
- IST dates everywhere
- per-person weekly offs, not Sat/Sun
- night shifts (the check-out is on the next day)
- days before tracking started are missing from `/history`
- future-dated test payroll runs (pick the newest period not after this month)
- people with no shift ("No shift yet")
- people with no employee record

**R6. Phone widths:**
- The Time grid (7 columns with labels) needs a compact form.
- The Leave planner.
- The timesheet grid scrolls sideways (the design puts it in a `min-width:720px` box).

**R7. Keep query keys** (`['hrms','attendance','history',y,m]`, `['hrms','leave','my',…]`, `['hrms','wfh',…]`, `['ess','time-entries',…]`) so today's invalidations keep working.

**R8. `attendance.event_logs` is partitioned by month.** Break rows need the same partitions check-ins already use.

---

## 14. Open questions (only the real ones)

1. **Web punching.** Punching was made mobile-only on 6 Jun. Should people check in and out from the web again?
   - If yes: a per-company switch (off by default), browser location required (production enforces the zone), no face check on the web.
   - If no: the "Your day" strip is shown read-only with no Check out button.
2. **"Check in again" after checking out.** Choose one:
   - "Undo check-out" within a few minutes (small)
   - a real second session in the day (large; changes hours and pay)
   - hide it
3. **Breaks.** Should break time reduce counted working hours (half-day rules, payroll), or only pause the "Your day" timer?
4. **WFH allowance.** Add a company setting "WFH days per month" in HR Configuration → Attendance rules? Should it refuse requests beyond the limit, or only show the count? (The attendance audit asks the same.)
5. **Timesheet.** The design logs time per project with a weekly "Submit week" to the manager. Today it's free-text per day with no approval. Choose one:
   - build projects on time entries + weekly submit/approve (large)
   - keep free-text rows grouped by description, with no submission
6. **Optional holidays.** Build booking with a yearly quota? It changes attendance, leave counts and payroll for companies using Optional/Restricted holidays. If yes, does a booking need the manager's approval?
7. **Leave beyond the balance.** Keep refusing (today), or allow it with the extra days unpaid, as the design's warning suggests?
8. **Shift change "Until".** Build temporary shift changes, where the old shift comes back after the end date?
9. **"Explain the late mark".** Choose one:
   - a new excuse request to the manager
   - open the existing fix request to correct the check-in time
10. **"Message team" for managers.** Build team announcements (team = the departments they head, else direct reports) with a new manager permission?
11. **Payroll line on "Fix this day".** Show the real "Payroll is processed on {date}" instead of "Payroll locks on …" + "Fixes after that count next month"? The second sentence is not true today.
12. **Privacy.** Is it OK to show every employee the first names of colleagues who are off, on the leave planner (same department)?
13. **Leave page defaults.** Today the Leave page opens on "My leave"; the design opens on the balances overview. Keep today's first tab (DECISIONS 11)? Also, should the balance notes mention a document rule ("a note is needed after 2 days") and comp-off expiry? Both exist only as unused database columns today, so showing them means building them.
