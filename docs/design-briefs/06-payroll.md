# Payroll — page briefs

This group is the finance-side money workflow of UnifiedTree HRMS: configure statutory rules and the component catalog, review each employee's salary structure, run the monthly payroll cycle (create → process → lock → payslips), pay it out through a bank batch, and award performance-linked incentives.
Sidebar group **Payroll** (`payroll-hr` in `layouts/PlatformShell.tsx`): Payroll Dashboard · Salary Structure · Processing & Payslips · Payroll Settings · Production-Linked Incentive · Advances & Loans (other group) · Bank Disbursement. Salary Components lives under **Master › Payroll Configuration**.
Roles: `R_FIN_RUPEE` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD (rupee screens; HR excluded). `R_FIN_META` = R_FIN_RUPEE + HR_MANAGER (workflow screens: Processing & Payslips, PLI, Payroll Configuration). All routes sit behind `ModuleGate moduleKey="payroll"` (shows `ModuleNotActivated` if the tenant lacks the module). Design vocabulary from `.design-sync/conventions.md`.

Permission codes (`packages/sdk/src/permissions/codes.ts`): `payroll.runs.read / manage / lock`, `payroll.settings.read / update`, `payroll.components.read / manage`, `hrms.pli.read / write / read.self`, `hrms.disbursement.read / build / post`, `hrms.bank_profile.read / manage`. Backend grants: disbursement + bank-profile codes go to OWNER, SUPER_ADMIN and FINANCE_LEAD (`V090__wave2_6_permission_backfill.sql`; HR_MANAGER explicitly excluded — the comment in `BankDisbursement.tsx` cites "V093/V094" but the grant lives in V090); PLI read/write/read.self to SUPER_ADMIN, OWNER, HR_MANAGER, FINANCE_LEAD; PLI read.self only to DEPT_MANAGER and EMPLOYEE (`V076__pli_schema_and_permissions.sql`).

---

## Payroll Dashboard  `/hrms/payroll-dashboard`
- **File:** `modules/hrms/payroll/PayrollDashboard.tsx`  ·  **Sidebar:** Payroll › Payroll Dashboard (also "Run Payroll" quick action on `HrmsDashboard.tsx` / `CompanyAdminDashboard.tsx`, "Open payroll" link in `dashboard/OperationalWidgets.tsx`, `/payroll` redirects here)  ·  **Roles:** sidebar `R_FIN_RUPEE`; route `RequirePermission payroll.runs.read` (soft redirect to `/me`) + `RouteGuard anyOf [payroll.runs.read]`. Rupee tiles/chart additionally gated client-side on `useRoles().isAdmin` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN only).
- **Status:** PARTIAL — KPIs wired to `usePayrollDashboardKpis → GET /v1/payroll/dashboard/kpis`, trend to `usePayrollCostTrend → GET /v1/payroll/dashboard/trend?months=6`, table to `useRuns → GET /v1/payroll/runs`; but the header action "Run Payroll Cycle" has no `onClick` (dead button).

### Purpose
Finance/admin lands here to see the current period's total payroll cost, average salary, how many runs are still awaiting disbursal, TDS liability, a 6-month cost trend, and the ten most recent runs — then jump into the run cycle.

### Layout
1. `HrPageHeader` — crumb "Payroll", title "Payroll Dashboard", subtitle `Live aggregates for {currentPeriodLabel} across all your payroll runs` ("Payroll cost figures are restricted to admin / finance roles" when redacted; "Cost, headcount, and disbursal status across your payroll runs" while KPIs have not loaded), actions: `HrButton` "+ Run Payroll Cycle".
2. KPI strip, 4 × `HrStatCard`: "Total Payroll Cost" (green, `inr(kpis.totalPayrollCost)`, sub = period label), "Average Salary" (purple, `kpis.averageSalary`), "Pending Disbursals" (orange, `kpis.pendingDisbursals`, sub "Locked / processing runs not yet paid"), "TDS Liability" (blue, `kpis.tdsLiability`). When redacted every value is "—" and the three rupee tiles' sub reads "Restricted" (Pending Disbursals keeps its fixed sub); before KPIs load the sub reads "No runs yet".
3. Two-column row: `.ut-card` "Payroll Cost — Last 6 Months" (recharts `BarChart`, emerald bars, ₹ y-axis, sub "Total cost including employer contributions") spanning 2/3; `.ut-card` "Run Status Breakdown" — per status an `HrStatusPill` (DRAFT gray, PROCESSING info, LOCKED teal, PAID ok, CANCELLED red) + `count · pct%` + progress bar.
4. "Recent Runs" heading + `TableCard` › `DataTable` (no search/filters): Period (`MONTHS[periodMonth] periodYear`), Company (`companyName`), Status (`HrStatusPill`), Employees (`employeeCount`, right), Net Pay (`inr(totalNet)`, right; "—" when redacted), Processed (`processedAt` as `d MMM yyyy`). Newest 10 by period.

### Data shown
- KPIs: `usePayrollDashboardKpis` → `GET /v1/payroll/dashboard/kpis` → `{totalPayrollCost, averageSalary, pendingDisbursals, tdsLiability, currentPeriodLabel}`; fetch disabled for non-admins.
- Trend: `usePayrollCostTrend(6, {enabled: isAdmin})` → `GET /v1/payroll/dashboard/trend?months=6` → `[{label, totalPayrollCost, runCount}]`; also disabled for non-admins.
- Status breakdown + Recent Runs: `useRuns()` → `GET /v1/payroll/runs` (`PayrollRun[]`), client-side rollup.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Run Payroll Cycle | header | Nothing — `HrButton` has no `onClick` | R_FIN_RUPEE | DEAD (code: no handler in `PayrollDashboard.tsx`) |
| Recent Runs rows | table | No `onRowClick`; rows are not links | — | Missing |
| KPI tiles | strip | No `onClick` drill-down | — | Missing |

### States
- loading: `HrStatCard loading` skeletons (admins only); chart `animate-pulse` block; breakdown 4 skeleton rows; `DataTable loading`.
- empty: chart "No payroll runs yet / Create a run to see cost trends."; breakdown "Nothing to show / Run statuses appear here."; table "No payroll runs yet. Runs you create will appear here."
- redacted (non-`isAdmin`): every rupee value "—", sub "Restricted", chart replaced by "Payroll cost trend is restricted to admin / finance roles."
- no-permission: `RequirePermission` redirects to `/me`; module inactive → `ModuleNotActivated`.
- error: none handled (react-query errors leave tiles at "—").

### Rules & permissions
- Rupee redaction is role-string based (`useRoles().isAdmin`), NOT permission based. FINANCE_LEAD is `isFinance`, not `isAdmin`, so a Finance Lead — explicitly welcome per the sidebar `R_FIN_RUPEE` comment — sees the redacted dashboard. Contradiction visible in code.
- "Pending Disbursals" is a count, not rupees, but is still redacted.

### Gaps & plan
- **Keep:** the 4-KPI + trend + status-breakdown + recent-runs composition; server-side aggregates (comment in file: client rollups under-counted employer contributions).
- **Add:** [BLUEPRINT §6 row 25] "Add exceptions drill-down" — surface `GET /v1/payroll/runs/{id}/skipped` on the dashboard; [BLUEPRINT §15 / PLAN §12] progressive-disclosure banner "May 2026 · ₹1.24 Cr · 248 employees · ⚠ 2 exceptions [Review Exceptions] [Process Payroll]"; [PLAN AT-4] "2 exceptions is visible WITHOUT opening the run; clicked → both employees with reason"; [BLUEPRINT §8 drill-down table] "Payroll run status → /hrms/payroll/runs/{id}", "Payroll exceptions → /hrms/payroll/runs/{id}?tab=skipped"; [BLUEPRINT §6 row 28] TDS is "Never computed" and [PLAN §12] "only summed if a TDS component exists" — the TDS Liability tile needs a caveat or should be dropped until the engine computes it.
- **Change:** wire "Run Payroll Cycle" to `/hrms/payroll/runs` (open New-run modal) or remove it; make Recent Runs rows navigate to `/hrms/payroll/runs/:id` (code: `Link` is imported in `PayrollDashboard.tsx` but never used); make KPI tiles `onClick` drill-downs; fix redaction to use `payroll.runs.read`/finance bucket so FINANCE_LEAD sees rupees; "Employees"/"Net Pay" cells are right-aligned via inner div rather than column alignment.

### Screenshot
`Attach: /hrms/payroll-dashboard — current screen`

### Claude Design prompt (ready to paste)
```
Design the Payroll Dashboard page for OWNER / COMPANY_ADMIN / FINANCE_LEAD (crumb "Payroll").
HrPageHeader: title "Payroll Dashboard", subtitle "Live aggregates for Sep 2026 across all your payroll runs", primary HrButton "+ Run Payroll Cycle" that opens the New payroll run modal.
Add an exceptions banner under the header: "Sep 2026 · ₹1,24,00,000 · 248 employees · ⚠ 2 employees skipped (no salary structure)" with HrButtons "Review Exceptions" and "Process Payroll".
KPI strip of 4 HrStatCard: Total Payroll Cost ₹1,24,00,000 (green, sub "Sep 2026"), Average Salary ₹50,000 (purple), Pending Disbursals 2 (orange, sub "Locked / processing runs not yet paid"), TDS Liability ₹6,20,000 (blue). Each tile is a drill-down.
Row: ut-card "Payroll Cost — Last 6 Months" bar chart (Apr–Sep, ₹ axis, emerald bars) 2/3 wide; ut-card "Run Status Breakdown" with HrStatusPill DRAFT gray / PROCESSING info / LOCKED teal / PAID ok / CANCELLED red, "3 · 50%" and a progress bar per status.
TableCard "Recent Runs" → DataTable: Period "Sep 2026", Company, Status pill, Employees 248, Net Pay ₹1,05,40,000, Processed "18 Sep 2026"; row click opens /hrms/payroll/runs/:id.
States: skeleton tiles; empty "No payroll runs yet. Runs you create will appear here."; redacted variant where every ₹ is "—" with sub "Restricted" and the chart says "Payroll cost trend is restricted to admin / finance roles."
Keep the 4-tile + chart + breakdown + table order. Change: no dead buttons — every tile and row goes somewhere.
```

