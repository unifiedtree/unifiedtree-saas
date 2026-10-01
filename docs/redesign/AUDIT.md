# HRMS redesign: merged audit and build plan

- **Written:** 27 Sep 2026, Phase 0 (read-only). Base: `main` at `e32a4dc6`.
- **Inputs, all read in full:** the handoff `README.md` and `CLAUDE_CODE_PROMPT.md`; `redesign/DECISIONS.md` (items 1–18, binding); `REDESIGN_RULES.md`; `PACKAGE_BRIEF.md`; the 15 area audits in `redesign/audit/` (shell, foundation, dashboard, workforce, attendance, leave-payrun, pay, talent, grow-reports, setup-admin, companies-profile, ess-1, ess-2, team, crosscut). The area audits hold the full per-field tables; this file merges them, removes duplicates and turns them into one plan. Where this file says "audit X §n", the detail is there.
- **Checked here as well (read-only):** routes in `App.tsx`, the rail and settings row in `PlatformShell.tsx`, the Master section model in `MasterDesign.tsx`, today's tab lists (`Leave.tsx`, `AttendancePage.tsx`, `Expense.tsx`, `FullAndFinal.tsx`), who imports the shared `design/dc` pieces, the backend controller layout, the latest migration (`V143_40`), and the three Phase 1 worktrees already in progress.
- **How to read it:** §1 maps every design screen and tab to today's code. §2 lists only what is missing or partial on each screen, with the item that fixes it. §3 is the one backend list (`BW-nn`). §4 is the shared kit and tokens. §5 records every decision (the user delegated them). §6 is the build plan (packages that can run in parallel without editing the same source files). §7 risks. §8 questions (none needed).

Status markers used in §1:
- **R**: restyle only. Every data point and action already has a real source; the page is recomposed from the kit.
- **W**: restyle plus small frontend wiring (a derivation, a gate fix, a new hook on an endpoint that exists).
- **B**: needs backend work first (the `BW` ids are listed; §3 has the detail).
- **N**: not built, by decision (§5 says why).

---

## 0. Summary

1. **Nothing is static today and every designed screen already has a live page.** The redesign is mostly re-layout on one shared kit, plus about 120 backend additions. Most of those are small read endpoints or extra fields; the larger new features are approval Undo, web check-in behind a company switch, breaks, the timesheet week, team views and the inbox, letter signing, asset confirmation, company KPIs and review-cycle dates.
2. **The menu and the Home rule are decided** (DECISIONS 11 and 12): the design's rail groups are a presentation layer over today's items; every URL, route guard and menu rule stays; Home is chosen by permission, and people without an admin home get the self-service Home at `/me`.
3. **Tab names and order stay as today** on every page (DECISIONS 11). A tab the design adds for a real new feature is added where the design puts it (for example Leave "All balances", Attendance "Timesheet" and "Punctuality"). Tabs the design only renames, merges or drops are not applied; the design's content is placed inside today's tabs.
4. **About 30 design elements are not built**, because they would change pay, balances, attendance counts or who can do what, need outside credentials, or have no design behind them (list in §5.15). The design's copy is adjusted so nothing on screen claims a feature that does not exist.
5. **Schema changes:** 16 migrations, `V143_50`–`V143_65`. Each adds only new tables, unmapped columns, constraints on JDBC tables or an index, all read and written with `JdbcTemplate`. No JPA-mapped column changes. Every new feature hides or empties its own block until production applies its migration (the `FEATURE_NOT_READY` convention, DECISIONS 18). Five new permissions, each granted to OWNER and SUPER_ADMIN.
6. **Build plan:**
   - Phase 1 has 9 packages; F1, F2a and F2b are already under way.
   - Phase 2 has 21 packages: 20 page packages plus search and notifications. Each owns a disjoint set of files and carries its own backend and pop-up work.
   - A package whose endpoints others need merges its backend half first (the `.be` milestone).
   - The machine limits (two heavy commands, one live-test slot) set the real pace.
7. **Biggest risks:** about 60 live scripts assert today's markup (each package updates the ones on its pages and keeps every behavioural check); hand-edited generated views would be overwritten by the old generators (F4 guards them); dark mode must pass on every page; migrations are applied by hand in production.

### Phase 1 packages already in progress (read from the worktrees)

| Package | Worktree / branch | State on 27 Sep |
|---|---|---|
| F1 theme, tokens, font | `ut-wt/rd-f1-theme`, `rd/f1-theme` | 3 commits (`25e9ddfb`, `4235b7e2`, `627c3a1e`), 71 files. Adds the `--u-*` tokens (light and dark), `src/design/theme/{tokens.css, base.css, dark-bridge.css, theme.ts, ThemeProvider.tsx, index.ts, theme.test.tsx}`, the no-flash script in `index.html`, one font, the weight clamp, and font, weight and colour edits in about 45 generated `design/dc/*.view.tsx` and 20 other files. Live test `live-rd-theme.mjs`. Agent still running. |
| F2a kit, display | `ut-wt/rd-f2a-kit-display`, `rd/f2a-kit-display` | 3 commits (`6ab88269` motion, `379f0abe` display kit, `317b24e6` theme-aware focus rings): PageHeader, PillTabs, SearchPill, StatCard + CountUp, QuickActionTile, AnimatedIcons, Card, Section + KeyValueGrid + MiniStat, ListRow + DateTile, StatusPill, Avatar, EmptyState + ErrorState, Skeleton, ProgressBar + StackedBar + Legend, Meter + BarList, Ring (progress, donut, geofence), MonthCalendar, SegmentedControl, FilterPills, Sparkline, `display.css`, `display.ts`, `src/design/theme/motion.*`. Not yet committed: Button, Callout, ColumnChart, Ledger, StepTrack, Table and a harness. Agent still running. |
| F2b kit, overlays and forms | `ut-wt/rd-f2b-kit-overlays`, `rd/f2b-kit-overlays` | 2 commits (`b1d742fa`, `47bc1f4d`): SidePanel (+ steps), Dialog, Popover, Menu, Dropdown, Toast, the FormField set, ApprovalRow, PanelButton, `overlays.css`; `HrDrawer`, ui-kit `Overlay.tsx` and `ConfirmDialog.tsx` rebuilt on them; the three toast hooks delegate to the kit Toast; a StrictMode unit harness (no new dependencies); live test `live-rd-f2b-overlays.mjs`. |
| Integration branch | `ut-wt/rd-int`, `rd/int` | At `e32a4dc6`; nothing merged yet |

---

## 1. Screen map

Every design screen and tab, the route and files today, the status, the permission keys that gate it today, and the package that builds it (§6). Permissions are quoted from `pageRegistry.ts` (menu and ⌘K), `App.tsx` (route guard) and `@PreAuthorize` (API); the area audit named in each block has the full per-card and per-action gates.

### 1.A Shell and homes (audit: shell, foundation)

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| A1 | Rail: groups, 72/248 px, hover and pin, overflow into More (`HrmsPlatform` aside, `hrms-core.js` GROUPS/RGROUPS) | every route in `PlatformShell` | `layouts/PlatformShell.tsx`, `design/shell/ShellChrome.tsx`, `shell.css`, `layouts/railLit.ts`, `shared/navigation/pageRegistry.ts`, `access.ts` | W | each item: `MENU_RULES[group:path]` / `MENU_RULES[path]` / registry entry via `menuRule()` + `accessState()`; self-service group hidden for OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN; business apps plan admins only | F3a |
| A2 | Pages panel and Pages button (`HrmsPlatform` L24–31) | multi-page modules | `PlatformShell` `sectionTabs`, `ShellChrome` `DesignSubNav` | W | module children through `isVisible()` | F3a |
| A3 | Top bar: outlined pill tabs, single pill, dashboard section pills, filter chip, search pill, bell (`HrmsPlatform` L29–42) | all | `ShellChrome` `DesignHeader`; page bars (`ModuleKit.Views`, `design/dc/SubTabs`, `AttendancePage`, `PayrollModule`, Master `TopTabs`, settings row) | W | each page's own tab rules (mirrored by registry `tab()` entries) | F3a |
| A4 | More panel: profile card, My space, overflow, Settings (Preferences, Help & support), Light/Dark, Sign out (`UtMore`) | `/profile`, `/me`, `/dashboard`, `/settings*`, `/modules` | none (today: profile menu + header gear) | B (BW-01) | signed in; overflow rows by their module rules; Preferences opens the first settings page the person can open | F3a (UI), F3b (BW-01) |
| A5 | ⌘K search: All · People · Pages · Actions, quick actions, Jump to, preview (`UtSearch`) | `GET /v1/search`, `GET /v1/search/global` | `shared/components/TopBarSearch.tsx`, `GlobalSearch.tsx`, `shared/search/*` | B (BW-02, BW-03, BW-04) | `/v1/search`: `hrms.employee.read`; `/v1/search/global`: signed in, then `GlobalSearchAccess` per record type; pages and actions by registry rules | F3b |
| A6 | Notifications popover (`HrmsPlatform` L40, L74) | `/v1/notifications*` | `PlatformShell` `ShellNotificationBell`, `core/notifications/notificationStore.ts`, `NotificationProvider.tsx` | B (BW-05) | signed in; own rows only | F3b |
| A7 | Homes: admin dashboard or self-service Home (`hrms-core.js` ROLES/LAND) | `/`, `/modules`, `/dashboard`, `/me`, `/team` | `App.tsx` (`RoleAwareLanding`), `modules/hrms/HrmsDashboard.tsx`, `shared/hooks/useRoles.ts` | W | today by role names (`useRoles().isEmployee`); new rule DECISIONS 12 (`adminHome` = anyOf `hrms.employee.read`, `payroll.runs.read`, `org.company.write`, `hrms.report.*`) | F3a |
| A8 | Mobile header and drawer (not designed) | all below `md` | `ShellChrome` `DesignMobileHeader`/`DesignMobileNav`, `TopBarSearch` sheet | W | same rules as the rail | F3a, F3b |
| A9 | Toast, backdrop, keyboard (`HrmsPlatform` L73, L77) | — | kit `Toast`, `SidePanel`, `Dialog` | R | — | F2b (done), F3a |

### 1.B Design system (audit: foundation)

| # | Design piece | Where it lands | Status | Package |
|---|---|---|---|---|
| B1 | `StyleGuide.dc.html` (reference only) | tokens in `design/theme/tokens.css` | N (not a page) | F1 |
| B2 | `UtStat`, `UtLive`, `UtAniIcon`, `UtQuick`, `UtEmpty`, `UtSection` kinds, `UtSections`, `hrms-fx.js` | `design/kit/*`, `design/theme/motion.*` | R | F2a, F2c |
| B3 | `UtQIcon` (icon-dock quick actions) | not used: the README default is the tile row (`saved-designs.md` is outdated) | N | — |
| B4 | `UtArt` (3D art slots) | dropped (DECISIONS 14) | N | — |
| B5 | `ReviewBoard.dc.html` (index of every screen for review), `SavedHeaderTiles.dc.html` (preview of a saved variant) | not pages | N | — |

### 1.C Admin dashboard `/dashboard` (audit: dashboard) — package P-DASH

| # | Design section (`PgDashboard` `data-sec`) | Repo files today | Status | Permissions today |
|---|---|---|---|---|
| C1 | Overview: greeting, date chip, Export headcount, Add employee | `modules/hrms/dashboard/AdminDashboardContainer.tsx`, `design/dc/AdminDashboard.*` (generated), `DashCalendar.*`, `dashboardDate.ts`, `headcountWorkbook.ts` | W | route signed in; export `hrms.report.headcount`; add `hrms.employee.write` |
| C2 | Overview: 8 live stat cards with sparklines | same + `StatTile.*`, `attendanceBuckets.ts` | B (BW-113) | total employees `hrms.employee.read`; the other 7 `attendance.team.read` |
| C3 | Overview: quick-action tiles, "Most used first", Customise | same | B (BW-112) | each tile: its target page's registry rule |
| C4 | Overview: seats strip | `SeatsTile.*`, `useSeats` | W | today a role list; new gate `workspace.billing.manage` |
| C5 | Overview: Needs your action (leave + WFH, corrections, attendance exceptions; approve, reject, Undo, Remind) | container + `useLeave`, `useAttendance`, `useAttendanceReview` | B (BW-06, BW-10) | `hrms.leave.approve.l1`, `attendance.regularization.approve`, `attendance.team.read`; exception detail `attendance.status.review` |
| C6 | Overview: Today's attendance list with filters | container | W | `attendance.team.read` |
| C7 | Attendance: weekly stacked bars with Off columns | `AreaChart.*`, `chart.ts` | W | `attendance.team.read` |
| C8 | Upcoming: company notices strip, notice panel, Add notice | `CompanyNoticeController` | B (BW-118) | read signed in (past day `org.company.read`); write `org.company.write` |
| C9 | Upcoming: milestones, probation (Extend, Confirm) | `MilestonesCard.*`, `milestoneRange.ts`, `milestones/UpcomingMilestones.tsx`, `probation/UpcomingProbations.tsx` | W | milestones signed in; retirements `hrms.employee.read`; probation `hrms.probation.reminders.read` + `hrms.employee.read`; actions `hrms.employee.write` |
| C10 | People: department bars, top performers, onboarding tracker | container | B (BW-114, BW-115) | `hrms.report.headcount` + `hrms.employee.read`; `hrms.performance.read`; `hrms.onboarding.instance.write` |
| C11 | Hiring & projects: funnel with conversion, projects rows | `ProjectProductivity.tsx` | B (BW-116, BW-117, BW-66) | `hrms.hiring.read`; `hrms.project.read` / `.write` |
| C12 | Payroll & activity: paid vs in-review bars, activity feed | container, `useActivity` | W | payroll module + `payroll.runs.read`; `audit.read` |
| C13 | Page frame: six section pills in the top bar, scroll-spy, `#section` | shell slot (F3a) | W | each pill follows its section's show flag |
| C14 | `PgDashboardV1` (superseded) | — | N | — |

### 1.D Workforce (audit: workforce, setup-admin §3) — packages P-WF-PEOPLE and P-WF-SETUP

Today's Master model (`MasterDesign.tsx` `NAV`): Workforce Directory = Employee Master · Contractor Master · Classification Rules; Organization Setup = Companies · Branches · Departments · Designations · Grades & Bands; Rules & Policies = Shift Rules · Leave Rules · Policy Documents; Payroll Configuration = Salary Components · Statutory Settings. These stay the pages' tab names and order (§5.1).

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| D1 | Master overview (`PgOrg` overview) | `/hrms/master` | `master/MasterContainer.tsx`, `design/master/MasterDesign.tsx` (generated), `masterData.ts` | B (BW-90, BW-104) | route anyOf the 10 `MASTER_ANY` codes; each block its own read; Remind `hrms.policy.write` | P-WF-SETUP |
| D2 | Workforce directory (`PgDirectory`): header pills = Employee Master · Contractor Master · Classification Rules; the design's status tabs become in-page status pills (All · Active · Probation · On notice · Exited · Suspended) | `/hrms/employees` (`?status`, `?q`, `?filter&from&to`, `?add=1`, `?companyId`) | `MasterContainer` / `MasterDesign.EmployeesPage` today; new page behind the seam `modules/hrms/workforce/DirectoryRoute.tsx` | B (BW-90, BW-96) | `RequirePermission` + `RouteGuard` `hrms.employee.read`; Add `hrms.employee.write`; Import `hrms.employee.import`; bulk shift `attendance.workforce.admin`; bulk letter `hrms.letters.distribute` | P-WF-PEOPLE |
| D3 | Add employee (`PgEmpForm`): Basic · Financial · (Access) · Review | `/hrms/employees?add=1`; edit mode `/hrms/employees/:id` "All fields…" | `employees/EmployeeForm.tsx`, `master/MasterAccessStep.tsx`, `rbac/components/AccessPicker.tsx`, `employees/InlineCreateModals.tsx` | B (BW-92, BW-94, BW-28) | `hrms.employee.write`; Access step `workspace.users.read` + (`workspace.users.manage` or `rbac.access.manage-overrides`); shift `attendance.workforce.admin`; invite `hrms.employee.invite` | P-WF-PEOPLE |
| D4 | Import (`PgEmpImport`): Download template · Upload & validate · Confirm | `/hrms/employees/import` | `employees/EmployeeImport.tsx`, `api/useBulkImport.ts` | B (BW-93, BW-94) | `hrms.employee.import` (route, registry, `@perm.check`) | P-WF-PEOPLE |
| D5 | Contractor Master (design: Org setup › Agencies) | `/hrms/master/contractors` | `MasterDesign.ContractorsPage` | R | `hrms.contractor.read` / `.write` | P-WF-SETUP |
| D6 | Classification Rules (no design) | `/hrms/master/classifications` | `MasterDesign` | R | `hrms.employee.read`; write `hrms.employment-type.write` | P-WF-SETUP |
| D7 | Organization setup (`PgOrg` setup): Companies · Branches · Departments · Designations · Grades & Bands | `/hrms/organization`, `/hrms/master/{companies,branches,departments,designations,grades}` | `MasterDesign` pages | B (BW-95) | route anyOf `hrms.department.write`, `hrms.branch.write`, `hrms.designation.write`; each tab its read; each write its code | P-WF-SETUP |
| D8 | Rules & policies (`PgSetup` m-rules). Authors: Shift Rules · Leave Rules · Policy Documents (+ a "Policies" pill to their own reading view). Everyone else (`Policies.tsx`): Policies · Shift Rules · Leave Rules · Manage | `/hrms/master/shift-rules`, `/hrms/master/leave-rules`, `/hrms/policies` (`?view=documents\|shifts\|leaves\|manage`) | `MasterDesign`, `modules/hrms/Policies.tsx`, `PoliciesRoute` in `App.tsx` | B (BW-104, BW-105, BW-33) | `m-shift-rules` any(`attendance.workforce.admin`, `hrms.policy.write`); `m-leave-rules` any(`leave.type.write`, `hrms.policy.write`); `policies` any(read, write, acknowledge.self); shift writes `attendance.workforce.admin` | P-WF-SETUP |
| D9 | Payroll configuration (not in the design): Salary Components · Statutory Settings | `/hrms/payroll/components`, `/hrms/master/statutory` | `MasterDesign` | R | `payroll.components.read` + payroll module; `payroll.settings.read` | P-WF-SETUP |

### 1.E Attendance and time (audit: attendance, ess-1 §5, grow-reports S4) — packages P-ATT-DAY and P-ATT-PLAN

Today's tabs (`AttendancePage.tsx`): Daily Tracking for HR = Daily Logs · Face Punch · Regularization · Review · My Attendance (staff: My Attendance · Regularization); Analytics = Overview · Calendar; Shifts & Overtime for HR = Shift Schedules · Roster · Overtime · Shift Requests (staff: My Shift).

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| E1 | Daily Logs = design "Today" (`PgAttendance`) | `/hrms/attendance?tab=team` (`&date`, `&status`) | `attendance/AttendanceContainer.tsx`, `design/dc/AttendancePage.*`, `AttDailyLogs.*`, `StatusChangeDrawer.tsx`, `attendanceBuckets.ts` | B (BW-13, BW-14, BW-17, BW-19, BW-10) | menu `attendance.team.read`; route anyOf `hrms.ess.read`, `hrms.employee.read`, `attendance.checkin.self`; data `attendance.team.read`; Change status `attendance.status.override`; export `hrms.report.attendance`; bulk mark `attendance.workforce.admin` | P-ATT-DAY |
| E2 | Face Punch (no design; kept) | `?tab=face` | `AttFacePunch.*` | R | `attendance.team.read` + `attendance.face.admin.read`; decisions `attendance.status.override` | P-ATT-DAY |
| E3 | Regularization, HR and self (self side in `EmpTime` fix-a-day) | `?tab=corrections` | `AttRegularization.*` | B (BW-06, BW-23) | decide `attendance.regularization.approve`; own `attendance.checkin.self` | P-ATT-DAY |
| E4 | Review (`PgTime` a-daily tab 1) | `?tab=review` | `attendance/ReviewList.tsx` | B (BW-14) | `attendance.team.read` + `attendance.status.review`; decisions `attendance.status.override` | P-ATT-DAY |
| E5 | My Attendance = `EmpTime` "This month" (month calendar, day detail, fix a day); also `PgGrow` me-att | `?tab=my` | `AttMine.*`, `ess/AttendanceHistory.tsx` | B (BW-15, BW-122, BW-55) | `attendance.checkin.self`; hidden for admin roles | P-ATT-DAY |
| E6 | Timesheet (`EmpTime` tab 1; new tab) | new `?tab=timesheet` (today a section of `/me`) | `ess/TimeEntries.tsx` | B (BW-36) | `attendance.checkin.self`; hidden for admin roles; approve: new `hrms.timesheet.approve` | P-ATT-DAY |
| E7 | Manual entry (`PgTime` a-daily tab 2; stays its own route) | `/hrms/attendance/manual-entry` | `attendance/ManualEntry.tsx` | B (BW-18) | route anyOf `attendance.regularization.approve`, `attendance.team.read`; save `attendance.workforce.admin` | P-ATT-DAY |
| E8 | Muster roll (`PgTime` cp-muster) | `/hrms/muster-roll` | `attendance/MusterRoll.tsx` | B (BW-19) | anyOf `attendance.team.read`, `hrms.employee.read`; data `attendance.team.read`; export `hrms.report.attendance` | P-ATT-DAY |
| E9 | Analytics · Overview | `/hrms/att-analytics?tab=overview&month=` | seam `attendance/AnalyticsRoute.tsx`; `AttOverview.*` | B (BW-20) | menu `attendance.team.read`; route anyOf `hrms.report.attendance`, `attendance.team.read` | P-ATT-PLAN |
| E10 | Analytics · Calendar (no design; kept) | `?tab=calendar` | `AttCalendar.*` | R | as E9 | P-ATT-PLAN |
| E11 | Analytics · Punctuality (new tab) | new `?tab=punctuality` | new | B (BW-21) | `attendance.team.read` (team-scoped) | P-ATT-PLAN |
| E12 | Shift Schedules = design "Shifts" | `/hrms/shifts?tab=schedules` | seam `attendance/ShiftsRoute.tsx`; `ShiftSchedules.*`, `shift-util.ts` | B (BW-32) | tab `attendance.team.read`; writes `attendance.workforce.admin` | P-ATT-PLAN |
| E13 | Roster = design "Rosters" (week grid) | `?tab=roster` | `ShiftRoster.*` | B (BW-22) | `attendance.team.read`; assign `attendance.workforce.admin` | P-ATT-PLAN |
| E14 | Overtime (+ design "Overtime rules" shown as a card here; editing lives in HR configuration) | `?tab=overtime` | `ShiftOvertime.*` | B (BW-29) | list `attendance.team.read`; decide `attendance.overtime.approve`; rules `attendance.policy.manage` | P-ATT-PLAN |
| E15 | Shift Requests = design "Change requests" | `?tab=requests` | `ShiftRequests.*` (hr) | B (BW-06) | `attendance.regularization.approve` | P-ATT-PLAN |
| E16 | My Shift (staff; same content as Shift change) | `?tab=myshift` | `ShiftRequests.*` (mine) | R | `attendance.checkin.self`, none of `attendance.team.read` | P-ATT-PLAN |

### 1.F Leave `/hrms/leave` (audit: leave-payrun A, ess-1 §7) — package P-LEAVE

