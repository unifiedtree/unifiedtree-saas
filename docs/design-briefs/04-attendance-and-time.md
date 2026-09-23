# Attendance & Time — page briefs

This group is the daily attendance engine of UnifiedTree HRMS: who punched in today, who is late/absent, how attendance is corrected, where staff may punch (geofences), which shift each employee works, and this month's overtime. Sidebar group **Attendance & Time** (rail label "Time") holds Attendance Analytics, Daily Tracking, Shifts & Overtime and Geofencing; **Compliance › Muster Roll** and the unlisted Manual Entry page are also part of this group. Employees reach Daily Tracking through **Employee Self Service › My Attendance & Leaves**.
Roles (from `layouts/PlatformShell.tsx`): `R_ADMIN_MGR` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER · `R_HR` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER · `R_ESS` = EMPLOYEE. Route guards are permission codes (`RouteGuard anyOf`), listed per screen. Punching in/out is mobile-only — the web app renders no check-in widget (`Attendance.tsx` line 31).

Screens in sidebar order: Attendance Analytics → Daily Tracking (4 tabs + drawer) → Shifts & Overtime (2 tabs + 2 drawers) → Geofencing (+ zone slide-over) → Muster Roll (Compliance group) → Manual Attendance Entry (not in sidebar) → Shift change requests (DEAD component).

---

## Attendance Analytics  `/hrms/att-analytics`
- **File:** modules/hrms/analytics/AttendanceAnalytics.tsx  ·  **Sidebar:** Attendance & Time › Attendance Analytics  ·  **Roles:** sidebar `R_ADMIN_MGR` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER); route guard `anyOf [hrms.report.attendance, attendance.team.read]` (App.tsx line 419)
- **Status:** PARTIAL — "Dashboard Overview" tab is fully live (useTeamDashboard → GET /v1/attendance/dashboard, useAttendanceSummaryReport → GET /v1/reports/attendance-summary, useLateMarksReport → GET /v1/reports/late-marks); the "Attendance Calendar" tab is a hard-coded "May 2026" grid of 7 static cells with inert Prev/Next buttons (`AttendanceCalendarTab`, lines 43–86).

### Purpose
HR managers and department managers open this to see today's attendance shape at a glance (present/late/leave/not-marked), find the month's repeat late-comers, and scan a per-employee summary (present days, late days, average hours, overtime minutes) for the current month-to-date, scoped to one company.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Attendance Analytics", subtitle "Live attendance snapshot for {EEEE, d MMM yyyy}" (e.g. "Friday, 18 Sep 2026"); `actions` = a native company `<select>` (not `HrSelect`; options = companies; disabled while loading or when none; shows "No companies").
2. `HrTabs` — "Dashboard Overview" · "Attendance Calendar".
3. **Dashboard Overview** `HrTabPanel`:
   1. KPI strip, 4 × `HrStatCard` (sm:grid-cols-2 lg:grid-cols-4): "Present Today" (green, sub "{n}% of tracked staff" or "No records yet") · "Late Today" (orange, sub "Arrived after grace window" / "All on time") · "On Leave Today" (purple, sub "{wfh} working from home") · "Not Marked" (red, sub "{absent} marked absent" / "No absences"). All take `loading`.
   2. Charts row, 2 × `.ut-card`: **"Today's Status Breakdown"** donut (sub "Live distribution across tracked staff"; recharts Pie, centre label "{total} TRACKED", legend list Present / Late / Work Home / On Leave / Half Day / Absent / Not Marked with counts) · **"Late Marks This Month"** horizontal bar (top 10 employees by late-mark count, sub "Top offenders since {d MMM}", tooltip "{n} marks · {avg} min avg").
   3. Section heading "Employee Attendance Summary" with period label "{d MMM} – {d MMM yyyy}", then `TableCard` wrapping an `hr-table` with columns **Employee** (`HrAvatar` name + sub employee_code) · **Department** · **Present** · **Late** (`HrStatusPill tone="late"` when > 0) · **Avg Hours** (1 dp) · **Overtime (min)**.
4. **Attendance Calendar** `HrTabPanel` — STUB: `.ut-card` titled "May 2026", "Prev"/"Next" buttons (no handlers), MON–SUN header, 7 hard-coded day cells (Present, Present, Absent, Half Day, WFH, Weekend, Weekend).

### Data shown
- Company list → `useCompanies` (modules/hrms/api/useOrg.ts) → GET /v1/hrms/companies; first company auto-selected.
- KPI strip + donut → `useTeamDashboard(today)` → GET /v1/attendance/dashboard?date=… → `counts { present, absent, late, halfDay, onLeave, workFromHome, notMarked, earlyCheckout }`.
- Late-marks bar → `useLateMarksReport(companyId, monthStart, today)` → GET /v1/reports/late-marks → rows `{ employee_code, employee_name, department, attendance_date, late_by_minutes, check_in_at }`, aggregated client-side per employee.
- Summary table → `useAttendanceSummaryReport(companyId, monthStart, today)` → GET /v1/reports/attendance-summary → rows `{ employee_code, employee_name, department, present_days, late_days, avg_hours, total_overtime_mins }`.
- Attendance Calendar tab → **no hook; static JSX**.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Company select | header actions | sets `companyId`; re-queries both reports | all who can open page | LIVE |
| Tab "Dashboard Overview" | tabs | shows live dashboard | all | LIVE |
| Tab "Attendance Calendar" | tabs | shows static May 2026 grid | all | STUB |
| "Prev" / "Next" | calendar card header | nothing — no onClick | all | STUB (inert) |
| Donut / bar hover | charts | recharts tooltip only; no drill-down | all | LIVE (no navigation) |

No row actions, no links, no export on this page.

### States
- KPI loading → `HrStatCard loading` skeletons; donut "Loading…"; table 6 skeleton rows.
- No company selected → bar card "Select a company to view late marks"; table "Select a company to view the summary."
- Donut empty → "No attendance recorded yet"; bar empty → "No late marks in this period"; table empty → "No attendance records for this period."
- No error state is rendered for any of the three queries (errors fall through to the empty messages).
- No-permission → `RouteGuard` blocks the route; there is no in-page permission messaging.

### Rules & permissions
- Reports are company-scoped (`companyId` required); dashboard counts are tenant/team-scoped by the backend's team scope and not filtered by the selected company (the KPI strip ignores the company select).
- Late-marks bar shows top 10 only, sorted by count desc.
- Period is always month-start → today; no date range picker.

### Gaps & plan  (keep / add / change)
- **Keep:** KPI strip, donut with centre total, late-marks bar, employee summary table — all wired to real endpoints.
- **Add:** [BLUEPRINT §6 row 10] "Attendance Analytics … Shallow … KPIs + trends + calendar"; [BLUEPRINT §11] "Analytics — KPIs + trend + on-time rate + month calendar"; [PLAN §8] "Analytics — existing API `dashboard/trend`, `/sources` … Target UI KPIs + trend + on-time + calendar … Drill-down: Chart → filtered list". The hooks `useAttendanceTrend` (GET /v1/attendance/dashboard/trend) and `useAttendanceSources` (GET /v1/attendance/dashboard/sources) exist in `api/useAttendance.ts` but are not used here.
- **Add:** [code: static `AttendanceCalendarTab` in AttendanceAnalytics.tsx] replace the hard-coded May 2026 grid with a real month calendar (a company-wide day-by-day view, driven by the trend endpoint) or remove the tab.
- **Change:** the company select changes only the two report blocks, not the KPI/donut — make the scope visibly apply to everything or label the KPI strip "all companies". Add a date/period control (currently fixed to month-to-date). Give charts a drill-down to `/hrms/attendance?tab=team&status=…` (BLUEPRINT §8.3 pattern). Surface query errors instead of silently showing empty messages.

### Screenshot
`Attach: /hrms/att-analytics — current screen`

### Claude Design prompt (ready to paste)
```
Design the Attendance Analytics page for HR managers and department managers (OWNER/SUPER_ADMIN/COMPANY_ADMIN/HR_MANAGER/FINANCE_LEAD/DEPT_MANAGER).
Use HrPageHeader: crumb "Attendance & Time", title "Attendance Analytics", subtitle "Live attendance snapshot for Friday, 18 Sep 2026", actions = HrSelect of companies ("Unified Tree Pvt Ltd"; today a native select) plus a new month/period picker (default "1 Sep – 18 Sep 2026").
HrTabs: "Dashboard Overview" · "Attendance Calendar".
Dashboard tab: KPI strip of 4 HrStatCard — Present Today 142 (green, "88% of tracked staff"), Late Today 14 (orange, "Arrived after grace window"), On Leave Today 6 (purple, "9 working from home"), Not Marked 11 (red, "3 marked absent"); each tile clickable → /hrms/attendance?tab=team&status=….
Charts row: "Today's Status Breakdown" donut (centre "162 TRACKED", legend Present/Late/Work Home/On Leave/Half Day/Absent/Not Marked with counts) and "Late Marks This Month" horizontal bar (top 10 employees, tooltip "4 marks · 22 min avg"); add a third card "Attendance trend" (daily present/late/absent line for the period, from GET /v1/attendance/dashboard/trend).
Below: "Employee Attendance Summary" TableCard, columns Employee (HrAvatar name + EMP-0142) · Department · Present · Late (HrStatusPill tone late when >0) · Avg Hours (7.8) · Overtime (min); keep 6-row skeleton, empty "No attendance records for this period."
Attendance Calendar tab: replace the static May 2026 mock with a real month grid (Sep 2026, Mon–Sun, each cell shows present/late/absent counts, weekends and holidays greyed), Prev/Next actually navigating months.
States: loading skeletons on every block, "Select a company to view…" when no company, explicit error card with Retry (missing today).
Keep the emerald/mint palette and the existing card layout; no new colours for statuses — use HrStatusPill tones.
```

---