---

## Salary Structure  `/hrms/salary-structure`
- **File:** `modules/hrms/payroll/SalaryStructureAdmin.tsx` (+ `payroll/SalaryOverview.tsx` for the first tab)  ·  **Sidebar:** Payroll › Salary Structure  ·  **Roles:** sidebar `R_FIN_RUPEE`; route `RouteGuard anyOf [payroll.runs.read]` (no `RequirePermission`).
- **Status:** PARTIAL — overview + detail are LIVE (`useEmployeeDirectory → GET /v1/hrms/employees` in `useWorkforce.ts`, `useEmployeeStructure → GET /v1/payroll/structures/employee/{id}`, `useStructureHistory → …/history`, `useSalaryComponents → GET /v1/payroll/components`); header action "Bulk Revise CTC" has no `onClick`; no revise/edit action on this page at all (copy points to the employee profile).

### Purpose
Finance reviews what each employee costs and is paid: per-employee annual CTC, monthly gross, statutory deductions, net pay, employer contributions, tax regime/PF flags and the CTC revision history. Read-only here; revisions happen on the employee profile.

### Layout
1. `HrPageHeader` — crumb "Payroll", title "Salary Structure", subtitle "Review an employee's earnings, deductions and net pay breakdown.", actions: `HrButton variant="ghost"` "Bulk Revise CTC" + native `<select>` company scope ("All companies" + `useCompanies`).
2. `HrTabs`: "All Employees Overview" | "Employee Details".
3. **Tab: All Employees Overview** (`SalaryOverview.tsx`): helper sentence "Monthly salary estimates from the payroll engine, before attendance adjustments…"; "Find employee" search input; `TableCard` › raw `hr-table` columns Employee (name + code), Annual CTC, Monthly gross, Deductions, Estimated net, Action (`HrButton ghost` "View breakdown"); `HrPagination` 10/page. Each row fetches its own structure (N+1).
4. **Tab: Employee Details**, no employee selected: `TableCard search` placeholder "Search employees by name, code or email…" › `DataTable` Employee (avatar/initials + name + designation), Code (`employeeCode`), Status (`HrStatusPill` ACTIVE ok / else gray), Action `HrButton sm ghost` "Select →". Directory fetch only when a search term or company is set; first 25 rows, no pagination on this picker.
5. **Tab: Employee Details**, employee selected: `.ut-card` strip with `HrAvatar name sub="EMP-0142 · email"` + `HrButton sm ghost` "✕ Change employee"; KPI strip 4 × `HrStatCard`: Annual CTC (orange, sub "₹x / month"), Gross / mo (green, sub "/ yr"), Deductions / mo (red), Net pay / mo (blue); pill row: `HrStatusPill info` "Tax regime: NEW", `ok/gray` "PF · pfStatus" / "PF not applicable", `green` "Current", `gray` "Effective 1 Apr 2026", revision note; explanatory footnote (derived-from-CTC vs full-month); two `TableCard`›`DataTable` "Earnings" / "Deductions" (Component, Type pill, Monthly, Annual); optional "Employer contributions" `hr-table`; charts row — "Earnings composition" donut (`PieChart`) and "CTC revision history" `LineChart`; optional "Revisions" `hr-table` (Effective from, Annual CTC, Regime, Note, Status Current/Past).

### Data shown
- Companies: `useCompanies` → `GET /v1/org/companies` (via `useOrg`).
- Directory: `useEmployeeDirectory({companyId, search, page, pageSize})` → `GET /v1/hrms/employees?…` (`useWorkforce.ts`); overview uses pageSize 10, picker pageSize 25.
- Structure: `useEmployeeStructure(id)` → `GET /v1/payroll/structures/employee/{id}` → `ctcAnnual, ctcMonthly, taxRegime, pfApplicable, pfStatus, effectiveFrom, isCurrent, revisionNote, earnings[], deductions[], employerContributions[], grossMonthly, totalDeductions, netMonthly, derivedFromCtc` (server-computed full-month engine output; client fallback sums `lines`).
- History: `useStructureHistory(id)` → `GET /v1/payroll/structures/employee/{id}/history`.
- Catalog count: `useSalaryComponents` → `GET /v1/payroll/components` (only used for the "N salary components are available" sentence; counts `isActive` components only).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Bulk Revise CTC | header | Nothing — no `onClick` | R_FIN_RUPEE | DEAD |
| Company select | header | sets `companyId`, clears selection, re-keys overview | all viewers | LIVE |
| Tab "All Employees Overview" / "Employee Details" | HrTabs | switches tab | all | LIVE |
| Find employee (search) | overview | filters directory, resets page | all | LIVE |
| View breakdown | overview row | selects employee, switches to Details tab | all | LIVE |
| Retry salary | overview row (on error) | `refetch()` structure for that row | all | LIVE |
| Retry | overview (directory error) | `refetch()` directory | all | LIVE |
| Pagination | overview footer | `HrPagination` page change | all | LIVE |
| Search employees… | details toolbar | filters picker | all | LIVE |
| Select → | details picker row | `setSelected(row)` | all | LIVE |
| ✕ Change employee | details strip | clears selection | all | LIVE |
| Revise structure | — | not on this page; footnote says "Use 'Revise structure' on the employee's profile" | — | Missing here |

### States
- loading: overview "Loading employees..." row, per-row "Loading salary..."; details 4 `HrStatCard loading`.
- empty: overview "No employees found."; picker "Search for an employee or pick a company to begin." / "No employees found."; structure absent → dashed card "No salary structure — {name} doesn't have a salary structure set up yet. N salary components are available in the catalog to build one."; tables "No earning components" / "No deductions".
- error: directory `role="alert"` with message + Retry; structure "Couldn't load this employee's salary structure. Please try again."; overview row "Retry salary".
- special: `derivedFromCtc` footnote "No salary components configured — this breakup is derived from CTC as a single Basic component…"; otherwise "Full-month figures. An actual payroll run pro-rates earnings by paid days…"; overview cells "Not configured" / "Not calculated".
- no-permission: `RouteGuard` "Access Restricted".

### Rules & permissions
- Read-only; no mutation on this page (`useUpsertStructure` exists in `usePayroll.ts` but is unused here).
- Directory query is only fired when search text or a company is set (avoids pulling the whole org).
- Company scoping via select; tenant scoping server-side.

### Gaps & plan
- **Keep:** server-computed breakdown (fixed the "₹0 gross" bug per file comment); KPI strip + earnings/deductions split + revision history; [BLUEPRINT §6 row 26] "Keep".
- **Add:** [PLAN §12] "Salary Structure — Filters + export"; [BLUEPRINT §19 Reports] "no payroll register export from the UI"; revise-structure entry point on this page (code: footnote redirects to profile; `useUpsertStructure` unused).
- **Change:** "Bulk Revise CTC" is dead — wire or drop; the overview table is a raw `hr-table` with N+1 per-row fetches and text-only loading rows — rebuild as `TableCard`+`DataTable` with `TableSkeleton`; the picker's avatar is hand-rolled (`bg-indigo-100` initials) instead of `HrAvatar`; the company `<select>` in the header is native, not `HrSelect`; charts hide themselves when data is thin, leaving the layout inconsistent between employees.

### Screenshot
`Attach: /hrms/salary-structure — current screen`

### Claude Design prompt (ready to paste)
```
Design the Salary Structure page for OWNER / COMPANY_ADMIN / FINANCE_LEAD (crumb "Payroll"), read-only review of employee pay.
HrPageHeader: title "Salary Structure", subtitle "Review an employee's earnings, deductions and net pay breakdown.", filters slot: HrSelect "All companies"; actions: HrButton ghost "Export register" and primary "Revise structure" (enabled once an employee is chosen).
HrTabs: "All Employees Overview" | "Employee Details".
Overview: TableCard with search "Find employee" → DataTable: Employee (HrAvatar "Priya Mehta" sub "EMP-0142"), Annual CTC ₹12,00,000, Monthly gross ₹1,00,000, Deductions ₹6,200, Estimated net ₹93,800, row HrButton sm ghost "View breakdown"; HrPagination 10/page; cells "Not configured" / "Not calculated" when absent.
Details, no selection: TableCard search "Search employees by name, code or email…" → DataTable Employee / Code / Status pill / "Select →"; empty "Search for an employee or pick a company to begin."
Details, selected: HrAvatar strip "Priya Mehta · EMP-0142 · priya@acme.in" + ghost "Change employee"; 4 HrStatCard: Annual CTC ₹12,00,000 (orange, sub "₹1,00,000 / month"), Gross / mo ₹1,00,000 (green), Deductions / mo ₹6,200 (red), Net pay / mo ₹93,800 (blue); pill row "Tax regime: NEW" info, "PF · ELIGIBLE" ok, "Current" green, "Effective 1 Apr 2026" gray; footnote "Full-month figures. An actual payroll run pro-rates earnings by paid days…".
Two TableCards "Earnings" and "Deductions": Component / Type pill (EARNING ok, DEDUCTION red, REIMBURSEMENT teal) / Monthly / Annual, tabular-nums; optional "Employer contributions" table; donut "Earnings composition" + line "CTC revision history"; "Revisions" table Effective from / Annual CTC / Regime / Note / Current-Past pill.
States: skeleton tiles; "No salary structure — Priya Mehta doesn't have a salary structure set up yet." dashed card; error "Couldn't load this employee's salary structure. Please try again."
Keep the overview/detail split. Change: use HrAvatar and HrSelect everywhere, no hand-rolled initials or native selects.
```

