# UnifiedTree HRMS --- Complete Codex Master Context

## 0. PURPOSE OF THIS FILE

This file is the repository-level memory/handoff for the UnifiedTree
HRMS project.

The goal is that Codex can continue the project without needing access
to the previous ChatGPT conversation.

This document is the canonical project context for the current
redesign/recovery phase. Do not treat the old chat as a dependency.

------------------------------------------------------------------------

# 1. CURRENT USER / PROJECT INTENT

The immediate objective is NOT to add random new features.

The immediate objective is to make the existing UnifiedTree HRMS feel
like a real, understandable, polished enterprise HR platform.

The client is currently unhappy with the product. Their feedback, in
practical terms, is:

-   The UI is very poor.
-   The product is difficult to understand.
-   Users have to hunt for functionality.
-   They feel that functionality is not working.
-   Navigation and information architecture are confusing.
-   Some UI workflows are genuinely broken/regressed, not merely
    visually weak.

Therefore:

> UI/UX recovery + functional truth + navigation clarity comes before
> feature expansion.

The redesign must improve usability without destroying the existing
backend capabilities, permissions, data model, or working workflows.

The target is a premium, clean, enterprise HRMS with clear information
architecture, strong visual hierarchy, obvious actions, consistent
interaction patterns, responsive behavior, and minimal cognitive load.

------------------------------------------------------------------------

# 2. IMPORTANT WORKING MODEL

There are/were multiple AI agents involved:

### GPT / Astra

Responsible for: - Product/system design - UX architecture - Information
architecture - Workflow design - Design-system direction - UI concepts -
UI reference/image generation - Screen specifications - Reviewing
whether a workflow makes sense to a human user

### Claude Code

Responsible for: - Primary repository implementation - React/TypeScript
implementation - Spring Boot implementation - Database migrations when
actually needed - Tests - Build/typecheck - Browser verification -
Integration verification

### Codex

Codex is the independent engineering/review/recovery agent.

For the current phase, Codex should also be able to take ownership of
implementation when explicitly asked, but it must behave as an
engineering agent rather than inventing a parallel product architecture.

Codex must: - Read this file and repository docs before changing
architecture. - Inspect the live code before trusting historical
claims. - Verify frontend routes and backend endpoints. - Identify
dead/unreachable architecture. - Review UI/UX against written product
requirements and reference designs. - Fix regressions carefully. - Never
fake backend capabilities. - Never claim backend integration based only
on frontend mocks. - Run tests/typecheck/build where possible. - Report
verification honestly.

------------------------------------------------------------------------

# 3. PRODUCT GOAL

UnifiedTree HRMS should feel like one coherent platform rather than a
collection of pages.

Core UX principles:

1.  Users should immediately understand where they are.
2.  Users should immediately understand what they can do.
3.  Common actions should be visible, not hidden.
4.  Related functionality should be grouped logically.
5.  Tables, filters, pagination, forms, tabs, dialogs, cards, and empty
    states should behave consistently.
6.  Navigation should expose the real product, not hide major modules.
7.  Every important number or status shown in the UI should lead to a
    meaningful destination.
8.  A UI control must either work or not exist.
9.  Permissions must remain enforced.
10. Responsive behavior must be intentional, especially around 360px
    mobile, tablet, and desktop.
11. The product should look premium without becoming visually noisy.
12. Avoid unnecessary card-grid overload.
13. Avoid decorative UI that makes enterprise workflows harder to scan.
14. Prefer clear hierarchy, whitespace, typography, and contextual
    actions.

------------------------------------------------------------------------

# 4. LIVE TECH STACK

## Frontend

-   Turborepo / pnpm
-   Vite
-   React
-   TypeScript
-   Tailwind CSS
-   React Query
-   Zustand
-   react-hook-form
-   Zod
-   Recharts

## Backend

-   Spring Boot 3
-   Java 21
-   PostgreSQL
-   Flyway
-   JWT
-   RBAC
-   RLS

## Storage

-   Cloudflare R2
-   Existing production `R2Storage` component

## Existing reference HRMS

https://aniledulakanti24.github.io/unified-tree-hr-dashboard/

Treat the reference as visual/IA inspiration, not as a license to
blindly clone it.

------------------------------------------------------------------------

# 5. LIVE FRONTEND ARCHITECTURE

Current live flow:

