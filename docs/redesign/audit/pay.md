# Audit: Payroll, Expenses and Full & final (`PgPay.dc.html`)

Phase 0, read-only. Repo `C:\REACT\unifiedtree-saas` at `e32a4dc6`.
Prototype: `design_handoff_hrms_redesign/prototype/PgPay.dc.html` (all line numbers below are in that file unless another file is named), its nav model `hrms-core.js` (lines 47, 51, 54–55, 124, 262) and its section renderer `UtSections.dc.html` / `UtSection.dc.html`.

**Status words used in the tables**
- **exists**: served today by the named hook and endpoint.
- **partial**: served, but part of what the design shows is missing (the table says which part).
- **missing**: no endpoint or field today.

The local API (127.0.0.1:8080) and the recovery database (port 55432) were **not running** during this audit. Nothing was checked live. Endpoints, permissions and tables come from reading the controllers, services, entities and Flyway migrations.

---

## 0. What PgPay covers and where each page lives today

| Page key | Page (tabs in the design) | Prototype lines | Route today | Files today | Page exists? |
|---|---|---|---|---|---|
| `py-dash` | Payroll dashboard | 67–73 | `/hrms/payroll-dashboard` (`/payroll` redirects here) | `modules/hrms/payroll/PayrollContainer.tsx` (section `dashboard`), `design/dc/PayDashboard.tsx` + `.view.tsx` | Yes |
| `py-runs` | Processing & payslips (All runs · Overview · Employees · Skipped) | 74–83; payslip view 166–168 | `/hrms/payroll/runs`, `/hrms/payroll/runs/:id?tab=…` | `PayrollContainer.tsx` (`runs`), `design/dc/PayRuns.tsx`, `PayrollRunPage.tsx`, `PayrollEmployees.tsx`, `PayslipDrawer.tsx`, `NewRunModal.tsx` | Yes. **Overview is drawn by `PgPayroll.dc.html`** (`hrms-core.js` line 262: `py-runs` with `tab !== 1` goes to PgPay). The "Payroll run" auditor covers Overview. PgPay draws All runs, Employees and Skipped. |
| `py-struct` | Salary structure | 84–87; views `brk`, `struct`, `bulk` 170–178 | `/hrms/salary-structure` (`?employee=`) | `design/dc/PaySalary.tsx` | Yes |
| `py-settings` | Payroll settings | 88–97 | `/hrms/payroll/settings` (`/hrms/settings/payroll` → MovedTo) | `design/dc/PaySettings.tsx` | Yes |
| `py-pli` | Production-linked incentive (All awards · Monthly targets · My incentives) | 98–108; views `pli-new`, `pli-targets` 179–180 | `/hrms/pli` | Admins: `design/dc/PayPli.tsx` (targets), plus `Pli.tsx` `AllAwardsTab` opened in an `HrDrawer` by "Manage awards". Others: `Pli.tsx` (My incentives). | Partly. The awards list is a drawer, not a tab. Admins have no "My incentives" view. |
| `py-adv` | Advances & loans (Company advances · My advances · Request an advance) | 109–118; views `adv`, `adv-issue` 181–187 | `/hrms/advances` (`?tab=`) | With `hrms.advance.read`: `design/dc/PayAdvances.tsx` + `advance/AdvanceAdmin.tsx` (`AdvanceDetail`, `RecoveryDetails`, `AdvanceDecisionActions`). Everyone else: `Advance.tsx` (Approvals · My advances · Request an advance · Company/Assigned advances). | Partly. The admin page has no My advances or Request tab. |
| `py-bank` | Bank disbursement (Current file · Past files · Bank profiles) | 119–130; view `batch` 188–190 | `/hrms/bank-disbursement` (`?run=`), `/hrms/bank-disbursement/setup` | `design/dc/PayBank.tsx`; profiles and batch tools in `payroll/BankDisbursement.tsx` + `payroll/DisbursementHistory.tsx` | Partly. Bank profiles are a separate page, not a tab. |
| `e-center` | Expense center (Approvals · My claims · Submit a claim · Reimbursement batches · Policies) | 131–145; views `claim`, `rb`, `rb-build`, `pol` 191–198 | `/hrms/expenses?tab=approvals\|my\|submit\|batches\|policies` | `Expense.tsx`, `expense/ReimbursementBatches.tsx`, `expense/expenseStatus.ts` | Yes: same tabs, same order |
| `x-fnf` | Full & final settlement (Pending approval · Pending payment · Settled · All) | 146–152; views `fnf`, `fnf-new` 199–204 | `/hrms/fnf?tab=pending-approval\|pending-payment\|settled\|all\|create` (`&employeeId=`) | `FullAndFinal.tsx` | Yes. "Create settlement" is a fifth tab today; in the design it's a header button. |
| `me-slips` | My Workspace → Payslips | 153–156; view `myslip` 169 | `/me/payslips` | `payroll/EmployeePayslips.tsx` | Yes. Also designed as `e-slips` in `EmpPay.dc.html`: two designs for one route. |
| `me-salary` | My Workspace → Salary | 157–162 | `/me/salary` | `payroll/MySalaryStructure.tsx` | Yes. Also `e-salary` in `EmpPay.dc.html`. |

**In this area today but not in the design:**
- **Payroll configuration (salary components)** at `/hrms/payroll/components`, in the Master rail group (`MasterModule`, `payroll.components.read`).
- **Statutory settings** at `/hrms/master/statutory` (`payroll.settings.read`).

Neither has a page in PgPay. Both stay where they are, because settings stay in their own sections.

**Hooks and endpoints used across the area:**
- Hooks: `modules/hrms/api/usePayrollRuns.ts`, `usePayroll.ts`, `useDisbursement.ts`, `usePli.ts`, `useAdvance.ts`, `useExpense.ts`, `useExpenseBatches.ts`, `useFnf.ts`, `useCompliance.ts`, `useOrg.ts`, `useWorkforce.ts`.
- `PayrollContainer.tsx` calls most payroll endpoints inline with `apiJson` instead of going through these hooks.
- Backend: `backend/app/hrms-api/src/main/java/com/hrms/api/{payroll,advance,pli,expense,fnf}/*` and `backend/modules/hrms-{pli,advance,expense,fnf}`.

---

## 1. Rules that apply to every PgPay screen

1. **One page frame.** Every page has the same layout:
   - A header: crumb, or a "‹ Page · Tab" back link inside a sub-view; the title (28/34, weight 500); a one-line sub; an optional secondary and primary button.
   - A flex-wrap grid of section cards (`UtSections`), each full or half width. Each card (`UtSection`, 18px radius) has a title, a count badge, a sub, a segmented filter, an action button, then its body.
   - Section kinds: `stats`, `chart`, `steps`, `table`, `kv`, `form`, `bars`, `ledger`, `empty`.
2. **Details and forms are in-page sub-views** in PgPay (`state.view`, lines 45–46, 209–216): the header switches to a Back link and the sections are replaced. They are not side panels. Today the same screens are `HrDrawer` drawers and dialogs. See question 10.
3. **The module's own section bar goes away.**
   - Today `PayrollModule` draws `nav[aria-label="Payroll sections"]` (`design/dc/PayrollModule.tsx`, `SECTIONS`). `PlatformShell` hides the shell's tab row for these paths (`OWN_SECTION_BAR` / `ownsSectionBar`, `layouts/PlatformShell.tsx` ~lines 340–349).
   - In the design, pages come from the top bar's Pages button and a page's tabs are pill tabs.
   - Payroll settings' unsaved-changes guard (`window.__utLeaveGuard`) is only called by `PayrollModule.go()`. It must be wired into the shell's page and tab navigation, or it stops protecting edits.
4. **Frame, font and tokens.**
   - `DesignFrame` hard-codes Inter and a 1320 max width. PgPay uses 1440 and padding `26px clamp(16px,2.4vw,36px) 64px`.
   - The generated views use `fontWeight "700"/"800"`: PayDashboard.view 8×, PayBank.view 4×, PaySalary.view 1×. The hand-written files do too: `MySalaryStructure.tsx` 4×, `PaySalary.tsx` 800, `PaySettings.tsx` 700.
   - They also use hex colours everywhere (PaySettings.view.tsx alone has 192).
   - All of this is replaced by tokens (400/500/600 only, light and dark).
   - `apps/platform/scripts/design-build.mjs` regenerates these views from the old `docs/Designs` export, with patches for `PayDashboard`, `PaySalary`, `PaySettings`, `PayPli`, `PayBank`, `PayrollRunPage` and `PayrollModule`. Retire those entries, or a manual run overwrites the new pages.
5. **Menus are permission-only** (PlatformShell: "The `visibleForRoles` lists above are no longer read"; `isVisible` → `menuRule`). The `R_FIN_RUPEE` comment ("HR is not welcome on rupee screens") no longer has any effect. Keep it that way: never gate by role.
6. **URLs.**
   - Keep `?tab=` for Expenses (pageRegistry tabs; `pageRegistry.test.ts` asserts `expenses: 'tab'`, `fnf: 'tab'`), for Advances (`Advance.tsx` uses `useView(…, 'tab')`) and for F&F.
   - `Pli.tsx` uses `?view=` today (the `useView` default).
   - The new PLI, Advances and Bank tabs should use one parameter and be added to `pageRegistry.ts` as `tab(...)` entries, updating the test's parameter map.
7. **Companies.**
   - Runs, bank profiles, batches, expense policies and PLI targets are per company. Forms show a Company select only when there is more than one company (keep this).
   - Pickers should leave out archived companies (the Inactive-view rule).
   - Payroll dashboard figures are for **one** company's run today (see 2.1).
8. **Dates.** Every date or month field must use `src/shared/components/calendar` (`DateField` / `MonthField`), not the prototype's `<input type=date>`: effective from, bulk-revise date, PLI period and month, batch cutoff, expense date, first-deduction month. `live-w3-r4.mjs` checks the expense and batch pickers.
9. **States.** Every section needs a skeleton, an empty state (the prototype gives the `emptyT`/`emptyS` copy) and an error state with Retry. Most current pages already have these; keep them.

---

## 2. Screens