---

## Processing & Payslips (Payroll Runs)  `/hrms/payroll/runs`
- **File:** `modules/hrms/payroll/PayrollRuns.tsx`  ·  **Sidebar:** Payroll › Processing & Payslips (also `dashboard/CompanySummary.tsx` "Finalized payroll" card navigates here)  ·  **Roles:** sidebar `R_FIN_META` (incl. HR_MANAGER); route `RequirePermission payroll.runs.read` + `RouteGuard anyOf [payroll.runs.read]`; "New run" needs `payroll.runs.manage`.
- **Status:** LIVE — `useRuns → GET /v1/payroll/runs`, `useCreateRun → POST /v1/payroll/runs`; one caveat: Gross/Deductions cells fall back to `Math.round(totalNet * 1.15)` / `* 0.15` when the server omits `totalGross`/`totalDeductions` (fabricated fallback).

### Purpose
Finance/HR starts and tracks monthly payroll cycles: create a run for a company + month, then open it to process, review payslips and lock.

### Layout
1. `HrPageHeader` — crumb "Payroll", title "Processing & Payslips", subtitle "Process monthly payroll, review payslips and lock the period.", action `Can payroll.runs.manage` › `HrButton` "+ New run".
2. `TableCard` (no search/filters) › `DataTable` rows clickable: Pay Cycle (`MONTHS[periodMonth] periodYear`, bold), Employees Processed (`employeeCount`), Gross Payroll (`inr(totalGross)`), Total Deductions (`inr(totalDeductions)`), Status (`HrStatusPill` via `statusTone` → DRAFT gray, PROCESSING info, LOCKED ok, PAID ok, CANCELLED gray).
3. `Modal size="md"` "New payroll run": `Field` Company (native select "Select company…"), Month (select Jan–Dec), Year (`Input number` 2020–2099); footer `Button ghost` "Cancel", `Button` "Create run" (`loading`, disabled until company + valid year).

