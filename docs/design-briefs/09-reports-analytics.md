# Reports & Analytics — page briefs

This group is the HRMS "Insights" shelf: a Reports Center hub, six company-scoped tabular reports (each with a chart on top and a CSV export), and a Workforce Analytics dashboard that composes three of those report endpoints into KPIs and charts.
Sidebar group: **Reports & Analytics** (`PlatformShell.tsx` key `reports`) with two leaves — *Reports Center* (`/hrms/reports`) and *Workforce Analytics* (`/hrms/workforce-analytics`). The six report pages have no sidebar entry of their own; they are reached from the Reports Center cards.
Roles: sidebar shows Reports Center to `[...R_ADMIN_MGR, ...R_FIN_META]` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, ADMIN; Workforce Analytics to `R_ADMIN` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD. Every route is then permission-gated on the five `hrms.report.*` codes (`packages/sdk/src/permissions/codes.ts:119-123`). Seeded grants (`db/canonical/V026__report_permissions.sql`): SUPER_ADMIN, HR_MANAGER and FINANCE_LEAD get all five (FINANCE_LEAD kept by V066); OWNER holds them through the non-platform catalog backfill (V035 / V064). DEPT_MANAGER got headcount/attendance/leave in V026 (never attrition/diversity) and V117 **revoked** those three from DEPT_MANAGER and MANAGER, so they see the sidebar leaf but land on "Access Restricted" unless an admin re-grants from Settings → Roles & Permissions. No canonical migration grants `hrms.report.*` to ADMIN (…0011) or a COMPANY_ADMIN role (only V026 / V066 / V117 touch these codes), so those two sidebar roles also depend on an admin grant.