main.tsx → App.tsx → PlatformShell.tsx → HRMS routes → page components →
shared components → API hooks → backend

`PlatformShell.tsx` is the live shell.

Do NOT revive or create competing versions of the shell.

Dead/parallel architecture that should not be revived:

-   `shared/layouts/Sidebar.tsx`
-   `shared/layouts/Header.tsx`
-   `shared/layouts/DashboardLayout.tsx`
-   `TopModuleNav.tsx`
-   old/dead `navigation.tsx`

Do not create a second navigation source of truth.

------------------------------------------------------------------------

# 6. CRITICAL CURRENT UI PROBLEM

The client is not asking for a cosmetic refresh.

The UI currently has both:

A. UX/design problems B. Actual functional regressions

Treat both as one recovery problem.

The user specifically wants Codex to understand the complete context and
work directly from the repository instead of requiring repeated ChatGPT
explanation.

------------------------------------------------------------------------

# 7. CURRENT P0 REPAIR LIST

Before adding major features, fix these.

## P0.1 Restore dashboard KPI behavior

The top dashboard KPI strip was regressed.

Previously these KPI cards had permission-gated/clickable behavior.

They were replaced with five inert `<div>` elements.

Required: - Restore actual interactive behavior. - Preserve permission
gating. - Give each KPI a meaningful destination. - Ensure the displayed
number corresponds to the destination. - Do not make cards clickable if
there is no meaningful destination.

------------------------------------------------------------------------

## P0.2 Fix dashboard attendance drill-down semantics

Current backend attendance row statuses are:

-   `NOT_MARKED`
-   `LATE`
-   `ON_TIME`

Dashboard aggregates include concepts such as:

-   Present
-   Absent
-   On Leave
-   WFH

These are NOT currently equivalent to backend row statuses.

Important: - Present can be represented by `ON_TIME`. - WFH is
associated with `attendanceType`, not the same status field. - Absent
and On Leave are aggregate/business concepts and cannot simply be passed
as unsupported row status filters.

Previous implementation incorrectly treated all six dashboard labels as
if they were direct row status filters.

Required: - Define honest mapping/derivation. - Do not create empty
drilldowns by sending unsupported values. - If a metric cannot be
drilled into with the current API, either: 1. derive it correctly from
available data, or 2. change the UI behavior so it points to a
meaningful view/filter, or 3. make the limitation explicit. - Do not
fake results.

------------------------------------------------------------------------

## P0.3 Restore desktop navigation

Current desktop navigation exposes only 13 of roughly 33 HRMS
destinations.

A full reference-IA `sidebarContent` exists but currently renders only
inside the mobile drawer (`md:hidden`).

Hidden/affected areas include examples such as:

-   Payroll Runs
-   Salary Structure
-   Compliance
-   Letters screens
-   Learning
-   PLI
-   Full & Final / F&F
-   Shifts
-   Advances

Required: - Design a coherent desktop navigation model. - Expose all
relevant destinations. - Preserve permissions. - Do not duplicate
navigation definitions. - Support collapsed sidebar behavior if it
exists in the intended design: - roughly 260--272px expanded - roughly
72--80px collapsed - icon-only collapsed state - tooltips - routes and
permissions preserved

The navigation must make module relationships understandable rather than
dumping 33 links into an unusable list.

------------------------------------------------------------------------

## P0.4 Fix SalaryStructureAdmin

Current DataTable migration broke bindings.

Observed problem: - Earnings panel renders employee directory data. -
Deductions panel renders employer contributions. - Computed `earnings` /
`deductions` values are unused.

This is a functional UI bug, not a design preference.

Required: - Inspect the actual Salary Structure API/data contract. -
Restore correct earnings data. - Restore correct deductions data. -
Ensure employer contributions remain distinct. - Verify create/edit/view
behavior if affected. - Do not patch with fake local data.

------------------------------------------------------------------------

# 8. NEXT MAJOR UI/UX PRIORITY

After P0 repairs:

## Document upload

Backend-wide document upload is NOT absent.

Existing proven implementation:

`UserAvatarController` → multipart upload → validation →
`R2Storage.put(...)` → `R2Storage.urlFor(...)`

`R2Storage` is a live component and is already used by production paths.

Therefore document upload should reuse this proven pattern.

Potentially unblock: - Document Vault - Employee Documents - Onboarding
Documents - Expense receipts

