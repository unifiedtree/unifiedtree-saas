# HRMS IMPLEMENTATION PLAN

**Status:** Validated pre-implementation plan. **No application source code was modified to produce this.**
**Validated at:** commit `01b16f7` + 33 uncommitted working-tree files, 2026-09-21
**Method:** import-graph reachability from `apps/platform/src/main.tsx` (not grep), plus live render verification.

**Inputs:** `HRMS_CURRENT_STATE_AUDIT.md` · `HRMS_TARGET_BLUEPRINT.md` · `UI_REDESIGN_NOTES.md` · `apps/platform/UI_REDESIGN_PHASE2.md` · client reference.

---

## VALIDATION SUMMARY — read this first

Three findings change what the next session should do.

### ✅ Finding 1 — The shell and dashboard redesign IS live and working

`UI_REDESIGN_NOTES.md` Phases 1–3 claim completion. **Verified true.** `PlatformShell.tsx` (+130/−82) is live and now renders a **272px `bg-[#08402F]` sidebar** with groups PEOPLE / PAY & BENEFITS / ORG & POLICY / INSIGHTS / SETTINGS, and a **white header** (line 833). `HrmsDashboard.tsx` (+477/−249) is live with the decorative leaf and promo plant. Rendered at 1536×1000: **zero console errors, zero failed requests.**

### ❌ Finding 2 — ~320 lines of redesign went into files that never render

| File | Change | Reachable from `main.tsx`? |
|---|---|---|
| `shared/layouts/Sidebar.tsx` | **+118 / −247** | **NO** |
| `shared/layouts/Header.tsx` | +25 / −18 | **NO** |
| `shared/layouts/DashboardLayout.tsx` | +5 / −2 | **NO** |
| `shared/layouts/TopModuleNav.tsx` | **87 new lines** | **NO** |
| `shared/layouts/navigation.tsx` | **85 new lines** | **NO** |

Worse, `navigation.tsx` is **regressive, not just unwired**:
- **14 nav entries** vs the live shell's **46**
- **9 paths point at routes that do not exist** — `/hrms/payroll`, `/crm/leads`, `/crm/customers`, `/crm/deals`, `/accounts/invoices`, `/accounts/payments`, `/accounts/expenses`, `/projects/board`, `/helpdesk/tickets`

Wiring it would lose 32 nav entries and introduce 9 dead links. It derives from the **old legacy Sidebar generation**, not the current route tree.

`apps/platform/UI_REDESIGN_PHASE2.md` documents this dead architecture as if it were the system ("Sidebar is the primary application navigation… TopModuleNav sits below Header"). **That document describes code that does not run.**

### ⚠️ Finding 3 — The redesign so far is VISUAL, not BEHAVIOURAL

The client's #1 complaint is untouched:

| Client complaint | Status |
|---|---|
| Dashboard numbers don't lead anywhere | **Still broken** — `AttendanceOverview.tsx` has **5× `navigate('/hrms/attendance')`**; all status cards land on the same unfiltered page |
| Users must hunt for functionality | **Still broken** — `GlobalSearch.tsx` returns `[]` unconditionally; no `/v1/search` |
| Hard to understand | Partially improved — navigation is much better; drill-down is not |

**Conclusion: the visual layer is now good. The next phase must be behavioural.**

---

# 1. Current Live Architecture

Verified by import-graph reachability. **162 of 188 files reachable.**

```
apps/platform/src/main.tsx                       ← entry
  ↓
apps/platform/src/App.tsx                        ← 94 route declarations
  ↓
apps/platform/src/layouts/PlatformShell.tsx      ← THE ONLY LIVE SHELL  ✅
  ├─ shared/components/GlobalSearch.tsx          ← live but returns []  ⚠️
  ├─ core/notifications/notificationStore.ts
  ├─ shared/hooks/useDisplayName.ts
  ├─ shared/hooks/useRoles.ts                    ← ADMIN_ROLES SSOT
  └─ layouts/appConfig.tsx                       ← APPS registry, resolveScope()
  ↓
  <Outlet/> → HRMS ROUTES (App.tsx)
  ↓
PAGES
  modules/hrms/HrmsDashboard.tsx                 ← live, redesigned  ✅
    └─ modules/hrms/dashboard/AttendanceOverview.tsx   ← drill-down NOT done ⚠️
    └─ modules/hrms/SeatsUsageTile.tsx
    └─ modules/hrms/probation/UpcomingProbations.tsx
    └─ modules/hrms/milestones/UpcomingMilestones.tsx
  modules/hrms/Employees.tsx · Attendance.tsx · Leave.tsx · Expense.tsx
  modules/hrms/employees/EmployeeDetail.tsx      ← 11 static tabs
  modules/hrms/payroll/* · letters/* · onboarding/* · reports/* · analytics/*
  pages/Settings.tsx · Users.tsx · Roles.tsx · Modules.tsx · AuditLogs.tsx
  ↓
SHARED COMPONENTS  (all live)
  shared/components/hr.tsx                       ← 13 primitives, 63 screens  ✅
  shared/components/DataTable.tsx · EmptyState.tsx · SkeletonCard.tsx
  shared/components/ConfirmDialog.tsx · HrPagination.tsx
  shared/components/ModuleGate.tsx · RouteErrorBoundary.tsx · ComingSoon.tsx
  packages/ui-kit/src/components/*               ← EmptyState, DataTable
  ↓
STYLE
  apps/platform/src/globals.css                  ← .ut-card/.ut-input/.hr-table  ✅
  packages/design-system/src/tokens.css          ← semantic tokens
  ↓
API
  core/api/client.ts (apiJson/apiBlob)  →  vite /api proxy  →  api.unifiedtree.com
  modules/hrms/api/*.ts                          ← 47 react-query hook files
  ↓
BACKEND  (Spring Boot 3, profile=canonical)      ← 389 API paths, 166 unexposed
```

