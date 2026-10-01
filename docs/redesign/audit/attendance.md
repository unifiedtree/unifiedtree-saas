# Attendance & time (admin) — Phase 0 audit

- **Area:** daily tracking (Today, Review, Manual entry), attendance analytics (Overview, Punctuality, Overtime), shifts & overtime (Shifts, Rosters, Overtime rules, Change requests), muster roll, and the two My-workspace pages in the same prototype file (Work from home, Shift change).
- **Prototype files:** `PgAttendance.dc.html` (Daily tracking → Today) and `PgTime.dc.html` (pages `a-daily` tabs 1–2, `a-analytics`, `a-shifts`, `cp-muster`, `me-wfh`, `me-shift`). `PgTime` also holds `l-ops` (Leave). That is the Leave audit's area and is not covered here.
- **Repo:** `C:\REACT\unifiedtree-saas` at `e32a4dc6`. Nothing was changed.
- **How this was checked:** by reading the source (routes, containers, hooks, controllers, DTOs, migrations, tests). The local API (`127.0.0.1:8080`) and the recovery DB (`127.0.0.1:55432`) were both down during the audit (connection refused), so no live GET or SQL was run. Response shapes and permission grants below come from the code and the migrations.

## Summary

- **Everything the design shows is already built, except:**
  - the weekly roster grid
  - company overtime rules
  - Punctuality as its own tab
  - bulk "Mark attendance"
  - "Notify" and "Remind all at once"
  - "By branch"
  - average arrival
  - department and branch attendance rates
  - "Recent manual entries"
  - a day-register export
  - the WFH allowance and the approver's name
  - Undo on decisions
  
  All of the existing pages come from one container (`AttendanceContainer.tsx`) plus three stand-alone pages (`MusterRoll.tsx`, `ManualEntry.tsx`, and `ApplyWfh.tsx` / `ShiftChangeRequest.tsx`).
- **The design regroups the tabs:**
  - Daily tracking = Today · Review · Manual entry.
  - Analytics = Overview · Punctuality · Overtime.
  - Shifts = Shifts · Rosters · Overtime rules · Change requests.
  
  Five of today's tabs have no place in the design: Face Punch, Regularization, My Attendance, Calendar and My Shift. All five are live features with deep links (notifications, dashboard alerts, search, calendar clicks), so they must stay reachable (C1).
- **Most gaps need no schema change.** They are additive DTO fields, new read endpoints on existing tables, or frontend work. Only two need a new table:
  - company overtime rules
  - the WFH monthly allowance
  
  A third, a new "acknowledge" review action, needs a CHECK constraint changed on a JDBC table. That one can be avoided.
- **Tests:** many live tests assert today's markup, listed in §9. `live-design-attendance.mjs`, `live-design-attendance-admin.mjs`, `live-w3-analytics.mjs` and `live-w3-greeting-myatt.mjs` will break on any restyle.

---

## 0. Design navigation vs today

Design model: `hrms-core.js`.
- `M.attendance.pages`:
  - `a-daily` [Today, Review, Manual entry]
  - `a-analytics` [Overview, Punctuality, Overtime]
  - `a-shifts` [Shifts, Rosters, Overtime rules, Change requests]
- `M.compliance.pages`: `cp-muster`
- `M.me.pages`: `me-wfh`, `me-shift`

Which view renders what: `VIEW['a-daily']='att'` with `VTAB['a-daily']=0` means Today is `PgAttendance`. Tabs 1–2 and all of `TIME` render in `PgTime`.

| Design page · tab | Today's route (and `?tab=` key) | Today's files | State |
|---|---|---|---|
| Daily tracking · **Today** | `/hrms/attendance?tab=team` ("Daily Logs"), also `?date=`, `?status=` | `modules/hrms/attendance/AttendanceContainer.tsx` → `design/dc/AttendancePage.tsx`(+`.view.tsx`) → `design/dc/AttDailyLogs.tsx`(+view); `attendance/StatusChangeDrawer.tsx`; `attendance/attendanceBuckets.ts` | Exists; additions needed |
| Daily tracking · **Review** | `/hrms/attendance?tab=review` | `attendance/ReviewList.tsx`, `StatusChangeDrawer.tsx` | Exists (the same six segments) |
| Daily tracking · **Manual entry** | `/hrms/attendance/manual-entry` (own route, not a tab) | `attendance/ManualEntry.tsx` | Form exists; "Recent manual entries" missing |
| — not in design — | `?tab=face` Face Punch, `?tab=corrections` Regularization, `?tab=my` My Attendance | `design/dc/AttFacePunch.tsx`, `AttRegularization.tsx`, `AttMine.tsx` | Exist; must stay (§14) |
| Attendance analytics · **Overview** | `/hrms/att-analytics?tab=overview&month=` | `design/dc/AttOverview.tsx`(+view) | Exists; content differs |
| Attendance analytics · **Punctuality** | none | — | New tab; data partly exists |
| Attendance analytics · **Overtime** | `/hrms/shifts?tab=overtime` (lives under Shifts today) | `design/dc/ShiftOvertime.tsx` | Exists; the design moves it |
| — not in design — | `/hrms/att-analytics?tab=calendar` | `design/dc/AttCalendar.tsx` | Exists; must stay |
| Shifts & overtime · **Shifts** | `/hrms/shifts?tab=schedules` | `design/dc/ShiftSchedules.tsx` | Exists (cards, not a table) |
| Shifts & overtime · **Rosters** | `/hrms/shifts?tab=roster` | `design/dc/ShiftRoster.tsx` | Exists as a today-list; the week grid is new |
| Shifts & overtime · **Overtime rules** | none | — | Missing feature |
| Shifts & overtime · **Change requests** | `/hrms/shifts?tab=requests` | `design/dc/ShiftRequests.tsx` (`mode="hr"`) | Exists |
| — not in design — | `/hrms/shifts?tab=myshift` (staff without team read) | `ShiftRequests.tsx` (`mode="mine"`) | Exists; must stay |
| Compliance · **Muster roll** | `/hrms/muster-roll` | `attendance/MusterRoll.tsx` | Exists |
| My workspace · **Work from home** | `/me/wfh` | `wfh/ApplyWfh.tsx` | Exists |
| My workspace · **Shift change** | `/me/shift-change` | `shifts/ShiftChangeRequest.tsx` | Exists |

**Notes on the navigation:**
- **Order.** The design's page order is Daily tracking, Attendance analytics, Shifts & overtime. Today's order is Analytics, Daily Tracking, Shifts & Overtime (`PlatformShell.tsx` L118–124, `pageRegistry.ts` L145–159). So the rail click and `/attendance` search lead to a different first page (C3).
- **Unreachable pages.** `me-wfh` and `me-shift` are unreachable in the prototype: module `me` is not in any role's `RGROUPS`. The reachable designs for `/me/wfh` and `/me/shift-change` are `EmpTime.dc.html` `e-wfh` / `e-shift`, which belong to the self-service audit. They are mapped here only because they sit in `PgTime`.
- **WFH approvals for admins** are not in these files. They live in Leave → Approvals, `/hrms/leave?tab=approvals` (`Leave.tsx` L217–256, leave + WFH in one queue, `wfh.approve`).

---

## 0.1 Permission keys in play today (reference for every section)

**Menu:**
- Menus are permission-only: `PlatformShell.isVisible` → `menuRule()`. `visibleForRoles` is no longer read.
- "Attendance & Time" group (`PlatformShell.tsx` L118–124):
  - Attendance Analytics `/hrms/att-analytics`: no menu rule, so the registry `att-analytics` applies: `anyOf attendance.team.read`, module `hrms`.
  - Daily Tracking `/hrms/attendance`: `MENU_RULES['attendance:/hrms/attendance']` = `anyOf attendance.team.read`, module `hrms` (L292).
  - Shifts & Overtime `/hrms/shifts`: `MENU_RULES['attendance:/hrms/shifts']` = `anyOf attendance.team.read` (L293).
- "Compliance" group → Muster Roll `/hrms/muster-roll` (L199): registry `muster` = `anyOf attendance.team.read, hrms.employee.read` (L160).
- "Employee Self Service" group:
  - Attendance: `'ess:/hrms/attendance'` = `attendance.checkin.self` + own employee record (L290).
  - Work from home: `me-wfh` = `wfh.request.self` + self (L104).
  - Shift change: `me-shift` = `anyOf hrms.ess.read, attendance.checkin.self` + self (L105).
  - The whole ESS group is hidden for OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN (`administersWorkspace`, `PlatformShell.tsx` ~L454).
- Manual entry is not in the menu. The registry `manual-entry` = `anyOf attendance.workforce.admin` (L161) is used for ⌘K search only.

**Routes** (`App.tsx`, every one also wrapped in `ModuleGate moduleKey="hrms"`):

| Route | App.tsx line | RouteGuard anyOf |
|---|---|---|
| `/hrms/attendance` | L375 | `hrms.ess.read`, `hrms.employee.read`, `attendance.checkin.self` |
| `/hrms/att-analytics` | L459 | `hrms.report.attendance`, `attendance.team.read` |
| `/hrms/shifts` | L620 | `attendance.team.read`, `hrms.employee.read`, `attendance.checkin.self` |
| `/hrms/muster-roll` | L485 | `attendance.team.read`, `hrms.employee.read` |
| `/hrms/attendance/manual-entry` | L498 | `attendance.regularization.approve`, `attendance.team.read` |
| `/me/wfh` | L275 | `wfh.request.self`, `hrms.ess.read`, `attendance.checkin.self` |
| `/me/shift-change` | L261 | `hrms.ess.read`, `attendance.checkin.self` |