### Data shown
- Runs: `useRuns()` → `GET /v1/payroll/runs` → `PayrollRun {id, companyName, periodMonth, periodYear, status, employeeCount, totalGross, totalDeductions, totalNet, skippedEmployeeCount, processedAt, lockedAt}`.
- Companies for the modal: `useCompanies` (`useOrg`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| + New run | header | opens "New payroll run" modal; pre-selects company if only one | `payroll.runs.manage` | LIVE |
| Row click | table | `navigate('/hrms/payroll/runs/:id')` | `payroll.runs.read` | LIVE |
| Company / Month / Year | modal | form state | manage | LIVE |
| Cancel | modal footer | closes | manage | LIVE |
| Create run | modal footer | validates year 2020–2099 & month 1–12 (toast on fail) → `POST /v1/payroll/runs {companyId, periodMonth, periodYear}` → toast "Payroll run created" → navigate to detail | manage | LIVE |

### States
- loading: `DataTable loading`.
- empty: "No payroll runs. Create your first run to begin processing payroll."
- error: create → toast with server message; list error not handled.
- no-permission: redirect `/me` (no `payroll.runs.read`); header button hidden without `manage`.

### Rules & permissions
- Year must be integer 2020–2099; month 1–12 (client guard mirrors backend).
- No company/year/status filters are exposed though `useRuns(filters)` supports `companyId`, `year`, `status`.
- No "Net pay" column here although the DTO carries `totalNet`; no skipped-count indicator although `skippedEmployeeCount` is on every row.

### Gaps & plan
- **Keep:** create-run modal flow and row-to-detail navigation; [BLUEPRINT §6 row 27] "Strong … Keep".
- **Add:** [PLAN §12 / BLUEPRINT §15] progressive disclosure on the run list — "May 2026 · ₹1.24 Cr · 248 employees · ⚠ 2 exceptions [Review Exceptions] [Process Payroll]"; company/year/status `FilterBar` (code: `RunFilters` unused); Net pay + Processed date columns (DTO has them).
- **Change:** remove the `totalNet * 1.15` / `* 0.15` fallbacks (render "—"); use `HrSelect` in the modal instead of native selects; `statusTone` maps LOCKED and PAID both to `ok` and CANCELLED to gray, unlike the dashboard's LOCKED teal / CANCELLED red — unify.

### Screenshot
`Attach: /hrms/payroll/runs — current screen`

### Claude Design prompt (ready to paste)
```
Design the Processing & Payslips page (payroll run list) for OWNER / COMPANY_ADMIN / FINANCE_LEAD / HR_MANAGER, crumb "Payroll".
HrPageHeader: title "Processing & Payslips", subtitle "Process monthly payroll, review payslips and lock the period.", action HrButton "+ New run"; filters slot: FilterBar with Company (HrSelect), Year (2026), Status (DRAFT / PROCESSING / LOCKED / PAID / CANCELLED).
TableCard → DataTable, row click opens the run: Pay Cycle "Sep 2026" (bold) with company name as sub, Employees Processed 248, Gross Payroll ₹1,24,00,000, Total Deductions ₹18,60,000, Net Pay ₹1,05,40,000, Status HrStatusPill (DRAFT gray, PROCESSING info, LOCKED teal, PAID ok, CANCELLED red) with an inline "⚠ 2 skipped" warn pill when skippedEmployeeCount > 0, Processed "18 Sep 2026".
Modal "New payroll run" (md): HrSelect Company "Select company…", Month Jan–Dec, Year number 2020–2099; footer Button ghost "Cancel", primary "Create run" (loading state), validation toasts "Year must be between 2020 and 2099".
States: TableSkeleton; EmptyState "No payroll runs. Create your first run to begin processing payroll." with the New run action.
Keep the single-table layout. Change: never show estimated gross/deductions — show "—" when the server has no figure.
```

---

## Payroll Run Detail  `/hrms/payroll/runs/:id`
- **File:** `modules/hrms/payroll/PayrollRunDetail.tsx`  ·  **Sidebar:** not in sidebar / reached from Processing & Payslips row click or after Create run  ·  **Roles:** `RouteGuard anyOf [payroll.runs.read]`; Process/Re-process need `payroll.runs.manage`; Lock/Reopen need `payroll.runs.lock`.
- **Status:** LIVE — `useRun → GET /v1/payroll/runs/{id}`, `useRunEmployees → GET …/employees`, `useProcessRun → POST …/process`, `useLockRun → POST …/lock`, `useReopenRun → POST …/reopen {reason}`, `useRunSkipped → GET …/skipped`, `useRunPayslip → GET …/employees/{empId}/payslip`, `downloadPayslipPdf → GET …/payslip.pdf`. Built on generic ui-kit (`StatCard`, `Badge`, `Drawer`, `Modal`, ui-kit `DataTable`) rather than the Hr* primitives.

### Purpose
Finance processes one payroll cycle: recalculates every payslip, checks totals and skipped employees, opens individual payslips, downloads PDFs, locks the period (which publishes payslips to ESS), and can reopen an unpaid run with a recorded reason.

### Layout
1. Back link "← Payroll runs" (plain button → `/hrms/payroll/runs`).
2. Title block: `h1` "{Mon YYYY}" + `Badge` status; sub `companyName`. Right: status-dependent actions — DRAFT: `Button` "▶ Process"; PROCESSING: `Button ghost` "Re-process" + `Button` "🔒 Lock"; LOCKED: green text "✓ Finalized · locked {date}" + `Button ghost` "Reopen for corrections". (No actions for PAID/CANCELLED.)
3. Amber alert (when `skippedEmployeeCount > 0`): "{n} employee(s) were skipped — No salary structure is assigned, so no payslip was generated for them. Assign a salary structure and re-process to include them." + `Button ghost` "View list".
4. KPI strip 4 × ui-kit `StatCard`: Employees (`employeeCount`), Gross (`inr(totalGross)`, info), Deductions (`inr(totalDeductions)`, warning), Net pay (`inr(totalNet)`, success).
5. `HrTabs`: "Overview" | "Employees".
6. **Overview tab:** `.ut-card` key/value grid — Period `periodStart → periodEnd`, Company, Status, Employees, Processed, Locked, Created (`toLocaleString('en-IN')`).
7. **Employees tab:** `.ut-card` › ui-kit `DataTable`: Code (mono), Employee, Paid (`paidDays`), LOP (`lopDays`), Gross, Net pay (bold), row `Button ghost` "Payslip"; row click also opens payslip.
8. `Drawer` "Payslip" — `PayslipBody`: name, "EMP-0142 · Sep 2026", designation, "Paid days: 26 · LOP days: 0"; sections Earnings / Deductions (name + `inr2` amount), "Gross earnings", "Total deductions", bold emerald "Net pay", "Employer contributions (not deducted)"; footer-ish `Button ghost` "⬇ Download PDF".
9. `Modal size="sm"` confirm — titles "Process payroll?" / "Lock this payroll run?" / "Reopen payroll for corrections?" with descriptions; reopen adds textarea "Reason for reopening" (max 500, placeholder "Describe the payroll correction"); buttons "Cancel" / "Confirm".
10. `Modal size="sm"` "Skipped employees" — description "Not paid in this run — no current salary structure assigned."; list name + code.

### Data shown
- Run: `GET /v1/payroll/runs/{id}` → `PayrollRun`.
- Employees: `GET /v1/payroll/runs/{id}/employees` → `RunEmployee {employeeId, employeeCode, employeeName, paidDays, lopDays, gross, deductions, netPay}`.
- Skipped: `GET /v1/payroll/runs/{id}/skipped` → `EligibleEmployee[] {employeeId, employeeCode, employeeName, ctcMonthly}` (fetched only when modal open; `ctcMonthly` not rendered).
- Payslip: `GET /v1/payroll/runs/{id}/employees/{empId}/payslip` → `PayslipDetail {earnings[], deductions[], employerContributions[], gross, totalDeductions, netPay, paidDays, lopDays, panMasked, bankMasked}` (`panMasked`/`bankMasked` not rendered).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Payroll runs | top | `nav('/hrms/payroll/runs')` | read | LIVE |
| Process | title (DRAFT) | opens confirm → `POST /runs/{id}/process` → toast "Payroll processed" | `payroll.runs.manage` | LIVE |
| Re-process | title (PROCESSING) | same confirm/mutation | manage | LIVE |
| Lock | title (PROCESSING) | confirm → `POST /runs/{id}/lock` → toast "Payroll locked" | `payroll.runs.lock` | LIVE |
| Reopen for corrections | title (LOCKED) | confirm with required reason → `POST /runs/{id}/reopen {reason}` → toast "Payroll reopened for corrections"; invalidates runs, ESS payslips, dashboard | lock | LIVE |
| View list | skipped alert | opens "Skipped employees" modal (`GET /skipped`) | read | LIVE |
| Tab Overview / Employees | HrTabs | switch | read | LIVE |
| Payslip (row button / row click) | Employees tab | opens Payslip `Drawer` | read | LIVE |
| Download PDF | payslip drawer | `GET …/payslip.pdf` blob download `payslip-{empId}.pdf`; toast on error | `payroll.runs.read` | LIVE |
| Try again | payslip / employees / skipped / run error | `refetch()` | read | LIVE |
| Payroll runs | run-error screen | back to list | read | LIVE |
| Cancel / Confirm | confirm modal | close / run mutation (Confirm disabled for reopen until reason typed) | as above | LIVE |
| Go to Bank Disbursement | — | not present; LOCKED state offers no next step | — | Missing |

### States
- loading: `CardSkeleton` full page; `DataTable isLoading`; `CardSkeleton` in drawer; "Loading skipped employees..." in modal.
- empty: Employees tab `emptyTitle` "No payslips yet", description "Process the run to generate payslips." (DRAFT) / "No eligible employees for this period."; skipped "No skipped employees."; payslip sections "None".
- error: run → `role="alert"` "Payroll run unavailable — This run could not be loaded. Check your access or try again." + Try again / Payroll runs; employees "Unable to load employees for this run."; payslip "Unable to load this payslip. It may no longer be available for this run."; skipped "Unable to load skipped employees."
- special: run lifecycle DRAFT → PROCESSING → LOCKED → PAID (PAID set by Bank Disbursement mark-paid) / CANCELLED; "Finalized · locked 18/9/2026, 6:02 pm"; skipped-employees amber banner.
- no-permission: `RouteGuard` "Access Restricted"; action buttons hidden via `Can`.

### Rules & permissions
- Process only from DRAFT/PROCESSING; Lock only from PROCESSING; Reopen only from LOCKED, requires a reason (≤500 chars); modal copy: "Posted bank batches must be cancelled first. Paid runs cannot be reopened."
- Locking "freezes the numbers and makes payslips available to employees".
- Employees without a current salary structure are skipped, not failed.

### Gaps & plan
- **Keep:** the process → lock → reopen lifecycle with confirmations; payslip drawer + PDF; skipped-employee banner (this IS the `/skipped` surface the blueprint asks for at run level); [BLUEPRINT §6 row 27] "Strong".
- **Add:** [BLUEPRINT §8 / PLAN §12] deep-link `?tab=skipped` and dashboard-level exception surfacing; [BLUEPRINT §15] exception rows with a "[Fix]" action per skipped employee ("Rajesh Kumar — missing bank details [Fix]") instead of a plain name list; a "Prepare bank disbursement" next step on LOCKED runs ([BLUEPRINT §28 Client Acceptance Checklist › Payroll] "Prepare bank disbursement", "Who was skipped and why"); show `panMasked` / `bankMasked` in the payslip drawer (DTO fields unused).
- **Change:** page is built on generic ui-kit (`StatCard`, `Badge`, `Drawer`, plain `h1`, slate classes) — migrate to `HrPageHeader` (crumb "Payroll / Processing & Payslips"), `HrStatCard`, `HrStatusPill`, `HrDrawer`, `TableCard`+Hr `DataTable`; timestamps use `toLocaleString('en-IN')` ("18/9/2026, 6:02:11 pm") instead of "18 Sep 2026"; ui-kit `Badge` tone maps LOCKED/PAID both to success.

### Screenshot
`Attach: /hrms/payroll/runs/:id — current screen`

### Claude Design prompt (ready to paste)
```
Design the Payroll Run Detail page for OWNER / COMPANY_ADMIN / FINANCE_LEAD / HR_MANAGER, crumb "Payroll / Processing & Payslips".
HrPageHeader: title "Sep 2026" with HrStatusPill status beside it (DRAFT gray / PROCESSING info / LOCKED teal / PAID ok), subtitle "Acme Industries Pvt Ltd · 1 Sep – 30 Sep 2026"; actions by status — DRAFT: primary "Process"; PROCESSING: ghost "Re-process" + primary "Lock"; LOCKED: text "Finalized · locked 18 Sep 2026, 6:02 pm", ghost "Reopen for corrections", primary "Prepare bank disbursement".
Exceptions banner (warn) when skipped > 0: "2 employees were skipped — no salary structure assigned" with rows "Rajesh Kumar EMP-0187 — no salary structure [Fix]" and ghost "View list".
KPI strip 4 HrStatCard: Employees 248, Gross ₹1,24,00,000 (blue), Deductions ₹18,60,000 (orange), Net pay ₹1,05,40,000 (green).
HrTabs "Overview" | "Employees" (badge 248) | "Skipped" (badge 2). Overview: ut-card key/value grid Period, Company, Status, Employees, Processed 18 Sep 2026, Locked, Created. Employees: TableCard search → DataTable Code EMP-0142 (mono), Employee HrAvatar, Paid 26, LOP 0, Gross ₹1,00,000, Net pay ₹93,800 (bold), row HrButton sm ghost "Payslip"; empty "No payslips yet — Process the run to generate payslips."
HrDrawer "Payslip" (max-w-lg): "Priya Mehta", "EMP-0142 · Sep 2026", designation, "Paid days 26 · LOP days 0", PAN ABCDE****F, bank ••••4321; sections Earnings / Deductions with ₹ amounts to 2 decimals, "Gross earnings ₹1,00,000.00", "Total deductions ₹6,200.00", bold emerald "Net pay ₹93,800.00", "Employer contributions (not deducted)"; footer Button ghost "Download PDF".
Modal sm confirmations: "Process payroll?" / "Lock this payroll run?" / "Reopen payroll for corrections?" with a required "Reason for reopening" textarea; buttons Cancel / Confirm.
States: page skeleton; error "Payroll run unavailable — This run could not be loaded. Check your access or try again." with Try again / Payroll runs.
Keep the lifecycle actions and skipped banner. Change: use Hr* primitives throughout and "18 Sep 2026" date format.
```

---

## Payroll Settings  `/hrms/payroll/settings`
- **File:** `modules/hrms/payroll/PayrollSettings.tsx`  ·  **Sidebar:** Payroll › Payroll Settings  ·  **Roles:** sidebar `R_FIN_RUPEE`; route `RouteGuard anyOf [payroll.settings.read]`; Save needs `payroll.settings.update`.
- **Status:** LIVE — `usePayrollSettings → GET /v1/payroll/settings`, `useUpdatePayrollSettings → PUT /v1/payroll/settings`, `usePtSlabs → GET /v1/payroll/pt-slabs/{state}`. Not built on Hr* components (plain `h1`, ui-kit `Field/Input/Button/DataTable`, local `Toggle`/`Card`).

### Purpose
Finance/admin configures the statutory deduction rules and the payroll calendar the engine uses for every run: PF, ESI, PT (state slabs), LWF, cycle days and LOP rules.

### Layout
1. Plain title block: `h1` "Payroll Settings", sub "Statutory deductions and payroll cycle. No calculations run yet — this is configuration only." (max-w-3xl, no crumb, no `HrPageHeader`).
2. `.ut-card` "Provident Fund (PF)": toggle "Enable PF"; when on: `Field` Employee % (12), Employer % (12), Wage ceiling (₹) (15000), toggle "Apply ceiling".
3. `.ut-card` "ESI": toggle; Employee % (0.75), Employer % (3.25), Wage ceiling (₹) (21000).
4. `.ut-card` "Professional Tax (PT)": toggle; `Field` State (native select — "Select state" placeholder then KA, MH, TN, TS, AP, WB, GJ, KL); ui-kit `DataTable` of slabs: "Monthly salary" (`₹min – ₹max` / `₹min+`), "PT / month" — rendered only when a state is chosen and it returns slabs.
5. `.ut-card` "Labour Welfare Fund (LWF)": toggle; Employee amount (₹), Employer amount (₹).
6. `.ut-card` "Payroll Cycle & LOP": Cycle start day (1), Cycle end day (31), Processing day (28); toggle "Sandwich rule (weekend between LOP days becomes LOP)"; `Field` "Late-mark LOP threshold" hint "Every N late marks = 1 LOP day. Leave blank to disable."
7. `Can payroll.settings.update` › `Button` "Save settings" (`loading`, disabled until dirty). No sticky footer.

### Data shown
- Settings: `GET /v1/payroll/settings` → `PayrollSettings` (pf*, esi*, pt*, lwf*, sandwichRuleEnabled, lateMarkLopThreshold, payrollCycleStartDay/EndDay, salaryProcessingDay). `pfEstablishmentCode`/`esiEstablishmentCode` exist in the type but have no field.
- PT slabs: `GET /v1/payroll/pt-slabs/{stateCode}` → `PtSlab {minSalary, maxSalary, monthlyTax}` (only when PT enabled + state chosen).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Enable PF / ESI / PT / LWF toggles | cards | local state, marks dirty, reveals fields | read (edit UI visible to all viewers) | LIVE |
| Apply ceiling / Sandwich rule toggles | cards | local state | same | LIVE |
| Numeric fields (%, ₹, days, threshold) | cards | local state | same | LIVE |
| State select | PT card | sets `ptStateCode`, triggers slab fetch | same | LIVE |
| Save settings | bottom | `PUT /v1/payroll/settings` → toast "Payroll settings saved" / error toast | `payroll.settings.update` | LIVE |
| Reset / discard | — | none; reload only | — | Missing |

### States
- loading: none (form renders empty until data arrives, then `useEffect` populates).
- empty: n/a (settings always exist server-side).
- error: save error → toast; load error unhandled.
- special: `dirty` flag gates Save; PT slab table appears only when state has slabs.
- no-permission: "Access Restricted"; Save hidden without `update` while inputs remain editable.

### Rules & permissions
- Defaults shown in inputs: PF 12/12, ceiling ₹15,000; ESI 0.75/3.25, ceiling ₹21,000; cycle 1–31, processing day 28.
- Fields are editable even for read-only viewers (only Save is gated).
- Subtitle says "No calculations run yet — this is configuration only." — stale: the engine does apply these (BLUEPRINT §15 "PF/ESI/PT via a golden-master-tested engine").

### Gaps & plan
- **Keep:** the five-card grouping (PF / ESI / PT / LWF / Cycle & LOP) and dirty-gated Save; [FUNCTIONALITY_AUDIT row] "payroll settings … Route smoke; not every configuration combination tested".
- **Add:** [BLUEPRINT §6 rows 28–29] TDS is "never computed" and ESI/PT/24Q statutory files are "deferred" — no TDS/regime settings exist here; PF/ESI establishment codes (code: `pfEstablishmentCode`, `esiEstablishmentCode` in `usePayroll.ts` type, no inputs).
- **Change:** adopt `HrPageHeader` (crumb "Payroll", title, subtitle) and a sticky save bar with "Discard"; replace native state select with `HrSelect`; make inputs read-only when the viewer lacks `payroll.settings.update`; fix the misleading "No calculations run yet" subtitle; add a loading skeleton.

### Screenshot
`Attach: /hrms/payroll/settings — current screen`

### Claude Design prompt (ready to paste)
```
Design the Payroll Settings page for OWNER / COMPANY_ADMIN / FINANCE_LEAD, crumb "Payroll", max-width ~3xl form.
HrPageHeader: title "Payroll Settings", subtitle "Statutory deductions and payroll cycle used by every payroll run."; sticky footer with Button "Discard" (ghost) and "Save settings" (primary, loading, disabled until dirty).
Five ut-cards in order: "Provident Fund (PF)" — toggle Enable PF, then Employee % 12, Employer % 12, Wage ceiling (₹) 15,000, toggle Apply ceiling, Establishment code; "ESI" — toggle, Employee % 0.75, Employer % 3.25, Wage ceiling (₹) 21,000, Establishment code; "Professional Tax (PT)" — toggle, HrSelect State (Karnataka, Maharashtra, Tamil Nadu, Telangana, Andhra Pradesh, West Bengal, Gujarat, Kerala) and a slab DataTable "Monthly salary ₹15,001 – ₹25,000 | PT / month ₹200"; "Labour Welfare Fund (LWF)" — toggle, Employee amount (₹) 20, Employer amount (₹) 40; "Payroll Cycle & LOP" — Cycle start day 1, Cycle end day 31, Processing day 28, toggle "Sandwich rule (weekend between LOP days becomes LOP)", "Late-mark LOP threshold" with hint "Every N late marks = 1 LOP day. Leave blank to disable."
Use Field/Input/Label from the generic kit inside the cards; toggles are switches with the emerald on-state.
States: SkeletonCard while loading; read-only variant (inputs disabled, no save bar) for viewers without payroll.settings.update; success toast "Payroll settings saved".
Keep the card grouping. Change: no "configuration only" disclaimer — these rules drive the engine.
```

---

## Salary Components (Payroll Configuration)  `/hrms/payroll/components`
- **File:** `modules/hrms/payroll/SalaryComponents.tsx`  ·  **Sidebar:** Master › Payroll Configuration  ·  **Roles:** sidebar `R_FIN_META` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD, HR_MANAGER); route `RouteGuard anyOf [payroll.components.read]`; write actions need `payroll.components.manage`.
- **Status:** LIVE — `useSalaryComponents → GET /v1/payroll/components`, `useSeedDefaultComponents → POST …/seed-defaults`, `useCreateComponent → POST …`, `useUpdateComponent → PUT …/{id}`, `useDeleteComponent → DELETE …/{id}`.

