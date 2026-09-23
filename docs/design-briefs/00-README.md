# UnifiedTree HRMS — page-brief pack for Claude Design

Entry point. Read this, then open the group file for the screen you are designing.
Sources: the ten verified briefs `01-*.md` … `10-*.md` in this folder, `.design-sync/conventions.md`, `.design-sync/NOTES.md`, `apps/platform/src/layouts/PlatformShell.tsx`, and the repo-root audit docs (`HRMS_TARGET_BLUEPRINT.md` = BLUEPRINT, `HRMS_IMPLEMENTATION_PLAN.md` = PLAN, `HRMS_CLAUDE_HANDOFF.md` = HANDOFF, `HRMS_IMPLEMENTATION_STATUS.md` = STATUS, `HRMS_FUNCTIONALITY_AUDIT.md` = FUNCTIONALITY_AUDIT). Every claim below cites one of them.

---

## 1. What this pack is

- One brief per screen (85 briefed screens: 83 routed pages/tiles + 2 dashboard sections), each with **File · Sidebar · Roles · Status · Purpose · Layout · Data · Actions · States · Rules · Gaps & plan (keep / add / change) · Screenshot · Claude Design prompt** — written from the code as it is today, not from the reference product.
- Status is what the code does now: **LIVE** (every block calls a real hook), **PARTIAL** (some static/dead pieces), **STUB** (placeholder by design), **DEAD** (wired but unreachable or unmounted).
- The "Gaps & plan" bullets are the design backlog; §6 below is the cross-module cut of that backlog.

**What Claude Design can do with it.** It designs clickable prototypes out of the real components uploaded to the "UnifiedTree HRMS Design System" project (`window.UnifiedTree`: the HRMS primitives + ui-kit + tokens — NOTES "Sync scope decisions"). Buttons and tabs change prototype state; **nothing calls an API**. The finished design is the contract the implementation agent builds against — so a design that shows a state the backend cannot produce (see §6 "do not design as live" items) becomes a bug, not a feature.

**What it cannot do.** It cannot fetch tenant data, cannot verify a permission, and cannot see the parts of the app that are not in a brief. Fonts (Plus Jakarta Sans / Inter / JetBrains Mono) are runtime Google Fonts — the design app needs network access to render them (NOTES "Styling").

---

## 2. How to use it in Claude Design — step by step

1. Open the project **UnifiedTree HRMS Design System** — <https://claude.ai/design/p/00b3efa9-2fcf-413b-b54b-efd18bbbaccb>. (The older project *UnifiedTree HRMS* `99ea22a9-…` holds a partial 7/44 upload and is abandoned — NOTES "Sync scope decisions".)
2. Pick a screen from the IA table in §3; open its brief file and find its `## <Page>  \`/route\`` section.
3. **Paste the whole section** (Purpose → Rules & permissions) as context. It tells the designer what exists, what each role sees, and every action with its current status.
4. **Attach the current screenshot** named in the section's `### Screenshot` line (format: `Attach: /route — current screen`, sometimes with extra tabs/drawers to capture, e.g. Daily Tracking wants `?tab=team`, `?tab=my`, `?tab=corrections`, `?tab=face`).
5. **Paste the section's `### Claude Design prompt (ready to paste)`** code block. It is written to be pasted verbatim.
6. **Iterate with keep / add / change language** — the same vocabulary the "Gaps & plan" block uses, so the transcript maps back to the brief.
7. **Then design flows across pages** (dashboard tile → filtered list → row drawer → employee workspace; apply → approve; run → lock → disburse). Use the drill-down targets listed in each brief's Actions table so every prototype link lands on a real route.
8. **Hand-off:** export the design; the implementation agent reads the design plus the same brief, and treats any "coming later" annotation as out of scope.

### Reusable prompt template

```
Screen: <label>  —  route <route>  —  group <sidebar group>  —  brief docs/design-briefs/<file>#<heading>
Roles that see it: <from the brief's Roles line>. Design the <ROLE> view first; then show <other role> as a variant.
Attached: current screenshot(s) — <Attach line>.

Keep: <bullets from "Keep">
Add: <bullets from "Add", each with its citation>
Change: <bullets from "Change">

Rules (do not break): page anatomy from conventions.md — HrPageHeader (crumb "HRMS / <group>", title, subtitle, actions=HrButton, tabs=HrTabs) → KPI strip of HrStatCard (grid-cols-2 sm:grid-cols-4) → TableCard (search, FilterBar, actions) wrapping DataTable (first column HrAvatar name sub=EMP-0142, status column HrStatusPill, row action HrButton size=sm variant=ghost, ≤5–6 columns) → HrPagination footer → EmptyState / TableSkeleton.
Records open in HrDrawer; confirmations and short forms in Modal; destructive confirms via ConfirmDialog.
Money ₹1,20,000 (en-IN, no decimals); dates 18 Sep 2026; codes EMP-0142; tabular-nums on numbers.
Status is a tone, never a colour: ok approved/present · warn pending · late/orange late, half day · info in review · teal WFH · purple on leave · pink probation · red rejected/absent · gray draft/closed/weekly off.
Emerald accent only (--accent-fg #0f6e56, mint #10b981); charts in the emerald family with legend labels as the secondary encoding.
Show four states for every section: loading (skeleton), empty (EmptyState with one CTA), error (EmptyState + Retry), no-permission (section absent, never a 403).
Anything marked "coming later" in the brief is shown disabled with that label, never as working.
```

### Example follow-up prompts

