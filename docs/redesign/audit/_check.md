# Check of AUDIT.md: completeness and accuracy

- **Checked:** 27 Sep 2026, read-only. Nothing was edited except this file.
- **Against:** `redesign/AUDIT.md` (1,812 lines, written 06:43), the handoff `README.md` and `CLAUDE_CODE_PROMPT.md`, `DECISIONS.md` 1–18, `REDESIGN_RULES.md`, `PACKAGE_BRIEF.md`, the 46 prototype `*.dc.html` files, `hrms-core.js` (the `M` model was dumped with node, see §2), `main` at `e32a4dc6`, the `ut-wt` worktrees, the recovery database (read-only SQL), and the stable backend on :8070 (read-only GETs signed in as the demo owner; :8080 was down).
- **Method:** every prototype file and every `M` page/tab was matched to a §1 row. All 122 `BW` items were parsed and cross-referenced by script against the §1 status column and the §2 gap tables. Ownership lists in §6.3 were compared file by file with the repo. Dependencies were checked against the `BW` items each screen needs. 17 claimed data sources marked "exists" were checked in the code (hook and endpoint and guard), 10 of them also live.

## Verdict

1. **Screen map: nearly complete.** All 46 prototype files are named in §1. Every page and tab of `M` that the prototype can reach has a row with a route and a status. What is missing: the legacy "My Workspace" module (`me`, 9 pages) is only partly accounted for. Four of its pages are never mentioned, and four are cited as design sources although they are unreachable superseded variants. Two design tabs are mapped only implicitly (§2).
2. **Backend list: complete in form, inconsistent in cross-references.** BW-01…BW-122 all exist with no gaps. Each one has a schema flag, a size and "Needed by" screens. Every schema and JPA claim checks out against the code (§4). But the §1 status column, the §2 gap tables and the §3 "Needed by" column disagree in **48 places** (§3). Five of those disagreements hide missing package dependencies.
3. **Ownership:** no two Phase 2 page packages own the same file. Phase 1 lists overlap with later owners, but these overlaps are sequenced and mostly acknowledged. Separately, six files or areas must be touched but have **no owner**, and one "new" file already exists (§5).
4. **Dependency order:** no cycles. There are **6 missing edges** and **2 contradictions** (§6).
5. **Spot-check:** all 17 "exists" claims are real. Three items marked missing already partly exist (§7, §8).
6. **Client decisions:** no conflicts found (§10).
7. **Stale facts:** §0 and the Phase 1 cards describe the worktrees before the 07:02 merges into `rd/int` (§6 item 8).

---

## 1. Prototype files: 46 `.dc.html`, all present in §1

| Prototype file | §1 row(s) | Status in AUDIT |
|---|---|---|
| HrmsPlatform | A1–A3, A6, A9 (and C13 dashboard pills) | W / B |
| UtMore | A4 | B (BW-01) |
| UtSearch | A5 | B (BW-02–04) |
| StyleGuide | B1 | N (reference) |
| UtStat, UtLive, UtAniIcon, UtQuick, UtEmpty, UtSection, UtSections | B2 | R (kit) |
| UtQIcon | B3 | N |
| UtArt | B4 | N |
| ReviewBoard, SavedHeaderTiles | B5 | N |
| PgDashboard | C1–C13 | W / B |
| PgDashboardV1 | C14 | N |
| PgOrg (overview, setup) | D1, D5, D7 | B / R |
| PgDirectory | D2 | B |
| PgEmpForm | D3 | B |
| PgEmpImport | D4 | B |
| PgSetup (m-rules, cp-stat, hs-config, hs-notif, hs-int, r-wfa) | D8, J1–J4, I8 | B |
| PgAttendance | E1 | B |
| PgTime (a-daily tabs 1–2, a-analytics, a-shifts, cp-muster, l-ops tabs 1–7, me-wfh, me-shift) | E4, E7–E15, F2–F8 | B / R. **me-wfh and me-shift are not mentioned anywhere** |
| PgLeave | F1 | B |
| PgPay (py-dash, py-runs, py-struct, py-settings, py-pli, py-adv, py-bank, e-center, x-fnf, me-slips, me-salary) | G1, G2, G4–G12 | B / R. **me-salary is not mentioned** |
| PgPayroll | G3 | B |
| PgTalent (h-pipe, h-onb, h-letters, h-vault, h-docs, me-letters, me-assets) | H1–H6 | B. me-letters and me-assets appear only in P-DOCS's prototype list (§6.3) |
| PgGrow (p-center, p-learn, x-res, me-att, me-leave) | I1, I3, I5; E5 and F11 cite me-att and me-leave | B |
| PgReports | I6 | B |
| PgAdmin | J5–J8 | B |
| PgWorkspace | J9 | N |
| PgGeneric | J10 | R |
| PgCompanies | K1, K2 | W |
| PgProfile, PgProfileTabs | K3, K4 | B |
| EmpHome (employee, manager) | L1, L2 | B |
| EmpTime (e-att, e-wfh, e-shift) | E5, E6, L3, L4 | B |
| EmpLeave | F8–F11 | B |
| EmpPay (e-slips, e-salary; imports EmpClaims) | G13, G14 | B |
| EmpClaims (e-claims, e-adv) | G12, G10 | B |
| EmpDocs (e-letters, e-files, e-assets, e-pol) | H7–H10 | B |
| EmpGrowth (e-rev, e-learn) | I1, I3 | B |
| TeamToday, TeamSchedule, TeamApprovals | L5, L6, L7 | B |