Today's tabs (`Leave.tsx`): My leave · Apply · Balances (these three hidden for admin roles) · Approvals · Decided · Encash · Year end · Calendar · Leave types · Holidays.

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today |
|---|---|---|---|---|---|
| F1 | Approvals (`PgLeave`) | `?tab=approvals` | `Leave.tsx`, `api/useLeave.ts`, `api/useWfh.ts` | B (BW-37, BW-38, BW-39, BW-41, BW-42, BW-06, BW-43) | tab `hrms.leave.approve.l1`; WFH rows `wfh.approve`; decide `@perm.check('hrms.leave.approve.l1')` + `ApproverScopeGuard` (l2 = whole tenant) |
| F2 | Decided | `?tab=history` | `Leave.tsx` | B (BW-40, BW-38) | `hrms.leave.approve.l1` |
| F3 | All balances (design "Balances"; new key, because `balances` is the person's own) | new `?tab=all-balances` | new | B (BW-44) | new gate: `hrms.leave.employee.read` or `hrms.report.leave` |
| F4 | Calendar | `?tab=calendar` | `leave/LeaveCalendar.tsx`, `useLeaveCalendar.ts` | B (BW-39) | team `hrms.leave.approve.l1`; own `leave.balance.read` |
| F5 | Encash | `?tab=encash` | `leave/LeaveEncashment.tsx` | B (BW-45) | `hrms.leave.encash.approve`; own `leave.request.self` and not admin |
| F6 | Year end | `?tab=yearend` | `leave/LeaveYearEnd.tsx` | R | `hrms.leave.yearend.run` |
| F7 | Leave types | `?tab=types` | `leave/LeaveTypes.tsx` | R | read signed in; write `leave.type.write` |
| F8 | Holidays (admin and self) | `?tab=holidays` | `leave/HolidayCalendar.tsx` | B (BW-46) | read signed in; write `settings.holidays.write` |
| F9 | Self: Balances = `EmpLeave` Overview | `?tab=balances` | `Leave.tsx` Balances | B (BW-49, BW-38) | `leave.request.self`; hidden for admin roles |
| F10 | Self: Apply = `EmpLeave` Apply planner | `?tab=apply` | `Leave.tsx` Apply | B (BW-47, BW-48, BW-122) | `leave.request.self` |
| F11 | Self: My leave = `EmpLeave` Requests; also `PgGrow` me-leave | `?tab=my` | `Leave.tsx` MyLeave | B (BW-38) | `leave.request.self`, `leave.balance.read` |

### 1.G Pay (audit: pay, leave-payrun B, ess-2 §3.1–3.5) — packages P-PAY-CORE, P-PAY-EXTRA, P-EXP, P-MYPAY

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| G1 | Payroll dashboard (`PgPay` py-dash) | `/hrms/payroll-dashboard` (`/payroll` redirects) | `payroll/PayrollContainer.tsx`, `design/dc/PayDashboard.*` | B (BW-54, BW-53) | `payroll.runs.read` + payroll module; batches `hrms.disbursement.read`; filings `hrms.compliance.read` | P-PAY-CORE |
| G2 | Processing & payslips · All runs (`PgPay` py-runs tab 0) | `/hrms/payroll/runs` (`?month`) | `PayRuns.*`, `NewRunModal.*`, `ProcessPipeline.*` | R | `payroll.runs.read`; New run `payroll.runs.manage` | P-PAY-CORE |
| G3 | · Overview (`PgPayroll`) | `/hrms/payroll/runs/:id?tab=overview` | `PayrollRunPage.*`, `PayrollOverview.*`, `ProcessSteps.*` | B (BW-50, BW-51, BW-52, BW-53) | read `payroll.runs.read`; process `payroll.runs.manage`; lock/reopen `payroll.runs.lock`; bank file `hrms.disbursement.build` / `.post` | P-PAY-CORE |
| G4 | · Employees + payslip view | `?tab=employees` | `PayrollEmployees.*`, `PayslipDrawer.*` | B (BW-50, BW-51) | `payroll.runs.read` | P-PAY-CORE |
| G5 | · Skipped | `?tab=skipped` | `PayrollRunPage` | B (BW-50) | `payroll.runs.read` | P-PAY-CORE |
| G6 | Salary structure (views brk, struct, bulk) | `/hrms/salary-structure` (`?employee`) | `PaySalary.*` | B (BW-56) | route `payroll.runs.read`; data `payroll.structure.read`; `.manage`; `.bulk-revise` | P-PAY-CORE |
| G7 | Payroll settings | `/hrms/payroll/settings` | `PaySettings.*` | R | `payroll.settings.read` / `.update` | P-PAY-CORE |
| G8 | Bank disbursement · Current file · Past files · Bank profiles (the last opens `/setup`) | `/hrms/bank-disbursement` (`?run`), `/hrms/bank-disbursement/setup` | `PayBank.*`, `payroll/BankDisbursement.tsx`, `DisbursementHistory.tsx` | B (BW-57) | route `payroll.runs.read`; `hrms.disbursement.read/build/post`; `hrms.bank_profile.read/manage` | P-PAY-CORE |
| G9 | PLI · All awards · Monthly targets · My incentives (`PgPay` py-pli) | `/hrms/pli` | seam `payroll/PliRoute.tsx`; `PayPli.*`, `modules/hrms/Pli.tsx` | B (BW-63) | route any(`hrms.pli.read`, `.write`, `.read.self`); awards `hrms.pli.read`; targets `hrms.pli.target.read` or `hrms.pli.read`; self `hrms.pli.read.self` | P-PAY-EXTRA |
| G10 | Advances & loans · Approvals · My advances · Request an advance · Company advances (`PgPay` py-adv, `EmpClaims` e-adv) | `/hrms/advances?tab=` | seam `advance/AdvancesRoute.tsx`; `PayAdvances.*`, `Advance.tsx`, `advance/AdvanceAdmin.tsx` | B (BW-62) | route any of 5 advance codes; views by code | P-PAY-EXTRA |
| G11 | Full & final · Pending approval · Pending payment · Settled · All (+ Create) | `/hrms/fnf?tab=` (`&employeeId`) | `FullAndFinal.tsx` | B (BW-64) | any(`hrms.fnf.read`, `.process`, `.approve`); actions `@perm.check` | P-PAY-EXTRA |
| G12 | Expense center · Approvals · My claims · Submit a claim · Reimbursement batches · Policies (`PgPay` e-center, `EmpClaims` e-claims) | `/hrms/expenses?tab=` | `Expense.tsx`, `expense/ReimbursementBatches.tsx` | B (BW-60, BW-06) | route any of 6 expense codes; each tab its code | P-EXP |
| G13 | My payslips (`EmpPay` e-slips; `PgPay` me-slips is superseded) | `/me/payslips` | `payroll/EmployeePayslips.tsx` | B (BW-55, BW-59) | `payroll.payslip.read.self` + payroll module | P-MYPAY |
| G14 | My salary (`EmpPay` e-salary) | `/me/salary` | `payroll/MySalaryStructure.tsx` | B (BW-56) | `payroll.structure.read.self` | P-MYPAY |

### 1.H Talent (audit: talent, ess-2 §3.6–3.9) — packages P-HIRE and P-DOCS

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| H1 | Hiring · Pipeline · Requisitions · Interviews · Offers (`PgTalent` h-pipe) | `/hrms/hiring?tab=` (`&role`, `&stage`) | `Hiring.tsx`, `hiring/Interviews.tsx`, `OffersTab.tsx` | B (BW-65, BW-66, BW-67, BW-68) | nav any(`hrms.hiring.read`, `hrms.hiring.offer.read`); tabs by code | P-HIRE |
| H2 | Onboarding & assets · New hires · Assets · Checklist templates (today's order), wizard, record, template pages (`PgTalent` h-onb) | `/hrms/onboarding/instances?view=`, `/new`, `/:id`, `/hrms/onboarding`, `/templates/:id` | `onboarding/*` | B (BW-69, BW-70) | menu any(`instance.write`, `asset.read`, `template.read`); per view and action (audit talent §3) | P-HIRE |
| H3 | My interviews (no design) | `/me/interviews` | `hiring/Interviews.tsx` | R | `hrms.hiring.interview.self` or `hrms.hiring.read` | P-HIRE |
| H4 | Letters · Templates · Generated letters · Distributions · My letters (`PgTalent` h-letters) | `/hrms/letters/*` | `letters/*` | B (BW-71, BW-72, BW-73, BW-74, BW-76) | per `lettersView.letterViews` | P-DOCS |
| H5 | Employee vault · My documents · Employee documents · Letter templates (today's order) (`PgTalent` h-vault) | `/hrms/documents?view=` | `DocumentVault.tsx` | B (BW-77) | per view | P-DOCS |
| H6 | Docs to review (`PgTalent` h-docs) | `/hrms/documents/pending` (`/documents/pending`) | `pages/PendingDocuments.tsx` | B (BW-77) | `hrms.document.verify` | P-DOCS |
| H7 | My letters (`EmpDocs` e-letters) | `/hrms/letters/my` | `LettersHub`, `GeneratedLetters` | B (BW-71, BW-75, BW-76) | `hrms.letters.read.self` | P-DOCS |
| H8 | My documents (`EmpDocs` e-files) | `/hrms/documents?view=my` | `DocumentVault`, `pages/MyDocumentsCard.tsx` | B (BW-77) | `hrms.document.read.self`; upload `.write.self` | P-DOCS |
| H9 | My assets (`EmpDocs` e-assets) | `/me/assets` | `onboarding/MyAssets.tsx` | B (BW-70) | `hrms.onboarding.asset.self` | P-DOCS |
| H10 | Policies, self view (`EmpDocs` e-pol) | `/hrms/policies?view=documents` | `Policies.tsx` | B (BW-104, BW-105) | `hrms.policy.read` or `hrms.policy.acknowledge.self` | P-WF-SETUP |

### 1.I Growth and reports (audit: grow-reports, ess-2 §3.10–3.11, setup-admin §7) — packages P-GROW and P-REPORTS

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| I1 | Performance · Review cycles · Employee reviews · Goals & KPIs · People · My reviews · My goals (`PgGrow` p-center; `EmpGrowth` e-rev for the two "My" tabs) | `/hrms/performance?view=` | `Performance.tsx`, `performance/*` | B (BW-78 … BW-84) | admin tabs `hrms.performance.read`; own tabs `hrms.performance.review.self`; writes per audit grow §S1 | P-GROW |
| I2 | Per-person performance page (no design) | `/hrms/performance/employees/:id` | `EmployeePerformancePage.tsx` | R | `hrms.performance.read` | P-GROW |
| I3 | Learning · Programs · My training · Skill matrix · Certifications · Skill approvals (`PgGrow` p-learn; `EmpGrowth` e-learn) | `/hrms/learning?view=` | `Learning.tsx` | B (BW-85) | per view (audit grow §S2) | P-GROW |
| I4 | Program page (no design) | `/hrms/learning/programs/:id` | `learning/ProgramDetail.tsx` | R | `hrms.learning.read` / `.write` | P-GROW |
| I5 | Resignation & exit · On notice · Exited · Terminated (`PgGrow` x-res) | `/hrms/exit` (tab not in the URL today; `?tab=` added) | `exit/ExitCenter.tsx` | B (BW-90, BW-91, BW-64) | menu `hrms.employee.write`; route any(`hrms.employee.read`, `.write`) | P-GROW |
| I6 | Reports center (`PgReports`) | `/hrms/reports` | `reports/ReportsIndex.tsx`, `ReportSchedules.tsx`, `ReportKit.tsx` | B (BW-86, BW-87, BW-89) | any of the 5 report codes; schedules `hrms.report.schedule.manage` | P-REPORTS |
| I7 | Six report pages (no design) | `/hrms/reports/{headcount,attrition,diversity,attendance-summary,late-marks,leave-balance}` | `reports/*Report.tsx` | R | each its own code | P-REPORTS |
| I8 | Workforce analytics · Headcount · Attrition · Diversity (`PgSetup` r-wfa; one page today) | `/hrms/workforce-analytics` (`?tab=` added) | `analytics/WorkforceAnalytics.tsx`, `design/dc/WorkforceAnalytics.*` | B (BW-88) | any(headcount, attrition, diversity); each tab its code | P-REPORTS |

### 1.J Setup and admin (audit: setup-admin) — packages P-SETUP and P-ADMIN

Today's settings row (`PlatformShell` `SETTINGS_NAV`): Profile (→ `/profile`) · Branding · Security · Notifications · Billing & Plan · Integrations · Users & Access · Roles & Permissions · Audit Logs · Danger Zone.

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| J1 | Statutory compliance · Compliance calendar · Statutory filings · POSH register · Inspector access (`PgSetup` cp-stat) | `/hrms/compliance?view=` (+ public `/inspection`) | `Compliance.tsx`, `compliance/*` | B (BW-102, BW-103) | tabs `hrms.compliance.read`, `.posh`, `.inspector.read`; writes per audit setup §2.5 | P-SETUP |
| J2 | HR configuration (`PgSetup` hs-config) | `/hrms/settings` (+ `/work-time`) | `settings/HrConfigurationPage.tsx`, `design/settings/SettingsKit.tsx` | B (BW-106, BW-24, BW-29) | any(`settings.hrconfig.write`, `settings.read`, `hrms.probation.config.read`, `attendance.policy.manage`) | P-SETUP |
| J3 | Notification templates (`PgSetup` hs-notif) | `/hrms/notification-templates` | `NotificationTemplates.tsx` | B (BW-107) | `hrms.notiftemplate.read` / `.write` | P-SETUP |
| J4 | HR integrations (`PgSetup` hs-int) | `/hrms/integrations` | `Integrations.tsx` | B (BW-108) | `hrms.integration.read` / `.write` | P-SETUP |
| J5 | Settings: today's row + Document types (added after Integrations, which the design lists) (`PgAdmin` s-config) | `/settings`, `/settings/:tab`, `/settings/security`, `/settings/billing`, `/settings/danger` | `pages/Settings*.tsx`, `branding/*`, `NotificationChoices.tsx`, `workspaceSettingsApi.ts` | B (BW-109) | per tab (audit setup §8.9) | P-ADMIN |
| J6 | Users & access (`PgAdmin` s-users) | `/users` | `pages/Users.tsx`, `pages/users/*` | B (BW-110) | `workspace.users.read` / `.manage`; `rbac.access.manage-overrides` | P-ADMIN |
| J7 | Roles & permissions · Roles · Who has which role · Permission catalogue (`PgAdmin` s-roles) | `/roles?view=` | `pages/Roles.tsx` | B (BW-110) | `rbac.role.write` or `platform.admin` | P-ADMIN |
| J8 | Audit logs (`PgAdmin` s-audit) | `/audit-logs` | `pages/AuditLogs.tsx` | B (BW-111) | `audit.read` | P-ADMIN |
| J9 | `PgWorkspace` (legacy "My workspace", unreachable in the prototype) | — | — | N (Home `EmpHome` replaces it) | — | — |
| J10 | `PgGeneric` (frame for undesigned pages) → Coming soon pages | `ComingSoonRoute` paths | `shared/components/ComingSoon.tsx`, `ModuleComingSoon.tsx` | R | route: `ADMIN_ROLES`; menu: plan admins | P-ADMIN |

### 1.K Companies and profiles (audit: companies-profile) — packages P-COMP and P-PROFILE

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| K1 | Companies & branches main page (`PgCompanies` L11–70) | `/hrms/companies` (`/hrms/attendance/geofencing` redirects) | `organization/CompaniesPageContainer.tsx`, `design/dc/CompaniesPage.*` | W | menu and route `hrms.branch.read`; data `org.company.read`; writes `org.company.write`; boundary `org.geofence.write`; next ID `settings.read` or `hrms.employee.write`; ID format `settings.hrconfig.write` | P-COMP |
| K2 | Side panels: Create branch, Manage branch, Add company, Edit company (`PgCompanies` L71–98) | same | `BranchDrawer.*`, `CompanyDrawer.*`, `GeofenceMap.*` | W | as K1 | P-COMP |
| K3 | Employee profile, HR view · Overview · Personal · Job · Attendance · Payroll · Leave · Expenses · Documents · Letters · Performance · Exit (`PgProfile` + `PgProfileTabs`) | `/hrms/employees/:id?tab=` | `employees/EmployeeDetail.tsx`, `design/dc/EmployeeWorkspace.*`, `employees/workspace/*` | B (BW-16, BW-58, BW-96, BW-97, BW-101, BW-71, BW-77, BW-64, BW-43, BW-61) | route any(`hrms.employee.read`, `attendance.team.read`); record `hrms.employee.read`; tabs per audit companies-profile §3.17 | P-PROFILE |
| K4 | My profile · tabs by the person's own permissions + a Preferences tab (`PgProfile` self) | `/profile` (`?tab=` added) | `pages/Profile.tsx`, `DelegationCard.tsx`, `MyDocumentsCard.tsx` (import), `NotificationChoices.tsx` (import), `attendance/face/*` | B (BW-98, BW-99, BW-100) | signed in; each tab its self permission; Attendance hidden for admin roles | P-PROFILE |

### 1.L Self-service Home and My team (audit: ess-1, team) — packages P-HOME and P-TEAM

| # | Design screen · tab (prototype) | Route today | Repo files today | Status | Permissions today | Package |
|---|---|---|---|---|---|---|
| L1 | Home, employee (`EmpHome` role=employee) | `/me` (`/hrms/ess`); `/dashboard` redirects here for people without an admin home | `ess/EssDashboard.tsx` | B (BW-119, BW-120, BW-121, BW-122, BW-112, BW-24 … BW-27, BW-55) | route any(`hrms.ess.read`, `attendance.checkin.self`) + own employee record; never admin roles in the menu; each block its own permission | P-HOME |
| L2 | Home, manager team blocks (`EmpHome` role=manager) | `/me` | `EssDashboard.tsx` (today managers use the admin dashboard and `/team`) | B (BW-07, BW-09, BW-10, BW-11, BW-12, BW-06) | team blocks: any(`attendance.team.read`, `hrms.leave.approve.l1`) and not `hrms.employee.read` | P-HOME |
| L3 | Work from home (`EmpTime` e-wfh) | `/me/wfh` | `wfh/ApplyWfh.tsx`, `api/useWfh.ts` | B (BW-35, BW-122) | `wfh.request.self` | P-HOME |
| L4 | Shift change (`EmpTime` e-shift) | `/me/shift-change` | `shifts/ShiftChangeRequest.tsx` | B (BW-31, BW-32, BW-34) | any(`hrms.ess.read`, `attendance.checkin.self`) | P-HOME |
| L5 | Team today (`TeamToday`) | `/team` | `team/TeamDashboard.tsx` | B (BW-07, BW-10, BW-11, BW-13, BW-78) | route any(`attendance.team.read`, `hrms.leave.approve.l1`) (widened with the four approve codes); menu none of `hrms.employee.read` | P-TEAM |
| L6 | Team schedule (`TeamSchedule`; a panel of `/team` today) | new view `/team?view=schedule` | `team/TeamSchedule.tsx` | B (BW-08, BW-22) | `attendance.team.read` | P-TEAM |
| L7 | Approvals · All · Leave · Attendance · Requests · Expenses (`TeamApprovals`) | new view `/team?view=approvals&tab=` | new | B (BW-09, BW-06) | each tab its approve code; All = any | P-TEAM |


---

## 2. Data and actions: what is missing or partial on each screen

Only the gaps are listed. Every other data point and action on these screens already has a real source; the area audits list each one with its endpoint and permission.

In the Fix column:
- **BW-nn** is backend work (§3). The page shows nothing for that element (no sample value) until the work lands, and hides the block if the endpoint answers `FEATURE_NOT_READY`.
- **FE** is frontend-only work inside the page package.
- **N** means not built; §5.15 gives the reason.

### 2.A Shell and homes

| Screen | Missing or partial | Fix |
|---|---|---|
| A1 Rail | Groups, labels and order over today's items. The My work keys each get their own `MENU_RULES` entry (a copy of the ESS rule, including the admin-role exclusion) and join `railLit.SELF_SERVICE_RAIL`. Business apps for plan admins. 72/248 px expand on hover and focus, pin (`ut.rail.pinned`), overflow into More with a badge, last page per module (sessionStorage), "settings pages light More". | FE |
| A1 | The "UnifiedTree HRMS" sub-line and any vendor name are removed. | FE |
| A2 | Pages panel and Pages button. | FE |
| A3 | Page tabs move into the header through `HeaderTabs` (counts and `role=group` + `aria-pressed` kept). A single pill for pages without tabs; dashboard section pills; a filter chip for `?q=` ("On this page" only on pages that read `?q=`). | FE |
| A4 More | Profile card, My space, overflow, Settings → Preferences (the first settings page the person can open), Light/Dark, Sign out. | FE |
| A4 | Help & support: the workspace's admins to contact. | BW-01 |
| A5 ⌘K | One dialog: scope chips with counts, quick-action tiles, Jump to, preview. Records, Recent and "/" navigation are kept. | FE |
| A5 | Person preview: branch, manager, joining date, status. | BW-02 |
| A5 | Person preview: today's attendance (team scope only). | BW-03 |
| A5 | Holiday results. | BW-04 |
| A6 Notifications | Module label and icon per row; "Last 7 days". | BW-05 |
| A6 | Web routes and icons for the types the web ignores today (`EXPENSE_*`, `ADVANCE_*`, `OVERTIME_*`, `DOCUMENT_*`) and for the new types from C0. | FE |
| A6 | Events the backend never sends (payslip ready, payroll ready for review, probation ends soon, self-review due, team member not checked in, onboarding finished). | N (DECISIONS 13) |
| A7 Homes | Home chosen by permission, `/dashboard` → `/me` for everyone else, `RoleDashboard` no longer routed, `useHome()`. | FE |
| A8 Mobile | The drawer is the expanded rail plus More; the search icon opens the ⌘K dialog. | FE |

### 2.C Admin dashboard

| Section | Missing or partial | Fix |
|---|---|---|
| C1 | Add employee is disabled, with the reason, when seats are full. | FE |
| C2 | Total employees sparkline and "joined this month". | BW-113 |
| C2 | Deltas against yesterday; the late note with the real grace time. | FE |
| C3 | "Most used first" and Customise. | BW-112 |
| C3 | Each tile gated by its target page's registry rule. This fixes the Org setup and Add time-off mismatches. | FE |
| C4 | Seats gated by `workspace.billing.manage`, not role names. The strip shows at ≥ 90 % used; billing managers always see a compact seats line. | FE |
| C5 | Undo on approve and reject. | BW-06 |
| C5 | Remind. | BW-10 |
| C5 | Counts taken from the lists themselves, so counts and rows use one scope. A reason dialog on Reject wherever the server needs one. | FE |
| C8 | Notice event date. | BW-118 |
| C8 | Notice side panel with Edit, Archive (with its confirmation) and the pager. | FE |
| C8 | Notice audience. | N |
| C10 | Performers: average rating and reviews submitted. | BW-114 |
| C10 | Onboarding sub-line: department and joining date. | BW-115 |
| C11 | Hiring "this quarter" and reached-stage counts. | BW-116 |
| C11 | Exact funnel conversion, counted from the migration date. | BW-66 |
| C11 | Project owner, due date and health. | BW-117 |
| C12 | Payroll in-review bars and 12 months. | FE (from the runs list) |
| C13 | Section pills in the header, scroll-spy, `#section` links. | FE (F3a slot, then P-DASH) |
| — | Company summary content re-homed: active employees become the Total note, open roles the pipeline sub-line, finalized payroll the payroll headline, and compliance completion a compact line in Upcoming. | FE |

### 2.D Workforce

| Screen | Missing or partial | Fix |
|---|---|---|
| D1 Overview | Server counts: probation, suspended, joined and left this month, notice started in the last 7 days, probation reviews due next month, exits this year, attrition, a 7-point series. | BW-90 |
| D1 | "Needs attention" flags folded into the block rows ("2 without a head", "licence ends in 12 days"). | FE |
| D1 | Policy pending counts and owner name. | BW-104 |
| D2 Directory | Status pills with counts: All (default) · Active · Probation · On notice · Exited · Suspended. | BW-90 + FE |
| D2 | Word-by-word search (name, code, email, department, designation, branch); company filter; `?companyId=`; `?add=1`. | BW-96 + FE |
| D2 | "Suspended · since {date}". | BW-90 |
| D2 | "Paid through payroll" filter, taken from the employment type. | FE |
| D2 | Bulk Assign shift: a loop over today's assign endpoint, with a result per person. Bulk Send letter: opens `DistributionWizard` with the people filled in. | FE |
| D2 | Kept from today: the row ⋮ menu (View profile, Edit details, Start exit), bulk Change status, the milestone filter (`?filter&from&to`), the pager and the `?q=` box. | FE |
| D3 Add employee | Save draft and a drafts list. | BW-92 |
| D3 | Start onboarding. Opt-in: on by default when an active checklist exists. | BW-94 |
| D3 | "Anywhere (no geofence)". | BW-28 |
| D3 | Report To picker, bank-name suggestions. Branch stays required. The Access step becomes step 3 of 4, shown only to people with the rights. A future joining date is allowed. The salary hint text changes. | FE |
| D3 | Shift choice gated by `attendance.workforce.admin` (the wrong code is used today). | FE |
| D3 | Tell the reporting manager; alternate-Saturday weekly offs. | N |
| D4 Import | Rows created through the Add-employee path with the design's columns. This fixes the dropped department. Problems are returned per row, and the fix is "Upload the fixed file". | BW-93 |
| D4 | Start onboarding (off by default for imports). The company picker is kept. | BW-94 + FE |
| D7 Org setup | Department cost centre, and the head's name for viewers without the directory. | BW-95 |
| D8 Rules & policies | Policy audience count, pending count, owner name, "All" list. | BW-104 |
| D8 | "Accept by" date when publishing. | BW-105 |
| D8 | Default shifts come back after they are deleted. | BW-33 |
| D8 | Authors reach their own reading view at `?view=documents`. The shift tab uses the right permission code. Leave rules stay editable and gain an "Open leave types" link. | FE (route in F3a) |

### 2.E Attendance and time

| Screen | Missing or partial | Fix |
|---|---|---|
| E1 Daily Logs | Branch, check-in method, leave type and dates, and a pending-leave flag on each row. | BW-13 |
| E1 | Notify one person, Remind all. | BW-10 |
| E1 | Mark attendance for several people. | BW-17 |
| E1 | Export the day register. | BW-19 |
| E1 | Row ⋮ "Mark leave" (apply leave for someone). | BW-43 |
| E1 | Deltas against yesterday; the main shift in the sub-line. The Absent card keeps the client rule: "Not marked yet" until the day is over. | FE |
| E3 Regularization | Undo. | BW-06 |
| E3 | Approver name. | BW-23 |
| E3 | Approving a fix turns a WFH day into an office day (bug E28). | BW-30 |
| E4 Review | Branch or zone and the method on each item. | BW-14 |
| E4 | "Nth time this month", worked out by the client from a month range. Approve and Reject map to Excuse and Change status; Review has no Undo. | FE |
| E5 My Attendance | Per-day details (type, late minutes, in and out method, location, fixed), and leave days in the month stats. | BW-15 |
| E5 | "Explain the late mark" opens today's fix request with the check-in time prefilled (E25, option A). | FE |
| E5 | Who a fix goes to. | BW-122 |
| E5 | "Payroll is processed on {date}". | BW-55 |
| E6 Timesheet | Projects, Submit week, approval, and locking of submitted weeks. | BW-36 |
| E7 Manual entry | Status choice (Present, Half day, WFH, On duty, Absent). The API already takes these; Absent goes through review status. The Save button is gated by its real permission. | FE |
| E7 | Recent manual entries, and an entry in the audit log. | BW-18 |
| E8 Muster roll | "Download muster" is the day register. | BW-19 |
| E8 | Weekly-off count. | FE |
| E9 Analytics overview | Average arrival, by department and by branch, against last month. | BW-20 |
| E9 | "Target under 3 %". | N |
| E11 Punctuality | Late count, average delay, worst weekday, the previous period. | BW-21 |
| E12 Shifts | People per shift. | BW-32 |
| E13 Roster | Leave, weekly off and holiday for each day. | BW-22 |
| E14 Overtime | Company overtime rules, shown as a read-only card here and edited in HR configuration. | BW-29 |
| E14 | Off-day and holiday rates, payout, Undo. | N |
| E15 Shift Requests | Undo. | BW-06 |
| E15 | The "until" date range on each card. | BW-31 |
| E16 My Shift | Withdraw a request. | BW-34 |

### 2.F Leave

| Screen | Missing or partial | Fix |
|---|---|---|
| F1 Approvals | Stats: waiting and new in 24 h, approved this month with its series, on leave today and the next working day, average approval time. | BW-37 |
| F1 | Type code, half day, requester's balance, conflicts, decided by, approver. | BW-38 |
| F1 | "Who's off next week", "On leave today". | BW-39 |
| F1 | PENDING_L2 ("Awaiting HR") rows for level-2 approvers. | BW-41 |
| F1 | Approve all without conflicts. | BW-42 |
| F1 | Undo on leave and WFH rows. | BW-06 |
| F1 | Apply on behalf. | BW-43 |
| F2 Decided | Status filter and counts. | BW-40 |
| F3 All balances (new tab) | Everyone's balances and usage by type. | BW-44 |
| F4 Calendar | Date-range feed. | BW-39 |
| F5 Encash | "Can encash now N days". | BW-45 |
| F8 Holidays | Edit a holiday. | BW-46 |
| F8 | Branch "Applies to" counted in leave and attendance; optional-holiday booking. | N |
| F9 Balances (self) | Next credit, reset date, carry-forward cap. | BW-49 |
| F10 Apply | Exact preview: working days, balance after, approver, blocking reasons. | BW-48 |
| F10 | Colleagues off: first names, same department, approved leave only. | BW-47 |
| F10 | "Extra days unpaid". Beyond the balance is refused as today, and the real reason is shown. | N |
| F11 My leave | Approver names. | BW-38 |
| F11 | Cancelling leave doesn't refresh balances (bug E29). | FE |
| all | Company picker on Leave types, Holidays, Year end and Calendar (today `companies[0]`). | FE |
| all | Comp-off "as earned / expires". | N |

### 2.G Pay

| Screen | Missing or partial | Fix |
|---|---|---|
| G1 Payroll dashboard | Pending disbursals as an amount. | BW-54 |
| G1 | Employer cost and its trend. | BW-53 |
| G1 | Sums across several companies. | FE |
| G1 | Payslip questions waiting for an answer (the payroll team's side of "Ask payroll"). | BW-59 |
| G3 Run overview | Employee fields: department, branch, previous run and % change, new joiner, bank on file, F&F in progress. | BW-50 |
| G3 | "Checks before you lock". "Needs review" is derived from them. | BW-51 |
| G3 | Statutory dues with due dates. | BW-52 |
| G3 | Employer contributions and the paid date. | BW-53 |
| G3 | "Export register" before lock downloads today's CSV. The current-run rule. Each button gated by its own permission. | FE |
| G3 | On hold; TDS; overtime pay. | N |
| G4, G5 Employees, Skipped | Row fields and flags. | BW-50, BW-51 |
| G6 Salary structure | Summary tiles, a server-side list, and a "No structure" filter. | BW-56 |
| G6 | TDS regime choice. A read-only note is shown instead. | N |
| G7 Payroll settings | One date: "Payroll is processed on {date}". | FE (N for a separate pay day) |
| G8 Bank disbursement | Readiness before a file exists ("N of M", bank ••••1234, what to fix). | BW-57 |
| G8 | The Bank profiles pill opens `/setup`. | FE |
| G9 PLI | Totals, status filter, department; My incentives totals. | BW-63 |
| G9 | Pools pay from 85 %; rating basis as a type. | N |
| G10 Advances | Totals, Recovering and Repaid filters, department, the employee's own schedule, approver, bank reference and first month on disburse, ledger rows named by payroll month, plan preview. | BW-62 |
| G10 | My advances and Request for people who also hold `advance.read`. | FE |
| G10 | Advance limit. | N |
| G11 Full & final | Server status tabs, summary, department and exit status. | BW-64 |
| G11 | Suggested components. | N |
| G12 Expense center | My totals, department, policy check, category caps, approver, batch reference on my rows, status filter on approvals. | BW-60 |
| G12 | Undo. | BW-06 |
| G12 | Claim on behalf (from the profile). | BW-61 |
| G12 | Receipt OCR. | N |
| G12 | Copy says claims are paid through reimbursement batches. | FE |
| G13 My payslips | Paid date, pay date, total days, per-month notes, year to date, the month being prepared (no figures), next pay date, bank last 4. | BW-55 |
| G13 | Ask payroll. | BW-59 |
| G13 | Hide amounts (`ut.hideAmounts`). | FE |
| G14 My salary | Salary history with reasons. | BW-56 |

### 2.H Talent

| Screen | Missing or partial | Fix |
|---|---|---|
| H1 Hiring | Summary tiles. | BW-65 |
| H1 | Conversion rates and time to hire (exact from the migration date, "—" before it). | BW-66 |
| H1 | One-click offer email. | BW-67 |
| H1 | Interviews you took this quarter. | BW-68 |
| H1 | Pipeline defaults to Table, with a Board toggle. The board keeps drag and drop, Reject, Withdraw and the candidate drawer. Company choice. | FE |
| H1 | Start a candidate at a chosen stage. | N |
| H2 Onboarding | New-hire rows with name, department, joining date and checklist; counts; "Used by N hires"; asset holder names (only for callers with `hrms.employee.read`). | BW-69 |
| H2 | HR list of asset confirmations and reported problems. | BW-70 |
| H2 | Tasks due before joining (0 and negative offsets). The wizard's document list comes from document types. The wizard's assets are picked from the store (given on creation, dated today). | FE |
| H2 | IT access switches. | N |
| H4 Letters | Department, template name, who generated it, signed date, "signature asked". | BW-71 |
| H4 | Template name on distributions; recipients by branch. | BW-72 |
| H4 | "Send on" (scheduled). | BW-73 |
| H4 | Issue date. | BW-74 |
| H4 | "Ask for a signature". | BW-76 |
| H4 | Reason dialogs for Void and Reject. | FE |
| H5 Vault, H6 Docs to review | Counts; department and expiry in the queue; verified and rejected this week. | BW-77 |
| H7 My letters | Sent letters only; void letters shown as "Withdrawn". | BW-75 |
| H7 | Review and sign (click to accept); the letter body in the panel. | BW-76 |
| H8 My documents | Counts. | BW-77 |
| H8 | Self-upload (the hooks exist). | FE |
| H9 My assets | Confirm; Report a problem. | BW-70 |
| H10 Policies (self) | My summary, acknowledgement dates. | BW-104 |
| H10 | "Accept by". | BW-105 |

### 2.I Growth and reports

| Screen | Missing or partial | Fix |
|---|---|---|
| I1 Review cycles | Dates for each step. "Hold feedback until shared" (off by default) and Share. | BW-78 |
| I1 | Reviews and submitted counts per cycle, stages with counts, ratings so far. | BW-79 |
| I1 | Remind sends a real notification. | BW-80 |
| I1 | Employee reviews: status filter, department, reviewer type. | BW-81 |
| I1 | KPI summary; department on KPI rows; people status. | BW-82 |
| I1 | Company KPIs with goal links and roll-up (lower priority). | BW-83 |
| I1 | My reviews: the current cycle's steps, draft self-review, goal's last note, due date on my own goals. | BW-84 |
| I1 | "Kind words" from the strengths in submitted reviews. | FE |
| I1 | Rating scale per cycle and a "who reviews" preset. Calibration is a label only. | N |
| I3 Learning | Programs summary, location, category list, department on roster rows, program dates on My training, company certifications list, skill "updated" date, certification name on proposals. | BW-85 |
| I3 | Five skill words. A skill rejection needs a note. "Worth your time". | FE |
| I3 | Course-style learning (required, progress, duration). | N |
| I5 Resignation & exit | Tabs in the URL. | FE (+ F3a registry) |
| I5 | Exit reason (for `hrms.employee.write` holders) and department. | BW-91 |
| I5 | Exited this year. | BW-90 |
| I5 | F&F status per leaver. | BW-64 |
| I6 Reports center | Hero numbers with deltas; diversity as of a date. | BW-86 |
| I6 | Mini charts on the tiles. | BW-87 |
| I6 | Schedules: daily, weekdays, send time, CSV attachment. | BW-89 |
| I6 | "Live" instead of "Updated N ago". | FE |
| I6 | Pins; a custom report builder. | N |
| I8 Workforce analytics | Three tabs in the URL, headcount trend, fiscal-year period. | BW-88 + FE |

### 2.J Setup and admin

| Screen | Missing or partial | Fix |
|---|---|---|
| J1 Compliance | Summary counts, status filters, filed date, LWF and TDS 24Q filing types, the date an inspection document was shared. | BW-102 |
| J1 | POSH case department. | BW-103 |
| J1 | FilingCalendar moves to the shared calendar. | FE |
| J1 | A "Closed" POSH status. | N |
| J2 HR configuration | Probation reminder recipients. | BW-106 |
| J2 | "Allow web check-in" switch (off by default). | BW-24 |
| J2 | Overtime rules section. | BW-29 |
| J3 Notification templates | Channel filter and counts. | BW-107 |
| J4 HR integrations | Counts and "needs attention". | BW-108 |
| J4 | Workspace apps (Slack, Teams, Google). | N |
| J5 Settings | A Document types pill after Integrations. | FE (F3a registry + P-ADMIN) |
| J5 | Password last changed. | BW-109 |
| J5 | Session "where" shows the IP address. | FE |
| J5 | Invoices, payment method. | N |
| J6 Users & access | Role granted date and by whom; invite message. | BW-110 |
| J6 | Module access shown read-only. | FE |
| J7 Roles | Permission and holder counts. | BW-110 |
| J8 Audit logs | Sign-in events and category filters. | BW-111 |

### 2.K Companies and profiles

| Screen | Missing or partial | Fix |
|---|---|---|
| K1–K2 Companies | These are all frontend: the per-branch check-in switch gets copy that says exactly what it does; the next employee ID uses the existing hook; the ID-format editor is gated by `settings.hrconfig.write`; "No branch · N"; the full state list; radius slider plus number field (25–5,000 m); a blank branch code shows "None"; the Inactive view and Restore are kept; industry becomes a combobox. | FE |
| K3 Profile (HR view) | Month calendar for one employee. | BW-16 |
| K3 | Payslip list. | BW-58 |
| K3 | Direct reports. | BW-96 |
| K3 | A manager opens a direct report's profile (masked). | BW-97 |
| K3 | Last sign-in device. | BW-100 |
| K3 | Document counts. | BW-77 |
| K3 | Apply leave on behalf. | BW-43 |
| K3 | New claim on behalf. | BW-61 |
| K3 | F&F state. | BW-64 |
| K3 | Letter signed date. | BW-71 |
| K3 | Nominee shares must add up to 100 % or less. | BW-101 |
| K3 | Lifecycle actions follow the status (2-up row plus a More actions menu); banner asset with a dark-mode overlay. | FE |
| K4 My profile | My own workforce record: probation, notice, manager. | BW-98 |
| K4 | Read my own personal sections. | BW-99 |
| K4 | A Preferences tab keeping the `#st-…` anchors. An admin's own profile has no Attendance tab. | FE |
| K4 | Self-edit of names, city and emergency contacts. | N (self-edit as today) |

### 2.L Home and My team

| Screen | Missing or partial | Fix |
|---|---|---|
| L1 Home | "Your day" in one call. | BW-27 |
| L1 | Check in and out on the web (company switch, off by default). | BW-24 |
| L1 | Undo check-out within 10 minutes. | BW-25 |
| L1 | Breaks. | BW-26 |
| L1 | My requests. | BW-119 |
| L1 | Needs you, and its count in the greeting. | BW-120 |
| L1 | Around you. | BW-121 (+ BW-118 event dates, BW-12 team messages) |
| L1 | Next payday. | BW-55 |
| L1 | Customise quick actions (`surface=home`). | BW-112 |
| L1 | Hide amounts. WFH "N days this month" from the person's own WFH list. | FE |
| L2 Home, manager blocks | Team summary. | BW-07 |
| L2 | Waiting for you, with Undo. | BW-09, BW-06 |
| L2 | Remind. | BW-10 |
| L2 | Probation dates; Confirm and Extend only with `hrms.probation.team.decide`. | BW-11 |
| L2 | Message team. | BW-12 |
| L3 Work from home | Approver name; several separate days in one send. | BW-35 |
| L3 | Who it goes to, before sending. | BW-122 |
| L3 | Allowance "of 6". | N |
| L4 Shift change | "Until" date. | BW-31 |
| L4 | People per shift. | BW-32 |
| L4 | Withdraw. | BW-34 |
| L5 Team today | Team summary; method and leave type on the roster; reminders; probation; review due dates. | BW-07, BW-13, BW-10, BW-11, BW-78 |
| L5 | A "thin" day is under half the team. The half-day tile shows only when non-zero. The greeting moves to Home. | FE |
| L6 Team schedule | Team time off. | BW-08 |
| L6 | Weekly off and holiday for each day. | BW-22 |
| L7 Approvals | Inbox read model with counts, warnings, and `canDecide` (false where the person can see but not decide). | BW-09 |
| L7 | Undo. | BW-06 |
| L7 | Submitted timesheet weeks (under Requests; lower priority). | BW-36 |
| L7 | "Approve N with no warnings": leave uses the bulk endpoint; other kinds loop over their decide endpoints and report partial failures. | BW-42 + FE |

---

## 3. Backend work: one deduplicated list

122 items, BW-01 to BW-122. Each item is built by the page package that owns its backend files (§6). The block headings below name that package. Items asked for by several audits appear once; the table in §3.4 lists where the duplicates came from.

### 3.1 Rules every item follows

These come from DECISIONS 2 and 18 and from crosscut §9.

1. **Where code goes.**
   - Controllers go in `backend/app/hrms-api/src/main/java/com/hrms/api/<area>/`.
   - Paths are `/v1/...` under the `/api` servlet context.
   - The templates to copy are commit `fa5c37d9` "Assisted face punch" (controller, service, JDBC recorder, scope class, test, migration V143_40), `V143_22` for column additions and `V143_33` for permissions.
2. **Guards.**
   - Every endpoint has `@PreAuthorize`.
   - Use `hasAuthority` for reads. Use `@perm.check` for approvals and money actions: it reads the database and takes effect without a new token.
   - Personal endpoints use `isAuthenticated()` and take the person's identity from the token only.
   - Team reads use `TeamEmployeeScope`. Every decision path calls `ApproverScopeGuard`, which is not widened. Self-approval guards stay in the services.
3. **Schema.**
   - No `@Entity` mapping changes.
   - New tables and columns are read and written with `JdbcTemplate` only.
   - A new column on a JPA-mapped table must be nullable or defaulted, and unmapped. Where the table is JPA-mapped, a side table is preferred.
   - Each JDBC write runs inside `@Transactional`, and every SQL statement also filters `tenant_id = ?`.
   - Where two people may act at once, take `pg_advisory_xact_lock`.
4. **Migrations.**
   - File: `backend/app/hrms-app/src/main/resources/db/canonical/V143_<n>__<snake>.sql`, using only the number assigned in §3.2.
   - Idempotent: `IF NOT EXISTS` and `ON CONFLICT DO NOTHING`.
   - For each new tenant table: `tenant_id` comes first in the primary key and indexes; `ENABLE` and `FORCE ROW LEVEL SECURITY`, with a policy on `current_tenant_id()`; `COMMENT ON`; grants to `ut_app` inside `IF EXISTS (… 'ut_app')`.
   - The header comment says the file is JDBC-only, idempotent, and applied by hand in production as a superuser.
   - Do not use the startup "schema bootstrap" pattern.
5. **Permissions.**
   - Insert into `rbac.permissions` with a plain-English name and description; set `risk_level` guarded as in V143_33.
   - Grant to **OWNER and SUPER_ADMIN always**, plus the roles named here.
   - Add the constant to `packages/sdk/src/permissions/codes.ts`. C0 adds all five up front.
   - Live tests sign in again after a grant, because `hasAuthority` reads the token.
6. **Degradation (FEATURE_NOT_READY).**
   - A service that touches a new table or column catches `BadSqlGrammarException` with SQL state 42P01 or 42703. It throws `HrmsException("This isn’t switched on yet.", SERVICE_UNAVAILABLE, "FEATURE_NOT_READY")` through C0's helper.
   - A service that only adds optional fields leaves them null instead of failing the whole response.
   - The web shows that block's empty or "not available yet" state, hides its actions, and does not retry.
   - Existing endpoints keep their old behaviour; new parameters are optional.
7. **API shape.** Response changes are additive only, because the mobile app reads many of these DTOs. Error bodies stay `{timestamp, status, errorCode, message}`, with plain-English messages and UPPER_SNAKE codes.
8. **Audit and notify.**
   - Every write that changes someone else's data calls `AuditService.record(module, ACTION, entityType, entityId, summary)` inside try/catch.
   - Notifications go through `AppNotificationService`, using the types C0 adds, and respect each person's preferences.
9. **Tests.**
   - Unit tests next to the code (JUnit + Mockito, as `AssistedPunchScopeTest` does), including permission, scope and missing-table cases.
   - An API step in the package's live test, including one step that renames the new table in `ut_w3_dev`, expects `FEATURE_NOT_READY`, then renames it back.
   - Builds and tests run through `heavy.sh` with JDK 21.

### 3.2 Migration numbers (assigned by the lead)

V143_41–49 are left for the teammate's work on `main`. V143_66–69 are reserved.

| Version | Package | Contents | New permissions |
|---|---|---|---|
| V143_50 | P-TEAM | `hrms.approval_decisions` (Undo journal) | — |
| V143_51 | P-DASH | `hrms.user_dashboard_prefs`; `hrms.projects.owner_employee_id`, `due_date`; `hrms.company_notices.event_date` | — |
| V143_52 | P-WF-PEOPLE | `hrms.employee_drafts`; `hrms.department_cost_centres` | — |
| V143_53 | P-ATT-DAY | `settings.hr_configuration.allow_web_punch` (unmapped, default false); `WEB` added to `ck_attendance_records_check_in_method` / `_check_out_method`; `hrms.employee_punch_rules` | — |
| V143_54 | P-ATT-PLAN | `attendance.shift_change_requests.requested_end_date`; `attendance.overtime_rules` | — |
| V143_55 | P-TEAM | `hrms.team_messages`, `hrms.team_message_recipients` | `hrms.probation.team.decide` (OWNER, SUPER_ADMIN); `hrms.team.message` (OWNER, SUPER_ADMIN, DEPT_MANAGER, MANAGER) |
| V143_56 | P-LEAVE | index `leave_mgmt.leave_requests (tenant_id, start_date, end_date)` | `hrms.leave.apply.others` (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD: the same roles as `hrms.advance.request.others` today) |
| V143_57 | P-EXP | — | `hrms.expense.claim.others` (same roles as above) |
| V143_58 | P-PAY-CORE | `payroll.payslip_queries` | — |
| V143_59 | P-HIRE | `hiring_mgmt.candidate_stage_events`; `hiring_mgmt.offer_candidate_emails`; `hrms.asset_confirmations` (backfilled); `hrms.asset_issue_reports` | — |
| V143_60 | P-DOCS | `letters.letter_signatures`; `letters.distribution_schedules` | — |
| V143_61 | P-GROW | `performance_mgmt.review_cycle_milestones`; `performance_mgmt.company_kpis`; `performance_mgmt.goal_kpi_links`; `learning_mgmt.program_locations`; `learning_mgmt.skill_assessments.certification_name` | — |
| V143_62 | P-REPORTS | `hrms.report_schedules`: frequency and day constraints replaced (adds DAILY, WEEKDAYS); `send_hour SMALLINT NULL` | — |
| V143_63 | P-SETUP | `compliance_mgmt.posh_complaint_departments` | — |
| V143_64 | P-WF-SETUP | `policy_mgmt.policy_ack_deadlines` | — |
| V143_65 | P-ATT-DAY | `hrms.time_entries.project_id`; `hrms.projects.code`; `hrms.timesheet_weeks` | `hrms.timesheet.approve` (OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER) |

Five new permissions in all. Every one goes to OWNER and SUPER_ADMIN, so `OwnerPermissionInvariantCheck` passes. No JPA-mapped column is changed. Letter signing uses the existing `hrms.letters.read.self`, and Ask payroll's team side uses the existing `payroll.runs.manage`.

### 3.3 The items

Size: S up to half a day, M about a day, L several days.

#### F3b: search, notifications, help (backend files: `workforce/SearchController.java`, `workforce/search/**`, `notification/NotificationController.java`, `platform-notifications/.../dto/NotificationDtos.java` and the notification list query, new `me/AdminContactsController.java`)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-01 | Help & support contacts | `GET /v1/workspace/admin-contacts` (`isAuthenticated()`). JDBC over `rbac.user_roles`, `rbac.role_permissions`, the per-person grants, `auth.user_credentials` and `hrms.employees`. Returns the active people whose access includes `workspace.users.manage` or `rbac.role.write`: display name, work email, role label, owners first, at most 10. No vendor contact. | no | S | A4 |
| BW-02 | Person facts in the ⌘K preview | `GET /v1/search/people/facts?ids=` (`hrms.employee.read`; at most 20 ids; the same visibility as `/v1/search`) → `branchName`, `managerName`, `dateOfJoining`, `employmentStatus`. A new JDBC query in the search package. `WorkforceEmployeeService` and its DTO are not touched. | no | S | A5 |
| BW-03 | Today's status in the preview | The facts response adds `today` (the same fields as a `StaffStatusResponse` row) only when the caller holds `attendance.team.read` and the person is in the caller's `TeamEmployeeScope`. The web maps it with the unchanged `attendanceBuckets`, so the rule is the same everywhere. | no | M | A5 |
| BW-04 | Holiday results | `SearchType.HOLIDAY` in `GlobalSearchService`/`GlobalSearchQueries` over `settings.holiday_calendar`, company-scoped, this year and next, for anyone signed in. | no | S | A5 |
| BW-05 | Notification group and "Last 7 days" | `group` on `NotificationDto` (from `NotificationEventCatalog.forType(type).group()`); optional `since` on `GET /v1/notifications`. | no | S | A6 |

#### P-TEAM: Undo, team read models, reminders, probation, messages (backend files: new `approvals/**`, new `team/**`, new `attendance/AttendanceReminderController.java` + service, the `/v1/team` entry in `saasguard/TenantModuleGuard.java`; migrations V143_50, V143_55)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-06 | Approval Undo (one mechanism for leave, WFH, attendance fix, shift change, expense) | **The design is team.md §6.3.** **Journal:** `hrms.approval_decisions` (kind, request, requester, decision, decided by, `decided_at`, `undo_until` = +10 min, `prior_state` jsonb, `post_version`, note, `undone_at`/by). **Recording:** a `DecisionJournal` `@Around` aspect on the service methods the five decide endpoints call (`/v1/leave/{id}/decision`, `/l1-decision`, `/l2-decision`; `/v1/wfh/{id}/approve`, `/reject`; `/v1/attendance/corrections/{id}/decision`; `/v1/shifts/change-requests/{id}/decision`; `/v1/expense/claims/{id}/decision`), so web, mobile, bulk and inbox decisions are all recorded without editing those files. It opens the transaction, locks the request row, reads the prior state, proceeds, and inserts the journal row. It skips journaling when `to_regclass` says the table is missing. A unit test fails if a pointcut stops matching its method. **Undo:** `POST …/{id}/decision/undo` on the same five paths, in one new controller, each with the same guard as that kind's decide endpoint plus "only the person who decided". **Refused** after 10 minutes, or once the decision has been used: payroll LOCKED or PAID for the days, the claim in a reimbursement batch or paid, the new shift already started or punched under, a WFH punch made, or the request changed since. **Reversal** per kind as in team.md §6.3: leave balance restored, attendance record restored (bump `version`), assignment removed or reopened, claim reset to SUBMITTED. Audit `DECISION_UNDONE`. The employee is notified (`DECISION_UNDONE`). `GET /v1/approvals/recent-decisions` returns the caller's decisions that can still be undone. Undo answers `FEATURE_NOT_READY` without the table. No new permission. | yes (table) | L | C5, E3, E15, F1, G12, L2, L7 |
| BW-07 | Team summary | `GET /v1/team/summary` (anyOf `attendance.team.read`, `hrms.leave.approve.l1`): scope kind (department, direct reports or company), department names, members with job title, department, status, joining date, probation state and off-today. Uses `TeamEmployeeScope`. | no | M | L2, L5 |
| BW-08 | Team time off | `GET /v1/team/time-off?from&to` (anyOf `attendance.team.read`, `hrms.leave.approve.l1`, `wfh.approve`; ≤ 62 days): approved and pending leave (type, half-day part) and WFH for each person, with request id and kind. Team scope. | no | M | L6, L2 |
| BW-09 | Approvals inbox read model | `GET /v1/team/approvals?kind=&page=&size=`: counts per tab, merged rows newest first, structured facts and warnings, `canDecide`, `rejectNeedsReason`, and `recentDecisions` (from BW-06 when present). Covers only the design's kinds: Leave · Attendance (fixes) · Requests (WFH, shift change, and submitted timesheet weeks once BW-36 is in) · Expenses. Each kind appears only for callers with its list permission, with exactly that list's scope, reusing the existing list services unchanged. Rows the caller can see but not decide come back with `canDecide=false`; `ApproverScopeGuard` is not widened. Decisions still go through the existing decide endpoints. A test checks that the inbox returns the same ids as each list endpoint for owner, hrm, fin, mgr and reader. | no | L | L7, L2 |
| BW-10 | Send a reminder | `POST /v1/attendance/reminders {date, reason, employeeIds[]}` and `GET /v1/attendance/reminders?date=` (`attendance.team.read`; team scope; at most once per person, day and reason, checked against `notif.notifications`). In-app and push per the employee's preferences (`CHECKIN_REMINDER`). No new permission. | no | M | C5, E1, L2, L5 |
| BW-11 | Probation for managers | `GET /v1/team/probation?days=30` (`attendance.team.read`, team scope: end date, days left, overdue). `POST /v1/team/probation/{employeeId}/confirm` and `/extend` (`@perm.check('hrms.probation.team.decide')` + team check) reuse the existing probation service, notify HR and the employee, and audit. The stored auto-extend setting stays inactive, and nothing says it extends on its own. | no (permission in V143_55) | M | L2, L5 |
| BW-12 | Message team | `hrms.team_messages` (sender, body ≤ 500, created) + `hrms.team_message_recipients`. `POST /v1/team/messages` (`@perm.check('hrms.team.message')`); recipients are the sender's `TeamEmployeeScope` only. In-app notification `TEAM_MESSAGE`. `GET /v1/team/messages/mine?days=` returns messages sent to the caller (for Around you), and `GET /v1/team/messages/sent`. Audit. | yes (2 tables + permission) | M | L2, L1 |

#### P-ATT-DAY: the attendance module (backend files: `attendance/AttendanceController.java`, `AttendanceReviewController.java`, `AttendanceReviewService.java`, the attendance module's `AttendanceService`, `CanonicalAttendanceService`, `AttendanceApiDtos`, `CheckInMethod`, `AssistedPunchService` and the DTOs they build (`StaffStatusResponse`, `DayRecordResponse`, `MonthlyStatsResponse`, `CorrectionRequestResponse`), `workforce/TimeEntryController.java` + its service, new `attendance/{SelfDay, PunchRules, ManualEntryBulk, AttendanceRegister}Controller`; migrations V143_53, V143_65)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-13 | Roster row fields | Additive fields on `StaffStatusResponse` (`GET /v1/attendance/dashboard`): `branchName`, `checkInMethod`, `leaveTypeName`, `leaveFrom`, `leaveTo`, `pendingLeave`. One lookup each, no N+1. The mobile app ignores the new fields. | no | M | E1, L5, C6 |
| BW-14 | Review item fields | Branch or zone name (`records.check_in_zone_name`) and `checkInMethod` on `AttendanceReviewService.ExceptionItem`. | no | S | E4, C5 |
| BW-15 | Day details and leave days | `attendanceType`, `lateMinutes`, `checkInMethod`, `checkOutMethod`, `locationName`, `regularized` on `DayRecordResponse` (`GET /v1/attendance/history`); `leaveDays` on the monthly stats. | no | S | E5, K4, L1 |
| BW-16 | One employee's month | `GET /v1/attendance/employee/{employeeId}/history?year&month` and `…/monthly-stats` (`attendance.team.read` + the existing `assertCanReadEmployeeAttendance`), reusing the month-history service. | no | S | K3 |
| BW-17 | Mark attendance for several people | `POST /v1/attendance/manual-entry/bulk` (`attendance.workforce.admin`): one transaction, refuses the caller's own record, a result per person, event log and audit. | no | M | E1 |
| BW-18 | Recent manual entries | `GET /v1/attendance/manual-entries?from&to&limit` (scoped; who entered it and why). Every manual entry also calls `AuditService.record("attendance","MANUAL_ENTRY",…)`. | no | S | E7 |
| BW-19 | Day register CSV | `GET /v1/attendance/register/export.csv?date&departmentId` (`hrms.report.attendance`): the dashboard's rows with name, code, department, branch, shift, in, out, hours, status and source. Recorded in the export log (V143_27) for the Reports Center. File name `muster-roll-YYYY-MM-DD.csv`. | no | S | E1, E8 |
| BW-23 | Approver on fixes | `approverName` (who will decide, from the notification path manager → head → HR) and `decidedByName` on `CorrectionRequestResponse`. | no | S | E3, E5, L1 |
| BW-24 | Web check-in and check-out | Company switch `allow_web_punch` (JDBC-only column, default false). `GET/PUT /v1/attendance/web-punch-setting?companyId`: read for anyone signed in; write with `settings.hrconfig.write` or `attendance.policy.manage`. `WEB` added to `CheckInMethod` and to both check constraints. The punch API refuses `WEB` while the switch is off or the column is missing (`WEB_PUNCH_NOT_ALLOWED`). Browser location is required and the geofence rule is unchanged; approved WFH days are exempt; no face check on the web. Label "Web check-in". | yes (column + 2 constraints) | M | L1, J2 |
| BW-25 | Undo check-out | `POST /v1/attendance/checkout/undo` (`attendance.checkin.self`): the person's own check-out only, same IST day, within 10 minutes, only while web check-in is on. Clears `check_out_at`, the method, `work_hours` and overtime, and logs `MANUAL_OVERRIDE` with a note. | no | S | L1 |
| BW-26 | Breaks | `POST /v1/attendance/breaks/start` and `/end` (`attendance.checkin.self`): only while checked in, one open break at a time, closed automatically at check-out. Writes `BREAK_START`/`BREAK_END` to `attendance.event_logs` (values already allowed). `work_hours` and pay do not change. | no | M | L1 |
| BW-27 | Your day | `GET /v1/attendance/my-day` (`attendance.checkin.self`): today's record (in, out, method, location, type), effective status (weekly off, holiday, leave, not marked), shift (name, start, end, grace, hours), break state, worked minutes so far, `webPunchAllowed`. | no | S | L1 |
| BW-28 | "Anywhere" per person | `hrms.employee_punch_rules (employee_id, allow_anywhere)`. `GET/PUT /v1/attendance/punch-rules/{employeeId}` (`attendance.workforce.admin`). `CanonicalAttendanceService` and `AssistedPunchService` skip the geofence check when it is set. A missing table means the rule is off. | yes (table) | M | D3 |
| BW-30 | Bug E28 | `applyApprovedCorrection` keeps the record's attendance type (WFH stays WFH) instead of always writing OFFICE. Behaviour fix, reported. | no | S | E3 |
| BW-36 | Timesheet by project + Submit week (lower priority) | `hrms.time_entries.project_id` and `hrms.projects.code` (JDBC tables); `hrms.timesheet_weeks` (employee, `week_start`, SUBMITTED, APPROVED or REJECTED, submitted and decided by and at, note). `GET /v1/ess/timesheets/projects` (my company's active projects). A description is optional when a project is set. `POST /v1/ess/timesheets/weeks/{monday}/submit` (`attendance.checkin.self`). `GET /v1/timesheets/approvals` and `POST /v1/timesheets/weeks/{id}/decision` (`@perm.check('hrms.timesheet.approve')` + team scope). Entries of submitted or approved weeks are locked; nothing was ever locked before. Notifications `TIMESHEET_SUBMITTED`/`DECIDED`. | yes (2 columns, table, permission) | L | E6, L7 |

#### P-ATT-PLAN: analytics, schedule, shifts, overtime (backend files: `attendance/TeamScheduleController.java`, `attendance/ShiftController.java`, `attendance/OvertimeController.java`, the attendance module's `ShiftChangeRequestService`, `EmployeeShiftService` and shift policy service, new `attendance/{AttendanceInsights, OvertimeRules}Controller`; migration V143_54)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-20 | Breakdown and average arrival | `GET /v1/attendance/dashboard/breakdown?from&to&by=department\|branch` (`attendance.team.read`, scoped): rates per group, and average arrival against the shift in force (the same lateral join as `OvertimeController.SHIFT_JOIN`), with the previous period for "vs last month". | no | M | E9 |
| BW-21 | Punctuality | `GET /v1/attendance/punctuality?from&to` (`attendance.team.read`, team scope): late count, average delay, worst weekday and the previous period, from effective LATE days. | no | M | E11 |
| BW-22 | Schedule day facts | `GET /v1/team/schedule` rows gain `onLeave` (type, half-day part), `weeklyOff` (the person's own, else the shift's) and `holidayName`. Same one-row-per-person-per-day shape. | no | S | E13, L6 |
| BW-29 | Company overtime rules | `attendance.overtime_rules (company_id, counts_after_minutes, monthly_cap_minutes, updated_by, updated_at)`. `GET/PUT /v1/attendance/overtime-rules?companyId`: read with `attendance.team.read`, write with `attendance.policy.manage`. The overtime list and decision (`OvertimeController`) apply them: minutes count only past `counts_after`, and approval stops at the monthly cap. No row, or a missing table, gives today's behaviour exactly. Stored `overtime_minutes` and `work_hours` never change. | yes (table) | M | E14, J2 |
| BW-31 | Shift change "Until" | `requested_end_date DATE NULL` on `attendance.shift_change_requests`, added by the migration (the table's startup bootstrap stays as it is). On approval the new shift is assigned with `effective_to` and the previous shift comes back the next day. Responses carry the range. A null end date means permanent, as today. | yes (column) | M | L4, E15 |
| BW-32 | People per shift | `employeeCount` on `GET /v1/shifts`: assignments in force today, same company. | no | S | E12, L4 |
| BW-33 | Deleted default shifts come back | `GET /v1/shifts` creates the default shifts only for a company that has never had a shift (any row, including inactive ones). | no | S | D8 |
| BW-34 | Withdraw a shift change | `POST /v1/shifts/change-requests/{id}/cancel`: the requester only, PENDING only. | no | S | L4, E16 |

#### P-HOME: self-service Home and WFH (backend files: new `ess/**` controllers and services, `wfh/WfhController.java`, the leave module's `WfhService`)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-35 | WFH approver and a batch of days | `approverName` in `WfhController.enrichOne`. `POST /v1/wfh/batch {dates[], reason}` (`wfh.request.self`): splits the dates into runs, one transaction, overlap checks, one approver notification. | no | S | L3, F1 |
| BW-119 | My requests | `GET /v1/ess/my-requests?limit=`: one list across leave, WFH, fixes, shift changes, expenses, advances, and timesheet weeks when present. Each row has type, title, dates, status, steps, progress, approver and link. Each source is included only when its module is on and the caller holds its self permission. A failing source is reported in `unavailable[]` and does not fail the list. | no | M | L1 |
| BW-120 | Needs you | `GET /v1/ess/needs-you`: kind, title, sub-line, due date, tone, link. **Employee sources:** missed check-outs with no fix, documents to redo or missing, onboarding tasks, interview scorecards, and, when their tables exist, letters to sign (BW-76), self-review due (BW-78), policies to accept (BW-105) and assets to confirm (BW-70). **Manager sources:** probation decisions (BW-11 rule) and reviews to write. Each source sits behind its permission and fails on its own. | no | L | L1 |
| BW-121 | Around you | `GET /v1/ess/around-me?days=`: milestones, holidays, company notices (with `event_date` when present), and, for managers, the team's probation ends, sorted by date. The page adds the payroll date from BW-55 and team messages from BW-12. | no | M | L1 |
| BW-122 | Who a request goes to | `GET /v1/me/approvers?for=leave\|wfh\|correction\|shift` → name and how the person was chosen (manager, department head, HR, admin, delegate). A new `ApproverPreviewService` reproduces the chain in `LeaveController.apply` and `WfhController.apply` without editing them; a fixture test checks it matches. Expense and advance approvers come from BW-60 and BW-62. | no | S | E5, L3, L4 |

#### P-LEAVE: leave (backend files: `leave/**` controllers, the leave module except `WfhService`, the holiday update in `settings/SettingsController.java`; migration V143_56)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-37 | Approval stats | `GET /v1/leave/approvals/stats?months=7` (`hrms.leave.approve.l1`, the same scope as the pending list): waiting and new in 24 h, approved this month with a 7-month series and delta, on leave today and the next working day, average approval time with its series. | no | M | F1 |
| BW-38 | Request row details | Additive on `LeaveRequestResponse` (every constructor updated): type code and category, half-day part, the requester's balance (available / total), conflicts (same-department overlap with approved or pending leave; requester on notice), `decidedByName`, `approverName`, L2 name and time. | no | M | F1, F2, F9, F11 |
| BW-39 | Calendar feed | `GET /v1/leave/calendar?from&to&statuses=APPROVED,PENDING,PENDING_L2`: level 2 sees the tenant, level 1 the team, `leave.balance.read` only themselves. Index `(tenant_id, start_date, end_date)` (index only). Replaces the 10-page history fetch. | yes (index) | M | F1, F4 |
| BW-40 | Decided filter | `status` parameter and per-status counts on `/v1/leave/approvals/history`. | no | S | F2 |
| BW-41 | PENDING_L2 queue | Include PENDING_L2 rows for `hrms.leave.approve.l2` holders, decided through the existing `/l2-decision`. | no | S | F1 |
| BW-42 | Bulk decision | `POST /v1/leave/approvals/bulk-decision {ids, status, comment}` → a result per id. Calls the same service method as `/decision`, so each id gets `ApproverScopeGuard` and the Undo journal. | no | S | F1, L7 |
| BW-43 | Apply on behalf | `POST /v1/leave/apply/for/{employeeId}` (`@perm.check('hrms.leave.apply.others')`): the same validation and approver chain as `/apply`. Who raised it is recorded in audit and shown to the employee; the employee is notified (`LEAVE_APPLIED_ON_BEHALF`). | no (permission in V143_56) | M | E1, F1, K3 |
| BW-44 | Everyone's balances | `GET /v1/leave/balances?companyId&year&page&size&q` and `GET /v1/leave/usage?year&companyId` (`hasAnyAuthority('hrms.leave.employee.read','hrms.report.leave')`): every non-exited person, available, total, used, pending and carry-forward by type; usage sums by type. | no | S | F3 |
| BW-45 | Encash summary | `GET /v1/leave/encashments/summary` (`hrms.leave.encash.approve`). | no | S | F5 |
| BW-46 | Edit a holiday | `PUT /v1/settings/holidays/{id}` (`settings.holidays.write`), mapped fields only. | no | S | F8 |
| BW-47 | Colleagues off | `GET /v1/leave/team-off?from&to` (`leave.balance.read`): for each day, the first names of same-department colleagues with APPROVED leave. No type, no pending requests. | no | M | F10 |
| BW-48 | Leave preview | `GET /v1/leave/preview?leaveTypeId&startDate&endDate&duration` (`leave.request.self`): working days counted as `applyLeave` counts them, balance after, approver, blocking reasons (notice, maximum in a row, overlap, balance). | no | S | F10 |
| BW-49 | Balance notes | `nextCredit {days, on}`, reset date and carry-forward cap on `LeaveBalanceResponse`, only from rules that exist and work today. | no | S | F9 |

#### P-PAY-CORE: payroll (backend files: `payroll/**` controllers, the payroll module (`PayrollRunService`, `PayrollService`, `PayrollDashboardService`, `DisbursementBatchService`, `PayrollReportService`, …); migration V143_58)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-50 | Run employee fields | Additive on `RunEmployeeDto`: department, branch, designation, joining date, previous run gross and net, % change, new joiner, `hasBankAccount`, `fnfInProgress`. "Previous" means the same company's previous period. | no | M | G3, G4, G5 |
| BW-51 | Checks before you lock | `GET /v1/payroll/runs/{id}/checks` (`payroll.runs.read`) → `[{key, severity, count, text, employeeIds}]`: variance over 10 %, missing bank details, prorated joiners, F&F in progress, skipped, LOP. "Needs review" per person comes from these. | no | M | G3, G4 |
| BW-52 | Statutory dues | `GET /v1/payroll/runs/{id}/statutory`: PF (employee and employer), ESI (both), PT, LWF, and TDS only when a TDS line exists. Due dates: PF and ESI the 15th, TDS the 7th of the next month, PT per state or none. | no | S | G3 |
| BW-53 | Employer cost and paid date | `employerContributions` and `paidAt` on `RunDto`. | no | S | G1, G3 |
| BW-54 | Pending disbursals | `pendingDisbursalAmount` on the dashboard KPIs: PROCESSING or LOCKED runs with no POSTED or PAID batch. | no | S | G1 |
| BW-55 | My payslips | On `MyPayslipDto`: `paidAt`, `payDate`, `totalDays`, and `notes[]` (PLI, advance recovery, leave encashment, first month on a new salary). `GET /v1/payroll/payslips/me/ytd` (financial year from the company's `fiscal_year_start`). `GET …/me/upcoming`: period and "being prepared" only, no figures. `GET …/me/schedule`: next pay date (the next run's `pay_date`, else the processing day). Bank last 4 on the payslip head. All `payroll.payslip.read.self`, own runs only. | no | M | G13, L1, E5 |
| BW-56 | Salary structures | `GET /v1/payroll/structures/summary`, paged `GET /v1/payroll/structures?page&size&q&noStructure=true` (`payroll.structure.read`). `GET /v1/payroll/structures/me/history` (`payroll.structure.read.self`); the reason is the revision note, else the revision batch reason. | no | M | G6, G14 |
| BW-57 | Bank-file readiness | `GET /v1/payroll/runs/{id}/bank-readiness` (`hrms.disbursement.read`): ready of total, each person's problem, bank last 4. Same checks as `DisbursementBatchService.buildFromRun`. | no | S | G8 |
| BW-58 | One employee's payslips | `GET /v1/payroll/employees/{employeeId}/payslips` (`payroll.runs.read`; LOCKED and PAID runs). | no | S | K3 |
| BW-59 | Ask payroll | `payroll.payslip_queries` (run, employee, message, OPEN, ANSWERED or CLOSED, answer, answered by and at). Employee: `POST /v1/payroll/payslips/me/{runId}/queries` and `GET …/me/queries` (`payroll.payslip.read.self`, own runs). Payroll team: `GET /v1/payroll/queries?status=` and `POST /v1/payroll/queries/{id}/answer` (`@perm.check('payroll.runs.manage')`). Notifications `PAYSLIP_QUERY_RAISED` (to `payroll.runs.manage` holders) and `PAYSLIP_QUERY_ANSWERED`. | yes (table) | M | G13, G1 |

#### P-EXP: expenses (backend files: `expense/**` controllers and the expense module; migration V143_57)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-60 | Expense details | `GET /v1/expense/my/summary` (`hrms.expense.claim.self`): waiting, approved not yet paid, reimbursed this year. `/v1/expense/my` rows gain `approverName`, item categories, and batch reference and status. `ExpenseClaimResponse` gains `department` and `policyCheck {result, policyName, cap}` (the same merge as `enforceCategoryCaps`). `GET /v1/expense/policies/caps?companyId` (`claim.self`). `status` parameter on `/claims/approvals`, so waiting counts no longer include APPROVED. `GET /v1/expense/my/approver` (`claim.self`). | no | M | G12, L7 |
| BW-61 | Claim on behalf (lower priority) | `POST /v1/expense/claims/for/{employeeId}` and receipts on behalf (`@perm.check('hrms.expense.claim.others')`), following the advance-on-behalf pattern of V143_24. Goes through the employee's normal approval chain; the employee is notified (`EXPENSE_CLAIM_RAISED_FOR_YOU`). | no (permission in V143_57) | M | K3 |

#### P-PAY-EXTRA: advances, PLI, full and final (backend files: `advance/**`, `pli/**`, `fnf/**` and their modules)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-62 | Advance details | `GET /v1/advance/summary` (`hrms.advance.read`; the whole tenant only with `hrms.advance.disburse`) and `/my/summary`. `phase` filter (Recovering, Repaid) and department. `/v1/advance/{id}/summary\|schedule\|ledger` also open to `hrms.advance.request.self`, with the ownership check. `GET /v1/advance/my/approver`. Optional `{paymentReference, firstDeductionMonth}` on disburse. Ledger rows named by payroll month. `GET /v1/advance/my/preview?amount&months`. | no | M | G10 |
| BW-63 | PLI totals | `GET /v1/pli/awards/summary` (`hrms.pli.read`); `status` on `/v1/pli/awards`; department in `enrich`; `GET /v1/pli/my/summary` (`hrms.pli.read.self`). | no | S | G9 |
| BW-64 | F&F lists | `status` and `employeeId` parameters on `GET /v1/fnf/settlements`; `GET /v1/fnf/summary`; department and employment status in `enrich`; `GET /v1/fnf/settlements/status?employeeIds=` (`hrms.fnf.read`). | no | S | G11, I5, K3 |

#### P-HIRE: hiring, onboarding, assets (backend files: `hiring/**`, `onboarding/**`, `me/MyAssetsController.java`, the onboarding module; migration V143_59)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-65 | Hiring summary | `GET /v1/hiring/summary?companyId=` (`hrms.hiring.read`): open, on-hold and closed requisitions; positions to fill; candidates this quarter; stage counts for open roles. | no | S | H1 |
| BW-66 | Stage history and funnel | `hiring_mgmt.candidate_stage_events`, written in the same transaction on add, stage change, offer created, offer accepted and conversion (skipped when the table is missing). `GET /v1/hiring/funnel?from&to` → reached-stage counts, conversion rates, time to hire. Exact only from the migration date; "—" before it. | yes (table) | M | H1, C11 |
| BW-67 | Offer email | `hiring_mgmt.offer_candidate_emails (offer_id, email)`. Create and edit accept `candidateEmail`, falling back to the candidate's email. Returned on the offer, and used by "Send offer email". | yes (table) | S | H1 |
| BW-68 | My interviews this quarter | `GET /v1/hiring/interviews/mine/summary`. | no | S | H1 |
| BW-69 | Onboarding overview | `GET /v1/onboarding/instances/overview` (`hrms.onboarding.instance.read`): name, department, joining date, checklist name and counts, for any company. `usedBy` on templates. Holder and last-holder names on `GET /v1/onboarding/assets` only for callers with `hrms.employee.read`. | no | M | H2, C10 |
| BW-70 | Confirm or report an asset | `hrms.asset_confirmations` (backfill: allocations already open count as confirmed) and `hrms.asset_issue_reports` (kind LOST, DAMAGED, NOT_WORKING or OTHER; note; OPEN or RESOLVED). `POST /v1/me/assets/{assetId}/confirm` and `/problem` (`hrms.onboarding.asset.self`; current holder only). `confirmedAt` and the open report appear on `/v1/me/assets` and on HR's list. `GET /v1/onboarding/assets/issues?status=` and `POST …/{id}/resolve` (`hrms.onboarding.asset.write`). Notification `ASSET_ISSUE_REPORTED`. | yes (2 tables) | M | H9, H2 |

#### P-DOCS: letters and documents (backend files: `letters/**`, `document/**` and their modules; migration V143_60)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-71 | Generated-letter fields | On `GeneratedLetterDto`: department, `templateName`, `generatedByName`, `signedAt` (existing column, read with JDBC), `signatureRequested`. | no | S | H4, H7, K3 |
| BW-72 | Distribution details | `templateName` on `DistributionJobDto`; a new `BY_BRANCH` recipient filter. | no | S | H4 |
| BW-73 | Send on a date | `letters.distribution_schedules` holds the request (template, filter, send-on). A `@Scheduled` job creates and starts the distribution when due. The list shows "Scheduled" rows, and Cancel deletes them. | yes (table) | M | H4 |
| BW-74 | Issue date | `issueDate` on `GenerateLetterRequest`. `MergeFieldResolver` uses it for the `today` tokens, it is kept in `generation_context`, and it is shown as "Issued". | no | S | H4 |
| BW-75 | My letters scope | `/v1/letters/my` returns SENT, VIEWED and SIGNED letters, plus VOID ones labelled "Withdrawn". Unsent drafts are hidden. VIEWED is set when the owner opens or downloads. Privacy fix, reported. | no | S | H7 |
| BW-76 | E-signature (click to accept) | `letters.letter_signatures` (letter, employee, requested at and by, signed at, typed name, IP, user agent). HR's `requestSignature` flag on generate and send. `POST /v1/letters/my/{id}/sign` (`hrms.letters.read.self`; owner only; SENT or VIEWED; signature asked) sets the existing mapped `status=SIGNED` and `signed_at`. `GET /v1/letters/my/{id}/html` returns the sanitised body. No PDF stamp. Notification `LETTER_SIGNATURE_REQUESTED`. | yes (table) | M | H7, H4 |
| BW-77 | Document counts | `GET /v1/document/summary` (`hrms.document.read`) and `/my/summary` (`read.self`); status counts on `/v1/document/employee/{id}`; department and expiry on `/v1/document/pending`; `GET /v1/document/pending/summary` (`hrms.document.verify`; verified and rejected this week). | no | S | H5, H6, H8, K3 |

#### P-GROW: performance and learning (backend files: `performance/**`, `learning/**` and their modules; migration V143_61)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-78 | Cycle dates and sharing | `performance_mgmt.review_cycle_milestones` (cycle, `goals_by`, `self_review_by`, `manager_review_by`, `share_on`, `hold_until_shared` default false, shared at and by). Fields in the cycle form. Returned on cycles and on review responses. When hold is on, `/reviews/my` hides SUBMITTED reviews written by others until `POST /v1/performance/cycles/{id}/share` (`hrms.performance.write`). | yes (table) | M | I1, L5, L1 |
| BW-79 | Stages and ratings | `GET /v1/performance/cycles/summary` (reviews and submitted per cycle); `GET …/cycles/{id}/stages` (counts by reviewer type and status, in one query); `GET …/cycles/{id}/ratings` (buckets, team-scoped). | no | M | I1 |
| BW-80 | Remind notifies | `AppraisalCycleService.remind` also sends `PERFORMANCE_REVIEW_REMINDER` (in-app, and email by preference); the 24 h throttle stays. No morning job. | no | S | I1 |
| BW-81 | Review filters | `status` (WAITING, SUBMITTED, MISSED) on `GET /v1/performance/reviews`; `department` and `reviewerType` (read with JDBC) in the enrichment, including `/reviews/my`. | no | S | I1 |
| BW-82 | KPI and people details | `GET /v1/performance/kpis/summary` (the `KpiAccessScope`); department on KPI rows; `employmentStatus` and `pendingInOpenCycle` in the people directory. | no | S | I1 |
| BW-83 | Company KPIs (lower priority) | `performance_mgmt.company_kpis` + `goal_kpi_links` (`goals` is JPA-mapped, so a side table). CRUD under `hrms.kpi.manage`; read under `hrms.performance.read` or `review.self`. Roll-up = weighted average progress of the linked goals. | yes (2 tables) | M | I1 |
| BW-84 | My review cycle | `GET /v1/performance/cycles/my-current` (`review.self`): my steps. `PUT /v1/performance/reviews/{id}/draft` (writer only; → IN_PROGRESS). `lastNote`, `lastUpdatedAt`, `previousValue` on `/goals/my`. `dueDate` (and the KPI link when BW-83 is in) on my own goals, written with JDBC after the JPA save. | no | M | I1 |
| BW-85 | Learning details | `GET /v1/learning/programs/summary`; `learning_mgmt.program_locations` (the programs table is JPA-mapped); `GET /v1/learning/programs/categories`; department on roster rows; program dates and mode on `EnrollmentDto`; `GET /v1/learning/certifications?status=&page` (`hrms.learning.skill.read`); `updatedAt` on skills; `skill_assessments.certification_name`, applied on approval. | yes (table + column on a JDBC table) | M | I3 |

#### P-REPORTS: reports (backend files: `backend/app/hrms-app/src/main/java/com/hrms/app/reports/**`, including `ReportScheduleJob`; migration V143_62)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-86 | Hero deltas and diversity as of a date | `GET /v1/reports/headcount/change?from&to`; `asOf` on the diversity report, using `employee_status_history` as headcount does. | no | M | I6 |
| BW-87 | Tile mini charts | `GET /v1/reports/summary?companyId=`: a small series per report, each only with its own permission. | no | M | I6 |
| BW-88 | Headcount trend, fiscal year | `GET /v1/reports/headcount/trend?months=6` (`hrms.report.headcount`); a fiscal-year period on attrition; download per tab. | no | S | I8 |
| BW-89 | Schedule options | Replace `ck_report_schedules_frequency` (adds DAILY, WEEKDAYS) and `ck_report_schedules_day`; `send_hour SMALLINT NULL` (null = today's time); attach the server CSV next to the PDF. | yes (constraints + column) | M | I6 |

#### P-WF-PEOPLE: workforce (backend files: `workforce/WorkforceController.java`, `workforce/MasterDataController.java`, the employee module's workforce services (`WorkforceEmployeeService`, `WorkforceFilter`, …), `backend/app/hrms-app/src/main/java/com/hrms/app/bulk/**`; migration V143_52)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-90 | Employee stats | `GET /v1/hrms/employees/stats?companyId=` (`hrms.employee.read`): counts by status (active, probation, notice, exited, suspended), joined and left this month, notice started in the last 7 days, probation reviews due next month, exits this year, attrition %, a 7-point series, and `statusSince` for suspended people (from `employee_status_history`). | no | M | D1, D2, I5 |
| BW-91 | Exit lists | `GET /v1/hrms/employees/exits?status=` (`hrms.employee.write`): reason, exit type, department, last working day. F&F status comes from BW-64. | no | S | I5 |
| BW-92 | Employee drafts | `hrms.employee_drafts` (company, created by, payload jsonb, times). `GET/POST/PUT/DELETE /v1/hrms/employee-drafts` (`hrms.employee.write`). PAN, Aadhaar and bank details are stripped on the server before saving. | yes (table) | M | D3 |
| BW-93 | Import through the Add path | Each row is created through `WorkforceEmployeeService.create`, under the same rules as Add employee. Department and designation are mapped by name (fixes the dropped department), branch by name or code, and manager by code or email. Adds the columns employee code, PAN, UAN, ESI, bank account, IFSC and bank name. Problems come back per row. Imported people keep ACTIVE status, as today. | no | M | D4 |
| BW-94 | Start onboarding (opt-in) | `startOnboarding` flag on create and on import (false by default on the server). Calls the existing `ConversionOnboardingStarter.start(...)` unchanged, and returns `onboarding {instanceId, templateName} \| null`. | no | S | D3, D4 |
| BW-95 | Department cost centre and head | `hrms.department_cost_centres (department_id, cost_centre)`. `costCentre` and `headName` on `DepartmentResponse`; cost centre accepted on create and update (JDBC after the JPA save). | yes (table) | M | D7 |
| BW-96 | Directory filters | `reportingManagerId` filter (direct reports), word-by-word search across name, code, email, department, designation and branch, and a `companyId` filter, on `GET /v1/hrms/employees`. | no | S | D2, K3 |
| BW-97 | A manager reads a direct report | `GET /v1/hrms/employees/{id}` is also allowed for the direct manager holding `hrms.employee.team.manage`, returning the list projection with pay, bank and identity left out. Access change, reported. | no | M | K3 |
| BW-98 | My own record | `GET /v1/hrms/employees/me` (`isAuthenticated()`): probation, confirmation, notice, last working day, designation, manager name. | no | S | K4, A4 |

#### P-PROFILE: profile (backend files: `employee/EmployeeProfileController.java` + its services, `invitation/**`)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-99 | Read my own sections | People can read their own addresses, education, experience, dependents and emergency contacts, and a masked identity, through an object guard "self or `hrms.employee.profile.read`". Writes are unchanged. | no | M | K4 |
| BW-100 | Last sign-in device | `lastLoginDevice` on `/v1/employees/{id}/invitation-status`, from the newest refresh token's user agent ("Android", "iPhone", "Chrome on Windows"). | no | S | K3 |
| BW-101 | Nominee total | A dependent that takes the nominee total above 100 % is refused (`NOMINEE_SHARE_OVER_100`), and the running total is returned. Existing rows are untouched. | no | S | K3 |

#### P-SETUP: compliance and HR setup (backend files: `compliance/**`, `notiftemplate/**`, `integration/**`, `probation/ProbationController.java` (the reminder log read); migration V143_63)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-102 | Compliance details | `GET /v1/compliance/summary` (its POSH part only with `hrms.compliance.posh`). `status` filters on obligations and filings (OVERDUE by due date). `filedDate` on Mark filed (≤ today; LATE worked out from it). LWF and TDS 24Q filing types (enum only). The shared date on inspection documents. | no | M | J1 |
| BW-103 | POSH department | `compliance_mgmt.posh_complaint_departments (complaint_id, department_id)`, read and written with JDBC. | yes (table) | S | J1 |
| BW-106 | Reminder recipients | Map `notified_user_ids` to names in the probation reminder log response. | no | S | J2 |
| BW-107 | Template filter | `channel` filter and counts per channel. | no | S | J3 |
| BW-108 | Integration status | Counts, and a "needs attention" status from the existing last-error and last-sync columns. | no | S | J4 |

#### P-WF-SETUP: policies (backend files: `policy/**` and the policy module; migration V143_64)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-104 | Policy details | `audienceCount`, `pendingCount`, `ownerName` on `PolicyResponse`; `status=ALL`; `GET /v1/policy/my-summary` (to accept, accepted, overdue); `GET /v1/policy/my-acknowledgements?detail=true`. | no | S | D1, D8, H10 |
| BW-105 | Accept by | `policy_mgmt.policy_ack_deadlines (policy_id, policy_version, acknowledge_by)`. A field in the Publish panel. Returned on policies and on my summary, with an overdue flag. | yes (table) | S | D8, H10, L1 |

#### P-ADMIN: security, users, roles, audit (backend files: `me/MySecurityController.java`, `access/WorkspaceAccessController.java` + service, `rbac/RbacController.java` + service, `audit/AuditController.java`, the sign-in success and failure paths in `auth/canonical/**`)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-109 | Password last changed | A field on `GET /v1/me/security`. | no | S | J5 |
| BW-110 | Users and roles details | `grantedAt`/`grantedBy` for each role in `/v1/workspace` users; an optional invite `message` (email placeholder); `permissionCount` and `holderCount` on roles. | no | S | J6, J7 |
| BW-111 | Sign-in events | Record LOGIN success and failure (IP, device, never the password) through `AuditService` after sign-in, inside try/catch so auditing can never block a sign-in. A `category` filter on `/v1/audit/events`. | no | M | J8 |

#### P-DASH: dashboard (backend files: `workforce/AdminDashboardController.java`, `DashboardSummaryController.java`, `CompanyNoticeController.java`, `ProjectController.java` and the services only they use, new `me/UiPrefsController.java`; migration V143_51)

| ID | Feature | Work | Schema | Size | Needed by |
|---|---|---|---|---|---|
| BW-112 | Quick-action preferences | `hrms.user_dashboard_prefs (tenant_id, user_id, surface, quick_actions text[], quick_uses jsonb, updated_at)`, primary key `(tenant_id, user_id, surface)`. `GET/PUT /v1/me/dashboard/quick-actions?surface=dashboard\|home` and `POST …/{key}/use` (`isAuthenticated()`, the caller's own row only). Validation: ≤ 6, unique, known keys; counts reset each IST month. `available:false` when the table is missing. The dashboard audit §13 has the full spec. | yes (table) | M | C3, L1 |
| BW-113 | Headcount series | `joinedInMonth` and `leftInMonth` on `/stats`; `GET /v1/admin/dashboard/headcount-series?companyId&to&days=7` (`org.company.read` + `hrms.employee.read`). | no | S | C2 |
| BW-114 | Performers summary | `GET /v1/admin/dashboard/performers/summary` (same team scope). `/performers` keeps returning a list. | no | S | C10 |
| BW-115 | Onboarding rows | `department` and `joiningDate` on `/v1/admin/dashboard/onboarding` rows. | no | S | C10 |
| BW-116 | Hiring this quarter | `from` (quarter start) and reached-stage counts (forward only; rejected and withdrawn count in Applied only) on `/v1/admin/dashboard/hiring`. The card switches to BW-66's exact funnel when it is available. | no | S | C11 |
| BW-117 | Project owner, due date, health | `owner_employee_id` and `due_date` on `hrms.projects` (JDBC). Create and update accept them. The list returns owner name, due date and health: **Delayed** = past due and not complete; **At risk** = due within 14 days with under 75 % of tasks done. Columns are detected until the migration is applied. | yes (2 columns) | M | C11 |
| BW-118 | Notice event date | `event_date DATE NULL` on `hrms.company_notices`; accepted on create and update, and returned. | yes (column) | S | C8, L1 |

### 3.4 Where the duplicates were merged

| Item | Asked for by |
|---|---|
| BW-06 Undo | dashboard G3, attendance G13, leave-payrun L7, pay G20, team G11, ess-1 E27. Advance, PLI, overtime and face-decision Undo are not built: they stay on their own pages (DECISIONS 15). |
| BW-10 Remind | dashboard G2, attendance G3, team G3 |
| BW-13 roster fields | attendance G1, team G2, ess-1 E24 |
| BW-22 schedule day facts | attendance G10, team G8 |
| BW-38 approver and row details | leave-payrun L2, ess-1 E9, grow-reports G-M2, setup-admin #25 |
| BW-43 apply on behalf | leave-payrun L8, attendance G14, companies-profile G-P8 |
| BW-53/55 paid date and payslip extras | pay G2 and G23, ess-2 E1–E3, ess-1 E13, setup-admin #25 |
| BW-56 salary history | pay G4, ess-2 E5 |
| BW-60 expense details | pay G15–G17, ess-2 E7–E10, team G10 |
| BW-62 advance details | pay G10–G14, ess-2 E10, E13, E14 |
| BW-64 F&F lists | pay G18, grow-reports G-E2, companies-profile G-P10 |
| BW-66 funnel | talent G2, dashboard G8 |
| BW-70 assets | talent G20, ess-2 E18, E19 |
| BW-71/76 letters and signing | talent G12, G19; ess-2 E15, E16; companies-profile G-P11 |
| BW-77 document counts | talent G17, G18; companies-profile G-P7 |
| BW-78 cycle dates | grow-reports G-P1, G-P4; ess-2 E23, E25; team G6 |
| BW-88 headcount trend | grow-reports G-R7, setup-admin #13 |
| BW-90 employee stats | workforce #1, #2; grow-reports G-E3 |
| BW-104 policy details | workforce #17, setup-admin #8, #9, ess-2 E21 |
| BW-112 quick actions | dashboard G1, ess-1 E26 |
| BW-122 approver preview | ess-1 E8, ess-2 E10 (expense and advance parts are in BW-60 and BW-62) |

---

## 4. Shared components and tokens

Source of truth: foundation audit §2 and §5–§10, and crosscut §2, §5 and §14. Everything below is built in Phase 1. Page packages consume it and never copy it. When a page needs something the kit lacks, it adds a small local wrapper and reports it, and the lead folds it into the kit (PACKAGE_BRIEF).

### 4.1 Tokens and theme (F1)

- **Files:**
  - `apps/platform/src/design/theme/tokens.css`: every `--u-*` token, light and dark.
  - `base.css`: `body`, font, tabular numbers, `font-synthesis-weight: none`, selection, scrollbars, focus ring.
  - `dark-bridge.css`: dark values for the legacy Tailwind classes and inline light colours, so pages not yet rebuilt stay readable.
  - `theme.ts` and `ThemeProvider.tsx`: the `light | dark` state and `useTheme()`.
  - `packages/design-system/src/tokens.css`: points the existing semantic tokens (`--bg-surface`, `--text-primary`, `--border-default`, `--accent-*`) at the `--u-*` values.
  - `index.html`: a no-flash script that resolves the theme exactly as the provider does.
  - `tailwind.config.js`: weights clamped to 600; `display`, `h2` and `h3` drop 700/800.
- **Token set** (F1's file lists every name):

  | Group | Tokens |
  |---|---|
  | Surfaces | `--u-bg`, `--u-sf`, `--u-sf2`, `--u-hv`, `--u-ov` |
  | Lines | `--u-ln`, `--u-ln2` (+ `-rgb` forms) |
  | Ink | `--u-ink`, `--u-ink2`, `--u-ink3`, `--u-ink4` |
  | Brand | `--u-br` `#0F6E56` (kept in dark), `--u-brh`, `--u-brt` (brand as text), `--u-brs`, `--u-brs2`, `--u-brl`, `--u-onbr` |
  | Greens, reds | `--u-g2`, `--u-g3`, `--u-gy`, `--u-gd`, `--u-gdt`, `--u-gds`, `--u-rd`, `--u-rdt`, `--u-rds` |
  | Status | success, info, leave, holiday, amber, warning, danger, each with `-soft` and `-text` |
  | Attendance kinds | `--u-k-{people, present, leave, late, halfday, wfh, notmarked, absent}` |
  | Shadows | `--u-shc`, `--u-shh`, `--u-shp` |
  | Chrome | `--u-rail`, `--u-railx`, `--u-backdrop`, `--u-focus`, `--u-toast-{bg, icon, ink, sh}` |
  | Type | `--u-font`, `--u-mono` |

- **Dark values** come from `hrms-core.js` `DARK` plus the foundation §2.2 proposals for the colours the design leaves without a dark value.
- **Contrast nudges** for 4.5:1: `--u-ink3` is `#60706A`; leave text is `#A94E17`.
- **Brand in text:** brand-coloured text always uses `var(--u-brt)`. Brand fills stay `#0F6E56` in both themes.
- **Tints:** `color-mix(in oklab, …)` always has a plain fallback declared first, for older phone browsers.
- **Theme rules (DECISIONS 14):**
  - Light by default. The Light/Dark switch lives in the More panel and stores `ut.theme` on the device.
  - Theme is applied as `data-theme` plus `color-scheme` on `<html>`.
  - Pre-auth pages (sign-in, forgot and reset password, accept invite, pending approval) are always light.
  - Print stays light. Leaflet street tiles stay light.
  - Charts read their colours from tokens when the theme changes.
- **Brand colour** is `#0F6E56` everywhere. The old `#059669` is replaced wherever a file is touched.
- **Flat canvas:** no 3D art (`UtArt` dropped).
- **Size and space:** radii are cards 16–20, tiles 13–18, inputs 10–11, buttons 8–13, pills 999, menus and dialogs 12, side panels 0. Page frame padding is `28px clamp(16px,2.4vw,36px) 56px`, max width 1440 for admin pages and 1320 for self-service. One z-index scale: pages panel 20, header 30, rail 40, popovers 55–56, then the kit's overlay stack (backdrop, panel, dialog, calendar, toast) as F2b defined it.

### 4.2 Font (F1)

- **Face:** Plus Jakarta Sans 400/500/600 only, from Google Fonts with `display=swap`. Inter, JetBrains Mono and the unused Tabler Icons stylesheet are removed. Mono is the system `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- **Inline stacks:** the 204 inline Inter stacks (58 files) become `inherit` or `var(--font-sans)` in the same change. Inline 700–900 weights (128 files) become ≤ 600 as each page is rebuilt. The global clamp stops any fake bold meanwhile.
- **Type scale (from the prototype):**
  - Page title 28/34, 500, −0.025em. Greeting 30/38, 500, −0.03em.
  - Card and section title 15/20, 500. Body 13.5–14.5. Meta 12.5 in `--u-ink3`.
  - Eyebrow 11–11.5, upper case, .06–.16em.
  - Figures 26–44, 500 (600 only in `UtLive`), always tabular.

### 4.3 Motion (F2a: `src/design/theme/motion.ts` + `motion.css`)

- **Easing:** standard `cubic-bezier(.2,.8,.2,1)` (`UFX_EASE`), spring `cubic-bezier(.34,1.56,.64,1)`, in-out `cubic-bezier(.65,0,.35,1)`.
- **Durations (`UFX_MS`):**
  - rise 520, fade plus 8px; stagger 40 ms, capped at 14 items
  - pop 260
  - count 950 (a React `CountUp` that keeps `en-IN` grouping and ₹)
  - grow 750 (delay 120 + 35 ms stagger, capped at 16)
  - draw 1100 (replays on hover)
  - ring 1000 (delay 150 + 90)
- **Hover engine:** `data-fx="tilt|spot"`.
- **Where motion applies:** `data-rise` only on top-level cards, never on table rows. `prefers-reduced-motion` turns everything off. `html[data-ufx]` defaults to `full`, with no UI setting.
- **Toast timing (`TOAST_MS`):** success 2600, info 2600, error 7000 (errors stay up as today), undo 5000. After the undo toast closes, the row keeps its Undo button until the server's 10-minute window ends (BW-06 `recentDecisions`).

### 4.4 The kit (`apps/platform/src/design/kit/`, `var(--u-*, fallback)`, hand-built React, DECISIONS 10)

| Package | Pieces | Approach |
|---|---|---|
| **F2a display** (in progress) | PageHeader and PageFrame; PillTabs and PagePill; SearchPill; StatCard, StatGrid and CountUp; QuickActionTile and grid; AnimatedIcons (QuickIcon, AniIcon); Card; Section, SectionHeading, SectionLink, SectionAction, MiniStat, KeyValueGrid; ListRow, ListRows, IconTile, DateTile; StatusPill, CountBadge, Chip, StatusDot; Avatar; EmptyState and ErrorState; the Skeleton family; ProgressBar, StackedBar, Legend; Meter and BarList; ProgressRing, DonutRing, GeofenceRing; MonthCalendar and CalendarLegend (on the shared calendar); SegmentedControl; FilterPills; Sparkline. Already added in the worktree: Button, Callout, ColumnChart, Ledger, StepTrack, Table. Barrel `display.ts`, styles `display.css`. | Hand-built. `UtStat`, `UtLive`, `UtAniIcon`, `UtQuick` and `UtEmpty` were converted once as a scaffold, then owned by hand. |
| **F2b overlays and forms** (done: `b1d742fa`, `47bc1f4d`) | SidePanel (plain and stepper: done, current and to-do steps, sticky footer, disabled Next with a reason, `busy`, per-use widths); Dialog (plain, danger confirm, one-button "blocked" variant, required-field form); Popover; Menu (`role="menu"`, `menuitemradio`); Dropdown with search; Toast, ToastProvider and useToast (one engine; `useDesignToast`, `useSettingsToast` and `useReportToast` delegate to it); FormField, FieldGrid, Input, Select, Textarea, DateInput, MonthInput, DateRangeInput (all dates on the shared calendar), Toggle (`role="switch"`), Slider, Checkbox; ApprovalRow (Undo, reason dialog); PanelButton; `kitIcon`. `HrDrawer`, ui-kit `Overlay.tsx` (Radix centring kept) and `ConfirmDialog` are rebuilt on it. | Hand-built. Live check `live-rd-f2b-overlays.mjs`; the unit harness runs in StrictMode with no new dependencies. |
| **F2c data and layout** (new) | DataTable built on F2a's `Table`: selection, bulk-action bar, sort, pager, horizontal scroll inside the card, a card list below 640 px. SectionGrid (the design's `UtSections`, full and half widths). WeekGrid (roster and team schedule). ActionCard. UploadDrop. CheckList. AmountMask and `useAmountMask` (`localStorage['ut.hideAmounts']`, try/catch, masks the accessible name too). DateChip (the header date chip on the shared calendar). Timeline. Barrel `data.ts`, styles `data.css`. Missing glyphs are added to `design/dc/icons.tsx`. | Hand-built. New files only; nothing F2a already made is duplicated. |
| **F2d legacy restyle** | `design/module/ModuleKit.tsx`, `design/settings/SettingsKit.tsx`, the non-overlay parts of `shared/components/hr.tsx`, `shared/components/{EmptyState, StatCard, DataTable, HrPagination, PageSkeleton, SkeletonCard}`, `design/dc/{StatTile, SectionState, ApprovalCard, SubTabs, DatePicker, TimePicker, DesignFrame}.*`, the shared calendar TSX (`shared/components/calendar/**`, re-tokened and never replaced). All are rebuilt on the kit and tokens with the same props, so their 100+ importers upgrade in place. | Hand-edit, same API. |
| **F3a shell** | `design/shell/HeaderTabs.tsx` (the contract below), AppRail, PagesPanel, MorePanel, TopBar, HelpPanel, `useHome`, the navigation-guard API. | Hand-built. |

**Shell contracts that pages rely on** (REDESIGN_RULES):
- `HeaderTabs` (`@/design/shell/HeaderTabs`) takes `{label, items: {key, label, count?, urgent?}[], active, onChange, semantics?: 'views'|'tabs'}`. It renders into the header slot through a portal, or inline when there is no slot. It keeps `role=group` + `aria-pressed` (views) or `role=tablist`/`tab` (tabs).
- `ModuleKit.Views` and `design/dc/SubTabs` gain `placement?: 'header'|'inline'`, default `inline`.
- Pages render the kit `PageHeader`.
- The rail highlight comes only from `railLit.ts`.
- Toasts go through `useDesignToast` or `useSettingsToast`.
- Pop-ups use the kit SidePanel, Dialog, Menu and Popover.
- The shell owns the `/dashboard` → `/me` routing and `useHome()`.
- The navigation-guard API replaces `window.__utLeaveGuard`. The legacy employee form's guard (N11) stays a native `window.confirm`.

### 4.5 Converter vs hand-built

- The kit is hand-built (DECISIONS 10). The patched converter (`scripts/dc-to-tsx.mjs`, F4: an 8-line fix plus a folder mode) may be used once per page as a scaffold. The page must end up on kit components and tokens, never inline copies of cards, pills or buttons.
- Generated views (`design/dc/*.view.tsx`, `design/master/MasterDesign.tsx`) are hand-edited by F1 (font and weights) and later taken over by their page packages. F4 makes `scripts/design-build.mjs` and `master-build.mjs` skip any view that carries a `// hand-owned` marker instead of overwriting it, and fail loudly on a missing anchor. Changes to `MasterDesign.tsx` still go through `scripts/master-patches.mjs` (P-WF-SETUP owns both).
- `e2e/recovery/capture-prototype.mjs` (F4) captures every role, page and tab of the prototype into `redesign/ref/` for side-by-side checks.

### 4.6 Pop-ups (161 instances; each page package converts the ones its files open)

- **Rules:**
  - Keep one `role="dialog"` per pop-up, named by its visible title.
  - Panels keep the "Close panel" label.
  - Focus is trapped and returned to the opener.
  - Escape closes only the top layer (the calendar first).
  - `busy` blocks every way to close.
  - Nested panels stack correctly.
  - `InlineCreateModals` stays portalled over the legacy form.
  - `backdrop-filter` only on a sibling backdrop, never on a panel or `.ut-card`.
  - Widths are set per use.
  - Radix centring is kept.
  - Step panes hide instead of unmounting.
  - Titles move to sentence case, with the tests updated and their behavioural checks kept.
- **Conversions:**
  - `window.confirm` → `useConfirmDialog()` (N1–N10, N12–N18, N20–N22). N19 may await a Dialog. N11 stays native (DECISIONS 18).
  - `window.prompt` P1 and P2 → a Dialog with a required field (P1 needs at least 3 characters).
  - Master overlays are restyled through `master.css` and `master-patches.mjs` (P-WF-SETUP).
  - Hand-rolled X1–X4 and Y1–Y2 → kit components.
  - Popovers and menus → kit Menu or Popover, keeping their roles.
  - The company picker becomes a Dropdown with search.
- **Left untouched** (DECISIONS 18; listed for the user's approval): `attendance/EmployeeShiftAction.tsx`, `employees/workspace/shared.tsx` `ActionModal`, `SettingsLeaveModal`, `shared/components/CommandPalette.tsx`, `shared/components/NotificationPanel.tsx`, `shared/layouts/DashboardLayout.tsx`, `shared/layouts/Header.tsx`, ui-kit `Modal.tsx`/`Drawer.tsx` (not exported), and the Tabler Icons `<link>`, which F1 removes because it is a render-blocking stylesheet with no users.

### 4.7 Page-specific pieces (stay in their page package)

| Piece | Package |
|---|---|
| Payslip body | P-PAY-CORE; P-MYPAY imports it |
| Settlement components | P-PAY-EXTRA |
| KPI history | P-GROW |
| Letter preview | P-DOCS |
| Face camera | P-PROFILE |
| Distribution recipient filter | P-DOCS |
| Bank UTR capture | P-PAY-CORE |
| Leaflet map with the geofence ring | P-COMP |

---

## 5. Decisions (the user delegated these; made here, with reasons)

The binding rules are DECISIONS 1–18. Everything below either applies them to a specific screen or settles a point they leave open. Where it was unclear, the existing behaviour was kept.

### 5.1 Menu grouping (DECISIONS 11)

**Decision.** The design's rail groups are a presentation layer over today's menu items. Every item keeps its internal key, its path and its `MENU_RULES` key.

| Group (design label) | Today's items placed in it |
|---|---|
| Home | Dashboard or Home (by §5.2), Companies & branches |
| My team | `/team` (Team today · Team schedule · Approvals); today's rule |
| My work (never for OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN) | My time (`/hrms/attendance?tab=my`, `/me/wfh`, `/me/shift-change`), My leave (`/hrms/leave`), My pay (`/me/payslips`, `/me/salary`, `/hrms/expenses?tab=my`, `/hrms/advances?tab=my`, `/hrms/pli` for `pli.read.self`), My documents (`/hrms/letters/my`, `/hrms/documents?view=my`, `/me/assets`, `/hrms/policies`), My growth (`/hrms/performance?view=my-reviews`, `/hrms/learning?view=my`, `/me/interviews`) |
| People | Workforce (Master overview, Workforce Directory, Organization Setup, Rules & Policies, **Payroll Configuration** kept here), Hiring & onboarding, Performance, Employee exit |
| Time | Attendance (Attendance Analytics, Daily Tracking, Shifts & Overtime), Leave Operations Center |
| Pay & benefits | Payroll (today's pages), Expense Center |
| Org & policy | Compliance (Statutory Compliance, Muster Roll), HR setup (HR Configuration, Notification Templates, Integrations) |
| Insights | Reports Center, Workforce Analytics |
| Business apps | CRM, Accounts, Projects, Inventory, Purchase, from `useModulePlans()`, for plan admins only |

**Details:**
- The My work keys each get their own `MENU_RULES` entry: a copy of today's ESS rule for that page, with the admin-role exclusion. They are added to `railLit.SELF_SERVICE_RAIL`, so "the item you came through stays lit" still holds.
- A "My" label is used where the short name would clash with a visible admin item. For example "Leave" (Time) and "My leave" (My work).
- Page order inside a module and the tab names and order stay as today. For example, Attendance Analytics stays first, so a rail click lands where it does today.
- The header gear and the profile menu go. Settings open from More → Settings → Preferences, which goes to the first settings page the person can open. More lights on settings pages.
- More → My space holds My workspace (`/me`), My profile (`/profile`) and All apps (`/modules`). Help & support is a panel listing the workspace's admins (BW-01). No vendor name appears anywhere.
- Rail group labels are white at .80 alpha (4.6:1). The top block opens the person's Home. The pin state is stored in `ut.rail.pinned`.

**Why.** Who sees what, every URL and every route guard stay exactly as they are; only placement and labels change. `MENU_RULES` is keyed by group, so renaming a key would silently fall back to a broader rule and widen access. Keeping today's page and tab order means existing links, notifications and muscle memory still land in the same place.

### 5.2 Home selection (DECISIONS 12)

**Decision.**
- **Admin home.** `adminHome` = anyOf `hrms.employee.read`, `payroll.runs.read`, `org.company.write`, `hrms.report.{headcount, attrition, attendance, leave, diversity}` → the admin dashboard at `/dashboard`.
- **Everyone else** → the self-service Home at `/me`, and `/dashboard` redirects them there. `RoleDashboard` is no longer routed.
- **Neither** → the first page they can open, else `/no-access`.
- **Team blocks** on Home and the My team group: anyOf `attendance.team.read`, `hrms.leave.approve.l1`, and not `hrms.employee.read`.
- `MENU_RULES['/dashboard']` and the registry `dashboard` entry use the same rule. The self-service entry is labelled "Home". Greetings use `greetingName()`.

**Why.** It is permission-driven (custom roles stop falling back to the old staff dashboard), needs no new permission and no migration, and matches the README and DECISIONS. Department managers and managers move to Home with team blocks. They keep their team's day split on Team today and Home, and company notices and milestones in "Around you". Nothing they could see today disappears.

### 5.3 Tabs: design against today

**Rule.** Today's tab names and order win. A design tab that is a real new feature is added where the design places it, relative to today's tabs. A design tab that only renames, merges or drops something is not applied; its content goes inside today's tab.

| Page | Tabs after the redesign |
|---|---|
| Daily Tracking (HR) | Daily Logs · Face Punch · Regularization · Review · My Attendance · **Timesheet** |
| Daily Tracking (staff) | My Attendance · **Timesheet** · Regularization |
| Attendance Analytics | Overview · **Punctuality** · Calendar |
| Shifts & Overtime | as today (Overtime stays here; the overtime-rules card sits inside it) |
| Leave | today's tabs, with **All balances** (new key `all-balances`) added after Decided. `balances` stays the person's own. The first tab is unchanged. |
| Resignation & exit | On notice · Exited · Terminated, now kept in `?tab=` |
| Workforce Analytics | **Headcount · Attrition · Diversity** (`?tab=`), from today's single page |
| `/team` | **Team today · Team schedule · Approvals** (`?view=`), with Approvals tabs All · Leave · Attendance · Requests · Expenses |
| Settings row | today's list, with **Document types** after Integrations |
| `/profile` | tabs by the person's own permissions, plus **Preferences** |
| Workforce Directory | header pills = today's Master tabs (Employee Master · Contractor Master · Classification Rules); the design's status tabs become in-page status pills |
| Onboarding, Vault, Letters, Hiring, Performance, Learning, Payroll, Expenses, PLI, Advances, F&F, Compliance, Reports | today's names and order |

**Why.** DECISIONS 11 says tab names and order stay; deep links, notifications, the registry and the live tests all use today's `?tab=` keys.

### 5.4 Shell

- **Search.** BW-02 to BW-05 are built. "On this page" shows only on pages that read `?q=`. The dialog keeps Records, Recent and the "/" navigation.
- **Header default.** The README and `HrmsPlatform`'s own props say Header A (outlined pills) with the quick-action tile row; `saved-designs.md` ("Header C, icon dock") is outdated. The README wins, so `UtQIcon` is not built.
- **Mobile.** The mobile shell is restyled (not designed): the drawer is the expanded rail plus More.
- **Unchanged.** `ComingSoonRoute` is unchanged. No "Viewing as" (DECISIONS 7).
- **Navigation guard.** A shell navigation-guard API replaces `window.__utLeaveGuard`, so the unsaved-changes guards keep working in the new chrome.

### 5.5 Admin dashboard

- **Company summary.** The data moves; nothing is removed. Active employees go into the Total employees note, open roles into the pipeline sub-line, finalized payroll into the payroll headline, and compliance completion becomes a compact line in Upcoming.
- **Quick actions.** Customise defaults to today's six tiles, sorted by use. Each tile is gated by its target page's registry rule, so a tile never leads to a dead end.
- **Needs your action.** The Leave tile includes WFH requests (as the Leave page does). Counts come from the same lists as the rows.
- **Project health.** Delayed = past due and not complete. At risk = due within 14 days and under 75 % of tasks done. The rule shows in a tooltip.
- **Hiring funnel.** Exact from the stage-history migration onward; "—" before it.
- **Attendance.** `attendanceBuckets` is unchanged: Present includes WFH, and nobody is Absent before the day is over.
- **Seats.** The strip shows at ≥ 90 % used; billing managers always see a compact seats line.
- **Kept.** `DashCalendar` (not the design's five-day list), the past-date banner and "As of" labels, and Edit / Archive (with confirmation) / pager, which move into the notice panel. The design's section pills are shown in the header.
- **Not built.** Notice audience and the V1 variant.

### 5.6 Workforce

- **Directory.**
  - Status pills: All (default; today's default shows everyone and `live-directory-export` expects the full count), then Active (ACTIVE only), Probation, On notice, Exited, Suspended ("since {date}").
  - Kept: the row ⋮ menu (View profile, Edit details, Start exit), bulk Change status as a fourth bulk action, the milestone filter, the pager and the `?q=` box.
  - A row click opens the full profile.
- **Fixed.** `?add=1`, `?companyId=`, the permission-gated buttons, and the shift gate (`attendance.workforce.admin`).
- **Add employee.**
  - "Paid through payroll" comes from the employment type.
  - Today's validation rules stay: branch stays required, and the Access step is step 3 of 4, shown only with the rights. A future joining date is allowed ("Joins {date}").
  - The salary hint says the structure is set up in Payroll. No structure is created.
  - Drafts never store PAN, Aadhaar or bank details.
  - Onboarding start is opt-in: on by default for Add when an active checklist exists, off by default for Import.
  - "Anywhere (no geofence)" is built (BW-28). Alternate Saturdays are not.
  - No manager notice (DECISIONS 13).
- **Import.** Imports keep ACTIVE status, as today. "Mark fixed" becomes "Upload the fixed file", because commit is all-or-nothing.
- **Org setup.** Today's tabs and order; `/hrms/organization` still opens Companies. The cost centre is built (BW-95).
- **Rules & policies.** Leave rules stay editable, with an "Open leave types" link. Policy authors reach their reading view through `PoliciesRoute` at `?view=documents`.
- **Look.** The preview card is white in light mode and uses surface tokens in dark.

### 5.7 Attendance

- **Tabs.** Today's tabs, plus Timesheet and Punctuality (§5.3). Overtime stays under Shifts.
- **Manual entry.** Stays its own route and returns to the muster roll for the same day. Its Save gate is fixed.
- **Absent card.** Kept, with the client rule.
- **Review.** Keeps Excuse and Change status; there is no Undo on Review.
- **Face.** Shown as a band only; the Face Punch tab stays.
- **Kept.** The status-change drawer and the date chip (shared calendar).
- **Overtime rules.** Edited in HR configuration, with a read-only card on the Overtime tab. They change only which minutes are counted and approved, never stored hours or pay. Off-day and holiday rates and payout are not built.
- **Rows.** Pending leave shows separately from approved leave. The "target under 3 %" note is dropped.
- **Export.** The day-register export is gated by `hrms.report.attendance`.

### 5.8 Leave and payroll run

- **Leave tabs.** `balances` stays the person's own; "All balances" is new, after Decided (§5.3). The self tabs are kept.
- **Leave fixes.** PENDING_L2 is fixed (level-2 approvers see "Awaiting HR"). Bulk approve is built. Holiday edit is built.
- **Leave not built.** Branch holidays in counts, optional holidays and comp-off (they change balances and pay).
- **Run: review.** On hold is not built. "Needs review" comes from the checks (BW-51).
- **Run: not built.** TDS and overtime pay are not built. The TDS row says "Not calculated yet".
- **Run: register.** "Export register" before lock downloads today's CSV; the PDF register appears after lock, as today.
- **Run: current-run rule.** This month's run of the company chosen last, else the latest run that is not cancelled.
- **Run: buttons.** Each is gated by its own permission.

### 5.9 Pay

- **PLI.** Pools pay at 100 % (today's rule); the design's 85 % is not shown. The rating basis stays a number.
- **Payroll settings.** TDS is a read-only note. There is one date: "Payroll is processed on {date}".
- **Advances.** "Raise an advance" keeps today's flow; the plan preview is BW-62.
- **Expenses.** Mark reimbursed is kept. The copy says claims are paid through reimbursement batches. Existing categories, the expense date and New run are kept.
- **My pay.** The EmpPay design is used for everyone. The month being prepared shows without figures (BW-55).
- **Bank.** The Bank profiles pill opens `/hrms/bank-disbursement/setup`.
- **Forms.** Side panels everywhere, instead of the prototype's in-page sub-views, because today's tests and flows expect panels.
- **F&F.** Suggestions are not built.

### 5.10 Talent

- **Tabs.** Today's tab order: Onboarding is New hires · Assets · Checklist templates; Vault is My documents · Employee documents · Letter templates. The Letter templates view is kept.
- **Pipeline.** Defaults to Table, with a Board toggle. The board keeps drag and drop, Reject, Withdraw, the drawer and the `<article>` cards the tests use.
- **Candidates.** Stage history is built. Starting a candidate at a chosen stage is not (the no-skip rule is checked by `live-w2a`).
- **Offers.** The offer email lives in a side table.
- **Wizard.** The RBAC Access step, the route and the labels are kept. Assets are picked from the store and given on creation, dated today. The asset label "Returned" is kept.
- **Distributions.** The wording is "sent" and "failed". "Send on" is built (BW-73).
- **Void and Reject.** Both ask for a reason in a dialog.
- **Signing.** Click-to-accept e-signature (typed name, time, IP), with no PDF stamp.
- **My letters.** Unsent drafts are hidden; voided letters show as "Withdrawn".

### 5.11 Growth and reports

- **Company KPIs.** Built: weighted-average progress of linked goals. Lower priority.
- **Review cycles.** Milestone dates and "hold feedback until shared" (off by default) are built, with Share. Calibration is a label only.
- **Ratings.** The admin label set with decimals is kept. No per-cycle scale.
- **Reminders.** Remind sends a real notification. There is no morning job (DECISIONS 13).
- **Learning.** Five skill words (the database keeps 1–5). Rejecting a skill needs a note. Program location is added (side table). No course-style learning.
- **Kind words.** Taken from the strengths in submitted reviews; no kudos feature.
- **Exit.** Tabs go into the URL. The reason shows only to `hrms.employee.write` holders. Seven exit types, as today.
- **Reports.** No pins and no custom builder. "Live" replaces "Updated N ago". Schedule options are built (BW-89). Workforce analytics becomes 3 tabs.

### 5.12 Setup and admin

- **Compliance.**
  - POSH department is stored in a side table. There is no "Closed" status; Resolved and Dismissed stay final.
  - Filed date is built (≤ today; LATE is worked out from it).
  - FilingCalendar moves to the shared calendar.
- **Settings.**
  - Settings pills are today's list plus "Document types" after Integrations.
  - Preferences opens the first allowed settings page.
  - SettingsKit behaviour is kept, restyled: section list, unsaved-changes bar, error jump, leave guard, view-only notice.
- **Integrations and billing.** OAuth workspace integrations and invoices are not built.
- **Users.** Module access is shown read-only.
- **Security.** A session's "where" shows the IP address.
- **Frames.** PgWorkspace is not built. PgGeneric is used only as the layout for the Coming soon pages.

### 5.13 Companies and profiles (DECISIONS 17)

- **My profile.** `/profile` gets the new layout plus a Preferences tab that keeps the `#st-…` anchors and the "keep in view while sections above load" behaviour. Self-edit is as today. An admin's own profile hides Attendance.
- **Profile data.** BW-97 to BW-101 are built. A manager sees a direct report's profile, with pay, bank and identity left out.
- **Lifecycle actions.** They follow the status. The design's 2-up row shows the two most relevant; the rest go in a More actions menu. No status loses an action.
- **Branches.** The branch check-in switch keeps its meaning; only its copy changes. Radius 25–5,000 m with a slider plus a number field; existing branches above 500 m stay valid. A blank branch code shows "None".
- **Companies page.** The Inactive view and Restore are kept. Industry becomes a combobox (suggestions plus free text). The HQ hint keeps today's accurate wording.
- **On-behalf actions.** Leave and claim on behalf use new permissions that mirror advance-on-behalf. Lower priority.

### 5.14 Home and team

- **Home.** Web check-in is behind the company switch, off by default. Without it, "Your day" is read-only.
  - Undo check-out is allowed within 10 minutes.
  - Breaks pause only the timer.
  - Leave beyond the balance is refused, with the real reason.
  - "Explain the late mark" opens today's fix request (option A).
  - The WFH card shows "N days this month" only.
  - Colleagues off shows first names, same department, approved leave only.
  - The payroll line reads "Payroll is processed on {date}".
- **Team.**
  - The reviews card uses the newest ACTIVE cycle in which the caller has assignments.
  - A "thin" day is one with under half the team in.
  - The half-day tile shows only when non-zero.
  - The greeting moves to Home; Team today's title is "Team today".
- **Probation.** Managers see dates. Confirm and Extend need `hrms.probation.team.decide`, granted only to OWNER and SUPER_ADMIN by default.
- **Inbox.** The design's kinds only, with `canDecide=false` rows. Overtime, advances and skill approvals stay on their own pages.
- **Reminders.** Available to `attendance.team.read` holders, within their team scope, at most once per person, day and reason.

### 5.15 Not built, and why

| Design element | Why not |
|---|---|
| Notification events the backend never sends (payslip ready, payroll ready for review, probation ends soon, self-review due, not-checked-in, onboarding finished, manager told of a new hire, morning review reminders) | DECISIONS 13 |
| Optional holidays, branch holidays in counts, comp-off earned and expiry, leave beyond the balance as unpaid | They change attendance, leave or payroll numbers for existing companies (DECISIONS 16) |
| Payslip On hold, TDS engine and regime options, overtime pay, a separate pay day, PLI 85 % threshold, rating basis as a type, advance limit, F&F suggestions | Pay and business rules that need the client's decision; the design's copy is adjusted |
| WFH allowance "of 6" | DECISIONS 15 |
| Undo for overtime, advances, PLI, face decisions, skills and Review | DECISIONS 15: Undo covers the five inbox kinds only |
| Alternate-Saturday weekly offs | Change every day count (attendance, leave, payroll) |
| Starting a candidate at a later stage | Breaks the no-skip hiring rule |
| IT access switches (email, Slack, GitHub), workspace integrations (Slack, Teams, Google), invoices and payment method, receipt OCR, session location lookup | Need outside services or credentials (no GCP) |
| Course-style learning, report pins, a custom report builder, kudos, notice audience, per-cycle rating scale, "who reviews" preset, a POSH "Closed" status, asset reservations, suspension records with reasons | No design for the admin side, or they change existing rules; the design's copy is adjusted |
| Self-edit of names, city and emergency contact; server-made branch codes | DECISIONS 17 |
| Probation auto-extend | Stays inactive (DECISIONS 15); reported as found-not-fixed |
| "Viewing as", `UtArt` 3D art, the `UtQIcon` dock, `PgDashboardV1`, `PgWorkspace`, `ReviewBoard`, `SavedHeaderTiles`, `StyleGuide` as a page | DECISIONS 7 and 14; superseded variants and review pages |
| "Target under 3 %", the design's five-day date list, a company logo upload | No setting or design behind them; today's calendar is kept |

### 5.16 How the build is organised

- **Backend folded into page packages.** Each backend file cluster is owned by exactly one page package (§3.3 headings), which builds every BW item in it, including items other pages need. A package whose endpoints others need does its backend half first and merges it into `rd/int` as soon as it is green: the **`.be` milestone**. Dependents list `<PKG>.be`. They may start their UI earlier against C0's typed hooks, but they rebase onto the `.be` merge before their final live run.
- **Seams.** F3a points `App.tsx` at small route files so two packages never share a page file:
  - `workforce/DirectoryRoute.tsx` for `/hrms/employees`
  - `attendance/AnalyticsRoute.tsx` for `/hrms/att-analytics`
  - `attendance/ShiftsRoute.tsx` for `/hrms/shifts`
  - `payroll/PliRoute.tsx` for `/hrms/pli`
  - `advance/AdvancesRoute.tsx` for `/hrms/advances`

  Each renders today's component until its owner replaces it. Q1 removes the dead branches left behind.
- **Hooks.**
  - Each existing hook file has one owner (§6).
  - A new hook goes in a new file owned by the package that uses it.
  - A hook two or more packages need is created by C0 in `modules/hrms/api/shared/`, typed from §3.
  - A package that needs a new response field from a hook file it doesn't own extends the type locally (`type Row = WfhRequest & { approverName?: string }`) instead of editing that file.
- **Registry, routes and guards.** All of them (new tabs, `/team` views, the `/team` guard widened with the four approve codes, `PoliciesRoute`, Home rules) are done once by F3a from this plan, so no page package edits `pageRegistry.ts`, `App.tsx` or `PlatformShell.tsx`. If a page package finds it needs one more registry, route or guard change, it reports it, and the lead applies it at merge.
- **Notification types.** C0 adds every new `AppNotificationType` and catalog entry: `DECISION_UNDONE`, `CHECKIN_REMINDER`, `PERFORMANCE_REVIEW_REMINDER`, `TEAM_MESSAGE`, `ASSET_ISSUE_REPORTED`, `PAYSLIP_QUERY_RAISED`, `PAYSLIP_QUERY_ANSWERED`, `LEAVE_APPLIED_ON_BEHALF`, `EXPENSE_CLAIM_RAISED_FOR_YOU`, `TIMESHEET_SUBMITTED`, `TIMESHEET_DECIDED`, `LETTER_SIGNATURE_REQUESTED`. F3b adds their web routes and icons.
- **Tests.**
  - `live-staff-dashboard.mjs` is rewritten by P-HOME against `/me` (and the `/dashboard` redirect), keeping every behavioural check.
  - Multi-page scripts (`live-w3-r1/r2/r3/r4`, `live-dead-entrypoints`, `live-new-admin-browser`, `live-w3-greeting-myatt`) are edited block by block, each package only its own blocks. The lead resolves merges, and Q1 re-runs the whole gate.

---

## 6. Build plan

### 6.1 Phases and order

```
Phase 0  (done)   this audit
Phase 1  (first, fast)
   G0 baseline gate on e32a4dc6 ─────────────────────────────────────────────┐
   F1 theme ─┬─ F2a kit display ─┬─ F2b kit overlays (done)                  │
             │                   └─► merge F1 → F2a → F2b into rd/int         │
   C0 contracts ──► merge   F4 tools ──► merge                                │
             then in parallel:  F2c kit data   F2d legacy kit   F3a shell     │
             merge F2c, F2d, then F3a (its last step, `placement`, after F2d) ┘
Phase 2  (pages; each with its own backend and pop-ups)
   backend halves may start as soon as C0 is merged; UI halves start once F3a is merged
   ★ = merges its backend half first (".be") because others need its endpoints
   Wave A: ★P-TEAM ★P-ATT-DAY ★P-ATT-PLAN ★P-PAY-CORE ★P-WF-PEOPLE ★P-LEAVE ★P-HIRE
           ★P-HOME.be (backend half only)   + P-COMP  P-REPORTS  P-ADMIN  F3b
   Wave B: ★P-DASH ★P-EXP ★P-PAY-EXTRA ★P-DOCS ★P-GROW  P-SETUP ★P-WF-SETUP  P-MYPAY
   Wave C: P-HOME (UI)  P-PROFILE    (they bring the most sources together)
Phase 3  Q1 integration and QA (lead): full gate + every live-rd test, then the single merge to main
```

**Machine limits** (RULES.md):
- At most 2 heavy commands at once through `heavy.sh` (mvn, tsc, vite build, eslint over many files).
- One live slot through `live-slot.sh`, which recreates `ut_w3_dev` from `ut_w3_base`.
- A Vite dev server runs only while it is in use.

So the lead runs about 4 packages at a time and queues the rest in the wave order above. Waves are an order of preference, not barriers: a package starts when its `depends_on` are merged.

**Merge order into `rd/int`:**
1. F1 → F2a → F2b → C0 → F4 → F2c → F2d → F3a.
2. Then each `.be` half as soon as it is green.
3. Then the page packages as they finish.

F1, F2b, F2d and F3a all touch `ModuleKit.tsx`, `SettingsKit.tsx` or `hr.tsx`, so they merge strictly in that order and each later one rebases first.

**Nothing is pushed.** `main` is merged and pushed once, when everything is green (DECISIONS 9), and only by the lead.

### 6.2 Tests every package runs (PACKAGE_BRIEF)

1. **Static checks:** `tsc` clean, `eslint` with 0 errors on changed files, and `vite build` (all through `heavy.sh`). `vitest` for the pure logic the package adds, with no new test dependencies.
2. **Backend:** `mvn` package and the tests of every module it touches, through `heavy.sh` with JDK 21. Each new endpoint gets unit tests for permission, scope, validation and the missing-table case.
3. **Its own live test** `apps/platform/e2e/recovery/live-rd-<package>.mjs`, run through `live-slot.sh`. It checks:
   - real data renders
   - no page errors and no unexpected 4xx/5xx
   - each role sees exactly what it may: owner, hrm, fin, mgr and reader, plus a custom role where relevant
   - light and dark
   - the main actions work end to end
   - a step that renames each new table in `ut_w3_dev` and expects the block's "not available yet" state, then renames it back
   - it deletes everything it creates
4. **Existing live tests** that cover its pages (§6.4): run them, update selectors or titles, and keep every behavioural check.
5. **Screenshots** at 1440 and 390, light and dark, saved to `/c/REACT/ut-wt/_results/shots/rd-<package>-*.png`, compared side by side with `redesign/ref/<role>/…` and fixed until they match.
6. **Pop-ups:** every pop-up its pages open moves to the kit SidePanel, Dialog, Menu or Popover, keeping `role="dialog"`, its accessible name, "Close panel" and "Try again".
7. **Final report** in the PACKAGE_BRIEF format, including `behaviour_changes`, `gaps_left` and `risks`.

### 6.3 Packages

Path shorthands used below:
- `src/` = `apps/platform/src/`
- `be/` = `backend/app/hrms-api/src/main/java/com/hrms/api/`
- `mig/` = `backend/app/hrms-app/src/main/resources/db/canonical/`
- `e2e/` = `apps/platform/e2e/recovery/`

A package owns only the files listed for it; every other file is read-only to it. Backend "module" means the matching module under `backend/modules/`.

#### Phase 1

**G0 · Baseline gate** (lead)
- **Owns:** `/c/REACT/ut-wt/_results/baseline-e32a4dc6/**` (results only).
- **Depends on:** —
- **Scope:** run `_tools/final-run.sh` (55 scripts, 5 streams) on `rd/int` at `e32a4dc6` through the live slot. Record pass or fail per script and every failure that already exists, so no package is blamed for it.
- **Tests:** the gate itself.

**F1 · Theme, tokens, font**
- **State:** in progress; 3 commits (`25e9ddfb`, `4235b7e2`, `627c3a1e`).
- **Owns:** `index.html`, `src/main.tsx`, `src/globals.css`, `tailwind.config.js`, `packages/design-system/src/tokens.css`, `src/design/theme/{tokens.css, base.css, dark-bridge.css, theme.ts, ThemeProvider.tsx, index.ts, theme.test.tsx}`, `src/providers/ThemeProvider.tsx`, `src/shared/components/calendar/calendar.css`, `src/core/tenant/workspaceBranding.ts`, and the font, weight and colour-only edits already in its commits (generated `design/dc/*.view.tsx`, `DesignFrame`, `ModuleKit`, `SettingsKit`, `ShellChrome`, `TopBarSearch`, `GlobalSearch`, `WorkspaceMark`, `BrandingTab`, `StatusChangeDrawer`, `FaceEnrollDrawer`, `workspace/shared.tsx`, `EssDashboard`, `shared/export/charts.ts`), plus `e2e/live-rd-theme.mjs`.
- **Depends on:** —
- **Prototype:** `StyleGuide.dc.html`, `hrms-core.js` (`DARK`), `HrmsPlatform.dc.html`.
- **Scope:** §4.1–4.2. Light and dark tokens, a no-flash theme, `ut.theme`, pre-auth pages always light, Plus Jakarta Sans 400–600 only, a weight clamp, and a dark bridge for pages not yet rebuilt. The switch itself is placed by F3a.
- **Tests:**
  - `theme.test.tsx` (vitest); tsc, eslint and build.
  - `live-rd-theme` (light by default, dark from the saved choice, sign-in stays light, one font).
  - The whole 55-script gate against the G0 baseline, because it touches fonts on many pages.

**F2a · Kit: display and motion**
- **State:** in progress; `6ab88269`, `379f0abe`, `317b24e6`, and uncommitted Button, Callout, ColumnChart, Ledger, StepTrack and Table.
- **Owns:** `src/design/kit/{PageHeader, PillTabs, SearchPill, StatCard, QuickActionTile, AnimatedIcons, Card, Section, ListRow, StatusPill, Avatar, EmptyState, Skeleton, ProgressBar, Meter, Ring, MonthCalendar, SegmentedControl, FilterPills, Sparkline, Button, Callout, ColumnChart, Ledger, StepTrack, Table, displayUtil}.tsx` and their tests, `display.css`, `display.ts`, `src/design/theme/motion.{ts,css,test.tsx}`, `apps/platform/kit-harness.*`.
- **Depends on:** F1.
- **Prototype:** `UtStat`, `UtLive`, `UtAniIcon`, `UtQuick`, `UtEmpty`, `UtSection`, `UtSections`, `StyleGuide`, `hrms-fx.js`.
- **Scope:** §4.3–4.4.
- **Tests:** vitest (display, motion, MonthCalendar, Table, Button, section bodies); tsc, eslint and build; harness screenshots in light and dark at 1440 and 390; a live harness check.

**F2b · Kit: overlays and forms**
- **State:** done: `b1d742fa`, `47bc1f4d`.
- **Owns:** `src/design/kit/{SidePanel, Dialog, Popover, Menu, Dropdown, Toast, FormField, ApprovalRow, PanelButton}.tsx`, `overlayCore.ts`, `overlays.css`, `overlays.ts`, `src/design/kit/__tests__/**`, the overlay parts of `src/shared/components/hr.tsx`, `src/shared/components/ConfirmDialog.tsx`, `packages/ui-kit/src/components/Overlay.tsx`, the toast delegation lines in `ModuleKit.tsx`, `SettingsKit.tsx` and `reports/ReportKit.tsx`, and `e2e/live-rd-f2b-overlays.mjs`.
- **Depends on:** F1.
- **Prototype:** `PgCompanies` (side panel), `HrmsPlatform` (toast, dialog, backdrop), `UtMore`.
- **Scope:** §4.4 and §4.6 contracts.
- **Tests:** `overlays.test.ts` (StrictMode harness), `live-rd-f2b-overlays`, and the gate scripts that open drawers: `expense-batches-live`, `live-w3-r1`, `live-compliance-modals`, `performance-admin-live`.

**C0 · Contracts and conventions**
- **Owns:**
  - Backend: new `backend/shared/hrms-core/src/main/java/com/hrms/core/exception/FeatureNotReady.java` and its test; `backend/platform/platform-notifications/src/main/java/com/unifiedtree/notifications/enums/AppNotificationType.java`; `…/template/NotificationEventCatalog.java` and its test.
  - Frontend: `packages/sdk/src/permissions/codes.ts`, new `src/core/api/featureNotReady.ts` and its test, `src/providers/QueryProvider.tsx` and its test, new `src/modules/hrms/api/shared/**`.
- **Depends on:** —
- **Prototype:** —
- **Scope:**
  - The FEATURE_NOT_READY helper on both sides (DECISIONS 18). `isRetryable` never retries it.
  - The 12 new notification types and their catalog entries (§5.16).
  - The 5 new permission constants.
  - Typed hooks and `contracts.ts` for every endpoint that two or more packages use: `useDecisionUndo`, `useRecentDecisions`, `useReminders`, `useApprovers`, `useTeamSummary`, `useTeamTimeOff`, `useApprovalsInbox`, `useTeamProbation`, `useTeamMessages`, `useUiPrefs`, `usePaySchedule`, `useOvertimeRules`, `useShiftChangeSelf`, `useTimesheetDecision`, `useAdminContacts`.
  - Each hook treats FEATURE_NOT_READY and 404 as "not available" and never throws into the page.
  - No endpoints, no UI.
- **Tests:**
  - Backend unit tests: 42P01 and 42703 become 503 FEATURE_NOT_READY; other SQL errors are rethrown; the catalog test covers the new types.
  - vitest (`isRetryable`, detection, hooks' "not available" mapping).
  - tsc, eslint and build; `mvn` for `hrms-core` and `platform-notifications`.

**F4 · Tools**
- **Owns:** `apps/platform/scripts/design-build.mjs`, `apps/platform/scripts/dc-to-tsx.mjs`, `apps/platform/scripts/master-build.mjs` (guard only), new `e2e/capture-prototype.mjs` (from `redesign/proto-capture.mjs`).
- **Depends on:** —
- **Prototype:** all of them (for the capture).
- **Scope:**
  - The build scripts skip, with a warning, any file with a `// hand-owned` marker, and fail loudly on a missing anchor instead of writing a broken view.
  - The converter gets its 8-line fix and a folder mode.
  - The capture tool writes role/module/page/tab screenshots in light and dark at 1440 and 390 into `redesign/ref/`.
- **Tests:**
  - Run each build script on a copy: a marked file is untouched, and unmarked output is byte-identical to today's.
  - The converter on 3 prototype files compiles with tsc.
  - The capture of 3 screens matches the existing refs.

**F2c · Kit: data and layout**
- **Owns:** new `src/design/kit/{DataTable, SectionGrid, WeekGrid, ActionCard, UploadDrop, CheckList, AmountMask, DateChip, Timeline}.tsx` and their tests, `src/design/kit/data.css`, `data.ts`, and additions only to `src/design/dc/icons.tsx`.
- **Depends on:** F1, F2a, F2b.
- **Prototype:** `PgDirectory` (table, bulk bar), `TeamSchedule` and `PgTime` roster (week grid), `EmpDocs` (upload), `EmpHome` (timeline, checklist), `EmpPay` (hide amounts), `PgPayroll` (table), `UtSections`.
- **Scope:** only the pieces missing from F2a's final `display.ts` (§4.4). Nothing is duplicated.
- **Tests:**
  - vitest: sort, paging, selection, amount masking, week maths.
  - tsc, eslint and build.
  - `live-rd-f2c-data.mjs`: the harness page renders each piece, works by keyboard, has no page errors, and a table becomes cards at 390.
  - Screenshots.

**F2d · Legacy kit restyle**
- **Owns:** `src/design/module/ModuleKit.tsx`, `src/design/settings/SettingsKit.tsx`, the non-overlay parts of `src/shared/components/hr.tsx`, `src/shared/components/{EmptyState, StatCard, DataTable, HrPagination, PageSkeleton, SkeletonCard}.tsx`, `src/design/dc/{StatTile, SectionState, ApprovalCard, SubTabs, DatePicker, TimePicker, DesignFrame}.*`, and `src/shared/components/calendar/**` (TSX).
- **Depends on:** F1, F2a, F2b.
- **Prototype:** `StyleGuide`, plus the pages that use these pieces.
- **Scope:**
  - Rebuild on kit and tokens with the same props, so 100+ importers upgrade in place.
  - Weights at most 600, and dark mode.
  - Keep `role=group` + `aria-pressed`, "Try again", `.ut-card`, `role=switch`/`alert`.
  - Keep SettingsKit's section list, unsaved-changes bar, leave guard and view-only notice.
  - After it merges, F3a adds `placement` to `ModuleKit.Views` and `SubTabs`.
- **Tests:**
  - tsc, eslint and build.
  - The whole 55-script gate against the baseline, with screenshots of 10 sample pages in light and dark.
  - `live-rd-f2d-legacy.mjs`: ModuleKit and SettingsKit pages render in both themes; the unsaved bar and leave guard work; the calendar inside a panel closes alone on Escape.
  - `live-w3-calendar` (the calendar part).

**F3a · Shell**
- **Owns:**
  - `src/layouts/PlatformShell.tsx`, `src/layouts/appConfig.tsx`, `src/layouts/railLit.ts` and its test.
  - `src/design/shell/{ShellChrome.tsx, shell.css}` and new `src/design/shell/{HeaderTabs, AppRail, PagesPanel, MorePanel, TopBar, HelpPanel, useHome, navigationGuard}.tsx`.
  - `src/shared/navigation/{pageRegistry.ts, pageRegistry.test.ts, access.ts, useAccess.ts}`, `src/shared/hooks/{useRoles.ts, useVisibleTabs.ts}`.
  - `src/App.tsx`, `src/modules/hrms/HrmsDashboard.tsx`.
  - The seams `src/modules/hrms/{workforce/DirectoryRoute, attendance/AnalyticsRoute, attendance/ShiftsRoute, payroll/PliRoute, advance/AdvancesRoute}.tsx`, created and then handed to their owners.
  - After F2d merges, the `placement` prop in `ModuleKit.tsx` (`Views`) and `src/design/dc/SubTabs.*`.
  - Tests: `e2e/{live-rail-highlight, live-navigation, live-settings-restored, live-modules, live-mobile-layout}.mjs` and new `e2e/live-rd-f3a-shell.mjs`.
- **Depends on:** F1, F2a, F2b, C0.
- **Prototype:** `HrmsPlatform.dc.html` (rail, pages panel, top bar, toast, backdrop), `UtMore.dc.html`, `hrms-core.js` (`GROUPS`, `RGROUPS`, `ROLES`, `LAND`, `vals()`).
- **Scope:**
  - The rail groups of §5.1.
  - The Pages panel.
  - The header slot with `HeaderTabs`, a single pill, the dashboard section pills and the `?q=` chip.
  - The More panel: profile card, My space, overflow, Settings → Preferences, Help & support (`useAdminContacts`, with an empty state until BW-01 lands), Light/Dark, Sign out. The gear and profile menu are removed.
  - Home by permission (§5.2), `/dashboard` → `/me`, `RoleDashboard` no longer routed.
  - Every registry, route and guard change for the other packages (§5.3 tabs, `/team` views and its wider guard, `PoliciesRoute` `?view=documents`).
  - The seams, the navigation-guard API, the mobile shell, and no vendor name.
- **Tests:**
  - vitest: `railLit` rules, registry parameter maps, the `useHome` table for owner, hrm, fin, mgr, reader, a custom role and "none".
  - tsc, eslint and build.
  - `live-rd-f3a-shell`: rail groups and the lit item per role; More entries; Preferences lands on the first allowed page; Help lists admins; the theme choice persists; `/dashboard` goes to `/me` for reader and mgr; admin home for owner, hrm and fin; `/no-access` for none; the drawer at 390.
  - Rewrite `live-settings-restored`: the gear and profile menu become More, and it keeps every settings address → page, title, heading and section-bar check.
  - Update `live-rail-highlight` ("settings light More"), `live-navigation`, `live-modules` and `live-mobile-layout`.

#### Phase 2 (pages, each with its own backend and pop-ups)

**F3b · Search, notifications, Help & support** (BW-01–05)
- **Owns:**
  - Frontend: `src/shared/components/{TopBarSearch, GlobalSearch}.tsx`, `src/shared/search/**`, `src/core/notifications/**`, new `src/design/shell/{search, notifications}/**`. After F3a merges, the two mount points in `PlatformShell.tsx`.
  - Backend: `be/workforce/SearchController.java`, `be/workforce/search/**`, `be/notification/NotificationController.java`, `backend/platform/platform-notifications/.../dto/NotificationDtos.java` and the notification list query, new `be/me/AdminContactsController.java` and its service.
  - Tests: `e2e/live-w3-search.mjs` and new `e2e/live-rd-f3b-search.mjs`.
- **Depends on:** F3a, C0.
- **Prototype:** `UtSearch.dc.html`, `HrmsPlatform.dc.html` (notifications, L40 and L74), `UtMore.dc.html`.
- **Scope:**
  - One ⌘K dialog: scopes with counts, quick actions from the registry, Jump to, and a person preview using facts and today's status. The phone sheet opens the same dialog.
  - The notifications popover: module label and icon, Last 7 days, routes for every type including the 12 new ones.
  - BW-01–05.
- **Tests:**
  - Backend unit tests: facts visibility, today's status only within team scope, the holiday type, `group` and `since`, admin contacts (active admins only).
  - vitest: ranking, scopes, actions.
  - `live-rd-f3b-search` per role.
  - Update `live-w3-search` and the search block of `live-w3-greeting-myatt`.

**P-DASH · Admin dashboard** ★ (BW-112–118; V143_51)
- **Owns:**
  - Frontend: `src/modules/hrms/dashboard/**`, `src/design/dc/{AdminDashboard, AreaChart, DashCalendar, SeatsTile, MilestonesCard}.*`, `src/design/dc/{chart.ts, milestoneRange.ts, milestoneRange.test.ts}`, `src/modules/hrms/{milestones, probation}/**`, `src/modules/hrms/SeatsUsageTile.tsx`, `src/modules/hrms/api/{useActivity, useMilestones, useSeats, useProbation}.ts`.
  - Backend: `be/workforce/{AdminDashboardController, DashboardSummaryController, CompanyNoticeController, ProjectController}.java` and the services only they use, new `be/me/UiPrefsController.java`, `mig/V143_51__*`.
  - Tests: `e2e/{live-w3-dashboard, live-design-dashboard, live-summary-notices, live-w3-milestones}.mjs`.
- **Depends on:** Phase 1 (F1, F2a, F2b, F2c, F2d, F3a, C0), P-TEAM.be, P-HIRE.be.
- **Prototype:** `PgDashboard.dc.html`, `hrms-dash.js`, `UtStat`, `UtLive`, `UtQuick`, `UtSection`, `UtSections`, `HrmsPlatform` (`dashPillsA`).
- **Scope:** §1.C and §2.C, and the dashboard decisions in §5.5. Pop-ups: the notice panel, the projects drawer, Customise, and the probation Extend and Confirm dialogs.
- **Tests:**
  - Backend: prefs validation, month rollover, missing table, isolation between users; series; performers; health rule boundaries.
  - vitest: health rule, quick-action ordering, section pills.
  - `live-rd-p-dash`: owner, hrm, fin; mgr is redirected to `/me`; a past date; Customise saves and is restored; the notice event date; a project's health.
  - Update the four dashboard scripts, the projects block of `live-new-admin-browser` and the DashCalendar block of `live-w3-calendar`.

**P-WF-PEOPLE · Workforce directory, Add employee, Import** ★ (BW-90–98; V143_52)
- **Owns:**
  - Frontend: `src/modules/hrms/workforce/**` (including the `DirectoryRoute` seam), `src/modules/hrms/employees/{EmployeeForm, EmployeeImport, InlineCreateModals}.tsx`, `src/modules/hrms/master/MasterAccessStep.tsx`, `src/modules/rbac/components/AccessPicker.tsx`, `src/modules/rbac/api/newPersonAccess.ts`, `src/modules/hrms/api/{useWorkforce, useBulkImport, useBulkImport.test}.ts`.
  - Backend: `be/workforce/{WorkforceController, MasterDataController}.java`, the employee module's workforce services (`WorkforceEmployeeService`, `WorkforceFilter` and the DTOs they build), `backend/app/hrms-app/src/main/java/com/hrms/app/bulk/**`, `mig/V143_52__*`.
  - Tests: `e2e/{live-directory-search, live-w3-access}.mjs`.
- **Depends on:** Phase 1, P-ATT-DAY.be (BW-28).
- **Prototype:** `PgDirectory.dc.html`, `PgEmpForm.dc.html`, `PgEmpImport.dc.html`.
- **Scope:** §1.D rows D2–D4, §2.D and §5.6. The directory replaces Master's Employees page through the seam. Pop-ups: the stepper panel for Add and Edit, the drafts panel, bulk dialogs, InlineCreate (kept portalled), and the unsaved-changes guard (N11 stays native).
- **Tests:**
  - Backend: stats against SQL, the drafts strip, import mapping (department by name), the onboarding flag, the manager-read masking, word search.
  - vitest: the status pills and the import mapper.
  - `live-rd-p-wf-people`: add with a draft, then onboarding, then clean up; import 2 rows and remove them; filters; mgr sees a direct report masked.
  - Update `live-directory-search`, `live-w3-access`, the employee-import block of `live-design-last`, the employee blocks of `live-design-master` and `live-w3-r1`, and the employee blocks of `live-tenant-isolation` (this package also owns edits there).

**P-WF-SETUP · Master overview, Org setup, Rules & policies, Policies** ★ (BW-104–105; V143_64)
- **Owns:**
  - Frontend: `src/modules/hrms/master/{MasterContainer.tsx, masterData.ts, masterSync.ts}`, `src/design/master/**`, `apps/platform/scripts/{master-build.mjs, master-patches.mjs}` (after F4), `src/modules/hrms/Policies.tsx`, `src/modules/hrms/api/usePolicy.ts`.
  - Backend: `be/policy/**` and the policy module, `mig/V143_64__*`.
  - Tests: `e2e/live-design-master.mjs`.
- **Depends on:** Phase 1, F4, P-WF-PEOPLE.be (BW-90, BW-95), P-ATT-PLAN.be (BW-33).
- **Prototype:** `PgOrg.dc.html` (overview, setup), `PgSetup.dc.html` (`m-rules`), `EmpDocs.dc.html` (`e-pol`).
- **Scope:** §1.D rows D1 and D5–D9, H10, and §5.6. Pop-ups: Master's drawers, modals and popovers through `master.css` and `master-patches.mjs`; the Publish panel gets its "accept by" field.
- **Tests:**
  - Backend: policy fields, my summary, deadlines, missing table.
  - `live-rd-p-wf-setup`: owner edits a department's cost centre; a policy is published with a deadline; reader acknowledges it; everything is cleaned up.
  - Update `live-design-master`, the Policies block of `live-design-hrsetup`, and the master-data block of `live-w3-r1`.

**P-COMP · Companies & branches** (frontend only)
- **Owns:** `src/modules/hrms/organization/CompaniesPageContainer.tsx`, `src/design/dc/{CompaniesPage, BranchDrawer, CompanyDrawer, GeofenceMap}.*`, `src/modules/hrms/api/{useOrg, useGeofence}.ts`, `e2e/{live-company-restore, live-design-companies}.mjs`.
- **Depends on:** Phase 1.
- **Prototype:** `PgCompanies.dc.html`.
- **Scope:** §1.K rows K1–K2, §2.K and §5.13. Pop-ups: the four stepper panels, and the archive and restore dialogs (including the one-button "Can't archive yet").
- **Tests:**
  - vitest: the "No branch · N" maths and radius validation.
  - `live-rd-p-comp`: create, manage and archive a branch and a company, restore, gates for hrm and reader, radius over 500 kept; cleaned up.
  - Update the two scripts it owns.

**P-ATT-DAY · Daily tracking, My attendance, Timesheet, Manual entry, Muster roll, and the attendance module** ★ (BW-13–19, 23–28, 30, 36; V143_53, V143_65)
- **Owns:**
  - Frontend: `src/modules/hrms/attendance/{AttendanceContainer, ManualEntry, MusterRoll, ReviewList, StatusChangeDrawer}.tsx`, `src/modules/hrms/attendance/{attendanceBuckets, date}.ts` (bucket rule unchanged), new `src/modules/hrms/attendance/timesheet/**`, `src/design/dc/{AttendancePage, AttDailyLogs, AttFacePunch, AttRegularization, AttMine}.*`, `src/modules/hrms/ess/{AttendanceHistory, TimeEntries}.tsx`, `src/modules/hrms/api/{useAttendance, useAttendanceReview, useAssistedPunches}.ts`.
  - Backend: `be/attendance/{AttendanceController, AttendanceReviewController, AttendanceReviewService, AssistedPunchController, CorrectionProofController}.java` and the attendance module's `AttendanceService`, `CanonicalAttendanceService`, `AttendanceApiDtos`, `AssistedPunchService`, `CheckInMethod` and the DTOs they build; `be/workforce/TimeEntryController.java` and its service; new `be/attendance/{SelfDayController, PunchRulesController, ManualEntryBulkController, AttendanceRegisterController}.java`; `mig/V143_53__*`, `mig/V143_65__*`.
  - Tests: `e2e/{live-design-attendance, live-design-attendance-admin, live-face-punch-logs, live-w3-punch}.mjs`.
- **Depends on:**
  - The `.be` half depends on C0 only.
  - The UI depends on Phase 1, P-TEAM.be (Undo, Remind), P-LEAVE.be (BW-43), P-HOME.be (BW-122) and P-PAY-CORE.be (BW-55 schedule).
- **Prototype:** `PgAttendance.dc.html`, `PgTime.dc.html` (`a-daily`, `cp-muster`), `EmpTime.dc.html` (`e-att`, Timesheet), `PgGrow.dc.html` (`me-att`).
- **Scope:** §1.E rows E1–E8, §2.E and §5.7. The web punch, breaks, undo check-out and my-day endpoints serve P-HOME. Pop-ups: the status-change drawer, bulk mark, the fix-a-day panel, Review's Excuse and Change dialogs, face decisions, and reason dialogs.
- **Tests:**
  - Backend: roster fields, the E28 fix (a WFH day stays WFH), web punch refused while off or without location, WFH exemption, undo check-out window, breaks leave `work_hours` unchanged, the Anywhere rule, bulk mark, the register CSV, timesheet lock and approval scope.
  - vitest: buckets (unchanged) and the week maths.
  - `live-rd-p-att-day` per role: bulk mark, then undo through the API; a fix approved and undone; timesheet submit and approve; web punch with the switch on in `ut_w3_dev` and off again; cleaned up.
  - Update the four scripts it owns, the Daily Logs date-picker blocks of `live-w3-calendar` and `live-w3-analytics`, the My Attendance block of `live-w3-greeting-myatt`, and the time-entry, history, muster and manual-entry blocks of `live-w3-r2`.

**P-ATT-PLAN · Attendance analytics, Shifts & overtime** ★ (BW-20–22, 29, 31–34; V143_54)
- **Owns:**
  - Frontend: the `AnalyticsRoute` and `ShiftsRoute` seams, new `src/modules/hrms/attendance/{analytics, shifts}/**`, `src/design/dc/{AttOverview, AttCalendar, ShiftSchedules, ShiftRoster, ShiftOvertime, ShiftRequests, ShiftBar}.*`, `src/design/dc/shift-util.ts`, `src/modules/hrms/api/{useShiftPolicies, useShiftRequests}.ts`.
  - Backend: `be/attendance/{TeamScheduleController, ShiftController, OvertimeController, OvertimeReasons}.java`, the attendance module's shift services (`ShiftChangeRequestService`, `EmployeeShiftService`, the shift-policy service; `ShiftChangeRequestSchemaBootstrap` stays untouched), new `be/attendance/{AttendanceInsightsController, OvertimeRulesController}.java`, `mig/V143_54__*`.
  - Tests: `e2e/live-w3-analytics.mjs`.
- **Depends on:** Phase 1, P-TEAM.be (Undo).
- **Prototype:** `PgTime.dc.html` (`a-analytics`, `a-shifts`).
- **Scope:** §1.E rows E9–E16, §2.E and §5.7. Pop-ups: the shift panels, roster assign, overtime reject (a note is required), change-request decisions.
- **Tests:**
  - Backend: breakdown against SQL, punctuality scope, schedule day facts, overtime rules (no row means identical output to today), "until" restores the old shift, default shifts not recreated, withdraw.
  - `live-rd-p-att-plan`: a shift with an end date approved and then restored; rules set and cleared; cleaned up.
  - Update `live-w3-analytics` and the analytics and shifts blocks of `live-design-attendance`.

**P-LEAVE · Leave** ★ (BW-37–49; V143_56)
- **Owns:**
  - Frontend: `src/modules/hrms/Leave.tsx`, `src/modules/hrms/leave/**`, `src/modules/hrms/api/{useLeave, useLeaveYearEnd}.ts`.
  - Backend: `be/leave/**`, the leave module except `WfhService` and its DTOs, `be/settings/SettingsController.java` (holiday update), `mig/V143_56__*`.
  - Tests: `e2e/{live-design-leave, live-leave-calendar}.mjs`.
- **Depends on:** Phase 1, P-TEAM.be (Undo).
- **Prototype:** `PgLeave.dc.html`, `PgTime.dc.html` (`l-ops`), `EmpLeave.dc.html`, `PgGrow.dc.html` (`me-leave`).
- **Scope:** §1.F, §2.F and §5.8, including the E29 fix in `useCancelLeave`. Pop-ups: the apply panel, bulk approve, reason dialogs, holiday add and edit (sentence-case titles, tests updated), encash, and year-end confirm.
- **Tests:**
  - Backend: stats, enrichment, calendar scope per level, PENDING_L2, bulk results, on-behalf rights and notification, balances, preview matches `applyLeave`, colleagues-off privacy.
  - `live-rd-p-leave`: apply on behalf then cancel, which refreshes balances; bulk approve then undo; holiday edit; cleaned up.
  - Update both scripts and the leave and holiday blocks of `live-w3-r2`.

**P-PAY-CORE · Payroll dashboard, runs, salary structure, settings, bank** ★ (BW-50–59; V143_58)
- **Owns:**
  - Frontend: `src/modules/hrms/payroll/{PayrollContainer, BankDisbursement, DisbursementHistory}.tsx`, `src/design/dc/{PayDashboard, PayRuns, PayrollRunPage, PayrollOverview, PayrollEmployees, PayslipDrawer, PaySalary, PaySettings, PayBank, PayrollModule, NewRunModal, ProcessSteps, ProcessPipeline}.*`, `src/modules/hrms/api/{usePayrollRuns, usePayroll, useDisbursement}.ts`.
  - Backend: `be/payroll/**` and the payroll module, `mig/V143_58__*`.
  - Tests: `e2e/live-design-payroll.mjs`.
- **Depends on:** Phase 1.
- **Prototype:** `PgPay.dc.html` (`py-dash`, `py-runs`, `py-struct`, `py-settings`, `py-bank`), `PgPayroll.dc.html`.
- **Scope:** §1.G rows G1–G8, §2.G and §5.8–§5.9. Also the payroll team's side of Ask payroll: a "Payslip questions" card on the dashboard, and a side panel to answer. **Never process, lock or pay a real run.** Tests use a disposable run in `ut_w3_dev`, or read-only checks.
- **Tests:**
  - Backend: run fields, checks, statutory dues, readiness, my-payslip extras (own runs only), YTD, the upcoming month has no figures, queries both ways.
  - `live-rd-p-pay-core`: read-only on the seeded runs; a query raised and answered, then deleted.
  - Update `live-design-payroll` and the bank-profiles block of `live-design-last`.

**P-PAY-EXTRA · PLI, Advances & loans, Full & final** ★ (BW-62–64)
- **Owns:**
  - Frontend: the `PliRoute` and `AdvancesRoute` seams, `src/modules/hrms/{Pli, Advance, FullAndFinal}.tsx`, `src/modules/hrms/advance/AdvanceAdmin.tsx`, `src/design/dc/{PayPli, PayAdvances}.*`, `src/modules/hrms/api/{usePli, useAdvance, useFnf}.ts`.
  - Backend: `be/advance/**`, `be/pli/**`, `be/fnf/**` and their modules.
- **Depends on:** Phase 1.
- **Prototype:** `PgPay.dc.html` (`py-pli`, `py-adv`, `x-fnf`), `EmpClaims.dc.html` (`e-adv`).
- **Scope:** §1.G rows G9–G11, §2.G and §5.9. Pop-ups: advance details → reject (nested), disburse with reference, PLI awards, and the settlement panels.
- **Tests:**
  - Backend: summaries, self access with the ownership check, preview, the new ledger labels, F&F filters.
  - `live-rd-p-pay-extra`: an advance requested, previewed, approved and disbursed on a disposable employee, then cleaned up; PLI and F&F read per role.
  - Update the PLI block of `live-design-last`, and run `live-advance-admin` and `live-fnf-admin` (not in the gate).

**P-EXP · Expense center** ★ (BW-60–61; V143_57)
- **Owns:**
  - Frontend: `src/modules/hrms/Expense.tsx`, `src/modules/hrms/expense/**`, `src/modules/hrms/api/{useExpense, useExpenseBatches}.ts`.
  - Backend: `be/expense/**` and the expense module, `mig/V143_57__*`.
  - Tests: `e2e/{live-design-expenses, expense-batches-live}.mjs`.
- **Depends on:** Phase 1, P-TEAM.be (Undo).
- **Prototype:** `PgPay.dc.html` (`e-center`), `EmpClaims.dc.html` (`e-claims`).
- **Scope:** §1.G row G12, §2.G and §5.9. Pop-ups: the claim panel, reject with reason, batch panels.
- **Tests:**
  - Backend: summaries, the policy check against caps, on-behalf rights and notification, the status filter.
  - `live-rd-p-exp`: claim on behalf, approve, undo, reject with reason; cleaned up.
  - Update the two scripts and the expense blocks of `live-w3-r4`.

**P-HIRE · Hiring, Onboarding & assets** ★ (BW-65–70; V143_59)
- **Owns:**
  - Frontend: `src/modules/hrms/Hiring.tsx`, `src/modules/hrms/hiring/**`, `src/modules/hrms/onboarding/**` except `MyAssets.tsx`, `src/modules/hrms/api/useHiring.ts`.
  - Backend: `be/hiring/**` (`ConversionOnboardingStarter` unchanged), `be/onboarding/**`, `be/me/MyAssetsController.java`, the onboarding module, `mig/V143_59__*`.
  - Tests: `e2e/{live-onboarding, live-design-onboarding}.mjs`.
- **Depends on:** Phase 1.
- **Prototype:** `PgTalent.dc.html` (`h-pipe`, `h-onb`).
- **Scope:** §1.H rows H1–H3, §2.H and §5.10. Pop-ups: the candidate, requisition, interview, offer and asset panels, the wizard, and reason dialogs.
- **Tests:**
  - Backend: summary, stage events written in the same transaction, the funnel, offer email fallback, overview, holder-name privacy, asset confirmation and backfill.
  - `live-rd-p-hire`: a candidate moved through the stages, then the funnel; an asset reported and resolved; cleaned up.
  - Update the two scripts, the hiring and onboarding blocks of `live-w3-r1`, and run `live-candidate-conversion`.

**P-DOCS · Letters, Employee vault, Docs to review, My letters, My documents, My assets** ★ (BW-71–77; V143_60)
- **Owns:**
  - Frontend: `src/modules/hrms/letters/**`, `src/modules/hrms/DocumentVault.tsx`, `src/pages/{PendingDocuments, MyDocumentsCard}.tsx`, `src/modules/hrms/onboarding/MyAssets.tsx`, `src/modules/hrms/api/useDocument.ts`.
  - Backend: `be/letters/**`, `be/document/**` and their modules, `mig/V143_60__*`.
  - Tests: `e2e/live-design-documents.mjs`.
- **Depends on:** Phase 1, P-HIRE.be (BW-70).
- **Prototype:** `PgTalent.dc.html` (`h-letters`, `h-vault`, `h-docs`, `me-letters`, `me-assets`), `EmpDocs.dc.html` (`e-letters`, `e-files`, `e-assets`).
- **Scope:** §1.H rows H4–H9, §2.H and §5.10. Pop-ups: the generate panel, the distribution wizard (stepper, recipient filter), void and reject reason dialogs, the letter preview, the sign panel, upload, asset confirm and report.
- **Tests:**
  - Backend: new letter fields, BY_BRANCH, the scheduler starts due jobs only, issue date merge, my-letters scope, sign rules (owner, status, requested).
  - `live-rd-p-docs`: generate with a signature asked; reader signs; a scheduled send is cancelled; void with a reason; cleaned up.
  - Update `live-design-documents` and the documents block of `live-w3-r3`.

**P-GROW · Performance, Learning, Resignation & exit** ★ (BW-78–85; V143_61)
- **Owns:**
  - Frontend: `src/modules/hrms/{Performance, Learning}.tsx`, `src/modules/hrms/{performance, learning, exit}/**`, `src/modules/hrms/api/{usePerformance, usePerformanceAdmin, useLearning}.ts`.
  - Backend: `be/performance/**`, `be/learning/**` and their modules, `mig/V143_61__*`.
  - Tests: `e2e/{live-design-learning, performance-admin-live, live-design-performance, live-performance-scope, live-exit-center}.mjs`.
- **Depends on:** Phase 1, P-WF-PEOPLE.be (BW-90, BW-91), P-PAY-EXTRA.be (BW-64).
- **Prototype:** `PgGrow.dc.html` (`p-center`, `p-learn`, `x-res`), `EmpGrowth.dc.html`.
- **Scope:** §1.I rows I1–I5, §2.I and §5.11. Pop-ups: the cycle, KPI, program, skill and certification panels, the reject-with-note dialog, Share confirm, and the draft self-review.
- **Tests:**
  - Backend: milestones, the hold and Share visibility rule, stages and ratings scope, Remind notification with the throttle, filters, company KPI roll-up, draft rules, learning fields.
  - `live-rd-p-grow`: a cycle with dates and hold; a self-review drafted then submitted; Share; a skill rejected with a note; cleaned up.
  - Update its five scripts, the exit link in `live-employee-exit`, the learning block of `live-new-admin-browser`, the learning and review-cycle/KPI blocks of `live-w3-r3` and `live-w3-r4`, and the exit block of `live-w3-r2`.

**P-REPORTS · Reports center, Workforce analytics** (BW-86–89; V143_62)
- **Owns:**
  - Frontend: `src/modules/hrms/reports/**`, `src/modules/hrms/analytics/WorkforceAnalytics.tsx`, `src/design/dc/WorkforceAnalytics.*`, `src/modules/hrms/api/{useReports, useReportExports}.ts`, `src/shared/export/charts.ts`.
  - Backend: `backend/app/hrms-app/src/main/java/com/hrms/app/reports/**`, `mig/V143_62__*`.
  - Tests: `e2e/live-design-reports.mjs`.
- **Depends on:** Phase 1.
- **Prototype:** `PgReports.dc.html`, `PgSetup.dc.html` (`r-wfa`).
- **Scope:** §1.I rows I6–I8, §2.I and §5.11. Pop-ups: the schedule panel.
- **Tests:**
  - Backend: deltas, diversity as of a date, mini series each under its own permission, trend, fiscal year, the new schedule constraints, send hour, and that the job runs only on the right day and hour.
  - `live-rd-p-reports`: a weekday schedule at a given hour, created and deleted; every tab per role.
  - Update `live-design-reports` and the report blocks of `live-w3-r4`.

**P-SETUP · Statutory compliance, HR configuration, Notification templates, HR integrations** (BW-102, 103, 106–108; V143_63)
- **Owns:**
  - Frontend: `src/modules/hrms/{Compliance, NotificationTemplates, Integrations}.tsx`, `src/modules/hrms/compliance/**`, `src/modules/hrms/settings/HrConfigurationPage.tsx`, `src/modules/hrms/api/{useCompliance, useSettings, useNotificationTemplate, useIntegration}.ts`.
  - Backend: `be/compliance/**`, `be/notiftemplate/**`, `be/integration/**`, `be/probation/ProbationController.java` and their modules, `mig/V143_63__*`.
  - Tests: `e2e/{live-design-hrconfig, live-design-hrsetup, live-compliance-modals}.mjs`.
- **Depends on:** Phase 1, P-ATT-DAY.be (BW-24), P-ATT-PLAN.be (BW-29).
- **Prototype:** `PgSetup.dc.html` (`cp-stat`, `hs-config`, `hs-notif`, `hs-int`).
- **Scope:** §1.J rows J1–J4, §2.J and §5.12. HR configuration gains the "Allow web check-in" section (BW-24) and the Overtime rules section (BW-29), keeping SettingsKit behaviour. Pop-ups: the filing, obligation, POSH, inspector, template and integration panels, and Mark filed with a date.
- **Tests:**
  - Backend: summary counts, filters, filed date (≤ today, LATE), the POSH department side table, recipients, channel counts, integration status.
  - `live-rd-p-setup`: web check-in on then off, overtime rules set then cleared, a filing marked filed with a date; cleaned up.
  - Update its three scripts, the compliance and inspector blocks of `live-w3-r3`, and the HR configuration block of `live-dead-entrypoints`.

**P-ADMIN · Settings, Users & access, Roles & permissions, Audit logs** (BW-109–111)
- **Owns:**
  - Frontend: `src/pages/{Settings, SettingsWorkspaceProfile, SettingsSecurity, SettingsDangerZone, SettingsDocumentTypes, NotificationChoices, Users, Roles, AuditLogs}.tsx`, `src/pages/workspaceSettingsApi.ts`, `src/pages/users/**`, `src/pages/branding/**`, `src/shared/components/{ComingSoon, ModuleComingSoon}.tsx`, `src/modules/rbac/api/**` except `newPersonAccess.ts`, `src/modules/hrms/api/useAudit.ts`.
  - Backend: `be/me/MySecurityController.java`, `be/access/**`, `be/rbac/**`, `be/audit/**`, and the sign-in success and failure paths in `be/auth/canonical/**` (the LOGIN audit call only).
  - Tests: `e2e/{live-design-settings, live-design-access}.mjs`.
- **Depends on:** Phase 1.
- **Prototype:** `PgAdmin.dc.html` (`s-config`, `s-users`, `s-roles`, `s-audit`), `PgGeneric.dc.html`.
- **Scope:** §1.J rows J5–J8 and J10, §2.J and §5.12. Pop-ups: the access drawer, invite, the role panels, the danger-zone confirms.
- **Tests:**
  - Backend: password date, grant date and by, invite message, counts, and that a LOGIN event is recorded without ever blocking sign-in.
  - `live-rd-p-admin`: invite with a message (no email sent: use the local mail stub or check the database); a temporary role granted then removed; sign-in events filtered; per role.
  - Update its two scripts, the audit-log block of `live-w3-calendar`, and the extra-permission and audit blocks of `live-w3-r4`.

**P-HOME · Self-service Home, Work from home, Shift change** ★ (BW-35, 119–122)
- **Owns:**
  - Frontend: `src/modules/hrms/ess/EssDashboard.tsx`, new `src/modules/hrms/ess/home/**`, `src/modules/hrms/{wfh, shifts}/**`, `src/modules/hrms/api/useWfh.ts`.
  - Backend: new `be/ess/**`, `be/wfh/WfhController.java`, the leave module's `WfhService` and its DTOs.
  - Tests: `e2e/live-staff-dashboard.mjs` (rewrite).
- **Depends on:**
  - The `.be` half (BW-35, 119–122) depends on C0 only and runs in Wave A, because P-ATT-DAY's fix-a-day panel needs BW-122. Its "needs you" sources skip tables that don't exist yet.
  - The UI (Wave C) depends on Phase 1, P-ATT-DAY.be, P-TEAM.be, P-ATT-PLAN.be, P-PAY-CORE.be, P-DASH.be, P-DOCS.be, P-GROW.be, P-HIRE.be and P-WF-SETUP.be.
- **Prototype:** `EmpHome.dc.html` (employee, manager), `EmpTime.dc.html` (`e-wfh`, `e-shift`).
- **Scope:** §1.L rows L1–L4, §2.L and §5.14. The manager's team blocks use C0's shared team hooks. "Your day" shows Check in and out only when the company switch is on. Pop-ups: the WFH panel (batch of days), the shift change panel (Until, withdraw), Customise, Message team, the break and undo toasts.
- **Tests:**
  - Backend: my requests (a failing source is isolated; module and permission gating), needs you (each source gated; missing tables skipped), around you, approver preview matching the controllers' chain, WFH batch overlaps.
  - `live-rd-p-home`: reader and mgr. A WFH batch sent then cancelled; a shift change with Until then withdrawn; web check-in, a break and undo check-out with the switch turned on in `ut_w3_dev`; mgr's team blocks, remind and message; cleaned up.
  - Rewrite `live-staff-dashboard` against `/me`, keeping every behavioural check.
  - Update the "Apply leave on /me" block of `live-dead-entrypoints`, the WFH and shift-change blocks of `live-w3-r2`, and the greeting block of `live-w3-greeting-myatt` (now on Home).

**P-MYPAY · My payslips, My salary** (no backend of its own)
- **Owns:** `src/modules/hrms/payroll/{EmployeePayslips, MySalaryStructure}.tsx` and new `src/modules/hrms/payroll/my/**`.
- **Depends on:** Phase 1, P-PAY-CORE.be.
- **Prototype:** `EmpPay.dc.html`.
- **Scope:** §1.G rows G13–G14, §2.G and §5.9. The two-pane payslip reuses P-PAY-CORE's payslip body read-only. Adds Hide amounts, the Monthly/Yearly switch, and the Ask payroll panel.
- **Tests:**
  - vitest: the SplitBar grouping and the change % between revisions.
  - `live-rd-p-mypay`: reader and hrm see only their own payslips; the month being prepared shows no figures; a question asked, then deleted; hide amounts persists.
  - Update the My Salary and My Payslips blocks of `live-dead-entrypoints`.

**P-TEAM · Team today, Team schedule, Approvals; Undo, reminders, team probation, team messages** ★ (BW-06–12; V143_50, V143_55)
- **Owns:**
  - Frontend: `src/modules/hrms/team/**`.
  - Backend: new `be/approvals/**`, new `be/team/**`, new `be/attendance/{AttendanceReminderController, AttendanceReminderService}.java`, `be/saasguard/TenantModuleGuard.java` (the `/v1/team` entry), `mig/V143_50__*`, `mig/V143_55__*`.
  - Tests: `e2e/{live-design-team, live-role-matrix}.mjs`.
- **Depends on:**
  - The `.be` half depends on C0 only.
  - The UI depends on Phase 1, P-ATT-DAY.be (BW-13), P-ATT-PLAN.be (BW-22) and P-GROW.be (BW-78); for timesheet rows, P-ATT-DAY.be (BW-36).
- **Prototype:** `TeamToday.dc.html`, `TeamSchedule.dc.html`, `TeamApprovals.dc.html`.
- **Scope:** §1.L rows L5–L7, §2.L and §5.14; the BW-06 Undo mechanism for everyone. Pop-ups: the probation Confirm and Extend dialogs, the message panel, reject reasons.
- **Tests:**
  - Backend: every Undo kind (balance maths, each refusal, a second undo, the wrong person, the window over, the table missing); the inbox returns the same ids as each list for every role, with `canDecide` correct; reminder throttle; probation rights; message recipients limited to the team.
  - `live-rd-p-team`: mgr decides and undoes each kind (the employee is notified); remind; message; hrm does not get My team; cleaned up.
  - Update `live-design-team` ("Shift roster" moves to `?view=schedule`) and `live-role-matrix` (team paths now behind the hrms module), and move the `/team` greeting check to P-HOME.

**P-PROFILE · Employee profile (HR view), My profile** (BW-99–101)
- **Owns:**
  - Frontend: `src/modules/hrms/employees/EmployeeDetail.tsx`, `src/modules/hrms/employees/{workspace, api}/**`, `src/design/dc/EmployeeWorkspace.*`, `src/pages/{Profile, DelegationCard}.tsx`, `src/modules/hrms/attendance/face/**`, `src/modules/hrms/api/useEmployeeProfile.ts`, and the banner asset.
  - Backend: `be/employee/**`, `be/invitation/**`.
  - Tests: `e2e/{live-design-workspace, live-w3-faceenroll, live-employee-exit}.mjs`.
- **Depends on:** Phase 1, P-ATT-DAY.be, P-PAY-CORE.be, P-WF-PEOPLE.be, P-DOCS.be, P-PAY-EXTRA.be, P-LEAVE.be, P-EXP.be.
- **Prototype:** `PgProfile.dc.html`, `PgProfileTabs.dc.html`.
- **Scope:** §1.K rows K3–K4, §2.K and §5.13. `/profile` becomes the tabbed layout with the Preferences tab (the `#st-…` anchors are kept). Pop-ups: edit panels, lifecycle dialogs, face enrol and reset, on-behalf leave and claim panels.
- **Tests:**
  - Backend: self-read of own sections only, the masked identity, last device, nominee total.
  - `live-rd-p-profile`: HR view of every tab per role; mgr on a direct report (masked); reader's My profile tabs, with no Attendance for owner; leave and claim on behalf, then cleaned up.
  - Update its three scripts, the Profile block of `live-design-settings`, the workspace "Expenses" block of `live-dead-entrypoints`, and the profile blocks of `live-w3-r1`, `live-w3-r3` and `live-w3-r4`.

#### Phase 3

**Q1 · Integration and QA** (lead)
- **Owns:** `rd/int` merges; `_tools/final-run.sh` (adds every `live-rd-*.mjs` to the gate); removal of the branches the seams made unreachable (`PayrollContainer`'s PLI and advances branches, `AttendanceContainer` and `AttendancePage`'s analytics and shifts branches, Master's Employees page). The files that were already dead stay (DECISIONS 18).
- **Depends on:** every package.
- **Scope:**
  - Merge in the order of §6.1 and resolve the multi-page test merges.
  - Run tsc, eslint, build, vitest, all backend tests, the whole gate plus every `live-rd-*` (all green), and the dark and 390 screenshots of every page.
  - Final report.
  - Then the single merge to `main` and one push, only when everything is green.
- **Tests:** everything.

### 6.4 Who updates which existing live test

- **Gate scripts:** the owner below edits the file.
- **Multi-page scripts:** several packages each edit only their own blocks, and the lead merges.
- **Other scripts:** every package also runs `live-tenant-isolation` and `live-role-matrix` when it changes backend access.

| Script | Owner | Blocks edited by others |
|---|---|---|
| live-company-restore, live-design-companies | P-COMP | — |
| live-settings-restored, live-rail-highlight, live-navigation, live-modules, live-mobile-layout | F3a | — |
| live-design-settings | P-ADMIN | P-PROFILE (Profile) |
| live-design-hrconfig, live-compliance-modals | P-SETUP | — |
| live-design-hrsetup | P-SETUP | P-WF-SETUP (Policies) |
| live-dead-entrypoints | multi | P-MYPAY, P-SETUP, P-PROFILE, P-HOME |
| live-role-matrix | P-TEAM | any backend package that changes access |
| live-design-last | multi | P-PAY-EXTRA (PLI), P-WF-PEOPLE (import), P-PAY-CORE (bank profiles) |
| live-tenant-isolation | P-WF-PEOPLE | F3b (search block) |
| live-design-reports | P-REPORTS | — |
| live-design-learning, performance-admin-live, live-design-performance, live-performance-scope, live-exit-center | P-GROW | — |
| live-w3-calendar | F2d (calendar) | P-DASH, P-ATT-DAY, P-ADMIN |
| live-w3-dashboard, live-design-dashboard, live-summary-notices, live-w3-milestones | P-DASH | P-WF-PEOPLE (directory filter link) |
| live-w3-access, live-directory-search | P-WF-PEOPLE | — |
| live-onboarding, live-design-onboarding | P-HIRE | — |
| live-w3-r1 | multi | P-WF-PEOPLE, P-PROFILE, P-HIRE, P-WF-SETUP |
| live-design-master | P-WF-SETUP | P-WF-PEOPLE (employee list) |
| live-employee-exit | P-PROFILE | P-GROW (exit centre link) |
| live-new-admin-browser | multi | P-GROW (learning), P-DASH (projects) |
| live-design-workspace, live-w3-faceenroll | P-PROFILE | — |
| live-w3-punch, live-design-attendance-admin, live-face-punch-logs | P-ATT-DAY | — |
| live-design-attendance | P-ATT-DAY | P-ATT-PLAN (analytics, shifts) |
| live-w3-analytics | P-ATT-PLAN | P-ATT-DAY (Daily Logs picker) |
| live-staff-dashboard | P-HOME (rewrite against `/me`) | — |
| live-design-team | P-TEAM | — |
| live-w3-greeting-myatt | multi | P-ATT-DAY (My Attendance rule), P-HOME (greeting, moved from `/team`), F3b (search) |
| live-w3-search | F3b | — |
| live-design-leave, live-leave-calendar | P-LEAVE | — |
| live-w3-r2 | multi | P-LEAVE, P-HOME, P-ATT-DAY, P-GROW |
| live-design-payroll | P-PAY-CORE | — |
| live-design-expenses, expense-batches-live | P-EXP | — |
| live-w3-r4 | multi | P-REPORTS, P-GROW, P-EXP, P-ADMIN, P-PROFILE, P-DASH |
| live-design-documents | P-DOCS | — |
| live-w3-r3 | multi | P-DOCS, P-SETUP, P-GROW, P-PROFILE |
| live-design-access | P-ADMIN | — |
| Not in the gate: live-advance-admin, live-fnf-admin, live-candidate-conversion, live-directory-export, live-inspector-browser | P-PAY-EXTRA, P-PAY-EXTRA, P-HIRE, P-WF-PEOPLE, P-SETUP | — |

---

## 7. Risks, and how the plan handles them

| # | Risk | How the plan handles it |
|---|---|---|
| 1 | **No baseline yet.** Failures that already exist would be blamed on the redesign. | G0 runs the 55-script gate on `e32a4dc6` before anything merges and records every failure. F1, F2d and Q1 compare against it. |
| 2 | **Generated views get overwritten.** F1 has already hand-edited about 45 generated `design/dc/*.view.tsx`; re-running `design-build.mjs` or `master-build.mjs` would wipe those edits and later ones. | F4's guard: a `// hand-owned` marker makes the scripts skip a file, and a missing anchor fails loudly. Master changes go only through `master-patches.mjs`. |
| 3 | **Tests coupled to markup.** About 60 live scripts assert markup: 124 `getByRole('dialog')` calls, 33 dialog names, "Close panel", `.toast`, `<article>` cards, `role=group` + `aria-pressed`. | Each package updates the scripts on its pages (§6.4) and keeps every behavioural check. The kit keeps one `role="dialog"` and "Close panel". Sentence-case titles are changed together with their tests. |
| 4 | **Dark mode on every page.** About 4,100 hex literals, 800 palette classes, recharts and Leaflet. | Tokens only in the kit. F1's dark bridge keeps pages that are not yet rebuilt readable. Every package screenshots dark. Q1 screenshots every page in dark at 1440 and 390, and reports the raw-hex count per package, which should only go down. |
| 5 | **Migrations are applied by hand in production.** | Every new block degrades on its own (`FEATURE_NOT_READY`, no retry). Each live test proves it by renaming the table in `ut_w3_dev`. Migrations are idempotent, numbered V143_50–65, and each carries its own OWNER and SUPER_ADMIN grants. The final report lists them in order with what each switches on. |
| 6 | **Mobile app compatibility.** The mobile app reads the same DTOs (`StaffStatusResponse`, `DayRecordResponse`, leave and WFH responses, `MyPayslipDto`). | Changes are additive only: no field is renamed, retyped or removed. Unit tests assert the old fields are unchanged. |
| 7 | **`attendanceBuckets` is shared** by the dashboard, Daily Logs and search. | The rule is unchanged and has one owner (P-ATT-DAY). BW-03 returns raw facts, and the web applies the same function. |
| 8 | **Money pages.** A test could process, lock or pay a real payroll run, or leave money data behind. | Payroll live tests are read-only on the seeded runs or use disposable fixtures in `ut_w3_dev`. Advances and F&F use disposable employees and are cleaned up. No production data, ever (RULES.md). |
| 9 | **New permissions only reach `hasAuthority` after a token refresh.** | Live tests sign in again after a grant. Decision and money actions use `@perm.check`, which reads the database. |
| 10 | **Overlay stacking and the `backdrop-filter` trap.** | F2b's layer stack. The backdrop is a sibling element. Tests cover the nested cases (advance details → reject; InlineCreate over the legacy form; the calendar inside every panel). |
| 11 | **Radix centring** breaks if the Modal restyle moves the transform into classes. | `Overlay.tsx` keeps the framer-motion centring (F2b). P-ADMIN's invite dialog check covers it. |
| 12 | **The N11 guard** (synchronous `window.confirm` in a capture handler). | It stays native (DECISIONS 18). The new navigation-guard API carries the other guards. |
| 13 | **Migration number clashes** with the teammate's work on `main`. | V143_41–49 are left for `main`, and the redesign uses 50–65. If `main` passes 49 before the merge, Q1 renumbers the files (only file names and headers change). |
| 14 | **Machine limits.** Two heavy commands and one live slot. | About 4 packages at a time, in the waves of §6.1. Vite servers stop when not in use. |
| 15 | **Phase 1 merge conflicts.** F1, F2b, F2d and F3a all touch `ModuleKit.tsx`, `SettingsKit.tsx` or `hr.tsx`. | Strict merge order F1 → F2a → F2b → C0 → F4 → F2c → F2d → F3a, and each rebases before merging. F3a adds the `placement` prop only after F2d merges. |
| 16 | **Dead code left by the seams.** | Q1 removes only the branches the seams made unreachable. Files that were already dead stay (DECISIONS 18) and are listed for the user. |
| 17 | **Push.** | Nothing is pushed until everything is green (DECISIONS 9). |
| 18 | **Some audit claims were read from code, not seen live** (for example per-role seeds, mobile DTO use, some empty states). | Each package reads the current code, its tests and its live pages before changing them (PACKAGE_BRIEF step 3), and reports any difference. |
| 19 | **Privacy changes:** BW-75 (drafts hidden from My letters), BW-97 (a manager reads a direct report, with pay, bank and identity removed), BW-99 (people read their own sections), BW-03 (today's status only within team scope), BW-47 (first names only, approved leave only), BW-69 (holder names only with `hrms.employee.read`). | Each is listed under `behaviour_changes` in the package report, with unit tests for who sees what. |
| 20 | **Import behaviour change.** BW-93 routes imports through the Add path, so a row that passed before may now be refused (for example a department that doesn't exist); the department is no longer dropped. | Problems are returned per row. Imports keep ACTIVE status. Reported as a behaviour change. |
| 21 | **No new automatic notifications** (DECISIONS 13). | Only notifications a person triggers are added (Remind, Undo, Message team, Ask payroll, on-behalf, timesheet, signature request, asset problem). There are no scheduled jobs except BW-73's "Send on", which the user sets. |
| 22 | **The Undo aspect can silently stop recording** if a decide method is renamed. | A unit test fails when a pointcut doesn't match its method. The live test decides and undoes each kind. |
| 23 | **Home reads other packages' tables** (BW-120 needs-you sources). | Each source is guarded and skipped when its table is missing. P-HOME is in the last wave, after those `.be` merges. |
| 24 | **The approver preview duplicates the chain** in `LeaveController` and `WfhController`. | A fixture test keeps them identical. Q1 may switch the controllers to the shared service after the merge. |
| 25 | **Leftover test data**, including from stopped agents. | `live-slot.sh` recreates `ut_w3_dev` from `ut_w3_base` for every run. Nothing writes to `unifiedtree_recovery` or `ut_w3_base`. Every live test cleans up after itself. |
| 26 | **Managers' home moves** from the admin dashboard to the self-service Home (reverses 25 Sep). | They keep their team's day split, notices and milestones, and gain My team with the inbox. Stated in the final report. |
| 27 | **Behaviour fixes users will notice:** E28 (a fixed WFH day stays WFH), E29 (balances refresh on cancel), PENDING_L2 now visible, default shifts no longer recreated, the nominee total checked. | Reported as behaviour changes, each with a test. |
| 28 | **Very large packages** (P-ATT-DAY, P-HOME, P-TEAM) could run long. | The `.be` halves go first. Lower-priority items (timesheet, company KPIs, on-behalf actions) come last, so the core pages are not held up. |

---

## 8. Questions for the user

None. Every point could be decided safely from DECISIONS 1–18, the area audits and today's behaviour.