- "Add the empty state for the Approvals tab: `EmptyState` icon CalendarCheck, title 'All caught up', one line 'No leave or WFH requests are waiting for you.', no CTA. Keep the KPI strip visible with zeros."
- "Make the Approve action open a confirm `Modal` (size sm): title 'Approve leave for Priya Mehta?', body shows type · 3 days · 18–20 Sep 2026 · balance after 9, optional note field, footer [Cancel] [Approve] (HrButton primary). On confirm the row's pill changes to Approved and a toast reads 'Leave approved'."
- "Design the mobile layout (390px): rail collapses to the drawer, KPI strip becomes 2×2, `DataTable` becomes a card list with HrAvatar + status pill + one ghost action, filters move into a sheet behind a 'Filters (2)' button, and the HrDrawer becomes full-screen with a sticky footer."

---

## 3. Information architecture

Sidebar order is `NAV_ITEMS` → `MODULE_ITEMS` (HRMS groups) → `PLATFORM_ITEMS` / `SETTINGS_NAV` in `apps/platform/src/layouts/PlatformShell.tsx`. Rail (collapsed) labels come from `RAIL_LABELS`. Roles = `visibleForRoles` (see §4); some leaves also show for any role holding a listed permission (`visibleWithAnyPermission`).

### Top-level links (`NAV_ITEMS`, lines 52–59)

| Page label | Route | Roles | Brief |
|---|---|---|---|
| Dashboard | `/dashboard` | OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER (ADMIN opens it too — route is auth-only) | `01-dashboards.md` › Company Admin Dashboard (admin bucket) · Staff Dashboard (everyone else) |
| My Workspace | `/me` | EMPLOYEE | `02-self-service-and-team.md` › My Workspace |
| My Team | `/team` | DEPT_MANAGER (MANAGER counts as DEPT_MANAGER) | `02-self-service-and-team.md` › My Team |

### HRMS groups (`MODULE_ITEMS`, `module: 'hrms'`)

| Sidebar group (rail label) | Page label | Route | Roles | Brief |
|---|---|---|---|---|
| Company Profile (Company) | Companies & Branches | `/hrms/companies` | R_HR | `03-company-and-master.md` |
| Master (Master) | Workforce Directory | `/hrms/employees` | R_HR | `03-company-and-master.md` |
| | Organization Setup | `/hrms/organization` | R_HR | `03-company-and-master.md` |
| | Rules & Policies | `/hrms/policies` | R_HR | `03-company-and-master.md` |
| | Payroll Configuration | `/hrms/payroll/components` | R_FIN_META | `06-payroll.md` › Salary Components |
| Attendance & Time (Time) | Attendance Analytics | `/hrms/att-analytics` | R_ADMIN_MGR | `04-attendance-and-time.md` |
| | Daily Tracking | `/hrms/attendance` | R_ADMIN_MGR | `04-attendance-and-time.md` |
| | Shifts & Overtime | `/hrms/shifts` | R_HR | `04-attendance-and-time.md` |
| | Geofencing | `/hrms/attendance/geofencing` | R_HR | `04-attendance-and-time.md` |
| Leave Management (Leave) | Leave Operations Center | `/hrms/leave` | R_ADMIN_MGR (EMPLOYEE reaches it by deep link) | `05-leave-expense-advances.md` |
| Recruitment & Onboarding (Hire) | Hiring Pipeline | `/hrms/hiring` | R_HR or `hrms.hiring.offer.read` | `07-recruitment-onboarding-letters.md` › Hiring Center |
| | Onboarding & Assets | `/hrms/onboarding/instances` | R_HR or `hrms.onboarding.asset.read` | `07-…` |
| | Letter Templates | `/hrms/letters/templates` | R_HR | `07-…` |
| | Generated Letters | `/hrms/letters/generated` | R_HR | `07-…` |
| | Letter Distributions | `/hrms/letters/distributions` | R_HR | `07-…` |
| | Employee Vault | `/hrms/documents` | R_HR or `hrms.letters.template.read` | `07-…` › Employee Vault |
| Payroll (Payroll) | Payroll Dashboard | `/hrms/payroll-dashboard` | R_FIN_RUPEE | `06-payroll.md` |
| | Salary Structure | `/hrms/salary-structure` | R_FIN_RUPEE | `06-payroll.md` |
| | Processing & Payslips | `/hrms/payroll/runs` | R_FIN_META | `06-payroll.md` |
| | Payroll Settings | `/hrms/payroll/settings` | R_FIN_RUPEE | `06-payroll.md` |
| | Production-Linked Incentive | `/hrms/pli` | R_FIN_META | `06-payroll.md` |
| | Advances & Loans | `/hrms/advances` | R_ADMIN_MGR + R_ESS | `05-leave-expense-advances.md` › Salary Advances |
| | Bank Disbursement | `/hrms/bank-disbursement` | R_FIN_RUPEE | `06-payroll.md` |
| Expense Management (Expense) | Expense Center | `/hrms/expenses` | R_ADMIN_MGR + R_ESS or expense permissions | `05-leave-expense-advances.md` |
| Employee Self Service (Me) | My Attendance & Leaves | `/hrms/attendance` | R_ESS | `04-attendance-and-time.md` › Daily Tracking (`?tab=my`) |
| | My Payslip | `/me/payslips` | R_ESS | `02-self-service-and-team.md` |
| | My Profile | `/me` | R_ESS | `02-self-service-and-team.md` › My Workspace (same page as the top-level link) |
| | Team Attendance | `/team` | DEPT_MANAGER | `02-self-service-and-team.md` › My Team |
| Performance & Learning (Perform) | Performance Center | `/hrms/performance` | R_ADMIN_MGR + R_ESS + R_HR (every role) | `08-performance-learning-compliance-exit.md` |
| | Learning & Skills | `/hrms/learning` | R_HR or `hrms.learning.skill.read` | `08-…` › Learning Center |
| Compliance (Comply) | Statutory Compliance | `/hrms/compliance` | R_ADMIN or `hrms.compliance.inspector.read` | `08-…` |
| | Muster Roll | `/hrms/muster-roll` | R_HR | `04-attendance-and-time.md` |
| Reports & Analytics (Reports) | Reports Center | `/hrms/reports` | R_ADMIN_MGR + R_FIN_META (DEPT_MANAGER/MANAGER/ADMIN hit "Access Restricted" — `09` Reports Center › Change) | `09-reports-analytics.md` |
| | Workforce Analytics | `/hrms/workforce-analytics` | R_ADMIN | `09-reports-analytics.md` |
| Employee Exit (Exit) | Resignation & Exit | `/hrms/exit` | R_HR | `08-…` › Resignation & Exit |
| | Full & Final Settlement | `/hrms/fnf` | R_FIN_RUPEE | `08-…` › Full & final settlements |
| HR Setup (HR Setup) | HR Configuration | `/hrms/settings` | R_HR | `03-company-and-master.md` |
| | Notification Templates | `/hrms/notification-templates` | R_HR | `03-company-and-master.md` |
| | Integrations | `/hrms/integrations` | R_HR | `03-company-and-master.md` › Integrations Directory |
| CRM · Accounts · Payroll · Projects · Inventory · Procurement (non-HRMS modules) | Leads/Customers/Deals · Invoices/Payments/Expenses · All Projects/Task Board · … | `/crm/*`, `/accounts/*`, `/payroll` (redirect → `/hrms/payroll-dashboard`), `/projects/*`, `/inventory`, `/procurement` | tenant owns the module | `10-platform-shell-admin-auth.md` › Placeholders |