## 1.1 Route → page map (HRMS core)

| Route | Page file | State |
|---|---|---|
| `/dashboard` | `modules/hrms/HrmsDashboard.tsx` | Redesigned ✅ |
| `/hrms/employees` | `modules/hrms/Employees.tsx` | Needs export/bulk |
| `/hrms/employees/:id` | `modules/hrms/employees/EmployeeDetail.tsx` | 11 static tabs |
| `/hrms/attendance` | `modules/hrms/Attendance.tsx` | **needs `?status=`** |
| `/hrms/leave` | `modules/hrms/Leave.tsx` | Strong — repackage only |
| `/hrms/payroll/runs` | `modules/hrms/payroll/PayrollRuns.tsx` | Strong |
| `/hrms/expenses` | `modules/hrms/Expense.tsx` | Needs Reimbursements tab |
| `/hrms/advances` | `modules/hrms/Advance.tsx` | Needs Recovery tab |
| `/hrms/performance` | `modules/hrms/Performance.tsx` | Needs KPI + appraisals |
| `/hrms/documents` | `modules/hrms/DocumentVault.tsx` | **upload broken** |
| `/hrms/fnf` | `modules/hrms/FullAndFinal.tsx` | **two nav leaves → one route** |

---

# 2. Dead / Legacy Architecture

**26 files unreachable from `main.tsx`. DO NOT EDIT ANY OF THESE.** Do not delete yet either — deletion is a separate P3 PR.

## 2.1 Dead shell — currently being edited ⚠️ STOP

| File | Why dead | Live replacement |
|---|---|---|
| `shared/layouts/DashboardLayout.tsx` | 0 importers | `layouts/PlatformShell.tsx` |
| `shared/layouts/Header.tsx` | 0 importers | header inside `PlatformShell` |
| `shared/layouts/Sidebar.tsx` | 0 importers | sidebar inside `PlatformShell` |
| `shared/layouts/TopModuleNav.tsx` | new, 0 importers | sub-tab row inside `PlatformShell` |
| `shared/layouts/navigation.tsx` | new, 0 importers; **9 dead routes** | `MODULE_ITEMS` in `PlatformShell` |
| `shared/components/CommandPalette.tsx` | only imported by dead `DashboardLayout` | `GlobalSearch.tsx` |

## 2.2 Other dead files

```
pages/Dashboard.tsx                      ← superseded by HrmsDashboard
pages/dashboard/AttendanceWidgets.tsx
pages/dashboard/CRMWidgets.tsx
pages/dashboard/WhatsAppWidgets.tsx
shared/components/StatCard.tsx           ← superseded by HrStatCard
shared/components/NotificationPanel.tsx  ← superseded by ShellNotificationBell
shared/components/TenantLogo.tsx
core/auth/AuthProvider.tsx               ← pass-through, unused
core/auth/useAuth.ts
core/permissions/PermissionGate.tsx      ← "retired stack", per HrmsDashboard comment
core/permissions/usePermissions.ts
core/tenant/TenantProvider.tsx
core/tenant/tenantStore.ts
core/tenant/useTenantBranding.ts
modules/accounts/AccountsDashboard.tsx
modules/crm/CrmDashboard.tsx
modules/helpdesk/HelpdeskDashboard.tsx
modules/projects/ProjectsDashboard.tsx
modules/projects/TaskBoard.tsx           ← contains hardcoded mock tasks
modules/hrms/letters/routes.tsx
```

## 2.3 Decision required on the in-flight dead work

The `Sidebar.tsx` rewrite (+118/−247) and `TopModuleNav`/`navigation` (172 new lines) are **not salvageable as a nav model** — `navigation.tsx` covers 14 of 46 entries with 9 broken paths.

**Recommendation:** `git checkout --` the three modified dead files and delete the two new ones. The *design intent* is already delivered in the live `PlatformShell`. Keep the idea, discard the code.

**Do not act on this without the user's explicit confirmation** — it discards their work.

---

# 3. Target Application Shell

The live shell is already close. This section defines the remaining delta.

## 3.1 Sidebar

**Current (live, good):** 272px, `#08402F`, 5 captioned groups, help card, white-tint active state.

**Target groups** (reconciles live shell + reference + real capability):

```
Dashboard

PEOPLE            Workforce · Organization · Onboarding · Employee Vault
TIME & ATTENDANCE Analytics · Daily Tracking · Shifts & Overtime · Geofencing
LEAVE             Leave Operations Center
HIRING            Requisitions · Interviews* · Offers*
PAY & BENEFITS    Payroll Dashboard · Salary Structure · Processing · PLI
                  Advances · Bank Disbursement · Configuration
EXPENSES          Expense Center
PERFORMANCE       Performance · Appraisals* · KPIs* · Skills & Training
ORG & POLICY      Company · Rules & Policies · Compliance · Exit
INSIGHTS          Reports · Workforce Analytics
SETTINGS          HR Config · Holidays · Roles · Notifications · Integrations · Audit
```
`*` new leaf

| Behaviour | Spec |
|---|---|
| Active state | White-tint block (`bg-white/[0.14]`), never a lighter-green fill — preserves 15.4:1 contrast |
| Group captions | 10px bold uppercase, `text-white/45` (≈4.6:1 — AA at that weight) |
| Collapsed | **Not offered.** Removed 2026-08-22 because the rail never resized; it only stripped labels and had no desktop toggle. Do not reintroduce without a real width change. |
| Mobile | `<768px` → drawer with the same tree, full labels |
| Permission | A leaf the user cannot access is **absent**, never a 403 on click |
| Overflow safety | Any nav key not in the section map falls into a trailing bucket — a new group degrades to "uncaptioned", never "invisible" |

