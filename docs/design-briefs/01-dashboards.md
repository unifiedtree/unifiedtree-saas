# Dashboards & landing — page briefs

This group is the post-login home of the HRMS: the role-aware root redirect, the two variants of `/dashboard` (Company Admin Dashboard for admin roles, Staff Dashboard for everyone else) and the four dashboard tiles that live under them (Seats usage, Upcoming milestones, Upcoming probations, Company notices).
Sidebar: top-level **Dashboard** (`/dashboard`, icon LayoutDashboard) — visible to OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER (`layouts/PlatformShell.tsx:56`). EMPLOYEE gets **My Workspace** (`/me`) instead; DEPT_MANAGER also gets **My Team** (`/team`). The route itself is auth-only (`App.tsx:204-207`, "AUTH-ONLY (intentional)").
Roles: `useRoles()` buckets (`shared/hooks/useRoles.ts`) decide which variant renders — ADMIN bucket = OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN → `CompanyAdminDashboard`; every other principal (HR_MANAGER, HR, FINANCE_LEAD, DEPT_MANAGER, MANAGER, EMPLOYEE) → `RoleDashboard` inside `HrmsDashboard.tsx`. Every widget then gates on the SDK permission its endpoint requires (`usePermission(P.X)`).

Role constants used below (from `layouts/PlatformShell.tsx:69-81`): **R_HR** = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER · **R_ADMIN_MGR** = R_HR + FINANCE_LEAD + DEPT_MANAGER · **R_FIN_RUPEE** = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD · **R_ESS** = EMPLOYEE.

---

## Role-aware landing  `/`
- **File:** `App.tsx:111-120` (`RoleAwareLanding`)  ·  **Sidebar:** not in sidebar / reached by opening the app root or any unknown URL (`<Route path="*">` → `/`, `App.tsx:819`)  ·  **Roles:** every authenticated user (inside `RouteGuard` + `PlatformShell`, `App.tsx:196-201`)
- **Status:** LIVE — pure redirect, renders no UI: `roles.length > 0` → `<Navigate to="/modules" replace />`, otherwise → `/no-access`.

### Purpose
Drop the user from the website → workspace SSO hand-off straight into the app launcher ("Odoo-style") without a second login or a role-specific detour. Nobody "uses" this page; it exists so `/` is never blank.

### Layout (map to the design-system parts)
1. No layout. The only thing a user can ever see here is the global `React.Suspense` fallback "Loading…" (`App.tsx:167`, inline-styled grey 14px text, min-height 200) for a frame before `/modules` (`pages/Modules.tsx`, heading "Choose an app") or `/no-access` takes over.
2. `/module-workspace` (`App.tsx:192`) and `/payroll` (`App.tsx:804`) are sibling redirects into `/dashboard` and `/hrms/payroll-dashboard`.

### Data shown
- `useSdkStore(s => s.user?.roles)` — JWT roles array only. No API call.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| (auto) redirect to `/modules` | on mount | `<Navigate to="/modules" replace />` | any principal with ≥1 role | LIVE |
| (auto) redirect to `/no-access` | on mount | `<Navigate to="/no-access" replace />` | principal with zero roles | LIVE |

### States
loading: Suspense "Loading…" only · empty: n/a · error: n/a · no-permission: zero roles → `/no-access` page.

### Rules & permissions
- Role check is `roles.length > 0`, nothing finer. Per-route gating happens after the redirect (each module route has its own `RouteGuard`/`ModuleGate`).
- The comment in code says "redirects based on highest role" (`App.tsx:202`) but the implementation no longer does that — everyone goes to `/modules`. `ROLE_PRIORITY` (`App.tsx:109`) is still declared for it.

### Gaps & plan  (keep / add / change)
- **Keep:** the single redirect; no design work needed.
- **Add:** [BLUEPRINT §8.4 "Dashboards are role-shaped"] — target is HR/Admin → org dashboard, Finance → payroll dashboard, Manager → team dashboard, Employee → self-service home. Today every role lands on the launcher, then must click into HRMS. If the launcher is kept, this is a product decision to record, not a screen to design.
- **Change:** [code: stale comment `App.tsx:202` "Role-aware root — redirects based on highest role"] — rename or update so nobody designs a "landing page" that does not exist.

### Screenshot
`Attach: / — current screen` (will show /modules "Choose an app")

### Claude Design prompt (ready to paste)
```
No page to design for "/" — it is a redirect to /modules (app launcher) for every signed-in user and to /no-access for a user with no roles.
If you touch it at all, design only the 200 ms Suspense fallback: a centred "Loading…" line in --text-tertiary on the --bg-base canvas, no spinner, no card.
Do not invent a role-specific landing here; the role-specific homes are /dashboard (admin + staff variants, briefs below), /me (employee) and /team (manager).
```

---

## Company Admin Dashboard  `/dashboard`
- **File:** `modules/hrms/CompanyAdminDashboard.tsx` (rendered by `modules/hrms/HrmsDashboard.tsx:1222-1225` when `useRoles().isAdmin`), sub-widgets in `modules/hrms/dashboard/{CompanySummary,CompanyNotices,OperationalWidgets,ProjectProductivity}.tsx`, `modules/hrms/milestones/UpcomingMilestones.tsx`, `modules/hrms/probation/UpcomingProbations.tsx`  ·  **Sidebar:** Dashboard (top-level, `PlatformShell.tsx:56`)  ·  **Roles:** OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN (ADMIN bucket of `useRoles`; note ADMIN is *not* in the sidebar `visibleForRoles` list but the route is auth-only so `/dashboard` still opens for them)
- **Status:** LIVE — every block calls a real hook: `useTeamDashboard → GET /v1/attendance/dashboard`, `useAttendanceTrend → GET /v1/attendance/dashboard/trend`, `useEmployeeDirectory → GET /v1/hrms/employees`, `useLeaveOverview → GET /v1/leave/overview`, `useHeadcountReport → GET /v1/reports/headcount`, `useActivityFeed → GET /v1/audit/events`, `useCorrectionApprovals → GET /v1/attendance/corrections/approvals`, `useRequisitions → GET /v1/hiring/requisitions`, plus the `/v1/admin/dashboard/*` summary endpoints. [FUNCTIONALITY_AUDIT › route table row `/dashboard`: "Real data, API/browser checks"]. `useRequisitions` is fetched (`reqPage`, `hiringError`, only when `HRMS_HIRING_READ`) but the values are never rendered — dead fetch. `useLeaveOverview()` and `useCompanies()` fire for every viewer (no `enabled` gate).

### Purpose
The company admin's command centre: see who is in today, what is waiting for a decision (leave, corrections), how the company is doing (headcount, hiring, onboarding, payroll cost, compliance), broadcast notices, and jump to the screen where each number can be acted on. Users are OWNER / COMPANY_ADMIN / SUPER_ADMIN of an Indian SME tenant.

### Layout (map to the design-system parts)
1. **Header row** (custom, not `HrPageHeader`): eyebrow "DASHBOARD OVERVIEW", H1 `"{Good morning|Good afternoon|Good evening}, {firstName} 👋"` (falls back to "there"), subtitle "Your people, priorities and progress, in one place." Right side: date chip `Tuesday, 23 September 2026` (en-GB long), `HrButton variant="ghost"` **Export headcount** (Download icon), `HrButton` primary **Add employee** (UserPlus icon). → Map to `HrPageHeader` with `actions`.
2. **Section "Live Overview"** (`dashboard-section-title` with Clock icon, `aria-busy` while loading) — two rows of 4 clickable KPI tiles (custom cards; map to `HrStatCard` with `onClick`, `color`):
   - Row 1: **Total Employees** (blue Users, sub "Employee directory" with a green Activity icon) · **Present** (green UserCheck, sub "Checked in today") · **On Leave** (orange UserMinus, sub "Approved leave today") · **Late Arrivals** (red AlertCircle, sub "Needs attention"). Values are `text-3xl`; row 2 values are `text-2xl`.
   - Row 2: **Half Day** (purple Lightbulb) · **Work From Home** (blue Home) · **Not Marked** (orange HelpCircle) · **Absence** (red UserX). Row-2 tiles are horizontal (label+value left, icon right).