Do not invent another storage abstraction unless a real architectural
reason exists.

------------------------------------------------------------------------

# 9. IMPORTANT LATER EMPLOYEE READ GAPS

After P0 and document work:

1.  Generated letters should support a real `employeeId` filter/read
    path.
2.  Admin payslip history should reuse existing `listMyPayslips`
    capability where appropriate.
3.  Performance reviews need an employee-specific read path.
4.  Exit data needs `exitReason` / `noticeStartDate` projection where
    required.
5.  Employee-specific leave reads may need an API if the domain model
    supports it.

Do not mix these into the P0 UI recovery unless a current screen cannot
function without them.

------------------------------------------------------------------------

# 10. CURRENT ARCHITECTURAL DEBT

## Employee API duplication

Three employee API generations are still live:

-   `/v1/hrms` --- WorkforceController
-   `/v1/employees` --- EmployeeController
-   `/v1/employees/{id}/profile` --- EmployeeProfileController

The SPA calls all three.

Consolidation was previously planned but was never completed.

Do NOT casually merge them during UI work.

Treat API consolidation as a separate architecture milestone.

------------------------------------------------------------------------

## Canonical-dead backend beans

Approximately 28 bean classes across 15 packages do not load under
`canonical`.

`DefaultProfileScan` is:

`@Profile("!canonical")`

Therefore many of these classes are genuinely dead in the
production/canonical profile.

There are also duplicate/shadowed auth packages such as: -
`com.hrms.auth.*` - `com.unifiedtree.auth.*`

Do not revive dead architecture simply because it looks useful.

------------------------------------------------------------------------

## Unreachable frontend files

Approximately 24 of 198 frontend files are unreachable from `main.tsx`.

This includes duplicate/old shell and dashboard architecture.

Do not assume every file in the repository is part of the product.

Trace reachability from live routes.

------------------------------------------------------------------------

# 11. BACKEND / PRODUCT TRUTH FINDINGS

Approximate scale: - \~422 backend endpoint mappings - \~167 distinct
paths called by the SPA

This means the backend has substantially more capability than the
current UI exposes.

The correct response is NOT to invent new frontend functionality
blindly.

Instead: 1. map existing capabilities, 2. identify valuable user
workflows, 3. expose them coherently, 4. verify permissions, 5. verify
real API behavior.

------------------------------------------------------------------------

# 12. OTHER KNOWN FUNCTIONAL GAPS

## Hiring

`CandidateStage` models:

APPLIED → SCREENING → INTERVIEW → OFFER → HIRED

But the current `HiringController` mainly exposes
requisitions/candidates/stage behavior.

There is no verified automatic employee creation when a candidate
reaches HIRED.

Do not imply that the workflow is complete until verified.

------------------------------------------------------------------------

## Onboarding

Wizard has 8 steps.

It creates an employee and starts the checklist.

However, 4 of the 8 steps currently persist nothing.

The UI must not imply persistent completion if backend persistence does
not exist.

------------------------------------------------------------------------

## Learning / PLI

Functional areas exist but are currently unpaged/unfiltered in places:

-   `useTrainingPrograms(0)`
-   `useMyClaims(0,200)`

Rows beyond the hardcoded range may be unreachable.

Do not solve by client-side filtering on server-paginated data.

------------------------------------------------------------------------

## Reports

Headcount currently has a defect:

`ReportService.java:36` checks:

`ON_NOTICE`

while the enum uses:

`NOTICE_PERIOD`

Therefore headcount is permanently wrong/zero under the current
implementation.

------------------------------------------------------------------------

## Letters

Letters endpoint currently ignores `employeeId`.

Current per-employee filtering is therefore client-side/load-bearing.

Do not pretend the backend supports employee-specific letters until
fixed.

------------------------------------------------------------------------

## TDS

Dashboard TDS Liability tile points to a component/engine capability
that does not currently exist.

No TDS component/string exists in `hrms-payroll`.

Do not fabricate TDS data.

------------------------------------------------------------------------

## Termination

`POST /v1/employees/{id}/terminate` has no SPA caller.

It is also DB-invalid for resignation flows.

There are competing exit paths.

Do not wire it into the UI casually.

------------------------------------------------------------------------

## Zero-caller backend surfaces

Known built backend surfaces with no current SPA caller include:

-   ReimbursementBatchController --- 7 endpoints
-   AdvanceRecoveryController --- 6 endpoints
-   AppraisalCycleController --- 4 endpoints
-   PerformanceEmployeeController and hook
-   KpiController write surface
-   contractor/classification rules
-   statutory payroll files
-   L1/L2 leave chain

These are candidates for future workflow exposure, but each needs
product/permission/API verification before UI implementation.

------------------------------------------------------------------------

# 13. PERFORMANCE KPI PROBLEM

`GET /v1/performance/kpis` currently cannot execute correctly.

`toKpiDto` expects fields such as:

-   `category`
-   `target_value`
-   `current_value`
-   `unit`
-   `direction`
-   `due_date`

But the `performance_mgmt.goals` table from V071 does not contain those
expected fields.

Also `kpi_progress_updates` has no corresponding migration.

The Employee 360 Performance tab was previously tested against a stub,
so backend reality was NOT verified.

Required: - inspect the actual schema/query/DTO mismatch, - fix the real
backend contract if performance is being made live, - then verify with
real integration tests.

------------------------------------------------------------------------

# 14. PROTECTED / HIGH-RISK AREAS

Do not rewrite stable areas casually:

-   `PayrollEngine.java`
-   `LopCalculator.java`
-   leave service/entities/migrations
-   RBAC/RLS migrations
-   stable notifications
-   stable onboarding
-   stable letters unless fixing a verified defect

When a UI requirement appears to conflict with one of these: - inspect
first, - identify the actual backend contract, - make the smallest
correct change, - add tests.

------------------------------------------------------------------------

# 15. COMPLETED MILESTONES

## M1 --- Dashboard / Attendance drill-down

Implemented: - actionable dashboard attendance legend rows - attendance
status filtering - row-to-detail - clickable `HrStatCard` -
early-checkout support

Later findings: - four of six attendance drilldowns were semantically
wrong because dashboard aggregates do not map directly to row status
values. - top dashboard KPI strip later regressed to inert divs.

Therefore M1 should be considered partially regressed and requires
repair.

------------------------------------------------------------------------

## M2 --- Shared FilterBar

Implemented: - shared `FilterBar` - Workforce Directory migration -
shared pagination - rows-per-page

Employment-type filtering was deliberately NOT faked because backend
endpoint did not support it.

------------------------------------------------------------------------

## M3 --- Filter validation

Attendance: - genuine FilterBar - server-side department - client-side
status because attendance endpoint returns complete roster

Leave / Expense / Compliance / DocumentVault: - rows-per-page added - no
fake FilterBar because APIs lack appropriate server-side filters

Important: Most `<select>` elements in the application are form fields,
not filters.

------------------------------------------------------------------------

## M4A --- Audit Logs

Implemented: - action filter - resource filter - actor filter -
resourceId filter - from/to filters - debounced text filters - shared
pagination - rows-per-page

No backend change.

------------------------------------------------------------------------

## M4B --- Global Search

Implemented: - quick action registry - 30 permission-gated quick
actions - ranking - aliases - keyboard navigation - Escape - honest
no-result behavior - search pages derived from live `PlatformShell`
navigation

No API calls for deterministic page/action search.

------------------------------------------------------------------------

## M4C --- Employee entity search

Backend: - `SearchController.java` - `EmployeeSearchDtos.java` -
`WorkforceEmployeeService.search()` - `EmployeeSearchIT.java`

Endpoint:

`GET /api/v1/search?q=<text>&limit=<1..20, default 8>`

Response:

``` json
{
  "employees": [
    {
      "id": "...",
      "displayName": "...",
      "employeeCode": "...",
      "departmentName": "...",
      "jobTitle": "...",
      "profilePhotoUrl": "..."
    }
  ],
  "limit": 8,
  "truncated": false
}
```

Rules: - 400 if q is missing or \<2 chars after normalization - 401
without JWT - 403 without `hrms.employee.read` - active employees only -
first name, last name, full name, employee code, work email -
parameterized LIKE with metacharacter escaping - ordering by
exact/prefix/substring/employee code/id - existing
TenantAwareDataSource/RLS - no additional manager/department scoping
because existing directory does not provide it

Frontend: - `useEmployeeSearch.ts` - GlobalSearch EMPLOYEES group -
error isolation - truncation notice

Verification: - frontend 39/39 - combined regressions 175/175 -
tsc/build clean