### Settings scope (`PLATFORM_ITEMS` lines 234–239, `SETTINGS_NAV` lines 244–262; the rail switches when the URL is `/users`, `/roles`, `/audit-logs`, `/settings*`)

| Page label (rail) | Route | Roles | Brief |
|---|---|---|---|
| Profile (Profile) | `/profile` | everyone (drops the rail back to HRMS scope — `10` shell › Change) | `10-…` › My Profile |
| Branding (Brand) | `/settings/branding` | OWNER, SUPER_ADMIN, COMPANY_ADMIN | `10-…` › Workspace Settings |
| Security (Security) | `/settings/security` | everyone | `10-…` › Workspace Settings |
| Notifications (Alerts) | `/settings/notifications` | everyone | `10-…` › Workspace Settings |
| Billing & Plan (Billing) | `/settings/billing` | SUPER_ADMIN, OWNER, COMPANY_ADMIN | `10-…` › Workspace Settings |
| Integrations (Connect) | `/settings/integrations` | everyone | `10-…` › Workspace Settings |
| Users & Access (Users) | `/users` | OWNER, SUPER_ADMIN, COMPANY_ADMIN | `10-…` › Users & Access |
| Roles & Permissions (Roles) | `/roles` | OWNER, SUPER_ADMIN, COMPANY_ADMIN | `10-…` › Roles & Permissions |
| Audit Logs (Audit) | `/audit-logs` | OWNER, SUPER_ADMIN, COMPANY_ADMIN | `10-…` › Audit Logs |
| Danger Zone (Danger) | `/settings/danger` | SUPER_ADMIN, OWNER | `10-…` › Workspace Settings |
| Configuration (`PLATFORM_ITEMS` only) | `/settings` | OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD | `10-…` › Workspace Settings |

### Not in the sidebar (detail pages, `/me/*`, `/inspection`, auth, placeholders)

| Page | Route | Reached from | Brief |
|---|---|---|---|
| Role-aware landing | `/` (and any unknown URL) | redirect → `/modules` or `/no-access` | `01` |
| Company notices · Projects & Productivity · Seats usage · Upcoming milestones · Upcoming probations | sections/tiles of `/dashboard` | admin dashboard | `01` |
| Request a Shift Change | `/me/shift-change` | My Workspace shortcut | `02` |
| Apply for Work From Home | `/me/wfh` | My Workspace shortcut | `02` |
| My Salary | `/me/salary` | **nothing links to it** (DEAD) | `02` |
| Import employees | `/hrms/employees/import` | Workforce Directory | `03` |
| Employee workspace | `/hrms/employees/:id` | any employee row | `03` |
| Work Time Settings | `/hrms/settings/work-time` | **nothing links to it** (DEAD) | `03` |
| Manual Attendance Entry | `/hrms/attendance/manual-entry` | Muster Roll row | `04` |
| Shift change requests (approval block) | — no route — | component unmounted (DEAD) | `04` |
| Payroll Run Detail | `/hrms/payroll/runs/:id` | Processing & Payslips row | `06` |
| Start Onboarding wizard · Onboarding Checklist · Onboarding Templates · Template Detail | `/hrms/onboarding/instances/new` · `…/instances/:instanceId` · `/hrms/onboarding` · `/hrms/onboarding/templates/:id` | Onboarding & Assets | `07` |
| Letter Template Editor · Generated Letter Detail · Distribution Detail | `/hrms/letters/templates/:id` · `/hrms/letters/generated/:id` · `/hrms/letters/distributions/:jobId` | their list pages | `07` |
| Compliance inspection (public) | `/inspection` (signed link, unauthenticated) | inspector link e-mail | `08` |
| Headcount · Attrition · Attendance Summary · Leave Balance · Late Marks · Diversity reports | `/hrms/reports/{headcount,attrition,attendance-summary,leave-balance,late-marks,diversity}` | Reports Center cards (shared `ReportShell`) | `09` |
| Platform shell (rail · header · ⌘K · bell · profile menu) | wraps every authenticated route | — | `10` |
| App Launcher · Manage your plan | `/modules` · `/plan` | post-login · launcher | `10` |
| Login · Accept Invite · Forgot Password · Reset Password · Workspace Pending Approval · No Access | `/login` · `/accept-invite?token=` · `/forgot-password` · `/reset-password?token=` · `/pending-approval` · `/no-access` | unauthenticated / guards | `10` |
| Placeholders (ComingSoon · ModuleComingSoon · ModuleNotActivated) · Module Workspace showcase | non-HRMS module routes, `/hrms/soon/:key` · `/module-workspace` (redirect) | sidebar module items · nothing | `10` |