3. **Section "Company summary"** (`CompanySummary`, gated `org.company.read`) — grid of up to 4 `ut-card` buttons (→ `HrStatCard`): **Active employees**, **Open roles**, **Compliance completion** (value `"{score}%"` or "No items due", sub "{completed} of {due} obligations due this month through today completed"), **Finalized payroll · {YYYY-MM}** (value ₹ en-IN currency, no decimals, or "Not finalized", sub "Gross amount from locked or paid payroll"). Below: a wrap row of alert chips `ut-card` "**{count}** {label} →".
4. **Section "Attendance Analytics"** (gated `attendance.team.read`) — title row with link **View attendance →**; grid `1.4fr 1fr`:
   - `Card` **Weekly Attendance Trend**, chip "Last 7 days - IST": Recharts AreaChart, x = `MM-DD`, series *Regular check-ins* (#0F6E56 fill #E6F4F1), *Late* (#D97706), *Absent* (#DC2626), legend circles.
   - `Card` **Today's Attendance**, chip "{rosterTotal} employees - IST": 2-col grid of 8 outline buttons, each dot + name + bold count: Regular check-ins, Late arrivals, Absent, On leave, Work from home, Not marked, Half day, Early departures. The 8 dots use 8 hard-coded hues (`#0F6E56`, `#D97706`, `#DC2626`, `#6366F1`, `#0284C7`, `#64748B`, `#A16207`, `#9333EA`). Footnote "Regular check-ins exclude late, WFH and half-day records. Other categories can overlap. Click a count to see who."
5. **Section "Employee Analytics"** (gated `hrms.employee.read`) — 3-col grid: `Card` **Dept Distribution** (horizontal BarChart, y = department, bar "Active employees" #0F6E56; only if `HRMS_REPORT_HEADCOUNT`), `Card` **Top performers** (`Performers`, only if `hrms.performance.read`; caption "Average rating across submitted reviews.", rows are `<Link>`s on a `bg-bg-base` pill), `Card` **Onboarding tracker** (`OnboardingTracker`, only if `hrms.onboarding.instance.read`; underlined footer link **View all onboardings** always shown).
6. **2-col row:** section **Recruitment & Pipeline** → `Card` with `HiringProgress` (only if `hrms.hiring.read`); section **Projects & Productivity** → `Card` with `ProjectProductivity` (always rendered; shows "Loading company..." until `activeCompany` resolves).
7. **2-col row `2fr 1fr`:** section **Payroll & Finance** (Receipt icon, red title) → `Card` **Monthly payroll expense** with `PayrollTrend` (only if `PAYROLL_RUNS_READ` **and** tenant has the `payroll` module — otherwise the section renders a heading with nothing under it): caption "Gross payroll from locked and paid runs. Amounts in INR.", 256px Recharts BarChart (x = `YYYY-MM`, bar `var(--primary)`), underlined footer link **Open payroll**; section **Live Activity Feed** (only if `AUDIT_READ`) → `Card` with chip link **View all →**, vertical timeline of 5 events: dot cycling 5 hues (`#10B981`, `#3B82F6`, `#F59E0B`, `#8B5CF6`, `#059669`), "**{actor email}** {label lowercased}.", time `h:mm am/pm` (en-IN).
8. **Company notices** (`CompanyNotices`, gated `org.company.read`) — own H2 below.
9. **Section "Upcoming milestones"** — `UpcomingMilestones` card, then `UpcomingProbations` card (only if `HRMS_PROBATION_REMINDERS_READ`). Own H2s below.
10. **Section "Operational insights"** — 3-col grid of `Card`s each ending in an `HrButton`: **Attendance follow-up** ("Review today's attendance exceptions and open the employee list behind each count." → *Review attendance*), **Correction requests** ("{n} awaiting review" → *Review requests*), **Leave approvals** ("{n} awaiting review" / "Loading..." / "Unable to load approvals" → *Open leave approvals*).

### Data shown
- Header: `useAuthStore(s => s.user?.firstName)`; `useCompanies → GET /v1/hrms/companies` → `activeCompany = companies[0]` (every widget is scoped to the first company only).
- Live Overview: **Total Employees** = `directory.totalElements` from `useEmployeeDirectory({companyId, pageSize:5}) → GET /v1/hrms/employees?companyId=…&page=0&pageSize=5` (shows "Loading..." / "Unavailable"); the other 7 tiles = `counts.{present,onLeave,late,halfDay,workFromHome,notMarked,absent}` from `useTeamDashboard(todayIso) → GET /v1/attendance/dashboard?date=YYYY-MM-DD` (`todayIso` from `attendance/date.ts`, IST).
- Company summary: `GET /v1/admin/dashboard/stats?companyId=…` (`DashboardSummaryController`, `org.company.read`; backend omits `activeEmployees` without `hrms.employee.read`, `openRoles` without `hrms.hiring.read`, compliance fields without `hrms.compliance.read`, `monthlyPayroll` without `payroll.runs.read`). Alerts: `GET /v1/admin/dashboard/alerts` → exactly two types today, each emitted only when the caller holds the matching authority and counted over the caller's approval scope (`scope.resolve`, empty list → no alerts): `CORRECTIONS` "Attendance correction requests" → `/hrms/attendance?tab=corrections` (needs `attendance.regularization.approve`), `LEAVE` "Leave requests awaiting first approval" → `/hrms/leave` (needs `hrms.leave.approve.l1`).
- Attendance Analytics: trend rows `{date, present, late, absent, overtimeMinutes}` from `useAttendanceTrend(undefined, todayIso) → GET /v1/attendance/dashboard/trend?to=…`; Today's Attendance from the same `useTeamDashboard` (`counts.earlyCheckout` drives "Early departures"; `rosterTotal = staffStatuses.length`).
- Employee Analytics: `useHeadcountReport(companyId) → GET /v1/reports/headcount?companyId=…` rows `{department|'Unassigned', active}` filtered `active > 0`; `Performers → GET /v1/admin/dashboard/performers?companyId=…` `{id,name,rating,reviews}`; `OnboardingTracker → GET /v1/admin/dashboard/onboarding?companyId=…` `{id,name,status,completed,total}`.
- Recruitment: `HiringProgress → GET /v1/admin/dashboard/hiring?companyId=…` `{openJobs, stages[{stage,count}]}`.
- Projects: `ProjectProductivity` → `GET /v1/hrms/projects?companyId=…` `{id,name,status,total,completed}` and `GET /v1/hrms/projects/{id}/tasks` `{id,title,status,dueDate}`.
- Payroll: `PayrollTrend → useRuns({companyId}) → GET /v1/payroll/runs?companyId=…`, client-side groups `LOCKED`/`PAID` runs by `YYYY-MM`, sums `totalGross`, last 6 months; tooltip uses `inr()` → `₹12,40,000`.
- Activity: `useActivityFeed(8, canReadAudit) → GET /v1/audit/events?page=0&size=8`; label from `activityLabel(event)` (`humanise(action)` + " — " + `humanise(resourceType)` because `summary` is never written, e.g. "Updated — employee"), actor from `activityActor(event)` = `actorEmail || actorUserId || 'System'` — the feed shows an **email address**, not a person's name.
- Operational insights: `useCorrectionApprovals('PENDING', {size:1}) → GET /v1/attendance/corrections/approvals?status=PENDING&page=0&size=1` → `totalElements`; `useLeaveOverview → GET /v1/leave/overview` → `pendingApprovals`.
- Fetched but never rendered: `useRequisitions(0, undefined, {enabled: HRMS_HIRING_READ}) → GET /v1/hiring/requisitions?page=0&size=20` (`reqPage`, `hiringError` unused); `attendanceCardTitle`, `recentEmployees` unused. A `quickActions` array (Add Employee / Run Payroll / Attendance / Add Time-Off / Org Setup / View Reports, with `ORG_COMPANY_WRITE` and the five `HRMS_REPORT_*` permission checks) is built at `CompanyAdminDashboard.tsx:116-123` and never rendered — the admin variant has no Quick Actions card.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Export headcount | header | `apiBlob GET /v1/reports/headcount/export.csv?companyId=…` → downloads `headcount-YYYY-MM-DD.csv`; disabled while downloading or no company; on error `toast.error("Could not generate the report")` with 403 text "Your role doesn't include the headcount report." | `HRMS_REPORT_HEADCOUNT` | LIVE |
| Add employee | header | `navigate('/hrms/employees?add=1')` (opens Add Employee drawer directly) | `HRMS_EMPLOYEE_WRITE` | LIVE |
| Total Employees tile | Live Overview | `navigate('/hrms/employees')` | `HRMS_EMPLOYEE_READ` | LIVE |
| Present tile | Live Overview | `navigate('/hrms/attendance?tab=team&status=PRESENT&date={today}')` | `ATTENDANCE_TEAM_READ` | LIVE |
| On Leave tile | Live Overview | `…&status=ON_LEAVE&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Late Arrivals tile | Live Overview | `…&status=LATE&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Half Day tile | Live Overview | `…&status=HALF_DAY&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Work From Home tile | Live Overview | `…&status=WORK_FROM_HOME&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Not Marked tile | Live Overview | `…&status=NOT_MARKED&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Absence tile | Live Overview | `…&status=ABSENT&date=…` | `ATTENDANCE_TEAM_READ` | LIVE |
| Active employees | Company summary | `navigate('/hrms/employees?status=ACTIVE')` | `org.company.read` + `hrms.employee.read` | LIVE |
| Open roles | Company summary | `navigate('/hrms/hiring')` | + `hrms.hiring.read` | LIVE |
| Compliance completion | Company summary | `navigate('/hrms/compliance')` | + `hrms.compliance.read` | LIVE |
| Finalized payroll · {month} | Company summary | `navigate('/hrms/payroll/runs')` | + `payroll.runs.read` | LIVE |
| Retry summary | Company summary (error) | `stats.refetch()` | `org.company.read` | LIVE |
| {count} Attendance correction requests → | Company summary alerts | `navigate('/hrms/attendance?tab=corrections')` (path comes from the API row) | `org.company.read` + `attendance.regularization.approve` (backend filters the row) | LIVE |
| {count} Leave requests awaiting first approval → | Company summary alerts | `navigate('/hrms/leave')` (path comes from the API row) | `org.company.read` + `hrms.leave.approve.l1` (backend filters the row) | LIVE |
| Retry alerts | Company summary (error) | `alerts.refetch()` | `org.company.read` | LIVE |
| View attendance → | Attendance Analytics title | `navigate('/hrms/attendance?tab=team&date={today}')` | `ATTENDANCE_TEAM_READ` | LIVE |
| Try again | Weekly Attendance Trend (error) | `trendQuery.refetch()` | `ATTENDANCE_TEAM_READ` | LIVE |
| Regular check-ins / Late arrivals / Absent / On leave / Work from home / Not marked / Half day / Early departures (8 buttons) | Today's Attendance | `navigate('/hrms/attendance?tab=team&status={PRESENT|LATE|ABSENT|ON_LEAVE|WORK_FROM_HOME|NOT_MARKED|HALF_DAY|EARLY_OUT}&date={today}')` | `ATTENDANCE_TEAM_READ` | LIVE |
| Try again | Today's Attendance (error) | `teamDashboardQuery.refetch()` | `ATTENDANCE_TEAM_READ` | LIVE |
| Try again | Dept Distribution (error) | `headcountQuery.refetch()` | `HRMS_REPORT_HEADCOUNT` | LIVE |
| Performer row `{name} · {reviews} completed reviews · {rating}/5` | Top performers | `<Link to="/hrms/performance">` | `hrms.performance.read` | LIVE |
| Retry | Top performers (error) | `q.refetch()` | `hrms.performance.read` | LIVE |
| Onboarding row `{name} · {completed}/{total} tasks · progress bar · {status}` | Onboarding tracker | `<Link to="/hrms/onboarding/instances/{id}">` | `hrms.onboarding.instance.read` | LIVE |
| View all onboardings | Onboarding tracker footer | `<Link to="/hrms/onboarding/instances">` | `hrms.onboarding.instance.read` | LIVE |
| Retry | Onboarding tracker (error) | `q.refetch()` | `hrms.onboarding.instance.read` | LIVE |
| {openJobs} Open requisitions | Recruitment & Pipeline | `<Link to="/hrms/hiring">` | `hrms.hiring.read` | LIVE |
| Stage row `{stage} {count}` | Recruitment & Pipeline "Candidates by current stage" | `<Link to="/hrms/hiring">` (no stage filter) | `hrms.hiring.read` | LIVE — dead-endish (same unfiltered target for every stage) |
| Retry | Recruitment (error) | `q.refetch()` | `hrms.hiring.read` | LIVE |
| Open payroll | Monthly payroll expense footer | `<Link to="/hrms/payroll-dashboard">` | `PAYROLL_RUNS_READ` + payroll module | LIVE |
| Retry | Monthly payroll expense (error) | `q.refetch()` | same | LIVE |
| View all → | Live Activity Feed chip | `navigate('/audit-logs')` | `AUDIT_READ` | LIVE |
| Try again | Live Activity Feed (error) | `activityQuery.refetch()` | `AUDIT_READ` | LIVE |
| Review attendance | Operational insights › Attendance follow-up | `navigate('/hrms/attendance?tab=team&date={today}')` | `ATTENDANCE_TEAM_READ` | LIVE |
| Review requests | Operational insights › Correction requests | `navigate('/hrms/attendance?tab=corrections')` | `ATTENDANCE_REGULARIZATION_APPROVE` | LIVE |
| Try again | Correction requests (error) | `corrections.refetch()` | same | LIVE |
| Open leave approvals | Operational insights › Leave approvals | `navigate('/hrms/leave')` (not `?tab=approvals`) | `HRMS_LEAVE_APPROVE_L1` | LIVE |
| (Projects, Notices, Milestones, Probations actions) | sub-sections | see their own H2s below | | |

### States
- loading: header renders immediately; KPI values show literal text "Loading..."; section bodies use `queryState()` → `.dashboard-state` "Loading..." (`role="status"`); `CompanySummary` "Loading company summary..." / "Loading pending actions..."; widgets "Loading..."; Projects "Loading company..." until company list resolves. No skeletons.
- empty: `queryState` "No records for this period." (trend / today's attendance / dept distribution / activity); Top performers "No completed ratings yet."; Onboarding "No onboarding runs in progress."; Hiring "No candidates recorded."; Payroll "No finalized payroll runs."; Compliance value "No items due"; Payroll summary "Not finalized".
- error: KPI value "Unavailable"; `queryState` "Unable to load this section." + ghost **Try again**; `CompanySummary` shows raw `error.message` + **Retry summary** / **Retry alerts**; widgets "Unable to load this information." + **Retry**; Leave approvals "Unable to load approvals".
- no-permission: each section simply disappears (no placeholder). A payroll-less tenant still sees the red "Payroll & Finance" heading with an empty body.
- special: Live Overview is `aria-busy` while directory/team queries load; dashboard is scoped to `companies[0]` only.

### Rules & permissions
- Variant selection: `isAdmin` (OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN) → this page; everyone else → Staff Dashboard.
- Section gates (all SDK `usePermission`): Live Overview tiles `HRMS_EMPLOYEE_READ` (total) / `ATTENDANCE_TEAM_READ` (7 attendance tiles); Company summary `org.company.read` + per-field backend filtering; Attendance Analytics `ATTENDANCE_TEAM_READ`; Employee Analytics `HRMS_EMPLOYEE_READ` (+ `HRMS_REPORT_HEADCOUNT` for the chart, `hrms.performance.read`, `hrms.onboarding.instance.read`); Recruitment `HRMS_HIRING_READ`; Payroll `PAYROLL_RUNS_READ` **and** `tenant.activeModules` includes `payroll`; Activity `AUDIT_READ`; Correction requests `ATTENDANCE_REGULARIZATION_APPROVE`; Leave approvals `HRMS_LEAVE_APPROVE_L1`; Probations `HRMS_PROBATION_REMINDERS_READ`; Projects `hrms.project.read` / `hrms.project.write`.
- Tenant scoping is server-side RLS; company scoping is `companies[0]` (first company only — multi-company tenants never see the others here).
- Dates use IST (`attendanceDate()`, backend `Asia/Kolkata`); payroll summary = first LOCKED/PAID run of the current month.
- Permission-gated queries are disabled (not just hidden) when the permission is missing so nothing 403s; the exceptions are `useCompanies` (`GET /v1/hrms/companies`) and `useLeaveOverview` (`GET /v1/leave/overview`), which always fire, and the `CompanyNotices` / `ProjectProductivity` queries, which gate on their own `usePermission` reads.

### Gaps & plan  (keep / add / change)
- **Keep:** the section order Overview → Analytics → Employee → Recruitment/Projects → Payroll/Activity → Notices → Upcoming → Operational (matches [BLUEPRINT §8.2] "LIVE OVERVIEW → ANALYTICS → OPERATIONS → ACTIVITY → UPCOMING"); every tile drills to a filtered destination ([BLUEPRINT §8.3] "Every number is a question, and every question must have a destination"); real-data-only rule ([HANDOFF §5 "Dashboard, company and payroll overview"] "Permission-filtered real summary/alerts, performers, hiring stages, onboarding counts and finalized payroll trends").
- **Add:** [BLUEPRINT §8.3] missing drill-downs — **Pending WFH** (`/v1/wfh` → `/hrms/wfh?tab=approvals`, backend "Expose"), **Attendance source ×6** (`dashboard/sources` → `…&method=FACE_RECOGNITION`, needs filter param; this widget exists only on the Staff Dashboard, not here), **Payroll run status / exceptions** (`payroll/dashboard/kpis`, `runs/{id}/skipped` → `/hrms/payroll/runs/{id}?tab=skipped`), **Seats used** (`workspace/seats/usage` → `/settings/billing` — the `SeatsUsageTile` component exists but is not rendered anywhere, see its H2).
- **Add:** [BLUEPRINT §8.2 header] "Greeting · date · live clock ······ [Mark Attendance] [Generate Report]" — this variant has no clock and no Mark Attendance; Generate Report is present as "Export headcount".
- **Add:** [code: `useRequisitions` fetched, never rendered] an **Open Positions / candidates in pipeline** KPI (the Staff Dashboard computes `openings` + `candidateCount` from OPEN requisitions; this file fetches the same page and drops it).
- **Add:** [IMPLEMENTATION_PLAN §6] "Payroll exceptions … `runs/{id}/skipped` … not shown"; "Birthdays / anniversaries … list only → `/hrms/employees?filter=…`".
- **Change:** [BLUEPRINT §8.2] "Dropped from the reference: AI Insights, Top Performers, Payroll vs Budget, Projects (Section 6.1)" — the page still renders **Top performers** and **Projects & Productivity** (now backed by real endpoints per [HANDOFF §5] "This is not a complete project-management product"). Decide: keep as-is (real data) or drop per blueprint; the design should not give them KPI-level prominence.
- **Change:** [code] "Candidates by current stage" rows all link to unfiltered `/hrms/hiring`; blueprint target is `/hrms/hiring?tab=candidates`.
- **Change:** [code] **Open leave approvals** goes to `/hrms/leave` while the KPI tiles elsewhere use `/hrms/leave?tab=approvals` — inconsistent.
- **Change:** [code] "Payroll & Finance" heading renders with an empty body when payroll is not active; hide the whole section.
- **Change:** [code] no loading skeletons — literal "Loading..." strings inside 3xl KPI numbers cause layout jump; use `HrStatCard loading` / `SkeletonCardGrid`.
- **Change:** [code] mixed UI kits — bespoke `Card`, raw `<button className="…rounded-2xl…">` tiles, `ut-card` buttons in CompanySummary, `bg-primary/10` links in widgets. Consolidate to `HrStatCard` / `TableCard` / `HrButton`.
- **Change:** [code] `activityLabel(event).toLowerCase()` produces sentences like "**priya.nair@ionora.in** updated — employee." — the actor is `actorEmail`, not a display name, and there is no resource name/link; the audit page has it.
- **Change:** [code; client rule quoted in `HrmsDashboard.tsx:62-65` "Chart palette — emerald family only"] this variant uses 8 hues for the Today's Attendance dots, amber/red series on the trend and 5 hues on the activity-feed dots — bring them into the emerald family with legend dots/labels as the secondary encoding.
- **Change:** [BLUEPRINT §8.3 "On Leave → `/hrms/leave?tab=approved&date=today`"] both variants send On Leave to the attendance roster (`?tab=team&status=ON_LEAVE`) instead — deliberate per the comment in `HrmsDashboard.tsx` ("which of my people are out today"); record the decision so the design uses one target.
- **Add:** [IMPLEMENTATION_STATUS "Important limits still open" › "every custom role combination, and all mobile layouts need broader acceptance"; HANDOFF §10.G "empty/loading/error states"] the dashboard has only smoke coverage (390px layout check per [IMPLEMENTATION_STATUS "Final regression follow-up" live-mobile-layout]); the design must specify every section's loading / empty / error / no-permission state for each admin role, not just the happy path.

### Screenshot
`Attach: /dashboard (as COMPANY_ADMIN) — current screen`

### Claude Design prompt (ready to paste)
```
Design the Company Admin Dashboard (/dashboard) for OWNER / COMPANY_ADMIN / SUPER_ADMIN of an Indian SME.
Use HrPageHeader: eyebrow "Dashboard Overview", title "Good morning, Kavya 👋", subtitle "Your people, priorities and progress, in one place.", right side a date chip "Tuesday, 23 September 2026" + ghost HrButton "Export headcount" (Download) + primary HrButton "Add employee" (UserPlus).
Section "Live Overview": 8 HrStatCard tiles in 2 rows of 4, all clickable — Total Employees 142 "Employee directory" (blue) · Present 118 "Checked in today" (green) · On Leave 9 "Approved leave today" (orange) · Late Arrivals 6 "Needs attention" (red) · Half Day 3 · Work From Home 11 · Not Marked 4 · Absence 5. Each drills to /hrms/attendance?tab=team&status=… for today.
Section "Company summary": 4 HrStatCard — Active employees 138 · Open roles 7 · Compliance completion 80% with sub "8 of 10 obligations due this month through today completed" · "Finalized payroll · 2026-09" ₹48,20,000 sub "Gross amount from locked or paid payroll" (or "Not finalized"); below, alert chips "3 Attendance correction requests →" and "5 Leave requests awaiting first approval →".
Section "Attendance Analytics" (link "View attendance →"): left Card "Weekly Attendance Trend" chip "Last 7 days - IST" area chart with series Regular check-ins (emerald), Late (amber), Absent (red), x-axis 09-17…09-23; right Card "Today's Attendance" chip "142 employees - IST": 2×4 grid of outline buttons "● Regular check-ins 98", "● Late arrivals 6", "● Absent 5", "● On leave 9", "● Work from home 11", "● Not marked 4", "● Half day 3", "● Early departures 2", footnote "Regular check-ins exclude late, WFH and half-day records. Other categories can overlap. Click a count to see who."
Section "Employee Analytics": Card "Dept Distribution" horizontal bar chart (Engineering 46, Sales 31, Operations 24, Finance 12, Unassigned 3) · Card "Top performers" caption "Average rating across submitted reviews." rows "Rahul Verma — 4 completed reviews — 4.6/5" · Card "Onboarding tracker" rows "Ananya Iyer 5/8 tasks" with progress bar and status "IN_PROGRESS", footer link "View all onboardings".
Row: Card "Recruitment & Pipeline" — big number "7 Open requisitions" then "Candidates by current stage" rows (Applied 24, Screening 9, Interview 5, Offer 2) · Card "Projects & Productivity" (3 mini stats Active projects / Completed tasks / Task completion %, project select, task list — keep it compact and secondary).
Row: Card "Monthly payroll expense" caption "Gross payroll from locked and paid runs. Amounts in INR.", bar chart of last 6 months gross (x-axis "2026-04"…"2026-09", tooltip ₹48,20,000), footer link "Open payroll" · Card "Live Activity Feed" timeline of 5 rows "priya.nair@ionora.in updated — employee. 10:42 am" (actor is the email today; design for a display name + resource link as the target), chip "View all →".
Then Company notices, Upcoming Milestones and Upcoming Probation Confirmations cards (separate briefs), then "Operational insights": 3 Cards each with one HrButton — "Attendance follow-up / Review attendance", "Correction requests — 3 awaiting review / Review requests", "Leave approvals — 5 awaiting review / Open leave approvals".
States: SkeletonCardGrid while loading (replace literal "Loading..."), EmptyState "No records for this period.", error block "Unable to load this section." + ghost "Try again"; sections with no permission are removed entirely (never an empty heading).
Keep: every number clickable to a filtered list; IST dates "23 Sep 2026"; ₹1,20,000 formatting. Add: Open Positions/candidates KPI, Seats-usage tile (billing admins), Pending WFH and Attendance-source drill-downs, a Quick Actions card (the admin variant computes the list and never renders it). Change: emerald-family chart palette only (today the attendance dots use 8 hues and the activity dots 5), stage rows must link to /hrms/hiring?tab=candidates, Leave approvals to /hrms/leave?tab=approvals, hide Payroll section when the module is off, give Projects/Top performers lower visual weight than the KPI strip.
```

---

### Company notices  (section of `/dashboard`, admin variant)
- **File:** `modules/hrms/dashboard/CompanyNotices.tsx`  ·  **Sidebar:** not in sidebar / rendered inside `CompanyAdminDashboard` after the Payroll/Activity row  ·  **Roles:** read `org.company.read`; add/edit/archive `org.company.write`
- **Status:** LIVE — `GET/POST/PUT/DELETE /v1/admin/dashboard/notices` ([HANDOFF §5] "Notices create/edit/expiry/archive/paging"; [IMPLEMENTATION_STATUS] "Company notices | Create, edit, expiry, archive, pagination").

#### Purpose
Admin posts short company-wide announcements ("Diwali holiday 20–21 Oct", "New leave policy from 1 Oct") with an optional expiry, and edits or archives them.

#### Layout
1. `ut-card` section: header row H2 **Company notices** + `HrButton` **Add notice** (write only).
2. Notice list: each `<article>`: H3 title, body (`whitespace-pre-wrap`), meta "Published 18 Sep 2026 · Until 2026-10-21" (`expiresOn` is raw ISO — inconsistent with the `d MMM yyyy` published date), then ghost `HrButton`s **Edit notice** / **Archive notice**.
3. Inline form (not a drawer/modal) when adding/editing, `aria-label="Company notice"`: **Notice title** (`required`, `maxLength=200`), **Notice message** textarea (`required`, `maxLength=5000`, 4 rows), **Expiry (optional)** date (`min=today`), buttons **Save notice** (primary) / **Cancel** (ghost). → Map to `HrDrawer` or `Modal size="md"` with `Field/Input/Label`.
4. Pager: **Previous notices** · "{page+1} / {ceil(total/5)}" · **Next notices** (`HrButton`s; → `HrPagination`).

#### Data shown
- `GET /v1/admin/dashboard/notices?companyId=…&page={n}` → `{content:[{id,title,body,expiresOn?,createdAt}], totalElements}`, 5 per page.

#### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Add notice | card header | clears form state, opens inline form | `org.company.write` | LIVE |
| Edit notice | per article | pre-fills form with that notice, opens inline form | `org.company.write` | LIVE |
| Archive notice | per article | `useConfirmDialog` "Archive notice?" / "This notice will no longer appear on the dashboard." / confirm **Archive** (danger) → `DELETE /v1/admin/dashboard/notices/{id}` | `org.company.write` | LIVE |
| Save notice | form submit | `POST /v1/admin/dashboard/notices` or `PUT …/{id}` body `{companyId,title,body,expiresOn|null}` → invalidates `['dashboard','notices']`, closes form, resets to page 0; error → `toast(e.message,'error')` | `org.company.write` | LIVE |
| Cancel | form | closes form | `org.company.write` | LIVE |
| Previous notices / Next notices | footer (only when `totalElements > 0`) | page ± 1 (disabled at bounds) | `org.company.read` | LIVE |
| Retry | error state | `notices.refetch()` | `org.company.read` | LIVE |

#### States
loading "Loading notices..." · empty "No current company notices." · error raw `error.message` + **Retry** · no-permission: section not rendered (`!read`); `write` only removes the buttons/form · Save disabled while `save.isPending` or no `companyId`; Archive notice disabled while `save.isPending`.

#### Rules & permissions
Title ≤200, body ≤5000, expiry ≥ today; archive is soft (DELETE = archive, backend V135 `hrms.company_notices` "archive/expiry"). Company-scoped (`companyId`), tenant RLS.

#### Gaps & plan
- **Keep:** CRUD + confirm-before-archive + paging.
- **Add:** [code] no success toast after save/archive (only errors toast).
- **Change:** [code] inline form pushes the list down; use `HrDrawer` "New notice / Edit notice" with footer Save/Cancel. Expiry meta shows raw `2026-10-21`; format as `21 Oct 2026`. Buttons "Previous notices / Next notices" → `HrPagination`.

#### Screenshot
`Attach: /dashboard › Company notices — current screen`

#### Claude Design prompt (ready to paste)
```
Design the "Company notices" card on the admin dashboard for OWNER / COMPANY_ADMIN.
Card header "Company notices" + primary HrButton "Add notice" (write roles only). List of notices: title "Diwali holiday — office closed 20–21 Oct", body text (multi-line), meta "Published 18 Sep 2026 · Until 21 Oct 2026", ghost HrButtons "Edit notice" and "Archive notice" (archive opens a danger confirm "Archive notice? This notice will no longer appear on the dashboard." with button "Archive").
Add/Edit opens an HrDrawer titled "New notice" / "Edit notice" with Field "Notice title" (max 200), textarea "Notice message" (max 5000), date "Expiry (optional)" (min today), footer primary "Save notice" + ghost "Cancel".
Footer HrPagination 5 per page ("1 / 3"). States: "Loading notices...", EmptyState "No current company notices.", error line + "Retry". Read-only viewers (org.company.read without write) see no buttons.
```

---

### Projects & Productivity  (section of `/dashboard`, admin variant)
- **File:** `modules/hrms/dashboard/ProjectProductivity.tsx`  ·  **Sidebar:** not in sidebar / rendered inside `CompanyAdminDashboard` next to Recruitment  ·  **Roles:** `hrms.project.read` to see, `hrms.project.write` to create/change
- **Status:** LIVE — `GET /v1/hrms/projects`, `GET /v1/hrms/projects/{id}/tasks`, `POST /v1/hrms/projects`, `PUT …/{id}/status`, `POST …/{id}/tasks`, `PUT …/tasks/{id}/status` ([HANDOFF §5] "Projects/tasks create/status/actual completion. Cannot close unfinished projects or change closed projects.").

#### Layout
1. 3 mini stat boxes (→ `StatCard`): **Active projects** (count `status==='ACTIVE'`), **Completed tasks** (sum `completed`), **Task completion** (`round(done/total*100)%`), "—" until loaded.
2. Raw `<select className="ut-select">` labelled **Project** ("Select project", options "{name} · {status}") → map to `HrSelect`.
3. Create form (write): input "New project name" (`required`, `maxLength=200`) + `HrButton` **Create**.
4. When a project is selected: H3 **Tasks** + raw `<select>` **Project status** (ACTIVE / COMPLETED / CANCELLED, write only, `max-w-40`); task rows: title, "Due 2026-10-05" or "No due date", right side raw `<select>` status (`aria-label="Status for {title}"`, PENDING / IN_PROGRESS / DONE) for writers or `HrStatusPill tone="gray"` for readers. All three selects → `HrSelect`.
5. Add-task form (write): input "Task title" (`required`, `maxLength=300`), date **Due date**, `HrButton` **Add task**.

#### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Project select | body | loads `GET /v1/hrms/projects/{id}/tasks` | `hrms.project.read` | LIVE |
| Create | new-project form submit | `POST /v1/hrms/projects {companyId,name}` → selects new project, clears input | `hrms.project.write` | LIVE |
| Project status select | Tasks header | `PUT /v1/hrms/projects/{id}/status {status}` | `hrms.project.write` | LIVE |
| Task status select (per task) | task row | `PUT /v1/hrms/projects/tasks/{taskId}/status {status}` | `hrms.project.write` | LIVE |
| Add task | add-task form submit | `POST /v1/hrms/projects/{id}/tasks {title,dueDate?}` → clears form | `hrms.project.write` | LIVE |
| Retry | error blocks | `projects.refetch()` / `tasks.refetch()` | `hrms.project.read` | LIVE |

#### States
no-permission "Project access is not enabled for your role." · loading "Loading projects..." / "Loading tasks..." · empty tasks "No tasks yet." · error raw message + **Retry** · selects disabled while `change.isPending`; mutation errors → `toast(e.message,'error')`.

#### Rules & permissions
Backend refuses closing unfinished projects / changing closed projects ([HANDOFF §5]); name ≤200, task title ≤300; company-scoped.

#### Gaps & plan
- **Keep:** works, real data.
- **Change:** [BLUEPRINT §8.2 / §6.1; IMPLEMENTATION_PLAN §6 "Not implemented (Class E …): Projects & Productivity. No data source; do not fabricate."] Projects was to be *dropped* from the dashboard — the docs predate the real `/v1/hrms/projects` backend ([HANDOFF §5]); if kept, it is a mini-app inside a card — give it its own page or a compact read-only summary here with a "Manage projects" link. [code] Due date rendered raw ISO; format `5 Oct 2026`. Status values shown as raw enums (`IN_PROGRESS`) — use `HrStatusPill` wording "In progress".

#### Screenshot
`Attach: /dashboard › Projects & Productivity — current screen`

#### Claude Design prompt (ready to paste)
```
Design the "Projects & Productivity" card on the admin dashboard (roles with hrms.project.read; write actions for hrms.project.write).
Top: 3 StatCards "Active projects 4", "Completed tasks 37", "Task completion 68%". Then HrSelect "Project" (options like "Payroll migration · ACTIVE"). Writers get an inline "New project name" input + HrButton "Create".
Selected project shows a "Tasks" list: rows "Collect bank mandates — Due 5 Oct 2026" with an HrSelect status (Pending / In progress / Done) for writers or an HrStatusPill for readers; project status HrSelect (Active / Completed / Cancelled) in the Tasks header; add-task form "Task title" + "Due date" + HrButton "Add task".
States: "Project access is not enabled for your role." (no permission), "Loading projects...", "No tasks yet.", error + "Retry". Keep it visually secondary to the KPI sections; consider a "Manage projects" link out instead of full editing here.
```

---

## Staff Dashboard  `/dashboard`
- **File:** `modules/hrms/HrmsDashboard.tsx` (`RoleDashboard`, lines 199-1219; exported `HrmsDashboard` at 1222-1225 picks it when `!isAdmin`)  ·  **Sidebar:** Dashboard (top-level) for HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER; EMPLOYEE / MANAGER / HR reach it only by URL (their sidebar home is `/me` or `/team`)  ·  **Roles:** HR_MANAGER, HR, FINANCE_LEAD, DEPT_MANAGER, MANAGER, EMPLOYEE (any non-admin bucket)
- **Status:** PARTIAL — KPI strip, Attendance Overview donut, Attendance Trend, Department Headcount, Attendance Source, Overtime, Recent Employees and Quick Actions are wired to real hooks; but **Mark Attendance** button has no handler, **Employee Type** card is a permanent "Data unavailable", **Upcoming Key Dates** is three static rows ("Check milestones"), **Corrections (N/A)** / **Overtime (N/A)** are inert, subtitle hard-codes "Ionora", and ~250 lines (`kpiTiles`, `chartTiles`, `KpiTile`, `DonutGauge`, `downloadHeadcountCsv`, `statusFilter`) are built but never rendered. `UpcomingProbations`, `UpcomingMilestones`, `SeatsUsageTile` are imported and never used.

### Purpose
Home for the working HR manager, finance lead, department manager or employee: a greeting with the clock, today's headline numbers they are allowed to see, a way into attendance/leave, and quick actions. Content composition changes by permission (an EMPLOYEE sees only "Pending Requests" + Quick Actions + the mostly-empty analytics cards).

### Layout (map to the design-system parts)
1. **Greeting card** (white rounded-2xl with `/assets/decorative_leaf.jpg` at right, `mix-blend-multiply`): H1 "Good morning, {firstName}! 👋", subtitle "Here's what's happening at Ionora today." (hard-coded); right: date "Tuesday, 23 September 2026" + live clock "9:41 AM" (`useLiveClock`, en-US), dark-green button **Mark Attendance** (ScanFace icon, ChevronRight) — **no `onClick`**. → `HrPageHeader` with `actions`.
2. **KPI strip** — `SkeletonCardGrid count={5}` while pending, else 1–5 clickable white tiles (→ `HrStatCard`): **Total Employees** "Active in {company}" (`HRMS_EMPLOYEE_READ`) · **Present Today** with mini ring gauge + "↓ {pct}% of total" · **On Leave** "↓ {pct}% of total" · **Absent Today** "↓ {pct}% of total" (the three need `ATTENDANCE_TEAM_READ`) · **Pending Requests** "requires action" (always). Percentages divide by `Math.max(totalEmployees, 1)`; `totalEmployees` is 0 for anyone without `HRMS_EMPLOYEE_READ` (DEPT_MANAGER / MANAGER after V112), so the divisor collapses to 1 and the tile prints e.g. "↓ 9800% of total" and the Present ring gauge overflows.
3. **Main 3-col grid:**
   - `Card` **Attendance Overview**, chip = `<select>` with single option "Today" (inert): Recharts donut (inner 70 / outer 90) of `attendanceSlices` with centre "{rosterTotal} TOTAL", legend of 6 clickable rows "● Present 98 (69%) →" (Present, Late, Absent, On Leave, Work From Home, Not Marked). Fallback "No data available".
   - `Card` **Attendance Trend**, chip `<select>` "Last 14 days" (inert; data is last 7 days): 380px AreaChart *Present* (emerald) + *Absent* (red dashed), weekday labels. Fallback "No trend data available".
   - Promo banner (`bg-[#E8F5E9]`, `/assets/promo_plant.jpg`): "Everything in one place for a better tomorrow" / "Manage your people, processes and growth with ease." + `Card` **Quick Actions** (chip: Settings gear button with no handler) — 2-col grid of icon buttons.
4. **Secondary 4-col row** of `Card`s each with an inert `<select>` chip: **Department Headcount** ("Active Employees") donut, centre total, top-3 legend (multi-colour palette blue/green/amber/red/purple — violates the emerald-only rule) · **Employee Type** ("All") → always "Data unavailable" · **Attendance Source** ("Today") donut of `{method,count}` (4-hue palette purple/green/blue/amber) + top-3 legend · **Overtime** ("This month") orange Clock tile, big "{h}h" "Logged this period", plus a **decorative static three-bar mini chart** (grey bars at 25/50/75% height, not data) at the right; empty state "No overtime recorded".
5. **Bottom 4-col row:** `Card` **Recent Employees** (2 cols) — raw `<table>` Employee (`HrAvatar` + name) / Email / Status (`HrStatusPill` ok=ACTIVE, warn=PROBATION, gray otherwise, raw enum text) / Actions (a Grid icon button with no handler); rows clickable → `/hrms/employees/{id}`. → `TableCard` + `DataTable`. · `Card` **Upcoming Key Dates** — three static rows Birthdays "Check milestones", Anniversaries "Check milestones", Probations "Check probations list" (no data, no links). · `Card` **Needs Your Attention** — row **Leave Requests** with count badge (clickable), rows **Corrections (N/A)** and **Overtime (N/A)** greyed, `cursor-pointer` but no handler.
6. **Footer strip:** "A people-first workplace creates limitless possibilities." · People • Process • Progress (hover styles, no links).

### Data shown
- Greeting: `useAuthStore(s => s.user?.firstName)`; clock = `new Date()` every second.
- `useCompanies → GET /v1/hrms/companies` → `activeCompany = companies[0]` (name in "Active in …").
- Total Employees / Recent Employees: `useEmployeeDirectory({companyId, pageSize:5}, {enabled: HRMS_EMPLOYEE_READ}) → GET /v1/hrms/employees?companyId=…&page=0&pageSize=5` → `totalElements`, `content[{id,employeeCode,firstName,lastName,email,employmentStatus,…}]` (`employeeCode` is in the payload but not rendered).
- Present / On Leave / Absent / Attendance Overview: `useTeamDashboard(undefined, undefined, ATTENDANCE_TEAM_READ) → GET /v1/attendance/dashboard` (no date param → server today) → `counts.{present,late,absent,onLeave,workFromHome,notMarked}`, `staffStatuses.length` as roster total.
- Pending Requests: `useLeaveOverview → GET /v1/leave/overview` → approvers show `pendingApprovals`, others show count of `recentRequests` with `status==='PENDING'` (own pending).
- Attendance Trend / Overtime: `useAttendanceTrend(…, ATTENDANCE_TEAM_READ) → GET /v1/attendance/dashboard/trend` → `{date,present,absent,overtimeMinutes}`; Overtime = `floor(Σ overtimeMinutes / 60)h` (label says "This month" but data is the 7-day trend).
- Attendance Source: `useAttendanceSources(…, ATTENDANCE_TEAM_READ) → GET /v1/attendance/dashboard/sources` → `sources[{method,count}]` (raw enum labels like `FACE_RECOGNITION`).
- Department Headcount: `useHeadcountReport(companyId | null)` enabled only when `canSeeWorkforceTiles` (= `HRMS_EMPLOYEE_READ` && (isAdmin||isHR||isFinance)) → `GET /v1/reports/headcount?companyId=…`.
- Also fetched: `useMonthlyStats(year, month, {enabled: !isAdmin}) → GET /v1/attendance/monthly-stats` (only used by the never-rendered `chartTiles`), `useActivityFeed(8, AUDIT_READ) → GET /v1/audit/events` (never rendered), `useRequisitions(0, …, {enabled: canSeeHiringTiles}) → GET /v1/hiring/requisitions` (never rendered). Three wasted requests per load.
- Employee Type: no hook — hard "Data unavailable".

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Mark Attendance | greeting card | nothing — `<button>` without `onClick` | everyone | DEAD (no handler) |
| Total Employees tile | KPI strip | `navigate('/hrms/employees')` | `HRMS_EMPLOYEE_READ` | LIVE |
| Present Today tile | KPI strip | `navigate('/hrms/attendance?tab=team&status=PRESENT')` | `ATTENDANCE_TEAM_READ` | LIVE |
| On Leave tile | KPI strip | `…&status=ON_LEAVE` | `ATTENDANCE_TEAM_READ` | LIVE |
| Absent Today tile | KPI strip | `…&status=ABSENT` | `ATTENDANCE_TEAM_READ` | LIVE |
| Pending Requests tile | KPI strip | `navigate(canApproveLeaves ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my')` | everyone | LIVE |
| "Today" select | Attendance Overview chip | inert (single option) | everyone | STUB |
| Legend rows Present / Late / Absent / On Leave / Work From Home / Not Marked | Attendance Overview | `navigate('/hrms/attendance?tab=team&status={PRESENT|LATE|ABSENT|ON_LEAVE|WORK_FROM_HOME|NOT_MARKED}')`, `title="View the {n} {status} employees"` | rendered only when team data loaded (`ATTENDANCE_TEAM_READ`) | LIVE |
| "Last 14 days" select | Attendance Trend chip | inert | everyone | STUB (data is 7 days) |
| Quick Actions gear | Quick Actions chip | nothing — no handler | everyone | DEAD |
| Add Employee | Quick Actions | `navigate('/hrms/employees?add=1')` | `HRMS_EMPLOYEE_WRITE` | LIVE |
| Run Payroll | Quick Actions | `navigate('/hrms/payroll-dashboard')` | `PAYROLL_RUNS_READ` && payroll module active | LIVE |
| Attendance | Quick Actions | `navigate('/hrms/attendance')` | everyone | LIVE |
| Add Time-Off | Quick Actions | `navigate('/hrms/leave')` | everyone | LIVE |
| Org Setup | Quick Actions | `navigate('/hrms/organization')` | `ORG_COMPANY_WRITE` | LIVE |
| View Reports | Quick Actions | `navigate('/hrms/reports')` | any of `HRMS_REPORT_{HEADCOUNT,ATTRITION,ATTENDANCE,LEAVE,DIVERSITY}` | LIVE |
| "Active Employees" / "All" / "Today" / "This month" selects | secondary row chips | inert | everyone | STUB |
| Recent Employees row | Recent Employees table | `navigate('/hrms/employees/{id}')` | `HRMS_EMPLOYEE_READ` (table shows "No employees yet." otherwise) | LIVE |
| Row ⋮ (Grid icon) | Recent Employees › Actions column | nothing — no handler; click bubbles to row navigate | | DEAD |
| Birthdays / Anniversaries / Probations | Upcoming Key Dates | static text, no handler | everyone | STUB |
| Leave Requests | Needs Your Attention | `navigate(pendingApprovals > 0 ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my')` — note: uses `pendingApprovals > 0`, not `canApproveLeaves` | everyone | LIVE (logic bug) |
| Corrections (N/A) | Needs Your Attention | nothing | | STUB |
| Overtime (N/A) | Needs Your Attention | nothing | | STUB |
| People • Process • Progress | footer | nothing (hover only) | | DEAD |
| (dead code) Generate Report / headcount CSV, `KpiTile`s "Total Employees", "Your Attendance"/"My Attendance", "Pending Leaves"/"My Pending Requests", "Open Positions — {n} candidates in pipeline", cards "Your Attendance" gauge (`DonutGauge`), "Headcount by Department" bar, a second "Attendance Trend" (neutral dashed Absent), "Recent Activity" | `kpiTiles` (`HrmsDashboard.tsx:440-520`) / `chartTiles` (`525-675`) arrays, never rendered | `apiBlob GET /v1/reports/headcount/export.csv` etc. | | DEAD |

### States
- loading: `SkeletonCardGrid count={5}` replaces the KPI strip while `leaveOverview` (and, when enabled, `monthly-stats`, `directory`) are pending; charts render fallback text meanwhile.
- empty: Attendance Overview "No data available"; Attendance Trend "No trend data available"; Department Headcount / Attendance Source "No data"; Employee Type "Data unavailable" (permanent); Overtime "No overtime recorded"; Recent Employees "No employees yet." / "No employees match this filter." (filter UI never rendered, so second string unreachable).
- error: no error UI anywhere — a failed query just leaves the empty text. Only the unreachable CSV export has a toast.
- no-permission: tiles vanish; an EMPLOYEE sees 1 KPI tile (Pending Requests), "No data available" / "No trend data available", promo banner, 2 quick actions (Attendance, Add Time-Off), "No data" ×2 (Department Headcount, Attendance Source), "Data unavailable" (Employee Type), "No overtime recorded", "No employees yet.", static Key Dates, "Needs Your Attention".
- special: percentages are `count / max(totalEmployees,1)` — "↓ 9800% of total" for a DEPT_MANAGER with `ATTENDANCE_TEAM_READ` but no `HRMS_EMPLOYEE_READ`; `↓` arrow is hard-coded regardless of direction.

### Rules & permissions
- Variant: any principal not in the ADMIN bucket. `canSeeWorkforceTiles = HRMS_EMPLOYEE_READ && (isAdmin||isHR||isFinance)` (client rule quoted in code: managers/employees never see workforce-wide tiles); `canSeeHiringTiles = HRMS_HIRING_READ && (isAdmin||isHR)`; `canSeeOwnAttendance = !isAdmin` (client rule: "for admin no need attendance history or his attendance summary in the dashboard"); `canSeeSeatsTile = isAdmin && WORKSPACE_BILLING_MANAGE` (so on this non-admin variant it is always false — and the tile is not rendered anyway).
- Pending Requests: approvers (`HRMS_LEAVE_APPROVE_L1`) see the approval queue count, others their own pending count.
- Run Payroll hidden unless `PAYROLL_RUNS_READ` **and** `tenant.activeModules` includes `payroll` (avoids the ModuleGate "module not activated" wall).
- Company scoping: `companies[0]`; `/monthly-stats` returns the *caller's own* record (no team aggregate endpoint yet — comment in code).

### Gaps & plan  (keep / add / change)
- **Keep:** the greeting + clock + KPI strip + drill-through legend of Attendance Overview (this file implemented the [BLUEPRINT §8.3] status drill-downs — `?tab=team&status=…`); real-data-only rule (the removed fabricated charts must not come back); permission-driven composition; `SkeletonCardGrid` loading.
- **Add:** [BLUEPRINT §8.2] "[Mark Attendance]" must actually punch in/out (button exists with no handler); [BLUEPRINT §8.3] "Attendance source ×6 → `…&method=FACE_RECOGNITION` (Filter param)" — Attendance Source legend is not clickable; "Pending Corrections → `/hrms/attendance?tab=corrections`" and "Early Going → `…&status=EARLY_OUT`" — shown as "Corrections (N/A)" / "Overtime (N/A)" here; "Birthdays / anniversaries → list" — Upcoming Key Dates is static while `UpcomingMilestones` and `UpcomingProbations` are imported but unused; [BLUEPRINT §8.4] Manager should open on a *team* dashboard "Team attendance, my approvals", Employee on "My attendance, leave balance, payslip" — this variant gives an EMPLOYEE almost nothing (see `/me` and `/team` briefs in other groups).
- **Add:** [code: dead `chartTiles`] "Your Attendance" card (Present days / On time / Late days / Absent days / Holidays + donut score, chip "On track"/"Needs attention"/"No data", from `/v1/attendance/monthly-stats`) and "Open Positions — {n} candidates in pipeline" KPI (from `/v1/hiring/requisitions`) were written for HR/manager/employee and never mounted; and "Recent Activity" (audit feed) likewise. Decide per role and mount or delete.
- **Change:** [code] "Ionora" hard-coded in the subtitle → `activeCompany.name`. Chip `<select>`s with one option (Today / Last 14 days / Active Employees / All / This month) are fake controls — remove or make them real (Trend actually shows 7 days). Employee Type card has no data source — remove ([BLUEPRINT] rule: "a tile either renders real tenant data or it does not ship"). Department Headcount uses a 5-colour palette against the emerald-only client rule stated in the same file. Overtime label "This month" vs 7-day data. "↓" arrow is static. Recent Employees "Actions" ⋮ does nothing; status pill shows raw `PROBATION`/`ACTIVE`. `Needs Your Attention › Leave Requests` navigates by `pendingApprovals > 0` instead of approver permission (an approver with zero queue lands on "my" tab). No error state on any card. Footer "People • Process • Progress" and promo banner are decoration with hover affordance — drop or make non-interactive. Three unused queries (`monthly-stats`, `audit/events`, `hiring/requisitions`) fire on every load (the latter two only when the permission is held).
- **Change:** [code `HrmsDashboard.tsx:760-818`; rule quoted in the same file "a tile either renders real tenant data or it does not ship"] KPI percentages and the Present ring gauge divide by `max(totalEmployees,1)` — a manager without `HRMS_EMPLOYEE_READ` sees "↓ 9800% of total"; divide by `rosterTotal` (as the Attendance Overview legend already does) or hide the percentage. The Overtime card draws a static three-bar grey mini chart that is not data — remove it.
- **Add:** [IMPLEMENTATION_STATUS "Important limits still open" › "every custom role combination, and all mobile layouts need broader acceptance"; HANDOFF §10.G] this variant serves five role buckets with one layout and has no error state at all — the design must show the HR_MANAGER, DEPT_MANAGER and EMPLOYEE compositions and an error treatment per card.

### Screenshot
`Attach: /dashboard (as HR_MANAGER) — current screen` and `Attach: /dashboard (as EMPLOYEE) — current screen`

### Claude Design prompt (ready to paste)
```
Design the Staff Dashboard (/dashboard) for HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER/MANAGER and EMPLOYEE (non-admin buckets); composition is permission-driven, so show the HR_MANAGER version and note what an EMPLOYEE loses.
HrPageHeader as a greeting card: "Good morning, Kavya! 👋", subtitle "Here's what's happening at Ionora Systems today." (company name from data), right: "Tuesday, 23 September 2026" + live clock "9:41 AM" + primary HrButton "Mark Attendance" (ScanFace) that must punch in/out (today it is a dead button).
KPI strip of HrStatCard (SkeletonCardGrid while loading): Total Employees 142 "Active in Ionora Systems" · Present Today 118 "83% of total" (ring gauge) · On Leave 9 "6% of total" · Absent Today 5 "4% of total" · Pending Requests 7 "requires action" (approvers → /hrms/leave?tab=approvals, others → /hrms/leave?tab=my). Tiles the role cannot see are removed, not blank.
3-col row: Card "Attendance Overview" (chip "Today", no fake select) donut with centre "142 Total" and clickable legend rows "● Present 118 (83%) →", Late 6, Absent 5, On Leave 9, Work From Home 11, Not Marked 4 — each opens /hrms/attendance?tab=team&status=…; Card "Attendance Trend" chip "Last 7 days" (today the chip is a fake select reading "Last 14 days") area chart Present (emerald) vs Absent (neutral dashed — today red dashed), Mon…Sun; Card "Quick Actions" 2×3 icon buttons Add Employee · Run Payroll · Attendance · Add Time-Off · Org Setup · View Reports (permission-gated, no gear icon).
Secondary row: Card "Department Headcount" (emerald-family donut, legend Engineering 46 / Sales 31 / Operations 24), Card "Attendance Source" (Face recognition 74 / GPS 22 / Manual 8 / Web 14 — clickable to …&method=), Card "Overtime — 38h logged, last 7 days" (no decorative bars). Drop "Employee Type" (no data source). Percentages on the KPI strip must be computed against the roster total, never printed as "9800%".
Bottom row: TableCard "Recent Employees" with DataTable columns Employee (HrAvatar + name + EMP-0142 — employeeCode is in the payload, not rendered today) · Email · Status (HrStatusPill "Active"/"Probation" — today raw ACTIVE/PROBATION) · row click opens /hrms/employees/{id}, no ⋮ column; Card "Upcoming Key Dates" must render the real Upcoming Milestones + Upcoming Probations components (birthdays 14 days, anniversaries 31 days, retirements 6 months, probation ending 30 days); Card "Needs Your Attention" rows Leave Requests 7 → /hrms/leave?tab=approvals, Correction requests 3 → /hrms/attendance?tab=corrections, Early departures 2 → …&status=EARLY_OUT (replace the "(N/A)" rows).
States: SkeletonCardGrid loading; EmptyState "No data available" / "No trend data available" / "No employees yet."; every card gets an error line + "Try again" (today there is none).
Keep: real data only, emerald chart family, ₹/EMP-/"18 Sep 2026" formats. Change: remove decorative footer "People • Process • Progress" hover states and the promo banner's interactive look; all chip selects either work or become static labels.
```

---

## Seats usage tile  (dashboard tile)
- **File:** `modules/hrms/SeatsUsageTile.tsx`, hook `modules/hrms/api/useSeats.ts`  ·  **Sidebar:** not in sidebar / intended for the admin dashboard  ·  **Roles:** intended `isAdmin && WORKSPACE_BILLING_MANAGE` (comment in file + `canSeeSeatsTile` in `HrmsDashboard.tsx:300`, computed and never read)
- **Status:** DEAD — component is complete and wired (`useSeatsUsage → GET /v1/workspace/seats/usage`, 30 s refetch) but is imported in `HrmsDashboard.tsx:32` and never rendered; `CompanyAdminDashboard.tsx` (the admin variant it was built for) does not import it. [IMPLEMENTATION_PLAN §6] lists "Seats used | `workspace/seats/usage` | → billing | ✅" as done — it is not on screen.

### Purpose
Tell the billing admin how many employee seats the plan includes, how many are used and how many remain, and push them to `/settings/billing` before the backend starts returning 402 on employee creation. Client rule (2026-08-17, quoted in file): "let admin know in his dashboard … how many seats used… only admin will see this who has access for manage your plan for workspace."

### Layout (map to the design-system parts)
1. `ut-card` (→ `HrStatCard`-sized card, own layout): header — emerald icon tile (Users2) + "Employee Seats" + status chip (`Healthy` emerald · `Running low` amber · `Almost full` orange · `Seats exhausted` red · `Unlimited` emerald · `No active plan` slate). Warning tiers add a coloured ring on the card.
2. Body by tier:
   - finite (ok/low/critical/exhausted): big "{current}" + "of {purchased} seats used"; sub "{remaining} remaining · admins included"; progress bar (`role="progressbar"`, width = `current/purchased`%), bar colour by tier.
   - `unlimited` (purchased ≥ 1000): "{current} employees onboarded" · "Enterprise plan — no seat cap."
   - `inactive` (purchased ≤ 0): "No active subscription on this workspace." · "{current} employee(s) on file." · full-width `HrButton size="sm"` **Choose a plan**.
3. Footer CTA (low/critical/exhausted only): full-width `HrButton size="sm"` **Manage plan** (ghost) or **Upgrade to add more employees** (primary when exhausted). The `ok` and `unlimited` tiers have no button at all.

### Data shown
- `useSeatsUsage() → GET /v1/workspace/seats/usage` → `{purchased, current, remaining}` (`currentExcludingAdmin` deprecated); auth-only endpoint; `refetchInterval` 30 s.
- Tier thresholds (`computeTier`): remaining/purchased ≤ 5% → critical, ≤ 15% → low, remaining ≤ 0 → exhausted.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Choose a plan | body (inactive tier) | `navigate('/settings/billing')` (route is `RequirePermission WORKSPACE_BILLING_MANAGE`) | billing admins | LIVE code, DEAD on screen |
| Manage plan | footer (low / critical) | `navigate('/settings/billing')` | billing admins | LIVE code, DEAD on screen |
| Upgrade to add more employees | footer (exhausted) | `navigate('/settings/billing')` | billing admins | LIVE code, DEAD on screen |
| Retry | error state (underlined text button, not `HrButton`) | `refetch()` | | LIVE code, DEAD on screen |

### States
loading: skeleton card matching geometry (`role="status"` "Loading seat usage") · error: red-ringed card "Seat usage unavailable" + `error.message` or "Could not load the current seat count." + underlined **Retry** · inactive / unlimited / ok / low / critical / exhausted as above · no-permission: consumer is expected to hide it.

### Rules & permissions
Show only to `isAdmin && P.WORKSPACE_BILLING_MANAGE`; `current` counts all active employees including admins (client decision 2026-08-22); `purchased ≥ 1000` treated as unlimited; backend enforces the cap with 402 on POST employee.

### Gaps & plan
- **Keep:** the tier logic, the honest "No active plan" state, the progress bar as secondary encoding.
- **Add:** [BLUEPRINT §8.3 "Seats used | workspace/seats/usage | /settings/billing"] mount it on the **Company Admin Dashboard** Live Overview (it belongs to the admin variant, which never imports it) and delete the unused import from `HrmsDashboard.tsx`.
- **Change:** [code] ring/chip colours are hard Tailwind (`ring-amber-300/70`, `bg-slate-100`) — map to `HrStatusPill` tones (ok / warn / late / red / gray) and card tokens.

### Screenshot
`Attach: (not currently rendered) — use the component in isolation`

### Claude Design prompt (ready to paste)
```
Design the "Employee Seats" tile for OWNER / COMPANY_ADMIN who hold workspace.billing.manage, placed in the Company Admin Dashboard's Live Overview row.
Card header: emerald Users2 icon + "Employee Seats" + HrStatusPill state chip — Healthy (ok) / Running low (warn) / Almost full (late) / Seats exhausted (red) / Unlimited (ok) / No active plan (gray).
Body: "132" large + "of 150 seats used", sub "18 remaining · admins included", progress bar 88% coloured by tier; footer HrButton size sm "Manage plan" (ghost, low/almost full) or "Upgrade to add more employees" (primary, exhausted) → /settings/billing.
Variants: Unlimited → "132 employees onboarded / Enterprise plan — no seat cap."; No active plan → "No active subscription on this workspace." + "132 employees on file." + primary "Choose a plan"; loading skeleton of the same geometry; error card "Seat usage unavailable — Could not load the current seat count." + "Retry".
Keep all six tiers; use tokens, not raw amber/slate classes.
```

---

## Upcoming milestones  (dashboard tile)
- **File:** `modules/hrms/milestones/UpcomingMilestones.tsx`, hook `modules/hrms/api/useMilestones.ts`  ·  **Sidebar:** not in sidebar / rendered in `CompanyAdminDashboard.tsx:365` section "Upcoming milestones"; imported but unused in `HrmsDashboard.tsx`  ·  **Roles:** no gate (endpoint is `isAuthenticated()`); in practice admin roles only, because only the admin variant mounts it. Row click only for `HRMS_EMPLOYEE_READ`.
- **Status:** LIVE — `useMilestones({birthdayDays:14, anniversaryDays:31, retirementMonths:6}) → GET /v1/hrms/milestones?birthdayDays=14&anniversaryDays=31&retirementMonths=6` (10 min stale). Web half of the mobile-app parity requested 2026-08-22 (comment in file).

### Purpose
Let HR/admin see who has a birthday in the next two weeks, a work anniversary in the next month, or a retirement in the next six months, and jump to the employee.

### Layout (map to the design-system parts)
1. `ut-card`: header row PartyPopper icon + "Upcoming Milestones".
2. Three columns (stack on mobile): **Birthdays** (Cake) · **Work Anniversaries** (Award) · **Retirements** (PartyPopper); each header has a count badge when non-empty.
3. Rows: 32px initials avatar (deterministic tint per employeeId; → `HrAvatar`), name, second line "{Today | Tomorrow | in 5 days | 12 Oct} · {N years | department}". Anniversaries show "{years} year(s)"; birthdays/retirements show department.
4. Column empty hints: "No birthdays in the next 14 days." / "No work anniversaries in the next month." / "No retirements in the next 6 months."
5. Loading: 3 skeleton rows per column (`role="status"`).

### Data shown
- `GET /v1/hrms/milestones` → `{birthdays[], anniversaries[], retirements[]}` of `{employeeId, name, initials, department|null, date (next occurrence ISO), years|null}`. No PII beyond name/department.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Milestone row | any column | `navigate('/hrms/employees/{employeeId}')` only when `HRMS_EMPLOYEE_READ`; otherwise inert (looks clickable — `hover:bg-slate-50` still applied) | `HRMS_EMPLOYEE_READ` to navigate | LIVE / PARTIAL (silent no-op for others) |
| Try again | error card (underlined text button, not `HrButton`) | `refetch()` | everyone | LIVE |

### States
loading: skeleton rows · empty (all three empty): whole card collapses to one line "No birthdays in the next 14 days, anniversaries in the next month, or retirements in the next six months." · per-column empty hints · error: `ut-card` "Unable to load milestones." + underlined **Try again** · no-permission: n/a (auth-only); rows inert without `HRMS_EMPLOYEE_READ`.

### Rules & permissions
Server rolls dates forward to the next occurrence, so `whenLabel` never sees a past date; look-ahead windows are fixed (14 / 31 days / 6 months; server clamps 1-366 days, 1-60 months). Row navigation guarded because `/hrms/employees/:id` is `RouteGuard hrms.employee.read` (removed from EMPLOYEE V051 and DEPT_MANAGER/MANAGER V112 — 2026-09-08 audit note in file).

### Gaps & plan
- **Keep:** three-column layout, relative-day labels, collapse-when-quiet behaviour, guarded navigation.
- **Add:** [BLUEPRINT §8.3] "Birthdays / anniversaries | `/v1/milestones` | `/hrms/employees?filter=birthday` | Minor" — a "View all" into a filtered directory; [BLUEPRINT §8.2 UPCOMING] mount on the Staff Dashboard too (its "Upcoming Key Dates" card is a static placeholder; the import is already there).
- **Change:** [code] rows keep hover/cursor styling even when `canOpenEmployee` is false — render as non-interactive text for those roles. Date fallback uses `en-IN` "12 Oct" — fine; make it `12 Oct 2026` when crossing a year.

### Screenshot
`Attach: /dashboard › Upcoming Milestones — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Upcoming Milestones" card (admin dashboard; also to be reused on the staff dashboard). Header: PartyPopper icon + "Upcoming Milestones".
Three columns with count badges: "Birthdays 3" (Cake) — rows HrAvatar initials + "Ananya Iyer" / "Tomorrow · Engineering", "Rohit Sharma" / "in 6 days · Sales"; "Work Anniversaries 2" (Award) — "Priya Nair" / "Today · 5 years", "Vikram Rao" / "in 12 days · 1 year"; "Retirements 1" — "S. Krishnamurthy" / "18 Mar 2027 · Operations".
Row click → /hrms/employees/{id} only for roles with hrms.employee.read; otherwise rows are plain text (no hover). Column empty hints: "No birthdays in the next 14 days." / "No work anniversaries in the next month." / "No retirements in the next 6 months."; when all three are empty the card collapses to a single line "No birthdays in the next 14 days, anniversaries in the next month, or retirements in the next six months."
Loading: three skeleton rows per column. Error: "Unable to load milestones." + "Try again". Add a small "View all" link per column to /hrms/employees?filter=birthday|anniversary|retirement.
```

---

## Upcoming probation confirmations  (dashboard tile)
- **File:** `modules/hrms/probation/UpcomingProbations.tsx`, hook `modules/hrms/api/useProbation.ts` (`useUpcomingProbations`)  ·  **Sidebar:** not in sidebar / rendered in `CompanyAdminDashboard.tsx:365` after Upcoming Milestones; imported but unused in `HrmsDashboard.tsx`. Related settings page: **Settings › HR Configuration** `/hrms/settings` → `probation/ProbationSettings.tsx` (reminder days, auto-extend, button **Trigger scan now**; `RouteGuard HRMS_PROBATION_CONFIG_READ`, `App.tsx:604-611`) — separate brief group.  ·  **Roles:** `HRMS_PROBATION_REMINDERS_READ` (gate in `CompanyAdminDashboard`), admin bucket in practice
- **Status:** LIVE — `useUpcomingProbations(30) → GET /v1/probation/upcoming?days=30`, rendered with the ui-kit `DataTable`.

### Purpose
HR/admin sees which employees' probation ends within 30 days (or is already overdue) so they can confirm or extend before the date passes.

### Layout (map to the design-system parts)
1. `ut-card`: header CalendarClock icon + "Upcoming Probation Confirmations" + count badge; when empty, a right-aligned one-liner "None ending in the next 30 days" and **no table** (deliberate — comment in file).
2. `DataTable` (ui-kit version; → HRMS `DataTable` inside `TableCard`), columns: **Employee** (name bold + "{employeeCode} · {jobTitle}") · **Manager** (`managerName` or "—", hidden < md) · **Probation End** (`d MMM yyyy`, hidden < sm) · **Days** (`Badge` tone error ≤3 d, warning ≤7 d, info otherwise; label "{n}d left" or "{n}d overdue"). Row click → employee workspace.

### Data shown
- `GET /v1/probation/upcoming?days=30` → `[{employeeId, employeeCode, employeeName, probationEndDate, daysRemaining, jobTitle?, managerName?}]`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Row click | table | `navigate('/hrms/employees/{employeeId}')` (employee workspace; the extend action lives there via `useExtendProbation → POST /v1/probation/employees/{id}/extend?newEndDate=`) | `HRMS_PROBATION_REMINDERS_READ` (+ `HRMS_EMPLOYEE_READ` for the target route) | LIVE |

### States
loading: `DataTable isLoading` · empty: header one-liner "None ending in the next 30 days" (table hidden; `emptyTitle` "No upcoming confirmations" / `emptyDescription` "No employees have probation ending in the next 30 days." are unreachable) · error: none (hook error ignored; card shows the empty line) · no-permission: not rendered.

### Rules & permissions
Window fixed at 30 days; negative `daysRemaining` = overdue (red); gate `HRMS_PROBATION_REMINDERS_READ`. Reminder cadence / auto-extend configured on `/hrms/settings` (`reminderDaysBefore` 1-90, `autoExtendEnabled`, `autoExtendDays` 1-365; `POST /v1/probation/scan-now` via `useTriggerProbationScan` invalidates this card's query).

### Gaps & plan
- **Keep:** compact quiet state, overdue colouring, row → employee.
- **Add:** [BLUEPRINT §8.2 UPCOMING "Probation endings"] mount on the Staff Dashboard for HR_MANAGER (import exists, unused); [BLUEPRINT §28 Client Acceptance Checklist › HR "Who is on probation"] a link to the full list (`/hrms/employees?status=PROBATION`); row-level **Confirm** / **Extend** actions (backend `POST /v1/probation/employees/{id}/extend` exists; no confirm endpoint found in `useProbation.ts`).
- **Change:** [code] no error state; uses ui-kit `DataTable`/`Badge` instead of HRMS `DataTable`/`HrStatusPill` (tone names differ: error/warning/info vs red/warn/info).

### Screenshot
`Attach: /dashboard › Upcoming Probation Confirmations — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Upcoming Probation Confirmations" card for HR/admin roles with hrms.probation.reminders.read (admin dashboard, reusable on the staff dashboard).
Header: CalendarClock icon + "Upcoming Probation Confirmations" + count badge "4"; quiet state is a single right-aligned line "None ending in the next 30 days" with no table.
TableCard › DataTable columns: Employee (bold "Meera Joshi" + "EMP-0142 · Junior Accountant") · Manager ("Suresh Menon" or "—") · Probation End ("30 Sep 2026") · Days (HrStatusPill: red "2d overdue" / "3d left", warn "7d left", info "21d left"). Row click → /hrms/employees/{id}.
Add row actions "Extend" (opens a small Modal with new end date, POST /v1/probation/employees/{id}/extend) and a footer link "View all on probation" → /hrms/employees?status=PROBATION. States: table skeleton while loading; error line "Unable to load probations" + "Try again" (missing today).
```