## 3.2 Header

**Current (live, good):** white, 72px, search pill left, apps grid + bell + avatar right.

**Target additions:** breadcrumbs on pages ≥2 deep; company/branch context selector when the tenant has >1 company (the reference shows "Company A / HQ branch"); keep the notification dot truthful (only when `unreadCount > 0`).

## 3.3 Global Search — see §18

---

# 4. Target Page Grammar

Every page. No exceptions.

```
① Breadcrumb                                  ← pages ≥2 deep
② Page Title + one-line description           ← always
③ Primary action (right) + secondary          ← always
④ KPI summary row                             ← when the page has aggregate state
⑤ Tabs                                        ← only facets of ONE entity/domain
⑥ Filter bar: search · filters · date · export · columns
⑦ Main content: table / chart / form
⑧ Row click → DETAIL DRAWER                   ← not a page navigation
```

| Layer | Use when | Do NOT use when |
|---|---|---|
| ② | Always | — |
| ③ | There is one obvious next action | Avoid >1 primary; extras go under ⋯ |
| ④ | Aggregates are meaningful | A pure form or config page |
| ⑤ | Facets of one entity ("Claims / Advances / Reimbursements") | Hiding unrelated workflows |
| ⑥ | Any list >20 rows | Short fixed lists |
| ⑧ | Preview suffices | Full editing → dedicated page |

**Rule:** a user must never leave the page to answer a question the page raised.

---

# 5. Design System

**Foundation exists and is sound. Improve in place — create nothing new that duplicates these.**

| Component | File | State | Action |
|---|---|---|---|
| `HrPageHeader` | `shared/components/hr.tsx` | Live, tightened | **Add breadcrumb slot** |
| `HrStatCard` | hr.tsx | Live, redesigned | **Add `onClick` + hover affordance** (drill-down) |
| `HrStatusPill` | hr.tsx | Live, 12 tones | Keep |
| `HrButton` | hr.tsx | Live | Add `loading` + `destructive` variants |
| `TableCard` | hr.tsx | Live, refined | **Add export / columns / bulk slots** |
| `HrTabs` | hr.tsx | Live, segmented pill | Keep |
| `HrSelect` | hr.tsx | Live custom listbox | Keep — native `<select>` can't be styled |
| `HrDrawer` | hr.tsx | Live, blur on **overlay** ✅ | **Add `size` prop** |
| `HrAvatar` | hr.tsx | Live | Keep |
| `EmptyState` | `ui-kit` + `shared/components` | **Two copies** | **Consolidate to ui-kit** |
| `SkeletonCard` | shared/components | Live | Add table/row skeletons |
| `ConfirmDialog` | shared/components | Live | Add destructive styling |
| `HrPagination` | shared/components | Live | **Add rows-per-page** |
| `DataTable` | shared + ui-kit | **Two copies** | **Consolidate** |
| **FilterBar** | — | **Missing** | **NEW — the one genuinely new primitive** |
| `GlobalSearch` | shared/components | **Returns `[]`** | **Rebuild — §18** |

### Non-negotiable CSS constraint

> `.ut-card` must **never** receive `backdrop-filter`. An element with it becomes the containing block for `position: fixed` descendants, which clipped drawers on 14 screens in August 2026. `.ut-card.fixed/.absolute/.sticky` overrides exist for the same reason. **Verified safe in current code** — `HrDrawer`'s blur is on the overlay.

### Density targets
Table rows ~40px · body 13–14px · page padding 20–24px · borders only where they separate.

---

# 6. Dashboard Implementation Plan

**Live dashboard is visually done. This section is the behavioural work.**

| Metric | Data source | Current | Target destination | Clickable now? | Backend needed |
|---|---|---|---|---|---|
| Total Employees | `/hrms/employees/counts` | → `/hrms/employees` | `/hrms/employees` | ✅ | None |
| Present Today | `attendance/dashboard` | → `/hrms/attendance` | `/hrms/attendance?tab=team&status=PRESENT` | ⚠️ unfiltered | None |
| On Leave | `attendance/dashboard` | → `/hrms/leave` | `/hrms/leave?tab=approved&date=today` | ⚠️ unfiltered | None |
| Absent Today | `attendance/dashboard` | → `/hrms/attendance` | `…&status=ABSENT` | ⚠️ unfiltered | None |
| **Late** | `attendance/dashboard` | → `/hrms/attendance` | `…&status=LATE` | ⚠️ unfiltered | None |
| Work From Home | `attendance/dashboard` | → `/hrms/attendance` | `…&status=WORK_FROM_HOME` | ⚠️ unfiltered | None |
| Not Marked | `attendance/dashboard` | → `/hrms/attendance` | `…&status=NOT_MARKED` | ⚠️ unfiltered | None |
| Late Coming | `counts.late` | **inert** | `…&status=LATE` | ❌ | None |
| Early Going | `counts.earlyCheckout` | **inert** | `…&status=EARLY_OUT` | ❌ | None |
| Pending Leave | `leave/overview` | **inert** | `/hrms/leave?tab=approvals` | ❌ | None |
| Pending Corrections | `corrections/approvals` | **inert** | `/hrms/attendance?tab=corrections` | ❌ | None |
| Source: Face | `dashboard/sources` | **inert** | `…&method=FACE_RECOGNITION` | ❌ | Filter param |
| Source: GPS / PIN / Device / Manual / Override | `dashboard/sources` | **inert** | `…&method=…` | ❌ | Filter param |
| Open Positions | `hiring/requisitions` | → `/hrms/hiring` | `/hrms/hiring?status=OPEN` | ✅ | None |
| Payroll exceptions | `runs/{id}/skipped` | not shown | `/hrms/payroll/runs/{id}?tab=skipped` | ❌ | None |
| Seats used | `workspace/seats/usage` | → billing | `/settings/billing` | ✅ | None |
| Birthdays / anniversaries | `/v1/milestones` | list only | `/hrms/employees?filter=…` | ❌ | Minor |