Important: Backend `EmployeeSearchIT` was written/compiled but not
executed locally because Docker Desktop/WSL2 could not run due hardware
virtualization limitations and local PostgreSQL credentials were
unavailable.

CI must execute these tests before shipping.

------------------------------------------------------------------------

## M5A --- Employee 360

`EmployeeDetail.tsx` reduced from \~1,672 to \~453 lines.

Workspace components: - shared - EmployeeOverview - EmployeePersonal -
EmployeePayroll - EmployeeAttendance - EmployeeJob -
EmployeePerformance - EmployeeExit - EmployeeDocuments - EmployeeLetters

Final IA:

Overview \| Personal \| Job \| Attendance \| Payroll \| Documents \|
Letters \| Performance \| Exit

Leave and Expenses were intentionally omitted because existing APIs are
JWT/viewer-bound and lack employee-specific reads.

Added/reused: - attendance hooks - performance KPI hook - employee shift
hook - widened attendance response - weekly summary types - `HrTabs`
active-tab scroll behavior

Permissions: - use actual backend controller permissions. -
`hrms.employee.document.read` SDK constant is NOT the permission checked
by the document controller. - `DocumentController` uses
`hrms.document.read`.

Adversarial review found/fixed: - PILL_TONE mapping bug - DOB/gender
dropped - documents fetched twice - dead Letters pagination - false
claim that identity reads had been audited

CTC exposure was checked and backend-gated by `hrms.employees.pii.read`.

Verification: - 233/233 tests - zero console errors - clean tsc/build -
responsive at 360 / 768 / 1536

Important caveat: Performance was tested against a stub and therefore is
not backend-verified until the KPI schema/query problem is fixed.

------------------------------------------------------------------------

# 16. UI DESIGN DIRECTION

The desired UI is premium, clean, enterprise, and easy to scan.

The user previously wanted: - a comprehensive shared platform UI -
module subsections moved to top/module navigation where appropriate -
sidebar collapse - expanded width roughly 260--272px - collapsed width
roughly 72--80px - icons-only collapsed state - tooltips - preserved
routes - preserved permissions

Reference imagery/design work has included: - `hrms-dashboard.png` -
`main-parts.png`

Previous visual direction used: - `#0F6E56` - `#08402F` - `#ECFDF5`

The exact palette is not sacred if the new system has a stronger
coherent design rationale, but visual consistency is required.

Avoid: - random gradients everywhere - excessive glassmorphism -
excessive card nesting - tiny text - dense tables without hierarchy -
ambiguous icons - hidden primary actions - huge decorative hero areas
that push actual HR work below the fold - inconsistent spacing -
different patterns for every module

------------------------------------------------------------------------

# 17. INFORMATION ARCHITECTURE PRINCIPLE

The product should be organized around how HR users think, not how
backend controllers are named.

A useful conceptual grouping is:

### Workforce

-   Employees
-   Organization
-   Attendance
-   Shifts
-   Hiring
-   Onboarding

### Time & Leave

-   Attendance
-   Leave
-   Holidays
-   Shifts

### Payroll & Finance

-   Payroll Runs
-   Salary Structure
-   Payslips
-   Expenses
-   Advances
-   Full & Final
-   Reimbursements

### Performance & Growth

-   Goals / KPIs
-   Performance
-   Learning
-   PLI

### Compliance & Documents

-   Compliance
-   Documents
-   Letters

### Insights

-   Dashboard
-   Reports
-   Workforce Analytics

Do not blindly implement this list. Verify actual routes and permissions
and then make the IA coherent.

------------------------------------------------------------------------

# 18. UI REDESIGN PROCESS

For every major screen:

### Step 1 --- Understand the job-to-be-done

What is the user trying to accomplish?

### Step 2 --- Identify primary action

There should be one obvious primary action where applicable.

### Step 3 --- Establish hierarchy

Page title → context → key metrics / status → primary action →
filters/search → content → secondary actions

### Step 4 --- Make state visible

Every data screen should account for: - loading - empty - error -
success - permission denied - partial/no results

### Step 5 --- Keep interactions predictable

Use shared: - buttons - filters - table patterns - pagination -
dialogs - drawers - tabs - toasts - confirmation patterns

### Step 6 --- Verify destination semantics

If a number says 27: - clicking it must take the user to a place where
27 is explainable. - never make a dashboard metric clickable merely
because it looks clickable.