Audit verdict for the whole group: [BLUEPRINT §6 #46] "Reports — `/hrms/reports` + 6 CSV — **Strong** — 6 reports + exports — **A** — Keep"; [BLUEPRINT §6 #47] "Workforce Analytics — Works — **A** — Keep"; [PLAN §15] "Reports (6) + CSV ✅ ✅ Keep · Workforce Analytics ✅ ✅ Keep"; [FUNCTIONALITY_AUDIT › Live module inventory] "/hrms/reports/*, workforce/attendance analytics — Existing report/export controllers — Domain report permissions, tenant scope — Live route/API reads; **not every report boundary tested**"; [HANDOFF §5 line 255] "FNF, imports/exits, **reports**, helpdesk/issues and all other routes still need systematic current acceptance beyond smoke testing"; [STATUS › Important limits still open] "Large-list scalability, every custom role combination, and all mobile layouts need broader acceptance" — relevant because none of the six report tables paginates.

### Shared frame used by all six reports — `ReportShell` (not a route)
File `modules/hrms/reports/ReportShell.tsx`. Every report page renders inside it, so the design agent should treat this as the report page template:
1. Back arrow (icon-only `Link` to `/hrms/reports`) sitting left of an `HrPageHeader` (`crumb` "Reports & Analytics", `title`, `subtitle`, `actions` = one `HrButton variant="ghost"` **Export CSV** with a `Download` icon; label flips to **Preparing…** and the button is `disabled` while the download runs).
2. Filter row (`flex flex-wrap gap-3`) — a `CompanySelector` (raw `<select>`, placeholder **Select company…**, options from `useCompanies → GET /v1/hrms/companies`) plus the report's own raw `<input type="date">` / `<select>` controls. Filters are written to the URL (`?company=&asOf=` / `?from=&to=` / `?year=`), so links are shareable.
3. Body, in this priority (the `EmptyState` here is the `@unifiedtree/ui-kit` one — variants `first-run | filtered | error | forbidden` — not the HRMS `shared/components/EmptyState`): no company → `EmptyState variant="first-run"` **"Select a company"** / "Choose a company from the filter above to load this report."; error → `EmptyState variant="error"` **"Failed to load report"** + `error.message` + primary action **Retry** (`refetch`); loading → two pulsing `.ut-card` placeholders (h-64 chart, h-48 table); no rows → `EmptyState variant="filtered"` **"No data for this period"** / "Try adjusting your filters or selecting a different date range."; otherwise a chart card (`.ut-card.ut-card-lg`) above a `TableCard` wrapping a raw `<table class="hr-table">`.
- Export rules (from code comments): the Export button is shown only when `usePermission(spec.permission)` for that single report passes **and** a company is selected; it calls `apiBlob('/v1/reports/<name>/export.csv?companyId&…exportParams')` with the same filters the table used, saves `<name>-YYYY-MM-DD.csv`, and on any non-2xx shows `toast(error.message, 'error')`. `late-marks` shares `hrms.report.attendance` with attendance-summary (no `report.latemarks` code exists).
- `CompanySelector` special state: if `/v1/hrms/companies` returns 403 the select is disabled with option **"Cannot browse companies"** and a red helper line "Your role can generate reports but cannot browse the company list. Ask an administrator to grant the org.company.read permission."

---

## Reports Center  `/hrms/reports`
- **File:** modules/hrms/reports/ReportsIndex.tsx  ·  **Sidebar:** Reports & Analytics › Reports Center (also: Dashboard quick action **View Reports** in `CompanyAdminDashboard.tsx:122` / `HrmsDashboard.tsx:365`, and global search action "Reports" under *Insights* in `shared/search/actionRegistry.ts:207`)  ·  **Roles:** sidebar OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, ADMIN; `RouteGuard anyOf` [`hrms.report.headcount`, `hrms.report.attrition`, `hrms.report.attendance`, `hrms.report.leave`, `hrms.report.diversity`] (`App.tsx:598-601`)
- **Status:** LIVE — navigation hub; six `<Can code=…>`-gated `Link` cards, no data fetch needed. Grid column count follows how many cards the user is permitted to see (3 / 2 / 1 columns).

### Purpose
HR Manager, Finance Lead or admin lands here to pick one of the six reports. It is a launcher, not a data screen: the user reads the one-line description and clicks through.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Reports & Analytics", title **Reports**, subtitle "Analytical views of your workforce data". No actions, tabs or filters.
2. Card grid (`grid gap-4`, `lg:grid-cols-3` when ≥3 cards visible, `sm:grid-cols-2` when 2, single column when 1) of `.ut-card.ut-card-hover` link cards, each: 36px rounded icon tile (lucide icon, per-card accent colour), title (hover turns emerald `#047857`), 2-line description. Cards, in order:
   | Card | Icon / colour | Description text | Goes to | Needs |
   |---|---|---|---|---|
   | Headcount | `Users`, `#059669` | Active, probation, and notice-period headcount by department as of any date. | `/hrms/reports/headcount` | `hrms.report.headcount` |
   | Attrition | `TrendingDown`, rose-500 | Monthly exits, resignations, terminations, and attrition percentage. | `/hrms/reports/attrition` | `hrms.report.attrition` |
   | Attendance Summary | `Clock`, amber-500 | Per-employee present days, late days, average hours, and overtime for a period. | `/hrms/reports/attendance-summary` | `hrms.report.attendance` |
   | Leave Balance | `Calendar`, emerald-600 | Leave entitlement, used, pending, carry-forward, and available per employee. | `/hrms/reports/leave-balance` | `hrms.report.leave` |
   | Late Marks | `AlarmClock`, orange-500 | All late-arrival records with minutes late and check-in time for a date range. | `/hrms/reports/late-marks` | `hrms.report.attendance` |
   | Diversity | `PieChart`, violet-500 | Headcount breakdown by gender and department for the active workforce. | `/hrms/reports/diversity` | `hrms.report.diversity` |

### Data shown
- None fetched. Card list is the module constant `REPORT_CARDS`; visibility per card via `usePermission(permCode)` from `@unifiedtree/sdk`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Headcount (card) | grid | `Link` → `/hrms/reports/headcount` | holders of `hrms.report.headcount` | LIVE |
| Attrition (card) | grid | `Link` → `/hrms/reports/attrition` | `hrms.report.attrition` | LIVE |
| Attendance Summary (card) | grid | `Link` → `/hrms/reports/attendance-summary` | `hrms.report.attendance` | LIVE |
| Leave Balance (card) | grid | `Link` → `/hrms/reports/leave-balance` | `hrms.report.leave` | LIVE |
| Late Marks (card) | grid | `Link` → `/hrms/reports/late-marks` | `hrms.report.attendance` | LIVE |
| Diversity (card) | grid | `Link` → `/hrms/reports/diversity` | `hrms.report.diversity` | LIVE |

### States
- loading: none (no fetch).
- empty: not reachable — the `RouteGuard` already requires at least one report permission, so at least one card renders.
- error: none.
- no-permission: `RouteGuard` renders `NoAccess` — 🔒 **"Access Restricted"** / "You do not have the required permissions to view this page. Contact your administrator if you believe this is a mistake." (`routes/RouteGuard.tsx:44-55`).

### Rules & permissions
- One permission code per card; a role holding only `hrms.report.leave` sees exactly one card in a single-column grid.
- No company scoping on this page; each report asks for a company on its own filter bar.

### Gaps & plan  (keep / add / change)
- **Keep:** the permission-per-card launcher and the adaptive grid; [BLUEPRINT §6 #46] Class A "Keep".
- **Add:** [BLUEPRINT §19] "Gaps: **no employee directory export** (P0 — the screen HR lives in), no attendance raw export, no payroll register export from the UI. Reuse the existing CSV pattern (RFC-4180 + BOM already solved)." — surface those three as future cards here ([BLUEPRINT §27 P0 #5] "Directory export — CSV, reuse report pattern"; [BLUEPRINT §27 P2] "attendance raw export"). [BLUEPRINT §3.4 line 123] the *reference* product's Reports shelf is "Attendance & Overtime, Payroll Reports, Workforce Analytics — Salary Register / Tax / PF & ESI / Variance"; our target IA [BLUEPRINT §7 lines 318-320] deliberately reduces this to *Reports Center* + *Workforce Analytics*, both of which exist — so payroll-register style reports are a reference gap, not a committed target. [PLAN §23.A #7] "Employee directory export CSV — clone the `ReportController` pattern". [BLUEPRINT §6.1] instead of AI insights, "Deliver **Exceptions**: real, explainable rules over real data ('6 employees have >3 late marks this month')" — a candidate seventh card.
- **Change:** [code: PlatformShell.tsx:179 vs V117] DEPT_MANAGER/MANAGER still get the *Reports Center* sidebar leaf although V117 removed their report permissions, and ADMIN is in the leaf via `R_FIN_META` with no seeded report grant at all → they click and hit "Access Restricted"; either drop them from `visibleForRoles` or add `visibleWithAnyPermission` (the pattern `PlatformShell.tsx:146` already uses for Expense Center). [code] Workforce Analytics and Attendance Analytics (`/hrms/att-analytics`, sits under the Attendance sidebar group) are not linked from this hub, so "Reports & Analytics" is only half discoverable from here. [code] the company chosen on one report is carried in that page's URL only; returning to the hub and opening another report asks for the company again.

### Screenshot
`Attach: /hrms/reports — current screen`

### Claude Design prompt (ready to paste)
```
Design the Reports Center page for HR Manager / Finance Lead / Company Admin at /hrms/reports.
Use HrPageHeader with crumb "Reports & Analytics", title "Reports", subtitle "Analytical views of your workforce data"; no header actions.
Below it a 3-column grid (2 on tablet, 1 on phone) of six .ut-card link cards, each with a 36px icon tile, a title and a 2-line description:
Headcount (Users icon, emerald) · Attrition (TrendingDown, rose) · Attendance Summary (Clock, amber) · Leave Balance (Calendar, emerald) · Late Marks (AlarmClock, orange) · Diversity (PieChart, violet). Use the exact description strings from the brief.
Cards are permission-gated one by one: show a variant with only 2 cards (Leave Balance + Attendance Summary) in a 2-column grid, and one with a single card.
No loading or empty state exists; the no-permission state is the shared "Access Restricted" lock screen.
Keep the launcher pattern. Add three clearly disabled "Planned" cards (muted icon tile, HrStatusPill tone gray "Planned", no hover) for Employee Directory export, Attendance raw export and Payroll Register export (BLUEPRINT §19) — they must not look clickable — and a small link row to Workforce Analytics and Attendance Analytics so the hub covers the whole group.
Change: nothing on the existing cards; use realistic hover state (title turns emerald #047857).
```

---

## Headcount Report  `/hrms/reports/headcount`
- **File:** modules/hrms/reports/HeadcountReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Headcount card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.headcount`] (`App.tsx:677-680`); seeded holders OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER revoked by V117)
- **Status:** LIVE — wired to `useHeadcountReport → GET /v1/reports/headcount?companyId&asOf`; Export CSV wired to `GET /v1/reports/headcount/export.csv?companyId&asOf` (same `@PreAuthorize('hrms.report.headcount')`, `ReportController.java:99-104`).

### Purpose
HR or Finance asks "how many people did we have in each department on date X, and how many of them were on notice or probation?" — a point-in-time headcount used for budgeting and board packs.

### Layout (map to the design-system parts)
1. Back-arrow link + `HrPageHeader` — crumb "Reports & Analytics", title **Headcount Report**, subtitle "Active, probation, and notice-period headcount by department", actions = `HrButton variant="ghost"` **Export CSV** (Download icon).
2. Filter row — `CompanySelector` (**Select company…**) and one `<input type="date">` **As of** (URL `asOf`, default today `2026-09-23`).
3. Chart card `.ut-card.ut-card-lg p-5` — recharts stacked `BarChart` 280px, X = department (`—` when null), series **Active** `#10B981`, **On Notice** `#F59E0B`, **Probation** `#2563EB` (rounded top), dashed grid, legend, white tooltip.
4. `TableCard` (no toolbar) wrapping `hr-table` with 5 columns.

### Data shown
- Chart + table rows from `useHeadcountReport(companyId, asOf)` → `GET /v1/reports/headcount` returning `HeadcountRow[]` `{ department | null, total, active, on_notice, probation }` (`api/useReports.ts:6-12`).
- Table columns: **Department** → `department` (`(No dept)` when null, font-medium) · **Total** → `total` · **Active** → `active` · **On Notice** → `on_notice` · **Probation** → `probation`. No sorting, no pagination (one row per department).
- Company options from `useCompanies → GET /v1/hrms/companies`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | left of header | `Link` → `/hrms/reports` | all | LIVE |
| Export CSV / Preparing… | header actions | `apiBlob GET /v1/reports/headcount/export.csv?companyId&asOf` → downloads `headcount-2026-09-23.csv`; error → red toast | `hrms.report.headcount`; hidden until a company is chosen | LIVE |
| Select company… | filter row | sets `?company=` → refetch | all | LIVE |
| As of (date) | filter row | sets `?asOf=` → refetch | all | LIVE |
| Retry | error EmptyState | `refetch()` | all | LIVE |

### States
- loading: two pulsing `.ut-card` blocks (chart h-64, table h-48).
- empty: **"No data for this period"** — "Try adjusting your filters or selecting a different date range." (`EmptyState variant="filtered"`).
- no company: **"Select a company"** — "Choose a company from the filter above to load this report." (`variant="first-run"`); Export button hidden.
- error: **"Failed to load report"** + server message + **Retry**.
- no-permission: `RouteGuard` "Access Restricted"; company list 403 → disabled select "Cannot browse companies" + red helper text.

### Rules & permissions
- Same code (`hrms.report.headcount`) guards JSON and CSV; the Export button is gated on exactly that code (never an OR across report codes — code comment cites the dashboard headcount-export 403 defect).
- `companyId` is a mandatory `@RequestParam`; report is company-scoped, tenant-scoped by RLS; no department/manager predicate (V117 comment: `ReportService` filters on `company_id` only).
- `asOf` defaults server-side to today when omitted.

### Gaps & plan  (keep / add / change)
- **Keep:** URL-backed filters, gated Export with toast on failure, stacked chart + table pairing. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §24.3] "Required on every major list: search · filters · sort · pagination · rows-per-page · export · column visibility …" — this table has export only; add sort and a total-row. [BLUEPRINT §6 #1 / §8.1] "Every metric drills down" / "every question must have a destination" — a department row here has no destination (e.g. Workforce Directory filtered by department).
- **Change:** [code] raw `<input type="date">` and raw `<select>` instead of the DS `FilterBar` / `HrSelect`; [code] dates are ISO `2026-09-23` in the input and filename, not the DS "18 Sep 2026" format; [code] table has no KPI strip — the totals (Total / Active / On Notice / Probation across all departments) are only readable by summing rows; [code: HeadcountReport.tsx:23 vs :85] a null department is labelled `—` in the chart but `(No dept)` in the table.

### Screenshot
`Attach: /hrms/reports/headcount — current screen`

### Claude Design prompt (ready to paste)
```
Design the Headcount Report page for HR Manager / Finance Lead at /hrms/reports/headcount.
Use HrPageHeader with a back-arrow to Reports Center, crumb "Reports & Analytics", title "Headcount Report", subtitle "Active, probation, and notice-period headcount by department", action HrButton ghost "Export CSV" (Download icon; "Preparing…" while busy).
Filter row via FilterBar: HrSelect "Company" (placeholder "Select company…", e.g. "UnifiedTree Technologies Pvt Ltd") and a date field "As of" showing 18 Sep 2026.
Add a 4-card HrStatCard strip: Total headcount 412 · Active 388 · On notice 9 (orange) · On probation 15 (blue).
Chart card: stacked bar by department (Engineering, Sales, Operations, Finance, HR) with series Active (green), On Notice (amber), Probation (blue), legend on top-right.
TableCard › DataTable with columns Department · Total · Active · On Notice · Probation, tabular-nums, a bold totals footer row, "(No dept)" row last; no pagination (≤15 rows).
States: "Select a company" first-run EmptyState; "No data for this period" filtered EmptyState; "Failed to load report" error EmptyState with Retry; skeleton chart + table while loading.
Keep the chart-over-table layout and URL-driven filters. Change raw inputs to DS FilterBar controls and Indian date format. Add a department row click → Workforce Directory filtered by that department (BLUEPRINT §6 #1 / §8.1 drill-down).
```

---

## Attrition Report  `/hrms/reports/attrition`
- **File:** modules/hrms/reports/AttritionReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Attrition card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.attrition`] (`App.tsx:685-688`); seeded holders OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER never held this code)
- **Status:** LIVE — `useAttritionReport → GET /v1/reports/attrition?companyId&from&to`; Export → `GET /v1/reports/attrition/export.csv?companyId&from&to` (`ReportController.java:109-115`).

### Purpose
HR leadership tracks how many people left each month and why (resignation vs termination) and the resulting attrition rate, over a chosen window (default trailing 12 months).

### Layout (map to the design-system parts)
1. Back-arrow + `HrPageHeader` — title **Attrition Report**, subtitle "Monthly exits, resignations, terminations, and attrition rate", actions **Export CSV**.
2. Filter row — `CompanySelector`, `<input type="date">` **From** (default 1st of the month 11 months ago, URL `from`), `<input type="date">` **To** (default today, URL `to`).
3. Chart card — recharts `ComposedChart` 280px: stacked bars **Resignations** `#F59E0B` + **Terminations** `#EF4444` on the left axis, line **Attrition %** `#059669` (2px, dots r=3) on a right `%` axis; X = month.
4. `TableCard` → `hr-table`, 5 columns.

### Data shown
- `AttritionRow[]` `{ month, exits, resignations, terminations, attrition_pct }` (`useReports.ts:14-20`).
- Columns: **Month** → `month` (raw API string) · **Exits** → `exits` · **Resignations** → `resignations` · **Terminations** → `terminations` · **Attrition %** → `attrition_pct` rendered `12.5%`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | header | → `/hrms/reports` | all | LIVE |
| Export CSV | header actions | `GET /v1/reports/attrition/export.csv?companyId&from&to` → `attrition-2026-09-23.csv` | `hrms.report.attrition`; needs company | LIVE |
| Select company… | filter row | `?company=` | all | LIVE |
| From / To (dates) | filter row | `?from=` / `?to=` → refetch (hook disabled until both set) | all | LIVE |
| Retry | error state | `refetch()` | all | LIVE |

### States
Same five as `ReportShell` (Select a company / skeletons / No data for this period / Failed to load report + Retry / Access Restricted). No validation when `from > to` — the request is sent as-is and the backend answer decides.

### Rules & permissions
- `hrms.report.attrition` on JSON and CSV. Company-wide, tenant-scoped. `from`/`to` are mandatory ISO dates (`@DateTimeFormat ISO.DATE`).

### Gaps & plan  (keep / add / change)
- **Keep:** dual-axis chart (counts + rate) and month table. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §6 #1 / §8.1] drill-down — a month row has no destination (Resignation & Exit list `/hrms/exit` for that month). [BLUEPRINT §24.3] sort / totals row (total exits in window, average attrition %).
- **Change:** [code] "Exits" is in the table but not in the chart (chart stacks Resignations + Terminations only); [code] no `from > to` guard; [code] raw date inputs, no quick ranges ("Last 12 months", "This FY"); [code] the Workforce Analytics KPI "Attrition (latest month)" uses this same endpoint — keep the two screens' numbers visually consistent.

### Screenshot
`Attach: /hrms/reports/attrition — current screen`

### Claude Design prompt (ready to paste)
```
Design the Attrition Report page for HR Manager / Finance Lead at /hrms/reports/attrition.
HrPageHeader with back-arrow, crumb "Reports & Analytics", title "Attrition Report", subtitle "Monthly exits, resignations, terminations, and attrition rate", action HrButton ghost "Export CSV".
FilterBar: HrSelect "Company", date range "From 01 Oct 2025 – To 23 Sep 2026", plus quick-range chips "Last 12 months", "This FY", "Last quarter".
KPI strip (HrStatCard): Total exits 27 · Resignations 21 · Terminations 6 (red) · Attrition, latest month 1.8% (trend down 0.4%).
Chart card: combined chart — stacked bars Resignations (amber) + Terminations (red) on the left axis, line "Attrition %" (emerald) on a right % axis, months Oct 2025 … Sep 2026.
TableCard › DataTable columns Month · Exits · Resignations · Terminations · Attrition %, e.g. "Sep 2026 · 3 · 2 · 1 · 0.7%", tabular-nums.
States: Select a company / No data for this period / Failed to load report with Retry / skeleton.
Keep dual-axis chart and URL filters. Add month-row click → Resignation & Exit list for that month. Change month label to "Sep 2026" format and add a totals footer row.
```

---

## Attendance Summary Report  `/hrms/reports/attendance-summary`
- **File:** modules/hrms/reports/AttendanceSummaryReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Attendance Summary card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.attendance`] (`App.tsx:693-696`); seeded OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER revoked by V117)
- **Status:** LIVE — `useAttendanceSummaryReport → GET /v1/reports/attendance-summary?companyId&from&to`; Export → `…/attendance-summary/export.csv` (`ReportController.java:119-125`).

### Purpose
HR/payroll pulls a per-employee attendance tally for a period (default month-to-date): present days, late days, average hours and overtime minutes — the input to LOP and OT decisions.

### Layout (map to the design-system parts)
1. Back-arrow + `HrPageHeader` — title **Attendance Summary**, subtitle "Present days, late days, average hours, and overtime per employee", actions **Export CSV**.
2. Filter row — `CompanySelector`, **From** date (default 1st of current month), **To** date (default today).
3. Chart card — caption "Top 20 by late days"; horizontal recharts `BarChart` 260px (`layout="vertical"`, 80px name axis), series **Present Days** `#059669` and **Late Days** `#C2410C`; dataset = rows sorted by `late_days` desc, first 20.
4. `TableCard` → `hr-table`, 7 columns; **Name** cell is `HrAvatar name`; **Late Days** > 0 rendered as `HrStatusPill tone="late"`.

### Data shown
- `AttendanceSummaryRow[]` `{ employee_code, employee_name, department | null, present_days, late_days, avg_hours | null, total_overtime_mins }` (`useReports.ts:22-30`).
- Columns: **Emp Code** → `employee_code` (`hr-mono`) · **Name** → `HrAvatar(employee_name)` · **Department** → `department` or `—` · **Present Days** → `present_days` · **Late Days** → `late_days` (late pill when >0) · **Avg Hours** → `avg_hours.toFixed(1)` or `—` · **Overtime (min)** → `total_overtime_mins`.
- One row per employee; no pagination, no search, no sort.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | header | → `/hrms/reports` | all | LIVE |
| Export CSV | header actions | `GET /v1/reports/attendance-summary/export.csv?companyId&from&to` → `attendance-summary-2026-09-23.csv` | `hrms.report.attendance`; needs company | LIVE |
| Select company… | filter row | `?company=` | all | LIVE |
| From / To | filter row | `?from=` / `?to=` | all | LIVE |
| Retry | error state | `refetch()` | all | LIVE |

### States
`ReportShell` set: Select a company / skeleton / No data for this period / Failed to load report + Retry / Access Restricted / company-list 403 helper.

### Rules & permissions
- `hrms.report.attendance` on JSON and CSV (shared with Late Marks). Company-wide — V117 notes there is "no manager or department predicate" in `attendanceSummaryReport`, which is why DEPT_MANAGER lost the code.
- V066 keeps this for FINANCE_LEAD ("visibility for payroll").

### Gaps & plan  (keep / add / change)
- **Keep:** per-employee table with `HrAvatar` + late pill; Export. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §24.3] search, sort, pagination / rows-per-page (this table is one row per employee — hundreds of rows at scale — with none of them; [STATUS › Important limits still open] "Large-list scalability … need broader acceptance"). [BLUEPRINT §8.1] row click → employee profile Attendance tab (`EmployeeDetail`), [PLAN §8] Analytics row: "Chart → filtered list". [BLUEPRINT §19] "no attendance raw export" ([BLUEPRINT §27 P2] "attendance raw export") — offer a raw-logs export next to this summary. [HANDOFF §10 B] "Recheck the client's original examples: late-person details …" — this is the page that should answer "who was late and how much".
- **Change:** [code] "Overtime (min)" shown in raw minutes — convert to `h:mm`; [code] chart shows only the top 20 by late days but the caption is the only hint the chart and table differ; [code] `Name` column has the avatar but the employee code is a separate mono column — DS pattern is `HrAvatar name sub={code}` (which `AttendanceAnalytics.tsx:323` already does).

### Screenshot
`Attach: /hrms/reports/attendance-summary — current screen`

### Claude Design prompt (ready to paste)
```
Design the Attendance Summary report page for HR Manager / Finance Lead at /hrms/reports/attendance-summary.
HrPageHeader with back-arrow, crumb "Reports & Analytics", title "Attendance Summary", subtitle "Present days, late days, average hours, and overtime per employee", action HrButton ghost "Export CSV".
FilterBar: HrSelect "Company", date range "01 Sep 2026 – 23 Sep 2026".
KPI strip: Employees 412 · Avg present days 16.4 · Employees with late marks 38 (orange) · Total overtime 1,240 h (teal).
Chart card titled "Top 20 by late days": horizontal bars per employee, Present Days (emerald) and Late Days (orange-red), names on the left axis.
TableCard with toolbar search "Search employee…" and a FilterDef "Department"; › DataTable columns Employee (HrAvatar name + sub "EMP-0142") · Department · Present Days · Late Days (HrStatusPill tone late "4") · Avg Hours "8.6" · Overtime "5h 20m"; HrPagination footer 25 per page.
Row action: HrButton variant ghost size sm "View" → employee profile Attendance tab.
States: Select a company / No data for this period / Failed to load report with Retry / TableSkeleton.
Keep the late pill and avatar. Add search, sort, pagination and row drill-down (BLUEPRINT §24.3, §8.1). Change overtime from raw minutes to h:mm and merge Emp Code into the avatar sub-line.
```

---

## Leave Balance Report  `/hrms/reports/leave-balance`
- **File:** modules/hrms/reports/LeaveBalanceReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Leave Balance card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.leave`] (`App.tsx:701-704`); seeded OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER revoked by V117)
- **Status:** LIVE — `useLeaveBalanceReport → GET /v1/reports/leave-balance?companyId&year`; Export → `…/leave-balance/export.csv?companyId&year` (`ReportController.java:129-134`).

### Purpose
HR checks every employee's entitlement, used, pending, carry-forward and available days per leave type for a calendar year — for encashment, year-end carry-forward and leave-abuse checks.

### Layout (map to the design-system parts)
1. Back-arrow + `HrPageHeader` — title **Leave Balance Report**, subtitle "Leave entitlement, used, pending, carry-forward, and available days per employee", actions **Export CSV**.
2. Filter row — `CompanySelector` and a raw `<select>` **Year** with the current year and the 4 previous (2026 … 2022), URL `year`.
3. Chart card — caption "Top 20 by leave used (summed across types)"; grouped recharts `BarChart` 260px, X = employee name at −35° (interval 0), series **used** `#EF4444`, **pending** `#059669`, **available** `#22C55E` (lower-case keys straight from the data — legend reads "used / pending / available").
4. `TableCard` → `hr-table`, **9 columns**; one row per employee × leave type.

### Data shown
- `LeaveBalanceRow[]` `{ employee_code, employee_name, department | null, leave_type, total_entitlement, used, pending, carry_forward, available }` (`useReports.ts:32-42`).
- Columns: **Emp Code** (`hr-mono`) · **Name** (`HrAvatar`) · **Department** (or `—`) · **Leave Type** → `leave_type` · **Entitled** → `total_entitlement` · **Used** · **Pending** · **Carry Fwd** → `carry_forward` · **Available**.
- Chart dataset is a client-side aggregate per employee (sum across leave types), top 20 by used.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | header | → `/hrms/reports` | all | LIVE |
| Export CSV | header actions | `GET /v1/reports/leave-balance/export.csv?companyId&year` → `leave-balance-2026-09-23.csv` | `hrms.report.leave`; needs company | LIVE |
| Select company… | filter row | `?company=` | all | LIVE |
| Year (select) | filter row | `?year=` (2026–2022) | all | LIVE |
| Retry | error state | `refetch()` | all | LIVE |

### States
`ReportShell` set (Select a company / skeleton / No data for this period / Failed to load report + Retry / Access Restricted).

### Rules & permissions
- `hrms.report.leave` on JSON and CSV. Company-wide; `year` defaults server-side to the current year.

### Gaps & plan  (keep / add / change)
- **Keep:** year picker, per-type rows, Export. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §24.3] search / leave-type filter / pagination — the widest, longest table in the group (employees × types) has none. [BLUEPRINT §8.1] row → employee profile Leave tab. [BLUEPRINT §21] ESS "My Workspace › My Leave — balances, [Apply], history" consumes the same concept — keep the wording (Entitled / Used / Pending / Carry Fwd / Available) identical.
- **Change:** [code] 9 columns breaks the DS "≤5–6 columns" rule (conventions.md) — group by employee with leave types as sub-rows, or pivot leave types into an expandable row; [code] chart legend shows raw keys `used / pending / available` (lower-case); [code] the −35° employee-name axis becomes unreadable past ~12 names.

### Screenshot
`Attach: /hrms/reports/leave-balance — current screen`

### Claude Design prompt (ready to paste)
```
Design the Leave Balance Report page for HR Manager / Finance Lead at /hrms/reports/leave-balance.
HrPageHeader with back-arrow, crumb "Reports & Analytics", title "Leave Balance Report", subtitle "Leave entitlement, used, pending, carry-forward, and available days per employee", action HrButton ghost "Export CSV".
FilterBar: HrSelect "Company", HrSelect "Year" (2026, 2025, 2024, 2023, 2022), HrSelect "Leave type" (Casual Leave, Sick Leave, Earned Leave, all), search "Search employee…".
KPI strip: Employees 412 · Days used YTD 2,318 · Pending requests 46 (warn) · Carry-forward at risk 118 days.
Chart card "Top 20 by leave used": grouped bars per employee — Used (red), Pending (emerald), Available (green) — with legend labels in Title Case.
TableCard › DataTable: one row per employee (HrAvatar name + sub "EMP-0142", Department), then per leave type columns Entitled · Used · Pending · Carry Fwd · Available, e.g. "Earned Leave 18 · 7 · 2 · 4 · 13"; expandable row or a compact sub-row per type so the table stays ≤6 visible columns; HrPagination footer.
States: Select a company / No data for this period / Failed to load report with Retry / TableSkeleton.
Keep year picker and export. Add search, leave-type filter, pagination and row → employee Leave tab (BLUEPRINT §24.3, §8.1). Change the 9-column flat table into a grouped layout and fix the lower-case legend.
```

---

## Late Marks Report  `/hrms/reports/late-marks`
- **File:** modules/hrms/reports/LateMarksReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Late Marks card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.attendance`] (`App.tsx:709-712`); seeded OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER revoked by V117)
- **Status:** LIVE — `useLateMarksReport → GET /v1/reports/late-marks?companyId&from&to`; Export → `…/late-marks/export.csv?companyId&from&to` (`ReportController.java:138-144`, guarded by `hrms.report.attendance`).

### Purpose
HR answers "who came late, on which day, by how many minutes, and when did they actually check in?" for a date range (default month-to-date) — the evidence for late-mark policies and LOP.

### Layout (map to the design-system parts)
1. Back-arrow + `HrPageHeader` — title **Late Marks Report**, subtitle "All late-arrival records with minutes late and check-in time", actions **Export CSV**.
2. Filter row — `CompanySelector`, **From** (default 1st of month), **To** (default today).
3. Chart card — caption "Top 15 offenders by total minutes late"; horizontal recharts `BarChart` 240px (90px name axis), single series **Total Late (min)** `#059669`; dataset aggregated per employee (count + total minutes), sorted by total minutes desc, first 15. (`Occurrences` is computed but not plotted.)
4. `TableCard` → `hr-table`, 6 columns; **Late (min)** rendered as `HrStatusPill tone="late"` "`{n} min`".

### Data shown
- `LateMarkRow[]` `{ employee_code, employee_name, department | null, attendance_date, late_by_minutes, check_in_at | null }` (`useReports.ts:44-51`).
- Columns: **Emp Code** (`hr-mono`) · **Name** (`HrAvatar`) · **Department** (or `—`) · **Date** → `attendance_date` (raw ISO string) · **Late (min)** → late pill `"12 min"` · **Check-in** → `check_in_at` raw or `—`.
- One row per late record (employee × date). CSV holds every record in range, not just the top-15 (code comment).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | header | → `/hrms/reports` | all | LIVE |
| Export CSV | header actions | `GET /v1/reports/late-marks/export.csv?companyId&from&to` → `late-marks-2026-09-23.csv` | `hrms.report.attendance`; needs company | LIVE |
| Select company… | filter row | `?company=` | all | LIVE |
| From / To | filter row | `?from=` / `?to=` | all | LIVE |
| Retry | error state | `refetch()` | all | LIVE |

### States
`ReportShell` set (Select a company / skeleton / No data for this period / Failed to load report + Retry / Access Restricted).

### Rules & permissions
- Guarded by `hrms.report.attendance` (same as Attendance Summary) — "no such permission" as `report.latemarks` exists (`ReportShell.tsx:34-37`). Company-wide, tenant-scoped.

### Gaps & plan  (keep / add / change)
- **Keep:** offenders chart + full record table + export. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §27 P0 #2] "Attendance `?status=` — Cannot answer 'who is late' — Status filter + late-duration columns" and [PLAN §8 / §23.A #3] Daily Tracking gets "`?status=` + `?method=`, late-duration + expected-vs-actual columns" — link each row to `/hrms/attendance?status=LATE&date=…` once that exists. [BLUEPRINT §6.1] "Exceptions: … '6 employees have >3 late marks this month'" — a threshold filter (≥3 marks) belongs here. [BLUEPRINT §24.3] search, sort, pagination (one row per late record grows fastest of all six).
- **Change:** [code] Date and Check-in are raw API strings (ISO / timestamp) — format as `18 Sep 2026` and `10:14 AM`; [code] the chart plots minutes only while the caption says "offenders" — show occurrence count too (already computed); [code] no employee filter, so finding one person's late marks means scrolling.

### Screenshot
`Attach: /hrms/reports/late-marks — current screen`

### Claude Design prompt (ready to paste)
```
Design the Late Marks Report page for HR Manager / Finance Lead at /hrms/reports/late-marks.
HrPageHeader with back-arrow, crumb "Reports & Analytics", title "Late Marks Report", subtitle "All late-arrival records with minutes late and check-in time", action HrButton ghost "Export CSV".
FilterBar: HrSelect "Company", date range "01 Sep 2026 – 23 Sep 2026", search "Search employee…", toggle chip "≥ 3 late marks".
KPI strip: Late records 214 · Employees affected 38 · Avg late 14 min (orange) · Worst offender "Rahul Verma · 6 marks".
Chart card "Top 15 offenders": horizontal bars per employee showing Total late (min) with occurrence count in the tooltip ("6 marks · 92 min").
TableCard with toolbar search "Search employee…"; › DataTable columns Employee (HrAvatar name + sub "EMP-0142") · Department · Date "18 Sep 2026" · Late (HrStatusPill tone late "12 min") · Check-in "10:14 AM"; HrPagination footer 25 per page.
Row action: HrButton variant ghost size sm "Open day" → Daily Tracking filtered to that date and employee.
States: Select a company / No data for this period / Failed to load report with Retry / TableSkeleton.
Keep the late pill and export. Add search, a ≥3-marks exception filter, pagination and row drill-down (BLUEPRINT §6.1, §27 P0 #2, §24.3). Change raw ISO date/time strings to Indian date and 12-hour time.
```

---

## Diversity Report  `/hrms/reports/diversity`
- **File:** modules/hrms/reports/DiversityReport.tsx (+ `ReportShell.tsx`)  ·  **Sidebar:** not in sidebar / reached from Reports Center → Diversity card  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.diversity`] (`App.tsx:717-720`); seeded OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD (V026 / V064; DEPT_MANAGER never held this code)
- **Status:** LIVE — `useDiversityReport → GET /v1/reports/diversity?companyId`; Export → `…/diversity/export.csv?companyId` (`ReportController.java:148-151`).

### Purpose
HR reports the active workforce's gender split overall and per department (POSH / board reporting). No date filter — always the current active workforce.

### Layout (map to the design-system parts)
1. Back-arrow + `HrPageHeader` — title **Diversity Report**, subtitle "Headcount breakdown by gender and department for the active workforce", actions **Export CSV**.
2. Filter row — `CompanySelector` only.
3. Two chart cards in a `lg:grid-cols-2` grid: left caption "Overall gender breakdown" — recharts donut (`innerRadius 55 / outerRadius 85`, no `Legend`, tooltip only) with slice labels `"MALE 62%"`, colours MALE `#4096FF`, FEMALE `#EC4899`, OTHER `#14B8A6` (fallback palette for other values); right caption "By department" — stacked `BarChart` 220px, X = department at −30°, one stacked bar series per gender value present.
4. `TableCard` → `hr-table`, 4 columns; **Gender** rendered as `HrStatusPill` (MALE→blue, FEMALE→pink, OTHER→teal, else gray) showing the raw enum text.
5. (Dead) an inline card "No diversity data / No employee gender data available for this company." — unreachable because `ReportShell` already swaps in "No data for this period" when `hasData` is false.

### Data shown
- `DiversityRow[]` `{ department | null, gender, count, pct }` (`useReports.ts:53-58`); one row per department × gender.
- Columns: **Department** (or `—`) · **Gender** → pill with `gender` enum · **Count** → `count` · **% of Dept** → `pct` rendered `41%`.
- Donut = client-side sum of `count` per gender; stacked bar = department × gender matrix built client-side.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← (back) | header | → `/hrms/reports` | all | LIVE |
| Export CSV | header actions | `GET /v1/reports/diversity/export.csv?companyId` → `diversity-2026-09-23.csv` | `hrms.report.diversity`; needs company | LIVE |
| Select company… | filter row | `?company=` | all | LIVE |
| Retry | error state | `refetch()` | all | LIVE |

### States
`ReportShell` set (Select a company / skeleton / No data for this period / Failed to load report + Retry / Access Restricted). The component's own "No diversity data" card is dead code.

### Rules & permissions
- `hrms.report.diversity` on JSON and CSV; company-scoped, active employees only (subtitle + card description); no date parameter on either endpoint.

### Gaps & plan  (keep / add / change)
- **Keep:** donut + department stack + table; Export. [BLUEPRINT §6 #46] Class A.
- **Add:** [BLUEPRINT §8.1] department row → Workforce Directory filtered by department (and gender once the directory supports it). [BLUEPRINT §24.3] sort. Nothing else in the audit docs asks for more diversity dimensions — do not invent age/tenure splits.
- **Change:** [code] gender shown as raw enum `MALE / FEMALE / OTHER` in pills and donut labels — Workforce Analytics already maps them to "Male / Female / Other / Prefer not to say" (`WorkforceAnalytics.tsx:36-41`); use the same labels here. [code] two different colour sets for gender between this page (`#4096FF/#EC4899/#14B8A6`) and Workforce Analytics (`DONUT_COLORS`) — unify. [code] remove the unreachable inline empty card.

### Screenshot
`Attach: /hrms/reports/diversity — current screen`

### Claude Design prompt (ready to paste)
```
Design the Diversity Report page for HR Manager / Finance Lead at /hrms/reports/diversity.
HrPageHeader with back-arrow, crumb "Reports & Analytics", title "Diversity Report", subtitle "Headcount breakdown by gender and department for the active workforce", action HrButton ghost "Export CSV".
FilterBar: HrSelect "Company" only (no date — always the current active workforce).
KPI strip: Active employees 388 · Female 34% (pink) · Male 63% (blue) · Other / Prefer not to say 3% (teal).
Two chart cards side by side: "Overall gender breakdown" donut with labels "Female 34%", "Male 63%", "Other 3%"; "By department" stacked bars (Engineering, Sales, Operations, Finance, HR) with one segment per gender, same three colours.
TableCard › DataTable columns Department · Gender (HrStatusPill tone blue "Male" / pink "Female" / teal "Other") · Count · % of Dept "41%"; rows grouped by department.
States: Select a company / No data for this period / Failed to load report with Retry / skeleton cards.
Keep donut + stacked bar + table and export. Add department row → Workforce Directory filtered by department. Change raw MALE/FEMALE enums to Title Case labels and use the same gender palette as Workforce Analytics.
```

---

## Workforce Analytics  `/hrms/workforce-analytics`
- **File:** modules/hrms/analytics/WorkforceAnalytics.tsx  ·  **Sidebar:** Reports & Analytics › Workforce Analytics (`visibleForRoles: R_ADMIN` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD; also global search "Workforce Analytics" under *Insights*, gated on `P.HRMS_EMPLOYEE_READ` in `actionRegistry.ts:218`)  ·  **Roles:** `RouteGuard anyOf` [`hrms.report.headcount`, `hrms.report.attrition`, `hrms.report.diversity`] (`App.tsx:409-412`); each block additionally fetches only when the user holds that block's code. Seeded holders OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD; COMPANY_ADMIN is in `R_ADMIN` but has no canonical report grant (see group header)
- **Status:** LIVE — composes `useHeadcountReport` (GET `/v1/reports/headcount?companyId&asOf=today`), `useDiversityReport` (GET `/v1/reports/diversity?companyId`), `useAttritionReport` (GET `/v1/reports/attrition?companyId&from=<11 months ago>&to=today`) and `useEmployeeDirectory({companyId, page:0, pageSize:1})` (GET `/v1/hrms/employees?…` for `totalElements` only). No export, no drill-down.

### Purpose
An HR head or Finance Lead opens this for a one-screen picture of the company: how many people, how many active, current attrition rate and who is on notice/probation — with department and gender breakdowns and a 12-month attrition trend. Read-only overview; the six reports are the detail behind it.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Reports & Analytics", title **Workforce Analytics**, subtitle "Headcount, diversity, and attrition across your organization", actions = raw `<select>` company picker (defaults to the first company; state is local, not in the URL; `disabled` while companies load or when the list is empty, where its only option is **"No companies"**; no placeholder option, so it can never be "unselected" once a company exists).
2. KPI strip `grid sm:grid-cols-2 lg:grid-cols-4` of `HrStatCard`:
   - **Total Headcount** (`Users`, blue) → Σ `total` over headcount rows; sub "`{directoryTotal} in directory`" (from the employees page call) or "`{n} departments`".
   - **Active Employees** (`UserCheck`, green) → Σ `active`; sub "`{pct}% of headcount`".
   - **Attrition (latest month)** (`TrendingDown`, red) → last row's `attrition_pct` as "`1.8%`" or "—"; sub "`{Σ exits} exits · trailing 12 mo`".
   - **On Notice / Probation** (`Building2`, orange) → `on_notice + probation`; sub "`{n} notice · {n} probation`".
   Each card takes `loading` from its own hook; none has `onClick`.
3. Charts row `lg:grid-cols-3`: (a) 2/3-width `.ut-card.ut-card-lg` **Headcount by Department** with `HrStatusPill tone="blue"` "`{n} depts`" — grouped `BarChart` 280px, series **Active** `#22C55E`, **Total** `#2563EB`, X labels at −12°, sorted by Total desc; (b) 1/3-width **Gender Diversity** with `HrStatusPill tone="purple"` "`{n} people`" — donut (58/88) with legend, labels Male / Female / Other / Prefer not to say sorted by count desc, `DONUT_COLORS` palette assigned by position (blue, pink, amber, purple, cyan, green) — so the colour of "Female" changes with the sort order, unlike the Diversity Report's fixed per-gender map.
4. Full-width card **Monthly Attrition** with a right-aligned caption "`Oct 2025 – Sep 2026`" — `LineChart` 260px, single line **Attrition %** `#059669` on a `%` axis.
5. `TableCard` → `hr-table` **6 columns**: Department · Total · Active · On Notice (`HrStatusPill tone="orange"` when >0, grey `0` otherwise) · Probation (`HrStatusPill tone="info"` when >0) · Share (`{pct}%` of total headcount); rows sorted by Total desc; 5 skeleton rows while loading.
6. Footer line "Select a company to view workforce analytics." when nothing is selected and nothing is loading.

### Data shown
- Headcount block (KPI 1, 2, 4, dept chart, table) ← `useHeadcountReport(companyId, today, {enabled: can hrms.report.headcount})`.
- Gender donut ← `useDiversityReport(companyId, {enabled: can hrms.report.diversity})`, aggregated client-side per gender (null gender → "Prefer not to say").
- Attrition KPI + line ← `useAttritionReport(companyId, from, to, {enabled: can hrms.report.attrition})`; `from` = first of month 11 months back, `to` = today.
- "in directory" sub-label ← `useEmployeeDirectory` `totalElements` (`GET /v1/hrms/employees?companyId&page=0&pageSize=1`, `api/useWorkforce.ts:218-230`).
- Company list ← `useCompanies → GET /v1/hrms/companies`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Company (select) | header actions | sets local `companyId` → all four hooks refetch; `disabled` while `useCompanies` loads or returns an empty list | all on route | LIVE |
| — | KPI cards | no `onClick` (not drill-downs) | — | n/a |
| — | table rows | no row action | — | n/a |
| — | header | no Export button on this page | — | n/a |

### States
- loading: `HrStatCard loading` per card; 280px / 260px pulsing blocks per chart; 5×6 skeleton cells in the table.
- empty (per block): `EmptyChart` dashed box with `Building2` icon — **"No headcount data for this company"**, **"No diversity data"**, **"No attrition data in this window"**; table row **"No department headcount to display."**; page footer **"Select a company to view workforce analytics."**; select option **"No companies"**.
- error: **not surfaced** — code comment (`WorkforceAnalytics.tsx:64-70`) says the hooks' `.error` is never read, so a 403/500 renders as the empty state.
- no-permission: `RouteGuard` "Access Restricted" if the user holds none of headcount / attrition / diversity; with only one code the other blocks silently show their empty message (fetch disabled).

### Rules & permissions
- Route admits any of three report codes; each fetch is gated on its own code so a role granted only one (e.g. a custom role) never triggers a 403 on the others.
- Company-scoped; first company auto-selected. Tenant scoped by RLS on the report endpoints.
- No date controls — "as of today" and "trailing 12 months" are fixed.

### Gaps & plan  (keep / add / change)
- **Keep:** KPI strip + department bar + gender donut + attrition line + department table, all on real report rows; per-block permission gating. [BLUEPRINT §6 #47] Class A "Keep"; [PLAN §15] "Workforce Analytics ✅ ✅ Keep".
- **Add:** [BLUEPRINT §8.1 / §6 #1] "Every number is a question, and every question must have a destination" / "Every metric drills down", and [PLAN §23.A #5 / §5 line 263 / §6 line 323] "Make clickable tiles look clickable (`HrStatCard onClick` + hover affordance)" — "a clickable-looking tile that does nothing is worse than a static one" — wire Total Headcount → Workforce Directory, Attrition → Attrition Report, On Notice/Probation → Directory filtered by status, department row → Directory by department. [BLUEPRINT §24.3] "no export outside reports" — add Export CSV using the headcount export (`/v1/reports/headcount/export.csv`, `hrms.report.headcount`) so this page matches the six reports. [BLUEPRINT §6.1] "Exceptions" block (rule-based, e.g. departments with >10% on notice) instead of AI insights.
- **Change:** [code: WorkforceAnalytics.tsx:64-70] surface hook errors (403/500 currently look like "No … data"); [code] company choice is not in the URL, unlike every report page — make it `?company=` so links are shareable and consistent; [code: actionRegistry.ts:218] global-search entry is gated on `hrms.employee.read` while the route needs a report code — align to the route guard; [code] raw `<select>` in `HrPageHeader actions` → `HrSelect`; [code] gender labels/colours differ from Diversity Report — unify; [code] no date window control while the reports beneath have one.

### Screenshot
`Attach: /hrms/workforce-analytics — current screen`

### Claude Design prompt (ready to paste)
```
Design the Workforce Analytics dashboard for HR Manager / Finance Lead / Company Admin at /hrms/workforce-analytics.
HrPageHeader with crumb "Reports & Analytics", title "Workforce Analytics", subtitle "Headcount, diversity, and attrition across your organization"; actions = HrSelect "Company" (e.g. "UnifiedTree Technologies Pvt Ltd") and HrButton ghost "Export CSV".
KPI strip of four clickable HrStatCards: Total Headcount 412 (sub "409 in directory") · Active Employees 388 (sub "94% of headcount") · Attrition (latest month) 1.8% (red, sub "27 exits · trailing 12 mo") · On Notice / Probation 24 (orange, sub "9 notice · 15 probation"); show hover affordance since each drills down.
Charts row: 2/3-width card "Headcount by Department" with pill "8 depts" — grouped bars Active (green) vs Total (blue) for Engineering, Sales, Operations, Finance, HR, Support, Design, Admin; 1/3-width card "Gender Diversity" with pill "388 people" — donut Male 63% / Female 34% / Other 3% with legend.
Full-width card "Monthly Attrition" captioned "Oct 2025 – Sep 2026": single emerald line "Attrition %" with dots, values 0.5–2.4%.
TableCard › DataTable columns Department · Total · Active · On Notice (HrStatusPill tone orange "3") · Probation (HrStatusPill tone info "5") · Share "31%", sorted by Total desc; row click → Workforce Directory filtered by department.
States: HrStatCard loading skeletons and pulsing chart blocks; per-block dashed empty placeholder (the page's local EmptyChart, Building2 icon) "No headcount data for this company" / "No diversity data" / "No attrition data in this window"; table "No department headcount to display."; add an error EmptyState "Failed to load analytics" with Retry (the code currently swallows errors).
Keep the four-block structure. Add drill-downs on every KPI and row and the Export button (BLUEPRINT §8.3, §24.3). Change the raw company select to HrSelect and reuse the Diversity Report's gender labels and palette.
```
