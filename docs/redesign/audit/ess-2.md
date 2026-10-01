# Audit: Self-service Pay, Documents and Growth (`EmpPay`, `EmpClaims`, `EmpDocs`, `EmpGrowth`)

Phase 0, read-only. Repo `C:\REACT\unifiedtree-saas` at `e32a4dc6`.

- **Prototype files** (all in `design_handoff_hrms_redesign/prototype/`; line numbers below are in these files):
  - `EmpPay.dc.html`: Payslips (`e-slips`, lines 16–42) and Salary (`e-salary`, lines 43–63). For `e-claims` / `e-adv` it hands over to EmpClaims (line 12).
  - `EmpClaims.dc.html`: Expense claims (`e-claims`, tabs "My claims" lines 14–23, "New claim" lines 24–46) and Advances (`e-adv`, lines 47–65).
  - `EmpDocs.dc.html`: one template for Letters (`e-letters`), My documents (`e-files`), My assets (`e-assets`), Policies (`e-pol`): header 12, "needs you" banner 13, card grid 14–25, upload tile 26, assets footnote 27, per-page logic 43–62.
  - `EmpGrowth.dc.html`: Reviews & goals (`e-rev`, lines 12–35) and Learning (`e-learn`, lines 36–40).
  - Nav model `hrms-core.js` line 69–71: `epay` (Payslips · Salary · Expense claims [My claims, New claim] · Advances), `edocs` (Letters · My documents · My assets · Policies), `egrow` (Reviews & goals · Learning). These are the "My work" modules for the manager and employee personas (`RGROUPS`, line 92).
  - Search quick actions that open these pages: "Download payslip", "New expense claim", "Sign a letter" (`ACTS.employee`, lines 108–115).
- **Reference screenshots:** `/c/REACT/ut-wt/redesign/ref/employee/{epay,edocs,egrow}__<page>__<tab>__{light,dark}__1440.png` (all 11 exist).
- **Sample data:** `emp-data.js` → `pay`, `docs`, `grow` was read only to learn which data points each screen shows. Nothing from it may be ported.

**Status words used in the tables**
- **exists**: served today by the named hook and endpoint.
- **partial**: served, but part of what the design shows is missing (the row says which part).
- **missing**: no endpoint, field or feature today.
- **client**: worked out in the browser from data that exists; no backend needed.

**What was checked live (read-only).**
- The local API (127.0.0.1:8080) was up. I signed in as `reader@` (EMPLOYEE), `mgr@` (DEPT_MANAGER) and `owner@` (OWNER) and made GET calls only.
  - `/v1/payroll/payslips/me` returned 4 slips, LOCKED or PAID, with `lockedAt` and no paid date.
  - `/v1/payroll/structures/me` returned `derivedFromCtc: true` with Basic only.
  - `/v1/letters/my` returned letters in status `GENERATED`, so HR's **unsent** letters are visible to the employee.
  - `/v1/document/my` was empty; `/v1/document/my/missing` listed 4 required types.
  - `/v1/performance/cycles` returned **403** for the employee.
- The recovery database (port 55432) was queried read-only for role grants and table columns.

---

## 0. Summary

1. **Every page in this area already exists** with real data on the module kit: `/me/payslips`, `/me/salary`, `/hrms/expenses?tab=my|submit`, `/hrms/advances?tab=my|request`, `/hrms/letters/my`, `/hrms/documents?view=my`, `/me/assets`, `/hrms/policies`, `/hrms/performance?view=my-reviews|my-goals`, `/hrms/learning?view=my`. Nothing on them is static. The redesign is a re-layout on the new kit plus backend work for what the design adds.
2. **Things the design shows that the product cannot do yet (real features, not just fields):**
   - sign a letter
   - confirm you received an asset
   - report an asset problem
   - ask payroll about a payslip
   - save a self-review as a draft
   - "Kind words" (kudos)
   - review-cycle deadlines and a "Shared with you" step
   - a policy "accept by" date
   - progress-tracked courses (required, due, duration, % done, Start/Continue)
   - receipt OCR
   - an advance limit

   Most need a **new table**. Every table they would touch is either JDBC-only already or can get a side table, so **no JPA-mapped column has to change**.
3. **Small read-side gaps (no schema change):**
   - a paid date on payslips, and financial-year totals
   - the employee's own salary history
   - my-claims totals across all pages, the claim approver's name, and category caps readable by the claimant
   - an approver preview for claims and advances
   - an advance plan preview, and the employee's own advance schedule
   - my acknowledgement dates for policies
   - a "my current cycle" read for employees (they get 403 on cycles today)
   - the latest note on each goal, and the reviewer type on reviews
   - the letter sender's name, and the letter body for review
4. **Design copy that contradicts how the product works** (keep the behaviour, change the copy):
   - Expense claims are **not** paid with salary. Finance pays them through reimbursement batches.
   - Income tax (TDS) is **not** calculated by payroll today.
   - Advances have **no limit**, allow **1–60 months** and a free-text reason.
   - The first advance deduction is only known at payout.
5. **Structure and permission conflicts:**
   - **The design merges tabs; DECISIONS 11 keeps them.** The design merges My reviews + My goals into one page, merges My training + Programs into one page, and shows Advances as one page. DECISIONS 11 keeps today's tab names and order. So the design's sections map onto today's tabs (§5).
   - **Advances:** people with `hrms.advance.read` (DEPT_MANAGER, HR_MANAGER, FINANCE_LEAD, OWNER, SUPER_ADMIN, ADMIN) get the **admin** page at `/hrms/advances`, with no "My advances" or "Request" view. My work › Pay › Advances would dead-end for them.
   - **Policies:** policy admins (`hrms.policy.write`+`read`: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER) get the Master "Policy Documents" page at `/hrms/policies` and **cannot acknowledge a policy themselves**. HR_MANAGER is not an admin role, so it gets My work, and its Documents › Policies would open the admin page.

---

## 1. Screen map

| # | Design page (prototype) | Tabs in the design | Route(s) today | Files today | Page exists? |
|---|---|---|---|---|---|
| 1 | Pay › Payslips (`EmpPay` `e-slips`, 16–42) | none | `/me/payslips` | `modules/hrms/payroll/EmployeePayslips.tsx`, `design/dc/PayslipDrawer.tsx` (+`.view.tsx`), hooks `modules/hrms/api/usePayrollRuns.ts` (`useMyPayslips`, `useMyPayslip`, `downloadMyPayslipPdf`) | Yes (tiles + month rows + payslip drawer). PgPay's `me-slips` designs the same route for the admin persona (pay.md C17). |
| 2 | Pay › Salary (`EmpPay` `e-salary`, 43–63) | none | `/me/salary` | `modules/hrms/payroll/MySalaryStructure.tsx`, hook `api/usePayroll.ts` (`useMySalaryStructure`) | Yes. PgPay's `me-salary` designs it too. |
| 3 | Pay › Expense claims › My claims (`EmpClaims` `e-claims` tab 0, 14–23) | My claims · New claim | `/hrms/expenses?tab=my` | `modules/hrms/Expense.tsx` (`MyClaimsTab`, `ClaimDetailPanel`), `expense/expenseStatus.ts`, hook `api/useExpense.ts` | Yes. Tab label today "My claims". |
| 4 | Pay › Expense claims › New claim (`e-claims` tab 1, 24–46) | (same) | `/hrms/expenses?tab=submit` | `Expense.tsx` (`SubmitTab`), `shared/components/calendar` (`DateField`) | Yes. Tab label today **"Submit a claim"**; the header button is "New claim". |
| 5 | Pay › Advances (`EmpClaims` `e-adv`, 47–65) | none (one page) | `/hrms/advances?tab=my\|request` | Without `hrms.advance.read`: `modules/hrms/Advance.tsx` (`MyAdvancesTab`, `RequestTab`). With it: `payroll/PayrollContainer.tsx` → `design/dc/PayAdvances.tsx` (admin). Hooks `api/useAdvance.ts` | Partly: yes for employees; **no self view** for `advance.read` holders |
| 6 | Documents › Letters (`EmpDocs` `e-letters`) | none | `/hrms/letters/my` (also `/hrms/letters` → My letters for self-only readers) | `modules/hrms/letters/LettersHub.tsx`, `GeneratedLetters.tsx` (`GeneratedLettersList mine`), `GeneratedLetterDetail.tsx`, `lettersView.ts`, hook `letters/api/useLetters.ts` (`useMyLetters`, `downloadLetterPdf`) | Yes (table). No signing. |
| 7 | Documents › My documents (`e-files`) | none | `/hrms/documents?view=my` | `modules/hrms/DocumentVault.tsx` (`MyDocumentsTab`, read-only); the self-upload UI is on `/profile` (`pages/MyDocumentsCard.tsx`); hook `api/useDocument.ts` | Yes, read-only. Upload exists only on `/profile`. |
| 8 | Documents › My assets (`e-assets`) | none | `/me/assets` | `modules/hrms/onboarding/MyAssets.tsx`, hook `onboarding/api/useOnboarding.ts` (`useMyAssets`) | Yes (list only) |
| 9 | Documents › Policies (`e-pol`) | none | `/hrms/policies` (non-policy-admins only) | `App.tsx` `PoliciesRoute` → `modules/hrms/Policies.tsx` (`PoliciesTab`); hook `api/usePolicy.ts` | Yes for non-admins; admins get `master/MasterContainer` |
| 10 | Growth › Reviews & goals (`EmpGrowth` `e-rev`, 12–35) | none (one page) | `/hrms/performance?view=my-reviews` and `?view=my-goals` | `modules/hrms/Performance.tsx` (`MyReviews`, `ReviewCard`, `MyGoals`, `MyGoalHistory`), `performance/shared.tsx` (`ReviewGoalsPanel`, `GoalHistoryList`), hook `api/usePerformance.ts` | Yes, as two tabs. `performance/EmployeePerformancePage.tsx` is **HR's per-person page** (`/hrms/performance/employees/:id`, `hrms.performance.read`), not the employee's own page: an EMPLOYEE is stopped by its route guard. |
| 11 | Growth › Learning (`e-learn`, 36–40) | none (one page) | `/hrms/learning?view=my` (+ `?view=programs`) | `modules/hrms/Learning.tsx` (`MyTrainingTab`, `MySkillsPanel`, `MySkillProposals`, `ProgramsTab`), `learning/ProgramDetail.tsx`, hook `api/useLearning.ts` | Yes, as two tabs |