**17 of 20 need no backend work.** The pattern:

```
Late Arrivals: 14
        ↓  navigate('/hrms/attendance?tab=team&status=LATE')
Attendance → Team → filtered to 14
        ↓  columns: Employee · Shift · Expected · Actual · Late by · Dept
Click row → Employee attendance drawer
        ↓  [Regularize] [View profile] [View history]
```

**Also required:** `HrStatCard`/`StatusCard`/`MiniStat` must render a hover/cursor affordance when clickable, and none when not. A clickable-looking tile that does nothing is worse than a static one.

**Not implemented (Class E, per blueprint §6.1):** AI Insights, Top Performers, Payroll vs Budget, Projects & Productivity. No data source; do not fabricate.

---

# 7. Workforce / Employee Implementation Plan

## 7.1 Workforce Directory — `modules/hrms/Employees.tsx`

| Feature | Current | Target | Backend |
|---|---|---|---|
| Search | ✅ server-side | Keep | — |
| Dept / Branch / Status filters | ✅ | Keep | — |
| **Employment-type filter** | ❌ | Add | Param exists |
| **Rows per page** | ❌ hardcoded 25 | 10/25/50/100 | — |
| **Export CSV** | ❌ | Add | **`/v1/hrms/employees/export.csv`** |
| **Bulk selection** | ❌ | Checkbox column | — |
| **Bulk actions** | ❌ | Invite · Change dept · Change manager · Assign shift · Deactivate | **Bulk endpoint** |
| **Contractor Master** | ❌ no UI | Tab | ✅ `/v1/hrms/contractors` (3 eps) |
| **Classification Rules** | ❌ no UI | Tab | ✅ `/v1/hrms/classifications` (3 eps) |
| Detail drawer | ❌ | Row → drawer | — |

## 7.2 Employee Profile — the central workspace

Current 11 tabs are **all static profile data**. Target merges those into *Personal* and adds operational tabs.

| Tab | Type | Content | Backend | Status |
|---|---|---|---|---|
| **Overview** | Tab | Manager, shift, attendance %, leave balance, last payslip, pending items | Composite of existing | **NEW** |
| Personal | Tab | Contact + identity + education + experience + dependents + emergency | `profile/*` ✅ | **Merge 6 tabs** |
| **Job** | Tab | Designation, dept, branch, manager, **weekly offs**, **punch zone** | `PUT /weekly-offs`, `/punch-zone` ✅ unexposed | **Expose** |
| **Attendance** | Tab | Calendar, late marks, corrections | `attendance/history` ✅ | **NEW** |
| **Leave** | Tab | Balances, history, pending | `leave/*` ✅ | **NEW** |
| Payroll | Tab | Structure + history + payslips | `structures/employee/{id}` ✅ | Extend |
| **Documents** | Tab | Real vault + upload | **needs upload ep** | **Fix** |
| **Expenses** | Tab | Claims + advances | `expense/*`, `advance/*` ✅ | **NEW** |
| **Performance** | Tab | Goals, KPIs, reviews | `performance/*` ✅ | **NEW** |
| Letters | Tab | Generated letters | `letters/*` ✅ | **Rename from "Documents"** |
| **Exit** | Tab | Notice, clearance, F&F | `exit`, `fnf` ✅ | **NEW** |
| Assets | **Linked module** | — | **No backend** | Defer P2 |

> Today the profile's "Documents" tab actually queries `letters/generated`. **Documents and Letters are different concepts and must be separated.**

---

# 8. Attendance Implementation Plan

| Feature | Existing API | Existing UI | Target UI | Missing backend | Drill-down |
|---|---|---|---|---|---|
| Analytics | `dashboard/trend`, `/sources` | `att-analytics` shallow | KPIs + trend + on-time + calendar | None | Chart → filtered list |
| **Daily Tracking** | `attendance/logs` | table, **name filter only** | **`?status=` + `?method=`**, late-duration + expected-vs-actual columns | **None** | Row → drawer |
| **Face Punch Logs** | `FaceController` (8 eps) | **none** | Tab: employee, device, timestamp, confidence | None | Row → drawer |
| Regularization | `corrections/*` | tab | Promote to own leaf; approval queue | None | Row → approve |
| Shift Roster | `/v1/shifts` (3 unexposed) | partial | Mon–Sun roster grid | None | Cell → assign |
| Overtime | trend `overtimeMinutes` | chart only | OT approvals table | None | Row → approve |
| **Weekly offs** | `PUT /weekly-offs` | **none** | On profile Job tab | None | — |
| **Punch zone** | `PUT /punch-zone` | **none** | On profile Job tab | None | — |

**The one change that matters most:** `Attendance.tsx` already reads `useSearchParams` for `?tab=`. It must also read `?status=` and filter `staffStatuses` — which **already carry per-employee status**. Today `TeamDashboardTab` filters by name only (line ~196).

**⚠️ Unverified — must be runtime-tested before any payroll demo:** cross-midnight shifts, duplicate punches, missing punches, grace periods, timezone handling. These cannot be settled by reading code.

---

# 9. Leave Implementation Plan

**PRESERVE THE BACKEND.** `LeaveFlowIT`, `FreshTenantLeaveFlowIT`, `LeaveDurationIT`, `LopCalculatorTest` all pass. The loop apply → approve → balance → LOP → payroll works.

**UI-only work:**
```
Leave Operations Center                    [Apply Leave] [Export]
Pending 7 · Approved · Rejected · Upcoming
Applications │ Balances & Comp-offs │ Calendar │ Types │ Holidays
```
Add: calendar of who is away · comp-off visibility · conflict warning on apply · approver visible on history.