## Daily Tracking (Attendance)  `/hrms/attendance`
- **File:** modules/hrms/Attendance.tsx (+ modules/hrms/attendance/CorrectionApprovals.tsx, attendance/date.ts)  ·  **Sidebar:** Attendance & Time › Daily Tracking (`R_ADMIN_MGR`) **and** Employee Self Service › My Attendance & Leaves (`R_ESS` = EMPLOYEE)  ·  **Roles:** route guard `anyOf [hrms.ess.read, hrms.employee.read, attendance.checkin.self]` (App.tsx line 337); tabs are permission-gated in-page (see Rules).
- **Status:** PARTIAL — My Attendance, Daily Logs (team) and Regularization are live on `useAttendance` hooks (GET /v1/attendance/monthly-stats, /history, /dashboard, /corrections/*); the **Face Punch Logs** tab is a hard-coded 2-row table (Rajesh Kumar / Priya Mehta, "May 14") with no hook (`FacePunchTab`, lines 682–719).

### Purpose
Two audiences share one page. Employees come to see their own month (calendar of day statuses, present/absent/late counts, attendance score) and to raise a correction request. HR/admins/managers come to see today's roster — who is present, late, on leave, WFH or not marked — drill from a status tile or a dashboard link into the named people, open one person's day, and approve or reject correction requests.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Attendance", subtitle "Track and manage attendance records." No actions.
2. `HrTabs` (permission-dependent set, in this order): "My Attendance" (only with `attendance.checkin.self`) · "Daily Logs" (only with `attendance.team.read`) · "Face Punch Logs" (always) · "Regularization" (always). Deep-link `?tab=my|team|face|corrections`.
3. **My Attendance** `HrTabPanel` — 1/3 + 2/3 grid:
   - Left: heading "{MMMM yyyy} Summary" and 6 × `HrStatCard` in a 2-col grid: Present (green) · Absent (red) · Late (orange) · On Time (blue) · Holidays (purple) · Score "{n}%" (green).
   - Right: `.ut-card` "Daily Log" with month chip "{MMMM yyyy}", a 7-column month calendar (Sun–Sat header, leading blanks, each day a filled square coloured by status: PRESENT emerald, ABSENT red, LATE amber, HALF_DAY orange, ON_LEAVE sky, HOLIDAY purple, WEEKEND slate, WFH cyan; unfilled = NOT_MARKED), then a legend row (PRESENT, ABSENT, LATE, ON LEAVE, HOLIDAY, WEEKEND). Cells are not clickable (comment at line 172 explains the hover was removed).
4. **Daily Logs** `HrTabPanel` (component `TeamDashboardTab`):
   1. KPI strip 5 × `HrStatCard` (md:grid-cols-5), each an `onClick` toggle filter: Present (green) · Late (orange) · On Leave (blue) · WFH (teal) · Not Marked (red).
   2. Result line when a filter is active: "Showing **{n}** late of **{total}** on the roster in {Department}".
   3. `TableCard` — `search` "Search team…"; `filters` = Department (`allLabel` "All Departments", hidden when < 2 departments; server-side) and Status (`allLabel` "All Statuses"; options Present, Absent, Late, Work from home, Not marked, Early out, On leave, Half day; client-side); `onClearFilters`; `actions` = `<input type="date">` "Attendance date" (defaults to IST today via `attendanceDate()`).
   4. `DataTable` columns: **Employee** (`HrAvatar` fullName / employeeCode) · **Department** · **Role** (jobTitle) · **Status** (`HrStatusPill`, tone map PRESENT/ON_TIME ok, LATE warn, ABSENT red, NOT_MARKED gray, ON_LEAVE info, WFH teal, HALF_DAY late, EARLY_OUT orange, HOLIDAY purple, WEEKEND gray; plus an extra orange "Early out" pill when `earlyCheckout`) · **Check In** (`h:mm a`) · **Check Out** (`h:mm a`) · **Worked** ("8h 05m", derived) · **Location** (locationName, truncated). Row click → drawer.
   5. `HrDrawer` **Staff attendance** (`StaffAttendanceDrawer`) — title = employee name; body is a `<dl>` of Employee code · Department · Role · Date ("EEEE, d MMM yyyy") · Status pill · Check in · Check out · Worked · Left early ("Yes — before shift end"/"No") · Location ("Not captured"); footer `HrButton` "Open full profile". Renders from the row already in memory — no extra request.
5. **Face Punch Logs** `HrTabPanel` — STUB `TableCard` titled "Face Punch Logs" with a raw table: Employee · Location/Device · Timestamp · Match Confidence (progress bar + %) · Status ("Verified" green / "Low Confidence" orange). Two hard-coded rows.
6. **Regularization** `HrTabPanel` (`CorrectionsTab`) — stacked panels, each behind its own authority:
   - **Attendance requests** (`CorrectionApprovals`, only with `attendance.regularization.approve`): `.ut-card` header "Attendance requests" + "Review who requested a correction and the times they want changed. Times are IST." + Status `<select>` Pending/Approved/Rejected; a list of `<article>` cards each with `HrAvatar` + linked name (link to `/hrms/employees/{id}` when `hrms.employee.read`), "EMP-0142 · Engineering", `HrStatusPill` (APPROVED ok / REJECTED red / PENDING warn), a 3-cell `<dl>` Attendance date · Requested check-in · Requested check-out (IST HH:mm or "No change requested"), "Reason: …", optional "View attachment" link; for PENDING rows an inline "Decision note (optional)" input (placeholder "Explain your decision", max 1000) + `HrButton ghost` "Reject" + `HrButton` "Approve"; for decided rows "Decision note: …". Footer `HrPagination` (page/size, default 20).
   - **My Corrections** (`MyCorrectionsPanel`, only with `attendance.checkin.self`): `.ut-card` header "My Corrections" + toggle button "+ New Request"/"Close"; an animated inline form card "New Request" with Date * (date) · Attachment URL (url, "https://…") · Requested Check-In (time) · Requested Check-Out (time) · Reason * (textarea "Explain the correction needed...") and footer "Cancel" / "Submit Request" (→ "Submitting..."); below, a list of own requests as rows "{requestedDate}" + reason + status chip (PENDING warning / APPROVED success / else danger), or an empty block.

### Data shown
- My Attendance summary → `useMonthlyStats(year, month)` → GET /v1/attendance/monthly-stats?year&month → `{ presentDays, absentDays, lateDays, holidays, onTimeDays, attendanceScore }`. Month is fixed to the current month (state is never changed — no month navigation).
- My Attendance calendar → `useAttendanceHistory(year, month)` → GET /v1/attendance/history → `[{ date, status, checkInTime?, checkOutTime?, workHours? }]`.
- Daily Logs → `useTeamDashboard(date, departmentId)` → GET /v1/attendance/dashboard?date&departmentId → `{ date, counts{present,absent,late,halfDay,onLeave,workFromHome,notMarked,earlyCheckout}, staffStatuses[] }`; staff row fields: employeeId, employeeCode, fullName, jobTitle, departmentId/Name, status, checkInAt, checkOutAt, locationName, earlyCheckout, attendanceType, onLeave. Whole roster in one payload (no paging); status filter reproduces the server's tile buckets (`matchesStatus`, lines 239–256).
- Department options → `useCompanies` + `useDepartments(companies[0].id)` → GET /v1/hrms/companies, /v1/hrms/departments.
- Approvals → `useCorrectionApprovals(status, {page,size})` → GET /v1/attendance/corrections/approvals?status&page&size (paged `{content,totalElements,totalPages}`); rows: id, employeeId, employeeName, employeeCode, departmentName, requestedDate, requestedCheckInAt, requestedCheckOutAt, reason, attachmentUrl, status, approverComment.
- My corrections → `useMyCorrections()` → GET /v1/attendance/corrections/my.
- Face Punch Logs → **none (static JSX)**. Backend `FaceController` exists (`backend/modules/attendance-face/src/main/java/com/unifiedtree/attendance/face/controller/FaceController.java`; BLUEPRINT §6 row 12 "8 eps"); only `employees/api/useFaceAdmin.ts` (POST /v1/attendance/face/admin/{id}/reset) is wired on the web, on the employee profile, not here.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tab "My Attendance" | tabs | switch tab, writes `?tab=my` | holders of `attendance.checkin.self` (EMPLOYEE; not the seeded ADMIN/MANAGER workspace roles) | LIVE |
| Tab "Daily Logs" | tabs | writes `?tab=team` | holders of `attendance.team.read` | LIVE |
| Tab "Face Punch Logs" | tabs | writes `?tab=face` | everyone on the route | STUB |
| Tab "Regularization" | tabs | writes `?tab=corrections` | everyone on the route | LIVE |
| Retry (stats / history) | My Attendance `EmptyState` | refetch failed query | self | LIVE |
| Tile Present / Late / On Leave / WFH / Not Marked | Daily Logs KPI strip | toggles `?status=` filter (click again clears) | team.read | LIVE |
| Department filter | Daily Logs `TableCard` filters | sets `?department=`; re-queries server | team.read | LIVE |
| Status filter | Daily Logs `TableCard` filters | sets `?status=`; client-side filter | team.read | LIVE |
| Clear filters | `TableCard` `onClearFilters` | drops both params in one write | team.read | LIVE |
| Search team… | `TableCard` search | client filter on fullName / employeeCode | team.read | LIVE |
| Attendance date | `TableCard` actions (date input) | sets `?date=`; re-queries | team.read | LIVE |
| Row click | Daily Logs table | opens `StaffAttendanceDrawer` | team.read | LIVE |
| "Open full profile" | drawer footer | `navigate('/hrms/employees/{employeeId}')` | team.read | LIVE |
| Retry (team) | Daily Logs error `EmptyState` | refetch dashboard | team.read | LIVE |
| Status select Pending/Approved/Rejected | Attendance requests header | re-queries approvals, resets page | `attendance.regularization.approve` | LIVE |
| Employee name link | Attendance requests card | `<Link to="/hrms/employees/{id}">` | + `hrms.employee.read` (else plain text) | LIVE |
| "View attachment" | Attendance requests card | opens `attachmentUrl` in new tab (only http(s)) | approve | LIVE |
| Decision note (optional) | Attendance requests card (PENDING) | input, max 1000 chars | approve | LIVE |
| "Approve" | Attendance requests card | `useDecideCorrection` → POST /v1/attendance/corrections/{id}/decision `{status:'APPROVED', comment}`; toast "Attendance correction approved" | approve | LIVE |
| "Reject" (`HrButton ghost`) | Attendance requests card | same endpoint with `status:'REJECTED'`; toast "Attendance correction rejected" | approve | LIVE |
| "Try again" | Attendance requests error | refetch | approve | LIVE |
| `HrPagination` page / page size | Attendance requests footer | page state | approve | LIVE |
| "+ New Request" / "Close" | My Corrections header | toggles inline form | `attendance.checkin.self` | LIVE |
| Date *, Attachment URL, Requested Check-In, Requested Check-Out, Reason * | New Request form | form state | self | LIVE |
| "Cancel" | New Request form footer | closes form | self | LIVE |
| "Submit Request" | New Request form footer | `useCreateCorrection` → POST /v1/attendance/corrections `{requestedDate, requestedCheckInAt?, requestedCheckOutAt?, reason, attachmentUrl?}`; toast "Correction submitted successfully"; closes + resets form | self | LIVE |

### States
- My Attendance: `StatsSkeleton` / `Skeleton h-64` while loading; `EmptyState` "Error — Failed to load stats" / "Failed to load history" with Retry.
- Daily Logs: `DataTable loading`; error `EmptyState` "Error — Failed to load team" + Retry; empty "No records found for this date" or, with a status filter, "Nobody is late on 18 Sep 2026."; KPI strip hidden until `counts` arrive.
- Attendance requests: "Loading attendance requests…"; error "Attendance requests could not be loaded." + "Try again"; empty "No pending attendance requests." (status word follows the select); buttons disabled while deciding or refetching; decision failure toast = API message or "Unable to save the decision. Please try again."
- My Corrections: empty block with clock icon "No correction requests"; validation toasts "Date and reason required", "Provide either check-in or check-out time (or both)", "Requested check-in time must be HH:MM (24-hour)", "Requested check-out time must be HH:MM (24-hour)"; failure toast "Failed to submit correction".
- Regularization with neither authority: `EmptyState` "Corrections aren't available for your role" + explanatory description.
- Face Punch Logs: no states — static rows always render.

### Rules & permissions
- Default tab: `my` if `attendance.checkin.self`, else `team` if `attendance.team.read`, else `corrections`. `?tab=my` is refused for roles without self check-in (they were getting two 403 "Failed to load" blocks — 2026-09-08 audit note in code).
- `?tab=team` is not refused the same way: the "Daily Logs" pill is hidden without `attendance.team.read`, but `TeamDashboardTab` still mounts for a deep link (`tab === 'team'` has no permission guard, Attendance.tsx line 779) and the dashboard call 403s into the "Failed to load team" `EmptyState`.
- Daily Logs: status filter buckets mirror `AttendanceController.countSummary` — PRESENT = checked in and not late/half-day/WFH; NOT_MARKED = no check-in (includes people on leave); ABSENT = not checked in and not on leave; EARLY_OUT is a separate axis. Department filter is server-side, status filter client-side (full roster returned).
- Drawer shows only what the roster row carries; per-employee history for another person has no endpoint (comment lines 436–444).
- Approvals list: GET/POST gated on `attendance.regularization.approve`; My Corrections on `attendance.checkin.self` (each panel mounts only behind its authority so a 403 never renders as a false empty).
- Correction form: date + reason mandatory; at least one of check-in/check-out; times HH:MM 24h; composed to local ISO instants.
- Attendance business date is Asia/Kolkata (`attendance/date.ts`); approval times formatted en-IN IST.
- Deep links supported: `?tab=team&status=LATE&department=<id>&date=YYYY-MM-DD` (used by the dashboard drill-downs).

### Gaps & plan  (keep / add / change)
- **Keep:** URL-driven tile/filter drill-down (the BLUEPRINT §8.3 P0 item is implemented), permission-gated tabs and panels, the row drawer with "Open full profile", the approval cards with decision note, the self correction form.
- **Add:** [BLUEPRINT §11 / PLAN §E "Done when"] "Columns must add expected vs actual check-in and late duration — otherwise 'who are the 14?' is answered but 'how late?' is not"; "Each row shows shift, expected check-in, actual check-in, minutes late, department". Today's table has no Shift / Expected / Late-by columns (`lateByMinutes` exists on `AttendanceRecordResponse` but the dashboard row `StaffStatusResponse` does not carry it).
- **Add:** [BLUEPRINT §6 row 12; PLAN §8] "Face Punch Logs — FaceController (8 eps) — no web UI — Tab: employee, device, timestamp, confidence — Row → drawer". Replace the static `FacePunchTab` with a real log list.
- **Add:** [BLUEPRINT §11] "Accept `?status=` and `?method=`" — `?method=` (punch method / source filter, `useAttendanceSources`) is not read.
- **Add:** [BLUEPRINT §6 row 13; PLAN §8] "Regularization — Promote to own leaf; approval queue"; [PLAN §6 drill-down pattern, line 320] drawer actions "[Regularize] [View profile] [View history]" — the drawer today has only "Open full profile".
- **Add:** [code: `useState(now.getMonth()+1)` never updated] month navigation on My Attendance (the calendar is locked to the current month).
- **Change:** the "My Corrections" list shows the raw `requestedDate` (yyyy-MM-dd) and raw `PENDING` chips — use `HrStatusPill` and "18 Sep 2026". The New Request form is inline-expanding; convert to `HrDrawer` for consistency with the rest of the app. Attachment is a pasted URL, not an upload. The header has no actions even though HR could use "Manual entry" / "Muster roll" shortcuts from here (both exist as separate routes). "Daily Logs" tab label vs "Team dashboard" component vs sidebar "Daily Tracking" — settle on one name.

### Screenshot
`Attach: /hrms/attendance — current screen` (capture `?tab=team`, `?tab=my`, `?tab=corrections` and `?tab=face`)

### Claude Design prompt (ready to paste)
```
Design the Daily Tracking (Attendance) page. Roles: HR/admins/managers see "Daily Logs" + "Regularization"; employees (EMPLOYEE role, via ESS › My Attendance & Leaves) see "My Attendance" + "Regularization". Both sets share one HrPageHeader: crumb "Attendance & Time", title "Attendance", subtitle "Track and manage attendance records."; add header actions "Manual entry" (ghost) and "Muster roll" (ghost) for HR only.
HrTabs: "My Attendance" · "Daily Logs" · "Face Punch Logs" · "Regularization".
Daily Logs: KPI strip of 5 clickable HrStatCard — Present 142, Late 14, On Leave 6, WFH 9, Not Marked 11 (active tile shows a selected ring); result line "Showing 14 late of 162 on the roster in Engineering"; TableCard with search "Search team…", filters All Departments / All Statuses, a date input (18 Sep 2026) and Clear; DataTable columns Employee (HrAvatar "Priya Mehta" / EMP-0142) · Department · Shift (new: "General 09:00 AM–06:00 PM") · Status (HrStatusPill: Present ok, Late warn, Absent red, On leave info, WFH teal, Half day late, Not marked gray, plus orange "Early out") · Check In (9:22 AM) · Expected (new: 9:00 AM) · Late by (new: "22 min", tabular-nums) · Check Out · Worked (8h 05m) · Location. Empty: "Nobody is late on 18 Sep 2026."
Row click opens HrDrawer titled with the employee name: definition list Employee code / Department / Role / Date "Friday, 18 Sep 2026" / Status / Check in / Check out / Worked / Left early / Location; footer HrButton "Open full profile" plus new ghost buttons "Regularize" and "View history".
My Attendance: left column "September 2026 Summary" with 6 HrStatCard (Present 18, Absent 1, Late 3, On Time 15, Holidays 1, Score 92%); right card "Daily Log" with a month stepper (‹ September 2026 ›) and a 7-column calendar of filled day squares (emerald present, red absent, amber late, orange half day, sky on leave, purple holiday, slate weekend, cyan WFH) + legend.
Regularization: two stacked cards — "Attendance requests" (Status select Pending/Approved/Rejected; request cards with HrAvatar + name link, "EMP-0142 · Engineering", HrStatusPill, cells Attendance date / Requested check-in / Requested check-out in IST, "Reason: …", "View attachment", inline "Decision note (optional)" + ghost "Reject" + primary "Approve"; HrPagination footer) and "My Corrections" (header button "+ New Request" opening an HrDrawer form: Date *, Requested Check-In, Requested Check-Out, Attachment URL, Reason *; list rows "18 Sep 2026 — Forgot to punch out" with HrStatusPill Pending approval / Approved / Rejected; EmptyState "No correction requests").
Face Punch Logs: design the real table the stub promises — Employee · Location/Device ("Kiosk-Pune-01", "Mobile App (Geofenced)") · Timestamp (18 Sep 2026, 08:30 AM) · Match Confidence (bar + 98%) · Status (Verified ok / Low Confidence warn), row → drawer.
States: TableSkeleton, EmptyState with Retry on error, EmptyState "Corrections aren't available for your role" when the user holds neither authority.
```

---

## Shifts & Overtime  `/hrms/shifts`
- **File:** modules/hrms/attendance/ShiftsAndOt.tsx (+ ShiftRoster.tsx, EmployeeShiftAction.tsx, OvertimeApprovals.tsx)  ·  **Sidebar:** Attendance & Time › Shifts & Overtime  ·  **Roles:** sidebar `R_HR` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER); route guard `anyOf [attendance.team.read, hrms.employee.read]` (App.tsx line 543). Writes need `attendance.regularization.approve`; overtime decisions need `attendance.overtime.approve`.
- **Status:** LIVE — shift policies via `useShiftPolicies` → GET/POST/PUT/DELETE /v1/shifts; roster via `useEmployeeDirectory` + `useEmployeeShift` → GET /v1/shifts/employee/{id}; overtime via GET /v1/attendance/overtime and POST …/{id}/approve|reject; OT month table via GET /v1/reports/attendance-summary. Tab labelling is misleading (the "Overtime Approvals" tab also holds the shift schedule CRUD table) — see Change.

### Purpose
HR defines the company's shift policies (timings, grace period, working hours, OT multiplier), sees which shift every employee is on and moves an employee to a different shift effective today, and reviews completed overtime records (approve/reject with a note). Managers with `attendance.team.read` can view; only regularization-approvers can change shifts, only overtime-approvers can decide OT.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Shifts & Overtime", subtitle "Shift schedules and this month's overtime across the workforce"; `actions` = company `<select>` (only when > 1 company, with Building2 icon) + `HrButton` "Add Shift" (Plus icon; only for `canManageShifts`; disabled with tooltip "No company is visible to your role, so a shift cannot be created" when no company).
2. View-only banner (mint box) when the user cannot manage shifts: "View only — ask an admin or HR manager to add, edit, or remove shift schedules."
3. KPI strip 3 × `HrStatCard` (sm:grid-cols-3): "Shifts Defined" (blue) · "Night Shifts" (green) · "Overtime (This Month)" (orange, "{n}h").
4. `HrTabs` — "Shift Roster" · "Overtime Approvals".
5. **Shift Roster** `HrTabPanel` (`ShiftRoster`, keyed by company):
   - Heading "Current shift roster" + "Current assignments and their effective dates. Use Change shift to update an employee's assignment."; label "Find employee" + search input "Search name or employee code".
   - `TableCard` › `hr-table` columns **Employee** (bold name + employeeCode) · **Shift** (shiftName or "Unassigned"; per-row "Retry shift" ghost button on error) · **Timings** ("09:00 – 18:00") · **Effective from** (raw yyyy-MM-dd) · **Action** (`HrButton ghost` "Change shift", only for approvers).
   - `HrPagination` (10 per page).
   - `HrDrawer` **"Change employee shift"** (`AssignmentDrawer`): employee name, note "Choose the shift and the day it takes effect. The roster and attendance use the new shift from that day; earlier assignments stay in history."; "Current shift" box (name or "No shift assigned", "09:00 – 18:00 · since 1 Sep 2026", and "Scheduled: Night from 1 Oct 2026" when a future change exists); "New shift" `<select>` ("Select a shift" + policies "General · 09:00 – 18:00"); **"Effective from"** `<input type="date">` (default today, `min` = current assignment's `effectiveFrom`) with hint "Applies from today." / "The change is scheduled for 1 Oct 2026; the current shift applies until then."; inline alerts "The date cannot be before the current assignment started (1 Sep 2026)." and "{name} is already on this shift."; hint "Create a shift in Attendance → Shifts & Overtime first." when no policies; footer `HrButton ghost` "Cancel" + `HrButton` "Save shift" (label becomes "Schedule shift change" for a future date; → "Saving…").
6. **Overtime Approvals** `HrTabPanel` — three stacked blocks:
   1. Heading "Shift Schedules" + `TableCard` › `hr-table`: **Shift** · **Timing** ("09:00 AM – 06:00 PM") · **Grace** ("15 min", sm+) · **Hours/Day** ("8 h", sm+) · **Type** (`HrStatusPill` purple with moon icon "Night", else info "Fixed/Flexible/Rotational") · actions (icon buttons Edit / Delete, only for `canManageShifts`).
   2. `OvertimeApprovals` `.ut-card`: header "Overtime approvals" + "Review completed attendance records. Approval records the decision; payroll disbursement is a separate workflow." + `<input type="month">` "Overtime month"; `hr-table` **Employee** (Link to `/hrms/employees/{id}`) · **Date** · **Minutes** · **Status** (`HrStatusPill` APPROVED ok / REJECTED red / else warn) · **Review** (`HrButton` "Review" for PENDING when `canApprove`, else decidedBy + note); an inline decision region "Review overtime for {name}" with textarea "Decision note" (max 1000) and buttons "Approve overtime" / ghost "Reject overtime" (needs a note) / ghost "Cancel"; footer "Previous" / "{page} / {pages}" / "Next" (page size 20).
   3. Heading "Overtime — {MMMM yyyy}" + `TableCard` › `hr-table`: **Employee** (`HrAvatar` name / department) · **Present Days** (sm+) · **Overtime** ("{n}h"), rows with OT > 0 sorted desc.
7. Slide-over **Add Shift / Edit Shift** (`ShiftFormModal`, custom fixed panel mirroring the geofence one): fields Shift Name * ("e.g. General") · Shift Type select (Fixed/Flexible/Rotational/Night) · Start Time * / End Time * (time inputs, 2-col) · Grace Period (minutes) number 0–120 with hint "0–120. Check-ins within this window are not marked Late." · Working Hours per Day number 0.5–24 step 0.5 with hint "0.5–24. The daily target for this shift." · checkbox "Overtime applicable on this shift" · (if checked) Overtime Rate (multiplier) 1.0–9.99 step 0.25 with hint "…Stored as the configured rate — no payroll run applies it automatically yet."; footer "Cancel" + "Create Shift"/"Update Shift" (→ "Saving…").

### Data shown
- Companies → `useCompanies` → GET /v1/hrms/companies.
- Shift policies → `useShiftPolicies(companyId)` → GET /v1/shifts?companyId → `{ id, name, shiftType, startTime "HH:mm:ss", endTime, gracePeriodMinutes, workingHoursPerDay, overtimeApplicable, overtimeMultiplier }`; seeds defaults when none (hook docblock).
- Roster → `useEmployeeDirectory({companyId, search, page, pageSize:10})` (api/useWorkforce.ts) → GET /v1/hrms/employees (needs `hrms.employee.read`); per row `useEmployeeShift(employeeId)` → GET /v1/shifts/employee/{id} → `{ shiftPolicyId, shiftName, shiftType, startTime, endTime, gracePeriodMinutes, effectiveFrom, effectiveTo?, upcomingShiftPolicyId?, upcomingShiftName?, upcomingEffectiveFrom? }` (one request per row).
- Overtime list → inline `useQuery` in OvertimeApprovals → GET /v1/attendance/overtime?from={month}-01&to={month-end}&page → `{ content[{ id, employeeId, employeeName, date, minutes, status, note, decidedBy }], totalElements }`.
- OT month table + "Overtime (This Month)" tile → `useAttendanceSummaryReport(companyId, monthStart, monthEnd)` → GET /v1/reports/attendance-summary → `total_overtime_mins`, `present_days`, `employee_name`, `department`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Company select | header actions (only >1 company) | sets `companyId`; re-keys roster + policies + report | all on route | LIVE |
| "Add Shift" (Plus icon) | header actions | opens `ShiftFormModal` (new) | `attendance.regularization.approve` | LIVE |
| Tab "Shift Roster" / "Overtime Approvals" | tabs | switch panel | all | LIVE |
| Find employee (search) | Shift Roster | server search, resets page | `hrms.employee.read` | LIVE |
| "Retry shift" (ghost, per row) | Shift column on error | refetch that employee's shift | roster viewers | LIVE |
| "Retry" | roster error block | refetch directory | roster viewers | LIVE |
| `HrPagination` | Shift Roster footer | page change (10/page) | roster viewers | LIVE |
| "Change shift" (ghost) | roster row Action | opens `AssignmentDrawer` | `attendance.regularization.approve` | LIVE |
| New shift select | drawer body | picks `shiftPolicyId` | approve | LIVE |
| Effective from (date) | drawer body | sets `effectiveFrom` (default today; `min` = current assignment start; a future date turns the save into a scheduled change) | approve | LIVE |
| "Try again" | drawer error | refetch current + policies | approve | LIVE |
| "Save shift" / "Schedule shift change" | drawer footer | POST /v1/shifts/employee/{employeeId} `{shiftPolicyId, effectiveFrom}`; invalidates `['shifts']`, `['hrms','attendance']`, `['team','schedule']`; toast "{name} is now on {shift}" or "{name} moves to {shift} from 1 Oct 2026"; closes | approve | LIVE (disabled when no shift / same as current / date before current start / pending / load errors) |
| "Cancel" (ghost) | drawer footer | close (blocked while saving) | approve | LIVE |
| Edit (pencil icon) | Shift Schedules row | opens `ShiftFormModal` with the policy | approve | LIVE |
| Delete (trash icon) | Shift Schedules row | `window.confirm("Delete the shift …? Employees still assigned to it must be moved to another shift first.")` → DELETE /v1/shifts/{id}; toast "Shift deleted" or API message (409 SHIFT_IN_USE) | approve | LIVE |
| Shift form fields | slide-over | Shift Name *, Shift Type, Start/End Time *, Grace, Hours/Day, OT checkbox, OT multiplier | approve | LIVE |
| "Create Shift" / "Update Shift" | slide-over footer | POST /v1/shifts?companyId or PUT /v1/shifts/{id}; toasts "Shift created" / "Shift updated" | approve | LIVE |
| "Cancel" / × | slide-over | close | approve | LIVE |
| Overtime month (`type="month"`) | Overtime approvals header | re-queries OT for that month, resets page + selection | `attendance.team.read` | LIVE |
| Employee name link | OT row | `<Link to="/hrms/employees/{employeeId}">` | team.read | LIVE |
| "Review" | OT row (PENDING) | opens inline decision region | `attendance.overtime.approve` | LIVE |
| Decision note textarea | decision region | note (max 1000) | overtime.approve | LIVE |
| "Approve overtime" | decision region | POST /v1/attendance/overtime/{id}/approve `{note}`; invalidates; clears | overtime.approve | LIVE |
| "Reject overtime" (ghost) | decision region | POST …/{id}/reject `{note}`; disabled until note typed | overtime.approve | LIVE |
| "Cancel" (ghost) | decision region | clears selection | overtime.approve | LIVE |
| "Retry" | OT error | refetch | team.read | LIVE |
| "Previous" / "Next" | OT footer | page ±1 (20/page) | team.read | LIVE |

### States
- KPI tiles `loading`; Shift Schedules 3 skeleton rows; OT month table 3 skeleton rows.
- Shift Schedules empty: "No shifts defined for this company yet." or, with no company, "Shifts are defined per company, and no company is visible to your role — ask an admin to open this screen."
- Roster: no `hrms.employee.read` → card "Employee directory access is required to view the company shift roster."; loading "Loading roster..."; empty "No employees match."; error message + "Retry"; per-row "Loading..." / "Unassigned" / "--".
- Assignment drawer: "Loading shift schedules…"; error "Unable to load shift schedules." + "Try again"; inline validation "The date cannot be before the current assignment started (…)" / "{name} is already on this shift."; inline save error text ("Shift could not be saved. Please retry." fallback).
- Overtime approvals: hidden entirely without `attendance.team.read`; "Loading overtime..."; error + "Retry"; empty "No completed overtime records for this month."; decision failure toast = API error message.
- OT month table empty: "No overtime recorded this month."
- Form validation toasts: "Shift name is required", "Start and end time must be a valid 24-hour time", "Shift start and end time must differ", "A fixed shift must end after it starts — use the Night type to wrap past midnight", "Grace period must be between 0 and 120 minutes", "Working hours per day must be between 0.5 and 24", "Overtime rate must be between 1.0 and 9.99", "No company available to attach this shift to"; save failure toast = API message or "Failed to save shift"; delete failure = API message or "Failed to delete shift".

### Rules & permissions
- Reads of /v1/shifts need `attendance.checkin.self`; all writes (POST/PUT/DELETE, employee assignment) need `attendance.regularization.approve`. OT list needs `attendance.team.read`; OT decisions `attendance.overtime.approve`; no self-approval and scope-limited server-side (HANDOFF §5).
- Only a NIGHT shift may wrap past midnight; zero-length windows rejected. Server bounds: grace 0–120, hours 0.5–24, multiplier 1.0–9.99 (omitted when OT off).
- Delete is a soft delete; 409 SHIFT_IN_USE when employees are still assigned.
- Shift assignment is effective-dated: defaults to today, may be scheduled ahead (the backend closes the previous assignment the day before), and cannot precede the assignment currently in force (`EmployeeShiftAction.tsx` docblock). History retained. Times display 12-hour AM/PM (client request noted in code) but the roster tab and the assignment drawer still show "09:00 – 18:00" 24h.
- OT multiplier is stored only; no payroll run applies it (HANDOFF §12).
- `attendance.shift_policies` is the authoritative shift/grace store — not `org.shifts` (useShiftPolicies.ts docblock).

### Gaps & plan  (keep / add / change)
- **Keep:** shift CRUD slide-over with server-bound validation, per-employee "Change shift" drawer with effective-dated scheduling, overtime review with note, month picker, company switcher.
- **Add:** [HANDOFF §10 E] "Once compensation rules are supplied, implement effective-dated policy and idempotent reviewed-overtime payroll posting or comp-off accrual"; [HANDOFF §12] "Overtime policy not supplied; no automatic overtime pay posting" — the UI copy already says so; design a clear "Recorded, not paid" state.
- **Add:** [HANDOFF §12 / STATUS limits] "Team roster is effective assignment display, not complete leave/holiday planning"; [PLAN §8] "Shift Roster — Target UI Mon–Sun roster grid … Cell → assign" — the current roster is a flat list of current assignments.
- **Add:** [code: `attendance/ShiftRequestApprovals.tsx` is exported but mounted nowhere] employee shift-change requests (GET /v1/shifts/change-requests/pending, POST …/{id}/decision) have a finished approval component but no home; employees file them at `/me/shift-change` (`modules/hrms/shifts/ShiftChangeRequest.tsx`). Give it a tab or block here.
- **Change:** the "Overtime Approvals" tab contains the **Shift Schedules** CRUD table first and the OT list second — split into three tabs ("Shift schedules", "Shift roster", "Overtime") or rename. Roster timings are 24h while schedules are AM/PM — unify. "Effective from" is raw `2026-09-01`. Delete uses `window.confirm` — use `useConfirmDialog()`. The per-row shift fetch (N requests per page) shows "Loading..." cells; design a skeleton. The roster tab needs `hrms.employee.read`, which DEPT_MANAGER lacks — the message is correct but the tab should be hidden or explain how to get access.

### Screenshot
`Attach: /hrms/shifts — current screen` (both tabs, plus the Add Shift slide-over and the Change employee shift drawer)

### Claude Design prompt (ready to paste)
```
Design the Shifts & Overtime page for HR (OWNER/SUPER_ADMIN/COMPANY_ADMIN/HR_MANAGER); managers with attendance.team.read get a view-only variant with the banner "View only — ask an admin or HR manager to add, edit, or remove shift schedules."
HrPageHeader: crumb "Attendance & Time", title "Shifts & Overtime", subtitle "Shift schedules and this month's overtime across the workforce", actions = company HrSelect (only when >1) + HrButton "Add Shift" (Plus icon).
KPI strip of 3 HrStatCard: Shifts Defined 4 (blue), Night Shifts 1 (green), Overtime (This Month) 37.5h (orange).
HrTabs (restructured): "Shift schedules" · "Shift roster" · "Overtime" · "Shift change requests".
Shift schedules: TableCard columns Shift ("General") · Timing ("09:00 AM – 06:00 PM") · Grace ("15 min") · Hours/Day ("8 h") · Type (HrStatusPill purple "Night" with moon icon, info "Fixed") · OT ("1.5× · recorded only") · row icon actions Edit / Delete (confirm via ConfirmDialog "Delete the shift 'General'? Employees still assigned to it must be moved to another shift first."). Empty "No shifts defined for this company yet."
Add/Edit Shift as HrDrawer (max-w-md): Shift Name *, Shift Type select, Start Time * / End Time *, Grace Period (minutes, 0–120, hint "Check-ins within this window are not marked Late."), Working Hours per Day (0.5–24), checkbox "Overtime applicable on this shift", Overtime Rate (1.0–9.99, hint "Stored as the configured rate — no payroll run applies it automatically yet."); footer Cancel / "Create Shift".
Shift roster: search "Search name or employee code"; TableCard columns Employee (HrAvatar "Priya Mehta" / EMP-0142) · Shift ("General" or gray pill "Unassigned") · Timings ("09:00 AM – 06:00 PM") · Effective from ("01 Sep 2026") · Action ghost "Change shift"; HrPagination 10/page. Drawer "Change employee shift": note "Choose the shift and the day it takes effect. The roster and attendance use the new shift from that day; earlier assignments stay in history.", current-shift box ("General · 09:00 AM – 06:00 PM · since 01 Sep 2026", plus "Scheduled: Night from 01 Oct 2026" when set), "New shift" select ("General · 09:00 AM – 06:00 PM"), "Effective from" date (default today, hint "Applies from today."), inline alert "The date cannot be before the current assignment started (01 Sep 2026).", footer Cancel / "Save shift" (becomes "Schedule shift change" for a future date).
Overtime: month input (Sep 2026); table Employee (link) · Date (18 Sep 2026) · Minutes (95) · Status (HrStatusPill Pending approval / Approved / Rejected) · Review (primary "Review" → inline or drawer decision: "Decision note" textarea, "Approve overtime", ghost "Reject overtime" (needs note), Cancel); below, "Overtime — September 2026" table Employee · Present Days · Overtime (2.5h). Banner text: "Approval records the decision; payroll disbursement is a separate workflow."
Shift change requests (currently unmounted): cards with HrAvatar + name link, date (18/09/2026), Current shift / Requested shift cells, "Reason: …", "Decision note (optional)", ghost "Reject" + primary "Approve change"; empty "No shift changes waiting for approval."
States: skeleton rows, "No overtime recorded this month.", per-row shift skeleton instead of "Loading...".
```

---

## Geofencing Zones  `/hrms/attendance/geofencing`
- **File:** modules/hrms/attendance/GeofenceZones.tsx (+ LocationMapPicker.tsx, lazy Leaflet)  ·  **Sidebar:** Attendance & Time › Geofencing  ·  **Roles:** sidebar `R_HR` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER); route guard `anyOf [org.geofence.write, attendance.team.read]` (App.tsx line 347); writes need `org.geofence.write`.
- **Status:** LIVE — `useGeofenceZones` → GET /v1/attendance/geofence/zones; create/update/delete → POST/PUT/DELETE /v1/attendance/geofence/zones[/{id}]; map picker via react-leaflet/OpenStreetMap.

### Purpose
HR/admins define the office locations (centre + radius) inside which staff may punch attendance from the mobile app, optionally tie each zone to a branch and department, and colour it. Managers with team-read can view the zones read-only.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Geofencing Zones", subtitle "Define office locations where staff can punch attendance from the mobile app."; `actions` = `HrButton` "Add Zone" (Plus icon; only `canWrite`).
2. Read-only banner (mint, MapPin icon) when `!canWrite`: "View only — ask an admin or HR manager to add, edit, or remove zones."
3. Zone card grid (1/2/3 columns) of `.ut-card` per zone: colour dot + **name** + `HrStatusPill` Active (ok) / Inactive (gray); detail rows: coordinates "17.38504, 78.48667" (Crosshair icon) · "{radius}m radius" (Radius icon) · "GPS + face" (MapPin icon) · "DEPT {name}" (when departmentId); footer (write only) text buttons "Edit" (pencil) · "Delete" (trash, red).
4. `EmptyState` (icon MapPin) "No geofencing zones yet" / "Add a zone to start tracking attendance locations." with action "Add Zone" for writers.
5. Slide-over **Add Zone / Edit Zone** (`ZoneFormModal`, custom fixed right panel max-w-md): Zone Name * ("e.g. Hyderabad HQ") · `LocationMapPicker` (260px Leaflet map, draggable pin + radius circle, two-way bound) · Latitude * / Longitude * (decimal inputs, placeholders 17.385044 / 78.486671) · link-button "Use my current location" (Crosshair) · Radius (meters) * (default 100) · Assign to Branch select ("None (company-wide)" + branches; hint "Employees assigned to this zone will be shown under this branch in the Workforce Directory.") · Assign to Department select ("None (company-wide)" + departments; hint "No departments available — add one from Departments first." when empty) · Punch Verification: read-only chips "GPS location", "Face recognition" + "Both are always required — employees must be inside the zone and pass a face check to punch." · Zone Color: 6 swatches (#0F6E56, #EF4444, #F59E0B, #3B82F6, #8B5CF6, #EC4899) with check on selected; footer "Cancel" + "Create Zone"/"Update Zone" (→ "Saving...", disabled without write).

### Data shown
- Zones → `useGeofenceZones()` (api/useGeofence.ts) → GET /v1/attendance/geofence/zones → `[{ id, companyId, branchId, departmentId, name, latitude, longitude, radiusMeters, punchMethod, colorHex, iconKey, active }]`.
- Branch / department options → `useCompanies`, `useBranches(companyId)`, `useDepartments(companyId)` (api/useOrg.ts) → GET /v1/hrms/companies, /branches, /departments (first company only).
- Department name on card → looked up from `useDepartments` map ("Assigned" fallback).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| "Add Zone" (Plus icon) | header actions | opens slide-over (new) | `org.geofence.write` | LIVE |
| "Add Zone" | `EmptyState` action | same | write | LIVE |
| "Retry" | error `EmptyState` | refetch zones | all | LIVE |
| "Edit" | zone card footer | opens slide-over with the zone | write | LIVE |
| "Delete" | zone card footer | `window.confirm('Deactivate "{name}"? This will remove it from active geofencing.')` → DELETE /v1/attendance/geofence/zones/{id}; toast "Zone deactivated" | write | LIVE |
| Map click / pin drag | slide-over map | writes latitude/longitude (6 dp) | write | LIVE |
| "Use my current location" | slide-over | `navigator.geolocation` → fills lat/lng, recentres map; toasts "Geolocation is not available in this browser" / "Could not get current location" | write | LIVE |
| Zone Name *, Latitude *, Longitude *, Radius *, Branch, Department, Zone Color | slide-over fields | form state | write | LIVE |
| Punch Verification chips | slide-over | read-only (intentionally non-editable — `punch_method` is stored but never read at check-in, comment lines 283–293) | — | DISABLED by design |
| "Create Zone" / "Update Zone" | slide-over footer | POST or PUT with `{name, latitude, longitude, radiusMeters, branchId?, departmentId?, punchMethod, colorHex, active:true}`; toasts "Zone created" / "Zone updated" | write | LIVE |
| "Cancel" / × / backdrop | slide-over | close | write | LIVE |

### States
- Loading → 3 `Skeleton` cards (h-40).
- Error → `EmptyState` (XCircle) "Failed to load zones" / "An error occurred while loading geofence zones." + Retry.
- Empty → `EmptyState` "No geofencing zones yet".
- Read-only → banner + no Add/Edit/Delete; slide-over submit disabled.
- Validation toasts: "Zone name is required", "Valid latitude and longitude are required", "Radius must be a positive number"; failure "Failed to save zone" / "Failed to delete zone" (or API message).
- Map lazy-load fallback: pulsing 260px placeholder.

### Rules & permissions
- Write gate `org.geofence.write` matches backend `@PreAuthorize` on POST/PUT/DELETE; read via `attendance.team.read`.
- Delete is a deactivation (soft); card shows Inactive pill for inactive zones returned by the API.
- Zones are always created with `punchMethod: FACE_RECOGNITION` (NOT NULL column); GPS + face are always both required at punch.
- Zone → branch link populates the employee's Branch in the Workforce Directory when HR leaves it blank (Anil doc-2 issue 1, code comment).
- Colour palette must stay identical to the mobile app's (comment lines 24–29).
- Company scope: first company only (`companies[0]`).

### Gaps & plan  (keep / add / change)
- **Keep:** card grid, map picker with two-way lat/lng binding, "Use my current location", branch/department assignment, colour swatches, honest read-only punch-verification chips.
- **Add:** [BLUEPRINT §11] "Geofencing — Keep (we exceed the reference)"; nothing new is mandated by the audit docs. [BLUEPRINT §6 row 15] "Weekly offs / punch zone — PUT /punch-zone — no UI — On employee Job tab" is the employee-side counterpart (assigning a person to a zone), which lives on the employee profile, not here.
- **Add:** [code: `GeoFenceZone.iconKey` never rendered or edited] optional icon per zone.
- **Change:** no search/filter across zones (fine at < 20, weak beyond); the card grid has no "how many employees are in this zone" figure; delete says "Deactivate" but the button reads "Delete" — align the wording; the confirm should use `useConfirmDialog()`; the branch name is not shown on the card (only department); multi-company tenants only see company 1's branches/departments in the form.

### Screenshot
`Attach: /hrms/attendance/geofencing — current screen` (grid + Add Zone slide-over)

### Claude Design prompt (ready to paste)
```
Design the Geofencing Zones page for HR (OWNER/SUPER_ADMIN/COMPANY_ADMIN/HR_MANAGER) with a read-only variant for managers (banner "View only — ask an admin or HR manager to add, edit, or remove zones.").
HrPageHeader: crumb "Attendance & Time", title "Geofencing Zones", subtitle "Define office locations where staff can punch attendance from the mobile app.", actions HrButton "Add Zone" (Plus icon); add a small search "Search zones…" and an Active/Inactive filter in a FilterBar.
Body: responsive 3-column grid of zone cards — colour dot + "Hyderabad HQ", HrStatusPill Active (ok) / Inactive (gray); rows "17.38504, 78.48667", "150m radius", "GPS + face", "Branch · Hyderabad", "Dept · Engineering"; new line "42 employees assigned"; footer ghost buttons "Edit" and danger-ghost "Deactivate".
EmptyState (MapPin) "No geofencing zones yet — Add a zone to start tracking attendance locations." with "Add Zone"; loading = 3 SkeletonCards; error EmptyState "Failed to load zones" with Retry.
Add/Edit Zone as HrDrawer (max-w-md): Zone Name * ("e.g. Hyderabad HQ"); 260px map with draggable pin and radius circle; Latitude * / Longitude * decimal inputs; link "Use my current location"; Radius (meters) * default 100; Assign to Branch select ("None (company-wide)", hint "Employees assigned to this zone will be shown under this branch in the Workforce Directory."); Assign to Department select; Punch Verification as two non-editable chips "GPS location" / "Face recognition" with "Both are always required — employees must be inside the zone and pass a face check to punch."; Zone Color = 6 swatches (#0F6E56 default, #EF4444, #F59E0B, #3B82F6, #8B5CF6, #EC4899); footer Cancel / "Create Zone" ("Update Zone" when editing; "Saving…" while pending).
Deactivate confirm via ConfirmDialog: 'Deactivate "Hyderabad HQ"? This will remove it from active geofencing.'
Keep Indian coordinates and the mint accent; do not invent a punch-method editor.
```

---

## Muster Roll  `/hrms/muster-roll`
- **File:** modules/hrms/attendance/MusterRoll.tsx  ·  **Sidebar:** Compliance › Muster Roll (not under Attendance & Time)  ·  **Roles:** sidebar `R_HR` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER); route guard `anyOf [attendance.team.read, hrms.employee.read]` (App.tsx line 445); export needs `hrms.report.attendance`.
- **Status:** LIVE — `useTeamDashboard(date, deptId)` → GET /v1/attendance/dashboard, `useAttendanceLogs(date, deptId)` → GET /v1/attendance/logs, CSV via `apiBlob` GET /v1/reports/attendance-summary/export.csv. "No mock data" (file comment).

### Purpose
The statutory daily attendance register. HR opens it for a given day (defaults to today, cannot go past today), sees the headcount split and every employee's status and punch times, filters by department, exports the day as CSV for an inspector, and jumps to Manual Entry for any row that needs a hand-entered punch.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Muster Roll", subtitle "Daily attendance register — every staff member's status and punch times for the selected day."; `actions` = `HrButton ghost` "Refresh" (spinning icon while fetching) + `HrButton` "Export CSV" (only `canExport`; → "Exporting…"; disabled with tooltip when no company).
2. Controls bar (`.ut-card ut-card-sm`): day stepper "‹" · `<input type="date">` (CalendarDays icon, `max=today`) · "›" (disabled on today) · "Today" link-button when not today; right side label "DEPARTMENT" + `<select>` "All departments" + options, or a dashed disabled chip "No departments available".
3. Caption line: "{EEEE, d MMMM yyyy} · {present+late+wfh} of {total} marked in".
4. KPI strip 4 × `HrStatCard` (lg:grid-cols-4, `loading`): "On Roster" (blue, sub "Staff in scope") · "Present" (green, sub "{wfh} WFH") · "Late" (orange, sub "{halfDay} half-day") · "Absent" (red, sub "{notMarked} not marked").
5. Charts row (only when total > 0), 2 × `.ut-card`: "Status Distribution" donut (Present, Late, Half Day, On Leave, WFH, Absent, Not Marked; legend with count + %) · "Headcount by Status" bar chart.
6. `TableCard` — `search` "Search name, code or department…"; `footer` "{n} of {total} staff shown" / "{n} punch events logged"; `DataTable` columns **Employee** (`HrAvatar` name / "EMP-0142 · Software Engineer") · **Department** · **Status** (`HrStatusPill`: Present ok, Late late, Half Day teal, On Leave purple, Work From Home blue, Absent red, Not Marked gray) · **Check In** (`hh:mm a`) · **Check Out** · **Location** · **Punches** (count from logs, right-aligned) · row icon button (ClipboardEdit) "Manual attendance entry for this employee". Sorted by name.
7. Callout chips (when > 0): purple "{n} on approved leave today" (Plane icon) · blue "{n} working from home" (Home icon).

### Data shown
- Register + counts → `useTeamDashboard(date, deptId)` → GET /v1/attendance/dashboard?date&departmentId (see Daily Tracking for row fields). A second unfiltered call `useTeamDashboard(date)` feeds the department option union.
- Punch counts → `useAttendanceLogs(date, deptId)` → GET /v1/attendance/logs?date&departmentId → `[{ eventId, employeeId, eventAt, eventType, attendanceStatus, locationName, zoneName, note }]`, counted per employee.
- Departments → `useCompanies` + `useDepartments(companies[0].id)` unioned with departments present on the roster (comment lines 110–140 explains why).
- Export → GET /v1/reports/attendance-summary/export.csv?companyId&from={date}&to={date} → file `muster-roll-{date}.csv`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| "Refresh" (ghost) | header | refetch dashboard + logs; toast "Muster roll refreshed"; disabled while the dashboard is fetching | all on route | LIVE |
| "Export CSV" | header | downloads CSV for the day; toast "Muster roll exported" or, with a department filter, "Exported — note the CSV covers all departments; the server export has no department filter"; error toast = API message or "Failed to export the muster roll" | `hrms.report.attendance` | LIVE |
| "‹ Previous day" / "› Next day" | controls bar | date ± 1 (next disabled on today) | all | LIVE |
| Date input | controls bar | set date (max today) | all | LIVE |
| "Today" | controls bar (when not today) | jump to today | all | LIVE |
| Department select | controls bar | server-side filter | all | LIVE |
| Search | `TableCard` | client filter on name / code / department | all | LIVE |
| Row icon "Manual attendance entry for this employee" | table row | `navigate('/hrms/attendance/manual-entry?employeeId=…&date=…')` | all on route (save itself needs `attendance.regularization.approve`) | LIVE |
| "Retry" (ghost sm) | table error block | refetch dashboard | all | LIVE |
| Donut / bar hover | charts | tooltip only | all | LIVE |

No row click / drawer on this page.

### States
- KPI `loading`; `DataTable loading`.
- Error → "Couldn't load the muster roll for this day." + Retry.
- Empty → "No attendance records for this day." (roster empty) or "No staff match your search."
- No departments readable → dashed chip "No departments available" with tooltip "No departments are readable for your role, or none have staff on this date."
- Export blocked → button disabled with tooltip "No company is visible to your role, so the register cannot be exported"; error toast "No company is visible to your role…".
- Charts hidden while loading or when total = 0.

### Rules & permissions
- Date cannot exceed today; defaults to the browser-local date (`format(new Date(), 'yyyy-MM-dd')`), not the IST `attendanceDate()` Daily Tracking uses. Register is per-day only (from = to = date on export).
- The page never reads `?date=` (no `useSearchParams` in MusterRoll.tsx) — the `/hrms/muster-roll?date=…` links from Manual Entry always land on today.
- Export is company-wide; the department filter is deliberately not sent (server has no param) and the toast says so.
- Export gated on `hrms.report.attendance` (matches `ReportController` `@perm.check`).
- Company scope: `companies[0]` for export and org departments; roster scope is the caller's team scope.

### Gaps & plan  (keep / add / change)
- **Keep:** [BLUEPRINT §6 row 43] "Muster Roll — Works — A — Keep". Day stepper, KPI strip, distribution charts, register table, CSV export with honest toasts, row jump to Manual Entry.
- **Add:** [HANDOFF §10 D / §12; STATUS limits] "Implement explicitly scoped muster exports using existing reporting services, with selected company/date range/fields and appropriate approval/access" — "Scoped automatic muster export remains open." Design a date-range + field-scoped export (currently one day, all fields, all departments).
- **Add:** [BLUEPRINT §19 Reports] "no attendance raw export" — the punch-event log (`useAttendanceLogs`) is only counted here, never shown; a "Punches" drill-down (drawer listing the day's events with eventType/time/zone) is evident from the data already fetched.
- **Change:** [code: no `useSearchParams` in MusterRoll.tsx] honour `?date=` so the Manual Entry round-trip ("Save Entry" → `/hrms/muster-roll?date=…`, "Back to muster roll") lands on the entered day instead of today; the page lives under **Compliance** in the sidebar but its crumb says "Attendance & Time" — pick one; row action is an unlabeled icon (add a visible "Manual entry" ghost button); "Refresh" toast on every click is noise; charts duplicate the KPI strip (keep one, or make chart slices filter the table like Daily Tracking tiles do).

### Screenshot
`Attach: /hrms/muster-roll — current screen`

### Claude Design prompt (ready to paste)
```
Design the Muster Roll page (statutory daily attendance register) for HR (OWNER/SUPER_ADMIN/COMPANY_ADMIN/HR_MANAGER).
HrPageHeader: crumb "Compliance" (align with the sidebar), title "Muster Roll", subtitle "Daily attendance register — every staff member's status and punch times for the selected day.", actions = ghost "Refresh" + primary "Export CSV" (opens a small Modal: date range From 01 Sep 2026 / To 18 Sep 2026, department "All departments", note "Server export covers all departments").
Controls card: day stepper ‹ [18 Sep 2026] › + "Today" link; right side "Department" HrSelect (All departments / Engineering / Sales); caption "Friday, 18 September 2026 · 151 of 162 marked in".
KPI strip 4 HrStatCard: On Roster 162 (blue, "Staff in scope"), Present 142 (green, "9 WFH"), Late 14 (orange, "3 half-day"), Absent 5 (red, "11 not marked").
Charts row: "Status Distribution" donut with legend counts and % · "Headcount by Status" bar; clicking a slice filters the table.
TableCard: search "Search name, code or department…"; DataTable columns Employee (HrAvatar "Priya Mehta" / "EMP-0142 · Software Engineer") · Department · Status (HrStatusPill Present ok / Late late / Half Day teal / On Leave purple / Work From Home blue / Absent red / Not Marked gray) · Check In (09:22 AM) · Check Out (06:31 PM) · Location ("Hyderabad HQ") · Punches (2, tabular-nums, click → HrDrawer "Punch events" listing 09:22 AM CHECK_IN · Hyderabad HQ, 06:31 PM CHECK_OUT) · row ghost button "Manual entry" → /hrms/attendance/manual-entry?employeeId=…&date=…; footer "142 of 162 staff shown · 284 punch events logged".
Callout chips below: purple "6 on approved leave today", blue "9 working from home".
States: skeleton KPIs + TableSkeleton, error "Couldn't load the muster roll for this day." + Retry, empty "No attendance records for this day.", disabled dashed chip "No departments available".
```

---

## Manual Attendance Entry  `/hrms/attendance/manual-entry`
- **File:** modules/hrms/attendance/ManualEntry.tsx  ·  **Sidebar:** not in sidebar / reached from Muster Roll row action (`?employeeId=&date=`) and the Muster Roll fallback link  ·  **Roles:** route guard `anyOf [attendance.regularization.approve, attendance.team.read]` (App.tsx line 458); Save requires `attendance.regularization.approve` (DEPT_MANAGER, HR).
- **Status:** LIVE — `useManualEntry` → POST /v1/attendance/manual-entry; picker via `useEmployeeDirectory` → GET /v1/hrms/employees with fallback `useTeamDashboard` → GET /v1/attendance/dashboard when the directory 403s.

### Purpose
An HR/admin/department manager punches on behalf of an employee for one past day (missed swipe, biometric downtime, first-day enrolment gap), with a mandatory reason that lands in the audit log, then returns to the muster roll for that day.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Attendance & Time", title "Manual Attendance Entry", subtitle "Punch on behalf of an employee for a specific day. All entries are audit-logged with your name and the reason you provide."; `actions` = `HrButton ghost` "Back" (ArrowLeft icon).
2. Form card (`.ut-card ut-card-lg`, max-w-3xl):
   - **Employee \*** — selected line "{name} · {code}" (UserPlus icon) when prefilled; search input "Search by name, code or email…" + a 6-row `<select size=6>` listbox "{name} · {code}"; or amber notice when the directory is unavailable and no one is selectable ("No employees available to select. … Open the muster roll and use the row action there…") / ("Employee pre-selected from the muster roll. Your role can't browse the full directory, but you can still save this entry."); grey note "Showing your team roster for {date} — your role can't browse the full employee directory." when on the fallback.
   - Red notice when `!canSaveEntry`: "You can view this form but your role can't record manual attendance (needs the "approve regularization" permission). Ask HR or an admin to save it."
   - 3-col row: **Date \*** (date, `max=today`, default today or `?date=`) · **Check-in** (time, default 09:00) · **Check-out** (time, default 18:00).
   - **Reason \*** textarea (rows 4, placeholder "e.g. Biometric downtime — employee was in office all day, verified via CCTV.") + hint "A short justification is stored on the record and shown in audit logs."
   - Amber notice when the selected employee is EXITED/TERMINATED: "This employee is exited. Backdated attendance is usually only valid before their last working day."
   - Footer: `HrButton ghost` "Cancel" · `HrButton primary` "Save Entry" (→ "Saving…"; disabled until valid).
3. Footer note: "Prefer the employee to submit a correction request themselves when they have proof. Manual entries here are for cases where the employee cannot file their own request (e.g. system downtime, missed enrolment on their first day). Back to muster roll".

### Data shown
- Employee picker → `useEmployeeDirectory({companyId, search (debounced 300 ms), pageSize:100})` (api/useWorkforce.ts) → GET /v1/hrms/employees → `{ id, employeeCode, firstName, middleName, lastName, email, employmentStatus }`.
- Fallback picker (directory 403) → `useTeamDashboard(date)` → GET /v1/attendance/dashboard → `staffStatuses[]` (employeeId, employeeCode, fullName), filtered client-side.
- Company → `useCompanies` (first company).
- Submit → `useManualEntry` → POST /v1/attendance/manual-entry `{ employeeId, attendanceDate, checkInAt?, checkOutAt?, reason }`; invalidates dashboard, logs, today.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| "Back" (ghost, ArrowLeft icon) | header | `navigate(-1)` | all on route | LIVE |
| Search by name, code or email… | form | debounced server search (or client filter on fallback) | all | LIVE |
| Employee listbox | form | sets `employeeId` | all | LIVE |
| "muster roll" (inline link-button) | no-employees notice | `navigate('/hrms/muster-roll?date=…')` | all | LIVE |
| Date *, Check-in, Check-out, Reason * | form | form state | all | LIVE |
| "Cancel" (ghost) | form footer | `navigate(-1)` | all | LIVE |
| "Save Entry" (submit) | form footer | validates check-out > check-in (toast "Check-out time must be after check-in time"); POST /v1/attendance/manual-entry; toast "Manual entry saved"; `navigate('/hrms/muster-roll?date={date}')` (Muster Roll currently ignores `?date=`); error toast "Failed to save manual entry" | `attendance.regularization.approve` (button disabled otherwise) | LIVE |
| "Back to muster roll" | footer note | `navigate('/hrms/muster-roll?date=…')` | all | LIVE |

### States
- Picker loading → `<option>Loading…</option>`; empty → disabled option "No employees match — try a different search".
- Directory 403 + team roster empty → amber "No employees available to select…" (or "Employee pre-selected from the muster roll…" when `?employeeId=` was passed).
- Fallback active → grey note "Showing your team roster for {date}…".
- No write permission → red notice; Save disabled.
- Exited/terminated employee → amber warning.
- Saving → "Saving…" and disabled.

### Rules & permissions
- Save enabled only when: `attendance.regularization.approve` AND employee AND date AND reason AND (check-in OR check-out) AND not pending.
- Date max today; check-out must be after check-in; times composed in the browser's local zone to ISO instants.
- Reason mandatory (audit trail). Every entry is logged with the actor's name.
- Directory read is `hrms.employee.read` (removed from DEPT_MANAGER by V112, code comment) → team-roster fallback keeps the page usable for the role it exists for.

### Gaps & plan  (keep / add / change)
- **Keep:** prefill from the muster roll, permission-honest Save, the exited-employee warning, the "prefer self correction" footer guidance.
- **Add:** [FUNCTIONALITY_AUDIT › Live module inventory row "/hrms/attendance, manual-entry…"] lists it as covered by "Existing attendance tests and smoke" — no product gap is recorded in the audit docs for this page. Evident in code: no view of the employee's **existing** record for that day before overwriting it (the form does not load `useEmployeeAttendanceRecords`, which exists in api/useAttendance.ts) — show "Current: Check-in 09:22 AM · no check-out" above the inputs.
- **Change:** [code: MusterRoll.tsx has no `useSearchParams`] the post-save redirect and both "muster roll" links pass `?date=` that the Muster Roll page ignores — the admin lands on today, not the entered day. The page is not reachable from the sidebar or from Daily Tracking — add an entry point (Daily Tracking header action or drawer button). The employee picker is a native `<select size=6>` listbox — replace with a searchable combobox showing `HrAvatar` rows. After save it navigates away; consider "Save & add another". `navigate(-1)` "Back" is unpredictable when the page is opened directly.

### Screenshot
`Attach: /hrms/attendance/manual-entry — current screen` (also with `?employeeId=…&date=…` prefill)

### Claude Design prompt (ready to paste)
```
Design the Manual Attendance Entry page for HR and department managers holding attendance.regularization.approve (view-only variant for attendance.team.read with the red notice "You can view this form but your role can't record manual attendance (needs the "approve regularization" permission). Ask HR or an admin to save it.").
HrPageHeader: crumb "Attendance & Time", title "Manual Attendance Entry", subtitle "Punch on behalf of an employee for a specific day. All entries are audit-logged with your name and the reason you provide.", actions ghost "Back" (ArrowLeft icon).
Single centred form card (max-w-3xl): Employee * as a searchable combobox ("Search by name, code or email…") listing HrAvatar rows "Priya Mehta · EMP-0142 · Engineering", with the chosen employee pinned above; new read-only strip "Current record for 18 Sep 2026: Check-in 09:22 AM · Check-out — · Status Not marked"; row of three fields Date * (18 Sep 2026, max today) · Check-in (09:00) · Check-out (18:00); Reason * textarea with placeholder "e.g. Biometric downtime — employee was in office all day, verified via CCTV." and hint "A short justification is stored on the record and shown in audit logs."; amber notice for exited employees; footer ghost "Cancel" + primary "Save Entry" ("Saving…").
Fallback notices to design: grey "Showing your team roster for 18 Sep 2026 — your role can't browse the full employee directory." and amber "No employees available to select… Open the muster roll and use the row action there."
Footer helper text with link "Back to muster roll". After save: toast "Manual entry saved" and return to /hrms/muster-roll?date=2026-09-18.
```

---

## Shift change requests (approval block)  `— no route —`
- **File:** modules/hrms/attendance/ShiftRequestApprovals.tsx  ·  **Sidebar:** not in sidebar / not mounted anywhere (grep across apps/ finds only its own definition)  ·  **Roles:** `attendance.regularization.approve` (`ShiftController` `@PreAuthorize` on GET /v1/shifts/change-requests/pending and POST …/{id}/decision, lines 122–130); name links and `useEmployeesByIds` need `hrms.employee.read`.
- **Status:** DEAD — complete component wired to `usePendingShiftRequests` → GET /v1/shifts/change-requests/pending (30 s polling) and `useDecideShiftRequest` → POST /v1/shifts/change-requests/{id}/decision `{approved, comment}`, but no page renders it. Employees can still file requests at `/me/shift-change` (`modules/hrms/shifts/ShiftChangeRequest.tsx`, route guard `[hrms.ess.read, attendance.checkin.self]`), so requests accumulate with no web approval surface.

### Purpose
HR/managers review employees' requests to move to a different shift and approve (assigns the requested shift from today) or reject with a note.

### Layout (map to the design-system parts)
`.ut-card` section "Shift change requests" + "Review employee requests. Approval assigns the requested shift from today."; list of `<article>` cards: `HrAvatar` (name from `useEmployeesByIds`, sub employeeCode or "Loading employee…" / "Employee details unavailable"; wrapped in a link to `/hrms/employees/{id}` when permitted, otherwise `HrAvatar` "Employee shift request" with the raw employeeId as sub) + `<time>` created date (en-IN); 2-cell box Current shift ("Not assigned" fallback) / Requested shift ("Shift details unavailable" fallback); "Reason: …" ("No reason provided" fallback); "Decision note (optional)" input + `HrButton ghost` "Reject" + `HrButton` "Approve change".

### Data shown
- `usePendingShiftRequests()` → `[{ id, employeeId, currentShiftPolicyId, currentShiftName, requestedShiftPolicyId, requestedShiftName, reason, status, createdAt, decisionNote }]`.
- `useEmployeesByIds(ids)` (api/useWorkforce.ts) for names/codes.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Employee link | card | `/hrms/employees/{id}` | `hrms.employee.read` | DEAD (unmounted) |
| Decision note (optional) | card | input, max 1000 | approver | DEAD |
| "Approve change" | card | POST decision `{approved:true}`; toast "Request approved and employee shift updated" | approver | DEAD |
| "Reject" (ghost) | card | POST decision `{approved:false}`; toast "Shift request rejected" | approver | DEAD |
| "Try again" | error | refetch | approver | DEAD |

### States
"Loading requests…" · "Could not load shift requests." + Try again · "No shift changes waiting for approval." · decision failure toast = API message or "Could not save the decision".

### Rules & permissions
Approval assigns the requested shift effective today (component copy). Decision endpoint invalidates `['shifts']` and `['hrms','attendance']`.

### Gaps & plan  (keep / add / change)
- **Keep:** the component as-is; it is finished.
- **Add:** [code: unmounted `ShiftRequestApprovals`] mount it as a tab on Shifts & Overtime (see that page's prompt) or in the manager approvals queue; [BLUEPRINT §22 Manager Experience / PLAN §17 "Manager adds"] "unified approvals inbox (leave + regularization + WFH + expense in ONE queue — currently scattered across four pages)" — shift requests belong in that queue too.
- **Change:** date shows `toLocaleDateString('en-IN')` ("18/9/2026") — use "18 Sep 2026".

### Screenshot
`Attach: — no route (component unmounted); screenshot /me/shift-change for the employee side if useful`

### Claude Design prompt (ready to paste)
```
Design a "Shift change requests" approval block for HR/managers, to sit as a tab on Shifts & Overtime (and reusable in a manager approvals inbox).
Card list: each request shows HrAvatar "Priya Mehta" / EMP-0142 (name links to the employee profile), submitted "18 Sep 2026"; two cells "Current shift: General · 09:00 AM – 06:00 PM" and "Requested shift: Night · 10:00 PM – 06:00 AM"; "Reason: Relocating to the night support rota from October"; "Decision note (optional)" input; footer ghost "Reject" + primary "Approve change"; decided cards show HrStatusPill Approved/Rejected and "Decision note: …".
Header copy: "Review employee requests. Approval assigns the requested shift from today."
States: "Loading requests…", error "Could not load shift requests." + Try again, EmptyState "No shift changes waiting for approval."
Add a badge count on the tab label (pending count, polled every 30 s).
```
