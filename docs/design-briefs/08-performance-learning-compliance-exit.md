# Performance, Learning, Compliance & Exit — page briefs

This group covers the four "after-hire" admin modules of UnifiedTree HRMS: appraisal cycles / goals / KPIs, training programs and skills, statutory compliance (calendar, filings, POSH, inspector links, plus the public inspection page), and separation (the Resignation & Exit list at `/hrms/exit`, the employee-record Exit tab, and full & final settlement). Sidebar groups: **Performance & Learning**, **Compliance**, **Employee Exit** (`layouts/PlatformShell.tsx` lines 159–191; the Employee Exit group has two leaves on two distinct routes, `/hrms/exit` and `/hrms/fnf`).
Role constants (PlatformShell.tsx 69–81): `R_HR` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER · `R_ADMIN` = R_HR + FINANCE_LEAD · `R_ADMIN_MGR` = R_ADMIN + DEPT_MANAGER · `R_FIN_RUPEE` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD · `R_ESS` = EMPLOYEE. Sidebar visibility is a role list OR `visibleWithAnyPermission`; the route itself is guarded by `RouteGuard anyOf=[permissions]` in `App.tsx`, and every page here also sits behind `ModuleGate` (module `hrms`, or `payroll` for F&F) which renders `ModuleNotActivated` when the tenant has not enabled the module.
All money is `'₹' + n.toLocaleString('en-IN')` (₹1,20,000); dates are `d MMM yyyy` (18 Sep 2026) unless a screen is flagged below as inconsistent.

---

## Performance Center  `/hrms/performance`
- **File:** `modules/hrms/Performance.tsx` + `modules/hrms/performance/{AdminCycles,AdminKpis,AdminReviews,PerformanceEmployeePicker}.tsx`; hooks `modules/hrms/api/usePerformance.ts`, `usePerformanceAdmin.ts`  ·  **Sidebar:** Performance & Learning › Performance Center  ·  **Roles:** sidebar `[...R_ADMIN_MGR, ...R_ESS, ...R_HR]` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, EMPLOYEE. Route: `RouteGuard anyOf ['hrms.performance.read','hrms.performance.write','hrms.performance.review.self']`, `ModuleGate hrms`.
- **Status:** LIVE — every tab calls a real hook (`GET /v1/performance/cycles`, `/reviews`, `/reviews/my`, `/goals/my`, `/kpis`, `/cycles/{id}/progress` …). Caveat: three of the eight tab labels are aliases that mount the same component twice (see Change).

### Purpose
One page for the whole appraisal loop. HR / admins create review cycles, assign reviewer types (self, manager, peer, skip-level, upward), track completion, read submitted reviews and maintain company KPIs with progress history. Employees (and managers as reviewers) see their own goals and the reviews assigned to them and submit ratings.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Performance Management", title "Performance Center", subtitle "Track goals, run review cycles, and manage performance reviews". No header actions.
2. `HrTabs` (permission-filtered). With `hrms.performance.read`: **Employee Performance · Appraisals & 360 Feedback · KPI Tracking · Review cycles · Goals & KPIs · Employee reviews**. With `hrms.performance.review.self`: **My Goals · My Reviews**. Default tab = "Review cycles" for readers, else first self tab. NOTE: "Employee Performance" renders `AdminReviews` (same as "Employee reviews"); "Appraisals & 360 Feedback" renders `AdminCycles` (same as "Review cycles"); "KPI Tracking" renders `AdminKpis` (same as "Goals & KPIs").
3. If no tab is allowed: `.ut-card` message "Your role does not have performance access."