**Do not touch:** `LeaveService`, `LopCalculator`, leave entities, leave migrations.

---

# 10. Hiring Implementation Plan

```
Requisition ✅ → Approval ❌ → Candidate ✅ → Interview ❌ → Feedback ❌
    → Offer ❌ → Acceptance ❌ → CONVERT TO EMPLOYEE ❌ → Onboarding ✅
```

| Step | Exists | Needs |
|---|---|---|
| Create/list/close requisition | ✅ 4 eps | — |
| Requisition approval | ❌ | Status + approver + endpoint |
| Add/list candidate | ✅ 2 eps | — |
| Move stage | ✅ 1 ep | — |
| **Interview** | ❌ | Entity + schedule/reschedule/cancel/list |
| **Feedback** | ❌ | Entity + submit/list, rating + recommendation |
| **Offer** | ❌ | Entity + create/send/accept/reject/revise |
| **Convert to employee** | ❌ | `POST /v1/hiring/candidates/{id}/convert` |

> **If only one is built, build conversion.** "I hired this candidate — why must I type them in again?" is the demo question. Conversion must carry name/contact/CTC, create the employee, link the onboarding instance, and enforce seat quota (402).

---

# 11. Onboarding / Employee Vault

## Onboarding — preserve
Templates → instances → tasks works; just extended in `01b16f7` (`OnboardingForm.tsx`). Add: dashboard progress widget, reminders, reassignment.

## Employee Vault — P0 fix

**Evidence:** `DocumentRequest` requires `@NotBlank String fileUrl`. `DocumentVault.tsx:354` is `<input placeholder="https://…">`. No multipart endpoint for documents exists.

**But `R2Storage.put(key, bytes, contentType)` is generic and already in production for branding.** Storage is done; only the endpoint is missing.

| Work | Where |
|---|---|
| `POST /v1/document/documents/upload` (multipart) | `DocumentController.java` |
| Delegate to existing `R2Storage` | reuse `settings/branding/R2Storage.java` |
| File input + drag-drop + progress | `DocumentVault.tsx` |
| Type/size validation, category, expiry | both |
| Permission-scoped download + audit | backend |
| **Separate Documents from Letters** on the profile | `EmployeeDetail.tsx` |

---

# 12. Payroll

## ⚠️ Do not rewrite tested logic
**Off-limits:** `PayrollEngine.java`, `LopCalculator.java`, `PayrollRunService`, payroll migrations. Covered by `PayrollEngineGoldenMasterTest`, `PayrollRunIT`, `PayrollFoundationIT`, `PayrollFreshTenantIT`, `PayrollListIT`.

## UI improvements (no engine work)
| Page | Work |
|---|---|
| Payroll Dashboard | **Surface exceptions** — `/runs/{id}/skipped` exists and is unused |
| Salary Structure | Filters + export |
| Processing & Payslips | Progressive disclosure (below) |
| PLI | Complete the screen |
| **Advances** | **Recovery tab** — 6 eps unexposed |
| Bank Disbursement | Keep |

```
May 2026 · ₹1.24 Cr · 248 employees · ⚠ 2 exceptions
[Review Exceptions] [Process Payroll]
   ↓
Rajesh Kumar — missing bank details      [Fix]
Priya Mehta — attendance not finalised   [Fix]
```

## Actual engine work (separate, P1+)
TDS (never computed — only summed if a TDS component exists) · ESI/PT/24Q files (explicitly deferred in `StatutoryFileController`) · arrears/gratuity/encashment.

---

# 13. Expenses / Advances

**Pure UI work over finished business logic.**

| Feature | Endpoints | UI | Action |
|---|---|---|---|
| Claims + approvals | ✅ wired | ✅ | Keep |
| Travel advances | ✅ wired | ✅ | Keep |
| **Reimbursement batches** | **7 unexposed** | ❌ | **Third tab** — create/post/mark-paid/cancel/revert |
| **Advance recovery** | **6 unexposed** | ❌ | **Recovery tab** — schedule/ledger/summary/skip-month/foreclose/write-off |

The reference's "Advances & Loans" columns (Principal, EMI/Recovery, Remaining Balance, Status) map exactly onto `AdvanceRecoveryController`.

---

# 14. Performance / Learning

| Feature | Backend | UI | Action |
|---|---|---|---|
| Cycles, goals, reviews | ✅ | Partial | Complete |
| **KPI Tracking** | **7 eps** | **none** | **Build screen** |
| **Appraisals & 360°** | 6 eps, **2 wired** | Partial | Expose initiate/close/progress/remind |
| Skills | ✅ wired | Buried in Learning | Promote |
| Training Programs | ✅ 8 eps wired | Buried | Promote |
| Certifications | ✅ | Partial | Complete |

**Correction to earlier audit:** Learning is **better wired than first reported** — programs, enrolments, bulk enrol and skills are all live. The problem is six reference concepts hiding behind two sidebar leaves.

---

# 15. Compliance / Reports

| Feature | Backend | UI | Action |
|---|---|---|---|
| Statutory compliance | ✅ wired | ✅ | Keep |
| Filings ledger | ✅ wired | ✅ | Keep |
| **POSH** | ✅ **3 eps wired** | buried | **Own leaf, confidential treatment** |
| Muster Roll | ✅ | ✅ | Keep |
| **Compliance Calendar** | filings carry due dates | ❌ | **Calendar view over real filings** |
| **Inspector View** | **0 eps / 0 java / 0 migrations** | ❌ | **DO NOT BUILD** — P3 + security review |
| Reports (6) + CSV | ✅ | ✅ | Keep |
| Workforce Analytics | ✅ | ✅ | Keep |

---

# 16. Exit

**Fix the route collision first.** `Resignation & Exit` and `Full & Final Settlement` **both point at `/hrms/fnf`**; the shell dedupes by path so only one sub-tab renders.