Which file renders which page comes from `hrms-core.js` L119–128 (`TIME`, `SETUP`, `ADMIN`, `TALENT`, `GROW`, `PAY`, `VIEW`, `VTAB`) and `HrmsPlatform.dc.html` L44–71.

## 2. `hrms-core.js` `M`: 27 modules, 74 pages

Dump method: `global.window=global`, with `document`, `localStorage`, `matchMedia` and `navigator` stubbed, then `require('./ds-base.js')` and `require('./hrms-core.js')`. `UTCore` exposes `ROLES, RGROUPS, ACTS, JUMP, modsFor, I, M, GROUPS, LAND, FONTS, DARK, NOTIFS, …`. `RGROUPS` puts no role on the `me` module. The page options in `HrmsPlatform` (`data-props.page`) don't include "My Workspace". `ReviewBoard` builds its list from `RGROUPS`. The `ref/` captures (688 entries) contain no `me` page. So the `me` module is unreachable through the prototype's UI.

| Module · page (tabs) | Prototype | AUDIT row · route | Status | Finding |
|---|---|---|---|---|
| dashboard · dashboard | PgDashboard | C1–C13 · `/dashboard` | W/B | ok |
| **me · me** (Overview) | PgWorkspace | J9 · — | N | ok |
| **me · me-att** (Calendar, Time entries) | PgGrow | E5 "also PgGrow me-att" · `?tab=my` | B | Tab "Time entries" is not mapped (E6 maps EmpTime's Timesheet). This page is unreachable and should be N. |
| **me · me-leave** (Balances, Requests) | PgGrow | F11 "also PgGrow me-leave" | B | Tab "Balances" is not mapped. Unreachable; should be N. |
| **me · me-slips** | PgPay | G13 "superseded" | — | ok (only wording) |
| **me · me-salary** | PgPay | — | — | **Missing** |
| **me · me-wfh** | PgTime | — | — | **Missing.** The README's admin table lists "WFH" under PgTime, which is this page. The AUDIT should say EmpTime `e-wfh` wins. |
| **me · me-shift** | PgTime | — | — | **Missing** |
| **me · me-letters** | PgTalent | only in P-DOCS's prototype list | — | Not in §1 |
| **me · me-assets** | PgTalent | only in P-DOCS's prototype list | — | Not in §1 |
| workforce · m-over | PgOrg | D1 · `/hrms/master` | B | ok |
| workforce · m-dir (Active, Probation, On notice, Exited, Suspended) | PgDirectory | D2 · `/hrms/employees` | B | ok (status pills, plus "All") |
| workforce · m-org (Departments, Designations, Grades, Agencies) | PgOrg | D7 + D5 (Agencies = Contractor Master) | B/R | ok |
| workforce · m-rules (Policies, Shift rules, Leave rules, Manage policies) | PgSetup | D8 | B | ok |
| hiring · h-pipe (Pipeline, Requisitions, Interviews, Offers) | PgTalent | H1 | B | ok |
| hiring · h-onb (New hires, Checklist templates, Assets) | PgTalent | H2 | B | ok (today's order kept) |
| hiring · h-letters (Templates, Generated letters, Distributions, My letters) | PgTalent | H4 | B | ok |
| hiring · h-vault (Employee documents, My documents) | PgTalent | H5 | B | ok |
| hiring · h-docs | PgTalent | H6 | B | ok |
| performance · p-center (6 tabs) | PgGrow | I1 | B | ok |
| performance · p-learn (5 tabs) | PgGrow | I3 | B | ok |
| exit · x-res (On notice, Exited, Terminated) | PgGrow | I5 | B | ok |
| exit · x-fnf (Pending approval, Pending payment, Settled, All) | PgPay | G11 · `/hrms/fnf` | B | The §1 row doesn't name the prototype (§6.3 does). Today it sits under Employee Exit, as in the design. |
| attendance · a-daily (Today, Review, Manual entry) | PgAttendance / PgTime | E1, E4, E7 | B | ok |
| attendance · a-analytics (Overview, Punctuality, **Overtime**) | PgTime | E9, E11; Overtime → E14 only by implication | B | **E14 should say** that the design's "Attendance analytics · Overtime" tab (hours logged, approved, waiting, plus the requests table) lives in Shifts & Overtime › Overtime (§5.3). |
| attendance · a-shifts (Shifts, Rosters, Overtime rules, Change requests) | PgTime | E12–E15 | B | ok |
| leave · l-ops (8 tabs) | PgLeave / PgTime | F1–F8 | B/R | ok. The design's "Balances" tab becomes the new `all-balances` tab. |
| payroll · py-dash, py-runs (4 tabs), py-struct, py-settings, py-pli (3), py-adv (3), py-bank (3) | PgPay / PgPayroll | G1–G10 | B/R | ok |
| expenses · e-center (5 tabs) | PgPay | G12 | B | ok |
| company · c-cb | PgCompanies | K1–K2 | W | ok |
| compliance · cp-stat (4 tabs), cp-muster | PgSetup / PgTime | J1, E8 | B | ok |
| hrsetup · hs-config, hs-notif, hs-int | PgSetup | J2–J4 | B | ok |
| reports · r-center, r-wfa (3 tabs) | PgReports / PgSetup | I6, I8 | B | ok |
| crm (leads, customers, deals), accounts (invoices, payments), projects (all, task board), inventory, purchase | PgGeneric (`soon: true`) | J10 + §5.1 "Business apps" | R | Module level only. The design's sub-pages have no product equivalent: each app is one `ComingSoonRoute` (App.tsx L876–885). Say so in one line. |
| ehome · e-home | EmpHome | L1, L2 · `/me` | B | ok |
| team · t-today, t-sched, t-appr (All, Leave, Attendance, Requests, Expenses) | Team* | L5–L7 · `/team?view=` | B | ok |
| etime · e-att (This month, Timesheet), e-wfh, e-shift | EmpTime | E5, E6, L3, L4 | B | ok |
| eleave · e-leave (Overview, Apply, Requests, Holidays) | EmpLeave | F9, F10, F11, F8 | B | ok |
| epay · e-slips, e-salary, e-claims (My claims, New claim), e-adv | EmpPay / EmpClaims | G13, G14, G12, G10 | B | ok |
| edocs · e-letters, e-files, e-assets, e-pol | EmpDocs | H7–H10 | B | ok |
| egrow · e-rev, e-learn | EmpGrowth | I1, I3 | B | ok |
| settings · s-config (8 tabs), s-users, s-roles (3 tabs), s-audit | PgAdmin | J5–J8 | B | ok |

**Fix:** add one §1 row: "Legacy My Workspace module (`me`, 9 pages: PgWorkspace; PgGrow me-att/me-leave; PgPay me-slips/me-salary; PgTime me-wfh/me-shift; PgTalent me-letters/me-assets). Unreachable in the prototype (not in `RGROUPS`, `ReviewBoard` or `ref/`). Superseded by EmpTime/EmpLeave/EmpPay/EmpDocs. Status N." Then remove `me-att` (P-ATT-DAY), `me-leave` (P-LEAVE), and `me-letters`/`me-assets` (P-DOCS) from the package prototype lists, or mark them "reference only". Otherwise builders face two designs for one page.

## 3. Backend items: numbering and flags are fine; the three cross-references disagree

- BW-01…BW-122: 122 items, no gaps or duplicates. Every row has Schema, Size and Needed-by. Items are numbered by package block, so they are out of numeric order in three places (BW-20 after BW-36, BW-37 after BW-122, BW-104 after BW-108). This is harmless.
- 25 items are flagged "yes" for a schema change, and they match the 16 migrations in §3.2 one for one. The permission-only migrations V143_56 and V143_57 are flagged "no (permission in …)", which is correct.

The 48 disagreements between §1 (status column), §2 (gap tables) and §3 ("Needed by"):

| Screen | Problem | Fix |
|---|---|---|
| E16 My Shift | §1 says **R**, but §2 and BW-34 need Withdraw | Status B (BW-34) |
| G7 Payroll settings | §1 says R, but §2 lists FE work | W |
| E1 | §1 lacks BW-43 (§2 has it). §1 lists BW-14, whose Needed-by is E4 and C5 | Add BW-43; move BW-14 or add E1 to its Needed-by |
| E3 | §1 lacks BW-30 (the E28 bug fix) | Add |
| E5 | §1 and §2 lack BW-23 (approver on fixes) | Add |
| E15 | §1 lacks BW-31 | Add |
| F1 | §1 and §2 lack BW-35 (WFH approver name on the WFH rows of Approvals) | Add, plus a dependency edge (§6) |
| F2, F9 | §2 lacks BW-38 (§1 has it) | Add |
| F10 | §1 lists BW-122; BW-122 doesn't list F10; §2 F10 takes the approver from BW-48 | Pick one |
| G1 | §1 lacks BW-59 (§2 has it) | Add |
| G5 | §2 row "G4, G5" lists BW-51; BW-51 lists G3 and G4 only; §1 G5 lists BW-50 only | Align |
| G12 | §2 lists BW-61; BW-61 lists K3 only; §1 lacks it | Align |
| H7 | §2 lacks BW-71 | Add |
| K3 / K4 | BW-100 (last sign-in device) sits under K4 in §1; BW-100 and §2 say K3 | Move to K3 |
| K4 | §1 and §2 lack BW-15 (day details on My profile's Attendance tab) | Add |
| L1 | §1 lacks BW-12, BW-15, BW-23, BW-78, BW-105 and BW-118 (all list L1). §2 lacks BW-15, BW-23, BW-78 and BW-105. §1 lists BW-122, which doesn't list L1 | Add or align |
| L2 | §1 and §2 lack BW-08 | Add |
| L4 | §1 and §2 lack BW-122 | Add |
| L7 | §1 lacks BW-36, BW-42 and BW-60. §2 lacks BW-60 | Add, plus dependency edges (§6) |
| A4 | §1 and §2 lack BW-98 (BW-98 lists A4) | Add, or drop A4 from BW-98 (see §6 item 5) |
| C5 | §1 and §2 lack BW-14 (BW-14 lists C5) | Add, or drop C5 from BW-14 |
| C6 | §1 says W, but BW-13 lists C6 | Make it B plus a dependency, or drop C6 from BW-13 |
| C10 | §1 and §2 lack BW-69 (BW-69 lists C10; BW-115 may make it unnecessary) | Align |

## 4. Schema changes and JPA mapping: every claim verified

| Item | Table | JPA entity? | Verdict |
|---|---|---|---|
| BW-24 | `settings.hr_configuration.allow_web_punch` | **Yes** (`platform-settings/…/HrConfiguration.java`) | OK as an unmapped, defaulted column (DECISIONS 16 chose a column over a side table). |
| BW-24 | `ck_attendance_records_check_in_method` / `_check_out_method` | `AttendanceRecord` maps the method as `@Enumerated(STRING)` `CheckInMethod`; adding `WEB` to the enum is not a mapping change | OK. **Note:** `attendance.records` is partitioned (`relkind p`); 9 partitions inherit the constraints (`coninhcount 1`). V143_53 must drop and re-add them on the parent, which scans every partition under a lock. Plan a quiet window in production. |
| BW-26 | `attendance.event_logs` `BREAK_START`/`BREAK_END` | `AttendanceEventType` already has both; the DB check allows both (V014, V080) | OK |
| BW-31 | `attendance.shift_change_requests.requested_end_date` | No entity. JDBC in `ShiftChangeRequestService`; table created by V142 and the bootstrap | OK |
| BW-36 | `hrms.time_entries.project_id`, `hrms.projects.code` | No entities (JDBC only in `TimeEntryController` and `ProjectController`) | OK |
| BW-39 | index on `leave_mgmt.leave_requests` | `LeaveRequest` is JPA; the change is an index only | OK |
| BW-67 | `offer_candidate_emails` (side table) | `hiring_mgmt.offers` → `HiringOffer` | Side table is correct |
| BW-70 | `asset_confirmations`, `asset_issue_reports` | `hrms.onboarding_assets` → `OnboardingAsset` | Side tables are correct |
| BW-76 | `letter_signatures`; sets `status` and `signed_at` | `letters.generated` → `GeneratedLetter` maps **both** `status` and `signed_at` | OK. BW-71's "signedAt (existing column, read with JDBC)" is inaccurate: it is mapped, so no JDBC is needed. `GeneratedLetterDto` does lack it, as claimed. |
| BW-78, BW-83 | milestones, company KPIs, goal–KPI links | `ReviewCycle`, `Goal` are JPA | Side tables are correct |
| BW-85 | `program_locations`; `skill_assessments.certification_name` | `TrainingProgram` is JPA; `skill_assessments` is JDBC (`SkillAssessmentService`, V143_21) | OK |
| BW-89 | `hrms.report_schedules` constraints and `send_hour` | No entity (`ReportScheduleService`) | OK |
| BW-95 | `department_cost_centres` | `Department` is JPA | Side table is correct |
| BW-103 | `posh_complaint_departments` | `PoshComplaint` is JPA | Side table is correct |
| BW-105 | `policy_ack_deadlines` | `HrPolicy`, `PolicyAcknowledgement` are JPA | Side table is correct |
| BW-117 | `hrms.projects.owner_employee_id`, `due_date` | No entity | OK |
| BW-118 | `hrms.company_notices.event_date` | No entity (JDBC in `CompanyNoticeController`) | OK |
| BW-06, 12, 28, 29, 59, 66, 73, 92, 112 | new tables | — | OK |

Also verified:
- None of the five new permission codes exists yet in `rbac.permissions`.
- `hrms.advance.request.others` is granted to ADMIN, FINANCE_LEAD, HR_MANAGER, OWNER and SUPER_ADMIN, so the on-behalf mirror is correct.
- The existing codes the plan uses all exist: `hrms.employee.team.manage`, `hrms.leave.employee.read`, `workspace.billing.manage`, `hrms.kpi.manage`, `attendance.policy.manage`, `hrms.report.schedule.manage`.
- The latest applied migration is 143.40.
- The canonical Flyway profile has `out-of-order: true` and `validate-on-migrate: false`, so merging V143_5x files out of numeric order is safe on dev databases.

## 5. File ownership

**A. Files listed by two packages.** None of these are between two Phase 2 page packages; all are sequenced.
1. **F1's already-committed edits vs later owners.** F1 edited all generated `design/dc/*.view.tsx`, `DesignFrame`, `ModuleKit`, `SettingsKit`, `ShellChrome`, `TopBarSearch`, `GlobalSearch`, `BrandingTab`, `StatusChangeDrawer`, `attendance/face/FaceEnrollDrawer.tsx`, `employees/workspace/shared.tsx`, `EssDashboard` and `shared/export/charts.ts`. Later owners of those files: P-DASH, P-COMP, P-ATT-DAY, P-ATT-PLAN, P-PAY-CORE, P-PAY-EXTRA, P-REPORTS, P-PROFILE, F2d, F3a, F3b, P-ADMIN and P-HOME. This is harmless, because F1 is already merged into `rd/int`. Reword the card as "merged; later owners take over".
2. `shared/components/hr.tsx`: F2b (overlay parts) and F2d (the rest). `ModuleKit.tsx` and `SettingsKit.tsx`: F2b (toast lines), F2d (whole file) and F3a (`placement`). §6.1 acknowledges these.
3. `modules/hrms/reports/ReportKit.tsx`: F2b (toast delegation) and P-REPORTS (`reports/**`). Not acknowledged; harmless because F2b has merged.
4. `design/dc/SubTabs.*`: F2d and F3a. Acknowledged.
5. `layouts/PlatformShell.tsx`: F3a, then F3b ("the two mount points"). This is sequenced, but it contradicts §5.16's "no page package edits … PlatformShell.tsx", since F3b is listed under Phase 2.
6. `scripts/master-build.mjs`: F4 (guard), then P-WF-SETUP. Acknowledged. The five seams: F3a creates them, then hands them over. Acknowledged.
7. **Kit harness.** F2a claims `apps/platform/kit-harness.*`, which exists nowhere (not in `rd/int`, not in the F2a worktree). The real harness is `src/design/kit/__tests__/harness.{html,tsx}`, inside F2b's `__tests__/**`. F2c's live test needs "the harness page", so F2c would have to edit an F2b file.

**B. Needed, but no package owns it**
1. `be/probation/ProbationService.java`. BW-106 (P-SETUP) changes the reminder-log response, which is built in `listReminders` and `ReminderDto` in this service, not in `ProbationController`, the only file P-SETUP owns. BW-11 (P-TEAM) reuses its `extendProbation`.
2. **The BW-36 approval endpoints** (`GET /v1/timesheets/approvals`, `POST /v1/timesheets/weeks/{id}/decision`) need a new controller. `TimeEntryController` is class-mapped to `/v1/ess/timesheets` with a class-level `hasAuthority('attendance.checkin.self')`. The new-controller list in P-ATT-DAY's card has no timesheet approval controller.
3. **`hrms.projects.code`** (BW-36, V143_65, P-ATT-DAY). The only code that writes `hrms.projects` is `ProjectController` (P-DASH), and no item adds a way to set a project's code, so it would always be null. Either P-DASH adds it to the project form, or the column is dropped.
4. `backend/app/hrms-app/.../reports/AuditExportController.java` (`/v1/audit/events/export.csv`) belongs to P-REPORTS. If BW-111's category filter (P-ADMIN) should also apply to the audit export, P-ADMIN needs a P-REPORTS file.
5. **`e2e/recovery/capture-prototype.mjs` already exists.** It is the old bundle capture tool (commits `65521466`, `5eab3456`) and differs from `redesign/proto-capture.mjs`. F4 lists it as "new" and would overwrite it. Pick a new name or state that it replaces the old tool.
6. Pages inside the shell that no package restyles: `/plan` (`Plan.tsx`, linked from Settings › Billing, the launcher, the seat-full notice in `EmployeeForm`, and notifications), `/modules` (`Modules.tsx`; its greeting is asserted by `live-w3-greeting-myatt`), `/no-access` and `ModuleNotActivated`. They only get F1's dark bridge. Add one line saying so, or give them to F3a or P-ADMIN.

**C. Shared hooks missing from C0.** §5.16 says C0 creates a hook when two or more packages need it. These endpoints have two or more consumers besides their owner:
- BW-43 apply-on-behalf: P-ATT-DAY (E1 "Mark leave") and P-PROFILE (K3).
- BW-64 F&F status: P-GROW (I5) and P-PROFILE (K3).
- BW-90 employee stats: P-WF-SETUP (D1) and P-GROW (I5).
- BW-98 my own record: F3a (A4) and P-PROFILE (K4).
- BW-24 web-punch setting: P-SETUP (J2 toggle) and P-HOME (L1).

## 6. Dependency order: no cycles; 6 missing edges and 2 contradictions

1. **P-TEAM (UI)** lacks two dependencies: **P-LEAVE.be** (BW-42 bulk decision, §2 L7) and **P-EXP.be** (BW-60).
2. **P-TEAM.be is marked "C0 only", but BW-09 needs more:**
   - The expense approvals list returns **SUBMITTED and APPROVED** claims (`ExpenseController` L227–241). BW-09's "reuse the list services unchanged" rule, and its test that the inbox returns the same ids as each list, would therefore put approved claims (waiting only for reimbursement) into the inbox. It needs BW-60's `status` filter (P-EXP.be), or its own SUBMITTED filter with the parity test adjusted.
   - The timesheet kind needs P-ATT-DAY.be (BW-36).
   - Undo of a shift change must handle BW-31's end dates (P-ATT-PLAN.be).
3. **P-LEAVE** lacks **P-HOME.be**: BW-35 gives the approver name on the WFH rows of F1, and BW-122 is needed if F10 keeps it.
4. **P-DASH** lacks **P-ATT-DAY.be**, if C5 and C6 are to show BW-14 and BW-13 fields. Otherwise drop C5 and C6 from those items.
5. **F3a (Phase 1) cannot depend on BW-98** (P-WF-PEOPLE.be, Phase 2), yet BW-98 lists A4. The More panel's profile card needs a fallback (name and role from the token), and the later BW-98 wiring needs an owner.
6. **P-WF-PEOPLE's card** lists "P-ATT-DAY.be (BW-28)" without saying that only the UI half needs it. Its `.be` half, which P-WF-SETUP, P-GROW and P-PROFILE wait on, needs only C0. Say so, or the chain is longer than it needs to be.
7. **Contradiction: when BW-120 is built.** §7 risk 23 says P-HOME runs last, "after those .be merges", but §6.1 puts **P-HOME.be, including BW-120, in Wave A**. BW-120's SQL would then be written against `letter_signatures`, `review_cycle_milestones`, `policy_ack_deadlines` and `asset_confirmations` before their owners (P-DOCS, P-GROW, P-WF-SETUP, P-HIRE) have defined the columns. Any mismatch is a 42703 error, which the FEATURE_NOT_READY rule swallows as "not ready", so the failure would be silent. Suggest shipping BW-122, BW-35, BW-119 and BW-121 in Wave A, and adding BW-120's cross-package sources after those four `.be` merges.
8. **Contradiction: stale Phase 1 state.** §0 says "rd-int at e32a4dc6, nothing merged", and §6.1 gives the merge order F1 → F2a → F2b. `rd/int` now holds: `0cbec66f` F2a, `3766a3fb` F1, `c396eace` F2b, `2e3198f4` a theme fix, and `25fa790b` the F2a additions, with F2a merged first. F2a also has a 4th commit (`9e4834cf`) and F2b a 3rd (`386f2081`). G0's baseline run started at 07:10 (`_results/baseline-e32a4dc6/`). Refresh §0 and the Phase 1 cards.

## 7. Spot-check: 17 claimed "exists" sources

Live checks were GETs as owner on the stable backend (:8070).

| AUDIT row | Hook | Endpoint and guard | Live | Result |
|---|---|---|---|---|
| G2 runs / New run | `usePayrollRuns.ts` L153, L222 | `GET`/`POST /v1/payroll/runs`: `payroll.runs.read` / `.manage` (`PayrollRunController` L38–58) | 200 | exists |
| F6 Year end | `useLeaveYearEnd.ts` L118–131 | `/accrual/run`, `/year-end/preview`, `/year-end/carry-forward`: `hrms.leave.yearend.run` (`LeaveYearEndController` L42–59) | 200 | exists |
| F7 Leave types | `useLeave.ts` L135–270 | `GET /v1/leave/types` isAuthenticated; POST and PUT `leave.type.write` (`LeaveController` L306–324) | — | exists |
| G7 Payroll settings | `usePayroll.ts` L116–125 | `/v1/payroll/settings`: `payroll.settings.read` / `.update` | — | exists |
| D5 Contractor master | master data | `MasterDataController` L79–131: `hrms.contractor.read` / `.write` | — | exists |
| H3 My interviews | `hiring/Interviews.tsx` | `InterviewController` L80–109: anyOf `hrms.hiring.interview.self`, `hrms.hiring.read`; the route guard is the same | — | exists |
| E2 Face punch | `useAttendanceReview.ts` L142, L175 | `GET /v1/attendance/review/face-events`: anyOf `attendance.face.admin.read`, **`attendance.status.review`**; decision `attendance.status.override` | 200 | exists. The AUDIT quotes the registry tab rule, not the API rule. |
| E16 / L4 My shift, Shift change | `AttendanceContainer.tsx` L168; `ShiftChangeRequest.tsx` L126, L153 | `GET /change-requests/my`, `POST /change-requests`: `attendance.checkin.self` (`ShiftController` L168–177) | 200 | exists |
| L6 Team schedule | `team/TeamSchedule.tsx` L22 (inline query) | `GET /v1/team/schedule`: `attendance.team.read` | 200 | exists. The row fields confirm BW-22 is missing. |
| C4 Seats | `useSeats.ts` L42 | `GET /v1/workspace/seats/usage` (`quota/SeatQuotaController`) | 200 | exists |
| K1 Next employee ID | `useSettings.ts` L141 `useNextEmployeeCode` | `GET /v1/settings/employee-code/preview`: anyOf `settings.read`, `hrms.employee.write` | — | exists |
| C9 Probation | `useProbation.ts` L56–86; confirm `useWorkforce.ts` L300 | `/v1/probation/upcoming` (`hrms.employee.read`), `/reminders` (`hrms.probation.reminders.read`), `/employees/{id}/extend` (`hrms.employee.write`); confirm `POST /v1/hrms/employees/{id}/confirm` | 200 | exists |
| A5 Search | `TopBarSearch`, `GlobalSearch` | `GET /v1/search` (`hrms.employee.read`); `GET /v1/search/global` (isAuthenticated) | 200 | exists. `SearchType` has no HOLIDAY, so BW-04 is correctly missing. |
| C8 Notices | dashboard container | `CompanyNoticeController`: GET isAuthenticated (a past date needs `org.company.read`); writes `org.company.write` | — | exists |
| I7 Six report pages | `reports/*Report.tsx` | `ReportController`: `@perm.check` per report code | — | exists |
| E7 Manual entry save | `ManualEntry.tsx` | `POST /v1/attendance/manual-entry`: `attendance.workforce.admin` (`AttendanceController` L839–840) | — | exists |
| BW-06 decide endpoints | — | All 8 exist and each calls a service method: `LeaveService.approveL1`/`approveL2`/`approveLeave`, `WfhService.decide`, `AttendanceService.decideCorrection`, `ShiftChangeRequestService.decide`, and the expense service. So the `@Around` recording design is feasible. | — | exists |

Items claimed missing that are confirmed missing:
- `/v1/attendance/web-punch-setting`, `/v1/ess/my-requests` and `/v1/leave/calendar` all return 404.
- `StaffStatusResponse` rows (18 rows on 25 Sep) have no branch, method, leave type or pending-leave fields.
- `/v1/shifts` returns `weeklyOffDays` but no `employeeCount`.
- There is no `PUT /v1/settings/holidays/{id}`, no shift-change cancel, and no `/v1/payroll/structures/me/history`.

## 8. Other accuracy points

- **BW-41 may be frontend-only.** `GET /v1/leave/approvals/pending-l2` and `POST /{id}/l2-decision` already exist (`@perm.check('hrms.leave.approve.l2')`; live 200). The web app never calls them (no `pending-l2` or `l2-decision` anywhere in `src/`).
- **BW-44 partly exists.** `GET /v1/reports/leave-balance?companyId&year` (`@perm.check('hrms.report.leave')`) already returns everyone's balances by type (entitlement, used, pending, carry-forward, available). It covers ACTIVE people only and has no paging, and it lives in P-REPORTS' files. BW-44 adds paging and search, probation and notice people, and `hrms.leave.employee.read`.
- **BW-16 partly exists.** `GET /v1/attendance/employee/{id}/records` (`attendance.team.read` plus `assertCanReadEmployeeAttendance`) returns raw records. What is missing is the effective month: weekly off, holiday and leave.
- **BW-11 has no notification type.** It says "notify HR and the employee", but no type is in C0's 12 (`AppNotificationType` has no `PROBATION_*` value), and §7 risk 21's list of person-triggered notifications omits it.
- **L3 guard quoted incompletely.** The `/me/wfh` route guard is anyOf `wfh.request.self`, `hrms.ess.read`, `attendance.checkin.self`. The AUDIT quotes only the submit API's `wfh.request.self`.
- **"The four approve codes" (L5, §5.16) are never named.** They are `hrms.leave.approve.l1`, `wfh.approve`, `attendance.regularization.approve` and `hrms.expense.claim.approve` (team.md §2). With BW-36, `hrms.timesheet.approve` becomes a fifth, for the Requests tab and the `/team` guard.
- **§3.1 "Every decision path calls ApproverScopeGuard" is not true today.** Shift-change decisions use `ShiftController`'s own `approverScope()`, and expense decisions use their own object check. Reword to "each keeps its existing scope check".
- **AOP caveat for BW-06 and BW-42.** Spring AOP does not intercept self-invocation. The bulk decision must call `LeaveService` through the proxy (from the controller). If a new `LeaveService` method calls `approveLeave` internally, that decision will not be journaled.
- **`TenantModuleGuard`.** Only `/v1/team` is added. The new top-level paths `/v1/ess/*` (BW-119–121), `/v1/approvals/*` (BW-06), `/v1/timesheets/*` (BW-36) and `/v1/workspace/admin-contacts` would pass the guard with no module check, because unlisted paths return true (L78). Decide whether to map them, and who edits the file: P-TEAM owns only the `/v1/team` entry.
- **The new `WEB` value appears in existing fields** (`AttendanceRecordResponse`, `AttendanceDto`, `AttendanceCheckinEvent`, `checkInMethod`), which the mobile app reads. §7 risk 6 covers only new fields. The risk is low, since `WEB` appears only after a company switches web check-in on, but the mobile app should be checked for strict enum decoding.
- **§4.6 contradicts itself.** It says "Left untouched … and the Tabler Icons `<link>`, which F1 removes". DECISIONS 14 removes the link, and it is unused (0 `ti ti-` classes). Move it out of the "left untouched" list.
- **The Workforce Directory header pills** (Employee Master · Contractor Master · Classification Rules) are rendered by two packages: P-WF-PEOPLE for `/hrms/employees`, P-WF-SETUP for the other two. One shared item list is needed so the bar is identical on all three pages.

## 9. Live tests

- **The gate** (`_tools/final-run.sh`, 55 scripts): every script has an owner in §6.4.
- **`live-w3-greeting-myatt` has two unlisted blocks.** It also asserts:
  - the owner's admin-dashboard greeting (an `h1` on `/dashboard`, lines 124 and 185), so **P-DASH** needs a block;
  - the reader's "staff dashboard" greeting on `/dashboard` (line 197), which will redirect to `/me`, so **F3a** (or P-HOME) needs a block.
- **Not in the gate and not named anywhere in AUDIT.md,** but they drive pages or endpoints that packages change:
  - Browser scripts, with the suggested owner:

    | Script | Pages it drives | Suggested owner |
    |---|---|---|
    | `letters-admin-live` | `/hrms/letters/generated` | P-DOCS |
    | `live-admin-actions`, `live-late-drilldown`, `live-notices-browser` | `/dashboard` | P-DASH |
    | `live-assets-browser` | onboarding, compliance | P-HIRE |
    | `live-att-analytics-calendar` | analytics, attendance | P-ATT-PLAN |
    | `live-browser` | dashboard, attendance, profile, roles, settings, users | multi-package |
    | `live-fnf-tabs` | `/hrms/exit`, `/hrms/fnf` | P-PAY-EXTRA (+ P-GROW) |
    | `live-money-modals` | advances, expenses | P-PAY-EXTRA (+ P-EXP) |
    | `live-offers-browser` | hiring | P-HIRE |
    | `live-overtime-browser`, `live-shift-requests` | shifts | P-ATT-PLAN |
    | `live-shift-request-dates` | shifts, `/me/shift-change` | P-ATT-PLAN (+ P-HOME) |
    | `live-payroll-access` | bank, runs, roles, users | P-PAY-CORE (+ P-ADMIN) |
    | `live-time-browser` | `/hrms/ess` | P-HOME |
    | `company-admin-preview` | capture helper | — |

  - API scripts that hit changed behaviour:

    | Script | Changed by | Owner |
    |---|---|---|
    | `live-employee-import` | BW-93 | P-WF-PEOPLE |
    | `live-offer-email`, `live-offer-documents`, `live-hiring-offers` | BW-67 | P-HIRE |
    | `live-projects` | BW-117 | P-DASH |
    | `performance-authorization-live`, `live-module-workflows` | BW-78, BW-81 | P-GROW |
    | `live-shift-effective`, `live-workflows`, `live-backend-fixes` | BW-31, BW-33, BW-34, BW-46 (`live-backend-fixes` calls `/v1/shifts` and `/v1/settings/holidays`) | P-ATT-PLAN + P-LEAVE |
    | `live-time-workflows` | BW-36, BW-29 | P-ATT-DAY + P-ATT-PLAN |
    | `live-compliance-reports`, `live-inspection-documents` | BW-102 | P-SETUP |
    | `live-w2h` | BW-89, BW-111 | P-REPORTS + P-ADMIN |
    | `live-hr-lifecycle` | BW-104/105 among others | P-WF-SETUP |

  - The remaining `live-w1*`/`live-w2*`, `live-api`, `live-night-integration`, `live-concurrent-login` and `live-assets-calendar` should go into Q1's regression sweep.
- **Every script named in AUDIT.md exists** (checked by name).

## 10. Earlier client decisions: no conflicts

- **Settings stay in their own sections:** §5.1 and §5.12 keep every URL and section.
- **My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN (and COMPANY_ADMIN):** kept. Today's shell already hides the whole ESS group for `ADMIN_ROLES` (`PlatformShell` L455–457), so "My work: never for OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN" matches today.
- **Greeting:** `greetingName()`, as already used by `AdminDashboardContainer`, `HrmsDashboard` and `EssDashboard`.
- **Calendar:** stays `src/shared/components/calendar` (F2d re-tokens it; MonthCalendar, DateChip and FilingCalendar use it).
- **Companies:** the Inactive view, Restore and the archive guards are kept (§5.13, P-COMP owns `live-company-restore`).
- **Rail highlight:** only from `railLit.ts`; `SELF_SERVICE_RAIL` exists and the My work keys join it.
- **DECISIONS 16 E-items:** every item maps to a BW item or a stated N/FE decision. The read APIs E4, E5, E8–E13, E15, E16, E21, E23 and E24 are BW-27, BW-15, BW-122, BW-38/35/23/60/62, BW-119, BW-120, BW-121/118, BW-55, BW-48, BW-49, BW-32, BW-11 and BW-13.

## 11. Open questions for the lead

1. Should the whole legacy `me` module be marked N, and removed from the P-ATT-DAY, P-LEAVE and P-DOCS prototype lists? This check recommends yes.
2. BW-41: wire the existing `pending-l2` endpoint on the frontend, or change `/approvals/pending` on the backend?
3. Should `/v1/ess`, `/v1/approvals` and `/v1/timesheets` be module-gated in `TenantModuleGuard`? If so, who owns those entries?
4. BW-11: add `PROBATION_CONFIRMED` and `PROBATION_EXTENDED` types to C0, or drop the notification?
5. `hrms.projects.code`: does P-DASH add it to the project form, or is the column dropped?
6. `capture-prototype.mjs`: rename the new tool, or replace the old one?

## 12. Changes to make in AUDIT.md, most important first

1. Add the missing dependency edges and split P-HOME.be (§6 items 1–7).
2. Fix the 48 cross-reference disagreements, especially E16 R→B, K3/K4 BW-100, L1, L7 and C5/C6 (§3).
3. Give the unowned files an owner: `ProbationService`, the timesheet approval controller, `projects.code`, the audit export, the harness, and the `capture-prototype` name clash (§5.B). Add the 5 missing C0 shared hooks (§5.C).
4. Add the legacy `me` row, and the analytics-Overtime and business-app sub-page notes (§2).
5. Name the four approve codes. Decide the `TenantModuleGuard` paths and BW-11's notification type. Fix the ApproverScopeGuard wording and the §4.6 Tabler line (§8).
6. Assign the unassigned live scripts, and the P-DASH and F3a blocks of `live-w3-greeting-myatt` (§9).
7. Mark BW-41, BW-44 and BW-16 as partial, and fix BW-71's JDBC note (§4, §8).
8. Refresh §0 and the Phase 1 states to match the `rd/int` merges (§6 item 8).