#### Sub-view: Review cycles (`AdminCycles`)
1. Section heading "Review cycles" + subtitle "Create a period, assign reviewers, and track completion." + `HrButton` **Create cycle** (only `hrms.performance.write`).
2. `TableCard` › `DataTable` columns: **Cycle** (name as emerald link button, `CalendarRange` icon) · **Review period** (`periodStart → periodEnd`, raw `yyyy-MM-dd`, "Not set" fallback) · **Status** (`HrStatusPill` ACTIVE=ok, CLOSED=info, DRAFT=gray, lower-cased) · **Manage** (`HrButton ghost sm` "Assign reviews" when DRAFT and `hrms.appraisal.initiate`, else "View progress").
3. `HrDrawer` **Create review cycle** — body: intro text, Company `ut-select` (auto-selected when only one company), Cycle name (max 200, placeholder "e.g. September 2026 performance review"), Period start / Period end (date). Footer: Cancel (ghost) · **Create cycle** (primary).
4. `HrDrawer` **{cycle.name}** (`max-w-2xl`) — header: period + "Appraisal review cycle" + status pill; KPI trio in mint block: Assigned / Completed / Completion %; section "Assigned employees" = card per reviewee (`HrAvatar name sub=code`, "completed / total", list of reviewer name · reviewer type · status); section "Assign reviews" (only `hrms.appraisal.initiate` and not CLOSED): checkbox group **Reviewer types** (Employee self-review, Reporting manager, Department peers, Manager's manager, Direct reports (upward review)), "Peers per employee" select 1–10 (shown when PEER ticked), radio **Choose employees / All active employees in this company**, `PerformanceEmployeePicker` (server-searched, paged 10) + chips with × to remove, primary button **Assign reviews (n)** / **Assign to all active employees**; result banner "{n} employees considered; {m} new reviews created." + "{k} assignments skipped because eligible reviewers were unavailable." + "View skipped assignments" expander (paged list of employees with "No eligible reviewer: manager, peer…"); section **Close cycle** (ghost → inline confirm "Close this cycle? Pending reviews will be marked missed. The cycle cannot be reopened." with **Confirm close cycle** / Keep open) — only when ACTIVE.

#### Sub-view: Goals & KPIs (`AdminKpis`)
1. Section heading "Company goals & KPIs" + subtitle + `HrButton` **Create KPI** (only `hrms.kpi.manage`).
2. Inline filter row (not a `FilterBar` component): search input labelled "Search KPI titles" (placeholder "Search company goals"), Status select (All statuses / Active / At risk / Completed / Dropped).
3. `TableCard` › `DataTable` columns: **Goal / KPI** (title link + "category · due date" sub-line, en-IN date) · **Owner** (`HrAvatar name sub=ownerCode`) · **Current / target** (`{current} / {target} {unit}`, tabular-nums) · **Progress** (% + emerald bar) · **Status** (`HrStatusPill` ACTIVE=info, AT_RISK=warn, COMPLETED=ok, DROPPED=gray) · **Actions** ("Update progress" or "View history" ghost; "Edit" ghost when `hrms.kpi.manage`). Footer `HrPagination` with page-size selector (default 25).
4. `HrDrawer` **Create company KPI / Edit KPI** (`max-w-xl`) — `PerformanceEmployeePicker` for owner, KPI title (max 300), Description, Target value, Starting value (create only), Unit (placeholder "%, tasks, hours"), Weight 0–100, Category (max 40), Due date, Success measure select (Higher is better / Lower is better / Match the target), Status select (edit only). Footer: Cancel · **Save KPI**.
5. `HrDrawer` **KPI progress & history** (`max-w-xl`) — category eyebrow, title, "owner · code · due", description; mint block "Current / target" + % + status pill; card **Record progress** (New current value, Progress note, button **Record progress**) when `hrms.performance.write` and not DROPPED; section **Progress history** (timeline: "prev → new unit", %, en-IN timestamp, note); **Drop KPI** ghost → inline confirm ("Confirm drop" / "Keep KPI") when `hrms.kpi.manage`.

#### Sub-view: Employee reviews (`AdminReviews`)
1. Heading "Employee reviews" + subtitle "Read submitted feedback and track pending reviews. Assign reviewers from Review cycles."
2. Filter: Review cycle `ut-select` (All cycles + each cycle name).
3. `TableCard` › `DataTable` columns: **Employee** (`HrAvatar name sub=employeeCode`) · **Reviewer** (name or "Self review") · **Cycle** · **Rating** (`x / 5` or "Not submitted") · **Status** (`HrStatusPill` PENDING=warn, IN_PROGRESS=info, SUBMITTED=ok, ACKNOWLEDGED=teal, MISSED=red) · **Details** ("View review" ghost). Footer `HrPagination` (20/page).
4. `HrDrawer` **Employee review** — avatar, "Review cycle" label + name, status pill, mint block "Overall rating x / 5", **Strengths**, **Areas to improve** ("No feedback submitted." fallback), "Submitted {en-IN datetime}".

#### Sub-view: My Goals (`MyGoalsTab`)
1. KPI strip (3 × `HrStatCard`): **Total Goals** (blue, Target) · **Completed** (green) · **Avg Progress** (orange, `n%`).
2. Inline create card: Goal title (placeholder "e.g. Ship the billing revamp"), Description, Weight 0–100, `HrButton` **Add Goal**.
3. Goal cards (`.ut-card`): title, description, "Weight n", `HrStatusPill` (ACTIVE=info, AT_RISK=warn, COMPLETED=ok, DROPPED=gray). If the goal is a measured KPI (`targetValue` set): mint block "{current} / {target} {unit} · {progress}%" + "Your performance administrator records measured KPI updates." Otherwise a range slider 0–100 + value + `HrButton sm` **Save** (primary when dirty, ghost otherwise; disabled when DROPPED).
4. Empty: "No goals yet / Add your first goal above to start tracking progress."

#### Sub-view: My Reviews (`MyReviewsTab`)
1. Review cards (`.ut-card`): eyebrow cycle name, "{employeeName} ({code})", "Reviewer: {name}" or "Self review", "Opened {d MMM yyyy}", status pill.
2. When PENDING and the current user is the reviewer: form Overall rating (0–5, step 0.1), Strengths textarea, Areas to improve textarea, `HrButton` **Submit Review**. Otherwise read-only: "Awaiting the assigned reviewer's feedback." / rating with star / Strengths / Improvements.
3. Empty: "No reviews assigned / Your performance reviews will appear here once a cycle is opened."

### Data shown
- Cycles table: `useReviewCycles → GET /v1/performance/cycles` (`id, companyId, name, periodStart, periodEnd, status DRAFT|ACTIVE|CLOSED`).
- Cycle drawer: `useCycleProgress → GET /v1/performance/cycles/{id}/progress` (`totalAssignments, completedAssignments, overallPct, reviewees[{revieweeName, revieweeCode, assignments[{reviewerType, reviewerName, status}]}]`).
- Skipped assignments: `useEmployeesByIds` (workforce directory) resolved from the `skips[]` strings.
- KPIs table: `useAdminKpis → GET /v1/performance/kpis?search&status&page&size` (`items[], total`; row = `title, ownerName, ownerCode, currentValue, targetValue, unit, progressPct, status, category, dueDate`).
- KPI history: `useKpiHistory → GET /v1/performance/kpis/{id}/history` (`previousValue, newValue, progressPct, updatedAt, notes`).
- Reviews table: `useReviews → GET /v1/performance/reviews?cycleId&page&size=20` (Spring page `content/totalElements/totalPages`).
- My goals: `useMyGoals → GET /v1/performance/goals/my`. My reviews: `useMyReviews → GET /v1/performance/reviews/my`. Current user: `useCurrentUser` (employeeId used to decide who may submit).
- Employee picker: `useEmployeeDirectory → GET employee directory ?companyId&search&page&pageSize=10` (needs `hrms.employee.read`).
- Companies for Create cycle: `useCompanies`.
- Unused hooks in this file set (no caller): `usePerformanceDirectory → GET /v1/performance/employees`, `useActivateCycle → POST /cycles/{id}/activate`, `useCreateReview → POST /reviews`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tab: Employee Performance / Appraisals & 360 Feedback / KPI Tracking / Review cycles / Goals & KPIs / Employee reviews | `HrTabs` | switches tab (three are aliases of the other three) | `hrms.performance.read` | LIVE (aliases) |
| Tab: My Goals / My Reviews | `HrTabs` | switches tab | `hrms.performance.review.self` | LIVE |
| Create cycle | Review cycles heading | opens drawer **Create review cycle** | `hrms.performance.write` | LIVE |
| Create cycle (drawer footer) | drawer | `useCreateCycle → POST /v1/performance/cycles {companyId,name,periodStart,periodEnd}`; toast "Review cycle created. Assign reviews to begin." | `hrms.performance.write` | LIVE |
| Cancel | drawer footer | closes drawer (blocked while pending) | — | LIVE |
| Cycle name link / Assign reviews / View progress | row | opens **{cycle}** drawer | read (+`hrms.appraisal.initiate` for assign) | LIVE |
| Reviewer type checkboxes, Peers per employee, Choose employees / All active employees radios | cycle drawer | local form state | `hrms.appraisal.initiate` | LIVE |
| Pick employee (picker rows), remove chip × | cycle drawer | adds/removes from selection; picker paged via `HrPagination` | `hrms.employee.read` | LIVE |
| Assign reviews (n) / Assign to all active employees | cycle drawer | `useInitiateReviews → POST /v1/performance/cycles/{id}/initiate {employeeIds?, reviewerTypes, peerCount}`; toast "{n} reviews assigned"; activates a DRAFT cycle | `hrms.appraisal.initiate` | LIVE |
| View skipped assignments / Hide skipped assignments | result banner | toggles paged list (`useEmployeesByIds`) | `hrms.employee.read` | LIVE |
| Close cycle → Confirm close cycle / Keep open | cycle drawer | `useCloseCycle → POST /v1/performance/cycles/{id}/close`; toast "Cycle closed. {n} pending reviews marked missed." | `hrms.appraisal.initiate`, cycle ACTIVE | LIVE |
| Create KPI | Goals & KPIs heading | opens drawer **Create company KPI** | `hrms.kpi.manage` | LIVE |
| Search KPI titles / Status filter | toolbar | refetch with `search`, `status`, page reset | read | LIVE |
| Goal title link / Update progress / View history | row | opens **KPI progress & history** drawer | read (write for progress) | LIVE |
| Edit | row | opens **Edit KPI** drawer | `hrms.kpi.manage` | LIVE |
| Save KPI | KPI drawer footer | `useSaveKpi → POST /v1/performance/kpis` or `PUT /v1/performance/kpis/{id}`; toast "KPI created/updated" | `hrms.kpi.manage` | LIVE |
| Record progress | KPI details drawer | `useRecordKpiProgress → PUT /v1/performance/kpis/{id}/progress {newValue, notes}`; toast "Progress recorded" | `hrms.performance.write`, not DROPPED | LIVE |
| Drop KPI → Confirm drop / Keep KPI | KPI details drawer | `useDropKpi → DELETE /v1/performance/kpis/{id}`; toast "KPI dropped"; closes | `hrms.kpi.manage` | LIVE |
| Page size / pagination | KPI table footer | `HrPagination` (25 default, size selector) | read | LIVE |
| Review cycle filter | Employee reviews | refetch `GET /reviews?cycleId` | read | LIVE |
| View review | row | opens **Employee review** drawer (read-only) | read | LIVE |
| Add Goal | My Goals inline form | `useCreateGoal → POST /v1/performance/goals {title, description?, weight?}`; toast "Goal added" | `hrms.performance.review.self` | LIVE |
| Progress slider + Save | goal card | `useUpdateGoalProgress → PUT /v1/performance/goals/{id}/progress`; toast "Progress updated" | self, goal not DROPPED / not measured | LIVE |
| Submit Review | my-review card | `useSubmitReview → POST /v1/performance/reviews/{id}/submit {overallRating, strengths?, improvements?}`; toast "Review submitted" | reviewer of that review (`reviewerId ?? employeeId === me`) | LIVE |
| Try again | any error block | `refetch()` | — | LIVE |

### States
- loading: `HrStatCard loading`, `DataTable loading`, pulsing `.ut-card` placeholders (3), "Loading cycle progress...", "Loading history...", "Loading employees..." (picker), "Loading employee details..." (skipped list), "Loading companies..." (Create cycle company select option).
- empty: "No review cycles yet. Create a cycle to begin." · "No company KPIs yet. Create a target to start tracking progress." / "No KPIs match these filters." · "No employee reviews in this selection." · "No goals yet" · "No reviews assigned" · "No employee reviews assigned to this cycle yet." · "No progress updates recorded yet." · "No employees match this search."
- error: `PerformanceError` red alert with message + "Try again".
- no-permission: "Your role does not have performance access." (no tabs); picker: "Employee directory access is required to choose an owner."; skipped list: "Employee directory permission is required to see the affected employees."
- special: CLOSED cycle hides Assign section; DROPPED KPI hides progress form and Drop; measured goals (targetValue) are read-only for the employee; "All active employees" scope warns it activates a draft cycle.

### Rules & permissions
- `hrms.performance.read` → admin tabs; `hrms.performance.write` → Create cycle, Record KPI progress; `hrms.appraisal.initiate` → Assign / Close cycle; `hrms.kpi.manage` → Create/Edit/Drop KPI; `hrms.performance.review.self` → My Goals / My Reviews; `hrms.employee.read` → employee picker.
- Cycle: company, name, both dates required; end ≥ start. Existing assignments are kept on re-initiate; employees without an eligible reviewer are skipped; peers are drawn from the same department. Close marks PENDING reviews MISSED and cannot be reopened.
- KPI: owner + title required; target > 0; current ≥ 0; weight integer 0–100. Progress value ≥ 0.
- Goal: title required; weight integer 0–100. Review rating 0–5. Only the assigned reviewer (or the employee for a self review) can submit; others see "Awaiting the assigned reviewer's feedback."
- Tenant/company scoping: cycles carry `companyId`; the picker is scoped to the cycle's company.

### Gaps & plan  (keep / add / change)
- **Keep:** cycle → assign → progress → close flow; KPI history drawer; self goals with slider; permission-filtered tabs; server-searched employee picker (never truncates at 200).
- **Add:** [BLUEPRINT §6 row 35/36, §17] "Employee Performance" as a real per-employee directory view — the hook `usePerformanceDirectory → GET /v1/performance/employees` (columns employeeName, employeeCode, department, overallRating, scorePct, lastReviewCycleName, lastReviewStatus) exists in `usePerformance.ts` with no caller [code]. · [BLUEPRINT §6 row 36 "initiate/progress/close/remind"; PLAN §14 "Expose initiate/close/progress/remind"] appraisal admin "remind" action — no hook in `usePerformance.ts`/`usePerformanceAdmin.ts` and no UI. · [code: `useActivateCycle`, `useCreateReview` in usePerformance.ts have no UI] explicit "Activate cycle" and "Create single review" actions. · [BLUEPRINT §7 target IA] separate routes `/hrms/performance/appraisals` and `/hrms/performance/kpis` instead of tabs. · [BLUEPRINT §22 Manager Experience "Team Performance — goals, KPIs, reviews"; §23 J8] manager "Team Performance" view.
- **Change:** collapse the three duplicate tabs (Employee Performance = Employee reviews, Appraisals & 360 Feedback = Review cycles, KPI Tracking = Goals & KPIs) into three tabs, or give the aliases distinct content. · Review-period column shows raw `2026-09-01 → 2026-09-30`; format as `1 Sep 2026 → 30 Sep 2026`. · Status pills show lower-case enum ("active", "at risk") rather than HR wording ("Active", "At risk"). · KPI filter row is hand-rolled; use `FilterBar` inside `TableCard`. · `HrPageHeader` has no actions — move **Create cycle** / **Create KPI** to the header actions slot of the active tab. · My Goals create form is an always-open inline card; consider `HrDrawer` for consistency with the admin tabs.

### Screenshot
`Attach: /hrms/performance — current screen`

### Claude Design prompt (ready to paste)
```
Design the Performance Center page (/hrms/performance) for HR admins (OWNER/COMPANY_ADMIN/HR_MANAGER), department managers and employees.
Use HrPageHeader crumb "Performance Management", title "Performance Center", tabs (HrTabs with badge counts): Review cycles · Goals & KPIs · Employee reviews · My Goals · My Reviews — drop the three duplicate alias tabs. Put the tab's primary action in the header actions slot: "Create cycle" (Review cycles), "Create KPI" (Goals & KPIs), "Add Goal" (My Goals).
Review cycles: TableCard › DataTable columns Cycle · Review period ("1 Apr 2026 → 30 Sep 2026") · Status (HrStatusPill draft=gray, active=ok, closed=info) · Manage ("Assign reviews" / "View progress"). Row opens HrDrawer max-w-2xl "{cycle name}" with a 3-cell mint summary Assigned 42 / Completed 31 / Completion 74%, an "Assigned employees" list (HrAvatar name + EMP-0142, "3 / 4", reviewer lines "Priya Nair · manager · submitted"), an "Assign reviews" section (checkboxes Employee self-review, Reporting manager, Department peers + "Peers per employee" 1–10, Manager's manager, Direct reports; radio Choose employees / All active employees; searchable paged employee picker with removable chips; primary "Assign reviews (5)") and a "Close cycle" ghost with inline confirm.
Goals & KPIs: FilterBar (search "Search company goals", Status All/Active/At risk/Completed/Dropped) inside TableCard; DataTable columns Goal / KPI (title + "Sales · due 31 Mar 2027") · Owner (HrAvatar EMP-0142) · Current / target ("42 / 60 tickets", "78 / 95 %" — plain number + unit, tabular-nums; KPIs are not rupee amounts) · Progress (% + bar) · Status · Actions (Update progress · Edit). Drawers: "Create company KPI" (owner picker, title, description, target, starting value, unit, weight, category, due date, success measure) and "KPI progress & history" (record value + note, timeline "40 → 48 tickets · 80% · 18 Sep 2026, 10:42", "Drop KPI" with inline confirm).
Employee reviews: cycle select filter; DataTable Employee · Reviewer · Cycle · Rating "4.2 / 5" · Status (pending=warn, submitted=ok, acknowledged=teal, missed=red) · "View review" → read-only HrDrawer with rating, Strengths, Areas to improve.
My Goals: KPI strip HrStatCard Total Goals / Completed / Avg Progress 64%; goal cards with slider + Save; measured KPI goals read-only. My Reviews: cards with rating 0–5, Strengths, Areas to improve, "Submit Review".
States: TableSkeleton while loading; EmptyState "No review cycles yet. Create a cycle to begin." / "No company KPIs yet." / "No goals yet"; red error block with "Try again"; no-access card "Your role does not have performance access."
Keep: assign → progress → close flow, KPI history, server-searched picker. Add: an "Employee Performance" directory tab (columns Employee · Department · Latest rating · Score % · Last cycle · Status). Change: HR-cased status labels, formatted dates, header-level primary actions.
```

---

## Learning Center  `/hrms/learning`
- **File:** `modules/hrms/Learning.tsx`; hook `modules/hrms/api/useLearning.ts`; reuses `performance/PerformanceEmployeePicker.tsx`  ·  **Sidebar:** Performance & Learning › Learning & Skills  ·  **Roles:** sidebar `R_HR` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER) or anyone holding `hrms.learning.skill.read`. Route: `RouteGuard anyOf ['hrms.learning.read','hrms.learning.write','hrms.learning.enroll.self','hrms.learning.skill.read']`, `ModuleGate hrms`. NOTE: EMPLOYEE / DEPT_MANAGER hold `hrms.learning.read` + `enroll.self` (V073) and can open the route, but have no sidebar entry.
- **Status:** LIVE — programs, enrollments, bulk enrol, complete/drop, skills and certifications all call `/v1/learning/*`.