---

## 4. Roles legend

`ROLE_PRIORITY` (`PlatformShell.tsx:39`, highest first) picks the badge shown in the header; `ROLE_LABELS` (lines 41–46) gives the display name. Meanings come from the shell comments, `useRoles.ts` buckets (brief `01` intro) and the seed migrations quoted in brief `05` intro.

| Role | Label | One-line meaning |
|---|---|---|
| SUPER_ADMIN | Super Admin | Seeded role …0001 with every permission (V017 fan-out); admin bucket. |
| OWNER | Company Owner | Workspace creator; every non-platform permission (V064); prepended to every admin bundle so a brand-new tenant never gets an empty sidebar. |
| COMPANY_ADMIN | Company Admin | **Not a seeded role** — a frontend admin bucket / optional tenant-created role code (V109); treated as admin-equivalent everywhere. |
| ADMIN | Company Admin | Seeded role …0011 (V035); `isVisible()` treats it as COMPANY_ADMIN; in the admin bucket for `/dashboard` and rupee screens, but missing from several sidebar lists (Dashboard link, Reports grants). |
| HR_MANAGER | HR Manager | Seeded …0002; runs people, attendance, hiring, letters, compliance; **excluded from rupee payroll screens** (client rule in the shell comment). |
| FINANCE_LEAD | Finance Lead | Seeded …0003; rupee payroll, disbursement, F&F; V029/V085 mislabel it "COMPANY_ADMIN" (fixed by V066). |
| DEPT_MANAGER | Dept Manager | Seeded …0005; My Team, team attendance, L1 approvals; V117 revoked its `hrms.report.*` grants. |
| MANAGER | Manager | Alias — `isVisible()` treats it as DEPT_MANAGER. |
| EMPLOYEE | Employee | Seeded …0004; self-service only (`/me`, own attendance/leave/payslips/expenses/advances). |

`R_*` bundles (`PlatformShell.tsx:69–81`):

| Constant | Expands to | Used for |
|---|---|---|
| `R_HR` | OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER | master data, hiring, letters, shifts, HR setup, exit |
| `R_ADMIN` | R_HR + FINANCE_LEAD | Statutory Compliance, Workforce Analytics |
| `R_ADMIN_MGR` | R_ADMIN + DEPT_MANAGER | Attendance Analytics, Daily Tracking, Leave Ops, Advances, Expenses, Reports Center |
| `R_FIN_RUPEE` | OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD | rupee screens: Payroll Dashboard, Salary Structure, Payroll Settings, Bank Disbursement, F&F |
| `R_FIN_META` | R_FIN_RUPEE + HR_MANAGER | workflow payroll surfaces: Payroll Configuration, Processing & Payslips, PLI |
| `R_ESS` | EMPLOYEE | Employee Self Service leaves |
| `isAdmin` (`useRoles.ADMIN_ROLES`) | OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, or the `*` permission | which `/dashboard` variant renders; rupee KPIs inside pages; Settings tile |

