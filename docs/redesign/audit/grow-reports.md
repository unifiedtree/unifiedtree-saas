# Phase 0 audit: Performance, Learning, Employee exit, Reports & Workforce analytics

Area owner: the "grow + reports" audit agent. Read-only audit of `main` at `e32a4dc6` (27 Sep 2026).

Sources read in full: `design_handoff_hrms_redesign/README.md`, `CLAUDE_CODE_PROMPT.md`, `redesign/DECISIONS.md`,
`prototype/PgGrow.dc.html`, `prototype/PgReports.dc.html`, the `r-wfa` block of `prototype/PgSetup.dc.html`
(Workforce analytics renders from PgSetup, see `hrms-core.js` → `SETUP['r-wfa']`), `hrms-core.js` (nav model),
`UtSection(s).dc.html` (section kinds), `UtArt.dc.html`, and the report/schedule sample rows in `hrms-data.js`
(used only to learn which data points exist).

**Environment note.** The local API (`127.0.0.1:8080`) and the recovery database (`127.0.0.1:55432`) were not
running during this audit, and nothing was started (read-only brief). So no live GET or SQL checks were possible.
Everything below comes from the code: React pages and hooks, Spring controllers/services (`@PreAuthorize`),
JPA entities, and the Flyway files in `backend/app/hrms-app/src/main/resources/db/canonical/`.
Role-to-permission facts come from migrations (V071, V073, V026/V117, V124, V143_9, V143_21, V143_27) and
should be re-checked against a live database before Phase 8 QA.

Legend: **EXISTS** = real data/API today. **PARTIAL** = the data is there but something the design shows is not
(said what). **MISSING** = no API or no data today.

---

## 0. Summary

- Every screen in this area already exists as a real, API-backed page. None needs to be started from zero.
  The redesign is mostly layout (pill tabs in the top bar, shared cards/stat cards/tables, tokens, dark mode,
  Plus Jakarta Sans ≤600), plus a list of backend additions for design elements that have no data yet.
- PgGrow holds 5 designed pages: **Performance** (6 tabs), **Learning** (5 tabs), **Resignation & exit** (3 tabs),
  and two "My workspace" pages, **My attendance** (2 tabs) and **My leave** (2 tabs). PgReports is the
  **Reports center**. **Workforce analytics** (3 tabs) is drawn in PgSetup.
- Repo screens in this area with **no prototype design** (they must be restyled with the same parts):
  the per-person performance page `/hrms/performance/employees/:id`, the program page `/hrms/learning/programs/:id`,
  and the six report pages `/hrms/reports/{headcount,attrition,diversity,attendance-summary,late-marks,leave-balance}`.
- Biggest backend gaps (details in §4):
  - Performance: cycle **due date**, **rating scale** and **"who reviews"** on the cycle; cycle **stages**
    (goals set → self → manager → calibration → shared); **ratings distribution**; **Remind** that actually
    notifies (today the endpoint only bumps a counter) plus a morning reminder job; **company KPIs** that goals
    link to and roll up into; a KPI **summary**; review list **status filter**.
  - Learning: program **location**, programs **summary** (ongoing, enrollments this year), a **company-wide
    certifications list** with expiry, skill **updated** date, certification name on a skill **proposal**.
  - Exit: the list API **drops the exit reason** (so the Reason column is always "—" today), no **F&F status
    per leaver**, no "exited **this year**" count, tabs not in the URL.
  - Reports: hero stats with **deltas**, per-tile **mini charts**, **pin to dashboard**, **custom report builder**
    (no design for the builder itself), schedules with **weekday/daily frequency, send time and CSV**,
    Workforce analytics as **three tabs** with a headcount trend that doesn't need the attrition permission.