### Purpose
Finance/HR maintains the catalog of pay heads (earnings, deductions, employer contributions, reimbursements) that salary structures and the payroll engine use — seed Indian defaults, add custom heads, edit or delete non-system ones.

### Layout
1. `HrPageHeader` — crumb "Payroll", title "Salary Components", subtitle "The catalog of earnings, deductions and statutory components.", action (`Can payroll.components.manage`, only when data exists) `HrButton` "+ Add Component".
2. First-run: `EmptyState icon={Wallet}` title "No salary components", description "Seed the standard Indian payroll components to get started.", action "Seed default components" / "Seeding…".
3. `HrTabs`: All | Earnings | Deductions | Employer | Reimbursements (client-side category filter).
4. `HrTabPanel` › `TableCard` › `DataTable`: Code (mono, tertiary), Name (bold), Category (`HrStatusPill` EARNING ok / DEDUCTION red / EMPLOYER CONTRIBUTION info / REIMBURSEMENT gray), Statutory (`HrStatusPill warn` "Statutory" or "—"), Computation (sentence-case `computationType` + "(40%)" when percent), actions column (only with `manage`, only for non-`isSystem` rows): icon buttons Edit (pencil) / Delete (trash, immediate, no confirm).
5. `HrDrawer` "Add Component" / "Edit Component": Code * (uppercase, disabled on edit, placeholder "e.g. HRA"), Display Order (100), Name * ("e.g. House Rent Allowance"), Category `HrSelect` (Earning / Deduction / Employer Contribution / Reimbursement), Computation `HrSelect` (FIXED / PERCENT OF BASIC / FORMULA / STATUTORY), "Percent of Basic (%)" when PERCENT_OF_BASIC, checkboxes Taxable (default on) / Statutory; footer raw buttons "Cancel" and "Create Component" / "Save Changes" / "Saving...".

### Data shown
- `GET /v1/payroll/components` → `SalaryComponent {id, code, name, category, isStatutory, isTaxable, computationType, percentValue, displayOrder, isSystem, isActive}`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Seed default components | EmptyState | `POST /v1/payroll/components/seed-defaults` → toast "Seeded N components" | any viewer (not gated by `Can`) | LIVE |
| + Add Component | header | opens Add drawer | `payroll.components.manage` | LIVE |
| Tabs All/Earnings/Deductions/Employer/Reimbursements | HrTabs | client filter | read | LIVE |
| Edit (pencil) | row | opens Edit drawer (code locked) | manage, non-system rows | LIVE |
| Delete (trash) | row | `DELETE /v1/payroll/components/{id}` immediately → toast "Component deleted"; no confirm dialog | manage, non-system rows | LIVE (UX risk) |
| Cancel | drawer footer | close | manage | LIVE |
| Create Component / Save Changes | drawer footer | validates Code+Name → `POST` / `PUT` → toast "Component created" / "Component updated" | manage | LIVE |

### States
- loading: `DataTable loading`.
- empty: catalog empty → `EmptyState` (above); category empty → "No components in this category."
- error: toasts on seed/create/update/delete failure.
- special: system components (`isSystem`) show no actions; `isActive` is never displayed.
- no-permission: "Access Restricted"; write controls hidden.

