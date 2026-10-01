# T02 · Payroll screens + My payslips (P-PAY-CORE UI half + P-MYPAY)

**Owner:** chakridol143 · **branch:** `redesign/t02-payroll` from the latest `origin/redesign/int` · **PR into:** `redesign/int`
**Backend:** already built and merged (P-PAY-CORE.be). No migration.
**NEVER process, lock or pay a payroll run.** Use read-only views or a disposable DRAFT run that your test creates and deletes.

## Read first
README → TEAMMATE_SETUP → DECISIONS (2, 16, 18, **21**) → REDESIGN_RULES (incl. the SHELL CONTRACT UPDATE) → PACKAGE_BRIEF →
AUDIT.md §1.G rows G1–G8 and G13–G14, §2.G, §5.8–5.9, and the "P-PAY-CORE" and "P-MYPAY" sections of §6.3 →
AUDIT-ADDENDUM → CONTRACTS.md (`usePaySchedule`) → `audit/pay.md`, `audit/leave-payrun.md` (payroll run part).

## Prototype screens
- `PgPay.dc.html` (`py-dash`, `py-runs`, `py-struct`, `py-settings`, `py-bank`), `PgPayroll.dc.html`
- `EmpPay.dc.html` (My payslips, My salary)

## You own ONLY these files
- `src/modules/hrms/payroll/{PayrollContainer, BankDisbursement, DisbursementHistory, EmployeePayslips, MySalaryStructure}.tsx`,
  new `src/modules/hrms/payroll/my/**`
- `src/design/dc/{PayDashboard, PayRuns, PayrollRunPage, PayrollOverview, PayrollEmployees, PayslipDrawer, PaySalary, PaySettings, PayBank, PayrollModule, NewRunModal, ProcessSteps, ProcessPipeline}.*`
  - Many of these carry a `// hand-owned` first line; keep it. Never run `scripts/design-build.mjs`.
- `src/modules/hrms/api/{usePayrollRuns, usePayroll, useDisbursement}.ts`
- tests: `e2e/recovery/{live-design-payroll, live-payroll-access}.mjs` + new `live-rd-p-pay-core.mjs`

## Build (same to same as the prototype, kit + tokens only)
- **Payroll dashboard** (KPIs incl. pending disbursal).
- **Runs** (run fields, checks/"needs review", statutory dues, bank readiness, the employees table with previous/change %).
- **Salary structures** (server-paged list + summary tiles) and **payroll settings.** TDS is a read-only note; one date:
  "Payroll is processed on {date}".
- **Bank:** current file, past files, bank profiles (the pill opens `/hrms/bank-disbursement/setup`).
- **"Ask payroll":** the payslip questions card + an answer side panel for the payroll team.
- **My payslips** (two-pane, hide amounts with the kit `AmountMask`, Monthly/Yearly, YTD, upcoming month shows NO figures,
  Ask payroll) and **My salary** (history with change %).
- **Page views** are inline pills inside the page (never in the header). Light/dark, 390, font via `var(--u-font)`.
- Each button is gated by its own permission. Not built (§5.8–5.9): payslip On hold, a TDS engine, OT pay.

## Tests
- tsc, eslint, build, vitest
- `live-rd-p-pay-core.mjs`:
  - read-only on the seeded runs
  - reader asks a payslip question, fin answers, the question is deleted
  - reader's schedule / YTD / upcoming
  - each role sees only what it may; light/dark; 390; no page errors
  - cleanup
- `live-design-payroll` and `live-payroll-access`: selectors only. (`live-payroll-access` has an old failure on the
  `/users` drawer that isn't yours; note it and leave it.)
- Screenshots next to the prototype.

## Hand-in
PR into `redesign/int` with the report → then **T03**.
