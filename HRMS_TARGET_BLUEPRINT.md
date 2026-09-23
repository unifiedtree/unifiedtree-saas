# HRMS TARGET BLUEPRINT

**Status:** Specification. No application source code was modified to produce this.
**Baseline:** `HRMS_CURRENT_STATE_AUDIT.md` (read in full) + direct repository inspection at commit `01b16f7`.
**UX/IA source of truth:** https://aniledulakanti24.github.io/unified-tree-hr-dashboard/
**Date:** 2026-09-21

---

# 1. Executive Summary

## What we are actually dealing with

The client's complaint — *"difficult to understand, I have to hunt for functionality"* — is **accurate**, but the cause is not what it looks like from outside. It is not a weak backend, and it is not primarily a styling problem.

Three numbers from the audit frame the entire project:

| | |
|---|---|
| Distinct backend API paths | **389** |
| Called by the frontend | **242** |
| **Never called by any UI** | **166 (43%)** |
| Frontend calls with no backend | **0** |

The frontend calls **zero** phantom APIs. Nothing is fundamentally broken. **43% of the product is built and unreachable.**

So the correct framing for this phase is not *"rebuild the HRMS"*. It is:

> **Turn an existing, substantial, well-tested HR backend into a product a human can navigate.**

That is a far better position to start from than it appears from the client's feedback, and it means the reference can be delivered largely by *exposure and re-organisation* rather than by new business logic.

## The three specific defects behind the complaint

Each was verified in code, not inferred:

1. **Global search is a dead shell.** `GlobalSearch.tsx` always returns `[]`. It was deliberately gutted on 2026-08-10 because it had been painting fabricated employees into a live customer's ⌘K panel. There is no `/v1/search` endpoint. **The single feature designed to stop users hunting has been inert for six weeks.**

2. **Dashboard numbers are terminal.** All six status cards navigate to the same unfiltered `/hrms/attendance`. `MiniStat` has no `onClick` prop at all. `Attendance.tsx` reads `?tab=` but not `?status=`, and its team table filters by *name only* — even though per-employee status is already in the payload.

3. **The employee profile is not a workspace.** Its 11 tabs (Overview, Contact, Work, Identity, Bank, Salary, Education, Experience, Dependents, Emergency, Documents) are **all static profile data**. None are operational. To understand one employee, HR must visit Attendance, Leave, Payroll, Expenses and Performance separately.

## What this blueprint commits to

- **Preserve** the payroll engine, leave loop, RBAC/RLS, notifications, letters, onboarding and organization modules. These are tested and correct.
- **Expose** the 166 unreachable endpoints where they answer a real user question.
- **Complete** documents, hiring and the exit flow.
- **Refuse** to build reference concepts we cannot honestly support (Section 6, Class E).

---

# 2. Client Requirements

Restated as testable product rules. Each becomes an acceptance criterion in Section 28.

| # | Requirement | Testable form |
|---|---|---|
| R1 | Same dashboard information architecture | Dashboard presents Overview → Analytics → Operations → Activity → Upcoming, in that order |
| R2 | Same page organization | Every page follows one grammar (Section 24.2) |
| R3 | Same navigation philosophy | Sidebar groups match the reference's 14 groups |
| R4 | Same placement/hierarchy of information | Summary above detail; primary action top-right |
| R5 | Easy discovery of common HR actions | Every top-20 action reachable in ≤2 clicks from the dashboard |
| R6 | No hunting through pages | Global search returns employees, actions and pages |
| R7 | **Dashboard numbers must lead to relevant details** | Every metric has a defined filtered destination (Section 8.3) |
| R8 | Workflows understandable without internal knowledge | No API/DB/developer vocabulary in any label |
| R9 | UI/UX substantially redesigned | One design system, not per-page restyling |
| R10 | Enterprise-grade, comparable to Keka/Odoo | Keka = usability; Odoo = operational depth |

**Explicitly out of scope:** colours, branding, imagery, pixel-cloning. Our emerald token set stands.

---

# 3. Reference Product Analysis

## 3.1 The critical realisation

The reference's sidebar was diffed against `MODULE_ITEMS` in `PlatformShell.tsx`. The result changes the project's character:

> **The reference is not a foreign product. It is this system's own information architecture, extended.**

Same 14 groups, same order, many leaf names verbatim — "Leave Operations Center", "Processing & Payslips", "Production-Linked Incentive", "Bank Disbursement", "Workforce Directory", "Employee Vault". **Employee Self Service is leaf-for-leaf identical.**

This means the reference is a *specification for the gaps*, not a redesign to imitate. It tells us where to put capability that mostly already exists.

## 3.2 Where our system already exceeds the reference

Do not lose these while chasing parity:

- **Geofencing** page (reference has none)
- **Letters split into three** pages — Templates / Generated / Distributions (reference has one)
- **Payroll Settings** as a distinct page
- **Attendance corrections** with a real approval queue

## 3.3 The reference's interaction model

Distilled from studying each of its pages:

| Pattern | How the reference applies it |
|---|---|
| Summary → detail → action | Every metric leads to a filtered list, then an entity, then an operation |
| Tabs = one entity, many facets | "Employee Master / Contractor Master / Classification Rules" are facets of *workforce* |
| Tabs ≠ unrelated workflows | Separate concerns get separate sidebar leaves, not tabs |
| Operational tables | Every list carries filters, status badges, row actions, pagination |
| Explicit workflow stages | Hiring shows Job Openings → Applicants & Interviews → Offer Management as distinct tabs |
| Dense over decorative | Small type, tight rows, many facts per screen |

## 3.4 Reference page inventory

Condensed; full label list is in `HRMS_CURRENT_STATE_AUDIT.md` §2.