### Step 7 --- Responsive review

At minimum: - \~360px - tablet - desktop - wide desktop

### Step 8 --- Accessibility

Verify: - keyboard navigation - focus states - labels - semantic
buttons - sufficient contrast - tooltips for icon-only controls

------------------------------------------------------------------------

# 19. DESIGN IMAGE RULE

UI images generated by Astra/GPT are references, not implementation
specifications by themselves.

Every generated design should ideally have a companion screen spec
containing:

-   route
-   user role
-   purpose
-   primary action
-   secondary actions
-   layout regions
-   components
-   data required
-   API endpoints
-   permission requirements
-   loading state
-   empty state
-   error state
-   responsive behavior
-   interaction behavior

Claude/Codex should implement the written contract, using the image as
visual truth.

------------------------------------------------------------------------

# 20. DEFINITION OF DONE

A feature is not done because it renders.

Required:

## Functional

-   real data
-   real route
-   real API integration
-   real permissions
-   real workflow
-   no dead controls
-   no fake data
-   no fake success state

## Data

-   correct backend contract
-   correct server/client filtering model
-   no client-side filtering pretending to be server-side
-   no unnecessary N+1 calls

## UX

-   understandable without explanation
-   obvious primary action
-   consistent navigation
-   clear empty/error/loading states
-   meaningful dashboard drilldowns

## Responsive

-   \~360px
-   tablet
-   desktop
-   wide desktop

## Accessibility

-   keyboard
-   focus
-   semantic controls
-   labels/tooltips where needed

## Quality

-   TypeScript clean
-   build clean
-   tests clean
-   browser acceptance checks
-   zero meaningful console errors

## Backend

For backend-backed features: - verify actual endpoint - verify
authorization - verify tenant/RLS behavior - run integration/security
tests where available

------------------------------------------------------------------------

# 21. RULES FOR CODEX

Before changing code:

1.  Read this file.
2.  Read `AGENTS.md` if present.
3.  Read relevant `docs/platform/*`.
4.  Inspect the actual route/component/API.
5.  Trace the live call chain.
6.  Confirm whether a problem is:
    -   visual
    -   UX/IA
    -   frontend bug
    -   backend bug
    -   API contract mismatch
    -   permission issue
    -   dead architecture
7.  Make the smallest coherent change.
8.  Do not create duplicate architecture.
9.  Do not revive dead files.
10. Do not fake missing APIs.
11. Do not silently change protected payroll/leave/RBAC behavior.
12. Verify before claiming completion.

------------------------------------------------------------------------

# 22. CODEX UI REVIEW CHECKLIST

When reviewing any screen, ask:

### Discoverability

-   Can a first-time HR user tell what this page is?
-   Is the page purpose clear?
-   Can the user find the primary action in under a few seconds?

### Navigation

-   Is this route visible from an obvious place?
-   Can the user get back to the module without relying on browser back?
-   Does the sidebar/module nav reflect the actual product?

### Information hierarchy

-   What matters most?
-   Is it visually dominant?
-   Are secondary details subordinate?

### Tables

-   Are columns understandable?
-   Is the most important identifier first?
-   Are row actions obvious?
-   Is pagination consistent?
-   Are loading/empty/error states good?

### Forms

-   Are labels explicit?
-   Are required fields obvious?
-   Are validation errors actionable?
-   Is the submit action obvious?
-   Is destructive action clearly separated?

### Dashboard

-   Does every KPI mean something?
-   Does clicking it lead somewhere meaningful?
-   Are definitions understandable?
-   Are counts derived from real data?

### Mobile

-   Does the screen remain usable at 360px?
-   Does navigation collapse cleanly?
-   Do tables have an intentional mobile strategy?

------------------------------------------------------------------------

# 23. IMPORTANT DO NOTs

DO NOT: - create another shell - create another navigation registry -
duplicate dashboard architecture - invent APIs - invent database
fields - fake backend data - use client filtering to simulate
unsupported server filtering - mark backend work complete from a
frontend stub - expose privileged data without the actual backend
permission - rewrite payroll engine casually - rewrite leave/RBAC/RLS
casually - add visual complexity just to make the product look
"modern" - hide functionality to make a screen look cleaner - claim
tests passed when they were not executed

------------------------------------------------------------------------

# 24. CURRENT WORKFLOW RECOMMENDATION