`/hrms/attendance/geofencing` redirects to `/hrms/companies` (L385).

**Tabs in the registry** (`pageRegistry.ts` L146–159; a tab also needs its parent's access):
- `att-daily:team`: `attendance.team.read`
- `face`: `allOf attendance.team.read, attendance.face.admin.read`
- `corrections`: parent only
- `review`: `allOf attendance.team.read, attendance.status.review`
- `my`: `attendance.checkin.self` plus `when: notAdminRole`
- `att-shifts:schedules|roster|overtime|requests`: `attendance.team.read`
- `myshift`: `attendance.checkin.self`, `noneOf attendance.team.read`

**Page gates** (`AttendanceContainer.tsx` L107–118):

| Name in code | Permission or rule |
|---|---|
| `canTeam` (= `isHr`) | `attendance.team.read` |
| `canApprove` | `attendance.regularization.approve` |
| `canFace` | `attendance.face.admin.read` |
| `canOt` | `attendance.overtime.approve` |
| `canShiftAdmin` | `attendance.workforce.admin` |
| `canReport` | `hrms.report.attendance` |
| `canSelf` | `attendance.checkin.self` |
| `canReview` | `attendance.status.review` |
| `canOverride` | `attendance.status.override` |
| `hideMine` | `useRoles().isAdmin`, i.e. OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN |

`canManual` and `canRequestFix` are both `canApprove` (L545–546). Read about the mismatch in C19.

**Backend `@PreAuthorize`:**

| Area | Endpoint(s) | Permission |
|---|---|---|
| Dashboard | `GET /v1/attendance/dashboard`, `/dashboard/trend`, `/dashboard/sources`, `/logs` | `attendance.team.read` |
| Manual entry | `POST /v1/attendance/manual-entry` | `attendance.workforce.admin` (refuses your own record) |
| Regularization | `POST /corrections`, `GET /corrections/my` | `attendance.checkin.self` |
| Regularization | `GET /corrections/approvals`, `POST /corrections/{id}/decision` | `attendance.regularization.approve` |
| Regularization | `POST /corrections/attachments` | `checkin.self` |
| Regularization | `GET /corrections/{id}/attachment` | `checkin.self` or `regularization.approve` |
| Review | `GET /review/exceptions` | `attendance.status.review` |
| Review | `POST /review/status`, `POST /review/face-events/{id}/decision` | `attendance.status.override` |
| Review | `GET /review/face-events` | `attendance.face.admin.read` or `attendance.status.review` |
| Overtime | `GET /v1/attendance/overtime` | `attendance.team.read` |
| Overtime | `POST /{id}/approve`, `POST /{id}/reject` | `attendance.overtime.approve` (reject needs a note) |
| Shifts | `GET /v1/shifts`, `GET /v1/shifts/employee/{id}` | `attendance.checkin.self` |
| Shifts | `POST`/`PUT`/`DELETE /v1/shifts`, `POST /v1/shifts/employee/{id}` | `attendance.workforce.admin` |
| Shifts | `GET /change-requests/pending`, `GET /change-requests/decided`, `POST /change-requests/{id}/decision` | `attendance.regularization.approve` |
| Shifts | `POST /change-requests`, `GET /change-requests/my` | `checkin.self` |
| Roster | `GET /v1/team/schedule` | `attendance.team.read` |
| Assisted punch | `GET /v1/attendance/assisted-punch/punched-by` | `attendance.team.read` |
| Timing policy | `GET /v1/attendance/policy` | read |
| Timing policy | `PUT /v1/attendance/policy` | `attendance.policy.manage` |
| WFH | `POST /v1/wfh`, `/my`, `/{id}/cancel` | `wfh.request.self` |
| WFH | `/pending-approvals`, `/{id}/approve`, `/{id}/reject` | `wfh.approve` |
| Reports | `GET /v1/reports/attendance-summary`, `/late-marks` and their `.csv`/`.pdf` exports | `@perm.check('hrms.report.attendance')` |

**Grants that matter** (from migrations; since V143.18 OWNER and COMPANY_ADMIN hold every permission):

| Permission | Roles | Migration |
|---|---|---|
| `attendance.workforce.admin` | OWNER, SUPER_ADMIN, HR_MANAGER, ADMIN, COMPANY_ADMIN | V143_5 |
| `attendance.status.review` / `.override` | OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, DEPT_MANAGER | V143_10 |
| `attendance.policy.manage` | OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER | V143_10 |
| `attendance.overtime.approve` | OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, HR_MANAGER, MANAGER, DEPT_MANAGER | V134 |
| `hrms.report.attendance` | removed from DEPT_MANAGER / MANAGER (company-wide report) | V117 |

**Server scope.** `TeamEmployeeScope` means HR and admin see the whole company and a department manager sees their team.

---

## 1. Daily tracking · Today

**(1) Prototype.** `PgAttendance.dc.html`, the whole file (`data-screen-label="Attendance · Today"`).
- Header: crumb "Attendance & time · Daily tracking", title "Today", subtitle "Friday, 25 Sep 2026 · General shift 09:30–18:30 with 15 min grace · all branches", and the actions Export, Regularise and **Mark attendance** (primary).
- Six `UtStat` filter cards.
- A "Check-ins" table card: Live dot, count, filter chip, department and shift pickers, and pagination of 16 rows.
- Right column: "Needs attention" and "By branch".

**(2) Repo.** `/hrms/attendance` opens tab `team`, labelled "Daily Logs". It takes `?date=` for past days (the calendar day click lands here) and `?status=` as a preset tile filter. Files: `AttendanceContainer.tsx`, `design/dc/AttendancePage.tsx`/`.view.tsx`, `design/dc/AttDailyLogs.tsx`/`.view.tsx`, `StatusChangeDrawer.tsx`, `attendanceBuckets.ts`. The last one is shared with `dashboard/AdminDashboardContainer.tsx`. **The page exists.**

**(3) Data points (40).**

| # | Design data point | Today: hook → endpoint | State |
|---|---|---|---|
| 1 | Day in the subtitle | `date` (`?date=` or `istToday()`) | Exists |
| 2 | "General shift 09:30–18:30 with 15 min grace" | `useShiftPolicies` → `GET /v1/shifts?companyId=` | **Partial**: there is no "default shift"; derive the shift most rows are on |
| 3 | "all branches" scope | — | **Partial**: there is no branch filter anywhere |
| 4 | Present | `useTeamDashboard(date)` → `GET /v1/attendance/dashboard?date=` → `dayBuckets` (on-time + late + half day, office) | Exists |
| 5 | Present note "134 on time" | same, `regular` bucket | Exists |
| 6 | Late | same | Exists |
| 7 | Late "↓2 vs yesterday" | — | **Partial**: needs a second call (dashboard for yesterday, or trend over two days) |
| 8 | Work from home | same (`attendanceType=WFH`) | Exists |
| 9 | WFH "19% of scheduled" | same (WFH ÷ roster) | Exists (derived) |
| 10 | On leave | same (`onLeave` = approved leave) | Exists |
| 11 | On leave "9 approved" | — | **Missing**: no count of pending leave covering the day (Q5) |
| 12 | Absent count **today** | `dayBuckets` puts no-punch people under Not marked until the day is over | **Conflict** C6 |
| 13 | Absent "↓3 vs yesterday" | — | **Partial** (as #7) |
| 14 | Not marked | same | Exists |
| 15 | "N shown of M" | client count of `staffStatuses` | Exists |
| 16 | "Live" dot | the dashboard query refetches every 60 s | Exists |
| 17 | Row initials | `fullName` | Exists |
| 18 | Row name | `fullName` | Exists |
| 19 | Row "code · department" | `employeeCode`, `departmentName` | Exists |
| 20 | Row shift name | `shiftName` | Exists |
| 21 | Row shift times | policy lookup by name (`GET /v1/shifts`) | Exists |
| 22 | Row check-in time | `checkInAt` | Exists |
| 23 | Row late chip "+22m" | `lateByMinutes` | Exists |
| 24 | Row source "Face · BLR-HQ", "Mobile · geofence", "Web · home" | today the page shows `locationName` plus "outside the zone" | **Partial**: `StaffStatusResponse` has no `checkInMethod` |
| 25 | Leave rows' source "Casual leave · 25–26 Sep" | only `onLeave: boolean` | **Missing**: leave type and dates are not on the row |
| 26 | Row "Worked today" | `workedMinutes` (set only after check-out) | **Partial**: live duration computed on the client from `checkInAt` |
| 27 | Row worked bar (% of the shift) | — | **Partial**: derive from the shift's length |
| 28 | Row status pill | `effectiveStatus` (+ WFH) | Exists; also Half day, Holiday, Weekly off, Not tracked |
| 29 | "Punched by …" (not in the design, **keep**) | `useAssistedPunches` → `GET /v1/attendance/assisted-punch/punched-by` | Exists |
| 30 | "Showing 1–16 of 241" | client paging | Exists |
| 31 | Department options | from the rows | Exists |
| 32 | Shift options | from the rows / policies | Exists; the filter itself is not built yet but is trivial |
| 33 | "Needs attention" count | `useReviewExceptions` → `GET /v1/attendance/review/exceptions` + `useFaceReviewEvents` → `GET /v1/attendance/review/face-events` (status `REVIEW`) | Exists |
| 34 | Item title (missed punch-out / outside the geofence / absent without leave / N min late) | flags `NO_CHECKOUT`, `OUTSIDE_ZONE`, `ABSENT`, `LATE` + `lateMinutes` | Exists |
| 35 | Item sub "Thu, 23 Sep · Hyderabad" | date yes, branch no | **Partial** |
| 36 | Item sub "07:02 · 180 m from Pune Office" | `checkIn` and `distanceMeters` yes; zone or branch name no | **Partial** |
| 37 | Item sub "2nd time this month" / "3rd late mark this month" | — | **Partial**: derive from `GET /review/exceptions?from=<month start>` (range ≤ 62 days) |
| 38 | By branch: names | — | **Missing**: the rows carry no branch |
| 39 | By branch: % checked in, WFH included | — | **Missing** |
| 40 | By branch: people | — | **Missing** |

**(4) Actions (18).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | **Export** today as CSV | none here. The muster roll uses `GET /v1/reports/attendance-summary/export.csv?companyId&from&to` (`hrms.report.attendance`) | **Partial**: that file is a per-person summary, not the day's in/out register, and it is company-wide (managers have no access since V117) |
| 2 | **Regularise** a person and date | HR "Fix this day" → `/hrms/attendance/manual-entry?employeeId&date` → `POST /v1/attendance/manual-entry` | Exists |
| 3 | **Mark attendance** for several people | — | **Missing** (G4) |
| 4 | Stat card toggles the filter | client | Exists |
| 5 | Clear the filter chip | client | Exists |
| 6 | All departments picker | client | Exists |
| 7 | All shifts picker | client | Exists (trivial) |
| 8 | Row click → profile | today a row opens the person drawer; its "Open full profile" goes to `/hrms/employees/{id}` | Exists, behaviour differs (C7) |
| 9 | ⋮ Regularise | manual entry | Exists |
| 10 | ⋮ Mark leave | — (`POST /v1/leave/apply` is for yourself only) | **Missing** (G14) |
| 11 | ⋮ View punches | `GET /v1/attendance/logs?date&search`, or `/hrms/employees/{id}?tab=attendance` | Exists |
| 12 | Change status (drawer, keep) | `POST /v1/attendance/review/status` | Exists |
| 13 | Previous / Next page | client | Exists |
| 14 | Needs attention → Regularise | manual entry | Exists |
| 15 | Needs attention → Review | `POST /v1/attendance/review/face-events/{id}/decision`, or the Review tab | Exists |
| 16 | Needs attention → **Notify** | — | **Missing** (G3) |
| 17 | Not marked → **Remind all at once** | — | **Missing** (G3) |
| 18 | Pick another day (keep, `?date=`) | `useTeamDashboard(date, …, includeLeavers)` | Exists (the design has no day picker, C15) |

**(5) Permissions.**
- Menu: `attendance.team.read`. Route: per §0.1. Tab `team`: `attendance.team.read`.
- The dashboard: `attendance.team.read`, scoped by `TeamEmployeeScope`.
- Needs attention: `attendance.status.review`; the face list also accepts `attendance.face.admin.read`.
- "Punched by": `attendance.team.read`.
- Manual-entry and "Fix this day" buttons: `attendance.regularization.approve` on the page, but saving needs `attendance.workforce.admin` (C19).
- Change status: `attendance.status.override`.
- Export: `hrms.report.attendance` if the report export is reused.
- Proposed gates for the new actions:

| New action | Proposed permission |
|---|---|
| Mark attendance and Regularise | `attendance.workforce.admin` |
| Notify and Remind | see G3 |
| By branch | `attendance.team.read` |

**(8) Components.**
- Shared: PageHeader (title, sub, actions), PillTabs, 6× StatCard (selectable, delta with mood and arrow, no sparkline), 3× Card/Section, FilterPills (active chip), Dropdown with search (department, shift), Popover/Menu (row ⋮), Avatar, StatusPill, Meter/ProgressBar (worked bar, branch bars), ListRow (Needs attention items), EmptyState ("No one matches", "Nothing left to review today."), Skeleton, Toast.
- SidePanel: the person-day drawer, Change status, and Mark attendance.
- Dialog: confirm "Remind all".
- Day chip: `src/shared/components/calendar` `DateField`.
- Page-specific:
  - CheckInsTable: a 6-column grid with the Live dot, the late chip under the check-in, the worked meter and paging.
  - NeedsAttentionItem: a tone icon tile + title + sub + CTA.
  - BranchBars.

---

## 2. Daily tracking · Review

**(1) Prototype.** `PgTime.dc.html` `P['a-daily'].tabs[1]`, sub "Punches that need a second look before payroll locks."
- One table section "Review list" with a count.
- Segments: Everything · Late & half days · Absent · Early & no check-out · Outside the zone · Face checks.
- Columns: Employee, Date, What happened, Source, Status.
- Row actions: Reject / Approve.

**(2) Repo.** `/hrms/attendance?tab=review` (the tab shows only with `attendance.status.review`) renders `attendance/ReviewList.tsx` through the container's `reviewBlock`, plus `StatusChangeDrawer.tsx`. The face cards come from the same data as the Face Punch tab. The six segments exist today with the same labels. **The page exists.**

**(3) Data points (11).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Count | `GET /review/exceptions` (last 7 days) + face events with status `REVIEW` | Exists |
| 2 | Segment labels and counts | client grouping of the flags | Exists |
| 3 | Employee · department | `employeeName`, `departmentName` | Exists |
| 4 | Date | `date` | Exists |
| 5 | What happened: times, late / early minutes, worked | `checkIn`, `checkOut`, `lateMinutes`, `earlyByMinutes`, `workedMinutes` | Exists |
| 6 | "Punched 1.2 km from Pune Office" | `distanceMeters` yes; the place name no | **Partial** |
| 7 | "Face match 71% · below the 80% bar" | the band (`scoreBucket`) only. `match_score` exists in `attendance.face_verification_events` but is deliberately not exposed (V034 comment; STATIC §4) | **Conflict** C8: keep the band |
| 8 | "Left 15:10 · no half-day request" | no leave or half-day lookup on the item | **Partial** |
| 9 | Source (Mobile app (GPS), Web check-in, Face check-in, Fingerprint device) | not on `ExceptionItem` (`records.check_in_method` exists) | **Missing** (G2) |
| 10 | Status pill (Late, Absent, Early out, Outside zone, Check face, No check-out) | the flags | Exists |
| 11 | Empty state "Nothing to review" | client | Exists |

**(4) Actions (7).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | Segment filter | client | Exists |
| 2 | **Approve** an exception | nothing called "approve". The closest is Excuse = `POST /v1/attendance/review/status {status: EXCUSE, reason}` | **Partial**, meaning unclear (C9, Q3) |
| 3 | **Reject** an exception | the closest is Change status `POST /review/status {PRESENT, LATE, HALF_DAY, ABSENT or CLEAR}` | **Partial** (C9) |
| 4 | Face row Approve ("Yes, it's …") | `POST /v1/attendance/review/face-events/{id}/decision {CONFIRMED}` | Exists |
| 5 | Face row Reject ("Not them", with a reason) | same endpoint `{REJECTED, note}` | Exists |
| 6 | Change status / Excuse with a reason (keep) | `POST /review/status` | Exists |
| 7 | Undo (README ApprovalRow) | `CLEAR` exists for status changes; nothing for face decisions | **Partial / Missing** (G13) |

**(5) Permissions.**
- Registry tab: `allOf attendance.team.read, attendance.status.review`. Page: `canReview`.
- List: `attendance.status.review`.
- Face list: `attendance.face.admin.read` or `attendance.status.review`.
- Decisions: `attendance.status.override`. Managers act on their own team only, and nobody changes their own day.

**(8) Components.** Card/Section with a count, SegmentedControl, table rows, StatusPill, ApprovalRow (inline approve/reject + undo), SidePanel (the reason), EmptyState, Skeleton, Toast.

---

## 3. Daily tracking · Manual entry

**(1) Prototype.** `PgTime.dc.html` `P['a-daily'].tabs[2]`, sub "Add or correct a punch. Every change is stored on the record and shown in the audit log."
- A half-width form "Manual attendance entry": Employee (search by name, code or email), Date, Came in, Went out, Status (Present / Half day / Work from home / On duty / Absent), Reason. Submit: "Save entry".
- A half-width table "Recent manual entries": Employee, Date, Change, By.

**(2) Repo.** `/hrms/attendance/manual-entry` → `attendance/ManualEntry.tsx`, with Who / When / Why panels and `?employeeId=&date=` prefill.
- It is reached from the Daily Logs "Manual entry" header button, the drawer's "Fix this day", and the muster roll row button.
- **After saving it goes back to `/hrms/muster-roll?date=`.**
- **The page exists as a separate route, not a tab.**

**(3) Data points (12).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Employee search | `useEmployeeDirectory` → `GET /v1/hrms/employees?companyId&search` (`hrms.employee.read`); without it, the team roster `useTeamDashboard(date)` | Exists |
| 2 | Chosen person, name · code | same | Exists |
| 3 | Exited / terminated warning (keep) | `employmentStatus` | Exists |
| 4 | Date (max today) | `DateField` | Exists |
| 5 | Came in | time input | Exists |
| 6 | Went out | time input | Exists |
| 7 | Status: Present / Half day / Work from home / On duty / Absent | `ManualAttendanceRequest` already takes `attendanceType` (OFFICE, WFH, FIELD_WORK, …) and `attendanceStatus`; the page doesn't send them. A status with no times is refused (`MANUAL_TIME_REQUIRED`) | **Partial** (G5) |
| 8 | Reason | `reason` (required) | Exists |
| 9 | Recent entries: employee · department | — | **Missing** (G6) |
| 10 | Recent entries: date | — | **Missing** |
| 11 | Recent entries: change (times · reason) | — | **Missing** |
| 12 | Recent entries: by whom | — (`records.managed_by_employee_id` exists) | **Missing** |

**Audit log.** The copy says entries are "shown in the audit log". Today a manual entry is written to `attendance.event_logs` (`MANUAL_ENTRY`) and to the record's own fields, but **not** to `audit.events`, so the Audit logs page doesn't show it (G6).

**(4) Actions (3).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | Save entry | `useManualEntry` → `POST /v1/attendance/manual-entry` (refuses your own attendance) | Exists |
| 2 | Cancel / back | navigate | Exists |
| 3 | Status "Absent" with no times | the existing route would be `POST /v1/attendance/review/status {ABSENT}` (`attendance.status.override`) | **Partial** (G5) |

**(5) Permissions.**
- Search registry: `attendance.workforce.admin`.
- Route: `anyOf attendance.regularization.approve, attendance.team.read`.
- Save gate on the page: `attendance.workforce.admin`.
- Picker: `hrms.employee.read`, else `attendance.team.read`.
- Backend: `attendance.workforce.admin`.

**(8) Components.** FormField (Dropdown with search for the employee; `DateField` from the shared calendar, since time inputs stay native; select; textarea), two half-width Card/Section, a table, EmptyState "No manual entries yet", Toast.

---

## 4. Attendance analytics · Overview

**(1) Prototype.** `PgTime.dc.html` `P['a-analytics'].tabs[0]`, sub "How September is going across the company."
- Stats "September so far":
  - Attendance rate ("Up 1.1% on August")
  - Avg arrival ("9 min before shift")
  - Late marks ("Across 18 working days")
  - Unplanned absence ("Target under 3%")
- Bars "Attendance by department" (half width).
- Bars "Attendance by branch" (half width).

**(2) Repo.** `/hrms/att-analytics?tab=overview&month=yyyy-MM` → `design/dc/AttOverview.tsx`/`.view.tsx`, with its data from the container. **The page exists but shows different blocks:**
- today's tiles, or "Month in total" for a past month
- "Who's where today" donut
- "How people checked in"
- "Attendance trend" day bars
- "Late most often"
- "Everyone's month" table with search
- the month picker (`MonthField`) and "Download report"

**(3) Data points (12).**

| # | Design data point | Today: hook → endpoint | State |
|---|---|---|---|
| 1 | The month in the sub | `?month=` (`anMonth`) | Exists |
| 2 | Attendance rate | `useAttendanceTrend` → `GET /v1/attendance/dashboard/trend?from&to` (+ today's live dashboard) | Exists (derived) |
| 3 | "Up 1.1% on August" | — | **Partial**: a second trend call for the previous month |
| 4 | Avg arrival | — (only the per-employee `weekly-summary.avgArrivalTime`) | **Missing** (G8) |
| 5 | "9 min before shift" | — | **Missing** (G8) |
| 6 | Late marks | the trend's late sum, or `useLateMarksReport` → `GET /v1/reports/late-marks` | Exists |
| 7 | "Across 18 working days" | `workingDays` (trend `weeklyOffDay` + holidays via `GET /v1/settings/holidays`) | Exists |
| 8 | Unplanned absence % | trend: absent ÷ expected | **Partial** (derive; "unplanned" = absent with no leave) |
| 9 | "Target under 3%" | nothing stored | **Missing** (G15, Q6) |
| 10 | Attendance by department (name, %) | the trend takes `departmentId`, so one call per department | **Partial** (G8 gives one call) |
| 11 | Attendance by branch (name, %) | the trend has no branch filter | **Missing** (G8) |
| 12 | Today's blocks (tiles, who's-where, methods, trend, late most often, everyone's month) | as today | Exists; not in the design (C12) |

**(4) Actions (3).**

| # | Design action | Today | State |
|---|---|---|---|
| 1 | Month picker (keep) | `?month=` | Exists |
| 2 | Download report (keep) | → `/hrms/reports/attendance-summary?company&from&to` | Exists |
| 3 | Drill into a day or the calendar (keep) | navigation | Exists |

None are missing.

**(5) Permissions.**
- Menu and registry: `attendance.team.read`. Route: `anyOf hrms.report.attendance, attendance.team.read`.
- Trend, sources and dashboard: `attendance.team.read`.
- The summary and late-marks reports: `hrms.report.attendance`, which managers don't hold (V117). The same goes for anything new built on those reports.

**(8) Components.** 4× StatCard (tone ok / warn / bad), Card/Section, Meter/ProgressBar bars with a tone per row, `MonthField`, EmptyState "No attendance yet", Skeleton.

---

## 5. Attendance analytics · Punctuality

**(1) Prototype.** `PgTime.dc.html` `a-analytics.tabs[1]`, sub "Who is often late, and when." Table "Most late marks this month" with the columns Employee, Late marks, Avg delay, Worst day, Trend (Rising / Steady / Falling).

**(2) Repo.** No such tab. The Overview's "Late most often" card (top 5 by count) uses the same data. It needs a new tab key, for example `?tab=punctuality`.

**(3) Data points (5).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Employee · department | `useLateMarksReport` → `GET /v1/reports/late-marks?companyId&from&to` (one row per late day: date, minutes, check-in) | Exists |
| 2 | Late marks | count per person | Exists (derived) |
| 3 | Avg delay | average of `late_by_minutes` | Exists (derived) |
| 4 | Worst day | the weekday with the most rows | Exists (derived) |
| 5 | Trend | the previous month's call + a rule | **Partial** |

**Scope:** the report is company-wide and needs `hrms.report.attendance`, so department managers would see an empty tab. A team-scoped endpoint is needed for them (G9).

**(4) Actions (1).** A row opens the profile (`/hrms/employees/{id}`). Exists.

**(5) Permissions.** The tab inherits `att-analytics` (`attendance.team.read`). The data needs `hrms.report.attendance` today.

**(8) Components.** Table, StatusPill (Trend), Avatar, EmptyState "No late marks".

---

## 6. Attendance analytics · Overtime

**(1) Prototype.** `PgTime.dc.html` `a-analytics.tabs[2]`, sub "Hours worked beyond the shift. Approved overtime is recorded, not paid, until payroll picks it up."
- Stats "Overtime this month": Hours logged (N people), Approved ("Ready for payroll"), Waiting ("Needs a manager").
- Table "Overtime requests": Employee, Date, Extra time, Reason, Status, with Reject / Approve.

**(2) Repo.** `/hrms/shifts?tab=overtime` → `design/dc/ShiftOvertime.tsx`:
- views "Waiting for you" / "This month"
- tiles "Extra time this month", "Waiting for you", "Approved · Recorded, not paid"
- a decided list

The data comes from `loadOvertime`, which calls `GET /v1/attendance/overtime?from&to&page` (20 rows a page, up to 50 pages, from the start of last month). **It exists, on the Shifts page.**

**(3) Data points (10).** All of these exist:
1. Hours logged (the sum of minutes this month, rejected rows left out)
2. People
3. Approved hours
4. Waiting hours
5. Row employee · department
6. Row date
7. Row extra time
8. Row reason and where it came from (V143_25 `reasonSource`)
9. Row status
10. Shift end, left at and "raised" (keep)

**(4) Actions (4).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | Approve | `POST /v1/attendance/overtime/{id}/approve` | Exists |
| 2 | Reject (a note is required, `OVERTIME_REASON_REQUIRED`) | `POST /v1/attendance/overtime/{id}/reject` | Exists |
| 3 | Undo | — | **Missing** (G13: delete the `attendance.overtime_decisions` row) |
| 4 | Waiting / This month switch (keep) | client | Exists |

**(5) Permissions.**
- Registry tab (under Shifts): `attendance.team.read`.
- The list: `attendance.team.read`, scoped.
- Decisions: `attendance.overtime.approve` (page `canDecideOt`).
- If the tab moves to Analytics, `/hrms/shifts?tab=overtime` must keep working (C1).

**(8) Components.** 3× StatCard, table, ApprovalRow (with Undo), SidePanel for the reject note, EmptyState "No overtime requests".

---

## 7. Shifts & overtime · Shifts

**(1) Prototype.** `PgTime.dc.html` `a-shifts.tabs[0]`, sub "Shift timings, grace periods and who works them."
- Primary header action "Add shift".
- Table "Shifts": Shift (name · sub), Timing, Grace, Weekly offs, People; row action Edit.
- Empty state "No shifts yet / Add a shift so lateness and overtime can be measured."

**(2) Repo.** `/hrms/shifts?tab=schedules` → `design/dc/ShiftSchedules.tsx`: cards, an add / edit drawer, and delete with confirmation, blocked while people are on the shift.
- Data: `useShiftPolicies` → `GET /v1/shifts?companyId=<companies[0]>`. People come from `GET /v1/team/schedule?from=today&to=today`.
- The same policies are also edited in Master → Rules & Policies → Shift Rules (`/hrms/master/shift-rules`, `design/master/MasterDesign.tsx` `ShiftsPage`).
- **The page exists.**

**(3) Data points (7).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Name | `name` | Exists |
| 2 | Sub-label ("Default", "Support and Ops") | no such field (`code` and `shiftType` exist) | **Partial**: show the code or type, or the departments on the shift. **Don't** add a column to `attendance.shift_policies`, which is JPA-mapped |
| 3 | Timing | `startTime`–`endTime` | Exists |
| 4 | Grace | `gracePeriodMinutes` | Exists |
| 5 | Weekly offs | `weeklyOffDays` (V143_23; applies to people with none of their own) | Exists; not shown today |
| 6 | People | today's schedule grouped by `shiftPolicyId` | Exists |
| 7 | Empty state | client | Exists |

**(4) Actions (4).** All exist:
- Add shift: `POST /v1/shifts?companyId`
- Edit: `PUT /v1/shifts/{id}`
- Delete (keep; `409 SHIFT_IN_USE`): `DELETE /v1/shifts/{id}`
- See people (keep): a filtered Roster

**(5) Permissions.**
- Menu: `attendance.team.read`. Tab: `attendance.team.read`.
- Read: `attendance.checkin.self`. Writes: `attendance.workforce.admin` (page `canEditShifts`, and the header "Add shift").

**(8) Components.** Table, StatusPill, row action, SidePanel form (name, start / end time, grace, break, look), Dialog (confirm delete), EmptyState.

---

## 8. Shifts & overtime · Rosters

**(1) Prototype.** `PgTime.dc.html` `a-shifts.tabs[1]`, sub "Who works which shift this week." Table "Roster · 28 Sep – 4 Oct" with the columns Employee, Mon, Tue, Wed, Thu, Fri. Cells are shift pills (General / Night / Early) or "Leave".

**(2) Repo.** `/hrms/shifts?tab=roster` → `design/dc/ShiftRoster.tsx`:
- one row per person with today's shift and "Since"
- filter chips per shift and "No shift yet", plus search
- a "Change shift" / "Assign" drawer (start date + note)

Its data is `GET /v1/team/schedule?from=today&to=today`. **It exists as a list for today, not a week grid.**

**(3) Data points (6).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Week label | client | Exists (derive) |
| 2 | Employee · department | schedule `employeeName` + roster department | Exists |
| 3 | Shift on each day | `GET /v1/team/schedule?from=Mon&to=Sun`: one row per person per day, up to 31 days, including future changes | Exists |
| 4 | Leave on a day | — | **Missing** (G10) |
| 5 | Weekly off or holiday on a day | not in the schedule (holidays are available from `GET /v1/settings/holidays`) | **Missing / Partial** (G10) |
| 6 | Since (keep) | `since`, `joinedOn` | Exists |

**(4) Actions (3).** All exist:
- Change / assign a shift (keep): `POST /v1/shifts/employee/{id} {shiftPolicyId, effectiveFrom, note}`
- Previous / next week: the query range
- Shift filter chips (keep)

**(5) Permissions.** Tab and schedule: `attendance.team.read` (scoped). Assign: `attendance.workforce.admin`.

**(8) Components.** A week grid table with StatusPill cells, FilterPills, SidePanel (change shift), EmptyState "Nothing rostered".

---

## 9. Shifts & overtime · Overtime rules

**(1) Prototype.** `PgTime.dc.html` `a-shifts.tabs[2]`, sub "When extra time counts as overtime and how it is paid." A key-value card "Overtime rules" with an "Edit rules" button:

| Rule | Sample value |
|---|---|
| Counts after | 30 min past shift end |
| Weekday rate | 1.5× hourly |
| Weekly off and holidays | 2× hourly |
| Needs approval from | Reporting manager |
| Monthly cap | 40 hours |
| Paid through | Next pay run |

**(2) Repo.** Nothing. What exists today:
- **What counts.** Overtime = worked time beyond the shift's length (`AttendanceService.calculateOvertimeMinutes` / `overtimeThresholdHours`, backfilled by V143_32). Without a shift, anything past 8 hours.
- **Rate.** Each shift stores `overtimeApplicable` + `overtimeMultiplier`. They are edited in Master → Shift Rules and described there as "Payroll doesn't pay it automatically yet."
- **Approval.** Anyone with `attendance.overtime.approve` within their scope.
- **Cap and pay-out.** No cap. No pay-out: the business rule is "recorded, not paid".

**(3) Data points (6).** All six are missing or partial:
1. Counts after: **missing**.
2. Weekday rate: **partial** (per shift only).
3. Weekly off & holiday rate: **missing**.
4. Needs approval from: **partial** (by permission, not configurable).
5. Monthly cap: **missing**.
6. Paid through: **missing**, and it conflicts with today's rule (C10).

**(4) Actions (1).** Edit rules: **missing** (G11).

**(5) Permissions.** None yet. Suggested: `attendance.policy.manage` (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER) or a new code granted to OWNER + SUPER_ADMIN in its migration.

**(8) Components.** A key-value Card, SidePanel form, FormField (number, select, toggle).

---

## 10. Shifts & overtime · Change requests

**(1) Prototype.** `PgTime.dc.html` `a-shifts.tabs[3]`, sub "Requests from employees who want to move shifts." Table "Shift change requests" with the columns Employee, From, To, Starting from, Status, and Reject / Approve.

**(2) Repo.** `/hrms/shifts?tab=requests` → `design/dc/ShiftRequests.tsx` (`mode="hr"`): pending cards with a note field, plus "Already decided" for 30 days.
- `usePendingShiftRequests` → `GET /v1/shifts/change-requests/pending`
- `useDecidedShiftRequests` → `GET /v1/shifts/change-requests/decided?days=30`

**The page exists.**

**(3) Data points (6).** All exist: employee · department, From (`currentShiftName`), To (`requestedShiftName`), Starting from (`requestedEffectiveDate` / `appliedEffectiveDate`), Status, and the reason, who decided it and their note (keep).

**(4) Actions (3).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | Approve | `POST /v1/shifts/change-requests/{id}/decision {approved: true, comment}` | Exists |
| 2 | Reject | same endpoint, `{approved: false}` | Exists |
| 3 | Undo | — | **Missing** (G13) |

**(5) Permissions.** Tab: `attendance.team.read`. List and decision: `attendance.regularization.approve` (a manager gets their own team).

**(8) Components.** Table, StatusPill, ApprovalRow (+ undo), EmptyState "No shift-change requests yet".

---

## 11. Compliance · Muster roll

**(1) Prototype.** `PgTime.dc.html` `P['cp-muster']`. Crumb "Compliance", title "Muster roll", header actions "Previous day" (secondary) and **"Download muster"** (primary). Sub "Fri, 25 Sep 2026 · all departments · statutory register of who worked."
- Stats "How the day splits": Present, Late, Half day, On leave, Work from home, Not marked yet, Absent, Weekly off ("Friday is a working day").
- Table "On the roster" (with a count): Employee (name · code), Shift, In, Out, Hours, Status.
- Empty state "No one on the roster".

**(2) Repo.** `/hrms/muster-roll` → `attendance/MusterRoll.tsx`, a ModulePage with crumb "Attendance":
- a day bar (← date → Today) and a department select
- four tiles and the "How the day splits" donut
- a table: Employee, Department, Status, In, Out, Location, Punches, row "Manual entry"
- Refresh and Export CSV

The rail already lists it under Compliance (`PlatformShell.tsx` L199). The registry area is still "Attendance & Time", with the alias `compliance/muster-roll`. **The page exists.**

**(3) Data points (17).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Date + department in the sub | page state | Exists |
| 2–8 | Present, Late, Half day, On leave, Work from home, Not marked yet (today) / Absent (past days) | `useTeamDashboard(date, dept)` → `counts` | Exist |
| 9 | Weekly off count | not on the dashboard (the roster drops people on their weekly off) | **Partial**: `useAttendanceTrend(date, date)` → `weeklyOff` |
| 10 | "Friday is a working day" | trend `weeklyOffDay` | **Partial** |
| 11 | On the roster (count) | `staffStatuses.length` | Exists |
| 12 | Row name · code | `fullName`, `employeeCode` | Exists |
| 13 | Row shift | `shiftName` (not shown today) | Exists |
| 14 | Row in | `checkInAt` | Exists |
| 15 | Row out | `checkOutAt` | Exists |
| 16 | Row hours | `workedMinutes`, or in→out | Exists (derive for open days) |
| 17 | Row status | `effectiveStatus` (`rowStatus`) | Exists |

**(4) Actions (6).**

| # | Design action | Today: API | State |
|---|---|---|---|
| 1 | Previous day | client | Exists |
| 2 | **Download muster** | `GET /v1/reports/attendance-summary/export.csv?companyId&from=<date>&to=<date>`, saved as `muster-roll-YYYY-MM-DD.csv` and recorded in "Recent downloads" | **Partial**: summary columns, not the day register; company-wide; ignores the department (G7) |
| 3 | Date picker / Next / Today (keep) | client | Exists |
| 4 | Department filter (keep) | `GET /v1/hrms/departments` + roster | Exists |
| 5 | Row "Manual entry" (keep) | → `/hrms/attendance/manual-entry?employeeId&date` | Exists |
| 6 | Refresh (keep) | refetch | Exists |

**(5) Permissions.**
- Menu, registry and route: `anyOf attendance.team.read, hrms.employee.read`. The data calls need `attendance.team.read`, so a user with only `hrms.employee.read` can open the page but its calls 403.
- Export: `hrms.report.attendance` (`canExport`).
- Row manual entry: `attendance.workforce.admin` (`canManual`).

**(8) Components.** PageHeader (secondary + primary action), a stats block (8 small StatCards), Card/Section table, StatusPill, Avatar, day chip (`DateField`), Dropdown (department), EmptyState, Toast.

---

## 12. My workspace · Work from home (`me-wfh`)

**(1) Prototype.** `PgTime.dc.html` `P['me-wfh']`. The prototype nav can't reach it, so `EmpTime.dc.html` `e-wfh` is the live design (self-service audit).
- Form "New request": From, To, Reason. "Send request" gives the toast "…sent to <approver name>".
- Key-value "How it works":

| Key | Sample value |
|---|---|
| Punch | From anywhere, no geofence |
| Counts as | Present |
| Allowance | 8 days a month |
| Used this month | 3 days |

- Table "My requests": Dates, Days, Reason, Status.

**(2) Repo.** `/me/wfh` → `wfh/ApplyWfh.tsx`: the form, a rules panel, and your requests with Cancel. **The page exists.**

**(3) Data points (10).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | From / To / Reason | form | Exists |
| 2 | Approver's name after sending | `POST /v1/wfh` returns `approverId` only | **Missing** (G12, S) |
| 3 | Punch rule | behaviour (the geofence is lifted on approved days) | Exists (copy) |
| 4 | Counts as Present | behaviour | Exists (copy) |
| 5 | Allowance per month | none (HR configuration only has "Allow work from home" on/off) | **Missing** (G12, Q7) |
| 6 | Used this month | `GET /v1/wfh/my` | Exists (derived) |
| 7–10 | Request dates, days, reason, status | `GET /v1/wfh/my` | Exist |

**(4) Actions (2).** Both exist:
- Send request: `POST /v1/wfh` (fails with `WFH_NOT_ALLOWED` when the company turned it off)
- Cancel (keep): `POST /v1/wfh/{id}/cancel`

**(5) Permissions.** Route `anyOf wfh.request.self, hrms.ess.read, attendance.checkin.self`. Registry `wfh.request.self` + self. The ESS menu is hidden for admin roles. Backend: `wfh.request.self`. Approvals (`wfh.approve`) are in Leave → Approvals.

---

## 13. My workspace · Shift change (`me-shift`)

**(1) Prototype.** `PgTime.dc.html` `P['me-shift']`. The same reachability note applies (`EmpTime` `e-shift` is the live design).
- Key-value "Your shift": Shift, Timing, Grace, Weekly offs.
- Form "New request": New shift (a select with the timing), Starting from, Reason.
- Table "My requests": Change, Starting from, Reason, Status.

**(2) Repo.** `/me/shift-change` → `shifts/ShiftChangeRequest.tsx`. **The page exists.**

**(3) Data points (10).**

| # | Design data point | Today | State |
|---|---|---|---|
| 1 | Shift | `GET /v1/shifts/employee/{id}` → `shiftName` | Exists |
| 2 | Timing | `startTime` / `endTime` | Exists |
| 3 | Grace | `gracePeriodMinutes` | Exists |
| 4 | Weekly offs | not in `EmployeeShiftResponse`; `GET /v1/employees/me` has `weeklyOffDays` and the policy has `weeklyOffDays` | **Partial**: derive (their own, else the shift's, else Sat/Sun) |
| 5 | Scheduled change (keep) | `upcomingShiftName`, `upcomingEffectiveFrom` | Exists |
| 6 | Shift options with timing | `GET /v1/shifts?companyId` | Exists |
| 7–10 | My requests: change, starting from, reason, status | `GET /v1/shifts/change-requests/my` | Exist |

**(4) Actions (1).** Send request: `POST /v1/shifts/change-requests`. Exists.

**(5) Permissions.** Route and registry: `anyOf hrms.ess.read, attendance.checkin.self` (+ self). Backend: `attendance.checkin.self`.

---

## 14. Today's tabs that have no place in the design (all must keep working)

| Tab (route) | What it shows (data) | Actions (API) | Why it must stay |
|---|---|---|---|
| **Face Punch** `/hrms/attendance?tab=face` (`AttFacePunch.tsx`) | Today's face punches plus older ones still to check: name, code, "Punched by", kiosk/device, time, match band, status, "needs a look" count, summary line (`useFaceReviewEvents`) | "Yes, it's …" / "Not them": `POST /review/face-events/{id}/decision` | `live-w3-punch.mjs` checks "Punched by" here. It is the only full face log. The design folds only the unsure ones into Review → Face checks |
| **Regularization** `?tab=corrections` (`AttRegularization.tsx`) | Waiting count; each request's name, code · dept, day, in, out, reason, proof, raised; decided list with note; "My requests" (`GET /corrections/approvals?status=`, `/corrections/my`) | Approve / reject with a note (`POST /corrections/{id}/decision`), open proof (`GET /corrections/{id}/attachment`), New request + proof upload (`POST /corrections`, `POST /corrections/attachments`) | Deep links: notifications `CORRECTION_*` → `?tab=corrections` (`notificationStore.ts` L220); dashboard alerts `path /hrms/attendance?tab=corrections` (`DashboardSummaryController` L100/L121) |
| **My Attendance** `?tab=my` (`AttMine.tsx`) | 6 month tiles + day grid + legend (`/monthly-stats`, `/history`) | — | `ATTENDANCE_STATUS_CHANGED` → `?tab=my`; registry `me-attendance`; hidden for OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN (client decision) |
| **Calendar** `/hrms/att-analytics?tab=calendar` (`AttCalendar.tsx`) | Day cells (rate or kind), best / lowest line, side panel (rate, breakdown), legend (trend + holidays) | Open a day's logs (`?tab=team&date=`) | `live-w3-analytics.mjs` (a tile opens the calendar and keeps the month); calendar day click |
| **My Shift** `/hrms/shifts?tab=myshift` (`ShiftRequests.tsx` mine) | Your shift, hours, late after, break, since; your requests | Ask for a change: `POST /v1/shifts/change-requests` | Registry `att-shifts:myshift`; `live-design-attendance.mjs` "employee Shifts shows My Shift" |

About 41 data points and 9 actions, none missing.

---

## 15. Gaps: the backend work each missing piece needs (item 6)

Rules this list follows (DECISIONS.md):
- no JPA-mapped column changes
- new tables and columns go through JdbcTemplate only
- every new block degrades to hidden / empty / error until its migration is applied
- a new permission is granted to OWNER and SUPER_ADMIN in its migration

| ID | What | Backend work | Schema change | JPA-mapped table touched | Size |
|---|---|---|---|---|---|
| G1 | Daily roster rows: branch, check-in method, leave type and dates, pending-leave flag (Today #24, #25, #11, By branch #38–40) | Additive fields on `StaffStatusResponse` in `AttendanceController.toStaffStatus` (the mobile app reads this DTO, so additions only); one branch-name lookup; one leave lookup (type, from–to, pending) for the day | No | Reads `attendance.records` (`branch_id`, `check_in_method`) and `hrms.employees` (`branch_id`) — read only | S |
| G2 | Review / Needs-attention context: branch or zone name and check-in method on each item; optional "Nth time this month" | Additive fields on `AttendanceReviewService.ExceptionItem` (zone from `records.check_in_zone_name`, branch, `checkInMethod`). The monthly count can come from the client using a month range (≤ 62 days) | No | Read only | S |
| G3 | "Notify" one person and "Remind all at once" (not marked) | New `POST /v1/attendance/reminders {date, kind, employeeIds[]}`, scoped by `TeamEmployeeScope`. Uses `AppNotificationService` with a new `AppNotificationType` (`notif.notifications.type` is `varchar(60)` with no CHECK, so no migration), a catalog / template entry and a `notificationStore` route. Once per person per day per kind (checked against `notif.notifications`, or a new JDBC table). Permission: reuse `attendance.status.review`, or a new code granted to OWNER / SUPER_ADMIN (+ HR / managers) | Only if a guard table or new permission rows are added (permission rows are data) | No | M |
| G4 | "Mark attendance" for several people | `POST /v1/attendance/manual-entry/bulk` (`attendance.workforce.admin`): one transaction, refuses your own record, a per-person result, event log + audit | No | Writes `attendance.records` through the existing service (no mapping change) | M |
| G5 | Manual entry Status (Present / Half day / WFH / On duty / Absent) | Frontend sends `attendanceType` / `attendanceStatus` (the API already takes them). Absent with no times: call `POST /review/status {ABSENT}` (`attendance.status.override`), or let `AttendanceService.manualEntry` accept a status with no times | No | No | S |
| G6 | "Recent manual entries" + "shown in the audit log" | `GET /v1/attendance/manual-entries?from&to&limit` (JDBC read of `records` where `manual_entry`, joined to `managed_by_employee_id` for the name, `manual_entry_reason` / `regularization_reason`), scoped. Add `AuditService.record("attendance","MANUAL_ENTRY",…)` to the manual entry | No | Read only | S |
| G7 | Day-register CSV (Today "Export", Muster "Download muster") | `GET /v1/attendance/register/export.csv?date&departmentId` (the dashboard's rows: name, code, dept, branch, shift, in, out, hours, status, source); record it in the export log (V143_27); keep the file name `muster-roll-YYYY-MM-DD.csv`. Permission: `hrms.report.attendance` (company-wide), or team-scoped with `attendance.team.read` | No | No | M |
| G8 | Analytics numbers: average arrival and minutes vs shift start, by department, by branch, vs last month | `GET /v1/attendance/dashboard/breakdown?from&to&by=department\|branch` + average arrival from `records.check_in_at` against the shift in force (the same lateral join as `OvertimeController.SHIFT_JOIN`), `attendance.team.read`, scoped | No | Read only | M |
| G9 | Punctuality for managers (team scope) | `GET /v1/attendance/punctuality?from&to`: late count, average delay, worst weekday and the previous period's count, from effective LATE days (`EffectiveDayStatusService`), `attendance.team.read`, scoped. Admins can use the late-marks report meanwhile | No | Read only | M |
| G10 | Roster week grid: leave, weekly off and holiday per day | Extend `GET /v1/team/schedule` rows with `onLeave` (approved leave covering the day), `weeklyOff` (their own, else the shift's), `holiday`. JDBC only | No | Read only | S |
| G11 | Company overtime rules (counts after, weekday / off-day / holiday rate, approver, monthly cap, paid through) | New table `attendance.overtime_rules` (tenant, company, counts_after_minutes, multipliers, approver, monthly_cap_minutes, pay_via, updated_by / at; RLS), JDBC only. `GET/PUT /v1/attendance/overtime-rules?companyId`. Permission (reuse `attendance.policy.manage` or a new code for OWNER + SUPER_ADMIN). Apply "counts after" and the cap when `records.overtime_minutes` is computed (logic only; the column is already mapped); fall back to today's rule when the table is missing. Paying overtime through payroll is a separate, large piece | **Yes: new table** | No column changes (logic in `AttendanceService` only) | M (rules) / L (payroll pay-out) |
| G12 | WFH: approver's name; monthly allowance | Name: add `approverName` in `WfhController.enrichOne` (S). Allowance: a new JDBC table (days a month per company), `GET/PUT` inside HR Configuration → Attendance rules (settings stay in their section), enforced in `WfhService.apply` (pending + approved days in the month) | **Yes: new table** (allowance only) | No | M |
| G13 | Undo on approve / reject (README ApprovalRow) | Overtime: delete the `attendance.overtime_decisions` row within a window (S). Status change: `CLEAR` exists (S). Face decision: revert `face_event_reviews` + the day (M). Shift change: remove the new assignment and reopen the request (M; `employee_shift_assignments` is JPA-mapped but no column change). Regularization approval: needs the times from before the change, which are not stored (L; snapshot table) | Only for a regularization snapshot | No column changes | M–L |
| G14 | Row ⋮ "Mark leave" (apply leave for someone) | HR "apply for someone" leave endpoint. It doesn't exist (`POST /v1/leave/apply` is self only); shared with the Leave page's "Apply for someone" | No | No | M |
| G15 | "Target under 3%" (unplanned absence) | A new company setting (JDBC table) or drop the note | Yes if built | No | S |
| G16 | Review "Approve / Reject" as their own actions | Map them to EXCUSE / keep the status (no backend), or add an ACKNOWLEDGE action. That needs the `ck_day_status_reviews_action` CHECK on `attendance.day_status_reviews` (a JDBC table) changed | Only for ACKNOWLEDGE | No | S |
| G17 | Frontend-only derivations: deltas vs yesterday; rate vs last month; the Today sub's main shift; worked-today live time and bar; muster weekly-off count; WFH used this month; shift-change weekly offs; punctuality for admins | None: extra calls to existing endpoints (`/dashboard`, `/dashboard/trend`, `/v1/wfh/my`, `/v1/employees/me`, `/v1/reports/late-marks`) | No | No | S |

---

## 16. Conflicts with existing behaviour and earlier decisions (item 7)

- **C1 · Tab set.** The design's tabs replace today's. Three things say they must not disappear:
  - The prompt: "Keep the tab names and order unchanged".
  - DECISIONS: every page keeps its current URL.
  - Deep links:
    - Notifications go to `?tab=corrections` and `?tab=my`.
    - Dashboard alerts go to `?tab=corrections`.
    - Calendar clicks go to `?tab=team&date=`.
    - The registry and search list every `?tab=` key.

  Suggestion: keep every current `?tab=` key and show the design's names on them:
  - team = Today
  - review = Review
  - schedules = Shifts
  - roster = Rosters
  - requests = Change requests

  Then:
  - Manual entry becomes a pill that opens `/hrms/attendance/manual-entry`.
  - New keys: `punctuality`, `overtime` under Analytics (while `/hrms/shifts?tab=overtime` keeps working), and `otrules`.
  - Face Punch, Regularization, My Attendance, Calendar and My Shift stay as extra pills, shown only to whoever sees them today.
- **C2 · Own section bar.** Today these pages draw their own section bar ("Attendance sections") and the shell hides its tab row (`OWN_SECTION_BAR`, `PlatformShell.tsx` L342–346). The design moves pages and tabs into the shell's top bar (Pages button + pill tabs). Count badges on tabs (face checks, fixes, reviews, roster gaps, overtime, requests) are not in the design; suggest keeping them as small counts.
- **C3 · First page.** The design lists Daily tracking first. Today the rail target and `/attendance` search for HR is Analytics. Unit tests assert this: `pageRegistry.test.ts` `firstOpenIn('attendance')` → `/hrms/att-analytics`, and `search.test.ts` `top('/attendance')`.
- **C4 · Muster roll under Compliance.** This already matches the rail. Only the crumb ("Attendance" → "Compliance") and the registry area change. The URL stays `/hrms/muster-roll`.
- **C5 · Manual entry.** The design makes it a tab. Today it is its own route that returns to the muster roll on save, and `live-design-attendance-admin.mjs` checks that return (Q8).
- **C6 · "Absent" today.** The design shows Absent and Not marked side by side for today. The client rule (STATIC §4 and §11.12) is that today anyone with no punch is **Not marked yet**, and Absent is used only for finished days. `dayBuckets` implements that rule and is shared with the admin dashboard, so the numbers must stay equal there.
- **C7 · Row click.** The design opens the profile. Today the row opens the person drawer, which holds:
  - the facts: shift start, how they punched, "Punched by", why this status
  - the actions: Fix this day, Change status, View history, Open full profile

  Suggestion: keep the drawer, and put Open profile in it and in ⋮.
- **C8 · Face percentage.** "Face match 71% · below the 80% bar" conflicts with the decision to show only the band. `match_score` is stored but deliberately not exposed (V034 comment; STATIC §4 "never a percentage"). Keep High / Medium / Low.
- **C9 · Review actions.** Generic Approve / Reject replaces "Excuse" and "Change status", each with a required reason, and "Yes, it's …" / "Not them". Keep the reason step (a status change can change pay and the person is told).
- **C10 · Overtime pay.** The design copy says "Ready for payroll" and "Paid through: Next pay run". The standing business rule is **recorded, not paid** (ShiftOvertime, Master → Shift Rules copy).
- **C11 · Overtime rules as a tab.** A settings block would sit inside an operational page. The client decision is that settings stay in their own sections: the attendance timing policy is in HR Configuration → Attendance rules; shift overtime rates are in Master → Shift Rules (Q4).
- **C12 · Analytics Overview.** The design's version is much smaller than today's (tiles, who's-where, check-in methods, trend, late most often, everyone's month, month picker, Download report). Dropping those blocks removes features, and `live-w3-analytics.mjs` asserts them. Suggestion: the design's 4 stats + 2 bar cards on top, today's blocks restyled below.
- **C13 · Rosters.** The design's Mon–Fri grid has no assign action. Today's roster assigns and changes shifts (with a start date and note), shows "Since", and filters "No shift yet". Keep assignment (a cell or row action), and show 7 days, since weekly offs vary.
- **C14 · Shifts.** The design has a table with Edit only; today has cards with Delete and See people. Shifts are also edited in Master → Shift Rules (both edit the same `attendance.shift_policies`).
- **C15 · Day picker.** Today has no day picker in the design; today's page shows any past day (`?date=`, "Showing day", "Back to today"). Keep a date chip like the dashboard's.
- **C16 · Admin self-service.**
  - My Attendance is hidden for OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN, and so is the whole ESS menu group.
  - `me-wfh` / `me-shift` are unreachable in the prototype too.
  - Keep as is. The live design for these pages is `EmpTime`.
- **C17 · "Punched by".** The assisted face punch label is not in the design; keep it on Today rows, the drawer and the face list.
- **C18 · WFH approvals.** They stay in Leave → Approvals (leave + WFH queue). The design has no admin WFH page in this area.
- **C19 · Permission mismatches that already exist.**
  - Manual entry: the route, the "Manual entry" header button and "Fix this day" are gated on `attendance.regularization.approve`, which DEPT_MANAGER holds. Saving needs `attendance.workforce.admin` (V143_5), and the registry uses `attendance.workforce.admin`.
  - Profile "Change shift" (`EmployeeShiftAction`): gated on `regularization.approve`, but the API needs `attendance.workforce.admin`.
  - The new "Mark attendance" and "Regularise" should use `attendance.workforce.admin`.
- **C20 · Company-wide reports.** Export, Punctuality and the report-based analytics use company-wide reports that managers lost in V117 ("team-scoped surfaces only"). New endpoints for managers must be team-scoped.
- **C21 · Several companies.** The container reads `companies[0]` for shifts, holidays and reports, so a tenant with several companies sees the first one's shifts. "By branch" and "all branches" work within one company.
- **C22 · Calendar component.** Every date and month field must use `src/shared/components/calendar` (`DateField`, `MonthField`). Time inputs stay native.
- **C23 · Rail highlight.** `/hrms/attendance` belongs to both "Attendance & Time" and "Me" for staff; `railLit.ts` keeps the rail item the person came through. Renaming groups or moving pages must keep this working.

---

## 17. Shared components (item 8)

**From the README list:**
- PageHeader
- PillTabs (with count badges, C2)
- SearchPill (page filter for Today)
- StatCard (selectable, delta with mood and arrow, tone, optional note, no sparkline on these pages)
- Card / Section (kinds used here: table, form, stats, bars, kv, and a section count badge)
- ListRow (Needs attention)
- StatusPill (ok / warn / bad / mint / info / gray)
- ApprovalRow (Review, Overtime, Change requests; with Undo)
- SegmentedControl (Review segments)
- FilterPills (active filter chip, roster chips)
- Meter / ProgressBar (worked bar, branch and department bars)
- Avatar
- EmptyState, Skeleton, Toast
- Popover / Menu (row ⋮)
- Dropdown with search (department, shift, employee picker)
- SidePanel (person-day drawer, Change status, Mark attendance, Add/Edit shift, Change shift, Edit overtime rules)
- Dialog (Remind all, delete shift, cancel WFH)
- FormField (input, select, textarea, time, toggle)
- The calendar fields from `src/shared/components/calendar`

**Page-specific:**
- CheckInsTable (Live dot, late chip, source line, worked meter, paging)
- NeedsAttentionItem
- BranchBars
- RosterWeekGrid
- KeyValue card (Overtime rules, WFH "How it works", "Your shift")

---

## 18. Risks and tests at risk (item 9)

**Live tests (`apps/platform/e2e/recovery/`) that assert today's markup:**

- **`live-design-attendance.mjs`**
  - Page: the `navigation "Attendance sections"` landmark; the "Daily Logs" heading; the "Came in" and "Not marked" tile buttons; `^Showing N of N`; "Fix this day" → the manual-entry URL; the Regularization tab.
  - Analytics: "All N people, grouped", "Attendance trend", "Everyone's month", "Open the full report".
  - Shifts: the flow uses `article` cards, the placeholder "e.g. Early morning", "Late after 9:30 AM" and "Delete shift".
  - Overtime: "Approve overtime", "Reject", "Recorded, not paid.".
  - Employee: the "My Attendance" and "My Shift" headings, "New request", "e.g. Forgot to punch out", "Decision note (optional)", and the toast texts.
- **`live-design-attendance-admin.mjs`**
  - Muster: the "Not marked yet" tile and no "Absent" today; "How the day splits"; the **"Export CSV"** button; the file `muster-roll-YYYY-MM-DD.csv`; the "Recent downloads" entry "Muster roll"; "On the roster"; `?date=` via `.utc-field` "Date".
  - Manual entry: `getByLabel('Employee')` select value; "Save entry"; the return to the muster roll with the date.
- **`live-w3-analytics.mjs`**: the combobox "Month"; the heading "Today"; the group "Today's numbers" / "… in numbers"; tile texts; "Month in total"; "How people checked in"; "Everyone's month"; "Download report"; a tile → the calendar tab with the month kept; day-box aria labels; the tab "Overview".
- **`live-w3-greeting-myatt.mjs`**: the owner and super admin have no "My Attendance" tab and "Daily Logs" is present; `?tab=my` opens Daily Logs; the h1 heading.
- **`live-w3-calendar.mjs`**: the Daily Logs combobox "Showing day", "Back to today", `?tab=team&date=`.
- **`live-w3-r2.mjs`**: `/me/wfh` comboboxes "From *" / "To *" and "N days from home"; `/me/shift-change` "Starting from *"; the muster "Date" combobox; manual entry "Date", `label[for="me-date"]` and `#me-in` / `#me-out`.
- **`live-w3-punch.mjs`**: "Punched by" on the Face Punch tab, the Daily Logs row and the drawer.
- **`live-rail-highlight.mjs`**: the `OWN_BAR` regex (`att-analytics|attendance|shifts`) and the rail titles "Attendance & Time" / "Employee Self Service".
- **`live-staff-dashboard.mjs`**: "My Attendance" opens `/hrms/attendance?tab=my`.
- **`live-browser.mjs`**: `/hrms/attendance?tab=corrections`. **`live-mobile-layout.mjs`**: `/hrms/shifts`, no sideways scroll.
- **Probably already stale** (they assert older UI): `live-shift-requests.mjs` (tabs "Shift schedules · Roster · Overtime · Shift requests", "Overtime approvals", `#tab-requests`), `live-shift-request-dates.mjs` (the heading "Request a Shift Change" on `/me/shift-change`; the page title today is "Shift change"), `live-overtime-browser.mjs`, `live-att-analytics-calendar.mjs` and `live-face-punch-logs.mjs`. The last two are in the pre-wave-3 failing baseline (STATIC §11.20).
- **Low markup risk:** `capture-design-screens.mjs`, `seed-design-demo-data.mjs`, `e2e/tests/dept-manager/05-attendance-team.spec.ts`, `e2e/tests/employee/04-my-attendance.spec.ts`.

**Unit tests:**
- `src/shared/navigation/pageRegistry.test.ts`: the attendance tabs use `?tab=`; `firstOpenIn('attendance')` is `/hrms/att-analytics` for HR; `me-attendance` is hidden for admin roles.
- `src/shared/search/search.test.ts`: `/attendance` → `/hrms/att-analytics`; `/attendance/daily logs` → `?tab=team`.
- `src/layouts/railLit.test.ts`.

**Other risks:**
- `attendanceBuckets.ts` is shared with `AdminDashboardContainer.tsx`. Changing the bucket rules (C6) changes the dashboard's numbers.
- The `design/dc/*.view.tsx` files are **generated** ("do not edit by hand") by `scripts/design-build.mjs` from the old exports in `docs/Designs/`. New hand-written pages must take their components out of the generator, or a re-run overwrites them.
- `StaffStatusResponse`, `ExceptionItem` and `/v1/team/schedule` are read by the mobile app. Only add fields.
- Every current attendance view hard-codes light colours, the Inter font and weights 700–800. Dark mode and "600 max" mean rewriting each view, not re-theming it.
- New tables (overtime rules, WFH allowance) must degrade to a hidden or empty block until production applies the migration by hand.
- `loadOvertime` pages 20 rows at a time, up to 1,000 rows. The new overtime stats may need server totals for big tenants.
- The Today table pages on the client over the whole day roster, as today does.
- The API and DB were down during this audit, so nothing here was checked against live responses.

---

## 19. Open questions (item 10)

1. **Tabs.** Use the design's tab names and order and keep today's extra tabs as more pills with their current `?tab=` keys (the C1 suggestion)? Or keep today's tab names as the prompt's "keep the tab names and order unchanged" says?
2. **Absent today.** Keep the client rule: no punch today = "Not marked yet", and Absent only for finished days or a reviewer's change. The design's Today "Absent" card would then show 0 on most mornings.
3. **Review Approve / Reject.** Should Approve mean "Excuse" (counts as present) and Reject mean "keep the status" (confirm Late / Absent), both still asking for a reason? Or keep today's "Excuse" and "Change status" wording?
4. **Overtime rules.**
   - Which of the six rules should be built now?
   - Where do they go: the Shifts page tab the design shows, or HR Configuration / Shift Rules (settings stay in their sections)?
   - Stay "recorded, not paid", or pay approved overtime through payroll?
5. **"On leave · 9 approved".** Does the smaller number mean pending leave for today should count under "On leave"? Today only approved leave counts.
6. **"Target under 3%".** Add an absence target setting, or drop the note?
7. **WFH allowance.** Build the "8 days a month" allowance as a company setting in HR Configuration → Attendance rules, enforced when someone applies? The self-service design (EmpTime) shows it too.
8. **Manual entry save.** After saving from the new Manual entry tab, stay on the tab and show the entry under "Recent manual entries"? Or keep today's return to the muster roll for that day?
9. **"Notify" and "Remind all at once".**
   - Who may send them: `attendance.status.review` holders, with managers limited to their team?
   - Should there be a limit of once per person per day?
