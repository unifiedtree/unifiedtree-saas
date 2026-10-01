# AUDIT.md addendum: lead's corrections (27 Sep, after the completeness check). BINDING; overrides AUDIT.md where they differ.

The completeness check's full notes are in `/c/REACT/ut-wt/redesign/audit/_check.md`. Its §3 lists 48 places where AUDIT.md §1, §2 and §3 disagree.
**Rule:** for each BW item, §3 (its description and "Needed by") plus the area audit are the source. Always verify against today's code before building.

## A. Verify before you build
The audit was partly read from code, not run. Before building a BW item, check whether it already exists; reuse what exists and report what you found. Known cases:
- **BW-41 is not a gap.** `GET /v1/leave/approvals/pending-l2` and `POST /v1/leave/approvals/{id}/l2-decision` exist and return 200 live. Only the web never calls them, so P-LEAVE wires them up.
- **BW-44 partly exists.** `GET /v1/reports/leave-balance` (`hrms.report.leave`) returns everyone's balances by type (ACTIVE people only, unpaged).
- **BW-16 partly exists.** `GET /v1/attendance/employee/{id}/records` returns raw records. Only the effective month view is missing.
- **BW-71:** `letters.generated.signed_at` is ALREADY mapped in the `GeneratedLetter` entity. Add the field to `GeneratedLetterDto`; no JDBC is needed for it.
- **Decision scope checks:** not every decision path uses `ApproverScopeGuard`. Shift-change decisions use `ShiftController.approverScope()`; expense decisions use their own object-level check. The Undo journal must hook each real path.
- **Permissions:** the `/me/wfh` guard is anyOf(`wfh.request.self`, `hrms.ess.read`, `attendance.checkin.self`). The face-events API also accepts `attendance.status.review`.

## B. Dependencies the plan missed
- P-TEAM (UI) needs P-LEAVE.be (BW-42) and P-EXP.be (BW-60).
- P-LEAVE needs P-HOME.be (BW-35, BW-122).
- P-DASH needs P-ATT-DAY.be (BW-13, BW-14).
- **P-TEAM.be builds its inbox read model (BW-09) straight from the tables with JDBC.** It must not call other packages' endpoints. Timesheet rows appear only when BW-36's tables exist (FEATURE_NOT_READY-safe). The expense status filter it needs is its own SQL.
- **P-HOME.be (Wave A) builds only BW-35, BW-119, BW-121, BW-122, and the BW-120 "needs you" sources that read EXISTING tables.** Sources over tables other packages add (`letter_signatures`, `review_cycle_milestones`, `policy_ack_deadlines`, `asset_confirmations`, …) are added in P-HOME's UI phase (Wave C), after those packages' `.be` merges, so the SQL is written against real columns.
- **F3a** uses only existing endpoints for the More profile card (`/v1/users/me`, `/v1/employees/me`). It never depends on BW-98.

