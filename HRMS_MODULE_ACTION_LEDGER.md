# HRMS module / action ledger

Started 2026-09-23 (continuation takeover). One row per user-visible action. Evidence columns record what was actually
exercised against the LOCAL recovery runtime (http://127.0.0.1:8080/api, DB 55432) — never production.
Status vocabulary: **LIVE** (real endpoint, real persistence, exercised) · **PARTIAL** (some blocks live) · **STUB**
(static/mock/hard-coded) · **DEAD** (unreachable) · **UNVERIFIED** (exists in code, not yet exercised this round).

Evidence vocabulary: `+` positive path passed · `−` negative/invalid rejected · `⊘` denied for unauthorised role ·
`↻` persisted across reload · `?` not yet exercised · `✗` failed (see note).

## 0. Baseline (2026-09-23 evening)

| Check | Result |
|---|---|
| Git | main @ e5d1982; 61 modified + 69 untracked preserved (no reset/clean) |
| Ports 3002 / 8080 / 55432 / 11025 / 18025 | all listening; owners: Vite (strictPort), recovery jar under %LOCALAPPDATA%\UnifiedTreeRecovery, PostgreSQL 18 recovery cluster, local mail catcher |
| Vite proxy | 3002 `/api` → local Spring (no Cloudflare headers; same-second timestamps as 8080) |
| Flyway (`flyway_schema_history_canonical`) | V139 top, all success |
| Login | `POST /v1/canonical-auth/login` owner@unifiedtree.demo → 200, roles + permissions present |
| 53-route owner sweep (`live-browser.mjs`) | run 1 aborted at route 33 (`net::ERR_NETWORK_IO_SUSPENDED` on /hrms/onboarding/instances — transient network suspension); 32/32 completed routes had 0 page errors, 0 failed requests. Re-run pending. |

## 1. Original client complaints

| # | Complaint | Route → action | Permission | API | Persistent state | Evidence | Status / gap |
|---|---|---|---|---|---|---|---|
| C1 | "One person is late" must identify who | `/dashboard` Late tile → `/hrms/attendance?tab=team&status=LATE` → row → employee detail | attendance.team.read | `GET /v1/attendance/dashboard?date=` → `counts{present,onLeave,late,halfDay,earlyCheckout,workFromHome,notMarked,absent}` + `staffStatuses[]{employeeId, employeeCode, fullName, jobTitle, departmentName, status, checkInAt, checkOutAt, attendanceType, onLeave, …}` | attendance.records (read) | **Verified 2026-09-24** — `live-late-drilldown.mjs` 8/8 (browser, real API, one LATE record inserted then removed): tile shows `Late Arrivals 1` → click → `/hrms/attendance?tab=team&status=LATE&date=…` → row "Reader User EMP002 · Software Engineer · LATE · 9:47 AM" → count matches tile → row click opens the attendance detail (code, role, date, status, check-in) → 0 page errors. Present/WFH overlap now counted as a set (AttendanceController.java:743). | Remaining (plan item 5): no Shift / Expected / Late-by columns — the row says LATE and the check-in time but not *how* late. Needs shift start per staff row from the backend. |
| C2 | Employee shift change must persist with effective dates | Shifts & Overtime → roster → **Change shift** drawer (`attendance/EmployeeShiftAction.tsx`); employee `/me/shift-change` → request → HR decision | `attendance.regularization.approve` (drawer) / ShiftController | `GET/POST /v1/shifts/employee/{id}` (`AssignShiftRequest{shiftPolicyId, effectiveFrom}`), `GET /v1/team/schedule?from&to`, change-requests create/my/pending/decision | `attendance.employee_shift_assignments` (effective_from / effective_to) | **Fixed + verified 2026-09-23.** Defect found: the drawer never sent `effectiveFrom` (every change started today) and `getCurrentShift` returned the OPEN row, so a scheduled change showed as current immediately while the date-aware team schedule disagreed. Fix: `EmployeeShiftAssignmentRepository.findEffectiveOn` + "upcoming" fields on `EmployeeShiftResponse`; drawer gains an effective-date field, current/scheduled summary and a dated toast; roster shows "→ Night from …". Evidence: `EmployeeShiftServiceTest` 4/4 (+ ShiftTimingTest 2/2); `live-shift-effective.mjs` **12/12** — `+` future-dated assign, current unchanged, effectiveTo = day before, upcoming reported, schedule shows old shift today and new shift on the date, `↻` reload, `−` date before current start → 422 SHIFT_DATE_INVALID, `⊘` employee login → 403, schedule restored. | Remaining: employee change-request decision assigns from today (no requested date on the request DTO) — acceptable, note in UI copy; roster still fetches one shift query per row (N+1) — perf item, not correctness. |
| C3 | Requests must show who raised them + real actions | Correction approvals, shift-change approvals, leave approvals, WFH, expense claims | attendance.regularization.approve etc. | `GET /v1/attendance/corrections/approvals` (paged, empty today), `GET /v1/shifts/change-requests/pending`, leave/expense queues | regularization_requests, shift change requests, leave requests | API `+` read (shape), rows `?` (no pending fixtures today) | Verify requester name/code/department + reason + timestamps rendered; approve/reject with note; audit actor recorded. |

## 2. Known-defect recheck (from UNIFIEDTREE_CODEX_MASTER_CONTEXT.md §12)

| Item | Current state | Action |
|---|---|---|
| Headcount `ON_NOTICE` vs `NOTICE_PERIOD` | fixed — ReportService.java:36 uses `NOTICE_PERIOD` | none |
| `useTrainingPrograms(0)` / `useMyClaims(0,200)` unpaged | fixed — both paged (`page`, size 20) | none |
| PayrollDashboard "TDS Liability" tile | present — `kpis.tdsLiability` from `usePayroll.ts`; backend derivation being checked | verify source; if TDS is never computed, present honestly or remove |
| `/hrms/fnf` route collision (two sidebar leaves → one route) | **fixed 2026-09-23** — new `/hrms/exit` page `modules/hrms/exit/ExitCenter.tsx` (guard `hrms.employee.read/write`, module `hrms`); sidebar leaf repointed; `/hrms/fnf` unchanged. Lists On notice / Exited / Terminated via `GET /v1/hrms/employees?status=`, counts via `/employees/counts`; actions reuse `POST …/notice`, `…/cancel-notice`, `…/exit`, `PUT` dates. Evidence `live-exit-center.mjs` **12/12**: page renders, both leaves reach their own routes, Start notice (picker → dates → submit) `+`, row shows last working day, `↻` reload, API NOTICE_PERIOD with dates, Withdraw notice via confirm dialog `+` → ACTIVE, `⊘` employee login → 403 on the list, 0 page errors / 0 failed API calls from the page. | Picker lists any status and disables employees already leaving (new hires are PROBATION, not ACTIVE). F&F handoff is a link to `/hrms/fnf` — the settlement tab has no employee preselect yet (small follow-up). |
| Onboarding wizard steps not persisting | OnboardingForm.tsx now has 6 mutations + `saveOnboardingPayroll` | verify each step writes (ledger §4) |
| Letters ignore `employeeId` | handoff: EmployeeLetters uses server filtering | verify (ledger §4) |
| Performance KPI DTO vs V071 schema | handoff: KPI workflows exercised (performance-kpis-live.png) | verify live GET /v1/performance/kpis (ledger §4) |

## 2a. New findings this round

| Area | Finding | Evidence | Status |
|---|---|---|---|
| Auth / login | Every browser sign-in produces two `POST /v1/canonical-auth/refresh → 422` (after two 401s on the first post-login requests). Pages work afterwards; the noise is on every login, not page-specific. | control run: 2×422 immediately after login; 0 failures on `/hrms/employees`, on reload, on `/hrms/exit` | UNVERIFIED cause — inspect the login → token-store → first-request ordering in `LoginPage.tsx` / `client.ts`; a 401→refresh with no refresh token yet is the likely shape. |
| Shift roster | `ShiftRoster.tsx` issues one `GET /v1/shifts/employee/{id}` per row (N+1, 10 per page). | code | Perf follow-up; correct today. |

## 3. Business decisions (answered by the user 2026-09-24)

1. **Overtime: approval-only.** Reviewed minutes stay on the record; no payroll posting, no comp-off. UI must say "Recorded, not paid". No formula is to be guessed.
2. **Providers: local only.** Mail stays on the local catcher; Integrations stays a truthful registry; no external sends.
3. **Inspector: signed expiring links are sufficient — OTP dropped.** Remaining inspector work = explicitly scoped muster export + document retention/audit policy.
4. **Git: commit + push each verified checkpoint to main** (scoped to own files; password-bearing recovery scripts stay excluded).
5. `/hrms/exit` split from `/hrms/fnf` — done (no veto).

## 4. Module ledger

(Populated by the module audit — one section per sidebar group, one row per action.)
