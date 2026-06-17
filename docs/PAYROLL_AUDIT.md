# Payroll Subsystem Audit

**Date:** 2026-06-16 · **Mode:** read-only, code-grounded (no code changed, no migrations run, **no payroll write operations** — no runs created/processed/locked). Behaviors are labelled **code-says** unless a read-only DB/API probe confirmed them. Indian statutory specifics are marked ❓ where the code does not unambiguously implement the rule.

> **✅ UPDATE — 2026-06-16 (Payroll Pre-Pilot Fix Sprint):** all four scoped findings — **P0-1, P1-1, P1-3, P1-4** — are now **RESOLVED** and verified with runtime evidence. A new fresh-tenant integration test (`PayrollFreshTenantIT`, 3/3 green) provisions zero-component tenants and proves: components auto-seed on first use, the first run processes without any manual seed (net > 0), structure-less employees are surfaced (count + identities), and a negative-net run is halted and rolled back. Existing payroll regression (PayrollEngineTest, PayrollRunIT, PayrollFoundationIT, PayrollListIT) stays green (19/19). See each finding below for the specific change.

**Scope:** `backend/modules/hrms-payroll` (PayrollEngine, LopCalculator, DefaultComponentSeeder), `backend/app/hrms-api/.../payroll` (services + controllers), `apps/platform/src/modules/hrms/payroll` + `ess`, migrations `V046`–`V049` (+ `V002`/`V006` cross-refs), `docs/PAYROLL-LOP-RULES.md`. Attendance/Letters/other modules out of scope (noted only where referenced).

---

## 1. Executive summary

- **The core engine is real and largely correct.** Pure-Java `PayrollEngine` + `LopCalculator` compute pro-rated gross, PF (12/12 with ₹15k flat ceiling), ESI (0.75/3.25 with ₹21k gross gate), and flat PT, with deterministic line ordering — all covered by unit tests. The run lifecycle (DRAFT→PROCESSING→LOCKED) and payslip PDFs work, and lock is correctly terminal.
- **One fresh-tenant blocker, masked by the demo seed.** There is **no auto-seed of salary components on tenant creation** — only a manual `POST /v1/payroll/components/seed-defaults`. A fresh production tenant has **0 components**, so `processRun` hard-fails `COMPONENTS_NOT_SEEDED`, with no guidance on the Runs page. The demo tenant has 9 seeded, so this is invisible in a demo.
- **Statutory completeness is thinner than the engine's polish implies.** No EPF pension/PF (8.33/3.67) split or EPS cap; PT applied **flat every month** (wrong for Maharashtra Feb-₹300 and half-yearly states); LWF configured-but-never-computed; **TDS, gratuity, bonus, leave-encashment entirely absent** (13b territory).
- **Two real correctness/data bugs:** "Revise structure" silently drops existing component lines (data loss); negative net is flagged but **persists into run totals** with no operator gate.
- **Audit now works** (post-V060): `payroll.runs` stores `processed_by`/`locked_by`, and `AuditService` writes persist after today's audit fix.

## 2. Counts

| Severity | Count |
|---|---|
| 🔴 **P0** (blocks a fresh tenant from completing one cycle) | **1** |
| 🟠 **P1** (blocks/【corrupts】common workflows) | **4** |
| 🟡 **P2** (missing features customers will ask for / statutory gaps — mostly 13b) | **12** |
| 🔵 **P3** (polish / dead code / security-backlog) | **5** |

---

## 3. Inventory

### 3.1 Database schema (`payroll` schema, `V046__payroll_schema.sql`)
7 tenant-scoped tables + 1 reference table:

| Table | Purpose | Key constraints | RLS |
|---|---|---|---|
| `payroll.salary_components` | component catalog | UNIQUE(tenant_id,code); CHECK category∈{EARNING,DEDUCTION,EMPLOYER_CONTRIBUTION,REIMBURSEMENT}; CHECK computation_type∈{FIXED,PERCENT_OF_BASIC,PERCENT_OF_GROSS,FORMULA,STATUTORY} | FORCE ✅ |
| `payroll.settings` | per-tenant config (PK=tenant_id) | pf/esi/pt/lwf toggles + %/ceilings; CHECK cycle_start_day 1–31 | FORCE ✅ |
| `payroll.pt_slabs` | PT reference data | UNIQUE(state_code,min_salary,effective_from); open-ended top band (max NULL) | **none (by design — reference)** |
| `payroll.employee_salary_structures` | per-employee structure (versioned) | UNIQUE(employee_id,is_current) DEFERRABLE; CHECK pf_status, tax_regime∈{OLD,NEW} | FORCE ✅ |
| `payroll.employee_structure_components` | structure line items | FK→structures ON DELETE CASCADE; FK→components; UNIQUE(structure_id,component_id) | FORCE ✅ (via parent EXISTS policy) |
| `payroll.runs` | payroll run header | UNIQUE(tenant,company,year,month); CHECK status∈{DRAFT,PROCESSING,LOCKED,PAID,CANCELLED} | FORCE ✅ |
| `payroll.payslip_lines` | per-employee run output | FK→runs ON DELETE CASCADE; UNIQUE(run_id,employee_id,component_id) | FORCE ✅ |
| `payroll.run_lop_days` | per-employee LOP detail | FK→runs ON DELETE CASCADE; UNIQUE(run_id,employee_id); JSONB computation_log | FORCE ✅ |

- RLS policy = `USING (tenant_id = current_tenant_id()) WITH CHECK (...)` (V046:184-188); DB role `hrms_app`.
- ❓ **FK-shaped UUIDs are bare** (no DB FK): `employee_id`, `company_id`, `runs.tenant_id` etc. — integrity is app-enforced only.
- Cross-ref: `hrms.employees` carries denormalized `ctc_annual` (V006:125), `pf_uan`/`esi_number` (V006:132-133), `tax_regime` (V046:170).
- **`PAID`/`CANCELLED` statuses exist in the CHECK but are unreachable** in current code (no path sets them).

### 3.2 Backend services / endpoints
Engine: `PayrollEngine.java` (pure, `compute()` :108), `LopCalculator.java` (`calculate()` :44), `DefaultComponentSeeder.java`. Services: `PayrollService` (settings, components, structures, PT slabs, seed), `PayrollRunService` (run lifecycle + per-employee processing + LOP day-status build). Controllers (all `/v1/payroll/...`): `PayrollSettingsController`, `SalaryComponentController`, `EmployeeStructureController`, `PayrollRunController`. No `@Scheduled` payroll jobs. (Async is only in audit/email, not payroll.)

### 3.3 Frontend pages
| Route | Page | Permission | Write UI |
|---|---|---|---|
| `/hrms/payroll/settings` | PayrollSettings | `payroll.settings.read` | edit/save (gated `settings.update`) |
| `/hrms/payroll/components` | SalaryComponents | `payroll.components.read` | full CRUD + seed (gated `components.manage`), delete hidden for system rows |
| `/hrms/payroll/runs` | PayrollRuns | `payroll.runs.read` | create-run (gated `runs.manage`); **no status-filter UI** |
| `/hrms/payroll/runs/:id` | PayrollRunDetail | `payroll.runs.read` | process (`runs.manage`) + lock (`runs.lock`); payslip drawer + PDF; **no reopen (correct)** |
| `/me/salary` | MySalaryStructure | `payroll.structure.read.self` | read-only — **orphaned: no nav entry** |
| `/me/payslips` | EmployeePayslips | `payroll.payslip.read.self` | read-only; PDF only when run LOCKED |
| Employee detail → Salary tab | SalaryTab in EmployeeDetail.tsx:1170 | tab gated `payroll.structure.read` | add/revise structure (gated `structure.manage`) |