## C. Files nobody owned: now assigned
- `be/probation/ProbationService.java` → **P-SETUP** (BW-106). P-TEAM (BW-11) calls its EXISTING confirm/extend methods and doesn't modify it; if it must, it reports to the lead.
- BW-36 approval endpoints `/v1/timesheets/*` → **P-ATT-DAY**, in a NEW controller. `TimeEntryController` is class-mapped to `/v1/ess/timesheets` with a class-level `attendance.checkin.self` guard; don't widen that guard.
- `hrms.projects.code`: optional. The timesheet shows the project's name, plus the code where one exists. P-DASH adds a Code field to the project form only if its design shows one.
- `reports/AuditExportController` (if BW-111's category filter applies to the export) → **P-ADMIN**.
- The `/plan`, `/modules` and `/no-access` pages (restyle) → **F3a**.
- **`be/saasguard/TenantModuleGuard.java` → P-TEAM.** It maps EVERY new path prefix from AUDIT §3 to the hrms module (`/v1/team`, `/v1/approvals`, `/v1/ess`, `/v1/timesheets`, and any new `/v1/me/*` or other prefix). Unlisted paths pass with no module check today (L78), so a new prefix left out would skip the plan check. Other packages send P-TEAM (via the lead) any new prefix they add.

## D. Shared hooks C0 adds (in addition to its list)
- BW-43 apply-on-behalf (P-ATT-DAY, P-PROFILE)
- BW-64 F&F status (P-GROW, P-PROFILE)
- BW-90 employee stats (P-WF-SETUP, P-GROW)
- BW-98 my own record (P-PROFILE; F3a later)
- BW-24 web-punch setting (P-SETUP, P-HOME)

**Notification type:** `PROBATION_TEAM_DECISION`. A manager confirming or extending (BW-11) notifies HR and the employee. It is person-triggered, so it's allowed under DECISIONS 13.

## E. The /team guard: "the four approve codes" named
`hrms.leave.approve.l1`, `wfh.approve`, `attendance.regularization.approve`, `hrms.expense.claim.approve`, plus `hrms.timesheet.approve` once BW-36 lands (F3a adds all five; the fifth is harmless before its migration).

## F. Live-test ownership
- **Scripts no package was named for:** grep `e2e/recovery` for scripts that touch your routes or endpoints. If one does and no package owns it, YOU own it: run it, update its selectors, keep its checks. Known ones:
  - `live-shift-requests`, `live-overtime-browser` (P-ATT-PLAN)
  - `live-fnf-tabs` (P-PAY-EXTRA)
  - `live-offers-browser`, `live-offer-email` (P-HIRE)
  - `live-payroll-access` (P-PAY-CORE)
  - `live-notices-browser`, `live-projects` (P-DASH)
  - `live-employee-import` (P-WF-PEOPLE)
  - `performance-authorization-live` (P-GROW)
  - `live-money-modals`: the expense blocks (P-EXP), the advance blocks (P-PAY-EXTRA)
  - `live-backend-fixes`: BW-33 blocks (P-ATT-PLAN), BW-46 blocks (P-LEAVE)
- **`live-w3-greeting-myatt`:** P-DASH (the owner greeting on /dashboard) and F3a (reader's /dashboard → /me) also edit their own blocks.

## G. Risks to handle (add to your tests)
- **WEB check-in method:** `WEB` becomes a new value in `checkInMethod` fields the mobile app reads (P-ATT-DAY).
  - It is off by default, so WEB rows only exist once an admin enables it.
  - Check the mobile repo's parsing if you can reach it; otherwise report it as a risk.
  - Keep every existing field unchanged.
- **`attendance.records` is PARTITIONED** (9 partitions inherit the method CHECKs). V143_53 must alter the parent.
  - Use `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT`, and drop the old check only after the new one exists, all idempotent. This avoids a long lock and a full scan under an exclusive lock.
  - Document it for the production run (P-ATT-DAY).
- **Spring AOP self-invocation:** the Undo journal must see every decision.
  - Bulk approve (BW-42) and any internal loop must call the decide method THROUGH THE PROXY (inject the bean, or record explicitly), never `this.decide(...)` (P-TEAM, P-LEAVE, P-EXP).
  - A unit test fails if a pointcut matches no method.
- **FEATURE_NOT_READY must never hide a bug.**
  - The helper logs a WARN with the SQL message every time it maps an error.
  - In live tests (all migrations applied in `ut_w3_dev`), ANY FEATURE_NOT_READY is a FAILURE, except in the deliberate rename-the-table step.

## H. The legacy `me` module in the prototype (no rail entry)
`me-salary`, `me-wfh`, `me-shift`, `me-att` (Time entries tab), `me-leave` (Balances tab), `me-letters` and `me-assets` are unreachable in the prototype (not in RGROUPS, ReviewBoard or the ref captures).
- **N:** not built as separate designs. The self-service pages follow the `Emp*` designs (EmpTime, EmpLeave, EmpPay, EmpDocs, EmpGrowth).
- P-ATT-DAY, P-LEAVE and P-DOCS use the Emp* screens for self-service, not `me-*`.

## I. Screen-map fixes
- E14: the design's "Attendance analytics · Overtime" tab (PgTime `a-analytics` tab 3) lives in Shifts & Overtime › Overtime.
- G11's prototype is PgPay `x-fnf`.
- The business-app sub-pages stay one ComingSoonRoute per app.

## J. Tools
- F4 must NOT overwrite the existing `e2e/recovery/capture-prototype.mjs` (the old bundle capture tool). The new tool is `apps/platform/e2e/capture-handoff.mjs`.
- The kit test harness `src/design/kit/__tests__/harness.*` is F2b's (merged). Other packages use their own temporary harness and delete it before finishing.
