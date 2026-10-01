# T03 · Expenses + PLI + Advances & loans + Full & final screens (P-EXP and P-PAY-EXTRA, UI halves)

**Owner:** chakridol143 · **branch:** `redesign/t03-money` from the latest `origin/redesign/int` · **PR into:** `redesign/int`
**Backend:** already built and merged (P-EXP.be, P-PAY-EXTRA.be). No migration. Never pay or disburse real money;
use disposable records your test creates and deletes.

## Read first
README → TEAMMATE_SETUP → DECISIONS (15, 16, 18, **21**) → REDESIGN_RULES (incl. the SHELL CONTRACT UPDATE) → PACKAGE_BRIEF →
AUDIT.md §1.G rows G9–G12, §2.G, §5.9, and the "P-EXP" and "P-PAY-EXTRA" sections of §6.3 → AUDIT-ADDENDUM →
CONTRACTS.md (`useDecisionUndo`, `useFnfStatus`) → `audit/pay.md`, `audit/ess-2.md` (EmpClaims).

## Prototype screens
- `PgPay.dc.html` (`e-center`, `py-pli`, `py-adv`, `x-fnf`)
- `EmpClaims.dc.html` (`e-claims`, `e-adv`)

## You own ONLY these files
- Expenses: `src/modules/hrms/Expense.tsx`, `src/modules/hrms/expense/**`, `src/modules/hrms/api/{useExpense, useExpenseBatches}.ts`
- PLI / Advances / F&F:
  - `src/modules/hrms/{Pli, Advance, FullAndFinal}.tsx`, `src/modules/hrms/advance/AdvanceAdmin.tsx`
  - `src/design/dc/{PayPli, PayAdvances}.*` (keep the `// hand-owned` first lines)
  - `src/modules/hrms/api/{usePli, useAdvance, useFnf}.ts`
  - the route seams `src/modules/hrms/payroll/PliRoute.tsx` and `src/modules/hrms/advance/AdvancesRoute.tsx`
- tests: `e2e/recovery/{live-design-expenses, expense-batches-live, live-advance-admin, live-fnf-admin, live-fnf-tabs, live-money-modals}.mjs`
  + new `live-rd-p-money.mjs`

## Build (same to same as the prototype, kit + tokens only)
- **Expense center:**
  - approvals with **Undo** (the shared hooks) and reject-with-reason
  - my claims, with totals and "who it goes to"
  - submit a claim, with a **policy check against category caps** before sending
  - **claim on behalf** (permission `hrms.expense.claim.others`)
  - reimbursement batches, policies
  - the approvals status filter
- **PLI:** awards (status filter + summary), my incentives (my summary). Pools pay at 100% as today.
- **Advances & loans:**
  - company advances (summary, phase filter RECOVERING/REPAID, department filter)
  - my advances (my summary, my approver, **the plan preview before asking**)
  - disburse with a payment reference + first deduction month
  - the readable ledger labels
- **Full & final:** summary tiles, status filters, the settlement panels; F&F status where other pages need it.
- **Every pop-up** on the kit SidePanel/Dialog (`role="dialog"` + name; nested advance → reject keeps working).
  Inline page pills, light/dark, 390, font via `var(--u-font)`.

## Tests
- tsc, eslint, build, vitest
- `live-rd-p-money.mjs`:
  - hrm raises a claim on behalf of reader → mgr approves → mgr undoes → mgr rejects with a reason
  - a disposable employee requests an advance, sees the preview, it's approved and disbursed (with a reference) → cleanup
  - PLI and F&F reads per role
  - light/dark; 390; no page errors
- The existing scripts you own: selectors only.
  - Some already fail on `main` for old reasons (see `docs/redesign/README.md` and your PR notes): `live-fnf-admin`
    needs the high-risk acknowledgement in its role call; `live-advance-admin` and `live-money-modals` need new selectors.
  - Fix those as part of this task.
- Screenshots next to the prototype.

## Hand-in
PR into `redesign/int` with the report. The lead then gives you the next task.