### Rules & permissions
- Code and Name required; code forced uppercase and immutable after creation; `percentValue` only sent for PERCENT_OF_BASIC; displayOrder defaults 100.
- Seed button is not wrapped in `Can` (server enforces).
- Delete has no confirmation (conventions say destructive confirms go through `useConfirmDialog()`).

### Gaps & plan
- **Keep:** seed-defaults first-run, category tabs, drawer form; [FUNCTIONALITY_AUDIT row] "/hrms/payroll-* and /hrms/payroll/* … Payroll controllers; payroll runs/payslips/components/batches … Real overview/history; process/lock tests".
- **Add:** show `isActive` state and an activate/deactivate control (field exists in DTO, unused); [BLUEPRINT §6 row 28] TDS component/computation is the only path to a TDS figure today.
- **Change:** delete should confirm via `ConfirmDialogProvider`; drawer footer uses raw `<button>`s — use `Button`; FORMULA computation type has no formula input (selecting it stores nothing extra); Category pill label uses single `replace('_',' ')`; the seed action is unguarded client-side.

### Screenshot
`Attach: /hrms/payroll/components — current screen`

### Claude Design prompt (ready to paste)
```
Design the Salary Components catalog page for OWNER / COMPANY_ADMIN / FINANCE_LEAD / HR_MANAGER, crumb "Master / Payroll Configuration".
HrPageHeader: title "Salary Components", subtitle "The catalog of earnings, deductions and statutory components.", action HrButton "+ Add Component".
HrTabs with badge counts: All (14) | Earnings (6) | Deductions (4) | Employer (2) | Reimbursements (2).
TableCard → DataTable: Code "HRA" (mono), Name "House Rent Allowance" (bold), Category HrStatusPill (EARNING ok, DEDUCTION red, EMPLOYER CONTRIBUTION info, REIMBURSEMENT gray), Statutory pill warn "Statutory" or "—", Computation "Percent of basic (40%)" / "Fixed" / "Statutory", Active pill (ok Active / gray Inactive), row actions Edit / Delete icons for non-system rows only (system rows show a lock hint "System").
HrDrawer "Add Component" / "Edit Component" (max-w-lg): Code * (uppercase, locked on edit), Display Order 100, Name *, HrSelect Category, HrSelect Computation (Fixed / Percent of basic / Formula / Statutory), "Percent of Basic (%)" 40 shown for percent type, checkboxes Taxable (on) and Statutory; footer Button ghost "Cancel", primary "Create Component" / "Save Changes".
First-run EmptyState (icon Wallet): "No salary components — Seed the standard Indian payroll components to get started." with action "Seed default components".
Delete goes through a confirm dialog "Delete component HRA? Structures using it keep their history." Toasts: "Component created", "Component updated", "Component deleted", "Seeded 14 components".
Keep tabs + drawer. Change: confirm before delete, surface Active/Inactive.
```

---

## Production-Linked Incentive (Incentive Center)  `/hrms/pli`
- **File:** `modules/hrms/Pli.tsx`  ·  **Sidebar:** Payroll › Production-Linked Incentive  ·  **Roles:** sidebar `R_FIN_META`; route `RouteGuard anyOf [hrms.pli.read, hrms.pli.write, hrms.pli.read.self]` — so EMPLOYEE/DEPT_MANAGER (read.self) can open it by URL but have no sidebar entry. Tabs: Monthly Targets + All Awards need `hrms.pli.read`; My Incentives needs `hrms.pli.read.self`; forms/approve/pay need `hrms.pli.write`.
- **Status:** LIVE — `usePliTargets → GET /v1/pli/targets`, `useCreatePliTarget → POST /v1/pli/targets`, `useAllAwards → GET /v1/pli/awards?page&size=20`, `useCreateAward → POST /v1/pli/awards`, `usePliDecision → POST /v1/pli/awards/{id}/decision {approved}`, `usePayAward → POST /v1/pli/awards/{id}/pay`, `useMyIncentives → GET /v1/pli/my`. (The "Static Components (Phase 5)" comment is stale — targets are persisted per HANDOFF §5.)

### Purpose
Finance/HR sets monthly production targets per team, proposes incentive awards to employees, approves/rejects and marks them paid; employees see their own incentive history.

### Layout
1. `HrPageHeader` — crumb "Performance-Linked Incentive" (inconsistent with sidebar "Production-Linked Incentive" and the "Payroll" crumb elsewhere), title "Incentive Center", subtitle "Propose, approve, and pay out performance-linked incentives". No actions.
2. `HrTabs`: "Monthly Targets" | "All Awards" | "My Incentives" (permission-filtered).
3. **Monthly Targets tab:** info `.ut-card` "PLI targets below are stored in the backend and can be used while calculating incentive awards."; inline `.ut-card` form (write only): Team / target name ("Assembly Line A"), Period (`type=month`), Metric ("Gross Profit"), Target, Actual, Bonus pool, `HrButton sm` "+ Set Target"; `TableCard` › `hr-table` Department/Team, Metric, Period, Target, Actual (green ≥100% else red), Achievement (`HrStatusPill` ok ≥100 / warn ≥80 / gray), Bonus Pool (`inr`), Status (`teal` ACTIVE / gray); `hrPaginationFooter` 20/page.
4. **All Awards tab:** `.ut-card` "Propose Incentive Award" form (write only): Company select (if >1), Employee * (select from directory, 200 max), Plan name * ("Q3 Sales Incentive"), Period ("FY24-Q3"), Amount (₹) * ("25000"), Rating basis (0–5, "4.5"), Notes; `HrButton` "+ Propose Award". `TableCard` › `hr-table` Employee (`HrAvatar name sub=code`), Plan, Period, Amount, Status (`HrStatusPill` PROPOSED warn / APPROVED ok / PAID teal / REJECTED red), Action (write only): PROPOSED → `HrButton sm` "✓ Approve" + ghost "✕ Reject"; APPROVED → "Pay"; pagination footer.
5. **My Incentives tab:** KPI strip 4 × `HrStatCard`: Total Awards (blue, `totalElements`), Proposed (orange), Approved (green), Paid Out (teal, `inr`) — last three sub "On this page" when paginated; `TableCard` › `hr-table` Plan, Period, Amount, Status, Awarded (`createdAt` d MMM yyyy); pagination.

### Data shown
- Targets: `GET /v1/pli/targets?page&size=20` → `PliTarget {title, metric, period, targetValue, actualValue, payoutAmount, status}`.
- Awards: `GET /v1/pli/awards?page&size=20` → `PliAward {employeeName, employeeCode, planName, period, amount, ratingBasis, status, notes, createdAt}`.
- My: `GET /v1/pli/my?page&size=20`.
- Directory for the picker: `useEmployeeDirectory({companyId, pageSize: 200})`; companies `useCompanies`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tabs Monthly Targets / All Awards / My Incentives | HrTabs | switch; default "all" if `pli.read` else "my" | per permission | LIVE |
| Set Target | targets form | validates title + target>0 → `POST /v1/pli/targets` (status ACTIVE) → toast "PLI target created" | `hrms.pli.write` | LIVE |
| Company select | award form | scopes employee picker | write | LIVE |
| Propose Award | award form | validates employee, plan name, amount>0 → `POST /v1/pli/awards` → toast "Incentive award proposed", reset | write | LIVE |
| Approve | award row (PROPOSED) | `POST /awards/{id}/decision {approved:true}` → toast "Award approved" | write | LIVE |
| Reject | award row (PROPOSED) | `{approved:false}` → toast "Award rejected"; no reason captured | write | LIVE |
| Pay | award row (APPROVED) | `POST /awards/{id}/pay` → toast "Award marked paid" | write | LIVE |
| Pagination | all three tables | `hrPaginationFooter` | — | LIVE |
| Edit / close target, view award notes | — | not present | — | Missing |

### States
- loading: skeleton rows (4 / 3) in tables; `HrStatCard loading`.
- empty: targets "No PLI targets yet / Create targets to track incentive eligibility."; awards "No incentive awards yet / Use the form above to propose the first award." (write) or "Proposed awards will appear here."; my "No incentives yet / Performance-linked incentives awarded to you will appear here."
- error: toasts on mutations; list errors unhandled.
- special: KPI sub "On this page" when more than one page (no aggregate endpoint).
- no-permission: "Access Restricted" if none of the three codes.

### Rules & permissions
- Award lifecycle PROPOSED → APPROVED/REJECTED → PAID; approve/reject/pay all under one `hrms.pli.write` (proposer can approve own proposal — no segregation).
- Rating basis 0–5; amount > 0; target > 0; achievement % computed client-side.
- "Pay" here does not touch the payroll run/bank batch (no link in code).

### Gaps & plan
- **Keep:** three-tab structure and award lifecycle actions; [FUNCTIONALITY_AUDIT row] "/hrms/pli … Persisted target UI and existing award workflows"; [HANDOFF §5] "Expense statistics and PLI targets use real APIs".
- **Add:** [BLUEPRINT §6 row 30] "PLI — Partial — Complete"; [PLAN §12] "PLI — Complete the screen": target edit/close, award notes/rating visible in the table, reject reason, link paid awards into a payroll run; awards list filters (status/period) — `useAllAwards` has none.
- **Change:** crumb "Performance-Linked Incentive" vs sidebar "Production-Linked Incentive" vs title "Incentive Center" — pick one; the two create forms are always-open cards above the tables — move to `HrDrawer` opened from `HrPageHeader` actions ("+ Propose Award", "+ Set Target"); tables are raw `hr-table`, not `DataTable`; stale "Static Components (Phase 5)" comment; Employee picker is a 200-item native select.