| Module | Reference pages | Notable tabs / structures |
|---|---|---|
| Company | Company Profile, Companies & Branches | Branch table + geofence config |
| Master | Workforce Directory, Organization Setup, Rules & Policies, Payroll Configuration | Employee/Contractor/Classification masters |
| Attendance | Analytics, Daily Tracking, Shifts & Overtime | Daily Logs / Face Punch Logs / Regularization; Roster / OT Approvals |
| Leave | Leave Operations Center | Applications & Approvals / Balances & Comp-offs / Calendar |
| Recruitment | Hiring Pipeline, Onboarding & Assets, Employee Vault | Job Openings / Applicants & Interviews / **Offer Management**; **Asset Allocation**; Letters / Document Vault |
| Payroll | Dashboard, Salary Structure, Processing & Payslips, PLI, Advances & Loans, Bank Disbursement | Cost/Avg/Pending/**TDS** KPIs |
| Expenses | Expense Center | Claims / Travel Advances / **Reimbursements** |
| ESS | My Attendance & Leaves, My Payslip, My Profile, Team Attendance | — |
| Performance | Employee Performance, Appraisals & 360°, **KPI Tracking**, **Skill Matrix**, **Training**, **Certifications** | — |
| Compliance | Statutory, Muster Roll, **POSH**, **Inspector View**, **Compliance Calendar** | — |
| Reports | Attendance & Overtime, Payroll Reports, Workforce Analytics | Salary Register / Tax / PF & ESI / Variance |
| Exit | Resignation & Exit, F&F, **Experience Letter** | Pending Calculation / Pending Payment / Settled |
| Settings | HR Config, Holiday Calendar, Roles, Notification Templates, Integrations, Audit Logs | — |

---

# 4. Reference Information Architecture

The reference's own grouping, which we adopt as the starting point:

```
COMPANY PROFILE → DASHBOARD → MASTER → ATTENDANCE & TIME → LEAVE MANAGEMENT
→ RECRUITMENT & ONBOARDING → PAYROLL → EXPENSE MANAGEMENT → EMPLOYEE SELF SERVICE
→ PERFORMANCE & LEARNING → COMPLIANCE → REPORTS & ANALYTICS → EMPLOYEE EXIT → SETTINGS
```

Its two structural strengths, both worth keeping:

1. **Group names describe user domains**, not system modules ("Attendance & Time", not "AttendanceController").
2. **Leaf count scales with operational depth** — Payroll gets 6 leaves, Leave gets 1. Depth follows real complexity rather than a uniform template.

---

# 5. Current System Summary

Only what is needed to read Section 6. Full detail lives in the audit.

**Stack.** Turborepo/pnpm · Vite 5 + React 18 + TS + Tailwind · react-query v5 · zustand · react-hook-form + zod · recharts · Spring Boot 3 / Java 21 (19 modules) · PostgreSQL + Flyway (120 migrations) · **Postgres RLS** for tenancy · Cloudflare R2 storage · Spring-event notification pipeline.

**Scale.** 94 route declarations · 96 screen files · 389 API paths · 149 permission codes · 33 backend tests · 58 E2E specs · **1** frontend unit test.

**Health.** Strong: payroll engine (golden-master tested), leave loop (LOP → payroll, tested), RBAC + cross-tenant isolation (tested), letters, onboarding, organization, audit log. Weak: document storage, dashboard drill-down, hiring lifecycle, global search.

**Architecture debt.** Two code generations separated only by `spring.profiles.active: canonical`; **38 dead Spring beans** across 20 packages; **three competing employee APIs**; two controllers both mapping `/v1/notifications`.

## 5.1 Dead frontend code — act on this immediately

Verified by import analysis. These files are **imported by zero modules**; only `layouts/PlatformShell.tsx` is routed:

| File | Imported by | Currently being edited? |
|---|---|---|
| `shared/layouts/DashboardLayout.tsx` | **0** | **Yes (modified)** |
| `shared/layouts/Header.tsx` | **0** | **Yes (modified)** |
| `shared/layouts/Sidebar.tsx` | **0** | **Yes (modified)** |
| `shared/components/CommandPalette.tsx` | 1 (by dead `DashboardLayout`) | No |
| `shared/layouts/TopModuleNav.tsx` | **0** | New, untracked |
| `shared/layouts/navigation.tsx` | **0** | New, untracked |

> ⚠️ **Redesign work is currently going into three files that never render.** `TopModuleNav`/`navigation` are presumably intended for wiring into `PlatformShell`; the other three are legacy from an earlier shell generation. Confirm before spending more effort there.

---

# 6. Reference → Current → Target Gap Matrix

**Classification:** **A** exists & usable · **B** exists, UX rework · **C** backend exists, UI missing · **D** genuinely missing · **E** should not be implemented

| # | Reference area | Current page / API | State | Reusable backend | Gap type | Class | Target |
|---|---|---|---|---|---|---|---|
| 1 | Dashboard command centre | `HrmsDashboard.tsx` | Metrics terminal | All metrics real | **UX + Workflow** | **B** | Every metric drills down |
| 2 | Global search | `GlobalSearch.tsx` returns `[]` | **Inert** | None — no `/v1/search` | **Backend + UX** | **D** | Search employees/actions/pages |
| 3 | Workforce Directory | `Employees.tsx` | Filters ok | `/v1/hrms/employees` | **UI** | **B** | + export, bulk, rows-per-page, type filter |
| 4 | Contractor Master | — | **No UI** | `/v1/hrms/contractors` (3 eps) | **UI** | **C** | Tab on Workforce |
| 5 | Classification Rules | — | **No UI** | `/v1/hrms/classifications` (3 eps) | **UI** | **C** | Tab on Workforce |
| 6 | Employee profile | `EmployeeDetail.tsx`, 11 static tabs | Data-only | All profile eps wired | **UX + Workflow** | **B** | Add operational tabs |
| 7 | Document Vault | `DocumentVault.tsx` | **URL paste box** | `R2Storage.put()` works | **Backend + UX** | **D** | Real multipart upload |
| 8 | Organization Setup | `/hrms/organization` | Works | Full CRUD | — | **A** | Keep; surface under People |
| 9 | Rules & Policies | `/hrms/policies` | Works | Policy + ack | — | **A** | Keep |
| 10 | Attendance Analytics | `/hrms/att-analytics` | Shallow | Trend + sources eps | **UI** | **B** | KPIs + trends + calendar |
| 11 | Daily Tracking | `/hrms/attendance` | Works | Logs eps | **UX** | **B** | Add `?status=` drill-down |
| 12 | Face Punch Logs | — | **No web UI** | `FaceController` (8 eps) | **UI** | **C** | Tab under Daily Tracking |
| 13 | Regularization | corrections tab | Works | Corrections eps | — | **A** | Promote to own leaf |
| 14 | Shifts & Overtime | `/hrms/shifts` | Partial | Shift eps (3 unexposed) | **UI** | **C** | Roster + OT approvals |
| 15 | Weekly offs / punch zone | — | **No UI** | `PUT /weekly-offs`, `/punch-zone` | **UI** | **C** | On employee Job tab |
| 16 | Leave Operations | `/hrms/leave` | **Strong** | Full loop, tested | — | **A** | Repackage only |
| 17 | Holiday Calendar | in Settings | Works | Holidays eps | **UX** | **B** | Own Settings leaf |
| 18 | Hiring Pipeline | `/hrms/hiring` | Req + candidate + stage | 8 eps | — | **A** | Keep as stage 1 |
| 19 | Interviews | — | **Missing** | **None** | **Backend** | **D** | New entity + UI |
| 20 | Offer Management | — | **Missing** | **None** | **Backend** | **D** | New entity + UI |
| 21 | Candidate → Employee | — | **Missing** | **None** | **Backend + Workflow** | **D** | Conversion endpoint |
| 22 | Onboarding | `/hrms/onboarding/*` | **Strong** (just extended) | Templates + instances | — | **A** | Keep |
| 23 | Asset Allocation | — | **Missing** | **None** | **Backend** | **D** | Defer to P2 |
| 24 | Letters | 3 pages | **Strong** | Generate + PDF + distribute | — | **A** | Keep |
| 25 | Payroll Dashboard | `/hrms/payroll-dashboard` | Works | KPIs + trend | **UI** | **B** | Add exceptions drill-down |
| 26 | Salary Structure | `/hrms/salary-structure` | Works | Structures + history | — | **A** | Keep |
| 27 | Processing & Payslips | `/hrms/payroll/runs` | **Strong** | Run lifecycle + PDF | — | **A** | Keep |
| 28 | TDS | Column only | **Never computed** | **None** | **Backend** | **D** | P1 — real engine work |
| 29 | Statutory files | PF ECR only | Partial | ECR ships | **Backend** | **D** | ESI/PT/24Q deferred |
| 30 | PLI | `/hrms/pli` | Partial | PLI eps | **UI** | **B** | Complete |
| 31 | Advances | `/hrms/advances` | Request only | 6 recovery eps unexposed | **UI** | **C** | Schedule/ledger/foreclose |
| 32 | Bank Disbursement | `/hrms/bank-disbursement` | Works | Batches + file | — | **A** | Keep |
| 33 | Expense Claims | `/hrms/expenses` | Works | Claims + approvals | — | **A** | Keep |
| 34 | Reimbursement batches | — | **No UI** | 7 eps unexposed | **UI** | **C** | Third tab |
| 35 | Employee Performance | `/hrms/performance` | Partial | Cycles/goals/reviews | **UI** | **B** | Complete |
| 36 | Appraisals & 360° | partial | 2 of 6 wired | `AppraisalCycleController` | **UI** | **C** | initiate/progress/close/remind |
| 37 | KPI Tracking | — | **No UI** | `KpiController` (7 eps) | **UI** | **C** | Full KPI screen |
| 38 | Skill Matrix | `/hrms/learning` | Wired | `/v1/learning/skills` | **UI** | **B** | Promote to own view |
| 39 | Training Programs | `/hrms/learning` | Wired | 8 program eps | **UI** | **B** | Promote |
| 40 | Certifications | partial | Partial | Learning eps | **UI** | **B** | Complete |
| 41 | Statutory Compliance | `/hrms/compliance` | Wired | items + filings | — | **A** | Keep |
| 42 | POSH | in Compliance | **Wired** | 3 eps | **UX** | **B** | Own leaf, confidential |
| 43 | Muster Roll | `/hrms/muster-roll` | Works | — | — | **A** | Keep |
| 44 | Compliance Calendar | — | **Missing** | Filings have due dates | **UI** | **C** | Calendar over filings |
| 45 | Inspector View | — | **Missing** | **None** | **Backend** | **E** | See 6.1 |
| 46 | Reports | `/hrms/reports` + 6 CSV | **Strong** | 6 reports + exports | — | **A** | Keep |
| 47 | Workforce Analytics | `/hrms/workforce-analytics` | Works | — | — | **A** | Keep |
| 48 | Resignation & Exit | `/hrms/fnf` | **Route collision** | `/exit`, `/notice` | **Architecture** | **B** | Split into own page |
| 49 | F&F | `/hrms/fnf` | Partial | FNF module | **UI** | **B** | Complete tabs |
| 50 | Experience Letter | — | Missing as leaf | Letters can generate | **UI** | **C** | Wire template |
| 51 | HR Configuration | `/hrms/settings` | Works | Settings eps | — | **A** | Keep |
| 52 | Roles & Permissions | `/roles` (admin scope) | Works | RBAC | **UX** | **B** | Surface in Settings |
| 53 | Audit Logs | `/audit-logs` (admin) | **Strong** | Partitioned | **UX** | **B** | Surface in Settings |
| 54 | Notification Templates | `/hrms/notification-templates` | Works | — | — | **A** | Keep |
| 55 | Integrations | `/hrms/integrations` | Works | — | — | **A** | Keep |
| 56 | ESS | `/me`, `/me/payslips` | Works | ESS eps | **UX** | **B** | Coherent workspace |
| 57 | Team Attendance | `/team` | Partial | Team dashboard ep | **UX** | **B** | Add drill-down |
| 58 | WFH approvals | thin | 5 eps unexposed | `WfhController` | **UI** | **C** | Approval queue |
| 59 | Top Performers | — | Missing | **No endpoint** | **Data** | **E** | See 6.1 |
| 60 | Payroll vs Budget | — | Missing | **No budget data** | **Data** | **E** | See 6.1 |
| 61 | Projects & Productivity | ComingSoon | Unsold SKU | — | **Product** | **E** | See 6.1 |
| 62 | AI & Predictive Insights | — | Missing | **No data source** | **Data** | **E** | See 6.1 |

## 6.1 Class E — reference concepts we should NOT implement

Each with a stated reason. This list is the honesty boundary.

| Concept | Why not | Alternative |
|---|---|---|
| **AI & Predictive Insights** (absenteeism anomaly, burnout risk, hiring suggestion) | No model, no training data, no feature store. Any implementation would be invented text presented as analysis — inside an HR system, where it could influence decisions about real people. | Deliver **Exceptions**: real, explainable rules over real data ("6 employees have >3 late marks this month"). Same shelf position, defensible. |
| **Projects & Productivity** | `projects` is an **unsold SKU** (`LAUNCHING_SOON`, ₹0). Building it advertises something the customer cannot buy. | Omit. If the client asks, it's a commercial conversation. |
| **Top Performers** | No ranking endpoint. Performance ratings exist but are cycle-scoped and sparse; a "top 4" from thin data is misleading. | Defer until appraisal cycles carry real completed data. |
| **Payroll vs Budget** | No budget entity anywhere in 120 migrations. The "vs Budget" half would be fabricated. | Show **Payroll Cost Trend** (real, already backed by `/payroll/dashboard/trend`). |
| **Inspector View** | 0 endpoints, 0 Java, 0 migrations. Also a security-sensitive feature (time-boxed public read-only links to HR data) that needs proper threat modelling, not a fast build. | P3, with a security review. Do not demo. |

> **Rule:** a card that looks real but has no underlying data is worse than an absent card. It converts a UI problem into a credibility problem.

---

# 7. Target Information Architecture

Reconciles the reference with our real capability. **Bold** = new or newly exposed.

```
🏠  Dashboard

👥  People
      Workforce Directory        /hrms/employees
         ├ Employees · Contractors* · Classifications*
      Organization               /hrms/organization
      Onboarding                 /hrms/onboarding/instances
      Employee Vault             /hrms/documents

⏱  Time & Attendance
      Analytics                  /hrms/att-analytics
      Daily Tracking             /hrms/attendance
         ├ Daily Logs · Face Logs* · Regularization
      Shifts & Overtime          /hrms/shifts
         ├ Roster · OT Approvals*
      Geofencing                 /hrms/attendance/geofencing

🌴  Leave
      Leave Operations Center    /hrms/leave
         ├ Applications · Balances · Calendar · Types · Holidays

💼  Hiring
      Requisitions & Candidates  /hrms/hiring
      Interviews**               /hrms/hiring/interviews
      Offers**                   /hrms/hiring/offers

💰  Payroll
      Payroll Dashboard          /hrms/payroll-dashboard
      Salary Structure           /hrms/salary-structure
      Processing & Payslips      /hrms/payroll/runs
      Production-Linked Incentive /hrms/pli
      Advances & Loans           /hrms/advances
         ├ Requests · Recovery*
      Bank Disbursement          /hrms/bank-disbursement
      Configuration              /hrms/payroll/components
      Settings                   /hrms/payroll/settings

💳  Expenses
      Expense Center             /hrms/expenses
         ├ Claims · Travel Advances · Reimbursements*

🎯  Performance & Learning
      Employee Performance       /hrms/performance
      Appraisals & 360°*         /hrms/performance/appraisals
      KPI Tracking*              /hrms/performance/kpis
      Skills & Training          /hrms/learning

⚖️  Compliance
      Statutory Compliance       /hrms/compliance
      Compliance Calendar*       /hrms/compliance/calendar
      POSH*                      /hrms/compliance/posh
      Muster Roll                /hrms/muster-roll

📊  Reports
      Reports Center             /hrms/reports
      Workforce Analytics        /hrms/workforce-analytics

🚪  Exit
      Resignation & Exit**       /hrms/exit         ← split from F&F
      Full & Final Settlement    /hrms/fnf
      Experience Letters*        /hrms/letters/generated?type=EXPERIENCE

⚙️  Settings
      HR Configuration · Holiday Calendar* · Roles & Permissions†
      Notification Templates · Integrations · Audit Logs†

👤  Self Service        (employee/manager scope)
      My Profile · My Attendance & Leave · My Payslips · My Documents · My Team
```

`*` newly exposed (backend exists) · `**` new build · `†` moved from admin scope into Settings

## 7.1 Navigation rules

1. **Group = user domain**, never a system module name.
2. **Sidebar shows leaves with full labels.** No truncation ("Perform", "Comply" are not words).
3. **Tabs only within one entity or one domain.** Never to hide unrelated workflows.
4. **Max depth 2** (group → leaf). A third level becomes tabs on the leaf.
5. **Nothing role-gated disappears silently** — an unauthorised leaf is absent, never a 403 on click.
6. **Self Service is a scope, not a section** — it swaps the whole sidebar for employee/manager users.

## 7.2 The route collision to fix

`Resignation & Exit` and `Full & Final Settlement` **both point to `/hrms/fnf`** today. The shell dedupes by path, so only one sub-tab ever renders. The reference correctly separates them. Splitting them is a P0 correctness fix, not a nicety.

---

# 8. Target Dashboard

## 8.1 Principle

> The dashboard is a **command centre**, not a report. Every number is a question, and every question must have a destination.

## 8.2 Structure (reference hierarchy, our real data)

```
┌─ Greeting · date · live clock ······················ [Mark Attendance] [Generate Report]
├─ LIVE OVERVIEW      8 KPI tiles, all drill-through
├─ ANALYTICS          Attendance trend · Department headcount · Attendance sources
├─ OPERATIONS         Exceptions · Pending approvals · Onboarding tracker · Hiring funnel
├─ ACTIVITY           Audit feed (real)
└─ UPCOMING           Birthdays · Anniversaries · Probation endings · Retirements
```

Dropped from the reference: AI Insights, Top Performers, Payroll vs Budget, Projects (Section 6.1).

## 8.3 Drill-down map — the core deliverable

Every tile, its destination, and whether it needs backend work. **This table is the fix for the client's #1 complaint.**

| Metric | Source | Destination | Backend needed? |
|---|---|---|---|
| Total Employees | `/hrms/employees/counts` | `/hrms/employees` | No |
| Present Today | `attendance/dashboard` | `/hrms/attendance?tab=team&status=PRESENT` | No — filter only |
| On Leave | `attendance/dashboard` | `/hrms/leave?tab=approved&date=today` | No |
| Absent Today | `attendance/dashboard` | `/hrms/attendance?tab=team&status=ABSENT` | No |
| Late Arrivals | `attendance/dashboard` | `/hrms/attendance?tab=team&status=LATE` | No |
| Half Day | `attendance/dashboard` | `…&status=HALF_DAY` | No |
| Work From Home | `attendance/dashboard` | `…&status=WORK_FROM_HOME` | No |
| Not Marked | `attendance/dashboard` | `…&status=NOT_MARKED` | No |
| Early Going | `counts.earlyCheckout` | `…&status=EARLY_OUT` | No |
| Pending Leave | `leave/overview` | `/hrms/leave?tab=approvals` | No |
| Pending Corrections | `corrections/approvals` | `/hrms/attendance?tab=corrections` | No |
| Pending WFH | `/v1/wfh` | `/hrms/wfh?tab=approvals` | **Expose** |
| Attendance source ×6 | `dashboard/sources` | `…&method=FACE_RECOGNITION` | **Filter param** |
| Open Positions | `hiring/requisitions` | `/hrms/hiring?status=OPEN` | No |
| Candidates in pipeline | `hiring/requisitions` | `/hrms/hiring?tab=candidates` | No |
| Onboarding in progress | `onboarding/instances` | `/hrms/onboarding/instances` | No |
| Payroll run status | `payroll/dashboard/kpis` | `/hrms/payroll/runs/{id}` | No |
| Payroll exceptions | `runs/{id}/skipped` | `/hrms/payroll/runs/{id}?tab=skipped` | No |
| Seats used | `workspace/seats/usage` | `/settings/billing` | No |
| Birthdays / anniversaries | `/v1/milestones` | `/hrms/employees?filter=birthday` | Minor |

**Of 20 drill-downs, 17 need no backend work at all** — only a query param and a click handler. This is the highest-leverage work in the entire project.

## 8.4 Dashboards are role-shaped

| Role | Opens on | Emphasis |
|---|---|---|
| HR / Admin | Org dashboard | Workforce, exceptions, approvals |
| Finance | Payroll dashboard | Cost, exceptions, disbursement |
| Manager | Team dashboard | Team attendance, my approvals |
| Employee | Self-service home | My attendance, leave balance, payslip |

---

# 9. Global Search & Navigation

## 9.1 Current state

`GlobalSearch.tsx` returns `[]` unconditionally. No `/v1/search` endpoint exists. **This is a P0.**

## 9.2 Target

A ⌘K palette with three result classes:

```
┌ Search employees, actions, pages…                    ⌘K ┐
│                                                          │
│  EMPLOYEES                                               │
│    Aarav Menon · UT-0141 · Engineering        → profile  │
│                                                          │
│  ACTIONS                                                 │
│    Apply leave                                → /leave   │
│    Add employee                               → drawer   │
│    Run payroll                                → /runs    │
│                                                          │
│  PAGES                                                   │
│    Attendance → Late Arrivals                            │
└──────────────────────────────────────────────────────────┘
```

**Entity search** (needs `GET /v1/search?q=`): employees by name/code/email. Scope-filtered server-side by RLS + permissions — a manager must not find employees outside their scope.

**Action search** (frontend only, ship first): a static registry of ~40 actions, each with a permission code and target. Filtered by the caller's permissions. **This alone answers much of the client's complaint and needs no backend.**

**Page search** (frontend only): the nav tree, permission-filtered.

**Ship order:** actions + pages (frontend, day 1) → employees (needs endpoint).

## 9.3 Other discoverability mechanisms

- **Quick Actions** on the dashboard — permission-gated, 6–8 max
- **Breadcrumbs** on every page ≥2 deep
- **Contextual actions on rows** — visible, not hidden in a ⋯ menu
- **Recently viewed** employees in the palette

---

# 10. Employee Workspace

## 10.1 Problem

11 tabs, all static. Zero operational. HR visits 5 modules to understand one person.

## 10.2 Target

```
┌ ← Workforce   Aarav Menon · UT-0141 · Engineering · [Active] ┐
│                        [Edit] [Letters ▾] [Actions ▾]        │
├──────────────────────────────────────────────────────────────┤
│ Overview │ Personal │ Job │ Attendance │ Leave │ Payroll │    │
│ Documents │ Expenses │ Performance │ Letters │ Exit          │
└──────────────────────────────────────────────────────────────┘
```

| Tab | Content | Source | Status |
|---|---|---|---|
| **Overview** | Snapshot: manager, shift, attendance %, leave balance, last payslip, pending items | Composite | **New view, existing eps** |
| Personal | Contact, identity, education, experience, dependents, emergency | `profile/*` | Merge 6 existing tabs |
| **Job** | Designation, dept, branch, manager, **weekly offs**, **punch zone**, probation | `+ PUT /weekly-offs`, `/punch-zone` | **Expose** |
| **Attendance** | Monthly calendar, late marks, corrections | `attendance/history` | **New tab** |
| **Leave** | Balances, history, pending | `leave/*` | **New tab** |
| Payroll | Structure + history + payslips | `structures/employee/{id}` | Extend |
| **Documents** | Real vault, upload, expiry | Needs upload ep | **Fix** |
| **Expenses** | Claims + advances | `expense/*`, `advance/*` | **New tab** |
| **Performance** | Goals, KPIs, reviews | `performance/*` | **New tab** |
| Letters | Generated letters | `letters/*` | Rename from Documents |
| **Exit** | Notice, clearance, F&F | `exit`, `fnf` | **New tab** |

**Rule:** merging the 6 static tabs into *Personal* frees the tab bar for the 6 operational tabs that make this a workspace. Tab count stays ~11 — the *composition* changes.

---

# 11. Attendance & Time

**Class B — strong backend, shallow UI.**

| Page | Tabs | Key change |
|---|---|---|
| Analytics | — | KPIs + trend + on-time rate + month calendar |
| Daily Tracking | Daily Logs · **Face Logs** · Regularization | **Accept `?status=` and `?method=`** |
| Shifts & Overtime | Roster · **OT Approvals** | Expose 3 unused shift eps |
| Geofencing | — | Keep (we exceed the reference) |

**The critical fix:** `Attendance.tsx` must accept `?tab=team&status=LATE` and filter `staffStatuses` by status. Today it filters by *name only*, though status is already in the payload. Columns must add **expected vs actual check-in and late duration** — otherwise "who are the 14?" is answered but "how late?" is not.

**Not verified, must be tested at runtime:** cross-midnight shifts, duplicate punches, grace periods, timezone handling. These cannot be settled by reading code.

---

# 12. Leave

**Class A — do not rebuild.** The loop (apply → approve → balance → LOP → payroll) is tested end to end (`LeaveFlowIT`, `LopCalculatorTest`).

Repackage only, into the reference's Leave Operations Center:

```
Leave Operations Center                      [Apply Leave] [Export]
Pending 7 · Approved · Rejected · Upcoming
Applications │ Balances & Comp-offs │ Calendar │ Types │ Holidays
```

Additions: calendar view of who is away; comp-off visibility; leave conflict warnings on apply.

---

# 13. Hiring & Recruitment

**Class D — the largest genuine product gap.**

Current: requisition → candidate → stage. Nothing else. Backend has **8 endpoints total**.

```
Requisition → [approval] → Candidate → Interview → Feedback
   → Offer → Acceptance → CONVERT TO EMPLOYEE → Onboarding
              ▲                                    ▲
              └── missing ────────────────────────┘
```

**Required new backend:**

| Entity | Endpoints | Notes |
|---|---|---|
| `Interview` | schedule, reschedule, cancel, list | candidate + panel + time + mode |
| `InterviewFeedback` | submit, list | rating + recommendation per panellist |
| `Offer` | create, send, accept, reject, revise | CTC, joining date, status |
| **Conversion** | `POST /v1/hiring/candidates/{id}/convert` | **The one that matters most** — creates the employee, carries name/contact/CTC, links onboarding, enforces seat quota |

> "I hired this candidate — why must I type them in again?" is the demo question this answers. Conversion is more valuable than interviews or offers if only one can be built.

---

# 14. Onboarding & Employee Vault

## Onboarding — Class A
Templates → instances → tasks works and was just extended (commit `01b16f7`). Keep. Add: progress on dashboard, reminders, reassignment. **Asset Allocation is Class D** — no backend; defer to P2.

## Employee Vault — Class D, and a P0

**Evidence:** `DocumentRequest` requires `@NotBlank String fileUrl`. `DocumentVault.tsx:354` is `<input placeholder="https://…">`. No multipart endpoint for documents exists.

**But:** `R2Storage.put(key, bytes, contentType)` is generic and already in production for branding. **The storage layer is done; only the endpoint is missing.** This is a small fix with outsized impact.

Target: real file input, drag-drop, type/size validation, category, expiry tracking, permission-scoped download, audit trail. Separate **Documents** (uploaded files) from **Letters** (generated) — today the profile's "Documents" tab actually queries `letters/generated`.

---

# 15. Payroll

**Class A/B — technically the strongest module; the UI undersells it.**

Working and tested: run lifecycle (create → process → lock → reopen), PF/ESI/PT via a golden-master-tested engine, LOP from leave, payslip PDFs, salary structures with history, bank disbursement files, PF ECR, salary register.

| Gap | Class | Priority |
|---|---|---|
| Exceptions not surfaced (`/runs/{id}/skipped` exists) | B | **P0** |
| **TDS never computed** | D | P1 |
| ESI/PT/24Q statutory files | D | P2 (deferred by design) |
| Advance recovery UI (6 eps) | C | P1 |
| Arrears, gratuity, leave encashment | D | P2 |

**Progressive disclosure** (the reference's model):
```
May 2026 · ₹1.24 Cr · 248 employees · ⚠ 2 exceptions
[Review Exceptions] [Process Payroll]
   ↓
Rajesh Kumar — missing bank details      [Fix]
Priya Mehta — attendance not finalised   [Fix]
```

---

# 16. Expenses & Advances

**Class C — backends complete, UI absent.**

| Feature | Endpoints | UI |
|---|---|---|
| Claims + approvals | wired | ✅ |
| Travel advances | wired | ✅ |
| **Reimbursement batches** | **7, unexposed** | ❌ |
| **Advance recovery** | **6, unexposed** | ❌ |

Reimbursement batch lifecycle already exists: create → post → mark-paid → cancel → revert-claims. Advance recovery already exists: schedule, ledger, summary, skip-month, foreclose, write-off. The reference's "Advances & Loans" columns (Principal, EMI/Recovery, Remaining Balance) map exactly onto those endpoints.

**This is pure UI work over finished business logic.**

---

# 17. Performance & Learning

**Class C — the biggest "hidden feature" cluster.**

| Feature | Backend | UI |
|---|---|---|
| Cycles, goals, reviews | ✅ | Partial |
| **KPI tracking** | **7 eps** | **None** |
| **Appraisal cycle admin** | **6 eps, 2 wired** | Partial |
| Skills | ✅ wired | Buried |
| Training programs | ✅ 8 eps wired | Buried |
| Certifications | ✅ | Partial |

Learning is **better wired than the audit first credited** — programs, enrolments, bulk enrol and skills are all live. The problem is that six reference concepts hide behind two sidebar leaves.

---

# 18. Compliance

**Class A/B — better than expected.** POSH, filings and items are **all wired**.

| Feature | State |
|---|---|
| Statutory compliance | ✅ wired |
| Filings ledger | ✅ wired |
| **POSH** | ✅ wired, needs own confidential leaf |
| Muster roll | ✅ |
| **Compliance Calendar** | **C** — filings carry due dates; needs a calendar view |
| **Inspector View** | **E** — no backend, security-sensitive, P3 |

---

# 19. Reports

**Class A — keep.** Six reports (headcount, attrition, attendance summary, leave balance, late marks, diversity), each with a CSV export carrying the *identical* `@PreAuthorize` as its JSON sibling.

Gaps: **no employee directory export** (P0 — the screen HR lives in), no attendance raw export, no payroll register export from the UI. Reuse the existing CSV pattern (RFC-4180 + BOM already solved).

---

# 20. Exit & F&F

**Class B — with a real bug.**

`Resignation & Exit` and `Full & Final Settlement` both route to `/hrms/fnf`; the shell dedupes and only one renders. Two competing backend paths exist: `/v1/hrms/employees/{id}/exit` (used) and `/v1/employees/{id}/terminate` (orphan).

Target: one continuous workflow —
```
Resignation → Approval → Notice period → Clearance → F&F → Letters → Exit
```
with F&F tabs Pending Calculation / Pending Payment / Settled, and Experience Letter wired to the existing letters engine.

---

# 21. Employee Self-Service

**Class B.** Everything exists; it is not a coherent workspace.

```
My Workspace
  Today          punch status, today's shift, [Mark Attendance]
  My Attendance  calendar, late marks, [Regularize]
  My Leave       balances, [Apply], history
  My Payslips    downloads, salary structure
  My Documents   what HR holds + [Upload]
  My Profile     editable personal details
  My Performance goals, KPIs, reviews
```

**Rule:** an employee should never see an empty admin screen or a 403. Their sidebar is a different sidebar.

---

# 22. Manager Experience

**Class B — currently the thinnest role.**

```
My Team
  Team Attendance    who's in, late, absent — drill-through
  My Approvals       leave · regularization · WFH · expenses  ← one queue
  Team Leave         calendar
  Team Performance   goals, KPIs, reviews
```

**The single highest-value manager feature is a unified approvals inbox.** Today approvals are scattered across leave, corrections, WFH and expense pages. One queue, grouped by type, with bulk approve where safe.

---

# 23. Target User Journeys

For each: what exists, what breaks, what is needed.

### J1 — HR starts the day
`Dashboard → exceptions → drill-down → resolve → return`
**Breaks at:** drill-down (all metrics terminal). **Needs:** Section 8.3. **Backend:** none.

### J2 — Understand one employee
`Search → profile → attendance/leave/payroll/documents → act`
**Breaks at:** search returns `[]`; profile has no operational tabs. **Needs:** search + workspace tabs. **Backend:** `/v1/search` only.

### J3 — Hire someone
`Requisition → approve → candidate → interview → feedback → offer → accept → convert → onboard`
**Breaks at:** approval, interview, feedback, offer, **convert**. **Needs:** 3 entities + conversion. **Backend:** substantial.

### J4 — Attendance exception
`Shift → punch → late flagged → regularize → approve → payroll`
**Breaks at:** finding who is late. **Rest works.** **Backend:** none.

### J5 — Leave
`Balance → apply → approve → attendance → LOP → payroll`
**Works end to end. Do not touch.**

### J6 — Payroll run
`Attendance → LOP → structure → process → exceptions → lock → payslip → bank`
**Breaks at:** exceptions not surfaced. **Needs:** exceptions panel. **Backend:** none (`/skipped` exists).

### J7 — Expense
`Claim → approve → batch → pay`
**Breaks at:** batching (no UI). **Backend:** none (7 eps exist).

### J8 — Performance
`KPI → goals → review → appraisal → feedback`
**Breaks at:** KPI (no UI), appraisal admin (partial). **Backend:** none (13 eps exist).

### J9 — Exit
`Resign → approve → notice → clearance → F&F → letters`
**Breaks at:** route collision; clearance missing. **Backend:** minor.

> **Six of nine journeys break only in the UI.** Only J3 needs significant backend work.

---

# 24. UI/UX Design System

## 24.1 Principles

Premium **+ clear + dense enough for enterprise work**. Explicitly avoid: heavy gradients, decorative animation, oversized cards, glassmorphism as a default, icon-only actions, nested tabs, "impressive but unusable".

**Keep** the existing token layer (`tokens.css`, `.ut-card`, `.ut-input`, `.hr-table`). It is sound. This is a *composition and density* problem, not a colour problem.

> ⚠️ **Inherited constraint:** `.ut-card` must never get `backdrop-filter`. An element with it becomes the containing block for `position: fixed` descendants, which clipped drawers on 14 screens in August. The `.ut-card.fixed/.absolute/.sticky` overrides exist for the same reason.

## 24.2 Page grammar — every page, no exceptions

```
Breadcrumb
Page Title                                    [Primary Action] [⋯]
One-line description
─────────────────────────────────────────────────────────────────
KPI · KPI · KPI · KPI                          (drill-through)
─────────────────────────────────────────────────────────────────
Tabs (same entity only)
Search    Filter ▾   Filter ▾   Date ▾        [Export] [Columns]
─────────────────────────────────────────────────────────────────
Table / chart / form
─────────────────────────────────────────────────────────────────
Row click → detail drawer (not a page navigation)
```

## 24.3 Tables — the enterprise standard

Required on every major list: search · filters · sort · pagination · **rows-per-page** · **export** · **column visibility** · **bulk selection** · **bulk actions** · visible row actions · status badges · empty/loading/error states · **detail drawer** · deep links · permission-gated actions.

Current gaps: no bulk anywhere, no export outside reports, page size hardcoded to 25, no column visibility.

## 24.4 Forms

Sections with clear grouping · inline validation (not toasts) · explicit required marks · sensible defaults · sticky footer actions · multi-step for long flows with visible progress · draft state where the form is long · confirmation on destructive actions · after-save navigation that returns the user where they were.

## 24.5 States — mandatory on every screen

| State | Standard |
|---|---|
| Loading | Skeleton matching final layout. Never a full-screen spinner |
| Empty | Explains what belongs here + primary action. Never "No data" |
| Error | Distinguishes 403 / 500 / offline, offers retry. Never "Something went wrong" |
| Success | Inline confirmation + list reflects change without reload |
| No permission | Explains and offers a route the user *can* take |

## 24.6 Density

Table rows ~40px (not 56). Body 13–14px. Page padding 20–24px (not 32+). Cards earn their border — not every block is a card.

---

# 25. API / Backend Reuse Strategy

## 25.1 Preserve — do not touch

Payroll engine (`PayrollEngine`, `LopCalculator` — golden-master tested) · leave service · RBAC + RLS · notification pipeline (12 events) · letters · onboarding · organization CRUD · audit log · reports + CSV exports.

## 25.2 Expose — UI only, no backend work

| Area | Endpoints |
|---|---|
| Reimbursement batches | 7 |
| Advance recovery | 6 |
| KPI tracking | 7 |
| Appraisal cycle admin | 4 |
| WFH approvals | 5 |
| Shift operations | 3 |
| Contractors + classifications | 6 |
| Weekly offs, punch zone, access | 3 |
| Face logs | 8 (web view) |

**~49 endpoints of finished business logic, reachable through UI work alone.**

## 25.3 Build — genuine backend gaps

P0: document upload (multipart → existing `R2Storage`) · employee directory CSV export · `GET /v1/search`
P1: TDS engine · interview + feedback + offer entities · **candidate→employee conversion** · bulk employee mutations · payroll/expense notification events
P2: asset allocation · ESI/PT/24Q files · arrears/gratuity/encashment

## 25.4 Canonical API direction

Three employee API generations exist. **Declare `/v1/hrms/*` canonical**, with `/v1/employees/{id}/profile/*` retained as the profile sub-resource family.

```
/v1/hrms/employees/{id}
   ├── /profile/*     ← keep
   ├── /job           ← port weekly-offs, punch-zone, access here
   ├── /attendance    ← new façade
   ├── /leave
   ├── /payroll
   ├── /documents
   └── /exit          ← canonical (retire /terminate)
```

**Do not port during the UX rebuild.** New UI calls canonical paths; the orphan surface is retired in a separate PR.

---

# 26. Architecture Cleanup Recommendations

**Separate from UX work. Do not block on these.**

| Issue | Evidence | Action | When |
|---|---|---|---|
| 38 dead Spring beans, 20 packages | Not scanned under `canonical` profile | Delete in one PR; provably unreferenced | After P0 |
| Two `/v1/notifications` controllers | Only the profile prevents collision | Delete the dead `com.hrms.api.notification` | With above |
| Three employee APIs | `/v1/hrms/*`, `/profile/*`, `/v1/employees/*` | Declare canonical; retire orphans later | P3 |
| Duplicate exit paths | `/exit` vs `/terminate` | Retire `/terminate` | P3 |
| Dead frontend shell | `DashboardLayout`/`Header`/`Sidebar` imported by 0 | **Stop editing; delete** | **Immediately** |
| 1 frontend unit test / 96 screens | — | Add tests to new components as built | Ongoing |

---

# 27. P0 / P1 / P2 / P3 Roadmap

## P0 — required for client acceptance
*These are the client's stated complaints, literally.*

| # | Item | Problem | Target | BE | FE | Complexity |
|---|---|---|---|---|---|---|
| 1 | **Dashboard drill-down** | Every metric terminal | 20 destinations (8.3) | None | High | **M** |
| 2 | **Attendance `?status=`** | Cannot answer "who is late" | Status filter + late-duration columns | None | Med | **S** |
| 3 | **Global search** | Returns `[]` | Actions + pages now, employees next | `/v1/search` | High | **M** |
| 4 | **Document upload** | URL paste box | Multipart → `R2Storage` | Small | Med | **S** |
| 5 | **Directory export** | No export | CSV, reuse report pattern | Small | Small | **S** |
| 6 | **Navigation rebuild** | Truncated labels, poor grouping | Target IA (§7) | None | High | **M** |
| 7 | **Page grammar** | Inconsistent | One layout (§24.2) | None | High | **M** |
| 8 | **Payroll exceptions** | Hidden | Surface `/skipped` | None | Small | **S** |
| 9 | **Exit route collision** | Two leaves → one route | Split | None | Small | **S** |
| 10 | **Stop editing dead shell** | Wasted effort | Delete | None | — | **XS** |

## P1 — required for a mature HRMS
Employee workspace tabs · bulk operations · reimbursement batch UI · advance recovery UI · KPI UI · appraisal admin UI · WFH approvals · manager approvals inbox · interviews + offers + **candidate→employee** · TDS · payroll/expense notifications · rows-per-page + column visibility.

## P2 — important improvements
Compliance calendar · POSH own leaf · face logs web view · asset allocation · experience letters · skills/training promotion · ESI/PT/24Q · attendance raw export · detail drawers everywhere.

## P3 — cleanup
Delete 38 dead beans · consolidate employee APIs · retire `/terminate` · Inspector View (with security review) · frontend unit tests.

---

# 28. Client Acceptance Checklist

Rehearse before any demo. Each must be answerable in **≤3 obvious interactions**.

### HR
- [ ] Show all employees in a department
- [ ] Export them
- [ ] Who joined this month
- [ ] Who is on probation
- [ ] Who is late today — **and how late**
- [ ] Who has not punched
- [ ] Who is working from home
- [ ] Whose documents are missing
- [ ] Upload someone's contract
- [ ] Show pending approvals
- [ ] Change 5 employees' shift *(P1)*

### Recruitment
- [ ] Where is this candidate
- [ ] When is the interview *(P1)*
- [ ] What was the feedback *(P1)*
- [ ] Did they accept the offer *(P1)*
- [ ] **Convert them to an employee** *(P1)*

### Payroll
- [ ] Who was skipped and why
- [ ] Who has LOP
- [ ] Show this employee's salary
- [ ] Generate a payslip
- [ ] Prepare bank disbursement
- [ ] Where is TDS *(P1 — currently "not computed")*

### Manager
- [ ] Who is absent today
- [ ] Approve this leave
- [ ] Approve this regularization
- [ ] My team's attendance
- [ ] My team's performance *(P1)*

### Employee
- [ ] Apply for leave
- [ ] Check balance
- [ ] See payslip
- [ ] **Upload a document** *(P0)*
- [ ] Regularize attendance
- [ ] See my profile

---

# 29. Risks / Unknowns

| Risk | Impact | Mitigation |
|---|---|---|
| **Unverified attendance edge cases** — cross-midnight shifts, duplicate punches, grace periods, timezones. Not verifiable by reading code | Payroll correctness | Runtime test suite before any payroll demo |
| **Redesign in flight** — 33 modified files, uncommitted, 3 in dead shell files | Rework | Reconcile with this blueprint before continuing |
| **TDS** is compliance-sensitive and multi-week | Cannot claim full Indian payroll | Scope explicitly; do not promise in demo |
| **Search scoping** — a manager must not find out-of-scope employees | Data leak | Server-side permission + RLS filtering, tested |
| **Bulk operations** need partial-failure semantics + audit | Silent data damage | Design transactionally; audit every row |
| **Demo tenant has 1 employee** | Empty dashboards | Seed a realistic demo tenant — never fake data in a real one |
| **43% unexposed is an estimate** (±5%, regex-derived) | Planning accuracy | Confirm per-endpoint before scheduling |
| Reference is a static mock — some flows may not be fully thought through | Over-fidelity | Treat as IA truth, not behavioural truth |

---

# 30. Recommended Implementation Sequence

Dependency-ordered. Each stage unblocks the next.

```
0. HYGIENE                    delete/park dead shell; confirm live files
        ↓
1. DESIGN SYSTEM              page grammar, table, form, states, density
        ↓                     (everything below inherits this)
2. NAVIGATION + SHELL         target IA, full labels, role scoping, breadcrumbs
        ↓
3. GLOBAL SEARCH (fe)         actions + pages — no backend, immediate relief
        ↓
4. DASHBOARD + DRILL-DOWN     20 destinations; needs 1,2 ─ THE headline fix
        ↓
5. ATTENDANCE                 ?status=, late duration, face logs, OT
        ↓                     (first consumer of the drill-down contract)
6. WORKFORCE DIRECTORY        export, bulk, rows-per-page, contractors
        ↓
7. EMPLOYEE WORKSPACE         operational tabs; needs 5,6
        ↓
8. DOCUMENTS                  upload endpoint + vault; needs 7
        ↓
9. LEAVE                      repackage only — no logic change
        ↓
10. PAYROLL                   exceptions, advances recovery
        ↓
11. EXPENSES                  reimbursement batches
        ↓
12. PERFORMANCE               KPI + appraisal admin
        ↓
13. SEARCH (entity)           /v1/search + employees
        ↓
14. HIRING                    interviews, offers, conversion ─ largest build
        ↓
15. EXIT                      split routes, clearance, letters
        ↓
16. COMPLIANCE / REPORTS      calendar, POSH, exports
        ↓
17. E2E + POLISH              58 specs × 4 roles; §28 checklist
```

**Why this order:**
- Design system first, or every later page needs reworking.
- Navigation before dashboard — the dashboard's drill-downs are navigation.
- **Search (actions/pages) at step 3** because it is frontend-only and directly answers the loudest complaint.
- Attendance right after the dashboard — it is the first consumer of the drill-down contract and proves the pattern.
- Employee workspace after attendance and directory, since it aggregates both.
- Hiring late — largest backend build, no dependents.

---

## Closing position

> The client is right that the product is hard to use. They are wrong that it is unbuilt.
>
> **166 endpoints of finished, tested business logic have no way in.** Six of nine core user journeys break only in the UI. The reference is this system's own information architecture, extended — a specification for the gaps, not a redesign to imitate.
>
> The work is to build a way in: one design system, one navigation model, one page grammar, and a hard rule that **every number leads somewhere**.

**END OF BLUEPRINT — ready for review before implementation.**