For the current UI recovery phase:

1.  Audit live UI against actual routes/API/permissions.
2.  Establish the shared design system.
3.  Repair P0 functional regressions.
4.  Redesign the global shell/navigation.
5.  Redesign the dashboard.
6.  Establish shared page/table/filter/form patterns.
7.  Redesign module screens progressively.
8.  Implement document upload.
9.  Close employee read gaps.
10. Re-audit backend/frontend reachability.
11. Re-prioritize remaining workflows.

Do NOT start by redesigning 30 pages independently.

First create reusable primitives and a strong shell.

------------------------------------------------------------------------

# 25. RECOMMENDED REPOSITORY SOURCE OF TRUTH

Maintain these files:

-   `AGENTS.md`
-   `docs/platform/00-PROJECT-CONTEXT.md`
-   `docs/platform/01-PRODUCT-VISION.md`
-   `docs/platform/02-SYSTEM-ARCHITECTURE.md`
-   `docs/platform/03-UX-IA.md`
-   `docs/platform/04-DESIGN-SYSTEM.md`
-   `docs/platform/05-MODULE-MAP.md`
-   `docs/platform/06-API-ARCHITECTURE.md`
-   `docs/platform/07-RBAC-RLS.md`
-   `docs/platform/08-WORKFLOW-MAP.md`
-   `docs/platform/09-IMPLEMENTATION-ROADMAP.md`
-   `docs/platform/10-QUALITY-GATES.md`
-   `docs/platform/11-DECISIONS.md`
-   `docs/platform/execution/CURRENT-MILESTONE.md`
-   `docs/platform/execution/AGENT-HANDOFF.md`

The repository should become the persistent memory.

------------------------------------------------------------------------

# 26. IMMEDIATE CODEX MISSION

Codex should begin from the current repository state and do NOT assume
the old implementation is correct.

Mission:

### Phase A --- UI/UX recovery audit

-   Inspect current shell.
-   Inspect desktop and mobile navigation.
-   Inspect dashboard.
-   Inspect Salary Structure.
-   Inspect all major HRMS routes.
-   Identify visually inconsistent or functionally misleading patterns.
-   Compare route exposure against actual backend capabilities.
-   Identify broken controls.

### Phase B --- establish design system

Define/verify: - typography - spacing - colors - surfaces - borders -
radii - shadows - buttons - inputs - tables - tabs - filters - badges -
dialogs - drawers - toasts - page headers - sidebar - module navigation

### Phase C --- fix shell/navigation

Make the product understandable at the platform level.

### Phase D --- repair P0 functional regressions

-   dashboard KPI strip
-   attendance drilldowns
-   desktop navigation
-   SalaryStructureAdmin

### Phase E --- redesign dashboard

Make it useful, not decorative.

### Phase F --- create shared screen archetypes

Examples: - list page - detail page - settings/admin page - workflow
page - analytics page - form/create page

### Phase G --- migrate modules incrementally

Every migrated screen must satisfy Definition of Done.

------------------------------------------------------------------------

# 27. HOW CODEX SHOULD COMMUNICATE

At the start of each task, state:

1.  What is actually broken.
2.  What is already working.
3.  What files/routes/APIs will be changed.
4.  What will NOT be changed.
5.  Verification plan.

At the end: - files changed - behavior changed - tests run - tests not
run - build/typecheck result - browser verification result - known
remaining issues

Never hide uncertainty.

------------------------------------------------------------------------

# 28. CURRENT PRIORITY ORDER

1.  UI/UX architecture and shared design system
2.  Global shell/navigation
3.  Dashboard repair + redesign
4.  Salary Structure repair
5.  Attendance semantics/drilldown repair
6.  Shared table/filter/form patterns
7.  Module-by-module UI migration
8.  Real document upload
9.  Employee read gaps
10. Architecture consolidation and lower-priority cleanup

------------------------------------------------------------------------

# 29. FINAL PRODUCT PRINCIPLE

The objective is not:

"make every page look modern."

The objective is:

> Make UnifiedTree HRMS understandable, trustworthy, and efficient for
> real HR users.

A user should not need the developer to explain: - where something is, -
what a number means, - why a button exists, - whether an action actually
worked, - or which module owns a workflow.

The UI should make the system's real capabilities discoverable while
remaining honest about capabilities that do not yet exist.