### Screenshot
`Attach: /hrms/pli — current screen`

### Claude Design prompt (ready to paste)
```
Design the Production-Linked Incentive page for OWNER / COMPANY_ADMIN / FINANCE_LEAD / HR_MANAGER (admin view) and EMPLOYEE (My Incentives only), crumb "Payroll".
HrPageHeader: title "Production-Linked Incentive", subtitle "Propose, approve, and pay out performance-linked incentives", actions HrButton "+ Propose Award" and ghost "+ Set Target" (write only); HrTabs "Monthly Targets" | "All Awards" (badge 12) | "My Incentives".
Monthly Targets: TableCard → DataTable Department/Team "Assembly Line A", Metric "Gross Profit", Period "Sep 2026", Target 12,00,000, Actual 13,10,000 (green when ≥ target), Achievement HrStatusPill "109%" (ok ≥100, warn ≥80, gray), Bonus Pool ₹2,50,000, Status pill ACTIVE teal; HrPagination 20/page; empty "No PLI targets yet — Create targets to track incentive eligibility."
All Awards: FilterBar Status / Period; DataTable Employee (HrAvatar "Priya Mehta" sub "EMP-0142"), Plan "Q3 Sales Incentive", Period "FY26-Q2", Amount ₹25,000, Rating 4.5, Status pill (PROPOSED warn, APPROVED ok, PAID teal, REJECTED red), row actions: PROPOSED → HrButton sm "Approve" + ghost "Reject" (reject opens a reason modal); APPROVED → "Pay"; empty "No incentive awards yet".
HrDrawer "Propose Incentive Award": HrSelect Company, Employee search, Plan name *, Period, Amount (₹) *, Rating basis 0–5, Notes; footer Cancel / "Propose Award". HrDrawer "Set Target": Team / target name, Period (month), Metric, Target, Actual, Bonus pool; footer Cancel / "Set Target".
My Incentives: KPI strip HrStatCard Total Awards 6 (blue), Proposed 1 (orange), Approved 2 (green), Paid Out ₹75,000 (teal); table Plan / Period / Amount / Status / Awarded "18 Sep 2026"; empty "No incentives yet — Performance-linked incentives awarded to you will appear here."
Keep the three tabs and lifecycle. Change: forms move into drawers, one consistent name everywhere.
```

---

## Bank Disbursement  `/hrms/bank-disbursement`
- **File:** `modules/hrms/payroll/BankDisbursement.tsx` (+ `payroll/DisbursementHistory.tsx`)  ·  **Sidebar:** Payroll › Bank Disbursement  ·  **Roles:** sidebar `R_FIN_RUPEE`; route `RequirePermission payroll.runs.read` + `RouteGuard anyOf [payroll.runs.read]`. Blocks gated by `hrms.bank_profile.read/manage`, `hrms.disbursement.read/build/post` (granted to OWNER, SUPER_ADMIN, FINANCE_LEAD by `V090__wave2_6_permission_backfill.sql`; the file comment says "V093/V094" — stale). COMPANY_ADMIN/ADMIN reach the page via the sidebar but hold none of these codes by default, so they see only the selectors, KPIs, chart and table.
- **Status:** LIVE — `useRuns`, `useRunEmployees → GET /v1/payroll/runs/{id}/employees`, `useBankProfiles → GET /v1/payroll/bank-profiles?companyId`, create/update/delete profile (`POST/PUT/DELETE /v1/payroll/bank-profiles[/{id}]`), `useDisbursementBatches → GET /v1/payroll/disbursement/batches?runId`, `useDisbursementBatch → GET …/batches/{id}`, `useBuildBatch → POST …/batches`, `useDownloadBatchFile → GET …/batches/{id}/file` (side-effect DRAFT→POSTED), `useMarkBatchPaid → POST …/batches/{id}/mark-paid {paymentReference}`, `useCancelBatch → POST …/batches/{id}/cancel`. Uses `window.confirm` / `window.prompt` for confirmations and the UTR.

### Purpose
Finance pays a locked payroll run: maintain the company's debit bank profiles, build a disbursement batch for the run, download the NEFT/RTGS file (which posts the batch), record the bank UTR to mark it paid (which flips the run to PAID), or cancel and rebuild; plus review historical batches and their payment lines.