```
Resignation → Approval → Notice → Clearance → F&F → Letter → Exit
```

| Step | Backend | Action |
|---|---|---|
| Resignation + notice | `/hrms/employees/{id}/notice` ✅ | Own page `/hrms/exit` |
| Cancel notice | `/cancel-notice` ✅ | Wire |
| Clearance checklist | ❌ | P2 |
| F&F | FNF module ✅ | Tabs: Pending Calculation / Pending Payment / Settled |
| Experience letter | letters engine ✅ | Wire template |
| Exit | `/exit` ✅ canonical | Retire orphan `/v1/employees/{id}/terminate` (P3) |

---

# 17. Employee Self-Service

```
My Workspace
  Today          punch status, shift, [Mark Attendance]
  My Attendance  calendar, late marks, [Regularize]
  My Leave       balances, [Apply], history
  My Payslips    downloads + salary structure
  My Documents   what HR holds + [Upload]
  My Profile     editable personal details
  My Performance goals, KPIs, reviews
```
**Rule:** an employee must never see an empty admin screen or a 403. Their sidebar is a different sidebar (already handled by `visibleForRoles`).

**Manager adds:** Team Attendance (with drill-down) · **unified approvals inbox** (leave + regularization + WFH + expense in ONE queue — currently scattered across four pages) · Team Leave calendar · Team Performance.

---

# 18. Global Search

## Current
`GlobalSearch.tsx` returns `[]` unconditionally. Gutted 2026-08-10 after it painted fabricated employees into a live customer's ⌘K panel. **No `/v1/search` endpoint exists.**

## Required implementation

| Layer | Needs backend? | Ship |
|---|---|---|
| **Action search** (~40 registered actions, permission-filtered) | **No** | **First — immediate relief, frontend only** |
| **Page search** (nav tree, permission-filtered) | **No** | **First** |
| **Employee search** (name/code/email) | **Yes — `GET /v1/search?q=`** | Second |
| Attendance / leave / payroll / documents / candidates | Yes — scoped extensions | Later |

**Indexed search is NOT required initially.** A `LIKE`/`ILIKE` query over `hrms.employees` with RLS + permission scoping is sufficient at current tenant sizes. Revisit if p95 exceeds ~300ms.

**Security requirement:** results must be filtered **server-side** by RLS and the caller's permissions. A dept manager must not find employees outside their scope. This needs a dedicated test.

**Navigation:** employee → `/hrms/employees/{id}` · action → executes or opens a drawer · page → route. Recent items persist per user in `localStorage`.

---

# 19. User Journey Acceptance Tests

Written as executable E2E specs (Playwright, `apps/platform/e2e/`).

### AT-1 — HR morning workflow
```
GIVEN an HR manager with 14 late employees today
WHEN they open /dashboard
THEN a "Late" tile shows 14 and looks clickable
WHEN they click it
THEN /hrms/attendance?tab=team&status=LATE lists exactly 14
 AND columns show Employee · Shift · Expected · Actual · Late by · Dept
WHEN they click a row
THEN a drawer shows that employee's attendance
WHEN they click Regularize, submit, and approve
THEN the record updates, the count drops to 13, and audit records the actor
```

### AT-2 — Employee management
```
GIVEN an HR manager
WHEN they press ⌘K and type an employee name
THEN the employee appears under EMPLOYEES
WHEN they select it
THEN the profile opens on Overview with manager/shift/attendance%/leave balance
 AND Attendance, Leave, Payroll, Documents, Performance tabs all show real data
WHEN they open Documents and upload a PDF
THEN it is stored, listed, downloadable, and visible to that employee
```

### AT-3 — Hiring
```
GIVEN an open requisition with a candidate at Interview stage
WHEN a recruiter schedules an interview, records feedback, sends an offer,
     and marks it accepted
THEN "Convert to Employee" becomes available
WHEN clicked
THEN an employee record is created with the candidate's details
 AND an onboarding instance is linked
 AND seat quota is enforced (402 when exceeded)
 AND no data is re-keyed by hand
```

### AT-4 — Payroll
```
GIVEN a payroll run with 2 skipped employees
WHEN finance opens the payroll dashboard
THEN "2 exceptions" is visible WITHOUT opening the run
WHEN clicked
THEN both employees appear with the reason
WHEN resolved and the run is processed and locked
THEN payslip PDFs generate and a bank file can be produced
```

### AT-5 — Exit
```
GIVEN an employee resigning
WHEN HR records resignation and it is approved
THEN notice period is tracked on a dedicated /hrms/exit page (NOT /hrms/fnf)
WHEN notice completes
THEN F&F shows under Pending Calculation → Pending Payment → Settled
 AND an experience letter can be generated from the letters engine
```

### AT-6 — Role isolation (regression guard)
```
FOR EACH role in {SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER, FINANCE_LEAD, EMPLOYEE}
WHEN they sign in
THEN the sidebar shows only permitted leaves
 AND no route 403s on click
 AND global search returns nothing outside their scope
```

---

# 20. Implementation Phases

Adjusted from the brief's suggested order for two repository-driven reasons: **(a)** the shell and dashboard are already visually done, so Phase 1 shrinks to behaviour; **(b)** frontend-only global search should ship before the dashboard, because it needs no backend and directly answers the loudest complaint.