### 2.1 Payroll dashboard (`py-dash`, lines 67–73)

**Route and files:**
- Route: `/hrms/payroll-dashboard`.
- Files: `PayrollContainer.tsx` (the `section === 'dashboard'` block, lines 244–277) and `design/dc/PayDashboard.tsx` + `.view.tsx`.
- The page exists.
- Tabs: none, so the top bar shows one solid pill, "Payroll dashboard".

| # | Data point in the design | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | Section title = this month ("September 2026") | client date (`istToday`) | exists | — |
| 2 | **Payroll cost**, gross for the month | `runsQ` → `GET /v1/payroll/runs` (`thisMonthRun.totalGross`) | partial: only **one company's** run is used (`sorted.find(...)`); with several companies the others are ignored | `payroll.runs.read` |
| 3 | Change vs last month ("up 2.1% on August") | runs (`prev.totalGross`) | partial: same single-company issue | `payroll.runs.read` |
| 4 | **Average salary** (gross ÷ employees) | runs | partial: same | `payroll.runs.read` |
| 5 | **Pending disbursals** as an amount (₹53.8L), note "<month> run · after lock" | `GET /v1/payroll/dashboard/kpis` → `pendingDisbursals` | partial: the API returns a **count** of runs, not an amount | `payroll.runs.read` |
| 6 | **TDS this month**: "—", "Not calculated in payroll yet" | none; `KpisDto.tdsLiability` exists but payroll writes no TDS lines | as designed (a dash); TDS itself is missing | — |
| 7 | 6-month gross chart values | runs (gross per period) | exists | `payroll.runs.read` |
| 8 | Bar state (paid / in review), legend, tooltip "Sep 2026 · ₹x lakh gross · paid" | runs status per period | exists (derived) | `payroll.runs.read` |
| 9 | This month's run steps with dates: Draft "Created 24 Sep", Processed "25 Sep · 231 payslips", Locked, Paid | `RunDto.createdAt/processedAt/lockedAt`; paid date from `GET /v1/payroll/disbursement/batches` | partial: `RunDto` has no `paidAt`, so the paid date needs `hrms.disbursement.read` | runs: `payroll.runs.read`; batches: `hrms.disbursement.read` |
| 10 | Steps sub "<month> · N employees" (eligible count while Draft) | `RunDto.employeeCount`; `GET /v1/payroll/runs/{id}/eligible-employees` | exists | `payroll.runs.read` |
| 11 | Run note ("Processed and waiting for review…") | derived from status | exists | — |
| 12 | Statutory dues table: scheme · authority, period, amount, due date, status (Paid / Due in N days / Upcoming / overdue) | `GET /v1/payroll/statutory-dues?months=3` + `GET /v1/compliance/filings` | exists. Today the page hides dues already FILED; the design lists them as "Paid", using `filingStatus`. The PT/LWF state name needs `GET /v1/payroll/settings` (`ptStateCode`). | dues: `payroll.runs.read`; filings: `hrms.compliance.read`; settings: `payroll.settings.read` |
| 13 | Recent runs: period, employees, net pay, paid on, status | runs + batches (`paidAt`) | exists; "Paid on" needs `hrms.disbursement.read` (see 9) | as above |
| 14 | Empty state "No payroll yet" | runs length | exists | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Open Salary Structure" (primary) | navigate `/hrms/salary-structure` | exists | route: `payroll.runs.read` |
| 2 | "All payroll runs" (secondary) | navigate `/hrms/payroll/runs` | exists | `payroll.runs.read` |
| 3 | "Open run" (steps card) | navigate `/hrms/payroll/runs/:id` | exists | `payroll.runs.read` |
| 4 | "All runs" (recent runs card) | navigate | exists | `payroll.runs.read` |

Keep two things the design doesn't show: a click on a chart bar opens runs filtered to that month (`?month=YYYY-MM`), and the tiles are clickable.

**Gates today:**
- Nav: `page('pay-dashboard', …, [{ ...any('payroll.runs.read'), module: PAY }])`.
- Route: `<RequirePermission code={P.PAYROLL_RUNS_READ}><RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}><ModuleGate moduleKey="payroll">`.
- Container:
  - `canRuns = usePermission(P.PAYROLL_RUNS_READ)` gates runs, KPIs and dues.
  - `canDisbRead = usePermission('hrms.disbursement.read')` gates batches.
  - `canCompliance = usePermission('hrms.compliance.read')` gates filings.
- API: `@PreAuthorize("hasAuthority('payroll.runs.read')")` on `/runs`, `/dashboard/kpis`, `/dashboard/trend`, `/statutory-dues`, `/runs/{id}/eligible-employees`. `hasAuthority('hrms.disbursement.read')` on `/disbursement/batches`.

**Shared components:** PageHeader, StatCard (tone variant: tone dot + label, value, note, no icon), Card/Section (title, count, sub, action), bar chart with grow motion and tooltips (page-specific "MiniBarChart"), Stepper (the `ProcessSteps` idea), data Table with StatusPill cells, EmptyState, Skeleton.

---

### 2.2 Processing & payslips: All runs, Employees, Skipped (`py-runs`, lines 74–83; payslip view 166–168)

**Routes:**
- `/hrms/payroll/runs` (the list).
- `/hrms/payroll/runs/:id?tab=overview|employees|skipped`.

**Files:** `PayRuns.tsx`, `PayrollRunPage.tsx`, `PayrollEmployees.tsx`, `PayslipDrawer.tsx`, `NewRunModal.tsx`, and `PayrollContainer.tsx` lines 278–371. The pages exist.

**Tabs:** All runs · Overview · Employees · Skipped. In the design these are four tabs of one page. Overview, Employees and Skipped mean "this month's run", opened from the header's "Open September run".