### Purpose
HR schedules training programs, enrols staff, marks completion with a score, and maintains each employee's skill / certification record. Employees browse the catalogue, self-enrol, leave a program and see their own skills.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Learning & Development", title "Learning Center", subtitle "Run training programs, track enrollments, and map team skills". No actions.
2. `HrTabs` (permission-filtered): **Programs** (`hrms.learning.read`) · **My Training** (`hrms.learning.enroll.self`) · **Skill Matrix** (`hrms.learning.skill.read`) · **Certifications** (`hrms.learning.skill.read`). Lands on the first allowed tab.
3. No-access card: "No access to Learning / Ask your administrator to grant a Learning permission."

#### Sub-view: Programs
1. KPI strip 4 × `HrStatCard`: **All programs** (blue, total from server) · **Ongoing on this page** (orange) · **Completed on this page** (green) · **Enrollments on this page** (teal).
2. Right-aligned `HrButton` **New Program** (toggles to ghost "Close") — `hrms.learning.write`.
3. Inline create card "New Training Program": Program Title * (placeholder "e.g. Advanced React Workshop"), Category, Trainer, Start Date, End Date, Capacity (placeholder "Unlimited"), Description; footer **Create Program**.
4. `TableCard` › `hr-table` columns: **Program** (title; for writers it is an expander button with chevron; category sub-line) · **Trainer** · **Schedule** (`18 Sep 2026 → 20 Sep 2026`) · **Seats** (`enrolled / capacity`) · **Status** (writers see a `ut-select` limited to `ALLOWED_TRANSITIONS`; others `HrStatusPill` PLANNED=info, ONGOING=warn, COMPLETED=ok, CANCELLED=red) · **Action** (`HrButton sm` **Enroll** / disabled **Full** for `enroll.self`, hidden when COMPLETED/CANCELLED). Footer `HrPagination` 20/page.
5. Expanded row → **Program roster** (writers only): "Enrolled employees · n active · n seats left"; `hr-table` Employee (`HrAvatar`) · Status pill · Score (input 0–999.99 for open rows, else value) · Completed date · Action (**Complete**, **Drop** ghost); below, card **Enrol employees**: search "Search name or code…", checkbox list of directory candidates not already seated, "{n} selected", `HrButton sm` **Enrol selected**. Closed programs show "This program is COMPLETED — no further enrollments are accepted."

#### Sub-view: My Training
1. KPI strip 3 × `HrStatCard`: **Enrolled Programs** (blue) · **In Progress** (orange) · **Completed** (green).
2. `TableCard` › `hr-table`: Program · Status pill · Score · Completed · Action (**Leave** ghost, open rows only).
3. `.ut-card` **My Skills** panel: list of skillName, certification badge (`Award` icon + name + `certifiedOn`), proficiency bar `n/5`. Empty: "No skills recorded for you yet. HR maintains this from the Skill Matrix."

#### Sub-view: Skill Matrix / Certifications (same component, `certificationsOnly` flag)
1. `.ut-card` with `PerformanceEmployeePicker` ("Find employee", server-paged 10 rows, "Selected: …").
2. (Skill Matrix only) `.ut-card` "Skill proficiency: {name}" — bar chart list of skills `n/5`.
3. (writers) `.ut-card` "Add / update skill for {name}": Skill name (max 120, "e.g. TypeScript"), Proficiency (1–5 select), **Certified** checkbox (forced on in Certifications), Certification name (max 200, "e.g. AWS Solutions Architect"), Certified on (date), Certification expiry (date, min = certified on); footer **Save Skill**.
4. `TableCard` › `hr-table`: Skill · Proficiency (bar + `n/5`) · Certification (`Award` + name + "Expires 31 Dec 2026" / red "Expired 1 Jan 2026" + certified date, or "Not certified") · Action (**Edit** ghost — prefills the form).