ESS dashboard (`EssDashboard.tsx`) shows **no payroll/payslip/salary surface** at all.

### 3.4 Permissions (verified via `rbac.role_permissions` probe)
| Permission | SUPER_ADMIN | FINANCE_LEAD | HR_MANAGER | DEPT_MANAGER | EMPLOYEE |
|---|:--:|:--:|:--:|:--:|:--:|
| settings.read / components.read / structure.read / runs.read / pt_slabs.read | ✅ | ✅ | ✅ | – | – |
| settings.update / components.manage / structure.manage / runs.manage / runs.lock | ✅ | ✅ | – | – | – |
| structure.read.self / payslip.read.self | – | – | – | – | ✅ |

- **Nav/perm mismatches:** (a) HR_MANAGER holds `settings.read` but the **Payroll Settings nav item is hidden** from them (SA/FL only) — reachable only by deep link. (b) `/me/salary` route + EMPLOYEE `structure.read.self` exist but **no nav entry** anywhere → URL-only. (c) Nav filters by **primary role only**, so a user who is both FL and HR sees HR's (narrower) menu.
- **Dead constants:** `hrms.payroll.read/write/process` exist in `codes.ts:81-83` but are **never seeded and never used**.
- DEPT_MANAGER has **zero** payroll permissions (cannot see team pay at all).

---

## 4. End-to-end journey traces (code-grounded)

**J1 — Configure payroll first time:** Settings row auto-creates on first GET (`ensureSettingsRow`) ✅. Toggle PF/ESI/PT + pick PT state ✅ (8 states have slabs). **Default components are NOT auto-seeded** — HR must click "Seed default components" on the Salary Components page 📋. **Fresh-tenant stuck point:** without that click, J3 hard-fails. HR_MANAGER can't reach Settings via nav (deep-link only) ⚠.

**J2 — Assign salary structure:** Employee detail → Salary tab → add structure (CTC + per-EARNING-component amounts) → `POST /v1/payroll/structures` demotes prior current + inserts new ✅ persisted; employee can view via `/me/salary` ✅ (if they have a login + `employee_id` claim ❓). **⚠ Bug: "Revise" drops existing lines** (`setLines({})` on open, EmployeeDetail.tsx:1187) — re-saving without re-typing every component zeroes them. `revisionNote` (payload + column exist) has **no UI input** 📋; `pfStatus` never sent (backend defaults ENROLLED) ⚠.

**J3 — Create → process → lock:** Create→DRAFT (idempotent) ✅. Process: ❌ `COMPONENTS_NOT_SEEDED` (422) if components empty; structure-less employees **silently skipped** (run can complete with 0 employees) ⚠; else payslip_lines + run_lop_days generated ✅ → PROCESSING. Lock (requires PROCESSING) ✅ → LOCKED, payslips visible. Reopen → `CANNOT_REOPEN_LOCKED` (422), terminal ✅ (no UI button, correct).

**J4 — Employee views payslip:** Nav "My Payslips" → `GET /payslips/me` returns **only LOCKED** runs ✅; PDF download gated LOCKED ✅. ❓ depends on the employee JWT carrying `employee_id` (or subject==employeeId) — not verified at runtime here.

**J5 — Cross-month:** Lock N; create N+1 (distinct row, UNIQUE on period) ✅; processing N+1 is `WHERE run_id=?`-scoped, never touches N ✅; N stays locked (re-process blocked `RUN_LOCKED`) ✅. Locked numbers frozen by lock (not snapshotted), which is fine since N can't re-process.

---

## 5. Statutory compliance matrix (India)