| Phase | Focus | Backend? |
|---|---|---|
| **0** | **Foundation verification + dead-code decision** | No |
| **1** | Shell completion: breadcrumbs, company context, search wiring | No |
| **2** | Shared UI system: FilterBar, bulk, rows-per-page, export slot, drawer sizes, consolidate duplicates | No |
| **3** | **Global search — actions + pages** | No |
| **4** | **Dashboard drill-down (all 20 destinations)** | No |
| **5** | Attendance: `?status=`, late duration, face logs, OT, regularization | No |
| **6** | Workforce: export, bulk, contractors, classifications | **Yes** (export + bulk) |
| **7** | Employee workspace: operational tabs | No |
| **8** | **Documents: upload endpoint + vault** | **Yes** (small) |
| **9** | Leave: repackage only | No |
| **10** | Payroll: exceptions + advance recovery UI | No |
| **11** | Expenses: reimbursement batches | No |
| **12** | Performance: KPI + appraisal admin | No |
| **13** | Global search — employees | **Yes** (`/v1/search`) |
| **14** | Hiring: interviews, offers, **conversion** | **Yes** (large) |
| **15** | Exit: split routes, clearance, letters | Minor |
| **16** | Compliance calendar, POSH leaf, reports exports | Minor |
| **17** | E2E + regression + polish | No |

**Phases 1–5 and 7, 9–12 require no backend at all.** That is the bulk of the client's complaint.

---

# 21. File-Level Implementation Map

## Phase 0 — Foundation verification
```
READ ONLY:
  apps/platform/src/main.tsx
  apps/platform/src/App.tsx
  apps/platform/src/layouts/PlatformShell.tsx

DECISION REQUIRED (user must confirm — discards their work):
  apps/platform/src/shared/layouts/Sidebar.tsx        (+118/−247, DEAD)
  apps/platform/src/shared/layouts/Header.tsx         (+25/−18, DEAD)
  apps/platform/src/shared/layouts/DashboardLayout.tsx(+5/−2, DEAD)
  apps/platform/src/shared/layouts/TopModuleNav.tsx   (87 new, DEAD)
  apps/platform/src/shared/layouts/navigation.tsx     (85 new, DEAD, 9 broken routes)

CORRECT (misleading doc):
  apps/platform/UI_REDESIGN_PHASE2.md   ← documents dead architecture
```

## Phase 1 — Shell completion
```
LIVE / EDIT:
  apps/platform/src/layouts/PlatformShell.tsx
  apps/platform/src/shared/components/hr.tsx          (HrPageHeader breadcrumb slot)

CLEAN UP (dead constants in a live file):
  PlatformShell.tsx: RAIL_BG, HEADER_BG — declared, never used
  PlatformShell.tsx: stale comment "dark-green icon rail + green header"

DO NOT EDIT:
  shared/layouts/*   (all dead)
```

## Phase 2 — Shared UI system
```
EDIT:
  apps/platform/src/shared/components/hr.tsx
  apps/platform/src/shared/components/HrPagination.tsx   (rows-per-page)
  apps/platform/src/globals.css                          (density, .hr-table)

CREATE (only genuinely new primitive):
  apps/platform/src/shared/components/FilterBar.tsx

CONSOLIDATE (two copies each):
  EmptyState:  shared/components/EmptyState.tsx  +  packages/ui-kit/.../EmptyState.tsx
  DataTable:   shared/components/DataTable.tsx   +  packages/ui-kit/.../DataTable.tsx

DO NOT EDIT:
  shared/components/StatCard.tsx        (dead — use HrStatCard)
  shared/components/CommandPalette.tsx  (dead — use GlobalSearch)
  shared/components/NotificationPanel.tsx (dead)
```

## Phase 3 — Global search (actions + pages)
```
EDIT:
  apps/platform/src/shared/components/GlobalSearch.tsx

CREATE:
  apps/platform/src/shared/search/actionRegistry.ts   (~40 permission-gated actions)

DO NOT EDIT:
  shared/components/CommandPalette.tsx  (dead)
DO NOT: repopulate any MOCK_DATA constant — that caused the 2026-08-10 incident
```

## Phase 4 — Dashboard drill-down
```
EDIT:
  apps/platform/src/modules/hrms/dashboard/AttendanceOverview.tsx  ← 5× same navigate()
  apps/platform/src/modules/hrms/HrmsDashboard.tsx
  apps/platform/src/shared/components/hr.tsx                       ← HrStatCard onClick

DO NOT EDIT:
  pages/Dashboard.tsx · pages/dashboard/*   (all dead)
```

## Phase 5 — Attendance
```
EDIT:
  apps/platform/src/modules/hrms/Attendance.tsx        ← add ?status= / ?method=
  apps/platform/src/modules/hrms/attendance/ShiftsAndOt.tsx
  apps/platform/src/modules/hrms/analytics/AttendanceAnalytics.tsx
  apps/platform/src/modules/hrms/api/useAttendance.ts  (if new params needed)

DO NOT EDIT:
  backend AttendanceController/AttendanceService unless a param is genuinely missing
```

## Phase 8 — Documents
```
EDIT (backend — the ONLY backend change in phases 0–12):
  backend/app/hrms-api/.../document/DocumentController.java   ← add multipart endpoint
REUSE (do not duplicate):
  backend/platform/platform-settings/.../branding/R2Storage.java
EDIT (frontend):
  apps/platform/src/modules/hrms/DocumentVault.tsx
  apps/platform/src/modules/hrms/api/useDocument.ts
  apps/platform/src/modules/hrms/employees/EmployeeDetail.tsx  ← split Documents/Letters
```

## Never edit during this project
```
backend/modules/hrms-payroll/.../engine/PayrollEngine.java      ← golden-master tested
backend/modules/hrms-payroll/.../lop/LopCalculator.java         ← tested
backend/modules/hrms-leave/**                                    ← LeaveFlowIT passes
backend RBAC / RLS migrations                                    ← CrossTenantIsolationIT
packages/design-system/src/tokens.css                            ← unless tokens change
```

---

# 22. Definition of Done

A phase is complete only when **every** line is true:

- [ ] Reachable from a **live** route (verified by import graph, not assumed)
- [ ] Real backend data — no mock, no hardcoded series
- [ ] Permission-gated on the code the **endpoint** checks, never a role string
- [ ] Loading state (skeleton matching final layout)
- [ ] Empty state that explains what belongs there + primary action
- [ ] Error state distinguishing 403 / 500 / offline, with retry
- [ ] Success feedback; list reflects change without reload
- [ ] Responsive to 360px; no horizontal body scroll
- [ ] Keyboard reachable; visible focus; labelled controls
- [ ] **Every number drills down**
- [ ] Related actions available in context
- [ ] Audit trail for mutations
- [ ] **No fake data**
- [ ] **No dead UI path** (no button without a handler)
- [ ] `tsc --noEmit` clean · `vite build` clean
- [ ] Zero console errors on render (harness or manual)
- [ ] One E2E spec covering the primary workflow

---

# 23. Final Output

## A. Top 10 things to implement first

1. **Confirm the dead-file decision** with the user (Phase 0) — blocks everything else
2. **Dashboard drill-down** — 20 destinations, 17 need no backend. *The* headline fix
3. **`Attendance.tsx` `?status=` filter** + late-duration and expected-vs-actual columns
4. **Global search: actions + pages** — frontend only, directly answers "I have to hunt"
5. **Make clickable tiles look clickable** (`HrStatCard` `onClick` + hover affordance)
6. **Document upload endpoint** — multipart → existing `R2Storage`
7. **Employee directory export CSV** — clone the `ReportController` pattern
8. **Split the `/hrms/fnf` route collision** — two nav leaves, one route
9. **FilterBar primitive** + rows-per-page — unblocks every list screen
10. **Employee profile Overview tab** — the single highest-value new view

## B. Top 10 things NOT to touch yet

1. `PayrollEngine.java` / `LopCalculator.java` — golden-master tested
2. Leave service, entities, migrations — `LeaveFlowIT` passes
3. RBAC / RLS migrations — `CrossTenantIsolationIT`, `RbacMatrixIT`
4. Notification pipeline — 12 events all published and working
5. Letters module — generate/PDF/distribute all tested
6. Onboarding — just extended in `01b16f7`; let it settle
7. The 38 dead Spring beans — separate P3 PR, not during UX work
8. Three-way employee API consolidation — declare canonical, port later
9. TDS — multi-week, compliance-sensitive; scope explicitly
10. Inspector View — no backend, security-sensitive; do not demo

## C. Files currently being edited that should NOT be edited

**All five are unreachable from `main.tsx`. Verified by import graph, twice.**

| File | Work at risk | Live equivalent |
|---|---|---|
| `shared/layouts/Sidebar.tsx` | **+118 / −247** | sidebar in `PlatformShell.tsx` |
| `shared/layouts/Header.tsx` | +25 / −18 | header in `PlatformShell.tsx` |
| `shared/layouts/DashboardLayout.tsx` | +5 / −2 | `PlatformShell.tsx` |
| `shared/layouts/TopModuleNav.tsx` | 87 new lines | sub-tab row in `PlatformShell.tsx` |
| `shared/layouts/navigation.tsx` | 85 new lines — **14 of 46 entries, 9 broken routes** | `MODULE_ITEMS` in `PlatformShell.tsx` |

Also correct `apps/platform/UI_REDESIGN_PHASE2.md`, which documents this dead architecture as if it were the running system.

## D. First implementation phase

**Phase 0 — Foundation verification.** No code. Outputs:
1. User decision on the five dead files (revert/delete vs keep parked)
2. Correction of `UI_REDESIGN_PHASE2.md`
3. Agreement that `PlatformShell.tsx` is the single shell
4. Confirmation that Phases 1–5 need no backend

## E. Exact first coding task

> **Make the six attendance status cards on the dashboard drill down to a filtered list.**

**Files:**
- `apps/platform/src/modules/hrms/dashboard/AttendanceOverview.tsx` — replace 5× `navigate('/hrms/attendance')` with status-specific URLs
- `apps/platform/src/modules/hrms/Attendance.tsx` — read `?status=`; filter `staffStatuses` by status (it already reads `?tab=` and the status field is already in the payload); add Expected / Actual / Late-by / Department columns
- `apps/platform/src/shared/components/hr.tsx` — `HrStatCard` gains optional `onClick` + hover affordance

**Backend:** none.

**Done when:**
- Clicking "Late 14" lands on `/hrms/attendance?tab=team&status=LATE` showing exactly 14 named employees
- Each row shows shift, expected check-in, actual check-in, minutes late, department
- A row click opens that employee's attendance detail
- Non-clickable tiles have no hover affordance
- `tsc` clean, build clean, zero console errors
- One E2E spec covers AT-1

**Why this first:** it is the client's single loudest complaint, needs no backend, exercises the drill-down contract every later phase reuses, and is demonstrable in one click.

---

## Validation verdict on `HRMS_TARGET_BLUEPRINT.md`

| Category | Items |
|---|---|
| **Confirmed** | 166 backend-only endpoints · 0 orphan UI calls · global search inert · drill-down terminal · profile tabs all static · document upload absent while R2 works · hiring lifecycle incomplete · `/hrms/fnf` collision · dead Spring beans · reference ≈ our own IA |
| **Needs correction** | Blueprint §5.1 implied the shell redesign had not landed. **It has** — `PlatformShell.tsx` is live with a 272px `#08402F` sidebar and white header, rendering cleanly. The dead-file problem is real but affects a *parallel duplicate* effort, not the live shell. |
| **Needs implementation** | Everything in §20 Phases 3–17 |
| **Needs product decision** | Keep or discard the 320 lines in dead files · whether to sell/show Projects · TDS scope and timeline · whether Inspector View is ever in scope · company/branch selector needed at current tenant sizes? |

**END — ready for Phase 0 sign-off.**