**Deep links into these pages that must keep working:**
- Search actions (`shared/search/actionRegistry.ts` 43–50):
  - `submit-expense` → `/hrms/expenses?tab=submit`
  - `request-advance` → `/hrms/advances?tab=request`
  - `my-payslip` → `/me/payslips`
  - `upload-document` → `/hrms/documents?view=my`. Today this lands on a read-only list; the design fixes that by adding upload.
- Notification links (`core/notifications/notificationStore.ts` 242–247): `ADVANCE_RAISED_FOR_YOU` → `/hrms/advances`, `SALARY_REVISED` → `/me/salary`, `SKILL_ASSESSMENT_APPROVED|REJECTED` → `/hrms/learning?view=my`.
- Backend `data.route` values and search results: `/hrms/expenses?tab=my`, `/hrms/documents?view=my`, `/hrms/policies`, `/me/payslips` (`AuditRecordNames`, `PolicyNoticeService`, `GlobalSearchService`).
- Home shortcuts in `ess/EssDashboard.tsx` 96–101.
- The `?tab=` / `?view=` values are kept by `useView` (ModuleKit), which falls back to the first allowed view. `pageRegistry.test.ts` pins the parameter per page: `expenses: 'tab'`, `documents|performance|learning: 'view'`.

---

## 2. Navigation and permissions today

### 2.1 Who holds what (demo tenant, `rbac.role_permissions`)

| Permission | EMPLOYEE | DEPT_MANAGER | HR_MANAGER | FINANCE_LEAD | OWNER / SUPER_ADMIN / ADMIN |
|---|---|---|---|---|---|
| `payroll.payslip.read.self`, `payroll.structure.read.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.expense.claim.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.expense.policy.read` | – | – | ✓ | ✓ | ✓ |
| `hrms.advance.request.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.advance.read` (turns `/hrms/advances` into the admin page) | – | ✓ | ✓ | ✓ | ✓ |
| `hrms.letters.read.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.document.read.self`, `.write.self`, `hrms.document.type.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.onboarding.asset.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.policy.read`, `hrms.policy.acknowledge.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.policy.write` (turns `/hrms/policies` into the Master page) | – | – | ✓ | – | ✓ |
| `hrms.performance.review.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hrms.performance.read` | – | ✓ | ✓ | – | ✓ |
| `hrms.learning.enroll.self`, `hrms.learning.read`, `hrms.learning.skill.assess.self` | ✓ | ✓ | ✓ | ✓ | ✓ |

(The legacy `MANAGER` role has the same codes as EMPLOYEE here.)

### 2.2 How these pages are reached today

- Menus are **permission-only**: `PlatformShell.isVisible()` → `menuRule(path, group)`. The `visibleForRoles` arrays are no longer read.
- The whole "Employee Self Service" group (`ess`) is **hidden for `ADMIN_ROLES`** (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN; `administersWorkspace`, PlatformShell ~449–461). Keep this. DECISIONS 11 applies it to every My work item.

| Page | Rail entry today (group → label) | Menu rule that decides it | Search / "/" entry (`pageRegistry.ts`) |
|---|---|---|---|
| Payslips | Me (`ess`) → Payslips | registry `me-payslips`: `any('payroll.payslip.read.self')`, module `payroll`, `self: true` (l.102) | same |
| Salary | Me → Salary | `me-salary`: `payroll.structure.read.self`, module `payroll`, `self` (l.103) | same |
| Expense claims | "Expense Management" → Expense Center (not under Me) | registry `expenses` anyOf 6 codes incl. `hrms.expense.claim.self` (l.205); tabs `expenses:my`, `expenses:submit` add `claim.self` (l.207–208) | `me-claims` (l.112) → `/hrms/expenses?tab=my` |
| Advances | "Payroll" → Advances & Loans (not under Me) | registry `pay-advances` any(`request.self`, `read`, `approve`, `disburse`) (l.200) | `me-advances` (l.111) → `?tab=my` |
| Letters | Me → Letters (`/hrms/letters/my`, `also: ['/hrms/letters']`) | registry `me-letters`: `hrms.letters.read.self` (l.107) | same |
| My documents | **none** for employees (`recruit:/hrms/documents` needs `hrms.document.read` or `letters.template.read`, MENU_RULES) | — | `me-documents`: `hrms.document.read.self` (l.106) |
| My assets | Me → My assets | `me-assets`: `hrms.onboarding.asset.self`, `self` (l.108) | same |
| Policies | **none** for employees (the Master "Rules & Policies" link needs workforce/policy admin) | — | `policies`: any(`policy.read`, `policy.write`, `acknowledge.self`) (l.140, alias `me/policies`) |
| Reviews & goals | "Performance & Learning" → Performance Center | registry `performance` any(`read`, `write`, `review.self`) (l.213); tabs `performance:my-reviews`/`my-goals` add `review.self` (l.218–219) | `me-reviews`, `me-goals` (l.113–114) |
| Learning | "Performance & Learning" → Learning & Skills | registry `learning` any(`read`, `write`, `enroll.self`, `skill.read`) (l.220); tab `learning:my` adds `enroll.self` (l.222) | `me-training` (l.115) |

**What DECISIONS 11 means for this area:**
- My work › Pay / Documents / Growth each need their own `MENU_RULES` keys, copied from the `me-*` registry rules above.
  - Documents › Policies: copy `policies`, and point it at a self view (C22).
  - Include the admin-role exclusion.
- Add the keys to `railLit.SELF_SERVICE_RAIL`.
- When the person also sees an admin item with the same short label, label these "My pay" / "My documents" / "My growth". An HR_MANAGER, for example, sees admin Letters, Employee Vault and Expense Center.

---

## 3. Screens

In the tables, "Perm" is the permission checked today (endpoint `@PreAuthorize` / page `usePermission`).

### 3.1 Pay › Payslips (`e-slips`)

**Route and files:**
- `/me/payslips`.
- Guard: `RouteGuard anyOf [P.PAYROLL_PAYSLIP_READ_SELF]` + `ModuleGate payroll` (App.tsx ~763).
- Page: `EmployeePayslips.tsx`.