| Item | Status | Evidence |
|---|:--:|---|
| EPF 12% + 12% | ✅ | defaults 12/12 (V046:39-40); engine :143-144; tested |
| EPF ₹15,000 flat ceiling | ✅ | `min(base,ceiling)`, not pro-rated (PayrollEngine.java:141); tested |
| EPF pension(8.33)/PF(3.67) split + ₹1,250 EPS cap | ❌ | single `PF_EMPLOYER` line; no split anywhere (grep clean) |
| EPF employer tracked separately | ✅ | EMPLOYER_CONTRIBUTION, excluded from net (:146,181) |
| ESI 0.75% + 3.25% | ✅ | defaults (V046:45-46); engine :153-154; tested |
| ESI ₹21,000 gross gate | ✅ | tested on full gross (:152) |
| ESI contribution-period continuation | ❌/❓ | simple per-month gate; no "stay eligible till period end" rule (:152,158) |
| Professional Tax — per-state slab math | ✅ | slab lookup (PayrollRunService.java:548-555); 8 states seeded |
| PT monthly vs half-yearly / MH Feb-₹300 | ⚠️❓ | applied **flat every month**, no period awareness (:164-166) — wrong for MH + half-yearly states |
| TDS / income tax (old/new regime, 80C/80D) | ❌ | not computed; `tax_regime` column carried but never read by engine (13b) |
| Gratuity (4.81% accrual / exit) | ❌ | absent (grep clean) |
| Leave encashment at exit | ❌ | absent |
| Bonus (statutory 8.33–20% / performance) | ❌ | absent |
| LWF | ⚠️ | settings columns exist but engine never computes an LWF line |

---

## 6. Known-bad-path results (code-traced)

| # | Scenario | Behavior |
|---|---|---|
| 4.1 | Process, no components | `COMPONENTS_NOT_SEEDED` → **422**, before any per-employee work (PayrollRunService.java:195-198) |
| 4.2 | Employees, no structures | INNER-JOIN excludes them + defensive skip; **silently omitted**, run completes with fewer/0 employees (:319-322,516) |
| 4.3 | Lock then reopen | `CANNOT_REOPEN_LOCKED` → **422**; terminal; IT-verified |
| 4.4 | Employee w/ no structure views payslip | HR view → zero-value payslip (no 404); employee self-view → `PAYSLIP_NOT_FOUND` 422 (:297-300) |
| 4.5 | Pro-rata mid-month join + LOP | ✅ pre-join days→LOP, earnings pro-rated, PF flat-capped; unit-tested |
| 4.6 | Negative net | **flagged (`NEGATIVE_NET`), NOT clamped, NOT blocked** — persists into `total_net` (:181-187); unit-confirmed `-100.00`. Memory's "flagged not clamped" = correct |
| 4.7 | Cross-tenant run via UUID | RLS returns 0 rows → `RUN_NOT_FOUND` **422** (not 403/404); IT-verified. ⚠ `bindTenant` string-concats the (typed UUID) tenant id into `SET LOCAL` — not exploitable, security-backlog note |

---

## 7. Customer-needs gap analysis

| Need | Status | Evidence |
|---|:--:|---|
| Configure PF/ESI/PT first time | ✅ | settings auto-row + toggles work (but see seed gap) |
| Add a new salary component | ✅ | SalaryComponents full CRUD |
| Hire mid-month, pro-rate first salary | ✅ | LOP + engine pro-ration, tested |
| Apply LOP for absent days | ✅ | LopCalculator (sandwich, late-mark, join/exit) |
| Generate payslip PDF | ✅ | run detail + self-service |
| Email payslip to employee | ❌ | pull-only (13b) |
| Bank transfer (NEFT) file | ❌ | 13b |
| PF challan (EPFO) / ESI return | ❌ | 13b |
| Form 16 | ❌ | not built |
| Year-to-date salary register | ❌ | not built |
| Bonus payout | ❌ | not modelled |
| Salary revision (mid-year) | ⚠️ | works but **Revise drops existing lines** (data-loss bug) |
| Arrears (back-dated revision) | ❌ | 13b |
| Exit settlement (FnF) | ❌ | no gratuity/encashment/FnF |
| Payslip download for past months | ✅ | locked runs listed per employee |
| Audit trail of who locked/processed | ✅ | `processed_by`/`locked_by` columns + audit writes (post-V060) |
| Seed components for a fresh tenant | ⚠️ | manual endpoint only, no auto-seed (P0) |

