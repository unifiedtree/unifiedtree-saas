# UnifiedTree HRMS — Comprehensive Audit

**Date:** 2026-06-16
**Scope:** `apps/platform` (HRMS frontend) + `backend/app/hrms-api` (+ `backend/modules/**`, `backend/platform/**`).
**Method:** Six parallel read-only audits, each grounded in code (file:line). No code was modified.
**Audit types kept separate (so the fix sprint can be sequenced):** CRUD-gap · Static-vs-dynamic/mock · Empty-state & dependency-block · End-to-end flow.

---

## Table of contents
1. [Executive summary](#executive-summary)
2. [Part 0 — Dynamic vs static (the "all dynamic" question)](#part-0)
3. [Part 1 — CRUD-gap audit (matrices + findings)](#part-1)
4. [Part 2 — Empty-state & dependency-block audit](#part-2)
5. [Part 3 — End-to-end flow audit (5 journeys)](#part-3)
6. [Part 4 — Consolidated prioritized findings](#part-4)
7. [Part 5 — Reconciled discrepancy](#part-5)
8. [Part 6 — Suggested fix sequence](#part-6)

---

<a name="executive-summary"></a>
## 1. Executive summary

- **The HRMS product itself is genuinely dynamic** — dashboards, reports, payroll, employees, audit, and users all hit the live API. MSW mocks are **not** active at runtime (gated behind `VITE_MOCK==='true'`, never set).
- **Three platform pages show fabricated data to users:** Analytics, Settings, Files. 15 non-HRMS module screens (CRM/Accounts/Projects/Inventory/Procurement/Helpdesk) are 100% mock but **dead** (routed to ComingSoon).
- **One true P0 blocker for a fresh tenant:** leave applications get a **null approver** and become invisible to every approval queue.
- **Two more fresh-tenant blockers:** "Add Employee" fails silently with zero companies; Leave Types cannot be edited or deleted at any layer.
- The rest are CRUD gaps (missing buttons for existing endpoints), dropped form fields, and flow friction.

**Counts:** 3 × P0, ~9 × P1, ~12 × P2.

---

<a name="part-0"></a>
## 2. Part 0 — Dynamic vs static

### MSW verdict: NOT active at runtime
- `enableMocking()` returns early unless `VITE_MOCK==='true'` — `apps/platform/src/mocks/browser.ts:6-7`.
- `main.tsx:14` calls it, but the guard short-circuits. `VITE_MOCK` is set in no env file or script.
- `core/api/client.ts:3-6` resolves a real API base from `VITE_API_URL`. **Pages render against the real backend.**

### HRMS pages — data source
| Page / Component | Source | Evidence |
|---|---|---|
| HrmsDashboard | REAL API | HrmsDashboard.tsx:16-26 |
| Dashboard (`/`) | REAL API | pages/Dashboard.tsx:6-7,94-104 |
| Team/My attendance widgets | REAL API | pages/dashboard/AttendanceWidgets.tsx:7,19,71 |
| TeamDashboard | REAL API | team/TeamDashboard.tsx:27-28 |
| EssDashboard | REAL API | ess/EssDashboard.tsx:17-19 |
| Employees | REAL API | Employees.tsx:9-11,37-40 |
| Headcount/Attrition/Diversity/AttendanceSummary/LeaveBalance/LateMarks reports | REAL API | useReports.ts:62-133 |
| Payroll runs + payroll/* | REAL API | payroll/PayrollRuns.tsx:8-17 |
| AuditLogs, Users | REAL API | pages/AuditLogs.tsx:7,30; pages/Users.tsx:7-10 |
| **Payroll.tsx** (`/hrms/payroll`) | **HARDCODED placeholder** ("coming in Phase 3") while the real engine lives at `/hrms/payroll/runs` | Payroll.tsx:4-29 |

### User-facing fake data (P0/P1 for "all dynamic")
| Page | Status | Evidence |
|---|---|---|
| **Analytics** (in MAIN_NAV, routed) | Fully hardcoded KPIs/charts | Analytics.tsx:9-44, 85-90 |
| **Settings** (routed + sidebar) | Profile/Billing read real authStore; Security/Notifications/Billing-history/Integrations/Danger-zone all mock or no-op | Settings.tsx:127-337 |
| **Files** (routed + sidebar) | Fully mock; upload/download/delete decorative | Files.tsx:15-59 |

### Non-HRMS modules — all fake, all dead (routed to ComingSoon, `App.tsx:421-434`)
accounts (Dashboard/Invoices/Payments/Expenses), crm (Dashboard/Leads/Customers/Deals), helpdesk (Dashboard/Tickets), inventory (Dashboard), procurement (Procurement), projects (Dashboard/List/TaskBoard) — each uses `MOCK_*`/hardcoded literals and is **never imported**. Also dead: pages/dashboard/CRMWidgets.tsx, WhatsAppWidgets.tsx.

---

<a name="part-1"></a>
## 3. Part 1 — CRUD-gap audit

Legend: ✅ full FE+BE · ⚠️ BE/hook exists but no UI, or partial · ❌ missing at all layers.

### 3a. Org-setup entities
| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| Companies | ✅ | ✅ | ❌ no edit anywhere | ⚠️ archive BE+hook, no UI button (dead `useArchiveCompany`, useOrg.ts:83) |
| Branches | ✅ | ✅ | ⚠️ only geofence PUT (WorkforceController.java:145) | ✅ archive |
| Departments | ✅ | ✅ | ⚠️ rename BE+hook exist, no UI (dead `useRenameDepartment`, useOrg.ts:148) | ✅ archive |
| Designations | ✅ | ✅ | ❌ no update at all | ✅ archive |
| Grades | ✅ | ✅ | ✅ | ✅ |
| Employment Types | ✅ | ✅ | ✅ | ✅ |
| Shifts | ✅ | ✅ | ✅ | ✅ |
| Holidays | ✅ | ✅ | ❌ (none expected) | ✅ |
| Leave Types | ✅ | ✅ | ❌ no endpoint/hook/UI | ❌ no endpoint/hook/UI |

Key: **Leave Types update/delete entirely missing** (LeaveController.java:199-214; useLeave.ts:140; LeaveTypes.tsx:217-238). Companies update + delete-button missing. Designations update missing.

### 3b. Employee lifecycle
| Entity / Flow | Create | Read | Update | Delete |
|---|---|---|---|---|
| Employee (core) | ✅ | ✅ | ⚠️ partial (drops fields) | ❌ no delete on WorkforceController |
| Lifecycle (confirm/notice/exit) | ✅ | ✅ | ✅ | n/a |
| Probation extend / config | ✅ | ✅ | ✅ | n/a |
| Profile: Addresses | ✅ | ✅ | ❌ | ✅ |
| Profile: Identity (PAN/Aadhaar/UAN) | ✅ | ✅ | ✅ (PUT upsert) | ❌ |
| Profile: Bank / Education / Experience / Dependents / Emergency | ✅ | ✅ | ❌ (no update) | ✅ |
| Invitations | ✅ send/resend | ⚠️ status BE-only (EmployeeController.java:282), not surfaced | n/a | ❌ no revoke |
| Onboarding templates | ✅ | ✅ | ⚠️ BE+hook exist, no UI (useOnboarding.ts:104) | ❌ no delete |
| Onboarding template tasks | ✅ | ✅ | ❌ no edit/reorder (grip is decorative, TemplateDetail.tsx:135) | ✅ |
| Onboarding instances | ⚠️ create hook never called (useOnboarding.ts:144) | ⚠️ per-employee only; list page is placeholder (Instances.tsx:8) | n/a | ❌ |
| Onboarding instance tasks | n/a | ✅ | ✅ complete/skip | n/a |
| Bulk import | ✅ validate+commit | n/a | n/a | template download endpoint absent (useBulkImport.ts:99; button disabled EmployeeImport.tsx:368) |

### 3c. Time & pay
| Entity | Create | Read | Update | Delete | Lifecycle |
|---|---|---|---|---|---|
| Leave types | ✅ | ✅ | ❌ | ❌ | n/a |
| Leave applications | ✅ apply | ✅ | n/a | ✅ cancel | ⚠️ approve via legacy `/decision` only; L1/L2 chain (LeaveController.java:157-185) never called by FE |
| Leave balances | ✅ auto | ✅ | n/a | n/a | n/a |
| Attendance records | ✅ checkin/out | ✅ | ⚠️ `manual-entry` endpoint, no hook/UI (AttendanceController.java:279) | n/a | punch ✅ |
| Attendance corrections | ✅ | ✅ | n/a | n/a | ✅ approve/reject |
| Geofence zones | ✅ | ✅ | ✅ | ✅ | full CRUD ✅ |
| Salary components | ⚠️ create hook never called + no UI (usePayroll.ts:121) | ✅ | ⚠️ PUT endpoint, no hook/UI | ✅ (`!isSystem`) | seed-defaults ✅ |
| Salary structures | ✅ | ✅ | ✅ revise | n/a (versioned) | ✅ |
| Payroll runs | ✅ | ✅ | n/a | ❌ no delete | process ✅, lock ✅, reopen = dead endpoint (see Part 5) |
| Payslips | ✅ via process | ✅ | n/a | n/a | PDF ✅ |
| Payroll settings | n/a | ✅ | ✅ | n/a | PT slabs ✅ |
| Letter templates | ✅ | ✅ | ⚠️ name/subject/body only — `type`/`active` not editable (LetterTemplateEditor.tsx:347) | ✅ soft | preview ✅ |
| Generated letters | ✅ generate | ✅ | n/a | n/a (void) | send ✅, void ✅, PDF ✅ |

---

<a name="part-2"></a>
## 4. Part 2 — Empty-state & dependency-block audit

**Empty states are broadly GOOD.** No crash-risks found (list results uniformly defaulted with `?? []` before `.map`). Notable weak spots:
- **EmployeeForm** WEAK — Company dropdown has no empty guard (`companies[0]?.id ?? ''`, EmployeeForm.tsx:69-70); dept/grade/shift/emp-type empties are handled with inline links to Organization.
- **Leave ApplyTab** WEAK — empty leave-type `<select>` with no guidance (Leave.tsx:144-155).
- **Onboarding Instances** WEAK (by design) — "coming soon" placeholder.
- **GeneratedLetters generate modal** WEAK — empty template select + raw UUID employee field.

**Dependency chains:**
| Chain | Behavior | Evidence |
|---|---|---|
| Add Employee → company | **Blocked silently** (submits `companyId:''` → server error) | EmployeeForm.tsx:70,155-156 |
| Add Employee → dept/desig/branch/emp-type | Guided (inline links) | EmployeeForm.tsx:313-381 |
| Salary structure → salary components | Weak (can save CTC-only with no warning catalog is empty) | EmployeeDetail.tsx:1267 |
| Run payroll → employees/structures/PT | Guided by server error, not pre-checked | PayrollRuns.tsx:113; PayrollRunDetail.tsx:202 |
| Generate letter → template | Blocked silently + UUID paste | GeneratedLetters.tsx:71-87 |
| Onboarding instance → template | Guided (non-blocking default) | EmployeeForm.tsx:382-391 |
| Leave apply → leave types | Partially guided (admin good; ESS empty select) | LeaveTypes.tsx:300-315; Leave.tsx:144-155 |

---

<a name="part-3"></a>
## 5. Part 3 — End-to-end flow audit (5 journeys)

Structural finding: the sidebar (`PlatformShell.tsx` MODULE_ITEMS) is the only nav; there is **no setup wizard**, and `navigationConfig.ts` is effectively dead for HRMS.

### J1 — New tenant setup
Company → branch → dept → designation → grade → emp-type → shift all exist as OrgSetup tabs ✅. **Breakages:** Holidays and Leave Types live under the **Leave** module, not Org Setup (Leave.tsx:359-360,382-383) — undiscoverable during setup. Salary-component seeding is an unhinted hard prerequisite for payroll. Salary Components page is hidden from HR_MANAGER (PlatformShell.tsx:166-175 = SUPER_ADMIN/FINANCE_LEAD only). No department-head assignment UI.

### J2 — Hire to payslip
Create employee ✅ → invite ✅ → assign structure ✅ → create/process/lock run ✅ → employee views payslip ✅. **Breakages:** Grade & Shift are collected in the form but **never sent** (EmployeeForm.tsx:96-97 vs 155-186); `systemAccess/systemRole` also dropped. Process throws `COMPONENTS_NOT_SEEDED` (PayrollRunService.java:195-198) if components weren't seeded — no pre-warning.

### J3 — Leave application
Apply ✅ → **approver routing ❌** (see P0 #1) → balance update ✅ → reflects in employee view ✅. Frontend uses only legacy single-step `/decision`; backend L1/L2 chain unreachable.

### J4 — Letter generation
Create template ✅ (merge fields + preview) → **generate per employee ⚠️** (raw UUID paste; EmployeeDetail deep-link `?employeeId=` ignored because GeneratedLetters never reads search params) → send/PDF ✅. Generated-letter detail page renders **no letter body**, only metadata (GeneratedLetterDetail.tsx:221-312).

### J5 — Payroll lock
Create → process → lock ✅ → reopen is intentionally terminal (dead endpoint, see Part 5) → lock correctly gates payslip visibility ✅ (PayrollRunService.java:280,294). No blocking issues.

---

<a name="part-4"></a>
## 6. Part 4 — Consolidated prioritized findings

### 🔴 P0 — fresh tenant cannot complete a core flow

> **✅ UPDATE — 2026-06-17 (HRMS P0 Fix Sprint): all three RESOLVED.** Ground-truth at fix time found most of the P0 work had already shipped in a prior session (recorded in `HRMS_DEPLOY_RUNBOOK.md §1`): the EmployeeForm reporting-manager picker, OrgSetup department-head assignment, the apply-time manager→dept-head approver resolution, leave-type PUT/DELETE endpoints + hooks + row actions, and a submit-time zero-company guard were already in the tree. This sprint closed the remaining gaps — see each finding.

- **P0-1 Leave approver is orphaned.** Apply sets approver = `Employee.managerId` (`reporting_manager_id`); EmployeeForm has no manager picker (defaults `''`, EmployeeForm.tsx:93) and the department-head fallback has no UI (OrgSetup.tsx:375-387). Queue filters by `approverId` (LeaveService.java:367) → null-approver requests invisible to everyone. **Fix:** add reporting-manager picker to EmployeeForm + department-head assignment UI in OrgSetup; add an approver fallback to any HR_MANAGER when none resolves.
  - ✅ **RESOLVED 2026-06-17** — L1 (manager picker) + L2 (dept-head UI + live lookup) were already present. Added the missing **Layer-3/4 terminal fallback**: new `ApproverFallbackResolver` (any active HR_MANAGER → any active SUPER_ADMIN, by `user_roles → user_credentials.employee_id`); `LeaveController.apply()` now resolves L1→L2→L3→L4 and **throws `NO_APPROVER_AVAILABLE` (422) rather than ever persisting a null approver**. Verified end-to-end by `FreshTenantLeaveFlowIT` (4/4): HR fallback, manager routing, dept-head routing, and the no-approver-anywhere error (nothing persisted).
- **P0-2 Add Employee fails silently with zero companies.** EmployeeForm.tsx:70,155-156; ungated button Employees.tsx:100-107. **Fix:** guard the CTA on `companies.length>0` with a "Create a company first" message.
  - ✅ **RESOLVED 2026-06-17** — `Employees.tsx` now shows a "No companies yet" empty state (with a "Create a company" CTA → /hrms/organization when the user has `org.company.write`, else guidance text) and suppresses the Add-Employee button when `companies.length === 0`; `EmployeeForm` shows an inline notice + disables submit as defense-in-depth. Typecheck clean + code-traced; **visual/UX confirmation still owed via a human walkthrough** (agent browser-verification was inconclusive due to a local SPA login/tenant-bootstrap harness quirk, not a feature issue).
- **P0-3 Leave Types have no Update/Delete.** LeaveController.java:199-214; useLeave.ts:140; LeaveTypes.tsx:217-238. **Fix:** add PUT/DELETE (or activate/deactivate) endpoints + hooks + row actions.
  - ✅ **RESOLVED (pre-sprint, confirmed 2026-06-17)** — `PUT /v1/leave/types/{id}` (update) + `DELETE` (deactivate→`is_active=false`) endpoints, `useUpdateLeaveType`/`useDeactivateLeaveType` hooks, and Edit/Deactivate row actions + edit drawer all already exist. Audit's "POST-only" claim was stale. No new code needed.

### 🟠 P1 — important
- **P1-1** Hire form drops Grade/Shift (and DOB/gender in edit). EmployeeForm.tsx:96-97,155-186. Fix: add to payload + DTO, or remove dropdowns.
- **P1-2** Salary Components: create UI missing (dead hook usePayroll.ts:121), update hook absent. Fix: wire create form + add update hook/edit action.
- **P1-3** Generate Letter: no usable per-employee entry (UUID paste; ignored `?employeeId=`). GeneratedLetters.tsx:71-87. Fix: employee picker + read URL param.
- **P1-4** Onboarding instances: list page is placeholder (Instances.tsx:8); create hook never wired (useOnboarding.ts:144). Fix: add `GET /v1/onboarding/instances` + real list; add "Assign onboarding" action.
- **P1-5** Companies: no update; archive button missing (dead hook useOrg.ts:83). **Designations:** no update. Fix: add endpoints/hooks + reuse create modals for edit; add company delete button.
- **P1-6** Analytics / Settings / Files show fake data to users. Fix: wire to API or hide from nav until built.
- **P1-7** Onboarding template: update has no UI (useOnboarding.ts:104), delete missing entirely.
- **P1-8** Employee delete: no endpoint on the controller the UI uses; EmployeeImport.tsx:576 falsely promises deletion. Fix: decide hard-delete vs archive; correct the copy.
- **P1-9** Setup undiscoverable: holidays/leave-types buried under Leave; Salary Components hidden from HR_MANAGER. Fix: setup checklist + nav/permission review.

### 🟡 P2 — polish / by-design
- Profile sections (bank/address/education/experience/dependents/emergency) are add+delete only, no edit (EmployeeProfileController.java:46-225).
- Letter template `type`/`active` not editable (LetterTemplateEditor.tsx:347).
- Onboarding task edit/reorder missing (decorative grip, TemplateDetail.tsx:135).
- Invitation revoke missing; invitation-status not surfaced (EmployeeController.java:282).
- Bulk-import template download endpoint absent (button disabled, EmployeeImport.tsx:368).
- Departments: rename hook dead; only name editable. Branches: only geofence editable.
- Leave two-step L1/L2 unreachable from UI (fine unless tenant configured for escalation).
- Attendance manual-entry/override endpoint has no UI (AttendanceController.java:279).
- Leave ApplyTab empty leave-type dropdown; LeaveTypes "Add Type" no-op with no company; Attendance "This Month" blank when stats undefined; Payroll new-run no pre-warn on missing structures.
- ESS "Apply leave" lands on wrong tab (EssDashboard.tsx:61).
- Payroll.tsx `/hrms/payroll` is a misleading "Phase 3" placeholder; dead non-HRMS mock modules + dead widget components should be removed.

---

<a name="part-5"></a>
## 7. Part 5 — Reconciled discrepancy

**Payroll run "reopen":** two audits disagreed. Ground truth — the endpoint `POST /v1/payroll/runs/{id}/reopen` exists (PayrollRunController.java:85-89) but **always throws `CANNOT_REOPEN_LOCKED`** for locked runs (PayrollRunService.java:248-252). Lock is intentionally terminal in Phase 1. Therefore this is **not** a missing-button bug; the correct action is to remove the dead endpoint or document it, not add UI.

---

<a name="part-6"></a>
## 8. Part 6 — Suggested fix sequence

1. **Unblock fresh tenant (P0):** P0-1 approver routing → P0-2 zero-company guard → P0-3 leave-type edit/delete.
2. **CRUD gaps (P1):** salary-component create/edit; company/designation update + company delete button; wire dropped grade/shift; onboarding instance create + list.
3. **Flow polish (P1/P2):** letter generate employee-picker; decide Analytics/Settings/Files (wire vs hide); empty-state guidance; nav/permission review for setup.

*Rationale: CRUD gaps unblock empty states, which unblock E2E. Fix in that order.*