**Layout in the design:**
- Header: title, sub, and a "Hide amounts" pill.
- Two panes: the months list on the left, the selected payslip on the right. The payslip has a header band with a Download PDF button, a "where your gross went" stacked bar, earnings and deductions, and a footer with the days line and "Ask payroll".
- Below: 4 financial-year tiles.
- Today the page has 4 calendar-year tiles, month rows, and a drawer.

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| P1 | Month list: month label | `useMyPayslips` → `GET /v1/payroll/payslips/me` (`period`) | exists | `payroll.payslip.read.self` |
| P2 | Month list: "Credited Mon, 31 Aug" | list has `lockedAt` only; `payroll.runs.paid_at` / `pay_date` exist in the DB but not in `MyPayslipDto` | **partial** (E1) | same |
| P3 | Month list: take-home | same (`netPay`) | exists | same |
| P4 | Payslip head: "{month} · take-home", big net | list or `useMyPayslip` → `GET /v1/payroll/payslips/me/{runId}` | exists | same |
| P5 | Credit line "… to HDFC Bank ••4821" | detail `bankMasked` (bank) + paid date (P2) | **partial** (date) | same |
| P6 | Credit line note ("Includes ₹1,000 internet claim", "First month on the revised salary") | none. Claims are not paid through payroll (C1). Revision month would need salary history. | **missing** (E3) | — |
| P7 | "Where your ₹X went": gross | detail `gross` | exists | same |
| P8 | Bar/legend: take-home | detail `netPay` | exists | same |
| P9 | Bar/legend: income tax | detail `deductions[]` with code `TDS`, but **payroll does not calculate TDS** today (C12) | **partial** | same |
| P10 | Bar/legend: PF and professional tax | detail lines `PF_EMPLOYEE`, `ESI_EMPLOYEE`, `PT`, `LWF_EMPLOYEE` (grouped by code, client) | exists (client grouping) | same |
| P11 | Earnings lines (name, amount) | detail `earnings[]` | exists | same |
| P12 | Gross total | detail `gross` | exists | same |
| P13 | Deduction lines | detail `deductions[]` (e.g. `ADVANCE_RECOVERY`) | exists | same |
| P14 | Total deductions | detail `totalDeductions` | exists | same |
| P15 | "Paid for 31 of 31 days · no loss of pay" | detail `paidDays`, `totalDays`, `lopDays` | exists | same |
| P16 | YTD "Gross paid · Apr–Aug" | sum of list `gross` is possible, but the financial-year start (`settings.hr_configuration.fiscal_year_start`, `org.companies.fiscal_year_start` = `APRIL`) isn't exposed to the employee | **partial** (E2) | same |
| P17 | YTD "Tax deducted" | needs line totals across slips; TDS not calculated | **missing** (E2) | — |
| P18 | YTD "PF (yours)" | needs line totals (`PF_EMPLOYEE`) across slips | **missing** (E2) | — |
| P19 | YTD "Tax regime" | `useMySalaryStructure` → `GET /v1/payroll/structures/me` (`taxRegime`) | exists | **`payroll.structure.read.self`** (hide the tile without it) |
| P20 | YTD period label ("Apr–Aug") | financial-year start, as in P16 | **partial** (E2) | — |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Pick a month (list row) | client + `GET /v1/payroll/payslips/me/{runId}` | exists | `payroll.payslip.read.self` |
| A2 | Hide / Show amounts (header pill) | none (per-viewer preference; share it with Home's pay card) | **missing (frontend only)** (E6) | — |
| A3 | Download PDF | `downloadMyPayslipPdf` → `GET /v1/payroll/payslips/me/{runId}.pdf` | exists | same |
| A4 | "Something looks wrong? Ask payroll" | none | **missing** (E4) | — |

**Keep (not in the design):**
- The header link "Salary structure" to `/me/salary`, shown with `P.PAYROLL_STRUCTURE_READ_SELF`. `live-dead-entrypoints.mjs` asserts it.
- A readable state for a LOCKED-but-not-yet-PAID month ("Final · not paid yet" instead of "Credited", C13).
- The loading, error and empty states ("No payslips yet").

**Gates:**
- Nav: `me-payslips`.
- Endpoints: `PayrollRunController` 144–165, `hasAuthority('payroll.payslip.read.self')`.
- The detail endpoint returns 404 for anyone else's run.

**Kit pieces:**
- PageHeader + action pill, and the shell's single solid pill "Payslips" (no tabs).
- Card, a selectable ListRow (months), Button.
- **SplitBar** (new; also used by Salary).
- Legend rows.
- Small stat tiles (StatCard, compact variant, no icon or sparkline).
- Skeleton, EmptyState, error with Retry, Toast.
- SidePanel or Dialog for "Ask payroll".

### 3.2 Pay › Salary (`e-salary`)

**Route and files:**
- `/me/salary`.
- Guard: `RouteGuard anyOf [P.PAYROLL_STRUCTURE_READ_SELF]` + `ModuleGate payroll` (App.tsx ~737).
- Page: `MySalaryStructure.tsx`.

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| S1 | "Cost to company" big figure (monthly or yearly) | `GET /v1/payroll/structures/me` (`ctcMonthly`, `ctcAnnual`) | exists | `payroll.structure.read.self` |
| S2 | Counterpart line ("a month · ₹X a year") | same | exists | same |
| S3 | CTC split bar (each component's share) | `earnings[]` + `employerContributions[]`; share = line ÷ `ctcMonthly` (client) | **partial**: gratuity and health cover appear only if configured as components; derived structures may not add up to CTC (C17) | same |
| S4 | Split list: component, amount (×12 when yearly), % of CTC | same | **partial** (as S3) | same |
| S5 | "From CTC to take-home": CTC | `ctcMonthly` | exists | same |
| S6 | … employer PF, gratuity and health cover | `employerContribMonthly` (label from the real `employerContributions` names) | exists | same |
| S7 | … gross pay | `grossMonthly` | exists | same |
| S8 | … tax, PF and professional tax | `totalDeductions` (no TDS today, C12) | exists | same |
| S9 | … take-home | `netMonthly` | exists | same |
| S10 | Salary history: effective date, annual CTC, change %, reason | only `GET /v1/payroll/structures/employee/{id}/history` with **`payroll.structure.read`** (admin); nothing for self | **missing** (E5) | — |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Monthly / Yearly switch | client (×12) | **missing (frontend only)** | — |
| A2 | Hide / Show amounts | client (E6) | **missing (frontend only)** | — |

**Keep:**
- The effective-from date. `live-dead-entrypoints.mjs` asserts the page shows it and the first earning's name.
- Tax regime and PF status (they can go in the CTC card).
- The "Payslips" header link (`P.PAYROLL_PAYSLIP_READ_SELF`).
- The full-month note, and the empty state "No salary structure yet" (asserted).

**Kit pieces:** PageHeader, **SegmentedControl** (Monthly/Yearly), **SplitBar**, legend ListRows with a swatch, **Meter/ProgressBar** (flow rows), ListRow + StatusPill (history change chip), EmptyState, Skeleton.

### 3.3 Pay › Expense claims › My claims (`e-claims` tab 0)

**Route and files:**
- `/hrms/expenses?tab=my`.
- Guard: `RouteGuard anyOf` 6 expense codes + `ModuleGate hrms` (App.tsx 395).
- The view needs `usePermission('hrms.expense.claim.self')` (`Expense.tsx` 45–60).
- Page: `Expense.tsx` `MyClaimsTab`.

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| M1 | Stat "Waiting" amount | `useMyClaims` → `GET /v1/expense/my` (sum of SUBMITTED, **current page only**) | **partial** (E7) | `hrms.expense.claim.self` |
| M2 | … note "1 with Siddharth Rao" | count per page; the approver's name isn't in the response (only `approverId`) | **partial** (E7, E8) | same |
| M3 | Stat "Approved, not paid yet" amount | page-scoped sum of APPROVED (+ APPROVED_FOR_PAY) | **partial** (E7) | same |
| M4 | … note "Paid with your September salary" | not how claims are paid (C1) | **missing / conflict** | — |
| M5 | Stat "Paid back this year" amount | page-scoped sum of REIMBURSED | **partial** (E7) | same |
| M6 | … note "11 claims since January" | page-scoped count | **partial** (E7) | same |
| M7 | Claim card: title | `title` | exists | same |
| M8 | Status pill (Waiting / Approved / Paid) | `status` (DRAFT, SUBMITTED, APPROVED, APPROVED_FOR_PAY, REJECTED, REIMBURSED; `EXPENSE_STATUS_LABEL`) | exists | same |
| M9 | Date ("Mon, 21 Sep") | `submittedAt` | exists | same |
| M10 | "3 receipts · cab and meals" | `itemCount`, `receiptCount` exist; the item **categories** aren't on list rows (items are null in lists) | **partial** (E8) | same |
| M11 | "With Siddharth Rao since 21 Sep" / "Paid on 31 Aug" | `approverId` (no name), `submittedAt`, `reimbursedAt`; batch info for APPROVED_FOR_PAY not on the row | **partial** (E8) | same |
| M12 | Amount | `totalAmount` | exists | same |
| M13 | Step track: Sent → {approver} → Finance → Paid | worked out from `status`; approver name missing | **partial** (E8) | same |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | "New claim" (header) → the New claim tab | client (`setTab('submit')`) | exists | `claim.self` |

**Keep (in the product, not in the design):**
- Opening a claim's line items and receipts: `ClaimDetailPanel` → `GET /v1/expense/claims/{id}`, gated `anyOf(claim.read, claim.self)` + owner/approver/team object check.
- Attach or replace a receipt while the claim is waiting: `POST /v1/expense/claims/{id}/items/{itemId}/receipt`, `claim.self` + owner check.
- REJECTED with the approver's comment, and DRAFT (C7).
- Paging.

**Kit pieces:** PageHeader + primary Button, **StatCard** ×3 (the `UtStat` look: icon tile, label, value, note, tone; no sparkline), Card (claim), StatusPill, **StepTrack** (new kit piece; also used by Growth's cycle card and Leave requests), SidePanel (claim detail and receipts, replacing the inline expander), EmptyState, Skeleton, Toast.

### 3.4 Pay › Expense claims › New claim (`e-claims` tab 1)

**Route and files:**
- `/hrms/expenses?tab=submit` (`Expense.tsx` `SubmitTab`).
- Today: a claim title, a company picker (multi-company only), several line items (category, amount, date, merchant, description, receipt), notes, a limit warning and the total.

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| N1 | Category choices | `EXPENSE_CATEGORIES` = the enum `TRAVEL, FOOD, ACCOMMODATION, COMMUNICATION, OFFICE_SUPPLIES, MEDICAL, TRAINING, ENTERTAINMENT, OTHER` (the design shows 5 policy-style names, C2) | exists | `claim.self` |
| N2 | Category hint ("Up to ₹1,500 a day") | `useExpensePolicies` → `GET /v1/expense/policies?companyId` needs **`hrms.expense.policy.read`**, which employees and managers don't hold, so they get no hint today; the backend caps are per claim, not per day (C3) | **missing for claimants** (E9) | `policy.read` |
| N3 | Fields: amount, date, where (merchant), what (description) | `SubmitClaimPayload.items[]` (`amount`, `expenseDate`, `merchantName`, `description`) | exists | `claim.self` |
| N4 | Check "Within the ₹1,500 limit" / "₹X over the limit" | needs caps (as N2) | **missing for claimants** (E9) | — |
| N5 | Check "Add a receipt. Claims without one take longer." | client (file chosen); "expected by policy" needs `requiresReceipt` (as N2) | **partial** | — |
| N6 | Check "Paid with your October salary if approved by 25 Oct" | not a rule in the product (C1) | **missing / conflict** | — |
| N7 | "Send to {approver}" | none: the approver is the manager via delegation, worked out only on submit (`ExpenseController.submit`) | **missing** (E10) | — |
| N8 | Receipt chip: file name, size | client (`File`) | client | — |
| N9 | "amount and date read from the photo" | no OCR | **missing** (E11) | — |
| N10 | "Photo or PDF, up to 5 MB" | server rule: PDF/PNG/JPEG up to **10 MB** (`RECEIPT_FORMATS`, `RECEIPT_MAX_MB`, `ExpenseReceipts`) | exists (use the server's text, C5) | — |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Pick a category (pills) | client → `items[].category` | exists | `claim.self` |
| A2 | Add a receipt (dropzone) | `uploadReceipt` → `POST /v1/expense/receipts` (at submit) | exists | `claim.self` |
| A3 | Remove the receipt | client | exists | — |
| A4 | Send | `useSubmitClaim` → `POST /v1/expense/claims` (`title` @NotBlank, `items` @NotEmpty); server messages such as `EXPENSE_POLICY_CAP_EXCEEDED` shown as they are | exists | `claim.self` |

**Keep:**
- Title (required by the API; default it from category + merchant/description, and let people edit it).
- More than one line ("Add another expense").
- Notes for the approver.
- Company picker for multi-company tenants (`useCompanies`, archived companies excluded).
- The cap-breach warning, which is advisory; the server decides.
- The date on the **shared calendar** (`DateField`, accessible name "Date"; `live-w3-r4.mjs` pins it). The prototype uses a native `type=date`.

**Kit pieces:** Card, **FilterPills/Chips** (category), **FormField** (number, text, textarea, DateField), **UploadDrop** (new; also My documents), an attached-file chip, **CheckList** rows (ok/warn icons), primary Button, Toast.

### 3.5 Pay › Advances (`e-adv`)

**Route and files:**
- `/hrms/advances`, guard anyOf `hrms.advance.request.self|read|approve|disburse|request.others` + `ModuleGate hrms` (App.tsx 403).
- `PayrollContainer` renders `<Advance/>` when `!usePermission('hrms.advance.read')` (l.526); otherwise it renders the admin `PayAdvances`, which has **no My advances or Request view** (pay.md G10, G11; C9 here).
- `Advance.tsx` views: My advances + Request an advance (`request.self`), Approvals (`approve|disburse`), Company/Assigned (`read`).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| V1 | "How much?" big amount | form state | client | — |
| V2 | "Up to ₹1,24,850, one month's take-home" | no advance limit anywhere (`AdvanceRequestCreateRequest`: amount ≥ 0.01) | **missing** (E12, Q3) | — |
| V3 | Slider range (5,000–1,20,000, step 5,000) | depends on V2 | **missing** | — |
| V4 | Month pills 1–6 | server allows **1–60** (`@Min(1) @Max(60)`) | **conflict** (C8) | — |
| V5 | Reason list (Medical, Family event, …) | free text, optional, ≤500 characters | **conflict** (C8) | — |
| V6 | "Your plan": a month | client `amount ÷ months`, rounded HALF_UP to paise like `AdvanceService` (the design rounds up to ₹100; don't) | exists (client) | — |
| V7 | "First deduction: October salary · 30 Oct" | server rule: the schedule starts the month **after payout** (`AdvanceController` ~298, `AdvanceRecoveryService`); pay date not readable by employees | **partial** (E13) | — |
| V8 | "Last deduction: January salary" | as V7 | **partial** (E13) | — |
| V9 | "Take-home in those months: about ₹X" | `GET /v1/payroll/structures/me` `netMonthly` − the monthly amount | **partial** (needs `payroll.structure.read.self`; E13) | `structure.read.self` |
| V10 | "{Approver} approves it, then Finance pays it within 2 working days" | the approver is known only on submit (`resolveApprover`: manager → terminal approver → delegation); "2 working days" is not a rule | **missing** (E10) / conflict (C10) | — |
| V11 | Past advances: "Salary advance" (type) | no loan types; `reason` shown (STATIC-UI §5) | **partial** | `request.self` |
| V12 | … amount | `useMyAdvances` → `GET /v1/advance/my` `amount` | exists | `hrms.advance.request.self` |
| V13 | … "Apr – Jul 2026" (first–last deduction month) | `GET /v1/advance/{id}/schedule` needs **`hrms.advance.read`** | **partial** (E14) | `advance.read` |
| V14 | … "4 × ₹10,000" | `repaymentMonths`, `monthlyDeduction` | exists | `request.self` |
| V15 | … "Repaid" | `status` CLOSED → `advanceLabel` | exists | `request.self` |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Set the amount (slider / input) | client | client | — |
| A2 | Pick the months | client | client | — |
| A3 | Pick a reason | client (`reason` text) | client | — |
| A4 | "Ask for ₹X" | `useRequestAdvance` → `POST /v1/advance/requests` | exists | `hrms.advance.request.self` |

**Keep:**
- Current advances: requested, approved, and being recovered with "₹X left to repay" (`outstandingAmount`).
- "raised for you by {name}" (`raisedByName`).
- Paging.
- Approvals and Company views for the people who hold them (C11).

**Kit pieces:** Card, FormField (range slider + number, select or chips), **SegmentedControl / FilterPills** (months), key/value rows (`Facts`-style ListRows), StatusPill, EmptyState, Toast.

### 3.6 Documents › Letters (`e-letters`)

**Route and files:**
- `/hrms/letters/my`. Guard `RouteGuard anyOf [HRMS_LETTERS_TEMPLATE_READ, HRMS_LETTERS_READ, HRMS_LETTERS_READ_SELF, HRMS_LETTERS_DISTRIBUTE]` (App.tsx ~820).
- `LettersHub` shows view `my` for `hrms.letters.read.self` (`lettersView.letterViews`).
- A self-only reader who follows `/generated` lands on My letters.

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| L1 | Banner "Your appraisal letter 2026 needs your e-signature…" | no "signature requested" state anywhere | **missing** (E15) | — |
| L2 | Card title | `useMyLetters` → `GET /v1/letters/my` (`subject`) | exists | `hrms.letters.read.self` |
| L3 | "Sent by Meera Joshi · 22 Sep" | `sentAt` exists; sender = `generatedBy` (a user id, no name) | **partial** (E15) | same |
| L4 | "Signed 2 Apr 2026" | `letters.generated.signed_at` exists and the entity maps it, but it is **never set** and is not in `GeneratedLetterDto` | **missing** (E15) | — |
| L5 | "Issued 12 Sep 2022" | `createdAt` / `sentAt` | exists | same |
| L6 | State "Needs your signature" / "Signed" | status `SIGNED` exists in the CHECK constraint (V032); no code sets it | **missing** (E15) | — |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | "Review and sign" | none: no sign endpoint, and no letter body for self (the DTO has no body; only the PDF) | **missing** (E15, E16) | — |
| A2 | "Download" | `downloadLetterPdf` → `GET /v1/letters/generated/{id}/pdf` (`letters.read` or `read.self` + `enforceOwnerOrAdmin`), only when `hasPdf` | exists | `read.self` |

**Keep:**
- The letter's type (Offer, Appointment, …), shown in the sub-line.
- Opening the letter's page (`/hrms/letters/generated/:id`).
- Paging.

**Decide:** whether unsent (GENERATED) and VOID letters stay visible to the employee (C19, Q5). Today they do: `findActiveByEmployeeId` filters only deleted letters.

**Kit pieces:** PageHeader, **Callout/Banner** (gold "needs you"; new), **ActionCard** (icon tile + title + sub + state + primary and secondary buttons; one component for all four Documents pages), StatusPill, **SidePanel** (review: letter body + "I have read and sign"), Dialog (confirm), Toast, EmptyState, Skeleton.

### 3.7 Documents › My documents (`e-files`)

**Route and files:**
- `/hrms/documents?view=my`. Guard anyOf `hrms.document.read.self|read|write`, `hrms.letters.template.read` (App.tsx 536).
- The `my` view needs `hrms.document.read.self`.
- Today it is **read-only**. The upload cards live on `/profile` (`pages/MyDocumentsCard.tsx`: one card per active type, required first, upload, delete own).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| F1 | Banner "HR couldn't read your address proof…" | REJECTED rows with `rejectionReason` from `GET /v1/document/my`; missing required types from `useMyMissingDocuments` → `GET /v1/document/my/missing` | exists | `document.read.self`; `/my/missing` needs `hrms.document.type.read` |
| F2 | Card title | `title` / `documentTypeName` | exists | `document.read.self` |
| F3 | "Verified · 14 Mar 2022" | `verificationStatus` VERIFIED + `verifiedAt` | exists | same |
| F4 | "{reason} · 23 Sep" | REJECTED + `rejectionReason` + `verifiedAt` (the reject also stamps `verifiedAt`) | exists | same |
| F5 | "Uploaded just now · HR will check it" | PENDING + `createdAt` | exists | same |
| F6 | State: Verified / Upload again / Waiting for HR | `verificationStatus` | exists | same |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | "Upload new photo" on a rejected document | `useSelfUploadDocument` → `POST /v1/document/upload/self` (multipart, `documentTypeId` + file) | exists (API; UI only on `/profile`) | `hrms.document.write.self` |
| A2 | "View" | `fileUrl` (signed link; null when storage isn't set up, so show "can't be opened here") | exists | `read.self` |
| A3 | "Add another document" (type picker + file + dates) | `useDocumentTypes` → `GET /v1/document/types` + `POST /upload/self` | exists (API) | `document.type.read` + `document.write.self` |

**Keep:**
- Issued and expiry dates with the "Expires in N days" / "Expired" badges.
- Documents HR added without a type.
- Delete your own pending upload (`DELETE /v1/document/documents/{id}`, anyOf `write`, `write.self`).
- The `/profile` section. Share one component or hook with it; don't copy the logic (C20).

**Kit pieces:** ActionCard, Callout, **UploadDrop**, SidePanel (upload: type Select, file, issued/expiry on the calendar), StatusPill, Toast, EmptyState, Skeleton.

### 3.8 Documents › My assets (`e-assets`)

**Route and files:**
- `/me/assets`. Guard `RouteGuard anyOf ['hrms.onboarding.asset.self']` (App.tsx 285).
- Page: `MyAssets.tsx`. Data: `GET /v1/me/assets` (`MyAssetsController`, JDBC over `hrms.asset_allocations` + `hrms.onboarding_assets`).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| AS1 | Banner "Did you get the Dell 27″ monitor? Confirm it…" | no confirmation state | **missing** (E18) | — |
| AS2 | Card title | `assetName` | exists | `hrms.onboarding.asset.self` |
| AS3 | "UT-MON-0187 · handed over 21 Sep" | `assetTag`, `assignedAt` | exists | same |
| AS4 | State "Confirm you got it" / "With you" | `withMe` exists; the confirmed flag doesn't | **partial** (E18) | same |
| AS5 | Footnote "Lost or broken something? Report it the same day. You won't be charged for normal wear." | copy; a policy promise the system doesn't know (C21) | copy | — |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | "Yes, I have it" | none | **missing** (E18) | — |
| A2 | "Report a problem" | none | **missing** (E19) | — |

**Keep:**
- Returned items, with return date and note (`returnedAt`, `returnNotes`).
- Asset type and serial.
- The empty state "No equipment recorded for you".

**Kit pieces:** ActionCard, Callout, Dialog/SidePanel ("Report a problem": kind + note), Toast, EmptyState, Skeleton.

### 3.9 Documents › Policies (`e-pol`)

**Route and files:**
- `/hrms/policies`. Guard anyOf `hrms.policy.read|write|acknowledge.self` (App.tsx 588).
- `PoliciesRoute` (App.tsx 84–87) renders the Master module when the person holds **both** `hrms.policy.write` and `hrms.policy.read`; otherwise it renders `Policies.tsx`.
- In `Policies.tsx`, the `documents` view needs `['hrms.policy.read','hrms.policy.acknowledge.self']` (`useVisibleTabs`).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| O1 | Banner "The Code of conduct 2026 needs your OK by Wednesday, 30 September." | pending acknowledgements: `usePolicies(page,'ACTIVE')` + `useMyAcknowledgements`; **no deadline** | **partial** (E20) | `policy.read` or `acknowledge.self` |
| O2 | Card title | `title` | exists | same |
| O3 | "Read and accept by Wed, 30 Sep" | no deadline (`hr_policies` has `auto_remind_after_days`, `published_at`, no due date) | **missing** (E20, Q8) | — |
| O4 | "6 min read" | client, from the length of `content` | client | — |
| O5 | "Accepted 2 Jun 2026" | `GET /v1/policy/my-acknowledgements` returns **policy ids only**; `policy_acknowledgements.acknowledged_at` isn't exposed | **partial** (E21) | `acknowledge.self` |
| O6 | State "Read and accept" / "Accepted" | `ackSet.has(id)` (scoped to the current version) + `acknowledgementRequired` | exists | same |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | "Read and accept" (reader panel, then Accept) | `useAcknowledgePolicy` → `POST /v1/policy/policies/{id}/acknowledge` | exists | `hrms.policy.acknowledge.self` |
| A2 | "Open" (read only) | `content` from the list (`GET /v1/policy/policies`) | exists | `policy.read` or `acknowledge.self` |

**Keep:**
- "For reading only" policies (`acknowledgementRequired=false`).
- Re-acknowledging after a version change (never pin "Accepted").
- Category and version.
- `?policy=<id>` opening a policy.
- Paging.
- The note "Your role can read policies but isn't asked to acknowledge them".

**Kit pieces:** ActionCard, Callout, **SidePanel** (policy reader with a sticky "I accept" footer), Toast, EmptyState, Skeleton.

### 3.10 Growth › Reviews & goals (`e-rev`)

**Route and files:**
- `/hrms/performance`, guard anyOf `hrms.performance.read|write|review.self` (App.tsx 435).
- Views `my-reviews` and `my-goals` need `usePermission('hrms.performance.review.self')` (`Performance.tsx` 37–47).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| R1 | Cycle name ("Q3 2026 check-in") | `useMyReviews` → `GET /v1/performance/reviews/my` (`cycleName`); `GET /v1/performance/cycles` is **403** for employees | exists (from reviews) | `hrms.performance.review.self` |
| R2 | Headline "Your self-review is next" / "Your part is done" | client, from my self review's status | client | same |
| R3 | Chip "Due Wed, 30 Sep" | no cycle deadlines (`review_cycles`: period_start/end, status) | **missing** (E23) | — |
| R4 | Step "Goals set · Done · 3 Jul" | goals exist (`GET /v1/performance/goals/my`, `cycleId`), no "goals set" date | **partial** (E22, E23) | same |
| R5 | Step "Your self-review · Due …" | status yes; due no | **partial** (E23) | same |
| R6 | Step "{Manager}'s review · By Fri, 9 Oct" | `reviewerName` on the review about me; `reviewer_type` is in the DB but not in the response (the entity doesn't map it); no date | **partial** (E22, E23, E28) | same |
| R7 | Step "Shared with you · By Fri, 16 Oct" | no "shared" step: feedback shows as soon as it's SUBMITTED (grow C6) | **missing** (E25, Q9) | — |
| R8 | Self-review fields "What went well" / "What would you do differently?" | `strengths` / `improvements` (`ReviewSubmitRequest`) | exists | same |
| R9 | "How did the quarter go overall?" 1–5 (Tough … Stand-out) | `overallRating` 0–5, one decimal (`NUMERIC(3,1)`); different label set in the admin design (C24) | **partial** | same |
| R10 | After sending: "Sent to {manager}. He'll write his part by …, you'll see both on …" | manager name as R6; dates missing | **partial** | — |
| R11 | "Kind words this quarter" (quote, who, date) | no kudos feature | **missing** (E26, Q10) | — |
| R12 | "Goals · 1 of 4 done" | client (COMPLETED count) | client | same |
| R13 | Goal title | `title` | exists | same |
| R14 | "40% of your review" | `weight` is a free number (live data: 1, 10); the rating isn't worked out from goals (C26) | **partial** | same |
| R15 | Goal % | `progress` | exists | same |
| R16 | Status pill On track / Needs attention / Done | `status` ACTIVE / AT_RISK / COMPLETED (DROPPED isn't in the design) | exists | same |
| R17 | Progress bar | `progress` | exists | same |
| R18 | Sub-line ("Rolled out to 70% of merchants", "Now 212 ms, from 260 ms") | `description`; KPI `currentValue`/`targetValue`; the latest note only via `GET /v1/performance/goals/my/{id}/history` (one call per goal) | **partial** (E27) | same |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Pick a rating | client → `overallRating` | client | — |
| A2 | "Save draft" | none (IN_PROGRESS exists as a status, but there's no endpoint) | **missing** (E24) | — |
| A3 | "Send to {manager}" | `useSubmitReview` → `POST /v1/performance/reviews/{id}/submit` | exists | `review.self` (only the review's writer; the server checks) |
| A4 | "Update progress" on a goal | `useUpdateGoalProgress` → `PUT /v1/performance/goals/{id}/progress` `{progress, note}` | exists; **KPI goals stay read-only** for the employee (C27) | `review.self` |

**Keep:**
- Reviews the person has to write **for others** ("To write": peer reviews, and a manager's reviews of the team) with `ReviewGoalsPanel`.
- Feedback about me (rating, strengths, improvements).
- MISSED explained.
- "Add a goal" (title, description, weight).
- Goal history.
- The "Company KPI" marker.
- Tiles.

`live-design-performance.mjs` drives Add goal, the slider and Save (§6).

**Kit pieces:** Card, **StepTrack**, StatusPill (due chip), FormField (textarea), **RatingScale** (page-specific, or a SegmentedControl variant with sub-labels), Callout (sent), quote list (page-specific), goal cards with **Meter/ProgressBar**, SidePanel (Update progress: slider + note; History), EmptyState, Skeleton, Toast.

### 3.11 Growth › Learning (`e-learn`)

**Route and files:**
- `/hrms/learning`, guard anyOf 6 learning codes (App.tsx 564).
- Views: `programs` (`hrms.learning.read`), `my` (`hrms.learning.enroll.self`), plus skills, certifications and approvals for other permissions (`Learning.tsx` 63–75).

| # | Data point | Source today | Status | Perm |
|---|---|---|---|---|
| G1 | Course title | `useMyEnrollments` → `GET /v1/learning/enrollments/me` (`programTitle`) | exists | `hrms.learning.enroll.self` |
| G2 | "Required" badge | nothing marks a program as required | **missing** (E29) | — |
| G3 | "Required · finish by …" / "Assigned by Siddharth · due 15 Oct" / "You enrolled · no due date" | no due date; who enrolled you is only in `training_enrollments.created_by` (not exposed) | **partial** (E29) | — |
| G4 | Time left / duration ("25 min", "2h left") | programs have no duration | **missing** (E29) | — |
| G5 | Progress ring + % | enrollments have status and score only; no progress | **missing** (E29) | — |
| G6 | Button "Start" / "Continue" | status ENROLLED / IN_PROGRESS exists, but there is no start or progress endpoint and nothing to open (no content link) | **partial** (E29) | — |
| G7 | "Worth your time": program title | `useTrainingPrograms` → `GET /v1/learning/programs` minus my open enrollments (client) | exists | `hrms.learning.read` |
| G8 | … "45 min · People skills" | `category` yes; duration no | **partial** (E29) | same |

| # | Action | API | Status | Perm |
|---|---|---|---|---|
| A1 | Start / Continue | none | **missing** (E29, Q11) | — |
| A2 | "Enrol →" | `useEnroll` → `POST /v1/learning/programs/{id}/enroll` (the server refuses a full or closed program) | exists | `hrms.learning.enroll.self` |

**Keep:**
- Leaving a program ("Leave": `POST /v1/learning/enrollments/{id}/drop`).
- Programs you finished, with score.
- My skills (`GET /v1/learning/skills/me`).
- Proposing a skill level and withdrawing it (`skill.assess.self`).
- The program detail page.

**Kit pieces:** Card rows with **Ring** (only when real progress exists), StatusPill ("Required"), Button, catalogue tiles (the Card-as-button look of `QuickActionTile`), Meter (skills), EmptyState, Skeleton, Toast.

---

## 4. Gaps: backend work each missing piece needs

**Rules for every gap (DECISIONS 2 and 3):**
- No JPA-mapped column changes.
- New tables and columns are JDBC only.
- Each block hides, or shows its empty or error state, until its migration is applied in production. The service must catch a missing relation or column and answer "not available", not a 500.
- Every new permission is granted to OWNER and SUPER_ADMIN in its migration (`OwnerPermissionInvariantCheck`).
- Every new endpoint needs tenant scoping (TenantContext/RLS), an ownership check, a test, a hook in `modules/hrms/api/*`, and cache invalidation.
- The latest migration is `V143_40`; the lead assigns numbers.

"JPA?" means a JPA entity maps a table the gap touches. Where the answer is "yes", the table is read only, or only already-mapped columns are written.

| # | What | Backend work | Schema change | JPA? | Size |
|---|---|---|---|---|---|
| E1 | Paid date on each payslip and on the payslip head (P2, P5) | Add `paidAt` (`payroll.runs.paid_at`, else the PAID batch) and `payDate` (`runs.pay_date`) and `totalDays` to `MyPayslipDto` in `PayrollRunService.listMyPayslips`. **Same as pay.md G2.** | No | No (`payroll.*` is JDBC) | S |
| E2 | Financial-year totals (P16–P20) | `GET /v1/payroll/payslips/me/ytd` (`payroll.payslip.read.self`). FY range from the company's `fiscal_year_start` (`org.companies`, else `settings.hr_configuration`). Sums over the caller's LOCKED+PAID runs in the range: gross, net, `PF_EMPLOYEE`, `ESI_EMPLOYEE`, `PT`, `LWF_EMPLOYEE`, `TDS` (0 while TDS isn't calculated), months counted, from/to labels. | No | No | S |
| E3 | Per-month note (P6) | Optional `notes[]` on `MyPayslipDto` built from `payslip_lines`: PLI incentive, advance recovery, leave encashment. Plus "first month on a new salary" when a structure's `effective_from` falls in the period. Claims can't appear (C1). | No | No | S |
| E4 | "Ask payroll" about a payslip (A4) | New table `payroll.payslip_queries` (tenant_id, run_id, employee_id, message, status OPEN/ANSWERED/CLOSED, answer, answered_by, created_at, answered_at). Employee: `POST /v1/payroll/payslips/me/{runId}/queries`, `GET /v1/payroll/payslips/me/queries` (`payroll.payslip.read.self`, own runs only). Payroll team: `GET /v1/payroll/queries` and `POST /v1/payroll/queries/{id}/answer`, gated by a new `payroll.query.manage` (grant OWNER, SUPER_ADMIN, FINANCE_LEAD; HR_MANAGER is the client's call) or the existing `payroll.runs.manage`. In-app notifications both ways. An inbox for the payroll team, which **no design has** (Q7). | **Yes (new table)** | No | M (backend) + admin UI |
| E5 | My salary history (S10) | `GET /v1/payroll/structures/me/history` (`payroll.structure.read.self`), reusing `PayrollService.getStructureHistory` for the caller. Reason = `revision_note`, else `salary_revision_batches.reason` via `revision_batch_id`. Change % computed on the client from consecutive `ctcAnnual`. | No | No (payroll JDBC) | S |
| E6 | Hide amounts (Payslips, Salary; Home's pay card) | Frontend only: one per-viewer preference (localStorage, wrapped in try/catch), masking every amount and its accessible name | No | — | S |
| E7 | My-claims totals (M1–M6) | `GET /v1/expense/my/summary` (`hrms.expense.claim.self`): waiting amount and count (+ approver name when all are with one person), approved-not-paid (APPROVED + APPROVED_FOR_PAY), reimbursed this year (amount, count). **Same as pay.md G15.** | No | Yes (`expense_mgmt.expense_claims`; read only) | S |
| E8 | Claim rows for the claimant (M10, M11, M13) | Enrich `GET /v1/expense/my` rows with `approverName`, the distinct item `categories`, and for APPROVED_FOR_PAY the batch reference and status (`expense_mgmt.reimbursement_batch_items` → `reimbursement_batches`) | No | Yes (read only) | S |
| E9 | Category caps for claimants (N2, N4, N5) | `GET /v1/expense/policies/caps?companyId` (`claim.self`; company defaults to the caller's): the tightest active `maxAmountPerClaim` and `requiresReceipt` per category, the same merge as `enforceCategoryCaps`. **Same as pay.md G17.** | No | Yes (`expense_policies`; read only) | S |
| E10 | Who a new claim or advance goes to (N7, V10) | `GET /v1/me/approver?for=EXPENSE\|ADVANCE`, with `claim.self` or `advance.request.self` respectively. EXPENSE: manager via delegation, null → "Finance". ADVANCE: `AdvanceController.resolveApprover` (manager → terminal approver → delegation). Returns name and employee id. **Overlaps pay.md G12.** | No | No | S |
| E11 | Receipt OCR (N9) | Only if wanted: an OCR engine (no GCP allowed; a server-side Tesseract adds a native dependency), then prefill amount and date with confirmation (Q2) | No | No | L |
| E12 | Advance limit (V2, V3) | Only if wanted: a rule in `AdvanceService.requestAdvance` (e.g. amount ≤ `netMonthly` × a multiple). The multiple goes in a new JDBC column on `payroll.settings` or a new table, and a Payroll settings field. The employee reads it through E13 (Q3). | Yes (if configurable) / No (fixed rule) | No | S–M |
| E13 | Advance plan preview (V7–V10) | `GET /v1/advance/my/preview?amount&months` (`advance.request.self`): server-rounded monthly amount, first/last deduction month under today's rule (the month after payout; assume payout this month, labelled "if paid out in {month}"), take-home after deduction from the structure, approver (E10), limit (E12) | No | Yes (read only) | S |
| E14 | My advance's deduction months (V13) | Allow `hrms.advance.request.self` on `GET /v1/advance/{id}/schedule\|summary\|ledger` with the ownership check `GET /requests/{id}` already uses, or add `firstMonth` / `lastMonth` to `/v1/advance/my` rows. **Same as pay.md G11.** | No | No (schedule and ledger are JDBC) | S |
| E15 | Letter signing (L1, L3, L4, L6, A1) | New table `letters.letter_signatures` (tenant_id, letter_id, employee_id, requested_at, requested_by, signed_at, signed_name, ip, user_agent). HR asks for a signature when generating or sending: a flag on `POST /v1/letters/generate` and `/generated/{id}/send`; the switch goes in the talent package's drawers. Employee: `POST /v1/letters/my/{id}/sign` (owner only, letter SENT or VIEWED, signature requested), which also sets `GeneratedLetter.status=SIGNED` and `signedAt`. Both columns are already mapped, so **no entity change**. Permission: `read.self`, or a new `hrms.letters.sign.self` granted to OWNER, SUPER_ADMIN, EMPLOYEE, DEPT_MANAGER, … in the migration. Add `signatureRequested`, `signedAt`, `generatedByName` to `GeneratedLetterDto`. Set `viewedAt` / VIEWED when the owner opens or downloads. **Same feature as talent.md G19 (Q4).** | **Yes (new table)** | `letters.generated` yes (existing mapped columns only) | M |
| E16 | Letter body to review before signing | `GET /v1/letters/my/{id}/html` (owner): the sanitized `body_html_rendered` for the side panel; the PDF stays for download | No | Yes (read only) | S |
| E17 | My letters scope (C19) | Only if the client agrees: `/v1/letters/my` returns SENT, VIEWED and SIGNED only (VOID as "Withdrawn"?) (Q5) | No | Yes (read only) | S |
| E18 | Confirm an asset (AS1, AS4, A1) | New column `confirmed_at` on `hrms.asset_allocations` (a JDBC-only table; no entity maps it) or a side table `hrms.asset_confirmations`. Backfill so assets handed out before the feature don't all start as "Confirm". `POST /v1/me/assets/{assetId}/confirm` (`hrms.onboarding.asset.self`; only the current holder's open allocation). `confirmedAt` added to `GET /v1/me/assets` and to HR's asset list. Rows without an allocation (assets older than V136) need a rule (E18 inserts an allocation row, or treats them as confirmed). | **Yes** (column on a JDBC table, or a new table) | No (`onboarding_assets` stays untouched) | S–M |
| E19 | Report an asset problem (A2) | New table `hrms.asset_issue_reports` (id, tenant_id, asset_id, employee_id, kind LOST\|DAMAGED\|NOT_WORKING\|OTHER, note, status OPEN\|RESOLVED, created_at, resolved_by, resolved_at, resolution_note). `POST /v1/me/assets/{assetId}/reports`, `GET /v1/me/assets/reports` (`asset.self`, holder only). HR: `GET /v1/onboarding/assets/reports`, `POST …/{id}/resolve` (`hrms.onboarding.asset.write`). Notify asset managers. An HR list that **no design has** (Q6). | **Yes (new table)** | No | M |
| E20 | Policy "accept by" date (O1, O3) | Side table `policy_mgmt.policy_ack_deadlines` (policy_id, policy_version, acknowledge_by), or an unmapped JDBC column on `hr_policies` (JPA-mapped; the side table is safer). A field in Master's Publish-policy drawer. Returned on the list for everyone. Also feeds Home's "Needs you" due chip (Q8). | **Yes** | `hr_policies` yes (not changed if a side table is used) | S–M |
| E21 | My acknowledgement dates (O5) | `GET /v1/policy/my-acknowledgements?detail=true` → `[{policyId, policyVersion, acknowledgedAt}]` (`acknowledge.self`); the plain list stays for compatibility | No | Yes (read only) | S |
| E22 | My current review cycle (R1, R4, R6) | `GET /v1/performance/cycles/my-current` (`review.self`): the ACTIVE cycle(s) the caller has reviews in (name, period, status), and per cycle my steps: goals tied to it (count, first created), self review (id, status, submittedAt), manager review (reviewer name, status). Employees can't call `/cycles` (403). | No | Yes (read only) | S |
| E23 | Cycle deadlines (R3–R7 dates, "Due …") | Side table `performance_mgmt.review_cycle_milestones` (cycle_id, goals_by, self_review_by, manager_review_by, share_on); `review_cycles` is JPA-mapped. Admin fields in the cycle form (PgGrow; grow-reports "Due" is MISSING too), returned by E22. Also feeds Home "Needs you" and the reminder jobs. | **Yes (new table)** | `review_cycles` yes (untouched) | M |
| E24 | Save a self-review as a draft (A2) | `PUT /v1/performance/reviews/{id}/draft` (`review.self`; only the review's writer; PENDING/IN_PROGRESS → IN_PROGRESS): saves `strengths`, `improvements`, `overallRating` (columns already mapped). `submit` stays the only way to SUBMITTED. The cycle close already turns IN_PROGRESS into MISSED. | No | Yes (existing mapped columns) | S |
| E25 | "Shared with you" (R7) | Only if the client wants feedback held back: side table `performance_mgmt.review_releases` (cycle_id or review_id, released_at, released_by); `/reviews/my` hides SUBMITTED reviews by others until released; an admin "Share" action (Q9; grow C6) | **Yes** | No | M |
| E26 | "Kind words this quarter" (R11) | Either (a) build kudos: table `performance_mgmt.kudos` (id, tenant_id, from_employee_id, to_employee_id, message, created_at), `POST /v1/kudos`, `GET /v1/kudos/me?since=`, permission `hrms.kudos.give` (granted to every staff role + OWNER/SUPER_ADMIN), notification, **and a "give kudos" UI that no design has**. Or (b) show `strengths` from reviews about me SUBMITTED this cycle by others (real data, no build) (Q10). | (a) Yes / (b) No | No | (a) M–L / (b) S |
| E27 | Goal sub-line (R18) | Add `lastNote`, `lastUpdatedAt`, `previousValue` to `GET /v1/performance/goals/my` from `performance_mgmt.kpi_progress_updates` (JDBC) | No | Yes (goals; read only) | S |
| E28 | Tell self, manager and peer reviews apart (R6) | Add `reviewerType` to `PerformanceReviewResponse` for `/reviews/my` from `performance_reviews.reviewer_type` (JDBC; not mapped by the entity) | No | Yes (read only) | S |
| E29 | Course-style learning (G2–G6, G8, A1) | Side tables (the `training_*` tables are JPA-mapped): `learning_mgmt.program_details` (program_id, required, duration_minutes, content_url) and `learning_mgmt.enrollment_progress` (enrollment_id, progress_pct, due_date, assigned_by, started_at, last_activity_at). `POST /v1/learning/enrollments/{id}/start` and `PUT …/progress` (`enroll.self`, own). Admin fields on programs and a due date when enrolling others (`learning.write`); **none are in PgGrow's design**. Returned on `/enrollments/me` and `/programs`. (Q11) | **Yes (new tables)** | yes (untouched) | L |
| E30 | "Worth your time" (G7) | Client: open programs (PLANNED/ONGOING, seats left) the person isn't in, from `GET /v1/learning/programs` + `/enrollments/me`. Optional `GET /v1/learning/programs/suggested`. Hide without `hrms.learning.read`. | No | Yes (read only) | S |
| E31 | Program dates on My training | Add program `startDate`/`endDate`/`mode` to `EnrollmentDto`. **Same as grow-reports G-L4.** | No | Yes (read only) | S |
| E32 | Self views on shared routes (C9, C22) | Frontend: `/hrms/advances?tab=my\|request` must render the self views for everyone with `request.self`, including `advance.read` holders (add My advances and Request to the admin page, as PgPay `py-adv` designs, or let `PayrollContainer` route those tabs to `<Advance/>`). `/hrms/policies?view=mine` must render the acknowledge list for policy admins too (`PoliciesRoute`). Menu keys point at these URLs. | No | — | S |

**Frontend-only work (no backend):**
- The two-pane payslip, the SplitBar, and the stacked bar grouping by code.
- The Monthly/Yearly switch.
- Hide amounts (E6).
- The claim StepTrack from status.
- Friendly category labels.
- The advance form (preview done on the client until E13).
- Upload on My documents (reuse `useSelfUploadDocument`, `useDocumentTypes`, `useMyMissingDocuments`).
- The policy reader panel and reading time.
- ActionCards and banners from existing states.
- Tabs mapped per §5.

---

## 5. Conflicts with today's behaviour or earlier client decisions

In each case the recommendation is to keep the behaviour and adapt the design.

- **C1. Claims are not paid with salary.** Finance pays approved claims through reimbursement batches (`ReimbursementBatchService`: DRAFT → POSTED, when claims become APPROVED_FOR_PAY → PAID with a UTR, when they become REIMBURSED). `REIMBURSEMENT` in payroll is a salary-component category, not claims.
  - Design copy that says otherwise: the page sub "Approved claims are paid with your next salary", "Paid with your September salary", "Paid with your October salary if approved by 25 Oct", the aside "Approved claims are paid with your salary", and the payslip note "Includes ₹1,000 internet claim".
  - Use the real states: "Approved · Finance pays it in the next reimbursement batch", "In batch RB-… (posted {date})", "Paid back on {reimbursedAt}".
  - Unless the client wants claims paid through payroll (Q1).
- **C2. Expense categories.** The design's 5 names (Travel, Meals, Internet, Client entertainment, Other) vs the 9-value enum. Keep the enum with friendly labels (FOOD → Meals, COMMUNICATION → Internet & phone, ENTERTAINMENT → Client entertainment). pay.md C11 agrees.
- **C3. Limits.** "Up to ₹1,500 a day", "₹1,000 a month" vs the backend's per-claim cap (the tightest active policy, on the category subtotal). Say "per claim".
- **C4. The New claim form.**
  - The design has one expense, with no title, notes or extra lines.
  - The API requires `title` and an `items` list; today's form has a company picker, several lines, notes and a receipt per line.
  - Keep them: a default title the person can edit, "Add another expense", notes, and the company picker for multi-company tenants.
- **C5. Receipt rule.** The design says "Photo or PDF, up to 5 MB"; the server takes PDF, PNG or JPEG up to 10 MB. Show the server's rule.
- **C6. Dates.** The prototype uses native `type=date`. Every date uses `src/shared/components/calendar` (`live-w3-r4.mjs` asserts the "Date" combobox and presets).
- **C7. States missing from the design.** Claims: REJECTED with the approver's comment, DRAFT, and "Approved for pay". Advances: requested, approved, being recovered and "left to repay". Keep them all.
- **C8. Advance form.** The design has a limit, a slider from 5k to 120k, months 1–6, a fixed reason list, and exact first/last deduction months. The backend has no limit, 1–60 months, a free-text reason (≤500), a first deduction in the month after payout (known only then), and monthly = amount ÷ months rounded to paise.
  - Keep the server rules: pills 1–6 plus "More…" (up to 60); reason as free text, with optional quick-pick chips that fill it.
  - Show "the month after it's paid out" until E13; no ₹100 rounding.
- **C9. Advances structure and access.**
  - The design is one page with no tabs. Today there are two views, My advances and Request an advance, and DECISIONS 11 keeps tab names and order. So Request = the design's form + plan, and My advances = past and current advances.
  - Holders of `hrms.advance.read` (DEPT_MANAGER, HR_MANAGER, FINANCE_LEAD, OWNER, SUPER_ADMIN, ADMIN) get the admin page at `/hrms/advances`, so these links reach no self view for them:
    - their My work › Pay › Advances
    - the ⌘K "Request a salary advance" (`?tab=request`)
    - the `ADVANCE_RAISED_FOR_YOU` notification
  - Fix it with E32; coordinate with the Pay package and pay.md C18.
- **C10. "Finance pays it within 2 working days"** isn't a rule in the product. Drop it, or have the client confirm it as copy.
- **C11. Views not in the design.** Advance approvals and company views, expense approvals, batches and policies stay where the person's permissions put them. DECISIONS 11 says managers keep Expenses approvals.
- **C12. Income tax.** Payroll does not calculate TDS today (pay.md: "Income tax (TDS) · Not calculated yet").
  - Never show a tax figure that isn't a real `TDS` line.
  - Split the bar into take-home, statutory (PF, ESI, PT, LWF), and other deductions (e.g. `ADVANCE_RECOVERY`) with real labels.
- **C13. Payslips list.** The server returns only LOCKED and PAID months (pay.md C16). A LOCKED month isn't "Credited" yet; show "Final · not paid yet".
- **C14. Two designs per route.** `/me/payslips` and `/me/salary` (PgPay `me-slips`/`me-salary` vs EmpPay), `/hrms/letters/my` and `/me/assets` (PgTalent `me-letters`/`me-assets` vs EmpDocs), and My training (PgGrow's table vs EmpGrowth's course cards). A route can't depend on the role. Recommendation: the Emp* design for every self view (pay.md Q8).
- **C15. Payslips header link** "Salary structure" (tested) isn't in the design. Keep it as a secondary link.
- **C16. Salary effective date** (tested) and the tax regime and PF pills aren't in the design as such. Keep the effective date visible, in the CTC card and in history.
- **C17. Salary split.** The design's example has gratuity and health cover. Show only real lines. If CTC ≠ gross + employer lines (e.g. `derivedFromCtc`), show the difference as "Not itemised", which is real arithmetic, or leave the bar to the itemised lines. Lead's call.
- **C18. Letter states.** The prototype marks every letter that needs no action as "Signed". With real data, only SIGNED letters say "Signed"; others say "Issued {date}". Keep the letter type in the sub-line.
- **C19. Unsent and void letters.** `/v1/letters/my` returns GENERATED (HR hasn't sent it) and VOID letters. The design says "Letters HR has sent you" (talent L17; Q5).
- **C20. My documents.**
  - Today it is read-only, and upload lives on `/profile` (`MyDocumentsCard`). The design moves upload and re-upload onto the page.
  - Keep the profile section working. Share one component or hook, don't copy it.
  - Keep expiry badges and deleting your own pending upload.
- **C21. My assets footnote** "You won't be charged for normal wear" is a policy promise the product doesn't hold. Returned items aren't in the design; keep them (a "Returned" section).
- **C22. Policies.**
  - Not in the design, but keep: "For reading only" policies, re-acknowledging a new version, and the note for roles that can read but not acknowledge.
  - **Policy admins** (`policy.write`+`read`: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER) get Master "Policy Documents" at `/hrms/policies` and **have no place to acknowledge a policy themselves**. HR_MANAGER is not an admin role, so it gets My work. Its Documents › Policies must open a self view (E32: `/hrms/policies?view=mine`).
- **C23. Reviews & goals structure.**
  - The design is one page. DECISIONS 11 keeps the tabs **My reviews** / **My goals**.
  - My reviews = the cycle card + your self-review + kind words, plus "To write" (reviews for others, which managers need) and feedback about you.
  - My goals = the goal grid + Add a goal + History.
- **C24. Rating scale.**
  - The design has 1–5 buttons labelled Tough / Mixed / Solid / Strong / Stand-out.
  - The API stores 0–5 with one decimal, and existing ratings include 4.6.
  - The admin design uses another label set (grow C5). One scale is needed (Q9).
- **C25. "Shared with you".** It implies feedback is held until shared; today it shows as soon as it's submitted (grow C6; Q9).
- **C26. Goal weight.** "40% of your review" is claimed, but weights are free numbers (live data: 1, 10) and the review rating isn't computed from goals. Show "Weight N" (or the share of total weight), not "of your review".
- **C27. Company KPIs** assigned to the employee stay read-only for them (`hrms.kpi.progress` / `performance.write` only). "Update progress" shows only on personal goals.
- **C28. Learning model.**
  - The design is an e-learning list: progress %, Start/Continue, time left, required, due, assigned by.
  - The product has instructor-led programs: status, dates, trainer, mode (IN_PERSON / ONLINE / HYBRID / SELF_PACED), seats, score.
  - PgGrow's admin design has no fields for the design's items, and PgGrow's own "My training" is a table.
  - Without E29 the self page must not show rings, percentages or time left (Q11).
- **C29. Learning structure.** DECISIONS 11 keeps the tabs Programs and My training.
  - My training = your programs (+ Leave) + My skills + skill proposals.
  - "Worth your time" = open programs you're not in (E30), with Programs keeping the full catalogue.
- **C30. Menu (DECISIONS 11).** My work › Pay/Documents/Growth need explicit `MENU_RULES` keys. Today employees have **no** rail link for My documents or Policies; they are reached through ⌘K, `/profile` and Home. Expense claims and Advances sit under "Expense Management" and "Payroll". Performance and Learning sit under "Performance & Learning". Keep the admin-role exclusion. Labels become "My pay" / "My documents" / "My growth" when an admin item with the same short label is visible.
- **C31. Rail highlight** (`layouts/railLit.ts`).
  - Expenses, Advances, Letters, Documents, Policies, Performance and Learning each belong to an admin item and to a My work item.
  - Keep "the item you came through stays lit", and add the My work keys to `SELF_SERVICE_RAIL`.
  - `live-rail-highlight.mjs` asserts "Me → Letters keeps Me lit with 'Me sections'". Its selectors change; its behaviour must hold.
- **C32. Earlier client decisions that don't touch these pages:**
  - The greeting rule.
  - The dashboard `?date=` and analytics `?month=`.
  - Companies restore / Inactive: the claim form's company picker already uses `useCompanies`, which excludes archived companies.
  - Settings stay in their own sections. Expense policies stay under Expenses → Policies (`/hrms/expenses?tab=policies`). Nothing in My work edits settings.
- **C33. Optimistic actions** (README). Sign, accept and confirm show the toast and update the card in place. They must roll back on an API error with the server's message. There is no Undo; Undo is only for approve and reject.

---

## 6. Shared components these screens need

**From the README list (build once in `design/kit/`):**
- `PageHeader` (title, sub, right-hand actions or pill), `PillTabs` (shell; Expense claims, and the kept tabs of Advances, Performance and Learning), `SearchPill`
- `StatCard` (claims ×3; compact tile variant for payslip YTD)
- `Card`/`Section`, `ListRow` (selectable month rows, legend rows, history rows, plan rows)
- `StatusPill`
- `SegmentedControl` (Monthly/Yearly; advance months)
- `FilterPills` (claim categories)
- `Meter`/`ProgressBar` (salary flow, goals, skills), `Ring` (learning; only with real progress)
- `EmptyState`, `Skeleton`, `Toast`
- `Dialog` (confirm sign; report a problem), `SidePanel` (claim detail, letter review and sign, policy reader, document upload, goal progress and history, Ask payroll)
- `FormField` (input, select, textarea, slider; DateField from `shared/components/calendar`)

**New shared pieces (not in the README list), because two or more pages need them:**
- **`SplitBar`**: a stacked horizontal bar + legend. Payslip "where your gross went", Salary CTC split; Home's pay card could use it.
- **`StepTrack`**: 4-segment done/now/todo bars with a label and sub-label. Claims, the Growth cycle card, Leave requests (EmpLeave), Home "My requests".
- **`Callout`/`Banner`**: the gold "needs you" line. All 4 Documents pages; Time pages have similar notices.
- **`ActionCard`**: icon tile, title, sub, state (check or pill), primary + secondary buttons, and a gold ring when action is needed. All 4 Documents pages. **Fix the prototype's overflow**: at 1440 the "Needs your signature" pill and two buttons overflow a 300px card (`ref/employee/edocs__e-letters__0__light__1440.png`), so wrap the actions onto their own row.
- **`UploadDrop`**: the dashed dropzone + file chip. Claims receipt, My documents "Add another document".
- **`CheckList`**: ok/warn icon rows. The claim "Before you send"; reusable in forms.
- **`AmountMask`**: the hide-amounts preference + masked text. Payslips, Salary, Home's pay card.

**Page-specific:**
- the payslip months pane
- the rating scale (1–5 with sub-labels)
- the quote list (kind words)
- the course row (ring + text + % + CTA)
- the catalogue tile

**Dark mode** (DECISIONS 4). The Emp* prototypes hard-code light colours. Map them to tokens:
- **Payslips:** the selected month fill `#E8F3EE` is unreadable in dark (visible in `ref/employee/epay__e-slips__0__dark__1440.png`) → `--u-brs`. "Ask payroll" and "Enrol →" text `#0F6E56` → `--u-brt`.
- **Tracks:** the bar track `#E6ECE9` → `--u-ln2`.
- **Status and banners:** the pills `#E3F2EA/#0B5A46`, `#FBF1DE/#8A5A12`, `#E4F0F5/#2F6F8A`, `#FBE9E7/#B23A2F`, and the gold banner `#FBF1DE/#6B4510` → the status tokens (`--u-gds/--u-gdt`, `--u-rds/--u-rdt`, info tokens).
- **Upload and attachments:** the dropzone `#F7FAF8` + `#BFD3CA`, and the receipt chip `#F4F8F6/#DCE8E2`.
- **Growth:** the rating selection `#E8F3EE` + `#0F6E56`, and the due chip `#C8912E`.

The fonts are declared `var(--u-font,'Geist',…)`; the app uses Plus Jakarta Sans.

---

## 7. Risks

**Live tests that assert today's markup for these pages** (`apps/platform/e2e/recovery/`). Update the selectors and keep every behavioural check:

- **`live-dead-entrypoints.mjs`**
  - `/me`: button `/^Salary.*View/` → `/me/salary`.
  - `/me/salary`: heading "Salary" (h1); `main` text includes the effective date "d Mon yyyy" and the first earning's `componentName`; empty text "No salary structure yet".
  - `/me/payslips`: heading "Payslips" (h1); button `/Salary structure/` → `/me/salary`.
- **`live-design-expenses.mjs` (reader)**
  - `[aria-label="Expense views"]` text contains "My claims" and "Submit a claim", not "Approvals" or "Policies".
  - Buttons: `/New claim/`, placeholder "e.g. Client visit — Mumbai", `input[type=number]` first, "Submit Claim".
  - Toast `/Expense claim submitted/`; the title is listed under My claims.
  - The design removes the title field and the view bar: keep a titled field or change the test to the new title rule.
- **`live-money-modals.mjs` (reader)**
  - Tab "My Advances" then `getByRole('row')` with the amount and "Rejected".
  - Tab "My Claims" then `getByRole('row')` with the claim title and "Rejected".
  - **The new card layout has no table rows.** The checks must use cards (e.g. `article`) and keep the "Rejected, not REJECTED" assertion.
- **`live-design-payroll.mjs` (reader)**
  - `/hrms/advances` getByText `/My Advances|Request Advance/`. That regex is case-sensitive and today's labels are "My advances" / "Request an advance", so this check **may already be failing**; verify before relying on it.
  - Owner checks cover the admin page.
- **`live-design-documents.mjs` (reader)**
  - `/hrms/documents` shows the QA document title once.
  - No "Add document" button, and no `[aria-label="Document views"]`.
  - With the design, the employee gets an "Add another document" tile. The test must still prove there is no HR "Add document" or other people's files.
- **`live-design-learning.mjs`**
  - Reader and manager `[aria-label="Learning views"] button` names === `['Programs','My training']`.
  - The programs **table row** with "Enroll", then "You’re enrolled".
  - No "Roster" or combobox in the row.
  - "My training" button; "Leave" → dialog → `/You’ve left/`.
  - Text "Learning & Skills" in the navigation.
- **`live-design-performance.mjs` (reader)**
  - `[aria-label="Performance views"] button` === `['My reviews','My goals']`; no `/Create cycle/`.
  - `#goal-title`, "Add goal", then `article` with the goal → `slider` fill 40 → "Save" → "Progress saved".
- **`live-design-hrsetup.mjs` (reader and an acknowledge-only user)**
  - `/hrms/policies` h1 "Policies", text "Still to acknowledge", `button[aria-expanded]` opens.
  - "Active policies"; no "No policies access".
- **`live-design-master.mjs`:** reader `/hrms/policies` has no `.utm` (the Master module) and no errors.
- **`live-rail-highlight.mjs`:** "Me → Letters (`/hrms/letters/my`) keeps Me lit with the 'Me sections' tab row". The My work split changes the item and the row (C31).
- **`live-w3-r4.mjs`:** `/hrms/expenses?tab=submit` combobox "Date" (presets "Yesterday", year picker) at 1440 and 390.
- **`live-w3-search.mjs`:** API only (search URLs `/hrms/documents?view=my`, `/me/payslips`). Unaffected unless URLs change.
- **API-only:** `live-w2a.mjs` (`/v1/me/assets`) and `live-w2i.mjs` (`/v1/letters/my`) are unaffected by markup. E17 would change what `/letters/my` returns; check `live-w2i` "the employee sees it in My letters", because the letter it generates may not be sent.
- **`live-settings-restored.mjs`:** snapshots `/hrms/expenses` views against an old commit. It fails by design (pay.md); rewrite it.
- **Unit tests:**
  - `src/shared/navigation/pageRegistry.test.ts`: `/me/payslips` hidden without the payroll module; the tab parameter per page.
  - `src/layouts/railLit.test.ts`: the `ess` keys; add the My work keys.
  - `src/modules/hrms/letters/lettersView.test.ts`: view resolution; keep it.
  - `src/shared/search/search.test.ts`.

**Other risks:**
1. **Hand-applied migrations.** E4, E15, E18, E19, E20, E23, E25, E26a and E29 add tables or columns. Each needs its block to disappear cleanly, with no refused calls counted as failures in the live tests, until the migration exists, and new permissions granted to OWNER and SUPER_ADMIN in the same file.
2. **Money privacy.** "Hide amounts" must also mask amounts in `aria-label`s, titles and toasts. Keep it per viewer, not per workspace.
3. **Payroll safety.** Nothing in this area locks, processes or pays a run. E2 and E3 read only LOCKED and PAID runs, the same as today.
4. **N+1 calls.** Today the page fetches goal history per goal (E27 avoids it) and advance schedules per row (E14 avoids it). The claims summary is page-scoped (E7 fixes it).
5. **Two designs per route (C14).** Picking one per route avoids role-dependent UIs, which the prompt forbids.
6. **Shared routes (C9, C22).** A menu link that lands on an admin page for managers or HR would look like a broken self-service page.
7. **The prototype's letter card overflows at 1440.** Don't copy the layout literally.
8. **Legal weight of "e-signature".** A click-to-accept isn't an Aadhaar eSign or a certified signature. The copy must say what it is (Q4).
9. **Notification events** the backend never sends (payslip ready, self-review due) stay out (DECISIONS 13). Letter and policy notices already exist.

---

## 8. Open questions (need the client)

1. **Claims payout.** Keep reimbursement batches (Finance pays separately; change the design's "paid with your salary" copy)? Or pay approved claims through payroll, like the PLI decision on 25 Sep?
2. **Receipt OCR** ("amount and date read from the photo"). Drop it, or build it (an OCR engine on our server; GCP isn't allowed)?
3. **Advance limit.** Add a server rule (e.g. up to one month's take-home, or a multiple set in Payroll settings), or keep no limit and drop "Up to …"? Keep 1–60 months (recommended), or cap at 6 as the design shows?
4. **Letter e-signature.**
   - What counts as signing? A click-to-accept with the typed name, time and IP stored, or a certified eSign provider?
   - Who decides which letters need a signature? An "Ask for a signature" switch when HR generates or sends?
   - Should the PDF get a "Signed electronically by … on …" stamp?

   Shared with talent.md Q8.
5. **My letters.** Should employees stop seeing letters HR hasn't sent yet, and voided letters?
6. **Asset problems.** Who receives a "Report a problem" (people with `hrms.onboarding.asset.write`?), and where does HR handle it (a list under Onboarding & assets → Assets; not designed)? Is "You won't be charged for normal wear" OK as fixed text?
7. **"Ask payroll".** Build a payslip question inbox (new table, plus a payroll-team inbox that isn't designed), or just notify the payroll admins?
8. **Policy deadline.** Add an "accept by" date per policy version (set when publishing), or show "Published {date}" instead?
9. **Review cycles.** Should cycles get dates for goals, self-review, manager review and sharing? Should managers' feedback be hidden from the employee until HR shares it? Which rating labels: the 1–5 words or decimals? Shared with grow-reports Q2 and Q4.
10. **"Kind words".** Build kudos (which needs a "give kudos" screen that no design has), or show the strengths written about the person in this cycle's submitted reviews?
11. **Learning.** Build progress-tracked courses: required, due date, duration, % done, Start/Continue with a course link, with new admin fields that no design has. Or keep instructor-led programs and show My training without rings or percentages?