### Layout
1. `HrPageHeader` — crumb "Payroll", title "Bank Disbursement", subtitle "Review payroll amounts, bank readiness and recorded payments.", action `HrButton ghost` "⬇ Export advice" (only when `payroll.runs.read` and a run with rows is selected).
2. Selector row (native selects with uppercase labels): "Company" (All companies + list), "Payroll run" ("Sep 2026 · Acme · LOCKED"; auto-picks a PAID/LOCKED run).
3. Dashed empty card (no run): `Landmark` icon, "No payroll run selected", "Create and process a payroll run to generate a bank advice." / "Choose a run above to see its disbursement advice."
4. `.ut-card` "Bank profiles" (needs `bank_profile.read` + a company — the Company select or the selected run's `companyId`): sub "Debit accounts used to generate the bank's NEFT/RTGS file. At least one profile is required to build a disbursement batch."; `HrButton sm` "+ Add profile" / ghost "+ Close" (`manage` only); inline form "New bank profile" / "Edit bank profile": Profile name * ("e.g. HDFC Payroll Salary A/C"), Bank format * (native select with "Generic CSV" as the only option; when editing a profile stored with another format that value shows once as a disabled "… (unsupported)" option), Debit account no *, IFSC * (mono, 11 chars, "HDFC0001234"), Corporate ID, checkbox "Make default for this company"; footer `HrButton sm ghost` "Cancel" (edit only) + "Save profile"/"Save changes"; compact `hr-table` Profile (+ "(inactive)"), Format, Account · IFSC ("…4321 · HDFC0001234"), Default (`HrStatusPill ok`), Action icons Edit / Power (activate/deactivate) / Delete.
5. `.ut-card` "Disbursement batch" (needs any disbursement code): status sentence ("Batch BATCH-2026-09-001 · 248 beneficiaries · ₹1,05,40,000" / "No batch built yet — pick a bank profile and click Build." / "Payroll run is DRAFT. Only LOCKED runs can be disbursed."), `HrStatusPill` batch status (DRAFT gray / POSTED info / PAID ok / CANCELLED red); controls: Bank profile select + `HrButton` "+ Build batch" (no batch yet, `build`); `HrButton` "⬇ Download bank file (posts batch)" / "Re-download bank file" (DRAFT/POSTED, `build`; disabled when 0 beneficiaries or any line is not READY); ghost "Rebuild batch" (DRAFT, `build`); primary "✓ Mark paid (UTR)" (POSTED, `post`); ghost "✕ Cancel batch" (DRAFT/POSTED, `post`); amber note when any batch line is not READY; "Paid on 18 Sep 2026, 6:02 pm · UTR HDFCN52026091812345" when `paymentReference` is set.
6. KPI strip 4 × `HrStatCard`: "Payroll net total"/"Batch total"/"Payment recorded" (green, sub period), "Employees in payroll"/"Bank beneficiaries" (blue, sub "payment not yet prepared"/"ready for payment"/"payment recorded"), "Average net pay"/"Average batch amount" (teal), "Run Status" (purple, value is an `HrStatusPill`, sub "1 Sep – 30 Sep 2026").
7. `.ut-card` "Net-pay distribution" `BarChart` by bands < 25k / 25–50k / 50–75k / 75k–1L / > 1L.
8. `TableCard search="Search employee or code…"` › `hr-table` (with a batch: intro line "Bank batch details. Skipped employees are excluded from the batch amount; correct their bank details and rebuild a draft batch."): Employee (`Link` to `/hrms/employees/:id` › `HrAvatar name sub=code` — sub "View employee" when the batch line has no matching payroll row; red `failureReason` under it), Code, Paid Days, LOP, [batch only: Bank account "•••• 4321" or "Not available", Payment status pill Ready info / Payment recorded ok (batch PAID) / Skipped red (line status `SKIPPED*`)], Net Pay (right); footer "{n} of {m} employees · Payroll total / Batch total ₹…".
9. `DisbursementHistory` section `.ut-card` "Historical batches": `hr-table` Batch, Created (`toLocaleDateString()`), Total amount, Beneficiaries, Status (PAID ok / else gray), Details `HrButton ghost` "View details"; inline "Batch details" panel: "BATCH-… · Payment reference: …", table Employee / Account / Amount / Status (+ failure reason), ghost "Close".

### Data shown
- Runs `GET /v1/payroll/runs?companyId`; rows `GET /v1/payroll/runs/{id}/employees` (`employeeCode, employeeName, paidDays, lopDays, netPay`).
- Profiles `GET /v1/payroll/bank-profiles?companyId` → `BankProfile {profileName, bankFormat, corporateId, debitAccountNo, ifsc, isDefault, isActive}`.
- Batches `GET /v1/payroll/disbursement/batches?runId` → `DisbursementBatch {batchReference, totalAmount, beneficiaryCount, status, paidAt, paymentReference}`; detail `GET …/batches/{id}` → `{batch, lines[{beneficiaryName, accountNoMasked, accountNoLast4, ifsc, amount, status, failureReason}]}`.
- History: `GET /v1/payroll/disbursement/batches?companyId` (all statuses) + detail.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Export advice | header | browser-generated CSV `bank-advice-Sep-2026.csv` (Code, Name, Paid Days, LOP Days, Net Pay) → toast "Bank advice exported" | `payroll.runs.read` | LIVE (client-side only) |
| Company select / Payroll run select | selectors | scopes runs, profiles, batches | read | LIVE |
| + Add profile / Close | profiles card | toggles inline form | `hrms.bank_profile.manage` | LIVE |
| Save profile | profile form | validates name, account, IFSC regex, format GENERIC_CSV, company chosen (toast "Pick a company first") → `POST /bank-profiles` → toast "Bank profile added" | manage | LIVE |
| Save changes / Cancel | profile form (edit) | `PUT /bank-profiles/{id}` → "Bank profile updated" | manage | LIVE |
| Edit (pencil) | profile row | loads row into form | manage | LIVE |
| Activate / Deactivate (power) | profile row | `window.confirm` on deactivate → `PUT {isActive}` → toast `"{name}" deactivated` / `activated` | manage | LIVE |
| Delete (trash) | profile row | `window.confirm` → `DELETE /bank-profiles/{id}` → "Bank profile deleted" (server refuses if referenced) | manage | LIVE |
| Bank profile select | batch card (no batch) | chooses an active Generic CSV profile; auto-picks the default, else the first | `hrms.disbursement.build` | LIVE |
| Build batch | batch card (no batch) | requires LOCKED run (toast "Only a LOCKED payroll run can be disbursed. Lock the run first.") → `POST /disbursement/batches {runId, bankProfileId}` → "Disbursement batch built" | build | LIVE |
| Download bank file (posts batch) / Re-download | batch card (DRAFT/POSTED) | `GET …/batches/{id}/file` blob `bank-file-Sep-2026.csv`; server flips DRAFT→POSTED → toast "Bank file downloaded — batch is now POSTED"; disabled if 0 beneficiaries or any line is not READY | build | LIVE |
| Rebuild batch | batch card (DRAFT) | re-`POST` build with same profile → "Batch refreshed from current employee bank details" | build | LIVE |
| Mark paid (UTR) | batch card (POSTED) | `window.prompt` "Bank UTR / payment reference (required):" (blank → toast "UTR is required to mark paid") → `POST …/mark-paid {paymentReference}` → "Marked paid — payroll run is now PAID"; disabled while any line is not READY | `hrms.disbursement.post` | LIVE |
| Cancel batch | batch card (DRAFT/POSTED) | `window.confirm` → `POST …/cancel` → "Batch cancelled" | post | LIVE |
| Try again | batch / table errors | refetch | — | LIVE |
| Search employee or code… | table toolbar | client filter | read | LIVE |
| Employee name | table row | `Link` → `/hrms/employees/:id` | read | LIVE |
| View details / Close | history | loads `GET …/batches/{id}` inline | `hrms.disbursement.read` | LIVE |
| Retry | history errors | refetch | read | LIVE |

### States
- loading: run select "Loading runs…"; "Loading batch state..." / "Loading bank batches..."; 6 skeleton rows; `HrStatCard loading`; history "Loading batches..." / "Loading payment lines...".
- empty: no run (dashed card, copy above); profiles "No bank profiles for this company yet."; profile select "Add an active Generic CSV profile"; table "No payslips in this run — Process the run to generate net-pay figures." (DRAFT) / "No employee payment lines are available for this period." / batch "No employees in this bank batch"; search "No matches — Try a different name or code."; history "No bank batches have been created."
- error: "Batch state could not be loaded." + "Unable to load existing bank batches." Try again; "Unable to load bank batch details / payroll employees."; history "Unable to load batch history." / "Unable to load payment lines."
- special: run not LOCKED → "Payroll run is {status}. Only LOCKED runs can be disbursed."; any non-READY line → amber "Some employees are excluded. Correct their bank details and rebuild the draft before downloading a bank file or recording payment…"; PAID batch → "Paid on … · UTR …", KPI label "Payment recorded".
- no-permission: redirect `/me`; sub-blocks hidden per code.

### Rules & permissions
- Only LOCKED runs can be disbursed; one live (non-CANCELLED) batch per run; download is side-effecting (DRAFT→POSTED); mark-paid needs POSTED + non-empty UTR and flips the payroll run to PAID; PAID/CANCELLED batches cannot be cancelled.
- Bank profile: IFSC must match `^[A-Z]{4}0[A-Z0-9]{6}$`; only GENERIC_CSV is accepted client-side ("other bank formats are not supported") though the API type lists HDFC_FIXED / ICICI_CIB / SBI_CORP; profiles referenced by a batch cannot be deleted (deactivate instead); one default per company.
- Profile picker lists active Generic CSV profiles only; edits never resend `isActive`.

### Gaps & plan
- **Keep:** the profile → build → download(post) → mark-paid → PAID chain and the history section; [BLUEPRINT §6 row 32] "Works — Batches + file — Keep"; [PLAN §12] "Bank Disbursement — Keep"; [HANDOFF §5 / STATUS] "Bank history — Existing disbursement batch/history/detail APIs reused" (closes the [FUNCTIONALITY_AUDIT] "Historical batches block is marked Phase 5 Static" item).
- **Add:** bank formats beyond Generic CSV (code: `BANK_FORMATS` has 4, UI allows 1 — "unsupported"); [BLUEPRINT §15] "[Fix]" action for lines with `failureReason` (currently text only); [HANDOFF §12 / STATUS] real bank provider delivery is "not verified" — UI should not imply transfer, only file + UTR record; disbursement history filters (company only today).
- **Change:** replace `window.prompt` (UTR) and `window.confirm` (cancel/deactivate/delete) with `Modal` / `useConfirmDialog()`; the inline profile form should be an `HrDrawer`; "Export advice" is a browser CSV separate from the server bank file — rename to "Export net-pay CSV" or drop; page is long (profiles + batch + KPIs + chart + table + history) — the KPI strip sits below two setup cards, inverting the list-screen anatomy; history table uses `toLocaleDateString()` (locale-dependent) and raw `hr-table`; PAID/CANCELLED history tones collapse to ok/gray; the Run Status pill maps LOCKED to `purple` here (`STATUS_TONE` in `BankDisbursement.tsx`) while the dashboard uses `teal` and the runs list `ok` — unify.

### Screenshot
`Attach: /hrms/bank-disbursement — current screen`

### Claude Design prompt (ready to paste)
```
Design the Bank Disbursement page for OWNER / COMPANY_ADMIN / FINANCE_LEAD, crumb "Payroll".
HrPageHeader: title "Bank Disbursement", subtitle "Review payroll amounts, bank readiness and recorded payments."; filters slot: HrSelect Company "All companies" + HrSelect Payroll run "Sep 2026 · Acme Industries · LOCKED"; actions: ghost "Manage bank profiles" (opens an HrDrawer listing profiles with Add / Edit / Deactivate / Delete) and ghost "Export net-pay CSV".
Stepper card "Disbursement batch": step pills Build → Download file (posts) → Mark paid; status line "Batch BATCH-2026-09-001 · 248 beneficiaries · ₹1,05,40,000" with HrStatusPill DRAFT gray / POSTED info / PAID ok / CANCELLED red; controls by state — none: HrSelect Bank profile "HDFC Payroll Salary A/C · …4321" + primary "Build batch" (disabled with hint "Only LOCKED runs can be disbursed" when run is DRAFT/PROCESSING); DRAFT: primary "Download bank file (posts batch)", ghost "Rebuild batch", ghost "Cancel batch"; POSTED: primary "Mark paid (UTR)" opening a Modal with required "Bank UTR / payment reference", ghost "Re-download bank file", ghost "Cancel batch"; PAID: "Paid on 18 Sep 2026, 6:02 pm · UTR HDFCN52026091812345". Warn banner "Some employees are excluded. Correct their bank details and rebuild the draft…" when any line is Skipped.
KPI strip 4 HrStatCard: Batch total ₹1,05,40,000 (green, sub "Sep 2026"), Bank beneficiaries 248 (blue, sub "ready for payment"), Average batch amount ₹42,500 (teal), Run Status pill LOCKED (purple, sub "1 Sep – 30 Sep 2026").
ut-card "Net-pay distribution" bar chart bands < 25k / 25–50k / 50–75k / 75k–1L / > 1L.
TableCard search "Search employee or code…" → DataTable Employee (HrAvatar "Priya Mehta" sub "EMP-0142", link to profile), Paid Days 26, LOP 0, Bank account "•••• 4321", Payment status pill (Ready info / Payment recorded ok / Skipped red with reason "No bank account on file" and a "Fix" ghost button), Net Pay ₹93,800 right-aligned; footer "248 of 248 employees · Batch total ₹1,05,40,000".
HrTabs or lower section "Historical batches": DataTable Batch, Created "18 Sep 2026", Total amount, Beneficiaries, Status pill, row "View details" opening an HrDrawer with the payment lines (Employee / Account / Amount / Status).
Bank profile drawer form: Profile name *, Bank format (Generic CSV; HDFC / ICICI CIB / SBI Corporate shown disabled "coming soon"), Debit account no *, IFSC * (mono, "HDFC0001234"), Corporate ID, checkbox "Make default for this company".
States: empty "No payroll run selected — Create and process a payroll run to generate a bank advice."; table empty "No payslips in this run — Process the run to generate net-pay figures."; errors with "Try again".
Keep the build → post → paid chain. Change: no window.prompt/confirm — use Modal and the confirm dialog; profiles live in a drawer so the KPI strip sits directly under the header.
```