- About 20 live tests in `apps/platform/e2e/recovery/` pin today's labels, ids, aria-labels and dialog names on
  these pages (§7). Two of them are already stale today (they don't know about the People view and Skill approvals).

---

## 1. Screen map

| # | Prototype page (file → key) | Tabs in the design (hrms-core `M`) | Route today | Repo files | Page exists? |
|---|---|---|---|---|---|
| S1 | PgGrow → `p-center` "Performance" | Review cycles · Employee reviews · Goals & KPIs · People · My reviews · My goals | `/hrms/performance?view=cycles\|reviews\|kpis\|people\|my-reviews\|my-goals` | `modules/hrms/Performance.tsx`, `performance/AdminCycles.tsx`, `AdminReviews.tsx`, `AdminKpis.tsx`, `PerformanceDirectory.tsx`, `PerformanceEmployeePicker.tsx`, `shared.tsx`; hooks `api/usePerformance.ts`, `api/usePerformanceAdmin.ts` | Yes, all 6 tabs, same order and names |
| S2 | PgGrow → `p-learn` "Learning" | Programs · My training · Skill matrix · Certifications · Skill approvals | `/hrms/learning?view=programs\|my\|skills\|certifications\|approvals` | `modules/hrms/Learning.tsx`, `learning/ProgramDetail.tsx`; hooks `api/useLearning.ts` | Yes, all 5 tabs, same order |
| S3 | PgGrow → `x-res` "Resignation & exit" | On notice · Exited · Terminated | `/hrms/exit` (tab kept in React state only, not in the URL) | `modules/hrms/exit/ExitCenter.tsx`; hooks `api/useWorkforce.ts` | Yes |
| S4 | PgGrow → `me-att` "My attendance" (My workspace) | Calendar · Time entries | `/hrms/attendance?tab=my` | `modules/hrms/attendance/AttendanceContainer.tsx` (My Attendance), `api/useAttendance.ts` | Yes (Calendar); punches list partial |
| S5 | PgGrow → `me-leave` "My leave" (My workspace) | Balances · Requests | `/hrms/leave?tab=my` (+ `tab=balances`, `tab=apply`) | `modules/hrms/Leave.tsx`, `api/useLeave.ts` | Yes |
| S6 | PgReports → `r-center` "Reports" | none (category segmented control All/People/Time) | `/hrms/reports` | `modules/hrms/reports/ReportsIndex.tsx`, `ReportSchedules.tsx`, `ReportKit.tsx`, `reportSpec.ts`, `useReportCompany.ts`; hooks `api/useReports.ts`, `api/useReportExports.ts` | Yes |
| S7 | PgSetup → `r-wfa` "Workforce analytics" | Headcount · Attrition · Diversity | `/hrms/workforce-analytics` (one page, no tabs today) | `modules/hrms/analytics/WorkforceAnalytics.tsx`, `design/dc/WorkforceAnalytics.tsx` (logic), `design/dc/WorkforceAnalytics.view.tsx` (generated from the OLD export) | Yes, but as one dashboard, not 3 tabs |
| S8 | none | — | `/hrms/performance/employees/:id` | `performance/EmployeePerformancePage.tsx` | Yes (no design) |
| S9 | none | — | `/hrms/learning/programs/:id` | `learning/ProgramDetail.tsx` | Yes (no design) |
| S10 | none (tiles in PgReports "Open") | — | `/hrms/reports/{headcount,attrition,diversity,attendance-summary,late-marks,leave-balance}` | `reports/HeadcountReport.tsx`, `AttritionReport.tsx`, `DiversityReport.tsx`, `AttendanceSummaryReport.tsx`, `LateMarksReport.tsx`, `LeaveBalanceReport.tsx` | Yes (no design) |
| — | PgPay → `x-fnf` (other agent) | Pending approval · Pending payment · Settled · All | `/hrms/fnf?tab=…` | `FullAndFinal.tsx` | Yes. Only the hand-off from S3 is in my scope. |

Page-level header in the design (PgGrow): small crumb ("Performance", "Employee exit", "My workspace"), 28px title,
a one-line sub that changes **per tab**, and up to two buttons on the right (main + secondary). Forms open as an
**in-page view** with a "← {page} · {tab}" back link (see conflict C1).

---

## 2. Navigation and permissions today

Menus are **permission-only**: `PlatformShell.isVisible()` calls `menuRule(path, group)` → `accessState()`
(`shared/navigation/pageRegistry.ts`, `access.ts`). The `visibleForRoles` arrays in `PlatformShell.tsx` are no
longer read. The ESS ("Me") group is hidden for `ADMIN_ROLES` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN
(`administersWorkspace`, `shared/hooks/useRoles.ts:51`).

| Nav item (rail group → child) | Menu rule (pageRegistry) | Route guard (App.tsx) | Backend |
|---|---|---|---|
| Performance & Learning → Performance Center `/hrms/performance` | `page('performance', …, [{ anyOf: ['hrms.performance.read','hrms.performance.write','hrms.performance.review.self'], module: 'hrms' }])` | same three codes + `ModuleGate hrms` | see S1 |
| Performance & Learning → Learning & Skills `/hrms/learning` | `anyOf: ['hrms.learning.read','hrms.learning.write','hrms.learning.enroll.self','hrms.learning.skill.read']` | same + `'hrms.learning.skill.approve','hrms.learning.skill.assess.self'` (menu is narrower than the route) | see S2 |
| Employee Exit → Resignation & Exit `/hrms/exit` | `anyOf: ['hrms.employee.write']` | `anyOf: ['hrms.employee.read','hrms.employee.write']` (menu is narrower than the route) | `/v1/hrms/employees*` |
| Employee Exit → Full & Final `/hrms/fnf` | `anyOf: ['hrms.fnf.read','hrms.fnf.process','hrms.fnf.approve'], module: 'payroll'` | same, `ModuleGate payroll` | `/v1/fnf/*` |
| Reports & Analytics → Reports Center `/hrms/reports` | `anyOf: REPORTS` = the 5 `hrms.report.*` codes | same 5 | see S6 |
| Reports & Analytics → Workforce Analytics | `anyOf: ['hrms.report.headcount','hrms.report.attrition','hrms.report.diversity']` | same 3 | see S7 |
| Report pages `/hrms/reports/*` | one code each (headcount, attrition, attendance ×2, leave, diversity) | same | `@perm.check('hrms.report.…')` |
| Me → Attendance (My attendance) | menu `'ess:/hrms/attendance'`: `anyOf: ['attendance.checkin.self'], self: true`; search entry `me-attendance` also `when: notAdminRole` | `/hrms/attendance` guard `anyOf: ['attendance.team.read', P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]` | page hides the tab when `useRoles().isAdmin` |
| Me → Leave (My leave) | menu `'ess:/hrms/leave'`: `anyOf: ['leave.request.self'], self: true`; search `me-leave` `allOf leave.request.self` + `notAdminRole` | Leave route | page hides personal tabs for admin roles |

Tabs in search (`tab()` entries): `performance:{cycles,reviews,kpis,people}` need `hrms.performance.read`;
`performance:{my-reviews,my-goals}` need `hrms.performance.review.self`; `learning:programs` `hrms.learning.read`;
`learning:my` `hrms.learning.enroll.self`; `learning:{skills,certifications}` `hrms.learning.skill.read`;
`learning:approvals` `hrms.learning.skill.approve`. **No tab entries** exist for `/hrms/exit` or
`/hrms/workforce-analytics` (and `pageRegistry.test.ts` "tabs use the query parameter their page reads" must get
`exit` and `workforce-analytics` added to its param map if tabs are registered).

Default holders (from migrations, verify live): performance read+write+self → SUPER_ADMIN, OWNER, HR_MANAGER, ADMIN
(V143_9); DEPT_MANAGER read+self (+`hrms.kpi.progress`); FINANCE_LEAD, EMPLOYEE self only.
`hrms.appraisal.initiate`, `hrms.kpi.manage` → HR_MANAGER (V124) + OWNER/SUPER_ADMIN (+ADMIN).
Learning read+write+self → SUPER_ADMIN, OWNER, HR_MANAGER; DEPT_MANAGER, EMPLOYEE read+self; FINANCE_LEAD self.
`skill.assess.self` → every employee-carrying role; `skill.approve` → OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER, MANAGER.
Reports (V026): SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD; OWNER holds every permission (enforced at start-up by
`OwnerPermissionInvariantCheck`); DEPT_MANAGER lost headcount/attendance/leave (V117).
`hrms.report.schedule.manage` and `hrms.report.exports.read_all` → OWNER, SUPER_ADMIN, HR_MANAGER (V143_27).
`hrms.fnf.read` → SUPER_ADMIN, OWNER, HR_MANAGER, FINANCE_LEAD (V069).

---

## 3. Screen by screen

### S1 Performance (`p-center`) → `/hrms/performance`

Page gate: `usePermission('hrms.performance.read')` shows the 4 admin tabs; `'hrms.performance.review.self'` shows
My reviews / My goals (`Performance.tsx:37-47`). Tab kept in `?view=` (`useView`). Manager scope (no
`performance.write`): API returns their team only (`PerformanceTeamScope`).

#### S1.1 Review cycles (design tab 0) → `?view=cycles` → `AdminCycles.tsx`
Sub: "Run review cycles, read feedback and track company goals." (same as today). Main button: **New cycle**.

| Data point (design) | Source today | Status | What's missing |
|---|---|---|---|
| Current cycle card title ("Q3 2026 check-in") | `useReviewCycles` → `GET /v1/performance/cycles` (`hrms.performance.read`) | EXISTS | pick rule for "current" (ACTIVE; several companies can each have one) |
| "186 of 231 reviews submitted" | `useCycleProgress` → `GET /v1/performance/cycles/{id}/progress` (`completedAssignments/totalAssignments`, team-scoped) | EXISTS | endpoint runs one query per reviewee (N+1); fine for a drawer, slow for a card on a big cycle |
| "closes Wed, 30 Sep" | — | MISSING | `review_cycles` has only `period_start/period_end`; no due/close date |
| Stage "Goals set · July · done" | — | MISSING | no goal-setting window or stage on the cycle |
| Stage "Self review · Done by 214" | `/progress` → `reviewees[].assignments[]` with `reviewerType=SELF`, `status` | PARTIAL | must be counted client-side over every reviewee; no aggregate endpoint |
| Stage "Manager review · 186 of 231 · current" | same, `reviewerType=MANAGER` | PARTIAL | same; "current stage" marker needs stage rules |
| Stage "Calibration · From 1 Oct" | — | MISSING | no calibration step or date |
| Stage "Shared · From 12 Oct" | — | MISSING | no "share with employee" step; today submitted feedback is visible to the reviewee at once (C6) |
| Note "45 manager reviews are still to write" | derivable from `/progress` | PARTIAL | as above |
| Note "Reminders go out every morning" | — | MISSING | no reminder job; `POST /reviews/{id}/remind` does not notify anyone (G-P6) |
| "Ratings so far" bars: 5·Outstanding 21 … 1·Below 3 (manager reviews this cycle, warn/bad tones) | — | MISSING | no distribution endpoint; label set depends on a rating scale (G-P2, G-P5) |
| Cycles table · Cycle | `GET /cycles` `name` | EXISTS | |
| Cycles table · Period | `periodStart/periodEnd` | EXISTS | |
| Cycles table · Reviews (count) | `/cycles/{id}/progress` per cycle | PARTIAL | would be one call per row; needs counts on the list (G-P3) |
| Cycles table · Submitted "186 of 231" | same | PARTIAL | same |
| Cycles table · Status Planned / Open · closes 30 Sep / Closed | `status` DRAFT/ACTIVE/CLOSED | PARTIAL | "closes …" needs the due date |

| Action | API today | Permission | Status |
|---|---|---|---|
| New cycle: Title, Period from/to | `useCreateCycle` → `POST /v1/performance/cycles` {companyId, name, periodStart, periodEnd} | `hrms.performance.write` | EXISTS (repo also asks the **Company**; design doesn't) |
| New cycle: Who reviews (Manager + self / Manager only / 360°) | chosen later in **Assign reviews** → `POST /cycles/{id}/initiate` {reviewerTypes, revieweeIds, peerCount} | `hrms.appraisal.initiate` | PARTIAL (not stored on the cycle) |
| New cycle: Due date | — | — | MISSING |
| New cycle: Rating scale (1–5 / 1–4 / comments only) | — | — | MISSING (`ReviewSubmitRequest.overallRating` is `@NotNull` 0–5) |
| (repo only) View progress / Assign reviews / skipped list / Close cycle | `GET /progress`, `POST /initiate`, `POST /close` | read / `hrms.appraisal.initiate` | EXISTS, not in design (keep) |

#### S1.2 Employee reviews (tab 1) → `?view=reviews` → `AdminReviews.tsx`
Sub: "Every review in the current cycle, and where each one stands." Segment: **All / Waiting / Submitted**.

| Data point | Source today | Status | Missing |
|---|---|---|---|
| Segment filter All/Waiting/Submitted | `useReviews(cycleId, page)` → `GET /v1/performance/reviews?cycleId&page&size=20` | PARTIAL | no `status` param; list is paged so a client filter would be wrong |
| Employee name | `employeeName` (+ `employeeCode`) | EXISTS | |
| "· Engineering" (department) | — | MISSING | `PerformanceReviewResponse` has no department |
| Cycle | `cycleName` | EXISTS | |
| Reviewer | `reviewerName` / "Self review" | EXISTS | reviewer type not returned (only on `/employees/{id}`) |
| Rating | `overallRating` ("x / 5", "Not submitted") | EXISTS | |
| Status pill Waiting / Submitted | `status` PENDING, IN_PROGRESS, SUBMITTED, ACKNOWLEDGED, MISSED | EXISTS | map PENDING+IN_PROGRESS→Waiting; keep MISSED |
| Open view: Rating, Strengths, Areas to improve, Submitted date | review row + `ReviewGoalsPanel` (`GET /reviews/{id}/goals`) | EXISTS | |

| Action | API | Permission | Status |
|---|---|---|---|
| Open (submitted) | client state + `GET /reviews/{id}/goals` | `hrms.performance.read` or `.review.self` | EXISTS ("View review" drawer) |
| Remind (waiting) → "Reminder sent to {reviewer}" | `POST /v1/performance/reviews/{id}/remind` (`AppraisalCycleController:62`) | `hrms.performance.write` | PARTIAL: endpoint exists (24h throttle, `reminder_count`), **no hook**, and it **sends nothing** (no notification, no email) |
| (repo) Cycle filter select `aria-label="Review cycle"`, paging, name → per-person page | as above | read | EXISTS (keep) |

#### S1.3 Goals & KPIs (tab 2) → `?view=kpis` → `AdminKpis.tsx`
Sub: "Company KPIs and the goals people are working towards." Main button: **Add goal**.

| Data point | Source today | Status | Missing |
|---|---|---|---|
| Goals (342, "Across everyone") | `useAdminKpis` → `GET /v1/performance/kpis` `total` (list holds personal goals and KPIs, team-scoped for managers) | PARTIAL | needs a count call; no summary endpoint |
| Completed (96) | same with `status=COMPLETED` | PARTIAL | extra call |
| Reached (28%, "Of all goals") | derivable | PARTIAL | |
| Average progress (61%) | — | MISSING | no aggregate |
| "Company KPIs" bars (title + %) | — | MISSING | every goal belongs to one employee (`goals.employee_id NOT NULL`); no company-level KPI object |
| Goals at risk · Owner name | `status=AT_RISK` rows `ownerName/ownerCode` | EXISTS | |
| Goals at risk · "· Sales" (department) | — | MISSING | `KpiRowDto` has no department |
| Goals at risk · Goal / Progress / Status | `title`, `progressPct`, `status` | EXISTS | |

| Action | API | Permission | Status |
|---|---|---|---|
| Add goal (form: Goal, Description, Weight, **Company KPI**, Due date) | repo: **Create KPI** drawer → `POST /v1/performance/kpis` {ownerId, title, target, unit, direction, weight, dueDate…} | `hrms.kpi.manage` | PARTIAL/CONFLICT (C4): design form has no owner/target; "Company KPI" link missing |
| (repo) Edit KPI, Update progress, History, Drop, search, status filter, paging | `PUT /kpis/{id}`, `PUT /kpis/{id}/progress` (`performance.write` or `kpi.progress`), `GET /kpis/{id}/history`, `DELETE /kpis/{id}` | as noted | EXISTS (keep) |

#### S1.4 People (tab 3) → `?view=people` → `PerformanceDirectory.tsx`
Sub: "Your team, their latest rating and last review."

| Data point | Source | Status | Missing |
|---|---|---|---|
| Employee name · code | `usePerformanceDirectory` → `GET /v1/performance/employees` | EXISTS | |
| Department | `department` | EXISTS | |
| Latest rating ("Not rated yet") | `overallRating` | EXISTS | |
| Last review (cycle) | `lastReviewCycleName` (+ date) | EXISTS | |
| Status Reviewed / Review due / On probation | `lastReviewStatus` only | PARTIAL | row has no employment status and no "review pending in the open cycle" flag |

Action **Details** → design opens a small view; repo opens `/hrms/performance/employees/:id` (S8, richer). EXISTS, keep.

#### S1.5 My reviews (tab 4) → `?view=my-reviews` → `Performance.tsx` `MyReviews`
Sub: "Reviews you need to write, and the feedback about you."

| Data point | Source | Status | Missing |
|---|---|---|---|
| To write (count) | `useMyReviews` → `GET /v1/performance/reviews/my` (`review.self`), filtered client-side | EXISTS | |
| "Due Wed, 30 Sep" | — | MISSING | no cycle due date |
| Submitted (this cycle) | same list | PARTIAL | "this cycle" = which one; needs a rule |
| About you (count) | same list | EXISTS | |
| Reviews to write · Employee · department | `employeeName`, `employeeCode` | PARTIAL | department missing |
| · Cycle / · Status "To write" | `cycleName`, `status` | EXISTS | |
| · Due | — | MISSING | due date |
| About-you card: cycle, "By {reviewer} · 4.6 of 5", Strengths, Areas to improve, "4.6 · Exceeds" | `reviewerName`, `overallRating`, `strengths`, `improvements` | PARTIAL | rating label needs a scale/labels (C5) |

| Action | API | Permission | Status |
|---|---|---|---|
| Write review (Rating select 1–5 with labels, What went well, What to focus on next) | `useSubmitReview` → `POST /v1/performance/reviews/{id}/submit` {overallRating 0–5 decimal, strengths, improvements} + `ReviewGoalsPanel` | `review.self` | EXISTS (input differs, C5) |

#### S1.6 My goals (tab 5) → `?view=my-goals` → `Performance.tsx` `MyGoals`
Sub: "The goals you’re working towards." Main button: **Add a goal**.

| Data point | Source | Status |
|---|---|---|
| Goals (count) / Completed (+ the completed goal's name) / Average progress | `useMyGoals` → `GET /v1/performance/goals/my` | EXISTS (client) |
| "My goals" bars (title, %, at-risk tone) | same | EXISTS |
| Progress history (Date, Progress, Note) | `useMyGoalHistory` → `GET /v1/performance/goals/my/{id}/history` | EXISTS |

| Action | API | Permission | Status |
|---|---|---|---|
| Add a goal (Goal, Description, Weight 0–100, Company KPI, Due date) | `POST /v1/performance/goals` {title, description, weight, cycleId} (JPA `GoalService`) | `review.self` | PARTIAL: no due date (column `goals.due_date` exists, unmapped by JPA), no KPI link |
| Update progress (% + "What changed") | `PUT /v1/performance/goals/{id}/progress` {progress, note} | `review.self` | EXISTS (company KPIs assigned to you stay read-only, keep) |

### S2 Learning (`p-learn`) → `/hrms/learning`

Views: `programs` (`hrms.learning.read`), `my` (`enroll.self`), `skills` + `certifications` (`skill.read`),
`approvals` (`skill.approve`, badge = pending count) (`Learning.tsx:63-75`).

#### S2.1 Programs
Sub: "Training programs in the catalogue, and who’s enrolled." Main: **New program**.

| Data point | Source | Status | Missing |
|---|---|---|---|
| In the catalogue (count) | `useTrainingPrograms` → `GET /v1/learning/programs` `total` | EXISTS | |
| Ongoing ("Running now") | counted on the current page only | PARTIAL | needs a server count |
| Enrollments ("This year") | sum of `enrolledCount` on the page | PARTIAL | not "this year", not all pages |
| Table · Program / Category / When / Status | `title`, `category`, `startDate–endDate`, `status` | EXISTS | |
| · Seats ("30", "Unlimited") | `capacity` (repo shows "enrolled / capacity") | EXISTS | |
| · Mode ("Online", "Classroom · Bengaluru", "On site · all branches") | `mode` IN_PERSON/ONLINE/HYBRID/SELF_PACED | PARTIAL | no **location**; vocabulary differs (C9) |
| Enroll view · Employee · department | roster `GET /v1/learning/programs/{id}/enrollments` (`learning.write`) `employeeName` | PARTIAL | `EnrollmentDto` has no department |
| Enroll view · Score / Status | `score`, `status` | EXISTS | |

| Action | API | Permission | Status |
|---|---|---|---|
| New program (Company, Title, Category **select**, Trainer, Starts, Ends, Seats, Mode, Description) | `POST /v1/learning/programs` | `hrms.learning.write` | EXISTS; category is free text (no list), no location |
| Enroll people (search + Enroll) | `POST /programs/{id}/enrollments/bulk` + directory search (`hrms.employee.read`) | `learning.write` | EXISTS (Roster) |
| Drop | `POST /enrollments/{id}/admin-drop` | `learning.write` | EXISTS |
| (repo) Enroll self / status change / Details & edit / Complete with score | `POST /programs/{id}/enroll`, `PUT /programs/{id}`, `POST /enrollments/{id}/complete` | enroll.self / write | EXISTS (keep) |

#### S2.2 My training
| Data point | Source | Status | Missing |
|---|---|---|---|
| You’re enrolled in / In progress / Completed | `useMyEnrollments` → `GET /v1/learning/enrollments/me` | EXISTS | |
| My programs · Program / Score / Status | `programTitle`, `score`, `status` | EXISTS | |
| My programs · When (program dates) | — | MISSING | `EnrollmentDto` has no program dates |

Action **Leave** → `POST /enrollments/{id}/drop` (`enroll.self`) EXISTS. Repo also shows **My skills** and
**My skill proposals** here (keep).

#### S2.3 Skill matrix
Sub: "Skill levels for each person. Saving a skill name that already exists updates it." Main: **Propose a skill**.

| Data point | Source | Status | Missing |
|---|---|---|---|
| Whose record? (employee search) | `PerformanceEmployeePicker` → `GET /v1/hrms/employees` | EXISTS | needs `hrms.employee.read` on top of `skill.read` |
| Card: Skills (count), Certifications (count + first name) | `useEmployeeSkills` → `GET /v1/learning/skills/{employeeId}` (`skill.read`) | EXISTS | |
| Card: Last updated | — | MISSING | `EmployeeSkillResponse` has `createdAt` only |
| Table · Skill / Certification | `skillName`, `certified`, `certificationName` | EXISTS | |
| Table · Proficiency (Expert/Advanced/Intermediate pills) | `proficiency` 1–5 | PARTIAL | word labels vs numbers (C8) |
| Table · Updated | — | MISSING | same as Last updated |

| Action | API | Permission | Status |
|---|---|---|---|
| Propose a skill (Skill name, Proficiency, Certification name, Note) | `POST /v1/learning/skill-assessments` {skillName, proposedProficiency 1–5, note} | `hrms.learning.skill.assess.self` | PARTIAL: no certification name; placement (C10) |
| (repo) Add/update skill for a person | `POST /v1/learning/skills` | `learning.write` | EXISTS (keep) |

#### S2.4 Certifications
Design = a **company-wide** list; repo = one picked person's certifications (+ editor).

| Data point | Source | Status |
|---|---|---|
| Employee · department / Certification / Certified on / Expires on / Status (Certified · Expires in N days · Expired) across everyone | only per person (`GET /skills/{employeeId}`, filtered `certified`) | MISSING as a list |

#### S2.5 Skill approvals
| Data point | Source | Status |
|---|---|---|
| Employee · department / Skill / From / To / Note | `useSkillAssessmentQueue('PENDING')` → `GET /v1/learning/skill-assessments?view=PENDING` (`skill.approve`; team for managers) | EXISTS |

| Action | API | Permission | Status |
|---|---|---|---|
| Approve | `POST /skill-assessments/{id}/decide` {decision: APPROVED} | `skill.approve` | EXISTS |
| Reject (inline, no note) | same {decision: REJECTED, note} | `skill.approve` | EXISTS but the **API requires a note** (C7) |

### S3 Resignation & exit (`x-res`) → `/hrms/exit` → `ExitCenter.tsx`

Page gate: body needs `hrms.employee.read`; actions need `hrms.employee.write`; F&F links need `hrms.fnf.read` /
`hrms.fnf.process`. Main (page level): **Start notice period**.

| Data point | Source | Status | Missing |
|---|---|---|---|
| On notice (count) | `useEmployeeCounts` → `GET /v1/hrms/employees/counts` `notice` | EXISTS | |
| Exited ("Left the company this year") | same `exited` | PARTIAL | all-time count, no year filter |
| Terminated | same `terminated` | EXISTS | |
| On notice · Employee name | `useEmployeeDirectory({status:'NOTICE_PERIOD'})` → `GET /v1/hrms/employees?status=` | EXISTS | |
| · "· Sales" (department) | `departmentId` only | PARTIAL | name needs a join (`useDepartments(companyId)` or server) |
| · Notice started / Last working day / Days left | `noticeStartDate`, `lastWorkingDay` (+ client countdown) | EXISTS | |
| · Reason | `exitReason` | MISSING | list projection sets it to `null` ("exit reason is detail-only", `WorkforceEmployeeService.toListResponse`) so the column is always "—" today |
| Exited · Employee · dept / LWD / Exit type | list + `exitType` | EXISTS (dept PARTIAL) | |
| Exited · Full & final (Waiting for approval / Approved, to be paid / Settled) | — | MISSING | `GET /v1/fnf/settlements` has no employee filter (page comment says so) |
| Terminated · Employee · dept / LWD | list | EXISTS (dept PARTIAL) | |
| Terminated · Reason | — | MISSING | same null reason |
| Terminated · Full & final | — | MISSING | as above |

| Action | API | Permission | Status |
|---|---|---|---|
| Start notice period (Employee search ≥2 chars, Notice start, LWD, Exit type, Reason) | `POST /v1/hrms/employees/{id}/notice?noticeStart&lastWorkingDay&reason&exitType` | `hrms.employee.write` | EXISTS |
| Edit dates (prefilled) | `PUT /v1/hrms/employees/{id}` | `employee.write` | EXISTS |
| Withdraw notice (secondary in the edit view) | `POST /employees/{id}/cancel-notice` (+ confirm dialog) | `employee.write` | EXISTS (row button today) |
| Mark exited (one click in design) | `POST /employees/{id}/exit?lastWorkingDay&exitType` (drawer asks exit type) | `employee.write` | EXISTS (C12) |
| Settlement → F&F tab by status | link to `/hrms/fnf` or `?tab=create&employeeId=` | `fnf.read` / `fnf.process` | PARTIAL: no status-specific tab without G-E2 |
| Tabs as links | tab in `useState` | — | MISSING in URL |

### S4 My attendance (`me-att`) → `/hrms/attendance?tab=my` (shared with the attendance / self-service agents)

Rule: hidden for OWNER/SUPER_ADMIN/COMPANY_ADMIN/ADMIN (C18).

| Data point | Source | Status | Missing |
|---|---|---|---|
| Present (days in office) / Late | `useMonthlyStats` → `GET /v1/attendance/monthly-stats` | EXISTS | |
| Late note "After the 09:45 grace" | shift policy / `GET /v1/employees/me` + policy | PARTIAL | not wired into the stat |
| Work from home (approved days) | — | PARTIAL | not in monthly stats; available via my WFH requests (`api/useWfh.ts`) |
| Leave (+ "2 days booked for 28–29 Sep") | `useMyLeaves` | PARTIAL | client join |
| Calendar day tags Present / Late / WFH / Off | `useAttendanceHistory` → `GET /v1/attendance/history` (PRESENT, LATE, HOLIDAY, ON_LEAVE, ABSENT, WEEKEND) | PARTIAL | no WFH day status |
| Time entries · Date / In / Out / Hours / Source / Status | `useMyAttendance` → `GET /v1/attendance/my` (`checkInAt`, `checkOutAt`, `workingHours`, `checkInMethod`, `attendanceStatus`) | EXISTS | "so far" live hours for today is client-side |

Action **Request regularisation** (Date, Came in, Went out, Reason) → `POST /v1/attendance/corrections`
(`attendance.checkin.self`) EXISTS; toast names the manager (manager name from `/v1/employees/me`).

### S5 My leave (`me-leave`) → `/hrms/leave?tab=my|balances|apply` (shared with the leave agent)

| Data point | Source | Status | Missing |
|---|---|---|---|
| Balance per type: available, "of N days", "carries forward up to 30" | `useMyBalances` → `GET /v1/leave/my/balances` + leave type `maxCarryForwardDays` | EXISTS | |
| Comp-off "Lapses on 10 Nov" | `leave_mgmt.comp_off_balances.expires_on` exists in the schema | MISSING | no Java code reads that table |
| "Used so far" bars (used of total) | balances `used/totalEntitlement` | EXISTS | |
| Requests · Leave / Dates / Days / Status | `useMyLeaves` → `GET /v1/leave/my` | EXISTS | |
| Requests · Approver; Apply panel "Approver" | — | MISSING | `LeaveRequestResponse` has no approver name |

Actions: **Apply for leave** (type, from, to, half day, reason) → `POST /v1/leave/apply` {duration} EXISTS;
**Cancel** (pending) → `POST /v1/leave/{id}/cancel?reason=` EXISTS.

### S6 Reports center (`r-center`) → `/hrms/reports` → `ReportsIndex.tsx`

Design header: crumb "Reports & analytics", title **Reports**, sub "Ready-made views of your workforce data. Open,
schedule or export any of them." Buttons: **Scheduled (count)** and **New custom report**. The top-bar search
filters the tiles ("No reports match “q”").

| Data point | Source | Status | Missing |
|---|---|---|---|
| Scheduled (count badge) | `useReportSchedules` → `GET /v1/reports/schedules` | EXISTS | only for `hrms.report.schedule.manage` |
| Hero: Headcount (249) | `GET /v1/reports/headcount` (`report.headcount`) | EXISTS | |
| Hero: "+6 this month" | `GET /v1/reports/headcount/workbook` `totals.joinedThisMonth/leftThisMonth` | PARTIAL | heavy call for one number; or a second headcount as-of call |
| Hero: Attrition 4.1% | `GET /v1/reports/attrition` monthly `attrition_pct` | EXISTS | period rule to decide |
| Hero: "0.3 pts lower" | two periods of attrition | PARTIAL | client compare |
| Hero: Women 38% | `GET /v1/reports/diversity` | EXISTS | |
| Hero: "+2 pts this year" | — | MISSING | diversity has no as-of date |
| Category control All / People / Time with counts; "6 of 6 reports" | the permitted card list | EXISTS (frontend) | repo groups Leave separately |
| Tile mini chart (headcount by dept bars; attrition line; men/women split; attendance % bars; late marks line; leave used/available split) | — | MISSING | would need all six reports loaded; needs a summary endpoint |
| Tile "Updated 2 hr ago" | — | MISSING | reports are live queries (C16) |
| Tile pinned star "Pin to dashboard" | — | MISSING | no per-user pins |
| Scheduled list · name / recipients / when / on-off | `ReportSchedule` {reportLabel, recipients[], frequency, dayOfWeek/dayOfMonth, active, nextRunOn, lastStatus} | PARTIAL | no send time, no "every weekday", no recipient group label; subtitle says PDF **and CSV** (only PDF today) |

| Action | API | Permission | Status |
|---|---|---|---|
| Open Workforce analytics (hero) | route | any of headcount/attrition/diversity | EXISTS |
| Open a report tile | route (`?co=` and `?asOf=` carried) | its report code | EXISTS |
| Pin / Unpin | — | — | MISSING |
| New custom report | — | — | MISSING (no builder design) |
| Scheduled (jump to list) | — | schedule.manage | EXISTS (frontend) |
| Schedule (new) | `POST /v1/reports/schedules` (+ `GET /schedules/recipients?report=`) | `hrms.report.schedule.manage` | EXISTS |
| Pause / resume switch | `PUT /v1/reports/schedules/{id}` {active} | same | EXISTS |
| (repo) Send now, Edit, Delete; company picker; Recent downloads (`GET /v1/reports/exports`) | as named | schedule.manage / any report | EXISTS, not in design (keep, C14) |

### S7 Workforce analytics (`r-wfa`, drawn in PgSetup) → `/hrms/workforce-analytics`

Design: crumb "Reports", title **Workforce analytics**, three pill tabs, **Download** per tab.

| Data point | Source | Status | Missing |
|---|---|---|---|
| Headcount tab: "On Fri, 25 Sep 2026" (as-of date) | page uses today | PARTIAL | no date picker on this page (the Headcount report page has one) |
| Headcount / Active ("Confirmed") / Probation / On notice | `useHeadcountReport` → `GET /v1/reports/headcount?companyId&asOf` | EXISTS | |
| By department bars | same | EXISTS | |
| "Headcount · last 6 months" chart | `GET /v1/reports/attrition` rows carry month-end `headcount` | PARTIAL | only reachable with `hrms.report.attrition`; a headcount-only reader has no trend |
| Attrition tab: "April – September 2026" / "This financial year" | page periods: last 12 months, this calendar year, last calendar year | PARTIAL | no fiscal-year period (fiscal year is in HR config; workbook already computes it) |
| Exits / Resigned / Terminated / Other (+ "Retirement") | attrition rows `exits, resignations, terminations, other_exits` | EXISTS | "Other" sub-type name not returned |
| Attrition rate "Annualised" | per-month `attrition_pct` | PARTIAL | annualised figure not computed |
| "Exits per month" chart; "Monthly trend" table (Month, Resigned, Terminated, Other, Rate) | same | EXISTS | |
| Diversity tab: Women / Men / Other or not said (% and people) | `useDiversityReport` → `GET /v1/reports/diversity` | EXISTS | |
| "Women by department" bars | same | EXISTS | |

| Action | API | Permission | Status |
|---|---|---|---|
| Download (per tab, "as Excel") | browser XLSX/CSV/PNG + `GET /v1/reports/workforce-analytics/export.pdf` (any of 3 codes) | per report | PARTIAL: one menu for the whole page today |
| Tab switch as link | — | — | MISSING (`?tab=`) |
| (repo) Department drill-down to the directory; company + period pickers | route | `hrms.employee.read` for drill-down | EXISTS, keep |

### S8 / S9 / S10 (no designs)
- **S8** `/hrms/performance/employees/:id` (`hrms.performance.read`; 403 = "Not in your team"): stat tiles
  (latest/average rating, active goals, reviews waiting), facts, "Ratings over time" line, Goals & KPIs table with
  history drawer, Reviews table with review drawer. All from `GET /v1/performance/employees/{id}`. All EXISTS.
- **S9** `/hrms/learning/programs/:id` (`learning.read`/`learning.write`): facts, description, your place
  (enroll/leave), status select, edit panel, roster. All EXISTS.
- **S10** six report pages: `ReportPage` frame (7 states), KPI row, charts, table/cards, Export menu (server CSV,
  PDF, browser XLSX, PNG), date filters (`From`/`To`/`As of` comboboxes from the shared calendar). All EXISTS.
  Restyle with the same section kinds as S7.

---

## 4. Gaps and the backend work each needs

Rules applied (DECISIONS.md §2): no change to a JPA-mapped column; new columns/tables read and written with
JdbcTemplate only; each new feature hides/empties just its block until its migration is applied; every new
permission granted to OWNER and SUPER_ADMIN in its migration.

JPA facts: `performance_mgmt.review_cycles` (entity `ReviewCycle`), `performance_reviews` (`PerformanceReview`,
but `reviewer_type`/`reminder_*` are JDBC-only), `goals` (`Goal`, but `category/direction/due_date` are JDBC-only),
`learning_mgmt.training_programs` / `training_enrollments` / `employee_skills` (JPA; `mode` JDBC-only),
`hrms.employees` (JPA `WorkforceEmployee`). JDBC-only tables: `kpi_progress_updates`,
`appraisal_reviewer_assignments`, `learning_mgmt.skill_assessments`, `hrms.report_schedules`, `hrms.report_exports`,
`hrms.employee_status_history`.

| ID | What | Backend work | Schema change? | JPA-mapped table? | Size |
|---|---|---|---|---|---|
| G-P1 | Cycle due/close date ("closes 30 Sep", "Due" columns) | `review_cycles.due_date DATE` (unmapped); write it after create with JDBC; add to cycle list DTO and to review responses (`cycleDueDate`) via JDBC enrichment; hide when column absent | New column | Yes (`ReviewCycle`), column stays unmapped | S |
| G-P2 | Cycle rating scale + "Who reviews" preset | columns `rating_scale VARCHAR(10)` (FIVE/FOUR/NONE) and `reviewer_types TEXT[]` (unmapped); submit validation uses the scale (NONE → rating optional; today `@NotNull`); Assign reviews defaults to the preset | New columns | Yes (unmapped) | M |
| G-P3 | Reviews / Submitted counts per cycle in the table | aggregate SQL over `appraisal_reviewer_assignments` (and reviews) in `GET /cycles` or new `GET /v1/performance/cycles/summary`; `hrms.performance.read`; team-scoped | No | — | S |
| G-P4 | Cycle stages card | (a) new `GET /v1/performance/cycles/{id}/stages` with counts by reviewer type and status (one query, fixes the N+1); (b) stage dates `goals_due_on`, `calibration_on`, `share_on` (unmapped columns or a JDBC table `performance_mgmt.cycle_stages`); (c) a "share" gate that hides manager feedback from the reviewee until shared; (d) a calibration step if wanted (Q2) | New columns or table | Yes if columns | L |
| G-P5 | "Ratings so far" distribution | `GET /v1/performance/cycles/{id}/ratings` (buckets by rating, MANAGER reviews, team-scoped); labels from G-P2 | No | — | S |
| G-P6 | Remind that notifies + morning reminders | extend `AppraisalCycleService.remind` to create an in-app notification (`AppNotificationService`, new enum `PERFORMANCE_REVIEW_REMINDER`; `notifications.type` is `VARCHAR(60)`) and an email (`MailService`), keep the 24h throttle; new `@Scheduled` job for PENDING reviews in ACTIVE cycles (throttle respected); frontend `useRemindReview` hook | No | — | M |
| G-P7 | Employee reviews: status filter + department | add `status` (WAITING/SUBMITTED/MISSED) param to `GET /v1/performance/reviews`; add `department` (and `reviewerType`) to the enrichment in `PerformanceController` | No | — | S |
| G-P8 | Goals & KPIs summary tiles | `GET /v1/performance/kpis/summary` → total, completed, reached %, average progress; `hrms.performance.read`; same scope as the list (`KpiAccessScope`) | No | — | S |
| G-P9 | Company KPIs + goal link + roll-up | new JDBC table `performance_mgmt.company_kpis` (tenant, company, title, target, unit, direction, due, status, RLS) + `goals.company_kpi_id UUID` (unmapped) + CRUD endpoints under `hrms.kpi.manage`, read under `performance.read`/`review.self` (for the goal form select); roll-up rule (Q1) | New table + new column | goals: yes (unmapped column) | L |
| G-P10 | Department on KPI rows (Goals at risk) | join `hrms.departments` in `KpiService.list` | No | — | S |
| G-P11 | Due date (+ KPI link) on self-created goals | extend `GoalRequest`; write `due_date` (exists since V122) and `company_kpi_id` by JDBC after the JPA save; return them in `GoalResponse` | No (due date) / G-P9 (link) | Yes (unmapped) | S |
| G-P12 | People status (Reviewed / Review due / On probation) | add `employmentStatus` and `pendingInOpenCycle` to `PerformanceEmployeeService` directory SQL | No | — | S |
| G-L1 | Programs summary (ongoing, enrollments this year) | `GET /v1/learning/programs/summary` (`learning.read`) | No | — | S |
| G-L2 | Program location | `training_programs.location VARCHAR(150)` (unmapped); read/write in the JDBC `apiLearningService` like `mode` | New column | Yes (unmapped) | S |
| G-L3 | Category list for the program form | `GET /v1/learning/programs/categories` (distinct categories) or keep free text with suggestions | No | — | S |
| G-L4 | Department on roster rows; program dates on My training | join employees/departments and program dates in `EnrollmentDto` | No | — | S |
| G-L5 | Company-wide certifications with expiry | `GET /v1/learning/certifications?status=all\|expiring\|expired&page` (`hrms.learning.skill.read`), join employee + department | No | — | S |
| G-L6 | Skill "Updated" date | add `updatedAt` to `EmployeeSkillResponse` (column exists) | No | — | S |
| G-L7 | Proficiency words | frontend label map once Q5 is decided (DB keeps 1–5; `ck_skill_assessment_level` 1–5) | No (unless levels change) | — | S |
| G-L8 | Certification name on a proposal | `skill_assessments.certification_name VARCHAR(200)`; applied to the skill on approval | New column | No (JDBC table) | S |
| G-E1 | Exit reason + department in exit lists | either include `exitReason` in list rows when the caller has `hrms.employee.write`, or a dedicated `GET /v1/hrms/employees/exits?status=` (employee.write) returning reason, department name and (with `fnf.read`) settlement status | No | — | S |
| G-E2 | F&F status per leaver + tab-specific link | `GET /v1/fnf/settlements/status?employeeIds=` (or `employeeId` filter on the list), `hrms.fnf.read`; frontend maps to `?tab=pending-approval\|pending-payment\|settled` | No | — | S |
| G-E3 | "Exited this year" | year (calendar or fiscal) filter on `/employees/counts` using last working day or `employee_status_history` | No | — | S |
| G-E4 | Exit tabs in the URL | `?tab=` + registry `tab('exit', …)` + `pageRegistry.test.ts` param map | No | — | S |
| G-R1 | Hero stats with deltas | headcount change from the workbook totals or a light `GET /v1/reports/headcount/change`; attrition delta client-side; **diversity `asOf`** param using `employee_status_history` (like headcount) | No | — | M |
| G-R2 | Tile mini charts | `GET /v1/reports/summary?companyId=` returning small series per report, each only with its own permission | No | — | M |
| G-R3 | Pin to dashboard | JDBC table `hrms.user_pinned_reports` (tenant, user, report_key, position; RLS) or a shared per-user UI-preferences table (the dashboard's "Customise quick actions" needs one too); `GET/PUT /v1/reports/pins` (any report code; only pins you can open); dashboard renders them (dashboard agent) | New table | No | M |
| G-R4 | Category + search filtering, "n of m reports" | frontend; search pill scoped to the page is shell work | No | — | S |
| G-R5 | New custom report | report-definition table(s), a field catalogue with a permission per field group, a query runner, export and schedule; no designed builder screen (Q3) | New tables | No | L |
| G-R6 | Schedules: every weekday / daily, send time, CSV attachment | replace `ck_report_schedules_frequency` (add DAILY/WEEKDAYS) and `ck_report_schedules_day`; add `send_hour SMALLINT`; `ReportScheduleJob` already runs hourly 07:05–23:05 IST; attach the server CSV next to the PDF | Constraint change + new column | No (JDBC table) | M |
| G-R7 | Workforce analytics tabs | `?tab=headcount\|attrition\|diversity`, each gated by its code; headcount trend endpoint `GET /v1/reports/headcount/trend?months=6` (`report.headcount`); fiscal-year period; annualised rate; per-tab download | No | — | M |
| G-M1 | WFH in My attendance (stat + day tag) | merge approved WFH (`/v1/wfh` my requests) client-side, or add WFH to `/attendance/history` and `/monthly-stats` | No | — | S |
| G-M2 | Approver on my leave requests / apply panel | add current approver (L1 or decided-by) name to `LeaveRequestResponse` | No | — | S |
| G-M3 | Comp-off lapse date | read `leave_mgmt.comp_off_balances.expires_on` (table exists, unused by code) into balances | No | — | S |
| G-X1 | Rating labels (all screens) | frontend map from the cycle scale (after G-P2) | No | — | S |

No new permission is strictly required. If the lead wants separate control, candidates are
`hrms.performance.remind` (else keep `hrms.performance.write`) and `hrms.report.pin` (else any report code).
Any new code must be granted to OWNER and SUPER_ADMIN in its migration.

---

## 5. Conflicts with today's behaviour or earlier client decisions

- **C1 Forms as in-page views vs side panels.** PgGrow opens every form as an in-page view with a back link.
  The README and Phase 7 say every pop-up becomes the shared square **SidePanel**/**Dialog**, and today these
  forms are `HrDrawer`s whose dialog names tests pin ("Create review cycle", "Create company KPI",
  "Start notice period"). Recommendation: use the shared SidePanel (keeps `role=dialog` and the names).
- **C2 Tabs move to top-bar pill tabs.** Today the tabs render inside the page (`Views`, aria-labels
  "Performance views", "Learning views"). Tests click them by those labels. Keep the aria-labels on the new pill
  tab list, or update the tests in the same change. Exit tabs are not in the URL yet.
- **C3 Button labels.** Design "New cycle", "Add goal" (admin), "Start notice period", "Propose a skill" (Skill
  matrix) vs today "Create cycle", "Create KPI", "Start notice", "Propose a skill" (My training). Tests pin
  "Create cycle", "Create KPI", "New program", "Add goal", "Start notice" (substring).
- **C4 Admin "Add goal" vs "Create KPI".** The design's admin form has no owner or target; today HR assigns a KPI
  to an owner with target, unit, direction, weight, due date and status (`hrms.kpi.manage`). Keep the KPI form;
  add the company-KPI link as a new field (G-P9).
- **C5 Rating input and labels.** Admin design: select 1–5 labelled Below / Needs support / Meets / Exceeds /
  Outstanding. Employee design (EmpGrowth): Tough / Mixed / Solid / Strong / Stand-out. Today: a free 0–5 decimal
  (stored `NUMERIC(3,1)`, existing ratings like 4.6). One label set is needed (Q4).
- **C6 "Shared" stage.** Implies employees see manager feedback only after HR shares it. Today "My reviews" shows
  submitted feedback about you immediately. Adding a gate changes who sees what (Q2).
- **C7 Skill approvals: inline Reject without a note.** The API refuses a rejection without a note (live-w2b
  asserts it) and today's UI asks for one. Keep the note (open a small note field on Reject).
- **C8 Skill levels.** Design uses 4 words; DB and API use 1–5 (`ck_skill_assessment_level`). Needs a mapping (Q5).
- **C9 Program mode.** Design: Online / Classroom / On site + a place. DB CHECK: IN_PERSON / ONLINE / HYBRID /
  SELF_PACED. Map Classroom and On site to IN_PERSON with a location (G-L2); keep Hybrid and Self-paced.
- **C10 "Propose a skill" placement.** In the design it's the Skill matrix main button, but that tab needs
  `hrms.learning.skill.read`, which employees don't hold. Show it wherever the person has `skill.assess.self`
  (keep My training → My skills).
- **C11 Certifications tab.** Design = everyone's list; today = one person's list with an add/update form for
  `learning.write`. Keep the editor (per person) and add the list (G-L5).
- **C12 Mark exited.** Design is one click; today a drawer asks the exit type, which drives the attrition split
  (resigned / terminated / other). Recommendation: one click when an exit type is already recorded, drawer
  otherwise. Keep the confirm on Withdraw notice (test clicks it).
- **C13 Exit types.** Design lists 4; the DB allows 7 (`ck_employees_exit_type`: + Absconding, Death, Other).
  Keep all 7.
- **C14 Things the design leaves out that exist today (keep them):** Reports Center company picker, the `?asOf=`
  note from the dashboard ("reports open on {date}"), Recent downloads (export log), schedule Send now / Edit /
  Delete, Workforce analytics department table and drill-down, PNG/PDF/CSV exports, cycle Assign reviews / Close
  cycle / progress drawer, KPI edit/drop/history, program detail page, per-person performance page, F&F and
  Profile links on exit rows.
- **C15 Reports hero art.** The hero uses `UtArt` (an empty "3D chart" image slot); no asset ships and the README
  says "No other imagery". Use a small live chart or the chart icon tile instead.
- **C16 "Updated 2 hr ago".** Reports are computed live; there is no refresh time. Show "Live" or the as-of date.
- **C17 Schedule copy.** "Sent automatically by email as PDF and CSV" and fixed times ("Every Monday, 09:00",
  "Every weekday, 11:00"): today PDF only, weekly or monthly, "in the morning, India time" (G-R6).
- **C18 My attendance / My leave for admins.** The prototype shows them in the HR admin's My workspace. Client
  rule: hidden for OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN (`useRoles().isAdmin`, `access.ts` `adminRole`,
  PlatformShell hides the whole ESS group). Keep the rule.
- **C19 "Time entries".** In `me-att` it means punches; in the repo "Daily time entries" (`ess/TimeEntries.tsx`)
  is a timesheet of work descriptions (EmpTime has a separate "Timesheet" tab). Keep both, name them apart.
- **C20 Workforce analytics becomes three tabs.** Today's single page (and its test) expects headcount, gender and
  attrition together ("Monthly attrition", "N people", "N exits ·").
- **C21 Nav labels.** Design: Performance, Learning, Reports center, Workforce analytics, Resignation & exit, Full &
  final settlement. Today: Performance Center, Learning & Skills, Reports Center, Workforce Analytics, Resignation &
  Exit, Full & Final Settlement. Tests pin "Learning & Skills" (employee nav) and the link "Workforce Analytics"
  (finance lead). URLs stay the same (DECISIONS §6).
- **C22 Employee "Growth" vs admin pages.** The employee persona gets Growth (Reviews & goals, Learning) instead of
  the Performance/Learning modules; today one route serves both through permission-driven tabs. Keep the URLs:
  Growth → `/hrms/performance?view=my-reviews|my-goals` and `/hrms/learning?view=my` (or EmpGrowth wraps the same
  hooks). The rail-highlight rule (`layouts/railLit.ts`) must keep the item the person came through lit.
- **C23 Calendar and dates.** The `me-att` month calendar must be built on `src/shared/components/calendar`
  (client decision), and every date field stays `DateField` (tests drive its "Choose date" dialog).
- **C24 Company pickers.** Cycle, program and report company pickers must keep `useCompanies()` (active companies
  only), not `useCompaniesWithArchived()` (Companies' Inactive view only).
- **C25 Existing menu/route mismatches** (worth fixing while here): `/hrms/exit` menu needs `employee.write` but the
  route opens with `employee.read`; `/hrms/learning` route also opens with `skill.approve`/`skill.assess.self` but
  the menu ignores them; the Skill matrix/Certifications picker needs `hrms.employee.read`, so a
  `skill.read`-only role can't pick anyone.
- Not affected here: settings stay in their sections (nothing in this area is a setting; the notice-period default
  stays in HR configuration); greeting rule (no greeting on these pages).

---

## 6. Shared components these screens need

From the README list: **PageHeader** (crumb, title, per-tab sub, main + secondary button, back link),
**PillTabs** (top bar, `?view=`/`?tab=`), **SearchPill** (Reports filters tiles by it), **StatCard** (a compact
variant: label, value, note, tone ok/warn/bad/info/gray, no sparkline, used by every `stats` section),
**Card/Section** (title, sub, count, right-side action, half/full width grid), **ListRow**, **StatusPill**
(tones ok/warn/bad/info/gray), **ApprovalRow** (Skill approvals: approve, reject-with-note, undo only while
possible), **SegmentedControl** (Employee reviews All/Waiting/Submitted; Reports All/People/Time), **FilterPills**,
**MonthCalendar** on the shared calendar (My attendance), **Meter/ProgressBar** (bars sections: ratings, KPIs,
my goals, used leave), **Avatar** (first table column "Name · sub"), **EmptyState** (every section has emptyT/
emptyS copy), **Skeleton**, **Toast**, **Popover/Menu** (Export/Download menus), **Dropdown with search**
(employee pickers), **SidePanel** (all create/edit forms, C1), **Dialog** (confirms: close cycle, drop KPI,
withdraw notice, leave program, cancel program, delete schedule), **FormField** (input, select, textarea, date,
number, toggle for the schedule switch).

A shared **section table** (first column avatar + name + sub, pill cells, per-row main/secondary actions,
optional segment filter, empty state, pagination) covers nearly every table in PgGrow; it should wrap the existing
`DataTable`/`TableCard` so paging and sorting keep working.

Page-specific pieces:
- **CycleStages** stepper (done/current/todo with meta lines and a note) for Review cycles.
- **RatingDistribution** (bars with tones) for "Ratings so far".
- **ReportTile** (icon, category chip, pin star, title, description, mini chart: bars/line/split, updated line,
  "Open →", tilt/spotlight motion) and **FeaturedAnalyticsCard** for PgReports.
- **ScheduleRow** (mail icon, name, recipients, when, switch).
- **ColumnChart** (monthly bars with value labels and legend) for "Headcount · last 6 months" and "Exits per
  month"; the existing `ReportKit` `BarsChart`/`TrendChart`/`DonutChart` should move onto tokens and be reused.
- **KeyValue card** (review detail, "about you", skill record summary) = today's `Facts`.

---

## 7. Risks

Live tests that assert today's markup on these pages (`apps/platform/e2e/recovery/`):
- `live-design-performance.mjs`: `[aria-label="Performance views"] button` names/count, "Create cycle", "Create
  KPI", `#goal-title`, "Add goal", goal `article` with a `slider` + "Save", "Progress saved". **Already stale**: it
  expects 5 views for owner/manager; the page has 6 since People was added.
- `performance-admin-live.mjs`: "Create KPI", labels "Find employee", "KPI title", "Target value", "Starting
  value", "Unit", "Save KPI", "Search KPI titles", "New current value", "Progress note", "Record progress", "Close
  panel", "Edit", native `Status` select, "Drop KPI"/"Confirm drop", "45 / 100 tasks"; "Create cycle", "Cycle
  name", `Period start/end` comboboxes, "Assign reviews (1)", "1 employees considered; 1 new reviews created.",
  "Close cycle"/"Confirm close cycle", "Missed"; `Review cycle` select, "View review"; heading "Create company
  KPI" within 40px of the left on a phone; no sideways scroll.
- `live-performance-scope.mjs`: text "Your team’s goals & KPIs", "You see your team…", button "Update progress".
- `live-w3-r4.mjs`: dialogs "Create review cycle" / "Create company KPI", "set both period dates" alert, `Due
  date` combobox; report `From`/`To`/`As of` comboboxes and the "Data as of" note.
- `live-design-learning.mjs`: `[aria-label="Learning views"]`, "New program", `#lp-title`, `#lp-cap`, "Create
  program", row combobox value `PLANNED`, "Roster", "Roster · 0 enrolled", "Whose skills?", nav text "Learning &
  Skills" for an employee, "Enroll", "You’re enrolled", "Leave" + `window.confirm`, "You’ve left". **Already
  stale**: expects 4 owner views and 2 manager views; Skill approvals (V143.21) makes 5 and 3.
- `live-w3-r3.mjs`: `#lp-start`, `#lp-end`, "Edit details", `#pe-start`, "Find employee", `#sk-on`, `#sk-exp`.
- `live-new-admin-browser.mjs`: "Learning views" → Certifications, "Find employee".
- `live-exit-center.mjs`: heading "Resignation & exit", `a[href="/hrms/exit"]` and `a[href="/hrms/fnf"]` in the
  nav, "On notice" button/tab, "Start notice", dialog label "Employee", role `option`, "Last working day",
  `#notice-reason`, toasts "is now serving notice" / "is active again", row "Withdraw notice" + confirm dialog.
- `live-w3-r2.mjs`: dialog "Start notice period", "Notice start date"/"Last working day" comboboxes,
  `input.utc-native` required, `#notice-employee-search`, "Start notice" disabled until valid.
- `live-employee-exit.mjs` (profile Exit tab, other agent): "Edit separation details", "Mark Employee as Exited",
  "Open full & final settlements" → `/hrms/fnf`.
- `live-design-reports.mjs`: Workforce analytics heading "Headcount by department", "Total headcount" card,
  `/\d+ exits ·/` readout, "N people", "Export" menu items "Departments (CSV)", "Data workbook", "Dashboard
  snapshot", button "Download chart as PNG", `.ut-bar-col` / `[title^="Open "]` drill-down; report headings
  "Headcount Report", "Attrition Report", "Diversity Report", "Attendance Summary", "Late Marks Report", "Leave
  Balance Report", table names, "No data for this period", "Raw rows (CSV)"; heading "Reports Center", card
  buttons, recent downloads rows; finance lead link "Workforce Analytics" and heading "Monthly attrition"; phone
  widths without sideways scroll.
- `live-w3-dashboard.mjs`: "View reports" → `/hrms/reports?asOf=`, note "reports open on {date}", card button
  `/^Headcount/`.
- `live-w3-analytics.mjs`: "Download report" on attendance analytics opens `/hrms/reports/attendance-summary`.
- `live-navigation.mjs`: rail buttons named "Performance", "Reports" (+ others) in `nav[aria-label="Primary"]`.
- `live-rail-highlight.mjs`, `live-w2h.mjs` (report export log/schedules API), `live-w2b.mjs`, `live-w1h.mjs`,
  `performance-authorization-live.mjs`, `live-module-workflows.mjs`, `live-tenant-isolation.mjs`, `live-api.mjs`:
  API-level; safe unless endpoints change.
- Playwright `e2e/tests/{hr-manager,finance-lead,super-admin}/07-reports.spec.ts`: report cards by text and each
  report page rendering without the load error.
- Unit: `src/shared/navigation/pageRegistry.test.ts` (tab param map), `src/layouts/railLit.test.ts`
  (`performance` rail key).

Other risks:
- Hard-coded colours and fonts on these pages break dark mode and the font rule: `Performance.tsx` (`#eef2f6`,
  `#059669`, weight 700), `Learning.tsx`, `ReportKit.tsx` (`SECTION`, weights 700/800), `ReportsIndex.tsx`,
  `WorkforceAnalytics.tsx` and its generated view, `ModuleKit` (`FONT = Inter`, `HEAD_FONT`). All need tokens and
  weights ≤600.
- `scripts/design-build.mjs` still lists `WorkforceAnalytics`; re-running it would regenerate the old view over a
  new one. Remove it from the script when the view is replaced.
- The cycle progress endpoint is N+1 (one query per reviewee); a stages card on a large cycle must use a new
  aggregate query (G-P4a).
- Wiring Remind to real notifications must keep the 24h throttle so reviewers aren't flooded.
- A "Shared" gate hides feedback employees can see today (data-visibility change).
- Schema changes (G-P1, G-P2, G-P4, G-P9, G-L2, G-L8, G-R3, G-R5, G-R6) are applied by hand in production later;
  each block must hide or show an empty state if its column/table is missing, and the constraint change in G-R6
  must be idempotent.
- The exit reason is sensitive ("Not shared with the employee"); only return it to `hrms.employee.write` holders.

---

## 8. Open questions (real ones only)

1. **Company KPIs.** Should we add company-level KPIs that people's goals link to (new table + a link on goals)?
   If yes, how does a KPI's progress roll up: the weighted average of its linked goals, or a value HR records
   by hand (as today's KPIs)?
2. **Review stages.** Do you want a real **calibration** step (HR adjusts final ratings before release) and a
   **"Shared"** gate that keeps manager reviews hidden from the employee until HR shares them? Today employees
   see submitted feedback straight away.
3. **"New custom report"** has no designed screen. Build a simple builder (pick a data set, pick columns from a
   permission-filtered list, filters, save, export, schedule), or hide the button until it is designed?
4. **Rating labels and precision.** Which labels: admin design (Below · Needs support · Meets · Exceeds ·
   Outstanding) or employee design (Tough · Mixed · Solid · Strong · Stand-out)? And keep decimal ratings like 4.6,
   or whole numbers only from now on (old decimals would still display)?
5. **Skill levels.** The design shows 4 words (Beginner, Intermediate, Advanced, Expert); records use 1 to 5.
   Map 1–5 to five words, or move to four levels (would need a data migration)?