Sidebar visibility is a role list; the **route** is guarded separately by permission codes (`RouteGuard anyOf […]` in `App.tsx`) and `ModuleGate` (`hrms` / `payroll`) — a user with the permission but not the role can still deep-link (every brief's Roles line states both).

---

## 5. Status summary

Counted from the `**Status:**` line of every briefed screen (85 = 83 `##` pages/tiles + 2 `###` dashboard sections in `01`).

| Status | Count | Screens |
|---|---|---|
| **LIVE** | 71 | everything not listed below |
| **PARTIAL** | 8 | Staff Dashboard `/dashboard` (`01`) · Attendance Analytics `/hrms/att-analytics` (`04`) · Daily Tracking `/hrms/attendance` (`04`) · Leave Management `/hrms/leave` (`05`) · Payroll Dashboard `/hrms/payroll-dashboard` (`06`) · Salary Structure `/hrms/salary-structure` (`06`) · Workspace Settings `/settings/*` (`10`) · My Profile `/profile` (`10`) |
| **STUB** | 1 | Placeholders ComingSoon · ModuleComingSoon · ModuleNotActivated (`10`) — by design |
| **DEAD** | 5 | Seats usage tile (`01`) · My Salary `/me/salary` (`02`) · Work Time Settings `/hrms/settings/work-time` (`03`) · Shift change requests approval block — no route (`04`) · Module Workspace showcase `/module-workspace` (`10`) |

**Design-first candidates** (STUB + DEAD, plus the static pieces inside PARTIAL pages):

| Screen | Why design-first | Brief |
|---|---|---|
| Seats usage tile | complete + wired (`GET /v1/workspace/seats/usage`), imported in `HrmsDashboard.tsx:32`, never rendered; belongs on the Company Admin Dashboard Live Overview [BLUEPRINT §8.3 "Seats used → /settings/billing"] | `01` |
| My Salary `/me/salary` | fully wired (`GET /v1/payroll/structures/me`), only a typed URL reaches it — needs a link from `/me` and `/me/payslips` [BLUEPRINT §21; PLAN §17] | `02` |
| Work Time Settings `/hrms/settings/work-time` | wired (`GET/PUT /v1/settings/hr-configuration`), no entry point — needs a link from HR Configuration or an HR Setup leaf [BLUEPRINT §7 IA › Settings] | `03` |
| Shift change requests approval block | finished component (`GET /v1/shifts/change-requests/pending`, `POST …/{id}/decision`) mounted nowhere while employees file requests at `/me/shift-change` — needs a tab on Shifts & Overtime or the manager approvals queue [BLUEPRINT §22] | `04` |
| Placeholders | keep as `EmptyState`-based placeholders; prune `SOON` keys that already have live screens; fix USD prices | `10` |
| Module Workspace showcase | **do not design** — delete the file and route [BLUEPRINT §27 P0-10] | `10` |
| Static stubs inside PARTIAL pages | Staff Dashboard "Upcoming Key Dates" / "Employee Type" / N/A tiles · Attendance Analytics "May 2026" calendar · Daily Tracking "Face Punch Logs" 2-row table · Leave "Who's Away" calendar with fake names · Payroll "Run Payroll Cycle" and "Bulk Revise CTC" dead buttons · `/profile` "(Static)" Employment/Bank cards · Settings "Launching soon" rows | `01`, `04`, `05`, `06`, `10` |

---

## 6. Cross-module gap summary — the plan

The 20 highest-value "add" / "change" items across all briefs. Each carries its source and the pages it touches; the page brief has the detail.

### Dashboard & navigation

| # | Item | Source | Pages |
|---|---|---|---|
| 1 | **Add** the missing drill-downs and tiles on the admin dashboard: Pending WFH (`/v1/wfh` → `/hrms/wfh?tab=approvals`), payroll exceptions (`runs/{id}/skipped` → `/hrms/payroll/runs/{id}?tab=skipped`), Seats used (unmounted `SeatsUsageTile` → `/settings/billing`), Open positions / candidates (`useRequisitions` fetched and dropped); make every KPI an `HrStatCard onClick`. | BLUEPRINT §8.3 (17 of 20 drill-downs need no backend); PLAN §6; `01` Company Admin Dashboard › Add; `01` Seats tile | `/dashboard` (admin), `/hrms/payroll/runs/:id`, `/settings/billing` |
| 2 | **Change** the Staff Dashboard into real role compositions: wire "Mark Attendance", mount `UpcomingMilestones`/`UpcomingProbations` in place of the static "Upcoming Key Dates", remove "Employee Type" and the "(N/A)" tiles, replace hard-coded "Ionora", fix the `max(totalEmployees,1)` percentages; show the HR_MANAGER, DEPT_MANAGER and EMPLOYEE variants with loading/empty/error states. | BLUEPRINT §8.2, §8.4; STATUS "Important limits still open"; HANDOFF §10.G; `01` Staff Dashboard › Add/Change | `/dashboard` (staff) |
| 3 | **Add** role-shaped landing: HR/Admin → org dashboard, Finance → payroll dashboard, Manager → `/team`, Employee → `/me`; today everyone lands on `/modules`, Accept-Invite always lands on `/me`, and Login ignores `returnUrl`. | BLUEPRINT §8.4; `01` Role-aware landing; `10` Accept Invite › Change; `10` Login › Change | `/`, `/modules`, `/login`, `/accept-invite` |
| 4 | **Change** the shell: full rail labels instead of "Perform / Comply / Hire", hide the header Settings icon behind `isAdmin`, breadcrumbs on every page ≥2 deep, drop DEPT_MANAGER/MANAGER/ADMIN from the Reports Center leaf (V117 revoked their grants) or gate it with `visibleWithAnyPermission`, keep `/profile` inside the Settings scope. | BLUEPRINT §7.1 rules 2 & 5, §9.3, §24.2, §27 P0-6; `10` Platform shell › Change; `09` Reports Center › Change | shell, `/hrms/reports`, `/profile` |

### Attendance & leave

| # | Item | Source | Pages |
|---|---|---|---|
| 5 | **Add** the "who was late and how late" columns to Daily Tracking — Shift · Expected check-in · Actual · Late-by · Department — plus `?method=` (punch source) filter and a real **Face Punch Logs** tab (`FaceController`, 8 endpoints) replacing the static 2-row table; drawer actions [Regularize] [View profile] [View history]. | BLUEPRINT §11, §6 rows 12–13, §27 P0 #2; PLAN §8; HANDOFF §10.B "late-person details"; `04` Daily Tracking › Add; `09` Late Marks › Add | `/hrms/attendance`, `/hrms/reports/late-marks` |
| 6 | **Change** the three hard-coded "May 2026" calendars into data views or remove the tabs: Attendance Analytics calendar (drive from `useAttendanceTrend` / `useAttendanceSources`, both unused there), Leave "Who's Away" (fake names "A. Stone / P. Mehta"), plus a date/period control on Analytics. | BLUEPRINT §6 row 10, §11, §12; PLAN §8, §9; `04` Attendance Analytics › Add/Change; `05` Leave › Change | `/hrms/att-analytics`, `/hrms/leave` |
| 7 | **Change** Shifts & Overtime into three tabs (Shift schedules · Roster as a Mon–Sun grid · Overtime), mount the finished `ShiftRequestApprovals` block, design the overtime "Recorded, not paid" state (no compensation rule yet), and make this the **single** shift editor — OrgSetup › Shifts and Policies › Shift Rules duplicate it with different layouts. | HANDOFF §10.E, §12; STATUS limits; PLAN §8; `04` Shifts › Add/Change; `04` Shift change requests; `03` Organisation Setup › Change; `03` Rules & Policies › Change | `/hrms/shifts`, `/hrms/organization`, `/hrms/policies`, `/me/shift-change` |
| 8 | **Add** to the Leave Operations Center: KPI header row (Pending · Approved · Rejected · Upcoming) with [Apply Leave] [Export] actions, approver + decision comment on History, comp-off data on "Balances & Comp-offs", a `?tab=approved&date=today` target for the dashboard tile; **change** the three hand-built card lists to `TableCard` + `DataTable`, confirm on Cancel, `HrDrawer` for Type/Holiday forms, and surface the WFH 403 instead of silently dropping rows. | BLUEPRINT §12, §8.3; PLAN §9; `05` Leave › Add/Change | `/hrms/leave` |

### Payroll & money

| # | Item | Source | Pages |
|---|---|---|---|
| 9 | **Add** payroll progressive disclosure: banner "May 2026 · ₹1.24 Cr · 248 employees · ⚠ 2 exceptions [Review Exceptions] [Process Payroll]" on the dashboard and runs list, exception rows with a per-employee [Fix] action and a "Prepare bank disbursement" next step on LOCKED runs, `?tab=skipped` deep link, TDS tile caveat (never computed). **Change**: wire or drop the dead "Run Payroll Cycle" / "Bulk Revise CTC" buttons, make Recent Runs rows navigate, migrate Run Detail from ui-kit to Hr primitives, and unify LOCKED/PAID/CANCELLED tones across dashboard, runs list and Bank Disbursement. | BLUEPRINT §15, §6 rows 25 & 28, §8.3, §28; PLAN §12, AT-4; `06` Payroll Dashboard, Processing & Payslips, Run Detail, Salary Structure, Bank Disbursement › Add/Change | `/hrms/payroll-dashboard`, `/hrms/payroll/runs`, `/hrms/payroll/runs/:id`, `/hrms/salary-structure`, `/hrms/bank-disbursement` |
| 10 | **Add** receipt upload on expense claims (`receiptUrl` is NULL on every claim; policies carry `requiresReceipt` with nothing enforcing it), the unrendered "Reimbursed this month" stat, an EMI column and admin KPI strip on Advances; **change** `window.prompt`/`window.confirm` to `Modal` + `useConfirmDialog()`, raw enum pills ("APPROVED_FOR_PAY", "REQUESTED") to HR wording, "Pending on this page" labels to server totals, and align "Salary Advances / Advance Management / Advances & Loans" naming. | BLUEPRINT §16, §25.3 P0 upload; PLAN §13; `05` Expense Center › Add/Change; `05` Salary Advances › Add/Change | `/hrms/expenses`, `/hrms/advances` |

### Recruitment & documents

| # | Item | Source | Pages |
|---|---|---|---|
| 11 | **Add** candidate → employee conversion (`POST /v1/hiring/candidates/{id}/convert`) that pre-fills the Start Onboarding wizard from a HIRED candidate ("If only one is built, build conversion"), interview scheduling/feedback, `?status=OPEN` / `?tab=candidates` URL params for dashboard drill-downs, and offers linked to pipeline candidates; **change** inline offer forms to `HrDrawer`, confirm on Close/Advance stage, ISO joining dates to `18 Sep 2026`. | BLUEPRINT §13, §7, §8.3; PLAN §10; HANDOFF §10.C (offer delivery unverified beyond local SMTP); `07` Hiring Center › Add/Change; `07` Start Onboarding › Add | `/hrms/hiring`, `/hrms/onboarding/instances/new` |
| 12 | **Add** real document handling: drag-drop upload with progress, permission-scoped download and audit trail on the Employee Vault and from the employee workspace Documents tab; separate uploaded Documents from generated Letters (the vault's "Letters & Contracts" tab shows *templates*); wire an Experience Letters leaf (`/hrms/letters/generated?type=EXPERIENCE`) into Exit / F&F. Remote R2 storage is unverified locally — do not imply it. | BLUEPRINT §14 (P0), §7, §20, §27 P0, §6 row 50; PLAN §11, §16; HANDOFF §5, §10.D; `07` Employee Vault › Add; `03` Employee workspace › Add; `07` Generated Letters › Add; `08` F&F › Add | `/hrms/documents`, `/hrms/employees/:id`, `/hrms/letters/generated`, `/hrms/fnf` |
| 13 | **Change** onboarding & letters to the list-screen anatomy: progress (x of y tasks) column and employee search on instances, "Start Onboarding" in `HrPageHeader actions`, asset register/assign/return and the distribution wizard in `HrDrawer`, raw ISO dates and enum pills ("ASSIGNED", "FULL TIME") to DS formatting, `HrPagination` where only page 0 is fetched, `window.confirm` → `ConfirmDialog`; **add** task reminders / reassignment and template reorder (backend pending). | PLAN §11; HANDOFF §12 (pre-V136 asset history partial); `07` Onboarding & Assets, Checklist, Templates, Template Detail, Letter Templates/Editor, Distributions › Add/Change | `/hrms/onboarding/*`, `/hrms/letters/*` |

### Self-service

| # | Item | Source | Pages |
|---|---|---|---|
| 14 | **Change** My Workspace into the coherent ESS home: Today (punch status, today's shift, [Mark Attendance]) · My Attendance (calendar, late marks, [Regularize]) · My Leave (balances, [Apply], history) · My Payslips · My Documents (+Upload) · My Profile (editable) · My Performance; fix "Apply leave →" to `?tab=apply`, stop the onboarding "Open →" 403 for employees, use `HrPageHeader` + `TableCard`/`DataTable`, show `EmptyState` instead of vanishing cards. | BLUEPRINT §21, §6 row 56; PLAN §17, §7.2; `02` My Workspace › Add/Change | `/me`, `/hrms/attendance?tab=my`, `/hrms/leave` |
| 15 | **Add** the unified manager approvals inbox on My Team — leave · regularization · WFH · expenses · shift-change requests in ONE queue with per-row Approve/Reject (`POST /v1/leave/{id}/decision` exists) — plus KPI drill-downs, employee name/code on approvals, an "All caught up" state, and `?tab=approvals` / `?tab=team` deep links ("the single highest-value manager feature"). | BLUEPRINT §22, §6 rows 57–58, §8.3; PLAN §17; `02` My Team › Add/Change; `02` Apply for WFH › Add; `04` Shift change requests › Add | `/team`, `/hrms/leave`, `/hrms/attendance` |
| 16 | **Add** navigation to My Salary from `/me` and `/me/payslips` (the page is DEAD but wired), structure revision history (`isCurrent`, `revisionNote` unused), employer contributions, year filter/pagination on payslips, error `EmptyState` + Retry on both; withdraw on shift-change requests and confirm on WFH Cancel. | BLUEPRINT §21; PLAN §7.2, §17; `02` My Salary, My Payslips, Request a Shift Change, Apply for WFH › Add/Change | `/me/salary`, `/me/payslips`, `/me/shift-change`, `/me/wfh` |

### Admin & compliance

| # | Item | Source | Pages |
|---|---|---|---|
| 17 | **Add** to the Workforce Directory: **Export CSV** (P0 — "the screen HR lives in"), employment-type filter, rows-per-page, bulk selection + actions (Invite · Change dept · Change manager · Assign shift · Deactivate), Contractors and Classifications tabs (`/v1/hrms/contractors`, `/v1/hrms/classifications` have no UI); **change** KPI cards into status filters, hand-rolled pager → `HrPagination`, raw selects → `FilterBar`, "Reporting Manager ID" UUID input → employee picker on the workspace. | BLUEPRINT §6 rows 3–5, §19, §27 P0 #5; PLAN §7.1, §23.A #7; `03` Workforce Directory › Add/Change; `03` Employee workspace › Change; `09` Reports Center › Add | `/hrms/employees`, `/hrms/employees/:id`, `/hrms/reports` |
| 18 | **Add** Compliance structure: POSH as its own confidential leaf (`/hrms/compliance/posh`), Compliance Calendar route, server-side Pending/Overdue/Completed aggregates, error states; **change** `window.prompt` for Mark filed / Close complaint to `Modal`s, always-open add forms to header actions + `HrDrawer`, `toLocaleString()` dates to `18 Sep 2026, 5:30 pm`, brand the public `/inspection` page. Inspector **OTP** and **scoped muster export** are open items — show as "coming later", never live. | BLUEPRINT §6 rows 42/44, §7; PLAN §15; HANDOFF §10.D, §12; STATUS limits; `08` Statutory Compliance › Add/Change; `08` Compliance inspection; `04` Muster Roll › Add | `/hrms/compliance`, `/inspection`, `/hrms/muster-roll` |
| 19 | **Change** Exit & F&F: F&F tabs Pending Calculation / Pending Payment / Settled (PROCESSED / APPROVED / PAID), per-leaver F&F status on the Exit list, one **Separation** drawer instead of three editors, `HrButton` lifecycle actions on the employee header, consistent days-left and withdraw-notice copy; resignation request/approval and clearance checklist do not exist — mark "coming later". | BLUEPRINT §20, §6 rows 48–49; PLAN §16, AT-5; HANDOFF §5; `08` Full & final settlements › Add/Change; `08` Resignation & Exit › Add/Change | `/hrms/fnf`, `/hrms/exit`, `/hrms/employees/:id?tab=exit` |
| 20 | **Change** the admin/settings surfaces and remove fabricated data: `/profile` "(Static)" Employment/Bank cards with someone else's data, ModuleNotActivated USD prices vs ₹/user plans, `/module-workspace` (delete); link Work Time Settings and Holiday Calendar from HR Configuration and align its three names; name apart the two Integrations and two Notifications screens; land `/settings` on Branding/Billing and show seats purchased vs used there; Users & Access needs pagination, status filter and a deactivate action; rebuild `/plan` and Roles on `HrPageHeader` / `HrStatCard` / `Modal`. | BLUEPRINT §7 IA › Settings, §8.3, §27 P0-10; HANDOFF §10.G; `10` My Profile, Placeholders, Module Workspace, Workspace Settings, Users & Access, Roles & Permissions, Manage your plan › Add/Change; `03` HR Configuration, Work Time Settings › Add/Change | `/profile`, `/settings/*`, `/plan`, `/users`, `/roles`, `/hrms/settings`, `/hrms/settings/work-time`, placeholders |

**Not to be designed as live** (open business inputs, per STATUS "Important limits still open" / HANDOFF §12): overtime → payroll posting (no compensation rule), external provider sync in Integrations (registry only), inspector OTP and automatic scoped muster export, real mail/SMS/bank delivery receipts, remote R2 storage, resignation approval workflow, clearance checklist, TDS computation, interviews entity.

---

## 7. Design rules to repeat in every prompt

From `.design-sync/conventions.md` (the design system's own README).

| Rule | Detail |
|---|---|
| **Reach for the HRMS primitives first** | `HrPageHeader`, `HrStatCard`, `HrStatusPill`, `HrButton`, `HrAvatar`, `HrTabs`/`HrTabPanel`, `HrSelect`, `HrDrawer`, `TableCard`, `FilterBar`, `DataTable`, `HrPagination`, `EmptyState`, `StatCard`, `SkeletonCard`… The generic kit (`Button`, `Badge`, `Card*`, `Field`/`Input`/`Label`, `Modal`, `Drawer`, `Tabs*`, `PageHeader`, `Avatar`, `Separator`, `Skeleton*`) is for inside forms and dialogs. `DataTable`, `EmptyState`, `StatCard` mean the HRMS versions. |
| **List-screen anatomy** | 1 `HrPageHeader` (`title`, `subtitle`, `crumb` "HRMS / Payroll", `actions` = `HrButton`s, `tabs` = `HrTabs` with `badge` counts, `filters` slot) → 2 KPI strip `grid grid-cols-2 gap-3 sm:grid-cols-4` of `HrStatCard` (`icon` lucide **element** `<Wallet size={18} />`, `color` blue/green/orange/red/purple/teal, `trend`, `loading`, `onClick` = drill-down) → 3 `TableCard` (toolbar `search`, `filters` as `FilterDef[]`, `actions`; body; `footer` `HrPagination`/`hrPaginationFooter`) wrapping `DataTable` (`columns` with `render`, `keyField`; first column `HrAvatar name sub`; status column `HrStatusPill`; row action `HrButton size="sm" variant="ghost"`; ≤5–6 columns) → 4 `EmptyState` (`icon` lucide **component** `icon={Users}`) when empty; `SkeletonCardGrid` / `TableSkeleton` while loading. |
| **Detail & edit** | `HrDrawer` (right panel, `title`, `footer` actions, `width` e.g. `max-w-lg`) for a record; `Modal` (`size` sm/md/lg/xl) for confirmations and short forms; destructive confirms through `ConfirmDialogProvider` + `useConfirmDialog()` — never `window.confirm` / `window.prompt`. |
| **Status = tone, never a colour** | `HrStatusPill tone`: `ok`/`green` approved, present · `warn` pending · `late`/`orange` late, half day · `info`/`blue` in review, scheduled · `teal` work from home · `purple` on leave · `pink` probation · `red` rejected, absent · `gray` draft, closed, weekly off. Generic `Badge` has its own tone set for non-HR labels. Wording: Approved / Pending approval / On leave / Half day / Work from home — never raw enums. |
| **Buttons** | `HrButton` — `variant` primary (emerald) / ghost / danger, `size` sm / md — on HRMS screens. `Button` — primary / secondary / outline / ghost / danger / danger-ghost / link, sizes xs…lg + icon, `loading`, `leftIcon`/`rightIcon` — inside forms and dialogs. |
| **₹ / dates / codes** | `'₹' + n.toLocaleString('en-IN')` → ₹1,20,000 (no decimals); dates `18 Sep 2026` (add time as `18 Sep 2026, 5:30 pm`); employee codes `EMP-0142`; `tabular-nums` on numeric cells. |
| **Look & tokens** | White `.ut-card`s (ring-1 ring-gray-200, rounded-2xl, soft shadow) on a light canvas; emerald `--accent-fg` #0f6e56 with mint #10b981; text `--text-primary/secondary/tertiary`; borders `--border-default/subtle`; surfaces `--bg-surface/subtle`; dark theme `data-theme="dark"`. Fonts: Plus Jakarta Sans (display, `font-display`), Inter (body), JetBrains Mono (code). Charts: emerald family only (client rule quoted in `HrmsDashboard.tsx:62-65`). |
| **Don't** | Don't rebuild tables, cards or pills from raw `div`s. Don't hand-pick status colours. Don't put an `HrStatCard` strip in a narrow column. Don't use Tailwind classes the app never uses (the stylesheet is purged — e.g. no bare `grid-cols-4`, use `sm:grid-cols-4`; NOTES "Preview authoring"). |
| **States on every screen** | loading (skeleton) · empty (`EmptyState` + one CTA) · error (`EmptyState` + Retry) · no-permission (section absent — "an unauthorised leaf is absent, never a 403 on click", BLUEPRINT §7.1 rule 5, §24.5). |

---

## 8. Known product bugs the previews surfaced

From `.design-sync/NOTES.md` "App findings surfaced by the previews" — real in the app, not fixed by the sync; design around them and flag them to implementation.

| Bug | Where it shows | Cause | Fix direction |
|---|---|---|---|
| **`.ut-select` width cascade** — every select inside a `TableCard` toolbar takes its 200px max-width and a second one wraps to its own line. | Every app screen with 2+ select filters (and the `TableCard › SearchFiltersActions` DS card). | `apps/platform/src/globals.css` declares `.ut-select { width: 100% }` outside any `@layer`, so it lands after Tailwind's utilities and beats `w-auto`. | Move `.ut-input` / `.ut-select` into `@layer components`. Until then, design filter rows with `FilterBar` and expect the wrap. |
| **Dark-styled ui-kit `Tabs`** — reads as a dark-mode widget on a white card; active chip is low-contrast and **indigo**, not emerald. | Any screen still using `@unifiedtree/ui-kit` `Tabs` (e.g. Payroll Run Detail, Roles). | ui-kit `Tabs` is styled for a dark surface (slate-700/800, indigo active). | Use `HrTabs` / `HrTabPanel` on HRMS screens (conventions header already steers there); restyle ui-kit `Tabs` for light surfaces if it must stay. |

Related preview facts worth knowing while designing: `Toaster` is sonner's and renders nothing without a toast; `HrDrawer` / `Modal` / `Drawer` render through portals (overlay captures need `cardMode: single`); `DataTable loading` skeleton rows are invisible on a white card in the app too; `HrSelect`'s open listbox and `HrTabs` overflow scroll are click-only states not captured (NOTES "States skipped by design").