Today the list and the run page are two routes. Mapping: All runs = the list; the other three = `/hrms/payroll/runs/:id?tab=…` for the chosen run (this month's by default). Coordinate with the "Payroll run" auditor.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | "How a payroll run moves": counts Draft / Processed / Locked / Paid (Paid = "this financial year") | runs + `Company.fiscalYearStart` (`useCompanies`) | exists (derived) | `payroll.runs.read` |
| 2 | Runs table count and segments All runs / Processed / Paid | runs | exists (client filter) | `payroll.runs.read` |
| 3 | Run row: "Sep 2026 · Company", pay date, employees, gross, deductions, net, status | `RunDto` (`payDate`, totals) | exists | `payroll.runs.read` |
| 4 | Runs empty state | runs | exists | — |
| 5 | Employees tab sub ("<month> run · N payslips. Preview until the run is locked.") | `RunDto` | exists | `payroll.runs.read` |
| 6 | Payslips table segments **Everyone / Needs review / On hold** | none | **missing**: payslips have no status | — |
| 7 | Payslip row: employee · code, paid days, gross, deductions, net | `GET /v1/payroll/runs/{id}/employees` | exists | `payroll.runs.read` |
| 8 | Payslip row status **Ready / Review / On hold** | none | **missing** | — |
| 9 | Payslip view stats: paid days (LOP note), gross, deductions, net "Credited on <pay date>" | `GET /v1/payroll/runs/{id}/employees/{empId}/payslip` + `RunDto.payDate` | exists | `payroll.runs.read` |
| 10 | Payslip view ledger: earnings, deductions, "Income tax (TDS) · Not calculated yet", totals, net | payslip | exists | `payroll.runs.read` |
| 11 | Skipped: employee · code, department, joined, why ("No salary structure") | `GET /v1/payroll/runs/{id}/skipped` + directory (`GET /v1/hrms/employees`) + `GET /v1/hrms/departments?companyId` | exists | skipped: `payroll.runs.read`; directory: `hrms.employee.read`; departments: `hrms.department.read` (**not checked in the container**, which fetches departments for anyone on salary, pli or runs) |
| 12 | "What happens next" | static copy | exists | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Open <month> run" (All runs primary) | navigate | exists | `payroll.runs.read` |
| 2 | Row "Open run" | navigate | exists | `payroll.runs.read` |
| 3 | Row "Register" (paid runs) | `GET /v1/payroll/reports/salary-register?runId=` (PDF) | exists | `payroll.runs.read` |
| 4 | Row "Payslip" (opens the view) | payslip endpoint | exists | `payroll.runs.read` |
| 5 | "Download preview" | `GET /v1/payroll/runs/{id}/employees/{empId}/payslip.pdf` | exists | `payroll.runs.read` |
| 6 | Skipped row "Add structure" | navigate `/hrms/salary-structure?employee=` | exists | `payroll.runs.read` (route) |
| 7 | Put a payslip on hold / mark it reviewed (implied by the statuses) | none | **missing** (gap G5) | — |

**Keep:** **New run** (`POST /v1/payroll/runs`, `payroll.runs.manage`). The design has no create button, and it is the only way to start a run (conflict C13). The run page's Process / Lock / Reopen / Prepare / Mark as paid actions belong to PgPayroll.

**Gates today:**
- Nav: `page('pay-runs', …, [{ ...any('payroll.runs.read'), module: PAY }])`.
- Route: `RequirePermission` + `RouteGuard anyOf [P.PAYROLL_RUNS_READ]` (and `/:id` with `RouteGuard` only), `ModuleGate payroll`.
- Container: `canManage = usePermission(P.PAYROLL_RUNS_MANAGE)`, `canLock = usePermission(P.PAYROLL_RUNS_LOCK)`.
- API:
  - `POST /runs` and `/runs/{id}/process`: `hasAuthority('payroll.runs.manage')`.
  - `/lock` and `/reopen`: `payroll.runs.lock`.
  - All reads: `payroll.runs.read`.

**Shared components:** PageHeader + PillTabs, StatCard (tone), Table with row actions and SegmentedControl, StatusPill, Avatar (initials in the first column), KeyValue, a Ledger (earnings/deductions/net, page-specific; `PayslipDrawer` already has a version), EmptyState, Skeleton, Toast.

---

### 2.3 Salary structure (`py-struct`, lines 84–87; views `brk`, `struct`, `bulk` 170–178)

**Route and files:**
- Route: `/hrms/salary-structure` (`?employee=` opens that person's form).
- Files: `design/dc/PaySalary.tsx` and `PayrollContainer.tsx` lines 372–445.
- The page exists. Tabs: none.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | **With a structure** "N of M people" | none as a figure; could be counted from `GET /v1/payroll/structures/export` + the directory | partial: needs a summary (G4) | export: `payroll.structure.read` |
| 2 | **Without one** "N · Skipped in the <month> run" | `GET /v1/payroll/runs/{id}/skipped` for the open run | partial: that is one run's list, not a headcount-wide count | `payroll.runs.read` |
| 3 | **Average CTC** a year | none | partial: needs the summary | — |
| 4 | **Revised this year** "N · <cycle>" | none. `payroll.employee_salary_structures` and `payroll.salary_revision_batches` have the rows. | **missing** | — |
| 5 | Table count and segments **Everyone / No structure** | directory (`loadDirectory`, up to 20 × 200 people) + one `GET /v1/payroll/structures/employee/{id}` per visible row | partial: N+1 per page; "No structure" can't be filtered without every row's structure | `hrms.employee.read`, `payroll.structure.read` |
| 6 | Row: employee · code, **effective from, annual CTC, gross monthly, net payable, tax regime** | per-row `StructureDto` (has every field) | partial: per-row fetch; today's columns are Basic/HRA/Special/Deductions/Net | `payroll.structure.read` |
| 7 | "No structure" pill | null structure | exists | — |
| 8 | Empty "No salary structures yet" | directory | exists | — |
| 9 | Breakdown view: ledger with full attendance, net payable | `StructureDto` (earnings, deductions, netMonthly) | exists | `payroll.structure.read` |
| 10 | Breakdown facts: structure (component split / from CTC), monthly CTC, **employer PF, gratuity**, PF rule (ceiling), tax regime | `StructureDto` (`derivedFromCtc`, `employerContributions`, `pfApplicable`) + settings | partial: gratuity shows only if a gratuity component is configured | + `payroll.settings.read` |
| 11 | Add/Edit form preview ledger for the typed gross | client split (`designSplit` / `scaleSplit`) + settings + PT slabs | exists | `payroll.settings.read`, `payroll.pt_slabs.read` |
| 12 | Bulk revise preview: employee, current CTC, new CTC, change, totals, left out, blockers | `POST /v1/payroll/structures/bulk-revise/preview` | exists | `payroll.structure.bulk-revise` |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Add salary structure" (header) → Employee, Effective from, Monthly gross, **Tax regime** → "Add structure" | `POST /v1/payroll/structures` | exists. The employee picker in the header form and the tax-regime field are new UI; the API already takes `taxRegime OLD\|NEW`. | `payroll.structure.manage` |
| 2 | "Bulk revise CTC" (header) → "Apply revision" | `GET …/bulk-revise/options`, `POST …/preview`, `POST /bulk-revise` | exists | `payroll.structure.bulk-revise` |
| 3 | "Export" | `GET /v1/payroll/structures/export` (Excel built client-side) | exists | `payroll.structure.read` |
| 4 | Row "Breakdown" | per-row structure | exists | `payroll.structure.read` |
| 5 | Row "Edit" → "Save changes" | `POST /v1/payroll/structures` | exists | `payroll.structure.manage` |
| 6 | Row "Add" (no structure) | same | exists | `payroll.structure.manage` |
| 7 | Breakdown → "Edit salary structure" | opens the form | exists | `payroll.structure.manage` |

**Gates today:**
- Nav: `page('pay-salary', …, [{ ...any('payroll.runs.read'), module: PAY }])`.
- Route: `RouteGuard anyOf [P.PAYROLL_RUNS_READ]`.
- Container:
  - `canStruct` = `P.PAYROLL_STRUCTURE_READ`; `canStructManage` = `P.PAYROLL_STRUCTURE_MANAGE`; `canBulk` = `'payroll.structure.bulk-revise'`.
  - `canBands` = `'hrms.grade.band.read'` gates `GET /v1/hrms/pay-bands`.
  - `canEmpRead` = `P.HRMS_EMPLOYEE_READ` gates the directory.
  - Components are read only with manage (`GET /v1/payroll/components`, `payroll.components.read`).
- **Note:** the route needs `payroll.runs.read`, but the data needs `payroll.structure.read`. Someone with only runs.read sees rows with no structures. The new page should gate the section on `payroll.structure.read`.

**Shared components:** PageHeader, StatCard, Table + SegmentedControl, Dropdown with search (employee picker), FormField (date via the calendar component, number, select), Ledger, KeyValue, Toast, EmptyState, Skeleton; SidePanel or sub-view for the forms.

---

### 2.4 Payroll settings (`py-settings`, lines 88–97)

**Route and files:**
- Route: `/hrms/payroll/settings`.
- Files: `design/dc/PaySettings.tsx` and `PayrollContainer.tsx` lines 446–452.
- The page exists. Tabs: none.
- It stays under Payroll (the design agrees).

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | PF: employee %, employer %, wage ceiling, apply ceiling, establishment code | `GET /v1/payroll/settings` | exists | `payroll.settings.read` |
| 2 | ESI: employee %, employer %, wage ceiling, establishment code | same | exists | same |
| 3 | PT state | same (`ptStateCode`) | exists | same |
| 4 | PT slabs for the state (monthly salary, PT a month) | `GET /v1/payroll/pt-slabs/{state}` | exists | `payroll.pt_slabs.read` |
| 5 | LWF: employee amount, employer amount, deducted in (months) | same (`lwfDeductionMonths`) | exists | `payroll.settings.read` |
| 6 | Cycle: start day, end day (follows start), processing day, late-mark LOP threshold | same | exists | same |
| 7 | Sandwich rule | same (`sandwichRuleEnabled`) | exists. **The design shows "Coming soon", but the rule is implemented** (`LopCalculator`, `PayrollRunService` line 932). See C1. | same |
| 8 | Cycle preview: "<month> cycle 1 – 30 Sep", cycle days, **processing day and pay date as two different dates**, late-mark rule | derived client-side | partial: the backend has one value; the processing day *is* the pay date (`PayrollCalc.payDate`). See C4. | — |
| 9 | Income tax (TDS): default regime, employees may choose, apply TDS ("Coming soon") | none | **missing**: no such settings; TDS isn't calculated | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Save settings" (header) | `PUT /v1/payroll/settings` | exists | `payroll.settings.update` |

**Keep** the per-section On/Off switches for PF, ESI, PT and LWF (not in the design; C2), plus Discard, the unsaved-changes bar and the leave guard (C3).

**Gates today:**
- Nav: `page('pay-settings', …, [{ ...any('payroll.settings.read'), module: PAY }])`.
- Route: `RouteGuard anyOf [P.PAYROLL_SETTINGS_READ]`.
- Container: `access = canSettingsEdit (payroll.settings.update) ? 'edit' : canSettings ? 'view' : 'none'`.
- API: `GET /settings` needs `payroll.settings.read`; `PUT` needs `payroll.settings.update`; `/pt-slabs` needs `payroll.pt_slabs.read`.

**Shared components:** PageHeader (Save as primary), Card/Section (form cards, half width), FormField (number with % or ₹ affix, select, text with a pattern hint, toggle), Table (PT slabs), KeyValue (cycle preview), Toast, Skeleton. Also the SettingsKit parts the client adopted for every settings page (unsaved bar, view-only note, leave guard).

---

### 2.5 Production-linked incentive (`py-pli`, lines 98–108; views `pli-new`, `pli-targets` 179–180)

**Route and files:**
- Route: `/hrms/pli`.
- Admins (`hrms.pli.read` or `hrms.pli.target.read`): `design/dc/PayPli.tsx`, with `Pli.tsx` `AllAwardsTab` in a drawer.
- Everyone else: `Pli.tsx` (My incentives). `PayrollContainer` returns `<Pli />` when `!pliAdmin`.

**Tabs in the design** (gate each by permission):
- **All awards**: `hrms.pli.read`.
- **Monthly targets**: `hrms.pli.target.read` or `hrms.pli.read`.
- **My incentives**: `hrms.pli.read.self`.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | **Proposed** ₹ total, "N awards · waiting" | `GET /v1/pli/awards` (paged, 20) | **missing** as a total (page only) | `hrms.pli.read` |
| 2 | **Approved** ₹, "To be paid in the <next> run" | same | **missing** total | same |
| 3 | **Paid out** ₹, this financial year | same | **missing** total | same |
| 4 | **Total awards**, all time | `totalElements` | exists | same |
| 5 | Awards table, segments Everything / Proposed / Approved / Paid | `GET /v1/pli/awards` | partial: no `status` filter on the API | same |
| 6 | Award row: employee · **department**, period, plan, amount, status (Proposed / Approved / "Paid · payroll" / Not approved) | `PliAwardResponse` (+ `payrollPeriod`) | partial: no department | same |
| 7 | Awards empty state | — | exists | — |
| 8 | "Achievement by team" bars (% and tone), sub "Pools pay out from **85%** achievement" | `GET /v1/pli/targets` (all pages) | exists (derived). **The threshold conflicts**: the code pays a pool only at ≥100% (`PayPli.tsx` `mult >= 1`). See C5. | `hrms.pli.target.read` or `hrms.pli.read` |
| 9 | "<Month> pools": teams with targets, pools earned, below the bar, paid through (next run) | targets | exists (derived); same threshold issue | same |
| 10 | Targets table: team · department, metric, target, actual, achievement %, pool | targets + departments | exists | + `hrms.department.read` |
| 11 | Targets empty state | — | exists | — |
| 12 | My incentives: **proposed for you ₹ (all time), waiting ₹, approved ₹ ("next payroll run"), paid ₹** | `GET /v1/pli/my` (paged) | **missing** totals (today they count the page and say "On this page") | `hrms.pli.read.self` |
| 13 | My awards: plan, period, amount, status | `GET /v1/pli/my` | exists | same |
| 14 | My incentives empty state | — | exists | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Propose award" → Company, Employee, Plan, Amount, Period (month), **Rating basis (type)**, Notes → "Propose Award" | `POST /v1/pli/awards` | exists. The rating basis is a number in the API (`PliAward.ratingBasis BigDecimal`); the design shows a type list. See C6. | `hrms.pli.write` |
| 2 | Row "Approve" | `POST /v1/pli/awards/{id}/decision {approved:true}` | exists | `hrms.pli.write` |
| 3 | Row "Reject" | same `{approved:false}` | exists | `hrms.pli.write` |
| 4 | **Undo** after approve or reject (README) | none | **missing** (G20) | — |
| 5 | Row "Paid outside payroll" (approved, not in a run) | `POST /v1/pli/awards/{id}/pay` | exists | `hrms.pli.write` |
| 6 | "Set monthly targets" → name, department, metric, target, pool, month → "Save targets" | `POST /v1/pli/targets` | exists. The metric is free text in the API; the design shows a fixed list. | `hrms.pli.target.write` or `hrms.pli.write` |

**Keep:**
- Each target's **Edit**, which is the only place to enter "actual achieved" (`PUT /v1/pli/targets/{id}`). The design has no way to enter actuals (C7).
- **Export CSV**.

**Gates today:**
- Route: `RouteGuard anyOf ['hrms.pli.read','hrms.pli.write','hrms.pli.read.self']`, `ModuleGate payroll`.
- Nav:
  - `page('pay-pli', …, [{ ...any('hrms.pli.read','hrms.pli.target.read'), module: PAY }])`.
  - `MENU_RULES['payroll-hr:/hrms/pli']`, the same rule.
  - `page('me-incentives', …, [{ ...any('hrms.pli.read.self'), noneOf: ['hrms.pli.read','hrms.pli.target.read'], module: PAY }])`.
- Container: `canPliRead`, `canPliTarget`, `canPliWrite`, `canPliTargetWrite`, `canPliSelf`; `pliAdmin = canPliRead || canPliTarget`.
- API:
  - `/targets` GET: `hasAnyAuthority('hrms.pli.target.read','hrms.pli.read')`.
  - `/targets` POST/PUT: `hasAnyAuthority('hrms.pli.target.write','hrms.pli.write')`.
  - `/awards` POST, `/decision` and `/pay`: `hasAuthority('hrms.pli.write')`.
  - `/awards` GET: `hasAuthority('hrms.pli.read')`.
  - `/my`: `hasAuthority('hrms.pli.read.self')`.

**Shared components:** PageHeader + PillTabs, StatCard, Table + SegmentedControl, ApprovalRow (inline approve/reject + undo), Meter/ProgressBar (achievement bars), KeyValue, FormField + Dropdown with search (employee), MonthField (calendar), Toast.

---

### 2.6 Advances & loans (`py-adv`, lines 109–118; views `adv`, `adv-issue` 181–187)

**Route and files:**
- Route: `/hrms/advances` (`?tab=`).
- `PayrollContainer` shows `PayAdvances` when the person has `hrms.advance.read`, otherwise `<Advance />`.

**Tabs in the design:**
- **Company advances**: `hrms.advance.read`.
- **My advances**: `hrms.advance.request.self`.
- **Request an advance**: `hrms.advance.request.self`.

Today's non-admin page also has an **Approvals** tab (for `approve` or `disburse`). See C9.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | **Requested** count, "₹x waiting for a decision" | `GET /v1/advance/requests?size=100` (first 100) | partial: computed from one page | `hrms.advance.read` (tenant-wide only with `hrms.advance.disburse`) |
| 2 | **Not disbursed** count | same | partial | same |
| 3 | **Still to repay** ₹, "N people · recovered in payroll" | same | partial | same |
| 4 | **Repaid** ₹, this financial year | none (ledger entries exist) | **missing** | — |
| 5 | Table and segments All / Requested / Approved / **Recovering / Repaid** | `GET /v1/advance/requests?status=` | partial: the API can't split DISBURSED into recovering and repaid | same |
| 6 | Row: employee · **department**, advance, outstanding, recovery ("₹5,000 × 5"), requested date, status | `AdvanceResponse` | partial: no department | same |
| 7 | Empty state | — | exists | — |
| 8 | Detail facts: requested amount, monthly deduction, term, requested on, decision date, disbursed on | `GET /v1/advance/requests/{id}` | exists | `hrms.advance.read` or `hrms.advance.request.self` (own only) |
| 9 | Detail "Salary recovery": outstanding, installments remaining, next recovery | `GET /v1/advance/{id}/summary` | exists | `hrms.advance.read` |
| 10 | Detail history: entry, date, amount, balance ("Disbursed · NEFT <ref>", "Recovered · May payroll") | `GET /v1/advance/{id}/ledger` | partial: the disbursement reference is always the literal `'disbursement'` (`AdvanceRecoveryService` line ~471); ledger rows carry a `payrollRunId`, not a month label | `hrms.advance.read` |
| 11 | My advances: requests (all time), waiting, **still to repay ₹ + "₹x a month · N left"** | `GET /v1/advance/my` (paged) | partial: page-scoped ("this page") | `hrms.advance.request.self` |
| 12 | My requests: reason, requested, amount, repay over, status ("₹x left") | `GET /v1/advance/my` | exists | same |
| 13 | Request preview: "₹X over N months → ₹Y a month" | client | exists | — |
| 14 | Request preview: "First deduction: <month> run" | none | partial: the API always starts the month after payout, so this is unknown until paid | — |
| 15 | Request preview: "**Approver: <name>**" | none (the server resolves it in `AdvanceController.resolveApprover`) | **missing** | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Issue advance" → employee, principal, recover over, **first deduction**, reason / payment reference → "Issue advance" | `POST /v1/advance/requests/on-behalf` (someone else) or `POST /v1/advance/requests` (self) | partial: today it is raised for approval, not issued directly (C8); there is no first-deduction choice | `hrms.advance.request.others` / `hrms.advance.request.self` |
| 2 | Row "Approve" | `POST /v1/advance/requests/{id}/decision` | exists (scoped to the routed approver unless `disburse`; never your own) | `@perm.check('hrms.advance.approve')` |
| 3 | Row "Reject" | same (optional comment) | exists | same |
| 4 | **Undo** approve or reject | none | **missing** (G20) | — |
| 5 | Row "Record payment" (approved) | `POST /v1/advance/requests/{id}/disburse` | partial: no payment reference, no first-deduction month (G13) | `@perm.check('hrms.advance.disburse')` |
| 6 | Row "Details" | as rows 8–10 | exists | `hrms.advance.read` |
| 7 | "Write off balance" (detail, secondary) | `POST /v1/advance/{id}/write-off` (needs a reason) | exists | `hrms.advance.foreclose` |
| 8 | "Defer month" (detail, primary) | `POST /v1/advance/{id}/skip-month` (installment number + reason; pick the next pending one) | exists | `hrms.advance.approve` |
| 9 | My advance "Details" | `GET /requests/{id}` works for self; `/summary`, `/schedule`, `/ledger` don't | partial (G11) | `hrms.advance.read` only |
| 10 | "Request an advance" (My advances primary) | navigate to the tab | exists | `hrms.advance.request.self` |
| 11 | "Send request" | `POST /v1/advance/requests` | exists | `hrms.advance.request.self` |

**Keep:**
- **Record full repayment** (`POST /v1/advance/{id}/foreclose`, `hrms.advance.foreclose`).
- Export CSV.
- The "Approvals" view for approve or disburse holders without `hrms.advance.read`.

**Gates today:**
- Route: `RouteGuard anyOf ['hrms.advance.request.self','hrms.advance.read','hrms.advance.approve','hrms.advance.disburse','hrms.advance.request.others']`, `ModuleGate hrms`.
- Nav: `page('pay-advances', …, [{ ...any('hrms.advance.request.self','hrms.advance.read','hrms.advance.approve','hrms.advance.disburse'), module: HR }])` and `page('me-advances', '/hrms/advances?tab=my', [{ ...any('hrms.advance.request.self'), module: HR }])`.
- Container: `canAdvRead`, `canAdvApprove`, `canAdvRequest`, `canAdvOthers`; `advAdmin = canAdvRead`.
- API:
  - `/requests` GET: `hasAuthority('hrms.advance.read')`, scoped by `seesAllAdvances` (`hrms.advance.disburse`).
  - `/requests/approvals`: `hasAnyAuthority('hrms.advance.approve','hrms.advance.disburse')`.
  - `/{id}/schedule|ledger|summary`: `hasAuthority('hrms.advance.read')`.
  - `/foreclose` and `/write-off`: `hrms.advance.foreclose`.
  - `/skip-month`: `hrms.advance.approve`.

**Shared components:** PageHeader + PillTabs, StatCard, Table + SegmentedControl, ApprovalRow (approve/reject + undo), StatusPill, KeyValue, Table (ledger history), FormField + Dropdown with search (employee), MonthField (first deduction), Dialog (write-off or defer reason), Toast.

---

### 2.7 Bank disbursement (`py-bank`, lines 119–130; view `batch` 188–190)

**Routes and files:**
- `/hrms/bank-disbursement` (`?run=`): `design/dc/PayBank.tsx`, `PayrollContainer.tsx` lines 499–521.
- `/hrms/bank-disbursement/setup`: `payroll/BankDisbursement.tsx` (profiles CRUD, run picker, batch build/download/confirm/cancel, net-pay band chart) + `DisbursementHistory.tsx`.

**Tabs in the design:** Current file · Past files · Bank profiles. Profiles are a separate page today (see question 9).

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | "<Month> file" steps (run locked → file generated → sent to bank → paid), sub "profile · format", note | runs + `GET /v1/payroll/disbursement/batches` + `GET /v1/payroll/bank-profiles` | exists | runs: `payroll.runs.read`; batches: `hrms.disbursement.read`; profiles: `hrms.bank_profile.read` |
| 2 | Batch facts: bank profile ("name · •••• 4417"), total, **beneficiaries "229 of 231"**, status | batch + profile (`debitAccountNo` comes back in full; the UI must mask it) | partial: before a file exists, "N of M" needs a readiness check | same |
| 3 | "**Fix before you prepare the file**": employee · code, problem (IFSC missing / account number looks wrong) | batch lines with status `SKIPPED_*` (`GET /batches/{id}`) | partial: known only **after** a draft file is built (the build needs a LOCKED run) | `hrms.disbursement.read` |
| 4 | Net-pay distribution: employee · dept, code, paid days, **bank •••• last4**, net, payment status | run employees + batch lines | partial: bank accounts only after a build; no bank name stored (IFSC prefix only) | `payroll.runs.read`, `hrms.disbursement.read` |
| 5 | Empty "No bank files yet" | runs, batches | exists | — |
| 6 | Past files: batch · profile, created, total, beneficiaries, status (Paid / Cancelled) | `GET /v1/payroll/disbursement/batches` | exists (today's page lists paid files only; the API has all) | `hrms.disbursement.read` |
| 7 | Batch view stats: total, beneficiaries, UTR | `GET /v1/payroll/disbursement/batches/{id}` | exists | same |
| 8 | Batch view payment lines: employee · code, account, amount, status | same | exists | same |
| 9 | Bank profiles: profile · company, format, account · IFSC (masked), Default / Backup | `GET /v1/payroll/bank-profiles` | exists | `hrms.bank_profile.read` |
| 10 | "How the file works" | static copy | exists | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Open run" (Current file primary) | navigate | exists | `payroll.runs.read` |
| 2 | Fix row "Add bank account" | navigate `/hrms/employees/{id}?tab=payroll` | exists | (employee page's own gates) |
| 3 | Past file "View details" | `GET /batches/{id}` | exists | `hrms.disbursement.read` |
| 4 | "Download file" (batch view) | `GET /batches/{id}/file` (posts the batch) | exists | `hrms.disbursement.build` |
| 5 | Profile "Edit" | `PUT /v1/payroll/bank-profiles/{id}` | exists | `hrms.bank_profile.manage` |
| 6 | Profile "Make default" | same with `isDefault:true` | exists | same |
| 7 | "Add profile" (company, name, format, debit account, IFSC, corporate ID) | `POST /v1/payroll/bank-profiles` | exists | same |

**Keep** (today's behaviour; the design doesn't show all of it on the Current file tab):
- Prepare file (`POST /batches`, `hrms.disbursement.build`).
- Confirm transfer with UTR (`POST /batches/{id}/post` + `/mark-paid`, `hrms.disbursement.post`), which also marks the run paid.
- Rebuild file, Cancel this file (`/cancel`, `hrms.disbursement.post`).
- Delete or deactivate a profile.
- The run picker (`?run=`).

**Gates today:**
- Route: `RequirePermission` + `RouteGuard anyOf [P.PAYROLL_RUNS_READ]`, `ModuleGate payroll` (the same for `/setup`).
- Nav: `page('pay-bank', …, any('payroll.runs.read'))` and `page('pay-bank-setup', …, any('payroll.runs.read'))`.
- Container: `canDisbRead`, `canBuild` (`hrms.disbursement.build`), `canPost` (`hrms.disbursement.post`), `canProfiles` (`hrms.bank_profile.read`).
- API: see the tables.

**Shared components:** PageHeader + PillTabs, Stepper, KeyValue, Table with row actions, StatusPill, FormField, Dialog (confirm transfer / UTR), EmptyState, Toast.

---

### 2.8 Expense center (`e-center`, lines 131–145; views `claim`, `rb`, `rb-build`, `pol` 191–198)

**Route and files:**
- Route: `/hrms/expenses?tab=approvals|my|submit|batches|policies`.
- Files: `Expense.tsx`, `expense/ReimbursementBatches.tsx`, `expense/expenseStatus.ts`.
- The page exists.

**Tabs** (same names and order as today):
- Approvals: `hrms.expense.claim.approve` or `hrms.expense.reimbursement`.
- My claims and Submit a claim: `hrms.expense.claim.self`.
- Reimbursement batches: `hrms.reimb_batch.read`.
- Policies: `hrms.expense.policy.read`.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | **Waiting for approval** ₹, "N claims" | `GET /v1/expense/dashboard-stats` | exists | `hasAnyAuthority('hrms.expense.claim.read','hrms.expense.claim.approve','hrms.expense.reimbursement')` (tenant-wide with `reimbursement`, else the caller's routed claims) |
| 2 | **To be reimbursed** ₹, "N approved claims" | same | exists | same |
| 3 | **Reimbursed this month** ₹, "N claims" | same | exists | same |
| 4 | "Waiting for your OK" count | `GET /v1/expense/claims/approvals` (SUBMITTED + APPROVED) | exists | `hasAnyAuthority('hrms.expense.claim.approve','hrms.expense.reimbursement')` |
| 5 | Row: employee · **department**, claim, submitted, amount, receipts ("3 receipts" / "No receipt") | `ExpenseClaimResponse` (`itemCount`, `receiptCount`) | partial: no department | same |
| 6 | Row **Policy check**: over the limit / within policy / receipt missing | none | **missing** | — |
| 7 | Empty "Nothing waiting" | — | exists | — |
| 8 | Claim view: line items (category, merchant, date, amount, receipt link / missing) | `GET /v1/expense/claims/{id}` (signed receipt links) | exists | `hasAnyAuthority('hrms.expense.claim.read','hrms.expense.claim.self')` |
| 9 | Claim view "Policy check": policy · max, result, notes | notes exist | partial: policy and result are missing | — |
| 10 | My claims: **waiting ₹, approved ₹, reimbursed ₹ this year** | `GET /v1/expense/my` (paged) | partial: page-scoped | `hrms.expense.claim.self` |
| 11 | Claims table: claim, submitted, amount, items, status | `GET /v1/expense/my` | exists | same |
| 12 | My claims empty state | — | exists | — |
| 13 | New claim: company (multi-company only), title, notes | `useCompanies` | exists | — |
| 14 | Line item: category, amount, merchant, description, receipt | enum `EXPENSE_CATEGORIES` | exists. The design's categories ("Travel — local", "Meals"…) aren't the API enum, and the design has no date field; keep both (C11, C12). | — |
| 15 | Line items table and "Total ₹x · **within the company expense limit**" | client total + `GET /v1/expense/policies` | partial: the limit check needs `hrms.expense.policy.read`, which employees don't hold (the hint is skipped for them) | `hrms.expense.policy.read` |
| 16 | Batches: batch · company, approved through, claims, amount, status, payment reference; segments All / Draft / Posted / Paid | `GET /v1/expense/reimbursement-batches?companyId&status` | exists | `hrms.reimb_batch.read` |
| 17 | Batch view stats: total, claims, status | `GET /v1/expense/reimbursement-batches/{id}` | exists | same |
| 18 | Batch view "Employees & claims" (employee, claims, amount) | same (items grouped client-side) | exists | same |
| 19 | Policies: policy, category, max / claim, receipts (Required / Optional), status | `GET /v1/expense/policies?companyId` | exists | `hrms.expense.policy.read` |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | Row "View" (claim view) | `GET /claims/{id}` | exists | `claim.read` / `claim.self` |
| 2 | Row "Approve" | `POST /v1/expense/claims/{id}/decision {approved:true}` | exists (object-scoped) | `@perm.check('hrms.expense.claim.approve')` |
| 3 | Row "Reject" | same (optional comment) | exists | same |
| 4 | **Undo** approve or reject | none | **missing** (G20) | — |
| 5 | Claim view "Approve" / "Reject" | same | exists | same |
| 6 | "New claim" (My claims primary) | navigate to the tab | exists | `claim.self` |
| 7 | "Add line item" | client draft | exists | — |
| 8 | Line "Remove" | client draft | exists | — |
| 9 | "Submit Claim" | `POST /v1/expense/receipts` (each receipt), then `POST /v1/expense/claims` | exists | `hrms.expense.claim.self` |
| 10 | "Build batch" → company, cutoff, currency, notes → "Build draft batch" | `POST /v1/expense/reimbursement-batches` | exists | `hrms.reimb_batch.build` |
| 11 | Row "View batch" | `GET /{id}` | exists | `hrms.reimb_batch.read` |
| 12 | "Post batch" (draft) | `POST /{id}/post` | exists | `hrms.reimb_batch.build` |
| 13 | "Cancel batch" | `POST /{id}/cancel` | exists | `hrms.reimb_batch.post` |
| 14 | "Record payment" (UTR, notes) → "Confirm payment recorded" | `POST /{id}/mark-paid` | exists | `hrms.reimb_batch.post` |
| 15 | "Add policy" → name, category, max / claim, **receipt required** | `POST /v1/expense/policies?companyId=` | exists. `requiresReceipt` is in the API but not in today's form. | `hrms.expense.policy.write` |
| 16 | Policy "Edit" | `PUT /v1/expense/policies/{id}` | exists | same |
| 17 | Policy "Deactivate" | `DELETE /v1/expense/policies/{id}` | exists | same |
| 18 | Policy "Restore" | `PUT … {isActive:true}` | exists | same |

**Keep:**
- "Approved, to be paid" with **Mark reimbursed** (`POST /claims/{id}/reimburse`, `@perm.check('hrms.expense.reimbursement')`). It is not in the design (C10).
- Attach or replace a receipt on your own pending claim (`POST /claims/{id}/items/{itemId}/receipt`).
- "Refresh draft" on a batch.
- Per-claim line items inside a batch.

**Gates today:**
- Route: `RouteGuard anyOf ['hrms.expense.claim.self','hrms.expense.claim.read','hrms.expense.claim.approve','hrms.expense.policy.read','hrms.expense.reimbursement','hrms.reimb_batch.read']`, `ModuleGate hrms`.
- Nav: `page('expenses', …)` with the same list, plus `tab('expenses','approvals'|'submit'|'my'|'batches'|'policies', …)`, each with its own gate as listed above.
- Page: `usePermission` for `claim.approve`, `reimbursement`, `policy.read`, `policy.write`, `claim.self`, `reimb_batch.read`, `claim.read`.

**Shared components:** PageHeader + PillTabs, StatCard, Table + SegmentedControl, ApprovalRow, StatusPill, KeyValue, FormField (select, number, text, file, DateField), Dialog (reject reason), SidePanel or sub-view (claim, batch, policy), Toast, EmptyState.

---

### 2.9 Full & final settlement (`x-fnf`, lines 146–152; views `fnf`, `fnf-new` 199–204)

**Route and files:**
- Route: `/hrms/fnf?tab=pending-approval|pending-payment|settled|all|create` (`&employeeId=` from the Exit page).
- File: `FullAndFinal.tsx`. The page exists.

**Tabs in the design:** Pending approval · Pending payment · Settled · All. "Create settlement" is the header's primary button. `?tab=create&employeeId=` must keep working, because the Exit page hands off to it (`live-fnf-tabs.mjs`).

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | **In the ledger** (count) | `GET /v1/fnf/settlements` `totalElements` | exists | `hrms.fnf.read` |
| 2 | **Waiting for approval** count · ₹ | same | partial: page-scoped (no status filter, no totals) | same |
| 3 | **Approved, to be paid** count · ₹ | same | partial | same |
| 4 | **Payment recorded** count, this year | same | partial | same |
| 5 | Pending approval table: employee · **department**, last working day, net, status | same | partial: the server can't filter by status (`FnfService.getByStatus` exists but isn't exposed); no department | same |
| 6 | Pending payment table | same | partial | same |
| 7 | Settled table | same | partial | same |
| 8 | All table | same | exists | same |
| 9 | Settlement view ledger: earnings, deductions, totals, net + status note | `GET /v1/fnf/settlements/{id}` | exists | same |
| 10 | Settlement facts: **exit status**, last working day, status, notes | same + `GET /v1/hrms/employees/{id}` | partial: exit status needs the employee record | + `hrms.employee.read` |
| 11 | Create: company, exit status, find employee, notes | directory search (`status=EXITED\|TERMINATED`) | exists | `hrms.employee.read` |
| 12 | Create: earnings & deductions rows (label, type, amount), prefilled with "Salary for the last month / Leave encashment / Notice pay shortfall" | client | partial: rows start empty today; there are no computed suggestions (G24) | — |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | "Create settlement" (header) | opens the create view | exists | `hrms.fnf.process` |
| 2 | Row "Review" / "Details" | `GET /settlements/{id}` | exists | `hrms.fnf.read` |
| 3 | "Record payment" (row and view) | `POST /v1/fnf/settlements/{id}/pay` (not your own; not by the approver) | exists | `@perm.check('hrms.fnf.pay')` |
| 4 | "Approve settlement" | `POST /settlements/{id}/approve` | exists | `@perm.check('hrms.fnf.approve')` |
| 5 | "Cancel settlement" | `POST /settlements/{id}/cancel` | exists | `@perm.check('hrms.fnf.process')` |
| 6 | "Add earning" (and "Add deduction") | client | exists | — |
| 7 | "Process settlement" | `POST /v1/fnf/settlements` | exists | `@perm.check('hrms.fnf.process')` |

**Gates today:**
- Route: `RouteGuard anyOf ['hrms.fnf.read','hrms.fnf.process','hrms.fnf.approve']`, `ModuleGate payroll`.
- Nav: `page('fnf', …, [{ ...any('hrms.fnf.read','hrms.fnf.process','hrms.fnf.approve'), module: PAY }])`, plus tabs `pending-approval`, `pending-payment`, `settled` (`hrms.fnf.read`) and `create` (`hrms.fnf.process`).
- Page: `canRead`, `canProcess`, `canApprove`, `canPay`. Someone who can pay but not approve starts on Pending payment (keep this).

**Shared components:** PageHeader + PillTabs, StatCard, Table, StatusPill, Ledger, KeyValue, Dropdown with search (leaver), FormField, Dialog (confirm), Toast.

---

### 2.10 My Workspace → Payslips (`me-slips`, lines 153–156; view `myslip` 169)

**Route and files:**
- Route: `/me/payslips`.
- File: `payroll/EmployeePayslips.tsx`. The page exists.
- `EmpPay.dc.html` designs the same route as `e-slips`. Pick one (question 8).

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | Latest month label | `GET /v1/payroll/payslips/me` | exists | `payroll.payslip.read.self` |
| 2 | **Latest take-home**, "Paid <date>" | same | partial: the list has `lockedAt`, not a paid date | same |
| 3 | **Before deductions** (gross) | same | exists | same |
| 4 | **PF, ESI, tax and others**, "Includes ₹x advance recovery" | list + `GET /v1/payroll/payslips/me/{runId}` | partial: the advance line needs the payslip detail | same |
| 5 | Every month: month, **paid days "x / y"**, gross, deductions, take-home, status | list (`paidDays`, `lopDays`, totals, status) | partial: no period-day total in the list (the detail has `totalDays`) | same |
| 6 | In-progress month row "Being prepared" (with gross) | none; the server returns LOCKED and PAID only, on purpose | conflict (C16) | — |
| 7 | Empty "No payslips yet" | — | exists | — |
| 8 | Payslip view: "Final. Paid to <bank> •••• last4", ledger, take-home + LOP note | `GET /v1/payroll/payslips/me/{runId}` (`bankMasked`, `lopDays`) | exists | same |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| 1 | Row "View" | payslip detail | exists | `payroll.payslip.read.self` |
| 2 | Row "PDF" | `GET /v1/payroll/payslips/me/{runId}.pdf` | exists | same |
| 3 | View "Download PDF" | same | exists | same |

**Gates today:**
- Route: `RouteGuard anyOf [P.PAYROLL_PAYSLIP_READ_SELF]`, `ModuleGate payroll`.
- Nav: `page('me-payslips', …, [{ ...any('payroll.payslip.read.self'), module: PAY, self: true }])`.
- The `ess` rail group is hidden for admin roles (`administersWorkspace`, PlatformShell). Keep that rule.
- Today's page also links to `/me/salary` (`P.PAYROLL_STRUCTURE_READ_SELF`), which `live-dead-entrypoints.mjs` checks.

---

### 2.11 My Workspace → Salary (`me-salary`, lines 157–162)

**Route and files:**
- Route: `/me/salary`.
- File: `payroll/MySalaryStructure.tsx`. The page exists.
- Also designed as `e-salary` in `EmpPay.dc.html`.

| # | Data point | Source today | Status | Permission |
|---|---|---|---|---|
| 1 | Annual CTC, "From <effective date>" | `GET /v1/payroll/structures/me` | exists | `payroll.structure.read.self` |
| 2 | Gross a month | same | exists | same |
| 3 | Deductions a month | same | exists | same |
| 4 | Take-home a month (full attendance) | same | exists | same |
| 5 | Earnings: component, monthly, yearly, total | same (`earnings`) | exists | same |
| 6 | Deductions (+ "Income tax (TDS) · Not calculated yet"), total | same | exists | same |
| 7 | Also on your structure: **employer PF, gratuity** (a month), tax regime, effective from | same (`employerContributions`, `taxRegime`, `effectiveFrom`) | partial: gratuity shows only if a gratuity component is configured | same |
| 8 | Empty "No salary structure yet" | — | exists | — |

**Actions:** none in the design. Today's header link to Payslips is kept.

**Gates today:**
- Route: `RouteGuard anyOf [P.PAYROLL_STRUCTURE_READ_SELF]`, `ModuleGate payroll`.
- Nav: `page('me-salary', …, [{ ...any('payroll.structure.read.self'), module: PAY, self: true }])`.

---

## 3. Gaps: backend work each missing piece needs

**Constraints on every gap:**
- No gap needs a change to a **JPA-mapped column**.
- New tables and columns are read and written with JdbcTemplate only, and each block degrades (hidden, or a dash) until its migration is applied.
- Every new endpoint needs tenant scoping (RLS; `TenantContext`), a unit or controller test, a frontend hook in `modules/hrms/api/*`, and cache invalidation.

"JPA?" means a JPA entity maps the table the gap reads or writes.

| # | What | Backend work | Schema change | JPA? | Size |
|---|---|---|---|---|---|
| G1 | Dashboard "Pending disbursals" as an amount | Add `pendingDisbursalAmount` (sum of `total_net` for PROCESSING/LOCKED runs with no POSTED/PAID batch) to `PayrollDashboardService.KpisDto`; `GET /v1/payroll/dashboard/kpis`, `payroll.runs.read` | No | No (`payroll.*` is JDBC) | S |
| G2 | Run paid date without `hrms.disbursement.read`; payslip list paid date and period days | Add `paidAt` to `RunDto` (`RUN_SELECT`'s lateral join already reads the PAID batch); add `paidAt` and `totalDays` to `MyPayslipDto` in `listMyPayslips` | No | No | S |
| G3 | Dashboard with several companies | Frontend: add every company's run per period (the runs list already has them); steps for one run (company picker) or per company | No | No | S |
| G4 | Salary structure summary tiles and a server-side list (+ "No structure" filter) | `GET /v1/payroll/structures/summary` (active headcount, with and without a structure, average annual CTC, revised this FY + last revision batch reason and date) and a paged `GET /v1/payroll/structures?page&size&q&departmentId&has=` returning effective from, CTC, gross, **net** (PayrollEngine for the page) and tax regime; `payroll.structure.read` | No | No | M |
| G5 | Payslip status in a run (Ready / Needs review / On hold) and a salary hold that keeps someone out of the bank file | New table `payroll.run_employee_flags` (tenant_id, run_id, employee_id, status REVIEW\|HOLD, reason, by, at) via migration; JDBC service; `PUT/DELETE /v1/payroll/runs/{id}/employees/{empId}/flag`; status added to `GET /runs/{id}/employees`; `DisbursementBatchService.buildFromRun` skips held people; reuse `payroll.runs.manage` (a new permission would need a grant to OWNER and SUPER_ADMIN in the migration); coordinate with the PgPayroll auditor | **Yes (new table)** | No | L |
| G6 | PLI totals, status filter and department (All awards) | `GET /v1/pli/awards/summary` (`hrms.pli.read`): proposed and approved counts and sums, paid this FY; `status` param on `GET /v1/pli/awards`; department in `PliController.enrich` | No | Yes (`pli_mgmt.pli_awards`; read only) | S |
| G7 | "My incentives" totals | `GET /v1/pli/my/summary` (`hrms.pli.read.self`) | No | Yes (read only) | S |
| G8 | PLI pool threshold ("pools pay out from 85%"), **only if the client wants it** | A per-company threshold: new JDBC column on `payroll.settings` or a new `pli_mgmt.pli_settings` table; read by the targets view and CSV. Today pools pay at 100%. | Yes (new column or table) | No | S |
| G9 | PLI award "Rating basis" as a type, **only if adopted** (recommended: keep the number) | An unmapped `rating_basis_type` column on `pli_mgmt.pli_awards`, written with JDBC (the entity must not map it), or a side table | Yes | Yes (table is JPA-mapped; new column must stay unmapped) | S |
| G10 | Advance totals (company and mine), Recovering / Repaid filter, department | `GET /v1/advance/summary` (`hrms.advance.read`, scoped like the list: tenant-wide only with `hrms.advance.disburse`) and `GET /v1/advance/my/summary` (`request.self`); repaid this FY from `advance_mgmt.advance_ledger_entries`; `phase=RECOVERING\|REPAID` on `GET /v1/advance/requests`; department in `enrich` | No | Yes (`advance_mgmt.advance_requests`; read only) | S |
| G11 | An employee opens their own advance's recovery plan and history | Allow `hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')` on `/v1/advance/{id}/summary\|schedule\|ledger`, with the same ownership check as `GET /requests/{id}` | No | No | S |
| G12 | Approver name before sending a request | `GET /v1/advance/my/approver` (`request.self`), reusing `AdvanceController.resolveApprover` (manager → terminal approver → delegation) | No | No | S |
| G13 | Record payment with a bank reference and a chosen first deduction month | Optional body `{paymentReference, firstDeductionMonth}` on `POST /v1/advance/requests/{id}/disburse`; pass the month to `initSchedule` and the reference to the DISBURSE ledger row (hard-coded `'disbursement'` today) | No | No (ledger and schedule are JDBC) | S |
| G14 | Ledger rows named by payroll month ("Recovered · May payroll") | Add the run's period label to `AdvanceRecoveryService.LedgerRowDto` (join `payroll.runs`) | No | No | S |
| G15 | "My claims" totals | `GET /v1/expense/my/summary` (`hrms.expense.claim.self`): waiting and approved amounts, reimbursed this year | No | Yes (`expense_mgmt.expense_claims`; read only) | S |
| G16 | Expense approvals: department and **policy check** (list and claim view) | Add `department` and `policyCheck {result WITHIN\|OVER_LIMIT\|RECEIPT_MISSING, policyName, cap}` to `ExpenseClaimResponse`, worked out against the active policies (the same merge as `enforceCategoryCaps`) and `requiresReceipt` against the lines' receipts | No | Yes (read only) | S |
| G17 | The limit hint for employees on Submit a claim | `GET /v1/expense/policies/caps?companyId` (`hrms.expense.claim.self`): active cap and receipt expectation per category (employees don't hold `policy.read`) | No | Yes (read only) | S |
| G18 | F&F totals, status tabs from the server, department and exit status | `status` param on `GET /v1/fnf/settlements` (`FnfService.getByStatus` exists); `GET /v1/fnf/summary` (`hrms.fnf.read`); department and employment status in `FnfController.enrich` | No | Yes (`fnf_mgmt.fnf_settlements`; read only) | S |
| G19 | Bank file readiness before a file exists ("Fix before you prepare the file", "N of M", each person's bank •••• last4) | `GET /v1/payroll/runs/{id}/bank-readiness` (`hrms.disbursement.read`), reusing the query in `DisbursementBatchService.buildFromRun` (primary account, IFSC pattern) for processed or locked runs | No | No (reads `hrms.employee_bank_accounts` with JDBC, as the build does) | S |
| G20 | **Undo** for inline approve and reject (PLI awards, advances, expense claims; README) | `POST …/decision/undo` for each: within a short window and only while nothing happened downstream (advance not disbursed; claim not reimbursed or in a batch; award not in a run or paid); same permission and object scope as the decision; audited; notifications withdrawn. Shared with the Team approvals auditor. | No | Yes (status values change, no column change) | M |
| G21 | TDS options on Payroll settings (default regime; employees may choose), **only if the client wants them now** | New JDBC columns on `payroll.settings` + `SettingsDto` fields; the default regime used for new structures; an employee regime-choice endpoint (a new permission granted to OWNER and SUPER_ADMIN). TDS calculation itself stays out of scope (L+). | Yes (new columns) | No | M |
| G22 | A pay date separate from the processing day, **only if wanted** | New JDBC column `payroll.settings.salary_pay_day`; `PayrollCalc.payDate` uses it | Yes (new column) | No | S |
| G23 | An in-progress month on My payslips (no figures) | `GET /v1/payroll/payslips/me/upcoming` (`payroll.payslip.read.self`): period and "being prepared" only, so no draft numbers leak | No | No | S |
| G24 | F&F suggested components | `GET /v1/fnf/suggestions?employeeId` (`hrms.fnf.process`): pro-rata salary from the structure and last working day, leave encashment from balances, notice shortfall, outstanding advance (the server already requires the advance deduction to match) | No | No | L |

**Frontend-only work that needs no backend:**
- The pill tabs for PLI, Advances, Bank and F&F.
- Removing the Payroll section bar and moving its leave guard.
- The multi-company dashboard sums (G3).
- The tax-regime field on the structure form.
- The receipt-required field on the policy form.
- Grouping batch items by employee.
- The payslip ledger TDS row.
- The cycle preview facts.
- Masking the profile debit account.

---

## 4. Conflicts with today's behaviour or earlier client decisions

In each case the recommendation is to keep the behaviour and adapt the design.

- **C1. Sandwich rule.** The design says "Coming soon", but it is implemented (`LopCalculator`) and editable today. Keep the switch.
- **C2. Statutory switches.** The design has no On/Off for PF, ESI, PT and LWF. Keep the switches (payroll reads them).
- **C3. Payroll settings layout.** The design is a grid of form cards with Save in the header. The client adopted the SettingsKit pattern for every settings page (sticky "On this page", unsaved-changes bar with Discard, leave guard, view-only mode). Keep those behaviours in the new look. Settings stay in their own sections: Payroll settings under Payroll, expense policies under Expenses, salary components and statutory settings under Master.
- **C4. Cycle preview dates.** The design shows the processing day and the pay date as two different dates. The backend has one value, the processing day, which sets the pay date. Show one date, or build G22.
- **C5. PLI threshold.** The design says pools pay from 85% (with the 88% team still earning). The code pays a pool only at 100% or more. This is a business rule; ask the client.
- **C6. PLI rating basis.** The design has a type list; the API and database store a number (0–5 rating). Keep the number unless the client says otherwise (G9).
- **C7. PLI actuals.** The design has no way to enter a target's actual achieved value. Keep each target's Edit (target, actual, pool) and the CSV export.
- **C8. "Issue advance".** The design reads as a direct issue by finance, with a first-deduction month. Today it is raised on the employee's behalf, goes to their approver, then finance records the payout. There is segregation of duties: you can't approve or disburse your own, and a department manager only sees routed requests. Keep the flow: label it as raising a request, and choose the first deduction month at payout (G13).
- **C9. Advance views not in the design.** The design has no Approvals view for approve or disburse holders without `hrms.advance.read` (possible with custom roles) and no "Record full repayment". Keep both.
- **C10. Expenses "Approved, to be paid".** The design's Approvals tab shows only "Waiting for your OK". Today the same tab also shows approved claims with **Mark reimbursed** (`hrms.expense.reimbursement`). Keep it (question 7).
- **C11. Expense categories.** The design's are policy-style names ("Travel — local", "Internet & phone"). The API takes the `ExpenseCategory` enum (TRAVEL, FOOD, …). Keep the enum.
- **C12. Expense line date.** The design's line form has no Date field, but the API requires `expenseDate`. Keep it, on the calendar component.
- **C13. Runs list.** The design has no **New run**. Keep it, because it is the only way to create a run. The "Overview / Employees / Skipped" tabs on the list page need a rule (this month's run, else the latest).
- **C14. Salary split.** The prototype's `pySplit` (basic 40%, …) is sample logic. Keep the agreed split (Basic 50%, HRA 40% of basic, ₹1,600 conveyance from ₹20,000, the rest special allowance) and the scaling of existing structures.
- **C15. Pending disbursals.** An amount in the design, a count today. Build G1.
- **C16. Employee payslips.** The design shows the month being prepared with a gross figure. The server deliberately returns only LOCKED and PAID payslips to employees ("an employee never sees draft/processing numbers"). Keep the rule: no row, or a row without figures (G23).
- **C17. Two designs for `/me/payslips` and `/me/salary`.** PgPay's `me-slips`/`me-salary` are for the admin persona's My Workspace; EmpPay's `e-slips`/`e-salary` are for employees. One route can't depend on the role. Also, the ESS group stays hidden for OWNER, ADMIN and SUPER_ADMIN (client rule; `administersWorkspace` in PlatformShell), so admins reach My workspace from the More panel.
- **C18. Shared routes.** `/hrms/advances`, `/hrms/pli` and `/hrms/expenses` are each designed twice: admin (PgPay) and self-service (EmpClaims `e-claims`/`e-adv`). The permission-driven switch already exists (`PayrollContainer` returns `<Advance/>` or `<Pli/>` for non-admins; Expense views by permission). Keep one route per page and coordinate with the EmpClaims auditor.
- **C19. Page order in the Payroll group.**
  - Design: Payroll dashboard, Processing & payslips, Salary structure, Payroll settings, PLI, Advances & loans, Bank disbursement.
  - Today: Dashboard, Salary Structure, Processing & Payslips, …
  - Payroll configuration isn't in the design; it stays under Master. The lead decides the order.
- **C20. Bank profiles setup page.** In the design, profiles are a tab of Bank disbursement. `/hrms/bank-disbursement/setup` today also has the run picker, batch tools and a net-pay band chart, which the design doesn't show. The route and its test must keep working (question 9).
- **C21. Titles.** The design uses sentence case ("Payroll dashboard", "Production-linked incentive", "Advances & loans", "Expense center", "Full & final settlement"). Today's titles are "Payroll Dashboard", "Production-Linked Incentive (PLI)", "Expenses", "Full & final settlements". Tests assert today's headings (section 5).
- **C22. Sub-views vs side panels.** PgPay swaps the page for in-page sub-views with a Back link; the README's pop-up rule describes square side panels. Today these are drawers. Decide once for the module (question 10). If sub-views, put them in the URL so they stay linkable.
- **C23. Rail highlight** (`src/layouts/railLit.ts` + `live-rail-highlight.mjs`). Payroll settings lights **Payroll**; expense policies light **Expense Management**; the rail item you came through stays lit. Keep this with the new rail labels.
- **C24. Calendar.** Every date and month field uses `src/shared/components/calendar`, never native inputs (the prototype uses `type=date`).
- **C25. Greeting and Companies restore.** Not used by these pages, except that company pickers should leave out archived (Inactive) companies.

---

## 5. Risks

**Live tests that assert today's markup** (`apps/platform/e2e/recovery/`):

- **`live-design-payroll.mjs`**
  - Asserts `navigation "Payroll sections"` on all 7 routes and exact headings "Payroll Dashboard", "Salary Structure", "Processing & Payslips", "Payroll Settings", "Production-Linked Incentive (PLI)", "Advances & Loans", "Bank Disbursement".
  - Runs: "New run", "Create run", "Process" / "Process payroll", "Lock" / "Lock run", "Reopen for corrections" / "Reopen payroll", placeholder /Wrong LOP/, "Download payroll register", tab or button "Employees", `tbody` button "Payslip", "Download PDF", drawer text "Preview" and "Rupees … only".
  - Bank: text /Not prepared|Waiting for lock|File generated|Paid/ and the "Bank profiles" button → `/hrms/bank-disbursement/setup`.
  - Salary: "Edit", "Edit salary structure|Add salary structure", "Income tax (TDS)" + "Not calculated yet".
  - Settings: switch /Apply Provident Fund/, "1 change · used by runs processed after saving", "Discard".
  - PLI: "Manage awards" → "PLI awards".
  - Advances: row "Active deduction", "View", "Advance details", "Recovery options", /Record full repayment|Write off balance|Defer/.
  - Reader: /My Advances|Request Advance/.
- **`live-payroll-access.mjs`**
  - Run page: "Reopen for corrections", "Reopen payroll", "Process", tab "Employees", "Payslip".
  - Bank: alert /no usable bank account/, /\d+ without bank details/, "Download", "Mark transferred", "Rebuild file", "File generated".
  - Error texts: "Unable to load this payslip. It may no longer be available for this run.", "Try again", "Couldn’t load this payroll run".
- **`live-design-expenses.mjs`:** "New claim", placeholder "e.g. Client visit — Mumbai", "Submit Claim", "Waiting for your OK", "Show line items", "Approve", "Approved, to be paid", "Mark reimbursed".
- **`live-money-modals.mjs`**
  - Expenses: heading "Expense Center", a `.ut-card` containing "Reimbursed this month".
  - Claim rejection: "Reject" → dialog "Reject claim", label "Reason (optional)", "Confirm rejection", "Claim rejected".
  - Policies: "Deactivate", "Policy deactivated", "Inactive".
  - Advances: dialog "Reject advance", "Advance rejected".
- **`expense-batches-live.mjs`**
  - Building: "Build batch", date picker dialog "Choose date" / "Yesterday" / "Today", "Batch notes", "Build draft batch", heading "Build reimbursement batch".
  - Posting and cancelling: "Post batch" / "Confirm post batch", "Cancel batch" / "Confirm cancel batch", "View expense items", "Close panel".
  - Paying: "Record payment", labels "Payment reference / UTR" and "Payment notes", "Confirm payment recorded".
  - Status texts /^posted$/, /^cancelled$/, /^paid$/.
- **`live-fnf-admin.mjs` and `live-fnf-tabs.mjs`**
  - Review: "Review settlement", dialog "Settlement details", "Close panel", lower-case statuses "cancelled", "approved", "paid", the separation-of-duties sentence.
  - Decisions: "Cancel settlement" / "Confirm cancellation", "Approve settlement" / "Confirm approval", "Record payment" / "Confirm payment recorded".
  - Create: "Create settlement", labels "Find employee", "Component N label/amount", "Add deduction", "Settlement notes", "Exit status", "Confirm process settlement", toast "Settlement processed and ready for approval", "Selected: …".
  - Page: heading "Full & final settlements", the empty texts, and the `?tab=create&employeeId=` hand-off from the Exit page.
- **`live-advance-admin.mjs`:** heading "Company advances", label "Advance status", "View advance", heading "Salary recovery", "Defer month", "Reason / payment reference", "Review and confirm", "Defer installment", "Close panel". This test already looks stale for the owner, who now gets `PayAdvances`.
- **`live-design-last.mjs`**
  - Reader `/hrms/pli`: heading "My incentives" (h1), "Waiting for approval", "Paid to you", no `[aria-label="Incentive views"]`.
  - `/hrms/bank-disbursement/setup`: heading "Bank profiles & payment tools", link "← Bank disbursement", run `select` options.
- **`live-notices-browser.mjs`:** `/payroll` → heading "Payroll Dashboard" (exact).
- **`live-rail-highlight.mjs`:** the `OWN_BAR` regex (payroll pages draw their own bar, so no shell tab row); Payroll settings lights "Payroll"; expense policies light "Expense Management".
- **`live-settings-restored.mjs`:** snapshots the rail, headings, "Payroll's section bar" and "Expenses' views" on `/hrms/payroll-dashboard`, `/hrms/payroll/settings`, `/hrms/expenses`, `?tab=policies`, and compares them with commit `5f45946` **exactly**. It will fail by design; rewrite it to compare where each address lands, not the markup.
- **`live-dead-entrypoints.mjs`:** the `/me/salary` shortcut on `/me`, the salary-structure action on `/me/payslips`, "No salary structure yet".
- **`live-w3-r4.mjs`:** the calendar pickers on `/hrms/expenses?tab=submit` and `?tab=batches`.
- **Other route checks:**
  - `live-w3-search.mjs`: search opens `/hrms/payroll-dashboard`.
  - `live-exit-center.mjs` and `live-employee-exit.mjs`: links to `/hrms/fnf` ("Open full & final settlements").
  - `live-directory-search.mjs`: visits `/hrms/fnf`.
- **Unit tests:** `src/shared/navigation/pageRegistry.test.ts` (tab parameter per parent: `expenses: 'tab'`, `fnf: 'tab'`; which roles open `/hrms/payroll-dashboard`, `/me/payslips`, `/hrms/payroll/runs`) and `src/shared/search/search.test.ts` ("Payroll dashboard" match). The API-only tests `live-w1b`, `live-w1f` and `live-w1g` aren't affected by markup.

**Other risks:**
1. **Real payroll.** Tests must never lock or pay a real run. `live-design-payroll.mjs` uses a Jun 2027 fixture run and deletes it; keep that pattern.
2. **Load.**
   - `loadDirectory()` pulls up to 4,000 people for the salary, PLI and runs pages.
   - Salary structure fetches one structure per visible row.
   - PLI loads every target page.
   - G4 and the status filters (G6, G10, G18) remove the page-scoped figures and most of this load.
3. **Dashboard with several companies** shows one company's run (G3). This is an existing data bug.
4. **Leave guard.** Moving the Payroll pages to the shell's Pages panel and pill tabs will bypass Payroll settings' unsaved-changes guard unless the shell calls it.
5. **Hand-applied migrations.** Production applies migrations by hand. G5, G8, G9, G21 and G22 add tables or columns; their blocks must hide or show a dash until the migration exists. Any new permission must be granted to OWNER and SUPER_ADMIN in the same migration (`OwnerPermissionInvariantCheck`).
6. **Departments without permission.** The container fetches `GET /v1/hrms/departments` without checking `hrms.department.read`. A role without it (a custom finance role, say) gets refused calls; `live-*` checks fail on any 4xx.
7. **Generator.** `scripts/design-build.mjs` still knows the old Pay* views; a manual run would bring them back.

---

## 6. Open questions

1. **PLI threshold.** Do team pools pay from 85% achievement (design) or only at 100% (today)? If 85%: pro-rated or the full pool, and one threshold per company?
2. **PLI rating basis.** Keep the numeric rating, or switch to basis types (Target achievement / Manager rating / Fixed award)?
3. **Payslip hold.** Build "Needs review / On hold" per payslip, where a hold keeps the person out of the bank file (new table, L)? Or ship the Employees tab without those filters for now?
4. **TDS card.** Store "Default tax regime" and "Employees may choose their regime" now (new settings columns, plus an employee choice)? Or keep the whole card "Coming soon"?
5. **Pay date.** One date (processing day = pay date, as today), or a separate pay day as the cycle preview shows?
6. **Issue advance.** Keep "raise on behalf → employee's approver → finance records payout" (today, with segregation of duties)? Or should finance be able to issue an advance directly, skipping approval?
7. **Mark reimbursed.** Where does it go for a single approved claim? Keep the "Approved, to be paid" list on the Approvals tab (today), or pay only through reimbursement batches?
8. **One design for `/me/payslips` and `/me/salary`.** Use EmpPay's self-service design for everyone (recommended) or PgPay's `me-slips`/`me-salary`? Should the month being prepared appear without figures?
9. **Bank profiles page.** Fold `/hrms/bank-disbursement/setup` into Bank disbursement → "Bank profiles" (the old address redirects to the tab)? Can the net-pay band chart go, with the run picker kept as `?run=`?
10. **Details and forms.** For payroll pages: in-page sub-views with a Back link (as PgPay draws them, put in the URL) or square side panels (README pop-up rule)?
11. **F&F suggestions.** Should "Create settlement" suggest amounts (last month's pro-rata salary, leave encashment, notice shortfall, outstanding advance: G24, L)? Or keep manual components with just the design's labels pre-filled?