### Data shown
- Programs: `useTrainingPrograms(page) → GET /v1/learning/programs?page&size=20` (wire `items/total`, normalised) — `title, category, trainer, startDate, endDate, capacity, status, enrolledCount, companyId`.
- Roster: `useProgramEnrollments → GET /v1/learning/programs/{id}/enrollments` (`employeeName, status, score, completedAt`); candidates `useEmployeeDirectory {companyId, search, pageSize:200}`.
- My Training: `useMyEnrollments → GET /v1/learning/enrollments/me` (`programTitle, status, score, completedAt`); `useMySkills → GET /v1/learning/skills/me`.
- Skill Matrix: `useEmployeeSkills(employeeId) → GET /v1/learning/skills/{employeeId}` (`skillName, proficiency, certified, certificationName, certifiedOn, expiresOn`).
- Companies: `useCompanies` (create uses `companies[0].id`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tabs Programs / My Training / Skill Matrix / Certifications | `HrTabs` | switch | per permission above | LIVE |
| New Program / Close | Programs toolbar | toggles inline create form | `hrms.learning.write` | LIVE |
| Create Program | inline form | `useCreateProgram → POST /v1/learning/programs {companyId: companies[0], title, category?, trainer?, startDate?, endDate?, capacity, description?}`; toast "Training program created" | `hrms.learning.write` | LIVE |
| Program title (expander) | row | shows/hides roster for that program (one at a time) | `hrms.learning.write` | LIVE |
| Status select | row | `useChangeProgramStatus → PUT /v1/learning/programs/{id} {status}` (PLANNED→ONGOING/CANCELLED, ONGOING→COMPLETED/CANCELLED); toast "Status updated" | `hrms.learning.write` | LIVE |
| Enroll / Full | row | `useEnroll → POST /v1/learning/programs/{id}/enroll`; toast "Enrolled successfully"; disabled when capacity reached | `hrms.learning.enroll.self` | LIVE |
| Score input | roster row | local state, submitted with Complete | write | LIVE |
| Complete | roster row | `useCompleteEnrollment → POST /v1/learning/enrollments/{id}/complete {score|null}`; toast "Marked complete · score 8.5" | write | LIVE |
| Drop | roster row | `window.confirm("Drop {name} from “{program}”? …")` → `useAdminDropEnrollment → POST /v1/learning/enrollments/{id}/admin-drop` | write | LIVE |
| Search employees to enrol / checkboxes | roster card | filters server directory, toggles picked | write + `hrms.employee.read` | LIVE |
| Enrol selected | roster card | `useBulkEnroll → POST /v1/learning/programs/{id}/enrollments/bulk {employeeIds}`; toast "3 enrolled · 1 already enrolled · 2 rejected — program full" (error tone when 0 enrolled) | write | LIVE |
| Pagination | Programs footer | `HrPagination` 20/page | read | LIVE |
| Leave | My Training row | `window.confirm("Leave “{program}”? …")` → `useDropEnrollment → POST /v1/learning/enrollments/{id}/drop`; toast "You have left the program" | `enroll.self` (own rows only, server-enforced) | LIVE |
| Find employee (picker) + pagination | Skill Matrix / Certifications | `useEmployeeDirectory` search, selects employee | `hrms.employee.read` | LIVE |
| Certified checkbox | skill form | reveals certification fields | write | LIVE |
| Save Skill | skill form | `useUpsertSkill → POST /v1/learning/skills {employeeId, skillName, proficiency, certified, certificationName?, certifiedOn?, expiresOn?}`; toast "Skill saved" | `hrms.learning.write` | LIVE |
| Edit | skill row | prefills the form with that skill | write | LIVE |
| Try again / Retry | error blocks | refetch | — | LIVE |

### States
- loading: `HrStatCard loading`; pulsing table rows; roster skeleton bar.
- empty: "No training programs yet / Use “New Program” to schedule your first training." (reader variant: "Programs scheduled by HR will appear here.") · roster "Nobody has enrolled yet. Use “Enrol employees” below to add them." · candidates "No employees match that search." / "No employees in this company." / "Everyone matching is already enrolled." · "You are not enrolled in any training / Enroll from the Programs tab to start learning." · "No skills recorded for this employee yet." · "No recorded skills." · My Skills empty card.
- error: "Training programs could not be loaded. Try again" (alert card rendered *above* the table, which still shows the "No training programs yet" empty row); roster "Couldn't load the enrollment list. Try again"; skills alert with message + Retry. `useMyEnrollments` and `useMySkills` have no error branch — My Training silently shows "You are not enrolled…" / the empty My Skills card on failure.
- no-permission: "No access to Learning"; picker "Employee directory access is required to choose an owner."
- special: program Full (button disabled, label "Full"); closed program hides Enroll and enrol card; DROPPED employees can be re-enrolled; expired certification shown in red.

### Rules & permissions
- `hrms.learning.read` (catalogue, held by every employee) vs `hrms.learning.write` (create/status/roster/skills) vs `hrms.learning.enroll.self` (self enrol/leave, own skills) vs `hrms.learning.skill.read` (V116 — colleagues' skills & certifications; deliberately narrower than read to avoid leaking scores company-wide).
- Program status transitions limited to `ALLOWED_TRANSITIONS`; COMPLETED/CANCELLED terminal. Score 0–999.99, two decimals (NUMERIC(5,2)). Bulk enrol returns counts (enrolled / alreadyEnrolled / rejectedForCapacity), never throws. Self-drop is IDOR-guarded server side (ENROLLMENT_NOT_OWN).
- Skill: name required; proficiency 1–5; expiry ≥ certified-on (V131). Creating a program silently uses the first company (no company selector).

### Gaps & plan  (keep / add / change)
- **Keep:** roster with complete/score/drop/bulk-enrol; transition-limited status select; My Skills panel; certification expiry highlighting; server-searched pickers.
- **Add:** [BLUEPRINT §6 rows 38–40 "Promote to own view"; §17 and PLAN §14 "six reference concepts hide behind two sidebar leaves"] promote Skill Matrix, Training Programs and Certifications to their own views. NOTE: the target IA in BLUEPRINT §7 keeps a single leaf "Skills & Training → /hrms/learning", so "own view" means distinct, directly linkable views (tabs with URL state at minimum), not necessarily new sidebar leaves. · [code: `useTrainingProgram(id)` has no caller] a program detail drawer (description, trainer, schedule, capacity) — description is captured on create but never shown anywhere. · [code: `create.mutateAsync({ companyId: companies[0]?.id })`] company selector on New Program for multi-company tenants. · [BLUEPRINT §6 row 40] certification completion view across the company (today Certifications requires picking one employee at a time).
- **Change:** New Program is an inline toggle card — use `HrDrawer` with footer Cancel/Create. · Drop / Leave use `window.confirm` — use `useConfirmDialog()`. · Status is an unstyled `ut-select` in the table for writers; keep the `HrStatusPill` and move transitions to a row action. · Roster "Enrol employees" pulls up to 200 directory rows — paginate like the performance picker. · Three "on this page" KPI labels are honest but awkward; either aggregate server-side or drop them. · Skill Matrix duplicates the proficiency list (bar chart card + table) — keep one.

### Screenshot
`Attach: /hrms/learning — current screen`

### Claude Design prompt (ready to paste)
```
Design the Learning Center page (/hrms/learning) for HR admins (OWNER/COMPANY_ADMIN/HR_MANAGER) with an employee self-service view.
HrPageHeader crumb "Learning & Development", title "Learning Center", tabs Programs · My Training · Skill Matrix · Certifications; header action "New Program" (HrButton primary) on the Programs tab opening an HrDrawer (Program title, Company, Category, Trainer, Start date, End date, Capacity "Unlimited", Description; footer Cancel / Create Program).
Programs: KPI strip HrStatCard All programs 14 · Ongoing 3 · Completed 9 · Enrollments 212. TableCard › DataTable columns Program (title + category sub-line, expandable) · Trainer · Schedule "18 Sep 2026 → 20 Sep 2026" · Seats "18 / 25" · Status (HrStatusPill planned=info, ongoing=warn, completed=ok, cancelled=red) · Action ("Enroll" / disabled "Full"; writers get a row menu Start / Complete / Cancel). Expanded roster: "Enrolled employees · 18 active · 7 seats left"; rows HrAvatar "Ananya Rao" (enrollment rows carry employeeName only, no employee code) · Status · Score input (0–999.99) · Completed "20 Sep 2026" · Complete / Drop; below it an "Enrol employees" card with search, checkbox list, "3 selected", "Enrol selected".
My Training: HrStatCard Enrolled Programs / In Progress / Completed; table Program · Status · Score "8.5" · Completed · "Leave"; a "My Skills" card listing skill + Award badge "AWS Solutions Architect · 12 Mar 2026" + proficiency bar 4/5.
Skill Matrix & Certifications: employee picker card ("Find employee", paged results "Rahul Verma · EMP-0093 · rahul@…"), then a form card "Add / update skill for Rahul Verma" (Skill name, Proficiency 1–5, Certified checkbox → Certification name, Certified on, Certification expiry) and a TableCard Skill · Proficiency (bar + 4/5) · Certification ("Expires 31 Dec 2026" / red "Expired 1 Jan 2026" / "Not certified") · Edit.
States: skeleton rows; EmptyState "No training programs yet" / "Nobody has enrolled yet." / "You are not enrolled in any training" / "No skills recorded for this employee yet."; alert with Try again; no-access card "No access to Learning".
Keep the roster and bulk-enrol; add a program detail drawer showing the description; change confirms to ConfirmDialog instead of window.confirm.
```

---

## Statutory Compliance  `/hrms/compliance`
- **File:** `modules/hrms/Compliance.tsx` + `compliance/FilingCalendar.tsx`, `compliance/InspectorSessions.tsx`, `compliance/InspectionFiles.tsx`; hook `modules/hrms/api/useCompliance.ts`  ·  **Sidebar:** Compliance › Statutory Compliance  ·  **Roles:** sidebar `R_ADMIN` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD) or `hrms.compliance.inspector.read`. Route: `RouteGuard anyOf ['hrms.compliance.read','hrms.compliance.write','hrms.compliance.posh','hrms.compliance.inspector.read']`, `ModuleGate hrms`.
- **Status:** LIVE — items, filings, POSH, calendar events, inspector sessions and documents all hit `/v1/compliance/*`.

### Purpose
The compliance officer / HR admin tracks statutory obligations (PF, ESI, TDS, PT, gratuity returns), records when each filing was made with its challan reference, keeps the confidential POSH complaints register, and issues time-boxed read-only inspection links (with optional shared PDFs) to government inspectors or auditors.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Compliance", title "Statutory Compliance", subtitle "Compliance calendar, statutory filings, and the POSH register". No actions.
2. Row: `HrTabs` **Compliance Calendar · Statutory Filings** (`compliance.read` or `.write`) · **POSH** (`compliance.posh`) · **Inspector View** (`compliance.read` or `compliance.inspector.read`) + right-aligned Company `ut-select ut-select-sm` (only when the tenant has > 1 company). Page is `max-w-5xl`.
3. No-access card: "No compliance access for this role / Ask an administrator to grant a Compliance permission."

#### Sub-view: Compliance Calendar (`CalendarTab` + `FilingCalendar`)
1. KPI strip 3 × `HrStatCard`: **Pending** (orange) · **Overdue** (red) · **Completed** (green) — sub "On this page" when paginated.
2. (writers) inline add card: Obligation * ("e.g. PF monthly return"), Category ("e.g. Statutory"), Due date * (default today), Frequency ("e.g. Monthly"), Owner `ut-select` (Unassigned + directory names "(EMP-0142)"; disabled with "Cannot browse employees" when no `hrms.employee.read`), `HrButton` **Add**.
3. `TableCard` › `hr-table`: Obligation · Category · Owner · Due (`d MMM yyyy`) · Status (`HrStatusPill` PENDING=warn, DONE=ok, OVERDUE=red) · Action (**Mark done** ghost, hidden when DONE). Footer `hrPaginationFooter` (50/page, size selector).
4. `.ut-card` **Filing calendar** section: heading "September 2026", ghost buttons **Previous month · Today · Next month**; 7-column day grid (Sun–Sat), each day a button showing "n due"; selected-day toggle; list "Deadlines on 2026-09-18 · 3" / "This month · 12" with **Show month** link; rows title, "date · category/type", status pill (DONE/FILED=ok, OVERDUE/LATE=red, else warn). Empty: "No recorded deadlines for this period."

#### Sub-view: Statutory Filings (`FilingsTab`)
1. (writers) inline add card: Type select (PF, ESI, TDS, PT, GRATUITY, OTHER), Period ("e.g. 2026-05"), Amount (₹), Due date *, `HrButton` **Add Filing**.
2. `TableCard` › `hr-table`: Type (`HrStatusPill info`) · Period · Amount (`inr`) · Due · Filed · Reference · Status (`HrStatusPill` DUE=warn, FILED=ok, LATE=red) · Action (**Mark filed** primary sm, DUE rows only). Footer pagination 50/page.

#### Sub-view: POSH (`PoshTab`)
1. Mint notice banner with `ShieldAlert`: "This register is confidential. Record only what is necessary and handle every entry in line with your POSH policy."
2. Inline add card: Filed date * (default today), Severity select (LOW, MEDIUM, HIGH, CRITICAL; default MEDIUM), Description ("Brief, factual summary"), `HrButton` **Register**.
3. `TableCard` › `hr-table`: Complaint # · Filed · Severity · Status (`HrStatusPill` RECEIVED=info, UNDER INQUIRY=warn, RESOLVED=ok, DISMISSED=gray) · Resolved · Action (`ut-select` "Update status…" listing the other statuses; closed rows show "Closed"). Footer pagination.
4. `PoshDenied` card (lock icon) "Restricted area / The POSH complaints register holds sensitive information…" if the tab is somehow reached without the permission.

#### Sub-view: Inspector View (`InspectorSessions` + `InspectionFiles`)
1. `.ut-card` intro: "Share time-limited, read-only access to this company's compliance deadlines and filing status. Access stops when the session expires or is revoked."
2. (writers) `.ut-card` 2-column form: Inspector name *, Organisation, Audit purpose *, Expires at (within 7 days) * (`datetime-local`), `HrButton` **Create inspection link**.
3. `.ut-card` **Inspection link** (after create / Get link): read-only input with the `…/inspection#token` URL (select-all on focus), link **Open read-only inspection** (new tab), note "Anyone with this link can view the shared compliance information until access ends."
4. `.ut-card` **Documents shared with this inspection** (when a session's Documents is toggled): note text; form Document title * (max 200), PDF (up to 5 MB) file input, **Share PDF**; list "title (123 KB)" with **Unshare** ghost. Empty: "No documents shared."
5. `TableCard` › `hr-table`: Audit (purpose) · Inspector (name + org sub-line) · Expires (`toLocaleString()`) · Last opened (`toLocaleString()` or "Not opened") · Status (`HrStatusPill` ACTIVE=ok else gray) · Actions (ACTIVE rows: **Get link · Documents · Revoke** ghost). `HrPagination` 20/page below the card.

### Data shown
- Items: `useComplianceItems → GET /v1/compliance/items?companyId&page&size=50` (`title, category, ownerName, dueDate, status`). Owner options: `useEmployeeDirectory {companyId, pageSize:100}` (needs `hrms.employee.read`).
- Filing calendar: `useQuery → GET /v1/compliance/calendar-events?companyId&from&to` (`title, type, date, status, category`) for the visible month.
- Filings: `useStatutoryFilings → GET /v1/compliance/filings?companyId&page&size` (`filingType, period, amount, dueDate, filedDate, referenceNo, status`).
- POSH: `usePoshComplaints → GET /v1/compliance/posh?companyId&page&size` (`complaintNo, filedDate, severity, status, resolvedDate`).
- Inspector sessions: `GET /v1/compliance/inspector-sessions?companyId&page&size=20` (`inspectorName, inspectorOrg, purpose, status, expiresAt, lastAccessedAt`). Documents: `GET /v1/compliance/inspector-sessions/{id}/documents` (`title, sizeBytes`).
- Companies: `useCompanies`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tabs Compliance Calendar / Statutory Filings / POSH / Inspector View | `HrTabs` | switch (permission-filtered) | see layout | LIVE |
| Company select | header row | scopes every tab to `companyId`; resets page | any | LIVE |
| Add (obligation) | Calendar add card | `useCreateComplianceItem → POST /v1/compliance/items {companyId, title, category?, dueDate, frequency?, ownerId?}`; toast "Compliance item added" | `hrms.compliance.write` | LIVE |
| Mark done | Calendar row | `useMarkComplianceDone → POST /v1/compliance/items/{id}/done`; toast "Marked done" | write, status ≠ DONE | LIVE |
| Page / page size | Calendar, Filings, POSH footers | `hrPaginationFooter` (50 default) | read | LIVE |
| Previous month / Today / Next month | Filing calendar | refetch `calendar-events` for the new month; clears selection | read | LIVE |
| Day cell | Filing calendar | toggles day filter ("Deadlines on 2026-09-18 · n") | read | LIVE |
| Show month | Filing calendar | clears day filter | read | LIVE |
| Retry | Filing calendar error | refetch | read | LIVE |
| Add Filing | Filings add card | `useCreateFiling → POST /v1/compliance/filings {companyId, filingType, period?, amount, dueDate}`; toast "Filing scheduled" | write | LIVE |
| Mark filed | Filings row | `window.prompt("Challan / acknowledgement reference (optional):")` (Cancel aborts) → `useFileFiling → POST /v1/compliance/filings/{id}/file {referenceNo?}`; toast "Filing recorded" | write, status DUE | LIVE |
| Register (complaint) | POSH add card | `useCreatePoshComplaint → POST /v1/compliance/posh {companyId, filedDate, severity, description?}`; toast "Complaint registered" | `hrms.compliance.posh` | LIVE |
| Update status… select | POSH row | for RESOLVED/DISMISSED: `window.prompt("Resolution / closing note (optional):")` (Cancel aborts) → `useUpdatePoshStatus → POST /v1/compliance/posh/{id}/status {status, resolution?}`; toast "Status updated" | posh, open rows | LIVE |
| Create inspection link | Inspector form submit | `POST /v1/compliance/inspector-sessions {inspectorName, inspectorOrg, purpose, expiresAt, companyId}` then `POST …/{id}/link` → shows link; toast "Inspection access created" | `hrms.compliance.write` or `hrms.compliance.inspector.write` | LIVE |
| Get link | session row | `POST /v1/compliance/inspector-sessions/{id}/link` → `{token}` → renders `{origin}/inspection#{token}` | write / inspector.write, ACTIVE | LIVE |
| Open read-only inspection | link card | opens `/inspection#token` in new tab | same | LIVE |
| Documents | session row | toggles the `InspectionFiles` card for that session | write / inspector.write, ACTIVE | LIVE |
| Share PDF | documents form | client check ≤ 5 MB → `apiBlob POST /v1/compliance/inspector-sessions/{id}/documents` (multipart title+file); toast "Document shared" | same | LIVE |
| Unshare | documents list | `DELETE /v1/compliance/inspector-sessions/{id}/documents/{docId}`; toast "Document unshared" | same | LIVE |
| Revoke | session row | `POST /v1/compliance/inspector-sessions/{id}/revoke`; clears link + documents; toast "Access revoked" | same, ACTIVE | LIVE |
| Retry | sessions / documents error | refetch | — | LIVE |
| Pagination | below sessions card | `HrPagination` 20/page | read | LIVE |

### States
- loading: `HrStatCard loading`; pulsing rows (4 in Calendar/Filings, 3 in POSH); "Loading filing deadlines..."; "Loading inspection sessions..."; "Loading shared documents..."; "Loading company..." when no company resolved.
- empty: "No compliance items yet / Track statutory due dates so nothing is missed." · "No recorded deadlines for this period." · "No filings recorded / Schedule PF / ESI / TDS filings to track deadlines." · "No complaints on record / Registered complaints appear here with their inquiry status." · "No inspection sessions." · "No documents shared."
- error: calendar/sessions/documents show `role=alert` message + **Retry** (plain, not styled); items/filings/POSH hooks have no error branch (table just shows empty).
- no-permission: "No compliance access for this role"; `PoshDenied` "Restricted area"; owner select disabled "Cannot browse employees".
- special: KPI cards say "On this page" when > 1 page (no server aggregate); closed POSH rows show "Closed"; revoked/expired sessions lose their action buttons.

### Rules & permissions
- Calendar & Filings tabs gated on `compliance.read || compliance.write` (write implies read); POSH on `compliance.posh` only; Inspector on `compliance.read || compliance.inspector.read`; creating/revoking links on `compliance.write || compliance.inspector.write`.
- Obligation title + due date required; filing due date required; POSH filed date required. Cancel in either prompt aborts (no false "filed"/"closed" record).
- Inspector sessions: expiry within 7 days (label; enforced server side), signed HMAC token in URL fragment, PDF only, ≤ 5 MB, each download rechecked for scope/expiry/revocation [HANDOFF §5 Compliance]. Company scoping via `companyId` on every call.

### Gaps & plan  (keep / add / change)
- **Keep:** three registers with pagination; month calendar over real events; prompt-cancel safety on Mark filed / close POSH; inspector link + PDF share + revoke.
- **Add:** [BLUEPRINT §6 rows 42, 44; §7 target IA; PLAN §15] POSH as its own confidential sidebar leaf `/hrms/compliance/posh` and Compliance Calendar at `/hrms/compliance/calendar`. · [HANDOFF §10 D, §12; STATUS "Important limits"] inspector OTP delivery (`/inspector-sessions/otp` is only an alias) and scoped muster export are not implemented — do not design them as live; if shown, mark "coming later". · [HANDOFF §5 Compliance limits] retention / cleanup of unshared private objects and audit history. · [code] server-side status aggregate so Pending/Overdue/Completed cover all pages, not "On this page". · [code] error state for items/filings/POSH queries (currently silent).
- **Change:** Mark filed and POSH close use `window.prompt` — replace with a `Modal` ("Record filing" with Challan reference; "Close complaint" with Resolution note). · Inspector Expires / Last opened use `toLocaleString()` (browser-locale, e.g. "9/23/2026, 5:30:00 PM") and Filing-calendar rows show raw `2026-09-18` — format as `18 Sep 2026, 5:30 pm` / `18 Sep 2026`. · Inspector form and add cards are always-open inline forms; move **Add obligation / Add filing / Register complaint / Create inspection link** into `HrPageHeader` actions opening an `HrDrawer`. · Inspector table: "Get link · Documents · Revoke" as three ghost buttons per row is crowded — Documents should open an `HrDrawer` and Revoke should confirm via `useConfirmDialog`. · Calendar section sits below the items table with no visual link; either make it the primary view of the tab or a toggle "Table / Calendar". · Sessions `HrPagination` is outside the `TableCard` footer.

### Screenshot
`Attach: /hrms/compliance — current screen`

### Claude Design prompt (ready to paste)
```
Design the Statutory Compliance page (/hrms/compliance) for compliance/HR admins (OWNER, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD) and a POSH-only committee role.
HrPageHeader crumb "Compliance", title "Statutory Compliance", tabs Compliance Calendar · Statutory Filings · POSH · Inspector View, a Company select in the filters slot, and a tab-specific primary action (Add obligation / Add filing / Register complaint / Create inspection link) opening an HrDrawer.
Compliance Calendar: HrStatCard Pending 6 · Overdue 2 · Completed 18; a Table/Calendar toggle. Table: TableCard › DataTable Obligation ("PF monthly return") · Category ("Statutory") · Owner (HrAvatar "Meera Iyer · EMP-0142") · Due "15 Oct 2026" · Status (pending=warn, done=ok, overdue=red) · "Mark done". Calendar: month header "September 2026" with Previous / Today / Next, 7-column grid with "3 due" chips, a day-detail list "Deadlines on 18 Sep 2026 · 3" with status pills.
Statutory Filings: DataTable Type (pill PF / ESI / TDS / PT / GRATUITY / OTHER) · Period "2026-08" · Amount "₹1,20,000" · Due "15 Sep 2026" · Filed "14 Sep 2026" · Reference "TRRN 1234567890" · Status (due=warn, filed=ok, late=red) · "Mark filed" opening a Modal "Record filing" with a Challan / acknowledgement reference field.
POSH: confidential mint banner with ShieldAlert; DataTable Complaint # "POSH-2026-004" · Filed · Severity (LOW/MEDIUM/HIGH/CRITICAL) · Status (received=info, under inquiry=warn, resolved=ok, dismissed=gray) · Resolved · row action "Update status" → Modal with next status + Resolution note; closed rows read "Closed".
Inspector View: intro card; DataTable Audit ("PF inspection FY 2025-26") · Inspector ("R. Krishnan · EPFO Chennai") · Expires "25 Sep 2026, 6:00 pm" · Last opened "Not opened" · Status (active=ok, revoked/expired=gray) · row actions Get link · Documents (HrDrawer with Share PDF ≤ 5 MB form and list "Form 5A.pdf (312 KB) · Unshare") · Revoke (ConfirmDialog). Link card with read-only URL, "Open read-only inspection", and the "Anyone with this link…" note.
States: skeleton rows; EmptyState "No compliance items yet" / "No filings recorded" / "No complaints on record" / "No inspection sessions"; alert + Retry; no-access "No compliance access for this role" and the "Restricted area" lock card for POSH.
Keep prompt-cancel safety (Cancel never records a filing or closes a case). Do not show OTP or muster export as live. Change: formatted dates everywhere, header-level actions, POSH and Calendar as their own leaves.
```

---

## Compliance inspection (public inspector page)  `/inspection`
- **File:** `modules/hrms/compliance/InspectorView.tsx` (+ `inspectorCsv.ts`)  ·  **Sidebar:** not in sidebar / reached from the inspection link `…/inspection#<token>` issued in Statutory Compliance › Inspector View (rendered outside `PlatformShell`, no login)  ·  **Roles:** anonymous; access is the signed HMAC token in the URL fragment (App.tsx line 172, no `RouteGuard`).
- **Status:** LIVE — `POST /api/v1/public/inspector-view` and `/inspector-view/document`, CSV built client-side from the returned events.

### Purpose
A government inspector or external auditor opens the link an admin shared and reads, month by month, the company's compliance obligations and filings with their status, downloads the PDFs the company explicitly shared, and exports the visible month as CSV. Nothing is editable.

### Layout (map to the design-system parts)
1. Plain `<main>` (`max-w-5xl`, `bg-bg-base`) — no `HrPageHeader`; `<h1>` "Compliance inspection", sub "Read-only company compliance records".
2. Red `role=alert` line for export/download errors.
3. **Reporting month** `type=month` input (`ut-input max-w-xs`).
4. `HrButton ghost` **Export records (CSV)** ("Preparing export..." while busy).
5. `.ut-card` session summary: purpose (h2), inspector name, "Access expires {toLocaleString()}".
6. `.ut-card` **Shared documents**: list title + `HrButton ghost` **Download PDF**; empty "No documents shared with this inspection."
7. `.ut-card` › `hr-table`: Obligation / filing · Due date (raw `yyyy-MM-dd`) · Category ("-" fallback) · Status (plain text, no pill). Empty row "No recorded deadlines for this month."

### Data shown
- `POST /api/v1/public/inspector-view {token, from, to}` (credentials omitted, `retry:false`, `gcTime:0`) → `{inspectorName, purpose, expiresAt, documents[{id,title,sizeBytes}], events[{id,title,date,status,category}]}` for the chosen month.
- `POST /api/v1/public/inspector-view/document {token, id}` → PDF blob, saved as `inspection-{id}.pdf`.
- CSV: `inspectorCsv(events)` (BOM, formula-prefix escaped) saved as `compliance-inspection-{yyyy-MM}.csv`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Reporting month | top | refetches the view for that month (disabled while exporting) | token holder | LIVE |
| Export records (CSV) | top | re-validates via `query.refetch()` then downloads CSV (a revoked link cannot export from cache); disabled while exporting, while the view is fetching, or before any data has loaded | token holder | LIVE |
| Download PDF | Shared documents row | `POST …/document` → blob download | token holder | LIVE |

### States
- no token: "Open the complete inspection link supplied by the company administrator."
- loading: "Checking inspection access..." (`role=status`).
- error / expired / revoked: `.ut-card` with server message or "This inspection link is invalid, expired or revoked."
- empty: "No documents shared with this inspection." · "No recorded deadlines for this month."
- action error: red line, e.g. "Document access is no longer available".

### Rules & permissions
- Token is in the URL fragment (never sent to the server on page load); every request re-checks session active + expiry + revocation + document/session association; downloads are `no-store` streams [HANDOFF §5 Compliance]. `credentials: 'omit'` — the page never uses the app JWT. Only the month in view is exported.

### Gaps & plan  (keep / add / change)
- **Keep:** fragment token, fresh re-validation before export, PDF download path, explicit expiry line.
- **Add:** [HANDOFF §10 D / §12; STATUS limits] OTP challenge and scoped muster export are open items — not to be designed as available. · [code] status pills and formatted dates (data has `status` strings identical to the admin page).
- **Change:** unbranded raw page — give it a minimal public header (company name from the payload is not returned; use "Compliance inspection" + purpose) and the design-system table/pill/empty-state primitives. · Dates raw `2026-09-18` and `toLocaleString()` expiry — format `18 Sep 2026`. · Month input and Export button sit loose above the cards — group them in a toolbar.

### Screenshot
`Attach: /inspection — current screen`

### Claude Design prompt (ready to paste)
```
Design the public Compliance inspection page (/inspection#token) for an anonymous government inspector — no sidebar, no login, read-only.
Top: a slim public header "Compliance inspection · Read-only company compliance records". Summary card: purpose "EPFO inspection FY 2025-26", inspector "R. Krishnan", "Access expires 25 Sep 2026, 6:00 pm".
Toolbar: Reporting month picker (default current month) + HrButton ghost "Export records (CSV)" ("Preparing export..." while busy).
Card "Shared documents": rows "Form 5A – Aug 2026" with ghost "Download PDF" (today only the title renders; `sizeBytes` is in the payload, so a "(312 KB)" suffix like the admin list is a safe addition); EmptyState "No documents shared with this inspection."
TableCard › DataTable Obligation / filing ("PF monthly return", "ESI half-yearly return") · Due date "15 Sep 2026" · Category ("Statutory", "-") · Status as HrStatusPill (done/filed=ok, overdue/late=red, pending/due=warn). Empty row "No recorded deadlines for this month."
States: "Checking inspection access..." skeleton; full-card error "This inspection link is invalid, expired or revoked."; no-token message "Open the complete inspection link supplied by the company administrator."; red inline alert for a failed download.
Keep it strictly read-only; do not add OTP or muster export controls (not implemented). Change raw dates to 18 Sep 2026 and plain status text to pills.
```

---

## Full & final settlements  `/hrms/fnf`
- **File:** `modules/hrms/FullAndFinal.tsx`; hook `modules/hrms/api/useFnf.ts`  ·  **Sidebar:** Employee Exit › **Full & Final Settlement** (`R_FIN_RUPEE` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD; PlatformShell.tsx 190). The sibling leaf **Resignation & Exit** now routes to `/hrms/exit` (PlatformShell.tsx 189) — the old collision where both leaves pointed at `/hrms/fnf` is fixed. HR_MANAGER has no sidebar leaf here and reaches the page from the Exit page / Exit tab "F&F" links when holding `hrms.fnf.read`.  ·  **Roles:** route `RouteGuard anyOf ['hrms.fnf.read','hrms.fnf.process','hrms.fnf.approve']`, `ModuleGate payroll` (App.tsx 384–390). Page container `max-w-7xl`.
- **Status:** LIVE — `GET/POST /v1/fnf/settlements…` for list, detail, process, approve, pay, cancel. (Resignation/notice itself is NOT here — see the next section.)

### Purpose
Finance / HR finalise a leaver's dues: pick a separated employee (EXITED/TERMINATED with a recorded last working day), itemise earnings and deductions, process the settlement for approval, approve it (advance recovery applied on approval), and record that the net amount was paid. Segregation of duties is enforced: you cannot approve your own settlement or pay one you approved.

### Layout (map to the design-system parts)
1. `HrPageHeader` — crumb "Employee exit", title "Full & final settlements", subtitle "Review a leaver's earnings and deductions, approve their settlement, and record completed payment." No actions.
2. `HrTabs`: **Settlements** (`hrms.fnf.read`) · **Create settlement** (`hrms.fnf.process`). Default Settlements.
3. No-access `.ut-card`: "You do not have access to full & final settlements."

#### Sub-view: Settlements
1. KPI strip 4 × `HrStatCard`: **Total settlements** (blue, server total) · **Awaiting approval** (orange, PROCESSED count, sub "On this page") · **Approved** (green, "On this page") · **Payment recorded** (teal, `₹` sum of PAID rows, "On this page").
2. `TableCard` › `DataTable` columns: **Employee** (`HrAvatar name sub=employeeCode`, fallback "Employee record unavailable") · **Last working day** (`d MMM yyyy` en-IN) · **Net settlement** (`₹` tabular-nums bold) · **Status** (`HrStatusPill` initiated=gray, processed=warn, approved=ok, paid=teal, cancelled=gray; lower-cased) · **Details** (`HrButton ghost sm` **Review settlement**). Footer `HrPagination` 20/page (page clamped).

#### Drawer: Settlement details (`HrDrawer max-w-2xl`)
1. `HrAvatar` + status pill; "Last working day: **18 Sep 2026**".
2. Mint 3-cell block: Earnings / Deductions / Net payable (`₹`).
3. Section **Settlement components**: `hr-table` Component · Type (earning/deduction) · Amount (right, `₹`).
4. Notes block; `dl` Processed / Approved / Payment recorded dates (only those set).
5. Segregation note when applicable: "Another authorized colleague must approve and record payment for your own settlement." / "…because you approved this settlement."
6. Footer-style action row (inside body): **Approve settlement** (PROCESSED + `hrms.fnf.approve`) · **Record payment** (APPROVED + `hrms.fnf.pay`) · **Cancel settlement** ghost (INITIATED/PROCESSED + `hrms.fnf.process`). Choosing one swaps in an inline confirm panel: title "Approve this settlement?" / "Record completed payment?" / "Cancel this settlement?", explanatory text ("…Included advance recovery is applied on approval." / "Record that ₹1,20,000 has already been paid to the employee. This records payment; it does not send a bank transfer." / "Cancel this unapproved settlement to prepare a corrected one. Approved and paid settlements cannot be cancelled."), buttons **Confirm approval / Confirm payment recorded / Confirm cancellation** + ghost **Keep reviewing**; server error shown inline.

#### Sub-view: Create settlement (`max-w-4xl` form, no drawer)
1. `.ut-card` **Choose a separated employee**: Company select (All companies + list), Exit status select (Exited / Terminated), "Find employee" search, scrollable paged result list ("Ananya Rao / EMP-0142 - Last working day 18 Sep 2026"), `HrPagination` 10/page, selected banner "Selected: … Last working day: …".
2. Section **Earnings & deductions**: helper text ("Outstanding advances require an Advance Recovery deduction matching the current balance."); one `.ut-card` per component: "Component n", trash icon, Component label ("e.g. Salary dues"), Type (Earning / Deduction), Amount (INR); ghost buttons **Add earning · Add deduction**.
3. Settlement notes textarea ("Context for the approver").
4. Mint summary block Earnings / Deductions / Net payable (live totals) + `HrButton` **Review settlement** → confirm text "Confirm these components and the selected employee's exit date. This creates a settlement awaiting approval." with **Confirm process settlement** / ghost **Keep editing**.
5. Red validation line + `Failure` block for server errors.

### Data shown
- List: `useFnfSettlements(page) → GET /v1/fnf/settlements?page&size=20` (`employeeName, employeeCode, lastWorkingDay, netSettlement, status`).
- Detail: `useFnfSettlement(id) → GET /v1/fnf/settlements/{id}` (`grossPayable, totalDeductions, netSettlement, components[{label,type,amount}], notes, processedAt, approvedAt, paidAt, approverId, employeeId`).
- Actor: `useCurrentUser` (`employeeId || id`) for own/approver checks.
- Leaver picker: `useEmployeeDirectory {companyId?, status: EXITED|TERMINATED, search, page, pageSize:10}` (needs `hrms.employee.read`); `useCompanies`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tabs Settlements / Create settlement | `HrTabs` | switch | read / process | LIVE |
| Pagination | table footer | `HrPagination` 20/page | read | LIVE |
| Review settlement | row | opens **Settlement details** drawer (`GET /v1/fnf/settlements/{id}`) | `hrms.fnf.read` | LIVE |
| Approve settlement → Confirm approval | drawer | `useApproveSettlement → POST /v1/fnf/settlements/{id}/approve`; toast "Settlement approved" | `hrms.fnf.approve`, status PROCESSED, not own settlement | LIVE |
| Record payment → Confirm payment recorded | drawer | `usePaySettlement → POST /v1/fnf/settlements/{id}/pay`; toast "Completed payment recorded" | `hrms.fnf.pay`, status APPROVED, not own, not the approver | LIVE |
| Cancel settlement → Confirm cancellation | drawer | `useCancelSettlement → POST /v1/fnf/settlements/{id}/cancel`; toast "Settlement cancelled" | `hrms.fnf.process`, status INITIATED/PROCESSED | LIVE |
| Keep reviewing | drawer confirm panel | back to action row | — | LIVE |
| Try again | drawer / list errors | refetch | — | LIVE |
| Company / Exit status selects, Find employee, result rows, pagination | Create › picker | filters `useEmployeeDirectory`; selects leaver | `hrms.fnf.process` + `hrms.employee.read` | LIVE |
| Remove component (trash) | component card | removes row (min 1) | process | LIVE |
| Add earning / Add deduction | components section | appends a row of that type | process | LIVE |
| Review settlement | summary block | client validation → shows confirm | process | LIVE |
| Confirm process settlement | summary block | `useProcessSettlement → POST /v1/fnf/settlements {employeeId, companyId, lastWorkingDay, notes?, components[]}`; toast "Settlement processed and ready for approval"; jumps to Settlements tab and opens the new drawer (if `fnf.read`) | process | LIVE |
| Keep editing | summary block | cancels confirm | process | LIVE |

### States
- loading: `HrStatCard loading`; `DataTable loading`; "Loading settlement..."; "Loading employees...".
- empty: "No settlements yet. Create a settlement after recording the employee's exit." · "No separated employees match this selection."
- error: `Failure` red block + "Try again" (list, drawer, companies, directory, current user, each mutation).
- no-permission: "You do not have access to full & final settlements." · "Employee directory access is required to choose a leaver."
- validation messages: "Choose the employee whose exit is recorded." · "Record the employee's last working day in their exit record before creating a settlement." · "Complete every component with a label and a valid non-negative amount, or remove the incomplete row." · "Deductions cannot exceed earnings. Resolve any remaining recovery before settlement."
- special: segregation notes; drawer cannot be closed while a mutation is pending.

### Rules & permissions
- `hrms.fnf.read` list/detail · `hrms.fnf.process` create/cancel · `hrms.fnf.approve` · `hrms.fnf.pay`. Route also admits `fnf.approve` alone (sees nothing but the no-access card unless read is held).
- Lifecycle INITIATED → PROCESSED → APPROVED → PAID; CANCELLED only from INITIATED/PROCESSED. Own settlement cannot be approved/paid by the employee; approver cannot record payment. Advance recovery applied on approval; server rejects duplicate settlements and unresolved debt. Paying records payment only — no bank transfer.
- Leaver must be EXITED/TERMINATED with `lastWorkingDay` set on the employee record.

### Gaps & plan  (keep / add / change)
- **Keep:** segregation-of-duties messaging; inline confirm with server error; live totals; leaver picker restricted to separated employees.
- **Add:** [BLUEPRINT §6 row 49, §20; PLAN §16; AT-5] F&F tabs **Pending Calculation / Pending Payment / Settled** (map to PROCESSED / APPROVED / PAID) instead of one mixed list. · [BLUEPRINT §20; PLAN §16] experience letter step wired to the letters engine after PAID. · [PLAN §16] clearance checklist before F&F (backend ❌, P2). · [HANDOFF §5 "Learning, performance…" last bullet] "FNF … still need systematic current acceptance beyond smoke testing" — flag as unverified for edge cases. · [code] status filter + search on the Settlements table (none today).
- **Change:** Create settlement is a long single-column page; make it a 2-step `HrDrawer`/wizard (choose leaver → components & review) or keep the page but move **Create settlement** to `HrPageHeader` actions. · KPI cards "On this page" — aggregate server-side. · Status pill lower-case ("processed") → "Pending approval", "Approved", "Paid". · Drawer actions sit in the body; use the `HrDrawer footer` slot. · No back-link from a settlement to the leaver's record (`/hrms/employees/{id}?tab=exit`) although the Exit page links here; add one on the drawer avatar.

### Screenshot
`Attach: /hrms/fnf — current screen`

### Claude Design prompt (ready to paste)
```
Design the Full & final settlements page (/hrms/fnf) for finance/admin roles (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD — the only roles with the sidebar leaf); an HR_MANAGER holding hrms.fnf.read arrives via the "F&F" links on the Resignation & Exit page.
HrPageHeader crumb "Employee exit", title "Full & final settlements", tabs Pending calculation (badge 3) · Pending payment (2) · Settled · All, header action "Create settlement".
KPI strip HrStatCard: Total settlements 27 · Awaiting approval 3 · Approved 2 · Payment recorded ₹14,80,500.
TableCard with search (name / EMP code) and status filter › DataTable Employee (HrAvatar "Ananya Rao · EMP-0142") · Last working day "18 Sep 2026" · Net settlement "₹1,20,000" (tabular-nums) · Status (HrStatusPill Pending approval=warn, Approved=ok, Paid=teal, Initiated/Cancelled=gray) · "Review settlement".
Row opens HrDrawer max-w-2xl "Settlement details": avatar + pill, "Last working day 18 Sep 2026", mint 3-cell Earnings ₹1,45,000 / Deductions ₹25,000 / Net payable ₹1,20,000, components table (Salary dues · Earning · ₹95,000; Leave encashment · Earning · ₹50,000; Advance recovery · Deduction · ₹25,000), notes, timeline Processed 19 Sep 2026 / Approved / Payment recorded, segregation note "Another authorized colleague must approve and record payment for your own settlement." Footer: "Approve settlement" (PROCESSED), "Record payment" (APPROVED), ghost "Cancel settlement"; each swaps to an inline confirm ("Record that ₹1,20,000 has already been paid… it does not send a bank transfer." → "Confirm payment recorded" / "Keep reviewing").
Create settlement (drawer or 2-step page): Step 1 choose a separated employee — Company, Exit status Exited/Terminated, search, paged results "EMP-0142 · Last working day 18 Sep 2026"; Step 2 components (label, Earning/Deduction, Amount ₹) with "Add earning" / "Add deduction", notes, live summary, "Review settlement" → "Confirm process settlement".
States: TableSkeleton; EmptyState "No settlements yet. Create a settlement after recording the employee's exit."; red Failure block with Try again; validation lines ("Deductions cannot exceed earnings…"); no-access "You do not have access to full & final settlements."
Keep segregation-of-duties rules and the no-bank-transfer wording. Add the Pending calculation / Pending payment / Settled tabs and an "Experience letter" step after Paid (marked coming later). Change status labels to HR wording and move actions to the drawer footer.
```

---

## Resignation & Exit  `/hrms/exit`  (+ employee record › **Exit** tab)
- **File:** `modules/hrms/exit/ExitCenter.tsx` (page); employee-record tab `modules/hrms/employees/workspace/EmployeeExit.tsx` + lifecycle actions/modals in `modules/hrms/employees/EmployeeDetail.tsx` (lines 302–325, 350–360, 422–462); hooks `modules/hrms/api/useWorkforce.ts` (`useEmployeeCounts`, `useEmployeeDirectory`, `useStartNotice`, `useCancelNotice`, `useExitEmployee`, `useUpdateWorkforceEmployee`, `useWorkforceEmployee`)  ·  **Sidebar:** Employee Exit › **Resignation & Exit** → `/hrms/exit` (`R_HR` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER; PlatformShell.tsx 189). The Exit tab is reached from Workforce Directory › employee › **Exit**, and from this page's Employee / Profile links (`/hrms/employees/{id}?tab=exit`).  ·  **Roles:** page route `RouteGuard anyOf ['hrms.employee.read','hrms.employee.write']`, `ModuleGate hrms` (App.tsx 376–383); employee page `RouteGuard anyOf [hrms.employee.read]`; every write action behind `hrms.employee.write` (`usePermission` on the page, `Can code=` on the employee header); F&F links behind `hrms.fnf.read`.
- **Status:** LIVE — list, counts, Start notice, Withdraw notice, Mark exited and Edit dates all call the existing workforce endpoints (`GET /v1/hrms/employees?status…`, `GET /v1/hrms/employees/counts`, `POST …/{id}/notice|cancel-notice|exit`, `PUT …/{id}`); no new backend. The route collision described in BLUEPRINT §7.2/§20 and PLAN §16 is fixed in code (PlatformShell.tsx 186–190 comment, ExitCenter.tsx header comment) — those doc passages are now stale. There is still no resignation-approval or clearance step (see Gaps).

### Purpose
HR sees everyone who is leaving in one list — who is serving notice (with days left), who has exited or been terminated — and records the steps from here: start a notice period for an active employee, correct the dates/reason, withdraw the notice, mark the final exit, and hand over to F&F. The employee record's Exit tab shows the same person's joining → confirmation → notice → exit lifecycle and offers the same corrections.

### Layout (map to the design-system parts)

#### Page: Resignation & exit (`ExitCenter`)
1. `HrPageHeader` — crumb "Employee exit", title "Resignation & exit", subtitle "Everyone serving notice, with their last working day and what happens next. Settlements are prepared under Full & Final.", actions slot: `HrButton` **Start notice** (`LogOut` icon; `hrms.employee.write`). NOTE: the page body is a bare `space-y-5` div — it lacks the `mx-auto max-w-* p-6` wrapper every sibling page uses.
2. KPI strip 3 × `HrStatCard` (each `onClick` switches the tab): **On notice** (orange, `counts.notice`) · **Exited** (red, `counts.exited`) · **Terminated** (red, `counts.terminated`); value "—" until `GET /v1/hrms/employees/counts` resolves. Counts are tenant-wide (no company scope).
3. `HrTabs` **On notice · Exited · Terminated** — each is the directory `status` filter NOTICE_PERIOD / EXITED / TERMINATED; switching resets the page.
4. `TableCard` with toolbar `search` (placeholder "Search name, code, email…") and footer `hrPaginationFooter` (20/page) › `DataTable`:
   - On notice columns: **Employee** (`HrAvatar name sub=employeeCode`, wrapped in `Link` to `/hrms/employees/{id}?tab=exit`) · **Notice started** (`d MMM yyyy`, "—") · **Last working day** · **Days left** (`DaysLeft`: "n days" — bold when ≤ 7; `HrStatusPill warn` "Last day today"; `HrStatusPill red` "n days overdue"; "—" when no date) · **Reason** (`max-w-xs truncate`, full text in `title`) · unlabelled actions column, right-aligned: `HrButton ghost sm` **Edit dates** · **Withdraw notice** · **F&F** (`Wallet` icon, `Link /hrms/fnf`, only `hrms.fnf.read`) · `HrButton danger sm` **Mark exited**.
   - Exited / Terminated columns: **Employee** · **Last working day** · **Reason** · **Status** (`HrStatusPill` with HR wording: On notice=late, Exited=red, Terminated=red, Active=ok, Probation=warn, Suspended=warn) · actions **Profile** (ghost sm, `Link …?tab=exit`) · **F&F** (`hrms.fnf.read`).
   - `EmptyState` (`icon={UserMinus}`) replaces the table when there are no rows: title "No one is serving notice." / "No employees on notice match this search." / "No exited employees yet." / "No terminated employees." / "No leavers match this search."; description "Start a notice period from here or from an employee's Exit tab." (On notice) or "Employees appear here once HR marks them as exited or terminated."; action **Start notice** on the On notice tab when the user can write and no search is active.
5. `HrDrawer` **Start notice period** — intro "Records a resignation or notice for an active employee. They stay active with full access until you mark them exited."; **Employee** search input (placeholder "Type at least 2 characters of a name, code or email", `autoFocus`) → `role=listbox` of ACTIVE employees (`useEmployeeDirectory {status:'ACTIVE', search, pageSize: 8}`, enabled from 2 characters; rows `HrAvatar name sub=code` + email); once picked, a grey card with the avatar and `HrButton ghost sm` **Change**; **Notice start date** (default today, `max` = last day); **Last working day** (`min` = notice start); **Reason (optional)** textarea max 100; inline `role=alert` "Last working day must be on or after the notice start date." + server error ("Unable to start the notice period."). Footer: Cancel (ghost) · **Start notice** (disabled until employee + both dates + valid order; "Saving…").
6. `HrDrawer` **Separation details — {name}** — Notice start date (`max` = last day), Last working day (`min` = notice start), Reason (max 100); same order alert; server error "Unable to update separation details."; footer Cancel · **Save** (disabled unless both dates set and ordered).
7. `useConfirmDialog` confirmations: **Withdraw {name}'s notice?** — "The employee returns to Active. The recorded notice dates and reason are kept on the profile until edited." → **Withdraw notice**; **Mark {name} as exited?** — "Last working day {d MMM yyyy}. The employee loses platform access and moves to the Exited list; payroll and settlement records are unaffected." → **Mark exited** (`tone: 'danger'`). Mark exited on a row without a last working day opens the Separation details drawer instead of confirming.
8. No `hrms.employee.read`: `.ut-card` "You do not have access to employee exits." (the route also admits `hrms.employee.write` alone, which lands here).

#### Sub-view: employee record › Exit tab (`EmployeeExit`) + header lifecycle actions (`EmployeeDetail`)
1. (Employee page header, `EmployeeDetail.tsx`) lifecycle action row under the profile card, `hrms.employee.write` only: **Confirm Probation** (PROBATION) · **Start Notice** (ACTIVE) · **Cancel Notice** (NOTICE_PERIOD) · **Mark Exited** (NOTICE_PERIOD). Probation banner also offers **Confirm as permanent · Extend · Begin exit**. These are raw `<button>`s with Tailwind colours, not `HrButton`. Tab state is in the URL (`?tab=exit`), which is what the Exit page deep-links to.
2. Tab **Exit** › `SubSection` **Current standing**: `.ut-card` with `HrStatusPill` (status label via `STATUS_STYLE`), "Serving notice until **18 Sep 2026** · 12 days left" or "Last working day was **18 Sep 2026**", or "This employee is still employed. Notice and exit are recorded from the actions at the top of this page."
3. `SubSection` **Lifecycle** (hint "Dates recorded against this employment."): milestone rail — Joined · Probation ends · Confirmed · Notice started · Last working day / Exited (emerald dot when done, "Not set" otherwise).
4. `SubSection` **Separation details** (NOTICE_PERIOD / EXITED / TERMINATED): `.ut-card` "Reason" text ("No reason recorded."), action `HrButton ghost sm` **Edit separation details**.
5. `.ut-card` **Full & final settlement** (when `hrms.fnf.read` and on notice/separated): text + `Link` **Open full & final settlements** → `/hrms/fnf`.
6. Footnotes: "Exited employees stay in the directory; they are excluded from active-roster counts." / "Still on probation — confirm or extend from the actions at the top of this page."
7. `HrDrawer` **Edit separation details** — Notice start date (required when on notice), Last working day (required, min = notice start), Separation reason (max 100, textarea); inline alert "Last working day must be on or after the notice start date."; footer Cancel · **Save separation details**.
8. `ActionModal`s (header): **Start Notice Period** ("Record the employee's resignation and notice period." — Notice Start Date, Last Working Day *, Reason max 100; confirm **Start Notice**) · **Mark Employee as Exited** (Last Working Day *, Exit Reason; confirm **Mark Exited**) · **Cancel Notice Period** ("{name} will return to Active employment, and their notice start & last working day will be cleared."; confirm **Cancel Notice**).

### Data shown
- Page counts: `useEmployeeCounts → GET /v1/hrms/employees/counts` (`{total, active, notice, exited, terminated}`, tenant-wide; only enabled with `hrms.employee.read`).
- Page list: `useEmployeeDirectory → GET /v1/hrms/employees?status=NOTICE_PERIOD|EXITED|TERMINATED&search&page&pageSize=20` (Spring page; row fields used: `firstName, lastName, employeeCode, email, employmentStatus, noticeStartDate, lastWorkingDay, exitReason`).
- Start-notice picker: `useEmployeeDirectory {status:'ACTIVE', search, page:0, pageSize:8}` (enabled only while no employee is chosen and the query has ≥ 2 characters).
- Exit tab: all from the already-fetched employee `useWorkforceEmployee → GET /v1/hrms/employees/{id}`: `employmentStatus (PROBATION|ACTIVE|NOTICE_PERIOD|SUSPENDED|EXITED|TERMINATED), dateOfJoining, probationEndDate, confirmationDate, noticeStartDate, lastWorkingDay, exitReason`. No extra request.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Start notice | page header action / On-notice `EmptyState` action | opens `HrDrawer` **Start notice period** | `hrms.employee.write` | LIVE |
| Employee search / result row / Change | Start notice drawer | searches ACTIVE employees (≥ 2 chars, 8 rows); picks / clears the employee | write + `hrms.employee.read` | LIVE |
| Start notice (drawer footer) | Start notice drawer | `useStartNotice → POST /v1/hrms/employees/{id}/notice?noticeStart&lastWorkingDay&reason`; toast "{name} is now serving notice until {d MMM yyyy}"; closes and switches to On notice | write | LIVE |
| Cancel | Start notice / Separation drawers | closes (blocked while saving) | — | LIVE |
| KPI cards On notice / Exited / Terminated | KPI strip | `HrStatCard onClick` switches tab, resets page | `hrms.employee.read` | LIVE |
| Tabs On notice / Exited / Terminated | `HrTabs` | changes the directory `status` filter, resets page | read | LIVE |
| Search | `TableCard` toolbar | refetch with `search`, page 0 | read | LIVE |
| Pagination | `TableCard` footer | `hrPaginationFooter` 20/page | read | LIVE |
| Employee (avatar link) / Profile | row | `Link /hrms/employees/{id}?tab=exit` (opens the Exit tab) | read | LIVE |
| Edit dates | On-notice row | opens `HrDrawer` **Separation details — {name}** | write | LIVE |
| Save (Separation details drawer) | drawer footer | `useUpdateWorkforceEmployee → PUT /v1/hrms/employees/{id} {noticeStartDate?, lastWorkingDay, exitReason}`; toast "Separation details saved" | write | LIVE |
| Withdraw notice → Withdraw notice | On-notice row → `useConfirmDialog` | `useCancelNotice → POST /v1/hrms/employees/{id}/cancel-notice`; toast "{name} is active again"; error toast "Unable to withdraw the notice." | write, NOTICE_PERIOD | LIVE |
| Mark exited → Mark exited | On-notice row → `useConfirmDialog` (danger) | `useExitEmployee → POST /v1/hrms/employees/{id}/exit?lastWorkingDay&reason` using the stored last working day / reason; toast "{name} marked as exited"; if no last working day, opens the Separation details drawer instead | write, NOTICE_PERIOD | LIVE |
| F&F | row (On notice, Exited, Terminated) | `Link /hrms/fnf` (not pre-filtered to this employee) | `hrms.fnf.read` | LIVE |
| Try again | list error card | `refetch()` | — | LIVE |
| Start Notice / Begin exit | employee header / probation banner | opens **Start Notice Period** `ActionModal` → `useStartNotice → POST /v1/hrms/employees/{id}/notice?noticeStart&lastWorkingDay&reason`; toast "Notice period started" | `hrms.employee.write`, status ACTIVE (banner: PROBATION) | LIVE |
| Cancel Notice | employee header | `ActionModal` → `useCancelNotice → POST /v1/hrms/employees/{id}/cancel-notice`; toast "Notice withdrawn — employee is active again" | write, NOTICE_PERIOD | LIVE |
| Mark Exited | employee header | `ActionModal` → `useExitEmployee → POST /v1/hrms/employees/{id}/exit?lastWorkingDay&reason`; toast "Employee exited" | write, NOTICE_PERIOD | LIVE |
| Confirm Probation / Confirm as permanent / Extend | employee header / probation banner | `ActionModal`s → `useConfirmEmployee → POST …/{id}/confirm?confirmationDate` (toast "Employee confirmed") / `useExtendProbation` (toast "Probation extended") — probation lifecycle, shown here only because it shares the action row | write, PROBATION | LIVE |
| Edit separation details | Exit tab section action | opens `HrDrawer` **Edit separation details** | write, on notice or separated | LIVE |
| Save separation details | drawer footer | `useUpdateWorkforceEmployee → PUT …/employees/{id} {noticeStartDate?, lastWorkingDay, exitReason}`; toast "Separation details saved"; button disabled until last working day set, notice start set when on notice, and dates ordered | write | LIVE |
| Cancel | Exit tab drawer footer | closes (blocked while saving) | — | LIVE |
| Open full & final settlements | Exit tab F&F card | `Link /hrms/fnf` | `hrms.fnf.read` | LIVE |
| Sidebar "Resignation & Exit" | Employee Exit group | routes to `/hrms/exit` (this page) | R_HR | LIVE |

### States
- Page loading: `HrStatCard loading`, `DataTable loading`; picker "Searching…" (`role=status`).
- Page empty: `EmptyState` titles listed in Layout 4; picker "No active employee matches.".
- Page error: `.ut-card role=alert` "Unable to load employees." + server message + `HrButton ghost` **Try again**; picker "Unable to search employees." (`role=alert`); counts show "—" when unavailable; mutation failures surface as error toasts (list) or inline `text-danger` alerts (drawers).
- Page no-permission: "You do not have access to employee exits."; without `hrms.employee.write` the header action, Edit dates / Withdraw notice / Mark exited and the empty-state action are hidden; without `hrms.fnf.read` the F&F buttons are hidden.
- Page special: Days left renders `HrStatusPill warn` "Last day today" / `HrStatusPill red` "n days overdue"; Mark exited without a last working day redirects to the Separation details drawer.
- Exit tab — not separated & not on notice: explanatory sentence; no Separation details / F&F card.
- Exit tab — on notice: "Serving notice until … · n days left"; separated: "Last working day was …"; footnote on exited.
- Exit tab — probation: footnote "Still on probation — confirm or extend…".
- Exit tab drawer validation: order alert; Save disabled until valid; server error text "Unable to update separation details."
- Header modal validation (EmployeeDetail): toasts "Last working day is required" / "Last working day must be on or after the notice start date"; failure toasts "Failed to start notice" / "Failed to exit employee" / "Failed to cancel notice".

### Rules & permissions
- `hrms.employee.read` → page list, counts, Exit tab; only `hrms.employee.write` changes lifecycle (Start notice, Withdraw notice, Mark exited, Edit dates / separation details); F&F links only with `hrms.fnf.read`. Last working day ≥ notice start (enforced by `min`/`max` on the date inputs and an inline alert on both the page drawers and the Exit tab drawer); reason ≤ 100 chars. Start notice only for ACTIVE employees (picker is status-filtered; header button only on ACTIVE/PROBATION); exit only from NOTICE_PERIOD; cancel-notice reverts to ACTIVE (the page copy says the dates and reason stay on the profile; the header modal copy says they are cleared — the server decides). Exited employees remain in the directory but out of active counts. F&F requires `lastWorkingDay` on this record. TERMINATED is a directory status this UI never sets (no terminate action anywhere; orphan `/v1/employees/{id}/terminate` [BLUEPRINT §20]). Page counts are tenant-wide; the list has no company filter.

### Gaps & plan  (keep / add / change)
- **Keep:** the dedicated `/hrms/exit` list with tenant counts, status tabs and search; `useConfirmDialog` confirmations with explicit consequences; days-left pill logic; deep-link to the employee's Exit tab; the lifecycle rail and edit-separation drawer with date-order validation; hand-off links to F&F.
- **Resolved since the docs were written:** [BLUEPRINT §6 row 48, §7 (`/hrms/exit` "split from F&F"), §7.2, §20; PLAN §16; AT-5 "notice period is tracked on a dedicated /hrms/exit page (NOT /hrms/fnf)"] the dedicated page exists (`exit/ExitCenter.tsx`) and the sidebar leaf routes to it; the "Cancel notice — Wire" row of PLAN §16 is wired (Withdraw notice). Do not design this as missing.
- **Add:** [BLUEPRINT §20 / PLAN §16 "Resignation → Approval → Notice"; AT-5 "WHEN HR records resignation and it is approved"] there is no resignation request or approval state — HR records the notice directly and an employee cannot resign from self-service; if the design shows an "Approval" step, mark it "coming later". · [PLAN §16] clearance checklist (backend ❌, P2). · [BLUEPRINT §20; PLAN §16; AT-5] experience letter via the letters engine after exit / PAID. · [BLUEPRINT §20] retire orphan `/v1/employees/{id}/terminate` (P3, backend). · [code: `ExitCenter.tsx` 51–52] no Company filter on the list or counts, unlike every other admin list in this group. · [code: `ExitCenter.tsx` 94, 110] the F&F button links to `/hrms/fnf` unfiltered — an "F&F status" per leaver (Not started / Pending approval / Paid) would need `GET /v1/fnf/settlements` joined by employee; none exists today. · [HANDOFF §5 last bullet "imports/exits … still need systematic current acceptance beyond smoke testing"] flag as unverified for edge cases.
- **Change:** page body lacks the standard `mx-auto max-w-* p-6 sm:p-8` wrapper. · Employee header lifecycle buttons (`EmployeeDetail.tsx` 302–325, 350–360) are raw Tailwind `<button>`s — use `HrButton` (primary/ghost/danger). · The Exit tab still says "recorded from the actions at the top of this page"; surface Start Notice / Cancel Notice / Mark Exited inside the tab and link to `/hrms/exit`. · Three separation editors exist (`ExitCenter` `SeparationDrawer`, `EmployeeExit` `SeparationEditor`, and the header `ActionModal`s) with the same three fields — consolidate to one **Separation** drawer with mode (start / edit). · Days-left is computed two ways (`differenceInCalendarDays` on the page vs `Math.ceil` of ms on the tab) — unify. · Withdraw/cancel-notice copy disagrees between page ("dates and reason are kept") and header modal ("will be cleared") — pick the true one.

### Screenshot
`Attach: /hrms/exit — current screen` and `Attach: /hrms/employees/:id?tab=exit — current screen`

### Claude Design prompt (ready to paste)
```
Design the Resignation & exit page (/hrms/exit) for HR admins (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER) and redesign the employee record's "Exit" tab to match. The page already exists and is live — refine it, do not invent an approval workflow.
Page: HrPageHeader crumb "Employee exit", title "Resignation & exit", subtitle "Everyone serving notice, with their last working day and what happens next.", header action HrButton "Start notice"; add a Company select in the filters slot (missing today). KPI strip HrStatCard (clickable, switch the tab): On notice 4 (orange) · Exited 11 (red) · Terminated 1 (red). HrTabs On notice (badge 4) · Exited · Terminated.
TableCard with search "Search name, code, email…" › DataTable. On notice: Employee (HrAvatar "Ananya Rao · EMP-0142", links to the profile's Exit tab) · Notice started "1 Sep 2026" · Last working day "30 Sep 2026" · Days left ("7 days" bold when ≤ 7; HrStatusPill warn "Last day today"; HrStatusPill red "3 days overdue") · Reason ("Relocation", truncated) · row actions HrButton ghost sm "Edit dates" · "Withdraw notice" (useConfirmDialog "Withdraw Ananya Rao's notice?" → "Withdraw notice") · "F&F" (Wallet icon) · HrButton danger sm "Mark exited" (useConfirmDialog danger "Mark Ananya Rao as exited?" → "Mark exited"). Exited / Terminated: Employee · Last working day · Reason · Status (HrStatusPill On notice=late, Exited=red, Terminated=red) · "Profile" · "F&F". Tighten the crowded four-button action cell into one primary ("Mark exited") plus an overflow.
Drawers: "Start notice period" (type-ahead Employee search of active staff with HrAvatar rows + "Change", Notice start date, Last working day, Reason (optional) ≤ 100, inline alert "Last working day must be on or after the notice start date.", footer Cancel / "Start notice") and "Separation details — Ananya Rao" (same three fields, footer Cancel / "Save").
Employee Exit tab: "Current standing" card with HrStatusPill and "Serving notice until 30 Sep 2026 · 7 days left"; "Lifecycle" milestone rail Joined 3 Jan 2022 → Probation ends → Confirmed → Notice started → Last working day, emerald dots when done, "Not set" otherwise; "Separation details" card with Reason and "Edit separation details" HrDrawer; a "Full & final settlement" card linking to /hrms/fnf; a "Clearance checklist" and "Experience letter" card marked coming later. Put the lifecycle actions (Start Notice / Cancel Notice / Mark Exited / Confirm Probation) as HrButtons inside the tab, not only as raw buttons in the page header, and link the tab back to /hrms/exit.
States: EmptyState (UserMinus) "No one is serving notice." with action "Start notice" / "No exited employees yet." / "No terminated employees."; error card "Unable to load employees." with Try again; no-access card "You do not have access to employee exits."; without hrms.employee.write hide every write action.
Keep the date-order validation, the confirm-dialog wording about platform access, and the "exited employees stay in the directory" note. Do not add an approval step, clearance checklist or F&F status column as live — none has a backend yet.
```