---

## 8. Consolidated prioritized findings

### 🔴 P0 — blocks a fresh tenant from one full cycle
- **P0-1 — No auto-seed of salary components on tenant create.** Fresh/prod tenant = 0 components → `processRun` hard-fails `COMPONENTS_NOT_SEEDED` (PayrollRunService.java:195-198); the manual fix (`POST /components/seed-defaults`, `components.manage`) is undocumented on the Runs page. **Masked on the demo tenant (9 seeded).** *Fix: auto-seed on tenant provisioning, or a pre-flight CTA on the Runs page. Scope: S. Pre-pilot blocker.*
  - ✅ **RESOLVED 2026-06-16** — chose **idempotent lazy auto-seed at the two payroll entry points** (`PayrollService.listComponents` when count==0, and `PayrollRunService.processRun` when `loadComponentsMeta()` is empty → seed → reload), mirroring the existing `loadSettings`/`ensureSettingsRow` auto-create idiom. **Why this over a tenant-create hook (the audit's first suggestion):** the create-time hook lives in the SaaS provisioning module (different layer than the seeder), is higher blast-radius, and — per the "works in demo, broken from scratch" bug class — would NOT backfill tenants provisioned *before* the fix (incl. the pilot tenant). The lazy approach is self-contained in the payroll layer, covers every tenant-creation path including pre-existing ones, and system components can never be deleted so a zero count only ever means "never seeded." Verified by `PayrollFreshTenantIT.test1` (components page → 9) and `test2` (process auto-seeds end-to-end, net > 0).

### 🟠 P1 — corrupts/blocks common workflows
- **P1-1 — "Revise structure" drops existing component lines** (data loss). EmployeeDetail.tsx:1187 (`setLines({})`). *Scope: S. Pre-pilot.*
  - ✅ **RESOLVED 2026-06-16** — `openEdit()` now pre-fills `lines` from `structure.lines` (keyed by `componentId`, which equals the form's component id) and also restores `taxRegime`/`pfApplicable`/effective-date. Clearing a field is the explicit-removal path. Frontend-only; typecheck clean. Runtime confirmation is the user's pending manual walkthrough (UI-coupled E2E held per prior instruction).
- **P1-2 — PT applied flat every month** — wrong for Maharashtra (Feb ₹300) and half-yearly states (no period awareness). PayrollEngine.java:164-166. *Scope: M. Pre-pilot if MH/half-yearly customer.*
- **P1-3 — Negative net persists into run totals** with no operator gate (flagged only). PayrollEngine.java:181-187 → run rollup. *Scope: S. Pre-pilot (block or require explicit override).*
  - ✅ **RESOLVED 2026-06-16** — chose **Option A (hard block, no new status)**: after the per-employee loop and before the rollup, `processRun` queries for any employee whose `sum(EARNING/REIMBURSEMENT) − sum(DEDUCTION) < 0` and, if any exist, throws `BusinessRuleException("NEGATIVE_NET_PAYROLL", …)` naming them. Because this is inside the run's `@Transactional`, the payslip writes roll back and the run stays in its prior state — no half-processed run, no override backdoor. Verified by `PayrollFreshTenantIT.test3` (full-month-LOP + flat PT → throws + run stays DRAFT + zero payslip lines).
- **P1-4 — Structure-less employees silently dropped from a run** (no warning/summary). PayrollRunService.java:319-322,516. *Scope: S. Surface a "skipped N employees (no structure)" warning on the run.*
  - ✅ **RESOLVED 2026-06-16** — eligibility logic unchanged (skipping is correct); the run now **surfaces** it. New migration `V061` adds `payroll.runs.skipped_employee_count`; `processRun` computes the count (base-eligible employees with no current structure) and persists it; `GET /v1/payroll/runs/{id}/skipped` returns their identities; `PayrollRunDetail` shows an amber banner ("N employees were skipped …") with a "View list" modal. No "dismiss/ignore" flag was added (per scope: surface, don't allow silent dismissal). Verified by `PayrollFreshTenantIT.test2` (`skippedEmployeeCount == 1`, identity matches).

### 🟡 P2 — missing features customers will ask for (mostly 13b)
EPF pension/PF split + EPS cap · ESI contribution-period rule · LWF computation · TDS/income-tax (regime, 80C/80D) · gratuity · leave encashment · bonus · payslip email · NEFT/bank file · PF challan/ESI return/Form 16 · salary register/report exports · status-filter UI on Runs (API supports it) · `revisionNote`/`pfStatus` dropped fields. *Mix of M/L; mostly post-pilot.*

### 🔵 P3 — polish / dead code / security backlog
Dead `/hrms/payroll` nav target in unmounted `Sidebar.tsx` + `navigationConfig.ts` · unwired `useEligibleEmployees` hook · dead `hrms.payroll.*` SDK constants · `bindTenant` non-parameterized `SET LOCAL` (typed UUID, not exploitable) · `/me/salary` orphaned (no nav) + ESS has no payroll surface.

---

## 9. Recommended fix sequence
1. **P0-1 (auto-seed components)** — unblocks fresh-tenant payroll; smallest highest-leverage. *(Pre-pilot.)*
2. **P1-1 (revise drops lines)** + **P1-3 (negative-net gate)** — data-integrity bugs, both small. *(Pre-pilot.)*
3. **P1-4 (skipped-employee warning)** — cheap, prevents silent under-payment. *(Pre-pilot.)*
4. **P1-2 (PT period rules)** — only if the pilot customer is MH or a half-yearly state; otherwise post-pilot. *(Customer-gated.)*
5. **P2 statutory/outputs (TDS, EPS split, LWF, NEFT, challans, email, registers)** — the "13b" roadmap; prioritize against the customer's actual post-lock workflow (pilot Q6/A8).
6. **P3** — cleanup pass anytime.

> **Decision input:** the engine + lifecycle are sound. There is exactly **one true fresh-tenant blocker (P0-1)** plus two small data bugs (P1-1, P1-3). If the pilot customer's payroll is "gross + PF + ESI + PT, monthly, calendar-month, India standard states," payroll is close to pilot-ready after the P0 + two P1 fixes (~1 day). Heavy statutory (TDS/EPS-split/gratuity/bonus) is genuinely 13b and customer-gated.

---

## 10. Discrepancies with existing memory / docs
- **Largely consistent:** memory (`project_prompts_8_to_12`) says payroll = engine + run lifecycle + payslip PDFs (13a) done, "13b (TDS/statutory)" pending, "negative net flagged not clamped." All **confirmed accurate** — incl. negative-net (§6 4.6) and TDS absent (§5).
- **Not captured in memory (new):** (a) the **fresh-tenant component-seed gap** (no auto-seed) — this is the one true P0 and isn't noted anywhere; (b) **PT flat-monthly correctness** issue for MH/half-yearly states; (c) **"Revise structure" data-loss** bug; (d) **PT slabs seeded for 8 states** with real slab rows (KL has 9 bands, TN 6, WB 5); (e) `hrms.payroll.*` permission constants are dead.
- **pilot-discovery-questions.md** Q6/A8 already correctly describe the 13b post-lock gaps (NEFT, challans, email, registers) — this audit confirms them and adds the seed/PT/revise findings.

---
*Method note: every ✅/⚠/❌ above is from reading source, migrations, and unit/IT tests, plus three read-only DB probes (PT states, role grants, demo-tenant component count). No payroll runs were created, processed, or locked. Statutory items I could not pin to unambiguous code are marked ❓ rather than ✅.*
